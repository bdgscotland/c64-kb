import { describe, it, expect } from "vitest";
import { pitfallsFor, failureDiagnose } from "../src/tools/pitfalls.ts";
import { demoBriefing } from "../src/tools/briefings.ts";

describe("analytics wiring for Phase 5+ tools", () => {
  it("c64_pitfalls_for completes without throw", async () => {
    const r = await pitfallsFor("D012");
    expect(r.structured).toBeDefined();
  });

  it("c64_failure_diagnose completes without throw", async () => {
    const r = await failureDiagnose("border flickering");
    expect(r.structured.matches).toBeDefined();
  });

  it("c64_demo_briefing completes without throw", async () => {
    const r = await demoBriefing("test brief");
    expect(r.structured.brief).toBeDefined();
  });
});
