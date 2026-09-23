import { describe, it, expect } from "vitest";
import { computeBudget, renderBudgetText, FRAME_CYCLES, RAM_BUDGET_BYTES } from "../src/tools/briefings.ts";
import { BriefingSchema } from "../src/schemas/tool-outputs.ts";

// The budget block is pure arithmetic over the proposed set, so a fixture
// drives it directly. The graph path is covered in briefings.test.ts.

const BudgetSchema = BriefingSchema.shape.budget;

describe("computeBudget", () => {
  it("says over for a set whose cycles exceed a PAL frame, and names the weakest basis", () => {
    const b = computeBudget([
      { name: "soft_scroll_h", cost: { cycles_per_frame: 74041, basis: "measured-vice" } },
      { name: "sprite_multiplex_24", cost: { cycles_per_frame: 700, bytes_code: 900, basis: "estimated" } },
      { name: "sid_play_routine_pattern", cost: { cycles_per_frame: 327, basis: "measured-vice" } },
    ]);
    expect(b.region).toBe("PAL");
    expect(b.frame_cycles).toBe(19656);
    expect(b.cycles_per_frame_sum).toBe(75068);
    expect(b.cycles_verdict).toBe("over");
    expect(b.bytes_sum).toBe(900);
    expect(b.bytes_verdict).toBe("under");
    expect(b.weakest_basis).toBe("estimated");
    expect(b.without_cost).toEqual([]);
    expect(b.is_floor).toBe(false);
    expect(BudgetSchema.parse(b)).toBeTruthy();
  });

  it("says under for a set within the frame and names the techniques without a cost line", () => {
    const b = computeBudget([
      { name: "stable_raster_irq", cost: { cycles_per_frame: 124, basis: "arithmetic" } },
      { name: "sid_play_routine_pattern", cost: { cycles_per_frame: 327, basis: "measured-vice" } },
      { name: "plasma" },
      { name: "standard_bitmap" },
    ]);
    expect(b.cycles_per_frame_sum).toBe(451);
    expect(b.cycles_verdict).toBe("under");
    expect(b.without_cost).toEqual(["plasma", "standard_bitmap"]);
    expect(b.is_floor).toBe(true);
    expect(b.weakest_basis).toBe("arithmetic");
    expect(b.assumptions.some((a) => a.includes("2 proposed technique(s) have no Cost line"))).toBe(true);
  });

  it("sums bytes_code and bytes_data and judges them against the stated RAM budget", () => {
    const b = computeBudget([
      {
        name: "fli_image",
        cost: { cycles_per_frame: 12600, bytes_code: 3277, bytes_data: 16384, basis: "estimated" },
      },
      { name: "big", cost: { bytes_data: 30000, basis: "derived-listing" } },
    ]);
    expect(b.ram_budget_bytes).toBe(RAM_BUDGET_BYTES);
    expect(b.bytes_sum).toBe(3277 + 16384 + 30000);
    expect(b.bytes_verdict).toBe("over");
    expect(b.cycles_verdict).toBe("under");
    expect(b.contributors.find((c) => c.name === "big")?.cycles_per_frame).toBeUndefined();
  });

  it("reports no_data and a null weakest basis when nothing contributed", () => {
    const b = computeBudget([{ name: "plasma" }]);
    expect(b.cycles_verdict).toBe("no_data");
    expect(b.bytes_verdict).toBe("no_data");
    expect(b.weakest_basis).toBeNull();
    expect(b.without_cost).toEqual(["plasma"]);
  });

  it("judges against the NTSC frame when every region-locked technique is NTSC", () => {
    const b = computeBudget([
      { name: "a", requires_region: "ntsc", cost: { cycles_per_frame: 17100, basis: "arithmetic" } },
      { name: "b", cost: { cycles_per_frame: 1, basis: "arithmetic" } },
    ]);
    expect(b.region).toBe("NTSC");
    expect(b.frame_cycles).toBe(FRAME_CYCLES.NTSC);
    expect(b.cycles_verdict).toBe("over");
    const pal = computeBudget([
      { name: "a", requires_region: "pal", cost: { cycles_per_frame: 17100, basis: "arithmetic" } },
      { name: "b", requires_region: "ntsc", cost: { cycles_per_frame: 1, basis: "arithmetic" } },
    ]);
    expect(pal.region).toBe("PAL");
  });

  it("orders basis words measured-vice > derived-listing > arithmetic > estimated", () => {
    const mk = (words: ("measured-vice" | "derived-listing" | "arithmetic" | "estimated")[]) =>
      computeBudget(words.map((w, i) => ({ name: `t${i}`, cost: { cycles_per_frame: 1, basis: w } })))
        .weakest_basis;
    expect(mk(["measured-vice", "derived-listing"])).toBe("derived-listing");
    expect(mk(["arithmetic", "measured-vice"])).toBe("arithmetic");
    expect(mk(["derived-listing", "estimated", "measured-vice"])).toBe("estimated");
    expect(mk(["measured-vice"])).toBe("measured-vice");
  });

  it("renders the verdicts, the floor and the weakest basis in the text", () => {
    const text = renderBudgetText(
      computeBudget([
        { name: "soft_scroll_h", cost: { cycles_per_frame: 74041, basis: "measured-vice" } },
        { name: "plasma" },
      ]),
    );
    expect(text).toContain("over budget");
    expect(text).toContain("Weakest basis: measured-vice");
    expect(text).toContain("No Cost line, so the sums are a floor: plasma");
  });
});
