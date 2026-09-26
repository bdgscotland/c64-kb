/**
 * Which c1541 to run: C1541, then PATH, then the c1541 `npm run
 * vice:headless` installs beside its x64sc (same order as
 * scripts/lib/toolchains.ts's findC1541, which now re-exports this). Moved
 * here so src/re/image.ts can resolve a D64 file without src/ importing
 * scripts/ (src/ must not import scripts/).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/services or dist/services: the repo root is two levels up either way.
const repoRoot = path.resolve(here, "..", "..");
const HEADLESS_C1541 = path.join(repoRoot, ".tools", "vice-headless", "bin", "c1541");

/** The absolute path of `cmd` on the PATH in `env`, or null. */
function which(cmd: string, env: NodeJS.ProcessEnv): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8", env });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function findC1541(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.C1541 && existsSync(env.C1541)) return env.C1541;
  const onPath = which("c1541", env);
  if (onPath) return onPath;
  return existsSync(HEADLESS_C1541) ? HEADLESS_C1541 : null;
}
