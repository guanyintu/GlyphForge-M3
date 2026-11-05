#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="$HOME/.cache/glyphforge-m3-auth-smoke/publishable_key"
if [[ -t 0 || ! -r "$KEY_FILE" ]] || ! command -v node >/dev/null 2>&1; then
  printf 'BLOCKED: one-use pipe, local publishable key and Node required.\n' >&2
  exit 2
fi
GLYPHFORGE_M3_PUBLISHABLE_KEY="$(<"$KEY_FILE")"
export GLYPHFORGE_M3_PUBLISHABLE_KEY
trap 'unset GLYPHFORGE_M3_PUBLISHABLE_KEY' EXIT
mkdir -p "$HOME/.cache/glyphforge-m3-business-smoke"
node "$ROOT/scripts/community-business-smoke.mjs" --accounts-stdin --confirm-target rsntccggnvmuazvpxstf | tee "$HOME/.cache/glyphforge-m3-business-smoke/latest-result.json"
