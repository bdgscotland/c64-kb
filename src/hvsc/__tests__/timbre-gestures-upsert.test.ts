/**
 * Tests for FalkorHvscClient.upsertTimbreGestures (T2).
 *
 * Mirrors the structure of gestures.test.ts (vibrato upsertGestures). Skips
 * gracefully if FalkorDB is unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";

const GRAPH = "c64_hvsc_timbre_gesture_test";
const MD5 = "a".repeat(32);

// Shared 16-point template curve (arbitrary but valid).
const TEMPLATE_PWM = Array.from({ length: 16 }, (_, i) => i / 15);
const TEMPLATE_FILTER = Array.from({ length: 16 }, (_, i) => 1 - i / 15);

describe("upsertTimbreGestures", () => {
  let c: FalkorHvscClient;
  let skipReason: string | undefined;

  beforeAll(async () => {
    c = new FalkorHvscClient({ graphName: GRAPH });
    try {
      await c.connect();
      await c.dropGraph();
      // Prerequisite: Tune + VoicePart must exist before USES_TIMBRE_GESTURE edges.
      await c.upsertTune({
        file_md5: MD5, subtune_index: 0, title: "T", composer: "X",
        year: null, chip: "either", region: "PAL", length_sec: null, hvsc_path: "/x",
      });
      await c.upsertVoiceParts(MD5, 0, [
        { voice: 1, sid_chip: 1, role: "lead", avgPitchHz: 440, pitchRange: 12,
          noteCount: 20, noisePercent: 0, avgGateLengthFrames: 20, rhythmRegularity: 0.5 },
        { voice: 2, sid_chip: 1, role: "bass", avgPitchHz: 110, pitchRange: 6,
          noteCount: 15, noisePercent: 0, avgGateLengthFrames: 24, rhythmRegularity: 0.8 },
      ]);
    } catch (err) {
      skipReason = `FalkorDB unavailable: ${String(err)}`;
    }
  });

  afterAll(async () => {
    try { await c.dropGraph(); } catch {}
    try { await c.disconnect(); } catch {}
  });

  it("creates a PWM Gesture node + VoicePart-USES_TIMBRE_GESTURE edge", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }

    await c.upsertTimbreGestures(MD5, 0, [{
      voice: 1, sid_chip: 1,
      kind: "pwm",
      archetype: "sweep_up",
      depth_band: "deep",
      rate_band: "slow",
      gesture_hash: "pwm1234567890abcd",
      template: TEMPLATE_PWM,
      count: 8,
      fraction: 0.72,
    }]);

    const nodes = await c.rawQuery<{ n: number }>(
      "MATCH (g:Gesture {kind:'pwm'}) RETURN count(g) AS n",
    );
    expect(Number(nodes[0].n)).toBe(1);

    const edges = await c.rawQuery<{ n: number; frac: number; cnt: number }>(
      "MATCH (:VoicePart)-[r:USES_TIMBRE_GESTURE]->(:Gesture {kind:'pwm'}) " +
      "RETURN count(r) AS n, max(r.fraction) AS frac, max(r.count) AS cnt",
    );
    expect(Number(edges[0].n)).toBe(1);
    expect(Number(edges[0].frac)).toBeCloseTo(0.72, 5);
    expect(Number(edges[0].cnt)).toBe(8);
  });

  it("stores archetype, depth_band, rate_band on the PWM Gesture node", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }

    const rows = await c.rawQuery<{ arch: string; db: string; rb: string; tmpl: string }>(
      "MATCH (g:Gesture {kind:'pwm'}) " +
      "RETURN g.archetype AS arch, g.depth_band AS db, g.rate_band AS rb, g.template AS tmpl",
    );
    expect(rows.length).toBe(1);
    expect(rows[0].arch).toBe("sweep_up");
    expect(rows[0].db).toBe("deep");
    expect(rows[0].rb).toBe("slow");
    // Template stored as comma-joined string, same convention as other array fields.
    const parsed = rows[0].tmpl.split(",").map(Number);
    expect(parsed).toHaveLength(16);
    expect(parsed[0]).toBeCloseTo(0, 5);
    expect(parsed[15]).toBeCloseTo(1, 5);
  });

  it("creates a filter Gesture node with resonance_band + mode", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }

    await c.upsertTimbreGestures(MD5, 0, [{
      voice: 2, sid_chip: 1,
      kind: "filter",
      archetype: "cutoff_dip",
      depth_band: "medium",
      rate_band: "fast",
      resonance_band: "high",
      mode: "lowpass",
      gesture_hash: "flt9876543210abcd",
      template: TEMPLATE_FILTER,
      count: 3,
      fraction: 0.4,
    }]);

    const nodes = await c.rawQuery<{ n: number }>(
      "MATCH (g:Gesture {kind:'filter'}) RETURN count(g) AS n",
    );
    expect(Number(nodes[0].n)).toBe(1);

    const rows = await c.rawQuery<{ res: string; mode: string }>(
      "MATCH (g:Gesture {kind:'filter'}) " +
      "RETURN g.resonance_band AS res, g.mode AS mode",
    );
    expect(rows[0].res).toBe("high");
    expect(rows[0].mode).toBe("lowpass");

    // Total Gesture nodes = 1 PWM + 1 filter (distinct hashes → distinct nodes).
    const total = await c.rawQuery<{ n: number }>("MATCH (g:Gesture) RETURN count(g) AS n");
    expect(Number(total[0].n)).toBe(2);
  });

  it("dedups: same gesture_hash from a second call reuses the same Gesture node", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }

    // Same hash as the PWM gesture above — should not create a duplicate node.
    await c.upsertTimbreGestures(MD5, 0, [{
      voice: 1, sid_chip: 1,
      kind: "pwm",
      archetype: "sweep_up",
      depth_band: "deep",
      rate_band: "slow",
      gesture_hash: "pwm1234567890abcd", // same hash
      template: TEMPLATE_PWM,
      count: 12,
      fraction: 0.85,
    }]);

    const nodes = await c.rawQuery<{ n: number }>("MATCH (g:Gesture {kind:'pwm'}) RETURN count(g) AS n");
    expect(Number(nodes[0].n)).toBe(1); // still only 1 PWM node

    // Edge properties should be updated to latest values.
    const edges = await c.rawQuery<{ frac: number; cnt: number }>(
      "MATCH (:VoicePart {voice:1})-[r:USES_TIMBRE_GESTURE]->(:Gesture {kind:'pwm'}) " +
      "RETURN r.fraction AS frac, r.count AS cnt",
    );
    expect(Number(edges[0].frac)).toBeCloseTo(0.85, 5);
    expect(Number(edges[0].cnt)).toBe(12);
  });

  it("USES_TIMBRE_GESTURE edge is distinct from USES_GESTURE (vibrato)", async () => {
    if (skipReason) { console.warn(`SKIP: ${skipReason}`); return; }

    // Add a vibrato gesture to the same VoicePart.
    await c.upsertGestures(MD5, 0, [{
      voice: 1, sid_chip: 1, rate_frames: 8, depth_cents: 20, onset_delay_frames: 0, fraction: 0.6,
    }]);

    const timbreEdges = await c.rawQuery<{ n: number }>(
      "MATCH (:VoicePart)-[:USES_TIMBRE_GESTURE]->(:Gesture) RETURN count(*) AS n",
    );
    const vibratoEdges = await c.rawQuery<{ n: number }>(
      "MATCH (:VoicePart)-[:USES_GESTURE]->(:Gesture) RETURN count(*) AS n",
    );
    // Both edge types coexist independently. Exactly 2 timbre edges by now:
    // PWM (voice 1) + filter (voice 2). The dedup test reused voice 1's PWM edge.
    expect(Number(timbreEdges[0].n)).toBe(2);
    expect(Number(vibratoEdges[0].n)).toBe(1);
  });
});
