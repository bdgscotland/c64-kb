import { describe, it, expect } from "vitest";
import { minePhrases, phraseKey } from "../mine.js";

function note(frame: number, voice: number, pitch: number) { return { frame, voice, kind: "on", pitch }; }
function off(frame: number, voice: number)        { return { frame, voice, kind: "off", pitch: 0 }; }

describe("minePhrases", () => {
  it("mines a repeated 5-note phrase with pitch + rhythm", () => {
    // riff: C E D F E, onsets 0/8/16/24/32, gate 6 frames; repeated twice.
    const midis = [60, 64, 62, 65, 64];
    const ev: Array<{ frame: number; voice: number; kind: string; pitch: number }> = [];
    let f = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (const m of midis) {
        const pitch = 440 * Math.pow(2, (m - 69) / 12);
        ev.push(note(f, 1, pitch));
        ev.push(off(f + 6, 1));
        f += 8;
      }
      f += 16;
    }
    const ph = minePhrases(ev, { length: 5, minOccurrences: 2, stepFrames: 8 });
    expect(ph.length).toBe(1);
    expect(ph[0].occurrences).toBe(2);
    expect(ph[0].intervals).toEqual([4, -2, 3, -1]); // C->E->D->F->E
    expect(ph[0].iois).toEqual([1, 1, 1, 1, 1]);     // 8 frames /8 = 1 sixteenth
    expect(ph[0].gates).toEqual([1, 1, 1, 1, 1]);    // 6/8 → round 1
  });

  it("phraseKey is stable + encodes pitch and rhythm", () => {
    const k1 = phraseKey([4, -2], [1, 1, 1], [1, 1, 1]);
    const k2 = phraseKey([4, -2], [1, 1, 1], [1, 1, 1]);
    expect(k1).toBe(k2);
    expect(k1).toContain("4,-2");
  });
});
