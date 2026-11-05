// Read-only real browser check. No trace, video, HAR, screenshots or session export.
import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
const REF='rsntccggnvmuazvpxstf',origin=`https://${REF}.supabase.co`;
let browser,server,requests=0,blocked=0,status='BLOCKED',at='preflight';
try {
  let raw='';for await(const c of process.stdin){raw+=c.toString('utf8');if(Buffer.byteLength(raw)>8192)throw Error();}
  const accounts=JSON.parse(raw);raw='';
  if(!accounts.b?.email||!accounts.b?.password)throw Error();
  const key=execFileSync('wsl.exe',['--exec','bash','-lc','cat "$HOME/.cache/glyphforge-m3-auth-smoke/publishable_key"'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  if(!key.startsWith('sb_publishable_'))throw Error();
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],{
    env:{...process.env,VITE_SUPABASE_URL:origin,VITE_SUPABASE_PUBLISHABLE_KEY:key},stdio:'ignore',windowsHide:true});
  for(let i=0;i<30;i++){try{if((await fetch('http://127.0.0.1:5173')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch();
  const context=await browser.newContext({viewport:{width:375,height:900},serviceWorkers:'block'});
  const errors=[];const page=await context.newPage();page.on('pageerror',()=>errors.push('unhandled'));
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url()),method=route.request().method();
    if(u.origin==='http://127.0.0.1:5173')return route.continue();
    if(u.origin!==origin||!((u.pathname==='/rest/v1/community_workflows'&&method==='GET')||
      (['/auth/v1/token','/auth/v1/logout'].includes(u.pathname)&&method==='POST')||method==='OPTIONS')||requests>=7){blocked++;return route.abort();}
    requests++;return route.continue();
  });
  at='anonymous_browse';await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button',{name:'展开侧栏',exact:true}).click();
  await page.getByRole('button',{name:'社区广场',exact:true}).click();
  await page.locator('.community-empty').waitFor();
  at='real_login';await page.getByLabel('社区登录邮箱').fill(accounts.b.email);await page.getByLabel('社区登录密码').fill(accounts.b.password);
  accounts.b.password='';accounts.a=null;
  await page.getByRole('button',{name:'邮箱密码登录',exact:true}).click();
  await page.getByRole('button',{name:'退出登录',exact:true}).waitFor();
  if(await page.getByLabel('社区登录密码').count())throw Error();
  at='deleted_listing_invisible';if(await page.locator('.community-card').count())throw Error();
  at='real_logout';await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await page.getByLabel('社区登录邮箱').waitFor();
  if(errors.length||blocked||!(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)))throw Error();
  status='PASS_REAL_UI_READ_ONLY';
} catch { status=status==='BLOCKED'&&requests===0?'BLOCKED':'FAIL'; }
finally {await browser?.close();server?.kill();}
console.log(JSON.stringify({target:REF,status,at,requests,maxRequests:7,blocked,writes:0,
  scope:'375px anonymous live list, real B login, deleted listing invisible, logout; no live publishing exploration'}));
process.exitCode=status==='PASS_REAL_UI_READ_ONLY'?0:1;
