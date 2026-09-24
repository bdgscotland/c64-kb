import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { FalkorService } from "../src/services/falkor.ts";
import { getQdrant } from "../src/context.ts";
import { ingestDoc } from "../src/tools/hydrate.ts";

// Issue #51: `ingest-doc docs/<page>` from the repo root wrote a copy to
// docs/docs/<page> and stored it as a second source. Both spellings of one
// page must land as one source in both stores, and the page is not rewritten.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = "recipes/oscar64/hello-world.md";
const file = path.join(repo, "docs", page);
const stray = path.join(repo, "docs", "docs");

describe("ingestDoc path spellings", () => {
  let f: FalkorService;
  let mtime: number;

  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
    const q = await getQdrant();
    await q.ensureCollection();
    await q.deleteBySource(page);
    await q.deleteBySource(`docs/${page}`);
    mtime = fs.statSync(file).mtimeMs;
    const content = fs.readFileSync(file, "utf-8");
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      for (const spelling of [page, `docs/${page}`]) {
        const r = await ingestDoc(spelling, content);
        if (/not available/i.test(r)) throw new Error(`could not ingest: ${r}`);
        expect(r).toContain(`from ${page}.`);
      }
    } finally {
      process.chdir(cwd);
    }
  });

  afterAll(async () => {
    await f.close();
  });

  it("stores the page's chunks under one source", async () => {
    const q = await getQdrant();
    expect((await q.scrollBySource(page, 200)).length).toBeGreaterThan(0);
    expect(await q.scrollBySource(`docs/${page}`, 200)).toEqual([]);
  });

  it("gives the graph one recipe node source for the page", async () => {
    const r = await f.roQuery(
      "MATCH (n:Recipe) WHERE n.source_doc ENDS WITH $page RETURN DISTINCT n.source_doc AS s",
      { page },
    );
    expect(r.data).toEqual([{ s: page }]);
  });

  it("writes no copy under docs/docs/ and leaves the page untouched", () => {
    expect(fs.existsSync(stray)).toBe(false);
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it("refuses a path outside docs/", async () => {
    expect(await ingestDoc("../README.md", "# x")).toMatch(/^Rejected/);
  });
});
