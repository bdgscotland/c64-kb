/**
 * c64-kb MCP server — thin wrapper over tool functions.
 *
 * Current surface (Phase 7a P7 complete):
 *   Tools (22):
 *     - c64_health
 *     - c64_search
 *     - c64_ingest_doc
 *     - c64_lookup_register
 *     - c64_lookup_kernal
 *     - c64_memory_map
 *     - c64_lookup_opcode
 *     - c64_pal_ntsc_diff
 *     - c64_toolchain_hint        (Phase 2, Oscar64-bias enforcer)
 *     - c64_recipe_lookup         (Phase 2)
 *     - c64_recipes_for           (Phase 2)
 *     - c64_technique_lookup      (Phase 3)
 *     - c64_techniques_for        (Phase 3)
 *     - c64_check_compatibility   (Phase 3, graph-traversal conflict detection)
 *     - c64_timing_budget         (Phase 3, PAL/NTSC cycle math)
 *     - c64_pitfalls_for          (Phase 5, TRIGGERED_BY traversal)
 *     - c64_failure_diagnose      (Phase 5, CrashPattern keyword scoring)
 *     - c64_demo_briefing         (Phase 5, anchor tool — one-shot demo plan)
 *     - c64_game_briefing         (Phase 5, anchor tool — one-shot game plan)
 *     - c64_coverage              (Phase 7a, KB coverage snapshot)
 *     - c64_suggest_links         (Phase 7a, heuristic missing-edge detector)
 *     - c64_report_gap            (Phase 7a, agent-facing gap recorder)
 *   Resources (11 static + 1 template):
 *     - Static: c64://memory-map, c64://kernal-jumptable, c64://opcodes,
 *       c64://illegal-opcodes, c64://pal-ntsc, c64://vic-ii, c64://sid,
 *       c64://cia, c64://6510-cpu, c64://registers, c64://ontology
 *     - Template: c64://register/{name}
 *   Prompts (2):
 *     - c64_demo_brief  (deprecated: prefer c64_demo_briefing tool)
 *     - c64_game_brief  (deprecated: prefer c64_game_briefing tool)
 *
 * Convention: structured tools return `structuredContent` matching a Zod
 * `outputSchema`, alongside a `content[0].text` markdown blob for
 * backward compat. Closed-set string args use `z.enum()`. Tool
 * descriptions follow the 6-component template: purpose, guidelines,
 * limitations, param notes, expected length, example.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  search,
  lookupRegister,
  lookupKernal,
  memoryMap,
  lookupOpcode,
  palNtscDiff,
  toolchainHint,
  recipeLookup,
  recipesFor,
  techniqueLookup,
  techniquesFor,
  checkCompatibility,
  timingBudget,
} from "./tools/query.js";
import { pitfallsFor, failureDiagnose } from "./tools/pitfalls.js";
import { demoBriefing, gameBriefing } from "./tools/briefings.js";
import { ingestDoc } from "./tools/hydrate.js";
import { health, formatHealth } from "./tools/intelligence.js";
import { coverage, suggestLinks, reportGap } from "./tools/selfimprovement.js";
import {
  c64BrowseHvsc, c64HvscStats, c64ComposerProfile,
  c64FindMotifs, c64InstrumentLookup, c64SimilarTunes, c64DriverLookup,
  c64SongStructure, c64VoiceRoles,
} from "./tools/hvsc-mcp.js";
import { c64GestureLookup, c64RhythmLookup, c64ComposerPalette, c64ProgressionLookup, c64PhraseLookup, c64ArpLookup, c64TimbreLookup, c64DrumLookup, c64MultiplexLookup, c64GrammarLookup, c64FormLookup, c64DirectionLookup } from "./tools/palette-mcp.js";
import { arrangeTune } from "./tools/arrange.js";
import { autoCompose, type Ablation } from "./tools/auto-compose.js";
import { composeScore, harmonyFill } from "./tools/compose-run.js";
import { runGame, RunGameInputSchema, RunGameOutputSchema } from "./tools/run-game.js";
import { registerMemorizationTool } from "./tools/memorization-mcp.js";
import { registerUnknownDriverTopTool } from "./tools/unknown-driver-top-mcp.js";
import {
  RegisterLookupSchema,
  KernalLookupSchema,
  MemoryMapSchema,
  OpcodeLookupSchema,
  PalNtscDiffSchema,
  SearchSchema,
  ToolchainHintSchema,
  RecipeLookupSchema,
  RecipesForSchema,
  TechniqueLookupSchema,
  TechniquesForSchema,
  CompatibilityCheckSchema,
  TimingBudgetSchema,
  PitfallsForSchema,
  FailureDiagnoseSchema,
  BriefingSchema,
  CoverageSchema,
  SuggestLinksSchema,
  ReportGapSchema,
} from "./schemas/tool-outputs.js";
import {
  STATIC_RESOURCES,
  readStaticResource,
  readRegisterResource,
} from "./tools/resources.js";
import {
  demoBriefPrompt,
  gameBriefPrompt,
  demoBriefArgs,
  gameBriefArgs,
} from "./tools/prompts.js";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "c64-kb",
    version: "0.1.0",
  });

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  server.registerTool(
    "c64_health",
    {
      description:
        `Health check for c64-kb backing services (Qdrant vector store, FalkorDB graph, Ollama embeddings, SQLite analytics).

Guidelines: Call this before any other tool when a session begins or after suspected service hiccups. The result indicates whether vector search is available (Ollama OK = vector mode; DEGRADED = keyword-only fallback).

Limitations: Reports current liveness only. Does not validate data freshness or detect partial ingest failures.

Returns a markdown table with one row per service. Expected length: ~6 lines.

Example: {} — no arguments.`,
      inputSchema: {},
    },
    async () => {
      const result = await health();
      return { content: [{ type: "text" as const, text: formatHealth(result) }] };
    }
  );

  server.registerTool(
    "c64_search",
    {
      description:
        `Semantic + keyword hybrid search across the entire C64 knowledge base. Returns ranked documentation chunks with confidence badges (HIGH/MEDIUM/LOW based on cosine similarity score).

Guidelines: Use for fuzzy intent ("how does badline timing work?", "which chip handles joystick?") or when the user's question doesn't map cleanly to a register, KERNAL routine, or opcode. For known identifiers, prefer c64_lookup_register / c64_lookup_kernal / c64_lookup_opcode which return structured data.

Limitations: Quality depends on Ollama availability. Without Ollama, falls back to Qdrant's full-text index (no semantic similarity). Indexed corpus is stock C64 only (no Mega65 / SuperCPU / cartridge-specific docs).

Param notes: 'limit' defaults to 5; raise for survey-style queries, lower for tight follow-ups. 'filter_source' is an exact-match source filename (e.g. "vic-ii-reference.md").

Expected length: 5-30 chunks of ~100-300 words each in the markdown view; structuredContent has the same hits as typed JSON.

Example: {"query": "stable raster IRQ", "limit": 3} returns the top-3 chunks across all docs.`,
      inputSchema: {
        query: z.string().describe("Natural-language query about C64 development"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(5)
          .describe("Max results to return (1-20, default 5)"),
        filter_source: z
          .string()
          .optional()
          .describe("Restrict to an exact source file (e.g. 'vic-ii-reference.md')"),
        include_music: z
          .boolean()
          .optional()
          .describe("If true, also query the c64_hvsc graph for tune/motif matches (Phase 1 feature — currently annotates result only)"),
      },
      outputSchema: SearchSchema.shape,
    },
    async ({ query, limit, filter_source, include_music }) => {
      const result = await search(query, limit ?? 5, filter_source);
      let text = result.text;
      if (include_music) {
        const { tune_count } = await c64HvscStats({});
        text += `\n\n---\n*include_music requested; c64_hvsc graph similarity search lands in Phase 1 (current count: ${tune_count} tunes)*`;
      }
      return {
        content: [{ type: "text" as const, text: text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_ingest_doc",
    {
      description:
        `Add or update a single knowledge-base document. Writes the file to disk under docs/ (if absent) and upserts chunked content into Qdrant (dense embeddings + sparse BM25 vector).

Guidelines: Use to land new reference material from authoritative sources (codebase 64 manual, VIC-II articles, etc.). Re-running for an existing path is safe — chunk IDs are deterministic on (source, section, index) so duplicates are updated in place, not appended.

Limitations: Cannot refit the BM25 vocabulary on the fly (that would invalidate every existing sparse vector). New tokens introduced by this doc contribute only to the dense vector. Run a full clean re-ingest to incorporate new vocabulary into BM25.

Param notes: 'path' must be an absolute filesystem path. 'content' is the full markdown body (frontmatter optional).

Expected length: Single-line summary, e.g. "Ingested 14 chunks from hardware/foo.md."

Example: {"path": "/abs/path/docs/hardware/sid-tricks.md", "content": "# SID tricks\\n..."}`,
      inputSchema: {
        path: z.string().describe("Absolute path to write the markdown file"),
        content: z.string().describe("Full markdown content (body, optionally with frontmatter)"),
      },
    },
    async ({ path: p, content }) => ({
      content: [{ type: "text" as const, text: await ingestDoc(p, content) }],
    })
  );

  server.registerTool(
    "c64_lookup_register",
    {
      description:
        `Look up a Commodore 64 hardware register by canonical name, mnemonic, or hex address. Returns the register's chip, R/W status, aliases, and the top 3 most relevant documentation chunks.

Guidelines: Use this when you know a specific register identifier (e.g. "D011", "SCROLY", "$D011") and want its semantics. For fuzzy intent ("which register controls scrolling?"), use c64_search instead.

Limitations: Stock C64 only (no Mega65/SuperCPU registers). Custom expansion-cartridge registers at $DE00-$DFFF are not documented.

Param notes: 'name_or_addr' accepts canonical name (SCROLY), short mnemonic (D011), or hex address ($D011 / D011). The lookup matches all three forms via aliases.

Expected length: 1 register header + up to 3 doc chunks (~200-500 words total).

Example: {"name_or_addr": "D011"} or {"name_or_addr": "$D011"} or {"name_or_addr": "SCROLY"} — all three resolve to the same register.

Returns structured: {name, address, chip, rw, aliases, documentation[]}.`,
      inputSchema: {
        name_or_addr: z
          .string()
          .describe("Register name (e.g. 'SCROLY'), mnemonic (e.g. 'D011'), or hex address ($D011 / D011)"),
      },
      outputSchema: RegisterLookupSchema.shape,
    },
    async ({ name_or_addr }) => {
      const result = await lookupRegister(name_or_addr);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_lookup_kernal",
    {
      description:
        `Look up a KERNAL ROM routine by canonical name (e.g. 'CHROUT') or jump-table address (e.g. '$FFD2'). Returns the routine's description, pairs-with partners (e.g. OPEN/CLOSE, CHKIN/CLRCHN), and the top 3 most relevant documentation chunks.

Guidelines: Use when you know a KERNAL routine identifier. For "what KERNAL routine should I call to print a string?", use c64_search.

Limitations: Stock C64 KERNAL only. JiffyDOS / Final Cartridge / SpeedDOS KERNAL extensions are not indexed.

Param notes: 'name_or_addr' is case-insensitive. Hex addresses accept '$FFD2', 'FFD2', or 'ffd2'.

Expected length: 1 routine header + pairs list + up to 3 doc chunks (~200-400 words total).

Example: {"name_or_addr": "CHROUT"} or {"name_or_addr": "$FFD2"}.

Returns structured: {name, address, description, pairs_with[], documentation[]}.`,
      inputSchema: {
        name_or_addr: z
          .string()
          .describe("KERNAL routine name (CHROUT) or jump-table address ($FFD2 / FFD2)"),
      },
      outputSchema: KernalLookupSchema.shape,
    },
    async ({ name_or_addr }) => {
      const result = await lookupKernal(name_or_addr);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_memory_map",
    {
      description:
        `Given a hex address, return the memory region(s) the address lives in. Correctly reports banked overlap — e.g. $D011 is BOTH "I/O area" AND "VIC-II registers" depending on the bank-switching state of $01.

Guidelines: Use to disambiguate "what is at this address?" when reading existing C64 code. For lookups by region name, query the c64://memory-map resource directly.

Limitations: Returns documented stock-C64 regions only. Doesn't model the full bank-switching matrix; only flags which regions overlap.

Param notes: 'addr' accepts '$D011', 'D011', or 'd011'. Non-hex characters are stripped.

Expected length: Header + 1-3 region rows.

Example: {"addr": "$D011"} returns both the I/O area and VIC-II register entries.

Returns structured: {address, regions[{name, start, end, default_use, bank_switchable}]}.`,
      inputSchema: {
        addr: z
          .string()
          .describe("Hex address (e.g. '$D011', 'D011'). Non-hex characters stripped."),
      },
      outputSchema: MemoryMapSchema.shape,
    },
    async ({ addr }) => {
      const result = await memoryMap(addr);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_lookup_opcode",
    {
      description:
        `Look up a 6510 opcode by byte (e.g. '$A9') or by mnemonic (e.g. 'LDA'). Returns cycles, flag effects, page-cross penalty, and a description from the 6510-cpu-reference (legal opcodes) or 6502-illegal-opcodes (undocumented opcodes) reference docs.

Guidelines: For a byte lookup, expect the single matching opcode at the top. For a mnemonic, expect all addressing-mode variants (e.g. 'LDA' returns LDA #imm, LDA $zp, LDA $nnnn,X, etc.).

Limitations: HuC6280 / 65C02 extensions are not indexed. Illegal opcode behavior reported is the most-commonly-cited consensus (some illegals are bus-dependent and vary by chip revision).

Param notes: 'byte_or_mnemonic' accepts '$A9', 'A9', or 'LDA' (case-insensitive).

Expected length: Up to 3 doc chunks (~150-400 words total).

Example: {"byte_or_mnemonic": "$A9"} returns LDA #imm. {"byte_or_mnemonic": "LDA"} returns all LDA variants.

Returns structured: {query, results[{source, section, text, score}]}.`,
      inputSchema: {
        byte_or_mnemonic: z
          .string()
          .describe("Opcode byte ($A9, A9) or mnemonic (LDA, lda)"),
      },
      outputSchema: OpcodeLookupSchema.shape,
    },
    async ({ byte_or_mnemonic }) => {
      const result = await lookupOpcode(byte_or_mnemonic);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_pal_ntsc_diff",
    {
      description:
        `Compare PAL vs NTSC for a topic. Always returns the canonical region property table (refresh Hz, lines/frame, cycles/line for both PAL and NTSC) plus topic-specific documentation chunks.

Guidelines: Use to surface region-dependent behavior — timing, music tempo, raster mechanics, badline behavior, SID clock. The structured 'regions' array is identical regardless of topic; the 'documentation' array narrows the discussion.

Limitations: PAL-N (Argentina/Brazil) and SECAM are not modeled. Drean PAL-B variant is treated as standard PAL.

Param notes: 'topic' is freeform — short keywords work best ("badline", "music tempo", "SID clock").

Expected length: Region table + up to 3 topic chunks (~200-500 words total).

Example: {"topic": "badline"} returns the timing table plus badline-specific docs.

Returns structured: {topic, regions[], documentation[]}.`,
      inputSchema: {
        topic: z
          .string()
          .describe("Topic to compare (e.g. 'raster timing', 'music tempo', 'badline', 'SID clock')"),
        region: z
          .enum(["pal", "ntsc", "both"])
          .optional()
          .default("both")
          .describe("Limit discussion to a single region (default 'both')"),
      },
      outputSchema: PalNtscDiffSchema.shape,
    },
    async ({ topic, region }) => {
      const result = await palNtscDiff(topic, region);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_toolchain_hint",
    {
      description:
        `Surface an idiomatic code snippet for a (toolchain, intent) pair. Defaults to Oscar64 when no toolchain is specified — c64-kb's primary-toolchain bias enforcer.

Purpose: Returns a ranked set of documentation chunks most relevant to the intent, scoped to the requested toolchain. The structured output carries the snippet text plus the bias-rationale string so the consuming agent can surface it to the user.

Inputs: 'toolchain' is optional (oscar64 | kickassembler | cc65). Omitting it triggers the Oscar64 default and annotates the rationale. 'intent' is a free-form description of what you want to do (e.g. "raster irq", "sprite multiplex", "disk load").

Output: {toolchain, intent, snippet, rationale, sources[]}. 'snippet' is the text of the top-matching chunk. 'rationale' explains the toolchain choice. 'sources' carries up to 3 ranked chunks.

When to use: When you need toolchain-idiomatic code patterns rather than hardware-register semantics. For register/opcode/kernal questions use the dedicated lookup tools.

Examples: {"intent": "raster irq"} → Oscar64 rasterirq.h snippet. {"toolchain": "kickassembler", "intent": "raster irq"} → KickAssembler raster setup.

See also: c64_recipe_lookup for complete buildable examples. c64_search for broad topic queries.

Limitations: Snippet quality depends on corpus coverage. If a pattern doc is missing, the rationale will note a coverage gap. Does not execute or validate code.`,
      inputSchema: {
        toolchain: z
          .enum(["oscar64", "kickassembler", "cc65"])
          .optional()
          .describe("Target toolchain (default: oscar64)"),
        intent: z.string().describe("What you want to do (e.g. 'raster irq', 'sprite multiplex', 'disk load')"),
      },
      outputSchema: ToolchainHintSchema.shape,
    },
    async ({ toolchain, intent }) => {
      const result = await toolchainHint(toolchain, intent);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_recipe_lookup",
    {
      description:
        `Look up a complete, buildable C64 recipe by canonical name (e.g. 'oscar64-hello-world'). Returns structured metadata plus the recipe doc body (synopsis, source, build command, expected output, rationale).

Purpose: Gives the agent a ready-to-use, verified example with build instructions rather than requiring it to synthesize code from raw documentation chunks.

Inputs: 'name' is the canonical recipe identifier — toolchain prefix + hyphen + recipe slug (e.g. 'oscar64-hello-world', 'kickassembler-hello-world', 'cc65-hello-world-conio'). Case-sensitive.

Output: {name, toolchain, output_format, region, source_doc, documentation[]}. On not-found, 'name' is empty and 'text' lists near-match suggestions.

When to use: When you know the specific recipe name or have already identified the toolchain + intent from c64_toolchain_hint and want a complete worked example.

Examples: {"name": "oscar64-hello-world"} returns the Oscar64 hello-world recipe metadata + doc. {"name": "oscar64-hello"} returns not-found with 'oscar64-hello-world' as a suggestion.

See also: c64_recipes_for to enumerate available recipes. c64_toolchain_hint for pattern snippets.

Limitations: Only recipes explicitly ingested into the KB are available. Partial name matches trigger suggestions but do not auto-resolve.`,
      inputSchema: {
        name: z
          .string()
          .describe("Canonical recipe name (e.g. 'oscar64-hello-world', 'kickassembler-hello-world')"),
      },
      outputSchema: RecipeLookupSchema.shape,
    },
    async ({ name }) => {
      const result = await recipeLookup(name);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_recipes_for",
    {
      description:
        `List all recipes matching an optional set of filters: toolchain, region, technique, or file format. Returns a structured table of matching Recipe nodes from FalkorDB.

Purpose: Lets the agent discover what buildable examples are available before committing to a specific recipe. All filters are optional — omitting all returns the full recipe catalog.

Inputs: All optional. 'toolchain' is one of oscar64 | kickassembler | cc65. 'region' is pal | ntsc | both (note: recipes with region='both' appear for any region filter). 'technique' is an exact Technique.title match (Phase 2: no techniques yet — omit for now). 'file_format' is an exact FileFormat.name match (e.g. 'PRG').

Output: {filter, recipes[{name, toolchain, output_format, region, source_doc}]}. Empty recipes array means no matches — try a broader filter.

When to use: Before calling c64_recipe_lookup, use this to discover what names exist. Also useful to audit coverage gaps.

Examples: {"toolchain": "oscar64"} → table of all Oscar64 recipes. {} → full catalog. {"region": "pal"} → PAL-compatible recipes.

See also: c64_recipe_lookup to fetch a specific recipe's full content. c64_toolchain_hint for pattern snippets without a complete recipe.

Limitations: Returns graph metadata only — use c64_recipe_lookup to get the actual source code. technique filter is a no-op in Phase 2 (no Technique nodes yet).`,
      inputSchema: {
        toolchain: z
          .enum(["oscar64", "kickassembler", "cc65"])
          .optional()
          .describe("Filter by toolchain"),
        region: z
          .enum(["pal", "ntsc", "both"])
          .optional()
          .describe("Filter by region (recipes with region='both' match any value)"),
        technique: z
          .string()
          .optional()
          .describe("Filter by Technique title (exact match)"),
        file_format: z
          .string()
          .optional()
          .describe("Filter by FileFormat name (e.g. 'PRG')"),
      },
      outputSchema: RecipesForSchema.shape,
    },
    async ({ toolchain, region, technique, file_format }) => {
      const result = await recipesFor({ toolchain, region, technique, file_format });
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_technique_lookup",
    {
      description:
        `Look up a Commodore 64 programming technique by canonical snake_case name (e.g. 'stable_raster_irq'). Returns technique metadata, chip, region requirements, all USES edges to Registers and KERNAL routines, the list of recipes that implement it, and the top documentation chunks.

Guidelines: Use when you know a specific technique name and want its full profile — registers it touches, KERNAL calls it makes, and buildable recipe examples. For discovery ("what raster techniques exist?"), use c64_techniques_for instead.

Limitations: Returns structured data from FalkorDB; documentation chunks from Qdrant. Technique must be indexed (ingested from docs/techniques/). Partial or hyphenated names trigger a suggestion list.

Param notes: 'name' is the exact snake_case Technique.name (e.g. 'stable_raster_irq', 'sprite_multiplex_8'). Case-sensitive.

Expected length: 1 technique header + register/kernal/recipe lists + up to 3 doc chunks (~200-600 words total).

Example: {"name": "stable_raster_irq"} returns the stable raster IRQ technique with its register list (D011, D012, D019), recipes, and documentation.

Returns structured: {name, title, category, complexity, chip?, requires_region?, uses_registers[], uses_kernal[], recipes[], documentation[]}.`,
      inputSchema: {
        name: z
          .string()
          .describe("Canonical snake_case technique name (e.g. 'stable_raster_irq', 'sprite_multiplex_8')"),
      },
      outputSchema: TechniqueLookupSchema.shape,
    },
    async ({ name }) => {
      const result = await techniqueLookup(name);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_techniques_for",
    {
      description:
        `List C64 techniques matching an optional set of filters: category, chip, region, register, or recipe. All filters are optional — omitting all returns the full technique catalog.

Purpose: Lets the agent discover what techniques are documented before committing to a specific one. Use before c64_technique_lookup to find the right technique name.

Inputs: All optional. 'category' is one of raster | sprite | scroll | bitmap | effect | music | cpu | banking | loader. 'chip' is a chip name (e.g. 'VIC-II', 'SID'). 'region' is PAL or NTSC (techniques that REQUIRE a specific region). 'register' is a register name (e.g. 'D011') to find techniques that USE it. 'recipe' is a recipe canonical name to find what techniques it implements.

Output: {filter, techniques[{name, title, category, complexity}]}. Empty array means no matches.

Examples: {"category": "raster"} → all raster techniques. {"chip": "VIC-II"} → ~30+ rows. {"register": "D011"} → techniques that use SCROLY.

See also: c64_technique_lookup for full profile of a specific technique.

Limitations: region filter matches only techniques with an explicit REQUIRES_REGION edge (PAL/NTSC-locked). Most techniques work on both regions and won't appear in a region filter.`,
      inputSchema: {
        category: z
          .string()
          .optional()
          .describe("Technique category (raster | sprite | scroll | bitmap | effect | music | cpu | banking | loader)"),
        chip: z
          .string()
          .optional()
          .describe("Chip name (e.g. 'VIC-II', 'SID', '6510')"),
        region: z
          .string()
          .optional()
          .describe("Region requirement filter: PAL or NTSC (matches REQUIRES_REGION edge)"),
        register: z
          .string()
          .optional()
          .describe("Register name (e.g. 'D011') — returns techniques that USE this register"),
        recipe: z
          .string()
          .optional()
          .describe("Recipe canonical name — returns techniques that this recipe implements"),
      },
      outputSchema: TechniquesForSchema.shape,
    },
    async ({ category, chip, region, register, recipe }) => {
      const result = await techniquesFor({ category, chip, region, register, recipe });
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_check_compatibility",
    {
      description:
        `Check whether two or more C64 techniques can be combined safely. Detects shared register writes, shared KERNAL calls, and region mismatches by traversing the FalkorDB USES and REQUIRES_REGION edges.

Purpose: Before combining techniques in a demo or game, check for known conflicts. Shared register usage doesn't always mean incompatibility, but requires coordination; the rationale string explains the specific risk.

Inputs: 'techniques' is an array of 2+ canonical technique names (snake_case). Order doesn't matter — all pairwise combinations are checked.

Output: {techniques[], conflicts[], verdict}. verdict is 'compatible' (no conflicts), 'warnings' (shared registers/kernal — combinable with care), or 'incompatible' (region mismatch — cannot run together on same target).

Conflict kinds: 'shared_register' (both WRITE same register), 'shared_kernal' (both call same KERNAL routine), 'region_mismatch' (one needs PAL, other needs NTSC).

Examples: {"techniques": ["stable_raster_irq", "raster_bars"]} → warnings (both touch $D012/$D019). {"techniques": ["stable_raster_irq", "soft_scroll_h"]} → compatible or warnings.

Limitations: Phase 3 heuristic only — detects structural sharing, not semantic conflicts. A future phase adds explicit CONFLICTS_WITH edges for known incompatibilities not visible from register sharing alone.`,
      inputSchema: {
        techniques: z
          .array(z.string())
          .min(2)
          .describe("Array of 2+ canonical technique names to check (e.g. ['stable_raster_irq', 'raster_bars'])"),
      },
      outputSchema: CompatibilityCheckSchema.shape,
    },
    async ({ techniques }) => {
      const result = await checkCompatibility(techniques);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_timing_budget",
    {
      description:
        `Compute the per-scanline cycle budget for a C64 technique on a given region (PAL or NTSC). Returns the canonical cycle constants plus IRQ overhead and net user-available cycles.

Purpose: Gives the agent the authoritative cycle math for raster-critical technique implementations. Use before writing or evaluating cycle-tight C64 raster code.

Inputs: 'technique' is the canonical technique name (e.g. 'stable_raster_irq'). 'region' is 'pal' or 'ntsc' (case-insensitive).

Output: {technique, region, cycles_per_line, cycles_per_frame, badline_cycles_lost, irq_overhead_cycles, user_cycles_per_line_normal, user_cycles_per_line_badline, notes[]}.

Constants: PAL: 63 cycles/line × 312 lines = 19656 cycles/frame. NTSC: 65 cycles/line × 263 lines = 17095 cycles/frame. Badline: 23 cycles lost to VIC DMA. Default IRQ overhead: 14 cycles.

Examples: {"technique": "stable_raster_irq", "region": "pal"} → cycles_per_line=63, user_cycles_per_line_normal=49, user_cycles_per_line_badline=26.

Limitations: irq_overhead is taken from the Technique node's irq_overhead property (if set) or the default 14 cycles. Custom IRQ handlers with different prologues may vary.`,
      inputSchema: {
        technique: z
          .string()
          .describe("Canonical technique name (e.g. 'stable_raster_irq')"),
        region: z
          .string()
          .optional()
          .default("pal")
          .describe("Region: 'pal' or 'ntsc' (case-insensitive, default: 'pal')"),
      },
      outputSchema: TimingBudgetSchema.shape,
    },
    async ({ technique, region }) => {
      const result = await timingBudget({ technique, region: region ?? "pal" });
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_pitfalls_for",
    {
      description:
        `Look up C64 coding pitfalls triggered by a specific Register, KERNAL routine, or Technique. Returns all Pitfall nodes that have a TRIGGERED_BY edge to the named entity, ordered by severity (critical → high → medium → low).

Purpose: Surfaces the gotchas a developer will hit when using a particular register, routine, or technique. Intended as a proactive "what can go wrong?" check before implementing a technique.

Inputs: 'topic' is the entity name to look up. The tool tries three interpretations in order: (1) Register — matched by canonical name, hex address, or alias (e.g. "D012", "$D012"); (2) KernalRoutine — matched by canonical name (e.g. "CHROUT"); (3) Technique — matched by snake_case name (e.g. "stable_raster_irq"). The first interpretation that returns at least one Pitfall wins.

Output: {topic, topic_kind, pitfalls[{name, title, severity, region, category, triggered_by[]}]}. topic_kind is the winning interpretation (Register | KernalRoutine | Technique) or "search" if no direct match was found. pitfalls is ordered severity-descending. Each pitfall's triggered_by list contains all entities that trigger it, not just the queried entity.

When no direct match is found, topic_kind is "search" and pitfalls is empty. Use c64_search or c64_technique_lookup to explore related content.

Examples: {"topic": "D012"} → pitfalls triggered by $D012 (raster line register). {"topic": "stable_raster_irq"} → pitfalls triggered by the stable-raster-IRQ technique. {"topic": "CHROUT"} → pitfalls triggered by the KERNAL CHROUT routine.

See also: c64_failure_diagnose to match symptoms to known failure patterns. c64_technique_lookup for a technique's full profile (registers, KERNAL calls, recipes).

Limitations: Returns only pitfalls indexed in Phase 5 (28 nodes across 8 categories). Topics with no direct graph match fall back to "search" — run c64_search for fuzzy queries.`,
      inputSchema: {
        topic: z
          .string()
          .describe("Register name (D012, $D012), KERNAL routine (CHROUT), or technique name (stable_raster_irq)"),
      },
      outputSchema: PitfallsForSchema.shape,
    },
    async ({ topic }) => {
      const result = await pitfallsFor(topic);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_failure_diagnose",
    {
      description:
        `Given a symptom description (e.g. "black screen", "sprites flicker every other frame"), find matching CrashPattern nodes from the Phase 5 failure-pattern catalog. Returns up to 5 patterns ranked by keyword overlap, each with its description, likely causes, diagnosis steps, and CAUSED_BY graph edges.

Purpose: Lets an agent or developer describe what they observe and get back structured failure-pattern data: what is probably broken, what graph entities cause it, and how to diagnose it.

Inputs: 'symptom' is a free-form description of the observed failure. Short keyword phrases work well ("black screen", "music wrong tempo", "sprites disappear"). The tool tokenizes the query and scores each CrashPattern's symptom slug + description + likely_causes field by token overlap. Tokens shorter than 3 characters are ignored.

Output: {query, matches[{symptom, description, likely_causes[], diagnosis_steps, caused_by[], relevance}]}. matches is ordered by relevance score (0-1). An empty matches array means no patterns scored above zero — try rephrasing with different keywords.

Examples: {"symptom": "black screen"} → matches black_screen pattern (relevance ~1.0). {"symptom": "sprites flicker every other frame"} → matches sprite_flicker_periodic and/or sprite_flicker_random. {"symptom": "music plays too fast"} → matches wrong_music_tempo.

See also: c64_pitfalls_for to look up pitfalls proactively before they occur. c64_search for broad documentation queries.

Limitations: Scoring is token-overlap only — no semantic similarity. Uncommon symptom phrasings may score poorly. Phase 5 covers 15 CrashPattern nodes. Future phases add more patterns.`,
      inputSchema: {
        symptom: z
          .string()
          .describe("Description of the observed failure (e.g. 'black screen', 'sprites flicker every other frame', 'music wrong tempo')"),
      },
      outputSchema: FailureDiagnoseSchema.shape,
    },
    async ({ symptom }) => {
      const result = await failureDiagnose(symptom);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_demo_briefing",
    {
      description:
        `**Phase 5 anchor tool.** Generate a complete, structured C64 demo plan from a natural-language brief in a single call. Internally orchestrates: vector search → technique lookup (graph enrichment per technique) → compatibility check (cross-technique conflict detection) → pitfall surfacing → toolchain split → build order with recipes.

Purpose: Replaces the 9-tool manual composition that the c64_demo_brief Prompt requires from the agent. One call returns the full structured plan as typed JSON plus a human-readable markdown summary.

Inputs: 'description' is a free-form demo brief (e.g. "sprite scroller with raster bars and SID music"). The tool extracts implied techniques via hybrid vector + keyword search, enriches each from the graph, and synthesises the plan.

Output: {brief, proposed_techniques[], compatibility{conflicts, warnings, shared_infrastructure}, pitfalls[], toolchain_split{primary, cycle_tight_handoff[], rationale}, build_order[{step, label, recipes[]}]}. 'brief' is a one-sentence summary. 'proposed_techniques' carry register/KERNAL sets and implementing recipe names. 'toolchain_split.primary' is always "oscar64"; 'cycle_tight_handoff' names the raster/effect techniques handed to KickAssembler.

When to use: Start every new C64 demo design session with this tool. The structured output guides all follow-up tool calls (c64_technique_lookup, c64_check_compatibility, c64_pitfalls_for, c64_recipe_lookup) if deeper drill-down is needed.

Examples: {"description": "sprite scroller with raster bars"} → plan with scroll + raster + stable_raster_irq techniques, compatibility check, pitfalls, build order. {"description": "FLI image viewer with music"} → bitmap + SID techniques, fli_image recipe in build order.

See also: c64_game_briefing for game-framed plans. c64_demo_brief Prompt as an alternate entry point (agent-composed, less structured).

Limitations: Technique selection is heuristic (vector search + keyword overlap). For exotic briefs, the proposed set may miss niche techniques — follow up with c64_techniques_for to discover them. Compatibility check is structural (shared registers/KERNAL), not semantic.`,
      inputSchema: {
        description: z
          .string()
          .describe("Natural-language demo brief (e.g. 'sprite scroller with raster bars and SID music')"),
      },
      outputSchema: BriefingSchema.shape,
    },
    async ({ description }) => {
      const result = await demoBriefing(description);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_game_briefing",
    {
      description:
        `**Phase 5 anchor tool.** Generate a complete, structured C64 game plan from a natural-language brief and optional genre/archetype hint in a single call. Internally orchestrates: vector search → technique lookup → compatibility check → pitfall surfacing → toolchain split → build order (with genre-specific seed recipes like oscar64-simple-shmup for shmup archetype).

Purpose: Replaces the 9-tool manual composition that the c64_game_brief Prompt requires from the agent. One call returns the full structured plan: proposed techniques for the game mechanic, register/KERNAL sets, pitfalls to avoid, Oscar64-primary + KickAssembler-for-hot-paths toolchain split, and a step-by-step build order starting from a matching seed recipe.

Inputs: 'description' is a free-form game brief (e.g. "vertical scrolling shoot-em-up with enemy sprites"). 'archetype' is an optional genre hint (shmup | platformer | puzzle | adventure | etc.) used to seed the build order with the closest matching recipe scaffold.

Output: Same schema as c64_demo_briefing: {brief, proposed_techniques[], compatibility{…}, pitfalls[], toolchain_split{…}, build_order[…]}. 'brief' embeds the archetype string (e.g. "C64 game plan … (genre: shmup)"). build_order step 1 is the game scaffold recipe when archetype is recognised.

When to use: Start every new C64 game design session with this tool. The plan guides follow-up tool calls for deeper drill-down on specific techniques, timing budgets, or failure patterns.

Examples: {"description": "vertical shoot-em-up", "archetype": "shmup"} → plan with sprite_multiplex_8/24, soft_scroll_v, sid_play_routine_pattern, oscar64-simple-shmup in build order. {"description": "single-screen platformer"} → platform-game technique set with sprite collision.

See also: c64_demo_briefing for demo (non-game) plans. c64_game_brief Prompt as an alternate entry point (agent-composed, less structured).

Limitations: Same heuristic selection as c64_demo_briefing. Archetype matching is currently a simple string equality check — "shmup" seeds oscar64-simple-shmup; other archetypes get the same technique selection without a seed recipe. More archetypes will be added in future phases.`,
      inputSchema: {
        description: z
          .string()
          .describe("Natural-language game brief (e.g. 'vertical scrolling shoot-em-up with enemy sprites')"),
        archetype: z
          .string()
          .optional()
          .describe("Optional genre/archetype hint: shmup | platformer | puzzle | adventure | etc."),
      },
      outputSchema: BriefingSchema.shape,
    },
    async ({ description, archetype }) => {
      const result = await gameBriefing(description, archetype);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: result.structured,
      };
    }
  );

  server.registerTool(
    "c64_coverage",
    {
      description:
        `Snapshot of c64-kb coverage across categories. Returns per-category counts (techniques, pitfalls, recipes by toolchain), KERNAL coverage stats, total graph + Qdrant size, and the top 10 unresolved gaps. Use to assess KB completeness or to inform ingest priorities.

Inputs: none.

Output: structured CoverageOutput with dimensions, totals, recent_gaps, generated_at. Plus a markdown text rendering.

Example: {}`,
      inputSchema: {},
      outputSchema: CoverageSchema.shape,
    },
    async () => {
      const r = await coverage();
      return {
        content: [{ type: "text" as const, text: r.text }],
        structuredContent: r.structured,
      };
    }
  );

  server.registerTool(
    "c64_suggest_links",
    {
      description:
        `Heuristic suggestions for missing edges in the knowledge graph. Compares each entity's doc-chunk text against existing graph edges and flags probable misses (e.g., Technique whose body mentions a Register without a USES edge). v1 is regex-based; surfaces obvious misses, not exhaustive review.

Inputs:
  - kind (optional): "technique-register" | "recipe-technique" | "pitfall-technique" | "all" (default "all")
  - limit (optional): max suggestions to return (1-100, default 20)

Output: structured SuggestLinksOutput with suggestions[], generated_at.

Example: {"kind": "technique-register", "limit": 10}`,
      inputSchema: {
        kind: z
          .enum(["technique-register", "recipe-technique", "pitfall-technique", "all"])
          .default("all")
          .describe('Edge kind to check: "technique-register" | "recipe-technique" | "pitfall-technique" | "all"'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(20)
          .describe("Max suggestions to return (1-100, default 20)"),
      },
      outputSchema: SuggestLinksSchema.shape,
    },
    async ({ kind, limit }) => {
      const r = await suggestLinks({ kind, limit });
      return {
        content: [{ type: "text" as const, text: r.text }],
        structuredContent: r.structured,
      };
    }
  );

  server.registerTool(
    "c64_report_gap",
    {
      description:
        `Record a query that produced no useful result, so the gap surfaces in c64_coverage and (later) the dashboard backlog. Agents should call this when they searched but couldn't ground their answer.

Inputs:
  - query (required): the query that returned nothing useful
  - tool_called (optional): which c64_kb tool was used
  - notes (optional): freeform observation about what's missing

Output: structured ReportGapOutput with gap_id, hit_count, status (new|incremented), and a human-readable message.

Example: {"query": "stable raster IRQ on REU-attached systems", "tool_called": "c64_search", "notes": "no REU coverage in the KB"}`,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("The query that returned nothing useful"),
        tool_called: z
          .string()
          .optional()
          .describe("Which c64_kb tool was used (e.g. c64_search)"),
        notes: z
          .string()
          .optional()
          .describe("Freeform observation about what is missing"),
      },
      outputSchema: ReportGapSchema.shape,
    },
    async ({ query, tool_called, notes }) => {
      const r = await reportGap({ query, tool_called, notes });
      return {
        content: [{ type: "text" as const, text: r.text }],
        structuredContent: r.structured,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Runtime tools (Layer 1: eval substrate)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "c64_run_game",
    {
      description:
        `Spawn x64sc with -autostart for the given .prg, drive it via the parallel-input-cell harness pattern (writeMemory into the game's state struct), and return a state trace + final screen render. The eval substrate primitive — used to verify a built game reaches expected states.

Inputs:
  - prg_path (required): absolute path to the .prg to run
  - dbj_path (required): absolute path to the matching .dbj (typed debug info; oscar64 -g produces this)
  - state_symbol (optional, default "state"): top-level state struct symbol name
  - state_read_len (optional, default 16): bytes to read per poll
  - inputs (optional): scheduled writes into the state struct — each {after_ms, offset_in_state, bytes}. Use this to drive harness inputs (e.g. write 1 to state.start_request to simulate a "press fire").
  - poll_every_ms (optional, default 250): state-polling cadence
  - max_duration_ms (optional, default 20000): session hard cap
  - autostart_wait_ms (optional, default 5000): time after x64sc launch before harness loop starts (lets autostart settle)
  - capture_screen (optional, default true): render the final screen

Output: structured RunGameOutput with state_address, state_size, frames_observed, inputs_fired, trace[{at_ms, bytes}], final_screen, exit_reason.

Limitations: kills any existing x64sc on the machine to ensure clean state. Assumes x64sc binary is on PATH. Designed for the parallel-input-cell pattern (see loop/demo/unlock-trap.c); BP-driven games don't fit.

Example: {"prg_path": "/.../unlock-trap.prg", "dbj_path": "/.../unlock-trap.dbj", "inputs": [{"after_ms": 1000, "offset_in_state": 9, "bytes": [1]}, {"after_ms": 2000, "offset_in_state": 8, "bytes": [1]}], "max_duration_ms": 8000}`,
      inputSchema: RunGameInputSchema,
      outputSchema: RunGameOutputSchema,
    },
    async (args) => {
      const r = await runGame(args as Parameters<typeof runGame>[0]);
      const summary =
        `c64_run_game: ${r.exit_reason} after ${r.duration_ms}ms\n` +
        `  state @ $${r.state_address.toString(16).padStart(4, "0")} (size ${r.state_size})\n` +
        `  ${r.frames_observed} polls, ${r.inputs_fired}/${(args.inputs as unknown[] | undefined)?.length ?? 0} inputs fired\n` +
        (r.error ? `  error: ${r.error}\n` : "") +
        (r.final_screen ? `\n--- final screen ---\n${r.final_screen}\n` : "");
      return {
        content: [{ type: "text" as const, text: summary }],
        structuredContent: r,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // SID Phase A tools — memorization detection
  // ---------------------------------------------------------------------------

  registerMemorizationTool(server);
  registerUnknownDriverTopTool(server);

  // ---------------------------------------------------------------------------
  // HVSC Phase 0 tools (c64_hvsc graph — SID analyzer)
  // ---------------------------------------------------------------------------

  server.registerTool(
    "c64_browse_hvsc",
    {
      description:
        `Browse HVSC tunes from the c64_hvsc graph, filtered by composer / chip / region / year. Paginated.

Guidelines: Use when an agent wants to enumerate tunes from a particular composer or chip preference. The c64_hvsc graph is namespace-isolated from the main c64 graph (per spec decision A5), so this tool never surfaces register/recipe nodes — only Tunes.

Limitations: Phase 0 ingests only the canon (~1000 tunes max). Long-tail HVSC is Phase 0b. The graph may be empty if the canon hasn't been ingested yet — counts will be 0 but the shape is correct.

Param notes: All filters are optional. 'limit' defaults to 20, max 100. Composer name must match exactly (case-sensitive; mirrors how HVSC's STIL.txt records authors).

Expected length: a typed JSON array of tune metadata; ~10-100 lines depending on limit.

Example: {"composer": "Rob Hubbard", "limit": 5}`,
      inputSchema: {
        composer: z.string().optional().describe("Exact composer name (e.g. 'Rob Hubbard')"),
        chip: z.enum(["6581", "8580", "either"]).optional().describe("SID chip model preference"),
        region: z.enum(["PAL", "NTSC", "both"]).optional().describe("Target region"),
        year: z.number().int().optional().describe("Release year filter"),
        limit: z.number().int().min(1).max(100).optional().describe("Max tunes to return (1-100, default 20)"),
        offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)"),
      },
    },
    async (args) => {
      const result = await c64BrowseHvsc(args);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_hvsc_stats",
    {
      description:
        `Return counts of each node type in the c64_hvsc graph plus the HVSC_CORPUS_VERSION string.

Guidelines: Call once at the start of an HVSC session to understand what's been ingested. Use tune_count = 0 as a signal that canon ingest hasn't run yet.

Limitations: Node counts are current-state snapshots from FalkorDB. instrument_count is 0 (legacy label; timbre lives in patch_count / patch_family_count). Generative-layer counts (patch / patch_family / motif / motif_family / rhythm / section / voicepart) are 0 until a canon ingest with that layer has run.

Param notes: No arguments.

Expected length: ~8 lines of JSON.

Example: {}`,
      inputSchema: {},
    },
    async () => {
      const stats = await c64HvscStats({});
      return { content: [{ type: "text" as const, text: JSON.stringify(stats, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_composer_profile",
    {
      description:
        `For a given composer, return their vocabulary inventory: the list of tunes they wrote, sorted by year then title.

Guidelines: Use to enumerate what a composer has in the HVSC canon before attempting any style or motif analysis. Per Codex C1, this is strictly a vocabulary inventory — it lists WHAT the composer wrote, not HOW they write. Style modeling is deferred to Phase 1+.

Limitations: Composer name must match exactly (case-sensitive). Returns an empty tunes array if the composer is not in the canon or the graph hasn't been ingested. The 'note' field in the response always restates the vocabulary-inventory constraint.

Param notes: 'name' is the exact composer name as HVSC records it (e.g. 'Rob Hubbard', 'Martin Galway').

Expected length: JSON object with name, tunes array (0-N rows), and note string. Typically 10-200 lines.

Example: {"name": "Rob Hubbard"}`,
      inputSchema: {
        name: z.string().describe("Exact composer name (e.g. 'Rob Hubbard', 'Martin Galway')"),
      },
    },
    async ({ name }) => {
      const result = await c64ComposerProfile({ name });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_find_motifs",
    {
      description:
        `Find recurring melodic motifs (layer 4) in the c64_hvsc graph. Motifs are pitch-interval n-grams (transposition-invariant) mined per voice from the note stream; MotifFamily groups them by melodic contour.

Guidelines: Pass 'composer' to get the MotifFamily contours that composer favours (FAVORS_MOTIF edges, ordered by weight) — the per-composer phrase-shape palette. Pass 'pattern' (a comma-separated interval sequence like "2,2,-1") to look up the exact Motif node and how many tunes use it. Returns { families, motifs, note }.

Limitations: Requires canon ingest (mines motifs in hydrate) + the motif clustering pass (clusterMotifsInGraph) for family results. Returns empty arrays if the graph isn't hydrated or the composer/pattern isn't found.

Param notes: 'composer' is the raw display name (e.g. 'Rob Hubbard'). 'pattern' is signed semitone intervals between consecutive notes, comma-separated. Supply one or the other.

Expected length: JSON with families (0-25 rows) or motifs (0-N rows). Typically 5-40 lines.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().optional().describe("Composer display name → their favoured motif contours (e.g. 'Rob Hubbard')"),
        pattern: z.string().optional().describe("Interval sequence to look up, comma-separated signed semitones (e.g. '2,2,-1')"),
      },
    },
    async ({ composer, pattern }) => {
      const result = await c64FindMotifs({ composer, pattern });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_instrument_lookup",
    {
      description:
        `Look up Patch / PatchFamily by composer palette or patch_hash.

Guidelines: Pass 'composer' to retrieve PatchFamily nodes that composer favors (FAVORS_PATCH edges, ordered by weight). Pass 'patch_hash' to retrieve a specific Patch node and its family membership. Returns { families, patches } — families is non-empty when a composer is found, patches is non-empty when patch_hash is matched.

Limitations: Requires canon ingest + clustering pass to have run (clusterPatchesInGraph). Returns empty arrays if the graph hasn't been hydrated or the composer/patch is not found.

Param notes: 'composer' is the raw composer display name (e.g. 'Rob Hubbard'). 'patch_hash' is the hex patch fingerprint. At least one of the two should be supplied.

Expected length: JSON object with families (0-25 rows) and patches arrays. Typically 5-50 lines.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().optional().describe("Composer display name to look up their patch palette (e.g. 'Rob Hubbard')"),
        patch_hash: z.string().optional().describe("Patch fingerprint hash to look up a specific Patch node"),
      },
    },
    async ({ composer, patch_hash }) => {
      const result = await c64InstrumentLookup({ composer, patch_hash });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_song_structure",
    {
      description:
        `Look up song-form (layer 2) structure from the c64_hvsc graph: either the ordered section sequence of one tune, or a composer's distribution of song forms.

Guidelines: Pass 'file_md5' (and optional 'subtune_index', default 0) to get that subtune's ordered Section list (label, frame span, repeat_of) plus its repeat_shape and intro_frames. Pass 'composer' instead to get the distribution of repeat_shapes across their tunes (which forms they favour). Sections come from windowed pitch-class self-similarity (detect_sections); labels are structural (A/B/A'/loop), NOT semantic (verse/chorus).

Limitations: Requires canon ingest to have run with structure persistence (upsertSections). Returns empty arrays if the tune/composer is absent or the graph predates the structure layer. repeat_shape is null for tunes ingested before this layer.

Param notes: 'file_md5' is the 32-char SID file hash; 'subtune_index' is 0-based. 'composer' is the raw display name (e.g. 'Rob Hubbard'). Supply file_md5 OR composer.

Expected length: JSON with sections (0-N rows) or shapes (0-N rows). Typically 5-40 lines.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        file_md5: z.string().optional().describe("32-char SID file hash to fetch one tune's section sequence"),
        subtune_index: z.number().int().optional().describe("0-based subtune index (default 0); used with file_md5"),
        composer: z.string().optional().describe("Composer display name to get their repeat_shape distribution (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ file_md5, subtune_index, composer }) => {
      const result = await c64SongStructure({ file_md5, subtune_index, composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_voice_roles",
    {
      description:
        `Voice roles (layer 3): the lead/bass/arp/percussion/dual role of each SID voice, or a composer's role distribution.

Guidelines: Pass 'file_md5' (and optional 'subtune_index', default 0) to get each voice's role + stats (avg pitch, note count, noise %) for one subtune. Pass 'composer' instead to get how often they use each role across their tunes. Roles are a heuristic v1 classifier (pitch range / gate length / rhythm regularity / noise %); SID has no fixed channel semantics so role is a learned label per (tune, voice).

Limitations: Requires canon ingest with the voice-role pass (VoicePart nodes). Returns empty arrays if the tune/composer is absent or the graph predates layer 3. 'dual' = unclassified (neither clearly bass nor lead).

Param notes: 'file_md5' is the 32-char SID file hash; 'subtune_index' is 0-based. 'composer' is the raw display name. Supply file_md5 OR composer.

Expected length: JSON with voices (0-N rows) or roles (0-5 rows). Typically 5-30 lines.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        file_md5: z.string().optional().describe("32-char SID file hash to fetch one tune's per-voice roles"),
        subtune_index: z.number().int().optional().describe("0-based subtune index (default 0); used with file_md5"),
        composer: z.string().optional().describe("Composer display name to get their role distribution (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ file_md5, subtune_index, composer }) => {
      const result = await c64VoiceRoles({ file_md5, subtune_index, composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_similar_tunes",
    {
      description:
        `Find tunes structurally similar to a given SID subtune by GRAPH OVERLAP of shared canonical vocabulary — not vector embeddings. Similarity = shared PatchFamilies (fuzzy timbre) + shared exact Motifs (melodic phrases), Jaccard-normalised, plus voice-role and song-form bonuses.

Guidelines: Pass the reference tune's 'file_md5' (+ optional 'subtune_index'); returns the top-k tunes (reference excluded) each with a score AND a breakdown (shared_patch_families, shared_motifs, role_match, same_form) so results are explainable. Identity (title/composer) never enters the score.

Limitations: Requires canon ingest + the patch/motif clustering passes to have run (the vocabulary nodes must exist). Returns matches: [] with a 'note' if the reference tune isn't in the graph. Timbre overlap is over fuzzy PatchFamily clusters (exact Patch SSFs rarely recur across tunes); melodic overlap is over exact shared Motifs.

Param notes: 'file_md5' is the 32-hex .sid hash. 'subtune_index' defaults to 0. 'k' = results to return (default 5).

Expected length: JSON with up to k matches (file_md5, subtune_index, title, composer, score, shared_patch_families, shared_motifs, role_match, same_form).

Example: {"file_md5": "6d019ecba831a9f853675aac29a61c10", "subtune_index": 0, "k": 5}`,
      inputSchema: {
        file_md5: z.string().length(32).describe("MD5 hash of the .sid file (32 hex chars)"),
        subtune_index: z.number().int().min(0).optional().describe("Subtune index within the file (default 0)"),
        k: z.number().int().min(1).max(50).optional().describe("Number of similar tunes to return (default 5)"),
      },
    },
    async ({ file_md5, subtune_index, k }) => {
      const result = await c64SimilarTunes({ file_md5, subtune_index, k });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_driver_lookup",
    {
      description:
        `Look up a SID player/driver by binary hash from the c64_hvsc graph. Phase 0 stub — returns null until driver fingerprinting passes have run.

Guidelines: Check for null return to detect Phase 0 stub status. Once driver nodes are hydrated (Phase 0b), this will return driver name, version, memory footprint, and known tunes.

Limitations: Phase 0 stub: always returns null. Surface is stable so callers can integrate now.

Param notes: 'hash' is a short fingerprint of the driver binary (format TBD).

Expected length: null or a driver JSON object.

Example: {"hash": "deadbeef"}`,
      inputSchema: {
        hash: z.string().describe("Driver binary fingerprint hash (Phase 0: any value accepted, always returns null)"),
      },
    },
    async ({ hash }) => {
      const result = await c64DriverLookup({ hash });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    }
  );

  server.registerTool(
    "c64_gesture_lookup",
    {
      description:
        `Look up a composer's favoured vibrato Gestures (layer 6) from the c64_hvsc graph (FAVORS_GESTURE edges, ordered by weight).

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Returns { gestures, note } where each gesture has kind ('vibrato'), rate_frames, depth_cents, and weight (incidence across the canon). Inline rate_frames/depth_cents directly into a Score voice.vibrato when composing.

Limitations: Requires canon ingest + the gesture clustering pass (clusterGesturesInGraph). Returns an empty array if the composer isn't found or the graph isn't hydrated.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64GestureLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_timbre_lookup",
    {
      description:
        `Look up a composer's mined timbre profile (SP-timbre) — pulse-width modulation (PWM) + shared-filter usage + per-note timbre-gesture trajectories — aggregated from each tune's sid_native fingerprint in the c64_hvsc graph.

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Returns { timbre, timbre_gestures, note }. timbre.pwm { depth, mean_width } → set a lead/arp Voice.pwm { depth, center } for the SID 'breathing pulse'. timbre.filter { dominant_mode, active_fraction, resonance_mean, cutoff_mean, cutoff_std, routed_rate } → drive Score.filter; use the filter only as often as active_fraction suggests. cutoff_mean reads low (averaged over filter-off frames) — pick a musical cutoff_center and sweep with lfo_depth. timbre_gestures = FAVORS_TIMBRE_GESTURE edges (kind/archetype/depth_band/rate_band, by weight) — use these to fill Voice.timbre_gesture for per-note PWM/filter curves that replay the composer's real trajectory shapes instead of a flat LFO.

Limitations: Requires canon ingest + the timbre-gesture clustering pass (clusterTimbreGesturesInGraph / npm run cluster). timbre_gestures is empty if clustering hasn't run. Empty/zeroed for an unknown composer.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64TimbreLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_grammar_lookup",
    {
      description:
        `Look up a composer's mined melodic grammar (SP-grammar, layer 4) from the c64_hvsc graph — the *craft* of their lead lines, not just the vocabulary: a signature hook, how they develop it, and their phrasing fingerprint.

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Returns { grammar, note }. grammar.hook.intervals is the composer's signature recurring figure (semitone steps) — STATE it at a section start, then DEVELOP it across the arc via grammar.development {repeat, sequence=transpose, invert=mirror, augment=stretch rhythm, vary=ornament} (a normalized distribution — follow the proportions) INSTEAD OF walking scales. grammar.phrasing.leap_ratio / mean_abs_interval set step-vs-leap character; contour_distribution is the lead's typical overall shape. grammar.top_hooks gives alternates. This is the fix for "coherent but walks up and down scales".

Limitations: Requires canon ingest + the grammar back-fill (clusterGrammarInGraph / npm run cluster). Empty (n_tunes 0) when the composer has no lead voice with enough notes, or isn't in canon.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64GrammarLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_form_lookup",
    {
      description:
        `Look up a composer's mined form-as-dynamics (SP-form, layer 5) from the c64_hvsc graph — the tension/release ARC over the whole piece, not just section labels.

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Returns { form, note }. form.arc_distribution = the composer's favoured arc archetypes (FAVORS_ARC: flat/rising/falling/arch/oscillate, by weight). form.energy_by_section = the typical per-section energy trajectory (0..1 by section order) — BUILD the arrangement to follow it: raise density/voice-count/register into the peak section, release after, instead of a flat or hand-faked arc. form.peak_section_mean = where the energy peak typically falls. This is the structural half of "energy makes chip music not-boring" (grammar is the melodic half).

Limitations: Requires canon ingest + the form back-fill (clusterFormInGraph / npm run cluster). Most SID tunes are loop-flat or oscillate; a deliberate arch/rising arc stands out. Empty (n_tunes 0) if not in canon.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64FormLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_direction_lookup",
    {
      description:
        `Look up a composer's mined melodic direction (SP-direction, layer 4b) from the c64_hvsc graph — the syntax of MOTION: where the line goes, the fix for "random / directionless".

Guidelines: Pass 'composer' (display name). Returns { direction, note }. direction.cadences = where the composer's phrases LAND (degree relative to key; closed=1/3/5 resolved, open otherwise), by incidence — END sections on a favoured cadence. direction.resolution_rate = how often phrase-ends are voice-led (reached by step); direction.qa_rate = how often phrases pair antecedent→consequent (open question → closed answer); direction.mean_phrase_len. To stop a lead wandering: build phrases that DRIVE to a goal note, pair Q&A at qa_rate, and voice-lead into the goal at resolution_rate. Pairs with grammar (the figure) + form (the whole-piece arc).

Limitations: Requires canon ingest + the direction back-fill (clusterDirectionInGraph / npm run cluster) + a parseable key. Empty (n_tunes 0) if not in canon. Reduces wandering structurally; the ear still gates "good".

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64DirectionLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_drum_lookup",
    {
      description:
        `Look up a composer's mined percussion rhythms (SP-drums) from the c64_hvsc graph — the drum patterns from their percussion-role phrases, plus a representative noise patch.

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Returns { drums, note }. drums.rhythms[].iois are 16th-grid hit spacings — place Voice.drums DrumHits {type,beat} at those spacings on a dedicated percussion voice (conventionally voice 3). Type (kick/snare/hihat) is convention, not mined (noise pitch is type-agnostic): kick on strong beats, snare on the backbeat, hihat on the rest. drums.noise_patch.adsr is a snare/hihat envelope.

Limitations: Requires canon ingest (percussion role + phrases). No re-ingest. Empty if the composer has no mined percussion.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64DrumLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_multiplex_lookup",
    {
      description:
        `Look up how a composer time-multiplexes voices (SP-multiplex) — voices that carry >1 role (e.g. arp+percussion) or interleave drums into a melodic voice's gaps. Aggregated from VoicePart.multiplex in the c64_hvsc graph.

Guidelines: Pass 'composer' (display name). Returns { multiplex, note }: multiplex_rate (fraction of voices that multiplex), common_role_pairs (which roles share a voice), gap_fill_rate (how much of the melodic gaps carry interleaved hits). Compose by interleaving the second role (drums) into the first voice's rests, at that gap-fill rate; mix_check screens the result for stutter.

Limitations: Requires the cluster-multiplex pass (populates VoicePart.multiplex). Empty for an unknown composer.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: { composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')") },
    },
    async ({ composer }) => {
      const result = await c64MultiplexLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_rhythm_lookup",
    {
      description:
        `Look up a composer's common rhythm cells (layer 4r) from the c64_hvsc graph, aggregated from USES_RHYTHM across their tunes.

Guidelines: Pass 'composer' (display name). Returns { rhythms, note } where each cell has slots (JSON [ioi,gate] sequence on a sixteenth grid), n_notes, and occurrences (summed across the composer's tunes). Use the slots to shape a Score voice's note timing.

Limitations: Requires canon ingest (mines rhythm in hydrate). No FAVORS_RHYTHM exists, so this is an occurrence aggregate, not a fuzzy-family rollup. Empty if the composer isn't found.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64RhythmLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_composer_palette",
    {
      description:
        `One-call style palette for a composer from the c64_hvsc graph: favoured patch families, motif contours, vibrato gestures, timbre-gesture trajectories, common rhythm cells, song-form distribution, and voice-role conventions.

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Returns { composer, tunes, patches, motifs, gestures, timbre_gestures, rhythms, song_forms, voice_roles, note }. This is the primary "compose in style X" entry point — pull it, then author a Score from the returned vocabulary (inline gesture rate/depth, use patch family keys, follow the dominant song form + voice roles, fill Voice.timbre_gesture from timbre_gestures for per-note PWM/filter curves).

Limitations: Requires canon ingest + the clustering passes (patches/motifs/gestures/timbre_gestures). Family/gesture arrays are empty if the relevant clustering hasn't run. tunes is 0 for an unknown composer.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64ComposerPalette({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_progression_lookup",
    {
      description:
        `Look up a composer's favoured chord progressions (SP-harmony) from the c64_hvsc graph (FAVORS_PROGRESSION edges, ordered by weight).

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Returns { progressions, note } where each progression has degrees (key-relative scale degrees, e.g. "0min-10maj-8maj"), length, weight (section incidence across the canon), and roman (human-readable, e.g. "i-bVII-bVI"). Transpose the degrees into your Score's meta.key to fill sections[].chords with the composer's own harmony.

Limitations: Requires canon ingest + the progression aggregation pass (clusterProgressionsInGraph). Returns an empty array if the composer isn't found or harmony hasn't been mined.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
      },
    },
    async ({ composer }) => {
      const result = await c64ProgressionLookup({ composer });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_phrase_lookup",
    {
      description:
        `Look up a composer's favoured fused melodic phrases (SP-phrase) — pitch intervals WITH per-note rhythm — from the c64_hvsc graph (FAVORS_PHRASE edges, ordered by weight; or role-filtered USES_PHRASE occurrence sums).

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard') and optionally 'role' (lead/bass/arp/percussion/dual) to scope to that voice role. Returns { phrases, note } where each phrase has intervals (signed semitones), iois + gates (16th-grid units), n_notes, weight, and beats_hint { iois_beats, gates_beats } (×0.25, ready for a Score \`phrase\` primitive). Build a Score voice's phrases[] (PhraseNote) from these to make the melody phrase like the composer with his own rhythm, not uniform notes.

Limitations: Requires canon ingest + the phrase aggregation pass (clusterPhrasesInGraph). Returns an empty array if the composer isn't found or phrases haven't been mined.

Example: {"composer": "Rob Hubbard", "role": "lead"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
        role: z.string().optional().describe("Optional voice role filter: lead/bass/arp/percussion/dual"),
      },
    },
    async ({ composer, role }) => {
      const result = await c64PhraseLookup({ composer, role });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_arp_lookup",
    {
      description:
        `Look up a composer's favoured arpeggio gestures (SP-arp) — the SID chord-shimmer that fakes polyphony — from the c64_hvsc graph (FAVORS_ARP by weight, or role-filtered USES_ARP occurrence sums).

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard') and optionally 'role' (lead/bass/arp/percussion/dual). Returns { arps, note } where each arp has chord_intervals (offsets from the cycle root), cycle (per-step offset sequence), n_notes via n_steps, rate_frames (frames per step, ~50 Hz domain — NOT beats), rate_hz, quality (maj/min/dom7/…), and weight. Build a Score voice's arps[] (ArpNote) from these for the chord bedrock.

Limitations: Requires canon ingest + the arp aggregation pass (clusterArpsInGraph). Returns an empty array if the composer isn't found or arps haven't been mined.

Example: {"composer": "Rob Hubbard"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
        role: z.string().optional().describe("Optional voice role filter: lead/bass/arp/percussion/dual"),
      },
    },
    async ({ composer, role }) => {
      const result = await c64ArpLookup({ composer, role });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_arrange_tune",
    {
      description:
        `Reassemble one mined tune into a multi-section Score scaffold (SP-arrange / tune-seed): its Section form, per-section harmony (Progressions), and each voice's role + patch + vibrato + phrases/arps — placed across the section grid, transposed to the active chord. The structure layer the looping palette-fill lacked.

Guidelines: Pass 'title' (e.g. 'Commando') OR 'file_md5', optional 'subtune' (default 0), 'key' (override the tune's mined key), 'max_bars' (default 32). Returns { score, summary, note }. The 'score' is a refinable DRAFT Score — inspect it, swap/adjust phrases, then pass it to c64_compose. summary lists sections/bars/voices/chords_used/fallbacks.

Limitations: Requires the canon ingested. Phrase placement is synthesized (the graph records what a voice plays, not when) — a scaffold to refine, not a faithful transcription.

Example: {"title": "Commando", "max_bars": 24}`,
      inputSchema: {
        title: z.string().optional().describe("Tune title (e.g. 'Commando'). Provide this or file_md5."),
        file_md5: z.string().optional().describe("Tune file MD5 (alternative to title)."),
        subtune: z.number().optional().describe("Subtune index (default 0)."),
        key: z.string().optional().describe("Override key (e.g. 'C', 'A'); defaults to the tune's mined key."),
        max_bars: z.number().optional().describe("Cap total bars (default 32)."),
      },
    },
    async ({ title, file_md5, subtune, key, max_bars }) => {
      const result = await arrangeTune({ title, fileMd5: file_md5, subtune, key, maxBars: max_bars });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_compose_auto",
    {
      description:
        `Auto-composer (SP-autocompose): one-call deterministic "compose in style X". Encodes the validated SID generation recipe — pull the composer's palette, lay an arrangement arc from their song-form, fill harmony from their progressions, voice a lead (real mined phrases + PWM + vibrato + voicing findings), an octave/sparse bass, and a percussion voice at a section drum-mode — then self-screen the two Score-derivable mix_check gates (drum density + stutter). No audio render: returns a ready Score plus the plan + screen verdict.

Guidelines: Pass 'composer' (display name, e.g. 'Rob Hubbard'). Optional: 'seed' (deterministic variation; same seed → identical Score), 'key'/'mode', 'max_bars' (default 24), 'tempo'. 'ablation' isolates an identity layer for evaluation: 'scramble_palette' (X's structure, another composer's vocabulary — negative control), 'no_timbre' (drop PWM + shared filter), 'generic_phrases' (replace mined contours with uniform filler). Returns { score, plan, screen, palette_used }. Feed score to c64_compose (or 'npm run compose:auto -- --composer X --render' for audio + full mix_check).

Limitations: Requires the canon ingested + clustered. The screen covers the two gated mix_check axes (density/stutter); the ear remains the taste gate.

Example: {"composer": "Rob Hubbard", "seed": 1, "max_bars": 24}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
        seed: z.number().optional().describe("Deterministic seed (same seed → identical Score; default 1)"),
        ablation: z.enum(["none", "scramble_palette", "no_timbre", "generic_phrases"]).optional()
          .describe("Eval ablation: disable/swap one identity layer (default none)"),
        key: z.string().optional().describe("Key (default 'C')"),
        mode: z.enum(["major", "minor"]).optional().describe("Mode (default 'minor')"),
        max_bars: z.number().optional().describe("Total bars (default 24)"),
        tempo: z.number().optional().describe("Tempo in BPM (default 128)"),
      },
    },
    async ({ composer, seed, ablation, key, mode, max_bars, tempo }) => {
      const result = await autoCompose({
        composer, seed, ablation: ablation as Ablation | undefined, key, mode, maxBars: max_bars, tempo,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_harmony_fill",
    {
      description:
        `Fill a Score's chords with a composer's own harmony (SP-harmony): picks the composer's top FAVORS_PROGRESSION and transposes it into the target key.

Guidelines: Pass 'composer' (display name) and 'key' (the Score's meta.key, e.g. 'C', 'A', 'F#'). Returns { chords, degrees, roman } — chords is an ordered array of triad symbols (e.g. ["Am","G","F"]) ready to drop into the Score's sections[].chords; degrees is the key-relative source; roman is the human-readable rendering (e.g. "i-bVII-bVI"). Returns empty chords if the composer has no mined progression or the key is unparseable.

Limitations: Requires canon ingest + the progression aggregation pass (clusterProgressionsInGraph). Uses only the single highest-weight progression.

Example: {"composer": "Rob Hubbard", "key": "A"}`,
      inputSchema: {
        composer: z.string().describe("Composer display name (e.g. 'Rob Hubbard')"),
        key: z.string().describe("Target key for the Score (e.g. 'C', 'A', 'F#')"),
      },
    },
    async ({ composer, key }) => {
      const result = await harmonyFill({ composer, key });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.registerTool(
    "c64_compose",
    {
      description:
        `Compose: render a Score to a playable .sid, inspect it, and (if meta.target_composer is set) grade it with style_proximity — one merged report.

Guidelines: Pass 'score' as a JSON string with meta (key/mode/tempo_bpm/beats_per_bar/target_composer), sections (chords per bar), and voices (each: patch {waveform,adsr,pulse_width,hard_restart}, optional vibrato, notes [{beat,dur_beats,midi}] and/or motifs [{intervals,anchor_midi,at_beats,step_beats,transpose}]). Returns { non_silent, consonance_pct, clash_bars, per_voice, structure, style?, sid_path }. Author voices from c64_composer_palette; iterate to raise style.in_style_pct. When style.per_voice[*].patch_in_palette is false, aim adsr (floored by 4) at style.palette.patches. Add timbre motion: voice.pwm {rate_frames,depth,center} for the breathing pulse, and a top-level score.filter {mode,resonance,cutoff_center,lfo_rate_frames,lfo_depth} with voice.route_to_filter — pull idiomatic values from c64_timbre_lookup. Add drums: a percussion voice (voice 3) with drums [{type:kick|snare|hihat,beat}] — pull rhythms from c64_drum_lookup (drums spend a voice).

Limitations: Renders via the local python compose package; style grading needs the canon ingested + clustered. The .sid is written to a temp path (sid_path) for the human to play.`,
      inputSchema: {
        score: z.string().describe("The Score as a JSON string"),
      },
    },
    async ({ score }) => {
      const parsed = JSON.parse(score);
      const { report, sidPath } = await composeScore(parsed);
      return { content: [{ type: "text" as const, text: JSON.stringify({ ...report, sid_path: sidPath }, null, 2) }] };
    }
  );

  // ---------------------------------------------------------------------------
  // Resources
  // ---------------------------------------------------------------------------

  for (const r of STATIC_RESOURCES) {
    server.resource(
      r.name,
      r.uri,
      { description: r.description, mimeType: "text/markdown" },
      async () => {
        const res = readStaticResource(r.uri);
        return { contents: res ? [res] : [] };
      }
    );
  }

  // Template resource for per-register structured lookup.
  server.resource(
    "register",
    new ResourceTemplate("c64://register/{name}", { list: undefined }),
    {
      description:
        "Per-register structured data (name, address, chip, R/W, aliases). Useful for direct attach when the consuming agent already knows which register it cares about.",
    },
    async (uri, vars) => {
      const name = typeof vars.name === "string" ? vars.name : Array.isArray(vars.name) ? vars.name[0] : "";
      const res = await readRegisterResource(uri.toString(), name);
      return { contents: res ? [res] : [] };
    }
  );

  // ---------------------------------------------------------------------------
  // Prompts
  // ---------------------------------------------------------------------------

  server.prompt(
    "c64_demo_brief",
    "Design a C64 demo from a natural-language brief. Templated body guides the agent through technique identification, register/KERNAL lookup, pitfall surfacing, build order, and toolchain split (Oscar64 vs KickAssembler).",
    demoBriefArgs,
    demoBriefPrompt
  );

  server.prompt(
    "c64_game_brief",
    "Design a C64 game from a natural-language brief. Templated body guides the agent through archetype matching, architecture sketch, technique selection, SID approach, KERNAL usage, and toolchain split.",
    gameBriefArgs,
    gameBriefPrompt
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
