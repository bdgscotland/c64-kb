import { describe, it, expect } from "vitest";
import { mineDirection } from "../mine.js";

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const note = (frame: number, midi: number) => ({ frame, voice: 1, kind: "on", pitch: hz(midi), sid_chip: 1 });
/** Build on-events: each group is a phrase (onsets step 8); a big gap separates phrases. */
function phrases(groups: number[][], step = 8, gap = 160) {
  const ev: ReturnType<typeof note>[] = [];
  let f = 0;
  for (const g of groups) { for (const m of g) { ev.push(note(f, m)); f += step; } f += gap; }
  return ev;
}

describe("mineDirection", () => {
  it("segments on rests and classifies cadence (closed on tonic, open on the 5th)", () => {
    // C major (tonic pc 0). Phrase 1 ends on C (tonic → closed); phrase 2 ends on G (5th → open).
    const d = mineDirection(phrases([[79, 81, 83, 84], [76, 77, 79]]), 0);
    expect(d.n_phrases).toBe(2);
    expect(d.cadences[0].degree).toBe(0);
    expect(d.cadences[0].closed).toBe(true);
    expect(d.cadences[1].degree).toBe(7);
    expect(d.cadences[1].closed).toBe(false);
  });

  it("resolution_rate = fraction of phrase-ends reached by step (voice-leading)", () => {
    // p1 ends E by step (76-74=2); p2 ends G by leap (79-72=7).
    const d = mineDirection(phrases([[72, 74, 76], [72, 79]]), 0);
    expect(d.resolution_rate).toBeCloseTo(0.5, 5);
  });

  it("qa_rate = fraction of consecutive phrases that go open → closed", () => {
    // p1 ends G (open), p2 ends C (closed) → one Q&A pair.
    const d = mineDirection(phrases([[76, 77, 79], [79, 81, 84]]), 0);
    expect(d.qa_rate).toBeCloseTo(1.0, 5);
  });

  it("computes mean phrase length", () => {
    const d = mineDirection(phrases([[72, 74, 76, 77], [79, 81]]), 0);
    expect(d.mean_phrase_len).toBeCloseTo(3, 5);
    expect(d.n_phrases).toBe(2);
  });

  it("subdivides a long continuous run into bounded phrases (SID leads have few rests)", () => {
    // 24 notes, uniform spacing, NO gaps → must still split (bounded), not one mega-phrase
    const run = Array.from({ length: 24 }, (_, i) => 72 + (i % 5));
    const d = mineDirection(phrases([run]), 0);
    expect(d.n_phrases).toBeGreaterThanOrEqual(2);
    expect(d.mean_phrase_len).toBeLessThanOrEqual(12);
  });

  it("empty stream → no phrases", () => {
    const d = mineDirection([], 0);
    expect(d.n_phrases).toBe(0);
    expect(d.cadences).toEqual([]);
  });
});
