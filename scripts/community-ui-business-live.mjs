import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { syntheticPayload } from './community-business-smoke.mjs';
import { validateCommunityPayload } from '../supabase/functions/community/validator.js';

export const REF = 'rsntccggnvmuazvpxstf';
export const ORIGIN = `https://${REF}.supabase.co`;
const SITE = 'http://127.0.0.1:5173';
const EDGE = '/functions/v1/community';
const TOKEN = '/auth/v1/token';
const LIST = '/rest/v1/community_workflows';
const DETAILS = ['/rest/v1/workflow_versions', '/rest/v1/workflow_likes'];
const LIMIT = 28;
const TIMEOUT = 15000;
const BUDGET_MAX_AGE = 300000;
const CLOCK_SKEW = 15000;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const OLD = 'e34e98cc-78d1-4be2-9d06-65e0f19f26c0';
const actions = ['publish', 'like', 'unlike', 'delete'];
const digest = (data) => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const day = (now) => new Date(now).toISOString().slice(0, 10);
const accountOK = (a) => typeof a?.email === 'string' && a.email.includes('@')
  && typeof a.password === 'string' && a.password.length > 0;

export function preflight(budget, accounts, now = Date.now()) {
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  if (budget?.target !== REF) return 'wrong_target';
  if (!accountOK(accounts?.a) || !accountOK(accounts?.b)
    || accounts.a.email.toLowerCase() === accounts.b.email.toLowerCase()) return 'missing_distinct_accounts';
  if (budget.utc_day !== day(now) || !count(budget.observed_epoch)
    || now - budget.observed_epoch * 1000 > BUDGET_MAX_AGE - CLOCK_SKEW
    || budget.observed_epoch * 1000 - now > CLOCK_SKEW
    || day(now + BUDGET_MAX_AGE + CLOCK_SKEW) !== budget.utc_day) return 'stale_budget';
  if (budget.enabled !== true || budget.auth_users !== 2 || budget.confirmed_users !== 2
    || !count(budget.global_writes) || !count(budget.max_account_writes)
    || budget.global_writes + 8 > 100 || budget.max_account_writes + 4 > 60
    || !count(budget.publications) || budget.publications >= 100
    || !count(budget.max_account_publications) || budget.max_account_publications >= 10
    || !count(budget.payload_bytes) || budget.payload_bytes + 4096 > 16777216
    || !count(budget.payload_day_bytes) || budget.payload_day_bytes + 4096 > 2097152) return 'insufficient_budget';
  return null;
}

export function createGate({ title, budget }) {
  const sent = [];
  const writes = {};
  const logins = new Set();
  let expected, workflowId, previewHash, stopped, cleaning = false, authorDetailReady = false;
  return {
    stop(reason) { stopped ??= reason; },
    arm(action, hash) { expected = action; if (hash) previewHash = hash; },
    authorReady() { authorDetailReady = true; },
    beginCleanup() { cleaning = true; expected = 'delete'; },
    get workflowId() { return workflowId; },
    get reason() { return stopped; },
    get needsCleanup() { return !!workflowId && !writes.delete; },
    allow(actor, method, url, body) {
      const u = new URL(url);
      if (u.origin !== ORIGIN || u.username || u.password || u.hash) {
        this.stop('unexpected_target');
        return null;
      }
      if (day(Date.now()) !== budget.utc_day) {
        this.stop('budget_day_changed');
        return null;
      }
      if (stopped && !cleaning) return null;
      const path = u.pathname;
      const password = path === TOKEN && u.search === '?grant_type=password';
      const listing = path === LIST && u.searchParams.get('status') === 'eq.published';
      const detail = DETAILS.includes(path) && !!workflowId
        && u.searchParams.get('workflow_id') === `eq.${workflowId}`;
      const edge = path === EDGE && !u.search;
      let action;
      if (method === 'POST' && edge) {
        action = body?.action === 'like' ? (body.liked === true ? 'like' : 'unlike')
          : body?.action === 'status' ? 'delete' : body?.action;
        const valid = action === 'publish'
          ? actor === 'a' && !('workflow_id' in body) && !('expected_version' in body)
            && body.title === title && digest(body.payload) === previewHash
          : action === 'delete'
            ? actor === 'a' && body.action === 'status' && body.status === 'deleted'
            : actor === 'b' && body?.action === 'like' && typeof body.liked === 'boolean';
        if (!valid || !actions.includes(action) || action !== expected || writes[action]
          || (action !== 'publish' && (!workflowId || body.workflow_id !== workflowId))) {
          this.stop('unexpected_write');
          return null;
        }
      } else if (!((method === 'GET' && (listing || detail))
        || (method === 'POST' && password && !logins.has(actor))
        || (method === 'OPTIONS' && (listing || detail || password || edge)))) {
        this.stop('unexpected_request');
        return null;
      }
      // During cleanup, only A's public list and delete can reach the project.
      if (cleaning && !(actor === 'a' && (listing || (edge && (action === 'delete' || method === 'OPTIONS'))))) return null;
      const deleting = actor === 'a' && edge && expected === 'delete';
      const cap = deleting || writes.delete ? LIMIT : cleaning || authorDetailReady ? LIMIT - 2 : LIMIT - 4;
      if (sent.length >= cap) {
        this.stop('request_cap');
        return null;
      }
      if (action && !cleaning && Date.now() - budget.observed_epoch * 1000 > BUDGET_MAX_AGE - CLOCK_SKEW) {
        this.stop('stale_budget');
        return null;
      }
      if (method === 'POST' && password) logins.add(actor);
      const entry = { method, action, http: null };
      if (action) writes[action] = entry;
      sent.push(entry);
      return entry;
    },
    response(entry, status, listing) {
      entry.http = status;
      if (entry.action === 'publish' && status >= 200 && status < 300) {
        if (listing?.title === title && listing.status === 'published'
          && listing.current_version === 1 && UUID.test(listing.id) && listing.id !== OLD) {
          workflowId = listing.id;
        } else this.stop('invalid_publish_result');
      }
      if (status < 200 || status >= 300) this.stop('http_error');
    },
    result() {
      return { requests: sent.length, options: sent.filter((r) => r.method === 'OPTIONS').length,
        maxRequests: LIMIT, workflowId: workflowId ?? null,
        actions: Object.fromEntries(actions.map((action) => [action, writes[action]
          ? { attempted: true, http: writes[action].http } : { attempted: false }])) };
    },
  };
}

async function intercept(context, page, actor, gate, fixture) {
  // Bound each browser fetch including its native preflight. Reject automatic
  // view telemetry locally, before it can emit even an OPTIONS request.
  await context.addInitScript(({ origin, edge, timeout }) => {
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      if (String(input) === origin + edge && typeof init?.body === 'string') {
        const body = JSON.parse(init.body);
        if (body.action === 'event') return Promise.reject(new TypeError('Live test excludes telemetry'));
      }
      const signal = AbortSignal.timeout(timeout);
      return originalFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
    };
  }, { origin: ORIGIN, edge: EDGE, timeout: TIMEOUT });

  // Unlike the page-level Playwright route, this intercepts native preflights
  // and can stop redirects before following them. No credentials are inspected.
  const cdp = await context.newCDPSession(page);
  const pending = new Map();
  const inFlight = new Set();
  await cdp.send('Network.enable');
  cdp.on('Network.loadingFinished', ({ requestId }) => inFlight.delete(requestId));
  cdp.on('Network.loadingFailed', ({ requestId }) => {
    if (inFlight.delete(requestId)) gate.stop('transport_failed');
  });
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  cdp.on('Fetch.requestPaused', async (event) => {
    const { requestId, request, responseStatusCode, responseErrorReason } = event;
    const send = (method, params = {}) => cdp.send(`Fetch.${method}`, { requestId, ...params });
    const deny = () => send('failRequest', { errorReason: 'BlockedByClient' });
    try {
      if (responseStatusCode !== undefined || responseErrorReason) {
        const entry = pending.get(requestId);
        if (!entry) return await deny();
        pending.delete(requestId);
        let listing;
        if (entry.action === 'publish' && responseStatusCode >= 200 && responseStatusCode < 300) {
          const result = await send('getResponseBody');
          listing = JSON.parse(result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body);
        }
        gate.response(entry, responseStatusCode ?? null, listing);
        if (!responseStatusCode || (responseStatusCode >= 300 && responseStatusCode < 400)) return await deny();
        return await send('continueResponse');
      }
      const url = new URL(request.url);
      if (url.origin === SITE && request.method === 'GET') return await send('continueRequest').catch(() => {});
      const body = url.origin === ORIGIN && url.pathname === EDGE && request.method === 'POST'
        ? JSON.parse(request.postData || '{}') : undefined;
      const entry = gate.allow(actor, request.method, request.url, body);
      if (!entry) return await deny();
      if (event.networkId) inFlight.add(event.networkId);
      if (fixture) {
        const { status, data } = fixture({ actor, method: request.method, url, body });
        gate.response(entry, status, data);
        const requestedHeaders = Object.entries(request.headers)
          .find(([name]) => name.toLowerCase() === 'access-control-request-headers')?.[1];
        return await send('fulfillRequest', {
          responseCode: status,
          responseHeaders: Object.entries({
            'Access-Control-Allow-Origin': SITE,
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': requestedHeaders || 'authorization,apikey,content-type,x-client-info',
            'Content-Type': 'application/json',
          }).map(([name, value]) => ({ name, value })),
          body: status === 204 ? '' : Buffer.from(JSON.stringify(data)).toString('base64'),
        });
      }
      pending.set(requestId, entry);
      await send('continueRequest', { interceptResponse: true });
    } catch {
      gate.stop('interceptor_error');
      await deny().catch(() => {});
    }
  });
  page.on('pageerror', () => gate.stop('page_error'));
}

export async function runJourney({ budget, accounts, key, fixture }) {
  const title = `M3 UI synthetic ${randomUUID()}`;
  const gate = createGate({ title, budget });
  let at = 'preflight', status = 'BLOCKED', cleanup = 'NOT_NEEDED';
  let server, browser, a, b, previewBytes;
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  const card = (page) => page.locator('.community-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const detail = (page) => page.getByRole('region', { name: '社区方案详情', exact: true });
  const check = expect.configure({ timeout: TIMEOUT });
  const loaded = (page) => check(page.locator('.community-grid')).toHaveAttribute('aria-busy', 'false');
  const healthy = async (page) => {
    await check(page.getByRole('alert')).toHaveCount(0);
    if (gate.reason) throw new Error('Network guard stopped');
  };
  async function login(page, account) {
    await healthy(page);
    await page.getByLabel('社区登录邮箱').fill(account.email);
    await page.getByLabel('社区登录密码').fill(account.password);
    await button(page, '邮箱密码登录').click();
    await check(button(page, '退出登录')).toBeVisible();
    await loaded(page);
    await healthy(page);
  }
  async function open(page) {
    await card(page).click();
    await check(detail(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
    await check(detail(page)).toContainText(/作者\s+\S.+ · 当前 v1/);
    await check(button(page, '下载并预览 v1')).toBeVisible();
  }
  async function remove() {
    await button(a, '删除方案（软删除）').click();
    await check(detail(a)).toHaveCount(0);
  }
  try {
    const reason = preflight(budget, accounts);
    if (reason || !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key)) {
      gate.stop(reason || 'publishable_key_unavailable');
      throw new Error('Preflight blocked');
    }
    at = 'local_runtime';
    // Production React avoids development-only StrictMode remount requests.
    process.env.NODE_ENV = 'production';
    process.env.GLYPHFORGE_BASE = '/';
    process.env.VITE_SUPABASE_URL = ORIGIN;
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = key;
    const { createServer } = await import('vite');
    server = await createServer({ cacheDir: 'node_modules/.vite-m3-ui-business', logLevel: 'silent',
      server: { host: '127.0.0.1', port: 5173, strictPort: true, headers: {
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
          + "img-src 'self' data:; worker-src 'self' blob:; connect-src 'self' " + ORIGIN,
      } } });
    await server.listen();
    browser = await chromium.launch();
    async function pageFor(actor) {
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false,
        viewport: { width: 1280, height: 900 } });
      context.setDefaultTimeout(TIMEOUT);
      context.setDefaultNavigationTimeout(TIMEOUT);
      const page = await context.newPage();
      await intercept(context, page, actor, gate, fixture);
      await page.goto(SITE);
      return page;
    }

    at = 'workshop_import';
    a = await pageFor('a');
    const workshopName = a.getByLabel('工作流名称');
    await check(workshopName).toBeVisible();
    const payload = syntheticPayload();
    payload.workflow.id = 'm3-ui-synthetic';
    payload.workflow.name = title;
    await a.locator('input[type=file][accept=".json"]').setInputFiles({
      name: 'synthetic.workflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)),
    });
    await check(a.getByText('工作流与依赖已恢复，可以重新运行', { exact: true })).toBeVisible();
    await check(workshopName).toHaveValue(title + ' · 导入');
    b = await pageFor('b');
    await check(b.getByLabel('工作流名称')).toBeVisible();

    at = 'author_login';
    await button(a, '社区广场').click();
    await loaded(a);
    await login(a, accounts.a);
    at = 'publish_preview';
    await button(a, '发布当前工作流').click();
    const panel = a.getByRole('region', { name: '发布社区方案' });
    await check(panel).toContainText('收藏、历史和无关资源不会加入');
    await check(panel).toContainText(title);
    await panel.getByLabel('发布标题').fill(title);
    await panel.getByRole('checkbox', { name: /合成词表/ }).check();
    await button(a, '生成公开内容预览').click();
    const pre = panel.getByLabel('公开内容完整预览');
    await check(pre).toBeVisible();
    const preview = await pre.textContent();
    const snapshot = JSON.parse(preview);
    validateCommunityPayload(snapshot);
    previewBytes = Buffer.byteLength(preview);
    if (snapshot.workflow.name !== title + ' · 导入' || snapshot.workflow.nodes.length !== 2
      || snapshot.resources.length !== 1 || JSON.stringify(snapshot.resources[0].entries) !== '["合成","验收"]'
      || previewBytes > 4096) throw new Error('Synthetic snapshot mismatch');
    await check(panel).toContainText(`公开内容 ${previewBytes} 字节`);
    await healthy(a);

    at = 'publish';
    gate.arm('publish', digest(snapshot));
    await button(a, '确认公开发布').click();
    await check(panel).toHaveCount(0);
    await check(card(a)).toContainText('v1');
    await healthy(a);
    if (!gate.workflowId) throw new Error('Missing workflow');
    at = 'author_detail';
    await open(a);
    await check(button(a, '删除方案（软删除）')).toBeVisible();
    gate.authorReady();
    const authorLine = await detail(a).getByText(/^作者 /).textContent();
    const author = authorLine.split(' · 当前 v1')[0];

    at = 'reader_login';
    await button(b, '社区广场').click();
    await loaded(b);
    await login(b, accounts.b);
    at = 'reader_detail';
    await open(b);
    await check(detail(b)).toContainText(author);
    await check(button(b, '删除方案（软删除）')).toHaveCount(0);
    await healthy(b);

    at = 'like';
    gate.arm('like');
    await button(b, '点赞').click();
    await check(button(b, '撤销点赞')).toHaveAttribute('aria-pressed', 'true');
    await check(detail(b)).toContainText('点赞 1');
    await healthy(b);
    at = 'unlike';
    gate.arm('unlike');
    await button(b, '撤销点赞').click();
    await check(button(b, '点赞')).toHaveAttribute('aria-pressed', 'false');
    await check(detail(b)).toContainText('点赞 0');
    await healthy(b);

    at = 'delete';
    gate.arm('delete');
    await remove();
    await healthy(a);
    at = 'reader_refresh';
    await button(b, '关闭详情').click();
    await button(b, '刷新统计').click();
    await loaded(b);
    await check(card(b)).toHaveCount(0);
    await healthy(b);
    cleanup = 'UI_CONFIRMED_DB_PENDING';
    status = 'PASS_UI_DB_PENDING';
  } catch {
    status = gate.result().actions.publish.attempted ? 'FAIL' : 'BLOCKED';
  } finally {
    if (gate.needsCleanup && a) {
      gate.beginCleanup();
      try {
        if (!(await button(a, '删除方案（软删除）').count())) {
          if (!(await card(a).count())) {
            if (await button(a, '取消发布').count()) await button(a, '取消发布').click();
            await button(a, '刷新统计').click();
            await loaded(a);
          }
          await card(a).click();
        }
        await remove();
        cleanup = 'UI_CONFIRMED_DB_PENDING';
      } catch { cleanup = 'UNCONFIRMED'; }
    } else if (gate.result().actions.publish.attempted && cleanup === 'NOT_NEEDED') {
      cleanup = 'UNCONFIRMED';
    }
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }
  return { target: REF, status, at, reason: gate.reason ?? null, title, previewBytes,
    cleanup, ...gate.result() };
}

async function main() {
  try {
    if (process.argv.length !== 3 || ['DEBUG', 'PWDEBUG', 'NODE_DEBUG', 'NODE_OPTIONS'].some((key) => process.env[key])) throw new Error();
    const budget = JSON.parse(await readFile(process.argv[2], 'utf8'));
    if (budget?.target !== REF) throw new Error();
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 8192) throw new Error();
    }
    const accounts = JSON.parse(raw);
    raw = '';
    const reason = preflight(budget, accounts);
    if (reason) {
      console.log(JSON.stringify({ target: REF, status: 'BLOCKED', reason, requests: 0 }));
      return 2;
    }
    const key = execFileSync('wsl.exe', ['--exec', 'bash', '-lc',
      'cat "$HOME/.cache/glyphforge-m3-auth-smoke/publishable_key"'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: TIMEOUT }).trim();
    const result = await runJourney({ budget, accounts, key });
    console.log(JSON.stringify(result));
    return result.status === 'PASS_UI_DB_PENDING' ? 0 : 2;
  } catch {
    console.log(JSON.stringify({ target: REF, status: 'BLOCKED', reason: 'launcher_input_or_public_key', requests: 0 }));
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
