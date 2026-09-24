/**
 * claims-watch: run a PRG in VICE with a store trace and check every store
 * against what the program declared it may write (#22 step 6, design 3.4).
 * The work is src/claims/watch.ts, shared with the c64_claims_watch MCP
 * tool (#22 step 8); this file is the command line.
 *
 *   node scripts/claims-watch.ts game.prg --recipe docs/recipes/kickassembler/x.md \
 *     --claim "irq_vector_0314" --range "screen=$0400-$07FF,colour=$D800-$DBFF" \
 *     --harness cia2_timer_b --kernal IRQ,CHROUT [--all-ram] [--cycles 8000000] [--model ntsc]
 *
 * Declarations (each option repeats; values are comma lists):
 *   --technique ids   the units each technique's **Claims:** line names, and those of the techniques it REQUIRES
 *   --recipe page     the page's frontmatter `techniques:` (as --technique), `uses_kernal:` and
 *                     `kernal_services:` (as --kernal), `claims:`, `harness:` (as --harness), `ram:` (as --range)
 *   --claim text      units in the Claims-line grammar: `irq_vector_0314, zero_page $FB-$FE, sid_voice_2 (shares)`
 *   --range ranges    the program's own RAM: `[name=]$XXXX[-$YYYY]`; the PRG's load span is always declared
 *   --harness items   a measurement harness: units or ranges whose stores are listed apart and never fail
 *   --kernal names    KERNAL routines the program calls; IRQ and NMI name the two services. Their
 *                     `(may; ...)` lines in docs/hardware/kernal-routines-reference.md bound what the ROM
 *                     may write to zero page
 *   --screen addr     screen RAM, so a store to screen+$3F8+n counts as sprite_n (its pointer)
 * Run:
 *   --cycles n (8000000), --model pal|ntsc, --disk d64 (drive 8, a copy), --vice-arg=x (one extra
 *   x64sc argument, repeated: a recipe's runs.json flags), --start addr (else the SYS
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
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { reportJson, reportText } from "../src/claims/report.ts";
import { hex4, rangeText } from "../src/claims/units.ts";
import { runClaimsWatch, WatchSetupError, type WatchRun } from "../src/claims/watch.ts";

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
    "vice-arg": { type: "string", multiple: true, default: [] },
    "all-ram": { type: "boolean", default: false },
    labels: { type: "string" },
    log: { type: "string" },
    "keep-log": { type: "string" },
    json: { type: "string" },
  },
});

const addr = (s: string | undefined, what: string): number | undefined => {
  if (s === undefined) return undefined;
  const m = /^\$?([0-9A-Fa-f]{1,4})$/.exec(s.trim());
  if (!m) fail(`${what} "${s}" is not an address ($XXXX)`);
  return parseInt(m[1] ?? "", 16);
};

function printRun(r: WatchRun, prgPath: string): void {
  const { watch, prg, start } = r;
  const entry = start !== undefined ? `, entry ${hex4(start)}` : "";
  const run = opt.log ? `log ${opt.log}` : `${opt.cycles} cycles ${opt.model.toUpperCase()}`;
  console.log(`claims-watch: ${basename(prgPath)} ${rangeText(prg.load, prg.end)}${entry}; ${run}`);
  console.log(
    `techniques: ${r.techniques.join(", ") || "none"}; KERNAL: ${r.declared.kernalRoutines.join(", ") || "none"}`,
  );
  for (const line of r.declared.describe()) console.log(`  declared ${line}`);
  for (const n of r.notes) console.log(`  note: ${n}`);
  if (!watch.started)
    fail("the program never started (no store from outside ROM, no exec of the entry); raise --cycles");
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
  let r: WatchRun;
  try {
    r = await runClaimsWatch({
      docsDir: join(root, "docs"),
      prg: prgPath,
      recipe: opt.recipe,
      techniques: opt.technique,
      claims: opt.claim,
      ranges: opt.range,
      harness: opt.harness,
      kernal: opt.kernal,
      screen: addr(opt.screen, "--screen"),
      start: addr(opt.start, "--start"),
      cycles: Number(opt.cycles),
      model: opt.model === "ntsc" ? "ntsc" : "pal",
      disk: opt.disk,
      viceArgs: opt["vice-arg"],
      allRam: opt["all-ram"],
      labels: opt.labels,
      log: opt.log,
      keepLog: opt["keep-log"],
    });
  } catch (e) {
    if (e instanceof WatchSetupError) fail(e.message);
    throw e;
  }
  printRun(r, prgPath);
  for (const line of reportText(r.watch, r.label)) console.log(line);
  if (opt.json) writeFileSync(opt.json, JSON.stringify(reportJson(r.watch), null, 2) + "\n");
  const v = r.watch.violations();
  const stores = v.reduce((n, t) => n + t.count, 0);
  console.log(`\n${v.length === 0 ? "PASS" : "FAIL"}: ${stores} stores in ${v.length} violation groups`);
  process.exitCode = v.length === 0 ? 0 : 1;
}

await main();
