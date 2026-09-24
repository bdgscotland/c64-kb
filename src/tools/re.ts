/**
 * Reverse-engineering tools: run a PRG headless in VICE under monitor
 * checkpoints and return observations (docs/superpowers/specs/
 * 2026-09-23-reverse-engineering-design.md). Read-only: each call has its
 * own work directory and x64sc process and holds no port.
 *
 * Paths: in this step only PRGs inside the repository or the OS temp
 * directory are accepted (this repo's recipes and templates, and test
 * builds). Third-party images come in by sha1 through a local manifest in
 * the next step.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { REGION_TIMING, videoRegion } from "../domain/timing.ts";
import { analyseRegion, regionCommands, type Marker, type Profile } from "../re/frame-profile.ts";
import {
  analyseIrqChain,
  execCommands,
  handlersFrom,
  storeCommands,
  type IrqChain,
} from "../re/irq-chain.ts";
import { readHits, type Hit } from "../re/monlog.ts";
import { readPrg } from "../re/prg.ts";
import { runBatch, ViceBatchError, type Model } from "../services/vice-batch.ts";
import { resolveX64sc } from "../services/vice-bin.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface RunInfo {
  prg: string;
  model: Model;
  cycles: number;
  start_clock: number;
  vice: string;
}
export type ReResult<T> =
  { ok: true; run: RunInfo; result: T } | { ok: false; error: string; reason: string };

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
    .describe("A D64 attached as drive 8 (a copy is not made: pass a scratch disk)"),
};
export const IrqChainInput = common;
export const FrameProfileInput = {
  ...common,
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

/** The program's entry clock: the first exec of its SYS target, else 0. */
function entryCommand(prg: string): { cmd: string; entry: number | null } {
  const sys = readPrg(readFileSync(prg)).sys ?? null;
  const hex = sys === null ? "" : sys.toString(16).padStart(4, "0");
  return { cmd: sys === null ? "" : `trace exec ${hex} ${hex}\n`, entry: sys };
}

async function traced(
  prg: string,
  args: { model: Model; cycles: number; disk_path?: string | undefined },
  commands: string,
): Promise<{ hits: Hit[]; start: number }> {
  const { cmd, entry } = entryCommand(prg);
  const run = runBatch({
    prg,
    monCommands: commands + cmd,
    cycles: args.cycles,
    model: args.model,
    ...(args.disk_path ? { disk: args.disk_path } : {}),
  });
  try {
    const all = await collect(run.log);
    const first = entry === null ? undefined : all.find((h) => h.kind === "exec" && h.addr === entry);
    const start = first?.clock ?? 0;
    return { hits: all.filter((h) => h.clock >= start && !(h.kind === "exec" && h.addr === entry)), start };
  } finally {
    run.dispose();
  }
}

function info(prg: string, args: { model: Model; cycles: number }, start: number): RunInfo {
  return {
    prg,
    model: args.model,
    cycles: args.cycles,
    start_clock: start,
    vice: resolveX64sc()?.path ?? "",
  };
}

function refusal(e: unknown): { ok: false; error: string; reason: string } {
  if (e instanceof ViceBatchError) return { ok: false, error: e.message, reason: e.reason };
  throw e;
}

export async function reIrqChain(args: {
  prg_path: string;
  model: Model;
  cycles: number;
  disk_path?: string | undefined;
}): Promise<ReResult<IrqChain>> {
  const prg = allowedPrg(args.prg_path);
  if (!prg) return { ok: false, error: `not an allowed .prg: ${args.prg_path}`, reason: "path" };
  const frame = REGION_TIMING[videoRegion(args.model)].cycles_per_frame;
  try {
    const a = await traced(prg, args, storeCommands());
    const handlers = handlersFrom(analyseIrqChain(a.hits, frame, a.start).vectors);
    const b = await traced(prg, args, execCommands(handlers));
    return { ok: true, run: info(prg, args, b.start), result: analyseIrqChain(b.hits, frame, b.start) };
  } catch (e) {
    return refusal(e);
  }
}

export async function reFrameProfile(args: {
  prg_path: string;
  model: Model;
  cycles: number;
  disk_path?: string | undefined;
  start: string;
  stop: string;
}): Promise<ReResult<Profile>> {
  const prg = allowedPrg(args.prg_path);
  if (!prg) return { ok: false, error: `not an allowed .prg: ${args.prg_path}`, reason: "path" };
  const start = parseMarker(args.start);
  const stop = parseMarker(args.stop);
  if (!start || !stop)
    return { ok: false, error: `bad marker: ${!start ? args.start : args.stop}`, reason: "marker" };
  const frame = REGION_TIMING[videoRegion(args.model)].cycles_per_frame;
  try {
    const t = await traced(prg, args, regionCommands({ start, stop }));
    return {
      ok: true,
      run: info(prg, args, t.start),
      result: analyseRegion(t.hits, { start, stop }, frame, t.start),
    };
  } catch (e) {
    return refusal(e);
  }
}
