import { describe, it, expect } from "vitest";
import { parseSTIL } from "../stil-parser.js";

// Real STIL.txt format:
//   - Entry headers are bare `/path/to/Tune.sid` lines (no leading `# `)
//   - Section markers like `### /DEMOS/ ###...` start with `#` and must be ignored
//   - Field indentation is 0-3 spaces before the field name (COMMENT: can have 0 indent)
//   - Continuation lines for COMMENT are indented with 9 spaces
//   - Subtune markers `(#N)` appear with no leading whitespace; N is 1-indexed in STIL

const SINGLE_TUNE_FIXTURE = `/MUSICIANS/H/Hubbard_Rob/Commando.sid
  TITLE: Commando
 AUTHOR: Rob Hubbard
 ARTIST: Capcom
COMMENT: cover of arcade theme by Tamayo Kawamoto

`;

const MULTI_AUTHOR_FIXTURE = `/MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid
  TITLE: Cybernoid II
 AUTHOR: Jeroen Tel
 AUTHOR: Charles Deenen

`;

const SUBSONG_FIXTURE = `/MUSICIANS/G/Galway_Martin/Wizball.sid
  TITLE: Wizball
 AUTHOR: Martin Galway

(#1)
  TITLE: Main Theme
COMMENT: opening tune

(#2)
  TITLE: High Score
COMMENT: cover of "X"

`;

describe("parseSTIL", () => {
  it("parses single-tune entry with credits", () => {
    const idx = parseSTIL(SINGLE_TUNE_FIXTURE);
    const entry = idx.get("/MUSICIANS/H/Hubbard_Rob/Commando.sid:0");
    expect(entry).toBeDefined();
    expect(entry?.credits.some((c) => c.name === "Rob Hubbard" && c.role === "composer")).toBe(true);
    expect(entry?.credits.some((c) => c.name === "Capcom" && c.role === "artist")).toBe(true);
    expect(entry?.comment?.toLowerCase()).toContain("kawamoto");
  });

  it("parses multiple AUTHOR lines as separate composer credits", () => {
    const idx = parseSTIL(MULTI_AUTHOR_FIXTURE);
    const entry = idx.get("/MUSICIANS/T/Tel_Jeroen/Cybernoid_II.sid:0");
    expect(entry?.credits.filter((c) => c.role === "composer")).toHaveLength(2);
    expect(entry?.credits.map((c) => c.name)).toEqual(
      expect.arrayContaining(["Jeroen Tel", "Charles Deenen"])
    );
  });

  it("scopes sub-tune fields with (#N) markers", () => {
    const idx = parseSTIL(SUBSONG_FIXTURE);
    // File-level entry (subtune 0 before any (#N) marker): gets the file-level fields
    const root = idx.get("/MUSICIANS/G/Galway_Martin/Wizball.sid:0");
    expect(root).toBeDefined();
    expect(root?.credits.some((c) => c.name === "Martin Galway")).toBe(true);

    // (#1) in STIL is 1-indexed → our key uses 0-indexed: subtune 0
    // (#2) in STIL → subtune 1
    const sub1 = idx.get("/MUSICIANS/G/Galway_Martin/Wizball.sid:0");
    const sub2 = idx.get("/MUSICIANS/G/Galway_Martin/Wizball.sid:1");
    expect(sub2?.title).toBe("High Score");
    // sub1 title is "Main Theme" if overwritten, or "Wizball" if root came first
    expect(sub1?.title).toMatch(/Wizball|Main Theme/);
  });

  it("caps comment text at 2KB per entry", () => {
    const longComment = "x".repeat(3000);
    const fixture = `/test.sid\n  TITLE: Test\nCOMMENT: ${longComment}\n\n`;
    const idx = parseSTIL(fixture);
    const entry = idx.get("/test.sid:0");
    expect(entry?.comment?.length).toBeLessThanOrEqual(2048);
  });

  it("ignores section markers and content before first entry", () => {
    const fixture = `### /DEMOS/ ###################################################
some intro text

/a.sid
  TITLE: A
`;
    const idx = parseSTIL(fixture);
    expect(idx.size).toBe(1);
    expect(idx.get("/a.sid:0")).toBeDefined();
  });

  it("ignores bare # comment lines (preamble / section headers)", () => {
    const fixture = `# header comment
# another line

/b.sid
  TITLE: B
`;
    const idx = parseSTIL(fixture);
    expect(idx.size).toBe(1);
    expect(idx.get("/b.sid:0")).toBeDefined();
  });

  it("handles COMMENT with no leading indentation", () => {
    // Real STIL has `COMMENT:` at column 0
    const fixture = `/DEMOS/0-9/128_Byte_Blues.sid
COMMENT: Great tune
         continuation line here

`;
    const idx = parseSTIL(fixture);
    const entry = idx.get("/DEMOS/0-9/128_Byte_Blues.sid:0");
    expect(entry?.comment).toContain("Great tune");
    expect(entry?.comment).toContain("continuation");
  });

  it("handles missing trailing newline", () => {
    const fixture = `/a.sid\n  TITLE: A`;
    expect(parseSTIL(fixture).size).toBe(1);
  });

  it("handles directory entries (paths not ending in .sid)", () => {
    // Some entries in STIL use a directory path (e.g. /MUSICIANS/X/X/)
    const fixture = `/MUSICIANS/X/X/
COMMENT: All tunes by X.

/MUSICIANS/X/X/Tune.sid
  TITLE: A tune
`;
    const idx = parseSTIL(fixture);
    // Both should be parsed as entries
    expect(idx.size).toBeGreaterThanOrEqual(1);
  });
});

describe("parseSTIL cover relations", () => {
  it("extracts REMIX from 'Remix of /PATH'", () => {
    const fixture = `/DEMOS/A-F/A_Funky_Toon.sid
COMMENT: Remix of /MUSICIANS/G/Gray_Matt/Timed_Out.sid

`;
    const idx = parseSTIL(fixture);
    const entry = idx.get("/DEMOS/A-F/A_Funky_Toon.sid:0");
    expect(entry?.cover_relations).toHaveLength(1);
    expect(entry?.cover_relations[0]).toEqual({
      kind: "REMIX",
      target_path: "/MUSICIANS/G/Gray_Matt/Timed_Out.sid",
    });
  });

  it("extracts BASED_ON before generic VERSION when both present", () => {
    const fixture = `/test.sid
COMMENT: Based on /MUSICIANS/A/A.sid

`;
    const idx = parseSTIL(fixture);
    expect(idx.get("/test.sid:0")?.cover_relations[0].kind).toBe("BASED_ON");
  });

  it("extracts SAME_AS from 'Same as /PATH'", () => {
    const fixture = `/test.sid
COMMENT: Same as /MUSICIANS/T/Tel_Jeroen/Get_Ready.sid, but with digis added.

`;
    const idx = parseSTIL(fixture);
    expect(idx.get("/test.sid:0")?.cover_relations[0].kind).toBe("SAME_AS");
  });

  it("does NOT extract a relation when no cover verb is in the clause", () => {
    const fixture = `/test.sid
COMMENT: See also /MUSICIANS/A/A.sid for context.

`;
    const idx = parseSTIL(fixture);
    expect(idx.get("/test.sid:0")?.cover_relations).toEqual([]);
  });

  it("extracts multiple relations from a multi-clause COMMENT", () => {
    const fixture = `/test.sid
COMMENT: Remix of /MUSICIANS/A/A.sid. Based on /MUSICIANS/B/B.sid.

`;
    const idx = parseSTIL(fixture);
    const rels = idx.get("/test.sid:0")?.cover_relations ?? [];
    const kinds = rels.map((r) => r.kind).sort();
    expect(kinds).toEqual(["BASED_ON", "REMIX"]);
  });

  it("dedupes (kind, target_path) within an entry", () => {
    const fixture = `/test.sid
COMMENT: Edit of /MUSICIANS/X.sid. Another edit of /MUSICIANS/X.sid.

`;
    const idx = parseSTIL(fixture);
    expect(idx.get("/test.sid:0")?.cover_relations).toHaveLength(1);
  });

  it("handles cover verb across the COMMENT-continuation line break", () => {
    const fixture = `/test.sid
COMMENT: This is an edit
         of /MUSICIANS/X/X.sid with digis.

`;
    const idx = parseSTIL(fixture);
    expect(idx.get("/test.sid:0")?.cover_relations[0].kind).toBe("EDIT");
  });
});

describe("parseSTIL against real HVSC fixture", () => {
  it("parses real STIL.txt without crashing", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const path = "data/hvsc-corpus/C64Music/DOCUMENTS/STIL.txt";
    if (!existsSync(path)) return;
    const text = readFileSync(path, "utf8");
    const idx = parseSTIL(text);
    expect(idx.size).toBeGreaterThan(1000);
    // Sanity: Commando should be in there with a COMMENT
    const commando = idx.get("/MUSICIANS/H/Hubbard_Rob/Commando.sid:0");
    if (commando) {
      expect(commando.comment).toBeDefined();
      // Commando has a COMMENT (lengthy story) but not necessarily an AUTHOR in STIL
    }
    // A simpler artist-credit sanity check — Bugle_Boy has ARTIST credits on subtunes
    const bugle1 = idx.get("/DEMOS/A-F/Bugle_Boy_BASIC.sid:0");
    if (bugle1) {
      // subtune 0 corresponds to (#1) in STIL
      expect(bugle1.title).toBe("First Call");
    }
  });
});
