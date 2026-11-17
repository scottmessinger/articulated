// Three clients and a server, random concurrent edits, server order. Every replica must end with
// the same doc and the same IdList, tombstones included.
import { test } from "node:test";
import assert from "node:assert/strict";
import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { history, undo } from "prosemirror-history";
import { Transaction } from "prosemirror-state";
import { stepFromWire, stepToWire, WireStep } from "../src/wire";
import { generator, idsOf, seedIds } from "../src/pm-ids-patch";
import { Client, Server } from "./sync";
import { expand, makeGenerator, randomEdit, rng, startDoc } from "./helpers";

const signature = (s: EditorState) => s.doc.toString() + "\n" + expand(idsOf(s.doc)!).join(" ");

for (let seed = 1; seed <= 8; seed++) {
  test(`3 clients, 4,000 random actions, seed ${seed}: all replicas identical`, () => {
    const saved = seedIds(startDoc()).toJSON();
    const load = () => EditorState.create({ schema, doc: schema.nodeFromJSON(saved) });
    const server = new Server(load());
    const clients = [0, 1, 2].map(() => new Client(load()));
    const gens = [0, 1, 2].map((c) => makeGenerator(`c${c}-`));
    const r = rng(seed);
    for (let n = 0; n < 4000; n++) {
      const c = Math.floor(r.next() * 3);
      if (r.next() < 0.55) {
        generator.current = gens[c];
        const tr = randomEdit(clients[c].local, r);
        if (tr) clients[c].edit(tr);
      } else clients[c].send(server);
    }
    for (const c of clients) c.send(server);
    for (const c of clients) c.catchUp(server);
    for (const c of clients) {
      assert.equal(signature(c.local), signature(server.state));
      assert.equal(signature(c.confirmed), signature(server.state));
    }
    assert.equal(idsOf(server.state.doc)!.length, server.state.doc.content.size);
  });
}

test("A deletes 'brown', B types '!' after it, A undoes: 'quick brown! fox' with brown's original ids", () => {
  const saved = seedIds(schema.node("doc", null, [schema.node("paragraph", null, [schema.text("quick brown fox")])])).toJSON();
  let a = EditorState.create({ schema, doc: schema.nodeFromJSON(saved), plugins: [history()] });
  let b = EditorState.create({ schema, doc: schema.nodeFromJSON(saved), plugins: [history()] });
  const brown = [7, 8, 9, 10, 11].map((p) => idsOf(a.doc)!.at(p));
  const wires = (tr: Transaction) => tr.steps.map((s, i) => stepToWire(s, tr.docs[i]));
  const receive = (state: EditorState, ws: WireStep[]) => {   // a remote change: not part of the receiver's undo history
    const tr = state.tr.setMeta("addToHistory", false);
    for (const w of ws) { const step = stepFromWire(schema, tr.doc, w); if (step) tr.step(step); }
    return state.apply(tr);
  };
  generator.current = makeGenerator("a"); const del = a.tr.delete(7, 12); a = a.apply(del);
  generator.current = makeGenerator("b"); const bang = b.tr.insertText("!", 12); b = b.apply(bang);
  b = receive(b, wires(del));
  a = receive(a, wires(bang));
  assert.equal(a.doc.textContent, "quick ! fox");
  let undoTr: Transaction | undefined;
  undo(a, (tr) => { undoTr = tr; a = a.apply(tr); });
  b = receive(b, wires(undoTr!));
  for (const s of [a, b]) {
    assert.equal(s.doc.textContent, "quick brown! fox");
    assert.deepEqual([7, 8, 9, 10, 11].map((p) => idsOf(s.doc)!.at(p)), brown);
  }
  assert.equal(signature(a), signature(b));
});
