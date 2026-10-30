import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";
import { ForgeDatabase } from "../storage/db";
import { createWorkflow } from "../core/model";
import { appendRunBatch, beginRun, finishRun, pinRun, pruneHistory, recoverRuns, toggleFavorite, exportRun, restoreRun } from "../storage/run-lifecycle";
const targets: ForgeDatabase[] = [];
const fresh = () => { const t = new ForgeDatabase(`lifecycle-${crypto.randomUUID()}`); targets.push(t); return t; };
const candidate = (id: string, text = "旧收藏") => ({ text, runId: id, parts: [{ resourceId: "nature", version: 1, text: "旧" }] });
afterEach(async () => { vi.restoreAllMocks(); for (const target of targets.splice(0)) await target.delete(); });
it("100 mixed runs bound ordinary history while preserving pins, favorites and active runs", async () => {
  const target = fresh();
  for (let i = 0; i < 100; i++) {
    const id = String(i); await beginRun(createWorkflow(), id, target);
    await appendRunBatch(id, [candidate(id)], target);
    if (i === 0) await toggleFavorite(candidate(id), target);
    if (i === 1) await pinRun(id, true, target);
    if (i !== 2) await finishRun(id, (["done", "error", "cancelled", "interrupted"] as const)[i % 4], "mixed", target);
    await pruneHistory(20, target);
  }
  expect(await target.runs.where("[retention+createdAt]").between([0, -Infinity], [0, Infinity]).count()).toBe(20);
  expect(await target.runs.count()).toBe(23); expect(await target.generated.count()).toBe(23);
  expect(await target.runs.get("0")).toBeDefined(); expect(await target.runs.get("1")).toBeDefined();
  expect((await target.runs.get("2"))?.status).toBe("running");
  await toggleFavorite(candidate("0"), target); await pinRun("1", false, target); await pruneHistory(0, target);
  expect(await target.runs.count()).toBe(1); expect(await target.generated.count()).toBe(1);
});
it("duplicate batches are idempotent, terminal state wins and late writes fail", async () => {
  const target = fresh(); await beginRun(createWorkflow(), "r", target);
  await appendRunBatch("r", [candidate("r")], target); await appendRunBatch("r", [candidate("r")], target);
  expect((await target.runs.get("r"))?.count).toBe(1);
  await finishRun("r", "cancelled", "stop", target); await finishRun("r", "done", "", target);
  expect((await target.runs.get("r"))?.status).toBe("cancelled");
  await expect(appendRunBatch("r", [candidate("r", "迟到")], target)).rejects.toThrow("迟到");
  expect(await target.generated.count()).toBe(1);
});
it("recovery preserves live owners and committed partial output, never replays execution", async () => {
  const target = fresh();
  for (const id of ["live", "dead"]) { await beginRun(createWorkflow(), id, target); await appendRunBatch(id, [candidate(id)], target); }
  expect(await recoverRuns(target, async id => id === "dead")).toBe(1);
  expect((await target.runs.get("live"))?.status).toBe("running");
  expect((await target.runs.get("dead"))?.status).toBe("interrupted");
  expect(await recoverRuns(target, async () => false)).toBe(0); expect(await target.generated.count()).toBe(2);
});
it("a failed delete rolls back both generated rows and run records; retry succeeds", async () => {
  const target = fresh(); await beginRun(createWorkflow(), "r", target); await appendRunBatch("r", [candidate("r")], target); await finishRun("r", "error", "", target);
  const original = target.runs.delete.bind(target.runs);
  const spy = vi.spyOn(target.runs, "delete").mockRejectedValueOnce(new Error("injected delete failure"));
  await expect(pruneHistory(0, target)).rejects.toThrow("injected");
  expect(await target.generated.count()).toBe(1); expect(await target.runs.count()).toBe(1);
  spy.mockImplementation(original); await pruneHistory(0, target); expect(await target.generated.count()).toBe(0);
});
it("batch failure rolls back result rows and count", async () => {
  const target = fresh(); await beginRun(createWorkflow(), "r", target);
  vi.spyOn(target.runs, "put").mockRejectedValueOnce(new Error("injected quota"));
  await expect(appendRunBatch("r", [candidate("r")], target)).rejects.toThrow("quota");
  expect(await target.generated.count()).toBe(0); expect((await target.runs.get("r"))?.count).toBe(0);
});
it("concurrent favorite and cleanup cannot leave a surviving favorite with a dangling newly deleted source", async () => {
  const target = fresh(); await beginRun(createWorkflow(), "r", target); await appendRunBatch("r", [candidate("r")], target); await finishRun("r", "done", "", target);
  await Promise.all([toggleFavorite(candidate("r"), target), pruneHistory(0, target)]);
  expect(await target.runs.get("r")).toBeDefined(); expect(await target.generated.get(["r", "旧收藏"])).toBeDefined();
});
it("v5 migration retains resources/workflows/favorites and repairs only available favorite source output", async () => {
  const name = `old-${crypto.randomUUID()}`, old = new Dexie(name);
  old.version(5).stores({ resources: "id,name", entries: "++id,resourceId,text,&[resourceId+text],[resourceId+id]", workflows: "id,name", favorites: "text,savedAt", runs: "id,createdAt", generated: "[runId+text],text,runId", relations: "++id,resourceId,[resourceId+left+right+relation],&[resourceId+left+right+relation+direction],[resourceId+id],left,right", gamePresets: "id,name" });
  await old.table("resources").put({ id: "keep", version: 7 }); await old.table("workflows").put(createWorkflow());
  await old.table("runs").put({ id: "old", workflow: createWorkflow(), versions: { nature: 1 }, createdAt: 1, status: "done", count: 10 });
  await old.table("favorites").put({ ...candidate("old"), savedAt: 2 });
  await old.table("favorites").put({ ...candidate("missing", "失去的来源"), savedAt: 3 }); old.close();
  const target = new ForgeDatabase(name); targets.push(target); await target.open();
  expect((await target.runs.get("old"))?.retention).toBe(1); expect(await target.generated.get(["old", "旧收藏"])).toBeDefined();
  await pruneHistory(0, target);
  expect(await target.resources.get("keep")).toEqual({ id: "keep", version: 7 }); expect(await target.workflows.count()).toBe(1);
  expect(await target.favorites.count()).toBe(2); expect(await target.runs.get("missing")).toBeUndefined();
  target.close(); await target.open(); expect(await target.favorites.count()).toBe(2);
});
it("run backup restores atomically, pins recovered snapshots and never overwrites collisions", async () => {
  const source = fresh(), target = fresh(); await beginRun(createWorkflow(), "r", source); await appendRunBatch("r", [candidate("r")], source); await toggleFavorite(candidate("r"), source);
  const text = await exportRun("r", source); await restoreRun(text, target);
  expect((await target.runs.get("r"))?.status).toBe("interrupted"); expect((await target.runs.get("r"))?.pinned).toBe(true);
  expect(await target.favorites.count()).toBe(1); expect(await target.generated.count()).toBe(1);
  await expect(restoreRun(text, target)).rejects.toThrow("未覆盖"); expect(await target.favorites.count()).toBe(1);
  const bad = JSON.parse(text); bad.run.id = "bad"; await expect(restoreRun(JSON.stringify(bad), target)).rejects.toThrow();
  expect(await target.runs.get("bad")).toBeUndefined();
});
it("cleanup rechecks references even with stale legacy retention metadata", async () => {
  const target = fresh(); await beginRun(createWorkflow(), "r", target); await finishRun("r", "done", "", target);
  await target.favorites.put({ ...candidate("r"), savedAt: 1 });
  await pruneHistory(0, target); expect(await target.runs.get("r")).toBeDefined();
});
