import { describe, it, expect } from "vitest";
import { parseSonglengths } from "../songlengths-parser.js";

describe("parseSonglengths", () => {
  it("parses single-subtune entry", () => {
    const idx = parseSonglengths("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6=2:34\n");
    expect(idx.get("a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6")).toEqual([154.0]);
  });

  it("parses multi-subtune entry", () => {
    const idx = parseSonglengths("abc=1:00 2:30 0:45\n");
    expect(idx.get("abc")).toEqual([60.0, 150.0, 45.0]);
  });

  it("parses sub-second precision (M:SS.sss)", () => {
    const idx = parseSonglengths("abc=1:00.500 2:30.250\n");
    const lengths = idx.get("abc");
    expect(lengths?.[0]).toBeCloseTo(60.5, 3);
    expect(lengths?.[1]).toBeCloseTo(150.25, 3);
  });

  it("skips comment lines starting with ;", () => {
    const idx = parseSonglengths("; this is a comment\n\nabc=1:00\n");
    expect(idx.size).toBe(1);
    expect(idx.get("abc")).toEqual([60.0]);
  });

  it("skips empty lines", () => {
    const idx = parseSonglengths("\n\nabc=1:00\n\n");
    expect(idx.size).toBe(1);
  });

  it("handles missing trailing newline", () => {
    const idx = parseSonglengths("abc=1:00");
    expect(idx.get("abc")).toEqual([60.0]);
  });

  it("returns empty map for empty input", () => {
    expect(parseSonglengths("").size).toBe(0);
  });
});

describe("parseSonglengths against real HVSC fixture", () => {
  it("parses real HVSC Songlengths.md5 without crashing", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const path = "data/hvsc-corpus/C64Music/DOCUMENTS/Songlengths.md5";
    if (!existsSync(path)) return; // skip when corpus not on disk
    const text = readFileSync(path, "utf8");
    const idx = parseSonglengths(text);
    expect(idx.size).toBeGreaterThan(10000);
    // Spot-check: any entry's lengths should be positive numbers
    const sample = idx.values().next().value;
    expect(sample?.length).toBeGreaterThan(0);
    expect(sample?.[0]).toBeGreaterThan(0);
  });
});
