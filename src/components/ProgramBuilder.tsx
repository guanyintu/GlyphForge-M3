import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { Expr, Program, Statement } from "../core/program";
import {
  expressionCode,
  ProgramParser,
  validateProgram,
} from "../core/program";
import type { Resource } from "../core/model";
function ExpressionField({
  value,
  onChange,
  label,
}: {
  value: Expr;
  onChange: (e: Expr) => void;
  label: string;
}) {
  const [text, setText] = useState(expressionCode(value)),
    [error, setError] = useState("");
  useEffect(() => setText(expressionCode(value)), [value]);
  return (
    <label className="field-label">
      {label}
      <input
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const parser = new ProgramParser(text);
            const expression = parser.expression();
            if (parser.peek().type !== "eof") parser.fail("表达式后有多余内容");
            onChange(expression);
            setError("");
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      {error ? <small className="error-text">{error}</small> : null}
    </label>
  );
}
function BlockEditor({
  body,
  onChange,
  resources,
  depth = 0,
}: {
  body: Statement[];
  onChange: (body: Statement[]) => void;
  resources: Resource[];
  depth?: number;
}) {
  function update(i: number, statement: Statement) {
    onChange(body.map((s, j) => (i === j ? statement : s)));
  }
  function add(kind: Statement["kind"]) {
    const line = Date.now() % 100000;
    const name = `word_${line}`;
    const literal: Expr = { kind: "literal", value: "新名字", line };
    let next: Statement;
    switch (kind) {
      case "for":
        next = {
          kind,
          name,
          source: { kind: "resource", id: resources[0]?.id || "animals", line },
          body: [
            { kind: "emit", value: { kind: "variable", name, line }, line },
          ],
          line,
        };
        break;
      case "if":
        next = {
          kind,
          test: { kind: "literal", value: true, line },
          body: [{ kind: "emit", value: literal, line }],
          otherwise: [],
          line,
        };
        break;
      case "let":
        next = { kind, name: `name_${line}`, value: literal, line };
        break;
      case "emit":
        next = { kind, value: literal, line };
        break;
    }
    onChange([...body, next]);
  }
  return (
    <div
      className="program-block"
      style={{ "--depth": depth } as React.CSSProperties}
    >
      {body.map((s, i) => (
        <div
          className={`program-statement statement-${s.kind}`}
          key={`${i}-${s.kind}`}
        >
          <div className="statement-heading">
            <b>
              {
                {
                  for: "FOR · 遍历",
                  if: "IF · 条件",
                  let: "LET · 变量",
                  emit: "EMIT · 输出",
                }[s.kind]
              }
            </b>
            <span className="statement-actions">
              <button
                className="icon-button"
                aria-label={`上移语句 ${depth}-${i}`}
                disabled={!i}
                onClick={() => {
                  const next = [...body];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange(next);
                }}
              >
                <ArrowUp size={12} />
              </button>
              <button
                className="icon-button"
                aria-label={`下移语句 ${depth}-${i}`}
                disabled={i === body.length - 1}
                onClick={() => {
                  const next = [...body];
                  [next[i + 1], next[i]] = [next[i], next[i + 1]];
                  onChange(next);
                }}
              >
                <ArrowDown size={12} />
              </button>
              <button
                className="icon-button"
                aria-label={`删除语句 ${depth}-${i}`}
                onClick={() => onChange(body.filter((_, j) => j !== i))}
              >
                <Trash2 size={12} />
              </button>
            </span>
          </div>
          {s.kind === "for" || s.kind === "let" ? (
            <label className="field-label">
              变量名
              <input
                aria-label={`变量名 ${depth}-${i}`}
                value={s.name}
                onChange={(e) => update(i, { ...s, name: e.target.value })}
              />
            </label>
          ) : null}
          {s.kind === "for" ? (
            <>
              <div className="row">
                <ExpressionField
                  label={`循环集合 ${depth}-${i}`}
                  value={s.source}
                  onChange={(source) => update(i, { ...s, source })}
                />
                <select
                  aria-label={`选择循环词库 ${depth}-${i}`}
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      update(i, {
                        ...s,
                        source: resources.find(r => r.id === e.target.value)?.kind === "relation" ? {
                          kind: "call", name: "pairs", args: [{ kind: "literal", value: e.target.value, line: s.line }, { kind: "literal", value: "", line: s.line }], line: s.line,
                        } : {
                          kind: "resource",
                          id: e.target.value,
                          line: s.line,
                        },
                      });
                  }}
                >
                  <option value="">引用词库…</option>
                  {resources.filter(r=>r.kind!=="mapping").map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}{r.kind === "relation" ? "（关系变量使用 left / right）" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <BlockEditor
                depth={depth + 1}
                body={s.body}
                onChange={(next) => update(i, { ...s, body: next })}
                resources={resources}
              />
            </>
          ) : null}
          {s.kind === "if" ? (
            <>
              <ExpressionField
                label={`判断条件 ${depth}-${i}`}
                value={s.test}
                onChange={(test) => update(i, { ...s, test })}
              />
              <small className="block-label">条件成立 THEN</small>
              <BlockEditor
                depth={depth + 1}
                body={s.body}
                onChange={(body) => update(i, { ...s, body })}
                resources={resources}
              />
              <small className="block-label">否则 ELSE</small>
              <BlockEditor
                depth={depth + 1}
                body={s.otherwise}
                onChange={(otherwise) => update(i, { ...s, otherwise })}
                resources={resources}
              />
            </>
          ) : null}
          {s.kind === "let" || s.kind === "emit" ? (
            <ExpressionField
              label={`${s.kind === "let" ? "赋值表达式" : "输出文字"} ${depth}-${i}`}
              value={s.value}
              onChange={(value) => update(i, { ...s, value })}
            />
          ) : null}
        </div>
      ))}
      <div className="program-add">
        {(["for", "if", "let", "emit"] as const).map((kind) => (
          <button
            className="text-button"
            key={kind}
            disabled={depth >= 12 && (kind === "for" || kind === "if")}
            onClick={() => add(kind)}
          >
            <Plus size={11} />
            {kind}
          </button>
        ))}
      </div>
    </div>
  );
}
export default function ProgramBuilder({
  program,
  resources,
  onChange,
}: {
  program: Program;
  resources: Resource[];
  onChange: (p: Program) => void;
}) {
  let error = "";
  try {
    validateProgram(program);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return (
    <div className="program-builder">
      <p className="field-note">
        逐层编辑循环与条件。表达式支持 pattern、length、contains、reverse、range；中文算子返回集合，可用 for 遍历（参数顺序见 NameScript 文档）。
        等内置函数。range(a,b) 包含 a，不包含 b。编辑后离开输入框会应用。
      </p>
      {error ? (
        <p className="code-error" role="alert">
          {error}
        </p>
      ) : (
        <p className="program-valid">✓ 作用域与类型检查通过</p>
      )}
      <BlockEditor
        body={program.body}
        onChange={(body) => onChange({ ...program, body })}
        resources={resources}
      />
    </div>
  );
}
