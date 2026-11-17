// npm run example
import "../src/pm-ids-patch";                          // 1. import once, before creating any EditorState
import { seedIds, idsOf, generator, AnyStep } from "../src/pm-ids-patch";
import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { Node, Slice, Fragment } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { history, undo, closeHistory } from "prosemirror-history";
import { ElementIdGenerator } from "articulated";

const show = (doc: Node) => {
  const out: string[] = [];
  for (const run of idsOf(doc)!.save()) for (let j = 0; j < run.count; j++)
    out.push(`${run.bunchId}:${run.startCounter + j}${run.isDeleted ? "(deleted)" : ""}`);
  return out.join(" ");
};

// 2. Each client gets its own id generator (the bunch id should be unique, e.g. a random string).
generator.current = new ElementIdGenerator(() => "alice");

// 3. A new doc needs ids once. A doc loaded from JSON that has "ids" already has them.
let state = EditorState.create({
  doc: seedIds(schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hi")])])),
  plugins: [history()],
});
console.log("start:      ", show(state.doc));

// 4. Edit normally. Ids follow every step.
state = state.apply(state.tr.insertText("!", 3));
console.log("type '!':   ", show(state.doc));

state = state.apply(state.tr.setBlockType(1, 1, schema.nodes.heading, { level: 1 }));
console.log("to heading: ", show(state.doc), "  (same ids)");

state = state.apply(closeHistory(state.tr.delete(1, 3)));   // closeHistory: undo only this delete
console.log("delete 'hi':", show(state.doc));

undo(state, (tr) => (state = state.apply(tr)));
console.log("undo:       ", show(state.doc), "  (old ids back)");

// 5. Position -> id and id -> position.
console.log("id at 3:    ", state.doc.idAt(3));
console.log("$pos(3):    ", state.doc.resolve(3).idBefore, state.doc.resolve(3).idAfter);
console.log("posOfId:    ", state.doc.posOfId({ bunchId: "alice", counter: 0 }), "(the '!')");

// 6. Save and load: ids (tombstones too) travel inside the doc JSON.
const json = state.doc.toJSON();
const loaded = Node.fromJSON(schema, json);
console.log("json.ids:   ", JSON.stringify(json.ids));
console.log("loaded:     ", show(loaded));

// 7. A step whose ids were chosen elsewhere (another client): set step.newIds before applying.
const remote = new ReplaceStep(1, 1, new Slice(Fragment.from(schema.text("o")), 0, 0)) as AnyStep;
remote.newIds = [[{ bunchId: "bob", counter: 0 }]];
state = state.apply(state.tr.step(remote));
console.log("bob's step: ", show(state.doc), " ", JSON.stringify(state.doc.textContent));
