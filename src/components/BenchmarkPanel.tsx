import { useEffect, useRef, useState } from "react";
import { download } from "../core/sharing";
import Dexie from "dexie";
export default function BenchmarkPanel() {
  const worker = useRef<Worker | null>(null);
  const databaseName = useRef("");
  function cleanup() {
    worker.current?.terminate();
    worker.current = null;
    const name = databaseName.current;
    databaseName.current = "";
    if (name.startsWith("glyphforge-benchmark-"))
      void Dexie.delete(name).catch(() => {});
  }
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [report, setReport] = useState<Record<string, unknown>>();
  useEffect(() => cleanup, []);
  function run(size: number) {
    cleanup();
    const w = new Worker(
      new URL("../workers/resources.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    databaseName.current = `glyphforge-benchmark-${crypto.randomUUID()}`;
    setBusy(true);
    setReport(undefined);
    setProgress("正在准备独立测试数据库…");
    w.onmessage = (e) => {
      if (worker.current !== w) return;
      if (e.data.type === "progress")
        setProgress(
          `已导入 ${e.data.processed.toLocaleString()} / ${size.toLocaleString()} 条`,
        );
      else {
        setBusy(false);
        if (e.data.type === "benchmark") {
          setReport(e.data.report);
          setProgress("测试完成，临时数据库已清理");
        } else setProgress(e.data.message);
        w.terminate();
        worker.current = null;
        databaseName.current = "";
      }
    };
    w.postMessage({ type: "benchmark", size, name: databaseName.current });
  }
  return (
    <div className="benchmark-panel">
      <p className="field-note">
        在单独的临时 IndexedDB
        中使用真实导入函数写入、精确查询和前缀分页。完成后自动清理，不改动创作词库。浏览器与硬件会影响耗时。
      </p>
      <div className="row">
        {[10000, 100000, 1000000].map((size) => (
          <button
            key={size}
            className="button"
            disabled={busy}
            onClick={() => run(size)}
          >
            {size.toLocaleString()} 条
          </button>
        ))}
      </div>
      <p className="field-note" role="status">
        {progress}
      </p>
      {busy ? (
        <button
          className="button"
          onClick={() => {
            cleanup();
            setBusy(false);
            setProgress("已停止测试，正在清理独立测试数据库");
          }}
        >
          停止测试
        </button>
      ) : null}
      {report ? (
        <>
          <table className="benchmark-table">
            <tbody>
              {Object.entries(report).map(([key, value]) => (
                <tr key={key}>
                  <th>{key}</th>
                  <td>
                    {typeof value === "number"
                      ? value.toFixed(key.endsWith("Ms") ? 2 : 0)
                      : String(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            className="button"
            onClick={() =>
              download(
                `GlyphForge-benchmark-${report.size}.json`,
                JSON.stringify(report, null, 2),
              )
            }
          >
            导出性能记录
          </button>
        </>
      ) : null}
    </div>
  );
}
