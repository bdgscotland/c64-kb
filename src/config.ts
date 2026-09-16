/**
 * Centralized configuration. All service URLs and settings come from
 * environment variables with sane defaults for local dev.
 *
 * In Docker: services are at their container names (qdrant, falkordb).
 * Local dev: everything is at localhost.
 *
 * Ports are shifted from amiga-kb (6xxx/3838) to (7xxx/3939) so both
 * KBs can run in parallel on the same host.
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  // Qdrant vector store
  qdrant: {
    url: process.env.QDRANT_URL ?? "http://localhost:7333",
    collection: process.env.QDRANT_COLLECTION ?? "c64_docs",
    vectorSize: 1024, // mxbai-embed-large
  },

  // FalkorDB graph
  falkor: {
    host: process.env.FALKOR_HOST ?? "localhost",
    port: parseInt(process.env.FALKOR_PORT ?? "7379", 10),
    graphName: process.env.FALKOR_GRAPH ?? "c64",
  },

  // Ollama embeddings (shared with amiga-kb)
  ollama: {
    url: process.env.OLLAMA_URL ?? "http://localhost:11434",
    model: process.env.EMBED_MODEL ?? "mxbai-embed-large",
    concurrency: parseInt(process.env.EMBED_CONCURRENCY ?? "8", 10),
  },

  // Knowledge base docs
  docs: {
    dir: process.env.DOCS_DIR ?? path.resolve(__dirname, "../docs"),
  },

  // Query analytics
  analytics: {
    dbPath: process.env.ANALYTICS_DB ?? path.resolve(__dirname, "../data/analytics.db"),
  },
} as const;

// HVSC (High Voltage SID Collection) extensions — separate graph + collection
// so HVSC ontology stays isolated from the existing c64 graph (spec decision C5).
export const FALKOR_HVSC_GRAPH = process.env.FALKOR_HVSC_GRAPH ?? "c64_hvsc";
export const QDRANT_HVSC_COLLECTION = process.env.QDRANT_HVSC_COLLECTION ?? "c64_hvsc_kb";
export const HVSC_CORPUS_DIR = process.env.HVSC_CORPUS_DIR ?? "./data/hvsc-corpus";
export const HVSC_CACHE_DIR = process.env.HVSC_CACHE_DIR ?? "./data/hvsc-cache";
export const HVSC_CORPUS_VERSION = "hvsc-84-2025-12-25";
