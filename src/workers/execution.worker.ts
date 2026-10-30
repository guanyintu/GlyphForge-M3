import { diagnose, executionBudget } from "../core/contracts";
import { execute } from "../core/engine";
import type { Workflow } from "../core/model";
import { db, readResource } from "../storage/db";
import { acquireRunLock, beginRun, appendRunBatch, finishRun, pruneHistory } from "../storage/run-lifecycle";
self.onmessage = async (event: MessageEvent<Workflow | { workflow: Workflow; runId: string; keep: number }>) => {
  const managed = "workflow" in event.data;
  const workflow = managed ? event.data.workflow : event.data;
  const runId = managed ? event.data.runId : crypto.randomUUID();
  const keep = managed ? event.data.keep : 20;
  let release: (() => void) | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    if (!managed) { release = await acquireRunLock(runId); await beginRun(workflow, runId); }
    const record = await db.runs.get(runId);
    if (!record || record.status !== "running") throw new Error("运行已停止");
    const versions = record.versions;
    self.postMessage({ type: "started", runId });
    watchdog = setTimeout(() => {
      expired = true;
      // Storage may itself be blocked. Notify the owner first so its hard stop
      // and terminal-state retry do not depend on this pending transaction.
      self.postMessage({ type: "error", message: "达到 10 秒执行时间上限，请缩小词库或调整条件", diagnostic: { code: "BUDGET", message: "达到 10 秒执行时间上限" } });
      void finishRun(runId, "error", "达到 10 秒执行时间上限").catch(() => {}).finally(() => self.close());
    }, executionBudget.milliseconds);
    const stats = await execute(workflow, async function* (id, seed) {
      if ((await db.resources.get(id))?.version !== versions[id]) throw new Error("词库在运行期间发生更改，请重新生成");
      for await (const candidate of readResource(id, seed)) {
        if (candidate.parts[0].version !== versions[id]) throw new Error("资源版本发生变化，请重新生成");
        yield candidate;
      }
    }, async batch => {
      await appendRunBatch(runId, batch);
      self.postMessage({ type: "batch", batch });
    }, { steps: executionBudget.steps, milliseconds: executionBudget.milliseconds }, {
      resourceMetadata: id => db.resources.get(id),
      runId, onProgress: progress => self.postMessage({ type: "progress", ...progress }),
    });
    await finishRun(runId, "done");
    let cleanupError = "";
    if (!managed) try { await pruneHistory(keep); } catch (e) { cleanupError = String(e); }
    if ((await db.runs.get(runId))?.status === "done") self.postMessage({ type: "done", stats, cleanupError });
  } catch (error) {
    if (expired) return; // The watchdog already sent the terminal notification.
    const message = error instanceof Error ? error.message : "生成失败";
    try { await finishRun(runId, "error", message); } catch { /* UI/next boot retries recovery if storage failed. */ }
    let cleanupError = "";
    if (!managed) try { await pruneHistory(keep); } catch (e) { cleanupError = String(e); }
    self.postMessage({ type: "error", message, diagnostic: diagnose(error).diagnostic, cleanupError });
  } finally {
    clearTimeout(watchdog);
    release?.();
  }
};
