import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// A private analytics file: the replay walks every open gap in it, and the
// shared test file collects gaps from every other test.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c64-gap-replay-"));
process.env.ANALYTICS_DB = path.join(dir, "analytics.db");

const { FalkorService } = await import("../src/services/falkor.ts");
const { getAnalytics, closeAll } = await import("../src/context.ts");
const { replayGaps, formatGapReplay } = await import("../src/tools/gap-replay.ts");
const { checkCompatibility } = await import("../src/tools/query.ts");

describe("gap replay (#19)", () => {
  const f = new FalkorService();
  beforeAll(async () => {
    await f.connect();
    await f.clean();
    await f.ensureSchema();
  });
  afterAll(async () => {
    await f.close();
    await closeAll();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a gap that now answers, keeps one that does not, and logs nothing while replaying", async () => {
    const an = getAnalytics();
    an.logQuery({ tool: "c64_technique_lookup", query: "replay_tech", resultCount: 0 });
    an.logQuery({ tool: "c64_technique_lookup", query: "still_missing", resultCount: 0 });
    an.logQuery({ tool: "c64_recipe_lookup", query: "replay_tech", resultCount: 0 });
    an.logQuery({ tool: "c64_coverage", query: "snapshot", resultCount: 0 });
    an.reportGap("replay_tech", "c64_technique_lookup_reported", "an agent's note");
    const before = an.getQueryStats().total_queries;

    await f.addTechnique({ name: "replay_tech", title: "Replay", category: "raster", complexity: "low" });
    const r = await replayGaps();

    expect(r.resolved).toEqual(["c64_technique_lookup: replay_tech"]);
    expect(r.still_open).toBe(2); // still_missing, and the recipe lookup of the same name
    expect(r.skipped).toEqual({ c64_coverage: 1 });
    expect(r.failed).toEqual([]);
    // A reported gap is not replayed; the recipe gap of the same query stays open.
    expect(an.getLoggedOpenGaps().map((g) => `${g.tool}: ${g.query}`)).toEqual([
      "c64_coverage: snapshot",
      "c64_recipe_lookup: replay_tech",
      "c64_technique_lookup: still_missing",
    ]);
    expect(an.getQueryStats().total_queries).toBe(before);
    expect(formatGapReplay(r)).toBe(
      "gap replay: 3 replayed, 1 resolved, 2 still open, 0 failed; not replayable: c64_coverage 1\n",
    );
  });

  it("logs a clean compatibility check as answered, not as a gap", async () => {
    await f.addTechnique({ name: "other_tech", title: "Other", category: "effect", complexity: "low" });
    await f.addRegister("D020", "$D020", "VIC-II", "RW", []);
    await f.linkTechniqueUsesRegister("replay_tech", "D020");
    const an = getAnalytics();
    const counts = await an.captureCounts(() => checkCompatibility(["replay_tech", "other_tech"]));
    // replay_tech has a register, other_tech has no data: one input answered.
    expect(counts).toEqual([1]);
    expect(await an.captureCounts(() => checkCompatibility(["replay_tech", "nope"]))).toEqual([0]);
  });
});
