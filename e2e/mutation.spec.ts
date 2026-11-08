import { openEditor, reloadEditor, enterEditor } from "./editor-steps";
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
test.beforeAll(() => { execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "e2e/mutation.vite.config.ts"], { stdio: "pipe" }); });
async function openFixture(page: import("@playwright/test").Page) {
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.evaluate(async () => { const h = await import("/mutation-harness/mutation.js"); await h.db.favorites.put({ text: "月月👩🏽‍💻星", parts: [{ resourceId: "nature", text: "月", version: 1 }], runId: "historical-source", workflowId: "historical-workflow", savedAt: Date.now(), seed: 42, pair: { left: "月", right: "星", relation: "couple" }, members: ["月", "星"] }); });
  await page.getByRole("button", { name: /^我的收藏/ }).click(); await page.getByRole("button", { name: "继续创作 月月👩🏽‍💻星", exact: true }).click();
  return page.getByRole("dialog", { name: "名字变异与继续创作" });
}
test("Unicode locks, deterministic rerun, dedup, rollback, copy/export and truthful favorites survive refresh", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]); const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const panel = await openFixture(page);
  for (const name of ["插入字符", "前后缀"]) await panel.getByLabel(name, { exact: true }).uncheck();
  await panel.getByRole("button", { name: "锁定位置 1 月", exact: true }).click(); await panel.getByRole("button", { name: "锁定位置 3 👩🏽‍💻", exact: true }).click();
  await panel.getByLabel("字符池", { exact: true }).fill("云夜"); await panel.getByLabel("变异数量", { exact: true }).fill("32");
  await panel.getByRole("button", { name: "生成变体", exact: true }).click(); await expect(panel.getByRole("button", { name: "生成变体", exact: true })).toBeEnabled();
  const first = await panel.locator(".candidate-text").allTextContents(); expect(first.length).toBe(4); expect(new Set(first).size).toBe(first.length); expect(first.every(s => s.startsWith("月") && s.includes("👩🏽‍💻"))).toBe(true); expect(first.some(s => !s.startsWith("月月"))).toBe(true);
  await panel.getByRole("button", { name: "生成变体", exact: true }).click(); await expect(panel.getByRole("button", { name: "生成变体", exact: true })).toBeEnabled(); expect(await panel.locator(".candidate-text").allTextContents()).toEqual(first);
  await panel.getByRole("button", { name: `复制 ${first[0]}`, exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first[0]);
  await panel.getByLabel("结果导出格式").selectOption("json"); const downloading = page.waitForEvent("download"); await panel.getByRole("button", { name: "导出", exact: true }).click(); const path = await (await downloading).path(); const exported = JSON.parse(readFileSync(path!, "utf8")); expect(exported.version).toBe(1); expect(exported.entries[0].derivation.kind).toBe("mutation"); expect(exported.entries[0].pair).toBeUndefined(); expect(exported.entries[0].members).toBeUndefined();
  await panel.getByRole("button", { name: `收藏 ${first[0]}`, exact: true }).click(); await expect(panel.getByRole("button", { name: `收藏 ${first[0]}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: `继续创作 ${first[0]}`, exact: true }).click(); await expect(panel.locator(".mutation-source strong")).toHaveText(first[0]); await panel.getByRole("button", { name: "生成变体", exact: true }).click(); await expect(panel.getByRole("button", { name: "生成变体", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "回退上一轮", exact: true }).click(); await expect(panel.locator(".mutation-source strong")).toHaveText("月月👩🏽‍💻星"); expect(await panel.locator(".candidate-text").allTextContents()).toEqual(first); await expect(panel.getByRole("button", { name: "锁定位置 1 月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: "docs/p2-b/mutation-locks.png", fullPage: true }); await panel.getByRole("button", { name: "关闭变异器", exact: true }).click(); await reloadEditor(page); await page.getByRole("button", { name: /^我的收藏/ }).click(); await page.getByRole("button", { name: `继续创作 ${first[0]}`, exact: true }).click();
  await expect(panel.locator(".mutation-source strong")).toHaveText(first[0]); await panel.getByRole("button", { name: "生成变体", exact: true }).click(); await expect(panel.locator(".candidate-text").first()).toBeVisible(); await expect(panel.getByRole("button", { name: "生成变体", exact: true })).toBeEnabled();
  const record = await page.evaluate(async () => { const h = await import("/mutation-harness/mutation.js"); return (await h.db.generated.toArray()).filter((x: any) => x.derivation?.round === 2)[0]; }); expect(record.derivation.parent.text).toBe(first[0]); expect(record.derivation.parent.runId).not.toBe("historical-source"); expect(errors).toEqual([]);
  await panel.locator(".candidate-name").first().click(); await expect(page.getByRole("dialog", { name: "名字来源" })).toContainText("名字变异衍生 · 不是原工作流产出");
});

test("saved mutation words flow through real P2-A UI subgraph and production Worker", async ({ page }) => {
  const panel = await openFixture(page); await panel.getByLabel("变异数量", { exact: true }).fill("12"); await panel.getByRole("button", { name: "生成变体", exact: true }).click(); await expect(panel.locator(".candidate-text").first()).toBeVisible(); await expect(panel.getByRole("button", { name: "生成变体", exact: true })).toBeEnabled();
  const names = await page.evaluate(async () => { const h = await import("/mutation-harness/mutation.js"); const run = await h.db.runs.orderBy("createdAt").last(); return (await h.db.generated.where("runId").equals(run.id).toArray()).map((c: any) => c.text); });
  await panel.getByRole("button", { name: "存为词库", exact: true }).click(); const resource = page.getByRole("dialog", { name: "编辑词库" }); await resource.getByLabel("词库名称", { exact: true }).fill("变异结果再创作"); await resource.getByRole("button", { name: "关闭", exact: true }).click(); await panel.getByRole("button", { name: "关闭变异器", exact: true }).click();
  await page.getByRole("button", { name: "工作流工坊", exact: true }).click(); await page.getByRole("button", { name: "子图与函数", exact: true }).click(); const sub = page.getByRole("dialog", { name: "子图与可复用函数" }); await sub.getByRole("button", { name: "新建空子图", exact: true }).click(); await sub.getByLabel("子图名称").fill("变异库复用"); await sub.getByRole("button", { name: "添加内部节点", exact: true }).click(); await sub.locator(".node-library button").filter({ hasText: "词库输入" }).click();
  const id = await page.evaluate(async () => { const h = await import("/mutation-harness/mutation.js"); return (await h.db.resources.where("name").equals("变异结果再创作").first()).id; });
  await sub.locator('select').filter({ has: page.locator(`option[value="${id}"]`) }).selectOption(id);
  await sub.getByRole("button", { name: "保存子图并返回", exact: true }).click(); await sub.getByRole("button", { name: "添加调用", exact: true }).last().click(); await sub.getByRole("button", { name: /返回主图/ }).click(); await page.locator(".react-flow__node").last().click(); await page.getByRole("button", { name: "连接到结果输出", exact: true }).click(); await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.getByText(/生成完成/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^运行工作流/ })).toBeEnabled();
  const actual = await page.evaluate(async () => { const h = await import("/mutation-harness/mutation.js"); const run = await h.db.runs.orderBy("createdAt").last(); return (await h.db.generated.where("runId").equals(run.id).toArray()).map((c: any) => c.text); }); expect(new Set(actual)).toEqual(new Set(names)); expect((await page.locator(".candidate-text").allTextContents()).every(s => names.includes(s))).toBe(true); await page.screenshot({ path: "docs/p2-b/subgraph-reuse.png", fullPage: true });
});

test("cancel terminates blocked mutation Worker and persists cancelled state", async ({ page }) => {
  const panel = await openFixture(page); await panel.getByLabel("词库替换", { exact: true }).check(); await panel.getByLabel("替换词库", { exact: true }).selectOption("nature");
  await page.evaluate(async () => { const h = await import("/mutation-harness/mutation.js"); const w = window as any; w.blockReady = new Promise(resolve => { w.blocked = h.db.transaction("rw", h.db.entries, async () => { resolve(true); await h.db.constructor.waitFor(new Promise(r => w.unblock = r)); }); }); await w.blockReady; });
  await panel.getByRole("button", { name: "生成变体", exact: true }).click(); await expect(panel.getByRole("button", { name: "取消变异", exact: true })).toBeEnabled(); await panel.getByRole("button", { name: "取消变异", exact: true }).click(); await expect(panel.getByRole("button", { name: "生成变体", exact: true })).toBeEnabled();
  await page.evaluate(async () => { (window as any).unblock(); await (window as any).blocked; });
  await expect.poll(() => page.evaluate(async () => { const h = await import("/mutation-harness/mutation.js"); return (await h.db.runs.toArray()).filter((r: any) => r.workflow.nodes.some((n: any) => n.op === "mutate")).at(-1)?.status; })).toBe("cancelled"); expect(await panel.locator(".candidate-text").count()).toBe(0);
});

test("production mutation Worker repeats seed/resources and portable package without stale Pair or members", async ({ page }) => {
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible(); const url = "/assets/" + readdirSync("dist/assets").find(s => /^execution\.worker-.*\.js$/.test(s));
  const report = await page.evaluate(async url => {
    const h = await import("/mutation-harness/mutation.js"); const w = h.mutationWorkflow({ text: "月月👩‍💻星", parts: [{ text: "月", resourceId: "nature", version: 1 }], runId: "old", workflowId: "old", pair: { left: "月", right: "星", relation: "couple" }, members: ["月", "星"] }, { locks: "[0,2]", operations: '["dictionary","homophone","martian","reorder"]', resourceId: "nature", intensity: 3, count: 128 }, 84);
    function run(workflow: any): Promise<any> { return new Promise((resolve, reject) => { const worker = new Worker(url, { type: "module" }), rows: any[] = []; const timeout = setTimeout(() => { worker.terminate(); reject(new Error("timeout")); }, 16000); worker.onerror = e => reject(new Error(e.message)); worker.onmessage = ({ data }) => { if (data.type === "batch") rows.push(...data.batch); if (["done", "error"].includes(data.type)) { clearTimeout(timeout); worker.terminate(); resolve({ ...data, rows }); } }; worker.postMessage(workflow); }); }
    const a = await run(w), b = await run(w), restored = await h.importPackage(await h.exportPackage(w)), portable = await run(restored); return { a, b, portable };
  }, url);
  expect(report.a.type).toBe("done"); expect(report.b.type).toBe("done"); expect(report.portable.type).toBe("done"); const values = (r: any) => r.rows.map(({ text, parts, derivation }: any) => ({ text, parts, derivation })); expect(values(report.b)).toEqual(values(report.a)); expect(report.portable.rows.map((x: any) => x.text)).toEqual(report.a.rows.map((x: any) => x.text));
  expect(report.a.rows.length).toBeGreaterThan(0); expect(new Set(report.a.rows.map((x: any) => x.text)).size).toBe(report.a.rows.length); for (const c of report.a.rows) { expect(c.pair).toBeUndefined(); expect(c.members).toBeUndefined(); expect(c.derivation.parent.runId).toBe("old"); }
  writeFileSync("docs/p2-b/worker.json", JSON.stringify(report, null, 2));
});
