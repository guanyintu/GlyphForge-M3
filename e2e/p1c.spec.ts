import { openEditor, reloadEditor, enterEditor } from "./editor-steps";
import { test, expect } from "@playwright/test";
import { readdirSync } from "node:fs";

test("reverse UI separates provenance, opens exact resources and builds executable workflow", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: "逆向查找", exact: true }).click();
  await page.getByLabel("逆向查找名字").fill("月亮邮差X"); await page.getByRole("button", { name: "寻找线索" }).click();
  await expect(page.getByText("未找到可追溯生成记录", { exact: true })).toBeVisible();
  await expect(page.locator(".split-path").first()).toContainText("80%");
  await page.screenshot({ path: "docs/p1c/reverse-ui.png", fullPage: true });
  await page.locator(".match-row").filter({ has: page.getByText("月亮", { exact: true }) }).getByRole("button", { name: "查看资源" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑词库" }); await expect(dialog.getByLabel("编辑词条 月亮", { exact: true })).toBeVisible(); await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByLabel("逆向查找名字").fill("月亮邮差"); await page.getByRole("button", { name: "寻找线索" }).click();
  await expect(page.getByText("确定来源 · 存在真实生成记录")).toBeVisible();
  await page.locator(".split-path").first().getByRole("button").click();
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.locator(".candidate-name").first()).toContainText("月亮邮差");
  expect(errors).toEqual([]);
});

test("relation direction can be edited, persisted and queried without reversing slots", async ({ page }) => {
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: /^资源中心/ }).click(); await page.getByRole("button", { name: "新建关系词库", exact: true }).click();
  const d = page.getByRole("dialog", { name: "编辑关系词库" }); await d.getByLabel("左词 A").fill("寒"); await d.getByLabel("右词 B").fill("暑"); await d.getByLabel("关系方向").selectOption("directed"); await d.getByRole("button", { name: "添加词对", exact: true }).click();
  await d.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "逆向查找", exact: true }).click(); await page.getByLabel("逆向查找名字").fill("暑"); await page.getByRole("button", { name: "寻找线索" }).click(); await expect(page.getByText("未找到允许此方向查询的关系。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^资源中心/ }).click(); await page.getByRole("button", { name: /未命名关系词库/ }).click(); await d.getByRole("button", { name: "修改", exact: true }).click(); await d.getByLabel("关系方向").selectOption("symmetric"); await d.getByRole("button", { name: "保存修改", exact: true }).click(); await expect(d.locator(".relation-row")).toContainText("对称"); await d.getByRole("button", { name: "关闭", exact: true }).click();
  await reloadEditor(page); await page.getByRole("button", { name: "逆向查找", exact: true }).click(); await page.getByLabel("逆向查找名字").fill("暑"); await page.getByRole("button", { name: "寻找线索" }).click(); await expect(page.locator(".match-row").filter({ hasText: "寒 / 暑" })).toContainText("反向命中");
});

test("game rule presets are editable in the workbench and survive reload", async ({ page }) => {
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: "游戏规则检查", exact: true }).click(); const editor = page.locator(".game-rule-editor");
  await editor.getByLabel("规则名称", { exact: true }).fill("浏览器自定义规则"); await editor.getByLabel("可见字符簇数最大", { exact: true }).fill("3"); await editor.getByRole("button", { name: "保存规则预设", exact: true }).click(); await expect(editor.getByText("规则预设已保存")).toBeVisible(); await expect(page.locator(".game-check").first()).toContainText("不兼容");
  await page.screenshot({ path: "docs/p1c/game-ui.png", fullPage: true });
  await reloadEditor(page); await page.getByRole("button", { name: "游戏规则检查", exact: true }).click(); await editor.getByLabel("已保存的游戏规则", { exact: true }).selectOption({ label: "浏览器自定义规则" }); await expect(editor.getByLabel("可见字符簇数最大", { exact: true })).toHaveValue("3");
});

test("production reverse Worker: 100k indexed entries, batching, cache invalidation and active cancellation", async ({ page, browser }) => {
  test.setTimeout(90000);
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  const workerPath = `/assets/${readdirSync("dist/assets").find(n => /^reverse\.worker-.*\.js$/.test(n))!}`;
  const evidence = await page.evaluate(async ({ workerPath }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const started = performance.now();
    const before = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(["resources", "entries"], "readwrite"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      for (const id of ["large-a", "large-b"]) tx.objectStore("resources").put({ id, name: id, kind: "word", color: "green", description: "", count: 50001, version: 1, updatedAt: Date.now() });
      const entries = tx.objectStore("entries"); for (let i = 0; i < 100000; i++) entries.add({ resourceId: i % 2 ? "large-a" : "large-b", text: `词${i.toString().padStart(6, "0")}` });
      entries.add({ resourceId: "large-a", text: "月亮" }); entries.add({ resourceId: "large-b", text: "邮差" });
    });
    const loadMs = performance.now() - started, after = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    const worker = new Worker(workerPath, { type: "module" }); let id = 0, maxBatch = 0;
    async function query(input = "月亮邮差") {
      const began = performance.now();
      return await new Promise<{ duration: number; result: { matches: { text: string }[]; cacheHit: boolean; paths: { complete: boolean }[] } }>((resolve, reject) => {
        worker.onmessage = e => { if (e.data.type === "batch") maxBatch = Math.max(maxBatch, e.data.matches.length); if (e.data.type === "error") reject(new Error(e.data.message)); if (e.data.type === "done") resolve({ duration: performance.now() - began, result: e.data.result }); };
        worker.onerror = e => reject(new Error(e.message)); worker.postMessage({ id: ++id, input, options: { resourceIds: ["large-a", "large-b"] } });
      });
    }
    const cold = await query(), warm = await query(), deep = await query("词099999");
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(["entries", "resources"], "readwrite"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      const request = tx.objectStore("entries").index("[resourceId+text]").get(["large-a", "月亮"]); request.onsuccess = () => tx.objectStore("entries").put({ ...request.result, text: "太阳" });
      const meta = tx.objectStore("resources").get("large-a"); meta.onsuccess = () => tx.objectStore("resources").put({ ...meta.result, version: 2 });
    });
    const changed = await query();
    let messagesAfterCancel = 0, cancelledAfterScanned = 0;
    const cancelMs = await new Promise<number>((resolve, reject) => {
      worker.onmessage = e => { if (e.data.type === "progress" && e.data.phase === "pinyin") { cancelledAfterScanned = e.data.processed; const start = performance.now(); worker.terminate(); const elapsed = performance.now() - start; setTimeout(() => resolve(elapsed), 150); worker.onmessage = () => messagesAfterCancel++; } };
      worker.onerror = e => reject(new Error(e.message)); worker.postMessage({ id: ++id, input: "yueliang", options: { resourceIds: ["large-a", "large-b"], pinyin: true } });
    });
    database.close();
    return { entries: 100002, loadMs, coldMs: cold.duration, warmMs: warm.duration, cacheHit: warm.result.cacheHit, deepMs: deep.duration, deepMatches: deep.result.matches, maxBatch, coldMatches: cold.result.matches, complete: cold.result.paths[0].complete, changedMatches: changed.result.matches, changedCacheHit: changed.result.cacheHit, cancelMs, cancelledAfterScanned, messagesAfterCancel, mainThreadSampledHeapBefore: before, mainThreadSampledHeapAfter: after, userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
  }, { workerPath });
  expect(evidence.deepMatches.map(m => m.text)).toEqual(["词099999"]); expect(evidence.complete).toBe(true); expect(evidence.coldMatches.map(m => m.text).sort()).toEqual(["月亮", "邮差"]); expect(evidence.cacheHit).toBe(true); expect(evidence.maxBatch).toBeLessThanOrEqual(50); expect(evidence.changedMatches.map(m => m.text)).toEqual(["邮差"]); expect(evidence.changedCacheHit).toBe(false); expect(evidence.cancelledAfterScanned).toBeGreaterThanOrEqual(256); expect(evidence.messagesAfterCancel).toBe(0);
  console.log("P1C_BROWSER_BENCH", JSON.stringify({ ...evidence, browserVersion: browser.version() }));
});
