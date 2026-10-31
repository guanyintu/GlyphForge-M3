import { resolveMapping, mappingSource } from "./mapping-resource";
import { astSignatures as signatures, astParams, boundedText, ContractError, diagnose, parameterLimit, transformText, uniqueParts, requireResourceKind } from "./contracts";
import type { ValueType, ResourceMetadataReader } from "./contracts";
import type { Op } from "./model";
import { checkGameId, parseGameRule } from "./game-rules";
import { glyphs } from "./model";
import type { Candidate, SourcePart } from "./model";
import { isChineseOp } from "./chinese-definitions";
import type { ChineseOp } from "./chinese-definitions";
import type { Params } from "./model";
import { readPairs } from "./relations";

export type Expr =
  | { kind: "literal"; value: string | number | boolean; line: number }
  | { kind: "variable"; name: string; line: number }
  | { kind: "resource"; id: string; line: number }
  | { kind: "list"; items: Expr[]; line: number }
  | { kind: "call"; name: string; args: Expr[]; line: number }
  | { kind: "binary"; op: string; left: Expr; right: Expr; line: number }
  | { kind: "unary"; op: string; value: Expr; line: number };
export type Statement =
  | { kind: "let"; name: string; value: Expr; line: number }
  | { kind: "for"; name: string; source: Expr; body: Statement[]; line: number }
  | {
      kind: "if";
      test: Expr;
      body: Statement[];
      otherwise: Statement[];
      line: number;
    }
  | { kind: "emit"; value: Expr; line: number };
export interface Program {
  version: 1;
  body: Statement[];
}
interface Token {
  value: string;
  type: "name" | "number" | "string" | "symbol" | "resource" | "eof";
  line: number;
}
const reserved = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "for",
  "in",
  "let",
  "if",
  "else",
  "emit",
  "true",
  "false",
]);
function tokenize(source: string): Token[] {
  if (source.length > 64000) throw new Error("代码最多 64,000 字符");
  const tokens: Token[] = [];
  let i = 0,
    line = 1;
  while (i < source.length) {
    const char = source[i];
    if (/\s/u.test(char)) {
      if (char === "\n") line++;
      i++;
      continue;
    }
    if (source.slice(i, i + 2) === "//") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (char === '"') {
      const start = i++;
      let escaped = false;
      while (i < source.length) {
        if (source[i] === "\n")
          throw new Error(`第 ${line} 行：字符串请使用 \\n 换行`);
        if (!escaped && source[i] === '"') break;
        if (!escaped && source[i] === "\\") escaped = true;
        else escaped = false;
        i++;
      }
      if (i >= source.length)
        throw new Error(`第 ${line} 行：字符串缺少结束引号`);
      let value: string;
      try {
        value = JSON.parse(source.slice(start, ++i));
      } catch {
        throw new Error(`第 ${line} 行：无效的字符串转义`);
      }
      if (value.length > 16384)
        throw new Error(`第 ${line} 行：字符串最多 16,384 字符`);
      tokens.push({ type: "string", value, line });
      continue;
    }
    if (char === "@") {
      const match = /^@[\p{L}\p{N}_.-]+/u.exec(source.slice(i));
      if (!match) throw new Error(`第 ${line} 行：资源引用缺少 ID`);
      tokens.push({ type: "resource", value: match[0].slice(1), line });
      i += match[0].length;
      continue;
    }
    const number = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i));
    if (number) {
      tokens.push({ type: "number", value: number[0], line });
      i += number[0].length;
      continue;
    }
    const name = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(source.slice(i));
    if (name) {
      tokens.push({ type: "name", value: name[0], line });
      i += name[0].length;
      continue;
    }
    const op = /^(?:<=|>=|==|!=|&&|\|\||[{}()[\],;=+\-*/!<>])/.exec(
      source.slice(i),
    );
    if (!op) throw new Error(`第 ${line} 行：无法识别字符 ${char}`);
    tokens.push({ type: "symbol", value: op[0], line });
    i += op[0].length;
    if (tokens.length > 8000) throw new Error("代码超过 8,000 个语法单元");
  }
  tokens.push({ type: "eof", value: "", line });
  return tokens;
}
export class ProgramParser {
  private tokens: Token[];
  private index = 0;
  constructor(source: string) {
    this.tokens = tokenize(source);
  }
  peek() {
    return this.tokens[this.index];
  }
  take() {
    return this.tokens[this.index++];
  }
  eat(value: string) {
    if (this.peek().value === value) {
      this.take();
      return true;
    }
    return false;
  }
  expect(value: string) {
    if (!this.eat(value))
      this.fail(
        `需要「${value}」，实际为「${this.peek().value || "文件末尾"}」`,
      );
  }
  fail(message: string): never {
    throw new ContractError({ code: "TYPE", line: this.peek().line, message });
  }
  identifier() {
    const token = this.take();
    if (token.type !== "name" || reserved.has(token.value))
      this.fail("需要有效的变量名");
    return token.value;
  }
  block(depth = 0): Statement[] {
    if (depth > 12) this.fail("最多嵌套 12 层");
    this.expect("{");
    const body: Statement[] = [];
    while (!this.eat("}")) {
      if (this.peek().type === "eof") this.fail("代码块缺少 }");
      body.push(this.statement(depth + 1));
    }
    return body;
  }
  statement(depth = 0): Statement {
    const token = this.take();
    const line = token.line;
    if (token.value === "for") {
      const name = this.identifier();
      this.expect("in");
      const source = this.expression();
      return { kind: "for", name, source, body: this.block(depth), line };
    }
    if (token.value === "if") {
      const test = this.expression();
      const body = this.block(depth);
      const otherwise = this.eat("else") ? this.block(depth) : [];
      return { kind: "if", test, body, otherwise, line };
    }
    if (token.value === "let") {
      const name = this.identifier();
      this.expect("=");
      const value = this.expression();
      this.eat(";");
      return { kind: "let", name, value, line };
    }
    if (token.value === "emit") {
      this.expect("(");
      const value = this.expression();
      this.expect(")");
      this.eat(";");
      return { kind: "emit", value, line };
    }
    this.fail(`不支持的语句 ${token.value}；使用 let / for / if / emit`);
  }
  expression(min = 0, depth = 0): Expr {
    if (depth > 40) this.fail("表达式嵌套过深");
    const t = this.take();
    let expr: Expr;
    if (t.type === "symbol" && (t.value === "!" || t.value === "-"))
      expr = {
        kind: "unary",
        op: t.value,
        value: this.expression(7, depth + 1),
        line: t.line,
      };
    else if (
      t.type === "string" ||
      t.type === "number" ||
      ["true", "false"].includes(t.value)
    )
      expr = {
        kind: "literal",
        value:
          t.type === "string"
            ? t.value
            : t.type === "number"
              ? Number(t.value)
              : t.value === "true",
        line: t.line,
      };
    else if (t.type === "resource")
      expr = { kind: "resource", id: t.value, line: t.line };
    else if (t.value === "(") {
      expr = this.expression(0, depth + 1);
      this.expect(")");
    } else if (t.value === "[") {
      const items: Expr[] = [];
      if (!this.eat("]")) {
        do {
          items.push(this.expression(0, depth + 1));
        } while (this.eat(","));
        this.expect("]");
      }
      expr = { kind: "list", items, line: t.line };
    } else if (t.type === "name") {
      if (this.eat("(")) {
        const args: Expr[] = [];
        if (!this.eat(")")) {
          do {
            args.push(this.expression(0, depth + 1));
          } while (this.eat(","));
          this.expect(")");
        }
        expr = { kind: "call", name: t.value, args, line: t.line };
      } else expr = { kind: "variable", name: t.value, line: t.line };
    } else this.fail("需要字符串、数字、变量或内置函数表达式");
    const precedence: Record<string, number> = {
      "||": 1,
      "&&": 2,
      "==": 3,
      "!=": 3,
      "<": 4,
      ">": 4,
      "<=": 4,
      ">=": 4,
      "+": 5,
      "-": 5,
      "*": 6,
      "/": 6,
    };
    while (
      Object.hasOwn(precedence, this.peek().value) &&
      precedence[this.peek().value] >= min
    ) {
      const op = this.take().value;
      expr = {
        kind: "binary",
        op,
        left: expr,
        right: this.expression(precedence[op] + 1, depth + 1),
        line: t.line,
      };
    }
    return expr;
  }
}
export function validateProgram(program: Program) {
  try { validateProgramBody(program); }
  catch (error) { throw diagnose(error, { code: "TYPE" }); }
}
function validateProgramBody(program: Program) {
  if (!program || program.version !== 1 || !Array.isArray(program.body))
    throw new Error("无效的程序 IR");
  let size = 0,
    emits = 0;
  function check(
    expr: Expr,
    scope: Map<string, ValueType>,
    depth = 0,
    literalLimit = 256,
  ): ValueType {
    if (!expr || ++size > 2000 || depth > 40)
      throw new Error("程序超过结构限额");
    const error = (msg: string): never => {
      throw new ContractError({ code: expr.kind === "variable" ? "SCOPE" : "TYPE", line: expr.line, message: msg });
    };
    switch (expr.kind) {
      case "literal":
        if (
          !["string", "number", "boolean"].includes(typeof expr.value) ||
          (typeof expr.value === "string" && expr.value.length > literalLimit) ||
          (typeof expr.value === "number" && !Number.isFinite(expr.value))
        )
          return error("常量类型或长度无效");
        return typeof expr.value as ValueType;
      case "resource":
        if (typeof expr.id !== "string" || !expr.id || expr.id.length > 256)
          return error("资源引用无效");
        return "strings";
      case "variable": {
        const type = scope.get(expr.name);
        if (!type) return error(`变量 ${expr.name} 未定义或不在作用域内`);
        return type;
      }
      case "list": {
        if (!Array.isArray(expr.items) || expr.items.length > 1000)
          return error("集合最多 1,000 项");
        const types = expr.items.map((x) => check(x, scope, depth + 1));
        const type = types[0] || "string";
        if (
          !["string", "number", "boolean"].includes(type) ||
          types.some((x) => x !== type)
        )
          return error("集合元素必须是相同标量类型");
        return `${type}s` as ValueType;
      }
      case "call": {
        if (!Object.hasOwn(signatures, expr.name) || !Array.isArray(expr.args))
          return error(`不支持的函数 ${expr.name}`);
        const fn = signatures[expr.name];
        if (expr.args.length < fn.required || expr.args.length > fn.args.length)
          return error(`${expr.name} 参数需要 (${fn.args.join(", ")})`);
        expr.args.forEach((arg, i) => {
          const key = fn.parameters?.[i];
          if (check(arg, scope, depth + 1, key ? parameterLimit(expr.name as Op, key) : 256) !== fn.args[i]) {
            if (key) throw new ContractError({ code: "PARAMETER", operator: expr.name, parameter: key, line: expr.line, message: `${key} 参数类型错误，需要 ${fn.args[i]}` });
            error(`${expr.name} 参数需要 (${fn.args.join(", ")})`);
          }
        });
        if (
          ["resource", "pairs"].includes(expr.name) &&
          (expr.args[0].kind !== "literal" ||
            typeof expr.args[0].value !== "string")
        )
          return error(`${expr.name} 需要固定的资源 ID 字符串`);
        if (fn.parameters && expr.args.every(a => a.kind === "literal" || a.kind === "variable")) {
          // Validate literal parameters now; expressions and variables are validated at evaluation.
          if (fn.parameters.every((key, i) => !key || !expr.args[i] || expr.args[i].kind === "literal")) {
            try { astParams(expr.name as Op, expr.args.map(a => a.kind === "literal" ? a.value : undefined)); }
            catch (error) { throw diagnose(error, { line: expr.line }); }
          }
        }
        return fn.result;
      }
      case "unary": {
        const type = check(expr.value, scope, depth + 1);
        if (
          (expr.op === "!" && type === "boolean") ||
          (expr.op === "-" && type === "number")
        )
          return type;
        return error("一元运算类型不匹配");
      }
      case "binary": {
        const a = check(expr.left, scope, depth + 1),
          b = check(expr.right, scope, depth + 1);
        if (a !== b || !["string", "number", "boolean"].includes(a))
          return error("二元运算需要相同的标量类型");
        if (expr.op === "+" && (a === "string" || a === "number")) return a;
        if (["-", "*", "/"].includes(expr.op) && a === "number")
          return "number";
        if (["&&", "||"].includes(expr.op) && a === "boolean") return "boolean";
        if (
          ["==", "!="].includes(expr.op) ||
          (["<", "<=", ">", ">="].includes(expr.op) && a === "number")
        )
          return "boolean";
        return error("运算符与类型不匹配");
      }
      default:
        return error("未知表达式");
    }
  }
  function block(
    body: Statement[],
    parent: Map<string, ValueType>,
    depth: number,
  ) {
    if (!Array.isArray(body) || depth > 12)
      throw new Error("程序代码块无效或超过 12 层嵌套");
    const scope = new Map(parent),
      locals = new Set<string>();
    for (const s of body) {
      if (!s || ++size > 2000) throw new Error("程序超过结构限额");
      if (s.kind === "let" || s.kind === "for") {
        if (
          typeof s.name !== "string" ||
          !/^[\p{L}_][\p{L}\p{N}_]{0,63}$/u.test(s.name) ||
          reserved.has(s.name) ||
          (s.kind === "let" && locals.has(s.name))
        )
          throw new ContractError({ code: "TYPE", line: s.line, message: `变量重复或名称无效 ${s.name}` });
        const type = check(s.kind === "let" ? s.value : s.source, scope);
        if (s.kind === "let") locals.add(s.name);
        if (s.kind === "let") scope.set(s.name, type);
        else {
          if (!["strings", "numbers", "booleans", "pairs"].includes(type))
            throw new ContractError({ code: "TYPE", line: s.line, message: `for 需要词库、集合或 range` });
          const child = new Map(scope);
          child.set(s.name, type.slice(0, -1) as ValueType);
          block(s.body, child, depth + 1);
        }
      } else if (s.kind === "if") {
        if (check(s.test, scope) !== "boolean")
          throw new ContractError({ code: "TYPE", line: s.line, message: `if 条件必须为 Boolean` });
        block(s.body, scope, depth + 1);
        block(s.otherwise, scope, depth + 1);
      } else if (s.kind === "emit") {
        if (check(s.value, scope) !== "string")
          throw new ContractError({ code: "TYPE", line: s.line, message: `emit 需要 String` });
        emits++;
      } else throw new Error("未知控制流语句");
    }
  }
  block(program.body, new Map(), 0);
  if (!emits) throw new Error("程序需要至少一条 emit 输出");
}
export function parseProgram(source: string): Program {
  const parser = new ProgramParser(source);
  const body: Statement[] = [];
  while (parser.peek().type !== "eof") body.push(parser.statement());
  const program: Program = { version: 1, body };
  validateProgram(program);
  return program;
}
export function expressionCode(e: Expr): string {
  switch (e.kind) {
    case "literal":
      return JSON.stringify(e.value);
    case "variable":
      return e.name;
    case "resource":
      return `resource(${JSON.stringify(e.id)})`;
    case "list":
      return `[${e.items.map(expressionCode).join(", ")}]`;
    case "call":
      return `${e.name}(${e.args.map(expressionCode).join(", ")})`;
    case "unary":
      return `${e.op}(${expressionCode(e.value)})`;
    case "binary":
      return `(${expressionCode(e.left)} ${e.op} ${expressionCode(e.right)})`;
  }
}
export function programCode(program: Program, indent = 0): string {
  function block(body: Statement[], level: number): string {
    const pad = "  ".repeat(level);
    return body
      .map((s) => {
        switch (s.kind) {
          case "let":
            return `${pad}let ${s.name} = ${expressionCode(s.value)};`;
          case "emit":
            return `${pad}emit(${expressionCode(s.value)});`;
          case "for":
            return `${pad}for ${s.name} in ${expressionCode(s.source)} {\n${block(s.body, level + 1)}\n${pad}}`;
          case "if":
            return `${pad}if ${expressionCode(s.test)} {\n${block(s.body, level + 1)}\n${pad}}${s.otherwise.length ? ` else {\n${block(s.otherwise, level + 1)}\n${pad}}` : ""}`;
        }
      })
      .join("\n");
  }
  return block(program.body, indent);
}
export function programResources(program: Program): string[] {
  const ids = new Set<string>();
  visitProgramExpressions(program, (e) => {
    if (e.kind === "resource") ids.add(e.id);
    if(e.kind === "call" && ["mapchars","hanconvert"].includes(e.name)) {
      const index=signatures[e.name]?.parameters?.indexOf("mappingId") ?? -1;
      if(index>=0 && e.args[index]) {const ref=e.args[index]; if(ref.kind!=="literal" || typeof ref.value!=="string")throw new Error("Mapping 引用必须使用固定 ID"); if(ref.value)ids.add(ref.value);}
    }
    if (
      e.kind === "call" &&
      ["resource", "pairs"].includes(e.name) &&
      e.args[0]?.kind === "literal" &&
      typeof e.args[0].value === "string"
    )
      ids.add(e.args[0].value);
  });
  return [...ids];
}
export function visitProgramExpressions(
  program: Program,
  visit: (e: Expr) => void,
) {
  function expr(e: Expr) {
    visit(e);
    if (e.kind === "binary") {
      expr(e.left);
      expr(e.right);
    }
    if (e.kind === "unary") expr(e.value);
    if (e.kind === "call") e.args.forEach(expr);
    if (e.kind === "list") e.items.forEach(expr);
  }
  function block(body: Statement[]) {
    body.forEach((s) => {
      if (s.kind === "for") {
        expr(s.source);
        block(s.body);
      } else if (s.kind === "if") {
        expr(s.test);
        block(s.body);
        block(s.otherwise);
      } else expr(s.value);
    });
  }
  block(program.body);
}
interface Atom {
  type: "atom";
  value: string | number | boolean;
  parts: SourcePart[];
  notes?: string[];
}
type Value =
  | Atom
  | { type: "pair"; candidate: Candidate }
  | { type: "pairs"; id: string; relation: string }
  | { type: "resource"; id: string }
  | { type: "range"; from: number; to: number }
  | { type: "list"; items: Atom[] }
  | { type: "chinese"; op: ChineseOp; input: Atom; params: Params };
export async function* executeProgram(
  program: Program,
  reader: (id: string, seed: number) => AsyncIterable<Candidate>,
  seed: number,
  tick: () => void,
  resourceMetadata?: ResourceMetadataReader,
): AsyncGenerator<Candidate> {
  const atom = (value: Atom["value"], parts: SourcePart[] = [], notes?: string[]): Atom => {
    if (typeof value === "string") boundedText(value);
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("数值超出有限范围");
    // Reusing a scalar must not double its entire provenance on every operation.
    // Deduplicate before the next expression, rather than only at final emit.
    return { type: "atom", value, parts: uniqueParts(parts), notes: notes ? [...new Set(notes)] : undefined };
  };
  const scalar = (value: Value): Atom => {
    if (value.type !== "atom") throw new Error("需要标量值");
    return value;
  };
  function evaluate(e: Expr, env: Map<string, Value>): Value {
    try { return evaluateValue(e, env); }
    catch (error) { throw diagnose(error, { line: e.line }); }
  }
  function evaluateValue(e: Expr, env: Map<string, Value>): Value {
    tick();
    if (e.kind === "literal") return atom(e.value);
    if (e.kind === "variable") return env.get(e.name)!;
    if (e.kind === "resource") return { type: "resource", id: e.id };
    if (e.kind === "list")
      return {
        type: "list",
        items: e.items.map((x) => scalar(evaluate(x, env))),
      };
    if (e.kind === "unary") {
      const v = scalar(evaluate(e.value, env));
      return atom(e.op === "!" ? !v.value : -Number(v.value), v.parts);
    }
    if (e.kind === "binary") {
      const a = scalar(evaluate(e.left, env));
      if (e.op === "&&" && !a.value) return atom(false);
      if (e.op === "||" && a.value) return atom(true);
      const b = scalar(evaluate(e.right, env));
      const x = a.value,
        y = b.value;
      let result: Atom["value"];
      switch (e.op) {
        case "+":
          result =
            typeof x === "string" ? x + String(y) : Number(x) + Number(y);
          break;
        case "-":
          result = Number(x) - Number(y);
          break;
        case "*":
          result = Number(x) * Number(y);
          break;
        case "/":
          if (!y) throw new Error("不能除以零");
          result = Number(x) / Number(y);
          break;
        case "==":
          result = x === y;
          break;
        case "!=":
          result = x !== y;
          break;
        case "<":
          result = Number(x) < Number(y);
          break;
        case "<=":
          result = Number(x) <= Number(y);
          break;
        case ">":
          result = Number(x) > Number(y);
          break;
        case ">=":
          result = Number(x) >= Number(y);
          break;
        case "&&":
          result = Boolean(x && y);
          break;
        case "||":
          result = Boolean(x || y);
          break;
        default:
          throw new Error("未知运算");
      }
      return atom(result, [...a.parts, ...b.parts], [...(a.notes || []), ...(b.notes || [])]);
    }
    const args = e.args.map((x) => evaluate(x, env));
    if (["left", "right", "relation"].includes(e.name)) {
      const pair = args[0];
      if (pair.type !== "pair" || !pair.candidate.pair) throw new Error("需要关系词对变量");
      return atom(pair.candidate.pair[e.name as "left" | "right" | "relation"], pair.candidate.parts);
    }
    const values = args.map((v) => scalar(v));
    const params = signatures[e.name]?.parameters ? astParams(e.name as Op, values.map(v => v.value)) : {};
    const texts = values.map((v) => String(v.value));
    const parts = values.flatMap((v) => v.parts);
    const notes = values.flatMap(v => v.notes || []);
    if (isChineseOp(e.name)) {
      return { type: "chinese", op: e.name, input: values[0], params };
    }
    switch (e.name) {
      case "gamecheck":
        return atom(checkGameId(texts[0], parseGameRule(String(params.rules))).valid, parts, notes);
      case "pairs":
        return { type: "pairs", id: texts[0], relation: String(params.relation) };
      case "resource":
        return { type: "resource", id: texts[0] };
      case "range": {
        const from = Number(values[0].value),
          to = Number(values[1].value);
        if (
          !Number.isSafeInteger(from) ||
          !Number.isSafeInteger(to) ||
          to < from ||
          to - from > 1000000
        )
          throw new Error("range 需要整数，结束值不小于起始值，最多一百万次");
        return { type: "range", from, to };
      }
      case "length":
        return atom(glyphs(texts[0]).length);
      case "contains":
        return atom(texts[0].includes(texts[1]));
      case "startsWith":
        return atom(texts[0].startsWith(texts[1]));
      case "endsWith":
        return atom(texts[0].endsWith(texts[1]));
      case "pattern":
        return atom(transformText("pattern", [texts[1], texts[2]], params), parts, notes);
      case "concat":
      case "prefix":
      case "reverse":
        return atom(transformText(e.name, texts, params), parts, notes);
      case "text":
        return atom(texts[0], parts, notes);
      default:
        throw new Error("未知函数");
    }
  }
  async function* iterate(value: Value): AsyncGenerator<Value> {
    if (value.type === "pairs") {
      if (resourceMetadata) await requireResourceKind(resourceMetadata, value.id, true);
      if (value.relation && !["associated", "antonym", "couple", "parallel"].includes(value.relation)) throw new Error("未知关系类型");
      for await (const candidate of readPairs(reader, value.id, seed, value.relation, tick)) yield { type: "pair", candidate };
    } else if (value.type === "chinese") {
      const { transformChinese } = await import("./chinese");
      const resolved = await resolveMapping(value.params, resourceMetadata);
      for await (let item of transformChinese(resolved.resource && value.op === "hanconvert" ? "mapchars" : value.op, { text: String(value.input.value), parts: value.input.parts, notes: value.input.notes }, resolved.params, seed, tick)) {
        if(resolved.resource)item=mappingSource(item,String(value.params.mappingId),resolved.resource.version!,String(value.input.value));
        yield atom(item.text, item.parts, item.notes);
      }
    } else if (value.type === "resource") {
      if (resourceMetadata) await requireResourceKind(resourceMetadata, value.id, false);
      for await (const c of reader(value.id, seed)) {
        tick();
        if (c.pair) throw new Error("关系词库请使用 pairs(id, relation)");
        yield atom(c.text, c.parts, c.notes);
      }
    } else if (value.type === "range") {
      for (let n = value.from; n < value.to; n++) {
        tick();
        yield atom(n);
      }
    } else if (value.type === "list") {
      for (const item of value.items) {
        tick();
        yield item;
      }
    } else throw new Error("循环输入不是集合");
  }
  async function* block(
    body: Statement[],
    parent: Map<string, Value>,
  ): AsyncGenerator<Candidate> {
    const env = new Map(parent);
    for (const s of body) {
      tick();
      try {
        if (s.kind === "let") env.set(s.name, evaluate(s.value, env));
        else if (s.kind === "for") {
          for await (const item of iterate(evaluate(s.source, env))) {
            const child = new Map(env);
            child.set(s.name, item);
            yield* block(s.body, child);
          }
        } else if (s.kind === "if")
          yield* block(
            scalar(evaluate(s.test, env)).value ? s.body : s.otherwise,
            env,
          );
        else {
          const value = scalar(evaluate(s.value, env));
          const text = String(value.value);
          if (text.length > 1024)
            throw new Error("单条输出超过 1024 个代码单元");
          const parts = [
            ...new Map(
              value.parts.map((p) => [
                `${p.resourceId}\0${p.text}\0${p.version}\0${JSON.stringify(p.pair)}`,
                p,
              ]),
            ).values(),
          ];
          yield { text, parts, ...(value.notes?.length ? { notes: [...new Set(value.notes)] } : {}) };
        }
      } catch (error) {
        throw diagnose(error, { line: s.line });
      }
    }
  }
  yield* block(program.body, new Map());
}
