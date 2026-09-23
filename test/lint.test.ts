import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { lintSource, lintSourceResult, detectLanguage } from "../src/tools/lint.js";

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
    const src = "        lda #<irq\n        sta $0314\n        lda #>irq\n        sta $0315\n        rts\nirq:    lda ptr\n        adc #8\n        sta ptr\n        rti\n";
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
    expect(lintSource(src, { language: "asm" }).filter((x) => x.rule === "d016_unmasked_rmw_clobbers_csel_mcm")).toEqual([]);
  });

  it("reports lda #$07 / sta $d016 even when an earlier lda #15 sits in the window", () => {
    const src = "        lda #15\n        sta $fb\n        lda #$07\n        sta $d016\n";
    const f = lintSource(src, { language: "asm" }).filter((x) => x.rule === "d016_unmasked_rmw_clobbers_csel_mcm");
    expect(f.map((x) => x.line)).toEqual([4]);
  });
});

describe("lfsr rule wants a name the file shifts or XORs", () => {
  it("does not report a counter that merely contains 'seed'", () => {
    const src = "int main(void){ unsigned reseed_count = 0; return 0; }";
    expect(lintSource(src, { language: "c" })).toEqual([]);
  });

  it("reports a zero seed that the file shifts and XORs", () => {
    const src = "unsigned seed = 0;\nunsigned step(void){ seed ^= seed << 7; seed ^= seed >> 9; return seed; }\n";
    expect(lintSource(src, { language: "c" }).map((x) => x.rule)).toEqual(["lfsr_zero_state_lockup"]);
  });
});

describe("detectLanguage", () => {
  it("reads a KickAssembler .for block with a ';' inside a // comment as asm", () => {
    expect(detectLanguage(".for (var i=0; i<8; i++) {\n lda #0\n}\n;\n")).toBe("asm");
    expect(detectLanguage("        lda #$00\n        sta $d020   // border;\n        .for (var r = 0; r < 25; r++) {\n        rts\n")).toBe("asm");
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
