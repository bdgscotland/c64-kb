import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { lintSource, lintSourceResult, detectLanguage } from "../src/tools/lint.ts";
import {
  lintStudyExpression,
  isStudiedPage,
  parseStudiedFromLine,
} from "../src/tools/lint/study-expression.ts";

// Two builds of the same platformer, written on 2026-09-22 by agents
// working from this knowledge base and from nothing, copied here so the
// test is self-contained. The no-KB build kept, on purpose, the faults
// a lint must catch; the KB build is the control.
const here = path.dirname(fileURLToPath(import.meta.url));
const NOKB = fs.readFileSync(path.join(here, "fixtures/lint-platformer-nokb.c"), "utf-8");
const KB = fs.readFileSync(path.join(here, "fixtures/lint-platformer-kb.c"), "utf-8");

function lineOf(source: string, needle: string): number {
  const idx = source.split("\n").findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`fixture no longer contains: ${needle}`);
  return idx + 1;
}

describe("lintSource on the no-KB platformer", () => {
  const findings = lintSource(NOKB, { language: "c" });

  it("reports the SID read-modify-write at its line as definite", () => {
    const line = lineOf(NOKB, "sid.voices[0].freq += 0x0100");
    const f = findings.find((x) => x.rule === "sid_write_only_registers" && x.line === line);
    expect(f).toBeDefined();
    expect(f!.certainty).toBe("definite");
    expect(f!.page).toBe("docs/pitfalls/sid.md#sid_write_only_registers");
    expect(f!.message).toContain("write-only");
  });

  it("reports the DDR clear with no later restore as definite", () => {
    const line = lineOf(NOKB, "cia1.ddra = 0;");
    const f = findings.find((x) => x.rule === "cia1_ddr_cleared_kills_keyboard");
    expect(f).toBeDefined();
    expect(f!.line).toBe(line);
    expect(f!.certainty).toBe("definite");
    expect(f!.message).toContain("SCNKEY");
  });

  it("reports the empty-name OPEN of channel 15 followed by a read", () => {
    const line = lineOf(NOKB, "krnio_open(15, 8, 15)");
    const f = findings.find((x) => x.rule === "empty_name_open_15_hangs_on_read");
    expect(f).toBeDefined();
    expect(f!.line).toBe(line);
    expect(f!.page).toBe("docs/recipes/oscar64/high-score-persist.md");
    expect(f!.message).toContain("no timeout");
  });

  it("reports the raster poll as heuristic, pointing at the frame-sync recipe", () => {
    const line = lineOf(NOKB, "while (vic.raster != 251)");
    const f = findings.find((x) => x.rule === "raster_poll_with_kernal_irq_live" && x.line === line);
    expect(f).toBeDefined();
    expect(f!.certainty).toBe("heuristic");
    expect(f!.pitfall).toBe("raster_irq_first_line_jitter");
    expect(f!.page).toBe("docs/recipes/oscar64/frame-sync-loop.md");
  });

  it("does not mistake #include <c64/sid.h> for a SID read", () => {
    const line = lineOf(NOKB, "#include <c64/sid.h>");
    expect(findings.some((x) => x.line === line)).toBe(false);
  });

  it("detects the language as C", () => {
    expect(detectLanguage(NOKB)).toBe("c");
  });
});

describe("lintSource on the KB platformer (control)", () => {
  const findings = lintSource(KB, { language: "c" });

  it("has no definite finding", () => {
    const definite = findings.filter((x) => x.certainty === "definite");
    expect(definite.map((x) => `${x.line}: ${x.rule}`)).toEqual([]);
  });

  it("does not flag reads of sid.random ($D41B)", () => {
    expect(findings.some((x) => x.rule === "sid_write_only_registers")).toBe(false);
  });

  it("does not flag a raster poll when the file installs a raster interrupt", () => {
    expect(findings.some((x) => x.rule === "raster_poll_with_kernal_irq_live")).toBe(false);
  });
});

const ASM = `
        * = $0801
start:  sei
        lda #$00
        sta $dc02        ; clear DDR
        inc $d404        ; bump voice 1 control: reads a write-only register
        lda $d41b        ; RANDOM is readable
        jmp ($12ff)
        lda #$ff
        sta $dc02        ; restore
        lda #<irq
        sta $0314
        lda #>irq
        sta $0315
        cli
main:   sed              ; main-loop BCD block, the page's scenario
        cld
        jmp main
irq:    pha
        lda ptr
        adc #8           ; no CLD before this
        sta ptr
        pla
        rti
`;

// The page's fix: CLD in the entry stanza, then a BCD block is fine.
const ASM_CLD = `
        lda #<irq
        sta $0314
        lda #>irq
        sta $0315
        rts
irq:    pha
        cld
        sed
        lda score
        adc #1
        sta score
        pla
        rti
`;

describe("lintSource on assembly", () => {
  const findings = lintSource(ASM, { language: "asm" });

  it("reports INC $D404 as a definite SID read-modify-write", () => {
    const f = findings.find((x) => x.rule === "sid_write_only_registers");
    expect(f).toBeDefined();
    expect(f!.line).toBe(6);
    expect(f!.certainty).toBe("definite");
    expect(f!.message).toContain("INC on $D404");
  });

  it("does not report LDA $D41B", () => {
    expect(findings.filter((x) => x.rule === "sid_write_only_registers")).toHaveLength(1);
  });

  it("reports JMP ($12FF) as definite with the wrong fetch address named", () => {
    const f = findings.find((x) => x.rule === "jmp_indirect_page_boundary_bug");
    expect(f).toBeDefined();
    expect(f!.line).toBe(8);
    expect(f!.certainty).toBe("definite");
    expect(f!.message).toContain("$1200");
  });

  it("does not report the DDR clear when a later store of $FF restores it", () => {
    expect(findings.some((x) => x.rule === "cia1_ddr_cleared_kills_keyboard")).toBe(false);
  });

  it("reports ADC in an installed handler before any CLD, in the page's words", () => {
    const f = findings.find((x) => x.rule === "decimal_mode_in_irq_handler");
    expect(f).toBeDefined();
    expect(f!.line).toBe(21);
    expect(f!.certainty).toBe("likely");
    expect(f!.message).toContain("not automatically cleared or saved on IRQ entry");
    expect(f!.message).toContain("RTI restores P from the stack, including D");
  });

  it("downgrades the handler finding to heuristic when nothing in the file executes SED", () => {
    const src =
      "        lda #<irq\n        sta $0314\n        lda #>irq\n        sta $0315\n        rts\nirq:    lda ptr\n        adc #8\n        sta ptr\n        rti\n";
    const f = lintSource(src, { language: "asm" }).find((x) => x.rule === "decimal_mode_in_irq_handler");
    expect(f).toBeDefined();
    expect(f!.line).toBe(7);
    expect(f!.certainty).toBe("heuristic");
    expect(f!.message).toContain("nothing in this file executes SED");
  });

  it("is quiet on a handler that does CLD on entry and then a BCD block", () => {
    const quiet = lintSource(ASM_CLD, { language: "asm" });
    expect(quiet.filter((x) => x.rule === "decimal_mode_in_irq_handler")).toEqual([]);
  });

  it("detects the language as asm", () => {
    expect(detectLanguage(ASM)).toBe("asm");
  });
});

describe("d016 rule reads the load that feeds the store", () => {
  it("is quiet when lda #$c8 feeds sta $d016 even after an earlier lda #<label", () => {
    const src = "        lda #<irq1\n        sta $0314\n        lda #$c8\n        sta $d016\n";
    expect(
      lintSource(src, { language: "asm" }).filter((x) => x.rule === "d016_unmasked_rmw_clobbers_csel_mcm"),
    ).toEqual([]);
  });

  it("reports lda #$07 / sta $d016 even when an earlier lda #15 sits in the window", () => {
    const src = "        lda #15\n        sta $fb\n        lda #$07\n        sta $d016\n";
    const f = lintSource(src, { language: "asm" }).filter(
      (x) => x.rule === "d016_unmasked_rmw_clobbers_csel_mcm",
    );
    expect(f.map((x) => x.line)).toEqual([4]);
  });
});

// The starters' deliberate whole-value stores (#41): each was reported
// before the rule knew ORA constants, register-named shadows and constants.
describe("d016 rule leaves deliberate whole-value stores alone (#41)", () => {
  const d016 = (src: string, language: "asm" | "c") =>
    lintSource(src, { language })
      .filter((x) => x.rule === "d016_unmasked_rmw_clobbers_csel_mcm")
      .map((x) => x.line);

  it("is quiet on an ORA with a constant, a register-named shadow and a register-named constant", () => {
    expect(d016("        lda xscroll\n        ora #$c0\n        sta $d016\n", "asm")).toEqual([]);
    expect(d016("        lda pf_d016\n        sta $d016\n", "asm")).toEqual([]);
    expect(d016("        lda d016_zp + 3\n        sta $d016\n", "asm")).toEqual([]);
    expect(d016("        lda #HUD_D016\n        sta $d016\n", "asm")).toEqual([]);
    expect(d016(".const MODE = $d8\n        lda #MODE\n        sta $d016\n", "asm")).toEqual([]);
    expect(d016("void f(void) {\n    vic.ctrl2 = D016_PLAY | 7;\n}\n", "c")).toEqual([]);
  });

  it("still reports a bare variable and a constant defined without CSEL", () => {
    expect(d016("        lda xscroll\n        sta $d016\n", "asm")).toEqual([2]);
    expect(d016(".const XS = 5\n        lda #XS\n        sta $d016\n", "asm")).toEqual([3]);
    expect(d016("void f(void) {\n    vic.ctrl2 = xscroll;\n}\n", "c")).toEqual([2]);
  });
});

describe("raster poll rule in assembly (#41)", () => {
  const poll = (src: string) =>
    lintSource(src, { language: "asm" }).filter((x) => x.rule === "raster_poll_with_kernal_irq_live");

  it("reports a busy-wait that branches back to its $D012 read", () => {
    expect(
      poll("wait:   lda $d012\n        cmp #$f8\n        bne wait\n        rts\n").map((x) => x.line),
    ).toEqual([1]);
    expect(poll("!:      lda $d012\n        cmp #$f8\n        bne !-\n").map((x) => x.line)).toEqual([1]);
    expect(poll("        lda $d012\n        cmp #$f8\n        bne *-5\n").map((x) => x.line)).toEqual([1]);
  });

  it("is quiet on a forward test in a handler file another file imports (shmup-vertical mux.asm)", () => {
    // Before #41 this fired: mux.asm has no $FFFE or SEI, since kernel.asm
    // installs the IRQ and imports it; its $D012 compare is a forward test.
    const mux = [
      "z_to_split:",
      "        jsr arm_split",
      "        lda #SPLIT_LINE-MARGIN",
      "        cmp $d012",
      "        bcs on_time",
      "        inc mux_late",
      "        jmp split_body",
      "on_time:",
      "        lda #$01",
      "        sta $d019",
      "        jmp irq_exit",
    ].join("\n");
    expect(poll(mux)).toEqual([]);
    expect(poll(mux.replace("        sta $d019\n", ""))).toEqual([]);
  });

  it("is quiet on a busy-wait in handler code (an RTI or a $D019 acknowledge in the file)", () => {
    expect(poll("wait:   lda $d012\n        bne wait\n        asl $d019\n        rti\n")).toEqual([]);
  });
});

describe("lfsr rule wants a name the file shifts or XORs", () => {
  it("does not report a counter that merely contains 'seed'", () => {
    const src = "int main(void){ unsigned reseed_count = 0; return 0; }";
    expect(lintSource(src, { language: "c" })).toEqual([]);
  });

  it("reports a zero seed that the file shifts and XORs", () => {
    const src =
      "unsigned seed = 0;\nunsigned step(void){ seed ^= seed << 7; seed ^= seed >> 9; return seed; }\n";
    expect(lintSource(src, { language: "c" }).map((x) => x.rule)).toEqual(["lfsr_zero_state_lockup"]);
  });
});

describe("lfsr rule reads a multi-byte seed (#97)", () => {
  // The #22 game test's step.asm: a 16-bit Galois LFSR whose state is 1.
  const step = (lo: string): string =>
    [
      `rng_lo:    .byte ${lo}              // waves.c rng_seed writes both`,
      "rng_hi:    .byte 0",
      "rng_step:",
      "        lsr rng_hi              // one Galois step",
      "        ror rng_lo",
      "        bcc !+",
      "        lda rng_hi",
      "        eor #$b4",
      "        sta rng_hi",
      "!:      rts",
    ].join("\n");

  it("is quiet on rng_hi .byte 0 beside rng_lo .byte 1", () => {
    expect(lintSource(step("1"), { language: "asm" })).toEqual([]);
  });

  it("still reports a state whose every byte is zero", () => {
    expect(lintSource(step("0"), { language: "asm" }).map((x) => [x.rule, x.line])).toEqual([
      ["lfsr_zero_state_lockup", 1],
      ["lfsr_zero_state_lockup", 2],
    ]);
  });

  it("is quiet on the same pattern in C", () => {
    const src =
      "char rng_lo = 1, rng_hi = 0;\nchar step(void){ char c = rng_lo & 1; rng_lo = (rng_lo >> 1) | (rng_hi << 7); rng_hi >>= 1; if (c) rng_hi ^= 0xb4; return rng_lo; }\n";
    expect(lintSource(src, { language: "c" })).toEqual([]);
    expect(
      lintSource(src.replace("rng_lo = 1", "rng_lo = 0"), { language: "c" }).map((x) => x.rule),
    ).toContain("lfsr_zero_state_lockup");
  });
});

describe("detectLanguage", () => {
  it("reads a KickAssembler .for block with a ';' inside a // comment as asm", () => {
    expect(detectLanguage(".for (var i=0; i<8; i++) {\n lda #0\n}\n;\n")).toBe("asm");
    expect(
      detectLanguage(
        "        lda #$00\n        sta $d020   // border;\n        .for (var r = 0; r < 25; r++) {\n        rts\n",
      ),
    ).toBe("asm");
  });

  it("reads a short C fragment as C", () => {
    expect(detectLanguage("__zeropage int counter;")).toBe("c");
    expect(detectLanguage("int main(void) { return 0; }")).toBe("c");
  });
});

describe("lintSourceResult", () => {
  it("summarises and renders every finding with its page", () => {
    const r = lintSourceResult(ASM, { language: "asm", toolchain: "kickassembler" });
    expect(r.structured.language).toBe("asm");
    expect(r.structured.toolchain).toBe("kickassembler");
    expect(r.structured.summary).toMatch(/^\d+ findings? \(/);
    for (const f of r.structured.findings) {
      expect(r.text).toContain(`line ${f.line}: ${f.rule}`);
      expect(r.text).toContain(`Page: ${f.page}`);
    }
  });

  it("says so when there is nothing to report", () => {
    const r = lintSourceResult("int main(void) { return 0; }", { language: "c" });
    expect(r.structured.findings).toEqual([]);
    expect(r.structured.summary).toBe("No findings.");
  });
});

// Issue #28: linting a whole Markdown page read a prose link to
// music-sid.md as `sid.md`, a read of a SID field. A page is now linted
// fence by fence; prose is never code.
describe("lintSource on a Markdown page", () => {
  const PAGE = [
    "# Music player",
    "",
    "The player follows [SID music](../techniques/music-sid.md) and `c64/sid.h`.",
    "Writing sid.fmodevol & 0xF0 in prose is not code.",
    "",
    "```c",
    "#include <c64/sid.h>",
    "void tick(void) {",
    "    sid.voices[0].ctrl |= 0x01;",
    "}",
    "```",
    "",
    "```asm",
    "    lda $d404",
    "```",
    "",
    "```text",
    "sid.voices[1].freq += 1;",
    "```",
  ].join("\n");
  const findings = lintSource(PAGE);

  it("does not report the prose link or prose mentions", () => {
    expect(findings.filter((f) => f.line <= 4)).toEqual([]);
  });

  it("reports the read-modify-write in the C fence at its page line", () => {
    const line = lineOf(PAGE, "sid.voices[0].ctrl |= 0x01");
    const f = findings.find((x) => x.rule === "sid_write_only_registers" && x.line === line);
    expect(f).toBeDefined();
    expect(f!.certainty).toBe("definite");
    expect(f!.excerpt).toBe("sid.voices[0].ctrl |= 0x01;");
  });

  it("runs the assembly rules on the asm fence of the same page", () => {
    const line = lineOf(PAGE, "lda $d404");
    expect(findings.some((x) => x.rule === "sid_write_only_registers" && x.line === line)).toBe(true);
  });

  it("skips a fence that is not C or assembly", () => {
    expect(findings.some((x) => x.line === lineOf(PAGE, "sid.voices[1].freq += 1"))).toBe(false);
  });

  it("narrows to one language's fences when the language is given", () => {
    const c = lintSource(PAGE, { language: "c" });
    expect(c.map((f) => f.line)).toEqual([lineOf(PAGE, "sid.voices[0].ctrl |= 0x01")]);
  });

  it("labels the result as Markdown with the fence languages", () => {
    expect(lintSourceResult(PAGE).text).toContain("(markdown, fences: c, asm)");
  });
});

// Issue #28 on the two pages it was seen on. Before the fence mask the
// whole of music-sid.md was read as C: seven definite findings, two of
// them `sid.md` in a prose link and none in its code.
describe("lintSource on the pages of issue #28", () => {
  const read = (rel: string): string => fs.readFileSync(path.join(here, "../docs", rel), "utf-8");

  it("finds nothing in asset-pipelines.md or music-sid.md, whose C fences only write the SID", () => {
    expect(lintSource(read("art/asset-pipelines.md"))).toEqual([]);
    expect(lintSource(read("techniques/music-sid.md"))).toEqual([]);
  });

  it("reports a read-modify-write put into a C fence of music-sid.md at its page line", () => {
    const lines = read("techniques/music-sid.md").split("\n");
    const at = lines.findIndex((l) => l.includes("sid.fmodevol = SID_FMODE_LP | 15;")) + 1;
    lines.splice(at, 0, "    sid.fmodevol |= 0x10;");
    const findings = lintSource(lines.join("\n"));
    expect(findings.map((f) => [f.rule, f.line, f.excerpt])).toEqual([
      ["sid_write_only_registers", at + 1, "sid.fmodevol |= 0x10;"],
    ]);
  });
});

// Issue #24's lint item: pitfalls/sprite.md sprite_registers_persist_across_state_change.
describe("d015_merged_across_states", () => {
  const rule = (src: string, language: "asm" | "c") =>
    lintSource(src, { language })
      .filter((x) => x.rule === "d015_merged_across_states")
      .map((x) => x.line);

  it("reports the merge when $D015 is also written elsewhere (asm)", () => {
    const src = [
      "title_enter:",
      "        lda #$01",
      "        sta $d015",
      "        rts",
      "play_enter:",
      "        lda $d015",
      "        ora #$02",
      "        sta $d015",
      "        rts",
    ].join("\n");
    expect(rule(src, "asm")).toEqual([8]);
  });

  it("is quiet when every state writes its whole mask, or the merge is the only write (asm)", () => {
    expect(rule("        lda #$01\n        sta $d015\n        lda #0\n        sta $d015\n", "asm")).toEqual(
      [],
    );
    expect(rule("        lda $d015\n        ora #$02\n        sta $d015\n", "asm")).toEqual([]);
    expect(
      rule(
        "        lda $d015\n        lda mask\n        ora #2\n        sta $d015\n        stx $d015\n",
        "asm",
      ),
    ).toEqual([]);
  });

  it("reports a compound assignment to vic.spr_enable beside another write (C)", () => {
    const src =
      "void title(void) {\n    vic.spr_enable = 0;\n}\nvoid play(void) {\n    vic.spr_enable |= 1;\n}\n";
    expect(rule(src, "c")).toEqual([5]);
    expect(
      rule("void play(void) {\n    vic.spr_enable = vic.spr_enable | 1;\n    vic.spr_enable = 0;\n}\n", "c"),
    ).toEqual([2]);
  });

  it("is quiet on a per-frame cull of a variable bit (lane-pursuit.md)", () => {
    const src =
      "void place(char n) {\n    char bit = 1 << n;\n    vic.spr_enable &= ~bit;\n    vic.spr_enable |= bit;\n}\nvoid title(void) {\n    vic.spr_enable = 0;\n}\n";
    expect(rule(src, "c")).toEqual([]);
    expect(
      rule(
        "        lda $d015\n        ora bits\n        sta $d015\n        lda #0\n        sta $d015\n",
        "asm",
      ),
    ).toEqual([]);
  });

  it("is quiet on a lone merge and on plain writes (C)", () => {
    expect(rule("void play(void) {\n    vic.spr_enable |= 1;\n}\n", "c")).toEqual([]);
    expect(rule("void a(void) {\n    vic.spr_enable = 0;\n    vic.spr_enable = mask;\n}\n", "c")).toEqual([]);
  });

  it("finds the bad play-state setup on the pitfall page", () => {
    const page = fs.readFileSync(path.join(here, "../docs/pitfalls/sprite.md"), "utf-8");
    const start = page.indexOf("## sprite_registers_persist_across_state_change");
    const section = page.slice(start, page.indexOf("\n## ", start + 10));
    expect(rule(section, "asm").length).toBeGreaterThan(0);
  });
});

// ── study_expression lint rule ────────────────────────────────────────────────

// A minimal studied-page frontmatter + header used by all study_expression tests.
const STUDIED_HEADER = `---\nkind: studied\n---\n\n# Study: Test Game\n\n`;

// A studied-page header with a Studied from line (sha1 + session).
const TEST_SHA1 = "aabbccddaabbccddaabbccddaabbccddaabbccdd";
const STUDIED_WITH_REF =
  STUDIED_HEADER +
  `**Studied from:** Test Game (2000, A. Author, Publisher); image sha1=${TEST_SHA1}; session studies/sessions/test.json\n\n`;

// Synthetic PRG bytes for image-match tests: 32 bytes, value = index.
const SYNTH_IMAGE = Buffer.from(Array.from({ length: 32 }, (_, i) => i));

describe("isStudiedPage", () => {
  it("returns true when frontmatter has kind: studied", () => {
    expect(isStudiedPage("---\nkind: studied\n---\n\n# Title\n")).toBe(true);
  });

  it("returns false for a non-studied page", () => {
    expect(isStudiedPage("---\ntool: kickassembler\n---\n\n# Title\n")).toBe(false);
    expect(isStudiedPage("# No frontmatter at all\n")).toBe(false);
  });
});

describe("parseStudiedFromLine", () => {
  it("extracts sha1 and session path from a well-formed line", () => {
    const r = parseStudiedFromLine(STUDIED_WITH_REF);
    expect(r?.sha1).toBe(TEST_SHA1);
    expect(r?.session).toBe("studies/sessions/test.json");
  });

  it("returns null when no Studied from line is present", () => {
    expect(parseStudiedFromLine(STUDIED_HEADER)).toBeNull();
  });
});

describe("lintStudyExpression — basic gates", () => {
  it("is a no-op on a page that is not kind:studied", () => {
    const page = "---\ntool: kickassembler\n---\n\n```asm\n        lda #$01\n        sta $d015\n```\n";
    expect(lintStudyExpression(page)).toEqual([]);
  });

  it("passes a studied page with no code and no long hex runs", () => {
    const page =
      STUDIED_HEADER + "The IRQ fires at $41C5 on raster line 30. $D018=$80 during play. $01=$36.\n";
    expect(lintStudyExpression(page)).toEqual([]);
  });
});

describe("lintStudyExpression — fenced assembly block", () => {
  it("flags a fenced block with 2+ mnemonic lines as definite", () => {
    const page =
      STUDIED_HEADER + "Some prose.\n\n```asm\n        lda #$36\n        sta $01\n        rts\n```\n";
    const findings = lintStudyExpression(page);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.rule).toBe("study_expression");
    expect(findings[0]?.certainty).toBe("definite");
    expect(findings[0]?.message).toContain("mnemonic");
  });

  it("is quiet on a fenced block with 0–1 mnemonic lines (not assembly)", () => {
    // A shell command line that happens to contain one mnemonic-like word
    const page = STUDIED_HEADER + "```\nx64sc -default -autostart game.prg\n```\n";
    expect(lintStudyExpression(page)).toEqual([]);
  });

  it("flags an unlabelled fenced block that contains disassembly", () => {
    const page =
      STUDIED_HEADER + "```\n0850  78        sei\n0851  a9 36     lda #$36\n0853  85 01     sta $01\n```\n";
    const findings = lintStudyExpression(page);
    expect(findings.some((f) => f.rule === "study_expression" && f.message.includes("mnemonic"))).toBe(true);
  });
});

describe("lintStudyExpression — hex run length", () => {
  it("flags a run of exactly 16 $XX bytes as definite (always refused)", () => {
    const run = Array.from({ length: 16 }, (_, i) => `$${i.toString(16).padStart(2, "0")}`).join(" ");
    const page = STUDIED_HEADER + `Raw bytes: ${run}\n`;
    const findings = lintStudyExpression(page);
    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe("study_expression");
    expect(findings[0]?.message).toContain("16");
  });

  it("is quiet on a run of 15 $XX bytes (below the always-refuse threshold)", () => {
    const run = Array.from({ length: 15 }, (_, i) => `$${i.toString(16).padStart(2, "0")}`).join(" ");
    const page = STUDIED_HEADER + `Raw bytes: ${run}\n`;
    expect(lintStudyExpression(page)).toEqual([]);
  });

  it("does not mistake a 4-digit address like $C000 for a hex byte run", () => {
    const page =
      STUDIED_HEADER +
      "Addresses: $C000 $C800 $D000 $D800 $E000 $F000 $A000 $B000 $8000 $9000 $6000 $7000 $4000 $5000 $2000 $3000\n";
    // All 4-digit, should not trigger the 16-byte run check
    expect(lintStudyExpression(page)).toEqual([]);
  });

  it("does not flag register values that are not in a consecutive run", () => {
    // $94, $36, $80, $86 each appear once, separated by prose
    const page = STUDIED_HEADER + "$DD00=$94 in play. $01=$36. $D018=$80 in area 0. $D018=$86 in area 3.\n";
    expect(lintStudyExpression(page)).toEqual([]);
  });
});

describe("lintStudyExpression — image-match (synthetic image)", () => {
  it("flags a run of 8 bytes found verbatim in the image", () => {
    // Bytes 0..7 from SYNTH_IMAGE
    const run = Array.from({ length: 8 }, (_, i) => `$${i.toString(16).padStart(2, "0")}`).join(" ");
    const page = STUDIED_HEADER + `Sequence: ${run}\n`;
    const findings = lintStudyExpression(page, SYNTH_IMAGE);
    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe("study_expression");
    expect(findings[0]?.message).toContain("game binary");
  });

  it("is quiet on a run of 8 bytes that do NOT appear in the image", () => {
    // Bytes 0xe0..0xe7, not in SYNTH_IMAGE (which only has 0x00-0x1f)
    const run = Array.from({ length: 8 }, (_, i) => `$${(0xe0 + i).toString(16)}`).join(" ");
    const page = STUDIED_HEADER + `Sequence: ${run}\n`;
    expect(lintStudyExpression(page, SYNTH_IMAGE)).toEqual([]);
  });

  it("is quiet on a run of 7 bytes found in the image (below 8-byte threshold)", () => {
    // Only 7 bytes, below the image-match threshold
    const run = Array.from({ length: 7 }, (_, i) => `$${i.toString(16).padStart(2, "0")}`).join(" ");
    const page = STUDIED_HEADER + `Sequence: ${run}\n`;
    expect(lintStudyExpression(page, SYNTH_IMAGE)).toEqual([]);
  });

  it("skips the image-match check when no image is supplied", () => {
    // 8 bytes that would be in any image — but no image is supplied
    const run = Array.from({ length: 8 }, (_, i) => `$${i.toString(16).padStart(2, "0")}`).join(" ");
    const page = STUDIED_HEADER + `Sequence: ${run}\n`;
    expect(lintStudyExpression(page)).toEqual([]);
    expect(lintStudyExpression(page, null)).toEqual([]);
  });
});

describe("lintStudyExpression — bare hex runs (no $ prefix)", () => {
  // A bare hex run is 16+ two-digit hex tokens (no $ prefix) with at least
  // one token containing a letter a–f, separated only by whitespace or commas.
  // Study pages carry no listings; byte runs are refused everywhere.
  const bareRun16 = Array.from({ length: 16 }, (_, i) => (0xa0 + i).toString(16)).join(" ");
  // "a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 aa ab ac ad ae af" — 16 tokens with letters

  it("flags a bare run of 16 hex tokens with letters as definite", () => {
    const page = STUDIED_HEADER + `Bytes: ${bareRun16}\n`;
    const findings = lintStudyExpression(page);
    expect(findings.length).toBe(1);
    expect(findings[0]?.rule).toBe("study_expression");
    expect(findings[0]?.certainty).toBe("definite");
    expect(findings[0]?.message).toContain("16");
  });

  it("is quiet on a bare run of 15 tokens (below threshold)", () => {
    const run15 = Array.from({ length: 15 }, (_, i) => (0xa0 + i).toString(16)).join(" ");
    expect(lintStudyExpression(STUDIED_HEADER + `Bytes: ${run15}\n`)).toEqual([]);
  });

  it("flags a bare hex dump inside a fenced block (fences do not exempt byte runs)", () => {
    // A ```text fence with a 16-byte bare dump — no mnemonics, but byte runs
    // are refused on study pages regardless of fencing.
    const page = STUDIED_HEADER + "```text\n" + bareRun16 + "\n```\n";
    const findings = lintStudyExpression(page);
    expect(findings.length).toBe(1);
    expect(findings[0]?.message).not.toContain("mnemonic");
  });

  it("reports only the mnemonic finding when a mnemonic-flagged fence also has a byte run", () => {
    // Fence has both a byte run AND mnemonics: mnemonic rule fires at the
    // fence opening; byte-run rule is suppressed to avoid double-counting.
    const page = STUDIED_HEADER + "```asm\n" + bareRun16 + "\n        lda #$01\n        sta $d015\n```\n";
    const findings = lintStudyExpression(page);
    expect(findings.length).toBe(1);
    expect(findings[0]?.message).toContain("mnemonic");
  });

  it("is quiet on a run of 16 pure-decimal tokens (no hex letters a–f)", () => {
    // 00 01 02 03 04 05 06 07 08 09 00 01 02 03 04 05 — all digits, no letters
    const decRun = Array.from({ length: 16 }, (_, i) => (i % 10).toString().padStart(2, "0")).join(" ");
    expect(lintStudyExpression(STUDIED_HEADER + `Values: ${decRun}\n`)).toEqual([]);
  });

  it("is quiet on 4-digit bare addresses even in long sequences", () => {
    // 16 four-digit hex addresses — NOT 2-digit tokens
    const addrs = Array.from({ length: 16 }, (_, i) => (0x4000 + i * 0x100).toString(16)).join(" ");
    expect(lintStudyExpression(STUDIED_HEADER + `Addresses: ${addrs}\n`)).toEqual([]);
  });

  it("is quiet when tokens are separated by prose words (not a consecutive run)", () => {
    // Tokens scattered in prose — a word between each pair breaks the run
    const page = STUDIED_HEADER + "line a9 address 36 value 85 count 01 check a9\n";
    expect(lintStudyExpression(page)).toEqual([]);
  });
});

describe("lintStudyExpression — bare hex image-match (synthetic image)", () => {
  // SYNTH_IMAGE = bytes 0x00..0x1f; bytes 0x0a-0x11 appear consecutively.
  const bareInImage = "0a 0b 0c 0d 0e 0f 10 11"; // 8 tokens, hex letters, in SYNTH_IMAGE
  const bareNotInImage = "a0 a1 a2 a3 a4 a5 a6 a7"; // 8 tokens, hex letters, NOT in SYNTH_IMAGE

  it("flags a bare run of 8 bytes found verbatim in the image", () => {
    const page = STUDIED_HEADER + `Bytes: ${bareInImage}\n`;
    const findings = lintStudyExpression(page, SYNTH_IMAGE);
    expect(findings.length).toBe(1);
    expect(findings[0]?.message).toContain("game binary");
  });

  it("is quiet on a bare run of 8 bytes NOT in the image", () => {
    const page = STUDIED_HEADER + `Bytes: ${bareNotInImage}\n`;
    expect(lintStudyExpression(page, SYNTH_IMAGE)).toEqual([]);
  });

  it("is quiet on a bare run of 7 bytes even if they are in the image", () => {
    const page = STUDIED_HEADER + "Bytes: 0a 0b 0c 0d 0e 0f 10\n";
    expect(lintStudyExpression(page, SYNTH_IMAGE)).toEqual([]);
  });

  it("skips image-match when no image supplied", () => {
    const page = STUDIED_HEADER + `Bytes: ${bareInImage}\n`;
    expect(lintStudyExpression(page)).toEqual([]);
    expect(lintStudyExpression(page, null)).toEqual([]);
  });

  it("flags a digit-only bare run of 8 bytes found in the image (no hex letters needed for image-match)", () => {
    // 00 01 02 03 04 05 06 07 — pure decimal digits, no a-f letters, but present in SYNTH_IMAGE
    const page = STUDIED_HEADER + "Bytes: 00 01 02 03 04 05 06 07\n";
    const findings = lintStudyExpression(page, SYNTH_IMAGE);
    expect(findings.length).toBe(1);
    expect(findings[0]?.message).toContain("game binary");
  });

  it("is quiet on a digit-only 8-byte run without an image (no hex letter, below 16)", () => {
    // Without an image the run is below 16 and has no hex letters, so no finding.
    const page = STUDIED_HEADER + "Bytes: 00 01 02 03 04 05 06 07\n";
    expect(lintStudyExpression(page)).toEqual([]);
  });
});
describe("lintStudyExpression — PAGE reference exists", () => {
  it("points at a page that exists in the repo", () => {
    const run = Array.from({ length: 16 }, (_, i) => (0xa0 + i).toString(16)).join(" ");
    const page = STUDIED_HEADER + `Bytes: ${run}\n`;
    const findings = lintStudyExpression(page);
    expect(findings.length).toBeGreaterThan(0);
    const pagePath = findings[0]?.page ?? "";
    expect(fs.existsSync(path.join(here, "..", pagePath)), `PAGE "${pagePath}" does not exist`).toBe(true);
  });
});

describe("lintStudyExpression — commando.md passes", () => {
  it("finds no violations in the committed commando.md", () => {
    const commando = fs.readFileSync(path.join(here, "../docs/game-design/studies/commando.md"), "utf-8");
    // No image supplied: only checks fences and 16+ byte runs.
    expect(lintStudyExpression(commando)).toEqual([]);
  });
});
