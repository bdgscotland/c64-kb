/**
 * Post-ingest pass: aggregate Composer-FAVORS_PHRASE edges from
 * VoicePart-USES_PHRASE + COMPOSED_BY. Phrases are already globally deduped
 * at upsert (by sha256(key)), so there is NO family step here (unlike
 * clusterMotifsInGraph / clusterPatchesInGraph).
 *
 * The intermediate Tune / VoicePart / USES_PHRASE are bound (NOT anonymous):
 * FalkorDB collapses an all-anonymous path to distinct endpoints, which would
 * flatten every weight to 1. count(u) over the bound USES_PHRASE edge is the
 * true incidence count.
 */
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";

export async function clusterPhrasesInGraph(c: FalkorHvscClient): Promise<void> {
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart)-[u:USES_PHRASE]->(p:Phrase)
     WITH comp, p, count(u) AS w
     MERGE (comp)-[r:FAVORS_PHRASE]->(p)
     SET r.weight = w`,
    {},
  );
}
