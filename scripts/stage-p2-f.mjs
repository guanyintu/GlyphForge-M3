import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',args,{maxBuffer:64*1024*1024});
const b=JSON.parse(fs.readFileSync('docs/p2-f/baseline-local.json'));
if(git('rev-parse','HEAD').toString().trim()!==b.head)throw new Error('HEAD changed; do not stage on new base');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const section=fs.readFileSync('docs/p2-f/status-section.txt','utf8');
const insert=text=>text.replace(/\r?\n\r?\n/,m=>m+section);
const historical=b.files.filter(f=>f.historical).map(f=>{
  const bytes=fs.readFileSync(f.file),old=fs.readFileSync(path.join(b.backup,f.file));
  const preserved=f.file==='PROJECT-STATUS.md'?bytes.equals(Buffer.from(insert(old.toString()))):bytes.equals(old);
  if(!preserved)throw new Error(`Historical bytes changed: ${f.file}`);
  return {file:f.file,sha256:f.sha256,preserved,overlap:f.file==='PROJECT-STATUS.md'?'only P2-F insertion':''};
});
const files=['src/App.tsx','src/components/ExecutionEstimate.tsx','src/core/estimate.ts','src/core/execution-metrics.ts','src/core/engine.ts','src/core/operators.ts','src/storage/estimate.ts','src/storage/resource-runtime.ts','src/workers/execution.worker.ts','src/tests/scale.test.ts','src/tests/fixtures/p2f-baseline-engine.ts','src/tests/fixtures/p2f-baseline-operators.ts','e2e/scale.spec.ts','e2e/lineage.spec.ts','e2e/scale-harness.ts','e2e/scale.vite.config.ts','scripts/protect-p2-f.mjs','scripts/validate-p2-f.mjs','scripts/stage-p2-f.mjs','scripts/isolate-p2-f.mjs','scripts/summarize-p2-f.mjs'];
let unownedChecked=0;
for(const original of b.files.filter(f=>!files.includes(f.file)&&f.file!=='PROJECT-STATUS.md')){
  if(original.missing){if(fs.existsSync(original.file))throw new Error(`Originally missing file restored: ${original.file}`);continue;}
  if(!fs.existsSync(original.file)||sha(fs.readFileSync(original.file))!==original.sha256)throw new Error(`Unowned original changed: ${original.file}`);unownedChecked++;
}
// Refuse to include any pre-existing staged user changes.
const existing=git('diff','--cached','--name-only').toString().trim().split('\n').filter(Boolean);
if(existing.some(f=>!files.includes(f)&&f!=='PROJECT-STATUS.md'&&!f.startsWith('docs/p2-f/')&&!['docs/P2-F-ARCHITECTURE.md','docs/P2-F-VALIDATION.md'].includes(f)))throw new Error('Unowned index entries');
const status=insert(git('show','HEAD:PROJECT-STATUS.md').toString());
const blob=execFileSync('git',['hash-object','-w','--stdin'],{input:status}).toString().trim();
git('update-index','--add','--cacheinfo',`100644,${blob},PROJECT-STATUS.md`);
git('add','--',...files,'docs/P2-F-ARCHITECTURE.md','docs/P2-F-VALIDATION.md');
fs.writeFileSync('docs/p2-f/git-isolation.json',JSON.stringify({base:b.head,historical,unownedChecked,sourceFiles:files.map(file=>({file,sha256:sha(fs.readFileSync(file))})),allHistoricalBodiesPreserved:true},null,2));
const docs=fs.readdirSync('docs/p2-f').filter(f=>!f.includes('-local')&&fs.statSync(`docs/p2-f/${f}`).isFile()).map(f=>`docs/p2-f/${f}`);git('add','--',...docs);
console.log(`Staged ${files.length} owned files and evidence; ${historical.length} historical bodies preserved`);
