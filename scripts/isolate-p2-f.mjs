import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glyphforge-p2f-index-'));
execFileSync('git',['checkout-index','--all',`--prefix=${dir.replaceAll('\\','/')}/`]);
fs.symlinkSync(path.resolve('node_modules'),path.join(dir,'node_modules'),'junction');
const exits=[];
for(const [name,args]of [['tests',['node_modules/vitest/vitest.mjs','run']],['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['build-types',['node_modules/typescript/bin/tsc','-b']],['build',['node_modules/vite/bin/vite.js','build']]]){
 console.log(`isolated ${name}`);const r=spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024});fs.writeFileSync(`docs/p2-f/isolated-${name}.txt`,(r.stdout??'')+(r.stderr??''));exits.push({name,exit:r.status});if(r.status!==0)break;
}
const browser=process.argv.includes('--browser');
if(browser&&exits.length===4&&exits.every(r=>r.exit===0)){
 fs.writeFileSync(path.join(dir,'playwright.isolated.config.mjs'),`import {defineConfig} from '@playwright/test';export default defineConfig({testDir:'./e2e',workers:1,timeout:45000,use:{baseURL:'http://127.0.0.1:4176',viewport:{width:1440,height:1000}},reporter:[['list']],webServer:{command:'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4176 --strictPort',url:'http://127.0.0.1:4176',reuseExistingServer:false}});`);
 const r=spawnSync(process.execPath,['node_modules/@playwright/test/cli.js','test','e2e/scale.spec.ts','--config','playwright.isolated.config.mjs'],{cwd:dir,encoding:'utf8',maxBuffer:32*1024*1024,env:{...process.env,P2F_SAMPLE:'isolated'}});
 fs.writeFileSync('docs/p2-f/isolated-browser.txt',(r.stdout??'')+(r.stderr??''));exits.push({name:'browser',exit:r.status});
 for(const file of ['worker-isolated.json','concurrency-reverse.json','estimate.png'])if(fs.existsSync(path.join(dir,'docs/p2-f',file)))fs.copyFileSync(path.join(dir,'docs/p2-f',file),`docs/p2-f/isolated-${file}`);
}
fs.writeFileSync('docs/p2-f/isolated-exits.json',JSON.stringify({directory:dir,exits},null,2));if(exits.length!==(browser?5:4)||exits.some(r=>r.exit!==0))process.exitCode=1;
