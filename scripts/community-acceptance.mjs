// No discovery, login, Docker startup, migration, deployment or implicit target.
// psql receives credentials only via its environment; diagnostics stay in memory.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fail = message => { throw new Error(message); };
const keys = (value, allowed) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('Invalid target fields; credentials must stay outside the manifest');
};
export const outstanding = ['real-JWT/PostgREST', 'two-connection-contention', 'Edge/Auth', 'OAuth-PKCE', 'public-read/Edge/Auth-rate-limits', 'retention/deletion'];

export function validateTarget(t, confirmation, password) {
  keys(t, ['id', 'environment', 'dedicated', 'kind', 'projectRef', 'apiUrl', 'database', 'productionProjectRefs']);
  if (t.environment !== 'disposable-non-production' || t.dedicated !== true ||
      !/^glyphforge-m3-(?:local|test|staging)-[a-z0-9-]+$/.test(t.id || '') ||
      /prod|live/i.test(t.id) || confirmation !== t.id) fail('Explicit dedicated non-production target and matching --confirm-target required');
  if (!password || /[\r\n\0]/.test(password)) fail('Acceptance database password environment variable required');
  keys(t.database, ['host', 'port', 'name', 'user']);
  const d = t.database;
  if (!Number.isInteger(d.port) || d.port < 1 || d.port > 65535 ||
      !/^[a-z0-9_.-]+$/i.test(d.user || '') || !/^[a-z0-9_-]+$/i.test(d.name || '') ||
      /prod|live/i.test(d.name)) fail('Invalid database identity');
  if (!Array.isArray(t.productionProjectRefs) || t.productionProjectRefs.some(ref => !/^[a-z]{20}$/.test(ref))) fail('Explicit productionProjectRefs list required (may be empty if none exist)');
  let api;
  try { api = new URL(t.apiUrl); } catch { fail('Invalid acceptance API URL'); }
  if (api.username || api.password || api.search || api.hash || api.pathname !== '/') fail('API URL must contain only an origin');
  if (t.kind === 'local') {
    if (t.projectRef !== 'local' || !['127.0.0.1', 'localhost'].includes(d.host) ||
        !['127.0.0.1', 'localhost'].includes(api.hostname) || api.protocol !== 'http:') fail('Local target must use loopback exclusively');
  } else if (t.kind === 'cloud') {
    if (!/^[a-z]{20}$/.test(t.projectRef || '') || t.productionProjectRefs.includes(t.projectRef) ||
        api.origin !== `https://${t.projectRef}.supabase.co` ||
        d.name !== 'postgres' || d.port !== 5432 ||
        !((d.host === `db.${t.projectRef}.supabase.co` && d.user === 'postgres') ||
          (/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(d.host) && d.user === `postgres.${t.projectRef}`)))
      fail('Cloud identity mismatch, production target, or unsupported connection (use direct/session port 5432)');
  } else fail('Target kind must be local or cloud');
  // A manifest is an operator attestation, not a way to infer production status.
  // Only use this entry after the user has designated this exact disposable target.
  return t;
}

export function parseTap(output, expected) {
  const lines = output.split(/\r?\n/).map(s => s.trim());
  const results = lines.filter(s => /^(?:not )?ok \d+(?: |$)/.test(s));
  const plans = lines.filter(s => /^\d+\.\.\d+/.test(s));
  if (plans.length !== 1 || plans[0] !== `1..${expected}` || results.length !== expected ||
      results.some((s, i) => !s.startsWith(`ok ${i + 1} `) || /#\s*(?:skip|todo)/i.test(s)) ||
      lines.some(s => /^(?:not ok|Bail out!)/i.test(s))) fail('pgTAP failed, skipped, incomplete or missing plan; raw SQL output suppressed');
  return results.length;
}

const preflightSQL = `begin read only;
select json_build_object(
 'database',current_database(),'user',session_user,
 'readOnly',current_setting('transaction_read_only'),
 'postgres',current_setting('server_version_num')::integer,
 'auth',to_regprocedure('auth.uid()') is not null,
 'writer',to_regprocedure('public.community_write(uuid,text,jsonb)') is not null,
 'fixturesAvailable',not exists(select 1 from auth.users where id in
   ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555')),
 'communityEmpty',not (exists(select 1 from public.profiles) or exists(select 1 from public.community_workflows)
   or exists(select 1 from public.workflow_versions) or exists(select 1 from public.workflow_likes)
   or exists(select 1 from public.usage_events) or exists(select 1 from public.reports)),
 'pgtap',exists(select 1 from pg_extension where extname='pgtap'),
 'rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relname in ('profiles','community_workflows','workflow_versions','workflow_likes','usage_events','reports') and c.relrowsecurity),
 'migrations',(select count(*) from supabase_migrations.schema_migrations where version in ('20261101091101','20261101114038'))
); rollback;`;

function psql(t, password, sql, readOnly) {
  // Discard inherited libpq settings (service files, options, host overrides etc.).
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG/i.test(k)));
  Object.assign(env, {
    PGHOST: t.database.host, PGPORT: String(t.database.port), PGDATABASE: t.database.name,
    PGUSER: t.database.user, PGPASSWORD: password, PGCONNECT_TIMEOUT: '8',
    PGSSLMODE: t.kind === 'cloud' ? 'verify-full' : 'disable',
    PGAPPNAME: 'glyphforge-m3-acceptance',
    PGOPTIONS: `-c default_transaction_read_only=${readOnly ? 'on' : 'off'} -c statement_timeout=30000 -c lock_timeout=5000`,
  });
  if (t.kind === 'cloud' && process.env.GLYPHFORGE_ACCEPTANCE_SSLROOTCERT)
    env.PGSSLROOTCERT = process.env.GLYPHFORGE_ACCEPTANCE_SSLROOTCERT;
  const r = spawnSync('psql', ['-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    cwd: root, env, input: sql, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error?.code === 'ENOENT') fail('psql unavailable; install/provide an approved client first. No Docker or cloud fallback attempted');
  if (r.status !== 0 || r.error) fail('Database command failed (connection/TLS/schema/SQL/timeout); raw diagnostics suppressed');
  return r.stdout;
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--plan') {
    console.log(JSON.stringify({ status: 'NOT_RUN', entry: 'See docs/M3-COMMUNITY-READINESS.md: isolated acceptance', outstanding }));
    return;
  }
  if (args.length !== 5 || !['--preflight', '--db-tests'].includes(args[0]) || args[1] !== '--target' || args[3] !== '--confirm-target' || !path.isAbsolute(args[2]))
    fail('Usage: --plan OR (--preflight|--db-tests) --target ABSOLUTE_MANIFEST --confirm-target EXACT_ID');
  let manifest;
  try { manifest = JSON.parse(readFileSync(args[2], 'utf8')); } catch { fail('Cannot read target manifest; raw contents suppressed'); }
  const password = process.env.GLYPHFORGE_ACCEPTANCE_DB_PASSWORD;
  const t = validateTarget(manifest, args[4], password);
  const version = spawnSync('psql', ['--version'], { encoding: 'utf8', timeout: 5000 });
  const clientVersion = version.stdout?.match(/psql \(PostgreSQL\) (\d+(?:\.\d+){1,2})/)?.[1];
  if (version.status !== 0 || !clientVersion || Number(clientVersion.split('.')[0]) < 15)
    fail('psql 15+ unavailable; provide an approved client first. No Docker or cloud fallback attempted');
  let preflight;
  try { preflight = JSON.parse(psql(t, password, preflightSQL, true).trim()); } catch { fail('Read-only preflight unavailable or failed; no tests executed (check psql/TLS/migrations/pgTAP)'); }
  if (preflight.database !== t.database.name || preflight.user !== t.database.user.replace(/^postgres\..+$/, 'postgres') ||
      preflight.readOnly !== 'on' || preflight.postgres < 150000 || !preflight.auth || !preflight.writer ||
      !preflight.pgtap || Number(preflight.rls) !== 6 || Number(preflight.migrations) !== 2)
    fail('Read-only preflight identity/schema/pgTAP mismatch; no tests executed');
  console.log(JSON.stringify({ target: t.id, preflight: 'PASS_READ_ONLY', psql: clientVersion, postgres: preflight.postgres }));
  if (args[0] === '--db-tests') {
    if (!preflight.fixturesAvailable || !preflight.communityEmpty)
      fail('pgTAP requires empty dedicated community tables and unused fixture IDs; no tests executed, no cleanup attempted');
    const sql = readFileSync(path.join(root, 'supabase/tests/community_rls.test.sql'), 'utf8');
    const expected = Number(sql.match(/select plan\((\d+)\)/)?.[1]);
    if (!expected || !/^begin;/m.test(sql) || !/rollback;\s*$/.test(sql)) fail('pgTAP transaction boundary missing');
    const count = parseTap(psql(t, password, sql, false), expected);
    console.log(JSON.stringify({ pgTAP: 'PASS_DATABASE_ONLY', assertions: count, transaction: 'ROLLED_BACK' }));
  }
  console.log(JSON.stringify({ publicRelease: 'NO_GO', outstanding }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
