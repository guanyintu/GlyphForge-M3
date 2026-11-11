# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow-cards.spec.ts >> saved workflow names and settings remain selectable after editing and refresh
- Location: e2e\workflow-cards.spec.ts:51:1

# Error details

```
Test timeout of 45000ms exceeded.
```

```
Error: locator.click: Test timeout of 45000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '选择工作流：我的自然草稿', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到工作区" [ref=e4] [cursor=pointer]:
    - /url: "#main"
  - complementary [ref=e5]:
    - link "GlyphForge 文字创作工坊 BETA" [ref=e6] [cursor=pointer]:
      - /url: "#"
      - generic [ref=e14]:
        - text: GlyphForge
        - generic [ref=e15]: 文字创作工坊
      - generic [ref=e16]: BETA
    - generic [ref=e17]: 你的创作空间
    - navigation [ref=e18]:
      - button "ID 生成" [ref=e19] [cursor=pointer]
      - button "FF14 玩家语料词库" [ref=e26] [cursor=pointer]
      - button "我的收藏 0" [ref=e33] [cursor=pointer]:
        - generic [ref=e36]: 我的收藏
        - generic [ref=e37]: "0"
    - generic [ref=e38]:
      - generic [ref=e39]: 我的工作流
      - button "新建工作流" [ref=e40] [cursor=pointer]
    - generic [ref=e42]:
      - button "叠字的快乐" [ref=e43] [cursor=pointer]
      - button "宇宙浪漫命名器" [ref=e50] [cursor=pointer]
      - button "我的自然草稿" [ref=e58] [cursor=pointer]
      - button "镜像文字实验" [ref=e65] [cursor=pointer]
    - button "从灵感配方开始 一点小规则，无限种可能" [ref=e72] [cursor=pointer]:
      - generic [ref=e76]:
        - text: 从灵感配方开始
        - generic [ref=e77]: 一点小规则，无限种可能
    - generic [ref=e80]:
      - generic [ref=e86]:
        - text: 灵感留在本地
        - generic [ref=e87]: 无需账号，随时创作
      - button "使用指南与快捷键" [ref=e89] [cursor=pointer]
  - main [ref=e97]:
    - generic [ref=e98]:
      - generic [ref=e99]:
        - generic [ref=e103]: 个人工作空间
        - generic [ref=e106]: ID 生成
      - generic [ref=e107]:
        - generic [ref=e108]: 本地优先
        - button "使用指南" [ref=e110] [cursor=pointer]
        - generic [ref=e114]: G
    - generic [ref=e115]:
      - region "ID 生成" [ref=e116]:
        - generic [ref=e117]:
          - generic [ref=e118]: 一点灵感，一个好名字
          - button "编辑" [ref=e119] [cursor=pointer]
        - heading "宇宙浪漫命名器" [level=1] [ref=e123]
        - paragraph [ref=e124]: 选一个喜欢的工作流，看看这次会遇见什么名字。
        - group "选择工作流" [ref=e125]:
          - generic [ref=e127]:
            - generic [ref=e128]:
              - heading "选择工作流" [level=2] [ref=e129]
              - paragraph [ref=e130]: 点击卡片选取，再生成你喜欢的名字。
            - button "浏览配方" [ref=e131] [cursor=pointer]
          - generic [ref=e135]:
            - button "选择工作流：FF14 · 萌系日常" [ref=e136] [cursor=pointer]:
              - generic [ref=e137]:
                - generic [ref=e138]: FF14 玩家语料
                - generic [ref=e139]: 2–6 字
              - strong [ref=e140]: FF14 · 萌系日常
              - generic [ref=e141]: 动物、食物与亲昵表达，轻松一点，可爱一点。
              - generic [ref=e142]: 奶糖 · 草莓 · 猫猫
            - button "选择工作流：FF14 · 自然意象" [ref=e143] [cursor=pointer]:
              - generic [ref=e144]:
                - generic [ref=e145]: FF14 玩家语料
                - generic [ref=e146]: 2–6 字
              - strong [ref=e147]: FF14 · 自然意象
              - generic [ref=e148]: 从星月、山海和四季里，拾一段自然意象。
              - generic [ref=e149]: 月光 · 听雨 · 春日
            - button "选择工作流：FF14 · 清冷文艺" [ref=e150] [cursor=pointer]:
              - generic [ref=e151]:
                - generic [ref=e152]: FF14 玩家语料
                - generic [ref=e153]: 2–6 字
              - strong [ref=e154]: FF14 · 清冷文艺
              - generic [ref=e155]: 克制的情绪与文学意象，让名字留一点空白。
              - generic [ref=e156]: 留白 · 余音 · 无声
            - button "选择工作流：FF14 · 奇幻角色" [ref=e157] [cursor=pointer]:
              - generic [ref=e158]:
                - generic [ref=e159]: FF14 玩家语料
                - generic [ref=e160]: 2–6 字
              - strong [ref=e161]: FF14 · 奇幻角色
              - generic [ref=e162]: 音译字根与幻想世界的联想，为角色取个名字。
              - generic [ref=e163]: 艾琳 · 菲娜 · 希尔
            - button "选择工作流：FF14 · 趣味潮流" [ref=e164] [cursor=pointer]:
              - generic [ref=e165]:
                - generic [ref=e166]: FF14 玩家语料
                - generic [ref=e167]: 2–6 字
              - strong [ref=e168]: FF14 · 趣味潮流
              - generic [ref=e169]: 网络口语、抽象与反差，给日常加一点梗。
              - generic [ref=e170]: 赛博 · 摸鱼 · 勇者
            - button "选择工作流：FF14 · 海都潮人" [ref=e171] [cursor=pointer]:
              - generic [ref=e172]:
                - generic [ref=e173]: FF14 玩家语料
                - generic [ref=e174]: 2–3 字
              - strong [ref=e175]: FF14 · 海都潮人
              - generic [ref=e176]: 现代字根与冷感词语，短一点，利落一点。
              - generic [ref=e177]: 留白 · 失真 · 零号
            - button "选择工作流：海都潮人 ID · 原版 xlsx" [ref=e178] [cursor=pointer]:
              - generic [ref=e179]:
                - generic [ref=e180]: 海都工作流
                - generic [ref=e181]: 2–3 字
              - strong [ref=e182]: 海都潮人 ID · 原版 xlsx
              - generic [ref=e183]: 原表四列词库，保留五种经典组合。
              - generic [ref=e184]: 1+1 · 1+2 · 小xx · 直出
            - button "选择工作流：海都潮人 ID · 五列工作流" [ref=e185] [cursor=pointer]:
              - generic [ref=e186]:
                - generic [ref=e187]: 海都工作流
                - generic [ref=e188]: 2–3 字
              - strong [ref=e189]: 海都潮人 ID · 五列工作流
              - generic [ref=e190]: 独立素材池与关系评分，沿用五列工作流。
              - generic [ref=e191]: 单字组合 · 双字搭配
            - button "选择工作流：叠字的快乐" [ref=e192] [cursor=pointer]:
              - generic [ref=e193]:
                - generic [ref=e194]: 我的工作流
                - generic [ref=e195]: 自定规则
              - strong [ref=e196]: 叠字的快乐
              - generic [ref=e197]: 使用已保存的词库、规则与生成设置。
              - generic [ref=e198]: 5 个节点 · 最多 200 个结果
            - button "选择工作流：宇宙浪漫命名器" [pressed] [ref=e199] [cursor=pointer]:
              - generic [ref=e200]:
                - generic [ref=e201]: 我的工作流
                - generic [ref=e202]: 已选
              - strong [ref=e205]: 宇宙浪漫命名器
              - generic [ref=e206]: 使用已保存的词库、规则与生成设置。
              - generic [ref=e207]: 5 个节点 · 最多 200 个结果
            - button "选择工作流：镜像文字实验" [ref=e208] [cursor=pointer]:
              - generic [ref=e209]:
                - generic [ref=e210]: 我的工作流
                - generic [ref=e211]: 自定规则
              - strong [ref=e212]: 镜像文字实验
              - generic [ref=e213]: 使用已保存的词库、规则与生成设置。
              - generic [ref=e214]: 5 个节点 · 最多 200 个结果
          - generic [ref=e215]:
            - generic [ref=e216]: 11 个工作流 · 可滚动浏览
            - status [ref=e217]: 已选工作流会保留你的编辑与生成设置
        - generic [ref=e218]:
          - generic [ref=e219]: 已选择工作流，可以开始生成
          - button "生成 ID" [ref=e220] [cursor=pointer]
        - group [ref=e223]:
          - generic "生成设置" [ref=e224] [cursor=pointer]
          - generic [ref=e225]:
            - generic [ref=e226]:
              - text: 结果数量
              - spinbutton "结果数量" [ref=e227]: "200"
            - generic [ref=e228]:
              - checkbox "固定种子" [checked] [ref=e229]
              - text: 固定种子
            - generic [ref=e230]:
              - text: 种子
              - spinbutton "生成种子" [ref=e231]: "42"
          - generic [ref=e232]:
            - button "导入" [ref=e233] [cursor=pointer]
            - button "导出工作流" [ref=e236] [cursor=pointer]
      - generic [ref=e239]:
        - generic [ref=e240]:
          - generic [ref=e241]:
            - heading "生成结果" [level=2] [ref=e245]
            - generic [ref=e246]: "0"
            - generic [ref=e247]: 选好工作流，点击生成
          - generic [ref=e248]:
            - combobox "结果导出格式" [ref=e249]:
              - option "TXT" [selected]
              - option "CSV"
              - option "JSON"
            - button "复制全部" [disabled] [ref=e250]
            - button "导出" [disabled] [ref=e254]
            - button "存为词库" [disabled] [ref=e257]
        - generic [ref=e258]:
          - generic [ref=e259]:
            - textbox "筛选生成结果" [ref=e263]:
              - /placeholder: 寻找一个心动的名字…
            - generic [ref=e264]: /
          - button "只看收藏" [ref=e265] [cursor=pointer]
          - generic [ref=e268]:
            - button "卡片模式" [pressed] [ref=e269] [cursor=pointer]
            - button "列表模式" [ref=e272] [cursor=pointer]
        - generic [ref=e275]:
          - heading "每一个名字，都从一点灵感开始" [level=3] [ref=e278]
          - paragraph [ref=e279]: 选一个工作流，点击「生成 ID」，遇见喜欢的名字就收藏。
        - generic [ref=e280]:
          - generic [ref=e281]: 全部计算在你的设备完成
          - generic [ref=e283]: 点击名字复制 · 点击 ☆ 收藏
      - group [ref=e286]:
        - generic "最近生成" [ref=e287] [cursor=pointer]
      - generic [ref=e288]:
        - generic [ref=e289]: 让每一个 ID，都有一点你的样子。
        - generic [ref=e290]: GLYPHFORGE ✦ MADE FOR YOUR IMAGINATION
```

# Test source

```ts
  1  | import { test, expect, type Page } from "@playwright/test";
  2  | import { mkdirSync, writeFileSync } from "node:fs";
  3  | mkdirSync("docs/playertrack",{recursive:true});
  4  | const styles=["萌系日常","自然意象","清冷文艺","奇幻角色","趣味潮流","海都潮人"];
  5  | const card=(page:Page,name:string)=>page.getByRole("button",{name:`选择工作流：${name}`,exact:true});
  6  | async function draw(page:Page) {
  7  |   await page.getByRole("button",{name:"生成 ID",exact:true}).click();
  8  |   await expect(page.getByRole("button",{name:"停止生成",exact:true})).toHaveCount(0,{timeout:20000});
  9  |   await expect(page.locator(".results-heading .count-badge")).toHaveText("75");
  10 |   return page.evaluate(async()=>{
  11 |     const database=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
  12 |     const rows=await new Promise<{text:string}[]>(resolve=>{const tx=database.transaction(["runs","generated"]);const r=tx.objectStore("runs").getAll();r.onsuccess=()=>{const latest=r.result.sort((a,b)=>b.createdAt-a.createdAt)[0];const g=tx.objectStore("generated").index("runId").getAll(latest.id);g.onsuccess=()=>resolve(g.result);};});
  13 |     database.close();return rows.map(r=>r.text);
  14 |   });
  15 | }
  16 |
  17 | test("the workflow dropdown is replaced by cards, including all six ready-to-use FF14 workflows",async({page})=>{
  18 |   await page.goto("/");
  19 |   const picker=page.getByRole("group",{name:"选择工作流",exact:true});
  20 |   await expect(picker).toBeVisible();await expect(picker.locator("select")).toHaveCount(0);
  21 |   await expect(picker.locator(".workflow-card")).toHaveCount(11);
  22 |   for(const style of styles)await expect(card(page,`FF14 · ${style}`)).toBeEnabled();
  23 |   await card(page,"FF14 · 萌系日常").focus();await page.keyboard.press("Enter");
  24 |   await expect(page.getByRole("heading",{level:1})).toHaveText("FF14 · 萌系日常");
  25 |   await expect(card(page,"FF14 · 萌系日常")).toHaveAttribute("aria-pressed","true");
  26 |   await expect(page.locator(".studio,.cm-editor,.react-flow")).toHaveCount(0);
  27 |   await expect(page.locator(".results-heading .count-badge")).toHaveText("0");
  28 |   await page.screenshot({path:"docs/playertrack/cards-desktop.png",fullPage:true});
  29 | });
  30 | test("every FF14 card runs a real workflow immediately, survives reload and is installed only once",async({page})=>{
  31 |   const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await page.goto("/");
  32 |   const results:Record<string,{count:number;lengths:number[]}>= {};
  33 |   for(const style of styles){
  34 |     await card(page,`FF14 · ${style}`).click();await expect(page.getByRole("heading",{level:1})).toHaveText(`FF14 · ${style}`);
  35 |     const values=await draw(page),lengths=[...new Set(values.map(t=>[...t].length))].sort();
  36 |     expect(new Set(values).size).toBe(75);expect(lengths.every(n=>n>=2&&n<=(style==="海都潮人"?3:6))).toBe(true);
  37 |     if(style!=="海都潮人")expect(lengths.some(n=>n>3)).toBe(true);
  38 |     results[style]={count:values.length,lengths};
  39 |     await expect(page.locator(".workflow-card")).toHaveCount(11);
  40 |   }
  41 |   await card(page,"FF14 · 萌系日常").click();await card(page,"FF14 · 海都潮人").click();await page.reload();
  42 |   await expect(card(page,"FF14 · 海都潮人")).toHaveAttribute("aria-pressed","true");
  43 |   await expect(page.locator(".studio,.cm-editor")).toHaveCount(0);
  44 |   const counts=await page.evaluate(async()=>{
  45 |     const database=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open("glyphforge-v1");r.onsuccess=()=>resolve(r.result);});
  46 |     const value=await new Promise<{workflows:number;resources:number}>(resolve=>{const tx=database.transaction(["workflows","resources"]),w=tx.objectStore("workflows").getAll(),r=tx.objectStore("resources").getAll();tx.oncomplete=()=>resolve({workflows:w.result.filter(w=>w.comments?.includes("// glyphforge:playertrack:v1")).length,resources:r.result.filter(r=>r.id.startsWith("playertrack-v1-")).length});});database.close();return value;
  47 |   });
  48 |   expect(counts).toEqual({workflows:6,resources:12});expect(errors).toEqual([]);
  49 |   writeFileSync("docs/playertrack/cards-worker-results.json",JSON.stringify({results,counts,errors},null,2));
  50 | });
  51 | test("saved workflow names and settings remain selectable after editing and refresh",async({page})=>{
  52 |   await page.goto("/");await card(page,"FF14 · 自然意象").click();
  53 |   await page.getByRole("button",{name:"编辑",exact:true}).click();await page.getByLabel("工作流名称",{exact:true}).fill("我的自然草稿");
  54 |   await page.getByRole("button",{name:"保存并返回",exact:true}).click();
  55 |   await page.getByText("生成设置",{exact:true}).click();await page.getByLabel("固定种子",{exact:true}).check();await page.getByLabel("生成种子",{exact:true}).fill("731");
> 56 |   const first=await draw(page);await card(page,"宇宙浪漫命名器").click();await card(page,"我的自然草稿").click();
     |                                                                                             ^ Error: locator.click: Test timeout of 45000ms exceeded.
  57 |   expect(await draw(page)).toEqual(first);await page.reload();
  58 |   await expect(page.getByRole("heading",{level:1})).toHaveText("我的自然草稿");await expect(card(page,"我的自然草稿")).toHaveAttribute("aria-pressed","true");
  59 |   await expect(page.locator(".workflow-card")).toHaveCount(11);
  60 | });
  61 | test("mobile uses two card columns and can choose FF14 and the original xlsx without overflow",async({page})=>{
  62 |   await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:"reduce"});await page.goto("/");
  63 |   await expect(card(page,"FF14 · 萌系日常")).toBeVisible();
  64 |   const first=await card(page,"FF14 · 萌系日常").boundingBox(),second=await card(page,"FF14 · 自然意象").boundingBox();
  65 |   expect(second!.x).toBeGreaterThan(first!.x);expect(second!.y).toBe(first!.y);
  66 |   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  67 |   await page.screenshot({path:"docs/playertrack/cards-mobile.png",fullPage:true});
  68 |   await card(page,"FF14 · 海都潮人").click();expect((await draw(page)).every(t=>[...t].length<=3)).toBe(true);
  69 |   await card(page,"海都潮人 ID · 原版 xlsx").click();expect((await draw(page)).every(t=>[...t].length<=3)).toBe(true);
  70 |   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  71 | });
  72 | test("unapplied code disables card switching and keeps the existing workflow and draft",async({page})=>{
  73 |   await page.goto("/");await card(page,"FF14 · 萌系日常").click();await page.getByRole("button",{name:"编辑",exact:true}).click();
  74 |   await page.getByRole("button",{name:"NameScript",exact:true}).click();await page.locator(".cm-content").fill('let source = resource("animals");\nlet result = output(source);');
  75 |   await page.getByRole("button",{name:"返回生成",exact:true}).click();await expect(page.getByText(/编辑草稿已保留/)).toBeVisible();
  76 |   await expect(card(page,"FF14 · 自然意象")).toBeDisabled();await expect(card(page,"海都潮人 ID · 原版 xlsx")).toBeDisabled();
  77 |   await page.getByRole("button",{name:"编辑",exact:true}).click();await expect(page.locator(".cm-content")).toContainText('resource("animals")');
  78 | });
  79 | test("uploaded portable workflow JSON loads offline through the existing importer",async({page})=>{
  80 |   await page.goto("/");const response=await page.request.get("/workflows/ff14-fantasy.json");expect(response.ok()).toBe(true);
  81 |   const buffer=await response.body();await page.getByText("生成设置",{exact:true}).click();await page.getByRole("button",{name:"导入",exact:true}).click();
  82 |   await page.locator('input[type=file][hidden]').setInputFiles({name:"ff14-fantasy.json",mimeType:"application/json",buffer});
  83 |   await expect(page.getByRole("heading",{level:1})).toContainText("FF14 · 奇幻角色");
  84 |   expect((await draw(page)).some(t=>[...t].length>3)).toBe(true);
  85 | });
  86 | test("opening a lazy workflow disables generation until selection is complete",async({page})=>{
  87 |   let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  88 |   await page.route(/\/assets\/cute-[^/]+\.js/,async route=>{await gate;await route.continue();});
  89 |   await page.goto("/");await card(page,"FF14 · 萌系日常").click();
  90 |   await expect(page.getByRole("button",{name:"正在打开…",exact:true})).toBeDisabled();
  91 |   await expect(card(page,"FF14 · 自然意象")).toBeDisabled();release();
  92 |   await expect(page.getByRole("heading",{level:1})).toHaveText("FF14 · 萌系日常");
  93 |   await expect(page.getByRole("button",{name:"生成 ID",exact:true})).toBeEnabled();
  94 | });
  95 |
```
