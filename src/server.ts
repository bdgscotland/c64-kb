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
import { runGame, RunGameInputSchema, RunGameOutputSchema } from "./tools/run-game.js";
import { registerMemorizationTool } from "./tools/memorization-mcp.js";
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
      },
      outputSchema: SearchSchema.shape,
    },
    async ({ query, limit, filter_source }) => {
      const result = await search(query, limit ?? 5, filter_source);
      let text = result.text;
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

  // ---------------------------------------------------------------------------
  // HVSC Phase 0 tools (c64_hvsc graph — SID analyzer)
  // ---------------------------------------------------------------------------


























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
