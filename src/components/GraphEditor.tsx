import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import { packStatus } from "../storage/packs";
import { inputCount, definitionFor } from "../core/subgraphs";
import { ExtensionInspector } from "./Packs";
import { CallInspector } from "./CallInspector";
import { memo, useCallback, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  ViewportPortal,
} from "@xyflow/react";
import type { Connection, Node, NodeProps } from "@xyflow/react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Filter,
  GitMerge,
  Hash,
  Layers,
  Plus,
  Repeat2,
  Sparkles,
  Play,
} from "lucide-react";
import type { Op, Resource, RuleNode, Workflow } from "../core/model";
import { operators } from "../core/model";
import { nodePosition } from "../core/graph-editing";
import { chineseDefinitions, isChineseOp } from "../core/chinese-definitions";
import { ChineseParams } from "./ChineseParams";
import type { LucideIcon } from "lucide-react";
import { RelationParams } from "./RelationParams";

import { GameRuleEditor } from "./GameRuleEditor";
import { parseGameRule, defaultGameRule } from "../core/game-rules";
const icons: Record<Op, LucideIcon> = {
  corpus: Sparkles,
  curate: Filter,
  extension: Sparkles,
  mutate: Sparkles,
  call: Repeat2, argument: BookOpen,
  gamecheck: Filter,
  pairs: GitMerge, template: Sparkles, group: Layers,
  ...Object.fromEntries(Object.keys(chineseDefinitions).map(op => [op, Sparkles])) as Record<keyof typeof chineseDefinitions, LucideIcon>,
  program: Repeat2,
  resource: BookOpen,
  pattern: GitMerge,
  concat: Plus,
  filter: Filter,
  prefix: Hash,
  reverse: Repeat2,
  output: Layers,
};
type ForgeNode = Node<
  { rule: RuleNode; resource?: Resource; words: string[]; inputs: number; label?: string },
  "forge"
>;
const ForgeCard = memo(function ForgeCard({
  data,
  selected,
}: NodeProps<ForgeNode>) {
  const { rule, resource, words } = data;
  const def = operators[rule.op];
  const Icon = icons[rule.op];
  return (
    <div className={`forge-node ${def.color} ${selected ? "is-selected" : ""}`}>
      {Array.from({ length: data.inputs }, (_, i) => (
        <Handle
          key={i}
          type="target"
          id={String(i)}
          position={Position.Left}
          style={{ top: data.inputs > 1 ? 78 + i * 24 : 104 }}
        />
      ))}
      <div className="node-heading">
        <span className="node-symbol">
          <Icon size={15} />
        </span>
        <strong>{data.label || def.name}</strong>
        <span className="node-dots">···</span>
      </div>
      <div className="node-content">
        {isChineseOp(rule.op) ? <><div className="node-field">{String(rule.params.mode || rule.params.structure || "中文文字实验")}</div><p className="node-hint">{def.description}</p></> : null}
        {rule.op === "extension" ? <p className="node-hint">{String(rule.params.pack)}@{String(rule.params.version)}/{String(rule.params.operator)}</p> : null}
        {rule.op === "call" ? <p className="node-hint">固定版本 v{rule.call?.version} · 独立参数绑定</p> : null}
        {rule.op === "argument" ? <b>{String(rule.params.name)}</b> : null}
        {rule.op === "program" ? (
          <>
            <div className="node-field">
              <b>for / if / let / emit</b>
            </div>
            <p className="node-hint">
              {rule.program?.body.length || 0} 个顶层语句 · 支持嵌套
            </p>
            <div className="filter-line">
              <Check size={12} />
              结构化控制流 · 有界执行
            </div>
          </>
        ) : null}
        {rule.op === "resource" || rule.op === "pairs" ? (
          <>
            <div className="node-field">
              {resource?.name || "选择一个词库"}
              <BookOpen size={12} />
            </div>
            <div className="word-chips">
              {words.slice(0, 4).map((w) => (
                <span key={w}>{w}</span>
              ))}
            </div>
            <div className="node-foot">
              <span className="tiny-dot" />
              {resource?.count || 0} 个词条<span>本地资源</span>
            </div>
          </>
        ) : null}
        {rule.op === "template" || rule.op === "group" ? <><div className="node-field">{rule.op === "template" ? "共享槽位 → 名字模板" : `${rule.params.count} 人 × ${rule.params.batches} 批`}</div><p className="node-hint">{def.description}</p></> : null}
        {rule.op === "pattern" ? (
          <>
            <div className="node-field">
              <span className="muted">组合模式</span>
              <b className="mono">{String(rule.params.template)}</b>
            </div>
            <div className="pattern-preview">
              {String(rule.params.template)
                .split("")
                .map((c, i) => (
                  <span className={c === "A" ? "var-a" : "var-b"} key={i}>
                    {c}
                  </span>
                ))}
            </div>
            <p className="node-hint">相同字母，共用一个词条</p>
          </>
        ) : null}
        {rule.op === "filter" ? (
          <>
            <div className="node-field">
              <span className="muted">名字长度</span>
              <b>≤ {String(rule.params.maxLength)} 字</b>
            </div>
            <div className="filter-line">
              <Check size={12} />{" "}
              {rule.params.includes
                ? `包含「${rule.params.includes}」`
                : "保留全部字符类型"}
            </div>
            <div className="filter-line">
              <Check size={12} />{" "}
              {rule.params.excludes
                ? `排除「${rule.params.excludes}」`
                : "自动去除重复结果"}
            </div>
          </>
        ) : null}
        {rule.op === "output" ? (
          <>
            <div className="output-orbit">
              <Sparkles size={20} />
              <span>让灵感发生</span>
            </div>
            <div className="node-foot">
              输出到结果工作台
              <ArrowRight size={13} />
            </div>
          </>
        ) : null}
        {rule.op === "concat" ? (
          <>
            <div className="node-field">
              A +{" "}
              {rule.params.separator ? `「${rule.params.separator}」 + ` : ""}B
            </div>
            <p className="node-hint">遍历两个输入的全部组合</p>
          </>
        ) : null}
        {rule.op === "prefix" ? (
          <>
            <div className="node-field">
              {String(rule.params.text)} + 输入文字
            </div>
            <p className="node-hint">为名字添加专属标记</p>
          </>
        ) : null}
        {rule.op === "reverse" ? (
          <>
            <div className="node-field">星河 → 河星</div>
            <p className="node-hint">按完整字符倒序排列</p>
          </>
        ) : null}
      </div>
      {rule.op !== "output" ? (
        <Handle type="source" position={Position.Right} style={{ top: 104 }} />
      ) : null}
      <span className="node-label">{rule.id}</span>
    </div>
  );
});
const nodeTypes = { forge: ForgeCard };
type GraphProps = {
  workflow: Workflow;
  resources: Resource[];
  previews: Record<string, string[]>;
  selection: string[];
  onSelection: (ids: string[]) => void;
  onDragStart: () => void;
  onSelect: (id: string) => void;
  onChange: (w: Workflow, history?: boolean) => void;
};
export default function GraphEditor(props: GraphProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
function GraphCanvas({
  workflow,
  resources,
  previews,
  selection,
  onSelection,
  onDragStart,
  onSelect,
  onChange,
}: GraphProps) {
  const installedPacks = useLiveQuery(()=>db.extensionPacks.toArray(),[]) ?? [];
  const initialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (initialized) {
      const frame = requestAnimationFrame(() => {
        void fitView({ padding: 0.16, duration: 200 });
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [initialized, workflow.id, fitView]);
  const nodes: ForgeNode[] = useMemo(
    () =>
      workflow.nodes.map((rule) => ({
        id: rule.id,
        type: "forge",
        position: nodePosition(workflow, rule.id),
        selected: selection.includes(rule.id),
        data: {
          rule,
          inputs: (() => { try { return inputCount(rule, workflow.subgraphs); } catch { return rule.inputs.length; } })(),
          label: rule.op === "extension" ? (()=>{const p=workflow.extensions?.find(p=>p.id===rule.params.pack&&p.version===rule.params.version);return p && packStatus(p,installedPacks).includes("兼容") ? p.operators.find(o=>o.id===rule.params.operator)?.name : "缺失或禁用扩展";})() : rule.op === "call" ? (() => { try { return definitionFor(rule, workflow.subgraphs).name; } catch { return "缺失子图引用"; } })() : undefined,
          resource: resources.find((r) => r.id === rule.params.resourceId),
          words: previews[String(rule.params.resourceId)] || [],
        },
      })),
    [workflow.nodes, workflow.layout, workflow.subgraphs, workflow.extensions, installedPacks, selection, resources, previews],
  );
  const edges = useMemo(
    () =>
      workflow.nodes.flatMap((n) =>
        n.inputs.flatMap((source, i) =>
          source
            ? [
                {
                  id: `${source}-${n.id}-${i}`,
                  source,
                  target: n.id,
                  targetHandle: String(i),
                  type: "default",
                  className: `edge-${operators[n.op].color}`,
                },
              ]
            : [],
        ),
      ),
    [workflow.nodes],
  );
  const connect = useCallback(
    (c: Connection) => {
      const next = structuredClone(workflow);
      const target = next.nodes.find((n) => n.id === c.target);
      if (!target) return;
      target.inputs[Number(c.targetHandle || 0)] = c.source;
      onChange(next);
    },
    [workflow, onChange],
  );
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodeClick={(_, n) => onSelect(n.id)}
      onNodeDragStart={onDragStart}
      multiSelectionKeyCode={["Control", "Meta", "Shift"]}
      onNodesChange={(changes) => {
        const selectionChanges = changes.filter((c) => c.type === "select");
        if (selectionChanges.length) {
          const ids = new Set(selection);
          for (const change of selectionChanges) {
            if (change.type === "select") {
              if (change.selected) ids.add(change.id);
              else ids.delete(change.id);
            }
          }
          onSelection([...ids]);
        }
        const removed = new Set(
          changes.filter((c) => c.type === "remove").map((c) => c.id),
        );
        if (removed.size) return;
        const positions = changes.filter((c) => c.type === "position");
        if (!positions.length) return;
        const layout = { ...workflow.layout };
        positions.forEach((c) => {
          if (c.type === "position" && c.position) layout[c.id] = c.position;
        });
        onChange({ ...workflow, layout }, false);
      }}
      onConnect={connect}
      onDelete={({ nodes: removed, edges: deleted }) => {
        const ids = new Set(removed.map((n) => n.id));
        const nodes = workflow.nodes
          .filter((n) => !ids.has(n.id))
          .map((n) => ({
            ...n,
            inputs: n.inputs.map((id, i) =>
              ids.has(id) ||
              deleted.some(
                (e) =>
                  e.target === n.id &&
                  e.source === id &&
                  e.targetHandle === String(i),
              )
                ? ""
                : id,
            ),
          }));
        onChange({ ...workflow, nodes });
      }}
      isValidConnection={(c) => {
        if (c.source === c.target) return false;
        const walk = (id: string, visited = new Set<string>()): boolean => {
          if (id === c.target) return true;
          if (visited.has(id)) return false;
          visited.add(id);
          return (
            workflow.nodes
              .find((n) => n.id === id)
              ?.inputs.some((x) => walk(x, visited)) || false
          );
        };
        return !walk(c.source);
      }}
      fitView
      fitViewOptions={{ padding: 0.12 }}
      minZoom={0.35}
      maxZoom={1.5}
      deleteKeyCode={["Backspace", "Delete"]}
      panOnScroll
      selectionOnDrag
      panOnDrag={[1, 2]}
      proOptions={{ hideAttribution: false }}
    >
      <ViewportPortal>
        {(workflow.groups || []).map((group) => {
          const points = group.nodeIds
            .filter((id) => workflow.nodes.some((n) => n.id === id))
            .map((id) => nodePosition(workflow, id));
          if (!points.length) return null;
          const x = Math.min(...points.map((p) => p.x)) - 20,
            y = Math.min(...points.map((p) => p.y)) - 35;
          return (
            <div
              key={group.id}
              className="graph-group"
              style={{
                left: x,
                top: y,
                width: Math.max(...points.map((p) => p.x)) + 232 - x,
                height: Math.max(...points.map((p) => p.y)) + 210 - y,
              }}
            >
              <b>{group.name}</b>
            </div>
          );
        })}
      </ViewportPortal>
      <Background
        variant={BackgroundVariant.Dots}
        gap={20}
        size={1}
        color="#ccd4cd"
      />
      <Controls showInteractive={false} />
      <MiniMap
        nodeColor={(n) =>
          ({
            green: "#bbd8ba",
            purple: "#d7c6ed",
            orange: "#efcbaa",
            blue: "#b9d3e7",
          })[operators[(n.data as ForgeNode["data"]).rule.op].color] ||
          "#bbd8ba"
        }
        maskColor="rgba(244,246,241,.7)"
        pannable
        zoomable
      />
    </ReactFlow>
  );
}
export function Inspector({
  node,
  resources,
  onUpdate,
  onDelete,
  onClose,
  onEditProgram,
  onPreview,
  workflow,
  onWorkflowChange,
}: {
  workflow?: Workflow;
  onWorkflowChange?: (w: Workflow) => void;
  node?: RuleNode;
  resources: Resource[];
  onUpdate: (n: RuleNode) => void;
  onDelete: () => void;
  onClose?: () => void;
  onEditProgram?: () => void;
  onPreview?: () => void;
}) {
  if (!node)
    return (
      <aside className="inspector">
        <div className="inspector-empty">
          <GitMerge size={28} />
          <p>选择一个节点</p>
          <small>让每个细节都合你心意</small>
        </div>
      </aside>
    );
  const def = operators[node.op];
  const Icon = icons[node.op];
  const param = (key: string, value: string | number) =>
    onUpdate({ ...node, params: { ...node.params, [key]: value } });
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <span>节点设置</span>
        <span className="mono muted">{node.id}</span>
        <button
          className="icon-button inspector-close"
          aria-label="收起节点设置"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="inspector-body">
        <div className={`inspector-icon ${def.color}`}>
          <Icon size={21} />
        </div>
        <h3>{def.name}</h3>
        <p className="description">{def.description}</p>
        <div className="divider" />
        {workflow && node.op !== "call" ? Array.from({ length: def.inputs }, (_, index) => (
          <label className="field-label" key={index}>
            输入 {index + 1}
            <select aria-label={`节点输入 ${index + 1}`} value={node.inputs[index] || ""} onChange={event => {
              const inputs = Array.from({ length: def.inputs }, (_, i) => node.inputs[i] || "");
              inputs[index] = event.target.value;
              onUpdate({ ...node, inputs });
            }}>
              <option value="">请选择上游节点</option>
              {node.inputs[index] && !workflow.nodes.some(n => n.id === node.inputs[index]) ? <option value={node.inputs[index]}>缺失：{node.inputs[index]}</option> : null}
              {workflow.nodes.filter(n => n.id !== node.id && n.op !== "output").map(n => <option key={n.id} value={n.id}>{operators[n.op].name} · {n.id}</option>)}
            </select>
          </label>
        )) : null}
        {node.op === "extension" && workflow ? <ExtensionInspector node={node} workflow={workflow} onChange={onWorkflowChange!} /> : null}
        {node.op === "call" && workflow ? <><CallInspector node={node} workflow={workflow} onUpdate={onUpdate} />{onWorkflowChange ? <button className="button" onClick={() => onWorkflowChange({ ...workflow, nodes: workflow.nodes.map(n => n.op === "output" ? { ...n, inputs: [node.id] } : n) })}>连接到结果输出</button> : null}</> : null}
        {node.op === "gamecheck" ? <><GameRuleEditor rule={(() => { try { return parseGameRule(String(node.params.rules)); } catch { return defaultGameRule; } })()} onChange={rule => param("rules", JSON.stringify(rule))} /><label className="field-label">检查模式<select value={String(node.params.mode)} onChange={e => param("mode", e.target.value)}><option value="filter">仅通过项</option><option value="annotate">保留并标注</option></select></label></> : null}
        {isChineseOp(node.op) ? <ChineseParams op={node.op} params={node.params} onChange={params => onUpdate({ ...node, params })} /> : null}
        {node.op === "pairs" || node.op === "template" || node.op === "group" ? <RelationParams op={node.op} params={node.params} resources={resources} onChange={params => onUpdate({ ...node, params })} /> : null}
        <button className="text-button node-preview-button" onClick={onPreview}>
          <Play size={12} />
          预览此节点（20 条）
        </button>
        {node.op === "program" ? (
          <>
            <p className="field-note">
              循环、条件与变量在结构编辑器中维护；代码视图可双向转换同一 AST。
            </p>
            <button className="button" onClick={onEditProgram}>
              编辑循环与条件
            </button>
          </>
        ) : null}
        {node.op === "resource" || node.op === "pairs" ? (
          <>
            <label className="field-label">
              引用词库
              <select
                value={String(node.params.resourceId)}
                onChange={(e) => param("resourceId", e.target.value)}
              >
                {resources.filter(r => r.kind !== "mapping" && (r.kind === "relation") === (node.op === "pairs")).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} · {r.count} 词
                  </option>
                ))}
              </select>
            </label>
            <p className="field-note">词库更新后，下次运行会读取最新版本。</p>
          </>
        ) : null}
        {node.op === "pattern" ? (
          <>
            <label className="field-label">
              组合模式
              <input
                aria-label="组合模式"
                value={String(node.params.template)}
                maxLength={16}
                onChange={(e) =>
                  param("template", e.target.value.toUpperCase())
                }
              />
            </label>
            <div className="pattern-options">
              {["AB", "AABB", "ABAB", "ABBA"].map((p) => (
                <button
                  className={node.params.template === p ? "active" : ""}
                  key={p}
                  onClick={() => param("template", p)}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="binding-row">
              <span className="variable var-a">A</span>
              <span>第一个输入词库</span>
            </div>
            <div className="binding-row">
              <span className="variable var-b">B</span>
              <span>第二个输入词库</span>
            </div>
            <div className="tip">
              <Sparkles size={15} />
              <span>试试 AABB，让名字自带一点可爱的重复感。</span>
            </div>
          </>
        ) : null}
        {node.op === "curate" ? Object.entries(operators.curate.defaults).map(([key, value]) => <label className="field-label" key={key}>{({ lengths: "字数（逗号分隔）", category: "风格分类", recipes: "配方（逗号分隔）", includes: "包含字符", excludes: "排除词条（逗号分隔）", offset: "继续抽取位置", reviewedResourceId: "关系评分资源 ID（可选）" } as Record<string,string>)[key]}<input aria-label={`精选 ${key}`} type={typeof value === "number" ? "number" : "text"} value={String(node.params[key] ?? value)} onChange={e => param(key, typeof value === "number" ? Number(e.target.value) : e.target.value)} /></label>) : null}
        {node.op === "corpus" ? Object.entries(operators.corpus.defaults).map(([key,value])=><label className="field-label" key={key}>{({style:"风格标识",mode:"抽样模式：natural / uniform / style / diverse / tail",minLength:"最短字数",maxLength:"最长字数",count:"候选数量",reviewedResourceId:"已审核关系词库 ID（可选）"} as Record<string,string>)[key]}<input aria-label={`语料 ${key}`} type={typeof value==="number"?"number":"text"} value={String(node.params[key]??value)} onChange={e=>param(key,typeof value==="number"?Number(e.target.value):e.target.value)}/></label>) : null}
        {node.op === "filter" ? (
          <>
            <label className="field-label">
              最多可见字符
              <input
                type="number"
                min={1}
                max={100}
                value={Number(node.params.maxLength)}
                onChange={(e) => param("maxLength", Number(e.target.value))}
              />
            </label>
            <label className="field-label">
              必须包含
              <input
                placeholder="例如：月"
                value={String(node.params.includes)}
                onChange={(e) => param("includes", e.target.value)}
              />
            </label>
            <label className="field-label">
              排除文字
              <input
                placeholder="留空则不限制"
                value={String(node.params.excludes)}
                onChange={(e) => param("excludes", e.target.value)}
              />
            </label>
          </>
        ) : null}
        {node.op === "prefix" || node.op === "concat" ? (
          <label className="field-label">
            {node.op === "prefix" ? "前缀文字" : "分隔文字"}
            <input
              maxLength={64}
              value={String(
                node.params[node.op === "prefix" ? "text" : "separator"],
              )}
              onChange={(e) =>
                param(
                  node.op === "prefix" ? "text" : "separator",
                  e.target.value,
                )
              }
            />
          </label>
        ) : null}
        {node.op === "output" ? (
          <div className="tip">
            <Layers size={16} />
            <span>
              结果会自动去重。每次最多输出 10,000 个名字，随时可以停止任务。
            </span>
          </div>
        ) : null}
        {node.op === "reverse" ? (
          <p className="field-note">
            按 Unicode 可见字符处理，组合 Emoji 不会被拆开。
          </p>
        ) : null}
      </div>
      <button className="delete-node" onClick={onDelete}>
        移除此节点
      </button>
    </aside>
  );
}
export function NodeLibrary({
  onAdd,
  onClose,
}: {
  onAdd: (op: Op) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="node-library">
        <p className="eyebrow">灵感工具箱</p>
        <h3>添加一个节点</h3>
        {Object.values(operators).filter(op => !["call", "argument", "extension"].includes(op.id)).map((op) => {
          const Icon = icons[op.id];
          return (
            <button
              key={op.id}
              onClick={() => {
                onAdd(op.id);
                onClose();
              }}
            >
              <span className={`library-icon ${op.color}`}>
                <Icon size={17} />
              </span>
              <span>
                <b>{op.name}</b>
                <small>{op.description}</small>
              </span>
              <Plus size={15} />
            </button>
          );
        })}
      </div>
    </>
  );
}
