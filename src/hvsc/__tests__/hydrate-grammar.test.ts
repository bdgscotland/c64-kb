import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorHvscClient } from "../../services/falkor-hvsc.js";
import { hydrateOneTune } from "../hydrate.js";

const GRAPH = "c64_hvsc_hydrate_grammar_test";
const MD5 = "a".repeat(32);
let c: FalkorHvscClient;

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

beforeAll(async () => {
  c = new FalkorHvscClient({ graphName: GRAPH });
  await c.connect();
  await c.dropGraph();
});
afterAll(async () => { await c.dropGraph(); await c.disconnect(); });

describe("hydrate grammar (SP-grammar)", () => {
  it("mines lead-voice grammar and sets grammar_* props on the Tune", async () => {
    // Lead voice (C4-range, ~lead pitch): hook C-D-E stated, repeated,
    // sequenced up a 3rd, then inverted.
    const stream = [60, 62, 64, 60, 62, 64, 64, 66, 68, 64, 62, 60];
    const events: Array<{ frame: number; voice: number; kind: string; pitch: number; sid_chip: number; waveform: string }> = [];
    let f = 0;
    for (const m of stream) {
      events.push({ frame: f, voice: 1, kind: "on", pitch: hz(m), sid_chip: 1, waveform: "pulse" });
      events.push({ frame: f + 6, voice: 1, kind: "off", pitch: 0, sid_chip: 1, waveform: "" });
      f += 8;
    }

    await hydrateOneTune({
      file_md5: MD5, subtune_index: 0,
      meta: { title: "GrammarTest", composer: "Hooky", hvsc_path: "/g.sid", tempo_bpm: 120 },
      instruments: [], patches: [], events, filter_curve: [], pulsewidth: [],
      structure: { sections: [] },
      driver: { hash: "d" }, vibrato: [],
    } as any, { falkor: c, skipQdrant: true });

    const rows = await c.rawQuery<{
      hook: string; strength: number; contour: string; leap: number;
      rep: number; ncount: number; rpt: number; seq: number; inv: number;
    }>(
      `MATCH (t:Tune {file_md5: $m})
       RETURN t.grammar_hook_intervals AS hook, t.grammar_hook_strength AS strength,
              t.grammar_contour AS contour, t.grammar_leap_ratio AS leap,
              t.grammar_repetition_rate AS rep, t.grammar_note_count AS ncount,
              t.grammar_dev_repeat AS rpt, t.grammar_dev_sequence AS seq, t.grammar_dev_invert AS inv`,
      { m: MD5 });

    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.hook).toBe("[2,2]");          // C-D-E hook
    expect(Number(r.ncount)).toBe(12);
    expect(Number(r.strength)).toBeGreaterThan(0);
    expect(["arch", "rise", "fall", "oscillate", "flat"]).toContain(r.contour);
    expect(Number(r.leap)).toBeGreaterThan(0);
    expect(Number(r.rep)).toBeGreaterThan(0);
    expect(Number(r.rpt)).toBeGreaterThanOrEqual(1);   // repeat
    expect(Number(r.seq)).toBeGreaterThanOrEqual(1);   // sequence
    expect(Number(r.inv)).toBeGreaterThanOrEqual(1);   // invert
  });
});
