/**
 * The REQUIRES closure of a compatibility check. A technique's
 * prerequisites (**Requires:** in CONVENTIONS-techniques.md) take part in
 * the check without being named: text_zoom presupposes stable_raster_irq,
 * so the stable IRQ's demands are in play whenever text_zoom is.
 */

export interface RequiresClosure {
  /** Each technique reached through REQUIRES → the inputs whose chain reaches it. */
  impliedBy: ReadonlyMap<string, ReadonlySet<string>>;
  /** Techniques that entered the check only through a REQUIRES chain, sorted. */
  closureOnly: string[];
  /** Everything x's REQUIRES chain reaches, inputs included. */
  closureOf(x: string): string[];
  /** "x requires m (via a → b)" for one input and one closure member. */
  describeChain(input: string, member: string): string;
  /** True when `to` is on `from`'s REQUIRES chain. */
  reaches(from: string, to: string): boolean;
}

/**
 * Walks REQUIRES from each input breadth-first. chainOf keeps the first
 * chain found per (input, member) for the rationale text. Ingest refuses
 * cycles; the visited set guards anyway.
 */
export function requiresClosure(
  techniques: readonly string[],
  requires: ReadonlyMap<string, readonly string[]>,
): RequiresClosure {
  const inputSet = new Set(techniques);
  const direct = (name: string): readonly string[] => requires.get(name) ?? [];
  const impliedBy = new Map<string, Set<string>>();
  const chainOf = new Map<string, string[]>();

  for (const input of techniques) {
    const visited = new Set<string>([input]);
    const queue: { name: string; chain: string[] }[] = [{ name: input, chain: [input] }];
    for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
      for (const p of direct(cur.name)) {
        if (visited.has(p)) continue;
        visited.add(p);
        const chain = [...cur.chain, p];
        const inputs = impliedBy.get(p) ?? new Set<string>();
        inputs.add(input);
        impliedBy.set(p, inputs);
        chainOf.set(`${input}|${p}`, chain);
        queue.push({ name: p, chain });
      }
    }
  }

  const closureOnly = [...impliedBy.keys()].filter((n) => !inputSet.has(n)).sort();
  const allNames = [...techniques, ...closureOnly];

  return {
    impliedBy,
    closureOnly,
    closureOf: (x) => allNames.filter((n) => n !== x && (impliedBy.get(n)?.has(x) ?? false)),
    describeChain: (input, member) => {
      const chain = chainOf.get(`${input}|${member}`) ?? [input, member];
      const middle = chain.slice(1, -1);
      return `${input} requires ${member}${middle.length > 0 ? ` (via ${middle.join(" → ")})` : ""}`;
    },
    reaches: (from, to) => {
      const seen = new Set<string>([from]);
      const queue = [from];
      for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
        for (const p of direct(cur)) {
          if (p === to) return true;
          if (!seen.has(p)) {
            seen.add(p);
            queue.push(p);
          }
        }
      }
      return false;
    },
  };
}
