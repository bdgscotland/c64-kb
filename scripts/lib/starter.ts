/**
 * Making a project from a starter in templates/, shared by new-project (the
 * way an agent starts one) and verify-templates (the gate that proves every
 * starter works when made that way).
 *
 * A project is the starter copied whole, dotfiles included, with
 * templates/_harness vendored into ./harness, a .mcp.json that starts this
 * checkout's MCP server by absolute path, and a local.mk that tells the
 * harness where this checkout and the tools are. Nothing in it points back
 * into templates/.
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

import { describeX64sc, resolveX64sc } from "../../src/services/vice-bin.ts";
import { findC1541, findToolchains } from "./toolchains.ts";

export const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const TEMPLATES = join(ROOT, "templates");
const HARNESS = join(TEMPLATES, "_harness");
const MACHINE_HEADLESS = join(homedir(), "Developer/c64/vice-headless/bin/x64sc");

/** Every templates/<name>/ that declares its expectations (has an expect.json). */
export function starterNames(): string[] {
  return readdirSync(TEMPLATES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .filter((name) => existsSync(join(TEMPLATES, name, "expect.json")))
    .sort();
}

/** The x64sc for headless runs: X64SC_BIN or the repo's build, else this machine's windowless one, else PATH. */
function headlessX64sc(): { path: string | null; banner: string } {
  const choice = resolveX64sc();
  if (choice && choice.kind !== "path") return { path: choice.path, banner: describeX64sc(choice) };
  if (existsSync(MACHINE_HEADLESS)) {
    return {
      path: MACHINE_HEADLESS,
      banner: `x64sc: ${MACHINE_HEADLESS} (windowless build, the harness default)`,
    };
  }
  return { path: choice?.path ?? null, banner: describeX64sc(choice) };
}

/** local.mk: the settings the harness reads before its own defaults. */
function localMk(): { text: string; banner: string } {
  const tools = findToolchains();
  const x64sc = headlessX64sc();
  const lines = [
    "# Written by c64-kb's new-project for this machine. Not committed (.gitignore).",
    `C64KB := ${ROOT}`,
  ];
  if (tools.oscar64) lines.push(`OSCAR64 := ${tools.oscar64}`);
  if (tools.kickass) lines.push(`KICKASS_JAR := ${tools.kickass}`);
  const c1541 = findC1541();
  if (c1541) lines.push(`C1541 := ${c1541}`);
  if (x64sc.path) lines.push(`X64SC := ${x64sc.path}`);
  return { text: `${lines.join("\n")}\n`, banner: x64sc.banner };
}

/** Copies starter `name` to `dest` as a project. Returns a one-line note on the emulator chosen. */
export function makeProject(name: string, dest: string): string {
  const skip = new Set(["build", "shots", "local.mk"]);
  cpSync(join(TEMPLATES, name), dest, { recursive: true, filter: (src) => !skip.has(basename(src)) });
  cpSync(HARNESS, join(dest, "harness"), { recursive: true });
  const cli = join(ROOT, "dist", "cli.js");
  const mcp = { mcpServers: { "c64-kb": { type: "stdio", command: "node", args: [cli, "serve"], env: {} } } };
  writeFileSync(join(dest, ".mcp.json"), `${JSON.stringify(mcp, null, 2)}\n`);
  const mk = localMk();
  writeFileSync(join(dest, "local.mk"), mk.text);
  return mk.banner;
}

/** Runs `make <targets>` in dir: whether it passed, and its output lines. */
export function runMake(dir: string, targets: string[]): { ok: boolean; out: string[] } {
  const r = spawnSync("make", ["--no-print-directory", "-C", dir, ...targets], {
    encoding: "utf8",
    timeout: 900_000,
  });
  const out = `${r.stdout}${r.stderr}`.split("\n").filter((l) => l.trim() !== "");
  return { ok: r.status === 0, out };
}

/** The proof targets a starter declares in VERIFY_TARGETS (`make verify-targets`), in order. */
export function verifyTargets(dir: string): string[] {
  const r = runMake(dir, ["-s", "verify-targets"]);
  return r.ok ? (r.out.at(-1) ?? "").split(/\s+/).filter((t) => t !== "") : [];
}

/** The lines of a make run worth showing: shots, failures, the meter, summaries. */
export function reportLines(out: string[]): string[] {
  return out.filter(
    (l) =>
      /^(FAIL|check:|shot:|selftest:|plan-gate:)/.test(l) ||
      l.includes(" frame meter") ||
      /"\S+"\s+prg/.test(l),
  );
}
