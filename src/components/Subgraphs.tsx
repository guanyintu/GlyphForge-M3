import { mergePacks } from "../storage/packs";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import GraphEditor, { Inspector, NodeLibrary } from "./GraphEditor";
import { operators } from "../core/model";
import type { Op, Resource, RuleNode, SubgraphDefinition, Workflow } from "../core/model";
import { extractSubgraph, keyOf, mergeDefinitions } from "../core/subgraphs";
import { validateGraph } from "../core/script";
import { functionLibrary, saveDefinition } from "../storage/subgraph-library";
import "../p2a.css";

export default function Subgraphs({ workflow, selection, resources, previews, onChange, onClose }: { workflow: Workflow; selection: string[]; resources: Resource[]; previews: Record<string, string[]>; onChange: (w: Workflow) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<SubgraphDefinition>();
  const [selected, setSelected] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [library, setLibrary] = useState(false);
  const [message, setMessage] = useState("");
  const [nested, setNested] = useState("");
  const [target, setTarget] = useState("");
  const [paramName, setParamName] = useState("tag");
  const stored = useLiveQuery(() => functionLibrary.definitions.toArray(), []) ?? [];
  const defs = workflow.subgraphs ?? [];
  const node = draft?.nodes.find(n => n.id === selected);
  function guard(action: () => void) { try { action(); setMessage(""); } catch (e) { setMessage(String(e)); } }
  function edit(d: SubgraphDefinition) { setDraft(structuredClone(d)); setSelected(d.nodes[0]?.id ?? ""); setIds([]); setMessage(""); }
  function update(n: RuleNode) { setDraft(d => d && ({ ...d, nodes: d.nodes.map(x => x.id === n.id ? n : x) })); }
  function add(op: Op) {
    if (!draft) return;
    const id = `n_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    setDraft({ ...draft, nodes: [...draft.nodes, { id, op, params: { ...operators[op].defaults }, inputs: Array.from({ length: operators[op].inputs }, () => selected) }], output: draft.output || id }); setSelected(id);
  }
  async function save() {
    if (!draft) return;
    try {
      const original = defs.find(d => keyOf(d) === keyOf(draft));
      const bodyChanged = original && JSON.stringify({ ...original, name: draft.name }) !== JSON.stringify(draft);
      const next = { ...draft, version: bodyChanged ? Math.max(...defs.filter(d => d.id === draft.id).map(d => d.version), ...stored.filter(item => item.definition.id === draft.id).map(item => item.definition.version)) + 1 : draft.version };
      const subgraphs = bodyChanged ? [...defs, next] : [...defs.filter(d => keyOf(d) !== keyOf(next)), next];
      const nodes = workflow.nodes.map(n => n.call?.definitionId === draft.id && n.call.version === draft.version ? { ...n, call: { ...n.call, version: next.version } } : n);
      const w = { ...workflow, nodes, subgraphs };
      validateGraph(w);
      await saveDefinition(next, subgraphs, workflow.extensions);
      onChange(w); setDraft(undefined); setMessage(`子图已保存 · v${next.version}，当前工作流调用已同步`);
    } catch (e) { setMessage(String(e)); }
  }
  function insert(d: SubgraphDefinition, dependencies = defs, extensions = workflow.extensions) {
    const merged = mergeDefinitions(defs, dependencies);
    const id = `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const n = merged.rewrite({ id, op: "call", params: {}, inputs: d.parameters.filter(p => p.type === "CandidateSequence").map(() => ""), call: { definitionId: d.id, version: d.version, bindings: Object.fromEntries(d.parameters.filter(p => p.default !== undefined).map(p => [p.name, p.default!])) } });
    onChange({ ...workflow, extensions:mergePacks([workflow.extensions??[],extensions??[]]), subgraphs: merged.definitions, nodes: [...workflow.nodes, n], layout: { ...workflow.layout, [id]: { x: 400, y: 350 } } }); setMessage("调用已添加，请在主图连接输入/输出并配置参数");
  }
  const graph: Workflow | undefined = draft && { ...workflow, id: draft.id, nodes: draft.nodes, layout: draft.layout };
  return <div className="subgraph-overlay" role="dialog" aria-label="子图与可复用函数">
    <header><button className="button" onClick={() => draft ? setDraft(undefined) : onClose()}>← {draft ? "子图库" : "返回主图"}</button><strong>工作流 / 子图与函数{draft ? ` / ${draft.name}` : ""}</strong><button className="button" onClick={onClose}>关闭</button></header>
    {message ? <p role="status" className="subgraph-message">{message}</p> : null}
    {!draft ? <div className="subgraph-list">
      <h2>把连线变成可复用的命名函数</h2><p>显式参数 · 单一序列返回 · 固定版本 · 共享运行预算</p>
      <button className="button" onClick={() => guard(() => { const result = extractSubgraph(workflow, selection); onChange(result.workflow); edit(result.definition); })}>封装所选节点（{selection.length}）</button>{" "}
      <button className="button" onClick={() => edit({ id: crypto.randomUUID(), version: 1, name: "新建子图", parameters: [], returns: "CandidateSequence", nodes: [], output: "", layout: {} })}>新建空子图</button>
      <h3>此工作流</h3>
      {defs.map(d => <article key={keyOf(d)}><b>{d.name} · v{d.version}</b><small>{d.parameters.map(p => `${p.name}: ${p.type}`).join(" / ") || "无参数"} → CandidateSequence</small><button className="button" onClick={() => edit(d)}>编辑接口与内部节点</button><button className="button" onClick={() => insert(d)}>添加调用</button><button className="button" onClick={() => edit({ ...structuredClone(d), id: crypto.randomUUID(), version: 1, name: `${d.name} 副本` })}>复制定义</button></article>)}
      <h3>跨工作流子图库</h3>{stored.map(item => <article key={item.key}><b>{item.definition.name} · v{item.definition.version}</b><button className="button" onClick={() => insert(item.definition, item.dependencies, item.extensions)}>复用此函数</button></article>)}
    </div> : <>
      <section className="subgraph-interface">
        <label>子图名称<input aria-label="子图名称" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
        <label>返回节点<select aria-label="子图返回节点" value={draft.output} onChange={e => setDraft({ ...draft, output: e.target.value })}><option value="">请选择</option>{draft.nodes.map(n => <option key={n.id}>{n.id}</option>)}</select></label>
        <button className="button" onClick={() => setLibrary(true)}>添加内部节点</button><button className="button" onClick={save}>保存子图并返回</button>
        {library ? <NodeLibrary onAdd={add} onClose={() => setLibrary(false)} /> : null}
        <div className="subgraph-parameters">{draft.parameters.map((p, i) => <label key={i}>参数名称<input aria-label={`参数名称 ${i + 1}`} value={p.name} onChange={e => { const old = p.name, name = e.target.value; setDraft({ ...draft, parameters: draft.parameters.map((x, j) => i === j ? { ...x, name } : x), nodes: draft.nodes.map(n => ({ ...n, params: n.op === "argument" && n.params.name === old ? { ...n.params, name } : n.params, parameterBindings: n.parameterBindings && Object.fromEntries(Object.entries(n.parameterBindings).map(([k, v]) => [k, v === old ? name : v])) })) }); }} /><small>{p.type}</small>{p.type !== "CandidateSequence" ? <><input aria-label={`默认值 ${p.name}`} value={String(p.default ?? "")} onChange={e => { let value: string | number | boolean = e.target.value; if (p.type === "number") value = Number(value); if (p.type === "boolean") value = value === "true"; setDraft({ ...draft, parameters: draft.parameters.map((x, j) => i === j ? { ...x, default: value } : x) }); }} /><label><input type="checkbox" checked={p.default === undefined} onChange={e => setDraft({ ...draft, parameters: draft.parameters.map((x, j) => i !== j ? x : e.target.checked ? { name: x.name, type: x.type } : { ...x, default: x.type === "string" ? "" : x.type === "number" ? 0 : false }) })} />必填</label></> : null}</label>)}</div>
        {node && !["call", "argument", "program", "extension"].includes(node.op) ? <div className="subgraph-expose"><select aria-label="暴露节点参数" value={target} onChange={e => setTarget(e.target.value)}><option value="">选择标量参数</option>{Object.keys(operators[node.op].defaults).filter(k => !["resourceId", "slots"].includes(k)).map(k => <option key={k}>{k}</option>)}</select><input aria-label="新增参数名称" value={paramName} onChange={e => setParamName(e.target.value)} /><button className="button" disabled={!target} onClick={() => { const value = node.params[target]; setDraft({ ...draft, parameters: [...draft.parameters, { name: paramName, type: typeof value as "string" | "number" | "boolean", default: value }], nodes: draft.nodes.map(n => n.id === node.id ? { ...n, parameterBindings: { ...n.parameterBindings, [target]: paramName } } : n) }); }}>暴露为输入参数</button></div> : null}
        <button className="button" onClick={() => { const name = `input${draft.parameters.length + 1}`, id = `arg_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`; setDraft({ ...draft, parameters: [...draft.parameters, { name, type: "CandidateSequence" }], nodes: [...draft.nodes, { id, op: "argument", inputs: [], params: { name } }] }); }}>添加序列输入</button>
        <select aria-label="内部调用定义" value={nested} onChange={e => setNested(e.target.value)}><option value="">选择嵌套子图</option>{defs.filter(d => d.id !== draft.id).map(d => <option key={keyOf(d)} value={keyOf(d)}>{d.name} v{d.version}</option>)}</select><button className="button" disabled={!nested} onClick={() => { const d = defs.find(d => keyOf(d) === nested)!; const id = `nested_${Date.now().toString(36)}`; setDraft({ ...draft, nodes: [...draft.nodes, { id, op: "call", params: {}, inputs: d.parameters.filter(p => p.type === "CandidateSequence").map(() => selected), call: { definitionId: d.id, version: d.version, bindings: Object.fromEntries(d.parameters.filter(p => p.default !== undefined).map(p => [p.name, p.default!])) } }] }); setSelected(id); }}>添加内部子图调用</button>
        <p>选择节点后可暴露标量参数。外部连线自动成为必填序列参数。保存内部修改生成新版本，其他工作流继续使用原版本。</p>
      </section>
      <div className="subgraph-editor"><GraphEditor workflow={graph!} resources={resources} previews={previews} selection={ids} onSelection={setIds} onDragStart={() => {}} onSelect={setSelected} onChange={w => setDraft({ ...draft, nodes: w.nodes, layout: w.layout })} /><Inspector workflow={graph} onWorkflowChange={w=>{onChange({...workflow,extensions:w.extensions});setDraft({...draft,nodes:w.nodes,layout:w.layout});}} node={node} resources={resources} onUpdate={update} onDelete={() => setDraft({ ...draft, nodes: draft.nodes.filter(n => n.id !== selected) })} /></div>
    </>}
  </div>;
}
