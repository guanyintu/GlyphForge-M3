import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";

test.beforeAll(() => { execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "e2e/contracts.vite.config.ts"], { stdio: "pipe" }); });
const assets = () => Object.fromEntries(["execution", "lab"].map(prefix => [prefix, "/assets/" + readdirSync("dist/assets").find(n => n.startsWith(prefix + ".worker-") && n.endsWith(".js"))]));

test("a delayed old autosave cannot replace the selected workflow on reload", async ({ page }) => {
  await page.goto("/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const state = (window as any).__slowWorkflowSave = { release: false, queued: false };
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: any, ...keys: any[]) {
      if (this.name === "workflows" && value.name === "延迟旧工作流") state.queued = true;
      return original.apply(this, [value, ...keys] as [any, IDBValidKey]);
    };
    const transaction = database.transaction("workflows", "readwrite");
    const pump = () => { transaction.objectStore("workflows").get("__test_block__").onsuccess = () => { if (!state.release) pump(); }; };
    pump(); transaction.oncomplete = () => database.close();
  });
  await page.getByLabel("工作流名称").fill("延迟旧工作流");
  await expect.poll(() => page.evaluate(() => (window as any).__slowWorkflowSave.queued)).toBe(true);
  await page.getByTitle("选择配方").click(); await page.locator(".preset-card").filter({ hasText: "叠字的快乐" }).click();
  await expect(page.getByLabel("工作流名称")).toHaveValue("叠字的快乐");
  await page.evaluate(() => { (window as any).__slowWorkflowSave.release = true; });
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("工作流名称")).toHaveValue("叠字的快乐");
});

test("production execution/laboratory Workers and graph/code/AST share signatures", async ({ page }) => {
  test.setTimeout(90000);
  const urls = assets(); await page.goto(urls.execution);
  const report = await page.evaluate(async urls => {
    const h = await import("/contracts-harness/contracts.js");
    await h.db.resources.add({ id: "__lab__", name: "input", kind: "word", description: "", color: "green", count: 1, version: 1, updatedAt: 0 });
    await h.db.entries.add({ resourceId: "__lab__", text: "月" });
    const source = { text: "月", parts: [{ resourceId: "__lab__", text: "月", version: 1 }] };
    const run = (url: string, payload: unknown): Promise<any> => new Promise((resolve, reject) => {
      const worker = new Worker(url, { type: "module" }), rows: any[] = [];
      const timeout = setTimeout(() => { worker.terminate(); reject(new Error("worker timeout")); }, 20000);
      worker.onerror = e => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === "batch") rows.push(...data.batch);
        if (["done", "error"].includes(data.type)) { clearTimeout(timeout); worker.terminate(); resolve({ ...data, rows }); }
      };
      worker.postMessage(payload);
    });
    const summarize = (r: any) => r.rows.map(({ text, parts, notes, pair, members }: any) => ({ text, parts, notes, pair, members }));
    const reports = [];
    for (const [op, params] of [["pinyin", {}], ["hanconvert", { mode: "traditional" }], ["mapchars", { mapping: '{"月":["玥","鈅"]}', probability: 0.5 }], ["prefix", {}], ["reverse", {}], ["filter", {}]] as const) {
      const graph = h.labWorkflow(op, params, 42);
      const code = h.parseScript(h.toScript(graph), graph);
      const p = h.normalizeParams(op, params), signature = h.operatorContracts[op].ast;
      const expr = signature && `${op}(${signature.parameters.map((key: string | null) => key ? JSON.stringify(p[key]) : "x").join(", ")})`;
      const ast = signature && h.parseScript(`for x in @__lab__ { ${signature.result === "strings" ? `for y in ${expr} { emit(y); }` : `emit(${expr});`} }`, graph);
      const results = [];
      for (const w of [graph, code, ...(ast ? [ast] : [])]) results.push(await run(urls.execution, w));
      results.push(await run(urls.lab, { op, params, seed: 42, source: [source] }));
      if (results.some(r => r.type !== "done")) throw new Error(JSON.stringify(results));
      reports.push({ op, results: results.map(summarize), stats: results.map(r => r.stats) });
    }
    const invalid = await run(urls.lab, { op: "hanconvert", params: { probability: 2 }, seed: 42, source: [source] });
    const badAst = h.parseScript('let p = 2; for y in hanconvert("月", "traditional", p) { emit(y); }', h.createWorkflow());
    const invalidAst = await run(urls.execution, badAst);
    return { reports, invalid, invalidAst };
  }, urls);
  for (const r of report.reports) for (const rows of r.results) expect(rows).toEqual(r.results[0]);
  expect(report.invalid.diagnostic).toMatchObject({ code: "PARAMETER", operator: "hanconvert" });
  expect(report.invalidAst.diagnostic).toMatchObject({ code: "PARAMETER", operator: "hanconvert", line: 1, nodeId: "program" });
  writeFileSync("docs/p2-s0-2/worker-consistency.json", JSON.stringify(report, null, 2));
});

test("production Worker rejects empty ordinary/relation resources in graph, AST and template", async ({ page }) => {
  const urls = assets(); await page.goto(urls.execution);
  const reports = await page.evaluate(async urls => {
    const h = await import("/contracts-harness/contracts.js");
    await h.db.resources.bulkAdd(["word", "relation"].map(kind => ({ id: kind, kind, name: kind, description: "", color: "green", count: 0, version: 1, updatedAt: 0 })));
    const reports = [];
    for (const code of ['let a = pairs("word", "");\nlet out = output(a);', 'let a = resource("relation");\nlet out = output(a);', 'for p in pairs("word") { emit(left(p)); }', 'for x in @relation { emit(x); }', `let t = template(${Object.values({ ...h.operators.template.defaults, slots: '[{"name":"x","resourceId":"word","kind":"pair"}]', templates: '["{x.left}"]' }).map(v => JSON.stringify(v)).join(", ")});\nlet out = output(t);`]) {
      const w = h.parseScript(code, h.createWorkflow());
      const result: any = await new Promise((resolve, reject) => {
        const worker = new Worker(urls.execution, { type: "module" });
        const timeout = setTimeout(() => { worker.terminate(); reject(new Error("timeout")); }, 15000);
        worker.onmessage = ({ data }) => { if (["done", "error"].includes(data.type)) { clearTimeout(timeout); worker.terminate(); resolve(data); } };
        worker.onerror = e => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message)); };
        worker.postMessage(w);
      });
      const record = await h.db.runs.orderBy("createdAt").last();
      reports.push({ code, result, status: record.status });
    }
    return reports;
  }, urls);
  for (const r of reports) { expect(r.result).toMatchObject({ type: "error", diagnostic: { code: "TYPE" } }); expect(r.status).toBe("error"); }
  writeFileSync("docs/p2-s0-2/empty-resource-diagnostics.json", JSON.stringify(reports, null, 2));
});
