import { test, expect, chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { createWorkflow } from "../src/core/model";

// Separate test-only bundle of the real storage module, never part of the production entry.
test.beforeAll(() => {
  execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "e2e/lifecycle.vite.config.ts"], { stdio: "pipe" });
});
for (const mode of ["fresh", "v5"] as const) test(`real IndexedDB ${mode}: 100 mixed production Worker runs and retention growth`, async ({ page }) => {
  test.setTimeout(180000);
  const asset = "/assets/" + readdirSync("dist/assets").find(n => n.startsWith("execution.worker-") && n.endsWith(".js"));
  await page.goto(asset); // Same-origin document without booting the app.
  const report = await page.evaluate(async ({ mode, asset, workflow }) => {
    const h = await import("/e2e-harness/lifecycle.js");
    const w = { ...workflow, nodes: [{ id: "l", op: "program", inputs: [], params: {}, program: h.parseProgram('for n in range(0, 128) { emit("留存测试" + text(n)); }') }, { id: "o", op: "output", inputs: ["l"], params: {} }] };
    const errorWorkflow = { ...w, nodes: [{ id: "l", op: "program", inputs: [], params: {}, program: h.parseProgram('for n in range(0, 128) { emit("错误前" + text(n)); } for x in @missing { emit(x); }') }, w.nodes[1]] };
    if (mode === "v5") {
      const old = new h.Dexie("glyphforge-v1");
      old.version(5).stores({ resources: "id,name", entries: "++id,resourceId,text,&[resourceId+text],[resourceId+id]", workflows: "id,name", favorites: "text,savedAt", runs: "id,createdAt", generated: "[runId+text],text,runId", relations: "++id,resourceId,[resourceId+left+right+relation],&[resourceId+left+right+relation+direction],[resourceId+id],left,right", gamePresets: "id,name" });
      await old.table("resources").add({ id: "historic", name: "旧资源", kind: "word", count: 1, version: 7, description: "", color: "green", updatedAt: 1 });
      const oldWorkflow = { ...w, nodes: [{ id: "l", op: "resource", inputs: [], params: { resourceId: "historic" } }, w.nodes[1]] };
      await old.table("entries").add({ resourceId: "historic", text: "旧内容" }); await old.table("workflows").add(oldWorkflow);
      await old.table("runs").add({ id: "legacy", workflow: oldWorkflow, versions: { historic: 7 }, status: "done", count: 1, createdAt: 1 });
      await old.table("favorites").add({ text: "旧内容", runId: "legacy", parts: [{ text: "旧内容", resourceId: "historic", version: 7 }], savedAt: 1 });
      old.close();
      // Abort a native versionchange after adding an index, then retry the real migration.
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("glyphforge-v1", 60);
        request.onupgradeneeded = () => { request.transaction!.objectStore("favorites").createIndex("runId", "runId"); request.transaction!.abort(); };
        request.onerror = () => resolve(); request.onsuccess = () => { request.result.close(); reject(new Error("upgrade abort not observed")); };
      });
    }
    await h.db.open();
    const samples = [], outcomes: Record<string, number> = {};
    const size = async () => {
      let bytes = 0;
      await h.db.runs.each((r: unknown) => { bytes += new TextEncoder().encode(JSON.stringify(r)).length; });
      await h.db.generated.each((r: unknown) => { bytes += new TextEncoder().encode(JSON.stringify(r)).length; });
      return { runs: await h.db.runs.count(), generated: await h.db.generated.count(), logicalBytes: bytes, browserUsage: (await navigator.storage.estimate()).usage };
    };
    for (let i = 0; i < 100; i++) {
      const id = `mixed-${i}`;
      const flow = i % 5 === 1 ? errorWorkflow : w;
      const release = await h.acquireRunLock(id);
      await h.beginRun(flow, id);
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(asset, { type: "module" });
        const fail = setTimeout(() => { worker.terminate(); reject(new Error("worker timeout")); }, 15000);
        worker.onerror = e => { clearTimeout(fail); worker.terminate(); reject(new Error(e.message)); };
        worker.onmessage = async ({ data }) => {
          if (data.type === "started" && (i % 5 === 2 || i % 5 === 3)) {
            worker.terminate(); clearTimeout(fail);
            if (i % 5 === 2) await h.finishRun(id, "cancelled", "browser cancel");
            release();
            if (i % 5 === 3) await h.recoverRuns();
            resolve();
          } else if (data.type === "done" || data.type === "error") { worker.terminate(); clearTimeout(fail); resolve(); }
        };
        worker.postMessage({ workflow: flow, runId: id, keep: 20 });
      });
      release();
      const record = await h.db.runs.get(id); outcomes[record.status] = (outcomes[record.status] ?? 0) + 1;
      if (i === 0) { const c = await h.db.generated.where("runId").equals(id).first(); if (!c) throw new Error("no generated output"); await h.toggleFavorite(c); }
      if (i === 4) await h.pinRun(id, true);
      await h.pruneHistory(20);
      if ([0, 24, 49, 74, 99].includes(i)) samples.push({ round: i + 1, ...await size() });
    }
    const normal = await h.db.runs.where("[retention+createdAt]").between([0, -Infinity], [0, Infinity]).count();
    const favorite = await h.db.favorites.get("留存测试0"), run = await h.db.runs.get(favorite.runId);
    const backup = await h.exportRun(run.id); const restored = new h.ForgeDatabase("restore-test"); await h.restoreRun(backup, restored);
    const restoredCount = await restored.generated.count(); await restored.delete();
    const sourceBefore = mode === "v5" ? { resource: await h.db.resources.get("historic"), entries: await h.db.entries.count(), workflows: await h.db.workflows.count(), favorite: await h.db.favorites.get("旧内容"), run: await h.db.runs.get("legacy"), generated: await h.db.generated.get(["legacy", "旧内容"]) } : null;
    await h.pruneHistory(0); const final = await size();
    // Replay the pre-S0 persistence algorithm on the same 100 workloads for a measured baseline.
    const legacy = new h.ForgeDatabase("pre-s0-baseline"); const baselineSamples = [];
    for (let i = 0; i < 100; i++) {
      const id = `baseline-${i}`, run: any = { id, workflow: i % 5 === 1 ? errorWorkflow : w, versions: {}, createdAt: i, status: "running", count: 0 };
      await legacy.runs.add(run);
      if (i % 5 === 2) { run.status = "cancelled"; await legacy.runs.put(run); }
      else if (i % 5 !== 3) {
        try {
          const stats = await h.execute(run.workflow, h.readResource, async (batch: any[]) => { await legacy.generated.bulkPut(batch.map(c => ({ ...c, runId: id }))); }, undefined, { runId: id });
          run.status = "done"; run.count = stats.count; await legacy.runs.put(run);
          for (const old of await legacy.runs.orderBy("createdAt").reverse().offset(20).limit(1).toArray()) await legacy.generated.where("runId").equals(old.id).delete();
        } catch {
          run.status = "error"; run.count = await legacy.generated.where("runId").equals(id).count(); await legacy.runs.put(run);
        }
      }
      if ([24, 49, 74, 99].includes(i)) {
        let bytes = 0; await legacy.runs.each((r: unknown) => { bytes += new TextEncoder().encode(JSON.stringify(r)).length; });
        await legacy.generated.each((r: unknown) => { bytes += new TextEncoder().encode(JSON.stringify(r)).length; });
        baselineSamples.push({ round: i + 1, runs: await legacy.runs.count(), generated: await legacy.generated.count(), logicalBytes: bytes });
      }
    }
    await legacy.delete();
    return { mode, outcomes, samples, baselineSamples, normal, favoriteReadable: !!run?.workflow, restoredCount, sourceBefore, final };
  }, { mode, asset, workflow: createWorkflow() });
  expect(report.outcomes).toEqual({ done: 40, error: 20, cancelled: 20, interrupted: 20 });
  expect(report.normal).toBe(20); expect(report.favoriteReadable).toBe(true); expect(report.restoredCount).toBe(128);
  expect(report.final.runs).toBe(mode === "v5" ? 3 : 2);
  if (mode === "v5") {
    expect(report.sourceBefore.resource.version).toBe(7); expect(report.sourceBefore.entries).toBe(1); expect(report.sourceBefore.workflows).toBe(1);
    expect(report.sourceBefore.favorite).toBeTruthy(); expect(report.sourceBefore.run.versions.historic).toBe(7); expect(report.sourceBefore.generated.text).toBe("旧内容");
  }
  writeFileSync(`docs/p2-s0-1/browser-${mode}-growth.json`, JSON.stringify(report, null, 2));
});

test("real UI: pin, export, cleanup, favorite source and failure feedback", async ({ page }) => {
  await page.goto("/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  const c = page.locator(".candidate").first(); const text = await c.getAttribute("data-candidate-text");
  await c.getByRole("button", { name: `收藏 ${text}`, exact: true }).click();
  await page.getByRole("button", { name: "运行历史与留存", exact: true }).click();
  const history = page.getByLabel("运行历史", { exact: true });
  await history.getByRole("button", { name: "固定", exact: true }).first().click();
  await expect(history.getByRole("button", { name: "取消固定", exact: true })).toBeVisible();
  const download = page.waitForEvent("download"); await history.getByRole("button", { name: "导出运行备份" }).first().click(); await (await download).saveAs("test-results/run-backup.json");
  await history.getByRole("button", { name: "取消固定", exact: true }).click();
  await history.getByLabel("普通历史保留数量").fill("0");
  await page.evaluate(async () => {
    const h = await import("/e2e-harness/lifecycle.js");
    await h.beginRun(h.createWorkflow(), "cleanup-failure"); await h.appendRunBatch("cleanup-failure", [{ text: "事务回滚", parts: [] }]); await h.finishRun("cleanup-failure", "done");
    const original = IDBObjectStore.prototype.delete;
    (window as any).originalDelete = original;
    IDBObjectStore.prototype.delete = function(key) { if (this.name === "runs") throw new Error("injected cleanup failure"); return original.call(this, key); };
  });
  await history.getByRole("button", { name: "按策略清理历史" }).click();
  await expect(history.getByRole("alert")).toContainText("injected cleanup failure");
  expect(await page.evaluate(async () => { const h = await import("/e2e-harness/lifecycle.js"); return h.db.generated.where("runId").equals("cleanup-failure").count(); })).toBe(1);
  await page.evaluate(() => { IDBObjectStore.prototype.delete = (window as any).originalDelete; });
  await history.getByRole("button", { name: "按策略清理历史" }).click();
  await expect(history.locator(".history-row")).toHaveCount(1);
  await c.locator(".candidate-name").click(); const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("运行时配方"); await expect(dialog).toContainText("无法保证完整重现旧结果");
  await dialog.getByRole("button", { name: "关闭" }).click();
  await history.getByLabel("恢复运行备份").setInputFiles("test-results/run-backup.json");
  await expect(history.getByRole("alert")).toContainText("未覆盖任何数据");
  await page.screenshot({ path: "docs/p2-s0-1/history-ui.png", fullPage: true });
});

test("page reload/reopen recovers dead owners and preserves another live tab", async ({ page, context }) => {
  await page.goto("/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.evaluate(async () => {
    const h = await import("/e2e-harness/lifecycle.js");
    (window as any).releaseLive = await h.acquireRunLock("live-tab");
    await h.beginRun(h.createWorkflow(), "live-tab");
    await h.beginRun(h.createWorkflow(), "dead-reload");
    await h.appendRunBatch("dead-reload", [{ text: "部分产物", parts: [] }]);
  });
  const second = await context.newPage(); await second.goto("/"); await expect(second.getByText(/生成完成/)).toBeVisible();
  const alive = await second.evaluate(async () => (await (await import("/e2e-harness/lifecycle.js")).db.runs.get("live-tab")).status);
  expect(alive).toBe("running");
  await page.reload(); await expect(page.getByText(/生成完成/)).toBeVisible();
  const state = await page.evaluate(async () => {
    const h = await import("/e2e-harness/lifecycle.js");
    return { live: (await h.db.runs.get("live-tab")).status, dead: (await h.db.runs.get("dead-reload")).status, count: await h.db.generated.where("runId").equals("dead-reload").count() };
  });
  expect(state).toEqual({ live: "interrupted", dead: "interrupted", count: 1 });
  await page.evaluate(async () => { const h = await import("/e2e-harness/lifecycle.js"); await h.beginRun(h.createWorkflow(), "dead-close"); });
  await page.close(); await second.close();
  const reopen = await context.newPage(); await reopen.goto("/"); await expect(reopen.getByText(/生成完成/)).toBeVisible();
  expect(await reopen.evaluate(async () => (await (await import("/e2e-harness/lifecycle.js")).db.runs.get("dead-close")).status)).toBe("interrupted");
});

test("UI startup cancellation and unexpected Worker failure persist accurate terminal states", async ({ page }) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    (window as any).workerMode = "normal";
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes("execution.worker")) {
          const post = this.postMessage.bind(this);
          this.postMessage = ((value: any) => {
            if ((window as any).workerMode === "delay") setTimeout(() => post(value), 300);
            else post(value);
          }) as typeof this.postMessage;
          this.addEventListener("message", e => {
            if ((window as any).workerMode === "crash" && e.data.type === "started") {
              this.terminate(); this.dispatchEvent(new ErrorEvent("error", { message: "injected worker crash" }));
            }
          });
        }
      }
    };
  });
  await page.goto("/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  await page.evaluate(() => { (window as any).workerMode = "delay"; });
  for (let i = 0; i < 20; i++) {
    await page.getByRole("button", { name: /^运行工作流/ }).click();
    await page.getByRole("button", { name: /^停止生成/ }).click();
  }
  await expect.poll(() => page.evaluate(async () => {
    const h = await import("/e2e-harness/lifecycle.js"); return h.db.runs.where("status").equals("running").count();
  })).toBe(0);
  const cancelled = await page.evaluate(async () => { const h = await import("/e2e-harness/lifecycle.js"); return h.db.runs.where("status").equals("cancelled").count(); });
  expect(cancelled).toBe(20);
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.filter(l => l.name?.startsWith("glyphforge-run:")).length ?? 0)).toBe(0);
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect.poll(() => page.evaluate(async () => {
    const h = await import("/e2e-harness/lifecycle.js"); return h.db.runs.where("status").equals("running").count();
  })).toBe(1);
  const switchingId = await page.evaluate(async () => {
    const h = await import("/e2e-harness/lifecycle.js"); return (await h.db.runs.where("status").equals("running").first()).id;
  });
  await page.getByRole("button", { name: "镜像文字实验", exact: true }).click();
  await expect.poll(() => page.evaluate(async id => {
    const h = await import("/e2e-harness/lifecycle.js"); return (await h.db.runs.get(id)).status;
  }, switchingId)).toBe("cancelled");
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held?.filter(l => l.name?.startsWith("glyphforge-run:")).length ?? 0)).toBe(0);
  await page.evaluate(() => { (window as any).workerMode = "crash"; });
  await page.getByRole("button", { name: /^运行工作流/ }).click();
  await expect.poll(() => page.evaluate(async () => {
    const h = await import("/e2e-harness/lifecycle.js"); return (await h.db.runs.orderBy("createdAt").last()).status;
  })).toBe("interrupted");
});


test("real Chromium profile survives browser process close and reopen", async () => {
  const profile = `test-results/reopen-${Date.now()}`;
  let browser = await chromium.launchPersistentContext(profile, { headless: true });
  try {
    const page = await browser.newPage(); await page.goto("http://127.0.0.1:4175/"); await expect(page.getByText(/生成完成/)).toBeVisible();
    await page.evaluate(async () => {
      const h = await import("/e2e-harness/lifecycle.js");
      (window as any).browserRunLock = await h.acquireRunLock("browser-close");
      await h.beginRun(h.createWorkflow(), "browser-close");
      await h.appendRunBatch("browser-close", [{ text: "关闭前产物", parts: [] }]);
    });
    await browser.close();
    browser = await chromium.launchPersistentContext(profile, { headless: true });
    const reopened = await browser.newPage(); await reopened.goto("http://127.0.0.1:4175/"); await expect(reopened.getByText(/生成完成/)).toBeVisible();
    const state = await reopened.evaluate(async () => {
      const h = await import("/e2e-harness/lifecycle.js");
      return { status: (await h.db.runs.get("browser-close")).status, count: await h.db.generated.where("runId").equals("browser-close").count() };
    });
    expect(state).toEqual({ status: "interrupted", count: 1 });
  } finally { await browser.close(); }
});
