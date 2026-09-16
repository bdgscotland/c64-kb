import { describe, it, expect } from "vitest";
import {
  c64BrowseHvsc, c64HvscStats, c64ComposerProfile,
  c64FindMotifs, c64InstrumentLookup, c64SimilarTunes, c64DriverLookup,
  c64SongStructure, c64VoiceRoles,
} from "../hvsc-mcp.js";

// These tests use the production c64_hvsc graph. They check shape, not
// content. If the graph is empty (canon not yet ingested), counts are 0
// but the contract holds: the tools return well-formed responses.

describe("HVSC MCP tools — contract", () => {
  it("c64_browse_hvsc returns a typed {tunes, total}", async () => {
    const result = await c64BrowseHvsc({ limit: 5 });
    expect(result).toHaveProperty("tunes");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.tunes)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("c64_hvsc_stats returns the version + counts", async () => {
    const stats = await c64HvscStats({});
    expect(stats).toHaveProperty("tune_count");
    expect(stats).toHaveProperty("composer_count");
    expect(stats).toHaveProperty("instrument_count");
    expect(stats).toHaveProperty("patch_count");
    expect(stats).toHaveProperty("patch_family_count");
    expect(stats).toHaveProperty("motif_count");
    expect(stats).toHaveProperty("motif_family_count");
    expect(stats).toHaveProperty("rhythm_count");
    expect(stats).toHaveProperty("section_count");
    expect(stats).toHaveProperty("voicepart_count");
    expect(stats).toHaveProperty("hvsc_corpus_version");
    expect(stats.hvsc_corpus_version).toMatch(/^hvsc-/);
  });

  it("c64_voice_roles returns voices/roles shape in both modes", async () => {
    const byTune = await c64VoiceRoles({ file_md5: "0".repeat(32) });
    expect(byTune).toHaveProperty("voices");
    expect(Array.isArray(byTune.voices)).toBe(true);

    const byComposer = await c64VoiceRoles({ composer: "Rob Hubbard" });
    expect(byComposer).toHaveProperty("roles");
    expect(Array.isArray(byComposer.roles)).toBe(true);
  });

  it("c64_find_motifs returns families/motifs shape in both modes", async () => {
    const byComposer = await c64FindMotifs({ composer: "Rob Hubbard" });
    expect(byComposer).toHaveProperty("families");
    expect(byComposer).toHaveProperty("motifs");
    expect(Array.isArray(byComposer.families)).toBe(true);

    const byPattern = await c64FindMotifs({ pattern: "2,2,-1" });
    expect(byPattern).toHaveProperty("motifs");
    expect(Array.isArray(byPattern.motifs)).toBe(true);
  });

  it("c64_song_structure returns section/shape shape in both modes", async () => {
    const byTune = await c64SongStructure({ file_md5: "0".repeat(32) });
    expect(byTune).toHaveProperty("sections");
    expect(byTune).toHaveProperty("repeat_shape");
    expect(Array.isArray(byTune.sections)).toBe(true);

    const byComposer = await c64SongStructure({ composer: "Rob Hubbard" });
    expect(byComposer).toHaveProperty("shapes");
    expect(Array.isArray(byComposer.shapes)).toBe(true);
  });

  it("c64_composer_profile returns inventory shape (or empty)", async () => {
    const profile = await c64ComposerProfile({ name: "Rob Hubbard" });
    expect(profile).toHaveProperty("name");
    expect(profile).toHaveProperty("tunes");
    expect(profile).toHaveProperty("note");
    // The "vocabulary inventory" framing per Codex C1 — explicitly NOT style modeling
    expect((profile as any).note).toMatch(/vocabulary inventory|known vocabulary/i);
  });

  it("c64_similar_tunes returns matches shape (empty + note for unknown tune)", async () => {
    const res = await c64SimilarTunes({ file_md5: "0".repeat(32), k: 5 });
    expect(res).toHaveProperty("matches");
    expect(Array.isArray(res.matches)).toBe(true);
    // A non-existent md5 has no node → empty matches + explanatory note.
    expect(res.matches).toHaveLength(0);
    expect(res.note).toMatch(/not found/i);
  });

  it("empty/missing input returns well-formed empty results", async () => {
    expect(await c64FindMotifs({})).toEqual(expect.objectContaining({ motifs: [] }));
    expect(await c64InstrumentLookup({})).toEqual(expect.objectContaining({ families: [], patches: [] }));
    expect(await c64DriverLookup({ hash: "deadbeef" })).toEqual(null);
  });
});
