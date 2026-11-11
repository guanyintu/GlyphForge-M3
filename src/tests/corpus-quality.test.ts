import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, readResource } from "../storage/db";
import { importPackage, exportPackage } from "../core/sharing";
import { execute } from "../core/engine";
import { loadBundled, installCorpus, corpusId, corpusWorkflow, upgradeCorpusQuality } from "../storage/corpus";
import { corpusPresets } from "../core/corpus-presets";
import { rolesFor } from "../core/corpus-vocabulary";
import { parseCorpusPackage } from "../core/corpus-package";
import cute from "../../data/playertrack/cute.json";
import type { Candidate } from "../core/model";

const packages=import.meta.glob("../../public/workflows/ff14-*.json",{eager:true,import:"default"});
beforeEach(async()=>{await db.delete();await db.open();});
it.each([
  ["cute","豆子不想上班"], ["nature","叶飞鸟"], ["trend","摆烂绝对"], ["haidu","零海盐"],
])("%s: complete clauses, incompatible nouns and arbitrary character prefixes cannot be used as interchangeable word slots",async(style,bad)=>{
  const workflow=await importPackage(packages[`../../public/workflows/ff14-${style}.json`]);
  const texts:string[]=[];
  await execute(workflow,readResource,b=>texts.push(...b.map(c=>c.text)),undefined,{resourceMetadata:id=>db.resources.get(id)});
  expect(texts.length).toBeGreaterThan(0);expect(texts).not.toContain(bad);
});

it.each(corpusPresets)("$style: many seeds only emit declared semantic recipes, with real token provenance",async preset=>{
  const bundle=await loadBundled(preset.style),id=await installCorpus(bundle),w=await corpusWorkflow(id);
  const byText=new Map(bundle.entries.map(m=>[m.text,m]));
  for(const seed of [0,1,7,42,731,2026]) {
    const values:Candidate[]=[];
    await execute({...w,seed},readResource,b=>values.push(...b),undefined,{resourceMetadata:id=>db.resources.get(id)});
    expect(values).toHaveLength(75);expect(new Set(values.map(c=>c.text)).size).toBe(75);
    for(const c of values) {
      const ruleId=c.notes!.find(n=>n.startsWith("配伍 v2："))!.slice("配伍 v2：".length);
      const rule=bundle.composition!.rules.find(r=>r.id===ruleId)!;
      expect(rule).toBeTruthy();expect(c.parts).toHaveLength(rule.slots.length);
      expect(c.parts.map(p=>p.text).join("")).toBe(c.text);
      c.parts.forEach((p,i)=>{expect(p.resourceId).toBe(id);const m=byText.get(p.text)!;expect(m.compositionRoles??rolesFor(preset.style,m.text)).toContain(rule.slots[i]);});
      if(c.parts.length>1)expect(c.parts.some((p,i)=>c.parts.slice(0,i).some(other=>[...p.text].some(ch=>other.text.includes(ch))))).toBe(false);
    }
  }
});
it("editorial supplements have no fabricated player/name frequencies and survive a full JSON round trip",async()=>{
  const bundle=await loadBundled("cute"),roundTrip=parseCorpusPackage(JSON.parse(JSON.stringify(bundle)));
  expect(roundTrip).toEqual(bundle);
  const editorial=bundle.entries.filter(m=>m.origin==="editorial");expect(editorial.length).toBeGreaterThan(0);
  for(const m of editorial){expect([m.frequency,m.playerCoverage,m.uniqueNameCount,m.currentCount,m.historyCount]).toEqual([0,0,0,0,0]);expect(m.positionsByLength).toEqual({});expect(m.provenance).toContain("编辑补充");}
});
it("the additive v1 upgrade preserves names, seeds, favorites, rejected words and all observed statistics",async()=>{
  const id=await installCorpus(cute),w=await corpusWorkflow(id);
  await db.workflows.add({...w,name:"我的旧工作流",seed:731});await db.favorites.add({text:"保留收藏",parts:[],savedAt:1});
  const entry=(await db.entries.where('[resourceId+text]').equals([id,"奶茶"]).first())!;
  const original={...entry.corpus!,manualWeight:7,review:"REJECTED" as const,enabled:false,semanticTags:["保留标签"]};
  await db.entries.update(entry.id!,{corpus:original});
  const before=await db.resources.get(id);await upgradeCorpusQuality();const after=await db.resources.get(id);
  expect(after!.version).toBe(before!.version+1);expect(after!.count).toBeGreaterThan(before!.count);
  const upgraded=(await db.entries.get(entry.id!))!.corpus!;
  expect({...upgraded,compositionRoles:undefined}).toEqual({...original,compositionRoles:undefined});
  expect(await db.workflows.get(w.id)).toMatchObject({name:"我的旧工作流",seed:731});expect(await db.favorites.get("保留收藏")).toBeTruthy();
  await upgradeCorpusQuality();expect(await db.resources.get(id)).toEqual(after);
  expect(await db.entries.where({resourceId:corpusId("cute")}).count()).toBe(after!.count);
});
it("an unsupported length yields fewer or no results instead of padding with arbitrary concatenation",async()=>{
  const id=await installCorpus(await loadBundled("haidu")),values:Candidate[]=[];
  await execute(await corpusWorkflow(id,"style",12,12),readResource,b=>values.push(...b),undefined,{resourceMetadata:id=>db.resources.get(id)});
  expect(values).toEqual([]);
});
it("portable workflows retain a custom semantic policy instead of silently falling back to shipped rules",async()=>{
  const bundle=await loadBundled("cute");
  bundle.composition={version:2,rules:[{id:"only-my-pets",slots:["tiny","pet"],weight:1}]};
  const id=await installCorpus(bundle),w=await corpusWorkflow(id);
  const run=async(workflow:typeof w)=>{const texts:string[]=[];await execute(workflow,readResource,b=>texts.push(...b.map(c=>c.text)),undefined,{resourceMetadata:id=>db.resources.get(id)});return texts;};
  const before=await run(w);expect(before.length).toBeGreaterThan(0);expect(before.length).toBeLessThan(20);
  const portable=await exportPackage(w);await db.delete();await db.open();
  const restored=await importPackage(portable);expect(await run(restored)).toEqual(before);
  expect((await db.resources.toArray()).find(r=>r.corpus)!.corpus!.composition).toEqual(bundle.composition);
});
