#!/usr/bin/env node

/**
 * c64-kb CLI — terminal access to the Commodore 64 knowledge base.
 *
 * Phase 1 + 2 surface (mirrors the MCP tools):
 *   health, serve, search, ingest-doc, lookup-register, lookup-kernal,
 *   memory-map, lookup-opcode, pal-ntsc-diff, toolchain-hint,
 *   recipe-lookup, recipes-for.
 *
 * Phase 3 adds: technique-lookup, techniques-for, check-compatibility, timing-budget.
 * Phase 5 adds: pitfalls-for, failure-diagnose, demo-briefing, game-briefing.
 */

import { Command } from "commander";
import { health, formatHealth } from "./tools/intelligence.ts";
import { getVersions } from "./services/versions.ts";
import { startMcpServer } from "./server.ts";

const program = new Command();

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
  .option("--json", "Output JSON instead of human-readable text");

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
    process.exit(result.healthy ? 0 : 1);
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
  .option("--limit <n>", "Max results", "5")
  .option("--source <pattern>", "Filter by source file")
  .action(async (query: string, opts: { limit: string; source?: string }) => {
    const { search } = await import("./tools/query.ts");
    const result = await search(query, parseInt(opts.limit, 10), opts.source);
    emit(result);
    process.exit(0);
  });

program
  .command("ingest-doc")
  .description("Ingest a single markdown file into the KB")
  .argument("<path>", "Path to markdown file")
  .action(async (docPath: string) => {
    const { ingestDoc } = await import("./tools/hydrate.ts");
    const fs = await import("fs");
    const content = fs.readFileSync(docPath, "utf-8");
    const result = await ingestDoc(docPath, content);
    console.log(result);
    process.exit(0);
  });

program
  .command("lookup-register <name>")
  .description("Look up a register by name or address")
  .action(async (name: string) => {
    const { lookupRegister } = await import("./tools/query.ts");
    const result = await lookupRegister(name);
    emit(result);
    process.exit(0);
  });

program
  .command("lookup-kernal <name>")
  .description("Look up a KERNAL routine by name or address")
  .action(async (name: string) => {
    const { lookupKernal } = await import("./tools/query.ts");
    const result = await lookupKernal(name);
    emit(result);
    process.exit(0);
  });

program
  .command("memory-map <addr>")
  .description("Look up the memory region containing a hex address")
  .action(async (addr: string) => {
    const { memoryMap } = await import("./tools/query.ts");
    const result = await memoryMap(addr);
    emit(result);
    process.exit(0);
  });

program
  .command("lookup-opcode <op>")
  .description("Look up a 6510 opcode by byte or mnemonic")
  .action(async (op: string) => {
    const { lookupOpcode } = await import("./tools/query.ts");
    const result = await lookupOpcode(op);
    emit(result);
    process.exit(0);
  });

program
  .command("pal-ntsc-diff <topic>")
  .description("Compare PAL vs NTSC for a topic")
  .option("--region <region>", "Limit to a single region: pal, ntsc, or both", "both")
  .action(async (topic: string, opts: { region: string }) => {
    const { palNtscDiff } = await import("./tools/query.ts");
    const region = (["pal", "ntsc", "both"] as const).includes(opts.region as "pal" | "ntsc" | "both")
      ? (opts.region as "pal" | "ntsc" | "both")
      : "both";
    const result = await palNtscDiff(topic, region);
    emit(result);
    process.exit(0);
  });

program
  .command("toolchain-hint <intent>")
  .option("--toolchain <toolchain>", "oscar64 | kickassembler | cc65 (default: oscar64)")
  .description("Get an idiomatic snippet for a toolchain + intent")
  .action(async (intent: string, opts: { toolchain?: string }) => {
    const { toolchainHint } = await import("./tools/query.ts");
    const result = await toolchainHint(opts.toolchain, intent);
    emit(result);
    process.exit(0);
  });

program
  .command("recipe-lookup <name>")
  .description("Look up a recipe by canonical name (e.g. 'oscar64-hello-world')")
  .action(async (name: string) => {
    const { recipeLookup } = await import("./tools/query.ts");
    const result = await recipeLookup(name);
    emit(result);
    process.exit(0);
  });

program
  .command("recipes-for")
  .option("--toolchain <toolchain>", "Filter by toolchain")
  .option("--region <region>", "Filter by region (pal/ntsc/both)")
  .option("--technique <technique>", "Filter by Technique title")
  .option("--file-format <fmt>", "Filter by FileFormat")
  .description("List recipes filtered by toolchain/region/technique/format")
  .action(async (opts: { toolchain?: string; region?: string; technique?: string; fileFormat?: string }) => {
    const { recipesFor } = await import("./tools/query.ts");
    const result = await recipesFor({
      toolchain: opts.toolchain,
      region: opts.region,
      technique: opts.technique,
      file_format: opts.fileFormat,
    });
    emit(result);
    process.exit(0);
  });

program
  .command("technique-lookup <name>")
  .description("Look up a technique by canonical snake_case name (e.g. 'stable_raster_irq')")
  .action(async (name: string) => {
    const { techniqueLookup } = await import("./tools/query.ts");
    const result = await techniqueLookup(name);
    emit(result);
    process.exit(0);
  });

program
  .command("techniques-for")
  .description("List techniques filtered by category/chip/region/register/recipe/requires/claims")
  .option("--category <category>", "Filter by category (raster, sprite, scroll, bitmap, banking...)")
  .option("--chip <chip>", "Filter by chip (e.g. VIC-II, SID)")
  .option("--region <region>", "Filter by required region (PAL or NTSC)")
  .option("--register <register>", "Filter by register used (e.g. D011)")
  .option("--recipe <recipe>", "Filter by recipe that implements the technique")
  .option("--requires <technique>", "Filter to techniques that build on this one (REQUIRES chain, e.g. stable_raster_irq)")
  .option("--claims <unit>", "Filter to techniques that claim this HardwareUnit (e.g. sid_voice_3, vic_raster_irq)")
  .action(async (opts: { category?: string; chip?: string; region?: string; register?: string; recipe?: string; requires?: string; claims?: string }) => {
    const { techniquesFor } = await import("./tools/query.ts");
    const result = await techniquesFor({
      category: opts.category,
      chip: opts.chip,
      region: opts.region,
      register: opts.register,
      recipe: opts.recipe,
      requires: opts.requires,
      claims: opts.claims,
    });
    emit(result);
    process.exit(0);
  });

program
  .command("check-compatibility <techniques...>")
  .description("Check compatibility of two or more techniques (space-separated names)")
  .action(async (techniques: string[]) => {
    const { checkCompatibility } = await import("./tools/query.ts");
    const result = await checkCompatibility(techniques);
    emit(result);
    process.exit(0);
  });

program
  .command("timing-budget <technique>")
  .description("Compute per-scanline cycle budget for a technique")
  .option("--region <region>", "PAL or NTSC (case-insensitive, default: pal)", "pal")
  .option("--sprites <n>", "sprites displayed on the line, 0-8 (default: the technique's Cost sprites_per_line)")
  .action(async (technique: string, opts: { region: string; sprites?: string }) => {
    const { timingBudget } = await import("./tools/query.ts");
    const result = await timingBudget({
      technique,
      region: opts.region,
      ...(opts.sprites !== undefined ? { sprites_per_line: Number(opts.sprites) } : {}),
    });
    emit(result);
    process.exit(0);
  });

program
  .command("lint <file>")
  .description("Run the pitfall rules over a C or assembly source file (language from the extension, or --language)")
  .option("--language <lang>", "c, asm or auto", "auto")
  .option("--toolchain <name>", "Toolchain name recorded in the output")
  .action(async (file: string, opts: { language: string; toolchain?: string }) => {
    const { lintSourceResult } = await import("./tools/lint.ts");
    const fs = await import("fs");
    const source = fs.readFileSync(file, "utf-8");
    let language = opts.language as "c" | "asm" | "auto";
    if (language === "auto") {
      if (/\.(c|h)$/i.test(file)) language = "c";
      else if (/\.(asm|s|a|inc)$/i.test(file)) language = "asm";
    }
    const result = lintSourceResult(source, { language, toolchain: opts.toolchain }, file);
    emit(result);
    process.exit(result.structured.findings.some((f) => f.certainty === "definite") ? 1 : 0);
  });

program
  .command("pitfalls-for <topic>")
  .description("Look up pitfalls triggered by a register, KERNAL routine, or technique (for a technique, also the pitfalls it is the fix for)")
  .action(async (topic: string) => {
    const { pitfallsFor } = await import("./tools/pitfalls.ts");
    const result = await pitfallsFor(topic);
    emit(result);
    process.exit(0);
  });

program
  .command("failure-diagnose <symptom>")
  .description("Diagnose a failure symptom against the crash-pattern catalog")
  .action(async (symptom: string) => {
    const { failureDiagnose } = await import("./tools/pitfalls.ts");
    const result = await failureDiagnose(symptom);
    emit(result);
    process.exit(0);
  });

program
  .command("demo-briefing <description>")
  .description("Generate a structured C64 demo plan from a brief (Phase 5 anchor tool)")
  .option("--archetype <name>", "Demo form from docs/demo-design/intro-cracktro-patterns.md (cracktro, demo_intro, pack_intro, dentro, party_intro_4k)")
  .action(async (description: string, opts: { archetype?: string }) => {
    const { demoBriefing } = await import("./tools/briefings.ts");
    const result = await demoBriefing(description, opts.archetype);
    if (program.opts().json) {
      console.log(JSON.stringify(result.structured, null, 2));
    } else {
      emit(result);
    }
    process.exit(0);
  });

program
  .command("game-briefing <description>")
  .description("Generate a structured C64 game plan from a brief (Phase 5 anchor tool)")
  .option("--archetype <name>", "Archetype name from docs/game-design/c64-game-archetypes.md (vertical_shmup, puzzle, racing, ...)")
  .option("--genre <genre>", "Alias of --archetype")
  .action(async (description: string, opts: { archetype?: string; genre?: string }) => {
    const { gameBriefing } = await import("./tools/briefings.ts");
    const result = await gameBriefing(description, opts.archetype ?? opts.genre);
    if (program.opts().json) {
      console.log(JSON.stringify(result.structured, null, 2));
    } else {
      emit(result);
    }
    process.exit(0);
  });

program.parseAsync(process.argv);
