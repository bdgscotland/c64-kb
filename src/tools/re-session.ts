/**
 * Session-driven runs: load a session file (src/re/session.ts), resolve its
 * image (src/re/image.ts), replay it from power-on in one batch VICE run,
 * and find the in-play clock. c64_re_session reports that clock; the other
 * RE tools start their analyses there, so the title is never measured as
 * play. Games that wait for fire could not be reached headless before this
 * (Commando's title polls $DC00 at $0FB2 and compares at $0FB5).
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { REGION_TIMING, videoRegion } from "../domain/timing.ts";
import { resolveImage } from "../re/image.ts";
import { readHits, type Hit } from "../re/monlog.ts";
import {
  inPlayClock,
  parseHex,
  SessionSchema,
  sessionScript,
  type MonitorScript,
  type Session,
} from "../re/session.ts";
import { runBatch, ViceBatchError, type BatchRun } from "../services/vice-batch.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SESSIONS_DIR = "docs/game-design/studies/sessions";

export type Refusal = { ok: false; reason: string; error: string; clock?: number; screenshot?: string };

/** Options of a session-driven run: the manifest (tests pass their own) and where exit screenshots go. */
export interface RunOpts {
  manifestPath?: string;
  /** Default data/re/ in the repo. */
  shotDir?: string;
  /** Where c64_re_snapshot renames its RAM dump to <sha1>-<clock>.bin; default data/re/ in the repo. */
  dumpDir?: string;
}

export interface Loaded {
  ok: true;
  session: Session;
  name: string;
  /** The repo-relative path of the file. */
  path: string;
}

/**
 * A session file by repo path (or absolute), only from
 * docs/game-design/studies/sessions/. The path is checked to lie in that
 * directory before the file is looked for, and a path outside it and a
 * missing file get one message, so the refusal says nothing about files
 * elsewhere.
 */
export function loadSession(p: string): Loaded | Refusal {
  const abs = path.resolve(repoRoot, p);
  const dir = path.join(repoRoot, SESSIONS_DIR);
  const refuse = (error: string): Refusal => ({ ok: false, reason: "session", error });
  const inside = (d: string, f: string) => f.startsWith(d + path.sep);
  const notThere = () => refuse(`no session file ${p} under ${SESSIONS_DIR}/`);
  if (!abs.endsWith(".json") || !inside(dir, abs) || !existsSync(abs)) return notThere();
  if (!inside(realpathSync(dir), realpathSync(abs))) return notThere();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(abs, "utf8"));
  } catch (e) {
    return refuse(`${p} is not JSON: ${(e as Error).message}`);
  }
  const parsed = SessionSchema.safeParse(raw);
  if (!parsed.success)
    return refuse(`${p}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return {
    ok: true,
    session: parsed.data,
    name: path.basename(abs, ".json"),
    path: path.relative(repoRoot, abs),
  };
}

/**
 * Exit screenshots of session runs go under data/re/ (gitignored), never
 * docs/, each under a name no other run takes (time and a random tag), so
 * two runs of one session never overwrite each other's screen.
 */
export function screenshotPath(name: string, dir = path.join(repoRoot, "data", "re")): string {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `${name}-${stamp}-${randomBytes(3).toString("hex")}.png`);
}

/** What a session runs: the PRG and, for a D64 image, the working copy of the disk as drive 8. */
export interface Staged {
  prg: string;
  disk?: string;
  image: SessionResult["image"];
}

/**
 * The batch run of one session pass: a D64's copy is attached so a game
 * that loads more files finds them. cyclesOverride runs shorter (or, in
 * principle, longer) than the session's own limitcycles for one pass: load
 * map's full-memory store trace is capped at the first program dispatch
 * plus one frame, far short of a session's own play-reaching length.
 */
export function batchOf(
  staged: Staged,
  s: Session,
  script: MonitorScript,
  opts: { screenshot: string; cyclesOverride?: number; maxLogBytes?: number },
): BatchRun {
  return {
    prg: staged.prg,
    monCommands: script.text(),
    cycles: opts.cyclesOverride ?? s.limitcycles,
    model: s.machine.model,
    ...(staged.disk !== undefined ? { disk: staged.disk } : {}),
    args: ["-exitscreenshot", opts.screenshot],
    ...(opts.maxLogBytes !== undefined ? { maxLogBytes: opts.maxLogBytes } : {}),
  };
}

interface Injected {
  at_pc: string;
  fired_at_clock: number | null;
}

export interface SessionPass {
  /** Hits of the checkpoints the tool added; the session's own are dropped. */
  hits: Hit[];
  play_clock: number | null;
  injections: Injected[];
  unknowns: string[];
  screenshot: string;
}

/** Injection i is checkpoint i + 1: sessionScript writes them first. */
function injectionsOf(all: Hit[], s: Session): Injected[] {
  return s.inject.map((i, k) => ({
    at_pc: i.at_pc,
    fired_at_clock: all.find((h) => h.checkpoint === k + 1)?.clock ?? null,
  }));
}

/**
 * One replay of the session with the tool's checkpoints after its own. The
 * in-play clock is read from every hit but the injections' (an injection on
 * the in-play PC must not stand in for it); the analysis gets toolHits.
 */
export async function sessionPass(
  staged: Staged,
  s: Session,
  script: MonitorScript,
  pass: { screenshot: string; maxLogBytes?: number | undefined },
): Promise<SessionPass> {
  const { screenshot, maxLogBytes } = pass;
  const run = await runBatch(
    batchOf(staged, s, script, { screenshot, ...(maxLogBytes !== undefined ? { maxLogBytes } : {}) }),
  );
  try {
    const all: Hit[] = [];
    for await (const h of readHits(run.log)) all.push(h);
    const injections = injectionsOf(all, s);
    const injected = new Set(s.inject.map((_, k) => k + 1));
    const play_clock = inPlayClock(
      all.filter((h) => h.checkpoint === undefined || !injected.has(h.checkpoint)),
      s,
    );
    const unknowns = injections
      .filter((i) => i.fired_at_clock === null)
      .map(
        (i) => `injection at $${parseHex(i.at_pc).toString(16).toUpperCase().padStart(4, "0")} never fired`,
      );
    return { hits: script.toolHits(all), play_clock, injections, unknowns, screenshot };
  } finally {
    run.dispose();
  }
}

export function notInPlay(s: Session, screenshot: string): Refusal {
  return {
    ok: false,
    reason: "not-in-play",
    error: `in_play not reached: no exec of ${s.in_play.pc} at or after clock ${s.in_play.after_clock} in ${s.limitcycles} cycles; the exit screen is ${screenshot}`,
    clock: s.limitcycles,
    screenshot,
  };
}

function viceRefusal(e: unknown): Refusal {
  if (e instanceof ViceBatchError) return { ok: false, error: e.message, reason: e.reason };
  throw e;
}

export interface SessionResult {
  session: string;
  image: { sha1: string; kind: "prg" | "d64"; file?: string; fileSha1: string };
  model: "pal" | "ntsc";
  cycles: number;
  play_clock: number;
  /** Frames since power-on, counted from raster line 0 (VICE's clock 0 is line 0 cycle 0: its reset stop logs clock 6 at line 0, cycle 6). */
  play_frame: number;
  /** True when the image is a D64 and its working copy was drive 8. */
  disk: boolean;
  injections: Injected[];
  screenshot: string;
  unknowns: string[];
}

/**
 * Runs `run` with the session's image resolved; the work directory is
 * removed afterwards whatever happens.
 */
export async function withImage<T>(
  s: Session,
  manifestPath: string | undefined,
  run: (staged: Staged) => Promise<T | Refusal>,
): Promise<T | Refusal> {
  const r = await resolveImage(
    { sha1: s.image.sha1, ...(s.image.file !== undefined ? { file: s.image.file } : {}) },
    manifestPath,
  );
  if (!r.ok) return { ok: false, reason: r.reason, error: r.error };
  try {
    // resolveImage keeps its copy of the image in the work directory as image.d64.
    const disk = r.image.kind === "d64" ? path.join(r.work, "image.d64") : undefined;
    return await run({ prg: r.prg, image: r.image, ...(disk !== undefined ? { disk } : {}) });
  } catch (e) {
    return viceRefusal(e);
  } finally {
    r.dispose();
  }
}

/** Replays a parsed session: the core of c64_re_session. `name` names the exit screenshot. */
export async function runSession(
  s: Session,
  name: string,
  opts: RunOpts = {},
): Promise<{ ok: true; result: SessionResult } | Refusal> {
  return withImage(s, opts.manifestPath, async (staged) => {
    const shot = screenshotPath(`session-${name}`, opts.shotDir);
    const p = await sessionPass(staged, s, sessionScript(s), { screenshot: shot });
    if (p.play_clock === null) return notInPlay(s, shot);
    const timing = REGION_TIMING[videoRegion(s.machine.model)];
    return {
      ok: true as const,
      result: {
        session: name,
        image: staged.image,
        disk: staged.disk !== undefined,
        model: s.machine.model,
        cycles: s.limitcycles,
        play_clock: p.play_clock,
        play_frame: Math.floor(p.play_clock / timing.cycles_per_frame),
        injections: p.injections,
        screenshot: shot,
        unknowns: p.unknowns,
      },
    };
  });
}

export const SessionInput = {
  session: z
    .string()
    .describe(`A session file: a repo path under ${SESSIONS_DIR}/, e.g. ${SESSIONS_DIR}/commando.json`),
};

export async function reSession(
  args: { session: string },
  opts: RunOpts = {},
): Promise<{ ok: true; result: SessionResult } | Refusal> {
  const l = loadSession(args.session);
  if (!l.ok) return l;
  return runSession(l.session, l.name, opts);
}

export interface SessionRef {
  session: Session;
  name: string;
  /** What run.prg reports: the session file and the image's file, never the deleted temp copy. */
  label: string;
  /** The exit screenshot's name stem. */
  shot: string;
}

/** For the other tools: a session path or (tests) an already-parsed session. */
export function sessionOf(input: string | Session, tool: string): ({ ok: true } & SessionRef) | Refusal {
  if (typeof input !== "string")
    return { ok: true, session: input, name: "(inline)", label: "(inline session)", shot: `${tool}-session` };
  const l = loadSession(input);
  if (!l.ok) return l;
  const file = l.session.image.file;
  return {
    ok: true,
    session: l.session,
    name: l.name,
    label: file === undefined ? l.path : `${l.path}:${file}`,
    shot: `${tool}-${l.name}`,
  };
}
