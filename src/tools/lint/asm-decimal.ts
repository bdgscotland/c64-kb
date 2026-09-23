/**
 * decimal_mode_in_irq_handler for 6502 assembly: a handler whose body
 * reaches ADC or SBC before any CLD. A handler is a label stored to
 * $0314/$0315 or $FFFE/$FFFF (as #<name / #>name near the store), or named
 * in a .word/!word after `* = $fffe` or `* = $0314`.
 */

import { LABEL } from "./asm-shared.ts";
import { PAGES, group, lineAt, report, type LintContext } from "./types.ts";

const VEC =
  /(\$0314|\$0315|\$fffe|\$ffff|0x0314|0x0315|0xfffe|0xffff|\b788|\b789|\b65534|\b65535)(?![0-9a-f])/i;
const STORE = new RegExp(String.raw`^\s*${LABEL}st[axy]\s+`, "i");
const CLD = new RegExp(String.raw`^\s*${LABEL}cld\b`, "i");
const RETURN = new RegExp(String.raw`^\s*${LABEL}(rti|rts)\b`, "i");
const KERNAL_EXIT = new RegExp(String.raw`^\s*${LABEL}jmp\s+(\$ea31|\$ea7e|\$ea81|\$febc)\b`, "i");
const ARITH = new RegExp(String.raw`^\s*${LABEL}(adc|sbc)\b`, "i");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Handler name -> 0-based line that installs it. */
function findHandlers(lines: string[]): Map<string, number> {
  const handlers = new Map<string, number>();
  lines.forEach((line, i) => {
    if (STORE.test(line) && VEC.test(line)) {
      for (let j = i; j >= Math.max(0, i - 4); j--) {
        const m = /#\s*[<>]\s*([A-Za-z_.@][\w.@]*)/.exec(lineAt(lines, j));
        if (m && !handlers.has(group(m, 1))) handlers.set(group(m, 1), j);
      }
    }
    const w = /^\s*(?:\.word|!word|\.wo|dc\.w|dw)\s+([A-Za-z_.@][\w.@]*)\b/i.exec(line);
    if (w && VEC.test(lines.slice(Math.max(0, i - 3), i).join("\n"))) handlers.set(group(w, 1), i);
  });
  return handlers;
}

/** Whether line `l` defines another handler's label, which ends this handler's body. */
function startsOtherHandler(l: string, name: string, handlers: Map<string, number>): boolean {
  if (!/^\s*[A-Za-z_.@][\w.@]*\s*:/.test(l)) return false;
  return [...handlers.keys()].some(
    (h) => h !== name && new RegExp(String.raw`^\s*${escapeRe(h)}\s*:`, "i").test(l),
  );
}

/** The 0-based line of the first ADC/SBC in the body starting at `start`, before any CLD or exit; -1 if none. */
function firstArithBeforeCld(
  lines: string[],
  start: number,
  name: string,
  handlers: Map<string, number>,
): number {
  for (let j = start; j < lines.length; j++) {
    const l = lineAt(lines, j);
    if (j > start && startsOtherHandler(l, name, handlers)) return -1;
    if (CLD.test(l) || RETURN.test(l) || KERNAL_EXIT.test(l)) return -1;
    if (ARITH.test(l)) return j;
  }
  return -1;
}

function message(l: string, name: string, installLine: number, fileSetsD: boolean): string {
  const op =
    l
      .trim()
      .split(/\s+/)
      .find((t) => /^(adc|sbc)$/i.test(t))
      ?.toUpperCase() ?? "ADC";
  const qualifier = fileSetsD
    ? " Likely rather than definite: a CLD inside a macro or a called routine is not seen."
    : " Heuristic: nothing in this file executes SED, so D is clear unless a routine outside it sets D; the page still calls the CLD mandatory.";
  return `${op} in the handler ${name} (installed at line ${installLine + 1}) before any CLD. The D flag is not automatically cleared or saved on IRQ entry: the handler runs with D still set if the interrupted code had executed SED and not yet executed CLD, and its ADC and SBC then produce BCD-adjusted results instead of binary. Every IRQ handler must execute CLD as part of its entry stanza, before any arithmetic. RTI restores P from the stack, including D, so no SED is needed on the way out.${qualifier}`;
}

export function decimalModeInIrq(ctx: LintContext): void {
  const { lines } = ctx;
  const handlers = findHandlers(lines);
  const fileSetsD = new RegExp(String.raw`^\s*${LABEL}sed\b`, "im").test(ctx.src);
  for (const [name, installLine] of handlers) {
    const defRe = new RegExp(String.raw`^\s*${escapeRe(name)}\s*:`, "i");
    const start = lines.findIndex((l) => defRe.test(l));
    if (start < 0) continue;
    const j = firstArithBeforeCld(lines, start, name, handlers);
    if (j < 0) continue;
    report(ctx, j, {
      rule: "decimal_mode_in_irq_handler",
      pitfall: "decimal_mode_in_irq_handler",
      message: message(lineAt(lines, j), name, installLine, fileSetsD),
      page: PAGES.decimal,
      certainty: fileSetsD ? "likely" : "heuristic",
    });
  }
}
