import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import catalog from "../../examples/haidu-chao-ren.original.catalog.json";
import portable from "../../examples/haidu-chao-ren.original.portable.json";
import { db, readResource, addEntries } from "../storage/db";
import { execute } from "../core/engine";
import { importPackage, exportPackage } from "../core/sharing";
import { openHaidu, openHaiduOriginal } from "../storage/haidu";
import { parseScript, toScript } from "../core/script";
import type { Candidate, Workflow } from "../core/model";

beforeEach(async () => { await db.delete(); await db.open(); });
async function generate(workflow: Workflow, limit = workflow.limit) {
  const values: Candidate[] = [];
  await execute({ ...workflow, limit }, readResource, batch => values.push(...batch), undefined, { resourceMetadata: id => db.resources.get(id) });
  return values;
}

describe("original xlsx workflow installed in GlyphForge", () => {
  it("keeps every original source row and imports all distinct words as independent resources", () => {
    expect(Object.values(catalog.pools).map(p => p.rows.length)).toEqual([61, 78, 195, 201]);
    expect(portable.version).toBe(6); expect(portable.resources).toHaveLength(8);
    for (const [key, pool] of Object.entries(catalog.pools)) {
      const resource = portable.resources.find(r => r.meta.id === `haidu-original-${key}`)!;
      expect(resource.entries).toEqual([...new Set(pool.rows.map(r => r.text))]);
      expect(resource.meta.description).toContain(pool.range);
    }
    expect(portable.resources.find(r => r.meta.id === "haidu-original-twoHead")!.entries).toHaveLength(194);
    expect(portable.resources.filter(r => r.meta.definition)).toHaveLength(4);
  });
  it("uses the original five formulas and B-column words for both direct and small-prefix output", async () => {
    const workflow = await importPackage(portable);
    const output = await generate(workflow, 10000), texts = new Set(output.map(c => c.text));
    for (const { text } of catalog.pools.twoTail.rows) {
      expect(texts.has(text), text).toBe(true); expect(texts.has(`小${text}`), text).toBe(true);
    }
    const pools = Object.fromEntries(Object.entries(catalog.pools).map(([k, p]) => [k, new Set(p.rows.map(r => r.text))]));
    const valid = (t: string) => (pools.oneHead.has(t[0]) && pools.oneTail.has(t.slice(1))) || (pools.oneHead.has(t[0]) && pools.twoTail.has(t.slice(1))) || (pools.twoHead.has(t.slice(0, 2)) && pools.oneTail.has(t.slice(2))) || (t[0] === "小" && pools.twoTail.has(t.slice(1))) || pools.twoTail.has(t);
    expect(output.every(c => valid(c.text))).toBe(true);
    expect(workflow.nodes[0].program!.body).toHaveLength(5);
    expect(workflow.nodes[1].params.reviewedResourceId).toBe("");
  });
  it("generates unique two/three-character results with a repeatable seed and NameScript round trip", async () => {
    const w = await importPackage(portable), first = (await generate(w)).map(c => c.text);
    expect(first).toHaveLength(75); expect(new Set(first).size).toBe(75);
    expect(first.every(t => [2, 3].includes([...t].length))).toBe(true);
    expect((await generate(parseScript(toScript(w), w))).map(c => c.text)).toEqual(first);
    expect((await generate({ ...w, seed: w.seed + 1 })).map(c => c.text)).not.toEqual(first);
  });
  it("portable export/import preserves every resource, definition and result", async () => {
    const w = await importPackage(portable), out = await exportPackage(w), restored = await importPackage(out), again = await exportPackage(restored);
    expect(again.resources.map(r => r.entries)).toEqual(out.resources.map(r => r.entries));
    expect(again.resources.filter(r => r.meta.definition)).toHaveLength(4);
    expect((await generate(restored)).map(c => c.text)).toEqual((await generate(w)).map(c => c.text));
  });
  it("updating the actual B-column resource changes direct/small results without rewriting the workflow", async () => {
    const w = await importPackage(portable), resources = (await exportPackage(w)).resources;
    const tail = resources.find(r => r.meta.name.startsWith("原版海都 · 2字后缀") && !r.meta.definition)!;
    await addEntries(tail.meta.id, ["测试"]);
    const filtered = { ...w, nodes: w.nodes.map(n => n.op === "curate" ? { ...n, params: { ...n.params, includes: "测试" } } : n) };
    const texts = (await generate(filtered)).map(c => c.text);
    expect(texts).toContain("测试"); expect(texts).toContain("小测试");
  });
  it("installs once, preserves edits/favorites and keeps the expanded workflow separate", async () => {
    const expanded = await openHaidu(), [a, b] = await Promise.all([openHaiduOriginal(), openHaiduOriginal()]);
    expect(a.id).toBe(b.id); expect(a.id).not.toBe(expanded.id);
    await db.workflows.put({ ...a, name: "我的原版草稿", seed: 777 });
    await db.favorites.put({ text: "留住", parts: [], savedAt: 1 });
    expect((await openHaiduOriginal()).seed).toBe(777);
    expect((await openHaiduOriginal()).name).toBe("我的原版草稿");
    expect(await db.favorites.get("留住")).toBeTruthy();
    expect(await db.workflows.get(expanded.id)).toBeTruthy();
  });
});
