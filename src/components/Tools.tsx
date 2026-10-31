import { reverseEvidence } from "../core/lineage";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import type { Candidate, Resource } from "../core/model";
import type { ReverseMatch, ReverseResult } from "../core/reverse-search";
import { directionLabels, relationLabels } from "../core/relations";
export function ReverseSearch({ resources, initial = "", onDetail, onResource, onUse }: {
  resources: Resource[]; initial?: string; onDetail?: (c: Candidate) => void;
  onResource: (resource: Resource, entryId?: number) => void; onUse: (matches: ReverseMatch[]) => void;
}) {
  const [input, setInput] = useState(initial), [result, setResult] = useState<ReverseResult>();
  const [partial, setPartial] = useState<ReverseMatch[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [normalize, setNormalize] = useState(false), [phonetic, setPhonetic] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const task = useRef<Worker | null>(null), request = useRef(0);
  const signature = JSON.stringify(resources.map(r => [r.id, r.version]));
  useEffect(() => () => task.current?.terminate(), []);
  useEffect(() => { task.current?.terminate(); task.current = null; request.current++; setBusy(false); setResult(undefined); setPartial([]); }, [signature]);
  useEffect(() => { setInput(initial); }, [initial]);
  function cancel() { task.current?.terminate(); task.current = null; request.current++; setBusy(false); setPartial([]); setResult(undefined); setError("检索已取消"); }
  function search() {
    if (busy) return;
    setBusy(true); setProgress("查询索引"); setError(""); setResult(undefined); setPartial([]);
    const id = ++request.current;
    const worker = task.current ||= new Worker(new URL("../workers/reverse.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = e => {
      if (id !== request.current || e.data.id !== id) return;
      if (e.data.type === "progress") setProgress(`拼音候选扫描 ${e.data.processed} 条`);
      if (e.data.type === "batch") setPartial(prev => [...prev, ...e.data.matches].slice(0, 500));
      if (e.data.type === "done") { setResult(e.data.result); setBusy(false); }
      if (e.data.type === "error") { setError(e.data.message); setBusy(false); setPartial([]); }
    };
    worker.onerror = () => { worker.terminate(); if (task.current === worker) task.current = null; if (id === request.current) { setError("检索 Worker 加载或查询失败，请重试"); setBusy(false); } };
    worker.postMessage({ id, input, options: { ...(selected.length ? { resourceIds: selected } : {}), normalize, pinyin: phonetic, topK: 10 } });
  }
  const matches = result?.matches || partial;
  const name = (id: string) => resources.find(r => r.id === id)?.name || "已删除资源";
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow">FOLLOW THE LITTLE CLUES</div><h1>一个名字，藏着哪些故事<span className="heading-dot">.</span></h1><p>联合查找本地资源。匹配与组合推断均不证明生成历史。</p></div><Search size={28} /></div>
    <form className="reverse-input" onSubmit={e => { e.preventDefault(); search(); }}><Search size={21} /><input aria-label="逆向查找名字" maxLength={512} value={input} onChange={e => setInput(e.target.value)} placeholder="输入名字，例如：月亮邮差" /><button className="primary-button" disabled={busy || !input}>{busy ? "正在查找…" : "寻找线索"}<ArrowRight size={16} /></button>{busy ? <button type="button" className="button" onClick={cancel}>取消检索</button> : null}</form>
    <div className="tool-panel reverse-options"><label><input type="checkbox" checked={normalize} onChange={e => setNormalize(e.target.checked)} />简繁候选归一化</label><label><input type="checkbox" checked={phonetic} onChange={e => setPhonetic(e.target.checked)} />拼音候选（限 10,000 条）</label><details><summary>检索词库：{selected.length ? `${selected.length} 个` : "全部"}</summary>{resources.map(r => <label key={r.id}><input type="checkbox" checked={selected.includes(r.id)} onChange={e => setSelected(prev => e.target.checked ? [...prev, r.id] : prev.filter(id => id !== r.id))} />{r.name}</label>)}</details></div>
    {error ? <p role="alert">{error}</p> : null}
    {busy ? <p role="status">{progress}…已返回 {matches.length} 条命中</p> : null}
    {result ? <div className="reverse-summary"><b>{result.input}</b><span>{result.known ? "确定来源 · 存在真实生成记录" : "未找到可追溯生成记录"}</span>{result.known ? <button className="button" onClick={() => onDetail?.(result.known!)}>查看已保存来源</button> : null}</div> : null}
    {result ? <details className="tool-panel"><summary>逆向来源证据概要（匹配与推断分层）</summary><ul>{reverseEvidence(result).map((c,i)=><li key={i}>{{executed:'已证实',matched:'确定匹配',inferred:'推断',unknown:'不可判断'}[c.evidence]} · {c.summary}</li>)}</ul><button className="text-button" onClick={()=>{void navigator.clipboard.writeText(JSON.stringify(reverseEvidence(result),null,2)).catch(()=>setError('复制溯源概要失败，请重试'));}}>复制逆向溯源概要</button></details> : null}
    {result || busy ? <div className="reverse-results"><div className="tool-panel"><h2>确定匹配 · 词条与候选 <span className="count-badge">{matches.length}</span></h2>{matches.map((m, i) => <div className="match-row" key={i}><b>{m.text}</b><span>{name(m.resourceId)} · #{m.entryId}</span><span>{m.type === "exact" ? "完整匹配" : m.type === "fragment" ? "片段匹配" : m.type === "normalized" ? "简繁规则匹配" : "拼音候选"} · 字符簇 [{m.start}, {m.end}) · UTF-16 [{m.utf16Start}, {m.utf16End})</span><button className="text-button" onClick={() => { const r = resources.find(r => r.id === m.resourceId); if (r) onResource(r, m.entryId); }}>查看资源</button><button className="text-button" onClick={() => onUse([m])}>加入工作流</button></div>)}{!matches.length && !busy ? <p>当前资源中没有匹配词条。</p> : null}</div>
    {result ? <><div className="tool-panel"><h2>可能来源 · 分词与组合</h2>{result.paths.map((path, i) => <div className="split-path" key={i}><b>{path.matches.map(m => m.text).join(" + ")}</b><span>覆盖 {(path.coverage * 100).toFixed(0)}% · {path.complete ? "完整" : "部分"}</span><button className="text-button" onClick={() => onUse(path.matches)}>用命中片段创建工作流</button></div>)}{!result.paths.length ? <p>无法依据现有命中拆分。</p> : null}<p>证据分层：词条/结构为确定匹配；拼音、归一化与组合为候选推断；没有真实运行记录时不可判断生成来源。</p><p>确定结构匹配：{result.patterns.join("、") || "未检测到已知重复模式"}</p>{result.possibleTemplates.map(t => <p key={`${t.workflowId}:${t.nodeId}`}>可能来源：已保存模板「{t.name}」/{t.nodeId} 可产生此文字；不证明实际生成历史。</p>)}</div>
    <div className="tool-panel"><h2>确定匹配 · 关系查询</h2>{result.relations.map((m, i) => <div className="match-row" key={i}><b>{m.row.left} / {m.row.right}</b><span>{relationLabels[m.row.relation]} · {directionLabels[m.row.direction || "unknown"]} · {m.traversal === "forward" ? "正向" : "反向"}命中{m.paired ? " · 两端出现" : ""}</span><button className="text-button" onClick={() => { const r = resources.find(r => r.id === m.row.resourceId); if (r) onResource(r); }}>{name(m.row.resourceId)}</button></div>)}{!result.relations.length ? <p>未找到允许此方向查询的关系。</p> : null}</div>{result.warnings.map((warning, i) => <p role="status" key={i}>{warning}</p>)}</> : null}</div> : <div className="reverse-welcome"><h2>从已存在的资源寻找线索</h2><p>选择词库或搜索全部本地资源，保留多种合理拆分。</p></div>}
    <p className="page-note">最多 64 字符簇、500 处命中、10 条拆分、200 行关系；位置从 0 起。总查询预算 10 秒。模板只分析已保存的共享变量模板节点，最多 20 个工作流 / 20 个模板节点、每节点 10,000 步 / 200 个输出。不执行任意自定义代码的通用逆向。</p>
  </div>;
}
