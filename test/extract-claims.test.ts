import { describe, it, expect, vi } from "vitest";
import {
  extractGraphEntities,
  parseClaims,
  HARDWARE_UNITS,
  formatZeroPageRanges,
  parseZeroPageRanges,
} from "../src/graph/extract.ts";

// The **Claims:** and **Claims basis:** lines (docs/CONVENTIONS-techniques.md,
// schema 25). Whether a page states claims rides the technique entity
// (claims_stated); each claim is a `claims` entity that becomes a CLAIMS edge.

function doc(meta: string, name = "sfx_engine_beside_music"): string {
  return `---
category: music
chip: SID
---

<!-- doc-type: technique-reference -->

# Music

## ${name} — A technique

**Complexity:** medium
**Region:** both
${meta}

Body text.
`;
}

type Ents = ReturnType<typeof extractGraphEntities>;
function techOf(ents: Ents) {
  const t = ents.find((e) => e.type === "technique");
  if (!t) throw new Error("no technique entity");
  return t;
}
function claimsOf(ents: Ents) {
  return ents.filter((e) => e.type === "claims");
}

describe("parseClaims", () => {
  it("defaults the mode to owns and expands unit ranges", () => {
    expect(parseClaims("sprite_0-7, vic_raster_irq")).toEqual([
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ unit: `sprite_${n}`, mode: "owns" })),
      { unit: "vic_raster_irq", mode: "owns" },
    ]);
  });

  it("reads a mode per item, and a mode on a unit range applies to each unit", () => {
    expect(parseClaims("sid_voice_2 (shares)")).toEqual([{ unit: "sid_voice_2", mode: "shares" }]);
    expect(parseClaims("sid_voice_1-3 (owns), cia1_port_b (reads), sid_voice_3_readback (init)")).toEqual([
      { unit: "sid_voice_1", mode: "owns" },
      { unit: "sid_voice_2", mode: "owns" },
      { unit: "sid_voice_3", mode: "owns" },
      { unit: "cia1_port_b", mode: "reads" },
      { unit: "sid_voice_3_readback", mode: "init" },
    ]);
  });

  it("parses zero-page ranges joined by + into canonical form, with relocatable", () => {
    expect(parseClaims("zero_page $02-$0D+$24-$2F (owns)")).toEqual([
      { unit: "zero_page", mode: "owns", ranges: "02-0D,24-2F" },
    ]);
    // The splitter respects parentheses: the comma inside "(owns, relocatable)" is not an item break.
    expect(
      parseClaims("serial_bus (owns), zero_page $E0-$EF (owns, relocatable), cia2_vic_bank (shares)"),
    ).toEqual([
      { unit: "serial_bus", mode: "owns" },
      { unit: "zero_page", mode: "owns", ranges: "E0-EF", relocatable: true },
      { unit: "cia2_vic_bank", mode: "shares" },
    ]);
    // Out-of-order and adjacent ranges merge; a single byte stays one byte.
    expect(parseClaims("zero_page $FD-$FE+$FB-$FC+$B7")).toEqual([
      { unit: "zero_page", mode: "owns", ranges: "B7,FB-FE" },
    ]);
  });

  it("treats none alone as an empty claim set", () => {
    expect(parseClaims("none")).toEqual([]);
    expect(parseClaims("`none`")).toEqual([]);
  });

  it("refuses unknown units, bad ranges, bad modes and misplaced words", () => {
    for (const bad of [
      "sid_voice_4", // no such unit
      "sprite_0-9", // range runs past the units
      "sprite_7-0", // backwards
      "sid_voice_2 (borrows)", // not a mode
      "sid_voice_2 (owns, shares)", // two modes
      "zero_page", // zero page needs its bytes
      "zero_page $00-$0F", // $00-$01 is the 6510 port
      "zero_page $20-$10", // backwards
      "zero_page $2", // not two hex digits
      "sid_voice_2 $D407", // only zero_page takes addresses
      "vic_raster_irq (owns, relocatable)", // only zero_page relocates
      "none, sid_voice_1", // none must stand alone
      "sid_voice_1, sid_voice_1-2", // a unit twice
      "", // empty
    ]) {
      const r = parseClaims(bad);
      expect("error" in r, `expected ${JSON.stringify(bad)} to be refused`).toBe(true);
    }
  });

  it("zero-page helpers round-trip", () => {
    const r = parseZeroPageRanges("$24-$2F+$02-$0D");
    if ("error" in r) throw new Error(r.error);
    expect(formatZeroPageRanges(r)).toBe("02-0D,24-2F");
  });

  it("seeds every unit named in the grammar examples", () => {
    const names = new Set(HARDWARE_UNITS.map((u) => u.name));
    for (const n of [
      "sid_voice_1",
      "sid_filter_volume",
      "sprite_7",
      "cia2_timer_b",
      "cia1_port_a",
      "serial_bus",
      "vic_raster_irq",
      "irq_vector_0314",
      "nmi_vector_fffa",
      "expansion_io2",
      "zero_page",
    ]) {
      expect(names.has(n), n).toBe(true);
    }
    expect(names.size).toBe(HARDWARE_UNITS.length); // no duplicate seeds
  });
});

describe("extractGraphEntities - technique Claims lines", () => {
  it("emits one claims entity per unit and marks the technique stated", () => {
    const ents = extractGraphEntities(
      doc("**Claims:** sid_voice_2 (shares)\n**Claims basis:** derived-listing"),
      "techniques/music-sid.md",
    );
    expect(techOf(ents).claims_stated).toBe("stated");
    expect(techOf(ents).claims_basis).toBe("derived-listing");
    expect(claimsOf(ents)).toEqual([
      {
        type: "claims",
        owner: "sfx_engine_beside_music",
        ownerKind: "Technique",
        unit: "sid_voice_2",
        mode: "shares",
        basis: "derived-listing",
      },
    ]);
  });

  it("accepts the basis line before the Claims line", () => {
    const ents = extractGraphEntities(
      doc("**Claims basis:** `estimated`\n**Claims:** vic_raster_irq"),
      "techniques/music-sid.md",
    );
    expect(claimsOf(ents)).toHaveLength(1);
    expect(techOf(ents).claims_basis).toBe("estimated");
  });

  it("none is stated and emits no edges; no line at all is unknown", () => {
    const none = extractGraphEntities(
      doc("**Claims:** none\n**Claims basis:** derived-listing"),
      "techniques/music-sid.md",
    );
    expect(techOf(none).claims_stated).toBe("none");
    expect(claimsOf(none)).toEqual([]);
    const absent = extractGraphEntities(doc(""), "techniques/music-sid.md");
    expect(techOf(absent).claims_stated).toBeUndefined();
    expect(claimsOf(absent)).toEqual([]);
  });

  it("refuses a Claims line without a basis, or with a basis outside the set, and leaves it unknown", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const meta of [
      "**Claims:** sid_voice_2 (shares)",
      "**Claims:** sid_voice_2 (shares)\n**Claims basis:** arithmetic",
    ]) {
      const ents = extractGraphEntities(doc(meta), "techniques/music-sid.md");
      expect(techOf(ents).claims_stated).toBeUndefined();
      expect(claimsOf(ents)).toEqual([]);
    }
    expect(warn.mock.calls.flat().join("\n")).toMatch(/no \*\*Claims basis:\*\* line/);
    expect(warn.mock.calls.flat().join("\n")).toMatch(/claims basis "arithmetic"/);
  });

  it("refuses the whole line when one item is bad, with a warning naming it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const ents = extractGraphEntities(
      doc("**Claims:** sid_voice_1, sid_voice_9\n**Claims basis:** derived-listing"),
      "techniques/music-sid.md",
    );
    expect(claimsOf(ents)).toEqual([]);
    expect(techOf(ents).claims_stated).toBeUndefined();
    const text = warn.mock.calls.flat().join("\n");
    expect(text).toMatch(/sid_voice_9/);
    // The basis line of a refused Claims line is not reported a second time as orphaned.
    expect(text).not.toMatch(/Claims basis:\*\* line but no \*\*Claims:\*\* line/);
  });

  it("the design's three examples parse as written", () => {
    const sfx = parseClaims("sid_voice_2 (shares)");
    const game = parseClaims("sprite_0-7 (owns), vic_raster_irq (owns)");
    const lfsr = parseClaims("sid_voice_3 (init), sid_voice_3_readback (init), cia1_timer_a (reads)");
    expect("error" in sfx || "error" in game || "error" in lfsr).toBe(false);
    expect(Array.isArray(game) && game.length).toBe(9);
    expect(Array.isArray(lfsr) && lfsr.map((c) => c.mode)).toEqual(["init", "init", "reads"]);
  });
});
