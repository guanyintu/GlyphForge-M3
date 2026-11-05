"""Bounded local PG isolation harness. Auth is fixture; NOT cloud concurrency."""
import json, os, pathlib, shutil, subprocess, sys, time, uuid
root = pathlib.Path.cwd().resolve()
if os.stat(root).st_mode & 0o777 not in (0o700, 0o750):
    print(json.dumps({'status':'BLOCKED','reason':'WORKSPACE_FILESYSTEM_CANNOT_ENFORCE_POSTGRES_PERMISSIONS',
        'businessAssertions':0,'cloudWrites':0,'approvalNeeded':'An isolated WSL temporary directory outside the only authorized workspace'}))
    sys.exit(2)
runtime = pathlib.Path.home() / 'glyphforge-m3-realpg-NZwYMRY5/runtime/bin'
if not (runtime / 'initdb').is_file():
    print(json.dumps({'status':'BLOCKED','reason':'Existing local PostgreSQL runtime unavailable'}))
    sys.exit(2)
work = root / 'test-results/m3-concurrency' / str(uuid.uuid4())
work.mkdir(parents=True)
data, sock = work/'data', work/'socket'
sock.mkdir()
port = '55439'
env = {k:v for k,v in os.environ.items() if not k.startswith('PG')}
env.update(PGHOST=str(sock),PGPORT=port,PGDATABASE='postgres',PGUSER=env.get('USER','somebody'))
payload = json.dumps(json.load(sys.stdin), ensure_ascii=False, separators=(',',':'))
def quote(s): return "'"+s.replace("'","''")+"'"
def pg(sql, app='m3-audit'):
    e = dict(env, PGAPPNAME=app)
    r=subprocess.run([str(runtime/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,env=e,timeout=12)
    if r.returncode: raise RuntimeError(r.stderr)
    return r.stdout.strip()
def rpc(actor,command,body):
    return 'select public.community_write(%s,%s,%s::jsonb);' % (quote(actor),quote(command),quote(json.dumps(body,ensure_ascii=False)))
A,B='11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'
evidence=[];started=False
try:
    init=subprocess.run([str(runtime/'initdb'),'-D',str(data),'-A','trust','--no-locale','--encoding=UTF8'],capture_output=True,text=True,timeout=15)
    if init.returncode:
        print(init.stderr, file=sys.stderr)
        raise RuntimeError('Local initdb unavailable in this workspace')
    subprocess.run([str(runtime/'pg_ctl'),'-D',str(data),'-l',str(work/'server.log'),'-o',f"-k '{sock}' -p {port} -c listen_addresses=''",'-w','start'],check=True,capture_output=True,timeout=15)
    started=True
    pg("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,is_anonymous boolean default false);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated,service_role;insert into auth.users(id) values('%s'),('%s');"%(A,B))
    for f in ['20261101091101_community_platform.sql','20261101114038_community_storage_budget.sql']:
        pg((root/'supabase/migrations'/f).read_text())
    def seed():
        pg('truncate public.usage_events,public.reports,public.workflow_likes,public.workflow_versions,public.community_workflows,public.profiles,community_private.account_budget,community_private.daily_budget;update community_private.control set payload_bytes=0,payload_day_bytes=0;')
        return json.loads(pg('set role service_role;'+rpc(A,'publish',{'title':'M3 local synthetic','description':'Fixture Auth only','tags':[],'payload_text':payload})))['id']
    def pair(name,left,right):
        # Hold A's real transaction lock, then let B contend; observe via third read-only connection.
        processes=[]
        for label,sql in [('A',left),('B',right)]:
            e=dict(env,PGAPPNAME='m3-'+name+'-'+label)
            p=subprocess.Popen([str(runtime/'psql'),'-X','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=e)
            p.stdin.write("begin;set local statement_timeout='8s';set local lock_timeout='5s';set local role service_role;"+sql+('select pg_sleep(1.2);' if label=='A' else '')+'commit;')
            p.stdin.close();p.stdin=None;processes.append(p)
            if label=='A':time.sleep(.25)
        proof=None
        for _ in range(12):
            rows=json.loads(pg("select coalesce(json_agg(json_build_object('pid',pid,'app',application_name,'blockers',pg_blocking_pids(pid),'wait',wait_event_type)),'[]') from pg_stat_activity where application_name like 'm3-%s-%%';"%name))
            if len(rows)==2 and any(r['blockers'] for r in rows):proof=rows;break
            time.sleep(.04)
        for p in processes:
            out,err=p.communicate(timeout=10)
            if p.returncode: raise RuntimeError(err)
        assert proof and len({r['pid'] for r in proof})==2, 'No independent overlapping transaction proof'
        evidence.append({'case':name,'status':'PASS','connections':proof})
    wid=seed()
    pair('simultaneous-like',rpc(A,'like',{'workflow_id':wid,'liked':True}),rpc(B,'like',{'workflow_id':wid,'liked':True}))
    assert pg("select likes=2 and likes=(select count(*) from public.workflow_likes) from public.community_workflows")=='t'
    wid=seed()
    pair('like-unlike',rpc(B,'like',{'workflow_id':wid,'liked':True}),rpc(B,'like',{'workflow_id':wid,'liked':False}))
    assert pg('select likes=0 from public.community_workflows')=='t'
    wid=seed()
    body={'workflow_id':wid,'expected_version':1,'title':'v2','description':'','tags':[],'payload_text':payload}
    def denied(sql,needle):
        return "do $test$ begin begin %s raise exception 'UNEXPECTED_SUCCESS'; exception when others then if position(%s in sqlerrm)=0 then raise; end if; end; end $test$;"%(sql,quote(needle))
    pair('version-conflict',rpc(A,'publish',body),denied(rpc(A,'publish',body),'version conflict'))
    assert pg('select current_version=2 and (select count(*) from public.workflow_versions)=2 from public.community_workflows')=='t'
    wid=seed();event={'workflow_id':wid,'version':1,'id':str(uuid.uuid4()),'kind':'view'}
    pair('event-idempotency',rpc(B,'event',event),rpc(B,'event',event))
    assert pg('select views=1 and (select count(*) from public.usage_events)=1 from public.community_workflows')=='t'
    wid=seed()
    pg("insert into community_private.account_budget values('%s',current_date,239,0);"%B)
    pair('quota-atomicity',rpc(B,'like',{'workflow_id':wid,'liked':True}),denied(rpc(B,'like',{'workflow_id':wid,'liked':False}),'Account daily budget reached'))
    assert pg("select likes=1 and (select writes=240 from community_private.account_budget where user_id='%s') and (select writes=2 from community_private.daily_budget) from public.community_workflows"%B)=='t'
    wid=seed()
    pair('actor-isolation',rpc(A,'edit',{'workflow_id':wid,'title':'owner','description':'','tags':[]}),denied(rpc(B,'edit',{'workflow_id':wid,'title':'stolen','description':'','tags':[]}),'Author required'))
    assert pg("select title='owner' and (select writes=2 from community_private.daily_budget) and not exists(select 1 from community_private.account_budget where user_id='%s') from public.community_workflows"%B)=='t'
    report={'status':'PASS_LOCAL_POSTGRES_CONCURRENCY','cloudConcurrency':'BLOCKED_NO_AUTHORIZED_INDEPENDENT_CLOUD_CONNECTIONS',
        'auth':'fixture schema and users; NOT Supabase Auth','version':pg('show server_version'), 'pairs':6,'cases':evidence,
        'cleanup':'Dedicated local cluster stopped; no cloud writes; local test data retained only in ignored test-results.'}
finally:
    if started:
        subprocess.run([str(runtime/'pg_ctl'),'-D',str(data),'-m','fast','-w','stop'],check=True,capture_output=True,timeout=12)
if started:
    assert not (data/'postmaster.pid').exists()
    (work/'summary.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))
