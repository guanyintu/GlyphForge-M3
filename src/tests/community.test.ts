import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkflow } from "../core/model";
import { exportPackage } from "../core/sharing";
import { previewShare } from "../core/share-preview";
import { db, initialize } from "../storage/db";
import { adopt } from "../community/local";
import {
  contentHash,
  metadata,
  publicWorkflow,
  validateCommunityPayload,
} from "../community/protocol";
import { firstPartyPacks } from "../core/packs";
import { resourceWorkflow } from "../core/resource-package";
import { saveDefinedResource } from "../storage/resource-runtime";
import { installPacks, setPackEnabled } from "../storage/packs";
beforeEach(async () => {
  await db.delete();
  await db.open();
  await initialize();
});
describe("community package boundary", () => {
  it("exports only chosen resources and strips local origin; readonly validation does not write", async () => {
    const w = createWorkflow();
    w.communityOrigin = {
      workflowId: "private",
      version: 1,
      hash: "private",
      fingerprint: "private",
    };
    const ids = w.nodes
      .filter((n) => n.op === "resource")
      .map((n) => String(n.params.resourceId));
    const p = await exportPackage(publicWorkflow(w), [ids[0]]);
    const counts = await Promise.all(db.tables.map((t) => t.count()));
    validateCommunityPayload(p);
    await previewShare(p);
    expect(JSON.stringify(p)).not.toContain("private");
    expect(p.resources).toHaveLength(1);
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(counts);
  });
  it("rejects polluted, unrelated, incompatible and executable packages before import", async () => {
    const p = await exportPackage(createWorkflow());
    expect(() =>
      validateCommunityPayload(
        JSON.parse(
          JSON.stringify(p).replace(
            '"workflow":{',
            '"workflow":{"__proto__":{},',
          ),
        ),
      ),
    ).toThrow();
    expect(() => validateCommunityPayload({ ...p, history: [] })).toThrow();
    expect(() => validateCommunityPayload({ ...p, version: 99 })).toThrow();
    expect(() =>
      validateCommunityPayload({
        ...p,
        workflow: { ...p.workflow, script: "fetch()" },
      }),
    ).toThrow();
    expect(() =>
      validateCommunityPayload({
        ...p,
        resources: [
          ...p.resources,
          {
            ...p.resources[0],
            meta: { ...p.resources[0].meta, id: "unrelated" },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateCommunityPayload({ ...p, operatorVersions: {} }),
    ).toThrow();
    expect(() =>
      validateCommunityPayload({
        ...p,
        resources: [{ ...p.resources[0], entries: ["x".repeat(1048576)] }],
      }),
    ).toThrow();
  });
  it("imports fresh IDs with origin atomically; wrong hash and missing binding write nothing", async () => {
    const p = await exportPackage(createWorkflow());
    const hash = await contentHash(p);
    const before = await Promise.all(db.tables.map((t) => t.count()));
    await expect(
      adopt(p, { workflowId: "community", version: 1, hash: "tampered" }, {}),
    ).rejects.toThrow("哈希");
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(before);
    const w = await adopt(p, { workflowId: "community", version: 1, hash }, {});
    expect(w.id).not.toBe(p.workflow.id);
    expect((await db.workflows.get(w.id))?.communityOrigin?.hash).toBe(hash);
    const missing = await exportPackage(createWorkflow(), false);
    await db.resources.clear();
    const counts = await Promise.all(db.tables.map((t) => t.count()));
    await expect(
      adopt(
        missing,
        {
          workflowId: "community",
          version: 1,
          hash: await contentHash(missing),
        },
        {},
      ),
    ).rejects.toThrow();
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(counts);
  });
  it("applies bounded pure text metadata rules", () => {
    expect(metadata(" title ", "desc", ["取名", "取名"])).toEqual({
      title: "title",
      description: "desc",
      tags: ["取名"],
    });
    expect(() => metadata("x", "<script>alert(1)</script>", [])).toThrow();
    expect(() => metadata("x", "", Array(9).fill("tag"))).toThrow();
  });
  it("validates v7 dynamic closure and exact declaration manifests; unknown packages remain disabled", async () => {
    const inner = createWorkflow();
    const pack = {
      ...structuredClone(firstPartyPacks[0]),
      id: "unverified-text",
    };
    await installPacks([pack]);
    await setPackEnabled("unverified-text@1.0.0", true);
    inner.extensions = [pack];
    const output = inner.nodes.find((n) => n.op === "output")!;
    inner.nodes.push({
      id: "custom",
      op: "extension",
      inputs: [output.inputs[0]],
      params: {
        pack: pack.id,
        version: pack.version,
        operator: "frame",
        values: "{}",
      },
    });
    output.inputs = ["custom"];
    await saveDefinedResource({
      id: "community-dynamic",
      name: "动态配方",
      description: "",
      kind: "word",
      version: 1,
      color: "green",
      count: 0,
      updatedAt: 0,
      definition: { format: 1, type: "dynamic", workflow: inner },
    });
    const pkg = await exportPackage(resourceWorkflow("community-dynamic"));
    expect(pkg.version).toBe(7);
    validateCommunityPayload(pkg);
    expect(() =>
      validateCommunityPayload({ ...pkg, packManifest: [] }),
    ).toThrow("manifest");
    await db.extensionPacks.delete("unverified-text@1.0.0");
    await adopt(
      pkg,
      { workflowId: "community", version: 1, hash: await contentHash(pkg) },
      {},
    );
    expect(
      (await db.extensionPacks.get("unverified-text@1.0.0"))?.enabled,
    ).toBe(false);
  });
  it("rolls back assets and origin when the final workflow write fails", async () => {
    const pkg = await exportPackage(createWorkflow()),
      counts = await Promise.all(db.tables.map((t) => t.count()));
    const fail = () => {
      throw new Error("injected community write failure");
    };
    db.workflows.hook("creating", fail);
    try {
      await expect(
        adopt(
          pkg,
          { workflowId: "community", version: 1, hash: await contentHash(pkg) },
          {},
        ),
      ).rejects.toThrow("injected");
    } finally {
      db.workflows.hook("creating").unsubscribe(fail);
    }
    expect(await Promise.all(db.tables.map((t) => t.count()))).toEqual(counts);
  });
  it("keeps an unselected Mapping external and requires explicit missing-resource bindings", async () => {
    await saveDefinedResource({
      id: "community-map",
      name: "外部Mapping",
      description: "",
      kind: "mapping",
      version: 1,
      color: "green",
      count: 0,
      updatedAt: 0,
      definition: { format: 1, type: "mapping", rules: '{"月":["玥"]}' },
    });
    const w = createWorkflow(),
      output = w.nodes.find((n) => n.op === "output")!;
    w.nodes.push({
      id: "map",
      op: "mapchars",
      inputs: [output.inputs[0]],
      params: { mappingId: "community-map", mapping: "{}", mode: "first" },
    });
    output.inputs = ["map"];
    const pkg = await exportPackage(w, false);
    validateCommunityPayload(pkg);
    expect(pkg.resources).toHaveLength(0);
    await db.resources.delete("community-map");
    expect((await previewShare(pkg)).missing.map((d) => d.id)).toContain(
      "community-map",
    );
  });
});
