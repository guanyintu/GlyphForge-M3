import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addEntries,
  db,
  deleteResource,
  initialize,
  readResource,
} from "../storage/db";
import { exportPackage, importPackage } from "../core/sharing";
import { createWorkflow } from "../core/model";
beforeEach(async () => {
  await Promise.all([
    db.resources.clear(),
    db.entries.clear(),
    db.workflows.clear(),
    db.favorites.clear(),
  ]);
  await initialize();
});
describe("local resources and portable packages", () => {
  it("seeds once and adds unique terms with version increment", async () => {
    await initialize();
    expect(await db.resources.count()).toBe(6);
    await addEntries("animals", ["猫", "水獭", " 水獭 ", ""]);
    const r = await db.resources.get("animals");
    expect(r?.count).toBe(9);
    expect(r?.version).toBe(2);
  });
  it("rolls back additions when the resource does not exist", async () => {
    await expect(addEntries("missing", ["测试"])).rejects.toThrow();
    expect(await db.entries.where({ resourceId: "missing" }).count()).toBe(0);
  });
  it("reads a seeded rotation and attaches true version provenance", async () => {
    const texts = [];
    for await (const c of readResource("animals", 2)) {
      texts.push(c.text);
      expect(c.parts[0].version).toBe(1);
    }
    expect(texts[0]).toBe("鹿");
    expect(texts).toHaveLength(8);
    expect(new Set(texts).size).toBe(8);
  });
  it("deletes both the resource and its membership entries", async () => {
    await deleteResource("animals");
    expect(await db.resources.get("animals")).toBeUndefined();
    expect(await db.entries.where({ resourceId: "animals" }).count()).toBe(0);
  });
  it("exports only dependency resources, restores with fresh IDs and preserves semantics", async () => {
    const original = createWorkflow();
    const pkg = await exportPackage(original);
    expect(pkg.resources).toHaveLength(2);
    const imported = await importPackage(pkg);
    expect(imported.id).not.toBe(original.id);
    expect(imported.layout).toEqual(original.layout);
    expect(imported.nodes[0].params.resourceId).not.toBe("nature");
    expect(
      await db.entries
        .where({ resourceId: String(imported.nodes[0].params.resourceId) })
        .count(),
    ).toBe(12);
    expect(await db.workflows.get(imported.id)).toBeDefined();
  });
  it("rejects untrusted malformed packages before changing storage", async () => {
    const pkg = await exportPackage(createWorkflow());
    pkg.version = 999;
    await expect(importPackage(pkg)).rejects.toThrow("格式");
    expect(await db.resources.count()).toBe(6);
  });
  it("rejects unknown operators and missing dependencies", async () => {
    const pkg = await exportPackage(createWorkflow());
    pkg.resources.pop();
    await db.resources.delete("roles");
    await expect(importPackage(pkg)).rejects.toThrow("依赖词库");
    expect(await db.resources.count()).toBe(5);
  });
  it("persists favorite provenance", async () => {
    await db.favorites.put({
      text: "月亮邮差",
      parts: [{ text: "月亮", resourceId: "nature", version: 1 }],
      workflowId: "test",
      seed: 42,
      savedAt: Date.now(),
    });
    expect((await db.favorites.get("月亮邮差"))?.workflowId).toBe("test");
  });
});
