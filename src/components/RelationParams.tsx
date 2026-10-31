import type { Params, Resource } from "../core/model";
import type { TemplateSlot } from "../core/relations";
import { relationLabels } from "../core/relations";

export function RelationSelect({ value, onChange, all = false }: { value: string; onChange: (value: string) => void; all?: boolean }) {
  return <select aria-label="关系类型" value={value} onChange={e => onChange(e.target.value)}>
    {all ? <option value="">全部显式关系</option> : null}
    {Object.entries(relationLabels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
  </select>;
}
export function RelationParams({ op, params, resources, onChange }: { op: "pairs" | "template" | "group"; params: Params; resources: Resource[]; onChange: (p: Params) => void }) {
  const set = (key: string, value: string | number | boolean) => onChange({ ...params, [key]: value });
  const text = (key: string, label: string) => <label className="field-label" key={key}>{label}<input maxLength={256} value={String(params[key])} onChange={e => set(key, e.target.value)} /></label>;
  const number = (key: string, label: string, max = 100) => <label className="field-label" key={key}>{label}<input type="number" min={1} max={max} value={Number(params[key])} onChange={e => set(key, Number(e.target.value))} /></label>;
  if (op === "pairs") return <label className="field-label">限定关系<RelationSelect all value={String(params.relation)} onChange={v => set("relation", v)} /></label>;
  if (op === "group") return <div className="relation-params">
    {number("count", "成员数量 N")}{number("batches", "战队批次")}
    {text("prefix", "公共前缀")}{text("suffix", "公共后缀（可选）")}{text("separator", "前后缀分隔符")}{text("joiner", "组内分隔符")}{number("maxLength", "每人最多可见字符")}
    <label><input type="checkbox" checked={Boolean(params.random)} onChange={e => set("random", e.target.checked)} /> 固定种子随机选取</label>
    <p className="field-note">同一次运行的所有批次不重复。候选不足会提示调整人数或长度。</p>
  </div>;
  let slots: TemplateSlot[] = [], templates: string[] = [];
  try { slots = JSON.parse(String(params.slots)); templates = JSON.parse(String(params.templates)); } catch { /* validation reports malformed imported data */ }
  const updateSlot = (index: number, patch: Partial<TemplateSlot>) => set("slots", JSON.stringify(slots.map((s, i) => i === index ? { ...s, ...patch } : s)));
  return <div className="relation-params">
    <b>共享槽位（最多六个）</b>
    {slots.map((slot, i) => <fieldset className="relation-slot" key={i}>
      <legend>槽位 {i + 1}</legend>
      <label className="field-label">变量名<input value={slot.name} maxLength={32} onChange={e => updateSlot(i, { name: e.target.value })} /></label>
      <label className="field-label">绑定词库<select value={slot.resourceId} onChange={e => {
        const r = resources.find(r => r.id === e.target.value);
        updateSlot(i, { resourceId: e.target.value, kind: r?.kind === "relation" ? "pair" : "word", relation: "" });
      }}><option value="">选择词库…</option>{!resources.some(r => r.id === slot.resourceId) ? <option value={slot.resourceId}>缺失：{slot.resourceId}</option> : null}{resources.filter(r=>r.kind!=="mapping").map(r => <option value={r.id} key={r.id}>{r.name}</option>)}</select></label>
      {slot.kind === "pair" ? <label className="field-label">限定关系<RelationSelect all value={slot.relation || ""} onChange={v => updateSlot(i, { relation: v as TemplateSlot["relation"] })} /></label> : null}
      <button className="text-button" onClick={() => set("slots", JSON.stringify(slots.filter((_, index) => index !== i)))}>移除此槽位</button>
    </fieldset>)}
    <button className="button" disabled={slots.length >= 6} onClick={() => {
      const r = resources.find(r=>r.kind!=="mapping"); let n = slots.length + 1; while (slots.some(s => s.name === `slot${n}`)) n++;
      set("slots", JSON.stringify([...slots, { name: `slot${n}`, resourceId: r?.id || "", kind: r?.kind === "relation" ? "pair" : "word", relation: "" }]));
    }}>添加共享槽位</button>
    <label className="field-label">名字模板（每行一个）<textarea rows={4} value={templates.join("\n")} maxLength={2055} onChange={e => set("templates", JSON.stringify(e.target.value.split("\n")))} /></label>
    <p className="field-note">普通槽位：{"{name}"}；关系槽位：{"{name.left}"} / {"{name.right}"}。同一槽位的所有引用共享一次绑定。可添加相同前后缀、重复变量或符号；交换变量顺序即可形成镜像。</p>
    {text("separator", "组内分隔符")}{number("maxLength", "每人最多可见字符")}
    <label><input type="checkbox" checked={Boolean(params.equalLength)} onChange={e => set("equalLength", e.target.checked)} /> 所有名字等长</label>
  </div>;
}
