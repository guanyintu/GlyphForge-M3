import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
test.beforeAll(() => { execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "e2e/subgraphs.vite.config.ts"], { stdio: "pipe" }); });

test("300 nested call instances stream a virtual million-entry resource with sampled heap bounds", async ({ page }) => {
  await page.goto("/"); await expect(page.getByText(/生成完成/)).toBeVisible();
  const report = await page.evaluate(async () => {
    const h = await import("/subgraphs-harness/subgraphs.js");
    const w = h.createWorkflow(); w.limit = 1;
    const leaf = { id: "leaf", version: 1, name: "source", parameters: [], returns: "CandidateSequence", layout: {}, output: "r", nodes: [{ id: "r", op: "resource", inputs: [], params: { resourceId: "virtual" } }] };
    const call = (id: string, definitionId: string) => ({ id, op: "call", inputs: [], params: {}, call: { definitionId, version: 1, bindings: {} } });
    const twice = { ...leaf, id: "twice", name: "twice", output: "join", nodes: [call("left", "leaf"), call("right", "leaf"), { id: "join", op: "concat", inputs: ["left", "right"], params: { separator: "" } }] };
    w.subgraphs = [leaf, twice]; w.nodes = Array.from({ length: 100 }, (_, i) => call(`c${i}`, "twice"));
    let last = "c0"; for (let i = 1; i < 100; i++) { const id = `join${i}`; w.nodes.push({ id, op: "concat", inputs: [last, `c${i}`], params: { separator: "" } }); last = id; } w.nodes.push({ id: "out", op: "output", inputs: [last], params: {} });
    const heap = () => (performance as any).memory?.usedJSHeapSize ?? null;
    const samples = [heap()], start = performance.now(); let produced = 0, maxBatch = 0, maxLength = 0;
    const stats = await h.execute(w, async function* () { for (let i = 0; i < 1000000; i++) { produced++; yield { text: i ? "另" : "字", parts: [] }; } }, (batch: any[]) => { maxBatch = Math.max(maxBatch, batch.length); maxLength = Math.max(maxLength, ...batch.map(c => c.text.length)); samples.push(heap()); }, undefined, { onProgress: () => samples.push(heap()) });
    samples.push(heap());
    return { milliseconds: performance.now() - start, steps: stats.steps, generatedCandidates: produced, maxBatch, maxLength, heapSamples: samples, declaredLogicalEntries: 1000000, externalCalls: 100, totalCallInstances: 300, topNodes: w.nodes.length, definitionBytes: new TextEncoder().encode(JSON.stringify(w.subgraphs)).length, userAgent: navigator.userAgent };
  });
  expect(report.generatedCandidates).toBe(201); expect(report.maxLength).toBe(200); expect(report.maxBatch).toBe(1); expect(report.steps).toBeLessThan(2000);
  const heaps = report.heapSamples.filter((v: number | null): v is number => typeof v === "number"); if (heaps.length) expect(Math.max(...heaps) - heaps[0]).toBeLessThan(64 * 1024 * 1024);
  writeFileSync("docs/p2-a/performance.json", JSON.stringify(report, null, 2));
});
