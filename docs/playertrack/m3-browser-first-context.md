# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: m3-ui.check.ts >> cloud contract mock at 1280px: OAuth filters pages preview permissions failures recovery
- Location: e2e\m3-ui.check.ts:17:33

# Error details

```
Error: expect(locator).toBeEnabled() failed

Locator: getByRole('button', { name: 'GitHub 登录', exact: true })
Expected: enabled
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeEnabled" getByRole('button', { name: 'GitHub 登录', exact: true }) with timeout 5000ms
  - waiting for getByRole('button', { name: 'GitHub 登录', exact: true })

```

```yaml
- link "跳到工作区":
  - /url: "#main"
- complementary:
  - link "GlyphForge 文字创作工坊 BETA":
    - /url: "#"
    - img
    - text: GlyphForge 文字创作工坊 BETA
  - text: 你的创作空间
  - navigation:
    - button "社区广场":
      - img
      - text: 社区广场
    - button "ID 生成":
      - img
      - text: ID 生成
    - button "FF14 玩家语料词库":
      - img
      - text: FF14 玩家语料词库
    - button "我的收藏 0":
      - img
      - text: 我的收藏 0
  - text: 我的工作流
  - button "新建工作流":
    - img
  - button "镜像文字实验":
    - img
    - text: 镜像文字实验
  - button "叠字的快乐":
    - img
    - text: 叠字的快乐
  - button "宇宙浪漫命名器":
    - img
    - text: 宇宙浪漫命名器
  - button "从灵感配方开始 一点小规则，无限种可能":
    - img
    - text: 从灵感配方开始 一点小规则，无限种可能
    - img
  - img
  - text: 灵感留在本地 无需账号，随时创作
  - button "使用指南与快捷键":
    - img
    - text: 使用指南与快捷键
    - img
- main:
  - img
  - text: 个人工作空间
  - img
  - text: ID 生成 本地优先
  - button "使用指南":
    - img
  - text: G
  - region "ID 生成":
    - text: 一点灵感，一个好名字
    - button "编辑":
      - img
      - text: 编辑
    - heading "宇宙浪漫命名器" [level=1]
    - paragraph: 选一个喜欢的工作流，看看这次会遇见什么名字。
    - group "选择工作流":
      - text: 选择工作流
      - heading "选择工作流" [level=2]
      - paragraph: 点击卡片选取，再生成你喜欢的名字。
      - button "浏览配方":
        - img
        - text: 浏览配方
      - button "选择工作流：FF14 · 萌系日常":
        - text: FF14 玩家语料 2–6 字
        - strong: FF14 · 萌系日常
        - text: 动物、食物与亲昵表达，轻松一点，可爱一点。 奶糖 · 草莓 · 猫猫
      - button "选择工作流：FF14 · 自然意象":
        - text: FF14 玩家语料 2–6 字
        - strong: FF14 · 自然意象
        - text: 从星月、山海和四季里，拾一段自然意象。 月光 · 听雨 · 春日
      - button "选择工作流：FF14 · 清冷文艺":
        - text: FF14 玩家语料 2–6 字
        - strong: FF14 · 清冷文艺
        - text: 克制的情绪与文学意象，让名字留一点空白。 留白 · 余音 · 无声
      - button "选择工作流：FF14 · 奇幻角色":
        - text: FF14 玩家语料 2–6 字
        - strong: FF14 · 奇幻角色
        - text: 音译字根与幻想世界的联想，为角色取个名字。 艾琳 · 菲娜 · 希尔
      - button "选择工作流：FF14 · 趣味潮流":
        - text: FF14 玩家语料 2–6 字
        - strong: FF14 · 趣味潮流
        - text: 网络口语、抽象与反差，给日常加一点梗。 赛博 · 摸鱼 · 勇者
      - button "选择工作流：FF14 · 海都潮人":
        - text: FF14 玩家语料 2–3 字
        - strong: FF14 · 海都潮人
        - text: 现代字根与冷感词语，短一点，利落一点。 留白 · 失真 · 零号
      - button "选择工作流：海都潮人 ID · 原版 xlsx":
        - text: 海都工作流 2–3 字
        - strong: 海都潮人 ID · 原版 xlsx
        - text: 原表四列词库，保留五种经典组合。 1+1 · 1+2 · 小xx · 直出
      - button "选择工作流：海都潮人 ID · 五列工作流":
        - text: 海都工作流 2–3 字
        - strong: 海都潮人 ID · 五列工作流
        - text: 独立素材池与关系评分，沿用五列工作流。 单字组合 · 双字搭配
      - button "选择工作流：镜像文字实验":
        - text: 我的工作流 自定规则
        - strong: 镜像文字实验
        - text: 使用已保存的词库、规则与生成设置。 5 个节点 · 最多 200 个结果
      - button "选择工作流：叠字的快乐":
        - text: 我的工作流 自定规则
        - strong: 叠字的快乐
        - text: 使用已保存的词库、规则与生成设置。 5 个节点 · 最多 200 个结果
      - button "选择工作流：宇宙浪漫命名器" [pressed]:
        - text: 我的工作流
        - img
        - text: 已选
        - strong: 宇宙浪漫命名器
        - text: 使用已保存的词库、规则与生成设置。 5 个节点 · 最多 200 个结果
      - text: 11 个工作流 · 可滚动浏览
      - status: 已选工作流会保留你的编辑与生成设置
    - text: 已选择工作流，可以开始生成
    - button "生成 ID":
      - img
      - text: 生成 ID
    - group: 生成设置
  - img
  - heading "生成结果" [level=2]
  - text: 0 选好工作流，点击生成
  - combobox "结果导出格式":
    - option "TXT" [selected]
    - option "CSV"
    - option "JSON"
  - button "复制全部" [disabled]:
    - img
    - text: 复制全部
  - button "导出" [disabled]:
    - img
    - text: 导出
  - button "存为词库" [disabled]
  - img
  - textbox "筛选生成结果":
    - /placeholder: 寻找一个心动的名字…
  - text: /
  - button "只看收藏":
    - img
    - text: 只看收藏
  - button "卡片模式" [pressed]:
    - img
  - button "列表模式":
    - img
  - img
  - heading "每一个名字，都从一点灵感开始" [level=3]
  - paragraph: 选一个工作流，点击「生成 ID」，遇见喜欢的名字就收藏。
  - text: 全部计算在你的设备完成 点击名字复制 · 点击 ☆ 收藏
  - img
  - group: 最近生成
  - text: 让每一个 ID，都有一点你的样子。 GLYPHFORGE ✦ MADE FOR YOUR IMAGINATION
```

# Test source

```ts
  1   | import { openEditor } from "./editor-steps";
  2   | import {test,expect,type Page} from '@playwright/test';
  3   | import {createHash} from 'node:crypto';
  4   | import {syntheticPayload} from '../scripts/community-business-smoke.mjs';
  5   | const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
  6   | const payload=syntheticPayload();
  7   | const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  8   | const mockAPI = 'https://glyphforge-auth.example.invalid/**';
  9   | const githubButton = (page: Page) => page.getByRole('button', { name: 'GitHub 登录', exact: true });
  10  |
  11  | async function expectGitHubOnly(page: Page) {
> 12  |   await expect(githubButton(page)).toBeEnabled();
      |                                    ^ Error: expect(locator).toBeEnabled() failed
  13  |   await expect(page.locator('.community-account input')).toHaveCount(0);
  14  |   await expect(page.getByRole('button', { name: /邮箱密码登录|演示登录|进入本地演示/ })).toHaveCount(0);
  15  | }
  16  |
  17  | for (const width of [1280,375]) test(`cloud contract mock at ${width}px: OAuth filters pages preview permissions failures recovery`,async({page,baseURL})=>{
  18  |   await page.setViewportSize({width,height:900});
  19  |   await page.emulateMedia({reducedMotion:'reduce'});
  20  |   const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  21  |   let listings=Array.from({length:13},(_,i)=>({id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,author_id:A,author:'合成作者',
  22  |     title:`合成配方 ${i+1}`,description:'固定种子与公开快照，带回本机工坊。',tags:[i%2?'宇宙':'取名'],status:'published',
  23  |     current_version:1,created_at:`2026-11-01T00:00:${String(i).padStart(2,'0')}Z`,views:0,likes:0,adoptions:0,runs:0}));
  24  |   let actor:string|null=null,failList=false,failWrite=0,conflict=false,publishes=0;
  25  |   let nextActor = B, challenge: string | null = null, exchanges = 0, refreshes = 0;
  26  |   const likes=new Set<string>();
  27  |   await page.route(mockAPI,async route=>{
  28  |     const req=route.request(),u=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():null;
  29  |     const reply=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  30  |     if (u.pathname === '/auth/v1/settings') return reply({ external: { github: true, email: true } });
  31  |     if (u.pathname === '/auth/v1/authorize') {
  32  |       expect(u.searchParams.get('provider')).toBe('github');
  33  |       expect(u.searchParams.get('redirect_to')).toBe(baseURL);
  34  |       expect(u.searchParams.get('code_challenge_method')).toBe('s256');
  35  |       challenge = u.searchParams.get('code_challenge');
  36  |       return route.fulfill({ status: 302, headers: { location: `${baseURL}?code=fixture-code` } });
  37  |     }
  38  |     if(u.pathname==='/auth/v1/token'){
  39  |       const grant = u.searchParams.get('grant_type');
  40  |       if (grant === 'refresh_token') {
  41  |         expect(body.refresh_token).toBe('mock-refresh');
  42  |         refreshes++;
  43  |       } else {
  44  |         expect(grant).toBe('pkce');
  45  |         expect(body.auth_code).toBe('fixture-code');
  46  |         expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
  47  |         exchanges++;
  48  |         actor=nextActor;
  49  |       }
  50  |       return reply({access_token:`mock-${actor}`,refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,
  51  |         user:{id:actor,email:actor===A?'author@example.invalid':'visitor@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'github'},user_metadata:{}}});
  52  |     }
  53  |     if(u.pathname==='/auth/v1/logout'){actor=null;return reply({});}
  54  |     if(u.pathname==='/auth/v1/user')return reply({id:actor,email:actor===A?'author@example.invalid':'visitor@example.invalid'});
  55  |     if(u.pathname==='/rest/v1/community_workflows'){
  56  |       if(failList)return route.abort('failed');
  57  |       let rows=listings.filter(w=>w.status==='published'||(w.author_id===actor&&w.status==='unlisted'));
  58  |       for(const field of ['id','author_id','status'])if(u.searchParams.has(field))rows=rows.filter(w=>w[field as 'id']===u.searchParams.get(field)!.slice(3));
  59  |       const q=u.searchParams.get('search_text')?.slice(7,-1);if(q)rows=rows.filter(w=>(w.title+w.description+w.tags.join(' ')).includes(q));
  60  |       const tag=u.searchParams.get('tags')?.replace(/^cs\.\{|\}$/g,'');if(tag)rows=rows.filter(w=>w.tags.includes(tag.replaceAll('"','')));
  61  |       const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||12);
  62  |       return reply(rows.slice(offset,offset+limit));
  63  |     }
  64  |     if(u.pathname==='/rest/v1/workflow_versions'){
  65  |       const id=u.searchParams.get('workflow_id')!.slice(3),w=listings.find(w=>w.id===id)!;
  66  |       const v={workflow_id:id,version:1,content_hash:hash,created_at:w.created_at,payload};
  67  |       return reply(req.headers().accept?.includes('object')?v:[v]);
  68  |     }
  69  |     if(u.pathname==='/rest/v1/workflow_likes')return reply(likes.has(u.searchParams.get('workflow_id')!.slice(3))?{workflow_id:u.searchParams.get('workflow_id')!.slice(3)}:null);
  70  |     if(u.pathname==='/functions/v1/community'){
  71  |       if(failWrite)return reply({error:'internal sensitive diagnostic eyJfixture should never reach UI'},failWrite);
  72  |       if(conflict&&body.action==='publish')return reply({error:'Ownership, moderation or version conflict'},400);
  73  |       const w=listings.find(w=>w.id===body.workflow_id);
  74  |       if(body.action==='publish'){
  75  |         publishes++;
  76  |         listings.push({...listings[0],id:'44444444-4444-4444-8444-444444444444',title:body.title,description:body.description,tags:body.tags,author_id:actor!,author:'visitor',status:'published'});
  77  |         return reply(listings.at(-1));
  78  |       }
  79  |       if(body.action==='like'&&w){w.likes=body.liked?1:0;if(body.liked)likes.add(w.id);else likes.delete(w.id);return reply(w);}
  80  |       if(body.action==='report')return reply(w);
  81  |       if(body.action==='review'||body.action==='moderate')return reply({error:'Moderator required'},400);
  82  |       if(body.action==='event')return reply(w);
  83  |       if(body.action==='status'&&w){w.status=body.status;return reply(w);}
  84  |       if(body.action==='edit'&&w&&w.author_id===actor){Object.assign(w,{title:body.title,description:body.description,tags:body.tags});return reply(w);}
  85  |       return reply({error:'Author required'},400);
  86  |     }
  87  |     throw Error('Unexpected mock API route '+u.pathname);
  88  |   });
  89  |   await openEditor(page, './');await expect(page.getByText(/生成完成/)).toBeAttached();
  90  |   if(width===375)await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
  91  |   await page.getByRole('button',{name:'社区广场',exact:true}).click();
  92  |   await expectGitHubOnly(page);
  93  |   await expect(page.locator('.community-card')).toHaveCount(12);
  94  |   await page.getByRole('button',{name:'下一页',exact:true}).click();
  95  |   await expect(page.locator('.community-card')).toHaveCount(1);
  96  |   await page.getByRole('button',{name:'上一页',exact:true}).click();
  97  |   await page.getByLabel('搜索社区方案').fill('不存在');
  98  |   await expect(page.getByText('没有符合条件的方案，请调整搜索或筛选。')).toBeVisible();
  99  |   await page.getByLabel('搜索社区方案').fill('合成配方');
  100 |   await page.getByLabel('社区标签',{exact:true}).fill('宇宙');
  101 |   await page.getByLabel('社区排序').selectOption('popular');
  102 |   await expect(page.locator('.community-card')).toHaveCount(6);
  103 |   await page.locator('.community-card').first().click();
  104 |   const detail=page.getByLabel('社区方案详情',{exact:true});
  105 |   await expect(detail).toBeFocused();
  106 |   await expect(detail.getByRole('button',{name:'点赞',exact:true})).toBeDisabled();
  107 |   await detail.getByRole('button',{name:'下载并预览 v1'}).click();
  108 |   await expect(page.getByLabel('社区只读导入预览')).toContainText(hash);
  109 |   await expect(detail.getByRole('button',{name:'下载并预览 v1'})).toBeEnabled();
  110 |   await expect(detail.getByRole('button',{name:'下载并预览 v1'})).toBeFocused();
  111 |   await page.keyboard.press('Escape');
  112 |   await expect(page.locator('.community-card').first()).toBeFocused();
```
