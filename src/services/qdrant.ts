import { QdrantClient, type Schemas } from "@qdrant/js-client-rest";
import { z } from "zod";
import { config } from "../config.ts";

const COLLECTION = config.qdrant.collection;
// Extra fused points fetched so a tie at the cut is broken by id, not by Qdrant's order.
const TIE_MARGIN = 20;
const VECTOR_SIZE = config.qdrant.vectorSize;

export interface ChunkPayload {
  source: string;
  section: string;
  text: string;
  ingested_at: string;
  [key: string]: unknown;
}

export interface SourceCategory {
  category: string;
  sources: { source: string; chunks: number }[];
  totalChunks: number;
  totalDocs: number;
}

// The payload fields every chunk is written with (see upsertChunks); others pass through.
const ChunkPayloadSchema = z.looseObject({
  source: z.string(),
  section: z.string(),
  text: z.string(),
  ingested_at: z.string(),
});

/** Check a point's payload at the boundary instead of casting it. */
function toChunk(payload: unknown): ChunkPayload {
  return ChunkPayloadSchema.parse(payload);
}

function sourceFilter(source: string): Schemas["Filter"] {
  return { must: [{ key: "source", match: { value: source } }] };
}

// Upper bound on distinct source files returned by one facet request.
const FACET_LIMIT = 100_000;

// Group by category using the c64-kb docs taxonomy: top-level directory if
// it's one we know, "core" for top-level .md files, "other" for anything
// else. Matches the WALK_PRIORITY order in src/ingest.ts so dashboard
// buckets line up with ingest order.
const C64_BUCKETS: readonly (readonly [string, string])[] = [
  ["hardware/", "hardware"],
  ["toolchains/", "toolchains"],
  ["runtime/", "runtime"],
  ["formats/", "formats"],
  ["recipes/", "recipes"],
  ["techniques/", "techniques"],
];

function categoryOf(source: string): string {
  const bucket = C64_BUCKETS.find(([prefix]) => source.startsWith(prefix));
  if (bucket) return bucket[1];
  return source.includes("/") ? "other" : "core";
}

/** Sorted by total chunks desc, with alphabetical tiebreakers so equal counts order the same every run. */
function groupSources(counts: ReadonlyMap<string, number>): SourceCategory[] {
  const categories = new Map<string, { source: string; chunks: number }[]>();
  for (const [source, chunks] of counts) {
    const category = categoryOf(source);
    const list = categories.get(category) ?? [];
    list.push({ source, chunks });
    categories.set(category, list);
  }
  return Array.from(categories.entries())
    .map(([category, sources]) => {
      sources.sort((a, b) => b.chunks - a.chunks || a.source.localeCompare(b.source));
      return {
        category,
        sources,
        totalChunks: sources.reduce((n, x) => n + x.chunks, 0),
        totalDocs: sources.length,
      };
    })
    .sort((a, b) => b.totalChunks - a.totalChunks || a.category.localeCompare(b.category));
}

export class QdrantService {
  private client: QdrantClient;

  constructor(url: string = config.qdrant.url) {
    this.client = new QdrantClient({ url });
  }

  async ensureCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    const exists = collections.collections.some((c) => c.name === COLLECTION);
    if (!exists) {
      await this.client.createCollection(COLLECTION, {
        vectors: {
          dense: { size: VECTOR_SIZE, distance: "Cosine" },
        },
        sparse_vectors: {
          bm25: { modifier: "idf" },
        },
      });
      // Payload indexes for filtering
      await this.client.createPayloadIndex(COLLECTION, {
        field_name: "source",
        field_schema: "keyword",
      });
      // Full-text index kept for legacy searchByText fallback path
      await this.client.createPayloadIndex(COLLECTION, {
        field_name: "text",
        field_schema: {
          type: "text",
          tokenizer: "word",
          lowercase: true,
        },
      });
    }
  }

  async upsertChunks(
    chunks: {
      id: string;
      dense: number[];
      sparse: { indices: number[]; values: number[] };
      payload: ChunkPayload;
    }[],
  ): Promise<void> {
    // Batch in groups of 100
    for (let i = 0; i < chunks.length; i += 100) {
      const batch = chunks.slice(i, i + 100);
      await this.client.upsert(COLLECTION, {
        points: batch.map((c) => ({
          id: c.id,
          vector: {
            dense: c.dense,
            bm25: c.sparse,
          },
          payload: c.payload,
        })),
      });
    }
  }

  async search(
    vector: number[],
    limit = 5,
    filterSource?: string,
  ): Promise<(ChunkPayload & { score: number })[]> {
    const filter = filterSource ? sourceFilter(filterSource) : undefined;

    const results = await this.client.query(COLLECTION, {
      query: vector,
      using: "dense",
      limit,
      ...(filter ? { filter } : {}),
      with_payload: true,
    });

    return results.points.map((r) => ({ ...toChunk(r.payload), score: r.score }));
  }

  async searchByText(
    text: string,
    limit = 5,
    filterSource?: string,
  ): Promise<(ChunkPayload & { score: number })[]> {
    // Full-text search fallback using Qdrant's text index (word tokenized)
    const must: Schemas["FieldCondition"][] = [{ key: "text", match: { text } }];
    if (filterSource) {
      must.push({ key: "source", match: { value: filterSource } });
    }

    const results = await this.client.scroll(COLLECTION, {
      filter: { must },
      limit,
      with_payload: true,
      with_vector: false,
    });

    return results.points.map((r) => ({ ...toChunk(r.payload), score: 1.0 }));
  }

  /**
   * Native Qdrant hybrid search via the Query API. Issues a single
   * request with two prefetches (dense + sparse) and fuses results
   * server-side using RRF.
   *
   * If `sparseVec` is empty (cold-start, no BM25 vocab yet), the
   * sparse prefetch is omitted and the query degrades to dense-only.
   */
  async hybridSearch(
    denseVec: number[],
    sparseVec: { indices: number[]; values: number[] },
    limit = 5,
    filterSource?: string,
  ): Promise<(ChunkPayload & { score: number })[]> {
    const filter = filterSource ? sourceFilter(filterSource) : undefined;

    const prefetch: Schemas["Prefetch"][] = [
      {
        query: denseVec,
        using: "dense",
        limit: Math.max(limit, 20),
        ...(filter ? { filter } : {}),
      },
    ];

    if (sparseVec.indices.length > 0) {
      prefetch.push({
        query: sparseVec,
        using: "bm25",
        limit: Math.max(limit, 20),
        ...(filter ? { filter } : {}),
      });
    }

    // RRF scores tie often (a point first in one list and absent from the
    // other scores the same as its mirror), and Qdrant returns tied points in
    // no fixed order: the same query gave four different top-5s in four runs.
    // Fetch past the cut, then order by score and id so ties break the same
    // way every time.
    const results = await this.client.query(COLLECTION, {
      prefetch,
      query: { fusion: "rrf" },
      limit: limit + TIE_MARGIN,
      with_payload: true,
    });

    return results.points
      .map((r) => ({ id: String(r.id), score: r.score, payload: toChunk(r.payload) }))
      .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit)
      .map((r) => ({ ...r.payload, score: r.score }));
  }

  async deleteBySource(source: string): Promise<void> {
    // wait: the client defaults to not waiting, so an upsert or a search right
    // after could still see the old points.
    await this.client.delete(COLLECTION, {
      wait: true,
      filter: sourceFilter(source),
    });
  }

  /** Drop the whole collection. `ingest --clean` follows this with ensureCollection(). */
  async dropCollection(): Promise<void> {
    const collections = await this.client.getCollections();
    if (collections.collections.some((c) => c.name === COLLECTION)) {
      await this.client.deleteCollection(COLLECTION);
    }
  }

  async getStats(): Promise<{ total_points: number; segments: number }> {
    const info = await this.client.getCollection(COLLECTION);
    return {
      total_points: info.points_count ?? 0,
      segments: info.segments_count,
    };
  }

  /**
   * Scroll chunks with an exact `source` match.
   * Used by self-improvement heuristics to fetch doc-chunks for a
   * specific source file without a vector query.
   *
   * Returns up to `limit` points (default 20).
   */
  async scrollBySource(source: string, limit = 20): Promise<ChunkPayload[]> {
    const result = await this.client.scroll(COLLECTION, {
      filter: sourceFilter(source),
      limit,
      with_payload: true,
      with_vector: false,
    });

    return result.points.map((r) => toChunk(r.payload));
  }

  /**
   * Chunk counts per source file, grouped by top-level docs directory.
   * One exact facet request on the keyword-indexed `source` field; this used
   * to scroll every point to count them.
   */
  async getSourceBreakdown(): Promise<SourceCategory[]> {
    const [facet, info] = await Promise.all([
      this.client.facet(COLLECTION, { key: "source", exact: true, limit: FACET_LIMIT }),
      this.client.getCollection(COLLECTION),
    ]);
    const counts = new Map<string, number>();
    for (const hit of facet.hits) counts.set(String(hit.value), hit.count);
    // A point with no `source` is absent from the facet; the scroll counted it as "unknown".
    const missing = (info.points_count ?? 0) - facet.hits.reduce((n, h) => n + h.count, 0);
    if (missing > 0) counts.set("unknown", (counts.get("unknown") ?? 0) + missing);
    return groupSources(counts);
  }
}
