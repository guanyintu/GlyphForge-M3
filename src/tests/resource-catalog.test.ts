import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { db, saveNewResource, addEntries, deleteResource, readResource } from '../storage/db';
import type { Candidate, Resource, Workflow } from '../core/model';
import { planResources, resourceDependents, workflowResourceIds } from '../core/resource-catalog';
import { saveDefinedResource, captureResources, resourceSession } from '../storage/resource-runtime';
import { resourceWorkflow } from '../core/resource-package';
import { execute } from '../core/engine';
import { parseScript, toScript } from '../core/script';
import { exportPackage, importPackage } from '../core/sharing';
import { beginRun, appendRunBatch, finishRun } from '../storage/run-lifecycle';
import { mutationWorkflow } from '../core/mutation';
import { extractSubgraph } from '../core/subgraphs';
const meta=(id:string):Resource=>({id,name:id,description:'',kind:'word',version:1,count:0,color:'green',updatedAt:0});
const dynamic=(id:string,workflow=resourceWorkflow('source')):Resource=>({...meta(id),definition:{format:1,type:'dynamic',workflow}});
const mapping=(rules='{"月":["玥"],"星":["☆"]}'):Resource=>({...meta('map'),kind:'mapping',definition:{format:1,type:'mapping',rules}});
function mapped(id='source'):Workflow {const w=resourceWorkflow(id);w.nodes.splice(1,0,{id:'map',op:'mapchars',inputs:['source'],params:{mappingId:'map'}});w.nodes.at(-1)!.inputs=['map'];return w;}
async function fixture(){await saveNewResource(meta('source'),['月','星']);await saveDefinedResource(mapping());await saveDefinedResource(dynamic('derived',mapped()));}
async function run(w:Workflow){const session=resourceSession(await captureResources(workflowResourceIds(w)));const rows:Candidate[]=[];const stats=await execute(w,session.read,b=>rows.push(...b),undefined,{resourceMetadata:session.metadata});await session.check();return {rows,stats};}
async function collect(id:string){const rows:Candidate[]=[];for await(const c of readResource(id,0))rows.push(c);return rows;}
afterEach(async()=>{await db.delete();await db.open();});
it('detects self and indirect cycles before reading entries',()=>{
  expect(()=>planResources(['a'],[dynamic('a',resourceWorkflow('a'))])).toThrow('循环');
  expect(()=>planResources(['a'],[dynamic('a',resourceWorkflow('b')),dynamic('b',resourceWorkflow('a'))])).toThrow('a → b → a');
});
it('reports exact missing dependency path',()=>expect(()=>planResources(['a'],[dynamic('a',resourceWorkflow('missing'))])).toThrow('missing（a）'));
it('deduplicates diamond vertices and includes mapping dependency in topological order',()=>{
  const w=resourceWorkflow('b');w.nodes.splice(1,0,{id:'c',op:'resource',inputs:[],params:{resourceId:'c'}});
  const p=planResources(['a'],[dynamic('a',w),dynamic('b',mapped()),dynamic('c',resourceWorkflow('source')),mapping(),meta('source')]);
  expect(p.resources.map(r=>r.id)).toEqual(['source','map','b','c','a']);
  expect(resourceDependents('source',p.resources).map(r=>r.id).sort()).toEqual(['a','b','c']);
});
it('bounds dependency depth',()=>{const catalog=Array.from({length:14},(_,i)=>dynamic(String(i),resourceWorkflow(String(i+1))));expect(()=>planResources(['0'],catalog)).toThrow('12 层');});
it('rejects wrong dependency types before executing even empty resources',()=>{
  expect(()=>planResources(['derived'],[dynamic('derived',mapped()),meta('source'),meta('map')])).toThrow('类型不匹配');
  expect(()=>planResources(['derived'],[dynamic('derived',resourceWorkflow('map')),mapping()])).toThrow('类型不匹配');
});
it('display rename leaves content key stable; seed is included in execution key',async()=>{
  await fixture();const a=await captureResources(['derived']);const r=(await db.resources.get('map'))!;await saveDefinedResource({...r,name:'renamed'},r.version);const b=await captureResources(['derived']);expect(b.key).toBe(a.key);expect(resourceSession(a).key(1)).not.toBe(resourceSession(a).key(2));
});
it('rejects computed resource references in dynamic definitions',()=>{
  expect(()=>{const w=parseScript('let source = "source"; for x in resource(source) { emit(x); }',resourceWorkflow('source'));planResources(['derived'],[dynamic('derived',w),meta('source')]);}).toThrow(/固定.*ID/);
});
it('relation rows project explicitly through shared templates into dynamic text',async()=>{
  const {saveRelationRows}=await import('../storage/db');await db.resources.add({...meta('relation'),kind:'relation'});await saveRelationRows('relation',[{left:'月',right:'星',relation:'couple'}]);
  const w=resourceWorkflow('relation');w.nodes[0]={id:'source',op:'template',inputs:[],params:{slots:'[{"name":"p","resourceId":"relation","kind":"pair"}]',templates:'["{p.left}{p.right}"]'}};await saveDefinedResource(dynamic('derived',w));const rows=await collect('derived');expect(rows[0].text).toBe('月星');expect(rows[0].parts[0].pair?.left).toBe('月');expect(rows[0].pair).toBeUndefined();
});
it('saves definitions atomically and prevents concurrent overwrite or static asset replacement',async()=>{
  await fixture();await expect(saveDefinedResource(dynamic('source'),2)).rejects.toThrow();
  const a=dynamic('derived',resourceWorkflow('source'));await saveDefinedResource(a,1);await expect(saveDefinedResource(a,1)).rejects.toThrow('其他编辑器');
  expect((await db.resources.get('derived'))!.version).toBe(2);expect(await db.entries.count()).toBe(2);
});
it('rejects cyclic edits with no partial write',async()=>{await fixture();const before=await db.resources.get('derived');await expect(saveDefinedResource(dynamic('derived',resourceWorkflow('derived')),1)).rejects.toThrow('循环');expect(await db.resources.get('derived')).toEqual(before);});
it('recomputes mapping and static source changes with new exact keys and no cache pollution',async()=>{
  await fixture();const a=await captureResources(['derived']);expect((await collect('derived')).map(c=>c.text)).toEqual(['玥','☆']);
  await saveDefinedResource(mapping('{"月":["Moon"]}'),1);await addEntries('source',['云']);const b=await captureResources(['derived']);
  expect(b.key).not.toBe(a.key);expect((await collect('derived')).map(c=>c.text)).toEqual(['Moon','星','云']);
  await expect(resourceSession(a).read('derived',0).next()).rejects.toThrow('更改');
});
it.each(['source','map'])('source deletion %s invalidates all dependent reads',async id=>{await fixture();const session=resourceSession(await captureResources(['derived']));await deleteResource(id);await expect(session.read('derived',0).next()).rejects.toThrow('删除');await expect(captureResources(['derived'])).rejects.toThrow('缺失');});
it('checks versions across interleaved async readers and refuses mixed batches',async()=>{
  await fixture();const s=resourceSession(await captureResources(['derived']));const a=s.read('derived',0),b=s.read('derived',0);expect((await a.next()).value.text).toBe('玥');expect((await b.next()).value.text).toBe('玥');
  await addEntries('source',['云']);await expect(s.check()).rejects.toThrow('更改');
  // Buffered rows may be observed by a consumer, but cannot be committed as a valid run.
  await expect((async()=>{for await(const _ of a){void _;}})()).rejects.toThrow('更改');
});
it('resource version check is inside batch persistence transaction',async()=>{
  await fixture();const w=resourceWorkflow('derived');await beginRun(w,'run');const rows=(await run(w)).rows;await saveDefinedResource(mapping('{}'),1);
  await expect(appendRunBatch('run',rows)).rejects.toThrow('更改');expect(await db.generated.count()).toBe(0);await expect(finishRun('run','done')).rejects.toThrow();await finishRun('run','error');
});
it('cancels after suspension and leaves no shared mutable iterator/cache state',async()=>{
  await fixture();const ctl=new AbortController(),s=resourceSession(await captureResources(['derived']),db,ctl.signal),iter=s.read('derived',0);await iter.next();ctl.abort();await expect(iter.next()).rejects.toThrow('取消');expect(await collect('derived')).toHaveLength(2);
});
it('empty sources and empty mappings retain type checks',async()=>{
  await saveNewResource(meta('source'),[]);await saveDefinedResource(mapping('{}'));await saveDefinedResource(dynamic('derived',mapped()));expect(await collect('derived')).toEqual([]);await expect(collect('map')).rejects.toThrow('不能作为词库');await expect(addEntries('derived',['oops'])).rejects.toThrow('编辑定义');
});
it('fixed seed, source versions and graph/NameScript/Chinese martian rules agree',async()=>{
  await fixture();const w=mapped('derived');const a=await run(w),b=await run(parseScript(toScript(w),w));expect(b.rows).toEqual(a.rows);
  const han=mapped();han.nodes[1]={...han.nodes[1],op:'hanconvert',params:{mode:'martian',mappingId:'map'}};
  expect((await run(han)).rows.map(c=>c.text)).toEqual(['玥','☆']);
  expect(a.rows[0].parts.map(p=>p.resourceId)).toContain('derived');expect(a.rows[0].parts.find(p=>p.resourceId==='map')!.version).toBe(1);
});
it('program AST resolves and packages literal Mapping references using identical semantics',async()=>{
  await fixture();const w=resourceWorkflow('source');w.nodes=[{id:'p',op:'program',inputs:[],params:{},program:undefined},{id:'result',op:'output',inputs:['p'],params:{}}];
  const next=parseScript('for x in resource("source") { for y in mapchars(x, "{}", 1, 32, "map") { emit(y); } }',w);
  expect(workflowResourceIds(next).sort()).toEqual(['map','source']);expect((await run(next)).rows.map(c=>c.text).sort()).toEqual(['☆','玥']);
  expect((await run(await importPackage(await exportPackage(next)))).rows.map(c=>c.text).sort()).toEqual(['☆','玥']);
});
it('dynamic resource feeds reusable P2-A subgraph then P2-B mutation dictionary/mapping',async()=>{
  await fixture();const w=mapped('derived'),sub=extractSubgraph(w,['source','map']).workflow;expect((await run(sub)).rows).toEqual((await run(w)).rows);
  const mutation=mutationWorkflow({text:'月',parts:[]},{operations:'["martian"]',mappingId:'map',count:8},42);expect((await run(mutation)).rows[0].text).toBe('玥');
  const dict=mutationWorkflow({text:'name',parts:[]},{operations:'["dictionary"]',resourceId:'derived',count:8},42);expect((await run(dict)).rows.every(c=>['玥','☆'].includes(c.text))).toBe(true);
});
it('v6 carries transitive definitions offline and remaps all ID conflicts without overwriting assets',async()=>{
  await fixture();const pkg=await exportPackage(resourceWorkflow('derived'));expect(pkg.version).toBe(6);expect(pkg.resources).toHaveLength(3);
  const before=await db.resources.toArray(),original=(await run(resourceWorkflow('derived'))).rows.map(c=>c.text);
  const restored=await importPackage(pkg);expect(await db.resources.count()).toBe(6);for(const r of before)expect(await db.resources.get(r.id)).toEqual(r);
  expect((await run(restored)).rows.map(c=>c.text)).toEqual(original);
  await db.delete();await db.open();const offline=await importPackage(pkg);expect((await run(offline)).rows.map(c=>c.text)).toEqual(original);
});
it('v6 rebinds both main and dynamic-definition subgraph internals',async()=>{
  await fixture();const inner=extractSubgraph(mapped(),['source','map']).workflow;await saveDefinedResource(dynamic('fn-derived',inner));const main=extractSubgraph(resourceWorkflow('fn-derived'),['source']).workflow;
  const pkg=await exportPackage(main);const before=(await run(main)).rows.map(c=>c.text);await db.delete();await db.open();expect((await run(await importPackage(pkg))).rows.map(c=>c.text)).toEqual(before);
});
it('a stale editor cannot resurrect a deleted resource',async()=>{
  await fixture();const r=(await db.resources.get('map'))!;await deleteResource('map');await expect(saveDefinedResource(r,r.version)).rejects.toThrow('已被删除');expect(await db.resources.get('map')).toBeUndefined();
});
it.each(['cycle','missing','bad-map','rows','version'])('rejects malformed v6 %s atomically',async kind=>{
  await fixture();const pkg=await exportPackage(resourceWorkflow('derived'));const p=JSON.parse(JSON.stringify(pkg));
  const d=p.resources.find((i:any)=>i.meta.id==='derived'),m=p.resources.find((i:any)=>i.meta.id==='map');
  if(kind==='cycle')d.meta.definition.workflow.nodes[0].params.resourceId='derived';if(kind==='missing')p.resources=p.resources.filter((i:any)=>i!==m);if(kind==='bad-map')m.meta.definition.rules='{"ab":["x"]}';if(kind==='rows')d.entries=['bad'];if(kind==='version')p.resourceDefinitionVersion=2;
  if(kind==='missing')await deleteResource('map');const count=await db.resources.count();await expect(importPackage(p)).rejects.toThrow();expect(await db.resources.count()).toBe(count);
});
it.each([100000,1000000])('lazily reads %i logical Cartesian rows with bounded prefix and shared steps',async size=>{
  const a=meta('a'),b=meta('b');await saveNewResource(a,Array.from({length:1000},(_,i)=>`A${i}`));await saveNewResource(b,Array.from({length:size/1000},(_,i)=>`B${i}`));
  const w=resourceWorkflow('a');w.nodes.splice(1,0,{id:'b',op:'resource',inputs:[],params:{resourceId:'b'}},{id:'mix',op:'concat',inputs:['source','b'],params:{}});w.nodes.at(-1)!.inputs=['mix'];
  await saveDefinedResource(dynamic('large',w));const consumer=resourceWorkflow('large');consumer.limit=60;const started=performance.now();const result=await run(consumer);expect(result.rows).toHaveLength(60);expect(result.stats.steps).toBeLessThan(1000);
  console.log('P2-C logical benchmark',JSON.stringify({logical:size,rows:result.rows.length,steps:result.stats.steps,ms:performance.now()-started,staticRows:await db.entries.count(),cacheRows:0}));
});
it('shares the outer budget through nested resource executions',async()=>{await fixture();const s=resourceSession(await captureResources(['derived']));await expect(execute(resourceWorkflow('derived'),s.read,()=>{}, {steps:3,milliseconds:1000},{resourceMetadata:s.metadata})).rejects.toThrow('步数');});
it('opening existing schema6 is additive with byte-equivalent user assets',async()=>{await fixture();await db.favorites.put({text:'old',parts:[],savedAt:2});const before=JSON.stringify([await db.resources.toArray(),await db.entries.toArray(),await db.favorites.toArray()]);db.close();await db.open();expect(db.verno).toBe(6);expect(JSON.stringify([await db.resources.toArray(),await db.entries.toArray(),await db.favorites.toArray()])).toBe(before);});
