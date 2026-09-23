#!/usr/bin/env bash
# SessionStart hook: tell the agent what state the KB is in before it does
# anything — versions, whether the backing services are up and what they
# hold, whether docs/ changed since the last session (a stale graph is the
# most common way a session starts by trusting numbers the docs no longer
# say), and which instruments are installed for the verification rules.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_DIR="$REPO_ROOT/.claude/state"
mkdir -p "$STATE_DIR"
cd "$REPO_ROOT"

ver() { grep "^$1=" VERSION 2>/dev/null | cut -d= -f2 || echo "?"; }
PKG=$(jq -r .version package.json 2>/dev/null || echo "?")

if [ ! -d node_modules ]; then
  HEALTH="(node_modules missing — run npm install; health not checked)"
elif [ -f dist/cli.js ]; then
  HEALTH=$(timeout 25 node dist/cli.js health 2>/dev/null | sed -n '1,12p' || true)
else
  HEALTH=$(timeout 25 node src/cli.ts health 2>/dev/null | sed -n '1,12p' || true)
fi
[ -z "$HEALTH" ] && HEALTH="(health check did not answer — are Qdrant and FalkorDB up? npm run services)"

NOW_HASH=$(find docs -type f -name '*.md' 2>/dev/null | sort | xargs cat 2>/dev/null | shasum -a 256 | cut -d' ' -f1)
LAST_HASH=$(cat "$STATE_DIR/last-docs-hash" 2>/dev/null || echo "")
DRIFT=""
if [ -n "$LAST_HASH" ] && [ "$NOW_HASH" != "$LAST_HASH" ]; then
  DRIFT="docs/ changed since the last session on this machine; the live graph and vectors may be stale until 'npm run ingest' (or ingest:clean after metadata changes)."
fi
echo "$NOW_HASH" > "$STATE_DIR/last-docs-hash"

have() { command -v "$1" >/dev/null 2>&1 && echo "yes" || echo "no"; }
KA="${KICKASS_JAR:-}"; [ -z "$KA" ] && [ -f "$HOME/Developer/c64/kickassembler/KickAss.jar" ] && KA="$HOME/Developer/c64/kickassembler/KickAss.jar (default path; export KICKASS_JAR to use it)"
O64="${OSCAR64:-}"; [ -z "$O64" ] && command -v oscar64 >/dev/null 2>&1 && O64=$(command -v oscar64)
[ -z "$O64" ] && [ -x "$HOME/Developer/c64/oscar64/bin/oscar64" ] && O64="$HOME/Developer/c64/oscar64/bin/oscar64 (default path)"
TOOLS="KickAssembler: ${KA:-not found (set KICKASS_JAR)}; java: $(have java); oscar64: ${O64:-not found (set OSCAR64)}; cl65: $(have cl65); x64sc: $(have x64sc)"

CTX=$(cat <<EOF
## c64-kb session start

Versions: KB_DATA=$(ver KB_DATA_VERSION), KB_SCHEMA=$(ver KB_SCHEMA_VERSION), MCP_TOOL=$(ver MCP_TOOL_VERSION), package=$PKG

$HEALTH

Instruments: $TOOLS
${DRIFT:+
$DRIFT}
Rules are in CLAUDE.md. Listings are built by a hook when you edit a doc; anything that draws gets run in VICE and measured (skill: verify-listing).
EOF
)
jq -n --arg ctx "$CTX" '{ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: $ctx } }'
