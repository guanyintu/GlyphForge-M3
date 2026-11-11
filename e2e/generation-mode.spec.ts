import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
mkdirSync("docs/haidu", { recursive: true });

async function haidu(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "浏览配方", exact: true }).click();
  await page.getByRole("button", { name: /海都潮人 ID 工作流/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("海都潮人 ID");
  await expect(page.locator(".studio, .cm-editor, .react-flow")).toHaveCount(0);
}
async function draw(page: import("@playwright/test").Page, count = "24") {
  await page.getByRole("button", { name: "生成 ID", exact: true }).click();
  await expect(page.getByRole("button", { name: "停止生成", exact: true })).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator(".results-heading .count-badge")).toHaveText(count);
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); });
    const result = await new Promise<string[]>(resolve => { const tx = db.transaction(["runs", "generated"]); const r = tx.objectStore("runs").getAll(); r.onsuccess = () => { const last = r.result.sort((a, b) => b.createdAt - a.createdAt)[0]; const g = tx.objectStore("generated").index("runId").getAll(last.id); g.onsuccess = () => resolve(g.result.map(c => c.text)); }; });
    db.close(); return result;
  });
}

test("opening the app starts in generation mode; only Edit reveals the workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".studio")).toHaveCount(0);
  await expect(page.getByLabel("选择工作流", { exact: true })).toBeVisible();
  await expect(page.locator(".studio, .cm-editor, .react-flow")).toHaveCount(0);
  await expect(page.locator(".results-heading .count-badge")).toHaveText("0");
  await expect(page.getByRole("button", { name: "生成 ID", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".studio")).toBeVisible();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.locator(".studio")).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("选择工作流", { exact: true })).toBeVisible();
  await expect(page.locator(".studio")).toHaveCount(0);
});

test("selecting any saved workflow stays in generation mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "选择工作流：叠字的快乐", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("叠字的快乐");
  await expect(page.locator(".studio, .cm-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "生成 ID", exact: true }).click();
  await expect(page.locator(".candidate-text").first()).toBeVisible();
});

test("ordinary Haidu controls run the real workflow with reproducible seed, length and count", async ({ page }) => {
  await haidu(page);
  await page.getByText("生成设置", { exact: true }).click();
  await page.getByLabel("固定种子", { exact: true }).check();
  await page.getByLabel("生成种子", { exact: true }).fill("42");
  await page.getByLabel("结果数量", { exact: true }).fill("12");
  await page.getByRole("button", { name: "两字", exact: true }).click();
  const first = await draw(page, "12");
  expect(first.every(t => [...t].length === 2)).toBe(true);
  expect(new Set(first).size).toBe(12);
  expect(await draw(page, "12")).toEqual(first);
  await page.getByRole("button", { name: "三字", exact: true }).click();
  expect((await draw(page, "12")).every(t => [...t].length === 3)).toBe(true);
  await expect(page.locator(".studio, .cm-editor, .react-flow")).toHaveCount(0);
  await page.getByText("生成设置", { exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "docs/haidu/generation-mode-desktop.png", fullPage: true });
});

test("clicking an ID copies it and favorites survive refresh without revealing the editor", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await haidu(page); await draw(page);
  const name = await page.locator(".candidate-text").first().innerText();
  await page.locator(".candidate-name").first().click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(name);
  await page.getByRole("button", { name: `收藏 ${name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `收藏 ${name}`, exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(page.getByLabel("选择工作流", { exact: true })).toBeVisible();
  await expect(page.locator(".studio")).toHaveCount(0);
  await page.getByRole("button", { name: /^我的收藏/ }).click();
  await expect(page.locator(".candidate-text").filter({ hasText: name })).toBeVisible();
});

test("unapplied code survives returning to generation; Save applies it and returns", async ({ page }) => {
  await haidu(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "NameScript", exact: true }).click();
  const code = 'let words = resource("animals");\nlet result = output(words);';
  await page.locator(".cm-content").fill(code);
  await page.getByRole("button", { name: "返回生成", exact: true }).click();
  await expect(page.locator(".studio, .cm-editor")).toHaveCount(0);
  await expect(page.getByText(/编辑草稿已保留/)).toBeVisible();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText('resource("animals")');
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.locator(".studio")).toHaveCount(0);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText('resource("animals")');
  await page.reload();
  await expect(page.getByLabel("选择工作流", { exact: true })).toBeVisible();
  await expect(page.locator(".studio")).toHaveCount(0);
});

test("invalid code keeps the draft and editor open when Save fails", async ({ page }) => {
  await haidu(page); await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "NameScript", exact: true }).click();
  await page.locator(".cm-content").fill("broken draft");
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.locator(".studio")).toBeVisible();
  await expect(page.locator(".cm-content")).toHaveText("broken draft");
  await expect(page.locator(".toast")).toContainText("无法保存");
});

test("mobile starts with selection and generation, then enters and leaves Edit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await haidu(page); await draw(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: "docs/haidu/generation-mode-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.locator(".studio")).toBeVisible();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await expect(page.locator(".studio")).toHaveCount(0);
  await page.reload(); await expect(page.getByRole("button", { name: "生成 ID", exact: true })).toBeVisible();
  await expect(page.locator(".studio")).toHaveCount(0);
});
