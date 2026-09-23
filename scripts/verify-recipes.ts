#!/usr/bin/env node
/**
 * verify-recipes — build every recipe listing, run it headless in VICE with
 * pinned parameters, and compare the screenshot pixel-for-pixel against the
 * one committed next to the recipe.
 *
 * `check-listings` proves a listing assembles. This proves it still draws
 * what the page says it draws: the committed PNG is the baseline, the run is
 * deterministic (`+autostart-delay-random`, fixed `-limitcycles`, fixed
 * model), so any pixel difference is a change in the listing, the toolchain
 * or the emulator — all of which the page must then account for.
 *
 * Run parameters live in docs/recipes/runs.json, keyed "<toolchain>/<stem>":
 *   { "cycles": 8000000, "models": ["pal"], "flags": [], "shots": {"pal": "screenshots/x.png"},
 *     "disk": {"name": "TEST,01"} }
 * Anything not listed gets the defaults: 8,000,000 cycles, PAL, one shot at
 * screenshots/<stem>.png, no disk. With "disk", a fresh D64 is formatted
 * with c1541 (`-format NAME,ID`) before every run and attached as drive 8
 * with the drive's RPM wobble switched off (-drive8wobbleamplitude 0
 * -drive8wobblefrequency 0), so a recipe that writes or reads files starts
 * from the same empty disk each time, takes the same number of cycles, and
 * nothing in the repo is modified by the run.
 *
 * With "cartridge": {"file": "x.crt", "write": true, "runs": 2}, the build
 * must leave x.crt in the work directory (a KickAssembler listing writes it
 * with outBin beside its source). Each model gets a fresh copy, attached
 * with -cartcrt instead of -autostart; "write" adds -easyflashcrtwrite so
 * VICE writes the flash back into the copy, and "runs" boots the same copy
 * that many times in sequence. Run 1's shot is keyed by the model ("pal"),
 * run N's by "<model>-run<N>" ("pal-run2"); the default path for run N is
 * screenshots/<stem>[-<model>]-run<N>.png.
 *
 * Usage:
 *   node scripts/verify-recipes.ts                 # every recipe; exit 1 on any mismatch or missing baseline
 *   node scripts/verify-recipes.ts --file docs/recipes/kickassembler/raster-bars.md
 *   node scripts/verify-recipes.ts --update        # write fresh PNGs as the new baselines (look at them first)
 *   node scripts/verify-recipes.ts --allow-missing # a recipe with no baseline is a warning, not a failure
 *   node scripts/verify-recipes.ts --keep DIR      # keep the fresh PNGs and PRGs under DIR for inspection
 *   node scripts/verify-recipes.ts --jobs N        # run N recipes at once, each in a child process
 *
 * Toolchains are found as check-listings finds them (scripts/lib/toolchains.ts):
 * KICKASS_JAR + java, OSCAR64 or oscar64 on PATH, CL65 or cl65 on PATH, each
 * with a default install location; x64sc from src/services/vice-bin.ts. VICE
 * needs GSETTINGS_SCHEMA_DIR on macOS/Homebrew; it is set here if unset.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { z } from "zod";

import { resolveX64sc, describeX64sc } from "../src/services/vice-bin.ts";
import { RECIPE_TOOLCHAINS, cListing, errorLines, fences, isRecipePage, walk } from "./lib/markdown.ts";
import { findC1541, findToolchains, which } from "./lib/toolchains.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const RECIPES = join(ROOT, "docs", "recipes");
const MANIFEST = join(RECIPES, "runs.json");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string): string | null => {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return null;
  const a = argv.at(i) ?? "";
  return (a.includes("=") ? a.split("=")[1] : argv.at(i + 1)) ?? null;
};
const update = flag("--update");
const allowMissing = flag("--allow-missing");
const onlyFile = opt("--file");
const keepDir = opt("--keep");
const jobsOpt = Number(opt("--jobs") ?? 0);

// runs.json is JSON from disk: validated, not cast. "_comment" is the one
// string entry; every other key is a partial run.
const RunSchema = z.object({
  cycles: z.number(),
  models: z.array(z.string()),
  flags: z.array(z.string()),
  shots: z.record(z.string(), z.string()),
  disk: z.object({ name: z.string() }).optional(),
  cartridge: z
    .object({ file: z.string(), write: z.boolean().optional(), runs: z.number().int().positive().optional() })
    .optional(),
  // A recipe the verifier cannot run (it needs a TAP, a prepared disk or a
  // key press the harness has no flag for) says why here; the listing gate
  // still builds it and the page carries its own pictures under docs/figures.
  skip: z.string().optional(),
});
type Run = z.infer<typeof RunSchema>;
const PartialRunSchema = RunSchema.partial();
const ManifestSchema = z.record(z.string(), z.union([z.string(), PartialRunSchema]));

const manifest = existsSync(MANIFEST) ? ManifestSchema.parse(JSON.parse(readFileSync(MANIFEST, "utf8"))) : {};

/** The pinned parameters for one recipe, or {} when runs.json does not list it. */
function manifestEntry(key: string): z.infer<typeof PartialRunSchema> {
  const e = manifest[key];
  return typeof e === "object" ? e : {};
}

const MODEL_FLAG: Record<string, string[]> = {
  pal: [],
  ntsc: ["-model", "ntsc"],
  oldntsc: ["-model", "oldntsc"],
  drean: ["-model", "drean"],
};

const x64scChoice = resolveX64sc();
console.log(describeX64sc(x64scChoice));
const x64sc = x64scChoice?.path ?? null;
const python3 = which("python3");
const tools = { ...findToolchains(), c1541: findC1541() };
if (!process.env.GSETTINGS_SCHEMA_DIR && existsSync("/opt/homebrew/share/glib-2.0/schemas")) {
  process.env.GSETTINGS_SCHEMA_DIR = "/opt/homebrew/share/glib-2.0/schemas";
}
if (!x64sc) {
  console.error("x64sc not found on PATH");
  process.exit(2);
}
if (!python3) {
  console.error("python3 (with PIL) is needed to compare screenshots");
  process.exit(2);
}

function workDir(): string {
  if (!keepDir) return mkdtempSync(join(tmpdir(), "c64kb-verify-"));
  mkdirSync(keepDir, { recursive: true });
  return keepDir;
}
const work = workDir();

type Job = { rel: string; toolchain: string; stem: string; md: string; run: Run };

function inScope(rel: string): boolean {
  return !onlyFile || relative(ROOT, onlyFile.startsWith("/") ? onlyFile : join(ROOT, onlyFile)) === rel;
}

/** runs.json "shots" key for boot N of a model: "pal", then "pal-run2", "pal-run3". */
function shotKey(model: string, n: number): string {
  return n === 1 ? model : `${model}-run${String(n)}`;
}

/** Default shot paths: screenshots/<stem>[-<model>][-run<N>].png for each model and boot. */
function defaultShots(stem: string, models: string[], runs: number): Record<string, string> {
  return Object.fromEntries(
    models.flatMap((mo) =>
      Array.from({ length: runs }, (_, i) => [
        shotKey(mo, i + 1),
        `screenshots/${stem}${mo === "pal" ? "" : `-${mo}`}${i ? `-run${String(i + 1)}` : ""}.png`,
      ]),
    ),
  );
}

function jobFor(toolchain: string, md: string): Job {
  const stem = basename(md, ".md");
  const m = manifestEntry(`${toolchain}/${stem}`);
  const models = m.models ?? ["pal"];
  const shots = m.shots ?? defaultShots(stem, models, m.cartridge?.runs ?? 1);
  return {
    rel: relative(ROOT, md),
    toolchain,
    stem,
    md,
    run: {
      cycles: m.cycles ?? 8000000,
      models,
      flags: m.flags ?? [],
      shots,
      ...(m.disk === undefined ? {} : { disk: m.disk }),
      ...(m.cartridge === undefined ? {} : { cartridge: m.cartridge }),
    },
  };
}

let skipped = 0;
const jobs: Job[] = [];
for (const toolchain of RECIPE_TOOLCHAINS) {
  const dir = join(RECIPES, toolchain);
  if (!existsSync(dir)) continue;
  for (const md of walk(dir)) {
    if (!inScope(relative(ROOT, md))) continue;
    if (!isRecipePage(readFileSync(md, "utf8"))) continue;
    const skip = manifestEntry(`${toolchain}/${basename(md, ".md")}`).skip;
    if (skip) {
      skipped++;
      console.log(`skip ${relative(ROOT, md)} — ${skip}`);
      continue;
    }
    jobs.push(jobFor(toolchain, md));
  }
}
if (!jobs.length && !skipped) {
  console.log(onlyFile ? `no recipe page at ${onlyFile}` : "FAIL no recipe pages found");
  process.exit(onlyFile ? 0 : 1);
}

type Built = { prg: string | null; log: string };

function buildKick(job: Job, prg: string): Built {
  const f = fences(readFileSync(job.md, "utf8")).find((x) => x.lang === "asm");
  if (!f) return { prg: null, log: "no ```asm listing" };
  if (!tools.kickass || !tools.java)
    return { prg: null, log: "KickAssembler not found (KICKASS_JAR + java)" };
  const src = join(work, `${job.stem}.asm`);
  writeFileSync(src, f.code);
  const r = spawnSync(tools.java, ["-jar", tools.kickass, src, "-o", prg], { encoding: "utf8" });
  return { prg: r.status === 0 ? prg : null, log: errorLines(r.stdout + r.stderr) };
}

function buildOscar(src: string, prg: string): Built {
  if (!tools.oscar64) return { prg: null, log: "oscar64 not found" };
  const r = spawnSync(tools.oscar64, ["-tm=c64", "-O2", `-o=${prg}`, src], { encoding: "utf8", cwd: work });
  return {
    prg: r.status === 0 ? prg : null,
    log: errorLines(r.stdout + r.stderr) || (r.status === 0 ? "" : `exit ${String(r.status)}`),
  };
}

function buildCc65(job: Job, src: string, prg: string, cfgCode: string | undefined): Built {
  if (!tools.cl65) return { prg: null, log: "cl65 not found" };
  // A cc65 recipe may carry its linker configuration in a ```cfg fence; it is
  // written beside the source and passed with -C, as the page's build line does.
  const cfgArgs: string[] = [];
  if (cfgCode !== undefined) {
    const cfg = join(work, `${job.stem}.cfg`);
    writeFileSync(cfg, cfgCode);
    cfgArgs.push("-C", cfg);
  }
  const r = spawnSync(tools.cl65, ["-t", "c64", "-O", ...cfgArgs, "-o", prg, src], {
    encoding: "utf8",
    cwd: work,
  });
  return { prg: r.status === 0 ? prg : null, log: errorLines(r.stdout + r.stderr) };
}

function build(job: Job): Built {
  const prg = join(work, `${job.toolchain}-${job.stem}.prg`);
  if (job.toolchain === "kickassembler") return buildKick(job, prg);
  const all = fences(readFileSync(job.md, "utf8"));
  const f = cListing(all);
  if (!f) return { prg: null, log: "no ```c listing with main()" };
  const src = join(work, `${job.toolchain}-${job.stem}.c`);
  writeFileSync(src, f.code);
  if (job.toolchain === "oscar64") return buildOscar(src, prg);
  return buildCc65(job, src, prg, all.find((x) => x.lang === "cfg")?.code);
}

/**
 * Format a fresh D64 beside the screenshot and return the x64sc arguments
 * that attach it, or an error string.
 */
function diskArgs(png: string, disk: { name: string }): { args: string[] } | { error: string } {
  if (!tools.c1541)
    return { error: "runs.json asks for a disk but c1541 was not found (C1541, PATH, .tools/vice-headless)" };
  const d64 = png.replace(/\.png$/, ".d64");
  const f = spawnSync(tools.c1541, ["-format", disk.name, "d64", d64], { encoding: "utf8" });
  if (!existsSync(d64)) {
    const tail = (f.stderr || f.stdout).split("\n").slice(-2).join(" | ");
    return { error: `c1541 could not format ${d64} (exit ${String(f.status)}): ${tail}` };
  }
  // VICE 3.10 adds a random-phase RPM wobble to the emulated drive by
  // default, which moves a disk operation by a handful of cycles from run
  // to run; a recipe that prints its elapsed time would then differ by a
  // digit. Pin the drive to a constant speed so the run is repeatable.
  return { args: ["-8", d64, "-drive8wobbleamplitude", "0", "-drive8wobblefrequency", "0"] };
}

type ViceRun = {
  /** How the program is attached: ["-autostart", prg] or a cartridge's -cartcrt arguments. */
  attach: string[];
  png: string;
  cycles: number;
  model: string;
  extra: string[];
  disk?: { name: string };
};

/** Run one PRG or cartridge to its pinned cycle count and write the exit screenshot. Returns "" or an error. */
function runVice(v: ViceRun, x64scPath: string): string {
  const disk = v.disk ? diskArgs(v.png, v.disk) : { args: [] };
  if ("error" in disk) return disk.error;
  const args = [
    "-default",
    "-warp",
    "+sound",
    "+autostart-delay-random",
    "-autostartprgmode",
    "1",
    "-limitcycles",
    String(v.cycles),
    ...(MODEL_FLAG[v.model] ?? []),
    ...v.extra,
    ...disk.args,
    "-exitscreenshot",
    v.png,
    ...v.attach,
  ];
  const r = spawnSync(x64scPath, args, { encoding: "utf8", timeout: 300_000 });
  if (!existsSync(v.png)) {
    const tail = (r.stderr || r.stdout).split("\n").slice(-3).join(" | ");
    return `x64sc produced no screenshot (exit ${String(r.status)}${r.signal ? ` ${r.signal}` : ""}): ${tail}`;
  }
  return "";
}

const CMP = `
import sys
from PIL import Image
a = Image.open(sys.argv[1]).convert("RGB"); b = Image.open(sys.argv[2]).convert("RGB")
if a.size != b.size:
    print(f"size {a.size[0]}x{a.size[1]} vs baseline {b.size[0]}x{b.size[1]}"); sys.exit(3)
pa, pb = a.load(), b.load(); w, h = a.size
d = 0; bbox = [w, h, -1, -1]
for y in range(h):
    for x in range(w):
        if pa[x, y] != pb[x, y]:
            d += 1
            if x < bbox[0]: bbox[0] = x
            if y < bbox[1]: bbox[1] = y
            if x > bbox[2]: bbox[2] = x
            if y > bbox[3]: bbox[3] = y
if d: print(f"{d} of {w*h} pixels differ; bbox x{bbox[0]}-{bbox[2]} y{bbox[1]}-{bbox[3]}"); sys.exit(1)
print("identical")
`;
function compare(py: string, fresh: string, baseline: string): { ok: boolean; detail: string } {
  const r = spawnSync(py, ["-c", CMP, fresh, baseline], { encoding: "utf8" });
  return { ok: r.status === 0, detail: (r.stdout || r.stderr).trim() };
}

let failures = 0,
  passes = 0,
  missing = 0,
  updated = 0;
function say(ok: boolean, label: string, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
}

/** No committed PNG: write one under --update, else report it. */
function noBaseline(label: string, fresh: string, baseline: string): void {
  if (update) {
    mkdirSync(dirname(baseline), { recursive: true });
    copyFileSync(fresh, baseline);
    updated++;
    say(true, label, `baseline written: ${relative(ROOT, baseline)} (look at it)`);
    return;
  }
  missing++;
  if (!allowMissing) failures++;
  say(
    allowMissing,
    label,
    `no baseline at ${relative(ROOT, baseline)}; run with --update after looking at ${fresh}`,
  );
}

function compareToBaseline(
  job: Job,
  key: string,
  shot: { fresh: string; baseline: string },
  py: string,
): void {
  const { fresh, baseline } = shot;
  const label = `${job.rel} [${key}]`;
  const c = compare(py, fresh, baseline);
  if (c.ok) {
    passes++;
    say(true, label, `identical to ${relative(ROOT, baseline)} at ${job.run.cycles} cycles`);
  } else if (update) {
    copyFileSync(fresh, baseline);
    updated++;
    say(true, label, `baseline REPLACED (${c.detail}); the page must say why`);
  } else {
    failures++;
    say(
      false,
      label,
      `${c.detail} vs ${relative(ROOT, baseline)} at ${job.run.cycles} cycles${job.run.models.length > 1 ? ` (${key})` : ""}; if the listing changed on purpose, look at ${fresh} and run --update`,
    );
  }
}

type Bins = { x64sc: string; python3: string };
/** A successful build: the PRG, and the .crt it wrote when runs.json names one. */
type Output = { prg: string; crt: string | null };

/** Boot N of one model: run VICE, then compare or write the baseline. Returns false to stop further boots. */
function runBoot(job: Job, boot: { model: string; n: number; attach: string[] }, bins: Bins): boolean {
  const key = shotKey(boot.model, boot.n);
  const label = `${job.rel} [${key}]`;
  const shotRel = job.run.shots[key];
  if (!shotRel) {
    failures++;
    say(false, label, `no shot path in runs.json for "${key}"`);
    return false;
  }
  const baseline = join(dirname(job.md), shotRel);
  const fresh = join(work, `${job.toolchain}-${job.stem}-${key}.png`);
  const err = runVice(
    {
      attach: boot.attach,
      png: fresh,
      cycles: job.run.cycles,
      model: boot.model,
      extra: job.run.flags,
      ...(job.run.disk === undefined ? {} : { disk: job.run.disk }),
    },
    bins.x64sc,
  );
  if (err) {
    failures++;
    say(false, label, err);
    return false;
  }
  if (!existsSync(baseline)) noBaseline(label, fresh, baseline);
  else compareToBaseline(job, key, { fresh, baseline }, bins.python3);
  return true;
}

/**
 * The x64sc attach arguments for one model. A cartridge run boots a fresh
 * copy of the built .crt; with "write" VICE saves the flash back into the
 * copy, so boot N sees what boot N-1 wrote.
 */
function attachFor(job: Job, built: Output, model: string): string[] {
  const { prg, crt } = built;
  if (!crt) return ["-autostart", prg];
  const copy = join(work, `${job.toolchain}-${job.stem}-${model}.crt`);
  copyFileSync(crt, copy);
  return [...(job.run.cartridge?.write ? ["-easyflashcrtwrite"] : []), "-cartcrt", copy];
}

function runModel(job: Job, built: Output, model: string, bins: Bins): void {
  const attach = attachFor(job, built, model);
  const runs = job.run.cartridge?.runs ?? 1;
  for (let n = 1; n <= runs; n++) {
    if (!runBoot(job, { model, n, attach }, bins)) return;
  }
}

function runOne(job: Job, bins: Bins): void {
  const cart = job.run.cartridge;
  const crt = cart ? join(work, cart.file) : null;
  // A stale cartridge from an earlier --keep run must not stand in for this build's.
  if (crt) rmSync(crt, { force: true });
  const { prg, log } = build(job);
  if (!prg) {
    failures++;
    say(false, `${job.rel} (build)`, log);
    return;
  }
  if (crt && !existsSync(crt)) {
    failures++;
    say(false, `${job.rel} (build)`, `runs.json names cartridge ${crt} but the build did not write it`);
    return;
  }
  for (const model of job.run.models) runModel(job, { prg, crt }, model, bins);
}

/** Verify one recipe in a child process of this script; resolves to the child's ok/FAIL lines and exit status. */
function runChild(j: Job): Promise<{ lines: string; status: number | null }> {
  const args = [
    process.argv[1] ?? "",
    "--file",
    j.rel,
    ...(update ? ["--update"] : []),
    ...(allowMissing ? ["--allow-missing"] : []),
    ...(keepDir ? ["--keep", keepDir] : []),
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: process.env, stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.on("error", reject);
    child.on("close", (status) => {
      const lines = out
        .split("\n")
        .filter((l) => /^(ok {2}|FAIL)/.test(l))
        .map((l) => l + "\n")
        .join("");
      resolve({ lines, status });
    });
  });
}

// Sequential by default: VICE runs are CPU-bound and the ordering keeps the log readable.
// --jobs N runs N at once, each as a child process of this script on a single file.
// Until this change the N workers called spawnSync, which blocks the event loop, so
// they ran one child at a time.
async function runParallel(n: number): Promise<void> {
  const queue = [...jobs];
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      const r = await runChild(j);
      process.stdout.write(r.lines);
      if (r.status !== 0) failures++;
      else passes++;
    }
  };
  await Promise.all(Array.from({ length: n }, worker));
}

if (jobsOpt > 1 && !onlyFile) {
  await runParallel(jobsOpt);
} else {
  for (const job of jobs) runOne(job, { x64sc, python3 });
}

console.log(
  `\n${passes} matched, ${failures} failed, ${missing} without baseline, ${skipped} skipped by runs.json, ${updated} baselines written; fresh files in ${work}`,
);
process.exit(failures ? 1 : 0);
