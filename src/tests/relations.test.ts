import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { db, ForgeDatabase, readResource, addEntries, deleteResource, saveRelationRows, deleteRelationRow } from "../storage/db";
import { createRelationRecipe, ensureRecipeExamples, relationRecipes } from "../core/recipes";
import { createWorkflow, operators } from "../core/model";
import type { Candidate, Workflow } from "../core/model";
import { execute } from "../core/engine";
import { parseScript, toScript, validateGraph } from "../core/script";
import { exportPackage, importPackage, ResourceDependencyError, dependencyIds } from "../core/sharing";
import { normalizePair } from "../core/relations";
import { parseRelationRows, relationRowsFile } from "../core/relation-files";
import { copyNodes, pasteNodes, WorkflowHistory } from "../core/graph-editing";

beforeEach(async () => {
  await Promise.all([db.resources.clear(), db.entries.clear(), db.relations.clear(), db.workflows.clear(), db.generated.clear(), db.favorites.clear(), db.runs.clear()]);
  await ensureRecipeExamples();
});
async function run(w: Workflow) {
  const values: Candidate[] = [];
  const stats = await execute(w, readResource, batch => values.push(...batch));
  return { values, texts: values.map(v => v.text), stats };
}
function param(w: Workflow, op: string, patch: Record<string, string | number | boolean>) {
  const node = w.nodes.find(n => n.op === op)!; node.params = { ...node.params, ...patch }; return w;
}
describe("P1-B actual editable recipes", () => {
  it("imports all six checked-in portable examples as executable ordinary workflows", async () => {
    const fixtures = import.meta.glob("../../examples/p1b/*.portable.json", { eager: true, import: "default" });
    expect(Object.keys(fixtures)).toHaveLength(6);
    for (const recipe of relationRecipes) {
      const fixture = Object.entries(fixtures).find(([path]) => path.endsWith(`/${recipe.id}.portable.json`))![1];
      expect((await run(await importPackage(fixture))).texts).toEqual((await run(createRelationRecipe(recipe.id))).texts);
    }
  });
  for (const recipe of relationRecipes) it(`${recipe.title} executes and survives node / NameScript / portable roundtrips`, async () => {
    const w = createRelationRecipe(recipe.id), original = await run(w);
    expect(original.values.length).toBeGreaterThan(0);
    expect((await run(parseScript(toScript(w), w))).texts).toEqual(original.texts);
    const imported = await importPackage(await exportPackage(w));
    expect((await run(imported)).texts).toEqual(original.texts);
    expect(dependencyIds(imported).every(id => !dependencyIds(w).includes(id))).toBe(true);
    expect((await db.workflows.get(imported.id))?.nodes).toEqual(imported.nodes);
  });
  it("couples keep every paired slot together, with a truly shared ordinary slot", async () => {
    const w = createRelationRecipe("couple"); w.seed = 0;
    const node = w.nodes[0];
    node.params.slots = JSON.stringify([...JSON.parse(String(node.params.slots)), { name: "shared", resourceId: "p1b-animals", kind: "word" }]);
    node.params.templates = JSON.stringify(["{shared}的{sky.left}{role.left}", "{shared}的{sky.right}{role.right}"]);
    const result = await run(w);
    expect(result.texts).toContain("猫的月亮邮差 / 猫的星星收件人");
    expect(result.texts).not.toContain("猫的月亮收件人 / 猫的星星邮差");
    expect(result.texts).not.toContain("猫的月亮邮差 / 鹿的星星收件人");
    expect(result.values[0].parts.filter(p => p.pair)).toHaveLength(2);
  });
  it("antonyms exclude explicit ordinary associations and allow shared affixes", async () => {
    const w = createRelationRecipe("antonyms"); w.seed = 0;
    param(w, "template", { templates: '["「{opposite.left}面骑士」","「{opposite.right}面骑士」"]' });
    expect((await run(w)).texts).toEqual(["「冷面骑士」 / 「热面骑士」", "「昼面骑士」 / 「夜面骑士」"]);
  });
  it("parallel slots preserve word order and require equal grapheme length when requested", async () => {
    const w = createRelationRecipe("parallel");
    expect((await run(w)).texts).toEqual(["春风入梦 / 秋雨归心"]);
    await saveRelationRows("p1b-action", [{ left: "听细雨", right: "望云", relation: "parallel" }]);
    expect((await run(w)).texts).toEqual(["春风入梦 / 秋雨归心"]);
    param(w, "template", { equalLength: false });
    expect((await run(w)).texts).toContain("春风听细雨 / 秋雨望云");
  });
  it("mirror rules swap variables and support custom structures, repetition, and symbols", async () => {
    const w = createRelationRecipe("mirror-pair"); w.seed = 0;
    expect((await run(w)).texts).toContain("猫追月 / 月追猫");
    param(w, "template", { templates: '["「{animal}{animal}·{sky}」","「{sky}·{animal}{animal}」"]' });
    expect((await run(w)).texts).toContain("「猫猫·月」 / 「月·猫猫」");
  });
  it("N-person teams enforce count, cross-batch uniqueness, affixes, separators and lengths", async () => {
    const w = param(createRelationRecipe("squad-prefix"), "group", { count: 4, batches: 3, prefix: "晨", suffix: "队", separator: "_", maxLength: 7 });
    const result = await run(w), members = result.values.flatMap(v => v.members!);
    expect(result.values).toHaveLength(3); expect(new Set(members).size).toBe(12);
    expect(result.values.every(v => v.members?.length === 4)).toBe(true);
    expect(members.every(m => m.startsWith("晨_") && m.endsWith("_队"))).toBe(true);
    expect((await run(w)).texts).toEqual(result.texts);
    w.seed++; expect((await run(w)).texts).not.toEqual(result.texts);
    param(w, "group", { maxLength: 2 });
    await expect(run(w)).rejects.toThrow("符合条件");
  });
  it("theme batches share a library and editable structure", async () => {
    const result = await run(createRelationRecipe("squad-theme"));
    expect(result.values).toHaveLength(2);
    expect(result.values.flatMap(v => v.members!).every(m => m.endsWith("巡游者"))).toBe(true);
    expect(new Set(result.values.flatMap(v => v.members!)).size).toBe(6);
  });
  it("deduplicates input before grouping and fails finitely when too few distinct names exist", async () => {
    const w = param(createRelationRecipe("squad-prefix"), "group", { count: 3, random: false });
    const reader = async function* () { for (const text of ["猫", "猫", "鹿", "鹿"]) yield { text, parts: [] }; };
    await expect(execute(w, reader, () => {})).rejects.toThrow("只有 2 个");
  });
  it("does not treat an entire pair as a single team member", async () => {
    const w = createRelationRecipe("couple");
    w.nodes.splice(1, 0, { id: "team", op: "group", inputs: ["names"], params: { ...operators.group.defaults } });
    w.nodes.at(-1)!.inputs = ["team"];
    await expect(run(w)).rejects.toThrow("单个名字");
  });
  it("can continue through P0 and P1-A transforms without keeping stale member metadata", async () => {
    for (const op of ["prefix", "hanconvert"] as const) {
      const w = createRelationRecipe("parallel");
      w.nodes.splice(1, 0, { id: "after", op, inputs: ["names"], params: { ...operators[op].defaults } });
      w.nodes.at(-1)!.inputs = ["after"];
      const value = (await run(w)).values[0];
      expect(value.text).not.toBe("春风入梦 / 秋雨归心");
      expect(value.members).toBeUndefined();
      expect(value.parts[0].pair?.left).toBe("春");
    }
  });
  it("keeps template slots, internal edges and history when copying a recipe", async () => {
    const w = createRelationRecipe("parallel"), empty = { ...w, nodes: [], layout: {} };
    const pasted = pasteNodes(empty, copyNodes(w, w.nodes.map(n => n.id))).workflow;
    expect((await run(pasted)).texts).toEqual((await run(w)).texts);
    const history = new WorkflowHistory(); history.push(w);
    const changed = param(structuredClone(w), "template", { separator: " ⇄ " });
    expect((await run(history.undo(changed)!)).texts).toEqual(["春风入梦 / 秋雨归心"]);
  });
});
describe("paired NameScript variables and bounds", () => {
  it("supports multiple paired loops, shared variables, conditionals and sequence mixed graphs", async () => {
    const w = parseScript(`let names = sequence {
      for a in pairs("p1b-sky", "couple") {
        for b in pairs("p1b-roles", "couple") {
          let shared = "小";
          if relation(a) == "couple" {
            emit(shared + left(a) + left(b) + " / " + shared + right(a) + right(b));
          }
        }
      }
    };
    let result = output(names);`, createWorkflow());
    expect((await run(w)).texts).toEqual(["小月亮邮差 / 小星星收件人"]);
    expect((await run(parseScript(toScript(w), w))).texts).toEqual((await run(w)).texts);
    const pkg = await exportPackage(w), imported = await importPackage(pkg);
    expect(pkg.operatorVersions.pairs).toBe(1);
    expect((await run(imported)).texts).toEqual((await run(w)).texts);
  });
  it("checks pair types, scope, and fixed references", () => {
    for (const source of ['for p in pairs("p1b-sky", "") { emit(p); }', 'for p in pairs("p1b-sky", "") { emit(left("wrong")); }', 'for p in pairs("p1b-sky", "") { emit(left(p)); } emit(right(p));', 'let id = "p1b-sky"; for p in pairs(id, "") { emit(left(p)); }'])
      expect(() => parseScript(source, createWorkflow())).toThrow();
  });
  it("rejects malformed templates, unbound variables, invalid counts and relations before execution", () => {
    const patches: Record<string, string>[] = [{ slots: "{}" }, { templates: '["{missing.left}"]' }, { templates: '["{sky}"]' }, { slots: '[{"name":"x","resourceId":"p1b-sky","kind":"pair","relation":"fake"}]' }];
    for (const patch of patches)
      expect(() => validateGraph(param(createRelationRecipe("couple"), "template", patch))).toThrow();
    for (const count of [0, -1, 1.5, 101, Infinity]) expect(() => validateGraph(param(createRelationRecipe("squad-prefix"), "group", { count }))).toThrow();
  });
  it("rejects ordinary resources used as pairs and relation resources used as words", async () => {
    const w = createRelationRecipe("couple");
    param(w, "template", { slots: '[{"name":"sky","resourceId":"p1b-space","kind":"pair"},{"name":"role","resourceId":"p1b-roles","kind":"pair"}]' });
    await expect(run(w)).rejects.toThrow("普通词条");
    const plain = createRelationRecipe("squad-prefix"); plain.nodes[0].params.resourceId = "p1b-sky";
    await expect(run(plain)).rejects.toThrow("关系词库");
  });
  it("obeys step, time, result limits and active cancellation on new paths", async () => {
    const w = createRelationRecipe("couple"); w.limit = 1;
    expect((await run(w)).stats.truncated).toBe(true);
    await expect(execute(w, readResource, () => {}, { steps: 2, milliseconds: 10000 })).rejects.toThrow("步数");
    await expect(execute(w, readResource, () => {}, { steps: 300000, milliseconds: -1 })).rejects.toThrow("时间");
    const abort = new AbortController();
    const reader = async function* (id: string, seed: number) { for await (const c of readResource(id, seed)) { abort.abort(); yield c; } };
    await expect(execute(w, reader, () => {}, undefined, { signal: abort.signal })).rejects.toThrow("取消");
  });
});
describe("relation persistence, migration and interchange", () => {
  it("upgrades populated schema 2 without altering resources, workflows, favorites or run history", async () => {
    const name = `migration-${crypto.randomUUID()}`, old = new Dexie(name);
    old.version(1).stores({ resources: "id,name", entries: "++id,resourceId,text,&[resourceId+text]", workflows: "id,name", favorites: "text,savedAt" });
    old.version(2).stores({ entries: "++id,resourceId,text,&[resourceId+text],[resourceId+id]", runs: "id,createdAt", generated: "[runId+text],text,runId" });
    await old.open(); const workflow = createWorkflow();
    await old.table("resources").put({ id: "old", name: "旧词库", count: 1, kind: "word", version: 7 });
    await old.table("entries").add({ resourceId: "old", text: "旧词" });
    await old.table("workflows").put(workflow); await old.table("favorites").put({ text: "收藏", savedAt: 1, parts: [] });
    await old.table("runs").put({ id: "run", createdAt: 1, workflow }); await old.table("generated").put({ runId: "run", text: "结果", parts: [] });
    old.close(); const upgraded = new ForgeDatabase(name);
    try {
      await upgraded.open(); expect(upgraded.verno).toBe(6);
      expect((await upgraded.resources.get("old"))?.version).toBe(7);
      expect((await upgraded.entries.toArray())[0].text).toBe("旧词");
      expect(await upgraded.workflows.get(workflow.id)).toEqual(workflow);
      expect(await upgraded.favorites.count()).toBe(1); expect(await upgraded.runs.count()).toBe(1); expect(await upgraded.generated.count()).toBe(1);
      expect(await upgraded.relations.count()).toBe(0);
    } finally { upgraded.close(); await upgraded.delete(); }
  });
  it("creates, updates, deduplicates and deletes typed rows transactionally", async () => {
    const count = (await db.resources.get("p1b-sky"))!.count;
    await saveRelationRows("p1b-sky", [{ left: " 月亮 ", right: "星星", relation: "couple" }]);
    expect((await db.resources.get("p1b-sky"))?.count).toBe(count);
    const row = await db.relations.where({ resourceId: "p1b-sky" }).first();
    await saveRelationRows("p1b-sky", [{ left: "朝", right: "暮", relation: "antonym" }], row!.id);
    expect((await db.relations.get(row!.id!))?.left).toBe("朝");
    await expect(saveRelationRows("p1b-sky", [{ left: "", right: "无效", relation: "associated" }], row!.id)).rejects.toThrow();
    expect((await db.relations.get(row!.id!))?.left).toBe("朝");
    await deleteRelationRow("p1b-sky", row!.id!);
    expect((await db.resources.get("p1b-sky"))?.count).toBe(count - 1);
    await expect(addEntries("p1b-sky", ["误加"])).rejects.toThrow("关系");
    await deleteResource("p1b-sky"); expect(await db.relations.where({ resourceId: "p1b-sky" }).count()).toBe(0);
  });
  it("reads a seeded rotation with actual pair/version provenance and detects edits during reads", async () => {
    const reader = readResource("p1b-sky", 1); const first = (await reader.next()).value!;
    expect(first.pair).toEqual({ left: "落日", right: "晚霞", relation: "associated", direction: "unknown", reverseQueryable: false });
    expect(first.parts[0].pair).toEqual(first.pair);
    await saveRelationRows("p1b-sky", [{ left: "朝", right: "暮", relation: "associated" }]);
    await expect(reader.next()).rejects.toThrow("更改");
  });
  it("paginates relationship reads beyond 256 rows without omission or duplication", async () => {
    await saveRelationRows("p1b-sky", Array.from({ length: 300 }, (_, i) => ({ left: `左${i}`, right: `右${i}`, relation: "associated" })));
    const values: Candidate[] = [];
    for await (const value of readResource("p1b-sky", 278)) values.push(value);
    expect(values).toHaveLength(302);
    expect(new Set(values.map(v => v.text)).size).toBe(302);
    expect(values.every(v => v.pair && v.parts[0].version === 3)).toBe(true);
  });
  it("roundtrips quoted CSV, TSV and JSON without splitting the two sides", () => {
    const rows = [{ left: '月,亮"', right: "星\n星", relation: "couple" as const }];
    expect(parseRelationRows(relationRowsFile(rows, "csv"), "rows.csv")).toEqual(rows.map(normalizePair));
    expect(parseRelationRows(relationRowsFile(rows, "json"), "rows.json")).toEqual(rows.map(normalizePair));
    expect(parseRelationRows("春\t秋\tparallel\n冷\t热\tantonym", "rows.tsv")).toHaveLength(2);
    expect(() => parseRelationRows("冷\t热\tfake", "rows.tsv")).toThrow();
    expect(() => parseRelationRows("only-one-column", "rows.csv")).toThrow();
    expect(() => parseRelationRows('[{"left":"冷","right":"热"}]', "rows.json")).toThrow();
    expect(() => parseRelationRows('{"format":"glyphforge-relations","version":999,"rows":[]}', "rows.json")).toThrow("版本");
  });
  it("does not overwrite user changes when example recipes are reopened", async () => {
    await db.resources.update("p1b-sky", { name: "我的自定义关系" });
    const row = await db.relations.where({ resourceId: "p1b-sky" }).first();
    await saveRelationRows("p1b-sky", [{ left: "朝", right: "暮", relation: "associated" }], row!.id);
    await ensureRecipeExamples();
    expect((await db.resources.get("p1b-sky"))?.name).toBe("我的自定义关系");
    expect((await db.relations.get(row!.id!))?.left).toBe("朝");
  });
  it("requires compatible relation bindings for lightweight packages and refuses bad snapshots atomically", async () => {
    const w = createRelationRecipe("couple"), pkg = await exportPackage(w, false);
    expect(pkg.version).toBe(4);
    await deleteResource("p1b-sky");
    await expect(importPackage(pkg)).rejects.toBeInstanceOf(ResourceDependencyError);
    await expect(importPackage(pkg, { "p1b-sky": "p1b-space" })).rejects.toBeInstanceOf(ResourceDependencyError);
    const restored = await importPackage(pkg, { "p1b-sky": "p1b-roles" }); expect((await run(restored)).values.length).toBeGreaterThan(0);
    const bad = await exportPackage(createRelationRecipe("parallel"));
    bad.resources[0].relationRows![0].left = "";
    const before = await db.resources.count();
    await expect(importPackage(bad)).rejects.toThrow("关系行"); expect(await db.resources.count()).toBe(before);
  });
  it("retains structured members and row snapshots in favorite and generated records", async () => {
    const value = (await run(createRelationRecipe("parallel"))).values[0];
    await db.favorites.put({ ...value, savedAt: Date.now() });
    await db.generated.put({ ...value, runId: "pair-run" });
    expect((await db.favorites.get(value.text))?.members).toEqual(["春风入梦", "秋雨归心"]);
    expect((await db.generated.get(["pair-run", value.text]))?.parts[0].pair?.left).toBe("春");
  });
  it("roundtrips the standalone pairs node with a type filter", async () => {
    const w = createRelationRecipe("antonyms"); w.nodes = [{ id: "p", op: "pairs", inputs: [], params: { ...operators.pairs.defaults, resourceId: "p1b-antonyms", relation: "antonym" } }, { id: "result", op: "output", inputs: ["p"], params: {} }];
    expect((await run(parseScript(toScript(w), w))).values).toHaveLength(2);
  });
});
