import { validateSharePayload } from "../core/share-code";
import { validateGraph } from "../core/script";
import { validatePacks, type ExtensionPack } from "../core/packs";
import { allNodes } from "../core/subgraphs";
import {
  planResources,
  validateResource,
  workflowResourceIds,
} from "../core/resource-catalog";
import { validatePair } from "../core/relations";
import { operators, type Resource, type Workflow } from "../core/model";
import type { Dependency } from "../core/sharing";
import { workflowPacks } from "../core/pack-dependencies";

export const COMMUNITY_LIMIT = 1024 * 1024;
export type Counts = {
  views: number;
  adoptions: number;
  runs: number;
  likes: number;
};
export type Listing = Counts & {
  id: string;
  author_id: string;
  author: string;
  title: string;
  description: string;
  tags: string[];
  status: string;
  current_version: number;
  created_at: string;
};
export type Version = {
  workflow_id: string;
  version: number;
  payload: unknown;
  content_hash: string;
  created_at: string;
};
export type User = { id: string; name: string };
export type EventKind = "view" | "adoption" | "run";
export type Origin = {
  workflowId: string;
  version: number;
  hash: string;
  fingerprint: string;
};
export function publicWorkflow(w: Workflow): Workflow {
  // Select fields instead of copying future private/local fields.
  const {
    version,
    id,
    name,
    nodes,
    layout,
    seed,
    limit,
    comments,
    groups,
    subgraphs,
    extensions,
  } = w;
  return JSON.parse(
    JSON.stringify({
      version,
      id,
      name,
      nodes,
      layout,
      seed,
      limit,
      comments,
      groups,
      subgraphs,
      extensions,
    }),
  );
}
export function metadata(title: string, description: string, tags: string[]) {
  if (
    !title.trim() ||
    title.length > 100 ||
    description.length > 2000 ||
    tags.length > 8 ||
    tags.some((t) => !/^[\p{L}\p{N}_-]{1,24}$/u.test(t))
  )
    throw new Error("标题、描述或标签超限（最多 8 个标签）");
  if (/<\/?[a-z!]|javascript:|data:text\/html/i.test(title + description))
    throw new Error("公开描述仅接受纯文本");
  return { title: title.trim(), description, tags: [...new Set(tags)] };
}
/** Shared by browser and the bundled Edge validator. No DB, network, or execution. */
export function validateCommunityPayload(value: unknown) {
  const text = JSON.stringify(value);
  if (!text || new TextEncoder().encode(text).length > COMMUNITY_LIMIT)
    throw new Error("社区快照最多 1 MiB");
  validateSharePayload(value);
  const inspect = (v: unknown): void => {
    if (
      typeof v === "string" &&
      /<\s*\/?\s*(script|iframe|object|embed|svg)\b|^\s*javascript:/i.test(v)
    )
      throw new Error("禁止可执行标记");
    if (v && typeof v === "object")
      for (const [k, child] of Object.entries(v)) {
        if (
          [
            "script",
            "javascript",
            "eval",
            "onclick",
            "onload",
            "communityorigin",
            "favorites",
            "history",
            "generated",
          ].includes(k.toLowerCase())
        )
          throw new Error("禁止脚本或私有字段");
        inspect(child);
      }
  };
  inspect(value);
  const p = value as {
    workflow: Workflow;
    version: number;
    resources: {
      meta: Resource;
      entries: string[];
      relationRows?: unknown[];
    }[];
    dependencies?: Dependency[];
    packManifest?: unknown[];
    operatorVersions?: Record<string, number>;
    irVersion?: number;
    resourceDefinitionVersion?: number;
  };
  const allowedWorkflow = [
    "version",
    "id",
    "name",
    "nodes",
    "layout",
    "seed",
    "limit",
    "comments",
    "groups",
    "subgraphs",
    "extensions",
  ];
  if (Object.keys(p.workflow).some((k) => !allowedWorkflow.includes(k)))
    throw new Error("工作流包含非公开字段");
  validateGraph(p.workflow);
  validatePacks(p.packManifest as ExtensionPack[] | undefined);
  const deps = p.dependencies ?? [];
  if (new Set(deps.map((d) => d.id)).size !== deps.length)
    throw new Error("重复依赖");
  for (const d of deps)
    if (
      !d ||
      typeof d.id !== "string" ||
      typeof d.name !== "string" ||
      d.name.length > 100 ||
      !Number.isSafeInteger(d.version) ||
      d.version < 1 ||
      !["word", "character", "symbol", "relation", "mapping"].includes(d.kind)
    )
      throw new Error("非法依赖");
  const seen = new Set<string>();
  for (const r of p.resources) {
    if (
      Object.keys(r).some(
        (k) => !["meta", "entries", "relationRows"].includes(k),
      )
    )
      throw new Error("资源包含无关字段");
    if (
      Object.keys(r.meta).some(
        (k) =>
          ![
            "id",
            "name",
            "description",
            "kind",
            "definition",
            "color",
            "count",
            "version",
            "updatedAt",
          ].includes(k),
      )
    )
      throw new Error("资源元数据包含无关字段");
    validateResource(r.meta);
    if (
      seen.has(r.meta.id) ||
      (p.version >= 2 &&
        !deps.some(
          (d) =>
            d.id === r.meta.id &&
            d.kind === r.meta.kind &&
            d.version === r.meta.version,
        ))
    )
      throw new Error("快照依赖不匹配");
    seen.add(r.meta.id);
    if (
      !Array.isArray(r.entries) ||
      r.entries.length > 100000 ||
      r.entries.some((s) => typeof s !== "string" || s.length > 256)
    )
      throw new Error("词条超限");
    if (r.meta.definition && (r.entries.length || r.relationRows))
      throw new Error("定义不得含物化行");
    if (r.meta.kind === "relation") {
      if (
        r.entries.length ||
        !Array.isArray(r.relationRows) ||
        r.relationRows.length > 100000
      )
        throw new Error("关系行无效");
      r.relationRows.forEach(validatePair);
    } else if (r.relationRows) throw new Error("无关关系行");
  }
  // Missing snapshots are explicit external bindings; synthetic metadata only plans the closure.
  const catalog = deps.map(
    (d) =>
      p.resources.find((r) => r.meta.id === d.id)?.meta ?? {
        ...d,
        description: "",
        color: "green",
        count: 0,
        updatedAt: 0,
        ...(d.kind === "mapping"
          ? {
              definition: {
                format: 1 as const,
                type: "mapping" as const,
                rules: "{}",
              },
            }
          : {}),
      },
  );
  const roots = workflowResourceIds(p.workflow);
  if (p.version >= 2) {
    const plan = planResources(roots, catalog);
    if (plan.resources.length !== deps.length)
      throw new Error("依赖闭包不完整或含无关资源");
  } else if (p.resources.some((r) => !roots.includes(r.meta.id)))
    throw new Error("无关快照");
  const workflows = [
    p.workflow,
    ...p.resources.flatMap((r) =>
      r.meta.definition?.type === "dynamic" ? [r.meta.definition.workflow] : [],
    ),
  ];
  if (
    workflows.some((w) =>
      Object.keys(w).some((k) => !allowedWorkflow.includes(k)),
    )
  )
    throw new Error("动态工作流包含非公开字段");
  const nodes = workflows.flatMap(allNodes);
  if (p.version < 3 && p.resources.some((r) => r.meta.kind === "relation"))
    throw new Error("关系资源需要 v3 以上");
  if (p.version < 5 && p.workflow.subgraphs?.length)
    throw new Error("子图需要 v5 以上");
  if (p.version < 6 && p.resources.some((r) => r.meta.definition))
    throw new Error("定义资源需要 v6 以上");
  if (
    p.operatorVersions &&
    Object.entries(p.operatorVersions).some(
      ([op, v]) => !Object.hasOwn(operators, op) || v !== 1,
    )
  )
    throw new Error("非法算子版本");
  const required = workflowPacks(
    p.workflow,
    p.resources.map((r) => r.meta),
  );
  if (
    p.version === 7 &&
    JSON.stringify(required) !== JSON.stringify(p.packManifest)
  )
    throw new Error("扩展 manifest 不匹配或包含无关声明");
  for (const n of nodes)
    if (
      Object.keys(n).some(
        (k) =>
          ![
            "id",
            "op",
            "inputs",
            "params",
            "program",
            "parameterBindings",
            "call",
            "line",
          ].includes(k),
      )
    )
      throw new Error("节点包含非公开字段");
  if (
    p.version < 7 &&
    (p.packManifest?.length ||
      workflows.some((w) => w.extensions?.length) ||
      nodes.some((n) => n.op === "extension"))
  )
    throw new Error("扩展需要 v7");
  if (
    p.version >= 2 &&
    (p.irVersion !== 1 || nodes.some((n) => p.operatorVersions?.[n.op] !== 1))
  )
    throw new Error("IR/算子版本不兼容");
  if (p.version >= 6 && p.resourceDefinitionVersion !== 1)
    throw new Error("资源协议不兼容");
  return value;
}
export async function contentHash(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
