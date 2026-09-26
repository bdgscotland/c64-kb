import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pagePitfalls, sectionItems, techniquePagePitfalls } from "../src/tools/pitfalls/page.ts";

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs");

const PAGE = `<!-- doc-type: technique-reference -->

## alpha_step — Alpha

**Region:** both

### How

Text.

### Pitfalls

- First one, which runs
  onto a second line.
- Second one.

### Recipes

- none

## beta_step — Beta

### Pitfalls

**A bold lead.** A paragraph that
continues here.

Another paragraph.

## gamma_step — Gamma

### Pitfalls met

- Met one.

## delta_bold — Delta

**When not to use it.**

- Not this.

**Pitfalls.**

- **Bold one.** Text.
- Two.

### In Commando (1985)

Measured.
`;

describe("technique page pitfalls (KB-GAPS 19)", () => {
  it("reads the bullets of a technique's own Pitfalls section, one item each", () => {
    expect(pagePitfalls(PAGE, "alpha_step")).toEqual([
      "First one, which runs onto a second line.",
      "Second one.",
    ]);
  });

  it("reads paragraphs when the section has no bullets, and stops at the next H2", () => {
    expect(pagePitfalls(PAGE, "beta_step")).toEqual([
      "**A bold lead.** A paragraph that continues here.",
      "Another paragraph.",
    ]);
  });

  it("reads a Pitfalls met section too, and nothing for a name with no section or no heading", () => {
    expect(pagePitfalls(PAGE, "gamma_step")).toEqual(["Met one."]);
    expect(pagePitfalls(PAGE, "epsilon_step")).toBeNull();
    expect(pagePitfalls(PAGE, "alpha_step".replace("alpha", "zeta"))).toBeNull();
    expect(sectionItems("")).toEqual([]);
  });

  it("reads a bold **Pitfalls.** paragraph heading up to the next heading", () => {
    expect(pagePitfalls(PAGE, "delta_bold")).toEqual(["**Bold one.** Text.", "Two."]);
  });

  it("finds facing_turn_step's four page pitfalls in docs/techniques", () => {
    const r = techniquePagePitfalls(DOCS, "facing_turn_step");
    expect(r?.source).toBe("techniques/input.md");
    expect(r?.items).toHaveLength(4);
    expect(r?.items[0]).toMatch(/^A centred stick must hold the facing/);
    expect(r?.items[3]).toMatch(/joystick_edge_detect/);
  });

  it("finds grenade_lob's page and answers null for a technique no page holds", () => {
    const g = techniquePagePitfalls(DOCS, "grenade_lob");
    expect(g?.source).toBe("techniques/logic.md");
    expect(g?.items).toHaveLength(4);
    expect(g?.items[0]).toMatch(/^\*\*8-bit bounds\.\*\*/);
    expect(techniquePagePitfalls(DOCS, "checkpoint_respawn")?.items).toHaveLength(5);
    expect(techniquePagePitfalls(DOCS, "no_such_technique_here")).toBeNull();
  });
});
