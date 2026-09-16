import { describe, it, expect } from "vitest";
import { classifyVoiceRole, computeVoiceStats, type VoiceStats } from "../roles.js";

describe("classifyVoiceRole", () => {
  it("low pitch + steady rhythm -> bass", () => {
    const stats: VoiceStats = {
      voice: 1,
      avgPitchHz: 90, pitchRange: 60,
      noteCount: 32, noisePercent: 0,
      avgGateLengthFrames: 12, rhythmRegularity: 0.9,
      distinctPitches: 5, arpScore: 0.2,
    };
    expect(classifyVoiceRole(stats)).toBe("bass");
  });

  it("high pitch + fast notes -> lead", () => {
    const stats: VoiceStats = {
      voice: 1,
      avgPitchHz: 800, pitchRange: 1200,
      noteCount: 64, noisePercent: 0,
      avgGateLengthFrames: 6, rhythmRegularity: 0.6,
      distinctPitches: 24, arpScore: 0.1,
    };
    expect(classifyVoiceRole(stats)).toBe("lead");
  });

  it("high noise % -> percussion", () => {
    const stats: VoiceStats = {
      voice: 3,
      avgPitchHz: 0, pitchRange: 0,
      noteCount: 40, noisePercent: 0.85,
      avgGateLengthFrames: 2, rhythmRegularity: 0.95,
      distinctPitches: 1, arpScore: 0,
    };
    expect(classifyVoiceRole(stats)).toBe("percussion");
  });

  it("periodic chord-cycle (few pitches, repeats at lag) -> arp", () => {
    const stats: VoiceStats = {
      voice: 2,
      avgPitchHz: 500, pitchRange: 400,
      noteCount: 200, noisePercent: 0,
      avgGateLengthFrames: 2, rhythmRegularity: 0.95,
      distinctPitches: 3, arpScore: 0.92,   // cycles 3 chord tones, repeats at lag 3
    };
    expect(classifyVoiceRole(stats)).toBe("arp");
  });
});

describe("computeVoiceStats", () => {
  // Helper: one on/off pair (a note) on a voice.
  const note = (voice: number, on: number, len: number, pitch: number, waveform = "saw", sid_chip = 1) => [
    { frame: on, voice, kind: "on", pitch, sid_chip, waveform },
    { frame: on + len, voice, kind: "off", pitch, sid_chip, waveform: "" },
  ];

  it("derives per-voice stats and feeds the classifier (bass)", () => {
    // Voice 1: low pitch (~90Hz), evenly spaced every 16 frames, gate len 12.
    const events = [
      ...note(1, 0, 12, 90),
      ...note(1, 16, 12, 95),
      ...note(1, 32, 12, 90),
      ...note(1, 48, 12, 95),
    ];
    const stats = computeVoiceStats(events);
    expect(stats).toHaveLength(1);
    const v = stats[0];
    expect(v.voice).toBe(1);
    expect(v.sidChip).toBe(1);
    expect(v.noteCount).toBe(4);
    expect(v.avgGateLengthFrames).toBe(12);
    expect(v.avgPitchHz).toBeGreaterThan(80);
    expect(v.avgPitchHz).toBeLessThan(200);
    expect(v.rhythmRegularity).toBeGreaterThan(0.9); // evenly spaced
    expect(classifyVoiceRole(v)).toBe("bass");
  });

  it("computes noisePercent → percussion", () => {
    const events = [
      ...note(3, 0, 2, 100, "noise"),
      ...note(3, 8, 2, 100, "noise"),
      ...note(3, 16, 2, 100, "noise"),
      ...note(3, 24, 2, 100, "saw"),
    ];
    const v = computeVoiceStats(events)[0];
    expect(v.noisePercent).toBeCloseTo(0.75, 5);
    expect(classifyVoiceRole(v)).toBe("percussion");
  });

  it("groups by (sid_chip, voice) and sorts deterministically", () => {
    const events = [
      ...note(1, 0, 4, 300, "saw", 2),
      ...note(2, 0, 4, 300, "saw", 1),
      ...note(1, 0, 4, 300, "saw", 1),
    ];
    const stats = computeVoiceStats(events);
    expect(stats.map((s) => [s.sidChip, s.voice])).toEqual([[1, 1], [1, 2], [2, 1]]);
  });
});
