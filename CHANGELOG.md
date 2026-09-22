# Changelog

Versions are in `VERSION` (data, schema, tool surface) and `package.json`.
Entries below start at the first public audit; earlier history is in git.

## Unreleased

Data 718, schema 22, tools 1.25.0.

**A cost line per technique, so a briefing can add a plan up (#17).** A
technique page may now carry `**Cost:**` with integer pairs from a fixed
vocabulary (`cycles_per_line`, `cycles_per_frame`, `lines_active`,
`bytes_code`, `bytes_data`, `zp_bytes`, `irq_slots`) and a companion
`**Cost basis:**` line that says how the figures were obtained, one word
from `measured-vice`, `derived-listing`, `arithmetic` or `estimated`.
The extractor skips an unknown key or a non-integer value with a
warning and drops the whole line for a basis word outside the set or a
missing basis line; the values land on the `Technique` node as
`cost_<key>` and `cost_basis` (schema 22), cleared again when a page
drops the line. `c64_technique_lookup` returns them as `cost`.
`c64_demo_briefing` and `c64_game_briefing` gain a `budget` block: the
sum of `cycles_per_frame` over the proposed set against the region's
frame (PAL 19,656; NTSC 17,095) and the sum of code and data bytes
against a stated 38,911-byte budget, with the techniques that have no
cost line named so the sums read as floors, an over or under verdict,
and the weakest basis word among the contributors. The techniques
whose recipe pages state figures carry a line, each figure taking the
basis its page supports and no more; a figure the page measured in VICE is `measured-vice`, one
read off a build's segment listing is `derived-listing`, one worked
from settled constants is `arithmetic`, and a judgement is `estimated`.
`cycles_per_frame` is the worst frame the technique produces, not an
average, and it is the technique's own work: the soft scroller states
its carry frame as the shipped listing measured it, the frame-sync loop
does not state its demonstration's stand-in payload, and a level-start
map expand states nothing per frame.
`c64_timing_budget` no longer reads `t.irq_overhead`, a property nothing
ever wrote; the read always fell through to the 36-cycle default and
the constant now stands alone.


**The text monitor for debugging, and cc65 symbols in it (#15).** The
VICE reference gained a section written from real sessions: how to reach
the monitor prompt headless (the `-console` route fails on this build,
measured; the remote monitor works), the stop and register lines and
what their columns mean, step, next and until, break, watch and
conditional breaks with their transcripts, measuring cycles between two
breakpoints from two register lines and cross-checking the delta against
sim6502 and arithmetic, memory dump and save, and what `-limitcycles`
does to a stopped machine. The cc65 page gained "Debugging with VICE":
build with the label-file flag, load the labels, break on `_main`, the
hit quoted. The symbol-file table names the cc65 route.

**Demo forms are archetypes too (#17).** The cracktro pattern page is now
an archetype reference of kind `demo`: the crack intro, the demo intro,
the pack intro, the dentro and the 4K party intro are each an `Archetype`
node with the same `FEATURES` and `RISKS` edges the game page has, every
name taken from the page's own text and checklist and resolving in the
graph. Demo parts are not a node type; a form is one node. `c64_demo_briefing`
gains an optional `archetype` input and the path `c64_game_briefing`
already had: the form's fingerprint is forced into the plan past the
three-per-category cap, its pitfalls join the pitfalls, and the output
carries `archetype` or `archetype_not_found` with every known name across
both kinds. A demo form has no built-in fallback table. The CLI's
`demo-briefing` gains `--archetype` and honours `--json`. Tools 1.24.0
for the input; data 717 for the page.

**Batch seven: multi-file projects and error tables on the toolchain
pages, a sprite sine chain, a luminance fade.** Each toolchain page has
a "Multi-file projects" section with a real two-file project built and
the failing forms provoked (Oscar64 pulls a library's source in through
`#pragma compile` from its header; one positional file with an extern
fails with 3022; KickAssembler's `.import source` without a namespace
clashes), and a "Reading the errors" table whose every message was
provoked against the installed tool and quoted verbatim, the minimal
sources kept under `toolchains/error-sources/`. `sprite_sine_chain` on
the sprite page with the `sprite-sine-chain` recipe: eight sprites
phased along one table across the full width with the $D010 wrap on the
picture; the cracktro pattern page had named a multiplexer for this. A
new `techniques/transitions.md` with `colour_fade` and the `colour-fade`
recipe: a sixteen-step luminance-ordered fade, pinned mid-way on both
models with every bar's colour checked against the table's formula; the
first listing had an index overflow at the last step that the review
caught. Colour cycling and the screen wipe are still to be written on
that page.

**The 1541 DOS error codes (#14).** The IEC disk reference gained a
table of every channel-15 code the 1541 DOS 2.6 ROM can produce, with the
message text as the ROM spells it, the cause, and a class for an agent
(retry, media, user error, program bug), read from the drive ROM image on
this machine with the offsets cited, plus the mapping from D64 error
bytes to DOS codes, which are not the same numbers. Four codes are
provoked against a fresh disk by the `dos-error-codes` recipe and the
replies pinned on both models; the codes that come only from the ROM text
are marked as such. The file I/O page's two "not measured here" notes on
message length and on codes 74 and 01 are closed by this and by the
persistence recipe.

**Game archetypes are graph nodes (#17).** The archetype page had a
technique fingerprint and a pitfall list for every archetype, and
`c64_game_briefing` read none of them: it widened the search from a four-word table in code,
forced techniques from a two-entry table and seeded a recipe for the one
string "shmup". The page is now the source of truth. Each H2 with an
`**Archetype:**` line is an `Archetype` node; its fingerprint becomes
`FEATURES` edges to techniques and its common-pitfalls line `RISKS` edges
to pitfalls, both MATCHed at both ends so a misspelt name is warned about
and counted in the ingest summary, never dropped in silence
(`docs/CONVENTIONS-archetypes.md`). The briefing looks the archetype up,
forces every `FEATURES` target into the plan (exempt from the
three-per-category cap), adds every `RISKS` target to the pitfalls and
searches on the archetype's title; the output gains an `archetype` field
repeating what the graph held, and a name the graph does not have returns
`archetype_not_found` with the known names instead of doing nothing. The
built-in tables survive only for a graph with no Archetype nodes, which
is what the test fixtures build. Schema 21 for the label and two edge
types; tools 1.23.0 for the two output fields; data 714 for the page.

**Two ontology repairs from the gap map (#17).** The briefing's toolchain
handoff now decides by what a technique demands of the machine, read from
the DEMANDS edges the compatibility checker already uses, instead of by
category name: a technique that needs the CPU every line, raster
interrupts inside the display, interrupts all frame, a badline-free
region or a changing sprite set goes to KickAssembler, as does anything
scene-tier. By category, starfield (effect) was handed to assembly and
sprite_multiplex_24 (sprite) to C. And the recipe-to-tool link the
ingester had always written now carries the ontology's name,
`REQUIRES_TOOL`; it had been written as `USES`, which is why the
ontology listed `REQUIRES_TOOL` as populated by nothing while the fact
sat in the graph under the wrong label. Only `BUILDS_ON` remains
unpopulated. Tools 1.22.2 for the handoff change (no surface change).

**Batch five: save-file policy, a sound-effect engine, memory layout in
three toolchains, headless verification.** A "Save-file policy" section
on the game-design page with the `high-score-persist` recipe: first run
with no file, scratch-then-write with the scratch reply read, a version
byte, and what the KERNAL reports with no disk (74) and with no drive
emulated at all (the OPEN never returns in VICE; a real empty bus is not
measured). Two things it measured that the file I/O page had marked as
not measured: the drive's 74 reply and the command channel's "01, FILES
SCRATCHED" reply, which is lost if channel 15 is closed before it is
read. `sfx_engine_beside_music` on the SID page with the `sfx-engine`
recipe: a table-driven effect with priority, borrowing a voice from a
tune that writes all three and giving it back, verified at register
level with a checksum over the writes; the page says nobody has listened
to it. A new page `toolchains/memory-layout-planning.md`: the constraints
that decide a layout and one worked layout expressed in KickAssembler,
Oscar64 and cc65, each confirmed from its map output and each with a
`memory-layout` recipe pinned on both models; the cc65 one needed a
linker configuration, so `check:listings` and `verify:recipes` now pass
a config a cc65 page carries in a fence tagged `cfg`, which is what let
that recipe land instead of being held back. "Verifying a run without a
human" on the VICE reference with two `headless-verify` recipes: a
result byte at $02FF and the border colour, read back either from the
exit screenshot or over the monitor, returning a shell exit code; both
routes run on the green and the red case.

**Batch four: double buffer, Oscar64 save and load, text input, the IRQ
chain.** `screen_double_buffer_d018` on the banking page with the
`double-buffer` recipe and a companion built without the sprite-pointer
mirror, whose corrupted sprite is identified byte for byte; the
game-design page's "2 KB per page" corrected to 1 KB. The
`save-load-seq-file` recipe: Oscar64's kernalio.h writing a score table,
reading it back with the library status after every step and the drive's
own reply, and a provoked 62 FILE NOT FOUND. A new page
`techniques/text.md` (category `text`) with `text_input_line` and the
`text-input` recipe, driven headless through VICE's keyboard buffer with
the escape syntax that actually works quoted. `irq_chain_table` on the
raster page with the `irq-chain` recipe: a three-slot table walked by one
dispatcher, band boundaries measured from the picture and the frame
counter predicted and matched. The verifier now switches the emulated
drive's RPM wobble off for disk recipes: with it on, a disk run's elapsed
cycles moved by a digit between runs and the NTSC round-trip picture
failed to repeat.

**Batch three: object pool, KERNAL file I/O, and the instrument itself
documented.** An "Object pool" section on the game-design patterns page
with the `object-pool` recipe: slot table, spawn scan and free list,
wave-table byte layout, despawn, per-slot timers, iterating active slots
only, each timed, and the scripted scenario checksummed on the 6502. A
new page `techniques/file-io.md` under the `io` category with
`kernal_file_write_seq`, `kernal_file_read_seq`, `error_channel_check`
and `kernal_load_to_address`, linked from three existing pitfalls, and
the `file-io-roundtrip` recipe, which writes a file to a fresh disk,
reads it back, checks the error channel before and after and prints the
match and checksum; the verifier formats that disk with c1541 before
every run. The VICE reference gained rows for every flag the KB's own
protocol uses, each confirmed against `x64sc -help` and the
autostart modes measured, and a section "Reading the exit screenshot"
with the pixel geometry for both models, the sixteen palette RGB triples
measured by the new `palette-cells` recipe, and a decode snippet; the
recipe conventions, CLAUDE.md and the screenshot READMEs now point at it
instead of carrying their own copies.

**Game foundations, batch two: tile maps, printing numbers, random
numbers, lookup tables.** Four more gap-map items (#13, #16), same
writer, reviewer and reviser shape. `tile_map_render` on the scroll page
with the `tile-map-render` recipe: a hand-written RLE-compressed metatile
map decoded to screen and colour RAM, every one of its 880 cells compared
against a Python render of the same source data with zero differences,
and the decoder's cost measured. A "Printing numbers" section on the
game-design patterns page with the `print-number` recipe: subtract-powers
and double-dabble in C and in assembly, every value from 0 to 65535
rendered on the 6502 and folded into a checksum that matches Python, and
the routes timed, which corrected the page's earlier "about 300 cycles"
for double-dabble. `lfsr_random` on the maths page with the
`lfsr-random` recipe and a fixed-seed companion: 8- and 16-bit LFSRs
with measured periods and a histogram, seeding from SID voice 3 noise
with the output muted, the CIA timer and player timing, and a new
pitfall `lfsr_zero_state_lockup` with its MITIGATED_BY edge.
`table_generation` on the CPU tricks page: sine, reciprocal and multiply
tables at KickAssembler assembly time and in Oscar64, with the table bytes
dumped from the built PRG and diffed to zero against Python for two
scalings. Cross-links added from the pages that already used these
things without naming them (the scroll pattern, the CharPad section, the
sine scroller, the `.fill` row, the perspective divide, the $D41B
paragraph).

**Game foundations, batch one: input, the frame loop, fixed-point
movement.** The first additive batch from the gap map (#12, #13),
written by one writer, one reviewer and one reviser per item. Two new
technique pages and one new entry: `techniques/input.md` with
`joystick_edge_detect`, `joystick_autorepeat` and `keyboard_matrix_scan`
(category `input`); `techniques/maths.md` with `fixed_point_8_8`,
`table_multiply_8x8` and `jump_arc_table` (category `maths`); and
`frame_sync_loop` on the raster page, with the seven `vic_wait*`
functions documented on the Oscar64 headers page from the header and its
source. Each has an Oscar64 recipe with pinned, measured screenshots on
PAL and NTSC: `joystick-input`, `frame-sync-loop` (plus a deliberate
overrun build that shows the budget bar wrap and the dropped-frame
counter climb), and `fixed-point-jump`. The arithmetic is checked
exhaustively on the 6502 itself: the edge and repeat logic over all
65,536 previous/current port pairs, the tick arithmetic over all 65,536
counter pairs, the multiply and signed add over all 65,536 operand
pairs, each folded to a checksum that matches the same computation in
Python and is quoted on the page. What could not be done headless is
said plainly: no joystick or key was pressed in any run, so the live
counters prove the no-input state and the logic is proven by the
exhaustive checks.

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
