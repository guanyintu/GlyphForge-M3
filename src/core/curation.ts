import type { Candidate, Params } from "./model";
import { glyphs } from "./unicode";

export const curationDefaults = {
  lengths: "2,3", category: "", recipes: "direct,suffix,prefix,semantic,contrast",
  includes: "", excludes: "", offset: 0,
};
const tokens = (s: unknown) => String(s).split(/[,，\s]+/u).filter(Boolean);
export function validateCuration(p: Params) {
  if (!/^[1-9]\d?(,[1-9]\d?)*$/.test(String(p.lengths))) throw new Error("字数使用逗号分隔的 1–99 整数");
  if (!Number.isInteger(p.offset) || Number(p.offset) < 0 || Number(p.offset) > 10000) throw new Error("继续抽取位置需要 0–10000 整数");
}
export function candidateCategory(c: Candidate) {
  return c.parts.flatMap(p => p.pair?.tags || []).find(t => t.startsWith("风格:"))?.slice(3) || "自定义";
}
export function candidateRecipe(c: Candidate) {
  const pair = c.parts.find(p => p.pair)?.pair;
  if (pair && c.text === pair.left && glyphs(pair.left).length === 2) return "direct";
  return pair?.tags?.find(t => t.startsWith("配方:"))?.slice(3) || "direct";
}
function hash(text: string, seed: number) {
  let n = (seed ^ 2166136261) >>> 0;
  for (const ch of text) n = Math.imul(n ^ ch.codePointAt(0)!, 16777619) >>> 0;
  // Avalanche adjacent seeds as well as adjacent words.
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
/** Bounded ranking of an existing sequence; never invents text or provenance. */
export async function* curate(input: AsyncIterable<Candidate>, p: Params, seed: number, tick: () => void) {
  const lengths = new Set(tokens(p.lengths).map(Number)), recipes = new Set(tokens(p.recipes));
  const excluded = tokens(p.excludes), unique = new Map<string, { c: Candidate; rank: number }>();
  let scanned = 0;
  for await (const c of input) {
    tick();
    if (++scanned > 10000) throw new Error("精选排序最多扫描 10,000 项，请缩小上游词库");
    if (!lengths.has(glyphs(c.text).length) || !c.text.includes(String(p.includes)) || excluded.some(t => c.text.includes(t))) continue;
    if (p.category && candidateCategory(c) !== p.category) continue;
    if (recipes.size && !recipes.has(candidateRecipe(c))) continue;
    const weights = c.parts.flatMap(s => s.pair?.weight === undefined ? [] : [s.pair.weight]);
    const quality = weights.length ? Math.max(...weights) : 70;
    const rank = quality + hash(c.text, seed) * 22;
    const prior = unique.get(c.text);
    if (!prior || rank > prior.rank) unique.set(c.text, { c, rank });
  }
  const buckets = new Map<string, Candidate[]>();
  for (const { c } of [...unique.values()].sort((a, b) => b.rank - a.rank || (a.c.text < b.c.text ? -1 : 1))) {
    tick(); const key = candidateCategory(c);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(c);
  }
  const keys = [...buckets.keys()].sort((a, b) => hash(a, seed) - hash(b, seed));
  const ordered: Candidate[] = [], deferred: Candidate[] = [], roots = new Set<string>();
  const cursors = new Map(keys.map(k => [k, 0]));
  let remaining = unique.size;
  while (remaining) for (const key of keys) {
    const cursor = cursors.get(key)!;
    const c = buckets.get(key)![cursor]; if (!c) continue;
    cursors.set(key, cursor + 1);
    tick(); remaining--;
    const pair = c.parts.find(p => p.pair)?.pair;
    const root = pair ? (candidateRecipe(c) === "prefix" ? pair.right : pair.left) : c.text;
    if (roots.has(root)) deferred.push(c); else { roots.add(root); ordered.push(c); }
  }
  for (const c of [...ordered, ...deferred].slice(Number(p.offset))) { tick(); yield c; }
}
