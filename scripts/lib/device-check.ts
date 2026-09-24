/**
 * A recipe's `devices:` key against the run runs.json pins (#87,
 * docs/CONVENTIONS-devices.md). verify:recipes calls `checkRunDevices`
 * before it starts VICE and `checkCrtType` once the build has written the
 * cartridge. Both return problems as sentences; an empty list passes.
 */

import { readFileSync } from "node:fs";
import { SINGLE_SOCKET_PORTS, type Device } from "../../src/graph/extract/device.ts";

/** The parts of a pinned run that attach hardware. */
export interface RunAttach {
  flags: readonly string[];
  /** Drive 8's fresh disk; `type` absent is a D64. */
  disk?: { name: string; type?: "d64" | "d81" | undefined } | undefined;
  /** Drive 9's fresh D64 (a second 1541-II). */
  disk9?: { name: string } | undefined;
  cartridge?: unknown;
}

// x64sc options that attach a device. One in a run's flags that no device
// section's flags line accounts for means the page describes a machine the
// run is not.
// A second drive goes through runs.json "disk9", never through flags.
const ATTACH_OPTIONS = [
  "-controlport1device",
  "-controlport2device",
  "-userportdevice",
  "-reu",
  "-georam",
  "-busdevice4",
  "-9",
  "-drive9type",
];
const DRIVE_TYPE_1541_II = "1542";

/** Index of `seq` as a contiguous run inside `flags`, or -1. */
function indexOfSeq(flags: readonly string[], seq: readonly string[]): number {
  for (let i = 0; i + seq.length <= flags.length; i++) {
    if (seq.every((s, j) => flags[i + j] === s)) return i;
  }
  return -1;
}

/** The devices the run attaches, and the flag positions their flags lines cover. */
function impliedDevices(
  run: RunAttach,
  devices: readonly Device[],
): { names: string[]; covered: Set<number> } {
  const names: string[] = [];
  const covered = new Set<number>();
  for (const d of devices) {
    const a = d.attach;
    if (a.how === "flags") {
      const at = indexOfSeq(run.flags, a.flags);
      if (at === -1) continue;
      names.push(d.name);
      for (let j = 0; j < a.flags.length; j++) covered.add(at + j);
    } else if (a.how === "disk" && diskImageAt(run, a.unit) === a.image) names.push(d.name);
  }
  return { names, covered };
}

/** The image the run puts in drive 8 or 9, or undefined when it attaches none there. */
function diskImageAt(run: RunAttach, unit: 8 | 9): "d64" | "d81" | undefined {
  if (unit === 9) return run.disk9 === undefined ? undefined : "d64";
  return run.disk === undefined ? undefined : (run.disk.type ?? "d64");
}

function driveTypeProblem(run: RunAttach): string[] {
  const i = run.flags.indexOf("-drive8type");
  if (run.disk === undefined || i === -1) return [];
  const type = run.flags[i + 1];
  if (run.disk.type === "d81")
    return [
      `the run's disk is a D81 and the verifier sets -drive8type 1581 itself; drop -drive8type ${type ?? ""}`,
    ];
  return type === DRIVE_TYPE_1541_II
    ? []
    : [`the run sets -drive8type ${type ?? "(nothing)"}; only 1542 (disk_1541_ii) has a device section`];
}

function uncoveredOptions(run: RunAttach, covered: Set<number>): string[] {
  return run.flags.flatMap((f, i) =>
    ATTACH_OPTIONS.includes(f) && !covered.has(i)
      ? [
          `the run's ${f} ${run.flags[i + 1] ?? ""} matches no device's VICE attach line in docs/hardware/devices.md`,
        ]
      : [],
  );
}

function cartridgeProblems(run: RunAttach, declared: readonly Device[]): string[] {
  const carts = declared.filter((d) => d.attach.how === "crt");
  if (run.cartridge === undefined)
    return carts.map((d) => `devices lists ${d.name}, but the run attaches no cartridge`);
  if (carts.length !== 1)
    return [
      `the run attaches a cartridge; devices must list exactly one crt device, not ${String(carts.length)}`,
    ];
  return [];
}

/** Two listed devices in one single-socket port cannot both be attached. */
function socketClashes(declared: readonly Device[]): string[] {
  const out: string[] = [];
  declared.forEach((a, i) => {
    for (const b of declared.slice(i + 1))
      if (a.port === b.port && SINGLE_SOCKET_PORTS.includes(a.port))
        out.push(`devices lists ${a.name} and ${b.name}, both in port ${a.port}`);
  });
  return out;
}

/**
 * Problems with a recipe's devices key (`null` when the page has none)
 * against its pinned run. Default devices (VICE attaches them with no
 * option) may be listed without run evidence.
 */
export function checkRunDevices(
  declaredNames: readonly string[] | null,
  run: RunAttach,
  devices: readonly Device[],
): string[] {
  const byName = new Map(devices.map((d) => [d.name, d]));
  const { names: implied, covered } = impliedDevices(run, devices);
  const problems = [...driveTypeProblem(run), ...uncoveredOptions(run, covered)];
  const declared = declaredNames ?? [];
  const unknown = declared.filter((n) => !byName.has(n));
  problems.push(
    ...unknown.map((n) => `devices lists ${n}, which has no section in docs/hardware/devices.md`),
  );
  const known = declared.flatMap((n) => byName.get(n) ?? []);
  problems.push(...cartridgeProblems(run, known), ...socketClashes(known));
  for (const n of implied)
    if (!declared.includes(n))
      problems.push(
        declaredNames === null
          ? `the run attaches ${n}, but the page has no devices: key`
          : `the run attaches ${n}, but devices does not list it`,
      );
  for (const d of known)
    if (d.attach.how !== "default" && d.attach.how !== "crt" && !implied.includes(d.name))
      problems.push(`devices lists ${d.name}, but the run does not attach it (${d.attach.how})`);
  return problems;
}

/** The hardware type in a .crt header (big-endian word at $16), or null when it is not a CRT file. */
export function crtHardwareType(file: string): number | null {
  const b = readFileSync(file);
  if (b.length < 0x18 || b.subarray(0, 16).toString("latin1") !== "C64 CARTRIDGE   ") return null;
  return b.readUInt16BE(0x16);
}

/** The built cartridge's type against the one crt device the recipe lists. */
export function checkCrtType(
  crtFile: string,
  declared: readonly string[],
  devices: readonly Device[],
): string[] {
  const type = crtHardwareType(crtFile);
  const cart = devices.find((d) => declared.includes(d.name) && d.attach.how === "crt");
  if (cart?.attach.how !== "crt") return [];
  if (type === null) return [`${crtFile} has no CRT header`];
  return type === cart.attach.type
    ? []
    : [
        `the built cartridge is CRT hardware type ${String(type)}; ${cart.name} is type ${String(cart.attach.type)}`,
      ];
}
