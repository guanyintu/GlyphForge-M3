import { corpusStyles } from "./corpus";
import type { CompositionPolicy, CorpusMaterial, CorpusPackage, PositionStats } from "./corpus";

const reviews = ["AUTO", "PENDING", "APPROVED", "REJECTED"];
function object(x: unknown): Record<string, unknown> {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("语料字段需要对象");
  return x as Record<string, unknown>;
}
function text(x: unknown, max = 256): string {
  if (typeof x !== "string" || !x.length || x.length > max) throw new Error("语料文本无效或过长");
  return x;
}
function number(x: unknown, max = Number.MAX_SAFE_INTEGER) {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > max) throw new Error("语料数值无效");
  return x;
}
function count(x: unknown) { const v = number(x); if (!Number.isSafeInteger(v)) throw new Error("统计数量需要整数"); return v; }
function strings(x: unknown) {
  if (!Array.isArray(x) || x.length > 64) throw new Error("标签无效");
  return [...new Set(x.map(s => text(s, 64)))];
}
function counts(x: unknown) { return Object.fromEntries(Object.entries(object(x)).map(([k, v]) => [text(k, 64), count(v)])); }
function bool(x: unknown) { if (typeof x !== "boolean") throw new Error("启用状态无效"); return x; }
function review(x: unknown) { if (!reviews.includes(String(x))) throw new Error("审核状态无效"); return x as CorpusMaterial["review"]; }

export function parseMaterial(value: unknown): CorpusMaterial {
  const m = object(value), positions: Record<string, PositionStats> = {};
  const term = text(m.text, 64), length = count(m.length);
  if (length !== [...term].length || length < 1 || length > 32) throw new Error("素材长度不一致");
  for (const [size, raw] of Object.entries(object(m.positionsByLength))) {
    if (!/^\d+$/.test(size) || Number(size) < length || Number(size) > 1000) throw new Error("来源长度分层无效");
    const p = object(raw);
    positions[size] = { count: count(p.count), roles: counts(p.roles), absolute: counts(p.absolute), relativeDeciles: counts(p.relativeDeciles), preference: text(p.preference, 32), confidence: text(p.confidence, 32), share: number(p.share, 1) };
  }
  return { text: term, length, frequency: count(m.frequency), playerCoverage: count(m.playerCoverage), uniqueNameCount: count(m.uniqueNameCount),
    firstCount: count(m.firstCount), middleCount: count(m.middleCount), lastCount: count(m.lastCount), positionsByLength: positions,
    positionTags: strings(m.positionTags), semanticTags: strings(m.semanticTags), styleTags: strings(m.styleTags), confidence: number(m.confidence, 1),
    enabled: bool(m.enabled), review: review(m.review), level: text(m.level, 32), kinds: strings(m.kinds), sources: counts(m.sources), sourceLengths: counts(m.sourceLengths),
    currentCount: count(m.currentCount), historyCount: count(m.historyCount), integrity: number(m.integrity, 1), semanticQuality: number(m.semanticQuality, 1),
    statisticalWeight: number(m.statisticalWeight, 1e6), manualWeight: number(m.manualWeight, 100), styleWeight: number(m.styleWeight, 100), provenance: text(m.provenance),
    ...(m.compositionRoles === undefined ? {} : {compositionRoles:strings(m.compositionRoles)}),
    ...(m.origin === undefined ? {} : {origin:m.origin === "editorial" ? "editorial" as const : "playertrack" as const}) };
}
export function parseComposition(value: unknown): CompositionPolicy {
  const p=object(value);
  if(p.version!==2||!Array.isArray(p.rules)||p.rules.length>64)throw new Error("配伍规则版本或数量无效");
  const ids=new Set<string>();
  const rules=p.rules.map(raw=>{
    const r=object(raw),id=text(r.id,64),weight=number(r.weight,100);
    if(!Array.isArray(r.slots))throw new Error("配伍槽位需要数组");
    const slots=r.slots.map(slot=>text(slot,64));
    if(ids.has(id)||slots.length<1||slots.length>4||weight<=0)throw new Error("配伍规则重复或槽位无效");
    ids.add(id);return {id,slots,weight};
  });
  return {version:2,rules};
}

export function parseCorpusPackage(value: unknown): CorpusPackage {
  const p = object(value);
  if (p.format !== "glyphforge-playertrack" || p.version !== 1 || !(Object.hasOwn(corpusStyles, String(p.style)) || p.style === "all")) throw new Error("语料包格式或风格无效");
  if (!Array.isArray(p.entries) || p.entries.length > 50000 || !Array.isArray(p.relations) || p.relations.length > 10000) throw new Error("语料包最多 50,000 素材和 10,000 关系");
  const entries = p.entries.map(parseMaterial), seen = new Set(entries.map(m => m.text));
  if (seen.size !== entries.length) throw new Error("语料包有重复素材");
  const minLength = count(p.minLength), maxLength = count(p.maxLength);
  if (minLength < 1 || minLength > maxLength || maxLength > 32) throw new Error("生成长度范围为 1–32");
  const source = object(p.source);
  for (const k of ["databaseSHA256", "boundaryLexiconSHA256"]) if (!/^[a-f0-9]{64}$/.test(String(source[k]))) throw new Error("来源指纹无效");
  const relationKeys = new Set<string>();
  const relations = p.relations.map(raw => {
    const r = object(raw), left = text(r.left, 64), right = text(r.right, 64), type = text(r.type, 32);
    const key = JSON.stringify([left, right]);
    if (!seen.has(left) || !seen.has(right) || relationKeys.has(key)) throw new Error("关系端点缺失或重复");
    relationKeys.add(key);
    return { left, right, type, frequency: count(r.frequency), playerCoverage: count(r.playerCoverage), review: review(r.review), enabled: bool(r.enabled), confidence: number(r.confidence, 1), evidence: text(r.evidence) };
  });
  return { format: "glyphforge-playertrack", version: 1, style: p.style as CorpusPackage["style"], name: text(p.name, 80), enabled: bool(p.enabled), minLength, maxLength, entries, relations,
    ...(p.composition===undefined?{}:{composition:parseComposition(p.composition)}),
    ...(p.qualityVersion===undefined?{}:{qualityVersion:count(p.qualityVersion)}),
    source: { databaseSHA256: String(source.databaseSHA256), boundaryLexiconSHA256: String(source.boundaryLexiconSHA256), deduplicatedPlayerNames: count(source.deduplicatedPlayerNames) } };
}
