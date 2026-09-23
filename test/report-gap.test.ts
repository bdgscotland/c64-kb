import { describe, it, expect } from "vitest";
import { reportGap } from "../src/tools/selfimprovement.ts";

describe("c64_report_gap", () => {
  it("creates a new gap on first call", async () => {
    const r = await reportGap({
      query: "test gap " + Date.now(),
      tool_called: "c64_search",
      notes: "test note",
    });
    expect(r.structured.gap_id).toBeGreaterThan(0);
    expect(r.structured.status).toBe("new");
    expect(r.structured.hit_count).toBe(1);
  });

  it("increments existing gap on repeat call", async () => {
    const q = "repeated gap " + Date.now();
    const r1 = await reportGap({ query: q, tool_called: "c64_search" });
    expect(r1.structured.status).toBe("new");
    const r2 = await reportGap({ query: q, tool_called: "c64_search" });
    expect(r2.structured.status).toBe("incremented");
    expect(r2.structured.hit_count).toBe(2);
  });

  it("returns a non-empty message", async () => {
    const r = await reportGap({
      query: "message check " + Date.now(),
      tool_called: "c64_search",
    });
    expect(r.text.length).toBeGreaterThan(0);
    expect(r.structured.message.length).toBeGreaterThan(0);
  });
});
