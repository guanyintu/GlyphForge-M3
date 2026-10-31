import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
test.beforeAll(() => execFileSync(process.execPath, ['node_modules/vite/bin/vite.js','build','--config','e2e/share.vite.config.ts'], {stdio:'pipe'}));
const workerURL = () => '/assets/'+readdirSync('dist/assets').find(s=>/^execution\.worker-.*\.js$/.test(s));
async function open(page:any) { await page.goto('/');await expect(page.getByText(/生成完成/)).toBeVisible(); }
async function share(page:any) { await page.getByRole('button',{name:'导出工作流',exact:true}).click(); }
function evidence(name:string,data:unknown){writeFileSync(`docs/p2-g/${process.env.P2G_SAMPLE||'targeted'}-${name}.json`,JSON.stringify(data,null,2));}

test('UI selected portable code → copy → offline new context → readonly preview → confirm → run → refresh',async({page,browser,context})=>{
  await context.grantPermissions(['clipboard-read','clipboard-write']);await open(page);await share(page);
  await page.getByLabel('分享码模式',{exact:true}).selectOption('portable');await page.getByRole('button',{name:'生成短分享码',exact:true}).click();
  const output=page.getByLabel('生成的分享码',{exact:true});await expect(output).toHaveValue(/^GFS1/);const code=await output.inputValue();
  await page.getByRole('button',{name:'复制分享码',exact:true}).click();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(code);
  const fresh=await browser.newContext();const target=await fresh.newPage();const external:string[]=[];
  await fresh.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();external.push(route.request().url());return route.abort();});
  await open(target);await share(target);const before=await target.evaluate(async()=>{const h=await import('/share-harness/share.js');return Promise.all(h.db.tables.map((t:any)=>t.count()));});
  await target.getByLabel('粘贴分享码',{exact:true}).fill(code);await target.getByRole('button',{name:'解码并预览（不写入）'}).click();const preview=target.getByLabel('分享码导入预览',{exact:true});await expect(preview).toBeVisible();await expect(preview).toContainText('所选快照');
  const after=await target.evaluate(async()=>{const h=await import('/share-harness/share.js');return Promise.all(h.db.tables.map((t:any)=>t.count()));});expect(after).toEqual(before);
  await target.screenshot({path:`docs/p2-g/${process.env.P2G_SAMPLE||'targeted'}-preview.png`,fullPage:true});
  await target.getByRole('button',{name:'确认导入工作流'}).click();await expect(target.getByRole('dialog')).not.toBeVisible();await target.getByRole('button',{name:/^运行工作流/}).click();await expect(target.getByText(/生成完成/)).toBeVisible();await expect(target.locator('.candidate-text').first()).toBeVisible();
  const texts=await target.locator('.candidate-text').allTextContents();await target.reload();await expect(target.locator('.candidate-text').first()).toBeVisible();expect(await target.locator('.candidate-text').allTextContents()).toEqual(texts);expect(external).toEqual([]);
  evidence('ui',{chars:code.length,previewNoWrites:before,results:texts,external});await fresh.close();
});

test('UI light dependency binding, unselected resources, mode/unmount cancellation and large-package file fallback',async({page})=>{
  await open(page);await share(page);await page.getByRole('button',{name:'生成短分享码',exact:true}).click();await expect(page.getByLabel('生成的分享码',{exact:true})).toHaveValue(/^GFS1/);
  const light=await page.getByLabel('生成的分享码',{exact:true}).inputValue();const decoded=await page.evaluate(async code=>{const h=await import('/share-harness/share.js');return h.decodeShareCode(code);},light);expect((decoded as any).resources).toEqual([]);
  await page.getByLabel('分享码模式',{exact:true}).selectOption('portable');const checks=page.locator('.share-resources input');await checks.first().uncheck();await page.getByRole('button',{name:'生成短分享码',exact:true}).click();await expect(page.getByLabel('生成的分享码',{exact:true})).toHaveValue(/^GFS1/);
  const selected=await page.evaluate(async code=>{const h=await import('/share-harness/share.js');return h.decodeShareCode(code);},await page.getByLabel('生成的分享码',{exact:true}).inputValue());expect((selected as any).resources.length).toBe(await checks.count()-1);
  const missing=await page.evaluate(async code=>{const h=await import('/share-harness/share.js');const p:any=await h.decodeShareCode(code);const old=p.workflow.nodes.filter((n:any)=>n.op==='resource');for(const n of old){const dep=p.dependencies.find((d:any)=>d.id===n.params.resourceId);dep.id='missing-'+dep.id;n.params.resourceId=dep.id;}return (await h.encodeShareCode(p)).code;},light);
  await page.getByLabel('粘贴分享码',{exact:true}).fill(missing);await page.getByRole('button',{name:'解码并预览（不写入）'}).click();await expect(page.getByLabel('分享码导入预览',{exact:true})).toContainText('缺失');await page.getByRole('button',{name:'确认导入工作流'}).click();await expect(page.getByRole('dialog')).toHaveAccessibleName('重新绑定资源');
  const selects=page.getByRole('dialog').locator('select');for(const select of await selects.all()){const value=await select.locator('option').nth(1).getAttribute('value');await select.selectOption(value!);}await page.getByRole('button',{name:'绑定并导入'}).click();await expect(page.getByRole('dialog')).not.toBeVisible();
  await share(page);
  await page.evaluate(()=>{const Native=window.Worker;(window as any).restoreShareWorker=()=>{window.Worker=Native;};(window as any).Worker=class extends Native {postMessage(data:any){setTimeout(()=>super.postMessage(data),500);}};});
  await page.getByRole('button',{name:'生成短分享码',exact:true}).click();await page.getByRole('button',{name:'取消分享任务'}).click();await expect(page.getByLabel('生成的分享码',{exact:true})).not.toBeVisible();
  await page.getByRole('button',{name:'生成短分享码',exact:true}).click();await page.getByLabel('分享码模式',{exact:true}).selectOption('portable');await expect(page.getByLabel('生成的分享码',{exact:true})).not.toBeVisible();
  await page.getByRole('button',{name:'生成短分享码',exact:true}).click();await page.getByRole('button',{name:'关闭',exact:true}).click();await share(page);await expect(page.getByLabel('生成的分享码',{exact:true})).not.toBeVisible();
  await page.getByRole('button',{name:'关闭',exact:true}).click();await page.evaluate(()=>(window as any).restoreShareWorker());
  // Import a legal >1MiB portable package via the existing JSON file UI, then try its code.
  const big=await page.evaluate(async()=>{const h=await import('/share-harness/share.js');const id='big-code';await h.saveNewResource({id,name:'大包',kind:'word',version:1,count:0,color:'green',description:'',updatedAt:0},Array.from({length:7000},(_,i)=>`${i}-${'月'.repeat(80)}`));return h.exportPackage(h.resourceWorkflow(id));});
  await page.locator('input[type=file][accept=".json"]').first().setInputFiles({name:'large.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(big))});await expect(page.getByRole('button',{name:'资源复用 · 导入',exact:true})).toBeVisible();await share(page);await page.getByLabel('分享码模式',{exact:true}).selectOption('portable');await page.getByRole('button',{name:'生成短分享码',exact:true}).click();await expect(page.getByRole('status').filter({hasText:/1 MiB/})).toBeVisible();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出便携包',exact:true}).click();expect((await download).suggestedFilename()).toContain('.portable.json');
});

test('production Worker exact JSON/code equivalence for simple/NameScript/nested subgraphs/mutation/dynamic Mapping/v7 in empty IDB',async({page,browser})=>{
  test.setTimeout(120000);await open(page);const saved=await page.evaluate(async url=>{
    const h=await import('/share-harness/share.js');const meta=(id:string)=>({id,name:id,kind:'word',version:1,count:0,color:'green',description:'',updatedAt:0});
    await h.saveNewResource(meta('g-source'),['月','星']);await h.saveDefinedResource({...meta('g-map'),kind:'mapping',definition:{format:1,type:'mapping',rules:'{"月":["玥"],"星":["☆"]}'}});await h.installPacks([h.firstPartyPacks[0]]);
    const simple=h.resourceWorkflow('g-source');const multi=h.resourceWorkflow('g-source');multi.nodes.splice(1,0,{id:'prefix',op:'prefix',inputs:['source'],params:{text:'小'}});multi.nodes.at(-1).inputs=['prefix'];
    let nested=h.parseScript(h.toScript(multi),multi);for(let i=0;i<3;i++)nested=h.extractSubgraph(nested,nested.nodes.filter((n:any)=>!['resource','output'].includes(n.op)).map((n:any)=>n.id)).workflow;
    const mutation=h.mutationWorkflow({text:'月星',parts:[]},{operations:'["insert","reorder"]',pool:'云',count:8},42);
    const inner=structuredClone(nested);inner.extensions=[h.firstPartyPacks[0]];inner.nodes.splice(-1,0,{id:'mapped',op:'mapchars',inputs:[inner.nodes.at(-1).inputs[0]],params:{mappingId:'g-map',mapping:'{}',mode:'first'}},{id:'ext',op:'extension',inputs:['mapped'],params:{pack:'glyphforge-text',version:'1.0.0',operator:'frame',values:'{}'}});inner.nodes.at(-1).inputs=['ext'];await h.saveDefinedResource({...meta('g-dag'),definition:{format:1,type:'dynamic',workflow:inner}});
    const dynamic6=structuredClone(inner);delete dynamic6.extensions;dynamic6.nodes=dynamic6.nodes.filter((n:any)=>n.id!=='ext');dynamic6.nodes.at(-1).inputs=['mapped'];await h.saveDefinedResource({...meta('g-dag6'),definition:{format:1,type:'dynamic',workflow:dynamic6}});
    const fixtures=[simple,multi,nested,mutation,h.resourceWorkflow('g-dag6'),h.resourceWorkflow('g-dag')];const out=[];
    for(const w of fixtures){const before:any=await new Promise((resolve,reject)=>{const worker=new Worker(url,{type:'module'}),rows:any[]=[];worker.onmessage=({data})=>{if(data.type==='batch')rows.push(...data.batch);if(data.type==='error'){worker.terminate();reject(new Error(data.message));}if(data.type==='done'){worker.terminate();resolve({rows,stats:data.stats});}};worker.onerror=e=>reject(new Error(e.message));worker.postMessage(w);});
      const plan=await h.captureResources(h.dependencyIds(w));let normalized=JSON.stringify(before.rows.map(({runId,workflowId,...r}:any)=>r)).replaceAll(w.id,'IMPORTED-WORKFLOW');for(const r of plan.resources)normalized=normalized.replaceAll(r.id,r.name);for(const [i,d] of (w.subgraphs??[]).entries())normalized=normalized.replaceAll(d.id,`DEF-${i}:${d.name}`);
      const p=await h.exportPackage(w);const code=await h.encodeShareCode(p);out.push({p,code,before:JSON.parse(normalized),beforeSteps:before.stats.steps});}return {fixtures:out,url};
  },workerURL());
  const empty=await browser.newContext();await empty.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());const target=await empty.newPage();await target.route('**/__p2g-empty.html',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Empty IDB validation</title>'}));await target.goto('/__p2g-empty.html');
  const report=await target.evaluate(async saved=>{
    const h=await import('/share-harness/share.js');const initial=await Promise.all(h.db.tables.map((t:any)=>t.count()));const results=[];
    async function run(w:any){return new Promise<any>((resolve,reject)=>{const worker=new Worker(saved.url,{type:'module'}),rows:any[]=[];worker.onmessage=({data})=>{if(data.type==='batch')rows.push(...data.batch);if(data.type==='error'){worker.terminate();reject(new Error(data.error));}if(data.type==='done'){worker.terminate();resolve({rows,stats:data.stats});}};worker.onerror=e=>reject(new Error(e.message));worker.postMessage(w);});}
    async function normalized(w:any,rows:any[]){const plan=await h.captureResources(h.dependencyIds(w));let s=JSON.stringify(rows.map(({runId,workflowId,...r}:any)=>r)).replaceAll(w.id,'IMPORTED-WORKFLOW');for(const r of plan.resources)s=s.replaceAll(r.id,r.name.replace(/ · 导入/g,''));for(const [i,d] of (w.subgraphs??[]).entries())s=s.replaceAll(d.id,`DEF-${i}:${d.name}`);return s;}
    for(const {p,code,before:originalRows,beforeSteps} of saved.fixtures){const data=await h.decodeShareCode(code.code);if(JSON.stringify(data)!==JSON.stringify(p))throw new Error('payload differs');const before=await Promise.all(h.db.tables.map((t:any)=>t.count()));await h.previewShare(data);if(JSON.stringify(before)!==JSON.stringify(await Promise.all(h.db.tables.map((t:any)=>t.count()))))throw new Error('preview wrote IDB');
      const a=await h.importPackage(p),b=await h.importPackage(data),ar=await run(a),br=await run(b);const x=await normalized(a,ar.rows),y=await normalized(b,br.rows);if(x!==y||x!==JSON.stringify(originalRows)||ar.stats.steps!==beforeSteps||br.stats.steps!==beforeSteps)throw new Error('Candidate/source differs '+p.version+' '+x+' versus '+y+' before '+JSON.stringify(originalRows));results.push({version:p.version,chars:code.chars,jsonBytes:code.jsonBytes,compressedBytes:code.compressedBytes,rows:ar.rows.length,steps:ar.stats.steps,exact:x===y&&x===JSON.stringify(originalRows),beforeSteps,normalized:JSON.parse(x)});
    }
    await h.setPackEnabled('glyphforge-text@1.0.0',false);const last=saved.fixtures.at(-1);await h.previewShare(last.p);await h.importPackage(last.p);return {initial,results,disabled:(await h.db.extensionPacks.toArray())[0].enabled};
  },saved);expect(report.initial.every((n:number)=>n===0)).toBe(true);expect(report.results).toHaveLength(6);expect(report.disabled).toBe(false);evidence('roundtrip',report);await empty.close();
});

test('native Chromium bomb/corruption/timeout/concurrency/rollback; bounded sharing/UI/heap samples',async({page})=>{
  test.setTimeout(120000);await open(page);const report=await page.evaluate(async()=>{
    const h=await import('/share-harness/share.js');const meta=(id:string)=>({id,name:id,kind:'word',version:1,count:0,color:'green',description:'',updatedAt:0});await h.saveNewResource(meta('perf-source'),Array.from({length:1000},(_,i)=>`月${i}`));
    const w=h.resourceWorkflow('perf-source');w.limit=60;w.nodes.splice(1,0,{id:'b',op:'resource',inputs:[],params:{resourceId:'perf-source'}},{id:'mix',op:'concat',inputs:['source','b'],params:{separator:':'}});w.nodes.at(-1).inputs=['mix'];
    const p=await h.exportPackage(w);const samples=[];let maxGap=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;},10);const heapBefore=(performance as any).memory?.usedJSHeapSize;const longTasks:number[]=[];const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>e.duration)));observer.observe({entryTypes:['longtask']});
    for(let i=0;i<3;i++){const start=performance.now(),encoded=await h.shareTask({action:'encode',workflow:w,selection:['perf-source']});const encodedAt=performance.now();await h.shareTask({action:'decode',code:encoded.code});samples.push({encodeMs:encodedAt-start,decodeMs:performance.now()-encodedAt,...encoded,code:undefined});}
    clearInterval(timer);observer.disconnect();const sharingRendererHeapAfter=(performance as any).memory?.usedJSHeapSize;
    const code=(await h.encodeShareCode(p)).code;const c=new AbortController();const cancelled=h.shareTask({action:'decode',code},c.signal).then(()=>false,()=>true);c.abort();const two=await Promise.all([h.shareTask({action:'decode',code}),h.shareTask({action:'decode',code})]);
    const a=h.shareTask({action:'decode',code}),b=h.shareTask({action:'decode',code});const third=await h.shareTask({action:'decode',code}).then(()=>false,()=>true);await Promise.all([a,b]);
    const raw=new TextEncoder().encode('x'.repeat(16*1024*1024));const packed=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());let binary='';for(const v of packed)binary+=String.fromCharCode(v);const bomb=`GFS1.deflate.1048576.${'0'.repeat(64)}.${btoa(binary).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')}`;
    const start=performance.now();const bombError=await h.shareTask({action:'decode',code:bomb}).then(()=>'',(e:any)=>e.message);const bombMs=performance.now()-start;
    const errors=[];for(const bad of [code.slice(0,-5),code.replace('GFS1','GFS2'),code+'!',code.replace(/\.[a-f0-9]{64}\./,'.'+'0'.repeat(64)+'.')])errors.push(await h.shareTask({action:'decode',code:bad}).then(()=>'',(e:any)=>e.message));
    const before=await Promise.all(h.db.tables.map((t:any)=>t.count()));const original=h.db.workflows.add;h.db.workflows.add=async()=>{throw new Error('injected real IDB final failure');};let rolledBack=false;try{await h.importPackage(p);}catch{rolledBack=JSON.stringify(before)===JSON.stringify(await Promise.all(h.db.tables.map((t:any)=>t.count())));}finally{h.db.workflows.add=original;}
    // A deliberately unresponsive worker verifies the main-thread hard deadline.
    const NativeWorker=window.Worker;(window as any).Worker=class extends NativeWorker {constructor(){super(URL.createObjectURL(new Blob(['self.onmessage=()=>{while(true){}}'],{type:'text/javascript'})));}};const timeoutStart=performance.now();const timeout=await h.shareTask({action:'decode',code}).then(()=>'',(e:any)=>e.message);(window as any).Worker=NativeWorker;
    clearInterval(timer);return {samples,longTasksDuringSharingMs:longTasks,sharingRendererHeapAfter,maxMainTimerGapMs:maxGap,rendererHeapBefore:heapBefore,rendererHeapAfter:(performance as any).memory?.usedJSHeapSize,cancelled:await cancelled,two:two.length,thirdRejected:third,bombError,bombMs,errors,rolledBack,timeout,timeoutMs:performance.now()-timeoutStart};
  });expect(report.cancelled).toBe(true);expect(report.thirdRejected).toBe(true);expect(report.two).toBe(2);expect(report.bombError).toContain('流式解压');expect(report.errors.every(Boolean)).toBe(true);expect(report.rolledBack).toBe(true);expect(report.timeout).toContain('8 秒');evidence('security-performance',report);
});

test('dedicated sharing Worker V8 heap samples for 10k snapshot; renderer stays responsive',async({page,context})=>{
  test.setTimeout(60000);await open(page);
  const url='/assets/'+readdirSync('dist/assets').find(s=>/^sharing\.worker-.*\.js$/.test(s));
  await page.evaluate(async url=>{
    const h=await import('/share-harness/share.js');const id='g-10k';await h.saveNewResource({id,name:id,kind:'word',version:1,count:0,color:'green',description:'',updatedAt:0},Array.from({length:10000},(_,i)=>`星${i}`));
    const worker=new Worker(url,{type:'module'});(window as any).sharingHeapWorker=worker;(window as any).sharingHeapInput={action:'encode',workflow:h.resourceWorkflow(id),selection:[id]};worker.onmessage=({data})=>{(window as any).sharingHeapResult={...data,finished:performance.now()};};
  },url);
  const cdp=await context.newCDPSession(page);
  await expect.poll(async()=>{const {targetInfos}=await cdp.send('Target.getTargets');return targetInfos.some((t:any)=>t.type==='worker'&&t.url.includes('sharing.worker'));}).toBe(true);
  const {targetInfos}=await cdp.send('Target.getTargets');const target=targetInfos.find((t:any)=>t.type==='worker'&&t.url.includes('sharing.worker'));expect(target).toBeTruthy();
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target!.targetId,flatten:false});let id=0;
  async function heap(){const request=++id;return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('heap sample timeout')),5000);const onMessage=(e:any)=>{if(e.sessionId!==sessionId)return;const m=JSON.parse(e.message);if(m.id===request){clearTimeout(timer);cdp.off('Target.receivedMessageFromTarget',onMessage);m.error?reject(new Error(m.error.message)):resolve(m.result);}};cdp.on('Target.receivedMessageFromTarget',onMessage);void cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id:request,method:'Runtime.getHeapUsage'})});});}
  const samples=[await heap()];await page.evaluate(()=>{(window as any).sharingHeapStarted=performance.now();(window as any).sharingHeapWorker.postMessage((window as any).sharingHeapInput);});
  for(let i=0;i<8;i++){await page.waitForTimeout(50);samples.push(await heap());if(await page.evaluate(()=>!!(window as any).sharingHeapResult))break;}
  await expect.poll(()=>page.evaluate(()=>!!(window as any).sharingHeapResult),{timeout:15000}).toBe(true);samples.push(await heap());
  const result=await page.evaluate(async()=>{const r=(window as any).sharingHeapResult;(window as any).sharingHeapWorker.terminate();if(r.error)throw new Error(r.error);const h=await import('/share-harness/share.js');const p:any=await h.decodeShareCode(r.result.code);return {...r.result,code:undefined,entries:p.resources[0].entries.length,elapsedMs:r.finished-(window as any).sharingHeapStarted,rendererHeapEnd:(performance as any).memory?.usedJSHeapSize};});
  expect(result.entries).toBe(10000);evidence('worker-heap',{...result,workerV8HeapSamples:samples,measurement:'CDP V8 heap samples, not RSS or absolute native allocation peak'});await cdp.detach();
});
