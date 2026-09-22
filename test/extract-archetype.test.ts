import { describe, it, expect, vi } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.js";

// docs/CONVENTIONS-archetypes.md: H2 is the title, **Archetype:** carries the
// name, the fingerprint and common-pitfalls lines are the edge sources.
const ARCHETYPE_DOC = `---
kind: game
---

<!-- doc-type: archetype-reference -->

# C64 Game Archetypes

Intro prose that is not an archetype.

## Vertical Shmup

**Archetype:** \`vertical_shmup\`

Prose about the vertical shooter.

**Technique fingerprint:** \`soft_scroll_v\`, \`sprite_multiplex_24\`, \`stable_raster_irq\`, \`soft_scroll_v\`, \`no_such_technique\`, Not A Name

**Common pitfalls:** \`sprite_dma_overflow\`, \`badline_cycle_loss\`

**Reference titles:** Uridium (1986)

## Text Adventure / Parser-Driven

**Archetype:** text_adventure

**Technique fingerprint:** \`ram_under_kernal\`

**Common pitfalls:** \`kernal_clobbers_a_x_y\`, \`kernal_clobbers_a_x_y\`

## A Section With No Name Line

**Technique fingerprint:** \`plasma\`
`;

describe("extractGraphEntities — archetype-reference doc", () => {
  const SRC = "docs/game-design/c64-game-archetypes.md";

  it("emits one Archetype node per H2 that carries an **Archetype:** line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entities = extractGraphEntities(ARCHETYPE_DOC, SRC);
    warn.mockRestore();
    const nodes = entities.filter(e => e.type === "archetype");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toEqual({
      type: "archetype",
      name: "vertical_shmup",
      title: "Vertical Shmup",
      kind: "game",
      source_doc: SRC,
    });
    expect(nodes[1]).toMatchObject({ name: "text_adventure", title: "Text Adventure / Parser-Driven" });
  });

  it("emits FEATURES sources from the fingerprint line, deduped, keeping an unknown snake_case name for link time", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entities = extractGraphEntities(ARCHETYPE_DOC, SRC);
    const features = entities
      .filter((e): e is Extract<typeof e, { type: "archetype_features" }> => e.type === "archetype_features")
      .filter(e => e.archetype === "vertical_shmup")
      .map(e => e.technique);
    // soft_scroll_v listed twice -> once. no_such_technique is a well-formed
    // name whose existence is settled at link time, so it is kept here.
    expect(features).toEqual(["soft_scroll_v", "sprite_multiplex_24", "stable_raster_irq", "no_such_technique"]);
    // "Not A Name" is refused at extract time with a warning.
    expect(warn.mock.calls.some(c => String(c[0]).includes('"Not A Name"'))).toBe(true);
    warn.mockRestore();
  });

  it("is silent about a prose H2 without a name line, and warns only when such a section carries a fingerprint", () => {
    const doc = `---
kind: demo
---

<!-- doc-type: archetype-reference -->

# Demo forms

## History

Plain prose, no node.

## Cracktro

**Archetype:** \`cracktro\`

**Technique fingerprint:** \`raster_bars\`

## Orphan

**Technique fingerprint:** \`sine_scroller\`
`;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entities = extractGraphEntities(doc, "demo-design/x.md");
    const msgs = warn.mock.calls.map(c => String(c[0]));
    warn.mockRestore();
    const names = entities.filter(e => e.type === "archetype").map(e => (e as { name: string }).name);
    expect(names).toEqual(["cracktro"]);
    expect(msgs.some(m => m.includes('"History"'))).toBe(false);
    expect(msgs.some(m => m.includes('"Orphan"'))).toBe(true);
  });

  it("emits RISKS sources from the common-pitfalls line, deduped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entities = extractGraphEntities(ARCHETYPE_DOC, SRC);
    warn.mockRestore();
    const risks = entities
      .filter((e): e is Extract<typeof e, { type: "archetype_risks" }> => e.type === "archetype_risks")
      .map(e => `${e.archetype}|${e.pitfall}`);
    expect(risks).toEqual([
      "vertical_shmup|sprite_dma_overflow",
      "vertical_shmup|badline_cycle_loss",
      "text_adventure|kernal_clobbers_a_x_y",
    ]);
  });

  it("warns about and skips an H2 with no **Archetype:** line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entities = extractGraphEntities(ARCHETYPE_DOC, SRC);
    expect(warn.mock.calls.some(c => String(c[0]).includes("A Section With No Name Line"))).toBe(true);
    warn.mockRestore();
    expect(entities.some(e => e.type === "archetype_features" && e.technique === "plasma")).toBe(false);
  });

  it("defaults kind to game and refuses an unknown kind", () => {
    const noFm = ARCHETYPE_DOC.replace("---\nkind: game\n---\n\n", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nodes = extractGraphEntities(noFm, SRC).filter(e => e.type === "archetype");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ kind: "game" });

    const badKind = ARCHETYPE_DOC.replace("kind: game", "kind: toy");
    expect(extractGraphEntities(badKind, SRC)).toHaveLength(0);
    warn.mockRestore();
  });

  it("ignores the CONVENTIONS page that explains the marker", () => {
    expect(extractGraphEntities(ARCHETYPE_DOC, "docs/CONVENTIONS-archetypes.md")).toHaveLength(0);
  });
});
