/**
 * Where the build scripts find each toolchain: the environment variable,
 * then PATH, then the default install location on this machine (the one
 * CLAUDE.md names). check-listings and verify-recipes each had their own
 * copy of this lookup, without the defaults; with no variables set, both
 * reported the Oscar64 recipes as "not found" on a machine that had it.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Toolchains {
  /** KickAss.jar; needs `java` too. */
  kickass: string | null;
  java: string | null;
  oscar64: string | null;
  cl65: string | null;
}

/** The absolute path of `cmd` on PATH, or null. */
export function which(cmd: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** `path` if it names an existing file, else null. */
function existing(path: string | undefined): string | null {
  return path && existsSync(path) ? path : null;
}

const HOME = homedir();
export const DEFAULT_KICKASS_JAR = join(HOME, "Developer/c64/kickassembler/KickAss.jar");
export const DEFAULT_OSCAR64 = join(HOME, "Developer/c64/oscar64/bin/oscar64");

/** The c1541 that `npm run vice:headless` installs beside its x64sc. */
export const HEADLESS_C1541 = join(
  new URL("../..", import.meta.url).pathname,
  ".tools/vice-headless/bin/c1541",
);

/**
 * c1541, which verify-recipes needs for the disk-backed recipes: C1541,
 * then PATH, then the headless VICE build. On a machine where only the
 * headless build supplies it, the disk recipes used to fail with "c1541 is
 * not on PATH".
 */
export function findC1541(env: NodeJS.ProcessEnv = process.env): string | null {
  return existing(env.C1541) ?? which("c1541") ?? existing(HEADLESS_C1541);
}

/** Environment variable, then PATH, then the default location. */
export function findToolchains(env: NodeJS.ProcessEnv = process.env): Toolchains {
  return {
    kickass: existing(env.KICKASS_JAR) ?? existing(DEFAULT_KICKASS_JAR),
    java: which("java"),
    oscar64: existing(env.OSCAR64) ?? which("oscar64") ?? existing(DEFAULT_OSCAR64),
    cl65: existing(env.CL65) ?? which("cl65"),
  };
}
