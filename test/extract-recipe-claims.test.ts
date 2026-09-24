import { describe, it, expect, vi } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";

// A recipe's `claims:` frontmatter (docs/CONVENTIONS-recipes.md, schema 34):
// each claim becomes a CLAIMS edge from the Recipe; whether the key is
// present rides the recipe entity (claims_stated), absent reads as unknown.

function recipe(extra: string): string {
  return `---
recipe: sine-scroller
toolchain: kickassembler
output_format: prg
region: both
techniques: [sine_scroller]
${extra}
---

<!-- doc-type: recipe -->

# Sine scroller
`;
}

type Ents = ReturnType<typeof extractGraphEntities>;
const recipeOf = (ents: Ents) => ents.find((e) => e.type === "recipe");
const claimsOf = (ents: Ents) => ents.filter((e) => e.type === "claims");

describe("recipe claims: frontmatter", () => {
  it("turns each item into a Recipe-owned claim, basis measured-vice by default", () => {
    const ents = extractGraphEntities(
      recipe("claims: [irq_vector_0314 (owns), cia1_timer_a (init), zero_page $FB-$FE (owns)]"),
      "recipes/kickassembler/sine-scroller.md",
    );
    expect(recipeOf(ents)).toMatchObject({ claims_stated: "stated", claims_basis: "measured-vice" });
    expect(claimsOf(ents)).toEqual([
      {
        type: "claims",
        owner: "kickassembler-sine-scroller",
        ownerKind: "Recipe",
        unit: "irq_vector_0314",
        mode: "owns",
        basis: "measured-vice",
      },
      {
        type: "claims",
        owner: "kickassembler-sine-scroller",
        ownerKind: "Recipe",
        unit: "cia1_timer_a",
        mode: "init",
        basis: "measured-vice",
      },
      {
        type: "claims",
        owner: "kickassembler-sine-scroller",
        ownerKind: "Recipe",
        unit: "zero_page",
        mode: "owns",
        ranges: "FB-FE",
        basis: "measured-vice",
      },
    ]);
  });

  it("reads an absent key as unknown, and [] as none", () => {
    const absent = extractGraphEntities(recipe(""), "r.md");
    expect(recipeOf(absent)).not.toHaveProperty("claims_stated");
    expect(claimsOf(absent)).toEqual([]);
    const empty = extractGraphEntities(recipe("claims: []"), "r.md");
    expect(recipeOf(empty)).toMatchObject({ claims_stated: "none" });
    expect(claimsOf(empty)).toEqual([]);
  });

  it("takes claims_basis when given", () => {
    const ents = extractGraphEntities(
      recipe("claims: [sid_voice_2 (shares)]\nclaims_basis: derived-listing"),
      "r.md",
    );
    expect(recipeOf(ents)).toMatchObject({ claims_basis: "derived-listing" });
    expect(claimsOf(ents)[0]).toMatchObject({
      unit: "sid_voice_2",
      mode: "shares",
      basis: "derived-listing",
    });
  });

  it("refuses a value outside the grammar whole, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ents = extractGraphEntities(recipe("claims: [irq_vector_0314 (owns), bogus_unit]"), "r.md");
    expect(recipeOf(ents)).not.toHaveProperty("claims_stated");
    expect(claimsOf(ents)).toEqual([]);
    expect(warn.mock.calls.flat().join("\n")).toMatch(/recipe claims refused.*bogus_unit/);
    warn.mockRestore();
  });
});
