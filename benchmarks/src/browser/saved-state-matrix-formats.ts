/**
 * Arrangements (what is stored) and encodings (how it becomes BSON) for the
 * saved-state matrix. See saved-state-matrix.ts and saved-state-matrix-mongo.ts.
 */
import type { SavedIdList } from "articulated";
import { Binary, type Document } from "bson";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  fromTransposedOmit,
  toTransposedOmit,
} from "../algorithms/id_list_saved_states";
import { packFloat64, readFloat64 } from "./flat-f64-formats";
import {
  packSintVarints,
  packUintVarints,
  parseClientCounterId,
  readSintVarints,
  readUintVarints,
  VarintReader,
  VarintWriter,
} from "./flat-varint-formats";

/** Logical fields, in protobuf field-number order. */
export interface Arranged {
  strings: Record<string, string[]>;
  numbers: Record<string, { values: number[]; signed: boolean }>;
}
export interface Arrangement {
  id: string;
  label: string;
  /** Null when the IDs don't have the form this arrangement needs. */
  arrange(saved: SavedIdList): Arranged | null;
  bunchIds(a: Arranged): string[];
}

const numberFields = (saved: SavedIdList): Arranged["numbers"] => {
  const c = toTransposedOmit(saved);
  return {
    startCounterIndexes: { values: c.startCounterIndexes, signed: false },
    startCounters: { values: c.startCounters, signed: false },
    counts: { values: c.counts, signed: true },
  };
};
export const restore = (a: Arranged, bunchIds: string[]): SavedIdList =>
  fromTransposedOmit({
    bunchIds,
    startCounterIndexes: a.numbers.startCounterIndexes.values,
    startCounters: a.numbers.startCounters.values,
    counts: a.numbers.counts.values,
  });

const idPerRun: Arrangement = {
  id: "id-per-run",
  label: "Full ID on every run",
  arrange: (saved) => ({
    strings: { bunchIds: saved.map((r) => r.bunchId) },
    numbers: numberFields(saved),
  }),
  bunchIds: (a) => a.strings.bunchIds,
};

const idOnce: Arrangement = {
  id: "id-once",
  label: "Each distinct ID once + back-reference per run",
  arrange(saved) {
    const index = new Map<string, number>();
    const uniqueIds: string[] = [],
      idRefs: number[] = [];
    for (const r of saved) {
      const i = index.get(r.bunchId);
      if (i === undefined) {
        index.set(r.bunchId, index.size);
        uniqueIds.push(r.bunchId);
        idRefs.push(0);
      } else idRefs.push(index.size - i);
    }
    return {
      strings: { uniqueIds },
      numbers: {
        idRefs: { values: idRefs, signed: false },
        ...numberFields(saved),
      },
    };
  },
  bunchIds(a) {
    let seen = 0;
    const unique = a.strings.uniqueIds;
    return a.numbers.idRefs.values.map((k) =>
      k === 0 ? unique[seen++] : unique[seen - k],
    );
  },
};

const clientCounterNumbers: Arrangement = {
  id: "client-counter-numbers",
  label: "Client IDs once + per-run client index and counter change",
  arrange(saved) {
    const clients = new Map<string, number>(),
      last: number[] = [];
    const clientIds: string[] = [],
      clientIndexes: number[] = [],
      counterChanges: number[] = [];
    for (const r of saved) {
      const parsed = parseClientCounterId(r.bunchId);
      if (!parsed) return null;
      const [client, counter] = parsed;
      let c = clients.get(client);
      if (c === undefined) {
        c = clients.size;
        clients.set(client, c);
        clientIds.push(client);
        last.push(0);
      }
      // 1-based, matching CompactIdSavedIdListMessage (0 = raw-ID fallback).
      clientIndexes.push(c + 1);
      counterChanges.push(counter - last[c]);
      last[c] = counter;
    }
    return {
      strings: { clientIds },
      numbers: {
        clientIndexes: { values: clientIndexes, signed: false },
        counterChanges: { values: counterChanges, signed: true },
        ...numberFields(saved),
      },
    };
  },
  bunchIds(a) {
    const clients = a.strings.clientIds;
    const last = clients.map(() => 0);
    const changes = a.numbers.counterChanges.values;
    return a.numbers.clientIndexes.values.map(
      (k, i) => `${clients[k - 1]}_${(last[k - 1] += changes[i]).toString(36)}`,
    );
  },
};

export const arrangements = [idPerRun, idOnce, clientCounterNumbers];

export interface Encoding {
  id: string;
  label: string;
  encode(a: Arranged): unknown;
  decode(state: unknown, like: Arranged): Arranged;
}
const fieldNames = (like: Arranged) => ({
  strings: Object.keys(like.strings),
  numbers: Object.keys(like.numbers),
});
function perField(
  id: string,
  label: string,
  pack: (values: number[], signed: boolean) => unknown,
  unpack: (value: unknown, signed: boolean) => number[],
  strings: {
    pack(values: string[]): unknown;
    unpack(value: unknown): string[];
  } = { pack: (values) => values, unpack: (value) => value as string[] },
): Encoding {
  return {
    id,
    label,
    encode: (a) => ({
      ...Object.fromEntries(
        Object.entries(a.strings).map(([k, v]) => [k, strings.pack(v)]),
      ),
      ...Object.fromEntries(
        Object.entries(a.numbers).map(([k, v]) => [
          k,
          pack(v.values, v.signed),
        ]),
      ),
    }),
    decode(state, like) {
      const doc = state as Document;
      const names = fieldNames(like);
      return {
        strings: Object.fromEntries(
          names.strings.map((k) => [k, strings.unpack(doc[k])]),
        ),
        numbers: Object.fromEntries(
          names.numbers.map((k) => [
            k,
            {
              values: unpack(doc[k], like.numbers[k].signed),
              signed: like.numbers[k].signed,
            },
          ]),
        ),
      };
    },
  };
}
/** Comma-separated decimal text, e.g. [3, 0, -1] -> "3,0,-1". */
const joinNumbers = (values: number[]) => values.join(",");
const splitNumbers = (value: unknown) =>
  value === "" ? [] : (value as string).split(",").map(Number);
/** Comma-separated IDs. Each ID stays its own entry; no fixed length assumed. */
const joinIds = (values: string[]) => {
  assert(values.every((v) => v !== "" && !v.includes(",")));
  return values.join(",");
};
const splitIds = (value: unknown) =>
  value === "" ? [] : (value as string).split(",");
const binaryBytes = (value: unknown) => {
  assert(value instanceof Binary);
  return value.value();
};
export const encodings: Encoding[] = [
  perField(
    "plain",
    "Plain BSON arrays",
    (values) => values,
    (value) => value as number[],
  ),
  perField(
    "float64",
    "Float64 Binary per number field",
    (values) => packFloat64(values),
    (value) => [...readFloat64(value as Binary)],
  ),
  perField(
    "varint",
    "Varint Binary per number field",
    (values, signed) =>
      new Binary(signed ? packSintVarints(values) : packUintVarints(values)),
    (value, signed) =>
      signed
        ? readSintVarints(binaryBytes(value))
        : readUintVarints(binaryBytes(value)),
  ),
  perField(
    "string",
    "Number arrays as comma-separated strings",
    joinNumbers,
    splitNumbers,
  ),
  perField(
    "string-all",
    "Every array as a comma-separated string",
    joinNumbers,
    splitNumbers,
    { pack: joinIds, unpack: splitIds },
  ),
  {
    id: "protobuf",
    label: "One protobuf blob",
    encode(a) {
      const w = new VarintWriter();
      const encoder = new TextEncoder();
      let field = 1;
      for (const values of Object.values(a.strings)) {
        for (const s of values) w.string(field, encoder.encode(s));
        field++;
      }
      for (const { values, signed } of Object.values(a.numbers))
        w.field(
          field++,
          signed ? packSintVarints(values) : packUintVarints(values),
        );
      return new Binary(w.finish());
    },
    decode(state, like) {
      const bytes = binaryBytes(state);
      const names = fieldNames(like);
      const out: Arranged = { strings: {}, numbers: {} };
      names.strings.forEach((k) => (out.strings[k] = []));
      names.numbers.forEach(
        (k) =>
          (out.numbers[k] = { values: [], signed: like.numbers[k].signed }),
      );
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const r = new VarintReader(bytes);
      while (r.pos < bytes.length) {
        const tag = r.uint();
        assert.equal(tag & 7, 2);
        const len = r.uint(),
          start = r.pos,
          end = start + len;
        const n = (tag >>> 3) - 1;
        if (n < names.strings.length)
          out.strings[names.strings[n]].push(
            decoder.decode(bytes.subarray(start, end)),
          );
        else {
          const k = names.numbers[n - names.strings.length];
          const f = out.numbers[k];
          f.values.push(
            ...(f.signed
              ? readSintVarints(bytes, start, end)
              : readUintVarints(bytes, start, end)),
          );
        }
        r.pos = end;
      }
      return out;
    },
  },
];

/**
 * Random 8-character IDs, as in the Mongo/browser benchmarks. Pass a document
 * number to get an independent renaming per Mongo document.
 */
export function opaque(saved: SavedIdList, document?: number): SavedIdList {
  const names = new Map<string, string>(),
    used = new Set<string>();
  const salt = document === undefined ? "" : `${document}:`;
  return saved.map((r) => {
    let id = names.get(r.bunchId);
    if (id === undefined) {
      id = createHash("sha256")
        .update(`opaque8:${salt}${r.bunchId}`)
        .digest("base64url")
        .slice(0, 8);
      assert(!used.has(id), "Whole-ID hash collision");
      names.set(r.bunchId, id);
      used.add(id);
    }
    return { ...r, bunchId: id };
  });
}
/** Split one client's bunches across 4 clients, in blocks of 250 creations. */
export function fourClients(saved: SavedIdList): SavedIdList {
  const clients = ["Qm3xT9vKpa", "7hLw2ZcRne", "bY8sUf4GjD", "Kt5oV1iXq0"];
  return saved.map((r) => {
    const [, seq] = parseClientCounterId(r.bunchId)!;
    const block = Math.floor(seq / 250);
    return {
      ...r,
      bunchId: `${clients[block % 4]}_${(Math.floor(block / 4) * 250 + (seq % 250)).toString(36)}`,
    };
  });
}
