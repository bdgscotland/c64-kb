import { describe, it, expect } from "vitest";
import { aggregateMultiplex } from "../palette-mcp.js";

describe("aggregateMultiplex", () => {
  it("computes multiplex rate, role pairs, mean gap-fill", () => {
    const r = aggregateMultiplex([
      { multiplex: true, role_set: "arp,percussion", gap_fill_rate: 0.4 },
      { multiplex: true, role_set: "arp,percussion", gap_fill_rate: 0.2 },
      { multiplex: false, role_set: "bass", gap_fill_rate: 0 },
    ]);
    expect(r.n_voices).toBe(3);
    expect(r.multiplex_rate).toBeCloseTo(0.667, 2);
    expect(r.common_role_pairs[0].pair).toBe("arp,percussion");
    expect(r.gap_fill_rate).toBeCloseTo(0.3, 2); // mean over multiplexed voices
  });
  it("handles empty", () => {
    const r = aggregateMultiplex([]);
    expect(r.n_voices).toBe(0);
    expect(r.multiplex_rate).toBe(0);
  });
});
