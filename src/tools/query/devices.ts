/**
 * The devices a recipe requires (schema 36, #87): REQUIRES_DEVICE to a
 * Device node from docs/hardware/devices.md, with the units the device
 * claims. c64_recipe_lookup returns them; no key on the page reads as
 * "unknown", never as "needs nothing".
 */

import { z } from "zod";
import { getFalkor } from "../../context.ts";
import { CLAIM_MODES } from "../../graph/claims.ts";
import type { RecipeLookupOutput } from "../../schemas/tool-outputs.ts";
import { parseRows } from "./shared.ts";

type DevicesPart = Pick<RecipeLookupOutput, "devices" | "devices_stated">;
type RequiredDevice = NonNullable<RecipeLookupOutput["devices"]>[number];

const DeviceRow = z.object({
  name: z.string(),
  title: z.string(),
  kind: z.string(),
  port: z.string(),
  vice_attach: z.string(),
  claims_stated: z.string().nullable(),
  claims_basis: z.string().nullable(),
  units: z.array(z.string()),
  modes: z.array(z.enum(CLAIM_MODES)),
});

function toDevice(r: z.infer<typeof DeviceRow>): RequiredDevice {
  const stated = r.claims_stated === "stated" || r.claims_stated === "none" ? r.claims_stated : "unknown";
  return {
    name: r.name,
    title: r.title,
    kind: r.kind,
    port: r.port,
    vice_attach: r.vice_attach,
    claims: r.units.flatMap((unit, i) => {
      const mode = r.modes[i];
      return mode ? [{ unit, mode }] : [];
    }),
    claims_stated: stated,
    ...(r.claims_basis ? { claims_basis: r.claims_basis } : {}),
  };
}

export async function devicesOf(
  recipe: string,
  devicesStated: string | null | undefined,
): Promise<DevicesPart> {
  const f = await getFalkor();
  const rows = parseRows(
    DeviceRow,
    await f.roQuery(
      `MATCH (:Recipe {name: $name})-[:REQUIRES_DEVICE]->(d:Device)
       OPTIONAL MATCH (d)-[c:CLAIMS]->(h:HardwareUnit)
       WITH d, h.name AS unit, c.mode AS mode ORDER BY unit
       RETURN d.name AS name, d.title AS title, d.kind AS kind, d.port AS port,
              d.vice_attach AS vice_attach, d.claims_stated AS claims_stated,
              d.claims_basis AS claims_basis, collect(unit) AS units, collect(mode) AS modes
       ORDER BY name`,
      { name: recipe },
    ),
  );
  const stated = devicesStated === "stated" || devicesStated === "none" ? devicesStated : "unknown";
  return { devices: rows.map(toDevice), devices_stated: stated };
}

/** The **Devices:** line of a recipe lookup. */
export function renderDevices(d: DevicesPart): string {
  if (d.devices_stated === "unknown")
    return `**Devices:** unknown (the page has no devices: key; the run may still attach a drive or cartridge)\n`;
  const list = d.devices ?? [];
  if (list.length === 0) return `**Devices:** none beyond the stock machine\n`;
  const items = list.map((v) => {
    const claims =
      v.claims_stated === "unknown"
        ? "claims unknown"
        : v.claims.length === 0
          ? "claims no unit"
          : v.claims.map((c) => `${c.unit} (${c.mode})`).join(", ");
    return `${v.name} (${v.title}; ${v.port} port; VICE attach: ${v.vice_attach}; ${claims})`;
  });
  return `**Devices:** ${items.join("; ")}\n`;
}
