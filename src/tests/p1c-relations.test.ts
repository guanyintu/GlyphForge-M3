import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, expect, it } from "vitest";
import { db, ForgeDatabase, queryRelations, saveRelationRows } from "../storage/db";
import { parseRelationRows, relationRowsFile } from "../core/relation-files";
import { normalizePair } from "../core/relations";
import { exportPackage, importPackage } from "../core/sharing";
import type { PairValue, Workflow } from "../core/model";
beforeEach(async () => {
  await Promise.all([db.resources.clear(), db.entries.clear(), db.relations.clear(), db.workflows.clear(), db.generated.clear(), db.runs.clear()]);
  await db.resources.put({ id: "r", name: "关系", kind: "relation", description: "", color: "green", count: 0, version: 1, updatedAt: 0 });
});
it("symmetric queries work both ways without swapping template slots", async () => {
  await saveRelationRows("r", [{ left: "冷", right: "热", relation: "antonym", direction: "symmetric" }]);
  expect((await queryRelations("冷"))[0].neighbor).toBe("热");
  const hit = (await queryRelations("热"))[0]; expect(hit.neighbor).toBe("冷"); expect(hit.row.left).toBe("冷"); expect(hit.traversal).toBe("reverse");
});
it("directed and unknown queries restrict reverse traversal unless explicitly allowed", async () => {
  for (const direction of ["directed", "unknown"] as const) {
    await saveRelationRows("r", [{ left: direction, right: "读信人", relation: "associated", direction }]);
  }
  expect(await queryRelations("读信人")).toEqual([]);
  expect(await queryRelations("directed", { direction: "reverse" })).toEqual([]);
  expect(await queryRelations("directed", { direction: "forward" })).toHaveLength(1);
  const row = (await db.relations.toArray())[0];
  await saveRelationRows("r", [{ ...row, reverseQueryable: true }], row.id);
  expect(await queryRelations("读信人")).toHaveLength(1);
});
it("editing persists all relation attributes and bumps the version", async () => {
  await saveRelationRows("r", [{ left: "春", right: "秋", relation: "parallel" }]);
  const row = (await db.relations.toArray())[0];
  const updated: PairValue = { ...row, direction: "symmetric", weight: 2, tags: ["时序"], note: "已核对", source: "用户" };
  await saveRelationRows("r", [updated], row.id);
  expect(await db.relations.get(row.id!)).toMatchObject(updated);
  expect((await db.resources.get("r"))?.version).toBe(3);
  for (const format of ["csv", "json"] as const) expect(parseRelationRows(relationRowsFile([updated], format), `r.${format}`)).toEqual([normalizePair(updated)]);
});
it("v3 migration preserves rows, IDs, recipes and unknown semantics across reopening", async () => {
  const name = `migration-${crypto.randomUUID()}`, old = new Dexie(name);
  old.version(3).stores({ resources: "id,name", entries: "++id,resourceId,text,&[resourceId+text],[resourceId+id]", workflows: "id,name", favorites: "text,savedAt", runs: "id,createdAt", generated: "[runId+text],text,runId", relations: "++id,resourceId,&[resourceId+left+right+relation],[resourceId+id]" });
  await old.open(); await old.table("relations").put({ id: 17, resourceId: "r", left: "月", right: "星", relation: "couple" }); old.close();
  const upgraded = new ForgeDatabase(name);
  try {
    await upgraded.open(); const first = await upgraded.relations.get(17);
    expect(first).toMatchObject({ direction: "unknown", reverseQueryable: false, left: "月", right: "星" });
    expect(await queryRelations("星", {}, upgraded)).toEqual([]);
    upgraded.close(); await upgraded.open(); expect(await upgraded.relations.get(17)).toEqual(first);
  } finally { await upgraded.delete(); }
});
it("portable v4 preserves direction and attributes while v3 inputs remain readable", async () => {
  await saveRelationRows("r", [{ left: "师", right: "徒", relation: "associated", direction: "directed", tags: ["角色"], source: "测试" }]);
  const w: Workflow = { version: 1, id: "w", name: "w", seed: 0, limit: 10, layout: {}, nodes: [{ id: "a", op: "pairs", inputs: [], params: { resourceId: "r", relation: "" } }, { id: "out", op: "output", inputs: ["a"], params: {} }] };
  const pkg = await exportPackage(w); expect(pkg.version).toBe(4);
  const imported = await importPackage(pkg); const id = imported.nodes[0].params.resourceId as string;
  expect((await db.relations.where({ resourceId: id }).first())).toMatchObject({ direction: "directed", tags: ["角色"], source: "测试" });
});
