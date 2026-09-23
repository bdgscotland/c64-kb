import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { z } from "zod";
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
  LintSourceSchema,
  BriefingSchema,
  CoverageSchema,
  SuggestLinksSchema,
  ReportGapSchema,
} from "../src/schemas/tool-outputs.ts";

// Every tool the server lists, called over stdio the way an MCP client
// calls it, with a small valid input. Each reply must not be an error, and
// a tool that declares an outputSchema must return structuredContent that
// parses with the zod schema the server built that outputSchema from.
//
// Not called, because they have side effects outside the test stores:
// c64_run_game kills the x64sc on monitor port 6502 and starts one;
// c64_ingest_doc writes a file under docs/ (and c64_memorization_check is
// listed only where the Python analyzer is installed).
const SKIP = new Set(["c64_run_game", "c64_ingest_doc", "c64_memorization_check"]);

// Tool -> [arguments, output schema or null for a text-only tool].
const CALLS: Record<string, [Record<string, unknown>, z.ZodType | null]> = {
  c64_health: [{}, null],
  c64_search: [{ query: "stable raster IRQ", limit: 2 }, SearchSchema],
  c64_lookup_register: [{ name_or_addr: "D011" }, RegisterLookupSchema],
  c64_lookup_kernal: [{ name_or_addr: "CHROUT" }, KernalLookupSchema],
  c64_memory_map: [{ addr: "$D011" }, MemoryMapSchema],
  c64_lookup_opcode: [{ byte_or_mnemonic: "LDA" }, OpcodeLookupSchema],
  c64_pal_ntsc_diff: [{ topic: "badline" }, PalNtscDiffSchema],
  c64_toolchain_hint: [{ intent: "raster irq" }, ToolchainHintSchema],
  c64_recipe_lookup: [{ name: "oscar64-hello-world" }, RecipeLookupSchema],
  c64_recipes_for: [{ toolchain: "oscar64" }, RecipesForSchema],
  c64_technique_lookup: [{ name: "stable_raster_irq" }, TechniqueLookupSchema],
  c64_techniques_for: [{ category: "raster" }, TechniquesForSchema],
  c64_check_compatibility: [{ techniques: ["stable_raster_irq", "raster_bars"] }, CompatibilityCheckSchema],
  c64_timing_budget: [
    { technique: "stable_raster_irq", region: "pal", sprites_per_line: 2 },
    TimingBudgetSchema,
  ],
  c64_pitfalls_for: [{ topic: "D012" }, PitfallsForSchema],
  c64_lint_source: [{ source: "  lda $d418\n  ora #$0f\n  sta $d418\n", language: "asm" }, LintSourceSchema],
  c64_failure_diagnose: [{ symptom: "black screen" }, FailureDiagnoseSchema],
  c64_demo_briefing: [{ description: "raster bars and a scroller" }, BriefingSchema],
  c64_game_briefing: [{ description: "vertical shoot-em-up", archetype: "vertical_shmup" }, BriefingSchema],
  c64_coverage: [{}, CoverageSchema],
  c64_suggest_links: [{ kind: "technique-register", limit: 3 }, SuggestLinksSchema],
  c64_report_gap: [{ query: "mcp-tools.test probe", tool_called: "c64_search" }, ReportGapSchema],
};

// The SDK's stdio transport passes only a minimal environment by default;
// the test store names (FALKOR_GRAPH, QDRANT_COLLECTION, ANALYTICS_DB) must
// reach the server or it would read the live stores.
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
);

let client: Client;
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];

beforeAll(async () => {
  client = new Client({ name: "mcp-tools-test", version: "0" });
  await client.connect(new StdioClientTransport({ command: "node", args: ["src/cli.ts", "serve"], env }));
  tools = (await client.listTools()).tools;
}, 30000);

afterAll(async () => {
  await client.close();
});

describe("MCP tools over stdio", () => {
  it("lists every tool with a title and annotations", () => {
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.annotations, t.name).toBeDefined();
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe("boolean");
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
    }
  });

  it("has a test input for every tool it does not skip", () => {
    const untested = tools.map((t) => t.name).filter((n) => !SKIP.has(n) && !(n in CALLS));
    expect(untested).toEqual([]);
  });

  it("marks the tools that change state as not read-only", () => {
    const byName = new Map(tools.map((t) => [t.name, t.annotations]));
    expect(byName.get("c64_ingest_doc")?.readOnlyHint).toBe(false);
    expect(byName.get("c64_report_gap")?.readOnlyHint).toBe(false);
    expect(byName.get("c64_report_gap")?.destructiveHint).toBe(false);
    expect(byName.get("c64_run_game")?.destructiveHint).toBe(true);
  });

  for (const [name, [args, schema]] of Object.entries(CALLS)) {
    it(`${name} replies without error${schema ? " and matches its output schema" : ""}`, async () => {
      const declared = tools.find((t) => t.name === name);
      expect(declared, `${name} is not listed`).toBeDefined();
      const reply = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
      expect(reply.isError ?? false, JSON.stringify(reply.content)).toBe(false);
      if (declared?.outputSchema) {
        expect(schema, `${name} declares an outputSchema; give it one here`).not.toBeNull();
        const parsed = schema?.safeParse(reply.structuredContent);
        expect(parsed?.success, JSON.stringify(parsed?.error?.issues)).toBe(true);
      } else {
        expect(reply.structuredContent).toBeUndefined();
      }
    }, 130000);
  }
});
