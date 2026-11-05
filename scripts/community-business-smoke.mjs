// One synthetic listing, bounded HTTP, verified user JWTs only. Never log bodies.
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validateCommunityPayload } from '../supabase/functions/community/validator.js';
export const REF = 'rsntccggnvmuazvpxstf';
const ORIGIN = `https://${REF}.supabase.co`;
export const PLAN = {target: REF, status: 'NOT_RUN', requestMax: 40,
  listingMax: 1, reportMax: 1, timeoutMs: 15000, retries: 0,
  credentials: 'Windows DPAPI -> one-use local anonymous stdin pipe',
  cleanup: 'soft-delete only the UUID returned by this run; retained rows are reported'};
export function syntheticPayload() {
  const p = {format: 'glyphforge', version: 2, irVersion: 1,
    operatorVersions: {resource: 1, output: 1},
    workflow: {version: 1, id: 'm3-http-synthetic', name: 'M3 合成验收', seed: 42, limit: 5,
      nodes: [{id: 'a', op: 'resource', inputs: [], params: {resourceId: 'm3-synthetic-words'}},
      {id: 'b', op: 'output', inputs: ['a'], params: {}}], layout: {}},
    dependencies: [{id: 'm3-synthetic-words', name: '合成词表', version: 1, kind: 'word'}],
    resources: [{meta: {id: 'm3-synthetic-words', name: '合成词表', version: 1, kind: 'word',
      description: 'Synthetic only', color: 'green', count: 2, updatedAt: 0}, entries: ['合成', '验收']}]};
  validateCommunityPayload(p);
  return p;
}
export async function runBusiness({accounts, key, fetcher = fetch, signal}) {
  let requests = 0, edgeAttempts = 0, accepted = 0, id, author, deleted = false;
  let at = 'preflight', http = null, cleanup = 'NOT_NEEDED';
  const checks = [], tokens = [], marker = `M3-HTTP-${randomUUID()}`;
  const result = () => ({target: REF, requests, edgeAttempts, acceptedBusinessWrites: accepted,
    workflowId: id || null, marker, checks, cleanup,
    retained: id ? 'Soft-delete retains workflow, versions, report, events, profile and budget rows; backend audit required.' : 'No confirmed listing UUID; audit ambiguous publish failures.',
    maxRequests: 40});
  const fail = () => { throw new Error('Acceptance failed'); };
  function verify(step, condition) {
    checks.push({step, status: condition ? 'PASS' : 'FAIL'});
    if (!condition) { at = step; fail(); }
  }
  async function call(step, path, {who, body, statuses = [200], cleaning = false} = {}) {
    at = step; http = null;
    // Leave two requests available for cleanup and its read-back even on failure.
    if (requests >= (cleaning ? 40 : 38) || (!cleaning && signal?.aborted)) fail();
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !/^\/(auth|rest|functions)\/v1\//.test(url.pathname)) fail();
    const headers = {apikey: key, accept: 'application/json'};
    if (who !== undefined) headers.authorization = `Bearer ${tokens[who]}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    requests++;
    if (url.pathname.startsWith('/functions/')) edgeAttempts++;
    const timeout = AbortSignal.timeout(15000);
    const response = await fetcher(url, {method: body === undefined ? 'GET' : 'POST', headers,
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
      signal: cleaning || !signal ? timeout : AbortSignal.any([timeout, signal])});
    http = response.status;
    const ok = statuses.includes(http);
    checks.push({step, status: ok ? 'PASS' : 'FAIL', http});
    if (!ok) fail();
    const data = await response.json();
    if (body && url.pathname.startsWith('/functions/') && http === 200) accepted++;
    return data;
  }
  const read = (step, table, who, select = '*') => call(step,
    `/rest/v1/${table}?select=${select}&${table === 'community_workflows' ? 'id' : 'workflow_id'}=eq.${id}`, {who});
  const write = (step, who, action, b = {}, statuses) => call(step, '/functions/v1/community',
    {who, body: {...b, ...(id ? {workflow_id: id} : {}), action}, statuses});
  try {
    const p = syntheticPayload();
    for (let i = 0; i < 2; i++) {
      const session = await call(`login_${i ? 'B' : 'A'}`, '/auth/v1/token?grant_type=password', {body: accounts[i]});
      verify('session_token', typeof session.access_token === 'string' && !!session.access_token);
      tokens[i] = session.access_token;
      const u = await call(`get_user_${i ? 'B' : 'A'}`, '/auth/v1/user', {who: i});
      verify('verified_distinct_identity', /^[0-9a-f-]{36}$/i.test(u.id) && !u.is_anonymous && (i === 0 || u.id !== author));
      if (i === 0) author = u.id;
    }
    const meta = {title: marker, description: 'Synthetic bounded M3 acceptance; no personal data', tags: ['M3测试']};
    const w = await write('publish_v1', 0, 'publish', {...meta, payload: p});
    verify('publish_identity', /^[0-9a-f-]{36}$/i.test(w.id) && w.author_id === author && w.title === marker);
    id = w.id;
    verify('v1_fields', w.current_version === 1 && w.status === 'published' && w.likes === 0);
    const rows = await read('B_public_listing', 'community_workflows', 1);
    verify('public_fields', rows.length === 1 && rows[0].title === marker && rows[0].author_id === author);
    const vs = await read('B_v1_payload', 'workflow_versions', 1);
    verify('v1_content_hash', vs.length === 1 && vs[0].version === 1 &&
      vs[0].content_hash === createHash('sha256').update(JSON.stringify(p)).digest('hex') &&
      JSON.stringify(vs[0].payload) === JSON.stringify(p));
    validateCommunityPayload(vs[0].payload);
    const denied = await write('B_cannot_edit_A', 1, 'edit', {...meta, title: 'forbidden'}, [400, 403]);
    verify('ownership_rejection', typeof denied.error === 'string' && /Author required|denied/i.test(denied.error));
    verify('rejected_edit_no_mutation', (await read('unchanged_after_denial', 'community_workflows', 1))[0]?.title === marker);
    for (const [step, liked, expected] of [['like', true, 1], ['duplicate_like', true, 1], ['unlike', false, 0]])
      verify(step + '_count', (await write(step, 1, 'like', {liked})).likes === expected);
    verify('unlike_row_removed', (await read('B_likes_rows', 'workflow_likes', 1)).length === 0);
    await write('synthetic_report', 1, 'report', {reason: 'Synthetic M3 test report; no real allegation'});
    const reportRows = await read('B_own_report', 'reports', 1);
    verify('report_fields', reportRows.length === 1 && reportRows[0].workflow_id === id && /Synthetic M3/.test(reportRows[0].reason));
    verify('A_cannot_read_B_report', (await read('A_report_RLS', 'reports', 0)).length === 0);
    const event = {version: 1, id: randomUUID(), kind: 'run'};
    const runDenied = await write('run_requires_adoption', 1, 'event', event, [400, 403]);
    verify('adoption_rejection', /Adopt version first/.test(runDenied.error));
    for (const kind of ['view', 'adoption', 'run']) {
      const e = {version: 1, kind, id: randomUUID()};
      await write(kind, 1, 'event', e);
      await write(kind + '_duplicate', 1, 'event', e);
    }
    const stats = (await read('B_statistics', 'community_workflows', 1))[0];
    verify('exact_statistics', stats.views === 1 && stats.adoptions === 1 && stats.runs === 1 && stats.likes === 0);
    verify('edit_metadata_fields', (await write('A_edit_metadata', 0, 'edit', {...meta, description: 'Synthetic edited metadata'})).description === 'Synthetic edited metadata');
    p.workflow.seed = 43;
    verify('publish_v2_fields', (await write('A_publish_v2', 0, 'publish', {...meta, payload: p, expected_version: 1})).current_version === 2);
    const conflict = await write('stale_expected_version', 0, 'publish', {...meta, payload: p, expected_version: 1}, [400, 409]);
    verify('version_conflict_rejection', /version conflict/i.test(conflict.error));
    const versions = await read('immutable_versions', 'workflow_versions', 1);
    verify('exact_v1_v2_hashes', versions.length === 2 && versions.some(v => v.version === 1 && v.content_hash === vs[0].content_hash) &&
      versions.some(v => v.version === 2 && v.content_hash === createHash('sha256').update(JSON.stringify(p)).digest('hex')));
    verify('unlisted_status', (await write('A_unlist', 0, 'status', {status: 'unlisted'})).status === 'unlisted');
    verify('B_unlisted_invisible', (await read('B_unlisted_RLS', 'community_workflows', 1)).length === 0);
    verify('A_unlisted_visible', (await read('A_unlisted_RLS', 'community_workflows', 0))[0]?.status === 'unlisted');
  } catch {
    return await finish('FAIL', at, http);
  }
  return await finish('PASS_HTTP_BUSINESS', null, null);
  async function finish(status, failedAt, failedHttp) {
    if (id && !deleted) {
      cleanup = 'ATTEMPTED';
      try {
        const row = await call('cleanup_soft_delete', '/functions/v1/community', {who: 0,
          body: {action: 'status', workflow_id: id, status: 'deleted'}, cleaning: true});
        verify('deleted_status', row.id === id && row.status === 'deleted');
        deleted = true; cleanup = 'SOFT_DELETED';
        const invisible = await call('B_deleted_RLS', `/rest/v1/community_workflows?select=id&id=eq.${id}`, {who: 1, cleaning: true});
        verify('B_deleted_invisible', invisible.length === 0);
      } catch { cleanup = deleted ? 'DELETED_READBACK_FAILED' : 'FAILED'; status = 'FAIL'; failedAt ||= at; failedHttp ??= http; }
    }
    return {...result(), status, at: failedAt, http: failedHttp};
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--plan') { console.log(JSON.stringify(PLAN)); return; }
  if (args.join(' ') !== `--accounts-stdin --confirm-target ${REF}`) { console.error('BLOCKED: explicit dedicated test target and stdin accounts required.'); process.exitCode = 2; return; }
  let accounts;
  try {
    const chunks = []; let size = 0;
    for await (const c of process.stdin) { size += c.length; if (size > 8192) throw Error(); chunks.push(c); }
    const p = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (Object.keys(p).sort().join(',') !== 'a,b') throw Error();
    accounts = [p.a, p.b];
    if (accounts.some(x => !x || Object.keys(x).sort().join(',') !== 'email,password' || typeof x.email !== 'string' || !x.email || typeof x.password !== 'string' || !x.password) || p.a.email === p.b.email) throw Error();
  } catch { accounts = undefined; /* never print input or exception */ }
  const key = process.env.GLYPHFORGE_M3_PUBLISHABLE_KEY || '';
  if (!accounts || !key.startsWith('sb_publishable_')) {
    console.log(JSON.stringify({target: REF, status: 'BLOCKED', requests: 0, reason: 'MISSING_PIPE_ACCOUNTS_OR_PUBLIC_KEY'})); process.exitCode = 2; return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  const report = await runBusiness({accounts, key, signal: controller.signal});
  console.log(JSON.stringify(report));
  process.exitCode = report.status === 'PASS_HTTP_BUSINESS' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
