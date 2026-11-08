import { openEditor, reloadEditor, enterEditor } from "./editor-steps";
import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readdirSync,writeFileSync} from 'node:fs';
test.beforeAll(()=>execFileSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','e2e/scale.vite.config.ts'],{stdio:'pipe'}));
const workerUrl=()=>'/assets/'+readdirSync('dist/assets').find(s=>/^execution\.worker-.*\.js$/.test(s));
test('readonly estimate UI and live metadata invalidation',async({page,context})=>{
  await openEditor(page, '/');await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByText('规模与执行风险（只读）',{exact:true}).click();await page.getByRole('button',{name:'估算当前工作流'}).click();
  await expect(page.getByRole('status').filter({hasText:'去重前候选'})).toBeVisible();
  // A separate editor tab exercises the real cross-tab notification protocol;
  // a separately bundled Dexie runtime inside the same tab has its own events.
  const editor=await context.newPage();await openEditor(editor, '/');await expect(editor.getByText(/生成完成/)).toBeVisible();
  await editor.evaluate(async()=>{const h=await import('/scale-harness/scale.js');const w=(await h.db.workflows.toArray()).find(w=>w.name==='宇宙浪漫命名器');for(const n of w.nodes.filter(n=>n.op==='resource')){const r=await h.db.resources.get(n.params.resourceId);await h.db.resources.update(r.id,{version:r.version+1,count:20000});}});
  await expect(page.getByRole('status').filter({hasText:'风险：高'})).toBeVisible();
  await editor.close();
  await expect(page.getByText(/最近完成运行：/)).toBeVisible();
  await page.screenshot({path:'docs/p2-f/estimate.png',fullPage:true});
});
test('real production Worker/IDB audit: fully enumerated expensive graphs and bounded million prefix',async({page})=>{
  test.setTimeout(240000);await openEditor(page, '/');await expect(page.getByText(/生成完成/)).toBeVisible();
  const report=await page.evaluate(async url=>{
    const h=await import('/scale-harness/scale.js');
    const meta=(id:string)=>({id,name:id,kind:'word',count:0,description:'',version:1,color:'green',updatedAt:0});
    const imports:any[]=[];
    for(const [id,size] of [['f-left',100],['f-right',100],['f-third',10],['f-heavy-left',200],['f-heavy-right',200],['f-100k',100000]] as const){const start=performance.now();await h.saveNewResource(meta(id),[]);for(let i=0;i<size;i+=1000)await h.addEntries(id,Array.from({length:Math.min(1000,size-i)},(_,j)=>`${id}-${i+j}`));imports.push({id,size,ms:performance.now()-start});}
    function grid(op='pattern',reject=true){const w=h.resourceWorkflow('f-left');w.id='f-grid';w.limit=10000;w.seed=42;w.nodes.splice(1,0,{id:'right',op:'resource',inputs:[],params:{resourceId:'f-right'}},{id:'mix',op,inputs:['source','right'],params:op==='pattern'?{template:'ABBA'}:{separator:''}},{id:'filter',op:'filter',inputs:['mix'],params:{maxLength:100,includes:reject?'NEVER':'',excludes:''}});w.nodes.at(-1).inputs=['filter'];return w;}
    const heavy=grid();heavy.id='f-heavy';heavy.nodes[0].params.resourceId='f-heavy-left';heavy.nodes[1].params.resourceId='f-heavy-right';
    const triple=grid();triple.id='f-triple';triple.nodes[1].params.resourceId='f-third';triple.nodes.splice(3,0,{id:'third',op:'resource',inputs:[],params:{resourceId:'f-third'}},{id:'mix2',op:'concat',inputs:['mix','third'],params:{separator:''}});triple.nodes.find(n=>n.id==='filter').inputs=['mix2'];
    const full=grid(),concat=grid('concat'),tenK=grid('concat',false),million=h.resourceWorkflow('f-100k');million.id='f-million';million.limit=60;million.seed=99999;million.nodes.splice(1,0,{id:'right',op:'resource',inputs:[],params:{resourceId:'f-third'}},{id:'mix',op:'concat',inputs:['source','right'],params:{separator:''}});million.nodes.at(-1).inputs=['mix'];
    await h.installPacks([h.firstPartyPacks[0]]);await h.saveDefinedResource({...meta('f-map'),kind:'mapping',definition:{format:1,type:'mapping',rules:'{"f":["F"]}'}});
    let inner=h.resourceWorkflow('f-third');inner.nodes.splice(1,0,{id:'mapping',op:'mapchars',inputs:['source'],params:{mappingId:'f-map',mapping:'{}',mode:'first'}},{id:'ext',op:'extension',inputs:['mapping'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',values:'{}'}});inner.nodes.at(-1).inputs=['ext'];inner.extensions=[h.firstPartyPacks[0]];
    for(let i=0;i<12;i++)inner=h.extractSubgraph(inner,inner.nodes.filter(n=>!['resource','output'].includes(n.op)).map(n=>n.id)).workflow;
    await h.saveDefinedResource({...meta('f-dyn1'),definition:{format:1,type:'dynamic',workflow:inner}});await h.saveDefinedResource({...meta('f-dyn2'),definition:{format:1,type:'dynamic',workflow:h.resourceWorkflow('f-dyn1')}});
    const dynamic=h.resourceWorkflow('f-dyn2');
    const mutation=h.mutationWorkflow({text:'月👩🏽‍🚀月',parts:[],members:['月','👩🏽‍🚀月'],pair:{left:'月',right:'👩🏽‍🚀月',relation:'couple'}},{operations:'["affix","insert","delete"]',locks:'[1]',pool:'星',prefix:'小',suffix:'子',intensity:2,count:64},42);
    const run=(w:any,optimize:boolean,profile=false)=>new Promise<any>((resolve,reject)=>{const worker=new Worker(url,{type:'module'}),start=performance.now();let rows:any[]=[],batches=0;const timer=setTimeout(()=>{worker.terminate();reject(new Error('fixture timeout'));},15000);worker.onmessage=({data})=>{if(data.type==='batch'){rows.push(...data.batch);batches++;}if(['done','error'].includes(data.type)){worker.terminate();clearTimeout(timer);resolve({type:data.type,error:data.message,diagnostic:data.diagnostic,stats:data.stats,metrics:data.metrics,wallMs:performance.now()-start,batches,rows:rows.map(({runId,...c})=>c)});}};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message));};worker.postMessage({workflow:w,optimize,profile});});
    const samples:any[]=[];
    for(const [name,w,logical] of [['heavy-reject-full',heavy,40000],['three-source-reject-full',triple,10000],['pattern-reject-full',full,10000],['concat-reject-full',concat,10000],['tenK-output',tenK,10000],['million-prefix',million,1000000],['dynamic-mapping-extension-depth12',dynamic,10],['mutation-unicode',mutation,null]] as const){
      for(let round=0;round<6;round++){const pair:any[]=[];for(const optimize of round%2?[true,false]:[false,true]){const result=await run({...w,seed:[42,7,99999][round%3]},optimize);pair.push({optimize,...result});samples.push({name,round,seed:[42,7,99999][round%3],logical,optimize,...result,rows:result.rows.length,digest:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(result.rows))))).map(b=>b.toString(16).padStart(2,'0')).join('')});}if(JSON.stringify(pair[0].rows)!==JSON.stringify(pair[1].rows)||pair[0].stats?.steps!==pair[1].stats?.steps)throw new Error(`differential mismatch ${name}`);}
      const p=await run(w,true,true);samples.push({name,round:'profiled',logical,optimize:true,...p,rows:p.rows.length});
    }
    const reverse=[];const searcher=new h.ReverseSearcher(h.db);for(let i=0;i<3;i++){const start=performance.now(),r=await searcher.search('f-100k-99999',{resourceIds:['f-100k']});reverse.push({ms:performance.now()-start,cacheHit:r.cacheHit,matches:r.matches.length});}
    const estimate=await h.estimateWorkflow(million),estimateDynamic=await h.estimateWorkflow(dynamic);await h.db.resources.update('f-100k',{version:999});const stale=await h.estimateIsCurrent(million,estimate);
    return {imports,samples,reverse,estimate,estimateDynamic,stale,rendererV8HeapEnd:(performance as any).memory?.usedJSHeapSize,ua:navigator.userAgent};
  },workerUrl());
  // Full raw rows remain in each unprofiled digest for field-level review.
  writeFileSync(`docs/p2-f/worker-${process.env.P2F_SAMPLE??'final'}.json`,JSON.stringify(report,null,2));
  expect(report.stale).toBe(false);expect(report.imports.find(r=>r.size===100000)).toBeDefined();
  for(const s of report.samples){expect(s.type,`${s.name}: ${s.error}`).toBe('done');if(s.name==='tenK-output')expect(s.rows).toBe(10000);if(s.name.includes('reject-full')){expect(s.rows).toBe(0);expect(s.stats.steps).toBeGreaterThan(40000);}}
});
test('production concurrency rejects changed versions, cancels without late writes; reverse Worker cold/warm invalidation',async({page})=>{
  await openEditor(page, '/');await expect(page.getByText(/生成完成/)).toBeVisible();
  const reverseUrl='/assets/'+readdirSync('dist/assets').find(s=>/^reverse\.worker-.*\.js$/.test(s));
  const r=await page.evaluate(async({url,reverseUrl})=>{
    const h=await import('/scale-harness/scale.js'),id='f-race',meta={id,name:id,kind:'word',count:0,description:'',version:1,color:'green',updatedAt:0};await h.saveNewResource(meta,Array.from({length:200},(_,i)=>`月${i}`));
    const w=h.resourceWorkflow(id);w.id='f-race';w.limit=10000;w.nodes.splice(1,0,{id:'mix',op:'concat',inputs:['source','source'],params:{separator:''}});w.nodes.at(-1).inputs=['mix'];
    await h.saveNewResource({...meta,id:'f-cancel'},Array.from({length:200},(_,i)=>`星${i}`));const cancelWorkflow=structuredClone(w);cancelWorkflow.id='f-cancel';cancelWorkflow.nodes[0].params.resourceId='f-cancel';
    const estimate=await h.estimateWorkflow(w),runId=crypto.randomUUID();await h.beginRun(cancelWorkflow,runId);
    const cancel=new Worker(url,{type:'module'});let messages=0;cancel.onmessage=()=>messages++;cancel.postMessage({workflow:cancelWorkflow,runId,keep:20});const cancelledTask=(async()=>{await new Promise(r=>setTimeout(r,70));cancel.terminate();await h.finishRun(runId,'cancelled');})();
    const changed=await new Promise<any>((resolve,reject)=>{const worker=new Worker(url,{type:'module'});let updated=false;worker.onmessage=async({data})=>{if(data.type==='batch'&&!updated){updated=true;const meta=await h.db.resources.get(id);await h.db.resources.update(id,{version:meta.version+1});}if(['error','done'].includes(data.type)){worker.terminate();resolve({type:data.type,message:data.message,updated});}};worker.onerror=e=>reject(new Error(e.message));worker.postMessage({workflow:w,optimize:true});});
    await cancelledTask;const count=await h.db.generated.where('runId').equals(runId).count(),before=messages;await new Promise(r=>setTimeout(r,200));
    const reverse=new Worker(reverseUrl,{type:'module'}),samples:any[]=[];
    for(let i=0;i<3;i++){if(i===2){const meta=await h.db.resources.get(id);await h.db.resources.update(id,{version:meta.version+1});}const start=performance.now(),data=await new Promise<any>((resolve,reject)=>{reverse.onmessage=({data})=>{if(data.type==='done')resolve(data);if(data.type==='error')reject(new Error(data.message));};reverse.postMessage({id:i,input:'月1',options:{resourceIds:[id]}});});samples.push({ms:performance.now()-start,cacheHit:data.result.cacheHit,matches:data.result.matches.length});}reverse.terminate();
    return {changed,stale:!await h.estimateIsCurrent(w,estimate),cancelled:(await h.db.runs.get(runId)).status,noLate:before===messages&&count===await h.db.generated.where('runId').equals(runId).count(),partial:count,reverse:samples};
  },{url:workerUrl(),reverseUrl});
  writeFileSync('docs/p2-f/concurrency-reverse.json',JSON.stringify(r,null,2));expect(r.changed.type).toBe('error');expect(r.changed.message).toMatch(/更改|变化/);expect(r.stale).toBe(true);expect(r.cancelled).toBe('cancelled');expect(r.noLate).toBe(true);expect(r.reverse.map(s=>s.cacheHit)).toEqual([false,true,false]);
});
