import { captureResources, resourceSession } from "../storage/resource-runtime";
import { workflowResourceIds } from "../core/resource-catalog";
import { diagnose, executionBudget } from "../core/contracts";
import { execute } from "../core/engine";
import { labWorkflow } from "../core/lab";
import type { Candidate, Op, Params } from "../core/model";
let busy = false;
self.onmessage = async (event: MessageEvent<{ op: Op; params: Params; source: Candidate[]; seed: number }>) => {
  if (busy) return;
  busy = true;
  try {
    const { op, params, source, seed } = event.data;
    if (source.length > 10000 || source.some(c => c.text.length > 1024)) throw new Error("输入最多 10000 行，每行 1024 个代码单元");
    const workflow=labWorkflow(op,params,seed);
    const session=resourceSession(await captureResources(workflowResourceIds(workflow).filter(id=>id!=="__lab__")));
    const stats = await execute(workflow, async function* (id,seed,tick) {if(id==="__lab__")yield* source;else yield* session.read(id,seed,tick);}, async batch => {
      await session.check();
      self.postMessage({ type: "batch", batch: batch.map(c => ({ ...c, workflowId: undefined })) });
    }, { steps: executionBudget.steps, milliseconds: executionBudget.milliseconds }, {
      resourceMetadata:async id=>id==="__lab__"?{kind:"word"}:session.metadata(id),
      onProgress: progress => self.postMessage({ type: "progress", ...progress }),
    });
    await session.check();
    self.postMessage({ type: "done", stats });
  } catch (error) {
    self.postMessage({ type: "error", message: error instanceof Error ? error.message : "实验失败", diagnostic: diagnose(error).diagnostic });
  } finally { busy = false; }
};
