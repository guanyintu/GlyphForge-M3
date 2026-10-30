import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { db, initialize } from "../storage/db";

afterEach(() => vi.unstubAllGlobals());

it("refuses a standalone resource export if its data changes between pages", async () => {
  await db.resources.clear(); await db.entries.clear(); await initialize();
  const messages: { type: string; message?: string }[] = [];
  let mutation: Promise<unknown> | undefined;
  const scope = { onmessage: null as unknown as (event: MessageEvent) => Promise<void>, postMessage(message: { type: string; message?: string }) {
    messages.push(message);
    if (message.type === "progress" && !mutation) mutation = db.resources.update("animals", { version: 2 });
  } };
  vi.stubGlobal("self", scope);
  await import("../workers/resources.worker");
  await scope.onmessage(new MessageEvent("message", { data: { type: "export", resourceId: "animals", format: "json" } }));
  await mutation;
  expect(messages.some(m => m.type === "exported")).toBe(false);
  expect(messages.at(-1)?.message).toContain("变化");
});
