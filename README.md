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

LLMs trained on public C64 code suffer two compounding problems: their
training data skews heavily toward cc65 patterns (which are common on GitHub
but not idiomatic for demo-quality work), and timing claims are routinely
wrong — raster splits at incorrect scanlines, sprite-multiplex cycle counts
that do not fit in the badline window, SID filter cutoffs that differ between
chip revisions. A model hallucinating cycle counts will produce code that
assembles cleanly and crashes at runtime.

c64-kb counters this with a curated, structured reference. 70+ markdown docs
are chunked and embedded into Qdrant for semantic retrieval, and the
entities within them — registers, KERNAL routines, memory regions, techniques,
recipes, pitfalls, and crash patterns — are materialized into a FalkorDB
knowledge graph. The graph captures relationships that flat search misses:
which registers a technique uses, which pitfalls it triggers, which recipes
implement it, whether two techniques share a register in a conflicting way.

The intended consumers are two kinds: an autonomous agent loop (ingest a
brief, synthesize a technique stack, generate code, iterate with vice-mcp
and sim6502) and a human-in-the-loop developer using Claude Code who wants
accurate, structured answers about C64 hardware and idioms rather than
training-data guesses.

---

## Current state

| Item | Value |
|------|-------|
| Phases complete | 0–6 + 7a |
| MCP tools | 22 |
| FalkorDB nodes | 538 |
| FalkorDB edges | 995 |
| Qdrant chunks | 2312 (across 70 markdown files) |
| Technique nodes | 72 (9 categories) |
| Pitfall nodes | 28 (8 categories) |
| CrashPattern nodes | 15 |
| Recipe nodes | 17 |
| KERNAL routines | 39 |
| Tests | 110 passing |
| License | BSD-3-Clause |

---

## Quick start

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

The repo ships a `.mcp.json` at the root. When you open this repository
in Claude Code it auto-discovers and connects to the MCP server without
any manual wiring.

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

A `templates/` directory (scaffolded in parallel as `templates/c64-demo-starter`
and `templates/c64-game-starter`) provides ready-to-clone starting points
that already include the `.mcp.json` wiring.

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
| `c64_technique_lookup` | Technique lookup with USES Registers/KernalRoutines + implementing recipes + REQUIRES_REGION |
| `c64_techniques_for` | List techniques filtered by category / chip / region / register / recipe |

### Compatibility and timing

| Tool | Purpose |
|------|---------|
| `c64_check_compatibility` | Graph-traversal conflict detection across a list of techniques (shared register / KERNAL / region mismatch) |
| `c64_timing_budget` | Per-scanline + per-frame cycle math for a technique on PAL or NTSC |

### Pitfalls and failure analysis

| Tool | Purpose |
|------|---------|
| `c64_pitfalls_for` | Pitfalls triggered by a register, KERNAL routine, or technique name |
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

### Resources and prompts

11 Resources are exposed at `c64://` URIs:

```
c64://memory-map          c64://kernal-jumptable      c64://vic-registers
c64://sid-registers       c64://cia-registers          c64://6510-opcodes
c64://illegal-opcodes     c64://techniques-index       c64://recipes-index
c64://pitfalls-index      c64://crash-patterns
```

2 Prompts: `c64_demo_brief` and `c64_game_brief`.

---

## Architecture

Full system diagrams and data-flow documentation: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Graph schema (11 node types, 12 edge types): [docs/ONTOLOGY.md](docs/ONTOLOGY.md).

### Components

**TypeScript MCP server** (Node 22+, ES2022 modules). Tool logic lives in
`src/tools/*.ts` as pure functions returning strings. Both the CLI and the
MCP server call the same functions — the CLI for terminal use and hooks,
the MCP server as a thin wrapper mapping MCP calls to those functions.

**Qdrant** (Docker, host port 7333): dense + sparse (BM25) hybrid vector
store. Collection `c64_docs`. Embeddings are 768-dimensional via
`mxbai-embed-large` on Ollama. Falls back to keyword-only search when
Ollama is unavailable.

**FalkorDB** (Docker, host port 7379): Redis-compatible knowledge graph.
Graph name `c64`. 11 node types (`Chip`, `Register`, `KernalRoutine`,
`MemoryRegion`, `Opcode`, `Technique`, `Recipe`, `Pitfall`, `CrashPattern`,
`ToolRecipe`, `Region`) and 12 edge types. Range indexes on all primary keys.
Two-pass ingest: node creation in pass 1, edge linking in pass 2, so walk
order does not affect edge correctness.

**Ollama** (host, port 11434): `mxbai-embed-large` for embeddings. Shared
with amiga-kb if both are running.

**SQLite** (`data/analytics.db`): query analytics and gap detection. Records
every tool call; surfaces queries with no results as gap candidates.

**70+ markdown reference docs** under `docs/`: the human-readable corpus
that drives both vector chunks and graph entity extraction.

### Ports

| Service | Host port |
|---------|-----------|
| Qdrant REST | 7333 |
| Qdrant gRPC | 7334 |
| FalkorDB | 7379 |
| Ollama (shared) | 11434 |
| Dashboard | 3939 (Phase 7b, pending) |

Ports are shifted from amiga-kb (6333/6334/6379) so both KBs can run
in parallel.

---

## Toolchain ranking

The toolchain ranking is locked as of 2026-05-16 and reflected throughout
the KB content and the `c64_toolchain_hint` bias enforcer.

**Primary: Oscar64.** Modern C/C++ compiler targeting 6502. Most recipes
in the KB are written for Oscar64. The `c64_toolchain_hint` tool defaults
to Oscar64 when no toolchain is specified. This is deliberate: LLM training
data is saturated with cc65 patterns, which are workable but not idiomatic
for demo-quality code. c64-kb exists in part to push models toward Oscar64
idioms.

**Secondary: KickAssembler.** Cycle-tight escape hatch for work where
C-level abstraction costs too many cycles: stable raster IRQs, sprite
multiplexers, FLI, scene-quality timing routines. Called from Oscar64 via
external asm linking. Deep KickAssembler recipes are present alongside
their Oscar64 equivalents.

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

c64-kb is **pure reference** — it describes what code should be. It has
no runtime or emulator access.

| Need | Tool |
|------|------|
| Memory inspection, screenshots, breakpoints, cycle counts | [vice-mcp](https://github.com/barryw/vice-mcp) |
| Unit testing C64 code without a full emulator | [sim6502](https://github.com/barryw/sim6502) |
| Reference: what code should be, hardware semantics, pitfalls | c64-kb (this repo) |

The intended agent loop: c64-kb generates the brief and code scaffold;
vice-mcp inspects runtime behaviour; sim6502 runs unit tests on hot paths.

---

## SID stylometry sub-project

A companion research strand uses the KB's execution-technique ontology
for composer stylometry across the full HVSC corpus (87,073 tunes).
The write-up is in preparation and will be linked here when it ships.

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
| `npm run ingest` | Hydrate KB from `docs/` (idempotent) |
| `npm run ingest -- --force` | Re-ingest all docs, forcing hash refresh |
| `npm test` | Run vitest (110 tests) |
| `npx tsc --noEmit` | Type check without emitting |
| `./scripts/backup.sh` | Snapshot all stateful data |

### Prerequisites

- Node.js 22+
- Docker (for Qdrant + FalkorDB)
- [Ollama](https://ollama.com/) with `mxbai-embed-large` pulled
  (optional — falls back to keyword-only search without it)

---

## Contributing

Add new reference material by dropping a markdown file into `docs/` and
running:

```bash
npm run ingest -- --force
```

The ingest pipeline will chunk the file, embed it, upsert into Qdrant,
and extract graph entities (registers, KERNAL routines, techniques,
pitfalls, recipes) into FalkorDB.

For doc structure, follow the conventions files:

- `docs/CONVENTIONS-pitfalls.md` — pitfall doc format
- `docs/CONVENTIONS-failures.md` — failure pattern doc format
- Other `docs/CONVENTIONS-*.md` — hardware, toolchain, recipe, technique
  conventions

Tests live in `test/`. Run `npm test` before committing. Run
`npx tsc --noEmit` to catch type errors.

---

## License

BSD-3-Clause.
