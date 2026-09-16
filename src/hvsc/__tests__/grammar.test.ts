import { describe, it, expect } from "vitest";
import { mineGrammar, classifyDevelopmentOp, contourArchetype } from "../mine.js";

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
function note(frame: number, voice: number, midi: number) {
  return { frame, voice, kind: "on", pitch: hz(midi) };
}
function off(frame: number, voice: number) {
  return { frame, voice, kind: "off", pitch: 0 };
}

/** Build on/off events for a midi melody on one voice, uniform onset step + gate. */
function melody(midis: number[], voice = 1, step = 8, gate = 6) {
  const ev: Array<{ frame: number; voice: number; kind: string; pitch: number }> = [];
  let f = 0;
  for (const m of midis) {
    ev.push(note(f, voice, m));
    ev.push(off(f + gate, voice));
    f += step;
  }
  return ev;
}

describe("contourArchetype", () => {
  it("classifies a rising line as rise", () => {
    expect(contourArchetype([60, 62, 64, 65, 67])).toBe("rise");
  });
  it("classifies a falling line as fall", () => {
    expect(contourArchetype([67, 65, 64, 62, 60])).toBe("fall");
  });
  it("classifies an up-then-down line as arch", () => {
    expect(contourArchetype([60, 64, 67, 64, 60])).toBe("arch");
  });
  it("classifies an alternating line as oscillate", () => {
    expect(contourArchetype([60, 64, 60, 64, 60, 64])).toBe("oscillate");
  });
  it("classifies a static line as flat", () => {
    expect(contourArchetype([60, 60, 60])).toBe("flat");
  });
});

describe("classifyDevelopmentOp", () => {
  it("identical pitch + rhythm = repeat", () => {
    expect(classifyDevelopmentOp([60, 62, 64], [60, 62, 64])).toBe("repeat");
  });
  it("same intervals, shifted pitch = sequence", () => {
    expect(classifyDevelopmentOp([60, 62, 64], [64, 66, 68])).toBe("sequence");
  });
  it("mirrored intervals = invert", () => {
    expect(classifyDevelopmentOp([60, 62, 64], [60, 58, 56])).toBe("invert");
  });
  it("same contour shape, different leap sizes = vary", () => {
    // up,up but sizes 2,2 vs 1,5 -> not transposition, same sign pattern
    expect(classifyDevelopmentOp([60, 62, 64], [60, 61, 66])).toBe("vary");
  });
  it("same intervals but rhythm doubled = augment", () => {
    expect(
      classifyDevelopmentOp([60, 62, 64], [60, 62, 64], [4, 4], [8, 8]),
    ).toBe("augment");
  });
});

describe("mineGrammar", () => {
  // Hook C-D-E stated, repeated, sequenced up a 3rd, then inverted.
  const stream = [60, 62, 64, 60, 62, 64, 64, 66, 68, 64, 62, 60];

  it("finds the most-recurrent motif as the hook", () => {
    const g = mineGrammar(melody(stream), { minHookLength: 3, maxHookLength: 6, minOccurrences: 2 });
    expect(g.hook).not.toBeNull();
    expect(g.hook!.intervals).toEqual([2, 2]); // C-D-E contour
    expect(g.hook!.occurrences).toBe(3);
    expect(g.hook!.length).toBe(3);
    expect(g.hook!.strength).toBeGreaterThan(0);
  });

  it("classifies the development of the hook across statements", () => {
    const g = mineGrammar(melody(stream), { minHookLength: 3, maxHookLength: 6, minOccurrences: 2 });
    expect(g.development.repeat).toBeGreaterThanOrEqual(1);
    expect(g.development.sequence).toBeGreaterThanOrEqual(1);
    expect(g.development.invert).toBeGreaterThanOrEqual(1);
  });

  it("computes a phrasing profile", () => {
    const g = mineGrammar(melody(stream), { minHookLength: 3, maxHookLength: 6, minOccurrences: 2 });
    expect(g.phrasing.leap_ratio).toBeGreaterThan(0); // the -4 jumps are leaps
    expect(g.phrasing.leap_ratio).toBeLessThanOrEqual(1);
    expect(g.phrasing.step_ratio).toBeGreaterThan(0);
    expect(g.phrasing.mean_abs_interval).toBeGreaterThan(0);
    expect(["arch", "rise", "fall", "oscillate", "flat"]).toContain(
      g.phrasing.contour_archetype,
    );
    expect(g.note_count).toBe(stream.length);
  });

  it("reports a high repetition_rate for a heavily-repeated melody", () => {
    const g = mineGrammar(melody([60, 62, 64, 60, 62, 64, 60, 62, 64]), {
      minHookLength: 3, maxHookLength: 6, minOccurrences: 2,
    });
    expect(g.phrasing.repetition_rate).toBeGreaterThan(0.5);
  });

  it("ignores static note-repetition and picks a melodic hook", () => {
    // [0,0] (held/retriggered note) recurs more than the melodic motif [2,2],
    // but a hook must have melodic motion — so [2,2] wins, not [0,0].
    const g = mineGrammar(melody([60, 60, 60, 60, 60, 62, 64, 60, 62, 64]), {
      minHookLength: 3, maxHookLength: 6, minOccurrences: 2,
    });
    expect(g.hook).not.toBeNull();
    expect(g.hook!.intervals).toEqual([2, 2]);
  });

  it("returns a null hook for a stream with no recurring motif", () => {
    const g = mineGrammar(melody([60, 67, 61, 72, 55]), {
      minHookLength: 3, maxHookLength: 6, minOccurrences: 2,
    });
    expect(g.hook).toBeNull();
    expect(g.note_count).toBe(5);
  });

  it("returns a null hook and empty profile for an empty stream", () => {
    const g = mineGrammar([], { minHookLength: 3, maxHookLength: 6, minOccurrences: 2 });
    expect(g.hook).toBeNull();
    expect(g.note_count).toBe(0);
    expect(g.development.repeat).toBe(0);
  });
});
