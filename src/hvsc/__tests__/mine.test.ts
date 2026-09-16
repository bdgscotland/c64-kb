import { describe, it, expect } from "vitest";
import { clusterInstruments, mineMotifs, mineRhythm, hashClusteringParams } from "../mine.js";

const FAKE_INSTRUMENTS = [
  { id: "i0", adsr: [0, 9, 15, 8], waveform: "saw", filter_routed: false, hard_restart: false, pulse_pattern: [] },
  { id: "i1", adsr: [0, 9, 15, 8], waveform: "saw", filter_routed: false, hard_restart: false, pulse_pattern: [] }, // dup of i0
  { id: "i2", adsr: [3, 9, 15, 8], waveform: "pulse", filter_routed: true, hard_restart: true, pulse_pattern: [2048] },
  { id: "i3", adsr: [3, 9, 15, 8], waveform: "pulse", filter_routed: true, hard_restart: true, pulse_pattern: [2050] }, // near-dup of i2
];

describe("clusterInstruments", () => {
  it("groups near-identical ADSR+waveform combinations into one cluster", () => {
    const clusters = clusterInstruments(FAKE_INSTRUMENTS, { adsrTolerance: 0, pwTolerance: 16 });
    // i0+i1 share exact (adsr, waveform); i2+i3 cluster if pwTolerance >= 2
    expect(clusters.size).toBe(2);
  });
});

describe("mineMotifs", () => {
  it("finds repeated 4-note interval sequences", () => {
    // Two occurrences of intervals [+2, +2, -3]
    const events = [
      { frame: 0, voice: 1, kind: "on", pitch: 440, gate: true, adsr: [0,0,15,8] },   // A4
      { frame: 10, voice: 1, kind: "on", pitch: 494, gate: true, adsr: [0,0,15,8] },  // B4
      { frame: 20, voice: 1, kind: "on", pitch: 554, gate: true, adsr: [0,0,15,8] },  // C#5
      { frame: 30, voice: 1, kind: "on", pitch: 466, gate: true, adsr: [0,0,15,8] },  // Bb4
      // repeat
      { frame: 100, voice: 1, kind: "on", pitch: 440, gate: true, adsr: [0,0,15,8] },
      { frame: 110, voice: 1, kind: "on", pitch: 494, gate: true, adsr: [0,0,15,8] },
      { frame: 120, voice: 1, kind: "on", pitch: 554, gate: true, adsr: [0,0,15,8] },
      { frame: 130, voice: 1, kind: "on", pitch: 466, gate: true, adsr: [0,0,15,8] },
    ];
    const motifs = mineMotifs(events as any, { minLength: 4, minOccurrences: 2 });
    expect(motifs.length).toBeGreaterThanOrEqual(1);
    expect(motifs[0].occurrences.length).toBe(2);
  });
});

describe("mineRhythm", () => {
  it("mines a repeated quantized [ioi,gate] cell per voice", () => {
    // 8 steady notes on voice 1: onset every 6 frames, gate 3 frames.
    const events: any[] = [];
    for (let i = 0; i < 8; i++) {
      events.push({ frame: i * 6, voice: 1, kind: "on", pitch: 440 });
      events.push({ frame: i * 6 + 3, voice: 1, kind: "off", pitch: 0 });
    }
    const cells = mineRhythm(events, { minLength: 4, minOccurrences: 2, stepFrames: 6 });
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(cells[0].voice).toBe(1);
    expect(cells[0].slots.length).toBe(4);
    expect(cells[0].occurrences).toBeGreaterThanOrEqual(2);
    // ioi 6/6 -> 1; gate 3/6 -> round(0.5)=1
    expect(cells[0].slots[0]).toEqual([1, 1]);
  });

  it("falls back to per-voice median ioi when no stepFrames given", () => {
    const events: any[] = [];
    for (let i = 0; i < 6; i++) {
      events.push({ frame: i * 10, voice: 2, kind: "on", pitch: 220 });
      events.push({ frame: i * 10 + 5, voice: 2, kind: "off", pitch: 0 });
    }
    const cells = mineRhythm(events, { minLength: 4, minOccurrences: 2 });
    expect(cells.length).toBeGreaterThanOrEqual(1);
    expect(cells[0].voice).toBe(2);
  });
});

describe("hashClusteringParams", () => {
  it("is deterministic for the same params", () => {
    const a = hashClusteringParams({ adsrTolerance: 0, pwTolerance: 16, motifMinLength: 4 });
    const b = hashClusteringParams({ adsrTolerance: 0, pwTolerance: 16, motifMinLength: 4 });
    expect(a).toBe(b);
  });
  it("changes when any param changes", () => {
    const a = hashClusteringParams({ adsrTolerance: 0, pwTolerance: 16, motifMinLength: 4 });
    const b = hashClusteringParams({ adsrTolerance: 0, pwTolerance: 16, motifMinLength: 5 });
    expect(a).not.toBe(b);
  });
});
