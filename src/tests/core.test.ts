import { describe, expect, it } from "vitest";
import { execute } from "../core/engine";
import { createWorkflow, unicodeMetrics } from "../core/model";
import type { Candidate, Workflow } from "../core/model";
import { parseScript, toScript, validateGraph } from "../core/script";
const reader = (data: Record<string, string[]>) =>
  async function* (id: string) {
    if (!data[id]) throw new Error("资源缺失");
    for (const text of data[id])
      yield { text, parts: [{ text, resourceId: id }] };
  };
async function run(w: Workflow, data: Record<string, string[]>) {
  const output: Candidate[] = [];
  const stats = await execute(w, reader(data), (batch) =>
    output.push(...batch),
  );
  return { output, stats };
}
const sample = { animals: ["猫", "兔"], moods: ["困", "甜"] };
describe("shared graph and NameScript execution", () => {
  it("binds each repeated pattern variable to the same entry", async () => {
    const { output } = await run(createWorkflow("echo"), sample);
    expect(output.map((c) => c.text)).toEqual([
      "猫猫困困",
      "猫猫甜甜",
      "兔兔困困",
      "兔兔甜甜",
    ]);
    expect(output[0].parts).toEqual([
      { text: "猫", resourceId: "animals" },
      { text: "困", resourceId: "moods" },
    ]);
  });
  it("preserves runtime behavior across code roundtrip", async () => {
    const original = createWorkflow("mirror");
    const rebuilt = parseScript(toScript(original), original);
    expect(rebuilt.nodes).toEqual(original.nodes);
    expect((await run(rebuilt, sample)).output).toEqual(
      (await run(original, sample)).output,
    );
  });
  it("applies code edits to the same IR", async () => {
    const w = createWorkflow("echo");
    const changed = parseScript(toScript(w).replace('"AABB"', '"ABBA"'), w);
    expect((await run(changed, sample)).output[0].text).toBe("猫困困猫");
  });
  it("handles quoted comma and escaped quote arguments", () => {
    const w = createWorkflow();
    w.nodes[2] = {
      id: "mix",
      op: "concat",
      inputs: ["a", "b"],
      params: { separator: ',"' },
    };
    expect(parseScript(toScript(w), w).nodes[2].params.separator).toBe(',"');
  });
  it("filters during iteration using include, exclude and grapheme count", async () => {
    const w = createWorkflow("echo");
    w.nodes[3].params = { maxLength: 4, includes: "猫", excludes: "困" };
    expect((await run(w, sample)).output.map((x) => x.text)).toEqual([
      "猫猫甜甜",
    ]);
  });
  it("deduplicates output", async () => {
    expect(
      (
        await run(createWorkflow("echo"), {
          animals: ["猫", "猫"],
          moods: ["困"],
        })
      ).output.length,
    ).toBe(1);
  });
  it("streams bounded batches and stops at the result limit", async () => {
    const w = createWorkflow("echo");
    w.limit = 2;
    const result = await run(w, sample);
    expect(result.output).toHaveLength(2);
    expect(result.stats.truncated).toBe(true);
  });
  it("does not mark an exactly exhausted source as truncated", async () => {
    const w = createWorkflow("echo");
    w.limit = 4;
    expect((await run(w, sample)).stats.truncated).toBe(false);
  });
  it("stops an expensive filtered-out search at the step budget", async () => {
    const w = createWorkflow("echo");
    w.nodes[3].params.includes = "不存在";
    await expect(
      execute(
        w,
        reader({
          animals: Array(100).fill("猫"),
          moods: Array(100).fill("困"),
        }),
        () => {},
        { steps: 100, milliseconds: 10000 },
      ),
    ).rejects.toThrow("步数上限");
  });
  it("stops at the time budget", async () => {
    const w = createWorkflow("echo");
    w.nodes[3].params.includes = "不存在";
    await expect(
      execute(
        w,
        reader({
          animals: Array(100).fill("猫"),
          moods: Array(100).fill("困"),
        }),
        () => {},
        { steps: 100000, milliseconds: -1 },
      ),
    ).rejects.toThrow("时间上限");
  });
  it("rejects dataflow cycles", () => {
    const w = createWorkflow();
    w.nodes[2].inputs[0] = "check";
    expect(() => validateGraph(w)).toThrow("循环");
  });
  it("rejects disconnected inputs", () => {
    const w = createWorkflow();
    w.nodes[2].inputs[0] = "";
    expect(() => validateGraph(w)).toThrow("缺少有效输入");
  });
  it("rejects duplicate IDs and multiple outputs", () => {
    const w = createWorkflow();
    w.nodes[1].id = "a";
    expect(() => validateGraph(w)).toThrow("重复");
    const w2 = createWorkflow();
    w2.nodes.push({ id: "extra", op: "output", inputs: ["check"], params: {} });
    expect(() => validateGraph(w2)).toThrow("一个结果输出");
  });
  it("provides line diagnostics and refuses unsupported code", () => {
    const w = createWorkflow();
    expect(() => parseScript('let a = eval("alert(1)");', w)).toThrow(
      "第 1 行",
    );
    expect(() => parseScript("for x in @animals {", w)).toThrow("代码块缺少");
    expect(() => parseScript("let a = reverse(missing);", w)).toThrow(
      "引用的变量",
    );
  });
  it("rejects malformed mode and excessive limit", () => {
    const w = createWorkflow();
    w.nodes[2].params.template = "AZ";
    expect(() => validateGraph(w)).toThrow("A / B");
    const w2 = createWorkflow();
    w2.limit = 10001;
    expect(() => validateGraph(w2)).toThrow("10,000");
  });
  it("returns no result for empty resources and reports missing resources", async () => {
    expect(
      (await run(createWorkflow("echo"), { animals: [], moods: ["困"] }))
        .output,
    ).toHaveLength(0);
    await expect(run(createWorkflow("echo"), {})).rejects.toThrow("资源缺失");
  });
  it("reverses visible graphemes rather than splitting emoji", async () => {
    const w = createWorkflow("echo");
    w.nodes = [
      {
        id: "a",
        op: "resource",
        params: { resourceId: "animals" },
        inputs: [],
      },
      { id: "rev", op: "reverse", params: {}, inputs: ["a"] },
      { id: "out", op: "output", params: {}, inputs: ["rev"] },
    ];
    expect((await run(w, { animals: ["猫👨‍👩‍👧‍👦"] })).output[0].text).toBe("👨‍👩‍👧‍👦猫");
  });
});
describe("Unicode metrics", () => {
  it("distinguishes code units, code points, visible characters and bytes", () => {
    expect(unicodeMetrics("👨‍👩‍👧‍👦")).toEqual({
      utf16: 11,
      codePoints: 7,
      graphemes: 1,
      bytes: 25,
    });
  });
  it("handles combining characters and Chinese", () => {
    expect(unicodeMetrics("e\u0301月").graphemes).toBe(2);
    expect(unicodeMetrics("月亮").bytes).toBe(6);
  });
});
