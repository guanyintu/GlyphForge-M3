import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { X } from "lucide-react";
import type { RelationKind, RelationRow, Resource } from "../core/model";
import { relationLabels } from "../core/relations";
import { db, deleteRelationRow, deleteResource, saveRelationRows } from "../storage/db";
import { downloadBlob } from "../core/sharing";
import { RelationSelect } from "./RelationParams";

export function RelationEditor({ resource, onClose, notify }: { resource: Resource; onClose: () => void; notify: (s: string) => void }) {
  const [name, setName] = useState(resource.name), [left, setLeft] = useState(""), [right, setRight] = useState("");
  const [relation, setRelation] = useState<RelationKind>("associated"), [editing, setEditing] = useState<number>();
  const [paste, setPaste] = useState(""), [page, setPage] = useState(0), [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false), [confirmDelete, setConfirmDelete] = useState(false);
  const task = useRef<Worker | null>(null);
  const meta = useLiveQuery(() => db.resources.get(resource.id), [resource.id]);
  const rows = useLiveQuery(() => db.relations.where({ resourceId: resource.id }).offset(page * 60).limit(60).toArray(), [resource.id, page]) || [];
  useEffect(() => () => task.current?.terminate(), []);
  const pages = Math.max(1, Math.ceil((meta?.count || 0) / 60));
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [page, pages]);
  async function action(run: () => Promise<unknown>) {
    setBusy(true);
    try { await run(); } catch (e) { notify(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  function reset() { setLeft(""); setRight(""); setEditing(undefined); }
  function runTask(message: object) {
    setBusy(true);
    const worker = new Worker(new URL("../workers/resources.worker.ts", import.meta.url), { type: "module" });
    task.current = worker;
    const finish = () => { worker.terminate(); task.current = null; setBusy(false); };
    worker.onmessage = event => {
      if (event.data.type === "exported") downloadBlob(event.data.name, event.data.blob);
      else if (event.data.type === "done") { setPaste(""); notify(`已读取 ${event.data.processed} 行，重复关系已合并`); }
      else notify(event.data.message);
      finish();
    };
    worker.onerror = () => { notify("关系文件处理失败"); finish(); };
    worker.postMessage({ ...message, resourceId: resource.id });
  }
  function edit(row: RelationRow) { setEditing(row.id); setLeft(row.left); setRight(row.right); setRelation(row.relation); }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="modal relation-editor" role="dialog" aria-modal="true" aria-label="编辑关系词库">
      <div className="modal-heading"><div><span className="eyebrow">WORDS THAT BELONG TOGETHER</span><h2>让文字成对呼应</h2></div><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20} /></button></div>
      <div className="modal-body">
        <label className="field-label">关系词库名称<input value={name} maxLength={60} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim()) void db.resources.update(resource.id, { name: name.trim(), updatedAt: Date.now() }).catch(() => notify("词库名称保存失败")); }} /></label>
        <p className="field-note">{meta?.count || 0} 行 · v{meta?.version || resource.version} · 每行保留左右对应关系，普通关联不会视为反义词。</p>
        <fieldset disabled={busy} className="relation-form"><legend>{editing === undefined ? "添加关系" : "修改关系"}</legend>
          <label className="field-label">左词 A<input maxLength={256} value={left} onChange={e => setLeft(e.target.value)} /></label>
          <span className="pair-link" aria-hidden="true">↔</span>
          <label className="field-label">右词 B<input maxLength={256} value={right} onChange={e => setRight(e.target.value)} /></label>
          <label className="field-label">关系类型<RelationSelect value={relation} onChange={v => setRelation(v as RelationKind)} /></label>
          <button className="primary-button" disabled={!left.trim() || !right.trim()} onClick={() => void action(async () => { await saveRelationRows(resource.id, [{ left, right, relation }], editing); reset(); })}>{editing === undefined ? "添加词对" : "保存修改"}</button>
          {editing !== undefined ? <button className="text-button" onClick={reset}>取消修改</button> : null}
        </fieldset>
        <label className="field-label">批量粘贴 TSV（左词、右词、可选类型，用 Tab 分列）<textarea rows={3} value={paste} maxLength={2 * 1024 * 1024} placeholder={"月亮\t星星\tcouple\n冷\t热\tantonym"} onChange={e => setPaste(e.target.value)} /></label>
        <p className="field-note">类型：associated 关联 / antonym 反义 / couple 情侣 / parallel 对仗关联；省略时使用上方选定类型。文件支持带引号的 CSV、TSV、JSON，最多 2 MB / 10,000 行，整批校验后事务写入。</p>
        <div className="row relation-actions">
          <button className="button" disabled={busy || !paste.trim()} onClick={() => runTask({ type: "relationImport", text: paste, name: "pasted.tsv", relation })}>批量添加</button>
          <label className="button">导入关系文件<input type="file" accept=".csv,.tsv,.json" disabled={busy} onChange={async e => {
            const file = e.target.files?.[0]; e.target.value = "";
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { notify("关系文件最大 2 MB"); return; }
            try { const text = await file.text(); if (!task.current) runTask({ type: "relationImport", text, name: file.name, relation }); } catch { notify("无法读取文件"); }
          }} /></label>
          {(["json", "csv"] as const).map(format => <button className="button" key={format} disabled={busy} onClick={() => runTask({ type: "relationExport", format })}>导出 {format.toUpperCase()}</button>)}
          {task.current ? <button className="text-button" onClick={() => { task.current?.terminate(); task.current = null; setBusy(false); notify("后台任务已停止；事务提交前取消不会写入，已提交的整批保留"); }}>停止任务</button> : null}
        </div>
        {busy ? <p role="status">正在处理关系词库…</p> : null}
        <label className="field-label">当前页关系筛选<RelationSelect all value={filter} onChange={setFilter} /></label>
        <div className="relation-rows">{rows.filter(row => !filter || row.relation === filter).map(row => <div className="relation-row" key={row.id}>
          <b>{row.left}</b><span className="relation-badge">{relationLabels[row.relation]}</span><b>{row.right}</b>
          <div><button className="text-button" disabled={busy} onClick={() => edit(row)}>修改</button><button className="text-button" disabled={busy} onClick={() => void action(async () => { await deleteRelationRow(resource.id, row.id!); if (editing === row.id) reset(); })}>删除</button></div>
        </div>)}</div>
        <div className="row relation-actions"><button className="button" disabled={!page} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page + 1} / {pages} 页，每页最多 60 行</span><button className="button" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>下一页</button></div>
        <button className="text-button" disabled={busy} onClick={() => { if (!confirmDelete) { setConfirmDelete(true); return; } void action(async () => { await deleteResource(resource.id); onClose(); }); }}>{confirmDelete ? "再次点击确认删除词库和全部关系" : "删除关系词库"}</button>
      </div>
    </section>
  </div>;
}
