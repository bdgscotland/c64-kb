/**
 * A proposal holds no pair its own compatibility check refuses when search
 * alone put one of them there (#97). The #22 shmup brief's plan carried
 * sprite_multiplex_game, forced by the vertical_shmup fingerprint, and
 * sprite_multiplex_8, found by search, and check-compatibility called the
 * pair a hard conflict. Here a technique found only by search goes when
 * the check calls it a hard conflict with a forced one (the archetype's
 * fingerprint or the brief's own words), and is reported beside it. Two
 * found by search both stay, as do two forced ones: "an 8-sprite and a
 * 24-sprite multiplexer" asks for both, and the conflict stays in the
 * briefing's compatibility section for the plan to resolve.
 */

export interface ConflictLeftOut {
  name: string;
  kind: string;
  rationale: string;
}

export interface ConflictDrops {
  dropped: Set<string>;
  /** Kept technique name → the search-only techniques left out for a hard conflict with it. */
  leftOut: Map<string, ConflictLeftOut[]>;
}

interface HardConflict {
  a: string;
  b: string;
  kind: string;
  rationale: string;
}

/** Each hard conflict of `name`, as the partner and the conflict. */
function partnersOf(name: string, hard: readonly HardConflict[]): { other: string; c: HardConflict }[] {
  return hard.flatMap((c) => (c.a === name ? [{ other: c.b, c }] : c.b === name ? [{ other: c.a, c }] : []));
}

export function searchOnlyConflictDrops(
  names: readonly string[],
  hard: readonly HardConflict[],
  forced: ReadonlySet<string>,
): ConflictDrops {
  const dropped = new Set<string>();
  const leftOut = new Map<string, ConflictLeftOut[]>();
  for (const name of names) {
    if (forced.has(name)) continue;
    const win = partnersOf(name, hard).find(({ other }) => forced.has(other));
    if (!win) continue;
    dropped.add(name);
    const entry = { name, kind: win.c.kind, rationale: win.c.rationale };
    leftOut.set(win.other, [...(leftOut.get(win.other) ?? []), entry]);
  }
  return { dropped, leftOut };
}
