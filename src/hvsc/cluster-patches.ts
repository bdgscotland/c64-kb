/**
 * Post-ingest pass: cluster Patch nodes into PatchFamily vocabulary entries.
 * Deterministic — family id is sha256 of the family key, so re-running is
 * idempotent. populator="cluster" leaves room for a future VQ codebook.
 */
import { createHash } from "node:crypto";
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import { patchFamilyKey, type RawPatch } from "./mine.js";

export interface PatchClusterParams {
  adsrTolerance: number;
  pwTolerance: number;
}

export async function clusterPatchesInGraph(
  c: FalkorHvscClient,
  params: PatchClusterParams,
): Promise<void> {
  // Paginate the patch read: FalkorDB caps a single result set at
  // RESULTSET_SIZE (10000) rows, so a one-shot MATCH would silently drop
  // patches past the cap. ORDER BY patch_hash (unique) makes SKIP/LIMIT
  // pagination deterministic — without it, SKIP/LIMIT can skip or duplicate
  // rows. BATCH stays below the cap.
  const BATCH = 5000;
  let skip = 0;
  while (true) {
    const rows = await c.rawQuery<{
      patch_hash: string; adsr: string; waveform: string;
      filter_routed: boolean; hard_restart: string;
    }>(
      `MATCH (p:Patch)
       RETURN p.patch_hash AS patch_hash, p.adsr AS adsr, p.waveform AS waveform,
              p.filter_routed AS filter_routed, p.hard_restart AS hard_restart
       ORDER BY p.patch_hash SKIP $skip LIMIT $limit`,
      { skip, limit: BATCH },
    );
    if (rows.length === 0) break;

    for (const r of rows) {
      const raw: RawPatch = {
        patch_hash: r.patch_hash,
        adsr: JSON.parse(r.adsr ?? "[]"),
        waveform: r.waveform ?? "saw",
        filter_routed: !!r.filter_routed,
        hard_restart: r.hard_restart ?? "",
      };
      const key = patchFamilyKey(raw, params.adsrTolerance);
      const familyId = createHash("sha256").update(key).digest("hex").slice(0, 16);
      await c.rawWrite(
        `MERGE (f:PatchFamily {id: $fid})
           ON CREATE SET f.key = $key, f.populator = 'cluster'
         WITH f
         MATCH (p:Patch {patch_hash: $ph})
         MERGE (p)-[:INSTANCE_OF]->(f)`,
        { fid: familyId, key, ph: r.patch_hash },
      );
    }

    if (rows.length < BATCH) break;
    skip += BATCH;
  }

  // Aggregate Composer-FAVORS_PATCH from USES_PATCH + COMPOSED_BY + INSTANCE_OF.
  // Bind the intermediate Tune/USES_PATCH/Patch (NOT anonymous): FalkorDB
  // collapses an all-anonymous path to distinct endpoints, which would flatten
  // every weight to 1.
  //
  // Weight is the COMPOSITION incidence — count(DISTINCT t.file_md5), NOT
  // count(u). A SID file holds many subtune indices of the same composition
  // (mean 1.44, up to 36.9x for prolific composers) that all share identical
  // patches, so per-subtune count(u) inflated the palette 3-40x and flipped the
  // top patch for Galway/Hubbard/Tel (2026-05-28 subtune-contamination sweep).
  // Distinct-file count is the composition-level unit the palette should rank.
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[u:USES_PATCH]->(p:Patch)-[:INSTANCE_OF]->(f:PatchFamily)
     WITH comp, f, count(DISTINCT t.file_md5) AS w
     MERGE (comp)-[r:FAVORS_PATCH]->(f)
     SET r.weight = w`,
    {},
  );
}
