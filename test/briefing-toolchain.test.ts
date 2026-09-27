import { describe, it, expect } from "vitest";
import { heavyOffPrimary } from "../src/tools/briefings/toolchain.ts";

const tech = (over: Record<string, unknown>) =>
  ({ name: "t", recipes: [], ...over }) as unknown as Parameters<typeof heavyOffPrimary>[0];

describe("toolchain split: heavy work measured only off Oscar64 (KB-GAPS 8)", () => {
  it("hands off row_map_redraw: 13,304 cycles a frame measured on its only recipe, a KickAssembler one", () => {
    const t = tech({
      name: "row_map_redraw",
      recipes: [{ name: "kickassembler-row-map-redraw", toolchain: "kickassembler" }],
      cost: { cycles_per_frame: 13304, basis: "measured-vice", measured_on: "kickassembler-row-map-redraw" },
    });
    expect(heavyOffPrimary(t)).toBe(true);
  });

  it("keeps a technique with an Oscar64 recipe, a light one, and one with no measured-on recipe", () => {
    const withPrimary = tech({
      recipes: [{ name: "oscar64-x", toolchain: "oscar64" }],
      cost: { cycles_per_frame: 20000, basis: "measured-vice", measured_on: "kickassembler-x" },
    });
    const light = tech({
      cost: { cycles_per_frame: 93, basis: "measured-vice", measured_on: "kickassembler-y" },
    });
    const unmeasured = tech({ cost: { cycles_per_frame: 13152, basis: "measured-vice" } });
    const onPrimary = tech({
      cost: { cycles_per_frame: 9000, basis: "measured-vice", measured_on: "oscar64-z" },
    });
    expect([withPrimary, light, unmeasured, onPrimary].map(heavyOffPrimary)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });
});
