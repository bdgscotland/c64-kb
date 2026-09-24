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
import { existsSync, readFileSync, realpathSync } from "node:fs";
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
import { sessionScript, type Session } from "../re/session.ts";
import {
  notInPlay,
  screenshotPath,
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

interface RunInfo {
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
    .max(200_000_000)
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
    .max(200_000_000)
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
  start: z
    .string()
    .describe('Start marker: "store:$DC0F=$11" (a store of that value) or "pc:$2000" (an executed PC)'),
  stop: z.string().describe('Stop marker, same forms: "store:$DC0F=$00"'),
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

async function collect(log: string): Promise<Hit[]> {
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

async function traced(
  prg: string,
  args: { model: Model; cycles: number; disk_path?: string | undefined },
  commands: string,
): Promise<{ hits: Hit[]; start: number; entry: number | null }> {
  const { cmd, entry, own } = entryCommand(prg, commands);
  const run = await runBatch({
    prg,
    monCommands: commands + cmd,
    cycles: args.cycles,
    model: args.model,
    ...(args.disk_path ? { disk: args.disk_path } : {}),
  });
  try {
    const r = fromEntry(await collect(run.log), entry, own);
    if (!r)
      throw new NoEntry(`entry ${hexUp(entry ?? 0)} not reached in ${args.cycles} cycles; raise cycles`);
    return { ...r, entry };
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

function refusal(e: unknown): Refusal {
  if (e instanceof ViceBatchError) return { ok: false, error: e.message, reason: e.reason };
  if (e instanceof NoEntry) return { ok: false, error: e.message, reason: "no-entry" };
  if (e instanceof NotInPlay) return e.refusal;
  throw e;
}

interface Traced {
  hits: Hit[];
  start: number;
  entry: number | null;
}

/** Where a tool's passes run: a PRG from its entry, or a session from its in-play clock. */
interface Source {
  trace(commands: string): Promise<Traced>;
  info(t: Traced): RunInfo;
  /** What the run itself could not settle (an injection that never fired, no SYS line). */
  unknowns(t: Traced): string[];
  timing: RegionTiming;
}

interface SourceArgs {
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
    trace: (c) => traced(prg, args, c),
    info: (t) => info(prg, args, t),
    unknowns: (t) => (t.entry === null ? [NO_SYS] : []),
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
    trace: async (c) => {
      const m = sessionScript(s);
      m.add(c);
      const p = await sessionPass(staged, s, m, shot);
      if (p.play_clock === null) throw new NotInPlay(notInPlay(s, shot));
      pending.splice(0, pending.length, ...p.unknowns);
      return { hits: p.hits, start: p.play_clock, entry };
    },
    info: (t) => ({ ...info(l.label, args, t), session: name, image }),
    unknowns: () => [...pending],
    timing: REGION_TIMING[videoRegion(s.machine.model)],
  };
}

/**
 * Runs `body` against the input's source. Exactly one of prg_path and
 * session; a session resolves its image first and disposes of it after.
 */
/** A value the caller gave that the session file contradicts; the file is the authority. */
function conflict(args: SourceArgs, s: Session): string | null {
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
async function withSource<T>(
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

export async function reIrqChain(args: SourceArgs, opts: RunOpts = {}): Promise<ReResult<IrqChain>> {
  return withSource(args, "irq-chain", opts, async (src) => {
    const a = await src.trace(storeCommands());
    const handlers = liveHandlers(a.hits, a.start);
    let b = await src.trace(execCommands(handlers));
    // A handler that is JMP (pointer): a third pass adds the pointer's bytes.
    const pointers = indirectPointers(b.hits);
    if (pointers.length) b = await src.trace(execCommands(handlers, pointers));
    const result = analyseIrqChain(b.hits, src.timing, b.start);
    result.unknowns.push(...src.unknowns(b));
    return { ok: true, run: src.info(b), result };
  });
}

export async function reFrameProfile(
  args: SourceArgs & { start: string; stop: string },
  opts: RunOpts = {},
): Promise<ReResult<Profile>> {
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
