/**
 * device-reference pages (docs/CONVENTIONS-devices.md, schema 36, #87).
 * Each H2 carrying a `**Device:**` line is one thing plugged into the
 * machine: a joystick in a control port, a drive on the serial bus, a
 * cartridge in the expansion port. Its lines give the kind, the port, how
 * VICE attaches it and the HardwareUnits it occupies (the technique Claims
 * grammar). verify:recipes reads the same page (`parseDevices`) to check a
 * recipe's `devices:` key against the run runs.json pins.
 */

import { CLAIMS_BASIS_WORDS, isClaimsBasis, parseClaims, type Claim, type ClaimsBasis } from "../claims.ts";
import { group, matchField, splitH2Sections, warn } from "./common.ts";
import type { GraphEntity } from "./types.ts";

const DEVICE_KINDS = ["input", "output", "storage", "memory", "cartridge"] as const;
type DeviceKind = (typeof DEVICE_KINDS)[number];
const DEVICE_PORTS = ["control_1", "control_2", "user", "expansion", "serial"] as const;
export type DevicePort = (typeof DEVICE_PORTS)[number];
/** Ports with one socket: two devices on one of them cannot both be attached. */
export const SINGLE_SOCKET_PORTS: readonly DevicePort[] = ["control_1", "control_2", "user", "expansion"];

/**
 * How VICE attaches the device (the `**VICE attach:**` line):
 * `default` (x64sc attaches it with no option), `flags <x64sc options>`,
 * `disk` (runs.json "disk": a D64 in drive 8) or `crt <hardware type>`
 * (runs.json "cartridge" whose .crt header gives that type).
 */
export type ViceAttach =
  { how: "default" } | { how: "flags"; flags: string[] } | { how: "disk" } | { how: "crt"; type: number };

export interface Device {
  name: string;
  title: string;
  kind: DeviceKind;
  port: DevicePort;
  attach: ViceAttach;
  /** Absent when the page has no Claims line (unknown, not none). */
  claims?: Claim[];
  claims_basis?: ClaimsBasis;
}

export const DEVICE_NAME = /^[a-z][a-z0-9_]*$/;
const NAME_LINE = /^\*\*Device:\*\*\s+`?([a-z][a-z0-9_]*)`?\s*$/m;
const KIND_LINE = /^\*\*Device kind:\*\*\s+`?([a-z_]+)`?\s*$/m;
const PORT_LINE = /^\*\*Device port:\*\*\s+`?([a-z0-9_]+)`?\s*$/m;
const ATTACH_LINE = /^\*\*VICE attach:\*\*\s+(.+)$/m;
const CLAIMS_LINE = /^\*\*Claims:\*\*\s+(.+)$/m;
const CLAIMS_BASIS_LINE = /^\*\*Claims basis:\*\*\s+`?([a-z-]+)`?/m;
// A device's lines occupy a unit (owns) or use it beside others under a
// selection protocol (shares); reads and init describe programs, not devices.
const DEVICE_MODES = new Set(["owns", "shares"]);

/** The value of a VICE attach line, backticks off; null when it is outside the grammar. */
export function parseViceAttach(raw: string): ViceAttach | null {
  const v = raw.replace(/`/g, "").trim();
  if (v === "default") return { how: "default" };
  if (v === "disk") return { how: "disk" };
  const crt = /^crt\s+(\d+)$/.exec(v);
  if (crt) return { how: "crt", type: Number(group(crt, 1)) };
  const flags = /^flags\s+(-.+)$/.exec(v);
  if (flags) return { how: "flags", flags: group(flags, 1).split(/\s+/) };
  return null;
}

const isKind = (w: string): w is DeviceKind => (DEVICE_KINDS as readonly string[]).includes(w);
const isPort = (w: string): w is DevicePort => (DEVICE_PORTS as readonly string[]).includes(w);

type Parsed = { claims?: Claim[]; claims_basis?: ClaimsBasis };

/** The Claims and Claims basis lines of one device; a refused line leaves the claims unknown. */
function deviceClaims(body: string, where: string): Parsed {
  const raw = matchField(body, CLAIMS_LINE);
  if (raw === undefined) return {};
  const basis = matchField(body, CLAIMS_BASIS_LINE);
  if (!basis || !isClaimsBasis(basis)) {
    warn(`${where}: **Claims basis:** must be one of ${CLAIMS_BASIS_WORDS.join(", ")} — claims not ingested`);
    return {};
  }
  const parsed = parseClaims(raw);
  if ("error" in parsed) {
    warn(`${where}: **Claims:** refused (${parsed.error}) — its claims read as unknown`);
    return {};
  }
  const bad = parsed.find((c) => !DEVICE_MODES.has(c.mode));
  if (bad) {
    warn(
      `${where}: a device owns or shares a unit; "${bad.unit} (${bad.mode})" is refused — claims not ingested`,
    );
    return {};
  }
  return { claims: parsed, claims_basis: basis };
}

function sectionDevice(heading: string, body: string, sourcePath: string): Device | null {
  const name = matchField(body, NAME_LINE);
  if (!name) return null;
  const where = `${sourcePath}: device ${name}`;
  const kind = matchField(body, KIND_LINE) ?? "";
  const port = matchField(body, PORT_LINE) ?? "";
  const attachRaw = matchField(body, ATTACH_LINE);
  const attach = attachRaw === undefined ? null : parseViceAttach(attachRaw);
  if (!isKind(kind) || !isPort(port) || !attach) {
    warn(
      `${where} needs **Device kind:** (${DEVICE_KINDS.join(", ")}), **Device port:** (${DEVICE_PORTS.join(", ")}) and **VICE attach:** (default, flags <options>, disk or crt <type>) — not ingested`,
    );
    return null;
  }
  const title = heading.replace(/^##\s+/, "").trim();
  return { name, title, kind, port, attach, ...deviceClaims(body, where) };
}

/** Every device on a device-reference page, in page order. */
export function parseDevices(content: string, sourcePath: string): Device[] {
  return splitH2Sections(content).flatMap((s) => sectionDevice(s.heading, s.body, sourcePath) ?? []);
}

/** The attach line as stored on the node: "flags -reu -reusize 512", "crt 32". */
function attachText(a: ViceAttach): string {
  if (a.how === "flags") return `flags ${a.flags.join(" ")}`;
  if (a.how === "crt") return `crt ${String(a.type)}`;
  return a.how;
}

export function parseDeviceDoc(content: string, sourcePath: string): GraphEntity[] {
  return parseDevices(content, sourcePath).flatMap((d): GraphEntity[] => [
    {
      type: "device",
      name: d.name,
      title: d.title,
      kind: d.kind,
      port: d.port,
      vice_attach: attachText(d.attach),
      source_doc: sourcePath,
      ...(d.claims && d.claims_basis
        ? { claims_stated: d.claims.length > 0 ? "stated" : "none", claims_basis: d.claims_basis }
        : {}),
    },
    ...(d.claims ?? []).map((c): GraphEntity => ({
      type: "claims",
      owner: d.name,
      ownerKind: "Device",
      ...c,
      basis: d.claims_basis ?? "estimated",
    })),
  ]);
}
