/**
 * Reverse-engineering tools: run a PRG headless in VICE under monitor
 * checkpoints and return observations (docs/superpowers/specs/
 * 2026-09-23-reverse-engineering-design.md). Read-only: each call has its
 * own work directory and x64sc process and holds no port.
 *
 * Inputs: a PRG inside the repository or the OS temp directory (this
 * repo's recipes and templates, and test builds), or a session file
 * (src/tools/re-session.ts): a third-party image by sha1 through the local
 * manifest, replayed to play by register injection. With a session the
 * analysis starts at the in-play clock, never on the title, and the model
 * and run length come from the session file.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { REGION_TIMING, videoRegion, type RegionTiming } from "../domain/timing.ts";
import { analyseRegion, regionCommands, type Marker, type Profile } from "../re/frame-profile.ts";
import {
  analyseIrqChain,
  execCommands,
  indirectPointers,
  liveHandlers,
  storeCommands,
  type IrqChain,
} from "../re/irq-chain.ts";
import { readHits, type Hit } from "../re/monlog.ts";
import { readPrg } from "../re/prg.ts";
import { runBatch, ViceBatchError, type Model } from "../services/vice-batch.ts";
import { resolveX64sc } from "../services/vice-bin.ts";
import { MonitorScript, parseHex, sessionScript, type Session } from "../re/session.ts";
import { decodeSnapshot, type Snapshot } from "../re/vic-state.ts";
import {
  notInPlay,
  screenshotPath,
  SessionInput,
  sessionOf,
  sessionPass,
  SESSIONS_DIR,
  withImage,
  type Refusal,
  type RunOpts,
  type SessionRef,
  type SessionResult,
  type Staged,
} from "./re-session.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface RunInfo {
  prg: string;
  model: Model;
  cycles: number;
  /** The BASIC SYS target, or null when the PRG has none. */
  entry: number | null;
  start_clock: number;
  vice: string;
  /** The session file's name, for a session-driven run. */
  session?: string;
  image?: SessionResult["image"];
}
export type ReResult<T> = { ok: true; run: RunInfo; result: T } | Refusal;

const common = {
  prg_path: z.string().describe("Absolute path to a .prg inside this repository or the OS temp directory"),
  model: z
    .enum(["pal", "ntsc"])
    .default("pal")
    .describe("pal = VICE -default (C64C: 8565, 8580, 8521); ntsc = -model ntsc"),
  cycles: z
    .number()
    .int()
    .min(100_000)
    .max(2_000_000_000)
    .default(8_000_000)
    .describe("Run length in CPU cycles (-limitcycles)"),
  disk_path: z
    .string()
    .optional()
    .describe("A .d64 attached as drive 8. The disk is copied; writes are discarded"),
};
/** The PRG-only inputs (c64_claims_watch). */
export const PrgRunInput = common;
const sourced = {
  ...common,
  // No defaults here: with a session the file is the authority, and a value
  // the caller gave that differs from it is refused, so an omitted value
  // must stay undefined. For a PRG the defaults are pal and 8,000,000.
  model: z
    .enum(["pal", "ntsc"])
    .optional()
    .describe(
      "pal = VICE -default (C64C: 8565, 8580, 8521); ntsc = -model ntsc. Default pal; with a session, omit it or match the file",
    ),
  cycles: z
    .number()
    .int()
    .min(100_000)
    .max(2_000_000_000)
    .optional()
    .describe(
      "Run length in CPU cycles (-limitcycles). Default 8000000; with a session, omit it or match its limitcycles",
    ),
  disk_path: z
    .string()
    .optional()
    .describe(
      "A .d64 attached as drive 8. The disk is copied; writes are discarded. Not with a session (a D64 image is attached itself)",
    ),
  prg_path: z
    .string()
    .optional()
    .describe("Absolute path to a .prg inside this repository or the OS temp directory; or give session"),
  session: z
    .string()
    .optional()
    .describe(
      `A session file (a repo path under ${SESSIONS_DIR}/): the image by sha1, replayed to play; the analysis starts at its in-play clock and takes model and cycles from the file. Exactly one of prg_path and session`,
    ),
};
export const IrqChainInput = sourced;
export const FrameProfileInput = {
  ...sourced,
  mode: z
    .enum(["region", "frame"])
    .default("region")
    .describe(
      "region: time start to stop markers. frame: per raster frame, cycles in each interrupt handler, main loop and idle wait, no markers",
    ),
  start: z
    .string()
    .optional()
    .describe(
      'Region mode: start marker, "store:$DC0F=$11" (a store of that value) or "pc:$2000" (an executed PC)',
    ),
  stop: z.string().optional().describe('Region mode: stop marker, same forms: "store:$DC0F=$00"'),
  wait_pc: z
    .string()
    .optional()
    .describe(
      'Frame mode: the first instruction of the main loop\'s frame wait, "$402A"; its exit is found from a full trace. Without it main and idle are one figure',
    ),
};
export const LoadMapInput = {
  ...sourced,
  session: z
    .string()
    .optional()
    .describe(
      `A session file (a repo path under ${SESSIONS_DIR}/): the image by sha1. Unlike the other RE tools, the analysis always starts from power-on (clock 0), not the in-play clock: a load map wants what was written long before play, often long before the session's own in_play. model and cycles must still match the file when given (the session is the authority); the full-memory trace itself commonly stops well short of the file's own limitcycles, at the first program dispatch plus one frame`,
    ),
};

export function allowedPrg(p: string): string | null {
  if (!p.toLowerCase().endsWith(".prg") || !existsSync(p)) return null;
  const real = realpathSync(p);
  const roots = [realpathSync(repoRoot), realpathSync(tmpdir())];
  return roots.some((r) => real.startsWith(r + path.sep)) ? real : null;
}

export function parseMarker(s: string): Marker | null {
  const st = /^store:\$?([0-9a-f]{1,4})=\$?([0-9a-f]{1,2})$/i.exec(s.trim());
  if (st) return { store: parseInt(st[1] ?? "", 16), value: parseInt(st[2] ?? "", 16) };
  const pc = /^pc:\$?([0-9a-f]{1,4})$/i.exec(s.trim());
  return pc ? { pc: parseInt(pc[1] ?? "", 16) } : null;
}

export async function collect(log: string): Promise<Hit[]> {
  const out: Hit[] = [];
  for await (const h of readHits(log)) out.push(h);
  return out;
}

class NoEntry extends Error {}

/** A session replay that did not reach play: its refusal, carried out of the passes. */
class NotInPlay extends Error {
  refusal: Refusal;

  constructor(refusal: Refusal) {
    super(refusal.error);
    this.refusal = refusal;
  }
}

/** The PRG's BASIC SYS target and the exec checkpoint that finds its first run. */
function entryCommand(prg: string, commands: string): { cmd: string; entry: number | null; own: boolean } {
  const entry = readPrg(readFileSync(prg)).sys ?? null;
  if (entry === null) return { cmd: "", entry, own: false };
  const line = `trace exec ${entry.toString(16).padStart(4, "0")} ${entry.toString(16).padStart(4, "0")}`;
  // A marker already on the SYS address traces it; a second checkpoint would log each hit twice.
  const own = !commands.split("\n").includes(line);
  return { cmd: own ? line + "\n" : "", entry, own };
}

/**
 * The entry clock: the first exec of the SYS target, or 0 for a PRG with
 * none. Null when a SYS target exists and never ran: the caller refuses,
 * never counting from power-on instead. Every hit is returned, those
 * before the entry included; the entry checkpoint's own hits are dropped
 * only when the tool added it (`own`), not when a caller's marker asked for it.
 */
export function fromEntry(
  hits: Hit[],
  entry: number | null,
  own: boolean,
): { start: number; hits: Hit[] } | null {
  if (entry === null) return { start: 0, hits };
  const first = hits.find((h) => h.kind === "exec" && h.addr === entry);
  if (!first) return null;
  return {
    start: first.clock,
    hits: own ? hits.filter((h) => !(h.kind === "exec" && h.addr === entry)) : hits,
  };
}

const hexUp = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/** A pass's checkpoints: a block of lines, or a builder given the script and the PC the analysis starts at. */
type Build = string | ((m: MonitorScript, startPc: number | null) => void);

function scriptOf(build: Build, startPc: number | null, m = new MonitorScript()): MonitorScript {
  if (typeof build === "string") m.add(build);
  else build(m, startPc);
  return m;
}

async function traced(
  prg: string,
  args: { model: Model; cycles: number; disk_path?: string | undefined },
  build: Build,
  maxLogBytes?: number,
): Promise<Traced> {
  const commands = scriptOf(build, readPrg(readFileSync(prg)).sys ?? null).text();
  const { cmd, entry, own } = entryCommand(prg, commands);
  const run = await runBatch({
    prg,
    monCommands: commands + cmd,
    cycles: args.cycles,
    model: args.model,
    ...(args.disk_path ? { disk: args.disk_path } : {}),
    ...(maxLogBytes !== undefined ? { maxLogBytes } : {}),
  });
  try {
    const r = fromEntry(await collect(run.log), entry, own);
    if (!r)
      throw new NoEntry(`entry ${hexUp(entry ?? 0)} not reached in ${args.cycles} cycles; raise cycles`);
    return { ...r, entry, truncated: run.truncated };
  } finally {
    run.dispose();
  }
}

const NO_SYS = "entry not known: the PRG has no BASIC SYS line, so clocks and frames count from power-on";

function info(
  prg: string,
  args: { model: Model; cycles: number },
  t: { start: number; entry: number | null },
): RunInfo {
  return {
    prg,
    model: args.model,
    cycles: args.cycles,
    entry: t.entry,
    start_clock: t.start,
    vice: resolveX64sc()?.path ?? "",
  };
}

export function refusal(e: unknown): Refusal {
  if (e instanceof ViceBatchError) return { ok: false, error: e.message, reason: e.reason };
  if (e instanceof NoEntry) return { ok: false, error: e.message, reason: "no-entry" };
  if (e instanceof NotInPlay) return e.refusal;
  throw e;
}

export interface Traced {
  hits: Hit[];
  start: number;
  entry: number | null;
  /** maxLogBytes stopped the run before its cycle limit: hits after the cut are missing. */
  truncated: boolean;
}

/** The unknowns line for a run its log cap stopped early; none when it ran to its cycle limit. */
export function truncationNotes(t: Traced, what = "trace"): string[] {
  return t.truncated
    ? [
        `${what} stopped early: the monitor log reached its size cap before the cycle limit, so later hits are missing`,
      ]
    : [];
}

/** Where a tool's passes run: a PRG from its entry, or a session from its in-play clock. */
export interface Source {
  /** One run; maxLogBytes stops it once the log passes that size (a full-memory trace). */
  trace(build: Build, maxLogBytes?: number): Promise<Traced>;
  info(t: Traced): RunInfo;
  /** What the run itself could not settle (an injection that never fired, no SYS line). */
  unknowns(t: Traced): string[];
  timing: RegionTiming;
}

export interface SourceArgs {
  prg_path?: string | undefined;
  /** A session path, or (tests) an already-parsed session. */
  session?: string | Session | undefined;
  model?: Model | undefined;
  cycles?: number | undefined;
  disk_path?: string | undefined;
}

function prgSource(prg: string, given: SourceArgs): Source {
  const args = { ...given, model: given.model ?? "pal", cycles: given.cycles ?? 8_000_000 };
  return {
    trace: (c, max) => traced(prg, args, c, max),
    info: (t) => info(prg, args, t),
    unknowns: (t) => [...(t.entry === null ? [NO_SYS] : []), ...truncationNotes(t)],
    timing: REGION_TIMING[videoRegion(args.model)],
  };
}

function sessionSource(staged: Staged, l: SessionRef, shotDir: string | undefined): Source {
  const { session: s, name } = l;
  const { prg, image } = staged;
  const shot = screenshotPath(l.shot, shotDir);
  const entry = readPrg(readFileSync(prg)).sys ?? null;
  const pending: string[] = [];
  const args = { model: s.machine.model, cycles: s.limitcycles };
  return {
    trace: async (c, max) => {
      const m = scriptOf(c, parseHex(s.in_play.pc), sessionScript(s));
      const p = await sessionPass(staged, s, m, { screenshot: shot, maxLogBytes: max });
      if (p.play_clock === null) throw new NotInPlay(notInPlay(s, shot));
      pending.splice(0, pending.length, ...p.unknowns);
      return { hits: p.hits, start: p.play_clock, entry, truncated: p.truncated };
    },
    info: (t) => ({ ...info(l.label, args, t), session: name, image }),
    unknowns: (t) => [...pending, ...truncationNotes(t)],
    timing: REGION_TIMING[videoRegion(s.machine.model)],
  };
}

/**
 * Runs `body` against the input's source. Exactly one of prg_path and
 * session; a session resolves its image first and disposes of it after.
 */
/** A value the caller gave that the session file contradicts; the file is the authority. */
export function conflict(args: SourceArgs, s: Session): string | null {
  const out: string[] = [];
  if (args.model !== undefined && args.model !== s.machine.model)
    out.push(`model ${args.model}, but the session file says ${s.machine.model}`);
  if (args.cycles !== undefined && args.cycles !== s.limitcycles)
    out.push(`cycles ${args.cycles}, but the session file says limitcycles ${s.limitcycles}`);
  if (args.disk_path !== undefined)
    out.push("disk_path, but a session attaches its own D64 image and takes no other disk");
  return out.length ? `with a session: ${out.join("; ")}` : null;
}

/**
 * Runs `body` against the input's source. Exactly one of prg_path and
 * session; a session resolves its image first and disposes of it after.
 * The source is built inside the guard, so a throw while building it (a
 * PRG that cannot be read) is a refusal too.
 */
export async function withSource<T>(
  args: SourceArgs,
  tool: string,
  opts: RunOpts,
  body: (src: Source) => Promise<ReResult<T>>,
): Promise<ReResult<T>> {
  const guarded = async (make: () => Source) => {
    try {
      return await body(make());
    } catch (e) {
      return refusal(e);
    }
  };
  if ((args.prg_path === undefined) === (args.session === undefined))
    return { ok: false, error: "give exactly one of prg_path and session", reason: "input" };
  if (args.session !== undefined) {
    const l = sessionOf(args.session, tool);
    if (!l.ok) return l;
    const bad = conflict(args, l.session);
    if (bad) return { ok: false, error: bad, reason: "input" };
    return withImage(l.session, opts.manifestPath, (staged) =>
      guarded(() => sessionSource(staged, l, opts.shotDir)),
    );
  }
  const prg = allowedPrg(args.prg_path ?? "");
  if (!prg) return { ok: false, error: `not an allowed .prg: ${args.prg_path}`, reason: "path" };
  return guarded(() => prgSource(prg, args));
}

/** The irq-chain tool's first two passes: the handlers the vectors held, and the pointers any JMP (pointer) handler reads. */
export async function chainPasses(
  src: Source,
): Promise<{ handlers: number[]; pointers: number[]; last: Traced }> {
  const a = await src.trace(storeCommands());
  const handlers = liveHandlers(a.hits, a.start);
  const b = await src.trace(execCommands(handlers));
  return { handlers, pointers: indirectPointers(b.hits), last: b };
}

export async function reIrqChain(args: SourceArgs, opts: RunOpts = {}): Promise<ReResult<IrqChain>> {
  return withSource(args, "irq-chain", opts, async (src) => {
    const { handlers, pointers, last } = await chainPasses(src);
    // A handler that is JMP (pointer): a third pass adds the pointer's bytes.
    const b = pointers.length ? await src.trace(execCommands(handlers, pointers)) : last;
    const result = analyseIrqChain(b.hits, src.timing, b.start);
    result.unknowns.push(...src.unknowns(b));
    return { ok: true, run: src.info(b), result };
  });
}

export async function reFrameProfile(
  args: SourceArgs & { start?: string | undefined; stop?: string | undefined },
  opts: RunOpts = {},
): Promise<ReResult<Profile>> {
  if (args.start === undefined || args.stop === undefined)
    return { ok: false, error: "region mode needs start and stop markers", reason: "marker" };
  const start = parseMarker(args.start);
  const stop = parseMarker(args.stop);
  if (!start || !stop)
    return { ok: false, error: `bad marker: ${!start ? args.start : args.stop}`, reason: "marker" };
  return withSource(args, "frame-profile", opts, async (src) => {
    const t = await src.trace(regionCommands({ start, stop }));
    const hits = t.hits.filter((h) => h.clock >= t.start);
    const result = analyseRegion(hits, { start, stop }, src.timing, t.start);
    result.unknowns.push(...src.unknowns(t));
    return { ok: true, run: src.info(t), result };
  });
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

export const SnapshotInput = {
  session: SessionInput.session,
  after_hits_of_play_pc: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Hits of in_play.pc to skip before the dump (decimal; hex to the monitor, like a session injection's " +
        "after_hits). Default 0: the dump is taken on the first hit. Not gated by in_play.after_clock, so a " +
        "PC that also runs before real play (unlike Commando's one-shot $0FEB) needs a caller-chosen count",
    ),
};
export interface SnapshotArgs {
  session: string | Session;
  after_hits_of_play_pc?: number | undefined;
}
export interface SnapshotResult {
  /** Under data/re/ (gitignored): <ram_sha1>-<clock>.bin. */
  ram_path: string;
  ram_sha1: string;
  /** CPU clock of the dump: the (after_hits_of_play_pc + 1)th exec of in_play.pc. */
  clock: number;
  vic: Snapshot["vic"];
  cpu_port: Snapshot["cpu_port"];
}

/**
 * The three save checkpoints a snapshot needs, all on in_play.pc, all
 * firing on the same hit (measured in VICE 3.10: several `trace exec`
 * checkpoints on one address all log the same clock). Each is its own
 * checkpoint, never chained on one command line: `save "a" ...; save "b"
 * ...` on one line breaks — VICE's filename parser runs to the *last*
 * quote on the whole line, so the first save's filename swallows the
 * rest of the line as text (measured building this tool; `bank X; save
 * "f" 0 lo hi; disable N` with exactly one save works). Each self-disables
 * so a PC that runs again after the dump does not overwrite it: `disable
 * N` inside `command N` stops that checkpoint firing again (also
 * measured), which is what makes `after_hits_of_play_pc` name one
 * specific hit rather than "whichever hit came last before the run
 * ended".
 */
function dumpCheckpoints(
  m: MonitorScript,
  pc: string,
  afterHits: number,
  files: { cpu: string; io: string; ram: string },
): { cpu: number; io: number; ram: number } {
  const addr = hex4(parseHex(pc));
  const line = `trace exec ${addr} ${addr}`;
  const save = (file: string, bank: string, range: string) => (n: number) => [
    ...(afterHits > 0 ? [`ignore ${n} ${afterHits.toString(16)}`] : []),
    `command ${n} "bank ${bank}; save \\"${file}\\" 0 ${range}; disable ${n}"`,
  ];
  return {
    cpu: m.checkpoint(line, save(files.cpu, "cpu", "0000 0001")),
    io: m.checkpoint(line, save(files.io, "io", "d000 dfff")),
    ram: m.checkpoint(line, save(files.ram, "ram", "0000 ffff")),
  };
}

/** Hashes, decodes and files the three dumps once the run confirms the ram checkpoint fired. */
function finishSnapshot(
  files: { cpu: string; io: string; ram: string },
  clock: number,
  dumpDir: string | undefined,
): { ok: true; result: SnapshotResult } {
  const ram = readFileSync(files.ram);
  const io = readFileSync(files.io);
  const cpu = readFileSync(files.cpu);
  const ram_sha1 = createHash("sha1").update(ram).digest("hex");
  const dir = dumpDir ?? path.join(repoRoot, "data", "re");
  mkdirSync(dir, { recursive: true });
  const ram_path = path.join(dir, `${ram_sha1}-${clock}.bin`);
  copyFileSync(files.ram, ram_path);
  const { vic, cpu_port } = decodeSnapshot(ram, io, cpu);
  return { ok: true, result: { ram_path, ram_sha1, clock, vic, cpu_port } };
}

async function snapshotPass(
  run: { staged: Staged; session: Session; shotName: string },
  afterHits: number,
  opts: RunOpts,
): Promise<{ ok: true; result: SnapshotResult } | Refusal> {
  const { staged, session: s, shotName } = run;
  const scratch = mkdtempSync(path.join(tmpdir(), "re-snapshot-"));
  try {
    const files = {
      cpu: path.join(scratch, "cpu.bin"),
      io: path.join(scratch, "io.bin"),
      ram: path.join(scratch, "ram.bin"),
    };
    const m = sessionScript(s);
    const nums = dumpCheckpoints(m, s.in_play.pc, afterHits, files);
    const shot = screenshotPath(shotName, opts.shotDir);
    const p = await sessionPass(staged, s, m, { screenshot: shot });
    if (p.play_clock === null) return notInPlay(s, shot);
    const clock = p.hits.find((h) => h.checkpoint === nums.ram)?.clock ?? null;
    if (clock === null)
      return {
        ok: false,
        reason: "no-dump",
        error:
          `in_play reached at clock ${p.play_clock}, but ${s.in_play.pc} did not run ${afterHits + 1} ` +
          `times (after_hits_of_play_pc) within ${s.limitcycles} cycles; exit screenshot ${shot}`,
        clock: p.play_clock,
        screenshot: shot,
      };
    return finishSnapshot(files, clock, opts.dumpDir);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Dumps RAM (`bank ram`, all 64 KB) and I/O (`bank io`, $D000-$DFFF) at a
 * chosen hit of a session's in_play.pc, and decodes VIC-II bank/screen/
 * charset/bitmap/sprite pointers and the CPU port from them
 * (src/re/vic-state.ts). The RAM dump is the point: a packed game's real
 * code exists only in RAM, under ROM or I/O, once depacked, and only a
 * moment after play starts.
 */
export async function reSnapshot(
  args: SnapshotArgs,
  opts: RunOpts = {},
): Promise<{ ok: true; result: SnapshotResult } | Refusal> {
  const l = sessionOf(args.session, "snapshot");
  if (!l.ok) return l;
  return withImage(l.session, opts.manifestPath, (staged) =>
    snapshotPass({ staged, session: l.session, shotName: l.shot }, args.after_hits_of_play_pc ?? 0, opts),
  );
}
