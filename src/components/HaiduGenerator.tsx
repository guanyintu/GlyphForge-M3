import type { ReactNode } from "react";
import type { Params, Resource, Workflow } from "../core/model";
import { curationDefaults } from "../core/curation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import { dependencyIds } from "../core/sharing";

export function HaiduGenerator({ workflow, resources, running, onChange, onRun, onStop, onEdit, children }: {
  resources: Resource[];
  workflow: Workflow; running: boolean; onChange: (w: Workflow) => void;
  onRun: (w: Workflow) => void; onStop: () => void; onEdit: () => void; children: ReactNode;
}) {
  const selection = workflow.nodes.find(n => n.op === "curate");
  const ids = new Set(dependencyIds(workflow));
  const relations = resources.filter(r => r.kind === "relation" && ids.has(r.id));
  const categories = useLiveQuery(async () => {
    const tags = new Set<string>();
    for (const r of relations) for (const row of await db.relations.where("resourceId").equals(r.id).limit(10000).toArray()) {
      for (const tag of row.tags || []) if (tag.startsWith("风格:")) tags.add(tag.slice(3));
    }
    return [...tags].sort();
  }, [relations.map(r => `${r.id}:${r.version}`).join(",")]) || [];
  const p = { ...curationDefaults, ...selection?.params };
  const recipes = String(p.recipes).split(",");
  function update(values: Params) {
    onChange({ ...workflow, nodes: workflow.nodes.map(n => n.id === selection?.id ? { ...n, params: { ...p, ...values, offset: 0 } } : n) });
  }
  function draw(continuing = false) {
    const next = { ...workflow, nodes: workflow.nodes.map(n => n.id === selection?.id ? { ...n, params: { ...p, offset: continuing ? Number(p.offset) + workflow.limit : 0 } } : n) };
    onChange(next); onRun(next);
  }
  return <div className="haidu-page">
    <header className="haidu-heading"><div><p className="eyebrow">GLYPHFORGE / LIMSA AFTER HOURS</p><h1>海都潮人 ID<span>.</span></h1><p>有点怪，也刚好是你。给下一次海都散步挑个名字。</p></div><button className="button" onClick={onEdit}>编辑</button></header>
    <section className="haidu-controls" aria-label="生成设置">
      <div className="haidu-length" role="group" aria-label="字数">{[["2,3", "全部"], ["2", "两字"], ["3", "三字"]].map(([value, label]) => <button key={value} aria-pressed={p.lengths === value} disabled={!selection || running} onClick={() => update({ lengths: value })}>{label}</button>)}</div>
      <label className="haidu-style">风格<select aria-label="风格分类" value={String(p.category)} disabled={!selection || running} onChange={e => update({ category: e.target.value })}><option value="">混合灵感</option>{categories.map(c => <option key={c}>{c}</option>)}{p.category && !categories.includes(String(p.category)) ? <option>{String(p.category)}</option> : null}</select></label>
      <button className="primary-button haidu-generate" onClick={() => running ? onStop() : draw()}>{running ? "停止生成" : "生成 ID"}<span aria-hidden="true">↗</span></button>
    </section>
    {children}
    <div className="haidu-bottom"><button className="button" disabled={running || Number(p.offset) + workflow.limit > 10000} onClick={() => draw(true)}>继续抽取</button><button className="text-button" disabled={running} onClick={() => { const next = { ...workflow, seed: (workflow.seed + 1) >>> 0, nodes: workflow.nodes.map(n => n.id === selection?.id ? { ...n, params: { ...p, offset: 0 } } : n) }; onChange(next); onRun(next); }}>换一批灵感</button><span>点击名字复制 · ☆ 留下喜欢的</span></div>
    <details className="haidu-advanced"><summary>高级选项</summary><div className="haidu-settings">
      <label>每批数量<input aria-label="每批数量" type="number" min={1} max={200} value={workflow.limit} disabled={running} onChange={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 1 && v <= 200) onChange({ ...workflow, limit: v, nodes: workflow.nodes.map(n => n.id === selection?.id ? { ...n, params: { ...p, offset: 0 } } : n) }); }} /></label>
      <label>固定种子<input aria-label="固定种子" type="number" min={0} max={4294967295} value={workflow.seed} disabled={running} onChange={e => { const v = Number(e.target.value); if (Number.isInteger(v) && v >= 0 && v <= 4294967295) onChange({ ...workflow, seed: v, nodes: workflow.nodes.map(n => n.id === selection?.id ? { ...n, params: { ...p, offset: 0 } } : n) }); }} /></label>
      <label>包含字符<input aria-label="包含指定字符" value={String(p.includes)} maxLength={256} disabled={!selection || running} onChange={e => update({ includes: e.target.value })} /></label>
      <label>排除词条<input aria-label="排除指定词条" placeholder="用逗号分隔" value={String(p.excludes)} maxLength={256} disabled={!selection || running} onChange={e => update({ excludes: e.target.value })} /></label>
    </div><fieldset disabled={!selection || running}><legend>生成配方</legend>{[["direct", "双字直出"], ["suffix", "核心 + 尾缀"], ["prefix", "前缀 + 核心"], ["semantic", "语义关联"], ["contrast", "受控反差"], ["double", "四字搭配（实验）"], ["echo", "重复镜像（实验）"]].map(([id, label]) => <label key={id}><input type="checkbox" checked={recipes.includes(id)} onChange={e => { const next = e.target.checked ? [...recipes, id] : recipes.filter(r => r !== id); update({ recipes: next.join(",") || "none", lengths: e.target.checked && ["double", "echo"].includes(id) ? "2,3,4" : p.lengths }); }} />{label}</label>)}</fieldset><p>四字配方需包含字数 4。固定种子、资源版本和设置相同时可复现；继续抽取沿用同一排序。词库或条件变化后从首批重抽。</p></details>
    {!selection ? <p role="status">此工作流沿用原始配方。点击编辑可修改流程；筛选设置需加入「精选与多样性」节点。</p> : null}
  </div>;
}
