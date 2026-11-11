import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import cute from "../../data/playertrack/cute.json";
import nature from "../../data/playertrack/nature.json";
import literary from "../../data/playertrack/literary.json";
import fantasy from "../../data/playertrack/fantasy.json";
import trend from "../../data/playertrack/trend.json";
import haidu from "../../data/playertrack/haidu.json";
import report from "../../data/playertrack/report.json";
import { db, readResource } from "../storage/db";
import { configureCorpus, corpusId, corpusWorkflow, exportCorpus, installBaseCorpus, installCorpus, reviewMaterials, updateCorpusRelation, updateMaterials } from "../storage/corpus";
import { parseCorpusPackage } from "../core/corpus-package";
import { corpusModes, materialWeight } from "../core/corpus";
import { execute } from "../core/engine";
import { exportPackage, importPackage } from "../core/sharing";
import { parseScript, toScript } from "../core/script";
import type { Candidate, Workflow } from "../core/model";

beforeEach(async () => {await db.delete();await db.open();});
const packages = [cute,nature,literary,fantasy,trend,haidu];
async function generate(w:Workflow) {
  const out:Candidate[]=[];
  await execute(w,readResource,b=>out.push(...b),undefined,{resourceMetadata:id=>db.resources.get(id)});
  return out;
}
describe("PlayerTrack aggregated corpus",()=>{
  it("validates all six independent bundles and actual all-length report",()=>{
    for(const p of packages){expect(parseCorpusPackage(p).entries.length).toBe(report.styles[p.style as keyof typeof report.styles]);expect(p.entries.every(m=>m.frequency>0)).toBe(true);}
    expect(report.lengths.map(r=>r.length)).toEqual([1,2,3,4,5,6,7,8,9]);
    expect(report.lengths.reduce((n,r)=>n+r.deduplicatedPlayerNames,0)).toBe(report.deduplicatedPlayerNames);
    expect(report.lengths.find(r=>r.length===6)!.pureHan).toBeGreaterThan(6000);
    const overlap = cute.entries.filter(a=>trend.entries.some(b=>a.text===b.text)).length;
    expect(overlap/cute.entries.length).toBeLessThan(.25);
    expect(report.databaseUnchanged).toBe(true);
  });
  it("installs concurrently once and preserves edits, favorites and existing resources",async()=>{
    await db.resources.add({id:"old",name:"旧库",description:"",kind:"word",color:"green",count:0,version:1,updatedAt:1});
    await db.favorites.add({text:"留下",parts:[],savedAt:1});
    await Promise.all([installCorpus(cute),installCorpus(cute)]);
    expect(await db.entries.where({resourceId:corpusId("cute")}).count()).toBe(cute.entries.length);
    await updateMaterials(corpusId("cute"),[{text:cute.entries[0].text,patch:{manualWeight:3,review:"REJECTED",enabled:false}}]);
    await installCorpus(cute);
    expect((await exportCorpus(corpusId("cute"))).entries[0].manualWeight).toBe(3);
    expect(await db.favorites.get("留下")).toBeTruthy();expect(await db.resources.get("old")).toBeTruthy();
  });
  it("keeps separate style review decisions and a lossless independent JSON round trip",async()=>{
    await installCorpus(cute);await installCorpus(nature);
    const id=corpusId("cute");await reviewMaterials(id,[cute.entries[0].text],"APPROVED");
    const first=await exportCorpus(id);await db.delete();await db.open();await installCorpus(first);
    expect(await exportCorpus(id)).toEqual(first);
  });
  it("never generates pending, rejected or disabled materials, including standard resource nodes",async()=>{
    const p=parseCorpusPackage(cute);for(const m of p.entries){m.review="PENDING";m.enabled=true;}
    await installCorpus(p);expect(await generate(await corpusWorkflow(corpusId("cute")))).toEqual([]);
    await reviewMaterials(corpusId("cute"),["奶茶"],"APPROVED");
    expect((await generate(await corpusWorkflow(corpusId("cute")))).map(c=>c.text)).toContain("奶茶");
    await configureCorpus(corpusId("cute"),{enabled:false});expect(await generate(await corpusWorkflow(corpusId("cute")))).toEqual([]);
  });
  it.each(packages)("generates style $style deterministically with declared length and real resource provenance",async(p)=>{
    const id=await installCorpus(p),w=await corpusWorkflow(id),out=await generate(w);
    expect(out.length).toBeGreaterThan(20);expect(new Set(out.map(c=>c.text)).size).toBe(out.length);
    expect(out.every(c=>[...c.text].length>=2&&[...c.text].length<=p.maxLength)).toBe(true);
    if(p.style!=="haidu")expect(out.some(c=>[...c.text].length>3)).toBe(true);
    expect(out.every(c=>c.parts.length>0&&c.parts.every(s=>s.resourceId===id&&s.version===1))).toBe(true);
    expect(await generate(w)).toEqual(out);
    expect((await generate(parseScript(toScript(w),w))).map(c=>c.text)).toEqual(out.map(c=>c.text));
  });
  it("supports all five weight modes and exact length position evidence with soft preferences",async()=>{
    const m=parseCorpusPackage(haidu).entries.find(m=>m.frequency>20)!;
    const modified={...m,positionsByLength:{"2":{count:100,roles:{FIRST:100},absolute:{"1":100},relativeDeciles:{"0":100},preference:"FIRST",confidence:"SUFFICIENT_SAMPLE",share:1}}};
    expect(materialWeight(modified,"natural","LAST",2)).toBeGreaterThan(0);
    expect(materialWeight(modified,"natural","FIRST",3)).toBe(materialWeight(m,"natural","FIRST",100));
    await installCorpus(haidu);
    const outputs=[];
    for(const mode of Object.keys(corpusModes)){const out=await generate(await corpusWorkflow(corpusId("haidu"),mode));expect(out.length).toBeGreaterThan(20);outputs.push(out.map(c=>c.text).join(","));}
    expect(new Set(outputs).size).toBe(5);
  });
  it("allows long fantasy output and user-adjusted haidu lengths",async()=>{
    const p=parseCorpusPackage(fantasy);p.entries=p.entries.filter(m=>m.length>=4);p.relations=[];
    await installCorpus(p);expect((await generate(await corpusWorkflow(corpusId("fantasy"),"style",8,10))).some(c=>[...c.text].length>=8)).toBe(true);
    await installCorpus(haidu);expect((await generate(await corpusWorkflow(corpusId("haidu"),"style",4,6))).every(c=>[...c.text].length>=4)).toBe(true);
  });
  it("workflow portable snapshots preserve corpus metadata, disabled rows, and seeded generation",async()=>{
    const id=await installCorpus(cute), w=await corpusWorkflow(id);
    await reviewMaterials(id,[cute.entries[0].text],"REJECTED");
    const out=await generate(w),p=await exportPackage(w);expect(p.version).toBe(6);
    await db.delete();await db.open();const restored=await importPackage(p);expect((await generate(restored)).map(c=>c.text)).toEqual(out.map(c=>c.text));
    const again=await exportPackage(restored);
    expect(again.resources[0].entries.length).toBe(cute.entries.length);
  });
  it("rejects malformed counts, tags, duplicate entries, endpoint mismatch atomically",async()=>{
    for(const change of [ (p:ReturnType<typeof parseCorpusPackage>)=>{p.entries[0].manualWeight=NaN;}, (p:ReturnType<typeof parseCorpusPackage>)=>{p.entries.push(p.entries[0]);}, (p:ReturnType<typeof parseCorpusPackage>)=>{p.entries[0].length=100;} ]){
      const p=parseCorpusPackage(cute);change(p);await expect(installCorpus(p)).rejects.toThrow();
    }
    expect(await db.resources.count()).toBe(0);
  });
  it("installs all 9k aggregate materials without changing database schema or overwriting old assets",async()=>{
    const id=await installBaseCorpus();expect(await db.entries.where({resourceId:id}).count()).toBe(Object.values(report.materials).reduce((a,b)=>a+b,0));
    const first=await db.entries.where({resourceId:id}).limit(50).toArray();expect(first).toHaveLength(50);
    expect(db.verno).toBe(7);
  });
  it("approved relationship edits affect generation, survive repeated import and preserve portable provenance",async()=>{
    const id=await installCorpus(haidu),p=await exportCorpus(id);
    const relation=p.relations.find(r=>p.entries.some(m=>m.text===r.left&&m.enabled)&&p.entries.some(m=>m.text===r.right&&m.enabled)&&[...r.left+r.right].length<=3)!;
    expect(relation).toBeTruthy();
    await updateCorpusRelation(id,relation.left,relation.right,{type:"prefix",review:"APPROVED",enabled:true});
    await installCorpus(haidu);
    const w=await corpusWorkflow(id),out=await generate(w),approved=out.find(c=>c.text===relation.left+relation.right)!;
    expect(approved.parts.some(p=>p.resourceId===`${id}-relations`)).toBe(true);
    const portable=await exportPackage(w);await db.delete();await db.open();const restored=await importPackage(portable);
    expect((await generate(restored)).map(c=>c.text)).toEqual(out.map(c=>c.text));
  });
  it("combines independent corpus sources through the existing concat workflow",async()=>{
    const a=await installCorpus(cute),b=await installCorpus(haidu),w=await corpusWorkflow(a);
    w.nodes=[{id:"a",op:"resource",inputs:[],params:{resourceId:a}},{id:"b",op:"resource",inputs:[],params:{resourceId:b}},
      {id:"mix",op:"concat",inputs:["a","b"],params:{separator:""}},{id:"out",op:"output",inputs:["mix"],params:{}}];
    const result=await generate({...w,limit:20});expect(result.length).toBe(20);
    expect(result.every(c=>c.parts.some(p=>p.resourceId===a)&&c.parts.some(p=>p.resourceId===b))).toBe(true);
  });
});
