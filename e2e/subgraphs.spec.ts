import { openEditor, reloadEditor, enterEditor } from "./editor-steps";
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
test.beforeAll(() => { execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "e2e/subgraphs.vite.config.ts"], { stdio: "pipe" }); });

test("empty definition, copy and cross-workflow reuse survive reload", async ({ page }) => {
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: "子图与函数", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "子图与可复用函数" });
  await panel.getByRole("button", { name: "新建空子图", exact: true }).click();
  await panel.getByLabel("子图名称").fill("从空图开始");
  await panel.getByRole("button", { name: "添加内部节点", exact: true }).click();
  await panel.locator(".node-library button").filter({ hasText: "词库输入" }).click();
  await panel.getByRole("button", { name: "保存子图并返回", exact: true }).click();
  await expect(panel.getByText(/子图已保存/)).toBeVisible();
  await panel.getByRole("button", { name: "复制定义", exact: true }).click();
  await panel.getByLabel("子图名称").fill("从空图复制");
  await panel.getByRole("button", { name: "保存子图并返回", exact: true }).click();
  await panel.getByRole("button", { name: /返回主图/ }).click();
  await page.getByRole("button", { name: "镜像文字实验", exact: true }).click();
  await page.getByRole("button", { name: "子图与函数", exact: true }).click();
  await panel.locator("article").filter({ has: page.getByText("从空图开始 · v1", { exact: true }) }).getByRole("button", { name: "复用此函数", exact: true }).click();
  await panel.getByRole("button", { name: /返回主图/ }).click();
  await page.locator(".react-flow__node").last().click(); await page.getByRole("button", { name: "连接到结果输出", exact: true }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.locator(".candidate-name").first()).toBeVisible();
  const first = await page.locator(".candidate-text").first().innerText();
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible(); await reloadEditor(page);
  // Bootstrap automatically runs. Wait for its committed result before manually
  // rerunning; otherwise the same toolbar button can become Stop during click.
  await expect(page.locator(".candidate-text").first()).toHaveText(first);
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.locator(".candidate-text").first()).toHaveText(first);
});

test("canvas extraction, parameter editing, execution, favorites and durable reload", async ({ page }) => {
  test.setTimeout(90000); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.locator('.react-flow__node[data-id="mix"]').click(); await page.locator('.react-flow__node[data-id="check"]').click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "子图与函数", exact: true }).click(); const panel = page.getByRole("dialog", { name: "子图与可复用函数" });
  await panel.getByRole("button", { name: /封装所选节点/ }).click(); await expect(panel.getByLabel("子图名称")).toBeVisible();
  await panel.getByLabel("子图名称").fill("浏览器命名函数");
  await panel.locator('.react-flow__node[data-id="check"]').click();
  await panel.getByRole("button", { name: "添加内部节点", exact: true }).click(); await panel.locator(".node-library button").filter({ hasText: "添加前缀" }).click();
  const prefixId = await panel.locator('.react-flow__node').last().getAttribute("data-id");
  await panel.getByLabel("子图返回节点").selectOption(prefixId!); await panel.getByLabel("暴露节点参数").selectOption("text"); await panel.getByLabel("新增参数名称").fill("tag"); await panel.getByRole("button", { name: "暴露为输入参数", exact: true }).click();
  await panel.getByLabel("默认值 tag", { exact: true }).fill("星");
  await panel.getByRole("button", { name: "保存子图并返回", exact: true }).click(); await expect(panel.getByText(/子图已保存/)).toBeVisible();
  await page.screenshot({ path: "docs/p2-a/subgraph-library.png", fullPage: true });
  await panel.getByRole("button", { name: "返回主图", exact: false }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.locator(".candidate-name").first()).toContainText("星");
  await page.getByLabel("筛选生成结果").fill("星"); await page.getByTitle("收藏名字", { exact: true }).first().click();
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible(); await reloadEditor(page);
  await expect(page.locator('.forge-node').filter({ hasText: "浏览器命名函数" })).toBeVisible();
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.locator(".candidate-name").first()).toContainText("星");
  await page.emulateMedia({ reducedMotion: "reduce" }); await expect(page.locator(".results-viewport")).toHaveClass(/motion-disabled/);
  await page.getByRole("button", { name: "子图与函数", exact: true }).click(); await panel.getByRole("button", { name: "添加调用", exact: true }).last().click(); await panel.getByRole("button", { name: "返回主图", exact: false }).click();
  await page.locator('.react-flow__node').last().click(); await page.getByLabel("调用序列 input1").selectOption("a"); await page.getByLabel("调用序列 input2").selectOption("b"); await page.getByLabel("调用参数 tag").fill("月"); await page.getByRole("button", { name: "连接到结果输出", exact: true }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.locator(".candidate-name").first()).toContainText("月"); expect(errors).toEqual([]);
  await page.screenshot({ path: "docs/p2-a/subgraph-calls.png", fullPage: true });
  await page.getByRole("button", { name: "NameScript", exact: true }).click();
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible();
  // CodeMirror virtualizes its DOM; obtain the complete saved IR instead of
  // treating only the rendered editor lines as the full source document.
  const code = await page.evaluate(async () => { const h = await import("/subgraphs-harness/subgraphs.js"); return h.toScript(await h.db.workflows.get(localStorage.getItem("glyphforge-active"))); });
  expect(code).toContain("fn f"); expect(code).toContain('"月"');
  await page.locator(".cm-content").fill(code.replace('"月"', '"光"'));
  await page.getByRole("button", { name: "应用到节点", exact: true }).click();
  await expect(page.locator(".code-error")).toHaveCount(0);
  await page.getByRole("button", { name: "节点画布", exact: true }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.locator(".candidate-name").first()).toContainText("光");
});

test("production Worker inherits nested budgets, retains sources and terminates with partial results", async ({ page }) => {
  test.setTimeout(90000); const url = "/assets/" + readdirSync("dist/assets").find(n => /^execution\.worker-.*\.js$/.test(n)); await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  const report = await page.evaluate(async url => {
    const h = await import("/subgraphs-harness/subgraphs.js");
    const w = h.createWorkflow(); const extracted = h.extractSubgraph(w, ["a", "b", "mix", "check"]); const inner = extracted.definition;
    let workflow = extracted.workflow;
    // Nested wrapper shares the same engine state and resource reader.
    const wrapper = { ...structuredClone(inner), id: "nested-wrapper", nodes: [structuredClone(extracted.call)], output: extracted.call.id };
    workflow.subgraphs.push(wrapper); workflow.nodes.find((n: any) => n.op === "call").call.definitionId = wrapper.id;
    const run = (workflow: any, cancel = false): Promise<any> => new Promise((resolve, reject) => {
      const worker = new Worker(url, { type: "module" }); let count = 0; const examples: any[] = []; const started = performance.now(); const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Worker did not finish")); }, 18000);
      worker.onerror = e => { clearTimeout(timeout); worker.terminate(); reject(new Error(e.message)); };
      worker.onmessage = async ({ data }) => {
        if (data.type === "batch") { count += data.batch.length; if (!examples.length) examples.push(...data.batch.slice(0, 3).map(({text, parts, notes, pair, members}: any) => ({text, parts, notes, pair, members}))); if (cancel) { worker.terminate(); clearTimeout(timeout); await h.finishRun(data.batch[0].runId, "cancelled", "测试主动取消"); resolve({ type: "cancelled", count, ms: performance.now() - started }); } }
        if (["done", "error"].includes(data.type)) { clearTimeout(timeout); worker.terminate(); resolve({ ...data, count, examples, ms: performance.now() - started }); }
      }; worker.postMessage(workflow);
    });
    const good = await run(workflow); const code = h.toScript(workflow); const rebuilt = await run(h.parseScript(code, workflow));
    const pkg = await h.exportPackage(workflow); const restored = await h.importPackage(pkg); const shared = await run(restored);
    await h.db.resources.add({ id: "big", name: "big", description: "", kind: "word", color: "green", count: 1000, version: 1, updatedAt: 0 }); await h.db.entries.bulkAdd(Array.from({ length: 1000 }, (_, i) => ({ resourceId: "big", text: `字${i}` })));
    inner.nodes.filter((n: any) => n.op === "resource").forEach((n: any) => n.params.resourceId = "big"); inner.nodes.find((n: any) => n.op === "filter").params = { maxLength: 1, includes: "", excludes: "" };
    const budget = await run(workflow); inner.nodes.find((n: any) => n.op === "filter").params.maxLength = 100; const cancelled = await run(workflow, true);
    return { good, rebuilt, shared, budget, cancelled, versions: (await h.db.runs.toArray()).map((r: any) => ({ status: r.status, versions: r.versions })) };
  }, url);
  expect(report.good.type).toBe("done"); expect(report.rebuilt.count).toBe(report.good.count); expect(report.shared.count).toBe(report.good.count); expect(report.budget.diagnostic.code).toBe("BUDGET"); expect(report.cancelled.type).toBe("cancelled"); expect(report.cancelled.count).toBeGreaterThanOrEqual(64);
  expect(report.rebuilt.examples).toEqual(report.good.examples); expect(report.shared.examples.map((c: any) => c.text)).toEqual(report.good.examples.map((c: any) => c.text));
  writeFileSync("docs/p2-a/worker.json", JSON.stringify(report, null, 2));
});

test("nested production Worker watchdog expires while a resource page is blocked", async ({ page }) => {
  test.setTimeout(40000);
  const url = "/assets/" + readdirSync("dist/assets").find(n => /^execution\.worker-.*\.js$/.test(n)); await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  const report = await page.evaluate(async url => {
    const h = await import("/subgraphs-harness/subgraphs.js");
    await h.db.resources.add({ id: "watchdog", name: "watchdog", kind: "word", description: "", color: "green", count: 5000, version: 1, updatedAt: 0 });
    await h.db.entries.bulkAdd(Array.from({ length: 5000 }, (_, i) => ({ resourceId: "watchdog", text: `词${i}` })));
    const base = h.createWorkflow(); base.nodes = [{ id: "r", op: "resource", inputs: [], params: { resourceId: "watchdog" } }, { id: "out", op: "output", inputs: ["r"], params: {} }]; base.limit = 10000;
    const w = h.extractSubgraph(base, ["r"]).workflow;
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return await new Promise<any>((resolve, reject) => {
      const worker = new Worker(url, { type: "module" }); let held = false, release = false, count = 0, runId = ""; const events: any[] = []; const started = performance.now();
      const timeout = setTimeout(() => { release = true; worker.terminate(); reject(new Error("watchdog failed: " + JSON.stringify(events))); }, 16000);
      worker.onmessage = async ({ data }) => {
        if (data.type === "started") runId = data.runId;
        events.push({ type: data.type, at: performance.now() - started });
        if (data.type === "batch") {
          count += data.batch.length;
          if (!held) { held = true; const tx = database.transaction("entries", "readwrite"); const pump = () => { tx.objectStore("entries").get(-1).onsuccess = () => { if (!release) pump(); }; }; pump(); }
        }
        if (["done", "error"].includes(data.type)) { release = true; clearTimeout(timeout); worker.terminate(); await h.finishRun(runId, "error", data.message); const record = await h.db.runs.orderBy("createdAt").last(); database.close(); resolve({ ...data, count, elapsed: performance.now() - started, status: record.status, events }); }
      }; worker.onerror = e => { release = true; clearTimeout(timeout); worker.terminate(); reject(new Error(e.message)); }; worker.postMessage(w);
    });
  }, url);
  expect(report.type).toBe("error"); expect(report.status).toBe("error"); expect(report.diagnostic.code).toBe("BUDGET"); expect(report.elapsed).toBeGreaterThanOrEqual(9500); expect(report.elapsed).toBeLessThan(15000); expect(report.count).toBeGreaterThanOrEqual(64);
  writeFileSync("docs/p2-a/watchdog.json", JSON.stringify(report, null, 2));
});
