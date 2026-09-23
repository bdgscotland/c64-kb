/**
 * Chunks -> Qdrant points, shared by batch ingest (src/ingest.ts) and
 * single-file ingest (src/tools/hydrate.ts) so both write the same ids and
 * payloads.
 */

import { createHash } from "node:crypto";
import { config } from "../config.ts";
import type { BM25Encoder } from "../services/bm25.ts";
import type { DocChunk } from "../services/chunker.ts";
import { embedBatch } from "../services/embeddings.ts";
import type { QdrantService } from "../services/qdrant.ts";

/** The text a chunk is embedded and indexed as: its heading path, a blank line, its body. */
export function chunkText(c: DocChunk): string {
  return `${c.section}\n\n${c.text}`;
}

/**
 * Embed a doc's chunks and replace the doc's points in Qdrant. Point ids
 * are derived from (source, section, index), so a section that was renamed
 * or removed would otherwise stay in the collection for ever and keep being
 * retrieved: the doc's old points are deleted before the upsert. A chunk
 * whose embedding failed is left out. Without a BM25 encoder the sparse
 * vector is empty (dense-only contribution). Returns the points written.
 */
export async function replaceDocPoints(
  qdrant: QdrantService,
  doc: { source: string; chunks: DocChunk[]; bm25: BM25Encoder | null },
): Promise<number> {
  const { source, chunks, bm25 } = doc;
  const texts = chunks.map(chunkText);
  const vectors = await embedBatch(texts);
  const points = chunks.flatMap((c, i) => {
    const dense = vectors[i];
    if (!dense) return [];
    const text = chunkText(c);
    return [
      {
        id: createHash("sha256").update(`${source}:${c.section}:${i}`).digest("hex").slice(0, 32),
        dense,
        sparse: bm25 ? bm25.encode(text) : { indices: [], values: [] },
        payload: {
          source,
          section: c.section,
          text,
          embed_model: config.ollama.model,
          ingested_at: new Date().toISOString(),
        },
      },
    ];
  });
  await qdrant.deleteBySource(source);
  if (points.length > 0) await qdrant.upsertChunks(points);
  return points.length;
}
