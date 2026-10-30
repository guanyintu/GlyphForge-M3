import type { Op, Params, Workflow } from "./model";
export function labWorkflow(op: Op, params: Params, seed = 42): Workflow {
  return { version: 1, id: "lab", name: "文字实验室", layout: {}, seed, limit: 10000,
    nodes: [
      { id: "input", op: "resource", inputs: [], params: { resourceId: "__lab__" } },
      { id: "transform", op, inputs: ["input"], params },
      { id: "result", op: "output", inputs: ["transform"], params: {} },
    ] };
}
