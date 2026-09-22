# c64-kb Architecture

## System overview

c64-kb is a knowledge-base MCP server: hybrid vector search over a corpus of
markdown reference documents, plus a knowledge graph of the entities those
documents define, both served to Claude Code (or any MCP client) over stdio,
and to the terminal through the same functions as a CLI.

```
+---------------------+     +----------------------+
|  a C64 project      |     |  templates/          |
|  .mcp.json          |     |  c64-*-starter       |
+----------+----------+     +-----------+----------+
           |        MCP (stdio)         |
           +-------------+--------------+
                         |
              +----------v-----------+      +---------------------+
              |  src/server.ts       |      |  src/cli.ts         |
              |  23 tools, 12 res.,  |      |  same functions,    |
              |  2 prompts           |      |  --json for hooks   |
              +----------+-----------+      +----------+----------+
                         +--------------+--------------+
                                        |
                          +-------------v--------------+
                          |  src/tools/*.ts            |
                          |  query, pitfalls,          |
                          |  briefings, intelligence,  |
                          |  selfimprovement, hydrate, |
                          |  resources, run-game       |
                          +---+--------------------+---+
                              |                    |
                  +-----------v-----+    +---------v----------+
                  |  Qdrant :7333   |    |  FalkorDB :7379    |
                  |  c64_docs       |    |  graph c64         |
                  |  dense + BM25   |    |  12 labels,        |
                  +--------+--------+    |  15 edge types     |
                           |             +--------------------+
                  +--------v--------+
                  |  Ollama :11434  |
                  |  mxbai-embed-   |
                  |  large (1024)   |
                  +-----------------+
```

## Data flow

**Ingest** (`src/ingest.ts`, `npm run ingest`):

1. Walk `docs/` for markdown (75 files; `docs/superpowers/` is skipped if
   present). `formats/` is walked first so FileFormat descriptions win the
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
6. After the passes, address-derived edges: each Register and KernalRoutine
   into the MemoryRegion that contains its address.

`--clean` (and `--force`, which implies it) wipes the graph's entity labels
and drops and recreates the Qdrant collection first, because MERGE never
removes an edge a document has stopped asserting.

**Query**: tools in `src/tools/` read Qdrant (RRF fusion of dense and BM25
results; keyword-only when Ollama is down) and FalkorDB (Cypher through
`FalkorService.roQuery`). Every call is logged to SQLite
(`data/analytics.db`) so queries with no results surface as gap candidates.

## CLI-first

Tool logic lives in `src/tools/*.ts` as functions returning
`{ structured, text }`. Two entry points share them:

- **CLI** (`src/cli.ts`): `health`, `serve`, `search`, `ingest-doc`,
  `lookup-register`, `lookup-kernal`, `memory-map`, `lookup-opcode`,
  `pal-ntsc-diff`, `toolchain-hint`, `recipe-lookup`, `recipes-for`,
  `technique-lookup`, `techniques-for`, `check-compatibility`,
  `timing-budget`, `pitfalls-for`, `failure-diagnose`, `demo-briefing`,
  `game-briefing`, `version`; `--json` for hooks and scripts.
- **MCP** (`src/server.ts`): the 23 tools listed in the README, 11 static
  `c64://` resources plus the `c64://register/{name}` template, and the
  `c64_demo_brief` / `c64_game_brief` prompts. Output schemas are Zod
  (`src/schemas/tool-outputs.ts`).

## Components

### Qdrant (`src/services/qdrant.ts`)

- Collection `c64_docs` (env `QDRANT_COLLECTION`); host port 7333 REST,
  7334 gRPC (unused).
- Named vectors: `dense` (1024, cosine) and `bm25` (sparse, IDF modifier).
- Payload indexes: `source` (keyword, used by delete-by-source and
  filtered search) and `text` (full text, keyword fallback).

### FalkorDB (`src/services/falkor.ts`)

- Graph `c64` (env `FALKOR_GRAPH`); host port 7379, Redis protocol.
- 12 node labels (`Chip`, `Region`, `Register`, `KernalRoutine`,
  `MemoryRegion`, `Technique`, `Recipe`, `Pitfall`, `CrashPattern`, `Tool`,
  `FileFormat`, `Resource`), 15 edge types; see `ONTOLOGY.md`.
- Range index and unique constraint on every primary key; `Chip` and
  `Region` seeded by `ensureSchema()`.
- Registers, KERNAL routines and memory regions carry numeric address
  properties (`addr_n`, `start_n`, `end_n`) for the range queries behind
  `IN_REGION` and `OCCUPIES`.

### Embeddings (`src/services/embeddings.ts`)

`mxbai-embed-large` through Ollama at `:11434`, 1024 dimensions, 8
concurrent requests. Returns null when Ollama is unreachable; query paths
fall back to keyword search, ingest stops.

### Analytics (`src/services/analytics.ts`)

SQLite at `data/analytics.db` (env `ANALYTICS_DB`). One row per tool call
with query and result count; read by `c64_coverage` and `c64_report_gap`.

### Evaluation (`src/tools/run-game.ts`)

`c64_run_game` spawns `x64sc` with `-autostart`, connects through a local
vice-mcp (`VICE_MCP_PATH`) and returns a state trace and screen render. It
is the only path that touches an emulator and nothing else depends on it.

## Verification

- `npm test`: vitest, 133 tests. `vitest.config.ts` points them at
  `FALKOR_GRAPH=c64_test` and `QDRANT_COLLECTION=c64_docs_test`; tests
  call `clean()` freely and the ingested stores are never touched.
- `npm run check:listings` (`scripts/check-listings.ts`): builds every
  recipe listing with the toolchain it names (KickAssembler via
  `KICKASS_JAR`, Oscar64, cc65) and assembles every KickAssembler-syntax
  fragment elsewhere in `docs/`. The vitest wrapper runs it with
  `--allow-missing`.
- The KickAssembler recipes were also run headless in VICE
  (`x64sc -warp -autostartprgmode 1 -limitcycles N -exitscreenshot`) and
  the screenshots measured; they live in
  `docs/recipes/kickassembler/screenshots/`.

## Ports

| Service | Host port | In-container | Protocol |
|---------|-----------|--------------|----------|
| Qdrant | 7333 | 6333 | HTTP REST |
| Qdrant | 7334 | 6334 | gRPC (unused) |
| FalkorDB | 7379 | 6379 | Redis |
| Ollama | 11434 | n/a (host) | HTTP |

All on localhost. `docker-compose.yml` ships Qdrant and FalkorDB; Ollama
is installed on the host. The MCP server is not containerized: stdio
transport means the process runs beside the Claude Code session.
