select case when w.id='1bf25296-2c2a-43b7-b616-743e0d0ca335' then 'this_run' else 'prior_run' end as workflow, w.status, w.current_version, w.likes as listing_likes,
w.views, w.adoptions, w.runs,
(select count(*) from public.workflow_versions v where v.workflow_id=w.id) as versions,
(select coalesce(sum(octet_length(v.payload::text)),0) from public.workflow_versions v where v.workflow_id=w.id) as payload_bytes,
(select count(*) from public.workflow_likes l where l.workflow_id=w.id) as like_rows,
(select count(*) from public.reports r where r.workflow_id=w.id) as reports,
(select count(*) from public.usage_events e where e.workflow_id=w.id) as events,
exists(select 1 from public.profiles p where p.id=w.author_id) as author_profile_exists,
(select b.writes from community_private.account_budget b where b.day=date '2026-11-06' and b.user_id=w.author_id) as author_day_writes
from public.community_workflows w where w.id in ('1bf25296-2c2a-43b7-b616-743e0d0ca335','e34e98cc-78d1-4be2-9d06-65e0f19f26c0') order by workflow;
