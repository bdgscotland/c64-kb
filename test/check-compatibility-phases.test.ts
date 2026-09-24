import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility } from "../src/tools/query.ts";
import { parseClaims } from "../src/graph/claims.ts";
import { DEMAND_VOCABULARY } from "../src/graph/extract.ts";
import type { TechniqueFacts } from "../src/tools/query/compatibility/index.ts";
import {
  RASTER_IRQ_PITFALL,
  SPRITE_PITFALL,
  stateRules,
  type StateData,
} from "../src/tools/query/compatibility/state-rules.ts";

// #94: state one technique keeps up (a raster IRQ, sprites, the KERNAL
// banked out) against another's KERNAL disk I/O, within a phase and across
// phases, and name:phase on a plain technique list.

const facts = (over: Partial<TechniqueFacts> = {}): TechniqueFacts => ({
  found: true,
  demands: new Set(),
  registers: 1,
  kernal: [],
  band: null,
  region: null,
  category: null,
  rasterRegisters: 0,
  claims: [],
  claimsStated: "stated",
  ...over,
});

// The trigger lines of the two pitfalls (pitfalls/kernal-and-io.md).
const DATA: StateData = {
  serialPitfalls: [
    {
      name: RASTER_IRQ_PITFALL,
      routines: ["OPEN", "CLOSE", "CHKIN", "CHKOUT", "CLRCHN", "CHRIN", "CHROUT", "LOAD", "SAVE"],
    },
    { name: SPRITE_PITFALL, routines: ["IECIN", "CHRIN", "CHKIN", "OPEN", "CLOSE"] },
  ],
  recipeKernalOut: [
    {
      recipe: "kickassembler-sprite-multiplex-game",
      implements: ["sprite_multiplex_game"],
      via: ["ram_under_kernal"],
    },
  ],
};

const MUX = facts({
  demands: new Set(["midframe_raster_irqs", "changes_sprite_set"]),
  claims: [
    { unit: "sprite_0", mode: "owns" },
    { unit: "vic_raster_irq", mode: "owns" },
  ],
});
const LOAD = facts({ kernal: ["SETLFS", "SETNAM", "LOAD", "SETMSG"] });
const READ = facts({ kernal: ["SETLFS", "SETNAM", "OPEN", "CHKIN", "CHRIN", "READST", "CLRCHN", "CLOSE"] });
const KOUT = facts({ demands: new Set(["kernal_rom_out"]) });

describe("stateRules (pure)", () => {
  it("in one phase: a multiplexer beside a sequential read is both pitfalls, soft, no across", () => {
    const hits = stateRules(
      { name: "sprite_multiplex_game", facts: MUX },
      { name: "kernal_file_read_seq", facts: READ },
      DATA,
    );
    const kinds = hits.map((h) => h.kind).sort();
    expect(kinds).toEqual([
      "raster_irq_during_serial_io",
      "recipe_kernal_out",
      "sprites_over_badlines_hang_serial_io",
    ]);
    const raster = hits.find((h) => h.kind === "raster_irq_during_serial_io");
    expect(raster).toMatchObject({ a: "sprite_multiplex_game", b: "kernal_file_read_seq", severity: "soft" });
    expect(raster?.shared).toEqual(["CHKIN", "CHRIN", "CLOSE", "CLRCHN", "OPEN"]);
    expect(raster).not.toHaveProperty("across");
    expect(hits.find((h) => h.kind === "recipe_kernal_out")?.severity).toBe("info");
  });

  it("LOAD alone triggers the raster pitfall, not the sprite one, whose lines do not name it", () => {
    const kinds = stateRules(
      { name: "sprite_multiplex_game", facts: MUX, phase: "play" },
      { name: "kernal_load_to_address", facts: LOAD, phase: "transition" },
      DATA,
    ).map((h) => h.kind);
    expect(kinds).toContain("raster_irq_during_serial_io");
    expect(kinds).not.toContain("sprites_over_badlines_hang_serial_io");
  });

  it("across phases: tagged with both phases; KERNAL-out is soft, not hard", () => {
    const hits = stateRules(
      { name: "ram_under_kernal", facts: KOUT, phase: "play" },
      { name: "kernal_file_read_seq", facts: READ, phase: "transition" },
      DATA,
    );
    expect(hits).toEqual([
      expect.objectContaining({
        a: "ram_under_kernal",
        b: "kernal_file_read_seq",
        kind: "kernal_banked_out",
        severity: "soft",
        across: { a_phase: "play", b_phase: "transition" },
      }),
    ]);
  });

  it("state goes forward only: play's IRQ never reaches an init read, an init member's does reach play", () => {
    const readInit = { name: "kernal_file_read_seq", facts: READ, phase: "init" as const };
    expect(stateRules({ name: "mux", facts: MUX, phase: "play" }, readInit, DATA)).toEqual([]);
    const kinds = stateRules(
      { name: "mux", facts: MUX, phase: "init" },
      { name: "kernal_file_read_seq", facts: READ, phase: "transition" },
      DATA,
    ).map((h) => h.kind);
    expect(kinds).toContain("raster_irq_during_serial_io");
  });

  it("a technique without KERNAL calls, or without an IRQ or sprites, gives nothing", () => {
    expect(stateRules({ name: "a", facts: MUX }, { name: "b", facts: facts() }, DATA)).toEqual([]);
    expect(stateRules({ name: "a", facts: facts() }, { name: "b", facts: READ }, DATA)).toEqual([]);
  });
});

function demandText(r: string): string {
  const text = new Map(Object.entries(DEMAND_VOCABULARY)).get(r);
  if (text === undefined) throw new Error(`not a demand word: ${r}`);
  return text;
}

// The #22 game test's T4 (result.md): the play phase ran a KERNAL-out
// multiplexer (the recipe it came from implements ram_under_kernal), the
// transition loaded level 2 through the KERNAL, and no check said so.
describe("checkCompatibility by phase: the game test's T4", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    const tech = (name: string, category: string) =>
      f.addTechnique({ name, title: name, category, complexity: "medium" });
    await tech("sprite_multiplex_game", "sprite");
    await tech("scroll_panel_split", "scroll");
    await tech("ram_under_kernal", "banking");
    await tech("kernal_load_to_address", "io");
    await tech("kernal_file_read_seq", "io");
    // Demands, claims and KERNAL calls as the shipped pages state them.
    await f.linkTechniqueDemands(
      "sprite_multiplex_game",
      "midframe_raster_irqs",
      demandText("midframe_raster_irqs"),
    );
    await f.linkTechniqueDemands(
      "sprite_multiplex_game",
      "changes_sprite_set",
      demandText("changes_sprite_set"),
    );
    await f.linkTechniqueDemands(
      "scroll_panel_split",
      "midframe_raster_irqs",
      demandText("midframe_raster_irqs"),
    );
    await f.linkTechniqueDemands("ram_under_kernal", "kernal_rom_out", demandText("kernal_rom_out"));
    const claim = async (owner: string, ownerKind: "Technique" | "Recipe", line: string) => {
      const parsed = parseClaims(line);
      if ("error" in parsed) throw new Error(parsed.error);
      for (const c of parsed) await f.linkClaims({ owner, ownerKind, ...c, basis: "derived-listing" });
    };
    await claim("sprite_multiplex_game", "Technique", "sprite_0-7 (owns), vic_raster_irq (owns)");
    await claim("scroll_panel_split", "Technique", "vic_raster_irq (owns)");
    const kernal = async (t: string, routines: string[]) => {
      for (const k of routines) {
        await f.addKernalRoutine(k, "$FFD2", k);
        await f.linkTechniqueUsesKernal(t, k);
      }
    };
    await kernal("kernal_load_to_address", ["SETLFS", "SETNAM", "LOAD", "SETMSG"]);
    await kernal("kernal_file_read_seq", [
      "SETLFS",
      "SETNAM",
      "OPEN",
      "CHKIN",
      "CHRIN",
      "READST",
      "CLRCHN",
      "CLOSE",
    ]);
    await f.addRecipe({
      name: "kickassembler-sprite-multiplex-game",
      toolchain: "kickassembler",
      output_format: "PRG",
      region: "both",
      source_doc: "recipes/kickassembler/sprite-multiplex-game.md",
    });
    await f.linkRecipeImplements("kickassembler-sprite-multiplex-game", "sprite_multiplex_game");
    await f.linkRecipeImplements("kickassembler-sprite-multiplex-game", "ram_under_kernal");
    for (const [name, routines] of [
      [RASTER_IRQ_PITFALL, ["OPEN", "CLOSE", "CHKIN", "CLRCHN", "CHRIN", "LOAD"]],
      [SPRITE_PITFALL, ["CHRIN", "CHKIN", "OPEN", "CLOSE"]],
    ] as const) {
      await f.addPitfall({ name, title: name, severity: "high", region: "both", category: "kernal" });
      for (const k of routines) await f.linkTriggeredBy(name, k, "KernalRoutine");
    }
  });
  afterAll(async () => f.close());

  const PLAY = ["scroll_panel_split", "sprite_multiplex_game"];
  const TRANSITION = ["kernal_load_to_address:transition", "kernal_file_read_seq:transition"];

  it("before #94 each phase alone was silent; the phased list reports what crosses", async () => {
    const res = await checkCompatibility([...PLAY, ...TRANSITION]);
    const r = res.structured;
    expect(r.phases?.map((p) => p.phase)).toEqual(["play", "transition"]);
    const cross = r.conflicts.filter((c) => c.across);
    const kinds = new Set(cross.map((c) => c.kind));
    expect(kinds).toEqual(
      new Set(["raster_irq_during_serial_io", "sprites_over_badlines_hang_serial_io", "recipe_kernal_out"]),
    );
    expect(cross.find((c) => c.kind === "sprites_over_badlines_hang_serial_io")).toMatchObject({
      a: "sprite_multiplex_game",
      b: "kernal_file_read_seq",
      across: { a_phase: "play", b_phase: "transition" },
    });
    // Play alone is incompatible on its own (two raster-IRQ owners, the
    // game test's T2); the cross-phase findings are soft.
    expect(cross.every((c) => c.severity !== "hard")).toBe(true);
    expect(res.text).toContain("## Across phases");
  });

  it("listing ram_under_kernal states KERNAL-out: kernal_banked_out across phases, hard within one", async () => {
    const phased = (await checkCompatibility([...PLAY, "ram_under_kernal", ...TRANSITION])).structured;
    expect(phased.conflicts.filter((c) => c.kind === "kernal_banked_out" && c.across)).toHaveLength(2);
    const flat = (await checkCompatibility(["ram_under_kernal", "kernal_load_to_address"])).structured;
    expect(flat.conflicts.find((c) => c.kind === "kernal_banked_out")?.severity).toBe("hard");
    expect(flat.verdict).toBe("incompatible");
  });

  it("a count on a name is read and dropped", async () => {
    const r = (await checkCompatibility(["sprite_multiplex_game ×2", "scroll_panel_split"])).structured;
    expect(r.not_found).toEqual([]);
    expect(r.techniques).toEqual(["sprite_multiplex_game", "scroll_panel_split"]);
  });
});
