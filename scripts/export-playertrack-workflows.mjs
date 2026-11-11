import "fake-indexeddb/auto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";

const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: "custom" });
try {
  const { db, readResource } = await server.ssrLoadModule("/src/storage/db.ts");
  const { installCorpus, openCorpusPreset } = await server.ssrLoadModule("/src/storage/corpus.ts");
  const { corpusPresets } = await server.ssrLoadModule("/src/core/corpus-presets.ts");
  const { exportPackage } = await server.ssrLoadModule("/src/core/sharing.ts");
  const { execute } = await server.ssrLoadModule("/src/core/engine.ts");
  await mkdir("public/workflows", { recursive: true });
  const manifest = [];
  for (const preset of corpusPresets) {
    await installCorpus(JSON.parse(await readFile(`data/playertrack/${preset.style}.json`, "utf8")));
    const workflow = await openCorpusPreset(preset.style);
    workflow.id = `playertrack-${preset.style}-v1`;
    const portable = await exportPackage(workflow);
    for (const item of portable.resources) item.meta.updatedAt = 0;
    const values = [];
    await execute(workflow, readResource, batch => values.push(...batch), undefined, { resourceMetadata: id => db.resources.get(id) });
    const file = `ff14-${preset.style}.json`;
    await writeFile(`public/workflows/${file}`, JSON.stringify(portable) + "\n");
    manifest.push({ style: preset.style, name: workflow.name, file, format: portable.version, resourceCount: portable.resources.length, seed: workflow.seed,
      minLength: workflow.nodes[1].params.minLength, maxLength: workflow.nodes[1].params.maxLength, results: values.length, preview: values.slice(0, 3).map(c => c.text) });
  }
  await writeFile("public/workflows/playertrack-manifest.json", JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest));
  db.close();
} finally { await server.close(); }
