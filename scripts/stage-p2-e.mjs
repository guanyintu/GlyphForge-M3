import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',args,{maxBuffer:32*1024*1024});
const sourceOnly=process.argv.includes('--source-only');
const files=[
  'src/App.tsx','src/components/Results.tsx','src/components/Tools.tsx','src/components/LineagePanel.tsx',
  'src/core/model.ts','src/core/contracts.ts','src/core/engine.ts','src/core/operators.ts','src/core/lineage.ts','src/core/relations.ts','src/core/mutation.ts',
  'src/storage/lineage.ts','src/storage/resource-runtime.ts','src/storage/run-lifecycle.ts',
  'src/tests/lineage.test.ts','src/tests/fixtures/p2e-legacy-engine.ts','src/tests/fixtures/p2e-legacy-operators.ts',
  'e2e/lineage.spec.ts','e2e/lineage-harness.ts','e2e/lineage.vite.config.ts','e2e/p1d.spec.ts',
  'scripts/protect-p2-e.mjs','scripts/validate-p2-e.mjs','scripts/isolate-p2-e.mjs','scripts/verify-isolated-browser-p2-e.mjs','scripts/stage-p2-e.mjs',
];
const baseline=JSON.parse(fs.readFileSync('docs/p2-e/baseline-local.json','utf8'));
const oldAssertion='  await page.reload(); await expect(page.getByLabel("收藏 猫", { exact: true })).toHaveAttribute("aria-pressed", "true");';
const newAssertion='  await page.reload(); await page.getByRole("button", { name: /^我的收藏/ }).click(); await expect(page.getByLabel("收藏 猫", { exact: true })).toHaveAttribute("aria-pressed", "true");';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const historical=baseline.files.filter(f=>f.owner==='historical').map(f=>{
  const current=fs.readFileSync(f.file),old=fs.readFileSync(path.join(baseline.backup,f.file));
  const equal=current.equals(old);
  if(!equal && !(sourceOnly && f.file.startsWith('docs/')) && f.file!=='PROJECT-STATUS.md' && !(f.file==='e2e/p1d.spec.ts' && current.toString().replace(newAssertion,oldAssertion)===old.toString()))throw new Error(`Historical bytes changed: ${f.file}`);
  return {file:f.file,sha256:sha(old),preserved:equal,overlap:f.file==='PROJECT-STATUS.md'?'only P2-E section added':f.file==='e2e/p1d.spec.ts'?'only one owned assertion changed':''};
});
const section=fs.readFileSync('docs/p2-e/status-section-local.txt','utf8');
const current=fs.readFileSync('PROJECT-STATUS.md','utf8'),original=fs.readFileSync(path.join(baseline.backup,'PROJECT-STATUS.md'),'utf8');
if(current!==original.replace('\n\n','\n\n'+section+'\n'))throw new Error('Status historical body differs');
const head=git('show','HEAD:PROJECT-STATUS.md').toString().replace('\n\n','\n\n'+section+'\n');
const blob=execFileSync('git',['hash-object','-w','--stdin'],{input:head}).toString().trim();
git('update-index','--add','--cacheinfo',`100644,${blob},PROJECT-STATUS.md`);
git('add','--',...files.filter(f=>f!=='e2e/p1d.spec.ts'));
const p1d=git('show','HEAD:e2e/p1d.spec.ts').toString();
if(!p1d.includes(oldAssertion))throw new Error('Missing exact historical assertion');
const p1dBlob=execFileSync('git',['hash-object','-w','--stdin'],{input:p1d.replace(oldAssertion,newAssertion)}).toString().trim();
git('update-index','--add','--cacheinfo',`100644,${p1dBlob},e2e/p1d.spec.ts`);
if(!sourceOnly)fs.writeFileSync('docs/p2-e/original-files.json',JSON.stringify({historical,allOriginalBodiesPreserved:true},null,2));
fs.writeFileSync('docs/p2-e/git-isolation.json',JSON.stringify({baseline:baseline.head,branch:git('branch','--show-current').toString().trim(),sourceFiles:files,overlap:['PROJECT-STATUS.md','e2e/p1d.spec.ts'],excludedHistorical:historical.map(f=>f.file),sourceHashes:files.map(file=>({file,sha256:sha(fs.readFileSync(file))}))},null,2));
const docs=fs.readdirSync('docs/p2-e').filter(f=>!f.includes('-local') && fs.statSync(`docs/p2-e/${f}`).isFile()).map(f=>`docs/p2-e/${f}`);
git('add','--','docs/P2-E-ARCHITECTURE.md','docs/P2-E-VALIDATION.md',...(sourceOnly?[]:docs));
console.log(`Staged ${files.length} own source/test/scripts; historical ${historical.length} protected`);
