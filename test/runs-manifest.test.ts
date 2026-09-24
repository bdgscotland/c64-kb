import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// VICE 3.10 adds random noise to every SID pot read (makepotval and
// makebadpotval in src/sid/sid.c) and seeds its generator from the wall
// clock in whole seconds (lib_init in src/lib.c). A pinned run that attaches
// a device driving the pot lines must fix the seed, or its picture depends
// on the second it started: kickassembler/paddle-read flaked this way (#34).
const POT_DEVICES = new Set(["2", "3", "10"]); // paddles, 1351 mouse, KoalaPad (x64sc -help)

type Run = { flags?: string[] };

function potPortsWithoutSeed(manifest: Record<string, Run | string>): string[] {
  const bad: string[] = [];
  for (const [key, run] of Object.entries(manifest)) {
    if (typeof run !== "object") continue;
    const flags = run.flags ?? [];
    const drivesPots = flags.some(
      (f, i) => /^-controlport[12]device$/.test(f) && POT_DEVICES.has(flags.at(i + 1) ?? ""),
    );
    if (drivesPots && !flags.includes("-seed")) bad.push(key);
  }
  return bad;
}

describe("runs.json pins the VICE seed for pot devices", () => {
  it("flags an entry that attaches paddles without -seed", () => {
    expect(
      potPortsWithoutSeed({
        _comment: "text",
        "kickassembler/a": { flags: ["-controlport2device", "2"] },
        "kickassembler/b": { flags: ["-controlport1device", "3", "-seed", "1"] },
        "kickassembler/c": { flags: ["-controlport1device", "11"] },
      }),
    ).toEqual(["kickassembler/a"]);
  });

  it("every committed entry that drives the pot lines fixes the seed", () => {
    const file = path.join(import.meta.dirname, "..", "docs", "recipes", "runs.json");
    const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Run | string>;
    expect(potPortsWithoutSeed(manifest)).toEqual([]);
  });
});
