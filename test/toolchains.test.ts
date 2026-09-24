import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findToolchains } from "../scripts/lib/toolchains.ts";

// Detection of the toolchains check-listings added for issue #102: ACME,
// 64tass and the llvm-mos SDK. Each is found by environment variable, then
// PATH, then (llvm-mos only) the default directory under $HOME. Fake
// executables in a temporary tree stand in for the real ones.

let root = "";

/** An empty executable at `path`. */
function fakeExe(path: string): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
  return path;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "c64kb-toolchains-"));
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An environment with only /bin and /usr/bin on PATH and HOME at an empty directory. */
function bareEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const home = join(root, "empty-home");
  mkdirSync(home, { recursive: true });
  return { PATH: "/usr/bin:/bin", HOME: home, ...extra };
}

describe("findToolchains: ACME, 64tass, llvm-mos", () => {
  it("reports each as missing when no variable, PATH entry or default names it", () => {
    const t = findToolchains(bareEnv());
    expect(t.acme).toBeNull();
    expect(t.tass64).toBeNull();
    expect(t.mosClang).toBeNull();
  });

  it("finds acme, 64tass and mos-c64-clang on PATH", () => {
    const bin = join(root, "pathbin");
    const acme = fakeExe(join(bin, "acme"));
    const tass = fakeExe(join(bin, "64tass"));
    const clang = fakeExe(join(bin, "mos-c64-clang"));
    const t = findToolchains(bareEnv({ PATH: `${bin}:/usr/bin:/bin` }));
    expect(t.acme).toBe(acme);
    expect(t.tass64).toBe(tass);
    expect(t.mosClang).toBe(clang);
  });

  it("prefers ACME and TASS64 over PATH", () => {
    const bin = join(root, "pathbin2");
    fakeExe(join(bin, "acme"));
    fakeExe(join(bin, "64tass"));
    const acme = fakeExe(join(root, "env/acme-0.97"));
    const tass = fakeExe(join(root, "env/64tass-1.60"));
    const t = findToolchains(bareEnv({ PATH: `${bin}:/usr/bin:/bin`, ACME: acme, TASS64: tass }));
    expect(t.acme).toBe(acme);
    expect(t.tass64).toBe(tass);
  });

  it("ignores a variable that names no file", () => {
    const t = findToolchains(bareEnv({ ACME: join(root, "nothing-here") }));
    expect(t.acme).toBeNull();
  });

  it("takes mos-c64-clang from the SDK directory in LLVM_MOS, before PATH", () => {
    const sdk = join(root, "sdk/llvm-mos");
    const clang = fakeExe(join(sdk, "bin/mos-c64-clang"));
    const bin = join(root, "pathbin3");
    fakeExe(join(bin, "mos-c64-clang"));
    const t = findToolchains(bareEnv({ LLVM_MOS: sdk, PATH: `${bin}:/usr/bin:/bin` }));
    expect(t.mosClang).toBe(clang);
  });

  it("falls back to ~/Developer/c64/llvm-mos", () => {
    const home = join(root, "home");
    const clang = fakeExe(join(home, "Developer/c64/llvm-mos/bin/mos-c64-clang"));
    const t = findToolchains(bareEnv({ HOME: home }));
    expect(t.mosClang).toBe(clang);
  });
});
