/**
 * claims-watch: run a PRG in VICE with a store trace and check every store
 * against what the program declared it may write (#22 step 6, design 3.4).
 *
 *   node scripts/claims-watch.ts game.prg --recipe docs/recipes/kickassembler/x.md \
 *     --claim "irq_vector_0314" --range "screen=$0400-$07FF,colour=$D800-$DBFF" \
 *     --harness cia2_timer_b --kernal IRQ,CHROUT [--all-ram] [--cycles 8000000] [--model ntsc]
 *
 * Declarations (each option repeats; values are comma lists):
 *   --technique ids   the units each technique's **Claims:** line names, and those of the techniques it REQUIRES
 *   --recipe page     the page's frontmatter `techniques:` (as --technique), `uses_kernal:` (as --kernal), `claims:`
 *   --claim text      units in the Claims-line grammar: `irq_vector_0314, zero_page $FB-$FE, sid_voice_2 (shares)`
 *   --range ranges    the program's own RAM: `[name=]$XXXX[-$YYYY]`; the PRG's load span is always declared
 *   --harness items   a measurement harness: units or ranges whose stores are listed apart and never fail
 *   --kernal names    KERNAL routines the program calls; IRQ and NMI name the two services. Their
 *                     `(may; ...)` lines in docs/hardware/kernal-routines-reference.md bound what the ROM
 *                     may write to zero page
 *   --screen addr     screen RAM, so a store to screen+$3F8+n counts as sprite_n (its pointer)
 * Run:
 *   --cycles n (8000000), --model pal|ntsc, --disk d64 (drive 8), --start addr (else the SYS
 *   address of a BASIC stub, else the first store from outside ROM), --all-ram (also trace
 *   $0400-$CFFF and $E000-$FFF9; default traces $0000-$03FF, $D000-$DFFF, $FFFA-$FFFF),
 *   --labels file (.sym or VICE labels; default: beside the PRG), --log file (read a saved
 *   trace instead of running VICE), --keep-log file, --json file
 *
 * What it does. Stores before the program's entry are boot noise and are
 * dropped. A push (JSR, PHA, PHP, an interrupt) is dropped too: the stack is
 * the 6510's, not a claim. Each other store is attributed by its PC and the
 * banking the trace has seen on $01: KERNAL ($E000+ with HIRAM set), BASIC
 * ($A000-$BFFF with LORAM and HIRAM set), else the program. An I/O store is
 * mapped to the HardwareUnits whose bits it changed (src/graph/claims.ts seed).
 * After BASIC's READY (with BASIC ROM mapped) ROM stores are dropped; the
 * program's (its IRQ, its NMI) are still judged.
 *
 * Exit 1 on a violation: a program store to a unit or byte it did not
 * declare (or declared `reads` only), a KERNAL zero-page store outside the
 * may-sets of the declared routines, or a store from a ROM window
 * ($A000-$BFFF, $E000-$FFFF) while $01 is unknown, which cannot be attributed. Exit 2 on a usage or setup error.
 * Needs x64sc (X64SC_BIN, .tools/vice-headless, PATH); a run of 8M cycles
 * takes about a second. The run goes through src/services/vice-batch.ts,
 * shared with the reverse-engineering tools; unlike the old inline launch,
 * it refuses a windowed x64sc (exit 2) unless C64KB_ALLOW_WINDOWED=1.
 */
import { createReadStream, existsSync, readFileSync, copyFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { runBatch, ViceBatchError, type BatchResult, type Model } from "../src/services/vice-batch.ts";
import { Declared } from "./lib/claims-declared.ts";
import { reportJson, reportText } from "./lib/claims-report.ts";
import {
  kernalMaySets,
  labeller,
  loadTechniqueClaims,
  readLabels,
  readPrg,
  recipeFrontmatter,
  withPrerequisites,
  type Prg,
} from "./lib/claims-sources.ts";
import { BASIC_READY, ClaimsWatch, feedHit } from "./lib/claims-trace.ts";
import { buildUnitMap, hex4, parseRanges, rangeText } from "./lib/claims-units.ts";

const root = join(import.meta.dirname, "..");

function fail(msg: string): never {
  console.error(`claims-watch: ${msg}`);
  process.exit(2);
}

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    technique: { type: "string", multiple: true, default: [] },
    recipe: { type: "string" },
    claim: { type: "string", multiple: true, default: [] },
    range: { type: "string", multiple: true, default: [] },
    harness: { type: "string", multiple: true, default: [] },
    kernal: { type: "string", multiple: true, default: [] },
    screen: { type: "string" },
    start: { type: "string" },
    cycles: { type: "string", default: "8000000" },
    model: { type: "string", default: "pal" },
    disk: { type: "string" },
    "all-ram": { type: "boolean", default: false },
    labels: { type: "string" },
    log: { type: "string" },
    "keep-log": { type: "string" },
    json: { type: "string" },
  },
});

const list = (vals: readonly string[]): string[] =>
  vals
    .flatMap((v) => v.split(","))
    .map((s) => s.trim())
    .filter((s) => s !== "");
const addr = (s: string, what: string): number => {
  const m = /^\$?([0-9A-Fa-f]{1,4})$/.exec(s.trim());
  if (!m) fail(`${what} "${s}" is not an address ($XXXX)`);
  return parseInt(m[1] ?? "", 16);
};

/** Units from technique pages (and their prerequisites) and from a recipe's frontmatter. */
function declareTechniques(d: Declared, notes: string[]): { techniques: string[]; kernal: string[] } {
  let ids = list(opt.technique);
  let kernal = list(opt.kernal);
  if (opt.recipe) {
    const fm = recipeFrontmatter(readFileSync(opt.recipe, "utf8"));
    ids = [...ids, ...fm.techniques];
    kernal = [...kernal, ...fm.usesKernal];
    const err = fm.claims === undefined ? null : d.addClaimText(fm.claims, basename(opt.recipe));
    if (err) fail(`${opt.recipe} claims: ${err}`);
  }
  const all = loadTechniqueClaims(root);
  const techniques = withPrerequisites(ids, all);
  for (const id of techniques) {
    const t = all.get(id);
    if (!t) fail(`no technique "${id}" in docs/techniques`);
    if (t.claims === null)
      notes.push(`${id} has no Claims line: its units are unknown; declare them with --claim`);
    else d.addClaims(t.claims, id);
  }
  return { techniques, kernal };
}

/** --claim, --range (and the PRG's own span), --harness. */
function declareExplicit(d: Declared, prg: Prg): void {
  for (const c of opt.claim) {
    const err = d.addClaimText(c, "--claim");
    if (err) fail(`--claim "${c}": ${err}`);
  }
  d.ranges.push({ name: "prg", first: prg.load, last: prg.end });
  for (const r of opt.range) {
    const got = parseRanges(r);
    if ("error" in got) fail(`--range: ${got.error}`);
    d.ranges.push(...got);
  }
  for (const h of opt.harness) {
    const err = d.addHarness(h);
    if (err) fail(`--harness "${h}": ${err}`);
  }
}

function declareKernal(d: Declared, names: readonly string[]): void {
  const may = kernalMaySets(root);
  for (const name of [...new Set(names.map((k) => k.toUpperCase()))]) {
    const set = may.get(name);
    if (!set) fail(`--kernal ${name}: no may-set on the KERNAL page (known: ${[...may.keys()].join(", ")})`);
    d.addKernal(name, set);
  }
}

function monCommands(start: number | undefined): string {
  const lines = [
    "trace store 0000 03ff",
    "trace store d000 dfff",
    "trace store fffa ffff",
    `trace exec ${BASIC_READY.toString(16)} ${BASIC_READY.toString(16)}`,
  ];
  if (opt["all-ram"]) lines.push("trace store 0400 cfff", "trace store e000 fff9");
  if (start !== undefined)
    lines.push(`trace exec ${start.toString(16).padStart(4, "0")} ${start.toString(16).padStart(4, "0")}`);
  return lines.join("\n") + "\n";
}

/** Run the PRG in VICE (src/services/vice-batch.ts) and return the result positioned at the trace log. */
function runVice(prgPath: string, start: number | undefined): BatchResult {
  const model: Model = opt.model === "ntsc" ? "ntsc" : "pal";
  try {
    return runBatch({
      prg: prgPath,
      monCommands: monCommands(start),
      cycles: Number(opt.cycles),
      model,
      ...(opt.disk ? { disk: opt.disk } : {}),
    });
  } catch (e) {
    if (e instanceof ViceBatchError) fail(e.message);
    throw e;
  }
}

async function feedFile(watch: ClaimsWatch, path: string): Promise<void> {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let head: string | null = null;
  for await (const line of rl) head = feedHit(watch, head, line);
}

function labelsFor(prgPath: string): Map<number, string> {
  const stem = prgPath.replace(/\.prg$/i, "");
  const file = opt.labels ?? [".sym", ".lbl", ".vs", ".vice"].map((e) => stem + e).find((f) => existsSync(f));
  return file ? readLabels(readFileSync(file, "utf8")) : new Map<number, string>();
}

function watchFor(start: number | undefined, declared: Declared): ClaimsWatch {
  const { map, screen } = buildUnitMap();
  return new ClaimsWatch({
    units: map,
    screen,
    declared,
    ...(start !== undefined ? { start } : {}),
    ...(opt.screen !== undefined ? { screenBase: addr(opt.screen, "--screen") } : {}),
  });
}

/** Run VICE (or read --log) and feed every hit to the watch. */
async function traceInto(watch: ClaimsWatch, prgPath: string, start: number | undefined): Promise<void> {
  let result: BatchResult | undefined;
  let log: string;
  if (opt.log) {
    log = opt.log;
  } else {
    result = runVice(prgPath, start);
    log = result.log;
  }
  try {
    await feedFile(watch, log);
    if (opt["keep-log"] && !opt.log) copyFileSync(log, opt["keep-log"]);
  } finally {
    result?.dispose();
  }
}

function printHeader(prgPath: string, prg: Prg, start: number | undefined): void {
  const entry = start !== undefined ? `, entry ${hex4(start)}` : "";
  const run = opt.log ? `log ${opt.log}` : `${opt.cycles} cycles ${opt.model.toUpperCase()}`;
  console.log(`claims-watch: ${basename(prgPath)} ${rangeText(prg.load, prg.end)}${entry}; ${run}`);
}

function printRun(watch: ClaimsWatch): void {
  const banking = watch.unknownBanking ? `; ${watch.unknownBanking} stores with $01 unknown` : "";
  const exit =
    watch.endClock === null
      ? ""
      : `; returned to BASIC READY at clock ${watch.endClock}, ${watch.afterExit} ROM stores after it not judged`;
  const ram = opt["all-ram"] ? "" : "; RAM $0400-$CFFF and $E000-$FFF9 not traced (--all-ram)";
  console.log(
    `started at clock ${watch.startClock}; dropped ${watch.bootStores} boot stores and ${watch.pushes} stack pushes${banking}${exit}${ram}`,
  );
}

async function main(): Promise<void> {
  const prgPath = positionals[0];
  if (!prgPath || !existsSync(prgPath))
    fail("usage: claims-watch <file.prg> [declarations] (see the header)");
  const prg = readPrg(readFileSync(prgPath));
  const start = opt.start !== undefined ? addr(opt.start, "--start") : prg.sys;
  const declared = new Declared();
  const notes: string[] = [];
  const { techniques, kernal } = declareTechniques(declared, notes);
  declareExplicit(declared, prg);
  declareKernal(declared, kernal);
  const watch = watchFor(start, declared);
  await traceInto(watch, prgPath, start);

  printHeader(prgPath, prg, start);
  console.log(
    `techniques: ${techniques.join(", ") || "none"}; KERNAL: ${declared.kernalRoutines.join(", ") || "none"}`,
  );
  for (const line of declared.describe()) console.log(`  declared ${line}`);
  for (const n of notes) console.log(`  note: ${n}`);
  if (!watch.started)
    fail("the program never started (no store from outside ROM, no exec of the entry); raise --cycles");
  printRun(watch);
  for (const line of reportText(watch, labeller(labelsFor(prgPath)))) console.log(line);
  if (opt.json) writeFileSync(opt.json, JSON.stringify(reportJson(watch), null, 2) + "\n");
  const v = watch.violations();
  const stores = v.reduce((n, t) => n + t.count, 0);
  console.log(`\n${v.length === 0 ? "PASS" : "FAIL"}: ${stores} stores in ${v.length} violation groups`);
  process.exitCode = v.length === 0 ? 0 : 1;
}

await main();
