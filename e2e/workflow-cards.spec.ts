import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("docs/playertrack",{recursive:true});
const styles=["萌系日常","自然意象","清冷文艺","奇幻角色","趣味潮流","海都潮人"];
const card=(page:Page,name:string)=>page.getByRole("button",{name:`选择工作流：${name}`,exact:true});
async function draw(page:Page) {
  await page.getByRole("button",{name:"生成 ID",exact:true}).click();
  await expect(page.getByRole("button",{name:"停止生成",exact:true})).toHaveCount(0,{timeout:20000});
  await expect(page.locator(".results-heading .count-badge")).toHaveText("75");
  return page.evaluate(async()=>{
    const database=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
    const rows=await new Promise<{text:string}[]>(resolve=>{const tx=database.transaction(["runs","generated"]);const r=tx.objectStore("runs").getAll();r.onsuccess=()=>{const latest=r.result.sort((a,b)=>b.createdAt-a.createdAt)[0];const g=tx.objectStore("generated").index("runId").getAll(latest.id);g.onsuccess=()=>resolve(g.result);};});
    database.close();return rows.map(r=>r.text);
  });
}

test("the workflow dropdown is replaced by cards, including all six ready-to-use FF14 workflows",async({page})=>{
  await page.goto("/");
  const picker=page.getByRole("group",{name:"选择工作流",exact:true});
  await expect(picker).toBeVisible();await expect(picker.locator("select")).toHaveCount(0);
  await expect(picker.locator(".workflow-card")).toHaveCount(11);
  for(const style of styles)await expect(card(page,`FF14 · ${style}`)).toBeEnabled();
  await card(page,"FF14 · 萌系日常").focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{level:1})).toHaveText("FF14 · 萌系日常");
  await expect(card(page,"FF14 · 萌系日常")).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".studio,.cm-editor,.react-flow")).toHaveCount(0);
  await expect(page.locator(".results-heading .count-badge")).toHaveText("0");
  await page.screenshot({path:"docs/playertrack/cards-desktop.png",fullPage:true});
});
test("every FF14 card runs a real workflow immediately, survives reload and is installed only once",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto("/");
  const results:Record<string,{count:number;lengths:number[]}>= {};
  for(const style of styles){
    await card(page,`FF14 · ${style}`).click();await expect(page.getByRole("heading",{level:1})).toHaveText(`FF14 · ${style}`);
    const values=await draw(page),lengths=[...new Set(values.map(t=>[...t].length))].sort();
    expect(new Set(values).size).toBe(75);expect(lengths.every(n=>n>=2&&n<=(style==="海都潮人"?3:6))).toBe(true);
    if(style!=="海都潮人")expect(lengths.some(n=>n>3)).toBe(true);
    results[style]={count:values.length,lengths};
    await expect(page.locator(".workflow-card")).toHaveCount(11);
  }
  await card(page,"FF14 · 萌系日常").click();await card(page,"FF14 · 海都潮人").click();await page.reload();
  await expect(card(page,"FF14 · 海都潮人")).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".studio,.cm-editor")).toHaveCount(0);
  const counts=await page.evaluate(async()=>{
    const database=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
    const value=await new Promise<{workflows:number;resources:number}>(resolve=>{const tx=database.transaction(["workflows","resources"]),w=tx.objectStore("workflows").getAll(),r=tx.objectStore("resources").getAll();tx.oncomplete=()=>resolve({workflows:w.result.filter(w=>w.comments?.includes("// glyphforge:playertrack:v1")).length,resources:r.result.filter(r=>r.id.startsWith("playertrack-v1-")).length});});database.close();return value;
  });
  expect(counts).toEqual({workflows:6,resources:12});expect(errors).toEqual([]);
  writeFileSync("docs/playertrack/cards-worker-results.json",JSON.stringify({results,counts,errors},null,2));
});
test("saved workflow names and settings remain selectable after editing and refresh",async({page})=>{
  await page.goto("/");await card(page,"FF14 · 自然意象").click();
  await page.getByRole("button",{name:"编辑",exact:true}).click();await page.getByLabel("工作流名称",{exact:true}).fill("我的自然草稿");
  await page.getByRole("button",{name:"保存并返回",exact:true}).click();
  await page.getByText("生成设置",{exact:true}).click();await page.getByLabel("固定种子",{exact:true}).check();await page.getByLabel("生成种子",{exact:true}).fill("731");
  const first=await draw(page);await card(page,"宇宙浪漫命名器").click();await card(page,"我的自然草稿").click();
  expect(await draw(page)).toEqual(first);await page.reload();
  await expect(page.getByRole("heading",{level:1})).toHaveText("我的自然草稿");await expect(card(page,"我的自然草稿")).toHaveAttribute("aria-pressed","true");
  await expect(page.locator(".workflow-card")).toHaveCount(11);
});
test("mobile uses two card columns and can choose FF14 and the original xlsx without overflow",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/");
  await expect(card(page,"FF14 · 萌系日常")).toBeVisible();
  const first=await card(page,"FF14 · 萌系日常").boundingBox(),second=await card(page,"FF14 · 自然意象").boundingBox();
  expect(second!.x).toBeGreaterThan(first!.x);expect(second!.y).toBe(first!.y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"docs/playertrack/cards-mobile.png",fullPage:true});
  await card(page,"FF14 · 海都潮人").click();expect((await draw(page)).every(t=>[...t].length<=3)).toBe(true);
  await card(page,"海都潮人 ID · 原版 xlsx").click();expect((await draw(page)).every(t=>[...t].length<=3)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("unapplied code disables card switching and keeps the existing workflow and draft",async({page})=>{
  await page.goto("/");await card(page,"FF14 · 萌系日常").click();await page.getByRole("button",{name:"编辑",exact:true}).click();
  await page.getByRole("button",{name:"NameScript",exact:true}).click();await page.locator(".cm-content").fill('let source = resource("animals");\nlet result = output(source);');
  await page.getByRole("button",{name:"返回生成",exact:true}).click();await expect(page.getByText(/编辑草稿已保留/)).toBeVisible();
  await expect(card(page,"FF14 · 自然意象")).toBeDisabled();await expect(card(page,"海都潮人 ID · 原版 xlsx")).toBeDisabled();
  await page.getByRole("button",{name:"编辑",exact:true}).click();await expect(page.locator(".cm-content")).toContainText('resource("animals")');
});
test("uploaded portable workflow JSON loads offline through the existing importer",async({page})=>{
  await page.goto("/");const response=await page.request.get("/workflows/ff14-fantasy.json");expect(response.ok()).toBe(true);
  const buffer=await response.body();await page.getByText("生成设置",{exact:true}).click();await page.getByRole("button",{name:"导入",exact:true}).click();
  await page.locator('input[type=file][hidden]').setInputFiles({name:"ff14-fantasy.json",mimeType:"application/json",buffer});
  await expect(page.getByRole("heading",{level:1})).toContainText("FF14 · 奇幻角色");
  expect((await draw(page)).some(t=>[...t].length>3)).toBe(true);
});
test("opening a lazy workflow disables generation until selection is complete",async({page})=>{
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/assets\/cute-[^/]+\.js/,async route=>{await gate;await route.continue();});
  await page.goto("/");await card(page,"FF14 · 萌系日常").click();
  await expect(page.getByRole("button",{name:"正在打开…",exact:true})).toBeDisabled();
  await expect(card(page,"FF14 · 自然意象")).toBeDisabled();release();
  await expect(page.getByRole("heading",{level:1})).toHaveText("FF14 · 萌系日常");
  await expect(page.getByRole("button",{name:"生成 ID",exact:true})).toBeEnabled();
});
