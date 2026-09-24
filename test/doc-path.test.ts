import { describe, it, expect } from "vitest";
import path from "path";
import { fileURLToPath } from "url";
import { locateDoc } from "../src/ingest/doc-path.ts";

// Issue #51: ingest-doc joined every path to docs/, so the repo-relative
// spelling `docs/x.md` became docs/docs/x.md, a second copy and a second
// source. Every spelling of one page must name one file and one source.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = path.join(repo, "docs");
const page = "recipes/oscar64/hello-world.md";
const expected = { file: path.join(docs, page), source: page };

describe("locateDoc", () => {
  it("resolves the repo-relative spelling from the repo root to the page itself", () => {
    expect(locateDoc(`docs/${page}`, docs, repo)).toEqual(expected);
  });

  it("resolves the docs-relative spelling from the repo root", () => {
    expect(locateDoc(page, docs, repo)).toEqual(expected);
  });

  it("resolves the docs-relative spelling from inside docs/", () => {
    expect(locateDoc(page, docs, docs)).toEqual(expected);
  });

  it("resolves the absolute path", () => {
    expect(locateDoc(path.join(docs, page), docs, "/")).toEqual(expected);
  });

  it("resolves the repo-relative spelling from an unrelated directory", () => {
    expect(locateDoc(`docs/${page}`, docs, "/")).toEqual(expected);
  });

  it("never names a file under docs/docs/", () => {
    for (const spelling of [`docs/${page}`, `./docs/${page}`]) {
      expect(locateDoc(spelling, docs, repo)?.file).not.toContain(
        `${path.sep}docs${path.sep}docs${path.sep}`,
      );
    }
  });

  it("places a new page below docs/ under its docs-relative name", () => {
    expect(locateDoc("hardware/new-page.md", docs, repo)).toEqual({
      file: path.join(docs, "hardware/new-page.md"),
      source: "hardware/new-page.md",
    });
  });

  it("places a new page spelled from the repo root, typed inside docs/, below docs/ once", () => {
    expect(locateDoc("docs/hardware/new-page.md", docs, docs)).toEqual({
      file: path.join(docs, "hardware/new-page.md"),
      source: "hardware/new-page.md",
    });
  });

  it("refuses a path outside docs/", () => {
    expect(locateDoc("../../etc/passwd", docs, repo)).toBeNull();
    expect(locateDoc("/etc/passwd", docs, repo)).toBeNull();
    // The repo's own README exists where the caller stands: it is refused, not re-read as docs/README.md.
    expect(locateDoc("README.md", docs, repo)).toBeNull();
    expect(locateDoc("", docs, repo)).toBeNull();
    expect(locateDoc("docs", docs, repo)).toBeNull();
  });
});
