// The reference: Articulated used the ordinary way, beside an unpatched ProseMirror.
// For every step, walk step.getMap() ranges back to front: deleteRange the replaced tokens,
// then insertAfter(the id on the left) a fresh run of ids from the generator.
import { Transaction } from "prosemirror-state";
import { Node } from "prosemirror-model";
import { IdList, ElementIdGenerator } from "articulated";

export function referenceSeed(doc: Node): IdList {
  return IdList.new().insertAfter(null, { bunchId: "init", counter: 0 }, doc.content.size);
}

export function referenceApply(ids: IdList, tr: Transaction, gen: ElementIdGenerator): IdList {
  for (const step of tr.steps) {
    const r = (step.getMap() as any).ranges as number[];
    for (let i = r.length - 3; i >= 0; i -= 3) {
      const from = r[i], to = r[i] + r[i + 1], n = r[i + 2];
      if (to > from) ids = ids.deleteRange(from, to);
      if (n > 0) {
        const left = from === 0 ? null : ids.at(from - 1);
        ids = ids.insertAfter(left, gen.generateAfter(left, n), n);
      }
    }
  }
  return ids;
}
