import { candidateText, glyphs, operators } from "./model";
import type { Candidate, Op, OperatorDefinition, RuleNode } from "./model";
import { executeProgram } from "./program";
import { chineseDefinitions } from "./chinese-definitions";
import type { ChineseOp } from "./chinese-definitions";
import { readPairs, renderTemplates, groupMembers } from "./relations";
export interface OperatorContext {
  node: RuleNode;
  seed: number;
  tick: () => void;
  input: (index: number) => AsyncIterable<Candidate>;
  read: (id: string, seed: number) => AsyncIterable<Candidate>;
}
export interface RegisteredOperator extends OperatorDefinition {
  execute: (context: OperatorContext) => AsyncIterable<Candidate>;
}
export function patternText(template: string, a: string, b: string) {
  if (!/^[AB]{1,16}$/.test(template)) throw new Error("模式需为 1–16 个 A / B");
  return boundedText(template.replace(/[AB]/g, (c) => (c === "A" ? a : b)));
}
export function boundedText(text: string) {
  if (text.length > 1024) throw new Error("单条文字超过 1024 个代码单元");
  return text;
}
const executors: Record<Op, RegisteredOperator["execute"]> = {
  pairs: c => readPairs(c.read, String(c.node.params.resourceId), c.seed, String(c.node.params.relation), c.tick),
  template: c => renderTemplates(c.node.params, c.read, c.seed, c.tick),
  group: c => groupMembers(c.input(0), c.node.params, c.seed, c.tick),
  ...Object.fromEntries(Object.keys(chineseDefinitions).map(op => [op, async function* (c: OperatorContext) {
    const { transformChinese } = await import("./chinese");
    for await (const item of c.input(0)) {
      for await (const result of transformChinese(op as ChineseOp, item, c.node.params, c.seed, c.tick)) {
        c.tick();
        yield { ...result, text: boundedText(result.text) };
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
    yield* executeProgram(c.node.program!, c.read, c.seed, c.tick);
  },
  pattern: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      for await (const b of c.input(1)) {
        c.tick();
        yield {
          text: patternText(String(c.node.params.template), a.text, b.text),
          parts: [...a.parts, ...b.parts],
        };
      }
    }
  },
  concat: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      for await (const b of c.input(1)) {
        c.tick();
        yield {
          text: boundedText(a.text + String(c.node.params.separator) + b.text),
          parts: [...a.parts, ...b.parts],
        };
      }
    }
  },
  filter: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      const p = c.node.params;
      if (
        glyphs(a.text).length <= Number(p.maxLength) &&
        a.text.includes(String(p.includes)) &&
        (!p.excludes || !a.text.includes(String(p.excludes)))
      )
        yield a;
    }
  },
  prefix: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      yield candidateText(a, boundedText(String(c.node.params.text) + a.text));
    }
  },
  reverse: async function* (c) {
    for await (const a of c.input(0)) {
      c.tick();
      yield candidateText(a, glyphs(a.text).reverse().join(""));
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
    { ...definition, execute: executors[id as Op] },
  ]),
) as Record<Op, RegisteredOperator>;
