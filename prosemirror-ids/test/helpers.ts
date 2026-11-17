import { Node } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { EditorState, Transaction } from "prosemirror-state";
import { liftTarget, findWrapping } from "prosemirror-transform";
import { ElementIdGenerator, IdList } from "articulated";

export function rng(seed: number) {
  let s = seed;
  const next = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  return { next, pick: <T>(a: T[]) => a[Math.floor(next() * a.length)] };
}
// Two generators built the same way mint the same ids in the same order.
export const makeGenerator = (name: string) => { let n = 0; return new ElementIdGenerator(() => `${name}${n++}`); };

export const startDoc = () =>
  schema.node("doc", null, [schema.node("paragraph", null, [schema.text("The quick brown fox")]), schema.node("paragraph", null, [schema.text("jumps over")])]);

const textPositions = (doc: Node) => {
  const out: number[] = [];
  doc.descendants((n, pos) => { if (n.isTextblock) for (let i = 0; i <= n.content.size; i++) out.push(pos + 1 + i); });
  return out;
};

export type EditKind = "insertText" | "delete" | "split" | "addMark" | "removeMark" | "setBlockType" | "wrap" | "lift" | "join" | "replaceWith";
export const ALL_EDITS: EditKind[] = ["insertText", "delete", "split", "addMark", "removeMark", "setBlockType", "wrap", "lift", "join", "replaceWith"];

export function randomEdit(state: EditorState, r: ReturnType<typeof rng>, kinds: EditKind[] = ALL_EDITS): Transaction | null {
  const tr = state.tr, ps = textPositions(state.doc); if (!ps.length) return null;
  const a = r.pick(ps), b = r.pick(ps), from = Math.min(a, b), to = Math.max(a, b), $f = state.doc.resolve(from);
  const kind = r.pick(kinds);
  try {
    switch (kind) {
      case "insertText": tr.insertText(r.pick(["x", "yz", "hello ", "Q"]), a); break;
      case "delete": if ($f.sameParent(state.doc.resolve(to)) && to > from) tr.delete(from, to); else tr.delete(from, Math.min($f.end(), from + 1)); break;
      case "split": tr.split(a); break;
      case "addMark": if (to > from) tr.addMark(from, to, r.pick([schema.marks.strong.create(), schema.marks.em.create(), schema.marks.link.create({ href: "u" })])); break;
      case "removeMark": if (to > from) tr.removeMark(from, to, schema.marks.strong); break;
      case "setBlockType": tr.setBlockType(from, to, r.pick([schema.nodes.paragraph, schema.nodes.heading]), { level: 1 + Math.floor(r.next() * 3) }); break;
      case "wrap": { const range = $f.blockRange(state.doc.resolve(to)); const w = range && findWrapping(range, schema.nodes.blockquote); if (w) tr.wrap(range!, w); break; }
      case "lift": { const range = $f.blockRange(state.doc.resolve(to)); const t = range && liftTarget(range); if (t != null) tr.lift(range!, t); break; }
      case "join": { const $p = state.doc.resolve(a); if ($p.depth >= 1 && $p.index(0) > 0) tr.join($p.before(1)); break; }
      case "replaceWith": tr.replaceWith(from, to, schema.text(r.pick(["AB", "C"]))); break;
    }
  } catch { return null; }
  return tr.docChanged ? tr : null;
}

// Every id with its deleted flag, in list order: the whole list, tombstones included.
export function expand(ids: IdList): string[] {
  const out: string[] = [];
  for (const run of ids.save()) for (let j = 0; j < run.count; j++) out.push(`${run.bunchId}:${run.startCounter + j}${run.isDeleted ? " (deleted)" : ""}`);
  return out;
}
