/**
 * Post-ingest pass: aggregate Composer-FAVORS_GESTURE edges from
 * VoicePart-USES_GESTURE + COMPOSED_BY. Gestures are already coarse-quantized at
 * upsert (rate->frame, depth->10c), so they self-dedup — there is NO family
 * step here (unlike clusterMotifsInGraph / clusterPatchesInGraph).
 *
 * The intermediate Tune / VoicePart / USES_GESTURE are bound (NOT anonymous):
 * FalkorDB collapses an all-anonymous path to distinct endpoints, which would
 * flatten every weight to 1. count(u) over the bound USES_GESTURE edge is the
 * true incidence count.
 */
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";

export async function clusterGesturesInGraph(c: FalkorHvscClient): Promise<void> {
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart)-[u:USES_GESTURE]->(g:Gesture)
     WITH comp, g, count(u) AS w
     MERGE (comp)-[r:FAVORS_GESTURE]->(g)
     SET r.weight = w`,
    {},
  );
}
