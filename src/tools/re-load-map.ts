/**
 * c64_re_load_map: who wrote where, from power-on. A packed game's
 * depacker writes its output in bulk, often from code in the stack page,
 * and its stores land on every address in their path, vectors included.
 * c64_re_irq_chain cannot tell such a write from a handler install. This
 * tool groups the raw stores by the code that made them
 * (src/re/load-map.ts): on Commando, two depack stages at the same
 * stack-page PCs, a raw 4 KB copy to RAM under I/O, then the game's init.
 */
import { readFileSync } from "node:fs";
import { REGION_TIMING, videoRegion, type RegionTiming } from "../domain/timing.ts";
import {
  analyseIrqChain,
  execCommands,
  indirectPointers,
  liveHandlers,
  storeCommands,
  type IrqChain,
} from "../re/irq-chain.ts";
import { findStubs, firstProgramDispatch, WriterAggregator, type Stub, type Writer } from "../re/load-map.ts";
import { readHits, type Hit } from "../re/monlog.ts";
import { readPrg } from "../re/prg.ts";
import { sessionScript } from "../re/session.ts";
import { runBatch, type Model } from "../services/vice-batch.ts";
import { resolveX64sc } from "../services/vice-bin.ts";
import {
  allowedPrg,
  collect,
  conflict,
  LoadMapInput,
  refusal,
  type ReResult,
  type RunInfo,
  type SourceArgs,
} from "./re.ts";
import {
  batchOf,
  screenshotPath,
  sessionOf,
  withImage,
  type RunOpts,
  type SessionRef,
  type Staged,
} from "./re-session.ts";

export { LoadMapInput };

export interface LoadMapResult {
  load: number;
  end: number;
  stubs: Stub[];
  writers: Writer[];
  transient_vectors: IrqChain["transient"];
  first_program_dispatch_clock: number | null;
  unknowns: string[];
}

/** A hit-count safety net on the big store-0000-ffff trace, for when no dispatch clock can cap it. */
const MAX_WRITER_HITS = 2_000_000;

/**
 * Where load map's passes run, always from power-on (clock 0): unlike
 * IrqChainInput/FrameProfileInput's Source (src/tools/re.ts), there is no
 * entry or in-play gate here (a session's in_play may sit long after the
 * clocks load map cares about: Commando's first program dispatch is
 * ~15.2M cycles into a session whose in_play is ~35M). trace() collects a
 * small-scope pass into an array (Pass A/B, a handful of addresses);
 * bigTrace() hands back the raw log of a (commonly shorter, capped) pass
 * for the caller to stream.
 */
interface LoadMapSource {
  runInfo: RunInfo;
  timing: RegionTiming;
  fullCycles: number;
  bytes: Uint8Array;
  trace(commands: string, cycles: number): Promise<Hit[]>;
  bigTrace(
    commands: string,
    cycles: number,
  ): Promise<{ log: string; dispose(): void; keep(h: Hit): boolean }>;
}

function prgLoadMapSource(prg: string, args: SourceArgs): LoadMapSource {
  const model: Model = args.model ?? "pal";
  const fullCycles = args.cycles ?? 8_000_000;
  const bytes = readFileSync(prg);
  const entry = readPrg(bytes).sys ?? null;
  const disk = args.disk_path ? { disk: args.disk_path } : {};
  const runOne = (commands: string, cycles: number) =>
    runBatch({ prg, monCommands: commands, cycles, model, ...disk });
  return {
    runInfo: { prg, model, cycles: fullCycles, entry, start_clock: 0, vice: resolveX64sc()?.path ?? "" },
    timing: REGION_TIMING[videoRegion(model)],
    fullCycles,
    bytes,
    trace: async (commands, cycles) => {
      const r = await runOne(commands, cycles);
      try {
        return await collect(r.log);
      } finally {
        r.dispose();
      }
    },
    bigTrace: async (commands, cycles) => {
      const r = await runOne(commands, cycles);
      return {
        log: r.log,
        dispose: () => {
          r.dispose();
        },
        keep: () => true,
      };
    },
  };
}

function sessionLoadMapSource(staged: Staged, l: SessionRef, opts: RunOpts): LoadMapSource {
  const { session: s, name } = l;
  const { prg, image } = staged;
  const bytes = readFileSync(prg);
  const entry = readPrg(bytes).sys ?? null;
  const fullCycles = s.limitcycles;
  const shot = screenshotPath(l.shot, opts.shotDir);
  const runOne = async (commands: string, cycles: number) => {
    const m = sessionScript(s);
    m.add(commands);
    const r = await runBatch(batchOf(staged, s, m, { screenshot: shot, cyclesOverride: cycles }));
    return { r, m };
  };
  return {
    runInfo: {
      prg: l.label,
      model: s.machine.model,
      cycles: fullCycles,
      entry,
      start_clock: 0,
      vice: resolveX64sc()?.path ?? "",
      session: name,
      image,
    },
    timing: REGION_TIMING[videoRegion(s.machine.model)],
    fullCycles,
    bytes,
    trace: async (commands, cycles) => {
      const { r, m } = await runOne(commands, cycles);
      try {
        return (await collect(r.log)).filter((h) => m.isToolHit(h));
      } finally {
        r.dispose();
      }
    },
    bigTrace: async (commands, cycles) => {
      const { r, m } = await runOne(commands, cycles);
      return {
        log: r.log,
        dispose: () => {
          r.dispose();
        },
        keep: (h: Hit) => m.isToolHit(h),
      };
    },
  };
}

/**
 * The dispatch/interrupt-detection irq-chain.ts already has (storeCommands,
 * liveHandlers, execCommands, analyseIrqChain), run here from power-on
 * (startClock 0, never an entry or play clock) so its entries and
 * transient list cover the whole boot: firstProgramDispatch picks the
 * first entry below KERNAL ROM out of them, not re-derived.
 */
async function chainFromPowerOn(src: LoadMapSource): Promise<IrqChain> {
  const a = await src.trace(storeCommands(), src.fullCycles);
  const handlers = liveHandlers(a, 0);
  let b = await src.trace(execCommands(handlers), src.fullCycles);
  // A handler that is JMP (pointer) (Commando's $4134): a third pass adds
  // the pointer's bytes, the same as c64_re_irq_chain, so its entries carry
  // a resolved target instead of thousands of "pointer not known" unknowns.
  const pointers = indirectPointers(b);
  if (pointers.length) b = await src.trace(execCommands(handlers, pointers), src.fullCycles);
  return analyseIrqChain(b, src.timing, 0);
}

/** The big store-0000-ffff trace, streamed and grouped into writers without ever holding the whole log. */
async function writersOf(
  src: LoadMapSource,
  capCycles: number,
): Promise<{ writers: Writer[]; unknowns: string[] }> {
  const big = await src.bigTrace("trace store 0000 ffff\n", capCycles);
  try {
    const agg = new WriterAggregator(MAX_WRITER_HITS);
    for await (const h of readHits(big.log)) {
      if (!big.keep(h)) continue;
      if (h.kind !== "store") continue;
      if (!agg.add(h)) break;
    }
    const unknowns: string[] = [];
    if (agg.capped !== null)
      unknowns.push(`store trace capped at ${agg.capped} hits; writers past this point are not included`);
    if (agg.portUnknown)
      unknowns.push(
        "a store to $01 did not show its value: ROM mapping and ram_under_io after it are not known",
      );
    return { writers: agg.finish(), unknowns };
  } finally {
    big.dispose();
  }
}

async function runLoadMap(src: LoadMapSource): Promise<ReResult<LoadMapResult>> {
  const prg = readPrg(src.bytes);
  const stubs = findStubs(src.bytes, prg.load);
  const chain = await chainFromPowerOn(src);
  const dispatchClock = firstProgramDispatch(chain.entries);
  const unknowns = [...chain.unknowns];
  if (dispatchClock === null)
    unknowns.push(
      `no interrupt entered a handler below $E000 within ${src.fullCycles} cycles; writers cover the whole run`,
    );
  const capCycles = Math.min(src.fullCycles, (dispatchClock ?? src.fullCycles) + src.timing.cycles_per_frame);
  const w = await writersOf(src, capCycles);
  return {
    ok: true,
    run: src.runInfo,
    result: {
      load: prg.load,
      end: prg.end,
      stubs,
      writers: w.writers,
      transient_vectors: chain.transient,
      first_program_dispatch_clock: dispatchClock,
      unknowns: [...unknowns, ...w.unknowns],
    },
  };
}

/**
 * The load map of a packed program: its BASIC stub(s), every writer found
 * in a full-memory store trace from power-on (grouped by the PC that wrote,
 * with a stack-page flag for a decruncher relocated there), the vector
 * values a write left with no interrupt ever finding them (transient:
 * bulk-copy noise, not an install), and the clock of the first entry into a
 * handler the program itself installed. One run per pass: storeCommands()
 * and execCommands() from irq-chain.ts find that first dispatch cheaply
 * (a handful of addresses); the big store 0000-ffff trace then runs capped
 * at dispatch clock + one frame (or the source's own cycles, with the
 * dispatch never found named in unknowns), streamed hit by hit.
 */
export async function reLoadMap(args: SourceArgs, opts: RunOpts = {}): Promise<ReResult<LoadMapResult>> {
  if ((args.prg_path === undefined) === (args.session === undefined))
    return { ok: false, error: "give exactly one of prg_path and session", reason: "input" };
  if (args.session !== undefined) {
    const l = sessionOf(args.session, "load-map");
    if (!l.ok) return l;
    const bad = conflict(args, l.session);
    if (bad) return { ok: false, error: bad, reason: "input" };
    return withImage(l.session, opts.manifestPath, async (staged) => {
      try {
        return await runLoadMap(sessionLoadMapSource(staged, l, opts));
      } catch (e) {
        return refusal(e);
      }
    });
  }
  const prg = allowedPrg(args.prg_path ?? "");
  if (!prg) return { ok: false, error: `not an allowed .prg: ${args.prg_path}`, reason: "path" };
  try {
    return await runLoadMap(prgLoadMapSource(prg, args));
  } catch (e) {
    return refusal(e);
  }
}
