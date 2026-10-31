import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const originals=new Map();
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(p===path.join('docs','p2-f')||/^P2-F-/.test(e.name))continue;if(e.isDirectory())walk(p);else originals.set(p,fs.readFileSync(p));}}
walk('docs');fs.mkdirSync('docs/p2-f',{recursive:true});
const sample=process.argv.includes('--baseline')?'baseline':process.argv.includes('--targeted')?'targeted':'full';
for(const file of fs.readdirSync('docs/p2-f').filter(f=>f.startsWith(sample+'-')||f==='worker-'+sample+'.json'))fs.copyFileSync('docs/p2-f/'+file,'docs/p2-f/attempt-'+Date.now()+'-'+file);
const checks=sample==='baseline'?[['browser','node_modules/@playwright/test/cli.js','test','e2e/scale.spec.ts']]:[
 ['tests','node_modules/vitest/vitest.mjs','run'],['typecheck','node_modules/typescript/bin/tsc','--noEmit'],['build-types','node_modules/typescript/bin/tsc','-b'],['build','node_modules/vite/bin/vite.js','build'],
 ['benchmark','node_modules/vitest/vitest.mjs','run','src/tests/performance.test.ts','src/tests/resource-catalog.test.ts','src/tests/packs.test.ts','src/tests/lineage.test.ts','src/tests/scale.test.ts','--reporter=verbose'],
 ['browser','node_modules/@playwright/test/cli.js','test',...(sample==='targeted'?['e2e/scale.spec.ts']:[])]];
const exits=[],restored=[];
try{for(const [name,...args] of checks){console.log(`Starting ${sample}/${name}`);const start=Date.now(),r=spawnSync(process.execPath,args,{encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,P2F_SAMPLE:sample}});fs.writeFileSync(`docs/p2-f/${sample}-${name}.txt`,(r.stdout??'')+(r.stderr??''));exits.push({name,args,exit:r.status,ms:Date.now()-start,error:r.error?.message});console.log(`${name}: ${r.status}`);if(name==='browser'&&fs.existsSync('test-results/browser-results.json'))fs.copyFileSync('test-results/browser-results.json',`docs/p2-f/${sample}-browser-results.json`);if(r.status!==0)break;}}
finally{for(const [file,bytes]of originals)if(!fs.existsSync(file)||!fs.readFileSync(file).equals(bytes)){if(fs.existsSync(file)){const copy=`docs/p2-f/replayed-${sample}-${file.replaceAll(/[\\/]/g,'_')}`;fs.copyFileSync(file,copy);}fs.writeFileSync(file,bytes);restored.push(file);}fs.writeFileSync(`docs/p2-f/${sample}-exits.json`,JSON.stringify({exits,restored},null,2));}
if(exits.length!==checks.length||exits.some(r=>r.exit!==0))process.exitCode=1;
