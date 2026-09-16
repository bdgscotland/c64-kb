/**
 * Post-ingest pass: cluster Hook nodes into HookFamily vocabulary entries by
 * melodic contour (the sign of each interval), then aggregate Composer-FAVORS_HOOK.
 * Mirrors clusterMotifsInGraph exactly — grammar's hook is now a first-class graph
 * citizen like Motif/Phrase/Arp. Deterministic (family id = sha256 of contour key).
 */
import { createHash } from "node:crypto";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import { motifContourKey } from "./mine.js";

export async function clusterHooksInGraph(c: FalkorHvscClient): Promise<void> {
  const BATCH = 5000;
  let skip = 0;
  while (true) {
    const rows = await c.rawQuery<{ hook_hash: string; intervals: string }>(
      `MATCH (h:Hook)
       RETURN h.hook_hash AS hook_hash, h.intervals AS intervals
       ORDER BY h.hook_hash SKIP $skip LIMIT $limit`,
      { skip, limit: BATCH },
    );
    if (rows.length === 0) break;
    for (const r of rows) {
      const intervals: number[] = JSON.parse(r.intervals ?? "[]");
      const key = motifContourKey(intervals);
      const familyId = createHash("sha256").update(key).digest("hex").slice(0, 16);
      await c.rawWrite(
        `MERGE (f:HookFamily {id: $fid})
           ON CREATE SET f.key = $key, f.populator = 'cluster'
         WITH f
         MATCH (h:Hook {hook_hash: $hh})
         MERGE (h)-[:INSTANCE_OF]->(f)`,
        { fid: familyId, key, hh: r.hook_hash },
      );
    }
    if (rows.length < BATCH) break;
    skip += BATCH;
  }

  // Aggregate Composer-FAVORS_HOOK from USES_HOOK + COMPOSED_BY + INSTANCE_OF.
  // Bind the USES_HOOK alias (u) and count(u) — NOT an all-anonymous path (which
  // FalkorDB collapses to distinct endpoints, flattening every weight to 1).
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[u:USES_HOOK]->(h:Hook)-[:INSTANCE_OF]->(f:HookFamily)
     WITH comp, f, count(u) AS w
     MERGE (comp)-[r:FAVORS_HOOK]->(f)
     SET r.weight = w`,
    {},
  );
}
