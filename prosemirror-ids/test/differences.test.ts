// The two places where the patch gives a different IdList than the reference, on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schema } from "prosemirror-schema-basic";
import { EditorState, Transaction } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { generator, idsOf, seedIds } from "../src/pm-ids-patch";
import { referenceApply, referenceSeed } from "../src/reference";
import { expand, makeGenerator } from "./helpers";

const hi = () => seedIds(schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hi")])]));

test("paragraph -> heading: patch keeps the block's ids, reference replaces them", () => {
  generator.current = makeGenerator("p");
  let state = EditorState.create({ doc: hi() });
  let ref = referenceSeed(state.doc);
  const tr = state.tr.setBlockType(1, 1, schema.nodes.heading, { level: 1 });
  ref = referenceApply(ref, tr, makeGenerator("r"));
  state = state.apply(tr);
  assert.equal(state.doc.toString(), 'doc(heading("hi"))');
  assert.deepEqual(expand(idsOf(state.doc)!), ["init:0", "init:1", "init:2", "init:3"]);
  // Reference: <p> and </p> become tombstones and <h1>, </h1> get new ids (ranges run back to front, so </h1> is minted first).
  assert.deepEqual(expand(ref), ["r1:0", "init:0 (deleted)", "init:1", "init:2", "r0:0", "init:3 (deleted)"]);
});

test("undo: patch brings back the deleted ids, reference mints new ones", () => {
  generator.current = makeGenerator("p");
  const refGen = makeGenerator("r");
  let state = EditorState.create({ doc: hi(), plugins: [history()] });
  let ref = referenceSeed(state.doc);
  const run = (tr: Transaction) => { ref = referenceApply(ref, tr, refGen); state = state.apply(tr); };
  run(state.tr.delete(1, 3));
  undo(state, run);
  assert.equal(state.doc.textContent, "hi");
  assert.deepEqual(expand(idsOf(state.doc)!), ["init:0", "init:1", "init:2", "init:3"]);
  assert.deepEqual(expand(ref), ["init:0", "r0:0", "r0:1", "init:1 (deleted)", "init:2 (deleted)", "init:3"]);
  redo(state, run);
  assert.equal(state.doc.textContent, "");
  assert.deepEqual(expand(idsOf(state.doc)!), ["init:0", "init:1 (deleted)", "init:2 (deleted)", "init:3"]);
});
