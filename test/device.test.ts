import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { checkCrtType, checkRunDevices, crtHardwareType } from "../scripts/lib/device-check.ts";
import { extractGraphEntities } from "../src/graph/extract.ts";
import { parseDevices, parseViceAttach } from "../src/graph/extract/device.ts";
import { recipeDevices } from "../src/graph/extract/recipe.ts";
import { FalkorService } from "../src/services/falkor.ts";
import {
  evaluateCompatibility,
  type CompatibilityFacts,
  type TechniqueFacts,
} from "../src/tools/query/compatibility/index.ts";
import type { RecipeDevice } from "../src/tools/query/compatibility/device-rules.ts";

// Device nodes (#87): docs/hardware/devices.md, a recipe's devices: key,
// the verify:recipes check against runs.json, and recipe_device_conflict.

const PAGE = "hardware/devices.md";
const content = readFileSync(join(import.meta.dirname, "..", "docs", PAGE), "utf8");
const devices = parseDevices(content, PAGE);
const byName = new Map(devices.map((d) => [d.name, d]));

describe("the devices page", () => {
  it("reads every section with a Device line and none without", () => {
    expect(devices.map((d) => d.name)).toEqual([
      "joystick_port_1",
      "joystick_port_2",
      "paddles_port_2",
      "mouse_1351_port_1",
      "light_pen_port_1",
      "four_player_adapter_cga",
      "disk_1541_ii",
      "disk_1581",
      "disk_1541_ii_drive_9",
      "printer_device_4",
      "reu_1750",
      "easyflash",
      "magic_desk",
      "generic_8k_cartridge",
    ]);
  });

  it("gives the expansion-page claims VICE's cartridge source supports", () => {
    expect(byName.get("easyflash")?.claims).toEqual([
      { unit: "expansion_io1", mode: "owns" },
      { unit: "expansion_io2", mode: "owns" },
    ]);
    expect(byName.get("reu_1750")?.claims).toEqual([{ unit: "expansion_io2", mode: "owns" }]);
    expect(byName.get("magic_desk")?.claims).toEqual([{ unit: "expansion_io1", mode: "owns" }]);
    expect(byName.get("generic_8k_cartridge")?.claims).toEqual([]);
    expect(byName.get("easyflash")?.attach).toEqual({ how: "crt", type: 32 });
  });

  it("emits a Device node and Device-owned CLAIMS entities", () => {
    const ents = extractGraphEntities(content, PAGE);
    const nodes = ents.filter((e) => e.type === "device");
    expect(nodes).toHaveLength(devices.length);
    const claims = ents.filter((e) => e.type === "claims");
    expect(claims.every((c) => c.ownerKind === "Device")).toBe(true);
    expect(claims.find((c) => c.owner === "disk_1541_ii")).toMatchObject({
      unit: "serial_bus",
      mode: "shares",
      basis: "measured-vice",
    });
    const generic = nodes.find((n) => n.name === "generic_8k_cartridge");
    expect(generic).toMatchObject({ claims_stated: "none", vice_attach: "crt 0", port: "expansion" });
  });
});

describe("device sections the parser refuses", () => {
  const section = (lines: string) => `## X\n\n**Device:** \`x\`\n${lines}\n`;
  const warn = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

  it("drops a section with no port or an unknown attach form", () => {
    const w = warn();
    expect(parseDevices(section("**Device kind:** input\n**VICE attach:** default"), "p")).toEqual([]);
    expect(
      parseDevices(
        section("**Device kind:** input\n**Device port:** control_1\n**VICE attach:** maybe"),
        "p",
      ),
    ).toEqual([]);
    w.mockRestore();
  });

  it("leaves claims unknown for a program mode (reads) or a missing basis", () => {
    const w = warn();
    const base = "**Device kind:** input\n**Device port:** control_1\n**VICE attach:** default\n";
    expect(
      parseDevices(
        section(`${base}**Claims:** cia1_port_b (reads)\n**Claims basis:** derived-listing`),
        "p",
      )[0]?.claims,
    ).toBeUndefined();
    expect(parseDevices(section(`${base}**Claims:** cia1_port_b`), "p")[0]?.claims).toBeUndefined();
    w.mockRestore();
  });

  it("parses each attach form", () => {
    expect(parseViceAttach("`flags -reu -reusize 512`")).toEqual({
      how: "flags",
      flags: ["-reu", "-reusize", "512"],
    });
    expect(parseViceAttach("disk")).toEqual({ how: "disk", unit: 8, image: "d64" });
    expect(parseViceAttach("disk d81")).toEqual({ how: "disk", unit: 8, image: "d81" });
    expect(parseViceAttach("`disk 9`")).toEqual({ how: "disk", unit: 9, image: "d64" });
    expect(parseViceAttach("disk 10")).toBeNull();
    expect(parseViceAttach("crt 19")).toEqual({ how: "crt", type: 19 });
    expect(parseViceAttach("flags")).toBeNull();
  });
});

describe("a recipe's devices: key", () => {
  it("reads a list, an empty list and no key differently", () => {
    expect(recipeDevices("[disk_1541_ii, reu_1750]", "p")).toEqual(["disk_1541_ii", "reu_1750"]);
    expect(recipeDevices("[]", "p")).toEqual([]);
    expect(recipeDevices(undefined, "p")).toBeNull();
    const w = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(recipeDevices("[Disk-8]", "p")).toBeNull();
    w.mockRestore();
  });

  it("becomes REQUIRES_DEVICE entities and devices_stated on the recipe", () => {
    const page = `---\nrecipe: x\ntoolchain: kickassembler\noutput_format: PRG\nregion: both\ndevices: [disk_1541_ii]\n---\n`;
    const ents = extractGraphEntities(`${page}<!-- doc-type: recipe -->\n`, "recipes/kickassembler/x.md");
    expect(ents.find((e) => e.type === "recipe")).toMatchObject({ devices_stated: "stated" });
    expect(ents.filter((e) => e.type === "requires_device")).toEqual([
      { type: "requires_device", recipe: "kickassembler-x", device: "disk_1541_ii" },
    ]);
  });
});

describe("checkRunDevices", () => {
  it("passes the page's own pairings", () => {
    expect(checkRunDevices(["disk_1541_ii"], { flags: [], disk: { name: "T,01" } }, devices)).toEqual([]);
    expect(
      checkRunDevices(
        ["mouse_1351_port_1", "paddles_port_2"],
        { flags: ["-controlport1device", "3", "-controlport2device", "2", "-seed", "1"] },
        devices,
      ),
    ).toEqual([]);
    expect(checkRunDevices(["easyflash"], { flags: [], cartridge: { file: "x.crt" } }, devices)).toEqual([]);
    // A default device needs no option in the run.
    expect(checkRunDevices(["joystick_port_2"], { flags: [] }, devices)).toEqual([]);
    expect(
      checkRunDevices(
        ["printer_device_4"],
        { flags: ["-busdevice4", "-devicebackend4", "1", "-pr4drv", "ascii", "-pr4output", "text"] },
        devices,
      ),
    ).toEqual([]);
    expect(byName.get("printer_device_4")?.kind).toBe("output");
  });

  it("tells a D64, a D81 and a second drive apart", () => {
    const d81 = { flags: [], disk: { name: "P,81", type: "d81" as const } };
    expect(checkRunDevices(["disk_1581"], d81, devices)).toEqual([]);
    expect(checkRunDevices(["disk_1541_ii"], d81, devices)).toEqual([
      "the run attaches disk_1581, but devices does not list it",
      "devices lists disk_1541_ii, but the run does not attach it (disk)",
    ]);
    expect(checkRunDevices(["disk_1581"], { ...d81, flags: ["-drive8type", "1581"] }, devices)[0]).toMatch(
      /verifier sets -drive8type 1581 itself/,
    );
    const two = { flags: [], disk: { name: "S,01" }, disk9: { name: "T,01" } };
    expect(checkRunDevices(["disk_1541_ii", "disk_1541_ii_drive_9"], two, devices)).toEqual([]);
    expect(checkRunDevices(["disk_1541_ii"], two, devices)).toEqual([
      "the run attaches disk_1541_ii_drive_9, but devices does not list it",
    ]);
    expect(checkRunDevices([], { flags: ["-9", "x.d64"] }, devices)[0]).toMatch(/-9 x.d64 matches no device/);
  });

  it("fails a run that attaches what the page does not list", () => {
    expect(checkRunDevices(null, { flags: [], disk: { name: "T,01" } }, devices)).toEqual([
      "the run attaches disk_1541_ii, but the page has no devices: key",
    ]);
    expect(checkRunDevices([], { flags: ["-reu", "-reusize", "512"] }, devices)).toEqual([
      "the run attaches reu_1750, but devices does not list it",
    ]);
    expect(checkRunDevices([], { flags: ["-controlport1device", "5"] }, devices)[0]).toMatch(
      /-controlport1device 5 matches no device/,
    );
    // -busdevice4 alone is not the printer's attach line: VICE's device 4 then answers without a backend.
    expect(checkRunDevices([], { flags: ["-busdevice4"] }, devices)[0]).toMatch(
      /-busdevice4 {2}matches no device/,
    );
  });

  it("fails a listed device the run does not attach, a second drive type, and two in one socket", () => {
    expect(checkRunDevices(["reu_1750"], { flags: [] }, devices)).toEqual([
      "devices lists reu_1750, but the run does not attach it (flags)",
    ]);
    expect(
      checkRunDevices(["disk_1541_ii"], { flags: ["-drive8type", "1541"], disk: { name: "T,01" } }, devices),
    ).toEqual(["the run sets -drive8type 1541; only 1542 (disk_1541_ii) has a device section"]);
    expect(
      checkRunDevices(
        ["joystick_port_2", "paddles_port_2"],
        { flags: ["-controlport2device", "2"] },
        devices,
      ),
    ).toContain("devices lists joystick_port_2 and paddles_port_2, both in port control_2");
    expect(checkRunDevices(["easyflash"], { flags: [] }, devices)).toEqual([
      "devices lists easyflash, but the run attaches no cartridge",
    ]);
  });

  it("reads the CRT hardware type from the built file", () => {
    const dir = mkdtempSync(join(tmpdir(), "c64kb-crt-"));
    const crt = join(dir, "x.crt");
    const head = Buffer.alloc(0x40);
    head.write("C64 CARTRIDGE   ", 0, "latin1");
    head.writeUInt16BE(19, 0x16);
    writeFileSync(crt, head);
    expect(crtHardwareType(crt)).toBe(19);
    expect(checkCrtType(crt, ["magic_desk"], devices)).toEqual([]);
    expect(checkCrtType(crt, ["easyflash"], devices)).toEqual([
      "the built cartridge is CRT hardware type 19; easyflash is type 32",
    ]);
  });
});

describe("recipe_device_conflict", () => {
  const known: TechniqueFacts = {
    found: true,
    demands: new Set(),
    registers: 1,
    kernal: [],
    band: null,
    region: null,
    category: null,
    rasterRegisters: 0,
    claims: [],
    claimsStated: "none",
  };
  function check(techniques: string[], recipeDevices: RecipeDevice[]) {
    const facts: CompatibilityFacts = {
      techniques,
      requires: new Map(techniques.map((t) => [t, []])),
      facts: new Map(techniques.map((t) => [t, known])),
      sharedRegisters: new Map(),
      sharedKernal: new Map(),
      recipeUses: [],
      recipeDevices,
    };
    return evaluateCompatibility(facts);
  }
  const reu: RecipeDevice = {
    recipe: "kickassembler-reu-dma",
    implements: ["reu_dma"],
    device: "reu_1750",
    port: "expansion",
    owns: ["expansion_io2"],
  };
  const ef: RecipeDevice = {
    recipe: "kickassembler-easyflash-save",
    implements: ["cartridge_save"],
    device: "easyflash",
    port: "expansion",
    owns: ["expansion_io1", "expansion_io2"],
  };

  it("names the recipes, the devices and the page they both own, as info", () => {
    const r = check(["reu_dma", "cartridge_save"], [reu, ef]);
    expect(r.verdict).toBe("compatible");
    expect(r.conflicts).toEqual([
      expect.objectContaining({
        kind: "recipe_device_conflict",
        severity: "info",
        shared: ["expansion port", "expansion_io2"],
      }),
    ]);
    expect(r.conflicts[0]?.rationale).toContain(
      "kickassembler-reu-dma (reu_1750) and kickassembler-easyflash-save (easyflash)",
    );
  });

  it("says nothing for one device on both sides or two drives on the serial bus", () => {
    expect(
      check(
        ["a", "b"],
        [
          { ...reu, implements: ["a"] },
          { ...reu, recipe: "r2", implements: ["b"] },
        ],
      ).conflicts,
    ).toEqual([]);
    const drive = (recipe: string, t: string): RecipeDevice => ({
      recipe,
      implements: [t],
      device: `disk_${recipe}`,
      port: "serial",
      owns: [],
    });
    expect(check(["a", "b"], [drive("r1", "a"), drive("r2", "b")]).conflicts).toEqual([]);
  });
});

describe("FalkorService — Device, CLAIMS from a Device, REQUIRES_DEVICE", () => {
  let f: FalkorService;
  beforeAll(async () => {
    f = new FalkorService();
    await f.connect();
    await f.clean();
    await f.ensureSchema();
  });
  afterAll(async () => {
    await f.close();
  });

  const recipe = {
    name: "kickassembler-reu-dma",
    toolchain: "kickassembler",
    output_format: "PRG",
    region: "both",
    source_doc: "recipes/kickassembler/reu-dma.md",
  };

  it("lands the claims and the requirement, and a re-ingested recipe drops a requirement it stopped stating", async () => {
    await f.addDevice({
      name: "reu_1750",
      title: "REU 1750 (512 KB)",
      kind: "memory",
      port: "expansion",
      vice_attach: "flags -reu -reusize 512",
      source_doc: PAGE,
      claims_stated: "stated",
      claims_basis: "measured-vice",
    });
    expect(
      await f.linkClaims({
        owner: "reu_1750",
        ownerKind: "Device",
        unit: "expansion_io2",
        mode: "owns",
        basis: "measured-vice",
      }),
    ).toBe(true);
    await f.addRecipe({ ...recipe, devices_stated: "stated" });
    expect(await f.linkRequiresDevice(recipe.name, "reu_1750")).toBe(true);
    const r = await f.roQuery(
      `MATCH (r:Recipe)-[:REQUIRES_DEVICE]->(d:Device)-[c:CLAIMS]->(h:HardwareUnit)
       RETURN r.devices_stated AS stated, d.name AS device, h.name AS unit, c.mode AS mode`,
    );
    expect(r.data).toEqual([{ stated: "stated", device: "reu_1750", unit: "expansion_io2", mode: "owns" }]);

    await f.addRecipe(recipe);
    const after = await f.roQuery(`MATCH (:Recipe)-[e:REQUIRES_DEVICE]->() RETURN count(e) AS n`);
    expect(after.data).toEqual([{ n: 0 }]);

    const w = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await f.linkRequiresDevice(recipe.name, "no_such_device")).toBe(false);
    w.mockRestore();
  });
});
