/** The reverse-engineering and claims-watch commands: runs of a PRG or a session in VICE. */
import path from "node:path";
import { type Command, InvalidArgumentError, Option } from "commander";
import { claimsWatchReply } from "../server/tools-claims.ts";
import { claimsWatch } from "../tools/claims-watch.ts";
import { reFrameProfile, reIrqChain, reSnapshot } from "../tools/re.ts";
import { reSession } from "../tools/re-session.ts";

/** --cycles for the RE commands: an integer from 100,000, the MCP tools' own floor. */
function cyclesArg(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 100_000 || n > 200_000_000)
    throw new InvalidArgumentError("--cycles must be an integer from 100000 to 200000000.");
  return n;
}

const reOptions = (c: Command): Command =>
  c
    .addOption(new Option("--model <m>", "pal or ntsc").choices(["pal", "ntsc"]).default("pal"))
    .addOption(new Option("--cycles <n>", "run length").argParser(cyclesArg).default(8_000_000))
    .option("--disk <d64>", "drive 8 (copied; writes are discarded)");

interface ReOpts {
  model: "pal" | "ntsc";
  cycles: number;
  disk?: string;
}

const reArgs = (prg: string, o: ReOpts) => ({
  prg_path: path.resolve(prg),
  model: o.model,
  cycles: o.cycles,
  ...(o.disk ? { disk_path: path.resolve(o.disk) } : {}),
});

/**
 * A session path in place of the PRG: "session:docs/game-design/studies/sessions/commando.json".
 * Only options typed on the command line go with a session (the defaults
 * would contradict the file, which the tool refuses); --disk is passed on
 * so the tool refuses it.
 */
function reInput(prg: string, o: ReOpts, cmd: Command) {
  if (!prg.startsWith("session:")) return reArgs(prg, o);
  const typed = (k: string) => cmd.getOptionValueSource(k) === "cli";
  return {
    session: prg.slice("session:".length),
    ...(typed("model") ? { model: o.model } : {}),
    ...(typed("cycles") ? { cycles: o.cycles } : {}),
    ...(o.disk ? { disk_path: path.resolve(o.disk) } : {}),
  };
}

/** --after-hits for re-snapshot: an integer from 0, after_hits_of_play_pc's own floor. */
function afterHitsArg(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0)
    throw new InvalidArgumentError("--after-hits must be an integer from 0.");
  return n;
}

/** re-session, re-snapshot, re-irq-chain, re-frame-profile: the observation tools. */
function registerReplayCommands(program: Command): void {
  program
    .command("re-session <file>")
    .description(
      "Replay a session file (docs/game-design/studies/sessions/) to play in VICE; print the in-play clock",
    )
    .action(async (file: string) => {
      const r = await reSession({ session: file });
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      if (!r.ok) process.exitCode = 1;
    });

  program
    .command("re-snapshot <file>")
    .description("Replay a session to play in VICE and dump RAM and I/O at in_play.pc; print the decode")
    .addOption(
      new Option("--after-hits <n>", "hits of in_play.pc to skip before the dump")
        .argParser(afterHitsArg)
        .default(0),
    )
    .action(async (file: string, o: { afterHits: number }) => {
      const r = await reSnapshot({ session: file, after_hits_of_play_pc: o.afterHits });
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      if (!r.ok) process.exitCode = 1;
    });

  reOptions(program.command("re-irq-chain <prg>").description('A .prg, or "session:<file>"')).action(
    async (prg: string, o: ReOpts, cmd: Command) => {
      const r = await reIrqChain(reInput(prg, o, cmd));
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      if (!r.ok) process.exitCode = 1;
    },
  );

  reOptions(
    program
      .command("re-frame-profile <prg>")
      .requiredOption("--start <marker>", 'e.g. "store:$DC0F=$11"')
      .requiredOption("--stop <marker>", 'e.g. "store:$DC0F=$00"'),
  ).action(async (prg: string, o: ReOpts & { start: string; stop: string }, cmd: Command) => {
    const r = await reFrameProfile({ ...reInput(prg, o, cmd), start: o.start, stop: o.stop });
    // The MCP reply's structured content carries every sample; the CLI prints the count, not the list.
    process.stdout.write(
      `${JSON.stringify(r.ok ? { run: r.run, ...r.result, samples: r.result.samples.length } : r, null, 2)}\n`,
    );
    if (!r.ok) process.exitCode = 1;
  });
}

/** claims-watch: a program's stores against the hardware units it declares (#22 step 8). */
function registerClaimsWatchCommand(program: Command): void {
  interface ClaimsWatchOpts extends ReOpts {
    recipe?: string;
    technique: string[];
    claim?: string;
    ram?: string;
    harness?: string;
    kernal: string[];
    screen?: string;
    allRam?: boolean;
  }

  const repeat = (v: string, prev: string[]) => [...prev, ...v.split(",").map((s) => s.trim())];

  // The c64_claims_watch tool from the command line (#22 step 8). The repo's
  // scripts/claims-watch.ts takes the same declarations and adds --log, --json.
  reOptions(
    program
      .command("claims-watch <prg>")
      .description("Run a PRG in VICE and check every store against the hardware units it declares")
      .option("--recipe <name>", "a recipe name or page: its techniques and claims:, harness:, ram: keys")
      .option("--technique <ids>", "technique ids whose Claims lines declare units", repeat, [])
      .option("--claim <text>", "units in the Claims-line grammar")
      .option("--ram <ranges>", "the program's own RAM: [name=]$XXXX[-$YYYY], comma list")
      .option("--harness <items>", "a measurement harness: units or ranges")
      .option("--kernal <names>", "KERNAL routines called, or IRQ / NMI", repeat, [])
      .option("--screen <addr>", "screen RAM base, for the sprite pointers")
      .option("--all-ram", "also trace $0400-$CFFF and $E000-$FFF9"),
  ).action(async (prg: string, o: ClaimsWatchOpts) => {
    const r = await claimsWatch({
      ...reArgs(prg, o),
      recipe: o.recipe,
      techniques: o.technique,
      claims: o.claim,
      ram: o.ram,
      harness: o.harness,
      kernal: o.kernal,
      screen: o.screen,
      all_ram: o.allRam === true,
    });
    process.stdout.write(`${claimsWatchReply(r).text}\n`);
    process.exitCode = r.ok && r.result.verdict === "pass" ? 0 : 1;
  });
}

export function registerReCommands(program: Command): void {
  registerReplayCommands(program);
  registerClaimsWatchCommand(program);
}
