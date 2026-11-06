-- Run read-only against glyphforge-m3-test (rsntccggnvmuazvpxstf) only.
-- Export the single result row as a JSON object to pass as -BudgetSnapshot.
with utc as (select (now() at time zone 'UTC')::date as day)
select 'rsntccggnvmuazvpxstf' as target, utc.day as utc_day, extract(epoch from now())::bigint as observed_epoch,
coalesce(d.writes,0) as global_writes, coalesce(d.publications,0) as publications,
(select count(*) from community_private.account_budget where day=utc.day) as account_rows,
coalesce((select max(publications) from community_private.account_budget where day=utc.day),0) as max_account_publications,
coalesce((select max(writes) from community_private.account_budget where day=utc.day),0) as max_account_writes,
coalesce((select json_agg(writes order by writes) from community_private.account_budget where day=utc.day),'[]'::json) as account_writes,
(select count(*) from auth.users) as auth_users,
(select count(*) from auth.users where email_confirmed_at is not null) as confirmed_users,
(select count(*) from auth.identities where provider='github') as github_identities,
c.enabled, c.payload_bytes, case when c.payload_day=utc.day then c.payload_day_bytes else 0 end as payload_day_bytes,
(select count(*) from public.community_workflows) as workflows,
(select count(*) from public.community_workflows where status='published') as published,
(select count(*) from public.workflow_versions) as versions,
(select count(*) from public.workflow_likes) as likes,
(select count(*) from public.reports) as reports,
(select count(*) from public.usage_events) as events,
(select count(*) from public.profiles) as profiles,
(select current_setting('pgrst.db_pre_request', true)) as sql_session_pre_request,
exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) x where x like 'pgrst.db_pre_request=%') as db_role_pre_request
from utc cross join community_private.control c left join community_private.daily_budget d using(day) where c.id;
