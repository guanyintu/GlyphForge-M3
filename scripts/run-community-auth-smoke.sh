#!/usr/bin/env bash
# Interactive-only wrapper. Run from a trusted, local terminal, never via remote input.
set -euo pipefail
umask 077
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="${GLYPHFORGE_M3_PUBLIC_KEY_FILE:-$HOME/.cache/glyphforge-m3-auth-smoke/publishable_key}"

if [[ ! -r "$KEY_FILE" ]]; then
  printf 'BLOCKED: local test publishable key was not prepared.\n' >&2
  exit 2
fi
if [[ ! -t 0 ]]; then
  printf 'BLOCKED: this launcher requires a local interactive terminal.\n' >&2
  exit 2
fi
if ! command -v node >/dev/null 2>&1; then
  printf 'BLOCKED: Node.js is unavailable.\n' >&2
  exit 2
fi
GLYPHFORGE_M3_PUBLISHABLE_KEY="$(<"$KEY_FILE")"
if [[ "$GLYPHFORGE_M3_PUBLISHABLE_KEY" != sb_publishable_* ]]; then
  printf 'BLOCKED: invalid publishable key.\n' >&2
  exit 2
fi
export GLYPHFORGE_M3_PUBLISHABLE_KEY

read -r -p "Test account A email: " GLYPHFORGE_M3_A_EMAIL
read -r -s -p "Test account A password (hidden): " GLYPHFORGE_M3_A_PASSWORD
printf '\n'
read -r -p "Test account B email: " GLYPHFORGE_M3_B_EMAIL
read -r -s -p "Test account B password (hidden): " GLYPHFORGE_M3_B_PASSWORD
printf '\n'
export GLYPHFORGE_M3_A_EMAIL GLYPHFORGE_M3_A_PASSWORD GLYPHFORGE_M3_B_EMAIL GLYPHFORGE_M3_B_PASSWORD
trap 'unset GLYPHFORGE_M3_PUBLISHABLE_KEY GLYPHFORGE_M3_A_EMAIL GLYPHFORGE_M3_A_PASSWORD GLYPHFORGE_M3_B_EMAIL GLYPHFORGE_M3_B_PASSWORD' EXIT
printf 'Running bounded read-only Auth verification against dedicated test project...\n'
RESULT_FILE="$(dirname -- "$KEY_FILE")/latest-result.json"
: > "$RESULT_FILE"
node "$ROOT/scripts/community-auth-smoke.mjs" --accounts --confirm-target rsntccggnvmuazvpxstf | tee "$RESULT_FILE"
