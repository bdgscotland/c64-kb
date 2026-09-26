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
import {
  entryFromHits,
  entryWindow,
  findStubs,
  firstProgramDispatch,
  WriterAggregator,
  type Stub,
  type TraceEnd,
  type Writer,
} from "../re/load-map.ts";
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
  /** The first PC run in $0200-$9FFF or $C000-$CFFF after the last stage's last store; null when there is no stage or none ran. */
  entry_pc: number | null;
  transient_vectors: IrqChain["transient"];
  first_program_dispatch_clock: number | null;
  unknowns: string[];
}

/** A hit-count safety net on the parse of the store-0000-ffff trace. */
const MAX_WRITER_HITS = 2_000_000;
/**
 * The emulator is stopped once a pass's monitor log passes this: 256 MiB.
 * Commando's full-memory trace to its first dispatch plus a frame is
 * 148.6 MB (measured here), so its result is inside the cap.
 */
const MAX_LOG_BYTES = 256 * 1024 * 1024;
/** Where entry_pc is looked for: RAM outside the stack page and the ROM and I/O windows, so the log stays small. */
const ENTRY_COMMANDS = "trace exec 0200 9fff\ntrace exec c000 cfff\n";

interface Pass {
  log: string;
  truncated: boolean;
  dispose(): void;
  keep(h: Hit): boolean;
}

/**
 * Where load map's passes run, always from power-on (clock 0): unlike
 * IrqChainInput/FrameProfileInput's Source (src/tools/re.ts), there is no
 * entry or in-play gate (Commando's first program dispatch is ~15.2M
 * cycles into a session whose in_play is ~35M). run() hands back the raw
 * log of one pass, stopped at MAX_LOG_BYTES, for the caller to stream.
 */
interface LoadMapSource {
  runInfo: RunInfo;
  timing: RegionTiming;
  fullCycles: number;
  bytes: Uint8Array;
  run(commands: string, cycles: number): Promise<Pass>;
}

function prgLoadMapSource(prg: string, args: SourceArgs): LoadMapSource {
  const model: Model = args.model ?? "pal";
  const fullCycles = args.cycles ?? 8_000_000;
  const bytes = readFileSync(prg);
  const disk = args.disk_path ? { disk: args.disk_path } : {};
  return {
    runInfo: {
      prg,
      model,
      cycles: fullCycles,
      entry: readPrg(bytes).sys ?? null,
      start_clock: 0,
      vice: resolveX64sc()?.path ?? "",
    },
    timing: REGION_TIMING[videoRegion(model)],
    fullCycles,
    bytes,
    run: async (commands, cycles) => {
      const r = await runBatch({
        prg,
        monCommands: commands,
        cycles,
        model,
        maxLogBytes: MAX_LOG_BYTES,
        ...disk,
      });
      return { ...r, keep: () => true };
    },
  };
}

function sessionLoadMapSource(staged: Staged, l: SessionRef, opts: RunOpts): LoadMapSource {
  const { session: s, name } = l;
  const bytes = readFileSync(staged.prg);
  return {
    runInfo: {
      prg: l.label,
      model: s.machine.model,
      cycles: s.limitcycles,
      entry: readPrg(bytes).sys ?? null,
      start_clock: 0,
      vice: resolveX64sc()?.path ?? "",
      session: name,
      image: staged.image,
    },
    timing: REGION_TIMING[videoRegion(s.machine.model)],
    fullCycles: s.limitcycles,
    bytes,
    run: async (commands, cycles) => {
      const m = sessionScript(s);
      m.add(commands);
      // One exit screenshot per pass, never shared (screenshotPath is unique per call).
      const screenshot = screenshotPath(l.shot, opts.shotDir);
      const batch = batchOf(staged, s, m, { screenshot, cyclesOverride: cycles });
      const r = await runBatch({ ...batch, maxLogBytes: MAX_LOG_BYTES });
      return { ...r, keep: (h: Hit) => m.isToolHit(h) };
    },
  };
}

const truncatedNote = (what: string, cycles: number) =>
  `${what}: the monitor log passed ${MAX_LOG_BYTES} bytes and VICE was stopped before clock ${cycles}; later hits are missing`;

/** A small pass collected into an array; truncation named in unknowns. */
async function collectPass(
  src: LoadMapSource,
  commands: string,
  cycles: number,
  unknowns: string[],
): Promise<Hit[]> {
  const p = await src.run(commands, cycles);
  try {
    if (p.truncated) unknowns.push(truncatedNote("irq-chain pass", cycles));
    return (await collect(p.log)).filter((h) => p.keep(h));
  } finally {
    p.dispose();
  }
}

/**
 * irq-chain.ts's own passes (storeCommands, liveHandlers, execCommands,
 * analyseIrqChain), run from power-on so entries and transients cover the
 * whole boot. The last pass's hits carry the $00/$01 stores that decide
 * ROM or RAM for each handler at its entry.
 */
async function chainFromPowerOn(
  src: LoadMapSource,
  unknowns: string[],
): Promise<{ chain: IrqChain; hits: Hit[] }> {
  const a = await collectPass(src, storeCommands(), src.fullCycles, unknowns);
  const handlers = liveHandlers(a, 0);
  let b = await collectPass(src, execCommands(handlers), src.fullCycles, unknowns);
  // A handler that is JMP (pointer) (Commando's $4134): a third pass adds
  // the pointer's bytes, the same as c64_re_irq_chain.
  const pointers = indirectPointers(b);
  if (pointers.length) b = await collectPass(src, execCommands(handlers, pointers), src.fullCycles, unknowns);
  return { chain: analyseIrqChain(b, src.timing, 0), hits: b };
}

/** The store-0000-ffff trace, streamed and grouped into writers without holding the log; how it ended, for entry_pc. */
async function writersOf(
  src: LoadMapSource,
  capCycles: number,
  unknowns: string[],
): Promise<{ writers: Writer[]; end: TraceEnd }> {
  const big = await src.run("trace store 0000 ffff\n", capCycles);
  try {
    if (big.truncated) unknowns.push(truncatedNote("store trace", capCycles));
    const agg = new WriterAggregator(MAX_WRITER_HITS);
    for await (const h of readHits(big.log)) {
      if (!big.keep(h) || h.kind !== "store") continue;
      if (!agg.add(h)) break;
    }
    if (agg.capped !== null)
      unknowns.push(`store trace capped at ${agg.capped} hits; writers past this point are not included`);
    if (agg.unresolved)
      unknowns.push(
        `${agg.unresolved} stores needed $01 while it was not known (a PC in a ROM window, or a target in $D000-$DFFF): their code generation or I/O-or-RAM target is unresolved; ram_under_io is null on the writers with such a target`,
      );
    const end = { truncated: big.truncated, hitCapped: agg.capped !== null, endClock: capCycles };
    return { writers: agg.finish(), end };
  } finally {
    big.dispose();
  }
}

/** The first PC run in RAM after the last stage's last store: where the depacked program starts. Null from an incomplete trace. */
async function entryPcOf(
  src: LoadMapSource,
  writers: Writer[],
  end: TraceEnd,
  unknowns: string[],
): Promise<number | null> {
  const window = entryWindow(writers, end, src.timing.cycles_per_frame);
  if (window === null) return null;
  if ("unknown" in window) {
    unknowns.push(window.unknown);
    return null;
  }
  const cycles = Math.min(src.fullCycles, window.from + src.timing.cycles_per_frame);
  const p = await src.run(ENTRY_COMMANDS, cycles);
  try {
    const hits = (async function* () {
      for await (const h of readHits(p.log)) if (p.keep(h)) yield h;
    })();
    const r = await entryFromHits(hits, window, p.truncated);
    if ("pc" in r) return r.pc;
    unknowns.push(r.unknown);
    return null;
  } finally {
    p.dispose();
  }
}

async function runLoadMap(src: LoadMapSource): Promise<ReResult<LoadMapResult>> {
  const prg = readPrg(src.bytes);
  const unknowns: string[] = [];
  const { chain, hits } = await chainFromPowerOn(src, unknowns);
  unknowns.push(...chain.unknowns);
  const dispatch = firstProgramDispatch(chain.entries, hits);
  unknowns.push(...dispatch.unknowns);
  if (dispatch.clock === null)
    unknowns.push(
      `no interrupt entered a handler the program installed within ${src.fullCycles} cycles; writers cover the whole run`,
    );
  const capCycles = Math.min(
    src.fullCycles,
    (dispatch.clock ?? src.fullCycles) + src.timing.cycles_per_frame,
  );
  const { writers, end } = await writersOf(src, capCycles, unknowns);
  const entry_pc = await entryPcOf(src, writers, end, unknowns);
  return {
    ok: true,
    run: src.runInfo,
    result: {
      load: prg.load,
      end: prg.end,
      stubs: findStubs(src.bytes, prg.load),
      writers,
      entry_pc,
      transient_vectors: chain.transient,
      first_program_dispatch_clock: dispatch.clock,
      unknowns,
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
