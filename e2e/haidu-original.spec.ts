import { test, expect, type Page } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
const catalog: { pools: Record<string, { rows: { text: string }[] }> } = JSON.parse(readFileSync("examples/haidu-chao-ren.original.catalog.json", "utf8"));
mkdirSync("docs/haidu", { recursive: true });
async function choose(page: Page) {
  await page.goto("/");
  await page.getByLabel("选择工作流", { exact: true }).selectOption({ label: "海都潮人 ID · 原版 xlsx" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("原版 xlsx");
  await expect(page.locator(".studio, .cm-editor, .react-flow")).toHaveCount(0);
  await page.getByText("生成设置", { exact: true }).click();
  await page.getByLabel("固定种子", { exact: true }).check();
  await page.getByLabel("生成种子", { exact: true }).fill("42");
}
async function draw(page: Page, count?: string) {
  await page.getByRole("button", { name: "生成 ID", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成 ID", exact: true })).toBeVisible({ timeout: 20000 });
  if (count) await expect(page.locator(".results-heading .count-badge")).toHaveText(count);
  await expect(page.locator(".candidate-text").first()).toBeVisible();
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); });
    const names = await new Promise<string[]>(resolve => { const tx = db.transaction(["runs", "generated"]), r = tx.objectStore("runs").getAll(); r.onsuccess = () => { const last = r.result.sort((a, b) => b.createdAt - a.createdAt)[0]; const g = tx.objectStore("generated").index("runId").getAll(last.id); g.onsuccess = () => resolve(g.result.map(c => c.text)); }; });
    db.close(); return names;
  });
}
test("original xlsx is directly selectable and runs the real original word pools without exposing a graph", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await choose(page); const values = await draw(page, "75");
  expect(new Set(values).size).toBe(75);
  const pools = Object.fromEntries(Object.entries(catalog.pools).map(([k, p]) => [k, new Set(p.rows.map(r => r.text))]));
  const valid = (t: string) => (pools.oneHead.has(t[0]) && pools.oneTail.has(t.slice(1))) || (pools.oneHead.has(t[0]) && pools.twoTail.has(t.slice(1))) || (pools.twoHead.has(t.slice(0, 2)) && pools.oneTail.has(t.slice(2))) || (t[0] === "小" && pools.twoTail.has(t.slice(1))) || pools.twoTail.has(t);
  expect(values.every(valid)).toBe(true); expect(await draw(page, "75")).toEqual(values);
  await page.getByText("生成设置", { exact: true }).click(); await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "docs/haidu/original-integrated-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "NameScript", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("glyphforge:preset:haidu-original-xlsx-v1");
  await page.getByRole("button", { name: "保存并返回", exact: true }).click(); await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("原版 xlsx");
  await expect(page.locator(".studio, .cm-editor")).toHaveCount(0);
});
test("original source words are editable in the existing resource center and feed generation", async ({ page }) => {
  await choose(page); await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: /^资源中心/ }).click();
  await page.locator(".resource-card").filter({ has: page.getByRole("heading", { name: "原版海都 · 2字后缀 · 导入", exact: true }) }).click();
  const dialog = page.getByRole("dialog", { name: "编辑词库" });
  await dialog.getByLabel("添加词条").fill("测试");
  await dialog.getByRole("button", { name: "添加到词库", exact: true }).click();
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "工作流工坊", exact: true }).click();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await page.getByText("生成设置", { exact: true }).click(); await page.getByLabel("包含文字", { exact: true }).fill("测试");
  const values = await draw(page); expect(values).toContain("测试"); expect(values).toContain("小测试");
});
test("original workflow portable export restores all eight resources and exact seeded results", async ({ page, browser }) => {
  await choose(page); const before = await draw(page, "75");
  await page.getByRole("button", { name: "导出工作流", exact: true }).click();
  const pending = page.waitForEvent("download"); await page.getByRole("button", { name: "导出便携包", exact: true }).click();
  const file = await (await pending).path(); const pkg = JSON.parse(readFileSync(file!, "utf8")); expect(pkg.version).toBe(6); expect(pkg.resources).toHaveLength(8);
  const context = await browser.newContext(), other = await context.newPage(); await other.goto("/");
  await other.getByText("生成设置", { exact: true }).click(); await other.getByRole("button", { name: "导入", exact: true }).click();
  await other.locator('input[type=file][hidden]').setInputFiles(file!);
  await expect(other.getByRole("heading", { level: 1 })).toContainText("原版 xlsx");
  await other.getByLabel("固定种子", { exact: true }).check();
  expect(await draw(other, "75")).toEqual(before); await context.close();
});
test("mobile can select original xlsx directly, generate and refresh in ordinary mode", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await choose(page); await page.getByRole("button", { name: "三字", exact: true }).click();
  expect((await draw(page, "75")).every(t => [...t].length === 3)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText("生成设置", { exact: true }).click(); await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "docs/haidu/original-integrated-mobile.png", fullPage: true });
  await page.reload(); await expect(page.getByRole("button", { name: "生成 ID", exact: true })).toBeVisible();
  await expect(page.locator(".studio, .cm-editor, .react-flow")).toHaveCount(0);
});
