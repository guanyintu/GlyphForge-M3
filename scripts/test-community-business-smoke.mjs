import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { runBusiness, syntheticPayload, REF } from './community-business-smoke.mjs';
import { validateCommunityPayload, metadata } from '../supabase/functions/community/validator.js';
let checks = 0;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GLYPHFORGE_M3_') && k !== 'NODE_OPTIONS'));
function cli(args, input = '{}') {
  return spawnSync(process.execPath, ['scripts/community-business-smoke.mjs', ...args],
    {env: {...env, GLYPHFORGE_M3_PUBLISHABLE_KEY: 'sb_publishable_fixture'}, input, encoding: 'utf8', timeout: 15000});
}
for (const [args, input] of [
  [['--accounts-stdin', '--confirm-target', REF], '{}'],
  [['--accounts-stdin', '--confirm-target', 'other-project'], '{}'],
  [['--accounts-stdin', '--confirm-target', REF], 'x'.repeat(9000)],
  [['--accounts-stdin', '--confirm-target', REF], JSON.stringify({a: {email:'same',password:'x'},b:{email:'same',password:'x'}})],
]) { const r = cli(args, input); assert.equal(r.status, 2); assert.ok(!r.stdout.includes('PASS_HTTP')); checks++; }
assert.equal(JSON.parse(cli(['--plan']).stdout).requestMax, 40); checks++;
validateCommunityPayload(syntheticPayload()); checks++;
const ids = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
const accounts = [{email:'a@example.invalid',password:'fixture-private-A'}, {email:'b@example.invalid',password:'fixture-private-B'}];
async function fixture(fault) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key,is_anonymous boolean default false);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    insert into auth.users(id) values('${ids[0]}'),('${ids[1]}');`);
  for (const f of ['20261101091101_community_platform.sql', '20261101114038_community_storage_budget.sql'])
    await db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
  let calls = 0, posts = 0;
  const fetcher = async (url, opts) => {
    calls++;
    assert.equal(url.origin, `https://${REF}.supabase.co`);
    assert.equal(opts.redirect, 'error'); assert.ok(opts.signal);
    if (fault === 'network' && calls === 6) throw Error(accounts[0].password);
    if (fault === '500' && calls === 6) return Response.json({error: accounts[0].password}, {status:500});
    const who = opts.headers.authorization?.endsWith('fixture-B') ? 1 : 0;
    const actor = ids[who];
    await db.exec('reset role');
    if (url.pathname === '/auth/v1/token') {
      const b = JSON.parse(opts.body);
      return Response.json({access_token: b.email === accounts[0].email ? 'fixture-A' : 'fixture-B'});
    }
    if (url.pathname === '/auth/v1/user') return Response.json({id:actor,is_anonymous:false});
    if (url.pathname === '/functions/v1/community') {
      posts++;
      if (fault === '429' && posts === 2) return Response.json({error:'budget'}, {status:429});
      await db.exec('set role service_role');
      const rpc = async (command, b) => (await db.query('select public.community_write($1,$2,$3) r',[actor,command,JSON.stringify(b)])).rows[0].r;
      await rpc('reserve', {});
      try {
        const b = JSON.parse(opts.body);
        if (['publish','edit'].includes(b.action)) Object.assign(b, metadata(b.title,b.description,b.tags));
        if (b.action === 'publish') {validateCommunityPayload(b.payload);b.payload_text=JSON.stringify(b.payload);delete b.payload;}
        return Response.json(await rpc(b.action,b));
      } catch (e) { return Response.json({error: e.message}, {status:400}); }
    }
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
    const table = url.pathname.split('/').at(-1);
    assert.ok(['community_workflows','workflow_versions','workflow_likes','reports'].includes(table));
    const column = table === 'community_workflows' ? 'id' : 'workflow_id';
    let rows = (await db.query(`select * from public.${table} where ${column}=$1`,[url.searchParams.get(column).slice(3)])).rows;
    if (fault === 'hash' && table === 'workflow_versions') rows = rows.map(r => ({...r,content_hash:'0'.repeat(64)}));
    // PostgreSQL returns json without changing key order, as the real REST API does.
    return Response.json(rows);
  };
  const report = await runBusiness({accounts, key:'sb_publishable_fixture',fetcher});
  await db.exec('reset role');
  const retained = (await db.query('select status from public.community_workflows')).rows;
  assert.ok(calls <= 40); assert.equal(report.requests,calls);
  assert.equal(retained.length,1); assert.equal(retained[0].status,'deleted');
  assert.ok(!JSON.stringify(report).includes(accounts[0].password));
  assert.ok(!JSON.stringify(report).includes('fixture-A'));
  if (!fault) {
    assert.equal(report.status,'PASS_HTTP_BUSINESS',JSON.stringify(report));
    const counts = (await db.query('select (select count(*) from public.workflow_versions)::int versions,(select count(*) from public.reports)::int reports,(select count(*) from public.usage_events)::int events')).rows[0];
    assert.deepEqual(counts,{versions:2,reports:1,events:3});
    console.log(JSON.stringify({fixtureRequests:calls,edgeAttempts:posts,retained:counts}));
  } else { assert.equal(report.status,'FAIL'); assert.equal(report.cleanup,'SOFT_DELETED'); }
  await db.close(); checks++;
}
await fixture();
for (const fault of ['network','500','hash','429']) await fixture(fault);
console.log(`${checks}/11 business guard/real-validator/PGlite-backed HTTP fixture checks PASS; 0 live HTTP`);
