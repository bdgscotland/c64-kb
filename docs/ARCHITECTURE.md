# c64-kb Architecture

## System overview

c64-kb is a knowledge-base MCP server: hybrid vector search over a corpus of
markdown reference documents, plus a knowledge graph of the entities those
documents define, both served to Claude Code (or any MCP client) over stdio,
and to the terminal through the same functions as a CLI.

```
+---------------------+     +----------------------+
|  a C64 project      |     |  templates/          |
|  .mcp.json          |     |  starters, harness   |
+----------+----------+     +-----------+----------+
           |        MCP (stdio)         |
           +-------------+--------------+
                         |
              +----------v-----------+      +---------------------+
              |  src/server.ts       |      |  src/cli.ts         |
              |  tools, resources,   |      |  same functions,    |
              |  prompts             |      |  --json for hooks   |
              +----------+-----------+      +----------+----------+
                         +--------------+--------------+
                                        |
                          +-------------v--------------+
                          |  src/tools/               |
                          |  query, pitfalls, lint,    |
                          |  briefings, intelligence,  |
                          |  selfimprovement, hydrate, |
                          |  resources, run-game       |
                          +---+--------------------+---+
                              |                    |
                  +-----------v-----+    +---------v----------+
                  |  Qdrant :7333   |    |  FalkorDB :7379    |
                  |  c64_docs       |    |  graph c64         |
                  |  dense + BM25   |    |  node labels and   |
                  +--------+--------+    |  edge types        |
                           |             +--------------------+
                  +--------v--------+
                  |  Ollama :11434  |
                  |  mxbai-embed-   |
                  |  large (1024)   |
                  +-----------------+
```

## Data flow

**Ingest** (`src/ingest.ts` and `src/ingest/`, `npm run ingest` or
`c64-kb ingest`):

1. Walk `docs/` for markdown (`docs/superpowers/` is skipped if present). `formats/` is walked first so FileFormat descriptions win the
   on-create race; nothing else depends on order.
2. Chunk each file by `##`/`###` heading (`src/services/chunker.ts`: up to
   1,500 characters per chunk, split on paragraph boundaries above that,
   code fences never split).
3. Embed every chunk with `mxbai-embed-large` (8 requests in flight) and
   encode a BM25 sparse vector from a vocabulary fitted over the whole
   corpus. Delete the file's previous chunks, then upsert. Point ids are
   `sha256(file, section, index)`; the delete is what removes a section
   that was renamed or dropped.
4. Extract graph entities from the same text (`src/graph/extract.ts`),
   driven by the `CONVENTIONS-*.md` structure: H3 headings for registers,
   memory regions and KERNAL routines; H2 blocks with metadata lines for
   techniques and pitfalls; frontmatter for recipes; listing load addresses
   for `OCCUPIES`.
5. Two passes into FalkorDB: nodes first, then every edge, so a document
   may reference an entity another document defines. A reference whose
   target does not exist is warned about and counted; the run reports
   edges in the graph, distinct references, and references dropped.
6. After the passes, derived edges: each Register and KernalRoutine into
   the MemoryRegion that contains its address, and VERIFIED_ON from each
   recipe's pinned machine models in `docs/recipes/runs.json`.

`--clean` (and `--force`, which implies it) wipes the graph's entity labels
and drops and recreates the Qdrant collection first, because MERGE never
removes an edge a document has stopped asserting.

**Query**: tools in `src/tools/` read Qdrant (RRF fusion of dense and BM25
results; keyword-only when Ollama is down) and FalkorDB (Cypher through
`FalkorService.roQuery`). The query tools log each call to SQLite, so
queries with no results surface as gap candidates.

## CLI-first

Tool logic lives in `src/tools/` as functions returning
`{ structured, text }`; the large tools are directories (`query/`,
`briefings/`, `pitfalls/`, `lint/`) behind an entry file. Two entry points
share them:

- **CLI** (`src/cli.ts`): a command per query tool (`c64-kb --help` lists
  them), plus `services`, `ingest`, `serve` and `version`; `--json` for
  hooks and scripts.
- **MCP** (`src/server.ts`, definitions in `src/server/tools-*.ts`): the
  tools the README lists, the static `c64://` resources plus the
  `c64://register/{name}` template, and the `c64_demo_brief` /
  `c64_game_brief` prompts. Output schemas are Zod
  (`src/schemas/tool-outputs.ts`). `c64_coverage`, `c64_suggest_links`,
  `c64_report_gap` and `c64_run_game` have no CLI command.

## Components

### Qdrant (`src/services/qdrant.ts`)

- Collection `c64_docs` (env `QDRANT_COLLECTION`); host port 7333 REST,
  7334 gRPC (unused).
- Named vectors: `dense` (1024, cosine) and `bm25` (sparse, IDF modifier).
- Payload indexes: `source` (keyword, used by delete-by-source and
  filtered search) and `text` (full text, keyword fallback).

### FalkorDB (`src/services/falkor.ts` and `src/services/falkor/`)

- Graph `c64` (env `FALKOR_GRAPH`); host port 7379, Redis protocol.
- Node labels `Chip`, `Region`, `Register`, `KernalRoutine`,
  `MemoryRegion`, `Technique`, `Recipe`, `Pitfall`, `CrashPattern`, `Tool`,
  `FileFormat`, `Resource`, `HardwareUnit`, `Archetype`, `GameDesign` and
  `MachineVariant`, and the edge types between them; `ONTOLOGY.md` defines
  each and says which page line produces it.
- Range index and unique constraint on every primary key; `Chip`, `Region`,
  `HardwareUnit` and `MachineVariant` seeded by `ensureSchema()`.
- Registers, KERNAL routines and memory regions carry numeric address
  properties (`addr_n`, `start_n`, `end_n`) for the range queries behind
  `IN_REGION` and `OCCUPIES`.

### Embeddings (`src/services/embeddings.ts`)

`mxbai-embed-large` through Ollama at `:11434`, 1024 dimensions, 8
concurrent requests by default (`EMBED_CONCURRENCY`). Returns null when Ollama is unreachable; query paths
fall back to keyword search, ingest stops.

### Analytics (`src/services/analytics.ts`)

SQLite at `data/analytics.db` in a clone, or under the data folder
(`C64_KB_DATA_DIR`) in an npm install; env `ANALYTICS_DB` overrides. One row
per query-tool call with query and result count; read by `c64_coverage` and
`c64_report_gap`.

### Evaluation (`src/tools/run-game.ts`)

`c64_run_game` spawns `x64sc` (the repo's windowless build when present)
with `-autostart`, connects through a local vice-mcp (`VICE_MCP_PATH`) and
returns a state trace and screen render. It needs an Oscar64 `.dbj` file.
It is the only tool that touches an emulator, and no other tool depends on
it. The gates below run VICE themselves.

## Verification

- `npm test`: vitest. `vitest.config.ts` points the tests at
  `FALKOR_GRAPH=c64_test` and `QDRANT_COLLECTION=c64_docs_test`
  (`C64_TEST_STORE=<name>` for a separate pair); tests call `clean()`
  freely and the ingested stores are never touched.
- `npm run check:listings` (`scripts/check-listings.ts`): builds every
  recipe listing with the toolchain it names (KickAssembler via
  `KICKASS_JAR`, Oscar64, cc65) and assembles every KickAssembler-syntax
  fragment elsewhere in `docs/`. The vitest wrapper runs it with
  `--allow-missing`.
- `npm run verify:recipes` (`scripts/verify-recipes.ts`): runs every
  recipe headless in VICE at the cycles and machine models pinned in
  `docs/recipes/runs.json`, and compares each picture pixel for pixel with
  the committed screenshot in `docs/recipes/<toolchain>/screenshots/`.
- `scripts/claims-watch.ts`: runs a program in VICE with a store trace and
  fails on a store to a hardware unit it did not declare. The starters run
  it as `make claims`.
- `npm run verify:templates` (`scripts/verify-templates.ts`): makes a
  project from every starter in `templates/` and runs its build, its
  PAL and NTSC screenshot checks, its disk image and, with `--selftest`,
  the broken-build test and the starter's own proof targets.
- CI (`.github/workflows/ci.yml`) runs the type check, lint, unit and
  integration tests, the listing and recipe gates for KickAssembler and
  cc65, and an install test of the packed package. Oscar64 is skipped
  there until issue #25. `.github/workflows/release.yml` publishes to npm
  from a version tag.

## Ports

| Service | Host port | In-container | Protocol |
|---------|-----------|--------------|----------|
| Qdrant | 7333 | 6333 | HTTP REST |
| Qdrant | 7334 | 6334 | gRPC (unused) |
| FalkorDB | 7379 | 6379 | Redis |
| Ollama | 11434 | n/a (host) | HTTP |

All on localhost. `docker-compose.yml` ships Qdrant and FalkorDB (started
by `c64-kb services up` or `docker compose up -d`); Ollama is installed on
the host. The MCP server is not containerized: stdio
transport means the process runs beside the Claude Code session.
