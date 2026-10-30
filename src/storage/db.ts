import Dexie from "dexie";
import type { Table } from "dexie";
import type {
  Candidate,
  Entry,
  Favorite,
  Resource,
  Workflow,
} from "../core/model";
export interface RunRecord {
  id: string;
  workflow: Workflow;
  versions: Record<string, number>;
  createdAt: number;
  status: "running" | "done" | "error" | "cancelled";
  count: number;
}
export interface GeneratedRecord extends Candidate {
  runId: string;
}
export class ForgeDatabase extends Dexie {
  resources!: Table<Resource, string>;
  entries!: Table<Entry, number>;
  workflows!: Table<Workflow, string>;
  favorites!: Table<Favorite, string>;
  runs!: Table<RunRecord, string>;
  generated!: Table<GeneratedRecord, [string, string]>;
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
export async function* readResource(
  id: string,
  seed: number,
): AsyncGenerator<Candidate> {
  const resource = await db.resources.get(id);
  if (!resource) throw new Error(`未找到资源 ${id}，请重新绑定词库`);
  // Read at most 256 entries per page. A seeded rotation changes order without expanding the full resource.
  const count = resource.count;
  if (!count) return;
  const start = Math.abs(Math.trunc(seed)) % count;
  const first = await db.entries
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
      if ((await db.resources.get(id))?.version !== resource.version)
        throw new Error("词库在运行期间发生更改，请重新生成");
      const entries = await db.entries
        .where("[resourceId+id]")
        .between([id, cursor], [id, to], true, false)
        .limit(256)
        .toArray();
      if (!entries.length) break;
      cursor = entries.at(-1)!.id! + 1;
      for (const entry of entries)
        yield {
          text: entry.text,
          parts: [
            { resourceId: id, text: entry.text, version: resource.version },
          ],
        };
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
export async function deleteResource(id: string) {
  await db.transaction("rw", db.resources, db.entries, async () => {
    await db.entries.where({ resourceId: id }).delete();
    await db.resources.delete(id);
  });
}
