import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { MACHINE_VARIANTS, RUNS_MODEL_VARIANT, verifiedOnEdges } from "../src/graph/machine-variants.ts";

// Schema 29: VERIFIED_ON edges come from docs/recipes/runs.json, as
// scripts/verify-recipes.ts runs each page.
describe("verifiedOnEdges", () => {
  const manifest = JSON.stringify({
    _comment: "text",
    "oscar64/a": {
      cycles: 16000000,
      models: ["pal", "ntsc"],
      shots: { pal: "screenshots/a.png", ntsc: "screenshots/a-n.png" },
    },
    "kickassembler/b": { models: ["pal", "oldntsc", "secam"], flags: ["-ciamodel", "0"] },
    "oscar64/gone": { models: ["pal"] },
  });
  const have = new Set([
    "oscar64/screenshots/a.png",
    "oscar64/screenshots/a-n.png",
    "kickassembler/screenshots/b.png",
    "oscar64/screenshots/c.png",
  ]);
  const { edges, unknownModels, missingShots } = verifiedOnEdges({
    manifestJson: manifest,
    pages: ["oscar64/a", "kickassembler/b", "oscar64/c", "oscar64/d"],
    shotExists: (tc, shot) => have.has(`${tc}/${shot}`),
  });

  it("maps pal to the VICE default machine and keeps the run's parameters", () => {
    expect(edges.filter((e) => e.source_doc === "recipes/oscar64/a.md")).toEqual([
      {
        source_doc: "recipes/oscar64/a.md",
        variant: "c64c",
        model: "pal",
        cycles: 16000000,
        shot: "screenshots/a.png",
        flags: "",
        pinned: true,
      },
      {
        source_doc: "recipes/oscar64/a.md",
        variant: "ntsc",
        model: "ntsc",
        cycles: 16000000,
        shot: "screenshots/a-n.png",
        flags: "",
        pinned: true,
      },
    ]);
  });

  it("uses verify-recipes' defaults for a page with no entry, and only with a committed shot", () => {
    expect(edges.filter((e) => e.source_doc === "recipes/oscar64/c.md")).toEqual([
      {
        source_doc: "recipes/oscar64/c.md",
        variant: "c64c",
        model: "pal",
        cycles: 8000000,
        shot: "screenshots/c.png",
        flags: "",
        pinned: false,
      },
    ]);
    expect(missingShots).toEqual([
      "kickassembler/b: screenshots/b-oldntsc.png",
      "oscar64/d: screenshots/d.png",
    ]);
  });

  it("joins flags and reports a model word with no variant", () => {
    expect(edges.find((e) => e.source_doc === "recipes/kickassembler/b.md")?.flags).toBe("-ciamodel 0");
    expect(unknownModels).toEqual(["kickassembler/b: secam"]);
  });

  it("every model word verify-recipes knows has a variant, and every variant a seed", () => {
    const script = fs.readFileSync("scripts/verify-recipes.ts", "utf8");
    const block = /const MODEL_FLAG[^{]*\{([^}]*)\}/.exec(script)?.[1] ?? "";
    const words = [...block.matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);
    expect(words.length).toBeGreaterThan(0);
    expect(Object.keys(RUNS_MODEL_VARIANT).sort()).toEqual([...words].sort());
    const seeded = new Set(MACHINE_VARIANTS.map((v) => v.name));
    for (const v of Object.values(RUNS_MODEL_VARIANT)) expect(seeded.has(v), v).toBe(true);
    expect(MACHINE_VARIANTS.filter((v) => v.vice_default).map((v) => v.name)).toEqual(["c64c"]);
  });

  it("the shipped runs.json names only known models and committed shots", () => {
    const root = path.join("docs", "recipes");
    const pages = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) =>
        fs
          .readdirSync(path.join(root, d.name))
          .filter((f) => f.endsWith(".md"))
          .map((f) => `${d.name}/${f.slice(0, -3)}`),
      );
    const r = verifiedOnEdges({
      manifestJson: fs.readFileSync(path.join(root, "runs.json"), "utf8"),
      pages,
      shotExists: (tc, shot) => fs.existsSync(path.join(root, tc, shot)),
    });
    expect(r.unknownModels).toEqual([]);
    expect(r.missingShots).toEqual([]);
    expect(r.edges.length).toBeGreaterThan(pages.length);
  });
});
