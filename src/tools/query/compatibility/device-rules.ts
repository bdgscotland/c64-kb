/**
 * recipe_device_conflict (schema 36, #87): a recipe that builds one input
 * and a recipe that builds the other require devices that cannot be
 * attached together: both own one HardwareUnit (the REU and EasyFlash both
 * decode $DF00-$DFFF), or both sit in one single-socket port (two
 * cartridges in the expansion port, a joystick and paddles in port 2).
 * Info, like recipe_zero_page_overlap: the recipes chose the devices, the
 * techniques did not, so the verdict does not change.
 */

import type { CompatibilityCheckOutput } from "../../../schemas/tool-outputs.ts";
import { SINGLE_SOCKET_PORTS } from "../../../graph/extract/device.ts";
import { inputPairs, type CompatibilityFacts } from "./facts.ts";

type Conflict = CompatibilityCheckOutput["conflicts"][number];

export interface RecipeDevice {
  recipe: string;
  /** The input techniques this recipe IMPLEMENTS. */
  implements: readonly string[];
  device: string;
  port: string;
  /** HardwareUnits the device CLAIMS with mode owns. */
  owns: readonly string[];
}

const MAX_PAIRS = 4;

/** What two devices collide on: the units both own, then the port when it has one socket. */
function clash(a: RecipeDevice, b: RecipeDevice): string[] {
  if (a.device === b.device) return [];
  const units = a.owns.filter((u) => b.owns.includes(u));
  const port = a.port === b.port && (SINGLE_SOCKET_PORTS as readonly string[]).includes(a.port);
  return [...units, ...(port ? [`${a.port} port`] : [])];
}

/** One info conflict per input pair whose recipes, one for each side and not both, need devices that clash. */
export function recipeDeviceRules(all: CompatibilityFacts): Conflict[] {
  const uses = all.recipeDevices ?? [];
  const only = (t: string, other: string) =>
    uses.filter((r) => r.implements.includes(t) && !r.implements.includes(other));
  const out: Conflict[] = [];
  for (const { a, b } of inputPairs(all.techniques)) {
    const hits: { text: string; on: string[] }[] = [];
    for (const ra of only(a, b))
      for (const rb of only(b, a)) {
        const on = clash(ra, rb);
        if (on.length > 0)
          hits.push({
            text: `${ra.recipe} (${ra.device}) and ${rb.recipe} (${rb.device}) on ${on.join(", ")}`,
            on,
          });
      }
    if (hits.length === 0) continue;
    const shown = hits.slice(0, MAX_PAIRS).map((h) => h.text);
    const more = hits.length > MAX_PAIRS ? `, and ${hits.length - MAX_PAIRS} more pair(s)` : "";
    out.push({
      a,
      b,
      kind: "recipe_device_conflict",
      severity: "info",
      shared: [...new Set(hits.flatMap((h) => h.on))].sort(),
      rationale: `Recipes that build them need devices that cannot both be attached to one stock machine: ${shown.join("; ")}${more}. The techniques do not conflict; one machine cannot run both recipes as written.`,
      resolution: `Build one side for a device that does not own the same unit or port; c64_recipe_lookup lists each recipe's devices with their claims.`,
    });
  }
  return out;
}
