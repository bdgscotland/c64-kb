import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterProgressionsInGraph } from "../../hvsc/cluster-progressions.js";
import { c64ProgressionLookup, c64ComposerPalette } from "../palette-mcp.js";

const GRAPH = "c64_hvsc_proglookup_test";
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
  await c.upsertProgressions(MD5, 0, [{ order: 0, degrees: "0min-10maj-8maj-7min", length: 4 }]);
  await clusterProgressionsInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("c64ProgressionLookup", () => {
  it("returns the composer's favoured progressions with roman rendering", async () => {
    const res = await c64ProgressionLookup({ composer: "Test Composer", graphName: GRAPH });
    expect(res.progressions.length).toBe(1);
    expect(res.progressions[0].degrees).toBe("0min-10maj-8maj-7min");
    expect(res.progressions[0].weight).toBeGreaterThanOrEqual(1);
    expect(res.progressions[0].roman).toBe("i-bVII-bVI-v");
  });

  it("returns empty for an unknown composer", async () => {
    const res = await c64ProgressionLookup({ composer: "Nobody", graphName: GRAPH });
    expect(res.progressions).toEqual([]);
  });
});

describe("c64ComposerPalette progressions", () => {
  it("includes the progressions array", async () => {
    const res = await c64ComposerPalette({ composer: "Test Composer", graphName: GRAPH });
    expect(Array.isArray(res.progressions)).toBe(true);
    expect(res.progressions[0].degrees).toBe("0min-10maj-8maj-7min");
  });
});
