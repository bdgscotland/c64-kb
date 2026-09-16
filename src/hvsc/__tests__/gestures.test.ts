import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";

const GRAPH = "c64_hvsc_gesture_test";

describe("upsertGestures", () => {
  let c: FalkorHvscClient;
  beforeAll(async () => {
    c = new FalkorHvscClient({ graphName: GRAPH });
    await c.connect();
    await c.dropGraph();
    await c.upsertTune({
      file_md5: "a".repeat(32), subtune_index: 0, title: "T", composer: "X",
      year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
    });
    // VoicePart must exist first (USES_GESTURE is a VoicePart edge).
    await c.upsertVoiceParts("a".repeat(32), 0, [{
      voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
      noteCount: 10, noisePercent: 0, avgGateLengthFrames: 20, rhythmRegularity: 0.5,
    }]);
  });
  afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

  it("creates a Gesture node + VoicePart-USES_GESTURE edge", async () => {
    await c.upsertGestures("a".repeat(32), 0, [{
      voice: 1, sid_chip: 1, rate_frames: 8, depth_cents: 19, onset_delay_frames: 0, fraction: 0.8,
    }]);
    const nodes = await c.rawQuery<{ n: number }>("MATCH (g:Gesture {kind:'vibrato'}) RETURN count(g) AS n");
    expect(Number(nodes[0].n)).toBe(1);
    const edges = await c.rawQuery<{ n: number; frac: number }>(
      "MATCH (:VoicePart)-[r:USES_GESTURE]->(:Gesture) RETURN count(r) AS n, max(r.fraction) AS frac");
    expect(Number(edges[0].n)).toBe(1);
    expect(Number(edges[0].frac)).toBeCloseTo(0.8, 5);
  });

  it("dedups by quantized (rate, depth->10c)", async () => {
    // depth 23 quantizes to 20, same as the earlier 19 -> 20: one Gesture node.
    await c.upsertGestures("a".repeat(32), 0, [
      { voice: 1, sid_chip: 1, rate_frames: 8, depth_cents: 23, onset_delay_frames: 0, fraction: 0.5 },
    ]);
    const nodes = await c.rawQuery<{ n: number }>("MATCH (g:Gesture) RETURN count(g) AS n");
    expect(Number(nodes[0].n)).toBe(1);
  });

  it("aggregates Composer-FAVORS_GESTURE with a correct (non-flattened) weight", async () => {
    const { clusterGesturesInGraph } = await import("../cluster-gestures.js");
    // Second tune, SAME composer X, SAME gesture (rate 8, depth->20): weight must be 2.
    await c.upsertTune({
      file_md5: "b".repeat(32), subtune_index: 0, title: "T2", composer: "X",
      year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x2",
    });
    await c.upsertVoiceParts("b".repeat(32), 0, [{
      voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
      noteCount: 10, noisePercent: 0, avgGateLengthFrames: 20, rhythmRegularity: 0.5,
    }]);
    await c.upsertGestures("b".repeat(32), 0, [{
      voice: 1, sid_chip: 1, rate_frames: 8, depth_cents: 19, onset_delay_frames: 0, fraction: 0.7,
    }]);
    await clusterGesturesInGraph(c);
    const fav = await c.rawQuery<{ w: number }>(
      "MATCH (:Composer {name:'x'})-[r:FAVORS_GESTURE]->(:Gesture) RETURN max(r.weight) AS w");
    expect(Number(fav[0].w)).toBe(2);
  });

  it("hydrate aggregates per-voice vibrato into a USES_GESTURE edge", async () => {
    const { hydrateOneTune } = await import("../hydrate.js");
    const md5 = "c".repeat(32);
    // Events so hydrate creates a VoicePart for voice 1.
    const events: any[] = [];
    for (let i = 0; i < 6; i++) {
      events.push({ frame: i * 20, voice: 1, kind: "on", pitch: 440, sid_chip: 1, waveform: "pulse" });
      events.push({ frame: i * 20 + 15, voice: 1, kind: "off", pitch: 0, sid_chip: 1 });
    }
    // 3 of 4 analyzable notes vibrato -> fraction 0.75 >= 0.25 gate.
    const vibrato = [
      { voice: 1, sid_chip: 1, has_vibrato: true, rate_frames: 8, depth_cents: 19, onset_delay_frames: 0 },
      { voice: 1, sid_chip: 1, has_vibrato: true, rate_frames: 8, depth_cents: 21, onset_delay_frames: 1 },
      { voice: 1, sid_chip: 1, has_vibrato: true, rate_frames: 9, depth_cents: 18, onset_delay_frames: 0 },
      { voice: 1, sid_chip: 1, has_vibrato: false },
    ];
    await hydrateOneTune(
      {
        file_md5: md5, subtune_index: 0,
        meta: { title: "H", composer: "W", hvsc_path: "/h" },
        instruments: [], patches: [], events, filter_curve: [], pulsewidth: [],
        structure: {}, driver: { hash: "d" }, vibrato,
      } as any,
      { falkor: c, skipQdrant: true },
    );
    const n = await c.rawQuery<{ n: number; frac: number }>(
      `MATCH (:Tune {file_md5:$m})-[:HAS_VOICE]->(:VoicePart)-[r:USES_GESTURE]->(:Gesture)
       RETURN count(r) AS n, max(r.fraction) AS frac`, { m: md5 });
    expect(Number(n[0].n)).toBe(1);
    expect(Number(n[0].frac)).toBeCloseTo(0.75, 5);
  });

  it("hydrate skips a voice below the fraction gate", async () => {
    const { hydrateOneTune } = await import("../hydrate.js");
    const md5 = "d".repeat(32);
    const events: any[] = [];
    for (let i = 0; i < 6; i++) {
      events.push({ frame: i * 20, voice: 1, kind: "on", pitch: 440, sid_chip: 1, waveform: "pulse" });
      events.push({ frame: i * 20 + 15, voice: 1, kind: "off", pitch: 0, sid_chip: 1 });
    }
    const vibrato = [
      { voice: 1, sid_chip: 1, has_vibrato: true, rate_frames: 8, depth_cents: 19, onset_delay_frames: 0 },
      { voice: 1, sid_chip: 1, has_vibrato: false }, { voice: 1, sid_chip: 1, has_vibrato: false },
      { voice: 1, sid_chip: 1, has_vibrato: false }, { voice: 1, sid_chip: 1, has_vibrato: false },
    ]; // fraction 0.2 < 0.25
    await hydrateOneTune(
      { file_md5: md5, subtune_index: 0, meta: { title: "H2", composer: "W2", hvsc_path: "/h2" },
        instruments: [], patches: [], events, filter_curve: [], pulsewidth: [],
        structure: {}, driver: { hash: "d" }, vibrato } as any,
      { falkor: c, skipQdrant: true },
    );
    const n = await c.rawQuery<{ n: number }>(
      `MATCH (:Tune {file_md5:$m})-[:HAS_VOICE]->(:VoicePart)-[r:USES_GESTURE]->(:Gesture) RETURN count(r) AS n`,
      { m: md5 });
    expect(Number(n[0].n)).toBe(0);
  });

  it("dumpSeed includes the per-voice vibrato gesture", async () => {
    const { dumpSeed } = await import("../dump-seed.js");
    // Reuse tune 'c' from the hydrate test (voice 1 has a gesture).
    const seed = await dumpSeed(c, "c".repeat(32), 0);
    const v1 = seed.voices.find((v) => v.voice === 1);
    expect(v1).toBeTruthy();
    expect(v1!.vibrato).toBeTruthy();
    expect(v1!.vibrato!.rate_frames).toBeGreaterThanOrEqual(7);
    expect(v1!.vibrato!.depth_cents).toBeGreaterThan(0);
  });
});
