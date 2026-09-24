/**
 * sprite_registers_persist_across_state_change, as a lint: $D015 written
 * from more than one place, with at least one of those writes merging bits
 * into what the register already holds (an ORA or AND on a read of $D015,
 * or `vic.spr_enable |= ...` in C). The pitfall's fix is that each state
 * owns the whole register and writes its own mask at entry; a merge
 * carries the previous state's sprites into the next one. Only a merge
 * of a constant is reported: a variable bit (`vic.spr_enable &= ~bit`) is
 * a per-frame cull inside one state, as lane-pursuit.md does, not a state
 * setup.
 *
 * Heuristic: a program with one state may merge on purpose, and a
 * baseline written through a pointer or a macro is invisible here.
 */

import { LABEL } from "./asm-shared.ts";
import { PAGES, lineAt, report, type LintContext } from "./types.ts";

const RULE = "d015_merged_across_states";
const PITFALL = "sprite_registers_persist_across_state_change";

function message(sites: number[]): string {
  return `$D015 is written at ${sites.length} places (lines ${sites.map((s) => s + 1).join(", ")}) and this one merges bits into what the register already holds. The VIC-II keeps every register across a state change, so a merge keeps the previous state's sprites enabled in the next. Give each state an entry routine that writes its whole mask to $D015 first (0 for a state with no sprites), then $D010, $D017, $D01B, $D01C and $D01D as explicit values, and reads $D01E and $D01F once to clear the latches. Heuristic: a single-state program may merge on purpose.`;
}

const ASM_ADDR = String.raw`(?:\$d015|0xd015|53269)\b`;
const ASM_STORE = new RegExp(String.raw`^\s*${LABEL}st[axy]\s+${ASM_ADDR}`, "i");
const ASM_RMW = new RegExp(String.raw`^\s*${LABEL}(?:inc|dec|asl|lsr|rol|ror)\s+${ASM_ADDR}`, "i");
const ASM_READ = new RegExp(String.raw`^\s*${LABEL}ld[axy]\s+${ASM_ADDR}`, "i");
const ASM_MERGE = new RegExp(String.raw`^\s*${LABEL}(?:ora|and|eor)\s+#`, "i");
/** An instruction that ends the walk back: A reloaded from elsewhere, or control left the block. */
const ASM_ENDS = new RegExp(
  String.raw`^\s*${LABEL}(?:lda|pla|txa|tya|jsr|jmp|rts|rti|b(?:ne|eq|cc|cs|pl|mi|vc|vs))\b`,
  "i",
);

/** A store at line i whose value came from a read of $D015 through ORA/AND/EOR of an immediate. */
function asmStoreMerges(lines: string[], i: number): boolean {
  let merged = false;
  for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
    const l = lineAt(lines, j);
    if (ASM_READ.test(l)) return merged;
    if (ASM_MERGE.test(l)) merged = true;
    else if (ASM_ENDS.test(l)) return false;
  }
  return false;
}

export function d015MergedAsm(ctx: LintContext): void {
  const sites: number[] = [];
  const merges: number[] = [];
  ctx.lines.forEach((line, i) => {
    if (ASM_RMW.test(line)) {
      sites.push(i);
      merges.push(i);
    } else if (ASM_STORE.test(line)) {
      sites.push(i);
      if (asmStoreMerges(ctx.lines, i)) merges.push(i);
    }
  });
  if (sites.length < 2) return;
  for (const i of merges)
    report(ctx, i, {
      rule: RULE,
      pitfall: PITFALL,
      message: message(sites),
      page: PAGES.d015,
      certainty: "heuristic",
    });
}

const C_TARGET = String.raw`(?:\bvic\s*\.\s*spr_enable|\*\s*\(\s*(?:volatile\s+)?(?:unsigned\s+)?(?:char|byte)\s*\*\s*\)\s*0x[dD]015\b)`;
const C_WRITE = new RegExp(String.raw`${C_TARGET}\s*([|&^]?=)(?!=)([^;]*)`);
const C_SELF = /\bvic\s*\.\s*spr_enable\b|\*\s*\([^)]*\)\s*0x[dD]015\b/g;

/** Whether an expression holds only literals, operators and ALL_CAPS names: a constant mask. */
function constantMask(expr: string): boolean {
  const rest = expr.replace(/\b0x[0-9a-f]+\b|\b0b[01]+\b|\b\d+\b/gi, "").replace(/\b[A-Z][A-Z0-9_]*\b/g, "");
  return !/[A-Za-z_]/.test(rest);
}

export function d015MergedC(ctx: LintContext): void {
  const sites: number[] = [];
  const merges: number[] = [];
  ctx.lines.forEach((line, i) => {
    const m = C_WRITE.exec(line);
    if (!m) return;
    sites.push(i);
    const op = m[1] ?? "=";
    const rhs = m[2] ?? "";
    const self = C_SELF.test(rhs);
    C_SELF.lastIndex = 0;
    const merge = op !== "=" || self;
    if (merge && constantMask(rhs.replace(C_SELF, ""))) merges.push(i);
  });
  if (sites.length < 2) return;
  for (const i of merges)
    report(ctx, i, {
      rule: RULE,
      pitfall: PITFALL,
      message: message(sites),
      page: PAGES.d015,
      certainty: "heuristic",
    });
}
