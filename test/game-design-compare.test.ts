import { describe, it, expect } from "vitest";
import { planBudget, type BudgetMember } from "../src/domain/budget.ts";
import { compareMeasured } from "../src/domain/game-design.ts";

const member = (name: string, cycles?: number, typical?: number): BudgetMember => ({
  name,
  phase: "play",
  found: true,
  requires_closure: [],
  recipes: [],
  ...(cycles !== undefined
    ? {
        cost: {
          cycles_per_frame: cycles,
          cycles_per_frame_typical: typical,
          basis: "measured-vice",
          conditions: "screen on",
          includes: [],
        },
      }
    : {}),
});

describe("compareMeasured", () => {
  const m = (worst: number) => ({
    phase: "play" as const,
    region: "PAL" as const,
    worst,
    basis: "measured-vice" as const,
    source: "timer",
  });

  it("places the measured worst against [low, high + fixed]", () => {
    const plan = planBudget([member("a", 3000, 1000), member("b", 2000)], { region: "PAL" });
    const [within, above, below] = compareMeasured([m(4000), m(6000), m(2000)], plan.phases);
    expect(within?.predicted).toEqual({ low: 3000, high: 5000, fixed: 0, verdict: "fits", missing: [] });
    expect(within?.position).toBe("within");
    expect(above?.position).toBe("above_high");
    expect(above?.finding).toContain("by 1000 (17 % of the measured worst)");
    expect(below?.position).toBe("below_low");
    expect(below?.finding).toContain("below the predicted 3000-5000 by 1000");
    const [t] = compareMeasured([{ ...m(6000), typical: 4000 }], plan.phases);
    expect(t?.finding).toContain("; typical 4000 lies within the predicted 3000-5000");
  });

  it("names the members the prediction could not count", () => {
    const plan = planBudget([member("a", 3000), member("b"), member("c", 30000)], { region: "PAL" });
    const [c] = compareMeasured([m(9000)], plan.phases);
    expect(c?.predicted?.missing).toEqual(["b", "c"]);
    expect(c?.finding).toContain("2 members have no figure (b, c), so the prediction is incomplete");
  });

  it("a region or phase with no budget is not predicted", () => {
    const plan = planBudget([member("a", 3000)], { region: "PAL" });
    const [c] = compareMeasured([{ ...m(100), region: "NTSC" }], plan.phases);
    expect(c?.predicted).toBeNull();
    expect(c?.position).toBe("not_predicted");
  });
});
