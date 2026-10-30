/**
 * Physical Mongo sizes for the saved-state matrix: every arrangement x encoding
 * cell, plus today's objects, stored as 100 independent documents per
 * collection under snappy and zstd. Same procedure as direct-storage-probe.ts:
 * insert, round-trip check, compact, checkpoint, compact again, fsync with lock,
 * then read the collection's .wt file length (must equal storageSize).
 *
 * Usage (fresh standalone mongod on 127.0.0.1:27186 with an empty dbPath under
 * /private/tmp/articulated-saved-state-matrix-*):
 *   SAVED_STATE_MATRIX_DBPATH=/private/tmp/articulated-saved-state-matrix-1 \
 *   SAVED_STATE_MATRIX_MONGO_OUTPUT=saved-state-matrix-mongo-1 \
 *   TSX_TSCONFIG_PATH=tsconfig.dev.json \
 *   node --import tsx src/browser/saved-state-matrix-mongo.ts
 */
import type { SavedIdList } from "articulated";
import { MongoClient } from "mongodb";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { forDocument } from "../full_picture/fixture";
import { canonicalWorkloads } from "./canonical-workload";
import {
  arrangements,
  encodings,
  opaque,
  restore,
} from "./saved-state-matrix-formats";

const sha256 = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface Cell {
  dataset: string;
  arrangement: string;
  encoding: string;
  /** Stored `state` for document i. */
  state(i: number): unknown;
  /** Decode a stored `state` back to document i's SavedIdList. */
  check(state: unknown, i: number): void;
}

async function main() {
  const expected = process.env.SAVED_STATE_MATRIX_DBPATH;
  assert(
    expected && path.isAbsolute(expected),
    "Set an isolated temporary dbPath",
  );
  assert(
    ["/private/tmp/", "/tmp/"].some((dir) =>
      fs
        .realpathSync(expected)
        .startsWith(`${dir}articulated-saved-state-matrix-`),
    ),
    "Only this experiment's newly created temporary directory is allowed",
  );
  const output = path.resolve(
    __dirname,
    "../../results",
    process.env.SAVED_STATE_MATRIX_MONGO_OUTPUT ?? "saved-state-matrix-mongo",
    "mongo.json",
  );
  assert(!fs.existsSync(output), "Never overwrite existing results");
  const documents = Number(process.env.SAVED_STATE_MATRIX_DOCUMENTS ?? 100);

  const structured = (await canonicalWorkloads()).structured.chunks.at(
    -1,
  )!.expected;
  const datasets: [string, (i: number) => SavedIdList][] = [
    ["random", (i) => opaque(structured, i)],
    ["client-counter", (i) => forDocument(structured, i)],
  ];
  const cells: Cell[] = [];
  for (const [dataset, source] of datasets) {
    cells.push({
      dataset,
      arrangement: "objects",
      encoding: "plain",
      state: source,
      check: (state, i) => assert.deepEqual(state, source(i)),
    });
    for (const arrangement of arrangements) {
      if (!arrangement.arrange(source(0))) continue;
      for (const encoding of encodings)
        cells.push({
          dataset,
          arrangement: arrangement.id,
          encoding: encoding.id,
          state: (i) => encoding.encode(arrangement.arrange(source(i))!),
          check(state, i) {
            const saved = source(i);
            const decoded = encoding.decode(state, arrangement.arrange(saved)!);
            const ids = arrangement.bunchIds(decoded);
            assert.deepEqual(
              ids,
              saved.map((r) => r.bunchId),
            );
            assert.deepEqual(restore(decoded, ids), saved);
          },
        });
    }
  }
  const only = process.env.SAVED_STATE_MATRIX_ENCODINGS?.split(",");
  const selected = only
    ? cells.filter(
        (c) => c.arrangement === "objects" || only.includes(c.encoding),
      )
    : cells;

  const client = new MongoClient(
    "mongodb://127.0.0.1:27186/?directConnection=true",
  );
  await client.connect();
  const admin = client.db("admin"),
    db = client.db("articulated_saved_state_matrix");
  try {
    const options = await admin.command({ getCmdLineOpts: 1 });
    assert.equal(
      fs.realpathSync(options.parsed.storage.dbPath),
      fs.realpathSync(expected),
    );
    assert.equal(options.parsed.net.port, 27186);
    assert.equal(options.parsed.net.bindIp, "127.0.0.1");
    assert.equal(
      (await db.listCollections().toArray()).length,
      0,
      "Fresh database required; no data is dropped",
    );
    const build = await admin.command({ buildInfo: 1 });
    const entries: {
      collection: string;
      dataset: string;
      arrangement: string;
      encoding: string;
      compressor: string;
      compact: unknown;
      compactAfterCheckpoint?: unknown;
      storedStateHashDocument0: string;
    }[] = [];
    for (const compressor of ["zstd", "snappy"])
      for (const cell of selected) {
        const name = [compressor, cell.dataset, cell.arrangement, cell.encoding]
          .join("_")
          .replaceAll("-", "_");
        const collection = await db.createCollection<{
          _id: number;
          state: unknown;
        }>(name, {
          storageEngine: {
            wiredTiger: { configString: `block_compressor=${compressor}` },
          },
        });
        let state0: unknown;
        for (let offset = 0; offset < documents; offset += 5) {
          const batch = Array.from(
            { length: Math.min(5, documents - offset) },
            (_, j) => {
              const index = offset + j,
                state = cell.state(index);
              if (index === 0) state0 = state;
              return { _id: index, state };
            },
          );
          await collection.insertMany(batch);
        }
        assert.equal(await collection.countDocuments(), documents);
        for (const index of [0, documents - 1]) {
          const document = await collection.findOne({ _id: index });
          assert(document);
          cell.check(document.state, index);
        }
        const compact = await db.command({
          compact: name,
          freeSpaceTargetMB: 1,
        });
        assert.equal(compact.ok, 1);
        entries.push({
          collection: name,
          dataset: cell.dataset,
          arrangement: cell.arrangement,
          encoding: cell.encoding,
          compressor,
          compact,
          storedStateHashDocument0: sha256(state0),
        });
        console.log(`Stored, round-tripped and compacted ${name}`);
      }
    await admin.command({ fsync: 1 });
    for (const entry of entries) {
      const compact = await db.command({
        compact: entry.collection,
        freeSpaceTargetMB: 1,
      });
      assert.equal(compact.ok, 1);
      entry.compactAfterCheckpoint = compact;
    }
    await admin.command({ fsync: 1, lock: true });
    try {
      const rows = [];
      for (const entry of entries) {
        const result = await db
          .collection(entry.collection)
          .aggregate([{ $collStats: { storageStats: { scale: 1 } } }])
          .next();
        assert(result);
        const s = result.storageStats;
        assert(
          s.wiredTiger.creationString.includes(
            `block_compressor=${entry.compressor}`,
          ),
        );
        const table = s.wiredTiger.uri.split(":").pop();
        assert(/^collection[-a-zA-Z0-9_]+$/.test(table));
        const collectionFile = path.join(expected, table + ".wt"),
          stat = fs.statSync(collectionFile);
        assert.equal(stat.size, s.storageSize);
        assert.equal(s.count, documents);
        rows.push({
          ...entry,
          storageBytes: stat.size,
          storageBytesPerDocument: stat.size / documents,
          freeBytes: s.freeStorageSize ?? 0,
          indexBytes: s.totalIndexSize,
          avgObjSize: s.avgObjSize,
          collectionFile,
        });
      }
      console.table(
        rows.map((r) => ({
          compressor: r.compressor,
          dataset: r.dataset,
          arrangement: r.arrangement,
          encoding: r.encoding,
          bsonKB: +(r.avgObjSize / 1000).toFixed(1),
          diskKBPerDoc: +(r.storageBytesPerDocument / 1000).toFixed(1),
        })),
      );
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(
        output,
        JSON.stringify(
          {
            complete: true,
            generatedAt: new Date().toISOString(),
            version: build.version,
            mongoGitVersion: build.gitVersion,
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            cpu: os.cpus()[0]?.model,
            dbPath: expected,
            port: 27186,
            documents,
            runs: structured.length,
            distinctBunches: new Set(structured.map((r) => r.bunchId)).size,
            idModels: {
              random:
                "Each distinct bunchId replaced by an independent 8-character base64url SHA-256 prefix per document (collision-checked)",
              "client-counter":
                "client_counter IDs with each client renamed to an independent 10-character string per document",
            },
            procedure: [
              "Fresh local standalone bound to 127.0.0.1:27186; dbPath and bind options verified before writes",
              "One collection per cell and compressor; 100 independently renamed documents; inserted in batches of five",
              "Full round trip (bunchIds and SavedIdList) checked for the first and last document",
              "compact every collection; fsync checkpoint; compact again; fsync with lock",
              "Actual collection .wt file length read while locked and checked equal to storageSize; compressor checked",
            ],
            measurement:
              "Physical collection file bytes / documents, including allocation/free space; excludes _id indexes and shared files.",
            rows,
          },
          null,
          2,
        ) + "\n",
        { flag: "wx" },
      );
      console.log(`Wrote ${output}`);
    } finally {
      await admin.command({ fsyncUnlock: 1 });
    }
  } finally {
    await client.close();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
