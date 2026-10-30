import { unicodeMetrics } from "./unicode";
export type LengthUnit = "codePoints" | "graphemes" | "bytes";
export const categories = ["han", "latin", "letter", "number", "mark", "symbol", "punctuation", "space"] as const;
export interface GameRule {
  name: string;
  lengths: Partial<Record<LengthUnit, { min: number; max: number }>>;
  allowed: (typeof categories[number])[];
  forbidden: string;
  allowSpaces: boolean;
  allowSpecial: boolean;
  blockZeroWidth: boolean;
}
export interface GamePreset { id: string; name: string; rule: GameRule; updatedAt: number }
export const defaultGameRule: GameRule = { name: "通用示例（可编辑）", lengths: { graphemes: { min: 2, max: 12 } }, allowed: [...categories], forbidden: "", allowSpaces: false, allowSpecial: true, blockZeroWidth: true };
export function parseGameRule(value: string): GameRule {
  let r: GameRule;
  try { r = JSON.parse(value); } catch { throw new Error("游戏规则需要有效 JSON"); }
  if (!r || typeof r.name !== "string" || !r.name.trim() || r.name.length > 60 || !r.lengths || typeof r.lengths !== "object" || Array.isArray(r.lengths)) throw new Error("游戏规则名称或长度配置无效");
  for (const [unit, range] of Object.entries(r.lengths)) if (!["codePoints", "graphemes", "bytes"].includes(unit) || !range || !Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 0 || range.max < range.min || range.max > 4096) throw new Error("游戏长度区间需要 0–4096 的整数");
  if (!Array.isArray(r.allowed) || r.allowed.some(c => !categories.includes(c)) || typeof r.forbidden !== "string" || r.forbidden.length > 256 || [r.allowSpaces, r.allowSpecial, r.blockZeroWidth].some(v => typeof v !== "boolean")) throw new Error("游戏字符规则无效");
  return r;
}
export function checkGameId(text: string, rule: GameRule) {
  const metrics = unicodeMetrics(text), errors: string[] = [], warnings: string[] = [];
  for (const [unit, range] of Object.entries(rule.lengths)) {
    const size = metrics[unit as LengthUnit]; if (size < range.min || size > range.max) errors.push(`${unit} 长度 ${size}，要求 ${range.min}–${range.max}`);
  }
  const zeroWidth = /\p{Default_Ignorable_Code_Point}/u.test(text);
  if (zeroWidth) (rule.blockZeroWidth ? errors : warnings).push("含零宽/默认不可见字符（含 Emoji 连接符或变体选择符）");
  if (!rule.allowSpaces && /\s/u.test(text)) errors.push("不允许空格/空白字符");
  if (!rule.allowSpecial && /[\p{P}\p{S}]/u.test(text)) errors.push("不允许特殊符号或标点");
  if (Array.from(rule.forbidden).some(c => text.includes(c))) errors.push("含禁用字符");
  const tests: Record<typeof categories[number], RegExp> = { han: /\p{Script=Han}/u, latin: /\p{Script=Latin}/u, letter: /\p{L}/u, number: /\p{N}/u, mark: /\p{M}/u, symbol: /\p{S}/u, punctuation: /\p{P}/u, space: /\s/u };
  if (Array.from(text).some(c => !(!rule.blockZeroWidth && /\p{Default_Ignorable_Code_Point}/u.test(c)) && !rule.allowed.some(category => tests[category].test(c)))) errors.push("含未允许的字符类别");
  if (text.normalize("NFKC") !== text) warnings.push("兼容字符可能与常规字符混淆（NFKC 不同）");
  if (/\p{Script=Latin}/u.test(text) && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(text)) warnings.push("混合拉丁/西里尔/希腊字母，存在混淆风险");
  if (/[Il1O0]/.test(text)) warnings.push("含形近拉丁字母/数字，请人工核对");
  return { valid: errors.length === 0, metrics, errors, warnings, zeroWidth };
}
