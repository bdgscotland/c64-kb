import { describe, it, expect } from "vitest";
import { drumProximity } from "../style.js";

describe("drumProximity", () => {
  it("matches a contiguous run of the composer's percussion rhythm", () => {
    const r = drumProximity([1, 1, 2, 1, 1], [[1, 1, 2, 1, 1], [2, 2, 2, 2]]);
    expect(r.in_palette).toBe(true);
    expect(r.score).toBeGreaterThan(0.5);
  });
  it("no match scores 0", () => {
    const r = drumProximity([3, 3], [[1, 1, 1, 1]]);
    expect(r.in_palette).toBe(false);
    expect(r.score).toBe(0);
  });
  it("empty inputs score 0", () => {
    expect(drumProximity([], [[1, 1]]).in_palette).toBe(false);
    expect(drumProximity([1, 1], []).in_palette).toBe(false);
  });
});
