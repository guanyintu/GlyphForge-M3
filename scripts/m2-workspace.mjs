import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
const git = (...args) => execFileSync('git', args, { maxBuffer: 96 * 1024 * 1024 });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const baselineFile = 'docs/m2/baseline-local.json';
if (process.argv.includes('--verify')) {
  const baseline = JSON.parse(fs.readFileSync(baselineFile));
  const allowed = new Set(process.argv.slice(process.argv.indexOf('--verify') + 1));
  const changed = baseline.files.filter(f => !fs.existsSync(f.file) || hash(fs.readFileSync(f.file)) !== f.sha256);
  const unexpected = changed.filter(f => !allowed.has(f.file));
  console.log(JSON.stringify({ changed: changed.map(f => f.file), unexpected: unexpected.map(f => f.file) }, null, 2));
  if (unexpected.length) process.exitCode = 1;
} else {
  if (fs.existsSync(baselineFile)) throw new Error('Baseline already exists');
  if (git('diff', '--cached', '--name-only').length) throw new Error('Existing staged changes');
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'glyphforge-m2-'));
  const historical = new Set(git('ls-files', '-m', '-o', '--exclude-standard', '-z').toString().split('\0').filter(Boolean));
  historical.delete('scripts/m2-workspace.mjs');
  const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').toString().split('\0').filter(Boolean))].map(file => {
    const bytes = fs.readFileSync(file), target = path.join(backup, file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes);
    return { file, bytes: bytes.length, sha256: hash(bytes), historical: historical.has(file) };
  });
  fs.writeFileSync(path.join(backup, 'worktree.patch'), git('diff', '--binary'));
  fs.writeFileSync(path.join(backup, 'index.patch'), git('diff', '--cached', '--binary'));
  const baseline = { head: git('rev-parse', 'HEAD').toString().trim(), backup, files };
  fs.mkdirSync('docs/m2', { recursive: true });
  fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));
  fs.writeFileSync('docs/m2/baseline.json', JSON.stringify({ ...baseline, backup: 'external; see baseline-local.json' }, null, 2));
  console.log(JSON.stringify({ backup, scanned: files.length, historical: historical.size, categories: Object.fromEntries(['src/', 'e2e/', 'docs/', 'scripts/'].map(prefix => [prefix, [...historical].filter(f => f.startsWith(prefix)).length])) }, null, 2));
}
