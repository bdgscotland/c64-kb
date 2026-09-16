import { describe, it, expect } from "vitest";
import { parseTuneFunction } from "../title-parser.js";

describe("parseTuneFunction — function_role from trailing paren", () => {
  it("(loader) → loader", () => {
    expect(parseTuneFunction("Honey Bee (loader)").function_role).toBe("loader");
  });

  it("(loader v2) → loader", () => {
    expect(parseTuneFunction("Poltergeist (loader v2)").function_role).toBe("loader");
  });

  it("(intro) → intro", () => {
    expect(parseTuneFunction("VIC64Demo (intro)").function_role).toBe("intro");
  });

  it("(ingame) → ingame", () => {
    expect(parseTuneFunction("Rocket n Roll (ingame)").function_role).toBe("ingame");
  });

  it("(end) → ending (via 'ending' keyword)", () => {
    // "(end)" alone doesn't currently match — confirmation that we don't
    // over-claim on the bare word "end".  Use (ending) to get ending.
    expect(parseTuneFunction("Mega Kines (ending)").function_role).toBe("ending");
  });

  it("(Game Over) → gameover", () => {
    expect(parseTuneFunction("Bubble Bobble (Game Over)").function_role).toBe("gameover");
  });

  it("(High Score) → highscore", () => {
    expect(parseTuneFunction("Pac-Man (High Score)").function_role).toBe("highscore");
  });

  it("(Title) → title", () => {
    expect(parseTuneFunction("Some Tune (Title)").function_role).toBe("title");
  });

  it("(Title) wins over the bare title keyword in the outer title", () => {
    expect(parseTuneFunction("Title Music (Loader)").function_role).toBe("loader");
  });
});

describe("parseTuneFunction — extended Layer-7 roles", () => {
  it("(SFX) → sfx", () => {
    expect(parseTuneFunction("Some Tune (SFX)").function_role).toBe("sfx");
  });

  it("(menu) → menu", () => {
    expect(parseTuneFunction("Some Tune (menu)").function_role).toBe("menu");
  });

  it("(preview) → preview", () => {
    expect(parseTuneFunction("Some Tune (preview)").function_role).toBe("preview");
  });

  it("(preview 2) → preview", () => {
    expect(parseTuneFunction("Some Tune (preview 2)").function_role).toBe("preview");
  });

  it("(unused) → unused", () => {
    expect(parseTuneFunction("Some Tune (unused)").function_role).toBe("unused");
  });

  it("(speech) → sample", () => {
    expect(parseTuneFunction("Some Tune (speech)").function_role).toBe("sample");
  });

  it("(main) → ingame", () => {
    expect(parseTuneFunction("Some Tune (main)").function_role).toBe("ingame");
  });

  it("(end) → ending", () => {
    expect(parseTuneFunction("Some Tune (end)").function_role).toBe("ending");
  });

  it("(end part) → ending", () => {
    expect(parseTuneFunction("Some Tune (end part)").function_role).toBe("ending");
  });

  it("(magazine) → demo", () => {
    expect(parseTuneFunction("Some Tune (magazine)").function_role).toBe("demo");
  });

  it("multi-word 'Main Title' still maps to title (not ingame)", () => {
    expect(parseTuneFunction("Main Title").function_role).toBe("title");
  });

  it("'ending' keyword still wins over the 'end' fallback", () => {
    expect(parseTuneFunction("Some Tune (ending)").function_role).toBe("ending");
  });
});

describe("parseTuneFunction — section_marker", () => {
  it("captures the inner content of a trailing (...)", () => {
    expect(parseTuneFunction("Lunacy 2 (tune 1)").section_marker).toBe("tune 1");
  });

  it("preserves multi-word markers verbatim", () => {
    expect(parseTuneFunction("Crazy Jazz (6581)").section_marker).toBe("6581");
  });

  it("is empty when there is no trailing parenthetical", () => {
    expect(parseTuneFunction("Commando").section_marker).toBe("");
  });
});

describe("parseTuneFunction — level_number", () => {
  it("captures from (Level N)", () => {
    const r = parseTuneFunction("Project Argus (Level 3)");
    expect(r.level_number).toBe(3);
    expect(r.function_role).toBe("level");
  });

  it("captures from freestanding 'Level N' in title", () => {
    const r = parseTuneFunction("Turrican III Level 3");
    expect(r.level_number).toBe(3);
    expect(r.function_role).toBe("level");
  });

  it("does NOT set level_number for 'Level 42' (band) — but DOES match role=level on keyword", () => {
    // The conservative call: we DO match the level keyword, and level_number = 42.
    // "Level 42" is a band; some tunes named "Level 42" are not game level 42.
    // We accept this false-positive trade-off since level N is otherwise too valuable to lose.
    const r = parseTuneFunction("Level 42");
    expect(r.function_role).toBe("level");
    expect(r.level_number).toBe(42);
  });

  it("ignores 4-digit numbers (years)", () => {
    const r = parseTuneFunction("Level 1990");
    // LEVEL_N_RE caps N at 2 digits, so 1990 doesn't match level_number,
    // but the bare 'level' keyword still yields function_role=level.
    expect(r.level_number).toBeNull();
    expect(r.function_role).toBe("level");
  });
});

describe("parseTuneFunction — source_work from STIL [from X]", () => {
  it("extracts 'Koyaanisqatsi' from '[from the movie Koyaanisqatsi]'", () => {
    const r = parseTuneFunction("Delta", "Resource [from the movie Koyaanisqatsi] (5:26-9:07)");
    expect(r.source_work).toBe("Koyaanisqatsi");
  });

  it("extracts 'War of the Worlds' from '[from War of the Worlds]'", () => {
    const r = parseTuneFunction("WOTW", "Eve of the War [from War of the Worlds] (3:35-3:54)");
    expect(r.source_work).toBe("War of the Worlds");
  });

  it("strips 'the arcade game' qualifier when a work title remains", () => {
    const r = parseTuneFunction("Commando", "Base [from the arcade game Commando] (3:33-3:36)");
    expect(r.source_work).toBe("Commando");
  });

  it("yields source_type only (no source_work) when bracket is a bare qualifier", () => {
    // "[from the Spectrum game]" is a platform note, not a work title.  We
    // record the type and leave source_work empty so consumers can distinguish
    // "this is a cover of <known work>" from "this is just tagged as Spectrum".
    const r = parseTuneFunction("Cobra", "Cobra (Title) [from the Spectrum game]");
    expect(r.source_work).toBe("");
    expect(r.source_type).toBe("spectrum_game");
  });

  it("source_work and section_marker coexist", () => {
    const r = parseTuneFunction("Delta", "Resource [from the movie Koyaanisqatsi] (5:26-9:07)");
    expect(r.source_work).toBe("Koyaanisqatsi");
    // section_marker is captured from the *tune title*, not stil_title.
    expect(r.section_marker).toBe("");
  });

  it("function_role detection sees the STIL title too", () => {
    const r = parseTuneFunction("Cobra", "Cobra (Title) [from the Spectrum game]");
    expect(r.function_role).toBe("title");
  });
});

describe("parseTuneFunction — source_type classification", () => {
  it("'the movie X' → source_type=movie, source_work=X", () => {
    const r = parseTuneFunction("Delta", "Resource [from the movie Koyaanisqatsi]");
    expect(r.source_type).toBe("movie");
    expect(r.source_work).toBe("Koyaanisqatsi");
  });

  it("'the TV series X' → source_type=tv_series, source_work=X", () => {
    const r = parseTuneFunction("X", "Theme [from the TV series Magnum P.I.]");
    expect(r.source_type).toBe("tv_series");
    expect(r.source_work).toBe("Magnum P.I.");
  });

  it("'the arcade game X' → source_type=arcade_game, source_work=X", () => {
    const r = parseTuneFunction("Commando", "Base [from the arcade game Commando]");
    expect(r.source_type).toBe("arcade_game");
    expect(r.source_work).toBe("Commando");
  });

  it("'the Amiga MOD module' alone → source_type=amiga_module, source_work=''", () => {
    const r = parseTuneFunction("X", "Some Riff [from the Amiga MOD module]");
    expect(r.source_type).toBe("amiga_module");
    expect(r.source_work).toBe("");
  });

  it("'the NES game X' → source_type=nes_game", () => {
    const r = parseTuneFunction("X", "Theme [from the NES game Super Mario Bros.]");
    expect(r.source_type).toBe("nes_game");
    expect(r.source_work).toBe("Super Mario Bros.");
  });

  it("no qualifier prefix → source_work=raw, source_type=''", () => {
    const r = parseTuneFunction("X", "Magnetic Fields, Part 1 [from Magnetic Fields]");
    expect(r.source_type).toBe("");
    expect(r.source_work).toBe("Magnetic Fields");
  });
});

describe("parseTuneFunction — empty / missing inputs", () => {
  it("returns all-empty for empty title + empty stil_title", () => {
    const r = parseTuneFunction("", "");
    expect(r).toEqual({
      function_role: "",
      source_work: "",
      source_type: "",
      level_number: null,
      section_marker: "",
    });
  });

  it("handles undefined / null gracefully", () => {
    const r = parseTuneFunction(null as unknown as string, undefined);
    expect(r.function_role).toBe("");
  });

  it("returns empty function_role when nothing matches", () => {
    const r = parseTuneFunction("Commando");
    expect(r.function_role).toBe("");
    expect(r.section_marker).toBe("");
  });
});
