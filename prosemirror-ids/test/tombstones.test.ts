// Deleted ids are never thrown away: they stay in the IdList as tombstones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Node } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { ElementId } from "articulated";
import { AnyStep, generator, idsOf, seedIds } from "../src/pm-ids-patch";
import { expand, makeGenerator, randomEdit, rng, startDoc } from "./helpers";

test("deleting 'quick ' keeps its six ids as tombstones", () => {
  let state = EditorState.create({ doc: seedIds(startDoc()) });
  const before = idsOf(state.doc)!;
  const deletedIds = [5, 6, 7, 8, 9, 10].map((pos) => before.at(pos));   // "quick " is positions 5..10
  state = state.apply(state.tr.delete(5, 11));
  assert.equal(state.doc.firstChild!.textContent, "The brown fox");
  const ids = idsOf(state.doc)!;
  for (const id of deletedIds) {
    assert.ok(ids.isKnown(id), "still in the list");
    assert.ok(!ids.has(id), "marked deleted");
  }
  assert.deepEqual(expand(ids).slice(0, 13), [
    "init:0", "init:1", "init:2", "init:3", "init:4",
    "init:5 (deleted)", "init:6 (deleted)", "init:7 (deleted)", "init:8 (deleted)", "init:9 (deleted)", "init:10 (deleted)",
    "init:11", "init:12",
  ]);
});

test("after 2,000 random edits every id ever created is still known", () => {
  generator.current = makeGenerator("t");
  const r = rng(42);
  let state = EditorState.create({ doc: seedIds(startDoc()) });
  const everCreated: ElementId[] = [];
  for (let i = 0; i < state.doc.content.size; i++) everCreated.push(idsOf(state.doc)!.at(i));
  for (let i = 0; i < 2000; i++) {
    const tr = randomEdit(state, r);
    if (!tr) continue;
    state = state.apply(tr);
    for (const step of tr.steps as AnyStep[]) for (const run of step.newIds ?? []) if (run) everCreated.push(...run);
  }
  const ids = idsOf(state.doc)!;
  for (const id of everCreated) assert.ok(ids.isKnown(id), `${id.bunchId}:${id.counter} was lost`);
  assert.equal(expand(ids).length, everCreated.length, "list holds exactly the ids ever created");
  assert.ok(expand(ids).some((s) => s.endsWith("(deleted)")));
  assert.equal(ids.length, state.doc.content.size);
});

test("toJSON / fromJSON keeps the tombstones", () => {
  let state = EditorState.create({ doc: seedIds(startDoc()) });
  state = state.apply(state.tr.delete(5, 11));
  const loaded = Node.fromJSON(schema, JSON.parse(JSON.stringify(state.doc.toJSON())));
  assert.deepEqual(expand(idsOf(loaded)!), expand(idsOf(state.doc)!));
});
