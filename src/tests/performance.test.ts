import { expect, it } from "vitest";
import { execute } from "../core/engine";
import { createWorkflow } from "../core/model";
it("streams the first 10,000 of 1,000,000 combinations with bounded batches", async () => {
  const w = createWorkflow();
  w.limit = 10000;
  w.nodes[3].params.maxLength = 100;
  let outputCount = 0,
    maxBatch = 0;
  const stats = await execute(
    w,
    async function* (id) {
      for (let i = 0; i < 1000; i++)
        yield { text: `${id === "nature" ? "星" : "人"}${i}`, parts: [] };
    },
    (batch) => {
      outputCount += batch.length;
      maxBatch = Math.max(maxBatch, batch.length);
    },
  );
  expect(outputCount).toBe(10000);
  expect(maxBatch).toBeLessThanOrEqual(64);
  expect(stats.truncated).toBe(true);
  expect(stats.steps).toBeLessThan(50000);
  console.log(
    `BENCH 1,000,000 possible / ${outputCount} emitted: ${stats.duration.toFixed(2)} ms, ${stats.steps} steps, max batch ${maxBatch}`,
  );
});
it("scans 100,000 source entries without expanding a result array", async () => {
  const w = createWorkflow();
  w.nodes = [
    { id: "a", op: "resource", inputs: [], params: { resourceId: "huge" } },
    { id: "out", op: "output", inputs: ["a"], params: {} },
  ];
  w.limit = 10000;
  let read = 0;
  const stats = await execute(
    w,
    async function* () {
      for (let i = 0; i < 100000; i++) {
        read++;
        yield { text: "同一个名字", parts: [] };
      }
    },
    () => {},
    { steps: 300000, milliseconds: 10000 },
  );
  expect(read).toBe(100000);
  expect(stats.count).toBe(1);
  console.log(
    `BENCH 100,000 duplicate entries: ${stats.duration.toFixed(2)} ms, ${stats.steps} steps`,
  );
});
