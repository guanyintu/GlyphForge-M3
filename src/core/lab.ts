import { ContractError, normalizeParams, operatorContracts } from "./contracts";
import type { Op, Params, Workflow } from "./model";
export function labWorkflow(op: Op, params: Params, seed = 42): Workflow {
  if (!operatorContracts[op].lab) throw new ContractError({ code: "TYPE", operator: op, message: "文字实验室需要单输入序列算子" });
  params = normalizeParams(op, params);
  return { version: 1, id: "lab", name: "文字实验室", layout: {}, seed, limit: 10000,
    nodes: [
      { id: "input", op: "resource", inputs: [], params: { resourceId: "__lab__" } },
      { id: "transform", op, inputs: ["input"], params },
      { id: "result", op: "output", inputs: ["transform"], params: {} },
    ] };
}
