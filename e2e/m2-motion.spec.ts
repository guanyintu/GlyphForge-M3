import { openEditor, reloadEditor, enterEditor } from "./editor-steps";
import { expect, test } from "@playwright/test";

test("M2: the latest native intersection record resumes real motion after a batched offscreen/onscreen transition", async ({ page }) => {
  // Control delivery only: geometry and records still come from Chromium's native observer.
  await page.addInitScript(() => {
    const NativeObserver = IntersectionObserver;
    const batches: Array<{ records: IntersectionObserverEntry[]; callback: IntersectionObserverCallback; observer: IntersectionObserver }> = [];
    Object.assign(window, { __motionBatches: batches, __holdMotionRecords: false });
    window.IntersectionObserver = class extends NativeObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        super((entries, observer) => {
          if (!(window as any).__holdMotionRecords || !entries.some(e => e.target.classList.contains("physics-grid"))) { callback(entries, observer); return; }
          let batch = batches.find(b => b.observer === observer);
          if (!batch) { batch = { records: [], callback, observer }; batches.push(batch); }
          batch.records.push(...entries);
        }, options);
      }
    };
  });
  await openEditor(page, "/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.getByRole("button", { name: "漂浮碰撞", exact: true }).click();
  const grid = page.locator(".physics-grid");
  await grid.scrollIntoViewIfNeeded();
  await expect.poll(() => grid.getAttribute("data-physics-frames").then(Number)).toBeGreaterThan(2);
  await page.evaluate(() => {
    (window as any).__holdMotionRecords = true;
    document.querySelector<HTMLElement>(".physics-grid")!.style.transform = "translateY(10000px)";
  });
  await expect.poll(() => page.evaluate(() => (window as any).__motionBatches.flatMap((b: any) => b.records).map((r: IntersectionObserverEntry) => r.isIntersecting))).toEqual([false]);
  await grid.evaluate(el => { (el as HTMLElement).style.transform = ""; });
  await expect.poll(() => page.evaluate(() => (window as any).__motionBatches.flatMap((b: any) => b.records).map((r: IntersectionObserverEntry) => r.isIntersecting))).toEqual([false, true]);
  const delivery = await page.evaluate(() => {
    (window as any).__holdMotionRecords = false;
    return (window as any).__motionBatches.map((b: any) => { b.callback(b.records, b.observer); return b.records.map((r: IntersectionObserverEntry) => ({ intersecting: r.isIntersecting, time: r.time, rect: r.boundingClientRect.toJSON() })); });
  });
  console.log("M2_NATIVE_INTERSECTION_BATCH", JSON.stringify(delivery));
  // Wait beyond React's observer update; then require subsequent frames and changed transforms.
  await page.waitForTimeout(100);
  await expect(grid).toHaveAttribute("data-physics-running", "true");
  const before = await grid.getAttribute("data-physics-frames");
  const transform = await grid.locator(".candidate").first().evaluate(el => (el as HTMLElement).style.transform);
  await expect.poll(() => grid.getAttribute("data-physics-frames").then(Number)).toBeGreaterThan(Number(before));
  await expect.poll(() => grid.locator(".candidate").first().evaluate(el => (el as HTMLElement).style.transform)).not.toBe(transform);
});
