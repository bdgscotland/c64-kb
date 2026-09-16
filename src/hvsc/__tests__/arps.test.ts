import { describe, it, expect } from "vitest";
import { mineArps, arpKey } from "../mine.js";

function on(frame: number, voice: number, midi: number) {
  return { frame, voice, kind: "on" as const, pitch: 440 * Math.pow(2, (midi - 69) / 12), sid_chip: 1 };
}
function off(frame: number, voice: number) { return { frame, voice, kind: "off" as const, pitch: 0, sid_chip: 1 }; }

describe("mineArps", () => {
  it("mines a 3-tone minor-triad cycle at a fast rate", () => {
    const cyc = [60, 63, 67];
    const ev: any[] = [];
    let f = 0;
    for (let i = 0; i < 12; i++) { ev.push(on(f, 1, cyc[i % 3])); ev.push(off(f + 1, 1)); f += 2; }
    const arps = mineArps(ev, { minSteps: 6, maxTones: 4, maxRateFrames: 6, periodMax: 4 });
    expect(arps.length).toBe(1);
    expect(arps[0].chord_intervals).toEqual([0, 3, 7]);
    expect(arps[0].cycle).toEqual([0, 3, 7]);
    expect(arps[0].rate_frames).toBe(2);
    expect(arps[0].occurrences).toBe(4);
  });

  it("does not mine a slow melodic line as an arp", () => {
    const ev: any[] = [];
    let f = 0;
    for (const m of [60, 62, 64, 65, 67, 69]) { ev.push(on(f, 1, m)); ev.push(off(f + 10, 1)); f += 16; }
    const arps = mineArps(ev, { minSteps: 6, maxTones: 4, maxRateFrames: 6, periodMax: 4 });
    expect(arps.length).toBe(0);
  });

  it("arpKey is stable and encodes chord+cycle+rate", () => {
    const k1 = arpKey([0, 3, 7], [0, 3, 7], 2);
    expect(k1).toBe(arpKey([0, 3, 7], [0, 3, 7], 2));
    expect(k1).toContain("0,3,7");
    expect(k1).toContain("r2");
  });
});
