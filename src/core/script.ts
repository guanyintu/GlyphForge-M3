import { operators } from "./model";
import type { Op, RuleNode, Workflow } from "./model";
import { isChineseOp, validateChineseParams } from "./chinese-definitions";
import { validateRelationParams } from "./relations";
import {
  ProgramParser,
  parseProgram,
  programCode,
  validateProgram,
} from "./program";
const json = JSON.stringify;
export function toScript(workflow: Workflow): string {
  const lines = [
    "// NameScript · 节点与代码，共用一份灵感",
    "// 修改后点击「应用到节点」，再运行工作流",
    "",
  ];
  if (workflow.comments?.length)
    lines.push(
      ...workflow.comments.filter(
        (c) =>
          c.startsWith("//") &&
          !c.includes("NameScript ·") &&
          !c.includes("修改后点击"),
      ),
    );
  const visited = new Set<string>();
  function write(n: RuleNode) {
    if (visited.has(n.id)) return;
    visited.add(n.id);
    n.inputs.forEach((id) => {
      const dep = workflow.nodes.find((x) => x.id === id);
      if (dep) write(dep);
    });
    const [a = "missing", b = "missing"] = n.inputs;
    const p = n.params;
    let expr = "";
    if (isChineseOp(n.op)) {
      lines.push(`let ${n.id} = ${n.op}(${[a, ...Object.keys(operators[n.op].defaults).map(key => json(p[key]))].join(", ")});`);
      return;
    }
    switch (n.op) {
      case "pairs":
      case "template":
      case "group":
        expr = `${n.op}(${[...n.inputs, ...Object.keys(operators[n.op].defaults).map(key => json(p[key]))].join(", ")})`;
        break;
      case "program":
        lines.push(
          `let ${n.id} = sequence {\n${programCode(n.program!, 1)}\n};`,
        );
        return;
      case "resource":
        expr = `resource(${json(p.resourceId)})`;
        break;
      case "pattern":
        expr = `pattern(${json(p.template)}, ${a}, ${b})`;
        break;
      case "concat":
        expr = `concat(${a}, ${b}, ${json(p.separator)})`;
        break;
      case "filter":
        expr = `filter(${a}, ${Number(p.maxLength)}, ${json(p.includes)}, ${json(p.excludes)})`;
        break;
      case "prefix":
        expr = `prefix(${a}, ${json(p.text)})`;
        break;
      case "reverse":
        expr = `reverse(${a})`;
        break;
      case "output":
        expr = `output(${a})`;
        break;
    }
    lines.push(`let ${n.id} = ${expr};`);
  }
  workflow.nodes.forEach(write);
  return lines.join("\n");
}
function splitArgs(input: string): string[] {
  if (!input.trim()) return [];
  const args: string[] = [];
  let start = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (char === "," && !quoted) {
      args.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quoted) throw new Error("字符串缺少结束引号");
  args.push(input.slice(start).trim());
  return args;
}
function parseLegacyScript(source: string, base: Workflow): Workflow {
  const nodes: RuleNode[] = [];
  source.split("\n").forEach((line, index) => {
    if (!line.trim() || line.trim().startsWith("//")) return;
    try {
      const match =
        /^\s*let\s+([A-Za-z_]\w*)\s*=\s*([a-z]+)\((.*)\)\s*;?\s*$/.exec(line);
      if (!match)
        throw new Error("使用 let 变量 = 算子(参数);，每行一个表达式");
      const [, id, opName, raw] = match;
      const op = opName as Op;
      if (!Object.hasOwn(operators, op))
        throw new Error(`不支持的算子 ${opName}`);
      if (nodes.some((n) => n.id === id))
        throw new Error(`变量 ${id} 重复定义`);
      const rawArgs = splitArgs(raw);
      const args =
        op === "pattern" && rawArgs.length === 3 && rawArgs[0]?.startsWith('"')
          ? [rawArgs[1], rawArgs[2], rawArgs[0]]
          : rawArgs;
      const def = operators[op];
      const expected = def.inputs + Object.keys(def.defaults).length;
      if (args.length !== expected)
        throw new Error(`${op} 需要 ${expected} 个参数`);
      const inputs = args.slice(0, def.inputs);
      if (inputs.some((ref) => !nodes.some((n) => n.id === ref)))
        throw new Error("引用的变量必须在前面定义");
      const values = args
        .slice(def.inputs)
        .map((arg) => JSON.parse(arg) as unknown);
      const keys = Object.keys(def.defaults);
      const params = { ...def.defaults };
      keys.forEach((key, i) => {
        if (typeof values[i] !== typeof params[key])
          throw new Error(`${key} 参数类型错误`);
        params[key] = values[i] as string | number;
      });
      nodes.push({ id, op, inputs, params });
    } catch (error) {
      throw new Error(
        `第 ${index + 1} 行：${error instanceof Error ? error.message : "语法错误"}`,
      );
    }
  });
  const workflow = { ...base, nodes };
  validateGraph(workflow);
  return workflow;
}
export function parseScript(source: string, base: Workflow): Workflow {
  const comments = source
    .split("\n")
    .filter((line) => line.trim().startsWith("//"))
    .map((x) => x.trim());
  if (!/\bsequence\s*\{/.test(source)) {
    try {
      return { ...parseLegacyScript(source, base), comments };
    } catch (legacyError) {
      if (!/\b(?:for|if|emit)\b/.test(source.replace(/"(?:\\.|[^"\\])*"/g, "")))
        throw legacyError;
      const program = parseProgram(source);
      const id = base.nodes.find((n) => n.op === "program")?.id || "program";
      const output = base.nodes.find((n) => n.op === "output")?.id || "result";
      const workflow: Workflow = {
        ...base,
        comments,
        nodes: [
          { id, op: "program", inputs: [], params: {}, program },
          { id: output, op: "output", inputs: [id], params: {} },
        ],
      };
      validateGraph(workflow);
      return workflow;
    }
  }
  const parser = new ProgramParser(source);
  const nodes: RuleNode[] = [];
  while (parser.peek().type !== "eof") {
    parser.expect("let");
    const id = parser.identifier();
    parser.expect("=");
    if (parser.eat("sequence")) {
      nodes.push({
        id,
        op: "program",
        inputs: [],
        params: {},
        program: { version: 1, body: parser.block() },
      });
      parser.eat(";");
    } else {
      const expression = parser.expression();
      parser.eat(";");
      if (expression.kind !== "call")
        throw new Error(`第 ${expression.line} 行：需要内置算子调用`);
      if (
        !Object.hasOwn(operators, expression.name) ||
        expression.name === "program"
      )
        parser.fail("需要内置算子调用");
      const op = expression.name as Exclude<Op, "program">;
      const def = operators[op];
      const keys = Object.keys(def.defaults);
      const inputs: string[] = [];
      const params = { ...def.defaults };
      if (expression.args.length !== def.inputs + keys.length)
        parser.fail(`${op} 参数数量不匹配`);
      const graphArgs =
        op === "pattern" && expression.args[0]?.kind === "literal"
          ? [expression.args[1], expression.args[2], expression.args[0]]
          : expression.args;
      graphArgs.forEach((arg, i) => {
        if (i < def.inputs) {
          if (arg.kind !== "variable")
            throw new Error("输入需要引用已声明的节点");
          inputs.push(arg.name);
        } else {
          if (arg.kind !== "literal") throw new Error("参数需要常量");
          params[keys[i - def.inputs]] = arg.value;
        }
      });
      if (inputs.some((ref) => !nodes.some((n) => n.id === ref)))
        parser.fail("引用的变量必须在前面定义");
      nodes.push({ id, op, inputs, params });
    }
  }
  const workflow = { ...base, nodes, comments };
  validateGraph(workflow);
  return workflow;
}
export function validateGraph(workflow: Workflow) {
  if (!workflow.nodes.length || workflow.nodes.length > 200)
    throw new Error("工作流需要 1–200 个节点");
  if (workflow.nodes.filter((n) => n.op === "output").length !== 1)
    throw new Error("请保留一个结果输出节点");
  const map = new Map(workflow.nodes.map((n) => [n.id, n]));
  if (map.size !== workflow.nodes.length) throw new Error("节点 ID 重复");
  if (
    workflow.nodes.some(
      (n) =>
        !/^[A-Za-z_]\w{0,63}$/.test(n.id) ||
        ["__proto__", "constructor", "prototype"].includes(n.id),
    )
  )
    throw new Error("节点 ID 无效或使用了保留名称");
  const done = new Set<string>(),
    visiting = new Set<string>();
  function visit(n: RuleNode) {
    if (done.has(n.id)) return;
    if (visiting.has(n.id)) throw new Error("检测到循环连线，请使用无环数据流");
    if (!Object.hasOwn(operators, n.op)) throw new Error(`未知算子 ${n.op}`);
    const def = operators[n.op];
    if (n.op === "program") validateProgram(n.program!);
    for (const [key, value] of Object.entries(def.defaults)) {
      if (typeof n.params[key] !== typeof value)
        throw new Error(`${def.name} 的 ${key} 参数类型错误`);
      if (
        typeof n.params[key] === "string" &&
        String(n.params[key]).length > ((n.op === "mapchars" && key === "mapping") || (n.op === "template" && ["slots", "templates"].includes(key)) ? 16384 : 256)
      )
        throw new Error(`${def.name} 的文字参数过长`);
    }
    if (isChineseOp(n.op)) validateChineseParams(n.op, n.params);
    validateRelationParams(n.op, n.params);
    if (n.inputs.length !== def.inputs || n.inputs.some((x) => !map.has(x)))
      throw new Error(`${def.name} 缺少有效输入`);
    if (n.op === "pattern" && !/^[AB]{1,16}$/.test(String(n.params.template)))
      throw new Error("模式需为 1–16 个 A / B，例如 AABB");
    if (
      n.op === "filter" &&
      (!Number.isFinite(n.params.maxLength) ||
        Number(n.params.maxLength) < 1 ||
        Number(n.params.maxLength) > 100)
    )
      throw new Error("长度限制需要在 1–100 之间");
    visiting.add(n.id);
    n.inputs.forEach((id) => visit(map.get(id)!));
    visiting.delete(n.id);
    done.add(n.id);
  }
  workflow.nodes.forEach(visit);
  if (!Number.isSafeInteger(workflow.seed))
    throw new Error("种子需要是有效整数");
  if (
    !Number.isInteger(workflow.limit) ||
    workflow.limit < 1 ||
    workflow.limit > 10000
  )
    throw new Error("结果上限为 1–10,000");
}
