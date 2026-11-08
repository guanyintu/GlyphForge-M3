import { db } from "./db";
import { importPackage } from "../core/sharing";
import type { Workflow } from "../core/model";

export function isHaidu(w: Workflow) {
  return w.comments?.includes("// glyphforge:preset:haidu-v2") || w.name.startsWith("海都潮人 ID");
}
export async function openHaidu() {
  const existing = (await db.workflows.toArray()).find(w => w.comments?.includes("// glyphforge:preset:haidu-v2"));
  if (existing) return existing;
  const { default: pkg } = await import("../../examples/haidu-chao-ren.portable.json");
  // The existing importer creates fresh IDs in one atomic transaction.
  return importPackage(pkg);
}
