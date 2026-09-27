import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FalkorService } from "../src/services/falkor.ts";
import { extractGraphEntities, type GraphEntity } from "../src/graph/extract.ts";
import { applyEdge, applyNode, isNodeEntity } from "../src/graph/apply.ts";
import { checkCompatibility, planBudgetTool } from "../src/tools/query.ts";

// The run-and-gun starter's KB gaps 1, 3, 4, 5 and 30
// (templates/run-and-gun/KB-GAPS.md), asked of the shipped technique and
// hardware pages ingested into the test store, through the tools an agent
// calls. The graph name comes from vitest.config.ts (c64_test, or
// c64_test_<C64_TEST_STORE>).

function pageEntities(): GraphEntity[] {
  const root = path.resolve(__dirname, "../docs");
  const out: GraphEntity[] = [];
  for (const dir of ["hardware", "techniques"]) {
    for (const f of fs.readdirSync(path.join(root, dir)).filter((n) => n.endsWith(".md")))
      out.push(...extractGraphEntities(fs.readFileSync(path.join(root, dir, f), "utf8"), `${dir}/${f}`));
  }
  return out;
}

describe("run-and-gun gaps over the ingested pages", () => {
  let f: FalkorService;
  beforeAll(async () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      f = new FalkorService();
      await f.connect();
      await f.clean();
      await f.ensureSchema();
      const ents = pageEntities();
      for (const e of ents) if (isNodeEntity(e)) await applyNode(f, e);
      for (const e of ents) if (!isNodeEntity(e)) await applyEdge(f, e);
    } finally {
      quiet.mockRestore();
      log.mockRestore();
    }
  }, 120_000);
  afterAll(async () => {
    await f.close();
  });

  it("gap 1: plan-budget budgets row_map_redraw on its own frame, one in eight", async () => {
    const { structured } = await planBudgetTool({
      techniques: ["row_map_redraw", "soft_scroll_v", "sprite_multiplex_game"],
      region: "PAL",
    });
    const play = structured.phases[0];
    expect(play?.contributors.map((c) => c.name)).not.toContain("row_map_redraw");
    expect(play?.occasional).toEqual([
      expect.objectContaining({ name: "row_map_redraw", every_n_frames: 8, high: 13304 }),
    ]);
  });

  it("gap 3: plan-budget counts the multiplexer once, with parking inside it", async () => {
    const { structured, text } = await planBudgetTool({
      techniques: ["sprite_multiplex_game", "sprite_slot_parking"],
      region: "PAL",
    });
    const play = structured.phases[0];
    expect(play?.contributors.map((c) => c.name)).toEqual(["sprite_multiplex_game"]);
    expect(play?.high).toBe(16600);
    expect(text).toContain("sprite_slot_parking: not added, inside sprite_multiplex_game's figure");
  });

  it("gap 4: check-compatibility does not set parking against the multiplexer that holds it", async () => {
    const { structured } = await checkCompatibility(["sprite_multiplex_game", "sprite_slot_parking"]);
    expect(structured.conflicts.filter((c) => c.kind.startsWith("unit_"))).toEqual([]);
    expect(structured.verdict).not.toBe("incompatible");
    // Beside the band split, parking's units are the multiplexer's: one contention, not two.
    const three = await checkCompatibility([
      "invalid_mode_band",
      "sprite_multiplex_game",
      "sprite_slot_parking",
    ]);
    const contention = three.structured.conflicts.filter((c) => c.kind === "unit_contention");
    expect(contention.map((c) => `${c.a}×${c.b}`)).toEqual(["invalid_mode_band×sprite_multiplex_game"]);
  });

  it("gap 5: char_attribute_flags implies no tile renderer", async () => {
    const { structured } = await checkCompatibility(["char_attribute_flags", "sprite_multiplex_game"]);
    const implied = structured.shared_infrastructure
      .filter((s) => s.kind === "missing_prerequisite")
      .map((s) => s.name);
    expect(implied).not.toContain("tile_map_render");
    expect(implied).not.toContain("tile_grid_collision");
    expect(implied).toContain("mob_priority");
  });

  it("gap 30: the attract demo implies no generator, and the port readers are not writers", async () => {
    const { structured } = await checkCompatibility([
      "high_score_table_insert",
      "decimal_print",
      "joystick_edge_detect",
      "joystick_autorepeat",
      "attract_mode_input_replay",
      "frame_sync_loop",
    ]);
    const implied = structured.shared_infrastructure
      .filter((s) => s.kind === "missing_prerequisite")
      .map((s) => s.name);
    expect(implied).not.toContain("lfsr_random");
    const dc00 = structured.conflicts.filter(
      (c) => c.kind === "shared_register" && c.shared.includes("DC00"),
    );
    expect(dc00).toEqual([]);
  });
});
