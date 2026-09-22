#!/usr/bin/env tsx
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
 * Usage:
 *   npx tsx scripts/verify-recipes.ts                 # every recipe; exit 1 on any mismatch or missing baseline
 *   npx tsx scripts/verify-recipes.ts --file docs/recipes/kickassembler/raster-bars.md
 *   npx tsx scripts/verify-recipes.ts --update        # write fresh PNGs as the new baselines (look at them first)
 *   npx tsx scripts/verify-recipes.ts --allow-missing # a recipe with no baseline is a warning, not a failure
 *   npx tsx scripts/verify-recipes.ts --keep DIR      # keep the fresh PNGs and PRGs under DIR for inspection
 *
 * Toolchains are found as check-listings finds them: KICKASS_JAR + java,
 * OSCAR64 or oscar64 on PATH, cl65 on PATH, x64sc on PATH. VICE needs
 * GSETTINGS_SCHEMA_DIR on macOS/Homebrew; it is set here if unset.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const RECIPES = join(ROOT, "docs", "recipes");
const MANIFEST = join(RECIPES, "runs.json");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string): string | null => {
  const i = argv.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (i === -1) return null;
  return argv[i].includes("=") ? argv[i].split("=")[1] : argv[i + 1] ?? null;
};
const update = flag("--update");
const allowMissing = flag("--allow-missing");
const onlyFile = opt("--file");
const keepDir = opt("--keep");
const jobsOpt = Number(opt("--jobs") ?? 0);

type Run = { cycles: number; models: string[]; flags: string[]; shots: Record<string, string>; disk?: { name: string } };
type Manifest = Record<string, Partial<Run>>;

const manifest: Manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const MODEL_FLAG: Record<string, string[]> = { pal: [], ntsc: ["-model", "ntsc"], oldntsc: ["-model", "oldntsc"], drean: ["-model", "drean"] };

function which(cmd: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
const tools = {
  kickass: process.env.KICKASS_JAR && existsSync(process.env.KICKASS_JAR) ? process.env.KICKASS_JAR : null,
  java: which("java"),
  oscar64: process.env.OSCAR64 && existsSync(process.env.OSCAR64) ? process.env.OSCAR64 : which("oscar64"),
  cl65: which("cl65"),
  x64sc: which("x64sc"),
  c1541: which("c1541"),
  python3: which("python3"),
};
if (!process.env.GSETTINGS_SCHEMA_DIR && existsSync("/opt/homebrew/share/glib-2.0/schemas")) {
  process.env.GSETTINGS_SCHEMA_DIR = "/opt/homebrew/share/glib-2.0/schemas";
}
if (!tools.x64sc) { console.error("x64sc not found on PATH"); process.exit(2); }
if (!tools.python3) { console.error("python3 (with PIL) is needed to compare screenshots"); process.exit(2); }

function fences(md: string): { lang: string; code: string }[] {
  const out: { lang: string; code: string }[] = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) out.push({ lang: m[1].toLowerCase(), code: m[2] });
  return out;
}
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

const work = keepDir ? (mkdirSync(keepDir, { recursive: true }), keepDir) : mkdtempSync(join(tmpdir(), "c64kb-verify-"));

type Job = { rel: string; toolchain: string; stem: string; md: string; run: Run };
const jobs: Job[] = [];
for (const toolchain of ["kickassembler", "oscar64", "cc65"]) {
  const dir = join(RECIPES, toolchain);
  if (!existsSync(dir)) continue;
  for (const md of walk(dir)) {
    const rel = relative(ROOT, md);
    if (onlyFile && relative(ROOT, onlyFile.startsWith("/") ? onlyFile : join(ROOT, onlyFile)) !== rel) continue;
    const text = readFileSync(md, "utf8");
    if (!/^---\n(?:[\s\S]*?\n)?recipe:/m.test(text)) continue;
    const stem = basename(md, ".md");
    const m = manifest[`${toolchain}/${stem}`] ?? {};
    const models = m.models ?? ["pal"];
    const shots = m.shots ?? Object.fromEntries(models.map((mo) => [mo, `screenshots/${stem}${mo === "pal" ? "" : `-${mo}`}.png`]));
    jobs.push({ rel, toolchain, stem, md, run: { cycles: m.cycles ?? 8000000, models, flags: m.flags ?? [], shots, disk: m.disk } });
  }
}
if (!jobs.length) { console.log(onlyFile ? `no recipe page at ${onlyFile}` : "FAIL no recipe pages found"); process.exit(onlyFile ? 0 : 1); }

function build(job: Job): { prg: string | null; log: string } {
  const all = fences(readFileSync(job.md, "utf8"));
  const prg = join(work, `${job.toolchain}-${job.stem}.prg`);
  if (job.toolchain === "kickassembler") {
    const f = all.find((x) => x.lang === "asm");
    if (!f) return { prg: null, log: "no ```asm listing" };
    if (!tools.kickass || !tools.java) return { prg: null, log: "KickAssembler not found (KICKASS_JAR + java)" };
    const src = join(work, `${job.stem}.asm`);
    writeFileSync(src, f.code);
    const r = spawnSync(tools.java, ["-jar", tools.kickass, src, "-o", prg], { encoding: "utf8" });
    return { prg: r.status === 0 ? prg : null, log: (r.stdout + r.stderr).split("\n").filter((l) => /error/i.test(l)).join("\n") };
  }
  const f = all.find((x) => x.lang === "c" && /\bmain\s*\(/.test(x.code));
  if (!f) return { prg: null, log: "no ```c listing with main()" };
  const src = join(work, `${job.toolchain}-${job.stem}.c`);
  writeFileSync(src, f.code);
  if (job.toolchain === "oscar64") {
    if (!tools.oscar64) return { prg: null, log: "oscar64 not found" };
    const r = spawnSync(tools.oscar64, ["-tm=c64", "-O2", `-o=${prg}`, src], { encoding: "utf8", cwd: work });
    return { prg: r.status === 0 ? prg : null, log: (r.stdout + r.stderr).split("\n").filter((l) => /error/i.test(l)).join("\n") || (r.status === 0 ? "" : `exit ${r.status}`) };
  }
  if (!tools.cl65) return { prg: null, log: "cl65 not found" };
  const r = spawnSync(tools.cl65, ["-t", "c64", "-O", "-o", prg, src], { encoding: "utf8", cwd: work });
  return { prg: r.status === 0 ? prg : null, log: (r.stdout + r.stderr).split("\n").filter((l) => /error/i.test(l)).join("\n") };
}

function runVice(prg: string, png: string, cycles: number, model: string, extra: string[], disk?: { name: string }): string {
  const diskArgs: string[] = [];
  if (disk) {
    if (!tools.c1541) return "runs.json asks for a disk but c1541 is not on PATH";
    const d64 = png.replace(/\.png$/, ".d64");
    const f = spawnSync(tools.c1541, ["-format", disk.name, "d64", d64], { encoding: "utf8" });
    if (!existsSync(d64)) return `c1541 could not format ${d64} (exit ${f.status}): ${(f.stderr || f.stdout).split("\n").slice(-2).join(" | ")}`;
    // VICE 3.10 adds a random-phase RPM wobble to the emulated drive by
    // default, which moves a disk operation by a handful of cycles from run
    // to run; a recipe that prints its elapsed time would then differ by a
    // digit. Pin the drive to a constant speed so the run is repeatable.
    diskArgs.push("-8", d64, "-drive8wobbleamplitude", "0", "-drive8wobblefrequency", "0");
  }
  const args = ["-default", "-warp", "+sound", "+autostart-delay-random", "-autostartprgmode", "1",
    "-limitcycles", String(cycles), ...(MODEL_FLAG[model] ?? []), ...extra, ...diskArgs, "-exitscreenshot", png, "-autostart", prg];
  const r = spawnSync(tools.x64sc!, args, { encoding: "utf8", timeout: 300_000 });
  if (!existsSync(png)) return `x64sc produced no screenshot (exit ${r.status}${r.signal ? ` ${r.signal}` : ""}): ${(r.stderr || r.stdout).split("\n").slice(-3).join(" | ")}`;
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
function compare(fresh: string, baseline: string): { ok: boolean; detail: string } {
  const r = spawnSync(tools.python3!, ["-c", CMP, fresh, baseline], { encoding: "utf8" });
  return { ok: r.status === 0, detail: (r.stdout || r.stderr).trim() };
}

let failures = 0, passes = 0, missing = 0, updated = 0;
const results: string[] = [];
function say(ok: boolean, label: string, detail = "") {
  results.push(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  console.log(results[results.length - 1]);
}

const runOne = (job: Job) => {
  const { prg, log } = build(job);
  if (!prg) { failures++; say(false, `${job.rel} (build)`, log); return; }
  for (const model of job.run.models) {
    const shotRel = job.run.shots[model];
    if (!shotRel) { failures++; say(false, `${job.rel} [${model}]`, "no shot path in runs.json for this model"); continue; }
    const baseline = join(dirname(job.md), shotRel);
    const fresh = join(work, `${job.toolchain}-${job.stem}-${model}.png`);
    const err = runVice(prg, fresh, job.run.cycles, model, job.run.flags, job.run.disk);
    if (err) { failures++; say(false, `${job.rel} [${model}]`, err); continue; }
    if (!existsSync(baseline)) {
      if (update) { mkdirSync(dirname(baseline), { recursive: true }); copyFileSync(fresh, baseline); updated++; say(true, `${job.rel} [${model}]`, `baseline written: ${relative(ROOT, baseline)} (look at it)`); }
      else { missing++; if (!allowMissing) failures++; say(allowMissing, `${job.rel} [${model}]`, `no baseline at ${relative(ROOT, baseline)}; run with --update after looking at ${fresh}`); }
      continue;
    }
    const c = compare(fresh, baseline);
    if (c.ok) { passes++; say(true, `${job.rel} [${model}]`, `identical to ${relative(ROOT, baseline)} at ${job.run.cycles} cycles`); }
    else if (update) { copyFileSync(fresh, baseline); updated++; say(true, `${job.rel} [${model}]`, `baseline REPLACED (${c.detail}); the page must say why`); }
    else { failures++; say(false, `${job.rel} [${model}]`, `${c.detail} vs ${relative(ROOT, baseline)} at ${job.run.cycles} cycles${job.run.models.length > 1 ? ` (${model})` : ""}; if the listing changed on purpose, look at ${fresh} and run --update`); }
  }
};

// Sequential by default: VICE runs are CPU-bound and the ordering keeps the log readable.
// --jobs N runs N in parallel via child processes of this same script on single files.
if (jobsOpt > 1 && !onlyFile) {
  const queue = [...jobs];
  const workers: Promise<void>[] = [];
  const runChild = async () => {
    while (queue.length) {
      const j = queue.shift()!;
      const r = spawnSync(process.execPath, [process.argv[1], "--file", j.rel, ...(update ? ["--update"] : []), ...(allowMissing ? ["--allow-missing"] : []), ...(keepDir ? ["--keep", keepDir] : [])], { encoding: "utf8", env: process.env });
      process.stdout.write(r.stdout.split("\n").filter((l) => /^(ok  |FAIL)/.test(l)).map((l) => l + "\n").join(""));
      if (r.status !== 0) failures++; else passes++;
    }
  };
  for (let i = 0; i < jobsOpt; i++) workers.push(runChild());
  await Promise.all(workers);
} else {
  for (const job of jobs) runOne(job);
}

console.log(`\n${passes} matched, ${failures} failed, ${missing} without baseline, ${updated} baselines written; fresh files in ${work}`);
process.exit(failures ? 1 : 0);
