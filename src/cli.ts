#!/usr/bin/env node

/**
 * c64-kb CLI: terminal access to the Commodore 64 knowledge base. The
 * commands mirror the MCP tools; `c64-kb --help` lists them.
 *
 * Commands set process.exitCode and return; the postAction hook closes the
 * service connections so the process ends on its own. Every action used to
 * end in process.exit(), which can cut off a large --json output piped to
 * another program (stdout to a pipe is asynchronous).
 */

import path from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { health, formatHealth } from "./tools/intelligence.ts";
import { getVersions } from "./services/versions.ts";
import { startMcpServer } from "./server.ts";
import { closeAll } from "./context.ts";
import { definedOnly } from "./server/defined-only.ts";
import { reFrameProfile, reIrqChain } from "./tools/re.ts";
import { claimsWatch } from "./tools/claims-watch.ts";
import { claimsWatchReply } from "./server/tools-claims.ts";
import { registerSetupCommands } from "./cli/setup.ts";
import { rebuildInProgress, rebuildMessage } from "./services/rebuild-marker.ts";

const TOOLCHAINS = ["oscar64", "kickassembler", "cc65"] as const;
const REGIONS = ["pal", "ntsc", "both"] as const;

/** Commander argParser for an integer option; parseInt semantics, as the option was read before. */
function intArg(value: string): number {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

/** Commander argParser for a numeric option; Number() semantics, as the option was read before. */
function numberArg(value: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new InvalidArgumentError("Not a number.");
  return n;
}

function regionArg(value: string): string {
  if (!/^\s*(pal|ntsc|both)\s*$/i.test(value)) throw new InvalidArgumentError("Use pal, ntsc or both.");
  return value;
}

const program = new Command();

/**
 * Commands that answer from the graph. While a batch ingest is rebuilding
 * it they print the rebuild message and exit 1 instead (#41), as the MCP
 * tools do (src/server/define-tool.ts).
 */
const GRAPH_COMMANDS = new Set([
  "search",
  "lookup-register",
  "lookup-kernal",
  "memory-map",
  "lookup-opcode",
  "pal-ntsc-diff",
  "toolchain-hint",
  "recipe-lookup",
  "recipes-for",
  "technique-lookup",
  "techniques-for",
  "check-compatibility",
  "timing-budget",
  "plan-budget",
  "pitfalls-for",
  "failure-diagnose",
  "demo-briefing",
  "game-briefing",
  "gaps-replay",
]);

// Every lookup command prints its markdown, or, under the global --json
// flag, the same tool's structured object (the shape the MCP server
// returns). Until data 718 only the briefings honoured the flag.
function emit(result: { text: string; structured?: unknown }): void {
  if (program.opts().json) {
    console.log(JSON.stringify(result.structured ?? result, null, 2));
  } else {
    console.log(result.text);
  }
}

program
  .name("c64-kb")
  .description("Commodore 64 knowledge base")
  .version(getVersions().package)
  .option("--json", "Output JSON instead of human-readable text")
  .hook("preAction", async (_program, action) => {
    if (!GRAPH_COMMANDS.has(action.name())) return;
    const state = await rebuildInProgress();
    if (state) throw new Error(rebuildMessage(state));
  })
  .hook("postAction", async (_program, action) => {
    if (action.name() !== "serve") await closeAll();
  });

registerSetupCommands(program);

program
  .command("version")
  .description("Print all c64-kb versions (package, KB data, KB schema, MCP tool surface)")
  .action(() => {
    const v = getVersions();
    if (program.opts().json) {
      console.log(JSON.stringify(v));
    } else {
      console.log(`package         ${v.package}`);
      console.log(`KB_DATA_VERSION  ${v.kb_data}`);
      console.log(`KB_SCHEMA_VERSION ${v.kb_schema}`);
      console.log(`MCP_TOOL_VERSION  ${v.mcp_tool}`);
    }
  });

program
  .command("health")
  .description("Check backing service health (Qdrant, FalkorDB, Ollama, Analytics)")
  .action(async () => {
    const result = await health();
    if (program.opts().json) {
      console.log(JSON.stringify(result));
    } else {
      console.log(formatHealth(result));
    }
    process.exitCode = result.healthy ? 0 : 1;
  });

program
  .command("serve")
  .description("Start the MCP server on stdio (for .mcp.json connections)")
  .action(async () => {
    await startMcpServer();
  });

program
  .command("search")
  .description("Semantic search across the knowledge base")
  .argument("<query>", "Natural language query")
  .addOption(new Option("--limit <n>", "Max results").default(5).argParser(intArg))
  .option("--source <pattern>", "Filter by source file")
  .action(async (query: string, opts: { limit: number; source?: string }) => {
    const { search } = await import("./tools/query.ts");
    const result = await search(query, opts.limit, opts.source);
    emit(result);
  });

program
  .command("ingest-doc")
  .description("Ingest a single markdown file into the KB")
  .argument("<path>", "Path to a markdown file under docs/, relative to here or to docs/, or absolute")
  .action(async (docPath: string) => {
    const { ingestDoc } = await import("./tools/hydrate.ts");
    const { locateDoc } = await import("./ingest/doc-path.ts");
    const { config } = await import("./config.ts");
    const fs = await import("fs");
    const doc = locateDoc(docPath, config.docs.dir);
    if (doc === null || !fs.existsSync(doc.file)) {
      console.error(`Rejected: ${docPath} is not a file inside the docs directory (${config.docs.dir}).`);
      process.exitCode = 1;
      return;
    }
    const content = fs.readFileSync(doc.file, "utf-8");
    const result = await ingestDoc(doc.file, content);
    console.log(result);
  });

program
  .command("lookup-register <name>")
  .description("Look up a register by name or address")
  .action(async (name: string) => {
    const { lookupRegister } = await import("./tools/query.ts");
    const result = await lookupRegister(name);
    emit(result);
  });

program
  .command("lookup-kernal <name>")
  .description("Look up a KERNAL routine by name or address")
  .action(async (name: string) => {
    const { lookupKernal } = await import("./tools/query.ts");
    const result = await lookupKernal(name);
    emit(result);
  });

program
  .command("memory-map <addr>")
  .description("Look up the memory region containing a hex address")
  .action(async (addr: string) => {
    const { memoryMap } = await import("./tools/query.ts");
    const result = await memoryMap(addr);
    emit(result);
  });

program
  .command("lookup-opcode <op>")
  .description("Look up a 6510 opcode by byte or mnemonic")
  .action(async (op: string) => {
    const { lookupOpcode } = await import("./tools/query.ts");
    const result = await lookupOpcode(op);
    emit(result);
  });

program
  .command("pal-ntsc-diff <topic>")
  .description("Compare PAL vs NTSC for a topic")
  .addOption(
    new Option("--region <region>", "Limit to a single region: pal, ntsc, or both")
      .choices(REGIONS)
      .default("both"),
  )
  .action(async (topic: string, opts: { region: (typeof REGIONS)[number] }) => {
    const { palNtscDiff } = await import("./tools/query.ts");
    const result = await palNtscDiff(topic, opts.region);
    emit(result);
  });

program
  .command("toolchain-hint <intent>")
  .addOption(
    new Option("--toolchain <toolchain>", "oscar64 | kickassembler | cc65 (default: oscar64)").choices(
      TOOLCHAINS,
    ),
  )
  .description("Get an idiomatic snippet for a toolchain + intent")
  .action(async (intent: string, opts: { toolchain?: string }) => {
    const { toolchainHint } = await import("./tools/query.ts");
    const result = await toolchainHint(opts.toolchain, intent);
    emit(result);
  });

program
  .command("recipe-lookup <name>")
  .description("Look up a recipe by canonical name (e.g. 'oscar64-hello-world')")
  .action(async (name: string) => {
    const { recipeLookup } = await import("./tools/query.ts");
    const result = await recipeLookup(name);
    emit(result);
  });

program
  .command("recipes-for")
  .addOption(new Option("--toolchain <toolchain>", "Filter by toolchain").choices(TOOLCHAINS))
  .addOption(new Option("--region <region>", "Filter by region (pal/ntsc/both)").choices(REGIONS))
  .option("--technique <technique>", "Filter by Technique title")
  .option("--file-format <fmt>", "Filter by FileFormat")
  .option("--verified-on <variant>", "MachineVariant name or region word: recipes run in VICE on it")
  .description("List recipes filtered by toolchain/region/technique/format/verified-on")
  .action(
    async (opts: {
      toolchain?: string;
      region?: string;
      technique?: string;
      fileFormat?: string;
      verifiedOn?: string;
    }) => {
      const { recipesFor } = await import("./tools/query.ts");
      const result = await recipesFor(
        definedOnly({
          toolchain: opts.toolchain,
          region: opts.region,
          technique: opts.technique,
          file_format: opts.fileFormat,
          verified_on: opts.verifiedOn,
        }),
      );
      emit(result);
    },
  );

program
  .command("technique-lookup <name>")
  .description("Look up a technique by canonical snake_case name (e.g. 'stable_raster_irq')")
  .action(async (name: string) => {
    const { techniqueLookup } = await import("./tools/query.ts");
    const result = await techniqueLookup(name);
    emit(result);
  });

program
  .command("techniques-for")
  .description("List techniques filtered by category/chip/region/register/recipe/requires/claims")
  .option("--category <category>", "Filter by category (raster, sprite, scroll, bitmap, banking...)")
  .option("--chip <chip>", "Filter by chip (e.g. VIC-II, SID)")
  .option("--region <region>", "Filter by required region (PAL or NTSC)")
  .option("--register <register>", "Filter by register used (e.g. D011)")
  .option("--recipe <recipe>", "Filter by recipe that implements the technique")
  .option(
    "--requires <technique>",
    "Filter to techniques that build on this one (REQUIRES chain, e.g. stable_raster_irq)",
  )
  .option(
    "--claims <unit>",
    "Filter to techniques that claim this HardwareUnit (e.g. sid_voice_3, vic_raster_irq)",
  )
  .action(
    async (opts: {
      category?: string;
      chip?: string;
      region?: string;
      register?: string;
      recipe?: string;
      requires?: string;
      claims?: string;
    }) => {
      const { techniquesFor } = await import("./tools/query.ts");
      const result = await techniquesFor(definedOnly(opts));
      emit(result);
    },
  );

program
  .command("check-compatibility [techniques...]")
  .description(
    "Check compatibility of two or more techniques (space-separated names), or of a game design phase by phase",
  )
  .option("--design <name>", "a GameDesign name: each phase (play, init, transition) checked alone")
  .action(async (techniques: string[], opts: { design?: string }) => {
    const { checkCompatibility, checkDesignCompatibility } = await import("./tools/query.ts");
    if (!opts.design && techniques.length < 2) throw new Error("give 2+ techniques, or --design <name>");
    const result = opts.design
      ? await checkDesignCompatibility(opts.design, techniques)
      : await checkCompatibility(techniques);
    emit(result);
    // A refusal (a name with no technique) is a failure to a script, not a verdict.
    if (result.structured.verdict === "unknown_technique") process.exitCode = 1;
  });

program
  .command("timing-budget <technique>")
  .description("Compute per-scanline cycle budget for a technique")
  .option("--region <region>", "PAL or NTSC (case-insensitive, default: pal)", "pal")
  .addOption(
    new Option(
      "--sprites <n>",
      "sprites displayed on the line, 0-8 (default: the technique's Cost sprites_per_line)",
    ).argParser(numberArg),
  )
  .action(async (technique: string, opts: { region: string; sprites?: number }) => {
    const { timingBudget } = await import("./tools/query.ts");
    const result = await timingBudget({
      technique,
      region: opts.region,
      ...(opts.sprites !== undefined ? { sprites_per_line: opts.sprites } : {}),
    });
    emit(result);
  });

program
  .command("plan-budget [techniques...]")
  .description(
    'Budget a set of techniques per phase ("name" or "name:play|transition|init"), or a GameDesign with --design: cycle range, left-out figures, unknowns, verdict, measured frame beside the prediction',
  )
  .option("--design <name>", "a GameDesign name; its composed techniques are budgeted by phase")
  .addOption(
    new Option(
      "--region <region>",
      "pal, ntsc or both (default: PAL unless every region-locked member is NTSC)",
    ).argParser(regionArg),
  )
  .addOption(new Option("--screen <state>", "display on or off").choices(["on", "off"] as const))
  .addOption(new Option("--sprites <n>", "sprites displayed on each sprite line, 0-8").argParser(numberArg))
  .addOption(
    new Option("--sprite-lines <n>", "raster lines with sprites on them (default 200)").argParser(numberArg),
  )
  .action(
    async (
      techniques: string[],
      opts: {
        design?: string;
        region?: string;
        screen?: "on" | "off";
        sprites?: number;
        spriteLines?: number;
      },
    ) => {
      const { planBudgetTool, budgetRegion } = await import("./tools/query.ts");
      const region = budgetRegion(opts.region);
      const result = await planBudgetTool({
        techniques,
        ...(opts.design !== undefined ? { design: opts.design } : {}),
        ...(region !== undefined ? { region } : {}),
        ...(opts.screen !== undefined ? { screen: opts.screen } : {}),
        ...(opts.sprites !== undefined ? { sprites_per_line: opts.sprites } : {}),
        ...(opts.spriteLines !== undefined ? { sprite_lines: opts.spriteLines } : {}),
      });
      emit(result);
    },
  );

program
  .command("lint <file>")
  .description(
    "Run the pitfall rules over a C or assembly source file (language from the extension, or --language), or over the C and assembly fences of a Markdown page",
  )
  .addOption(
    new Option("--language <lang>", "c, asm or auto").choices(["c", "asm", "auto"] as const).default("auto"),
  )
  .option("--toolchain <name>", "Toolchain name recorded in the output")
  .action(async (file: string, opts: { language: "c" | "asm" | "auto"; toolchain?: string }) => {
    const { lintSourceResult } = await import("./tools/lint.ts");
    const fs = await import("fs");
    const source = fs.readFileSync(file, "utf-8");
    let language = opts.language;
    if (language === "auto") {
      if (/\.(c|h)$/i.test(file)) language = "c";
      else if (/\.(asm|s|a|inc)$/i.test(file)) language = "asm";
    }
    const result = lintSourceResult(source, { language, toolchain: opts.toolchain }, file);
    emit(result);
    process.exitCode = result.structured.findings.some((f) => f.certainty === "definite") ? 1 : 0;
  });

program
  .command("pitfalls-for <topic>")
  .description(
    "Look up pitfalls triggered by a register, KERNAL routine, or technique (for a technique, also the pitfalls it is the fix for)",
  )
  .action(async (topic: string) => {
    const { pitfallsFor } = await import("./tools/pitfalls.ts");
    const result = await pitfallsFor(topic);
    emit(result);
  });

program
  .command("failure-diagnose <symptom>")
  .description("Diagnose a failure symptom against the crash-pattern catalog")
  .action(async (symptom: string) => {
    const { failureDiagnose } = await import("./tools/pitfalls.ts");
    const result = await failureDiagnose(symptom);
    emit(result);
  });

program
  .command("demo-briefing <description>")
  .description("Generate a structured C64 demo plan from a brief (Phase 5 anchor tool)")
  .option(
    "--archetype <name>",
    "Demo form from docs/demo-design/intro-cracktro-patterns.md (cracktro, demo_intro, pack_intro, dentro, party_intro_4k)",
  )
  .action(async (description: string, opts: { archetype?: string }) => {
    const { demoBriefing } = await import("./tools/briefings.ts");
    const result = await demoBriefing(description, opts.archetype);
    if (program.opts().json) {
      console.log(JSON.stringify(result.structured, null, 2));
    } else {
      emit(result);
    }
  });

program
  .command("game-briefing <description>")
  .description("Generate a structured C64 game plan from a brief (Phase 5 anchor tool)")
  .option(
    "--archetype <name>",
    "Archetype name from docs/game-design/c64-game-archetypes.md (vertical_shmup, puzzle, racing, ...)",
  )
  .option("--genre <genre>", "Alias of --archetype")
  .action(async (description: string, opts: { archetype?: string; genre?: string }) => {
    const { gameBriefing } = await import("./tools/briefings.ts");
    const result = await gameBriefing(description, opts.archetype ?? opts.genre);
    if (program.opts().json) {
      console.log(JSON.stringify(result.structured, null, 2));
    } else {
      emit(result);
    }
  });

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

reOptions(program.command("re-irq-chain <prg>")).action(async (prg: string, o: ReOpts) => {
  const r = await reIrqChain(reArgs(prg, o));
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) process.exitCode = 1;
});

reOptions(
  program
    .command("re-frame-profile <prg>")
    .requiredOption("--start <marker>", 'e.g. "store:$DC0F=$11"')
    .requiredOption("--stop <marker>", 'e.g. "store:$DC0F=$00"'),
).action(async (prg: string, o: ReOpts & { start: string; stop: string }) => {
  const r = await reFrameProfile({ ...reArgs(prg, o), start: o.start, stop: o.stop });
  // The MCP reply's structured content carries every sample; the CLI prints the count, not the list.
  console.log(
    JSON.stringify(r.ok ? { run: r.run, ...r.result, samples: r.result.samples.length } : r, null, 2),
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
  console.log(claimsWatchReply(r).text);
  process.exitCode = r.ok && r.result.verdict === "pass" ? 0 : 1;
});

try {
  await program.parseAsync(process.argv);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  await closeAll();
  process.exitCode = 1;
}
