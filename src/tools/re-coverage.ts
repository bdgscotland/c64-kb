/**
 * c64_re_coverage: CPU coverage map for a PRG or session. Zaps the VICE
 * memory map at the start of play, runs the game until clock ≥ play_clock
 * + frames × cycles_per_frame, then shows the map.
 *
 * Clock-based show timing: pass 1 counts the per-frame rate of $FF48 execs
 * (KERNAL IRQ dispatcher, for $0314-based IRQ) or $D019 stores (raster IRQ
 * acknowledge, for $FFFE-based IRQ), and the number of those hits before
 * play_clock. Pass 2 uses ignore = (pre_play_count + frames × per_frame −
 * 1) to fire the show at the right moment. At the show checkpoint, a RAM
 * dump ($0000-$BFFF) is saved; each executed opcode is extended to cover
 * the full instruction length using the opcode byte from that dump.
 *
 * Uses sessionPass/batchOf/notInPlay from re-session.ts (which handle
 * injections, in-play clock, and disposal). MonitorScript is used for both
 * session and PRG paths; no hand-numbered checkpoints.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REGION_TIMING, videoRegion } from "../domain/timing.ts";
import { classifyCoverage, extendByInstrLen, parseMemmapFile, type Coverage } from "../re/coverage.ts";
import { readPrg } from "../re/prg.ts";
import { parseHex, sessionScript, MonitorScript, type Session } from "../re/session.ts";
import { runBatch } from "../services/vice-batch.ts";
import { resolveX64sc } from "../services/vice-bin.ts";
import {
  allowedPrg,
  collect,
  conflict,
  refusal,
  type ReResult,
  type RunInfo,
  type SourceArgs,
} from "./re.ts";
import {
  batchOf,
  notInPlay,
  screenshotPath,
  sessionOf,
  sessionPass,
  withImage,
  SESSIONS_DIR,
  type RunOpts,
  type Staged,
} from "./re-session.ts";
import type { Hit } from "../re/monlog.ts";

export type { Coverage } from "../re/coverage.ts";

const DUMP_FILE = "dump.prg";

export const CoverageInput = {
  session: z.string().optional().describe(`A session file (under ${SESSIONS_DIR}/); or give prg_path`),
  prg_path: z
    .string()
    .optional()
    .describe("Absolute path to a .prg inside this repo or the OS temp directory; or give session"),
  model: z
    .enum(["pal", "ntsc"])
    .optional()
    .describe("pal = VICE -default (C64C: 8565, 8580, 8521); ntsc = -model ntsc"),
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
    .default(300)
    .describe(
      "Frames of game play to cover (show fires ≈ frames × cycles_per_frame after play_clock). " +
        "Default 300 (about 6 s PAL). Measured by the $FF48 exec or $D019 store rate from pass 1.",
    ),
};

// ---------------------------------------------------------------------------
// Pass-1 analysis: per-frame trigger rate and pre-play count
// ---------------------------------------------------------------------------

interface TriggerInfo {
  line: string; // monitor trace line for the show checkpoint
  addr: number; // $ff48 or $d019
  kind: "exec" | "store";
  prePlayCount: number;
  perFrame: number;
}

interface TriggerProbeNums {
  playClock: number;
  frameCycles: number;
  ff48CpNum: number;
  d019CpNum: number;
}

function analyzeTrigger(
  hits: Hit[],
  { playClock, frameCycles, ff48CpNum, d019CpNum }: TriggerProbeNums,
): { ff48: { pre: number; rate: number }; d019: { pre: number; rate: number } } {
  const end = playClock + frameCycles;
  let ff48Pre = 0,
    ff48Rate = 0,
    d019Pre = 0,
    d019Rate = 0;
  for (const h of hits) {
    if (h.checkpoint === ff48CpNum) {
      if (h.clock < playClock) ff48Pre++;
      else if (h.clock < end) ff48Rate++;
    }
    if (h.checkpoint === d019CpNum) {
      if (h.clock < playClock) d019Pre++;
      else if (h.clock < end) d019Rate++;
    }
  }
  return { ff48: { pre: ff48Pre, rate: ff48Rate }, d019: { pre: d019Pre, rate: d019Rate } };
}

function chooseTrigger(analysis: {
  ff48: { pre: number; rate: number };
  d019: { pre: number; rate: number };
}): TriggerInfo | null {
  if (analysis.ff48.rate > 0) {
    return {
      line: "trace exec ff48 ff48",
      addr: 0xff48,
      kind: "exec",
      prePlayCount: analysis.ff48.pre,
      perFrame: analysis.ff48.rate,
    };
  }
  if (analysis.d019.rate > 0) {
    return {
      line: "trace store d019 d019",
      addr: 0xd019,
      kind: "store",
      prePlayCount: analysis.d019.pre,
      perFrame: analysis.d019.rate,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pass-2 helpers: add checkpoints, run, parse
// ---------------------------------------------------------------------------

function addCoverageCheckpoints(
  m: MonitorScript,
  zapLine: string,
  trigger: TriggerInfo,
  frames: number,
): number {
  m.checkpoint(zapLine, (n) => [`command ${n} "memmapzap; disable ${n}"`]);
  const totalIgnore = trigger.prePlayCount + frames * trigger.perFrame - 1;
  const showCpNum = m.checkpoint(trigger.line, (n) => [
    ...(totalIgnore > 0 ? [`ignore ${n} ${totalIgnore.toString(16)}`] : []),
    `command ${n} "memmapshow; bank ram; save \\"${DUMP_FILE}\\" 0 0000 bfff; disable ${n}"`,
  ]);
  return showCpNum;
}

interface BuildCoverageOpts {
  hits: Hit[];
  work: string;
  logPath: string;
  showCpNum: number;
  playClock: number;
  frameCycles: number;
  pass1Unknowns: string[];
}

function buildCoverage({
  hits,
  work,
  logPath,
  showCpNum,
  playClock,
  frameCycles,
  pass1Unknowns,
}: BuildCoverageOpts): Coverage {
  const rows = parseMemmapFile(logPath);
  const showHit = hits.find((h) => h.checkpoint === showCpNum);
  const show_clock = showHit?.clock ?? 0;
  const span_cycles = show_clock > 0 ? show_clock - playClock : 0;
  const span_frames = span_cycles / frameCycles;

  const dumpPath = path.join(work, DUMP_FILE);
  const dump = existsSync(dumpPath) ? readFileSync(dumpPath) : new Uint8Array(0);
  const execAddrs = rows.filter((r) => r.ram[2] === "x").map((r) => r.addr);
  const codeSet = dump.length > 0 ? extendByInstrLen(execAddrs, dump) : new Set(execAddrs);

  const unknowns: string[] = [...pass1Unknowns];
  if (rows.length === 0)
    unknowns.push("memmapshow did not fire: the show trigger never reached its target count");

  return {
    ...classifyCoverage(rows, codeSet),
    show_clock,
    span_cycles,
    span_frames,
    unknowns,
  };
}

// ---------------------------------------------------------------------------
// Session coverage (two passes)
// ---------------------------------------------------------------------------

async function sessionProbe(
  staged: Staged,
  s: Session,
  name: string,
  opts: RunOpts,
): Promise<{
  play_clock: number | null;
  shot: string;
  trigger: ReturnType<typeof analyzeTrigger>;
  injUnknowns: string[];
}> {
  const timing = REGION_TIMING[videoRegion(s.machine.model)];
  const m1 = sessionScript(s);
  const ff48CpNum = m1.checkpoint("trace exec ff48 ff48");
  const d019CpNum = m1.checkpoint("trace store d019 d019");
  const shot = screenshotPath(`coverage-p1-${name}`, opts.shotDir);
  const p1 = await sessionPass(staged, s, m1, shot);
  const trigger = analyzeTrigger(p1.hits, {
    playClock: p1.play_clock ?? s.limitcycles,
    frameCycles: timing.cycles_per_frame,
    ff48CpNum,
    d019CpNum,
  });
  return { play_clock: p1.play_clock, shot, trigger, injUnknowns: p1.unknowns };
}

interface SessionRunOpts {
  staged: Staged;
  s: Session;
  name: string;
  label: string;
  playClock: number;
  trig: TriggerInfo;
  frames: number;
  opts: RunOpts;
}

async function sessionCoverageRun({
  staged,
  s,
  name,
  label,
  playClock,
  trig,
  frames,
  opts,
}: SessionRunOpts): Promise<ReResult<Coverage>> {
  const timing = REGION_TIMING[videoRegion(s.machine.model)];
  const m2 = sessionScript(s);
  const inPlayAddr = parseHex(s.in_play.pc).toString(16).padStart(4, "0");
  const showCpNum = addCoverageCheckpoints(m2, `trace exec ${inPlayAddr} ${inPlayAddr}`, trig, frames);
  const covCycles = Math.min(playClock + frames * timing.cycles_per_frame * 2, s.limitcycles);
  const shot2 = screenshotPath(`coverage-p2-${name}`, opts.shotDir);
  const run2 = await runBatch(batchOf(staged, s, m2, { screenshot: shot2, cyclesOverride: covCycles }));
  try {
    const all2 = await collect(run2.log);
    const coverage = buildCoverage({
      hits: m2.toolHits(all2),
      work: run2.work,
      logPath: run2.log,
      showCpNum,
      playClock,
      frameCycles: timing.cycles_per_frame,
      pass1Unknowns: [],
    });
    const entry_hit = all2.find((h) => h.kind === "exec" && h.addr === parseHex(s.in_play.pc));
    const ri: RunInfo = {
      prg: label,
      model: s.machine.model,
      cycles: covCycles,
      entry: null,
      start_clock: entry_hit?.clock ?? playClock,
      vice: resolveX64sc()?.path ?? "",
      session: name,
      image: staged.image,
    };
    return { ok: true, run: ri, result: coverage };
  } finally {
    run2.dispose();
  }
}

function sessionCoverage(args: SourceArgs & { frames: number }, opts: RunOpts): Promise<ReResult<Coverage>> {
  const l = sessionOf(args.session ?? "", "coverage");
  if (!l.ok) return Promise.resolve(l);
  const bad = conflict(args, l.session);
  if (bad) return Promise.resolve({ ok: false, error: bad, reason: "input" as const });
  const { session: s, name, label } = l;

  return withImage(s, opts.manifestPath, async (staged) => {
    try {
      const { play_clock, shot, trigger, injUnknowns } = await sessionProbe(staged, s, name, opts);
      if (play_clock === null) return notInPlay(s, shot);
      const trig = chooseTrigger(trigger);
      if (!trig)
        return {
          ok: false,
          reason: "input" as const,
          error: "no per-frame trigger found: $FF48 and $D019 both have rate 0 in the first play frame",
        };
      const result = await sessionCoverageRun({
        staged,
        s,
        name,
        label,
        playClock: play_clock,
        trig,
        frames: args.frames,
        opts,
      });
      if (result.ok) result.result.unknowns.push(...injUnknowns);
      return result;
    } catch (e) {
      return refusal(e);
    }
  });
}

// ---------------------------------------------------------------------------
// PRG coverage (two passes)
// ---------------------------------------------------------------------------

async function prgProbe(
  prg: string,
  entry: number,
  model: "pal" | "ntsc",
  cycles: number,
): Promise<{ entry_clock: number; trigger: ReturnType<typeof analyzeTrigger> }> {
  const timing = REGION_TIMING[videoRegion(model)];
  const m1 = new MonitorScript();
  const entryAddr = entry.toString(16).padStart(4, "0");
  const entryCpNum = m1.checkpoint(`trace exec ${entryAddr} ${entryAddr}`);
  const ff48CpNum = m1.checkpoint("trace exec ff48 ff48");
  const d019CpNum = m1.checkpoint("trace store d019 d019");
  const run = await runBatch({ prg, monCommands: m1.text(), cycles, model });
  try {
    const hits = await collect(run.log);
    const entryHit = hits.find((h) => h.checkpoint === entryCpNum && h.kind === "exec");
    const entry_clock = entryHit?.clock ?? 0;
    const trigger = analyzeTrigger(hits, {
      playClock: entry_clock,
      frameCycles: timing.cycles_per_frame,
      ff48CpNum,
      d019CpNum,
    });
    return { entry_clock, trigger };
  } finally {
    run.dispose();
  }
}

interface PrgRunOpts {
  prg: string;
  entry: number;
  entry_clock: number;
  trig: TriggerInfo;
  frames: number;
  model: "pal" | "ntsc";
  cycles: number;
}

async function prgCoverageRun({
  prg,
  entry,
  entry_clock,
  trig,
  frames,
  model,
  cycles,
}: PrgRunOpts): Promise<ReResult<Coverage>> {
  const timing = REGION_TIMING[videoRegion(model)];
  const m2 = new MonitorScript();
  const entryAddr = entry.toString(16).padStart(4, "0");
  const showCpNum = addCoverageCheckpoints(m2, `trace exec ${entryAddr} ${entryAddr}`, trig, frames);
  const covCycles = Math.min(entry_clock + frames * timing.cycles_per_frame * 2, cycles);
  const run2 = await runBatch({ prg, monCommands: m2.text(), cycles: covCycles, model });
  try {
    const all2 = await collect(run2.log);
    const coverage = buildCoverage({
      hits: m2.toolHits(all2),
      work: run2.work,
      logPath: run2.log,
      showCpNum,
      playClock: entry_clock,
      frameCycles: timing.cycles_per_frame,
      pass1Unknowns: [],
    });
    const ri: RunInfo = {
      prg,
      model,
      cycles: covCycles,
      entry,
      start_clock: entry_clock,
      vice: resolveX64sc()?.path ?? "",
    };
    return { ok: true, run: ri, result: coverage };
  } finally {
    run2.dispose();
  }
}

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
  const { entry_clock, trigger } = await prgProbe(prg, entry, args.model, args.cycles);
  const trig = chooseTrigger(trigger);
  if (!trig)
    return {
      ok: false,
      reason: "input" as const,
      error: "no per-frame trigger found: $FF48 and $D019 both have rate 0 in the first entry frame",
    };
  return prgCoverageRun({
    prg,
    entry,
    entry_clock,
    trig,
    frames: args.frames,
    model: args.model,
    cycles: args.cycles,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * CPU coverage map: two-pass approach. Pass 1 finds play_clock and the
 * per-frame rate of $FF48 (KERNAL IRQ dispatcher) or $D019 (raster IRQ
 * acknowledge). Pass 2 zaps at play start and shows after clock ≈ play_clock
 * + frames × cycles_per_frame. Exactly one of prg_path and session.
 */
export function reCoverage(
  args: SourceArgs & { frames?: number },
  opts: RunOpts = {},
): Promise<ReResult<Coverage>> {
  const frames = args.frames ?? 300;
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
  }).catch((e: unknown) => refusal(e) as ReResult<Coverage>);
}
