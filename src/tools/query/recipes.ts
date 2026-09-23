/**
 * Recipe tools: one recipe with its listing, and the recipe index by
 * toolchain, region, technique or file format.
 */

import fs from "fs";
import path from "path";
import { z } from "zod";
import { getFalkor, getAnalytics } from "../../context.ts";
import { config } from "../../config.ts";
import type { RecipeLookupOutput, RecipesForOutput } from "../../schemas/tool-outputs.ts";
import { describeFilter, names, parseRows, searchChunks, suggestNames, toDocChunk } from "./shared.ts";
import type { RecipeLookupResult, RecipesForResult } from "./types.ts";

const RecipeRow = z.object({
  toolchain: z.string(),
  output_format: z.string(),
  region: z.string(),
  source_doc: z.string(),
  toolchain_version_verified: z.string().nullable(),
});

interface SourceListing {
  language: string;
  text: string;
}

async function recipeNotFound(name: string): Promise<RecipeLookupResult> {
  const f = await getFalkor();
  const all = names(await f.roQuery(`MATCH (r:Recipe) RETURN r.name AS name ORDER BY r.name`));
  const suggestions = suggestNames(name, all, "-");

  getAnalytics().logQuery({ tool: "c64_recipe_lookup", query: name, resultCount: 0 });

  const empty: RecipeLookupOutput = {
    name: "",
    toolchain: "",
    output_format: "",
    region: "",
    source_doc: "",
    documentation: [],
  };
  const text = `Recipe \`${name}\` not found.${
    suggestions.length > 0 ? `\n\nDid you mean: ${suggestions.join(", ")}?` : ""
  }\n\nList all recipes with \`c64-kb recipes-for\` (no filter).`;
  return { structured: empty, text };
}

export async function recipeLookup(name: string): Promise<RecipeLookupResult> {
  const f = await getFalkor();
  const row = parseRows(
    RecipeRow,
    await f.roQuery(
      `MATCH (r:Recipe {name: $name})
       OPTIONAL MATCH (r)-[:REQUIRES_TOOL]->(tool:Tool)
       RETURN r.toolchain AS toolchain, r.output_format AS output_format,
              r.region AS region, r.source_doc AS source_doc,
              tool.version_verified AS toolchain_version_verified`,
      { name },
    ),
  ).at(0);
  if (!row) return recipeNotFound(name);

  const { toolchain, output_format, region, source_doc } = row;
  const toolchain_version_verified = row.toolchain_version_verified ?? undefined;

  // Pull doc context
  const { chunks: ctx } = await searchChunks({ query: name, limit: 5 });
  const documentation = ctx
    .filter((c) => c.source === source_doc)
    .slice(0, 5)
    .map(toDocChunk);

  getAnalytics().logQuery({ tool: "c64_recipe_lookup", query: name, resultCount: 1 });

  // The listing itself. The vector chunks carry Build, Synopsis and Expected
  // output; a caller with no file access (an MCP client on another machine,
  // or a small model that will not open a page) could never copy the code.
  // Three of the night's build arms proved it: the two that read the page
  // file shipped the recipe, the one that trusted this answer built from
  // prose (2026-09-22).
  const source_code = readRecipeListing(source_doc);

  const structured: RecipeLookupOutput = {
    name,
    toolchain,
    output_format,
    region,
    source_doc,
    ...(toolchain_version_verified ? { toolchain_version_verified } : {}),
    documentation,
    ...(source_code ? { source_code } : {}),
  };

  let out = `# Recipe: ${name}\n\n`;
  out += `**Toolchain:** ${toolchain}${toolchain_version_verified ? ` (the repo's gates build it with ${toolchain_version_verified})` : ""}\n`;
  out += `**Output:** ${output_format}\n`;
  out += `**Region:** ${region}\n`;
  out += `**Source:** \`${source_doc}\`\n\n`;
  for (const d of documentation) {
    out += `## ${d.section}\n${d.text}\n\n---\n\n`;
  }
  if (source_code) out += renderListing(source_code);
  return { structured, text: out };
}

function renderListing(source_code: SourceListing): string {
  const { language, text } = source_code;
  return (
    `## Source listing (${language}, ${text.split("\n").length} lines, copy as-is)\n\n` +
    "```" +
    language +
    "\n" +
    text +
    (text.endsWith("\n") ? "" : "\n") +
    "```\n"
  );
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err.code === "ENOENT" || err.code === "ENOTDIR");
}

/**
 * The first buildable fence on a recipe page: its Source listing. The
 * listing gate builds exactly this fence, so it is the code the pinned
 * screenshot was made from. Returns null when the page is not on disk.
 */
function readRecipeListing(source_doc: string): SourceListing | null {
  let page: string;
  try {
    page = fs.readFileSync(path.join(config.docs.dir, source_doc), "utf-8");
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  const m = /```(c|asm|kick|kickassembler|kickass)\r?\n([\s\S]*?)```/.exec(page);
  if (!m) return null;
  const [, fence = "", text = ""] = m;
  const language = fence === "kick" || fence === "kickassembler" || fence === "kickass" ? "asm" : fence;
  return { language, text };
}

const RecipeListRow = RecipeRow.omit({ toolchain_version_verified: true }).extend({ name: z.string() });

export interface RecipesFilter {
  toolchain?: string | undefined;
  region?: string | undefined;
  technique?: string | undefined;
  file_format?: string | undefined;
}

function recipesForCypher(filter: RecipesFilter): { cypher: string; params: Record<string, string> } {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filter.toolchain) {
    where.push("r.toolchain = $toolchain");
    params.toolchain = filter.toolchain;
  }
  if (filter.region) {
    where.push("(r.region = $region OR r.region = 'both')");
    params.region = filter.region;
  }
  let cypher = `MATCH (r:Recipe)`;
  if (filter.technique) {
    cypher += ` -[:IMPLEMENTS]-> (t:Technique {name: $technique})`;
    params.technique = filter.technique;
  }
  if (filter.file_format) {
    cypher += ` , (r)-[:PRODUCES]->(f:FileFormat {name: $file_format})`;
    params.file_format = filter.file_format;
  }
  if (where.length > 0) cypher += ` WHERE ${where.join(" AND ")}`;
  cypher += ` RETURN r.name AS name, r.toolchain AS toolchain, r.output_format AS output_format, r.region AS region, r.source_doc AS source_doc ORDER BY r.name`;
  return { cypher, params };
}

export async function recipesFor(filter: RecipesFilter): Promise<RecipesForResult> {
  const f = await getFalkor();
  const { cypher, params } = recipesForCypher(filter);
  const recipes = parseRows(RecipeListRow, await f.roQuery(cypher, params)).map((r) => ({
    name: r.name,
    toolchain: r.toolchain,
    output_format: r.output_format,
    region: r.region,
    source_doc: r.source_doc,
  }));

  getAnalytics().logQuery({
    tool: "c64_recipes_for",
    query: JSON.stringify(filter),
    resultCount: recipes.length,
  });

  const structured: RecipesForOutput = { filter, recipes };

  let out = `# Recipes`;
  const flt = describeFilter({ ...filter });
  if (flt) out += ` (filter: ${flt})`;
  out += `\n\n`;
  if (recipes.length === 0) {
    out += `No recipes match. Try a broader filter or no filter at all.`;
  } else {
    out += `| Recipe | Toolchain | Output | Region |\n|--------|-----------|--------|--------|\n`;
    for (const r of recipes) {
      out += `| ${r.name} | ${r.toolchain} | ${r.output_format} | ${r.region} |\n`;
    }
  }
  return { structured, text: out };
}

