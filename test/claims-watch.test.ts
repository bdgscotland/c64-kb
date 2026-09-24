import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { HARDWARE_UNITS } from "../src/graph/claims.ts";
import { Declared } from "../scripts/lib/claims-declared.ts";
import {
  kernalMaySets,
  labeller,
  loadTechniqueClaims,
  readLabels,
  readPrg,
  recipeFrontmatter,
  withPrerequisites,
} from "../scripts/lib/claims-sources.ts";
import {
  BASIC_READY,
  ClaimsWatch,
  feedLog,
  isPush,
  parseHit,
  portRmwValue,
  storedValue,
  touchedUnits,
} from "../scripts/lib/claims-trace.ts";
import { buildUnitMap, CpuPort, parseRanges, sourceOf } from "../scripts/lib/claims-units.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

// scripts/claims-watch.ts (#22 step 6): the unit map read from the
// HardwareUnit seed, the log parser, attribution by PC and banking, and the
// verdicts. The last block runs VICE and skips without it.
const root = join(import.meta.dirname, "..");
const { map, screen } = buildUnitMap();
const unitsAt = (a: number) => (map.get(a) ?? []).map((o) => `${o.unit}:${o.mask.toString(16)}`);

describe("unit map from the HardwareUnit seed", () => {
  it("maps whole registers, shared bits and vectors", () => {
    expect(unitsAt(0xd407)).toEqual(["sid_voice_2:ff"]);
    expect(unitsAt(0xd418)).toEqual(["sid_filter_volume:ff"]);
    expect(unitsAt(0xd015)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `sprite_${n}:${(1 << n).toString(16)}`),
    );
    expect(unitsAt(0xd006)).toEqual(["sprite_3:ff"]);
    expect(unitsAt(0xd02a)).toEqual(["sprite_3:ff"]);
    // #71: the scroll and pointer fields are units of their own.
    expect(unitsAt(0xd011)).toEqual(["vic_raster_irq:80", "vic_yscroll:7"]);
    expect(unitsAt(0xd016)).toEqual(["vic_xscroll:7"]);
    expect(unitsAt(0xd018)).toEqual(["vic_matrix_base:f0", "vic_char_base:e"]);
    expect(unitsAt(0xd012)).toEqual(["vic_raster_irq:ff"]);
    expect(unitsAt(0xd019)).toEqual(["vic_raster_irq:1"]);
    expect(unitsAt(0xdd00)).toEqual(["cia2_vic_bank:3", "serial_bus:f8"]);
    expect(unitsAt(0xdc0e)).toEqual(["cia1_timer_a:ff"]);
    expect(unitsAt(0xdc0d)).toEqual(["cia1_timer_a:1", "cia1_timer_b:2", "cia1_tod:4"]);
    expect(unitsAt(0xdd0d)).toEqual(["cia2_timer_a:1", "cia2_timer_b:2", "cia2_tod:4"]);
    expect(unitsAt(0xdc00)).toEqual(["cia1_port_a:ff"]);
    expect(unitsAt(0x0315)).toEqual(["irq_vector_0314:ff"]);
    expect(unitsAt(0xffff)).toEqual(["irq_vector_fffe:ff"]);
    expect(unitsAt(0xd020)).toEqual([]);
  });

  it("places every unit but zero_page, the sprite pointers apart", () => {
    const placed = new Set([...map.values()].flat().map((o) => o.unit));
    for (const s of screen) placed.add(s.unit);
    const expected = HARDWARE_UNITS.filter((u) => u.kind !== "zero_page").map((u) => u.name);
    expect([...placed].sort()).toEqual([...expected].sort());
    expect(screen.find((s) => s.unit === "sprite_7")?.offset).toBe(0x3ff);
  });
});

describe("the log parser", () => {
  const store = parseHit(
    "#1 (Trace store 00fb)   41/$029,  62/$3e",
    ".C:0819  86 FB       STX $FB        - A:FF X:12 Y:00 SP:f6 ..-..I..    3049325",
  );
  it("reads a store hit", () => {
    expect(store).toMatchObject({
      kind: "store",
      addr: 0xfb,
      pc: 0x0819,
      mnemonic: "STX",
      x: 0x12,
      clock: 3049325,
    });
  });
  it("values STA, STX, STY and leaves a read-modify-write unknown", () => {
    expect(store && storedValue(store)).toBe(0x12);
    expect(store && storedValue({ ...store, mnemonic: "STA" })).toBe(0xff);
    expect(store && storedValue({ ...store, mnemonic: "INC" })).toBeNull();
  });
  it("values a read-modify-write on the 6510 port from the byte it read", () => {
    const rmw = (mnemonic: string, read: number | null, flags = "..-..I..") =>
      store && portRmwValue({ ...store, mnemonic, flags }, read);
    expect(store?.flags).toBe("..-..I..");
    expect(rmw("DEC", 0x37)).toBe(0x36);
    expect(rmw("DCP", 0x37)).toBe(0x36);
    expect(rmw("INC", 0xff)).toBe(0x00);
    expect(rmw("ASL", 0x9b)).toBe(0x36);
    expect(rmw("LSR", 0x6f)).toBe(0x37);
    expect(rmw("ROR", 0x6f, "N.-..I.C")).toBe(0xb7);
    expect(rmw("ROL", 0x37)).toBeNull(); // the carry into bit 0 is not logged
    expect(rmw("ROL", 0x80, "..-..IZC")).toBe(0);
    expect(rmw("DEC", null)).toBeNull();
  });
  it("reads an exec hit, which VICE logs with two spaces", () => {
    const exec = parseHit(
      "#4 (Trace  exec 080e)  208/$0d0,  52/$34",
      ".C:080e  A9 FF       LDA #$FF       - A:00 X:00 Y:00 SP:f6 ..-.....    3169590",
    );
    expect(exec).toMatchObject({ kind: "exec", addr: 0x080e });
  });
  it("tells a push from a store to page 1 by SP after the instruction", () => {
    const pha = parseHit(
      "#1 (Trace store 01f6)   42/$02a,   2/$02",
      ".C:081b  48          PHA            - A:FF X:12 Y:00 SP:f5 ..-..I..    3049328",
    );
    const table = parseHit(
      "#1 (Trace store 0100)   83/$053,  51/$33",
      ".C:0900  9D 00 01    STA $0100,X    - A:00 X:00 Y:FE SP:f6 N.-..I.C       5280",
    );
    expect(pha && isPush(pha)).toBe(true);
    expect(table && isPush(table)).toBe(false);
    // SP $FE after a JSR: the pushes were $01FF and $0100 (wrapped).
    expect(isPush({ ...pha!, addr: 0x0100, sp: 0xfd })).toBe(true);
  });
  it("counts a JSR's pushes as pushes when an interrupt is taken straight after it", () => {
    // VICE logged the JSR's two bytes and the IRQ's three with SP:E9.
    const jsr = parseHit(
      "#1 (Trace store 01ee)  212/$0d4,  10/$0a",
      ".C:30a0  20 8B 2A    JSR $2A8B      - A:00 X:00 Y:00 SP:e9 ..-..I..   23089514",
    );
    expect(jsr && isPush(jsr)).toBe(true);
    expect(isPush({ ...jsr!, addr: 0x01ed })).toBe(true);
    expect(isPush({ ...jsr!, addr: 0x01ef })).toBe(false);
    // A PHA reaches one byte past the interrupt's three, a store none.
    expect(isPush({ ...jsr!, mnemonic: "PHA", addr: 0x01ed })).toBe(true);
    expect(isPush({ ...jsr!, mnemonic: "PHA", addr: 0x01ee })).toBe(false);
    expect(isPush({ ...jsr!, mnemonic: "STA", addr: 0x01ed })).toBe(false);
  });
});

describe("bits touched on a shared register", () => {
  it("counts the bits a store changes", () => {
    expect(touchedUnits(map, 0xd015, 0x03, 0x01)).toEqual(["sprite_1"]);
    expect(touchedUnits(map, 0xd015, 0x01, 0x01)).toEqual([]);
    expect(touchedUnits(map, 0xd015, 0x01, undefined)).toHaveLength(8);
    expect(touchedUnits(map, 0xd015, null, 0x01)).toHaveLength(8);
    expect(touchedUnits(map, 0xd011, 0x1b, 0x9b)).toEqual(["vic_raster_irq"]);
    expect(touchedUnits(map, 0xd011, 0x1b, 0x1b)).toEqual([]);
    // FLD's per-line store changes YSCROLL only; sideborder's DEC $D016 ($C8 -> $C7) changes XSCROLL and CSEL.
    expect(touchedUnits(map, 0xd011, 0x1c, 0x1b)).toEqual(["vic_yscroll"]);
    expect(touchedUnits(map, 0xd016, 0xc7, 0xc8)).toEqual(["vic_xscroll"]);
    expect(touchedUnits(map, 0xd016, 0xc0, 0xc8)).toEqual([]);
    expect(touchedUnits(map, 0xd018, 0x35, 0x15)).toEqual(["vic_matrix_base"]);
  });
  it("reads $D019 as acknowledge: a 1 bit touches its source", () => {
    expect(touchedUnits(map, 0xd019, 0x01, 0x01)).toEqual(["vic_raster_irq"]);
    expect(touchedUnits(map, 0xd019, 0x02, undefined)).toEqual([]);
  });
  it("reads a CIA ICR write by the sources named in bits 0-4, set or clear", () => {
    expect(touchedUnits(map, 0xdc0d, 0x7f, 0x7f)).toEqual(["cia1_timer_a", "cia1_timer_b", "cia1_tod"]);
    expect(touchedUnits(map, 0xdc0d, 0x81, undefined)).toEqual(["cia1_timer_a"]);
    expect(touchedUnits(map, 0xdd0d, 0x02, undefined)).toEqual(["cia2_timer_b"]);
    expect(touchedUnits(map, 0xdd0d, 0x18, undefined)).toEqual([]);
  });
});

describe("attribution by PC and the 6510 port", () => {
  it("reads ROM as mapped in by the port's banking bits", () => {
    const port = new CpuPort();
    expect(sourceOf(0xea31, port)).toBe("kernal");
    expect(sourceOf(0xa474, port)).toBe("basic");
    expect(sourceOf(0x0810, port)).toBe("program");
    port.store(1, 0x35); // KERNAL and BASIC out, I/O in
    expect(sourceOf(0xea31, port)).toBe("program");
    expect(sourceOf(0xa474, port)).toBe("program");
    expect(port.io).toBe(true);
    port.store(1, 0x34); // all RAM
    expect(port.io).toBe(false);
    expect(port.read(1)).toBe(0x34); // input bit 4 reads 1, bits 6-7 0
    port.store(1, null);
    expect(sourceOf(0xea31, port)).toBe("unknown");
    expect(sourceOf(0xa474, port)).toBe("unknown");
    expect(sourceOf(0xc000, port)).toBe("program");
  });
});

describe("declarations", () => {
  it("parses ranges and refuses a backwards one", () => {
    expect(parseRanges("screen=$0400-$07FF, d800")).toEqual([
      { name: "screen", first: 0x400, last: 0x7ff },
      { name: "$D800", first: 0xd800, last: 0xd800 },
    ]);
    expect(parseRanges("$0800-$0400")).toHaveProperty("error");
  });
  it("judges units by mode and harness", () => {
    const d = new Declared();
    expect(d.addClaimText("sid_voice_2 (shares), cia1_port_b (reads), zero_page $FB-$FE", "t")).toBeNull();
    expect(d.addHarness("cia2_timer_b, stats=$C000-$C0FF, zero_page $20-$21")).toBeNull();
    expect(d.unitVerdict("sid_voice_2")).toBe("claimed");
    expect(d.unitVerdict("cia1_port_b")).toBe("reads_only");
    expect(d.unitVerdict("cia2_timer_b")).toBe("harness");
    expect(d.unitVerdict("sid_voice_1")).toBe("undeclared");
    expect(d.ramVerdict(0xfc).verdict).toBe("claimed");
    expect(d.ramVerdict(0x20).verdict).toBe("harness");
    expect(d.ramVerdict(0xc010)).toEqual({ verdict: "harness", by: "stats" });
    expect(d.ramVerdict(0x02).verdict).toBe("undeclared");
    expect(d.addHarness("not_a_unit")).toMatch(/not a hardware unit/);
  });
});

describe("sources read from the docs", () => {
  const all = loadTechniqueClaims(root);
  it("reads a technique's Claims line and its prerequisites", () => {
    expect(all.get("sfx_engine_beside_music")?.claims).toEqual([{ unit: "sid_voice_2", mode: "shares" }]);
    expect(withPrerequisites(["sfx_engine_beside_music"], all)).toContain("sid_play_routine_pattern");
    expect(all.get("sprite_multiplex_game")?.claims?.map((c) => c.unit)).toContain("vic_raster_irq");
  });
  it("reads the KERNAL may-sets, the IRQ service included", () => {
    const may = kernalMaySets(root);
    expect(may.get("SETLFS")).toEqual([[0xb8, 0xba]]);
    expect(may.get("IRQ")?.some(([a, b]) => a <= 0x91 && 0x91 <= b)).toBe(true);
    expect(may.has("NMI")).toBe(true);
  });
  it("reads a recipe's frontmatter", () => {
    const fm = recipeFrontmatter("---\ntechniques: [a_b, c]\nuses_kernal: [CHROUT]\n---\n");
    expect(fm).toEqual({ techniques: ["a_b", "c"], usesKernal: ["CHROUT"] });
  });
  it("reads the SYS address of a BASIC stub and both label formats", () => {
    // 10 SYS 2062
    const stub = [0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, ...Buffer.from("2062"), 0, 0, 0, 0x60];
    const bytes = Uint8Array.from(stub);
    expect(readPrg(bytes)).toEqual({
      load: 0x0801,
      end: 0x0801 + stub.length - 3,
      sys: 2062,
      bytes,
    });
    const labels = readLabels(".label start=$80e\nal C:0820 .irq\nal 00f7 .ZeroEnd\n");
    expect([...labels]).toEqual([
      [0x80e, "start"],
      [0x820, "irq"],
      [0xf7, "ZeroEnd"],
    ]);
    expect(labeller(labels)(0x823)).toBe("$0823 (irq+3)");
  });
});

// A log cut to the shape x64sc writes: boot store, entry, program stores,
// a push, the KERNAL IRQ, then BASIC's READY and what follows it.
const LOG = [
  "#1 (Trace store d015)    1/$001,   1/$01",
  ".C:e5ad  9D FF CF    STA $CFFF,X    - A:00 X:16 Y:FF SP:f9 ..-..IZ.    2004576",
  "#9 (Trace  exec 080e)   41/$029,  40/$28",
  ".C:080e  78          SEI            - A:00 X:00 Y:00 SP:f6 ..-..I..    3049300",
  "#2 (Trace store d015)   41/$029,  51/$33",
  ".C:0811  8D 15 D0    STA $D015      - A:01 X:00 Y:00 SP:f6 ..-..I..    3049314",
  "#2 (Trace store d40b)   41/$029,  55/$37",
  ".C:0814  8D 0B D4    STA $D40B      - A:21 X:00 Y:00 SP:f6 ..-..I..    3049318",
  "#1 (Trace store 00fb)   41/$029,  62/$3e",
  ".C:0819  86 FB       STX $FB        - A:21 X:12 Y:00 SP:f6 ..-..I..    3049325",
  "#1 (Trace store 01f6)   42/$02a,   2/$02",
  ".C:081b  48          PHA            - A:21 X:12 Y:00 SP:f5 ..-..I..    3049328",
  "#1 (Trace store 00a2)   42/$02a,  10/$0a",
  ".C:f6a0  E6 A2       INC $A2        - A:21 X:12 Y:00 SP:ef ..-..I..    3049340",
  "#1 (Trace store 00fb)   42/$02a,  20/$14",
  ".C:f6b0  85 FB       STA $FB        - A:21 X:12 Y:00 SP:ef ..-..I..    3049350",
  `#9 (Trace  exec ${BASIC_READY.toString(16)})   50/$032,   1/$01`,
  ".C:a474  A9 76       LDA #$76       - A:76 X:12 Y:00 SP:f6 ..-..I..    3100000",
  "#1 (Trace store 009d)   50/$032,  21/$15",
  ".C:fe18  85 9D       STA $9D        - A:80 X:00 Y:0A SP:f9 N.-B....    3100010",
];

describe("the watch over a log", () => {
  const watchWith = (claims: string, kernal: [string, [number, number][]][]) => {
    const d = new Declared();
    expect(d.addClaimText(claims, "test")).toBeNull();
    for (const [name, bytes] of kernal) d.addKernal(name, bytes);
    const w = new ClaimsWatch({ units: map, screen, declared: d, start: 0x080e });
    feedLog(w, LOG);
    return w;
  };
  const verdicts = (w: ClaimsWatch) =>
    [...w.tallies.values()].map((t) => `${t.finding.verdict} ${t.finding.source} ${t.finding.target}`).sort();

  it("drops boot stores, pushes and everything after READY, and judges the rest", () => {
    const w = watchWith("sprite_0", [["IRQ", [[0xa0, 0xa2]]]]);
    expect(w.bootStores).toBe(1);
    expect(w.pushes).toBe(1);
    expect(w.afterExit).toBe(1);
    expect(w.startClock).toBe(3049300);
    expect(verdicts(w)).toEqual([
      "claimed program sprite_0",
      "kernal_in_may kernal zero page",
      "kernal_outside_may kernal zero page",
      "undeclared program sid_voice_2",
      "undeclared program zero page",
    ]);
    expect(w.violations()).toHaveLength(3);
  });

  it("passes once the voice, the byte and the KERNAL's store are declared", () => {
    const w = watchWith("sprite_0, sid_voice_2 (shares), zero_page $FB", [
      [
        "IRQ",
        [
          [0xa0, 0xa2],
          [0xfb, 0xfb],
        ],
      ],
    ]);
    expect(w.violations()).toEqual([]);
  });

  // After READY: the program's IRQ stores are judged, the KERNAL's dropped.
  const irqAfterReady = [
    "#1 (Trace store d40b)   60/$03c,   5/$05",
    ".C:0830  8D 0B D4    STA $D40B      - A:21 X:00 Y:00 SP:f0 ..-..I..    3200000",
    "#1 (Trace store 00a2)   60/$03c,  15/$0f",
    ".C:ea34  E6 A2       INC $A2        - A:21 X:00 Y:00 SP:f0 ..-..I..    3200010",
  ];

  it("judges the program's stores after READY and drops the ROM's", () => {
    const w = new ClaimsWatch({ units: map, screen, declared: new Declared(), start: 0x080e });
    feedLog(w, [...LOG, ...irqAfterReady]);
    expect(w.endClock).toBe(3100000);
    expect(w.afterExit).toBe(2);
    const voice = [...w.tallies.values()].find((t) => t.finding.target === "sid_voice_2");
    expect(voice?.count).toBe(2);
    expect(voice?.finding.verdict).toBe("undeclared");
  });

  it("takes $A474 as READY only with BASIC ROM mapped in, and follows DEC $01", () => {
    const w = new ClaimsWatch({ units: map, screen, declared: new Declared(), start: 0x080e });
    feedLog(w, [
      LOG[2] ?? "",
      LOG[3] ?? "",
      "#1 (Trace store 0001)   41/$029,  45/$2d",
      ".C:0810  C6 01       DEC $01        - A:00 X:00 Y:00 SP:f6 ..-..I..    3049305",
      `#9 (Trace  exec ${BASIC_READY.toString(16)})   41/$029,  50/$32`,
      ".C:a474  A9 21       LDA #$21       - A:21 X:00 Y:00 SP:f6 ..-..I..    3049310",
      "#1 (Trace store d40b)   41/$029,  54/$36",
      ".C:a476  8D 0B D4    STA $D40B      - A:21 X:00 Y:00 SP:f6 ..-..I..    3049314",
    ]);
    expect(w.port.port).toBe(0x36);
    expect(w.endClock).toBeNull();
    expect(w.violations().map((t) => `${t.finding.source} ${t.finding.target}`)).toEqual([
      "program sid_voice_2",
    ]);
  });

  it("fails a store from a ROM window while $01 is unknown", () => {
    const w = new ClaimsWatch({ units: map, screen, declared: new Declared(), start: 0x080e });
    feedLog(w, [
      LOG[2] ?? "",
      LOG[3] ?? "",
      "#1 (Trace store 0001)   41/$029,  45/$2d",
      ".C:0810  26 01       ROL $01        - A:00 X:00 Y:00 SP:f6 ..-..I..    3049305",
      "#1 (Trace store d40b)   41/$029,  54/$36",
      ".C:a002  8D 0B D4    STA $D40B      - A:21 X:00 Y:00 SP:f6 ..-..I..    3049314",
    ]);
    expect(w.unknownBanking).toBe(1);
    expect(w.violations().map((t) => `${t.finding.verdict} ${t.finding.source} ${t.finding.target}`)).toEqual(
      ["unattributed unknown sid_voice_2"],
    );
  });

  it("with no entry address, starts at the first store from outside ROM", () => {
    const w = new ClaimsWatch({ units: map, screen, declared: new Declared() });
    feedLog(w, LOG);
    expect(w.startClock).toBe(3049314);
  });
});

// The script end to end: assemble a program that writes one declared and
// two undeclared things, run it in VICE, read the exit code and the report.
const x64sc = resolveX64sc();
const tools = findToolchains();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;
if (!canRun)
  console.warn("claims-watch.test: no windowless x64sc or no KickAssembler; the VICE run is skipped");

describe.skipIf(!canRun)("claims-watch in VICE", () => {
  const ASM = [
    "BasicUpstart2(start)",
    "start:",
    "    sei",
    "    lda #$01",
    "    sta $d015          // sprite 0: declared",
    "    lda #$21",
    "    sta $d40b          // voice 2 control: not declared",
    "    sta $fb            // zero page: not declared",
    "loop: jmp loop",
  ].join("\n");

  const run = (extra: string[]) => {
    const work = mkdtempSync(join(tmpdir(), "claims-watch-test-"));
    try {
      writeFileSync(join(work, "t.asm"), ASM);
      const asm = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
        cwd: work,
        encoding: "utf8",
      });
      expect(asm.status).toBe(0);
      return spawnSync(
        process.execPath,
        [join(root, "scripts/claims-watch.ts"), join(work, "t.prg"), "--cycles", "4000000", ...extra],
        { encoding: "utf8", timeout: 120_000 },
      );
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  };

  it("fails on the undeclared voice and byte, and names them", () => {
    const r = run(["--claim", "sprite_0"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/\| undeclared \| sid_voice_2 \| \$D40B \|/);
    expect(r.stdout).toMatch(/\| undeclared \| zero page \| \$FB \|/);
    expect(r.stdout).not.toMatch(/undeclared \| sprite_0/);
  }, 120_000);

  it("passes when they are declared", () => {
    const r = run(["--claim", "sprite_0, sid_voice_2, zero_page $FB"]);
    expect(r.stdout).toMatch(/^PASS/m);
    expect(r.status).toBe(0);
  }, 120_000);
});
