import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, readResource } from "../storage/db";
import { openCorpusPreset } from "../storage/corpus";
import { corpusPresetMarker, corpusPresets, workflowCardInfo } from "../core/corpus-presets";
import { importPackage } from "../core/sharing";
import { execute } from "../core/engine";
import type { Workflow } from "../core/model";

const bundles=import.meta.glob("../../public/workflows/ff14-*.json",{eager:true,import:"default"});

beforeEach(async()=>{await db.delete();await db.open();});
it("opens each of the six shipped workflows concurrently once and preserves user edits on reopen",async()=>{
  for(const preset of corpusPresets) {
    const [a,b]=await Promise.all([openCorpusPreset(preset.style),openCorpusPreset(preset.style)]);
    expect(a.id).toBe(b.id);expect(a.comments).toContain(corpusPresetMarker(preset.style));
    await db.workflows.put({...a,name:`我的${preset.label}`,seed:777});
    expect((await openCorpusPreset(preset.style)).name).toBe(`我的${preset.label}`);
    expect((await openCorpusPreset(preset.style)).seed).toBe(777);
  }
  expect(await db.workflows.count()).toBe(6);expect(await db.resources.count()).toBe(12);
});
it.each(corpusPresets)("public downloadable $style is a standalone portable workflow with identical seeded output",async(preset)=>{
  const data=bundles[`../../public/workflows/ff14-${preset.style}.json`] as {version:number;resources:unknown[]};
  expect(data.version).toBe(6);expect(data.resources).toHaveLength(2);
  const workflow=await importPackage(data);
  const texts:string[]=[];
  await execute(workflow,readResource,b=>texts.push(...b.map(c=>c.text)),undefined,{resourceMetadata:id=>db.resources.get(id)});
  expect(texts).toHaveLength(75);expect(new Set(texts).size).toBe(75);
  expect(texts.every(t=>[...t].length>=2&&[...t].length<=(preset.style==="haidu"?3:6))).toBe(true);
  const current=await openCorpusPreset(preset.style);expect(current.id).toBe(workflow.id);
});
it("cards describe current saved settings and keep custom names independently selectable",async()=>{
  const w=await openCorpusPreset("nature");
  const edited:Workflow={...w,name:"我的自然草稿",nodes:w.nodes.map(n=>n.op==="corpus"?{...n,params:{...n.params,minLength:4,maxLength:8}}:n)};
  expect(workflowCardInfo(edited).length).toBe("4–8 字");expect(edited.name).toBe("我的自然草稿");
});
