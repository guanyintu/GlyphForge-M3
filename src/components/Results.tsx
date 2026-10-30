import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Check,
  Copy,
  Grid2X2,
  Heart,
  List,
  Search,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import type { Candidate, Favorite } from "../core/model";
import type { RunStats } from "../core/engine";
import { download } from "../core/sharing";
import { resultsFile } from "../core/files";
import { GameRuleEditor } from "./GameRuleEditor";
import type { GameRule } from "../core/game-rules";
import { checkGameId, defaultGameRule } from "../core/game-rules";
function GameBadge({ text, rule, onInspect }: { text: string; rule: GameRule; onInspect: (text: string) => void }) {
  const report = checkGameId(text, rule);
  return <button className="text-button game-check" title={[...report.errors, ...report.warnings].join("；")} onClick={() => onInspect(text)}>{report.valid ? "规则通过" : "不兼容"}{report.warnings.length ? " · 风险提示" : ""}</button>;
}
export default function Results({
  candidates,
  favorites,
  stats,
  running,
  onlyFavorites = false,
  onFavorite,
  onSave,
  onCopy,
  onDetail,
}: {
  candidates: Candidate[];
  favorites: Favorite[];
  stats?: RunStats;
  running: boolean;
  onlyFavorites?: boolean;
  onFavorite: (c: Candidate) => void;
  onSave: (c: Candidate[]) => unknown;
  onCopy: (text: string) => void;
  onDetail: (c: Candidate) => void;
}) {
  const [showRules, setShowRules] = useState(false), [gameRule, setGameRule] = useState(defaultGameRule);
  const [gameText, setGameText] = useState("月亮邮差");
  const gameReport = showRules ? checkGameId(gameText, gameRule) : undefined;
  const [saveError, setSaveError] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState("list");
  const [starred, setStarred] = useState(false);
  const [scroll, setScroll] = useState(0);
  const [width, setWidth] = useState(1000);
  const [height, setHeight] = useState(220);
  const [copied, setCopied] = useState("");
  const [animations, setAnimations] = useState(
    () => localStorage.getItem("glyphforge-animations") !== "off",
  );
  const [format, setFormat] = useState<"txt" | "csv" | "json">("txt");
  const [excluded, setExcluded] = useState("");
  const [sort, setSort] = useState("original");
  const viewport = useRef<HTMLDivElement>(null);
  const favoriteSet = useMemo(
    () => new Set(favorites.map((f) => f.text)),
    [favorites],
  );
  const results = useMemo(() => {
    const result = (onlyFavorites ? favorites : candidates).filter(
      (c) =>
        c.text.includes(query) &&
        (!excluded || !c.text.includes(excluded)) &&
        (!starred || favoriteSet.has(c.text)),
    );
    return sort === "az"
      ? result.sort((a, b) => a.text.localeCompare(b.text, "zh"))
      : sort === "length"
        ? result.sort(
            (a, b) => Array.from(a.text).length - Array.from(b.text).length,
          )
        : result;
  }, [
    onlyFavorites,
    favorites,
    candidates,
    query,
    starred,
    favoriteSet,
    excluded,
    sort,
  ]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([e]) => {
      setWidth(e.contentRect.width);
      setHeight(e.contentRect.height);
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setScroll(0);
    viewport.current?.scrollTo({ top: 0 });
  }, [query, view, starred, onlyFavorites, candidates]);
  const cols = view === "list" ? 1 : Math.max(1, Math.floor(width / 190));
  const rowHeight = view === "list" ? 48 : 91;
  const startRow = Math.max(0, Math.floor(scroll / rowHeight) - 2);
  const animatedView = view === "play" || view === "scatter";
  const scatterCols = Math.max(2, cols);
  const scatterCount = Math.min(20, scatterCols * 4);
  const scatterRows = Math.ceil(scatterCount / scatterCols);
  const visible = animatedView
    ? results.slice(0, view === "scatter" ? scatterCount : 24)
    : results.slice(
        startRow * cols,
        (startRow + Math.ceil(height / rowHeight) + 4) * cols,
      );
  return (
    <section className={`results-section ${onlyFavorites ? "standalone" : ""}`}>
      <div className="results-heading">
        <div className="result-title">
          <span className="section-icon">
            <Sparkles size={17} />
          </span>
          <h2>{onlyFavorites ? "我的收藏" : "灵感产物"}</h2>
          <span className="count-badge">{results.length}</span>
          <span className="result-timing">
            {running
              ? "正在捕捉灵感…"
              : stats
                ? `${(stats.duration / 1000).toFixed(2)}s · ${stats.truncated ? "已达到结果上限" : "生成完成"}`
                : "运行工作流，看看会发生什么"}
          </span>
        </div>
        <div className="result-actions">
          <select
            aria-label="结果导出格式"
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
          >
            <option value="txt">TXT</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button
            className="text-button"
            disabled={!results.length}
            onClick={() => onCopy(results.map((x) => x.text).join("\n"))}
          >
            <Copy size={14} />
            复制全部
          </button>
          <button
            className="text-button"
            disabled={!results.length}
            onClick={() =>
              download(
                `GlyphForge-灵感.${format}`,
                resultsFile(results, format),
                format === "json"
                  ? "application/json"
                  : "text/plain;charset=utf-8",
              )
            }
          >
            <ArrowDownToLine size={14} />
            导出
          </button>
          <button
            className="text-button"
            disabled={!results.length}
            onClick={async () => { try { await onSave(results); setSaveError(""); } catch (e) { setSaveError(e instanceof Error ? e.message : "保存词库失败"); } }}
          >
            存为词库
          </button>
        </div>
      </div>
      {saveError ? <p role="alert">{saveError}</p> : null}
      <button className="text-button" onClick={() => setShowRules(v => !v)}>游戏规则检查{showRules ? "（收起）" : ""}</button>
      {showRules ? <><GameRuleEditor rule={gameRule} onChange={setGameRule} /><div className="tool-panel"><label className="field-label">测试游戏 ID<input aria-label="测试游戏 ID" value={gameText} maxLength={1024} onChange={e => setGameText(e.target.value)} /></label><p>{Object.entries(gameReport!.metrics).map(([unit, value]) => `${unit}: ${value}`).join(" · ")}</p><p role="status">{gameReport!.valid ? "符合本地规则" : gameReport!.errors.join("；")}</p>{gameReport!.warnings.length ? <p>{gameReport!.warnings.join("；")}</p> : null}</div></> : null}
      <div className="results-toolbar">
        <div className="search-box">
          <Search size={15} />
          <input
            aria-label="筛选生成结果"
            placeholder="寻找一个心动的名字…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query ? (
            <button
              className="icon-button"
              aria-label="清空搜索"
              onClick={() => setQuery("")}
            >
              <X size={13} />
            </button>
          ) : (
            <kbd>/</kbd>
          )}
        </div>
        <button
          className={`favorite-filter ${starred ? "active" : ""}`}
          onClick={() => setStarred(!starred)}
        >
          <Star size={14} />
          只看收藏
        </button>
        <input
          className="exclude-input"
          aria-label="排除结果文字"
          placeholder="排除文字…"
          value={excluded}
          onChange={(e) => setExcluded(e.target.value)}
        />
        <select
          className="results-sort"
          aria-label="结果排序"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="original">生成顺序</option>
          <option value="az">字典顺序</option>
          <option value="length">长度优先</option>
        </select>
        <label className="animation-toggle">
          <input
            type="checkbox"
            aria-label="开启动画"
            checked={animations}
            onChange={(e) => {
              setAnimations(e.target.checked);
              localStorage.setItem(
                "glyphforge-animations",
                e.target.checked ? "on" : "off",
              );
            }}
          />
          动画
        </label>
        <div className="view-switch">
          {[
            { id: "cards", icon: Grid2X2, label: "卡片模式" },
            { id: "list", icon: List, label: "列表模式" },
            { id: "play", icon: Sparkles, label: "灵感动画" },
            { id: "scatter", icon: Sparkles, label: "爆炸散开" },
          ].map((v) => (
            <button
              key={v.id}
              title={v.label}
              aria-label={v.label}
              className={view === v.id ? "active" : ""}
              onClick={() => setView(v.id)}
            >
              <v.icon size={15} />
            </button>
          ))}
        </div>
      </div>
      <div
        className={`results-viewport ${view}`}
        ref={viewport}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        {!results.length ? (
          <div className="empty-state">
            <Sparkles size={29} />
            <h3>
              {query
                ? "没有匹配的名字"
                : onlyFavorites
                  ? "把心动的名字留在这里"
                  : "每一个名字，都从一点灵感开始"}
            </h3>
            <p>
              {query
                ? "换个关键词，或调整节点中的筛选条件。"
                : onlyFavorites
                  ? "点击名字旁的星星，就能随时找到它。"
                  : "连接词库与规则，点击右上角「运行工作流」。"}
            </p>
          </div>
        ) : (
          <div
            style={{
              height: animatedView
                ? view === "scatter"
                  ? Math.max(220, scatterRows * 57)
                  : undefined
                : Math.ceil(results.length / cols) * rowHeight,
              position: "relative",
            }}
          >
            <div
              className={`result-grid ${view === "scatter" ? "scatter-grid" : ""}`}
              style={{
                display: view === "scatter" ? "block" : "grid",
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                transform: animatedView
                  ? undefined
                  : `translateY(${startRow * rowHeight}px)`,
              }}
            >
              {visible.map((c, i) => (
                <div
                  className={`candidate ${view === "play" && animations ? "animate-card" : ""} ${view === "scatter" && animations ? "animate-scatter" : ""} ${favoriteSet.has(c.text) ? "saved" : ""}`}
                  key={c.text}
                  style={
                    {
                      animationDelay: `${(i % 24) * 25}ms`,
                      ...(view === "scatter"
                        ? {
                            width: Math.max(100, width / scatterCols - 15),
                            "--scatter-x": `${(((i % scatterCols) + 0.5) * width) / scatterCols - width / 2}px`,
                            "--scatter-y": `${(Math.floor(i / scatterCols) + 0.5) * 57 - Math.max(220, scatterRows * 57) / 2}px`,
                            "--scatter-r": `${((i % 5) - 2) * 2}deg`,
                          }
                        : {}),
                    } as React.CSSProperties
                  }
                >
                  <button
                    className="candidate-name"
                    title="查看名字来源"
                    onClick={() => onDetail(c)}
                  >
                    {c.text}
                    <small>
                      {view === "list"
                        ? `${c.parts.length} 个来源片段`
                        : "来自你的奇妙想法"}
                    </small>
                  </button>
                  {showRules ? <GameBadge text={c.text} rule={gameRule} onInspect={setGameText} /> : null}
                  <div className="candidate-buttons">
                    <button
                      className="icon-button"
                      title="复制名字"
                      aria-label={`复制 ${c.text}`}
                      onClick={() => {
                        onCopy(c.text);
                        setCopied(c.text);
                        setTimeout(() => setCopied(""), 1500);
                      }}
                    >
                      {copied === c.text ? (
                        <Check size={14} />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                    <button
                      className={`icon-button star-button ${favoriteSet.has(c.text) ? "active" : ""}`}
                      title="收藏名字"
                      aria-label={`收藏 ${c.text}`}
                      onClick={() => onFavorite(c)}
                    >
                      <Star
                        size={15}
                        fill={favoriteSet.has(c.text) ? "currentColor" : "none"}
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="results-footer">
        <span>
          <span className="tiny-dot" />
          全部计算在你的设备完成
        </span>
        <span>
          {animatedView
            ? `精选展示前 ${view === "scatter" ? scatterCount : 24} 个结果 · 动画${animations ? "已开启" : "已关闭"}`
            : "点击名字查看来源 · 点击 ☆ 收藏"}
          <Heart size={12} />
        </span>
      </div>
    </section>
  );
}
