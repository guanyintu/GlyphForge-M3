import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateTarget, parseTap } from './community-acceptance.mjs';

const local = { id: 'glyphforge-m3-local-acceptance', environment: 'disposable-non-production', dedicated: true, kind: 'local', projectRef: 'local', apiUrl: 'http://127.0.0.1:54321', database: { host: '127.0.0.1', port: 54322, name: 'postgres', user: 'postgres' }, productionProjectRefs: [] };
const ref = 'abcdefghijklmnopqrst';
const cloud = { ...local, id: 'glyphforge-m3-test-acceptance', kind: 'cloud', projectRef: ref, apiUrl: `https://${ref}.supabase.co`, database: { host: `db.${ref}.supabase.co`, port: 5432, name: 'postgres', user: 'postgres' } };
const password = crypto.randomUUID(); // Synthetic and never printed.
let checks = 0;
const ok = fn => { fn(); checks++; };
const denied = (target, confirm = target?.id, pass = password) => ok(() => assert.throws(() => validateTarget(target, confirm, pass)));
ok(() => assert.equal(validateTarget(local, local.id, password), local));
ok(() => assert.equal(validateTarget(cloud, cloud.id, password), cloud));
denied(null); denied({}); denied(local, ''); denied(local, local.id, '');
denied(local, local.id, 'fixture\ninvalid');
denied({ ...local, environment: 'production' }); denied({ ...local, dedicated: false });
denied({ ...local, id: 'glyphforge-m3-test-production' }); denied({ ...local, token: password });
denied({ ...local, database: { ...local.database, password } });
denied({ ...local, database: { ...local.database, host: 'example.com' } });
denied({ ...local, apiUrl: 'https://example.com' });
denied({ ...local, apiUrl: `http://user:${password}@127.0.0.1:54321` });
denied({ ...local, apiUrl: 'http://127.0.0.1:54321/?token=fixture' });
denied({ ...local, database: { ...local.database, name: 'production' } });
denied({ ...local, database: { ...local.database, port: 0 } });
denied({ ...local, database: { ...local.database, user: 'postgres options=unsafe' } });
denied({ ...cloud, productionProjectRefs: [ref] });
denied({ ...cloud, productionProjectRefs: undefined });
denied({ ...cloud, productionProjectRefs: ['invalid-ref'] });
denied({ ...cloud, apiUrl: 'https://other.supabase.co' });
denied({ ...cloud, database: { ...cloud.database, host: 'db.other.supabase.co' } });
denied({ ...cloud, database: { ...cloud.database, port: 6543 } });
denied({ ...cloud, database: { ...cloud.database, host: 'aws-0-us-east-1.pooler.supabase.com', user: 'postgres.other' } });
ok(() => assert.equal(parseTap('1..2\nok 1 - one\nok 2 - two\n', 2), 2));
for (const text of ['1..1\nnot ok 1 - failed', '1..2\nok 1 - incomplete', 'ok 1 - no plan', '1..1\nok 1 - skip # SKIP', '1..1\nok 1 - ok\nBail out!', '1..2\nok 2 - wrong order\nok 1 - wrong order'])
  ok(() => assert.throws(() => parseTap(text, text.startsWith('1..2') ? 2 : 1)));
ok(() => assert.throws(() => parseTap('1..1\n1..2\nok 1 - conflicting plans', 1)));
for (const args of [[], ['--db-tests'], ['--preflight', '--target', 'relative.json', '--confirm-target', local.id]]) {
  const r = spawnSync(process.execPath, ['scripts/community-acceptance.mjs', ...args], { encoding: 'utf8', env: { ...process.env, GLYPHFORGE_ACCEPTANCE_DB_PASSWORD: password } });
  ok(() => { assert.equal(r.status, 1); assert.ok(!(r.stdout + r.stderr).includes(password)); });
}
const dir = mkdtempSync(path.join(tmpdir(), 'glyphforge-acceptance-guard-'));
const file = path.join(dir, 'target.json');
try {
  writeFileSync(file, JSON.stringify(local));
  const r = spawnSync(process.execPath, ['scripts/community-acceptance.mjs', '--preflight', '--target', file, '--confirm-target', local.id], {
    encoding: 'utf8', env: { ...process.env, PATH: '', GLYPHFORGE_ACCEPTANCE_DB_PASSWORD: password },
  });
  ok(() => { assert.equal(r.status, 1); assert.match(r.stderr, /psql 15\+ unavailable/); assert.ok(!(r.stdout + r.stderr).includes(password)); });
} finally { unlinkSync(file); rmdirSync(dir); }
console.log(`${checks}/${checks} acceptance entry checks passed (local guard/TAP parser tests only; no database connection)`);
