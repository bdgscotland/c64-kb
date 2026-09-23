/**
 * kernal-zp-trace: run scripts/kernal-zp-trace.asm in VICE with a store
 * trace on zero page and report, per KERNAL call, the bytes the ROM wrote.
 * This is the instrument behind the `(must; VICE x64sc store trace, ...)`
 * lines of docs/hardware/kernal-routines-reference.md, and the check that
 * the static walk's may sets (kernal-zp-walk.ts) hold every byte a real
 * call writes.
 *
 *   node scripts/kernal-zp-trace.ts           # print the traced set per call, and any byte outside the walk's may set
 *   node scripts/kernal-zp-trace.ts --write   # set the must lines on the page from the trace
 *   node scripts/kernal-zp-trace.ts --check   # exit 1 if a traced byte is outside the may set or a must line differs
 *
 * Needs KickAssembler (KICKASS_JAR + java), c1541 and x64sc; ~3 s. Stores
 * made by code below $E000 (the harness itself) are left out; every
 * interrupt source is masked, so no IRQ handler's stores are counted.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { CLOBBERS_LABEL, formatClobbers, type KernalClobbers } from "../src/graph/kernal-clobbers.ts";
import { findKernal, toRanges } from "./lib/kernal-walk.ts";
import { KERNAL_PAGE, walkAll } from "./lib/kernal-zp-page.ts";
import { findC1541, findToolchains } from "./lib/toolchains.ts";

const root = join(import.meta.dirname, "..");
const MARKER = 0x03fc;

/** Marker number -> the call the segment after it makes, as the must line's basis names it. */
const SEGMENTS: ReadonlyMap<number, { routine: string; call: string; mustLine: boolean }> = new Map([
  [1, { routine: "SETLFS", call: "SETLFS 2,8,2", mustLine: true }],
  [2, { routine: "SETNAM", call: "SETNAM with a 4-byte name", mustLine: true }],
  [3, { routine: "OPEN", call: "OPEN of a PRG file on drive 8 (true drive emulation)", mustLine: true }],
  [4, { routine: "CHKIN", call: "CHKIN on that file", mustLine: true }],
  [5, { routine: "CHRIN", call: "20 CHRIN calls reading that file", mustLine: true }],
  [6, { routine: "READST", call: "READST", mustLine: true }],
  [7, { routine: "CLRCHN", call: "CLRCHN with that file as input", mustLine: true }],
  [8, { routine: "CLOSE", call: "CLOSE of that file", mustLine: true }],
  [9, { routine: "SETLFS", call: "SETLFS 1,8,1 and SETNAM", mustLine: false }],
  [10, { routine: "LOAD", call: "LOAD of a 3-block PRG from drive 8 to its own address", mustLine: true }],
  [
    11,
    {
      routine: "CHROUT",
      call: "CHROUT printing 33 lines, 30 of them 50 characters, so the screen scrolls",
      mustLine: true,
    },
  ],
  [12, { routine: "GETIN", call: "5 GETIN calls on a 4-key buffer", mustLine: true }],
  [13, { routine: "CHRIN", call: "CHRIN from the keyboard reading a 2-character line", mustLine: true }],
  [14, { routine: "PLOT", call: "PLOT set, then read", mustLine: true }],
  [15, { routine: "SETTIM", call: "SETTIM", mustLine: true }],
  [16, { routine: "RDTIM", call: "RDTIM", mustLine: true }],
  [17, { routine: "STOP", call: "STOP with no key down", mustLine: true }],
  [18, { routine: "SCNKEY", call: "SCNKEY with no key down", mustLine: true }],
  [19, { routine: "UDTIM", call: "UDTIM once", mustLine: true }],
]);
// SETLFS+SETNAM before LOAD: checked against both may sets, no line of its own.
const ALSO_SETNAM = 9;

function fail(msg: string): never {
  console.error(`kernal-zp-trace: ${msg}`);
  process.exit(1);
}

/**
 * Run a tool. `quiet` discards its output: the windowless x64sc echoes every
 * trace hit to stdout, which overflows a captured pipe (ENOBUFS).
 */
function run(
  cmd: string,
  args: string[],
  cwd: string,
  opts: { ok?: readonly number[]; quiet?: boolean } = {},
): void {
  const ok = opts.ok ?? [0];
  const r = opts.quiet
    ? spawnSync(cmd, args, { cwd, stdio: "ignore", timeout: 300_000 })
    : spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300_000 });
  if (r.status === null || !ok.includes(r.status)) {
    const out = opts.quiet ? String(r.error ?? "") : String(r.stderr || r.stdout);
    fail(`${cmd} ${args.join(" ")} exited ${String(r.status)}: ${out.slice(-400)}`);
  }
}

/** Build, run, and return the trace log text. */
function trace(): string {
  const tools = findToolchains();
  const c1541 = findC1541();
  const x64sc = resolveX64sc();
  if (!tools.kickass || !tools.java) fail("KickAssembler not found (KICKASS_JAR + java)");
  if (!c1541) fail("c1541 not found (C1541, PATH, .tools/vice-headless)");
  if (!x64sc) fail("x64sc not found (X64SC_BIN, .tools/vice-headless, PATH)");
  if (!process.env.GSETTINGS_SCHEMA_DIR && existsSync("/opt/homebrew/share/glib-2.0/schemas"))
    process.env.GSETTINGS_SCHEMA_DIR = "/opt/homebrew/share/glib-2.0/schemas";
  const work = mkdtempSync(join(tmpdir(), "kernal-zp-trace-"));
  try {
    copyFileSync(join(root, "scripts", "kernal-zp-trace.asm"), join(work, "t.asm"));
    run(tools.java, ["-jar", tools.kickass, "t.asm", "-o", "t.prg"], work);
    // DATA: load address $C200, 768 bytes.
    const data = Buffer.concat([
      Buffer.from([0x00, 0xc2]),
      Buffer.from(Array.from({ length: 768 }, (_, i) => i & 0xff)),
    ]);
    writeFileSync(join(work, "data.prg"), data);
    run(c1541, ["-format", "zptrace,zt", "d64", "disk.d64", "-write", "data.prg", "data"], work);
    // The log file goes on the command line (-monlog), not in the .mon file:
    // the windowless x64sc ignores `logname`/`log on` in -moncommands.
    writeFileSync(join(work, "watch.mon"), ["trace store 0000 00ff", "trace store 03fc 03fc", ""].join("\n"));
    const logPath = join(work, "zp.log");
    run(
      x64sc.path,
      [
        "-default",
        "-warp",
        "+sound",
        "-autostartprgmode",
        "1",
        "-8",
        "disk.d64",
        "-moncommands",
        "watch.mon",
        "-monlog",
        "-monlogname",
        logPath,
        "-limitcycles",
        "40000000",
        "-autostart",
        "t.prg",
      ],
      work,
      // -limitcycles ends the run with exit status 1.
      { ok: [0, 1], quiet: true },
    );
    if (!existsSync(logPath)) fail(`${x64sc.path} wrote no monitor log at ${logPath}`);
    return readFileSync(logPath, "utf8");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** One trace hit: the address stored to, the PC, and A (the marker number for a marker store). */
function hitAt(lines: string[], i: number): { addr: number; pc: number; a: number } | null {
  const head = /^#\d+ \(Trace store ([0-9a-f]{4})\)/.exec(lines[i] ?? "");
  if (!head) return null;
  const next = lines[i + 1] ?? "";
  return {
    addr: parseInt(head[1] ?? "", 16),
    pc: parseInt(/^\.C:([0-9a-f]{4})/.exec(next)?.[1] ?? "0", 16),
    a: parseInt(/A:([0-9A-F]{2})/.exec(next)?.[1] ?? "0", 16),
  };
}

/** Zero-page bytes written from ROM code ($E000 up), per marker segment. */
function segmentStores(log: string): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  const lines = log.split("\n");
  let current: Set<number> | undefined;
  for (let i = 0; i < lines.length; i++) {
    const hit = hitAt(lines, i);
    if (!hit) continue;
    if (hit.addr === MARKER) {
      current = hit.a === 0xff ? undefined : (out.get(hit.a) ?? new Set());
      if (current) out.set(hit.a, current);
    } else if (hit.pc >= 0xe000) current?.add(hit.addr);
  }
  return out;
}

const rom = findKernal(root);
if (!rom) fail("no KERNAL 901227-03 image found (set KERNAL_ROM)");
const pagePath = join(root, KERNAL_PAGE);
const page = readFileSync(pagePath, "utf8");
const walk = walkAll(rom.bytes, page);
const may = new Map(
  walk.routines.map((r) => [r.name, new Set(r.bytes.map((b) => parseInt(b.slice(1), 16)))]),
);
const stores = segmentStores(trace());

const problems: string[] = [];
const must = new Map<string, KernalClobbers[]>();
const hex = (n: number) => `$${n.toString(16).toUpperCase().padStart(2, "0")}`;
for (const [n, seg] of SEGMENTS) {
  const got = stores.get(n);
  if (!got) {
    problems.push(`marker ${n} (${seg.call}) never ran`);
    continue;
  }
  const allowed = new Set([
    ...(may.get(seg.routine) ?? []),
    ...(n === ALSO_SETNAM ? (may.get("SETNAM") ?? []) : []),
  ]);
  const outside = [...got].filter((b) => !allowed.has(b)).sort((a, b) => a - b);
  if (outside.length > 0)
    problems.push(`${seg.call}: wrote ${outside.map(hex).join(" ")}, outside the walk's may set`);
  const c: KernalClobbers = {
    ranges: toRanges(got),
    bound: "must",
    basis: `VICE x64sc store trace, ${seg.call}`,
  };
  console.log(
    `${seg.routine.padEnd(7)} ${String(got.size).padStart(3)} of ${String(allowed.size).padStart(3)} may  ${formatClobbers(c)}`,
  );
  if (seg.mustLine) must.set(seg.routine, [...(must.get(seg.routine) ?? []), c]);
}

/** The page with each traced routine's must lines replaced by the trace's, after its may line. */
function withMustLines(text: string): string {
  let out = text;
  for (const [routine, lines] of must) {
    const head = new RegExp(`^### \\$FF[0-9A-F]{2} — ${routine} — .*$`, "m").exec(out);
    if (!head) continue;
    const next = /^#{2,3} /gm;
    next.lastIndex = head.index + 4;
    const end = next.exec(out)?.index ?? out.length;
    const body = out
      .slice(head.index, end)
      .replace(/^\*\*Clobbers zero page:\*\*.*\(must;.*\n/gm, "")
      .replace(/^(\*\*Clobbers zero page:\*\*.*\(may;.*)$/m, (m) =>
        [m, ...lines.map((c) => `${CLOBBERS_LABEL} ${formatClobbers(c)}`)].join("\n"),
      );
    out = out.slice(0, head.index) + body + out.slice(end);
  }
  return out;
}

const args = new Set(process.argv.slice(2));
const next = withMustLines(page);
if (args.has("--write") && problems.length === 0 && next !== page) {
  writeFileSync(pagePath, next);
  console.log(`kernal-zp-trace: wrote the must lines in ${KERNAL_PAGE}`);
}
if (args.has("--check") && next !== page)
  problems.push("the page's must lines differ from this trace; run with --write");
for (const p of problems) console.error(`kernal-zp-trace: ${p}`);
if (problems.length > 0) process.exit(1);
