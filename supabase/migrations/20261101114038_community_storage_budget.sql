-- Conservative free-tier safeguards. These bound accepted database writes;
-- gateway/Auth/denied Edge requests and public read traffic still need platform
-- controls before public launch. All caps include unlisted/deleted snapshots.
alter table community_private.control
  add column payload_bytes bigint not null default 0,
  add column payload_day date not null default (now() at time zone 'UTC')::date,
  add column payload_day_bytes bigint not null default 0;
update community_private.control set payload_bytes=(select coalesce(sum(octet_length(payload::text)),0) from public.workflow_versions);

create function community_private.reserve_payload() returns trigger
language plpgsql security invoker set search_path='' as $$
declare size bigint := octet_length(new.payload::text); c community_private.control;
begin
  select * into c from community_private.control where id for update;
  if c.payload_day <> (now() at time zone 'UTC')::date then
    c.payload_day := (now() at time zone 'UTC')::date;
    c.payload_day_bytes := 0;
  end if;
  if c.payload_bytes + size > 16777216 or c.payload_day_bytes + size > 2097152 then
    raise exception 'Community snapshot storage budget reached';
  end if;
  update community_private.control set payload_bytes=c.payload_bytes+size,
    payload_day=c.payload_day,payload_day_bytes=c.payload_day_bytes+size where id;
  return new;
end $$;
revoke all on function community_private.reserve_payload() from public,anon,authenticated;
create trigger reserve_snapshot_budget before insert on public.workflow_versions
for each row execute function community_private.reserve_payload();

create function community_private.guard_database_size() returns trigger
language plpgsql security invoker set search_path='' as $$
declare size bigint;
begin
  -- Serializes new rows across writers, including budget/event/report tables.
  perform 1 from community_private.control where id for update;
  select sum(pg_catalog.pg_total_relation_size(c.oid)) into size
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and ((n.nspname='community_private') or
      (n.nspname='public' and c.relname in ('profiles','community_workflows','workflow_versions','workflow_likes','usage_events','reports')));
  if size >= 67108864 then raise exception 'Community physical storage budget reached'; end if;
  return new;
end $$;
revoke all on function community_private.guard_database_size() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['public.profiles','public.community_workflows','public.workflow_versions','public.workflow_likes','public.usage_events','public.reports','community_private.daily_budget','community_private.account_budget'] loop
    execute format('create trigger guard_storage before insert on %s for each row execute function community_private.guard_database_size()',t);
  end loop;
end $$;
