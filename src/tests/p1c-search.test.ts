import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, addEntries, saveRelationRows, readResource, deleteResource } from "../storage/db";
import { ReverseSearcher, detectPatterns } from "../core/reverse-search";
import { workflowFromMatches } from "../core/reverse-workflow";
import { createWorkflow, operators } from "../core/model";
import type { Candidate, Workflow } from "../core/model";
import { execute } from "../core/engine";
import { parseScript, toScript } from "../core/script";
let searcher: ReverseSearcher;
beforeEach(async () => {
  await Promise.all([db.resources.clear(), db.entries.clear(), db.relations.clear(), db.generated.clear(), db.runs.clear(), db.workflows.clear()]);
  for (const id of ["sky", "jobs", "long", "rel"]) await db.resources.put({ id, name: id, kind: id === "rel" ? "relation" : "word", count: 0, version: 1, color: "green", description: "", updatedAt: 0 });
  await addEntries("sky", ["月亮", "月", "亮", "星星"]); await addEntries("jobs", ["邮差", "邮", "差"]); await addEntries("long", ["月亮邮差"]);
  searcher = new ReverseSearcher();
});
it("multi-library exact and fragment search returns real IDs and positions", async () => {
  const r = await searcher.search("月亮邮差");
  expect(r.matches.find(m => m.resourceId === "long")).toMatchObject({ type: "exact", start: 0, end: 4, utf16Start: 0, utf16End: 4 });
  expect(r.matches.find(m => m.text === "邮差")).toMatchObject({ type: "fragment", resourceId: "jobs", start: 2, end: 4 });
  for (const m of r.matches) expect((await db.entries.get(m.entryId))?.text).toBe(m.text);
});
it("retains multiple paths, prioritizes coverage then fewer segments and caps Top-K", async () => {
  const r = await searcher.search("月亮邮差", { topK: 3 }); expect(r.paths).toHaveLength(3);
  expect(r.paths[0]).toMatchObject({ coverage: 1, complete: true }); expect(r.paths[0].matches).toHaveLength(1);
  expect(r.paths.some(p => p.matches.map(m => m.text).join("+") === "月亮+邮差")).toBe(true);
  expect((await searcher.search("月亮X邮差")).paths[0]).toMatchObject({ coverage: 0.8, complete: false });
});
it("selected libraries exclude other matches and missing resources fail explicitly", async () => {
  const r = await searcher.search("月亮邮差", { resourceIds: ["sky", "jobs"] }); expect(r.matches.every(m => m.resourceId !== "long")).toBe(true);
  await expect(searcher.search("月", { resourceIds: ["missing"] })).rejects.toThrow("已删除");
});
it("does not fabricate matches or definite origins for nonexistent sources", async () => {
  const r = await searcher.search("不存在的名字"); expect(r.matches).toEqual([]); expect(r.known).toBeUndefined(); expect(r.possibleTemplates).toEqual([]);
  await db.generated.put({ text: "月亮邮差", runId: "fabricated", workflowId: "made-up", parts: [] });
  expect((await searcher.search("月亮邮差")).known).toBeUndefined();
});
it("definite origin requires an actual persisted generation and run snapshot", async () => {
  const w = createWorkflow();
  await db.runs.put({ id: "real", workflow: w, versions: {}, status: "done", count: 1, createdAt: 0 });
  await db.generated.put({ text: "月亮邮差", runId: "real", workflowId: w.id, parts: [] });
  expect((await searcher.search("月亮邮差")).known?.runId).toBe("real");
});
it.each(["AAB", "ABB", "AABB", "ABBA", "ABAB"])("recognizes %s with distinct A/B and Unicode graphemes", p => {
  const text = p.replaceAll("A", "👨‍👩‍👧").replaceAll("B", "月"); expect(detectPatterns(text)).toContain(p);
});
it("finds palindromes, repeated halves, and does not claim AAAA is AABB", () => {
  expect(detectPatterns("上海自来水来自海上")).toContain("回文 / 字符镜像"); expect(detectPatterns("月亮月亮")).toContain("重复半段"); expect(detectPatterns("哈哈哈哈")).not.toContain("AABB");
});
it("returns relation direction restrictions and explicit parallel pairs", async () => {
  await saveRelationRows("rel", [{ left: "春", right: "秋", relation: "parallel", direction: "symmetric" }, { left: "师", right: "徒", relation: "associated", direction: "directed" }]);
  expect((await searcher.search("秋春")).relations[0]).toMatchObject({ paired: true, row: { relation: "parallel" } });
  expect((await searcher.search("徒")).relations).toEqual([]); expect((await searcher.search("师")).relations).toHaveLength(1);
});
it("updates query indexes and invalidates cache on add/edit/delete and resource removal", async () => {
  const first = await searcher.search("银河"); expect(first.matches).toEqual([]); expect((await searcher.search("银河")).cacheHit).toBe(true);
  await addEntries("sky", ["银河"]); expect((await searcher.search("银河")).matches).toHaveLength(1);
  const entry = await db.entries.where("[resourceId+text]").equals(["sky", "银河"]).first();
  await db.transaction("rw", db.entries, db.resources, async () => { await db.entries.update(entry!.id!, { text: "星河" }); await db.resources.update("sky", { version: 9 }); });
  expect((await searcher.search("银河")).matches).toEqual([]); expect((await searcher.search("星河")).matches).toHaveLength(1);
  await deleteResource("sky"); expect((await searcher.search("星河")).matches).toEqual([]);
});
it("rejects resource edits during a query, including batch-time mutations", async () => {
  const changes: Promise<unknown>[] = [];
  await expect(searcher.search("月亮", {}, undefined, () => { changes.push(db.resources.update("sky", { version: 99 })); })).rejects.toThrow("发生变化");
  await Promise.all(changes);
});
it("cancels before querying and between result batches", async () => {
  const before = new AbortController(); before.abort(); await expect(searcher.search("月", {}, before.signal)).rejects.toThrow("取消");
  const during = new AbortController(); await expect(searcher.search("月亮邮差", {}, during.signal, () => during.abort())).rejects.toThrow("取消");
});
it("matches simplified/traditional only when enabled and only real entries", async () => {
  await addEntries("sky", ["銀河"]); expect((await searcher.search("银河")).matches).toEqual([]);
  expect((await searcher.search("银河", { normalize: true })).matches[0]).toMatchObject({ text: "銀河", type: "normalized" });
});
it("optional pinyin matches real romanized or homophone candidates", async () => {
  expect((await searcher.search("yueliang")).matches).toEqual([]);
  expect((await searcher.search("yueliang", { pinyin: true })).matches.some(m => m.text === "月亮" && m.type === "pinyin")).toBe(true);
  expect((await searcher.search("悦亮", { pinyin: true })).matches.some(m => m.text === "月亮")).toBe(true);
});
it("known templates enforce shared bindings and remain possible sources", async () => {
  await saveRelationRows("rel", [{ left: "春", right: "秋", relation: "parallel" }]);
  const w: Workflow = { ...createWorkflow(), id: "tpl", name: "共享模板", nodes: [{ id: "t", op: "template", inputs: [], params: { ...operators.template.defaults, slots: JSON.stringify([{ name: "s", resourceId: "rel", kind: "pair" }]), templates: '["{s.left}风","{s.right}雨"]' } }], layout: {} };
  await db.workflows.put(w);
  const r = await searcher.search("春风 / 秋雨"); expect(r.possibleTemplates).toHaveLength(1); expect(r.known).toBeUndefined();
  expect((await searcher.search("春风 / 春雨")).possibleTemplates).toEqual([]);
});
it("matched pieces become a real resource-backed NameScript-compatible workflow", async () => {
  const r = await searcher.search("月亮邮差", { resourceIds: ["sky", "jobs"] }); const w = workflowFromMatches(r.paths[0].matches);
  const values: Candidate[] = []; await execute(parseScript(toScript(w), w), readResource, batch => values.push(...batch)); expect(values.map(v => v.text)).toEqual(["月亮邮差"]);
});
it("UTF-16 offsets preserve complete Emoji graphemes", async () => {
  await addEntries("sky", ["👨‍👩‍👧"]); const r = await searcher.search("👨‍👩‍👧邮差"); expect(r.matches.find(m => m.text.startsWith("👨"))).toMatchObject({ start: 0, end: 1, utf16End: 8 });
});

it("caps ambiguous indexed hits, bounds batch sizes and the final beam", async () => {
  await db.resources.bulkPut(Array.from({ length: 510 }, (_, i) => ({ id: `many${i}`, name: `many${i}`, kind: "word" as const, count: 1, version: 1, updatedAt: 0, color: "green", description: "" })));
  await db.entries.bulkPut(Array.from({ length: 510 }, (_, i) => ({ resourceId: `many${i}`, text: "测试" })));
  const batches: number[] = []; const r = await searcher.search("测试", { topK: 1000 }, undefined, b => batches.push(b.length));
  expect(r.matches).toHaveLength(500); expect(Math.max(...batches)).toBe(50); expect(r.paths.length).toBeLessThanOrEqual(20); expect(r.warnings.join()).toContain("上限");
  const cachedBatches: number[] = []; expect((await searcher.search("测试", { topK: 1000 }, undefined, b => cachedBatches.push(b.length))).cacheHit).toBe(true); expect(Math.max(...cachedBatches)).toBe(50);
});
it("rejects empty or oversized input instead of silently truncating Unicode", async () => {
  await expect(searcher.search("")).rejects.toThrow("字符簇"); await expect(searcher.search("月".repeat(65))).rejects.toThrow("字符簇");
});

it("can cancel an optional phonetic scan after its first keyset page", async () => {
  const controller = new AbortController(); let scanned = 0;
  await expect(searcher.search("yueliang", { pinyin: true }, controller.signal, undefined, (_, count) => { scanned = count; controller.abort(); })).rejects.toThrow("取消");
  expect(scanned).toBeGreaterThan(0);
});

it("invalidates an all-library query when a new resource appears during batching", async () => {
  await expect(searcher.search("月亮", {}, undefined, () => { void db.resources.put({ id: "new-library", name: "new", kind: "word", count: 0, version: 1, color: "green", description: "", updatedAt: 0 }); })).rejects.toThrow("发生变化");
});
