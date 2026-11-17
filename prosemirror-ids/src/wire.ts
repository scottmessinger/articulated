// Sending a step to another replica, addressed by ids instead of positions.
// Not part of the patch: only the multi-client test uses it.
import { Node, Schema } from "prosemirror-model";
import { Step, MapResult, Mappable } from "prosemirror-transform";
import { ElementId } from "articulated";
import { idsOf, rangesOf, Anchor, AnyStep } from "./pm-ids-patch";

// false = ProseMirror's rule (an insert whose neighbours were both deleted is dropped); true = keep it.
export const options = { keepInsertsInDeletedText: false };
export type WireStep = { step: any; anchors: Record<number, Anchor>; newIds: ElementId[][]; placement?: Anchor[] };

// Client: record the ids on both sides of every position the step uses.
export function stepToWire(step: AnyStep, docBefore: Node): WireStep {
  const ids = idsOf(docBefore)!, anchors: Record<number, Anchor> = {};
  const record = (pos: number) => (anchors[pos] = { left: pos > 0 ? ids.at(pos - 1) : null, right: pos < ids.length ? ids.at(pos) : null });
  const recorder: Mappable = { map: (pos) => (record(pos), pos), mapResult: (pos) => (record(pos), new (MapResult as any)(pos, 0, null)) };
  step.map(recorder);
  const r = rangesOf(step.getMap()); for (let i = 0; i < r.length; i += 3) if (!anchors[r[i]]) record(r[i]);
  return { step: step.toJSON(), anchors, newIds: step.newIds ?? [], placement: step.anchors };
}
// Receiver: resolve each recorded position against the current ids. Deleted neighbours report as deleted,
// so every step type's own map() decides what to do (drop, shrink...), exactly as with ProseMirror's mapping.
export function stepFromWire(schema: Schema, doc: Node, wire: WireStep): Step | null {
  const ids = idsOf(doc)!;
  const resolve = (pos: number, assoc: number): MapResult => {
    const a = wire.anchors[pos];
    const known = (id: ElementId | null) => id === null || ids.isKnown(id);   // unknown = made by a dropped change
    const leftGone = !!a.left && !ids.has(a.left), rightGone = !!a.right && !ids.has(a.right);
    const viaLeft = () => (a.left === null ? 0 : ids.indexOf(a.left, "left") + 1);
    const viaRight = () => (a.right === null ? ids.length : ids.indexOf(a.right, "right"));
    if (!known(a.left) && !known(a.right)) throw new UnknownAnchor();
    const p = assoc < 0 ? (known(a.left) ? viaLeft() : viaRight()) : (known(a.right) ? viaRight() : viaLeft());
    const del = (leftGone ? 1 : 0) | (rightGone ? 2 : 0) | (!options.keepInsertsInDeletedText && leftGone && rightGone ? 4 : 0) | ((assoc < 0 ? leftGone : rightGone) ? 8 : 0);
    return new (MapResult as any)(p, del, null);
  };
  const resolver: Mappable = { map: (pos, assoc = 1) => resolve(pos, assoc).pos, mapResult: (pos, assoc = 1) => resolve(pos, assoc) };
  const original = Step.fromJSON(schema, wire.step);
  let mapped: AnyStep | null;
  try { mapped = original.map(resolver); } catch (e) { if (e instanceof UnknownAnchor) return null; throw e; }
  if (mapped) {
    mapped.newIds = wire.newIds;
    const r = rangesOf(original.getMap()); mapped.anchors = [];
    for (let i = 0, k = 0; i < r.length; i += 3, k++) mapped.anchors.push(wire.placement?.[k] ?? wire.anchors[r[i]] ?? { left: null, right: null });
  }
  return mapped;
}

class UnknownAnchor extends Error {}

