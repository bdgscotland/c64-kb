import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGION_TIMING } from "../src/domain/timing.ts";
import { analyseIrqChain } from "../src/re/irq-chain.ts";
import { parseHit, type Hit } from "../src/re/monlog.ts";
import {
  inPlayClock,
  inPlayCommand,
  injectCommands,
  MonitorScript,
  SessionSchema,
  sessionScript,
  type Session,
} from "../src/re/session.ts";
import { batchOf, loadSession, reSession, runSession, screenshotPath } from "../src/tools/re-session.ts";
import { reFrameProfile, reIrqChain } from "../src/tools/re.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findC1541, findToolchains } from "../scripts/lib/toolchains.ts";

const base = {
  image: {
    sha1: "b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f",
    kind: "d64",
    file: "commando",
    title: "Commando",
  },
  machine: { model: "pal" },
  inject: [{ at_pc: "$0FB5", after_hits: 1000, set: { a: "$6F" }, why: "title waits for fire" }],
  in_play: { check: "exec", pc: "$4134", after_clock: 36_000_000 },
  limitcycles: 60_000_000,
};
const session = (over: Record<string, unknown> = {}): Session => SessionSchema.parse({ ...base, ...over });

describe("session file", () => {
  it("parses the Commando shape with decimal numbers", () => {
    const s = session();
    expect(s.inject[0]?.after_hits).toBe(1000);
    expect(s.machine.model).toBe("pal");
  });
  it("refuses a bad sha1, a non-hex PC, a negative hit count, a register other than a/x/y, no in_play", () => {
    const bad = [
      { image: { ...base.image, sha1: "b2ca4794" } },
      { inject: [{ ...base.inject[0], at_pc: "fire" }] },
      { inject: [{ ...base.inject[0], after_hits: -1 }] },
      { inject: [{ ...base.inject[0], set: { p: "$00" } }] },
      { inject: [{ ...base.inject[0], set: { a: "$100" } }] },
      { in_play: undefined },
      { machine: { model: "c64c" } },
    ];
    for (const b of bad)
      expect(SessionSchema.safeParse({ ...base, ...b }).success, JSON.stringify(b)).toBe(false);
  });
  it("loads the committed Commando session and refuses a path outside the sessions directory", () => {
    const ok = loadSession("docs/game-design/studies/sessions/commando.json");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.session.image.sha1).toBe("b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f");
      expect(ok.session.inject[0]).toMatchObject({ at_pc: "$0FB5", after_hits: 1000, set: { a: "$6F" } });
    }
    const outside = loadSession("package.json");
    const missing = loadSession("docs/game-design/studies/sessions/none.json");
    expect(outside).toMatchObject({ ok: false, reason: "session" });
    if (!outside.ok && !missing.ok)
      expect(outside.error.replace("package.json", "X")).toBe(
        missing.error.replace("docs/game-design/studies/sessions/none.json", "X"),
      );
    expect(loadSession("docs/game-design/studies/sessions/none.json")).toMatchObject({
      ok: false,
      reason: "session",
    });
    expect(loadSession("docs/game-design/studies/sessions/../../../../package.json")).toMatchObject({
      ok: false,
      reason: "session",
    });
  });
});

describe("monitor commands", () => {
  it("writes hit counts to the monitor as hex: 1000 is ignore N 3e8", () => {
    expect(injectCommands(session(), 3)).toBe('trace exec 0fb5 0fb5\nignore 3 3e8\ncommand 3 "r a = 6f"\n');
  });
  it("writes no ignore line for after_hits 0, and one command per register", () => {
    const s = session({ inject: [{ at_pc: "$C000", after_hits: 0, set: { a: "$01", x: "$2" }, why: "t" }] });
    expect(injectCommands(s, 1)).toBe('trace exec c000 c000\ncommand 1 "r a = 01, x = 02"\n');
  });
  it("traces the in-play PC", () => {
    expect(inPlayCommand(session())).toBe("trace exec 4134 4134\n");
  });
});

describe("MonitorScript: one numbering for every session-driven run", () => {
  it("numbers injections from 1, then in_play, then the tool's checkpoints in creation order", () => {
    const s = session({
      inject: [
        { at_pc: "$0FB5", after_hits: 1000, set: { a: "$6F" }, why: "fire" },
        { at_pc: "$1000", after_hits: 2, set: { x: "$00" }, why: "t" },
      ],
    });
    const m = sessionScript(s);
    m.add("trace store 0314 0319\ntrace exec 0940 0940\n");
    const n = m.checkpoint("trace exec 2000 2000", (k) => [`command ${k} "bank ram"`]);
    expect(n).toBe(6);
    expect(m.text()).toBe(
      [
        "trace exec 0fb5 0fb5",
        "ignore 1 3e8",
        'command 1 "r a = 6f"',
        "trace exec 1000 1000",
        "ignore 2 2",
        'command 2 "r x = 00"',
        "trace exec 4134 4134",
        "trace store 0314 0319",
        "trace exec 0940 0940",
        "trace exec 2000 2000",
        'command 6 "bank ram"',
        "",
      ].join("\n"),
    );
  });
  it("shares the in_play checkpoint with an identical tool line, never an injection's", () => {
    const m = sessionScript(session());
    expect(m.checkpoint("trace exec 4134 4134")).toBe(2);
    expect(m.checkpoint("trace exec 0fb5 0fb5")).toBe(3);
    expect(
      m
        .text()
        .split("\n")
        .filter((l) => l === "trace exec 4134 4134"),
    ).toHaveLength(1);
  });
  it("drops the hits of checkpoints only the session asked for", () => {
    const m = sessionScript(session());
    m.checkpoint("trace exec 4134 4134");
    m.checkpoint("trace store 0314 0314");
    const h = (checkpoint: number, addr: number) => ({ ...hit("exec", addr, 1), checkpoint });
    expect(m.toolHits([h(1, 0x0fb5), h(2, 0x4134), h(3, 0x0314)]).map((x) => x.checkpoint)).toEqual([2, 3]);
  });
  it("never shares a checkpoint whose lines name its number, with the session's or any other", () => {
    const s = session({ in_play: { check: "exec", pc: "$0FEB", after_clock: 0 } });
    const m = sessionScript(s);
    const n = m.checkpoint("trace exec 0feb 0feb", (k) => [`ignore ${k} a`]);
    expect(n).toBe(3);
    expect(m.checkpoint("trace exec 0feb 0feb")).toBe(2);
    const t = m.checkpoint("trace exec 2000 2000", (k) => [`command ${k} "r a = 00"`]);
    expect(m.checkpoint("trace exec 2000 2000")).not.toBe(t);
    expect(m.text()).toContain("trace exec 0feb 0feb\nignore 3 a\n");
    expect(m.text().match(/^trace exec 0feb 0feb$/gm)).toHaveLength(2);
  });
  it("refuses a line in a block that names a checkpoint number or creates one in a form it cannot count", () => {
    for (const bad of [
      "ignore 1 10",
      'command 2 "r a = 00"',
      "delete 1",
      "disable 3",
      "until 0813",
      "tr exec 0815 0815",
      "bk 1000",
      "w store 1000",
      "un 0813",
    ]) {
      const m = sessionScript(session());
      expect(() => {
        m.add(bad + "\n");
      }, bad).toThrow(/checkpoint/);
    }
  });
  it("a script without a session numbers from 1", () => {
    const m = new MonitorScript();
    expect(m.checkpoint("break exec 1000 1000")).toBe(1);
  });
});

const hit = (kind: Hit["kind"], addr: number, clock: number, over: Partial<Hit> = {}): Hit => ({
  kind,
  addr,
  pc: addr,
  mnemonic: "STA",
  operand: "",
  a: 0,
  x: 0,
  y: 0,
  sp: 0xf6,
  flags: "",
  clock,
  line: 10,
  cycle: 5,
  ...over,
});

describe("in-play clock", () => {
  it("is the first exec of in_play.pc at or after after_clock", () => {
    const s = session();
    const hits = [
      hit("exec", 0x4134, 1_000),
      hit("exec", 0x4134, 36_000_100),
      hit("exec", 0x4134, 36_020_000),
    ];
    expect(inPlayClock(hits, s)).toBe(36_000_100);
  });
  it("is null when the PC never ran after the clock, or ran only as a store", () => {
    const s = session();
    expect(inPlayClock([hit("exec", 0x4134, 1_000), hit("store", 0x4134, 40_000_000)], s)).toBeNull();
  });
});

describe("the log keeps each hit's checkpoint number", () => {
  it("reads #N", () => {
    const h = parseHit(
      "#3 (Trace  exec 0816)   40/$028,  45/$2d",
      ".C:0816  EE 20 D0    INC $D020      - A:6F X:00 Y:00 SP:f6 ..-..IZC    2970621",
    );
    expect(h?.checkpoint).toBe(3);
  });
});

describe("an injection's exec is never a handler entry", () => {
  it("an exec at an address no vector holds, inside an interrupt's dispatch window, is not counted", () => {
    const t = REGION_TIMING.PAL;
    const push = (clock: number, addr: number, sp: number) =>
      hit("store", addr, clock, { sp, mnemonic: "PHA" });
    const hits = [
      hit("store", 0x0314, 100, { a: 0x40, mnemonic: "STA" }),
      hit("store", 0x0315, 101, { a: 0x09, mnemonic: "STA" }),
      push(1000, 0x01f6, 0xf3),
      push(1000, 0x01f5, 0xf3),
      push(1000, 0x01f4, 0xf3),
      hit("exec", 0x0813, 1010, { mnemonic: "CMP" }),
      hit("exec", 0x0940, 1030, { mnemonic: "LDA" }),
    ];
    const r = analyseIrqChain(hits, t, 50);
    expect(r.handlers.map((x) => x.handler)).toEqual([0x0940]);
    expect(r.entries.map((e) => e.handler)).toEqual([0x0940]);
  });
});

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

/** The fixture PRG, a manifest naming it by sha1, and a session for it. */
function fixture(): { manifest: string; sha1: string } {
  const dir = mkdtempSync(join(tmpdir(), "re-session-"));
  copyFileSync(join(import.meta.dirname, "fixtures", "re", "title-fire.asm"), join(dir, "t.asm"));
  const built = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
    cwd: dir,
  });
  expect(built.status).toBe(0);
  const prg = join(dir, "t.prg");
  const sha1 = createHash("sha1").update(readFileSync(prg)).digest("hex");
  const manifest = join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ [sha1]: { path: prg, title: "title-fire" } }));
  return { manifest, sha1 };
}

/** Every VICE test writes its exit screenshots to a temp directory, never data/re/. */
const shots = mkdtempSync(join(tmpdir(), "re-session-shots-"));
const opts = (manifestPath?: string) => ({ ...(manifestPath ? { manifestPath } : {}), shotDir: shots });

const fixtureSession = (sha1: string, inject: unknown[]): Session =>
  SessionSchema.parse({
    image: { sha1, kind: "prg", title: "title-fire" },
    machine: { model: "pal" },
    inject,
    in_play: { check: "exec", pc: "$0900", after_clock: 0 },
    limitcycles: 4_000_000,
  });
const FIRE = { at_pc: "$0813", after_hits: 1000, set: { a: "$6F" }, why: "title waits for fire: CMP #$6F" };

describe.skipIf(!canRun)("c64_re_session in VICE, on a title that waits for fire", () => {
  const f = canRun ? fixture() : { manifest: "", sha1: "" };

  it("injects A = $6F at the CMP after 1000 polls and reaches the play PC", async () => {
    const r = await runSession(fixtureSession(f.sha1, [FIRE]), "t", opts(f.manifest));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const fired = r.result.injections[0]?.fired_at_clock ?? null;
    expect(fired).not.toBeNull();
    expect(r.result.play_clock).toBeGreaterThan(fired ?? 0);
    // CMP, BNE not taken, JMP play: 2 + 2 + 3 cycles after the CMP's fetch.
    expect(r.result.play_clock - (fired ?? 0)).toBe(7);
    expect(r.result.play_frame).toBe(Math.floor(r.result.play_clock / REGION_TIMING.PAL.cycles_per_frame));
    expect(existsSync(r.result.screenshot)).toBe(true);
    expect(r.result.unknowns).toEqual([]);
  }, 120_000);

  it("lists an injection at an address never run in unknowns, and in_play still decides", async () => {
    const never = { at_pc: "$C000", after_hits: 0, set: { a: "$00" }, why: "never runs" };
    const r = await runSession(fixtureSession(f.sha1, [FIRE, never]), "t", opts(f.manifest));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.injections[1]).toEqual({ at_pc: "$C000", fired_at_clock: null });
    expect(r.result.unknowns).toContain("injection at $C000 never fired");
  }, 120_000);

  it("refuses not-in-play with the clock reached and an exit screenshot when nothing presses fire", async () => {
    const r = await runSession(fixtureSession(f.sha1, []), "t", opts(f.manifest));
    expect(r).toMatchObject({ ok: false, reason: "not-in-play", clock: 4_000_000 });
    if (!r.ok) expect(existsSync(r.screenshot ?? "")).toBe(true);
  }, 120_000);

  it("c64_re_irq_chain with a session: the raster handler in play, never the injection or in_play PC", async () => {
    const r = await reIrqChain(
      { session: fixtureSession(f.sha1, [FIRE]), model: "pal", cycles: 4_000_000 },
      opts(f.manifest),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const handlers = r.result.handlers.map((h) => h.handler);
    expect(handlers).toContain(0x0940);
    expect(handlers).not.toContain(0x0813);
    expect(handlers).not.toContain(0x0900);
    expect(
      r.result.handlers.find((h) => h.handler === 0x0940)?.entry_lines.every((l) => l === 100 || l === 101),
    ).toBe(true);
    expect(r.run.start_clock).toBeGreaterThan(0);
    expect(r.run.prg).toBe("(inline session)");
  }, 180_000);
});

describe.skipIf(!canRun)("the fixture's title exit is play only after fire", () => {
  const f = canRun ? fixture() : { manifest: "", sha1: "" };
  const exit = (inject: unknown[]) =>
    SessionSchema.parse({
      ...fixtureSession(f.sha1, inject),
      in_play: { check: "exec", pc: "$0817", after_clock: 0 },
    });
  it("is not reached without the injection: not-in-play", async () => {
    expect(await runSession(exit([]), "t", opts(f.manifest))).toMatchObject({
      ok: false,
      reason: "not-in-play",
    });
  }, 120_000);
  it("is reached 4 cycles after the injection fires (CMP 2, BNE not taken 2)", async () => {
    const r = await runSession(exit([FIRE]), "t", opts(f.manifest));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.result.play_clock - (r.result.injections[0]?.fired_at_clock ?? 0)).toBe(4);
  }, 120_000);
});

const c1541 = findC1541();

describe.skipIf(!canRun || c1541 === null)("a D64 session", () => {
  it("reads the file from the disk, attaches the disk's working copy as drive 8, and reaches play", async () => {
    const dir = mkdtempSync(join(tmpdir(), "re-session-d64-"));
    copyFileSync(join(import.meta.dirname, "fixtures", "re", "title-fire.asm"), join(dir, "t.asm"));
    const java = spawnSync(tools.java ?? "java", ["-jar", tools.kickass ?? "", "t.asm", "-o", "t.prg"], {
      cwd: dir,
    });
    expect(java.status).toBe(0);
    const disk = join(dir, "x.d64");
    const fmt = spawnSync(c1541 ?? "c1541", [
      "-format",
      "test,01",
      "d64",
      disk,
      "-write",
      join(dir, "t.prg"),
      "prog",
    ]);
    expect(fmt.status).toBe(0);
    const sha1 = createHash("sha1").update(readFileSync(disk)).digest("hex");
    const manifest = join(dir, "manifest.json");
    writeFileSync(manifest, JSON.stringify({ [sha1]: { path: disk, title: "t" } }));
    const s = SessionSchema.parse({
      ...fixtureSession(sha1, [FIRE]),
      image: { sha1, kind: "d64", file: "prog", title: "t" },
    });
    const r = await runSession(s, "t-d64", opts(manifest));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.result.disk).toBe(true);
  }, 120_000);
});

describe("batch run and screenshot names", () => {
  const s = fixtureSession("0".repeat(40), [FIRE]);
  const image = { sha1: "0".repeat(40), kind: "d64" as const, file: "prog", fileSha1: "1".repeat(40) };
  it("attaches a D64's working copy as drive 8, and no disk for a PRG", () => {
    const m = sessionScript(s);
    expect(batchOf({ prg: "/w/p.prg", disk: "/w/image.d64", image }, s, m, "/s.png")).toMatchObject({
      prg: "/w/p.prg",
      disk: "/w/image.d64",
      cycles: 4_000_000,
      args: ["-exitscreenshot", "/s.png"],
    });
    expect(batchOf({ prg: "/w/p.prg", image: { ...image, kind: "prg" } }, s, m, "/s.png")).not.toHaveProperty(
      "disk",
    );
  });
  it("gives every run's exit screenshot its own name under data/re/", () => {
    const a = screenshotPath("session-t");
    const b = screenshotPath("session-t");
    expect(a).not.toBe(b);
    expect(a).toMatch(/[/\\]data[/\\]re[/\\]session-t-.+\.png$/);
    expect(screenshotPath("session-t", shots).startsWith(shots)).toBe(true);
  });
});

describe.skipIf(!canRun)("c64_re_frame_profile with a session", () => {
  const f = canRun ? fixture() : { manifest: "", sha1: "" };
  it("times the handler's LDA #1 / STA $D019 (2 + 4 cycles) from the in-play clock", async () => {
    const r = await reFrameProfile(
      {
        session: fixtureSession(f.sha1, [FIRE]),
        model: "pal",
        cycles: 4_000_000,
        start: "pc:$0940",
        stop: "pc:$0945",
      },
      opts(f.manifest),
    );
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.result.count).toBeGreaterThan(10);
    expect(r.result.typical).toBe(6);
    expect(r.result.samples.every((x) => x.start_clock >= r.run.start_clock)).toBe(true);
  }, 120_000);
  it("refuses both prg_path and session, and neither", async () => {
    const both = await reFrameProfile({
      prg_path: "/tmp/x.prg",
      session: "docs/game-design/studies/sessions/commando.json",
      model: "pal",
      cycles: 100_000,
      start: "pc:$1000",
      stop: "pc:$1001",
    });
    expect(both).toMatchObject({ ok: false, reason: "input" });
    const neither = await reIrqChain({ model: "pal", cycles: 100_000 });
    expect(neither).toMatchObject({ ok: false, reason: "input" });
    const s = fixtureSession("0".repeat(40), []);
    const cycles = await reIrqChain({ session: s, cycles: 8_000_000 });
    expect(cycles).toMatchObject({ ok: false, reason: "input" });
    if (!cycles.ok) expect(cycles.error).toMatch(/cycles 8000000.*limitcycles 4000000/);
    expect(await reIrqChain({ session: s, model: "ntsc" })).toMatchObject({ ok: false, reason: "input" });
    expect(await reIrqChain({ session: s, disk_path: "/tmp/x.d64" })).toMatchObject({
      ok: false,
      reason: "input",
    });
  });
});

const commando = JSON.parse(
  existsSync(join(import.meta.dirname, "..", "data", "games", "manifest.json"))
    ? readFileSync(join(import.meta.dirname, "..", "data", "games", "manifest.json"), "utf8")
    : "{}",
) as Record<string, { path: string }>;
const hasCommando =
  canRun && existsSync(commando.b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f?.path ?? "/nonexistent");

describe.skipIf(!hasCommando)("the Commando session (the maintainer's image; skips without it)", () => {
  it("fires at $0FB5 and leaves the title through $0FEB, with the D64 as drive 8", async () => {
    const r = await reSession({ session: "docs/game-design/studies/sessions/commando.json" }, opts());
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    const fired = r.result.injections[0]?.fired_at_clock ?? 0;
    expect(fired).toBeGreaterThan(0);
    expect(r.result.play_clock).toBeGreaterThan(fired);
    expect(r.result.disk).toBe(true);
  }, 240_000);
  it("without the injection the title never exits: not-in-play", async () => {
    const l = loadSession("docs/game-design/studies/sessions/commando.json");
    if (!l.ok) throw new Error(l.error);
    const r = await runSession({ ...l.session, inject: [] }, "commando-noinject", opts());
    expect(r).toMatchObject({ ok: false, reason: "not-in-play", clock: 60_000_000 });
  }, 240_000);
});
