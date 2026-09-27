/**
 * c64_re_snapshot: dump RAM and I/O at one chosen hit of a session's
 * in_play.pc and decode the VIC-II state from them (src/re/vic-state.ts).
 * Split out of src/tools/re.ts, which held the pass plumbing and grew past
 * the lint line budget; the run itself is one session pass
 * (src/tools/re-session.ts) with three save checkpoints.
 *
 * The RAM dump is the point: a packed game's real code exists only in RAM,
 * under ROM or I/O, once depacked, and only a moment after play starts.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { findHit } from "../re/monlog.ts";
import { parseHex, sessionScript, type MonitorScript, type Session } from "../re/session.ts";
import { decodeSnapshot, type Snapshot } from "../re/vic-state.ts";
import {
  notInPlay,
  screenshotPath,
  SessionInput,
  sessionOf,
  sessionPass,
  withImage,
  type Refusal,
  type RunOpts,
  type Staged,
} from "./re-session.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
    try {
      if (p.play_clock === null) return notInPlay(s, shot);
      const clock = findHit(p.hits, (h) => h.checkpoint === nums.ram)?.clock ?? null;
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
      p.dispose();
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Dumps RAM (`bank ram`, all 64 KB) and I/O (`bank io`, $D000-$DFFF) at a
 * chosen hit of a session's in_play.pc, and decodes VIC-II bank/screen/
 * charset/bitmap/sprite pointers and the CPU port from them.
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
