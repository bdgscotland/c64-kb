import { describe, it, expect } from "vitest";
import { kernalClobberRules, type KernalSide } from "../src/tools/query/compatibility/kernal-zp-rule.ts";
import { evaluateCompatibility, type TechniqueFacts } from "../src/tools/query/compatibility/index.ts";

// kernal_clobbers_zp (schema 26): a KERNAL user beside a zero-page claim.
// Pure; no graph.
describe("kernalClobberRules", () => {
  const may = new Map([
    ["CHROUT", "01,90-96,D9-F6"],
    ["SETLFS", "B8-BA"],
  ]);
  const printer: KernalSide = { name: "printer", kernal: ["CHROUT", "SETLFS"], claims: [] };
  const loader: KernalSide = {
    name: "loader",
    kernal: [],
    claims: [{ unit: "zero_page", mode: "owns", ranges: "E0-EF", relocatable: true }],
  };

  it("fires soft, both ways round, naming the routine and the shared bytes", () => {
    for (const [a, b] of [
      [printer, loader],
      [loader, printer],
    ] as const) {
      const hits = kernalClobberRules(a, b, may);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.kind).toBe("kernal_clobbers_zp");
      expect(hits[0]?.severity).toBe("soft");
      expect(hits[0]?.shared).toEqual(["zero_page $E0-$EF", "CHROUT"]);
      expect(hits[0]?.rationale).toMatch(/CHROUT may write \$E0-\$EF/);
      expect(hits[0]?.resolution).toMatch(/^Rebuild loader with its zero-page base moved/);
    }
  });

  it("tells a fixed holder to move its variables, a relocatable one to rebuild", () => {
    const fixed = { ...loader, claims: [{ unit: "zero_page", mode: "owns" as const, ranges: "E0-EF" }] };
    expect(kernalClobberRules(printer, fixed, may)[0]?.resolution).toMatch(
      /^Move loader's zero-page variables off these bytes, or save and restore them around each call to CHROUT/,
    );
    expect(kernalClobberRules(printer, loader, may)[0]?.resolution).toMatch(
      /its page names the build option/,
    );
  });

  it("says a repointed vector changes the set", () => {
    expect(kernalClobberRules(printer, loader, may)[0]?.rationale).toMatch(
      /through the power-on vectors.*repoints a vector .* changes the set/,
    );
  });

  it("checks one technique against itself once", () => {
    const both: KernalSide = { ...loader, kernal: ["CHROUT"] };
    const hits = kernalClobberRules(both, both, may);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.rationale).toMatch(/bytes it claims itself/);
  });

  it("is silent when the bytes do not overlap or the routine has no set", () => {
    const low = { ...loader, claims: [{ unit: "zero_page", mode: "owns" as const, ranges: "FB-FE" }] };
    expect(kernalClobberRules(printer, low, may)).toEqual([]);
    expect(kernalClobberRules({ ...printer, kernal: ["GETIN"] }, loader, may)).toEqual([]);
  });
});

describe("evaluateCompatibility: kernal_clobbers_zp", () => {
  const tech = (over: Partial<TechniqueFacts>): TechniqueFacts => ({
    found: true,
    demands: new Set(),
    registers: 0,
    kernal: [],
    band: null,
    region: null,
    category: null,
    rasterRegisters: 0,
    claims: [],
    claimsStated: "stated",
    ...over,
  });

  it("turns a KERNAL user beside a zero-page owner into warnings", () => {
    const r = evaluateCompatibility({
      techniques: ["text_print", "krill"],
      requires: new Map(),
      facts: new Map([
        ["text_print", tech({ kernal: ["CHROUT"] })],
        [
          "krill",
          tech({ claims: [{ unit: "zero_page", mode: "owns", ranges: "E0-EF", relocatable: true }] }),
        ],
      ]),
      sharedRegisters: new Map(),
      sharedKernal: new Map(),
      recipeUses: [],
      kernalClobbers: new Map([["CHROUT", "D9-F6"]]),
    });
    expect(r.conflicts.map((c) => [c.kind, c.severity, c.a, c.b])).toEqual([
      ["kernal_clobbers_zp", "soft", "text_print", "krill"],
    ]);
    expect(r.verdict).toBe("warnings");
  });

  const krill = tech({ claims: [{ unit: "zero_page", mode: "owns", ranges: "E0-EF", relocatable: true }] });
  const base = {
    sharedRegisters: new Map(),
    sharedKernal: new Map(),
    recipeUses: [],
    kernalClobbers: new Map([["CHROUT", "D9-F6"]]),
  };

  it("reports a prerequisite's KERNAL call as a prerequisite_conflict via it", () => {
    const r = evaluateCompatibility({
      ...base,
      techniques: ["game", "krill"],
      requires: new Map([["game", ["printer"]]]),
      facts: new Map([
        ["game", tech({})],
        ["printer", tech({ kernal: ["CHROUT"] })],
        ["krill", krill],
      ]),
    });
    expect(r.conflicts.map((c) => [c.kind, c.underlying_kind, c.a, c.b, c.via])).toEqual([
      ["prerequisite_conflict", "kernal_clobbers_zp", "game", "krill", ["printer"]],
    ]);
    expect(r.conflicts[0]?.rationale).toMatch(/^game requires printer\. printer calls the KERNAL/);
  });

  it("does not repeat through a prerequisite a hit the input already reported", () => {
    const r = evaluateCompatibility({
      ...base,
      techniques: ["game", "krill"],
      requires: new Map([["game", ["printer"]]]),
      facts: new Map([
        ["game", tech({ kernal: ["CHROUT"] })],
        ["printer", tech({ kernal: ["CHROUT"] })],
        ["krill", krill],
      ]),
    });
    expect(r.conflicts.map((c) => [c.kind, c.a, c.b])).toEqual([["kernal_clobbers_zp", "game", "krill"]]);
  });

  it("checks a technique against its own prerequisite and against itself", () => {
    const own = evaluateCompatibility({
      ...base,
      techniques: ["demo", "other"],
      requires: new Map([["demo", ["krill"]]]),
      facts: new Map([
        ["demo", tech({ kernal: ["CHROUT"] })],
        ["krill", krill],
        ["other", tech({})],
      ]),
    });
    expect(own.conflicts.map((c) => [c.kind, c.underlying_kind, c.a, c.b, c.via])).toEqual([
      ["prerequisite_conflict", "kernal_clobbers_zp", "demo", "demo", ["krill"]],
    ]);
    const self = evaluateCompatibility({
      ...base,
      techniques: ["krill", "other"],
      requires: new Map(),
      facts: new Map([
        ["krill", { ...krill, kernal: ["CHROUT"] }],
        ["other", tech({})],
      ]),
    });
    expect(self.conflicts.map((c) => [c.kind, c.a, c.b, c.via])).toEqual([
      ["kernal_clobbers_zp", "krill", "krill", undefined],
    ]);
  });

  it("finds nothing against a holder whose claims are unknown, and says so in coverage", () => {
    const r = evaluateCompatibility({
      ...base,
      techniques: ["game", "mystery"],
      requires: new Map(),
      facts: new Map([
        ["game", tech({ kernal: ["CHROUT"] })],
        ["mystery", tech({ claimsStated: "unknown" })],
      ]),
    });
    expect(r.conflicts).toEqual([]);
    expect(r.verdict).toBe("compatible");
    expect(r.data_coverage.find((c) => c.technique === "mystery")?.claims).toBe("unknown");
  });
});
