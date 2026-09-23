/**
 * Which x64sc to run.
 *
 * The GTK build of VICE opens a window on every launch and takes the
 * desktop's focus; a verifier pass over sixty recipes makes that constant.
 * VICE 3.10 also builds a headless front end (--enable-headlessui) with no
 * window at all whose exit screenshots are byte-identical to the GTK build's
 * (measured 2026-09-22 on the pinned recipes, PAL and NTSC, disk-backed
 * included). `npm run vice:headless` builds one into .tools/vice-headless/
 * and everything that launches the emulator picks it up from here.
 *
 * Order: X64SC_BIN if set; the repo's own headless build if present; the
 * x64sc on PATH, which is almost certainly the windowed one.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/services or dist/services: the repo root is two levels up either way.
const repoRoot = path.resolve(here, "..", "..");
const HEADLESS_X64SC = path.join(repoRoot, ".tools", "vice-headless", "bin", "x64sc");

export type X64scChoice = { path: string; kind: "env" | "headless" | "path"; windowed: boolean };

export function resolveX64sc(): X64scChoice | null {
  const env = process.env.X64SC_BIN;
  if (env && existsSync(env)) return { path: env, kind: "env", windowed: false };
  if (existsSync(HEADLESS_X64SC)) return { path: HEADLESS_X64SC, kind: "headless", windowed: false };
  try {
    const found = execSync("which x64sc", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (found) return { path: found, kind: "path", windowed: true };
  } catch {
    // no x64sc anywhere
  }
  return null;
}

/** One line for a script's banner, so a windowed run is never a surprise. */
export function describeX64sc(choice: X64scChoice | null): string {
  if (!choice) return "x64sc: not found (set X64SC_BIN or run `npm run vice:headless`)";
  if (choice.kind === "env") return `x64sc: ${choice.path} (X64SC_BIN)`;
  if (choice.kind === "headless") return `x64sc: ${choice.path} (windowless build)`;
  return `x64sc: ${choice.path} (PATH; this build opens a window per run; "npm run vice:headless" builds one that does not)`;
}
