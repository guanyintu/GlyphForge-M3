-- Only after explicit disposable-target authorization. Use community:acceptance
-- --preflight first, then --db-tests (psql, no Docker dependency). No migration.
begin;
set local search_path = public, extensions;
create extension if not exists pgtap with schema extensions;
select plan(30);
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','community_workflows','workflow_versions','workflow_likes','usage_events','reports') and c.relrowsecurity),6,'all public community tables use RLS');
select ok(not (select prosecdef from pg_proc where oid='public.community_write(uuid,text,jsonb)'::regprocedure),'writer is SECURITY INVOKER');
select ok(not has_function_privilege('anon','public.community_write(uuid,text,jsonb)','EXECUTE'),'anon has no writer grant');
select ok(not has_function_privilege('authenticated','public.community_write(uuid,text,jsonb)','EXECUTE'),'authenticated has no writer grant');
select ok(has_function_privilege('service_role','public.community_write(uuid,text,jsonb)','EXECUTE'),'service role has writer grant');
select ok(not has_schema_privilege('anon','community_private','USAGE'),'anon has no private schema access');
select ok(not has_schema_privilege('authenticated','community_private','USAGE'),'authenticated has no private schema access');
select ok((select bool_and(not has_table_privilege('anon','public.'||t,'INSERT,UPDATE,DELETE')) from unnest(array['profiles','community_workflows','workflow_versions','workflow_likes','usage_events','reports']) t),'anon has no table write grants');
select ok((select bool_and(not has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE')) from unnest(array['profiles','community_workflows','workflow_versions','workflow_likes','usage_events','reports']) t),'authenticated has no table write grants');
select ok(not has_table_privilege('anon','public.usage_events','SELECT'),'anon cannot read raw events');
select ok(not has_table_privilege('authenticated','public.usage_events','SELECT'),'authenticated cannot read raw events');
insert into auth.users(id,email,is_anonymous) values
 ('11111111-1111-4111-8111-111111111111','m3-author@example.invalid',false),
 ('22222222-2222-4222-8222-222222222222','m3-other@example.invalid',false),
 ('55555555-5555-4555-8555-555555555555','m3-anonymous@example.invalid',true);
insert into public.profiles values('11111111-1111-4111-8111-111111111111','Author');
insert into public.community_workflows(id,author_id,author,title,description,current_version) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Author','Public','',1),
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Author','Hidden','',1);
update public.community_workflows set status='unlisted' where title='Hidden';
insert into public.workflow_versions(workflow_id,version,payload,content_hash) select id,1,'{}',repeat('a',64) from public.community_workflows;
insert into public.workflow_likes(workflow_id,user_id) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222');
insert into public.reports(workflow_id,reporter_id,reason) values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','fixture report');
set local role anon;
select is((select count(*)::integer from public.community_workflows),1,'anon sees only public');
select is((select count(*)::integer from public.workflow_versions),1,'anon version visibility follows parent');
select throws_ok('update public.community_workflows set likes=99','42501',null,'anon cannot alter counters');
select throws_ok($$select public.community_write('11111111-1111-4111-8111-111111111111','reserve','{}')$$,'42501',null,'anon cannot call writer');
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is((select count(*)::integer from public.workflow_likes),1,'other reads own like');
select is((select count(*)::integer from public.reports),1,'other reads own report');
select is((select count(*)::integer from public.workflow_versions),1,'other cannot see hidden version');
select throws_ok('delete from public.workflow_versions','42501',null,'other cannot mutate snapshot');
select throws_ok('select * from public.usage_events','42501',null,'raw usage stays private');
select throws_ok('select * from community_private.moderators','42501',null,'no metadata admin escalation');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select is((select count(*)::integer from public.workflow_likes),0,'author cannot read other likes');
select is((select count(*)::integer from public.reports),0,'author cannot read other reports');
select is((select count(*)::integer from public.workflow_versions),2,'author sees own unlisted version');
select throws_ok('update public.community_workflows set author_id=gen_random_uuid()','42501',null,'author cannot transfer ownership');
select throws_ok('update public.workflow_versions set payload=''{}''','42501',null,'author cannot rewrite snapshot');
set local role service_role;
select throws_ok($$select public.community_write('55555555-5555-4555-8555-555555555555','reserve','{}')$$,'P0001','Account required','anonymous Auth user cannot write');
select throws_ok($$select public.community_write('22222222-2222-4222-8222-222222222222','edit','{"workflow_id":"33333333-3333-4333-8333-333333333333","title":"stolen","description":"","tags":[]}')$$,'P0001','Author required','endpoint rechecks actor');
select lives_ok($$select public.community_write('11111111-1111-4111-8111-111111111111','status','{"workflow_id":"33333333-3333-4333-8333-333333333333","status":"unlisted"}')$$,'author can unlist via endpoint');
set local role anon;
-- Restore an anonymous request: role switching alone leaves the author JWT claim.
select set_config('request.jwt.claim.sub','',true);
select is((select count(*)::integer from public.workflow_versions),0,'unlisting closes download to anon');
reset role;
select * from finish();
rollback;
