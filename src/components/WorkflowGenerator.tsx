import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Play, Square, WandSparkles } from "lucide-react";
import type { Resource, Workflow } from "../core/model";
import { db } from "../storage/db";
import "../generator.css";

/** A use view of the selected workflow. Execution and persistence stay in App. */
export default function WorkflowGenerator({ workflow, workflows, resources, running, hasDraft, presets = [], onSelect, onChange, onGenerate, onStop, onEdit, onPresets, onImport, onExport }: {
  workflow: Workflow; workflows: Workflow[]; resources: Resource[]; running: boolean; hasDraft: boolean;
  presets?: { id: string; label: string; onSelect: () => void | Promise<void> }[];
  onSelect: (workflow: Workflow) => void; onChange: (workflow: Workflow) => void;
  onGenerate: (workflow: Workflow) => void; onStop: () => void; onEdit: () => void;
  onPresets: () => void; onImport: () => void; onExport: () => void;
}) {
  const [fixedSeed, setFixedSeed] = useState(false);
  const selection = workflow.nodes.find(node => node.op === "curate");
  const reference = String(selection?.params.reviewedResourceId || "");
  const version = resources.find(r => r.id === reference)?.version;
  const categories = useLiveQuery(async () => {
    if (!reference) return [];
    const rows = await db.relations.where({ resourceId: reference }).limit(10000).toArray();
    return [...new Set(rows.flatMap(row => row.tags || []).filter(tag => tag.startsWith("风格:")).map(tag => tag.slice(3)))].sort();
  }, [reference, version]) || [];
  const setting = (key: string, value: string) => {
    if (selection) onChange({ ...workflow, nodes: workflow.nodes.map(node => node === selection ? { ...node, params: { ...node.params, [key]: value, offset: 0 } } : node) });
  };
  const choices = workflows.some(w => w.id === workflow.id) ? workflows : [...workflows, workflow];
  return <section className="generator-controls" aria-label="ID 生成">
    <div className="generator-topline"><span className="eyebrow">一点灵感，一个好名字</span><button className="text-button generator-edit" onClick={onEdit}><Pencil size={14} />编辑</button></div>
    <h1>{workflow.name}</h1>
    <p className="generator-description">选一个喜欢的工作流，看看这次会遇见什么名字。</p>
    <div className="generator-picker">
      <label>选择工作流<select aria-label="选择工作流" value={workflow.id} disabled={running || hasDraft} onChange={e => { const next = choices.find(w => w.id === e.target.value); if (next) onSelect(next); else void presets.find(p => p.id === e.target.value)?.onSelect(); }}>{choices.map(w => <option key={w.id} value={w.id}>{w.id === workflow.id ? workflow.name : w.name}</option>)}{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
      <button className="button" onClick={onPresets}><WandSparkles size={15} />浏览配方</button>
    </div>
    <div className="generator-run-row">
      {selection ? <div className="generator-length" role="group" aria-label="名字字数">{[["2,3", "全部"], ["2", "两字"], ["3", "三字"]].map(([value, label]) => <button key={value} aria-pressed={selection.params.lengths === value} onClick={() => setting("lengths", value)}>{label}</button>)}</div> : <span className="generator-ready">已选择工作流，可以开始生成</span>}
      {categories.length ? <select aria-label="风格分类" value={String(selection?.params.category || "")} onChange={e => setting("category", e.target.value)}><option value="">全部风格</option>{categories.map(category => <option key={category}>{category}</option>)}</select> : null}
      <button className="primary-button generator-run" disabled={!workflow.nodes.length} onClick={() => running ? onStop() : onGenerate(fixedSeed ? workflow : { ...workflow, seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647 })}>{running ? <Square size={15} /> : <Play size={16} fill="currentColor" />}{running ? "停止生成" : "生成 ID"}</button>
    </div>
    {hasDraft ? <p className="field-note" role="status">编辑草稿已保留；生成使用已应用的版本。返回编辑可继续修改。</p> : null}
    <details className="generator-options"><summary>生成设置</summary><div className="generator-options-fields">
      <label>结果数量<input aria-label="结果数量" type="number" min={1} max={10000} value={workflow.limit} onChange={e => onChange({ ...workflow, limit: Math.max(1, Math.min(10000, Number(e.target.value) || 1)) })} /></label>
      {selection ? <><label>包含文字<input aria-label="包含文字" value={String(selection.params.includes || "")} onChange={e => setting("includes", e.target.value)} placeholder="例如：猫" /></label><label>排除文字<input aria-label="排除文字" value={String(selection.params.excludes || "")} onChange={e => setting("excludes", e.target.value)} placeholder="多个词用逗号分隔" /></label></> : null}
      <label className="generator-seed-toggle"><input aria-label="固定种子" type="checkbox" checked={fixedSeed} onChange={e => setFixedSeed(e.target.checked)} />固定种子</label>
      {fixedSeed ? <label>种子<input aria-label="生成种子" type="number" value={workflow.seed} onChange={e => onChange({ ...workflow, seed: Math.max(0, Math.min(2147483647, Math.trunc(Number(e.target.value) || 0))) })} /></label> : null}
    </div><div className="generator-files"><button className="text-button" onClick={onImport}><ArrowUpFromLine size={14} />导入</button><button className="text-button" onClick={onExport}><ArrowDownToLine size={14} />导出工作流</button></div></details>
  </section>;
}
