import "fake-indexeddb/auto";
import { afterEach, expect, it } from "vitest";
import { execute } from "../core/engine";
import type { ResourceReader } from "../core/engine";
import type { Candidate, Params, Workflow } from "../core/model";
import { mutationDefaults, mutationOperations, mutationSource, mutationWorkflow } from "../core/mutation";
import { glyphs } from "../core/unicode";
import { normalizeParams, operatorContracts } from "../core/contracts";
import { parseScript, toScript, validateGraph } from "../core/script";
import { db, readResource, saveNewResource } from "../storage/db";
import { exportPackage, importPackage, dependencyIds } from "../core/sharing";
import { extractSubgraph } from "../core/subgraphs";
import { beginRun, appendRunBatch, finishRun, toggleFavorite, exportRun, restoreRun } from "../storage/run-lifecycle";
import { defaultGameRule, checkGameId } from "../core/game-rules";
const source: Candidate = { text: "月月👩🏽‍💻星", parts: [{ resourceId: "original", text: "月", version: 3 }], runId: "old-run", workflowId: "old-workflow", seed: 7, pair: { left: "月", right: "星", relation: "couple" }, members: ["月", "星"] };
const reader = async function* () { for (const text of ["云梦", "夜风", "云梦"]) yield { text, parts: [{ resourceId: "words", text, version: 2 }] }; };
const workflow = (settings: Params = {}, seed = 42) => mutationWorkflow(source, settings, seed);
async function run(w = workflow(), read: ResourceReader = reader, limits?: { steps: number; milliseconds: number }, signal?: AbortSignal) { const rows: Candidate[] = []; const stats = await execute(w, read, b => rows.push(...b), limits, { signal, runId: "new-run" }); return { rows, stats }; }
afterEach(async () => { await db.delete(); await db.open(); });

it.each(Object.keys(mutationOperations))("%s uses shared bounded engine and changes text", async op => {
  const { rows } = await run(workflow({ operations: JSON.stringify([op]), resourceId: "words", count: 24 }));
  expect(rows.length).toBeGreaterThan(0); expect(new Set(rows.map(c => c.text)).size).toBe(rows.length);
  for (const c of rows) { expect(c.text).not.toBe(source.text); expect(c.pair).toBeUndefined(); expect(c.members).toBeUndefined(); expect(c.workflowId).not.toBe(source.workflowId); expect(c.runId).toBe("new-run"); expect(c.derivation?.parent.runId).toBe("old-run"); expect(c.parts).toContainEqual(source.parts[0]); }
});
it.each(["replace", "delete", "reorder", "dictionary", "homophone", "martian"])("%s protects independent repeated positions and entire ZWJ cluster", async op => {
  const { rows } = await run(workflow({ operations: JSON.stringify([op]), locks: "[0,2]", resourceId: "words", intensity: 3 }));
  expect(rows.length).toBeGreaterThan(0);
  for (const c of rows) expect(c.derivation!.locks.map(i => glyphs(c.text)[i])).toEqual(["月", "👩🏽‍💻"]);
});
it("locking all positions permits insert/affix while replacement/deletion produce no unchanged duplicates", async () => {
  for (const op of ["replace", "delete", "reorder", "homophone", "martian", "dictionary"]) expect((await run(workflow({ operations: JSON.stringify([op]), locks: "[0,1,2,3]", resourceId: "words" }))).rows).toEqual([]);
  const { rows } = await run(workflow({ operations: '["insert","affix"]', locks: "[0,1,2,3]", intensity: 3 }));
  for (const c of rows) expect(c.derivation!.locks.map(i => glyphs(c.text)[i])).toEqual(glyphs(source.text));
});
it("combining marks cannot merge or break a locked glyph", async () => {
  const w = mutationWorkflow({ text: "e👩‍💻", parts: [] }, { pool: "\u0301", locks: "[0,1]", operations: '["insert"]', count: 16 }, 42);
  for (const c of (await run(w)).rows) expect(c.derivation!.locks.map(i => glyphs(c.text)[i])).toEqual(["e", "👩‍💻"]);
});
it("same seed/resources gives exact order and provenance; different seeds affect candidates", async () => {
  const w = workflow({ intensity: 3 }); const a = await run(w), b = await run(w);
  expect(b.rows).toEqual(a.rows);
  expect((await run({ ...w, seed: 123 })).rows).not.toEqual(a.rows);
});
it("deduplicates low-diversity requests without emitting original or empty text", async () => {
  const w = mutationWorkflow({ text: "月月", parts: [] }, { operations: '["delete"]', count: 256, intensity: 1 }, 0);
  expect((await run(w)).rows.map(c => c.text)).toEqual(["月"]);
});
it("reorders whole words and dictionary replaces a whole unlocked word", async () => {
  const c = { text: "月亮 邮差", parts: [] };
  expect((await run(mutationWorkflow(c, { operations: '["reorder"]' }, 42))).rows.map(c => c.text)).toEqual(["邮差 月亮"]);
  const rows = (await run(mutationWorkflow(c, { operations: '["dictionary"]', locks: "[0,1]", resourceId: "words" }, 42))).rows;
  expect(rows.map(c => c.text).sort()).toEqual(["月亮 云梦", "月亮 夜风"].sort());
});
it("rounds stay flat and source links point to actual parent", async () => {
  let c = source;
  for (let i = 0; i < 15; i++) { c = (await run(mutationWorkflow(c, { operations: '["replace"]', count: 1 }, i))).rows[0]; expect(c.derivation?.round).toBe(i + 1); expect(JSON.stringify(mutationSource(c)).length).toBeLessThan(1600); }
});
it.each([{ locks: "[99]" }, { locks: "[0,0]" }, { operations: '["eval"]' }, { operations: "[]" }, { count: 257 }, { intensity: 4 }, { algorithm: 2 }, { source: '{"text":"x","parts":null}' }, { operations: '["dictionary"]' }])("rejects malformed or oversized configuration %j", p => {
  const supplied: Params = { ...mutationDefaults }; Object.assign(supplied, p);
  expect(() => normalizeParams("mutate", supplied)).toThrow();
});
it("inherits step, wall time, cancellation and output budgets", async () => {
  await expect(run(workflow(), reader, { steps: 10, milliseconds: 10000 })).rejects.toMatchObject({ diagnostic: { code: "BUDGET" } });
  await expect(run(workflow(), reader, { steps: 300000, milliseconds: -1 })).rejects.toMatchObject({ diagnostic: { code: "BUDGET" } });
  const abort = new AbortController(); abort.abort(); await expect(run(workflow(), reader, undefined, abort.signal)).rejects.toMatchObject({ diagnostic: { code: "CANCELLED" } });
  expect((await run({ ...workflow(), limit: 2 })).rows).toHaveLength(2);
});
it("dictionary buffers at most256 rows and rejects oversized working text", async () => {
  let read = 0; const words = async function* () { for (let i = 0; i < 1000000; i++) { read++; yield { text: `词${i}`, parts: [] }; } };
  await run(workflow({ operations: '["dictionary"]', resourceId: "words", count: 1 }), words); expect(read).toBe(256);
  await expect(run(workflow({ operations: '["dictionary"]', resourceId: "words" }), async function* () { for (let i = 0; i < 256; i++) yield { text: "字".repeat(1024), parts: [] }; })).rejects.toMatchObject({ diagnostic: { code: "BUDGET" } });
});
it("contract, graph/NameScript and clipboard-compatible data retain deterministic semantics", async () => {
  const w = workflow(); validateGraph(w); expect(operatorContracts.mutate.ast).toBeUndefined(); expect(operatorContracts.mutate.lab).toBe(false);
  expect((await run(parseScript(toScript(w), w))).rows).toEqual((await run(w)).rows);
});
it("uses existing gamecheck filtering/annotation after mutation with truthful sources", async () => {
  const input = { text: "月星", parts: [] }, p = { count: 24, operations: '["replace","insert"]', pool: "云a" };
  const rule = { ...defaultGameRule, forbidden: "a" };
  const filtered = (await run(mutationWorkflow(input, p, 42, { rule, mode: "filter" }))).rows;
  expect(filtered.length).toBeGreaterThan(0); expect(filtered.every(c => checkGameId(c.text, rule).valid)).toBe(true);
  const annotated = (await run(mutationWorkflow(input, p, 42, { rule, mode: "annotate" }))).rows;
  expect(annotated.length).toBeGreaterThan(filtered.length); expect(annotated.some(c => c.notes?.includes("不符合本地游戏规则"))).toBe(true); expect(annotated.every(c => c.derivation?.kind === "mutation")).toBe(true);
});
it("portable dictionary workflow remaps references, preserves factual parent IDs and supports version1 result data", async () => {
  await saveNewResource({ id: "words", kind: "word", name: "words", description: "", count: 0, version: 1, updatedAt: 0, color: "green" }, ["云梦", "夜风"]);
  const w = workflow({ operations: '["dictionary"]', resourceId: "words" }); expect(dependencyIds(w)).toEqual(["words"]);
  const original = await run(w, readResource), pkg = await exportPackage(w); const restored = await importPackage(pkg);
  const next = await run(restored, readResource); expect(next.rows.map(c => c.text)).toEqual(original.rows.map(c => c.text)); expect(next.rows[0].derivation?.parent.runId).toBe("old-run");
});
it("favorites, backup/reload, next round and saved words feed P2-A executable subgraph", async () => {
  const w = workflow(); await beginRun(w, "new-run"); const { rows } = await run(w); await appendRunBatch("new-run", rows); await finishRun("new-run", "done"); await toggleFavorite(rows[0]);
  const backup = await exportRun("new-run"); await db.delete(); await db.open(); await restoreRun(backup);
  const saved = (await db.favorites.toArray())[0]; expect(saved.derivation).toEqual(rows[0].derivation);
  expect((await run(mutationWorkflow(saved, { count: 1 }, 9))).rows[0].derivation?.round).toBe(2);
  await saveNewResource({ id: "saved", kind: "word", name: "变异库", description: "", count: 0, version: 1, updatedAt: 0, color: "green" }, rows.map(c => c.text));
  const reuse: Workflow = { ...w, nodes: [{ id: "r", op: "resource", inputs: [], params: { resourceId: "saved" } }, { id: "out", op: "output", inputs: ["r"], params: {} }] };
  const sub = extractSubgraph(reuse, ["r"]); expect(new Set((await run(sub.workflow, readResource)).rows.map(c => c.text))).toEqual(new Set(rows.map(c => c.text)));
});
