/** Reverse-engineering tools: observations from a PRG run headless in VICE. */
import { z } from "zod";
import { waitLabel, type FrameBudget, type Profile, type Stat } from "../re/frame-profile.ts";
import type { IrqChain } from "../re/irq-chain.ts";
import { DISPATCH_WINDOW } from "../re/interrupts.ts";
import {
  FrameProfileInput,
  IrqChainInput,
  reFrameProfile,
  reIrqChain,
  reSnapshot,
  SnapshotInput,
  type ReResult,
  type SnapshotResult,
} from "../tools/re.ts";
import { reFrameMode } from "../tools/re-frame.ts";
import { LoadMapInput, reLoadMap, type LoadMapResult } from "../tools/re-load-map.ts";
import { CoverageInput, reCoverage, type Coverage } from "../tools/re-coverage.ts";
import {
  reSession,
  SessionInput,
  SESSIONS_DIR,
  type Refusal,
  type SessionResult,
} from "../tools/re-session.ts";
import { defineTool, READ_ONLY, type ToolReply } from "./define-tool.ts";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");
const hex2 = (n: number) => "$" + n.toString(16).toUpperCase().padStart(2, "0");

const int = z.number().int();
const obs = { id: z.string(), basis: z.literal("measured-vice"), rung: z.literal(1) };
const vectorName = z.enum(["irq_0314", "nmi_0318", "nmi_fffa", "irq_fffe"]);
const image = z.object({
  sha1: z.string(),
  kind: z.enum(["prg", "d64"]),
  file: z.string().optional(),
  fileSha1: z.string().describe("sha1 of the PRG that ran (the file read from a D64)"),
});
const run = z
  .object({
    prg: z.string(),
    model: z.enum(["pal", "ntsc"]),
    cycles: int,
    entry: int.nullable().describe("The BASIC SYS target; null when the PRG has none"),
    start_clock: int.describe(
      "CPU clock of the entry's first exec; 0 when the PRG has no SYS target; with a session, its in-play clock",
    ),
    vice: z.string(),
    session: z.string().optional().describe("The session file's name, for a session-driven run"),
    image: image.optional(),
  })
  .describe("How the run was made");

export const IrqChainOutput = {
  run,
  interrupts: int.describe(
    "Interrupts raised after the entry, found from their stack pushes; BRK is not one",
  ),
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
    z.object({
      ...obs,
      handler: int,
      target: int.nullable().describe("For a JMP (pointer) handler, the pointer's value at this entry"),
      line: int.nullable(),
      cycle: int.nullable(),
      clock: int,
      frame: int,
    }),
  ),
  handlers: z.array(
    z.object({
      handler: int,
      via: z.array(vectorName),
      entries: int,
      entry_lines: z.array(int),
      armed_before: z.array(int),
      pointer: int.nullable().describe("The pointer when the handler's first instruction is JMP (pointer)"),
      dispatch: z
        .array(z.object({ target: int, entries: int, entry_lines: z.array(int), armed_before: z.array(int) }))
        .describe("A JMP (pointer) handler's entries by the address the pointer named at each"),
    }),
  ),
  transient: z
    .array(z.object({ vector: vectorName, value: int, writes: int }))
    .describe("Vector values a write left that no interrupt found: a half-written address, not a handler"),
  unknowns: z.array(z.string()),
};

const stat = z.object({
  worst: int.nullable(),
  typical: int.nullable().describe("median"),
  least: int.nullable(),
});

export const FrameProfileOutput = {
  run,
  mode: z.enum(["region", "frame"]),
  // Region mode.
  samples: z.array(z.object({ ...obs, cycles: int, start_clock: int, frame: int })).optional(),
  worst: int.nullable().optional(),
  typical: int.nullable().optional(),
  count: int.optional(),
  unpaired: int.optional(),
  over_frame: int.optional(),
  // Frame mode.
  frames: z
    .array(
      z.object({
        ...obs,
        frame: int,
        start_clock: int,
        handlers: int.describe("Cycles inside interrupts, a nested one once"),
        interrupts: int.describe("Interrupts that started in this frame, nested ones included"),
        idle: int.nullable().describe("Cycles in the wait loop outside interrupts; null without a wait"),
        main: int.nullable().describe("frame - handlers - idle; null without a wait"),
        rest: int.describe("frame - handlers: main and idle together"),
      }),
    )
    .optional(),
  parts: z
    .array(
      z.object({
        handler: int,
        target: int.nullable().describe("A JMP (pointer) handler's target at these entries"),
        slot: int.describe("The n-th entry of this handler and target in its frame, from 0"),
        entries: int,
        entry_lines: z.array(int),
        cost: stat.describe("Interrupt sequence to the end of RTI, nested interrupts taken out"),
        dispatch: stat.describe("Interrupt sequence to the handler's first instruction"),
      }),
    )
    .optional(),
  per_frame: z
    .object({ handlers: stat, rest: stat, main: stat.nullable(), idle: stat.nullable() })
    .optional(),
  measured_frame: z
    .string()
    .nullable()
    .optional()
    .describe('The **Measured frame:** figures, frame minus idle: "play pal worst=N typical=N"'),
  wait: z.object({ pc: int, exit: int }).nullable().optional(),
  interrupts: int.optional(),
  unreturned: int.optional().describe("Interrupts that reached no traced RTI; left out of the sums"),
  unknowns: z.array(z.string()),
};

export const SessionOutput = {
  session: z.string(),
  image,
  model: z.enum(["pal", "ntsc"]),
  cycles: int,
  play_clock: int.describe("CPU clock of the first exec of in_play.pc at or after in_play.after_clock"),
  play_frame: int.describe("Frames since power-on at play_clock, counted from raster line 0"),
  disk: z.boolean().describe("True when the image is a D64 and its working copy was attached as drive 8"),
  injections: z.array(z.object({ at_pc: z.string(), fired_at_clock: int.nullable() })),
  screenshot: z.string().describe("The exit screenshot, under data/re/ (gitignored)"),
  unknowns: z.array(z.string()),
};

export const SnapshotOutput = {
  ram_path: z.string().describe("The RAM dump, under data/re/ (gitignored): <ram_sha1>-<clock>.bin"),
  ram_sha1: z.string(),
  clock: int.describe("CPU clock of the dump: the (after_hits_of_play_pc + 1)th exec of in_play.pc"),
  vic: z.object({
    bank: int.describe("0-3, from $DD00 bits 0-1 inverted"),
    screen: int,
    charset: int,
    bitmap: int,
    sprite_pointers: z.array(int).length(8),
    d011: int,
    d016: int,
    d018: int,
  }),
  cpu_port: z.object({ "00": int, "01": int }),
};

export const LoadMapOutput = {
  run,
  load: int.describe("The PRG's own load address"),
  end: int,
  stubs: z
    .array(z.object({ ...obs, addr: int, sys: int, text: z.string(), line: int.nullable() }))
    .describe(
      "$9E (the SYS token) + digits + text, from the program's own linked BASIC line(s) and any other occurrence found in the image (a second stub buried in packed data). line is the BASIC line number when the header is readable (a depacker can use it as its output pointer: Commando's are 2049 = $0801 and 65535 = $FFFF)",
    ),
  writers: z.array(
    z.object({
      ...obs,
      pc_range: z.object({ start: int, end: int }),
      dest_ranges: z.array(z.object({ start: int, end: int })),
      stores: int,
      first_clock: int,
      last_clock: int,
      in_stack_page: z
        .boolean()
        .describe("The writer's own code runs from $0100-$01FF: a relocator surviving the block it unpacks"),
      ram_under_io: z
        .array(z.object({ start: int, end: int }))
        .nullable()
        .describe(
          "Parts of dest_ranges in $D000-$DFFF written while $01 banked I/O out: RAM, not the chips. Null when a store there was made with $01 unknown (named in unknowns)",
        ),
      stage: int
        .nullable()
        .describe(
          "1, 2, ... for writers whose code runs from the stack page, in clock order (depack stages); null otherwise",
        ),
    }),
  ),
  entry_pc: int
    .nullable()
    .describe(
      "The first PC run in $0200-$9FFF or $C000-$CFFF after the last stage's last store (where the depacked program starts); null when there is no stage, when a trace was stopped early or ended within a frame of the last stage (reason in unknowns), or when the entry is outside those ranges",
    ),
  transient_vectors: z
    .array(z.object({ vector: vectorName, value: int, writes: int }))
    .describe(
      "Vector values a write left that no interrupt found: a bulk copy's incidental stop on $FFFA-$FFFF, not a handler install",
    ),
  first_program_dispatch_clock: int
    .nullable()
    .describe(
      "Clock of the first entry into a handler in RAM ($00/$01 at the entry decide ROM or RAM), or null",
    ),
  unknowns: z.array(z.string()),
};

const refusedText = (r: Refusal): ToolReply => ({
  text: `refused (${r.reason}): ${r.error}`,
  isError: true,
});

export function sessionReply(r: { ok: true; result: SessionResult } | Refusal): ToolReply {
  if (!r.ok) return refusedText(r);
  const s = r.result;
  const fired = s.injections
    .map(
      (i) => `${i.at_pc} ${i.fired_at_clock === null ? "never fired" : `fired at clock ${i.fired_at_clock}`}`,
    )
    .join("; ");
  return {
    text:
      `${s.session}: ${s.image.kind} ${s.image.sha1}${s.image.file ? ` "${s.image.file}"` : ""}, ${s.model.toUpperCase()}, ${s.cycles} cycles (measured-vice, rung 1)\n` +
      `in play at clock ${s.play_clock}, frame ${s.play_frame}\ninjections: ${fired || "none"}\nscreenshot: ${s.screenshot}` +
      unknownsText(s.unknowns),
    structured: { ...s },
  };
}

export function snapshotReply(r: { ok: true; result: SnapshotResult } | Refusal): ToolReply {
  if (!r.ok) return refusedText(r);
  const s = r.result;
  const v = s.vic;
  return {
    text:
      `${s.ram_path} sha1 ${s.ram_sha1}, clock ${s.clock} (measured-vice, rung 1)\n` +
      `VIC bank ${v.bank}: screen ${hex(v.screen)}, charset ${hex(v.charset)}, bitmap ${hex(v.bitmap)}\n` +
      `sprite pointers: ${v.sprite_pointers.map(hex).join(", ")}\n` +
      `D011 ${hex2(v.d011)}, D016 ${hex2(v.d016)}, D018 ${hex2(v.d018)}\n` +
      `CPU port $00=${hex2(s.cpu_port["00"])} $01=${hex2(s.cpu_port["01"])}`,
    structured: { ...s },
  };
}

/** Text summary plus the whole result as structured content; a refusal is text and isError. */
function reply<T extends object>(r: ReResult<T>, text: (t: T) => string): ToolReply {
  if (!r.ok) return refusedText(r);
  const head = `${r.run.prg}, ${r.run.model.toUpperCase()}, ${r.run.cycles} cycles, entry at clock ${r.run.start_clock} (measured-vice, rung 1)\n`;
  return { text: head + text(r.result), structured: { run: r.run, ...r.result } };
}

const unknownsText = (u: string[]) => (u.length ? `\nunknown: ${[...new Set(u)].join("; ")}` : "");

const handlerText = (h: IrqChain["handlers"][number]) =>
  `handler ${hex(h.handler)} via ${h.via.join(", ") || "?"}: ${h.entries} entries on lines ${h.entry_lines.join(", ")}; armed ${h.armed_before.join(", ") || "?"}` +
  (h.pointer === null ? "" : `; JMP (${hex(h.pointer)})`) +
  h.dispatch
    .map(
      (d) =>
        `\n  -> ${hex(d.target)}: ${d.entries} entries on lines ${d.entry_lines.join(", ")}; armed ${d.armed_before.join(", ") || "?"}`,
    )
    .join("");

export function irqChainReply(r: ReResult<IrqChain>): ToolReply {
  return reply(
    r,
    (c) =>
      c.handlers.map(handlerText).join("\n") +
      (c.transient.length
        ? `\ntransient: ${c.transient.map((t) => `${hex(t.value)} in ${t.vector}`).join(", ")}`
        : "") +
      unknownsText(c.unknowns),
  );
}

export function frameProfileReply(r: ReResult<Profile>): ToolReply {
  return reply(
    r.ok ? { ...r, result: { mode: "region" as const, ...r.result } } : r,
    (p) =>
      `samples ${p.count}, worst ${p.worst ?? "none"}, typical ${p.typical ?? "none"} (median), unpaired ${p.unpaired}, over one frame ${p.over_frame}` +
      unknownsText(p.unknowns),
  );
}

const statText = (s: Stat | null) =>
  s ? `${s.typical ?? "?"} typical, ${s.worst ?? "?"} worst` : "not known";

const partText = (p: FrameBudget["parts"][number]) =>
  `${hex(p.handler)}${p.target === null ? "" : ` -> ${hex(p.target)}`}${p.slot ? ` slot ${p.slot}` : ""}: ` +
  `${p.entries} entries on lines ${p.entry_lines.join(", ") || "?"}; cost ${statText(p.cost)}; dispatch ${p.dispatch.typical ?? "?"}`;

export function frameModeReply(r: ReResult<FrameBudget>): ToolReply {
  const source = r.ok ? (r.run.session ?? r.run.prg) : "";
  return reply(r, (b) => {
    const f = b.per_frame;
    return (
      `${b.frames.length} frames, ${b.interrupts} interrupts (${b.unreturned} with no RTI)\n` +
      b.parts.map(partText).join("\n") +
      `\nper frame: handlers ${statText(f.handlers)}; main ${statText(f.main)}; idle ${statText(f.idle)}; main+idle ${statText(f.rest)}` +
      (b.wait ? `\nwait ${waitLabel(b.wait)}` : "") +
      (b.measured_frame
        ? `\n**Measured frame:** ${b.measured_frame} (measured-vice-study, c64_re_frame_profile frame mode, frame minus the ${b.wait ? waitLabel(b.wait) : ""} wait over ${b.frames.length} frames, ${source})`
        : "") +
      unknownsText(b.unknowns)
    );
  });
}

const NEEDS = `Needs the windowless x64sc (\`npm run vice:headless\`); refuses a windowed one. The disk is copied; writes are discarded. Refuses (reason "no-entry") when the PRG has a BASIC SYS target that did not run within the cycles given.`;

const SESSION_INPUT = `Give prg_path or session, not both. A session (a file under ${SESSIONS_DIR}/, see c64_re_session) names a third-party image by sha1 in the local manifest; the run replays it with its register injections, the analysis starts at its in-play clock (hits before it only set the starting state) and model and cycles come from the file: a model or cycles that differ from it, or a disk_path, are refused (reason "input"); a D64 image's working copy is drive 8. The session's own checkpoints (injections, the in-play trace) never enter the analysis. Refuses "not-in-play" with the exit screenshot when the in-play PC does not run, never measuring the title as play; an injection that never fired is named under unknowns.`;

export const reIrqChainTool = defineTool({
  name: "c64_re_irq_chain",
  title: "Measure a program's interrupt chain in VICE",
  description: `Run a .prg headless in VICE x64sc and report its interrupt chain as observations: every write to the IRQ/NMI vectors ($0314/5, $0318/9, $FFFA/B, $FFFE/F) with the value once both bytes are known; every raster line armed by writes to $D012 and $D011 bit 7; every interrupt, found from its three stack pushes; every entry into each handler with its raster line, cycle and frame. An entry is the first handler the vectors held at an interrupt to run within ${DISPATCH_WINDOW} cycles of it, so code that merely reaches a handler's address (an IRQ exit falling into \`nmi: rti\`) is not counted. A vector value no interrupt found, such as the half-written address between a low-byte and a high-byte store, is listed under transient, not as a handler; a handler the program installed that no interrupt entered is listed with 0 entries. Writes before the program's entry (the KERNAL's boot) are not reported but set the starting state. A value the trace cannot know (a read-modify-write, a byte never written) is null and listed under unknowns. The vectors an interrupt reads follow the banking: $0314/$0318 when $00 and $01 map the KERNAL, $FFFE/$FFFA RAM when they do not; when $00/$01 cannot be known, both, named under unknowns. When $FFFE and $FFFA name the same RAM handler, IRQ and NMI cannot be told apart: via lists both, neither value is transient, and the interrupt is named under unknowns. A $0314 handler's entry line includes the KERNAL dispatch at $FF48. When a handler's first instruction is JMP (pointer), each entry also names the pointer's value at that moment (target), and the handler's dispatch list counts entries per target: the sub-handlers of a chain that rewrites one pointer, not the vector (a third run traces the pointer's two bytes).

A raster flag already pending in $D019 when $D01A is enabled fires at once, so a first entry may sit on a line no arm explains.

${NEEDS}

${SESSION_INPUT}

Inputs: prg_path (inside this repo or the temp directory) or session, model pal|ntsc, cycles, disk_path.
Output (structured): run {prg, model, cycles, entry, start_clock, vice, session?, image?}, interrupts, handlers [{handler, via, entries, entry_lines, armed_before, pointer, dispatch [{target, entries, entry_lines, armed_before}]}], transient [{vector, value, writes}], vectors, arms, entries (with target), unknowns; each observation has an id, basis and rung.`,
  inputSchema: IrqChainInput,
  outputSchema: IrqChainOutput,
  annotations: READ_ONLY,
  readsGraph: false,
  run: async (args) => irqChainReply(await reIrqChain(args)),
});

export const reFrameProfileTool = defineTool({
  name: "c64_re_frame_profile",
  title: "Measure cycles between two markers, or a whole frame's budget, in VICE",
  description: `Run a .prg headless in VICE x64sc and measure CPU cycles (badline and sprite stalls included).

mode "region" (default): time every occurrence of a region, from a start marker to the next stop marker. A marker is "store:$DC0F=$11" (a store of that value to that address) or "pc:$2000" (an executed PC). Returns worst, typical (median), the count, starts with no stop (unpaired: cut off by the run's end or replaced by a later start), samples longer than one frame (over_frame, kept in worst), and every sample with its frame.

mode "frame": no markers, for a program with no timer of its own. Per raster frame (from line 0): cycles inside interrupts, and with wait_pc (the first instruction of the main loop's frame wait) the idle cycles in that loop outside interrupts and main = frame - handlers - idle; without it main and idle are one figure (rest). Per part (a handler, or a JMP (pointer) handler's target, by its order of entry in the frame): cost from the start of the interrupt sequence to the end of its RTI, nested interrupts taken out, and dispatch, the start of the sequence to the handler's first instruction: 7 cycles of sequence plus 29 for the KERNAL's $FF48 stub on a $0314 handler (36 measured); a JMP (pointer) handler's own 5 cycles count in its target's cost. Worst, typical (median) and least of each, and measured_frame in the **Measured frame:** shape (frame minus idle). Four runs: the two irq-chain discovery passes, a full exec trace capped at 64 MB from the start PC that finds every RTI and the wait's exit (the instruction after its conditional branch back; a wait closed by JMP, or by a forward branch to a JMP, is not found and main and idle stay one figure), and the measuring pass. An interrupt's RTI is the first one executed at its push's stack depth; one with none is counted under unreturned and left out.

${NEEDS}

${SESSION_INPUT}

Inputs: prg_path or session, model, cycles, disk_path, mode, start and stop (region), wait_pc (frame).
Output (structured): run {prg, model, cycles, entry, start_clock, vice, session?, image?}, mode, unknowns; region: samples [{id, cycles, start_clock, frame}], worst, typical, count, unpaired, over_frame; frame: frames [{id, frame, start_clock, handlers, interrupts, idle, main, rest}], parts [{handler, target, slot, entries, entry_lines, cost, dispatch}], per_frame {handlers, rest, main, idle}, measured_frame, wait, interrupts, unreturned.`,
  inputSchema: FrameProfileInput,
  outputSchema: FrameProfileOutput,
  annotations: READ_ONLY,
  readsGraph: false,
  run: async (args) =>
    args.mode === "frame"
      ? frameModeReply(await reFrameMode(args))
      : frameProfileReply(await reFrameProfile(args)),
});

export const reSessionTool = defineTool({
  name: "c64_re_session",
  title: "Replay a game session to play in VICE",
  description: `Replay a session file headless in VICE x64sc and report when the game reached play. A session (${SESSIONS_DIR}/<game>.json) names the image by sha1 (a PRG, or a file on a D64) in the local manifest data/games/manifest.json, which is never committed; it lists register injections, each a trace checkpoint on the game's own read instruction that sets A, X or Y on every pass after the first N (a title that polls $DC00 for fire, CMP #$6F: set A = $6F there; no key or joystick reaches a batch run; a game that returns to its title and polls there gets fire again at once); an in_play check (the first exec of a PC at or after a clock); and the run length. Hit counts are decimal in the file and hex to the monitor (VICE reads \`ignore 1 1000\` as 4,096 hits).

A D64's working copy is attached as drive 8, so a game that loads more files finds them. Returns play_clock (the in-play exec), play_frame (frames since power-on from raster line 0), each injection's first firing clock (null and named under unknowns when its PC never ran with the count reached), and the exit screenshot under data/re/ (a new name each run). Refuses "not-in-play" with the clock reached and the exit screenshot when the in-play check fails; "session" for a file outside ${SESSIONS_DIR}/ or one that does not parse; the image refusals (no-manifest, unknown-sha1, image-changed, no-file, not-prg, c1541-failed) before any run.

Needs the windowless x64sc (\`npm run vice:headless\`), and c1541 for a D64.

Inputs: session.
Output (structured): session, image {sha1, kind, file, fileSha1}, disk, model, cycles, play_clock, play_frame, injections [{at_pc, fired_at_clock}], screenshot, unknowns.`,
  inputSchema: SessionInput,
  outputSchema: SessionOutput,
  annotations: READ_ONLY,
  readsGraph: false,
  run: async (args) => sessionReply(await reSession(args)),
});

export const reSnapshotTool = defineTool({
  name: "c64_re_snapshot",
  title: "Dump RAM and I/O at a chosen moment of play in VICE",
  description: `Replay a session file headless in VICE x64sc to play, then dump all 64 KB of RAM (\`bank ram\`, under ROM and I/O) and the I/O area $D000-$DFFF (\`bank io\`) at a chosen hit of the session's in_play.pc, and decode the VIC-II bank, screen, char and bitmap base, the eight sprite data pointers, and the CPU port from them. A packed game's real code exists only in RAM, decrunched, after play starts: this is the tool that catches it at a known moment.

after_hits_of_play_pc (default 0) counts hits of in_play.pc to skip before the dump, decimal in the call and hex to the monitor, the same as a session injection's after_hits; it is not gated by in_play.after_clock, so a PC that also runs before real play (unlike Commando's one-shot $0FEB exit) needs a caller-chosen count. Refuses "not-in-play" (with the clock reached and the exit screenshot) when in_play.pc never runs at all; "no-dump" (with play_clock, the clock reached, and the exit screenshot) when it runs, but fewer than after_hits_of_play_pc + 1 times, so the dump was never taken.

Needs the windowless x64sc (\`npm run vice:headless\`), and c1541 for a D64. The RAM dump is written under data/re/ (gitignored) as <ram_sha1>-<clock>.bin; a later call with a later clock does not overwrite an earlier dump.

Inputs: session (a file under ${SESSIONS_DIR}/, see c64_re_session), after_hits_of_play_pc.
Output (structured): ram_path, ram_sha1, clock, vic {bank, screen, charset, bitmap, sprite_pointers, d011, d016, d018}, cpu_port {"00", "01"}.`,
  inputSchema: SnapshotInput,
  outputSchema: SnapshotOutput,
  annotations: READ_ONLY,
  readsGraph: false,
  run: async (args) => snapshotReply(await reSnapshot(args)),
});

const stubText = (s: LoadMapResult["stubs"][number]) =>
  `${hex(s.addr)}${s.line === null ? "" : ` line ${s.line}`} SYS ${s.sys}${s.text ? ` ${s.text}` : ""}`;

const underIo = (w: LoadMapResult["writers"][number]): string => {
  if (w.ram_under_io === null) return " (RAM under I/O: unknown)";
  if (!w.ram_under_io.length) return "";
  return ` (RAM under I/O: ${w.ram_under_io.map((d) => `${hex(d.start)}-${hex(d.end)}`).join(", ")})`;
};

const writerText = (w: LoadMapResult["writers"][number]) =>
  `${w.id}${w.stage === null ? "" : ` stage ${w.stage}`} ${hex(w.pc_range.start)}-${hex(w.pc_range.end)}${w.in_stack_page ? " (stack page)" : ""}: ${w.stores} stores, clock ${w.first_clock}-${w.last_clock} -> ` +
  w.dest_ranges.map((d) => `${hex(d.start)}-${hex(d.end)}`).join(", ") +
  underIo(w);

export function loadMapReply(r: ReResult<LoadMapResult>): ToolReply {
  return reply(r, (m) => {
    const dispatch =
      m.first_program_dispatch_clock === null
        ? "no program-installed handler dispatched"
        : `first program dispatch at clock ${m.first_program_dispatch_clock}`;
    return (
      `load ${hex(m.load)}-${hex(m.end)}\n` +
      `stubs: ${m.stubs.map(stubText).join("; ") || "none"}\n` +
      `${m.writers.map(writerText).join("\n")}\n` +
      `entry ${m.entry_pc === null ? "unknown" : hex(m.entry_pc)}\n${dispatch}` +
      unknownsText(m.unknowns)
    );
  });
}

export const reLoadMapTool = defineTool({
  name: "c64_re_load_map",
  title: "Load map: who wrote where, from power-on in VICE",
  description: `Run a .prg (or a session) headless in VICE x64sc from power-on with \`trace store 0000 ffff\` and group every store by the code that made it. A writer is store instructions whose PCs are within 256 bytes and whose code was written at about the same time (within 100,000 cycles), so two depack stages run from the same stack-page addresses come out as two writers, in order. Each writer has an id, its destination ranges, store count, first and last clock, in_stack_page (its code runs from $0100-$01FF, where a depacker survives the block it unpacks), stage (1, 2, ... for the stack-page writers in clock order; zero-page-only depackers are not numbered), and ram_under_io (stores to $D000-$DFFF made while $01 banked I/O out, which reached RAM; null when $01 was unknown). $00/$01 are followed through the same trace (STA/STX/STY/SAX, INC, DEC; any other op makes them unknown until the next store with a value, named in unknowns). Writers are listed by first clock. entry_pc is the first PC run in $0200-$9FFF or $C000-$CFFF after the last stage's last store, from a fourth, exec-only pass. It is null (with the reason in unknowns) when the store trace or the entry pass was stopped early, when the last stage stored within a frame of the trace's end, or when the entry is in $A000-$BFFF, $D000-$DFFF or $E000-$FFFF RAM: those windows are not traced, because the BASIC and KERNAL ROM run there through the whole boot and would swell the log.

Use it before c64_re_irq_chain on a packed game: a depacker writing through $FFFA-$FFFF or $0314 is a bulk copy, not a handler install. Measured on Commando (VICE x64sc 3.10, PAL): stage 1 at $0101-$01A6 writes $0801-$B37C, stage 2 at $0104-$019E writes $FFFF down to $0800 skipping $D000-$DFFF, $A35A copies 4 KB to RAM under I/O, and the game's init at $3DD7-$4380 installs $0314 and clears $FFC0-$FFFF.

Also reports the BASIC stub(s) (\`$9E\` + digits + text, from the program's linked lines plus any other occurrence in the image, with the line number when readable), transient_vectors (c64_re_irq_chain's transient list, from power-on) and first_program_dispatch_clock: the first interrupt entry into a handler in RAM (ROM or RAM decided by $00/$01 at the entry), that is one the program installed rather than the KERNAL's $EA31.

Method: two or three small passes with c64_re_irq_chain's checkpoints over the full run find the dispatch clock; the full-memory trace then runs to that clock plus one frame (the full run when none is found, named in unknowns), streamed hit by hit. Every pass stops VICE once its monitor log passes 256 MiB (Commando's full-memory trace is 148.6 MB); a stopped pass and the 2,000,000-hit parse cap are unknowns entries.

${NEEDS}

${SESSION_INPUT}

Inputs: prg_path or session, model pal|ntsc, cycles, disk_path.
Output (structured): run {prg, model, cycles, entry, start_clock, vice, session?, image?}, load, end, stubs [{id, basis, rung, addr, sys, text, line}], writers [{id, basis, rung, pc_range, dest_ranges, stores, first_clock, last_clock, in_stack_page, ram_under_io, stage}], entry_pc, transient_vectors [{vector, value, writes}], first_program_dispatch_clock, unknowns.`,
  inputSchema: LoadMapInput,
  outputSchema: LoadMapOutput,
  annotations: READ_ONLY,
  readsGraph: false,
  run: async (args) => loadMapReply(await reLoadMap(args)),
});

const range = z.object({
  start: z.number().int(),
  end: z.number().int(),
  kinds: z.array(z.enum(["x", "r", "w"])),
});

export const CoverageOutput = {
  run,
  code: z
    .array(range)
    .describe("Address ranges where the CPU executed instructions (opcode + operands extended)"),
  data: z.array(range).describe("Address ranges read but never executed (read-only data)"),
  written_only: z.array(range).describe("Address ranges written but neither read nor executed"),
  unknown: z.array(range).describe("Address ranges in $0000-$FFFF not accessed at all (untouched RAM)"),
  show_clock: z.number().int().describe("CPU clock of the memmapshow checkpoint; 0 if the show did not fire"),
  span_cycles: z.number().int().describe("Cycles from the in-play clock to show_clock"),
  span_frames: z.number().describe("Frames from the in-play clock to show_clock (PAL or NTSC)"),
  unknowns: z.array(z.string()),
};

const hexRange = (r: Coverage["code"][number]) =>
  `${hex(r.start)}-${hex(r.end)} [${r.kinds.join("") || "---"}]`;

export function coverageReply(r: ReResult<Coverage>): ToolReply {
  return reply(r, (c) => {
    const section = (name: string, ranges: Coverage["code"]) =>
      ranges.length ? `${name}:\n  ${ranges.map(hexRange).join("\n  ")}` : `${name}: none`;
    const span =
      c.show_clock > 0
        ? `show at clock ${c.show_clock} (${c.span_cycles} cycles, ${c.span_frames.toFixed(1)} frames)\n`
        : "";
    return (
      span +
      [
        section("code", c.code),
        section("data", c.data),
        section("written_only", c.written_only),
        section("unknown", c.unknown),
      ].join("\n") +
      unknownsText(c.unknowns)
    );
  });
}

export const reCoverageTool = defineTool({
  name: "c64_re_coverage",
  title: "CPU coverage map from a game session in VICE",
  description: `Run a .prg or a session headless in VICE x64sc. Two passes: pass 1 finds the in-play clock and measures how often $FF48 (KERNAL IRQ dispatcher) or $D019 (raster IRQ acknowledge) fires per frame. Pass 2 zaps the CPU memory map at the in-play checkpoint and shows it after clock ≈ play_clock + frames × cycles_per_frame, placing the show by clock, not by a fixed count of writes. Classifies every RAM address the CPU touched since the zap into code (executed opcode + operand bytes extended by instruction length), data (read, not code), or written_only. Untouched addresses are reported as unknown. Saves a $0000-$BFFF RAM dump at the show moment to extend code ranges.

Needs the windowless x64sc (\`npm run vice:headless\`).

Inputs: prg_path or session, model pal|ntsc, cycles, frames (default 300 ≈ 6 s PAL).
Output (structured): run, code [{start,end,kinds}], data, written_only, unknown, show_clock, span_cycles, span_frames, unknowns.`,
  inputSchema: CoverageInput,
  outputSchema: CoverageOutput,
  annotations: READ_ONLY,
  readsGraph: false,
  run: async (args) => coverageReply(await reCoverage(args)),
});
