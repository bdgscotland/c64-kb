/**
 * c64_claims_watch (#22 step 8): the claims watch (src/claims/watch.ts) for
 * an MCP client. Runs a PRG headless in VICE under a store trace and sorts
 * every store against what the program declares: a recipe page's keys, the
 * techniques' Claims lines, explicit claims. Reads the docs pages, never
 * the graph. PRGs are accepted where the reverse-engineering tools accept
 * them: inside this repository or the OS temp directory.
 */

import { existsSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { reportText } from "../claims/report.ts";
import type { Tally } from "../claims/trace.ts";
import { hex2, hex4, toRanges } from "../claims/units.ts";
import { runClaimsWatch, WatchSetupError, type WatchInput, type WatchRun } from "../claims/watch.ts";
import { config } from "../config.ts";
import { allowedPrg, IrqChainInput } from "./re.ts";

export const ClaimsWatchInput = {
  ...IrqChainInput,
  recipe: z
    .string()
    .optional()
    .describe(
      "A recipe name ('kickassembler-sine-scroller') or page ('recipes/kickassembler/sine-scroller.md'): declares its techniques, claims:, harness:, ram:, uses_kernal and kernal_services",
    ),
  techniques: z
    .array(z.string())
    .default([])
    .describe("Technique ids whose **Claims:** lines (and their REQUIRES closure) declare units"),
  claims: z
    .string()
    .optional()
    .describe("Units in the Claims-line grammar: 'irq_vector_0314, zero_page $FB-$FE, sid_voice_2 (shares)'"),
  ram: z
    .string()
    .optional()
    .describe("The program's own RAM outside its load span: 'screen=$0400-$07FF, colour=$D800-$DBFF'"),
  harness: z
    .string()
    .optional()
    .describe("A measurement harness, never a violation: units or ranges, 'cia1_timer_a, $02FF'"),
  kernal: z
    .array(z.string())
    .default([])
    .describe("KERNAL routines the program calls, or IRQ / NMI for the services it leaves running"),
  screen: z
    .string()
    .regex(/^\$?[0-9A-Fa-f]{1,4}$/)
    .optional()
    .describe("Screen RAM base, so screen+$3F8+n counts as sprite_n's pointer"),
  all_ram: z.boolean().default(false).describe("Also trace $0400-$CFFF and $E000-$FFF9 (slower)"),
};
type Args = z.output<z.ZodObject<typeof ClaimsWatchInput>>;

interface ClaimsFinding {
  verdict: string;
  source: string;
  target: string;
  by?: string;
  stores: number;
  addresses: string[];
  pcs: string[];
  first: string;
}

interface ClaimsWatchResult {
  run: { prg: string; model: string; cycles: number; entry: number | null; start_clock: number };
  verdict: "pass" | "fail";
  techniques: string[];
  kernal: string[];
  declared: string[];
  notes: string[];
  violations: ClaimsFinding[];
  findings: ClaimsFinding[];
  report: string;
}

export type ClaimsWatchReply =
  { ok: true; result: ClaimsWatchResult } | { ok: false; error: string; reason: string };

/** A recipe name or page, resolved to a page inside the docs directory; null when there is none. */
export function recipePage(docsDir: string, recipe: string): string | null {
  const recipes = path.join(docsDir, "recipes");
  const page = recipe.replace(/^docs\//, "");
  let rel: string | undefined = /^recipes\/[\w-]+\/[\w.-]+\.md$/.test(page) ? page : undefined;
  if (!rel && existsSync(recipes)) {
    const toolchain = readdirSync(recipes).find((d) => recipe.startsWith(`${d}-`));
    const rest = toolchain ? recipe.slice(toolchain.length + 1) : "";
    if (toolchain && /^[\w-]+$/.test(rest)) rel = `recipes/${toolchain}/${rest}.md`;
  }
  if (!rel) return null;
  const abs = path.join(docsDir, rel);
  if (!existsSync(abs)) return null;
  const real = realpathSync(abs);
  return real.startsWith(realpathSync(docsDir) + path.sep) ? real : null;
}

const addrText = (n: number) => (n < 0x100 ? hex2(n) : hex4(n));

function finding(t: Tally, label: (pc: number) => string): ClaimsFinding {
  return {
    verdict: t.finding.verdict,
    source: t.finding.source,
    target: t.finding.target,
    ...(t.finding.by ? { by: t.finding.by } : {}),
    stores: t.count,
    addresses: toRanges(t.addrs.keys()).map(([a, b]) =>
      a === b ? addrText(a) : `${addrText(a)}-${addrText(b)}`,
    ),
    pcs: [...t.pcs].sort((x, y) => y[1] - x[1]).map(([pc, n]) => `${label(pc)} x${n}`),
    first: `${t.first.insn} at clock ${t.first.clock}`,
  };
}

/** The tool's arguments as the watch's input. */
function watchInput(args: Args, prg: string, recipe: string | undefined, docsDir: string): WatchInput {
  return {
    docsDir,
    prg,
    recipe,
    techniques: args.techniques,
    claims: args.claims ? [args.claims] : [],
    ranges: args.ram ? [args.ram] : [],
    harness: args.harness ? [args.harness] : [],
    kernal: args.kernal,
    screen: args.screen === undefined ? undefined : parseInt(args.screen.replace("$", ""), 16),
    cycles: args.cycles,
    model: args.model,
    disk: args.disk_path,
    allRam: args.all_ram,
  };
}

function resultOf(r: WatchRun, args: Args, prg: string): ClaimsWatchResult {
  const violations = r.watch.violations();
  return {
    run: {
      prg,
      model: args.model,
      cycles: args.cycles,
      entry: r.start ?? null,
      start_clock: r.watch.startClock ?? 0,
    },
    verdict: violations.length === 0 ? "pass" : "fail",
    techniques: r.techniques,
    kernal: r.declared.kernalRoutines,
    declared: r.declared.describe(),
    notes: r.notes,
    violations: violations.map((t) => finding(t, r.label)),
    findings: [...r.watch.tallies.values()].map((t) => finding(t, r.label)),
    report: reportText(r.watch, r.label).join("\n"),
  };
}

export async function claimsWatch(args: Args, docsDir = config.docs.dir): Promise<ClaimsWatchReply> {
  const prg = allowedPrg(args.prg_path);
  if (!prg) return { ok: false, error: `not an allowed .prg: ${args.prg_path}`, reason: "path" };
  const recipe = args.recipe === undefined ? null : recipePage(docsDir, args.recipe);
  if (args.recipe !== undefined && !recipe)
    return { ok: false, error: `no recipe page for "${args.recipe}"`, reason: "recipe" };
  try {
    const r = await runClaimsWatch(watchInput(args, prg, recipe ?? undefined, docsDir));
    if (!r.watch.started)
      return {
        ok: false,
        error: `the program never started in ${args.cycles} cycles (no store from outside ROM, no exec of the entry); raise cycles`,
        reason: "no-entry",
      };
    return { ok: true, result: resultOf(r, args, prg) };
  } catch (e) {
    if (e instanceof WatchSetupError) return { ok: false, error: e.message, reason: "setup" };
    throw e;
  }
}
