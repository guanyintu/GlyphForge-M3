import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { execute } from "../core/engine";
import { createWorkflow } from "../core/model";
import type { Candidate, RuleNode, SubgraphDefinition, Workflow } from "../core/model";
import { parseScript, toScript, validateGraph } from "../core/script";
import { extractSubgraph, MAX_CALL_DEPTH } from "../core/subgraphs";
import { copyNodes, pasteNodes } from "../core/graph-editing";
import { db } from "../storage/db";
import { exportPackage, importPackage, dependencyIds } from "../core/sharing";
import { functionLibrary, saveDefinition } from "../storage/subgraph-library";

export function fixture(): Workflow {
  const d: SubgraphDefinition = { id: "decorate", version: 1, name: "同名函数", parameters: [{ name: "input", type: "CandidateSequence" }, { name: "tag", type: "string", default: "小" }], returns: "CandidateSequence", nodes: [
    { id: "arg", op: "argument", inputs: [], params: { name: "input" } },
    { id: "pre", op: "prefix", inputs: ["arg"], params: { text: "小" }, parameterBindings: { text: "tag" } },
    { id: "rev", op: "reverse", inputs: ["pre"], params: {} },
    { id: "mood", op: "resource", inputs: [], params: { resourceId: "moods" } },
    { id: "mix", op: "pattern", inputs: ["rev", "mood"], params: { template: "AB" } },
  ], output: "mix", layout: {} };
  return { ...createWorkflow(), subgraphs: [d], nodes: [
    { id: "source", op: "resource", inputs: [], params: { resourceId: "animals" } },
    { id: "a", op: "call", inputs: ["source"], params: {}, call: { definitionId: d.id, version: 1, bindings: { tag: "星" } } },
    { id: "b", op: "call", inputs: ["source"], params: {}, call: { definitionId: d.id, version: 1, bindings: { tag: "月" } } },
    { id: "mix", op: "concat", inputs: ["a", "b"], params: { separator: "|" } },
    { id: "result", op: "output", inputs: ["mix"], params: {} },
  ] };
}
const read = async function* (id: string) { for (const text of id === "animals" ? ["猫"] : ["甜"]) yield { text, parts: [{ resourceId: id, text, version: 1 }], notes: ["来源"] }; };
async function run(w: Workflow, limits?: {steps: number; milliseconds: number}, signal?: AbortSignal) { const rows: Candidate[] = []; const stats = await execute(w, read, b => rows.push(...b), limits, { signal }); return { rows, stats }; }
afterEach(async () => { await Promise.all([db.workflows.clear(), db.resources.clear(), db.entries.clear(), db.relations.clear(), functionLibrary.definitions.clear()]); });

describe("parameterized sequence functions", () => {
  it("runs real multi-node chains with independent arguments, stable order and sources", async () => {
    const w = fixture(), original = JSON.stringify(w); const r = await run(w);
    expect(r.rows[0].text).toBe("猫星甜|猫月甜"); expect(r.rows[0].parts).toHaveLength(2); expect(r.rows[0].notes).toEqual(["来源"]);
    expect(await run(w)).toEqual(expect.objectContaining({ rows: r.rows })); expect(JSON.stringify(w)).toBe(original);
  });
  it("extracts already wired nodes and preserves behavior", async () => {
    const w = createWorkflow("echo"); const result = extractSubgraph(w, ["a", "mix", "check"]);
    expect(result.definition.parameters).toEqual([{ name: "input1", type: "CandidateSequence" }]);
    expect((await run(result.workflow)).rows).toEqual((await run(w)).rows);
  });
  it("roundtrips readable functions through the existing expression parser", async () => {
    const w = fixture(), code = toScript(w); expect(code).toContain("tag string ="); expect(code).toContain("return mix;");
    const next = parseScript(code, w); expect((await run(next)).rows).toEqual((await run(w)).rows);
    expect((await run(parseScript(toScript(next), next))).rows).toEqual((await run(w)).rows);
  });
  it("edits function code and evaluates it", async () => {
    const w = fixture(); const changed = parseScript(toScript(w).replace('"星"', '"光"'), w); expect((await run(changed)).rows[0].text).toBe("猫光甜|猫月甜");
  });
  it("applies default arguments without cross-instance cache pollution", async () => {
    const w = fixture(); w.nodes[1].call!.bindings = {}; expect((await run(w)).rows[0].text).toBe("猫小甜|猫月甜");
    expect((await run(parseScript(toScript(w).replace('f1(source, "小")', 'f1(source)'), w))).rows[0].text).toBe("猫小甜|猫月甜");
  });
  it("checks number/boolean defaults using the same operator parameter contracts", async () => {
    const w = fixture(), d = w.subgraphs![0];
    d.parameters.push({ name: "max", type: "number", default: 5 }, { name: "random", type: "boolean", default: false });
    d.nodes.push({ id: "filter", op: "filter", inputs: ["mix"], params: { maxLength: 5, includes: "", excludes: "" }, parameterBindings: { maxLength: "max" } });
    d.nodes.push({ id: "grouped", op: "group", inputs: ["filter"], params: { count: 1 }, parameterBindings: { random: "random" } }); d.output = "grouped";
    expect((await run(parseScript(toScript(w), w))).rows).toEqual((await run(w)).rows);
    w.nodes[1].call!.bindings.max = "5"; expect(() => validateGraph(w)).toThrow(/max/);
    w.nodes[1].call!.bindings.max = Infinity; expect(() => validateGraph(w)).toThrow(/max/);
  });
  it.each([undefined, 1, true])("rejects missing required or wrong typed arguments: %s", value => {
    const w = fixture(); delete w.subgraphs![0].parameters[1].default; w.nodes[1].call!.bindings = value === undefined ? {} : { tag: value }; expect(() => validateGraph(w)).toThrow(/tag/);
  });
  it("rejects unknown parameters and cross-scope capture", () => {
    const w = fixture(); w.nodes[1].call!.bindings.wrong = "x"; expect(() => validateGraph(w)).toThrow(/未知/);
    delete w.nodes[1].call!.bindings.wrong; w.subgraphs![0].nodes[1].parameterBindings = { text: "outer" }; expect(() => validateGraph(w)).toThrow(/越界/);
  });
  it("rejects node variables shadowing parameters and captures in code with line/node diagnostics", () => {
    const w = fixture(); expect(() => parseScript(toScript(w).replace("let pre =", "let tag ="), w)).toThrow(/遮蔽/);
    try { parseScript(toScript(w).replace("prefix(arg, tag)", "prefix(source, tag)"), w); throw new Error("accepted"); } catch (e: any) { expect(e.diagnostic).toMatchObject({ code: "SCOPE", nodeId: "pre", line: expect.any(Number) }); }
  });
  it("keeps same display names independent through IDs and renaming", async () => {
    const w = fixture(), d = structuredClone(w.subgraphs![0]); d.id = "other"; w.subgraphs!.push(d); w.nodes[2].call!.definitionId = "other"; w.subgraphs![0].name = "重命名";
    expect((await run(w)).rows[0].text).toBe("猫星甜|猫月甜"); expect((await run(parseScript(toScript(w), w))).rows[0].text).toBe("猫星甜|猫月甜");
  });
  it("rejects missing references and cyclic dependencies before saving/execution", async () => {
    const w = fixture(); w.nodes[1].call!.version = 99; expect(() => validateGraph(w)).toThrow(/缺失/);
    w.nodes[1].call!.version = 1; w.subgraphs![0].nodes.push({ id: "self", op: "call", inputs: ["arg"], params: {}, call: { definitionId: "decorate", version: 1, bindings: {} } }); expect(() => validateGraph(w)).toThrow(/循环/); await expect(run(w)).rejects.toThrow(/循环/);
  });
  it("bounds nested calls and shares a single step/time/cancellation budget", async () => {
    const w = fixture();
    for (let i = 1; i < MAX_CALL_DEPTH; i++) { const previous = w.subgraphs!.at(-1)!; const d = structuredClone(previous); d.id = `layer${i}`; d.nodes = [{ id: "arg", op: "argument", inputs: [], params: { name: "input" } }, { id: "nested", op: "call", inputs: ["arg"], params: {}, call: { definitionId: previous.id, version: 1, bindings: {} }, parameterBindings: { tag: "tag" } }]; d.output = "nested"; w.subgraphs!.push(d); }
    w.nodes[1].call!.definitionId = w.subgraphs!.at(-1)!.id;
    expect((await run(w)).rows[0].text).toBe("猫星甜|猫月甜"); await expect(run(w, { steps: 20, milliseconds: 10000 })).rejects.toThrow(/步数/); await expect(run(w, { steps: 300000, milliseconds: -1 })).rejects.toThrow(/时间/);
    const c = new AbortController(); c.abort(); await expect(run(w, undefined, c.signal)).rejects.toThrow(/取消/);
    const d = structuredClone(w.subgraphs!.at(-1)!); d.id = "too_deep"; d.nodes[1].call!.definitionId = w.subgraphs!.at(-1)!.id; w.subgraphs!.push(d); expect(() => validateGraph(w)).toThrow(/深度/);
  });
  it("locates runtime failures inside the call path, including missing resources", async () => {
    const w = fixture(); const rows: Candidate[] = []; try { await execute(w, read, b => rows.push(...b), undefined, { resourceMetadata: async id => id === "moods" ? undefined : { kind: "word" } }); throw new Error("accepted"); } catch (e: any) { expect(e.diagnostic).toMatchObject({ code: "RESOURCE", nodeId: "a/mood" }); }
  });
  it("preserves Pair/members at sequence boundaries and invalidates transformed display metadata", async () => {
    const w = fixture(); const d = w.subgraphs![0]; d.nodes = [d.nodes[0], { id: "identity", op: "prefix", inputs: ["arg"], params: { text: "" } }]; d.output = "identity"; w.nodes = [w.nodes[0], w.nodes[1], w.nodes[4]]; w.nodes[2].inputs = ["a"];
    const pair = { left: "甲", right: "乙", relation: "couple" as const }; const item = { text: "甲/乙", pair, members: ["甲", "乙"], parts: [{ resourceId: "pair", text: "甲/乙", pair }] };
    w.nodes[0].op = "pairs"; w.nodes[0].params = { resourceId: "pair", relation: "" };
    const reader = async function* () { yield item; }; const rows: Candidate[] = []; await execute(w, reader, b => rows.push(...b)); expect(rows[0].pair).toEqual(pair); expect(rows[0].members).toEqual(item.members);
    d.nodes[1].params.text = "新"; rows.length = 0; await execute(w, reader, b => rows.push(...b)); expect(rows[0].pair).toBeUndefined(); expect(rows[0].members).toBeUndefined(); expect(rows[0].parts[0].pair).toEqual(pair);
  });
  it("persists definitions/instances and reuses the library independently of workflow names", async () => {
    const w = fixture(); await db.workflows.put(w);
    const unrelated = { ...structuredClone(w.subgraphs![0]), id: "unrelated" };
    await saveDefinition(w.subgraphs![0], [...w.subgraphs!, unrelated]);
    const loaded = await db.workflows.get(w.id); expect((await run(loaded!)).rows).toEqual((await run(w)).rows);
    const stored = (await functionLibrary.definitions.toArray())[0]; expect(stored.definition.id).toBe("decorate"); expect(stored.dependencies).toHaveLength(1);
  });
  it("copies definitions across workflows and safely remaps conflicting IDs", async () => {
    const w = fixture(), target = fixture(); target.subgraphs![0].name = "本地不同内容";
    const p = pasteNodes(target, copyNodes(w, w.nodes.map(n => n.id))); expect(p.workflow.subgraphs).toHaveLength(2); expect(p.workflow.subgraphs![0].name).toBe("本地不同内容");
    const pasted = { ...p.workflow, nodes: p.workflow.nodes.filter(n => p.ids.includes(n.id)) }; expect((await run(pasted)).rows[0].text).toBe("猫星甜|猫月甜");
    const bad = copyNodes(w, ["a"]); bad.subgraphs = []; expect(() => pasteNodes(target, bad)).toThrow(/缺失/);
  });
  it("exports transitive resources in v5 and imports with fresh IDs without damaging originals", async () => {
    const w = fixture(); for (const id of dependencyIds(w)) { await db.resources.add({ id, name: id, version: 1, kind: "word", count: 1, description: "", color: "green", updatedAt: 0 }); await db.entries.add({ resourceId: id, text: id === "animals" ? "猫" : "甜" }); }
    const pkg = await exportPackage(w); expect(pkg.version).toBe(5); expect(pkg.dependencies).toHaveLength(2);
    const restored = await importPackage(pkg); expect(restored.subgraphs![0].id).not.toBe(w.subgraphs![0].id); expect(await db.entries.where("resourceId").equals("animals").count()).toBe(1); validateGraph(restored);
    const rows: Candidate[] = []; const { readResource } = await import("../storage/db"); await execute(restored, readResource, b => rows.push(...b)); expect(rows[0].text).toBe("猫星甜|猫月甜");
    const corrupt = structuredClone(pkg); corrupt.workflow.subgraphs![0].version = 2; await expect(importPackage(corrupt)).rejects.toThrow(/缺失/);
    const cyclic = structuredClone(pkg); cyclic.workflow.subgraphs![0].nodes.push({ id: "recursive", op: "call", inputs: ["arg"], params: {}, call: { definitionId: "decorate", version: 1, bindings: {} } });
    const count = await db.resources.count(); await expect(importPackage(cyclic)).rejects.toThrow(/循环/); expect(await db.resources.count()).toBe(count);
  });
  it("streams 100 call instances with constant resource residency and bounded batches", async () => {
    const w = fixture(); w.subgraphs![0] = { ...w.subgraphs![0], parameters: [], nodes: [{ id: "r", op: "resource", inputs: [], params: { resourceId: "large" } }], output: "r" };
    const leaf = structuredClone(w.subgraphs![0]); leaf.id = "leaf"; w.subgraphs!.push(leaf);
    w.subgraphs![0].nodes = ["left", "right"].map(id => ({ id, op: "call", inputs: [], params: {}, call: { definitionId: "leaf", version: 1, bindings: {} } }));
    w.subgraphs![0].nodes.push({ id: "joined", op: "concat", inputs: ["left", "right"], params: { separator: "" } }); w.subgraphs![0].output = "joined";
    const calls: RuleNode[] = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, op: "call", inputs: [], params: {}, call: { definitionId: "decorate", version: 1, bindings: {} } }));
    w.nodes = [...calls]; let last = calls[0].id; for (let i = 1; i < 100; i++) { const id = `join${i}`; w.nodes.push({ id, op: "concat", inputs: [last, `c${i}`], params: { separator: "" } }); last = id; } w.nodes.push({ id: "out", op: "output", inputs: [last], params: {} }); w.limit = 1;
    let produced = 0, maxBatch = 0; const started = performance.now(); const stats = await execute(w, async function* () { for (let i = 0; i < 1000000; i++) { produced++; yield { text: i === 0 ? "字" : "另", parts: [] }; } }, b => { maxBatch = Math.max(maxBatch, b.length); });
    // Stops at the second distinct result; a million-entry logical resource is not materialized.
    expect(stats.count).toBe(1); expect(produced).toBeLessThan(500); expect(maxBatch).toBe(1);
    console.log("P2-A 100 outer / 300 total calls", { milliseconds: performance.now() - started, produced, maxBatch, steps: stats.steps, definitionBytes: JSON.stringify(w.subgraphs).length });
  });
  it("preserves relation Pair and template members/parts through v5 subgraph sharing", async () => {
    const { readResource } = await import("../storage/db");
    const pair = { left: "甲", right: "乙", relation: "couple" as const, direction: "symmetric" as const, reverseQueryable: true, source: "真实来源", tags: ["成对"] };
    await db.resources.add({ id: "pair", name: "关系", kind: "relation", description: "", color: "green", count: 1, version: 1, updatedAt: 0 });
    await db.relations.add({ ...pair, resourceId: "pair" });
    for (const op of ["pairs", "template"] as const) {
      const w = fixture(), d = w.subgraphs![0]; d.parameters = [];
      d.nodes = [{ id: "r", op, inputs: [], params: op === "pairs" ? { resourceId: "pair", relation: "" } : { slots: '[{"name":"x","kind":"pair","resourceId":"pair","relation":""}]', templates: '["{x.left}","{x.right}"]' } }, { id: "identity", op: "prefix", inputs: ["r"], params: { text: "" } }]; d.output = "identity";
      w.nodes = [{ ...w.nodes[1], inputs: [], call: { definitionId: d.id, version: 1, bindings: {} } }, { id: "out", op: "output", inputs: ["a"], params: {} }];
      const before: Candidate[] = []; await execute(w, readResource, b => before.push(...b));
      const pkg = await exportPackage(w); expect(pkg.version).toBe(5);
      const restored = await importPackage(pkg); const after: Candidate[] = []; await execute(restored, readResource, b => after.push(...b));
      expect(after[0].text).toBe(before[0].text); expect(after[0].pair).toEqual(before[0].pair); expect(after[0].members).toEqual(before[0].members); expect(after[0].parts[0].pair).toEqual(before[0].parts[0].pair);
    }
  });
  it("protects the source workflow on unsupported function syntax", () => { const w = fixture(), before = JSON.stringify(w); expect(() => parseScript(toScript(w).replace("return mix;", "while true { return mix; }"), w)).toThrow(); expect(JSON.stringify(w)).toBe(before); });
});
