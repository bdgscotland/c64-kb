/**
 * One headless VICE run driven by a monitor command file: the way every
 * measurement here runs the emulator. The PRG is copied into a fresh work
 * directory, `-moncommands` sets the checkpoints, `-monlog` writes the hits,
 * `-limitcycles` ends the run. Moved from scripts/claims-watch.ts so the
 * reverse-engineering tools and the claims watch share one launcher.
 *
 * Quirks it handles: the windowless x64sc ignores `logname` inside the
 * command file (so -monlogname is on the command line); it echoes every hit
 * to stdout, which fills a pipe (ENOBUFS), so stdout is discarded; a run
 * ended by -limitcycles exits with status 1; the GTK schema directory must
 * be set on macOS/Homebrew; `-autostart` alone seeds its startup delay from
 * the jiffy clock, so the raster line a cold-boot autostart lands on is not
 * stable run to run (docs/reverseengineering task-1 step 1 measured this).
 * `+autostart-delay-random` (scripts/verify-recipes.ts:295) turns that delay
 * off, so two runs of the same PRG hit the same line.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveX64sc } from "./vice-bin.ts";

export type Model = "pal" | "ntsc";

export interface BatchRun {
  prg: string;
  monCommands: string;
  cycles: number;
  model: Model;
  /** A D64 attached as drive 8. */
  disk?: string;
}

export interface BatchResult {
  log: string;
  work: string;
  dispose(): void;
}

export class ViceBatchError extends Error {
  reason: "no-prg" | "no-x64sc" | "windowed" | "exit" | "no-log";

  constructor(reason: "no-prg" | "no-x64sc" | "windowed" | "exit" | "no-log", message: string) {
    super(message);
    this.reason = reason;
  }
}

const SCHEMAS = "/opt/homebrew/share/glib-2.0/schemas";

function viceArgs(run: BatchRun, log: string): string[] {
  const args = ["-default", "+autostart-delay-random", "-warp", "+sound", "-autostartprgmode", "1"];
  if (run.model === "ntsc") args.push("-model", "ntsc");
  if (run.disk) args.push("-8", run.disk);
  args.push("-moncommands", "watch.mon", "-monlog", "-monlogname", log, "-limitcycles", String(run.cycles));
  args.push("-autostart", "p.prg");
  return args;
}

export function runBatch(run: BatchRun): BatchResult {
  if (!existsSync(run.prg)) throw new ViceBatchError("no-prg", `no PRG at ${run.prg}`);
  const x64sc = resolveX64sc();
  if (!x64sc)
    throw new ViceBatchError("no-x64sc", "x64sc not found (set X64SC_BIN or run `npm run vice:headless`)");
  if (x64sc.windowed && process.env.C64KB_ALLOW_WINDOWED !== "1")
    throw new ViceBatchError("windowed", `${x64sc.path} opens a window; run \`npm run vice:headless\``);
  const work = mkdtempSync(join(tmpdir(), "vice-batch-"));
  const dispose = () => {
    rmSync(work, { recursive: true, force: true });
  };
  copyFileSync(run.prg, join(work, "p.prg"));
  writeFileSync(join(work, "watch.mon"), run.monCommands);
  const log = join(work, "trace.log");
  const env = { ...process.env, GSETTINGS_SCHEMA_DIR: process.env.GSETTINGS_SCHEMA_DIR ?? SCHEMAS };
  const r = spawnSync(x64sc.path, viceArgs(run, log), { cwd: work, env, stdio: "ignore", timeout: 600_000 });
  if (r.status !== 0 && r.status !== 1) {
    dispose();
    throw new ViceBatchError("exit", `x64sc exited ${String(r.status)} ${String(r.error ?? "")}`);
  }
  if (!existsSync(log)) {
    dispose();
    throw new ViceBatchError("no-log", `x64sc wrote no monitor log at ${log}`);
  }
  return { log, work, dispose };
}
