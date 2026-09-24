import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The template harness's Python tools (#42, #59): check.py's refusals, the
// ink check and mid-run pins; plan-gate.py's seed, pass line and "the KB's
// answer changed"; drive.py's screen regions; watch.py's deadline and SID
// grading of a written trace (#75). VICE is not needed: pictures
// are drawn with Pillow, check-compatibility is a stub `npx` on PATH. Skips
// where python3 or Pillow is missing.
const root = join(import.meta.dirname, "..");
const harness = join(root, "templates", "_harness");
const hasPil = spawnSync("python3", ["-c", "import PIL"]).status === 0;

type Run = { status: number | null; out: string };
function py(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Run {
  const r = spawnSync("python3", args, { encoding: "utf8", ...opts });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const DEFAULT_GREEN = [98, 213, 50];
const MODEL_PAL_GREEN = [94, 214, 56];

/** A PAL (border `green`) and an NTSC (border NTSC green) exit screenshot: black, a white 10 x 10 block at VIC X 100, line 100. */
function shots(dir: string, green: number[]): { pal: string; ntsc: string } {
  const draw = `
import sys
from PIL import Image
for path, h, off, g in ((sys.argv[1], 272, 16, tuple(${JSON.stringify(green)})),
                        (sys.argv[2], 247, 28, (114, 189, 103))):
    im = Image.new("RGB", (384, h), (0, 0, 0))
    for y in range(h):
        for x in list(range(0, 32)) + list(range(352, 384)):
            im.putpixel((x, y), g)
    for y in range(100 - off, 110 - off):
        for x in range(108, 118):
            im.putpixel((x, y), (255, 255, 255))
    im.save(path)
`;
  const pal = join(dir, "pal.png");
  const ntsc = join(dir, "ntsc.png");
  const r = py(["-c", draw, pal, ntsc]);
  if (r.status !== 0) throw new Error(r.out);
  return { pal, ntsc };
}

function check(dir: string, spec: unknown, pictures: { pal: string; ntsc: string }): Run {
  const expect = join(dir, "expect.json");
  writeFileSync(expect, JSON.stringify(spec));
  return py([join(harness, "check.py"), expect, pictures.pal, pictures.ntsc]);
}

const VERDICT = { name: "verdict", type: "verdict" };
const BLOCK = { vic_x: 90, line: 90, width: 30, height: 30 };

describe.skipIf(!hasPil)("check.py", () => {
  it("counts lit pixels in an area with the ink check", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-ink-"));
    const pics = shots(dir, DEFAULT_GREEN);
    const pass = check(
      dir,
      { checks: [VERDICT, { name: "block", type: "ink", ...BLOCK, min: 100, max: 100, colours: [1] }] },
      pics,
    );
    expect(pass.status).toBe(0);
    expect(pass.out).toContain("100 pixels of");
    const fail = check(dir, { checks: [VERDICT, { name: "block", type: "ink", ...BLOCK, min: 101 }] }, pics);
    expect(fail.status).toBe(1);
    expect(fail.out).toMatch(/^FAIL PAL +block: .*under 101/m);
    const stray = check(
      dir,
      { checks: [VERDICT, { name: "block", type: "ink", ...BLOCK, min: 1, colours: [2] }] },
      pics,
    );
    expect(stray.out).toContain("stray colour 1 (white)");
  });

  it("refuses a -model pal picture with a FAIL REFUSED line and exit 2", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-r3-"));
    const r = check(dir, { checks: [VERDICT] }, shots(dir, MODEL_PAL_GREEN));
    expect(r.status).toBe(2);
    expect(r.out).toMatch(/^FAIL REFUSED check\.py: .*-model pal \(6569R3\) palette/m);
  });

  it("refuses a file with no verdict unless it is a mid-run pin", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mid-"));
    const pics = shots(dir, DEFAULT_GREEN);
    const ink = { name: "block", type: "ink", ...BLOCK, min: 100 };
    const refused = check(dir, { checks: [ink] }, pics);
    expect(refused.status).toBe(2);
    expect(refused.out).toMatch(/^FAIL REFUSED .*no 'verdict' check/m);
    expect(check(dir, { mid_run: true, checks: [ink] }, pics).status).toBe(0);
  });

  it("refuses a picture of the wrong size instead of exiting 1", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-size-"));
    const pics = shots(dir, DEFAULT_GREEN);
    const r = check(dir, { checks: [VERDICT] }, { pal: pics.ntsc, ntsc: pics.ntsc });
    expect(r.status).toBe(2);
    expect(r.out).toContain("not a PAL exit screenshot");
  });
});

/** A project with hello's shipped PLAN.md, and a stub c64-kb whose check-compatibility prints `verdict`. */
function gateProject(verdict: string): { dir: string; kb: string; env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), "harness-gate-"));
  copyFileSync(join(root, "templates", "hello", "PLAN.md"), join(dir, "PLAN.md"));
  const kb = join(dir, "kb");
  mkdirSync(join(kb, "src"), { recursive: true });
  writeFileSync(join(kb, "src", "cli.ts"), "");
  writeFileSync(join(kb, "VERSION"), "KB_DATA_VERSION=123\n");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), `#!/bin/sh\necho '# Compatibility: x'\necho '**Verdict:** ${verdict}'\n`);
  chmodSync(join(bin, "npx"), 0o755);
  // A commit hook sets GIT_DIR, which would give the stub checkout this repository's commit.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  return { dir, kb, env: { ...env, PATH: `${bin}:${process.env.PATH ?? ""}` } };
}

function gate(p: { dir: string; kb: string; env: NodeJS.ProcessEnv }, kb = p.kb): Run {
  return py(
    [
      join(harness, "hooks", "plan-gate.py"),
      "--check",
      "PLAN.md",
      "--c64kb",
      kb,
      "--cache",
      "build/.plan-gate",
    ],
    {
      cwd: p.dir,
      env: p.env,
    },
  );
}

describe("plan-gate.py", () => {
  it("prints one pass line naming the KB version, and caches it", () => {
    const p = gateProject("WARNINGS");
    const r = gate(p);
    expect(r.status).toBe(0);
    expect(r.out.trim()).toBe(
      "plan-gate: PLAN.md passes (check-compatibility re-run on KB data 123: WARNINGS)",
    );
    const cache = JSON.parse(readFileSync(join(p.dir, "build", ".plan-gate"), "utf8")) as { checked: string };
    expect(cache.checked).toBe("check-compatibility re-run on KB data 123");
    expect(gate(p).out).toContain("passes (unchanged; check-compatibility re-run on KB data 123: WARNINGS)");
  });

  it("says the KB's answer changed when the live verdict differs", () => {
    const p = gateProject("COMPATIBLE");
    const r = gate(p);
    expect(r.status).toBe(1);
    expect(r.out).toContain("the KB's answer changed: PLAN.md pastes '**Verdict:** WARNINGS'");
    expect(r.out).toContain("(KB data 123) now prints '**Verdict:** COMPATIBLE'");
  });

  it("passes a seeded shipped plan without consulting the graph", () => {
    const p = gateProject("COMPATIBLE");
    const seed = py(
      [join(harness, "hooks", "plan-gate.py"), "--seed", "PLAN.md", "--cache", "build/.plan-gate"],
      { cwd: p.dir },
    );
    expect(seed.status).toBe(0);
    const r = gate(p);
    expect(r.status).toBe(0);
    expect(r.out).toContain("the starter's shipped plan, check-compatibility not re-run: WARNINGS");
    writeFileSync(join(p.dir, "PLAN.md"), `${readFileSync(join(p.dir, "PLAN.md"), "utf8")}\nedited\n`);
    expect(gate(p).status).toBe(1);
  });

  it("warns and checks the structure only when the checkout is unreachable", () => {
    const p = gateProject("COMPATIBLE");
    const r = gate(p, join(p.dir, "nowhere"));
    expect(r.status).toBe(0);
    expect(r.out).toContain("plan-gate: warning: could not re-run check-compatibility");
  });
});

describe("drive.py", () => {
  it("parses screen regions", () => {
    const r = py([
      "-c",
      "import sys; sys.path.insert(0, sys.argv[1]); import drive; print(drive.parse_screen('0400,C800:21-24,8800:3'))",
      harness,
    ]);
    expect(r.out.trim()).toBe("[(1024, 0, 24), (51200, 21, 24), (34816, 3, 3)]");
  });
});

describe("watch.py", () => {
  // A -monlog trace as the windowless x64sc 3.10 writes it: a head with the
  // raster line and cycle, then the instruction with the clock. PAL frames of
  // 312 x 63 cycles; frame n starts at clock n * 19,656.
  const FRAME = 19656;
  const hit = (addr: string, mnemonic: string, a: number, [frame, line]: [number, number]): string => {
    const clock = frame * FRAME + line * 63 + 10;
    const hex = a.toString(16).toUpperCase().padStart(2, "0");
    const lo = addr.slice(2).toUpperCase();
    const hi = addr.slice(0, 2).toUpperCase();
    return (
      `#1 (Trace store ${addr})  ${String(line)}/$${line.toString(16).padStart(3, "0")},  10/$0a\n` +
      `.C:1234  8D ${lo} ${hi}    ${mnemonic} $${addr.toUpperCase()}      - A:${hex} X:00 Y:00 SP:f3 ..-..I..    ${String(clock)}\n`
    );
  };
  function watch(log: string, args: string[]): Run {
    const dir = mkdtempSync(join(tmpdir(), "harness-watch-"));
    const path = join(dir, "trace.log");
    writeFileSync(path, log);
    return py([join(harness, "watch.py"), "none.prg", "--log", path, ...args]);
  }
  const DEADLINE = ["--deadline", "251"];

  it("holds each WORK_END to the first line N after its WORK_BEGIN", () => {
    // Begun on line 252; ends on line 100 of the next frame: before line 251.
    const pass = watch(hit("02fe", "STA", 1, [10, 252]) + hit("02fe", "STA", 0, [11, 100]), DEADLINE);
    expect(pass.status).toBe(0);
    expect(pass.out).toContain("PASS PAL   deadline: 1 frames' work, each ended before line 251");
    // Ends on line 252 of the next frame: one line and 10 cycles late.
    const late = watch(hit("02fe", "STA", 1, [10, 252]) + hit("02fe", "STA", 0, [11, 252]), DEADLINE);
    expect(late.status).toBe(1);
    expect(late.out).toContain("ended on line 252, 73 cycles late");
    // Ends on line 100 a frame later still: the line alone looks early.
    const frameLate = watch(hit("02fe", "STA", 1, [10, 252]) + hit("02fe", "STA", 0, [12, 100]), DEADLINE);
    expect(frameLate.status).toBe(1);
    expect(frameLate.out).toContain(`${String((312 - 251 + 100) * 63 + 10)} cycles late`);
    // No pair at all is a failure, not a pass.
    const none = watch(hit("02fe", "STA", 0, [10, 100]), DEADLINE);
    expect(none.status).toBe(1);
    expect(none.out).toContain("no WORK_BEGIN / WORK_END pair");
  });

  it("counts the frames that store to the SID", () => {
    const log = [3, 3, 4, 9].map((f) => hit("d418", "STA", 15, [f, 20])).join("");
    const pass = watch(log, ["--sid-frames", "3"]);
    expect(pass.status).toBe(0);
    expect(pass.out).toContain("in 3 frames (4 stores, 7 frames from the first to the last)");
    expect(watch(log, ["--sid-frames", "4"]).status).toBe(1);
  });

  it("refuses a mark whose value the trace does not show", () => {
    const r = watch(hit("02fe", "INC", 0, [10, 252]), DEADLINE);
    expect(r.status).toBe(2);
    expect(r.out).toContain("FAIL REFUSED PAL");
  });
});
