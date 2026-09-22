#!/usr/bin/env bash
# PostToolUse hook on Edit/MultiEdit/Write: after a src/**/*.ts edit, type-
# check and rebuild dist/, because the MCP server runs `node dist/cli.js
# serve` and would otherwise keep serving the old code without a word.
#
# Never blocks; adds context the agent sees.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  "$REPO_ROOT"/src/*.ts|"$REPO_ROOT"/scripts/*.ts) ;;
  *) exit 0 ;;
esac

cd "$REPO_ROOT"
REL="${FILE_PATH#$REPO_ROOT/}"

if ! OUT=$(npx tsc --noEmit 2>&1); then
  jq -n --arg out "$(printf '%s\n' "$OUT" | head -20)" --arg path "$REL" '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("TYPE CHECK FAILED after edit to " + $path + ":\n" + $out)
    }
  }'
  exit 0
fi

case "$REL" in
  src/*)
    if BUILD=$(npm run build 2>&1); then
      jq -n --arg path "$REL" '{
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: ("tsc clean; dist/ rebuilt after " + $path + ". A running MCP server still has the old code until it is restarted.")
        }
      }'
    else
      jq -n --arg out "$(printf '%s\n' "$BUILD" | tail -20)" --arg path "$REL" '{
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: ("BUILD FAILED after edit to " + $path + ":\n" + $out)
        }
      }'
    fi
    ;;
esac
exit 0
