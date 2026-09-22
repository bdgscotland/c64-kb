#!/usr/bin/env bash
# PreToolUse hook on Bash: refuse the few commands that have cost this repo
# data or credibility. Deterministic — CLAUDE.md says the same things, and
# text-only rules get skipped under pressure.
#
# Refused:
#   git add -A / git add . / git add --all        stages data/, scratch, dist/
#   git commit --no-verify                        skips whatever gates exist
#   git push --force to main                      rewrites a public history
#   rm -rf docs / rm -rf src                      no
#
# Exit 0 with a JSON deny decision to block; exit 0 silently to allow.
set -euo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty')
[ -z "$CMD" ] && exit 0

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

if printf '%s' "$CMD" | grep -qE '(^|[;&|]\s*)git\s+add\s+(-A|--all|\.)(\s|$)'; then
  deny "Refused: 'git add -A' / 'git add .' stages data/, dist/, .claude/state/ and scratch files. Stage named paths (CLAUDE.md rule 6)."
fi
if printf '%s' "$CMD" | grep -qE 'git\s+commit[^;&|]*--no-verify'; then
  deny "Refused: --no-verify skips the gates. Run npm run check:listings, npx tsc --noEmit and npm test, then commit normally."
fi
if printf '%s' "$CMD" | grep -qE 'git\s+push[^;&|]*(-f|--force)([^-]|$)[^;&|]*\b(main|master)\b'; then
  deny "Refused: force-pushing main rewrites a public history that other people have cloned."
fi
if printf '%s' "$CMD" | grep -qE 'rm\s+-rf?\s+(\./)?(docs|src|test)(/|\s|$)'; then
  deny "Refused: that deletes the knowledge base or its code. If you mean it, ask the maintainer."
fi

exit 0
