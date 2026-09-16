import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseUpdateManifest, type ParsedUpdateManifest } from "../update-manifest.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kinds(m: ParsedUpdateManifest) {
  return new Set(m.actions.map((a) => a.kind));
}

function ofKind(m: ParsedUpdateManifest, kind: "new" | "changed" | "moved" | "removed") {
  return m.actions.filter((a) => a.kind === kind);
}

// ---------------------------------------------------------------------------
// Synthetic fixtures — built from real Update84.hvs format chunks
// ---------------------------------------------------------------------------

const REPLACE_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: January 1, 2030
#
# ****************************************************
# **                   FIXES                        **
# ****************************************************

REPLACE

# from Composer: fixed loop
/update/fix/MUSICIANS/H/Hubbard_Rob/Flash_Gordon.sid
/MUSICIANS/H/Hubbard_Rob/

/update/fix/MUSICIANS/B/Bjerregaard_Johannes/Fat_6.sid
/MUSICIANS/B/Bjerregaard_Johannes/
`;

const MOVE_NEW_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: January 1, 2030
#
# ****************************************************
# **                  NEW TUNES                     **
# ****************************************************

MOVE

# from iAN CooG: Cool_Tune.sid
/update/new/DEMOS/0-9/
/DEMOS/0-9/

# from Composer: Some_Song.sid
/update/new/MUSICIANS/H/Hairdog/
/MUSICIANS/H/Hairdog/
`;

const MOVE_RELOC_2LINE_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: January 1, 2030
#
MOVE

# rename SIDs which stay in their dir
/MUSICIANS/B/Bordeaux/Hangmania.sid
/MUSICIANS/B/Bordeaux/Hangmani.sid

/MUSICIANS/S/Signor/Signor_01.sid
/MUSICIANS/S/Signor/First_Collection_intro.sid
`;

// 4-line STIL-mirror pattern observed in Update84.hvs around lines 2379-2382
const MOVE_RELOC_4LINE_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: January 1, 2030
#
MOVE

/MUSICIANS/0-9/20CC/van_Santen_Edwin/A_Trip_Into_E-V-Space.sid
/MUSICIANS/0-9/20CC/van_Santen_Edwin/A_Trip_into_E-V-Space_.sid
/MUSICIANS/0-9/20CC/van_Santen_Edwin/A_Trip_into_E-V-Space_.sid
/MUSICIANS/0-9/20CC/van_Santen_Edwin/A_Trip_Into_E-V-Space.sid
`;

const DELETE_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: January 1, 2030
#
# ****************************************************
# **              REPEATS / BAD RIPS                **
# ****************************************************

DELETE

# replaced with proper rip
/DEMOS/A-F/C_C_S_Digihits.sid

/MUSICIANS/D/Danko_Tomas/Tomas_Danko_01.sid
`;

const DELETE_WITH_STAGING_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: January 1, 2030

DELETE

/DEMOS/A-F/C_C_S_Digihits.sid

# housekeeping: remove staging dirs (should be filtered out)
/update/fix/MUSICIANS/H/Hubbard_Rob/
/update/fix/MUSICIANS/H/
/update/fix/MUSICIANS/
/update/fix/
/update/new/DEMOS/0-9/
/update/new/DEMOS/
/update/new/
`;

const CREDITS_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: January 1, 2030

#######
CREDITS
#######

# https://csdb.dk/release/?id=250047
/DEMOS/UNKNOWN/Digi_Music_Sample.sid
Digi Sample Music
Markus Mueller (Superbrain)
1988 Gamma Cracking Force

/DEMOS/UNKNOWN/Imos_Song.sid
Imo's Song
Imo
1987 Lechzing Fuckers
`;

const MIXED_FIXTURE = `\
# High Voltage SID Collection: Update #99
# Date: March 15, 2029

REPLACE

/update/fix/MUSICIANS/H/Hubbard_Rob/Flash_Gordon.sid
/MUSICIANS/H/Hubbard_Rob/

MOVE

/update/new/DEMOS/0-9/
/DEMOS/0-9/

DELETE

/DEMOS/A-F/Old_Tune.sid

CREDITS

/DEMOS/UNKNOWN/Some_Tune.sid
Title Here
Author Here
1990 Some Group
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("parseUpdateManifest", () => {
  it("returns empty actions for empty input", () => {
    const m = parseUpdateManifest("", 84);
    expect(m.release_number).toBe(84);
    expect(m.actions).toEqual([]);
  });

  it("returns empty actions for comment-only input", () => {
    const m = parseUpdateManifest("# Just a comment\n# Another line\n", 84);
    expect(m.release_number).toBe(84);
    expect(m.actions).toEqual([]);
    expect(m.release_date).toBeUndefined();
  });

  it("extracts release_date from the Date header", () => {
    const m = parseUpdateManifest("# Date: December 25, 2025\n", 84);
    expect(m.release_date).toBe("December 25, 2025");
  });

  // --- REPLACE (changed) ---

  it("parses REPLACE section as 'changed' actions", () => {
    const m = parseUpdateManifest(REPLACE_FIXTURE, 99);
    const changed = ofKind(m, "changed");
    expect(changed.length).toBe(2);
    expect(changed[0].hvsc_path).toBe("/MUSICIANS/H/Hubbard_Rob/Flash_Gordon.sid");
    expect(changed[1].hvsc_path).toBe("/MUSICIANS/B/Bjerregaard_Johannes/Fat_6.sid");
    expect(changed.every((a) => a.kind === "changed")).toBe(true);
  });

  it("derives filename from staging source path in REPLACE", () => {
    const m = parseUpdateManifest(REPLACE_FIXTURE, 99);
    // Sanity: dest path includes the filename, not just the dir
    const paths = ofKind(m, "changed").map((a) => a.hvsc_path);
    expect(paths).toContain("/MUSICIANS/H/Hubbard_Rob/Flash_Gordon.sid");
  });

  // --- MOVE (new tunes) ---

  it("parses MOVE with /update/new/ source as 'new' actions", () => {
    const m = parseUpdateManifest(MOVE_NEW_FIXTURE, 99);
    const newTunes = ofKind(m, "new");
    expect(newTunes.length).toBe(2);
    expect(newTunes[0].hvsc_path).toBe("/DEMOS/0-9/");
    expect(newTunes[1].hvsc_path).toBe("/MUSICIANS/H/Hairdog/");
  });

  it("does not emit staging paths as 'new' destinations", () => {
    const m = parseUpdateManifest(MOVE_NEW_FIXTURE, 99);
    const newPaths = ofKind(m, "new").map((a) => a.hvsc_path);
    expect(newPaths.every((p) => !p.startsWith("/update/"))).toBe(true);
  });

  // --- MOVE (relocation, 2-line) ---

  it("parses 2-line MOVE relocation as 'moved' with moved_from", () => {
    const m = parseUpdateManifest(MOVE_RELOC_2LINE_FIXTURE, 99);
    const moved = ofKind(m, "moved");
    expect(moved.length).toBe(2);
    expect(moved[0].moved_from).toBe("/MUSICIANS/B/Bordeaux/Hangmania.sid");
    expect(moved[0].hvsc_path).toBe("/MUSICIANS/B/Bordeaux/Hangmani.sid");
    expect(moved[1].moved_from).toBe("/MUSICIANS/S/Signor/Signor_01.sid");
    expect(moved[1].hvsc_path).toBe("/MUSICIANS/S/Signor/First_Collection_intro.sid");
  });

  // --- MOVE (relocation, 4-line STIL mirror) ---

  it("parses 4-line STIL-mirror MOVE as a single 'moved' action", () => {
    const m = parseUpdateManifest(MOVE_RELOC_4LINE_FIXTURE, 99);
    const moved = ofKind(m, "moved");
    expect(moved.length).toBe(1);
    expect(moved[0].moved_from).toBe(
      "/MUSICIANS/0-9/20CC/van_Santen_Edwin/A_Trip_Into_E-V-Space.sid"
    );
    expect(moved[0].hvsc_path).toBe(
      "/MUSICIANS/0-9/20CC/van_Santen_Edwin/A_Trip_into_E-V-Space_.sid"
    );
  });

  // --- DELETE (removed) ---

  it("parses DELETE section as 'removed' actions", () => {
    const m = parseUpdateManifest(DELETE_FIXTURE, 99);
    const removed = ofKind(m, "removed");
    expect(removed.length).toBe(2);
    expect(removed[0].hvsc_path).toBe("/DEMOS/A-F/C_C_S_Digihits.sid");
    expect(removed[1].hvsc_path).toBe("/MUSICIANS/D/Danko_Tomas/Tomas_Danko_01.sid");
  });

  it("filters out staging /update/ paths from DELETE section", () => {
    const m = parseUpdateManifest(DELETE_WITH_STAGING_FIXTURE, 99);
    const removed = ofKind(m, "removed");
    // Only the one real corpus path should survive
    expect(removed.length).toBe(1);
    expect(removed[0].hvsc_path).toBe("/DEMOS/A-F/C_C_S_Digihits.sid");
    const removedPaths = removed.map((a) => a.hvsc_path);
    expect(removedPaths.every((p) => !p.startsWith("/update/"))).toBe(true);
  });

  // --- CREDITS (ignored) ---

  it("ignores CREDITS section paths (no structural change actions)", () => {
    const m = parseUpdateManifest(CREDITS_FIXTURE, 99);
    expect(m.actions.length).toBe(0);
  });

  // --- Mixed sections ---

  it("correctly categorises actions across multiple section switches", () => {
    const m = parseUpdateManifest(MIXED_FIXTURE, 99);
    expect(ofKind(m, "changed").length).toBeGreaterThanOrEqual(1);
    expect(ofKind(m, "new").length).toBeGreaterThanOrEqual(1);
    expect(ofKind(m, "removed").length).toBeGreaterThanOrEqual(1);
    // Credits should not bleed into actions
    const creditPath = "/DEMOS/UNKNOWN/Some_Tune.sid";
    expect(m.actions.map((a) => a.hvsc_path)).not.toContain(creditPath);
  });

  it("sets release_number correctly", () => {
    const m = parseUpdateManifest(MIXED_FIXTURE, 99);
    expect(m.release_number).toBe(99);
  });

  it("handles CRLF line endings gracefully", () => {
    const crlf = REPLACE_FIXTURE.replace(/\n/g, "\r\n");
    const m = parseUpdateManifest(crlf, 99);
    // Should parse identically to the LF version
    expect(ofKind(m, "changed").length).toBe(2);
  });

  it("tolerates malformed / short path runs without throwing", () => {
    const malformed = `\
# Test
REPLACE
/update/fix/MUSICIANS/H/Hubbard_Rob/Flash_Gordon.sid
# comment breaks the pair — no dest follows

MOVE
/MUSICIANS/A/Alpha/Old.sid
# no second line

DELETE
/DEMOS/A-F/Solo.sid
`;
    expect(() => parseUpdateManifest(malformed, 1)).not.toThrow();
    const m = parseUpdateManifest(malformed, 1);
    // The DELETE should still parse even if REPLACE and MOVE pairs are broken
    expect(ofKind(m, "removed").length).toBe(1);
  });

  // --- Real corpus test ---

  it("parses the real HVSC #84 update manifest without crashing", () => {
    const path =
      "data/hvsc-corpus/C64Music/DOCUMENTS/Update84.hvs";
    if (!existsSync(path)) return;
    const text = readFileSync(path, "latin1"); // ISO-8859-1
    const manifest = parseUpdateManifest(text, 84);
    expect(manifest.release_number).toBe(84);
    expect(manifest.release_date).toBe("December 25, 2025");
    expect(manifest.actions.length).toBeGreaterThan(0);
    // All four kinds should appear in a real update
    const k = kinds(manifest);
    expect(k.has("changed")).toBe(true);
    expect(k.has("new")).toBe(true);
    expect(k.has("moved")).toBe(true);
    expect(k.has("removed")).toBe(true);
    // No staging paths should leak into output
    for (const action of manifest.actions) {
      expect(action.hvsc_path).not.toMatch(/^\/update\//);
      if (action.moved_from) {
        expect(action.moved_from).not.toMatch(/^\/update\//);
      }
    }
  });

  it("real #84 manifest: changed count matches known REPLACE count (~15)", () => {
    const path =
      "data/hvsc-corpus/C64Music/DOCUMENTS/Update84.hvs";
    if (!existsSync(path)) return;
    const text = readFileSync(path, "latin1");
    const manifest = parseUpdateManifest(text, 84);
    // The header says 15 fixed/better rips
    const changed = ofKind(manifest, "changed");
    expect(changed.length).toBeGreaterThanOrEqual(10);
    expect(changed.length).toBeLessThanOrEqual(25);
  });

  it("real #84 manifest: removed paths are all canonical (no /update/ prefix)", () => {
    const path =
      "data/hvsc-corpus/C64Music/DOCUMENTS/Update84.hvs";
    if (!existsSync(path)) return;
    const text = readFileSync(path, "latin1");
    const manifest = parseUpdateManifest(text, 84);
    const removed = ofKind(manifest, "removed");
    expect(removed.length).toBeGreaterThan(0);
    for (const r of removed) {
      expect(r.hvsc_path).not.toMatch(/^\/update\//);
    }
  });
});
