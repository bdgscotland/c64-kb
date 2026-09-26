import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FalkorService } from "../src/services/falkor.ts";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { applyEntity, isNodeEntity } from "../src/graph/apply.ts";
import { techniqueLookup } from "../src/tools/query.ts";

// #113: fighter_opponent_tables and fighter_guard_state existed only as
// pattern sections on game-design/enemy-behaviour-and-difficulty.md, which
// no lookup reads, so technique-lookup said "not found" and an agent
// concluded the KB had no duel opponent. They are technique entries now,
// and the recipe that realises them lists both in its frontmatter.
const PAGES = ["techniques/logic.md", "techniques/sprite.md", "recipes/oscar64/fighter-opponent.md"];

describe("fighter techniques resolve through technique-lookup (#113)", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    const entities = PAGES.flatMap((p) =>
      extractGraphEntities(fs.readFileSync(path.resolve(__dirname, "../docs", p), "utf8"), p),
    );
    for (const e of entities.filter(isNodeEntity)) await applyEntity(f, e);
    for (const e of entities.filter((x) => !isNodeEntity(x))) await applyEntity(f, e);
  }, 60_000);
  afterAll(async () => f.close());

  it("the recipe's frontmatter names both techniques", () => {
    const p = PAGES[2] ?? "";
    const recipe = extractGraphEntities(
      fs.readFileSync(path.resolve(__dirname, "../docs", p), "utf8"),
      p,
    ).find((e) => e.type === "recipe");
    expect(recipe).toBeDefined();
    expect(JSON.stringify(recipe)).toContain("fighter_opponent_tables");
    expect(JSON.stringify(recipe)).toContain("fighter_guard_state");
  });

  for (const [name, worst] of [
    ["fighter_opponent_tables", 295],
    ["fighter_guard_state", 364],
  ] as const) {
    it(`${name} is found, with the fighter-opponent recipe and its measured cost`, async () => {
      const r = await techniqueLookup(name);
      expect(r.structured.name).toBe(name);
      expect(r.structured.recipes.map((x) => x.name)).toContain("oscar64-fighter-opponent");
      expect(r.structured.cost?.cycles_per_frame).toBe(worst);
      expect(r.structured.cost?.basis).toBe("measured-vice");
      expect(r.structured.cost?.measured_on).toBe("oscar64-fighter-opponent");
    });
  }
});
