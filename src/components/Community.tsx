import { useEffect, useRef, useState } from "react";
import { community, enableDemo } from "../community/client";
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
    [liked, setLiked] = useState(false);
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
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [report, setReport] = useState(""),
    [hidden, setHidden] = useState<string[]>(() =>
      JSON.parse(localStorage.getItem("glyphforge-community-hidden") || "[]"),
    );
  const [queue, setQueue] = useState<unknown>(null);
  const [usage, setUsage] = useState({ pending: 0, error: "" });
  const [offlineReady, setOfflineReady] = useState(
    () => !!navigator.serviceWorker?.controller,
  );
  const controller = useRef<AbortController | null>(null),
    request = useRef(0);
  const api = community();
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
    let alive = true;
    void api
      .user()
      .then((u) => {
        if (alive) setUser(u);
      })
      .catch((e) => {
        if (alive) setError(String(e));
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
    setError("");
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
          setError(`社区暂不可用，已导入方案仍可本地运行。${String(e)}`);
      });
    return () => {
      alive = false;
    };
  }, [api, q, tag, sort, page, mine, revision]);
  async function task(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function login(method: "github" | "password") {
    await api.login(method, email, password);
    refresh((v) => v + 1);
    await flushUsage();
  }
  async function open(w: Listing) {
    const token = ++request.current;
    setDetail(w);
    setDownloaded(null);
    setPreview(null);
    setVersions([]);
    const [vs, l] = await Promise.all([api.versions(w.id), api.liked(w.id)]);
    if (token !== request.current) return;
    setVersions(vs);
    setLiked(l);
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
    <div className="page-content community-page">
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
        ) : (
          <>
            <input
              aria-label="社区登录邮箱"
              placeholder={api.mode === "demo" ? "演示账号名称" : "邮箱"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {api.mode !== "demo" ? (
              <input
                type="password"
                aria-label="社区登录密码"
                placeholder="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            ) : null}
            <button
              className="button"
              disabled={busy || api.mode === "unconfigured"}
              onClick={() => void task(() => login("password"))}
            >
              {api.mode === "demo" ? "演示登录" : "邮箱密码登录"}
            </button>
            <button
              className="button"
              disabled={busy || api.mode !== "cloud"}
              onClick={() => void task(() => login("github"))}
            >
              GitHub 登录
            </button>
          </>
        )}
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
        </p>
      ) : null}
      {usage.pending || usage.error ? (
        <p role="status">
          统计待同步 {usage.pending} 条。
          {usage.error ? "最近上报未被接受：" + usage.error : ""}{" "}
          本地导入和生成已独立保存。
        </p>
      ) : null}
      <div className="community-grid">
        {items
          .filter((w) => !hidden.includes(w.id))
          .map((w) => (
            <button
              className="community-card"
              key={w.id}
              onClick={() => void task(() => open(w))}
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
      {!items.length ? (
        <div className="community-empty">
          这里留给下一个好点子。发布你的第一个配方。
        </div>
      ) : null}
      <div className="row">
        <button
          className="button"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </button>
        <span>第 {page + 1} 页</span>
        <button
          className="button"
          disabled={items.length < 12}
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
        <section className="community-detail" aria-label="社区方案详情">
          <button
            className="text-button"
            onClick={() => {
              request.current++;
              setDetail(null);
              setPreview(null);
            }}
          >
            关闭详情
          </button>
          <h2>{detail.title}</h2>
          <p>{detail.description}</p>
          <p>
            作者 {detail.author} · 当前 v{detail.current_version} · 浏览{" "}
            {detail.views} · 点赞 {detail.likes} · 采纳 {detail.adoptions} ·
            运行 {detail.runs}
          </p>
          <div className="row">
            <button
              className="button"
              disabled={!user || busy}
              aria-pressed={liked}
              onClick={() =>
                void task(async () => {
                  await api.write("like", {
                    workflow_id: detail.id,
                    liked: !liked,
                  });
                  setLiked(!liked);
                  setDetail({
                    ...detail,
                    likes: detail.likes + (liked ? -1 : 1),
                  });
                  refresh((v) => v + 1);
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
        <section className="community-publish" aria-label="发布社区方案">
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
              onClick={() => {
                controller.current?.abort();
                setPublish(false);
                setSnapshot(null);
              }}
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
