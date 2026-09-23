/**
 * Batch ingest's files: the docs walk, the per-file content hashes that
 * make a run incremental, the ingest log, and the BM25 vocab fitted over
 * the whole corpus.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../config.ts";
import { BM25_VOCAB_FILE, BM25Encoder, loadBM25Vocab } from "../services/bm25.ts";

export const HASH_FILE = path.resolve(config.analytics.dbPath, "../ingest-hashes.json");
const LOG_FILE = path.resolve(config.analytics.dbPath, "../ingest.log");
export const VOCAB_FILE = BM25_VOCAB_FILE;

const Hashes = z.record(z.string(), z.string());

/** Content hash per docs-relative path from the last run; empty when there is none or it is unreadable. */
export function loadHashes(): Record<string, string> {
  if (!fs.existsSync(HASH_FILE)) return {};
  try {
    const parsed = Hashes.safeParse(JSON.parse(fs.readFileSync(HASH_FILE, "utf-8")));
    if (parsed.success) return parsed.data;
    console.error(`[ingest] ${HASH_FILE} is not a hash map — every file will be re-ingested`);
  } catch (err) {
    console.error(
      `[ingest] cannot read ${HASH_FILE}: ${err instanceof Error ? err.message : String(err)} — every file will be re-ingested`,
    );
  }
  return {};
}

export function saveHashes(hashes: Record<string, string>): void {
  fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
  fs.writeFileSync(HASH_FILE, JSON.stringify(hashes, null, 2));
}

export function log(msg: string): void {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`);
}

/**
 * Load the BM25 vocab from disk if present; otherwise (or with
 * `forceRefit`) fit a fresh encoder over the full corpus, so all sparse
 * vectors share the same vocabulary indices, and persist it.
 */
export function loadOrFitBM25(
  corpus: string[],
  forceRefit: boolean,
): { encoder: BM25Encoder; fitted: boolean } {
  const loaded = forceRefit ? null : loadBM25Vocab(VOCAB_FILE);
  if (loaded) return { encoder: loaded, fitted: false };
  const encoder = new BM25Encoder();
  encoder.fit(corpus);
  fs.mkdirSync(path.dirname(VOCAB_FILE), { recursive: true });
  fs.writeFileSync(VOCAB_FILE, JSON.stringify(encoder.toJSON()));
  return { encoder, fitted: true };
}

/**
 * Walk priority is now ONLY load-bearing for FileFormat description authority:
 * docs/formats/c64-file-formats.md must land first so addFileFormat's
 * ON-CREATE-only description set wins over later per-toolchain `.FORMAT`
 * blurbs. Everything else used to depend on this order for edge correctness,
 * but the two-pass linker (P0-3) defers all edges to pass 2, where every
 * node already exists — so node-creation order no longer affects edge
 * outcomes. The hardware/toolchains/runtime/techniques/recipes ordering
 * remains for log readability + the FileFormat race.
 */
const WALK_PRIORITY: readonly string[] = [
  "formats/", // FileFormat catalog: descriptions land first (ON CREATE SET wins). LOAD-BEARING.
  "hardware/", // Register / KernalRoutine / MemoryRegion nodes (cosmetic ordering only)
  "toolchains/", // Tool nodes (cosmetic)
  "runtime/", // More Tool nodes — vice, vice-mcp, sim6502 (cosmetic)
  "techniques/", // Technique nodes (cosmetic — edges resolve in pass 2)
  "recipes/", // Recipe nodes (cosmetic — edges resolve in pass 2)
];

function walkRank(rel: string): number {
  const i = WALK_PRIORITY.findIndex((p) => rel.startsWith(p));
  return i === -1 ? WALK_PRIORITY.length : i;
}

/**
 * Recursively walk a directory and return all *.md paths relative to root,
 * with forward slashes, in walk-priority order. Skips non-knowledge
 * subtrees (specs and plans).
 */
export function findMarkdown(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  // Node's native recursive readdir: every returned name is
  // filesystem-derived, so no path is built from user-influenced segments.
  const entries = fs.readdirSync(root, { withFileTypes: true, recursive: true });
  const results: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    // entry.parentPath is the directory the file was discovered in.
    const parent = entry.parentPath;
    const rel =
      parent === root ? entry.name : `${parent.slice(root.length).replace(/^[/\\]+/, "")}/${entry.name}`;
    if (rel.startsWith("superpowers/") || rel.startsWith("superpowers\\")) continue;
    results.push(rel.replace(/\\/g, "/"));
  }
  return results.sort((a, b) => walkRank(a) - walkRank(b) || a.localeCompare(b));
}
