import { assertWorkflowPacks } from "../storage/packs";
import { captureResources, resourceSession } from "../storage/resource-runtime";
import { dependencyIds } from "../core/sharing";
import { diagnose, executionBudget } from "../core/contracts";
import { execute } from "../core/engine";
import { record as recordTiming, type ExecutionMetrics } from '../core/execution-metrics';
import type { Workflow } from "../core/model";
import { db } from "../storage/db";
import { acquireRunLock, beginRun, appendRunBatch, finishRun, pruneHistory } from "../storage/run-lifecycle";
self.onmessage = async (event: MessageEvent<Workflow | { workflow: Workflow; runId?: string; keep?: number; optimize?: boolean; profile?: boolean }>) => {
  const managed = "workflow" in event.data;
  const workflow = managed ? event.data.workflow : event.data;
  const runId = managed && event.data.runId ? event.data.runId : crypto.randomUUID();
  const owned = !managed || !event.data.runId;
  const keep = managed ? event.data.keep ?? 20 : 20;
  const metrics:ExecutionMetrics|undefined=managed&&event.data.profile?{}:undefined;
  const options={optimize:managed?event.data.optimize:undefined,metrics};
  const workerStart=performance.now();
  let release: (() => void) | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    if (owned) { release = await acquireRunLock(runId); await beginRun(workflow, runId); }
    const record = await db.runs.get(runId);
    if (!record || record.status !== "running") throw new Error("运行已停止");
    const plan = await captureResources(dependencyIds(workflow));
    if (JSON.stringify(plan.versions) !== JSON.stringify(record.versions)) throw new Error("源资源在启动期间发生更改，请重新生成");
    await assertWorkflowPacks(workflow,plan.resources);
    const session = resourceSession(plan,db,undefined,options);
    const read=async function* (id:string,seed:number,tick?:()=>void) {
      const iterator=session.read(id,seed,tick)[Symbol.asyncIterator]();
      try {while(true){const start=performance.now(),next=await iterator.next();recordTiming(metrics,'readInclusive',performance.now()-start);if(next.done)return;yield next.value;}}
      finally {await iterator.return?.(undefined);}
    };
    recordTiming(metrics,'prepare',performance.now()-workerStart);
    self.postMessage({ type: "started", runId });
    watchdog = setTimeout(() => {
      expired = true;
      // Storage may itself be blocked. Notify the owner first so its hard stop
      // and terminal-state retry do not depend on this pending transaction.
      self.postMessage({ type: "error", message: "达到 10 秒执行时间上限，请缩小词库或调整条件", diagnostic: { code: "BUDGET", message: "达到 10 秒执行时间上限" } });
      void finishRun(runId, "error", "达到 10 秒执行时间上限").catch(() => {}).finally(() => self.close());
    }, executionBudget.milliseconds);
    const stats = await execute(workflow, metrics?read:session.read, async batch => {
      const persistStart=performance.now();
      await session.check();
      await appendRunBatch(runId, batch);
      recordTiming(metrics,'persistence',performance.now()-persistStart);
      const messageStart=performance.now();
      self.postMessage({ type: "batch", batch });
      recordTiming(metrics,'messageEnqueue',performance.now()-messageStart);
    }, { steps: executionBudget.steps, milliseconds: executionBudget.milliseconds }, {
      resourceMetadata: session.metadata,
      ...options,
      runId, onProgress: progress => self.postMessage({ type: "progress", ...progress }),
    });
    const terminalStart=performance.now();
    await session.check();
    await finishRun(runId, "done");
    recordTiming(metrics,'terminalPersistence',performance.now()-terminalStart);
    let cleanupError = "";
    const retentionStart=performance.now();
    if (owned) try { await pruneHistory(keep); } catch (e) { cleanupError = String(e); }
    recordTiming(metrics,'historyRetention',performance.now()-retentionStart);
    if ((await db.runs.get(runId))?.status === "done") self.postMessage({ type: "done", stats, metrics, cleanupError });
  } catch (error) {
    if (expired) return; // The watchdog already sent the terminal notification.
    const message = error instanceof Error ? error.message : "生成失败";
    try { await finishRun(runId, "error", message); } catch { /* UI/next boot retries recovery if storage failed. */ }
    let cleanupError = "";
    if (owned) try { await pruneHistory(keep); } catch (e) { cleanupError = String(e); }
    self.postMessage({ type: "error", message, diagnostic: diagnose(error).diagnostic, cleanupError });
  } finally {
    clearTimeout(watchdog);
    release?.();
  }
};
