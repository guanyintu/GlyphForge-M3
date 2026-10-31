import { mergeLineage } from "./lineage";
import { glyphs } from "./model";
import type { Candidate, PairValue, Params, RelationKind, SourcePart } from "./model";

export const relationLabels: Record<RelationKind, string> = {
  associated: "关联", antonym: "反义", couple: "情侣", parallel: "对仗关联",
};
export function validRelation(value: unknown): value is RelationKind {
  return typeof value === "string" && Object.hasOwn(relationLabels, value);
}
export function validatePair(row: unknown): asserts row is PairValue {
  const r = row as PairValue | null;
  if (!r || !validRelation(r.relation) || [r.left, r.right].some(x => typeof x !== "string" || !x.trim() || x.length > 256))
    throw new Error("关系行需要非空的左右词（各最多 256 字符）及有效的关系类型");
  if (r.direction !== undefined && !["symmetric", "directed", "unknown"].includes(r.direction)) throw new Error("无效关系方向");
  if (r.reverseQueryable !== undefined && typeof r.reverseQueryable !== "boolean") throw new Error("反向查询开关无效");
  if (r.weight !== undefined && (!Number.isFinite(r.weight) || r.weight < 0 || r.weight > 100)) throw new Error("关系权重需要 0–100");
  if (r.tags !== undefined && (!Array.isArray(r.tags) || r.tags.length > 16 || r.tags.some(t => typeof t !== "string" || t.length > 40))) throw new Error("关系标签最多 16 个，各 40 字符");
  for (const field of ["note", "source"] as const) if (r[field] !== undefined && (typeof r[field] !== "string" || r[field]!.length > 256)) throw new Error("关系备注/来源最多 256 字符");
}
export function normalizePair(row: PairValue): PairValue {
  validatePair(row);
  return { left: row.left.trim(), right: row.right.trim(), relation: row.relation,
    direction: row.direction || "unknown", reverseQueryable: row.reverseQueryable ?? false,
    ...(row.weight !== undefined ? { weight: row.weight } : {}), ...(row.tags ? { tags: [...row.tags] } : {}),
    ...(row.note !== undefined ? { note: row.note } : {}), ...(row.source !== undefined ? { source: row.source } : {}) };
}
export const directionLabels = { symmetric: "对称 ↔", directed: "有向 →", unknown: "历史/未知方向 ?" };
export function canReverse(row: PairValue) { return row.direction === "symmetric" || row.reverseQueryable === true; }
export interface TemplateSlot {
  name: string;
  resourceId: string;
  kind: "word" | "pair";
  relation?: RelationKind | "";
}
export function templateConfig(p: Params) {
  let slots: TemplateSlot[], templates: string[];
  try { slots = JSON.parse(String(p.slots)); templates = JSON.parse(String(p.templates)); }
  catch { throw new Error("槽位和名字模板需要有效的 JSON 数组"); }
  if (!Array.isArray(slots) || slots.length < 1 || slots.length > 6 || slots.some(s =>
    !s || typeof s.name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(s.name) ||
    typeof s.resourceId !== "string" || !s.resourceId || s.resourceId.length > 256 ||
    !["word", "pair"].includes(s.kind) || (s.relation !== undefined && s.relation !== "" && !validRelation(s.relation))))
    throw new Error("需要 1–6 个有效槽位，名称使用英文字母、数字或下划线");
  const names = new Map(slots.map(s => [s.name, s]));
  if (names.size !== slots.length) throw new Error("槽位名称不能重复");
  if (!Array.isArray(templates) || !templates.length || templates.length > 8 || templates.some(t => typeof t !== "string" || !t || t.length > 256))
    throw new Error("需要 1–8 个非空名字模板，各最多 256 字符");
  for (const t of templates) {
    const remainder = t.replace(/\{([A-Za-z][A-Za-z0-9_]*)(?:\.(left|right))?\}/g, (_, name: string, side?: string) => {
      const slot = names.get(name);
      if (!slot || (slot.kind === "pair") !== Boolean(side)) throw new Error(`模板变量 ${name}${side ? `.${side}` : ""} 无效`);
      return "";
    });
    if (/[{}]/.test(remainder)) throw new Error("模板使用 {变量} 或 {关系槽.left} / {关系槽.right}");
  }
  return { slots, templates };
}
export function validateRelationParams(op: string, p: Params) {
  const integer = (key: string, max: number) => {
    if (!Number.isInteger(p[key]) || Number(p[key]) < 1 || Number(p[key]) > max) throw new Error(`${key} 需要 1–${max} 的整数`);
  };
  if (op === "pairs" && p.relation !== "" && !validRelation(p.relation)) throw new Error("未知关系类型");
  if (op === "template") { templateConfig(p); integer("maxLength", 100); }
  if (op === "group") { integer("count", 100); integer("batches", 100); integer("maxLength", 100); }
}
export type BindingReader = (id: string, seed: number) => AsyncIterable<Candidate>;
export async function* readPairs(reader: BindingReader, id: string, seed: number, relation: string, tick: () => void) {
  for await (const item of reader(id, seed)) {
    tick();
    if (!item.pair) throw new Error("请选择关系词库，普通词条不能用作关系词对");
    if (!relation || item.pair.relation === relation) yield item;
  }
}
export async function* renderTemplates(p: Params, reader: BindingReader, seed: number, tick: () => void): AsyncGenerator<Candidate> {
  const { slots, templates } = templateConfig(p);
  const bindings = new Map<string, string>();
  async function* bind(index: number, parts: SourcePart[], sources: Candidate[]): AsyncGenerator<Candidate> {
    tick();
    if (index === slots.length) {
      const members = templates.map(t => t.replace(/\{([^{}]+)\}/g, (_, key: string) => bindings.get(key)!));
      const lengths = members.map(m => glyphs(m).length);
      if (members.some(m => !m || m.length > 1024) || lengths.some(n => n > Number(p.maxLength)) || (p.equalLength && new Set(lengths).size !== 1)) return;
      const text = members.join(String(p.separator));
      if (text.length > 1024) throw new Error("整组文字超过 1024 个代码单元，请减少模板或缩短分隔符");
      const lineage = mergeLineage(sources);
      yield { text, members, parts, ...(lineage ? {lineage} : {}) };
      return;
    }
    const slot = slots[index];
    const source = slot.kind === "pair" ? readPairs(reader, slot.resourceId, seed, slot.relation || "", tick) : reader(slot.resourceId, seed);
    for await (const item of source) {
      tick();
      if (slot.kind === "word") {
        if (item.pair) throw new Error(`槽位 ${slot.name} 需要普通词库`);
        bindings.set(slot.name, item.text);
      } else {
        bindings.set(`${slot.name}.left`, item.pair!.left);
        bindings.set(`${slot.name}.right`, item.pair!.right);
      }
      yield* bind(index + 1, [...parts, ...item.parts], [...sources,item]);
    }
  }
  yield* bind(0, [], []);
}
export async function* groupMembers(input: AsyncIterable<Candidate>, p: Params, seed: number, tick: () => void): AsyncGenerator<Candidate> {
  const count = Number(p.count), batches = Number(p.batches), needed = count * batches;
  const seen = new Set<string>();
  const selected: Candidate[] = [];
  let eligible = 0, state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for await (const item of input) {
    tick();
    if (item.pair || (item.members && item.members.length > 1)) throw new Error("成员分组需要单个名字序列；请使用单名字模板，不要将整对或整组当成一名成员");
    const text = [String(p.prefix), item.text, String(p.suffix)].filter(Boolean).join(String(p.separator));
    if (glyphs(text).length > Number(p.maxLength) || !text || seen.has(text)) continue;
    if (seen.size >= 10000) throw new Error("成员候选最多扫描 10,000 个唯一名字，请缩小词库");
    seen.add(text); eligible++;
    const member = { ...item, text };
    if (selected.length < needed) selected.push(member);
    else if (p.random) {
      const index = Math.floor(random() * eligible);
      if (index < needed) selected[index] = member;
    }
    if (!p.random && selected.length === needed) break;
  }
  if (selected.length < needed) throw new Error(`符合条件的不同成员名只有 ${selected.length} 个，需要 ${needed} 个；请减少人数/批次或放宽长度`);
  if (p.random) for (let i = selected.length - 1; i > 0; i--) {
    tick(); const j = Math.floor(random() * (i + 1)); [selected[i], selected[j]] = [selected[j], selected[i]];
  }
  for (let i = 0; i < needed; i += count) {
    tick(); const group = selected.slice(i, i + count), members = group.map(m => m.text), text = members.join(String(p.joiner));
    if (text.length > 1024) throw new Error("整组文字超过 1024 个代码单元，请减少人数或缩短名字");
    const lineage = mergeLineage(group);
    yield { text, members, ...(lineage ? {lineage} : {}), parts: group.flatMap(m => m.parts), notes: [...new Set(group.flatMap(m => m.notes || []))] };
  }
}
