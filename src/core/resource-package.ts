import type { ResourcePlan } from "./resource-catalog";
import { guardJSON } from "./packs";
import { workflowPacks, installPacks } from "../storage/packs";
import { visitProgramExpressions } from "./program";
import { operators } from "./model";
import type { Resource, Workflow } from './model';
import { db, readStaticResource } from '../storage/db';
import { captureResources, assertResourcePlan } from '../storage/resource-runtime';
import { planResources, rebindWorkflowResources, validateResource, workflowResourceIds } from './resource-catalog';
import { validateGraph } from './script';
import { allNodes } from './subgraphs';
import { normalizeParams } from './contracts';
import { normalizePair, validatePair } from './relations';
import type { PairValue } from './model';
import { parseCorpusPackage } from './corpus-package';
import type { CorpusMaterial } from './corpus';

function usedOperators(workflows:Workflow[]) {const used=new Set<string>();for(const w of workflows)for(const n of allNodes(w)){used.add(n.op);if(n.program)visitProgramExpressions(n.program,e=>{if(e.kind==="call" && Object.hasOwn(operators,e.name))used.add(e.name);});}return [...used];}
interface Snapshot {meta:Resource;entries:string[];relationRows?:PairValue[];corpusEntries?:CorpusMaterial[]}
export async function exportResourcePackage(workflow:Workflow,includeResources:boolean|string[]=true,signal?:AbortSignal,options?:{plan:ResourcePlan;maxBytes:number}) {
  workflow = { ...workflow }; delete workflow.communityOrigin;
  const plan=options?.plan??await captureResources(workflowResourceIds(workflow));
  const maxBytes=Math.min(options?.maxBytes??15*1024*1024,15*1024*1024);
  const encoder=new TextEncoder();
  const resources:Snapshot[]=[];let bytes=encoder.encode(JSON.stringify(workflow)).length+encoder.encode(plan.key).length;
  if(bytes>maxBytes)throw new Error(maxBytes===1048576?"分享码 JSON 超过 1 MiB；请下载 JSON 文件或减少快照":"便携包超过15MiB");
  for(const meta of plan.resources) {
    if(signal?.aborted)throw new Error('导出已取消');
    if(includeResources!==true && (!Array.isArray(includeResources)||!includeResources.includes(meta.id)))continue;
    if(!meta.definition && meta.count>100000)throw new Error('便携包静态快照最多十万条');
    const item:Snapshot={meta,entries:[],...(meta.kind==='relation'?{relationRows:[]}: {})};
    if(meta.corpus) {
      item.corpusEntries=[];
      let cursor=0;
      for (;;) {
        const rows=await db.entries.where('[resourceId+id]').between([meta.id,cursor],[meta.id,Infinity],true,true).limit(256).toArray();
        if(!rows.length)break;
        for(const row of rows) {
          if(signal?.aborted)throw new Error('导出已取消');
          if(!row.corpus)throw new Error('语料素材缺少元数据');
          item.entries.push(row.text);item.corpusEntries.push(row.corpus);
          bytes+=encoder.encode(JSON.stringify(row.corpus)).length+row.text.length*3;
          if(bytes>maxBytes)throw new Error('语料便携快照超过大小预算，请独立导出词库');
        }
        cursor=rows[rows.length-1].id!+1;
      }
    } else if(!meta.definition)for await(const c of readStaticResource(meta.id,0,db,true)) {
      if(signal?.aborted)throw new Error('导出已取消');
      if(c.pair)item.relationRows!.push(c.pair);else item.entries.push(c.text);
      bytes+=encoder.encode(JSON.stringify(c.pair??c.text)).length;
      if(bytes>Math.min(maxBytes,5*1024*1024))throw new Error(maxBytes===1048576?'分享码 JSON 超过 1 MiB；请下载 JSON 文件或减少快照':'便携资源快照超过安全大小预算');
    }
    resources.push(item);
  }
  await assertResourcePlan(plan);
  const used = usedOperators([workflow,...plan.resources.flatMap(r=>r.definition?.type==='dynamic'?[r.definition.workflow]:[])]);
  const packManifest=workflowPacks(workflow,plan.resources);
  const result = {packManifest,operatorVersions:Object.fromEntries(used.map(op=>[op,1])),format:'glyphforge',version:packManifest.length?7:6,irVersion:1,resourceDefinitionVersion:1,workflow,dependencies:plan.resources.map(({id,name,kind,version})=>({id,name,kind,version})),resources};
  if(encoder.encode(JSON.stringify(result)).length>maxBytes)throw new Error(maxBytes===1048576?"分享码 JSON 超过 1 MiB；请下载 JSON 文件或减少快照":"便携包超过15MiB");
  return JSON.parse(JSON.stringify(result)) as typeof result;
}
export async function importResourcePackage(data:unknown,bindings:Record<string,string>={},preview=false):Promise<Workflow> {
  const p=data as Awaited<ReturnType<typeof exportResourcePackage>>;
  if(!p || p.format!=='glyphforge'||![6,7].includes(p.version)||p.irVersion!==1||p.resourceDefinitionVersion!==1||!Array.isArray(p.resources)||p.resources.length>100||!Array.isArray(p.dependencies)||p.dependencies.length>100||JSON.stringify(data).length>16*1024*1024)throw new Error('v6 资源包格式/大小无效');
  if(p.version===7)guardJSON(data,48*1024*1024,2000000);
  const workflow=structuredClone(p.workflow);delete workflow.communityOrigin;validateGraph(workflow);
  if(!p.operatorVersions || Object.entries(p.operatorVersions).some(([op,v])=>!Object.hasOwn(operators,op)||v!==1))throw new Error("算子版本不兼容");
  const definitions=new Map<string,Resource>();
  const seen=new Set<string>();
  const snapshots=structuredClone(p.resources);
  for(const item of snapshots) {
    validateResource(item.meta);
    if(seen.has(item.meta.id)||!Array.isArray(item.entries)||item.entries.length>100000||item.entries.some(s=>typeof s!=='string'||s.length>256)||!p.dependencies.some(d=>d.id===item.meta.id && d.kind===item.meta.kind && d.version===item.meta.version))throw new Error('资源快照无效或重复');
    seen.add(item.meta.id);
    if(item.meta.corpus) {
      const corpus=parseCorpusPackage({format:'glyphforge-playertrack',version:1,name:item.meta.name,...item.meta.corpus,entries:item.corpusEntries,relations:[]});
      if(corpus.entries.length!==item.entries.length || corpus.entries.some((m,i)=>m.text!==item.entries[i]))throw new Error('语料快照与词条不一致');
      item.corpusEntries=corpus.entries;
      item.meta.corpus={style:corpus.style,enabled:corpus.enabled,minLength:corpus.minLength,maxLength:corpus.maxLength,source:corpus.source,...(corpus.composition?{composition:corpus.composition,qualityVersion:corpus.qualityVersion}: {})};
    } else if(item.corpusEntries)throw new Error('普通词库不能携带语料元数据');
    if(item.meta.definition && (item.entries.length||item.relationRows))throw new Error('定义资源不能包含物化行');
    if(item.meta.kind==='relation') {if(item.entries.length||!Array.isArray(item.relationRows)||item.relationRows.length>100000)throw new Error('关系快照无效');item.relationRows.forEach(validatePair);}
    else if(item.relationRows)throw new Error('普通资源含关系行');
    definitions.set(item.meta.id,item.meta);
  }
  const mapping=new Map<string,string>(), missing:typeof p.dependencies=[];
  const depSeen=new Set<string>();
  for(const dep of p.dependencies) {
    if(!dep||typeof dep.id!=='string'||depSeen.has(dep.id)||!Number.isSafeInteger(dep.version)||dep.version<1||!['word','character','symbol','relation','mapping'].includes(dep.kind))throw new Error('依赖清单无效');
    depSeen.add(dep.id);
    if(seen.has(dep.id)){mapping.set(dep.id,crypto.randomUUID());continue;}
    const r=await db.resources.get(bindings[dep.id]||dep.id);
    if(!r||r.kind!==dep.kind||(!bindings[dep.id]&&r.version!==dep.version)){missing.push(dep);continue;}
    // Planning must use old package IDs until the full closure has been checked.
    const local=structuredClone(r);local.id=dep.id;
    definitions.set(dep.id,local);mapping.set(dep.id,r.id);
  }
  if(missing.length){const {ResourceDependencyError}=await import('./sharing');throw new ResourceDependencyError(missing);}
  const plan=planResources(workflowResourceIds(workflow),[...definitions.values()]);
  const packManifest=workflowPacks(workflow,plan.resources);
  if(p.version===6 && packManifest.length)throw new Error('扩展需要 v7 分享包');
  if(p.version===7 && JSON.stringify(packManifest)!==JSON.stringify(p.packManifest))throw new Error('扩展依赖 manifest 不匹配');
  for(const op of usedOperators([workflow,...plan.resources.flatMap(r=>r.definition?.type==="dynamic"?[r.definition.workflow]:[])]))if(p.operatorVersions[op]!==1)throw new Error("缺少算子版本");
  if(plan.resources.length!==p.dependencies.length)throw new Error('传递依赖清单不完整或包含无关资源');
  for(const item of snapshots) {
    item.meta.id=mapping.get(item.meta.id)!;item.meta.name=`${item.meta.name.slice(0,90)} · 导入`;
    if(item.meta.definition?.type==='dynamic')rebindWorkflowResources(item.meta.definition.workflow,mapping);
  }
  rebindWorkflowResources(workflow,mapping);
  workflow.id=crypto.randomUUID();workflow.name=`${workflow.name.slice(0,90)} · 导入`;
  for(const n of allNodes(workflow))n.params=normalizeParams(n.op,n.params);
  validateGraph(workflow);
  if(preview)return workflow;
  await db.transaction('rw',db.resources,db.entries,db.relations,db.workflows,db.extensionPacks,async()=>{
    await installPacks(packManifest);
    // Re-check local bindings while serializing all resource writers.
    for(const dep of p.dependencies)if(!seen.has(dep.id)) {const current=await db.resources.get(mapping.get(dep.id)!);if(!current||current.version!==definitions.get(dep.id)!.version)throw new Error('本地绑定资源已变化');}
    for(const item of snapshots) {
      await db.resources.add({...item.meta,updatedAt:Date.now()});
      const entries=[...new Set(item.entries)];
      const corpusByText=new Map(item.corpusEntries?.map(m=>[m.text,m]));
      for(let i=0;i<entries.length;i+=1000)await db.entries.bulkAdd(entries.slice(i,i+1000).map(text=>({resourceId:item.meta.id,text,...(corpusByText.has(text)?{corpus:corpusByText.get(text)}:{})})));
      const rows=[...new Map((item.relationRows??[]).map(r=>{const row=normalizePair(r);return [JSON.stringify(row),row];})).values()];
      for(let i=0;i<rows.length;i+=1000)await db.relations.bulkAdd(rows.slice(i,i+1000).map(r=>({...r,resourceId:item.meta.id})));
      if(!item.meta.definition)await db.resources.update(item.meta.id,{count:item.meta.kind==='relation'?rows.length:entries.length});
    }
    await db.workflows.add(workflow);
  });
  return workflow;
}

export function resourceWorkflow(id:string):Workflow {return {version:1,id:crypto.randomUUID(),name:'资源复用',seed:42,limit:10000,layout:{source:{x:30,y:100},result:{x:330,y:100}},nodes:[{id:'source',op:'resource',inputs:[],params:{resourceId:id}},{id:'result',op:'output',inputs:['source'],params:{}}]};}
