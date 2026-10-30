import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { ContractError, astParams, astSignatures, executionBudget, normalizeParams, operatorContracts } from "../core/contracts";
import { createWorkflow, operators, candidateText } from "../core/model";
import type { Candidate, Op, Params, Workflow } from "../core/model";
import { execute } from "../core/engine";
import { labWorkflow } from "../core/lab";
import { parseScript, toScript, validateGraph } from "../core/script";
import { copyNodes, pasteNodes } from "../core/graph-editing";
import { exportPackage, importPackage } from "../core/sharing";
import { db, readResource } from "../storage/db";

const source = (text: string): Candidate => ({ text, parts: [{ resourceId: "__lab__", text, version: 1 }], notes: ["输入注记"] });
const reader = async function* () { yield source("月"); };
async function rows(w: Workflow, read = reader) {
  const output: Candidate[] = [];
  await execute(w, read, batch => output.push(...batch));
  return output.map(({ text, parts, notes, pair, members }) => ({ text, parts, notes, pair, members }));
}
const unary: [Op, Params, string][] = [
  ["pinyin", {}, "月"], ["homophones", { limit: 4 }, "月"], ["rhyme", { reference: "月" }, "月"],
  ["hanconvert", {}, "月"], ["mapchars", {}, "月"], ["decompose", {}, "明"],
  ["components", {}, "明"], ["compose", { limit: 4 }, "日,月"], ["hanfilter", {}, "月"],
  ["prefix", {}, "月"], ["reverse", {}, "月👩‍💻"], ["filter", {}, "月"],
];
it.each(unary)("%s: node, printed code, AST and laboratory agree with omitted defaults", async (op, params, text) => {
  const w = labWorkflow(op, params, 0), read = async function* () { yield source(text); };
  const result = await rows(w, read);
  expect(result.length).toBeGreaterThan(0);
  expect(await rows(parseScript(toScript(w), w), read)).toEqual(result);
  const signature = astSignatures[op];
  if (signature) {
    const p = normalizeParams(op, params);
    const args = signature.parameters!.map((key, i) => key ? JSON.stringify(p[key]) : i === 0 ? "x" : "").join(", ");
    const expr = `${op}(${args})`;
    const emit = signature.result === "strings" ? `for y in ${expr} { emit(y); }` : `emit(${expr});`;
    expect(await rows(parseScript(`for x in @__lab__ { ${emit} }`, w), read)).toEqual(result);
  }
});
it("all builtins expose bounded signatures and supported entry points", () => {
  expect(Object.keys(operatorContracts)).toEqual(Object.keys(operators));
  for (const c of Object.values(operatorContracts)) {
    expect(c.graph.inputs).toEqual(Array(operators[c.id].inputs).fill("CandidateSequence"));
    expect(c.budget.limits).toBe(executionBudget);
    expect(c.budget.scope).toBe("run");
    expect(c.streaming).toBe(c.id === "group" ? "buffered" : "incremental");
    expect(normalizeParams(c.id, {})).toEqual(operators[c.id].defaults);
  }
  expect(() => labWorkflow("concat", {})).toThrow(ContractError);
});
it("cross-product pattern/concat share AST text, notes and deduplicated provenance", async () => {
  for (const op of ["pattern", "concat"] as const) {
    const w = createWorkflow();
    w.nodes = [{ id: "a", op: "resource", inputs: [], params: {} }, { id: "mix", op, inputs: ["a", "a"], params: op === "pattern" ? { template: "AABB" } : { separator: "·" } }, { id: "out", op: "output", inputs: ["mix"], params: {} }];
    const expr = op === "pattern" ? 'pattern("AABB", x, y)' : 'concat(x, y, "·")';
    const ast = parseScript(`for x in @nature { for y in @nature { emit(${expr}); } }`, w);
    expect(await rows(w)).toEqual(await rows(ast));
    expect(await rows(parseScript(toScript(w), w))).toEqual(await rows(w));
  }
});
it.each([undefined, NaN, Infinity, "1", false])("explicit invalid probability %s is rejected at every boundary", async value => {
  const p = { ...operators.hanconvert.defaults, probability: value } as Params;
  const w = createWorkflow(); w.nodes.splice(-1, 0, { id: "bad", op: "hanconvert", inputs: ["check"], params: p });
  for (const action of [() => normalizeParams("hanconvert", p), () => validateGraph(w), () => labWorkflow("hanconvert", p), () => pasteNodes(w, copyNodes(w, ["bad"]))]) {
    try { action(); throw new Error("accepted invalid parameter"); } catch (e) { expect(e).toBeInstanceOf(ContractError); expect((e as ContractError).diagnostic.code).toBe("PARAMETER"); }
  }
});
it("AST dynamic parameters validate even when a Chinese result is never iterated", async () => {
  const w = parseScript('let p = 2; let unused = hanconvert("月", "traditional", p); emit("x");', createWorkflow());
  await expect(rows(w)).rejects.toMatchObject({ diagnostic: { code: "PARAMETER", operator: "hanconvert", line: 1, nodeId: "program" } });
  expect(() => parseScript('emit(pattern("X", "a", "b"));', w)).toThrow(/模式/);
  expect(() => parseScript('emit(unknown);', w)).toThrow(/作用域/);
  expect(() => parseScript('emit(reverse(["a"]));', w)).toThrow(/string/);
});
it("AST optional defaults keep legacy positional calls and gamecheck predicate semantics", async () => {
  const w = parseScript('for x in pinyin("月") { emit(x); } emit(prefix("月")); if gamecheck("abc") { emit("ok"); }', createWorkflow());
  expect((await rows(w)).map(c => c.text)).toEqual(["yuè", "小月", "ok"]);
  expect(astParams("pairs", ["r"])).toEqual({ resourceId: "r", relation: "" });
});
it("Pair is never a String or implicit collection; text transforms invalidate tuple metadata only on change", async () => {
  const pair = { left: "月", right: "星", relation: "couple" as const };
  const c = { ...source("月 / 星"), pair, members: ["月", "星"] };
  expect(candidateText(c, c.text)).toBe(c);
  expect(candidateText(c, "小月")).not.toHaveProperty("pair");
  expect(candidateText(c, "小月")).not.toHaveProperty("members");
  expect(() => parseScript('for p in pairs("r") { emit(p); }', createWorkflow())).toThrow(/String/);
  const w = parseScript('for p in pairs("r") { emit(left(p) + right(p)); }', createWorkflow());
  expect((await rows(w, async function* () { yield c; }))[0].text).toBe("月星");
});
it("node and nested AST execution consume a shared budget and cancellation preserves its diagnostic", async () => {
  const w = parseScript('for n in range(0, 1000) { emit(text(n)); }', createWorkflow());
  await expect(execute(w, reader, () => {}, { steps: 20, milliseconds: 10000 })).rejects.toMatchObject({ diagnostic: { code: "BUDGET" } });
  const controller = new AbortController(); controller.abort();
  await expect(execute(w, reader, () => {}, undefined, { signal: controller.signal })).rejects.toMatchObject({ diagnostic: { code: "CANCELLED" } });
});
beforeEach(async () => { await db.resources.clear(); await db.entries.clear(); await db.relations.clear(); });
it("empty resources are checked by metadata for graph, AST and template slots before reading rows", async () => {
  await db.resources.bulkAdd(["word", "relation"].map(kind => ({ id: kind, kind: kind as "word" | "relation", name: kind, description: "", color: "green", count: 0, version: 1, updatedAt: 0 })));
  for (const code of ['let a = pairs("word", "");\nlet out = output(a);', 'let a = resource("relation");\nlet out = output(a);', 'for p in pairs("word") { emit(left(p)); }', 'for x in @relation { emit(x); }']) {
    const w = parseScript(code, createWorkflow());
    await expect(execute(w, (id, seed) => readResource(id, seed), () => {}, undefined, { resourceMetadata: id => db.resources.get(id) })).rejects.toMatchObject({ diagnostic: { code: "TYPE" } });
  }
  const w = createWorkflow(); w.nodes = [{ id: "t", op: "template", inputs: [], params: { ...operators.template.defaults, slots: '[{"name":"x","resourceId":"word","kind":"pair"}]', templates: '["{x.left}"]' } }, { id: "out", op: "output", inputs: ["t"], params: {} }];
  await expect(execute(w, readResource, () => {}, undefined, { resourceMetadata: id => db.resources.get(id) })).rejects.toMatchObject({ diagnostic: { code: "TYPE", nodeId: "t" } });
});
it.each([1, 2, 3, 4])("v%s portable package and old workflow retain execution semantics", async version => {
  await db.resources.add({ id: "nature", name: "n", kind: "word", description: "", color: "green", count: 1, version: 1, updatedAt: 0 });
  await db.entries.add({ resourceId: "nature", text: "月" });
  const w = createWorkflow(); w.nodes = [{ id: "a", op: "resource", inputs: [], params: { resourceId: "nature" } }, { id: "p", op: "prefix", inputs: ["a"], params: { text: "小" } }, { id: "out", op: "output", inputs: ["p"], params: {} }];
  const pkg = await exportPackage(w); const old = { ...pkg, version };
  await db.resources.clear(); await db.entries.clear();
  const restored = await importPackage(JSON.parse(JSON.stringify(old)));
  const output: Candidate[] = [];
  await execute(restored, readResource, b => output.push(...b), undefined, { resourceMetadata: id => db.resources.get(id) });
  expect(output.map(c => c.text)).toEqual(["小月"]);
});
