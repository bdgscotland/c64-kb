import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { referenceTitles } from "../src/graph/extract/production.ts";
import { FalkorService } from "../src/services/falkor.ts";

// Production nodes and EXEMPLIFIED_BY edges (#22 step 8, ON-06), from the
// **Reference titles:** lines that #40 sourced title by title.

describe("referenceTitles", () => {
  it("reads linked titles with year and note, URLs with parentheses included", () => {
    expect(
      referenceTitles(
        "[Boulder Dash](https://en.wikipedia.org/wiki/Boulder_Dash_(video_game)) (1984), [The Last Ninja](https://www.c64-wiki.com/wiki/The_Last_Ninja) (1987, isometric), [Soko-Ban](https://en.wikipedia.org/wiki/Sokoban) (Spectrum HoloByte; year not checked). Wikipedia files all.",
      ),
    ).toEqual([
      { title: "Boulder Dash", url: "https://en.wikipedia.org/wiki/Boulder_Dash_(video_game)", year: 1984 },
      {
        title: "The Last Ninja",
        url: "https://www.c64-wiki.com/wiki/The_Last_Ninja",
        year: 1987,
        note: "isometric",
      },
      {
        title: "Soko-Ban",
        url: "https://en.wikipedia.org/wiki/Sokoban",
        note: "Spectrum HoloByte; year not checked",
      },
    ]);
  });

  it("stops at the end of the list, so a title in the correction prose is not read", () => {
    const t = referenceTitles(
      "[Gauntlet](https://www.c64-wiki.com/wiki/Gauntlet) (1986, top-down). (An earlier version listed [Green Beret](https://www.c64-wiki.com/wiki/Green_Beret), issue #40.)",
    );
    expect(t.map((x) => x.title)).toEqual(["Gauntlet"]);
  });

  it("reads no unlinked title: a title with no source is not a production", () => {
    expect(referenceTitles("Oxyd (1990), Zork I (C64 port, 1982)")).toEqual([]);
  });
});

describe("the archetype page's reference titles", () => {
  const page = "game-design/c64-game-archetypes.md";
  const ents = extractGraphEntities(
    readFileSync(join(import.meta.dirname, "..", "docs", page), "utf8"),
    page,
  );

  it("gives one Production per linked title, each with its source on the edge", () => {
    const productions = ents.filter((e) => e.type === "production");
    const edges = ents.filter((e) => e.type === "exemplified_by");
    expect(productions.length).toBe(edges.length);
    expect(productions.length).toBeGreaterThan(0);
    for (const e of edges) expect(e.source).toMatch(/^https:\/\/(www\.c64-wiki\.com|en\.wikipedia\.org)\//);
    const names = productions.map((p) => p.name);
    expect(names).toContain("Commando");
    expect(names).not.toContain("Green Beret");
    expect(names).not.toContain("Oxyd");
  });
});

describe("FalkorService — Production, EXEMPLIFIED_BY", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    await f.addArchetype({
      name: "vertical_shmup",
      title: "Vertical Shmup",
      kind: "game",
      source_doc: "game-design/c64-game-archetypes.md",
    });
  });
  afterAll(async () => {
    await f.close();
  });

  it("lands the edge with its source, and drops one to a missing archetype", async () => {
    await f.addProduction({
      name: "Commando",
      kind: "game",
      year: 1985,
      url: "https://www.c64-wiki.com/wiki/Commando",
    });
    const landed = await f.linkExemplifiedBy({
      archetype: "vertical_shmup",
      production: "Commando",
      source: "https://www.c64-wiki.com/wiki/Commando",
      source_doc: "game-design/c64-game-archetypes.md",
    });
    expect(landed).toBe(true);
    const r = await f.roQuery(
      `MATCH (:Archetype {name: 'vertical_shmup'})-[x:EXEMPLIFIED_BY]->(p:Production)
       RETURN p.name AS name, p.year AS year, x.source AS source`,
    );
    expect(r.data).toEqual([
      { name: "Commando", year: 1985, source: "https://www.c64-wiki.com/wiki/Commando" },
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dropped = await f.linkExemplifiedBy({
      archetype: "no_such_archetype",
      production: "Commando",
      source: "x",
      source_doc: "y",
    });
    expect(dropped).toBe(false);
    warn.mockRestore();
  });
});
