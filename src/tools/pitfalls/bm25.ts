/**
 * The BM25 vocabulary for the pitfall search fallback's sparse vector,
 * loaded once through the shared loader in src/services/bm25.ts.
 */

import { loadBM25Vocab, type BM25Encoder, type SparseVector } from "../../services/bm25.ts";

let bm25Cache: BM25Encoder | null | undefined; // undefined = not yet attempted

function getBM25(): BM25Encoder | null {
  if (bm25Cache === undefined) bm25Cache = loadBM25Vocab();
  return bm25Cache;
}

export function encodeSparse(text: string): SparseVector {
  const enc = getBM25();
  return enc ? enc.encode(text) : { indices: [], values: [] };
}
