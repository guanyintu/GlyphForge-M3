import type { Program } from "./program";
export type Op =
  | "program"
  | "resource"
  | "pattern"
  | "concat"
  | "filter"
  | "prefix"
  | "reverse"
  | "output";
export type Params = Record<string, string | number | boolean>;
export interface RuleNode {
  id: string;
  op: Op;
  inputs: string[];
  params: Params;
  program?: Program;
}
export interface Workflow {
  version: 1;
  id: string;
  name: string;
  nodes: RuleNode[];
  layout: Record<string, { x: number; y: number }>;
  seed: number;
  limit: number;
  comments?: string[];
  groups?: { id: string; name: string; nodeIds: string[] }[];
}
export interface Resource {
  id: string;
  name: string;
  description: string;
  kind: "word" | "character" | "symbol";
  color: string;
  count: number;
  version: number;
  updatedAt: number;
}
export interface Entry {
  id?: number;
  resourceId: string;
  text: string;
}
export interface SourcePart {
  resourceId: string;
  text: string;
  version?: number;
}
export interface Candidate {
  text: string;
  parts: SourcePart[];
  workflowId?: string;
  seed?: number;
  runId?: string;
}
export interface Favorite extends Candidate {
  text: string;
  savedAt: number;
}
export interface OperatorDefinition {
  version: 1;
  inputTypes: "CandidateSequence"[];
  outputType: "CandidateSequence";
  deterministic: boolean;
  streaming: boolean;
  id: Op;
  name: string;
  category: string;
  description: string;
  inputs: number;
  color: string;
  defaults: Params;
}
const builtinOperators: Record<
  Op,
  Omit<
    OperatorDefinition,
    "version" | "inputTypes" | "outputType" | "deterministic" | "streaming"
  >
> = {
  program: {
    id: "program",
    name: "循环与条件",
    category: "控制流",
    description: "结构化编辑 for / if / let / emit，支持嵌套与类型检查",
    inputs: 0,
    color: "purple",
    defaults: {},
  },
  resource: {
    id: "resource",
    name: "词库输入",
    category: "数据源",
    description: "引用独立管理的字词库",
    inputs: 0,
    color: "green",
    defaults: { resourceId: "nature" },
  },
  pattern: {
    id: "pattern",
    name: "模式组合",
    category: "生成",
    description: "用 A、B 绑定两个输入，组合每一种可能",
    inputs: 2,
    color: "purple",
    defaults: { template: "AB" },
  },
  concat: {
    id: "concat",
    name: "文字拼接",
    category: "生成",
    description: "组合两个词库，可添加分隔符",
    inputs: 2,
    color: "purple",
    defaults: { separator: "" },
  },
  filter: {
    id: "filter",
    name: "条件筛选",
    category: "处理",
    description: "按可见字符长度、包含和排除条件过滤",
    inputs: 1,
    color: "orange",
    defaults: { maxLength: 6, includes: "", excludes: "" },
  },
  prefix: {
    id: "prefix",
    name: "添加前缀",
    category: "处理",
    description: "为每个名字添加相同的前缀",
    inputs: 1,
    color: "orange",
    defaults: { text: "小" },
  },
  reverse: {
    id: "reverse",
    name: "文字倒序",
    category: "处理",
    description: "按 Unicode 字符簇倒序，保留完整 Emoji",
    inputs: 1,
    color: "orange",
    defaults: {},
  },
  output: {
    id: "output",
    name: "结果输出",
    category: "输出",
    description: "去重后流式输出到结果工作台",
    inputs: 1,
    color: "blue",
    defaults: {},
  },
};
export const operators = Object.fromEntries(
  Object.entries(builtinOperators).map(([id, definition]) => [
    id,
    {
      ...definition,
      version: 1,
      inputTypes: Array.from(
        { length: definition.inputs },
        () => "CandidateSequence",
      ),
      outputType: "CandidateSequence",
      deterministic: true,
      streaming: true,
    },
  ]),
) as Record<Op, OperatorDefinition>;
export const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
export function glyphs(text: string) {
  return Array.from(segmenter.segment(text), (x) => x.segment);
}
export function unicodeMetrics(text: string) {
  return {
    utf16: text.length,
    codePoints: Array.from(text).length,
    graphemes: glyphs(text).length,
    bytes: new TextEncoder().encode(text).length,
  };
}
export function createWorkflow(preset = "dream"): Workflow {
  const template =
    preset === "echo" ? "AABB" : preset === "mirror" ? "ABBA" : "AB";
  return {
    version: 1,
    id: crypto.randomUUID(),
    name:
      preset === "echo"
        ? "叠字的快乐"
        : preset === "mirror"
          ? "镜像文字实验"
          : "宇宙浪漫命名器",
    seed: 42,
    limit: 200,
    nodes: [
      {
        id: "a",
        op: "resource",
        inputs: [],
        params: { resourceId: preset === "dream" ? "nature" : "animals" },
      },
      {
        id: "b",
        op: "resource",
        inputs: [],
        params: { resourceId: preset === "dream" ? "roles" : "moods" },
      },
      { id: "mix", op: "pattern", inputs: ["a", "b"], params: { template } },
      {
        id: "check",
        op: "filter",
        inputs: ["mix"],
        params: {
          maxLength: preset === "dream" ? 6 : 8,
          includes: "",
          excludes: "",
        },
      },
      { id: "result", op: "output", inputs: ["check"], params: {} },
    ],
    layout: {
      a: { x: 35, y: 65 },
      b: { x: 35, y: 255 },
      mix: { x: 280, y: 140 },
      check: { x: 525, y: 140 },
      result: { x: 770, y: 140 },
    },
  };
}
