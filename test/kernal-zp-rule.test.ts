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
});
