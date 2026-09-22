#!/usr/bin/env bash
# PostToolUse hook on Edit/MultiEdit/Write: when a docs/**/*.md file was
# edited, build its code listings immediately and tell the agent the result.
#
# This is the gate that would have caught six of eight KickAssembler recipes
# shipping without ever having been assembled. It runs the same script as
# `npm run check:listings`, scoped to the one file, so it takes a second or
# two. Missing toolchains are reported as a warning, not a failure, so the
# hook is usable on a machine without KickAssembler installed.
#
# It also reminds the agent when a metadata line changed, because the graph
# needs `npm run ingest:clean` after that and nothing else will say so.
#
# Never blocks (PostToolUse cannot); it adds context the agent sees.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INPUT=$(cat)
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE_PATH" ] && exit 0

case "$FILE_PATH" in
  "$REPO_ROOT"/docs/*.md) ;;
  *) exit 0 ;;
esac
[ -f "$FILE_PATH" ] || exit 0

cd "$REPO_ROOT"
REL="${FILE_PATH#$REPO_ROOT/}"
CONTEXT=""

# 1. Listings in this file must build.
if grep -qE '^```(asm|kick|kickassembler|kickass|c)\b' "$FILE_PATH"; then
  if OUT=$(npx tsx scripts/check-listings.ts --allow-missing --file "$REL" 2>&1); then
    SUMMARY=$(printf '%s\n' "$OUT" | tail -1)
    CONTEXT="check-listings on $REL: $SUMMARY"
    if printf '%s' "$OUT" | grep -q 'toolchains not found'; then
      CONTEXT="$CONTEXT (a toolchain is missing on this machine — the listing was NOT built; set KICKASS_JAR / OSCAR64 / CL65 and re-run npm run check:listings before committing)"
    fi
  else
    CONTEXT="LISTING FAILED TO BUILD in $REL. Fix it before anything else; a listing that does not build does not land.
$(printf '%s\n' "$OUT" | grep -E '^FAIL|Error|error' -A3 | head -30)"
  fi
fi

# 1b. A recipe page must still draw what its committed screenshot shows.
#     verify-recipes builds the listing, runs it headless in VICE with the
#     pinned parameters (docs/recipes/runs.json) and compares the PNG
#     pixel-for-pixel with the baseline. ~3 s per recipe. A mismatch after a
#     deliberate listing change is re-baselined with --update, and the page
#     says what changed; a mismatch you did not intend is a regression.
case "$REL" in
  docs/recipes/*/*.md)
    if [ "$(basename "$REL")" != "README.md" ] && command -v x64sc >/dev/null 2>&1; then
      if VOUT=$(npx tsx scripts/verify-recipes.ts --allow-missing --file "$REL" 2>&1); then
        CONTEXT="$CONTEXT
verify-recipes on $REL: $(printf '%s\n' "$VOUT" | grep -E '^(ok  |FAIL)' | sed 's/^/  /' | head -6)"
      else
        CONTEXT="$CONTEXT
RECIPE SCREENSHOT MISMATCH in $REL — the listing no longer draws what the committed PNG shows:
$(printf '%s\n' "$VOUT" | grep -E '^FAIL' | head -6)
If the listing changed on purpose, look at the fresh PNG, run 'npx tsx scripts/verify-recipes.ts --update --file $REL', and say in the page what changed. Otherwise this is a regression."
      fi
    fi
    ;;
esac

# 2. Metadata lines feed the graph; a change needs a clean re-ingest.
if git diff --quiet -- "$REL" 2>/dev/null; then :; else
  if git diff -U0 -- "$REL" | grep -qE '^[+-](\*\*(Region|Uses registers|Uses kernal|Demands|Requires|Mitigated by techniques|Triggered by [a-z]+|Caused by [a-z]+|Likely causes|Severity|Complexity):\*\*|(techniques|uses_registers|uses_kernal|file_formats|region|toolchain|recipe|category|chip):)'; then
    CONTEXT="$CONTEXT
Metadata changed in $REL: run 'npm run ingest:clean' before committing (MERGE never removes an edge the doc stopped asserting) and read the summary line for dropped references."
  fi
fi

[ -z "$CONTEXT" ] && exit 0
jq -n --arg ctx "$CONTEXT" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
