import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

// Historical tests write evidence in docs. Preserve those exact bytes and keep
// this run's complete log/JSON in p2-b instead of rewriting prior attestations.
fs.mkdirSync("docs/p2-b", { recursive: true });
const originals = new Map();
function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, e.name); if (file === path.join("docs", "p2-b")) continue; if (e.isDirectory()) walk(file); else originals.set(file, fs.readFileSync(file)); } }
walk("docs");
const backup = fs.mkdtempSync(path.join(os.tmpdir(), "glyphforge-p2b-evidence-"));
for (const [file, bytes] of originals) { const target = path.join(backup, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
const targeted = process.argv.includes("--targeted");
const checks = [
  ["tests", "node_modules/vitest/vitest.mjs", "run"],
  ["typecheck", "node_modules/typescript/bin/tsc", "--noEmit"],
  ["build-types", "node_modules/typescript/bin/tsc", "-b"],
  ["build", "node_modules/vite/bin/vite.js", "build"],
  ["browser", "node_modules/@playwright/test/cli.js", "test", ...(targeted ? ["e2e/mutation.spec.ts"] : [])],
];
const exits = [];
try {
  for (const [name, ...args] of checks) {
    const start = Date.now(); console.log(`Starting ${name}`);
    const result = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(`docs/p2-b/${name}.txt`, (result.stdout ?? "") + (result.stderr ?? ""));
    exits.push({ name, command: [process.execPath, ...args], exit: result.status, milliseconds: Date.now() - start, error: result.error?.message });
    console.log(`${name}: ${result.status}`);
    if (name === "browser" && fs.existsSync("test-results/browser-results.json")) fs.copyFileSync("test-results/browser-results.json", "docs/p2-b/browser-results.json");
    if (result.status !== 0) break;
  }
} finally {
  const restored = [];
  for (const [file, bytes] of originals) if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) { fs.writeFileSync(file, bytes); restored.push(file); }
  fs.writeFileSync("docs/p2-b/check-exits.json", JSON.stringify({ targeted, exits, historicalEvidenceBackup: backup, restoredHistoricalFiles: restored }, null, 2));
}
if (exits.length !== checks.length || exits.some(c => c.exit !== 0)) process.exitCode = 1;
