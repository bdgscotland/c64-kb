import { describe, it, expect } from "vitest";
import { aggregateTimbre } from "../palette-mcp.js";

describe("aggregateTimbre", () => {
  it("means numeric fields, picks dominant mode, ignores empty", () => {
    const t = aggregateTimbre([
      { filter_active_fraction: 0.2, filter_cutoff_mean: 100, filter_cutoff_std: 40,
        filter_resonance_mean: 2, filter_routed_rate: 0, pwm_depth: 200, pwm_mean_width: 1000,
        dominant_filter_mode: "lp" },
      { filter_active_fraction: 0.4, filter_cutoff_mean: 200, filter_cutoff_std: 60,
        filter_resonance_mean: 4, filter_routed_rate: 0.1, pwm_depth: 100, pwm_mean_width: 900,
        dominant_filter_mode: "lp" },
      {}, // empty tune — skipped
    ]);
    expect(t.n_tunes).toBe(2);
    expect(t.pwm.depth).toBeCloseTo(150, 1);
    expect(t.pwm.mean_width).toBeCloseTo(950, 1);
    expect(t.filter.active_fraction).toBeCloseTo(0.3, 3);
    expect(t.filter.dominant_mode).toBe("lp");
  });

  it("returns zeros + null mode for no data", () => {
    const t = aggregateTimbre([]);
    expect(t.n_tunes).toBe(0);
    expect(t.filter.dominant_mode).toBeNull();
    expect(t.pwm.depth).toBe(0);
  });
});

import { timbreProximity } from "../style.js";
import type { TimbreProfile } from "../palette-mcp.js";

const HUBBARD: TimbreProfile = {
  n_tunes: 91,
  filter: { dominant_mode: "lp", active_fraction: 0.2, cutoff_mean: 96, cutoff_std: 48, resonance_mean: 1.3, routed_rate: 0 },
  pwm: { depth: 197, mean_width: 948 },
};

describe("timbreProximity", () => {
  it("rewards PWM present (composer is PWM-heavy)", () => {
    const r = timbreProximity({ pwm: [{ depth: 400, center: 1000 }], filter: { active: true } }, HUBBARD);
    expect(r.in_palette).toBe(true);
    expect(r.score).toBe(1);
  });
  it("penalizes missing PWM when composer is PWM-heavy", () => {
    const r = timbreProximity({ pwm: [], filter: null }, HUBBARD);
    expect(r.score).toBeLessThan(1); // pwm expected but absent
  });
  it("no penalty for absent filter when composer rarely filters", () => {
    const lowFilter: TimbreProfile = { ...HUBBARD, filter: { ...HUBBARD.filter, active_fraction: 0.05 } };
    const r = timbreProximity({ pwm: [{ depth: 300, center: 1000 }], filter: null }, lowFilter);
    expect(r.in_palette).toBe(true);
  });
});
