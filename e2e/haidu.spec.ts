import { enterEditor } from "./editor-steps";
import { test, expect } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
mkdirSync("docs/haidu", { recursive: true });
async function choose(page:import("@playwright/test").Page){
 await page.goto("/"); await expect(page.getByLabel("选择工作流",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:/从灵感配方开始/}).click();
 await page.getByRole("button",{name:/海都潮人 ID 工作流/}).click();
 await enterEditor(page);
 await expect(page.getByLabel("工作流名称")).toHaveValue(/海都潮人 ID/);
 await expect(page.locator(".studio")).toBeVisible();
}
async function names(page:import("@playwright/test").Page){
 return page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const rows=await new Promise<{runId:string;text:string}[]>((resolve,reject)=>{const tx=db.transaction(["runs","generated"]);const r=tx.objectStore("runs").getAll();r.onsuccess=()=>{const last=r.result.sort((a,b)=>b.createdAt-a.createdAt)[0];const g=tx.objectStore("generated").index("runId").getAll(last.id);g.onsuccess=()=>resolve(g.result);g.onerror=()=>reject(g.error);};r.onerror=()=>reject(r.error);});
  db.close();return rows.map(r=>r.text);
 });
}
async function draw(page:import("@playwright/test").Page,count="24"){
 await page.getByRole("button",{name:/^运行工作流/}).click();
 await expect(page.locator(".results-heading .count-badge")).toHaveText(count,{timeout:15000});
 await expect(page.getByRole("button",{name:/^运行工作流/})).toBeVisible();
 return names(page);
}
test("Haidu uses the existing editor behind Edit and preserves all five columns",async({page})=>{
 await choose(page);
 await expect(page.locator(".haidu-page")).toHaveCount(0);
 await expect(page.getByRole("button",{name:"编辑",exact:true})).toHaveCount(0);
 const before=await draw(page);expect(before).toHaveLength(24);expect(new Set(before).size).toBe(24);
 expect(before.every(t=>[2,3].includes([...t].length))).toBe(true);
 await page.getByRole("button",{name:"NameScript",exact:true}).click();
 await expect(page.locator(".cm-content")).toContainText("glyphforge:preset:haidu-workflow-v3");
 expect((await page.locator(".cm-content").innerText()).match(/for /g)!.length).toBe(8);
 await page.getByRole("button",{name:"节点画布",exact:true}).click();
 expect(await draw(page)).toEqual(before);
 await page.screenshot({path:"docs/haidu/workflow-v3-desktop.png",fullPage:true});
 await expect.poll(()=>page.evaluate(()=>localStorage.getItem("glyphforge-active"))).not.toBeNull();
 await page.waitForTimeout(700);await page.reload();await expect(page.locator(".studio")).toHaveCount(0);await enterEditor(page);
 await expect(page.locator(".studio")).toBeVisible();await expect(page.getByLabel("工作流名称")).toHaveValue(/海都潮人 ID/);
});
test("cloud sharing and OAuth navigation are off while local export and import remain",async({page})=>{
 const requests:string[]=[];page.on("request",r=>{if(/supabase|example\.invalid|oauth\/authorize/.test(r.url()))requests.push(r.url());});
 await page.goto("/?code=disabled-cloud");await enterEditor(page);
 await expect(page.getByRole("button",{name:"社区广场",exact:true})).toHaveCount(0);
 await page.getByRole("button",{name:"导出工作流",exact:true}).click();
 await expect(page.getByRole("heading",{name:"本地导入与导出"})).toBeVisible();
 await expect(page.getByRole("button",{name:"导出便携包",exact:true})).toBeVisible();
 expect(requests).toEqual([]);
});
test("editing the actual core pool changes results without a relationship edit",async({page})=>{
 await choose(page);
 await page.evaluate(async()=>{
  const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(["resources","entries"],"readwrite");tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);const r=tx.objectStore("resources").getAll();r.onsuccess=()=>{const meta=r.result.find(x=>x.name.includes("双字前词与直出"));tx.objectStore("entries").add({resourceId:meta.id,text:"测试"});tx.objectStore("resources").put({...meta,version:meta.version+1,count:meta.count+1});};});db.close();
 });
 await page.locator(".react-flow__node").filter({hasText:"精选与多样性"}).click();
 await page.getByLabel("精选 includes").fill("测试");
 const output=await draw(page,"2");expect(new Set(output)).toEqual(new Set(["测试","小测试"]));
});
test("local portable export restores the workflow and all real dependencies in a blank browser",async({page,browser})=>{
 await choose(page);const before=await draw(page);
 await page.getByRole("button",{name:"导出工作流",exact:true}).click();
 const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出便携包",exact:true}).click();
 const file=await(await download).path();const pkg=JSON.parse(readFileSync(file!,"utf8"));expect(pkg.version).toBe(6);expect(pkg.resources).toHaveLength(9);
 const context=await browser.newContext();const other=await context.newPage();await other.goto("/");await enterEditor(other);await expect(other.getByText(/生成完成/).first()).toBeVisible();
 await other.getByRole("button",{name:"导入",exact:true}).click();await other.locator('input[type=file][hidden]').setInputFiles(file!);
 await expect(other.getByLabel("工作流名称")).toHaveValue(/海都潮人 ID/);
 expect(await draw(other)).toEqual(before);await context.close();
});
test("mobile uses the same workflow editor and keeps the offline resource and result controls",async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});
 await page.goto("/");await enterEditor(page);await expect(page.getByRole("button",{name:/^运行工作流/})).toBeVisible();await page.getByRole("button",{name:"展开侧栏"}).click();
 await page.getByRole("button",{name:/从灵感配方开始/}).click();await page.getByRole("button",{name:/海都潮人 ID 工作流/}).click();
 await expect(page.getByRole("button",{name:"关闭侧栏",exact:true})).toHaveCount(0);
 await draw(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:"docs/haidu/workflow-v3-mobile.png",fullPage:true});
});
test("sampled five-column workflow remains bounded in the production Worker",async({page,browser})=>{
 await choose(page);const start=Date.now();const output=await draw(page);
 const result={browser:browser.version(),count:output.length,generateWithUIandPersistenceMs:Date.now()-start};
 await writeFile("docs/haidu/workflow-v3-browser-performance.json",JSON.stringify(result,null,2));expect(result.generateWithUIandPersistenceMs).toBeLessThan(10000);
});

test("old Haidu drafts remain intact and expose a safe route to the five-column recipe",async({page})=>{
 await page.goto("/");await enterEditor(page);await expect(page.getByRole("button",{name:/^运行工作流/})).toBeVisible();
 await page.getByRole("button",{name:"导入",exact:true}).click();await page.locator('input[type=file][hidden]').setInputFiles("examples/haidu-chao-ren.v2.portable.json");
 await expect(page.getByRole("button",{name:"打开五列工作流",exact:true})).toBeVisible();
 await page.getByLabel("工作流名称").fill("我的海都旧草稿");
 await page.getByRole("button",{name:"打开五列工作流",exact:true}).click();
 await expect(page.getByLabel("工作流名称")).toHaveValue(/五列工作流/);
 await expect(page.locator(".saved-workflows")).toContainText("我的海都旧草稿");
});
