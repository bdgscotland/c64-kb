import type { FalkorHvscClient } from "../services/falkor-hvsc.js";
import { clusterPatchesInGraph } from "./cluster-patches.js";
import { clusterMotifsInGraph } from "./cluster-motifs.js";
import { clusterPhrasesInGraph } from "./cluster-phrases.js";
import { clusterArpsInGraph } from "./cluster-arps.js";
import { clusterGesturesInGraph } from "./cluster-gestures.js";
import { clusterTimbreGesturesInGraph } from "./cluster-timbre-gestures.js";
import { clusterProgressionsInGraph } from "./cluster-progressions.js";
import { clusterMultiplexInGraph } from "./cluster-multiplex.js";
import { clusterGrammarInGraph } from "./cluster-grammar.js";
import { clusterHooksInGraph } from "./cluster-hooks.js";
import { clusterFormInGraph } from "./cluster-form.js";
import { clusterDirectionInGraph } from "./cluster-direction.js";
import { extractMelodiesInGraph } from "./extract-melodies.js";

/**
 * Corpus-global finalization: form families + FAVORS_* edges (+ multiplex flags)
 * across the WHOLE graph. Must run AFTER per-tune hydration — clustering needs
 * every tune present at once, so it cannot run inside the per-tune parallel
 * workers. Idempotent (re-running re-derives the same families). Each layer is
 * independent, so order is for readability only.
 *
 * This is the step that makes palettes + salience reflect newly-ingested tunes;
 * `ingest:hvsc` runs it automatically as its finalizer so it can't be forgotten.
 */
export async function clusterAll(c: FalkorHvscClient, cacheDir: string): Promise<void> {
  await clusterPatchesInGraph(c, { adsrTolerance: 4, pwTolerance: 256 });
  await clusterMotifsInGraph(c);
  await clusterPhrasesInGraph(c);
  await clusterArpsInGraph(c);
  await clusterGesturesInGraph(c);
  await clusterTimbreGesturesInGraph(c);
  await clusterProgressionsInGraph(c);
  await clusterMultiplexInGraph(c, cacheDir);
  await clusterGrammarInGraph(c, cacheDir);  // creates Hook nodes + USES_HOOK from cache
  await clusterHooksInGraph(c);              // clusters Hook -> HookFamily + FAVORS_HOOK
  await clusterFormInGraph(c, cacheDir);     // Section energy + ArcShape/HAS_ARC + FAVORS_ARC (layer 5)
  await clusterDirectionInGraph(c, cacheDir);// Cadence + ENDS_PHRASE_ON + FAVORS_CADENCE (layer 4b)
  extractMelodiesInGraph({ workers: 8, graph: c.graphName }); // real note-streams + parametric timbre onto VoiceParts (same graph as the client)

  // Enforce non-staleness: if the graph has patches but clustering produced no
  // FAVORS_PATCH edges, the families silently failed to form — fail loud rather
  // than leave palettes/salience reading an empty palette. (r is bound + counted,
  // per the FalkorDB anonymous-path count gotcha.)
  const rows = await c.rawQuery<{ patches: number; fav: number }>(
    `MATCH (p:Patch) WITH count(p) AS patches
     OPTIONAL MATCH (:Composer)-[r:FAVORS_PATCH]->(:PatchFamily)
     RETURN patches AS patches, count(r) AS fav`, {});
  const patches = Number(rows[0]?.patches ?? 0);
  const fav = Number(rows[0]?.fav ?? 0);
  if (patches > 0 && fav === 0) {
    throw new Error(`clusterAll: ${patches} Patch nodes but 0 FAVORS_PATCH edges — clustering failed; graph would be stale`);
  }
}
