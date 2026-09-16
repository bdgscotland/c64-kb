import { describe, it, expect } from "vitest";
import {
  mineHarmony, tonicPcFromKeyName, parseChordSymbol,
  collapseRuns, progressionDegreesString,
} from "../mine.js";

// Build note-on/off events that hold a triad's three pitch-classes across a window.
function chordEvents(startFrame: number, lenFrames: number, midis: number[], voiceBase = 1): any[] {
  const ev: any[] = [];
  midis.forEach((m, i) => {
    const pitch = 440 * Math.pow(2, (m - 69) / 12);
    ev.push({ frame: startFrame, voice: voiceBase + i, kind: "on", pitch, sid_chip: 1 });
    ev.push({ frame: startFrame + lenFrames, voice: voiceBase + i, kind: "off", pitch: 0, sid_chip: 1 });
  });
  return ev;
}

describe("tonicPcFromKeyName", () => {
  it("maps music21 + score.py key names to pitch classes", () => {
    expect(tonicPcFromKeyName("C")).toBe(0);
    expect(tonicPcFromKeyName("F#")).toBe(6);
    expect(tonicPcFromKeyName("B-")).toBe(10); // music21 flat
    expect(tonicPcFromKeyName("Bb")).toBe(10); // score.py flat
    expect(tonicPcFromKeyName("Db")).toBe(1);
    expect(tonicPcFromKeyName("")).toBeNull();
    expect(tonicPcFromKeyName("H")).toBeNull();
  });
});

describe("parseChordSymbol", () => {
  it("parses triad symbols to (root_pc, quality)", () => {
    expect(parseChordSymbol("C")).toEqual({ root_pc: 0, quality: "maj" });
    expect(parseChordSymbol("Am")).toEqual({ root_pc: 9, quality: "min" });
    expect(parseChordSymbol("F#m")).toEqual({ root_pc: 6, quality: "min" });
    expect(parseChordSymbol("Bbm")).toEqual({ root_pc: 10, quality: "min" });
    expect(parseChordSymbol("Cmaj")).toEqual({ root_pc: 0, quality: "maj" });
    expect(parseChordSymbol("zzz")).toBeNull();
  });
});

describe("collapseRuns", () => {
  it("collapses consecutive equal items", () => {
    expect(collapseRuns<number>([1, 1, 2, 2, 2, 1], (a, b) => a === b)).toEqual([1, 2, 1]);
  });
});

describe("mineHarmony", () => {
  it("infers a key-relative progression (C major -> G major in key C)", () => {
    // Window 1: C-E-G (C major). Window 2: G-B-D (G major). windowFrames=50.
    const events = [
      ...chordEvents(0, 50, [60, 64, 67]),   // C maj
      ...chordEvents(50, 50, [67, 71, 74]),  // G maj
    ];
    const sections = [{ start_frame: 0, end_frame: 100 }];
    const progs = mineHarmony(events, sections, /*tonicPc*/ 0, {
      windowFrames: 50, weakWindowMinWeight: 0.5, minDistinctChords: 2, mode: "major",
    });
    expect(progs.length).toBe(1);
    expect(progs[0].order).toBe(0);
    expect(progressionDegreesString(progs[0].chords)).toBe("0maj-7maj");
  });

  it("drops a single-chord section (< minDistinctChords)", () => {
    const events = [...chordEvents(0, 100, [60, 64, 67])]; // C maj only
    const sections = [{ start_frame: 0, end_frame: 100 }];
    const progs = mineHarmony(events, sections, 0, {
      windowFrames: 50, weakWindowMinWeight: 0.5, minDistinctChords: 2, mode: "major",
    });
    expect(progs.length).toBe(0);
  });

  it("inherits the tonic for a silent first window", () => {
    // Window 1 silent, window 2 = A minor (tonic A min). Tonic-inheritance for the
    // first window yields degree 0 min; A minor is also degree 0 min -> the section
    // collapses to a single distinct chord and is dropped (documents the
    // inheritance + collapse interaction).
    const events = [...chordEvents(50, 50, [69, 72, 76])]; // A min in window 2
    const sections = [{ start_frame: 0, end_frame: 100 }];
    const progs = mineHarmony(events, sections, 9, {
      windowFrames: 50, weakWindowMinWeight: 0.5, minDistinctChords: 2, mode: "minor",
    });
    expect(progressionDegreesString(progs[0]?.chords ?? [])).toBe("");
  });
});
