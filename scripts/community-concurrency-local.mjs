// Real independent PostgreSQL processes; fixture Auth, never cloud credentials.
import {spawnSync} from 'node:child_process';
import {syntheticPayload} from './community-business-smoke.mjs';
const r=spawnSync('wsl.exe',['--exec','python3','scripts/community-concurrency-local.py'],
  {input:JSON.stringify(syntheticPayload()),encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
process.stdout.write(r.stdout||'');
if(r.status!==0 && r.status!==2)console.error('Local concurrency failed (fixture-only diagnostics):',r.stderr||r.error?.code);
process.exitCode=r.status??1;
