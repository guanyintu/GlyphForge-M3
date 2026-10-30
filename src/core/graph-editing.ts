import type { RuleNode, Workflow } from "./model";
import { operators } from "./model";
import { validateProgram } from "./program";
export interface NodeClipboard {
  format: "glyphforge-nodes";
  version: 1;
  nodes: RuleNode[];
  layout: Workflow["layout"];
  groups: Workflow["groups"];
}
export function copyNodes(
  workflow: Workflow,
  selected: string[],
): NodeClipboard {
  const ids = new Set(selected);
  const nodes = workflow.nodes.filter((n) => ids.has(n.id));
  return structuredClone({
    format: "glyphforge-nodes",
    version: 1,
    nodes,
    layout: Object.fromEntries(
      nodes.map((n) => [n.id, nodePosition(workflow, n.id)]),
    ),
    groups:
      workflow.groups
        ?.filter((g) => g.nodeIds.some((id) => ids.has(id)))
        .map((g) => ({
          ...g,
          nodeIds: g.nodeIds.filter((id) => ids.has(id)),
        })) || [],
  });
}
export function nodePosition(workflow: Workflow, id: string) {
  const point = workflow.layout[id];
  return point && Number.isFinite(point.x) && Number.isFinite(point.y)
    ? point
    : {
        x:
          Math.max(
            0,
            workflow.nodes.findIndex((n) => n.id === id),
          ) * 260,
        y: 100,
      };
}
export function autoLayout(workflow: Workflow): Workflow {
  const levels = new Map<string, number>(),
    visiting = new Set<string>(),
    rows = new Map<number, number>();
  function depth(id: string): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const n = workflow.nodes.find((n) => n.id === id);
    const value = n?.inputs.some(Boolean)
      ? 1 + Math.max(...n.inputs.filter(Boolean).map(depth))
      : 0;
    visiting.delete(id);
    levels.set(id, value);
    return value;
  }
  const layout: Workflow["layout"] = {};
  for (const n of workflow.nodes) {
    const col = depth(n.id),
      row = rows.get(col) || 0;
    layout[n.id] = { x: 40 + col * 285, y: 80 + row * 205 };
    rows.set(col, row + 1);
  }
  return { ...workflow, layout };
}
export function pasteNodes(
  workflow: Workflow,
  data: unknown,
): { workflow: Workflow; ids: string[]; disconnected: number } {
  if (!data || typeof data !== "object") throw new Error("无效的节点剪贴板");
  let payload = data as NodeClipboard;
  if ((data as { format: string }).format === "glyphforge-node")
    payload = {
      format: "glyphforge-nodes",
      version: 1,
      nodes: [(data as { node: RuleNode }).node],
      layout: {},
      groups: [],
    };
  if (
    payload.format !== "glyphforge-nodes" ||
    payload.version !== 1 ||
    !Array.isArray(payload.nodes) ||
    !payload.nodes.length ||
    payload.nodes.length + workflow.nodes.length > 200
  )
    throw new Error("剪贴板格式错误或节点超过 200 个");
  const originalIds = new Set<string>();
  payload.nodes.forEach((n) => {
    if (
      !n ||
      typeof n.id !== "string" ||
      originalIds.has(n.id) ||
      !Object.hasOwn(operators, n.op) ||
      !n.params ||
      !Array.isArray(n.inputs) ||
      n.inputs.some((id) => typeof id !== "string") ||
      n.inputs.length !== operators[n.op].inputs
    )
      throw new Error("节点格式无效");
    originalIds.add(n.id);
    for (const [key, value] of Object.entries(operators[n.op].defaults)) {
      if (
        typeof n.params[key] !== typeof value ||
        String(n.params[key]).length > 256
      )
        throw new Error("节点参数无效");
    }
    if (n.op === "program") validateProgram(n.program!);
  });
  const mapping = new Map(
    payload.nodes.map((n) => [
      n.id,
      `node_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    ]),
  );
  const layout = { ...workflow.layout };
  let disconnected = 0;
  const nodes = payload.nodes.map((n) => {
    const id = mapping.get(n.id)!;
    const point = payload.layout?.[n.id];
    layout[id] = {
      x: point && Number.isFinite(point.x) ? point.x + 70 : 300,
      y: point && Number.isFinite(point.y) ? point.y + 70 : 250,
    };
    return {
      ...structuredClone(n),
      id,
      inputs: n.inputs.map((input) => {
        if (mapping.has(input)) return mapping.get(input)!;
        disconnected++;
        return "";
      }),
    };
  });
  const groups = (payload.groups || []).map((g) => ({
    id: crypto.randomUUID(),
    name: String(g.name).slice(0, 60),
    nodeIds: g.nodeIds
      .filter((id) => mapping.has(id))
      .map((id) => mapping.get(id)!),
  }));
  return {
    workflow: {
      ...workflow,
      nodes: [...workflow.nodes, ...nodes],
      layout,
      groups: [...(workflow.groups || []), ...groups],
    },
    ids: nodes.map((n) => n.id),
    disconnected,
  };
}
export function groupNodes(
  workflow: Workflow,
  ids: string[],
  name = "节点组",
): Workflow {
  if (!ids.length) return workflow;
  return {
    ...workflow,
    groups: [
      ...(workflow.groups || []),
      { id: crypto.randomUUID(), name, nodeIds: ids },
    ],
  };
}
export class WorkflowHistory {
  private undoStack: Workflow[] = [];
  private redoStack: Workflow[] = [];
  push(current: Workflow) {
    this.undoStack.push(structuredClone(current));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
  }
  undo(current: Workflow) {
    const prev = this.undoStack.pop();
    if (prev) this.redoStack.push(structuredClone(current));
    return prev;
  }
  redo(current: Workflow) {
    const next = this.redoStack.pop();
    if (next) this.undoStack.push(structuredClone(current));
    return next;
  }
  get canUndo() {
    return !!this.undoStack.length;
  }
  get canRedo() {
    return !!this.redoStack.length;
  }
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
