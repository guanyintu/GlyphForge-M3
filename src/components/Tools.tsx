import { useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Copy,
  FlaskConical,
  Search,
  Sparkles,
} from "lucide-react";
import { execute } from "../core/engine";
import { glyphs, unicodeMetrics } from "../core/model";
import type { Candidate, Op, Resource, Workflow } from "../core/model";
import { db } from "../storage/db";
export function TextLab({
  onSave,
  onCopy,
}: {
  onSave: (c: Candidate[]) => void;
  onCopy: (s: string) => void;
}) {
  const [text, setText] = useState("月亮邮差\n星河收藏家\n宇宙漫游者");
  const [op, setOp] = useState<Op>("reverse");
  const [prefix, setPrefix] = useState("小小");
  const [results, setResults] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  async function transform() {
    setError("");
    const list: Candidate[] = [];
    const workflow: Workflow = {
      version: 1,
      id: "lab",
      name: "文字实验室",
      layout: {},
      seed: 0,
      limit: 10000,
      nodes: [
        {
          id: "a",
          op: "resource",
          params: { resourceId: "input" },
          inputs: [],
        },
        {
          id: "b",
          op,
          params:
            op === "prefix"
              ? { text: prefix }
              : op === "filter"
                ? { maxLength: 4, includes: "", excludes: "" }
                : {},
          inputs: ["a"],
        },
        { id: "out", op: "output", params: {}, inputs: ["b"] },
      ],
    };
    try {
      await execute(
        workflow,
        async function* () {
          for (const line of text.split("\n").filter(Boolean))
            yield { text: line, parts: [] };
        },
        (batch) => list.push(...batch),
      );
      setResults(list);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A LITTLE EXPERIMENT</div>
          <h1>
            让文字，换一种可能<span className="heading-dot">.</span>
          </h1>
          <p>不必连接节点，给手边的文字做一次小实验。</p>
        </div>
        <span className="large-page-icon">
          <FlaskConical size={28} />
        </span>
      </div>
      <div className="lab-layout">
        <section className="tool-panel">
          <div className="tool-panel-heading">
            <h2>原始文字</h2>
            <span>每行一个名字</span>
          </div>
          <textarea
            className="lab-textarea"
            aria-label="实验室输入文字"
            value={text}
            maxLength={50000}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="metrics">
            {Object.entries(unicodeMetrics(text.split("\n")[0] || "")).map(
              ([key, val]) => (
                <span key={key}>
                  {
                    {
                      utf16: "UTF-16",
                      codePoints: "码点",
                      graphemes: "可见字符",
                      bytes: "UTF-8 字节",
                    }[key]
                  }{" "}
                  <b>{val}</b>
                </span>
              ),
            )}
          </div>
        </section>
        <section className="tool-panel lab-settings">
          <div className="eyebrow">选择一个算子</div>
          {[
            { id: "reverse", name: "文字倒序", desc: "给名字一个新视角" },
            { id: "prefix", name: "添加前缀", desc: "加一点专属的标记" },
            { id: "filter", name: "短名字筛选", desc: "只保留 4 字以内的名字" },
          ].map((item) => (
            <button
              className={`lab-option ${op === item.id ? "active" : ""}`}
              key={item.id}
              onClick={() => setOp(item.id as Op)}
            >
              <b>{item.name}</b>
              <small>{item.desc}</small>
            </button>
          ))}
          {op === "prefix" ? (
            <input
              aria-label="实验室前缀"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
            />
          ) : null}
          <button className="primary-button" onClick={transform}>
            <Sparkles size={15} />
            开始实验
            <ArrowRight size={15} />
          </button>
        </section>
        <section className="tool-panel">
          <div className="tool-panel-heading">
            <h2>新的可能</h2>
            <button
              className="icon-button"
              disabled={!results.length}
              onClick={() => onCopy(results.map((x) => x.text).join("\n"))}
              aria-label="复制实验结果"
            >
              <Copy size={15} />
            </button>
          </div>
          <div className="lab-output">
            {results.length ? (
              results.map((c) => <p key={c.text}>{c.text}</p>)
            ) : (
              <div className="empty-state">
                <Sparkles size={25} />
                <p>你的下一次灵感，在这里出现。</p>
              </div>
            )}
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <button
            className="button"
            disabled={!results.length}
            onClick={() => onSave(results)}
          >
            <BookOpen size={15} />
            将结果保存为词库
          </button>
        </section>
      </div>
      <p className="page-note">
        与工作流共用相同算子 · 可见字符按 Unicode 字符簇计算 · 本地处理
      </p>
    </div>
  );
}
interface Match {
  text: string;
  resourceId: string;
  start: number;
  end: number;
}
export function ReverseSearch({
  resources,
  candidates,
  initial = "",
  onDetail,
}: {
  resources: Resource[];
  candidates: Candidate[];
  initial?: string;
  onDetail?: (c: Candidate) => void;
}) {
  const [input, setInput] = useState(initial);
  const [searched, setSearched] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedKnown, setSavedKnown] = useState<Candidate>();
  const known =
    candidates.find((x) => x.text === searched && x.workflowId) || savedKnown;
  const resourceNames = useMemo(
    () => new Map(resources.map((r) => [r.id, r.name])),
    [resources],
  );
  async function search() {
    if (!input.trim()) return;
    setBusy(true);
    const value = glyphs(input.trim().slice(0, 64));
    const subs: string[] = [];
    for (let i = 0; i < value.length; i++)
      for (let j = i + 1; j <= value.length; j++)
        subs.push(value.slice(i, j).join(""));
    try {
      setSavedKnown(
        await db.generated
          .where("text")
          .equals(input.trim().slice(0, 64))
          .last(),
      );
      const entries = await db.entries
        .where("text")
        .anyOf([...new Set(subs)])
        .limit(500)
        .toArray();
      const next: Match[] = [];
      for (const entry of entries)
        for (let i = 0; i < value.length; i++) {
          const chars = glyphs(entry.text);
          if (value.slice(i, i + chars.length).join("") === entry.text)
            next.push({
              text: entry.text,
              resourceId: entry.resourceId,
              start: i,
              end: i + chars.length,
            });
        }
      setMatches(next);
      setSearched(input.trim().slice(0, 64));
    } finally {
      setBusy(false);
    }
  }
  const splits: Match[][] = [];
  let searchSteps = 0;
  function walk(pos: number, path: Match[]) {
    if (++searchSteps > 5000 || splits.length >= 5 || path.length > 12) return;
    if (pos === glyphs(searched).length && path.length) {
      splits.push(path);
      return;
    }
    for (const m of matches.filter((m) => m.start === pos))
      walk(m.end, [...path, m]);
  }
  if (searched) walk(0, []);
  const chars = glyphs(searched);
  const patterns: string[] = [];
  if (chars.length === 4)
    for (const p of ["AABB", "ABAB", "ABBA"]) {
      const vars: Record<string, string> = {};
      if (
        [...p].every((c, i) => {
          if (!vars[c]) vars[c] = chars[i];
          return vars[c] === chars[i];
        })
      )
        patterns.push(p);
    }
  if (chars.length > 1 && chars.join("") === [...chars].reverse().join(""))
    patterns.push("回文");
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">FOLLOW THE LITTLE CLUES</div>
          <h1>
            一个名字，藏着哪些故事<span className="heading-dot">.</span>
          </h1>
          <p>查找真实词库匹配，探索名字可能的文字组合。</p>
        </div>
        <span className="large-page-icon">
          <Search size={28} />
        </span>
      </div>
      <form
        className="reverse-input"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Search size={21} />
        <input
          aria-label="逆向查找名字"
          maxLength={64}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入一个名字，例如：月亮邮差"
        />
        <button className="primary-button" disabled={busy || !input.trim()}>
          {busy ? "正在查找…" : "寻找线索"}
          <ArrowRight size={16} />
        </button>
      </form>
      {!searched ? (
        <div className="reverse-welcome">
          <div className="reverse-art">
            <span>月亮</span>
            <i>+</i>
            <span>邮差</span>
          </div>
          <h2>顺着文字，找回灵感的起点</h2>
          <p>从你的本地词库中查找完整词条、文字片段和可能的拆分。</p>
        </div>
      ) : (
        <div className="reverse-results">
          <div className="reverse-summary">
            <b>{searched}</b>
            <span>
              {known
                ? "已知生成来源 · 生成记录已保存"
                : "外部输入 · 以下为词库匹配与组合推断"}
            </span>
            {known ? (
              <button className="button" onClick={() => onDetail?.(known)}>
                查看已保存来源
              </button>
            ) : null}
          </div>
          <div className="tool-panel">
            <h2>
              词库中的线索 <span className="count-badge">{matches.length}</span>
            </h2>
            {matches.length ? (
              matches.map((m, i) => (
                <div className="match-row" key={i}>
                  <span className="match-word">{m.text}</span>
                  <span>{resourceNames.get(m.resourceId) || "已删除词库"}</span>
                  <span className="match-confidence">
                    {m.text === searched
                      ? "完整匹配"
                      : `片段匹配 · 第 ${m.start + 1} 字起`}
                  </span>
                </div>
              ))
            ) : (
              <p className="field-note">
                当前词库中没有匹配条目，可以先在资源中心添加。
              </p>
            )}
          </div>
          <div className="tool-panel">
            <h2>可能的组合方式</h2>
            {splits.map((path, i) => (
              <div className="split-path" key={i}>
                {path.map((m, j) => (
                  <span key={j}>
                    {j ? <i>+</i> : null}
                    <b>
                      {m.text}
                      <small>{resourceNames.get(m.resourceId)}</small>
                    </b>
                  </span>
                ))}
                <em>候选推断</em>
              </div>
            ))}
            {!splits.length ? (
              <p className="field-note">暂时无法通过现有词库完整拆分。</p>
            ) : null}
            {patterns.length ? (
              <p className="field-note">
                确定满足的字符规则：{patterns.join("、")}
              </p>
            ) : null}
          </div>
        </div>
      )}
      <p className="page-note">
        最多分析 64 个代码单元、500 条片段匹配及 5 种拆分 ·
        词库匹配不代表真实生成来源
      </p>
    </div>
  );
}
