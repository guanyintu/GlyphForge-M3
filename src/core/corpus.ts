import type { Candidate, Params } from "./model";

export const corpusStyles = { cute: "萌系日常", nature: "自然意象", literary: "清冷文艺", fantasy: "奇幻角色", trend: "趣味潮流", haidu: "海都潮人" };
export type CorpusStyle = keyof typeof corpusStyles;
export type Review = "AUTO" | "PENDING" | "APPROVED" | "REJECTED";
export interface PositionStats {
  count: number; roles: Record<string, number>; absolute: Record<string, number>; relativeDeciles: Record<string, number>;
  preference: string; confidence: string; share: number;
}
export interface CorpusMaterial {
  text: string; length: number; frequency: number; playerCoverage: number; uniqueNameCount: number;
  firstCount: number; middleCount: number; lastCount: number;
  positionsByLength: Record<string, PositionStats>; positionTags: string[]; semanticTags: string[]; styleTags: string[];
  confidence: number; enabled: boolean; review: Review; level: string; kinds: string[];
  sources: Record<string, number>; sourceLengths: Record<string, number>; currentCount: number; historyCount: number;
  integrity: number; semanticQuality: number; statisticalWeight: number; manualWeight: number; styleWeight: number; provenance: string;
}
export interface CorpusRelation {
  left: string; right: string; type: string; frequency: number; playerCoverage: number; review: Review; enabled: boolean; confidence: number; evidence: string;
}
export interface CorpusConfig {
  style: CorpusStyle | "all"; enabled: boolean; minLength: number; maxLength: number;
  source: { databaseSHA256: string; boundaryLexiconSHA256: string; deduplicatedPlayerNames: number };
}
export interface CorpusPackage extends Omit<CorpusConfig, "style"> {
  format: "glyphforge-playertrack"; version: 1; style: CorpusStyle | "all"; name: string;
  entries: CorpusMaterial[]; relations: CorpusRelation[];
}
export const corpusModes = { natural: "自然频率", uniform: "均匀随机", style: "风格优先", diverse: "低重复", tail: "长尾探索" };
export function validateCorpusParams(p: Params) {
  if (!Object.hasOwn(corpusStyles, String(p.style)) && p.style !== "all") throw new Error("语料风格无效");
  if (!Object.hasOwn(corpusModes, String(p.mode))) throw new Error("语料抽样模式无效");
  for (const key of ["minLength", "maxLength", "count"]) if (!Number.isInteger(p[key])) throw new Error("长度与数量需要整数");
  if (Number(p.minLength) < 1 || Number(p.maxLength) > 32 || Number(p.minLength) > Number(p.maxLength) || Number(p.count) < 1 || Number(p.count) > 1000) throw new Error("语料长度范围为 1–32，数量为 1–1000");
}

export function materialWeight(m: CorpusMaterial, mode: string, role = "FREE", length?: number) {
  const natural = Math.max(.01, m.statisticalWeight);
  // Original length strata are never pooled. Missing exact-length evidence is neutral.
  const pos = length === undefined ? undefined : m.positionsByLength[String(length)];
  const fit = (!pos || pos.count < 20 || role === "FREE" ? 1 : 0.7 + (pos.roles[role] || 0) / pos.count) * (m.positionTags.includes(role) && role !== "FREE" ? 1.1 : 1);
  const quality = Math.max(.01, m.integrity * m.semanticQuality * (.5 + m.confidence / 2));
  const manual = Math.max(0, m.manualWeight);
  if (mode === "uniform") return 1;
  if (mode === "natural") return natural * manual * fit;
  if (mode === "tail") return manual * quality * fit / Math.sqrt(Math.max(1, m.playerCoverage));
  if (mode === "diverse") return Math.sqrt(natural) * quality * manual * fit;
  return Math.sqrt(natural) * quality * manual * Math.max(.01, m.styleWeight) * fit;
}

function rng(seed: number) {
  let n = seed >>> 0;
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const has = (c: Candidate, tags: string[]) => tags.some(t => c.corpus!.semanticTags.includes(t));

/** Buffered but bounded; existing Worker owns cancellation, ticks, lineage and persistence. */
export async function* generateCorpus(input: AsyncIterable<Candidate>, p: Params, seed: number, tick: () => void, reviewed?: AsyncIterable<Candidate>) {
  validateCorpusParams(p);
  const items: Candidate[] = [];
  let scanned = 0;
  for await (const c of input) {
    tick(); if (++scanned > 10000) throw new Error("语料生成最多读取 10,000 项，请使用独立风格词库");
    const m = c.corpus;
    if (m?.enabled && ["AUTO", "APPROVED"].includes(m.review)) items.push(c);
  }
  if (!items.length) return;
  const random = rng(seed), mode = String(p.mode), min = Number(p.minLength), max = Number(p.maxLength);
  const seen = new Set<string>(), use = new Map<string, number>();
  if (reviewed) {
    const byText = new Map(items.map(c=>[c.text,c]));let relations=0;
    for await(const row of reviewed) {
      tick();if(++relations>10000)throw new Error("语料关系最多读取 10,000 行");
      if(!row.pair)throw new Error("语料关系需要关系词库");
      const a=byText.get(row.pair.left),b=byText.get(row.pair.right),text=row.pair.left+row.pair.right;
      if(!a||!b||seen.has(text)||[...text].length<min||[...text].length>max||seen.size>=Math.floor(Number(p.count)/2))continue;
      const approval=JSON.parse(row.pair.note||"{}") as {review?:string;enabled?:boolean};
      if(approval.review!=="APPROVED"||!approval.enabled)continue;
      seen.add(text);use.set(a.text,(use.get(a.text)||0)+1);use.set(b.text,(use.get(b.text)||0)+1);
      yield {text,parts:[...a.parts,...b.parts,...row.parts],notes:["人工批准的语料组合关系"]};
    }
  }
  const choose = (pool: Candidate[], role: string, size: number) => {
    if (!pool.length) return undefined;
    const weights = pool.map(c => materialWeight(c.corpus!, mode, role, size) / (mode === "diverse" ? 1 + (use.get(c.text) || 0) * 2 : 1));
    const total = weights.reduce((a, b) => a + b, 0); if (total <= 0) return undefined;
    let pick = random() * total;
    return pool[weights.findIndex(w => (pick -= w) < 0)] || pool[pool.length-1];
  };
  const direct = items.filter(c => c.corpus!.length >= min && c.corpus!.length <= max);
  const style = String(p.style);
  const left = items.filter(c => style === "fantasy" ? has(c, ["fantasy"]) : style === "haidu" ? has(c, ["modern"]) : style === "cute" ? has(c, ["modifier", "daily", "food"]) : style === "trend" ? has(c, ["slang", "modifier", "daily"]) : has(c, ["action", "literary", "nature"]));
  const right = items.filter(c => style === "fantasy" ? has(c, ["fantasy"]) : style === "haidu" ? has(c, ["modern"]) : style === "cute" ? has(c, ["animal", "food", "daily"]) : style === "trend" ? has(c, ["animal", "food", "slang", "daily"]) : has(c, ["nature", "literary"]));
  for (let attempt = 0; attempt < Number(p.count) * 60 && seen.size < Number(p.count); attempt++) {
    tick(); const size = min + Math.floor(random() * (max-min+1));
    let parts: Candidate[] = [];
    if (attempt % 3 === 0 && direct.length) {
      const c = choose(direct, "FREE", size); if (c) parts = [c];
    } else {
      const a = choose(left, "FIRST", size);
      if (!a) continue;
      // General combinations need at least one complete multi-character word.
      // Fantasy transliteration and modern haidu roots are explicitly reviewed alphabets.
      const compatible = right.filter(b => a.corpus!.length + b.corpus!.length === size && (style === "haidu" || style === "fantasy" || a.corpus!.length >= 2 || b.corpus!.length >= 2));
      const b = choose(compatible, "LAST", size); if (b) parts = [a, b];
    }
    const text = parts.map(c => c.text).join("");
    if (!text || seen.has(text) || [...text].length < min || [...text].length > max) continue;
    seen.add(text); for (const c of parts) use.set(c.text, (use.get(c.text) || 0) + 1);
    yield { text, parts: parts.flatMap(c => c.parts), notes: ["本地聚合语料 · " + (corpusStyles[style as CorpusStyle] || "跨库组合"), `抽样：${corpusModes[mode as keyof typeof corpusModes]}`] };
  }
}
