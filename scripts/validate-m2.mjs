import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const mode = process.argv.includes('--red') ? 'red' : process.argv.includes('--targeted') ? 'targeted' : 'full';
const output = `docs/m2/${mode}-${Date.now()}`;
fs.mkdirSync(output, { recursive: true });
const oldDocs = new Map();
function walk(dir, action) { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (file === path.join('docs', 'm2')) continue; if (entry.isDirectory()) walk(file, action); else action(file); } }
walk('docs', file => oldDocs.set(file, fs.readFileSync(file)));
const fingerprint = {};
for (const dir of ['src', 'e2e', 'scripts']) walk(dir, file => { fingerprint[file.replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); });
for (const file of ['package.json', 'pnpm-lock.yaml', 'vite.config.ts', 'playwright.config.ts']) fingerprint[file] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(`${output}/source.json`, JSON.stringify(fingerprint, null, 2));
if (fs.existsSync('dist')) {
  const dist = {};
  walk('dist', file => { dist[file.replaceAll('\\', '/')] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); });
  fs.writeFileSync(`${output}/dist-before.json`, JSON.stringify(dist, null, 2));
}
const checks = mode === 'red' ? [] : [
  ['tests', 'node_modules/vitest/vitest.mjs', 'run'],
  ['typecheck', 'node_modules/typescript/bin/tsc', '--noEmit'],
  ['build-types', 'node_modules/typescript/bin/tsc', '-b'],
  ['build', 'node_modules/vite/bin/vite.js', 'build'],
  ['benchmark', 'node_modules/vitest/vitest.mjs', 'run', 'src/tests/performance.test.ts', 'src/tests/resource-catalog.test.ts', 'src/tests/packs.test.ts', 'src/tests/lineage.test.ts', 'src/tests/scale.test.ts', 'src/tests/share-code.test.ts', '--reporter=verbose'],
];
checks.push(['browser', 'node_modules/@playwright/test/cli.js', 'test', ...(mode !== 'full' ? ['e2e/m2.spec.ts'] : []), `--output=${output}/traces`]);
const exits = [];
try {
  for (const [name, ...args] of checks) {
    console.log(`Starting ${output}/${name}`);
    const start = Date.now();
    fs.writeFileSync(`${output}/${name}.txt`, '');
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, args, { env: { ...process.env, P2G_SAMPLE: 'm2', P2F_SAMPLE: 'm2' } });
      let bytes = 0, error;
      const record = chunk => { bytes += chunk.length; if (bytes > 96 * 1024 * 1024) { error = new Error('Validation output exceeded 96 MiB'); child.kill(); } else fs.appendFileSync(`${output}/${name}.txt`, chunk); };
      child.stdout.on('data', record); child.stderr.on('data', record);
      child.on('error', value => { error = value; });
      child.on('close', status => resolve({ status, error }));
    });
    exits.push({ name, args, exit: result.status, ms: Date.now() - start, error: result.error?.message });
    if (name === 'browser' && fs.existsSync('test-results/browser-results.json')) fs.copyFileSync('test-results/browser-results.json', `${output}/browser-results.json`);
    console.log(`${name}: ${result.status}`);
    if (result.status !== 0) break;
  }
} finally {
  const restored = [], created = [];
  walk('docs', file => {
    const old = oldDocs.get(file), bytes = fs.readFileSync(file);
    if (!old || !bytes.equals(old)) {
      const archive = `${output}/replayed-${file.replaceAll(/[\\/]/g, '_')}`;
      fs.copyFileSync(file, archive);
      if (old) { fs.writeFileSync(file, old); restored.push(file); }
      else { fs.renameSync(file, `${archive}.original`); created.push(file); }
    }
  });
  fs.writeFileSync(`${output}/exits.json`, JSON.stringify({ mode, node: process.version, platform: `${process.platform}/${process.arch}`, exits, restored, created }, null, 2));
  console.log(output);
}
if (exits.length !== checks.length || exits.some(x => x.exit !== 0)) process.exitCode = 1;
