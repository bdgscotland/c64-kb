import { describe, it, expect, vi } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";

// A recipe's `raster_bands:` frontmatter (#90): where its trace ran a
// technique whose page band is movable or unstated. It rides the implements
// entity for check_compatibility's "name@lines" form; no graph edge.

function recipe(bands: string): string {
  return `---
recipe: demo
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [sideborder_open, raster_bars, sprite_border_scroller]
${bands}
---

<!-- doc-type: recipe -->

# Demo
`;
}

const bandsOf = (md: string) =>
  Object.fromEntries(
    extractGraphEntities(md, "recipes/kickassembler/demo.md").flatMap((e) =>
      e.type === "implements" ? [[e.technique, e.band ?? null]] : [],
    ),
  );

describe("recipe raster_bands: frontmatter (#90)", () => {
  it("puts each band on its technique's implements entity, a wrap as two ranges", () => {
    expect(bandsOf(recipe("raster_bands: [raster_bars@17-50, sprite_border_scroller@273-311,0-1]"))).toEqual({
      sideborder_open: null,
      raster_bars: "17-50",
      sprite_border_scroller: "0-1,273-311",
    });
  });

  it("no key: no bands", () => {
    expect(bandsOf(recipe(""))).toEqual({
      sideborder_open: null,
      raster_bars: null,
      sprite_border_scroller: null,
    });
  });

  it("drops, with a warning, an unlisted technique, a bad band and 'movable'", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const got = bandsOf(
      recipe(
        "raster_bands: [fli_image@45-251, raster_bars@50-20, sideborder_open@movable, sprite_border_scroller@273-299]",
      ),
    );
    expect(got).toEqual({ sideborder_open: null, raster_bars: null, sprite_border_scroller: "273-299" });
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(
      lines.some((l) => l.includes("raster_bands names fli_image, which techniques: does not list")),
    ).toBe(true);
    expect(lines.some((l) => l.includes('"raster_bars@50-20" refused (range 50-20 runs backwards'))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes('"sideborder_open@movable" refused (a placement names lines)'))).toBe(
      true,
    );
    warn.mockRestore();
  });
});
