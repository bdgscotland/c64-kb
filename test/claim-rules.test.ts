import { describe, it, expect } from "vitest";
import {
  unitRules,
  absorbInto,
  compressUnits,
  type ClaimSide,
} from "../src/tools/query/compatibility/unit-rules.ts";

// The pure unit rules (src/tools/claim-rules.ts); no graph needed.
const side = (name: string, ...claims: ClaimSide["claims"]): ClaimSide => ({ name, claims });
const none = { aRequiresB: false, bRequiresA: false };

describe("unitRules", () => {
  const player = side("player", { unit: "sid_voice_2", mode: "owns" });
  const sfx = side("sfx", { unit: "sid_voice_2", mode: "shares" });

  it("keeps unit_shared when the sharer requires the owner", () => {
    const hits = unitRules(sfx, player, { aRequiresB: true, bRequiresA: false });
    expect(hits.map((h) => [h.kind, h.severity])).toEqual([["unit_shared", "soft"]]);
    expect(hits[0]?.resolution).toMatch(/^sfx must follow player's protocol/);
  });

  it("drops unit_shared when the owner requires the sharer", () => {
    expect(unitRules(player, sfx, { aRequiresB: true, bRequiresA: false })).toEqual([]);
  });

  it("drops the ownership rules between a technique and its prerequisite", () => {
    const a = side(
      "a",
      { unit: "sprite_0", mode: "owns" },
      { unit: "zero_page", mode: "owns", ranges: "F0-F3" },
    );
    const b = side(
      "b",
      { unit: "sprite_0", mode: "owns" },
      { unit: "zero_page", mode: "owns", ranges: "F2" },
    );
    expect(unitRules(a, b, none).map((h) => h.kind)).toEqual(["unit_contention", "zero_page_overlap"]);
    expect(unitRules(a, b, { aRequiresB: false, bRequiresA: true })).toEqual([]);
  });

  it("groups units per rule and compresses numbered runs", () => {
    const a = side("a", ...[0, 1, 2, 3].map((n) => ({ unit: `sprite_${n}`, mode: "owns" as const })));
    const b = side("b", ...[0, 1, 2, 3].map((n) => ({ unit: `sprite_${n}`, mode: "owns" as const })));
    expect(unitRules(a, b, none)[0]?.shared).toEqual(["sprite_0-3"]);
    expect(compressUnits(["sprite_2", "sprite_0", "sprite_1", "sid_voice_3"])).toEqual([
      "sid_voice_3",
      "sprite_0-2",
    ]);
  });
});

describe("absorbInto", () => {
  it("drops an implied technique's claims on units its input holds, but never zero page", () => {
    const input = side(
      "fli",
      { unit: "vic_raster_irq", mode: "owns" },
      { unit: "zero_page", mode: "owns", ranges: "02-0F" },
    );
    const implied = side(
      "entry",
      { unit: "vic_raster_irq", mode: "shares" },
      { unit: "zero_page", mode: "owns", ranges: "FB-FE" },
      { unit: "cia2_timer_a", mode: "owns" },
    );
    expect(absorbInto(implied, input).claims.map((c) => c.unit)).toEqual(["zero_page", "cia2_timer_a"]);
  });
});
