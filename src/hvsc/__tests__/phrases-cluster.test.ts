import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";

const GRAPH = "c64_hvsc_phrasecluster_test";
let c: FalkorHvscClient;

const PHRASE = {
  key: "4,-2|1:1;1:1;1:1",
  intervals: [4, -2],
  iois: [1, 1, 1],
  gates: [1, 1, 1],
  voice: 1,
  sid_chip: 1,
  occurrences: 3,
};

async function tuneWithPhrase(md5: string) {
  await c.upsertTune({
    file_md5: md5, subtune_index: 0, title: "T", composer: "X",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/" + md5,
  });
  await c.upsertVoiceParts(md5, 0, [{
    voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
    noteCount: 10, noisePercent: 0, avgGateLengthFrames: 6, rhythmRegularity: 0.5,
  }]);
  await c.upsertPhrases(md5, 0, [PHRASE]);
}

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
  // Two tunes by the SAME composer use the SAME phrase -> FAVORS_PHRASE weight must be 2.
  await tuneWithPhrase("a".repeat(32));
  await tuneWithPhrase("b".repeat(32));
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("clusterPhrasesInGraph", () => {
  it("builds Composer-FAVORS_PHRASE with a non-flattened weight (bound-alias count(u))", async () => {
    const { clusterPhrasesInGraph } = await import("../cluster-phrases.js");
    await clusterPhrasesInGraph(c);
    const fav = await c.rawQuery<{ w: number; n: number }>(
      "MATCH (:Composer {name:'x'})-[r:FAVORS_PHRASE]->(:Phrase) RETURN max(r.weight) AS w, count(r) AS n");
    expect(Number(fav[0].w)).toBe(2); // bound-alias count(u), NOT collapsed to 1
    expect(Number(fav[0].n)).toBe(1); // one distinct phrase shared by both tunes
  });
});
