import "fake-indexeddb/auto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "vite";

// Data lives in the independently editable catalog, never in graph formulas.
const catalog = JSON.parse(await readFile("examples/haidu-chao-ren.catalog.json", "utf8"));
const server = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: "custom" });
try {
  const { validateGraph } = await server.ssrLoadModule("/src/core/script.ts");
  const resources = [];
  function resource(id, name, entries, relationRows) {
    const meta = { id: `haidu-v3-${id}`, name: `海都潮人 · ${name}`, description: "原创独立词库；前后词与双字词实际参与原表五列组合，关系只用于质量排序。", kind: relationRows ? "relation" : "word", color: relationRows ? "purple" : "green", count: relationRows?.length ?? entries.length, version: 1, updatedAt: 0 };
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
  const oneHead = resource("prefixes", "单字前词", [...new Set(catalog.prefixes)]);
  const oneTail = resource("suffixes", "单字后词", [...new Set(catalog.suffixes)]);
  const twoHead = resource("cores", "双字前词与直出", cores);
  const twoTail = resource("companions", "双字后词", catalog.companions);
  for (const text of catalog.shortPairs) if (catalog.prefixes.includes(text[0]) && catalog.suffixes.includes(text[1])) add(text[0],text[1],/[猫犬狗鲸狐鱼]/.test(text[1])?"动物":"质感","one-one");
  const pairsId = resource("pairs", "组合质量参考", [], rows);
  const { sampledWords, haiduWorkflow } = await server.ssrLoadModule("/src/core/haidu-workflow.ts");
  const { db, saveNewResource, saveRelationRows } = await server.ssrLoadModule("/src/storage/db.ts");
  const { saveDefinedResource } = await server.ssrLoadModule("/src/storage/resource-runtime.ts");
  const { exportPackage } = await server.ssrLoadModule("/src/core/sharing.ts");
  for (const item of resources) {
    await saveNewResource(item.meta,item.entries);
    if(item.relationRows) await saveRelationRows(item.meta.id,item.relationRows);
  }
  async function sample(id,name,source,count,maxLength) {
    const sampleId=`haidu-v3-${id}`;
    await saveDefinedResource({id:sampleId,name:`海都潮人 · ${name}`,description:"用现有成员分组按种子抽取素材；不保存候选缓存，修改原词库后重新计算。",kind:"word",color:"green",version:1,count:0,updatedAt:0,definition:{format:1,type:"dynamic",workflow:sampledWords(sampleId,source,count,maxLength)}});
    return sampleId;
  }
  const workflow=haiduWorkflow({oneHead:await sample("one-head-sample","单字前词抽样20",oneHead,20,1),oneTail:await sample("one-tail-sample","单字后词抽样40",oneTail,40,1),twoHead:await sample("two-head-sample","双字前词抽样40",twoHead,40,2),twoTail:await sample("two-tail-sample","双字后词抽样40",twoTail,40,2),direct:twoHead,reviewed:pairsId});
  validateGraph(workflow);
  const pkg=await exportPackage(workflow);
  for(const item of pkg.resources) item.meta.updatedAt=0;
  db.close();
  await writeFile("examples/haidu-chao-ren.portable.json", JSON.stringify(pkg, null, 2) + "\n");
  console.log(JSON.stringify({ cores: cores.length, suffixes: new Set(catalog.suffixes).size, prefixes: new Set(catalog.prefixes).size, companions: catalog.companions.length, relations: rows.length, bytes: Buffer.byteLength(JSON.stringify(pkg)), recipes: Object.fromEntries(["suffix","prefix","semantic","contrast","double","echo"].map(k => [k,rows.filter(r=>r.tags.includes(`配方:${k}`)).length])) }));
} finally { await server.close(); }
