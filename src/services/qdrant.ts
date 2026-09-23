import { QdrantClient } from "@qdrant/js-client-rest";
import { config } from "../config.ts";

const COLLECTION = config.qdrant.collection;
const VECTOR_SIZE = config.qdrant.vectorSize;

export interface ChunkPayload {
  source: string;
  section: string;
  text: string;
  ingested_at: string;
  [key: string]: unknown;
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
    chunks: Array<{
      id: string;
      dense: number[];
      sparse: { indices: number[]; values: number[] };
      payload: ChunkPayload;
    }>
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
    limit: number = 5,
    filterSource?: string
  ): Promise<Array<ChunkPayload & { score: number }>> {
    const filter = filterSource
      ? {
          must: [
            {
              key: "source",
              match: { value: filterSource },
            },
          ],
        }
      : undefined;

    const results = await this.client.query(COLLECTION, {
      query: vector,
      using: "dense",
      limit,
      ...(filter ? { filter } : {}),
      with_payload: true,
    });

    return (results.points ?? []).map((r) => ({
      ...(r.payload as unknown as ChunkPayload),
      score: r.score ?? 0,
    }));
  }

  async searchByText(
    text: string,
    limit: number = 5,
    filterSource?: string
  ): Promise<Array<ChunkPayload & { score: number }>> {
    // Full-text search fallback using Qdrant's text index (word tokenized)
    const must: any[] = [
      { key: "text", match: { text } },
    ];
    if (filterSource) {
      must.push({ key: "source", match: { value: filterSource } });
    }

    const results = await this.client.scroll(COLLECTION, {
      filter: { must },
      limit,
      with_payload: true,
      with_vector: false,
    });

    return (results.points || []).map((r) => ({
      ...(r.payload as unknown as ChunkPayload),
      score: 1.0,
    }));
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
    limit: number = 5,
    filterSource?: string
  ): Promise<Array<ChunkPayload & { score: number }>> {
    const filter = filterSource
      ? { must: [{ key: "source", match: { value: filterSource } }] }
      : undefined;

    const prefetch: Array<Record<string, unknown>> = [
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

    const results = await this.client.query(COLLECTION, {
      prefetch,
      query: { fusion: "rrf" },
      limit,
      with_payload: true,
    });

    return (results.points ?? []).map((r) => ({
      ...(r.payload as unknown as ChunkPayload),
      score: r.score ?? 0,
    }));
  }

  async deleteBySource(source: string): Promise<void> {
    // wait: the client defaults to not waiting, so an upsert or a search right
    // after could still see the old points.
    await this.client.delete(COLLECTION, {
      wait: true,
      filter: {
        must: [{ key: "source", match: { value: source } }],
      },
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
      segments: info.segments_count ?? 0,
    };
  }

  /**
   * Scroll chunks with an exact `source` match.
   * Used by self-improvement heuristics to fetch doc-chunks for a
   * specific source file without a vector query.
   *
   * Returns up to `limit` points (default 20).
   */
  async scrollBySource(
    source: string,
    limit: number = 20
  ): Promise<Array<ChunkPayload>> {
    const result = await this.client.scroll(COLLECTION, {
      filter: {
        must: [
          {
            key: "source",
            match: { value: source },
          },
        ],
      },
      limit,
      with_payload: true,
      with_vector: false,
    });

    return (result.points ?? []).map(
      (r) => r.payload as unknown as ChunkPayload
    );
  }

  /**
   * Scroll chunks whose `source` payload starts with the given prefix.
   * Used by self-improvement heuristics to fetch doc-chunks for a
   * category (e.g. "techniques/", "recipes/", "pitfalls/") without a
   * vector query.
   *
   * Qdrant's keyword index does not support prefix matching, so this
   * scrolls up to `scanLimit` points and filters client-side.
   *
   * Returns up to `limit` matching points (default 200).
   */
  async scrollBySourcePrefix(
    prefix: string,
    limit: number = 200,
    scanLimit: number = 3000
  ): Promise<Array<ChunkPayload>> {
    const results: ChunkPayload[] = [];
    let offset: string | number | undefined = undefined;
    let scanned = 0;

    while (scanned < scanLimit) {
      const batchSize = Math.min(500, scanLimit - scanned);
      const result = await this.client.scroll(COLLECTION, {
        limit: batchSize,
        with_payload: true,
        with_vector: false,
        ...(offset !== undefined ? { offset } : {}),
      });

      for (const pt of result.points) {
        const source = (pt.payload as any)?.source ?? "";
        if (source.startsWith(prefix)) {
          results.push(pt.payload as unknown as ChunkPayload);
          if (results.length >= limit) return results;
        }
      }

      scanned += result.points.length;
      if (!result.next_page_offset || result.points.length === 0) break;
      offset = result.next_page_offset as string | number;
    }

    return results;
  }

  /**
   * Get document source breakdown by scrolling unique source values.
   * Groups by top-level directory and returns chunk counts per source file.
   */
  async getSourceBreakdown(): Promise<Array<{
    category: string;
    sources: Array<{ source: string; chunks: number }>;
    totalChunks: number;
    totalDocs: number;
  }>> {
    // Scroll all points collecting source counts (payload only, no vectors)
    const sourceCounts = new Map<string, number>();
    let offset: string | number | undefined = undefined;

    for (;;) {
      const result = await this.client.scroll(COLLECTION, {
        limit: 1000,
        with_payload: { include: ["source"] },
        with_vector: false,
        ...(offset !== undefined ? { offset } : {}),
      });

      for (const pt of result.points) {
        const source = (pt.payload as any)?.source ?? "unknown";
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
      }

      if (!result.next_page_offset) break;
      offset = result.next_page_offset as string | number;
    }

    // Group by category using the c64-kb docs taxonomy: top-level
    // directory if it's one we know, "core" for top-level .md files,
    // "other" for anything else. Matches the WALK_PRIORITY order in
    // src/ingest.ts so dashboard buckets line up with ingest order.
    const C64_BUCKETS: ReadonlyArray<readonly [string, string]> = [
      ["hardware/", "hardware"],
      ["toolchains/", "toolchains"],
      ["runtime/", "runtime"],
      ["formats/", "formats"],
      ["recipes/", "recipes"],
      ["techniques/", "techniques"],
    ];
    const categories = new Map<string, Map<string, number>>();
    for (const [source, count] of sourceCounts) {
      let category = "other";
      for (const [prefix, label] of C64_BUCKETS) {
        if (source.startsWith(prefix)) {
          category = label;
          break;
        }
      }
      if (category === "other" && !source.includes("/")) {
        category = "core"; // top-level .md files
      }

      if (!categories.has(category)) categories.set(category, new Map());
      categories.get(category)!.set(source, count);
    }

    // Build result sorted by total chunks desc, alphabetical tiebreakers
    // so equal counts produce identical ordering across runs.
    const result = Array.from(categories.entries()).map(([category, sources]) => {
      const sourceList = Array.from(sources.entries())
        .map(([source, chunks]) => ({ source, chunks }))
        .sort((a, b) => b.chunks - a.chunks || a.source.localeCompare(b.source));
      return {
        category,
        sources: sourceList,
        totalChunks: sourceList.reduce((s, x) => s + x.chunks, 0),
        totalDocs: sourceList.length,
      };
    }).sort((a, b) => b.totalChunks - a.totalChunks || a.category.localeCompare(b.category));

    return result;
  }

  /**
   * Sample vectors with 2D random projection for visualization.
   * Returns points with x,y coords and metadata.
   */
  async sampleVectorsForViz(sampleSize: number = 500): Promise<Array<{
    x: number; y: number; source: string; section: string;
  }>> {
    // Random projection matrix (dense vector dim -> 2), seeded for consistency
    const dim = VECTOR_SIZE;
    const proj = [new Float64Array(dim), new Float64Array(dim)];
    let seed = 42;
    for (let d = 0; d < 2; d++) {
      for (let i = 0; i < dim; i++) {
        seed = (seed * 1664525 + 1013904223) & 0xffffffff;
        proj[d][i] = ((seed >>> 0) / 0xffffffff - 0.5) * 2;
      }
    }

    const allPoints: Array<{ x: number; y: number; source: string; section: string }> = [];

    // Scroll through ALL vectors in batches
    const batchSize = Math.min(sampleSize, 500);
    let offset: string | number | undefined = undefined;
    let remaining = sampleSize;

    while (remaining > 0) {
      const limit = Math.min(batchSize, remaining);
      const result = await this.client.scroll(COLLECTION, {
        limit,
        offset,
        with_payload: true,
        with_vector: ["dense"],
      });

      if (!result.points || result.points.length === 0) break;

      for (const p of result.points) {
        // Named vectors return a record { dense: number[], ... }
        const vecField = p.vector as unknown;
        const vec = (vecField && typeof vecField === "object" && !Array.isArray(vecField)
          ? (vecField as Record<string, number[]>).dense
          : (vecField as number[])) ?? [];
        let x = 0, y = 0;
        if (vec && vec.length === dim) {
          for (let i = 0; i < dim; i++) {
            x += vec[i] * proj[0][i];
            y += vec[i] * proj[1][i];
          }
        }
        const payload = p.payload as any;
        allPoints.push({
          x, y,
          source: payload?.source ?? "",
          section: payload?.section ?? "",
        });
      }

      remaining -= result.points.length;
      offset = result.next_page_offset as string | number | undefined;
      if (!offset) break;
    }

    if (allPoints.length === 0) return [];

    // Normalize to [0, 1]
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of allPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    for (const p of allPoints) {
      p.x = (p.x - minX) / rangeX;
      p.y = (p.y - minY) / rangeY;
    }

    return allPoints;
  }
}
