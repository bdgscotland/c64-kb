import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { clusterGesturesInGraph } from "../../hvsc/cluster-gestures.js";
import { clusterTimbreGesturesInGraph } from "../../hvsc/cluster-timbre-gestures.js";
import { c64GestureLookup, c64RhythmLookup, c64ComposerPalette, c64GrammarLookup, c64TimbreLookup } from "../palette-mcp.js";

const GRAPH = "c64_hvsc_palette_test";
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
  await c.upsertVoiceParts(MD5, 0, [{
    voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
    noteCount: 10, noisePercent: 0, avgGateLengthFrames: 20, rhythmRegularity: 0.5,
  }]);
  await c.upsertGestures(MD5, 0, [{
    voice: 1, sid_chip: 1, rate_frames: 8, depth_cents: 20, onset_delay_frames: 0, fraction: 0.8,
  }]);
  await c.upsertRhythm(MD5, 0, [{ slots: [[4, 2], [4, 2], [2, 1], [2, 1]], voice: 1, occurrences: 5 }]);
  await c.setTuneGrammar(MD5, 0, {
    hook_intervals: "[2,2]", hook_strength: 0.5, hook_length: 3, hook_occurrences: 3,
    contour: "arch", leap_ratio: 0.3, step_ratio: 0.6, repetition_rate: 0.7,
    mean_abs_interval: 2.5, note_count: 20,
    dev_repeat: 2, dev_sequence: 1, dev_invert: 1, dev_augment: 0, dev_vary: 3,
  });
  await clusterGesturesInGraph(c);
  // Timbre gesture seed: two gestures (pwm weight=2 via two tunes, filter weight=1)
  const MD5_B = "b".repeat(32);
  await c.upsertTune({
    file_md5: MD5_B, subtune_index: 0, title: "T2", composer: "Test Composer",
    year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x2",
  });
  await c.upsertVoiceParts(MD5_B, 0, [{
    voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
    noteCount: 10, noisePercent: 0, avgGateLengthFrames: 20, rhythmRegularity: 0.5,
  }]);
  const PWM_TEMPLATE = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.9, 0.8, 0.7, 0.6, 0.5];
  const FILTER_TEMPLATE = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5];
  const PWM_HASH = "pwm_rise_md_med_test";
  const FILTER_HASH = "filter_fall_sm_slow_test";
  const EMPTY_HASH = "pwm_static_none_slow_empty_test";
  // PWM gesture appears on both tunes → weight 2
  await c.upsertTimbreGestures(MD5, 0, [{
    voice: 1, sid_chip: 1, kind: "pwm", archetype: "rise", depth_band: "md",
    rate_band: "med", resonance_band: undefined, mode: undefined,
    gesture_hash: PWM_HASH, template: PWM_TEMPLATE, count: 3, fraction: 0.6,
  }]);
  await c.upsertTimbreGestures(MD5_B, 0, [{
    voice: 1, sid_chip: 1, kind: "pwm", archetype: "rise", depth_band: "md",
    rate_band: "med", resonance_band: undefined, mode: undefined,
    gesture_hash: PWM_HASH, template: PWM_TEMPLATE, count: 2, fraction: 0.5,
  }, {
    voice: 1, sid_chip: 1, kind: "filter", archetype: "fall", depth_band: "sm",
    rate_band: "slow", resonance_band: "low", mode: "lp",
    gesture_hash: FILTER_HASH, template: FILTER_TEMPLATE, count: 1, fraction: 0.2,
  }, {
    // Empty template → stored as "" via join(","); parse must yield [] not [NaN].
    voice: 1, sid_chip: 1, kind: "pwm", archetype: "static", depth_band: "none",
    rate_band: "slow", resonance_band: undefined, mode: undefined,
    gesture_hash: EMPTY_HASH, template: [], count: 1, fraction: 0.1,
  }]);
  await clusterTimbreGesturesInGraph(c);
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("c64GestureLookup", () => {
  it("returns the composer's favoured vibrato gestures", async () => {
    const res = await c64GestureLookup({ composer: "Test Composer", graphName: GRAPH });
    expect(res.gestures.length).toBeGreaterThanOrEqual(1);
    expect(res.gestures[0].kind).toBe("vibrato");
    expect(res.gestures[0].rate_frames).toBe(8);
    expect(res.gestures[0].depth_cents).toBe(20);
    expect(res.gestures[0].weight).toBeGreaterThanOrEqual(1);
  });

  it("returns empty for an unknown composer", async () => {
    const res = await c64GestureLookup({ composer: "Nobody", graphName: GRAPH });
    expect(res.gestures).toEqual([]);
  });
});

describe("c64RhythmLookup", () => {
  it("returns the composer's common rhythm cells", async () => {
    const res = await c64RhythmLookup({ composer: "Test Composer", graphName: GRAPH });
    expect(res.rhythms.length).toBeGreaterThanOrEqual(1);
    expect(res.rhythms[0].occurrences).toBeGreaterThanOrEqual(1);
    expect(typeof res.rhythms[0].slots).toBe("string");
  });

  it("returns empty for an unknown composer", async () => {
    const res = await c64RhythmLookup({ composer: "Nobody", graphName: GRAPH });
    expect(res.rhythms).toEqual([]);
  });
});

describe("c64GrammarLookup", () => {
  it("returns the composer's mined grammar (hook + dev-ops + phrasing)", async () => {
    const res = await c64GrammarLookup({ composer: "Test Composer", graphName: GRAPH });
    expect(res.grammar.n_tunes).toBe(1);
    expect(res.grammar.hook).not.toBeNull();
    expect(res.grammar.hook!.intervals).toEqual([2, 2]);
    // dev-op distribution is normalized; vary (3 of 7) is the largest
    const dev = res.grammar.development;
    expect(dev.vary).toBeGreaterThan(dev.repeat);
    expect(dev.repeat).toBeGreaterThan(0);
    expect(res.grammar.phrasing.leap_ratio).toBeCloseTo(0.3, 5);
    expect(res.grammar.phrasing.repetition_rate).toBeCloseTo(0.7, 5);
    expect(res.grammar.contour_distribution.some((c) => c.archetype === "arch")).toBe(true);
  });

  it("returns an empty profile for an unknown composer", async () => {
    const res = await c64GrammarLookup({ composer: "Nobody", graphName: GRAPH });
    expect(res.grammar.n_tunes).toBe(0);
    expect(res.grammar.hook).toBeNull();
  });
});

describe("c64ComposerPalette", () => {
  it("bundles the composer's full palette", async () => {
    const res = await c64ComposerPalette({ composer: "Test Composer", graphName: GRAPH });
    expect(res.composer).toBe("Test Composer");
    expect(res.tunes).toBe(2);
    expect(res.gestures.length).toBeGreaterThanOrEqual(1);
    expect(res.rhythms.length).toBeGreaterThanOrEqual(1);
    expect(res.voice_roles.some((vr: { role: string }) => vr.role === "lead")).toBe(true);
    expect(Array.isArray(res.patches)).toBe(true);
    expect(Array.isArray(res.motifs)).toBe(true);
    expect(Array.isArray(res.song_forms)).toBe(true);
    expect(res.grammar.hook!.intervals).toEqual([2, 2]);
    expect(res.grammar.n_tunes).toBe(1);
  });

  it("includes timbre_gestures ordered by weight with template parsed to number[]", async () => {
    const res = await c64ComposerPalette({ composer: "Test Composer", graphName: GRAPH });
    expect(Array.isArray(res.timbre_gestures)).toBe(true);
    expect(res.timbre_gestures.length).toBeGreaterThanOrEqual(2);
    // pwm gesture has weight 2, filter weight 1 — pwm must come first
    expect(res.timbre_gestures[0].kind).toBe("pwm");
    expect(res.timbre_gestures[0].weight).toBe(2);
    expect(res.timbre_gestures[0].archetype).toBe("rise");
    expect(res.timbre_gestures[0].depth_band).toBe("md");
    expect(res.timbre_gestures[0].rate_band).toBe("med");
    // template must be a number[] of length 16
    expect(Array.isArray(res.timbre_gestures[0].template)).toBe(true);
    expect(res.timbre_gestures[0].template).toHaveLength(16);
    expect(typeof res.timbre_gestures[0].template[0]).toBe("number");
    // filter gesture is second
    const filterRow = res.timbre_gestures.find((g) => g.kind === "filter");
    expect(filterRow).toBeDefined();
    expect(filterRow!.weight).toBe(1);
    expect(filterRow!.mode).toBe("lp");
    expect(filterRow!.resonance_band).toBe("low");
    expect(filterRow!.template).toHaveLength(16);
  });

  it("parses an empty/missing template to [] (not [NaN])", async () => {
    const res = await c64ComposerPalette({ composer: "Test Composer", graphName: GRAPH });
    // The static gesture was seeded with template: [] → stored as "" → must parse to [].
    const emptyRow = res.timbre_gestures.find((g) => g.archetype === "static");
    expect(emptyRow).toBeDefined();
    expect(emptyRow!.template).toEqual([]); // not [NaN]; typeof NaN === "number" so length/typeof checks miss it
  });
});

describe("c64TimbreLookup with timbre_gestures", () => {
  it("returns timbre_gestures alongside the timbre profile", async () => {
    const res = await c64TimbreLookup({ composer: "Test Composer", graphName: GRAPH });
    expect(res.timbre).toBeDefined();
    expect(Array.isArray(res.timbre_gestures)).toBe(true);
    expect(res.timbre_gestures.length).toBeGreaterThanOrEqual(2);
    // ordering: pwm (weight 2) before filter (weight 1)
    expect(res.timbre_gestures[0].kind).toBe("pwm");
    expect(res.timbre_gestures[0].weight).toBe(2);
    expect(res.timbre_gestures[0].template).toHaveLength(16);
    expect(typeof res.timbre_gestures[0].template[0]).toBe("number");
  });

  it("returns empty timbre_gestures for an unknown composer", async () => {
    const res = await c64TimbreLookup({ composer: "Nobody", graphName: GRAPH });
    expect(res.timbre_gestures).toEqual([]);
  });
});
