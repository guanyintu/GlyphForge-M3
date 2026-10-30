import type { OperatorDefinition, Params } from "./model";

export type ChineseOp = "pinyin" | "homophones" | "rhyme" | "hanconvert" | "mapchars" | "decompose" | "components" | "compose" | "hanfilter";
type Definition = Omit<OperatorDefinition, "version" | "inputTypes" | "outputType" | "deterministic" | "streaming">;
export const chineseDefinitions: Record<ChineseOp, Definition> = {
  pinyin: { id: "pinyin", name: "拼音与音韵", category: "中文", color: "orange", inputs: 1,
    description: "上下文拼音、首字母、声母、韵母、声调或逐字多音候选；候选读音不代表语境正确",
    defaults: { mode: "pinyin", tone: "symbol", separator: " ", limit: 32 } },
  homophones: { id: "homophones", name: "同音字查询", category: "中文", color: "purple", inputs: 1,
    description: "按输入单字的候选读音查询 Unihan 普通话索引；可区分声调，不保证穷尽所有异读",
    defaults: { matchTone: true, limit: 64 } },
  rhyme: { id: "rhyme", name: "押韵筛选", category: "中文", color: "orange", inputs: 1,
    description: "按词尾的现代普通话韵母严格相等筛选，非古韵或十三辙合并",
    defaults: { reference: "星光", matchTone: false } },
  hanconvert: { id: "hanconvert", name: "简繁与火星文", category: "中文", color: "purple", inputs: 1,
    description: "OpenCC 简繁或项目趣味多候选映射；按种子控制逐字转换概率，未映射字符保留",
    defaults: { mode: "traditional", probability: 1, limit: 32 } },
  mapchars: { id: "mapchars", name: "自定义字符映射", category: "中文", color: "purple", inputs: 1,
    description: 'JSON 单字符到候选数组，例如 {"月":["玥","鈅"]}；有界枚举，固定种子可复现',
    defaults: { mapping: '{"月":["玥","鈅"],"星":["煋","☆"]}', probability: 1, limit: 32 } },
  decompose: { id: "decompose", name: "汉字结构拆解", category: "汉字结构", color: "orange", inputs: 1,
    description: "逐字拆解左右、上下和包围结构；递归深度可调，描述与未编码部件不是真实新汉字",
    defaults: { depth: 1, structure: "any" } },
  components: { id: "components", name: "汉字部件提取", category: "汉字结构", color: "orange", inputs: 1,
    description: "按指定深度提取部件，每个部件独立输出；未编码部件标为部件编号",
    defaults: { depth: 2 } },
  compose: { id: "compose", name: "部件反查与组字", category: "汉字结构", color: "green", inputs: 1,
    description: "输入日、月等部件，仅查数据中真实存在的字；精确模式比较含重复次数的部件集合",
    defaults: { match: "exact", deep: false, structure: "any", minStrokes: 0, maxStrokes: 64, limit: 64 } },
  hanfilter: { id: "hanfilter", name: "结构与笔画筛选", category: "汉字结构", color: "orange", inputs: 1,
    description: "按逐字结构与 Unihan 笔画数筛选；缺少笔画数据不冒充零画",
    defaults: { structure: "any", minStrokes: 0, maxStrokes: 64 } },
};
export function isChineseOp(op: string): op is ChineseOp {
  return Object.hasOwn(chineseDefinitions, op);
}
export const chineseChoices: Record<string, string[]> = {
  "pinyin.mode": ["pinyin", "first", "initial", "final", "tone", "polyphonic"],
  "pinyin.tone": ["symbol", "num", "none"],
  "hanconvert.mode": ["traditional", "simplified", "martian"],
  "compose.match": ["exact", "contains"],
  structure: ["any", "left-right", "top-bottom", "enclosure", "other"],
};
export const chineseLabels: Record<string, string> = {
  mode: "转换方式", tone: "声调格式", separator: "分隔符", limit: "每条输入候选上限", matchTone: "区分声调",
  reference: "押韵参照词", probability: "转换概率（0–1）", mapping: "多候选映射 JSON", depth: "递归深度（1–6）",
  structure: "结构", match: "部件匹配方式", deep: "递归查找部件", minStrokes: "最少笔画", maxStrokes: "最多笔画",
};
export const chineseOptionLabels: Record<string, string> = {
  pinyin: "完整拼音", first: "首字母", initial: "声母（标准，零声母 ∅）", final: "韵母", tone: "声调数字（0 为轻声）",
  polyphonic: "逐字多音候选", symbol: "调号", num: "数字", none: "无调", traditional: "转繁体", simplified: "转简体",
  martian: "火星文（趣味字形）", any: "不限", "left-right": "左右", "top-bottom": "上下", enclosure: "包围", other: "其他",
  exact: "精确组字", contains: "包含指定部件",
};
export function validateChineseParams(op: ChineseOp, p: Params) {
  for (const key of Object.keys(chineseDefinitions[op].defaults)) {
    const choices = chineseChoices[`${op}.${key}`] || chineseChoices[key];
    if (choices && !choices.includes(String(p[key]))) throw new Error(`${key} 选项无效`);
    if (typeof p[key] === "number" && !Number.isFinite(p[key])) throw new Error(`${key} 需要有限数值`);
  }
  if (p.limit !== undefined && (!Number.isInteger(p.limit) || Number(p.limit) < 1 || Number(p.limit) > 128)) throw new Error("候选上限为 1–128");
  if (p.depth !== undefined && (!Number.isInteger(p.depth) || Number(p.depth) < 1 || Number(p.depth) > 6)) throw new Error("递归深度为 1–6");
  if (p.probability !== undefined && (Number(p.probability) < 0 || Number(p.probability) > 1)) throw new Error("转换概率为 0–1");
  if (p.minStrokes !== undefined && (!Number.isInteger(p.minStrokes) || !Number.isInteger(p.maxStrokes) || Number(p.minStrokes) < 0 || Number(p.maxStrokes) > 64 || Number(p.minStrokes) > Number(p.maxStrokes))) throw new Error("笔画范围需要为 0–64 的整数且下限不大于上限");
  if (op === "mapchars") parseCharacterMap(String(p.mapping));
  if (op === "rhyme" && !String(p.reference).trim()) throw new Error("请填写押韵参照词");
}
export function parseCharacterMap(source: string): Record<string, string[]> {
  if (source.length > 16384) throw new Error("映射 JSON 最多 16384 个代码单元");
  let map: unknown;
  try { map = JSON.parse(source); } catch { throw new Error("字符映射需要有效 JSON"); }
  if (!map || typeof map !== "object" || Array.isArray(map) || Object.keys(map).length > 256) throw new Error("字符映射需要对象，最多 256 个字符");
  for (const [key, values] of Object.entries(map)) {
    if (Array.from(key).length !== 1 || !Array.isArray(values) || !values.length || values.length > 32 || values.some(v => typeof v !== "string" || !v || v.length > 64)) throw new Error("映射键需为单码点字符，每字 1–32 个非空候选，每候选最多 64 个代码单元");
  }
  return map as Record<string, string[]>;
}
