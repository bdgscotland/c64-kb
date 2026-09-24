import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeCpuPort, decodeSnapshot, decodeVicState } from "../src/re/vic-state.ts";
import { SessionSchema, type Session } from "../src/re/session.ts";
import { reSnapshot } from "../src/tools/re.ts";
import { resolveX64sc } from "../src/services/vice-bin.ts";
import { findToolchains } from "../scripts/lib/toolchains.ts";

/** A VICE `save 0 <start> <end>` dump: a 2-byte little-endian load address, then the bytes. */
function saveDump(load: number, size: number, bytes: Record<number, number>): Buffer {
  const buf = Buffer.alloc(2 + size);
  buf.writeUInt16LE(load, 0);
  for (const [addr, value] of Object.entries(bytes)) buf[2 + (Number(addr) - load)] = value;
  return buf;
}

describe("vic-state decode", () => {
  it("the irq-chain recipe's default boot state: $DD00=$97, $D018=$15 -> bank 0, screen $0400, charset $1000", () => {
    const io = saveDump(0xd000, 0x1000, { 0xdd00: 0x97, 0xd011: 0x1b, 0xd016: 0xc8, 0xd018: 0x15 });
    const ram = saveDump(0, 0x800, {});
    const v = decodeVicState(ram, io);
    expect(v).toMatchObject({ bank: 0, screen: 0x0400, charset: 0x1000, bitmap: 0x0000, d011: 0x1b });
  });

  it("bank 3, $D018=$82 -> screen $E000, charset $C800 (the char pointer bits, 3-1, are 1: offset $800)", () => {
    // Arithmetic check on the brief's own example, $D018=$84: bits 3-1 of
    // $84 are (0x84>>1)&7 = 2, so its charset offset is 2*$800 = $1000,
    // giving $D000, not $C800 (the next test asserts this). $82 (bits
    // 3-1 = 1) is what pairs with screen $E000 to give charset $C800.
    const io = saveDump(0xd000, 0x1000, { 0xdd00: 0xfc, 0xd018: 0x82, 0xd011: 0, 0xd016: 0 });
    const ram = saveDump(0xe000, 0x400, {});
    const v = decodeVicState(ram, io);
    expect(v.bank).toBe(3);
    expect(v.screen).toBe(0xe000);
    expect(v.charset).toBe(0xc800);
  });

  it("bank 3, $D018=$84 (the brief's own example) decodes to charset $D000, not $C800: (0x84>>1)&7=2, 2*$800=$1000", () => {
    const io = saveDump(0xd000, 0x1000, { 0xdd00: 0xfc, 0xd018: 0x84, 0xd011: 0, 0xd016: 0 });
    const ram = saveDump(0xe000, 0x400, {});
    const v = decodeVicState(ram, io);
    expect(v.screen).toBe(0xe000);
    expect(v.charset).toBe(0xd000);
  });

  it("bitmap pointer: bit 3 of $D018 alone, times $2000", () => {
    const io = saveDump(0xd000, 0x1000, { 0xdd00: 0xff, 0xd018: 0x08 }); // bank 0, bitmap bit set
    const ram = saveDump(0, 0x400, {});
    expect(decodeVicState(ram, io).bitmap).toBe(0x2000);
  });

  it("the eight sprite pointers: screen+$3F8..+$3FF, each times $40, in the bank", () => {
    const io = saveDump(0xd000, 0x1000, { 0xdd00: 0x97, 0xd018: 0x15 }); // bank 0, screen $0400
    const sprite = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7].map((k) => [0x400 + 0x3f8 + k, 0x10 + k]));
    const ram = saveDump(0, 0x800, sprite);
    const v = decodeVicState(ram, io);
    expect(v.sprite_pointers).toEqual([0x400, 0x440, 0x480, 0x4c0, 0x500, 0x540, 0x580, 0x5c0]);
  });

  it("decodes the CPU port from its own dump ($00/$01 are not backed by the `bank ram` RAM chip)", () => {
    const cpu = saveDump(0, 2, { 0: 0x2f, 1: 0x37 });
    expect(decodeCpuPort(cpu)).toEqual({ "00": 0x2f, "01": 0x37 });
  });

  it("decodeSnapshot combines both", () => {
    const io = saveDump(0xd000, 0x1000, { 0xdd00: 0x97, 0xd018: 0x15 });
    const ram = saveDump(0, 0x800, {});
    const cpu = saveDump(0, 2, { 0: 0x2f, 1: 0x37 });
    expect(decodeSnapshot(ram, io, cpu)).toEqual({
      vic: decodeVicState(ram, io),
      cpu_port: { "00": 0x2f, "01": 0x37 },
    });
  });

  it("throws on a dump too short to carry a load address, and on an address outside the dumped range", () => {
    expect(() => decodeCpuPort(Buffer.from([0]))).toThrow(/too short/);
    expect(() => decodeCpuPort(saveDump(0, 1, { 0: 1 }))).toThrow(/outside the dump/);
  });
});

const tools = findToolchains();
const x64sc = resolveX64sc();
const canRun = x64sc !== null && !x64sc.windowed && tools.kickass !== null && tools.java !== null;

/** Builds the committed irq-chain recipe fresh, the way check:listings and verify:recipes do. */
function buildIrqChainRecipe(): string {
  const dir = mkdtempSync(join(tmpdir(), "re-snapshot-irqchain-"));
  const r = spawnSync(
    process.execPath,
    ["scripts/verify-recipes.ts", "--file", "docs/recipes/kickassembler/irq-chain.md", "--keep", dir],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`verify-recipes.ts failed:\n${r.stdout}\n${r.stderr}`);
  return join(dir, "kickassembler-irq-chain.prg");
}

/** A session over the irq-chain recipe: in_play is its handler at $0876, which runs 3x a frame forever. */
function irqChainSession(
  sha1: string,
  over: Partial<Session["in_play"]> = {},
  limitcycles = 4_000_000,
): Session {
  return SessionSchema.parse({
    image: { sha1, kind: "prg", title: "irq-chain" },
    machine: { model: "pal" },
    inject: [],
    in_play: { check: "exec", pc: "$0876", after_clock: 0, ...over },
    limitcycles,
  });
}

describe.skipIf(!canRun)("c64_re_snapshot in VICE, on the irq-chain recipe PRG", () => {
  const prg = canRun ? buildIrqChainRecipe() : "";
  const sha1 = canRun ? createHash("sha1").update(readFileSync(prg)).digest("hex") : "";
  const manifestDir = mkdtempSync(join(tmpdir(), "re-snapshot-manifest-"));
  const manifest = join(manifestDir, "manifest.json");
  if (canRun) writeFileSync(manifest, JSON.stringify({ [sha1]: { path: prg, title: "irq-chain" } }));
  const dumpDir = mkdtempSync(join(tmpdir(), "re-snapshot-dumps-"));
  const shotDir = mkdtempSync(join(tmpdir(), "re-snapshot-shots-"));
  const opts = { manifestPath: manifest, shotDir, dumpDir };

  it("dumps RAM (65,538 bytes) and I/O at the first hit and decodes bank 0, screen $0400", async () => {
    const r = await reSnapshot({ session: irqChainSession(sha1) }, opts);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.result.vic.bank).toBe(0);
    expect(r.result.vic.screen).toBe(0x0400);
    expect(existsSync(r.result.ram_path)).toBe(true);
    const bytes = readFileSync(r.result.ram_path);
    expect(bytes.length).toBe(65538);
    expect(createHash("sha1").update(bytes).digest("hex")).toBe(r.result.ram_sha1);
    expect(r.result.ram_path).toContain(r.result.ram_sha1);
    expect(r.result.ram_path).toContain(String(r.result.clock));
  }, 180_000);

  it("after_hits_of_play_pc skips hits: a later dump has a later clock", async () => {
    const a = await reSnapshot({ session: irqChainSession(sha1) }, opts);
    const b = await reSnapshot({ session: irqChainSession(sha1), after_hits_of_play_pc: 5 }, opts);
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);
    if (a.ok && b.ok) expect(b.result.clock).toBeGreaterThan(a.result.clock);
  }, 180_000);

  it("refuses no-dump when in_play.pc runs fewer times than after_hits_of_play_pc + 1", async () => {
    const r = await reSnapshot({ session: irqChainSession(sha1), after_hits_of_play_pc: 100_000 }, opts);
    expect(r).toMatchObject({ ok: false, reason: "no-dump" });
  }, 60_000);

  it("refuses not-in-play when in_play.pc never runs", async () => {
    const s = irqChainSession(sha1, { pc: "$1000" });
    const r = await reSnapshot({ session: s }, opts);
    expect(r).toMatchObject({ ok: false, reason: "not-in-play" });
  }, 60_000);
});

const commando = JSON.parse(
  existsSync(join(import.meta.dirname, "..", "data", "games", "manifest.json"))
    ? readFileSync(join(import.meta.dirname, "..", "data", "games", "manifest.json"), "utf8")
    : "{}",
) as Record<string, { path: string }>;
const hasCommando =
  canRun && existsSync(commando.b2ca47949468c3d1790dfe8b2fc9b54cb9638c3f?.path ?? "/nonexistent");

describe.skipIf(!hasCommando)(
  "c64_re_snapshot on Commando (the maintainer's image; skips without it)",
  () => {
    it("in play: VIC bank 3, screen $E000 (measured separately: sprite pointers at $E3F8)", async () => {
      const dumpDir = mkdtempSync(join(tmpdir(), "re-snapshot-commando-dumps-"));
      const shotDir = mkdtempSync(join(tmpdir(), "re-snapshot-commando-shots-"));
      const r = await reSnapshot(
        { session: "docs/game-design/studies/sessions/commando.json" },
        { shotDir, dumpDir },
      );
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (!r.ok) return;
      expect(r.result.vic.bank).toBe(3);
      expect(r.result.vic.screen).toBe(0xe000);
    }, 240_000);
  },
);
