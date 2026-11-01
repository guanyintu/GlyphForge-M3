-- All client writes are revoked. The Edge endpoint verifies Auth and validates
-- packages, then calls one service-only INVOKER transaction. No definer bypass.
create schema if not exists community_private;
revoke all on schema community_private from public, anon, authenticated;
grant usage on schema community_private to service_role;
grant usage on schema auth to service_role;
grant select(id,is_anonymous) on auth.users to service_role;
create table community_private.moderators (user_id uuid primary key references auth.users(id));
create table community_private.control (id boolean primary key default true check(id), enabled boolean not null default true);
insert into community_private.control values(true,true);
create table community_private.daily_budget (day date primary key, writes integer not null default 0, publications integer not null default 0);
create table community_private.account_budget (user_id uuid references auth.users(id) on delete cascade, day date, writes integer not null default 0, publications integer not null default 0, primary key(user_id,day));
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, display_name text not null check(length(display_name) between 1 and 80));
create table public.community_workflows (
 id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id), author text not null,
 title text not null check(length(title) between 1 and 100), description text not null check(length(description)<=2000),
 tags text[] not null default '{}' check(cardinality(tags)<=8),
 status text not null default 'published' check(status in ('published','unlisted','blocked','deleted')),
 current_version integer not null default 0 check(current_version between 0 and 30),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 views bigint not null default 0 check(views>=0), adoptions bigint not null default 0 check(adoptions>=0), runs bigint not null default 0 check(runs>=0), likes bigint not null default 0 check(likes>=0),
 search_text text not null default ''
);
create table public.workflow_versions (
 workflow_id uuid not null references public.community_workflows(id), version integer not null check(version between 1 and 30),
 payload json not null check(octet_length(payload::text)<=1048576), content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), primary key(workflow_id,version)
);
create table public.workflow_likes (
 workflow_id uuid not null references public.community_workflows(id), user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(workflow_id,user_id)
);
create table public.usage_events (
 user_id uuid not null references auth.users(id) on delete cascade, event_key uuid not null,
 workflow_id uuid not null, version integer not null, kind text not null check(kind in ('view','adoption','run')),
 bucket timestamptz not null, created_at timestamptz not null default now(),
 primary key(user_id,event_key), unique(user_id,workflow_id,version,kind,bucket),
 foreign key(workflow_id,version) references public.workflow_versions(workflow_id,version)
);
create table public.reports (
 id uuid primary key default gen_random_uuid(), workflow_id uuid not null references public.community_workflows(id),
 reporter_id uuid not null references auth.users(id) on delete cascade, reason text not null check(length(reason) between 5 and 500),
 created_at timestamptz not null default now(), resolved_at timestamptz, resolution text,
 unique(workflow_id,reporter_id)
);
create index community_latest on public.community_workflows(created_at desc,id) where status='published';
create index community_popular on public.community_workflows(likes desc,id) where status='published';
create index community_used on public.community_workflows(adoptions desc,id) where status='published';
create index community_author on public.community_workflows(author_id);
create index community_tags on public.community_workflows using gin(tags);
create index likes_user on public.workflow_likes(user_id);
create index events_daily on public.usage_events(user_id,created_at);
create index events_workflow on public.usage_events(workflow_id,version,user_id,kind);
create index reports_queue on public.reports(created_at) where resolved_at is null;
create index reports_reporter on public.reports(reporter_id,created_at);
alter table public.profiles enable row level security;
alter table public.community_workflows enable row level security;
alter table public.workflow_versions enable row level security;
alter table public.workflow_likes enable row level security;
alter table public.usage_events enable row level security;
alter table public.reports enable row level security;
alter table community_private.moderators enable row level security;
alter table community_private.control enable row level security;
alter table community_private.daily_budget enable row level security;
alter table community_private.account_budget enable row level security;
revoke all on public.profiles,public.community_workflows,public.workflow_versions,public.workflow_likes,public.usage_events,public.reports from public,anon,authenticated;
grant select on public.profiles,public.community_workflows,public.workflow_versions to anon,authenticated;
grant select on public.workflow_likes,public.reports to authenticated;
grant all on all tables in schema community_private to service_role;
grant all on public.profiles,public.community_workflows,public.workflow_versions,public.workflow_likes,public.usage_events,public.reports to service_role;
create policy visible_profiles on public.profiles for select to anon,authenticated using (id=(select auth.uid()) or exists(select 1 from public.community_workflows w where w.author_id=profiles.id and w.status='published'));
create policy visible_workflows on public.community_workflows for select to anon,authenticated using(status='published' or (author_id=(select auth.uid()) and status<>'deleted'));
create policy visible_versions on public.workflow_versions for select to anon,authenticated using(exists(select 1 from public.community_workflows w where w.id=workflow_id and (w.status='published' or (w.author_id=(select auth.uid()) and w.status<>'deleted'))));
create policy own_likes on public.workflow_likes for select to authenticated using(user_id=(select auth.uid()));
create policy own_reports on public.reports for select to authenticated using(reporter_id=(select auth.uid()));

create function public.community_write(actor uuid, command text, b jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
 w public.community_workflows; wid uuid; n integer; accepted integer; v integer;
 daykey date := (now() at time zone 'UTC')::date; budget community_private.daily_budget; ab community_private.account_budget;
begin
 if actor is null or not exists(select 1 from auth.users where id=actor and not coalesce(is_anonymous,false)) then raise exception 'Account required'; end if;
 if not coalesce((select enabled from community_private.control where id),false) then raise exception 'Community writes paused'; end if;
 if command not in ('reserve','publish','edit','status','like','event','report','review','moderate') then raise exception 'Unknown command'; end if;
 -- Global and account rows serialize quota checks, including concurrent events.
 insert into community_private.daily_budget(day) values(daykey) on conflict do nothing;
 select * into budget from community_private.daily_budget where day=daykey for update;
 if budget.writes>=20000 then raise exception 'Global daily budget reached'; end if;
 insert into community_private.account_budget(user_id,day) values(actor,daykey) on conflict do nothing;
 select * into ab from community_private.account_budget where user_id=actor and day=daykey for update;
 if ab.writes>=240 then raise exception 'Account daily budget reached'; end if;
 update community_private.daily_budget set writes=writes+1 where day=daykey;
 update community_private.account_budget set writes=writes+1 where user_id=actor and day=daykey;
 if command='reserve' then return '{"ok":true}'::jsonb; end if;
 if command='review' then
   if not exists(select 1 from community_private.moderators where user_id=actor) then raise exception 'Moderator required'; end if;
   return coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.reports where resolved_at is null order by created_at limit 100) r),'[]'::jsonb);
 end if;
 wid := (b->>'workflow_id')::uuid;
 if wid is not null then
   select * into w from public.community_workflows where id=wid for update;
   if not found or w.status='deleted' then raise exception 'Workflow unavailable'; end if;
 end if;
 if command='publish' then
   if budget.publications>=100 or ab.publications>=10 then raise exception 'Publication budget reached'; end if;
   if octet_length(b->>'payload_text')>1048576 or jsonb_typeof((b->>'payload_text')::jsonb)<>'object' or (b->>'payload_text')::jsonb->>'format'<>'glyphforge' then raise exception 'Invalid package'; end if;
   if w.id is null then
     if (select count(*) from public.community_workflows where author_id=actor)>=20 then raise exception 'Author workflow limit'; end if;
     insert into public.profiles values(actor,'创作者 '||left(actor::text,8)) on conflict do nothing;
     insert into public.community_workflows(author_id,author,title,description,tags) values(actor,(select display_name from public.profiles where id=actor),b->>'title',b->>'description',array(select jsonb_array_elements_text(b->'tags'))) returning * into w;
     wid:=w.id;
   elsif w.author_id<>actor or w.status='blocked' or w.current_version is distinct from (b->>'expected_version')::integer then raise exception 'Ownership, moderation or version conflict'; end if;
   v:=w.current_version+1;
   insert into public.workflow_versions(workflow_id,version,payload,content_hash) values(wid,v,(b->>'payload_text')::json,encode(sha256(convert_to(b->>'payload_text','UTF8')),'hex'));
   update public.community_workflows set current_version=v,title=b->>'title',description=b->>'description',tags=array(select jsonb_array_elements_text(b->'tags')),search_text=(b->>'title')||' '||(b->>'description')||' '||array_to_string(array(select jsonb_array_elements_text(b->'tags')),' '),updated_at=now() where id=wid;
   update community_private.daily_budget set publications=publications+1 where day=daykey;
   update community_private.account_budget set publications=publications+1 where user_id=actor and day=daykey;
 elsif w.id is null then raise exception 'Workflow required';
 elsif command='edit' then
   if w.author_id<>actor then raise exception 'Author required'; end if;
   update public.community_workflows set title=b->>'title',description=b->>'description',tags=array(select jsonb_array_elements_text(b->'tags')),search_text=(b->>'title')||' '||(b->>'description')||' '||array_to_string(array(select jsonb_array_elements_text(b->'tags')),' '),updated_at=now() where id=wid;
 elsif command='status' then
   if w.author_id<>actor or (w.status='blocked' and b->>'status'<>'deleted') or b->>'status' not in ('published','unlisted','deleted') then raise exception 'Author status denied'; end if;
   update public.community_workflows set status=b->>'status',updated_at=now() where id=wid;
 elsif command='moderate' then
   if not exists(select 1 from community_private.moderators where user_id=actor) or length(b->>'reason') not between 5 and 500 then raise exception 'Moderator and reason required'; end if;
   update public.community_workflows set status='blocked',updated_at=now() where id=wid;
   update public.reports set resolved_at=now(),resolution=b->>'reason' where workflow_id=wid and resolved_at is null;
 elsif w.status<>'published' then raise exception 'Workflow not public';
 elsif command='like' then
   if (b->>'liked')::boolean then
     insert into public.workflow_likes values(wid,actor,now()) on conflict do nothing;get diagnostics accepted=row_count;
   else delete from public.workflow_likes where workflow_id=wid and user_id=actor;get diagnostics accepted=row_count;accepted := -accepted; end if;
   update public.community_workflows set likes=likes+accepted where id=wid;
 elsif command='event' then
   if b->>'kind' not in ('view','adoption','run') then raise exception 'Event kind denied'; end if;
   if (select count(*) from public.usage_events where user_id=actor and created_at>=daykey::timestamptz)>=120 then raise exception 'Event daily budget'; end if;
   v:=(b->>'version')::integer;
   if b->>'kind'='run' and not exists(select 1 from public.usage_events where user_id=actor and workflow_id=wid and version=v and kind='adoption') then raise exception 'Adopt version first'; end if;
   insert into public.usage_events(user_id,event_key,workflow_id,version,kind,bucket) values(actor,(b->>'id')::uuid,wid,v,b->>'kind',date_trunc('hour',now())) on conflict do nothing;
   get diagnostics accepted=row_count;
   update public.community_workflows set views=views+case when b->>'kind'='view' then accepted else 0 end,adoptions=adoptions+case when b->>'kind'='adoption' then accepted else 0 end,runs=runs+case when b->>'kind'='run' then accepted else 0 end where id=wid;
 elsif command='report' then
   if (select count(*) from public.reports where reporter_id=actor and created_at>=daykey::timestamptz)>=5 then raise exception 'Report daily budget'; end if;
   insert into public.reports(workflow_id,reporter_id,reason) values(wid,actor,b->>'reason') on conflict(workflow_id,reporter_id) do nothing;
 end if;
 select * into w from public.community_workflows where id=wid;
 return to_jsonb(w);
end;
$$;
revoke all on function public.community_write(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.community_write(uuid,text,jsonb) to service_role;
