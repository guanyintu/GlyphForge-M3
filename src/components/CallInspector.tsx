import { definitionFor } from "../core/subgraphs";
import type { Params, RuleNode, SubgraphDefinition, Workflow } from "../core/model";

export function CallInspector({ node, workflow, onUpdate }: {
  node: RuleNode;
  workflow: Workflow;
  onUpdate: (n: RuleNode) => void;
}) {
  let definition: SubgraphDefinition;
  try { definition = definitionFor(node, workflow.subgraphs); }
  catch (error) { return <p role="alert">{String(error)}</p>; }

  function bind(name: string, value: Params[string]) {
    onUpdate({ ...node, call: { ...node.call!, bindings: { ...node.call!.bindings, [name]: value } } });
  }

  return <div>
    <p>{definition.name} · v{definition.version} → CandidateSequence</p>
    {definition.parameters.filter(p => p.type === "CandidateSequence").map((p, index) =>
      <label className="field-label" key={p.name}>
        {p.name}
        <select aria-label={`调用序列 ${p.name}`} value={node.inputs[index] ?? ""} onChange={event => {
          const inputs = [...node.inputs];
          inputs[index] = event.target.value;
          onUpdate({ ...node, inputs });
        }}>
          <option value="">请选择序列输入</option>
          {workflow.nodes.filter(n => n.id !== node.id && n.op !== "output").map(n => <option key={n.id}>{n.id}</option>)}
        </select>
      </label>,
    )}
    {definition.parameters.filter(p => p.type !== "CandidateSequence").map(p => {
      const value = String(node.call?.bindings[p.name] ?? p.default ?? "");
      return <label className="field-label" key={p.name}>
        {p.name} ({p.type})
        {p.type === "boolean" ?
          <select aria-label={`调用参数 ${p.name}`} value={value} onChange={e => bind(p.name, e.target.value === "true")}>
            <option value="">请选择</option><option value="true">true</option><option value="false">false</option>
          </select> :
          <input aria-label={`调用参数 ${p.name}`} type={p.type === "number" ? "number" : "text"} value={value}
            onChange={e => bind(p.name, p.type === "number" ? e.target.valueAsNumber : e.target.value)} />}
      </label>;
    })}
    <p className="field-note">序列参数通过左侧端口连接；在「子图与函数」中编辑内部节点。</p>
  </div>;
}
