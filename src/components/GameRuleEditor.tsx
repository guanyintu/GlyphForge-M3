import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/db";
import { categories, parseGameRule } from "../core/game-rules";
import type { GameRule, LengthUnit } from "../core/game-rules";
const labels = { codePoints: "Unicode 码点数", graphemes: "可见字符簇数", bytes: "UTF-8 字节数" };
export function GameRuleEditor({ rule, onChange }: { rule: GameRule; onChange: (rule: GameRule) => void }) {
  const presets = useLiveQuery(() => db.gamePresets.toArray()) || [];
  const [selected, setSelected] = useState(""), [status, setStatus] = useState("");
  async function save(copy: boolean) {
    try { const validated = parseGameRule(JSON.stringify(rule)); const id = !copy && selected ? selected : crypto.randomUUID(); await db.gamePresets.put({ id, name: rule.name, rule: validated, updatedAt: Date.now() }); setSelected(id); setStatus("规则预设已保存"); }
    catch (e) { setStatus(e instanceof Error ? e.message : String(e)); }
  }
  return <div className="game-rule-editor">
    <label className="field-label">已保存的游戏规则<select aria-label="已保存的游戏规则" value={selected} onChange={e => { setSelected(e.target.value); const p = presets.find(p => p.id === e.target.value); if (p) onChange(p.rule); }}><option value="">自定义规则</option>{presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="field-label">规则名称<input value={rule.name} maxLength={60} onChange={e => onChange({ ...rule, name: e.target.value })} /></label>
    {(Object.keys(labels) as LengthUnit[]).map(unit => <div className="game-length" key={unit}><label><input type="checkbox" checked={!!rule.lengths[unit]} onChange={e => { const lengths = { ...rule.lengths }; if (e.target.checked) lengths[unit] = { min: 1, max: 12 }; else delete lengths[unit]; onChange({ ...rule, lengths }); }} />{labels[unit]}</label>{rule.lengths[unit] ? <><label>最小<input aria-label={`${labels[unit]}最小`} type="number" min={0} max={4096} value={rule.lengths[unit]!.min} onChange={e => onChange({ ...rule, lengths: { ...rule.lengths, [unit]: { ...rule.lengths[unit]!, min: Number(e.target.value) } } })} /></label><label>最大<input aria-label={`${labels[unit]}最大`} type="number" min={0} max={4096} value={rule.lengths[unit]!.max} onChange={e => onChange({ ...rule, lengths: { ...rule.lengths, [unit]: { ...rule.lengths[unit]!, max: Number(e.target.value) } } })} /></label></> : null}</div>)}
    <fieldset><legend>允许的 Unicode 类别（汉字/拉丁是字母的子集）</legend>{categories.map(c => <label key={c}><input type="checkbox" checked={rule.allowed.includes(c)} onChange={e => onChange({ ...rule, allowed: e.target.checked ? [...rule.allowed, c] : rule.allowed.filter(v => v !== c) })} />{({ han: "汉字", latin: "拉丁", letter: "全部字母", number: "数字", mark: "组合标记", symbol: "符号", punctuation: "标点", space: "空白" })[c]}</label>)}</fieldset>
    <label className="field-label">禁用字符<input value={rule.forbidden} maxLength={256} onChange={e => onChange({ ...rule, forbidden: e.target.value })} /></label>
    {(["allowSpaces", "allowSpecial", "blockZeroWidth"] as const).map(key => <label key={key}><input type="checkbox" checked={rule[key]} onChange={e => onChange({ ...rule, [key]: e.target.checked })} />{{ allowSpaces: "允许空白", allowSpecial: "允许符号/标点", blockZeroWidth: "禁止零宽/默认不可见字符" }[key]}</label>)}
    <div className="row"><button className="button" onClick={() => void save(false)}>保存规则预设</button><button className="button" onClick={() => void save(true)}>另存新预设</button></div>{status ? <p role="status">{status}</p> : null}
    <p className="field-note">仅检查此配置。混淆提示为有限启发式，不是完整 Unicode 安全检测；不查询游戏占用情况。工作流内保存规则快照，修改预设后需重新选用。</p>
  </div>;
}
