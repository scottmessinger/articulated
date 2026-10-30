# Saved-state matrix: real MongoDB sizes

These are **real on-disk sizes from MongoDB 8.0.23 (WiredTiger)**, not compression estimates. Each proposal was written to its own collection, compacted, checkpointed, and then the collection's `.wt` file was measured. The codes are the same ones used in [saved-state-matrix.md](saved-state-matrix.md), plus three new encodings that store arrays as strings.

The document is the same canonical saved state as before: 11,757 runs and 5,382 distinct IDs.

## The three string encodings

Each one is shown here for the Columns arrangement with `client_counter` IDs (row `COL-CC`). The same small example as in [saved-state-matrix.md](saved-state-matrix.md) is used throughout.

**`COL-CC-STR`: number arrays as comma strings. IDs stay a BSON array.**

```json
{
  "bunchIds": ["Qm3xT9vKpa_0", "Qm3xT9vKpa_0", "7hLw2ZcRne_0", "Qm3xT9vKpa_1"],
  "startCounterIndexes": "2,1",
  "startCounters": "20,8",
  "counts": "3,-2,1,2"
}
```

```elixir
embedded_schema do
  field :bunch_ids, {:array, :string}, source: :bunchIds, default: []
  field :start_counter_indexes, CommaIntList, source: :startCounterIndexes, default: []
  field :start_counters, CommaIntList, source: :startCounters, default: []
  field :counts, CommaIntList, default: []
end
```

**`COL-CC-STRALL`: every array as a comma string, IDs included.** IDs are base64url plus `_`, so they never contain a comma. This is a separator, not the fixed-length join that PR #34 used.

```json
{
  "bunchIds": "Qm3xT9vKpa_0,Qm3xT9vKpa_0,7hLw2ZcRne_0,Qm3xT9vKpa_1",
  "startCounterIndexes": "2,1",
  "startCounters": "20,8",
  "counts": "3,-2,1,2"
}
```

```elixir
embedded_schema do
  field :bunch_ids, CommaStringList, source: :bunchIds, default: []
  field :start_counter_indexes, CommaIntList, source: :startCounterIndexes, default: []
  field :start_counters, CommaIntList, source: :startCounters, default: []
  field :counts, CommaIntList, default: []
end
```

**`COL-CC-JSON`: every array as a JSON array string.**

```json
{
  "bunchIds": "[\"Qm3xT9vKpa_0\",\"Qm3xT9vKpa_0\",\"7hLw2ZcRne_0\",\"Qm3xT9vKpa_1\"]",
  "startCounterIndexes": "[2,1]",
  "startCounters": "[20,8]",
  "counts": "[3,-2,1,2]"
}
```

```elixir
embedded_schema do
  field :bunch_ids, JsonList, source: :bunchIds, default: []
  field :start_counter_indexes, JsonList, source: :startCounterIndexes, default: []
  field :start_counters, JsonList, source: :startCounters, default: []
  field :counts, JsonList, default: []
end
```

For Split IDs (`SPLIT-CC-STR`, `SPLIT-CC-STRALL` and `SPLIT-CC-JSON`), the six Split IDs fields are stored the same way. `clientIds` stays an array in `STR` and becomes a string in `STRALL` and `JSON`. There are only a few client IDs, so all three come out the same size.

## Real Mongo size per saved state

The table shows KB on disk per document, for both of Mongo's compressors. Mongo and Atlas use snappy unless a collection is created with zstd. "Raw" is the uncompressed BSON document size (`avgObjSize`).

| Cell ID           | IDs              | Arrangement          | Encoding           | Raw | **zstd on disk** | **snappy on disk** |
| ----------------- | ---------------- | -------------------- | ------------------ | --: | ---------------: | -----------------: |
| `SPLIT-CC-VAR`    | `client_counter` | Split IDs            | Varint per field   |  39 |          20.8 \* |            29.0 \* |
| `SPLIT-CC-PB`     | `client_counter` | Split IDs            | One protobuf blob  |  39 |          20.8 \* |            29.0 \* |
| `SPLIT-CC-STR`    | `client_counter` | Split IDs            | Comma strings      |  96 |             24.9 |               41.1 |
| `SPLIT-CC-STRALL` | `client_counter` | Split IDs            | All comma strings  |  96 |             24.9 |               41.1 |
| `SPLIT-CC-JSON`   | `client_counter` | Split IDs            | JSON array strings |  96 |             24.9 |               41.1 |
| `COL-CC-PB`       | `client_counter` | Columns              | One protobuf blob  | 197 |             29.0 |               57.6 |
| `DEDUP-CC-PB`     | `client_counter` | Deduplicated columns | One protobuf blob  | 109 |             29.0 |               49.3 |
| `COL-CC-STRALL`   | `client_counter` | Columns              | All comma strings  | 208 |             33.1 |               61.7 |
| `COL-CC-JSON`     | `client_counter` | Columns              | JSON array strings | 231 |             33.1 |               61.7 |
| `SPLIT-CC-F64`    | `client_counter` | Split IDs            | Float64 per field  | 282 |             33.1 |               57.5 |
| `COL-CC-VAR`      | `client_counter` | Columns              | Varint per field   | 304 |             49.4 |               94.5 |
| `COL-CC-STR`      | `client_counter` | Columns              | Comma strings      | 326 |             49.4 |               98.6 |
| `COL-CC-F64`      | `client_counter` | Columns              | Float64 per field  | 386 |             53.5 |              106.8 |
| `COL-R-STRALL`    | Random 8 chars   | Columns              | All comma strings  | 140 |             57.6 |               82.2 |
| `COL-R-PB`        | Random 8 chars   | Columns              | One protobuf blob  | 130 |             61.7 |               82.2 |
| `COL-R-JSON`      | Random 8 chars   | Columns              | JSON array strings | 164 |             61.7 |               86.3 |
| `COL-R-VAR`       | Random 8 chars   | Columns              | Varint per field   | 237 |             74.0 |              135.5 |
| `COL-R-STR`       | Random 8 chars   | Columns              | Comma strings      | 258 |             74.0 |              127.3 |
| `COL-R-F64`       | Random 8 chars   | Columns              | Float64 per field  | 318 |             78.1 |              135.5 |
| `COL-CC-BSON`     | `client_counter` | Columns              | Plain BSON         | 410 |             78.1 |              147.7 |
| `OBJ-CC-BSON`     | `client_counter` | Objects              | Plain BSON         | 938 |             82.2 |              164.1 |
| `COL-R-BSON`      | Random 8 chars   | Columns              | Plain BSON         | 342 |            102.7 |              172.3 |
| `OBJ-R-BSON`      | Random 8 chars   | Objects (today)      | Plain BSON         | 871 |            110.9 |              196.9 |

The full set of 74 cells, including every `DEDUP` row, is in [results/saved-state-matrix-mongo-1/mongo.json](results/saved-state-matrix-mongo-1/mongo.json).

\* **`SPLIT-CC-VAR` and `SPLIT-CC-PB` use the one-document figures.** In the 100-document run they measured 7.2 KB (zstd) and 19.4 KB (snappy). That is too good to be real. Those documents are small enough for several to share a WiredTiger page, and all 100 are copies of one state with only the IDs renamed. Mongo then compresses each copy against its neighbours. A collection with only one document can't do that. Its file minus the fixed overhead of about 16.1 KB gives 20.8 KB (zstd) and 29.0 KB (snappy), which agrees with the earlier per-document estimate of 19.7 KB. For every other cell, the one-document and 100-document figures differ only by that same 16.1 KB, so the 100-document figures stand. Raw output: [results/saved-state-matrix-mongo-1doc/mongo.json](results/saved-state-matrix-mongo-1doc/mongo.json).

## What it shows

- **Strings work, and IDs as strings is the big win.** `COL-CC-STR` keeps IDs as a BSON array and only gets to 49.4 KB with zstd, the same as varint. Once the IDs are a string too, `COL-CC-STRALL` and `COL-CC-JSON` both reach 33.1 KB, close to the protobuf blob `COL-CC-PB` at 29.0 KB. That is less than half of today's `OBJ-CC-BSON` at 82.2 KB. The saving comes from dropping BSON's per-element overhead on 11,757 ID strings.
- **Comma strings vs JSON strings barely matters.** With `client_counter` IDs they come out exactly the same. With random IDs, JSON is one 4 KB step bigger because of the quotes around each ID (`COL-R-JSON` 61.7 vs `COL-R-STRALL` 57.6 KB with zstd).
- **Split IDs as strings: 24.9 KB with zstd, 41.1 KB with snappy.** That is close to `SPLIT-CC-VAR` (20.8 and 29.0 KB), and the stored data is still plain, readable Mongo strings. The gap is larger with snappy, because snappy squeezes decimal text less well than zstd does.
- **The estimates were close.** The earlier zstd estimates were `COL-R-STR` 73.2, `COL-R-STRALL` 55.2, `COL-R-JSON` 57.6, `COL-CC-STR` 48.4, `COL-CC-STRALL` 29.7, `COL-CC-JSON` 30.1 and `SPLIT-CC-*` 23.3 KB. The real numbers are 0 to 4 KB higher.
- **Sizes move in 4 KB steps.** WiredTiger stores each of these documents in whole 4 KB blocks, which is why so many cells tie exactly (for example `COL-R-VAR` and `COL-R-STR`, both 74.0 KB). A difference smaller than about 4 KB doesn't show up on disk.

## How it was run

In a Linux cloud container, with MongoDB 8.0.23 installed through mise (`mise install mongodb@8.0`) and a new empty dbpath:

```sh
mongod --dbpath /tmp/articulated-saved-state-matrix-1 --port 27186 --bind_ip 127.0.0.1 --fork --logpath /tmp/articulated-saved-state-matrix-1.log
cd benchmarks
SAVED_STATE_MATRIX_DBPATH=/tmp/articulated-saved-state-matrix-1 \
SAVED_STATE_MATRIX_MONGO_OUTPUT=saved-state-matrix-mongo-1 \
TSX_TSCONFIG_PATH=tsconfig.dev.json \
node --import tsx src/browser/saved-state-matrix-mongo.ts
```

The one-document run is the same command with `SAVED_STATE_MATRIX_DOCUMENTS=1`, a second new dbpath and `SAVED_STATE_MATRIX_MONGO_OUTPUT=saved-state-matrix-mongo-1doc`. Every stored state was decoded and checked against the original before it was measured.
