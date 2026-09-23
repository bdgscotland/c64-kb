#!/usr/bin/env node
/**
 * verify-templates — copy every starter out of the repo and run its harness
 * loop there: `make shot check` (build, headless PAL and NTSC exit
 * screenshots of the autopilot build, graded by the starter's expect.json).
 *
 * A starter is a directory under templates/ with an expect.json. It is
 * copied to a temporary directory with templates/_harness vendored into
 * ./harness beside it, which is how a downstream project uses it: nothing
 * in the copy can reach back into the repo except C64KB, which points at
 * this checkout for `make claims`.
 *
 * Usage:
 *   node scripts/verify-templates.ts                  # every starter; exit 1 on any failure
 *   node scripts/verify-templates.ts --only hello     # one starter
 *   node scripts/verify-templates.ts --selftest       # also `make selftest`: the FORCE_FAULT build must fail
 *   node scripts/verify-templates.ts --keep DIR       # build in DIR and keep it (shots, PRGs, logs)
 *
 * Tools are found as verify-recipes finds them: toolchains through
 * scripts/lib/toolchains.ts, x64sc through src/services/vice-bin.ts, and
 * handed to make as OSCAR64, KICKASS_JAR, C1541 and X64SC. The harness
 * itself falls back to the same default locations.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";

import { describeX64sc, resolveX64sc } from "../src/services/vice-bin.ts";
import { findC1541, findToolchains } from "./lib/toolchains.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const TEMPLATES = join(ROOT, "templates");
const HARNESS = join(TEMPLATES, "_harness");
const MACHINE_HEADLESS = join(homedir(), "Developer/c64/vice-headless/bin/x64sc");
const argv = process.argv.slice(2);
const opt = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv.at(i + 1) ?? null);
};
const only = opt("--only");
const keepDir = opt("--keep");
const selftest = argv.includes("--selftest");

/** Every templates/<name>/ that declares its expectations. */
function starters(): string[] {
  return readdirSync(TEMPLATES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .filter((name) => existsSync(join(TEMPLATES, name, "expect.json")))
    .filter((name) => only === null || name === only)
    .sort();
}

/** The environment make runs in: the tools this repo resolved, and C64KB. */
function makeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, C64KB: ROOT };
  const tools = findToolchains();
  if (tools.oscar64) env.OSCAR64 = tools.oscar64;
  if (tools.kickass) env.KICKASS_JAR = tools.kickass;
  const c1541 = findC1541();
  if (c1541) env.C1541 = c1541;
  const x64sc = resolveX64sc();
  if (x64sc && x64sc.kind !== "path") {
    env.X64SC = x64sc.path;
    console.log(describeX64sc(x64sc));
  } else if (existsSync(MACHINE_HEADLESS)) {
    // The harness's own default: the windowless build this machine keeps.
    env.X64SC = MACHINE_HEADLESS;
    console.log(`x64sc: ${MACHINE_HEADLESS} (windowless build, the harness default)`);
  } else {
    console.log(describeX64sc(x64sc));
  }
  return env;
}

/** A copy of the starter with the harness vendored into ./harness. */
function copyOut(name: string, base: string): string {
  const dest = join(base, name);
  rmSync(dest, { recursive: true, force: true });
  const skip = new Set(["build", "shots"]);
  cpSync(join(TEMPLATES, name), dest, { recursive: true, filter: (src) => !skip.has(basename(src)) });
  cpSync(HARNESS, join(dest, "harness"), { recursive: true });
  return dest;
}

type Result = { name: string; ok: boolean; lines: string[] };

/** Runs `make <targets>` in dir; the lines worth reporting, and whether it passed. */
function runMake(dir: string, targets: string[], env: NodeJS.ProcessEnv): { ok: boolean; out: string[] } {
  const r = spawnSync("make", ["--no-print-directory", "-C", dir, ...targets], {
    env,
    encoding: "utf8",
    timeout: 900_000,
  });
  const out = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.trim() !== "");
  return { ok: r.status === 0, out };
}

function verify(name: string, base: string, env: NodeJS.ProcessEnv): Result {
  const dir = copyOut(name, base);
  const main = runMake(dir, ["shot", "check"], env);
  const graded = main.out.filter((l) => /^(FAIL|check:|shot:)/.test(l) || l.includes(" frame meter: "));
  const lines = main.ok ? graded : [...graded, ...main.out.slice(-15)];
  let ok = main.ok;
  if (ok && selftest) {
    const st = runMake(dir, ["selftest"], env);
    lines.push(...st.out.filter((l) => l.startsWith("selftest:")));
    ok = st.ok;
  }
  return { name, ok, lines: [...new Set(lines)] };
}

function main(): number {
  const names = starters();
  if (names.length === 0) {
    console.error(
      only ? `no starter named ${only} with an expect.json under templates/` : "no starters found",
    );
    return 2;
  }
  const env = makeEnv();
  const base = keepDir ?? mkdtempSync(join(tmpdir(), "c64kb-templates-"));
  mkdirSync(base, { recursive: true });
  const results = names.map((name) => {
    console.log(`\n== ${name} (copied to ${join(base, name)})`);
    const r = verify(name, base, env);
    for (const l of r.lines) console.log(`   ${l}`);
    console.log(`${r.ok ? "PASS" : "FAIL"} ${name}`);
    return r;
  });
  if (!keepDir) rmSync(base, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(
    `\nverify-templates: ${results.length - failed.length} of ${results.length} starters passed` +
      (failed.length ? `; failed: ${failed.join(", ")}` : ""),
  );
  return failed.length ? 1 : 0;
}

process.exit(main());
