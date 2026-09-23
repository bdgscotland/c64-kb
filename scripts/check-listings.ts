#!/usr/bin/env node
/**
 * check-listings — build every code listing in the knowledge base with the
 * real toolchain it claims to be for.
 *
 * Recipes (docs/recipes/<toolchain>/*.md) must build cleanly: the first
 * fenced `asm` block of a KickAssembler recipe goes through KickAss.jar,
 * the first `c` block of an Oscar64 or cc65 recipe through oscar64 / cl65.
 * Fragments elsewhere in docs/ that are tagged `kickassembler`, or tagged
 * `asm` and written in KickAssembler syntax, are assembled with a prelude
 * that defines a program counter and stubs their undefined labels; they may
 * be incomplete, but they may not be syntactically wrong for the assembler
 * they claim.
 *
 * Toolchains are found through environment variables, then PATH, then the
 * default install location (scripts/lib/toolchains.ts):
 *   KICKASS_JAR   path to KickAss.jar   (needs `java` on PATH;
 *                 default ~/Developer/c64/kickassembler/KickAss.jar)
 *   OSCAR64       path to the oscar64 binary, else `oscar64` on PATH
 *                 (default ~/Developer/c64/oscar64/bin/oscar64)
 *   CL65          path to cl65, else `cl65` on PATH
 *
 * Exit status is non-zero if any listing fails to build, or if a toolchain
 * that some listing needs is missing (pass --allow-missing to downgrade a
 * missing toolchain to a warning; the vitest wrapper does that).
 *
 * This exists because eight recipes shipped without ever having been
 * assembled, and six of them did not.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import {
  RECIPE_TOOLCHAINS,
  cListing,
  errorLines,
  fences,
  group,
  isRecipePage,
  walk,
  type Fence,
} from "./lib/markdown.ts";
import { findToolchains } from "./lib/toolchains.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const DOCS = join(ROOT, "docs");
const allowMissing = process.argv.includes("--allow-missing");

/** --file <path> or --file=<path> (repo-relative or absolute), or null. */
function fileArg(argv: string[]): string | null {
  const i = argv.findIndex((a) => a === "--file" || a.startsWith("--file="));
  if (i === -1) return null;
  const a = argv.at(i) ?? "";
  return (a.includes("=") ? a.split("=")[1] : argv.at(i + 1)) ?? null;
}

// --file <path>: check only that markdown file. Used by the PostToolUse hook
// after an edit, so one file is checked in a second or two instead of the
// whole tree.
const onlyFile = fileArg(process.argv);
const onlyRel = onlyFile ? relative(ROOT, onlyFile.startsWith("/") ? onlyFile : join(ROOT, onlyFile)) : null;
const inScope = (p: string) => !onlyRel || relative(ROOT, p) === onlyRel;

const tools = findToolchains();
const KICKASS_MISSING = "KickAssembler (KICKASS_JAR + java)";

const work = mkdtempSync(join(tmpdir(), "c64kb-listings-"));
let failures = 0;
let built = 0;
let skipped = 0;
let recipesSeen = 0;
const missing = new Set<string>();

function report(ok: boolean, label: string, detail = "") {
  if (ok) built++;
  else failures++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label}${detail ? `\n     ${detail.split("\n").join("\n     ")}` : ""}`,
  );
}

function skip(tool: string): void {
  missing.add(tool);
  skipped++;
}

function runKick(
  kick: { java: string; jar: string },
  src: string,
  out: string,
): { ok: boolean; log: string } {
  const r = spawnSync(kick.java, ["-jar", kick.jar, src, "-o", out], { encoding: "utf8" });
  const log = (r.stdout + r.stderr)
    .split("\n")
    .filter((l) => /error/i.test(l) || l.includes("at line"))
    .join("\n");
  return { ok: r.status === 0, log };
}

/** KickAssembler, when both the jar and java were found. */
function kickAssembler(): { java: string; jar: string } | null {
  return tools.kickass && tools.java ? { java: tools.java, jar: tools.kickass } : null;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

function checkKickRecipe(rel: string, stem: string, all: Fence[]): void {
  const f = all.find((x) => x.lang === "asm");
  if (!f) {
    report(false, rel, "no ```asm listing");
    return;
  }
  const kick = kickAssembler();
  if (!kick) {
    skip(KICKASS_MISSING);
    return;
  }
  const src = join(work, `${stem}.asm`);
  writeFileSync(src, f.code);
  const r = runKick(kick, src, join(work, `${stem}.prg`));
  report(r.ok, rel, r.ok ? "" : r.log);
}

function checkOscarRecipe(rel: string, stem: string, src: string): void {
  if (!tools.oscar64) {
    skip("oscar64");
    return;
  }
  const r = spawnSync(tools.oscar64, ["-tm=c64", "-O2", `-o=${join(work, `${stem}.prg`)}`, src], {
    encoding: "utf8",
    cwd: work,
  });
  const log = errorLines(r.stdout + r.stderr);
  report(
    r.status === 0,
    rel,
    r.status === 0 ? "" : log || `exit ${String(r.status)}${r.signal ? ` (${r.signal})` : ""}`,
  );
}

function checkCc65Recipe(rel: string, stem: string, src: string, all: Fence[]): void {
  if (!tools.cl65) {
    skip("cl65");
    return;
  }
  // A cc65 recipe may carry its linker configuration in a ```cfg fence;
  // it is written beside the source and passed with -C, as the page's
  // own build line does. Without the fence the stock c64.cfg applies.
  const cfgFence = all.find((x) => x.lang === "cfg");
  const cfgArgs: string[] = [];
  if (cfgFence) {
    const cfg = join(work, `${stem}.cfg`);
    writeFileSync(cfg, cfgFence.code);
    cfgArgs.push("-C", cfg);
  }
  const r = spawnSync(tools.cl65, ["-t", "c64", "-O", ...cfgArgs, "-o", join(work, `${stem}.prg`), src], {
    encoding: "utf8",
    cwd: work,
  });
  report(r.status === 0, rel, r.status === 0 ? "" : errorLines(r.stdout + r.stderr));
}

function checkRecipe(toolchain: (typeof RECIPE_TOOLCHAINS)[number], md: string): void {
  const rel = relative(ROOT, md);
  const text = readFileSync(md, "utf8");
  if (!isRecipePage(text)) return; // not a recipe page (e.g. screenshots/README.md)
  recipesSeen++;
  const all = fences(text);
  const stem = basename(md, ".md");
  if (toolchain === "kickassembler") {
    checkKickRecipe(rel, stem, all);
    return;
  }
  const f = cListing(all);
  if (!f) {
    report(false, rel, "no ```c listing with main()");
    return;
  }
  const src = join(work, `${toolchain}-${stem}.c`);
  writeFileSync(src, f.code);
  if (toolchain === "oscar64") checkOscarRecipe(rel, stem, src);
  else checkCc65Recipe(rel, stem, src, all);
}

for (const toolchain of RECIPE_TOOLCHAINS) {
  const dir = join(DOCS, "recipes", toolchain);
  if (!existsSync(dir)) continue;
  for (const md of walk(dir).filter(inScope)) checkRecipe(toolchain, md);
}

// ---------------------------------------------------------------------------
// KickAssembler fragments outside the recipes
// ---------------------------------------------------------------------------
const MNEMONIC =
  /^\s*(lda|sta|ldx|stx|ldy|sty|inc|dec|jmp|jsr|sei|cli|nop|bit|cmp|adc|sbc|and|ora|eor|pha|pla|rts|rti)\b/m;
const KICK_MARKS =
  /^\s*(\/\/|\.const|\.var|\.label|\.macro|\.for|\.pc|\.fill|\.byte|\.word|\.text|\.encoding|BasicUpstart)/m;
const OPERAND =
  /\b(?:jmp|jsr|bne|beq|bcc|bcs|bpl|bmi|bvc|bvs|lda|sta|ldx|ldy|stx|sty|inc|dec|cmp|cpx|cpy|adc|sbc|and|ora|eor|bit|asl|lsr|rol|ror|lax|sax|dcp|isc|isb|slo|rla|sre|rra|alr|arr|anc|axs|sbx)\s+#?[<>]?\(?([A-Za-z_]\w*)\b/g;
// Identifiers passed to a macro call, e.g. LAX_ZPY(sprite_y).
const MACRO_ARGS = /\b[A-Za-z_]\w*\(([^)]*)\)/g;

function isKickFragment(f: Fence): boolean {
  const isKick =
    f.lang === "kickassembler" ||
    f.lang === "kickass" ||
    f.lang === "kick" ||
    (f.lang === "asm" && KICK_MARKS.test(f.code) && !/^\s*;/m.test(f.code));
  if (!isKick || !MNEMONIC.test(f.code)) return false;
  // A fragment that imports files cannot be assembled on its own.
  return !(
    /\.import\s+(source|binary|c64|text)/.test(f.code) || /LoadSid|LoadBinary|LoadPicture/.test(f.code)
  );
}

/** Every name the fragment defines: labels, .const/.var/.label, assignments, macros. */
function definedNames(code: string): Set<string> {
  const defined = new Set<string>();
  for (const m of code.matchAll(/^\s*([A-Za-z_]\w*):/gm)) defined.add(group(m, 1));
  for (const m of code.matchAll(/\.(?:const|var|label)\s+([A-Za-z_]\w*)/g)) defined.add(group(m, 1));
  for (const m of code.matchAll(/^([A-Za-z_]\w*)\s*=/gm)) defined.add(group(m, 1));
  for (const m of code.matchAll(/\.macro\s+([A-Za-z_]\w*)/g)) defined.add(group(m, 1));
  return defined;
}

/** The bare identifiers in a comma-separated list, each optionally prefixed with < or >. */
function listedNames(list: string): string[] {
  return list
    .split(",")
    .map((tok) => group(/^[<>]?([A-Za-z_]\w*)$/.exec(tok.trim()) ?? [], 1))
    .filter((name) => name !== "");
}

/** Undefined names passed to macro calls or listed in .word / .byte tables. */
function listedStubs(code: string, defined: Set<string>): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(MACRO_ARGS)) {
    out.push(...listedNames(group(m, 1)).filter((name) => !defined.has(name) && !/^[axy]$/i.test(name)));
  }
  // Names in .word / .byte tables (vector tables of handlers a fragment does not define).
  for (const m of code.matchAll(/^\s*\.(?:word|byte)\s+([^/\n]+)/gm)) {
    out.push(...listedNames(group(m, 1)).filter((name) => !defined.has(name)));
  }
  return out;
}

/**
 * Undefined names become stubs. Branch targets have to be within range, so
 * they are emitted as real labels after the fragment (error handlers are
 * almost always forward); everything else is a far constant.
 */
function stubsFor(code: string): { stubs: Set<string>; branchTargets: Set<string> } {
  const defined = definedNames(code);
  const stubs = new Set<string>();
  const branchTargets = new Set<string>();
  for (const m of code.matchAll(OPERAND)) {
    const name = group(m, 1);
    if (defined.has(name) || /^[axy]$/i.test(name)) continue;
    stubs.add(name);
    if (/^\s*b(ne|eq|cc|cs|pl|mi|vc|vs)\b/i.test(m[0])) branchTargets.add(name);
  }
  for (const name of listedStubs(code, defined)) stubs.add(name);
  return { stubs, branchTargets };
}

function checkFragment(kick: { java: string; jar: string }, md: string, f: Fence): void {
  const { stubs, branchTargets } = stubsFor(f.code);
  const prelude =
    "* = $1000\n" +
    [...stubs]
      .filter((s) => !branchTargets.has(s))
      .map((s) => `.label ${s} = $c000\n`)
      .join("");
  const trailer = "\n" + [...branchTargets].map((s) => `${s}: rts\n`).join("");
  const src = join(work, `${basename(md, ".md")}-${f.index}.asm`);
  writeFileSync(src, prelude + f.code + trailer);
  const r = runKick(kick, src, join(work, `${basename(md, ".md")}-${f.index}.prg`));
  report(
    r.ok,
    `${relative(ROOT, md)} #${f.index} (fragment, ${stubs.size} stubbed labels)`,
    r.ok ? "" : r.log,
  );
}

const kick = kickAssembler();
if (kick) {
  for (const md of walk(DOCS).filter(inScope)) {
    if (md.includes(`${join("docs", "recipes")}/`)) continue;
    for (const f of fences(readFileSync(md, "utf8"))) if (isKickFragment(f)) checkFragment(kick, md, f);
  }
} else {
  missing.add(KICKASS_MISSING);
}

if (recipesSeen === 0 && !onlyRel) {
  console.log("FAIL no recipe pages found under docs/recipes (frontmatter filter broken?)");
  failures++;
}

// ---------------------------------------------------------------------------
console.log(
  `\n${built} built, ${recipesSeen} recipe pages seen, ${failures} failed, ${skipped} recipes skipped for missing tools`,
);
if (missing.size) {
  console.log(`${allowMissing ? "warning" : "error"}: toolchains not found: ${[...missing].join(", ")}`);
  if (!allowMissing) failures++;
}
process.exit(failures ? 1 : 0);
