import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { createWorkflow } from "../src/core/model";

async function fixture(page: Page, texts: string[]) {
  await page.goto("/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  const workflow = createWorkflow(); workflow.id = "p1d-fixture"; workflow.seed = 0; workflow.limit = 10000;
  workflow.nodes = [{ id: "names", op: "resource", inputs: [], params: { resourceId: "p1d-names" } }, { id: "out", op: "output", inputs: ["names"], params: {} }];
  await page.evaluate(async ({ workflow, texts }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("glyphforge-v1"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["workflows", "entries", "resources"], "readwrite"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      tx.objectStore("workflows").put(workflow);
      tx.objectStore("resources").put({ id: "p1d-names", name: "动画验收词库", kind: "word", description: "", color: "green", count: texts.length, version: 1, updatedAt: Date.now() });
      texts.forEach(text => tx.objectStore("entries").add({ resourceId: "p1d-names", text }));
    }); db.close(); localStorage.setItem("glyphforge-active", workflow.id);
  }, { workflow, texts });
  await page.reload(); await expect(page.getByText(/生成完成/)).toBeVisible();
  await expect(page.locator(".results-section .count-badge")).toHaveText(String(texts.length));
}
const field = (page: Page) => page.locator(".physics-grid");
async function frozen(page: Page) {
  const before = await field(page).getAttribute("data-physics-frames");
  await page.waitForTimeout(160);
  expect(await field(page).getAttribute("data-physics-frames")).toBe(before);
}

test("P1-D: 1200 results stay bounded; pause/stop/mode switch/reduced motion preserve copy and exports", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const names = Array.from({ length: 1200 }, (_, i) => `猫${i.toString().padStart(4, "0")}`);
  await fixture(page, names);
  await page.getByRole("button", { name: "漂浮碰撞", exact: true }).click();
  await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  const count = await page.locator(".physics-grid .candidate").count(); expect(count).toBeGreaterThanOrEqual(20); expect(count).toBeLessThanOrEqual(48);
  await expect.poll(() => field(page).getAttribute("data-physics-frames").then(Number)).toBeGreaterThan(2);
  await page.getByRole("button", { name: "暂停运动", exact: true }).click(); await frozen(page);
  await page.getByRole("button", { name: "继续运动", exact: true }).click(); await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await page.getByRole("button", { name: "停止运动", exact: true }).click(); await frozen(page);
  await page.getByRole("button", { name: "继续运动", exact: true }).click();
  await page.getByLabel("开启动画", { exact: true }).uncheck(); await expect(field(page)).toHaveAttribute("data-physics-running", "false"); await frozen(page);
  await page.getByLabel("开启动画", { exact: true }).check(); await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await page.emulateMedia({ reducedMotion: "reduce" }); await expect(page.getByText("已减少动态效果", { exact: true })).toBeVisible(); await frozen(page);
  await page.emulateMedia({ reducedMotion: "no-preference" }); await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await page.getByRole("button", { name: "复制全部", exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/).sort()).toEqual(names);
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "导出", exact: true }).click();
  const download = await downloadPromise; expect(readFileSync((await download.path())!, "utf8").split("\n").sort()).toEqual(names);
  await page.getByLabel("结果导出格式").selectOption("json");
  const jsonPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "导出", exact: true }).click();
  const exported = JSON.parse(readFileSync((await (await jsonPromise).path())!, "utf8"));
  expect(exported.entries.map((c: { text: string }) => c.text).sort()).toEqual(names);
  expect(exported.entries.every((c: object) => !["x", "y", "vx", "vy"].some(key => key in c))).toBe(true);
  await page.getByLabel("筛选生成结果", { exact: true }).fill("1199");
  await expect(page.locator(".physics-grid .candidate")).toHaveCount(1); await expect(page.locator(".candidate-text")).toHaveText("猫1199");
  await page.getByLabel("筛选生成结果", { exact: true }).fill("不存在"); await expect(page.locator(".empty-state")).toBeVisible(); await expect(field(page)).toHaveCount(0);
  await page.getByLabel("筛选生成结果", { exact: true }).fill(""); await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await page.getByRole("button", { name: /^运行工作流/ }).click(); await expect(page.getByText(/生成完成/)).toBeVisible(); await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await expect(page.locator(".results-section .count-badge")).toHaveText("1200");
  await page.getByRole("button", { name: "列表模式", exact: true }).click(); await expect(field(page)).toHaveCount(0);
  expect(await page.locator(".candidate").count()).toBeLessThan(30);
});

test("P1-D: stable keys, FLIP sorting/filtering, Unicode highlights and immediate favorites", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const names = ["猫猫咪咪", "电子猫猫", "星际猫咪", "👨‍👩‍👧猫", "e\u0301猫", "猫", "𠀀猫", "狗"];
  await fixture(page, names);
  await page.locator(".candidate").evaluateAll(nodes => nodes.forEach(node => node.setAttribute("data-retained", "yes")));
  await page.getByLabel("结果排序").selectOption("length");
  await expect(page.locator(".candidate-text")).toHaveText([...names].sort((a, b) => Array.from(a).length - Array.from(b).length));
  expect(await page.locator(".candidate[data-retained='yes']").count()).toBe(names.length);
  await expect.poll(() => page.locator(".candidate").evaluateAll(nodes => nodes.some(n => n.getAnimations().length > 0))).toBe(true);
  await page.getByLabel("筛选生成结果", { exact: true }).fill("猫");
  await expect(page.locator(".results-section .count-badge")).toHaveText("7");
  for (const mark of await page.locator(".candidate-text mark").allTextContents()) expect(/^猫+$/.test(mark)).toBe(true);
  await page.getByLabel("结果去重").check(); await expect(page.locator(".candidate")).toHaveCount(7);
  await page.getByLabel("收藏 猫", { exact: true }).click(); await expect(page.getByLabel("收藏 猫", { exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "只看收藏", exact: true }).click(); await expect(page.locator(".candidate-text")).toHaveText(["猫"]);
  await page.getByRole("button", { name: "复制全部", exact: true }).click(); expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("猫");
  await page.getByRole("button", { name: "只看收藏", exact: true }).click();
  await page.getByLabel("筛选生成结果", { exact: true }).fill("👩"); await expect(page.locator(".candidate-text mark")).toHaveText("👨‍👩‍👧");
  await page.getByLabel("筛选生成结果", { exact: true }).fill("e"); await expect(page.locator(".candidate-text mark")).toHaveText("e\u0301");
  await page.getByLabel("筛选生成结果", { exact: true }).fill("猫");
  await page.getByRole("button", { name: "卡片模式", exact: true }).click(); await page.screenshot({ path: "docs/p1d/highlight-cards.png", fullPage: true });
  await page.getByRole("button", { name: "灵感动画", exact: true }).click(); await expect(page.locator(".animate-card")).toHaveCount(7);
  await page.getByRole("button", { name: "爆炸散开", exact: true }).click(); await expect(page.locator(".animate-scatter")).toHaveCount(7);
  await page.getByLabel("开启动画", { exact: true }).uncheck(); await expect(page.locator(".animate-scatter")).toHaveCount(0);
  await page.getByLabel("开启动画", { exact: true }).check(); await page.emulateMedia({ reducedMotion: "reduce" }); await expect(page.locator(".animate-scatter")).toHaveCount(0);
  await page.reload(); await page.getByRole("button", { name: /^我的收藏/ }).click(); await expect(page.getByLabel("收藏 猫", { exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("P1-D: visibility, resize, offscreen and unmount clean the owned RAF", async ({ page }) => {
  await page.addInitScript(() => {
    const request = requestAnimationFrame, cancel = cancelAnimationFrame, pending = new Set<number>();
    Object.assign(window, { __pendingFrames: pending });
    window.requestAnimationFrame = cb => { const id = request(time => { pending.delete(id); cb(time); }); pending.add(id); return id; };
    window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
  });
  await fixture(page, Array.from({ length: 60 }, (_, i) => `漂浮猫${i}`));
  await page.getByRole("button", { name: "漂浮碰撞", exact: true }).click(); await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(field(page)).toHaveAttribute("data-physics-running", "false"); await frozen(page);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await page.setViewportSize({ width: 390, height: 844 }); await field(page).scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const contained = await field(page).evaluate(el => {
    const rect = el.getBoundingClientRect();
    return [...el.querySelectorAll(".candidate")].every(node => { const b = node.getBoundingClientRect(); return b.left >= rect.left - 1 && b.top >= rect.top - 1 && b.right <= rect.right + 1 && b.bottom <= rect.bottom + 1; });
  }); expect(contained).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "docs/p1d/mobile-physics.png", fullPage: true });
  await page.evaluate(() => { const grid = document.querySelector<HTMLElement>(".physics-grid")!; grid.style.visibility = "hidden"; grid.style.transform = "translateY(10000px)"; });
  await expect(field(page)).toHaveAttribute("data-physics-running", "false"); await frozen(page);
  await page.evaluate(() => { const grid = document.querySelector<HTMLElement>(".physics-grid")!; grid.style.transform = ""; grid.style.visibility = ""; });
  await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  await page.evaluate(() => Object.assign(window, { __oldField: document.querySelector(".physics-grid") }));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: /^资源中心/ }).click(); await expect(field(page)).toHaveCount(0);
  const before = await page.evaluate(() => (window as unknown as { __oldField: HTMLElement }).__oldField.dataset.physicsFrames);
  await page.waitForTimeout(200);
  const cleanup = await page.evaluate(() => ({ frames: (window as unknown as { __oldField: HTMLElement }).__oldField.dataset.physicsFrames, pending: (window as unknown as { __pendingFrames: Set<number> }).__pendingFrames.size }));
  expect(cleanup.frames).toBe(before); expect(cleanup.pending).toBe(0); console.log("P1D_CLEANUP", JSON.stringify(cleanup));
});

test("P1-D: low device starts with at most twenty objects and auto-stops", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "hardwareConcurrency", { value: 2 }); Object.defineProperty(navigator, "deviceMemory", { value: 2 }); });
  await fixture(page, Array.from({ length: 1000 }, (_, i) => `轻量猫${i}`));
  await page.getByRole("button", { name: "漂浮碰撞", exact: true }).click(); await expect(field(page)).toHaveAttribute("data-quality", "low");
  expect(await page.locator(".physics-grid .candidate").count()).toBeLessThanOrEqual(20);
  await expect(page.getByText("运动已停止", { exact: true })).toBeVisible({ timeout: 23000 }); await frozen(page);
});

async function sample(page: Page, milliseconds: number) {
  return page.evaluate(async milliseconds => {
    const intervals: number[] = [], tasks: number[] = []; let previous = performance.now();
    const grid = document.querySelector<HTMLElement>(".physics-grid")!;
    const transforms = [...grid.querySelectorAll<HTMLElement>(".candidate")].map(n => n.style.transform);
    const startFrames = Number(grid.dataset.physicsFrames ?? 0), start = performance.now();
    const observer = new PerformanceObserver(list => list.getEntries().forEach(e => tasks.push(e.duration))); observer.observe({ type: "longtask" });
    await new Promise<void>(resolve => { const tick = (now: number) => { intervals.push(now - previous); previous = now; if (now - start < milliseconds) requestAnimationFrame(tick); else resolve(); }; requestAnimationFrame(tick); });
    observer.disconnect(); const sorted = [...intervals].sort((a, b) => a - b);
    const rect = grid.getBoundingClientRect(), cards = [...grid.querySelectorAll(".candidate")].map(n => n.getBoundingClientRect());
    let overlaps = 0;
    for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) { const a = cards[i], b = cards[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps++; }
    return { movedObjects: [...grid.querySelectorAll<HTMLElement>(".candidate")].filter((n, i) => n.style.transform !== transforms[i]).length, hidden: document.hidden, rect: rect.toJSON(), viewport: { width: innerWidth, height: innerHeight }, running: grid.dataset.physicsRunning, elapsedMs: performance.now() - start, rafSamples: intervals.length, meanIntervalMs: intervals.reduce((s, n) => s + n, 0) / intervals.length, p95IntervalMs: sorted[Math.floor(sorted.length * .95)], maxIntervalMs: Math.max(...intervals), longTasks: tasks.length, maxLongTaskMs: Math.max(0, ...tasks), physicsPaints: Number(grid.dataset.physicsFrames ?? 0) - startFrames, objects: cards.length, overlaps, outOfBounds: cards.filter(c => c.left < rect.left - 1 || c.top < rect.top - 1 || c.right > rect.right + 1 || c.bottom > rect.bottom + 1).length, quality: grid.dataset.quality };
  }, milliseconds);
}

test("P1-D: measured Chromium CPU throttling and sustained-contention fallback", async ({ page, browser, context }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await fixture(page, Array.from({ length: 2000 }, (_, i) => `性能猫${i}`));
  await page.getByRole("button", { name: "漂浮碰撞", exact: true }).click();
  await field(page).scrollIntoViewIfNeeded();
  await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  // Controls may be visible while the field is below the fold. A RAF timer alone
  // does not prove physics ran, particularly after full-page screenshot layout.
  await field(page).scrollIntoViewIfNeeded();
  await expect(field(page)).toHaveAttribute("data-physics-running", "true");
  const normal = await sample(page, 2000);
  expect(normal.physicsPaints).toBeGreaterThan(0); expect(normal.movedObjects).toBeGreaterThan(0);
  expect(normal.overlaps).toBe(0); expect(normal.outOfBounds).toBe(0);
  const cdp = await context.newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const throttled = await sample(page, 2000);
  expect(throttled.physicsPaints).toBeGreaterThan(0); expect(throttled.movedObjects).toBeGreaterThan(0);
  const favorite = page.locator(".physics-grid .star-button").first();
  await favorite.evaluate(node => node.addEventListener("click", () => {
    const start = performance.now();
    const observer = new MutationObserver(() => { if (node.getAttribute("aria-pressed") === "true") { Object.assign(window, { __favoriteLatency: performance.now() - start }); observer.disconnect(); } }); observer.observe(node, { attributes: true });
  }, { once: true }));
  await favorite.click({ force: true }); await expect(favorite).toHaveAttribute("aria-pressed", "true");
  const favoriteLatencyMs = await page.evaluate(() => (window as unknown as { __favoriteLatency: number }).__favoriteLatency);
  // Deterministic additional main-thread contention. Report separately from CPU-only data.
  await page.evaluate(() => {
    Object.assign(window, { __contention: true });
    const busy = () => { if (!(window as unknown as { __contention: boolean }).__contention) return; const start = performance.now(); while (performance.now() - start < 35) { /* controlled benchmark workload */ } requestAnimationFrame(busy); }; requestAnimationFrame(busy);
  });
  const contention = await sample(page, 6000);
  console.log("M2_MOTION_SAMPLES", JSON.stringify({normal, throttled, contention}));
  expect(contention.physicsPaints).toBeGreaterThan(0);
  await expect(field(page)).toHaveAttribute("data-quality", "static"); await frozen(page);
  await page.evaluate(() => Object.assign(window, { __contention: false })); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await page.getByLabel("开启动画", { exact: true }).uncheck(); await frozen(page);
  // Capture after the timing experiment so screenshot viewport changes are not sampled.
  await page.screenshot({ path: "docs/p1d/physics-desktop.png", fullPage: true });
  const environment = await page.evaluate(() => ({ userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory }));
  const report = { browser: browser.version(), environment, cpuRate: 6, normal, throttled, contention: { injectedBusyMsPerFrame: 35, ...contention }, favoriteLatencyMs, errors };
  writeFileSync("docs/p1d/performance.json", JSON.stringify(report, null, 2)); console.log("P1D_PERFORMANCE", JSON.stringify(report)); expect(errors).toEqual([]);
});
