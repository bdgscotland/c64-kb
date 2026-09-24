/** Tools that report on or change the knowledge base itself: ingest, coverage, link suggestions, gap reports. */

import { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { ingestDoc } from "../tools/hydrate.ts";
import { coverage, suggestLinks, reportGap } from "../tools/selfimprovement.ts";
import { CoverageSchema, SuggestLinksSchema, ReportGapSchema } from "../schemas/tool-outputs.ts";
import { defineTool, READ_ONLY } from "./define-tool.ts";
import { definedOnly } from "./defined-only.ts";

/**
 * c64_ingest_doc writes the page under docs/ and replaces that page's chunks
 * in Qdrant and its entities in the graph. Replacing an existing page's text
 * is a destructive update in the MCP spec's sense; the same call twice leaves
 * the same state.
 */
const INGEST_DOC: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** c64_report_gap inserts a gap row or increments its hit count in SQLite: additive, and not idempotent. */
const REPORT_GAP: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const ingestDocTool = defineTool({
  name: "c64_ingest_doc",
  title: "Add or update a document",
  description: `Add or update a single knowledge-base document. Writes the content to the file under docs/ (creating or replacing it), removes the page's old chunks, and upserts the new chunked content into Qdrant (dense embeddings + sparse BM25 vector) and its entities into the graph.

Guidelines: Use to land new reference material from authoritative sources (codebase 64 manual, VIC-II articles, etc.). Re-running for an existing path replaces that page's chunks. Graph edges are merged, never removed: if the update drops a metadata line, run a clean re-ingest to remove the edge it asserted.

Limitations: Cannot refit the BM25 vocabulary on the fly (that would invalidate every existing sparse vector). New tokens introduced by this doc contribute only to the dense vector. Run a full clean re-ingest to incorporate new vocabulary into BM25.

Param notes: 'path' is absolute or relative to docs/, and must resolve inside docs/. 'content' is the full markdown body (frontmatter optional).

Expected length: Single-line summary, e.g. "Ingested 14 chunks from hardware/foo.md."

Example: {"path": "/abs/path/docs/hardware/sid-tricks.md", "content": "# SID tricks\\n..."}`,
  inputSchema: {
    path: z
      .string()
      .describe("Path of the markdown file, absolute or relative to docs/; must resolve inside docs/"),
    content: z.string().describe("Full markdown content (body, optionally with frontmatter)"),
  },
  annotations: INGEST_DOC,
  readsGraph: false,
  run: async ({ path: p, content }) => ({ text: await ingestDoc(p, content) }),
});

export const coverageTool = defineTool({
  name: "c64_coverage",
  title: "Knowledge-base coverage snapshot",
  description: `Snapshot of c64-kb coverage across categories. Returns per-category counts (techniques, pitfalls, recipes by toolchain), KERNAL coverage stats, total graph + Qdrant size, and the top 10 unresolved gaps. Use to assess KB completeness or to inform ingest priorities.

Inputs: none.

Output: structured CoverageOutput with dimensions, totals, recent_gaps, generated_at. Plus a markdown text rendering.

Example: {}`,
  inputSchema: {},
  outputSchema: CoverageSchema.shape,
  annotations: READ_ONLY,
  run: () => coverage(),
});

export const suggestLinksTool = defineTool({
  name: "c64_suggest_links",
  title: "Suggest missing graph edges",
  description: `Heuristic suggestions for missing edges in the knowledge graph. Compares each entity's doc-chunk text against existing graph edges and flags probable misses (e.g., Technique whose body mentions a Register without a USES edge). v1 is regex-based; surfaces obvious misses, not exhaustive review.

Inputs:
  - kind (optional): "technique-register" | "recipe-technique" | "pitfall-technique" | "all" (default "all")
  - limit (optional): max suggestions to return (1-100, default 20)

Output: structured SuggestLinksOutput with suggestions[], generated_at. Suggestion kinds: technique_uses_register, recipe_implements_technique, pitfall_triggered_by_technique, pitfall_mitigated_by_technique. "pitfall-technique" emits the last two: a technique named in a pitfall's Fix section is proposed as MITIGATED_BY, one named elsewhere in the pitfall as TRIGGERED_BY.

Example: {"kind": "technique-register", "limit": 10}`,
  inputSchema: {
    kind: z
      .enum(["technique-register", "recipe-technique", "pitfall-technique", "all"])
      .default("all")
      .describe(
        'Edge kind to check: "technique-register" | "recipe-technique" | "pitfall-technique" | "all"',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe("Max suggestions to return (1-100, default 20)"),
  },
  outputSchema: SuggestLinksSchema.shape,
  annotations: READ_ONLY,
  run: ({ kind, limit }) => suggestLinks({ kind, limit }),
});

export const reportGapTool = defineTool({
  name: "c64_report_gap",
  title: "Report a knowledge gap",
  description: `Record a query that produced no useful result, so the gap surfaces in c64_coverage. Agents should call this when they searched but couldn't ground their answer.

Inputs:
  - query (required): the query that returned nothing useful
  - tool_called (optional): which c64_kb tool was used
  - notes (optional): freeform observation about what's missing

Output: structured ReportGapOutput with gap_id, hit_count, status (new|incremented), and a human-readable message.

Example: {"query": "stable raster IRQ on REU-attached systems", "tool_called": "c64_search", "notes": "no REU coverage in the KB"}`,
  inputSchema: {
    query: z.string().min(1).describe("The query that returned nothing useful"),
    tool_called: z.string().optional().describe("Which c64_kb tool was used (e.g. c64_search)"),
    notes: z.string().optional().describe("Freeform observation about what is missing"),
  },
  outputSchema: ReportGapSchema.shape,
  annotations: REPORT_GAP,
  readsGraph: false,
  run: ({ query, tool_called, notes }) => reportGap({ query, ...definedOnly({ tool_called, notes }) }),
});
