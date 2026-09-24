import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { readFileSync } from "node:fs";
import { getQdrant } from "../src/context.ts";
import { ingestDoc } from "../src/tools/hydrate.ts";
import { lookupRegister } from "../src/tools/query.ts";

// These tests seed just the two registers they need so they are isolated
// from corpus state. Other test files call clean() which would wipe live data.

let f: FalkorService;

beforeAll(async () => {
  f = new FalkorService();
  await f.connect();
  await f.clean();
  await f.ensureSchema();
  // Seed minimal register data for the decimal-address tests.
  await f.addRegister("SCROLY", "$D011", "VIC-II", "RW", ["D011"]);
  await f.linkBelongsTo("Register", "SCROLY", "VIC-II");
  await f.addRegister("FRELO1", "$D400", "SID", "RW", ["D400"]);
  await f.linkBelongsTo("Register", "FRELO1", "SID");
});

afterAll(async () => {
  await f.close();
});

describe("lookupRegister decimal addresses", () => {
  it("resolves $D011 from decimal 53265", async () => {
    const r = await lookupRegister("53265");
    expect(r.structured.found).toBe(true);
    expect(r.structured.address).toBe("$D011");
  });

  it("resolves $D400 from decimal 54272", async () => {
    const r = await lookupRegister("54272");
    expect(r.structured.found).toBe(true);
    expect(r.structured.address).toBe("$D400");
  });

  it("returns guard message for single-character lookups", async () => {
    const r = await lookupRegister("A");
    expect(r.structured.found).toBe(false);
    expect(r.text).toMatch(/at least 2 characters/);
  });
});

// #41: `lookup-register DC01` printed three unrelated sections and not the
// register's own entry, and `DC00` led with raster-bars.md. The own section
// (the hardware page's `### $DC01 — DC01 — ...`) now comes first.
// The hybrid search alone did not rank the own section first over these.
const SEEDED = [
  "hardware/cia-reference.md",
  "hardware/c64-memory-map.md",
  "hardware/c64-registers-reference.md",
  "techniques/input.md",
  "pitfalls/input.md",
  "recipes/oscar64/two-player.md",
  "recipes/kickassembler/raster-bars.md",
];

describe("lookupRegister documentation leads with the register's own section", () => {
  beforeAll(async () => {
    const q = await getQdrant();
    await q.ensureCollection();
    for (const rel of SEEDED) {
      const seeded = await ingestDoc(rel, readFileSync(new URL(`../docs/${rel}`, import.meta.url), "utf8"));
      if (/not available/i.test(seeded)) throw new Error(`test collection could not be seeded: ${seeded}`);
    }
    await f.addRegister("DC00", "$DC00", "CIA1", "RW", []);
    await f.addRegister("DC01", "$DC01", "CIA1", "RW", []);
    // Seeding embeds seven large pages through Ollama: over a minute on CI's CPU
    // runner, so the default 60 s hook limit failed every CI run from 7e5a515.
  }, 600_000);

  // The test collection is shared by every file; leave it as it was found
  // (the briefing tests read it and would propose raster_bars from these).
  afterAll(async () => {
    const q = await getQdrant();
    for (const rel of SEEDED) await q.deleteBySource(rel);
  }, 120_000);

  it.each([
    ["DC01", "$DC01 — DC01 — Data Port B (RW)"],
    ["DC00", "$DC00 — DC00 — Data Port A (RW)"],
  ])("%s", async (reg, heading) => {
    const r = await lookupRegister(reg);
    const first = r.structured.documentation.at(0);
    expect(first?.source).toBe("hardware/cia-reference.md");
    expect(first?.section.split(" > ").at(-1)).toBe(heading);
  });
});
