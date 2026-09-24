/**
 * Centralized configuration. All service URLs and settings come from
 * environment variables with sane defaults for local dev.
 *
 * In Docker: services are at their container names (qdrant, falkordb).
 * Local dev: everything is at localhost.
 *
 * Ports are shifted off the Qdrant/FalkorDB defaults (6333/6379) to 7333/7379
 * so another instance of either service can run on the same host.
 *
 * The environment is parsed once, here, and a bad value stops the process
 * with the variable's name. `parseInt` used to turn FALKOR_PORT=abc into NaN
 * and fail later at connect time.
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where the analytics database, BM25 vocabulary, ingest hashes and ingest log
 * live. A repository checkout keeps them in its own data/ as it always has.
 * An npm install (the package sits under node_modules) must not: a global
 * install may not be writable, and an upgrade replaces the folder. It uses
 * $XDG_DATA_HOME/c64-kb, else ~/.local/share/c64-kb. C64_KB_DATA_DIR
 * overrides both.
 */
function defaultDataDir(): string {
  const installed = __dirname.split(path.sep).includes("node_modules");
  if (!installed) return path.resolve(__dirname, "../data");
  const base = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "c64-kb");
}

const Env = z.object({
  QDRANT_URL: z.url().default("http://localhost:7333"),
  QDRANT_COLLECTION: z.string().min(1).default("c64_docs"),
  FALKOR_HOST: z.string().min(1).default("localhost"),
  FALKOR_PORT: z.coerce.number().int().min(1).max(65535).default(7379),
  FALKOR_GRAPH: z.string().min(1).default("c64"),
  OLLAMA_URL: z.url().default("http://localhost:11434"),
  EMBED_MODEL: z.string().min(1).default("mxbai-embed-large"),
  EMBED_CONCURRENCY: z.coerce.number().int().min(1).default(8),
  DOCS_DIR: z.string().min(1).default(path.resolve(__dirname, "../docs")),
  C64_KB_DATA_DIR: z.string().min(1).default(defaultDataDir()),
  ANALYTICS_DB: z.string().min(1).optional(),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
}
const env = parsed.data;

export const config = {
  // Qdrant vector store
  qdrant: {
    url: env.QDRANT_URL,
    collection: env.QDRANT_COLLECTION,
    vectorSize: 1024, // mxbai-embed-large
  },

  // FalkorDB graph
  falkor: {
    host: env.FALKOR_HOST,
    port: env.FALKOR_PORT,
    graphName: env.FALKOR_GRAPH,
  },

  // Ollama embeddings (a host-level service; other tools may share it)
  ollama: {
    url: env.OLLAMA_URL,
    model: env.EMBED_MODEL,
    concurrency: env.EMBED_CONCURRENCY,
  },

  // Knowledge base docs
  docs: {
    dir: env.DOCS_DIR,
  },

  // Per-machine state. The BM25 vocab, ingest hashes and log sit beside the
  // analytics database, so ANALYTICS_DB (the tests set it) moves them too.
  dataDir: env.C64_KB_DATA_DIR,
  analytics: {
    dbPath: env.ANALYTICS_DB ?? path.join(env.C64_KB_DATA_DIR, "analytics.db"),
  },
} as const;
