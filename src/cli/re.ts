/** The reverse-engineering and claims-watch commands: runs of a PRG or a session in VICE. */
import path from "node:path";
import { type Command, InvalidArgumentError, Option } from "commander";
import { claimsWatchReply } from "../server/tools-claims.ts";
import { claimsWatch } from "../tools/claims-watch.ts";
import { reFrameProfile, reIrqChain } from "../tools/re.ts";
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

/** A session path in place of the PRG: "session:docs/game-design/studies/sessions/commando.json". */
const reInput = (prg: string, o: ReOpts) =>
  prg.startsWith("session:")
    ? { session: prg.slice("session:".length), model: o.model, cycles: o.cycles }
    : reArgs(prg, o);

export function registerReCommands(program: Command): void {
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

  reOptions(program.command("re-irq-chain <prg>").description('A .prg, or "session:<file>"')).action(
    async (prg: string, o: ReOpts) => {
      const r = await reIrqChain(reInput(prg, o));
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
      if (!r.ok) process.exitCode = 1;
    },
  );

  reOptions(
    program
      .command("re-frame-profile <prg>")
      .requiredOption("--start <marker>", 'e.g. "store:$DC0F=$11"')
      .requiredOption("--stop <marker>", 'e.g. "store:$DC0F=$00"'),
  ).action(async (prg: string, o: ReOpts & { start: string; stop: string }) => {
    const r = await reFrameProfile({ ...reInput(prg, o), start: o.start, stop: o.stop });
    // The MCP reply's structured content carries every sample; the CLI prints the count, not the list.
    process.stdout.write(
      `${JSON.stringify(r.ok ? { run: r.run, ...r.result, samples: r.result.samples.length } : r, null, 2)}\n`,
    );
    if (!r.ok) process.exitCode = 1;
  });

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
