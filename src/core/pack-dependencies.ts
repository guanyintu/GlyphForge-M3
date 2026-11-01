import { allNodes } from "./subgraphs";
import {
  packKey,
  validatePack,
  validatePacks,
  type ExtensionPack,
} from "./packs";
import type { Resource, Workflow } from "./model";
export function mergePacks(lists: ExtensionPack[][]) {
  const map = new Map<string, ExtensionPack>();
  for (const list of lists)
    for (const raw of list) {
      const p = validatePack(raw),
        key = packKey(p);
      if (map.has(key) && JSON.stringify(map.get(key)) !== JSON.stringify(p))
        throw new Error(`扩展同 ID/版本内容冲突 ${key}`);
      map.set(key, p);
    }
  const packs = [...map.values()];
  validatePacks(packs);
  return packs;
}
export function requiredPacks(w: Workflow) {
  const byKey = new Map((w.extensions ?? []).map((p) => [packKey(p), p])),
    needed = new Map<string, ExtensionPack>();
  function visit(key: string) {
    if (needed.has(key)) return;
    const p = byKey.get(key);
    if (!p) throw new Error(`缺失扩展 ${key}`);
    needed.set(key, p);
    p.dependencies.forEach((d) => visit(packKey(d)));
  }
  for (const n of allNodes(w))
    if (n.op === "extension") visit(`${n.params.pack}@${n.params.version}`);
  return [...needed.values()];
}
export function workflowPacks(w: Workflow, resources: Resource[] = []) {
  return mergePacks([
    requiredPacks(w),
    ...resources.flatMap((r) =>
      r.definition?.type === "dynamic"
        ? [requiredPacks(r.definition.workflow)]
        : [],
    ),
  ]);
}
