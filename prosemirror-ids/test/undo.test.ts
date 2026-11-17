// Two editors with undo history, taking turns: random edits, undo and redo, each change sent to the other
// right away. Undo remaps over the other person's edits. Both must stay identical, ids and tombstones included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schema } from "prosemirror-schema-basic";
import { EditorState, Transaction } from "prosemirror-state";
import { history, undo, redo } from "prosemirror-history";
import { generator, idsOf, seedIds } from "../src/pm-ids-patch";
import { stepFromWire, stepToWire } from "../src/wire";
import { expand, makeGenerator, randomEdit, rng, startDoc } from "./helpers";

const signature = (s: EditorState) => s.doc.toString() + "\n" + expand(idsOf(s.doc)!).join(" ");

for (let seed = 1; seed <= 10; seed++) {
  test(`two editors, random edits + undo + redo, seed ${seed}: identical after every change`, () => {
    const saved = seedIds(startDoc()).toJSON();
    const editors = [0, 1].map(() => EditorState.create({ schema, doc: schema.nodeFromJSON(saved), plugins: [history()] }));
    const gens = [makeGenerator("a"), makeGenerator("b")];
    const r = rng(seed);
    let undos = 0, restoredRuns = 0, withRestore = 0; const misses: string[] = [];
    for (let n = 0; n < 1500; n++) {
      const me = Math.floor(r.next() * 2), other = 1 - me;
      generator.current = gens[me];
      let tr: Transaction | null = null;
      const roll = r.next();
      if (roll < 0.15) undo(editors[me], (t) => (tr = t));
      else if (roll < 0.22) redo(editors[me], (t) => (tr = t));
      else tr = randomEdit(editors[me], r);
      if (!tr) continue;
      const t: Transaction = tr;
      if (roll < 0.22) {
        undos++;
        // A block-type undo keeps ids without touching the list (no newIds), so it isn't counted here.
        for (const s of t.steps as any[]) if (s.newIds) (s.restoreIds ?? []).forEach((run: any[], k: number) => {
          if (!run?.length) return;
          withRestore++;
          if (JSON.stringify(s.newIds?.[k]) === JSON.stringify(run)) restoredRuns++;
          else if (process.env.VERBOSE) misses.push(`${s.constructor.name} run=${run.length} new=${s.newIds?.[k]?.length ?? 0} slice=${s.slice?.size}`);
        });
      }
      const wires = t.steps.map((s, i) => stepToWire(s, t.docs[i]));
      editors[me] = editors[me].apply(t);
      const recv = editors[other].tr.setMeta("addToHistory", false);
      for (const w of wires) {
        const step = stepFromWire(schema, recv.doc, w);
        assert.ok(step, `step dropped at action ${n}`);
        assert.ok(!recv.maybeStep(step!).failed, `step failed at action ${n}`);
      }
      editors[other] = editors[other].apply(recv);
      assert.equal(signature(editors[other]), signature(editors[me]), `editors differ after action ${n}`);
    }
    if (process.env.VERBOSE) console.log(`seed ${seed}: undo/redo=${undos} runs of text brought back=${withRestore} got their old ids back=${restoredRuns}`, misses.slice(0, 8));
    assert.ok(undos > 50, `only ${undos} undo/redo`);
    assert.ok(restoredRuns / withRestore > 0.9, `only ${restoredRuns} of ${withRestore} restored runs got their old ids back`);
  });
}
