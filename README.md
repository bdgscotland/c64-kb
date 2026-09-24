<p align="center">
  <img src="hero.png" alt="c64-kb — Commodore 64 knowledge base for AI-assisted development" width="900">
</p>

# c64-kb — Commodore 64 knowledge base for AI-assisted development

A shared reference KB served via MCP. Combines Qdrant vector search with
FalkorDB knowledge graph over C64 hardware, techniques, toolchains, and
pitfalls. Designed to power AI agent loops that build C64 software: games,
demos, tools, anything on the stock machine.

---

## The pitch

Coding models know the Commodore 64 from training data. Much of it is
copied listings and forum posts, and its timing figures are often wrong.
A model has no way to tell a measured figure from a repeated one.

c64-kb is a reference for the stock C64 that an agent can query while it
works. It covers the hardware, the techniques, the toolchains, the
recipes and the pitfalls. Each number states its source: measured in
VICE, read from the ROM images, agreed by independent documents, derived
by arithmetic, or marked unverifiable. Each code listing is built with the
toolchain it names before it lands. Recipes are re-run headless in VICE
and the picture is compared pixel for pixel with the committed
screenshot. When an audit finds a page wrong, the correction is written
beside the old claim and the old claim stays visible.

The pages are indexed in two ways. Qdrant stores them as chunks for
semantic search. FalkorDB stores the things in them as a graph:
registers, KERNAL routines, memory regions, techniques, recipes,
pitfalls, crash patterns, and their relations. The graph answers
questions search cannot: which registers a technique touches, which
pitfalls it triggers, which recipes implement it, what it needs from the
machine while it runs, and which techniques cannot share a raster line.

Both indexes are served over MCP. The intended users are an agent loop
that takes a brief, chooses techniques, writes the code and tests it in
an emulator, and a developer who wants a C64 answer with a source behind
it.

---

## What the recipes draw

Every picture below is the committed screenshot of a recipe, taken by the
verifier from the listing on the page at a pinned cycle count; a later
run that differs by one pixel fails the gate.

<table>
<tr>
<td align="center"><a href="docs/recipes/kickassembler/cracktro-template.md"><img src="docs/recipes/kickassembler/screenshots/cracktro-template.png" width="220" alt="Cracktro template: logo, raster bars, sine scroller"></a><br><sub>Cracktro template</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/sideborder-open.md"><img src="docs/recipes/kickassembler/screenshots/sideborder-open.png" width="220" alt="Side border opened with sprites in it"></a><br><sub>Side border open</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/sprite-multiplex-24.md"><img src="docs/recipes/kickassembler/screenshots/sprite-multiplex-24.png" width="220" alt="24 sprites from eight hardware slots"></a><br><sub>24-sprite multiplexer</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/fli-image.md"><img src="docs/recipes/kickassembler/screenshots/fli-image.png" width="220" alt="FLI image with the three grey columns"></a><br><sub>FLI</sub></td>
</tr>
<tr>
<td align="center"><a href="docs/recipes/oscar64/tile-map-render.md"><img src="docs/recipes/oscar64/screenshots/tile-map-render.png" width="220" alt="RLE-compressed metatile map decoded to the screen"></a><br><sub>Tile map from RLE</sub></td>
<td align="center"><a href="docs/recipes/oscar64/text-overlay-playfield.md"><img src="docs/recipes/oscar64/screenshots/text-overlay-playfield.png" width="220" alt="Text-mode playfield with a falling piece"></a><br><sub>Text-mode playfield</sub></td>
<td align="center"><a href="docs/recipes/oscar64/simple-shmup.md"><img src="docs/recipes/oscar64/screenshots/simple-shmup.png" width="220" alt="Vertical shmup with starfield and enemies"></a><br><sub>Simple shmup</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/colour-fade.md"><img src="docs/recipes/kickassembler/screenshots/colour-fade.png" width="220" alt="Luminance fade caught mid-way"></a><br><sub>Luminance fade, step 9</sub></td>
</tr>
<tr>
<td align="center"><a href="docs/recipes/kickassembler/wireframe-ships.md"><img src="docs/recipes/kickassembler/screenshots/wireframe-ships.png" width="220" alt="Three rotating wireframe objects, clipped at the edge, and a galaxy readout"></a><br><sub>Wireframe ships and Elite's galaxy</sub></td>
<td align="center"><a href="docs/recipes/oscar64/ghost-targeting.md"><img src="docs/recipes/oscar64/screenshots/ghost-targeting.png" width="220" alt="Maze with four ghosts steered by target tiles"></a><br><sub>Maze-chase ghost targeting</sub></td>
<td align="center"><a href="docs/recipes/oscar64/cave-scan.md"><img src="docs/recipes/oscar64/screenshots/cave-scan.png" width="220" alt="Boulder Dash style cave after the scan"></a><br><sub>Cave scan: falling and rolling</sub></td>
<td align="center"><a href="docs/recipes/oscar64/platformer-scaffold.md"><img src="docs/recipes/oscar64/screenshots/platformer-scaffold.png" width="220" alt="Single-screen platformer with ladders and a HUD"></a><br><sub>Platformer scaffold</sub></td>
</tr>
<tr>
<td align="center"><a href="docs/recipes/kickassembler/scroll-panel-split.md"><img src="docs/recipes/kickassembler/screenshots/scroll-panel-split.png" width="220" alt="Vertically scrolling playfield above a fixed score panel"></a><br><sub>Scroll with a fixed panel</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/sprite-multiplex-game.md"><img src="docs/recipes/kickassembler/screenshots/sprite-multiplex-game.png" width="220" alt="24 actors from eight sprites, with sort and IRQ timings"></a><br><sub>Game multiplexer, 24 actors</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/big-font-scroller.md"><img src="docs/recipes/kickassembler/screenshots/big-font-scroller.png" width="220" alt="2x2 big font with measured cycle counts"></a><br><sub>2x2 big font</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/dycp-scroller.md"><img src="docs/recipes/kickassembler/screenshots/dycp-scroller.png" width="220" alt="DYCP scroller: each character at its own height"></a><br><sub>DYCP scroller</sub></td>
</tr>
<tr>
<td align="center"><a href="docs/recipes/kickassembler/isometric-room.md"><img src="docs/recipes/kickassembler/screenshots/isometric-room.png" width="220" alt="Isometric room of diamond tiles and blocks with a sprite player"></a><br><sub>Isometric room</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/fire-effect.md"><img src="docs/recipes/kickassembler/screenshots/fire-effect.png" width="220" alt="Colour-RAM fire with a luminance-ordered palette"></a><br><sub>Colour-RAM fire</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/dot-flag.md"><img src="docs/recipes/kickassembler/screenshots/dot-flag.png" width="220" alt="A grid of dots on two sines"></a><br><sub>Dot flag</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/dypp-sprite-scroller.md"><img src="docs/recipes/kickassembler/screenshots/dypp-sprite-scroller.png" width="220" alt="Sprite scroller with each letter on its own sine"></a><br><sub>DYPP sprite scroller</sub></td>
</tr>
<tr>
<td align="center"><a href="docs/recipes/kickassembler/mci-interlace.md"><img src="docs/recipes/kickassembler/screenshots/mci-interlace.png" width="220" alt="Multicolour interlace test card, one field"></a><br><sub>Multicolour interlace, one field</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/sprite-priority-classes.md"><img src="docs/recipes/kickassembler/screenshots/sprite-priority-classes.png" width="220" alt="Sprite priority classes against a character playfield"></a><br><sub>Sprite priority classes</sub></td>
<td align="center"><a href="docs/recipes/oscar64/beat-em-up-lanes.md"><img src="docs/recipes/oscar64/screenshots/beat-em-up-lanes.png" width="220" alt="Beat-em-up lanes with fighters sorted by depth"></a><br><sub>Beat-em-up lanes</sub></td>
<td align="center"><a href="docs/recipes/oscar64/bitmap-koala-viewer.md"><img src="docs/recipes/oscar64/screenshots/bitmap-koala-viewer.png" width="220" alt="Koala bitmap viewer showing a generated test picture"></a><br><sub>Koala viewer</sub></td>
</tr>
<tr>
<td align="center"><a href="docs/recipes/oscar64/vehicle-control.md"><img src="docs/recipes/oscar64/screenshots/vehicle-control.png" width="220" alt="Car on a scrolling road with verges and water"></a><br><sub>Vehicle control</sub></td>
<td align="center"><a href="docs/recipes/oscar64/car-contact.md"><img src="docs/recipes/oscar64/screenshots/car-contact.png" width="220" alt="Cars pushing each other off the road"></a><br><sub>Car contact and push</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/twister.md"><img src="docs/recipes/kickassembler/screenshots/twister.png" width="220" alt="Twister bar of sprites"></a><br><sub>Twister</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/tech-tech.md"><img src="docs/recipes/kickassembler/screenshots/tech-tech.png" width="220" alt="Tech-tech logo waving line by line"></a><br><sub>Tech-tech</sub></td>
</tr>
<tr>
<td align="center"><a href="docs/recipes/oscar64/destructible-terrain.md"><img src="docs/recipes/oscar64/screenshots/destructible-terrain.png" width="220" alt="Terrain dug and built by walking creatures"></a><br><sub>Destructible terrain</sub></td>
<td align="center"><a href="docs/recipes/oscar64/adventure-engine.md"><img src="docs/recipes/oscar64/screenshots/adventure-engine.png" width="220" alt="Text adventure played to its ending"></a><br><sub>Adventure engine</sub></td>
<td align="center"><a href="docs/recipes/oscar64/falling-blocks.md"><img src="docs/recipes/oscar64/screenshots/falling-blocks.png" width="220" alt="Falling-blocks board with score and timings"></a><br><sub>Falling blocks</sub></td>
<td align="center"><a href="docs/recipes/kickassembler/sprite-border-scroller.md"><img src="docs/recipes/kickassembler/screenshots/sprite-border-scroller.png" width="220" alt="Sprite scroller in the lower border"></a><br><sub>Scroller in the border</sub></td>
</tr>
</table>

## What the starters play

Each starter in `templates/` is a small game that plays. `npm run new-project -- <starter> <dir>`
makes a working project from one; `make run` opens it in VICE. Each picture is a PAL
screenshot its own checks grade, with the verdict and the frame meter on screen.

<table>
<tr>
<td align="center"><a href="templates/shmup-vertical/README.md"><img src="docs/figures/starters/shmup-vertical.png" width="220" alt="Vertical shooter over a fixed score panel, enemies in a wave"></a><br><sub>Vertical shooter</sub></td>
<td align="center"><a href="templates/platformer/README.md"><img src="docs/figures/starters/platformer.png" width="220" alt="Side-scrolling platformer with a walker, a hill and a HUD"></a><br><sub>Scrolling platformer</sub></td>
<td align="center"><a href="templates/action-puzzle/README.md"><img src="docs/figures/starters/action-puzzle.png" width="220" alt="Boulder Dash style cave with the high-score table"></a><br><sub>Boulder Dash-style cave</sub></td>
<td align="center"><a href="templates/adventure/README.md"><img src="docs/figures/starters/adventure.png" width="220" alt="Text adventure at its ending: the telescope, the comet and the score"></a><br><sub>Text adventure</sub></td>
</tr>
<tr>
<td align="center"><a href="templates/demo/README.md"><img src="docs/figures/starters/demo.png" width="220" alt="Demo part: logo, sprite sine chain, stable raster bars and a scroller"></a><br><sub>Demo (KickAssembler)</sub></td>
<td align="center"><a href="templates/beat-em-up/README.md"><img src="docs/figures/starters/beat-em-up.png" width="220" alt="Beat-em-up street fight: the hero, two thugs and a character-drawn brute"></a><br><sub>Beat-em-up</sub></td>
</tr>
</table>

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

You need Node.js 24.12+, Docker, and [Ollama](https://ollama.com/) with
`mxbai-embed-large` pulled. Ingest needs Ollama (it embeds every chunk and
stops if it cannot). Once ingested, querying works without it: search falls
back to keyword-only and the graph tools are unaffected.

### From npm

```bash
npm install -g c64-kb
ollama pull mxbai-embed-large

c64-kb services up        # Qdrant (port 7333) and FalkorDB (7379) in Docker
c64-kb ingest             # builds both stores from the docs in the package; a few minutes
c64-kb health             # what the stores hold

claude mcp add c64-kb -- c64-kb serve    # connect Claude Code
```

State (the analytics database, BM25 vocabulary, ingest hashes, and the
containers' volumes) goes to `$XDG_DATA_HOME/c64-kb`, else
`~/.local/share/c64-kb`; set `C64_KB_DATA_DIR` to put it elsewhere. After
upgrading the package, run `c64-kb ingest --clean` so the stores match the
new docs. `c64-kb services down` stops the containers and keeps their data.

### From a clone

```bash
# Start backing services (Qdrant + FalkorDB)
docker compose up -d

# Install and build
npm install
npm run build

# Hydrate the KB (first time only; idempotent thereafter)
npm run ingest

# Verify services and content
npm run health

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

To start a C64 project from a playable starter (see "What the starters
play" above), run `npm run new-project -- <starter> <dir>` in this checkout.
It copies the starter and the shared harness (`templates/_harness/`), and
writes `.mcp.json` with this checkout's absolute `dist/cli.js` path. It then
runs the starter's headless check to prove the copy works.

The starters are `shmup-vertical`, `platformer`, `action-puzzle`,
`adventure`, `beat-em-up` and `demo` (KickAssembler), plus
two minimal ones: `hello` (C calling assembly) and `hello-kick`
(KickAssembler only). In each new project:
- `make run` opens it in VICE;
- `make shot check` runs it headless on PAL and NTSC and grades the
  screenshots;
- `make disk` builds a `.d64`.

Nothing builds until `PLAN.md` holds the KB's compatibility and budget
output. `docs/workflow/agent-harness.md` explains the loop.
The two stub skeletons that were here before, `c64-demo-starter` and
`c64-game-starter`, were removed when the demo starter landed (#39).

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
| `c64_timing_budget` | Per-scanline cycle math for one technique on PAL or NTSC: badline, IRQ entry and sprite DMA losses |
| `c64_plan_budget` | A list of techniques, each in a phase (play, transition, init), added up against a PAL or NTSC frame: a cycle range from measured typical and worst frames, figures left out and why (multi-frame, included in another figure, inside a raster band), the members with no figure and the recipe to measure each on, and a fits / over / undetermined verdict. Given a game design name instead, it budgets that game's phases and sets its measured frame beside the prediction |

### Pitfalls and failure analysis

| Tool | Purpose |
|------|---------|
| `c64_pitfalls_for` | Pitfalls triggered by a register, KERNAL routine, or technique name, and the pitfalls a technique mitigates (`triggered_by[]` and `mitigated_by[]` apart) |
| `c64_failure_diagnose` | Match a symptom description against CrashPattern nodes (relevance ranked) |
| `c64_lint_source` | Run the pitfall rules over your own C or assembly source; one finding per site, each named after the pitfall it compiles and pointing at its page |

**Linting your source against the pitfalls.** `c64_lint_source` (CLI:
`npx c64-kb lint game.c`, `--json` for the structured form) is the
pitfall pages compiled into text rules: a read or read-modify-write of a
SID register, `$DC02` cleared and never restored, an empty-name OPEN of
channel 15 followed by a read, a `$D012` busy-wait in a file that never
installs an interrupt, a zero LFSR seed, an interrupt handler that
reaches `ADC` or `SBC` before any `CLD` (assembly only), an unmasked
store to `$D016`, and `JMP ($xxFF)`. Each finding
carries a certainty: `definite` means the pattern is the pitfall by
construction, `likely` means something outside the file could excuse it,
`heuristic` means read the page and decide. It lints one file at a time,
does not resolve symbols, and covers only the pitfalls that have a text
pattern, so silence is not a pass; `c64_pitfalls_for` lists the rest.
The rules live in `src/tools/lint.ts` and the CLI exits 1 on a definite
finding.

### Synthesis and briefings

| Tool | Purpose |
|------|---------|
| `c64_demo_briefing` | Synthesise techniques + pitfalls + toolchain split + build order for a demo brief |
| `c64_game_briefing` | Same synthesis for a game brief; the archetype name is looked up in the graph and its technique fingerprint and pitfalls shape the plan, and an unknown name is reported together with the known ones |

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
tools, file formats, machine resources and game archetypes; the edge types
between them are listed in `docs/ONTOLOGY.md`. Range indexes and unique constraints on every
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
for cycle-tight code. c64-kb exists in part to push models toward Oscar64
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
constants in the recipes are VICE 3.10 measurements (PAL on VICE's default
C64C model: VIC-II 8565, SID 8580, CIA 8521; NTSC 6567R8 where a page says
so), not bench measurements, and each page says so. An earlier version of
this paragraph said the PAL runs were a 6569; `-model c64` is that machine.

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
| `npm run dev` | Run the CLI from source (Node strips the types; no build needed) |
| `npm run dev:serve` | Run the MCP server from source |
| `npm run ingest` | Hydrate KB from `docs/` (incremental: unchanged files are skipped) |
| `npm run ingest:clean` / `npm run ingest -- --force` | Wipe the graph and the vector collection and re-ingest everything. Use after changing any frontmatter or metadata line: the graph merges edges and never removes one a doc stopped asserting, so an incremental run leaves stale edges behind |
| `npm test` | Run vitest against a throwaway graph (`c64_test`) and collection (`c64_docs_test`); the live stores are never touched |
| `npm run check:listings` | Build every recipe listing with its real toolchain (KickAssembler, Oscar64, cc65) and assemble every KickAssembler fragment in `docs/`; see the script header for `KICKASS_JAR` / `OSCAR64` / `CL65` |
| `npm run vice:headless` | Build a windowless VICE 3.10 (`--enable-headlessui`) into `.tools/`; the verifier and the run tool use it automatically, so headless runs stop opening windows; its pictures are byte-identical to the GTK build's |
| `npm run verify:recipes` | Build every recipe, run it headless in VICE at the cycles pinned in `docs/recipes/runs.json`, and compare the PNG pixel for pixel with the committed screenshot. `--file` scopes to one page, `--update` adopts a new baseline after a deliberate change, `--allow-missing` tolerates a recipe with no picture yet |
| `npm run typecheck` | Type-check src, scripts and test without emitting |
| `npm run lint` / `npm run format:check` | ESLint (typescript-eslint strict plus a complexity budget) and Prettier; `CONTRIBUTING.md` has the limits |
| `npm run knip` | Report unused files, exports and dependencies |
| `npm run services` / `npm run services:stop` | Start / stop Qdrant and FalkorDB |

### Prerequisites

- Node.js 24.12+ (runs the TypeScript sources directly; no `tsx`)
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
`npm run typecheck` to catch type errors.

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
