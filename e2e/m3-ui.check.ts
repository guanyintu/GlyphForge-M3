import {test,expect,type Page} from '@playwright/test';
import {createHash} from 'node:crypto';
import {syntheticPayload} from '../scripts/community-business-smoke.mjs';
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const payload=syntheticPayload();
const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const mockAPI = 'https://glyphforge-auth.example.invalid/**';
const githubButton = (page: Page) => page.getByRole('button', { name: 'GitHub 登录', exact: true });

async function expectGitHubOnly(page: Page) {
  await expect(githubButton(page)).toBeEnabled();
  await expect(page.locator('.community-account input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /邮箱密码登录|演示登录|进入本地演示/ })).toHaveCount(0);
}

for (const width of [1280,375]) test(`cloud contract mock at ${width}px: OAuth filters pages preview permissions failures recovery`,async({page,baseURL})=>{
  await page.setViewportSize({width,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let listings=Array.from({length:13},(_,i)=>({id:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,author_id:A,author:'合成作者',
    title:`合成配方 ${i+1}`,description:'固定种子与公开快照，带回本机工坊。',tags:[i%2?'宇宙':'取名'],status:'published',
    current_version:1,created_at:`2026-11-01T00:00:${String(i).padStart(2,'0')}Z`,views:0,likes:0,adoptions:0,runs:0}));
  let actor:string|null=null,failList=false,failWrite=0,conflict=false,publishes=0;
  let nextActor = B, challenge: string | null = null, exchanges = 0, refreshes = 0;
  const likes=new Set<string>();
  await page.route(mockAPI,async route=>{
    const req=route.request(),u=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():null;
    const reply=(data:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
    if (u.pathname === '/auth/v1/settings') return reply({ external: { github: true, email: true } });
    if (u.pathname === '/auth/v1/authorize') {
      expect(u.searchParams.get('provider')).toBe('github');
      expect(u.searchParams.get('redirect_to')).toBe(baseURL);
      expect(u.searchParams.get('code_challenge_method')).toBe('s256');
      challenge = u.searchParams.get('code_challenge');
      return route.fulfill({ status: 302, headers: { location: `${baseURL}?code=fixture-code` } });
    }
    if(u.pathname==='/auth/v1/token'){
      const grant = u.searchParams.get('grant_type');
      if (grant === 'refresh_token') {
        expect(body.refresh_token).toBe('mock-refresh');
        refreshes++;
      } else {
        expect(grant).toBe('pkce');
        expect(body.auth_code).toBe('fixture-code');
        expect(createHash('sha256').update(body.code_verifier).digest('base64url')).toBe(challenge);
        exchanges++;
        actor=nextActor;
      }
      return reply({access_token:`mock-${actor}`,refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,
        user:{id:actor,email:actor===A?'author@example.invalid':'visitor@example.invalid',aud:'authenticated',role:'authenticated',app_metadata:{provider:'github'},user_metadata:{}}});
    }
    if(u.pathname==='/auth/v1/logout'){actor=null;return reply({});}
    if(u.pathname==='/auth/v1/user')return reply({id:actor,email:actor===A?'author@example.invalid':'visitor@example.invalid'});
    if(u.pathname==='/rest/v1/community_workflows'){
      if(failList)return route.abort('failed');
      let rows=listings.filter(w=>w.status==='published'||(w.author_id===actor&&w.status==='unlisted'));
      for(const field of ['id','author_id','status'])if(u.searchParams.has(field))rows=rows.filter(w=>w[field as 'id']===u.searchParams.get(field)!.slice(3));
      const q=u.searchParams.get('search_text')?.slice(7,-1);if(q)rows=rows.filter(w=>(w.title+w.description+w.tags.join(' ')).includes(q));
      const tag=u.searchParams.get('tags')?.replace(/^cs\.\{|\}$/g,'');if(tag)rows=rows.filter(w=>w.tags.includes(tag.replaceAll('"','')));
      const offset=Number(u.searchParams.get('offset')||0),limit=Number(u.searchParams.get('limit')||12);
      return reply(rows.slice(offset,offset+limit));
    }
    if(u.pathname==='/rest/v1/workflow_versions'){
      const id=u.searchParams.get('workflow_id')!.slice(3),w=listings.find(w=>w.id===id)!;
      const v={workflow_id:id,version:1,content_hash:hash,created_at:w.created_at,payload};
      return reply(req.headers().accept?.includes('object')?v:[v]);
    }
    if(u.pathname==='/rest/v1/workflow_likes')return reply(likes.has(u.searchParams.get('workflow_id')!.slice(3))?{workflow_id:u.searchParams.get('workflow_id')!.slice(3)}:null);
    if(u.pathname==='/functions/v1/community'){
      if(failWrite)return reply({error:'internal sensitive diagnostic eyJfixture should never reach UI'},failWrite);
      if(conflict&&body.action==='publish')return reply({error:'Ownership, moderation or version conflict'},400);
      const w=listings.find(w=>w.id===body.workflow_id);
      if(body.action==='publish'){
        publishes++;
        listings.push({...listings[0],id:'44444444-4444-4444-8444-444444444444',title:body.title,description:body.description,tags:body.tags,author_id:actor!,author:'visitor',status:'published'});
        return reply(listings.at(-1));
      }
      if(body.action==='like'&&w){w.likes=body.liked?1:0;if(body.liked)likes.add(w.id);else likes.delete(w.id);return reply(w);}
      if(body.action==='report')return reply(w);
      if(body.action==='review'||body.action==='moderate')return reply({error:'Moderator required'},400);
      if(body.action==='event')return reply(w);
      if(body.action==='status'&&w){w.status=body.status;return reply(w);}
      if(body.action==='edit'&&w&&w.author_id===actor){Object.assign(w,{title:body.title,description:body.description,tags:body.tags});return reply(w);}
      return reply({error:'Author required'},400);
    }
    throw Error('Unexpected mock API route '+u.pathname);
  });
  await page.goto('./');await expect(page.getByText(/生成完成/)).toBeAttached();
  if(width===375)await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
  await page.getByRole('button',{name:'社区广场',exact:true}).click();
  await expectGitHubOnly(page);
  await expect(page.locator('.community-card')).toHaveCount(12);
  await page.getByRole('button',{name:'下一页',exact:true}).click();
  await expect(page.locator('.community-card')).toHaveCount(1);
  await page.getByRole('button',{name:'上一页',exact:true}).click();
  await page.getByLabel('搜索社区方案').fill('不存在');
  await expect(page.getByText('没有符合条件的方案，请调整搜索或筛选。')).toBeVisible();
  await page.getByLabel('搜索社区方案').fill('合成配方');
  await page.getByLabel('社区标签',{exact:true}).fill('宇宙');
  await page.getByLabel('社区排序').selectOption('popular');
  await expect(page.locator('.community-card')).toHaveCount(6);
  await page.locator('.community-card').first().click();
  const detail=page.getByLabel('社区方案详情',{exact:true});
  await expect(detail).toBeFocused();
  await expect(detail.getByRole('button',{name:'点赞',exact:true})).toBeDisabled();
  await detail.getByRole('button',{name:'下载并预览 v1'}).click();
  await expect(page.getByLabel('社区只读导入预览')).toContainText(hash);
  await expect(detail.getByRole('button',{name:'下载并预览 v1'})).toBeEnabled();
  await expect(detail.getByRole('button',{name:'下载并预览 v1'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.community-card').first()).toBeFocused();
  await githubButton(page).click();
  await expect(page.getByText('创作者 · visitor')).toBeVisible();
  await expect(page).toHaveURL(baseURL!);
  await page.evaluate(() => {
    const key = 'sb-glyphforge-auth-auth-token';
    const session = JSON.parse(localStorage.getItem(key)!);
    session.expires_at = 1;
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page.reload();
  if(width===375)await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
  await page.getByRole('button',{name:'社区广场',exact:true}).click();
  await expect(page.getByText('创作者 · visitor')).toBeVisible();
  expect(refreshes).toBe(1);
  await page.locator('.community-card').first().click();
  await expect(page.getByRole('button',{name:'保存描述',exact:true})).toHaveCount(0);
  await detail.getByRole('button',{name:'点赞',exact:true}).click();await expect(detail.getByRole('button',{name:'撤销点赞'})).toHaveAttribute('aria-pressed','true');
  await detail.getByRole('button',{name:'撤销点赞'}).click();await expect(detail).toContainText('点赞 0');
  failWrite=429;await detail.getByRole('button',{name:'点赞',exact:true}).click();await expect(page.getByRole('alert')).toContainText('写入额度已用尽');
  failWrite=500;await detail.getByRole('button',{name:'点赞',exact:true}).click();await expect(page.getByRole('alert')).toContainText('社区服务暂不可用');
  await expect(page.locator('body')).not.toContainText('eyJfixture');failWrite=0;
  await page.getByLabel('举报原因').fill('合成测试举报原因');await page.getByRole('button',{name:'提交举报',exact:true}).click();
  await expect(page.getByRole('status').filter({hasText:'举报已提交'})).toBeVisible();
  await page.getByRole('button',{name:'发布当前工作流',exact:true}).click();
  const publish=page.getByLabel('发布社区方案',{exact:true});await expect(publish).toBeFocused();
  await page.getByLabel('发布标题',{exact:true}).fill('手机桌面合成新方案');
  for(const box of await publish.getByRole('checkbox').all())await box.check();
  await page.getByRole('button',{name:'生成公开内容预览',exact:true}).click();
  await expect(page.getByLabel('公开内容完整预览')).toContainText('glyphforge');
  conflict=true;await page.getByRole('button',{name:'确认公开发布',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('版本已变化');conflict=false;
  await page.getByLabel('社区标签',{exact:true}).fill('');await page.getByLabel('搜索社区方案').fill('');
  await page.getByRole('button',{name:'确认公开发布',exact:true}).dblclick();await expect(publish).not.toBeVisible();expect(publishes).toBe(1);
  failList=true;await page.getByRole('button',{name:'刷新统计',exact:true}).click();await expect(page.getByRole('alert')).toContainText('网络请求失败',{timeout:15000});
  failList=false;await page.getByRole('button',{name:'重试加载',exact:true}).click();await expect(page.getByRole('alert')).not.toBeVisible();
  await page.getByRole('button',{name:'关闭详情',exact:true}).click();
  await page.screenshot({path:`test-results/m3-ui-${width}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expectGitHubOnly(page);
  nextActor = A;
  await githubButton(page).click();
  await expect(page.getByText('创作者 · author')).toBeVisible();
  expect(exchanges).toBe(2);
  await page.locator('.community-card').first().click();
  await page.getByLabel('编辑方案描述').fill('修改后的合成描述');await page.getByRole('button',{name:'保存描述',exact:true}).click();
  await expect(detail).toContainText('修改后的合成描述');
  await page.getByRole('button',{name:'下架方案',exact:true}).click();await expect(detail).not.toBeVisible();
  await page.getByRole('checkbox',{name:'我的发布',exact:true}).check();
  await page.getByRole('button',{name:/合成配方 1 固定|合成配方 1 修改/}).click();
  await expect(detail).toContainText('软删除不等于永久销毁');
  await page.getByRole('button',{name:'删除方案（软删除）',exact:true}).click();await expect(detail).not.toBeVisible();
  await expect(page.getByRole('status').filter({hasText:'方案已软删除'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('disabled GitHub provider keeps the user in the community with setup guidance', async ({ page, baseURL }) => {
  let attempts = 0;
  await page.route(mockAPI, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/auth/v1/settings') {
      attempts++;
      return route.fulfill({ json: { external: { github: false, email: true }, detail: 'private-fixture' } });
    }
    expect(pathname).toBe('/rest/v1/community_workflows');
    return route.fulfill({ json: [] });
  });
  await page.goto('./');
  await page.getByRole('button', { name: '社区广场', exact: true }).click();
  await expectGitHubOnly(page);
  await githubButton(page).click();
  await expect(page.getByRole('alert')).toContainText('请联系管理员配置 GitHub OAuth 和回跳地址');
  await expect(page.locator('body')).not.toContainText('private-fixture');
  await expect(page).toHaveURL(baseURL!);
  expect(attempts).toBe(1);
});

for (const suffix of ['?error=server_error&error_description=private-fixture#access_token=private-fixture', '#error_code=bad_oauth_callback&error_description=private-fixture', '?code=private-fixture']) {
  test(`failed OAuth return is sanitized (${suffix.split('=')[0]})`, async ({ page, baseURL }) => {
    await page.route(mockAPI, (route) => {
      expect(new URL(route.request().url()).pathname).toBe('/rest/v1/community_workflows');
      return route.fulfill({ json: [] });
    });
    await page.goto(`./${suffix}`);
    await expect(page.getByRole('alert')).toContainText('请联系管理员检查 GitHub OAuth 配置和回跳地址');
    await expectGitHubOnly(page);
    await expect(page.locator('body')).not.toContainText('private-fixture');
    await expect(page).toHaveURL(baseURL!);
  });
}
