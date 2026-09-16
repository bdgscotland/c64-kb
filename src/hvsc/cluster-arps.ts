import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
/** Build Composer-FAVORS_ARP{weight} via bound-alias count(u) over USES_ARP. */
export async function clusterArpsInGraph(c: FalkorHvscClient): Promise<void> {
  await c.rawWrite(
    `MATCH (comp:Composer)<-[:COMPOSED_BY]-(t:Tune)-[:HAS_VOICE]->(v:VoicePart)-[u:USES_ARP]->(a:Arp)
     WITH comp, a, count(u) AS w
     MERGE (comp)-[r:FAVORS_ARP]->(a) SET r.weight = w`, {});
}
