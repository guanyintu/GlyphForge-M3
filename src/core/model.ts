import { defaultGameRule } from "./game-rules";
import type { Program } from "./program";
import { chineseDefinitions } from "./chinese-definitions";
import type { ChineseOp } from "./chinese-definitions";
export type Op =
  | "gamecheck"
  | "pairs" | "template" | "group"
  | ChineseOp
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
  kind: "word" | "character" | "symbol" | "relation";
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
export type RelationKind = "associated" | "antonym" | "couple" | "parallel";
export type RelationDirection = "symmetric" | "directed" | "unknown";
export interface RelationRow extends PairValue {
  id?: number;
  resourceId: string;
  left: string;
  right: string;
  relation: RelationKind;
}
export interface PairValue {
  left: string;
  right: string;
  relation: RelationKind;
  /** Missing fields in v1–v3 files mean unknown / false, never symmetric. */
  direction?: RelationDirection;
  reverseQueryable?: boolean;
  weight?: number;
  tags?: string[];
  note?: string;
  source?: string;
}
export interface SourcePart {
  resourceId: string;
  text: string;
  version?: number;
  pair?: PairValue;
}
export interface Candidate {
  text: string;
  notes?: string[];
  parts: SourcePart[];
  workflowId?: string;
  seed?: number;
  runId?: string;
  pair?: PairValue;
  members?: string[];
}
export interface Favorite extends Candidate {
  text: string;
  savedAt: number;
}
// Text transforms operate on the displayed sequence value. Group/tuple metadata
// is only valid while that value still represents its original members.
export function candidateText(item: Candidate, text: string): Candidate {
  if (text === item.text) return item;
  const next = { ...item, text };
  delete next.pair;
  delete next.members;
  return next;
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
  gamecheck: { id: "gamecheck", name: "游戏 ID 检查", category: "处理", description: "复用可配置的 Unicode 长度和字符规则，筛选或标注结果", inputs: 1, color: "orange", defaults: { rules: JSON.stringify(defaultGameRule), mode: "filter" } },
  pairs: {
    id: "pairs", name: "关系词对", category: "数据源", description: "按行读取明确的关联关系，左右端始终绑定",
    inputs: 0, color: "green", defaults: { resourceId: "p1b-sky", relation: "" },
  },
  template: {
    id: "template", name: "共享变量模板", category: "生成", description: "绑定多个词库或关系槽位，用模板生成一组呼应的名字",
    inputs: 0, color: "purple", defaults: { slots: '[{"name":"sky","resourceId":"p1b-sky","kind":"pair","relation":""}]', templates: '["{sky.left}","{sky.right}"]', separator: " / ", maxLength: 16, equalLength: false },
  },
  group: {
    id: "group", name: "成员分组", category: "生成", description: "去重后为 N 人生成统一前后缀、结构与长度的名字",
    inputs: 1, color: "purple", defaults: { count: 3, batches: 1, prefix: "星河", suffix: "", separator: "·", joiner: " / ", maxLength: 16, random: true },
  },
  ...chineseDefinitions,
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
      streaming: id !== "group",
    },
  ]),
) as Record<Op, OperatorDefinition>;
export { segmenter, glyphs, unicodeMetrics } from "./unicode";
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
