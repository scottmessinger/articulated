// Articulated ids inside unforked ProseMirror. Import once, before any EditorState is created.
// Every doc produced by a step then carries an IdList with one id per position (index == position).
import { Node, ResolvedPos, Schema } from "prosemirror-model";
import { Transform, Step, StepMap, ReplaceStep, ReplaceAroundStep, Mappable } from "prosemirror-transform";
import { IdList, ElementIdGenerator, ElementId, SavedIdList } from "articulated";

export type Anchor = { left: ElementId | null; right: ElementId | null };
export type AnyStep = Step & { newIds?: ElementId[][]; restoreIds?: ElementId[][]; anchors?: Anchor[] };
const idsByDoc = new WeakMap<Node, IdList>();
export const generator = { current: new ElementIdGenerator(() => crypto.randomUUID().slice(0, 8)) };

// ---------- 1. Every doc carries its IdList ----------
export const idsOf = (doc: Node): IdList | undefined => idsByDoc.get(doc);
export function seedIds(doc: Node, ids?: IdList): Node {
  idsByDoc.set(doc, ids ?? IdList.new().insertAfter(null, { bunchId: "init", counter: 0 }, doc.content.size));
  return doc;
}
export const rangesOf = (m: StepMap) => (m as any).ranges as number[];
const idsIn = (ids: IdList, from: number, to: number) => { const a: ElementId[] = []; for (let i = from; i < to; i++) a.push(ids.at(i)); return a; };

// A retype (paragraph -> heading, heading level) swaps only a block's two boundary tokens: keep their ids.
function isRetype(step: Step): boolean {
  return step instanceof ReplaceAroundStep && step.gapFrom === step.from + 1 && step.gapTo === step.to - 1 &&
    step.insert === 1 && step.slice.size === 2 && step.slice.openStart === 0 && step.slice.openEnd === 0;
}

// Restore: if all ids are tombstones and undeleting them puts them exactly at [from, from+n), use them.
function tryRestore(ids: IdList, restore: ElementId[] | undefined, from: number, n: number): IdList | null {
  if (!restore || restore.length !== n || !restore.every(id => ids.isKnown(id) && !ids.has(id))) return null;
  let next = ids; for (const id of restore) next = next.undelete(id);
  return restore.every((id, k) => next.indexOf(id) === from + k) ? next : null;
}

// addStep is @internal in prosemirror-transform's typings, hence the cast.
const TransformInternal = Transform.prototype as Transform & { addStep(step: Step, doc: Node): void };
const origAddStep = TransformInternal.addStep;
TransformInternal.addStep = function (this: Transform, step: AnyStep, doc: Node) {
  const before = idsByDoc.get(this.doc);
  let ids: IdList | undefined = before;
  if (before && !isRetype(step)) {
    let list: IdList = before;
    const r = rangesOf(step.getMap()), minted: ElementId[][] = [];
    // Where new ids go relative to tombstones must be the same on every replica. Anchor each range to the ids
    // around its start: the sender's (from the wire) or, for a local step, the current doc's.
    const base = list, anchors: Anchor[] = step.anchors ?? [];
    for (let i = 0, j = 0; i < r.length; i += 3, j++)
      anchors[j] ??= { left: r[i] > 0 ? base.at(r[i] - 1) : null, right: r[i] < base.length ? base.at(r[i]) : null };
    let k = r.length / 3 - 1;
    for (let i = r.length - 3; i >= 0; i -= 3, k--) {          // back to front, old coordinates
      const from = r[i], to = r[i] + r[i + 1], n = r[i + 2];
      if (to > from) list = list.deleteRange(from, to);
      if (n > 0) {
        // Ids to undelete: a local undo's restoreIds, or a remote step whose ids this replica already has as tombstones
        // (someone else's undo). Ids to insert: a remote step's new ids. Otherwise mint.
        const given = step.newIds?.[k];
        const toRestore = given ? (given.length && given.every(id => list.isKnown(id)) ? given : undefined) : step.restoreIds?.[k];
        const restored = tryRestore(list, toRestore, from, n);
        if (restored) { list = restored; minted[k] = toRestore!; continue; }
        if (given?.some(id => list.isKnown(id))) throw new Error("pm-ids: a remote step re-uses ids that can't be restored at its position");
        const leftId = from === 0 ? null : list.at(from - 1);
        const ins = given ?? idsIn(IdList.new().insertAfter(null, generator.current.generateAfter(leftId, n), n), 0, n);
        // Same rule on every replica, Articulated's usual one first: insertAfter(left anchor) when that lands at `from`;
        // else insertBefore(right anchor) when that does (a concurrent insert sits after the left anchor); else after at(from-1).
        const a = anchors[k];
        const useLeft = a.left !== null && list.isKnown(a.left) && list.indexOf(a.left, "left") + 1 === from;
        const atStart = a.left === null && from === 0;
        const useRight = !useLeft && !atStart && a.right !== null && list.isKnown(a.right) && list.indexOf(a.right, "right") === from;
        if (useRight) { let next = a.right!; for (let j = ins.length - 1; j >= 0; j--) { list = list.insertBefore(next, ins[j]); next = ins[j]; } }
        else { let prev = useLeft ? a.left : leftId; for (const id of ins) { list = list.insertAfter(prev, id); prev = id; } }
        minted[k] = ins;
      }
    }
    step.newIds = minted; step.anchors = anchors;               // what this step created, and where, for sending
    ids = list;
  }
  if (ids) idsByDoc.set(doc, ids);
  return origAddStep.call(this, step, doc);
};

// ---------- 2. Undo restores ids: inverse steps remember the ids they put back ----------
for (const Cls of [ReplaceStep, ReplaceAroundStep] as any[]) {
  const origInvert = Cls.prototype.invert, origMap = Cls.prototype.map;
  Cls.prototype.invert = function (this: AnyStep, doc: Node) {
    const inv: AnyStep = origInvert.call(this, doc), ids = idsByDoc.get(doc);
    if (ids) { // forward deleted ranges == inverse inserted ranges, same order
      const r = rangesOf(this.getMap()), restore: ElementId[][] = [];
      for (let i = 0; i < r.length; i += 3) restore.push(idsIn(ids, r[i], r[i] + r[i + 1]));
      inv.restoreIds = restore;
    }
    return inv;
  };
  Cls.prototype.map = function (this: AnyStep, mapping: Mappable) {     // history remaps steps: keep the memory
    const m: AnyStep | null = origMap.call(this, mapping);
    if (m && this.restoreIds) m.restoreIds = this.restoreIds;
    return m;
  };
}
// A remapped undo can land next to, not on, its tombstones (e.g. after a remote insert there).
// Before applying, move a pure re-insert to where its restored ids belong.
const origMaybeStep = Transform.prototype.maybeStep;
Transform.prototype.maybeStep = function (this: Transform, step: AnyStep) {
  const ids = idsByDoc.get(this.doc);
  const restoreIds = step.restoreIds;
  if (ids && step instanceof ReplaceStep && step.from === step.to && restoreIds?.length === 1) {
    const restore = restoreIds[0];
    if (restore.length > 0 && restore.length === step.slice.size && restore.every(id => ids.isKnown(id) && !ids.has(id))) {
      let next = ids; for (const id of restore) next = next.undelete(id);
      const target = next.indexOf(restore[0]);
      if (target !== step.from && restore.every((id, k) => next.indexOf(id) === target + k)) {
        const moved: AnyStep = new ReplaceStep(target, target, step.slice, (step as any).structure);
        moved.restoreIds = restoreIds;
        const res = origMaybeStep.call(this, moved);
        if (!res.failed) return res;
      }
    }
  }
  return origMaybeStep.call(this, step);
};

// ---------- 3. Positions answer with ids ----------
declare module "prosemirror-model" {
  interface ResolvedPos { readonly idBefore: ElementId | null; readonly idAfter: ElementId | null }
  interface Node { idAt(pos: number): ElementId | undefined; posOfId(id: ElementId): number }
}
Object.defineProperty(ResolvedPos.prototype, "idBefore", { get(this: ResolvedPos) { const ids = idsByDoc.get(this.doc); return ids && this.pos > 0 ? ids.at(this.pos - 1) : null; } });
Object.defineProperty(ResolvedPos.prototype, "idAfter", { get(this: ResolvedPos) { const ids = idsByDoc.get(this.doc); return ids && this.pos < ids.length ? ids.at(this.pos) : null; } });
Node.prototype.idAt = function (pos: number) { return idsByDoc.get(this)?.at(pos); };     // id of the token after pos
Node.prototype.posOfId = function (id: ElementId) { return idsByDoc.get(this)?.indexOf(id) ?? -1; };

// ---------- 4. Ids travel with doc JSON ----------
const origToJSON = Node.prototype.toJSON;
Node.prototype.toJSON = function (this: Node) {
  const json = origToJSON.call(this), ids = idsByDoc.get(this);
  if (ids) json.ids = ids.save();
  return json;
};
const origFromJSON = Node.fromJSON;
Node.fromJSON = function (schema: Schema, json: any) {
  const node = origFromJSON.call(Node, schema, json);
  if (json?.ids) seedIds(node, IdList.load(json.ids as SavedIdList));
  return node;
};
