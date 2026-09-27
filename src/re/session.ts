/**
 * A session: how to bring a studied game from power-on to play in a batch
 * VICE run, and how to tell it got there (docs/superpowers/specs/
 * 2026-09-23-reverse-engineering-design.md, amendment 2026-09-24). Files
 * live in docs/game-design/studies/sessions/ and hold no image bytes: the
 * image is named by sha1 and resolved through the local manifest
 * (src/re/image.ts).
 *
 * Input is a list of register injections at the game's own read
 * instructions. No key or joystick event reaches a `-moncommands` run, but
 * a trace checkpoint on the instruction after the read, with `command N
 * "r a = 6f"`, sets the register the game just loaded (measured on
 * Commando: `LDA $DC00` at $0FB2, `CMP #$6F` at $0FB5; fire injected there
 * starts play). Hit counts are decimal in the file and hex to the monitor:
 * VICE reads monitor numbers as hex, so `ignore 1 1000` skips 4,096 hits.
 * Ignored hits are not logged; the first hit logged is the one the
 * command ran on (measured on test/fixtures/re/title-fire.asm: `ignore 2 a`
 * logged checkpoint 2 once, on the 11th pass through the CMP).
 *
 * Checkpoint numbering, measured in the windowless x64sc 3.10: `trace` and
 * `break` checkpoints share one sequence numbered 1, 2, 3… in the order the
 * command file creates them. The "#1 (Stop on exec fce2)" line at the head
 * of every -monlog is the monitor opening at reset to read the command
 * file, not a checkpoint: the file's first `trace` is still checkpoint 1
 * (its "TRACE: 1  C:$0816" echo follows that line). MonitorScript keeps
 * that count so `ignore N` and `command N` name the right checkpoint
 * whatever came before them. Two other commands take numbers from the
 * same sequence and are refused in a tool's block (MonitorScript.add):
 * `until` takes one (measured: trace, until, trace, tr numbered 1, 2, 3, 4,
 * and `until` also runs the machine to its address before the file's next
 * line is read), and the abbreviation `tr` creates a trace checkpoint the
 * builder would not recognise as one.
 *
 * An injection fires on every pass through at_pc after its first
 * after_hits: `ignore` only skips the first N, and the command runs on each
 * hit after them. A game that returns to its title and polls there again
 * gets fire again at once. An entry with `once` sets its value on exactly
 * one hit and disables its checkpoint in the same command (`command N "r a
 * = 6f; disable N"`), so the port reads its own idle value on every later
 * pass: one entry is one press of a button, and a game whose menus want a
 * fresh press per question gets one entry per question (a press-then-release
 * is two entries, or one once-entry and then nothing).
 */
import { z } from "zod";
import type { Hit } from "./monlog.ts";

const HEX_ADDR = /^\$?[0-9a-f]{1,4}$/i;
const HEX_BYTE = /^\$?[0-9a-f]{1,2}$/i;

export const SessionSchema = z.object({
  image: z.object({
    sha1: z.string().regex(/^[0-9a-f]{40}$/),
    kind: z.enum(["prg", "d64"]),
    file: z.string().optional(),
    title: z.string(),
    release: z.string().optional(),
  }),
  machine: z.object({ model: z.enum(["pal", "ntsc"]).default("pal") }),
  inject: z
    .array(
      z.object({
        at_pc: z.string().regex(HEX_ADDR),
        after_hits: z.number().int().min(0),
        set: z.partialRecord(z.enum(["a", "x", "y"]), z.string().regex(HEX_BYTE)),
        /** Set the value on exactly one hit, then disable the checkpoint. */
        once: z.boolean().optional(),
        why: z.string(),
      }),
    )
    .default([]),
  in_play: z.object({
    check: z.literal("exec"),
    pc: z.string().regex(HEX_ADDR),
    after_clock: z.number().int().min(0),
    why: z.string().optional(),
  }),
  // 2,000,000,000 (was capped at 200,000,000): a long replay is bounded by
  // runBatch's maxLogBytes, not by this.
  limitcycles: z.number().int().min(100_000).max(2_000_000_000),
});
export type Session = z.infer<typeof SessionSchema>;
type Injection = Session["inject"][number];

/** "$0FB5" → 0x0FB5. The schema has checked the form. */
export const parseHex = (s: string): number => parseInt(s.replace(/^\$/, ""), 16);
const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** One injection's checkpoint line, then its ignore and command lines for checkpoint `n`. */
function injectionLines(i: Injection, n: number): { checkpoint: string; then: string[] } {
  const pc = hex4(parseHex(i.at_pc));
  const regs = Object.entries(i.set)
    .map(([r, v]) => `${r} = ${hex2(parseHex(v))}`)
    .join(", ");
  const then = i.after_hits > 0 ? [`ignore ${n} ${i.after_hits.toString(16)}`] : [];
  // `once` disables the checkpoint in the same command line (one command line
  // may hold both, `;`-separated), so the next pass reads the port's own value.
  if (regs) then.push(`command ${n} "r ${regs}${i.once === true ? `; disable ${n}` : ""}"`);
  return { checkpoint: `trace exec ${pc} ${pc}`, then };
}

/** The session's injections as monitor commands, the first taking checkpoint number `firstCheckpoint`. */
export function injectCommands(s: Session, firstCheckpoint: number): string {
  return s.inject
    .flatMap((i, k) => {
      const l = injectionLines(i, firstCheckpoint + k);
      return [l.checkpoint, ...l.then];
    })
    .map((l) => l + "\n")
    .join("");
}

/** The exec checkpoint on in_play.pc. */
export function inPlayCommand(s: Session): string {
  const pc = hex4(parseHex(s.in_play.pc));
  return `trace exec ${pc} ${pc}\n`;
}

/** The first exec of in_play.pc at or after in_play.after_clock; null when play was not reached. */
export function inPlayClock(hits: Iterable<Hit>, s: Session): number | null {
  const pc = parseHex(s.in_play.pc);
  for (const h of hits)
    if (h.kind === "exec" && h.addr === pc && h.clock >= s.in_play.after_clock) return h.clock;
  return null;
}

const CHECKPOINT = /^(trace|break|watch)\s/;
/**
 * Lines a tool's block may not carry: a command that names a checkpoint
 * number (the tool cannot know it; use checkpoint(line, then)), or one that
 * creates a checkpoint in a form the count above would miss (`until`, and
 * the abbreviations tr, bk, br, w, un).
 */
const NUMBERED =
  /^\s*(ignore|command|delete|del|disable|dis|enable|en|condition|cond|until|un|tr|bk|br|w)(\s|$)/i;

/**
 * One monitor command file for a session-driven run, with VICE's
 * checkpoint numbering kept here (see the file comment): the session's
 * injections first (1…k), then its in-play trace, then whatever the tool
 * adds, numbered on. A tool adds a checkpoint and gets its number back, or
 * passes a callback that writes the lines that need it (`command N`,
 * `ignore N`), so it never counts what came before.
 *
 * A tool line identical to a shared checkpoint (the in-play trace, or a
 * tool line added earlier) reuses it: a second identical checkpoint would
 * log every hit twice. An injection is never shared, because its `ignore`
 * hides hits a tool would need. Hits of checkpoints only the session asked
 * for (its injections, its in-play trace when no tool line asked for the
 * same PC) are not the tool's observations: toolHits drops them, so an
 * injection's exec never reaches an analysis.
 */
export class MonitorScript {
  private readonly lines: string[] = [];
  private readonly shared = new Map<string, number>();
  private readonly toolOwned = new Set<number>();
  private next = 1;

  /**
   * Adds a checkpoint line and returns its number; `then` writes lines that
   * name it. A checkpoint with `then` is never shared either way: its
   * `ignore` or `command` would otherwise act on another's hits (the
   * session's in-play trace hidden by a tool's ignore), and a later plain
   * line must not land on a checkpoint that ignores or commands.
   */
  checkpoint(
    line: string,
    then?: (n: number) => string[],
    opts: { session?: boolean; share?: boolean } = {},
  ): number {
    const share = then === undefined && (opts.share ?? true);
    const known = share ? this.shared.get(line) : undefined;
    const n = known ?? this.next++;
    if (known === undefined) this.lines.push(line);
    if (share) this.shared.set(line, n);
    if (!opts.session) this.toolOwned.add(n);
    if (then) this.lines.push(...then(n));
    return n;
  }

  /**
   * Adds a block such as storeCommands() returns: each checkpoint line
   * numbered, any other line kept as is. Throws on a line that names a
   * checkpoint number or creates a checkpoint uncounted (NUMBERED).
   */
  add(block: string): void {
    for (const line of block.split("\n").filter((l) => l.trim())) {
      if (NUMBERED.test(line))
        throw new Error(
          `a block cannot carry "${line}": it names or creates a checkpoint; use checkpoint(line, then)`,
        );
      if (CHECKPOINT.test(line)) this.checkpoint(line);
      else this.lines.push(line);
    }
  }

  text(): string {
    return this.lines.map((l) => l + "\n").join("");
  }

  /** Is this hit one a tool asked for (not one only the session itself owns, an injection or the in-play trace)? A hit with no checkpoint number counts too. */
  isToolHit(h: Hit): boolean {
    return h.checkpoint === undefined || this.toolOwned.has(h.checkpoint);
  }

  /** The hits of checkpoints a tool asked for; a hit with no checkpoint number is kept. */
  toolHits(hits: Hit[]): Hit[] {
    return hits.filter((h) => this.isToolHit(h));
  }
}

/** A script holding the session's injections (checkpoints 1…k) and its in-play trace. */
export function sessionScript(s: Session): MonitorScript {
  const m = new MonitorScript();
  for (const i of s.inject) {
    const l = injectionLines(i, 0);
    m.checkpoint(l.checkpoint, (n) => injectionLines(i, n).then, { session: true });
  }
  m.checkpoint(inPlayCommand(s).trim(), undefined, { session: true });
  return m;
}
