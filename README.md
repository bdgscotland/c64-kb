<p align="center">
  <img src="hero.png" alt="c64-kb — Commodore 64 knowledge base for AI-assisted demo and game development" width="900">
</p>

# c64-kb — Commodore 64 knowledge base for AI-assisted demo and game development

A shared reference KB served via MCP. Combines Qdrant vector search with
FalkorDB knowledge graph over C64 hardware, techniques, toolchains, and
pitfalls. Designed to power AI agent loops that design and build C64 demos
and games.

---

## The pitch

An LLM writing C64 code has two problems that compound. Its training data
is mostly cc65, which is common on GitHub and not what demo-quality work
uses. And its timing claims are wrong often enough to matter: a raster
split on the wrong line, a sprite multiplexer that does not fit the badline
window, a SID filter cutoff that differs between chip revisions. The code
assembles cleanly and tears the screen at runtime.

c64-kb is a reference built to be checked rather than trusted. Its
documents on the hardware, the techniques, the toolchains and the pitfalls
are chunked into Qdrant for semantic search, and the entities in them
(registers, KERNAL routines, memory regions, techniques, recipes, pitfalls,
crash patterns) are materialised into a FalkorDB graph. The graph answers
what flat search cannot: which registers a technique touches, which
pitfalls it triggers, which recipes implement it, what it needs from the
machine while it runs, and so which two techniques cannot share a raster
line.

Every number in it stands on a named rung: measured in VICE or read from
the ROM images, agreed by two independent documents, derived by
arithmetic, or marked unverifiable. Every code listing is built with the
toolchain it names before it lands. Recipes are re-run headless in VICE at
pinned cycles and their pictures compared pixel for pixel with the
committed screenshots. When an audit finds a page wrong, the correction is
written beside the old claim, not over it, so an agent that relied on the
old value can see what changed. The changelog says what each audit
corrected.

It is written for two readers: an agent loop that takes a brief, chooses a
technique stack, generates the code and iterates against vice-mcp and
sim6502, and a developer in Claude Code who wants an answer about the C64
that came from an instrument rather than from training data.

---

## Current state

Counts (documents, chunks, nodes, edges, recipes, tests) change with every
docs commit and are not repeated here. `npx c64-kb health` prints the live
ones from your own ingest. `VERSION` carries the data, schema and
tool-surface versions, and `CHANGELOG.md` says what each audit changed and
why. An earlier version of this section was a table of figures that went
stale within two commits.

---

## Quick start

You need Node.js 24+, Docker, and [Ollama](https://ollama.com/) with
`mxbai-embed-large` pulled. Ingest needs Ollama (it embeds every chunk and
stops if it cannot). Once ingested, querying works without it: search falls
back to keyword-only and the graph tools are unaffected.

```bash
# Start backing services (Qdrant + FalkorDB)
docker compose up -d

# Install and build
npm install
npm run build

# Hydrate the KB (first time only; idempotent thereafter)
npm run ingest

# Verify services and content
npx c64-kb health

# Start the MCP server (for Claude Code or other MCP clients)
npm run dev:serve
```

The repo ships a `.mcp.json` at the root that runs `node dist/cli.js serve`.
When you open this repository in Claude Code it discovers and connects to
the MCP server without further wiring, once `npm run build` has produced
`dist/`.

---

## Connecting another project

To wire c64-kb as an MCP server from a different repository, add
`.mcp.json` to that project's root:

```json
{
  "mcpServers": {
    "c64-kb": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/c64-kb/dist/cli.js", "serve"]
    }
  }
}
```

Substitute the real absolute path on your machine. The server must already
be built (`npm run build`) before connecting.

`templates/c64-demo-starter` and `templates/c64-game-starter` are
ready-to-copy project skeletons (Makefile, `src/`, `assets/`, a `CLAUDE.md`)
whose `.mcp.json` points at this repo's `dist/cli.js` by relative path and
carries a placeholder entry for vice-mcp.

---

## MCP tools

### Query and search

| Tool | Purpose |
|------|---------|
| `c64_health` | Service health snapshot (Qdrant / FalkorDB / Ollama / analytics) |
| `c64_search` | Hybrid semantic + keyword search across the KB |
| `c64_ingest_doc` | Ingest a single markdown file at runtime (live add) |

### Hardware reference

| Tool | Purpose |
|------|---------|
| `c64_lookup_register` | Structured register lookup by name (`D011`) or address |
| `c64_lookup_kernal` | KERNAL routine lookup with paired-routine edges |
| `c64_memory_map` | Memory region lookup by address (`$0400` or `1024`) |
| `c64_lookup_opcode` | 6510 opcode lookup (legal + illegal) |
| `c64_pal_ntsc_diff` | PAL vs NTSC differences scoped by topic |

### Toolchain

| Tool | Purpose |
|------|---------|
| `c64_toolchain_hint` | Idiomatic snippet for a (toolchain, intent) pair. Defaults to Oscar64 when toolchain is omitted (bias enforcer). |

### Recipes and techniques

| Tool | Purpose |
|------|---------|
| `c64_recipe_lookup` | Structured Recipe lookup by canonical name (e.g. `oscar64-stable-raster-irq`) |
| `c64_recipes_for` | List recipes filtered by toolchain / region / technique / file format |
| `c64_technique_lookup` | Technique lookup with USES Registers/KernalRoutines + implementing recipes + REQUIRES_REGION + REQUIRES in both directions + pitfalls it mitigates |
| `c64_techniques_for` | List techniques filtered by category / chip / region / register / recipe / requires (what builds on a technique, following the REQUIRES chain) |

### Compatibility and timing

| Tool | Purpose |
|------|---------|
| `c64_check_compatibility` | Conflict detection across a list of techniques: hard conflicts from authored resource demands (CPU every line, constant sprite set, KERNAL banked out) and region mismatch; soft ones from shared registers / KERNAL routines; runs the hard rules through each technique's REQUIRES closure (`prerequisite_conflict`) and names the prerequisites the set leans on without naming; reports what the graph does not know about each technique |
| `c64_timing_budget` | Per-scanline + per-frame cycle math for a technique on PAL or NTSC |

### Pitfalls and failure analysis

| Tool | Purpose |
|------|---------|
| `c64_pitfalls_for` | Pitfalls triggered by a register, KERNAL routine, or technique name, and the pitfalls a technique mitigates (`triggered_by[]` and `mitigated_by[]` apart) |
| `c64_failure_diagnose` | Match a symptom description against CrashPattern nodes (relevance ranked) |

### Synthesis and briefings

| Tool | Purpose |
|------|---------|
| `c64_demo_briefing` | Synthesise techniques + pitfalls + toolchain split + build order for a demo brief |
| `c64_game_briefing` | Same synthesis for a game brief; genre hint selects archetype recipe as scaffold |

### Self-improvement (Phase 7a)

| Tool | Purpose |
|------|---------|
| `c64_coverage` | Report coverage across technique categories, flag under-documented areas |
| `c64_suggest_links` | Suggest missing graph edges for a named node |
| `c64_report_gap` | Record a knowledge gap for triage |

### Evaluation

| Tool | Purpose |
|------|---------|
| `c64_run_game` | Spawn VICE (`x64sc`) on a built `.prg` through a local [vice-mcp](https://github.com/barryw/vice-mcp), drive it, and return a state trace and screen render. Needs `x64sc` on PATH and `VICE_MCP_PATH`; none of the reference tools depend on it. |

### Resources and prompts

Static resources are exposed at `c64://` URIs, each a whole reference
document as markdown, plus one template resource:

```
c64://memory-map       c64://kernal-jumptable   c64://opcodes
c64://illegal-opcodes  c64://pal-ntsc           c64://vic-ii
c64://sid              c64://cia                c64://6510-cpu
c64://registers        c64://ontology
c64://register/{name}  (structured data for one register, e.g. c64://register/D011)
```

Prompts: `c64_demo_brief` and `c64_game_brief`.

---

## Architecture

Full system diagrams and data-flow documentation: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Graph schema (node and edge types, what each means): [docs/ONTOLOGY.md](docs/ONTOLOGY.md).

### Components

**TypeScript MCP server** (Node 24+, ES2022 modules). Tool logic lives in
`src/tools/*.ts` as functions returning structured output plus text. Both
the CLI and the MCP server call the same functions — the CLI for terminal
use and hooks, the MCP server as a thin wrapper mapping MCP calls to those
functions.

**Qdrant** (Docker, host port 7333): dense + sparse (BM25) hybrid vector
store. Collection `c64_docs`. Embeddings are 1024-dimensional via
`mxbai-embed-large` on Ollama. Queries fall back to keyword-only search
when Ollama is unavailable; ingest does not.

**FalkorDB** (Docker, host port 7379): Redis-compatible knowledge graph.
Graph name `c64`. Node types for chips, regions, registers, KERNAL
routines, memory regions, techniques, recipes, pitfalls, crash patterns,
tools, file formats and machine resources; the edge types between them are
listed in `docs/ONTOLOGY.md`. Range indexes and unique constraints on every
primary key. Two-pass ingest: node
creation in pass 1, edge linking in pass 2, so walk order does not affect
edge correctness; a reference whose target does not exist is reported, not
dropped silently.

**Ollama** (host, port 11434): `mxbai-embed-large` for embeddings.

**SQLite** (`data/analytics.db`): query analytics and gap detection. Records
every tool call; surfaces queries with no results as gap candidates.

**Markdown under `docs/`**: the reference documents (hardware, techniques,
pitfalls, recipes, toolchains, formats, design) and the `CONVENTIONS-*.md`
files that define the extractable structure. The same files drive both the
vector chunks and the graph.

### Ports

| Service | Host port |
|---------|-----------|
| Qdrant REST | 7333 |
| Qdrant gRPC | 7334 |
| FalkorDB | 7379 |
| Ollama | 11434 |

Ports are shifted from the Qdrant/FalkorDB defaults (6333/6334/6379) so
another instance of either can run alongside. The Phase 7b dashboard
(planned for 3939) does not exist yet.

---

## Toolchain ranking

The toolchain ranking is locked as of 2026-05-16 and reflected throughout
the KB content and the `c64_toolchain_hint` bias enforcer.

**Primary: Oscar64.** Modern C/C++ compiler targeting 6502. Most of the
recipes are Oscar64, and the `c64_toolchain_hint` tool defaults
to Oscar64 when no toolchain is specified. This is deliberate: LLM training
data is saturated with cc65 patterns, which are workable but not idiomatic
for demo-quality code. c64-kb exists in part to push models toward Oscar64
idioms.

**Secondary: KickAssembler.** Cycle-tight escape hatch for work where
C-level abstraction costs too many cycles: stable raster IRQs, side-border
opening, FLI, sprite multiplexers. Each KickAssembler recipe is assembled,
run in VICE and measured from the screenshot; the cycle-exact ones say
which constants were measured rather than derived.

**Tertiary: cc65.** Light coverage. Text-mode utilities and niche cases
where cc65's large training-data corpus is the path of least resistance.
Do not reach for cc65 for techniques requiring cycle precision.

---

## Hardware target

**Stock Commodore 64, PAL and NTSC.**

The following are explicitly out of scope: C128, Mega65, SuperCPU, REU,
Ultimate II+. The KB documents PAL/NTSC differences thoroughly (raster
line counts, cycle budgets, timer values) but does not cover expanded
hardware.

---

## Boundaries with sibling tools

c64-kb is a **reference** — it describes what code should be. The one
tool that touches an emulator, `c64_run_game`, drives VICE through a
locally installed vice-mcp and is an evaluation primitive, not something
the reference tools use.

| Need | Tool |
|------|------|
| Memory inspection, screenshots, breakpoints, cycle counts | [vice-mcp](https://github.com/barryw/vice-mcp) |
| Unit testing C64 code without a full emulator | [sim6502](https://github.com/barryw/sim6502) |
| Reference: what code should be, hardware semantics, pitfalls | c64-kb (this repo) |

The intended agent loop: c64-kb generates the brief and code scaffold;
vice-mcp inspects runtime behaviour; sim6502 runs unit tests on hot paths.

The reference itself was checked the same way: headless `x64sc` with
`-exitscreenshot`, and the pictures measured rather than eyeballed. Timing
constants in the recipes are VICE 3.10 measurements (PAL 6569, and NTSC
6567R8 where a page says so), not bench measurements on a 6569, and each
page says so.

---

## Phase roadmap

| Phase | Description | State |
|-------|-------------|-------|
| 0 | Infrastructure (services, CLI, MCP server, ingest pipeline) | complete |
| 1 | Hardware foundation (VIC-II, SID, CIA, 6510, KERNAL, memory map, opcodes, PAL/NTSC) | complete |
| 2 | Toolchain reference + runtime docs + file formats + core recipes | complete |
| 3 | Core techniques (raster, sprite, scroll, bitmap, memory banking) | complete |
| 4 | Advanced techniques + deep recipes (effects, SID music, CPU tricks, loaders/packers) | complete |
| 5 | Pitfalls + failure patterns + briefing tools | complete |
| 6 | Art/music production + design patterns | complete |
| 7a | Analytics + self-improvement tools (coverage, suggest-links, report-gap) | complete |
| 7b | Dashboard UI (C64-native design, port 3939) | pending |
| Future | Dream/consolidation cycle, autonomous agent loop integration | — |


---

## Development

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run dev` | Run CLI via `tsx` (no build needed) |
| `npm run dev:serve` | Run MCP server via `tsx` |
| `npm run ingest` | Hydrate KB from `docs/` (incremental: unchanged files are skipped) |
| `npm run ingest:clean` / `npm run ingest -- --force` | Wipe the graph and the vector collection and re-ingest everything. Use after changing any frontmatter or metadata line: the graph merges edges and never removes one a doc stopped asserting, so an incremental run leaves stale edges behind |
| `npm test` | Run vitest against a throwaway graph (`c64_test`) and collection (`c64_docs_test`); the live stores are never touched |
| `npm run check:listings` | Build every recipe listing with its real toolchain (KickAssembler, Oscar64, cc65) and assemble every KickAssembler fragment in `docs/`; see the script header for `KICKASS_JAR` / `OSCAR64` / `CL65` |
| `npm run verify:recipes` | Build every recipe, run it headless in VICE at the cycles pinned in `docs/recipes/runs.json`, and compare the PNG pixel for pixel with the committed screenshot. `--file` scopes to one page, `--update` adopts a new baseline after a deliberate change, `--allow-missing` tolerates a recipe with no picture yet |
| `npx tsc --noEmit` | Type check without emitting |
| `npm run services` / `npm run services:stop` | Start / stop Qdrant and FalkorDB |

### Prerequisites

- Node.js 24+
- Docker (for Qdrant + FalkorDB)
- [Ollama](https://ollama.com/) with `mxbai-embed-large` pulled — required
  to ingest; optional afterwards (search falls back to keyword-only)
- To run `check:listings` locally: Java + KickAssembler 5.x, Oscar64, cc65
  (each optional; missing ones are reported, not skipped silently)

---

## Contributing

Add new reference material by dropping a markdown file into `docs/` and
running:

```bash
npm run ingest            # new or changed files only
npm run ingest:clean      # after editing frontmatter or metadata lines
```

The ingest pipeline will chunk the file, embed it, upsert into Qdrant,
and extract graph entities (registers, KERNAL routines, techniques,
pitfalls, recipes) into FalkorDB. It prints a warning for every reference
that names a node the graph does not have; fix the doc, do not ignore it.

For doc structure, follow the conventions files:

- `docs/CONVENTIONS-pitfalls.md` — pitfall doc format
- `docs/CONVENTIONS-failures.md` — failure pattern doc format
- `docs/CONVENTIONS-techniques.md` — technique doc format, including the
  `**Demands:**` vocabulary the compatibility checker reads
- Other `docs/CONVENTIONS-*.md` — hardware, toolchain, recipe conventions

Tests live in `test/`. Run `npm test` before committing. Run
`npx tsc --noEmit` to catch type errors.

Code listings are built, not just read: `npm run check:listings` assembles
or compiles every recipe with the toolchain it names and fails on any
error, and `npm test` runs the same check for whichever toolchains it can
find. A recipe that does not build does not land. `npm run verify:recipes`
then runs every recipe in VICE and fails on any pixel that differs from
the committed screenshot in `docs/recipes/<toolchain>/screenshots/`; a
listing change that changes the picture is adopted with `--update` and
explained on the page.

### Working on this repo with Claude Code

The repo carries its own harness for agents:

- `CLAUDE.md` — the rules (a listing is built before it lands; anything
  that draws is run in VICE and measured; every number names its evidence;
  corrections are recorded; metadata changes need `ingest:clean`; plain
  English; work too big for a session becomes a GitHub issue), the
  instruments with exact commands, the gates, and the gotchas that cost
  time this year.
- `.claude/settings.json` — hooks: after any edit to a `docs/**/*.md` the
  file's listings are built and the result is shown to the agent, and a
  recipe page is re-run in VICE and compared with its screenshot; a
  metadata change adds a reminder to re-ingest; `src/` edits are
  type-checked and `dist/` rebuilt; `git add -A`, `--no-verify` and
  force-pushing `main` are refused; session start reports versions, store
  health, installed toolchains and whether `docs/` changed since last time.
- `.claude/skills/` — `verify-listing` (build → headless VICE → measured
  screenshot), `audit-doc` (claim-by-claim fact-check with the evidence
  ladder), `add-doc` (a page the extractor can read, with the metadata
  that becomes edges).

Set `KICKASS_JAR` (and `OSCAR64` if it is not on PATH) in your shell so the
hooks can build listings; without them they report the gap instead of
passing silently.

---

## License

BSD-3-Clause.
