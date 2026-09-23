/**
 * Batch ingest's two passes. Pass 1 writes each changed file's vectors and
 * graph nodes and collects its edges; pass 2 applies every collected edge
 * once all nodes across all files exist, so an edge never depends on the
 * order files were walked in (FalkorDB's MERGE-stub fallback covers the
 * rest).
 */

import { createHash } from "node:crypto";
import { applyEdge, applyNode, isNodeEntity, recipeEdges, type EdgeEntity, type NodeEntity } from "../graph/apply.ts";
import { extractGraphEntities } from "../graph/extract.ts";
import type { BM25Encoder } from "../services/bm25.ts";
import { chunkMarkdown } from "../services/chunker.ts";
import type { FalkorService } from "../services/falkor.ts";
import type { QdrantService } from "../services/qdrant.ts";
import { log, saveHashes } from "./files.ts";
import { replaceDocPoints } from "./points.ts";
import type { EdgeTally, NodeTally } from "./tally.ts";

export interface Pass1Context {
  qdrant: QdrantService;
  falkor: FalkorService;
  bm25: BM25Encoder;
  forceAll: boolean;
  hashes: Record<string, string>;
  nodes: NodeTally;
  /** Edges collected for pass 2, in file order. */
  pending: EdgeEntity[];
  /** Progress lines for stdout; only the CLI entry prints there. */
  print: (line: string) => void;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function countNode(nodes: NodeTally, e: NodeEntity): void {
  if (e.type === "pitfall") nodes.pitfalls++;
  else if (e.type === "crash_pattern") nodes.crashPatterns++;
  else if (e.type === "archetype") nodes.archetypes++;
}

/** Create a file's nodes and queue its edges. Returns the number of nodes created. */
async function applyFileEntities(ctx: Pass1Context, file: string, content: string): Promise<number> {
  let entityCount = 0;
  for (const e of extractGraphEntities(content, file)) {
    if (!isNodeEntity(e)) {
      ctx.pending.push(e);
      continue;
    }
    try {
      await applyNode(ctx.falkor, e);
      entityCount++;
      countNode(ctx.nodes, e);
      if (e.type === "recipe") ctx.pending.push(...recipeEdges(e));
    } catch (err) {
      console.warn(`  graph error for ${e.type} in ${file}: ${String(err)}`);
    }
  }
  return entityCount;
}

/** Pass 1 for one file: skip it when unchanged, else replace its points and create its nodes. */
export async function ingestFile(ctx: Pass1Context, file: string, content: string): Promise<void> {
  const contentHash = createHash("sha256").update(content).digest("hex");
  if (!ctx.forceAll && ctx.hashes[file] === contentHash) {
    ctx.nodes.skipped++;
    return;
  }
  ctx.hashes[file] = contentHash;
  saveHashes(ctx.hashes);

  const chunks = chunkMarkdown(content, file);
  if (chunks.length === 0) return;
  const points = await replaceDocPoints(ctx.qdrant, { source: file, chunks, bm25: ctx.bm25 });
  ctx.nodes.chunks += points;

  const entityCount = await applyFileEntities(ctx, file, content);
  ctx.print(`  ${file}: ${points} chunks, ${entityCount} graph entities`);
  log(`INGEST ${file} chunks=${points} graph=${entityCount}`);
}

// Connection-class errors abort pass 2 at once; per-row malformation is
// logged and skipped. Ten consecutive failures also abort (catches FalkorDB
// dropping mid-pass without a socket error).
const FATAL_PATTERNS = [/ECONNREFUSED/i, /ECONNRESET/i, /Connection is closed/i, /Redis connection/i];
const FAILURE_THRESHOLD = 10;

/** Pass 2: apply every deferred edge, recording each outcome in `tally`. */
export async function applyPendingEdges(
  falkor: FalkorService,
  pass: { edges: EdgeEntity[]; tally: EdgeTally; print: (line: string) => void },
): Promise<void> {
  const { edges, tally, print } = pass;
  print(`\nPass 2: applying ${edges.length} deferred edges`);
  let edgeFailures = 0;
  let consecutiveFailures = 0;
  for (const edge of edges) {
    try {
      tally.record(edge, await applyEdge(falkor, edge));
      consecutiveFailures = 0;
    } catch (err) {
      edgeFailures++;
      const message = errorMessage(err);
      if (FATAL_PATTERNS.some((re) => re.test(message))) {
        console.error(`[ingest] FATAL: connection-class error in pass 2: ${message}`);
        throw err;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        console.error(`[ingest] FATAL: ${consecutiveFailures} consecutive edge failures — aborting`);
        throw new Error(`Pass-2 edge ingest exceeded failure threshold (${FAILURE_THRESHOLD})`, { cause: err });
      }
      console.warn(`[ingest] edge failure (${edgeFailures} total): ${message}`);
    }
  }
  if (edgeFailures > 0) {
    console.warn(`\nPass 2: ${edgeFailures} edges failed to land (graph state may be incomplete)`);
    log(`PASS2_FAILURES ${edgeFailures}`);
  }
}
