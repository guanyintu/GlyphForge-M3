import { db } from "./db";
import { importPackage } from "../core/sharing";
import type { Workflow } from "../core/model";

export function isHaidu(w: Workflow) {
  return w.comments?.includes("// glyphforge:preset:haidu-workflow-v3") || w.name.startsWith("海都潮人 ID");
}
export async function openHaidu() {
  const existing = (await db.workflows.toArray()).find(w => w.comments?.includes("// glyphforge:preset:haidu-workflow-v3"));
  if (existing) return existing;
  const { default: pkg } = await import("../../examples/haidu-chao-ren.portable.json");
  // The existing importer creates fresh IDs in one atomic transaction.
  return importPackage(pkg);
}

let originalInstall: Promise<Workflow> | undefined;
export function openHaiduOriginal(): Promise<Workflow> {
  return originalInstall ||= (async () => {
    const existing = (await db.workflows.toArray()).find(w => w.comments?.includes("// glyphforge:preset:haidu-original-xlsx-v1"));
    if (existing) return existing;
    const { default: pkg } = await import("../../examples/haidu-chao-ren.original.portable.json");
    const restored = await importPackage(pkg);
    const workflow = { ...restored, name: pkg.workflow.name };
    await db.workflows.put(workflow);
    return workflow;
  })().finally(() => { originalInstall = undefined; });
}
