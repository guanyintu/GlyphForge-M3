// Frozen e637beb lazy evaluator; import paths only adapted for differential tests.
import { ContractError, diagnose, executionBudget, nodeResourceBindings, normalizeParams, requireResourceKind } from "../../core/contracts";
import type { ResourceMetadataReader } from "../../core/contracts";
import { operatorRegistry } from "./p2e-legacy-operators";
import type { Candidate, CandidateSequence, Params, RuleNode, Workflow } from "../../core/model";
import { callBindings, definitionFor, MAX_CALL_DEPTH } from "../../core/subgraphs";
import { validateGraph } from "../../core/script";

import { resolveExtension } from "../../core/packs";
export type ResourceReader = (
  id: string,
  seed: number,
  tick?: () => void,
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
  for await (const value of evaluateWorkflow(workflow, reader, tick, hooks)) {
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

export async function* evaluateWorkflow(workflow: Workflow, reader: ResourceReader, tick: () => void, hooks: RunHooks = {}): AsyncGenerator<Candidate> {
  validateGraph(workflow);
  const nodes = new Map(workflow.nodes.map((n) => [n.id, n]));
  async function* evaluate(n: RuleNode, scope = nodes, bindings: Params = {}, args: Record<string, () => CandidateSequence> = {}, depth = 0, path = ""): AsyncGenerator<Candidate> {
    try {
      tick();
      if (n.op === "argument") { yield* args[String(n.params.name)](); return; }
      if (n.op === "call") {
        if (depth >= MAX_CALL_DEPTH) throw new ContractError({ code: "BUDGET", message: `子图调用深度超过 ${MAX_CALL_DEPTH}` });
        const d = definitionFor(n, workflow.subgraphs);
        const local = callBindings(n, d, bindings);
        const sequences = Object.fromEntries(d.parameters.filter(p => p.type === "CandidateSequence").map((p, i) => [p.name, () => evaluate(scope.get(n.inputs[i])!, scope, bindings, args, depth, path)]));
        const inner = new Map(d.nodes.map(n => [n.id, n]));
        yield* evaluate(inner.get(d.output)!, inner, local, sequences, depth + 1, `${path}${n.id}/`);
        return;
      }
      const params = { ...n.params };
      for (const [target, ref] of Object.entries(n.parameterBindings ?? {})) params[target] = bindings[ref];
      const bound = { ...n, params: normalizeParams(n.op, params) };
      if (n.op === "extension") {
        const resolved = resolveExtension(bound, workflow.extensions);
        function pipeline(index: number): CandidateSequence {
          if (index < 0) return evaluate(scope.get(n.inputs[0])!, scope, bindings, args, depth, path);
          const step = resolved.steps[index];
          return operatorRegistry[step.op].execute({node:{id:`${n.id}/${index}`,op:step.op,inputs:[],params:step.params},seed:workflow.seed,tick,read:(id,seed)=>reader(id,seed,tick),resourceMetadata:hooks.resourceMetadata,input:()=>pipeline(index-1)});
        }
        yield* pipeline(resolved.steps.length-1); return;
      }
      if (hooks.resourceMetadata) for (const binding of nodeResourceBindings(n.op, bound.params)) {
        await requireResourceKind(hooks.resourceMetadata, binding.id, binding.pair, binding.mapping);
        tick();
      }
      yield* operatorRegistry[n.op].execute({
        node: bound,
        seed: workflow.seed,
        tick,
        read: (id, seed) => reader(id, seed, tick),
        resourceMetadata: hooks.resourceMetadata,
        input: (index) => evaluate(scope.get(n.inputs[index])!, scope, bindings, args, depth, path),
      });
    } catch (error) {
      throw diagnose(error, { nodeId: `${path}${n.id}`, operator: n.op, line: n.line });
    }
  }
  yield* evaluate(workflow.nodes.find(n => n.op === "output")!);
}
