/**
 * The claims watch as a function (#22 steps 6 and 8): gather what a
 * program declares it may write, run it in VICE under a store trace (or
 * read a saved trace), and sort every store. scripts/claims-watch.ts (the
 * CLI) and the c64_claims_watch MCP tool both call it; the rules are in
 * trace.ts, the report in report.ts.
 */

import { createReadStream, existsSync, readFileSync, copyFileSync } from "node:fs";
import { basename } from "node:path";
import { createInterface } from "node:readline";
import { runBatch, ViceBatchError, type BatchResult, type Model } from "../services/vice-batch.ts";
import { Declared } from "./declared.ts";
import {
  kernalMaySets,
  labeller,
  loadTechniqueClaims,
  readLabels,
  readPrg,
  recipeFrontmatter,
  withPrerequisites,
  type Prg,
} from "./sources.ts";
import { BASIC_READY, ClaimsWatch, feedHit } from "./trace.ts";
import { buildUnitMap, parseRanges } from "./units.ts";

/** A usage or setup error: the CLI exits 2 on it, the tool refuses. */
export class WatchSetupError extends Error {}

export interface WatchInput {
  /** The docs directory: technique pages and the KERNAL page. */
  docsDir: string;
  prg: string;
  /** A recipe page: its techniques, uses_kernal, kernal_services, claims, harness and ram keys. */
  recipe?: string | undefined;
  techniques?: readonly string[];
  /** Units in the Claims-line grammar, each entry a comma list. */
  claims?: readonly string[];
  /** The program's own RAM, `[name=]$XXXX[-$YYYY]`, each entry a comma list. */
  ranges?: readonly string[];
  harness?: readonly string[];
  kernal?: readonly string[];
  /** Screen RAM, so a store to screen+$3F8+n counts as sprite_n. */
  screen?: number | undefined;
  /** The entry; else the PRG's SYS target, else the first store from outside ROM. */
  start?: number | undefined;
  cycles: number;
  model: Model;
  disk?: string | undefined;
  viceArgs?: readonly string[];
  /** Also trace $0400-$CFFF and $E000-$FFF9. */
  allRam?: boolean;
  /** A .sym or VICE label file; default: beside the PRG. */
  labels?: string | undefined;
  /** Read this saved trace instead of running VICE. */
  log?: string | undefined;
  keepLog?: string | undefined;
}

export interface WatchRun {
  prg: Prg;
  start: number | undefined;
  declared: Declared;
  /** Techniques checked, prerequisites included, in the order met. */
  techniques: string[];
  notes: string[];
  watch: ClaimsWatch;
  label: (pc: number) => string;
}

const list = (vals: readonly string[] = []): string[] =>
  vals
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter((s) => s !== "");

function must(err: string | null, what: string): void {
  if (err) throw new WatchSetupError(`${what}: ${err}`);
}

/** A recipe page: its technique ids and KERNAL names; its claims, harness and RAM go into `d`. */
function declareRecipe(d: Declared, page: string): { ids: string[]; kernal: string[] } {
  if (!existsSync(page)) throw new WatchSetupError(`no recipe page ${page}`);
  const fm = recipeFrontmatter(readFileSync(page, "utf8"));
  if (fm.claims !== undefined) must(d.addClaimText(fm.claims, basename(page)), `${page} claims`);
  if (fm.harness !== undefined) must(d.addHarness(fm.harness), `${page} harness`);
  if (fm.ram !== undefined) must(d.addRam(fm.ram), `${page} ram`);
  const bad = fm.kernalServices.find((k) => k !== "IRQ" && k !== "NMI");
  if (bad !== undefined) throw new WatchSetupError(`${page} kernal_services: "${bad}" is not IRQ or NMI`);
  return { ids: fm.techniques, kernal: [...fm.usesKernal, ...fm.kernalServices] };
}

/** Units from technique pages (and their prerequisites) and from a recipe's frontmatter. */
function declareTechniques(
  d: Declared,
  input: WatchInput,
  notes: string[],
): { techniques: string[]; kernal: string[] } {
  const page = input.recipe ? declareRecipe(d, input.recipe) : { ids: [], kernal: [] };
  const ids = [...list(input.techniques), ...page.ids];
  const kernal = [...list(input.kernal), ...page.kernal];
  const all = loadTechniqueClaims(input.docsDir);
  const techniques = withPrerequisites(ids, all);
  for (const id of techniques) {
    const t = all.get(id);
    if (!t) throw new WatchSetupError(`no technique "${id}" in docs/techniques`);
    if (t.claims === null)
      notes.push(`${id} has no Claims line: its units are unknown; declare them with --claim`);
    else d.addClaims(t.claims, id);
  }
  return { techniques, kernal };
}

/** Explicit claims, ranges (and the PRG's own span), harness. */
function declareExplicit(d: Declared, input: WatchInput, prg: Prg): void {
  for (const c of input.claims ?? []) must(d.addClaimText(c, "--claim"), `--claim "${c}"`);
  d.ranges.push({ name: "prg", first: prg.load, last: prg.end });
  for (const r of input.ranges ?? []) {
    const got = parseRanges(r);
    if ("error" in got) throw new WatchSetupError(`--range: ${got.error}`);
    d.ranges.push(...got);
  }
  for (const h of input.harness ?? []) must(d.addHarness(h), `--harness "${h}"`);
}

function declareKernal(d: Declared, docsDir: string, names: readonly string[]): void {
  const may = kernalMaySets(docsDir);
  for (const name of [...new Set(names.map((k) => k.toUpperCase()))]) {
    const set = may.get(name);
    if (!set)
      throw new WatchSetupError(
        `--kernal ${name}: no may-set on the KERNAL page (known: ${[...may.keys()].join(", ")})`,
      );
    d.addKernal(name, set);
  }
}

const hex = (n: number) => n.toString(16).padStart(4, "0");

function monCommands(start: number | undefined, allRam: boolean): string {
  const lines = [
    "trace store 0000 03ff",
    "trace store d000 dfff",
    "trace store fffa ffff",
    `trace exec ${hex(BASIC_READY)} ${hex(BASIC_READY)}`,
  ];
  if (allRam) lines.push("trace store 0400 cfff", "trace store e000 fff9");
  if (start !== undefined) lines.push(`trace exec ${hex(start)} ${hex(start)}`);
  return lines.join("\n") + "\n";
}

async function feedFile(watch: ClaimsWatch, path: string): Promise<void> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let head: string | null = null;
  for await (const line of rl) head = feedHit(watch, head, line);
}

/** Run VICE (or read the saved log) and feed every hit to the watch. */
async function traceInto(watch: ClaimsWatch, input: WatchInput, start: number | undefined): Promise<void> {
  if (input.log) {
    await feedFile(watch, input.log);
    return;
  }
  let result: BatchResult;
  try {
    result = await runBatch({
      prg: input.prg,
      monCommands: monCommands(start, input.allRam === true),
      cycles: input.cycles,
      model: input.model,
      ...(input.disk ? { disk: input.disk } : {}),
      args: [...(input.viceArgs ?? [])],
    });
  } catch (e) {
    if (e instanceof ViceBatchError) throw new WatchSetupError(e.message);
    throw e;
  }
  try {
    await feedFile(watch, result.log);
    if (input.keepLog) copyFileSync(result.log, input.keepLog);
  } finally {
    result.dispose();
  }
}

function labelsFor(input: WatchInput): Map<number, string> {
  const stem = input.prg.replace(/\.prg$/i, "");
  const file =
    input.labels ?? [".sym", ".lbl", ".vs", ".vice"].map((e) => stem + e).find((f) => existsSync(f));
  return file ? readLabels(readFileSync(file, "utf8")) : new Map<number, string>();
}

/** Declare, trace, sort. Throws WatchSetupError on a bad declaration or a VICE that cannot run. */
export async function runClaimsWatch(input: WatchInput): Promise<WatchRun> {
  if (!existsSync(input.prg)) throw new WatchSetupError(`no PRG ${input.prg}`);
  const prg = readPrg(readFileSync(input.prg));
  const start = input.start ?? prg.sys;
  const declared = new Declared();
  const notes: string[] = [];
  const { techniques, kernal } = declareTechniques(declared, input, notes);
  declareExplicit(declared, input, prg);
  declareKernal(declared, input.docsDir, kernal);
  const { map, screen } = buildUnitMap();
  const watch = new ClaimsWatch({
    units: map,
    screen,
    declared,
    ...(start !== undefined ? { start } : {}),
    ...(input.screen !== undefined ? { screenBase: input.screen } : {}),
  });
  await traceInto(watch, input, start);
  return { prg, start, declared, techniques, notes, watch, label: labeller(labelsFor(input)) };
}
