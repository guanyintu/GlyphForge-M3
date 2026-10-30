import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { checkGameId, defaultGameRule, parseGameRule } from "../core/game-rules";
import { db, ForgeDatabase } from "../storage/db";
import { createWorkflow, operators } from "../core/model";
import type { Candidate, Workflow } from "../core/model";
import { execute } from "../core/engine";
import { parseScript, toScript } from "../core/script";
import { exportPackage, importPackage } from "../core/sharing";
const permissive = { ...defaultGameRule, lengths: {}, blockZeroWidth: false };
it("measures UTF-8, codepoints and graphemes independently", () => {
  const r = checkGameId("👨‍👩‍👧e\u0301月", permissive); expect(r.metrics).toEqual({ utf16: 11, codePoints: 8, graphemes: 3, bytes: 24 });
  expect(checkGameId("𠀀", { ...permissive, lengths: { codePoints: { min: 1, max: 1 }, graphemes: { min: 1, max: 1 }, bytes: { min: 4, max: 4 } } }).valid).toBe(true);
});
it("enforces each min/max length and rejects invalid ranges", () => {
  for (const unit of ["codePoints", "graphemes", "bytes"] as const) expect(checkGameId("月", { ...permissive, lengths: { [unit]: { min: 4, max: 9 } } }).valid).toBe(false);
  expect(() => parseGameRule(JSON.stringify({ ...defaultGameRule, lengths: { graphemes: { min: 5, max: 1 } } }))).toThrow("区间");
});
it("checks forbidden characters, categories, spaces and special symbols", () => {
  expect(checkGameId("月_亮", { ...permissive, forbidden: "_" }).errors).toContain("含禁用字符");
  expect(checkGameId("月 月", permissive).valid).toBe(false);
  expect(checkGameId("月★", { ...permissive, allowSpecial: false }).valid).toBe(false);
  expect(checkGameId("月a", { ...permissive, allowed: ["han"] }).valid).toBe(false);
  expect(checkGameId("月a2", { ...permissive, allowed: ["han", "latin", "number"] }).valid).toBe(true);
});
it("detects zero width and reports bounded confusable heuristics", () => {
  expect(checkGameId("月\u200b亮", defaultGameRule).zeroWidth).toBe(true);
  expect(checkGameId("月\u200b亮", defaultGameRule).valid).toBe(false);
  expect(checkGameId("Ａ月", permissive).warnings.join()).toContain("NFKC");
  expect(checkGameId("pаypal", permissive).warnings.join()).toContain("混合");
});
it("persists editable game presets in the same IndexedDB and reopens safely", async () => {
  const local = new ForgeDatabase(`presets-${crypto.randomUUID()}`);
  try { await local.gamePresets.put({ id: "g", name: "规则", rule: defaultGameRule, updatedAt: 1 }); local.close(); await local.open();
    expect((await local.gamePresets.get("g"))?.rule).toEqual(defaultGameRule);
    await local.gamePresets.update("g", { rule: { ...defaultGameRule, allowSpaces: true } }); expect((await local.gamePresets.get("g"))?.rule.allowSpaces).toBe(true);
  } finally { await local.delete(); }
});
it("game operator survives graph/NameScript/portable copy with a self-contained rule snapshot", async () => {
  const rule = { ...defaultGameRule, lengths: { graphemes: { min: 2, max: 3 } }, forbidden: "_" };
  const w: Workflow = { ...createWorkflow(), nodes: [{ id: "input", op: "resource" as const, inputs: [], params: { resourceId: "game-input" } }, { id: "check", op: "gamecheck" as const, inputs: ["input"], params: { ...operators.gamecheck.defaults, rules: JSON.stringify(rule) } }, { id: "out", op: "output" as const, inputs: ["check"], params: {} }] };
  await db.resources.put({ id: "game-input", name: "输入", kind: "word", description: "", color: "green", count: 3, version: 1, updatedAt: 1 });
  await db.entries.bulkPut(["月", "月亮", "月_亮"].map(text => ({ resourceId: "game-input", text })));
  const parsed = parseScript(toScript(w), w), restored = await importPackage(await exportPackage(parsed));
  expect(restored.nodes.find(n => n.op === "gamecheck")?.params.rules).toBe(JSON.stringify(rule));
  const reader = async function* () { for (const text of ["月", "月亮", "月_亮"]) yield { text, parts: [] }; };
  const values: Candidate[] = []; await execute(parsed, reader, b => values.push(...b)); expect(values.map(v => v.text)).toEqual(["月亮"]);
  parsed.nodes[1].params.mode = "annotate"; const annotated: Candidate[] = []; await execute(parsed, reader, b => annotated.push(...b)); expect(annotated).toHaveLength(3); expect(annotated[0].notes).toContain("不符合本地游戏规则");
});
it("AST uses the same rule check in conditions", async () => {
  const rule = JSON.stringify({ ...defaultGameRule, lengths: { graphemes: { min: 2, max: 2 } } });
  const w = parseScript(`let names = sequence { for x in ["月", "月亮"] { if (gamecheck(x, ${JSON.stringify(rule)})) { emit(x); } } }; let result = output(names);`, createWorkflow());
  const values: Candidate[] = []; await execute(w, async function* () {}, b => values.push(...b)); expect(values.map(v => v.text)).toEqual(["月亮"]);
});
