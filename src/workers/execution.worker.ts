import { execute } from "../core/engine";
import type { Workflow } from "../core/model";
import { db, readResource } from "../storage/db";
self.onmessage = async (event: MessageEvent<Workflow>) => {
  let runId = "";
  const watchdog = setTimeout(() => {
    self.postMessage({
      type: "error",
      message: "达到 10 秒执行时间上限，请缩小词库或调整条件",
    });
    self.close();
  }, 10000);
  try {
    runId = crypto.randomUUID();
    const versions = new Map(
      (await db.resources.toArray()).map((r) => [r.id, r.version]),
    );
    await db.runs.put({
      id: runId,
      workflow: event.data,
      versions: Object.fromEntries(versions),
      createdAt: Date.now(),
      status: "running",
      count: 0,
    });
    self.postMessage({ type: "started", runId });
    let pending = Promise.resolve();
    const stats = await execute(
      event.data,
      async function* (id, seed) {
        if ((await db.resources.get(id))?.version !== versions.get(id))
          throw new Error("词库在运行期间发生更改，请重新生成");
        for await (const candidate of readResource(id, seed)) {
          if (candidate.parts[0].version !== versions.get(id))
            throw new Error("资源版本发生变化，请重新生成");
          yield candidate;
        }
      },
      (batch) => {
        self.postMessage({ type: "batch", batch });
        pending = pending
          .then(() => db.generated.bulkPut(batch.map((c) => ({ ...c, runId }))))
          .then(() => undefined);
      },
      { steps: 300000, milliseconds: 10000 },
      {
        runId,
        onProgress: (progress) =>
          self.postMessage({ type: "progress", ...progress }),
      },
    );
    await pending;
    const record = await db.runs.get(runId);
    if (record)
      await db.runs.put({ ...record, status: "done", count: stats.count });
    const old = (
      await db.runs.orderBy("createdAt").reverse().offset(20).limit(1).toArray()
    ).map((r) => r.id);
    for (const id of old) await db.generated.where("runId").equals(id).delete();
    self.postMessage({ type: "done", stats });
  } catch (error) {
    try {
      const record = runId ? await db.runs.get(runId) : undefined;
      if (record)
        await db.runs.put({
          ...record,
          status: "error",
          count: await db.generated.where("runId").equals(runId).count(),
        });
    } catch {
      /* Report original execution failure even when storage is unavailable. */
    }
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "生成失败",
    });
  } finally {
    clearTimeout(watchdog);
  }
};
