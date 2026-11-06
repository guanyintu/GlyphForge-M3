import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createGate, preflight, runJourney, ORIGIN, REF } from './community-ui-business-live.mjs';

const accounts = {
  a: { email: 'fixture-a@example.invalid', password: 'fixture-private-A' },
  b: { email: 'fixture-b@example.invalid', password: 'fixture-private-B' },
};
const key = 'sb_publishable_fixture_only';
const budget = { target: REF, utc_day: new Date().toISOString().slice(0, 10),
  observed_epoch: Math.floor(Date.now() / 1000), enabled: true, global_writes: 0, max_account_writes: 0,
  publications: 0, max_account_publications: 0, payload_bytes: 0, payload_day_bytes: 0,
  auth_users: 2, confirmed_users: 2 };
const id = '33333333-3333-4333-8333-333333333333';
const old = 'e34e98cc-78d1-4be2-9d06-65e0f19f26c0';
const title = 'synthetic fixture';
const hash = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const edge = ORIGIN + '/functions/v1/community';
const list = ORIGIN + '/rest/v1/community_workflows?status=eq.published';
const newGate = () => createGate({ budget, title });
const publish = (gate, listingId = id) => {
  gate.arm('publish', hash({}));
  const entry = gate.allow('a', 'POST', edge, { action: 'publish', title, payload: {} });
  assert.ok(entry);
  gate.response(entry, 200, { id: listingId, title, status: 'published', current_version: 1 });
};

assert.equal(preflight(budget, accounts), null);
assert.equal(preflight({ ...budget, target: 'other' }, accounts), 'wrong_target');
assert.equal(preflight(budget, { a: accounts.a }), 'missing_distinct_accounts');
assert.equal(preflight({ ...budget, global_writes: 93 }, accounts), 'insufficient_budget');
assert.equal(preflight({ ...budget, max_account_writes: 57 }, accounts), 'insufficient_budget');
assert.equal(preflight({ ...budget, observed_epoch: budget.observed_epoch - 301 }, accounts), 'stale_budget');
assert.equal(preflight({ ...budget, observed_epoch: budget.observed_epoch + 10 }, accounts), null);
assert.equal(preflight({ ...budget, observed_epoch: budget.observed_epoch + 16 }, accounts), 'stale_budget');
assert.equal(newGate().allow('a', 'GET', 'https://other.example.invalid/'), null);
const missing = spawnSync(process.execPath, ['scripts/community-ui-business-live.mjs', 'missing.json'],
  { input: JSON.stringify(accounts), encoding: 'utf8', timeout: 15000 });
assert.equal(missing.status, 2);
assert.equal(JSON.parse(missing.stdout).requests, 0);
assert.equal(missing.stderr, '');
for (const body of [
  { action: 'event' }, { action: 'report' }, { action: 'edit' }, { action: 'delete', status: 'deleted', workflow_id: id },
  { action: 'status', status: 'unlisted', workflow_id: id }, { action: 'status', status: 'deleted', workflow_id: old },
]) {
  const gate = newGate();
  publish(gate);
  gate.beginCleanup();
  assert.equal(gate.allow('a', 'POST', edge, body), null);
  assert.equal(gate.result().requests, 1);
}
{
  const gate = newGate();
  publish(gate, old);
  assert.equal(gate.needsCleanup, false);
  assert.equal(gate.reason, 'invalid_publish_result');
}
{
  const gate = newGate();
  gate.arm('publish', hash({}));
  assert.equal(gate.allow('a', 'POST', edge, { action: 'publish', title, payload: {}, workflow_id: old }), null);
}
{
  const gate = newGate();
  publish(gate);
  gate.arm('publish', hash({}));
  assert.equal(gate.allow('a', 'POST', edge, { action: 'publish', title, payload: {} }), null);
}
{
  const gate = newGate();
  publish(gate);
  for (let i = 1; i < 24; i++) assert.ok(gate.allow('b', 'GET', list));
  assert.equal(gate.allow('b', 'GET', list), null);
  gate.beginCleanup();
  assert.ok(gate.allow('a', 'OPTIONS', list));
  assert.ok(gate.allow('a', 'GET', list));
  assert.ok(gate.allow('a', 'OPTIONS', edge));
  assert.ok(gate.allow('a', 'POST', edge, { action: 'status', status: 'deleted', workflow_id: id }));
  assert.equal(gate.allow('a', 'GET', list), null);
  assert.equal(gate.result().requests, 28);
  assert.equal(gate.result().options, 2);
}
{
  const gate = newGate();
  publish(gate);
  gate.arm('like');
  const entry = gate.allow('b', 'POST', edge, { action: 'like', liked: true, workflow_id: id });
  gate.response(entry, 429);
  gate.arm('unlike');
  assert.equal(gate.allow('b', 'POST', edge, { action: 'like', liked: false, workflow_id: id }), null);
  gate.beginCleanup();
  assert.ok(gate.allow('a', 'POST', edge, { action: 'status', status: 'deleted', workflow_id: id }));
}
console.log('Offline guard assertions passed.');

for (const failLike of [false, true]) {
  const calls = [];
  const identities = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222' };
  let row;
  const fixture = ({ actor, method, url, body }) => {
    calls.push(method + ' ' + url.pathname);
    const reply = (data, status = 200) => ({ status, data });
    if (method === 'OPTIONS') return reply(null, 204);
    switch (url.pathname) {
      case '/auth/v1/token':
        return reply({ access_token: 'fixture-token', refresh_token: 'fixture-refresh', expires_in: 3600,
          user: { id: identities[actor], email: accounts[actor].email } });
      case '/rest/v1/community_workflows':
        return reply(row?.status === 'published' ? [row] : []);
      case '/rest/v1/workflow_likes':
        return reply(row?.likes === 1 && actor === 'b' ? [{ workflow_id: id }] : []);
      case '/rest/v1/workflow_versions':
        return reply([{ workflow_id: id, version: 1 }]);
      case '/functions/v1/community':
        if (body.action === 'publish') row = { id, title: body.title, author_id: identities.a, author: '合成作者',
          status: 'published', current_version: 1, likes: 0, views: 0, adoptions: 0, runs: 0, tags: [] };
        if (body.action === 'like' && failLike) return reply({ error: accounts.b.password }, 429);
        if (body.action === 'like') row.likes = Number(body.liked);
        if (body.action === 'status') row.status = 'deleted';
        return reply(row);
      default: throw new Error('Unexpected fixture path');
    }
  };
  const result = await runJourney({ accounts, budget, key, fixture });
  const output = JSON.stringify(result);
  assert.ok([accounts.a.email, accounts.b.email, accounts.a.password, accounts.b.password,
    'fixture-token', key].every((secret) => !output.includes(secret)));
  console.log(JSON.stringify({ fixture: failLike ? 'like_429' : 'happy_path', ...result }));
  assert.equal(result.status, failLike ? 'FAIL' : 'PASS_UI_DB_PENDING', calls.join('\n'));
  assert.equal(result.cleanup, 'UI_CONFIRMED_DB_PENDING');
  assert.equal(row.id, id);
  assert.equal(row.status, 'deleted');
  assert.equal(row.likes, 0);
  assert.equal(result.requests, calls.length);
  assert.ok(result.options > 0 && result.requests <= 28);
  assert.equal(result.actions.unlike.attempted, !failLike);
}
