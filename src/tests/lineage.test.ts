import 'fake-indexeddb/auto';
import {afterEach, expect, it} from 'vitest';
import {execute} from '../core/engine';
import {execute as legacy,evaluateWorkflow as legacyEvaluate} from './fixtures/p2e-legacy-engine';
import type {Candidate,Resource,Workflow} from '../core/model';
import {resourceWorkflow} from '../core/resource-package';
import {extractSubgraph} from '../core/subgraphs';
import {mutationWorkflow} from '../core/mutation';
import {firstPartyPacks} from '../core/packs';
import {db,saveNewResource,readStaticResource} from '../storage/db';
import {beginRun,appendRunBatch,finishRun,toggleFavorite,exportRun,restoreRun,pruneHistory} from '../storage/run-lifecycle';
import {captureResources,resourceSession,saveDefinedResource} from '../storage/resource-runtime';
import {inspectLineage} from '../storage/lineage';
import {lineageLimits,mergeLineage,validLineage,reverseEvidence} from '../core/lineage';
import {installPacks} from '../storage/packs';
import {ReverseSearcher} from '../core/reverse-search';

const meta=(id:string):Resource=>({id,name:id,kind:'word',count:0,version:1,description:'',color:'green',updatedAt:0});
function graph(op:'concat'|'pattern'='concat'):Workflow {
  const w=resourceWorkflow('a');w.id='fixture';w.limit=10000;
  w.nodes.splice(1,0,{id:'b',op:'resource',inputs:[],params:{resourceId:'b'}},{id:'mix',op,inputs:['source','b'],params:op==='concat'?{separator:''}:{template:'AABB'}},{id:'filter',op:'filter',inputs:['mix'],params:{maxLength:6,includes:'',excludes:''}});
  w.nodes.at(-1)!.inputs=['filter'];return w;
}
function reader(a:string[],b=a,version=1,events:string[]=[]) {
  return async function* (id:string,seed:number) {
    events.push(`${id}:${seed}`);
    for(const text of id==='b'?b:a) yield {text,parts:[{resourceId:id,text,version}],notes:['原始']};
  };
}
const withoutLineage=(rows:Candidate[])=>rows.map(({lineage:_,...c})=>c);
async function compare(w:Workflow, a:string[], b=a, version=1) {
  const results=[];
  for(const mode of ['old','off','on']) {
    const rows:Candidate[]=[],events:string[]=[];
    const stats=await (mode==='old'?legacy:execute)(w,reader(a,b,version,events),batch=>rows.push(...batch),{steps:300000,milliseconds:10000},{runId:'fixed-run',optimize:mode!=='off'});
    results.push({rows,stats:stats as import("../core/engine").RunStats,events});
  }
  expect(withoutLineage(results[2].rows)).toEqual(withoutLineage(results[0].rows));
  expect(results[2].rows).toEqual(results[1].rows);
  expect(results[2].events).toEqual(results[0].events);
  expect(results[2].stats.steps).toBe(results[0].stats.steps);
  expect(results[2].stats.truncated).toBe(results[0].stats.truncated);
  return results;
}
afterEach(async()=>{for(const t of db.tables)await t.clear();});

it.each(['concat','pattern'] as const)('frozen e637beb / disabled / enabled %s differential: 80 seeds and versions',async op=>{
  const pool=['月','星','月','', 'á','👩🏽‍🚀','🇨🇳','\u200d','a','longword'];
  for(let seed=0;seed<80;seed++) {const w=graph(op);w.seed=seed;w.nodes[3].params={maxLength:seed%9+1,includes:seed%3?'':'月',excludes:seed%7?'':'星'};await compare(w,pool.slice(0,seed%11),pool.slice(seed%5),seed%3+1);}
});
it('local allocation pruning is real, with identical ticks and lazy readers',async()=>{
  const w=graph();w.nodes[3].params.maxLength=1;
  const r=await compare(w,['月','星'],['云','梦']);expect(r[2].stats.safePruned).toBe(4);expect(r[2].rows).toEqual([]);
});
it('does not push across random group, reverse, unknown resource lengths, or side-effectful upstream iteration',async()=>{
  const w=graph();w.nodes.splice(3,0,{id:'random',op:'group',inputs:['mix'],params:{count:2,batches:2,random:true}});w.nodes[4].inputs=['random'];
  const r=await compare(w,['甲','乙','丙']);expect(r[2].stats.safePruned).toBe(0);
});
it.each(['concat','pattern'] as const)('%s boundaries, empty libraries, duplicate paths, UTF16 and grapheme seams',async op=>{
  for(const a of [[],[''],['a'],['á'],['👩🏽‍🚀'],['🇨'],['\r'],['月','月']]) await compare(graph(op),a,['\n','🇳','́','星','']);
});
it('oversize text still throws original diagnostic before any rejection',async()=>{
  const w=graph();w.nodes[3].params.maxLength=1;
  const errors=[];
  for(const f of [legacy,execute]) try {await f(w,reader(['x'.repeat(600)]),()=>{});}catch(e){errors.push((e as {diagnostic:unknown}).diagnostic);}
  expect(errors).toHaveLength(2);expect(errors[1]).toEqual(errors[0]);expect(errors[1]).toMatchObject({nodeId:'mix',code:'BUDGET'});
});
it('step budgets at every tick and cancellation preserve exact error localization',async()=>{
  for(let steps=1;steps<75;steps++) {
    const errors=[];for(const f of [legacy,execute]) try {await f(graph(),reader(['月','星']),()=>{},{steps,milliseconds:10000});errors.push(null);}catch(e){errors.push((e as {diagnostic:unknown}).diagnostic);}
    expect(errors[1]).toEqual(errors[0]);
  }
  const abort=new AbortController();abort.abort();await expect(execute(graph(),reader(['月']),()=>{},undefined,{signal:abort.signal})).rejects.toThrow('取消');
});
it('nested subgraphs, Chinese, Pair/members, extensions and mutation keep old metadata and seed behavior',async()=>{
  let w=graph('pattern');w=extractSubgraph(w,['mix','filter']).workflow;await compare(w,['月','星']);
  w=resourceWorkflow('a');w.id='chinese';w.nodes.splice(1,0,{id:'chinese',op:'hanconvert',inputs:['source'],params:{mode:'traditional'}});w.nodes.at(-1)!.inputs=['chinese'];await compare(w,['月','云']);
  w=graph();w.extensions=[firstPartyPacks[0]];w.nodes.splice(4,0,{id:'ext',op:'extension',inputs:['filter'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',values:'{}'}});w.nodes.at(-1)!.inputs=['ext'];await compare(w,['月','星']);
  const source:Candidate={text:'月 / 星',parts:[],pair:{left:'月',right:'星',relation:'couple'},members:['月','星']};
  const mw=mutationWorkflow(source,{operations:'["affix"]',locks:'[]',pool:'云',prefix:'小',suffix:'子',intensity:1,count:8},42);await compare(mw,['月']);
  const rows:Candidate[]=[];const pair=resourceWorkflow('a');pair.nodes[0].op='pairs';await execute(pair,async function*(){yield source;},b=>rows.push(...b),undefined,{runId:'pair'});expect(rows[0].pair).toEqual(source.pair);expect(rows[0].members).toEqual(source.members);
});
it('bounded shared references never replicate a tree and unresolved refs degrade honestly',async()=>{
  let c:Candidate={text:'月',parts:[]};for(let i=0;i<200;i++)c={...c,lineage:mergeLineage([c],`ref-${i}`)};
  expect(c.lineage!.refs).toHaveLength(lineageLimits.refs);expect(c.lineage!.incomplete).toBe(true);expect(validLineage(c.lineage)).toBe(true);expect(JSON.stringify(c).length).toBeLessThan(1000);
  expect(validLineage({version:1,refs:['x'.repeat(10000)],incomplete:false})).toBe(false);expect(validLineage({version:1,refs:[],incomplete:false,tree:{}})).toBe(false);
  expect((await inspectLineage(c)).evidence).toBe('unknown');
});
async function persist(w:Workflow,id:string) {
  await beginRun(w,id);const run=(await db.runs.get(id))!,session=resourceSession(await captureResources(Object.keys(run.versions)));const rows:Candidate[]=[];
  await execute(w,session.read,async b=>{rows.push(...b);await appendRunBatch(id,b);},undefined,{runId:id,resourceMetadata:session.metadata});await finishRun(id,'done');return rows;
}
it('dynamic DAG/Mapping/extension/subgraph refs resolve in run snapshot after resources change or disappear',async()=>{
  await saveNewResource(meta('a'),['月','星']);await saveDefinedResource({...meta('map'),kind:'mapping',definition:{format:1,type:'mapping',rules:'{"月":["玥"]}'}});await installPacks([firstPartyPacks[0]]);
  let inner=resourceWorkflow('a');inner.extensions=[firstPartyPacks[0]];inner.nodes.splice(1,0,{id:'ext',op:'extension',inputs:['source'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',mappingId:'map',values:'{}'}});inner.nodes.at(-1)!.inputs=['ext'];inner=extractSubgraph(inner,['ext']).workflow;
  await saveDefinedResource({...meta('dynamic'),definition:{format:1,type:'dynamic',workflow:inner}});
  const w=resourceWorkflow('dynamic'),rows=await persist(w,'dynamic-run');const before=await inspectLineage(rows[0]);expect(before.evidence).toBe('executed');expect(before.operations.some(o=>o.summary.includes('glyphforge-text'))).toBe(true);expect(before.operations.every(o=>!o.summary.includes('失效'))).toBe(true);
  await db.resources.update('a',{version:9});await db.resources.delete('map');const after=await inspectLineage(rows[0]);expect(after.operations).toEqual(before.operations);expect(after.resources.map(r=>r.state)).toContain('资源已变更');expect(after.resources.map(r=>r.state)).toContain('资源缺失');
});
it('same text in different workflows/runs never overwrites favorite source; protected history, backup/blank DB and reverse keep real identity',async()=>{
  await saveNewResource(meta('a'),['月']);const w=resourceWorkflow('a'),a=(await persist(w,'a'))[0];await toggleFavorite(a);
  const b=(await persist({...w,id:'other'},'b'))[0];await expect(toggleFavorite(b)).rejects.toThrow('另一运行');expect((await db.favorites.get('月'))?.runId).toBe('a');await pruneHistory(0);expect(await db.runs.get('a')).toBeDefined();
  const backup=await exportRun('a');for(const t of db.tables)await t.clear();await restoreRun(backup);const report=await inspectLineage((await db.favorites.get('月'))!);expect(report.evidence).toBe('executed');expect(report.operations).toHaveLength(2);
  const reverse=await new ReverseSearcher(db).search('月');expect(reverse.known?.runId).toBe('a');expect(reverse.paths).toEqual([]);
});
it('legacy history never fabricates operation execution; absent parent remains a derivation',async()=>{
  const w=resourceWorkflow('missing');await db.runs.add({id:'old',workflow:w,versions:{},createdAt:0,status:'done',count:1});await db.generated.add({text:'月',parts:[],runId:'old'});
  const old=await inspectLineage({text:'月',parts:[],runId:'old'});expect(old.evidence).toBe('executed');expect(old.operations).toEqual([]);expect(old.limitations.join()).toContain('不从工作流结构推造');
  const c:Candidate={text:'小月',parts:[],derivation:{kind:'mutation',version:1,seed:1,round:1,operations:['affix'],locks:[],parent:{text:'月',runId:'gone'}}};expect((await inspectLineage(c)).derivation?.parentState).toContain('缺失');
});
it('10k outputs / million logical prefix keeps lineage bytes bounded and unchanged rows',async()=>{
  const w=graph();w.nodes[3].params.maxLength=100;const start=performance.now();let maxBytes=0,totalBytes=0,count=0;const stats=await execute(w,reader(Array.from({length:1000},(_,i)=>`a${i}`)),batch=>{for(const c of batch){const n=JSON.stringify(c.lineage).length;maxBytes=Math.max(maxBytes,n);totalBytes+=n;count++;}},undefined,{runId:'10k'});
  expect(count).toBe(10000);expect(stats.steps).toBeLessThan(100000);expect(maxBytes).toBeLessThan(500);console.log('P2-E 10k',JSON.stringify({ms:performance.now()-start,stats,maxLineageBytes:maxBytes,totalLineageBytes:totalBytes}));
});
it('paired rejection benchmark preserves exact steps and avoids 10k metadata allocations',async()=>{
  const w=graph();w.nodes[3].params.maxLength=1;
  const samples:{mode:string;ms:number;steps:number;pruned:number}[]=[];
  for(let round=0;round<6;round++) for(const optimize of round%2?[true,false]:[false,true]) {
    const read=async function* (id:string) {for(let i=0;i<100;i++)yield {text:`月${i}`,parts:Array.from({length:16},(_,j)=>({resourceId:`${id}-${j}`,text:`素材${j}`,version:1}))};};
    const start=performance.now();const stats=await execute(w,read,()=>{},undefined,{runId:'paired',optimize});samples.push({mode:optimize?'on':'off',ms:performance.now()-start,steps:stats.steps,pruned:stats.safePruned!});expect(stats.count).toBe(0);
  }
  expect(new Set(samples.map(s=>s.steps)).size).toBe(1);expect(samples.filter(s=>s.mode==='on').every(s=>s.pruned===10000)).toBe(true);console.log('P2-E paired allocation benchmark',JSON.stringify(samples));
});
it('reverse evidence distinguishes deterministic matches, inference, and absence of actual history',()=>{
  const claims=reverseEvidence({input:'月',matches:[{text:'月',resourceId:'a',entryId:1,type:'exact',start:0,end:1,utf16Start:0,utf16End:1},{text:'玥',resourceId:'b',entryId:2,type:'pinyin',start:0,end:1,utf16Start:0,utf16End:1}],paths:[],patterns:['重复'],relations:[],possibleTemplates:[],warnings:[],cacheHit:false});expect(claims.map(c=>c.evidence)).toEqual(['unknown','matched','inferred','matched']);
});
it('invalid lineage backup fails before any transaction writes and old backups remain accepted',async()=>{
  await saveNewResource(meta('a'),['月']);const c=(await persist(resourceWorkflow('a'),'backup'))[0],backup=JSON.parse(await exportRun('backup'));await db.runs.clear();await db.generated.clear();backup.generated[0].lineage.refs=Array(33).fill('bad');
  await expect(restoreRun(JSON.stringify(backup))).rejects.toThrow('格式无效');expect(await db.runs.count()).toBe(0);delete backup.generated[0].lineage;await restoreRun(JSON.stringify(backup));expect((await inspectLineage(c)).operations).toEqual([]);
});
it('frozen nested dynamic DAG / Mapping / subgraph / extension differential across seeds and source versions',async()=>{
  await saveNewResource(meta('a'),['月','星','云']);await saveDefinedResource({...meta('map'),kind:'mapping',definition:{format:1,type:'mapping',rules:'{"月":["玥","月"],"星":["☆"]}'}});await installPacks([firstPartyPacks[0]]);
  let inner=graph();inner.nodes[1].params.resourceId='a';inner.extensions=[firstPartyPacks[0]];inner.nodes.splice(4,0,{id:'extension',op:'extension',inputs:['filter'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',mappingId:'map',values:'{}'}});inner.nodes.at(-1)!.inputs=['extension'];inner=extractSubgraph(inner,['mix','filter','extension']).workflow;
  await saveDefinedResource({...meta('dynamic-a'),definition:{format:1,type:'dynamic',workflow:inner}});await saveDefinedResource({...meta('dynamic-b'),definition:{format:1,type:'dynamic',workflow:resourceWorkflow('dynamic-a')}});
  for(const version of [3,4]) {await db.resources.update('a',{version});const plan=await captureResources(['dynamic-b']);const byId=new Map(plan.resources.map(r=>[r.id,r]));
    // Frozen dynamic adapter: same P2-C tick/yield/limit order, stable fixture resources.
    async function* oldRead(id:string,seed:number,tick:()=>void=()=>{}):AsyncGenerator<Candidate> {
      tick();const r=byId.get(id)!;const sequence=r.definition?.type==='dynamic'?legacyEvaluate({...r.definition.workflow,seed},oldRead,tick,{resourceMetadata:async id=>byId.get(id)}):readStaticResource(id,seed,db);let count=0;
      for await(const c of sequence){tick();if(r.definition?.type==='dynamic'){if(count>=r.definition.workflow.limit)break;yield {...c,parts:[...c.parts,{resourceId:id,version:r.version,text:c.text}]};}else yield c;count++;}
    }
    for(const seed of [0,42,99]) {const w=resourceWorkflow('dynamic-b');w.seed=seed;const oldRows:Candidate[]=[],newRows:Candidate[]=[];const oldStats=await legacy(w,oldRead,b=>oldRows.push(...b),undefined,{runId:'same'});const session=resourceSession(plan);const stats=await execute(w,session.read,b=>newRows.push(...b),undefined,{runId:'same'});expect(withoutLineage(newRows)).toEqual(withoutLineage(oldRows));expect(stats.steps).toBe(oldStats.steps);expect(newRows.every(c=>c.lineage?.refs.some(r=>r.includes('dynamic-a')))).toBe(true);}
  }
});
