import { curate } from "./curation";
import { resolveMapping, mappingSource } from "./mapping-resource";
import { boundedText, combineCandidates, normalizeParams, transformText, operatorContracts } from "./contracts";
import { candidateText, glyphs, operators } from "./model";
import type { CandidateSequence, Op, OperatorDefinition, RuleNode } from "./model";
import { executeProgram } from "./program";
import { chineseDefinitions } from "./chinese-definitions";
import type { ChineseOp } from "./chinese-definitions";
import { readPairs, renderTemplates, groupMembers } from "./relations";
import { checkGameId, parseGameRule } from "./game-rules";
import { mutate } from "./mutation";
import { measure, type ExecutionMetrics } from './execution-metrics';
export interface OperatorContext {
  metrics?: ExecutionMetrics;
  optimize?: boolean;
  /** Pure rejection after text bounds; upstream iteration and all ticks remain unchanged. */
  acceptText?: (text: string) => boolean;
  resourceMetadata?: import("./contracts").ResourceMetadataReader;
  node: RuleNode;
  seed: number;
  tick: () => void;
  input: (index: number) => CandidateSequence;
  read: (id: string, seed: number) => CandidateSequence;
}
export interface RegisteredOperator extends OperatorDefinition {
  contract: (typeof operatorContracts)[Op];
  execute: (context: OperatorContext) => CandidateSequence;
}
export function patternText(template: string, a: string, b: string) {
  return transformText("pattern", [a, b], normalizeParams("pattern", { template }));
}
export { boundedText } from "./contracts";
export function acceptsFilter(text: string, p: RuleNode["params"]) {
  return glyphs(text).length <= Number(p.maxLength) && text.includes(String(p.includes)) && (!p.excludes || !text.includes(String(p.excludes)));
}
const executors: Record<Op, RegisteredOperator["execute"]> = {
  extension: async function* () { throw new Error("扩展需要固定版本执行作用域"); },
  mutate,
  curate: c => curate(c.input(0), c.node.params, c.seed, c.tick, c.node.params.reviewedResourceId ? c.read(String(c.node.params.reviewedResourceId), c.seed) : undefined),
  call: async function* () { throw new Error("子图调用需要执行器作用域"); },
  argument: async function* () { throw new Error("序列参数需要执行器作用域"); },
  gamecheck: async function* (c) {
    const rule = parseGameRule(String(c.node.params.rules));
    for await (const item of c.input(0)) { c.tick(); const result = checkGameId(item.text, rule); if (c.node.params.mode === "annotate") yield { ...item, notes: [...(item.notes || []), ...result.errors, ...result.warnings, result.valid ? "符合本地游戏规则" : "不符合本地游戏规则"] }; else if (result.valid) yield item; }
  },
  pairs: c => readPairs(c.read, String(c.node.params.resourceId), c.seed, String(c.node.params.relation), c.tick),
  template: c => renderTemplates(c.node.params, c.read, c.seed, c.tick),
  group: c => groupMembers(c.input(0), c.node.params, c.seed, c.tick),
  ...Object.fromEntries(Object.keys(chineseDefinitions).map(op => [op, async function* (c: OperatorContext) {
    const { transformChinese } = await import("./chinese");
    const resolved = op === "mapchars" || op === "hanconvert" ? await resolveMapping(c.node.params, c.resourceMetadata) : {params:c.node.params};
    for await (const item of c.input(0)) {
      const actualOp = resolved.resource && op === "hanconvert" ? "mapchars" : op as ChineseOp;
      for await (const result of transformChinese(actualOp, item, resolved.params, c.seed, c.tick)) {
        c.tick();
        yield { ...(resolved.resource ? mappingSource(result, String(c.node.params.mappingId), resolved.resource.version!, item.text) : result), text: boundedText(result.text) };
      }
    }
  }])) as unknown as Record<ChineseOp, RegisteredOperator["execute"]>,
  resource: async function* (c) {
    for await (const item of c.read(String(c.node.params.resourceId), c.seed)) {
      c.tick();
      if (item.pair) throw new Error("关系词库请使用关系词对或共享变量模板节点");
      yield item;
    }
  },
  program: async function* (c) {
    yield* executeProgram(c.node.program!, c.read, c.seed, c.tick, c.resourceMetadata);
  },
  pattern: async function* (c) {
    // normalizeParams has already accepted 1–16 ASCII A/B tokens. Replacement
    // callbacks return literal strings (including $&); joining selects the same
    // strings and boundedText still executes at the original candidate/tick.
    const tokens=c.optimize===false?undefined:[...String(c.node.params.template)].map(s=>s==='A'?0:1);
    for await (const a of c.input(0)) {
      c.tick();
      for await (const b of c.input(1)) {
        c.tick();
        const text = measure(c.metrics,'text',()=>tokens?boundedText(tokens.map(i=>i===0?a.text:b.text).join('')):transformText("pattern", [a.text, b.text], c.node.params));
        if (c.acceptText && !c.acceptText(text)) continue;
        yield measure(c.metrics,'metadata',()=>combineCandidates(text, [a, b]));
      }
    }
  },
  concat: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      for await (const b of c.input(1)) {
        c.tick();
        const text = measure(c.metrics,'text',()=>transformText("concat", [a.text, b.text], c.node.params));
        if (c.acceptText && !c.acceptText(text)) continue;
        yield measure(c.metrics,'metadata',()=>combineCandidates(text, [a, b]));
      }
    }
  },
  filter: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      if (measure(c.metrics,'filter',()=>acceptsFilter(a.text, c.node.params))) yield a;
    }
  },
  prefix: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      yield candidateText(a, transformText("prefix", [a.text], c.node.params));
    }
  },
  reverse: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      yield candidateText(a, transformText("reverse", [a.text], c.node.params));
    }
  },
  output: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      yield a;
    }
  },
};
export const operatorRegistry = Object.fromEntries(
  Object.entries(operators).map(([id, definition]) => [
    id,
    { ...definition, contract: operatorContracts[id as Op], execute: (c: OperatorContext) => executors[id as Op]({ ...c, node: { ...c.node, params: normalizeParams(id as Op, c.node.params) } }) },
  ]),
) as Record<Op, RegisteredOperator>;
