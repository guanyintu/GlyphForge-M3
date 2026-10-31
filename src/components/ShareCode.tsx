import { useEffect, useRef, useState } from 'react';
import type { Workflow } from '../core/model';
import { SHARE_LIMITS } from '../core/share-code';
import { shareTask, type EncodedShare } from '../core/share-task';
import type { SharePreview } from '../core/share-preview';

export function ShareCode({ workflow, ids, onImport }: { workflow: Workflow; ids: string[]; onImport: (data: unknown) => Promise<void> }) {
  const [portable, setPortable] = useState(false), [input, setInput] = useState('');
  const [encoded, setEncoded] = useState<EncodedShare>(), [preview, setPreview] = useState<{ data: unknown; summary: SharePreview }>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const job = useRef<AbortController | null>(null);
  function cancel() { job.current?.abort(); job.current = null; setBusy(false); }
  useEffect(() => { cancel(); setEncoded(undefined); setPreview(undefined); return () => { const task=job.current;job.current=null;task?.abort(); }; }, [workflow, ids, portable]);
  function start() { job.current?.abort(); const c = new AbortController(); job.current = c; setBusy(true); setMessage(''); return c; }
  async function task(decode: boolean) {
    const c = start(); setPreview(undefined); if (!decode) setEncoded(undefined);
    try {
      if (decode) {
        const result = await shareTask<{ data: unknown; summary: SharePreview }>({ action: 'preview', code: input }, c.signal);
        if (!c.signal.aborted) setPreview(result);
      } else {
        const result = await shareTask<EncodedShare>({ action: 'encode', workflow, selection: portable ? ids : false }, c.signal);
        if (!c.signal.aborted) setEncoded(result);
      }
    } catch (e) { if (!c.signal.aborted) setMessage(e instanceof Error ? e.message : String(e)); }
    finally { if (job.current === c) { job.current = null; setBusy(false); } }
  }
  async function copy() {
    if (!encoded) return;
    const c = start();
    try {
      // Clipboard writes already handed to the OS cannot be recalled; stale UI updates are suppressed.
      if (c.signal.aborted) return;
      await navigator.clipboard.writeText(encoded.code);
      if (!c.signal.aborted) setMessage('分享码已复制到系统剪贴板，请自行管理剪贴板隐私');
    } catch { if (!c.signal.aborted) setMessage('剪贴板不可用，请手动选中复制分享码'); }
    finally { if (job.current === c) { job.current = null; setBusy(false); } }
  }
  return <section className="share-code" aria-label="安全离线分享码">
    <h3>离线分享码</h3>
    <p className="field-note">内容 SHA-256 仅检错，不是签名、加密或身份认证。只分享工作流，不含收藏和生成历史。上限：JSON 1 MiB / 压缩 64 KiB / 8 秒。大包请下载 JSON 或本地保存。</p>
    <label className="field-label">分享码模式<select aria-label="分享码模式" value={portable ? 'portable' : 'light'} onChange={e => setPortable(e.target.value === 'portable')}><option value="light">轻量：只含规则和依赖引用</option><option value="portable">便携：仅包含上方勾选的资源</option></select></label>
    <p className="field-note">本次范围：{portable ? `${ids.length} 个勾选快照；未勾选资源须在目标设备绑定` : '0 个词库快照；目标设备需具备或绑定依赖'}</p>
    <div className="row"><button className="primary-button" disabled={busy} onClick={() => task(false)}>生成短分享码</button>{encoded && <button className="button" disabled={busy} onClick={copy}>复制分享码</button>}</div>
    {encoded && <><label className="field-label">生成的分享码<textarea aria-label="生成的分享码" readOnly value={encoded.code} rows={3} /></label><p role="status">{encoded.chars} 字符 · {encoded.jsonBytes} → {encoded.compressedBytes} 字节 · 压缩后 {(encoded.ratio * 100).toFixed(1)}%</p></>}
    <label className="field-label">粘贴分享码<textarea aria-label="粘贴分享码" maxLength={SHARE_LIMITS.chars} onPaste={e=>{if(e.clipboardData.getData('text').length>SHARE_LIMITS.chars){e.preventDefault();cancel();setPreview(undefined);setMessage('分享码超过 87500 字符；请使用 JSON 文件');}}} rows={3} value={input} onChange={e => { cancel(); setInput(e.target.value); setPreview(undefined); setMessage(''); }} /></label>
    <button className="button" disabled={busy || !input} onClick={() => task(true)}>解码并预览（不写入）</button>
    {busy && <button className="text-button" onClick={() => { cancel(); setMessage('任务已取消；已交给系统的剪贴板写入无法撤回'); }}>取消分享任务</button>}
    {message && <p role="status">{message}</p>}
    {preview && <div className="share-preview" aria-label="分享码导入预览">
      <h4>{preview.summary.name} · JSON v{preview.summary.version}</h4>
      <p>{preview.summary.nodes} 个节点 · {preview.summary.subgraphs} 个子图；动态 DAG / Mapping 见依赖。预览不安装扩展、不写入数据库。</p>
      <ul>{preview.summary.dependencies.map(d => <li key={d.id}>{d.label}：{d.status}</li>)}</ul>
      <ul>{preview.summary.extensions.map(p => <li key={p.key}>{p.key}：{p.status}</li>)}</ul>
      <p className="field-note">{preview.summary.missing.length ? '依赖预检未完成：确认后进入原有资源绑定，再重新校验。' : '确认后重新校验并通过原有原子事务导入；重复导入创建新 ID。'}</p>
      <button className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await onImport(preview.data); } finally { setBusy(false); } }}>确认导入工作流</button>
    </div>}
  </section>;
}
