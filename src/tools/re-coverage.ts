/**
 * c64_re_coverage: CPU coverage map for a PRG or session. Zaps the VICE
 * memory map at the start of play, lets the game run until the N-th write
 * to $D019 (the raster-IRQ acknowledge register), then shows the map.
 * Classifies the RAM bank into code (executed), data (read, not executed),
 * written_only (written, not read or executed); untouched addresses are
 * omitted (unknown, not "data").
 *
 * For a session, a first pass counts $D019 writes before play_clock so the
 * second pass's ignore count places the show N writes into game play. For a
 * PRG, the ignore count runs from the start of the run.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { REGION_TIMING, videoRegion } from "../domain/timing.ts";
import {
  classifyCoverage,
  countPrePlayD019,
  coverageCommandsPrg,
  coverageShowIgnore,
  parseMemmapFile,
  type Coverage,
} from "../re/coverage.ts";
import { readPrg } from "../re/prg.ts";
import { parseHex, sessionScript, type Session } from "../re/session.ts";
import { runBatch } from "../services/vice-batch.ts";
import { resolveX64sc } from "../services/vice-bin.ts";
import {
  collect,
  refusal,
  allowedPrg,
  type ReResult,
  type RunInfo,
  type SourceArgs,
  conflict,
} from "./re.ts";
import {
  screenshotPath,
  sessionOf,
  withImage,
  SESSIONS_DIR,
  type RunOpts,
  type Staged,
} from "./re-session.ts";

export type { Coverage } from "../re/coverage.ts";

export const CoverageInput = {
  session: z.string().optional().describe(`A session file (under ${SESSIONS_DIR}/); or give prg_path`),
  prg_path: z
    .string()
    .optional()
    .describe("Absolute path to a .prg inside this repo or the OS temp directory; or give session"),
  model: z
    .enum(["pal", "ntsc"])
    .optional()
    .describe(
      "pal = VICE -default (C64C: 8565, 8580, 8521); ntsc = -model ntsc. Default pal; with a session, omit or match",
    ),
  cycles: z
    .number()
    .int()
    .min(100_000)
    .max(200_000_000)
    .optional()
    .describe("Run length in CPU cycles. Default 8000000; with a session, omit or match its limitcycles"),
  frames: z
    .number()
    .int()
    .min(1)
    .max(1_000_000)
    .default(3)
    .describe(
      "Number of $D019 writes to wait for from the in-play point before showing the map. " +
        "Default 3 skips KERNAL + setup writes and fires on the first IRQ handler write (PRG). " +
        "For a session, pre-play writes are auto-counted and excluded.",
    ),
};

/**
 * PRG-path coverage: single pass. The monitor commands include the zap at
 * the SYS entry and the show after `frames` total $D019 writes from run
 * start. Reads the memmapshow section from the log before the work
 * directory is removed.
 */
async function prgCoverage(
  prg: string,
  args: { model: "pal" | "ntsc"; cycles: number; frames: number },
): Promise<ReResult<Coverage>> {
  const bytes = readFileSync(prg);
  const entry = readPrg(bytes).sys;
  if (entry === undefined)
    return {
      ok: false,
      error: "the PRG has no BASIC SYS line; coverage requires a known entry PC",
      reason: "no-entry",
    };
  const sysHex = entry.toString(16).padStart(4, "0");
  const commands = coverageCommandsPrg(sysHex, args.frames);
  const run = await runBatch({ prg, monCommands: commands, cycles: args.cycles, model: args.model });
  try {
    const hits = await collect(run.log);
    const rows = parseMemmapFile(run.log);
    const entry_hit = hits.find((h) => h.kind === "exec" && h.addr === entry);
    const unknowns: string[] = [];
    if (rows.length === 0)
      unknowns.push(
        `memmapshow did not fire: $D019 was not written ${args.frames} times in ${args.cycles} cycles`,
      );
    const ri: RunInfo = {
      prg,
      model: args.model,
      cycles: args.cycles,
      entry,
      start_clock: entry_hit?.clock ?? 0,
      vice: resolveX64sc()?.path ?? "",
    };
    return { ok: true, run: ri, result: { ...classifyCoverage(rows), unknowns } };
  } finally {
    run.dispose();
  }
}

/** Pass 1: count $D019 writes before play_clock (for the session show-offset). */
async function countD019BeforePlay(
  staged: Staged,
  s: Session,
  shot: string,
): Promise<{ play_clock: number | null; prePlayD019: number }> {
  const m1 = sessionScript(s);
  m1.add("trace store d019 d019\n");
  const run1 = await runBatch({
    prg: staged.prg,
    monCommands: m1.text(),
    cycles: s.limitcycles,
    model: s.machine.model,
    ...(staged.disk !== undefined ? { disk: staged.disk } : {}),
    args: ["-exitscreenshot", shot],
  });
  try {
    const all1 = await collect(run1.log);
    const inPlayPc = parseHex(s.in_play.pc);
    let play_clock: number | null = null;
    for (const h of all1) {
      if (h.kind === "exec" && h.addr === inPlayPc && h.clock >= s.in_play.after_clock) {
        play_clock = h.clock;
        break;
      }
    }
    const prePlayD019 = play_clock !== null ? countPrePlayD019(all1, play_clock) : 0;
    return { play_clock, prePlayD019 };
  } finally {
    run1.dispose();
  }
}

interface CoveragePassOpts {
  staged: Staged;
  s: Session;
  label: string;
  name: string;
  totalIgnore: number;
  covCycles: number;
  shot: string;
}

/** Pass 2: coverage run with zap at in_play.pc and show after totalIgnore+1 $D019 writes. */
async function coveragePass({
  staged,
  s,
  label,
  name,
  totalIgnore,
  covCycles,
  shot,
}: CoveragePassOpts): Promise<ReResult<Coverage>> {
  const inPlayAddr = parseHex(s.in_play.pc).toString(16).padStart(4, "0");
  const m2 = sessionScript(s);
  m2.checkpoint(`trace exec ${inPlayAddr} ${inPlayAddr}`, (n) => [`command ${n} "memmapzap; disable ${n}"`]);
  m2.checkpoint(`trace store d019 d019`, (n) => [
    ...(totalIgnore > 0 ? [`ignore ${n} ${totalIgnore.toString(16)}`] : []),
    `command ${n} "memmapshow; disable ${n}"`,
  ]);
  const run2 = await runBatch({
    prg: staged.prg,
    monCommands: m2.text(),
    cycles: covCycles,
    model: s.machine.model,
    ...(staged.disk !== undefined ? { disk: staged.disk } : {}),
    args: ["-exitscreenshot", shot],
  });
  try {
    const all2 = await collect(run2.log);
    const rows = parseMemmapFile(run2.log);
    const unknowns: string[] = [];
    if (rows.length === 0)
      unknowns.push(
        `memmapshow did not fire: $D019 was not written ${totalIgnore + 1} times total ` +
          `within ${covCycles} cycles; check whether the game uses raster IRQ ($D019 acknowledge)`,
      );
    const entry_hit = all2.find((h) => h.kind === "exec" && h.addr === parseHex(s.in_play.pc));
    const ri: RunInfo = {
      prg: label,
      model: s.machine.model,
      cycles: covCycles,
      entry: null,
      start_clock: entry_hit?.clock ?? 0,
      vice: resolveX64sc()?.path ?? "",
      session: name,
      image: staged.image,
    };
    return { ok: true, run: ri, result: { ...classifyCoverage(rows), unknowns } };
  } finally {
    run2.dispose();
  }
}

/** Session coverage: two passes. */
function sessionCoverage(args: SourceArgs & { frames: number }, opts: RunOpts): Promise<ReResult<Coverage>> {
  const l = sessionOf(args.session ?? "", "coverage");
  if (!l.ok) return Promise.resolve(l);
  const bad = conflict(args, l.session);
  if (bad) return Promise.resolve({ ok: false, error: bad, reason: "input" as const });
  const { session: s, name, label } = l;
  const timing = REGION_TIMING[videoRegion(s.machine.model)];

  return withImage(s, opts.manifestPath, async (staged) => {
    try {
      const shot1 = screenshotPath(`coverage-p1-${name}`, opts.shotDir);
      const { play_clock, prePlayD019 } = await countD019BeforePlay(staged, s, shot1);
      if (play_clock === null)
        return {
          ok: false,
          reason: "not-in-play" as const,
          error: `in_play not reached in ${s.limitcycles} cycles`,
          clock: s.limitcycles,
          screenshot: shot1,
        };
      const totalIgnore = coverageShowIgnore(prePlayD019, args.frames);
      const covCycles = Math.min(play_clock + args.frames * timing.cycles_per_frame * 10, s.limitcycles);
      const shot2 = screenshotPath(`coverage-p2-${name}`, opts.shotDir);
      return await coveragePass({ staged, s, label, name, totalIgnore, covCycles, shot: shot2 });
    } catch (e) {
      return refusal(e);
    }
  });
}

/**
 * CPU coverage map: zap at play start, show after N $D019 writes (raster
 * IRQ acknowledge). Exactly one of prg_path and session.
 */
export function reCoverage(
  args: SourceArgs & { frames?: number },
  opts: RunOpts = {},
): Promise<ReResult<Coverage>> {
  const frames = args.frames ?? 3;
  if ((args.prg_path === undefined) === (args.session === undefined))
    return Promise.resolve({
      ok: false,
      error: "give exactly one of prg_path and session",
      reason: "input" as const,
    });
  if (args.session !== undefined) return sessionCoverage({ ...args, frames }, opts);
  const prg = allowedPrg(args.prg_path ?? "");
  if (!prg)
    return Promise.resolve({
      ok: false,
      error: `not an allowed .prg: ${args.prg_path}`,
      reason: "path" as const,
    });
  return prgCoverage(prg, {
    model: args.model ?? "pal",
    cycles: args.cycles ?? 8_000_000,
    frames,
  }).catch((e: unknown) => refusal(e));
}
