import { describe, it, expect } from "vitest";
import { analyzeMultiplex, type RoleEvent } from "../roles.js";

function on(frame: number, voice: number, waveform: string, pitch = 440): RoleEvent {
  return { frame, voice, kind: "on", pitch, sid_chip: 1, waveform };
}
function off(frame: number, voice: number): RoleEvent {
  return { frame, voice, kind: "off", pitch: 0, sid_chip: 1, waveform: "" };
}

describe("analyzeMultiplex", () => {
  it("flags a voice that switches role across the song (arp early, percussion late)", () => {
    const ev: RoleEvent[] = [];
    for (let i = 0; i < 60; i++) { ev.push(on(i * 2, 3, "pulse", 800)); ev.push(off(i * 2 + 1, 3)); }
    for (let i = 0; i < 60; i++) { ev.push(on(200 + i * 4, 3, "noise", 200)); ev.push(off(200 + i * 4 + 2, 3)); }
    const m = analyzeMultiplex(ev).get("1:3")!;
    expect(m.multiplex).toBe(true);
    expect(m.role_set.length).toBeGreaterThanOrEqual(2);
  });

  it("flags noise interleaved into a melodic voice (gap_fill_rate > 0)", () => {
    const ev: RoleEvent[] = [];
    for (let i = 0; i < 40; i++) {
      const wf = i % 5 === 0 ? "noise" : "pulse";
      ev.push(on(i * 6, 3, wf, wf === "noise" ? 200 : 600)); ev.push(off(i * 6 + 3, 3));
    }
    const m = analyzeMultiplex(ev).get("1:3")!;
    expect(m.multiplex).toBe(true);
    expect(m.gap_fill_rate).toBeGreaterThan(0);
  });

  it("does NOT flag a single-role voice", () => {
    const ev: RoleEvent[] = [];
    for (let i = 0; i < 80; i++) { ev.push(on(i * 12, 1, "pulse", 500)); ev.push(off(i * 12 + 8, 1)); }
    const m = analyzeMultiplex(ev).get("1:1")!;
    expect(m.multiplex).toBe(false);
    expect(m.role_set.length).toBe(1);
  });
});
