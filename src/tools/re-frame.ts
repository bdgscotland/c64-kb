/**
 * c64_re_frame_profile's frame mode: where each raster frame's cycles went
 * in a program with no timer of its own (a studied game). Four runs: the
 * irq-chain tool's two discovery passes find the handlers and any JMP
 * (pointer) they read; a full exec trace, capped, finds every RTI the
 * program executes and the wait loop's exit; the last pass traces the
 * handlers, the RTIs and the wait, and analyseFrames (src/re/frame-profile.ts)
 * pairs each interrupt's push with its RTI.
 */
import {
  analyseFrames,
  frameCommands,
  rtiAddresses,
  waitExit,
  type FrameBudget,
  type Wait,
} from "../re/frame-profile.ts";
import { analyseIrqChain, execCommands } from "../re/irq-chain.ts";
import type { Hit } from "../re/monlog.ts";
import type { MonitorScript } from "../re/session.ts";
import { chainPasses, truncationNotes, withSource, type ReResult, type SourceArgs } from "./re.ts";
import type { RunOpts } from "./re-session.ts";

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const hexUp = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

/**
 * The discovery pass's log cap. A full exec trace logs about 130 bytes an
 * instruction (two lines, read off the irq-chain recipe's log), so 64 MB is
 * roughly 500,000 instructions, some 1.5 million cycles or 75 PAL frames
 * after the start (arithmetic). On Commando's session every part's RTI and
 * the $402A wait fall inside it (measured: no interrupt left unreturned).
 */
const DISCOVERY_LOG_BYTES = 64_000_000;

/**
 * A full exec trace, off until the analysis's start PC runs (the SYS target,
 * or the session's in_play.pc): every RTI the program executes and the
 * wait loop's branch are read from it. No start PC: on from power-on.
 */
function discoveryScript(m: MonitorScript, startPc: number | null): void {
  const full = m.checkpoint("trace exec 0000 ffff", startPc === null ? undefined : (n) => [`disable ${n}`]);
  if (startPc === null) return;
  const at = hex4(startPc);
  m.checkpoint(`trace exec ${at} ${at}`, (n) => [`command ${n} "enable ${full}"`]);
}

/** The wait loop from the discovery trace, or why there is none. */
function findWait(hits: Hit[], waitPc: number | null): { wait: Wait | null; unknowns: string[] } {
  if (waitPc === null) return { wait: null, unknowns: [] };
  const exit = waitExit(hits, waitPc);
  if (exit !== null) return { wait: { pc: waitPc, exit }, unknowns: [] };
  return {
    wait: null,
    unknowns: [
      `wait_pc ${hexUp(waitPc)}: not executed in the discovery trace, or no conditional branch back to it at its stack depth within 64 instructions (a loop closed by JMP, or by a forward branch to a JMP, is not found)`,
    ],
  };
}

export async function reFrameMode(
  args: SourceArgs & { wait_pc?: string | undefined },
  opts: RunOpts = {},
): Promise<ReResult<FrameBudget>> {
  const waitPc = args.wait_pc === undefined ? null : parseAddress(args.wait_pc);
  if (Number.isNaN(waitPc)) return { ok: false, error: `bad wait_pc: ${args.wait_pc}`, reason: "input" };
  return withSource(args, "frame-profile", opts, async (src) => {
    const { handlers, pointers } = await chainPasses(src);
    const d = await src.trace(discoveryScript, DISCOVERY_LOG_BYTES);
    const after = d.hits.filter((h) => h.clock >= d.start);
    const rtis = rtiAddresses(after, d.start);
    const { wait, unknowns } = findWait(after, waitPc);
    const f = await src.trace(execCommands(handlers, pointers) + frameCommands(rtis, wait));
    const chain = analyseIrqChain(f.hits, src.timing, f.start);
    const run = src.info(f);
    const result = analyseFrames(f.hits, chain.entries, {
      timing: src.timing,
      startClock: f.start,
      region: run.model,
      rtis,
      wait,
    });
    result.unknowns.push(
      ...unknowns,
      ...truncationNotes(d, "discovery trace (RTIs and the wait loop)"),
      ...chain.unknowns,
      ...src.unknowns(f),
    );
    return { ok: true, run, result };
  });
}

/** "$402A", "402a" or "0x402a" as a 16-bit address; NaN otherwise. */
function parseAddress(s: string): number {
  const m = /^(?:\$|0x)?([0-9a-f]{1,4})$/i.exec(s.trim());
  return m ? parseInt(m[1] ?? "", 16) : NaN;
}
