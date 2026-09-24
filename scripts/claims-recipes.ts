#!/usr/bin/env node
/**
 * claims-recipes: build every KickAssembler recipe and run claims-watch on
 * it with the page's own declarations (#84). A recipe passes when every
 * store its program made was declared: by its techniques' Claims lines, by
 * its frontmatter `claims:`, `ram:` and `harness:` keys, or by the KERNAL
 * routines it names in `uses_kernal:`.
 *
 * Each run uses the recipe's runs.json entry: its cycles, its `flags`
 * (controller ports, an REU, a key buffer) and its `disk` (a fresh D64
 * formatted with c1541). PAL only. A recipe runs.json marks `skip` or runs
 * from a cartridge is listed as not run.
 *
 * Usage:
 *   node scripts/claims-recipes.ts                   # every KickAssembler recipe; exit 1 on any violation
 *   node scripts/claims-recipes.ts --file docs/recipes/kickassembler/fld.md
 *   node scripts/claims-recipes.ts --jobs 6          # six at once (default 4)
 *   node scripts/claims-recipes.ts --verbose         # print each failing recipe's full report
 *   node scripts/claims-recipes.ts --report DIR      # write each recipe's report (<stem>.txt, <stem>.json) under DIR
 *
 * Needs KickAssembler (KICKASS_JAR + java), x64sc (a windowless one:
 * X64SC_BIN or `npm run vice:headless`) and c1541 for the disk recipes; exit
 * 2 when one is missing.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { errorLines, fences, isRecipePage, walk } from "./lib/markdown.ts";
import { findC1541, findToolchains } from "./lib/toolchains.ts";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "docs", "recipes", "kickassembler");
const WATCH = join(ROOT, "scripts", "claims-watch.ts");

const { values: opt } = parseArgs({
  options: {
    file: { type: "string" },
    jobs: { type: "string", default: "4" },
    verbose: { type: "boolean", default: false },
    report: { type: "string" },
  },
});

const EntrySchema = z.object({
  cycles: z.number().optional(),
  flags: z.array(z.string()).optional(),
  disk: z.object({ name: z.string() }).optional(),
  cartridge: z.object({ file: z.string() }).loose().optional(),
  skip: z.string().optional(),
});
type Entry = z.infer<typeof EntrySchema>;
const manifest = z
  .record(z.string(), z.unknown())
  .parse(JSON.parse(readFileSync(join(ROOT, "docs", "recipes", "runs.json"), "utf8")));
const entryFor = (stem: string): Entry => {
  const e = manifest[`kickassembler/${stem}`];
  return typeof e === "object" && e !== null ? EntrySchema.parse(e) : {};
};

const tools = { ...findToolchains(), c1541: findC1541() };
if (!tools.kickass || !tools.java) {
  console.error("claims-recipes: KickAssembler not found (KICKASS_JAR + java)");
  process.exit(2);
}
if (!resolveX64sc()) {
  console.error("claims-recipes: x64sc not found (X64SC_BIN or `npm run vice:headless`)");
  process.exit(2);
}

interface Outcome {
  rel: string;
  verdict: "pass" | "fail" | "not run";
  detail: string;
}

/** Why a recipe cannot run under claims-watch, or null. */
function notRunnable(e: Entry): string | null {
  if (e.skip !== undefined) return `runs.json skip: ${e.skip.split(";")[0] ?? ""}`;
  if (e.cartridge !== undefined) return "boots from a cartridge; claims-watch autostarts a PRG";
  return null;
}

/** Assemble the page's first asm fence to `<work>/<stem>.prg` with a .sym beside it. */
function assemble(md: string, work: string, stem: string): string | { error: string } {
  const f = fences(readFileSync(md, "utf8")).find((x) => x.lang === "asm");
  if (!f) return { error: "no ```asm listing" };
  const src = join(work, `${stem}.asm`);
  writeFileSync(src, f.code);
  const prg = join(work, `${stem}.prg`);
  const r = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", src, "-o", prg, "-symbolfile"], {
    encoding: "utf8",
    cwd: work,
  });
  return r.status === 0 ? prg : { error: `build failed: ${errorLines(r.stdout + r.stderr)}` };
}

function formatDisk(work: string, name: string): string | { error: string } {
  if (!tools.c1541) return { error: "c1541 not found" };
  const d64 = join(work, "disk.d64");
  const r = spawnSync(tools.c1541, ["-format", name, "d64", d64], { encoding: "utf8" });
  return r.status === 0 && existsSync(d64) ? d64 : { error: `c1541 -format failed: ${r.stderr}` };
}

function watch(args: string[]): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WATCH, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (b: Buffer) => (out += b.toString()));
    child.stderr.on("data", (b: Buffer) => (out += b.toString()));
    child.on("error", reject);
    child.on("close", (status) => {
      resolve({ status, out });
    });
  });
}

async function runRecipe(md: string): Promise<Outcome> {
  const rel = relative(ROOT, md);
  const stem = basename(md, ".md");
  const e = entryFor(stem);
  const why = notRunnable(e);
  if (why) return { rel, verdict: "not run", detail: why };
  const work = mkdtempSync(join(tmpdir(), "claims-recipes-"));
  try {
    const prg = assemble(md, work, stem);
    if (typeof prg !== "string") return { rel, verdict: "fail", detail: prg.error };
    const disk = e.disk ? formatDisk(work, e.disk.name) : undefined;
    if (disk !== undefined && typeof disk !== "string") return { rel, verdict: "fail", detail: disk.error };
    const args = [prg, "--recipe", md, "--cycles", String(e.cycles ?? 8000000)];
    if (disk) args.push("--disk", disk);
    for (const f of e.flags ?? []) args.push(`--vice-arg=${f}`);
    if (opt.report) args.push("--json", join(opt.report, `${stem}.json`));
    const r = await watch(args);
    if (opt.report) writeFileSync(join(opt.report, `${stem}.txt`), r.out);
    const last = r.out.trim().split("\n").at(-1) ?? "";
    if (r.status === 0) return { rel, verdict: "pass", detail: last };
    return { rel, verdict: "fail", detail: opt.verbose ? r.out : last };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (opt.report) mkdirSync(opt.report, { recursive: true });
const pages = (opt.file ? [join(ROOT, opt.file)] : walk(DIR))
  .filter((md) => isRecipePage(readFileSync(md, "utf8")))
  .sort();
const queue = [...pages];
const outcomes: Outcome[] = [];
const worker = async (): Promise<void> => {
  for (let md = queue.shift(); md; md = queue.shift()) {
    const o = await runRecipe(md);
    outcomes.push(o);
    console.log(
      `${o.verdict === "pass" ? "ok  " : o.verdict === "fail" ? "FAIL" : "skip"} ${o.rel}  ${o.detail}`,
    );
  }
};
await Promise.all(Array.from({ length: Math.max(1, Number(opt.jobs)) }, worker));

const count = (v: Outcome["verdict"]) => outcomes.filter((o) => o.verdict === v).length;
console.log(`\n${count("pass")} passed, ${count("fail")} failed, ${count("not run")} not run`);
process.exit(count("fail") ? 1 : 0);
