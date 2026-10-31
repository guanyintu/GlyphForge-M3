import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { firstPartyPacks, validatePack, validatePacks, parsePack, trustedPack, migrateExtension } from '../core/packs';
import type { ExtensionPack } from '../core/packs';
import { installPacks, setPackEnabled, assertWorkflowPacks, packStatus } from '../storage/packs';
import { db, ForgeDatabase, saveNewResource } from '../storage/db';
import { beginRun, appendRunBatch, finishRun } from '../storage/run-lifecycle';
import { resourceWorkflow } from '../core/resource-package';
import { resourceSession, captureResources, saveDefinedResource } from '../storage/resource-runtime';
import { dependencyIds, exportPackage, importPackage } from '../core/sharing';
import { execute } from '../core/engine';
import { parseScript, toScript, validateGraph } from '../core/script';
import { extractSubgraph } from '../core/subgraphs';
import { copyNodes, pasteNodes } from '../core/graph-editing';
import { labWorkflow } from '../core/lab';
import type { Candidate, Resource, Workflow } from '../core/model';
const p=()=>structuredClone(firstPartyPacks[0]);
const meta=(id:string):Resource=>({id,name:id,kind:'word',count:0,description:'',version:1,color:'green',updatedAt:0});
function workflow():Workflow {const w=resourceWorkflow('source');w.extensions=[p()];w.nodes.splice(1,0,{id:'ext',op:'extension',inputs:['source'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',values:'{}',mappingId:''}});w.nodes.at(-1)!.inputs=['ext'];return w;}
async function run(w:Workflow) {const session=resourceSession(await captureResources(dependencyIds(w)));const rows:Candidate[]=[];const stats=await execute(w,session.read,b=>rows.push(...b),undefined,{resourceMetadata:session.metadata});return {rows,stats};}
async function fixture(){await installPacks([p()]);await saveNewResource(meta('source'),['月','星']);}
afterEach(async()=>{for(const table of db.tables)await table.clear();});

it('first party declarations install enabled; unknown claimed publishers stay unverified and disabled',async()=>{
  for(const b of firstPartyPacks)expect(validatePack(b)).toEqual(b);
  await fixture();expect((await db.extensionPacks.toArray())[0].enabled).toBe(true);
  const unknown={...p(),id:'user-text'};await installPacks([unknown]);expect(trustedPack(unknown)).toBe(false);expect((await db.extensionPacks.get('user-text@1.0.0'))?.enabled).toBe(false);
  await setPackEnabled('user-text@1.0.0',true);expect((await db.extensionPacks.get('user-text@1.0.0'))?.enabled).toBe(true);
});
it('both real operators execute through graph, NameScript and a P2-A sequence function with provenance',async()=>{
  await fixture();let w=workflow();w.nodes.splice(2,0,{id:'select',op:'extension',inputs:['ext'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'select',values:'{"contains":"月"}'}});w.nodes.at(-1)!.inputs=['select'];
  const actual=await run(w);expect(actual.rows.map(c=>c.text)).toEqual(['「月」']);expect(actual.rows[0].parts[0]).toMatchObject({resourceId:'source',text:'月'});
  expect((await run(parseScript(toScript(w),w))).rows).toEqual(actual.rows);
  w=extractSubgraph(w,['ext','select']).workflow;expect((await run(parseScript(toScript(w),w))).rows).toEqual(actual.rows);
});
it('clipboard carries precise manifests and rejects same-version content conflicts',()=>{
  const w=workflow(),copy=copyNodes(w,['ext']);expect(copy.extensions).toEqual(w.extensions);
  const blank=resourceWorkflow('source');expect(pasteNodes(blank,copy).workflow.extensions).toEqual(w.extensions);
  const conflict=workflow();conflict.extensions![0].publisher='imposter';expect(()=>pasteNodes(conflict,copy)).toThrow('冲突');
});
it('Pair and members invalidate on text changes; source parts and notes survive',async()=>{
  const w=workflow();w.nodes[0].op='pairs';const rows:Candidate[]=[];await execute(w,async function*(){yield {text:'月',members:['月'],pair:{left:'月',right:'星',relation:'couple'},parts:[{resourceId:'source',text:'月',version:1}],notes:['原始']};},b=>rows.push(...b));
  expect(rows[0].text).toBe('「月」');expect(rows[0].pair).toBeUndefined();expect(rows[0].members).toBeUndefined();expect(rows[0].notes).toContain('原始');expect(rows[0].parts).toHaveLength(1);
});
it('disabling or uninstalling leaves workflow bytes intact, stops batches/done, then recovers exact version',async()=>{
  await fixture();const w=workflow(),before=JSON.stringify(w);await beginRun(w,'run');await setPackEnabled('glyphforge-text@1.0.0',false);
  await expect(appendRunBatch('run',[{text:'bad',parts:[]}])).rejects.toThrow('已禁用');await expect(finishRun('run','done')).rejects.toThrow('已禁用');expect(await db.generated.count()).toBe(0);
  await expect(assertWorkflowPacks(w)).rejects.toThrow('已禁用');expect(JSON.stringify(w)).toBe(before);await db.extensionPacks.clear();await expect(assertWorkflowPacks(w)).rejects.toThrow('未安装');
  await installPacks([p()]);await assertWorkflowPacks(w);expect((await run(w)).rows).toHaveLength(2);await finishRun('run','done');expect((await db.runs.get('run'))?.workflow.extensions).toEqual(w.extensions);
});
it('different versions coexist; explicit migration renames params; downgrade and missing version are errors',async()=>{
  await fixture();await installPacks([firstPartyPacks[1]]);const w=workflow(),n=w.nodes[1];n.params.values='{"prefix":"小","suffix":"!"}';const result=await run(w);
  const migrated=migrateExtension(n,firstPartyPacks[1]);expect(JSON.parse(String(migrated.params.values))).toEqual({opening:'小',suffix:'!'});
  w.extensions=[firstPartyPacks[1]];w.nodes[1]=migrated;expect((await run(w)).rows.map(c=>c.text)).toEqual(result.rows.map(c=>c.text));
  expect(()=>migrateExtension(migrated,p())).toThrow('禁止静默');w.nodes[1]=n;expect(()=>validateGraph(w)).toThrow('版本不匹配');
});
it('dependencies have bounded DAGs and enabled state; broken dependency blocks existing users',async()=>{
  const a={...p(),id:'a-pack'},b={...p(),id:'b-pack',dependencies:[{id:'a-pack',version:'1.0.0'}]};
  await expect(installPacks([b])).rejects.toThrow('缺失依赖');expect(await db.extensionPacks.count()).toBe(0);
  await installPacks([a,b]);await setPackEnabled('a-pack@1.0.0',true);await setPackEnabled('b-pack@1.0.0',true);await db.extensionPacks.delete('a-pack@1.0.0');expect(packStatus(b,await db.extensionPacks.toArray())).toContain('依赖未启用');
  a.dependencies=[{id:'b-pack',version:'1.0.0'}];expect(()=>validatePacks([a,b])).toThrow('循环');
});
it('same ID/version replacement, including forged first party content, cannot overwrite a local installation',async()=>{
  await fixture();const forged=p();forged.operators[0].name='伪造';await expect(installPacks([forged])).rejects.toThrow('冲突');expect((await db.extensionPacks.toArray())[0].manifest).toEqual(p());
});

const bads:[string,(p:ExtensionPack)=>void][]=[
  ['builtin shadow',x=>{x.operators[0].id='prefix';}],
  ['user JS',x=>{Object.assign(x,{code:'fetch("https://evil")'});}],
  ['network permission',x=>{Object.assign(x,{permissions:['network']});}],
  ['arbitrary step',x=>{Object.assign(x.operators[0].steps[0],{op:'eval'});}],
  ['hidden resource',x=>{x.operators[0].steps[0].params.mappingId='https://evil';}],
  ['unknown param',x=>{x.operators[0].steps[0].params.code='doEvil()';}],
  ['incompatible',x=>{Object.assign(x.compatibility,{contract:2});}],
  ['steps size',x=>{x.operators[0].steps=Array(17).fill({op:'reverse',params:{}});}],
  ['huge defaults',x=>{x.operators[0].parameters.prefix.default='x'.repeat(200000);}],
  ['binding type',x=>{x.operators[0].steps[0].bindings={mappingId:'missing'};}],
  ['duplicate op',x=>{x.operators.push(structuredClone(x.operators[0]));}],
];
it.each(bads)('rejects malicious declaration: %s without asset changes',async(_,mutate)=>{await fixture();const x=p();mutate(x);await expect(installPacks([x])).rejects.toThrow();expect(await db.extensionPacks.count()).toBe(1);expect(await db.entries.count()).toBe(2);});
it('prototype keys, deep nesting, compressed envelopes, huge input and malicious call params are rejected',()=>{
  expect(()=>parsePack('{"__proto__":{"polluted":true}}')).toThrow('保留键');expect(({} as Record<string,unknown>).polluted).toBeUndefined();
  expect(()=>parsePack('{"format":"gzip","data":"H4sI"}')).toThrow();expect(()=>parsePack(' '.repeat(131073))).toThrow('128K');
  let x:unknown={};for(let i=0;i<22;i++)x={x};expect(()=>validatePack(x)).toThrow('深度');
  const w=workflow();w.nodes[1].params.values='{"__proto__":{}}';expect(()=>validateGraph(w)).toThrow('保留键');w.nodes[1].params.values='{"mappingId":"https://evil"}';expect(()=>validateGraph(w)).toThrow('显式');
});
it('AST and laboratory are explicitly inapplicable and reject extension calls',()=>{
  expect(()=>parseScript('emit(extension("x"));',workflow())).toThrow();expect(()=>labWorkflow('extension',{})).toThrow();
});
it('1000+ combinations consume a lazy prefix and inherit cancellation/step budget',async()=>{
  const w=workflow();w.limit=60;w.nodes.splice(1,0,{id:'b',op:'resource',inputs:[],params:{resourceId:'source'}},{id:'mix',op:'concat',inputs:['source','b'],params:{separator:':'}});w.nodes.find(n=>n.id==='ext')!.inputs=['mix'];let reads=0;
  const reader=async function*(){for(let i=0;i<1000;i++){reads++;yield {text:String(i),parts:[]};}};
  const stats=await execute(w,reader,()=>{});expect(stats.count).toBe(60);expect(reads).toBeLessThan(100);expect(stats.steps).toBeLessThan(1000);
  await expect(execute(w,reader,()=>{},{steps:20,milliseconds:10000})).rejects.toMatchObject({diagnostic:{code:'BUDGET'}});
  const abort=new AbortController();abort.abort();await expect(execute(w,reader,()=>{},undefined,{signal:abort.signal})).rejects.toMatchObject({diagnostic:{code:'CANCELLED'}});
});
it('v7 portable closure restores dynamic resource, Mapping, P2-A and packs into blank DB with ID collisions isolated',async()=>{
  await fixture();const map:Resource={...meta('map'),kind:'mapping',definition:{format:1,type:'mapping',rules:'{"月":["玥"]}'}};await saveDefinedResource(map);
  let w=workflow();w.nodes[1].params.mappingId='map';w=extractSubgraph(w,['ext']).workflow;
  await saveDefinedResource({...meta('dynamic'),definition:{format:1,type:'dynamic',workflow:w}});const outer=resourceWorkflow('dynamic');const expected=await run(outer);const pkg=await exportPackage(outer);expect(pkg.version).toBe(7);
  for(const t of db.tables)await t.clear();const restored=await importPackage(pkg);expect((await run(restored)).rows.map(c=>c.text)).toEqual(expected.rows.map(c=>c.text));expect(await db.extensionPacks.count()).toBe(1);expect(await db.resources.count()).toBe(3);
  const again=await importPackage(pkg);expect(again.id).not.toBe(restored.id);expect(await db.resources.count()).toBe(6);expect(await db.extensionPacks.count()).toBe(1);
});
it('bad v7 manifest and transactional write failure roll back every asset and pack',async()=>{
  await fixture();const pkg=await exportPackage(workflow());const invalid=structuredClone(pkg);Object.assign(invalid,{packManifest:[]});await expect(importPackage(invalid)).rejects.toThrow('manifest');
  for(const t of db.tables)await t.clear();const fail=()=>{throw new Error('injected failure');};db.workflows.hook('creating',fail);try{await expect(importPackage(pkg)).rejects.toThrow('injected');}finally{db.workflows.hook('creating').unsubscribe(fail);}
  expect(await db.extensionPacks.count()).toBe(0);expect(await db.resources.count()).toBe(0);expect(await db.entries.count()).toBe(0);
});
it('unknown imported pack remains installed disabled, and import never reenables a local disabled first party pack',async()=>{
  await fixture();const w=workflow(),unverified={...p(),id:'user-text'};w.extensions=[unverified];w.nodes[1].params.pack=unverified.id;
  const pkg=await exportPackage(w);await importPackage(pkg);expect((await db.extensionPacks.get('user-text@1.0.0'))?.enabled).toBe(false);
  await setPackEnabled('glyphforge-text@1.0.0',false);await importPackage(await exportPackage(workflow()));expect((await db.extensionPacks.get('glyphforge-text@1.0.0'))?.enabled).toBe(false);
});
it('real schema6 database upgrades additively to schema7 without changing existing assets',async()=>{
  const name=`packs-migration-${crypto.randomUUID()}`,old=new Dexie(name);
  old.version(6).stores({resources:'id,name',entries:'++id,resourceId,text,&[resourceId+text],[resourceId+id]',workflows:'id,name',favorites:'text,savedAt,runId',runs:'id,createdAt,status,[retention+createdAt]',generated:'[runId+text],text,runId',relations:'++id,resourceId,[resourceId+left+right+relation],&[resourceId+left+right+relation+direction],[resourceId+id],left,right',gamePresets:'id,name'});
  await old.open();await old.table('resources').add(meta('old'));await old.table('entries').add({resourceId:'old',text:'旧资产'});await old.table('favorites').add({text:'旧收藏',parts:[],savedAt:1});old.close();
  const upgraded=new ForgeDatabase(name);try{await upgraded.open();expect(upgraded.verno).toBe(7);expect(await upgraded.resources.get('old')).toEqual(meta('old'));expect((await upgraded.entries.toArray())[0].text).toBe('旧资产');expect((await upgraded.favorites.toArray())[0].text).toBe('旧收藏');expect(await upgraded.extensionPacks.count()).toBe(0);}finally{await upgraded.delete();}
});
it('dependency depth is bounded and malformed versions cannot auto select a newer installation',()=>{
  const chain=Array.from({length:14},(_,i)=>({...p(),id:`chain-${i}`,dependencies:i<13?[{id:`chain-${i+1}`,version:'1.0.0'}]:[]}));expect(()=>validatePacks(chain)).toThrow('深度');
  const x=p();x.version='^1.0.0';expect(()=>validatePack(x)).toThrow('版本');
});
it('migrated workflow does not depend on an unused disabled older manifest',async()=>{
  await fixture();await installPacks([firstPartyPacks[1]]);const w=workflow();w.extensions!.push(firstPartyPacks[1]);w.nodes[1]=migrateExtension(w.nodes[1],firstPartyPacks[1]);await setPackEnabled('glyphforge-text@1.0.0',false);await assertWorkflowPacks(w);expect((await run(w)).rows).toHaveLength(2);
});
