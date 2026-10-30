import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dir = "docs/p2-a";
mkdirSync(`${dir}/regression`, { recursive: true });
// Older tests still write a few fixed paths. Preserve their historical evidence byte for byte.
const historical = ["docs/p2-s0-2/worker-consistency.json", "docs/p2-s0-2/empty-resource-diagnostics.json"];
const legacy = [...historical, "docs/p1-final/resources-performance.json", "docs/p1-final/mixed-performance.json", "docs/p2-s0-1/browser-fresh-growth.json", "docs/p2-s0-1/browser-v5-growth.json", "docs/p2-s0-1/history-ui.png"];
const saved = new Map(legacy.filter(existsSync).map(p => [p, readFileSync(p)]));
const exits = [];
function run(script, args, log) {
  const r = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, GLYPHFORGE_EVIDENCE_DIR: `${dir}/regression` }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(`${dir}/${log}`, (r.stdout ?? "") + (r.stderr ?? ""));
  exits.push({ script, args, exit: r.status, error: r.error?.message });
  writeFileSync(`${dir}/check-exits.json`, JSON.stringify(exits, null, 2));
  console.log(`${log}: exit ${r.status}`);
  if (r.status !== 0) throw new Error(`Validation failed: ${dir}/${log}`);
}
try {
  run("node_modules/typescript/bin/tsc", ["--noEmit"], "typecheck.txt");
  run("node_modules/vitest/vitest.mjs", ["run"], "tests.txt");
  run("node_modules/typescript/bin/tsc", ["-b"], "build-types.txt");
  run("node_modules/vite/bin/vite.js", ["build"], "build.txt");
  const targeted = process.argv.includes("--targeted");
  run("node_modules/@playwright/test/cli.js", ["test", ...(targeted ? ["e2e/subgraphs.spec.ts"] : [])], targeted ? "browser-targeted.txt" : "browser.txt");
  copyFileSync("test-results/browser-results.json", `${dir}/${targeted ? "browser-targeted-results.json" : "browser-results.json"}`);
} finally {
  for (const [p, data] of saved) {
    if (existsSync(p) && !readFileSync(p).equals(data)) copyFileSync(p, `${dir}/regression/${p.split("/").pop()}`);
    writeFileSync(p, data);
  }
}
