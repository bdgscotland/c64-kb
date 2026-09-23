import { describe, it, expect } from "vitest";
import { computeBudget, renderBudgetText, FRAME_CYCLES, RAM_BUDGET_BYTES } from "../src/tools/briefings.ts";
import { BriefingSchema } from "../src/schemas/tool-outputs.ts";

// The budget block is pure arithmetic over the proposed set, so a fixture
// drives it directly. The graph path is covered in briefings.test.ts.

const BudgetSchema = BriefingSchema.shape.budget;

describe("computeBudget", () => {
  // Since schema 27 the briefing budget is planBudget with every proposed
  // technique in one play frame (src/domain/budget.ts has the rules).
  it("leaves a multi-frame figure out of the sum and says undetermined, not over", () => {
    const b = computeBudget([
      { name: "soft_scroll_h", cost: { cycles_per_frame: 74041, basis: "measured-vice" } },
      { name: "sprite_multiplex_24", cost: { cycles_per_frame: 700, bytes_code: 900, basis: "estimated" } },
      { name: "sid_play_routine_pattern", cost: { cycles_per_frame: 327, basis: "measured-vice" } },
    ]);
    expect(b.region).toBe("PAL");
    expect(b.frame_cycles).toBe(19656);
    expect(b.cycles_per_frame_sum).toBe(1027);
    expect(b.excluded).toEqual([{ name: "soft_scroll_h", reason: "multi_frame" }]);
    expect(b.cycles_verdict).toBe("undetermined");
    expect(b.bytes_sum).toBe(900);
    expect(b.bytes_verdict).toBe("under");
    expect(b.weakest_basis).toBe("estimated");
    expect(b.without_cost).toEqual([]);
    expect(b.is_floor).toBe(false);
    expect(BudgetSchema.parse(b)).toBeTruthy();
  });

  it("names the members with no figure as unknown and never calls the set under", () => {
    const b = computeBudget([
      { name: "stable_raster_irq", cost: { cycles_per_frame: 124, basis: "arithmetic" } },
      { name: "sid_play_routine_pattern", cost: { cycles_per_frame: 327, basis: "measured-vice" } },
      { name: "plasma", recipes: ["kickassembler-plasma"] },
      { name: "standard_bitmap" },
    ]);
    expect(b.cycles_per_frame_sum).toBe(451);
    expect(b.fixed_loss_cycles).toBe(1075);
    expect(b.cycles_verdict).toBe("undetermined");
    expect(b.unknown).toEqual(["plasma", "standard_bitmap"]);
    expect(b.to_measure).toEqual([
      { technique: "plasma", recipe: "kickassembler-plasma" },
      { technique: "standard_bitmap", recipe: null },
    ]);
    expect(b.without_cost).toEqual(["plasma", "standard_bitmap"]);
    expect(b.is_floor).toBe(true);
    expect(b.weakest_basis).toBe("arithmetic");
    expect(b.assumptions.some((a) => a.includes("2 proposed technique(s) have no Cost line"))).toBe(true);
  });

  it("says under when every member has a figure and the high end with badlines fits", () => {
    const b = computeBudget([
      {
        name: "wave_director",
        cost: {
          cycles_per_frame: 3188,
          cycles_per_frame_typical: 1170,
          basis: "measured-vice",
          includes: ["object_pool"],
        },
      },
      { name: "object_pool", cost: { cycles_per_frame: 380, basis: "measured-vice" } },
    ]);
    expect(b.cycles_low).toBe(1170);
    expect(b.cycles_per_frame_sum).toBe(3188);
    expect(b.excluded).toEqual([{ name: "object_pool", reason: "included_by", by: "wave_director" }]);
    expect(b.cycles_verdict).toBe("under");
    expect(b.contributors.find((c) => c.name === "wave_director")).toMatchObject({
      cycles_per_frame: 3188,
      cycles_per_frame_typical: 1170,
    });
  });

  it("sums bytes_code and bytes_data, leaves whole-program bytes out, and judges the sum", () => {
    const b = computeBudget([
      {
        name: "fli_image",
        cost: { cycles_per_frame: 12600, bytes_code: 3277, bytes_data: 16384, basis: "estimated" },
      },
      { name: "big", cost: { bytes_data: 30000, basis: "derived-listing" } },
      {
        name: "lfsr_random",
        cost: {
          cycles_per_frame: 14,
          bytes_code: 1947,
          basis: "arithmetic",
          conditions: "bytes are the whole PRG",
        },
      },
    ]);
    expect(b.ram_budget_bytes).toBe(RAM_BUDGET_BYTES);
    expect(b.bytes_sum).toBe(3277 + 16384 + 30000);
    expect(b.bytes_verdict).toBe("over");
    expect(b.excluded).toContainEqual({ name: "lfsr_random", reason: "whole_program_bytes" });
    expect(b.contributors.find((c) => c.name === "big")?.cycles_per_frame).toBeUndefined();
    expect(b.unknown).toEqual(["big"]);
  });

  it("reports no_data when the set is empty, and undetermined when nothing has a figure", () => {
    const empty = computeBudget([]);
    expect(empty.cycles_verdict).toBe("no_data");
    expect(empty.bytes_verdict).toBe("no_data");
    expect(empty.weakest_basis).toBeNull();
    const b = computeBudget([{ name: "plasma" }]);
    expect(b.cycles_verdict).toBe("undetermined");
    expect(b.bytes_verdict).toBe("no_data");
    expect(b.without_cost).toEqual(["plasma"]);
  });

  it("judges against the NTSC frame when every region-locked technique is NTSC", () => {
    const b = computeBudget([
      {
        name: "a",
        requires_region: "ntsc",
        cost: { cycles_per_frame: 16500, cycles_per_frame_typical: 16400, basis: "measured-vice" },
      },
      { name: "b", cost: { cycles_per_frame: 1, cycles_per_frame_typical: 1, basis: "arithmetic" } },
    ]);
    expect(b.region).toBe("NTSC");
    expect(b.frame_cycles).toBe(FRAME_CYCLES.NTSC);
    // Typical 16,401 + 1,075 badlines is past 17,095.
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

  it("renders the range, the left-out figures, the unknowns and the weakest basis in the text", () => {
    const text = renderBudgetText(
      computeBudget([
        { name: "soft_scroll_h", cost: { cycles_per_frame: 74041, basis: "measured-vice" } },
        { name: "sid_play_routine_pattern", cost: { cycles_per_frame: 327, basis: "measured-vice" } },
        { name: "plasma" },
      ]),
    );
    expect(text).toContain("| Cycles per frame | 327 + 1075 badlines | 19656 | undetermined |");
    expect(text).toContain("soft_scroll_h (above one frame: a multi-frame operation)");
    expect(text).toContain("Weakest basis: measured-vice");
    expect(text).toContain("Unknown, not zero, so the verdict cannot be under: plasma");
    expect(text).toContain("c64_plan_budget");
  });
});
