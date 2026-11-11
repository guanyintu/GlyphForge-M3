import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("docs/quality",{recursive:true});
const card=(page:Page,name:string)=>page.getByRole("button",{name:`选择工作流：${name}`,exact:true});
async function snapshot(page:Page) {
  return page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
    const data=await new Promise<{resources:{id:string;version:number;count:number;corpus?:{qualityVersion:number}}[];entries:{resourceId:string;text:string;corpus?:{review:string;manualWeight:number;enabled:boolean;semanticTags:string[];frequency:number;compositionRoles?:string[]}}[];favorites:{text:string}[];workflows:{id:string;name:string;seed:number}[];runs:{id:string;createdAt:number;status:string}[];generated:{text:string;runId:string;notes?:string[]}[]}>(resolve=>{
      const names=["resources","entries","favorites","workflows","runs","generated"],tx=db.transaction(names),requests=names.map(n=>tx.objectStore(n).getAll());
      tx.oncomplete=()=>resolve(Object.fromEntries(names.map((n,i)=>[n,requests[i].result])) as never);
    });db.close();return data;
  });
}
async function draw(page:Page,count=75) {
  await page.getByRole("button",{name:"生成 ID",exact:true}).click();
  await expect(page.getByRole("button",{name:"停止生成",exact:true})).toHaveCount(0,{timeout:20000});
  await expect(page.locator(".results-heading .count-badge")).toHaveText(String(count));
  const data=await snapshot(page),run=data.runs.sort((a,b)=>b.createdAt-a.createdAt)[0];expect(run.status).toBe("done");
  return data.generated.filter(c=>c.runId===run.id);
}

test("six cards generate semantic recipes directly without an installer page or network service",async({page})=>{
  const errors:string[]=[],external:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  page.on("request",r=>{if(!r.url().startsWith("http://127.0.0.1")&&!r.url().startsWith("blob:"))external.push(r.url());});
  await page.goto("/");
  await expect(page.getByRole("button",{name:/安装.*词库|FF14 玩家语料词库/})).toHaveCount(0);
  const samples:Record<string,string[]>={};
  for(const title of ["萌系日常","自然意象","清冷文艺","奇幻角色","趣味潮流","海都潮人"]){
    await card(page,`FF14 · ${title}`).click();
    const values=await draw(page);expect(new Set(values.map(c=>c.text)).size).toBe(75);
    expect(values.every(c=>c.notes?.some(n=>n.startsWith("配伍 v2：")))).toBe(true);
    expect(values.some(c=>["豆子不想上班","叶飞鸟","摆烂绝对","零海盐"].includes(c.text))).toBe(false);
    samples[title]=values.slice(0,12).map(c=>c.text);
  }
  expect(errors).toEqual([]);expect(external).toEqual([]);
  writeFileSync("docs/quality/browser-samples.json",JSON.stringify({samples,errors,external},null,2));
});

test("a genuine v1 portable workflow upgrades once and preserves edits, favorites, name and seed",async({page})=>{
  await page.goto("/");await page.getByText("生成设置",{exact:true}).click();await page.getByRole("button",{name:"导入",exact:true}).click();
  await page.locator('input[type=file][hidden]').setInputFiles("e2e/fixtures/playertrack-v1-cute.json");
  await expect(page.getByRole("heading",{level:1})).toContainText("FF14 · 萌系日常");
  const original=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
    const value=await new Promise<{frequency:number;workflowId:string;resourceId:string}>(resolve=>{
      const tx=db.transaction(["resources","entries","workflows","favorites"],"readwrite"),resources=tx.objectStore("resources").getAll();
      let frequency=0,workflowId="",resourceId="";
      resources.onsuccess=()=>{
        resourceId=resources.result.find(r=>r.corpus?.style==="cute").id;
        const entries=tx.objectStore("entries").getAll();entries.onsuccess=()=>{const e=entries.result.find(e=>e.resourceId===resourceId&&e.text==="奶茶");frequency=e.corpus.frequency;tx.objectStore("entries").put({...e,corpus:{...e.corpus,review:"REJECTED",enabled:false,manualWeight:7,semanticTags:["保留标签"]}});};
        const workflows=tx.objectStore("workflows").getAll();workflows.onsuccess=()=>{const w=workflows.result.find(w=>w.nodes.some(n=>n.params.resourceId===resourceId));workflowId=w.id;tx.objectStore("workflows").put({...w,name:"我的旧萌系",seed:731,limit:35,nodes:w.nodes.map(n=>n.op==="corpus"?{...n,params:{...n.params,count:35}}:n)});};
        tx.objectStore("favorites").put({text:"保留收藏",parts:[],savedAt:1});
      };tx.oncomplete=()=>resolve({frequency,workflowId,resourceId});
    });db.close();return value;
  });
  await page.reload();await expect(page.getByRole("heading",{level:1})).toHaveText("我的旧萌系");
  const after=await snapshot(page),meta=after.resources.find(r=>r.id===original.resourceId)!;
  expect(meta.corpus?.qualityVersion).toBe(2);
  expect(after.workflows.find(w=>w.id===original.workflowId)).toMatchObject({name:"我的旧萌系",seed:731});
  expect(after.favorites.map(f=>f.text)).toContain("保留收藏");
  expect(after.entries.find(e=>e.resourceId===original.resourceId&&e.text==="奶茶")!.corpus).toMatchObject({frequency:original.frequency,review:"REJECTED",enabled:false,manualWeight:7,semanticTags:["保留标签"]});
  const values=await draw(page,35);expect(values.every(c=>!c.text.includes("奶茶"))).toBe(true);
  expect(values.every(c=>c.notes?.some(n=>n.startsWith("配伍 v2：")))).toBe(true);
  await page.reload();await expect(page.getByRole("heading",{level:1})).toHaveText("我的旧萌系");
  const again=await snapshot(page);expect(again.resources.find(r=>r.id===original.resourceId)).toEqual(meta);
  expect(again.entries.filter(e=>e.resourceId===original.resourceId)).toHaveLength(meta.count);
  writeFileSync("docs/quality/browser-upgrade.json",JSON.stringify({original,meta,results:values.map(c=>c.text),preserved:true,idempotent:true},null,2));
});

test("mobile can generate immediately with no installer controls or horizontal overflow",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/");
  await card(page,"FF14 · 海都潮人").click();const values=await draw(page);
  expect(values.every(c=>[...c.text].length>=2&&[...c.text].length<=3)).toBe(true);
  await expect(page.getByRole("button",{name:/安装.*词库/})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"docs/quality/mobile-results.png",fullPage:true});
});

test("mobile cards display complete names of four to six characters without ellipses or clipping",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/");
  await card(page,"FF14 · 萌系日常").click();await draw(page);
  const names=await page.locator('.candidate').evaluateAll(cards=>cards.filter(card=>[...(card.getAttribute('data-candidate-text')||'')].length>3).map(card=>{
    const button=card.querySelector<HTMLElement>('.candidate-name')!,text=card.querySelector<HTMLElement>('.candidate-text')!,box=text.getBoundingClientRect(),outer=card.getBoundingClientRect();
    return {text:text.textContent,clipped:button.scrollWidth>button.clientWidth+1||button.scrollHeight>button.clientHeight+1||box.bottom>outer.bottom-5};
  }));
  expect(names.length).toBeGreaterThan(3);expect(names.filter(n=>n.clipped)).toEqual([]);
  await page.screenshot({path:"docs/quality/mobile-complete-names.png",fullPage:true});
});
