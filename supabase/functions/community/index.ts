import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { validateCommunityPayload, metadata } from "./validator.js";

// Only this server module reads service credentials. Never bundled into the frontend.
const url = Deno.env.get("SUPABASE_URL")!;
const publicKey = Deno.env.get("COMMUNITY_PUBLISHABLE_KEY")!;
const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const origins = (
  Deno.env.get("COMMUNITY_ALLOWED_ORIGINS") ||
  "http://127.0.0.1:5173,http://127.0.0.1:4175"
).split(",");
export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const respond = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && !origins.includes(origin))
    return respond({ error: "Origin denied" }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return respond({ error: "POST required" }, 405);
  if (Number(req.headers.get("content-length") || 0) > 1100000)
    return respond({ error: "Request too large" }, 413);
  try {
    const authorization = req.headers.get("authorization") || "";
    const client = createClient(url, publicKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authorization } },
    });
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser(authorization.replace(/^Bearer /, ""));
    if (authError || !user || user.is_anonymous)
      return respond({ error: "Login required" }, 401);
    const admin = createClient(url, secret, {
      auth: { persistSession: false },
    });
    const { error: budgetError } = await admin.rpc("community_write", {
      actor: user.id,
      command: "reserve",
      b: {},
    });
    if (budgetError) return respond({ error: "写入预算已用尽或已暂停" }, 429);
    // Bound the streamed request even if Content-Length is missing or forged.
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Empty body");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      void reader.cancel();
    }, 8000);
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (expired) throw new Error("Request timeout");
        if (done) break;
        bytes += value.length;
        if (bytes > 1100000) throw new Error("Request too large");
        chunks.push(value);
      }
    } finally {
      clearTimeout(timer);
      await reader.cancel();
    }
    const raw = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.length;
    }
    const b = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!b || typeof b !== "object" || Array.isArray(b))
      throw new Error("Invalid body");
    const action = b.action;
    if (
      ![
        "publish",
        "edit",
        "status",
        "like",
        "event",
        "report",
        "review",
        "moderate",
      ].includes(action)
    )
      throw new Error("Invalid action");
    if (action === "publish" || action === "edit")
      Object.assign(b, metadata(b.title, b.description, b.tags));
    if (action === "publish") {
      validateCommunityPayload(b.payload);
      b.payload_text = JSON.stringify(b.payload);
      delete b.payload;
    }
    // actor is taken solely from verified Auth, never request data or user_metadata.
    const { data, error } = await admin.rpc("community_write", {
      actor: user.id,
      command: action,
      b,
    });
    if (error) return respond({ error: "操作被拒绝：" + error.message }, 400);
    return respond(data);
  } catch (e) {
    return respond(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
}
if (import.meta.main) Deno.serve(handler);
