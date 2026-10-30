import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type RunRecord } from "../storage/db";
import type { Candidate } from "../core/model";
import { exportRun, restoreRun, historyLimit, pinRun, pruneHistory, runStatusLabel } from "../storage/run-lifecycle";
import { download } from "../core/sharing";

function HistoryPage({ onDetail }: { onDetail: (c: Candidate) => void }) {
  const [page, setPage] = useState(0), [selected, setSelected] = useState<RunRecord>();
  const [resultPage, setResultPage] = useState(0), [error, setError] = useState("");
  const [keep, setKeep] = useState(historyLimit), [busy, setBusy] = useState(false);
  const rows = useLiveQuery(() => db.runs.orderBy("createdAt").reverse().offset(page * 10).limit(11).toArray(), [page]) ?? [];
  const results = useLiveQuery(() => selected ? db.generated.where("runId").equals(selected.id).offset(resultPage * 50).limit(51).toArray() : [], [selected?.id, resultPage]) ?? [];
  async function action(task: () => Promise<unknown>) {
    setBusy(true); setError("");
    try { await task(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="tool-panel" aria-label="运行历史">
    <p>自动保留最近 {keep} 次普通运行；固定、收藏依赖和执行中的运行额外保留。收藏会保留整次来源运行。错误与中断可能含部分结果。</p>
    <p>旧记录在下次生成结束或手动清理时按策略回收；需要长期保留请固定或逐次导出备份。</p>
    <label>普通历史保留数量 <input aria-label="普通历史保留数量" type="number" min={0} max={200} value={keep} onChange={e => {
      const value = Number(e.target.value); if (Number.isInteger(value) && value >= 0 && value <= 200) { setKeep(value); localStorage.setItem("glyphforge-history-limit", String(value)); }
    }} /></label>
    <button className="text-button" disabled={busy} onClick={() => action(async () => { await pruneHistory(keep); setPage(0); setSelected(undefined); })}>按策略清理历史</button>
    <label className="text-button">恢复运行备份<input aria-label="恢复运行备份" type="file" accept=".json" disabled={busy} onChange={e => {
      const file = e.target.files?.[0]; e.target.value = "";
      if (file) void action(async () => { if (file.size > 32 * 1024 * 1024) throw new Error("备份超过 32 MiB"); await restoreRun(await file.text()); setPage(0); });
    }} /></label>
    {error ? <p role="alert">操作失败：{error}。可重试；已完成清理的记录需用备份恢复。</p> : null}
    <div>{rows.slice(0, 10).map(run => <div key={run.id} className="history-row" data-run-id={run.id}>
      <span>{run.workflow.name} · {runStatusLabel[run.status]} · {run.count} 项 · {new Date(run.createdAt).toLocaleString("zh-CN")}{run.retention === 1 ? " · 来源受保护" : ""}</span>
      {run.message ? <small> · {run.message}</small> : null}
      <button className="text-button" disabled={busy} onClick={() => action(async () => { await pinRun(run.id, !run.pinned); await pruneHistory(keep); })}>{run.pinned ? "取消固定" : "固定"}</button>
      <button className="text-button" onClick={() => { setSelected(run); setResultPage(0); }}>查看结果</button>
      <button className="text-button" disabled={busy} onClick={() => action(async () => download(`GlyphForge-run-${run.id}.json`, await exportRun(run.id), "application/json"))}>导出运行备份</button>
    </div>)}</div>
    <button className="text-button" disabled={page === 0} onClick={() => { setPage(p => p - 1); setSelected(undefined); }}>上一页运行</button>
    <span>第 {page + 1} 页 · 每页 10 次</span>
    <button className="text-button" disabled={rows.length <= 10} onClick={() => { setPage(p => p + 1); setSelected(undefined); }}>下一页运行</button>
    {selected ? <div aria-label="历史运行结果"><p>{selected.workflow.name} · 每页 50 项 · 备份含工作流快照和版本号，不含历史资源全集。</p>
      {results.slice(0, 50).map(c => <button key={c.text} className="text-button" onClick={() => onDetail(c)}>{c.text}</button>)}
      <div><button className="text-button" disabled={resultPage === 0} onClick={() => setResultPage(p => p - 1)}>上一页结果</button><button className="text-button" disabled={results.length <= 50} onClick={() => setResultPage(p => p + 1)}>下一页结果</button></div>
    </div> : null}
  </div>;
}
export default function RunHistory(props: { onDetail: (c: Candidate) => void }) {
  const [open, setOpen] = useState(false);
  return <section><button className="text-button" aria-expanded={open} onClick={() => setOpen(v => !v)}>运行历史与留存{open ? "（收起）" : ""}</button>{open ? <HistoryPage {...props} /> : null}</section>;
}
