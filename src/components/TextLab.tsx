import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Copy, FlaskConical, RotateCcw, Sparkles, Square } from "lucide-react";
import type { Candidate, Op, Params } from "../core/model";
import { operators, unicodeMetrics } from "../core/model";
import { isChineseOp } from "../core/chinese-definitions";
import type { RunStats } from "../core/engine";
import { ChineseParams } from "./ChineseParams";
import "../p1.css";

type Snapshot = { label: string; results: Candidate[] };
const labOps = Object.values(operators).filter(op => op.inputs === 1 && op.id !== "output");
export function TextLab({ onSave, onCopy }: {
  onSave: (c: Candidate[]) => void | Promise<void>; onCopy: (s: string) => void;
}) {
  const [text, setText] = useState("明\n思\n月亮邮差");
  const [op, setOp] = useState<Op>("pinyin");
  const [params, setParams] = useState<Params>({ ...operators.pinyin.defaults });
  const [seed, setSeed] = useState(42);
  const [results, setResults] = useState<Candidate[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [source, setSource] = useState<Candidate[]>();
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const worker = useRef<Worker | null>(null);
  const taskId = useRef(0);
  const running = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Candidate[]>([]);
  useEffect(() => () => { taskId.current++; worker.current?.terminate(); clearTimeout(timeout.current); }, []);
  const selected = results.filter(c => selection.has(c.text));
  function cancel() {
    clearTimeout(timeout.current); running.current = false;
    taskId.current++;
    worker.current?.terminate(); worker.current = null;
    pending.current = [];
    setBusy(false); setStatus("已取消，保留上一次完成的结果");
  }
  function transform() {
    if (running.current) return;
    setError("");
    const input = source || text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(text => ({ text, parts: [] }));
    if (!input.length) { setError("请先输入文字或选择继续加工的结果"); return; }
    const id = ++taskId.current;
    running.current = true;
    try {
      worker.current ||= new Worker(new URL("../workers/lab.worker.ts", import.meta.url), { type: "module" });
      pending.current = []; setBusy(true); setStatus("正在加载所需字典并加工…");
      const started = performance.now();
      const watchdog = timeout.current = window.setTimeout(() => {
        if (taskId.current === id) { cancel(); setError("超过 15 秒，请缩小批量后重试"); }
      }, 15000);
      worker.current.onmessage = event => {
        if (taskId.current !== id) return;
        const message = event.data;
        if (message.type === "batch") { pending.current.push(...message.batch); setStatus(`正在预备 ${pending.current.length} 个结果，完成后更新预览`); }
        if (message.type === "progress") setStatus(`后台加工中 · ${message.steps.toLocaleString()} 步`);
        if (message.type === "done" || message.type === "error") {
          window.clearTimeout(watchdog); running.current = false; setBusy(false);
          if (message.type === "error") { pending.current = []; setError(message.message); setStatus("上一次完成的结果已保留"); return; }
          const next = pending.current; pending.current = [];
          setResults(next); setSelection(new Set(next.map(c => c.text))); setPage(0);
          setSnapshots(previous => [...previous, { label: operators[op].name, results: next }].slice(-8));
          const stats = message.stats as RunStats;
          setStatus(`${next.length} 个唯一结果 · ${(performance.now() - started).toFixed(0)} ms（含字典加载）${stats.truncated ? " · 已达到 10000 条总上限" : ""}`);
        }
      };
      worker.current.onerror = () => {
        window.clearTimeout(watchdog);
        if (taskId.current === id) { cancel(); setError("后台模块加载失败，请刷新或重新尝试"); }
      };
      worker.current.postMessage({ op, params, source: input, seed });
    } catch (e) { cancel(); setError(e instanceof Error ? e.message : "无法启动实验"); }
  }
  async function save() {
    if (selected.some(c => c.text.length > 256)) { setError("词库词条最多 256 个代码单元，请先筛选或取消勾选过长结果"); return; }
    setSaving(true); setError("");
    try { await onSave(selected); setStatus(`已另存 ${selected.length} 条到新词库，原始数据保留`); }
    catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setSaving(false); }
  }
  const visible = results.slice(page * 60, (page + 1) * 60);
  return <div className="page-content chinese-lab">
    <div className="page-heading"><div><div className="eyebrow">A LITTLE EXPERIMENT / 中文文字实验室</div>
      <h1>让文字，换一种可能<span className="heading-dot">.</span></h1>
      <p>从读音到字形，每一步都留下新的分岔。原稿始终保留。</p></div><span className="large-page-icon"><FlaskConical size={28} /></span></div>
    <div className="lab-layout">
      <section className="tool-panel">
        <div className="tool-panel-heading"><h2>01 / 原始文字</h2><span>每行一条</span></div>
        <textarea className="lab-textarea" aria-label="实验室输入文字" value={text} maxLength={50000} onChange={e => { setText(e.target.value); setSource(undefined); }} disabled={busy} />
        <div className="metrics">{Object.entries(unicodeMetrics(text.split("\n")[0] || "")).map(([key, value]) => <span key={key}>{({ utf16: "UTF-16", codePoints: "码点", graphemes: "字符簇", bytes: "UTF-8 字节" })[key]} <b>{value}</b></span>)}</div>
        <p className="field-note">拆字：明 / 思 / 国；组字：日、月。部件反查只返回字典中已收录的字。</p>
        {source ? <div className="lab-source"><b>接着加工 {source.length} 个已选结果</b><button className="text-button" disabled={busy} onClick={() => setSource(undefined)}>改用原始文字</button></div> : null}
        <div className="lab-history"><h3>加工记录</h3>{snapshots.length ? snapshots.map((step, i) => <button className="button" disabled={busy} key={i} onClick={() => { setResults(step.results); setSource(step.results); setSelection(new Set(step.results.map(c => c.text))); setPage(0); setStatus("已恢复此步结果，可继续加工"); }}><RotateCcw size={12} />{i + 1}. {step.label}<small>{step.results.length} 条</small></button>) : <p className="field-note">完成一次实验后，可以选择候选继续加工。保留最近 8 步。</p>}</div>
      </section>
      <section className="tool-panel lab-settings">
        <h2>02 / 选择变换</h2>
        <label className="field-label">算子<select aria-label="实验算子" disabled={busy} value={op} onChange={e => { const id = e.target.value as Op; setOp(id); setParams({ ...operators[id].defaults }); }}>
          {labOps.map(def => <option key={def.id} value={def.id}>{def.name}</option>)}
        </select></label>
        <p className="field-note">{operators[op].description}</p>
        {isChineseOp(op) ? <ChineseParams op={op} params={params} onChange={setParams} disabled={busy} />
          : Object.entries(operators[op].defaults).map(([key, value]) => <label className="field-label" key={key}>{({ text: "前缀", maxLength: "最多字符簇", includes: "包含", excludes: "排除" } as Record<string, string>)[key] || key}<input disabled={busy} maxLength={256} type={typeof value === "number" ? "number" : "text"} value={String(params[key])} onChange={e => setParams({ ...params, [key]: typeof value === "number" ? Number(e.target.value) : e.target.value })} /></label>)}
        <label className="field-label">可复现种子<input type="number" value={seed} disabled={busy} onChange={e => setSeed(Number(e.target.value))} /></label>
        {busy ? <button className="button" onClick={cancel}><Square size={14} />取消本次实验</button> : <button className="primary-button" onClick={transform}><Sparkles size={15} />开始实验<ArrowRight size={15} /></button>}
        <p className="field-note">候选上限作用于每条输入；最多输出 10000 条。有限候选按字典顺序预览，未遍历部分不代表不存在。</p>
      </section>
      <section className="tool-panel">
        <div className="tool-panel-heading"><h2>03 / 新的可能</h2><span>{results.length} 条</span></div>
        <p role="status" className="field-note">{status || "在这里预览结果，勾选你想留下的候选。"}</p>
        {error ? <p role="alert" className="error-text">{error}</p> : null}
        <div className="row lab-actions"><button className="text-button" disabled={!results.length || busy} onClick={() => setSelection(new Set(results.map(c => c.text)))}>全选</button><button className="text-button" disabled={busy} onClick={() => setSelection(new Set())}>清空选择</button><span>已选 {selected.length}</span></div>
        <div className="lab-output lab-candidates" aria-busy={busy}>
          {visible.length ? visible.map(c => <label className="lab-candidate" key={c.text}><input type="checkbox" disabled={busy} checked={selection.has(c.text)} onChange={e => setSelection(previous => { const next = new Set(previous); if (e.target.checked) next.add(c.text); else next.delete(c.text); return next; })} /><span><b>{c.text}</b>{c.notes?.length ? <small>{[...new Set(c.notes)].join("；")}</small> : null}</span></label>) : <div className="empty-state"><Sparkles size={25} /><p>你的下一次灵感，在这里出现。</p></div>}
        </div>
        {results.length > 60 ? <div className="row lab-pagination"><button className="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page + 1} / {Math.ceil(results.length / 60)}</span><button className="button" disabled={(page + 1) * 60 >= results.length} onClick={() => setPage(p => p + 1)}>下一页</button></div> : null}
        <div className="lab-result-actions"><button className="primary-button" disabled={!selected.length || busy} onClick={() => { setSource(selected); setStatus(`下一步将加工所选 ${selected.length} 条，可更换算子`); }}><ArrowRight size={15} />用所选结果继续加工</button>
          <button className="button" disabled={!selected.length || busy} onClick={() => onCopy(selected.map(c => c.text).join("\n"))}><Copy size={15} />批量复制</button>
          <button className="button" disabled={!selected.length || busy || saving} onClick={() => void save()}><BookOpen size={15} />{saving ? "正在保存…" : "另存为新词库"}</button></div>
      </section>
    </div>
    <p className="page-note">本地 Worker 加工 · 字典按需加载 · <a href="/licenses/cjk-decomp-README.md" target="_blank" rel="noreferrer">CJK Decomposition（Apache-2.0）</a> · <a href="/licenses/Unicode-License-V3.txt" target="_blank" rel="noreferrer">Unihan 17（Unicode V3）</a> · 数据只提供一种常见结构分析，扩展字与字体可能不完整</p>
  </div>;
}
