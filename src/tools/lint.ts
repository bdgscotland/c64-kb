/**
 * Source lints compiled from the pitfall pages.
 *
 * lintSource(source, opts) runs the knowledge base's own rules over a
 * piece of C (Oscar64) or 6502 assembly and returns one finding per
 * site. Each rule is named after the pitfall it compiles and points at
 * the page that states it, so a finding can be read back against the
 * page. No graph or vector store is needed; the rules are text
 * patterns, and each carries a certainty:
 *
 *   definite   the pattern is the pitfall by construction
 *   likely     the pattern is the pitfall unless something the lint
 *              cannot see (an earlier call, a shadow variable) excuses it
 *   heuristic  the pattern often accompanies the pitfall; read the page
 *              and decide
 *
 * The messages use the pages' own words. The rules are deliberately
 * narrow: a lint that is quiet on correct code is worth more to an
 * agent than one that is loud on everything.
 */

export type LintLanguage = "c" | "asm";
export type LintCertainty = "definite" | "likely" | "heuristic";

// Type aliases rather than interfaces: the MCP SDK's structuredContent
// needs an index-signature-compatible type, which an interface is not.
export type LintFinding = {
  rule: string;
  pitfall: string;
  line: number;
  excerpt: string;
  message: string;
  page: string;
  certainty: LintCertainty;
};

export type LintOptions = {
  language: LintLanguage | "auto";
  toolchain?: string;
};

export type LintOutput = {
  language: LintLanguage;
  toolchain?: string;
  findings: LintFinding[];
  summary: string;
};

export type LintResult = { structured: LintOutput; text: string };

const PAGES = {
  sid: "docs/pitfalls/sid.md#sid_write_only_registers",
  ddr: "docs/pitfalls/input.md#cia1_ddr_cleared_kills_keyboard",
  open15: "docs/recipes/oscar64/high-score-persist.md",
  rasterPoll: "docs/recipes/oscar64/frame-sync-loop.md",
  lfsr: "docs/pitfalls/cpu.md#lfsr_zero_state_lockup",
  decimal: "docs/pitfalls/kernal-and-io.md#decimal_mode_in_irq_handler",
  d016: "docs/pitfalls/scroll.md#d016_unmasked_rmw_clobbers_csel_mcm",
  jmp: "docs/pitfalls/cpu.md#jmp_indirect_page_boundary_bug",
} as const;

// The two pages that speak to a bare OPEN of channel 15 disagree, and
// the rule says so rather than pick one. high-score-persist.md measured
// the OPEN returning success with no drive present; techniques/file-io.md
// tests the carry after it and expects C=1, A=5. Which is right is not
// measured by this lint.
const OPEN15_MECHANISM =
  "high-score-persist.md: the KERNAL sends nothing on the bus when the filename length is zero, so that OPEN returned success with no drive present, and the CHKIN inside the read then hangs with no timeout. techniques/file-io.md opens the status channel bare on purpose and tests the carry after OPEN (bcs no_drive, C=1 A=5). The two pages disagree on what a bare OPEN returns with no drive; this lint does not settle it. Safe either way: read the status channel only after a named OPEN (a file, or a DOS command such as I0) has succeeded.";

// SID fields with a read path ($D419-$D41C). Every other field is write-only.
const SID_READABLE = new Set(["potx", "poty", "random", "env3"]);

// ------------------------------------------------------------------ helpers

const MNEMONIC_LINE =
  /^\s*(?:[\w.@!+-]+:\s*)?(lda|ldx|ldy|sta|stx|sty|jsr|jmp|rts|rti|sei|cli|inc|dec|inx|iny|dex|dey|cmp|cpx|cpy|bne|beq|bcc|bcs|bpl|bmi|bvc|bvs|adc|sbc|and|ora|eor|asl|lsr|rol|ror|bit|pha|pla|php|plp|tax|tay|txa|tya|tsx|txs|nop|brk|sed|cld|sec|clc|clv)\b(?=\s*$|\s+[^=\s])/i;

/**
 * Detect the language from the text when the caller does not say.
 * Comments are stripped first, so a `//` comment ending in `;` or a
 * `for` inside a KickAssembler `.for` cannot make an assembler listing
 * read as C. Assembler signatures are tested before the C shape test.
 */
export function detectLanguage(source: string): LintLanguage {
  if (/^\s*#\s*(include|define|pragma|assign|repeat|embed|ifdef|ifndef)\b/m.test(source)) return "c";
  const asmText = stripAsm(source);
  if (/^\s*\*\s*=/m.test(asmText)) return "asm";
  if (
    /^\s*(\.pc\b|\.(for|while|byte|word|fill|var|const|text|encoding|import|macro|label)\b|!byte\b|!word\b|!fill\b|!zone\b|\.org\b|\.byt\b)/m.test(
      asmText,
    )
  )
    return "asm";
  if (/\bBasicUpstart2?\s*\(/.test(asmText)) return "asm";
  const cText = stripC(source);
  if (/__asm\s*\{/.test(cText)) return "c";
  const mnemonicLines = asmText.split("\n").filter((l) => MNEMONIC_LINE.test(l)).length;
  if (mnemonicLines >= 3) return "asm";
  const terminated = /;\s*(\}|$)/m.test(cText);
  if (
    terminated &&
    /(^|[^.\w])(void|int|char|unsigned|struct|while|for|if|return|switch|case|byte|word)\b[^;\n]*[;{(:]/.test(
      cText,
    )
  )
    return "c";
  // Bare statements: a call or an assignment ending in `;`.
  if (terminated && /^\s*[\w.>\[\]-]+\s*(\([^;]*\)|=[^=][^;]*)\s*;/m.test(cText)) return "c";
  return "asm";
}

/**
 * Blank out comments and string literals in C while keeping every line
 * break, so line numbers survive and a `sid.` inside a comment or a
 * string is never matched.
 */
function stripC(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === "/" && d === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (c === "/" && d === "/") {
      let j = i;
      while (j < n && source[j] !== "\n") j++;
      out += " ".repeat(j - i);
      i = j;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== "\n") {
        if (source[j] === "\\") j++;
        j++;
      }
      const stop = Math.min(n, j + 1);
      // keep the quotes so an empty string is still recognisable as ""
      out += c + " ".repeat(Math.max(0, stop - i - 2)) + (stop - i >= 2 ? c : "");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Blank out `;` and `//` comments in assembly, keeping line breaks. */
function stripAsm(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      let cut = line.length;
      const a = line.indexOf(";");
      const b = line.indexOf("//");
      if (a >= 0) cut = Math.min(cut, a);
      if (b >= 0) cut = Math.min(cut, b);
      return line.slice(0, cut);
    })
    .join("\n");
}

function parseNumber(tok: string): number | null {
  const t = tok.trim();
  if (/^\$[0-9a-f]+$/i.test(t)) return parseInt(t.slice(1), 16);
  if (/^0x[0-9a-f]+$/i.test(t)) return parseInt(t.slice(2), 16);
  if (/^%[01]+$/.test(t)) return parseInt(t.slice(1), 2);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  return null;
}

function isZero(tok: string): boolean {
  return parseNumber(tok) === 0;
}

function hex4(v: number): string {
  return v.toString(16).toUpperCase().padStart(4, "0");
}

function excerptOf(lines: string[], idx: number): string {
  return lines[idx].trim().slice(0, 120);
}

// ------------------------------------------------------------------ C rules

const C_SID_PATH = /\bsid((?:\.\w+|\[[^\]]*\])+)/g;

function lintC(raw: string, findings: LintFinding[]): void {
  const src = stripC(raw);
  const lines = src.split("\n");
  const rawLines = raw.split("\n");

  // sid_write_only_registers: read or read-modify-write of a write-only field.
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // preprocessor: `#include <c64/sid.h>` is not a read
    let m: RegExpExecArray | null;
    C_SID_PATH.lastIndex = 0;
    while ((m = C_SID_PATH.exec(line)) !== null) {
      const path = m[1];
      const field = (/\.(\w+)\s*$/.exec(path) ?? [])[1] ?? "";
      if (SID_READABLE.has(field)) continue;
      const after = line.slice(m.index + m[0].length);
      const before = line.slice(0, m.index);
      const rmw = /^\s*(\+\+|--|[-+*/|&^]=|<<=|>>=)/.test(after) || /(\+\+|--)\s*$/.test(before);
      const plainWrite = /^\s*=(?!=)/.test(after);
      const isSizeof = /\bsizeof\s*\(\s*$/.test(before);
      const isAddressOf = /&\s*$/.test(before);
      if (rmw) {
        findings.push({
          rule: "sid_write_only_registers",
          pitfall: "sid_write_only_registers",
          line: i + 1,
          excerpt: excerptOf(rawLines, i),
          message: `Read-modify-write of sid${path}: all SID registers $D400-$D418 are write-only, and a read returns the last byte the chip held, not the register's value. Keep a shadow copy in RAM, change the shadow, and write the shadow to the register.`,
          page: PAGES.sid,
          certainty: "definite",
        });
      } else if (!plainWrite && !isSizeof && !isAddressOf) {
        findings.push({
          rule: "sid_write_only_registers",
          pitfall: "sid_write_only_registers",
          line: i + 1,
          excerpt: excerptOf(rawLines, i),
          message: `Read of sid${path}: all SID registers $D400-$D418 are write-only; reads return the last byte the chip held. Only $D419-$D41C (potx, poty, random, env3) read back anything meaningful. Read your shadow copy instead.`,
          page: PAGES.sid,
          certainty: "definite",
        });
      }
    }
    // Raw pointer form: *(volatile char*)0xD404 |= ...
    const rawRmw = /0x[dD]4(?:0[0-9a-fA-F]|1[0-8])\b[^;=]*?(\+\+|--|[-+*/|&^]=|<<=|>>=)/.exec(line);
    if (rawRmw) {
      findings.push({
        rule: "sid_write_only_registers",
        pitfall: "sid_write_only_registers",
        line: i + 1,
        excerpt: excerptOf(rawLines, i),
        message:
          "Read-modify-write through a pointer into $D400-$D418: these registers are write-only, and a read returns the last byte the chip held. Keep a shadow copy and write the shadow.",
        page: PAGES.sid,
        certainty: "definite",
      });
    }
  });

  // cia1_ddr_cleared_kills_keyboard: cia1.ddra = 0 with no later write of 0xFF.
  const ddrZero: number[] = [];
  let ddrRestore = -1;
  lines.forEach((line, i) => {
    const m =
      /\bcia1\s*\.\s*ddra\s*=(?!=)\s*([^;]+);/.exec(line) ??
      /\*\s*\(\s*(?:volatile\s+)?(?:unsigned\s+)?(?:char|byte)\s*\*\s*\)\s*0x[dD][cC]02\s*=(?!=)\s*([^;]+);/.exec(
        line,
      );
    if (!m) return;
    const v = m[1].trim();
    if (isZero(v)) ddrZero.push(i);
    else if (parseNumber(v) === 0xff) ddrRestore = i;
  });
  for (const i of ddrZero) {
    if (ddrRestore > i) continue;
    findings.push({
      rule: "cia1_ddr_cleared_kills_keyboard",
      pitfall: "cia1_ddr_cleared_kills_keyboard",
      line: i + 1,
      excerpt: excerptOf(rawLines, i),
      message:
        "Clearing $DC02 (cia1.ddra) turns every keyboard column line into an input; SCNKEY's column writes then drive nothing and no key does anything until something writes $FF back. Nothing later in this file does. Leave the DDR as IOINIT set it ($DC02 = $FF) and read $DC00 directly for joystick 2.",
      page: PAGES.ddr,
      certainty: "definite",
    });
  }

  // empty-name OPEN of channel 15 followed by a read.
  lines.forEach((line, i) => {
    const m = /\bkrnio_open\s*\(\s*(\w+)\s*,\s*\w+\s*,\s*15\s*\)/.exec(line);
    if (!m) return;
    const fnum = m[1];
    let emptyName = false;
    let sawSetnam = false;
    for (let j = i; j >= Math.max(0, i - 12); j--) {
      const s = /\bkrnio_setnam(_n)?\s*\(([^)]*)\)/.exec(lines[j]);
      if (!s) continue;
      sawSetnam = true;
      const args = s[2];
      if (s[1] === "_n") {
        const len = args.split(",").pop() ?? "";
        emptyName = isZero(len);
      } else {
        emptyName = /^\s*""\s*$/.test(args);
      }
      break;
    }
    if (sawSetnam && !emptyName) return;
    let readLine = -1;
    for (let j = i; j < Math.min(lines.length, i + 20); j++) {
      const l = lines[j];
      if (new RegExp(`\\bkrnio_(gets|read|getch|chkin|read_lzo)\\s*\\(\\s*${fnum}\\b`).test(l)) {
        readLine = j;
        break;
      }
      if (new RegExp(`\\bkrnio_close\\s*\\(\\s*${fnum}\\b`).test(l)) break;
    }
    if (readLine < 0) return;
    findings.push({
      rule: "empty_name_open_15_hangs_on_read",
      pitfall: "empty_name_open_15_hangs_on_read",
      line: i + 1,
      excerpt: excerptOf(rawLines, i),
      message: `OPEN of channel 15 with ${sawSetnam ? "an empty name" : "no name set"} and then a read on it (line ${readLine + 1}). ${OPEN15_MECHANISM}`,
      page: PAGES.open15,
      certainty: "heuristic",
    });
  });

  // Raster poll with the KERNAL IRQ live.
  const installsIrq =
    /\brirq_\w+|__interrupt|0x0314\b|0x0318\b|0xfffe\b|\$0314|\$fffe|\bsei\b|rasterirq\.h/i.test(src);
  if (!installsIrq) {
    lines.forEach((line, i) => {
      const poll =
        /\b(while|for|do)\b[^;{]*\bvic\s*\.\s*raster\b/.test(line) ||
        /\b(while|for)\b[^;{]*0x[dD]012\b/.test(line) ||
        /\bvic_waitLine\s*\(/.test(line) ||
        /\bvic_waitBottom\s*\(/.test(line);
      if (!poll) return;
      findings.push({
        rule: "raster_poll_with_kernal_irq_live",
        pitfall: "raster_irq_first_line_jitter",
        line: i + 1,
        excerpt: excerptOf(rawLines, i),
        message:
          "Busy-wait on vic.raster ($D012) in a file that never installs an interrupt (no rirq_*, __interrupt, $0314, $FFFE or SEI). The KERNAL jiffy interrupt is still live, so the poll can be pre-empted across the line it waits for and the loop's entry point moves by whole lines from frame to frame; a poll for one exact value can miss it and wait a frame. The frame-sync-loop recipe has the interrupt own one tick byte and the main loop wait for the tick. Heuristic: the interrupt may be installed in another file.",
        page: PAGES.rasterPoll,
        certainty: "heuristic",
      });
    });
  }

  // lfsr_zero_state_lockup: a seed constant of 0.
  lines.forEach((line, i) => {
    const m =
      /\b(?:(?:static|unsigned|char|int|short|long|volatile|const|byte|word)\s+)*(\w*(?:seed|lfsr|rng|rand_state|random_state)\w*)\s*=(?!=)\s*(0x0+|0)\s*[;,]/i.exec(
        line,
      );
    if (!m) return;
    const name = m[1];
    // Only a name the file shifts or XORs is an LFSR state; a counter
    // or flag that happens to contain "seed" or "rng" is not.
    const shifted = new RegExp(`(\\b${name}\\s*(>>=?|<<=?|\\^=?)|(>>|<<|\\^)\\s*${name}\\b)`).test(src);
    if (!shifted) return;
    const checked = new RegExp(`(!\\s*${name}\\b|\\b${name}\\s*==\\s*0\\b|\\b${name}\\s*\\|\\|)`).test(src);
    if (checked) return;
    findings.push({
      rule: "lfsr_zero_state_lockup",
      pitfall: "lfsr_zero_state_lockup",
      line: i + 1,
      excerpt: excerptOf(rawLines, i),
      message: `${name} is set to zero and nothing in this file tests it for zero. An LFSR seeded with zero outputs zero for ever: from state zero the bit that falls out is 0, nothing is XORed in, and the state is zero again. Test the seed before the first step and replace zero with a non-zero constant.`,
      page: PAGES.lfsr,
      certainty: "likely",
    });
  });

  // decimal_mode_in_irq_handler has no C form. The pitfall is a handler
  // whose entry does not CLD before its first ADC or SBC; in C the
  // arithmetic is the compiler's and whether the prologue clears D is a
  // property of the toolchain, not of the text, so there is nothing to
  // match. The asm form is in lintAsm.

  // d016_unmasked_rmw_clobbers_csel_mcm: a store to vic.ctrl2 not derived from a masked read.
  lines.forEach((line, i) => {
    const m =
      /\bvic\s*\.\s*ctrl2\s*=(?!=)\s*([^;]+);/.exec(line) ?? /0x[dD]016\b[^;=]*=(?!=)\s*([^;]+);/.exec(line);
    if (!m) return;
    const rhs = m[1].trim();
    if (/\bvic\s*\.\s*ctrl2\b/.test(rhs) || rhs.includes("&")) return;
    const lit = parseNumber(rhs);
    if (lit !== null && (lit & 0x08) !== 0) return;
    if (/\b0x[cC]8\b|\b0x[dD]8\b|\b0x18\b|\b0x08\b|\bVIC_CTRL2_CSEL\b|\bVIC_CTRL2_MCM\b/.test(rhs)) return;
    findings.push({
      rule: "d016_unmasked_rmw_clobbers_csel_mcm",
      pitfall: "d016_unmasked_rmw_clobbers_csel_mcm",
      line: i + 1,
      excerpt: excerptOf(rawLines, i),
      message:
        "Store to vic.ctrl2 ($D016) of a value not derived from a masked read: the naive `vic.ctrl2 = xscroll` zeroes CSEL and MCM along with bits 5-7, switching to 38 columns and hires. Write `vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll`, or a shadow that carries CSEL and MCM. Heuristic: the right-hand side may already be such a shadow.",
      page: PAGES.d016,
      certainty: "heuristic",
    });
  });
}

// ---------------------------------------------------------------- asm rules

const LABEL = String.raw`(?:[\w.@!+-]+:?\s+)?`;
const ASM_SID_OPS = new RegExp(
  String.raw`^\s*${LABEL}(inc|dec|asl|lsr|rol|ror|lda|ldx|ldy|bit|cmp|adc|sbc|and|ora|eor)\s+(\$[0-9a-f]{4}|0x[0-9a-f]{4}|[0-9]{4,5})\s*(,\s*[xy])?\s*$`,
  "i",
);

function lintAsm(raw: string, findings: LintFinding[]): void {
  const src = stripAsm(raw);
  const lines = src.split("\n");
  const rawLines = raw.split("\n");

  // sid_write_only_registers
  lines.forEach((line, i) => {
    const m = ASM_SID_OPS.exec(line);
    if (!m) return;
    const ea = parseNumber(m[2]);
    if (ea === null || ea < 0xd400 || ea > 0xd418) return;
    const indexed = Boolean(m[3]);
    if (indexed) {
      // A page-by-page copy of the character ROM reads $D000-$DFFF with
      // I/O banked out; $D400,x between $D300,x and $D500,x, or a store
      // to $01 just before, is that loop and not a SID read.
      const near = lines.slice(Math.max(0, i - 6), i + 7).join("\n");
      if (/\b(lda|ldx|ldy)\s+(\$d[35]00|0xd[35]00)\s*,\s*[xy]\b/i.test(near)) return;
      if (/\bst[axy]\s+(\$0?1|0x0?1|1)\b(?!\d)/i.test(lines.slice(Math.max(0, i - 6), i).join("\n"))) return;
    }
    findings.push({
      rule: "sid_write_only_registers",
      pitfall: "sid_write_only_registers",
      line: i + 1,
      excerpt: excerptOf(rawLines, i),
      message: `${m[1].toUpperCase()} on $${hex4(ea)}: all SID registers $D400-$D418 are write-only, and a read returns the last byte the chip held, not the register's value. Keep a shadow copy in RAM and store the shadow.${indexed ? " Likely rather than definite: the index may carry the effective location past $D418, or $01 may have I/O banked out, in which case this reads character ROM or RAM." : ""}`,
      page: PAGES.sid,
      certainty: indexed ? "likely" : "definite",
    });
  });

  // cia1_ddr_cleared_kills_keyboard: lda #0 ... sta $dc02 with no later lda #$ff ... sta $dc02.
  const ddrStores: { line: number; value: number | null }[] = [];
  lines.forEach((line, i) => {
    const st = new RegExp(String.raw`^\s*${LABEL}st([axy])\s+(\$dc02|0xdc02|56322)\b`, "i").exec(line);
    if (!st) return;
    const reg = st[1].toLowerCase();
    let value: number | null = null;
    for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
      const ld = new RegExp(String.raw`^\s*${LABEL}ld${reg}\s+#\s*([^\s,]+)`, "i").exec(lines[j]);
      if (ld) {
        value = parseNumber(ld[1]);
        break;
      }
      if (new RegExp(`\\b(ld${reg}|t[axy]${reg}|pl${reg}|in${reg}|de${reg})\\b`, "i").test(lines[j])) break;
    }
    ddrStores.push({ line: i, value });
  });
  ddrStores.forEach((s, k) => {
    if (s.value !== 0) return;
    const restored = ddrStores.slice(k + 1).some((t) => t.value === 0xff);
    if (restored) return;
    findings.push({
      rule: "cia1_ddr_cleared_kills_keyboard",
      pitfall: "cia1_ddr_cleared_kills_keyboard",
      line: s.line + 1,
      excerpt: excerptOf(rawLines, s.line),
      message:
        "Store of 0 to $DC02 with no later store of $FF to it in this file. Clearing $DC02 turns every keyboard column line into an input; SCNKEY's column writes then drive nothing and no key does anything until something writes $FF back. Leave the DDR as IOINIT set it and read $DC00 directly for joystick 2.",
      page: PAGES.ddr,
      certainty: "definite",
    });
  });

  // empty-name OPEN of SA 15 then CHKIN/CHRIN: SETNAM with length 0, OPEN with SA 15, then a read.
  {
    let lastSetnamLen: number | null = null;
    let lastSetnamLine = -1;
    let lastSetlfsSa: number | null = null;
    let open15Line = -1;
    lines.forEach((line, i) => {
      if (/\bjsr\s+(\$ffbd|setnam)\b/i.test(line)) {
        lastSetnamLen = null;
        for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
          const ld = new RegExp(String.raw`^\s*${LABEL}lda\s+#\s*([^\s,]+)`, "i").exec(lines[j]);
          if (ld) {
            lastSetnamLen = parseNumber(ld[1]);
            break;
          }
        }
        lastSetnamLine = i;
      }
      if (/\bjsr\s+(\$ffba|setlfs)\b/i.test(line)) {
        lastSetlfsSa = null;
        for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
          const ld = new RegExp(String.raw`^\s*${LABEL}ldy\s+#\s*([^\s,]+)`, "i").exec(lines[j]);
          if (ld) {
            lastSetlfsSa = parseNumber(ld[1]);
            break;
          }
        }
      }
      if (/\bjsr\s+(\$ffc0|open)\b/i.test(line)) {
        open15Line = lastSetnamLen === 0 && lastSetlfsSa === 15 ? i : -1;
      }
      if (open15Line >= 0 && /\bjsr\s+(\$ffc6|chkin|\$ffcf|chrin)\b/i.test(line)) {
        findings.push({
          rule: "empty_name_open_15_hangs_on_read",
          pitfall: "empty_name_open_15_hangs_on_read",
          line: open15Line + 1,
          excerpt: excerptOf(rawLines, open15Line),
          message: `OPEN of secondary address 15 after a SETNAM of length 0 (line ${lastSetnamLine + 1}) and then a read on it (line ${i + 1}). ${OPEN15_MECHANISM}`,
          page: PAGES.open15,
          certainty: "heuristic",
        });
        open15Line = -1;
      }
    });
  }

  // Raster poll with the KERNAL IRQ live.
  const installsIrq = /\$0314|\$0318|\$fffe|\$fffa|\bsei\b/i.test(src);
  if (!installsIrq) {
    lines.forEach((line, i) => {
      if (!/\b(lda|cmp|ldx|ldy|cpx|cpy|bit)\s+(\$d012|0xd012|53266)\b/i.test(line)) return;
      const window = lines.slice(i, i + 4).join("\n");
      if (!/\b(bne|beq|bcc|bcs|bpl|bmi)\b/i.test(window)) return;
      findings.push({
        rule: "raster_poll_with_kernal_irq_live",
        pitfall: "raster_irq_first_line_jitter",
        line: i + 1,
        excerpt: excerptOf(rawLines, i),
        message:
          "Busy-wait on $D012 in a file that never installs an interrupt (no $0314, $FFFE or SEI). The KERNAL jiffy interrupt is still live, so the poll can be pre-empted across the line it waits for and the loop's entry point moves by whole lines from frame to frame. Either take the interrupt (SEI, or a handler on $0314) or have a raster interrupt own a tick byte the loop waits on. Heuristic: the interrupt may be installed in another file.",
        page: PAGES.rasterPoll,
        certainty: "heuristic",
      });
    });
  }

  // lfsr_zero_state_lockup: a seed label defined as zero.
  lines.forEach((line, i) => {
    const def =
      /^\s*(\w*(?:seed|lfsr|rng)\w*):?\s+(?:\.byte|\.word|!byte|!word|byte|word|dc\.b|dc\.w|db|dw)\s+([^\s,]+)\s*$/i.exec(
        line,
      );
    if (!def || !isZero(def[2])) return;
    const shifted = new RegExp(`\\b(lsr|asl|ror|rol|eor)\\s+${def[1]}\\b`, "i").test(src);
    if (shifted) {
      findings.push({
        rule: "lfsr_zero_state_lockup",
        pitfall: "lfsr_zero_state_lockup",
        line: i + 1,
        excerpt: excerptOf(rawLines, i),
        message: `${def[1]} is defined as zero. An LFSR seeded with zero outputs zero for ever: from state zero the bit that falls out is 0, nothing is XORed in, and the state is zero again. Test the seed before the first step and replace zero with a non-zero constant.`,
        page: PAGES.lfsr,
        certainty: "likely",
      });
    }
  });

  // decimal_mode_in_irq_handler: a handler whose body reaches ADC or SBC
  // before any CLD. A handler is a label stored to $0314/$0315 or
  // $FFFE/$FFFF (as #<name / #>name near the store), or named in a
  // .word/!word after `* = $fffe` or `* = $0314`.
  {
    const handlers = new Map<string, number>();
    const VEC =
      /(\$0314|\$0315|\$fffe|\$ffff|0x0314|0x0315|0xfffe|0xffff|\b788|\b789|\b65534|\b65535)(?![0-9a-f])/i;
    lines.forEach((line, i) => {
      if (new RegExp(String.raw`^\s*${LABEL}st[axy]\s+`, "i").test(line) && VEC.test(line)) {
        for (let j = i; j >= Math.max(0, i - 4); j--) {
          const m = /#\s*[<>]\s*([A-Za-z_.@][\w.@]*)/.exec(lines[j]);
          if (m && !handlers.has(m[1])) handlers.set(m[1], j);
        }
      }
      const w = /^\s*(?:\.word|!word|\.wo|dc\.w|dw)\s+([A-Za-z_.@][\w.@]*)\b/i.exec(line);
      if (w && VEC.test(lines.slice(Math.max(0, i - 3), i).join("\n"))) handlers.set(w[1], i);
    });
    const fileSetsD = new RegExp(String.raw`^\s*${LABEL}sed\b`, "im").test(src);
    for (const [name, installLine] of handlers) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const defRe = new RegExp(String.raw`^\s*${esc}\s*:`, "i");
      const start = lines.findIndex((l) => defRe.test(l));
      if (start < 0) continue;
      for (let j = start; j < lines.length; j++) {
        const l = lines[j];
        if (
          j > start &&
          /^\s*[A-Za-z_.@][\w.@]*\s*:/.test(l) &&
          [...handlers.keys()].some(
            (h) =>
              h !== name &&
              new RegExp(String.raw`^\s*${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s*:`, "i").test(l),
          )
        )
          break;
        if (new RegExp(String.raw`^\s*${LABEL}cld\b`, "i").test(l)) break;
        if (new RegExp(String.raw`^\s*${LABEL}(rti|rts)\b`, "i").test(l)) break;
        if (new RegExp(String.raw`^\s*${LABEL}jmp\s+(\$ea31|\$ea7e|\$ea81|\$febc)\b`, "i").test(l)) break;
        if (new RegExp(String.raw`^\s*${LABEL}(adc|sbc)\b`, "i").test(l)) {
          findings.push({
            rule: "decimal_mode_in_irq_handler",
            pitfall: "decimal_mode_in_irq_handler",
            line: j + 1,
            excerpt: excerptOf(rawLines, j),
            message: `${
              l
                .trim()
                .split(/\s+/)
                .find((t) => /^(adc|sbc)$/i.test(t))
                ?.toUpperCase() ?? "ADC"
            } in the handler ${name} (installed at line ${installLine + 1}) before any CLD. The D flag is not automatically cleared or saved on IRQ entry: the handler runs with D still set if the interrupted code had executed SED and not yet executed CLD, and its ADC and SBC then produce BCD-adjusted results instead of binary. Every IRQ handler must execute CLD as part of its entry stanza, before any arithmetic. RTI restores P from the stack, including D, so no SED is needed on the way out.${fileSetsD ? " Likely rather than definite: a CLD inside a macro or a called routine is not seen." : " Heuristic: nothing in this file executes SED, so D is clear unless a routine outside it sets D; the page still calls the CLD mandatory."}`,
            page: PAGES.decimal,
            certainty: fileSetsD ? "likely" : "heuristic",
          });
          break;
        }
      }
    }
  }

  // d016_unmasked_rmw_clobbers_csel_mcm: STA $D016 with no LDA $D016 / AND in the preceding lines.
  lines.forEach((line, i) => {
    if (!new RegExp(String.raw`^\s*${LABEL}sta\s+(\$d016|0xd016|53270)\b`, "i").test(line)) return;
    // Walk back from the store to the instruction that loaded A. A read
    // of $D016 or an AND on the way is a masked write; an immediate with
    // bit 3 set carries CSEL; anything else is unknown and reported.
    let literal: number | null = null;
    let masked = false;
    for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
      const l = lines[j];
      if (/\b(lda|ldx|ldy)\s+(\$d016|0xd016|53270)\b/i.test(l) || /\band\s+#/i.test(l)) {
        masked = true;
        break;
      }
      const imm = new RegExp(String.raw`^\s*${LABEL}lda\s+#\s*([^\s,]+)\s*$`, "i").exec(l);
      if (imm) {
        literal = parseNumber(imm[1]);
        break;
      }
      if (
        new RegExp(
          String.raw`^\s*${LABEL}(lda|pla|txa|tya|jsr|jmp|rts|rti|b(?:ne|eq|cc|cs|pl|mi|vc|vs))\b`,
          "i",
        ).test(l)
      )
        break;
    }
    if (masked) return;
    if (literal !== null && (literal & 0x08) !== 0) return;
    findings.push({
      rule: "d016_unmasked_rmw_clobbers_csel_mcm",
      pitfall: "d016_unmasked_rmw_clobbers_csel_mcm",
      line: i + 1,
      excerpt: excerptOf(rawLines, i),
      message:
        "STA $D016 with no read of $D016 and no AND mask before it: the naive store zeroes CSEL and MCM along with bits 5-7, switching to 38 columns and hires. Use `lda $d016 / and #$f8 / ora xscroll / sta $d016`, or a shadow that carries CSEL and MCM. Heuristic: the value may come from such a shadow.",
      page: PAGES.d016,
      certainty: "heuristic",
    });
  });

  // jmp_indirect_page_boundary_bug
  lines.forEach((line, i) => {
    const m = new RegExp(
      String.raw`^\s*${LABEL}jmp\s*\(\s*(\$[0-9a-f]{1,4}|0x[0-9a-f]{1,4}|[0-9]{1,5})\s*\)`,
      "i",
    ).exec(line);
    if (!m) return;
    const vec = parseNumber(m[1]);
    if (vec === null || (vec & 0xff) !== 0xff) return;
    findings.push({
      rule: "jmp_indirect_page_boundary_bug",
      pitfall: "jmp_indirect_page_boundary_bug",
      line: i + 1,
      excerpt: excerptOf(rawLines, i),
      message: `JMP ($${hex4(vec)}): the 6510 fetches the high byte of the destination from $${hex4(vec & 0xff00)}, not $${hex4((vec + 1) & 0xffff)}. The low byte of the pointer wraps within the page. Move the vector so its low-byte slot does not end in $FF.`,
      page: PAGES.jmp,
      certainty: "definite",
    });
  });
}

// ------------------------------------------------------------------ entry

export function lintSource(source: string, opts: LintOptions = { language: "auto" }): LintFinding[] {
  const language: LintLanguage = opts.language === "auto" ? detectLanguage(source) : opts.language;
  const findings: LintFinding[] = [];
  if (language === "c") lintC(source, findings);
  else lintAsm(source, findings);
  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

const CERTAINTY_ORDER: LintCertainty[] = ["definite", "likely", "heuristic"];

export function summarise(findings: LintFinding[]): string {
  if (findings.length === 0) return "No findings.";
  const counts = CERTAINTY_ORDER.map((c) => [c, findings.filter((f) => f.certainty === c).length] as const)
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `${n} ${c}`)
    .join(", ");
  const rules = [...new Set(findings.map((f) => f.rule))];
  return `${findings.length} finding${findings.length === 1 ? "" : "s"} (${counts}) across ${rules.length} rule${rules.length === 1 ? "" : "s"}: ${rules.join(", ")}.`;
}

export function lintSourceResult(
  source: string,
  opts: LintOptions = { language: "auto" },
  label?: string,
): LintResult {
  const language: LintLanguage = opts.language === "auto" ? detectLanguage(source) : opts.language;
  const findings = lintSource(source, { ...opts, language });
  const summary = summarise(findings);
  const lines: string[] = [];
  lines.push(`# Lint${label ? `: ${label}` : ""} (${language})`);
  lines.push("");
  lines.push(summary);
  for (const f of findings) {
    lines.push("");
    lines.push(`## line ${f.line}: ${f.rule} [${f.certainty}]`);
    lines.push("");
    lines.push("    " + f.excerpt);
    lines.push("");
    lines.push(f.message);
    lines.push(`Page: ${f.page}`);
  }
  return {
    structured: { language, toolchain: opts.toolchain, findings, summary },
    text: lines.join("\n"),
  };
}
