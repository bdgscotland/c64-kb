#!/bin/sh
# plan-gate.sh: no source is written and nothing is built until PLAN.md holds
# the c64-kb output the plan was made from.
#
#   plan-gate.sh --check PLAN.md    make's gate: exit 0 when the plan is filled, 1 when not
#   plan-gate.sh                    Claude Code PreToolUse hook: reads the tool call as JSON
#                                   on stdin; exit 2 blocks a write under src/ while the
#                                   plan is not filled, exit 0 allows everything else
#
# "Filled" means: PLAN.md exists, has no "FILL:" placeholder left, and holds
# the pasted output of `check-compatibility` (a line starting "# Compatibility:")
# and of `plan-budget` (a line starting "# Budget plan:"). This replaces the old
# .kb-briefing-done marker, which `touch` satisfied without reading anything.

plan_problems() {
    plan=$1
    if [ ! -f "$plan" ]; then
        echo "  $plan does not exist: copy it from the harness's PLAN.md.template"
        return
    fi
    n=$(grep -c 'FILL:' "$plan")
    [ "$n" -gt 0 ] && echo "  $plan still has $n FILL: placeholder(s)"
    grep -q '^# Compatibility:' "$plan" || echo "  $plan has no check-compatibility output (a line starting '# Compatibility:')"
    grep -q '^# Budget plan:' "$plan" || echo "  $plan has no plan-budget output (a line starting '# Budget plan:')"
}

how_to() {
    cat <<'EOF'
Fill PLAN.md from the c64-kb tools before writing code (run them in the c64-kb checkout):
  npx tsx src/cli.ts game-briefing "<concept>" --archetype <name>
  npx tsx src/cli.ts check-compatibility <technique> <technique> ...
  npx tsx src/cli.ts plan-budget <technique> <technique:transition> ...
Paste each output, whole, into its section of PLAN.md, and replace every FILL: line.
EOF
}

if [ "$1" = "--check" ]; then
    problems=$(plan_problems "${2:-PLAN.md}")
    if [ -n "$problems" ]; then
        echo "plan-gate: the plan is not filled, so nothing is built."
        echo "$problems"
        how_to
        echo "(Deliberate override: make PLAN_GATE=off)"
        exit 1
    fi
    exit 0
fi

# ---- hook mode -------------------------------------------------------------------
root=${CLAUDE_PROJECT_DIR:-$(pwd)}
input=$(cat)
path=$(printf '%s' "$input" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
if d.get("tool_name") in ("Edit", "MultiEdit", "Write", "NotebookEdit"):
    t = d.get("tool_input") or {}
    print(t.get("file_path") or t.get("notebook_path") or "")
' 2>/dev/null)
[ -z "$path" ] && exit 0
case "$path" in
    /*) ;;
    *) path="$root/$path" ;;
esac
case "$path" in
    "$root"/src/*) ;;
    *) exit 0 ;;
esac
problems=$(plan_problems "$root/PLAN.md")
[ -z "$problems" ] && exit 0
{
    echo "BLOCKED: writes under src/ wait until PLAN.md is filled."
    echo "$problems"
    how_to
} >&2
exit 2
