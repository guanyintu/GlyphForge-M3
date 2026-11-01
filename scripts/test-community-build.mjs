import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
for (const fixture of [
  { VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_FIXTURE" },
  { VITE_GITHUB_CLIENT_SECRET: "FIXTURE" },
  { GLYPHFORGE_BASE: "../escape/" },
]) {
  const r = spawnSync(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "build"],
    { env: { ...process.env, ...fixture }, encoding: "utf8" },
  );
  assert.notEqual(
    r.status,
    0,
    "unsafe configuration must fail before bundling",
  );
}
console.log("3/3 unsafe build configurations rejected before bundling");
