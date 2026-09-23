/**
 * The claims watch's report: violations first, then what the ROM wrote,
 * then a line per unit, the harness, and what the program wrote that no
 * unit owns. Plain text for a person, JSON for the game test's harness.
 */
import { toRanges } from "./kernal-walk.ts";
import { pcList, type ClaimsWatch, type Tally, type Verdict } from "./claims-trace.ts";
import { hex2, hex4 } from "./claims-units.ts";

const addrText = (addrs: Map<number, number>, max = 8): string => {
  const ranges = toRanges(addrs.keys());
  const fmt = (n: number) => (n < 0x100 ? hex2(n) : hex4(n));
  const parts = ranges.slice(0, max).map(([a, b]) => (a === b ? fmt(a) : `${fmt(a)}-${fmt(b)}`));
  return parts.join(", ") + (ranges.length > max ? ` +${ranges.length - max} more` : "");
};

const byVerdict = (w: ClaimsWatch, verdicts: readonly Verdict[]): Tally[] =>
  [...w.tallies.values()]
    .filter((t) => verdicts.includes(t.finding.verdict))
    .sort((a, b) => a.first.clock - b.first.clock);

function table(head: string[], rows: string[][]): string[] {
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

function violationRows(ts: Tally[], label: (pc: number) => string): string[][] {
  return ts.map((t) => [
    t.finding.verdict === "reads_only" ? "claimed reads only" : "undeclared",
    t.finding.target,
    addrText(t.addrs),
    String(t.count),
    pcList(t.pcs, label),
    `${t.first.insn} at clock ${t.first.clock}`,
  ]);
}

/** Unit -> stores by the program and by the ROM, and how the program's were judged. */
function unitRows(w: ClaimsWatch): string[][] {
  const units = new Map<string, { program: number; rom: number; verdicts: Set<string>; by: Set<string> }>();
  for (const t of w.tallies.values()) {
    const f = t.finding;
    if (!/^[a-z][a-z0-9_]*$/.test(f.target)) continue;
    const u = units.get(f.target) ?? { program: 0, rom: 0, verdicts: new Set(), by: new Set() };
    if (f.source === "program") {
      u.program += t.count;
      u.verdicts.add(f.verdict);
      if (f.by) u.by.add(f.by);
    } else u.rom += t.count;
    units.set(f.target, u);
  }
  return [...units]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, u]) => [
      name,
      String(u.program),
      String(u.rom),
      [...u.verdicts].join(", ") || "-",
      [...u.by].join("; ") || "-",
    ]);
}

function section(title: string, rows: string[]): string[] {
  return rows.length === 0 ? [] : ["", title, ...rows];
}

export function reportText(w: ClaimsWatch, label: (pc: number) => string): string[] {
  const out: string[] = [];
  const bad = byVerdict(w, ["undeclared", "reads_only"]);
  const kernalOut = byVerdict(w, ["kernal_outside_may"]);
  out.push(
    ...section(
      `VIOLATIONS: program stores outside the declared claims (${bad.length})`,
      bad.length
        ? table(["why", "unit or region", "addresses", "stores", "PCs", "first"], violationRows(bad, label))
        : [],
    ),
  );
  out.push(
    ...section(
      `VIOLATIONS: KERNAL zero-page stores outside the may-sets of the declared routines (${kernalOut.length})`,
      kernalOut.map((t) => `${addrText(t.addrs, 32)}: ${t.count} stores, ${pcList(t.pcs, label)}`),
    ),
  );
  out.push(
    ...section(
      "Units",
      table(["unit", "program stores", "ROM stores", "verdict", "claimed by"], unitRows(w)),
    ),
  );
  const info = (vs: Verdict[], title: string) =>
    section(
      title,
      byVerdict(w, vs).map(
        (t) =>
          `${t.finding.source} ${t.finding.target}${t.finding.by ? ` (${t.finding.by})` : ""}: ${addrText(t.addrs)}; ${t.count} stores; ${pcList(t.pcs, label, 3)}`,
      ),
    );
  out.push(...info(["harness"], "Harness (declared with --harness; never a violation)"));
  out.push(...info(["claimed"], "Allowed stores, by the claim or range that allowed them"));
  out.push(...info(["kernal_in_may"], "KERNAL zero-page stores inside the may-sets"));
  out.push(
    ...info(
      ["unowned_io"],
      "I/O stores that change no HardwareUnit's bits (VIC colours and modes, CIA control, a same-value write): not judged",
    ),
  );
  out.push(...info(["cpu_port"], "6510 port $00/$01 (banking): not judged"));
  out.push(...info(["rom_other"], "ROM stores outside zero page: not judged"));
  return out.filter((l, i) => !(l === "" && i === 0));
}

export function reportJson(w: ClaimsWatch): unknown {
  return {
    started: w.startClock,
    bootStores: w.bootStores,
    pushes: w.pushes,
    unknownBanking: w.unknownBanking,
    violations: w.violations().length,
    tallies: [...w.tallies.values()].map((t) => ({
      ...t.finding,
      count: t.count,
      addresses: toRanges(t.addrs.keys()).map(([a, b]) => (a === b ? hex4(a) : `${hex4(a)}-${hex4(b)}`)),
      pcs: Object.fromEntries([...t.pcs].map(([pc, n]) => [hex4(pc), n])),
      first: t.first,
    })),
  };
}
