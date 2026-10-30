import { ContractError, normalizeParams } from "./contracts";
import { operators } from "./model";
import type { Params, RuleNode, SubgraphDefinition, SubgraphParameter, Workflow, Op } from "./model";
import { ProgramParser, programCode } from "./program";
import type { Expr } from "./program";
import { validateGraph } from "./script";
import { definitionFor } from "./subgraphs";

const json = JSON.stringify;
export function printFunctions(w: Workflow) {
  const defs = w.subgraphs ?? [];
  const symbols = new Map(defs.map((d, i) => [`${d.id}@${d.version}`, `f${i + 1}`]));
  function body(nodes: RuleNode[]) {
    const lines: string[] = [], visited = new Set<string>();
    function write(n: RuleNode) {
      if (visited.has(n.id)) return; visited.add(n.id);
      n.inputs.forEach(id => { const dep = nodes.find(n => n.id === id); if (dep) write(dep); });
      if (n.op === "program") { lines.push(`let ${n.id} = sequence {\n${programCode(n.program!, 1)}\n};`); return; }
      let expr: string;
      if (n.op === "call") {
        const d = definitionFor(n, defs); let index = 0;
        const values = d.parameters.map(p => p.type === "CandidateSequence" ? n.inputs[index++] : n.parameterBindings?.[p.name] ?? json(n.call!.bindings[p.name] ?? p.default));
        expr = `${symbols.get(`${d.id}@${d.version}`)}(${values.join(", ")})`;
      } else {
        const p = normalizeParams(n.op, n.params);
        const values = Object.keys(operators[n.op].defaults).map(key => n.parameterBindings?.[key] ?? json(p[key]));
        expr = `${n.op}(${[...n.inputs, ...values].join(", ")})`;
      }
      lines.push(`let ${n.id} = ${expr};`);
    }
    nodes.forEach(write); return lines.join("\n");
  }
  return ["// NameScript 序列函数 · 显式参数与返回；ID/version 固定引用", ...defs.map(d => `fn ${symbols.get(`${d.id}@${d.version}`)}(${json(d.id)}, ${d.version}, ${json(d.name)}) (${d.parameters.map(p => `${p.name} ${p.type}${p.default === undefined ? "" : ` = ${json(p.default)}`}`).join(", ")}) {\n${body(d.nodes).split("\n").map(l => "  " + l).join("\n")}\n  return ${d.output};\n}`), body(w.nodes)].join("\n\n");
}
type Raw = { node: RuleNode; expression?: Extract<Expr, {kind: "call"}> };
function value(e: Expr): Params[string] {
  if (e.kind === "literal") return e.value;
  if (e.kind === "unary" && e.op === "-" && e.value.kind === "literal" && typeof e.value.value === "number") return -e.value.value;
  throw new ContractError({ code: "TYPE", line: e.line, message: "需要标量常量或显式参数引用；不支持任意 JS/TS 表达式" });
}
/** Uses the existing NameScript tokenizer/AST. Functions are sequence DAGs, not arbitrary JS. */
export function parseFunctions(source: string, base: Workflow): Workflow {
  const parser = new ProgramParser(source), defs: SubgraphDefinition[] = [], names = new Map<string, SubgraphDefinition>();
  const pending: { raws: Raw[]; scope?: SubgraphDefinition }[] = [];
  function literal() { return value(parser.expression()); }
  function readNode(): Raw {
    const line = parser.peek().line;
    parser.expect("let"); const id = parser.identifier(); parser.expect("=");
    const node: RuleNode = { id, op: "program", inputs: [], params: {}, line };
    if (parser.eat("sequence")) { node.program = { version: 1, body: parser.block() }; parser.eat(";"); return { node }; }
    const expression = parser.expression(); parser.expect(";");
    if (expression.kind !== "call") parser.fail("序列节点需要算子或函数调用");
    return { node, expression: expression as Extract<Expr, {kind: "call"}> };
  }
  while (parser.eat("fn")) {
    const symbol = parser.identifier(); if (names.has(symbol) || Object.hasOwn(operators, symbol)) parser.fail("函数符号重复或遮蔽内置算子");
    parser.expect("("); const id = literal(); parser.expect(","); const version = literal(); parser.expect(","); const name = literal(); parser.expect(")"); parser.expect("(");
    const parameters: SubgraphParameter[] = [];
    if (!parser.eat(")")) { do { const name = parser.identifier(), type = parser.identifier() as SubgraphParameter["type"]; const p: SubgraphParameter = { name, type }; if (parser.eat("=")) p.default = literal(); parameters.push(p); } while (parser.eat(",")); parser.expect(")"); }
    const d: SubgraphDefinition = { id: id as string, version: version as number, name: name as string, parameters, returns: "CandidateSequence", nodes: [], output: "", layout: base.subgraphs?.find(d => d.id === id && d.version === version)?.layout ?? {} };
    names.set(symbol, d); defs.push(d); parser.expect("{");
    const raws: Raw[] = [];
    while (parser.peek().value === "let") raws.push(readNode());
    parser.expect("return"); d.output = parser.identifier(); parser.expect(";"); parser.expect("}"); pending.push({ raws, scope: d });
  }
  const main: Raw[] = []; while (parser.peek().type !== "eof") main.push(readNode()); pending.push({ raws: main });
  for (const { raws, scope } of pending) {
    const locals = new Set<string>();
    for (const { node: n, expression: e } of raws) {
      if (locals.has(n.id) || scope?.parameters.some(p => p.name === n.id)) throw new ContractError({ code: "SCOPE", nodeId: n.id, line: n.line, message: "局部变量重复或遮蔽参数" });
      if (e) {
        const callee = names.get(e.name);
        const refs: Record<string, string> = {}, params: Params = {};
        function scalarArg(arg: Expr | undefined, key: string) {
          if (!arg) return;
          if (arg.kind === "variable") { refs[key] = arg.name; return; }
          params[key] = value(arg);
        }
        function sequence(arg: Expr | undefined) {
          if (!arg || arg.kind !== "variable" || !locals.has(arg.name)) throw new ContractError({ code: "SCOPE", nodeId: n.id, line: n.line, message: "序列必须引用本函数内已声明节点；禁止闭包捕获" });
          n.inputs.push(arg.name);
        }
        if (callee) {
          n.op = "call"; n.call = { definitionId: callee.id, version: callee.version, bindings: params };
          if (e.args.length > callee.parameters.length) parser.fail("调用参数过多");
          callee.parameters.forEach((p, i) => p.type === "CandidateSequence" ? sequence(e.args[i]) : scalarArg(e.args[i], p.name));
        } else {
          if (!Object.hasOwn(operators, e.name) || ["call", "program"].includes(e.name)) throw new ContractError({ code: "TYPE", line: n.line, nodeId: n.id, message: `不支持的函数 ${e.name}` });
          n.op = e.name as Op; const def = operators[n.op], keys = Object.keys(def.defaults);
          if (e.args.length < def.inputs || e.args.length > def.inputs + keys.length) parser.fail("算子参数数量不匹配");
          e.args.slice(0, def.inputs).forEach(sequence);
          keys.forEach((key, i) => scalarArg(e.args[def.inputs + i], key));
          n.params = normalizeParams(n.op, params);
        }
        if (Object.keys(refs).length) n.parameterBindings = refs;
      }
      locals.add(n.id);
    }
    if (scope) scope.nodes = raws.map(r => r.node);
  }
  const w = { ...base, subgraphs: defs, nodes: main.map(r => r.node) };
  validateGraph(w); return w;
}
