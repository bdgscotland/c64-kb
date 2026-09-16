import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";

const GRAPH = "c64_hvsc_phase0c_test";

describe("FalkorHvscClient Phase 0c fields", () => {
  let client: FalkorHvscClient;

  beforeAll(async () => {
    client = new FalkorHvscClient({ graphName: GRAPH });
    await client.connect();
  });

  afterAll(async () => {
    try { await client.dropGraph(); } catch {}
    await client.disconnect();
  });

  beforeEach(async () => {
    await client.dropGraph();
  });

  it("persists Phase 0c scalar + JSON fields on the Tune node", async () => {
    await client.upsertTune({
      file_md5: "a".repeat(32),
      subtune_index: 0,
      title: "Test",
      composer: "Anon",
      year: 1986,
      chip: "6581",
      region: "PAL",
      length_sec: 120,
      hvsc_path: "/MUSICIANS/A/Anon/Test.sid",
      key_signature: "A",
      key_mode: "minor",
      key_confidence: 0.76,
      tempo_bpm: 125,
      time_signature_numerator: 4,
      time_signature_denominator: 4,
      top_instruments: [{ id: "voice_1", total_duration_sec: 32.5, percentage: 45.2 }],
      sid_native: {
        instrument_count: 3,
        pwm_depth: 416.2,
        waveform_mix: { pulse: 0.5, saw: 0.5 },
        filter_active_fraction: 0.0,
      },
    });

    const rows = await client.rawQuery<{
      key_signature: string | null;
      key_mode: string | null;
      key_confidence: number;
      tempo_bpm: number | null;
      ts_num: number | null;
      ts_den: number | null;
      top_instruments: string;
      sid_native: string;
    }>(
      `MATCH (t:Tune {file_md5: $md5})
       RETURN t.key_signature AS key_signature,
              t.key_mode AS key_mode,
              t.key_confidence AS key_confidence,
              t.tempo_bpm AS tempo_bpm,
              t.time_signature_numerator AS ts_num,
              t.time_signature_denominator AS ts_den,
              t.top_instruments AS top_instruments,
              t.sid_native AS sid_native`,
      { md5: "a".repeat(32) },
    );

    expect(rows.length).toBe(1);
    const r = rows[0]!;

    expect(r.key_signature).toBe("A");
    expect(r.key_mode).toBe("minor");
    expect(r.key_confidence).toBeCloseTo(0.76, 5);
    expect(r.tempo_bpm).toBe(125);
    expect(r.ts_num).toBe(4);
    expect(r.ts_den).toBe(4);

    const topInstruments = JSON.parse(r.top_instruments);
    expect(topInstruments[0].id).toBe("voice_1");
    expect(topInstruments[0].total_duration_sec).toBe(32.5);
    expect(topInstruments[0].percentage).toBe(45.2);

    const sidNative = JSON.parse(r.sid_native);
    expect(sidNative.pwm_depth).toBe(416.2);
    expect(sidNative.waveform_mix.pulse).toBe(0.5);
    expect(sidNative.instrument_count).toBe(3);
    expect(sidNative.filter_active_fraction).toBe(0.0);
  });

  it("defaults null/zero for missing Phase 0c fields", async () => {
    await client.upsertTune({
      file_md5: "b".repeat(32),
      subtune_index: 0,
      title: "Minimal",
      composer: "Anon",
      year: 1985,
      chip: "6581",
      region: "PAL",
      length_sec: 60,
      hvsc_path: "/MUSICIANS/A/Anon/Minimal.sid",
      // No Phase 0c fields supplied
    });

    const rows = await client.rawQuery<{
      key_signature: string | null;
      key_mode: string | null;
      key_confidence: number;
      tempo_bpm: number | null;
      top_instruments: string;
      sid_native: string;
    }>(
      `MATCH (t:Tune {file_md5: $md5})
       RETURN t.key_signature AS key_signature,
              t.key_mode AS key_mode,
              t.key_confidence AS key_confidence,
              t.tempo_bpm AS tempo_bpm,
              t.top_instruments AS top_instruments,
              t.sid_native AS sid_native`,
      { md5: "b".repeat(32) },
    );

    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.key_signature).toBeNull();
    expect(r.key_mode).toBeNull();
    expect(r.key_confidence).toBe(0.0);
    expect(r.tempo_bpm).toBeNull();
    expect(JSON.parse(r.top_instruments)).toEqual([]);
    expect(JSON.parse(r.sid_native)).toEqual({});
  });
});
