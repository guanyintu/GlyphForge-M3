import LineagePanel from "./components/LineagePanel";
import { ExecutionEstimate } from "./components/ExecutionEstimate";
import { PacksPanel } from "./components/Packs";
import "./p2c.css";
import { DefinedResourceEditor } from "./components/DefinedResources";
import Subgraphs from "./components/Subgraphs";
import Mutation from "./components/Mutation";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Command,
  Copy,
  FlaskConical,
  GitBranch,
  LayoutDashboard,
  Leaf,
  Loader2,
  PanelLeftClose,
  Play,
  Plus,
  Redo2,
  Search,
  Settings2,
  Sparkles,
  Square,
  Star,
  Undo2,
  WandSparkles,
  Workflow as WorkflowIcon,
  X,
} from "lucide-react";
import GraphEditor, { Inspector, NodeLibrary } from "./components/GraphEditor";
import Results from "./components/Results";
import RunHistory from "./components/RunHistory";
import { acquireRunLock, beginRun, finishRun, recoverRuns, pruneHistory, historyLimit, toggleFavorite } from "./storage/run-lifecycle";
import { ResourceModal, ResourcePage } from "./components/Resources";
import { ReverseSearch } from "./components/Tools";
import { TextLab } from "./components/TextLab";
import { db, initialize, saveNewResource } from "./storage/db";
import { createWorkflow, operators, unicodeMetrics } from "./core/model";
import type { Candidate, Op, Resource, Workflow } from "./core/model";
import { parseScript, toScript, validateGraph } from "./core/script";
import {
  exportPackage,
  importPackage,
  ResourceDependencyError,
  dependencyIds,
} from "./core/sharing";
import { SharePanel, ImportBindings } from "./components/Sharing";
import type { Dependency } from "./core/sharing";
import type { RunStats } from "./core/engine";
import {
  copyNodes,
  pasteNodes,
  groupNodes,
  WorkflowHistory,
  autoLayout,
} from "./core/graph-editing";
import { parseProgram } from "./core/program";
import ProgramBuilder from "./components/ProgramBuilder";
import BenchmarkPanel from "./components/BenchmarkPanel";
import { RelationEditor } from "./components/RelationEditor";
import { createRelationRecipe, ensureRecipeExamples, relationRecipes } from "./core/recipes";
import { workflowFromMatches } from "./core/reverse-workflow";
import { relationLabels } from "./core/relations";
import { oauthReturnUrl } from "./community/oauth-return";

type Page = "community" | "packs" | "workflow" | "resources" | "lab" | "reverse" | "favorites";
const Community = lazy(() => import('./components/Community'));
const CodeMirror = lazy(() => import("@uiw/react-codemirror"));
const pageNames: Record<Page, string> = {
  community: "社区广场",
  packs: "算子扩展包",
  workflow: "工作流工坊",
  resources: "资源中心",
  lab: "文字实验室",
  reverse: "逆向查找",
  favorites: "我的收藏",
};
let bootPromise: Promise<Workflow> | undefined;
function bootstrap() {
  return (bootPromise ||= (async () => {
    await initialize();
    await recoverRuns();
    if (!(await db.workflows.count()))
      await db.workflows.bulkAdd([
        createWorkflow(),
        createWorkflow("echo"),
        createWorkflow("mirror"),
      ]);
    const id = localStorage.getItem("glyphforge-active");
    return (
      (id ? await db.workflows.get(id) : undefined) ||
      (await db.workflows.where("name").equals("宇宙浪漫命名器").first()) ||
      (await db.workflows.toArray())[0]
    );
  })().catch(error => { bootPromise = undefined; throw error; }));
}
export default function App() {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState("");
  const [bootAttempt, setBootAttempt] = useState(0);
  const [subgraphsOpen, setSubgraphsOpen] = useState(false);
  const [page, setPage] = useState<Page>(() => oauthReturnUrl() ? "community" : "workflow");
  const [workflow, setWorkflow] = useState<Workflow>(createWorkflow);
  const currentWorkflow = useRef(workflow);
  currentWorkflow.current = workflow;
  const [selected, setSelected] = useState("mix");
  const [selection, setSelection] = useState<string[]>(["mix"]);
  const [view, setView] = useState("nodes");
  const [code, setCode] = useState("");
  const [codeDirty, setCodeDirty] = useState(false);
  const codeDirtyRef = useRef(false);
  const [codeError, setCodeError] = useState("");
  const [mobileInspect, setMobileInspect] = useState(false);
  const [library, setLibrary] = useState(false);
  const [toast, setToast] = useState("");
  const [saveState, setSaveState] = useState("已保存到本地");
  const [reverseInput, setReverseInput] = useState("");
  const [resourceQueryText, setResourceQueryText] = useState("");
  const [resource, setResource] = useState<Resource>();
  const [modal, setModal] = useState<
    | "help"
    | "settings"
    | "presets"
    | "program"
    | "benchmark"
    | "share"
    | "bindings"
    | null
  >(null);
  const [detail, setDetail] = useState<Candidate>();
  const [mutation, setMutation] = useState<Candidate>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<RunStats>();
  const [running, setRunning] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    data: unknown;
    dependencies: Dependency[];
  }>();
  const detailRun = useLiveQuery(
    () => (detail?.runId ? db.runs.get(detail.runId) : undefined),
    [detail?.runId],
  );
  const [progress, setProgress] = useState("");
  const activeRun = useRef("");
  const releases = useRef(new Map<string, () => void>());
  const worker = useRef<Worker | null>(null);
  const history = useRef(new WorkflowHistory());
  const fileInput = useRef<HTMLInputElement>(null);
  const firstRun = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const resources = useLiveQuery(() => db.resources.toArray(), []) || [];
  const favorites =
    useLiveQuery(
      () => db.favorites.orderBy("savedAt").reverse().toArray(),
      [],
    ) || [];
  const workflows = useLiveQuery(() => db.workflows.toArray(), []) || [];
  const previews =
    useLiveQuery(
      async () =>
        Object.fromEntries(
          await Promise.all(
            resources.map(async (r) => [
              r.id,
              r.kind === "relation" ? (await db.relations.where({ resourceId: r.id }).limit(6).toArray()).map(row => `${row.left} ↔ ${row.right}`) : (
                await db.entries.where({ resourceId: r.id }).limit(6).toArray()
              ).map((e) => e.text),
            ]),
          ),
        ),
      [resources.map((r) => `${r.id}-${r.version}`).join(",")],
    ) || {};
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  }, []);
  useEffect(() => {
    let active = true;
    setBootError("");
    bootstrap()
      .then((w) => {
        if (active) {
          setWorkflow(w);
          const initial =
            w.nodes.find((n) => n.op === "pattern" || n.op === "program")?.id ||
            w.nodes[0]?.id ||
            "";
          setSelected(initial);
          setSelection(initial ? [initial] : []);
          setReady(true);
        }
      })
      .catch((e) => { if (active) setBootError(`本地数据库无法打开：${e.message}`); });
    return () => {
      active = false;
    };
  }, [bootAttempt]);
  useEffect(() => {
    if (!ready) return;
    setSaveState("正在保存…");
    const timeout = setTimeout(() => {
      db.workflows
        .put(workflow)
        .then(() => {
          if (currentWorkflow.current !== workflow) return;
          localStorage.setItem("glyphforge-active", workflow.id);
          setSaveState("已保存到本地");
        })
        .catch(() => { if (currentWorkflow.current === workflow) setSaveState("保存失败，请导出备份"); });
    }, 650);
    return () => clearTimeout(timeout);
  }, [workflow, ready]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (codeDirtyRef.current || saveState !== "已保存到本地") {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);
  useEffect(() => {
    if (view !== "nodes" && !codeDirtyRef.current && !codeDirty)
      setCode(toScript(workflow));
  }, [workflow, view, codeDirty]);
  useEffect(() => {
    if (!resource && !modal && !detail) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1);
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, [tabindex="0"]',
        ) || [],
      );
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = focusable();
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", trap);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [resource, modal, detail]);
  const change = useCallback(
    (next: Workflow, remember = true) => {
      if (remember) {
        history.current.push(workflow);
      }
      setWorkflow(next);
    },
    [workflow],
  );
  const run = useCallback(
    (override?: Workflow) => {
      const executable = override || workflow;
      try {
        if (codeDirty && !override) throw new Error("代码已修改，请先点击「应用到节点」");
        validateGraph(executable);
      } catch (e) {
        notify(e instanceof Error ? e.message : "工作流错误");
        return;
      }
      const previousId = activeRun.current;
      if (worker.current && previousId) void finishRun(previousId, "cancelled", "由新的运行替代").catch(e => notify(String(e))).finally(() => { releases.current.get(previousId)?.(); releases.current.delete(previousId); });
      worker.current?.terminate();
      const w = new Worker(
        new URL("./workers/execution.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      setCandidates([]);
      setStats(undefined);
      setRunning(true);
      setProgress("正在准备资源…");
      const id = crypto.randomUUID();
      activeRun.current = id;
      let release: (() => void) | undefined;
      let startupStatus: "cancelled" | "done" | "error" | "interrupted" = "cancelled";
      const deadline = setTimeout(() => { if (worker.current === w) void end("interrupted", "执行环境无响应，已强制停止"); }, 12000);
      async function end(status: "done" | "error" | "interrupted", message = "") {
        if (worker.current !== w) return;
        startupStatus = status;
        w.terminate(); worker.current = null;
        clearTimeout(deadline); setRunning(false); setProgress("");
        if (message) notify(message);
        try { await finishRun(id, status, message); if (status === 'done' && executable.communityOrigin) void import('./community/local').then(m => m.recordSuccessfulRun(executable, id)).catch(() => {}); await pruneHistory(historyLimit()); }
        catch (e) { notify(`运行状态或历史清理失败：${e instanceof Error ? e.message : String(e)}`); }
        finally { release?.(); releases.current.delete(id); }
      }
      w.onmessage = (event) => {
        if (worker.current !== w) return;
        if (event.data.type === "started") {
          activeRun.current = event.data.runId;
          return;
        }
        if (event.data.type === "progress") {
          setProgress(
            `已执行 ${event.data.steps.toLocaleString()} 步 · ${event.data.count} 个结果 · ${(event.data.elapsed / 1000).toFixed(1)}s`,
          );
          return;
        }
        if (event.data.type === "batch")
          setCandidates((old) => [...old, ...event.data.batch]);
        else {
          if (event.data.type === "done") setStats(event.data.stats);
          void end(event.data.type === "done" ? "done" : "error", event.data.type === "done" ? "" : event.data.message);
        }
      };
      w.onerror = () => { void end("interrupted", "执行环境发生错误，请重新运行"); };
      void (async () => {
        try {
          release = await acquireRunLock(id);
          await beginRun(executable, id);
          if (worker.current !== w) {
            await finishRun(id, startupStatus, "任务在启动时结束");
            await pruneHistory(historyLimit()); clearTimeout(deadline); release(); return;
          }
          w.postMessage({ workflow: executable, runId: id, keep: historyLimit() });
          // Release only after termination/status persistence; page death releases the lock automatically.
          releases.current.set(id, () => { clearTimeout(deadline); release?.(); });
        } catch (e) { await end("error", e instanceof Error ? e.message : String(e)); release?.(); }
      })();
    },
    [workflow, codeDirty, notify],
  );
  useEffect(() => {
    if (ready && !firstRun.current) {
      firstRun.current = true;
      run();
    }
  }, [ready, run]);
  useEffect(
    () => () => {
      worker.current?.terminate();
      const id = activeRun.current;
      if (id) void finishRun(id, "interrupted", "界面已卸载").catch(() => {}).finally(() => {
        releases.current.get(id)?.(); releases.current.delete(id);
      });
      clearTimeout(toastTimer.current);
    },
    [],
  );
  function stopRun(message: string) {
    const id = worker.current ? activeRun.current : "";
    worker.current?.terminate();
    worker.current = null;
    setRunning(false);
    setProgress("");
    if (id) void finishRun(id, "cancelled", message)
      .then(() => pruneHistory(historyLimit()))
      .catch(e => notify(`停止状态或历史清理失败：${String(e)}`))
      .finally(() => { releases.current.get(id)?.(); releases.current.delete(id); });
  }
  function stop() {
    stopRun("用户停止生成");
    notify("任务已停止，已生成的结果仍然保留");
  }
  function undo() {
    const prev = history.current.undo(workflow);
    if (prev) {
      setWorkflow(prev);
    }
  }
  function redo() {
    const next = history.current.redo(workflow);
    if (next) {
      setWorkflow(next);
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制到剪贴板");
    } catch {
      notify("浏览器无法访问剪贴板，请使用导出功能");
    }
  }
  async function copyNode() {
    const ids = selection.length ? selection : selected ? [selected] : [];
    if (ids.length) await copy(JSON.stringify(copyNodes(workflow, ids)));
  }
  async function pasteNode() {
    try {
      const data = JSON.parse(await navigator.clipboard.readText());
      if (data?.format === "glyphforge") {
        await receiveImport(data);
        return;
      }
      const result = pasteNodes(workflow, data);
      change(result.workflow);
      setSelection(result.ids);
      setSelected(result.ids[0]);
      const missing = dependencyIds({ ...result.workflow, nodes: result.workflow.nodes.filter(n => result.ids.includes(n.id)) })
        .filter((id) => !resources.some((r) => r.id === id));
      notify(
        `已粘贴 ${result.ids.length} 个节点${result.disconnected ? "，外部输入需重新连线" : ""}${missing.length ? "；存在缺失词库，请在参数中重新绑定" : ""}`,
      );
    } catch (e) {
      notify(
        e instanceof Error ? e.message : "剪贴板中没有可用的 GlyphForge 节点",
      );
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const input = (e.target as HTMLElement).closest(
        "input,textarea,[contenteditable=true]",
      );
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (codeDirtyRef.current) { notify("有未应用的代码，请先应用到节点或放弃代码修改"); return; }
        void db.workflows.put(workflow).then(() => {
          if (currentWorkflow.current === workflow) { localStorage.setItem("glyphforge-active", workflow.id); setSaveState("已保存到本地"); }
          notify("工作流已保存");
        }).catch(() => notify("保存失败，请导出备份"));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        run();
      }
      if (
        !input &&
        page === "workflow" &&
        !modal &&
        !resource &&
        !detail &&
        (e.ctrlKey || e.metaKey)
      ) {
        if (e.key === "z") {
          e.preventDefault();
          if (e.shiftKey) redo();
          else undo();
        }
        if (e.key === "c") {
          e.preventDefault();
          void copyNode();
        }
        if (e.key === "v") {
          e.preventDefault();
          void pasteNode();
        }
      }
      if (e.key === "Escape") {
        setModal(null);
        setResource(undefined);
        setDetail(undefined);
        setLibrary(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function createResource(texts?: Candidate[]) {
    const id = crypto.randomUUID();
    const meta: Resource = {
      id,
      name: texts ? "收藏的灵感" : "未命名词库",
      description: texts ? "从灵感产物中留下的文字。" : "属于你的新灵感。",
      kind: "word",
      color: "green",
      count: 0,
      version: 1,
      updatedAt: Date.now(),
    };
    const saved = await saveNewResource(meta, texts?.map(c => c.text) || []);
    setResource(saved);
  }
  async function createRelationResource() {
    try {
      const meta: Resource = { id: crypto.randomUUID(), name: "未命名关系词库", description: "成对保存彼此呼应的文字。", kind: "relation", color: "purple", count: 0, version: 1, updatedAt: Date.now() };
      await db.resources.add(meta); setResource(meta);
    } catch { notify("关系词库创建失败"); }
  }
  async function favorite(c: Candidate) {
    try {
      await toggleFavorite(c);
    } catch (error) {
      notify(error instanceof Error ? error.message : "收藏保存失败");
    }
  }
  function addNode(op: Op) {
    const id = `node_${Date.now().toString(36)}`;
    const inputs = Array.from({ length: operators[op].inputs }, (_, i) =>
      i === 0 ? selected : "",
    );
    change({
      ...workflow,
      nodes: [
        ...workflow.nodes,
        {
          id,
          op,
          inputs,
          params: { ...operators[op].defaults },
          ...(op === "program"
            ? {
                program: parseProgram(
                  'for a in @animals {\n  for b in @moods {\n    let name = pattern("AABB", a, b);\n    if length(name) <= 4 { emit(name); }\n  }\n}',
                ),
              }
            : {}),
        },
      ],
      layout: { ...workflow.layout, [id]: { x: 400, y: 370 } },
    });
    setSelected(id);
    setSelection([id]);
    if (op === "program") setModal("program");
  }
  function switchWorkflow(w: Workflow) {
    if (codeDirtyRef.current) {
      setPage("workflow"); setView("code"); setSidebarOpen(false);
      notify("有未应用的代码，请先应用到节点或放弃代码修改");
      return;
    }
    setSidebarOpen(false);
    void db.workflows
      .put(workflow)
      .catch(() => notify("切换前保存失败，请导出备份"));
    stopRun("切换工作流停止执行");
    currentWorkflow.current = w;
    setSaveState("正在保存…");
    // Persist a newly created recipe too, before publishing its durable selection.
    // A previous autosave may finish after this switch; it cannot select the old ID.
    void db.workflows.put(w).then(() => {
      if (currentWorkflow.current !== w) return;
      localStorage.setItem("glyphforge-active", w.id);
      setSaveState("已保存到本地");
    }).catch(() => {
      if (currentWorkflow.current === w) setSaveState("保存失败，请导出备份");
    });
    setWorkflow(w);
    setCandidates([]);
    setStats(undefined);
    setSelected(
      w.nodes.find((n) => n.op === "pattern")?.id || w.nodes[0]?.id || "",
    );
    setCodeDirty(false);
    setSelection([]);
    setView("nodes");
    setPage("workflow");
    history.current.clear();
    codeDirtyRef.current = false;
  }
  async function saveExport() {
    if (codeDirtyRef.current) { setView("code"); notify("有未应用的代码，请先应用到节点或放弃代码修改再导出"); return; }
    setModal("share");
  }
  async function receiveImport(
    data: unknown,
    bindings: Record<string, string> = {},
  ) {
    if (codeDirtyRef.current) { notify("有未应用的代码，请先应用到节点或放弃代码修改再导入"); return; }
    try {
      const w = await importPackage(data, bindings);
      switchWorkflow(w);
      setPendingImport(undefined);
      setModal(null);
      notify("工作流与依赖已恢复，可以重新运行");
    } catch (e) {
      if (e instanceof ResourceDependencyError) {
        setPendingImport({ data, dependencies: e.dependencies });
        setModal("bindings");
      } else notify(e instanceof Error ? e.message : String(e));
    }
  }
  function previewNode() {
    if (!selectedNode) return;
    const needed = new Set<string>();
    function visit(id: string) {
      if (needed.has(id)) return;
      needed.add(id);
      workflow.nodes.find((n) => n.id === id)?.inputs.forEach(visit);
    }
    visit(selectedNode.id);
    const nodes = workflow.nodes.filter(
      (n) => needed.has(n.id) && n.op !== "output",
    );
    nodes.push({
      id: "debug_output",
      op: "output",
      inputs: [
        selectedNode.op === "output" ? selectedNode.inputs[0] : selectedNode.id,
      ],
      params: {},
    });
    run({
      ...workflow,
      name: `节点预览 · ${selectedNode.id}`,
      nodes,
      limit: 20,
    });
    notify("正在预览所选节点，最多输出 20 条");
  }
  const nav = [
    { id: "community", icon: Leaf },
    { id: "workflow", icon: WorkflowIcon },
    { id: "resources", icon: BookOpen },
    { id: "lab", icon: FlaskConical },
    { id: "reverse", icon: Search },
    { id: "packs", icon: Sparkles },
  ];
  const selectedNode = workflow.nodes.find((n) => n.id === selected);
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        跳到工作区
      </a>
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setPage("workflow");
          }}
        >
          <span className="brand-mark">
            <Sparkles size={25} fill="currentColor" />
          </span>
          <span>
            GlyphForge<small>文字创作工坊</small>
          </span>
          <span className="beta">BETA</span>
        </a>
        <div className="sidebar-label">你的创作空间</div>
        <nav>
          {nav.map((n) => (
            <button
              className={`nav-item ${page === n.id ? "active" : ""}`}
              key={n.id}
              aria-current={page === n.id ? "page" : undefined}
              onClick={() => {
                setPage(n.id as Page);
                setSidebarOpen(false);
              }}
            >
              <n.icon size={18} />
              <span>{pageNames[n.id as Page]}</span>
              {n.id === "resources" ? (
                <span className="nav-count">{resources.length}</span>
              ) : n.id === "workflow" && page === "workflow" ? (
                <span className="nav-active-dot" />
              ) : null}
            </button>
          ))}
          <div className="nav-divider" />
          <button
            className={`nav-item ${page === "favorites" ? "active" : ""}`}
            aria-current={page === "favorites" ? "page" : undefined}
            onClick={() => { setPage("favorites"); setSidebarOpen(false); }}
          >
            <Star size={18} />
            <span>我的收藏</span>
            <span className="nav-count">{favorites.length}</span>
          </button>
        </nav>
        <div className="sidebar-section-heading">
          <span>我的工作流</span>
          <button
            className="icon-button"
            aria-label="新建工作流"
            onClick={() => {
              switchWorkflow({
                ...createWorkflow(),
                name: "未命名的灵感",
                nodes: [],
                layout: {},
              });
              notify("新工作流已创建");
            }}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="saved-workflows">
          {workflows.map((w) => (
            <button
              key={w.id}
              className={
                workflow.id === w.id && page === "workflow" ? "current" : ""
              }
              onClick={() => {
                if (w.id === workflow.id) { setPage("workflow"); setSidebarOpen(false); }
                else switchWorkflow(w);
              }}
            >
              <span className="workflow-file-icon">
                <GitBranch size={14} />
              </span>
              <span>{w.name}</span>
              {w.id === workflow.id ? <span className="tiny-dot" /> : null}
            </button>
          ))}
        </div>
        <button
          className="sidebar-template"
          onClick={() => setModal("presets")}
        >
          <WandSparkles size={17} />
          <span>
            从灵感配方开始<small>一点小规则，无限种可能</small>
          </span>
          <ChevronRight size={15} />
        </button>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span className="local-status-icon">
              <Leaf size={17} />
            </span>
            <span>
              灵感留在本地<small>无需账号，随时创作</small>
            </span>
            <span className="tiny-dot" />
          </div>
          <button className="sidebar-help" onClick={() => setModal("help")}>
            <CircleHelp size={15} />
            使用指南与快捷键
            <ArrowUpFromLine size={13} />
          </button>
        </div>
      </aside>
      {sidebarOpen ? (
        <button
          className="mobile-sidebar-backdrop"
          aria-label="关闭侧栏"
          onClick={() => setSidebarOpen(false)}
        />
      ) : null}
      <main id="main" className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="展开侧栏"
            >
              <PanelLeftClose size={18} />
            </button>
            <span className="workspace-symbol">
              <Command size={16} />
            </span>
            <span>个人工作空间</span>
            <ChevronRight size={13} />
            <b>{pageNames[page]}</b>
          </div>
          <div className="topbar-right">
            <span className="local-pill">
              <span className="tiny-dot" />
              本地优先
            </span>
            <button
              className="icon-button"
              aria-label="使用指南"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={18} />
            </button>
            <span className="avatar">G</span>
          </div>
        </header>
        {!ready ? (
          <div className="loading-state">
            {bootError ? <div className="startup-error" role="alert">
              <h1>暂时无法打开文字工坊</h1>
              <p>{bootError}</p>
              <p>请检查浏览器是否允许此站点保存本地数据，再重试。已有数据不会被清除。</p>
              <button className="primary-button" onClick={() => { db.close(); void db.open().then(() => setBootAttempt(n => n + 1)).catch(error => setBootError(`本地数据库无法打开：${error.message}`)); }}>重试打开</button>
            </div> : <>
            <Loader2 className="spin" />
            <p>正在打开你的文字工坊…</p>
            </>}
          </div>
        ) : page === "workflow" ? (
          <div className="workflow-page">
            {subgraphsOpen ? <Subgraphs workflow={workflow} selection={selection} resources={resources} previews={previews} onChange={change} onClose={() => setSubgraphsOpen(false)} /> : null}
            <h1 className="sr-only">工作流创作工坊</h1>
            <div className="workflow-heading">
              <div>
                <div className="eyebrow">
                  <span className="tiny-dot" />
                  一点规则，无限灵感
                </div>
                <div className="workflow-name-row">
                  <input
                    aria-label="工作流名称"
                    value={workflow.name}
                    maxLength={60}
                    onChange={(e) =>
                      change({ ...workflow, name: e.target.value })
                    }
                  />
                  <button
                    className="icon-button"
                    title="选择配方"
                    onClick={() => setModal("presets")}
                  >
                    <ChevronDown size={17} />
                  </button>
                </div>
                <p>把喜欢的文字连接起来，创造下一个独一无二的名字。</p>
              </div>
              <div className="workflow-heading-actions">
                <button
                  className="button"
                  onClick={() => fileInput.current?.click()}
                >
                  <ArrowUpFromLine size={15} />
                  导入
                </button>
                <button className="button" onClick={saveExport}>
                  <ArrowDownToLine size={15} />
                  导出工作流
                </button>
                <button
                  className={`primary-button run-button ${running ? "is-running" : ""}`}
                  onClick={() => (running ? stop() : run())}
                >
                  {running ? (
                    <Square size={14} />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                  {running ? "停止生成" : "运行工作流"}
                  <kbd>Ctrl ↵</kbd>
                </button>
              </div>
            </div>
            <ExecutionEstimate workflow={workflow} stats={stats} dirty={codeDirty} />
            {!workflow.nodes.length ? <section className="workflow-start" aria-label="开始创作">
              <Sparkles size={24} />
              <div><h2>从词库到名字，只需三步</h2><p>准备词库 → 添加并连接节点 → 运行、筛选并收藏。可以先用示例，再换成自己的词库。</p></div>
              <button className="primary-button" onClick={() => setModal("presets")}>选一个示例配方</button>
              <button className="button" onClick={() => { addNode("resource"); setMobileInspect(true); }}>添加词库节点</button>
            </section> : null}
            {codeDirty ? <p className="draft-notice" role="status">代码修改尚未应用，也未保存到工作流。请在 NameScript 中应用或放弃后再切换、导出。</p> : null}
            <section className="studio">
              <div className="studio-toolbar">
                <div className="editor-tabs">
                  {[
                    { id: "nodes", name: "节点画布", icon: WorkflowIcon },
                    { id: "code", name: "NameScript", icon: Code2 },
                    { id: "split", name: "分屏", icon: LayoutDashboard },
                  ].map((t) => (
                    <button
                      key={t.id}
                      className={view === t.id ? "active" : ""}
                      onClick={() => {
                        if (t.id !== "nodes" && !codeDirty)
                          setCode(toScript(workflow));
                        setView(t.id);
                      }}
                    >
                      <t.icon size={15} />
                      {t.name}
                    </button>
                  ))}
                </div>
                <div className="studio-tools">
                  <span className="save-status">
                    <Check size={12} />
                    {saveState}
                  </span>
                  <button
                    className="icon-button"
                    title="撤销 Ctrl+Z"
                    aria-label="撤销"
                    onClick={undo}
                    disabled={!history.current.canUndo}
                  >
                    <Undo2 size={16} />
                  </button>
                  <button
                    className="icon-button"
                    title="重做 Ctrl+Shift+Z"
                    aria-label="重做"
                    onClick={redo}
                    disabled={!history.current.canRedo}
                  >
                    <Redo2 size={16} />
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button mobile-inspector-toggle"
                    aria-label="打开节点设置"
                    onClick={() => setMobileInspect(!mobileInspect)}
                  >
                    <Settings2 size={15} />
                  </button>
                  <button
                    className="add-node-button"
                    onClick={() => setLibrary(!library)}
                  >
                    <Plus size={15} />
                    添加节点
                  </button>
                  {library ? (
                    <NodeLibrary
                      onAdd={addNode}
                      onClose={() => setLibrary(false)}
                    />
                  ) : null}
                </div>
              </div>
              <div
                className={`studio-body ${view} ${mobileInspect ? "inspector-mobile-open" : ""}`}
              >
                <div className="editor-area">
                  {view !== "code" ? (
                    <div className="canvas-wrapper">
                      <div className="canvas-caption">
                        <span className="tiny-dot" />
                        {workflow.nodes.length} 个节点<span>·</span>
                        拖动连接你的想法
                      </div>
                      <GraphEditor
                        workflow={workflow}
                        resources={resources}
                        previews={previews}
                        selection={selection}
                        onSelection={(ids) =>
                          setSelection((old) =>
                            old.join(",") === ids.join(",") ? old : ids,
                          )
                        }
                        onDragStart={() => {
                          history.current.push(workflow);
                        }}
                        onSelect={(id) => {
                          setSelected(id);
                          setMobileInspect(true);
                        }}
                        onChange={change}
                      />
                      <div className="canvas-shortcuts">
                        <button onClick={() => setSubgraphsOpen(true)}>子图与函数</button>
                        <span>滚轮缩放</span>
                        <span>拖动画布平移</span>
                        <button title="复制所选节点 Ctrl+C" onClick={copyNode}>
                          <Copy size={12} />
                          复制 {selection.length || 1} 个节点
                        </button>
                        <button title="粘贴节点 Ctrl+V" onClick={pasteNode}>
                          粘贴
                        </button>
                        <button
                          onClick={() =>
                            setSelection(workflow.nodes.map((n) => n.id))
                          }
                        >
                          全选
                        </button>
                        <button onClick={() => change(autoLayout(workflow))}>
                          自动布局
                        </button>
                        <button
                          disabled={!selection.length}
                          onClick={() =>
                            change(
                              groupNodes(
                                workflow,
                                selection,
                                `节点组 ${(workflow.groups?.length || 0) + 1}`,
                              ),
                            )
                          }
                        >
                          分组
                        </button>
                        <button
                          onClick={async () => {
                            try {
                              await copy(
                                JSON.stringify(
                                  await exportPackage(workflow, false),
                                ),
                              );
                            } catch (e) {
                              notify(String(e));
                            }
                          }}
                        >
                          复制工作流
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {view !== "nodes" ? (
                    <div className="code-area">
                      <div className="code-toolbar">
                        <span>
                          <Code2 size={14} /> {workflow.name}.ns
                        </span>
                        {codeDirty ? <button className="text-button" onClick={() => {
                          setCode(toScript(workflow)); setCodeError(""); setCodeDirty(false); codeDirtyRef.current = false;
                        }}>放弃代码修改</button> : null}
                        <button
                          className="button"
                          onClick={() => {
                            try {
                              const next = parseScript(code, workflow);
                              change(next);
                              if (!next.nodes.some((n) => n.id === selected)) {
                                setSelected(next.nodes[0].id);
                                setSelection([next.nodes[0].id]);
                              }
                              setCodeError("");
                              setCodeDirty(false);
                              codeDirtyRef.current = false;
                              notify("代码已应用到节点，运行语义已同步");
                            } catch (e) {
                              setCodeError(
                                e instanceof Error ? e.message : "解析失败",
                              );
                            }
                          }}
                        >
                          {codeDirty ? "应用到节点" : "已同步"}
                          <ArrowLeft size={14} />
                        </button>
                      </div>
                      <Suspense
                        fallback={
                          <div className="loading-state">
                            正在打开代码编辑器…
                          </div>
                        }
                      >
                        <CodeMirror
                          value={code}
                          height="100%"
                          onChange={(value) => {
                            codeDirtyRef.current = true;
                            setCode(value);
                            setCodeDirty(true);
                          }}
                          basicSetup={{
                            foldGutter: false,
                            highlightActiveLine: true,
                          }}
                          aria-label="NameScript 代码编辑器"
                        />
                      </Suspense>
                      {codeError ? (
                        <div className="code-error">{codeError}</div>
                      ) : (
                        <div className="code-note">
                          {codeDirty ? "有未应用的代码修改" : "语义已同步"} ·
                          支持 resource / pattern / concat / filter / prefix /
                          reverse / pairs / template / group / output / sequence；for / if / else / emit
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
                {view !== "code" ? (
                  <Inspector
                    workflow={workflow}
                    onWorkflowChange={change}
                    onPreview={previewNode}
                    onEditProgram={() => setModal("program")}
                    onClose={() => setMobileInspect(false)}
                    node={selectedNode}
                    resources={resources}
                    onUpdate={(n) =>
                      change({
                        ...workflow,
                        nodes: workflow.nodes.map((x) =>
                          x.id === n.id ? n : x,
                        ),
                      })
                    }
                    onDelete={() => {
                      change({
                        ...workflow,
                        nodes: workflow.nodes
                          .filter((n) => n.id !== selected)
                          .map((n) => ({
                            ...n,
                            inputs: n.inputs.map((id) =>
                              id === selected ? "" : id,
                            ),
                          })),
                      });
                      setSelected("");
                    }}
                  />
                ) : null}
              </div>
              <div className="studio-footer">
                {running ? (
                  <span role="status" className="execution-progress">
                    {progress}
                  </span>
                ) : null}
                <span>
                  <GitBranch size={12} />
                  无环数据流<span className="footer-separator">/</span>
                  {dependencyIds(workflow).length} 个资源引用
                </span>
                <button onClick={() => setModal("settings")}>
                  <Settings2 size={12} />
                  种子 {workflow.seed}
                  <span className="footer-separator">·</span>最多{" "}
                  {workflow.limit.toLocaleString()} 个结果
                </button>
              </div>
            </section>
            <Results
              candidates={candidates}
              favorites={favorites}
              stats={stats}
              running={running}
              onFavorite={favorite}
              onSave={createResource}
              onCopy={copy}
              onDetail={setDetail}
              onMutate={setMutation}
            />
            <RunHistory onDetail={setDetail} />
            <div className="workspace-bottom-note">
              <span>让每一个 ID，都有一点你的样子。</span>
              <span>
                GLYPHFORGE <i>✦</i> MADE FOR YOUR IMAGINATION
              </span>
            </div>
          </div>
        ) : page === "community" ? (<Suspense fallback={<p>正在打开社区…</p>}><Community workflow={workflow} resources={resources} onUse={switchWorkflow} notify={notify} canPublish={!codeDirty} /></Suspense>) : page === "packs" ? (<PacksPanel workflow={workflow} onChange={w => { switchWorkflow(w); }} notify={notify} />) : page === "resources" ? (
          <ResourcePage
            resources={resources}
            previews={previews}
            notify={notify}
            onEdit={r => { setResourceQueryText(""); setResource(r); }}
            onCreate={() => void createResource()}
            onCreateRelation={() => void createRelationResource()}
          />
        ) : page === "lab" ? (
          <TextLab onSave={createResource} onCopy={copy} />
        ) : page === "reverse" ? (
          <ReverseSearch
            onDetail={setDetail}
            resources={resources}
            initial={reverseInput}
            onResource={async (r, entryId) => { setResourceQueryText(entryId ? (await db.entries.get(entryId))?.text || "" : ""); setResource(r); }}
            onUse={matches => { switchWorkflow(workflowFromMatches(matches)); notify("已创建引用真实资源的工作流，运行后可生成命中片段组合"); }}
          />
        ) : (
          <div className="page-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">KEEP THE LITTLE SPARKS</div>
                <h1>
                  留住心动的那一个<span className="heading-dot">.</span>
                </h1>
                <p>收集好名字，让它们成为下一次创作的起点。</p>
              </div>
              <Star size={30} />
            </div>
            <Results
              onlyFavorites
              candidates={candidates}
              favorites={favorites}
              running={false}
              onFavorite={favorite}
              onSave={createResource}
              onCopy={copy}
              onDetail={setDetail}
              onMutate={setMutation}
            />
          </div>
        )}
      </main>
      {mutation ? <Mutation initial={mutation} resources={resources} candidates={candidates} favorites={favorites} running={running} onRun={run} onStop={() => stopRun("用户取消变异")} onClose={() => setMutation(undefined)} onFavorite={favorite} onSave={createResource} onCopy={copy} onDetail={setDetail} /> : null}
      <input
        ref={fileInput}
        type="file"
        accept=".json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 15 * 1024 * 1024)
              throw new Error("导入文件最大 15 MB");
            await receiveImport(JSON.parse(await f.text()));
          } catch (err) {
            notify(err instanceof Error ? err.message : "导入失败");
          }
          e.target.value = "";
        }}
      />
      {resource?.definition ? <DefinedResourceEditor key={resource.id} resource={resource} currentWorkflow={workflow} onUse={w=>{switchWorkflow(w);setPage("workflow");}} onClose={()=>setResource(undefined)} notify={notify}/> : resource?.kind === "relation" ? <RelationEditor key={resource.id} resource={resource} onClose={() => setResource(undefined)} notify={notify} /> : resource ? (
        <ResourceModal
          key={resource.id}
          resource={resource}
          initialQuery={resourceQueryText}
          onClose={() => setResource(undefined)}
          notify={notify}
        />
      ) : null}
      {modal ? (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "presets" ? "presets-modal" : modal === "program" ? "program-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "help"
                ? "使用指南"
                : modal === "settings"
                  ? "执行设置"
                  : modal === "program"
                    ? "控制流结构编辑"
                    : modal === "benchmark"
                      ? "真实浏览器性能测试"
                      : modal === "share"
                        ? "导出与分享"
                        : modal === "bindings"
                          ? "重新绑定资源"
                          : "灵感配方"
            }
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">GLYPHFORGE STUDIO</span>
                <h2>
                  {modal === "help"
                    ? "欢迎来到文字创作工坊"
                    : modal === "settings"
                      ? "给灵感一点边界"
                      : modal === "program"
                        ? "编辑循环、条件与变量"
                        : modal === "benchmark"
                          ? "实测本机词库性能"
                          : modal === "share"
                            ? "把灵感带到下一个地方"
                            : modal === "bindings"
                              ? "为工作流找到对应词库"
                              : "从一个好奇的想法开始"}
                </h2>
              </div>
              <button
                className="icon-button"
                aria-label="关闭"
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            {modal === "share" ? (
              <div className="modal-body">
                <SharePanel
                  onImport={receiveImport}
                  workflow={workflow}
                  resources={resources}
                  notify={notify}
                />
              </div>
            ) : modal === "bindings" && pendingImport ? (
              <div className="modal-body">
                <ImportBindings
                  dependencies={pendingImport.dependencies}
                  resources={resources}
                  onImport={(bindings) =>
                    receiveImport(pendingImport.data, bindings)
                  }
                />
              </div>
            ) : modal === "benchmark" ? (
              <div className="modal-body">
                <BenchmarkPanel />
              </div>
            ) : modal === "program" && selectedNode?.program ? (
              <div className="modal-body">
                <ProgramBuilder
                  program={selectedNode.program}
                  resources={resources}
                  onChange={(program) =>
                    change({
                      ...workflow,
                      nodes: workflow.nodes.map((n) =>
                        n.id === selectedNode.id ? { ...n, program } : n,
                      ),
                    })
                  }
                />
                <button
                  className="primary-button"
                  onClick={() => setModal(null)}
                >
                  完成编辑
                </button>
              </div>
            ) : modal === "help" ? (
              <div className="modal-body help-body">
                <p>
                  在「资源中心」准备文字，添加词库节点，连接到模式组合与筛选节点，再点击「运行工作流」。点击节点可修改参数，拖动圆形端口可以连接节点。
                </p>
                <div className="shortcut-row">
                  <span>运行工作流</span>
                  <kbd>Ctrl + Enter</kbd>
                </div>
                <div className="shortcut-row">
                  <span>保存 / 撤销 / 重做</span>
                  <kbd>Ctrl + S / Z / Shift Z</kbd>
                </div>
                <div className="shortcut-row">
                  <span>复制 / 粘贴所选节点</span>
                  <kbd>Ctrl + C / V</kbd>
                </div>
                <h3>用 NameScript 表达想法</h3>
                <pre>
                  {
                    'let a = resource("animals");\nlet b = resource("moods");\nlet names = pattern(a, b, "AABB");\nlet result = output(names);'
                  }
                </pre>
                <p>
                  组合会遍历两个输入的笛卡尔积，相同字母绑定同一词条。支持
                  let、for/in、嵌套循环、if/else 和
                  emit。添加「循环与条件」节点可通过结构编辑器编程。修改代码后点击「应用到节点」。任意
                  JavaScript 不支持执行；序列函数与子图可从画布底部「子图与函数」进入。资源中心还提供动态词库和 Mapping；扩展包仅支持受控声明式规则。
                </p>
                <p>
                  词库、工作流和收藏保存在当前浏览器。清除站点数据会移除它们，建议定期导出便携包。
                </p>
              </div>
            ) : modal === "settings" ? (
              <div className="modal-body">
                <label className="field-label">
                  随机种子
                  <input
                    type="number"
                    value={workflow.seed}
                    onChange={(e) =>
                      change({ ...workflow, seed: Number(e.target.value) })
                    }
                  />
                </label>
                <p className="field-note">
                  相同词库版本与种子可重现顺序；种子控制词库的起始位置。
                </p>
                <label className="field-label">
                  最大结果数量
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    value={workflow.limit}
                    onChange={(e) =>
                      change({ ...workflow, limit: Number(e.target.value) })
                    }
                  />
                </label>
                <div className="tip">
                  <Settings2 size={16} />
                  <span>
                    默认限制 300,000 个执行步骤与 10
                    秒计算时间。运行中可随时停止。
                  </span>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setModal(null)}
                >
                  完成设置
                  <Check size={15} />
                </button>
                <button
                  className="button"
                  onClick={() => setModal("benchmark")}
                >
                  运行真实词库性能测试
                </button>
              </div>
            ) : (
              <div className="preset-grid">
                {relationRecipes.map(p => <button className="preset-card purple" key={p.id} onClick={async () => {
                  try { await ensureRecipeExamples(); switchWorkflow(createRelationRecipe(p.id)); setModal(null); }
                  catch (e) { notify(e instanceof Error ? e.message : "示例资源安装失败"); }
                }}><span className="preset-tag">P1-B · 关系与共享变量</span><b className="preset-sample">{p.sample}</b><h3>{p.title}</h3><p>{p.description}</p><span className="preset-use">使用这个配方<ArrowLeft size={15} /></span></button>)}
                {[
                  {
                    id: "dream",
                    title: "宇宙浪漫命名器",
                    sub: "把宇宙与职业，碰撞出一点浪漫",
                    sample: "月亮邮差",
                    color: "green",
                    tag: "词库组合",
                  },
                  {
                    id: "echo",
                    title: "叠字的快乐",
                    sub: "毛茸茸的小动物，加倍可爱",
                    sample: "猫猫困困",
                    color: "purple",
                    tag: "AABB",
                  },
                  {
                    id: "mirror",
                    title: "镜像文字实验",
                    sub: "首尾呼应，把名字变成小小回文",
                    sample: "鹿暖暖鹿",
                    color: "orange",
                    tag: "ABBA",
                  },
                ].map((p) => (
                  <button
                    className={`preset-card ${p.color}`}
                    key={p.id}
                    onClick={() => {
                      switchWorkflow(createWorkflow(p.id));
                      setModal(null);
                    }}
                  >
                    <span className="preset-tag">{p.tag}</span>
                    <b className="preset-sample">{p.sample}</b>
                    <h3>{p.title}</h3>
                    <p>{p.sub}</p>
                    <span className="preset-use">
                      使用这个配方
                      <ArrowLeft size={15} />
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
      {detail ? (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDetail(undefined);
          }}
        >
          <section
            className="modal detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="名字来源"
          >
            <div className="modal-heading">
              <span className="eyebrow">A NAME WITH A STORY</span>
              <button
                className="icon-button"
                aria-label="关闭"
                onClick={() => setDetail(undefined)}
              >
                <X size={19} />
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-name">{detail.text}</div>
              <LineagePanel key={`${detail.runId}:${detail.text}`} candidate={detail} />
              {detail.members?.length ? <div className="detail-members">{detail.members.map((member, i) => <div key={i}><span>{i + 1}. {member}</span><button className="text-button" onClick={() => copy(member)}>复制此成员</button></div>)}</div> : null}
              <div className="detail-status">
                <span className="tiny-dot" />
                {detail.derivation ? "名字变异衍生 · 不是原工作流产出" : detailRun ? "已知生成来源" : detail.runId || detail.workflowId ? "生成来源记录缺失" : "文字实验结果"}
              </div>
              <div className="detail-parts">
                {detail.derivation ? <p className="field-note">衍生第 {detail.derivation.round} 轮 · 算法 v{detail.derivation.version} · 种子 {detail.derivation.seed} · 上轮输入「{detail.derivation.parent.text}」{detail.derivation.parent.runId ? ` · 原运行引用 ${detail.derivation.parent.runId}` : " · 原运行未记录"}。原片段为素材来源，不证明旧工作流生成了当前名字。</p> : null}
                {detail.notes?.length ? <p className="field-note">{[...new Set(detail.notes)].join("；")}</p> : null}
                {detailRun ? (
                  <p className="field-note">
                    运行时配方：{detailRun.workflow.name} ·{" "}
                    {detailRun.workflow.nodes.length} 个节点 · 保存于{" "}
                    {new Date(detailRun.createdAt).toLocaleString("zh-CN")}
                  </p>
                ) : null}
                <p className="field-note">保留工作流快照与资源版本号；没有历史资源内容快照，无法保证完整重现旧结果。</p>
                {detail.parts.slice(0,32).map((p, i) => (
                  <div key={i}>
                    <b>{p.text}</b>
                    <span>
                      {resources.find((r) => r.id === p.resourceId)?.name ||
                        "已删除词库"}{" "}
                      · v{p.version || "?"}{resources.find(r => r.id === p.resourceId)?.version !== p.version ? "（当前资源缺失或版本已改变）" : ""}
                      {p.pair ? ` · ${relationLabels[p.pair.relation]}` : ""}
                    </span>
                  </div>
                ))}
              </div>
              <div className="metrics">
                {Object.entries(unicodeMetrics(detail.text)).map(
                  ([key, value]) => (
                    <span key={key}>
                      {
                        {
                          utf16: "UTF-16",
                          codePoints: "码点",
                          graphemes: "可见字符",
                          bytes: "UTF-8 字节",
                        }[key]
                      }{" "}
                      <b>{value}</b>
                    </span>
                  ),
                )}
              </div>
              <p className="field-note">
                {detail.workflowId
                  ? `工作流 ${detail.workflowId.slice(0, 8)} · 种子 ${detail.seed}`
                  : "使用内置文字算子加工"}
              </p>
              <div className="row">
                <button className="button" onClick={() => { setReverseInput(detail.text); setDetail(undefined); setPage("reverse"); }}>逆向分析</button>
                <button
                  className="primary-button"
                  onClick={() => copy(detail.text)}
                >
                  <Copy size={15} />
                  复制名字
                </button>
                <button className="button" onClick={() => favorite(detail)}>
                  <Star size={15} />
                  收藏 / 取消收藏
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {toast ? (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
