import { validateCuration } from "./curation";
import { mergeLineage } from "./lineage";
import { operators } from "./model";
import type { Candidate, Op, Params, Resource, SourcePart } from "./model";
import { isChineseOp, validateChineseParams } from "./chinese-definitions";
import { templateConfig, validateRelationParams } from "./relations";
import { parseGameRule } from "./game-rules";
import { glyphs } from "./unicode";
import { mutationConfig } from "./mutation";

export type ScalarType = "string" | "number" | "boolean";
export type ValueType = ScalarType | "strings" | "numbers" | "booleans" | "pair" | "pairs";
export type DiagnosticCode = "PARAMETER" | "TYPE" | "SCOPE" | "RESOURCE" | "BUDGET" | "CANCELLED" | "EXECUTION";
export interface Diagnostic { code: DiagnosticCode; message: string; nodeId?: string; line?: number; operator?: string; parameter?: string }
export class ContractError extends Error {
  constructor(public diagnostic: Diagnostic) {
    super(`${diagnostic.nodeId ? `节点 ${diagnostic.nodeId}：` : ""}${diagnostic.line ? `第 ${diagnostic.line} 行：` : ""}${diagnostic.message}`);
    this.name = "ContractError";
  }
}
export function diagnose(error: unknown, context: Partial<Diagnostic> = {}): ContractError {
  const diagnostic: Diagnostic = error instanceof ContractError ? error.diagnostic : {
    code: context.code ?? "EXECUTION", message: error instanceof Error ? error.message : "算子执行失败",
  };
  return new ContractError({ ...context, ...diagnostic, nodeId: diagnostic.nodeId ?? context.nodeId, line: diagnostic.line ?? context.line });
}
export const executionBudget = Object.freeze({ steps: 300000, milliseconds: 10000, results: 10000, batch: 64, textCodeUnits: 1024 });
export interface AstSignature { args: ValueType[]; result: ValueType; required: number; parameters?: (string | null)[] }
const scalarType = (value: Params[string]): ScalarType => {
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  return "boolean";
};
function astSignature(op: Op): AstSignature | undefined {
  const keys = Object.keys(operators[op].defaults);
  if (isChineseOp(op)) return { args: ["string", ...keys.map(k => scalarType(operators[op].defaults[k]))], result: "strings", required: 1, parameters: [null, ...keys] };
  switch (op) {
    case "resource": return { args: ["string"], result: "strings", required: 1, parameters: ["resourceId"] };
    case "pairs": return { args: ["string", "string"], result: "pairs", required: 1, parameters: ["resourceId", "relation"] };
    case "gamecheck": return { args: ["string", "string"], result: "boolean", required: 1, parameters: [null, "rules"] };
    case "pattern": return { args: ["string", "string", "string"], result: "string", required: 3, parameters: ["template", null, null] };
    case "concat": return { args: ["string", "string", "string"], result: "string", required: 2, parameters: [null, null, "separator"] };
    case "prefix": return { args: ["string", "string"], result: "string", required: 1, parameters: [null, "text"] };
    case "reverse": return { args: ["string"], result: "string", required: 1, parameters: [null] };
    default: return undefined;
  }
}
export interface OperatorContract {
  id: Op;
  version: number;
  graph: { inputs: "CandidateSequence"[]; output: "CandidateSequence" };
  parameters: Record<string, { type: ScalarType; default: Params[string]; maxLength: number }>;
  ast?: AstSignature;
  lab: boolean;
  determinism: "seed-and-resource-versions";
  streaming: "incremental" | "buffered";
  budget: { scope: "run"; tick: "inherited"; limits: typeof executionBudget };
}
function buildContract(op: Op): OperatorContract {
  const def = operators[op];
  return {
    id: op, version: def.version, graph: { inputs: def.inputTypes, output: def.outputType },
    parameters: Object.fromEntries(Object.entries(def.defaults).map(([key, value]) => [key, { type: scalarType(value), default: value, maxLength: parameterLimit(op, key) }])),
    ast: astSignature(op), lab: isChineseOp(op) || ["prefix", "reverse", "filter"].includes(op),
    determinism: "seed-and-resource-versions",
    streaming: def.streaming ? "incremental" : "buffered",
    budget: { scope: "run", tick: "inherited", limits: executionBudget },
  };
}
export const operatorContracts = Object.fromEntries(
  Object.keys(operators).map(id => [id, buildContract(id as Op)]),
) as Record<Op, OperatorContract>;
export const astSignatures: Record<string, AstSignature> = {
  ...Object.fromEntries(Object.values(operatorContracts).filter(c => c.ast).map(c => [c.id, c.ast!])),
  ...Object.fromEntries(["left", "right", "relation"].map(name => [name, { args: ["pair"], result: "string", required: 1 }])),
  range: { args: ["number", "number"], result: "numbers", required: 2 },
  length: { args: ["string"], result: "number", required: 1 },
  contains: { args: ["string", "string"], result: "boolean", required: 2 },
  startsWith: { args: ["string", "string"], result: "boolean", required: 2 },
  endsWith: { args: ["string", "string"], result: "boolean", required: 2 },
  text: { args: ["number"], result: "string", required: 1 },
};
export function parameterLimit(op: Op, key: string) {
  if (op === "extension" && key === "values") return 8192;
  if (op === "mutate" && key === "source") return 32768;
  if (op === "mutate" && key === "locks") return 512;
  return (op === "gamecheck" && key === "rules") || (op === "mapchars" && key === "mapping") || (op === "template" && ["slots", "templates"].includes(key)) ? 16384 : 256;
}
/** Missing parameters acquire defaults; explicit wrong values never coerce. Unknown legacy fields survive. */
export function normalizeParams(op: Op, supplied: Params): Params {
  if (!Object.hasOwn(operators, op)) throw new ContractError({ code: "TYPE", message: `未知算子 ${op}` });
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new ContractError({ code: "PARAMETER", operator: op, message: "节点参数无效" });
  const p = { ...operators[op].defaults, ...supplied };
  try {
    for (const [key, value] of Object.entries(operators[op].defaults)) {
      if (typeof p[key] !== typeof value || (typeof p[key] === "number" && !Number.isFinite(p[key])))
        throw new ContractError({ code: "PARAMETER", operator: op, parameter: key, message: `${key} 参数类型错误或不是有限数值` });
      if (typeof p[key] === "string" && String(p[key]).length > parameterLimit(op, key))
        throw new ContractError({ code: "PARAMETER", operator: op, parameter: key, message: `${key} 文字参数过长` });
    }
    if (isChineseOp(op)) validateChineseParams(op, p);
    if (op === "mutate") mutationConfig(p);
    validateRelationParams(op, p);
    if (op === "curate") validateCuration(p);
    if (op === "gamecheck") { parseGameRule(String(p.rules)); if (!["filter", "annotate"].includes(String(p.mode))) throw new Error("游戏检查模式无效"); }
    if (op === "pattern" && !/^[AB]{1,16}$/.test(String(p.template))) throw new Error("模式需为 1–16 个 A / B，例如 AABB");
    if (op === "filter" && (Number(p.maxLength) < 1 || Number(p.maxLength) > 100)) throw new Error("长度限制需要在 1–100 之间");
    if (["resource", "pairs"].includes(op) && !String(p.resourceId).trim()) throw new Error("资源引用无效");
  } catch (error) { throw diagnose(error, { code: "PARAMETER", operator: op }); }
  return p;
}
export function astParams(op: Op, values: (Params[string] | undefined)[]): Params {
  const signature = operatorContracts[op].ast!;
  const supplied: Params = {};
  signature.parameters?.forEach((key, i) => { if (key && values[i] !== undefined) supplied[key] = values[i]!; });
  return normalizeParams(op, supplied);
}
export function boundedText(text: string) {
  if (text.length > executionBudget.textCodeUnits) throw new ContractError({ code: "BUDGET", message: "单条文字超过 1024 个代码单元" });
  return text;
}
export function transformText(op: "pattern" | "concat" | "prefix" | "reverse", texts: string[], p: Params): string {
  if (op === "pattern") return boundedText(String(p.template).replace(/[AB]/g, c => texts[c === "A" ? 0 : 1]));
  if (op === "concat") return boundedText(texts[0] + String(p.separator) + texts[1]);
  if (op === "prefix") return boundedText(String(p.text) + texts[0]);
  return boundedText(glyphs(texts[0]).reverse().join(""));
}
export function uniqueParts(parts: SourcePart[]) {
  return [...new Map(parts.map(p => [JSON.stringify([p.resourceId, p.text, p.version, p.pair]), p])).values()];
}
export function combineCandidates(text: string, items: Candidate[]): Candidate {
  const notes = [...new Set(items.flatMap(c => c.notes || []))];
  const lineage = mergeLineage(items);
  return { text, ...(lineage ? {lineage} : {}), parts: uniqueParts(items.flatMap(c => c.parts)), ...(notes.length ? { notes } : {}) };
}
export type ResourceMetadataReader = (id: string) => Promise<(Pick<Resource, "kind"> & Partial<Resource>) | undefined>;
export async function requireResourceKind(meta: ResourceMetadataReader, id: string, pair: boolean, mapping = false) {
  const resource = await meta(id);
  if (!resource) throw new ContractError({ code: "RESOURCE", message: `未找到资源 ${id}，请重新绑定词库` });
  if (mapping) { if(resource.kind !== "mapping") throw new ContractError({code:"TYPE",message:"请选择 Mapping 资源"}); return; }
  if (resource.kind === "mapping") throw new ContractError({code:"TYPE",message:"Mapping 不能用作词库"});
  if ((resource.kind === "relation") !== pair) throw new ContractError({ code: "TYPE", message: pair ? "请选择关系词库，普通词条不能用作关系词对" : "关系词库请使用关系词对或共享变量模板节点" });
}
export function nodeResourceBindings(op: Op, p: Params): { id: string; pair: boolean; mapping?: boolean }[] {
  if (op === "curate" && p.reviewedResourceId) return [{ id: String(p.reviewedResourceId), pair: true }];
  const maps = p.mappingId && ["mapchars","hanconvert","mutate","extension"].includes(op) ? [{id:String(p.mappingId),pair:false,mapping:true}] : [];
  if (op === "mutate") return [...maps,...(p.resourceId ? [{id:String(p.resourceId),pair:false}] : [])];
  if (maps.length) return maps;
  if (op === "resource" || op === "pairs") return [{ id: String(p.resourceId), pair: op === "pairs" }];
  if (op === "template") return templateConfig(p).slots.map(s => ({ id: s.resourceId, pair: s.kind === "pair" }));
  return [];
}
