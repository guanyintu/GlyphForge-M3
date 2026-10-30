import { useEffect, useRef, useState } from "react";
import type { Resource, Workflow } from "../core/model";
import { dependencyIds, download, exportPackage } from "../core/sharing";
import type { Dependency } from "../core/sharing";
export function SharePanel({
  workflow,
  resources,
  notify,
}: {
  workflow: Workflow;
  resources: Resource[];
  notify: (s: string) => void;
}) {
  const [ids, setIds] = useState(() => dependencyIds(workflow));
  const [busy, setBusy] = useState(false);
  const controller=useRef<AbortController|null>(null);useEffect(()=>()=>controller.current?.abort(),[]);
  async function save(snapshot: boolean) {
    setBusy(true);
    const abort=new AbortController();controller.current=abort;
    try {
      const json=JSON.stringify(await exportPackage(workflow,snapshot?ids:false,abort.signal),null,2);
      if(new Blob([json]).size>15*1024*1024)throw new Error('便携包超过 15 MB，请减少词库快照');
      download(
        `${workflow.name}.${snapshot ? "portable" : "workflow"}.json`,
        json,
      );
      notify(
        snapshot
          ? "便携包已导出，仅包含勾选的词库"
          : "轻量工作流已导出，不含词条",
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="share-panel">
      <p className="field-note">
        轻量工作流保存规则、布局、资源引用和算子版本。便携包还可以包含你勾选的词库快照；未包含的资源会在导入时要求重新绑定。
      </p>
      <div className="share-resources">
        {dependencyIds(workflow).map((id) => {
          const r = resources.find((x) => x.id === id);
          return (
            <label key={id}>
              <input
                type="checkbox"
                checked={ids.includes(id)}
                onChange={(e) =>
                  setIds((old) =>
                    e.target.checked
                      ? [...old, id]
                      : old.filter((x) => x !== id),
                  )
                }
              />
              <span>
                {r?.name || `缺失：${id}`}
                <small>
                  {r?.count || 0} 个词条 · v{r?.version || "?"}
                </small>
              </span>
            </label>
          );
        })}
      </div>
      {busy?<button className="text-button" onClick={()=>controller.current?.abort()}>停止导出</button>:null}
      <div className="row">
        <button className="button" disabled={busy} onClick={() => save(false)}>
          导出轻量工作流
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => save(true)}
        >
          导出便携包
        </button>
      </div>
      <button
        className="text-button"
        disabled={busy}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(
              JSON.stringify(await exportPackage(workflow, false)),
            );
            notify("完整工作流已复制，可跨工作流粘贴");
          } catch (e) {
            notify(String(e));
          }
        }}
      >
        复制完整工作流
      </button>
    </div>
  );
}
export function ImportBindings({
  dependencies,
  resources,
  onImport,
}: {
  dependencies: Dependency[];
  resources: Resource[];
  onImport: (bindings: Record<string, string>) => Promise<void>;
}) {
  const [bindings, setBindings] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  return (
    <div>
      <p className="field-note">
        以下依赖不存在或版本不同。选择本地词库后导入；此操作只修改导入副本的引用。
      </p>
      {dependencies.map((dep) => (
        <label className="field-label" key={dep.id}>
          {dep.name} · 需要 v{dep.version}
          <select
            aria-label={`绑定资源 ${dep.name}`}
            value={bindings[dep.id] || ""}
            onChange={(e) =>
              setBindings({ ...bindings, [dep.id]: e.target.value })
            }
          >
            <option value="">选择本地词库…</option>
            {resources.filter(r => (r.kind === "relation") === (dep.kind === "relation")).map((r) => (
              <option value={r.id} key={r.id}>
                {r.name} · v{r.version}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        className="primary-button"
        disabled={busy || dependencies.some((d) => !bindings[d.id])}
        onClick={async () => {
          setBusy(true);
          try {
            await onImport(bindings);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "正在恢复…" : "绑定并导入"}
      </button>
    </div>
  );
}
