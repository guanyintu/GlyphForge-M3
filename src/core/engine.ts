import { ContractError, diagnose, executionBudget, nodeResourceBindings, normalizeParams, requireResourceKind } from "./contracts";
import type { ResourceMetadataReader } from "./contracts";
import { operatorRegistry } from "./operators";
import type { Candidate, RuleNode, Workflow } from "./model";
import { validateGraph } from "./script";

export type ResourceReader = (
  id: string,
  seed: number,
) => AsyncIterable<Candidate>;
export interface RunStats {
  steps: number;
  count: number;
  truncated: boolean;
  duration: number;
}
export interface RunHooks {
  signal?: AbortSignal;
  runId?: string;
  resourceMetadata?: ResourceMetadataReader;
  onProgress?: (progress: {
    steps: number;
    count: number;
    elapsed: number;
    nodeId?: string;
  }) => void;
}
export async function execute(
  workflow: Workflow,
  reader: ResourceReader,
  onBatch: (batch: Candidate[]) => unknown,
  limits: { steps: number; milliseconds: number } = { steps: executionBudget.steps, milliseconds: executionBudget.milliseconds },
  hooks: RunHooks = {},
): Promise<RunStats> {
  validateGraph(workflow);
  const started = performance.now();
  let steps = 0,
    count = 0,
    truncated = false,
    batch: Candidate[] = [];
  const nodes = new Map(workflow.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  function tick() {
    if (hooks.signal?.aborted) throw new ContractError({ code: "CANCELLED", message: "任务已取消" });
    if (++steps > limits.steps)
      throw new ContractError({ code: "BUDGET", message: "达到执行步数上限，请缩小词库或调整筛选条件" });
    if (performance.now() - started > limits.milliseconds)
      throw new ContractError({ code: "BUDGET", message: "达到执行时间上限，请缩小范围后重试" });
    if (steps % 1000 === 0)
      hooks.onProgress?.({
        steps,
        count,
        elapsed: performance.now() - started,
      });
  }
  async function* evaluate(n: RuleNode): AsyncGenerator<Candidate> {
    try {
      tick();
      if (hooks.resourceMetadata) for (const binding of nodeResourceBindings(n.op, normalizeParams(n.op, n.params))) {
        await requireResourceKind(hooks.resourceMetadata, binding.id, binding.pair);
        tick();
      }
      yield* operatorRegistry[n.op].execute({
        node: n,
        seed: workflow.seed,
        tick,
        read: reader,
        resourceMetadata: hooks.resourceMetadata,
        input: (index) => evaluate(nodes.get(n.inputs[index])!),
      });
    } catch (error) {
      throw diagnose(error, { nodeId: n.id, operator: n.op });
    }
  }
  for await (const value of evaluate(
    workflow.nodes.find((n) => n.op === "output")!,
  )) {
    if (seen.has(value.text)) continue;
    if (count >= workflow.limit) {
      truncated = true;
      break;
    }
    seen.add(value.text);
    count++;
    batch.push({
      ...value,
      workflowId: workflow.id,
      seed: workflow.seed,
      ...(hooks.runId ? { runId: hooks.runId } : {}),
    });
    if (batch.length >= executionBudget.batch) {
      await onBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await onBatch(batch);
  return { steps, count, truncated, duration: performance.now() - started };
}
