// Same edits, two ways: the patched ProseMirror vs. Articulated kept beside ProseMirror by hand.
// After every transaction the two IdLists must be identical, tombstones and their order included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { generator, idsOf, seedIds } from "../src/pm-ids-patch";
import { referenceApply, referenceSeed } from "../src/reference";
import { ALL_EDITS, expand, makeGenerator, randomEdit, rng, startDoc } from "./helpers";

// Changing block type is the one edit where the patch differs on purpose (see differences.test.ts).
const SAME_KINDS = ALL_EDITS.filter((k) => k !== "setBlockType");

test("small example: delete 'b' from 'abc', then type 'x' where it was", () => {
  generator.current = makeGenerator("p");
  const refGen = makeGenerator("p");
  const doc = seedIds(schema.node("doc", null, [schema.node("paragraph", null, [schema.text("abc")])]));
  let state = EditorState.create({ doc });
  let ref = referenceSeed(doc);
  for (const make of [(s: EditorState) => s.tr.delete(2, 3), (s: EditorState) => s.tr.insertText("x", 2)]) {
    const tr = make(state);
    ref = referenceApply(ref, tr, refGen);
    state = state.apply(tr);
  }
  assert.equal(state.doc.textContent, "axc");
  const expected = ["init:0", "init:1", "p0:0", "init:2 (deleted)", "init:3", "init:4"];
  assert.deepEqual(expand(idsOf(state.doc)!), expected);
  assert.deepEqual(expand(ref), expected);
});

for (let seed = 1; seed <= 20; seed++) {
  test(`random edits, seed ${seed}: patched IdList === reference IdList after every transaction`, () => {
    generator.current = makeGenerator("g");
    const refGen = makeGenerator("g");
    const r = rng(seed);
    let state = EditorState.create({ doc: seedIds(startDoc()) });
    let ref = referenceSeed(state.doc);
    let applied = 0;
    for (let i = 0; i < 500; i++) {
      const tr = randomEdit(state, r, SAME_KINDS);
      if (!tr) continue;
      ref = referenceApply(ref, tr, refGen);
      state = state.apply(tr);
      applied++;
      assert.equal(ref.length, state.doc.content.size, `reference out of sync at edit ${i}`);
      assert.deepEqual(expand(idsOf(state.doc)!), expand(ref), `IdLists differ after edit ${i}`);
    }
    assert.ok(applied > 300, `only ${applied} edits applied`);
  });
}
