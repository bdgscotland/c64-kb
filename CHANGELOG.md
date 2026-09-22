# Changelog

Versions are in `VERSION` (data, schema, tool surface) and `package.json`.
Entries below start at the first public audit; earlier history is in git.

## Unreleased

Data 707, schema 20, tools 1.22.1.

**Every recipe, toolchain and runtime page audited against the installed
tools, and every recipe now has a reproducible screenshot.** The seven
toolchain and runtime references went through the same auditor, three
refuters and fixer procedure as the earlier waves: 95 corrections, among
them x64sc 3.10 options that do not exist, Oscar64 API names and
signatures checked against the headers on disk, KickAssembler behaviour
measured on 5.25, the cc65 CPU flag for illegal mnemonics, and the
binary-monitor claims. The twenty recipe pages went through a lean pass
instead, one instrument-backed agent per page with no refuter fleet,
because the maintainer asked for the token spend to come down: 102
corrections, 60 claims qualified as not measured here. Among the
corrections: the KERNAL's full interrupt service costs about 190 cycles
idle and about 1,600 with a key held, not "about a thousand" (raster-bars
and the pages that quoted it); the FLI entry pad was one cycle late and
the committed picture showed the symptom on line 52; the side-border
recipe's sixth sprite had the wrong MSB and sat invisible; the Oscar64
soft-scroller wrote PETSCII where screen codes were needed and never
showed its message; the Koala viewer cleared CSEL while enabling
multicolour and embedded a zero-filled stub, and now draws a computed
test image; `vspr_init` does not call `rirq_init`, so two recipes ran
without an IRQ dispatcher; PSID header offsets were shifted by a word;
the filter-cutoff byte split was backwards; `joy_poll(1)` read port 1
where port 2 was documented. Then `verify:recipes` re-ran all twenty
recipes at pinned cycles and every baseline was looked at against its
page before adoption: nine recipes that had no committed picture have one,
six unpinned or wrong-path baselines were replaced, and the NTSC playfield
picture is now taken at the same cycle count as the PAL one. The
soft-scroller's coarse shift still takes about four frames and tears;
that is issue #18. Two cross-page debts the agents flagged were closed by
hand: the raster technique page's KERNAL figure and the stable-raster
recipe's register list. Clean ingest afterwards: 2,605 chunks from 79
files, 574 nodes, 1,308 edges, 0 dropped references, no category refused.

**Schema 20: technique categories for game and application foundations,
and the category set is enforced.** `input`, `logic`, `maths`, `text` and
`io` join the Technique category set, and `render`, which the text-mode
page had used since it was written without ever being listed, is now
listed. The extractor refuses a technique doc whose category is outside
the set, with a warning, the way it already refused an unknown Demands
word; before this a typo would have created a category the briefing
tools do not know. Briefings place input and maths in the memory-layout
step, logic and text in the rendering step, io in the loader step, and
give each a reason string. This is item ONTO-01 of the gap map (#12,
#17) and lands first because the game-foundation pages file under
categories that did not exist. Tools 1.22.1: the `c64_timing_budget`
description said 23 badline cycles and a 14-cycle default IRQ overhead
while the tool computed 43 and 36; the description now matches the
computation and its worked example is the tool's actual output.

**Every technique and pitfall page audited against the instruments.** The
same procedure as the hardware pages — one auditor per page, three
refuters per finding, majority-upheld corrections only — over all 22
pages: 259 corrections landed, each with the earlier wrong statement named
beside it. The largest: the stable-raster polling loop bounds jitter to
one iteration and does not remove it (`double_irq` does); the KERNAL's IRQ
path never executes CLD; a `$0314` handler that ends in RTI pops the
dispatcher's registers as its return frame, and four listings did; the
`$D017` "double-write" trick does nothing and the sprite crunch is one
cycle, one shot and lengthens the sprite; sprite DMA is 2 cycles per
sprite plus 3 per group, never 4; badlines cost 40-43 cycles, plan on 43;
the main-loop joystick "phantom press" race cannot happen; Krill v194
hooks no KERNAL vector; ByteBoozer 2's depacker is about 200 bytes, not
85; every depacker time quoted in milliseconds was under one cycle per
byte; the Oscar64 vspr multiplexer costs about 250 cycles a slot, not 25;
a 1000-cell text redraw does not fit a frame; PSID header offsets were
shifted by a word; the filter cannot be observed from software, so the
ENV3 chip-detect probe never worked. Sixteen findings nothing on this
machine can reach are listed for follow-up. Metadata lines changed on
eight pages, so the graph was rebuilt clean: 2,597 chunks from 78 files,
574 nodes, 1,296 edges, 0 dropped references.

**Every hardware reference page audited against the instruments.** Nine
pages (6510, VIC-II, PAL/NTSC, registers, KERNAL routines, CIA, SID,
memory map, illegal opcodes): one auditor per page, three independent
refuters per finding, majority-upheld corrections only. 193 corrections
landed, each with the earlier wrong statement named beside it — among
them the KERNAL's ~60 Hz jiffy on PAL as well as NTSC, the region flag at
$02A6, the last default badline at 243, the TOD latch on hours, RESTORE
outside CIA2, the SID's held bus byte, $EA7E as an exit rather than a
shortcut, and the rebuilt KERNAL/BASIC ROM sub-maps. Twelve findings the
refuters could not settle with anything on this machine are left as
they stand and listed for follow-up. VICE on this machine is 3.10, and
the instrument table says so.

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

**Source catalogs removed from `docs/`.** `docs/catalogs/` held two
manifests — `source-catalog.json` (137 entries) and
`source-corpus-catalog.json` (71 entries) — plus their two readmes. They
listed third-party C64 sources, per-author repository inventories, and
in-repo path fingerprints (`pattern_signals`) for code this project never
ingested, and the readmes cross-referenced unrelated projects of the
author's. None of it fed the knowledge base: the ingest reads `*.md` only,
so the two JSON manifests were never indexed at all, and the two readmes
carried no frontmatter and no metadata lines, so they extracted zero graph
entities. The measured impact is 18 Qdrant chunks and the `catalogs` bucket
in `c64-kb health`, whose entry in `C64_BUCKETS` (`src/services/qdrant.ts`)
is dropped with them. No graph node, edge, tool, recipe, listing or test
referenced the directory. Doc counts in `README.md` and `CLAUDE.md` drop
from 75/69 markdown files to 73/67.

**README chunk figure re-measured.** It read 2,422 and was stale: neither
`36d1843` nor the 6510 audit in `5526a80` updated it, and the 6510 page
alone went 258 -> 264 chunks. Running `chunkMarkdown` over all 73 files at
this commit gives 2,516, which is what a clean ingest would upsert. The
table now says it is a chunker measurement, not a live collection reading.

Note: the files remain in git history from `fac663a` onward and in the
public fork. Removing them here removes them from the working tree, not
from the record.

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
