// Real Deno handler + HTTP Auth/RPC fixtures. Not a database/RLS acceptance test.
const actor = "11111111-1111-4111-8111-111111111111";
const calls: { actor: string; command: string; b: Record<string, unknown> }[] =
  [];
const backend = Deno.serve(
  { port: 0, hostname: "127.0.0.1", onListen() {} },
  async (req) => {
    if (new URL(req.url).pathname === "/auth/v1/user")
      return Response.json(
        req.headers.get("authorization") === "Bearer fixture-token"
          ? { id: actor, is_anonymous: false, user_metadata: { role: "admin" } }
          : { message: "invalid token" },
        {
          status:
            req.headers.get("authorization") === "Bearer fixture-token"
              ? 200
              : 401,
        },
      );
    calls.push(await req.json());
    return Response.json({ ok: true });
  },
);
Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${backend.addr.port}`);
Deno.env.set("COMMUNITY_PUBLISHABLE_KEY", "sb_publishable_fixture");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "fixture-server-key");
const { handler } = await import("./index.ts");
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/community", {
    method: "POST",
    headers: {
      authorization: "Bearer fixture-token",
      origin: "http://127.0.0.1:5173",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
const assert = (v: boolean) => {
  if (!v) throw new Error("Assertion failed");
};
Deno.test(
  "Edge authenticates, bounds body, reserves budget, rejects hostile snapshots and ignores actor claims",
  async () => {
    try {
      assert(
        (
          await handler(
            request({ action: "like" }, { authorization: "Bearer wrong" }),
          )
        ).status === 401,
      );
      assert(
        (
          await handler(
            request({ action: "like" }, { origin: "https://evil.invalid" }),
          )
        ).status === 403,
      );
      assert(
        (
          await handler(
            request({ action: "publish" }, { "content-length": "2000000" }),
          )
        ).status === 413,
      );
      const before = calls.length;
      const hostile = {
        format: "glyphforge",
        version: 2,
        workflow: { script: "fetch()" },
        resources: [],
      };
      assert(
        (
          await handler(
            request({
              action: "publish",
              title: "test",
              description: "",
              tags: [],
              payload: hostile,
            }),
          )
        ).status === 400,
      );
      assert(
        calls.length === before + 1 && calls.at(-1)?.command === "reserve",
      );
      const w = {
        version: 1,
        id: "fixture",
        name: "本地",
        seed: 42,
        limit: 10,
        layout: {},
        nodes: [
          {
            id: "r",
            op: "resource",
            inputs: [],
            params: { resourceId: "words" },
          },
          { id: "out", op: "output", inputs: ["r"], params: {} },
        ],
      };
      const payload = {
        format: "glyphforge",
        version: 2,
        irVersion: 1,
        workflow: w,
        operatorVersions: { resource: 1, output: 1 },
        resources: [],
        dependencies: [{ id: "words", name: "词库", version: 1, kind: "word" }],
      };
      const good = await handler(
        request({
          action: "publish",
          actor: "spoof",
          title: "test",
          description: "",
          tags: [],
          payload,
        }),
      );
      assert(good.status === 200);
      assert(calls.at(-1)?.actor === actor);
      assert(typeof calls.at(-1)?.b.payload_text === "string");
      assert(!("payload" in calls.at(-1)!.b));
      assert(
        (
          await handler(
            request({
              action: "publish",
              title: "test",
              description: "<script>x</script>",
              tags: [],
              payload,
            }),
          )
        ).status === 400,
      );
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(1100001));
          c.close();
        },
      });
      const large = await handler(
        new Request("http://localhost/community", {
          method: "POST",
          headers: { authorization: "Bearer fixture-token" },
          body: stream,
        }),
      );
      assert(large.status === 400);
    } finally {
      await backend.shutdown();
    }
  },
);
