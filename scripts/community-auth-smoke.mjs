// Dedicated, read-only cloud Auth gateway acceptance. No writes, no account creation.
// Credentials are ephemeral environment variables; never print response bodies or tokens.
const REF = 'rsntccggnvmuazvpxstf';
const ORIGIN = `https://${REF}.supabase.co`;
const MAX_REQUESTS = 18;
const TIMEOUT_MS = 15000;

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--plan') {
  console.log(JSON.stringify({
    mode: 'read-only-auth-gateway', target: REF, requestMax: MAX_REQUESTS,
    requires: ['GLYPHFORGE_M3_PUBLISHABLE_KEY', 'GLYPHFORGE_M3_A_EMAIL',
      'GLYPHFORGE_M3_A_PASSWORD', 'GLYPHFORGE_M3_B_EMAIL',
      'GLYPHFORGE_M3_B_PASSWORD'],
    excludes: ['database mutations', 'Edge business writes', 'OAuth', 'rate-limit probing'],
    status: 'NOT_RUN',
  }));
  process.exit(0);
}
if (args.length !== 3 || args[0] !== '--accounts' ||
    args[1] !== '--confirm-target' || args[2] !== REF) {
  console.error('Usage: node scripts/community-auth-smoke.mjs --plan OR --accounts --confirm-target ' + REF);
  process.exit(2);
}
const key = process.env.GLYPHFORGE_M3_PUBLISHABLE_KEY || '';
const identities = [
  {email: process.env.GLYPHFORGE_M3_A_EMAIL, password: process.env.GLYPHFORGE_M3_A_PASSWORD},
  {email: process.env.GLYPHFORGE_M3_B_EMAIL, password: process.env.GLYPHFORGE_M3_B_PASSWORD},
];
if (!key.startsWith('sb_publishable_') || identities.some(x => !x.email || !x.password)) {
  console.log(JSON.stringify({
    target: REF, status: 'BLOCKED', reason: 'MISSING_EPHEMERAL_AUTH_CREDENTIALS',
    requests: 0, writes: 0, liveAuth: 'NOT_RUN',
  }));
  process.exit(2);
}
let requests = 0;
const checks = [];
const stop = (name, status) => {
  throw Object.assign(new Error('Live acceptance failed'), {name: 'AcceptanceFailure', step: name, http: status});
};
async function call(step, path, {method='GET', bearer, body}={}) {
  const url = new URL(path, ORIGIN);
  if (url.origin !== ORIGIN || !url.pathname.match(/^\/(auth|rest|functions)\/v1\//)) stop(step, 0);
  if (++requests > MAX_REQUESTS) stop(step, 0);
  const headers = {'apikey': key, 'accept': 'application/json'};
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error',
  });
  return response;
}
function expect(step, response, statuses) {
  const ok = statuses.includes(response.status);
  checks.push({step, status: ok ? 'PASS' : 'FAIL', http: response.status});
  if (!ok) stop(step, response.status);
}
try {
  const anon = await call('anon_list', '/rest/v1/community_workflows?select=id&limit=1');
  expect('anon_list', anon, [200]);

  const privateData = await call('anon_private_events', '/rest/v1/usage_events?select=event_key&limit=1');
  expect('anon_private_events', privateData, [401, 403]);

  const noToken = await call('edge_without_jwt', '/functions/v1/community', {method: 'POST', body: {action: 'like'}});
  expect('edge_without_jwt', noToken, [401]);

  const fakeToken = await call('edge_invalid_jwt', '/functions/v1/community', {
    method: 'POST', bearer: 'not-a-valid-jwt', body: {action: 'like'},
  });
  expect('edge_invalid_jwt', fakeToken, [401]);

  const userIds = new Set();
  for (let i = 0; i < identities.length; i++) {
    const label = i === 0 ? 'A' : 'B';
    const login = await call('login_' + label, '/auth/v1/token?grant_type=password', {
      method: 'POST', body: {email: identities[i].email, password: identities[i].password},
    });
    expect('login_' + label, login, [200]);
    const session = await login.json();
    if (!session?.access_token || typeof session.access_token !== 'string') stop('session_' + label, 0);
    const token = session.access_token;

    const who = await call('get_user_' + label, '/auth/v1/user', {bearer: token});
    expect('get_user_' + label, who, [200]);
    const user = await who.json();
    if (!user?.id || user.is_anonymous) stop('identity_' + label, 0);
    if (userIds.has(user.id)) stop('distinct_users', 0);
    userIds.add(user.id);

    const list = await call('user_list_' + label, '/rest/v1/community_workflows?select=id&limit=1', {bearer: token});
    expect('user_list_' + label, list, [200]);

    const denied = await call('user_private_events_' + label, '/rest/v1/usage_events?select=event_key&limit=1', {bearer: token});
    expect('user_private_events_' + label, denied, [401, 403]);

    // GET reaches the handler (405), proving the gateway accepted a real Auth JWT.
    // Handler rejects GET before the budget-reserving RPC, so this is strictly read-only.
    const edge = await call('edge_valid_jwt_' + label, '/functions/v1/community', {bearer: token});
    expect('edge_valid_jwt_' + label, edge, [405]);
  }
  console.log(JSON.stringify({
    target: REF, status: 'PASS_READ_ONLY_AUTH_GATEWAY', requests,
    writes: 0, checks, business: 'NOT_RUN', oauth: 'NOT_RUN',
  }));
} catch (e) {
  console.log(JSON.stringify({
    target: REF, status: 'FAIL', at: e?.step || 'HTTP_OR_NETWORK',
    http: Number.isInteger(e?.http) ? e.http : null,
    requests, writes: 0, checks, business: 'NOT_RUN',
  }));
  process.exitCode = 1;
}
