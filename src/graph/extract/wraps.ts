/**
 * **Wraps:** lines on a toolchain page (#19): which KERNAL routines and I/O
 * registers each function of a C library reaches, so an agent writing C can
 * get from the API name to the pitfalls of what it wraps. One line per
 * header section (`## kernalio.h — …`):
 *
 *   **Wraps:** krnio_open: SETLFS, OPEN, CLOSE; vic_sprxy: D000-D010
 *
 * A KERNAL routine by its jump-table name, a register by its address
 * (`D012` or `$D012`); a range `D000-D00F` names every register in it.
 */

import { warn } from "./common.ts";
import type { GraphEntity } from "./types.ts";

const FUNCTION_NAME = /^[A-Za-z_]\w*$/;
const KERNAL_NAME = /^[A-Z][A-Z0-9]*$/;
const REGISTER = /^\$?([0-9A-F]{4})$/;
const REGISTER_RANGE = /^\$?([0-9A-F]{4})-\$?([0-9A-F]{4})$/;
// A range wider than one chip's register file is a typo, not a claim.
const MAX_RANGE = 0x40;

type WrapsTarget = { target: string; targetKind: "KernalRoutine" | "Register" };

function registerRange(word: string, where: string): WrapsTarget[] | null {
  const m = REGISTER_RANGE.exec(word);
  if (!m) return null;
  const lo = parseInt(m[1] ?? "", 16);
  const hi = parseInt(m[2] ?? "", 16);
  if (hi < lo || hi - lo >= MAX_RANGE) {
    warn(`${where}: **Wraps:** range "${word}" is empty or wider than ${MAX_RANGE} registers — not ingested`);
    return [];
  }
  return Array.from({ length: hi - lo + 1 }, (_, i) => ({
    target: (lo + i).toString(16).toUpperCase().padStart(4, "0"),
    targetKind: "Register" as const,
  }));
}

function targetsOf(word: string, where: string): WrapsTarget[] {
  const w = word.replace(/`/g, "").trim();
  const range = registerRange(w, where);
  if (range) return range;
  const reg = REGISTER.exec(w);
  if (reg?.[1]) return [{ target: reg[1], targetKind: "Register" }];
  if (KERNAL_NAME.test(w)) return [{ target: w, targetKind: "KernalRoutine" }];
  warn(
    `${where}: **Wraps:** target "${w}" is neither a KERNAL routine name nor a register address — not ingested (see CONVENTIONS-toolchain-reference.md)`,
  );
  return [];
}

/** The LibraryFunction nodes and WRAPS edges of one **Wraps:** line under header `header`. */
export function wrapsEntities(
  value: string,
  ctx: { header: string; tool: string; sourcePath: string },
): GraphEntity[] {
  const where = `${ctx.sourcePath} (${ctx.header})`;
  const out: GraphEntity[] = [];
  for (const item of value.split(";").map((s) => s.trim())) {
    if (item === "") continue;
    const colon = item.indexOf(":");
    const fn = (colon >= 0 ? item.slice(0, colon) : "").replace(/`/g, "").trim();
    if (!FUNCTION_NAME.test(fn)) {
      warn(`${where}: **Wraps:** item "${item}" is not \`function: targets\` — not ingested`);
      continue;
    }
    const targets = item
      .slice(colon + 1)
      .split(",")
      .filter((w) => w.trim() !== "")
      .flatMap((w) => targetsOf(w, where));
    out.push({
      type: "library_function",
      name: fn,
      header: ctx.header,
      tool: ctx.tool,
      source_doc: ctx.sourcePath,
    });
    const seen = new Set<string>();
    for (const t of targets) {
      if (seen.has(t.target)) continue;
      seen.add(t.target);
      out.push({ type: "wraps", fn, ...t });
    }
  }
  return out;
}
