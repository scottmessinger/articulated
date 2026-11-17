# prosemirror-ids

Gives every ProseMirror document an [Articulated](../README.md) `IdList`: **one stable id per ProseMirror position**, kept up to date through every edit, including undo. No fork of ProseMirror; one file, [`src/pm-ids-patch.ts`](src/pm-ids-patch.ts), that you import once.

ProseMirror positions count tokens: a block's opening, each character, a block's closing. The `IdList` holds one id per token in the same order, so **a position is an index into the list**:

```
<p>hi</p>       position:   0       1       2       3
                token:      <p>     h       i       </p>
                id:         init:0  init:1  init:2  init:3
```

Type `!` at position 3 and the list becomes `init:0 init:1 init:2 alice:0 init:3`: the new character gets a new id, and every other token keeps its id even though its position moved. Deleted ids are never thrown away. They stay in the list as tombstones, so an id that was deleted can still be found, compared and restored.

## Install

Copy `src/pm-ids-patch.ts` into your app. It needs `articulated`, `prosemirror-model` and `prosemirror-transform` (whatever copies your editor already uses: the patch must modify the same `Transform` and `Node` classes your editor runs).

## Use

The full example is [`examples/usage.ts`](examples/usage.ts) (`npm run example`). Output is shown under each step.

**1. Import the patch once**, before any `EditorState` is created.

```ts
import { seedIds, idsOf, generator } from "./pm-ids-patch";
```

**2. Give each client its own id generator.** The function returns a new bunch id; use something unique per client, like a random string.

```ts
generator.current = new ElementIdGenerator(() => "alice");
```

**3. Give a brand-new doc its ids** with `seedIds`. A doc loaded from JSON that has `ids` already has them (step 6).

```ts
let state = EditorState.create({
  doc: seedIds(schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hi")])])),
  plugins: [history()],
});
// init:0 init:1 init:2 init:3
```

**4. Edit as usual.** Typing, commands, input rules, paste, undo: every change is a step, and the ids follow every step.

```ts
state = state.apply(state.tr.insertText("!", 3));
// init:0 init:1 init:2 alice:0 init:3

state = state.apply(state.tr.setBlockType(1, 1, schema.nodes.heading, { level: 1 }));
// init:0 init:1 init:2 alice:0 init:3          paragraph -> heading keeps the block's ids

state = state.apply(closeHistory(state.tr.delete(1, 3)));
// init:0 init:1(deleted) init:2(deleted) alice:0 init:3

undo(state, (tr) => (state = state.apply(tr)));
// init:0 init:1 init:2 alice:0 init:3          undo brings back the same ids
```

**5. Go between positions and ids.**

```ts
state.doc.idAt(3)                                   // { bunchId: "alice", counter: 0 }  token after position 3
state.doc.resolve(3).idBefore                       // { bunchId: "init", counter: 2 }   the "i"
state.doc.resolve(3).idAfter                        // { bunchId: "alice", counter: 0 }  the "!"
state.doc.posOfId({ bunchId: "alice", counter: 0 }) // 3   (-1 if deleted)
idsOf(state.doc)                                    // the Articulated IdList itself
```

**6. Save and load.** `doc.toJSON()` adds an `ids` field (Articulated's saved format, tombstones included); `Node.fromJSON` reads it back.

```ts
const json = state.doc.toJSON();
// { type: "doc", content: [...], ids: [{ bunchId: "init", startCounter: 0, count: 3, isDeleted: false },
//                                      { bunchId: "alice", startCounter: 0, count: 1, isDeleted: false },
//                                      { bunchId: "init", startCounter: 3, count: 1, isDeleted: false }] }
const loaded = Node.fromJSON(schema, json);         // same ids
```

**7. Apply a step whose ids were chosen elsewhere** (for example, the same edit made on another client): set `step.newIds` before applying it. One array per range in `step.getMap()`. After any local step, `step.newIds` holds the ids it created, so you can send them along with `step.toJSON()`.

```ts
const remote = new ReplaceStep(1, 1, new Slice(Fragment.from(schema.text("o")), 0, 0));
remote.newIds = [[{ bunchId: "bob", counter: 0 }]];
state = state.apply(state.tr.step(remote));
// init:0 bob:0 init:1 init:2 alice:0 init:3   "ohi!"
```

## API

| | |
|---|---|
| `seedIds(doc, ids?)` | Give a doc its `IdList`: the one you pass, or fresh ids `init:0…`. Returns the doc. |
| `idsOf(doc)` | The doc's Articulated `IdList`, or `undefined` if it has none. |
| `doc.idAt(pos)` | Id of the token right after `pos`. |
| `doc.posOfId(id)` | Position of the token with this id, or `-1` if it's deleted. |
| `$pos.idBefore` / `$pos.idAfter` | Ids of the tokens on either side of a `ResolvedPos`. `null` at the doc's edges. |
| `doc.toJSON()` | ProseMirror's JSON plus `ids`. |
| `Node.fromJSON(schema, json)` | Restores `ids` when present. |
| `generator.current` | The `ElementIdGenerator` used to create new ids. Set one per client. |
| `step.newIds` | Ids the step created (set after it's applied), or ids to use (set before). One array per `getMap()` range. |

## How it works

Every edit in ProseMirror is a `Step`, and every step goes through `Transform.prototype.addStep(step, newDoc)` (`Transaction` calls it via `super`). The patch wraps these methods:

| Method | What the wrapper does |
|---|---|
| `Transform.prototype.addStep` | Reads `step.getMap().ranges`, triples of `[start, oldSize, newSize]` that every step type reports. Back to front: `deleteRange(start, start + oldSize)` on the previous doc's list (the ids become tombstones), then inserts `newSize` ids: `step.newIds` if given, the undo ids if this is an undo, or new ones from `generator.current`. New ids go `insertAfter` the id on their left, as in plain Articulated. The new list is stored for the new doc in a `WeakMap<Node, IdList>`. Mark and attribute steps change no tokens, so ids don't change. |
| (same, `isRetype`) | `setBlockType` / `setNodeMarkup` produce a `ReplaceAroundStep` that swaps a block's two boundary tokens around an unchanged middle. The patch recognizes that shape and keeps the ids, so a paragraph turned heading is the same block. |
| `ReplaceStep` / `ReplaceAroundStep` `.invert` | prosemirror-history undoes a step by applying its inverse. The wrapper records on the inverse the ids the original step deleted, so the inverse undeletes them instead of minting new ones. |
| `ReplaceStep` / `ReplaceAroundStep` `.map` | History remaps the inverse over later edits; the wrapper copies those recorded ids onto the remapped step. |
| `Transform.prototype.maybeStep` | If an undo's re-insert would land next to its tombstones instead of on them (someone typed at that spot), it's applied where the tombstones are. |
| `Node.prototype.toJSON`, `Node.fromJSON` | Write and read `ids`. |

## Limits

- `addStep` is marked `@internal` in prosemirror-transform, so a future release could change it. A public per-step hook upstream would remove the need for the patch.
- A doc created without a step (`EditorState.create` with a new doc) needs `seedIds`, or JSON with `ids`.
- In the random tests, 97% of undone text gets its original ids back. The rest (some lifts and wraps, and undos remapped over remote edits) gets new ids, the same on every replica.

## Tests

`npm install && npm test`: 45 tests. They compare the patch with Articulated used the ordinary way: [`src/reference.ts`](src/reference.ts) keeps an `IdList` next to an unpatched ProseMirror with `deleteRange` + `insertAfter(left id)` per step.

| File | Checks |
|---|---|
| `test/equivalence.test.ts` | 20 seeds × 500 random edits: after every edit the patched list equals the reference list, same ids, same order, same tombstones. |
| `test/tombstones.test.ts` | Deleted ids stay as tombstones; after 2,000 random edits every id ever created is still in the list; JSON keeps tombstones. |
| `test/differences.test.ts` | The two intended differences: paragraph → heading keeps ids, undo restores ids. |
| `test/convergence.test.ts` | 3 clients + server, 8 seeds × 4,000 concurrent actions: identical docs and id lists everywhere. Uses `src/wire.ts` (sends steps addressed by ids), which is test support, not part of the patch. |
| `test/undo.test.ts` | Two editors with random edits, undo and redo, 10 seeds × 1,500 actions: identical after every action. |
