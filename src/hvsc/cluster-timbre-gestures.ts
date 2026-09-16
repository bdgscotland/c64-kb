/**
 * Post-ingest pass: aggregate Composer-FAVORS_TIMBRE_GESTURE edges from
 * VoicePart-USES_TIMBRE_GESTURE + COMPOSED_BY. Timbre-gesture nodes (kind ∈
 * {pwm, filter}) are already coarse-quantized at upsert (depth/rate/resonance
 * bands + archetype), so they self-dedup — there is NO separate family step
 * here (unlike clusterMotifsInGraph / clusterPatchesInGraph).
 *
 * The intermediate Tune / VoicePart / USES_TIMBRE_GESTURE are bound (NOT
 * anonymous): FalkorDB collapses an all-anonymous path to distinct endpoints,
 * which would flatten every weight to 1. count(u) over the bound
 * USES_TIMBRE_GESTURE edge is the true incidence count.
 */
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";

export async function clusterTimbreGesturesInGraph(c: FalkorHvscClient): Promise<void> {
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart)-[u:USES_TIMBRE_GESTURE]->(g:Gesture)
     WITH comp, g, count(u) AS w
     MERGE (comp)-[r:FAVORS_TIMBRE_GESTURE]->(g)
     SET r.weight = w`,
    {},
  );
}
