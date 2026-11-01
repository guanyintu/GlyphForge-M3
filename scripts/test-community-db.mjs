// Executes the real migration in embedded Postgres. Auth schema/roles below are
// fixtures, so this is NOT a Supabase Auth/PostgREST/RLS acceptance replacement.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
const author = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default false);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;grant select on auth.users to service_role;
insert into auth.users(id) values('${author}'),('${other}');`);
await db.exec(
  readFileSync(
    "supabase/migrations/20261101091101_community_platform.sql",
    "utf8",
  ),
);
const role = async (name, id = "") => {
  await db.exec(`reset role;set role ${name};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
};
const command = async (actor, action, b) => {
  return (
    await db.query("select public.community_write($1,$2,$3) as result", [
      actor,
      action,
      JSON.stringify(b),
    ])
  ).rows[0].result;
};
let checks = 0;
const ok = (v) => {
  assert.ok(v);
  checks++;
};
const denied = async (fn) => {
  await assert.rejects(fn);
  checks++;
};
await role("service_role");
const listing = await command(author, "publish", {
  title: "示例",
  description: "描述",
  tags: ["取名"],
  payload_text: '{"format":"glyphforge","version":2}',
});
const id = listing.id;
ok(listing.current_version === 1);
await role("anon");
ok(
  (await db.query("select * from public.community_workflows")).rows.length ===
    1,
);
ok(
  (await db.query("select * from public.workflow_versions")).rows.length === 1,
);
ok((await db.query("select * from public.profiles")).rows.length === 1);
await denied(() => db.query("update public.community_workflows set likes=999"));
await denied(() => command(author, "like", { workflow_id: id, liked: true }));
await denied(() => db.query("select * from public.usage_events"));
await role("authenticated", other);
await denied(() =>
  db.query(
    "insert into public.workflow_likes(workflow_id,user_id) values($1,$2)",
    [id, other],
  ),
);
await denied(() => db.query("delete from public.workflow_versions"));
await denied(() => db.query("select * from community_private.moderators"));
await role("service_role");
await denied(() =>
  command(other, "edit", {
    workflow_id: id,
    title: "stolen",
    description: "",
    tags: [],
  }),
);
await denied(() =>
  command(other, "status", { workflow_id: id, status: "deleted" }),
);
await denied(() =>
  command(other, "moderate", { workflow_id: id, reason: "not admin" }),
);
await denied(() =>
  command(author, "publish", {
    workflow_id: id,
    title: "bad",
    description: "",
    tags: [],
    payload_text: "{}",
  }),
);
await Promise.all(
  Array.from({ length: 15 }, () =>
    command(other, "like", { workflow_id: id, liked: true }),
  ),
);
ok(
  (await db.query("select likes from public.community_workflows")).rows[0]
    .likes === 1,
);
const event = {
  workflow_id: id,
  version: 1,
  kind: "adoption",
  id: crypto.randomUUID(),
};
await Promise.all(
  Array.from({ length: 15 }, () => command(other, "event", event)),
);
ok(
  (await db.query("select adoptions from public.community_workflows")).rows[0]
    .adoptions === 1,
);
await command(other, "event", { ...event, id: crypto.randomUUID() });
ok(
  (await db.query("select adoptions from public.community_workflows")).rows[0]
    .adoptions === 1,
);
await command(other, "event", {
  ...event,
  kind: "run",
  id: crypto.randomUUID(),
});
ok(
  (await db.query("select runs from public.community_workflows")).rows[0]
    .runs === 1,
);
await command(other, "like", { workflow_id: id, liked: false });
await command(other, "like", { workflow_id: id, liked: false });
ok(
  (await db.query("select likes from public.community_workflows")).rows[0]
    .likes === 0,
);
await command(other, "report", { workflow_id: id, reason: "unsafe content" });
await role("authenticated", author);
ok((await db.query("select * from public.reports")).rows.length === 0);
await role("authenticated", other);
ok((await db.query("select * from public.reports")).rows.length === 1);
await role("service_role");
await command(author, "status", { workflow_id: id, status: "unlisted" });
await role("anon");
ok(
  (await db.query("select * from public.community_workflows")).rows.length ===
    0,
);
ok(
  (await db.query("select * from public.workflow_versions")).rows.length === 0,
);
await role("authenticated", other);
ok(
  (await db.query("select * from public.workflow_versions")).rows.length === 0,
);
await role("authenticated", author);
ok(
  (await db.query("select * from public.workflow_versions")).rows.length === 1,
);
await role("service_role");
await command(author, "status", { workflow_id: id, status: "published" });
await command(author, "publish", {
  workflow_id: id,
  expected_version: 1,
  title: "示例2",
  description: "描述2",
  tags: [],
  payload_text: '{"format":"glyphforge","version":3}',
});
ok(
  (await db.query("select * from public.workflow_versions")).rows.length === 2,
);
await denied(()=>command(other,'event',{...event,version:2,kind:'run',id:crypto.randomUUID()}));
await command(other,'event',{...event,version:2,id:crypto.randomUUID()});
await command(other,'event',{...event,version:2,kind:'run',id:crypto.randomUUID()});
ok((await db.query('select adoptions,runs from public.community_workflows')).rows[0].runs===2);
await db.exec('reset role');
ok((await db.query("select bool_and(relrowsecurity) as enabled from pg_class where relnamespace='public'::regnamespace and relkind='r'")).rows[0].enabled);
await db.query('update community_private.account_budget set writes=240 where user_id=$1',[author]);
await role('service_role');await denied(()=>command(author,'reserve',{}));
await db.exec('reset role');await db.query('update community_private.account_budget set writes=0 where user_id=$1',[author]);await role('service_role');
await denied(() =>
  command(author, "publish", {
    workflow_id: id,
    expected_version: 1,
    title: "stale",
    description: "",
    tags: [],
    payload_text: '{"format":"glyphforge"}',
  }),
);
await db.exec("reset role");
await db.query("insert into community_private.moderators values($1)", [other]);
await role("service_role");
await command(other, "moderate", {
  workflow_id: id,
  reason: "confirmed unsafe",
});
await denied(() =>
  command(author, "status", { workflow_id: id, status: "published" }),
);
await role("anon");
ok(
  (await db.query("select * from public.workflow_versions")).rows.length === 0,
);
await db.exec("reset role");
await db.exec("update community_private.control set enabled=false");
await role("service_role");
await denied(() =>
  command(author, "edit", {
    workflow_id: id,
    title: "x",
    description: "",
    tags: [],
  }),
);
console.log(
  JSON.stringify({
    engine:
      "PGlite embedded PostgreSQL; fixture Auth; NOT live Supabase acceptance",
    checks,
    concurrency: "queued single connection; multi-connection Supabase pending",
  }),
);
await db.close();
