import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { maxBuffer: 96 * 1024 * 1024 });
if (git('diff', '--cached', '--name-only').length) throw new Error('Index must be empty before M2 staging');
const own = ['src/App.tsx', 'src/components/GraphEditor.tsx', 'src/styles.css', 'e2e/m2.spec.ts', 'e2e/lineage.spec.ts', 'scripts/m2-workspace.mjs', 'scripts/validate-m2.mjs', 'scripts/stage-m2.mjs', 'docs/M2-RELEASE-READINESS.md'];
execFileSync(process.execPath, ['scripts/m2-workspace.mjs', '--verify', ...own, 'README.md', 'PROJECT-STATUS.md'], { stdio: 'inherit' });
const evidence = [];
function walk(dir) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.posix.join(dir, entry.name); if (entry.isDirectory()) walk(file); else if (!file.endsWith('baseline-local.json') && /\.(json|txt|png)$/.test(file) && !file.includes('/traces/')) evidence.push(file); } }
walk('docs/m2');
git('add', '--', ...own, ...evidence);
for (const file of ['README.md', 'PROJECT-STATUS.md']) {
  const current = fs.readFileSync(file, 'utf8');
  const block = current.match(/<!-- M2-BEGIN -->[\s\S]*?<!-- M2-END -->/)?.[0];
  if (!block) throw new Error(`Missing bounded M2 section: ${file}`);
  const head = git('show', `HEAD:${file}`).toString('utf8');
  const at = head.indexOf('\n') + 1;
  let staged = head.slice(0, at) + '\n' + block + '\n' + head.slice(at);
  if (file === 'README.md') staged = head.slice(0, at) + '\n' + block + '\n\n<details><summary>历史使用说明（早期快照）</summary>\n' + head.slice(at) + '\n</details>\n';
  const hash = execFileSync('git', ['hash-object', '-w', '--stdin'], { input: staged }).toString().trim();
  git('update-index', '--add', '--cacheinfo', `100644,${hash},${file}`);
}
const staged = git('diff', '--cached', '--name-only').toString().trim().split('\n');
const forbidden = staged.filter(file => !own.includes(file) && !evidence.includes(file) && !['README.md', 'PROJECT-STATUS.md'].includes(file));
if (forbidden.length) throw new Error(`Unexpected staged paths: ${forbidden}`);
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'glyphforge-m2-index-'));
git('checkout-index', '--all', `--prefix=${isolated.replaceAll('\\', '/')}/`);
fs.symlinkSync(path.resolve('node_modules'), path.join(isolated, 'node_modules'), 'junction');
fs.writeFileSync('docs/m2/isolation-local.json', JSON.stringify({ isolated, staged }, null, 2));
console.log(JSON.stringify({ isolated, staged: staged.length, historicalDbIncluded: staged.includes('src/storage/db.ts') }, null, 2));
