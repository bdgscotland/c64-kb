/**
 * Helpers shared by the query tools: the BM25 encoder, the hybrid
 * document search every lookup ends with, row validation for graph
 * results, and the small formatters the renderers have in common.
 */

import { z } from "zod";
import { getQdrant } from "../../context.ts";
import { embed } from "../../services/embeddings.ts";
import { loadBM25Vocab, type BM25Encoder, type SparseVector } from "../../services/bm25.ts";

let bm25Cache: BM25Encoder | null | undefined; // undefined = not yet attempted

/** The ingest's BM25 vocabulary, through the shared loader (src/services/bm25.ts). */
function getBM25(): BM25Encoder | null {
  if (bm25Cache === undefined) bm25Cache = loadBM25Vocab();
  return bm25Cache;
}

function encodeSparse(text: string): SparseVector {
  const enc = getBM25();
  return enc ? enc.encode(text) : { indices: [], values: [] };
}

export interface Chunk {
  source: string;
  section: string;
  text: string;
  score: number;
}

export interface ChunkSearch {
  chunks: Chunk[];
  /** False when no embedding was available and the keyword index answered. */
  isVector: boolean;
}

/**
 * Hybrid (dense + BM25) search, or the keyword index when the embedder is
 * down. `keywordText` is what the keyword fallback searches for when it
 * differs from the dense query.
 */
export async function searchChunks(opts: {
  query: string;
  limit: number;
  filterSource?: string | undefined;
  keywordText?: string | undefined;
}): Promise<ChunkSearch> {
  const q = await getQdrant();
  const vector = await embed(opts.query);
  const chunks = vector
    ? await q.hybridSearch(vector, encodeSparse(opts.query), opts.limit, opts.filterSource)
    : await q.searchByText(opts.keywordText ?? opts.query, opts.limit, opts.filterSource);
  return { chunks, isVector: vector !== null };
}

/**
 * Strip the leading "${section}\n\n" prefix from a chunk's stored
 * text so it isn't rendered twice (once in the formatter heading,
 * once at the top of the body). Phase 1.5 prepended the prefix to
 * the stored text so the Qdrant text index catches heading tokens;
 * the display layer strips it back out.
 */
function stripSectionPrefix(section: string, text: string): string {
  const prefix = `${section}\n\n`;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

/** A chunk as the structured outputs carry it: section prefix removed. */
export function toDocChunk(c: Chunk): Chunk {
  return {
    source: c.source,
    section: c.section,
    text: stripSectionPrefix(c.section, c.text),
    score: c.score,
  };
}

/** `### source > section` blocks separated by rules, as the lookups print them. */
export function renderDocBlocks(chunks: readonly Chunk[], heading = "###"): string {
  return chunks
    .map((c) => `${heading} ${c.source} > ${c.section}\n${stripSectionPrefix(c.section, c.text)}\n\n---\n\n`)
    .join("");
}

/**
 * Validate graph rows against a schema. FalkorDB returns untyped rows; a
 * row that does not match is a graph defect, so this throws with the path.
 */
export function parseRows<S extends z.ZodType>(schema: S, result: { data: unknown[] }): z.infer<S>[] {
  return z.array(schema).parse(result.data);
}

/** Rows that carry one `name` column. */
const NameRow = z.object({ name: z.string().nullable() });

export function names(result: { data: unknown[] }): string[] {
  return parseRows(NameRow, result)
    .map((r) => r.name)
    .filter((n): n is string => Boolean(n));
}

/** "k=v, k=v" over the keys of a filter that were given. */
export function describeFilter(filter: Record<string, string | undefined>): string {
  return Object.entries(filter)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v ?? ""}`)
    .join(", ");
}

/**
 * Up to five names that contain the query, or whose tail after the first
 * `sep`-separated word the query contains. Nothing for queries under
 * three characters.
 */
export function suggestNames(query: string, all: readonly string[], sep: string): string[] {
  if (query.length < 3) return [];
  const lname = query.toLowerCase();
  return all
    .filter((n) => {
      if (n.includes(lname)) return true;
      const stem = n.split(sep).slice(1).join(sep);
      return stem !== "" && lname.includes(stem);
    })
    .slice(0, 5);
}

/**
 * A register query as the graph keys it: upper case, no "$", and a one- or
 * two-digit address read as a zero-page one ("$01", "01" and "1" are
 * $0001, the processor port R6510). Letters alone ("A", "FF") stay a name
 * unless "$" or a leading 0 marks them as an address. Before the port had
 * Register nodes (#19) no register lived below $D000, so a short address
 * matched nothing.
 */
export function registerKey(query: string): string {
  const raw = query.trim().toUpperCase();
  const key = raw.replace(/^\$/, "");
  const isAddress = raw.startsWith("$") || /^[0-9]/.test(key);
  return isAddress && /^[0-9A-F]{1,2}$/.test(key) ? key.padStart(4, "0") : key;
}
