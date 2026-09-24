#!/usr/bin/env bash
# PostToolUse hook on Edit/Write of a .ts file: format it, lint it, and
# type-check the project, then tell the agent what failed so it fixes it in
# the same turn. Per-file and fast; the build and the unit tests run once
# per turn in stop-gate.sh.
#
# Never blocks (PostToolUse cannot undo an edit); it adds context the agent sees.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  "$REPO_ROOT"/src/*.ts|"$REPO_ROOT"/scripts/*.ts|"$REPO_ROOT"/test/*.ts) ;;
  *) exit 0 ;;
esac
[ -f "$FILE_PATH" ] || exit 0

cd "$REPO_ROOT"
REL="${FILE_PATH#"$REPO_ROOT"/}"
BIN="$REPO_ROOT/node_modules/.bin"
[ -x "$BIN/tsc" ] || exit 0   # no node_modules: nothing to run (npx tsc would fetch an unrelated package)

REPORT=""
[ -x "$BIN/prettier" ] && "$BIN/prettier" --write --log-level=warn "$REL" >/dev/null 2>&1 || true
if [ -x "$BIN/eslint" ]; then
  if ! LINT=$("$BIN/eslint" --max-warnings=0 "$REL" 2>&1); then
    REPORT+="LINT FAILED in $REL:"$'\n'"$(printf '%s\n' "$LINT" | head -30)"$'\n'
  fi
fi
if ! TSC=$("$BIN/tsc" -p tsconfig.json 2>&1); then
  REPORT+="TYPE CHECK FAILED after edit to $REL:"$'\n'"$(printf '%s\n' "$TSC" | head -20)"$'\n'
fi

[ -z "$REPORT" ] && exit 0
jq -n --arg ctx "$REPORT" '{
  hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $ctx }
}'
exit 0
