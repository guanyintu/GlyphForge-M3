import {captureResources,assertResourcePlan} from "./resource-runtime";
import { db, type ForgeDatabase, type RunRecord } from "./db";
import type { Candidate, Workflow } from "../core/model";
import { dependencyIds } from "../core/sharing";
import { validateGraph } from "../core/script";

export const DEFAULT_HISTORY_LIMIT = 20;
export const runStatusLabel: Record<RunRecord["status"], string> = {
  running: "执行中", done: "已完成", error: "执行失败", cancelled: "已取消", interrupted: "异常中断",
};
const ordinary = (target: ForgeDatabase) => target.runs.where("[retention+createdAt]").between([0, -Infinity], [0, Infinity]);
async function bucket(run: RunRecord, target: ForgeDatabase) {
  return run.status === "running" ? 2 : run.pinned || await target.favorites.where("runId").equals(run.id).count() ? 1 : 0;
}
export async function beginRun(workflow: Workflow, id: string, target = db) {
  const roots = dependencyIds(workflow);
  const available = await target.resources.bulkGet(roots);
  const plan = await captureResources(roots.filter((_,i)=>available[i]), target);
  const versions = plan.versions;
  await target.runs.add({ id, workflow, versions, resources: plan.resources, resourceKey: plan.key, createdAt: Date.now(), status: "running", count: 0, retention: 2 });
}
export async function appendRunBatch(id: string, batch: Candidate[], target = db) {
  return target.transaction("rw", target.runs, target.generated, target.resources, async () => {
    const run = await target.runs.get(id);
    if (!run || run.status !== "running") throw new Error("运行已结束，拒绝写入迟到结果");
    if(run.resources) { await assertResourcePlan({resources:run.resources,versions:run.versions,key:run.resourceKey??""},target); }
    await target.generated.bulkPut(batch.map(c => ({ ...c, runId: id })));
    // Count the unique compound keys, so replaying a batch is idempotent.
    await target.runs.put({ ...run, count: await target.generated.where("runId").equals(id).count() });
  });
}
export async function finishRun(id: string, status: Exclude<RunRecord["status"], "running">, message = "", target = db) {
  await target.transaction("rw", target.runs, target.generated, target.favorites, target.resources, async () => {
    const run = await target.runs.get(id);
    if (!run || run.status !== "running") return; // First terminal state wins.
    if(status === "done" && run.resources) {await assertResourcePlan({resources:run.resources,versions:run.versions,key:run.resourceKey??""},target);}
    run.status = status;
    await target.runs.put({ ...run, status, endedAt: Date.now(), message, count: await target.generated.where("runId").equals(id).count(), retention: await bucket(run, target) });
  });
}
export function historyLimit() {
  const value = Number(localStorage.getItem("glyphforge-history-limit") ?? DEFAULT_HISTORY_LIMIT);
  return Number.isInteger(value) && value >= 0 && value <= 200 ? value : DEFAULT_HISTORY_LIMIT;
}
/** Small, atomic batches; range index never scans protected/active runs or all generated rows. */
export async function pruneHistory(keep = DEFAULT_HISTORY_LIMIT, target = db) {
  if (!Number.isInteger(keep) || keep < 0 || keep > 200) throw new Error("保留数量须为 0–200 的整数");
  let removed = 0;
  for (;;) {
    const count = await target.transaction("rw", target.runs, target.generated, target.favorites, async () => {
      const excess = await ordinary(target).count() - keep;
      if (excess <= 0) return 0;
      const rows = await ordinary(target).limit(Math.min(16, excess)).toArray();
      let deleted = 0;
      for (const run of rows) {
        // Check real references in the same transaction, even if a legacy writer missed the bucket.
        const retention = await bucket(run, target);
        if (retention !== 0) { await target.runs.put({ ...run, retention }); continue; }
        await target.generated.where("runId").equals(run.id).delete();
        await target.runs.delete(run.id);
        deleted++;
      }
      return { deleted, examined: rows.length };
    });
    if (count === 0) break;
    removed += count.deleted;
    if (!count.examined) break;
  }
  return removed;
}
export async function pinRun(id: string, pinned: boolean, target = db) {
  await target.transaction("rw", target.runs, target.favorites, async () => {
    const run = await target.runs.get(id);
    if (!run) throw new Error("运行来源已缺失");
    run.pinned = pinned;
    await target.runs.put({ ...run, pinned, retention: await bucket(run, target) });
  });
}
export async function toggleFavorite(candidate: Candidate, target = db) {
  await target.transaction("rw", target.runs, target.generated, target.favorites, async () => {
    const previous = await target.favorites.get(candidate.text);
    if (previous) await target.favorites.delete(candidate.text);
    else {
      await target.favorites.add({ ...candidate, savedAt: Date.now() });
      if (candidate.runId && await target.runs.get(candidate.runId))
        await target.generated.put({ ...candidate, runId: candidate.runId });
    }
    const id = previous?.runId ?? candidate.runId;
    const run = id ? await target.runs.get(id) : undefined;
    if (run) await target.runs.put({ ...run, retention: await bucket(run, target) });
  });
}
/** A Web Lock lasts across background suspension, and is released by page/worker death. */
export async function acquireRunLock(id: string): Promise<() => void> {
  if (!navigator.locks) throw new Error("此浏览器缺少 Web Locks，无法可靠管理运行恢复");
  return new Promise((resolve, reject) => {
    void navigator.locks.request(`glyphforge-run:${id}`, () => new Promise<void>(release => resolve(release))).catch(reject);
  });
}
export async function recoverRuns(target = db, isAbandoned?: (id: string) => Promise<boolean>) {
  // Only the status index is read; no generated replay or automatic execution.
  let recovered = 0;
  const ids = await target.runs.where("status").equals("running").primaryKeys();
  for (const id of ids) {
    const recover = async () => { await finishRun(id, "interrupted", "页面或执行环境异常退出；已提交的部分结果保留，未自动重跑", target); recovered++; };
    if (isAbandoned) { if (await isAbandoned(id)) await recover(); }
    else {
      if (!navigator.locks) throw new Error("此浏览器缺少 Web Locks，暂不修改未知运行状态");
      await navigator.locks.request(`glyphforge-run:${id}`, { ifAvailable: true }, async lock => { if (lock) await recover(); });
    }
  }
  return recovered;
}
/** One run only (engine cap 10k); never materialize the full history in UI memory. */
export async function exportRun(id: string, target = db) {
  return target.transaction("r", target.runs, target.generated, target.favorites, async () => {
    const run = await target.runs.get(id);
    if (!run) throw new Error("运行来源已缺失");
    const text = JSON.stringify({ format: "glyphforge-run-backup", version: 1, run,
      generated: await target.generated.where("runId").equals(id).toArray(),
      favorites: await target.favorites.where("runId").equals(id).toArray() });
    if (new TextEncoder().encode(text).length > 32 * 1024 * 1024) throw new Error("运行备份超过 32 MiB，请固定此运行保留来源");
    return text;
  });
}
export async function restoreRun(text: string, target = db) {
  if (text.length > 32 * 1024 * 1024) throw new Error("运行备份超过 32 MiB，请使用较小备份");
  const data = JSON.parse(text);
  if (data?.format !== "glyphforge-run-backup" || data.version !== 1 || !data.run || !Array.isArray(data.generated) || !Array.isArray(data.favorites)) throw new Error("运行备份格式无效");
  const run = data.run as RunRecord;
  validateGraph(run.workflow);
  if (typeof run.id !== "string" || !run.id || !Number.isFinite(run.createdAt) || !Object.hasOwn(runStatusLabel, run.status) || !run.versions || Array.isArray(run.versions) || Object.values(run.versions).some(v => !Number.isInteger(v) || Number(v) < 0)) throw new Error("运行元数据无效");
  if (data.generated.length > 10000 || data.favorites.length > 10000) throw new Error("运行备份超过结果上限");
  const valid = (c: Candidate) => c && typeof c.text === "string" && c.text.length <= 1024 && c.runId === run.id && Array.isArray(c.parts) && c.parts.every(p => typeof p.resourceId === "string" && typeof p.text === "string");
  if (!data.generated.every(valid) || !data.favorites.every((c: Candidate & { savedAt: number }) => valid(c) && Number.isFinite(c.savedAt))) throw new Error("运行结果格式无效");
  await target.transaction("rw", target.runs, target.generated, target.favorites, async () => {
    if (await target.runs.get(run.id)) throw new Error("同 ID 运行已存在，未覆盖任何数据");
    await target.runs.add({ ...run, status: run.status === "running" ? "interrupted" : run.status, pinned: true, retention: 1, count: new Set(data.generated.map((c: Candidate) => c.text)).size });
    await target.generated.bulkAdd(data.generated);
    for (const favorite of data.favorites) {
      if (!(await target.generated.get([run.id, favorite.text]))) await target.generated.add(favorite);
      if (!(await target.favorites.get(favorite.text))) await target.favorites.add(favorite);
    }
    const stored = (await target.runs.get(run.id))!;
    await target.runs.put({ ...stored, count: await target.generated.where("runId").equals(run.id).count() });
  });
}
