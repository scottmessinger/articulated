# Saved-state matrix: real MongoDB sizes

This page gives **real on-disk sizes from MongoDB 8.0.23 (WiredTiger)** for every way of storing an articulated saved state that we've compared. They aren't compression estimates. Each proposal was written to its own collection, compacted and checkpointed, and then the collection's `.wt` file was measured. Every stored state was decoded and checked against the original first.

The test document is the canonical saved state: 11,757 runs and 5,382 distinct IDs.

## How to read the codes

Each proposal has a code made of three parts, **arrangement-IDs-encoding**. For example, `SPLIT-CC-JSON` means Split IDs, `client_counter` IDs, JSON array strings.

- **Arrangement (what is stored):** `OBJ` Objects (today), `COL` Columns, `DEDUP` Deduplicated columns, `SPLIT` Split IDs.
- **IDs (what the IDs look like):** `R` random 8 characters, such as `aB3dE5fG`. `CC` `client_counter`, such as `Qm3xT9vKpa_0`, which is a random client ID per editor session plus a base-36 counter.
- **Encoding (how fields become bytes in Mongo):** `BSON` plain BSON arrays, `F64` Float64 Binary per number field, `VAR` varint Binary per number field, `JSON` every array as a JSON array string, `PB` one protobuf blob for the whole state.

Every example below uses the same tiny saved state: four runs, the second deleted, and the third and fourth with non-obvious start counters (20 and 8).

## Results: KB on disk per saved state

Mongo and Atlas compress with snappy unless a collection is created with zstd, so both are shown. "Raw BSON" is the uncompressed document (`avgObjSize`). The table is sorted by zstd size.

|   # | Cell ID         | IDs              | Arrangement          | Encoding           | Raw BSON | **zstd on disk** | **snappy on disk** |
| --: | --------------- | ---------------- | -------------------- | ------------------ | -------: | ---------------: | -----------------: |
|   1 | `SPLIT-CC-PB`   | `client_counter` | Split IDs            | One protobuf blob  |       39 |          20.8 \* |            29.0 \* |
|   2 | `SPLIT-CC-VAR`  | `client_counter` | Split IDs            | Varint per field   |       39 |          20.8 \* |            29.0 \* |
|   3 | `SPLIT-CC-JSON` | `client_counter` | Split IDs            | JSON array strings |       96 |             24.9 |               41.1 |
|   4 | `DEDUP-CC-PB`   | `client_counter` | Deduplicated columns | One protobuf blob  |      109 |             29.0 |               49.3 |
|   5 | `COL-CC-PB`     | `client_counter` | Columns              | One protobuf blob  |      197 |             29.0 |               57.5 |
|   6 | `DEDUP-CC-JSON` | `client_counter` | Deduplicated columns | JSON array strings |      151 |             33.1 |               57.5 |
|   7 | `SPLIT-CC-F64`  | `client_counter` | Split IDs            | Float64 per field  |      282 |             33.1 |               57.5 |
|   8 | `COL-CC-JSON`   | `client_counter` | Columns              | JSON array strings |      231 |             33.1 |               61.7 |
|   9 | `DEDUP-CC-VAR`  | `client_counter` | Deduplicated columns | Varint per field   |      157 |             37.2 |               69.8 |
|  10 | `DEDUP-CC-F64`  | `client_counter` | Deduplicated columns | Float64 per field  |      320 |             49.4 |               90.3 |
|  11 | `COL-CC-VAR`    | `client_counter` | Columns              | Varint per field   |      304 |             49.4 |               94.5 |
|  12 | `COL-CC-F64`    | `client_counter` | Columns              | Float64 per field  |      386 |             53.5 |              106.8 |
|  13 | `DEDUP-R-PB`    | Random 8 chars   | Deduplicated columns | One protobuf blob  |       78 |             57.6 |               82.2 |
|  14 | `COL-R-PB`      | Random 8 chars   | Columns              | One protobuf blob  |      130 |             61.7 |               82.2 |
|  15 | `COL-R-JSON`    | Random 8 chars   | Columns              | JSON array strings |      164 |             61.7 |               86.3 |
|  16 | `DEDUP-R-JSON`  | Random 8 chars   | Deduplicated columns | JSON array strings |      120 |             61.7 |               86.3 |
|  17 | `DEDUP-R-VAR`   | Random 8 chars   | Deduplicated columns | Varint per field   |      126 |             65.8 |               94.5 |
|  18 | `DEDUP-R-F64`   | Random 8 chars   | Deduplicated columns | Float64 per field  |      289 |             74.0 |              119.1 |
|  19 | `COL-R-VAR`     | Random 8 chars   | Columns              | Varint per field   |      237 |             74.0 |              123.2 |
|  20 | `COL-R-F64`     | Random 8 chars   | Columns              | Float64 per field  |      318 |             78.1 |              135.5 |
|  21 | `COL-CC-BSON`   | `client_counter` | Columns              | Plain BSON arrays  |      410 |             78.1 |              162.4 |
|  22 | `SPLIT-CC-BSON` | `client_counter` | Split IDs            | Plain BSON arrays  |      355 |             78.1 |              184.5 |
|  23 | `OBJ-CC-BSON`   | `client_counter` | Objects              | Plain BSON arrays  |      938 |             82.2 |              164.1 |
|  24 | `DEDUP-CC-BSON` | `client_counter` | Deduplicated columns | Plain BSON arrays  |      369 |             90.4 |              172.3 |
|  25 | `COL-R-BSON`    | Random 8 chars   | Columns              | Plain BSON arrays  |      342 |            102.7 |              172.3 |
|  26 | `OBJ-R-BSON`    | Random 8 chars   | Objects (today)      | Plain BSON arrays  |      871 |            110.9 |              196.9 |
|  27 | `DEDUP-R-BSON`  | Random 8 chars   | Deduplicated columns | Plain BSON arrays  |      338 |            115.0 |              196.9 |

\* **`SPLIT-CC-VAR` and `SPLIT-CC-PB` use the one-document figures.** In the 100-document run they measured 7.2 KB (zstd) and 19.4 KB (snappy), which is too good to be real. Those documents are small enough for several to share a WiredTiger page, and all 100 are copies of one state with only the IDs renamed, so Mongo compresses each copy against its neighbours. A collection holding one document can't do that. Its file minus the fixed file overhead of about 16.1 KB gives 20.8 KB (zstd) and 29.0 KB (snappy). That matches the earlier per-document estimate of 19.7 KB. For every other cell, the one-document figure minus that same 16.1 KB matches the 100-document figure.

## What it shows

- **The smallest options are `SPLIT-CC-VAR` and `SPLIT-CC-PB`, at 20.8 KB with zstd and 29.0 KB with snappy.** That's about a fifth of today's `OBJ-R-BSON` (110.9 and 196.9 KB).
- **`SPLIT-CC-JSON` is the smallest option that is still plain, readable JSON in Mongo, at 24.9 KB with zstd and 41.1 KB with snappy.** It costs about 4 KB more than varint with zstd and 12 KB more with snappy, because snappy squeezes decimal text less well than zstd does.
- **JSON strings beat BSON arrays everywhere.** `COL-CC-JSON` is 33.1 KB with zstd, against 78.1 KB for `COL-CC-BSON`. Most of the saving comes from storing the 11,757 ID strings as one string, which drops BSON's 16 to 20 bytes of overhead per element (see the appendix).
- **With random IDs, JSON matches protobuf with zstd.** `COL-R-JSON` and `COL-R-PB` are both 61.7 KB.
- **`client_counter` IDs matter more than the encoding.** Every `CC` row beats the matching `R` row, and Split IDs only works with `CC` IDs.
- **Sizes move in 4 KB steps.** WiredTiger stores each of these documents in whole 4 KB blocks, which is why many cells tie exactly. A difference under about 4 KB doesn't show up on disk. Snappy figures for the larger cells can also shift by a few blocks from run to run. For example, `COL-CC-BSON` was 147.7 KB in an earlier run and 162.4 KB in this one.

## The arrangements, as JSON

These show the app's view of the state, before encoding.

**`OBJ`: Objects (today).** One object per run.

```json
[
  {
    "bunchId": "Qm3xT9vKpa_0",
    "startCounter": 0,
    "count": 3,
    "isDeleted": false
  },
  {
    "bunchId": "Qm3xT9vKpa_0",
    "startCounter": 3,
    "count": 2,
    "isDeleted": true
  },
  {
    "bunchId": "7hLw2ZcRne_0",
    "startCounter": 20,
    "count": 1,
    "isDeleted": false
  },
  {
    "bunchId": "Qm3xT9vKpa_1",
    "startCounter": 8,
    "count": 2,
    "isDeleted": false
  }
]
```

**`COL`: Columns.** One list per field, with the full ID on every run. Negative counts mean deleted, and only the non-obvious start counters are kept.

```json
{
  "bunchIds": ["Qm3xT9vKpa_0", "Qm3xT9vKpa_0", "7hLw2ZcRne_0", "Qm3xT9vKpa_1"],
  "startCounterIndexes": [2, 1],
  "startCounters": [20, 8],
  "counts": [3, -2, 1, 2]
}
```

**`DEDUP`: Deduplicated columns.** Each distinct ID is stored once. For each run, `idRefs` holds 0 for a new ID, or how many IDs back to look.

```json
{
  "uniqueIds": ["Qm3xT9vKpa_0", "7hLw2ZcRne_0", "Qm3xT9vKpa_1"],
  "idRefs": [0, 1, 0, 0],
  "startCounterIndexes": [2, 1],
  "startCounters": [20, 8],
  "counts": [3, -2, 1, 2]
}
```

**`SPLIT`: Split IDs (`client_counter` IDs only).** Each client ID is stored once. Each run stores which client it belongs to (1-based) and how far that client's counter moved since its previous run.

```json
{
  "clientIds": ["Qm3xT9vKpa", "7hLw2ZcRne"],
  "clientIndexes": [1, 1, 2, 1],
  "counterChanges": [0, 0, 0, 1],
  "startCounterIndexes": [2, 1],
  "startCounters": [20, 8],
  "counts": [3, -2, 1, 2]
}
```

## The encodings: Ecto schema and what Mongo stores

Each encoding is shown for Columns (`COL`), plus Split IDs (`SPLIT`) where that helps. In every case the app and the browser still get the Columns JSON above. Only what Mongo stores changes.

### `BSON`: plain BSON arrays

```elixir
embedded_schema do
  field :bunch_ids, {:array, :string}, source: :bunchIds, default: []
  field :start_counter_indexes, {:array, :integer}, source: :startCounterIndexes, default: []
  field :start_counters, {:array, :integer}, source: :startCounters, default: []
  field :counts, {:array, :integer}, default: []
end
```

Mongo stores exactly the Columns JSON above, with arrays as BSON arrays.

### `F64`: Float64 Binary per number field (PR #34's type)

```elixir
embedded_schema do
  field :bunch_ids, {:array, :string}, source: :bunchIds, default: []
  field :start_counter_indexes, Float64Array, source: :startCounterIndexes, default: []
  field :start_counters, Float64Array, source: :startCounters, default: []
  field :counts, Float64Array, default: []
end
```

```js
counts: Binary.createFromBase64(
  "AAAAAAAACEAAAAAAAAAAwAAAAAAAAPA/AAAAAAAAAEA=",
  0,
); // 32 bytes
```

### `VAR`: varint Binary per number field

`UintVarintArray` and `SintVarintArray` are drop-in replacements for `Float64Array`, with the same safe-integer checks. A small number takes 1 byte instead of 8.

```elixir
embedded_schema do
  field :bunch_ids, {:array, :string}, source: :bunchIds, default: []
  field :start_counter_indexes, UintVarintArray, source: :startCounterIndexes, default: []
  field :start_counters, UintVarintArray, source: :startCounters, default: []
  field :counts, SintVarintArray, default: []
end
```

```js
counts: Binary.createFromBase64("BgMCBA==", 0); // 4 bytes
```

For **`SPLIT-CC-VAR`**:

```elixir
embedded_schema do
  field :client_ids, {:array, :string}, source: :clientIds, default: []
  field :client_indexes, UintVarintArray, source: :clientIndexes, default: []
  field :counter_changes, SintVarintArray, source: :counterChanges, default: []
  field :start_counter_indexes, UintVarintArray, source: :startCounterIndexes, default: []
  field :start_counters, UintVarintArray, source: :startCounters, default: []
  field :counts, SintVarintArray, default: []
end

# bunch_ids -> {client_ids, client_indexes, counter_changes, raw_ids}
SavedIdListCompactProto.split_ids(bunch_ids)
# and back:
SavedIdListCompactProto.join_ids(client_ids, client_indexes, counter_changes, raw_ids)
```

```js
state: {
  clientIds: ["Qm3xT9vKpa", "7hLw2ZcRne"],
  clientIndexes: Binary.createFromBase64("AQECAQ==", 0),
  counterChanges: Binary.createFromBase64("AAAAAg==", 0),
  startCounterIndexes: Binary.createFromBase64("AgE=", 0),
  startCounters: Binary.createFromBase64("FAg=", 0),
  counts: Binary.createFromBase64("BgMCBA==", 0)
}
```

### `JSON`: every array as a JSON array string

`JsonList` is a small Ecto type: `dump` calls `Jason.encode!/1` and `load` calls `Jason.decode!/1`.

```elixir
embedded_schema do
  field :bunch_ids, JsonList, source: :bunchIds, default: []
  field :start_counter_indexes, JsonList, source: :startCounterIndexes, default: []
  field :start_counters, JsonList, source: :startCounters, default: []
  field :counts, JsonList, default: []
end
```

For **`COL-CC-JSON`**, Mongo stores:

```js
state: {
  bunchIds: '["Qm3xT9vKpa_0","Qm3xT9vKpa_0","7hLw2ZcRne_0","Qm3xT9vKpa_1"]',
  startCounterIndexes: "[2,1]",
  startCounters: "[20,8]",
  counts: "[3,-2,1,2]"
}
```

For **`SPLIT-CC-JSON`**, the same `JsonList` type goes on each Split IDs field (`client_ids`, `client_indexes`, `counter_changes`, `start_counter_indexes`, `start_counters`, `counts`), with the same `split_ids` and `join_ids` helpers as `SPLIT-CC-VAR`:

```js
state: {
  clientIds: '["Qm3xT9vKpa","7hLw2ZcRne"]',
  clientIndexes: "[1,1,2,1]",
  counterChanges: "[0,0,0,1]",
  startCounterIndexes: "[2,1]",
  startCounters: "[20,8]",
  counts: "[3,-2,1,2]"
}
```

For **`DEDUP-CC-JSON`**, `uniqueIds` and `idRefs` become JSON strings in the same way.

### `PB`: one protobuf blob

`state` is a single field, and the Ecto type converts the whole map. For `COL-R-PB` and `COL-CC-PB` the type is `SavedIdListProto` (PR #30's layout with 64-bit numbers). For `SPLIT-CC-PB` it is `SavedIdListCompactProto`, which also keeps any ID that isn't `client_counter` as text.

```elixir
# Inside the existing Document schema; the app reads and writes the Columns map:
field :state, SavedIdListCompactProto
```

```js
state: Binary.createFromBase64(
  "CgpRbTN4VDl2S3BhCgo3aEx3MlpjUm5lEgQBAQIBGgQAAAACKgICATICFAg6BAYDAgQ=",
  0,
);
```

The blob fits only if nothing reads `state` outside Ecto, such as Mongo shell queries, aggregations or other services.

## How it was run

This ran in a Linux cloud container, with MongoDB 8.0.23 installed through mise (`mise install mongodb@8.0`). Each run used a new, empty dbpath and a local standalone `mongod`. Every cell gets its own collection per compressor, and the 100 documents in it are the canonical state with independently renamed IDs. The script runs `compact`, then an `fsync` checkpoint, `compact` again, and `fsync` with lock. Then it reads the `.wt` file length and checks it equals `storageSize`.

```sh
mongod --dbpath /tmp/articulated-saved-state-matrix-json-100 --port 27186 --bind_ip 127.0.0.1 --fork --logpath /tmp/articulated-saved-state-matrix-json-100.log
cd benchmarks
SAVED_STATE_MATRIX_DBPATH=/tmp/articulated-saved-state-matrix-json-100 \
SAVED_STATE_MATRIX_MONGO_OUTPUT=saved-state-matrix-mongo-1 \
TSX_TSCONFIG_PATH=tsconfig.dev.json \
node --import tsx src/browser/saved-state-matrix-mongo.ts
```

The one-document run is the same command with `SAVED_STATE_MATRIX_DOCUMENTS=1`, a second new dbpath and `SAVED_STATE_MATRIX_MONGO_OUTPUT=saved-state-matrix-mongo-1doc`. Raw output is in `results/saved-state-matrix-mongo-1/mongo.json` and `results/saved-state-matrix-mongo-1doc/mongo.json`.

## Appendix: bytes

**Float64 vs varint.** Float64 spends 8 bytes on every number, mostly zeros:

```
3  → 00 00 00 00 00 00 08 40
-2 → 00 00 00 00 00 00 00 c0
```

A varint spends 1 byte on a small number. Negatives are folded in first (3→6, -2→3, 1→2, 2→4), so `counts` is `06 03 02 04`. In the real document, 94% of counts are under 64 and take 1 byte. The largest, 1396, takes 2 bytes (`e8 15`).

**A string in a BSON array** costs about 16 to 20 bytes, because BSON stores an array as an object whose keys are `"0"`, `"1"`, `"2"`, …:

```
02            type: string
30 00         key "0"
09 00 00 00   length 9
61 42 33 64 45 35 66 47 00   "aB3dE5fG" + terminator
```

**The same IDs in a JSON string** cost the ID plus 3 bytes (two quotes and a comma): `"aB3dE5fG",`.

**A string in protobuf** costs its length plus 2 bytes:

```
0a        field 1
08        length 8
61 42 33 64 45 35 66 47   "aB3dE5fG"
```

**The `SPLIT-CC-PB` blob** for the example:

```
0a 0a 51 6d 33 78 54 39 76 4b 70 61   client "Qm3xT9vKpa"
0a 0a 37 68 4c 77 32 5a 63 52 6e 65   client "7hLw2ZcRne"
12 04 01 01 02 01                     clientIndexes [1, 1, 2, 1]
1a 04 00 00 00 02                     counterChanges [0, 0, 0, 1]
2a 02 02 01                           startCounterIndexes [2, 1]
32 02 14 08                           startCounters [20, 8]
3a 04 06 03 02 04                     counts [3, -2, 1, 2]
```
