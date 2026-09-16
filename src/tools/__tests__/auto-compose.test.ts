import { describe, it, expect } from "vitest";
import { buildScore } from "../auto-compose.js";
import { HUBBARD_PALETTE, OTHER_PALETTE } from "./fixtures/hubbard-palette.js";

describe("buildScore — shape", () => {
  it("emits a Score targeting the composer with sections covering maxBars", () => {
    const { score, plan } = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 16 });
    expect(score.meta.target_composer).toBe("Rob Hubbard");
    const totalBars = score.sections.reduce((s: number, x: any) => s + x.bars, 0);
    expect(totalBars).toBe(16);
    expect(plan.sections.length).toBe(score.sections.length);
    // every section has a chord per bar
    for (const sec of score.sections) expect(sec.chords.length).toBe(sec.bars);
  });

  it("includes a lead voice with real mined phrases, a bass with notes, and percussion with drums", () => {
    const { score } = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 16 });
    const lead = score.voices.find((v: any) => v.role === "lead");
    const bass = score.voices.find((v: any) => v.role === "bass");
    const perc = score.voices.find((v: any) => v.role === "percussion");
    expect(lead.phrases.length).toBeGreaterThan(0);
    expect(lead.harmonize).toBe(true);
    expect(bass.notes.length).toBeGreaterThan(0);
    expect(perc.drums.length).toBeGreaterThan(0);
  });

  it("places the lead continuously (fills lead sections, not a sparse 2-bar grid)", () => {
    const { score } = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 24 });
    const lead = score.voices.find((v: any) => v.role === "lead");
    const bpb = score.meta.beats_per_bar;
    const leadBeats = score.sections.filter((s: any) => s.label !== "intro")
      .reduce((s: number, x: any) => s + x.bars, 0) * bpb;
    const covered = lead.phrases.reduce((s: number, p: any) => s + p.iois.reduce((a: number, b: number) => a + b, 0), 0);
    expect(lead.phrases.length).toBeGreaterThanOrEqual(15);
    expect(covered / leadBeats).toBeGreaterThan(0.8); // lead fills >80% of its sections (continuous line)
  });

  it("skips octave-jump phrases for the lead (keeps it singable)", () => {
    const { score } = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 16 });
    const lead = score.voices.find((v: any) => v.role === "lead");
    for (const ph of lead.phrases) {
      const span = Math.max(0, ...cumRange(ph.intervals));
      expect(span).toBeLessThanOrEqual(12);
    }
  });
});

describe("buildScore — mode respect (regression: 2026-05-25 finding §8c)", () => {
  it("prefers a 0min-rooted progression when mode=minor, even if a 0maj one is earlier in the palette", () => {
    // The live Hubbard palette orders 0maj-rooted progressions before 0min-rooted
    // ones (because his major-mode tunes dominate his corpus). The old code did
    // `progs.find(startsTonic)` which picks the FIRST 0-rooted match regardless
    // of mode, so mode=minor produced an A-D-A-D chord cell — the bug surfaced
    // in finding §8c. This fixture reproduces that ordering: major-tonic first,
    // minor-tonic later. Expectation: with mode=minor, the score must pick Am.
    const palette = {
      ...HUBBARD_PALETTE,
      progressions: [
        { degrees: "0maj-5maj", length: 2, weight: 20, roman: "I-IV" },     // would have been picked
        { degrees: "0min-5min", length: 2, weight: 10, roman: "i-iv" },     // mode-correct
        { degrees: "5maj-0maj", length: 2, weight: 4, roman: "IV-I" },
      ],
    };
    const { score } = buildScore(palette, { seed: 1, maxBars: 16, key: "A", mode: "minor" });
    const firstChords = score.sections
      .filter((s: any) => s.label !== "intro")
      .map((s: any) => s.chords[0]);
    expect(firstChords).toContain("Am");
    expect(firstChords).not.toContain("A");
  });

  it("prefers a 0maj-rooted progression when mode=major, even if a 0min one is earlier", () => {
    // Symmetric guard: if the palette has a 0min progression first, a
    // mode=major request should still pick a 0maj-rooted one for the HOME
    // section. (Contrast sections may legitimately use a minor progression —
    // borrowed iv, relative minor — so we don't assert on those.)
    const palette = {
      ...HUBBARD_PALETTE,
      progressions: [
        { degrees: "0min-8maj", length: 2, weight: 20, roman: "i-bVI" },
        { degrees: "0maj-5maj", length: 2, weight: 10, roman: "I-IV" },
      ],
    };
    const { score } = buildScore(palette, { seed: 1, maxBars: 16, key: "A", mode: "major" });
    // The intro always uses the home progression — its first chord must be the major tonic
    const intro = score.sections.find((s: any) => s.label === "intro");
    expect(intro.chords[0]).toBe("A");
    // And the first body section (always the home label) too
    const firstBody = score.sections.find((s: any) => s.label !== "intro");
    expect(firstBody.chords[0]).toBe("A");
  });

  it("falls back to whatever 0-rooted progression exists when no mode-match is available", () => {
    // If the palette has no progression in the requested mode, don't crash —
    // fall back to the first 0-rooted one and let the lead carry the mode.
    const palette = {
      ...HUBBARD_PALETTE,
      progressions: [
        { degrees: "0maj-5maj", length: 2, weight: 20, roman: "I-IV" },
      ],
    };
    const { score } = buildScore(palette, { seed: 1, maxBars: 16, key: "A", mode: "minor" });
    const firstChords = score.sections
      .filter((s: any) => s.label !== "intro")
      .map((s: any) => s.chords[0]);
    expect(firstChords).toContain("A");
  });
});

describe("buildScore — determinism", () => {
  it("is byte-identical for the same (seed, ablation)", () => {
    const a = buildScore(HUBBARD_PALETTE, { seed: 7, maxBars: 24 });
    const b = buildScore(HUBBARD_PALETTE, { seed: 7, maxBars: 24 });
    expect(JSON.stringify(a.score)).toBe(JSON.stringify(b.score));
  });
});

describe("buildScore — mix_check gates (Score-derivable)", () => {
  it("keeps drum density at or below the wash gate (10/bar)", () => {
    const { screen } = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 24 });
    expect(screen.drum_density).toBeLessThanOrEqual(10);
    expect(screen.verdict).toBe("ok");
  });
});

describe("buildScore — ablations", () => {
  it("no_timbre strips pwm and the shared filter", () => {
    const { score } = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 16, ablation: "no_timbre" });
    expect(score.filter).toBeFalsy();
    for (const v of score.voices) expect(v.pwm).toBeFalsy();
  });

  it("generic_phrases replaces mined contours with uniform filler", () => {
    const base = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 16 });
    const abl = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 16, ablation: "generic_phrases" });
    const baseLead = base.score.voices.find((v: any) => v.role === "lead");
    const ablLead = abl.score.voices.find((v: any) => v.role === "lead");
    expect(JSON.stringify(ablLead.phrases)).not.toBe(JSON.stringify(baseLead.phrases));
  });

  it("scramble_palette pulls progressions from the alternate palette", () => {
    const { score } = buildScore(HUBBARD_PALETTE, {
      seed: 1, maxBars: 16, ablation: "scramble_palette", scramblePalette: OTHER_PALETTE,
    });
    const chords = new Set(score.sections.flatMap((s: any) => s.chords));
    // OTHER_PALETTE's I-IV / I-V progressions in C minor → contains G or F major-ish roots,
    // and must NOT match Hubbard's signature i-bVI (Cm-Ab) exclusively.
    expect(chords.size).toBeGreaterThan(0);
    const base = buildScore(HUBBARD_PALETTE, { seed: 1, maxBars: 16 });
    const baseChords = new Set(base.score.sections.flatMap((s: any) => s.chords));
    expect([...chords].sort().join(",")).not.toBe([...baseChords].sort().join(","));
  });
});

/** cumulative pitch offsets from the anchor for a phrase's interval list */
function cumRange(intervals: number[]): number[] {
  const out = [0];
  let acc = 0;
  for (const d of intervals) { acc += d; out.push(Math.abs(acc)); }
  return out;
}
