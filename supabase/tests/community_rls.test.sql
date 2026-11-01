-- Run only against a disposable LOCAL Supabase: supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);
insert into auth.users(id,email,is_anonymous) values
 ('11111111-1111-4111-8111-111111111111','m3-author@example.invalid',false),
 ('22222222-2222-4222-8222-222222222222','m3-other@example.invalid',false);
insert into public.profiles values('11111111-1111-4111-8111-111111111111','Author');
insert into public.community_workflows(id,author_id,author,title,description,current_version) values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Author','Public','',1),
 ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Author','Hidden','',1);
update public.community_workflows set status='unlisted' where title='Hidden';
insert into public.workflow_versions(workflow_id,version,payload,content_hash) select id,1,'{}',repeat('a',64) from public.community_workflows;
set local role anon;
select is((select count(*)::integer from public.community_workflows),1,'anon sees only public');
select is((select count(*)::integer from public.workflow_versions),1,'anon version visibility follows parent');
select throws_ok('update public.community_workflows set likes=99','42501',null,'anon cannot alter counters');
select throws_ok($$select public.community_write('11111111-1111-4111-8111-111111111111','reserve','{}')$$,'42501',null,'anon cannot call writer');
set local role authenticated;
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select is((select count(*)::integer from public.workflow_versions),1,'other cannot see hidden version');
select throws_ok('delete from public.workflow_versions','42501',null,'other cannot mutate snapshot');
select throws_ok('select * from public.usage_events','42501',null,'raw usage stays private');
select throws_ok('select * from community_private.moderators','42501',null,'no metadata admin escalation');
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select is((select count(*)::integer from public.workflow_versions),2,'author sees own unlisted version');
select throws_ok('update public.community_workflows set author_id=gen_random_uuid()','42501',null,'author cannot transfer ownership');
select throws_ok('update public.workflow_versions set payload=''{}''','42501',null,'author cannot rewrite snapshot');
set local role service_role;
select throws_ok($$select public.community_write('22222222-2222-4222-8222-222222222222','edit','{"workflow_id":"33333333-3333-4333-8333-333333333333","title":"stolen","description":"","tags":[]}')$$,'P0001','Author required','endpoint rechecks actor');
select lives_ok($$select public.community_write('11111111-1111-4111-8111-111111111111','status','{"workflow_id":"33333333-3333-4333-8333-333333333333","status":"unlisted"}')$$,'author can unlist via endpoint');
set local role anon;
select is((select count(*)::integer from public.workflow_versions),0,'unlisting closes download to anon');
reset role;
select * from finish();
rollback;
