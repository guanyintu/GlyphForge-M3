import "fake-indexeddb/auto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "vite";

// Uses the actual storage and package exporter in an isolated, in-memory IndexedDB.
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { db } = await server.ssrLoadModule("/src/storage/db.ts");
  const { ensureRecipeExamples, relationRecipes, createRelationRecipe } = await server.ssrLoadModule("/src/core/recipes.ts");
  const { exportPackage } = await server.ssrLoadModule("/src/core/sharing.ts");
  await ensureRecipeExamples();
  await mkdir("examples/p1b", { recursive: true });
  for (const recipe of relationRecipes) {
    const workflow = createRelationRecipe(recipe.id);
    workflow.id = `p1b-example-${recipe.id}`;
    const pkg = await exportPackage(workflow);
    pkg.resources.forEach(item => { item.meta.updatedAt = 0; });
    await writeFile(`examples/p1b/${recipe.id}.portable.json`, JSON.stringify(pkg, null, 2) + "\n");
  }
  db.close();
} finally { await server.close(); }
