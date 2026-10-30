import { glyphs } from "./model";
import type { Candidate, Params } from "./model";
import { parseCharacterMap, validateChineseParams } from "./chinese-definitions";
import type { ChineseOp } from "./chinese-definitions";

// Only this small adapter is loaded with the registry. Dictionaries have separate lazy chunks.
let phonetics: Promise<typeof import("pinyin-pro")> | undefined;
const loadPinyin = () => phonetics ||= import("pinyin-pro");
type Decomposition = Record<string, [string, string[]][]>;
let structures: Promise<Decomposition> | undefined;
const loadStructures = (): Promise<Decomposition> => structures ||= import("../data/chinese/decomposition.json").then(m => m.default as unknown as Decomposition);
let strokes: Promise<Record<string, number[]>> | undefined;
const loadStrokes = (): Promise<Record<string, number[]>> => strokes ||= import("../data/chinese/strokes.json").then(m => m.default);
let s2t: Promise<(s: string) => string> | undefined, t2s: Promise<(s: string) => string> | undefined;
const martian: Record<string, string[]> = {
  我: ["莪", "涐"], 你: ["伱", "鉨"], 的: ["啲", "嘚"], 是: ["昰", "媞"], 爱: ["嗳", "僾"],
  月: ["玥", "鈅"], 星: ["煋", "☆"], 火: ["吙", "焱"], 心: ["吢", "鈊"], 明: ["眀", "朙"],
  天: ["兲", "迗"], 地: ["哋", "埊"], 人: ["亽", "仒"], 小: ["尐", "仦"], 梦: ["夢", "儚"],
  风: ["風", "颩"], 云: ["雲", "妘"], 海: ["塰", "烸"], 花: ["婲", "埖"], 好: ["恏", "孬"],
};
const displayPart = (s: string) => /^\d+$/.test(s) ? `〔未编码部件 #${s}〕` : s;
export function structureKind(code: string) {
  const base = code.split("/")[0];
  return base === "a" || /^r\d?a$/.test(base) ? "left-right" : base === "d" || /^r\d?d$/.test(base) ? "top-bottom" : /^s/.test(base) ? "enclosure" : "other";
}
function expandedParts(code: string, parts: string[]) {
  // The source stores 林 as ra(木), 森 as r3tr(木), not literal repeated arrays.
  const base = code.split("/")[0];
  const count = base === "ra" || base === "rd" ? 2 : /^r[2-9](?:a|d|tr|sq|gw)$/.test(base) ? Number(base[1]) : 1;
  return parts.length === 1 && count > 1 ? Array.from({ length: count }, () => parts[0]) : parts;
}
const structureNames: Record<string, string> = { "left-right": "左右", "top-bottom": "上下", enclosure: "包围", other: "其他" };

function chance(seed: number, text: string, index: number) {
  let n = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  for (const c of text) n = Math.imul(n ^ c.codePointAt(0)!, 16777619) >>> 0;
  n ^= n >>> 16; n = Math.imul(n, 0x7feb352d); n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}
function* combinations(choices: string[][], separator: string, limit: number, tick: () => void) {
  // O(input length + limit * input length), never materialize the Cartesian product.
  const indexes = choices.map(() => 0);
  for (let count = 0; count < limit; count++) {
    tick();
    const text = choices.map((list, i) => list[indexes[i]]).join(separator);
    if (text.length > 1024) throw new Error("转换后文字超过 1024 个代码单元");
    yield text;
    let pos = indexes.length - 1;
    while (pos >= 0 && ++indexes[pos] >= choices[pos].length) { indexes[pos] = 0; pos--; }
    if (pos < 0) break;
  }
}
function mapped(text: string, map: Record<string, string[]>, probability: number, limit: number, seed: number, tick: () => void) {
  return combinations(glyphs(text).map((c, i) => Object.hasOwn(map, c) && chance(seed, text, i) < probability ? [...new Set(map[c])] : [c]), "", limit, tick);
}

// Resolve numbered intermediate parts without pretending they are Unicode characters.
function leaves(data: Decomposition, char: string, depth: number, tick: () => void, path = new Set<string>(), rootRecords?: [string, string[]][]): string[][] {
  tick();
  if (depth <= 0 || path.has(char)) return [[char]];
  const records = rootRecords || data[char];
  if (!records?.length || records.every(([, parts]) => !parts.length)) return [[char]];
  const next = new Set(path).add(char);
  const result: string[][] = [];
  for (const [code, rawParts] of records) {
    const parts = expandedParts(code, rawParts);
    if (!parts.length) continue;
    let paths: string[][] = [[]];
    for (const part of parts) {
      const options = leaves(data, part, depth - 1, tick, next);
      paths = paths.flatMap(a => options.map(b => [...a, ...b])).slice(0, 32);
    }
    result.push(...paths);
    if (result.length >= 32) break;
  }
  return result.slice(0, 32);
}

type ComponentIndex = { data: Decomposition; byPart: Map<string, Set<string>> };
const componentIndexes = new Map<boolean, Promise<ComponentIndex>>();
function loadComponentIndex(deep: boolean, tick: () => void) {
  let cached = componentIndexes.get(deep);
  if (!cached) {
    cached = (async () => {
      const data = await loadStructures();
      const byPart = new Map<string, Set<string>>();
      for (const [char, records] of Object.entries(data)) {
        tick();
        if (!/^\p{Unified_Ideograph}$/u.test(char)) continue;
        // Index every descendant to support intermediate and leaf component searches.
        const parts = new Set<string>();
        function collect(key: string, depth: number, path: Set<string>) {
          if (depth === 0 || path.has(key)) return;
          const next = new Set(path).add(key);
          for (const [, children] of data[key] || []) for (const part of children) {
            parts.add(part);
            if (deep) collect(part, depth - 1, next);
          }
        }
        if (records.length) collect(char, deep ? 6 : 1, new Set());
        for (const part of parts) {
          if (!byPart.has(part)) byPart.set(part, new Set());
          byPart.get(part)!.add(char);
        }
      }
      return { data, byPart };
    })();
    componentIndexes.set(deep, cached);
    // Cancellation/limit failures must not poison a cache permanently.
    void cached.catch(() => componentIndexes.delete(deep));
  }
  return cached;
}

const stripTone = (s: string) => s.normalize("NFD").replace(/[\u0300\u0301\u0304\u030c]/g, "").normalize("NFC").toLowerCase();
let readingIndex: Promise<{ toned: Map<string, string[]>; plain: Map<string, string[]> }> | undefined;
function loadReadingIndex(tick: () => void) {
  if (!readingIndex) {
    readingIndex = import("../data/chinese/readings.json").then(({ default: data }) => {
      const toned = new Map<string, string[]>(), plain = new Map<string, string[]>();
      for (const [char, readings] of Object.entries(data)) {
        tick();
        for (const reading of readings) for (const [index, key] of [[toned, reading], [plain, stripTone(reading)]] as const) {
          const items = index.get(key) || [];
          if (!items.includes(char)) items.push(char);
          index.set(key, items);
        }
      }
      return { toned, plain };
    });
    void readingIndex.catch(() => { readingIndex = undefined; });
  }
  return readingIndex;
}

export async function* transformChinese(op: ChineseOp, item: Candidate, p: Params, seed: number, tick: () => void): AsyncGenerator<Candidate> {
  validateChineseParams(op, p);
  tick();
  const emit = (text: string, ...notes: string[]): Candidate => ({ ...item, text, notes: [...(item.notes || []), ...notes] });
  const limit = Number(p.limit || 32);
  if (op === "pinyin") {
    const { pinyin, polyphonic } = await loadPinyin();
    const toneType = p.tone as "symbol" | "num" | "none";
    if (p.mode === "polyphonic") {
      const choices = polyphonic(item.text, { type: "array", toneType });
      for (const text of combinations(choices, String(p.separator), limit, tick))
        yield emit(text, `逐字读音组合，不保证语境正确；每条最多 ${limit} 个候选`);
    } else {
      const pattern = p.mode === "tone" ? "num" : p.mode as "pinyin" | "first" | "initial" | "final";
      const values = pinyin(item.text, { type: "array", pattern, toneType: p.mode === "first" ? "none" : toneType, initialPattern: "standard", toneSandhi: false });
      yield emit(values.map(v => v || "∅").join(String(p.separator)), "按上下文选择读音；生僻字缺少读音时保留原字，轻声为 0");
    }
    return;
  }
  if (op === "homophones") {
    if (Array.from(item.text).length !== 1 || !/^\p{Unified_Ideograph}$/u.test(item.text)) throw new Error("同音字查询每条输入需为一个汉字");
    const { polyphonic } = await loadPinyin();
    const readings = polyphonic(item.text, { type: "array", toneType: "symbol" })[0] || [];
    const index = await loadReadingIndex(tick);
    const found = new Set<string>();
    for (const reading of readings) {
      const matches = p.matchTone ? index.toned.get(reading) : index.plain.get(stripTone(reading));
      for (const char of matches || []) {
        tick();
        if (found.has(char)) continue;
        found.add(char);
        yield emit(char, `Unihan 普通话候选读音匹配：${reading}；非穷尽字典`);
        if (found.size >= limit) return;
      }
    }
    return;
  }
  if (op === "rhyme") {
    const { pinyin } = await loadPinyin();
    const last = (s: string) => {
      const han = glyphs(s).filter(c => /^\p{Unified_Ideograph}$/u.test(c));
      if (!han.length) return undefined;
      const data = pinyin(s, { type: "all", toneType: "none", initialPattern: "standard", toneSandhi: false }).filter(x => x.isZh).at(-1);
      return data ? `${data.final}${p.matchTone ? data.num : ""}` : undefined;
    };
    const reference = last(String(p.reference));
    if (!reference) throw new Error("押韵参照词缺少可识别的汉字读音");
    if (last(item.text) === reference) yield emit(item.text, "词尾现代普通话韵母严格匹配；不等同古诗词韵部");
    return;
  }
  if (op === "mapchars" || (op === "hanconvert" && p.mode === "martian")) {
    const map = op === "mapchars" ? parseCharacterMap(String(p.mapping)) : martian;
    for (const text of mapped(item.text, map, Number(p.probability), limit, seed, tick))
      yield emit(text, `趣味字形替换，不保证同义同音；每条最多 ${limit} 个候选`);
    return;
  }
  if (op === "hanconvert") {
    const converter = p.mode === "traditional"
      ? await (s2t ||= import("opencc-js/cn2t").then(m => m.Converter({ from: "cn", to: "t" })))
      : await (t2s ||= import("opencc-js/t2cn").then(m => m.Converter({ from: "t", to: "cn" })));
    const converted = converter(item.text), source = glyphs(item.text), target = glyphs(converted);
    const text = source.length === target.length
      ? source.map((c, i) => chance(seed, item.text, i) < Number(p.probability) ? target[i] : c).join("")
      : chance(seed, item.text, 0) < Number(p.probability) ? converted : item.text;
    yield emit(text, "OpenCC 词组转换；部分转换不可逆，概率小于 1 时可混合简繁");
    return;
  }
  const data = await loadStructures();
  if (op === "decompose" || op === "components") {
    for (const char of glyphs(item.text)) {
      tick();
      const records = data[char]?.filter(([code]) => p.structure === undefined || p.structure === "any" || structureKind(code) === p.structure);
      if (!records?.length || records.every(([, parts]) => !parts.length)) {
        if (p.structure && p.structure !== "any") continue;
        yield emit(char, "无可用拆解记录或为不可分部件；保留原字符，不推测结构");
        continue;
      }
      for (const [code, children] of records) {
        if (!children.length) continue;
        // Pass only this variant as root; alternatives remain separate.
        for (const parts of leaves(data, char, Number(p.depth), tick, new Set(), [[code, children]])) {
          const note = `${char} · ${structureNames[structureKind(code)]}结构（${code}）· 图形分析；结构描述不代表新字`;
          if (op === "components") {
            for (const part of new Set(parts)) yield emit(displayPart(part), note);
          } else yield emit(parts.map(displayPart).join("、"), note);
        }
      }
    }
    return;
  }
  const strokeData = await loadStrokes();
  const accepted = (char: string) => {
    const counts = strokeData[char];
    return !!counts?.some(n => n >= Number(p.minStrokes) && n <= Number(p.maxStrokes)) &&
      (p.structure === "any" || data[char]?.some(([code]) => structureKind(code) === p.structure));
  };
  if (op === "hanfilter") {
    if (glyphs(item.text).every(c => /^\p{Unified_Ideograph}$/u.test(c) && accepted(c))) yield emit(item.text, "每个字均满足结构和笔画条件；地区笔画数有多个时任一满足即保留");
    return;
  }
  const wanted = item.text.trim().split(/[\s,，、+＋]+/u).filter(Boolean);
  if (!wanted.length || wanted.length > 12 || wanted.some(s => !/^\p{Unified_Ideograph}$/u.test(s) && !/^[\u2e80-\u2eff\u31c0-\u31ef]$/u.test(s))) throw new Error("请输入 1–12 个汉字或标准部件，以逗号或顿号分隔；不接受虚构部件编号");
  const index = await loadComponentIndex(Boolean(p.deep), tick);
  const sets = wanted.map(part => index.byPart.get(part) || new Set<string>()).sort((a, b) => a.size - b.size);
  let count = 0;
  const multisetMatches = (parts: string[], exact: boolean) => {
    if (exact && parts.length !== wanted.length) return false;
    const available = [...parts];
    return wanted.every(w => { const i = available.indexOf(w); if (i < 0) return false; available.splice(i, 1); return true; });
  };
  for (const char of sets[0]) {
    tick();
    if (!sets.every(set => set.has(char)) || !accepted(char)) continue;
    const match = p.match === "contains"
      ? (new Set(wanted).size === wanted.length || leaves(data, char, p.deep ? 6 : 1, tick).some(parts => multisetMatches(parts, false)))
      : leaves(data, char, p.deep ? 6 : 1, tick).some(parts => multisetMatches(parts, true));
    if (!match) continue;
    yield emit(char, `已收录汉字 · 笔画 ${strokeData[char].join(" / ")} · CJK Decomposition 图形匹配，不是造字或语源结论`);
    if (++count >= limit) return;
  }
}
