# Saved-state matrix: real MongoDB sizes

These are **real on-disk sizes from MongoDB 8.0.23 (WiredTiger)**, not compression estimates. Each proposal was written to its own collection, compacted and checkpointed, and then the collection's `.wt` file was measured. The codes are the same as in [saved-state-matrix.md](saved-state-matrix.md). This adds one new encoding, `JSON`, which stores every array as a JSON array string.

The document is the same canonical saved state as before: 11,757 runs and 5,382 distinct IDs.

## The `JSON` encoding

**`COL-CC-JSON`: every array stored as a JSON array string.** This uses the Columns arrangement with `client_counter` IDs and the same small example as [saved-state-matrix.md](saved-state-matrix.md):

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

`JsonList` is a small Ecto type: `dump` calls `Jason.encode!/1` and `load` calls `Jason.decode!/1`.

**`SPLIT-CC-JSON`** stores the Split IDs fields the same way:

```json
{
  "clientIds": "[\"Qm3xT9vKpa\",\"7hLw2ZcRne\"]",
  "clientIndexes": "[1,1,2,1]",
  "counterChanges": "[0,0,0,1]",
  "startCounterIndexes": "[2,1]",
  "startCounters": "[20,8]",
  "counts": "[3,-2,1,2]"
}
```

## Real Mongo size per saved state

The table shows KB on disk per document for both of Mongo's compressors. Mongo and Atlas use snappy unless a collection is created with zstd. "Raw" is the uncompressed BSON document (`avgObjSize`).

| Cell ID         | IDs              | Arrangement          | Encoding           | Raw | **zstd on disk** | **snappy on disk** |
| --------------- | ---------------- | -------------------- | ------------------ | --: | ---------------: | -----------------: |
| `SPLIT-CC-VAR`  | `client_counter` | Split IDs            | Varint per field   |  39 |          20.8 \* |            29.0 \* |
| `SPLIT-CC-PB`   | `client_counter` | Split IDs            | One protobuf blob  |  39 |          20.8 \* |            29.0 \* |
| `SPLIT-CC-JSON` | `client_counter` | Split IDs            | JSON array strings |  96 |             24.9 |               41.1 |
| `COL-CC-PB`     | `client_counter` | Columns              | One protobuf blob  | 197 |             29.0 |               57.5 |
| `DEDUP-CC-PB`   | `client_counter` | Deduplicated columns | One protobuf blob  | 109 |             29.0 |               49.3 |
| `COL-CC-JSON`   | `client_counter` | Columns              | JSON array strings | 231 |             33.1 |               61.7 |
| `DEDUP-CC-JSON` | `client_counter` | Deduplicated columns | JSON array strings | 151 |             33.1 |               57.5 |
| `SPLIT-CC-F64`  | `client_counter` | Split IDs            | Float64 per field  | 282 |             33.1 |               57.5 |
| `COL-CC-VAR`    | `client_counter` | Columns              | Varint per field   | 304 |             49.4 |               94.5 |
| `COL-CC-F64`    | `client_counter` | Columns              | Float64 per field  | 386 |             53.5 |              106.8 |
| `COL-R-PB`      | Random 8 chars   | Columns              | One protobuf blob  | 130 |             61.7 |               82.2 |
| `COL-R-JSON`    | Random 8 chars   | Columns              | JSON array strings | 164 |             61.7 |               86.3 |
| `COL-R-VAR`     | Random 8 chars   | Columns              | Varint per field   | 237 |             74.0 |              123.2 |
| `COL-R-F64`     | Random 8 chars   | Columns              | Float64 per field  | 318 |             78.1 |              135.5 |
| `COL-CC-BSON`   | `client_counter` | Columns              | Plain BSON         | 410 |             78.1 |              162.4 |
| `OBJ-CC-BSON`   | `client_counter` | Objects              | Plain BSON         | 938 |             82.2 |              164.1 |
| `COL-R-BSON`    | Random 8 chars   | Columns              | Plain BSON         | 342 |            102.7 |              172.3 |
| `OBJ-R-BSON`    | Random 8 chars   | Objects (today)      | Plain BSON         | 871 |            110.9 |              196.9 |

The full set of 54 cells is in [results/saved-state-matrix-mongo-1/mongo.json](results/saved-state-matrix-mongo-1/mongo.json).

\* **`SPLIT-CC-VAR` and `SPLIT-CC-PB` use the one-document figures.** In the 100-document run they measured 7.2 KB (zstd) and 19.4 KB (snappy), which is too good to be real. Those documents are small enough for several to share a WiredTiger page, and all 100 are copies of one state with only the IDs renamed, so Mongo compresses each copy against its neighbours. A collection holding one document can't do that. Its file minus the fixed file overhead of about 16.1 KB gives 20.8 KB (zstd) and 29.0 KB (snappy). That matches the earlier per-document estimate of 19.7 KB. For every other cell, the one-document figure, minus that same 16.1 KB, matches the 100-document figure. Raw output: [results/saved-state-matrix-mongo-1doc/mongo.json](results/saved-state-matrix-mongo-1doc/mongo.json).

## What it shows

- **JSON strings cut today's size by more than half.** `COL-CC-JSON` is 33.1 KB with zstd, against 82.2 KB for `OBJ-CC-BSON`. That is close to the protobuf blob `COL-CC-PB` at 29.0 KB. Most of the saving comes from turning 11,757 ID strings from a BSON array into one string, which drops BSON's per-element overhead.
- **`SPLIT-CC-JSON` is the smallest readable option: 24.9 KB with zstd and 41.1 KB with snappy.** It is close to `SPLIT-CC-VAR` (20.8 and 29.0 KB), and what Mongo stores is still plain JSON. The gap is wider with snappy, because snappy squeezes decimal text less well than zstd does.
- **With random IDs, JSON matches protobuf with zstd.** `COL-R-JSON` and `COL-R-PB` are both 61.7 KB.
- **The estimates were close.** The earlier zstd estimates were `COL-R-JSON` 57.6, `COL-CC-JSON` 30.1 and `SPLIT-CC-JSON` 23.3 KB. The real figures are 2 to 4 KB higher.
- **Sizes move in 4 KB steps.** WiredTiger stores each of these documents in whole 4 KB blocks, which is why so many cells tie exactly. A difference smaller than about 4 KB doesn't show up on disk. Snappy figures for the larger cells can also shift by a few blocks from run to run. `COL-CC-BSON` was 147.7 KB in an earlier run and 162.4 KB in this one.

## How it was run

This ran in a Linux cloud container, with MongoDB 8.0.23 installed through mise (`mise install mongodb@8.0`) and a new, empty dbpath:

```sh
mongod --dbpath /tmp/articulated-saved-state-matrix-json-100 --port 27186 --bind_ip 127.0.0.1 --fork --logpath /tmp/articulated-saved-state-matrix-json-100.log
cd benchmarks
SAVED_STATE_MATRIX_DBPATH=/tmp/articulated-saved-state-matrix-json-100 \
SAVED_STATE_MATRIX_MONGO_OUTPUT=saved-state-matrix-mongo-1 \
TSX_TSCONFIG_PATH=tsconfig.dev.json \
node --import tsx src/browser/saved-state-matrix-mongo.ts
```

The one-document run is the same command with `SAVED_STATE_MATRIX_DOCUMENTS=1`, a second new dbpath and `SAVED_STATE_MATRIX_MONGO_OUTPUT=saved-state-matrix-mongo-1doc`. Before measuring, every stored state was decoded and checked against the original.
