import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
const root=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'glyphforge-p2d-source-'));
execFileSync('git',['checkout-index','--all',`--prefix=${temp.replaceAll('\\','/')}/`]);
fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'junction');
const checks=[['tests','node_modules/vitest/vitest.mjs','run'],['typecheck','node_modules/typescript/bin/tsc','--noEmit'],['build-types','node_modules/typescript/bin/tsc','-b'],['build','node_modules/vite/bin/vite.js','build']];
const exits=[];
for(const [name,...args] of checks){console.log(`Isolated ${name}`);const r=spawnSync(process.execPath,args,{cwd:temp,encoding:'utf8',maxBuffer:32*1024*1024});fs.writeFileSync(`docs/p2-d/isolated-${name}.txt`,(r.stdout??'')+(r.stderr??''));exits.push({name,exit:r.status});if(r.status!==0)break;}
fs.writeFileSync('docs/p2-d/isolated-exits.json',JSON.stringify({temp,exits},null,2));
if(exits.length!==checks.length||exits.some(r=>r.exit!==0))process.exitCode=1;
