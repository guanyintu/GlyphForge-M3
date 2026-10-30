import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../core/model";
import type { Candidate, Workflow } from "../core/model";
import { execute } from "../core/engine";
import { parseScript, toScript, validateGraph } from "../core/script";
import { parseProgram, programCode, validateProgram } from "../core/program";
import {
  copyNodes,
  groupNodes,
  pasteNodes,
  WorkflowHistory,
  autoLayout,
} from "../core/graph-editing";
import { DelimitedParser, fileWords, resultsFile } from "../core/files";
import { db, initialize, readResource, resourceQuery } from "../storage/db";
import {
  exportPackage,
  importPackage,
  ResourceDependencyError,
} from "../core/sharing";
const code = `// 自己的配方注释
for a in @animals {
  for b in resource("moods") {
    let name = pattern("AABB", a, b);
    if length(name) <= 4 && contains(name, "猫") {
      emit(name);
    } else { emit("略过"); }
  }
}`;
async function output(w: Workflow) {
  const result: Candidate[] = [];
  await execute(
    w,
    async function* (id) {
      for (const text of id === "animals" ? ["猫", "兔"] : ["困", "甜"])
        yield { text, parts: [{ resourceId: id, text, version: 1 }] };
    },
    (batch) => result.push(...batch),
  );
  return result;
}
beforeEach(async () => {
  await Promise.all([
    db.resources.clear(),
    db.entries.clear(),
    db.workflows.clear(),
    db.favorites.clear(),
    db.generated.clear(),
    db.runs.clear(),
  ]);
  await initialize();
});
describe("P0 control flow", () => {
  it("supports canonical template-first patterns and reads the previous sequence-first syntax", async () => {
    const w = createWorkflow("echo");
    const old =
      'let a = resource("animals");\nlet b = resource("moods");\nlet names = pattern(a, b, "AABB");\nlet result = output(names);';
    const oldW = parseScript(old, w),
      newW = parseScript(
        old.replace('pattern(a, b, "AABB")', 'pattern("AABB", a, b)'),
        w,
      );
    expect(await output(newW)).toEqual(await output(oldW));
    expect(toScript(newW)).toContain('pattern("AABB", a, b)');
  });
  it("executes explicit nested loops, variables, boolean conditions and else with correct binding", async () => {
    const w = parseScript(code, createWorkflow());
    expect((await output(w)).map((c) => c.text)).toEqual([
      "猫猫困困",
      "猫猫甜甜",
      "略过",
    ]);
  });
  it("roundtrips structured control nodes and preserves comments and layout", async () => {
    const w = parseScript(code, createWorkflow());
    const rebuilt = parseScript(toScript(w), w);
    expect(programCode(rebuilt.nodes[0].program!)).toBe(
      programCode(w.nodes[0].program!),
    );
    expect(rebuilt.comments).toContain("// 自己的配方注释");
    expect(rebuilt.layout).toEqual(w.layout);
    expect(await output(rebuilt)).toEqual(await output(w));
  });
  it("works with range, number variables and Unicode length", async () => {
    const w = parseScript(
      'for i in range(0, 3) { let name = "猫" + text(i); if length(name) == 2 { emit(name); } }',
      createWorkflow(),
    );
    expect((await output(w)).map((c) => c.text)).toEqual(["猫0", "猫1", "猫2"]);
  });
  it("handles collections, reverse and bound scalar concatenation", async () => {
    const w = parseScript(
      'for a in ["猫", "兔"] { emit(reverse(a + "星")); }',
      createWorkflow(),
    );
    expect((await output(w)).map((c) => c.text)).toEqual(["星猫", "星兔"]);
  });
  it("rejects out of scope references, bad types, redeclarations, unknown calls and dynamic resources", () => {
    for (const bad of [
      "for a in @animals { emit(a); } emit(a);",
      'if 4 { emit("猫"); }',
      'let a = "猫"; let a = "兔"; emit(a);',
      'emit(eval("猫"));',
      'let name = "animals"; for a in resource(name) { emit(a); }',
    ])
      expect(() => parseProgram(bad)).toThrow();
  });
  it("supports lexical shadowing without leaking values", async () => {
    const w = parseScript(
      'let x = "外"; for x in ["内"] { emit(x); } emit(x);',
      createWorkflow(),
    );
    expect((await output(w)).map((c) => c.text)).toEqual(["内", "外"]);
  });
  it("short circuits boolean expressions", async () => {
    const w = parseScript(
      'if false && (1 / 0 > 2) { emit("错"); } else { emit("正确"); }',
      createWorkflow(),
    );
    expect((await output(w))[0].text).toBe("正确");
  });
  it("bounds loops even when nothing is emitted", async () => {
    const w = parseScript(
      'for i in range(0, 1000000) { if false { emit("猫"); } }',
      createWorkflow(),
    );
    await expect(
      execute(w, readResource, () => {}, { steps: 100, milliseconds: 10000 }),
    ).rejects.toThrow("步数上限");
  });
  it("supports cancellation and exposes progress", async () => {
    const controller = new AbortController();
    const w = parseScript(
      'for i in range(0, 10000) { if false { emit("猫"); } }',
      createWorkflow(),
    );
    let progress = 0;
    await expect(
      execute(
        w,
        readResource,
        () => {},
        { steps: 300000, milliseconds: 10000 },
        {
          signal: controller.signal,
          onProgress: () => {
            progress++;
            controller.abort();
          },
        },
      ),
    ).rejects.toThrow("取消");
    expect(progress).toBe(1);
  });
  it("validates imported AST and rejects arbitrary statement types", () => {
    const p = parseProgram('emit("猫");');
    const malformed = JSON.parse(JSON.stringify(p));
    malformed.body[0].kind = "javascript";
    expect(() => validateProgram(malformed)).toThrow("未知");
  });
  it("can convert a structured edit back into readable code", async () => {
    const p = parseProgram("for a in @animals { emit(a); }");
    const s = p.body[0];
    if (s.kind === "for")
      s.body = [
        {
          kind: "emit",
          line: 1,
          value: {
            kind: "binary",
            op: "+",
            left: { kind: "variable", name: "a", line: 1 },
            right: { kind: "literal", value: "星", line: 1 },
            line: 1,
          },
        },
      ];
    const w = parseScript(programCode(p), createWorkflow());
    expect((await output(w)).map((c) => c.text)).toEqual(["猫星", "兔星"]);
  });
});
describe("P0 graph editing", () => {
  it("preserves fallback positions when copying a workflow with no saved layout", () => {
    const w = createWorkflow();
    w.layout = {};
    const result = pasteNodes(
      { ...w, nodes: [], layout: {} },
      copyNodes(w, ["a", "b"]),
    );
    expect(result.workflow.layout[result.ids[0]]).toEqual({ x: 70, y: 170 });
    expect(result.workflow.layout[result.ids[1]]).toEqual({ x: 330, y: 170 });
  });
  it("auto lays out nodes by data dependencies with distinct source rows", () => {
    const w = autoLayout(createWorkflow());
    expect(w.layout.a.x).toBe(w.layout.b.x);
    expect(w.layout.a.y).not.toBe(w.layout.b.y);
    expect(w.layout.mix.x).toBeGreaterThan(w.layout.a.x);
    expect(w.layout.result.x).toBeGreaterThan(w.layout.check.x);
  });
  it("copies selected nodes with internal edges, groups and positions then remaps IDs", () => {
    let w = createWorkflow();
    w = groupNodes(w, ["a", "b", "mix"], "组合");
    const clip = copyNodes(w, ["a", "b", "mix"]);
    const target = { ...createWorkflow(), nodes: [], layout: {}, groups: [] };
    const result = pasteNodes(target, clip);
    expect(result.ids).toHaveLength(3);
    expect(result.disconnected).toBe(0);
    expect(result.workflow.nodes[2].inputs).toEqual(result.ids.slice(0, 2));
    expect(result.workflow.groups?.[0].nodeIds).toEqual(result.ids);
    expect(result.workflow.layout[result.ids[0]].x).toBe(w.layout.a.x + 70);
  });
  it("disconnects external references instead of accidentally binding to colliding IDs", () => {
    const w = createWorkflow();
    const result = pasteNodes(w, copyNodes(w, ["mix"]));
    expect(result.workflow.nodes.at(-1)?.inputs).toEqual(["", ""]);
    expect(result.disconnected).toBe(2);
  });
  it("rejects invalid clipboard operators and recursive/malformed programs", () => {
    const clip = copyNodes(createWorkflow(), ["a"]);
    const bad = JSON.parse(JSON.stringify(clip));
    bad.nodes[0].op = "eval";
    expect(() => pasteNodes(createWorkflow(), bad)).toThrow();
  });
  it("undoes and redoes layouts, connections and params as immutable snapshots", () => {
    const h = new WorkflowHistory();
    const a = createWorkflow();
    h.push(a);
    const b = structuredClone(a);
    b.layout.a.x = 999;
    b.nodes[2].params.template = "AABB";
    const restored = h.undo(b)!;
    expect(restored).toEqual(a);
    expect(h.redo(restored)).toEqual(b);
    expect(h.canRedo).toBe(false);
  });
  it("still rejects graph cycles around program streams", () => {
    const w = createWorkflow();
    w.nodes[2].inputs[0] = "check";
    expect(() => validateGraph(w)).toThrow("循环");
  });
});
describe("P0 file and share formats", () => {
  it('cancels a portable export without changing resources',async()=>{const controller=new AbortController();controller.abort();await expect(exportPackage(createWorkflow(),true,controller.signal)).rejects.toThrow('取消');expect(await db.resources.count()).toBe(6);});
  it('rejects extra canonical pattern arguments rather than discarding them',()=>{expect(()=>parseScript('let a = resource("animals");\nlet b = resource("moods");\nlet c = pattern("AABB", a, b, "extra");\nlet result = output(c);',createWorkflow())).toThrow('3 个参数');});
  it("parses quoted multiline CSV across chunk boundaries", () => {
    const p = new DelimitedParser();
    const rows = [
      ...p.feed('text,note\r\n"星'),
      ...p.feed('河,月亮","一""二"\r'),
      ...p.feed('\n"多\n行",ok', true),
    ];
    expect(rows).toEqual([
      ["text", "note"],
      ["星河,月亮", '一"二'],
      ["多\n行", "ok"],
    ]);
  });
  it("rejects an unterminated CSV field", () => {
    expect(() => new DelimitedParser().feed('"未结束', true)).toThrow("未闭合");
  });
  it("imports UTF-8 TXT, CSV headers, TSV and JSON strings/objects", async () => {
    for (const [name, source, expected] of [
      ["a.txt", "\uFEFF猫\r\n兔", ["猫", "兔"]],
      ["a.csv", 'note,text\n1,"星河,月亮"', ["星河,月亮"]],
      ["a.tsv", "text\tnote\n猫\tx", ["猫"]],
      ["a.json", '{"entries":["猫",{"text":"兔"}]}', ["猫", "兔"]],
    ] as const) {
      const values = [];
      for await (const value of fileWords(new Blob([source]), name))
        values.push(value);
      expect(values).toEqual(expected);
    }
  });
  it("exports text, escaped CSV and metadata JSON", () => {
    const c = [{ text: '星,"河', parts: [], workflowId: "w", seed: 2 }];
    expect(resultsFile(c, "txt")).toBe(c[0].text);
    expect(resultsFile(c, "csv")).toContain('"星,""河"');
    expect(JSON.parse(resultsFile(c, "json")).entries).toEqual(c);
  });
  it("uses exact/prefix indexes and substring mode", async () => {
    expect(await resourceQuery("animals", "猫", "exact").count()).toBe(1);
    expect(await resourceQuery("nature", "月", "prefix").count()).toBe(1);
    expect(await resourceQuery("nature", "河", "contains").count()).toBe(2);
  });
  it("shares a structured program with exact dependency snapshots and restores resource references", async () => {
    const w = parseScript(code, createWorkflow());
    const pkg = await exportPackage(w);
    expect(pkg.dependencies.map((d) => d.id)).toEqual(["animals", "moods"]);
    const imported = await importPackage(pkg);
    expect(imported.nodes[0].program).not.toEqual(w.nodes[0].program);
    const actual: Candidate[] = [];
    await execute(imported, readResource, (b) => actual.push(...b));
    expect(actual.some((c) => c.text === "猫猫困困")).toBe(true);
  });
  it("supports lightweight sharing and explicit rebinding when dependency IDs or versions differ", async () => {
    const pkg = await exportPackage(createWorkflow(), false);
    await db.resources.update("nature", { version: 2 });
    await expect(importPackage(pkg)).rejects.toBeInstanceOf(
      ResourceDependencyError,
    );
    const w = await importPackage(pkg, { nature: "nature" });
    expect(w.nodes[0].params.resourceId).toBe("nature");
    expect(await db.resources.count()).toBe(6);
  });
  it("rejects unknown operator versions before changing the database", async () => {
    const pkg = await exportPackage(createWorkflow());
    pkg.operatorVersions.pattern = 99;
    await expect(importPackage(pkg)).rejects.toThrow("版本不兼容");
    expect(await db.resources.count()).toBe(6);
  });
  it("exports only explicitly selected resource snapshots", async () => {
    const pkg = await exportPackage(createWorkflow(), ["nature"]);
    expect(pkg.resources.map((x) => x.meta.id)).toEqual(["nature"]);
    expect(pkg.dependencies).toHaveLength(2);
  });
  it("persists generated results and a true workflow snapshot for reverse lookup after reload", async () => {
    const w = createWorkflow();
    await db.runs.put({
      id: "r",
      workflow: w,
      versions: { nature: 1 },
      createdAt: Date.now(),
      status: "done",
      count: 1,
    });
    await db.generated.put({
      runId: "r",
      text: "月亮邮差",
      parts: [{ text: "月亮", resourceId: "nature", version: 1 }],
      workflowId: w.id,
      seed: 42,
    });
    const result = await db.generated.where("text").equals("月亮邮差").first();
    expect((await db.runs.get(result!.runId))?.workflow.nodes).toEqual(w.nodes);
  });
});
