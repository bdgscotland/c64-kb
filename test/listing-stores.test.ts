import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it, expect } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";
import {
  declaredFor,
  harnessUnits,
  listingStores,
  scanRecipePage,
  undeclaredStores,
  unitsAt,
  type TechniqueClaimSet,
} from "../src/graph/listing-stores.ts";

// The recipe listing scan (#22 step 8, src/graph/listing-stores.ts).

const page = (fm: string, code: string) => `---
recipe: demo
toolchain: kickassembler
output_format: prg
region: both
${fm}
---

<!-- doc-type: recipe -->

# Demo

\`\`\`asm
${code}
\`\`\`
`;

describe("listing scan: which stores it sees", () => {
  it("maps literal, constant and offset operands to units", () => {
    const stores = listingStores(
      page(
        "",
        [
          ".const SIGVOL = $d418",
          ".label spr0x = $d000",
          "        sta $0314",
          "loop:   stx SIGVOL",
          "        sty spr0x+3          // sprite 1 Y",
          "        sta $d020            // border: no unit",
        ].join("\n"),
      ),
    );
    expect(stores.map((s) => s.units)).toEqual([["irq_vector_0314"], ["sid_filter_volume"], ["sprite_1"]]);
  });

  it("reads only inside code fences", () => {
    expect(listingStores("Prose: `sta $0314` installs the vector.\n")).toEqual([]);
  });

  it("widens an indexed store only from a base a unit owns", () => {
    const stores = listingStores(page("", ["  sta $d400,x", "  sta $fe00,x", "  sta $ffff,y"].join("\n")));
    expect(stores).toHaveLength(1);
    expect(stores[0]?.units).toEqual(
      expect.arrayContaining(["sid_voice_1", "sid_voice_2", "sid_voice_3", "sid_filter_volume"]),
    );
  });

  it("skips a labelled $FFFF placeholder, and stores that only switch units off", () => {
    const code = [
      "dst: sta $ffff",
      "  lda #0",
      "  sta $d015",
      "  lda #$7f",
      "  sta $dc0d",
      "  lda #$81",
      "  sta $dc0d",
    ].join("\n");
    expect(listingStores(page("", code)).map((s) => s.text)).toEqual(["sta $dc0d"]);
  });

  it("counts a $DC0D store for any CIA1 unit", () => {
    expect(unitsAt(0xdc0d)).toEqual(["cia1_timer_a", "cia1_timer_b", "cia1_tod"]);
  });
});

describe("listing scan: what counts as declared", () => {
  const techniques = new Map<string, TechniqueClaimSet>([
    ["raster_bars", { claims: [{ unit: "vic_raster_irq", mode: "owns" }], requires: ["stable_raster_irq"] }],
    ["stable_raster_irq", { claims: [{ unit: "cia1_timer_a", mode: "init" }], requires: [] }],
    ["joystick_edge_detect", { claims: [{ unit: "cia1_port_a", mode: "reads" }], requires: [] }],
    ["no_line", { claims: null, requires: [] }],
  ]);

  it("takes the recipe's claims, its harness units and its techniques' REQUIRES closure", () => {
    const d = declaredFor(
      {
        techniques: ["raster_bars", "no_line"],
        claims: [{ unit: "irq_vector_0314", mode: "owns" }],
        harness: harnessUnits("[cia2_timer_b, $02FF]"),
      },
      techniques,
    );
    expect([...d.units].sort()).toEqual([
      "cia1_timer_a",
      "cia2_timer_b",
      "irq_vector_0314",
      "vic_raster_irq",
    ]);
    expect(d.unknown).toEqual(["no_line"]);
  });

  it("does not let a reads claim cover a store", () => {
    const d = declaredFor({ techniques: ["joystick_edge_detect"], claims: [], harness: [] }, techniques);
    const hits = undeclaredStores(listingStores(page("", "  sta $dc00")), d);
    expect(hits.map((h) => h.units)).toEqual([["cia1_port_a"]]);
  });

  it("names the recipe, the line and the techniques with no Claims line", () => {
    const w = scanRecipePage(page("techniques: [no_line]", "  sta $0314"), "recipes/k/demo.md", techniques);
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(
      /^recipes\/k\/demo\.md: recipe kickassembler-demo stores to irq_vector_0314 \(line 14: `sta \$0314`\).*\(no Claims line: no_line\)$/,
    );
  });
});

// The measurement behind "false positives are low": every recipe page in
// docs/, scanned against the Claims lines as the extractor reads them. The
// 69 recipes with claims: pass the claims watch (npm run claims:recipes),
// so a warning on one of them is a false positive by that measure: there is
// one, tech-tech, whose `sta $dd0d` writes the byte just read from $DC0D,
// a value no static read can know. The other four have no claims: key and
// do store to those units. Update this list when a page changes, and say why.
describe("listing scan over the real recipe pages", () => {
  const docs = join(import.meta.dirname, "..", "docs");
  const md = (d: string) =>
    readdirSync(d, { withFileTypes: true, recursive: true })
      .filter((x) => x.isFile() && x.name.endsWith(".md"))
      .map((x) => join(x.parentPath, x.name));

  function techniqueClaims(): Map<string, TechniqueClaimSet> {
    const out = new Map<string, { claims: TechniqueClaimSet["claims"]; requires: string[] }>();
    const get = (n: string) => {
      const t = out.get(n) ?? { claims: null, requires: [] };
      out.set(n, t);
      return t;
    };
    for (const f of md(join(docs, "techniques")))
      for (const e of extractGraphEntities(readFileSync(f, "utf8"), relative(docs, f))) {
        if (e.type === "technique" && e.claims_stated) get(e.name).claims ??= [];
        else if (e.type === "claims") get(e.owner).claims = [...(get(e.owner).claims ?? []), e];
        else if (e.type === "technique_requires") get(e.technique).requires.push(e.requires);
      }
    return out;
  }

  it("warns on exactly the recipes measured on 2026-09-24", () => {
    const techniques = techniqueClaims();
    const warned = new Set<string>();
    for (const f of md(join(docs, "recipes"))) {
      const p = relative(docs, f);
      if (scanRecipePage(readFileSync(f, "utf8"), p, techniques).length > 0) warned.add(p);
    }
    expect([...warned].sort()).toEqual([
      "recipes/kickassembler/crt-banked.md",
      "recipes/kickassembler/easyflash-save.md",
      "recipes/kickassembler/sparkle-dd02-bank.md",
      "recipes/kickassembler/tape-turbo-loader.md",
      "recipes/kickassembler/tech-tech.md",
    ]);
  });
});
