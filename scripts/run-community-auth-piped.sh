#!/usr/bin/env bash
# Receives a single JSON value through a one-use local pipe from Windows DPAPI.
# Secrets do not enter argv, shell history, or the process environment.
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="$HOME/.cache/glyphforge-m3-auth-smoke/publishable_key"
if [[ ! -r "$KEY_FILE" ]] || ! command -v node >/dev/null 2>&1; then
  printf 'BLOCKED: local public key or Node.js runtime unavailable.\n' >&2
  exit 2
fi
if [[ -t 0 ]]; then
  printf 'BLOCKED: credentials must arrive through the secure local pipe.\n' >&2
  exit 2
fi
GLYPHFORGE_M3_PUBLISHABLE_KEY="$(<"$KEY_FILE")"
if [[ "$GLYPHFORGE_M3_PUBLISHABLE_KEY" != sb_publishable_* ]]; then
  printf 'BLOCKED: invalid test-project publishable key.\n' >&2
  exit 2
fi
export GLYPHFORGE_M3_PUBLISHABLE_KEY
trap 'unset GLYPHFORGE_M3_PUBLISHABLE_KEY' EXIT
RESULT_FILE="$(dirname -- "$KEY_FILE")/latest-result.json"
node "$ROOT/scripts/community-auth-smoke.mjs" --accounts-stdin --confirm-target rsntccggnvmuazvpxstf | tee "$RESULT_FILE"
