# prosemirror-ids

Articulated ids inside unforked ProseMirror, and tests that compare it with plain Articulated.

`src/pm-ids-patch.ts` is imported once. From then on every ProseMirror doc that a step produces carries an Articulated `IdList` with one id per position (list index = ProseMirror position). It wraps `Transform.addStep`, `Transform.maybeStep`, `ReplaceStep`/`ReplaceAroundStep` `invert` and `map`, and `Node.toJSON`/`fromJSON`, and adds `$pos.idBefore`, `$pos.idAfter`, `doc.idAt(pos)` and `doc.posOfId(id)`.

```sh
cd prosemirror-ids
npm install
npm test        # 45 tests, about 10 seconds
```

## What the tests check

| File | What it shows |
|---|---|
| `test/equivalence.test.ts` | **Same result as plain Articulated.** `src/reference.ts` keeps an `IdList` beside an unpatched ProseMirror the usual way: for each step, `deleteRange` the replaced tokens, then `insertAfter(left id, generator.generateAfter(left id, n), n)`. 20 seeds × 500 random edits (typing, delete, split, join, wrap, lift, marks, replace). After every transaction the patched doc's `IdList.save()`, expanded id by id, equals the reference's: same ids, same order, same tombstones. |
| `test/tombstones.test.ts` | **Deleted ids are kept.** Deleting "quick " leaves its 6 ids in the list marked deleted. After 2,000 random edits, every id ever created is still `isKnown`, and the list holds exactly those ids. `toJSON`/`fromJSON` keeps the tombstones. |
| `test/differences.test.ts` | **The two intended differences.** Paragraph → heading: the patch keeps all 4 ids; the reference tombstones `<p>`/`</p>` and mints 2 new ids. Undo of a delete: the patch undeletes the original ids; the reference mints new ones and leaves the old ones as tombstones. Redo deletes the same ids again. |
| `test/convergence.test.ts` | **Replicas agree.** 3 clients and a server, 4,000 random concurrent actions, server order, 8 seeds: every replica ends with an identical doc and identical `IdList`, tombstones included. Plus: A deletes "brown", B types "!" after it, A undoes → "quick brown! fox" on both, with brown's original ids. |
| `test/undo.test.ts` | **Undo with someone else editing.** Two editors take turns with random edits, undo and redo; each change goes to the other immediately and isn't part of the receiver's history. 10 seeds × 1,500 actions: identical docs and `IdList`s after every action. Of 1,311 runs of text that undo/redo brought back, 1,269 (97%) got their original ids back; the rest got new ids, identically on both sides. |

## Notes

- The insert rule matches Articulated's usual one: new ids go `insertAfter` the id on their left. When a concurrent insert sits right after that id, they go `insertBefore` the id on their right instead. Either way the choice depends only on the step and the list, so every replica makes the same one.
- `src/wire.ts` (send a step addressed by ids) and `test/sync.ts` (a minimal server loop) exist only for the multi-client tests. They are not part of the patch.
- `addStep` is `@internal` in prosemirror-transform; the patch depends on it.
- Pinned to articulated 1.3.2 (this repo's version) from npm.
