/**
 * Post-ingest pass: aggregate Composer-FAVORS_PROGRESSION from
 * Composer<-COMPOSED_BY-Tune-HAS_SECTION->Section-HAS_PROGRESSION->Progression.
 * Progressions self-dedup by id hash, so there is NO family step.
 *
 * The HAS_PROGRESSION alias (hp) is bound (NOT anonymous): FalkorDB collapses an
 * all-anonymous path to distinct endpoints, flattening every weight to 1.
 * count(hp) over the bound edge is the true section incidence.
 */
import type { FalkorHvscClient } from "../services/falkor-hvsc.js";

export async function clusterProgressionsInGraph(c: FalkorHvscClient): Promise<void> {
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[:HAS_SECTION]->(s:Section)-[hp:HAS_PROGRESSION]->(p:Progression)
     WITH comp, p, count(hp) AS w
     MERGE (comp)-[r:FAVORS_PROGRESSION]->(p)
     SET r.weight = w`,
    {},
  );
}
