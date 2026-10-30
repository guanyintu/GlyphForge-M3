import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const dir = "docs/p2-s0-1";
mkdirSync(`${dir}/regression`, { recursive: true });
const legacyEvidence = [
  "docs/p1-final/resources-performance.json", "docs/p1-final/mixed-performance.json",
];
const saved = new Map(legacyEvidence.filter(existsSync).map(path => [path, readFileSync(path)]));
const targeted = process.argv.includes("--targeted");
function run(script, args, log) {
  const result = spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, GLYPHFORGE_EVIDENCE_DIR: `${dir}/regression` }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
  });
  writeFileSync(`${dir}/${log}`, (result.stdout ?? "") + (result.stderr ?? ""));
  console.log(`${log}: exit ${result.status}`);
  if (result.status !== 0) throw new Error(`Validation failed; see ${dir}/${log}`);
}
try {
  run("node_modules/typescript/bin/tsc", ["--noEmit"], "typecheck.txt");
  run("node_modules/vitest/vitest.mjs", ["run"], "tests.txt");
  run("node_modules/typescript/bin/tsc", ["-b"], "build-types.txt");
  run("node_modules/vite/bin/vite.js", ["build"], "build.txt");
  run("node_modules/@playwright/test/cli.js", ["test", ...(targeted ? ["e2e/run-lifecycle.spec.ts"] : [])], targeted ? "browser-targeted.txt" : "browser.txt");
  copyFileSync("test-results/browser-results.json", `${dir}/${targeted ? "browser-targeted-results.json" : "browser-results.json"}`);
} finally {
  for (const [path, bytes] of saved) {
    if (existsSync(path) && !readFileSync(path).equals(bytes)) copyFileSync(path, `${dir}/regression/${path.split("/").pop()}`);
    writeFileSync(path, bytes);
  }
}
