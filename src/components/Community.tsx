import { useEffect, useRef, useState } from "react";
import {
  community,
  CommunityError,
  CommunityLoginError,
  enableDemo,
  oauthCallbackError,
} from "../community/client";
import {
  adopt,
  flushUsage,
  recordUsage,
  usageStatus,
} from "../community/local";
import {
  contentHash,
  metadata,
  publicWorkflow,
  validateCommunityPayload,
  type Listing,
  type User,
  type Version,
} from "../community/protocol";
import { shareTask, type EncodedShare } from "../core/share-task";
import { previewShare, type SharePreview } from "../core/share-preview";
import { captureShareResources } from "../storage/share-resources";
import type { Resource, Workflow } from "../core/model";
import { ImportBindings } from "./Sharing";
import "../community.css";

export default function Community({
  workflow,
  resources,
  onUse,
  notify,
  canPublish,
}: {
  workflow: Workflow;
  resources: Resource[];
  onUse: (w: Workflow) => void;
  notify: (s: string) => void;
  canPublish: boolean;
}) {
  const [user, setUser] = useState<User | null>(null),
    [revision, refresh] = useState(0),
    [items, setItems] = useState<Listing[]>([]);
  const [q, setQ] = useState(""),
    [tag, setTag] = useState(""),
    [sort, setSort] = useState("latest"),
    [page, setPage] = useState(0),
    [mine, setMine] = useState(false);
  const [detail, setDetail] = useState<Listing | null>(null),
    [versions, setVersions] = useState<Version[]>([]),
    [downloaded, setDownloaded] = useState<Version | null>(null),
    [preview, setPreview] = useState<SharePreview | null>(null),
    [liked, setLiked] = useState<boolean | null>(null);
  const [publish, setPublish] = useState(false),
    [target, setTarget] = useState<Listing | null>(null),
    [title, setTitle] = useState(workflow.name),
    [description, setDescription] = useState(""),
    [tags, setTags] = useState("");
  const [ids, setIds] = useState<string[]>([]),
    [deps, setDeps] = useState<Resource[]>([]),
    [snapshot, setSnapshot] = useState<unknown>(null),
    [snapshotText, setSnapshotText] = useState(""),
    [extensionsOK, setExtensionsOK] = useState(false),
    [subgraphsOK, setSubgraphsOK] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [authError, setAuthError] = useState(""),
    [demoName, setDemoName] = useState(""),
    [report, setReport] = useState(""),
    [hidden, setHidden] = useState<string[]>(() =>
      JSON.parse(localStorage.getItem("glyphforge-community-hidden") || "[]"),
    );
  const [queue, setQueue] = useState<unknown>(null);
  const [usage, setUsage] = useState({ pending: 0, error: "" });
  const [loading, setLoading] = useState(false);
  const [offlineReady, setOfflineReady] = useState(
    () => !!navigator.serviceWorker?.controller,
  );
  const controller = useRef<AbortController | null>(null),
    request = useRef(0);
  const taskActive = useRef(false);
  const detailPanel = useRef<HTMLElement | null>(null);
  const publishPanel = useRef<HTMLElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const api = community();
  function message(e: unknown) {
    if (!navigator.onLine) return "当前离线，请联网后重试；本机工坊仍可使用。";
    if (e instanceof CommunityError) {
      if (e.status === 429) return "写入额度已用尽或服务已暂停，请稍后重试。";
      if ([401, 403].includes(e.status)) return "登录已失效或权限不足，请重新登录后重试。";
      if (e.status >= 500) return "社区服务暂不可用，请稍后重试。";
    }
    const raw = e instanceof Error ? e.message : "";
    if (/version conflict|版本已变化/i.test(raw)) return "版本已变化，请关闭详情并刷新后重试。";
    if (/Author required|Moderator required|权限|denied/i.test(raw)) return "当前账号没有此操作权限。";
    if (/fetch|network|timeout/i.test(raw)) return "网络请求失败，请检查连接并重试。";
    if (/哈希|快照|依赖|工作流|标题、描述|公开描述|先应用/.test(raw) && !/eyJ|Bearer|sb_|https?:/i.test(raw)) return raw.slice(0, 160);
    return "操作未完成，请检查输入或重新登录后重试。";
  }
  function closePanel() {
    request.current++;
    controller.current?.abort();
    setPublish(false); setDetail(null); setPreview(null); setSnapshot(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }
  useEffect(() => {
    const panel = publish ? publishPanel.current : detail ? detailPanel.current : null;
    panel?.focus();
    panel?.scrollIntoView({ block: "nearest" });
  }, [publish, detail?.id]);
  const needsExtensions =
    !!workflow.extensions?.length ||
    deps.some(
      (r) =>
        r.definition?.type === "dynamic" &&
        r.definition.workflow.extensions?.length,
    );
  const needsSubgraphs =
    !!workflow.subgraphs?.length ||
    deps.some(
      (r) =>
        r.definition?.type === "dynamic" &&
        r.definition.workflow.subgraphs?.length,
    );
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const update = () => setOfflineReady(!!navigator.serviceWorker?.controller);
    navigator.serviceWorker?.addEventListener("controllerchange", update);
    return () =>
      navigator.serviceWorker?.removeEventListener("controllerchange", update);
  }, []);
  useEffect(() => {
    const handler = () => {
      void flushUsage();
      refresh((v) => v + 1);
    };
    window.addEventListener("online", handler);
    window.addEventListener("focus", handler);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("focus", handler);
    };
  }, []);
  useEffect(() => {
    if (api.mode !== "cloud") return;
    let alive = true;
    void oauthCallbackError.then((failure) => {
      if (alive && failure) setAuthError(failure);
    });
    return () => { alive = false; };
  }, [api]);
  useEffect(() => {
    let alive = true;
    void api
      .user()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch((e) => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [api, revision]);
  useEffect(() => {
    let alive = true;
    void usageStatus().then((s) => {
      if (alive) setUsage(s);
    });
    return () => {
      alive = false;
    };
  }, [revision, user]);
  useEffect(() => {
    let alive = true;
    setLiked(null);
    if (detail && user)
      void api
        .liked(detail.id)
        .then((value) => {
          if (alive) setLiked(value);
        })
        .catch((e) => {
          if (alive) setError(message(e));
        });
    return () => {
      alive = false;
    };
  }, [api, user?.id, detail?.id]);
  useEffect(() => {
    let alive = true;
    setError("");
    setLoading(true);
    void api
      .list(q, tag, sort, page, mine)
      .then((rows) => {
        if (alive) {
          setItems(rows);
          setDetail((prev) =>
            prev ? rows.find((w) => w.id === prev.id) || prev : null,
          );
        }
      })
      .catch((e) => {
        if (alive)
          setError(message(e));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => {
      alive = false;
    };
  }, [api, q, tag, sort, page, mine, revision]);
  async function task(fn: () => Promise<void>) {
    if (taskActive.current) return;
    const focused = document.activeElement as HTMLElement | null;
    taskActive.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof CommunityLoginError) setAuthError(e.message);
      else setError(message(e));
    } finally {
      setBusy(false);
      taskActive.current = false;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body && focused?.isConnected) focused.focus();
      });
    }
  }
  async function open(w: Listing) {
    const token = ++request.current;
    setDetail(w);
    setDownloaded(null);
    setPreview(null);
    setVersions([]);
    const vs = await api.versions(w.id);
    if (token !== request.current) return;
    setVersions(vs);
    setDescription(w.description);
    setTitle(w.title);
    setTags(w.tags.join(","));
    setReport("");
    void recordUsage(
      {
        workflowId: w.id,
        version: w.current_version,
        hash: "",
        fingerprint: "",
      },
      "view",
    ).catch(() => {});
  }
  async function download(version: number) {
    if (!detail) return;
    const token = request.current;
    const v = await api.version(detail.id, version);
    validateCommunityPayload(v.payload);
    if ((await contentHash(v.payload)) !== v.content_hash)
      throw new Error("内容哈希不符，已拒绝");
    const p = await previewShare(v.payload);
    if (token !== request.current) return;
    setDownloaded(v);
    setPreview(p);
  }
  async function beginPublish(w: Listing | null) {
    if (!canPublish) throw new Error("请先应用工坊中未保存的代码");
    returnFocus.current = document.activeElement as HTMLElement;
    setTarget(w);
    setTitle(w?.title || workflow.name);
    setDescription(w?.description || "");
    setTags(w?.tags.join(",") || "");
    setSnapshot(null);
    setSnapshotText("");
    setExtensionsOK(false);
    setSubgraphsOK(false);
    setIds([]);
    const plan = await captureShareResources(workflow);
    setDeps(plan.resources);
    setPublish(true);
  }
  async function prepare() {
    const abort = new AbortController();
    controller.current = abort;
    const encoded = await shareTask<EncodedShare>(
      { action: "encode", workflow: publicWorkflow(workflow), selection: ids },
      abort.signal,
    );
    const data = await shareTask(
      { action: "decode", code: encoded.code },
      abort.signal,
    );
    validateCommunityPayload(data);
    setSnapshot(data);
    setSnapshotText(JSON.stringify(data, null, 2));
  }
  async function confirm(bindings: Record<string, string> = {}) {
    if (!downloaded || !detail) return;
    const w = await adopt(
      downloaded.payload,
      {
        workflowId: detail.id,
        version: downloaded.version,
        hash: downloaded.content_hash,
      },
      bindings,
    );
    onUse(w);
    notify("社区方案已原子导入；点击运行工作流在本机生成");
  }
  function hide(id: string) {
    const next = [...new Set([...hidden, id])].slice(-500);
    localStorage.setItem("glyphforge-community-hidden", JSON.stringify(next));
    setHidden(next);
    setDetail(null);
  }
  return (
    <div className="page-content community-page" onKeyDown={(e) => {
      if (e.key === "Escape" && !taskActive.current && (publish || detail)) closePanel();
    }}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">SHARED RECIPES · LOCAL CREATION</div>
          <h1>
            让灵感，接着生长<span className="heading-dot">.</span>
          </h1>
          <p>发现一个好配方，带回自己的工坊。</p>
        </div>
        <span className="community-mark" aria-hidden="true">
          ✳
        </span>
      </div>
      <div className="community-note">
        {api.mode === "demo"
          ? "本地演示 · 内容仅保存在当前浏览器，登录与计数均为模拟，不代表云端权限验收。"
          : api.mode === "unconfigured"
            ? "社区服务尚未配置。离线工坊与已导入方案可继续使用。"
            : "公开方案经下载与预览后在本机执行。计数为登录客户端限流上报，非独立人数；匿名不计数。"}
      </div>
      <p className="field-note">
        {offlineReady
          ? "本机运行资源已缓存，可断网生成。"
          : "首次需联网缓存本机运行资源；缓存完成后可断网生成。"}
      </p>
      <div className="community-account">
        {user ? (
          <>
            <span>创作者 · {user.name}</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  await api.logout();
                  setUser(null);
                  setMine(false);
                  setPage(0);
                  setPublish(false);
                  refresh((v) => v + 1);
                })
              }
            >
              退出登录
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void task(() => beginPublish(null))}
            >
              发布当前工作流
            </button>
          </>
        ) : api.mode === "demo" ? (
          <>
            <input
              aria-label="演示账号名称"
              placeholder="演示账号名称"
              value={demoName}
              onChange={(e) => setDemoName(e.target.value)}
            />
            <button
              className="button"
              disabled={busy}
              onClick={() => void task(async () => {
                await api.login(demoName);
                refresh((v) => v + 1);
                await flushUsage();
              })}
            >
              演示登录
            </button>
          </>
        ) : api.mode === "cloud" ? (
          <button
            className="button"
            disabled={busy}
            onClick={() => void task(async () => {
              setAuthError("");
              await api.login();
            })}
          >
            GitHub 登录
          </button>
        ) : null}
        {api.mode === "unconfigured" ? (
          <button
            className="button"
            onClick={() =>
              void task(async () => {
                await enableDemo();
                refresh((v) => v + 1);
              })
            }
          >
            进入本地演示
          </button>
        ) : null}
      </div>
      {authError ? <p role="alert" className="community-error">{authError}</p> : null}
      <div className="community-search">
        <input
          aria-label="搜索社区方案"
          placeholder="搜索标题、描述或标签…"
          value={q}
          maxLength={80}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <input
          aria-label="社区标签"
          placeholder="精确标签"
          value={tag}
          maxLength={24}
          onChange={(e) => {
            setTag(e.target.value);
            setPage(0);
          }}
        />
        <select
          aria-label="社区排序"
          value={sort}
          onChange={(e) => {
            setSort(e.target.value);
            setPage(0);
          }}
        >
          <option value="latest">最新发布</option>
          <option value="popular">热门（点赞）</option>
          <option value="used">最多使用（采纳）</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => {
              setMine(e.target.checked);
              setPage(0);
            }}
            disabled={!user}
          />
          我的发布
        </label>
      </div>
      {error ? (
        <p role="alert" className="community-error">
          {error}
          <button className="text-button" disabled={busy || loading} onClick={() => refresh((v) => v + 1)}>重试加载</button>
        </p>
      ) : null}
      {loading || busy ? <p role="status" aria-live="polite">{busy ? "操作处理中，请稍候…" : "正在加载社区方案…"}</p> : null}
      {usage.pending || usage.error ? (
        <p role="status">
          统计待同步 {usage.pending} 条。
          {usage.error ? "最近上报未被接受，请联网后重试。" : ""}{" "}
          本地导入和生成已独立保存。
        </p>
      ) : null}
      <div className="community-grid" aria-busy={loading}>
        {items
          .filter((w) => !hidden.includes(w.id))
          .map((w) => (
            <button
              className="community-card"
              key={w.id}
              onClick={(e) => {
                returnFocus.current = e.currentTarget;
                void task(() => open(w));
              }}
              disabled={busy}
            >
              <div className="community-card-top">
                {w.tags.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
                <small>v{w.current_version}</small>
              </div>
              <h2>{w.title}</h2>
              <p>{w.description || "一个等待你接续的取名配方。"}</p>
              <small>
                {w.author} ·{" "}
                {w.status === "published"
                  ? "公开"
                  : w.status === "blocked"
                    ? "审核下架"
                    : "已下架"}
              </small>
              <div className="community-counts">
                <span>♡ {w.likes} 点赞</span>
                <span>↗ {w.adoptions} 采纳</span>
                <span>▷ {w.runs} 运行</span>
              </div>
            </button>
          ))}
      </div>
      {!loading && !error && !items.filter(w => !hidden.includes(w.id)).length ? (
        <div className="community-empty">
          {q || tag || mine ? "没有符合条件的方案，请调整搜索或筛选。" : "这里留给下一个好点子。发布你的第一个配方。"}
        </div>
      ) : null}
      <div className="row">
        <button
          className="button"
          disabled={!page || loading || busy}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </button>
        <span>第 {page + 1} 页</span>
        <button
          className="button"
          disabled={items.length < 12 || loading || busy}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
        <button
          className="text-button"
          onClick={() => {
            setHidden([]);
            localStorage.removeItem("glyphforge-community-hidden");
          }}
        >
          恢复本机隐藏
        </button>
        <button
          className="text-button"
          onClick={() =>
            void task(async () => {
              await flushUsage();
              refresh((v) => v + 1);
            })
          }
        >
          刷新统计
        </button>
        {user ? (
          <button
            className="text-button"
            onClick={() =>
              void task(async () => {
                setQueue(await api.write("review", {}));
              })
            }
          >
            审核队列
          </button>
        ) : null}
      </div>
      {queue ? (
        <section className="community-preview">
          <h2>审核队列</h2>
          <pre>{JSON.stringify(queue, null, 2)}</pre>
          <p>审核使用详情中的「审核下架」；管理员来自服务端成员表。</p>
        </section>
      ) : null}
      {detail ? (
        <section ref={detailPanel} tabIndex={-1} className="community-detail" aria-label="社区方案详情">
          <button
            className="text-button"
            disabled={busy}
            onClick={closePanel}
          >
            关闭详情
          </button>
          <h2>{detail.title}</h2>
          <p>{detail.description}</p>
          <p className="field-note">下架后从广场隐藏；软删除后不可访问。历史快照、举报、事件和服务日志仍可能保留，软删除不等于永久销毁。</p>
          <p>
            作者 {detail.author} · 当前 v{detail.current_version} · 浏览{" "}
            {detail.views} · 点赞 {detail.likes} · 采纳 {detail.adoptions} ·
            运行 {detail.runs}
          </p>
          <div className="row">
            <button
              className="button"
              disabled={!user || busy || liked === null}
              aria-pressed={!!liked}
              onClick={() =>
                void task(async () => {
                  const updated = await api.write("like", {
                    workflow_id: detail.id,
                    liked: !liked,
                  }) as Listing;
                  setLiked(!liked);
                  setDetail(updated);
                  if (sort === "popular") refresh((v) => v + 1);
                  else setItems((rows) => rows.map((w) => w.id === updated.id ? updated : w));
                })
              }
            >
              {liked ? "撤销点赞" : "点赞"}
            </button>
            <button className="button" onClick={() => hide(detail.id)}>
              本机隐藏
            </button>
            {user?.id === detail.author_id ? (
              <>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void task(() => beginPublish(detail))}
                >
                  以当前工作流发布新版本
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      await api.write("status", {
                        workflow_id: detail.id,
                        status:
                          detail.status === "published"
                            ? "unlisted"
                            : "published",
                      });
                      setDetail(null);
                      refresh((v) => v + 1);
                      notify(detail.status === "published" ? "方案已下架，历史记录仍保留。" : "方案已重新上架。");
                    })
                  }
                >
                  {detail.status === "published" ? "下架方案" : "重新上架"}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() =>
                    void task(async () => {
                      await api.write("status", {
                        workflow_id: detail.id,
                        status: "deleted",
                      });
                      setDetail(null);
                      refresh((v) => v + 1);
                      notify("方案已软删除；历史快照、举报和事件仍可能保留。");
                    })
                  }
                >
                  删除方案（软删除）
                </button>
              </>
            ) : null}
          </div>
          {user?.id === detail.author_id ? (
            <div className="community-edit">
              <label>
                标题
                <input
                  aria-label="编辑方案标题"
                  value={title}
                  maxLength={100}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                描述
                <textarea
                  aria-label="编辑方案描述"
                  value={description}
                  maxLength={2000}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    await api.write("edit", {
                      workflow_id: detail.id,
                      ...metadata(title, description, detail.tags),
                    });
                    setDetail({ ...detail, title, description });
                    refresh((v) => v + 1);
                    notify("方案描述已保存。");
                  })
                }
              >
                保存描述
              </button>
            </div>
          ) : null}
          <div className="row">
            {versions.map((v) => (
              <button
                className="button"
                disabled={busy}
                key={v.version}
                onClick={() => void task(() => download(v.version))}
              >
                下载并预览 v{v.version}
              </button>
            ))}
          </div>
          {downloaded && preview ? (
            <div className="community-preview" aria-label="社区只读导入预览">
              <h3>
                {preview.name} · v{downloaded.version}
              </h3>
              <p>
                JSON v{preview.version} · {preview.nodes} 节点 ·{" "}
                {preview.subgraphs} 子图 · 固定种子{" "}
                {(downloaded.payload as { workflow: Workflow }).workflow.seed}
              </p>
              <p className="hash">
                SHA-256 {downloaded.content_hash}（内容检错，不是作者签名）
              </p>
              {preview.dependencies.map((d) => (
                <p key={d.id}>
                  {d.label}：{d.status}
                </p>
              ))}
              {preview.extensions.map((e) => (
                <p key={e.key}>
                  {e.key}：{e.status}
                </p>
              ))}
              <p>
                使用新 ID
                创建导入副本，不覆盖本地资源。确认后重新校验，失败整体回滚；未知扩展保持禁用。
              </p>
              <details>
                <summary>查看将导入的完整 JSON</summary>
                <pre>{JSON.stringify(downloaded.payload, null, 2)}</pre>
              </details>
              {preview.missing.length ? (
                <ImportBindings
                  key={`${downloaded.workflow_id}:${downloaded.version}`}
                  dependencies={preview.missing}
                  resources={resources}
                  onImport={(bindings) => task(() => confirm(bindings))}
                />
              ) : (
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void task(() => confirm())}
                >
                  确认采纳到本地工坊
                </button>
              )}
            </div>
          ) : null}
          {user ? (
            <div className="community-report">
              <input
                aria-label="举报原因"
                placeholder="举报原因（5–500字）"
                minLength={5}
                maxLength={500}
                value={report}
                onChange={(e) => setReport(e.target.value)}
              />
              <button
                className="button"
                disabled={busy || report.length < 5}
                onClick={() =>
                  void task(async () => {
                    await api.write("report", {
                      workflow_id: detail.id,
                      reason: report,
                    });
                    notify("举报已提交审核");
                    setReport("");
                  })
                }
              >
                提交举报
              </button>
              <button
                className="text-button"
                disabled={busy || report.length < 5}
                onClick={() =>
                  void task(async () => {
                    await api.write("moderate", {
                      workflow_id: detail.id,
                      reason: report,
                    });
                    setDetail(null);
                    refresh((v) => v + 1);
                  })
                }
              >
                审核下架（管理员）
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
      {publish ? (
        <section ref={publishPanel} tabIndex={-1} className="community-publish" aria-label="发布社区方案">
          <div className="eyebrow">PUBLIC SNAPSHOT</div>
          <h2>{target ? "创建不可变新版本" : "发布你的配方"}</h2>
          <p>
            选定工作流：{workflow.name}。只公开此工作流及勾选快照；完整 JSON
            可在下方审核。收藏、历史和无关资源不会加入。
          </p>
          <label>
            标题
            <input
              aria-label="发布标题"
              maxLength={100}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
            />
          </label>
          <label>
            描述
            <textarea
              aria-label="发布描述"
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <label>
            标签（逗号分隔）
            <input
              aria-label="发布标签"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </label>
          <div className="share-resources">
            {deps.map((r) => (
              <label key={r.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(r.id)}
                  onChange={(e) => {
                    setIds((old) =>
                      e.target.checked
                        ? [...old, r.id]
                        : old.filter((id) => id !== r.id),
                    );
                    setSnapshot(null);
                  }}
                />
                {r.name} · {r.kind} · v{r.version} · {r.count} 条
              </label>
            ))}
          </div>
          {needsExtensions ? (
            <label>
              <input
                type="checkbox"
                checked={extensionsOK}
                onChange={(e) => setExtensionsOK(e.target.checked)}
              />
              公开所需扩展声明（仅声明式 JSON，完整内容在预览中）
            </label>
          ) : null}
          {needsSubgraphs ? (
            <label>
              <input
                type="checkbox"
                checked={subgraphsOK}
                onChange={(e) => setSubgraphsOK(e.target.checked)}
              />
              公开工作流所需子图定义（完整内容在预览中）
            </label>
          ) : null}
          <div className="row">
            <button
              className="button"
              disabled={
                busy ||
                (needsExtensions && !extensionsOK) ||
                (needsSubgraphs && !subgraphsOK)
              }
              onClick={() => void task(prepare)}
            >
              生成公开内容预览
            </button>
            <button
              className="text-button"
              disabled={busy}
              onClick={closePanel}
            >
              取消发布
            </button>
          </div>
          {snapshot ? (
            <div className="community-preview">
              <p>
                公开内容 {new TextEncoder().encode(snapshotText).length}{" "}
                字节。以下 JSON
                是上传的完整快照，请检查所有词条、描述、注释与声明。
              </p>
              <pre aria-label="公开内容完整预览">{snapshotText}</pre>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() =>
                  void task(async () => {
                    await api.write("publish", {
                      workflow_id: target?.id,
                      expected_version: target?.current_version,
                      ...metadata(
                        title,
                        description,
                        tags
                          .split(/[,，]/)
                          .map((t) => t.trim())
                          .filter(Boolean),
                      ),
                      payload: snapshot,
                    });
                    setPublish(false);
                    setSnapshot(null);
                    refresh((v) => v + 1);
                    notify(
                      "方案已保存到" +
                        (api.mode === "demo" ? "本地演示" : "社区"),
                    );
                  })
                }
              >
                确认公开发布
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
