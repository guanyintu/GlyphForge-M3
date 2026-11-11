import type { CorpusMaterial, CorpusPackage, CorpusRelation, CorpusStyle, Review } from "../core/corpus";
import { corpusStyles } from "../core/corpus";
import { parseCorpusPackage, parseMaterial } from "../core/corpus-package";
import type { Resource, Workflow } from "../core/model";
import { db } from "./db";
import { corpusPresetMarker, matchesCorpusPreset } from "../core/corpus-presets";
import { preparedCorpus, rolesFor, compositionPolicy, editorialMaterial } from "../core/corpus-vocabulary";
import composition from "../../data/playertrack/composition.json";

export const corpusId = (style: string) => `playertrack-v1-${style}`;
const opening = new Map<CorpusStyle, Promise<Workflow>>();
/** Open a shipped workflow once; existing names, edits, resources and seeds win. */
export function openCorpusPreset(style: CorpusStyle): Promise<Workflow> {
  const pending = opening.get(style); if (pending) return pending;
  const task = (async () => {
    const existing = (await db.workflows.toArray()).find(w => matchesCorpusPreset(w, style));
    if (existing) { await upgradeCorpusQuality(); return existing; }
    const bundle = await loadBundled(style);
    return db.transaction("rw", db.resources, db.entries, db.relations, db.workflows, async () => {
      const concurrent = (await db.workflows.toArray()).find(w => matchesCorpusPreset(w, style));
      if (concurrent) return concurrent;
      const id = await installCorpus(bundle), workflow = await corpusWorkflow(id);
      workflow.comments = [...(workflow.comments || []), corpusPresetMarker(style)];
      await db.workflows.add(workflow);
      return workflow;
    });
  })().finally(() => { opening.delete(style); });
  opening.set(style, task); return task;
}
export async function loadBundled(style: CorpusStyle): Promise<CorpusPackage> {
  const files = import.meta.glob(["../../data/playertrack/cute.json", "../../data/playertrack/nature.json", "../../data/playertrack/literary.json", "../../data/playertrack/fantasy.json", "../../data/playertrack/trend.json", "../../data/playertrack/haidu.json"]);
  const load = files[`../../data/playertrack/${style}.json`];
  if (!load) throw new Error("未找到本地风格素材");
  return preparedCorpus(parseCorpusPackage((await load() as { default: unknown }).default));
}

/** Content-addressed additions only. A repeated import never overwrites local review/edit decisions. */
export async function installCorpus(value: unknown) {
  const p = parseCorpusPackage(value), id = corpusId(p.style), relationId = `${id}-relations`;
  return db.transaction("rw", db.resources, db.entries, db.relations, async () => {
    const previous = await db.resources.get(id);
    if (previous && (!previous.corpus || previous.corpus.style !== p.style)) throw new Error("资源 ID 冲突，未覆盖任何数据");
    const existing = new Set((await db.entries.where({ resourceId: id }).toArray()).map(e => e.text));
    const additions = p.entries.filter(e => !existing.has(e.text));
    const meta: Resource = previous || { id, name: `FF14 · ${p.name}`, description: "PlayerTrack 本地聚合与明确标记的编辑补充；频次不伪造。", kind: "word", color: "green", count: 0, version: 1, updatedAt: Date.now(), corpus: { style: p.style, enabled: p.enabled, minLength: p.minLength, maxLength: p.maxLength, source: p.source,...(p.composition?{composition:p.composition,qualityVersion:p.qualityVersion}: {}) } };
    await db.resources.put({ ...meta, count: existing.size+additions.length, version: previous && additions.length ? meta.version+1 : meta.version, updatedAt: additions.length ? Date.now() : meta.updatedAt });
    for (let i=0; i<additions.length; i+=500) await db.entries.bulkAdd(additions.slice(i,i+500).map(corpus => ({ resourceId: id, text: corpus.text, corpus })));
    const oldRelations = await db.relations.where({ resourceId: relationId }).toArray();
    const keys = new Set(oldRelations.map(r => JSON.stringify([r.left, r.right])));
    const rows = p.relations.filter(r => !keys.has(JSON.stringify([r.left, r.right]))).map(r => ({ resourceId: relationId, left: r.left, right: r.right, relation: "associated" as const, direction: "directed" as const, reverseQueryable: false, tags: [r.type, `审核:${r.review}`], note: JSON.stringify(r), source: "PlayerTrack aggregated local snapshot" }));
    if (rows.length) await db.relations.bulkAdd(rows);
    const relationMeta = await db.resources.get(relationId);
    if (!relationMeta) await db.resources.add({ id: relationId, name: `FF14 · ${p.name} · 关系审核`, description: "相邻语义边界候选；关系类型为启发式，默认待审核。", kind: "relation", color: "blue", count: rows.length, version: 1, updatedAt: Date.now() });
    else if (rows.length) await db.resources.update(relationId, { count: oldRelations.length+rows.length, version: relationMeta.version+1, updatedAt: Date.now() });
    return id;
  });
}
/** Add role annotations and editorial vocabulary once; preserve user fields and every old row. */
export async function upgradeCorpusQuality() {
  await db.transaction("rw",db.resources,db.entries,async()=>{
    const resources=await db.resources.toArray();
    for(const r of resources) {
      const style=r.corpus?.style;
      if(!style||style==="all"||!Object.hasOwn(composition.styles,style)||(Number(r.corpus?.qualityVersion||0)>=2&&r.corpus?.composition?.version===2))continue;
      const entries=await db.entries.where({resourceId:r.id}).toArray(),seen=new Set(entries.map(e=>e.text));
      for(const e of entries) {
        const roles=rolesFor(style,e.text);
        if(e.corpus&&e.corpus.compositionRoles===undefined&&roles.length)await db.entries.update(e.id!,{corpus:{...e.corpus,compositionRoles:roles}});
      }
      const additions=[...new Set(Object.values(composition.styles[style].roles).flat())].filter(text=>!seen.has(text));
      if(additions.length)await db.entries.bulkAdd(additions.map(text=>({resourceId:r.id,text,corpus:editorialMaterial(style,text)})));
      await db.resources.update(r.id,{corpus:{...r.corpus!,qualityVersion:2,composition:compositionPolicy(style)},count:entries.length+additions.length,version:r.version+1,updatedAt:Date.now()});
    }
  });
}

export async function exportCorpus(id: string): Promise<CorpusPackage> {
  return db.transaction("r", db.resources, db.entries, db.relations, async () => {
    const resource = await db.resources.get(id);
    if (!resource?.corpus) throw new Error("请选择 FF14 词库");
    const entries = (await db.entries.where({resourceId:id}).toArray()).flatMap(e => e.corpus ? [e.corpus] : []);
    const relations = (await db.relations.where({resourceId:`${id}-relations`}).toArray()).map(r => JSON.parse(r.note || "{}"));
    return parseCorpusPackage({ format: "glyphforge-playertrack", version: 1, name: resource.name.replace(/^FF14 · /, ""), ...resource.corpus, entries, relations });
  });
}

export async function updateMaterials(id: string, changes: { text: string; patch: Partial<CorpusMaterial> }[]) {
  if (changes.length > 500) throw new Error("一次最多审核 500 项");
  await db.transaction("rw", db.entries, db.resources, async () => {
    const r = await db.resources.get(id); if (!r?.corpus) throw new Error("语料词库已删除");
    for (const { text, patch } of changes) {
      const e = await db.entries.where("[resourceId+text]").equals([id, text]).first();
      if (!e?.corpus) throw new Error("素材已被删除，请刷新");
      const corpus = parseMaterial({ ...e.corpus, ...patch, text, length: e.corpus.length });
      await db.entries.update(e.id!, { corpus });
    }
    await db.resources.update(id, {version:r.version+1, updatedAt:Date.now()});
  });
}
export async function reviewMaterials(id: string, texts: string[], review: Review) {
  return updateMaterials(id, texts.map(text => ({ text, patch: { review, enabled: review === "APPROVED" || review === "AUTO" } })));
}
export async function updateCorpusRelation(id: string, left: string, right: string, patch: Partial<CorpusRelation>) {
  await db.transaction("rw",db.resources,db.entries,db.relations,async()=>{
    const meta=await db.resources.get(id),relMeta=await db.resources.get(`${id}-relations`);
    if(!meta?.corpus||!relMeta)throw new Error("词库或关系已删除");
    const row=await db.relations.where({resourceId:relMeta.id}).filter(r=>r.left===left&&r.right===right).first();
    if(!row)throw new Error("关系已删除");
    const endpoints=await Promise.all([...new Set([left,right])].map(text=>db.entries.where('[resourceId+text]').equals([id,text]).first()));
    const p=parseCorpusPackage({format:"glyphforge-playertrack",version:1,name:meta.name,...meta.corpus,entries:endpoints.map(e=>e?.corpus),relations:[{...JSON.parse(row.note!),...patch,left,right}]});
    const next=p.relations[0];
    await db.relations.update(row.id!,{note:JSON.stringify(next),tags:[next.type,`审核:${next.review}`]});
    await db.resources.update(relMeta.id,{version:relMeta.version+1,updatedAt:Date.now()});
  });
}
export async function configureCorpus(id: string, patch: Partial<Pick<NonNullable<Resource["corpus"]>, "enabled" | "minLength" | "maxLength">>) {
  await db.transaction("rw", db.resources, async () => {
    const r = await db.resources.get(id); if (!r?.corpus) throw new Error("词库已删除");
    const corpus = { ...r.corpus, ...patch };
    if (corpus.minLength < 1 || corpus.maxLength > 32 || corpus.minLength > corpus.maxLength) throw new Error("长度范围为 1–32");
    await db.resources.update(id, {corpus, version:r.version+1, updatedAt:Date.now()});
  });
}
export async function corpusWorkflow(id: string, mode = "style", minLength?: number, maxLength?: number): Promise<Workflow> {
  const r = await db.resources.get(id); if (!r?.corpus) throw new Error("请先安装词库");
  return {version:1, id:crypto.randomUUID(), name:`FF14 · ${corpusStyles[r.corpus.style as CorpusStyle] || "基础素材"}`, seed:42,limit:75,
    comments:["// glyphforge:playertrack:v1", "// 词库独立编辑；AUTO 为规则分类，PENDING/REJECTED 不参与生成。"],
    layout:{source:{x:20,y:100},style:{x:320,y:100},result:{x:620,y:100}},nodes:[
      {id:"source",op:"resource",inputs:[],params:{resourceId:id}},
      {id:"style",op:"corpus",inputs:["source"],params:{style:r.corpus.style,mode,minLength:minLength??r.corpus.minLength,maxLength:maxLength??r.corpus.maxLength,count:75,reviewedResourceId:`${id}-relations`}},
      {id:"result",op:"output",inputs:["style"],params:{}}
    ]};
}

export async function installBaseCorpus() {
  const [characters,bigrams,trigrams,phrases,relations,report] = await Promise.all([
    import("../../data/playertrack/characters.json"),import("../../data/playertrack/bigrams.json"),import("../../data/playertrack/trigrams.json"),import("../../data/playertrack/phrases.json"),import("../../data/playertrack/relations.json"),import("../../data/playertrack/report.json")
  ]);
  return installCorpus({format:"glyphforge-playertrack",version:1,style:"all",name:"基础素材",enabled:true,minLength:2,maxLength:6,
    entries:[...characters.default,...bigrams.default,...trigrams.default,...phrases.default],relations:relations.default,
    source:{databaseSHA256:report.default.databaseSHA256,boundaryLexiconSHA256:report.default.boundaryLexiconSHA256,deduplicatedPlayerNames:report.default.deduplicatedPlayerNames}});
}
