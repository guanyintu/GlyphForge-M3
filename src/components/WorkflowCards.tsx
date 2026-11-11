import { useState } from "react";
import { Check, Loader2, Search, WandSparkles } from "lucide-react";
import type { Workflow } from "../core/model";
import { workflowCardInfo } from "../core/corpus-presets";

export interface WorkflowPresetCard {
  id: string; label: string; description: string; sample: string; length: string; tone: string; order: number;
  onSelect: () => void | Promise<void>;
}
export default function WorkflowCards({ workflow, workflows, presets, disabled, onSelect, onPresets, onOpeningChange }: {
  workflow: Workflow; workflows: Workflow[]; presets: WorkflowPresetCard[]; disabled: boolean;
  onSelect: (workflow: Workflow) => void; onPresets: () => void;
  onOpeningChange: (opening: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string>();
  const [error, setError] = useState("");
  const saved = workflows.some(w => w.id === workflow.id) ? workflows : [...workflows, workflow];
  const cards = [
    ...saved.map(item => {
      const w = item.id === workflow.id ? workflow : item;
      return { id: w.id, ...workflowCardInfo(w), label: w.name, active: w.id === workflow.id, onSelect: () => onSelect(w) };
    }),
    ...presets.map(p => ({ ...p, category: p.order < 6 ? "FF14 风格" : "海都工作流", active: false })),
  ].sort((a,b) => a.order - b.order);
  const filtered = cards.filter(card => !query.trim() || `${card.label} ${card.category} ${card.description}`.toLowerCase().includes(query.trim().toLowerCase()));
  async function pick(card: typeof cards[number]) {
    if (disabled || opening || card.active) return;
    setError(""); setOpening(card.id); onOpeningChange(true);
    try { await card.onSelect(); }
    catch (e) { setError(e instanceof Error ? e.message : "工作流打开失败，请重试"); }
    finally { setOpening(undefined); onOpeningChange(false); }
  }
  return <fieldset className="workflow-picker" aria-label="选择工作流" disabled={disabled || Boolean(opening)}>
    <legend className="sr-only">选择工作流</legend>
    <div className="workflow-picker-heading"><div><h2>选择工作流</h2><p>点击卡片选取，再生成你喜欢的名字。</p></div><button className="text-button" type="button" onClick={onPresets}><WandSparkles size={14}/>浏览配方</button></div>
    {cards.length > 12 || query.length ? <label className="workflow-card-search"><Search size={15}/><input aria-label="搜索工作流" placeholder="搜索工作流或风格" value={query} onChange={e=>setQuery(e.target.value)}/></label> : null}
    <div className="workflow-card-grid" aria-busy={Boolean(opening)}>
      {filtered.map(card => <button key={card.id} type="button" className={`workflow-card tone-${card.tone}`} aria-label={`选择工作流：${card.label}`} aria-pressed={card.active} onClick={()=>void pick(card)}>
        <span className="workflow-card-top"><span>{card.category}</span><span className="workflow-card-state">{opening===card.id?<Loader2 size={13} className="spin"/>:card.active?<><Check size={13}/>已选</>:card.length}</span></span>
        <strong>{card.label}</strong><span className="workflow-card-description">{card.description}</span><span className="workflow-card-sample">{card.sample}</span>
      </button>)}
    </div>
    {!filtered.length?<p className="field-note">没有匹配的工作流，试试其他关键词。</p>:null}
    <div className="workflow-picker-foot"><span>{cards.length} 个工作流 · 可滚动浏览</span><span role="status">{opening?"正在打开工作流…":"已选工作流会保留你的编辑与生成设置"}</span></div>
    {error?<p role="alert">{error}</p>:null}
  </fieldset>;
}
