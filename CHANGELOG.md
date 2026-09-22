# Changelog

Versions are in `VERSION` (data, schema, tool surface) and `package.json`.
Entries below start at the first public audit; earlier history is in git.

## Unreleased

Data 704, schema 19, tools 1.22.0.

**Two relations the graph could not state.** `REQUIRES` (Technique →
Technique, schema 19): "this technique presupposes that one is set up or
running underneath it", authored with a `**Requires:**` line. Twelve
entries carry one, each from its own text — `text_zoom` requires
`stable_raster_irq` ("a stable raster IRQ set to fire on every scanline"),
`infinite_scroll_h` requires `soft_scroll_h` and `char_scroll_buffer_h`,
`sideborder_open` requires `double_irq`, `ifli_image` requires `fli_image`,
the SID filter, play-routine and hard-restart digi entries require
`sid_voice_setup` (`digi_4bit` does not: it drives the $D418 volume DAC
with every voice gated off, and a line only another entry's text supports
is not authored — an earlier draft had it). `double_irq` is a variant of
`stable_raster_irq`, not a prerequisite, and has no REQUIRES edge to or
from it; it is the target of `sideborder_open`'s REQUIRES and of
`raster_irq_first_line_jitter`'s MITIGATED_BY. `MITIGATED_BY` (Pitfall →
Technique): "applying this
technique is the Fix", authored with `**Mitigated by techniques:**`, which
separates the remedy from the trigger the one vocabulary used to carry —
`sprite_dma_overflow` is triggered by a naive multiplexer and mitigated by
a correct one, `raster_irq_first_line_jitter` by `stable_raster_irq` and
`double_irq`, the three region-timing pitfalls by `pal_ntsc_detection`,
which had no edge to any of them, and `jmp_indirect_page_boundary_bug` by
`jump_table_dispatch`'s store-then-jump form. Both edges MATCH both ends
(no stubs from typos), are counted in the ingest summary, and a REQUIRES
line that would close a cycle is refused. `BUILDS_ON` is still listed and
still emitted by nothing; the ontology now says so.

**Tools (1.22.0, additive).** `c64_technique_lookup` gains `requires`,
`required_by` and `mitigates`; `c64_techniques_for` gains a `requires`
filter that follows the chain; `c64_pitfalls_for` answers for a technique
that is only a remedy and reports `mitigated_by[]` apart from
`triggered_by[]`; `c64_check_compatibility` takes each technique's
REQUIRES closure and runs its hard rules between one technique's
prerequisites and the other, reporting `prerequisite_conflict` (with the
implied techniques in `via`) and a `missing_prerequisite` note for every
technique the set leans on without naming — never against a prerequisite
the technique declared itself, and without changing any technique's
demands. `c64_suggest_links` proposes `pitfall_mitigated_by_technique`
for a technique named in a Fix section instead of misfiling it as a
trigger. `text_zoom` also gains `**Demands:** midframe_raster_irqs` from
its own text, so `fli_image + text_zoom` is refused directly (cpu_vs_irq)
rather than through a closure that both techniques' shared prerequisite
would silence. Single-file ingest (`ingest-doc`) now applies `DEMANDS`
edges too; it had skipped them — and `OCCUPIES` (a recipe's load
addresses), which an exhaustiveness guard added to its switch found
skipped as well; the next omission is a compile error, not a silent skip.

**RESTORE is not a CIA2 interrupt source.** Three pages said the RESTORE
key reached the CPU through CIA2's /FLAG pin as `$DD0D` bit 4 and that
`$DD0D = $10` switched it off; the key drives the 6510's /NMI pin directly,
in parallel with CIA2's /IRQ, and no `$DD0D` write affects it. The KERNAL
handler at `$FE43` is `SEI : JMP ($0318)` with the register pushes at
`$FE47` *after* the vector, no BRK test, and a `BMI` on `$DD0D` bit 7 —
it recognises RESTORE by finding *no* CIA2 flag (ROM bytes of 901227-03).
New pitfall `restore_nmi_not_maskable` in `pitfalls/kernal-and-io.md`,
triggered by `DD0D`, `RESTOR`, `VECTOR`: taking `$0318` costs 20 cycles a
press (7 + 2 + 5 + 6), and an unacknowledged CIA2 NMI locks the
edge-triggered input (two Timer A underflows, one NMI) — both measured in
VICE x64sc 3.10. `cia-reference.md`'s NMI-vector list and its
"re-entered immediately because the 555 still holds the line low" bullet
rewritten; `c64-registers-reference.md` and `c64-memory-map.md` wiring
lines corrected; the reset table's `$DC00 = $7F` now reads "column 7 low".

## 0.8.0 — 2026-09-22

Data 702, schema 18, tools 1.21.1.

**Recipes: assembled, run, rewritten.** None of the eight KickAssembler
recipes had been assembled before this release: six did not assemble, one
ran and did nothing, one was a plain raster IRQ named "stable". All eight
are rewritten, built with KickAssembler 5.25, run headless in VICE x64sc
and measured from the screenshot, with the pictures kept in
`docs/recipes/kickassembler/screenshots/`. Four Oscar64 recipes fixed
(compiler crash on a const function pointer, unreferenced stub array
dropped by the linker, IRQ slot table overflow, GCC attribute syntax).
`npm run check:listings` builds every listing and is part of `npm test`.

**Technique text corrected.** Badline budget is 20 cycles guaranteed
(23 optimistic), not 23 flat. FLI is a forced badline per line with the
$D011 write on cycle 15. The side border is one write cycle (56) with no
left-border toggle. VSP is a late-$D011 DMA delay, not a CSEL toggle. The
KERNAL dispatcher is at $FF48 (29 cycles); $EA31 is the full service
routine, $EA81 the bare exit. DEN is sampled once per frame on line $30.

**Compatibility checker can say no.** Technique entries carry a
`**Demands:**` line from a fixed vocabulary; `c64_check_compatibility`
derives hard conflicts (cpu_exclusive, cpu_vs_irq, sprite_set,
kernal_banked_out, region_mismatch) with a resolution each, keeps shared
register / KERNAL as soft warnings, and reports per technique what the
graph does not know instead of clearing it. `timing-budget` uses 43 cycles
lost per badline and 36 of IRQ overhead.

**Graph and ingest.** New `Resource` node label and `DEMANDS`, `IN_REGION`,
`OCCUPIES` edges (schema 18). Ingest deletes a file's old chunks before
upserting, `--clean`/`--force` recreate the vector collection, unresolved
references are warned about and counted, and eight that had been dropped
silently are fixed in the docs.

**Hardening.** `npm test` runs against a throwaway graph and collection.
README, ARCHITECTURE and ONTOLOGY rewritten to match the code: 23 tools,
12 resources, 12 node labels, 15 edge types, Node 24, root `.mcp.json`.
Eight npm scripts pointing at files not in this repository removed.
