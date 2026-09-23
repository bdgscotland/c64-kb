#!/usr/bin/env bash
# Stop hook: when TypeScript changed during the turn, rebuild dist/ (the MCP
# server runs `node dist/cli.js serve`) and run the unit tests, once. A
# failure keeps the turn open (exit 2, reason on stderr) so the agent fixes
# it before handing back. Integration tests need Qdrant and FalkorDB and
# stay a pre-commit gate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT=$(cat)
# Already continuing because of this hook: do not block twice in a row.
[ "$(printf '%s' "$INPUT" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0

cd "$REPO_ROOT"
BIN="$REPO_ROOT/node_modules/.bin"
[ -x "$BIN/tsc" ] || exit 0

STATE_DIR="$REPO_ROOT/.claude/state"
mkdir -p "$STATE_DIR"
STAMP="$STATE_DIR/last-ts-hash"
HASH=$( { git diff HEAD -- '*.ts' 'tsconfig*.json' package.json; git ls-files -o --exclude-standard -- '*.ts' | xargs -r cat; } | shasum | cut -d' ' -f1)
[ -f "$STAMP" ] && [ "$(cat "$STAMP")" = "$HASH" ] && exit 0

FAIL=""
if ! OUT=$(npm run -s build 2>&1); then
  FAIL+="BUILD FAILED:"$'\n'"$(printf '%s\n' "$OUT" | tail -20)"$'\n'
fi
if ! OUT=$("$BIN/vitest" run --project unit --reporter=dot 2>&1); then
  FAIL+="UNIT TESTS FAILED:"$'\n'"$(printf '%s\n' "$OUT" | tail -30)"$'\n'
fi

if [ -n "$FAIL" ]; then
  printf '%s' "$FAIL" >&2
  exit 2
fi
printf '%s' "$HASH" > "$STAMP"
exit 0
