import type { ResourcePlan } from "./resource-catalog";
import { workflowResourceIds as dependencyIds } from "./resource-catalog";
import { captureResources, assertResourcePlan } from "../storage/resource-runtime";
import { allNodes, reachableDefinitions } from "./subgraphs";
import { normalizeParams } from "./contracts";
import { db, readResource, readStaticResource } from "../storage/db";
import { validateGraph } from "./script";
import { visitProgramExpressions } from "./program";
import { operators } from "./model";
import { isChineseOp } from "./chinese-definitions";
import type { Op } from "./model";
import type { Resource, Workflow, PairValue } from "./model";
import { templateConfig, validatePair, normalizePair } from "./relations";
export interface Dependency {
  id: string;
  name: string;
  version: number;
  kind: Resource["kind"];
}
export class ResourceDependencyError extends Error {
  constructor(public dependencies: Dependency[]) {
    super("依赖词库缺失或版本不同，请选择本地词库重新绑定");
  }
}
function packageOperators(workflow: Workflow) {
  const used = new Set<Op>(allNodes(workflow).map(n => n.op));
  for (const node of allNodes(workflow)) if (node.program) visitProgramExpressions(node.program, expression => {
    if (expression.kind === "call" && (isChineseOp(expression.name) || expression.name === "pairs")) used.add(expression.name);
  });
  return [...used];
}
export { workflowResourceIds as dependencyIds } from "./resource-catalog";
export async function exportPackage(
  workflow: Workflow,
  includeResources: boolean | string[] = true,
  signal?:AbortSignal,
  options?: { plan: ResourcePlan; maxBytes: number },
) {
  workflow = { ...workflow }; delete workflow.communityOrigin;
  validateGraph(workflow);
  const plan = options?.plan ?? await captureResources(dependencyIds(workflow));
  const maxBytes = Math.min(options?.maxBytes ?? 15*1024*1024,15*1024*1024);
  if(workflow.extensions?.length || plan.resources.some(r=>r.definition)) { const { exportResourcePackage } = await import("./resource-package"); return exportResourcePackage(workflow,includeResources,signal,options); }
  if (workflow.subgraphs?.length) workflow = { ...workflow, subgraphs: reachableDefinitions(workflow.nodes, workflow.subgraphs) };
  const ids = dependencyIds(workflow);
  const dependencies: Dependency[] = [];
  const resources: { meta: Resource; entries: string[]; relationRows?: PairValue[] }[] = [];
  let budget=new TextEncoder().encode(JSON.stringify(workflow,null,2)).length+4096;
  for (const id of ids) {
    if(signal?.aborted)throw new Error('导出已取消');
    const meta = await db.resources.get(id);
    if (!meta) throw new Error(`依赖词库 ${id} 缺失，无法导出`);
    dependencies.push({
      id,
      name: meta.name,
      version: meta.version,
      kind: meta.kind,
    });
    if (
      includeResources === true ||
      (Array.isArray(includeResources) && includeResources.includes(id))
    ) {
      if (meta.count > 100000)
        throw new Error(
          "便携包单个快照最多十万词条；大型词库请单独导出，使用轻量工作流重新绑定",
        );
      if(resources.length>=100)throw new Error('便携包最多包含 100 个词库快照');
      const entries:string[]=[], relationRows: PairValue[] = [];budget+=new TextEncoder().encode(JSON.stringify(meta)).length+512;
      for await(const item of (options ? readStaticResource(id,0) : readResource(id,0))){if(signal?.aborted)throw new Error('导出已取消');if(item.parts[0].version!==meta.version)throw new Error('词库在导出期间变化，请重新导出');budget+=new TextEncoder().encode(JSON.stringify(item.pair || item.text)).length+16;if(budget>maxBytes)throw new Error(`便携包超过 ${maxBytes===1048576?'分享码 1 MiB':'15 MB'} 预算，请下载 JSON 文件或减少快照`);if(item.pair) relationRows.push(item.pair); else entries.push(item.text);}
      resources.push({meta,entries,...(meta.kind === "relation" ? {relationRows} : {})});
    }
  }
  if(options)await assertResourcePlan(plan);
  return {
    format: "glyphforge",
    version: workflow.subgraphs?.length ? 5 : dependencies.some(d => d.kind === "relation") ? 4 : 2,
    irVersion: 1,
    operatorVersions: Object.fromEntries(
      packageOperators(workflow).map((op) => [op, 1]),
    ),
    workflow,
    dependencies,
    resources,
  };
}
export async function importPackage(
  data: unknown,
  bindings: Record<string, string> = {},
  preview = false,
): Promise<Workflow> {
  if (!data || typeof data !== "object") throw new Error("无效的工作流文件");
  const pkg = data as Record<string, unknown>;
  if(pkg.version===6 || pkg.version===7){const {importResourcePackage}=await import("./resource-package");return importResourcePackage(data,bindings,preview);}
  if (
    pkg.format !== "glyphforge" ||
    ![1, 2, 3, 4, 5].includes(Number(pkg.version)) ||
    !pkg.workflow ||
    !Array.isArray(pkg.resources) ||
    pkg.resources.length > 100
  )
    throw new Error("文件格式或版本不受支持");
  const workflow = structuredClone(pkg.workflow) as Workflow;
  delete workflow.communityOrigin;
  if(workflow.extensions?.length || workflow.nodes?.some(n=>n.op==="extension") || workflow.subgraphs?.some(d=>d.nodes.some(n=>n.op==="extension")))throw new Error("扩展需要 v7 分享包");
  if (
    workflow.version !== 1 ||
    typeof workflow.name !== "string" ||
    workflow.name.length > 100 ||
    !Number.isSafeInteger(workflow.seed) ||
    !Array.isArray(workflow.nodes)
  )
    throw new Error("工作流字段无效");
  for (const n of workflow.nodes) {
    if (
      !n ||
      !n.params ||
      typeof n.params !== "object" ||
      Array.isArray(n.params) ||
      !Array.isArray(n.inputs) ||
      n.inputs.some((id) => typeof id !== "string")
    )
      throw new Error("节点格式无效");
    if (
      Object.values(n.params).some(
        (x) => !["string", "number", "boolean"].includes(typeof x),
      )
    )
      throw new Error("节点参数无效");
  }
  if (workflow.subgraphs?.length && Number(pkg.version) !== 5) throw new Error("子图需要 v5 分享包");
  validateGraph(workflow);
  // Imported definitions receive fresh IDs, preserving existing local revisions.
  const definitionIds = new Map((workflow.subgraphs ?? []).map(d => [d.id, crypto.randomUUID()]));
  for (const d of workflow.subgraphs ?? []) d.id = definitionIds.get(d.id)!;
  for (const n of allNodes(workflow)) if (n.call) n.call.definitionId = definitionIds.get(n.call.definitionId)!;
  for (const node of allNodes(workflow)) node.params = normalizeParams(node.op, node.params);
  if (Number(pkg.version) >= 2) {
    if (
      pkg.irVersion !== 1 ||
      !pkg.operatorVersions ||
      typeof pkg.operatorVersions !== "object"
    )
      throw new Error("缺少兼容的 IR / 算子版本清单");
    for (const [op, version] of Object.entries(pkg.operatorVersions)) {
      if (!Object.hasOwn(operators, op) || version !== 1)
        throw new Error(`算子 ${op} 的版本不兼容`);
    }
    for (const op of packageOperators(workflow))
      if ((pkg.operatorVersions as Record<string, unknown>)[op] !== 1)
        throw new Error(`缺少算子 ${op} 的版本`);
  }
  const ids = dependencyIds(workflow),
    mapping = new Map<string, string>(),
    seen = new Set<string>();
  const items: { meta: Resource; entries: string[]; relationRows?: PairValue[] }[] = [];
  for (const item of pkg.resources) {
    if (
      !item?.meta ||
      typeof item.meta.id !== "string" ||
      typeof item.meta.name !== "string" ||
      item.meta.name.length > 100 ||
      seen.has(item.meta.id) ||
      !ids.includes(item.meta.id) ||
      !Array.isArray(item.entries) ||
      item.entries.length > 100000 ||
      item.entries.some((s: unknown) => typeof s !== "string" || s.length > 256)
    )
      throw new Error("资源内容无效、重复或超过十万条快照限制");
    seen.add(item.meta.id);
    const isRelation = item.meta.kind === "relation";
    if (isRelation) {
      if (![3, 4, 5].includes(Number(pkg.version)) || item.entries.length || !Array.isArray(item.relationRows) || item.relationRows.length > 100000) throw new Error("关系快照需要 v3 和有效的关系行");
      item.relationRows.forEach(validatePair);
    } else if (item.relationRows !== undefined) throw new Error("普通词库不能包含关系行");
    const id = crypto.randomUUID();
    mapping.set(item.meta.id, id);
    const entries = [...new Set<string>(item.entries)];
    const relationRows: PairValue[] = isRelation ? [...new Map<string, PairValue>(item.relationRows.map((r: PairValue) => {
      const row = normalizePair(r);
      return [JSON.stringify(row), row] as [string, PairValue];
    })).values()] : [];
    items.push({
      meta: {
        id,
        name: `${item.meta.name} · 导入`,
        description: String(item.meta.description || "便携包恢复").slice(
          0,
          256,
        ),
        kind: ["word", "character", "symbol", "relation"].includes(item.meta.kind)
          ? item.meta.kind
          : "word",
        color: ["green", "purple", "orange", "blue"].includes(item.meta.color)
          ? item.meta.color
          : "green",
        version:
          Number.isSafeInteger(item.meta.version) && item.meta.version > 0
            ? item.meta.version
            : 1,
        count: isRelation ? relationRows.length : entries.length,
        updatedAt: Date.now(),
      },
      entries,
      ...(isRelation ? { relationRows } : {}),
    });
  }
  const dependencies: Dependency[] = [];
  if (Number(pkg.version) >= 2) {
    if (
      !Array.isArray(pkg.dependencies) ||
      pkg.dependencies.length !== ids.length
    )
      throw new Error("资源依赖清单无效");
    for (const dep of pkg.dependencies) {
      if (
        !dep ||
        !ids.includes(dep.id) ||
        typeof dep.name !== "string" ||
        !Number.isSafeInteger(dep.version) ||
        dep.version < 1 ||
        !["word", "character", "symbol", "relation"].includes(dep.kind) ||
        dependencies.some((d) => d.id === dep.id)
      )
        throw new Error("资源依赖清单无效");
      dependencies.push(dep);
    }
  } else
    for (const id of ids)
      dependencies.push({ id, name: id, kind: "word", version: 1 });
  const missing: Dependency[] = [];
  for (const dep of dependencies) {
    const snapshot = items.find(item => mapping.get(dep.id) === item.meta.id);
    if (snapshot && Number(pkg.version) >= 2 && ((snapshot.meta.kind === "relation") !== (dep.kind === "relation") || snapshot.meta.version !== dep.version)) throw new Error("快照与依赖的类型或版本不一致");
    if (mapping.has(dep.id)) continue;
    const target = bindings[dep.id] || dep.id;
    const resource = await db.resources.get(target);
    if (!resource || (resource.kind === "relation") !== (dep.kind === "relation") || (!bindings[dep.id] && resource.version !== dep.version)) {
      missing.push(dep);
      continue;
    }
    mapping.set(dep.id, target);
  }
  if (missing.length) {
    if (pkg.version === 1) throw new Error("分享包缺少依赖资源");
    throw new ResourceDependencyError(missing);
  }
  const layout: Workflow["layout"] = {};
  for (const node of allNodes(workflow)) {
    const point = workflow.layout?.[node.id];
    if (
      point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      Math.abs(point.x) < 100000 &&
      Math.abs(point.y) < 100000
    )
      layout[node.id] = { x: point.x, y: point.y };
    if (node.op === "resource" || node.op === "pairs")
      node.params.resourceId = mapping.get(String(node.params.resourceId))!;
    if (node.op === "curate" && node.params.reviewedResourceId) node.params.reviewedResourceId = mapping.get(String(node.params.reviewedResourceId))!;
    if (node.op === "mutate" && node.params.resourceId) node.params.resourceId = mapping.get(String(node.params.resourceId)) ?? node.params.resourceId;
    if (node.op === "template") node.params.slots = JSON.stringify(templateConfig(node.params).slots.map(s => ({ ...s, resourceId: mapping.get(s.resourceId)! })));
    if (node.program)
      visitProgramExpressions(node.program, (e) => {
        if (e.kind === "resource") e.id = mapping.get(e.id)!;
        if (
          e.kind === "call" &&
          ["resource", "pairs"].includes(e.name) &&
          e.args[0].kind === "literal"
        )
          e.args[0].value = mapping.get(String(e.args[0].value))!;
      });
  }
  workflow.id = crypto.randomUUID();
  workflow.name = `${workflow.name.slice(0, 90)} · 导入`;
  workflow.layout = layout;
  workflow.comments = Array.isArray(workflow.comments)
    ? workflow.comments
        .filter((c) => typeof c === "string" && c.startsWith("//"))
        .slice(0, 100)
    : [];
  workflow.groups = Array.isArray(workflow.groups)
    ? workflow.groups
        .filter(
          (g) =>
            g &&
            typeof g.id === "string" &&
            typeof g.name === "string" &&
            Array.isArray(g.nodeIds),
        )
        .slice(0, 50)
        .map((g) => ({
          id: g.id,
          name: g.name.slice(0, 60),
          nodeIds: g.nodeIds.filter((id) =>
            workflow.nodes.some((n) => n.id === id),
          ),
        }))
    : [];
  if (preview) return workflow;
  await db.transaction(
    "rw",
    db.resources,
    db.entries,
    db.relations,
    db.workflows,
    async () => {
      for (const item of items) {
        await db.resources.add(item.meta);
        if (item.relationRows) for (let i = 0; i < item.relationRows.length; i += 1000)
          await db.relations.bulkAdd(item.relationRows.slice(i, i + 1000).map(r => ({ ...r, resourceId: item.meta.id })));
        for (let i = 0; i < item.entries.length; i += 1000)
          await db.entries.bulkAdd(
            item.entries
              .slice(i, i + 1000)
              .map((text) => ({ resourceId: item.meta.id, text })),
          );
      }
      await db.workflows.add(workflow);
    },
  );
  return workflow;
}
export function download(
  name: string,
  data: string,
  type = "application/json",
) {
  downloadBlob(name, new Blob([data], { type }));
}
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
