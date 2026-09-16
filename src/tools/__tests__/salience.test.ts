import { describe, it, expect } from "vitest";
import { smoothedIdf, salienceScore, rerankBySalience } from "../salience.js";

describe("salience math", () => {
  it("smoothed idf is 1 for a pattern every composer uses (df = N)", () => {
    expect(smoothedIdf(15, 15)).toBeCloseTo(1, 6);
  });

  it("smoothed idf rises for a pattern few composers use", () => {
    // df=1, N=15 -> log(16/2)+1
    expect(smoothedIdf(1, 15)).toBeCloseTo(Math.log(8) + 1, 6);
    expect(smoothedIdf(1, 15)).toBeGreaterThan(smoothedIdf(8, 15));
  });

  it("salience promotes a rarer signature pattern over a more frequent common one", () => {
    const common = salienceScore(10, 15, 15);    // used a lot, but by everyone
    const signature = salienceScore(5, 1, 15);   // used less, but only by this composer
    expect(signature).toBeGreaterThan(common);
  });
});

describe("rerankBySalience", () => {
  it("re-sorts a frequency-ranked list to a distinctiveness-ranked one", () => {
    const items = [
      { id: "common", weight: 10, df: 15 },     // common practice
      { id: "signature", weight: 5, df: 1 },    // distinctive
      { id: "mid", weight: 7, df: 6 },
    ];
    const ranked = rerankBySalience(items, 15);
    expect(ranked[0].id).toBe("signature"); // distinctiveness wins over raw frequency
  });

  it("is a stable, deterministic sort (equal salience keeps input order)", () => {
    const items = [
      { id: "a", weight: 4, df: 4 },
      { id: "b", weight: 4, df: 4 },
    ];
    const ranked = rerankBySalience(items, 10);
    expect(ranked.map((x) => x.id)).toEqual(["a", "b"]);
  });
});
