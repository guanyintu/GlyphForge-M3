import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ForgeDatabase, saveRelationRows } from "../storage/db";
import type { Resource, PairValue } from "../core/model";

let db: ForgeDatabase;
const row: PairValue = { left: "月", right: "星", relation: "couple" };
const other: PairValue = { left: "山", right: "海", relation: "couple" };
const meta = (id = "r"): Resource => ({ id, name: id, kind: "relation", count: 0, version: 1, updatedAt: 0, color: "green", description: "" });
beforeEach(async () => { db = new ForgeDatabase(`m2-relations-${crypto.randomUUID()}`); await db.resources.add(meta()); });
afterEach(async () => { await db.delete(); });

it("rejects a normalized conflicting edit without changing either row, count, version or timestamp", async () => {
  await saveRelationRows("r", [row, other], undefined, db);
  const before = await db.relations.toArray(), resource = await db.resources.get("r");
  await expect(saveRelationRows("r", [{ ...other, left: " 山 ", weight: 3 }], before[0].id, db)).rejects.toThrow("原关系未修改");
  expect(await db.relations.toArray()).toEqual(before);
  expect(await db.resources.get("r")).toEqual(resource);
});

it("allows same-row metadata edits and distinct direction/resource keys while preserving the edited ID", async () => {
  await db.resources.add(meta("s"));
  await saveRelationRows("r", [row, { ...row, direction: "directed" }], undefined, db);
  await saveRelationRows("s", [row], undefined, db);
  const saved = (await db.relations.toArray())[0];
  await saveRelationRows("r", [{ ...row, note: "保留槽位", weight: 2 }], saved.id, db);
  expect(await db.relations.get(saved.id!)).toMatchObject({ ...row, id: saved.id, note: "保留槽位", weight: 2 });
  expect(await db.relations.count()).toBe(3);
  expect(await db.resources.get("r")).toMatchObject({ count: 2, version: 3 });
});

it("rolls back a replacement if its metadata write fails after delete/add", async () => {
  await saveRelationRows("r", [row], undefined, db);
  const before = await db.relations.toArray(), resource = await db.resources.get("r");
  const fail = () => { throw new Error("injected metadata failure"); };
  db.resources.hook("updating", fail);
  try { await expect(saveRelationRows("r", [other], before[0].id, db)).rejects.toThrow("injected"); }
  finally { db.resources.hook("updating").unsubscribe(fail); }
  expect(await db.relations.toArray()).toEqual(before);
  expect(await db.resources.get("r")).toEqual(resource);
});

it("serializes conflicting edits across database connections without losing the rejected original", async () => {
  await saveRelationRows("r", [row, other], undefined, db);
  const before = await db.relations.toArray(), peer = new ForgeDatabase(db.name);
  const destination: PairValue = { left: "朝", right: "暮", relation: "couple" };
  try {
    const results = await Promise.allSettled(before.map((r, i) => saveRelationRows("r", [destination], r.id, i ? peer : db)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    const rejected = results.findIndex(r => r.status === "rejected");
    expect(await db.relations.get(before[rejected].id!)).toEqual(before[rejected]);
    expect(await db.relations.count()).toBe(2);
    expect(await db.resources.get("r")).toMatchObject({ count: 2, version: 3 });
  } finally { peer.close(); }
});

it("protects legacy v3 rows after the existing direction migration to schema7", async () => {
  await db.delete();
  const legacy = new Dexie(db.name);
  legacy.version(3).stores({ resources: "id,name", entries: "++id,resourceId,text,&[resourceId+text],[resourceId+id]", workflows: "id,name", favorites: "text,savedAt", runs: "id,createdAt", generated: "[runId+text],text,runId", relations: "++id,resourceId,&[resourceId+left+right+relation],[resourceId+id]" });
  await legacy.table("resources").add({ ...meta(), count: 2 });
  await legacy.table("relations").bulkAdd([{ ...row, id: 41, resourceId: "r" }, { ...other, id: 42, resourceId: "r" }]);
  legacy.close();
  db = new ForgeDatabase(db.name); await db.open();
  expect(db.verno).toBe(7);
  const before = await db.relations.toArray(), resource = await db.resources.get("r");
  expect(before[0]).toMatchObject({ id: 41, direction: "unknown", reverseQueryable: false });
  await expect(saveRelationRows("r", [before[1]], 41, db)).rejects.toThrow("原关系未修改");
  expect(await db.relations.toArray()).toEqual(before);
  expect(await db.resources.get("r")).toEqual(resource);
});
