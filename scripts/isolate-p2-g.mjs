import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
const staged=execFileSync('git',['diff','--cached','--name-only']).toString();
if(!staged.includes('src/core/share-code.ts'))throw new Error('Stage P2-G successfully before isolating; refusing HEAD-only evidence');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glyphforge-p2g-index-'));
execFileSync('git',['checkout-index','--all',`--prefix=${dir.replaceAll('\\','/')}/`]);
fs.symlinkSync(path.resolve('node_modules'),path.join(dir,'node_modules'),'junction');
const exits=[];
for(const [name,args]of [['tests',['node_modules/vitest/vitest.mjs','run']],['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['build-types',['node_modules/typescript/bin/tsc','-b']],['build',['node_modules/vite/bin/vite.js','build']]]){
 console.log(`isolated ${name}`);const r=spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024});fs.writeFileSync(`docs/p2-g/isolated-${name}.txt`,(r.stdout??'')+(r.stderr??''));exits.push({name,exit:r.status});if(r.status!==0)break;
}
const browser=process.argv.includes('--browser');
if(browser&&exits.length===4&&exits.every(r=>r.exit===0)){
 fs.writeFileSync(path.join(dir,'playwright.isolated.config.mjs'),`import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./e2e',workers:1,timeout:45000,use:{baseURL:'http://127.0.0.1:4176',viewport:{width:1440,height:1000}},reporter:[['list']],webServer:{command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4176 --strictPort',url:'http://127.0.0.1:4176',reuseExistingServer:false}});`);
 const r=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','e2e/share-code.spec.ts','--config','playwright.isolated.config.mjs'],{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,P2G_SAMPLE:'isolated'}});
 fs.writeFileSync('docs/p2-g/isolated-browser.txt',(r.stdout??'')+(r.stderr??''));exits.push({name:'browser',exit:r.status});
 for(const file of ['isolated-roundtrip.json','isolated-security-performance.json','isolated-worker-heap.json','isolated-preview.png','isolated-ui.json'])if(fs.existsSync(path.join(dir,'docs/p2-g',file)))fs.copyFileSync(path.join(dir,'docs/p2-g',file),`docs/p2-g/${file}`);
}
fs.writeFileSync('docs/p2-g/isolated-exits.json',JSON.stringify({directory:dir,exits},null,2));if(exits.length!==(browser?5:4)||exits.some(r=>r.exit!==0))process.exitCode=1;
