import { resolveMapping } from "./mapping-resource";
import type { Candidate, Params, Workflow } from "./model";
import { candidateText, operators } from "./model";
import type { GameRule } from "./game-rules";
import { glyphs } from "./unicode";
import type { OperatorContext } from "./operators";
import { boundedText, ContractError, uniqueParts } from "./contracts";

export const mutationOperations = { replace: "替换字符", insert: "插入字符", delete: "删除字符", affix: "前后缀", dictionary: "词库替换", reorder: "调整词序", homophone: "谐音替换", martian: "火星文" };
export type MutationOperation = keyof typeof mutationOperations;
export const mutationDefaults = operators.mutate.defaults;
export interface Derivation {
  kind: "mutation"; version: 1; round: number; seed: number;
  parent: { text: string; runId?: string; workflowId?: string; seed?: number };
  operations: string[]; locks: number[];
}
type Token = { text: string; locked: boolean };
const wordsSegmenter = new Intl.Segmenter("zh", { granularity: "word" });
function wordGroups(tokens: Token[]) {
  let offset = 0;
  return Array.from(wordsSegmenter.segment(tokens.map(t => t.text).join("")), s => {
    const size = glyphs(s.segment).length, start = offset; offset += size;
    return { tokens: tokens.slice(start, offset), word: !!s.isWordLike, start };
  });
}
export function mutationConfig(p: Params) {
  const source: Candidate = JSON.parse(String(p.source)), locks: number[] = JSON.parse(String(p.locks)), operations: MutationOperation[] = JSON.parse(String(p.operations));
  if (!source || typeof source.text !== "string" || !source.text || source.text.length > 1024 || glyphs(source.text).length > 100 || !Array.isArray(source.parts) || source.parts.length > 128 || source.parts.some(x => !x || typeof x.text !== "string" || x.text.length > 1024 || typeof x.resourceId !== "string")) throw new Error("变异输入需为 1–100 个字符簇、最多128来源片段");
  if (source.derivation && (source.derivation.kind !== "mutation" || source.derivation.version !== 1 || !Number.isInteger(source.derivation.round) || source.derivation.round < 1 || source.derivation.round > 1000000)) throw new Error("衍生版本或轮数无效");
  if (!Array.isArray(locks) || locks.length > 100 || locks.some(i => !Number.isInteger(i) || i < 0 || i >= glyphs(source.text).length) || new Set(locks).size !== locks.length) throw new Error("锁定位置无效");
  if (!Array.isArray(operations) || !operations.length || operations.length > 8 || operations.some(op => !Object.hasOwn(mutationOperations, op)) || new Set(operations).size !== operations.length) throw new Error("请选择有效的变异操作");
  if (![1, 2, 3].includes(Number(p.intensity)) || !Number.isInteger(p.count) || Number(p.count) < 1 || Number(p.count) > 256 || p.algorithm !== 1) throw new Error("变异强度为1–3、数量为1–256、算法版本为1");
  if (!String(p.pool) || operations.includes("dictionary") && !String(p.resourceId)) throw new Error("字符池或替换词库缺失");
  return { source, locks, operations };
}
/** Retain bounded factual fragments and a parent link; never recursively copy history. */
export function mutationSource(c: Candidate): Candidate {
  if (c.parts.length > 128) throw new Error("输入来源超过128片段，请先存为词库");
  return { text: c.text, parts: c.parts, ...(c.runId ? { runId: c.runId } : {}), ...(c.workflowId ? { workflowId: c.workflowId } : {}), ...(c.seed !== undefined ? { seed: c.seed } : {}), ...(c.derivation ? { derivation: c.derivation } : {}) };
}
export function mutationWorkflow(source: Candidate, settings: Params, seed: number, game?: { rule: GameRule; mode: "filter" | "annotate" }): Workflow {
  return { version: 1, id: crypto.randomUUID(), name: `名字变异 · ${source.text.slice(0, 30)}`, seed, limit: Number(settings.count ?? 64), layout: { mutation: { x: 50, y: 100 }, result: { x: 380, y: 100 } }, nodes: [
    { id: "mutation", op: "mutate", inputs: [], params: { ...mutationDefaults, ...settings, source: JSON.stringify(mutationSource(source)) } },
    ...(game ? [{ id: "game", op: "gamecheck" as const, inputs: ["mutation"], params: { rules: JSON.stringify(game.rule), mode: game.mode } }] : []),
    { id: "result", op: "output", inputs: [game ? "game" : "mutation"], params: {} },
  ] };
}
export async function* mutate(c: OperatorContext): AsyncGenerator<Candidate> {
  const p = c.node.params, { source, locks, operations } = mutationConfig(p);
  // Source metadata is copied once, without inherited run identity or recursive trees.
  const base: Candidate = { text: source.text, parts: uniqueParts(source.parts), notes: ["名字变异衍生；原片段只说明素材来源，不证明旧工作流生成此文本"] };
  const words: Candidate[] = []; let buffered = 0;
  if (operations.includes("dictionary")) for await (const word of c.read(String(p.resourceId), c.seed)) {
    c.tick(); if (word.pair) throw new ContractError({ code: "TYPE", message: "词库替换需要普通词库" });
    buffered += word.text.length;
    if (buffered > 65536) throw new ContractError({ code: "BUDGET", message: "替换词库缓冲超过65536代码单元" });
    words.push(word); if (words.length >= 256) break;
  }
  let state = c.seed >>> 0;
  const random = (n: number) => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) % n; };
  const pool = glyphs(String(p.pool));
  const resolvedMapping = await resolveMapping(p, c.resourceMetadata);
  if(resolvedMapping.resource) base.parts=uniqueParts([...base.parts,{resourceId:String(p.mappingId),version:resolvedMapping.resource.version,text:source.text}]);
  const chineseCache = new Map<string, string[]>();
  async function alternatives(op: "homophone" | "martian", text: string) {
    const key = op + text; if (chineseCache.has(key)) return chineseCache.get(key)!;
    const options: string[] = [];
    if (/^\p{Unified_Ideograph}$/u.test(text)) {
      const { transformChinese } = await import("./chinese");
      for await (const x of transformChinese(op === "homophone" ? "homophones" : resolvedMapping.resource ? "mapchars" : "hanconvert", { text, parts: [] }, op === "homophone" ? { matchTone: true, limit: 32 } : { ...resolvedMapping.params, mode: "martian", probability: 1, limit: 32 }, c.seed, c.tick)) { c.tick(); if (x.text !== text) options.push(x.text); }
    }
    if (chineseCache.size >= 128) chineseCache.delete(chineseCache.keys().next().value!);
    chineseCache.set(key, options); return options;
  }
  const seen = new Set([source.text]); let count = 0;
  // Bounded retries also bound zero-result/all-locked/low-diversity requests.
  for (let attempt = 0; attempt < Number(p.count) * 32 && count < Number(p.count); attempt++) {
    c.tick(); let tokens = glyphs(source.text).map((text, i) => ({ text, locked: locks.includes(i) }));
    const used: string[] = []; const parts = [...base.parts];
    for (let step = 0; step < Number(p.intensity); step++) {
      c.tick(); const op = operations[random(operations.length)];
      const free = tokens.flatMap((t, i) => t.locked ? [] : [i]);
      const index = free.length ? free[random(free.length)] : -1;
      if (op === "affix") {
        const before = random(2) === 0, choices = String(before ? p.prefix : p.suffix).split("|").filter(Boolean);
        if (!choices.length) continue;
        const added = glyphs(choices[random(choices.length)]).map(text => ({ text, locked: false }));
        if (before) tokens.unshift(...added); else tokens.push(...added);
      } else if (op === "insert") tokens.splice(random(tokens.length + 1), 0, { text: pool[random(pool.length)], locked: false });
      else if (index < 0) continue;
      else if (op === "delete") tokens.splice(index, 1);
      else if (op === "reorder") {
        const groups = wordGroups(tokens), movable = groups.flatMap((g, i) => g.word && !g.tokens.some(t => t.locked) ? [i] : []);
        if (movable.length < 2) continue;
        const a = movable[random(movable.length)], b = movable[random(movable.length)];
        [groups[a], groups[b]] = [groups[b], groups[a]]; tokens = groups.flatMap(g => g.tokens);
      }
      else if (op === "dictionary") {
        const groups = wordGroups(tokens).filter(g => g.word && !g.tokens.some(t => t.locked));
        if (!words.length || !groups.length) continue; const word = words[random(words.length)], group = groups[random(groups.length)];
        tokens.splice(group.start, group.tokens.length, ...glyphs(word.text).map(text => ({ text, locked: false })));
        parts.push(...word.parts);
      } else {
        const options = op === "replace" ? pool : await alternatives(op, tokens[index].text);
        if (!options.length) continue;
        tokens.splice(index, 1, ...glyphs(options[random(options.length)]).map(text => ({ text, locked: false })));
      }
      used.push(op);
    }
    const text = tokens.map(t => t.text).join("");
    // Reject boundary merging (combining marks/ZWJ), so a locked cluster stays intact.
    const segmented = glyphs(text);
    if (!text || text.length > 1024 || segmented.length > 100 || segmented.length !== tokens.length || segmented.some((s, i) => s !== tokens[i].text) || seen.has(text)) continue;
    seen.add(text); count++;
    const finalParts = uniqueParts(parts);
    if (finalParts.length > 128) throw new ContractError({ code: "BUDGET", message: "变异来源超过128片段，请先存为词库" });
    yield { ...candidateText(base, boundedText(text)), parts: finalParts, derivation: { kind: "mutation", version: 1, round: Math.min(1000000, (source.derivation?.round ?? 0) + 1), seed: c.seed, parent: { text: source.text, runId: source.runId, workflowId: source.workflowId, seed: source.seed }, operations: used, locks: tokens.flatMap((t, i) => t.locked ? [i] : []) } };
  }
}
