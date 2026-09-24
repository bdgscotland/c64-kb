/** Reverse-engineering tools: observations from a PRG run headless in VICE. */
import { FrameProfileInput, IrqChainInput, reFrameProfile, reIrqChain, type ReResult } from "../tools/re.ts";
import { defineTool, READ_ONLY, type ToolReply } from "./define-tool.ts";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

function reply<T>(r: ReResult<T>, text: (t: T) => string): ToolReply {
  if (!r.ok) return { text: `refused (${r.reason}): ${r.error}`, isError: true };
  const head = `${r.run.prg}, ${r.run.model.toUpperCase()}, ${r.run.cycles} cycles, entry at clock ${r.run.start_clock} (measured-vice, rung 1)\n`;
  return { text: head + text(r.result) };
}

export const reIrqChainTool = defineTool({
  name: "c64_re_irq_chain",
  title: "Measure a program's interrupt chain in VICE",
  description: `Run a .prg headless in VICE x64sc and report its interrupt chain as observations: every write to the IRQ/NMI vectors ($0314/5, $0318/9, $FFFA/B, $FFFE/F) with the value once both bytes are known; every raster line armed by writes to $D012 and $D011 bit 7; every entry into each handler with its raster line, cycle and frame. A value the trace cannot know (a read-modify-write, a byte never written) is null and listed under unknowns. A $0314 handler's entry line includes the KERNAL dispatch at $FF48.

A raster flag already pending in $D019 when $D01A is enabled fires at once, so a first entry may sit on a line no arm explains.

Inputs: prg_path (inside this repo or the temp directory), model pal|ntsc, cycles, disk_path.
Output: handlers [{handler, via, entries, entry_lines, armed_before}], vectors, arms, entries, unknowns, each observation with an id, basis and rung.`,
  inputSchema: IrqChainInput,
  annotations: READ_ONLY,
  run: async (args) =>
    reply(
      await reIrqChain(args),
      (r) =>
        r.handlers
          .map(
            (h) =>
              `handler ${hex(h.handler)} via ${h.via.join(", ") || "?"}: ${h.entries} entries on lines ${h.entry_lines.join(", ")}; armed ${h.armed_before.join(", ") || "?"}`,
          )
          .join("\n") + (r.unknowns.length ? `\nunknown: ${[...new Set(r.unknowns)].join("; ")}` : ""),
    ),
});

export const reFrameProfileTool = defineTool({
  name: "c64_re_frame_profile",
  title: "Measure cycles between two markers in VICE",
  description: `Run a .prg headless in VICE x64sc and time every occurrence of a region, from a start marker to the next stop marker, in CPU cycles (badline and sprite stalls included). A marker is "store:$DC0F=$11" (a store of that value to that address) or "pc:$2000" (an executed PC). Returns worst, typical (median), the count, starts the run cut off (unpaired), samples longer than one frame (over_frame, kept in worst), and every sample with its frame.

Inputs: prg_path, model, cycles, disk_path, start, stop.`,
  inputSchema: FrameProfileInput,
  annotations: READ_ONLY,
  run: async (args) =>
    reply(
      await reFrameProfile(args),
      (p) =>
        `samples ${p.count}, worst ${p.worst ?? "none"}, typical ${p.typical ?? "none"} (median), unpaired ${p.unpaired}, over one frame ${p.over_frame}`,
    ),
});
