import { addEntries, db, ForgeDatabase } from "../storage/db";
import { csvCell, fileWords } from "../core/files";
import type { Resource } from "../core/model";
self.onmessage = async (
  event: MessageEvent<
    | {
        type: "import";
        resourceId: string;
        file?: File;
        text?: string;
        name?: string;
      }
    | { type: "export"; resourceId: string; format: "txt" | "csv" | "json" }
    | { type: "benchmark"; size: number; name?: string }
    | { type: "query"; resourceId: string; query: string; page: number }
  >,
) => {
  const input = event.data;
  try {
    if (input.type === "import") {
      const file = input.file || new Blob([input.text || ""]);
      let batch: string[] = [],
        processed = 0;
      const before = (await db.resources.get(input.resourceId))?.count || 0;
      for await (const text of fileWords(
        file,
        input.file?.name || input.name || "pasted.txt",
      )) {
        if (text.length > 256) throw new Error("词条最多 256 个代码单元");
        batch.push(text);
        if (++processed > 1000000) throw new Error("每次导入最多一百万条");
        if (batch.length === 1000) {
          await addEntries(input.resourceId, batch);
          batch = [];
          self.postMessage({ type: "progress", processed });
        }
      }
      if (batch.length) await addEntries(input.resourceId, batch);
      const after = (await db.resources.get(input.resourceId))?.count || 0;
      self.postMessage({ type: "done", processed, added: after - before });
    } else if (input.type === "export") {
      const resource = await db.resources.get(input.resourceId);
      if (!resource) throw new Error("词库不存在");
      const parts: string[] = [];
      if (input.format === "csv") parts.push("\uFEFFtext\r\n");
      if (input.format === "json")
        parts.push('{"format":"glyphforge-resource","version":1,"entries":[');
      let key = 0,
        count = 0;
      let bytes = 0;
      while (true) {
        const entries = await db.entries
          .where("[resourceId+id]")
          .between(
            [input.resourceId, key],
            [input.resourceId, Infinity],
            true,
            true,
          )
          .limit(1000)
          .toArray();
        if (!entries.length) break;
        key = entries.at(-1)!.id! + 1;
        const chunk = entries
          .map((e) =>
            input.format === "json"
              ? `${count++ ? "," : ""}${JSON.stringify(e.text)}`
              : input.format === "csv"
                ? csvCell(e.text) + "\r\n"
                : e.text + "\n",
          )
          .join("");
        bytes += new TextEncoder().encode(chunk).length;
        if (bytes > 64 * 1024 * 1024)
          throw new Error("导出超过 64 MB，请拆分词库");
        parts.push(chunk);
        self.postMessage({ type: "progress", processed: key });
      }
      if (input.format === "json") parts.push("]}");
      self.postMessage({
        type: "exported",
        blob: new Blob(parts, {
          type:
            input.format === "json"
              ? "application/json"
              : "text/plain;charset=utf-8",
        }),
        name: `${resource.name}.${input.format}`,
      });
    } else if (input.type === "query") {
      if (
        typeof input.query !== "string" ||
        input.query.length > 256 ||
        !Number.isSafeInteger(input.page) ||
        input.page < 0
      )
        throw new Error("查询参数无效");
      const entries = await db.entries
        .where({ resourceId: input.resourceId })
        .filter((e) => e.text.includes(input.query))
        .offset(input.page * 60)
        .limit(60)
        .toArray();
      let processed = 0;
      const count = await db.entries
        .where({ resourceId: input.resourceId })
        .filter((e) => {
          if (++processed % 5000 === 0)
            self.postMessage({ type: "progress", processed });
          return e.text.includes(input.query);
        })
        .count();
      self.postMessage({ type: "queryResult", entries, count });
    } else {
      const size = input.size;
      if (![10000, 100000, 1000000].includes(size))
        throw new Error("无效测试规模");
      const name = input.name || `glyphforge-benchmark-${crypto.randomUUID()}`;
      if (!/^glyphforge-benchmark-[a-f0-9-]{36}$/.test(name))
        throw new Error("测试数据库名称无效");
      const bench = new ForgeDatabase(name);
      const resource: Resource = {
        id: "bench",
        name: "临时性能数据",
        kind: "word",
        description: "自动清理",
        color: "green",
        version: 1,
        count: 0,
        updatedAt: Date.now(),
      };
      try {
        await bench.resources.add(resource);
        const start = performance.now();
        for (let i = 0; i < size; i += 1000) {
          await addEntries(
            "bench",
            Array.from(
              { length: Math.min(1000, size - i) },
              (_, j) => `测试词${String(i + j).padStart(7, "0")}`,
            ),
            bench,
          );
          if (i % 5000 === 0)
            self.postMessage({
              type: "progress",
              processed: i + 1000,
              total: size,
            });
        }
        const importMs = performance.now() - start;
        const lookup = performance.now();
        const exact = await bench.entries
          .where("[resourceId+text]")
          .equals(["bench", "测试词0000042"])
          .first();
        const exactMs = performance.now() - lookup;
        const prefixStart = performance.now();
        const prefix = await bench.entries
          .where("[resourceId+text]")
          .between(
            ["bench", "测试词000"],
            ["bench", "测试词000\uffff"],
            true,
            true,
          )
          .limit(60)
          .toArray();
        const prefixMs = performance.now() - prefixStart;
        const report = {
          size,
          count: await bench.entries.count(),
          importMs,
          exactMs,
          prefixMs,
          exactFound: exact?.text === "测试词0000042",
          renderedPage: prefix.length,
          maxWriteBatch: 1000,
          browser: navigator.userAgent,
          at: new Date().toISOString(),
        };
        bench.close();
        await bench.delete();
        self.postMessage({ type: "benchmark", report });
      } finally {
        bench.close();
        await bench.delete();
      }
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
