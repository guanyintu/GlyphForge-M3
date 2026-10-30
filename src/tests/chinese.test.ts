import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Candidate, Params, Workflow } from "../core/model";
import { operators } from "../core/model";
import { transformChinese } from "../core/chinese";
import { chineseDefinitions, validateChineseParams } from "../core/chinese-definitions";
import type { ChineseOp } from "../core/chinese-definitions";
import { labWorkflow } from "../core/lab";
import { execute } from "../core/engine";
import { parseScript, toScript } from "../core/script";
import { db, readResource, saveNewResource } from "../storage/db";
import { exportPackage, importPackage } from "../core/sharing";

async function transform(op: ChineseOp, text: string, params: Params = {}, seed = 42, tick = () => {}) {
  const output: Candidate[] = [];
  for await (const c of transformChinese(op, { text, parts: [{ resourceId: "source", text, version: 2 }] }, { ...operators[op].defaults, ...params }, seed, tick)) output.push(c);
  return output;
}
const texts = (items: Candidate[]) => items.map(c => c.text);
async function run(w: Workflow, input: string[]) {
  const result: Candidate[] = [];
  await execute(w, async function* () { for (const text of input) yield { text, parts: [] }; }, batch => result.push(...batch));
  return result;
}
describe("P1-A Chinese phonetics and conversion", () => {
  it("uses contextual pinyin and exposes first letters, initials, finals and tones", async () => {
    expect(texts(await transform("pinyin", "重庆"))).toEqual(["chóng qìng"]);
    for (const [mode, expected] of [["first", "z g"], ["initial", "zh g"], ["final", "ong uo"], ["tone", "1 2"]])
      expect(texts(await transform("pinyin", "中国", { mode, tone: "none" }))).toEqual([expected]);
    expect(texts(await transform("pinyin", "爱", { mode: "initial" }))).toEqual(["∅"]);
    expect(texts(await transform("pinyin", "爱", { mode: "first" }))).toEqual(["a"]);
  });
  it("enumerates polyphonic candidates with ambiguity notes and caps the product", async () => {
    const out = await transform("pinyin", "重", { mode: "polyphonic" });
    expect(texts(out)).toEqual(expect.arrayContaining(["zhòng", "chóng"]));
    expect(out[0].notes?.join()).toContain("不保证语境正确");
    expect(await transform("pinyin", "重行长乐重行长乐", { mode: "polyphonic", limit: 3 })).toHaveLength(3);
  });
  it("preserves unmapped text and complete emoji clusters", async () => {
    expect(texts(await transform("mapchars", "月👨‍👩‍👧‍👦X", { mapping: '{"月":["玥","鈅"]}' }))).toEqual(["玥👨‍👩‍👧‍👦X", "鈅👨‍👩‍👧‍👦X"]);
  });
  it("offers multiple martian candidates and deterministic probabilities", async () => {
    expect(texts(await transform("hanconvert", "月", { mode: "martian" }))).toEqual(["玥", "鈅"]);
    expect(texts(await transform("hanconvert", "月星", { mode: "martian", probability: 0 }))).toEqual(["月星"]);
    const options = { mode: "martian", probability: .5 };
    expect(await transform("hanconvert", "月星月星", options, 12)).toEqual(await transform("hanconvert", "月星月星", options, 12));
  });
  it("uses phrase-aware OpenCC in both directions", async () => {
    expect(texts(await transform("hanconvert", "头发发展", { mode: "traditional" }))).toEqual(["頭髮發展"]);
    expect(texts(await transform("hanconvert", "頭髮發展", { mode: "simplified" }))).toEqual(["头发发展"]);
    expect(texts(await transform("hanconvert", "头发", { mode: "traditional", probability: 0 }))).toEqual(["头发"]);
  });
  it("queries actual Unihan homophones and validates single-character inputs", async () => {
    expect(texts(await transform("homophones", "明", { limit: 128 }))).toContain("铭");
    await expect(transform("homophones", "月亮")).rejects.toThrow("一个汉字");
  });
  it("filters modern rhymes by contextual final syllable and optional tone", async () => {
    expect(texts(await transform("rhyme", "窗", { reference: "星光" }))).toEqual(["窗"]);
    expect(texts(await transform("rhyme", "床", { reference: "星光", matchTone: true }))).toEqual([]);
    expect(texts(await transform("rhyme", "月亮", { reference: "星光" }))).toEqual([]);
  });
  it("limits huge mapping combinations without expanding all products", async () => {
    let steps = 0;
    const out = await transform("mapchars", "月".repeat(40), { mapping: '{"月":["玥","鈅","月"]}', limit: 5 }, 42, () => { steps++; });
    expect(out).toHaveLength(5); expect(steps).toBeLessThan(15);
    await expect(transform("mapchars", "月".repeat(40), { mapping: JSON.stringify({ 月: ["月".repeat(64)] }) })).rejects.toThrow("1024");
  });
  it("rejects malformed or out-of-range parameters before execution", () => {
    const invalidParams: Params[] = [{ probability: -1 }, { limit: Infinity }, { limit: 1000 }, { mode: "fake" }];
    for (const invalid of invalidParams)
      expect(() => validateChineseParams("hanconvert", { ...operators.hanconvert.defaults, ...invalid })).toThrow();
    for (const mapping of ['null', '[]', '{"月":[]}', '{"月亮":["明"]}', '{bad'])
      expect(() => validateChineseParams("mapchars", { ...operators.mapchars.defaults, mapping })).toThrow();
  });
});

describe("P1-A real structure data", () => {
  it("decomposes 明 left/right and 思 top/bottom", async () => {
    const ming = await transform("decompose", "明"), si = await transform("decompose", "思");
    expect(texts(ming)).toEqual(["日、月"]); expect(ming[0].notes?.join()).toContain("左右");
    expect(texts(si)).toEqual(["田、心"]); expect(si[0].notes?.join()).toContain("上下");
    expect(texts(await transform("decompose", "明", { structure: "top-bottom" }))).toEqual([]);
  });
  it("handles enclosure, recursive decomposition and component extraction", async () => {
    expect((await transform("decompose", "国", { structure: "enclosure" }))[0].notes?.join()).toContain("包围");
    expect(texts(await transform("decompose", "盟", { depth: 2 }))[0]).toContain("日、月");
    expect(texts(await transform("components", "明", { depth: 1 }))).toEqual(["日", "月"]);
  });
  it("keeps unknown and indivisible inputs without fabricating structures", async () => {
    const out = await transform("decompose", "一🦊\u{31350}");
    expect(texts(out)).toContain("🦊");
    expect(out.find(c => c.text === "🦊")?.notes?.join()).toContain("无可用");
    expect(texts(out)).toContain("\u{31350}");
    expect(texts(await transform("decompose", "𠀀"))[0]).not.toContain("\uFFFD");
  });
  it("reverse-composes only actual known characters and respects duplicate counts", async () => {
    expect(texts(await transform("compose", "日、月"))).toContain("明");
    expect(texts(await transform("compose", "木、木", { limit: 128 }))).toContain("林");
    expect(texts(await transform("compose", "日、月、鲸"))).toEqual([]);
    await expect(transform("compose", "99999")).rejects.toThrow("不接受虚构");
  });
  it("finds characters by components and filters structure and strokes", async () => {
    expect(texts(await transform("compose", "日、月", { match: "contains", deep: true, limit: 128 }))).toContain("盟");
    expect(texts(await transform("hanfilter", "明", { minStrokes: 8, maxStrokes: 8, structure: "left-right" }))).toEqual(["明"]);
    expect(texts(await transform("hanfilter", "明", { minStrokes: 9 }))).toEqual([]);
    expect(texts(await transform("hanfilter", "🦊"))).toEqual([]);
    let warmSteps = 0;
    await transform("compose", "日、月", { match: "contains", deep: true }, 42, () => { warmSteps++; });
    expect(warmSteps).toBeLessThan(10000); // Cached index avoids another 85,238-record scan.
  });
  it("preserves real input provenance through conversions", async () => {
    expect((await transform("decompose", "明"))[0].parts).toEqual([{ resourceId: "source", text: "明", version: 2 }]);
  });
});

describe("P1-A existing IR, NameScript and sharing", () => {
  it("roundtrips every new operator with exactly the same node semantics", async () => {
    for (const op of Object.keys(chineseDefinitions) as ChineseOp[]) {
      const w = labWorkflow(op, { ...operators[op].defaults });
      const restored = parseScript(toScript(w), w);
      expect(restored.nodes).toEqual(w.nodes);
      const input = [op === "compose" ? "日、月" : op === "homophones" ? "明" : "中国"];
      expect(texts(await run(restored, input))).toEqual(texts(await run(w, input)));
    }
  });
  it("supports new functions in explicit control flow and mixed graph code", async () => {
    const base = labWorkflow("decompose", { ...operators.decompose.defaults });
    const ast = parseScript('for x in decompose("明", 1, "any") { emit(x); }', base);
    expect(texts(await run(ast, []))).toEqual(["日、月"]);
    expect((await run(ast, []))[0].notes?.join()).toContain("左右");
    const pkg = await exportPackage(ast);
    expect(pkg.operatorVersions.decompose).toBe(1);
    expect((await importPackage(pkg)).nodes[0].program).toEqual(ast.nodes[0].program);
    Reflect.deleteProperty(pkg.operatorVersions, "decompose");
    await expect(importPackage(pkg)).rejects.toThrow("缺少算子 decompose");
    const mixed = parseScript(`${toScript(ast).replace('let result = output(program);', '')}\nlet transformed = pinyin(program, "pinyin", "none", " ", 32);\nlet result = output(transformed);`, base);
    expect(texts(await run(mixed, []))).toEqual(["ri 、 yue"]);
  });
  it("cancels through the existing engine signal", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(execute(labWorkflow("decompose", { ...operators.decompose.defaults }), async function* () { yield { text: "明", parts: [] }; }, () => {}, undefined, { signal: controller.signal })).rejects.toThrow("取消");
  });
  it("cancels an active Chinese batch from progress without committing unfinished output", async () => {
    const controller = new AbortController();
    let emitted = 0;
    await expect(execute(labWorkflow("mapchars", { ...operators.mapchars.defaults, limit: 128 }), async function* () {
      for (let i = 0; i < 1000; i++) yield { text: "月星".repeat(8), parts: [] };
    }, batch => { emitted += batch.length; }, undefined, {
      signal: controller.signal, onProgress: () => controller.abort(),
    })).rejects.toThrow("取消");
    expect(emitted).toBeLessThanOrEqual(128);
  });
  it("atomically saves lab results, reloads, and shares new operators with resource snapshots", async () => {
    const id = crypto.randomUUID();
    const meta = { id, name: "P1文字实验", description: "测试", kind: "word" as const, color: "green", count: 0, version: 1, updatedAt: Date.now() };
    const original = await transform("hanconvert", "月", { mode: "martian" });
    const saved = await saveNewResource(meta, texts(original));
    expect(saved.count).toBe(2);
    const w = labWorkflow("pinyin", { ...operators.pinyin.defaults }); w.nodes[0].params.resourceId = id;
    const imported = await importPackage(await exportPackage(w));
    const actual: Candidate[] = [];
    await execute(imported, readResource, batch => actual.push(...batch));
    expect(texts(actual)).toEqual(texts(await run(w, texts(original))));
    expect(imported.nodes[0].params.resourceId).not.toBe(id);
    const badId = crypto.randomUUID();
    await expect(saveNewResource({ ...meta, id: badId }, ["字".repeat(257)])).rejects.toThrow("256");
    expect(await db.resources.get(badId)).toBeUndefined();
  });
});
