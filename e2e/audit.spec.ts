import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";
import { createWorkflow } from "../src/core/model";
import { parseScript } from "../src/core/script";

test("real UI: lab → saved resource → workflow and reload", async ({ page }) => {
  const errors: string[] = [];
  const heavyRequests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (/\/(decomposition|readings|strokes|cn2t|t2cn)-/.test(new URL(request.url()).pathname)) heavyRequests.push(request.url()); });
  await page.goto("/");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  expect(heavyRequests).toEqual([]);
  await page.getByRole("button", { name: "文字实验室", exact: true }).click();
  await page.getByLabel("实验室输入文字").fill("明\n思");
  await page.getByLabel("实验算子").selectOption("decompose");
  await page.getByRole("button", { name: "开始实验" }).click();
  await expect(page.locator(".lab-candidate b")).toHaveText(["日、月", "田、心"]);
  await page.getByRole("button", { name: "另存为新词库" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑词库" });
  await expect(dialog.getByLabel("编辑词条 日、月")).toBeVisible();
  await dialog.getByLabel("词库名称").fill("审计实验室资源");
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: /^资源中心/ }).click();
  await expect(page.getByRole("button", { name: /审计实验室资源/ })).toBeVisible();
  const resourceId = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); });
    try {
      return await new Promise<string>(resolve => {
        const r = database.transaction("resources").objectStore("resources").index("name").get("审计实验室资源");
        r.onsuccess = () => resolve(r.result.id);
      });
    } finally { database.close(); }
  });
  await page.getByRole("button", { name: "工作流工坊", exact: true }).click();
  const w = parseScript(`let words = resource(${JSON.stringify(resourceId)});\nlet result = output(words);`, createWorkflow());
  await page.locator('input[type="file"][accept=".json"]').setInputFiles({ name: "lab.workflow.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "glyphforge", version: 2, irVersion: 1, operatorVersions: { resource: 1, output: 1 }, workflow: w, resources: [], dependencies: [{ id: resourceId, name: "审计实验室资源", version: 2, kind: "word" }] })) });
  await expect(page.getByText("工作流与依赖已恢复，可以重新运行")).toBeVisible();
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect(page.locator(".candidate-name").filter({ hasText: "日、月" })).toBeVisible();
  await expect(page.locator(".candidate-name").filter({ hasText: "田、心" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("real UI: relation editor saves, edits, deletes and survives reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: /^资源中心/ }).click();
  await page.getByRole("button", { name: "新建关系词库", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "编辑关系词库" });
  await dialog.getByLabel("关系词库名称").fill("审计词对");
  await dialog.getByLabel("左词 A").fill("朝");
  await dialog.getByLabel("右词 B").fill("暮");
  await dialog.getByRole("button", { name: "添加词对", exact: true }).click();
  await expect(dialog.locator(".relation-row")).toHaveCount(1);
  await dialog.getByRole("button", { name: "修改", exact: true }).click();
  await dialog.getByLabel("左词 A").fill("清晨");
  await dialog.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(dialog.locator(".relation-row")).toContainText("清晨");
  await dialog.getByLabel("左词 A").fill("山");
  await dialog.getByLabel("右词 B").fill("海");
  await dialog.getByRole("button", { name: "添加词对", exact: true }).click();
  await expect(dialog.locator(".relation-row")).toHaveCount(2);
  await dialog.locator(".relation-row").filter({ hasText: "山" }).getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog.locator(".relation-row")).toHaveCount(1);
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /^资源中心/ }).click();
  await page.getByRole("button", { name: /审计词对/ }).click();
  await expect(dialog.locator(".relation-row")).toHaveCount(1);
  await expect(dialog.locator(".relation-row")).toContainText("清晨");
});

test("real IndexedDB: import and execute 10,000 relation rows", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  const assets = readdirSync("dist/assets");
  const resourceAsset = "/assets/" + assets.find(name => name.startsWith("resources.worker-") && name.endsWith(".js"));
  const executionAsset = "/assets/" + assets.find(name => name.startsWith("execution.worker-") && name.endsWith(".js"));
  const workflow = createWorkflow();
  workflow.nodes = [{ id: "pairs", op: "pairs", inputs: [], params: { resourceId: "audit-relations", relation: "couple" } }, { id: "result", op: "output", inputs: ["pairs"], params: {} }];
  workflow.limit = 10000; workflow.seed = 9999;
  const report = await page.evaluate(async ({ resourceAsset, executionAsset, workflow }) => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction("resources", "readwrite");
      tx.objectStore("resources").add({ id: "audit-relations", name: "审计关系基准", description: "", kind: "relation", color: "green", version: 1, count: 0, updatedAt: 0 });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    database.close();
    const rows = Array.from({ length: 10000 }, (_, i) => ({ left: `左${i}`, right: `右${i}`, relation: "couple" }));
    const start = performance.now();
    await new Promise<void>((resolve, reject) => {
      const worker = new Worker(resourceAsset, { type: "module" });
      worker.onmessage = ({ data }) => { worker.terminate(); if (data.type === "error") reject(new Error(data.message)); else resolve(); };
      worker.onerror = e => { worker.terminate(); reject(new Error(e.message)); };
      worker.postMessage({ type: "relationImport", resourceId: "audit-relations", text: JSON.stringify(rows), name: "benchmark.json", relation: "couple" });
    });
    const importMs = performance.now() - start;
    const runStart = performance.now();
    return await new Promise<{ importMs: number; runMs: number; count: number; maxBatch: number; correct: boolean }>((resolve, reject) => {
      const worker = new Worker(executionAsset, { type: "module" });
      let count = 0, maxBatch = 0, correct = true;
      worker.onmessage = ({ data }) => {
        if (data.type === "batch") {
          count += data.batch.length; maxBatch = Math.max(maxBatch, data.batch.length);
          correct &&= data.batch.every((c: { pair: { left: string; right: string } }) => c.pair.left.slice(1) === c.pair.right.slice(1));
        }
        if (data.type === "error") { worker.terminate(); reject(new Error(data.message)); }
        if (data.type === "done") { worker.terminate(); resolve({ importMs, runMs: performance.now() - runStart, count, maxBatch, correct }); }
      };
      worker.onerror = e => { worker.terminate(); reject(new Error(e.message)); };
      worker.postMessage(workflow);
    });
  }, { resourceAsset, executionAsset, workflow });
  expect(report.count).toBe(10000); expect(report.correct).toBe(true); expect(report.maxBatch).toBe(64);
  console.log("AUDIT_RELATION_10000", JSON.stringify(report));
});

test("real UI: editable relation recipe runs and persists", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByTitle("选择配方").click();
  await page.getByRole("button", { name: /情侣 ID/ }).click();
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect(page.locator(".candidate-name").filter({ hasText: "月亮邮差 / 星星收件人" })).toBeVisible();
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await expect(page.getByText("已保存到本地", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(".candidate-name").filter({ hasText: "月亮邮差 / 星星收件人" })).toBeVisible();
});

test("real UI: concurrent entry edits increment versions and refresh indexes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: /^资源中心/ }).click();
  await page.getByRole("button", { name: /小动物字库/ }).click();
  await expect(page.getByLabel("编辑词条 猫", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    for (const [oldText, text] of [["猫", "审计猫"], ["兔", "审计兔"]]) {
      const input = document.querySelector<HTMLInputElement>(`input[aria-label="编辑词条 ${oldText}"]`)!;
      input.value = text;
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    }
  });
  await expect(page.getByLabel("编辑词条 审计猫", { exact: true })).toBeVisible();
  await expect(page.getByLabel("编辑词条 审计兔", { exact: true })).toBeVisible();
  const version = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("glyphforge-v1");
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<number>((resolve, reject) => {
        const request = database.transaction("resources").objectStore("resources").get("animals");
        request.onsuccess = () => resolve(request.result.version); request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  });
  expect(version).toBe(3);
  await page.getByLabel("搜索词条", { exact: true }).fill("审计");
  await expect(page.locator(".entry-list input")).toHaveCount(2);
});

test("production Workers: bounded nested execution, persistence and hard cancellation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/生成完成/)).toBeVisible();
  const asset = "/assets/" + readdirSync("dist/assets").find(name => name.startsWith("execution.worker-") && name.endsWith(".js"));
  const bounded = parseScript('for a in range(0, 1000) { for b in range(0, 1000) { emit(text(a) + ":" + text(b)); } }', createWorkflow());
  bounded.limit = 1000;
  const report = await page.evaluate(async ({ asset, bounded }) => {
    const started = performance.now();
    return await new Promise<{ count: number; maxBatch: number; steps: number; milliseconds: number }>((resolve, reject) => {
      const worker = new Worker(asset, { type: "module" });
      let count = 0, maxBatch = 0;
      worker.onmessage = ({ data }) => {
        if (data.type === "batch") { count += data.batch.length; maxBatch = Math.max(maxBatch, data.batch.length); }
        if (data.type === "error") { worker.terminate(); reject(new Error(data.message)); }
        if (data.type === "done") { worker.terminate(); resolve({ count, maxBatch, steps: data.stats.steps, milliseconds: performance.now() - started }); }
      };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage(bounded);
    });
  }, { asset, bounded });
  expect(report.count).toBe(1000);
  expect(report.maxBatch).toBeLessThanOrEqual(64);
  console.log("AUDIT_BROWSER_WORKER", JSON.stringify(report));

  const long = parseScript('for a in range(0, 1000000) { for b in range(0, 1000000) { emit("same"); } }', createWorkflow());
  const cancelled = await page.evaluate(async ({ asset, long }) => {
    return await new Promise<{ steps: number; lateMessages: number; terminateMs: number }>((resolve, reject) => {
      const worker = new Worker(asset, { type: "module" });
      let stopped = false, lateMessages = 0;
      worker.onmessage = ({ data }) => {
        if (stopped) { lateMessages++; return; }
        if (data.type === "error" || data.type === "done") { worker.terminate(); reject(new Error("task completed before cancellation")); }
        if (data.type === "progress") {
          stopped = true;
          const start = performance.now(); worker.terminate();
          const terminateMs = performance.now() - start;
          setTimeout(() => resolve({ steps: data.steps, lateMessages, terminateMs }), 150);
        }
      };
      worker.postMessage(long);
    });
  }, { asset, long });
  expect(cancelled.steps).toBeGreaterThanOrEqual(1000);
  expect(cancelled.lateMessages).toBe(0);
  console.log("AUDIT_BROWSER_CANCEL", JSON.stringify(cancelled));
});
