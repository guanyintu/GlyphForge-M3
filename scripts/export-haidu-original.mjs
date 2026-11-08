import "fake-indexeddb/auto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";

const catalog = JSON.parse(await readFile("examples/haidu-chao-ren.original.catalog.json", "utf8"));
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: "custom" });
try {
  const { db, saveNewResource } = await server.ssrLoadModule("/src/storage/db.ts");
  const { saveDefinedResource } = await server.ssrLoadModule("/src/storage/resource-runtime.ts");
  const { sampledWords, haiduOriginalWorkflow } = await server.ssrLoadModule("/src/core/haidu-workflow.ts");
  const { exportPackage } = await server.ssrLoadModule("/src/core/sharing.ts");
  const ids = {}, sizes = { oneHead: [20, 1], oneTail: [40, 1], twoHead: [40, 2], twoTail: [40, 2] };
  for (const [key, pool] of Object.entries(catalog.pools)) {
    const words = [...new Set(pool.rows.map(row => row.text))];
    const meta = { id: `haidu-original-${key}`, name: `原版海都 · ${pool.sheet}${key.endsWith("Head") ? "前缀" : "后缀"}`, description: `原版 ${pool.sheet}!${pool.range}；${pool.rows.length} 行/${words.length} 个不同词。来源 ${catalog.source.author} ${catalog.source.version}。原始重复行保留在独立 catalog；资源按原系统唯一约束归并。`, kind: "word", color: "green", version: 1, count: 0, updatedAt: 0 };
    await saveNewResource(meta, words);
    const sampleId = `${meta.id}-sample`, [count, maxLength] = sizes[key];
    await saveDefinedResource({ ...meta, id: sampleId, name: `${meta.name} · 抽样`, description: "原工作流的有界固定种子抽样，可编辑数量。", definition: { format: 1, type: "dynamic", workflow: sampledWords(sampleId, meta.id, count, maxLength) } });
    ids[key] = sampleId;
  }
  const workflow = haiduOriginalWorkflow({ ...ids, direct: "haidu-original-twoTail", reviewed: "" });
  const portable = await exportPackage(workflow);
  for (const item of portable.resources) item.meta.updatedAt = 0;
  await writeFile("examples/haidu-chao-ren.original.portable.json", JSON.stringify(portable, null, 2) + "\n");
  console.log(JSON.stringify({ format: portable.version, resources: portable.resources.length, words: portable.resources.filter(r => !r.meta.definition).map(r => ({ name: r.meta.name, count: r.entries.length })) }));
  await db.close();
} finally { await server.close(); }
