# Changelog

Versions are in `VERSION` (data, schema, tool surface) and `package.json`.
Entries below start at the first public audit; earlier history is in git.

## Unreleased

Data 734, schema 24, tools 1.29.0.

**Candidate list, Tier A batch 5 (data 734).** Four corrections and one
new technique, each measured with a tool built or driven here. The
KERNAL tape encoding: the TAP section said two pulse lengths; a TAP that
the windowless VICE recorded from a real SAVE shows three (modes 376,
536 and 704 cycles), a bit as a pulse pair, a byte marker, twenty pulses
a byte with odd parity, the countdown from `$89` and from `$09`, two
copies of every block and the XOR checksum, all decoded with no parity
failure over 448 bytes; new pitfall `tape_bit_is_a_pulse_pair_not_a_pulse`.
GoatTracker: the asset-pipelines page named a converter, `gt2asm`, that
the 2.77 distribution does not contain (it ships five executables, and
the export path is the relocator, `gt2reloc`, measured: 1,786 bytes at
`$1000` for one example song, byte-identical when imported into
KickAssembler); the five wrong invocations are corrected and a `.SNG`
field table joins the formats page, checked by parsing the distribution's
fourteen example songs. `pwm_digi` on the SID page with a recipe: the
sample rides the pulse width under a fixed carrier; measured from a WAV
VICE wrote, the carrier at 3,848.6 Hz and the recovered tone at 240.5 Hz
against a synthesised 240.54 Hz, 128 cycles a sample kept exactly on
both models, reSID's 8580 at 0.74 of the 6581's level; the page's
TEST-bit paragraph now says it was not Harsfalvi's method. Nobody
listened. Exomizer 3.1.3b0 built from source: the default stream is
`-P39`, `-P0` differs in 86 bytes, and the shipped decruncher at its
defaults decrunches `-P39` and crashes on `-P0`, `-P7` and `-P55` (the
`-P0` case ran its output pointer below the destination and overwrote its
own data), while a single-bit mismatch completes silently with wrong
bytes; new pitfall `exomizer3_proto_flags_mismatch`, `exomizer_basics`
corrected in place. Left open: the PWM loop's true floor between 36 and
128 cycles a sample; the GoatTracker GTS2 to GTS4 layouts; an Exomizer 2
decruncher against a 3.x stream.

**Code quality, phases C–F (tools 1.29.0, package 0.9.0).** Every MCP
tool now has a `title` and `annotations` (read-only, destructive,
idempotent), per the MCP spec; names, descriptions and schemas are
unchanged. Search returned a different top five on repeated identical
queries: Qdrant orders RRF-tied points arbitrarily. Ties now break by
point id. The code was restructured without changing output: 20 CLI
commands, text and JSON, are identical to the previous tree; a clean
ingest into a throwaway graph gives the same 717 nodes, 2903 edges and
3555 points. `extractGraphEntities` (cognitive complexity 291),
`checkCompatibility` (150), `buildBriefing` (97) and ingest's `main`
(81) are now tables of small functions, each under 15. The compatibility
rules are a pure function with their own tests, and its per-technique
queries are batched. ESLint (typescript-eslint strict, a complexity
budget), Prettier and knip are gates: 848 lint findings to 0. The
type check adds `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`. `health` reported an unreachable graph as
healthy with zero nodes; it now fails. The CLI rejects out-of-set
values for `--region`, `--toolchain`, `--language`; `pal-ntsc-diff`
fell back to "both" silently. `verify:recipes --jobs` ran jobs one at a
time; it now runs them in parallel. CI runs the gates (the VICE
screenshots included: a Linux build of the headless VICE matched every
pinned PNG it could run). Oscar64 recipes pass only with a locally
patched compiler; that is #25.

**Design layer, slice 1 (data 733).** Four pages above the mechanics
layer, written as original prose from public sources by people who
shipped, facts and names only: `game-design/game-structure.md` (the
state machine, level end conditions, level transitions, the front end
and attract mode), `game-design/enemy-behaviour-and-difficulty.md`
(interaction patterns, personality by target, attack pattern tables, the
difficulty ramp, a playtest protocol), `game-design/production-planning.md`
(build order, memory budget first, scope and region, tooling and editors,
where the surviving documents are) and `demo-design/demo-composition.md`
(the part lifecycle, transition conditions, pacing and length, music
continuity across parts, the composition workflow). Each pattern is an
H2 in the technique style with `Kind`, `Applies to` (archetypes that
exist), `Realised by` (techniques and recipes that exist), `Sources` and
a `Checks` list of statements a headless harness can test on a build.
The extractor reads these pages as prose only; the metadata lines are
laid out so a later extractor can read them without a rewrite (issue 24
has the plan for Pattern nodes and a Structure section in the briefing).
The pages exist because every game generated from the base on
2026-09-22 shared three faults they describe: levels ending on a frame
counter, sprites and score digits left on the title after game over, no
working restart. Nothing on them was measured in VICE; every figure is
its source's or arithmetic, and each page says what its sources did not
say. Not found in the sweep and therefore not on the pages: attract-mode
construction from an original developer, music direction from a
composer, first-person design retrospectives of the major demos.

**Issue #21, ES-15 to ES-18.** `iffl_single_file` (the KERNAL skip
fallback, measured; drive-side scan described, not built),
`runtime_relocation` (two-origin diff, 855 cycles for 19 bytes),
`sfx_in_player` and `goattracker_player_api`, and
`irq_owns_processor_port` (18 cycles a handler), each with a recipe
pinned on PAL and NTSC.

**Issue #20, corrections.** The Sparkle section is rewritten from its
manual (by Sparta, PAL and NTSC, blocking calls, 72 cycles a byte); the
`$DD00`/`$DD02` rule is scoped per loader; the VSP crash paragraph follows
lft's article (no detection method); GoatTracker 2 has one SID model
setting; a new pitfall for SID replacements that cannot read `$D41B`;
`c64-file-formats` now says a last sector stores the index of the last
used byte. Each carries a correction clause.


**Candidate list, Tier A batch 4 (data 731).** Three of the four items
landed. `mouse_1351_read` on the input page with a KickAssembler recipe:
the 1351's proportional mode is a six-bit position counter in bits 1 to
6 of the pot registers, not the quadrature the SID page still describes.
Measured in VICE's 1351 model: the masked counter read 32 on both axes on
every one of 250 frames on PAL and NTSC, raw bit 0 changed between
consecutive frames over a hundred times per run, so the picture prints
the masked value only; the signed modulo-64 delta is checked on ten
compiled-in samples including both wraps and both half-turn cases; one
read of both axes costs 104 cycles by the instruction count and 103 by
the CIA timer, a one-cycle gap the page leaves open. The buttons' lines
(fire and up) are from the documentation, not pressed here. The SID
page's quadrature sentence is reported, not edited (see issue 9).
`fld_flexible_line_distance` on the raster page with a recipe that
bounces the display by rewriting YSCROLL each line: the top text row sat
exactly N lines lower on both models, the first badline landed on line
51 plus N on every frame, and every gap line showed the idle fetch of
`$3FFF`, which is the new pitfall `idle_fetch_byte_shows_in_gaps`; a
YSCROLL value that matches the next line only at its first cycle moves
the display one line, not N. The sideborder recipe's dangling `fld` and
`vsp` links now point at real techniques. `d64_error_byte_is_a_controller_code`
on the loader page, with the D64 section of the file-formats page
corrected in place: the per-sector byte is the controller's job code,
and read back through the drive's error channel under VICE 3.10 the codes
`$02`, `$03`, `$04`, `$05`, `$09` and `$0B` are honoured and `$07`, `$08`
and `$0F` ignored; a lone sector flagged `$03` or `$0B` reads 20, and
only a whole track carrying the code reads 21 or 29. The IEC page's
"not measured here" sentence on that point now cites the measurement.
The eight-way scroller did not land: its writer stalled six times in the
reading phase and runs again alone.

**Runtime fixes, phase B (tools 1.28.1, package 0.8.1).** Nothing
listened for the FalkorDB client's `error` event, so a FalkorDB restart
would throw and end the MCP server; it now logs to stderr and the
client reconnects. Two tool calls on a cold server each opened a
connection; the connection promise is now shared. The server ignored
stdin closing, the MCP spec's shutdown signal; it now closes its
connections and exits (6 ms after stdin closed, measured by the new
`test/mcp-stdio.test.ts`, which also asserts stdout carries only
JSON-RPC). It reported version 0.1.0; it reports the package version.
`c64_ingest_doc` indexed new content without writing it when the file
existed, and kept a page's old chunks, so removed sections stayed
searchable; it now writes the file and replaces the chunks.
`c64_run_game` and the memorization check returned failures without
`isError`; the memorization tool is registered only where `analyzer/`
exists, which is not this repository. `c64_run_game` killed every
`x64sc` on the machine; it kills only the one on its monitor port.
`ensureSchema` swallowed every error, not only "already indexed" and
"Constraint already exists" (messages measured on FalkorDB 4.18.7).
Gap logging ran select-then-insert without a transaction across two
processes. CLI commands ended in `process.exit()`, which can truncate
piped `--json`; they now close their connections and set the exit code.
A malformed environment variable stops start-up with its name instead of
becoming `NaN`.

**Issue #21, ES-11 to ES-14.** `nav_area_pathfinding` (a next-hop table
over platform areas; 0 of 160 hops differ from a Python model),
`multi_sprite_object` (a boss from six sprites across the X 255 seam,
registers checked every frame), `charset_parallax` (background glyphs
rolled at half the foreground's speed; 0 of 55,936 pixels differ from a
model), `world_state_bits` and `password_encoding` (every single-letter
typo and every neighbour swap caught for all 2^20 states). A new Oscar64
gotcha, measured: at -O1 to -O3, `c == 255 ? 255 : a[c]` with `a`
shorter than 256 loses its guard and reads `a[255]`.


**Tooling, phase A (no tool surface change).** `tsc --noEmit` checked
`src/` only, so `scripts/` and `test/` were never type-checked; three
errors in `test/config.test.ts` and six unused symbols had gone unseen.
`tsconfig.json` now checks all three and emits nothing;
`tsconfig.build.json` builds `dist/` and leaves tests out. Relative
imports end in `.ts`, so Node 24.12+ runs the sources directly and `tsx`
is gone (`node src/cli.ts`, `npm run health`, `npm run typecheck`). `npm
pack` shipped no `dist/` (`.gitignore` excluded it and there was no
`files` list), so a published `bin` would not have run; `files` and
`prepack` fix that. Removed four dependencies nothing imported (`yaml`,
`js-yaml`, `@types/js-yaml`, `@anthropic-ai/vertex-sdk`). Qdrant and
FalkorDB are pinned by digest instead of `:latest`. Tests split into a
`unit` project (no services, parallel) and an `integration` project. The
Claude Code hooks match `Edit|Write` (`MultiEdit` no longer exists), call
the project's own `tsc` (`npx tsc` without `node_modules` fetched an
unrelated package), and a new Stop hook builds `dist/` and runs the unit
tests once per turn instead of rebuilding after every edit.

**Candidate list, Tier A, batch 3.** The start-up hang a blind build hit is
now a pitfall with a measured table behind it,
`first_open_after_reset_hangs_on_pal`: on PAL a program whose first OPEN
follows the autostart by ten frames hung three times out of three while
zero, five, twenty and fifty frames ran, so the wait is not the cure it
looked like; NTSC never hung; loading the program through the drive
instead of injecting it ran to game over; the monitor at the hang shows
the C64 waiting for CLK with the drive a few dozen cycles from TALK, and
why it never arrives unperturbed is still open. `level-rle-decoder` (Oscar64)
compresses three real-shaped rooms, decodes them on the machine against a
host checksum and shows ratio, cycles and decoder bytes per room; the
patterns page's unmeasured ratio and decoder-size sentences now carry the
measured figures. `paddle_read` on the input page with the KickAssembler
recipe `paddle-read`: the port-select dance, the settle measured on both
models (within 480 cycles at six of eight phases, 544 at two) and the
keyboard scan's interference counted; positions and buttons are not
measured because a headless host cannot move a paddle. The eight-way
scroller planned for this batch did not land: its writer stalled and will
run again on its own.

**Issue #21, engine subsystems ES-01 to ES-10.** Ten techniques from an
online sweep of how shipped games were built, each with a recipe pinned on
PAL and NTSC: `sprite_multiplex_game` (an assembly multiplexer with the
sort kept between frames and a late-IRQ guard; 611 cycles for 24 sorted
actors), `scroll_panel_split` with the pitfall
`scroll_phase_breaks_panel_split` (a naive split breaks at one YSCROLL
phase, the split line mod 8, measured at all eight), `logic_rate_decoupling`,
`actor_activation_window`, `wave_director`, `per_frame_hitbox`,
`char_bullets`, `sprite_cache_flip`, `sprite_animation_table` and
`slope_collision`. Each Cost line is the measured worst frame of the
technique's own work. Facts from Cadaver's articles and c64gameframework
(MIT), codebase64 and Corescape (GPL); the code is original.

**Ontology from #21 (schema 24, tools 1.28.0).** A `**Raster band:**` line
on techniques: `c64_check_compatibility` no longer reports two
every-line techniques as a conflict when their stated bands are disjoint,
and lists such pairs in `band_separated`; FLI, AFLI and IFLI state
45-251, the side border `movable`. `c64_timing_budget` subtracts sprite
DMA (3 + 2 per sprite, the minimum for sprites numbered without gaps;
input `sprites_per_line`); it did not before. The Demands word
`serial_bus_exclusive` on the Krill loader, with a hard conflict
`serial_bus_busy` against techniques that call KERNAL serial routines.
Tool nodes carry `version_verified` from the toolchain pages. Corrections:
`multi_load_sequencing` said `Uses kernal: LOAD`, but it loads through
Krill; the ontology's Tool table listed a `category` the code never
wrote. `dd00_plain_stores` was not added: it is Bitfire's rule and false
for Krill.


**Candidate list, Tier A, batch 2.** `charset_copy_rom_to_ram` on the
banking page, with the KickAssembler recipe `charset-copy-rom-to-ram`: the
2 KB copy under the I/O window costs 19,733 cycles with the display off
and about a thousand more with it on, the copy is checked against the
ROM image's checksum, and the same program makes the copy once with
interrupts enabled and shows what happens: the KERNAL interrupt fires
into the mapped ROM and the loop never finishes, caught by a timer NMI
watchdog. That is the new pitfall `irq_during_charen_window`.
`nmi_handler_and_restore_key` on the CPU page, with the recipe
`nmi-timer-tick`: the vectors, the RTI stub that disarms RESTORE, the
`$DD0D` acknowledge and the lock without it, measured with a CIA2 timer
standing in for the key the rig cannot press; a new pitfall
`kernal_nmi_handler_runs_stop_check`. `software_sprite_preshifted` on the
sprite page, with the recipe `software-sprite-preshifted`: a 24x21 masked
object pre-shifted for eight positions in a character back buffer, 1,428
cycles a blit at every shift, against the multiplexer for when each wins.
A new pitfall `sprite_x_range_hidden_and_seam` with the visible window
measured column by column on both models (X 24 to 343 visible, 23 and
344 not) and the PAL seam pinned between $1F7 and $200. The autopilot
pattern from the same tier is covered by the headless-verify recipe's
autopilot section.

**Candidate list, Tier A, batch 1: four things every agent reaches for
and the KB did not have.** `petscii_screen_code_conversion` (text page):
the PETSCII to screen-code rule measured over all 224 printable codes by
writing each with CHROUT and reading screen RAM back, the reverse-video
bit, the shifted set through `$D018`, the colour RAM consequence, and where
in the KERNAL the fold lives, with the Oscar64 recipe `petscii-screen-codes`
proving the rule both ways on screen; a new pitfall
`petscii_written_to_screen_ram` for the letters-come-out-as-graphics
symptom. `compare_16bit_and_signed` (maths page): unsigned 16-bit compare
high byte first, the signed idiom with the overflow flag and why a bare
BMI fails across the boundary, ranged compares, and what Oscar64 emits,
with the KickAssembler recipe `compare-16bit-signed` sweeping the boundary
pairs and counting the bad form's failures (16,384 of them); a new pitfall
`signed_compare_bmi_overflow`. `division_8_16bit` (maths page):
shift-and-subtract division in three widths, reciprocal multiply with its
error bound, divide by ten against the subtract-powers route, with the
Oscar64 recipe `divide-check` checking quotient and remainder over the
full 8-bit range and timing every route. `sine_table_generation` (CPU
page): quarter-wave, second-difference and parabola generation with the
worst and mean error of each against a host table and the cycles to build
256 entries, with the KickAssembler recipe `sine-table-runtime` driving a
visible sprite sine from the table it just built. Every new technique is
anchored on the pitfalls its code meets.

**The recipe lookup carries the listing.** `c64_recipe_lookup` and the
CLI's `recipe-lookup` returned a recipe's Build, Synopsis and Expected
output sections and never its Source listing, so a caller with no file
access, an MCP client on another machine or a model that will not open a
page, could not copy the code. Nine builds of one game showed it: the two
strong models that read the page file shipped the recipe; the one that
trusted the answer built from prose. The answer now ends with the page's
Source fence, the one the listing gate builds and the pinned screenshot was
made from, and the structured output carries it as `source_code`. Tools
1.27.0.

**Batch 9c: transitions, disk work and a release disk.** The transitions
page is complete: `colour_cycling` (one step over eight rows of colour RAM,
3,265 cycles on either model) and `screen_wipe` (a row written out in 491
cycles, in at 708 or 709), each with a KickAssembler recipe pinned mid-
effect and checked pixel by pixel against its own formula; both recipes
record a first draft whose single-compare busy-wait fell through the
raster line twice a frame and double-counted. `load-asset-runtime`
(Oscar64) builds a charset, saves it, loads it back to an address of its
own choosing and shows it, with the KERNAL's LOAD measured to leave the
raster interrupt armed and `$D011` alone; the technique page gained the
secondary-address facts and the header page's `krnio_load` note. The new
technique `kernal_relative_file_io` and its recipe `relative-file-records`
create a REL file with 32-byte records, position with the P command, and
quote what the drive says, including the 50 and 51 replies provoked in
VICE for the first time here. `toolchains/release-disk.md` builds a D64
from the platformer scaffold with c1541, lists it, autostarts the disk
itself headless and shows the game running from it, with the block
arithmetic and a Makefile target; two screenshots of that boot ride with
the scaffold recipe. The verifier still only formats a disk; a `files` key
to place a built PRG on it is proposed on the page and not built.
For a few hours the verifier and the pages carried `-minimized` on every
headless VICE command to stop a batch of runs taking the desktop's focus;
it was withdrawn the same night because a window that opens and then
minimises is worse than one that opens, and the pictures were byte-identical
either way. The fix landed the same night: VICE 3.10 built with
`--enable-headlessui` has no window at all and its exit screenshots are
byte-identical to the pins (four recipes, both models, and the disk-backed
ones); `npm run vice:headless` builds one into `.tools/` from the pinned
tarball, and every emulator launch in the repository (the verifier, the
run tool) prefers it when present, with `X64SC_BIN` as an override; the
VICE page says how it works and the one flag-order trap.

**Pitfalls reached through a technique's registers, and a graph report.**
A technique also meets every pitfall that a register or KERNAL routine it
declares triggers. Both ends of that join are exact declarations on the
pages, so the edge is derived rather than guessed, which is the one kind
of graph edge the literature on retrieval finds worth having. The
pitfalls tool now adds those pitfalls after the direct ones and names the
register that carried each; `ecm_mode` went from no answer to four
pitfalls, and thirteen techniques with no direct anchor now reach one.
`npm run graph:report` prints the graph's shape: node and edge counts,
technique degree, connected components and the largest one's share,
isolated nodes, techniques without a recipe or without any pitfall by any
route, and per-archetype feature, risk and scaffold counts. Its first
reading, in the commit that added it, said the largest component held two
thirds of the nodes and the rest were isolated memory regions, and that
fourteen techniques had no pitfall by any route. Those are the numbers to
watch before expecting the graph to pull ahead of the text.

**Source lints compiled from the pitfalls (tools 1.26.0).** A new MCP
tool, `c64_lint_source`, and CLI subcommand, `lint <file>`, run the
knowledge base's rules over an agent's own C or assembly source with no
graph or vector store involved. Eight rules, each named after the
pitfall it compiles and pointing at its page: `sid_write_only_registers`,
`cia1_ddr_cleared_kills_keyboard`, `empty_name_open_15_hangs_on_read`
(from the high-score recipe's warning), `raster_poll_with_kernal_irq_live`
(anchored on `raster_irq_first_line_jitter` and the frame-sync recipe),
`lfsr_zero_state_lockup`, `decimal_mode_in_irq_handler`,
`d016_unmasked_rmw_clobbers_csel_mcm` and `jmp_indirect_page_boundary_bug`.
Every finding carries a certainty (`definite`, `likely`, `heuristic`) and
the message uses the page's own words for the mechanism and the fix. The
test runs the linter over the two platformer builds from the 2026-09-22
three-arm test, copied into `test/fixtures/`: on the build made without
the knowledge base it reports the SID read-modify-write, the DDR clear,
the empty-name OPEN and the raster poll at their lines; on the build made
with it, no definite finding. The first draft flagged
`#include <c64/sid.h>` as a SID read; preprocessor lines are now skipped.
Review of the first draft against every listing in `docs/` changed four
rules. The decimal-mode rule had the pitfall backwards (it flagged a SED
that reaches RTI, where the page's fault is a handler that reaches ADC
or SBC before any CLD); it now follows an installed handler from its
label and has no C form, since in C the arithmetic is the compiler's.
Read that way it fires on the KB's own `stable-raster-irq`,
`cracktro-template`, `dycp-scroller` and `sine-scroller` handlers, none
of which CLD; none of those programs executes SED either, so those are
heuristic, and the pitfall page and the recipes are left to be
reconciled. The `$D016` rule read the first `lda #` in its window
rather than the one that feeds the store, which flagged
`sideborder-open` and missed a bad store; it walks back to the load
now. The empty-name OPEN rule is `heuristic`, not `likely`: the
high-score recipe measured a bare OPEN of channel 15 returning success
with no drive, while `techniques/file-io.md` opens the channel bare and
expects the carry set, and the message names both rather than pick one.
Language detection strips comments and tests for assembler signatures
first, so a KickAssembler `.for` block no longer reads as C. The package
version follows at release.

**Schema 23: the scaffold is an edge.** A recipe page may now carry
`scaffolds: [vertical_shmup, horizontal_shmup]` in its frontmatter, an
array of Archetype names; the ingest links `Recipe -[:SCAFFOLDS]->
Archetype` in pass 2 with both ends matched, drops a name that matches
no Archetype with a warning, and reports `scaffolds … dropped` on the
summary line beside the other relations. `c64_game_briefing` reads that
edge for its first build step in place of matching the string "shmup"
against the archetype name and offering `oscar64-simple-shmup` by name;
the step's text now also names the recipe's page so an agent knows which
file to copy. The fallback tables, used only by a graph with no
Archetype nodes, still offer the shmup scaffold by name. The shmup
recipe carries the key for both shmup archetypes. `ONTOLOGY.md` and
`CONVENTIONS-recipes.md` document the edge and the key.

**Batch 9b: text and demo effects the gap map still owed.** Four new
techniques, each with a pinned, measured recipe. `big_font_2x2` on the
text page: a 2x2 charset built from the ROM font at start (about 58,000
cycles once) and a two-row scroller whose rotate costs 708 cycles on
either model, with the KickAssembler recipe `big-font-scroller`.
`charset_animation` on the render page: rewriting a glyph's eight bytes
in place against flipping whole charsets with `$D018`, 196 cycles a frame
for the rewrite, with the Oscar64 recipe `charset-animation`; the writer
found and fixed an NTSC ordering fault of its own on the way, a HUD write
that spilled past the shorter vertical blank. `speedcode_generation` on
the CPU page: a generator that emits unrolled load and store pairs into
RAM from address tables, measured against a loop for the same copy, with
the KickAssembler recipe `speedcode-generator`, whose text records that
its first verdict was placed after the timed loop and passed a red case
until it was moved. `dycp_scroller` on the scroll page: letters on a sine
wave by copying glyph rows into per-column charset strips, with the
KickAssembler recipe `dycp-scroller` pinned at nine million cycles and
its PAL and NTSC timer readings as a clean illustration of the badline
cost. Every new technique is anchored on the pitfalls its code meets.

**Batch 9a: what the three-arm build test said was missing.** A new
technique page, `techniques/logic.md`, opens with `tile_grid_collision`
(requires `tile_map_render`; 2,345 cycles on its worst frame, measured
with the CIA timer inside the vertical blank) and `object_pool` (the
update pass over eight live slots, 380 cycles, from the object-pool
recipe's own harness); both platformer fingerprints now name the
collision, so a platformer briefing proposes it. The recipe
`tile-grid-collision` walks a scripted sprite through a landing, a wall,
a ceiling bump, a ladder and a pit with an assert every frame, and found
on the way that side probes must sit no further apart than a tile. The
recipe `fixed-point-jump-velocity` jumps from two different heights with
one velocity table, which the fixed-ground table on the older recipe
cannot do. `headless-verify` gained an autopilot input (one define swaps
the joystick read for a scripted port byte through the same edge
detector) and a self-test (a forced-fault build must make the same
verify script exit 1 before its green is trusted), and the VICE page a
palette-safe border grading by channel dominance. Measured, a raster
IRQ left armed through a 2 KB file write and read back corrupts nothing
on either model, but its handler enters up to about 240 lines late while
the bus is busy, so a border split wanders; `rirq_stop()` is a bare
`sei` that the KERNAL's own `cli` cancels, so wrapping the calls in it
changes nothing, and clearing `$D01A` is what actually keeps the
interrupt out. That is the new pitfall `raster_irq_during_serial_io` and
a section on the high-score recipe. The PAL start-up hang a blind build
hit is located but not explained: the KERNAL waits with no timeout for
the drive to pull CLK at the talk turnaround, and why the emulated 1541
does not is open. Two lines elsewhere were wrong and are corrected: the
IEC page's "approximately 64 ms" timeout (the only timeout is about
1,024 cycles around the acknowledge wait, and a stalled turnaround never
returns) and the Oscar64 header page's `rirq_stop()` "disables it".
Three more pitfall anchors on the KERNAL page for the decimal-mode,
IRQ-chain and text-input techniques.

**The briefing proposer, measured against a real brief.** The three-arm
build test handed the game briefing a nine-part platformer brief and it
proposed eight techniques the brief did not need while missing eight of
its nouns. Four causes, each fixed and tested on the fixture graph. The
keyword scorer matched substrings, so "budget bar" proposed raster bars
and "tile map" reached every bitmap technique through the category word;
it matches whole words now. It kept ten candidates whatever the brief's
length, so the LFSR fell off the end; the limit scales with the brief.
The vector supplement filled every remaining slot with guesses; it adds
at most four when the brief's own words already found most of the plan.
And the toolchain handoff sent stable raster IRQs, raster bars and the
multiplexer to KickAssembler although this knowledge base carries an
Oscar64 recipe for each; a cycle-tight technique with a recipe in the
primary toolchain now stays there and is named as kept, and only one
that needs every cycle of the line, is scene-tier, or has no Oscar64
recipe is handed off. Every plan now ends with a headless verification
step naming the Oscar64 harness recipe, because a brief that asks for a
harness had no technique node to reach it through. Two nouns that
existed only as recipes have technique nodes: `decimal_print` in
`techniques/text.md`, with the print-number recipe's measured cycle
figures as its cost line, and `memory_layout_plan` in
`techniques/memory-banking.md`, implemented by the memory-layout recipe.
On the same brief the proposal now carries the LFSR, the file read, the
fixed-point and jump-table techniques and the decimal print it missed,
and the handoff is one technique instead of three.

**Pitfall anchors for the new techniques.** A briefing agent asked
`pitfalls-for frame_sync_loop` and got nothing, although the badline,
raster-jitter, `$D012` wrap and PAL/NTSC pitfalls all apply to it: the
techniques added this month had no pitfall naming them, so the graph had
no edge to follow. Twenty-seven pitfall entries now name the techniques
whose code meets their mechanism, added only where the pitfall's own text
supports it; a double buffer is listed as a mitigation of the full-field
redraw overrun rather than a trigger of it. One pitfall is new,
`cia1_ddr_cleared_kills_keyboard`: clearing `$DC02` to read joystick 2
leaves the KERNAL keyboard scan driving nothing, which a blind build did
today and no headless run can see. `npm run check:pitfall-anchors`
reports the techniques still without an anchor and fails on a dangling
name; the ones that remain are mostly effects and packers for which no
written pitfall applies yet.

**Two tool faults from the blind build test.** An agent that built a
game from the knowledge base alone logged what got in its way; two of
the items were the tools, not the pages. Every CLI lookup now honours
the global `--json` flag and prints the same structured object the MCP
server returns; only the briefings did before. And a briefing given a
partial archetype name resolves it when exactly one archetype contains
every word of it (`racing`, `cracktro`), reports the candidates when
several do (`platformer` names two, `shmup` two), and only then falls
back to listing every known name; the builder had spent a call learning
that `platformer` was not a name. Tools 1.25.1.

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
