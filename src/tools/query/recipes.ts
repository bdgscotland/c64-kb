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
import { effectiveChips } from "../../graph/machine-variants.ts";
import { describeFilter, names, parseRows, searchChunks, suggestNames, toDocChunk } from "./shared.ts";
import { claimsOf, renderClaims } from "./techniques.ts";
import { devicesOf, renderDevices } from "./devices.ts";
import type { RecipeLookupResult, RecipesForResult } from "./types.ts";

const VerifiedOnRow = z.object({
  variant: z.string(),
  vic: z.string(),
  sid: z.string(),
  cia: z.string(),
  region: z.string(),
  model: z.string(),
  cycles: z.number().int(),
  shot: z.string(),
  flags: z.string(),
  pinned: z.boolean(),
});
type VerifiedOnRow = z.infer<typeof VerifiedOnRow> & { overrides: string[] };

/**
 * The runs of one recipe, each with the chips it actually had: a chip flag
 * in runs.json (cia-revision-detect's `-ciamodel 0`) replaces the variant's
 * chip, and `overrides` says which.
 */
async function verifiedOnOf(name: string): Promise<VerifiedOnRow[]> {
  const f = await getFalkor();
  const rows = parseRows(
    VerifiedOnRow,
    await f.roQuery(
      `MATCH (:Recipe {name: $name})-[e:VERIFIED_ON]->(v:MachineVariant)
       RETURN v.name AS variant, v.vic AS vic, v.sid AS sid, v.cia AS cia, v.region AS region,
              e.model AS model, e.cycles AS cycles, e.shot AS shot, e.flags AS flags, e.pinned AS pinned
       ORDER BY variant`,
      { name },
    ),
  );
  return rows.map((r) => ({ ...r, ...effectiveChips(r, r.flags) }));
}

function verifiedOnText(rows: VerifiedOnRow[]): string {
  if (rows.length === 0)
    return `**Verified on:** no VICE run is compared with a committed screenshot for this recipe\n`;
  const parts = rows.map(
    (v) =>
      `${v.variant} (${v.vic}, ${v.sid}, ${v.cia}; runs.json "${v.model}"${v.flags ? ` ${v.flags}` : ""}${v.overrides.length ? `; the flags replace the variant's chips: ${v.overrides.join(", ")}` : ""}) at ${v.cycles.toLocaleString("en-GB")} cycles${v.pinned ? "" : ", no pinned run: verify:recipes defaults"}`,
  );
  return `**Verified on:** ${parts.join("; ")}. verify:recipes compares each run's exit screenshot with ${rows.map((v) => v.shot).join(", ")} pixel for pixel\n`;
}

const RecipeRow = z.object({
  toolchain: z.string(),
  output_format: z.string(),
  region: z.string(),
  source_doc: z.string(),
  toolchain_version_verified: z.string().nullable(),
  claims_stated: z.string().nullish(),
  claims_basis: z.string().nullish(),
  devices_stated: z.string().nullish(),
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
              tool.version_verified AS toolchain_version_verified,
              r.claims_stated AS claims_stated, r.claims_basis AS claims_basis,
              r.devices_stated AS devices_stated`,
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
  const verified_on = await verifiedOnOf(name);
  const claims = await claimsOf({ label: "Recipe", name }, row);
  const devices = await devicesOf(name, row.devices_stated);

  const structured: RecipeLookupOutput = {
    name,
    toolchain,
    output_format,
    region,
    source_doc,
    ...(toolchain_version_verified ? { toolchain_version_verified } : {}),
    documentation,
    ...(source_code ? { source_code } : {}),
    verified_on,
    ...claims,
    ...devices,
  };

  let out = `# Recipe: ${name}\n\n`;
  out += `**Toolchain:** ${toolchain}${toolchain_version_verified ? ` (the repo's gates build it with ${toolchain_version_verified})` : ""}\n`;
  out += `**Output:** ${output_format}\n`;
  out += `**Region:** ${region}\n`;
  out += `**Source:** \`${source_doc}\`\n`;
  out += `${verifiedOnText(verified_on)}\n`;
  out += renderClaims(claims, "the page has no claims: key; only its techniques' claims are known");
  out += renderDevices(devices);
  out += `\n`;
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
  /** A MachineVariant name (ntsc, oldntsc, c64c) or a region word (PAL, NTSC, PAL-N). */
  verified_on?: string | undefined;
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
  if (filter.verified_on) {
    cypher += ` MATCH (r)-[:VERIFIED_ON]->(vv:MachineVariant)`;
    where.push("(vv.name = $verified_on OR toUpper(vv.region) = toUpper($verified_on))");
    params.verified_on = filter.verified_on;
  }
  if (where.length > 0) cypher += ` WHERE ${where.join(" AND ")}`;
  cypher += ` WITH DISTINCT r RETURN r.name AS name, r.toolchain AS toolchain, r.output_format AS output_format, r.region AS region, r.source_doc AS source_doc ORDER BY r.name`;
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
