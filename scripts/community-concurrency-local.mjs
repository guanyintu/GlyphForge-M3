// Real independent PostgreSQL processes; fixture Auth, never cloud credentials.
import { spawnSync } from 'node:child_process';
import { syntheticPayload } from './community-business-smoke.mjs';

const result = spawnSync(
  'wsl.exe', ['--exec', 'python3', 'scripts/community-concurrency-local.py', ...process.argv.slice(2)],
  { input: JSON.stringify(syntheticPayload()), encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 },
);
process.stdout.write(result.stdout || '');
if (result.status !== 0 && result.status !== 2) {
  console.error('Local concurrency failed (fixture-only diagnostics):', result.stderr || result.error?.code);
}
process.exitCode = result.status ?? 1;
