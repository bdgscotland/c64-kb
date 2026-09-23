/**
 * The BM25 vocabulary for the pitfall search fallback's sparse vector.
 *
 * Duplicate: src/tools/query.ts has its own copy of this loader (same file,
 * same cache shape). They belong in one shared module, likely next to
 * BM25Encoder in src/services/bm25.ts; until then keep the two in step.
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import { BM25Encoder, type SparseVector } from "../../services/bm25.ts";
import { config } from "../../config.ts";

const VOCAB_FILE = path.resolve(config.analytics.dbPath, "../bm25-vocab.json");

// The shape BM25Encoder.toJSON writes.
const VocabFileSchema = z.object({
  vocab: z.array(z.tuple([z.string(), z.number()])),
  df: z.array(z.tuple([z.number(), z.number()])),
  avgDocLen: z.number(),
  numDocs: z.number(),
  k1: z.number(),
  b: z.number(),
});

let bm25Cache: BM25Encoder | null | undefined; // undefined = not yet attempted

function loadVocab(): BM25Encoder | null {
  // No vocabulary file (no ingest has run): search runs dense-only.
  if (!fs.existsSync(VOCAB_FILE)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(VOCAB_FILE, "utf-8"));
  } catch (err) {
    // stderr only: the MCP server owns stdout.
    console.error(`pitfalls: ${VOCAB_FILE} unreadable, sparse search off: ${String(err)}`);
    return null;
  }
  const parsed = VocabFileSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(
      `pitfalls: ${VOCAB_FILE} is not a BM25 vocabulary, sparse search off: ${parsed.error.message}`,
    );
    return null;
  }
  return BM25Encoder.fromJSON(parsed.data);
}

function getBM25(): BM25Encoder | null {
  if (bm25Cache === undefined) bm25Cache = loadVocab();
  return bm25Cache;
}

export function encodeSparse(text: string): SparseVector {
  const enc = getBM25();
  return enc ? enc.encode(text) : { indices: [], values: [] };
}
