import 'fake-indexeddb/auto';
import {it,expect,afterEach,vi} from 'vitest';
import {estimateGraph} from '../core/estimate';
import {estimateWorkflow,estimateIsCurrent} from '../storage/estimate';
import {execute} from '../core/engine';
import {execute as baseline} from './fixtures/p2f-baseline-engine';
import {execute as preE} from './fixtures/p2e-legacy-engine';
import {resourceWorkflow} from '../core/resource-package';
import type {Candidate,Resource,Workflow} from '../core/model';
import {db,saveNewResource} from '../storage/db';
import {saveDefinedResource} from '../storage/resource-runtime';
import {firstPartyPacks} from '../core/packs';
import {installPacks,setPackEnabled} from '../storage/packs';
import {extractSubgraph} from '../core/subgraphs';
const meta=(id:string,count=0):Resource=>({id,name:id,kind:'word',version:1,count,description:'',color:'green',updatedAt:0});
function graph(seed=42):Workflow{const w=resourceWorkflow('a');w.id='same';w.limit=10000;w.seed=seed;w.nodes.splice(1,0,{id:'b',op:'resource',inputs:[],params:{resourceId:'b'}},{id:'mix',op:seed%2?'concat':'pattern',inputs:['source','b'],params:seed%2?{separator:'$&'}:{template:['ABBA','AABB','AAA','B'][seed%4]}},{id:'filter',op:'filter',inputs:['mix'],params:{maxLength:seed%15+1,includes:seed%3?'':'月',excludes:seed%7?'':'星'}});w.nodes.at(-1)!.inputs=['filter'];return w;}
afterEach(async()=>{vi.restoreAllMocks();for(const t of db.tables)await t.clear();});
it('192 generated seed/version four-way differential includes all fields, read events, ticks and first-path duplicates',async()=>{
  const pool=['月','月','星','á','́','🇨','🇳','\r','\n','👩🏽‍🚀','$&',''];
  for(let seed=0;seed<192;seed++){
    let w=graph(seed);w.seed=(Math.imul(seed+1,1664525)+1013904223)>>>0;
    if(seed%11===0){w.nodes.splice(3,0,{id:'random',op:'group',inputs:['mix'],params:{count:2,batches:3,random:true}});w.nodes[4].inputs=['random'];}
    else if(seed%5===0)w=extractSubgraph(w,['mix','filter']).workflow;
    const outcomes:{rows:Candidate[];events:string[];steps:number;truncated:boolean}[]=[];
    for(const mode of ['preE','E','off','on']){
      const events:string[]=[],rows:Candidate[]=[];
      const reader=async function*(id:string,seed:number):AsyncGenerator<Candidate>{events.push(`${id}/${seed}`);for(const [i,text]of pool.slice(seed%4,seed%4+8).entries())yield {text,parts:[{resourceId:id,text,version:seed%7+1}],notes:['first',String(i%2)],members:[text],...(id==='z'?{pair:{left:text,right:text,relation:'couple'}}:{})};};
      const stats=await (mode==='preE'?preE:mode==='E'?baseline:execute)(w,reader,b=>rows.push(...b),undefined,{runId:'fixed',optimize:mode!=='off'});
      outcomes.push({rows,events,steps:stats.steps,truncated:stats.truncated});
    }
    expect(outcomes[3]).toEqual(outcomes[2]);expect(outcomes[3]).toEqual(outcomes[1]);
    const strip=(v:typeof outcomes[number])=>({...v,rows:v.rows.map(({lineage:_,...c})=>c)});expect(strip(outcomes[3])).toEqual(strip(outcomes[0]));
  }
});
it('every step-budget boundary and text-bound error retains exact node/line/order with optimization on/off',async()=>{
  for(let steps=1;steps<=120;steps++){
    const outcomes=[];for(const [fn,optimize]of [[baseline,true],[execute,false],[execute,true]] as const){const rows:Candidate[]=[],events:string[]=[];let error;try{await fn(graph(2),async function*(id){events.push(id);for(const text of ['a','b'])yield {text,parts:[]};},b=>rows.push(...b),{steps,milliseconds:10000},{optimize,runId:'fixed'});}catch(e){error=(e as any).diagnostic;}outcomes.push({rows,events,error});}expect(outcomes[2]).toEqual(outcomes[0]);expect(outcomes[2]).toEqual(outcomes[1]);
  }
  for(const optimize of [false,true])await expect(execute(graph(0),async function*(){yield {text:'x'.repeat(600),parts:[]};},()=>{},undefined,{optimize})).rejects.toMatchObject({diagnostic:{nodeId:'mix',code:'BUDGET'}});
});
it('exact static product exceeds Number safely; limit does not pretend to prune enumeration',async()=>{
  const w=graph();const r=await estimateGraph(w,[meta('a',Number.MAX_SAFE_INTEGER),meta('b',Number.MAX_SAFE_INTEGER)]);
  expect(r.combinations.upper).toBe((BigInt(Number.MAX_SAFE_INTEGER)**2n).toString());expect(r.candidates.exact).toBe(false);expect(r.risk).toBe('high');expect(r.limit).toBe(10000);
});
it('dynamic count zero is unknown interval, metadata reads do not materialize entries, source edits invalidate',async()=>{
  await saveNewResource(meta('a'),['月','星']);await saveDefinedResource({...meta('dynamic'),definition:{format:1,type:'dynamic',workflow:resourceWorkflow('a')}});
  const w=resourceWorkflow('dynamic'),before=await db.entries.count(),estimate=await estimateWorkflow(w);
  expect(estimate.candidates).toEqual({upper:'10000',exact:false});expect(await db.entries.count()).toBe(before);expect(await estimateIsCurrent(w,estimate)).toBe(true);
  await db.resources.update('a',{version:9});expect(await estimateIsCurrent(w,estimate)).toBe(false);
  const c=new AbortController();c.abort();await expect(estimateWorkflow(w,c.signal)).rejects.toThrow('取消');
});
it('empty static, invalid count, missing resources, cycles and depth are conservative or rejected',async()=>{
  expect((await estimateGraph(resourceWorkflow('a'),[meta('a',0)])).candidates).toEqual({upper:'0',exact:true});
  expect((await estimateGraph(resourceWorkflow('a'),[meta('a',Infinity)])).candidates.upper).toBeUndefined();
  await expect(estimateWorkflow(resourceWorkflow('missing'))).rejects.toThrow('缺失');
  await db.resources.put({...meta('a'),definition:{format:1,type:'dynamic',workflow:resourceWorkflow('a')}});await expect(estimateWorkflow(resourceWorkflow('a'))).rejects.toThrow('循环');
  const w=resourceWorkflow('a');w.nodes[0].inputs=['output'];await expect(estimateGraph(w,[meta('a')])).rejects.toThrow();
});
it('Mapping and exact pack enablement/content are part of estimate validity; disabled pack rejects',async()=>{
  await saveNewResource(meta('a'),['月']);await installPacks([firstPartyPacks[0]]);
  const w=resourceWorkflow('a');w.extensions=[firstPartyPacks[0]];w.nodes.splice(1,0,{id:'ext',op:'extension',inputs:['source'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',values:'{}'}});w.nodes.at(-1)!.inputs=['ext'];
  const e=await estimateWorkflow(w);expect(e.risk).toBe('unknown');await setPackEnabled('glyphforge-text@1.0.0',false);await expect(estimateIsCurrent(w,e)).rejects.toThrow('禁用');await expect(estimateWorkflow(w)).rejects.toThrow('禁用');
});
it('estimation never scans entity tables or the whole resource catalog; mapping updates invalidate',async()=>{
  await saveNewResource(meta('a'),['月']);await saveDefinedResource({...meta('m'),kind:'mapping',definition:{format:1,type:'mapping',rules:'{"月":["玥"]}'}});
  const w=resourceWorkflow('a');w.nodes.splice(1,0,{id:'map',op:'mapchars',inputs:['source'],params:{mappingId:'m',mapping:'{}',mode:'first'}});w.nodes.at(-1)!.inputs=['map'];
  const fail=()=>{throw new Error('Forbidden entity/catalog scan');};
  vi.spyOn(db.resources,'toArray').mockImplementation(fail);vi.spyOn(db.entries,'toArray').mockImplementation(fail);vi.spyOn(db.entries,'where').mockImplementation(fail);vi.spyOn(db.relations,'toArray').mockImplementation(fail);
  const e=await estimateWorkflow(w);expect(e.candidates.upper).toBeUndefined();await db.resources.update('m',{version:8});expect(await estimateIsCurrent(w,e)).toBe(false);
});
it('cancellation while reading metadata and concurrent version changes cannot publish an estimate',async()=>{
  await saveNewResource(meta('a'),['月']);const original=db.resources.bulkGet.bind(db.resources),c=new AbortController();
  vi.spyOn(db.resources,'bulkGet').mockImplementation(keys=>original(keys).then(rows=>{c.abort();return rows;}));
  await expect(estimateWorkflow(resourceWorkflow('a'),c.signal)).rejects.toThrow('取消');vi.restoreAllMocks();
  let reads=0;vi.spyOn(db.resources,'bulkGet').mockImplementation(keys=>original(keys).then(rows=>{if(++reads===2)rows.forEach(r=>{if(r)r.version++;});return rows;}));
  await expect(estimateWorkflow(resourceWorkflow('a'))).rejects.toThrow('更改');
});
it('12-level subgraphs estimate without resetting scope; 13 levels are rejected',async()=>{
  let w=graph();for(let i=0;i<12;i++)w=extractSubgraph(w,w.nodes.filter(n=>!['resource','output'].includes(n.op)).map(n=>n.id)).workflow;
  const e=await estimateGraph(w,[meta('a',10),meta('b',20)]);expect(e.depth).toBe(12);expect(e.combinations.upper).toBe('200');
  w=extractSubgraph(w,w.nodes.filter(n=>n.op==='call').map(n=>n.id)).workflow;await expect(estimateGraph(w,[meta('a'),meta('b')])).rejects.toThrow('深度');
});
it('Pair/members, first provenance path and cancelled ticks survive pure reuse',async()=>{
  const w=graph(4);w.nodes[0].op='pairs';w.nodes[1].op='pairs';w.nodes[3].params.maxLength=100;
  const reader=async function*():AsyncGenerator<Candidate>{for(const version of [1,2])yield {text:'月 / 星',parts:[{resourceId:'pairs',text:'月 / 星',version}],pair:{left:'月',right:'星',relation:'couple'},members:['月','星'],notes:['pair']};};
  const outcomes=[];for(const f of [baseline,execute]){const rows:Candidate[]=[];const stats=await f(w,reader,b=>rows.push(...b),undefined,{runId:'same'});outcomes.push({rows,steps:stats.steps});}
  expect(outcomes[1]).toEqual(outcomes[0]);expect(outcomes[1].rows).toHaveLength(1);expect(outcomes[1].rows[0].parts[0].version).toBe(1);
  const outcomesCancelled=[];for(const f of [baseline,execute]){const c=new AbortController();let reads=0;try{await f(w,async function*(){if(++reads===2)c.abort();yield*reader();},()=>{},undefined,{signal:c.signal});}catch(e){outcomesCancelled.push((e as any).diagnostic);}}
  expect(outcomesCancelled[1]).toEqual(outcomesCancelled[0]);expect(outcomesCancelled[0].code).toBe('CANCELLED');
});
