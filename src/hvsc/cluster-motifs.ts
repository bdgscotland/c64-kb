/**
 * Post-ingest pass: cluster Motif nodes into MotifFamily vocabulary entries
 * by melodic contour (the sign of each interval). Deterministic — family id is
 * sha256 of the contour key, so re-running is idempotent. populator="cluster"
 * leaves room for a future codebook. Mirrors clusterPatchesInGraph.
 */
import { createHash } from "node:crypto";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import { motifContourKey } from "./mine.js";

export async function clusterMotifsInGraph(c: FalkorHvscClient): Promise<void> {
  // Paginate the motif read: FalkorDB caps a single result set at
  // RESULTSET_SIZE (10000) rows. ORDER BY motif_hash (unique) makes SKIP/LIMIT
  // deterministic.
  const BATCH = 5000;
  let skip = 0;
  while (true) {
    const rows = await c.rawQuery<{ motif_hash: string; intervals: string }>(
      `MATCH (m:Motif)
       RETURN m.motif_hash AS motif_hash, m.intervals AS intervals
       ORDER BY m.motif_hash SKIP $skip LIMIT $limit`,
      { skip, limit: BATCH },
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      const intervals: number[] = JSON.parse(r.intervals ?? "[]");
      const key = motifContourKey(intervals);
      const familyId = createHash("sha256").update(key).digest("hex").slice(0, 16);
      await c.rawWrite(
        `MERGE (f:MotifFamily {id: $fid})
           ON CREATE SET f.key = $key, f.populator = 'cluster'
         WITH f
         MATCH (m:Motif {motif_hash: $mh})
         MERGE (m)-[:INSTANCE_OF]->(f)`,
        { fid: familyId, key, mh: r.motif_hash },
      );
    }

    if (rows.length < BATCH) break;
    skip += BATCH;
  }

  // Aggregate Composer-FAVORS_MOTIF from USES_MOTIF + COMPOSED_BY + INSTANCE_OF.
  // Bind the intermediate Tune/USES_MOTIF/Motif (NOT anonymous): FalkorDB
  // collapses an all-anonymous path to distinct endpoints, which would flatten
  // every weight to 1.
  //
  // Weight is the COMPOSITION incidence — count(DISTINCT t.file_md5), NOT
  // count(u): per-subtune counting over-weights prolific multi-subtune files
  // (mean 1.44, up to 36.9x) whose subtunes share identical motifs. Mirrors the
  // FAVORS_PATCH fix (2026-05-28 subtune-contamination sweep).
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[u:USES_MOTIF]->(m:Motif)-[:INSTANCE_OF]->(f:MotifFamily)
     WITH comp, f, count(DISTINCT t.file_md5) AS w
     MERGE (comp)-[r:FAVORS_MOTIF]->(f)
     SET r.weight = w`,
    {},
  );
}
