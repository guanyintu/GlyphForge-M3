import catalog from "../../data/playertrack/composition.json";
import type { CompositionPolicy, CorpusMaterial, CorpusPackage, CorpusStyle } from "./corpus";

export function compositionPolicy(style: CorpusStyle): CompositionPolicy {
  return { version: 2, rules: catalog.styles[style].rules };
}
export function rolesFor(style: CorpusStyle, text: string): string[] {
  return Object.entries(catalog.styles[style].roles).filter(([, words]) => words.includes(text)).map(([role]) => role);
}
export function editorialMaterial(style: CorpusStyle, text: string): CorpusMaterial {
  return { text, length: [...text].length, frequency: 0, playerCoverage: 0, uniqueNameCount: 0, firstCount: 0, middleCount: 0, lastCount: 0,
    positionsByLength: {}, positionTags: ["FREE"], semanticTags: ["editorial"], styleTags: [style], confidence: 0,
    enabled: true, review: "AUTO", level: "SPECIAL", kinds: ["editorial"], sources: {}, sourceLengths: {}, currentCount: 0, historyCount: 0,
    integrity: 1, semanticQuality: .95, statisticalWeight: 1, manualWeight: 1, styleWeight: 1,
    provenance: "GlyphForge 配伍 v2 编辑补充；PlayerTrack 观察频次为 0", origin: "editorial", compositionRoles: rolesFor(style, text) };
}
export function preparedCorpus(p: CorpusPackage): CorpusPackage {
  if (p.style === "all") return p;
  const style=p.style, seen=new Set(p.entries.map(m=>m.text));
  const entries=p.entries.map(m=>{
    const roles=rolesFor(style,m.text);
    return roles.length && m.compositionRoles===undefined ? {...m,compositionRoles:roles} : m;
  });
  for (const text of new Set(Object.values(catalog.styles[style].roles).flat())) if (!seen.has(text)) entries.push(editorialMaterial(style,text));
  return {...p,entries,qualityVersion:2,composition:compositionPolicy(style)};
}
