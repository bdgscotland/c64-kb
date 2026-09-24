/** Reverse-engineering tools: observations from a PRG run headless in VICE. */
import { z } from "zod";
import type { Profile } from "../re/frame-profile.ts";
import type { IrqChain } from "../re/irq-chain.ts";
import { FrameProfileInput, IrqChainInput, reFrameProfile, reIrqChain, type ReResult } from "../tools/re.ts";
import { defineTool, READ_ONLY, type ToolReply } from "./define-tool.ts";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

const int = z.number().int();
const obs = { id: z.string(), basis: z.literal("measured-vice"), rung: z.literal(1) };
const vectorName = z.enum(["irq_0314", "nmi_0318", "nmi_fffa", "irq_fffe"]);
const run = z
  .object({
    prg: z.string(),
    model: z.enum(["pal", "ntsc"]),
    cycles: int,
    entry: int.nullable().describe("The BASIC SYS target; null when the PRG has none"),
    start_clock: int.describe("CPU clock of the entry's first exec; 0 when the PRG has no SYS target"),
    vice: z.string(),
  })
  .describe("How the run was made");

export const IrqChainOutput = {
  run,
  vectors: z.array(
    z.object({
      ...obs,
      vector: vectorName,
      value: int.nullable(),
      pc: int,
      clock: int,
      line: int.nullable(),
    }),
  ),
  arms: z.array(z.object({ ...obs, line: int.nullable(), pc: int, clock: int, at_line: int.nullable() })),
  entries: z.array(
    z.object({ ...obs, handler: int, line: int.nullable(), cycle: int.nullable(), clock: int, frame: int }),
  ),
  handlers: z.array(
    z.object({
      handler: int,
      via: z.array(vectorName),
      entries: int,
      entry_lines: z.array(int),
      armed_before: z.array(int),
    }),
  ),
  unknowns: z.array(z.string()),
};

export const FrameProfileOutput = {
  run,
  samples: z.array(z.object({ ...obs, cycles: int, start_clock: int, frame: int })),
  worst: int.nullable(),
  typical: int.nullable(),
  count: int,
  unpaired: int,
  over_frame: int,
  unknowns: z.array(z.string()),
};

/** Text summary plus the whole result as structured content; a refusal is text and isError. */
function reply<T extends object>(r: ReResult<T>, text: (t: T) => string): ToolReply {
  if (!r.ok) return { text: `refused (${r.reason}): ${r.error}`, isError: true };
  const head = `${r.run.prg}, ${r.run.model.toUpperCase()}, ${r.run.cycles} cycles, entry at clock ${r.run.start_clock} (measured-vice, rung 1)\n`;
  return { text: head + text(r.result), structured: { run: r.run, ...r.result } };
}

const unknownsText = (u: string[]) => (u.length ? `\nunknown: ${[...new Set(u)].join("; ")}` : "");

export function irqChainReply(r: ReResult<IrqChain>): ToolReply {
  return reply(
    r,
    (c) =>
      c.handlers
        .map(
          (h) =>
            `handler ${hex(h.handler)} via ${h.via.join(", ") || "?"}: ${h.entries} entries on lines ${h.entry_lines.join(", ")}; armed ${h.armed_before.join(", ") || "?"}`,
        )
        .join("\n") + unknownsText(c.unknowns),
  );
}

export function frameProfileReply(r: ReResult<Profile>): ToolReply {
  return reply(
    r,
    (p) =>
      `samples ${p.count}, worst ${p.worst ?? "none"}, typical ${p.typical ?? "none"} (median), unpaired ${p.unpaired}, over one frame ${p.over_frame}` +
      unknownsText(p.unknowns),
  );
}

const NEEDS = `Needs the windowless x64sc (\`npm run vice:headless\`); refuses a windowed one. The disk is copied; writes are discarded. Refuses (reason "no-entry") when the PRG has a BASIC SYS target that did not run within the cycles given.`;

export const reIrqChainTool = defineTool({
  name: "c64_re_irq_chain",
  title: "Measure a program's interrupt chain in VICE",
  description: `Run a .prg headless in VICE x64sc and report its interrupt chain as observations: every write to the IRQ/NMI vectors ($0314/5, $0318/9, $FFFA/B, $FFFE/F) with the value once both bytes are known; every raster line armed by writes to $D012 and $D011 bit 7; every entry into each handler with its raster line, cycle and frame. Writes before the program's entry (the KERNAL's boot) are not reported but set the starting state. A value the trace cannot know (a read-modify-write, a byte never written) is null and listed under unknowns. A $0314 handler's entry line includes the KERNAL dispatch at $FF48.

A raster flag already pending in $D019 when $D01A is enabled fires at once, so a first entry may sit on a line no arm explains.

${NEEDS}

Inputs: prg_path (inside this repo or the temp directory), model pal|ntsc, cycles, disk_path.
Output (structured): run {prg, model, cycles, entry, start_clock, vice}, handlers [{handler, via, entries, entry_lines, armed_before}], vectors, arms, entries, unknowns; each observation has an id, basis and rung.`,
  inputSchema: IrqChainInput,
  outputSchema: IrqChainOutput,
  annotations: READ_ONLY,
  run: async (args) => irqChainReply(await reIrqChain(args)),
});

export const reFrameProfileTool = defineTool({
  name: "c64_re_frame_profile",
  title: "Measure cycles between two markers in VICE",
  description: `Run a .prg headless in VICE x64sc and time every occurrence of a region, from a start marker to the next stop marker, in CPU cycles (badline and sprite stalls included). A marker is "store:$DC0F=$11" (a store of that value to that address) or "pc:$2000" (an executed PC). Returns worst, typical (median), the count, starts with no stop (unpaired: cut off by the run's end or replaced by a later start), samples longer than one frame (over_frame, kept in worst), and every sample with its frame.

${NEEDS}

Inputs: prg_path, model, cycles, disk_path, start, stop.
Output (structured): run {prg, model, cycles, entry, start_clock, vice}, samples [{id, cycles, start_clock, frame}], worst, typical, count, unpaired, over_frame, unknowns.`,
  inputSchema: FrameProfileInput,
  outputSchema: FrameProfileOutput,
  annotations: READ_ONLY,
  run: async (args) => frameProfileReply(await reFrameProfile(args)),
});
