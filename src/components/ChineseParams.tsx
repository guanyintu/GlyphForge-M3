import type { Params } from "../core/model";
import { chineseDefinitions, chineseChoices, chineseLabels, chineseOptionLabels } from "../core/chinese-definitions";
import type { ChineseOp } from "../core/chinese-definitions";

// Shared controls keep the lab and node inspector on exactly the same parameter contract.
export function ChineseParams({ op, params, onChange, disabled = false }: {
  op: ChineseOp; params: Params; onChange: (p: Params) => void; disabled?: boolean;
}) {
  return <fieldset className="chinese-params" disabled={disabled}>
    <legend className="sr-only">中文算子参数</legend>
    {Object.entries(chineseDefinitions[op].defaults).map(([key, value]) => {
      const choices = chineseChoices[`${op}.${key}`] || chineseChoices[key];
      const update = (v: string | number | boolean) => onChange({ ...params, [key]: v });
      return <label className="field-label" key={key}>
        {chineseLabels[key] || key}
        {choices ? <select value={String(params[key])} onChange={e => update(e.target.value)}>
          {choices.map(c => <option key={c} value={c}>{chineseOptionLabels[c] || c}</option>)}
        </select> : typeof value === "boolean" ? <input type="checkbox" checked={Boolean(params[key])} onChange={e => update(e.target.checked)} />
          : key === "mapping" ? <textarea rows={5} maxLength={16384} value={String(params[key])} onChange={e => update(e.target.value)} spellCheck={false} />
          : <input type={typeof value === "number" ? "number" : "text"} value={String(params[key])}
            min={key === "probability" || key.includes("Strokes") ? 0 : 1}
            max={key === "probability" ? 1 : key === "depth" ? 6 : key.includes("Strokes") ? 64 : key === "limit" ? 128 : undefined}
            step={key === "probability" ? 0.05 : 1} maxLength={256}
            onChange={e => update(typeof value === "number" ? Number(e.target.value) : e.target.value)} />}
      </label>;
    })}
  </fieldset>;
}
