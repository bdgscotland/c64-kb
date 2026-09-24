/** c64_claims_watch: a program's stores in VICE against the hardware units it declares (#22 step 8). */
import { z } from "zod";
import { ClaimsWatchInput, claimsWatch, type ClaimsWatchReply } from "../tools/claims-watch.ts";
import { defineTool, READ_ONLY, type ToolReply } from "./define-tool.ts";

const Finding = z.object({
  verdict: z
    .string()
    .describe(
      "undeclared, reads_only, kernal_outside_may, unattributed (violations); claimed, harness, kernal_in_may, unowned_io, cpu_port, rom_other",
    ),
  source: z.string().describe("program, kernal, basic or unknown: who stored, from the PC and the banking"),
  target: z.string().describe("A HardwareUnit name, or 'zero page', 'RAM', 'I/O'"),
  by: z.string().optional().describe("The claim or range that allowed it"),
  stores: z.number().int(),
  addresses: z.array(z.string()),
  pcs: z.array(z.string()).describe("Storing PCs, labelled from a .sym beside the PRG when there is one"),
  first: z.string(),
});

export const ClaimsWatchOutput = {
  run: z.object({
    prg: z.string(),
    model: z.enum(["pal", "ntsc"]),
    cycles: z.number().int(),
    entry: z.number().int().nullable(),
    start_clock: z.number().int(),
  }),
  verdict: z.enum(["pass", "fail"]),
  techniques: z.array(z.string()).describe("The techniques declared, their REQUIRES closure included"),
  kernal: z.array(z.string()).describe("KERNAL routines and services whose zero-page may-sets were allowed"),
  declared: z.array(z.string()),
  notes: z.array(z.string()).describe("Techniques with no Claims line: their units are unknown"),
  violations: z.array(Finding),
  findings: z.array(Finding).describe("Every store group, violations included"),
  report: z.string().describe("The CLI's report tables"),
};

export function claimsWatchReply(r: ClaimsWatchReply): ToolReply {
  if (!r.ok) return { text: `refused (${r.reason}): ${r.error}`, isError: true };
  const x = r.result;
  const stores = x.violations.reduce((n, v) => n + v.stores, 0);
  const head =
    `${x.run.prg}, ${x.run.model.toUpperCase()}, ${x.run.cycles} cycles (measured-vice, rung 1)\n` +
    `techniques: ${x.techniques.join(", ") || "none"}; KERNAL: ${x.kernal.join(", ") || "none"}\n` +
    x.declared.map((d) => `  declared ${d}\n`).join("") +
    x.notes.map((n) => `  note: ${n}\n`).join("");
  return {
    text: `${head}${x.report}\n\n${x.verdict.toUpperCase()}: ${stores} stores in ${x.violations.length} violation groups`,
    structured: { ...x },
  };
}

export const claimsWatchTool = defineTool({
  name: "c64_claims_watch",
  title: "Check a program's stores against its hardware claims in VICE",
  description: `Run a .prg headless in VICE x64sc with a store trace and sort every store against what the program declares it may write. Declarations: a recipe (its techniques, and its claims:, harness:, ram:, uses_kernal and kernal_services frontmatter), technique ids (their **Claims:** lines and those of every technique they REQUIRE), explicit claims in the Claims-line grammar, RAM ranges, a measurement harness, and the KERNAL routines the program calls, whose zero-page may-sets (the ROM walk on docs/hardware/kernal-routines-reference.md) bound what the ROM may write for it. The PRG's own load span is always declared.

A store is a violation when the program writes a HardwareUnit or a zero-page byte it did not declare, or declared 'reads' only; when the KERNAL writes zero page outside the may-sets of the declared routines; or when a store comes from a ROM window while the banking in $01 is unknown. Stores before the program's entry (the boot) and stack pushes are dropped; an I/O store counts for the units whose bits it changed. RAM $0400-$CFFF and $E000-$FFF9 is traced only with all_ram. This is the instrument recipes' claims: keys are written from (npm run claims:recipes runs it on every KickAssembler recipe); a technique with no Claims line is named in notes, since its units are unknown.

Needs the windowless x64sc (\`npm run vice:headless\`); refuses a windowed one. The disk is copied; writes are discarded. Reads the docs pages, not the graph.

Inputs: prg_path (inside this repo or the temp directory), recipe (name or page), techniques[], claims, ram, harness, kernal[], screen, model pal|ntsc, cycles, disk_path, all_ram.
Output (structured): run {prg, model, cycles, entry, start_clock}, verdict pass|fail, techniques[], kernal[], declared[], notes[], violations[] and findings[] {verdict, source, target, by?, stores, addresses[], pcs[], first}, report. Refusals (reason path, recipe, setup, no-entry) are text with isError.`,
  inputSchema: ClaimsWatchInput,
  outputSchema: ClaimsWatchOutput,
  annotations: READ_ONLY,
  readsGraph: false,
  run: async (args) => claimsWatchReply(await claimsWatch(args)),
});
