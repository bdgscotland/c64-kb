import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { FalkorService } from "../src/services/falkor.ts";
import { checkCompatibility } from "../src/tools/query.ts";
import { extractGraphEntities, DEMAND_VOCABULARY } from "../src/graph/extract.ts";

// The vocabulary's text for a demand word; throws on a word it does not hold.
function demandText(r: string): string {
  const text = new Map(Object.entries(DEMAND_VOCABULARY)).get(r);
  if (text === undefined) throw new Error(`not a demand word: ${r}`);
  return text;
}

// serial_bus_exclusive (schema 24): a resident drive-code loader owns the
// drive's serial bus, so KERNAL disk I/O stalls until it is uninstalled
// (docs/techniques/loaders-packers.md, krill_loader_integration, How step 5).
describe("serial_bus_exclusive", () => {
  it("is in the vocabulary, and the words no page can state are not", () => {
    expect(demandText("serial_bus_exclusive")).toMatch(/serial bus/);
    for (const w of [
      "dd00_plain_stores",
      "io_visible_in_irq",
      "loads_in_background",
      "no_concurrent_loading",
    ]) {
      expect(w in DEMAND_VOCABULARY).toBe(false);
    }
  });

  it("the Krill page asserts it and ingests without an unknown-demand warning", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const file = path.resolve(__dirname, "../docs/techniques/loaders-packers.md");
      const ents = extractGraphEntities(fs.readFileSync(file, "utf8"), "techniques/loaders-packers.md");
      const d = ents.filter((e) => e.type === "technique_demands");
      expect(d.map((e) => `${e.technique}:${e.resource}`)).toEqual([
        "krill_loader_integration:serial_bus_exclusive",
        "sparkle_irq_loader:serial_bus_exclusive",
        "sparkle_irq_loader:kernal_rom_out",
        "bitfire_loader:serial_bus_exclusive",
        "bitfire_loader:kernal_rom_out",
        "in_game_level_streaming:serial_bus_exclusive",
      ]);
      expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes("demands unknown"))).toEqual(
        [],
      );
    } finally {
      warn.mockRestore();
    }
  });

  describe("checkCompatibility", () => {
    let f: FalkorService;
    beforeAll(async () => {
      f = new FalkorService();
      await f.connect();
      await f.clean();
      await f.ensureSchema();
      for (const [name, category] of [
        ["krill_loader_integration", "loader"],
        ["kernal_file_read_seq", "io"],
        ["prints_text", "render"],
        ["vic_bank_select", "banking"],
        ["raw_iec_sender", "io"],
      ] as const) {
        await f.addTechnique({ name, title: name, category, complexity: "medium" });
      }
      await f.linkTechniqueDemands(
        "krill_loader_integration",
        "serial_bus_exclusive",
        demandText("serial_bus_exclusive"),
      );
      for (const [name, addr] of [
        ["OPEN", "$FFC0"],
        ["CHKIN", "$FFC6"],
        ["CHRIN", "$FFCF"],
        ["CHROUT", "$FFD2"],
        ["CLOSE", "$FFC3"],
        ["IECOUT", "$FFA8"],
      ] as const) {
        await f.addKernalRoutine(name, addr, name);
      }
      for (const k of ["OPEN", "CHKIN", "CHRIN", "CLOSE"])
        await f.linkTechniqueUsesKernal("kernal_file_read_seq", k);
      await f.linkTechniqueUsesKernal("prints_text", "CHROUT");
      await f.linkTechniqueUsesKernal("raw_iec_sender", "IECOUT");
      await f.addRegister("CI2PRA", "$DD00", "CIA2", "RW", ["DD00"]);
      await f.linkTechniqueUsesRegister("krill_loader_integration", "DD00");
      await f.linkTechniqueUsesRegister("vic_bank_select", "DD00");
    });
    afterAll(async () => f.close());

    it("a resident loader against KERNAL file I/O is serial_bus_busy", async () => {
      const r = (await checkCompatibility(["krill_loader_integration", "kernal_file_read_seq"])).structured;
      expect(r.verdict).toBe("incompatible");
      const c = r.conflicts.find((x) => x.kind === "serial_bus_busy");
      expect(c?.shared).toEqual(["CHKIN", "CLOSE", "OPEN"]); // CHRIN is not a bus call on its own
      expect(c?.resolution).toMatch(/uninstall/i);
    });

    it("names the serial routines as the kernal page does: IECOUT, not CIOUT", async () => {
      // The rule listed CIOUT and ACPTR, names no KernalRoutine node carries,
      // so a technique calling IECOUT was never caught.
      const r = (await checkCompatibility(["krill_loader_integration", "raw_iec_sender"])).structured;
      expect(r.conflicts.find((x) => x.kind === "serial_bus_busy")?.shared).toEqual(["IECOUT"]);
    });

    it("screen output through CHROUT is not a serial-bus conflict", async () => {
      const r = (await checkCompatibility(["krill_loader_integration", "prints_text"])).structured;
      expect(r.conflicts.filter((c) => c.severity === "hard")).toEqual([]);
    });

    it("$DD00 sharing stays a soft shared_register: no read-modify-write signal exists", async () => {
      const r = (await checkCompatibility(["krill_loader_integration", "vic_bank_select"])).structured;
      expect(r.verdict).toBe("warnings");
      expect(r.conflicts.map((c) => c.kind)).toEqual(["shared_register"]);
    });
  });
});
