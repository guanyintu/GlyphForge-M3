import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
mkdirSync("docs/playertrack", {recursive:true});

async function open(page:Page) {
  await page.goto("/");
  const nav=page.getByRole("button",{name:"FF14 玩家语料词库",exact:true});
  if(await page.getByRole("button",{name:"展开侧栏"}).isVisible())await page.getByRole("button",{name:"展开侧栏"}).click();
  await nav.click();await expect(page.getByRole("heading",{level:1})).toHaveText("FF14 玩家语料词库");
}
async function dbSnapshot(page:Page) {
  return page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
    const values=await new Promise<{resources:{id:string;count:number}[];runs:{id:string;createdAt:number;status:string}[];generated:{text:string;runId:string}[]}>(resolve=>{
      const t=db.transaction(["resources","runs","generated"]),a=t.objectStore("resources").getAll(),b=t.objectStore("runs").getAll(),c=t.objectStore("generated").getAll();t.oncomplete=()=>resolve({resources:a.result,runs:b.result,generated:c.result});
    });db.close();return values;
  });
}
async function draw(page:Page) {
  await page.getByRole("button",{name:"生成 ID",exact:true}).click();
  await expect(page.getByRole("button",{name:"生成 ID",exact:true})).toBeVisible({timeout:20000});
  await expect(page.locator(".candidate-text").first()).toBeVisible();
  const snapshot=await dbSnapshot(page),last=snapshot.runs.sort((a,b)=>b.createdAt-a.createdAt)[0];
  expect(last.status).toBe("done");return snapshot.generated.filter(c=>c.runId===last.id).map(c=>c.text);
}

test("six styles install idempotently and use the real production Worker with independent length policies",async({page})=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await open(page);await page.getByRole("button",{name:"安装六套词库",exact:true}).click();
  await expect(page.getByRole("button",{name:"停用词库",exact:true})).toBeVisible();
  const first=await dbSnapshot(page);await page.getByRole("button",{name:"安装六套词库",exact:true}).click();
  await expect(page.getByRole("status").filter({hasText:"六套风格词库已安装"})).toBeVisible();
  expect((await dbSnapshot(page)).resources.filter(r=>r.id.startsWith("playertrack")).length).toBe(12);
  const results:Record<string,number[]>={};
  for(const title of ["海都潮人","萌系日常","自然意象","清冷文艺","奇幻角色","趣味潮流"]) {
    if(title!=="海都潮人") {await page.getByRole("button",{name:"FF14 玩家语料词库",exact:true}).click();await page.locator(".corpus-style").filter({hasText:title}).click();}
    await page.getByRole("button",{name:"使用此词库生成",exact:true}).click();
    await expect(page.locator(".studio,.cm-editor,.react-flow")).toHaveCount(0);
    const values=await draw(page);expect(new Set(values).size).toBe(values.length);expect(values.length).toBeGreaterThan(20);
    const lengths=values.map(t=>[...t].length);expect(lengths.every(n=>n>=2&&n<=(title==="海都潮人"?3:6))).toBe(true);
    if(title!=="海都潮人")expect(lengths.some(n=>n>3)).toBe(true);
    results[title]=[...new Set(lengths)].sort();
  }
  expect(errors).toEqual([]);writeFileSync("docs/playertrack/worker-styles.json",JSON.stringify({firstResourceCounts:first.resources.filter(r=>r.id.startsWith("playertrack")),lengths:results,errors},null,2));
});

test("review, tag edits, disable and JSON export/import survive reload without duplicate entries",async({page})=>{
  await open(page);await page.getByRole("button",{name:"安装此词库",exact:true}).click();
  await page.getByLabel("搜索语料",{exact:true}).fill("零");
  await page.getByRole("button",{name:"零",exact:true}).click();
  await page.getByLabel("编辑语义标签").fill("modern,人工检查");await page.getByLabel("人工权重",{exact:true}).fill("2.5");
  await page.getByLabel("编辑审核状态").selectOption("APPROVED");await page.getByRole("button",{name:"保存素材",exact:true}).click();
  const pending=page.waitForEvent("download");await page.getByRole("button",{name:"导出词库",exact:true}).click();
  const file=(await (await pending).path())!;const saved=JSON.parse(readFileSync(file,"utf8"));
  expect(saved.entries.find((e:{text:string})=>e.text==="零").manualWeight).toBe(2.5);
  await page.locator(".corpus-toolbar input[type=file]").setInputFiles(file);
  await page.getByRole("button",{name:"停用词库",exact:true}).click();
  await expect(page.getByRole("button",{name:"使用此词库生成",exact:true})).toBeDisabled();
  await open(page);await expect(page.getByRole("button",{name:"启用词库",exact:true})).toBeVisible();
  await page.getByLabel("搜索语料",{exact:true}).fill("零");await page.getByRole("button",{name:"零",exact:true}).click();
  await expect(page.getByLabel("人工权重",{exact:true})).toHaveValue("2.5");await expect(page.getByLabel("编辑语义标签")).toHaveValue("modern,人工检查");
  const pending2=page.waitForEvent("download");await page.getByRole("button",{name:"导出词库",exact:true}).click();
  const again=JSON.parse(readFileSync((await (await pending2).path())!,"utf8"));expect(again.entries).toEqual(saved.entries);
});

test("full material install is paginated, batch review persists and editor stays bounded",async({page})=>{
  const requests:string[]=[];page.on("request",r=>{if(!r.url().startsWith("http://127.0.0.1")&&!r.url().startsWith("blob:"))requests.push(r.url());});
  await open(page);await page.getByRole("button",{name:"基础素材与全量审核",exact:true}).click();
  const start=Date.now();await page.getByRole("button",{name:"安装此词库",exact:true}).click();
  await expect(page.locator(".corpus-detail .corpus-table tbody tr")).toHaveCount(50,{timeout:20000});const installMs=Date.now()-start;
  const snapshot=await dbSnapshot(page);expect(snapshot.resources.find(r=>r.id==="playertrack-v1-all")!.count).toBeGreaterThan(9000);
  await page.getByRole("tab",{name:"单字",exact:true}).click();await page.getByLabel("审核状态筛选").selectOption("PENDING");
  await page.getByLabel("选择当前页").check();await page.getByRole("button",{name:"批量批准",exact:true}).click();
  await expect(page.locator(".corpus-batch")).toContainText("已选 0 项");
  await page.getByLabel("审核状态筛选").selectOption("APPROVED");await expect(page.locator(".corpus-detail .corpus-table tbody tr")).toHaveCount(50);
  await page.getByRole("button",{name:"ID 生成",exact:true}).click();const editStart=Date.now();
  await page.getByRole("button",{name:"编辑",exact:true}).click();await expect(page.locator(".react-flow")).toBeVisible();const editorMs=Date.now()-editStart;
  expect(editorMs).toBeLessThan(10000);expect(requests).toEqual([]);
  writeFileSync("docs/playertrack/performance.json",JSON.stringify({materials:snapshot.resources.find(r=>r.id==="playertrack-v1-all")!.count,installMs,editorMs,externalRequests:requests,scope:"single Chromium desktop sample; not P95 or physical low-end"},null,2));
});

test("mobile corpus navigation, filters and generation fit a 390px screen",async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});
  await open(page);await page.getByRole("button",{name:"安装此词库",exact:true}).click();
  await expect(page.locator(".corpus-detail .corpus-table tbody tr")).toHaveCount(50);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"docs/playertrack/mobile.png",fullPage:true});
  await page.getByRole("button",{name:"使用此词库生成",exact:true}).click();const values=await draw(page);expect(values.every(t=>[...t].length<=3)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("human relationship classification is exported and consumed by the real Worker",async({page})=>{
  const bundle=JSON.parse(readFileSync("data/playertrack/haidu.json","utf8"));
  const enabled=new Set(bundle.entries.filter((e:{enabled:boolean})=>e.enabled).map((e:{text:string})=>e.text));
  const relation=bundle.relations.find((r:{left:string;right:string})=>enabled.has(r.left)&&enabled.has(r.right)&&[...r.left+r.right].length<=3);
  await open(page);await page.getByRole("button",{name:"安装此词库",exact:true}).click();
  await page.getByRole("tab",{name:"组合关系",exact:true}).click();
  await page.getByRole("button",{name:`${relation.left} → ${relation.right}`,exact:true}).click();
  await page.getByLabel("编辑关系类型").selectOption("prefix");await page.getByLabel("编辑关系审核").selectOption("APPROVED");
  await page.getByRole("button",{name:"保存关系",exact:true}).click();
  await page.getByRole("button",{name:"使用此词库生成",exact:true}).click();
  const values=await draw(page);expect(values).toContain(relation.left+relation.right);
  await page.getByRole("button",{name:"编辑",exact:true}).click();await page.getByRole("button",{name:"NameScript",exact:true}).click();
  await expect(page.locator(".cm-content")).toContainText("corpus(");
  await page.getByRole("button",{name:"保存并返回",exact:true}).click();
  await page.getByText("生成设置",{exact:true}).click();await page.getByRole("button",{name:"导出工作流",exact:true}).click();
  const pending=page.waitForEvent("download");await page.getByRole("button",{name:"导出便携包",exact:true}).click();
  const file=(await (await pending).path())!;const pkg=JSON.parse(readFileSync(file,"utf8"));expect(pkg.version).toBe(6);expect(pkg.resources).toHaveLength(2);
});
