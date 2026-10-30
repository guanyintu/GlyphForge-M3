import { useMemo, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { glyphs } from "../core/model";
import type { Candidate, Resource } from "../core/model";
import { db } from "../storage/db";
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
