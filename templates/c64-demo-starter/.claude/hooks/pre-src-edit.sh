#!/bin/bash
# PreToolUse hook: block Edit/MultiEdit/Write of src/**/*.c (and *.asm)
# until the project has been briefed by the c64-kb MCP.
#
# The agent must call c64_game_briefing() / c64_demo_briefing() + any
# c64_pitfalls_for() / c64_technique_lookup() / c64_recipe_lookup() that
# the briefing implies, then `touch .kb-briefing-done` to record that
# the briefing was actually consumed.
#
# This is the "teeth" behind the template's CLAUDE.md "First thing to do
# as an agent" instruction. Without this hook, agents (including Claude
# itself) silently skip the briefing and write code from intuition.
#
# Exit codes:
#   0 — allow the tool call (silent success)
#   2 — block the tool call; stderr is shown to the agent as the reason

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MARKER="$REPO_ROOT/.kb-briefing-done"

# Allow the bypass if the marker exists — agent has acknowledged the briefing.
if [ -f "$MARKER" ]; then
    exit 0
fi

# Read tool input JSON from stdin
INPUT=$(cat)

TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty')
FILE_PATH=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only act on Edit / MultiEdit / Write
case "$TOOL_NAME" in
    Edit|MultiEdit|Write) ;;
    *) exit 0 ;;
esac

# Only act on files under src/ (any extension) — design / docs / configs are fine.
if [ -z "$FILE_PATH" ]; then exit 0; fi
case "$FILE_PATH" in
    "$REPO_ROOT"/src/*) ;;
    *) exit 0 ;;
esac

# Block: emit a message that tells the agent exactly what to do.
cat >&2 <<EOF
BLOCKED: writes under src/ are disabled until the c64-kb has been briefed
for this project.

Required steps before editing source:
  1. Call c64_demo_briefing("<your concept>")
     .
  2. For each technique the briefing proposes, call c64_technique_lookup(name)
     and c64_pitfalls_for(name). Read what comes back.
  3. For the build_order's seed recipes, call c64_recipe_lookup(name).
  4. Once you have actually read the briefing + pitfalls + recipes,
     create the marker file to record that the briefing was consumed:
         touch $MARKER

The marker exists so this hook can tell the difference between "agent
read the KB and decided" vs "agent skipped the KB and started typing".

If you genuinely need to bypass (e.g. trivial typo fix), create the
marker with a one-line reason inside:
    echo "bypass: <reason>" > $MARKER

Reason for the gate: c64-kb has technique + pitfall coverage for
common C64 game-rendering bug classes (e.g. text_mode_overlay_render
+ dirty_cell_skip_leaves_overlay_trail). Skipping the briefing means
re-discovering those bugs by hand.
EOF
exit 2
