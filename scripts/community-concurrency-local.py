"""Run bounded concurrency checks on a disposable PostgreSQL cluster in WSL."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid


ROOT = Path.cwd().resolve()
RUNTIME = Path.home() / 'glyphforge-m3-realpg-NZwYMRY5/runtime/bin'
AUTHOR = '11111111-1111-4111-8111-111111111111'
READER = '22222222-2222-4222-8222-222222222222'
PSQL = [str(RUNTIME / 'psql'), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
TRANSACTION = """
    begin;
    set local statement_timeout = '8s';
    set local lock_timeout = '6s';
    set local idle_in_transaction_session_timeout = '10s';
    set local role service_role;
"""


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def rpc(actor, command, body):
    return 'select public.community_write(%s, %s, %s::jsonb);' % (
        quote(actor), quote(command), quote(json.dumps(body, ensure_ascii=False))
    )


def run_checks(env, payload):
    def query(sql):
        result = subprocess.run(
            PSQL, input=sql, env=dict(env, PGAPPNAME='m3-observer'), text=True,
            capture_output=True, timeout=8, check=True,
        )
        return result.stdout.strip()

    def observe(predicate, phase):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            rows = json.loads(query("""
                select coalesce(json_agg(json_build_object(
                    'pid', pid, 'app', application_name, 'state', state,
                    'blockers', pg_blocking_pids(pid), 'wait', wait_event_type
                )), '[]') from pg_stat_activity
                where application_name in ('m3-left', 'm3-right');
            """))
            if predicate(rows):
                return rows
            time.sleep(.05)
        raise RuntimeError(f'No PostgreSQL session evidence for {phase}')

    def start_writer(label, sql):
        process = subprocess.Popen(
            PSQL, env=dict(env, PGAPPNAME=label), stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        process.stdin.write(TRANSACTION + sql + '\n')
        process.stdin.flush()
        return process

    def check_pair(name, left_sql, right_sql, readback, expected, denial=None):
        with start_writer('m3-left', left_sql) as left:
            try:
                [holder] = observe(
                    lambda rows: len(rows) == 1 and rows[0]['app'] == 'm3-left'
                    and rows[0]['state'] == 'idle in transaction', f'{name} holder',
                )
                with start_writer('m3-right', right_sql + '\ncommit;') as right:
                    try:
                        connections = observe(
                            lambda rows: len(rows) == 2 and any(
                                row['app'] == 'm3-right' and row['pid'] != holder['pid']
                                and row['wait'] == 'Lock' and holder['pid'] in row['blockers']
                                for row in rows
                            ), f'{name} lock overlap',
                        )
                        left.communicate('commit;\n', timeout=8)
                        _, right_error = right.communicate(timeout=8)
                        if left.returncode != 0:
                            raise RuntimeError(f'{name}: holder failed to commit')
                        if denial:
                            if right.returncode != 3 or denial not in right_error:
                                raise RuntimeError(f'{name}: expected {denial}; got {right_error}')
                        elif right.returncode != 0:
                            raise RuntimeError(f'{name}: contender failed: {right_error}')
                    finally:
                        if right.poll() is None:
                            right.kill()
            finally:
                if left.poll() is None:
                    left.kill()
        actual = json.loads(query(readback))
        if actual != expected:
            raise RuntimeError(f'{name}: expected {expected}, got {actual}')
        return {'case': name, 'status': 'PASS', 'connections': connections,
                'expectedDenial': denial, 'readback': actual}

    server = json.loads(query("""
        select json_build_object('version', current_setting('server_version'),
            'tcpDisabled', current_setting('listen_addresses') = '',
            'privateSocket', inet_server_addr() is null);
    """))
    if not server['tcpDisabled'] or not server['privateSocket']:
        raise RuntimeError('Expected a private Unix socket with TCP disabled')
    query(f"""
        create role anon;
        create role authenticated;
        create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key, is_anonymous boolean default false);
        create function auth.uid() returns uuid language sql stable as $$
            select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        grant usage on schema auth to anon, authenticated, service_role;
        insert into auth.users(id) values ('{AUTHOR}'), ('{READER}');
    """)
    migrations = [
        '20261101091101_community_platform.sql',
        '20261101114038_community_storage_budget.sql',
    ]
    for filename in migrations:
        query((ROOT / 'supabase/migrations' / filename).read_text(encoding='utf-8'))

    publication = {'title': 'M3 local synthetic', 'description': 'Fixture Auth only',
                   'tags': [], 'payload_text': payload}

    def seed():
        query("""
            truncate public.usage_events, public.reports, public.workflow_likes,
                public.workflow_versions, public.community_workflows, public.profiles,
                community_private.account_budget, community_private.daily_budget;
            update community_private.control set payload_bytes = 0, payload_day_bytes = 0;
        """)
        return json.loads(query('set role service_role; ' + rpc(AUTHOR, 'publish', publication)))['id']

    cases = []
    likes_readback = """
        select json_build_object('likes', likes, 'rows', (select count(*) from public.workflow_likes))
        from public.community_workflows;
    """
    workflow = {'workflow_id': seed()}
    cases.append(check_pair(
        'simultaneous-like', rpc(AUTHOR, 'like', dict(workflow, liked=True)),
        rpc(READER, 'like', dict(workflow, liked=True)), likes_readback, {'likes': 2, 'rows': 2},
    ))
    workflow = {'workflow_id': seed()}
    cases.append(check_pair(
        'like-unlike', rpc(READER, 'like', dict(workflow, liked=True)),
        rpc(READER, 'like', dict(workflow, liked=False)), likes_readback, {'likes': 0, 'rows': 0},
    ))

    workflow = {'workflow_id': seed()}
    update = dict(publication, **workflow, expected_version=1)
    cases.append(check_pair(
        'version-conflict', rpc(AUTHOR, 'publish', dict(update, title='winner')),
        rpc(AUTHOR, 'publish', dict(update, title='stale')), """
            select json_build_object('version', current_version, 'title', title,
                'versionRows', (select count(*) from public.workflow_versions),
                'writes', (select writes from community_private.daily_budget),
                'publications', (select publications from community_private.daily_budget))
            from public.community_workflows;
        """, {'version': 2, 'title': 'winner', 'versionRows': 2, 'writes': 2, 'publications': 2},
        'Ownership, moderation or version conflict',
    ))

    event = {'workflow_id': seed(), 'version': 1, 'id': str(uuid.uuid4()), 'kind': 'view'}
    cases.append(check_pair(
        'event-idempotency', rpc(READER, 'event', event), rpc(READER, 'event', event), """
            select json_build_object('views', views, 'rows', (select count(*) from public.usage_events))
            from public.community_workflows;
        """, {'views': 1, 'rows': 1},
    ))

    workflow = {'workflow_id': seed()}
    query(f"""
        insert into community_private.account_budget
        select '{READER}', day, 239, 0 from community_private.daily_budget;
    """)
    cases.append(check_pair(
        'account-budget', rpc(READER, 'like', dict(workflow, liked=True)),
        rpc(READER, 'like', dict(workflow, liked=False)), f"""
            select json_build_object('likes', likes,
                'accountWrites', (select writes from community_private.account_budget where user_id = '{READER}'),
                'globalWrites', (select writes from community_private.daily_budget))
            from public.community_workflows;
        """, {'likes': 1, 'accountWrites': 240, 'globalWrites': 2}, 'Account daily budget reached',
    ))

    workflow = {'workflow_id': seed()}
    query('update community_private.daily_budget set writes = 19999;')
    cases.append(check_pair(
        'global-budget', rpc(AUTHOR, 'like', dict(workflow, liked=True)),
        rpc(READER, 'like', dict(workflow, liked=True)), f"""
            select json_build_object('likes', likes,
                'globalWrites', (select writes from community_private.daily_budget),
                'readerRows', (select count(*) from community_private.account_budget where user_id = '{READER}'))
            from public.community_workflows;
        """, {'likes': 1, 'globalWrites': 20000, 'readerRows': 0}, 'Global daily budget reached',
    ))

    workflow = {'workflow_id': seed()}
    edit = dict(workflow, description='', tags=[])
    cases.append(check_pair(
        'actor-isolation', rpc(AUTHOR, 'edit', dict(edit, title='owner')),
        rpc(READER, 'edit', dict(edit, title='stolen')), f"""
            select json_build_object('title', title,
                'globalWrites', (select writes from community_private.daily_budget),
                'readerRows', (select count(*) from community_private.account_budget where user_id = '{READER}'))
            from public.community_workflows;
        """, {'title': 'owner', 'globalWrites': 2, 'readerRows': 0}, 'Author required',
    ))

    seed()
    query('update community_private.control set payload_day_bytes = 2097152 - payload_bytes;')
    cases.append(check_pair(
        'snapshot-budget-rollback', rpc(AUTHOR, 'publish', publication),
        rpc(READER, 'publish', publication), """
            select json_build_object('dayBytes', payload_day_bytes,
                'storedBytes', payload_bytes,
                'workflows', (select count(*) from public.community_workflows),
                'versions', (select count(*) from public.workflow_versions),
                'profiles', (select count(*) from public.profiles),
                'accounts', (select count(*) from community_private.account_budget),
                'writes', (select writes from community_private.daily_budget),
                'publications', (select publications from community_private.daily_budget))
            from community_private.control;
        """, {'dayBytes': 2097152, 'storedBytes': len(payload.encode('utf-8')) * 2,
              'workflows': 2, 'versions': 2, 'profiles': 1, 'accounts': 1, 'writes': 2, 'publications': 2},
        'Community snapshot storage budget reached',
    ))
    return {'server': server, 'migrations': migrations, 'cases': cases}


def main():
    if sys.argv[1:] != ['--approved-wsl-temp']:
        print(json.dumps({'status': 'BLOCKED', 'reason': 'Explicit WSL temporary cluster approval required'}))
        return 2
    if not all((RUNTIME / name).is_file() for name in ('initdb', 'pg_ctl', 'psql')):
        print(json.dumps({'status': 'BLOCKED', 'reason': 'Existing local PostgreSQL runtime unavailable'}))
        return 2

    payload = json.dumps(json.load(sys.stdin), ensure_ascii=False, separators=(',', ':'))
    temp_root = Path('/tmp').resolve()
    cluster = Path(tempfile.mkdtemp(dir=temp_root, prefix='glyphforge-m3-b-'))
    data = cluster / 'data'
    socket = cluster / 'socket'
    pg_ctl = [str(RUNTIME / 'pg_ctl'), '-D', str(data)]
    env = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    env.update(PGHOST=str(socket), PGPORT='55439', PGDATABASE='postgres', PGUSER='m3_local_admin')
    try:
        socket.mkdir(mode=0o700)
        subprocess.run(
            [str(RUNTIME / 'initdb'), '-D', str(data), '-U', env['PGUSER'],
             '-A', 'trust', '--no-locale', '--encoding=UTF8'], check=True, timeout=20,
            text=True, capture_output=True, env=env,
        )
        subprocess.run(
            [*pg_ctl, '-l', str(cluster / 'server.log'), '-o',
             f"-k {socket} -p {env['PGPORT']} -c listen_addresses='' -c unix_socket_permissions=0700",
             '-t', '8', '-w', 'start'], check=True, timeout=12, text=True, capture_output=True, env=env,
        )
        report = run_checks(env, payload)
    finally:
        if (data / 'postmaster.pid').exists():
            subprocess.run([*pg_ctl, '-m', 'fast', '-t', '8', '-w', 'stop'],
                           check=True, timeout=12, text=True, capture_output=True, env=env)
        if (data / 'PG_VERSION').is_file():
            status = subprocess.run([*pg_ctl, 'status'], capture_output=True, timeout=5, env=env)
            if status.returncode != 3 or (data / 'postmaster.pid').exists():
                raise RuntimeError('PostgreSQL stop could not be verified; preserving its cluster directory')
        if (cluster.resolve() != cluster or cluster.parent != temp_root
                or not cluster.name.startswith('glyphforge-m3-b-') or cluster.stat().st_uid != os.getuid()):
            raise RuntimeError('Temporary cluster path failed cleanup validation')
        shutil.rmtree(cluster)
        if cluster.exists():
            raise RuntimeError('Temporary cluster directory still exists')
    print(json.dumps(dict(report, status='PASS_LOCAL_POSTGRES_CONCURRENCY',
                          auth='Synthetic Auth fixture', cloudRequests=0, cloudWrites=0,
                          cleanup={'stopped': True, 'tempDataRemoved': True}), indent=2))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        sys.exit(error.stderr or str(error))
