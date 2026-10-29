/**
 * Saved-state size matrix: data arrangements (rows) x encodings (columns).
 *
 * An arrangement decides WHAT is stored: which string and number fields, e.g.
 * random IDs on every run vs client_counter IDs as numbers. An encoding decides
 * HOW those fields become BSON: plain arrays, Float64 Binary per number field,
 * varint Binary per number field, one protobuf blob, or comma-separated
 * strings. Every cell is decoded back to the original per-run bunchIds and
 * saved state and checked.
 *
 * This is the per-document estimate. For physical Mongo collection sizes of
 * the same cells, see saved-state-matrix-mongo.ts.
 *
 * Usage: SNAPPYJS=/abs/snappyjs SAVED_STATE_MATRIX_OUTPUT=/abs/out.json \
 *   node --import tsx src/browser/saved-state-matrix.ts
 */
import type { SavedIdList } from "articulated";
import { deserialize, serialize } from "bson";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import zlib from "node:zlib";
import { canonicalWorkloads } from "./canonical-workload";
import {
  arrangements,
  encodings,
  fourClients,
  opaque,
  restore,
} from "./saved-state-matrix-formats";

async function main() {
  const structured = (await canonicalWorkloads()).structured.chunks.at(
    -1,
  )!.expected;
  const snappy = process.env.SNAPPYJS
    ? (createRequire(__filename)(process.env.SNAPPYJS) as {
        compress(b: Uint8Array): Uint8Array;
      })
    : null;
  const datasets: [string, SavedIdList][] = [
    ["random", opaque(structured)],
    ["client-counter", structured],
    ["client-counter-4-clients", fourClients(structured)],
  ];
  const measure = (state: unknown) => {
    const bson = serialize({ _id: 0, state });
    return {
      bson,
      rawBytes: bson.length,
      zstdBytes: zlib.zstdCompressSync(bson, {
        params: { [zlib.constants.ZSTD_c_compressionLevel]: 6 },
      }).length,
      snappyBytes: snappy ? snappy.compress(bson).length : null,
    };
  };
  const rows = [];
  for (const [dataset, saved] of datasets) {
    // Reference: today's saved objects as plain BSON.
    const { rawBytes, zstdBytes, snappyBytes } = measure(saved);
    rows.push({
      dataset,
      arrangement: "objects",
      encoding: "plain",
      rawBytes,
      zstdBytes,
      snappyBytes,
    });
    for (const arrangement of arrangements) {
      const arranged = arrangement.arrange(saved);
      if (!arranged) continue;
      for (const encoding of encodings) {
        const { bson, ...sizes } = measure(encoding.encode(arranged));
        const decoded = encoding.decode(deserialize(bson).state, arranged);
        const ids = arrangement.bunchIds(decoded);
        assert.deepEqual(
          ids,
          saved.map((r) => r.bunchId),
        );
        assert.deepEqual(restore(decoded, ids), saved);
        rows.push({
          dataset,
          arrangement: arrangement.id,
          encoding: encoding.id,
          ...sizes,
        });
      }
    }
  }
  console.table(rows);
  const output = process.env.SAVED_STATE_MATRIX_OUTPUT;
  if (output)
    fs.writeFileSync(
      output,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          runs: structured.length,
          distinctBunches: new Set(structured.map((r) => r.bunchId)).size,
          measurement:
            "{_id, state} BSON; raw = BSON bytes; zstd level 6 and snappy compress each document on its own (proxy for WiredTiger block compression, not a Mongo measurement).",
          arrangements: arrangements.map(({ id, label }) => ({ id, label })),
          encodings: encodings.map(({ id, label }) => ({ id, label })),
          rows,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
