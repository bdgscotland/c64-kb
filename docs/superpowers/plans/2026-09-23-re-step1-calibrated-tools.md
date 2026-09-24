# Reverse engineering, pilot step 1: calibrated IRQ-chain and frame-profile tools

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two read-only MCP tools, `c64_re_irq_chain` and `c64_re_frame_profile`, that run a PRG headless in VICE and return observations, proven by reproducing figures this repo already measured on its own recipes; plus the disassembly reference page that closes issue #3.

**Architecture:** One batch-VICE service (`src/services/vice-batch.ts`) runs x64sc with `-moncommands` and `-monlog`, as `scripts/claims-watch.ts` does today; claims-watch moves onto it. A pure parser (`src/re/monlog.ts`) reads the log, now keeping raster line and cycle. Pure analyses (`src/re/irq-chain.ts`, `src/re/frame-profile.ts`) turn hits into observations with IDs. `src/tools/re.ts` wires run + analysis; `src/server/tools-re.ts` registers the MCP tools; `src/cli.ts` gets the same two commands.

**Tech Stack:** TypeScript (Node 24 type stripping, strict, `noUncheckedIndexedAccess`), zod, vitest, VICE x64sc 3.10 windowless build, KickAssembler 5.25, Oscar64 (for calibration PRGs).

**Spec:** `docs/superpowers/specs/2026-09-23-reverse-engineering-design.md`. Later plans cover pilot steps 2–4 (session file, load map, coverage, disassemble, schema 32, Gridrunner, Uridium, Elite). Deferred from the spec's `c64_re_frame_profile` row to plan 2, where a game without its own timer needs them: per-routine totals from VICE `prof`, and frame mode (boundary at a handler entry). Step 1 ships region mode, which is what calibration needs.

## Global Constraints

- Tools are read-only: no writes into `docs/`, no monitor port held, no x64sc killed. Annotations `READ_ONLY`.
- Every observation carries `id`, `basis: "measured-vice"` and `rung: 1`; anything the trace cannot settle is `null` or listed in `unknowns`, never estimated (spec principle 5).
- In this plan a tool accepts only a `.prg` path inside the repository root or the OS temp directory (calibration PRGs). The sha1 manifest for third-party images is plan 2.
- VICE runs: `-default -warp +sound -autostartprgmode 1`, `-model ntsc` for NTSC; exit status 1 from `-limitcycles` is success; stdout discarded (ENOBUFS); `GSETTINGS_SCHEMA_DIR` set if unset; `-monlogname` on the command line (the windowless build ignores `logname` in `-moncommands`).
- PAL frame 19,656 cycles, NTSC 17,095 (`src/domain/timing.ts` `REGION_TIMING`); never hard-code them elsewhere.
- Lint budget: cyclomatic/cognitive 15, 80 lines per function; split, never raise a limit.
- Commit named paths only; never `git add -A`. Messages say what was wrong or missing and the evidence.
- Plain English in every page and message (CLAUDE.md rule 8).

## Review Focus

1. A `$D012` written by a read-modify-write (`INC $D012`) has no known value: the armed line must be `null`, not a guess. Test in Task 3.
2. `$D011` bit 7 written after `$D012`: the armed line is recomputed at each write of either, so line 260 reads as 260, not 4. Test in Task 3.
3. A vector written one byte at a time (`$0314` then `$0315`): the value is reported only once both bytes are known; a lone low byte with an unknown high byte gives `null`. Test in Task 3.
4. A region start with no stop before the run ends (the cycle limit cuts the frame): the sample is dropped and counted in `unpaired`, never reported as a short frame. Test in Task 4.
5. A `prg_path` outside the allowed roots, missing, or not `.prg`: a typed refusal with `isError`, no VICE launched. Test in Task 5.

---

### Task 1: PRG reader and monitor-log parser in `src/re/`

The parser now lives in `scripts/lib/claims-trace.ts`, which `src/` must not import (`tsconfig.build.json` builds `src/` only). Move it, keep the raster line and cycle it discards, and re-export from the old place so claims-watch is unchanged.

**Files:**
- Create: `src/re/prg.ts`, `src/re/monlog.ts`
- Modify: `scripts/lib/claims-trace.ts` (parseHit, storedValue, Hit → re-exports), `scripts/lib/claims-sources.ts` (readPrg, Prg → re-exports)
- Test: `test/re-monlog.test.ts`

**Interfaces:**
- Produces:
  - `src/re/prg.ts`: `interface Prg { load: number; end: number; sys?: number; bytes: Uint8Array }`, `readPrg(bytes: Uint8Array): Prg` (moved verbatim from `claims-sources.ts:116-140`).
  - `src/re/monlog.ts`: `interface Hit { kind: "store" | "exec" | "load"; addr; pc; mnemonic; operand; a; x; y; sp; flags; clock; line: number; cycle: number }`, `parseHit(head: string, insn: string): Hit | null`, `storedValue(hit: Hit): number | null`, `readHits(logPath: string): AsyncGenerator<Hit>`.

- [ ] **Step 1: Capture a real log to pin the head-line format**

```bash
X=$(node -e 'import("./src/services/vice-bin.ts").then(m=>console.log(m.resolveX64sc()?.path ?? "none"))')
echo "$X"    # must be the windowless build (.tools/vice-headless/bin/x64sc); if "none", run npm run vice:headless
W=$(mktemp -d)
printf 'BasicUpstart2(start)\nstart: sei\n    lda #$7f\n    sta $dc0d\n    lda #$2a\n    sta $d012\n    jmp *\n' > $W/t.asm
java -jar ${KICKASS_JAR:-$HOME/Developer/c64/kickassembler/KickAss.jar} $W/t.asm -o $W/t.prg
printf 'trace store d012 d012\ntrace exec 080d 080d\n' > $W/m.mon
(cd $W && GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 60 "$X" -default -warp +sound \
  -autostartprgmode 1 -moncommands m.mon -monlog -monlogname trace.log -limitcycles 4000000 -autostart t.prg >/dev/null 2>&1)
grep -A1 "Trace" $W/trace.log | head
```

If the inline resolver is awkward, run `node -e 'import("./src/services/vice-bin.ts").then(m=>console.log(m.resolveX64sc()?.path))'` first and paste the path. Expected: pairs like `#1 (Trace store d012)  NNN/$xxx,  CC/$yy` then `.C:0813  8D 12 D0  STA $D012 - A:2A ...  CLOCK`. Confirm the first number is the raster line and the second the cycle: the store's line must be stable across two runs and below 312. Copy the two pairs into the test below exactly as logged (they replace the example strings if the spacing differs).

- [ ] **Step 2: Write the failing test**

```ts
// test/re-monlog.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHit, readHits, storedValue } from "../src/re/monlog.ts";
import { readPrg } from "../src/re/prg.ts";

const STORE = [
  "#1 (Trace store 00fb)   41/$029,  62/$3e",
  ".C:0819  86 FB       STX $FB        - A:FF X:12 Y:00 SP:f6 ..-..I..    3049325",
] as const;
const EXEC = [
  "#4 (Trace  exec 080e)  208/$0d0,  52/$34",
  ".C:080e  A9 FF       LDA #$FF       - A:00 X:00 Y:00 SP:f6 ..-.....    3169590",
] as const;

describe("monitor log parser", () => {
  it("keeps the raster line and cycle of a store", () => {
    expect(parseHit(...STORE)).toMatchObject({ kind: "store", addr: 0xfb, pc: 0x819, line: 41, cycle: 62, clock: 3049325 });
  });
  it("reads an exec hit logged with two spaces", () => {
    expect(parseHit(...EXEC)).toMatchObject({ kind: "exec", addr: 0x80e, line: 208, cycle: 52 });
  });
  it("values STX from X and leaves INC unknown", () => {
    const h = parseHit(...STORE);
    expect(h && storedValue(h)).toBe(0x12);
    expect(h && storedValue({ ...h, mnemonic: "INC" })).toBeNull();
  });
  it("streams every hit from a log file and skips other lines", async () => {
    const dir = mkdtempSync(join(tmpdir(), "monlog-"));
    const log = join(dir, "t.log");
    writeFileSync(log, ["noise", ...STORE, "more noise", ...EXEC, ""].join("\n"));
    const hits = [];
    for await (const h of readHits(log)) hits.push(h.addr);
    expect(hits).toEqual([0xfb, 0x80e]);
  });
  it("reads a PRG's load address and SYS target", () => {
    // $0801: 10 SYS 2061 -> $080D
    const bytes = Uint8Array.from([0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60]);
    expect(readPrg(bytes)).toMatchObject({ load: 0x801, sys: 0x80d });
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run test/re-monlog.test.ts`
Expected: FAIL, cannot resolve `../src/re/monlog.ts`.

- [ ] **Step 4: Implement**

`src/re/prg.ts`: move `Prg` and `readPrg` from `scripts/lib/claims-sources.ts` unchanged (keep its comment), export them. In `claims-sources.ts` replace the definitions with `export { readPrg, type Prg } from "../../src/re/prg.ts";`.

`src/re/monlog.ts`:

```ts
/**
 * The windowless x64sc's -monlog trace, read one hit at a time.
 *
 *   #1 (Trace store 00fb)   41/$029,  62/$3e
 *   .C:0819  86 FB       STX $FB        - A:FF X:12 Y:00 SP:f6 ..-..I..    3049325
 *
 * Head: checkpoint kind and address, then raster line and cycle within the
 * line (measured in Task 1 step 1). Second line: the instruction with the
 * registers after it and the CPU clock. A store hit does not log the byte
 * written; storedValue recovers it for STA, STX, STY and SAX only.
 * Moved from scripts/lib/claims-trace.ts, which discarded line and cycle.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface Hit {
  kind: "store" | "exec" | "load";
  addr: number;
  pc: number;
  mnemonic: string;
  operand: string;
  a: number;
  x: number;
  y: number;
  sp: number;
  /** Flags after the instruction, as VICE prints them: `N.-..IZC`. */
  flags: string;
  clock: number;
  /** Raster line when the checkpoint fired. */
  line: number;
  /** Cycle within that line. */
  cycle: number;
}

const HEAD = /^#\d+ \(Trace\s+(store|exec|load)\s+([0-9a-f]{4})\)\s+(\d+)\/\$[0-9a-f]+,\s+(\d+)\/\$[0-9a-f]+/;
const INSN =
  /^\.C:([0-9a-f]{4})\s+(?:[0-9A-F]{2} )+\s*([A-Z]{3})\s*(.*?)\s*- A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) SP:([0-9a-f]{2})\s+(\S+)\s+(\d+)/;

export function parseHit(head: string, insn: string): Hit | null {
  const h = HEAD.exec(head);
  const i = INSN.exec(insn);
  if (!h || !i) return null;
  const n = (k: number, radix = 16) => parseInt(i[k] ?? "", radix);
  return {
    kind: h[1] as Hit["kind"],
    addr: parseInt(h[2] ?? "", 16),
    line: parseInt(h[3] ?? "", 10),
    cycle: parseInt(h[4] ?? "", 10),
    pc: n(1),
    mnemonic: i[2] ?? "",
    operand: i[3] ?? "",
    a: n(4),
    x: n(5),
    y: n(6),
    sp: n(7),
    flags: i[8] ?? "",
    clock: n(9, 10),
  };
}

export function storedValue(hit: Hit): number | null {
  switch (hit.mnemonic) {
    case "STA":
      return hit.a;
    case "STX":
      return hit.x;
    case "STY":
      return hit.y;
    case "SAX":
      return hit.a & hit.x;
    default:
      return null;
  }
}

/** Every hit in a log, in order. A head line waits for its instruction line. */
export async function* readHits(logPath: string): AsyncGenerator<Hit> {
  const rl = createInterface({ input: createReadStream(logPath), crlfDelay: Infinity });
  let head: string | null = null;
  for await (const line of rl) {
    if (head !== null) {
      const hit = parseHit(head, line);
      head = null;
      if (hit) {
        yield hit;
        continue;
      }
    }
    if (line.startsWith("#")) head = line;
  }
}
```

In `scripts/lib/claims-trace.ts` delete the local `Hit`, `HEAD`, `INSN`, `parseHit`, `storedValue` and add `import { parseHit, storedValue, type Hit } from "../../src/re/monlog.ts"; export { parseHit, storedValue, type Hit };`. The extra `line`/`cycle` fields are ignored by ClaimsWatch. If the old `HEAD` accepted a head with no line/cycle suffix, keep accepting it: make the `(\d+)\/…` groups optional (`(?:\s+(\d+)\/\$[0-9a-f]+,\s+(\d+)\/\$[0-9a-f]+)?`) and set `line`/`cycle` to `-1` when absent, so no existing claims-watch fixture breaks.

- [ ] **Step 5: Run the new and old tests**

Run: `npx vitest run test/re-monlog.test.ts test/claims-watch.test.ts`
Expected: PASS, both files.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run knip
git add src/re/prg.ts src/re/monlog.ts scripts/lib/claims-trace.ts scripts/lib/claims-sources.ts test/re-monlog.test.ts
git commit -m "re: move the monitor-log parser into src/ and keep raster line and cycle

claims-trace discarded the line/cycle pair VICE prints on every hit, and
src/ could not import it. Measured the head format on a KickAssembler PRG
in the windowless x64sc 3.10; claims-watch tests unchanged and passing."
```

---

### Task 2: One batch-VICE service; claims-watch moved onto it

**Files:**
- Create: `src/services/vice-batch.ts`
- Modify: `scripts/claims-watch.ts:175-205` (`runVice` → `runBatch`)
- Test: `test/vice-batch.test.ts`

**Interfaces:**
- Consumes: `resolveX64sc()` from `src/services/vice-bin.ts`.
- Produces:

```ts
export type Model = "pal" | "ntsc";
export interface BatchRun { prg: string; monCommands: string; cycles: number; model: Model; disk?: string }
export interface BatchResult { log: string; work: string; dispose(): void }
export class ViceBatchError extends Error { reason: "no-x64sc" | "windowed" | "exit" | "no-log" }
export function runBatch(run: BatchRun): BatchResult;
```

- [ ] **Step 1: Write the failing test**

```ts
// test/vice-batch.test.ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { runBatch, ViceBatchError } from "../src/services/vice-batch.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

describe("runBatch refusals", () => {
  it("refuses a missing PRG before launching anything", () => {
    expect(() => runBatch({ prg: "/nonexistent.prg", monCommands: "", cycles: 1000, model: "pal" })).toThrow(ViceBatchError);
  });
});

describe.skipIf(!canRun)("runBatch in VICE", () => {
  it("runs a PRG under -moncommands and returns a log with the traced store", () => {
    const dir = mkdtempSync(join(tmpdir(), "vice-batch-test-"));
    writeFileSync(join(dir, "t.asm"), "BasicUpstart2(start)\nstart: lda #$2a\n    sta $d012\n    jmp *\n");
    const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], { cwd: dir });
    expect(asm.status).toBe(0);
    const r = runBatch({ prg: join(dir, "t.prg"), monCommands: "trace store d012 d012\n", cycles: 4_000_000, model: "pal" });
    try {
      expect(readFileSync(r.log, "utf8")).toMatch(/Trace store d012/);
    } finally {
      r.dispose();
    }
    expect(existsSync(r.work)).toBe(false);
  }, 60_000);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/vice-batch.test.ts`
Expected: FAIL, cannot resolve `../src/services/vice-batch.ts`.

- [ ] **Step 3: Implement**

```ts
// src/services/vice-batch.ts
/**
 * One headless VICE run driven by a monitor command file: the way every
 * measurement here runs the emulator. The PRG is copied into a fresh work
 * directory, `-moncommands` sets the checkpoints, `-monlog` writes the hits,
 * `-limitcycles` ends the run. Moved from scripts/claims-watch.ts so the
 * reverse-engineering tools and the claims watch share one launcher.
 *
 * Quirks it handles: the windowless x64sc ignores `logname` inside the
 * command file (so -monlogname is on the command line); it echoes every hit
 * to stdout, which fills a pipe (ENOBUFS), so stdout is discarded; a run
 * ended by -limitcycles exits with status 1; the GTK schema directory must
 * be set on macOS/Homebrew.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveX64sc } from "./vice-bin.ts";

export type Model = "pal" | "ntsc";

export interface BatchRun {
  prg: string;
  monCommands: string;
  cycles: number;
  model: Model;
  /** A D64 attached as drive 8. */
  disk?: string;
}

export interface BatchResult {
  log: string;
  work: string;
  dispose(): void;
}

export class ViceBatchError extends Error {
  constructor(
    readonly reason: "no-prg" | "no-x64sc" | "windowed" | "exit" | "no-log",
    message: string,
  ) {
    super(message);
  }
}

const SCHEMAS = "/opt/homebrew/share/glib-2.0/schemas";

function viceArgs(run: BatchRun, log: string): string[] {
  const args = ["-default", "-warp", "+sound", "-autostartprgmode", "1"];
  if (run.model === "ntsc") args.push("-model", "ntsc");
  if (run.disk) args.push("-8", run.disk);
  args.push("-moncommands", "watch.mon", "-monlog", "-monlogname", log, "-limitcycles", String(run.cycles));
  args.push("-autostart", "p.prg");
  return args;
}

export function runBatch(run: BatchRun): BatchResult {
  if (!existsSync(run.prg)) throw new ViceBatchError("no-prg", `no PRG at ${run.prg}`);
  const x64sc = resolveX64sc();
  if (!x64sc) throw new ViceBatchError("no-x64sc", "x64sc not found (set X64SC_BIN or run `npm run vice:headless`)");
  if (x64sc.windowed && process.env.C64KB_ALLOW_WINDOWED !== "1")
    throw new ViceBatchError("windowed", `${x64sc.path} opens a window; run \`npm run vice:headless\``);
  const work = mkdtempSync(join(tmpdir(), "vice-batch-"));
  const dispose = () => rmSync(work, { recursive: true, force: true });
  copyFileSync(run.prg, join(work, "p.prg"));
  writeFileSync(join(work, "watch.mon"), run.monCommands);
  const log = join(work, "trace.log");
  const env = { ...process.env, GSETTINGS_SCHEMA_DIR: process.env.GSETTINGS_SCHEMA_DIR ?? SCHEMAS };
  const r = spawnSync(x64sc.path, viceArgs(run, log), { cwd: work, env, stdio: "ignore", timeout: 600_000 });
  if (r.status !== 0 && r.status !== 1) {
    dispose();
    throw new ViceBatchError("exit", `x64sc exited ${String(r.status)} ${String(r.error ?? "")}`);
  }
  if (!existsSync(log)) {
    dispose();
    throw new ViceBatchError("no-log", `x64sc wrote no monitor log at ${log}`);
  }
  return { log, work, dispose };
}
```

In `scripts/claims-watch.ts` replace `runVice` with a call to `runBatch({ prg: prgPath, monCommands: monCommands(start), cycles: Number(opt.cycles), model: opt.model === "ntsc" ? "ntsc" : "pal", ...(opt.disk ? { disk: opt.disk } : {}) })`, map `ViceBatchError` to `fail(e.message)`, and let `traceInto` call `dispose()` in its `finally` instead of `rmSync(work…)`. Note the current script does not refuse a windowed x64sc; `C64KB_ALLOW_WINDOWED=1` keeps that possible and is documented in the header.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/vice-batch.test.ts test/claims-watch.test.ts`
Expected: PASS (the VICE blocks run when the windowless build and KickAssembler are present; confirm they did not skip: `npx vitest run test/vice-batch.test.ts --reporter=verbose` lists "runs a PRG under -moncommands" as passed, not skipped).

- [ ] **Step 5: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run knip
git add src/services/vice-batch.ts scripts/claims-watch.ts test/vice-batch.test.ts
git commit -m "vice-batch: one launcher for monitor-driven VICE runs

claims-watch held the only copy of the headless -moncommands launch and its
quirks (ENOBUFS, exit 1 on -limitcycles, logname ignored). The RE tools need
the same run; both now use src/services/vice-batch.ts. claims-watch tests pass."
```

---

### Task 3: IRQ-chain analysis (pure)

**Files:**
- Create: `src/re/irq-chain.ts`
- Test: `test/re-irq-chain.test.ts`

**Interfaces:**
- Consumes: `Hit`, `storedValue` from `src/re/monlog.ts`.
- Produces:

```ts
export const VECTORS = { irq_0314: 0x0314, nmi_0318: 0x0318, nmi_fffa: 0xfffa, irq_fffe: 0xfffe } as const;
export type VectorName = keyof typeof VECTORS;
export interface Obs { id: string; basis: "measured-vice"; rung: 1 }
export interface VectorWrite extends Obs { vector: VectorName; value: number | null; pc: number; clock: number; line: number }
export interface Arm extends Obs { line: number | null; pc: number; clock: number; at_line: number }
export interface Entry extends Obs { handler: number; line: number; cycle: number; clock: number; frame: number }
export interface IrqChain { vectors: VectorWrite[]; arms: Arm[]; entries: Entry[]; handlers: HandlerSummary[]; unknowns: string[] }
export interface HandlerSummary { handler: number; via: VectorName[]; entries: number; entry_lines: number[]; armed_before: number[] }
export function storeCommands(): string;                      // pass A checkpoints
export function execCommands(handlers: number[]): string;      // pass B checkpoints (adds to A)
export function handlersFrom(vectors: VectorWrite[]): number[];
export function analyseIrqChain(hits: Iterable<Hit>, framesCycles: number, startClock: number): IrqChain;
```

- [ ] **Step 1: Write the failing test**

```ts
// test/re-irq-chain.test.ts
import { describe, expect, it } from "vitest";
import type { Hit } from "../src/re/monlog.ts";
import { analyseIrqChain, execCommands, handlersFrom, storeCommands } from "../src/re/irq-chain.ts";

const base: Hit = { kind: "store", addr: 0, pc: 0x1000, mnemonic: "STA", operand: "", a: 0, x: 0, y: 0, sp: 0xf6, flags: "..-..I..", clock: 0, line: 0, cycle: 0 };
const st = (addr: number, a: number, clock: number, mnemonic = "STA"): Hit => ({ ...base, addr, a, clock, mnemonic });
const ex = (addr: number, clock: number, line: number): Hit => ({ ...base, kind: "exec", addr, pc: addr, clock, line, cycle: 20 });
const PAL = 19656;

describe("vector writes", () => {
  it("reports a vector once both bytes are known, byte by byte", () => {
    const r = analyseIrqChain([st(0x314, 0x00, 10), st(0x315, 0x20, 20), st(0x314, 0x40, 30)], PAL, 0);
    expect(r.vectors.map((v) => v.value)).toEqual([null, 0x2000, 0x2040]);
    expect(handlersFrom(r.vectors)).toEqual([0x2000, 0x2040]);
  });
});

describe("armed lines", () => {
  it("combines $D012 with $D011 bit 7 and recomputes on each write", () => {
    const r = analyseIrqChain([st(0xd011, 0x1b, 5), st(0xd012, 0x04, 10), st(0xd011, 0x9b, 20)], PAL, 0);
    expect(r.arms.map((a) => a.line)).toEqual([null, 4, 260]);
  });
  it("leaves a read-modify-write of $D012 unknown", () => {
    const r = analyseIrqChain([st(0xd011, 0x1b, 5), st(0xd012, 0, 10, "INC")], PAL, 0);
    expect(r.arms.at(-1)?.line).toBeNull();
    expect(r.unknowns.join(" ")).toMatch(/INC \$D012/);
  });
});

describe("entries and summary", () => {
  it("numbers frames from the start clock and lists entry lines per handler", () => {
    const hits = [st(0x314, 0x00, 1), st(0x315, 0x20, 2), st(0xd011, 0x1b, 3), st(0xd012, 40, 4), ex(0x2000, 100, 40), ex(0x2000, 100 + PAL, 41)];
    const r = analyseIrqChain(hits, PAL, 0);
    expect(r.entries.map((e) => e.frame)).toEqual([0, 1]);
    expect(r.handlers).toEqual([expect.objectContaining({ handler: 0x2000, via: ["irq_0314"], entries: 2, entry_lines: [40, 41], armed_before: [40] })]);
    expect(new Set(r.entries.map((e) => e.id)).size).toBe(2);
  });
});

describe("monitor commands", () => {
  it("traces both bytes of every vector and the IRQ registers, then the handlers", () => {
    expect(storeCommands()).toContain("trace store 0314 0319");
    expect(storeCommands()).toContain("trace store fffa ffff");
    expect(storeCommands()).toContain("trace store d011 d012");
    expect(execCommands([0x2000])).toContain("trace exec 2000 2000");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/re-irq-chain.test.ts`
Expected: FAIL, cannot resolve `../src/re/irq-chain.ts`.

- [ ] **Step 3: Implement**

```ts
// src/re/irq-chain.ts
/**
 * The interrupt chain of a running program, from a monitor trace: which
 * handlers the IRQ and NMI vectors point at over time, which raster line
 * each write to $D012/$D011 arms, and where each handler is entered.
 * Observations only: a byte the trace cannot value (a read-modify-write of
 * $D012, a vector whose other byte was never written) is null and named in
 * `unknowns`.
 *
 * Two passes: storeCommands() finds the vector values; execCommands() adds
 * an exec checkpoint on each handler they named. An entry is the handler's
 * first instruction, so a $0314 handler's line includes the KERNAL's
 * dispatch at $FF48 (29 cycles) and a $FFFE handler's does not.
 */
import { storedValue, type Hit } from "./monlog.ts";

export const VECTORS = { irq_0314: 0x0314, nmi_0318: 0x0318, nmi_fffa: 0xfffa, irq_fffe: 0xfffe } as const;
export type VectorName = keyof typeof VECTORS;

export interface Obs {
  id: string;
  basis: "measured-vice";
  rung: 1;
}
export interface VectorWrite extends Obs {
  vector: VectorName;
  value: number | null;
  pc: number;
  clock: number;
  line: number;
}
export interface Arm extends Obs {
  line: number | null;
  pc: number;
  clock: number;
  at_line: number;
}
export interface Entry extends Obs {
  handler: number;
  line: number;
  cycle: number;
  clock: number;
  frame: number;
}
export interface HandlerSummary {
  handler: number;
  via: VectorName[];
  entries: number;
  entry_lines: number[];
  armed_before: number[];
}
export interface IrqChain {
  vectors: VectorWrite[];
  arms: Arm[];
  entries: Entry[];
  handlers: HandlerSummary[];
  unknowns: string[];
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");
const obs = (id: string): Obs => ({ id, basis: "measured-vice", rung: 1 });

export function storeCommands(): string {
  return ["trace store 0314 0319", "trace store fffa ffff", "trace store d011 d012", "trace store d01a d01a", "trace store dc0d dc0d", "trace store dd0d dd0d"].join("\n") + "\n";
}

export function execCommands(handlers: number[]): string {
  return storeCommands() + handlers.map((h) => `trace exec ${hex4(h)} ${hex4(h)}`).join("\n") + "\n";
}

export function handlersFrom(vectors: VectorWrite[]): number[] {
  return [...new Set(vectors.flatMap((v) => (v.value === null ? [] : [v.value])))].sort((a, b) => a - b);
}

function vectorOf(addr: number): { name: VectorName; hi: boolean } | null {
  for (const [name, base] of Object.entries(VECTORS) as [VectorName, number][]) {
    if (addr === base) return { name, hi: false };
    if (addr === base + 1) return { name, hi: true };
  }
  return null;
}

class State {
  bytes = new Map<number, number | null>();
  d011: number | null = null;
  d012: number | null = null;
  lastArm: number | null = null;
  out: IrqChain = { vectors: [], arms: [], entries: [], handlers: [], unknowns: [] };
  armedBefore = new Map<number, Set<number>>();
  via = new Map<number, Set<VectorName>>();
}

function onVector(s: State, h: Hit, v: { name: VectorName; hi: boolean }): void {
  const value = storedValue(h);
  s.bytes.set(h.addr, value);
  const base = VECTORS[v.name];
  const lo = s.bytes.get(base);
  const hi = s.bytes.get(base + 1);
  const full = lo === undefined || hi === undefined || lo === null || hi === null ? null : (hi << 8) | lo;
  if (value === null) s.out.unknowns.push(`${h.mnemonic} $${hex4(h.addr).toUpperCase()} at $${hex4(h.pc)}: byte not logged`);
  s.out.vectors.push({ ...obs(`v${s.out.vectors.length}`), vector: v.name, value: full, pc: h.pc, clock: h.clock, line: h.line });
  if (full !== null) s.via.set(full, (s.via.get(full) ?? new Set()).add(v.name));
}

function onArm(s: State, h: Hit): void {
  const value = storedValue(h);
  if (h.addr === 0xd011) s.d011 = value;
  else s.d012 = value;
  if (value === null) s.out.unknowns.push(`${h.mnemonic} $${hex4(h.addr).toUpperCase()} at $${hex4(h.pc)}: value not logged`);
  const line = s.d011 === null || s.d012 === null ? null : ((s.d011 & 0x80) << 1) | s.d012;
  s.lastArm = line;
  s.out.arms.push({ ...obs(`a${s.out.arms.length}`), line, pc: h.pc, clock: h.clock, at_line: h.line });
}

function onEntry(s: State, h: Hit, frameCycles: number, startClock: number): void {
  const frame = Math.floor((h.clock - startClock) / frameCycles);
  s.out.entries.push({ ...obs(`e${s.out.entries.length}`), handler: h.addr, line: h.line, cycle: h.cycle, clock: h.clock, frame });
  if (s.lastArm !== null) s.armedBefore.set(h.addr, (s.armedBefore.get(h.addr) ?? new Set()).add(s.lastArm));
}

function summarise(s: State): HandlerSummary[] {
  const by = new Map<number, Entry[]>();
  for (const e of s.out.entries) by.set(e.handler, [...(by.get(e.handler) ?? []), e]);
  const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);
  return [...by.entries()]
    .sort(([a], [b]) => a - b)
    .map(([handler, es]) => ({
      handler,
      via: [...(s.via.get(handler) ?? [])].sort(),
      entries: es.length,
      entry_lines: sorted(es.map((e) => e.line)),
      armed_before: sorted(s.armedBefore.get(handler) ?? []),
    }));
}

export function analyseIrqChain(hits: Iterable<Hit>, frameCycles: number, startClock: number): IrqChain {
  const s = new State();
  for (const h of hits) {
    if (h.kind === "exec") {
      onEntry(s, h, frameCycles, startClock);
      continue;
    }
    const v = vectorOf(h.addr);
    if (v) onVector(s, h, v);
    else if (h.addr === 0xd011 || h.addr === 0xd012) onArm(s, h);
  }
  s.out.handlers = summarise(s);
  return s.out;
}
```

`$D01A`/`$DC0D`/`$DD0D` stores are traced but not yet summarised: they are kept for plan 2's mask report and cost nothing here. If knip or lint objects to the unused checkpoints, keep them: they are commands, not code.

- [ ] **Step 4: Run it**

Run: `npx vitest run test/re-irq-chain.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
npm run typecheck && npm run lint
git add src/re/irq-chain.ts test/re-irq-chain.test.ts
git commit -m "re: IRQ-chain analysis from a monitor trace

No tool could say which handlers a running program installs or which lines
it arms. Pure analysis over parsed hits: vectors valued only when both bytes
are logged, armed line from \$D012 plus \$D011 bit 7, RMW left unknown."
```

---

### Task 4: Frame-profile analysis (pure)

**Files:**
- Create: `src/re/frame-profile.ts`
- Test: `test/re-frame-profile.test.ts`

**Interfaces:**
- Consumes: `Hit`, `storedValue` from `src/re/monlog.ts`; `Obs` from `src/re/irq-chain.ts`.
- Produces:

```ts
export type Marker = { store: number; value: number } | { pc: number };
export interface Region { start: Marker; stop: Marker }
export interface Sample extends Obs { cycles: number; start_clock: number; frame: number }
export interface Profile { samples: Sample[]; worst: number | null; typical: number | null; count: number; unpaired: number; over_frame: number }
export function regionCommands(region: Region): string;
export function analyseRegion(hits: Iterable<Hit>, region: Region, frameCycles: number, startClock: number): Profile;
```

`typical` is the median sample (lower middle for an even count). `over_frame` counts samples longer than one frame; they stay in `samples` and in `worst`.

- [ ] **Step 1: Write the failing test**

```ts
// test/re-frame-profile.test.ts
import { describe, expect, it } from "vitest";
import type { Hit } from "../src/re/monlog.ts";
import { analyseRegion, regionCommands } from "../src/re/frame-profile.ts";

const base: Hit = { kind: "store", addr: 0xdc0f, pc: 0x1000, mnemonic: "STA", operand: "", a: 0, x: 0, y: 0, sp: 0xf6, flags: "", clock: 0, line: 0, cycle: 0 };
const st = (a: number, clock: number): Hit => ({ ...base, a, clock });
const TIMER_B = { start: { store: 0xdc0f, value: 0x11 }, stop: { store: 0xdc0f, value: 0x00 } };
const PAL = 19656;

describe("region samples", () => {
  it("pairs each start with the next stop and ignores the stop that precedes a start", () => {
    // timer_start writes $00 then $11; timer_stop writes $00.
    const hits = [st(0, 10), st(0x11, 20), st(0, 520), st(0, 19700), st(0x11, 19710), st(0, 20010)];
    const p = analyseRegion(hits, TIMER_B, PAL, 0);
    expect(p.samples.map((s) => s.cycles)).toEqual([500, 300]);
    expect(p.samples.map((s) => s.frame)).toEqual([0, 1]);
    expect(p).toMatchObject({ worst: 500, typical: 300, count: 2, unpaired: 0 });
  });
  it("drops a start the run cut off and counts it", () => {
    const p = analyseRegion([st(0x11, 20), st(0, 520), st(0x11, 900)], TIMER_B, PAL, 0);
    expect(p).toMatchObject({ count: 1, unpaired: 1, worst: 500 });
  });
  it("counts a sample longer than a frame but keeps it", () => {
    const p = analyseRegion([st(0x11, 0), st(0, 30000)], TIMER_B, PAL, 0);
    expect(p).toMatchObject({ over_frame: 1, worst: 30000 });
  });
  it("pairs by PC as well as by store", () => {
    const ex = (pc: number, clock: number): Hit => ({ ...base, kind: "exec", addr: pc, pc, clock });
    const p = analyseRegion([ex(0x2000, 0), ex(0x2100, 77)], { start: { pc: 0x2000 }, stop: { pc: 0x2100 } }, PAL, 0);
    expect(p.worst).toBe(77);
  });
  it("gives null figures when nothing paired", () => {
    expect(analyseRegion([], TIMER_B, PAL, 0)).toMatchObject({ worst: null, typical: null, count: 0 });
  });
});

describe("region commands", () => {
  it("traces the marker addresses", () => {
    expect(regionCommands(TIMER_B)).toBe("trace store dc0f dc0f\n");
    expect(regionCommands({ start: { pc: 0x2000 }, stop: { pc: 0x2100 } })).toBe("trace exec 2000 2000\ntrace exec 2100 2100\n");
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/re-frame-profile.test.ts`
Expected: FAIL, cannot resolve `../src/re/frame-profile.ts`.

- [ ] **Step 3: Implement**

```ts
// src/re/frame-profile.ts
/**
 * Cycles between two markers in a running program, once per occurrence:
 * the region a game's own timer brackets, or two PCs. A marker is a store
 * of a given value (timer_start's `STA $DC0F` with $11) or an executed PC.
 * The figure is the CPU clock difference between the two hits, badline and
 * sprite stalls included, which is what a CIA timer across the same region
 * counts, give or take the few cycles of the timer writes themselves.
 */
import type { Obs } from "./irq-chain.ts";
import { storedValue, type Hit } from "./monlog.ts";

export type Marker = { store: number; value: number } | { pc: number };
export interface Region {
  start: Marker;
  stop: Marker;
}
export interface Sample extends Obs {
  cycles: number;
  start_clock: number;
  frame: number;
}
export interface Profile {
  samples: Sample[];
  worst: number | null;
  typical: number | null;
  count: number;
  unpaired: number;
  over_frame: number;
}

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

function command(m: Marker): string {
  return "store" in m ? `trace store ${hex4(m.store)} ${hex4(m.store)}` : `trace exec ${hex4(m.pc)} ${hex4(m.pc)}`;
}

export function regionCommands(region: Region): string {
  return [...new Set([command(region.start), command(region.stop)])].join("\n") + "\n";
}

function matches(h: Hit, m: Marker): boolean {
  if ("store" in m) return h.kind === "store" && h.addr === m.store && storedValue(h) === m.value;
  return h.kind === "exec" && h.addr === m.pc;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
}

export function analyseRegion(hits: Iterable<Hit>, region: Region, frameCycles: number, startClock: number): Profile {
  const samples: Sample[] = [];
  let open: number | null = null;
  for (const h of hits) {
    if (matches(h, region.start)) open = h.clock;
    else if (open !== null && matches(h, region.stop)) {
      samples.push({
        id: `s${samples.length}`,
        basis: "measured-vice",
        rung: 1,
        cycles: h.clock - open,
        start_clock: open,
        frame: Math.floor((open - startClock) / frameCycles),
      });
      open = null;
    }
  }
  const cycles = samples.map((s) => s.cycles);
  return {
    samples,
    worst: cycles.length ? Math.max(...cycles) : null,
    typical: median(cycles),
    count: samples.length,
    unpaired: open === null ? 0 : 1,
    over_frame: cycles.filter((c) => c > frameCycles).length,
  };
}
```

A start seen while another is open restarts it (the earlier one had no stop); that is the Oscar64 harness's `$00` then `$11` pattern handled by matching the value, and a genuine double start is rare enough to be visible as a missing sample, not a wrong one.

- [ ] **Step 4: Run it**

Run: `npx vitest run test/re-frame-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

```bash
npm run typecheck && npm run lint
git add src/re/frame-profile.ts test/re-frame-profile.test.ts
git commit -m "re: frame-profile analysis between two markers

A game's frame cost could be read only from its own HUD. The analysis pairs
a start marker (a store of a value, or a PC) with the next stop and reports
worst, median, cut-off starts and over-frame samples."
```

---

### Task 5: The two tools: functions, MCP registration, CLI

**Files:**
- Create: `src/tools/re.ts`, `src/server/tools-re.ts`
- Modify: `src/server/tools.ts` (append after `runGameTool`), `src/cli.ts` (two commands after `game-briefing`), `test/mcp-tools.test.ts:38` (SKIP set)
- Test: `test/re-tools.test.ts`

**Interfaces:**
- Consumes: `runBatch`, `ViceBatchError` (Task 2); `readHits` (Task 1); `analyseIrqChain`, `storeCommands`, `execCommands`, `handlersFrom` (Task 3); `analyseRegion`, `regionCommands`, `Region` (Task 4); `REGION_TIMING`, `videoRegion` from `src/domain/timing.ts`; `readPrg` (Task 1).
- Produces:

```ts
export const IrqChainInput: { prg_path; model; cycles; disk_path? }       // zod raw shapes
export const FrameProfileInput: { prg_path; model; cycles; disk_path?; start; stop }
export async function reIrqChain(args): Promise<ReResult<IrqChain>>;
export async function reFrameProfile(args): Promise<ReResult<Profile>>;
export type ReResult<T> = { ok: true; run: RunInfo; result: T } | { ok: false; error: string; reason: string };
export interface RunInfo { prg: string; model: "pal" | "ntsc"; cycles: number; start_clock: number; vice: string }
export function allowedPrg(p: string): string | null;   // resolved path or null
```

Marker strings on the wire: `"store:$DC0F=$11"` or `"pc:$2000"`, parsed by `parseMarker(s: string): Marker | null`.

- [ ] **Step 1: Write the failing test**

```ts
// test/re-tools.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedPrg, parseMarker, reIrqChain } from "../src/tools/re.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

describe("inputs", () => {
  it("refuses a path outside the repo and temp, a missing file, a non-PRG", () => {
    expect(allowedPrg("/etc/hosts")).toBeNull();
    expect(allowedPrg(join(tmpdir(), "missing.prg"))).toBeNull();
    expect(allowedPrg(join(import.meta.dirname, "..", "package.json"))).toBeNull();
  });
  it("parses store and pc markers", () => {
    expect(parseMarker("store:$DC0F=$11")).toEqual({ store: 0xdc0f, value: 0x11 });
    expect(parseMarker("pc:$2000")).toEqual({ pc: 0x2000 });
    expect(parseMarker("store:$DC0F")).toBeNull();
  });
  it("returns a refusal, not a throw, and launches nothing for a bad path", async () => {
    const r = await reIrqChain({ prg_path: "/etc/hosts", model: "pal", cycles: 1000 });
    expect(r).toMatchObject({ ok: false, reason: "path" });
  });
});

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

describe.skipIf(!canRun)("c64_re_irq_chain in VICE", () => {
  it("finds a $FFFE handler armed at line 100 and entered on it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-tools-"));
    writeFileSync(
      join(dir, "t.asm"),
      [
        "BasicUpstart2(start)",
        "start: sei",
        "    lda #$35",
        "    sta $01",
        "    lda #$7f",
        "    sta $dc0d",
        "    lda $dc0d",
        "    lda #<irq",
        "    sta $fffe",
        "    lda #>irq",
        "    sta $ffff",
        "    lda #$1b",
        "    sta $d011",
        "    lda #100",
        "    sta $d012",
        "    lda #1",
        "    sta $d01a",
        "    cli",
        "    jmp *",
        "irq: pha",
        "    lda #1",
        "    sta $d019",
        "    pla",
        "    rti",
      ].join("\n"),
    );
    expect(spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], { cwd: dir }).status).toBe(0);
    const r = await reIrqChain({ prg_path: join(dir, "t.prg"), model: "pal", cycles: 4_000_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.result.handlers.find((x) => x.via.includes("irq_fffe"));
    expect(h?.armed_before).toEqual([100]);
    expect(h?.entry_lines.every((l) => l === 100 || l === 101)).toBe(true);
    expect(h?.entries).toBeGreaterThan(10);
  }, 120_000);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/re-tools.test.ts`
Expected: FAIL, cannot resolve `../src/tools/re.ts`.

- [ ] **Step 3: Implement `src/tools/re.ts`**

```ts
// src/tools/re.ts
/**
 * Reverse-engineering tools: run a PRG headless in VICE under monitor
 * checkpoints and return observations (docs/superpowers/specs/
 * 2026-09-23-reverse-engineering-design.md). Read-only: each call has its
 * own work directory and x64sc process and holds no port.
 *
 * Paths: in this step only PRGs inside the repository or the OS temp
 * directory are accepted (this repo's recipes and templates, and test
 * builds). Third-party images come in by sha1 through a local manifest in
 * the next step.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { REGION_TIMING, videoRegion } from "../domain/timing.ts";
import { analyseRegion, regionCommands, type Marker, type Profile } from "../re/frame-profile.ts";
import { analyseIrqChain, execCommands, handlersFrom, storeCommands, type IrqChain } from "../re/irq-chain.ts";
import { readHits, type Hit } from "../re/monlog.ts";
import { readPrg } from "../re/prg.ts";
import { runBatch, ViceBatchError, type Model } from "../services/vice-batch.ts";
import { resolveX64sc } from "../services/vice-bin.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface RunInfo {
  prg: string;
  model: Model;
  cycles: number;
  start_clock: number;
  vice: string;
}
export type ReResult<T> = { ok: true; run: RunInfo; result: T } | { ok: false; error: string; reason: string };

const common = {
  prg_path: z.string().describe("Absolute path to a .prg inside this repository or the OS temp directory"),
  model: z.enum(["pal", "ntsc"]).default("pal").describe("pal = VICE -default (C64C: 8565, 8580, 8521); ntsc = -model ntsc"),
  cycles: z.number().int().min(100_000).max(200_000_000).default(8_000_000).describe("Run length in CPU cycles (-limitcycles)"),
  disk_path: z.string().optional().describe("A D64 attached as drive 8 (a copy is not made: pass a scratch disk)"),
};
export const IrqChainInput = common;
export const FrameProfileInput = {
  ...common,
  start: z.string().describe('Start marker: "store:$DC0F=$11" (a store of that value) or "pc:$2000" (an executed PC)'),
  stop: z.string().describe('Stop marker, same forms: "store:$DC0F=$00"'),
};

export function allowedPrg(p: string): string | null {
  if (!p.toLowerCase().endsWith(".prg") || !existsSync(p)) return null;
  const real = realpathSync(p);
  const roots = [realpathSync(repoRoot), realpathSync(tmpdir())];
  return roots.some((r) => real.startsWith(r + path.sep)) ? real : null;
}

export function parseMarker(s: string): Marker | null {
  const st = /^store:\$?([0-9a-f]{1,4})=\$?([0-9a-f]{1,2})$/i.exec(s.trim());
  if (st) return { store: parseInt(st[1] ?? "", 16), value: parseInt(st[2] ?? "", 16) };
  const pc = /^pc:\$?([0-9a-f]{1,4})$/i.exec(s.trim());
  return pc ? { pc: parseInt(pc[1] ?? "", 16) } : null;
}

async function collect(log: string): Promise<Hit[]> {
  const out: Hit[] = [];
  for await (const h of readHits(log)) out.push(h);
  return out;
}

/** The program's entry clock: the first exec of its SYS target, else 0. */
function entryCommand(prg: string): { cmd: string; entry: number | null } {
  const sys = readPrg(readFileSync(prg)).sys ?? null;
  const hex = sys === null ? "" : sys.toString(16).padStart(4, "0");
  return { cmd: sys === null ? "" : `trace exec ${hex} ${hex}\n`, entry: sys };
}

async function traced(prg: string, args: { model: Model; cycles: number; disk_path?: string | undefined }, commands: string): Promise<{ hits: Hit[]; start: number }> {
  const { cmd, entry } = entryCommand(prg);
  const run = runBatch({ prg, monCommands: commands + cmd, cycles: args.cycles, model: args.model, ...(args.disk_path ? { disk: args.disk_path } : {}) });
  try {
    const all = await collect(run.log);
    const first = entry === null ? undefined : all.find((h) => h.kind === "exec" && h.addr === entry);
    const start = first?.clock ?? 0;
    return { hits: all.filter((h) => h.clock >= start && !(h.kind === "exec" && h.addr === entry)), start };
  } finally {
    run.dispose();
  }
}

function info(prg: string, args: { model: Model; cycles: number }, start: number): RunInfo {
  return { prg, model: args.model, cycles: args.cycles, start_clock: start, vice: resolveX64sc()?.path ?? "" };
}

function refusal(e: unknown): { ok: false; error: string; reason: string } {
  if (e instanceof ViceBatchError) return { ok: false, error: e.message, reason: e.reason };
  throw e;
}

export async function reIrqChain(args: { prg_path: string; model: Model; cycles: number; disk_path?: string | undefined }): Promise<ReResult<IrqChain>> {
  const prg = allowedPrg(args.prg_path);
  if (!prg) return { ok: false, error: `not an allowed .prg: ${args.prg_path}`, reason: "path" };
  const frame = REGION_TIMING[videoRegion(args.model)].cycles_per_frame;
  try {
    const a = await traced(prg, args, storeCommands());
    const handlers = handlersFrom(analyseIrqChain(a.hits, frame, a.start).vectors);
    const b = await traced(prg, args, execCommands(handlers));
    return { ok: true, run: info(prg, args, b.start), result: analyseIrqChain(b.hits, frame, b.start) };
  } catch (e) {
    return refusal(e);
  }
}

export async function reFrameProfile(args: { prg_path: string; model: Model; cycles: number; disk_path?: string | undefined; start: string; stop: string }): Promise<ReResult<Profile>> {
  const prg = allowedPrg(args.prg_path);
  if (!prg) return { ok: false, error: `not an allowed .prg: ${args.prg_path}`, reason: "path" };
  const start = parseMarker(args.start);
  const stop = parseMarker(args.stop);
  if (!start || !stop) return { ok: false, error: `bad marker: ${!start ? args.start : args.stop}`, reason: "marker" };
  const frame = REGION_TIMING[videoRegion(args.model)].cycles_per_frame;
  try {
    const t = await traced(prg, args, regionCommands({ start, stop }));
    return { ok: true, run: info(prg, args, t.start), result: analyseRegion(t.hits, { start, stop }, frame, t.start) };
  } catch (e) {
    return refusal(e);
  }
}
```

`collect` holds every hit in memory; the traces here are targeted (vectors, a few registers, handler entries, two markers), so a run of 40 M cycles stays in the tens of thousands of hits. If lint's 80-line or complexity budget trips on any function, split it; do not raise the limit.

- [ ] **Step 4: Implement `src/server/tools-re.ts` and register**

```ts
// src/server/tools-re.ts
/** Reverse-engineering tools: observations from a PRG run headless in VICE. */
import { FrameProfileInput, IrqChainInput, reFrameProfile, reIrqChain, type ReResult } from "../tools/re.ts";
import { defineTool, READ_ONLY, type ToolReply } from "./define-tool.ts";

const hex = (n: number) => "$" + n.toString(16).toUpperCase().padStart(4, "0");

function reply<T>(r: ReResult<T>, text: (t: T) => string): ToolReply {
  if (!r.ok) return { text: `refused (${r.reason}): ${r.error}`, isError: true };
  const head = `${r.run.prg}, ${r.run.model.toUpperCase()}, ${r.run.cycles} cycles, entry at clock ${r.run.start_clock} (measured-vice, rung 1)\n`;
  return { text: head + text(r.result) };
}

export const reIrqChainTool = defineTool({
  name: "c64_re_irq_chain",
  title: "Measure a program's interrupt chain in VICE",
  description: `Run a .prg headless in VICE x64sc and report its interrupt chain as observations: every write to the IRQ/NMI vectors ($0314/5, $0318/9, $FFFA/B, $FFFE/F) with the value once both bytes are known; every raster line armed by writes to $D012 and $D011 bit 7; every entry into each handler with its raster line, cycle and frame. A value the trace cannot know (a read-modify-write, a byte never written) is null and listed under unknowns. A $0314 handler's entry line includes the KERNAL dispatch at $FF48.

Inputs: prg_path (inside this repo or the temp directory), model pal|ntsc, cycles, disk_path.
Output: handlers [{handler, via, entries, entry_lines, armed_before}], vectors, arms, entries, unknowns, each observation with an id, basis and rung.`,
  inputSchema: IrqChainInput,
  annotations: READ_ONLY,
  run: async (args) =>
    reply(await reIrqChain(args), (r) =>
      r.handlers.map((h) => `handler ${hex(h.handler)} via ${h.via.join(", ") || "?"}: ${h.entries} entries on lines ${h.entry_lines.join(", ")}; armed ${h.armed_before.join(", ") || "?"}`).join("\n") +
      (r.unknowns.length ? `\nunknown: ${[...new Set(r.unknowns)].join("; ")}` : ""),
    ),
});

export const reFrameProfileTool = defineTool({
  name: "c64_re_frame_profile",
  title: "Measure cycles between two markers in VICE",
  description: `Run a .prg headless in VICE x64sc and time every occurrence of a region, from a start marker to the next stop marker, in CPU cycles (badline and sprite stalls included). A marker is "store:$DC0F=$11" (a store of that value to that address) or "pc:$2000" (an executed PC). Returns worst, typical (median), the count, starts the run cut off (unpaired), samples longer than one frame (over_frame, kept in worst), and every sample with its frame.

Inputs: prg_path, model, cycles, disk_path, start, stop.`,
  inputSchema: FrameProfileInput,
  annotations: READ_ONLY,
  run: async (args) =>
    reply(await reFrameProfile(args), (p) => `samples ${p.count}, worst ${p.worst ?? "none"}, typical ${p.typical ?? "none"} (median), unpaired ${p.unpaired}, over one frame ${p.over_frame}`),
});
```

In `src/server/tools.ts` import both and append after `runGameTool`:

```ts
  // Reverse engineering: observations from a PRG run headless in VICE
  reIrqChainTool,
  reFrameProfileTool,
```

In `test/mcp-tools.test.ts` add both names to `SKIP` with the comment "run VICE for seconds; covered by test/re-tools.test.ts and test/re-calibration.test.ts".

In `src/cli.ts`, after the `game-briefing` command, following the file's existing `.command(...).option(...).action(...)` pattern:

```ts
program
  .command("re-irq-chain <prg>")
  .option("--model <m>", "pal or ntsc", "pal")
  .option("--cycles <n>", "run length", "8000000")
  .action(async (prg: string, o: { model: string; cycles: string }) => {
    const r = await reIrqChain({ prg_path: path.resolve(prg), model: o.model === "ntsc" ? "ntsc" : "pal", cycles: Number(o.cycles) });
    console.log(JSON.stringify(r, null, 2));
    if (!r.ok) process.exitCode = 1;
  });

program
  .command("re-frame-profile <prg>")
  .requiredOption("--start <marker>", 'e.g. "store:$DC0F=$11"')
  .requiredOption("--stop <marker>", 'e.g. "store:$DC0F=$00"')
  .option("--model <m>", "pal or ntsc", "pal")
  .option("--cycles <n>", "run length", "8000000")
  .option("--disk <d64>", "drive 8")
  .action(async (prg: string, o: { start: string; stop: string; model: string; cycles: string; disk?: string }) => {
    const r = await reFrameProfile({ prg_path: path.resolve(prg), model: o.model === "ntsc" ? "ntsc" : "pal", cycles: Number(o.cycles), start: o.start, stop: o.stop, ...(o.disk ? { disk_path: path.resolve(o.disk) } : {}) });
    // Every sample is in the MCP reply; the CLI prints the count, not the list.
    console.log(JSON.stringify(r.ok ? { run: r.run, ...r.result, samples: r.result.samples.length } : r, null, 2));
    if (!r.ok) process.exitCode = 1;
  });
```

Match the variable name the file uses for its commander instance (read `src/cli.ts:60-70` first) and its `path` import.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/re-tools.test.ts test/mcp-tools.test.ts --reporter=verbose`
Expected: PASS; "finds a $FFFE handler armed at line 100" ran, not skipped. If the entry line is neither 100 nor 101, do not widen the test: read the log (`node src/cli.ts re-irq-chain <prg>`), work out why, and record the measured offset in the tool description.

- [ ] **Step 6: Gates and commit**

```bash
npm run typecheck && npm run lint && npm run format:check && npm run knip
git add src/tools/re.ts src/server/tools-re.ts src/server/tools.ts src/cli.ts test/re-tools.test.ts test/mcp-tools.test.ts
git commit -m "c64_re_irq_chain, c64_re_frame_profile: read-only MCP tools over VICE traces

Agents had no way to measure a program's interrupt chain or a region's cycle
cost except by reading its HUD. Measured on a KickAssembler \$FFFE handler
armed at line 100: armed line 100, entries on line 100/101."
```

---

### Task 6: Calibration against this repo's measured figures

The spec's gate: no RE figure is trusted until the tools reproduce figures already committed.

| Target | Tool | Committed figure | Pass |
|---|---|---|---|
| `kickassembler/irq-chain` | irq_chain | armed lines 40, 130, 260 (listing `.const LINE0/1/2`) | armed set exactly {40, 130, 260}; each handler slot entered on its line or the next |
| `oscar64/falling-blocks` (12,500,000 cycles PAL, no disk; runs.json) | frame_profile `store:$DC0E=$11` → `store:$DC0E=$00` | worst 6,276 PAL (design page, CIA1 timer A) | within 2% |
| `oscar64/platformer-scaffold` (40,000,000 cycles PAL, fresh disk `TEST,01`) | frame_profile `store:$DC0F=$11` → `store:$DC0F=$00` | worst 8,693 PAL (design page: MAX at 40,000,000 cycles, 800 frames) | within 2% over samples ≤ one frame (the recipe discards frames where the KERNAL used timer B for disk I/O, `io_frame`; those are the over-frame samples) |

**Files:**
- Create: `test/re-calibration.test.ts`
- Modify: `vitest.config.ts` only if the integration project needs the file listed (read it first: `test:integration` exists)

**Interfaces:**
- Consumes: `reIrqChain`, `reFrameProfile` (Task 5); `findC1541` from `scripts/lib/toolchains.ts`.

- [ ] **Step 1: Build the three PRGs once and see their file names**

```bash
K=$(mktemp -d)
node scripts/verify-recipes.ts --file docs/recipes/kickassembler/irq-chain.md --keep $K
node scripts/verify-recipes.ts --file docs/recipes/oscar64/falling-blocks.md --keep $K
node scripts/verify-recipes.ts --file docs/recipes/oscar64/platformer-scaffold.md --keep $K
find $K -name '*.prg'
```

Expected: three PRGs. Note their paths relative to `$K`; the test uses the same `--keep` call in `beforeAll`.

- [ ] **Step 2: Measure by hand first**

```bash
node src/cli.ts re-irq-chain $K/<irq-chain>.prg
node src/cli.ts re-frame-profile $K/<falling-blocks>.prg --start 'store:$DC0E=$11' --stop 'store:$DC0E=$00' --cycles 12500000
c1541 -format TEST,01 d64 $K/t.d64
node src/cli.ts re-frame-profile $K/<platformer>.prg --start 'store:$DC0F=$11' --stop 'store:$DC0F=$00' --cycles 40000000 --disk $K/t.d64
```

Record the three outputs in the scratchpad. If a figure misses by more than 2%, stop and find out why (timer write offsets, the recipe's exclusions, a different run length) before writing the test. Do not widen the tolerance to pass; the spec says the tolerance and the measured difference are recorded, and a miss is a finding.

- [ ] **Step 3: Write the test from the measured outputs**

```ts
// test/re-calibration.test.ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { reFrameProfile, reIrqChain } from "../src/tools/re.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findC1541, findToolchains } from "../scripts/lib/toolchains.ts";

// Pilot step 1 of docs/superpowers/specs/2026-09-23-reverse-engineering-design.md:
// the RE tools must reproduce figures this repo already measured before any
// third-party game is studied. Figures and their sources are in the plan's
// Task 6 table; the measured differences are in CHANGELOG.md.
const root = join(import.meta.dirname, "..");
const t = findToolchains();
const x64sc = resolveX64sc();
const c1541 = findC1541();
const canRun = x64sc !== null && !x64sc.windowed && t.kickass !== null && t.oscar64 !== null && c1541 !== null;
const TOLERANCE = 0.02;
const PAL_FRAME = 19656;

let keep = "";
const prg = (stem: string) => {
  const hit = readdirSync(keep, { recursive: true }).map(String).find((f) => f.endsWith(".prg") && f.includes(stem));
  if (!hit) throw new Error(`no PRG for ${stem} under ${keep}`);
  return join(keep, hit);
};

describe.skipIf(!canRun)("RE tools reproduce committed measurements", () => {
  beforeAll(() => {
    keep = mkdtempSync(join(tmpdir(), "re-cal-"));
    for (const md of ["kickassembler/irq-chain.md", "oscar64/falling-blocks.md", "oscar64/platformer-scaffold.md"]) {
      const r = spawnSync(process.execPath, [join(root, "scripts/verify-recipes.ts"), "--file", join(root, "docs/recipes", md), "--keep", keep], { encoding: "utf8" });
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
  }, 600_000);

  it("irq-chain: armed lines are the listing's 40, 130, 260", async () => {
    const r = await reIrqChain({ prg_path: prg("irq-chain"), model: "pal", cycles: 8_000_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const armed = new Set(r.result.arms.flatMap((a) => (a.line === null ? [] : [a.line])));
    expect([...armed].sort((a, b) => a - b)).toEqual([40, 130, 260]);
    for (const h of r.result.handlers)
      for (const line of h.entry_lines) expect(h.armed_before.some((a) => line === a || line === a + 1)).toBe(true);
  }, 120_000);

  it("falling-blocks: worst frame within 2% of 6,276 (timer A)", async () => {
    const r = await reFrameProfile({ prg_path: prg("falling-blocks"), model: "pal", cycles: 12_500_000, start: "store:$DC0E=$11", stop: "store:$DC0E=$00" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Math.abs((r.result.worst ?? 0) - 6276) / 6276).toBeLessThanOrEqual(TOLERANCE);
  }, 120_000);

  it("platformer-scaffold: worst in-frame sample within 2% of 8,693 (timer B)", async () => {
    const disk = join(keep, "cal.d64");
    expect(spawnSync(c1541 ?? "c1541", ["-format", "TEST,01", "d64", disk]).status).toBe(0);
    const r = await reFrameProfile({ prg_path: prg("platformer-scaffold"), model: "pal", cycles: 40_000_000, disk_path: disk, start: "store:$DC0F=$11", stop: "store:$DC0F=$00" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The recipe discards frames in which the KERNAL used timer B for disk I/O (io_frame).
    const inFrame = r.result.samples.filter((s) => s.cycles <= PAL_FRAME).map((s) => s.cycles);
    expect(Math.abs(Math.max(...inFrame) - 8693) / 8693).toBeLessThanOrEqual(TOLERANCE);
  }, 300_000);
});
```

Adjust the `prg(stem)` matcher to the names Step 1 printed. If Step 2 showed the irq-chain slot handlers are reached through one dispatcher (they are: one `$0314` dispatcher walks the table), the `handlers` list has one entry with `entry_lines` {40|41, 130|131, 260|261}; the loop above already accepts that.

- [ ] **Step 4: Run it**

Run: `npx vitest run test/re-calibration.test.ts --reporter=verbose`
Expected: 3 passed, none skipped. Takes minutes (three builds, five VICE runs).

- [ ] **Step 5: Record and commit**

Add to `CHANGELOG.md` under a new entry (follow the file's existing heading format): the three measured figures from Step 2, each committed figure, the difference in cycles and percent, and the tolerance. If `simple_shmup_oscar64`'s recipe has a timer harness, measure it the same way and state the figure as a new measurement, not a calibration; if it has none, say so.

```bash
git add test/re-calibration.test.ts CHANGELOG.md
git commit -m "re: calibrate irq_chain and frame_profile against committed figures

Before any third-party game, the tools must reproduce what this repo already
measured. irq-chain armed lines 40/130/260 exact; falling-blocks worst <N>
vs 6276; platformer worst <N> vs 8693 (differences in CHANGELOG)."
```

Fill `<N>` with the measured numbers before committing.

---

### Task 7: Disassembly reference page (closes #3) and the Regenerator 2000 evaluation

**Files:**
- Create: `docs/toolchains/disassembly-reference.md`
- Read first: `docs/CONVENTIONS-toolchain-reference.md`, `docs/toolchains/cc65-reference.md` (a model page), issue #3 (`gh issue view 3`)

This task is content; use the `add-doc` skill for structure and the `audit-doc` evidence ladder. Every command shown is run here and its output quoted (issue #3 acceptance).

- [ ] **Step 1: Invoke the add-doc skill and read the conventions**

Run the `add-doc` skill for a toolchain-reference page. Note the frontmatter keys and metadata lines it requires.

- [ ] **Step 2: Run and capture each command the page will show**

Into the scratchpad, from this repo's own PRGs (the irq-chain PRG from Task 6) and the ROM images:

```bash
cat > kernal.info <<'INFO'
GLOBAL { STARTADDR $E000; };
LABEL { NAME "irq_dispatch"; ADDR $FF48; };
RANGE { START $FFFA; END $FFFF; TYPE AddrTable; };
INFO
da65 --info kernal.info /opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin | grep -n -A12 "irq_dispatch:" | head -20
da65 --info kernal.info /opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin | tail -5
python3 - <<'EOF'   # the byte census: every reference to $0314 in the KERNAL, with the opcode before it
k=open('/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin','rb').read()
for i in range(1,len(k)-1):
    if k[i]==0x14 and k[i+1]==0x03: print(hex(0xe000+i-1), hex(k[i-1]))
EOF
python3 -c "k=open('/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin','rb').read(); print([hex(k[a-0xe000]|k[a-0xe000+1]<<8) for a in (0xfffa,0xfffc,0xfffe)])"
```

and a `-moncommands` file using `d`, `m`, `bk`/`break`, `trace`, `chis 20`, `prof on`, `prof flat 5`, `save` against the irq-chain PRG, run with the windowless x64sc and `-monlog`. Quote the outputs. Where a command printed nothing (for example `memmapshow` without `--enable-cpuhistory`), say so and link the issue from Task 8.

- [ ] **Step 3: Evaluate Regenerator 2000**

```bash
which regenerator2000 || cargo --version
```

If cargo is present: `cargo install --locked regenerator2000` (or build from https://github.com/ricardoquesada/regenerator2000), run `--headless` on the irq-chain PRG, and compare its code/data split with da65 given an info file built from Task 6's irq_chain handler addresses. If it cannot be installed here, the page says "not installed on the reference machine" and the comparison becomes a line in the Task 8 harness issue. Do not describe its output from its README as if run.

- [ ] **Step 4: Write the page**

Sections, per issue #3: finding a PRG's entry from its BASIC stub (the `readPrg` rule); da65 with info files (`RANGE` types, `LABEL`); the VICE monitor (`d`, `m`, breakpoints, `trace`, `chis`, `prof`, `save`, `-moncommands` + `-monlog` batch mode and its quirks); the ROM tables ($FD30 RAM vectors, $FF81 jump table, $ECB9 VIC table, $E5B6 area named in #3: check each address by reading the bytes before writing it, and correct #3's list if a byte read disagrees); the byte census as a procedure; recognising a packer or loader stub (Unp64, and the first-execute-in-written-memory method, named as external where not run); the two RE tools of Task 5 with a worked call on the irq-chain PRG; tools not installed here (Regenerator 1.x, Infiltrator, JC64dis, SourceGen, Ghidra with ghidra-retro-machines, Retro Debugger) as a table marked external. Rung on every figure.

- [ ] **Step 5: Gates, ingest, commit**

```bash
npm run check:listings -- --file docs/toolchains/disassembly-reference.md
npm run lint && npm test
pgrep -f "ingest" || npm run ingest:clean    # read the summary line: zero dropped references
git add docs/toolchains/disassembly-reference.md
git commit -m "Disassembly reference: da65, the VICE monitor in batch, ROM tables, byte census (closes #3)

No page said how to take a C64 program apart. Every command on the page was
run here against the ROM images or the irq-chain recipe PRG, output quoted;
tools not installed are marked external."
```

---

### Task 8: Issues, versions, landing

**Files:**
- Modify: `VERSION` (`MCP_TOOL_VERSION` minor bump; `KB_DATA_VERSION` +1 for the new page), `package.json` version (minor, together with the tool version), `CHANGELOG.md`

The "VICE headless rebuild with `--enable-cpuhistory`" issue below was not
filed: Task 7 measured that `memmapshow` already works in the current
windowless build when called from a checkpoint after the program has run
(the earlier probe had called it at start-up, before anything executed).

- [ ] **Step 1: File the spec's issues** (each with acceptance criteria and a link to the spec)

```bash
gh issue create --label harness --title "VICE headless rebuild with --enable-cpuhistory for memmap access maps" --body "memmapshow printed nothing in the windowless x64sc 3.10 (docs/toolchains/disassembly-reference.md); the manual requires --enable-cpuhistory, which scripts/build-vice-headless.sh omits. Acceptance: the build script passes the flag; src/services/vice-bin.ts reports whether memmap works (a probe run); memmapshow on the irq-chain PRG lists executed ranges. Spec: docs/superpowers/specs/2026-09-23-reverse-engineering-design.md"
gh issue create --label harness --title "Headless joystick input for RE sessions: VICE event recording and playback" --body "No monitor or binary-protocol command presses a joystick. Evaluate VICE's event history (record, playback) as the input schedule of a session file. Acceptance: a recorded fire press starts a joystick-only test PRG headless, deterministically over three runs. Related: #42. Spec: docs/superpowers/specs/2026-09-23-reverse-engineering-design.md"
gh issue create --label harness --label big-rock --title "Legal scope of game studies: for maintainer review" --body "Studies run lawfully held images to observe, study and test them (EU 2009/24/EC art. 5(3); US Sega v. Accolade), publish facts only, distribute no image, snapshot or disassembly, and never circumvent copy protection (17 USC 1201). Acceptance: the maintainer confirms or amends this statement; it is added to docs/game-design/reference-game-sources.md. Spec: docs/superpowers/specs/2026-09-23-reverse-engineering-design.md"
gh issue create --label big-rock --label content --title "Game study: Gridrunner (pilot step 2)" --body "Session file, c64_re_load_map, c64_re_coverage (targeted), schema 32 (GameDesign kind/studied_from/irq_chain/memory_map, DIVERGES_FROM), study_expression lint, first study page. Every observation cross-checked against https://github.com/mwenge/gridrunner (facts only). Blocked by pilot step 1. Spec: docs/superpowers/specs/2026-09-23-reverse-engineering-design.md"
gh issue create --label big-rock --label content --title "Game study: Uridium (pilot step 3)" --body "Packed: depack transition, epoch-aware coverage, horizontal shmup archetype, first DIVERGES_FROM findings. Cross-check https://github.com/mwenge/uridium (facts only). Blocked by the Gridrunner study. Spec: docs/superpowers/specs/2026-09-23-reverse-engineering-design.md"
gh issue create --label big-rock --label content --title "Game study: Elite (pilot step 4)" --body "Disk with loader, true-drive session, split-screen 3D. Cross-check https://github.com/markmoxon/elite-source-code-commodore-64 (facts only). Blocked by the Uridium study. Spec: docs/superpowers/specs/2026-09-23-reverse-engineering-design.md"
```

Put the new issue numbers into the spec's "Issues to file" table and into the disassembly page where it names the memmap issue.

- [ ] **Step 2: Versions and changelog**

Bump `MCP_TOOL_VERSION` minor (two new tools); `npm version minor --no-git-tag-version` bumps `package.json` and `package-lock.json` together; `KB_DATA_VERSION` +1. Merge `origin/main` first and bump past whatever it holds (memory: merge main first, bump VERSION past it). Add the CHANGELOG entry: the two tools, the calibration figures (from Task 6), the page, the issues.

- [ ] **Step 3: All gates**

```bash
npm run check:listings && npm run typecheck && npm run lint && npm run format:check && npm run knip && npm test
```

Expected: all pass. `npm test` includes the calibration suite where VICE and the toolchains are present; report its pass/skip state.

- [ ] **Step 4: Commit and push**

```bash
git add VERSION package.json package-lock.json CHANGELOG.md docs/superpowers/specs/2026-09-23-reverse-engineering-design.md docs/toolchains/disassembly-reference.md
git commit -m "RE pilot step 1 landed: two calibrated tools, the disassembly page, six issues

MCP tool minor bump for c64_re_irq_chain and c64_re_frame_profile; figures
and differences in CHANGELOG; follow-ups filed as issues."
git push origin HEAD
```
