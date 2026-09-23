#!/usr/bin/env node
/**
 * new-project — start a C64 program from a starter in templates/.
 *
 *   npm run new-project -- <starter> <dir>        e.g. npm run new-project -- hello ~/c64/mygame
 *   npm run new-project -- --list
 *
 * Copies templates/<starter>/ whole (dotfiles included: .claude/, .gitignore)
 * to <dir>, vendors templates/_harness into <dir>/harness, writes .mcp.json
 * with the absolute path of this checkout's dist/cli.js, and writes local.mk
 * (read by the harness) with C64KB set to this checkout and the tool paths
 * this machine has. Then it runs `make shot check` in <dir> as the proof that
 * the new project builds, runs on PAL and NTSC and passes its checks, and
 * swaps the starter's PLAN.md for a blank one (kept as
 * PLAN-<starter>-example.md): the new program needs its own plan.
 *
 * <dir> must not exist, or must be empty. Exit 0 when the proof passes, 1
 * when it fails (the project is left in place to inspect), 2 on a usage
 * error.
 */
import { copyFileSync, existsSync, readdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

import { ROOT, makeProject, reportLines, runMake, starterNames } from "./lib/starter.ts";

function usage(msg?: string): number {
  if (msg) console.error(`new-project: ${msg}`);
  console.error(
    "usage: npm run new-project -- <starter> <dir>   (starters: " + starterNames().join(", ") + ")",
  );
  return 2;
}

function main(): number {
  const args = process.argv.slice(2);
  if (args[0] === "--list") {
    console.log(starterNames().join("\n"));
    return 0;
  }
  const [starter, target] = args;
  if (!starter || !target) return usage();
  if (!starterNames().includes(starter)) return usage(`no starter named ${starter}`);
  const dir = resolve(target);
  if (existsSync(dir) && readdirSync(dir).length > 0) return usage(`${dir} exists and is not empty`);
  const banner = makeProject(starter, dir);
  console.log(`new-project: ${starter} -> ${dir}`);
  console.log(`  harness vendored into ${join(dir, "harness")}`);
  console.log(`  local.mk: C64KB = ${ROOT}; ${banner}`);
  if (!existsSync(join(ROOT, "dist", "cli.js"))) {
    console.log(
      `  .mcp.json points at ${join(ROOT, "dist", "cli.js")}, which does not exist yet: run npm run build here`,
    );
  }
  console.log("new-project: proving it with make shot check ...");
  const r = runMake(dir, ["shot", "check"]);
  for (const l of reportLines(r.out)) console.log(`  ${l}`);
  if (!r.ok) {
    for (const l of r.out.slice(-12)) console.log(`  | ${l}`);
    console.log(`new-project: FAILED; the project is left in ${dir}`);
    return 1;
  }
  // The starter's plan was for the starter. The new program gets a blank one,
  // so the plan gate holds src/ and the build until its own plan is filled.
  renameSync(join(dir, "PLAN.md"), join(dir, `PLAN-${starter}-example.md`));
  copyFileSync(join(dir, "harness", "PLAN.md.template"), join(dir, "PLAN.md"));
  console.log(`new-project: ready. The starter's plan is now PLAN-${starter}-example.md; PLAN.md is blank.`);
  console.log(`  cd ${dir}, read CLAUDE.md, and fill PLAN.md: make and writes under src/ wait for it.`);
  return 0;
}

process.exit(main());
