import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility, techniqueLookup } from "../src/tools/query.ts";
import {
  extractGraphEntities,
  parseRasterBand,
  rasterBandsOverlap,
  DEMAND_VOCABULARY,
} from "../src/graph/extract.ts";

// The vocabulary's text for a demand word; throws on a word it does not hold.
function demandText(r: string): string {
  const text = new Map(Object.entries(DEMAND_VOCABULARY)).get(r);
  if (text === undefined) throw new Error(`not a demand word: ${r}`);
  return text;
}

// **Raster band:** (docs/CONVENTIONS-techniques.md, schema 24): the raster
// lines a technique holds the CPU on. check_compatibility's line-sharing
// rules fire only when the bands overlap or one of them is not known.

function doc(meta: string): string {
  return `---
category: raster
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Raster Techniques

## sideborder_open — Open the side border

**Complexity:** high
${meta}

Body text.
`;
}

describe("parseRasterBand", () => {
  it("reads ranges, single lines and movable, and drops a trailing note", () => {
    expect(parseRasterBand("45-250")).toEqual({ kind: "lines", ranges: [[45, 250]], canonical: "45-250" });
    expect(parseRasterBand("45–250")).toEqual({ kind: "lines", ranges: [[45, 250]], canonical: "45-250" });
    expect(parseRasterBand("251-311, 0-50 (both borders)")).toEqual({
      kind: "lines",
      ranges: [
        [0, 50],
        [251, 311],
      ],
      canonical: "0-50,251-311",
    });
    expect(parseRasterBand("`100`")).toEqual({ kind: "lines", ranges: [[100, 100]], canonical: "100" });
    expect(parseRasterBand("movable (the recipe opens lines 101-142)")).toEqual({
      kind: "movable",
      canonical: "movable",
    });
  });

  it("refuses what is outside the grammar", () => {
    for (const bad of ["display", "250-45", "0-400", "", "lines 51 to 250"]) {
      expect("error" in parseRasterBand(bad)).toBe(true);
    }
  });

  it("overlap is inclusive at the ends", () => {
    expect(rasterBandsOverlap([[0, 50]], [[51, 250]])).toBe(false);
    expect(rasterBandsOverlap([[0, 51]], [[51, 250]])).toBe(true);
    expect(
      rasterBandsOverlap(
        [
          [0, 10],
          [251, 311],
        ],
        [[45, 250]],
      ),
    ).toBe(false);
  });
});

describe("extractGraphEntities - Raster band line", () => {
  it("puts the canonical band on the technique entity", () => {
    const t = extractGraphEntities(doc("**Raster band:** 101-142 (recipe)"), "techniques/raster.md").find(
      (e) => e.type === "technique",
    );
    expect(t?.raster_band ?? null).toBe("101-142");
  });

  it("warns about and drops a band it cannot read", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const t = extractGraphEntities(doc("**Raster band:** the lower half"), "techniques/raster.md").find(
        (e) => e.type === "technique",
      );
      expect(t ? t.raster_band : "missing").toBeUndefined();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("Raster band"))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("every shipped technique page parses its Raster band lines without a warning", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../docs/techniques");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const banded: string[] = [];
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".md"))) {
        for (const e of extractGraphEntities(fs.readFileSync(path.join(dir, f), "utf8"), `techniques/${f}`)) {
          if (e.type === "technique" && e.raster_band) banded.push(`${e.name}=${e.raster_band}`);
        }
      }
      expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("Raster band"))).toEqual([]);
      expect(banded).toContain("fli_image=45-251");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("checkCompatibility with raster bands", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    const techs: [string, string | undefined][] = [
      ["fli_band", "45-250"], // FLI in the display window
      ["border_band", "0-44,251-311"], // a side-border loop in the borders only
      ["overlap_band", "101-142"], // a side-border loop inside the display
      ["no_band", undefined], // a cpu_every_line page that states nothing
      ["movable_band", "movable"], // lines chosen by the program
      ["plex_band", "0-40"], // a multiplexer confined to the top border
    ];
    for (const [name, band] of techs) {
      await f.addTechnique({
        name,
        title: name,
        category: "raster",
        complexity: "high",
        ...(band ? { raster_band: band } : {}),
      });
    }
    const d = (t: string, r: string) => f.linkTechniqueDemands(t, r, demandText(r));
    for (const t of ["fli_band", "border_band", "overlap_band", "no_band", "movable_band"]) {
      await d(t, "cpu_every_line");
      await d(t, "constant_sprite_set");
    }
    await d("plex_band", "midframe_raster_irqs");
    await d("plex_band", "changes_sprite_set");
  });
  afterAll(async () => f.close());

  it("disjoint bands: compatible, and the pair is reported as band-separated", async () => {
    const r = await checkCompatibility(["fli_band", "border_band"]);
    expect(r.structured.verdict).toBe("compatible");
    expect(r.structured.conflicts).toEqual([]);
    expect(r.structured.band_separated).toEqual([
      { a: "fli_band", b: "border_band", a_band: "45-250", b_band: "0-44,251-311", rules: ["cpu_exclusive"] },
    ]);
    expect(r.text).toMatch(/Separated by raster band/);
  });

  it("overlapping bands: cpu_exclusive, and the rationale says they overlap", async () => {
    const r = (await checkCompatibility(["fli_band", "overlap_band"])).structured;
    expect(r.verdict).toBe("incompatible");
    const c = r.conflicts.find((x) => x.kind === "cpu_exclusive");
    expect(c?.rationale).toMatch(/overlap/);
    expect(r.band_separated).toEqual([]);
  });

  it("unknown band on one side: still a conflict, naming the unknown side", async () => {
    const r = (await checkCompatibility(["fli_band", "no_band"])).structured;
    expect(r.verdict).toBe("incompatible");
    expect(r.conflicts.find((x) => x.kind === "cpu_exclusive")?.rationale).toMatch(
      /no_band states no raster band/,
    );
  });

  it("a movable band is not a known band", async () => {
    const r = (await checkCompatibility(["movable_band", "border_band"])).structured;
    expect(r.verdict).toBe("incompatible");
    expect(r.conflicts.at(0)?.rationale).toMatch(/movable/);
  });

  it("clears cpu_vs_irq and sprite_set against a multiplexer on other lines", async () => {
    const r = (await checkCompatibility(["fli_band", "plex_band"])).structured;
    expect(r.verdict).toBe("compatible");
    expect(r.band_separated.at(0)?.rules.sort()).toEqual(["cpu_vs_irq", "sprite_set"]);
    const o = (await checkCompatibility(["overlap_band", "plex_band"])).structured;
    expect(o.verdict).toBe("compatible"); // 101-142 against 0-40
    const n = (await checkCompatibility(["no_band", "plex_band"])).structured;
    expect(n.conflicts.map((c) => c.kind).sort()).toEqual(["cpu_vs_irq", "sprite_set"]);
  });

  it("data_coverage and technique_lookup carry the band", async () => {
    const r = (await checkCompatibility(["fli_band", "no_band"])).structured;
    expect(r.data_coverage.find((d) => d.technique === "fli_band")?.raster_band).toBe("45-250");
    expect(r.data_coverage.find((d) => d.technique === "no_band")?.raster_band).toBeUndefined();
    const t = await techniqueLookup("fli_band");
    expect(t.structured.raster_band).toBe("45-250");
    expect(t.text).toContain("**Raster band:** 45-250");
  });

  it("a re-ingest that drops the line clears the band", async () => {
    await f.addTechnique({ name: "fli_band", title: "fli_band", category: "raster", complexity: "high" });
    const t = await techniqueLookup("fli_band");
    expect(t.structured.raster_band).toBeUndefined();
  });
});
