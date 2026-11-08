import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import pkg from "../../examples/haidu-chao-ren.portable.json";
import v2 from "../../examples/haidu-chao-ren.v2.portable.json";
import legacy from "../../examples/haidu-chao-ren.v1.portable.json";
import catalog from "../../examples/haidu-chao-ren.catalog.json";
import { db, readResource, addEntries, saveRelationRows } from "../storage/db";
import { importPackage, exportPackage, dependencyIds } from "../core/sharing";
import { execute } from "../core/engine";
import { parseScript, toScript } from "../core/script";
import { candidateCategory, curate, curationDefaults } from "../core/curation";
import { openHaidu } from "../storage/haidu";
import type { Candidate, Params, Workflow } from "../core/model";

beforeEach(async () => { await db.delete(); await db.open(); });
async function generate(w: Workflow, values: Params = {}, limit = w.limit) {
  const candidates: Candidate[] = [];
  const workflow = { ...w, limit, nodes: w.nodes.map(n => n.op === "curate" ? { ...n, params: { ...n.params, ...values } } : n) };
  const stats = await execute(workflow, readResource, batch => { candidates.push(...batch); }, undefined, { resourceMetadata: id => db.resources.get(id) });
  return { candidates, stats };
}
const resource = (suffix: string) => pkg.resources.find(r => r.meta.id.endsWith(suffix))!;
async function installedId(w: Workflow, label: string) {
  const resources = (await exportPackage(w)).resources;
  return resources.find(r => r.meta.name.includes(label))!.meta.id;
}

describe("Haidu workflow follows the reference's five columns", () => {
  it("keeps independent pools and explicit quality rows; every dependency is active", () => {
    expect(new Set(catalog.categories.flatMap(c => c.cores.map(t => t.text))).size).toBe(320);
    expect(resource("prefixes").entries.length).toBeGreaterThanOrEqual(60);
    expect(resource("suffixes").entries.length).toBeGreaterThanOrEqual(100);
    expect(resource("companions").entries.length).toBeGreaterThanOrEqual(200);
    expect(resource("pairs").relationRows!.length).toBeGreaterThanOrEqual(1000);
    expect(pkg.workflow.nodes.map(n => n.op)).toEqual(["program", "curate", "output"]);
    expect(pkg.workflow.nodes[0].program!.body).toHaveLength(5);
    expect(pkg.workflow.nodes.every(n => n.op !== "resource")).toBe(true);
    expect(pkg.resources.filter(r => r.meta.definition?.type === "dynamic")).toHaveLength(4);
    for (const r of pkg.resources.filter(r => r.meta.definition?.type === "dynamic")) {
      const d = r.meta.definition!;
      if (d.type === "dynamic") expect(d.workflow.nodes.map(n => n.op)).toEqual(["resource", "group", "output"]);
    }
  });
  it("round trips all source pools, definitions, scores, tags, directions and references", async () => {
    const w = await importPackage(pkg), exported = await exportPackage(w), copy = await importPackage(exported), again = await exportPackage(copy);
    expect(exported.resources.map(r => r.entries)).toEqual(again.resources.map(r => r.entries));
    expect(exported.resources.map(r => r.relationRows)).toEqual(again.resources.map(r => r.relationRows));
    expect(exported.resources.filter(r => r.meta.definition).length).toBe(4);
    expect(dependencyIds(copy)).not.toContain(String(w.nodes[1].params.reviewedResourceId));
    expect((await generate(w)).candidates.map(c => c.text)).toEqual((await generate(copy)).candidates.map(c => c.text));
  });
  it.each(["2", "3", "2,3"])("enforces %s before output limit and deduplicates", async lengths => {
    const w = await importPackage(pkg), { candidates } = await generate(w, { lengths }, 100);
    expect(candidates).toHaveLength(100);
    expect(candidates.every(c => lengths.split(",").map(Number).includes([...c.text].length))).toBe(true);
    expect(new Set(candidates.map(c => c.text)).size).toBe(100);
  });
  it("actually produces all five formula shapes with real pool provenance", async () => {
    const w = await importPackage(pkg), { candidates } = await generate(w, { reviewedResourceId: "" }, 10000);
    const prefix = await installedId(w,"单字前词"), suffix = await installedId(w,"单字后词");
    const head = await installedId(w,"双字前词与直出"), tail = await installedId(w,"双字后词");
    const ids = (c: Candidate) => new Set(c.parts.map(p => p.resourceId));
    expect(candidates.some(c => c.text.length===2 && ids(c).has(prefix) && ids(c).has(suffix))).toBe(true);
    expect(candidates.some(c => c.text.length===3 && ids(c).has(prefix) && ids(c).has(tail))).toBe(true);
    expect(candidates.some(c => c.text.length===3 && ids(c).has(head) && ids(c).has(suffix))).toBe(true);
    expect(candidates.some(c => c.text.startsWith("小") && c.text.length===3 && ids(c).has(head))).toBe(true);
    // Existing first-path dedup may retain an earlier 1+1 source for the same text.
    const texts=new Set(candidates.map(c=>c.text));
    expect(catalog.categories.flatMap(c=>c.cores).every(core=>texts.has(core.text))).toBe(true);
    expect(candidates.some(c=>c.text.length===2 && c.parts.length===1 && ids(c).has(head))).toBe(true);
  });
  it("new core words drive direct and small-prefix results without editing code or relations", async () => {
    const w = await importPackage(pkg), id = await installedId(w,"双字前词与直出");
    await addEntries(id,["测试"]);
    const { candidates } = await generate(w,{includes:"测试"},100);
    expect(candidates.map(c=>c.text)).toEqual(expect.arrayContaining(["测试","小测试"]));
    expect(candidates.every(c=>c.parts.some(p=>p.resourceId===id&&p.text==="测试"))).toBe(true);
  });
  it("uses existing explicit relation rows as ranking evidence, not as a separate generator", async () => {
    const w = await importPackage(pkg), core = await installedId(w,"双字前词与直出"), review = String(w.nodes[1].params.reviewedResourceId);
    await addEntries(core,["测验"]);
    await saveRelationRows(review,[{left:"测验",right:"猫",relation:"associated",direction:"directed",weight:99,tags:["风格:新风格","配方:suffix"]}]);
    const { candidates } = await generate(w,{category:"新风格"},100);
    expect(candidates.some(c=>c.text==="测验"&&c.parts.some(p=>p.resourceId===core)&&c.parts.some(p=>p.resourceId===review))).toBe(true);
  });
  it("repeats a fixed seed, changes samples with another seed, balances styles and continues without overlap", async () => {
    const w = await importPackage(pkg), a = await generate(w), b = await generate(w), c = await generate({...w,seed:43}), next = await generate(w,{offset:24});
    expect(a.candidates).toEqual(b.candidates);
    expect(a.candidates.map(c=>c.text)).not.toEqual(c.candidates.map(c=>c.text));
    expect(new Set(a.candidates.map(candidateCategory)).size).toBeGreaterThanOrEqual(7);
    expect(next.candidates.some(c=>a.candidates.some(x=>x.text===c.text))).toBe(false);
  });
  it("supports category, includes, multiple exclusions and NameScript editing", async () => {
    const w = await importPackage(pkg), parsed = parseScript(toScript(w),w);
    expect((await generate(w)).candidates).toEqual((await generate(parsed)).candidates);
    const { candidates } = await generate(w,{category:"赛博",includes:"像",excludes:"霓虹,故障"},100);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every(c=>candidateCategory(c)==="赛博"&&c.text.includes("像")&&!/霓虹|故障/.test(c.text))).toBe(true);
  });
  it("keeps old v1/v2 workflows valid and installs v3 without changing prior edits or favorites", async () => {
    const old = await importPackage(legacy); expect((await generate(old)).candidates).toHaveLength(344);
    const second = await importPackage(v2); expect((await generate(second)).candidates).toHaveLength(24);
    await db.workflows.put({...second,seed:777}); await db.favorites.put({text:"旧收藏",parts:[],savedAt:1});
    const current = await openHaidu(); expect(current.id).not.toBe(second.id);
    expect((await openHaidu()).id).toBe(current.id);
    expect((await db.workflows.get(second.id))?.seed).toBe(777);
    expect(await db.favorites.get("旧收藏")).toBeDefined();
  });
  it("bounds ranking and refuses excess candidates without silent category bias", async () => {
    async function* source(count:number) { for(let i=0;i<count;i++) yield {text:`低${String.fromCodePoint(0x4e00+i)}`,parts:[]}; }
    const result: Candidate[]=[];
    for await (const c of curate(source(10000),curationDefaults,42,()=>{})) result.push(c);
    expect(result).toHaveLength(10000);
    await expect((async()=>{for await(const c of curate(source(10001),curationDefaults,42,()=>{})) void c;})()).rejects.toThrow("10,000");
  });
  it("measures actual sampled workflow execution and portable export", async () => {
    const started=performance.now(), w=await importPackage(pkg), imported=performance.now();
    const { candidates,stats }=await generate(w,{},10000), executed=performance.now(); await exportPackage(w);
    console.log("HAIDU_WORKFLOW_BENCH",JSON.stringify({importMs:imported-started,executeMs:executed-imported,exportMs:performance.now()-executed,count:candidates.length,steps:stats.steps}));
    expect(candidates.length).toBeGreaterThan(1500); expect(stats.steps).toBeLessThan(300000);
  });
});
