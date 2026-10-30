import Dexie from "dexie";
import type { GamePreset } from "../core/game-rules";
import type { Table } from "dexie";
import type {
  Candidate,
  Entry,
  Favorite,
  Resource,
  Workflow,
  RelationRow,
  PairValue,
} from "../core/model";
import { normalizePair, canReverse } from "../core/relations";
export interface RunRecord {
  id: string;
  workflow: Workflow;
  versions: Record<string, number>;
  createdAt: number;
  status: "running" | "done" | "error" | "cancelled" | "interrupted";
  count: number;
  pinned?: boolean;
  /** 0 ordinary, 1 pinned/favorite source, 2 active. Indexed retention bucket. */
  retention?: number;
  endedAt?: number;
  message?: string;
}
export interface GeneratedRecord extends Candidate {
  runId: string;
}
export class ForgeDatabase extends Dexie {
  gamePresets!: Table<GamePreset, string>;
  resources!: Table<Resource, string>;
  entries!: Table<Entry, number>;
  workflows!: Table<Workflow, string>;
  favorites!: Table<Favorite, string>;
  runs!: Table<RunRecord, string>;
  generated!: Table<GeneratedRecord, [string, string]>;
  relations!: Table<RelationRow, number>;
  constructor(name = "glyphforge-v1") {
    super(name);
    this.version(1).stores({
      resources: "id, name",
      entries: "++id, resourceId, text, &[resourceId+text]",
      workflows: "id, name",
      favorites: "text, savedAt",
    });
    this.version(2).stores({
      entries: "++id, resourceId, text, &[resourceId+text], [resourceId+id]",
      runs: "id,createdAt",
      generated: "[runId+text],text,runId",
    });
    this.version(3).stores({
      relations: "++id, resourceId, &[resourceId+left+right+relation], [resourceId+id]",
    });
    this.version(4).stores({
      relations: "++id, resourceId, [resourceId+left+right+relation], &[resourceId+left+right+relation+direction], [resourceId+id], left, right",
    }).upgrade(tx => tx.table("relations").toCollection().modify(row => {
      row.direction ??= "unknown";
      row.reverseQueryable ??= false;
    }));
    this.version(5).stores({ gamePresets: "id,name" });
    // Additive, atomic versionchange: no history/resource deletion in migration.
    this.version(6).stores({
      runs: "id,createdAt,status,[retention+createdAt]",
      favorites: "text,savedAt,runId",
    }).upgrade(async tx => {
      const runs = tx.table("runs"), favorites = tx.table("favorites");
      await runs.toCollection().modify(row => {
        if (!["running", "done", "error", "cancelled", "interrupted"].includes(row.status)) { row.status = "interrupted"; row.message = "旧记录状态缺失，无法确认完成"; }
        row.retention = row.status === "running" ? 2 : row.pinned ? 1 : 0;
      });
      let after: string | undefined;
      for (;;) {
        const chunk = await (after === undefined ? favorites.orderBy(":id") : favorites.where(":id").above(after)).limit(256).toArray();
        if (!chunk.length) break;
        for (const favorite of chunk) if (favorite.runId) {
          const run = await runs.get(favorite.runId);
          if (run) {
            await runs.update(run.id, { retention: run.status === "running" ? 2 : 1 });
            if (!(await tx.table("generated").get([run.id, favorite.text])))
              await tx.table("generated").add({ ...favorite, runId: run.id });
          }
        }
        after = chunk[chunk.length - 1].text;
      }
      let afterRun: string | undefined;
      for (;;) {
        const chunk = await (afterRun === undefined ? runs.orderBy(":id") : runs.where(":id").above(afterRun)).limit(256).toArray();
        if (!chunk.length) break;
        for (const run of chunk) await runs.update(run.id, { count: await tx.table("generated").where("runId").equals(run.id).count() });
        afterRun = chunk[chunk.length - 1].id;
      }
    });
  }
}
export const db = new ForgeDatabase();
const seeds: Array<
  [string, string, string, Resource["kind"], string, string[]]
> = [
  [
    "nature",
    "宇宙与自然",
    "把整个宇宙，装进你的名字里。",
    "word",
    "green",
    [
      "月亮",
      "星河",
      "落日",
      "银河",
      "云朵",
      "北极",
      "山海",
      "晚风",
      "流星",
      "春日",
      "宇宙",
      "日落",
    ],
  ],
  [
    "roles",
    "浪漫职业",
    "一些认真生活的奇妙身份。",
    "word",
    "purple",
    [
      "邮差",
      "收藏家",
      "漫游者",
      "诗人",
      "放映员",
      "旅人",
      "飞行员",
      "观察员",
      "捕手",
      "造梦师",
      "售货员",
      "探险家",
    ],
  ],
  [
    "animals",
    "小动物字库",
    "毛茸茸的灵感，随时待命。",
    "character",
    "orange",
    ["猫", "兔", "鹿", "鲸", "狐", "熊", "鹤", "雀"],
  ],
  [
    "moods",
    "情绪碎片",
    "轻轻的、软软的、没来由的。",
    "character",
    "blue",
    ["困", "甜", "懒", "呆", "软", "乖", "暖", "慢"],
  ],
  [
    "poetry",
    "诗意切片",
    "从日常缝隙里捡来的小小诗意。",
    "word",
    "purple",
    [
      "未眠",
      "有信",
      "听雨",
      "入梦",
      "拾光",
      "见山",
      "知秋",
      "栖迟",
      "等风",
      "寻星",
    ],
  ],
  [
    "symbols",
    "特别的符号",
    "给名字留一点不一样的标记。",
    "symbol",
    "orange",
    ["·", "꙳", "✦", "°", "_", "「", "」", "♡"],
  ],
];
export async function initialize() {
  await db.transaction("rw", db.resources, db.entries, async () => {
    if (await db.resources.count()) return;
    for (const [id, name, description, kind, color, words] of seeds) {
      await db.resources.add({
        id,
        name,
        description,
        kind,
        color,
        count: words.length,
        version: 1,
        updatedAt: Date.now(),
      });
      await db.entries.bulkAdd(words.map((text) => ({ resourceId: id, text })));
    }
  });
}
export async function addEntries(
  resourceId: string,
  texts: string[],
  target: ForgeDatabase = db,
) {
  const unique = [...new Set(texts.map((x) => x.trim()).filter(Boolean))];
  if (unique.some((x) => x.length > 256))
    throw new Error("单条词条最多 256 个代码单元");
  await target.transaction("rw", target.entries, target.resources, async () => {
    const resource = await target.resources.get(resourceId);
    if (!resource) throw new Error("词库不存在");
    if (resource.kind === "relation") throw new Error("关系词库请使用关系行编辑器");
    let added = 0;
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      try {
        await target.entries.bulkAdd(
          chunk.map((text) => ({ resourceId, text })),
        );
        added += chunk.length;
      } catch (error) {
        if (
          !(error instanceof Dexie.BulkError) ||
          error.failures.some((f) => f.name !== "ConstraintError")
        )
          throw error;
        added += chunk.length - error.failures.length;
      }
    }
    await target.resources.update(resourceId, {
      count: resource.count + added,
      version: resource.version + 1,
      updatedAt: Date.now(),
    });
  });
}
export async function saveNewResource(meta: Resource, texts: string[], target: ForgeDatabase = db) {
  await target.transaction("rw", target.resources, target.entries, async () => {
    await target.resources.add({ ...meta, count: 0 });
    if (texts.length) await addEntries(meta.id, texts, target);
  });
  return (await target.resources.get(meta.id))!;
}
export async function* readResource(
  id: string,
  seed: number,
  target: ForgeDatabase = db,
): AsyncGenerator<Candidate> {
  const resource = await target.resources.get(id);
  if (!resource) throw new Error(`未找到资源 ${id}，请重新绑定词库`);
  // Read at most 256 entries per page. A seeded rotation changes order without expanding the full resource.
  const count = resource.count;
  if (!count) return;
  const start = Math.abs(Math.trunc(seed)) % count;
  const table = resource.kind === "relation" ? target.relations : target.entries;
  const first = await table
    .where({ resourceId: id })
    .offset(start)
    .first();
  if (!first) return;
  for (const [from, to] of [
    [first.id!, Infinity],
    [0, first.id!],
  ]) {
    let cursor = from;
    while (true) {
      if ((await target.resources.get(id))?.version !== resource.version)
        throw new Error("词库在运行期间发生更改，请重新生成");
      const entries = await table
        .where("[resourceId+id]")
        .between([id, cursor], [id, to], true, false)
        .limit(256)
        .toArray();
      if (!entries.length) break;
      cursor = entries.at(-1)!.id! + 1;
      for (const entry of entries) {
        const pair = "left" in entry ? normalizePair(entry) : undefined;
        const text = pair ? `${pair.left} / ${pair.right}` : (entry as Entry).text;
        yield {
          text,
          ...(pair ? { pair } : {}),
          parts: [
            { resourceId: id, text, version: resource.version, ...(pair ? { pair } : {}) },
          ],
        };
      }
    }
  }
}
export function resourceQuery(
  id: string,
  query: string,
  mode: "prefix" | "exact" | "contains" = "prefix",
) {
  if (!query) return db.entries.where({ resourceId: id });
  if (mode === "exact")
    return db.entries.where("[resourceId+text]").equals([id, query]);
  if (mode === "prefix")
    return db.entries
      .where("[resourceId+text]")
      .between([id, query], [id, query + "\uffff"], true, true);
  return db.entries
    .where({ resourceId: id })
    .filter((e) => e.text.includes(query));
}
export async function deleteResource(id: string, target: ForgeDatabase = db) {
  await target.transaction("rw", target.resources, target.entries, target.relations, async () => {
    await target.entries.where({ resourceId: id }).delete();
    await target.relations.where({ resourceId: id }).delete();
    await target.resources.delete(id);
  });
}
export async function saveRelationRows(resourceId: string, rows: PairValue[], replaceId?: number, target: ForgeDatabase = db) {
  if (rows.length > 10000) throw new Error("每次最多写入 10,000 行关系");
  const normalized = rows.map(normalizePair);
  await target.transaction("rw", target.resources, target.relations, async () => {
    const meta = await target.resources.get(resourceId);
    if (meta?.kind !== "relation") throw new Error("请选择关系词库");
    if (replaceId !== undefined) {
      if (normalized.length !== 1 || (await target.relations.get(replaceId))?.resourceId !== resourceId) throw new Error("待修改关系不存在");
      await target.relations.delete(replaceId);
    }
    const unique = [...new Map(normalized.map(r => [JSON.stringify([r.left, r.right, r.relation, r.direction]), r])).values()];
    for (const r of unique) {
      if (!(await target.relations.where("[resourceId+left+right+relation+direction]").equals([resourceId, r.left, r.right, r.relation, r.direction!]).count()))
        await target.relations.add({ ...r, resourceId, ...(replaceId !== undefined ? { id: replaceId } : {}) });
    }
    await target.resources.update(resourceId, { count: await target.relations.where({ resourceId }).count(), version: meta.version + 1, updatedAt: Date.now() });
  });
}
/** Query traversal never changes the persisted left/right template slots. */
export async function queryRelations(text: string, options: { direction?: "forward" | "reverse" | "both"; relation?: string; resourceIds?: string[]; limit?: number } = {}, target = db) {
  const limit = Math.max(1, Math.min(500, options.limit || 100)), direction = options.direction || "both";
  const allowed = (r: RelationRow) => (!options.relation || r.relation === options.relation) && (!options.resourceIds || options.resourceIds.includes(r.resourceId));
  const forward = direction === "reverse" ? [] : await target.relations.where("left").equals(text).filter(allowed).limit(limit).toArray();
  const reverse = direction === "forward" ? [] : await target.relations.where("right").equals(text).filter(r => allowed(r) && canReverse(r)).limit(limit).toArray();
  return [...forward.map(row => ({ row, traversal: "forward" as const, neighbor: row.right })), ...reverse.map(row => ({ row, traversal: "reverse" as const, neighbor: row.left }))].slice(0, limit);
}
export async function deleteRelationRow(resourceId: string, rowId: number, target: ForgeDatabase = db) {
  await target.transaction("rw", target.resources, target.relations, async () => {
    const meta = await target.resources.get(resourceId), row = await target.relations.get(rowId);
    if (meta?.kind !== "relation" || row?.resourceId !== resourceId) throw new Error("关系行不存在");
    await target.relations.delete(rowId);
    await target.resources.update(resourceId, { count: meta.count - 1, version: meta.version + 1, updatedAt: Date.now() });
  });
}
