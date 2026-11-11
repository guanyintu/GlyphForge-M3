// Local diagnostic only: force a cold dev optimizer and observe reloads.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
process.env.GLYPHFORGE_ONLINE_SHARING='1';
process.env.GLYPHFORGE_BASE='/GlyphForge/';
process.env.VITE_SUPABASE_URL='https://glyphforge-auth.example.invalid';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='sb_publishable_mock_only';
const {createServer}=await import('vite');
const server=await createServer({server:{host:'127.0.0.1',port:4176},optimizeDeps:{force:true}});
await server.listen();const browser=await chromium.launch();
try {
  const page=await browser.newPage({serviceWorkers:'block'}),events=[];
  page.on('console',m=>{if(m.text().includes('[vite]'))events.push({event:'console',text:m.text()});});
  page.on('framenavigated',f=>{if(f===page.mainFrame())events.push({event:'navigation',url:f.url()});});
  await page.route('https://glyphforge-auth.example.invalid/**',r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.goto('http://127.0.0.1:4176/GlyphForge/');
  await page.getByRole('button',{name:'编辑',exact:true}).click();
  await page.locator('.studio').waitFor();
  await page.getByText(/生成完成/).waitFor({state:'attached'});
  events.push({event:'click-community'});await page.getByRole('button',{name:'社区广场',exact:true}).click();
  let ready=true;try{await page.getByRole('button',{name:'GitHub 登录',exact:true}).waitFor({timeout:8000});}catch{ready=false;}
  writeFileSync('docs/quality/cold-probe.json',JSON.stringify({ready,events,heading:await page.locator('h1').allTextContents()},null,2));
} finally {await browser.close();await server.close();}
