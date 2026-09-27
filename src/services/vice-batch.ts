/**
 * One headless VICE run driven by a monitor command file: the way every
 * measurement here runs the emulator. The PRG is copied into a fresh work
 * directory, `-moncommands` sets the checkpoints, `-monlog` writes the hits,
 * `-limitcycles` ends the run. Moved from scripts/claims-watch.ts so the
 * reverse-engineering tools and the claims watch share one launcher. A
 * disk is copied into the work directory too and the copy attached, so
 * anything the program writes to it is discarded with the directory. The
 * run is a child process awaited on its exit, so an MCP server calling it
 * keeps serving while VICE runs.
 *
 * Quirks it handles: the windowless x64sc ignores `logname` inside the
 * command file (so -monlogname is on the command line); it echoes every hit
 * to stdout, which fills a pipe (ENOBUFS), so stdout is discarded; a run
 * ended by -limitcycles exits with status 1; the GTK schema directory must
 * be set on macOS/Homebrew; `-autostart` alone seeds its startup delay from
 * the jiffy clock, so the raster line a cold-boot autostart lands on is not
 * stable run to run (measured on a KickAssembler PRG in the windowless
 * x64sc 3.10: cold autostarts traced the same store on different raster lines).
 * `+autostart-delay-random` (scripts/verify-recipes.ts:295) turns that delay
 * off, so two runs of the same PRG hit the same line.
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveX64sc, type X64scChoice } from "./vice-bin.ts";

export type Model = "pal" | "ntsc";

export interface BatchRun {
  prg: string;
  monCommands: string;
  cycles: number;
  model: Model;
  /** A D64 attached as drive 8, through a copy: writes to it are discarded. */
  disk?: string;
  /** Extra x64sc arguments (a recipe's runs.json `flags`: controller ports, an REU, a key buffer). */
  args?: readonly string[];
  /** Stop the emulator once the monitor log passes this many bytes; the result then says truncated. */
  maxLogBytes?: number;
}

export interface BatchResult {
  log: string;
  /** True when maxLogBytes stopped the run before -limitcycles did: the log ends early, its last line may be cut. */
  truncated: boolean;
  work: string;
  dispose(): void;
}

type Reason = "no-prg" | "disk" | "no-x64sc" | "windowed" | "exit" | "no-log";

export class ViceBatchError extends Error {
  reason: Reason;

  constructor(reason: Reason, message: string) {
    super(message);
    this.reason = reason;
  }
}

const SCHEMAS = "/opt/homebrew/share/glib-2.0/schemas";
const TIMEOUT_MS = 600_000;

/**
 * The unknowns line for a pass its maxLogBytes stopped early. Every tool
 * that runs a pass names the cut in its `unknowns`, so a partial trace is
 * never read as a whole one (issue #134).
 */
export function truncatedNote(what = "trace"): string {
  return `${what} stopped early: the monitor log reached its size cap before the cycle limit, so later hits are missing`;
}

function viceArgs(run: BatchRun, log: string): string[] {
  // +autostart-delay-random: cold autostarts land on the same raster line.
  // -raminitrandomchance 0: VICE -default sets RAMInitRandomChance=10, which
  // flips power-on RAM bits with a per-run random seed; two c64_re_snapshot
  // runs at clock 35,080,026 differed at $07EA ($FB vs $FF), and four default
  // irq-chain recipe runs gave two distinct RAM images. Four runs with this
  // flag gave one. Passing it here makes every runBatch caller's RAM
  // byte-for-byte reproducible.
  const args = [
    "-default",
    "+autostart-delay-random",
    "-raminitrandomchance",
    "0",
    "-warp",
    "+sound",
    "-autostartprgmode",
    "1",
  ];
  if (run.model === "ntsc") args.push("-model", "ntsc");
  if (run.disk) args.push("-8", "d.d64");
  args.push(...(run.args ?? []));
  args.push("-moncommands", "watch.mon", "-monlog", "-monlogname", log, "-limitcycles", String(run.cycles));
  args.push("-autostart", "p.prg");
  return args;
}

/** Refusals that need no emulator: the PRG, the disk, which x64sc. */
function checked(run: BatchRun, resolve: () => X64scChoice | null): X64scChoice {
  if (!existsSync(run.prg)) throw new ViceBatchError("no-prg", `no PRG at ${run.prg}`);
  if (run.disk !== undefined && (!run.disk.toLowerCase().endsWith(".d64") || !existsSync(run.disk)))
    throw new ViceBatchError("disk", `not a .d64 file: ${run.disk}`);
  const x64sc = resolve();
  if (!x64sc)
    throw new ViceBatchError("no-x64sc", "x64sc not found (set X64SC_BIN or run `npm run vice:headless`)");
  if (x64sc.windowed && process.env.C64KB_ALLOW_WINDOWED !== "1")
    throw new ViceBatchError("windowed", `${x64sc.path} opens a window; run \`npm run vice:headless\``);
  return x64sc;
}

const LOG_POLL_MS = 100;

/** The log's size in bytes, 0 before it exists. */
const sizeOf = (log: string): number => (existsSync(log) ? statSync(log).size : 0);

/**
 * Run x64sc to its exit; resolves with the status, or null and the error
 * when it did not exit normally. With a cap, the log is polled every
 * LOG_POLL_MS and the emulator killed once it passes: a full-memory trace
 * can write gigabytes before -limitcycles ends the run.
 */
function exitOf(
  bin: string,
  args: string[],
  work: string,
  cap?: { log: string; bytes: number },
): Promise<{ status: number | null; error: string; truncated: boolean }> {
  const env = { ...process.env, GSETTINGS_SCHEMA_DIR: process.env.GSETTINGS_SCHEMA_DIR ?? SCHEMAS };
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: work, env, stdio: "ignore" });
    let error = "";
    let truncated = false;
    const timer = setTimeout(() => {
      error = `killed after ${TIMEOUT_MS / 1000} s`;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    const poll = cap
      ? setInterval(() => {
          if (truncated || sizeOf(cap.log) < cap.bytes) return;
          truncated = true;
          child.kill("SIGKILL");
        }, LOG_POLL_MS)
      : undefined;
    child.on("error", (e) => {
      error = e.message;
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      clearInterval(poll);
      resolve({ status, error, truncated });
    });
  });
}

export async function runBatch(run: BatchRun, resolve = resolveX64sc): Promise<BatchResult> {
  const x64sc = checked(run, resolve);
  const work = mkdtempSync(join(tmpdir(), "vice-batch-"));
  const dispose = () => {
    rmSync(work, { recursive: true, force: true });
  };
  copyFileSync(run.prg, join(work, "p.prg"));
  if (run.disk !== undefined) copyFileSync(run.disk, join(work, "d.d64"));
  writeFileSync(join(work, "watch.mon"), run.monCommands);
  const log = join(work, "trace.log");
  const cap = run.maxLogBytes !== undefined ? { log, bytes: run.maxLogBytes } : undefined;
  const r = await exitOf(x64sc.path, viceArgs(run, log), work, cap);
  if (!r.truncated && r.status !== 0 && r.status !== 1) {
    dispose();
    throw new ViceBatchError("exit", `x64sc exited ${String(r.status)} ${r.error}`);
  }
  if (!existsSync(log)) {
    dispose();
    throw new ViceBatchError("no-log", `x64sc wrote no monitor log at ${log}`);
  }
  return { log, work, dispose, truncated: r.truncated };
}
