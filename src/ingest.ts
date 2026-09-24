#!/usr/bin/env node

/**
 * Batch ingest pipeline. Walks docs/, chunks markdown, generates dense
 * + sparse vectors, upserts to Qdrant, and extracts graph entities into
 * FalkorDB. Single-file equivalent lives in src/tools/hydrate.ts
 * (c64-kb ingest-doc CLI + c64_ingest_doc MCP tool).
 *
 * Phases: connect (and clean), scan + fit BM25, pass 1 (vectors + nodes),
 * pass 2 (edges), report. The pieces live in src/ingest/.
 *
 * Prerequisites:
 *   docker compose up -d
 *   ollama pull mxbai-embed-large
 *
 * Run: npm run ingest          # incremental (skips unchanged files)
 *      npm run ingest:clean    # wipe graph + cache and re-ingest
 *      npm run ingest -- --force  # wipe graph + collection, rehash and re-upsert every file
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.ts";
import type { EdgeEntity } from "./graph/apply.ts";
import { HASH_FILE, VOCAB_FILE, findMarkdown, loadHashes, loadOrFitBM25, log } from "./ingest/files.ts";
import { chunkText } from "./ingest/points.ts";
import { scanRecipeListings } from "./ingest/listing-scan.ts";
import { applyPendingEdges, ingestFile } from "./ingest/passes.ts";
import { findStubTechniques, linkRegions, reportSummary } from "./ingest/report.ts";
import { EdgeTally, type NodeTally } from "./ingest/tally.ts";
import { linkVerifiedOn } from "./ingest/verified-on.ts";
import { chunkMarkdown } from "./services/chunker.ts";
import { isAvailable as ollamaAvailable } from "./services/embeddings.ts";
import { FalkorService } from "./services/falkor.ts";
import { QdrantService } from "./services/qdrant.ts";

const DOCS_DIR = config.docs.dir;

export interface RunFlags {
  forceAll: boolean;
  cleanFirst: boolean;
}

export function parseFlags(argv: string[]): RunFlags {
  const forceAll = argv.includes("--force");
  // --force re-ingests every file, and MERGE never removes an edge a doc no
  // longer asserts, so a forced run is also a clean one; otherwise a changed
  // frontmatter list leaves its old edges behind (seen with recipe techniques).
  return { forceAll, cleanFirst: argv.includes("--clean") || forceAll };
}

/**
 * Connect both stores, wiping them first on a clean run. A clean run writes
 * the rebuild marker before it wipes anything, so the query tools refuse to
 * answer from the half-built graph (src/services/rebuild-marker.ts, #41). An
 * incremental run re-MERGEs changed files into a whole graph and sets none.
 */
async function connectStores(
  cleanFirst: boolean,
  flags: string,
): Promise<{ qdrant: QdrantService; falkor: FalkorService }> {
  const qdrant = new QdrantService();
  await qdrant.ensureCollection();
  console.log("  qdrant: connected");

  const falkor = new FalkorService();
  await falkor.connect();
  await falkor.ensureSchema();
  console.log("  falkordb: connected (schema ensured)");

  if (cleanFirst) {
    await falkor.markRebuildStarted(flags);
    console.log("  falkordb: rebuild marker set (query tools refuse until the report is done)");
    await falkor.clean();
    console.log("  falkordb: cleaned per-label nodes (schema + Chip/Region seeds preserved)");
    await qdrant.dropCollection();
    await qdrant.ensureCollection();
    console.log("  qdrant: collection dropped and recreated");
    fs.rmSync(HASH_FILE, { force: true });
    console.log("  ingest-hashes.json removed");
  }
  return { qdrant, falkor };
}

/**
 * Read every doc. The BM25 vocab is fitted over every chunk of every file,
 * whichever files this run re-ingests, so all sparse vectors share one
 * vocabulary.
 */
function readCorpus(files: string[]): { contents: Map<string, string>; corpus: string[] } {
  const contents = new Map<string, string>();
  const corpus: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(DOCS_DIR, file), "utf-8");
    contents.set(file, content);
    corpus.push(...chunkMarkdown(content, file).map(chunkText));
  }
  return { contents, corpus };
}

/**
 * Run a batch ingest; returns the process exit code. Shared by
 * `node src/ingest.ts` (npm run ingest) and `c64-kb ingest`, the only way
 * to build the stores from an npm install.
 */
export async function runIngest({ forceAll, cleanFirst }: RunFlags): Promise<number> {
  const flags = `${forceAll ? " --force" : ""}${cleanFirst ? " --clean" : ""}`;
  console.log(`c64-kb ingest${flags}`);
  console.log(`  docs: ${DOCS_DIR}`);
  log(`START${flags}`);

  if (!(await ollamaAvailable())) {
    console.warn("  WARNING: Ollama not available. Run: ollama pull mxbai-embed-large");
    console.warn("  Aborting — Phase 1 ingest requires embeddings.");
    return 1;
  }
  console.log(`  embeddings: ${config.ollama.model} via Ollama`);

  const { qdrant, falkor } = await connectStores(cleanFirst, flags);

  const files = findMarkdown(DOCS_DIR);
  console.log(`\nFound ${files.length} markdown files`);
  const { contents, corpus } = readCorpus(files);
  const { encoder: bm25, fitted } = loadOrFitBM25(corpus, forceAll);
  // This line used to print "loaded" after a first-time fit, because it
  // tested for the vocab file after the fit had written it.
  console.log(`  bm25: ${fitted ? "fitted" : "loaded"} vocab → ${VOCAB_FILE}`);

  // --- Pass 1: vectors + node entities; edges are collected for pass 2 ---
  const nodes: NodeTally = {
    chunks: 0,
    skipped: 0,
    pitfalls: 0,
    crashPatterns: 0,
    archetypes: 0,
    gameDesigns: 0,
    libraryFunctions: 0,
  };
  const pending: EdgeEntity[] = [];
  const print = (line: string): void => {
    console.log(line);
  };
  const ctx = { qdrant, falkor, bm25, forceAll, hashes: loadHashes(), nodes, pending, print };
  for (const [file, content] of contents) await ingestFile(ctx, file, content);

  // --- Pass 2: every edge, now that every node exists ---
  const edges = new EdgeTally();
  await applyPendingEdges(falkor, { edges: pending, tally: edges, print });

  // --- Report ---
  await linkRegions(falkor, print);
  await linkVerifiedOn(falkor, DOCS_DIR, print);
  await scanRecipeListings(falkor, contents, print);
  const stubTechniques = await findStubTechniques(falkor);
  await reportSummary({ qdrant, falkor, nodes, edges, stubTechniques, print });
  if (cleanFirst) await falkor.markRebuildFinished();

  await falkor.close();
  return 0;
}

// Run only when executed (`node src/ingest.ts`), not when imported.
const entry = process.argv.at(1);
if (entry !== undefined && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  runIngest(parseFlags(process.argv)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error("Ingest failed:", err);
      process.exit(1);
    },
  );
}
