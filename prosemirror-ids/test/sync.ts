// A minimal server-ordered sync loop (the shape prosemirror-collab uses), for the multi-client test.
// The server keeps an ordered log of WireSteps; clients send pending steps and replay what they missed.
import { EditorState, Transaction } from "prosemirror-state";
import { Schema } from "prosemirror-model";
import { stepToWire, stepFromWire, WireStep } from "../src/wire";

const applyWire = (tr: Transaction, schema: Schema, w: WireStep): boolean => {
  const step = stepFromWire(schema, tr.doc, w);          // ids -> positions in this doc (null = dropped)
  return !!step && !tr.maybeStep(step).failed;            // addStep reuses w.newIds, so ids match everywhere
};

export class Server {
  log: WireStep[] = [];
  constructor(public state: EditorState) {}
  // Apply what it can, in arrival order; re-describe each applied step against the server doc.
  receive(steps: WireStep[]): WireStep[] {
    const tr = this.state.tr, accepted: WireStep[] = [];
    for (const w of steps) {
      const before = tr.doc, n = tr.steps.length;
      if (applyWire(tr, this.state.schema, w)) accepted.push(stepToWire(tr.steps[n], before));
    }
    this.state = this.state.apply(tr); this.log.push(...accepted);
    return accepted;
  }
}

export class Client {
  confirmed: EditorState; local: EditorState; version = 0; pending: WireStep[] = [];
  constructor(state: EditorState) { this.confirmed = this.local = state; }
  // A local edit: apply it and queue its steps, described by ids.
  edit(tr: Transaction) {
    tr.steps.forEach((s, i) => this.pending.push(stepToWire(s, tr.docs[i])));
    this.local = this.local.apply(tr);
  }
  // Replay server steps on the confirmed doc, then re-apply what's still pending on top.
  catchUp(server: Server) {
    const missed = server.log.slice(this.version); if (!missed.length) return;
    const tr = this.confirmed.tr; for (const w of missed) applyWire(tr, tr.doc.type.schema, w);
    this.confirmed = this.confirmed.apply(tr); this.version = server.log.length;
    const tr2 = this.confirmed.tr;
    this.pending = this.pending.filter(w => applyWire(tr2, tr2.doc.type.schema, w));
    this.local = this.confirmed.apply(tr2);
  }
  send(server: Server) {
    this.catchUp(server); if (!this.pending.length) return;
    server.receive(this.pending); this.pending = []; this.catchUp(server);
  }
}
