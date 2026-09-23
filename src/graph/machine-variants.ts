/**
 * MachineVariant (schema 29): the C64 models VICE x64sc 3.10 runs here, and
 * the VERIFIED_ON edges docs/recipes/runs.json implies. The chips of each
 * model were read from VICE itself: `x64sc -default -model <m> -dumpconfig`
 * (resources VICIIModel, SidModel, CIA1Model, KernalRev), each VICIIModel
 * number named by dumping `-VICIImodel <chip>`. Lines per frame were
 * measured by recipes/oscar64/pal-ntsc-detect.md on all seven models;
 * cycles per line are from docs/hardware/pal-ntsc-reference.md.
 *
 * `x64sc -default` with no `-model` dumps a configuration identical to
 * `-model c64c` (8565, 8580, 8521), not `c64` (6569, 6581, 6526). The
 * cia-revision-detect listing confirms it: with no -ciamodel flag it
 * reads the new CIA on the default machine and the old one on -model c64.
 * So a runs.json "pal" run is a c64c run.
 */

import { z } from "zod";

export interface MachineVariant {
  /** VICE's `-model` word. */
  name: string;
  vic: string;
  sid: string;
  cia: string;
  cycles_per_line: number;
  lines: number;
  /** "PAL", "NTSC" or "PAL-N". */
  region: string;
  /** True for the machine `x64sc -default` runs with no -model flag. */
  vice_default: boolean;
}

export const MACHINE_VARIANTS: readonly MachineVariant[] = [
  {
    name: "c64",
    vic: "6569",
    sid: "6581",
    cia: "6526",
    cycles_per_line: 63,
    lines: 312,
    region: "PAL",
    vice_default: false,
  },
  {
    name: "c64c",
    vic: "8565",
    sid: "8580",
    cia: "8521",
    cycles_per_line: 63,
    lines: 312,
    region: "PAL",
    vice_default: true,
  },
  {
    name: "c64old",
    vic: "6569R1",
    sid: "6581",
    cia: "6526",
    cycles_per_line: 63,
    lines: 312,
    region: "PAL",
    vice_default: false,
  },
  {
    name: "ntsc",
    vic: "6567R8",
    sid: "6581",
    cia: "6526",
    cycles_per_line: 65,
    lines: 263,
    region: "NTSC",
    vice_default: false,
  },
  {
    name: "newntsc",
    vic: "8562",
    sid: "8580",
    cia: "8521",
    cycles_per_line: 65,
    lines: 263,
    region: "NTSC",
    vice_default: false,
  },
  {
    name: "oldntsc",
    vic: "6567R56A",
    sid: "6581",
    cia: "6526",
    cycles_per_line: 64,
    lines: 262,
    region: "NTSC",
    vice_default: false,
  },
  {
    name: "drean",
    vic: "6572",
    sid: "6581",
    cia: "6526",
    cycles_per_line: 65,
    lines: 312,
    region: "PAL-N",
    vice_default: false,
  },
];

/**
 * runs.json model words to the variant VICE runs for them
 * (scripts/verify-recipes.ts MODEL_FLAG): "pal" adds no -model flag, so it
 * is VICE's default machine.
 */
export const RUNS_MODEL_VARIANT: Readonly<Record<string, string>> = {
  pal: "c64c",
  ntsc: "ntsc",
  oldntsc: "oldntsc",
  drean: "drean",
};

/** One VERIFIED_ON edge: a recipe page's pinned or default run on one model. */
export interface VerifiedOn {
  /** Recipe node source_doc: recipes/<toolchain>/<stem>.md. */
  source_doc: string;
  variant: string;
  /** The runs.json model word. */
  model: string;
  cycles: number;
  /** The committed screenshot the run is compared with, relative to the recipe page. */
  shot: string;
  /** Extra x64sc arguments ("-ciamodel 0"); "" when none. */
  flags: string;
  /** False when runs.json has no entry and verify:recipes uses its defaults. */
  pinned: boolean;
}

const RunEntry = z.object({
  cycles: z.number().int().positive().optional(),
  models: z.array(z.string()).optional(),
  flags: z.array(z.string()).optional(),
  shots: z.record(z.string(), z.string()).optional(),
  cartridge: z.object({ runs: z.number().int().positive().optional() }).loose().optional(),
});
const Manifest = z.record(z.string(), z.union([z.string(), RunEntry.loose()]));

const DEFAULT_CYCLES = 8_000_000;

/** verify-recipes' default shot path for boot 1 of a model. */
function defaultShot(stem: string, model: string): string {
  return `screenshots/${stem}${model === "pal" ? "" : `-${model}`}.png`;
}

type Entry = z.infer<typeof RunEntry>;

/** One page's edges, pushing problems onto the caller's lists. */
function pageEdges(
  page: string,
  entry: Entry | undefined,
  shotExists: (toolchain: string, shot: string) => boolean,
  out: { edges: VerifiedOn[]; unknownModels: string[]; missingShots: string[] },
): void {
  const [toolchain = "", stem = ""] = page.split("/");
  for (const model of entry?.models ?? ["pal"]) {
    const variant = RUNS_MODEL_VARIANT[model];
    if (!variant) {
      out.unknownModels.push(`${page}: ${model}`);
      continue;
    }
    const shot = entry?.shots?.[model] ?? defaultShot(stem, model);
    if (!shotExists(toolchain, shot)) {
      out.missingShots.push(`${page}: ${shot}`);
      continue;
    }
    out.edges.push({
      source_doc: `recipes/${page}.md`,
      variant,
      model,
      cycles: entry?.cycles ?? DEFAULT_CYCLES,
      shot,
      flags: (entry?.flags ?? []).join(" "),
      pinned: entry !== undefined,
    });
  }
}

/**
 * The VERIFIED_ON edges for every recipe page, as verify:recipes runs them:
 * the runs.json entry when there is one, else PAL at 8,000,000 cycles. An
 * edge is emitted only when its committed screenshot exists, because that
 * picture is what the run is compared with. A model word with no variant
 * is reported in `unknownModels`.
 */
export function verifiedOnEdges(opts: {
  manifestJson: string;
  /** Recipe pages as "<toolchain>/<stem>". */
  pages: readonly string[];
  shotExists: (toolchain: string, shot: string) => boolean;
}): { edges: VerifiedOn[]; unknownModels: string[]; missingShots: string[] } {
  const manifest = Manifest.parse(JSON.parse(opts.manifestJson));
  const out = { edges: [] as VerifiedOn[], unknownModels: [] as string[], missingShots: [] as string[] };
  for (const page of opts.pages) {
    const raw = manifest[page];
    pageEdges(page, typeof raw === "object" ? raw : undefined, opts.shotExists, out);
  }
  return out;
}
