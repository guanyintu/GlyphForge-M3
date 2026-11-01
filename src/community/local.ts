import Dexie, { type Table } from "dexie";
import { community, CommunityError, type Usage } from "./client";
import {
  contentHash,
  publicWorkflow,
  validateCommunityPayload,
  type Origin,
} from "./protocol";
import type { Workflow } from "../core/model";
import { importPackage } from "../core/sharing";
import { previewShare } from "../core/share-preview";
import { db } from "../storage/db";
const local = new Dexie("glyphforge-community-outbox");
local.version(1).stores({ events: "id,actor" });
const events = local.table("events") as Table<Usage>;
let flushing: Promise<void> | undefined;
let lastError = "";
export async function usageStatus() {
  return { pending: await events.count(), error: lastError };
}
export async function flushUsage() {
  return (flushing ||= (async () => {
    const api = community(),
      user = await api.user();
    if (!user || !navigator.onLine) return;
    const pending = (
      await events
        .where("actor")
        .equals(`${api.mode}:${user.id}`)
        .limit(200)
        .toArray()
    ).sort(
      (a, b) =>
        a.at - b.at ||
        (a.kind === "adoption" ? -1 : b.kind === "adoption" ? 1 : 0),
    );
    for (const event of pending) {
      try {
        await api.write("event", event);
        await events.delete(event.id);
      } catch (e) {
        lastError = String(e);
        if (e instanceof CommunityError && [400, 403, 404].includes(e.status)) {
          await events.delete(event.id);
          continue;
        }
        break;
      }
    }
  })().finally(() => {
    flushing = undefined;
  }));
}
export async function recordUsage(
  origin: Origin,
  kind: Usage["kind"],
  id: string = crypto.randomUUID(),
) {
  const api = community(),
    user = await api.user();
  if (!user) return;
  if ((await events.count()) >= 200) {
    lastError = "统计待同步队列已满，本次未计数";
    return;
  }
  await events.put({
    id,
    actor: `${api.mode}:${user.id}`,
    workflow_id: origin.workflowId,
    version: origin.version,
    kind,
    at: Date.now(),
  });
  await flushUsage();
}
export async function adopt(
  data: unknown,
  origin: Omit<Origin, "fingerprint">,
  bindings: Record<string, string>,
) {
  validateCommunityPayload(data);
  if ((await contentHash(data)) !== origin.hash)
    throw new Error("下载内容哈希不符");
  await previewShare(data);
  // Hashing uses WebCrypto outside IDB. Prepare the exact remapped workflow first.
  const w = await db.transaction(
    "rw",
    db.resources,
    db.entries,
    db.relations,
    db.workflows,
    db.extensionPacks,
    async () => {
      const imported = await importPackage(data, bindings);
      imported.communityOrigin = {
        ...origin,
        fingerprint: JSON.stringify(publicWorkflow(imported)),
      };
      await db.workflows.put(imported);
      return imported;
    },
  );
  w.communityOrigin = {
    ...origin,
    fingerprint: JSON.stringify(publicWorkflow(w)),
  };
  void recordUsage(w.communityOrigin, "adoption").catch(() => {});
  return w;
}
export async function recordSuccessfulRun(w: Workflow, runId: string) {
  if (
    w.communityOrigin &&
    JSON.stringify(publicWorkflow(w)) === w.communityOrigin.fingerprint
  )
    await recordUsage(w.communityOrigin, "run", runId);
}
