import type { Candidate, Params } from "./model";
import type { ResourceMetadataReader } from "./contracts";
import { compositionPolicy, rolesFor } from "./corpus-vocabulary";

export const corpusStyles = { cute: "萌系日常", nature: "自然意象", literary: "清冷文艺", fantasy: "奇幻角色", trend: "趣味潮流", haidu: "海都潮人" };
export type CorpusStyle = keyof typeof corpusStyles;
export type Review = "AUTO" | "PENDING" | "APPROVED" | "REJECTED";
export interface PositionStats {
  count: number; roles: Record<string, number>; absolute: Record<string, number>; relativeDeciles: Record<string, number>;
  preference: string; confidence: string; share: number;
}
export interface CorpusMaterial {
  compositionRoles?: string[];
  origin?: "playertrack" | "editorial";
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
  qualityVersion?: number;
  composition?: CompositionPolicy;
  style: CorpusStyle | "all"; enabled: boolean; minLength: number; maxLength: number;
  source: { databaseSHA256: string; boundaryLexiconSHA256: string; deduplicatedPlayerNames: number };
}
export interface CompositionPolicy { version: 2; rules: { id: string; slots: string[]; weight: number }[] }
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

/** Buffered but bounded; existing Worker owns cancellation, ticks, lineage and persistence. */
export async function* generateCorpus(input: AsyncIterable<Candidate>, p: Params, seed: number, tick: () => void, reviewed?: AsyncIterable<Candidate>, metadata?: ResourceMetadataReader) {
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
  const style=String(p.style) as CorpusStyle | "all";
  let policy = compositionPolicy(style === "all" ? "nature" : style);
  if (metadata) for (const part of items[0].parts) {
    const resource=await metadata(part.resourceId);
    if (resource?.corpus?.composition) { policy=resource.corpus.composition; break; }
  }
  const byRole=new Map<string,Candidate[]>();
  for(const item of items) {
    const m=item.corpus!,roles=m.compositionRoles ?? rolesFor(style === "all" ? "nature" : style,item.text);
    for(const role of new Set([...roles,...(m.review==="APPROVED"&&m.length>=2?["whole"]:[])])) {
      if(!byRole.has(role))byRole.set(role,[]);byRole.get(role)!.push(item);
    }
  }
  type Choice={text:string;parts:Candidate[];rank:number};
  const pools:{id:string;weight:number;items:Choice[]}[]=[];let combinations=0;
  for(const rule of policy.rules) {
    const pool:Choice[]=[];
    function expand(parts:Candidate[],slot:number) {
      tick();
      if(slot<rule.slots.length) {
        for(const next of byRole.get(rule.slots[slot])||[]) {
          if(parts.reduce((n,c)=>n+c.corpus!.length,0)+next.corpus!.length<=max)expand([...parts,next],slot+1);
        }
        return;
      }
      const text=parts.map(c=>c.text).join(""),length=[...text].length;
      if(length<min||length>max)return;
      // Repeated stems and overlapping morphemes are not a naming recipe.
      // Deliberate AA words belong in the standalone vocabulary.
      if(parts.length>1&&parts.some((c,i)=>parts.slice(0,i).some(other=>[...c.text].some(ch=>other.text.includes(ch)))))return;
      if(++combinations>10000)throw new Error("语义配伍超过 10,000 项，请缩小词库或配伍规则");
      const weight=Math.exp(parts.reduce((sum,c,i)=>sum+Math.log(Math.max(1e-9,materialWeight(c.corpus!,mode,i===0?"FIRST":i===parts.length-1?"LAST":"MIDDLE",length))),0)/parts.length);
      if(weight<=1e-8)return;
      pool.push({text,parts,rank:-Math.log(Math.max(random(),1e-12))/weight});
    }
    expand([],0);pool.sort((a,b)=>a.rank-b.rank||a.text.localeCompare(b.text));
    if(pool.length)pools.push({id:rule.id,weight:rule.weight,items:pool});
  }
  while(seen.size<Number(p.count)) {
    tick();const active=pools.filter(pool=>pool.items.length);
    if(!active.length)break;
    let pick=random()*active.reduce((n,pool)=>n+pool.weight,0);
    const pool=active.find(pool=>(pick-=pool.weight)<0)||active[active.length-1];
    let index=0;
    if(mode==="diverse") {
      let best=Infinity;
      for(let i=0;i<Math.min(24,pool.items.length);i++) {
        const candidate=pool.items[i],rank=candidate.rank*(1+candidate.parts.reduce((n,c)=>n+(use.get(c.text)||0)*3,0));
        if(rank<best){best=rank;index=i;}
      }
    }
    const [candidate]=pool.items.splice(index,1);
    if(seen.has(candidate.text))continue;
    seen.add(candidate.text);for(const part of candidate.parts)use.set(part.text,(use.get(part.text)||0)+1);
    yield {text:candidate.text,parts:candidate.parts.flatMap(c=>c.parts),notes:[`配伍 v2：${pool.id}`,`抽样：${corpusModes[mode as keyof typeof corpusModes]}`]};
  }
}
