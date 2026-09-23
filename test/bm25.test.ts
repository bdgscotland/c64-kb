import { describe, it, expect } from "vitest";
import { BM25Encoder } from "../src/services/bm25.ts";

describe("BM25Encoder", () => {
  it("builds vocabulary from a corpus and emits sparse vectors", () => {
    const corpus = [
      "the quick brown fox",
      "the lazy dog",
      "quick fox jumps over",
    ];
    const enc = new BM25Encoder();
    enc.fit(corpus);

    const vec = enc.encode("quick fox");
    expect(vec.indices.length).toBe(2);
    expect(vec.values.every((v) => v > 0)).toBe(true);
  });

  it("tokenizes hex bytes as a single token", () => {
    const corpus = ["LDA #imm load A immediate", "STA absolute store A"];
    const enc = new BM25Encoder();
    enc.fit(corpus);

    // Hex byte $A9 should be a single token, not $/A/9
    enc.fit(["$A9 LDA #imm"]);
    const vec = enc.encode("$A9");
    expect(vec.indices.length).toBe(1);
  });

  it("returns empty sparse vector for query with no vocab matches", () => {
    const enc = new BM25Encoder();
    enc.fit(["totally unrelated content"]);
    const vec = enc.encode("XYZ nonexistent");
    expect(vec.indices).toEqual([]);
    expect(vec.values).toEqual([]);
  });

  it("vocab is serializable to JSON and re-loadable", () => {
    const enc1 = new BM25Encoder();
    enc1.fit(["foo bar baz", "bar baz qux"]);
    const serialized = enc1.toJSON();

    const enc2 = BM25Encoder.fromJSON(serialized);
    const v1 = enc1.encode("foo bar");
    const v2 = enc2.encode("foo bar");
    expect(v1).toEqual(v2);
  });
});
