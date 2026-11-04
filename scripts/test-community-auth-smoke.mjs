import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const REF = 'rsntccggnvmuazvpxstf';
const src = 'scripts/community-auth-smoke.mjs';
const cleanEnv = Object.fromEntries(Object.entries(process.env)
  .filter(([k]) => !k.startsWith('GLYPHFORGE_M3_') && k !== 'NODE_OPTIONS'));
function run(args, env = {}, preload = null) {
  const argv = [...(preload ? ['--import', 'data:text/javascript,' + encodeURIComponent(preload)] : []), src, ...args];
  return spawnSync(process.execPath, argv, {
    encoding: 'utf8', timeout: 15000, env: {...cleanEnv, ...env},
  });
}
const block = run(['--accounts', '--confirm-target', REF]);
assert.equal(block.status, 2);
assert.equal(JSON.parse(block.stdout).status, 'BLOCKED');
assert.equal(JSON.parse(block.stdout).requests, 0);

const wrong = run(['--accounts', '--confirm-target', 'hyzrllisqvzmhiihrflk']);
assert.equal(wrong.status, 2);
assert.ok(!wrong.stdout.includes('PASS'));

const plan = run(['--plan']);
assert.equal(plan.status, 0);
assert.equal(JSON.parse(plan.stdout).requestMax, 18);

const env = {
  GLYPHFORGE_M3_PUBLISHABLE_KEY: 'sb_publishable_test_only',
  GLYPHFORGE_M3_A_EMAIL: 'fixture-author@example.invalid',
  GLYPHFORGE_M3_A_PASSWORD: 'synthetic-no-secret-AAA',
  GLYPHFORGE_M3_B_EMAIL: 'fixture-reader@example.invalid',
  GLYPHFORGE_M3_B_PASSWORD: 'synthetic-no-secret-BBB',
};
const preload = `
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.origin !== 'https://rsntccggnvmuazvpxstf.supabase.co') throw Error('unexpected origin');
    const bearer = opts.headers?.authorization || '';
    let status = 500, result = {error: 'fixture'};
    if (u.pathname === '/auth/v1/token' && u.search === '?grant_type=password') {
      const credentials = JSON.parse(opts.body);
      const which = credentials.email === 'fixture-author@example.invalid' ? 'A' :
        credentials.email === 'fixture-reader@example.invalid' ? 'B' : '?';
      status = which === '?' ? 401 : 200;
      result = {access_token: 'fixture-' + which};
    } else if (u.pathname === '/auth/v1/user') {
      status = bearer.startsWith('Bearer fixture-') ? 200 : 401;
      result = {id: bearer.endsWith('-A') ? '11111111-1111-4111-8111-111111111111' :
        '22222222-2222-4222-8222-222222222222', is_anonymous: false};
    } else if (u.pathname === '/rest/v1/community_workflows') {
      status = 200; result = [];
    } else if (u.pathname === '/rest/v1/usage_events') {
      status = 401;
    } else if (u.pathname === '/functions/v1/community') {
      status = opts.method === 'POST' ? 401 : bearer.startsWith('Bearer fixture-') ? 405 : 401;
    } else throw Error('unexpected path ' + u.pathname);
    return new Response(JSON.stringify(result), {status, headers: {'content-type': 'application/json'}});
  };
`;
const pass = run(['--accounts', '--confirm-target', REF], env, preload);
assert.equal(pass.status, 0, 'fake gateway smoke should pass without touching cloud');
const result = JSON.parse(pass.stdout);
assert.equal(result.status, 'PASS_READ_ONLY_AUTH_GATEWAY');
assert.equal(result.requests, 14);
assert.equal(result.writes, 0);
assert.equal(result.checks.length, 14);
assert.ok(result.checks.every(x => x.status === 'PASS'));
assert.ok(!pass.stdout.includes(env.GLYPHFORGE_M3_A_PASSWORD));
assert.ok(!pass.stdout.includes(env.GLYPHFORGE_M3_B_PASSWORD));
assert.ok(!pass.stdout.includes(env.GLYPHFORGE_M3_A_EMAIL));
assert.ok(!pass.stdout.includes(env.GLYPHFORGE_M3_B_EMAIL));

const invalid = run(['--accounts', '--confirm-target', REF], {
  ...env, GLYPHFORGE_M3_B_EMAIL: env.GLYPHFORGE_M3_A_EMAIL,
}, preload);
assert.equal(invalid.status, 1);
assert.equal(JSON.parse(invalid.stdout).status, 'FAIL');

console.log('5/5 community-auth smoke guard/fixture tests passed (0 live HTTP calls)');
