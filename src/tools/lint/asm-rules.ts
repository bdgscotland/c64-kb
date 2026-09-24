/** The lint rules for 6502 assembly. Each function is one rule; lintAsm runs them in a fixed order. */

import { decimalModeInIrq } from "./asm-decimal.ts";
import { LABEL } from "./asm-shared.ts";
import { hex4, isZero, parseNumber, stripAsm } from "./text.ts";
import {
  OPEN15_MECHANISM,
  PAGES,
  group,
  lineAt,
  report,
  type LintContext,
  type LintFinding,
} from "./types.ts";

const ASM_SID_OPS = new RegExp(
  String.raw`^\s*${LABEL}(inc|dec|asl|lsr|rol|ror|lda|ldx|ldy|bit|cmp|adc|sbc|and|ora|eor)\s+(\$[0-9a-f]{4}|0x[0-9a-f]{4}|[0-9]{4,5})\s*(,\s*[xy])?\s*$`,
  "i",
);

/**
 * A page-by-page copy of the character ROM reads $D000-$DFFF with I/O
 * banked out; $D400,x between $D300,x and $D500,x, or a store to $01 just
 * before, is that loop and not a SID read.
 */
function isCharRomCopy(lines: string[], i: number): boolean {
  const near = lines.slice(Math.max(0, i - 6), i + 7).join("\n");
  if (/\b(lda|ldx|ldy)\s+(\$d[35]00|0xd[35]00)\s*,\s*[xy]\b/i.test(near)) return true;
  return /\bst[axy]\s+(\$0?1|0x0?1|1)\b(?!\d)/i.test(lines.slice(Math.max(0, i - 6), i).join("\n"));
}

/** sid_write_only_registers */
function sidWriteOnly(ctx: LintContext): void {
  ctx.lines.forEach((line, i) => {
    const m = ASM_SID_OPS.exec(line);
    if (!m) return;
    const ea = parseNumber(group(m, 2));
    if (ea === null || ea < 0xd400 || ea > 0xd418) return;
    const indexed = Boolean(group(m, 3));
    if (indexed && isCharRomCopy(ctx.lines, i)) return;
    report(ctx, i, {
      rule: "sid_write_only_registers",
      pitfall: "sid_write_only_registers",
      message: `${group(m, 1).toUpperCase()} on $${hex4(ea)}: all SID registers $D400-$D418 are write-only, and a read returns the last byte the chip held, not the register's value. Keep a shadow copy in RAM and store the shadow.${indexed ? " Likely rather than definite: the index may carry the effective location past $D418, or $01 may have I/O banked out, in which case this reads character ROM or RAM." : ""}`,
      page: PAGES.sid,
      certainty: indexed ? "likely" : "definite",
    });
  });
}

/** The immediate loaded into `reg` just before the store at line `i`, or null if the register was otherwise changed or not loaded. */
function immediateStored(lines: string[], i: number, reg: string): number | null {
  const load = new RegExp(String.raw`^\s*${LABEL}ld${reg}\s+#\s*([^\s,]+)`, "i");
  const clobber = new RegExp(`\\b(ld${reg}|t[axy]${reg}|pl${reg}|in${reg}|de${reg})\\b`, "i");
  for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
    const l = lineAt(lines, j);
    const ld = load.exec(l);
    if (ld) return parseNumber(group(ld, 1));
    if (clobber.test(l)) return null;
  }
  return null;
}

/** cia1_ddr_cleared_kills_keyboard: lda #0 ... sta $dc02 with no later lda #$ff ... sta $dc02. */
function ddrCleared(ctx: LintContext): void {
  const ddrStores: { line: number; value: number | null }[] = [];
  const store = new RegExp(String.raw`^\s*${LABEL}st([axy])\s+(\$dc02|0xdc02|56322)\b`, "i");
  ctx.lines.forEach((line, i) => {
    const st = store.exec(line);
    if (!st) return;
    ddrStores.push({ line: i, value: immediateStored(ctx.lines, i, group(st, 1).toLowerCase()) });
  });
  ddrStores.forEach((s, k) => {
    if (s.value !== 0) return;
    if (ddrStores.slice(k + 1).some((t) => t.value === 0xff)) return;
    report(ctx, s.line, {
      rule: "cia1_ddr_cleared_kills_keyboard",
      pitfall: "cia1_ddr_cleared_kills_keyboard",
      message:
        "Store of 0 to $DC02 with no later store of $FF to it in this file. Clearing $DC02 turns every keyboard column line into an input; SCNKEY's column writes then drive nothing and no key does anything until something writes $FF back. Leave the DDR as IOINIT set it and read $DC00 directly for joystick 2.",
      page: PAGES.ddr,
      certainty: "definite",
    });
  });
}

/** The immediate loaded by `op` (lda, ldy) within six lines above line `i`, or null. */
function immediateBefore(lines: string[], i: number, op: string): number | null {
  const load = new RegExp(String.raw`^\s*${LABEL}${op}\s+#\s*([^\s,]+)`, "i");
  for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
    const ld = load.exec(lineAt(lines, j));
    if (ld) return parseNumber(group(ld, 1));
  }
  return null;
}

/** empty-name OPEN of SA 15 then CHKIN/CHRIN: SETNAM with length 0, OPEN with SA 15, then a read. */
function open15(ctx: LintContext): void {
  const st: { setnamLen: number | null; setnamLine: number; setlfsSa: number | null; openLine: number } = {
    setnamLen: null,
    setnamLine: -1,
    setlfsSa: null,
    openLine: -1,
  };
  ctx.lines.forEach((line, i) => {
    if (/\bjsr\s+(\$ffbd|setnam)\b/i.test(line)) {
      st.setnamLen = immediateBefore(ctx.lines, i, "lda");
      st.setnamLine = i;
    }
    if (/\bjsr\s+(\$ffba|setlfs)\b/i.test(line)) st.setlfsSa = immediateBefore(ctx.lines, i, "ldy");
    if (/\bjsr\s+(\$ffc0|open)\b/i.test(line))
      st.openLine = st.setnamLen === 0 && st.setlfsSa === 15 ? i : -1;
    if (st.openLine < 0 || !/\bjsr\s+(\$ffc6|chkin|\$ffcf|chrin)\b/i.test(line)) return;
    report(ctx, st.openLine, {
      rule: "empty_name_open_15_hangs_on_read",
      pitfall: "empty_name_open_15_hangs_on_read",
      message: `OPEN of secondary address 15 after a SETNAM of length 0 (line ${st.setnamLine + 1}) and then a read on it (line ${i + 1}). ${OPEN15_MECHANISM}`,
      page: PAGES.open15,
      certainty: "heuristic",
    });
    st.openLine = -1;
  });
}

// Interrupt handler code: an acknowledge of the VIC interrupt, or RTI. A
// file with it runs under an interrupt installed somewhere, maybe in the
// file that imports it (shmup-vertical's mux.asm, imported by kernel.asm).
const HANDLER_CODE = /\b(sta|stx|sty|inc|dec|asl|lsr)\s+\$d019\b|\brti\b/i;
const BRANCH = /\b(?:bne|beq|bcc|bcs|bpl|bmi)\s+(\S+)/i;

/**
 * A busy-wait: a branch within three lines of the $D012 read that goes
 * back to it (`*-n`, an anonymous backward label, or a label on the read
 * line or the two before it). A forward branch is a test, not a wait:
 * mux.asm's `cmp $d012 / bcs on_time` asks whether the line has passed.
 */
function branchesBack(lines: string[], i: number): boolean {
  for (let k = i; k < Math.min(lines.length, i + 4); k++) {
    const target = BRANCH.exec(lineAt(lines, k))?.[1];
    if (target === undefined) continue;
    if (/^\*\s*-|^!?-+$/.test(target)) return true;
    const name = target.replace(/[.$^*+?()[\]{}|\\]/g, "\\$&");
    const def = new RegExp(String.raw`^\s*${name}:?(\s|$)`, "i");
    for (let j = Math.max(0, i - 2); j <= k; j++) if (def.test(lineAt(lines, j))) return true;
  }
  return false;
}

/** Raster poll with the KERNAL IRQ live. */
function rasterPoll(ctx: LintContext): void {
  if (/\$0314|\$0318|\$fffe|\$fffa|\bsei\b/i.test(ctx.src) || HANDLER_CODE.test(ctx.src)) return;
  ctx.lines.forEach((line, i) => {
    if (!/\b(lda|cmp|ldx|ldy|cpx|cpy|bit)\s+(\$d012|0xd012|53266)\b/i.test(line)) return;
    if (!branchesBack(ctx.lines, i)) return;
    report(ctx, i, {
      rule: "raster_poll_with_kernal_irq_live",
      pitfall: "raster_irq_first_line_jitter",
      message:
        "Busy-wait on $D012 in a file that never installs an interrupt and holds no handler code (no $0314, $FFFE, SEI, $D019 acknowledge or RTI). The KERNAL jiffy interrupt is still live, so the poll can be pre-empted across the line it waits for and the loop's entry point moves by whole lines from frame to frame. Either take the interrupt (SEI, or a handler on $0314) or have a raster interrupt own a tick byte the loop waits on. Heuristic: the interrupt may be installed in another file.",
      page: PAGES.rasterPoll,
      certainty: "heuristic",
    });
  });
}

/** lfsr_zero_state_lockup: a seed label defined as zero. */
function lfsrZero(ctx: LintContext): void {
  ctx.lines.forEach((line, i) => {
    const def =
      /^\s*(\w*(?:seed|lfsr|rng)\w*):?\s+(?:\.byte|\.word|!byte|!word|byte|word|dc\.b|dc\.w|db|dw)\s+([^\s,]+)\s*$/i.exec(
        line,
      );
    if (!def || !isZero(group(def, 2))) return;
    const name = group(def, 1);
    if (!new RegExp(`\\b(lsr|asl|ror|rol|eor)\\s+${name}\\b`, "i").test(ctx.src)) return;
    report(ctx, i, {
      rule: "lfsr_zero_state_lockup",
      pitfall: "lfsr_zero_state_lockup",
      message: `${name} is defined as zero. An LFSR seeded with zero outputs zero for ever: from state zero the bit that falls out is 0, nothing is XORed in, and the state is zero again. Test the seed before the first step and replace zero with a non-zero constant.`,
      page: PAGES.lfsr,
      certainty: "likely",
    });
  });
}

const D016_LOAD_ENDS = new RegExp(
  String.raw`^\s*${LABEL}(lda|pla|txa|tya|jsr|jmp|rts|rti|b(?:ne|eq|cc|cs|pl|mi|vc|vs))\b`,
  "i",
);
const D016_IMMEDIATE = new RegExp(String.raw`^\s*${LABEL}lda\s+#\s*([^\s,]+)\s*$`, "i");

/**
 * Walk back from a $D016 store to the instruction that loaded A. A read
 * of $D016 or an AND on the way is a masked write; an immediate with bit 3
 * set carries CSEL; anything else is unknown and reported.
 */
function d016StoreKeepsCsel(lines: string[], i: number): boolean {
  for (let j = i - 1; j >= Math.max(0, i - 12); j--) {
    const l = lineAt(lines, j);
    if (/\b(lda|ldx|ldy)\s+(\$d016|0xd016|53270)\b/i.test(l) || /\band\s+#/i.test(l)) return true;
    const imm = D016_IMMEDIATE.exec(l);
    if (imm) {
      const literal = parseNumber(group(imm, 1));
      return literal !== null && (literal & 0x08) !== 0;
    }
    if (D016_LOAD_ENDS.test(l)) return false;
  }
  return false;
}

/** d016_unmasked_rmw_clobbers_csel_mcm: STA $D016 with no LDA $D016 / AND in the preceding lines. */
function d016Unmasked(ctx: LintContext): void {
  const store = new RegExp(String.raw`^\s*${LABEL}sta\s+(\$d016|0xd016|53270)\b`, "i");
  ctx.lines.forEach((line, i) => {
    if (!store.test(line) || d016StoreKeepsCsel(ctx.lines, i)) return;
    report(ctx, i, {
      rule: "d016_unmasked_rmw_clobbers_csel_mcm",
      pitfall: "d016_unmasked_rmw_clobbers_csel_mcm",
      message:
        "STA $D016 with no read of $D016 and no AND mask before it: the naive store zeroes CSEL and MCM along with bits 5-7, switching to 38 columns and hires. Use `lda $d016 / and #$f8 / ora xscroll / sta $d016`, or a shadow that carries CSEL and MCM. Heuristic: the value may come from such a shadow.",
      page: PAGES.d016,
      certainty: "heuristic",
    });
  });
}

/** jmp_indirect_page_boundary_bug */
function jmpIndirect(ctx: LintContext): void {
  const jmp = new RegExp(
    String.raw`^\s*${LABEL}jmp\s*\(\s*(\$[0-9a-f]{1,4}|0x[0-9a-f]{1,4}|[0-9]{1,5})\s*\)`,
    "i",
  );
  ctx.lines.forEach((line, i) => {
    const m = jmp.exec(line);
    if (!m) return;
    const vec = parseNumber(group(m, 1));
    if (vec === null || (vec & 0xff) !== 0xff) return;
    report(ctx, i, {
      rule: "jmp_indirect_page_boundary_bug",
      pitfall: "jmp_indirect_page_boundary_bug",
      message: `JMP ($${hex4(vec)}): the 6510 fetches the high byte of the destination from $${hex4(vec & 0xff00)}, not $${hex4((vec + 1) & 0xffff)}. The low byte of the pointer wraps within the page. Move the vector so its low-byte slot does not end in $FF.`,
      page: PAGES.jmp,
      certainty: "definite",
    });
  });
}

export function lintAsm(raw: string, findings: LintFinding[]): void {
  const src = stripAsm(raw);
  const ctx: LintContext = { src, lines: src.split("\n"), rawLines: raw.split("\n"), findings };
  sidWriteOnly(ctx);
  ddrCleared(ctx);
  open15(ctx);
  rasterPoll(ctx);
  lfsrZero(ctx);
  decimalModeInIrq(ctx);
  d016Unmasked(ctx);
  jmpIndirect(ctx);
}
