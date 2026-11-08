import "fake-indexeddb/auto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";

// Data lives in the independently editable catalog, never in graph formulas.
const catalog = JSON.parse(await readFile("examples/haidu-chao-ren.catalog.json", "utf8"));
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: "custom" });
try {
  const { parseProgram } = await server.ssrLoadModule("/src/core/program.ts");
  const { curationDefaults } = await server.ssrLoadModule("/src/core/curation.ts");
  const { validateGraph } = await server.ssrLoadModule("/src/core/script.ts");
  const resources = [];
  function resource(id, name, entries, relationRows) {
    const meta = { id: `haidu-v2-${id}`, name: `海都潮人 · ${name}`, description: "原创选词；关系是生成依据，素材池供扩充配方。可在资源中心独立编辑与导入导出。", kind: relationRows ? "relation" : "word", color: relationRows ? "purple" : "green", count: relationRows?.length ?? entries.length, version: 1, updatedAt: 0 };
    resources.push({ meta, entries, ...(relationRows ? { relationRows } : {}) });
    return meta.id;
  }
  const cores = catalog.categories.flatMap(c => c.cores.map(t => t.text));
  const categoryOf = text => catalog.categories.find(c => c.cores.some(t => t.text === text))?.name || "荒诞";
  const seen = new Set(), rows = [];
  function add(left, right, category, recipe, contrast = 0) {
    const key = `${left}/${right}`;
    if (seen.has(key) || !/^[\u4e00-\u9fff]{1,2}$/.test(left) || !/^[\u4e00-\u9fff]{1,2}$/.test(right)) return;
    const text = left + right;
    if (recipe !== "echo" && (left.endsWith(right) || right.startsWith(left))) return;
    seen.add(key);
    // Auditable rubric, not a claim of linguistic modelling or player review.
    const score = { semantic: recipe === "semantic" ? 94 : recipe === "contrast" ? 78 : 86, sound: new Set(text).size === text.length ? 88 : 80, visual: 90, style: recipe === "echo" ? 72 : 88, contrast: contrast ? 94 : 76, collision: recipe === "semantic" ? 70 : 82 };
    const weight = Math.round(score.semantic * .3 + score.sound * .2 + score.visual * .1 + score.style * .2 + score.contrast * .1 + score.collision * .1);
    rows.push({ left, right, relation: "associated", direction: "directed", reverseQueryable: false, weight, tags: ["海都潮人", `风格:${category}`, `配方:${recipe}`, "规则复核"], note: JSON.stringify(score), source: "GlyphForge 原创选词 v2；六维启发式评分，未核验真实撞名率；待玩家审读" });
  }
  for (const c of catalog.categories) for (const term of c.cores) for (const tail of term.tails) add(term.text, tail, c.name, "suffix");
  for (const p of catalog.prefixPairs) add(p.left, p.right, p.category, "prefix");
  for (const recipe of ["semantic", "contrast", "double"]) for (const text of catalog[recipe]) { const [left, right] = text.split("/"); add(left, right, categoryOf(left), recipe, recipe === "contrast" ? 1 : 0); }
  for (const text of catalog.echo) add(text, text, categoryOf(text), "echo");
  for (const text of catalog.mirror) add(text, [...text].reverse().join(""), categoryOf(text), "echo");
  for (const text of catalog.redup) add(text, text, "动物", "echo");
  const pairsId = resource("pairs", "精选搭配", [], rows);
  resource("cores", "双字核心", cores);
  resource("suffixes", "单字尾缀素材", [...new Set(catalog.suffixes)]);
  resource("prefixes", "单字前缀素材", [...new Set(catalog.prefixes)]);
  resource("companions", "双字搭配素材", catalog.companions);
  const nodes = [
    { id: "generate", op: "program", inputs: [], params: {}, program: parseProgram(`for pair in pairs("${pairsId}", "associated") { if (length(left(pair)) == 2) { emit(left(pair)); } emit(left(pair) + right(pair)); }`) },
    { id: "selection", op: "curate", inputs: ["generate"], params: { ...curationDefaults } },
    { id: "result", op: "output", inputs: ["selection"], params: {} },
    // Disconnected material nodes keep pools available in the existing portable
    // dependency model and editor; only the explicit relationship table executes.
    ...resources.slice(1).map((r, i) => ({ id: `material${i}`, op: "resource", inputs: [], params: { resourceId: r.meta.id } })),
  ];
  const workflow = { version: 1, id: "haidu-chao-ren-v2", name: "海都潮人 ID", nodes, layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: i < 3 ? 40 + i * 290 : 40 + (i - 3) * 260, y: i < 3 ? 70 : 380 }])), seed: 42, limit: 24, comments: ["// glyphforge:preset:haidu-v2", "// 素材节点保留独立词池；审核搭配关系是生成的唯一组合依据。", "// 配方标签 direct/suffix/prefix/semantic/contrast；高级 double/echo 默认关闭。", "// 风格标签可在关系编辑器修改；评分为六维启发式，不代表真实注册可用率。"] };
  validateGraph(workflow);
  const pkg = { format: "glyphforge", version: 4, irVersion: 1, operatorVersions: { program: 1, curate: 1, output: 1, resource: 1, pairs: 1 }, workflow, dependencies: resources.map(r => ({ id: r.meta.id, name: r.meta.name, version: 1, kind: r.meta.kind })), resources };
  await writeFile("examples/haidu-chao-ren.portable.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log(JSON.stringify({ cores: cores.length, suffixes: new Set(catalog.suffixes).size, prefixes: new Set(catalog.prefixes).size, companions: catalog.companions.length, relations: rows.length, bytes: Buffer.byteLength(JSON.stringify(pkg)), recipes: Object.fromEntries(["suffix","prefix","semantic","contrast","double","echo"].map(k => [k,rows.filter(r=>r.tags.includes(`配方:${k}`)).length])) }));
} finally { await server.close(); }
