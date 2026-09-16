import { describe, it, expect } from "vitest";
import { mineForm, arcArchetype } from "../mine.js";

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** events: `counts[i]` note-ons spread across section i (each 100 frames), on `voices[i]` voices. */
function build(counts: number[], voices?: number[]) {
  const sections = counts.map((_, i) => ({ order: i, start_frame: i * 100, end_frame: (i + 1) * 100 }));
  const ev: Array<{ frame: number; voice: number; kind: string; pitch: number; sid_chip: number }> = [];
  counts.forEach((n, i) => {
    const nv = voices ? voices[i] : 1;
    for (let k = 0; k < n; k++) {
      ev.push({ frame: i * 100 + (k % 90), voice: 1 + (k % nv), kind: "on", pitch: hz(72), sid_chip: 1 });
    }
  });
  return { sections, ev };
}

describe("arcArchetype", () => {
  it("rising energy → rising", () => expect(arcArchetype([0.1, 0.5, 1.0])).toBe("rising"));
  it("falling energy → falling", () => expect(arcArchetype([1.0, 0.5, 0.1])).toBe("falling"));
  it("low-high-low → arch", () => expect(arcArchetype([0.1, 1.0, 0.1])).toBe("arch"));
  it("flat → flat", () => expect(arcArchetype([0.5, 0.5, 0.5])).toBe("flat"));
  it("zig-zag → oscillate", () => expect(arcArchetype([0.1, 1.0, 0.1, 1.0, 0.1])).toBe("oscillate"));
});

describe("mineForm", () => {
  it("classifies a rising arc and finds the peak section", () => {
    const { sections, ev } = build([8, 16, 24, 32]);
    const f = mineForm(ev, sections);
    expect(f.sections.length).toBe(4);
    expect(f.arc).toBe("rising");
    expect(f.peak_section).toBe(3);
    expect(f.energy_range).toBeGreaterThan(0.2);
    expect(f.sections[3].energy).toBeGreaterThan(f.sections[0].energy);
  });

  it("classifies an arch (build to a mid peak, release)", () => {
    const { sections, ev } = build([8, 32, 30, 8]);
    const f = mineForm(ev, sections);
    expect(f.arc).toBe("arch");
    expect([1, 2]).toContain(f.peak_section);
  });

  it("flat when every section has equal energy", () => {
    const { sections, ev } = build([16, 16, 16, 16]);
    const f = mineForm(ev, sections);
    expect(f.arc).toBe("flat");
  });

  it("voice_activity reflects how many voices are sounding", () => {
    const { sections, ev } = build([12, 12], [1, 3]);
    const f = mineForm(ev, sections);
    expect(f.sections[1].voice_activity).toBeGreaterThan(f.sections[0].voice_activity);
  });

  it("handles a single-section (loop) tune as flat", () => {
    const { sections, ev } = build([20]);
    const f = mineForm(ev, sections);
    expect(f.arc).toBe("flat");
    expect(f.sections.length).toBe(1);
  });
});
