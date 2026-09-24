/** The lint rules for C (Oscar64, cc65). Each function is one rule; lintC runs them in a fixed order. */

import { OPEN15_MECHANISM, PAGES, SID_READABLE, group, lineAt, report, type LintContext } from "./types.ts";
import { isZero, parseNumber, stripC } from "./text.ts";
import type { LintFinding } from "./types.ts";

const C_SID_PATH = /\bsid((?:\.\w+|\[[^\]]*\])+)/g;

const SID = {
  rule: "sid_write_only_registers",
  pitfall: "sid_write_only_registers",
  page: PAGES.sid,
} as const;

/** One `sid.field` access: a read-modify-write, a plain read, or neither (a write, sizeof, address-of). */
function sidAccess(ctx: LintContext, i: number, line: string, m: RegExpExecArray): void {
  const path = group(m, 1);
  const field = group(/\.(\w+)\s*$/.exec(path) ?? [], 1);
  if (SID_READABLE.has(field)) return;
  const after = line.slice(m.index + m[0].length);
  const before = line.slice(0, m.index);
  const rmw = /^\s*(\+\+|--|[-+*/|&^]=|<<=|>>=)/.test(after) || /(\+\+|--)\s*$/.test(before);
  const plainWrite = /^\s*=(?!=)/.test(after);
  const isSizeof = /\bsizeof\s*\(\s*$/.test(before);
  const isAddressOf = /&\s*$/.test(before);
  if (rmw) {
    report(ctx, i, {
      ...SID,
      message: `Read-modify-write of sid${path}: all SID registers $D400-$D418 are write-only, and a read returns the last byte the chip held, not the register's value. Keep a shadow copy in RAM, change the shadow, and write the shadow to the register.`,
      certainty: "definite",
    });
  } else if (!plainWrite && !isSizeof && !isAddressOf) {
    report(ctx, i, {
      ...SID,
      message: `Read of sid${path}: all SID registers $D400-$D418 are write-only; reads return the last byte the chip held. Only $D419-$D41C (potx, poty, random, env3) read back anything meaningful. Read your shadow copy instead.`,
      certainty: "definite",
    });
  }
}

/** sid_write_only_registers: read or read-modify-write of a write-only field. */
function sidWriteOnly(ctx: LintContext): void {
  ctx.lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return; // preprocessor: `#include <c64/sid.h>` is not a read
    C_SID_PATH.lastIndex = 0;
    for (let m = C_SID_PATH.exec(line); m !== null; m = C_SID_PATH.exec(line)) sidAccess(ctx, i, line, m);
    // Raw pointer form: *(volatile char*)0xD404 |= ...
    if (/0x[dD]4(?:0[0-9a-fA-F]|1[0-8])\b[^;=]*?(\+\+|--|[-+*/|&^]=|<<=|>>=)/.test(line)) {
      report(ctx, i, {
        ...SID,
        message:
          "Read-modify-write through a pointer into $D400-$D418: these registers are write-only, and a read returns the last byte the chip held. Keep a shadow copy and write the shadow.",
        certainty: "definite",
      });
    }
  });
}

/** cia1_ddr_cleared_kills_keyboard: cia1.ddra = 0 with no later write of 0xFF. */
function ddrCleared(ctx: LintContext): void {
  const ddrZero: number[] = [];
  let ddrRestore = -1;
  ctx.lines.forEach((line, i) => {
    const m =
      /\bcia1\s*\.\s*ddra\s*=(?!=)\s*([^;]+);/.exec(line) ??
      /\*\s*\(\s*(?:volatile\s+)?(?:unsigned\s+)?(?:char|byte)\s*\*\s*\)\s*0x[dD][cC]02\s*=(?!=)\s*([^;]+);/.exec(
        line,
      );
    if (!m) return;
    const v = group(m, 1).trim();
    if (isZero(v)) ddrZero.push(i);
    else if (parseNumber(v) === 0xff) ddrRestore = i;
  });
  for (const i of ddrZero) {
    if (ddrRestore > i) continue;
    report(ctx, i, {
      rule: "cia1_ddr_cleared_kills_keyboard",
      pitfall: "cia1_ddr_cleared_kills_keyboard",
      message:
        "Clearing $DC02 (cia1.ddra) turns every keyboard column line into an input; SCNKEY's column writes then drive nothing and no key does anything until something writes $FF back. Nothing later in this file does. Leave the DDR as IOINIT set it ($DC02 = $FF) and read $DC00 directly for joystick 2.",
      page: PAGES.ddr,
      certainty: "definite",
    });
  }
}

/** The nearest krnio_setnam within 12 lines above `i`: whether there was one and whether its name is empty. */
function setnamBefore(lines: string[], i: number): { sawSetnam: boolean; emptyName: boolean } {
  for (let j = i; j >= Math.max(0, i - 12); j--) {
    const s = /\bkrnio_setnam(_n)?\s*\(([^)]*)\)/.exec(lineAt(lines, j));
    if (!s) continue;
    const args = group(s, 2);
    if (group(s, 1) === "_n") return { sawSetnam: true, emptyName: isZero(args.split(",").pop() ?? "") };
    return { sawSetnam: true, emptyName: /^\s*""\s*$/.test(args) };
  }
  return { sawSetnam: false, emptyName: false };
}

/** The first read on file number `fnum` within 20 lines of `i`, stopping at its close; -1 if none. */
function readAfter(lines: string[], i: number, fnum: string): number {
  const read = new RegExp(`\\bkrnio_(gets|read|getch|chkin|read_lzo)\\s*\\(\\s*${fnum}\\b`);
  const close = new RegExp(`\\bkrnio_close\\s*\\(\\s*${fnum}\\b`);
  for (let j = i; j < Math.min(lines.length, i + 20); j++) {
    const l = lineAt(lines, j);
    if (read.test(l)) return j;
    if (close.test(l)) return -1;
  }
  return -1;
}

/** empty-name OPEN of channel 15 followed by a read. */
function open15(ctx: LintContext): void {
  ctx.lines.forEach((line, i) => {
    const m = /\bkrnio_open\s*\(\s*(\w+)\s*,\s*\w+\s*,\s*15\s*\)/.exec(line);
    if (!m) return;
    const { sawSetnam, emptyName } = setnamBefore(ctx.lines, i);
    if (sawSetnam && !emptyName) return;
    const readLine = readAfter(ctx.lines, i, group(m, 1));
    if (readLine < 0) return;
    report(ctx, i, {
      rule: "empty_name_open_15_hangs_on_read",
      pitfall: "empty_name_open_15_hangs_on_read",
      message: `OPEN of channel 15 with ${sawSetnam ? "an empty name" : "no name set"} and then a read on it (line ${readLine + 1}). ${OPEN15_MECHANISM}`,
      page: PAGES.open15,
      certainty: "heuristic",
    });
  });
}

function isRasterPoll(line: string): boolean {
  return (
    /\b(while|for|do)\b[^;{]*\bvic\s*\.\s*raster\b/.test(line) ||
    /\b(while|for)\b[^;{]*0x[dD]012\b/.test(line) ||
    /\bvic_waitLine\s*\(/.test(line) ||
    /\bvic_waitBottom\s*\(/.test(line)
  );
}

/** Raster poll with the KERNAL IRQ live. */
function rasterPoll(ctx: LintContext): void {
  const installsIrq =
    /\brirq_\w+|__interrupt|0x0314\b|0x0318\b|0xfffe\b|\$0314|\$fffe|\bsei\b|rasterirq\.h/i.test(ctx.src);
  if (installsIrq) return;
  ctx.lines.forEach((line, i) => {
    if (!isRasterPoll(line)) return;
    report(ctx, i, {
      rule: "raster_poll_with_kernal_irq_live",
      pitfall: "raster_irq_first_line_jitter",
      message:
        "Busy-wait on vic.raster ($D012) in a file that never installs an interrupt (no rirq_*, __interrupt, $0314, $FFFE or SEI). The KERNAL jiffy interrupt is still live, so the poll can be pre-empted across the line it waits for and the loop's entry point moves by whole lines from frame to frame; a poll for one exact value can miss it and wait a frame. The frame-sync-loop recipe has the interrupt own one tick byte and the main loop wait for the tick. Heuristic: the interrupt may be installed in another file.",
      page: PAGES.rasterPoll,
      certainty: "heuristic",
    });
  });
}

/** lfsr_zero_state_lockup: a seed constant of 0. */
function lfsrZero(ctx: LintContext): void {
  ctx.lines.forEach((line, i) => {
    const m =
      /\b(?:(?:static|unsigned|char|int|short|long|volatile|const|byte|word)\s+)*(\w*(?:seed|lfsr|rng|rand_state|random_state)\w*)\s*=(?!=)\s*(0x0+|0)\s*[;,]/i.exec(
        line,
      );
    if (!m) return;
    const name = group(m, 1);
    // Only a name the file shifts or XORs is an LFSR state; a counter
    // or flag that happens to contain "seed" or "rng" is not.
    const shifted = new RegExp(`(\\b${name}\\s*(>>=?|<<=?|\\^=?)|(>>|<<|\\^)\\s*${name}\\b)`).test(ctx.src);
    if (!shifted) return;
    const checked = new RegExp(`(!\\s*${name}\\b|\\b${name}\\s*==\\s*0\\b|\\b${name}\\s*\\|\\|)`).test(
      ctx.src,
    );
    if (checked) return;
    report(ctx, i, {
      rule: "lfsr_zero_state_lockup",
      pitfall: "lfsr_zero_state_lockup",
      message: `${name} is set to zero and nothing in this file tests it for zero. An LFSR seeded with zero outputs zero for ever: from state zero the bit that falls out is 0, nothing is XORed in, and the state is zero again. Test the seed before the first step and replace zero with a non-zero constant.`,
      page: PAGES.lfsr,
      certainty: "likely",
    });
  });
}

/**
 * Whether the right-hand side of a vic.ctrl2 store keeps CSEL: a masked
 * read, a value with bit 3 set, or a name that says it holds the whole
 * register (D016_PLAY, ctrl2_shadow). The named form was reported until
 * #41, in the starters' deliberate `vic.ctrl2 = D016_PLAY | 7`.
 */
function keepsCsel(rhs: string): boolean {
  if (/\bvic\s*\.\s*ctrl2\b/.test(rhs) || rhs.includes("&")) return true;
  if (/(d016|ctrl2|shadow)/i.test(rhs)) return true;
  const lit = parseNumber(rhs);
  if (lit !== null && (lit & 0x08) !== 0) return true;
  return /\b0x[cC]8\b|\b0x[dD]8\b|\b0x18\b|\b0x08\b|\bVIC_CTRL2_CSEL\b|\bVIC_CTRL2_MCM\b/.test(rhs);
}

/** d016_unmasked_rmw_clobbers_csel_mcm: a store to vic.ctrl2 not derived from a masked read. */
function d016Unmasked(ctx: LintContext): void {
  ctx.lines.forEach((line, i) => {
    const m =
      /\bvic\s*\.\s*ctrl2\s*=(?!=)\s*([^;]+);/.exec(line) ?? /0x[dD]016\b[^;=]*=(?!=)\s*([^;]+);/.exec(line);
    if (!m || keepsCsel(group(m, 1).trim())) return;
    report(ctx, i, {
      rule: "d016_unmasked_rmw_clobbers_csel_mcm",
      pitfall: "d016_unmasked_rmw_clobbers_csel_mcm",
      message:
        "Store to vic.ctrl2 ($D016) of a value not derived from a masked read: the naive `vic.ctrl2 = xscroll` zeroes CSEL and MCM along with bits 5-7, switching to 38 columns and hires. Write `vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll`, or a shadow that carries CSEL and MCM. Heuristic: a shadow not named for the register (d016, ctrl2, shadow) is reported too.",
      page: PAGES.d016,
      certainty: "heuristic",
    });
  });
}

// decimal_mode_in_irq_handler has no C form. The pitfall is a handler
// whose entry does not CLD before its first ADC or SBC; in C the
// arithmetic is the compiler's and whether the prologue clears D is a
// property of the toolchain, not of the text, so there is nothing to
// match. The asm form is in asm-rules.ts.

export function lintC(raw: string, findings: LintFinding[]): void {
  const src = stripC(raw);
  const ctx: LintContext = { src, lines: src.split("\n"), rawLines: raw.split("\n"), findings };
  sidWriteOnly(ctx);
  ddrCleared(ctx);
  open15(ctx);
  rasterPoll(ctx);
  lfsrZero(ctx);
  d016Unmasked(ctx);
}
