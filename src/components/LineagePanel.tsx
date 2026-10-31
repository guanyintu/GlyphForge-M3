import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Candidate } from '../core/model';
import { inspectLineage } from '../storage/lineage';

export default function LineagePanel({candidate}:{candidate:Candidate}) {
  const [error,setError] = useState(''), [copied,setCopied] = useState(false);
  const report = useLiveQuery(async () => {
    try { return await inspectLineage(candidate); }
    catch { return null; }
  },[candidate]);
  async function copy() {
    try { await navigator.clipboard.writeText(JSON.stringify(report,null,2)); setCopied(true); setError(''); }
    catch { setError('复制失败，请检查剪贴板权限后重试'); }
  }
  return <section className="tool-panel" aria-label="结构化来源详情">
    <h3>来源链与证据</h3>
    {report === undefined ? <p role="status">读取选中项来源…</p> : report === null ? <p role="alert">来源读取失败，请关闭后重试</p> : <>
      <p>{report.label}{report.derivation ? ' · 名字变异衍生' : ''}</p>
      {report.run ? <p>运行 {report.run.id} · 种子 {report.run.seed} · {new Date(report.run.createdAt).toLocaleString('zh-CN')}</p> : null}
      {report.derivation ? <p>父来源 {report.derivation.parent.runId ?? '未记录'} · {report.derivation.parentState}</p> : null}
      <details><summary>展开操作路径（{report.operations.length} 项{report.incomplete?'，摘要截断':''}）</summary>
        <ol>{report.operations.map((o,i) => <li key={i}>{o.scope} / {o.path} → {o.summary}</li>)}</ol>
        <p>输入片段 → 上述操作摘要 → {report.result}</p>
      </details>
      <details><summary>资源版本与可用性（{report.resources.length} 项）</summary><ul>{report.resources.map(r=><li key={r.id}>{r.id} · v{r.version??'?'} · {r.state}</li>)}</ul></details>
      {report.extensions.length ? <ul>{report.extensions.map(e=><li key={e.key}>{e.key} · {e.state}</li>)}</ul> : null}
      {report.limitations.map(t=><p className="field-note" key={t}>{t}</p>)}
      <button className="text-button" onClick={copy}>{copied?'已复制溯源概要':'复制溯源概要'}</button>
      {error ? <p role="alert">{error}</p> : null}
    </>}
  </section>;
}
