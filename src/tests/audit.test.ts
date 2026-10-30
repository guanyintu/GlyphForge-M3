import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkflow, operators } from "../core/model";
import type { Candidate, Workflow } from "../core/model";
import { execute } from "../core/engine";
import { parseScript, toScript } from "../core/script";
import { fileWords } from "../core/files";
import { db, initialize, readResource, saveNewResource, saveRelationRows } from "../storage/db";
import { exportPackage, importPackage } from "../core/sharing";
import { createRelationRecipe, ensureRecipeExamples } from "../core/recipes";
import { copyNodes, pasteNodes } from "../core/graph-editing";

async function run(w: Workflow) {
  const output: Candidate[] = [];
  await execute(w, readResource, batch => { output.push(...batch); });
  return output;
}
beforeEach(async () => {
  for (const table of db.tables) await table.clear();
  await initialize();
});

describe("audit regressions", () => {
  it.each(["sequence {", "-", "!", "(", "["])("roundtrips literal %j in a graph with control flow", async text => {
    const w = parseScript('for x in ["月"] { emit(x); }', createWorkflow());
    w.nodes.splice(1, 0, { id: "after", op: "prefix", inputs: ["program"], params: { text } });
    w.nodes.at(-1)!.inputs = ["after"];
    expect((await run(parseScript(toScript(w), w))).map(c => c.text)).toEqual([text + "月"]);
  });
  it("ignores sequence markers inside ordinary strings and comments", async () => {
    const w = createWorkflow();
    w.nodes.splice(4, 0, { id: "after", op: "prefix", inputs: ["check"], params: { text: "sequence {" } });
    w.nodes.at(-1)!.inputs = ["after"];
    w.comments = ["// sequence { is a comment"];
    expect((await run(parseScript(toScript(w), w))).map(c => c.text)).toEqual((await run(w)).map(c => c.text));
  });
  it("roundtrips small probabilities in mixed graph code", async () => {
    const w = parseScript('emit("月");', createWorkflow());
    w.nodes.splice(1, 0, { id: "after", op: "hanconvert", inputs: ["program"], params: { ...operators.hanconvert.defaults, mode: "martian", probability: 1e-7 } });
    w.nodes.at(-1)!.inputs = ["after"];
    expect((await run(parseScript(toScript(w), w))).map(c => c.text)).toEqual((await run(w)).map(c => c.text));
  });
  it("keeps intermediate AST provenance bounded when a variable is reused", async () => {
    const lines = ['for word in resource("animals") {', 'let p0 = word == word;'];
    for (let i = 1; i <= 16; i++) lines.push(`let p${i} = p${i - 1} == p${i - 1};`);
    lines.push('if p16 { emit(word); }', '}');
    let largestParts = 0;
    const w = parseScript(lines.join("\n"), createWorkflow());
    const iterator = Array.prototype[Symbol.iterator];
    Array.prototype[Symbol.iterator] = function () {
      if (this[0]?.resourceId === "animals") largestParts = Math.max(largestParts, this.length);
      return iterator.call(this);
    };
    try {
      await execute(w, async function* () {
        yield { text: "猫", parts: [{ resourceId: "animals", text: "猫", version: 1 }] };
      }, () => {});
    } finally { Array.prototype[Symbol.iterator] = iterator; }
    // The original implementation builds 131,072 source references before emit.
    // Measure the intermediate collection rather than relying on heap/time thresholds.
    expect(largestParts).toBeLessThan(1000);
  });
  it("awaits each output batch before producing the next one", async () => {
    const w = parseScript('for x in range(0, 130) { emit(text(x)); }', createWorkflow());
    let pending = 0, maxPending = 0, committed = 0;
    await execute(w, readResource, async batch => {
      maxPending = Math.max(maxPending, ++pending);
      await new Promise(resolve => setTimeout(resolve, 5));
      committed += batch.length;
      pending--;
    });
    expect(committed).toBe(130);
    expect(maxPending).toBe(1);
  });
  it("stops when persistence of an output batch fails", async () => {
    const w = parseScript('for x in range(0, 130) { emit(text(x)); }', createWorkflow());
    let batches = 0;
    await expect(execute(w, readResource, async () => {
      batches++;
      throw new Error("storage unavailable");
    })).rejects.toThrow("storage unavailable");
    expect(batches).toBe(1);
  });
  it.each(['text\n猫\n', '名字\n猫\n', '"月亮"\n猫\n', '"月亮\n猫\n'])("imports TXT literally: %j", async input => {
    const output: string[] = [];
    for await (const text of fileWords(new Blob([input]), "source.txt")) output.push(text);
    expect(output).toEqual(input.trimEnd().split("\n"));
  });
});

describe("audit cross-module chains", () => {
  it("enumerates one-to-many relations in three paired slots without crossing endpoints", async () => {
    await ensureRecipeExamples();
    for (const id of ["p1b-season", "p1b-weather", "p1b-action"]) {
      await db.relations.where({ resourceId: id }).delete();
      await db.resources.update(id, { count: 0 });
      const label = id.split("-")[1];
      await saveRelationRows(id, [0, 1].map(i => ({ left: label + "L", right: label + i, relation: "parallel" })));
    }
    const w = createRelationRecipe("parallel");
    w.nodes[0].params.maxLength = 100;
    w.nodes[0].params.equalLength = false;
    w.nodes[0].params.templates = '["{season.left}/{weather.left}/{action.left}","{season.right}/{weather.right}/{action.right}"]';
    const result = await run(w);
    expect(result).toHaveLength(8);
    for (const candidate of result) {
      expect(candidate.members?.[0]).toBe("seasonL/weatherL/actionL");
      const selected = candidate.parts.map(p => p.pair!.right).join("/");
      expect(candidate.members?.[1]).toBe(selected);
    }
  });
  it("creates a library, generates and filters, then saves and reloads results", async () => {
    const meta = { id: "audit", name: "审计", description: "", kind: "word" as const, color: "green", count: 0, version: 1, updatedAt: 0 };
    await saveNewResource(meta, ["猫", "兔", "猫"]);
    const w = parseScript('let words = resource("audit");\nlet names = prefix(words, "小");\nlet filtered = filter(names, 2, "猫", "");\nlet result = output(filtered);', createWorkflow());
    const result = await run(w);
    expect(result.map(c => c.text)).toEqual(["小猫"]);
    await saveNewResource({ ...meta, id: "saved" }, result.map(c => c.text));
    expect((await db.entries.where({ resourceId: "saved" }).toArray()).map(e => e.text)).toEqual(["小猫"]);
  });
  it.each(["couple", "parallel"] as const)("preserves all slots in %s after copy, edit, and empty-database restore", async recipe => {
    await ensureRecipeExamples();
    const w = createRelationRecipe(recipe); w.seed = 0;
    const resourceId = recipe === "couple" ? "p1b-sky" : "p1b-season";
    await saveRelationRows(resourceId, [{ left: "朝", right: "暮", relation: recipe === "couple" ? "couple" : "parallel" }]);
    const copied = pasteNodes({ ...w, nodes: [], layout: {} }, copyNodes(w, w.nodes.map(n => n.id))).workflow;
    copied.nodes[0].params.separator = " ⇄ ";
    const expected = await run(copied);
    expect(expected.some(c => c.members?.[0].startsWith("朝") && c.members[1].startsWith("暮"))).toBe(true);
    const pkg = JSON.parse(JSON.stringify(await exportPackage(copied)));
    for (const table of db.tables) await table.clear();
    expect(await db.resources.count()).toBe(0);
    const restored = await importPackage(pkg);
    expect((await run(restored)).map(c => ({ text: c.text, members: c.members }))).toEqual(expected.map(c => ({ text: c.text, members: c.members })));
    expect((await run(parseScript(toScript(restored), restored))).map(c => c.text)).toEqual(expected.map(c => c.text));
    expect(restored.nodes.every(n => !w.nodes.some(original => original.id === n.id))).toBe(true);
  });
  it("rejects an invalid connection and broken snapshots without writing resources", async () => {
    const pkg = await exportPackage(createWorkflow());
    const count = await db.resources.count();
    pkg.workflow.nodes.at(-1)!.inputs = ["missing"];
    await expect(importPackage(pkg)).rejects.toThrow("输入");
    expect(await db.resources.count()).toBe(count);
    expect(await db.workflows.count()).toBe(0);
  });
  it("does not keep state between successive executions", async () => {
    await ensureRecipeExamples();
    const w = createRelationRecipe("mirror-pair");
    const first = await run(w);
    const second = await run(w);
    expect(second).toEqual(first);
    expect(operators.template.streaming).toBe(true);
  });
});
