import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Hash,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { addEntries, db, deleteResource, resourceQuery } from "../storage/db";
import type { Resource, Entry } from "../core/model";
import { downloadBlob } from "../core/sharing";
export function ResourcePage({
  resources,
  previews,
  onEdit,
  onCreate,
  onCreateRelation,
}: {
  resources: Resource[];
  previews: Record<string, string[]>;
  onEdit: (r: Resource) => void;
  onCreate: () => void;
  onCreateRelation: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR WORDS, YOUR WORLD</div>
          <h1>
            每一个词，都是灵感的起点<span className="heading-dot">.</span>
          </h1>
          <p>在这里收集、整理和复用你的文字素材。</p>
        </div>
        <div className="row relation-actions"><button className="button" onClick={onCreateRelation}>新建关系词库</button><button className="primary-button" onClick={onCreate}>
          <Plus size={16} />
          新建词库
        </button></div>
      </div>
      <div className="collection-bar">
        <h2>
          全部资源 <span>{resources.length}</span>
        </h2>
        <div className="search-box">
          <Search size={15} />
          <input
            aria-label="搜索词库"
            placeholder="搜索词库…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="resource-grid">
        {resources
          .filter((r) => r.name.includes(query))
          .map((r) => (
            <button
              className="resource-card"
              key={r.id}
              onClick={() => onEdit(r)}
            >
              <div className="resource-card-top">
                <span className={`resource-icon ${r.color}`}>
                  {r.kind === "character" ? (
                    <Hash size={22} />
                  ) : (
                    <BookOpen size={22} />
                  )}
                </span>
                <ArrowUpRight size={18} />
              </div>
              <h3>{r.name}</h3>
              <p>{r.description}</p>
              <div className="resource-words">
                {(previews[r.id] || []).slice(0, 5).map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
              <div className="resource-card-foot">
                <span>{r.count} {r.kind === "relation" ? "行关系" : "个词条"}</span>
                <span>v{r.version} · 本地词库</span>
              </div>
            </button>
          ))}
        <button className="new-resource-card" onClick={onCreate}>
          <Plus size={24} />
          <b>种下一片新的词库</b>
          <span>从几行文字开始</span>
        </button>
      </div>
    </div>
  );
}
export function ResourceModal({
  initialQuery = "",
  resource,
  onClose,
  notify,
}: {
  resource: Resource;
  initialQuery?: string;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState(resource.name);
  const [words, setWords] = useState("");
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [mode, setMode] = useState<"prefix" | "exact" | "contains">("prefix");
  const [exportFormat, setExportFormat] = useState<"txt" | "csv" | "json">(
    "txt",
  );
  const [progress, setProgress] = useState("");
  const task = useRef<Worker | null>(null);
  useEffect(() => () => task.current?.terminate(), []);
  function resourceTask(message: object) {
    task.current?.terminate();
    const w = new Worker(
      new URL("../workers/resources.worker.ts", import.meta.url),
      { type: "module" },
    );
    task.current = w;
    setBusy(true);
    setProgress("正在后台处理…");
    w.onmessage = (e) => {
      if (task.current !== w) return;
      if (e.data.type === "progress")
        setProgress(`已处理 ${e.data.processed.toLocaleString()} 条`);
      else {
        setBusy(false);
        setProgress("");
        if (e.data.type === "done") {
          setWords("");
          notify(
            `导入完成：读取 ${e.data.processed} 条，新增 ${e.data.added} 条`,
          );
        } else if (e.data.type === "exported")
          downloadBlob(e.data.name, e.data.blob);
        else notify(e.data.message);
        w.terminate();
        task.current = null;
      }
    };
    w.onerror = () => {
      setBusy(false);
      setProgress("后台任务失败，已提交的词条保留");
      w.terminate();
    };
    w.postMessage({ ...message, resourceId: resource.id });
  }
  const liveResource = useLiveQuery(
    () => db.resources.get(resource.id),
    [resource.id],
  );
  const scanning = mode === "contains" && !!query;
  const queryTask = useRef<Worker | null>(null);
  const [queryBusy, setQueryBusy] = useState(false),
    [queryProgress, setQueryProgress] = useState(""),
    [scanResult, setScanResult] = useState<{ entries: Entry[]; count: number }>(
      { entries: [], count: 0 },
    );
  useEffect(() => {
    if (!scanning) {
      setQueryBusy(false);
      return;
    }
    const w = new Worker(
      new URL("../workers/resources.worker.ts", import.meta.url),
      { type: "module" },
    );
    queryTask.current = w;
    setScanResult({ entries: [], count: 0 });
    setQueryBusy(true);
    setQueryProgress("正在后台扫描…");
    w.onmessage = (e) => {
      if (queryTask.current !== w) return;
      if (e.data.type === "progress") {
        setQueryProgress(`已扫描 ${e.data.processed.toLocaleString()} 条`);
        return;
      }
      setQueryBusy(false);
      setQueryProgress(e.data.type === "error" ? e.data.message : "");
      if (e.data.type === "queryResult")
        setScanResult({ entries: e.data.entries, count: e.data.count });
      w.terminate();
      queryTask.current = null;
    };
    w.onerror = () => {
      if (queryTask.current === w) {
        setQueryBusy(false);
        setQueryProgress("查询失败，请重试");
        w.terminate();
        queryTask.current = null;
      }
    };
    w.postMessage({ type: "query", resourceId: resource.id, query, page });
    return () => {
      w.terminate();
      if (queryTask.current === w) queryTask.current = null;
    };
  }, [resource.id, query, page, mode, scanning, liveResource?.version]);
  const indexedEntries =
    useLiveQuery(
      () =>
        scanning
          ? []
          : resourceQuery(resource.id, query, mode)
              .offset(page * 60)
              .limit(60)
              .toArray(),
      [resource.id, query, page, mode, scanning],
    ) || [];
  const indexedCount =
    useLiveQuery(
      () => (scanning ? 0 : resourceQuery(resource.id, query, mode).count()),
      [resource.id, query, mode, scanning],
    ) || 0;
  const entries = scanning ? scanResult.entries : indexedEntries;
  const count = scanning ? scanResult.count : indexedCount;
  async function add() {
    if (words.length > 100000) {
      resourceTask({ type: "import", text: words, name: "pasted.txt" });
      return;
    }
    setBusy(true);
    try {
      await addEntries(resource.id, words.split(/[\n\r\t,，]+/));
      setWords("");
      notify("词条已添加，重复内容已自动合并");
    } catch (e) {
      notify(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        className="modal resource-modal"
        role="dialog"
        aria-modal="true"
        aria-label="编辑词库"
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">RESOURCE LIBRARY</span>
            <h2>编辑你的文字素材</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        <div className="resource-editor">
          <div className="resource-editor-input">
            <label className="field-label">
              词库名称
              <input
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                onBlur={async () => {
                  if (name.trim())
                    await db.resources.update(resource.id, {
                      name: name.trim(),
                      updatedAt: Date.now(),
                    });
                }}
              />
            </label>
            <label className="field-label">
              资源类型
              <select
                aria-label="资源类型"
                value={liveResource?.kind || resource.kind}
                onChange={(e) =>
                  void db.resources.update(resource.id, {
                    kind: e.target.value as Resource["kind"],
                  })
                }
              >
                <option value="word">普通词库</option>
                <option value="character">单字库</option>
                <option value="symbol">符号库</option>
              </select>
            </label>
            <label className="field-label">
              添加词条
              <textarea
                autoFocus
                rows={10}
                placeholder={"每行一个词条，支持批量粘贴\n\n月亮\n星河\n晚风"}
                value={words}
                onChange={(e) => setWords(e.target.value)}
              />
            </label>
            <p className="field-note">
              支持换行、逗号或表格分列。保存时自动去重。
            </p>
            <div className="row">
              <button
                className="primary-button"
                onClick={add}
                disabled={busy || !words.trim()}
              >
                <Plus size={15} />
                {busy ? "正在添加…" : "添加到词库"}
              </button>
              <label className="button file-button">
                <Upload size={14} />
                导入文件
                <input
                  type="file"
                  accept=".txt,.csv,.tsv,.json"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) resourceTask({ type: "import", file: f });
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            {busy ? (
              <div className="import-progress" role="status">
                <span>{progress}</span>
                <button
                  className="text-button"
                  onClick={() => {
                    task.current?.terminate();
                    task.current = null;
                    setBusy(false);
                    setProgress("");
                    notify("导入已停止，已提交批次保留");
                  }}
                >
                  停止任务
                </button>
              </div>
            ) : null}
          </div>
          <div className="resource-entry-panel">
            <div className="entry-panel-title">
              <b>
                词条{" "}
                <span className="count-badge">{liveResource?.count || 0}</span>
              </b>
              <select
                aria-label="词库导出格式"
                value={exportFormat}
                onChange={(e) =>
                  setExportFormat(e.target.value as typeof exportFormat)
                }
              >
                <option value="txt">TXT</option>
                <option value="csv">CSV</option>
                <option value="json">JSON</option>
              </select>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  resourceTask({ type: "export", format: exportFormat })
                }
              >
                <ArrowDownToLine size={14} />
                导出
              </button>
            </div>
            <div className="search-box">
              <Search size={14} />
              <input
                aria-label="搜索词条"
                placeholder="查找词条…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <div className="resource-query-mode">
              <select
                aria-label="词条搜索方式"
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as typeof mode);
                  setPage(0);
                }}
              >
                <option value="prefix">前缀匹配（索引）</option>
                <option value="exact">精确匹配（索引）</option>
                <option value="contains">包含文字（扫描）</option>
              </select>
            </div>
            {queryBusy ? (
              <div className="query-progress" role="status">
                {queryProgress}
                <button
                  className="text-button"
                  onClick={() => {
                    queryTask.current?.terminate();
                    queryTask.current = null;
                    setQueryBusy(false);
                    setQueryProgress("查询已停止");
                  }}
                >
                  停止查询
                </button>
              </div>
            ) : queryProgress && scanning ? (
              <p className="field-note">{queryProgress}</p>
            ) : null}
            <div className="entry-list">
              {entries.map((entry) => (
                <div key={entry.id}>
                  <input
                    aria-label={`编辑词条 ${entry.text}`}
                    defaultValue={entry.text}
                    maxLength={256}
                    onBlur={async (e) => {
                      const text = e.target.value.trim();
                      if (text === entry.text) return;
                      try {
                        await db.transaction(
                          "rw",
                          db.entries,
                          db.resources,
                          async () => {
                            const meta = await db.resources.get(resource.id);
                            if (!meta) throw new Error("词库不存在");
                            const duplicate = text
                              ? await db.entries
                                  .where("[resourceId+text]")
                                  .equals([resource.id, text])
                                  .first()
                              : undefined;
                            if (!text || duplicate)
                              await db.entries.delete(entry.id!);
                            else await db.entries.update(entry.id!, { text });
                            await db.resources.update(resource.id, {
                              count: await db.entries
                                .where({ resourceId: resource.id })
                                .count(),
                              version: meta.version + 1,
                              updatedAt: Date.now(),
                            });
                          },
                        );
                      } catch {
                        notify("词条修改失败");
                        e.target.value = entry.text;
                      }
                    }}
                  />
                  <button
                    className="icon-button"
                    aria-label={`删除词条 ${entry.text}`}
                    onClick={async () => {
                      await db.transaction(
                        "rw",
                        db.entries,
                        db.resources,
                        async () => {
                          const meta = await db.resources.get(resource.id);
                          if (!meta) throw new Error("词库不存在");
                          await db.entries.delete(entry.id!);
                          await db.resources.update(resource.id, {
                            count: await db.entries
                              .where({ resourceId: resource.id })
                              .count(),
                            version: meta.version + 1,
                            updatedAt: Date.now(),
                          });
                        },
                      );
                    }}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {!entries.length ? (
                <p className="field-note">这里还没有匹配的词条。</p>
              ) : null}
            </div>
            <div className="pagination">
              <span>
                {count} 条 · 第 {page + 1} 页
              </span>
              <button
                className="icon-button"
                disabled={!page}
                onClick={() => setPage(page - 1)}
                aria-label="上一页"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                className="icon-button"
                disabled={(page + 1) * 60 >= count}
                onClick={() => setPage(page + 1)}
                aria-label="下一页"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button
            className="danger-button"
            onClick={async () => {
              if (!deleteConfirm) {
                setDeleteConfirm(true);
                return;
              }
              await deleteResource(resource.id);
              notify("词库已删除，引用该词库的节点需要重新绑定");
              onClose();
            }}
          >
            <Trash2 size={14} />
            {deleteConfirm ? "再次点击确认删除词库" : "删除词库"}
          </button>
          <button
            className="button"
            onClick={async () => {
              if (!name.trim()) {
                notify("请输入词库名称");
                return;
              }
              await db.resources.update(resource.id, { name: name.trim() });
              onClose();
            }}
          >
            <Check size={15} />
            完成
          </button>
        </div>
      </section>
    </div>
  );
}
