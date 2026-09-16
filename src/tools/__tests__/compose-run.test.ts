import { describe, it, expect } from "vitest";
import { composeScore } from "../compose-run.js";
import { readFileSync } from "node:fs";

describe("composeScore", () => {
  it("renders + inspects (no target_composer -> no style grade)", async () => {
    const score = {
      meta: { title: "R", key: "C", mode: "major", tempo_bpm: 120, beats_per_bar: 4 },
      sections: [{ label: "A", start_bar: 0, bars: 1, chords: ["C"] }],
      voices: [{ voice: 1, role: "lead", patch: { waveform: "pulse", adsr: [0, 9, 9, 13] },
                 notes: [{ beat: 0, dur_beats: 1, midi: 60 }, { beat: 1, dur_beats: 1, midi: 64 }] }],
    };
    const res = await composeScore(score);
    expect(res.report.non_silent).toBe(true);
    expect(res.report.consonance_pct).toBe(100);
    expect(res.report.style).toBeUndefined();
    expect(readFileSync(res.sidPath).subarray(0, 4).toString()).toBe("PSID");
  });
});
