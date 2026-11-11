import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Play, Square } from "lucide-react";
import type { Resource, Workflow } from "../core/model";
import { db } from "../storage/db";
import "../generator.css";
import "../corpus.css";
import { corpusModes } from "../core/corpus";
import WorkflowCards from "./WorkflowCards";
import type { WorkflowPresetCard } from "./WorkflowCards";

/** A use view of the selected workflow. Execution and persistence stay in App. */
export default function WorkflowGenerator({ workflow, workflows, resources, running, hasDraft, presets = [], onSelect, onChange, onGenerate, onStop, onEdit, onPresets, onImport, onExport }: {
  workflow: Workflow; workflows: Workflow[]; resources: Resource[]; running: boolean; hasDraft: boolean;
  presets?: WorkflowPresetCard[];
  onSelect: (workflow: Workflow) => void; onChange: (workflow: Workflow) => void;
  onGenerate: (workflow: Workflow) => void; onStop: () => void; onEdit: () => void;
  onPresets: () => void; onImport: () => void; onExport: () => void;
}) {
  const [fixedSeed, setFixedSeed] = useState(false);
  const [openingWorkflow, setOpeningWorkflow] = useState(false);
  const selection = workflow.nodes.find(node => node.op === "curate");
  const corpus = workflow.nodes.find(node => node.op === "corpus");
  const corpusSetting = (key: string, value: string | number) => {
    if (corpus) onChange({ ...workflow, nodes: workflow.nodes.map(node => node === corpus ? { ...node, params: { ...node.params, [key]: value } } : node) });
  };
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
  return <section className="generator-controls" aria-label="ID 生成">
    <div className="generator-topline"><span className="eyebrow">一点灵感，一个好名字</span><button className="text-button generator-edit" disabled={openingWorkflow} onClick={onEdit}><Pencil size={14} />编辑</button></div>
    <h1>{workflow.name}</h1>
    <p className="generator-description">选一个喜欢的工作流，看看这次会遇见什么名字。</p>
    <WorkflowCards workflow={workflow} workflows={workflows} presets={presets} disabled={running || hasDraft} onSelect={onSelect} onPresets={onPresets} onOpeningChange={setOpeningWorkflow}/>
    <div className="generator-run-row">
      {corpus ? <div className="corpus-generate"><label>最短<input aria-label="生成最短长度" type="number" min={1} max={32} value={Number(corpus.params.minLength)} onChange={e=>corpusSetting("minLength",Number(e.target.value))}/></label><label>最长<input aria-label="生成最长长度" type="number" min={1} max={32} value={Number(corpus.params.maxLength)} onChange={e=>corpusSetting("maxLength",Number(e.target.value))}/></label></div> : null}
      {selection ? <div className="generator-length" role="group" aria-label="名字字数">{[["2,3", "全部"], ["2", "两字"], ["3", "三字"]].map(([value, label]) => <button key={value} aria-pressed={selection.params.lengths === value} onClick={() => setting("lengths", value)}>{label}</button>)}</div> : corpus ? null : <span className="generator-ready">已选择工作流，可以开始生成</span>}
      {categories.length ? <select aria-label="风格分类" value={String(selection?.params.category || "")} onChange={e => setting("category", e.target.value)}><option value="">全部风格</option>{categories.map(category => <option key={category}>{category}</option>)}</select> : null}
      <button className="primary-button generator-run" disabled={!workflow.nodes.length || openingWorkflow} onClick={() => running ? onStop() : onGenerate(fixedSeed ? workflow : { ...workflow, seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647 })}>{running ? <Square size={15} /> : <Play size={16} fill="currentColor" />}{openingWorkflow ? "正在打开…" : running ? "停止生成" : "生成 ID"}</button>
    </div>
    {hasDraft ? <p className="field-note" role="status">编辑草稿已保留；生成使用已应用的版本。返回编辑可继续修改。</p> : null}
    <details className="generator-options"><summary>生成设置</summary><div className="generator-options-fields">
      {corpus ? <label>生成偏好<select aria-label="语料生成模式" value={String(corpus.params.mode)} onChange={e=>corpusSetting("mode",e.target.value)}>{Object.entries(corpusModes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label> : null}
      <label>结果数量<input aria-label="结果数量" type="number" min={1} max={corpus ? 1000 : 10000} value={workflow.limit} onChange={e => { const limit = Math.max(1, Math.min(corpus ? 1000 : 10000, Number(e.target.value) || 1)); onChange({ ...workflow, limit, nodes: workflow.nodes.map(n => n === corpus ? { ...n, params: { ...n.params, count: limit } } : n) }); }} /></label>
      {selection ? <><label>包含文字<input aria-label="包含文字" value={String(selection.params.includes || "")} onChange={e => setting("includes", e.target.value)} placeholder="例如：猫" /></label><label>排除文字<input aria-label="排除文字" value={String(selection.params.excludes || "")} onChange={e => setting("excludes", e.target.value)} placeholder="多个词用逗号分隔" /></label></> : null}
      <label className="generator-seed-toggle"><input aria-label="固定种子" type="checkbox" checked={fixedSeed} onChange={e => setFixedSeed(e.target.checked)} />固定种子</label>
      {fixedSeed ? <label>种子<input aria-label="生成种子" type="number" value={workflow.seed} onChange={e => onChange({ ...workflow, seed: Math.max(0, Math.min(2147483647, Math.trunc(Number(e.target.value) || 0))) })} /></label> : null}
    </div><div className="generator-files"><button className="text-button" onClick={onImport}><ArrowUpFromLine size={14} />导入</button><button className="text-button" onClick={onExport}><ArrowDownToLine size={14} />导出工作流</button></div></details>
  </section>;
}
