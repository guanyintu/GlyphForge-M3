import { normalizeParams, diagnose, executionBudget } from "./contracts";
import { operators } from "./model";
import type { Op, RuleNode, Workflow } from "./model";
import type { SubgraphDefinition } from "./model";
import { inputCount, validateScopedNode, validateSubgraphs } from "./subgraphs";
import { parseFunctions, printFunctions } from "./subgraph-script";
import { isChineseOp } from "./chinese-definitions";
import {
  ProgramParser,
  parseProgram,
  programCode,
  validateProgram,
} from "./program";
import { validateWorkflowExtensions } from "./packs";
const json = JSON.stringify;
export function toScript(workflow: Workflow): string {
  if (workflow.subgraphs?.length || workflow.nodes.some(n => n.op === "call")) return printFunctions(workflow);
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
    const p = normalizeParams(n.op, n.params);
    let expr = "";
    if (isChineseOp(n.op)) {
      lines.push(`let ${n.id} = ${n.op}(${[a, ...Object.keys(operators[n.op].defaults).map(key => json(p[key]))].join(", ")});`);
      return;
    }
    switch (n.op) {
      case "extension":
      case "mutate":
      case "gamecheck":
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
      throw diagnose(error, { code: "TYPE", line: index + 1 });
    }
  });
  const workflow = { ...base, nodes };
  validateGraph(workflow);
  return workflow;
}
export function parseScript(source: string, base: Workflow): Workflow {
  if (/^\s*(?:\/\/[^\n]*\n\s*)*fn\b/m.test(source)) return parseFunctions(source, base);
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
/** Shared by graph execution, package import and node clipboard. */
export function validateNodeParameters(n: RuleNode) {
  try {
    normalizeParams(n.op, n.params);
    if (n.op === "program") validateProgram(n.program!);
  } catch (error) { throw diagnose(error, { nodeId: n.id, operator: n.op, line: n.line }); }
}

export function validateDefinitions(workflow: Workflow) { validateSubgraphs(workflow, validateGraphBody); }
export function validateGraph(workflow: Workflow) {
  try { validateWorkflowExtensions(workflow); validateSubgraphs(workflow, validateGraphBody); validateGraphBody(workflow); }
  catch (error) { throw diagnose(error, { code: "TYPE" }); }
}
function validateGraphBody(workflow: Workflow, scope?: SubgraphDefinition) {
  if (!workflow.nodes.length || workflow.nodes.length > 200)
    throw new Error("工作流需要 1–200 个节点");
  if (!scope && workflow.nodes.filter((n) => n.op === "output").length !== 1)
    throw new Error("请保留一个结果输出节点");
  if (scope && (!workflow.nodes.some(n => n.id === scope.output) || workflow.nodes.some(n => n.op === "output"))) throw new Error("子图需要明确返回内部节点，不使用结果输出节点");
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
    validateNodeParameters(n);
    validateScopedNode(n, workflow.subgraphs ?? [], scope);
    if (n.inputs.length !== inputCount(n, workflow.subgraphs) || n.inputs.some(x => !map.has(x)))
      throw new Error(`${operators[n.op].name} 缺少有效输入`);
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
    workflow.limit > executionBudget.results
  )
    throw new Error("结果上限为 1–10,000");
}
