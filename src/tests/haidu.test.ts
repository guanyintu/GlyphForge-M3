import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import pkg from "../../examples/haidu-chao-ren.portable.json";
import legacy from "../../examples/haidu-chao-ren.v1.portable.json";
import catalog from "../../examples/haidu-chao-ren.catalog.json";
import { db, readResource, saveRelationRows } from "../storage/db";
import { importPackage, exportPackage } from "../core/sharing";
import { execute } from "../core/engine";
import { parseScript, toScript } from "../core/script";
import { candidateCategory, candidateRecipe } from "../core/curation";
import { openHaidu } from "../storage/haidu";
import { curate, curationDefaults } from "../core/curation";
import type { Candidate, Params, Workflow } from "../core/model";

beforeEach(async () => { await db.delete(); await db.open(); });
async function generate(w: Workflow, values: Params = {}, limit = w.limit) {
  const candidates: Candidate[] = [];
  const workflow = { ...w, limit, nodes: w.nodes.map(n => n.op === "curate" ? { ...n, params: { ...n.params, ...values } } : n) };
  const stats = await execute(workflow, readResource, batch => { candidates.push(...batch); }, undefined, { resourceMetadata: id => db.resources.get(id) });
  return { candidates, stats };
}
describe("Haidu: independent resources through the existing AST and engine", () => {
  it("has distinct readable words and explicit, scored, valid relations", () => {
    const cores = catalog.categories.flatMap(c => c.cores.map(t => t.text));
    expect(new Set(cores).size).toBeGreaterThanOrEqual(300);
    expect(new Set(catalog.suffixes).size).toBeGreaterThanOrEqual(100);
    expect(new Set(catalog.prefixes).size).toBeGreaterThanOrEqual(60);
    expect(new Set(catalog.companions).size).toBeGreaterThanOrEqual(200);
    expect(cores.every(t => /^[\u4e00-\u9fff]{2}$/.test(t))).toBe(true);
    const rows = pkg.resources[0].relationRows!;
    expect(rows.length).toBeGreaterThanOrEqual(1000);
    const seen = new Set<string>();
    for (const row of rows) {
      expect(row.weight).toBeGreaterThanOrEqual(70);
      expect(Object.keys(JSON.parse(row.note))).toHaveLength(6);
      expect(row.direction).toBe("directed");
      expect(row.tags.some(t => t.startsWith("风格:"))).toBe(true);
      const key = `${row.left}/${row.right}/${row.tags.find(t => t.startsWith("配方:"))}`;
      expect(seen.has(key)).toBe(false); seen.add(key);
    }
  });
  it("round trips every word, relation direction, score, tag and note", async () => {
    const w = await importPackage(pkg), exported = await exportPackage(w), restored = await importPackage(exported), again = await exportPackage(restored);
    expect(exported.resources.map(r => r.entries)).toEqual(again.resources.map(r => r.entries));
    expect(exported.resources.map(r => r.relationRows)).toEqual(again.resources.map(r => r.relationRows));
    expect((await generate(w)).candidates.map(c => c.text)).toEqual((await generate(restored)).candidates.map(c => c.text));
  });
  it.each(["2", "3", "2,3"])("enforces %s characters before the output limit and deduplicates", async lengths => {
    const w = await importPackage(pkg), { candidates } = await generate(w, { lengths }, 200);
    expect(candidates).toHaveLength(200);
    expect(candidates.every(c => lengths.split(",").map(Number).includes([...c.text].length))).toBe(true);
    expect(new Set(candidates.map(c => c.text)).size).toBe(200);
    expect(candidates.every(c => c.parts.some(p => p.pair))).toBe(true);
  });
  it("reproduces seeds, balances categories and limits repeated cores", async () => {
    const w = await importPackage(pkg), a = await generate(w), b = await generate(w), c = await generate({ ...w, seed: 43 });
    expect(a.candidates).toEqual(b.candidates);
    expect(a.candidates.map(c => c.text)).not.toEqual(c.candidates.map(c => c.text));
    const counts = catalog.categories.map(cat => a.candidates.filter(c => candidateCategory(c) === cat.name).length);
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
    expect(new Set(a.candidates.map(c => c.parts[0].pair!.left)).size).toBe(24);
  });
  it("supports category, contains, exclusions and nonoverlapping continuing draws", async () => {
    const w = await importPackage(pkg), a = await generate(w), b = await generate(w, { offset: 24 });
    expect(b.candidates.some(c => a.candidates.some(x => x.text === c.text))).toBe(false);
    const filtered = await generate(w, { category: "赛博", includes: "猫", excludes: "霓虹,故障" }, 100);
    expect(filtered.candidates.length).toBeGreaterThan(5);
    expect(filtered.candidates.every(c => candidateCategory(c) === "赛博" && c.text.includes("猫") && !/霓虹|故障/.test(c.text))).toBe(true);
  });
  it.each(["suffix", "prefix", "semantic", "contrast", "double", "echo"])("runs the %s recipe only when selected", async recipe => {
    const w = await importPackage(pkg), { candidates } = await generate(w, { recipes: recipe, lengths: "2,3,4" }, 200);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c => candidateRecipe(c) === recipe)).toBe(true);
    if (recipe === "double") expect(candidates.every(c => [...c.text].length === 4)).toBe(true);
    if (recipe === "echo") expect(candidates.every(c => [2,4].includes([...c.text].length))).toBe(true);
  });
  it("updates edited relationship rows on the next execution", async () => {
    const w = await importPackage(pkg), id = String(w.nodes[0].program!.body[0].kind === "for" ? (await exportPackage(w)).resources[0].meta.id : "");
    await saveRelationRows(id, [{ left: "海盐", right: "鹅", relation: "associated", direction: "directed", tags: ["风格:海洋", "配方:suffix"], weight: 99 }]);
    const { candidates } = await generate(w, { includes: "海盐鹅" });
    expect(candidates.map(c => c.text)).toEqual(["海盐鹅"]);
  });
  it("preserves graph / NameScript round trip and v1 workflow behavior", async () => {
    const w = await importPackage(pkg), parsed = parseScript(toScript(w), w);
    expect((await generate(parsed)).candidates).toEqual((await generate(w)).candidates);
    const old = await importPackage(legacy);
    const { candidates } = await generate(old);
    expect(candidates).toHaveLength(344);
  });
  it("opening twice preserves existing resources, edits and favorites", async () => {
    const w = await openHaidu(); await db.workflows.put({ ...w, seed: 777 });
    const count = await db.resources.count();
    await db.favorites.put({ text: "旧收藏", parts: [], savedAt: 1 });
    expect((await openHaidu()).seed).toBe(777);
    expect(await db.resources.count()).toBe(count);
    expect(await db.favorites.get("旧收藏")).toBeDefined();
  });
  it("ranks explicit quality before low scores and rejects oversized input rather than silently biasing", async () => {
    async function* source(count: number) {
      for (let i=0;i<count;i++) yield { text: i ? `低${String.fromCodePoint(0x4e00+i)}` : "高质", parts: [{ resourceId: "test", text: "pair", pair: { left: "高质", right: "猫", relation: "associated" as const, weight: i ? 10 : 99 } }] };
    }
    const list: Candidate[] = [];
    for await (const c of curate(source(10000), curationDefaults, 42, () => {})) list.push(c);
    expect(list).toHaveLength(10000); expect(list[0].text).toBe("高质");
    await expect((async () => { for await (const _ of curate(source(10001), curationDefaults, 42, () => {})) void _; })()).rejects.toThrow("10,000");
  });
  it("benchmarks import, full relationship-table execution and export with a generous regression bound", async () => {
    const start = performance.now(), w = await importPackage(pkg), imported = performance.now();
    const { candidates, stats } = await generate(w, {}, 10000), executed = performance.now();
    await exportPackage(w); const exported = performance.now();
    console.log("HAIDU_BENCH", JSON.stringify({ importMs: imported-start, executeMs: executed-imported, exportMs: exported-executed, results: candidates.length, steps: stats.steps }));
    expect(candidates.length).toBeGreaterThan(1200);
    expect(exported-start).toBeLessThan(10000);
  });
});
