import { useEffect, useRef, useState } from "react";
import type { Candidate, Favorite, Params, Resource, Workflow } from "../core/model";
import { glyphs } from "../core/unicode";
import { mutationConfig, mutationDefaults, mutationOperations, mutationWorkflow } from "../core/mutation";
import { normalizeParams } from "../core/contracts";
import { validateGraph } from "../core/script";
import Results from "./Results";
import { GameRuleEditor } from "./GameRuleEditor";
import { defaultGameRule } from "../core/game-rules";
import type { GameRule } from "../core/game-rules";
import "../p2b.css";

type GameMode = "none" | "filter" | "annotate";
type Frame = { source: Candidate; settings: Params; seed: number; results: Candidate[]; gameMode: GameMode; gameRule: GameRule };
export default function Mutation({ initial, resources, candidates, favorites, running, onRun, onStop, onClose, onFavorite, onSave, onCopy, onDetail }: {
  initial: Candidate; resources: Resource[]; candidates: Candidate[]; favorites: Favorite[]; running: boolean;
  onRun: (w: Workflow) => void; onStop: () => void; onClose: () => void;
  onFavorite: (c: Candidate) => void; onSave: (c: Candidate[]) => unknown; onCopy: (s: string) => void; onDetail: (c: Candidate) => void;
}) {
  const [source, setSource] = useState(initial);
  const [settings, setSettings] = useState<Params>({ ...mutationDefaults, locks: JSON.stringify(initial.derivation?.locks ?? []) });
  const [seed, setSeed] = useState(initial.seed ?? 42);
  const [gameMode, setGameMode] = useState<GameMode>("none"), [gameRule, setGameRule] = useState(defaultGameRule);
  const [started, setStarted] = useState(false), [restored, setRestored] = useState<Candidate[] | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]), [error, setError] = useState("");
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const results = restored ?? (started ? candidates : []);
  const locks = JSON.parse(String(settings.locks)) as number[];
  const operations = JSON.parse(String(settings.operations)) as string[];
  const update = (key: string, value: Params[string]) => setSettings(s => ({ ...s, [key]: value }));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement; dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function keys(e: KeyboardEvent) {
      if (Array.from(document.querySelectorAll('[role="dialog"]')).at(-1) !== dialog.current) return;
      if (e.key === "Escape") { e.stopImmediatePropagation(); close.current(); }
      if (e.key === "Tab") {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []);
        if (e.shiftKey && document.activeElement === items[0]) { e.preventDefault(); items.at(-1)?.focus(); }
        else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
      }
    }
    document.addEventListener("keydown", keys, true); return () => { document.removeEventListener("keydown", keys, true); previous?.focus(); };
  }, []);
  function next(c: Candidate) {
    setFrames(old => [...old.slice(-19), { source, settings, seed, results, gameMode, gameRule }]);
    setSource(c); setSettings(s => ({ ...s, locks: JSON.stringify(c.derivation?.locks ?? []) })); setStarted(false); setRestored(null); setError("");
  }
  function back() {
    const frame = frames.at(-1); if (!frame) return;
    setSource(frame.source); setSettings(frame.settings); setSeed(frame.seed); setGameMode(frame.gameMode); setGameRule(frame.gameRule); setRestored(frame.results); setStarted(true); setFrames(f => f.slice(0, -1));
  }
  return <div className="modal-backdrop mutation-backdrop"><section ref={dialog} className="modal mutation-modal" role="dialog" aria-modal="true" aria-label="名字变异与继续创作">
    <div className="modal-heading"><div><span className="eyebrow">GLYPHFORGE · CONTINUE THE SPARK</span><h2>从这个名字，再走一步</h2></div><button className="button" onClick={onClose}>关闭变异器</button></div>
    <div className="modal-body">
      <div className="mutation-source"><span>本轮起点 · 第 {(source.derivation?.round ?? 0) + 1} 轮</span><strong>{source.text}</strong><button className="text-button" disabled={!frames.length || running} onClick={back}>回退上一轮</button></div>
      <p className="field-note">点选字符簇以锁定位置；相同汉字可独立锁定。插入和删除会移动位置，锁定内容保持完整与相对顺序。回退保留本次打开期间最近20轮。</p>
      <div className="mutation-locks">{glyphs(source.text).map((s, i) => <button key={i} aria-label={`锁定位置 ${i + 1} ${s}`} aria-pressed={locks.includes(i)} className={locks.includes(i) ? "button active" : "button"} disabled={running} onClick={() => update("locks", JSON.stringify(locks.includes(i) ? locks.filter(n => n !== i) : [...locks, i]))}><b>{s}</b><small>{i + 1} · {locks.includes(i) ? "已锁定" : "可变"}</small></button>)}</div>
      <fieldset disabled={running}><legend>变异操作</legend><div className="mutation-operations">{Object.entries(mutationOperations).map(([id, name]) => <label key={id}><input type="checkbox" checked={operations.includes(id)} onChange={() => update("operations", JSON.stringify(operations.includes(id) ? operations.filter(o => o !== id) : [...operations, id]))} />{name}</label>)}</div>
        <div className="mutation-settings">
          <label className="field-label">变异强度<select aria-label="变异强度" value={Number(settings.intensity)} onChange={e => update("intensity", Number(e.target.value))}><option value={1}>轻微 · 1步</option><option value={2}>适中 · 2步</option><option value={3}>大胆 · 3步</option></select></label>
          <label className="field-label">固定种子<input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} /></label>
          <label className="field-label">变异数量<input type="number" min={1} max={256} value={Number(settings.count)} onChange={e => update("count", Number(e.target.value))} /></label>
          <label className="field-label">字符池<input value={String(settings.pool)} maxLength={256} onChange={e => update("pool", e.target.value)} /></label>
          <label className="field-label">前缀（用 | 分隔）<input value={String(settings.prefix)} maxLength={256} onChange={e => update("prefix", e.target.value)} /></label>
          <label className="field-label">后缀（用 | 分隔）<input value={String(settings.suffix)} maxLength={256} onChange={e => update("suffix", e.target.value)} /></label>
          <label className="field-label">替换词库<select aria-label="替换词库" value={String(settings.resourceId)} onChange={e => update("resourceId", e.target.value)}><option value="">选择普通词库</option>{resources.filter(r => r.kind !== "relation").map(r => <option key={r.id} value={r.id}>{r.name} · v{r.version}</option>)}</select></label>
          <label className="field-label">执行时游戏规则<select aria-label="执行时游戏规则" value={gameMode} onChange={e => setGameMode(e.target.value as GameMode)}><option value="none">不筛选</option><option value="filter">仅保留规则通过项</option><option value="annotate">保留全部并标注</option></select></label>
        </div>
        {gameMode !== "none" ? <GameRuleEditor rule={gameRule} onChange={setGameRule} /> : null}
      </fieldset>
      <p className="field-note">最多256个去重结果、8192次尝试、300,000共享步骤、10秒；词库按固定种子取前256条，缓冲最多65,536代码单元。结果可能少于请求数量。相同输入、设置、种子及资源/算法版本可复现。</p>
      <div className="row"><button className="primary-button" disabled={running} onClick={() => { try { const w = mutationWorkflow(source, settings, seed, gameMode === "none" ? undefined : { rule: gameRule, mode: gameMode }); normalizeParams("mutate", w.nodes[0].params); mutationConfig(w.nodes[0].params); validateGraph(w); setError(""); setRestored(null); setStarted(true); onRun(w); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }}>生成变体</button><button className="button" disabled={!running} onClick={onStop}>取消变异</button><span role="status">{running ? "变异执行中…" : started ? `本轮 ${results.length} 个去重衍生结果` : "选择操作后开始"}</span></div>
      {error ? <p role="alert">{error}</p> : null}
      <Results candidates={results} favorites={favorites} running={running} onFavorite={onFavorite} onSave={onSave} onCopy={onCopy} onDetail={c => { onClose(); onDetail(c); }} onMutate={next} />
    </div>
  </section></div>;
}
