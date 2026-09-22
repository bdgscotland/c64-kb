#!/usr/bin/env tsx
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
 * Toolchains are found through environment variables, then PATH:
 *   KICKASS_JAR   path to KickAss.jar   (needs `java` on PATH)
 *   OSCAR64       path to the oscar64 binary, else `oscar64` on PATH
 *   CL65          path to cl65, else `cl65` on PATH
 *
 * Exit status is non-zero if any listing fails to build, or if a toolchain
 * that some listing needs is missing (pass --allow-missing to downgrade a
 * missing toolchain to a warning; the vitest wrapper does that).
 *
 * This exists because eight recipes shipped without ever having been
 * assembled, and six of them did not.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DOCS = join(ROOT, "docs");
const allowMissing = process.argv.includes("--allow-missing");
// --file <path> (repo-relative or absolute): check only that markdown file.
// Used by the PostToolUse hook after an edit, so one file is checked in a
// second or two instead of the whole tree.
const fileArgIdx = process.argv.findIndex((a) => a === "--file" || a.startsWith("--file="));
const onlyFile = fileArgIdx === -1
  ? null
  : (process.argv[fileArgIdx].includes("=") ? process.argv[fileArgIdx].split("=")[1] : process.argv[fileArgIdx + 1]);
const onlyRel = onlyFile ? relative(ROOT, onlyFile.startsWith("/") ? onlyFile : join(ROOT, onlyFile)) : null;
const inScope = (p: string) => !onlyRel || relative(ROOT, p) === onlyRel;

type Fence = { lang: string; code: string; index: number };

function fences(md: string): Fence[] {
  const out: Fence[] = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(md)) !== null) out.push({ lang: m[1].toLowerCase(), code: m[2], index: i++ });
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

function which(cmd: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const tools = {
  kickass: process.env.KICKASS_JAR && existsSync(process.env.KICKASS_JAR) ? process.env.KICKASS_JAR : null,
  java: which("java"),
  oscar64: process.env.OSCAR64 && existsSync(process.env.OSCAR64) ? process.env.OSCAR64 : which("oscar64"),
  cl65: process.env.CL65 && existsSync(process.env.CL65) ? process.env.CL65 : which("cl65"),
};

const work = mkdtempSync(join(tmpdir(), "c64kb-listings-"));
let failures = 0;
let built = 0;
let skipped = 0;
let recipesSeen = 0;
const missing = new Set<string>();

function report(ok: boolean, label: string, detail = "") {
  if (ok) built++;
  else failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `\n     ${detail.split("\n").join("\n     ")}` : ""}`);
}

function runKick(src: string, out: string): { ok: boolean; log: string } {
  const r = spawnSync(tools.java!, ["-jar", tools.kickass!, src, "-o", out], { encoding: "utf8" });
  const log = (r.stdout + r.stderr).split("\n").filter((l) => /error/i.test(l) || /at line/.test(l)).join("\n");
  return { ok: r.status === 0, log };
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
for (const toolchain of ["kickassembler", "oscar64", "cc65"]) {
  const dir = join(DOCS, "recipes", toolchain);
  if (!existsSync(dir)) continue;
  for (const md of walk(dir).filter(inScope)) {
    const rel = relative(ROOT, md);
    const text = readFileSync(md, "utf8");
    if (!/^---\n(?:[\s\S]*?\n)?recipe:/m.test(text)) continue; // not a recipe page (e.g. screenshots/README.md)
    recipesSeen++;
    const all = fences(text);
    const stem = basename(md, ".md");
    if (toolchain === "kickassembler") {
      const f = all.find((x) => x.lang === "asm");
      if (!f) { report(false, rel, "no ```asm listing"); continue; }
      if (!tools.kickass || !tools.java) { missing.add("KickAssembler (KICKASS_JAR + java)"); skipped++; continue; }
      const src = join(work, `${stem}.asm`);
      writeFileSync(src, f.code);
      const r = runKick(src, join(work, `${stem}.prg`));
      report(r.ok, rel, r.ok ? "" : r.log);
    } else {
      const f = all.find((x) => x.lang === "c" && /\bmain\s*\(/.test(x.code));
      if (!f) { report(false, rel, "no ```c listing with main()"); continue; }
      const src = join(work, `${toolchain}-${stem}.c`);
      writeFileSync(src, f.code);
      if (toolchain === "oscar64") {
        if (!tools.oscar64) { missing.add("oscar64"); skipped++; continue; }
        const r = spawnSync(tools.oscar64, ["-tm=c64", "-O2", `-o=${join(work, `${stem}.prg`)}`, src], { encoding: "utf8", cwd: work });
        const log = (r.stdout + r.stderr).split("\n").filter((l) => /error/i.test(l)).join("\n");
        report(r.status === 0, rel, r.status === 0 ? "" : log || `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}`);
      } else {
        if (!tools.cl65) { missing.add("cl65"); skipped++; continue; }
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
        const r = spawnSync(tools.cl65, ["-t", "c64", "-O", ...cfgArgs, "-o", join(work, `${stem}.prg`), src], { encoding: "utf8", cwd: work });
        const log = (r.stdout + r.stderr).split("\n").filter((l) => /error/i.test(l)).join("\n");
        report(r.status === 0, rel, r.status === 0 ? "" : log);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// KickAssembler fragments outside the recipes
// ---------------------------------------------------------------------------
const MNEMONIC = /^\s*(lda|sta|ldx|stx|ldy|sty|inc|dec|jmp|jsr|sei|cli|nop|bit|cmp|adc|sbc|and|ora|eor|pha|pla|rts|rti)\b/m;
const KICK_MARKS = /^\s*(\/\/|\.const|\.var|\.label|\.macro|\.for|\.pc|\.fill|\.byte|\.word|\.text|\.encoding|BasicUpstart)/m;
const OPERAND = /\b(?:jmp|jsr|bne|beq|bcc|bcs|bpl|bmi|bvc|bvs|lda|sta|ldx|ldy|stx|sty|inc|dec|cmp|cpx|cpy|adc|sbc|and|ora|eor|bit|asl|lsr|rol|ror|lax|sax|dcp|isc|isb|slo|rla|sre|rra|alr|arr|anc|axs|sbx)\s+#?[<>]?\(?([A-Za-z_]\w*)\b/g;
// Identifiers passed to a macro call, e.g. LAX_ZPY(sprite_y).
const MACRO_ARGS = /\b[A-Za-z_]\w*\(([^)]*)\)/g;

if (tools.kickass && tools.java) {
  for (const md of walk(DOCS).filter(inScope)) {
    if (md.includes(`${join("docs", "recipes")}/`)) continue;
    const rel = relative(ROOT, md);
    for (const f of fences(readFileSync(md, "utf8"))) {
      const isKick = f.lang === "kickassembler" || f.lang === "kickass" || f.lang === "kick" || (f.lang === "asm" && KICK_MARKS.test(f.code) && !/^\s*;/m.test(f.code));
      if (!isKick || !MNEMONIC.test(f.code)) continue;
      if (/\.import\s+(source|binary|c64|text)/.test(f.code) || /LoadSid|LoadBinary|LoadPicture/.test(f.code)) continue; // needs files
      const defined = new Set<string>();
      for (const m of f.code.matchAll(/^\s*([A-Za-z_]\w*):/gm)) defined.add(m[1]);
      for (const m of f.code.matchAll(/\.(?:const|var|label)\s+([A-Za-z_]\w*)/g)) defined.add(m[1]);
      for (const m of f.code.matchAll(/^([A-Za-z_]\w*)\s*=/gm)) defined.add(m[1]);
      for (const m of f.code.matchAll(/\.macro\s+([A-Za-z_]\w*)/g)) defined.add(m[1]);
      // Undefined names become stubs. Branch targets have to be within range,
      // so they are emitted as real labels after the fragment (error handlers
      // are almost always forward); everything else is a far constant.
      const stubs = new Set<string>();
      const branchTargets = new Set<string>();
      for (const m of f.code.matchAll(OPERAND)) {
        const name = m[1];
        if (defined.has(name) || /^[axy]$/i.test(name)) continue;
        stubs.add(name);
        if (/^\s*b(ne|eq|cc|cs|pl|mi|vc|vs)\b/i.test(m[0])) branchTargets.add(name);
      }
      for (const m of f.code.matchAll(MACRO_ARGS)) {
        for (const tok of m[1].split(",")) {
          const name = tok.trim().match(/^[<>]?([A-Za-z_]\w*)$/)?.[1];
          if (name && !defined.has(name) && !/^[axy]$/i.test(name)) stubs.add(name);
        }
      }
      // Names in .word / .byte tables (vector tables of handlers a fragment does not define).
      for (const m of f.code.matchAll(/^\s*\.(?:word|byte)\s+([^/\n]+)/gm)) {
        for (const tok of m[1].split(",")) {
          const name = tok.trim().match(/^[<>]?([A-Za-z_]\w*)$/)?.[1];
          if (name && !defined.has(name)) stubs.add(name);
        }
      }
      const prelude = "* = $1000\n" + [...stubs].filter((s) => !branchTargets.has(s)).map((s) => `.label ${s} = $c000\n`).join("");
      const trailer = "\n" + [...branchTargets].map((s) => `${s}: rts\n`).join("");
      const src = join(work, `${basename(md, ".md")}-${f.index}.asm`);
      writeFileSync(src, prelude + f.code + trailer);
      const r = runKick(src, join(work, `${basename(md, ".md")}-${f.index}.prg`));
      report(r.ok, `${rel} #${f.index} (fragment, ${stubs.size} stubbed labels)`, r.ok ? "" : r.log);
    }
  }
} else {
  missing.add("KickAssembler (KICKASS_JAR + java)");
}

if (recipesSeen === 0 && !onlyRel) {
  console.log("FAIL no recipe pages found under docs/recipes (frontmatter filter broken?)");
  failures++;
}

// ---------------------------------------------------------------------------
console.log(`\n${built} built, ${recipesSeen} recipe pages seen, ${failures} failed, ${skipped} recipes skipped for missing tools`);
if (missing.size) {
  console.log(`${allowMissing ? "warning" : "error"}: toolchains not found: ${[...missing].join(", ")}`);
  if (!allowMissing) failures++;
}
process.exit(failures ? 1 : 0);
