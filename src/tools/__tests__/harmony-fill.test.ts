import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { degreesToChordSymbols, harmonyFill } from "../compose-run.js";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterProgressionsInGraph } from "../../hvsc/cluster-progressions.js";

describe("degreesToChordSymbols", () => {
  it("transposes key-relative degrees into chord symbols for a target key", () => {
    // i-bVII-bVI in A (keyPc 9): degree 0->A min, 10->G maj, 8->F maj.
    expect(degreesToChordSymbols("0min-10maj-8maj", 9)).toEqual(["Am", "G", "F"]);
  });
  it("transposes the same shape into C (keyPc 0)", () => {
    expect(degreesToChordSymbols("0min-10maj-8maj", 0)).toEqual(["Cm", "A#", "G#"]);
  });
});

describe("harmonyFill", () => {
  const GRAPH = "c64_hvsc_harmonyfill_test";
  const MD5 = "a".repeat(32);
  let c: FalkorHvscClient;

  beforeAll(async () => {
    c = new FalkorHvscClient({ graphName: GRAPH });
    await c.connect();
    await c.dropGraph();
    await c.upsertTune({
      file_md5: MD5, subtune_index: 0, title: "T", composer: "Test Composer",
      year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
    });
    await c.upsertSections(MD5, 0, { sections: [{ label: "A", start_frame: 0, end_frame: 100 }], repeat_shape: "A", intro_frames: 0 });
    await c.upsertProgressions(MD5, 0, [{ order: 0, degrees: "0min-10maj-8maj", length: 3 }]);
    await clusterProgressionsInGraph(c);
  });
  afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

  it("transposes the composer's top progression into the target key with roman", async () => {
    const res = await harmonyFill({ composer: "Test Composer", key: "A", graphName: GRAPH });
    expect(res.chords).toEqual(["Am", "G", "F"]);
    expect(res.degrees).toBe("0min-10maj-8maj");
    expect(res.roman).toBe("i-bVII-bVI");
  });

  it("returns empty for an unknown composer", async () => {
    const res = await harmonyFill({ composer: "Nobody", key: "C", graphName: GRAPH });
    expect(res).toEqual({ chords: [], degrees: null, roman: null });
  });

  it("returns empty for an unparseable key", async () => {
    const res = await harmonyFill({ composer: "Test Composer", key: "H", graphName: GRAPH });
    expect(res.chords).toEqual([]);
  });
});
