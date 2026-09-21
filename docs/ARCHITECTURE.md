# c64-kb Architecture

## System Overview

c64-kb is a knowledge base MCP server that provides semantic search and
graph-based reference lookup across Commodore 64 hardware, demo techniques,
toolchains, and pitfalls. It serves any Claude Code project via the Model
Context Protocol (stdio transport).

```
+------------------+     +------------------+
|  c64-dev         |     |  future game/    |
|  .mcp.json       |     |  demo projects   |
+--------+---------+     +--------+---------+
         |                         |
         |    MCP (stdio)          |
         +------------+------------+
                      |
              +-------v--------+     +-----------------+
              |  c64-kb        |     |  Terminal / Hook |
              |  MCP server    |     |  c64-kb <cmd>    |
              |  (serve mode)  |     |  --json          |
              +-------+--------+     +--------+--------+
                      |                       |
                      +----------+------------+
                                 |
                      +----------v----------+
                      |  Tool Functions     |
                      |  tools/query.ts     |
                      |  tools/hydrate.ts   |
                      |  tools/intelligence |
                      +--+---------------+--+
                         |               |
                +--------v--+  +---------v------+
                |  Qdrant   |  |  FalkorDB      |
                |  (Docker) |  |  (Docker)      |
                |  :7333    |  |  :7379         |
                +-----------+  +----------------+
                      ^
                      |
                +-----+------+
                |  Ollama     |
                |  mxbai-     |
                |  embed-large|
                |  :11434     |
                +-------------+
```

## CLI-First Architecture

Tool logic lives in `src/tools/*.ts` as pure functions returning strings.
Two entry points share the same functions:

- **CLI** (`src/cli.ts`): subcommand dispatch, human-readable or `--json`
  output. Testable from terminal, usable in hooks and scripts.
- **MCP** (`src/server.ts`): thin wrapper that maps MCP tool calls to the
  same functions, wrapping results in MCP content blocks.

## Phase 0 Status (current)

- Infrastructure cloned from amiga-kb (services, CLI, MCP server, docker
  compose, backup script).
- FalkorDB seeded with `Chip` and `Region` nodes.
- MCP server registers `c64_health` (real) plus stubs for `c64_search`,
  `c64_lookup_register`, `c64_lookup_kernal`.
- No knowledge documents ingested yet. Hardware references, toolchain
  references, techniques, pitfalls, and recipes are scheduled for Phases
  1–7.

## Toolchain Boundary

c64-kb is *pure reference*. The dev toolchain (Oscar64, KickAssembler,
cc65, VICE, vice-mcp, sim6502) lives in a separate repo or template.
c64-kb documents the toolchain but does not bundle or run it. See spec
§1 "Consuming-repo workflow."

## Components

### CLI (`src/cli.ts`)

Entry point for terminal use. Phase 0 subcommands: `health`, `serve`.
`--json` flag for programmatic output. The `serve` subcommand starts
the MCP server.

### Tool Functions (`src/tools/*.ts`)

Pure functions that implement all tool logic, shared by CLI and MCP.
- `query.ts`: Phase 0 stubs for search, lookupRegister, lookupKernal.
- `hydrate.ts`: Phase 0 stub for ingestDoc.
- `intelligence.ts`: real `health`/`formatHealth`. Coverage / suggest-
  links / report-gap / catalog deferred to Phase 7.

### Service Context (`src/context.ts`)

Lazy-initializes Qdrant, FalkorDB, and Analytics. Shared singleton —
both CLI and MCP use the same instances.

### MCP Server (`src/server.ts`)

Maps MCP tool definitions (with Zod schemas) to tool functions. Stdio
transport.

### Qdrant Service (`src/services/qdrant.ts`)

- Collection: `c64_docs`
- Vector dimensions: 1024 (mxbai-embed-large)
- Distance: Cosine
- Payload indexes: `source` (keyword), `source_project` (keyword), `text`
  (full-text fallback)
- REST API on host port 7333

### FalkorDB Service (`src/services/falkor.ts`)

- Graph name: `c64`
- Redis-compatible protocol on host port 7379
- Range indexes on all 11 node label primary keys (see `ONTOLOGY.md`)
- Seeds 5 `Chip` nodes and 2 `Region` nodes on `ensureSchema()`

### Embedding Service (`src/services/embeddings.ts`)

- Model: `mxbai-embed-large` via Ollama (`:11434`)
- 1024-dimensional embeddings
- Concurrency: 8 parallel requests
- Graceful fallback: returns null on Ollama unavailability; callers fall
  back to keyword search

### Chunker (`src/services/chunker.ts`)

- Splits markdown by `##` and `###` headings
- Max chunk size: 1500 chars (split on paragraph boundaries if exceeded)
- Min chunk size: 80 chars (merged with next chunk if below)
- Overlap: 200 chars from previous chunk prepended

## Ports and Networking

| Service | Host port | In-container | Protocol |
|---------|-----------|--------------|----------|
| Qdrant | 7333 | 6333 | HTTP REST |
| Qdrant | 7334 | 6334 | gRPC (unused) |
| FalkorDB | 7379 | 6379 | Redis |
| Ollama | 11434 | n/a (host) | HTTP |

All services run on localhost. No external network access required.

## Containerization

Phase 0 ships only Qdrant + FalkorDB in `docker-compose.yml`. The
dashboard, ingest, and dream services land in their respective phases.

The MCP server itself is NOT containerized — MCP uses stdio transport,
so the process must be local to the Claude Code session.
