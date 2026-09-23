#!/usr/bin/env node
/**
 * verify-templates — make a project from every starter, outside the repo,
 * the way `npm run new-project` makes one, and run its harness loop there:
 * `make` (the plan-gated build), `make shot check` (headless PAL and NTSC
 * exit screenshots of the autopilot build, graded by the starter's
 * expect.json) and `make disk`.
 *
 * A starter is a directory under templates/ with an expect.json. The copy
 * (scripts/lib/starter.ts) vendors templates/_harness into ./harness and
 * writes local.mk with this checkout as C64KB and the tools this repo
 * resolves, so nothing in it reaches back into templates/.
 *
 * Usage:
 *   node scripts/verify-templates.ts                  # every starter; exit 1 on any failure
 *   node scripts/verify-templates.ts --only hello     # one starter
 *   node scripts/verify-templates.ts --selftest       # also `make selftest` (the FORCE_FAULT build must fail)
 *                                                     # and every target the starter lists in VERIFY_TARGETS
 *   node scripts/verify-templates.ts --keep DIR       # build in DIR and keep it (shots, PRGs, logs)
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { makeProject, reportLines, runMake, starterNames, verifyTargets } from "./lib/starter.ts";

const argv = process.argv.slice(2);

/** The value after `name`, null when the flag is absent; exits when the value is missing. */
function opt(name: string): string | null {
  const i = argv.indexOf(name);
  if (i === -1) return null;
  const v = argv.at(i + 1);
  if (v === undefined || v.startsWith("--")) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return v;
}
const only = opt("--only");
const keepDir = opt("--keep");
const selftest = argv.includes("--selftest");

type Result = { name: string; ok: boolean; lines: string[] };

function verify(name: string, base: string): Result {
  const dir = join(base, name);
  rmSync(dir, { recursive: true, force: true });
  const banner = makeProject(name, dir);
  const lines = [banner];
  // A starter's own proof targets (disktest, tearcheck, probe...) prove fixes
  // that make check cannot see; --selftest runs them too.
  const own = selftest ? verifyTargets(dir).map((t) => [t]) : [];
  const steps = [["all"], ["shot", "check"], ["disk"], ...(selftest ? [["selftest"], ...own] : [])];
  for (const targets of steps) {
    const r = runMake(dir, targets);
    lines.push(
      `make ${targets.join(" ")}: ${r.ok ? "ok" : "FAILED"}`,
      ...reportLines(r.out).map((l) => `  ${l}`),
    );
    if (!r.ok) {
      lines.push(...r.out.slice(-12).map((l) => `  | ${l}`));
      return { name, ok: false, lines };
    }
  }
  return { name, ok: true, lines };
}

function main(): number {
  const names = starterNames().filter((n) => only === null || n === only);
  if (names.length === 0) {
    console.error(
      only ? `no starter named ${only} with an expect.json under templates/` : "no starters found",
    );
    return 2;
  }
  const base = keepDir ?? mkdtempSync(join(tmpdir(), "c64kb-templates-"));
  mkdirSync(base, { recursive: true });
  const results = names.map((name) => {
    console.log(`\n== ${name} (made in ${join(base, name)})`);
    const r = verify(name, base);
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
