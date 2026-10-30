import { ContractError, normalizeParams, operatorContracts } from "./contracts";
import { operators } from "./model";
import type { Params, RuleNode, SubgraphDefinition, SubgraphParameter, Workflow } from "./model";

export const MAX_CALL_DEPTH = 12;
export const keyOf = (d: { id: string; version: number }) => `${d.id}@${d.version}`;
const nameOK = (s: string) => /^[A-Za-z_]\w{0,63}$/.test(s) && !["__proto__", "prototype", "constructor", "return", "fn", "let", "for", "in", "if", "else", "emit", "true", "false"].includes(s);
function fail(message: string, node?: RuleNode, code: "TYPE" | "SCOPE" | "BUDGET" | "PARAMETER" = "TYPE"): never {
  throw new ContractError({ code, message, nodeId: node?.id, line: node?.line });
}
export function definitionFor(node: RuleNode, definitions: SubgraphDefinition[] = []) {
  const d = definitions.find(d => d.id === node.call?.definitionId && d.version === node.call?.version);
  if (!d) fail(`子图引用缺失或版本不兼容：${node.call?.definitionId ?? "未绑定"}@${node.call?.version ?? "?"}`, node);
  return d;
}
export function inputCount(n: RuleNode, defs: SubgraphDefinition[] = []) {
  return n.op === "call" ? definitionFor(n, defs).parameters.filter(p => p.type === "CandidateSequence").length : operators[n.op].inputs;
}
function scalar(p: SubgraphParameter, value: unknown) {
  if (typeof value !== p.type || (typeof value === "number" && !Number.isFinite(value)) || (typeof value === "string" && value.length > 16384))
    fail(`参数 ${p.name} 需要 ${p.type}`, undefined, "PARAMETER");
  return value as Params[string];
}
export function callBindings(node: RuleNode, d: SubgraphDefinition, outer: Params = {}): Params {
  const result: Params = {};
  const supplied = node.call?.bindings ?? {};
  if (Object.keys(supplied).some(k => !d.parameters.some(p => p.name === k && p.type !== "CandidateSequence"))) fail("未知调用参数", node);
  for (const p of d.parameters.filter(p => p.type !== "CandidateSequence")) {
    const ref = node.parameterBindings?.[p.name];
    const value = ref ? outer[ref] : Object.hasOwn(supplied, p.name) ? supplied[p.name] : p.default;
    try { result[p.name] = scalar(p, value); } catch (e) { if (e instanceof ContractError) throw new ContractError({ ...e.diagnostic, nodeId: node.id, line: node.line }); throw e; }
  }
  return result;
}
/** Definitions form an explicit DAG. No caller variables are visible to the callee. */
export function validateSubgraphs(w: Workflow, validateBody: (w: Workflow, scope?: SubgraphDefinition) => void) {
  const defs = w.subgraphs ?? [];
  if (!Array.isArray(defs) || defs.length > 100 || defs.reduce((a, d) => a + (d.nodes?.length || 0), 0) > 2000) fail("子图最多 100 个版本、共 2000 个内部节点");
  const keys = new Set<string>();
  for (const d of defs) {
    if (!d || typeof d.id !== "string" || !d.id.length || d.id.length > 100 || !Number.isSafeInteger(d.version) || d.version < 1 || typeof d.name !== "string" || !d.name.trim() || d.name.length > 100 || d.returns !== "CandidateSequence" || !Array.isArray(d.parameters) || d.parameters.length > 16 || !Array.isArray(d.nodes)) fail("子图定义或版本无效");
    if (keys.has(keyOf(d))) fail("子图 ID/version 重复"); keys.add(keyOf(d));
    const names = new Set<string>();
    for (const p of d.parameters) {
      if (!p || !nameOK(p.name) || names.has(p.name) || !["string", "number", "boolean", "CandidateSequence"].includes(p.type)) fail("子图参数名或类型无效");
      names.add(p.name);
      if (Object.hasOwn(p, "default")) { if (p.type === "CandidateSequence") fail("序列参数必须显式连线"); scalar(p, p.default); }
    }
  }
  const done = new Map<string, number>(), visiting = new Set<string>();
  function visit(d: SubgraphDefinition): number {
    const key = keyOf(d); if (visiting.has(key)) fail(`禁止循环子图依赖：${key}`);
    if (done.has(key)) return done.get(key)!;
    visiting.add(key);
    let depth = 1;
    for (const n of d.nodes) if (n.op === "call") depth = Math.max(depth, 1 + visit(definitionFor(n, defs)));
    if (depth > MAX_CALL_DEPTH) fail(`子图调用深度超过 ${MAX_CALL_DEPTH}`, undefined, "BUDGET");
    visiting.delete(key); done.set(key, depth);
    validateBody({ ...w, nodes: d.nodes }, d);
    return depth;
  }
  defs.forEach(visit);
}
export function validateScopedNode(n: RuleNode, defs: SubgraphDefinition[], scope?: SubgraphDefinition) {
  const parameters = scope?.parameters ?? [];
  if (scope && (!nameOK(n.id) || parameters.some(p => p.name === n.id))) fail("局部节点名称重复、保留或遮蔽参数", n, "SCOPE");
  for (const [target, ref] of Object.entries(n.parameterBindings ?? {})) {
    const p = parameters.find(p => p.name === ref);
    const type = n.op === "call" ? definitionFor(n, defs).parameters.find(p => p.name === target)?.type : operatorContracts[n.op]?.parameters[target]?.type;
    if (!p || p.type === "CandidateSequence" || !type || type !== p.type) fail(`参数 ${target} 引用 ${ref} 越界或类型不符`, n, "SCOPE");
    // Resources are static dependencies, never opaque caller captures.
    if (["resourceId", "slots"].includes(target)) fail("资源依赖必须为静态 ID", n, "SCOPE");
  }
  if (n.op === "argument") {
    if (!parameters.some(p => p.name === n.params.name && p.type === "CandidateSequence")) fail("序列参数超出词法作用域", n, "SCOPE");
  } else if (n.op === "call") {
    const d = definitionFor(n, defs);
    const outer = Object.fromEntries(parameters.filter(p => p.type !== "CandidateSequence").map(p => [p.name, p.default ?? (p.type === "string" ? "" : p.type === "number" ? 0 : false)]));
    callBindings(n, d, outer);
  } else normalizeParams(n.op, n.params);
}
export function allNodes(w: Workflow) { return [...w.nodes, ...(w.subgraphs ?? []).flatMap(d => d.nodes)]; }
export function reachableDefinitions(nodes: RuleNode[], defs: SubgraphDefinition[] = []) {
  const found = new Map<string, SubgraphDefinition>();
  function visit(nodes: RuleNode[]) { for (const n of nodes) if (n.op === "call") { const d = definitionFor(n, defs); if (!found.has(keyOf(d))) { found.set(keyOf(d), d); visit(d.nodes); } } }
  visit(nodes); return [...found.values()];
}
/** Only small definitions are copied; resource entries and candidates are never embedded. */
export function mergeDefinitions(existing: SubgraphDefinition[] = [], incoming: SubgraphDefinition[] = []) {
  const mapping = new Map<string, string>();
  for (const d of incoming) if (existing.some(e => keyOf(e) === keyOf(d) && JSON.stringify(e) !== JSON.stringify(d))) mapping.set(d.id, crypto.randomUUID());
  const rewrite = (n: RuleNode): RuleNode => n.call && mapping.has(n.call.definitionId) ? { ...n, call: { ...n.call, definitionId: mapping.get(n.call.definitionId)! } } : n;
  const defs = incoming.map(d => ({ ...structuredClone(d), id: mapping.get(d.id) ?? d.id, nodes: d.nodes.map(n => rewrite(structuredClone(n))) }));
  return { definitions: [...existing, ...defs.filter(d => !existing.some(e => keyOf(e) === keyOf(d)))], rewrite };
}
export function extractSubgraph(w: Workflow, selected: string[], name = "可复用命名函数") {
  const ids = new Set(selected), nodes = w.nodes.filter(n => ids.has(n.id));
  if (!nodes.length || nodes.some(n => n.op === "output" || n.op === "argument")) fail("请选择输出节点以外的处理节点");
  const outputs = nodes.filter(n => w.nodes.some(x => !ids.has(x.id) && x.inputs.includes(n.id)) || !nodes.some(x => x.inputs.includes(n.id)));
  if (outputs.length !== 1) fail("当前支持单一序列返回，请选择只有一个出口的子图");
  const external = [...new Set(nodes.flatMap(n => n.inputs.filter(id => !ids.has(id))))];
  const parameters: SubgraphParameter[] = external.map((_, i) => ({ name: `input${i + 1}`, type: "CandidateSequence" }));
  const args: RuleNode[] = external.map((_, i) => ({ id: `arg_${i + 1}`, op: "argument", params: { name: parameters[i].name }, inputs: [] }));
  const definition: SubgraphDefinition = { id: crypto.randomUUID(), version: 1, name, parameters, returns: "CandidateSequence", output: outputs[0].id, nodes: [...args, ...structuredClone(nodes).map(n => ({ ...n, inputs: n.inputs.map(id => external.includes(id) ? args[external.indexOf(id)].id : id) }))], layout: structuredClone(w.layout) };
  const id = `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const call: RuleNode = { id, op: "call", inputs: external, params: {}, call: { definitionId: definition.id, version: 1, bindings: {} } };
  return { definition, call, workflow: { ...w, subgraphs: [...(w.subgraphs ?? []), definition], nodes: [...w.nodes.filter(n => !ids.has(n.id)).map(n => ({ ...n, inputs: n.inputs.map(ref => ids.has(ref) ? id : ref) })), call], layout: { ...w.layout, [id]: w.layout[nodes[0].id] ?? { x: 300, y: 100 } }, groups: w.groups?.map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => !ids.has(id)) })) } };
}
