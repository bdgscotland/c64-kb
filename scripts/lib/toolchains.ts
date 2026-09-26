/**
 * Where the build scripts find each toolchain: the environment variable,
 * then PATH, then the default install location on this machine (the one
 * CLAUDE.md names). check-listings and verify-recipes each had their own
 * copy of this lookup, without the defaults; with no variables set, both
 * reported the Oscar64 recipes as "not found" on a machine that had it.
 *
 * findC1541 moved to src/services/c1541-bin.ts (src/re/image.ts needs it
 * too, and src/ must not import scripts/); re-exported here so existing
 * callers are unchanged.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findC1541 } from "../../src/services/c1541-bin.ts";

export { findC1541 };

export interface Toolchains {
  /** KickAss.jar; needs `java` too. */
  kickass: string | null;
  java: string | null;
  oscar64: string | null;
  cl65: string | null;
  /** ACME, for ```acme fences. */
  acme: string | null;
  /** 64tass, for ```64tass fences. */
  tass64: string | null;
  /** The llvm-mos SDK's `mos-c64-clang`, for the C fences of the llvm-mos page. */
  mosClang: string | null;
}

/** The absolute path of `cmd` on the PATH in `env`, or null. */
export function which(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${cmd}`], { encoding: "utf8", env });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** `path` if it names an existing file, else null. */
function existing(path: string | undefined): string | null {
  return path && existsSync(path) ? path : null;
}

/**
 * mos-c64-clang: LLVM_MOS (the SDK directory the release archive unpacks
 * to, `llvm-mos/`), then PATH, then ~/Developer/c64/llvm-mos.
 */
function findMosClang(env: NodeJS.ProcessEnv, c64: string): string | null {
  const inSdk = (dir: string | undefined) => (dir ? existing(join(dir, "bin/mos-c64-clang")) : null);
  return inSdk(env.LLVM_MOS) ?? which("mos-c64-clang", env) ?? inSdk(join(c64, "llvm-mos"));
}

/** Environment variable, then PATH, then the default location under $HOME/Developer/c64. */
export function findToolchains(env: NodeJS.ProcessEnv = process.env): Toolchains {
  const c64 = join(env.HOME ?? homedir(), "Developer/c64");
  return {
    kickass: existing(env.KICKASS_JAR) ?? existing(join(c64, "kickassembler/KickAss.jar")),
    java: which("java", env),
    oscar64: existing(env.OSCAR64) ?? which("oscar64", env) ?? existing(join(c64, "oscar64/bin/oscar64")),
    cl65: existing(env.CL65) ?? which("cl65", env),
    acme: existing(env.ACME) ?? which("acme", env),
    tass64: existing(env.TASS64) ?? which("64tass", env),
    mosClang: findMosClang(env, c64),
  };
}
