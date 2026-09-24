# Changelog

Versions are in `VERSION` (data, schema, tool surface) and `package.json`.
Entries below start at the first public audit; earlier history is in git.

## Unreleased

Data 806, schema 33, tools 2.8.1, package 0.21.1.

**Serial-I/O sprite hang: CIA model has no effect, drive is a 1541-II
(data 806; part of #43).** Measured in VICE with true drive over 20 save
rounds: PAL hangs from 3 sprites, NTSC from 4, on every CIA and VIC-II
model combination, so this is not the #69 old-CIA fault. VICE's default
drive 8 is a 1541-II; the pitfall and recipe said 1541. The 1541-II ROM
matches the 1541's in the ranges the pitfall cites. The recipe is now
pinned with true drive and the drive type explicit. Real hardware stays
open on #43.

**Every archetype reference title has a source (data 805; #40).** Each
title on c64-game-archetypes.md now links a C64-Wiki or Wikipedia page
giving its C64 genre and year, and for shooters its scroll direction.
Titles a source contradicted moved or went: Hawkeye (scrolling
platformer, not a shmup), Rainbow Islands and Creatures (scrolling, not
single-screen), Green Beret and Zak McKracken (not top-down), IK+ and
Barbarian (fighting sport, not beat-'em-up), and titles with no C64
release (Oxyd, Columns, Dr. Mario) or none found. Years corrected:
Lightforce 1987, Katakis 1988, Silicon Dreams 1986, Welltris 1991,
Buggy Boy 1987. Every modern example except Sports' is now "none
checked".

**IRQ entry through `$FF48` is cycle 39-45, not 37-43 (data 804; #85).**
Measured in VICE on PAL and NTSC with an exec tracepoint on the
handler's first instruction over 7,742 and 8,850 entries: 39-45
through `$FF48` → `($0314)`, 10-16 through `$FFFE` with the KERNAL out.
The old figure (1 + 0-6 + 7 + 29) left out the 2-cycle minimum before
the interrupt sequence starts, and raster.md called it measured.
raster.md, sprite.md and six recipes are corrected (double-IRQ budget
36-42 → 38-44, raster-bars' no-spin store on cycle 61 or later, was
59). No listing's timing relied on the old window.

**Racing starter: line 203 gets the panel's own `$D016` (#86).** The
store waited for the badline and wrote on cycle 56, so line 203 was
drawn in the road's multicolour mode with its last XSCROLL: a cyan line
across x 32-347, not the 4-pixel strip the issue described. X now holds
the panel value and `STX $D016` writes on cycle 11. A new check in
expect.json fails the old shot (316 cyan pixels); `make check` is 56 of
56 on PAL and NTSC.

**Every runnable recipe passes claims-watch, now a gate (data 803;
#84).** `npm run claims:recipes` builds each KickAssembler recipe and
runs claims-watch with its runs.json cycles and flags: 77 pass, 0 fail
(6 of 77 passed before); two cartridge recipes and two marked skip do
not run. New recipe frontmatter keys: `ram:` for a recipe's own RAM
outside the PRG, `kernal_services: [IRQ|NMI]` for a KERNAL interrupt
service left running. New Claims lines from traces for
charset_copy_rom_to_ram, basic_extension_wedge, pseudo_3d_road_raster,
reu_dma, four_player_read and vector_balls_sprites. Two real overlaps
fixed in listings: paddle-read kept a pointer at `$F5-$F6`, which the
KERNAL IRQ may write (now `$FE-$FF`); irq-owns-port called `$E544`
(now CHROUT `$93`). claims-watch now counts stores from `$E000-$E4B6`
(BASIC's floating point in the KERNAL ROM) as BASIC's.

**One cycle numbering, measured (data 802; #82).** Pages numbered raster
cycles differently. The knowledge base uses Bauer's 1-63 (1-65 NTSC).
In VICE's monitor an exec checkpoint's CYC is the instruction's first
cycle minus one, and a store checkpoint's CYC is the write's cycle as
Bauer numbers it (the watchpoint is checked one cycle after the
write). Settled with probes: `$D012` changes on Bauer's cycle 1,
badline reads are held 12-54, and a store printed as CYC c shows in the
screenshot from x = 8c − 103 on both models; written up in
`runtime/vice-reference.md`. Corrected: dysp's NTSC write is on 56 (was
57); eight-way-scroll's margin is 4 cycles (was 5); sprites-only-screen
13 and 26 (were 12 and 25); oscar64 sid-music-player 33-39 (were
32-38); the racing starter's stores are on 7, 13 and 19 (were 6, 12,
18), and its line-203 `$D016` write lands on cycle 56, not 12 (#86);
demo and shmup-vertical starter comments. No listing's code changed.
IRQ entry through `$FF48` measures cycles 39-44, not the 37-43 several
pages give (#85).

**ingest_doc takes any spelling of a page's path; lint reads only code
fences (tools 2.8.1, package 0.21.1; #51, #28).** `ingest_doc` given
`docs/x.md` from the repo root, `x.md` from docs/, or an absolute path
now resolves each to one source under docs/; before, some spellings
created a second source or a `docs/docs/` copy. Paths outside docs/ are
refused. Linting a Markdown page now blanks everything outside C and
assembly fences, keeping line numbers: music-sid.md gave 7 findings on
prose (at wrong line numbers) and now gives none, and a real read put
into its filter fence is reported at its own line.

**Every CIA1 row in the recipe traces is declared (data 801; #83).** 36
KickAssembler recipes had undeclared CIA1 stores (the issue counted
15). A new recipe frontmatter key, `harness: [...]`, marks a timer used
only to measure the listing; claims-watch reads it like `--harness` and
the ingest ignores it. 30 recipes declare timer A or B as harness;
start-up masks are `init`; cia-revision-detect owns both timers. New
Claims lines from traces: `tod_alarm_interrupt` owns `cia1_tod`,
`tape_turbo_loader` owns `cia1_timer_b`, `paddle_read` owns
`cia1_port_a` (derived from the listing). tape-turbo-loader now passes
claims-watch with 0 violations.

**IRQ recipes declare their vector and CIA1 mask (data 800; #81).** 32
KickAssembler recipes carry a `claims:` frontmatter line from their own
claims-watch trace: the vector they install (`$0314`, `$FFFE`, `$0318`,
`$FFFA`) as `owns`, and the start-up `$7F` store to `$DC0D` as `init`.
The vector is the recipe's choice, not the technique's
(CONVENTIONS-techniques), so no technique Claims line changed.
afli-image, sideborder-open and stable-raster-irq now pass claims-watch
with 0 violations. The ingest does not read recipe claims yet (#22 step
8).

**Recipe: a raster road with sprites on its lines (data 799; #77).**
`road-sprite-lines` keeps each road line's `$D016` store on one cycle
with three sprites moving over the road and its badlines: a 64-byte
block per line with a branch pad rewritten each frame from a table
keyed by which of sprites 0-2 fetch on the line and whether it is a
badline. In VICE monitor traces over 20,000,000 cycles every store
lands on the same cycle (81,877 PAL, 93,598 NTSC); in 100 screenshots
every line shows its own XSCROLL. The IRQ chain costs 6,348-6,350
cycles a frame on PAL and 6,549-6,550 on NTSC (the issue's 6,300 and
6,500 were arithmetic). Cycle numbering differs between pages; see #82.

**afli_image no longer requires multicolour (data 798; #80).** It
required `fli_image`, which requires `multicolor_bitmap`, but the
afli-image listing clears MCM (`$D016` = `$C8`); fli-image and
ifli-image set it (`$D8`). afli_image now requires
`stable_raster_irq, standard_bitmap, vic_bank_select` and claims the
five FLI units itself (claims-watch trace in VICE). The afli-image
recipe no longer lists `fli_image` in its techniques.

**claims-watch no longer reads RAM stores as I/O (#79).** A store to
`$D000-$DFFF` with I/O banked out was recorded as the register's value,
so ifli-image showed a `serial_bus` change that never happened and 1,024
fill stores labelled "colour RAM". Values are now recorded only when
`$01` banks I/O in. No recipe's Claims line changes.

**Four new recipes and the last display-field Claims lines (data 797;
#74).** New KickAssembler recipes, each run in VICE and measured:
`mcm-text` (all 64,000 display pixels match on PAL and NTSC), `vsp`
(a 10-character shift decoded row by row; shift = pad − 194 PAL, − 202
NTSC), `afli-image` and `ifli-image` (PAL; every pixel matches its
source image). The VSP run corrected `vsp_glitch` in three places: the
picture moves right, not left; the offset does not carry into the next
frame; one write a frame moves the whole screen. VICE is the only
machine it ran on; with `-VICIIvspbug` 2 of 11 runs went wrong. The
IFLI swap must wait for line 251, since lines 248-250 cannot be
badlines; fli-image's "cycle 55 of LAST_LINE" comment was wrong for
the same reason. Claims lines for big_font_2x2, dycp_scroller,
text_zoom, mcm_text (none), vsp_glitch (now hard against FLD),
afli_image and ifli_image.

**Starter checks for a frame deadline and a live SID player (data 796;
#75).** `templates/_harness/watch.py` reads a VICE store trace.
`DEADLINE_LINE` fails a run whose `WORK_END` mark lands after the
stated raster line, counted in cycles so a frame-late end on an early
line is caught; the platformer uses it (line 251: 100 lines spare PAL,
50 NTSC; an `OVERRUN=1` build fails on 12 of 750 frames). `SID_FRAMES`
fails a run that stores to the SID in fewer than N frames; all seven
starters with a player use it, and each `NO_PLAYER` build fails. `make
selftest` builds both mutations. The check counts frames with SID
stores, not sound. The platformer README's meter table was already
stale (11,758 / 6,212 PAL); it now gives 11,774 / 6,227 PAL and
12,225 / 6,590 NTSC with the marks in.

**Claims lines for twelve more display-field techniques (data 795; part
of #74).** From claims-watch traces of 14 recipes in VICE:
badline_synchronization reads `vic_yscroll`; tech_tech_wobbler owns the
raster IRQ and shares YSCROLL, XSCROLL and the matrix base;
char_scroll_buffer_h shares XSCROLL; charset_animation,
standard_bitmap, multicolor_bitmap and koala_format own the char base
(koala_format now **Requires:** multicolor_bitmap, so the two are not
rival owners); mci_interlace_bitmap owns the VIC bank, matrix base and
XSCROLL; hires_plot, bresenham_line and ecm_mode claim none. New hard
conflicts: mci_interlace_bitmap × soft_scroll_h, charset_animation ×
standard_bitmap. vsp_glitch, afli_image, ifli_image and mcm_text have
no recipe to trace and no Claims line.

**Starter claims pass again after the display units (#78).** 231d8b2
made the VIC scroll and pointer fields claimable, and six starters did
not declare them: `make claims` failed on action-puzzle, adventure,
beat-em-up, demo, platformer and shmup-vertical (1 to 4 groups each).
All nine starters now report 0. The platformer's zero-page range was
$02-$53; Oscar64's T1 high byte at $54 holds the frame count, so it is
$02-$54. The demo's PLAN.md still pasted INCOMPATIBLE for
irq_chain_table × raster_bars, rated soft since cf04297; its plan and
budget are re-pasted.

**What each music-player feature costs (data 794; #76).** The
music-player listing gains seven `-define` switches (`NO_VIB`, `NO_PWS`,
`NO_FLT`, `NO_WT`, `NO_HR`, `NO_LEG`, `NO_FX`); with none defined the PRG
is byte-identical. `techniques/music-sid.md` has a cycle-budget table
per feature, measured in VICE over 2,000 play calls on PAL and NTSC.
Wavetable-every-frame is the largest mean cost (146 cycles PAL); all
seven off saves 179 at the worst call and 415 on the mean. Worst-call
savings do not add, since each removal moves the worst call to another
frame.

**Racing starter (data 793; #53).** `templates/racing`: a pseudo-3D road
racer with scaled opponent sprites on the road lines, a lap timer and
collisions. In VICE it passes 54 of 54 checks on PAL and NTSC, rejects
its FORCE_FAULT build, rebuilds all 96 road lines from its own raster
splits pixel-for-pixel (`make roadcheck`) and catches 7 of 7 planted
mutants. Worst and typical frame: 10,358 / 8,816 cycles PAL, 10,750 /
9,049 NTSC. The road picture updates every 3.5 frames on PAL and 4.9 on
NTSC; the game steps every frame. Passes on released Oscar64 v1.32.273.
A second agent's review found the lost-frame detector blind to a
late-armed line-105 interrupt (now counted), `make claims` failing on
the #71 display units (now declared), and the picture rate divided by
coasting steps (3.6 and 5.1 before). Recipe for the road with sprites
on its lines: #77.

**pseudo-3d-road curves both ways (data 792; #73).** The curve add
treated every carry as overflow, so a negative dx pinned cx at 255 and
the road never bent left; the right kerb went to column 39 whenever
cx + hw passed 255 instead of 319; the redraw never erased the road's
old cells. The add is now signed and clamped at 0 and 255, the curve
step is ±18/256 (it was ±51/256, which saturated either way), the kerb
uses the 9-bit sum, and the redraw repaints grass where the road left.
Measured in VICE: every `$D016` write still lands on cycle 4 of its own
line (920 PAL, 1,052 NTSC frames), the PAL shot bends left and the NTSC
shot right, the road steps every two frames on both. The technique's
Cost goes from 18,343 to 17,975 cycles; the pinned run is 21,100,000
cycles (was 20,000,000) so one picture shows each bend.

**Tools refuse to answer from a half-built graph, and the #41 leftovers
(schema 33, tools 2.8.0, package 0.21.0, data 791; #41).** A clean
ingest writes an `IngestRun {name:"rebuild"}` node before it wipes and
deletes it after its report; while it exists every graph-reading MCP tool
returns `isError` ("The knowledge base is being rebuilt") and the CLI
exits 1. Seen live: mid-ingest the graph had 150 Recipe nodes and 0
IMPLEMENTS edges. `lookup_register` puts the register's own section
first (DC00 and DC01 led with input pages before). `technique_lookup`
drops documentation chunks that neither sit under the technique's
heading, come from a realising recipe nor name it; a technique with no
recipe says so. Ingest warns when a Cost line names a recipe that does
not realise its technique. `pal_ntsc_detection` gains a bytes-only Cost
(339, Oscar64 build here). The `$D016` lint no longer flags the 14
deliberate whole-value stores in `templates/` and `demos/`. Three
archetype fingerprints over-proposed techniques their starters do not
use (`vertical_shmup`, `puzzle`, `text_adventure`); each changed line
says what it said before.

**KERNAL EOI wait against the old 6526 (data 791; part of #69).** New
pitfall `kernal_eoi_wait_misses_timer_b_on_old_cia`, seen in VICE. The
KERNAL's EOI window is $01FF timer counts, about 520 cycles; an earlier
version of the KERNAL routines page said 256 µs. Real-hardware
confirmation stays open on #69.

**Display-field units and a per-figure bytes basis (schema 32, tools
2.7.0, package 0.20.0, data 790; #71, #72).** Four HardwareUnits of a
new kind, `display`: `vic_yscroll` ($D011 bits 0-2), `vic_xscroll`
($D016 bits 0-2), `vic_matrix_base` and `vic_char_base` ($D018 bits 4-7
and 1-3). A vertical scroller beside FLD is now a hard ownership
conflict, not a soft shared-register note; claims-watch traces of 31
recipes set the Claims lines of the techniques that write those bits.
A Cost line can carry `**Cost bytes basis:**` so bytes and cycles keep
their own basis; `plan_budget`'s `weakest_basis` now covers cycles only,
and a new `bytes.weakest_basis` covers the bytes. Nine pages whose
cycles were measured but bytes read from the listing now say so.

**pseudo-3d-road's loop fixed, and the #70 leftovers (data 789; #70).**
The road loop synced on badline 99, so its $D016 writes started on cycle
56, jittered 2 cycles and drifted 3 more per badline: 0 of 100 lines
showed their own XSCROLL, and a vertical-blank IRQ that ran into the
next frame halved the rate. It now syncs on the 97/98 boundary with
badline bodies that allow for the 43-cycle stall; in the VICE monitor
all 100 writes land on cycle 4 of their own line on every frame (864
PAL, 988 NTSC), the screenshot shows each line's own entry, and the Cost
is 18,343. The road never curves left (#73). eight-way-scroll's rows 0-4
meet their badlines with 5 cycles to spare at worst (measured); the
counter still checks row 6, and the page says why. Among the small
claims: the $3FFF idle pattern does show in VICE (it had said not);
eight sprites cost about 20,000 cycles/s, not 50-100K; the music play
call runs on line 255; the KERNAL loads a Koala picture in about 25 s.

**SID capture, loudness and a music design page (data 788; #50).**
`runtime/vice-reference.md` "Recording the SID output": headless WAV
capture works only without warp (`-sound -sounddev wav`, real time); the
dump sink works under warp. `hardware/sid-reference.md` gains measured
loudness (RMS, 440 Hz, both models): 6581 saw+pulse is about 16 % of a
sawtooth below pulse width $800 and silent above; tri+pulse is within
3 % between models, which corrects `techniques/music-sid.md`'s "louder
on the 8580". New page `music/music-design.md` (instruments, song form,
voice 3 for effects, budget, chip choice) from the music-player recipe's
tune. `sid_play_routine_pattern`'s Cost gains its typical call (773 PAL,
779 NTSC) and byte sizes.

**Headless joystick and harness fixes (data 787; #42, #59).** VICE
3.10's event playback cannot be used (the power-on reset clears the trap
`-playback` sets; read from VICE's source, confirmed: three runs never
left READY). The binary monitor's joystick command reaches $DC00 only
with control port 2 set to "Joyport I/O simulation" (`-controlport2device
37`); `templates/_harness/drive.py` drives games that way and counts
emulated frames, and the five starters' own joystick builds are gone.
The plan gate no longer consults the live graph for a shipped example;
a changed answer says so, and an unreachable graph warns. The meter's
median uses selection (38,742 cycles instead of 854,431) and its print
rewrites only changed cells (464 and 668 cycles instead of 2,402 and
2,810). Under `+sound`, $D41B and $D41C read ramps, not the envelope and
noise; the harness picks a sink that reads them correctly. All eight
starters pass `verify:templates --selftest`.

**Claims-watch findings (data 785, tools 2.6.1; #35).** The KERNAL's
serial routines use CIA1 timer B: the ROM stores to $DC07/$DC0F at
$ED94/$ED99 and $EE22/$EE27, reached by 20 jump-table routines; a
claims-watch trace counted 314 and 8,438 such stores in two file
recipes. The four disk techniques now claim `serial_bus` and
`cia1_timer_b` (shares), so a technique that owns timer B reports a
conflict with them. Two recipes that bank the KERNAL out now list
`ram_under_kernal`; it has a Cost of 0 (one $01 store at init), and
`plan_budget` no longer charges badline cycles for a zero figure. Three
techniques gained Claims lines; the YSCROLL gap they exposed is #71.

**Sparkle's $DD02 VIC-bank switch, measured with a true drive (data 784; #23).**
New recipe `kickassembler-sparkle-dd02-bank`: a disk built by SparkleCPP
loads eight 4 KB bundles while a raster IRQ flips VIC banks 0 and 2 by
writing $DD02. In VICE x64sc 3.10 with a true 1541: 523 bank writes on
PAL and 625 on NTSC, none landing on the wrong bank, every bundle's sum
and XOR matching; 5.21 s on both models. A read-modify-write of $DD00
loads correctly but shows the wrong bank in 400 of 523 checks (PAL); a
plain STA $DD00 releases ATN, the drive resets ($EAA0 traced) and the
first load never returns. `pitfalls/loader.md` had Krill's row backwards:
Krill v194's README says to switch banks with a plain STA $DD00, at any
time; the row and its mechanism now say so, with what they said before.

**Cost lines re-read against their recipes (#32, #45).**
Traced in VICE x64sc 3.10 with monitor tracepoints, from each interrupt's
acceptance to the end of `RTI`, or across the recipe's own work:

| Technique | Was | Now | What was wrong |
|---|---|---|---|
| `irq_chain_table` | 273, estimated | 498 (three slots) | about 91 a slot; measured 159, 180 for the wrap slot |
| `topbottom_border_open` | 132, arithmetic | 371 NTSC, 353 PAL | left out the `$EA31` exit |
| `stable_raster_irq` | 124, arithmetic | 310 NTSC, 262 PAL | left out the double IRQ's two-line wait |
| `raster_bars` | 990 and 600 bytes, estimated | 1,471 NTSC, 1,464 PAL; 577 + 33 bytes | estimates |
| `sprite_multiplex_24` | 700 and 900 bytes, estimated | 1,667 (fixed bands, no sort); 977 bytes | estimates |
| `sprite_sine_chain` | 200, 512 bytes, one IRQ | 578-644; 768 bytes; no IRQ | not timed; three tables, and the recipe polls |
| `text_input_line` | 200, estimated | 361 worst, 107 typical | not measured |
| `adventure_database_engine` | 14,908 (PAL) | 15,206 (NTSC) | the smaller region's figure |
| `software_sprite_preshifted` | two objects' bytes | one object's: 1,304 + 1,344 | units mixed with one object's cycles |
| `kernal_file_write_seq`, `kernal_file_read_seq` | no Cost line | 3,989,946 and 530,736 (NTSC, one call) | a plan that saves could not name the cost |

`table_multiply_8x8` and `lfsr_random` said `arithmetic` for figures that
come from a timer and a build; they say `derived-listing` now.
`two_player_state_swap` says its 65 is the per-frame port read.
`tile_map_render` gains a whole-level unpack figure in prose (40,041 PAL,
templates/action-puzzle). `CONVENTIONS-techniques.md` allows a one-call
Cost for a technique that runs only outside play. Two pitfalls gained
data (sprites enabled before placement cost 342 cycles in the first
music frame; the adventure starter's first disk calls did not hang), and
`kickassembler-sprite-multiplex-game` says what its MISSED counter
cannot see.

Validation rows that moved: `cracktro-template` play high end is now
1,471 + 1,198 + 7,938 (raster_bars 990 before); `platformer-scaffold` transition has one
unknown (`error_channel_check`) and two multi-frame members instead of
three unknowns.

**Compatibility, budget, briefing and lint answers that misled the
starter builders (tools 2.6.0, package 0.19.0, data 783; #29, part of #41).**
`check_compatibility` no longer reports a hard conflict between a
technique and one on its own REQUIRES chain (the FLI, side-border, DYSP
and tech-tech recipes gave 11 false hard conflicts; now none, checked
against the real pages by a new test), refuses unknown technique names
(verdict `unknown_technique`, new `not_found[]`), and no longer suggests
an `irq_chain_table` that makes the verdict worse. `plan_budget` applies
one multi-frame threshold to both models and says "over the frame by X"
instead of "passes". Briefings refuse an unknown archetype, list every
conflict with its severity, name the brief words behind each proposal,
and propose file, animation, frame-sync and region techniques from the
brief's words. `techniques-for --register` accepts any spelling of a
register. The lint's raster-poll rule no longer fires on a multiplexer.

**sprite_multiplex_game has a measured typical frame (data 781; #33).**
A CIA1 probe across the sort, the build and every IRQ, over 1,867 PAL and
2,142 NTSC frames in VICE: largest whole frame 8,785 cycles on PAL and
8,995 on NTSC (with the 26-27 cycles per IRQ the timer cannot see). The
Cost line now carries `cycles_per_frame_typical=8995` beside the
arithmetic worst of 16,600.

**Pitfall: sprites next to badlines hang a KERNAL disk save (data 780; #43).**
`sprites_over_badlines_hang_serial_io` in `pitfalls/kernal-and-io.md` and
the recipe `oscar64-sprites-off-during-disk-io`. Measured in VICE x64sc
3.10 with a true drive, 20 save rounds per case: with sprites drawn over
two badlines, 3 or more hang on PAL and 4 or more on NTSC; none hang with
the sprites off the badlines, the screen blanked, or sprites switched
off around each call. At the hang the C64 waits in the KERNAL bit loop
($EE5A-$EE63) for one more bit while the drive waits for the byte's
acknowledge; neither side times out. Not checked on a real 1541.

**`soft-scroll-h` no longer tears (#18).** The carry moved screen and
colour RAM with `memmove` in 74,041 cycles, 3.8 PAL frames, and the main
loop's `vic_waitBottom` ran eight XSCROLL steps in one blank, so the
picture jumped 8 px every four frames and tore. The listing now waits with
`vic_waitFrame`, writes `$D016` first, and moves screen RAM with an
unrolled `LDA abs` / `STA abs` copy, top row first: 7,938 cycles, measured
with CIA2 timers. No whole-screen move fits the blank (975 × 8 = 7,800 >
7,056 PAL), so the page measures the race instead: every row finishes
before the beam reaches it (row 24 at line 82 PAL, 127 NTSC), and 18
one-frame-apart screenshots per model show all 25 rows at one phase and
1 px per frame. `soft_scroll_h`'s Cost line is now 7,938, so
`c64_plan_budget` counts it instead of excluding it as multi-frame.

**The #68 claims corrected (techniques, recipes, hardware leftovers).**
About 95 more claims flagged by the prose pass, each settled and
corrected with a clause. Measured in VICE among them: the
`pseudo-3d-road` loop's writes land from cycle 56 of line 100 and drift
3 cycles per badline (the page now says what the listing does; the
listing fix is a follow-up); a same-line raster IRQ fires once a frame;
MCM and ECM switches land at different pixel offsets; a bitmap at $0000
in bank 0 shows the character ROM from $1000; the NTSC bottom-strip
sprite threshold is Y <= 5; the SID effect in `sid-music-player` was
recorded (880 Hz every 151 frames). Three headings changed: "Project
One", the IEC load speed (about 400 bytes/s, measured 406), the NIB
subtitle.

**A `.sid` worked example in the disassembly reference (#64).**
`toolchains/disassembly-reference.md` assembles its own PSID file
(BSD-3-Clause, no HVSC file), reads init $1000 and play $1003 from the
header, disassembles the body with da65, and runs it in the windowless
`vsid`: init once with A = $00, play every 19656 cycles (one PAL frame),
called from the driver vsid places at $1100. `formats/c64-file-formats.md`
no longer says KickAssembler cannot produce a `.sid`.

**A full SID music player recipe with measured cost (#50).**
`recipes/kickassembler/music-player.md`: order lists, patterns,
instruments with a wavetable, a two-frame hard restart, two filter
programs and six prioritised effects on voice 3, with an original tune.
A CIA1 stopwatch over 2,000 calls measures the worst call at 1,198 cycles
on PAL and 1,174 on NTSC; an ENV3 check finds the music's attack after
all 11 hand-backs. Two bugs in the source player are fixed: the pulse
sweep never ran, and the NTSC skip was one call in five, not six.

**Plain prose and corrected claims across docs/ (data 777; #56, #67).**
Every page's prose lost its machine-written wording in six batches;
`npm run check:prose` passed on all of them, and a clean ingest keeps the
graph unchanged. Reading slowly surfaced about 190 claims that looked
wrong on the hardware, toolchain, runtime, format and pitfall pages; each
was settled against VICE, the ROM bytes, the compilers or a measured
page, with a correction clause. The most consequential: the KERNAL jiffy
clock is ~60 Hz on PAL as well as NTSC (timer latch $4025, 3,590 jiffies
over 3,000 PAL frames); a stack push writes before it decrements; the
Oscar64 default zero page is 8 bytes; a 50 Hz PAL CIA tick needs latch
$4CF8; an IEC LOAD runs at ~406 B/s; the KERNAL never uses $DD0C. Search
recall was measured for #26 (36 queries, recall@5 0.917); the BM25
encoding stays.

**`c64_re_irq_chain` counts interrupt dispatches, not executions of an
address (#66).** It counted every execution of every value a vector ever
held. On `kickassembler/sprite-multiplex-game` that gave 2,338 NMI entries
at `$0B8C`: the IRQ exit's `rti` doubles as the `nmi:` label, and CIA2
never raises an NMI. On `kickassembler/raster-bars` it gave 11 handlers for
10 bars: `$0B04` and `$0C00` exist only between a low-byte and a high-byte
store to `$0314`. The tool now also traces stores to `$0100-$01FF`, and
VICE logs an interrupt's pushes with PC high at `$0100` + SP + 3. It names
the handler from the vectors at that moment, and an entry is that
handler's first exec within 94 cycles. Measured in VICE x64sc 3.10: the NMI
handler has 0 entries, the IRQ handler still has 2,338, and raster-bars
has 10 handlers of 256 entries each. `$0B04` and `$0C00` now appear only
under the new `transient` field. The output also gains an `interrupts`
count.

**MEASURED, a demo built only from the KB, is checked in under `demos/measured/`.**
Five parts (a tech-tech logo with a sprite border scroller, a twister with
vector balls, DYSP side-border sprites over a soft scroller, a fire effect,
a sprites-only screen with vector balls), each a KB technique with a recipe
behind it, on a sequencer that grades the parts with a verdict byte and a
frame meter and pins the end screen on PAL and NTSC; `verify.sh` runs the
whole battery. The root README links it. The tune is a placeholder; a full
player and a new score are in progress. Nothing under `docs/` changes, so
the data version does not move.

**Issue #55: the first new technique, `sid_env3_filter_envelope`, lands
(data 771).** Voice 3's hardware ADSR drives the filter cutoff: `$D416` =
(`$D41C` >> 1) + base every frame, with 3OFF set and FILT3 clear, so the
cutoff has the chip's own attack, staged decay, sustain and release. A
new technique page, `techniques/sid-instruments.md`, holds it. The recipe
`kickassembler/sid-env3-filter` pins the identity on 192 of 192 frames on
PAL and NTSC and on both SID models, the copy at 7 cycles a frame over a
static cutoff and 22 on the worst frame over the same player with no
envelope (measured, CIA1 bracket). Its `runs.json` entry adds `-sound
-sounddev dump -soundarg /dev/null` after the verifier's `+sound`:
without a real sound sink reSID does not clock the envelope and `$D41C`
returns nothing useful (measured). The page's listing is the build's four
sources folded into one file, and the pins were re-made from it.

**Two RE tools and the disassembly-reference page (data 775, tools 2.4.0,
RE pilot step 1).** `c64_re_irq_chain` and `c64_re_frame_profile` (`src/tools/re.ts`,
`src/server/tools-re.ts`; CLI `re-irq-chain`/`re-frame-profile`) run a
`.prg` headless in VICE x64sc and report its interrupt chain and the
cycle cost of a marked region as measured observations, each with an id,
basis and rung, returned whole as MCP structured content with a text
summary. A run counts from the first execution of the PRG's BASIC SYS
target; when that never runs within the cycles given the tool refuses
(reason `no-entry`). Writes before it (the KERNAL's boot) seed the state
but are not reported. A `disk_path` is copied and the copy attached, so
writes to it are discarded. Needs the windowless x64sc (`npm run
vice:headless`). Deferred to later steps: per-routine `prof` totals, the
frame mode of `c64_re_frame_profile` (it times a region between two
markers), and the `$D01A`/`$DC0D` mask report. Calibration against this
repo's own figures is in the next entry.
`docs/toolchains/disassembly-reference.md` (issue #3) covers `da65`, the
VICE monitor run in batch (checkpoints, `prof`, `chis`, `memmapshow`), the
ROM tables (each checked by reading `kernal-901227-03.bin`), the KERNAL
IRQ/NMI walk and the byte-census technique. #3's own text named "$E5B6
DOS messages" — wrong: $E5B6 is code, the high operand byte of `LDY
$0277` at $E5B4; DOS messages are in the 1541 drive ROM from $E4FC, not
the KERNAL. #3 is closed; its remaining item, a worked `.sid` recipe, is
split out to #64 (needs a `.sid` this repo may use). Five more issues
filed from [the RE design
spec](docs/superpowers/specs/2026-09-23-reverse-engineering-design.md):
headless joystick input via VICE event recording/playback (#59, related
#42), legal scope of game studies for maintainer review (#60), and one
per pilot game — Gridrunner (#61), Uridium (#62), Elite (#63). The spec
said `memmapshow` needs a VICE rebuild with `--enable-cpuhistory`; Task 7
measured that it already works in the current windowless build when
called from a checkpoint after the program runs (the earlier probe called
it at start-up, before anything had executed), so that rebuild issue was
not filed.
- `docs/hardware/c64-memory-map.md`: the KERNAL's VIC-II power-on table
  is 46 bytes, $ECB9-$ECE6; the page called it 47. The copy loop at
  $E5A8 (`LDX #$2F`) copies 47 bytes to $D000-$D02E, the 47th being
  $ECE7, the `L` of the LOAD/RUN string, which lands in $D02E (sprite 7
  colour). KEYTAB ends at $ECB8, not $ECB9 ($ECB9 is the power-on table's
  first byte). Both read from `kernal-901227-03.bin`.

**RE tools calibrated against this repo's own measured figures
(`test/re-calibration.test.ts`).** Before any third-party game is
studied, `reIrqChain` and `reFrameProfile` (`src/tools/re.ts`) had to
reproduce three figures this repo already committed, at a fixed 2%
tolerance; none missed. Measured in VICE x64sc 3.10 (windowless),
rung 1 — the tools' own trace, not a reading from the recipe pages.
- `kickassembler/irq-chain`: armed lines exact, `{40, 130, 260}` against
  the listing's `LINE0`/`LINE1`/`LINE2`. Raw `arms[]` also held `{4, 296}`
  a few cycles apart — the composite of the dispatcher's two separate
  writes, `$D012` then `$D011`'s bit 7. `handlers[].armed_before`, the
  state at each actual entry (the field `test/re-tools.test.ts` already
  reads for this), is `{40, 130, 260}` and is what the test checks.
  Since boot writes seed the state, `arms[]` also opens with 55 (the
  listing's `STA $D011` at $0858 combined with the KERNAL's power-on
  $D012 of $37), then 40 from its `STA $D012` six cycles later; before,
  that first arm was null.
- `oscar64/falling-blocks`, CIA1 timer A, 12,500,000 cycles: measured
  worst 6,277 against the design page's 6,276 — 1 cycle, 0.02%.
  `main()` calls `worst_subject()` once, before the scripted game's own
  per-frame loop (falling-blocks.md lines 525 and 552), and times its
  RULES and RENDER parts with the same `$DC0E` pair; the run's first two
  samples were that constructed 20-row case (measured 5,718 and 9,312
  against the page's own 5,717 and 9,311), not a frame of the game, and
  are excluded by program order, not by value.
- `oscar64/platformer-scaffold`, CIA1 timer B, 40,000,000 cycles, fresh
  `TEST,01` disk: measured worst-in-frame 8,694 against the design
  page's 8,693 — 1 cycle, 0.01%. The run held one sample over a frame
  (4,444,670 cycles, the KERNAL's disk I/O on timer B), excluded as
  `io_frame` per the recipe's own text.
- `oscar64/simple-shmup` has no CIA timer harness — no `t_start`/
  `t_stop`, no `$DC0E`/`$DC0F` bracket — confirmed against the source.
  Data 758's design-validation table below already called
  `simple_shmup_oscar64` "not timed"; this task found the same thing
  independently, from the listing, not the table. Nothing was measured
  here; this is a gap, not a calibration.

**Claims corrected (data 774; #57, #58, #40).** The prose pass of #56
found about 40 claims that looked wrong; each was settled against VICE,
the ROM bytes, the assemblers, a measured page or arithmetic, and each
change says what the page said before. Among them: `CLD` takes 2 cycles
(timed in VICE), not 1; `$37` is the default memory map, not a way to
drop the KERNAL (ROM `$FDD5` stores `$E7`); a badline takes 40 to 43
cycles; sprite DMA uses two-cycle slots from cycle 58 to 10; a multicolour
pixel is 2 wide and a sprite 7.5 % of the screen width; FILT3 is `$D417`
bit 2; 6 frames a beat is 500 BPM on PAL and 600 on NTSC; the
vertical-shooter archetype no longer names horizontal shooters;
`__attribute__` placement in `art/asset-pipelines.md` was not Oscar64
syntax (error 3005) and is now `#pragma region`/`section`, compiled and
checked in the map. The pattern `dim_colors_on_8580` was about sound and
is now `quiet_audio_on_8580`. Claims no instrument could settle now say
"not checked here".

**Plain prose, batch 1 of #56 (data 773).** The design, art, music,
workflow, game-design and root pages lost their machine-written wording:
reversal openers, importance claims, metaphors, editorial adjectives,
scaffolding and em-dash asides. `npm run check:prose` passed on all 26
pages (every code block, table row, heading and metadata line unchanged;
every number, hex value, code span, link and acronym still there as often
as before). A clean ingest gives the same 925 nodes and 5,403 edges, every
node property and edge identical; 46 of 50 top-5 search results for ten
queries on these pages are unchanged. The pass found about 40 claims that
look wrong; they were not changed and are listed in #57 and #58.

**Stale pages and tool descriptions found by the README audit (data 772,
tools 2.3.2).**
- `docs/ARCHITECTURE.md`: counts removed; the CLI list, node labels,
  derived edges and analytics location brought up to date; the
  verification section now covers verify:recipes, claims-watch,
  verify:templates, CI and releases.
- Tool descriptions: `c64_search` said the corpus had no cartridge pages
  (it has cartridges, the REU and the 1541); `c64_recipes_for` called its
  technique filter a no-op (it matches a Technique name through
  IMPLEMENTS); `c64_run_game` said it kills any x64sc (only the one on
  monitor port 6502), assumed x64sc on PATH, and cited a `loop/` directory
  that does not exist; `c64_report_gap` promised a dashboard nothing
  tracks.
- Licence fields: sim6502 is GPL-3.0 on GitHub, not MIT; simen/vice-mcp
  states no licence, and the page said MIT. The sim6502 page now says its
  VICE backend's `barryw/vice-mcp` is a VICE fork, not the MCP bridge
  `c64_run_game` drives.
- `agent-harness.md` said claims-watch was not on the branch; it is.
  CLAUDE.md said CI runs every gate but the ingest; it runs neither
  verify:templates nor anything Oscar64.
- `docs/figures/fig6-architecture.png` and `fig7-ontology.png` removed:
  they showed stale counts and nothing linked them.

**Package 0.17.1.** The first release published by
`.github/workflows/release.yml` through npm trusted publishing, with
provenance; 0.17.0 (2026-09-24) was published by hand. Since 0.17.0 it
carries the plainer README, prose batch 1 of #56 and the corrected tool
descriptions (tools 2.3.2). Trusted publisher on npm:
`bdgscotland/c64-kb`, `release.yml`, environment `npm`, which only `v*`
tags can use and which needs the maintainer's approval.

**Licence pass before npm publishing (data 771).** A measured check of
`docs/` found no copied prose (runs of 25 or more words shared with 108
cited sources and the classic references are number tables only) and no
substantial third-party code. Four fixes. `wireframe-ships` reproduced
Elite's 32 two-letter name tokens (QQ16), commercial game data; it now
uses its own table of the same shape, so its systems print GUBUDUIS ...
NEYA instead of TIBEDIED ... LAVE; seeds, coordinates and every cycle
count are unchanged, re-verified in VICE on both models (0 pixels from
the model). Three examples in `kickassembler-reference.md` (the SID
player, `ClearScreen`, `mov`) followed the KickAssembler manual line for
line; they are rewritten and now share no 8-word run with it, and the
new SID player was run in VICE against a test tune (one `play` per PAL
frame). `oscar64-headers-reference.md` said `license: MIT`; Oscar64 is
GPL-3.0. The SID ADSR table now names its source.

**npm package (package 0.17.0).** An installed package could not do
anything useful: batch ingest existed only as an npm script in a clone,
`docker-compose.yml` was not shipped, and state was written inside the
package folder. `c64-kb ingest` and `c64-kb services up|down|status` now
exist, and state goes to `$XDG_DATA_HOME/c64-kb` (or
`~/.local/share/c64-kb`, or `C64_KB_DATA_DIR`) when the package is under
`node_modules`; a clone still uses `data/`. CI installs the packed
tarball into an empty folder and runs services, ingest and a lookup. A
release workflow publishes on a `v*` tag; the first publish and the
licence check are open in #52.

**A routed game briefing names its starter (tools 2.3.1, package
0.16.1).** `c64_game_briefing` with no `archetype` routes by the brief's
words, but its query did not select `a.starter`, so a routed briefing
never printed the `new-project` command. Naming the archetype did. The
route now carries the starter, and a test in `test/briefings.test.ts`
failed before the fix.

**Every #39 starter is named by its archetype.** `**Starter:**` lines for
`text_adventure` (adventure), `beat_em_up` (beat-em-up) and `demo_intro`
(demo), now that those starters are on main; `c64_game_briefing` and
`c64_demo_briefing` print their `new-project` command.

**Issue #39: `shmup-vertical` loses no frames on NTSC.**
- The lost-frame counter could not see a single late frame: it counted
  frame-counter steps other than 1. It now checks the frame flag before
  waiting.
- With it, NTSC play lost frames at play frames 282-321 and 454-477,
  which the staged run never reached. The heaviest steps moved to
  KickAssembler, and the latest end of work is now line 256 of 263 on
  NTSC.
- `make joytest` plays 16 games per model with fire held and sweeping,
  and fails on any lost frame. `make longplay` plays about 40,000 frames
  per model with an invulnerable ship. Both run 0 lost.

**Issue #39: the `beat-em-up` starter lands; `lane_depth_engine`
corrected (data 769).**
- `templates/beat-em-up` is a three-stage street brawler in Oscar64 plus
  KickAssembler:
  - fighters of two sprites each in a band written near to far;
  - a brute drawn in characters, with `$D01B` behind bits;
  - attacks gated by lane and per-frame boxes;
  - round-robin AI, and a tune with effects.
- It checks itself with a flicker check that renders every part from the
  art, a VIC register read-back every frame, an independent hit re-check
  and a game-over check. It passes on the local Oscar64 and on v1.32.273.
- Measured worst 14,960 / 9,359 PAL and 16,464 / 9,897 NTSC.
- The review measured that a Y-sorted multiplexer draws the farther
  actor in front. `techniques/logic.md` `lane_depth_engine` said the
  depth and raster orders agree; step 3 and "More actors" now say they
  are opposite, with a correction clause.

**agent-harness: counting lost frames.** The meter reports cost, not
lateness, and the page did not say how to count a dropped frame. A check
at wake-up for a frame counter that moved by more than one misses every
single overrun (shmup-vertical 7974a7a: a frame made ~2,400 cycles late
left `OVERRUNS 00`); the page now says to test the next frame's flag when
the work ends.

**Issue #39: `shmup-vertical` gets enemy fire and a per-frame bullet
check.**
- Darts, weaves and swoops fire dots that drift towards the ship, from
  a 6-dot pool in a fire window at Y 72-140. The dots' step, the
  bullet draw list, the enemy boxes and the path step moved to
  KickAssembler: the staged worst had reached 17,882 NTSC cycles, over
  the frame.
- Staged worst now 15,991 PAL / 16,136 NTSC, with no frame lost; graded
  run 12,912 / 13,015.
- Each bullet cell is read back against the map after every erase.
- `make joytest` plays to game over, reboots on the same disk and
  requires the saved high score.
- It passes on the released Oscar64 v1.32.273.

**`verify:templates --selftest` runs each starter's own proof targets
(#42).** Several #39 fixes are proved only by a starter's own target: the
adventure's save validation by `disktest`, the platformer's scroll timing
by `tearcheck`, the demo's stable entry by `probe`. A starter lists them in
`VERIFY_TARGETS`; `--selftest` runs each after `make selftest`. Seven
starters with their targets: 7 of 7.

**Issue #39: `platformer` hardened after the other session's
comparison.**
- It builds and passes on the released Oscar64 v1.32.273, with
  `surface_at` kept out of line (#30) and the score printed through
  `put_digits`. v1.32.273 dropped digits from a loop; that fault is not
  reduced yet.
- The live-enemy limit is 5: six live enemies overran the NTSC frame
  (17,618 cycles staged). `make stage` fills every slot.
- `check_frame` checks four invariants every frame, each with its own
  fault bit. The slope bit caught a mutation that the tear check missed.
- Hitboxes come per animation frame, with a group and a mask; the stomp
  is a feet box on the falling frame.
- `tools/drive.py` runs at real speed and on a free port.

**Issue #39: `action-puzzle` hardened after the other session's
comparison.**
- The redraw is bounded. An overflowing dirty list used to redraw 280
  cells in one frame (55,305 cycles); rows are now queued, two a frame.
- The right roll, the restart path over three lives, the high-score
  read-back and the once-per-scan check are all gated. Each is proved
  by a mutation.
- Dropped frames are counted from the `$D019` raster latch.
- It builds and passes on the released Oscar64 v1.32.273.
- Staged worst frame (16 boulders falling in one slice): 13,619 PAL /
  13,832 NTSC cycles.

**Issue #39: the `demo` starter lands, and the two stub skeletons are
removed.** `templates/demo` is pure KickAssembler:
- a part table with init, update, out step and teardown, and a
  table-driven IRQ chain;
- a stable double-IRQ raster-bar kernel, a sprite sine chain, a
  scroller, and an original tune with NTSC tempo skips.

It checks itself on PAL and NTSC with 229 screenshot checks, 8
jittered probe shots of the bar kernel, dispatcher counters (late and
bad frames), a deadline test on the frame slot, and a SID store trace
(`make audio`). Measured worst 7,332 / typical 6,586 cycles on PAL.
`templates/c64-demo-starter` and `templates/c64-game-starter` are
removed. The game starter fed a `.prg` to Oscar64 as source, which
Oscar64 ignores.

**Issue #39: the `adventure` starter, STARWATCH.** It is a 12-room text
adventure in Oscar64:
- the world is data in `tools/world.py`, and a Python model checks the
  game line by line;
- a two-word parser with synonyms;
- text packed by byte-pair coding, 40% smaller;
- picture strips coded row by row;
- one window line printed per frame;
- SAVE and LOAD on drive 8, with the record versioned from the world.

Measured in VICE x64sc 3.10:
- worst 15,272 / typical 8,543 cycles on PAL; 15,488 / 8,842 on NTSC;
- `make disktest` saves, cold-resets and loads under true 1541
  emulation, and refuses three bad saves.

Its review found a picture that overran the frame. `gen.py` now refuses
a script that does not show every picture. The other #39 session's
comparator chose this version as the base and its disk extras were
ported.

**Harness: `make released`, and the keypad joystick on `make run` (#39).**
The starters are verified with a patched Oscar64 (#25) while a downstream
agent has a release. `make released OSCAR64_RELEASED=<path>` builds the
autopilot program with that compiler and grades its PAL and NTSC shots
with the starter's own `expect.json`. On v1.32.273 it found the platformer
graded 7 of 23: `surface_at` inlined into `surface_walk` reads the slope
table with a stale X (listings on #30; `__noinline` passes 23 of 23).
action-puzzle graded 41 of 41. `make run` now passes `-joydev2 1`, so the
numeric keypad is joystick 2.

**Issue #39: one harness, and the briefing names the starter.** Two
sessions built #39 in parallel; the maintainer asked for one harness, the
best of both. Main's harness stays; four #42 items from the other build
are now in it:
- text and meter checks take `"dy"` (0-7 pixels) for a panel under a
  scrolled playfield, which the YSCROLL-3 grid could not read;
- with `SHOT_DISK = 1` each headless run gets its own copy of the D64,
  since VICE writes a save back into the image and the next run then
  started from another disk (hello: two shots byte-identical, the release
  D64 unchanged);
- `make zp` lists the zero page a build's C touches, from Oscar64's
  listing. The pages said Oscar64 owns `$02`-`$52`; its temporaries run
  from `$43` up by each function's temp count, and hello reaches `$55`,
  platformer `$5B`, shmup-vertical `$5D`. hello's claim `$02`-`$52` failed
  `make claims` (309 stores to `$53`-`$55`, KERNAL IRQ undeclared); it is
  now `$02`-`$55` with `--kernal IRQ` and passes;
- `check.py` finds the character ROM in the repo's headless VICE, the
  only copy on a CI runner.

A `**Starter:**` line under an archetype becomes the Archetype's
`starter` property (schema 31). `c64_game_briefing` and
`c64_demo_briefing` return it as `archetype.starter` and print the
`npm run new-project` command (tools 2.3.0: an added output field). A
test fails when a page names a starter with no Makefile and expect.json.
Lines for vertical_shmup, scrolling_platformer and puzzle.

`mixed_sprite_char_actors` had a measured Cost line and no
`**Cost measured on:**` line, so `plan-budget` printed "recipe not
stated"; it names `oscar64-mixed-fighters` now.

**Issue #39: the `shmup-vertical` starter.** It is a vertical shooter:
- Oscar64 game logic, with a KickAssembler IRQ chain, panel split,
  multiplexer, row copy and music player;
- the playfield scrolls through all eight YSCROLL phases above a fixed
  panel;
- waves on paths, character bullets, hitboxes per sprite frame, effects
  on voice 3, and a disk high score.

Measured in VICE x64sc 3.10:
- worst 12,472 / typical 7,103 cycles on PAL; 12,721 / 7,293 on NTSC;
- the staged heaviest frame (`make stage`) is 14,073 PAL / 14,740 NTSC;
- `make phases` compares the panel at all eight phases.

Its review found that sprites on badlines during KERNAL serial I/O hang
a save in VICE (#43).

**Candidate list, batch 17, two of four: the tech-tech wobbler and DYSP,
from fixed designs with measured write-cycle sweeps (data 764).** The
tech-tech wobbler: a badline forced on every line of a six-row logo band
after the cycle-14 RC check, so the VIC refetches the video matrix each
line from whichever of eight pre-shifted screens `$D018` names, plus
XSCROLL for the remainder; the logo's left edge moves 62 pixels across
the band exactly as the sine table says, on both models; the sweep over
five write placements shows the one-early case resetting RC on every
line and the late cases losing one cell per cycle; the FLI-bug strip's
three cells and their colour are tabled; the XSCROLL-only control swings
seven pixels; 3,405 cycles a frame for the band. DYSP: four sprites at
different heights inside the opened right side border, each on its own
sine, with the border-opening write timed per line from a table indexed
by the SET of sprites active on that line; the border stays open on all
150 band lines and every write lands on the same cycle whatever the set.
A table indexed by the COUNT of active sprites cannot do it, measured:
two cycles a sprite closes the border from the first line with a
non-zero sprite alone, three and four cycles close it earlier, and the
plain side-border timing closes all 150 lines. Pins byte-identical on two
runs per model, both reproduced by reviewers who also confirmed the
effect in their own pictures. Linecrunch and Kefrens bars, the other two
of the batch, stalled six times each on the workflow's watchdog and are
being rebuilt as standalone runs.

**Issue #39: the `platformer` starter.** It is a side-scrolling game in
Oscar64 with a KickAssembler part:
- a 2,048 px tile level with three screen pages;
- the next page is prepared five rows a frame and flipped in the
  vertical blank;
- slopes, ledges and 8.8 jumps;
- walkers and hoppers wake in an activation window;
- a HUD under a raster split, and a tune.

Measured in VICE x64sc 3.10:
- worst frame 12,564 / typical 7,042 cycles on PAL; 12,991 / 7,443 on
  NTSC;
- `make tearcheck` compares mid-play shots with the level and catches a
  torn build.

Its review found Oscar64 fault 7 (#30; now in CLAUDE.md and
`oscar64-reference`). The harness also changed:
- claims-watch now recognises a JSR push logged after an IRQ entry;
- the meter finds its median by selection, not by sorting.

**Issue #39: the `action-puzzle` starter, CAVE RUN.** It is a Boulder
Dash-style game in Oscar64:
- the cave scan runs a quarter per frame;
- two RLE caves are decoded between levels;
- enemies follow walls;
- a two-voice tune plays, with effects on voice 3;
- a high-score table is saved to drive 8.

Measured in VICE x64sc 3.10:
- worst frame 10,033 cycles and typical 6,340 on PAL; 10,292 and 6,598
  on NTSC;
- `make disktest` saves twice under true 1541 emulation, then cold-boots
  and loads the table back, on PAL and NTSC;
- `make joy` with `tools/drive.py` plays the normal build headless.

**Candidate list, batch 16: four items from fixed designs, each a
technique entry and a pinned KickAssembler recipe (data 763).** The
sprites-only screen mode: the display enable bit held clear through line
48 so no badline occurs all frame, set for line 51 so the vertical
border flip-flop resets, and the select bit toggled around line 251 so
it never sets again; eight sprites drawn at every height from line 8 to
the frame wrap, a free-CPU meter reading 904 iterations of a 20-cycle
loop per PAL frame against 847 with a normal display (the badline and
border cost by subtraction), the closed-border control hiding three
sprites and the display-off-only control showing none. BASIC ROM
floating-point routines called from machine code, every entry point
read from the 901226-01 ROM image with the monitor before it was used:
square root of two, 355 over 113, 0.1 plus 0.2 and the five bytes of
one tenth printed and compared against asserted strings, FMULT 1,079
cycles, FDIV 2,409, FSQR 43,752 and FOUT 7,412 with the display off, the
zero-page bytes the sequence changes listed, and the same calls with
BASIC banked out as the control. Depth-sorted sprite vector balls: eight
balls on a tilted ring, a single bubble pass per frame assigning sprite
numbers by depth so the hardware's fixed priority draws the nearer ball
on top (1,318 cycles a frame, the order unsorted only on the first six
frames), and a control without the sort drawing the farther ball over
the nearer one at the same overlap. Shade bobs: a blob adding one shade
step to a colour-RAM shade buffer under a luminance-ordered palette with
a decay pass every fourth frame, 590 cycles for the add, 26,514 for the
decay pass (over a frame, so it cannot fit the blank), and the buffer
dumped from memory matching colour RAM through the palette in all 1,000
cells. Eight pins byte-identical on two runs per model, each reproduced
by a reviewer from the page listing.

**The pseudo-3D road, with its per-line shift measured to work (data
762).** A coarse layer of thirteen multicolour character rows redrawn in
the vertical blank from a Z table and an 8.8 fixed-point centre
accumulator, and a fine layer that writes one `$D016` value per road
raster line from a cycle-locked loop entered by the double-IRQ stable
raster method, with the write at cycle 11 of each line, a 23-cycle
iteration on badline rows in place of 63, and separate PAL and NTSC loops
chosen by region detection at boot. The first build's fine layer had no
effect because a spin-wait put the writes at cycles 20 to 28, past the
latch; the recipe records that and the fix. Measured: coarse redraw 6,332
cycles PAL and 6,162 NTSC, fine chain 6,523 and 6,729; the kerb's left
edge in the pinned picture moves by one to seven pixels between adjacent
lines where the first build moved only at row boundaries; rows seven and
eight of the road now carry their own scroll values. Pinned on both
models. The page says what one scroll value per line cannot do, that the
grass is not cleared per frame, and that the geometry is this recipe's,
not a game's.

**Issue #38: a game brief routes to its archetype (data 761, schema 30,
tools 2.2.0, package 0.15.0).** `c64_game_briefing` with no `archetype`
used to run as a demo plan with a "Demo Briefing" heading. For a Spy
Hunter brief it proposed horizontal scrolls and RAM-banking techniques
("enemy cars ram"), and it missed the multiplexer, the hitboxes and
`vehicle_control`.

Each game archetype now has a `**Brief words:**` line
(`Archetype.brief_words`). A brief routes to the archetype whose words it
contains most; a tie routes nowhere. `vertical_shmup`'s fingerprint was
`sprite_multiplex_24` and `raster_bars`; it is now the panel split, the
game multiplexer, hitboxes and the wave director.

Five faults in discovery are fixed:
- techniques that match no word of the brief were proposed on their
  recipe bonus alone;
- stop words matched name and title words;
- the verb "ram" matched the acronym RAM;
- H3 vector hits lost their technique name;
- a horizontal technique was proposed for a vertical brief.

Output gains an optional `archetype.inferred_from`. Run `ingest:clean`
after updating.

**Issue #39, part H: a real template harness (data 760).** The two
starters in `templates/` were stubs. The game starter's KickAssembler
step was skipped even with a working assembler, and when it did run it
fed a `.prg` to Oscar64 as source. Neither starter had a headless run, a
check, an NTSC run or a measured frame.

`templates/_harness/` now gives every starter these targets:
- `make`, which links KickAssembler code into Oscar64 through a
  generated header;
- `make shot check`, headless on PAL and NTSC with the autopilot,
  grading the pictures against `expect.json`;
- `make selftest`, which proves the check fails on a faulted build;
- `make disk` and `make claims`;
- a frame meter on CIA2 timer A, printing the worst frame and the
  median frame on screen;
- a plan gate: no build and no write under `src/` until `PLAN.md` holds
  the real `check-compatibility` and `plan-budget` output.

There are two minimal starters, `hello` (C plus asm) and `hello-kick`.
`npm run new-project` makes a working project outside the repo, and
`npm run verify:templates` runs every starter. The loop is explained in
`docs/workflow/agent-harness.md`. The per-archetype starters follow.

**Issue #38: vehicle control, car contact and lane-pursuit AI (data
759).** There are three new techniques in `techniques/logic.md`:
`vehicle_control`, `car_contact_response` and `lane_pursuit_ai`. Each has
an Oscar64 recipe (`vehicle-control`, `car-contact`, `lane-pursuit`)
that matches a Python model frame by frame and is pinned on PAL and
NTSC.

Review changed code on each:
- `vehicle_control`: holding the throttle on the verge barely slowed
  the car, so acceleration now stops at the surface limit.
- `car_contact_response`: a truck scene now exercises the cooling rule
  and the truck's share of the push.
- `lane_pursuit_ai`: two fork rules were measured and dropped. When
  the road splits, pursuers take the other channel in 375 of 452
  car-frames, and the page says why.

Oscar64 fault 6 is in CLAUDE.md and `toolchains/oscar64-reference.md`,
with its repro on #30. `soft_scroll_v` lists the vehicle-control
recipe.

**Issue #22, steps 4 to 6: game designs, machine variants and the
claims watch; #36 decided (data 758, schema 29, tools 2.1.0, package
0.14.0).** One bump over main's data 757, schema 27, tools 2.0.0, package
0.13.0. Two shape changes land together, so the schema moves two: 28 is
GameDesign, 29 is MachineVariant. Step 6 changes seed values, not shape.
Tools 2.1.0 is a minor: every change to the surface is additive (a new
optional input, new output fields, and `position`, a field new in this
release, with a value no shipped consumer has seen). The package moves
with the tools minor.

GameDesign (schema 28). A new doc type, `docs/game-design/designs/*.md`
(`CONVENTIONS-game-designs.md`), makes a whole game a node: the archetype
it is an instance of (`INSTANCE_OF`), the recipe that builds it
(`REALISED_BY`), the techniques it runs in each phase (`COMPOSES`, with a
`phase` of play, init or transition) and what its frame measured
(`**Measured frame:**`, stored as `measured`). Three pages, one per
scaffold; the phases were read from each listing's `main()`, not its
frontmatter. `c64_plan_budget` takes `design` (CLI `--design`): the
design's members are budgeted by phase, and each measured frame is set
beside the prediction for its phase and region, with where it falls and
which members had no figure. `techniques` is now optional. `c64_game_briefing`
lists the resolved archetype's designs in `designs[]`.

What the validation showed, play phase, scratch graph:

| Design | Predicted (low-high + badlines) | Measured worst, PAL / NTSC | Members with no figure |
|---|---|---|---|
| `platformer_scaffold_oscar64` | 4,477-4,685 + 1,075 | 8,693 / 10,287, above by 2,933 / 4,527 | 5 |
| `falling_blocks_oscar64` | 5,902 + 1,075 | 6,276 / 6,491, within_incomplete | 4 |
| `simple_shmup_oscar64` | 5,628 + 1,075 | not timed | 1 |

Re-run on a scratch graph of the merged tree; the figures held. The
platformer's typical PAL frame (4,966, one frame's reading) lies within
its range. The falling-block agreement is partial: its one large
figure, `falling_block_rules`' 5,888, is a constructed upper bound, and
the render has no Cost line.

Corrections found on the way: the `falling-blocks` frontmatter named four
of the seven techniques its listing runs; the #22 design put
`tile_map_render` in the platformer's play phase, where it runs once at
init; the platformer's timer is CIA1 timer B, not CIA2.

MachineVariant (schema 29). Seven seeds, one per VICE `-model` word the
harness needs or the pages name (`c64`, `c64c`, `c64old`, `ntsc`,
`newntsc`, `oldntsc`, `drean`), with their chips, line length and lines.
`VERIFIED_ON` (Recipe to MachineVariant) is rebuilt after every ingest
from `docs/recipes/runs.json`, as `verify:recipes` runs each page, and
only where the committed screenshot exists: 242 edges on a scratch graph
of this merged tree (data 757), 0 problems; 131 recipes run on the c64c. `c64_recipe_lookup`
returns `verified_on[]`; `c64_recipes_for` takes `verified_on` (a variant
or PAL / NTSC). The R56A and the Drean are variants, not Regions, which
answers #8's question.

Review fixes, steps 4 and 5. `verified_on[]` applies a run's chip flags:
`cia-revision-detect` runs the c64c with `-ciamodel 0`, so its CIA is the
6526, and `overrides[]` says so (it listed the c64c's 8521).
`c64_plan_budget` gives `within_incomplete` when the measured worst lies
inside the range while members have no figure; it said `within`. A typical
frame's excess is a share of the typical, not of the worst. `simple-shmup`
is an instance of `vertical_shmup` only (the listing scrolls vertically).
A runs.json page with `skip` (main's tape-turbo-loader) gets no
`VERIFIED_ON` edge; it was reported as a missing screenshot.

Claims watch (step 6). `scripts/claims-watch.ts` runs a PRG in the
windowless x64sc with a store trace and judges every store against the
claims its techniques declare, their REQUIRES closure, a harness list and
the KERNAL routines it names. Exit 1 on a store outside them. Validated on
four recipes: each fails on its page's declarations alone and passes once
its RAM, harness timers and missing units are declared; a multiplexer
with `sta $d40b` and `sta $fb` added fails on exactly those two stores.
The CIA timer and TOD units now own their bit of the interrupt control
register ($DC0D/$DD0D bits 0, 1, 2). `vice-reference.md` says how to run
it.

#36: VICE's default machine is the `c64c` configuration (VIC-II 8565, SID
8580, CIA 8521), not the 6569 that `vice-reference.md`, `pal-ntsc-detect.md`,
CLAUDE.md, the README and twenty page statements said. `x64sc -default
-dumpconfig` is identical to `-model c64c`. Re-run for this entry:
`cia-revision-detect` with no `-ciamodel` reads the new CIA on the default,
`c64c` and `newntsc`, the old one on `c64` and `ntsc`; `palette-cells`
under `-model c64` differs from the default in eleven of sixteen entries.
The maintainer's decision: keep the default, say c64c. No screenshot is
re-baselined; every page that called the VICE PAL run a 6569 now names the
C64C with a clause saying what it said; `-model c64` is the check for the
older machine.

**Candidate list, Tier B batch 15: four more items from fixed designs,
each a technique entry and a pinned KickAssembler recipe (data 757).**
A sprite text scroller in the opened lower border: eight glyph sprites
at Y 254 under a border opened by the top-and-bottom recipe's method,
829 cycles a typical frame and 1,586 on a hand-off frame, every sprite
row inside the PAL frame and the control build with the border left
closed showing no sprite pixel below line 251. A twister: a 64-pixel
column whose four faces come from one sine, its 64 phase images built at
assembly time so the frame loop is a 128-line copy of 13,001 cycles
blanked, the pinned edges matching the edge table at three rows and a
straight control with one row pattern on every line. The `$D017` sprite
stretcher, which this KB had marked unverified, reproduced in VICE: a
setting write on any cycle from 48 to 55 (cleared four cycles earlier)
makes a 21-row sprite 91 lines tall over 81 toggled lines, each row held
for eight lines, while cycle 56 gives 24 lines and cycles 57 to 62 give
44, 50, 47 and 94; the fifteen-build sweep is on the page, the pinned
build is cycle 52, and the control with the stores aimed at RAM is the
plain 21 lines. An LFSR-ordered screen dissolve to finish the transitions
family: a maximal 10-bit register visiting each of 1,000 cells once, 20
cells a frame, 3,203 cycles on the worst frame, half the cells landed at
frame 25 and the last on frame 50, beside a sequential control that is a
wipe. Eight pins byte-identical on two runs per model, each reproduced
by a reviewer from the page listing.

**Candidate list, Tier B batch 14: four demo effects, each a technique
entry and a pinned KickAssembler recipe (data 756).** Multicolour
interlace: two multicolour bitmaps in two VIC banks alternated at the
frame with a one-hires-pixel shift on the odd frame, the diagonal one
pixel further right in the second field at every row measured, a PIL
average of the two fields showing four distinct columns per pixel pair
where one field shows two, and a frame loop of 34 or 32 cycles (the
brief's single-bank layout did not fit, 18,000 bytes into 16,384, and the
page says so). Dot flag: a 16 by 8 grid on two sines plotted and erased
through the hires plot, 119 cycles a dot, 15,233 a frame blanked and up
to 16,098 with the display on, exactly 128 lit pixels in the pinned
picture and 3,570 without the erase pass. Fire: a colour-RAM heat map
over a solid glyph with a luminance-ordered palette, 53,479 cycles for
the whole screen and 27,301 for the larger half, so the screen refreshes
every four frames; the pinned picture's colour census is on the page.
DYPP: a text scroller of eight sprites, each column on its own sine,
1,147 cycles a frame for the position update and 715 for a character
re-render, the two sprites past X 255 drawn at 14 and 62 instead of 270
and 318 when the high-bit write is left out. Eight pins, byte-identical
on two runs per model, each reproduced by a reviewer from the page's own
listing; the three new anchors went on the pitfalls whose mechanism the
code meets.

**The isometric tile engine, built from a fixed specification (data
756).** Two earlier attempts stalled on the open design; this one was
handed the map, the projection, the draw order and the depth rule and
built exactly that: an 8 by 8 room of 2:1 diamond tiles four characters
wide, blocks one and two tiles tall drawn back to front so nearer cells
overdraw, a hardware-sprite player whose one priority bit is set when a
block in front of it overlaps its character box, and a scripted walk.
Measured: a full room redraw of 42,034 cycles, one block of 527, the
depth bit set at three of the six positions (the specification predicted
one; the recipe says why the character box catches two more), and a
negative control with the painter's order reversed that fails the
verdict. Pinned on both models. The entry says what one priority bit
cannot do.

**Four more measured pitfalls, and a logic pitfall page (data 755).** A
one-byte breadth-first distance map that uses 255 for "unreached" wraps
on a path longer than 254 cells: on a serpentine corridor the live map
read 1, 0, 1, 2 across true distances 255 to 258, a chaser at 254 walked
two cells away from the player and every far chaser gathered on a false
zero; saturating at 254 and a two-byte map are both measured as fixes,
and the recipe's own maze, whose longest path is 76, cannot show it.
Asserting ATN from the C64 pulls the drive's DATA line low through the
1541's ATNA gate whatever a resident drive program writes: DATA IN read
released with ATN released and low with it asserted under ATNA clear,
the mirror image under ATNA set, controls with DATA OUT held low, the
drive's own port read at each phase, a drive that leaves interrupts
enabled behaving the same, and the fix, a drive loop that copies ATN IN
into ATNA every pass, leaving DATA free in all three phases. Sprite
registers persist across a game-state change: a play state that enables
only its own sprite inherited the title's pointer, expansion, multicolour
and a latched collision on both models, a game-over screen kept the
player across its banner, and a per-state VIC baseline routine clears all
of it. A CharPad `.ctm` embedded whole puts its header on glyph 0 and
shifts every glyph by 18 bytes on a version 8 file, identically under
Oscar64 and KickAssembler; the offset-and-length forms of both embeds and
the raw export are the fixes. Follow-ups from those measurements: the IEC
page's VIA table now says that ATN IN reads 1 when ATN is asserted, and
that its snapshot rows were taken under ATN; the drive-upload technique
records a 34-byte `M-W` as measured; the pitfall conventions list the
maths and logic categories; the text-mode render page's intro no longer
numbers its entries.

**The deferred raster anchors (data 754).** `badline_cycle_loss` gains
sprite_color_swap_mid_line, solid_vector_3d, mode7_lookalike and
vsp_glitch, and `raster_irq_first_line_jitter` gains mode7_lookalike and
vsp_glitch, each on the sentence of the technique that meets the
mechanism (a colour split placed by write cycle inside the badline's
stolen span; a filler that budgets forty cycles a badline row; a
per-line register chain with no stabilisation in its budget; a trick
whose write cycle is the effect). The techniques still without a pitfall
are the two loader notes and three logic entries the triage judged to
need none. The two-bit fast loader candidate was attempted and not
landed: its transfer never ran, so its pages were not merged and the
attempt is kept as a private experiment record.

**Every technique a pitfall can reach now has one, bar seven (data
753).** A read-only triage of the techniques no pitfall named sorted each
into an existing pitfall its text meets, a new measured pitfall, or none
with the reason. Eighteen anchors were added to existing entries on seven
pitfall pages, each checked against the technique sentence that meets the
mechanism, and `ram_under_rom_traps` gained cartridge ROM at `$8000` to
`$BFFF` as a fourth ROM-mapped range. Five new pitfall entries, each
measured first: a bank or mode write executed from the cartridge window
it switches hands the very next opcode fetch to the new bank (traced at
the cycle; the fix runs the switch from RAM or makes the switch site
identical in every bank); setting ECM while MCM is still on selects an
invalid mode that draws the whole window black while sprite collisions
and priority still work against the invisible field, on both models,
with ECM plus BMM tabled beside it; a new maths pitfall page with a sine
table of amplitude 128 that peaks at 256 and wraps seven entries to zero
under both toolchains, and a shift-and-subtract divide whose missing
carry guard is a 16/8 fault only, wrong for divisors of `$81` and above
(24,400 misses over the recipe's sweep) while the 8/8 and 16/16 loops
pass with the guard deleted; and Oscar64's assembler optimiser at `-O2`
rewriting a non-volatile inline block and duplicating it, so a store into
an operand byte lands in a copy that never runs (the executed and the
dead listings quoted; `volatile`, `#pragma optimize(noasm)` and a
data-patch form each measured as fixes). The divide measurement
corrected the technique page and the divide-check recipe, which had said
the guardless loop fails for divisors of `$80` or `$8000` and above; the
multiply technique's account of what the mis-optimised routine computes
was corrected from the executed listing. The seven techniques still
without an anchor are two loader notes and three logic entries the triage
judged to need none, and two whose anchors wait on the raster pitfall
page another agent is writing.

**Four pitfalls met while landing the night's recipes, each measured
before it was written (data 752).** A VIC colour register reads back as
the colour plus 240, so `IF PEEK(53280)=2` after `POKE 53280,2` is
silently false: every register from `$D020` to `$D02E` measured 0 to 15
on both models, with the other unused VIC bits (`$D016`, `$D018`,
`$D019`, `$D01A`) tabled beside them and the audited hardware page
agreeing on each. A self-extracting decruncher that runs from the zero
page leaves the KERNAL's variables full of its own code: Dali `--small`
and bitfire's stub both silenced a payload that prints through CHROUT,
and the zero-page diff at entry names the bytes, `$9A` set to the RS-232
device under one and to a serial device under the other, the editor's
line pointer at `$4CBA` under the second; Dali's standard stub and
pucrunch save what they clobber, and a prologue that banks the KERNAL in
and calls IOINIT and CINT prints under both. A colour RAM index of 1,024
or more writes CIA1's registers, with the sixteen bytes before and after
a fill to 1,040 (timer A stopped, the jiffy clock frozen, the port A
direction register left at the fill value) and the row-by-row fill that
leaves them untouched; the 24 spare bytes past cell 999 measured as
nibble RAM. One read of `$DC0D` or `$DD0D` clears every pending flag: a
FLAG poll took a timer underflow on its way past and the timer's own
check read `$00`, the copy-into-RAM pattern kept it, and a main-program
read racing CIA2's NMI lost the interrupt itself at one phase on NTSC
and on the old CIA model.

**Candidate list, Tier B batch 9, two of four (data 751).** A tape
mastering workflow page: a host writer that turns a PRG into a
KERNAL-format TAP (the three pulse lengths, the pair rule, the countdowns,
the two copies and the checksum the formats page measured), which a plain
LOAD then RUN accepts on both models; a decode-back checker that also
reads the TAP the KERNAL itself recorded; the turbo route, the turbo
loader mastered in KERNAL format as the stub with the turbo block
appended, loading from one image; timings by bisecting the cycle limit
(a 202-byte payload runs 33 seconds after LOAD on PAL, of which the FOUND
pause is a third; the KERNAL format costs 18,890 cycles a payload byte,
the turbo block 7.6 times less for the same 500 bytes); and the finding
that the jiffy clock is not a tape load timer, since both models printed
770 jiffies for a load of over thirty seconds. The PSID header
corrected: the bytes at `$7A` and `$7B` are the second and third SID
addresses in versions 3 and 4, the flags bits 6 to 9 their models, the
RSID rules in one paragraph; headers written by hand round-trip, VICE's
windowless vsid accepts versions 2, 3 and 4 and logs the chip addresses,
rejects odd or out-of-range addresses as no second SID, reads `$7B` from
a version-3 file where the document reserves it, and gives every chip the
first SID's model; a census of the HVSC corpus gave the version counts
and the address ranges seen. The isometric tile engine and the pseudo-3D
road did not land: both writers stalled six times on the design, and they
wait for a fixed specification like the scroller's.

**Candidate list, Tier B batch 8 (data 750).** The 1541's VIA registers
and memory map measured through the command channel and a probe recipe:
the density bits follow the requested track's zone even when the head
did not step, the stepper bits move one half-step per write from the
DOS's routine every 14,848 drive cycles, the motor bit and the
write-protect sense read as the states say (the latter checked with a
read-only attach), the LED bit was set only during an auto-initialise,
byte-ready reaches the CPU only with the port-control register's CA2
line high, and the first job after power-up does not step. A tape turbo
loader with a TAP written on the host: one pulse per bit at 256 and 512
cycles, 321 bytes a second on PAL and 334 on NTSC against the KERNAL's
own rate, the pulse spread under VICE's default wobble, a 208-cycle bit
that failed and why, and a timer-read race that mismeasured one pulse in
sixty until the read was done high, low, high; the recipe cannot be
pinned by the verifier, which now honours a `"skip"` key in `runs.json`
with the reason, reports the page as skipped rather than failed, and
the conventions say so. The CharPad CTM v8 and SpritePad SPD v5 headers
decoded from the sample files Oscar64 ships and checked against what
its embed forms produce (v9 read from Oscar64's structures only, not
measured here); Oscar64's reader checks neither signature nor version,
so an old v5 file embeds silently and wrongly. The two-bit fast-loader
transfer did not land: its writer stalled six times on the protocol
design and runs again alone from a fixed specification.

**Candidate list, Tier B batch 7 (data 749).** A cc65 cartridge recipe
built through the verifier's cartridge path: the linker configuration
writes the .CRT container itself from a header segment and the result
is byte-identical to cartconv's, DATA is copied from ROM to RAM at
start (55 bytes, checksums equal), the runtime from CINT to main costs
2,281 cycles, and the negative control with DATA left in ROM boots,
prints nothing and hits a BRK 1,049 cycles into the first print; a
Cartridge builds section on the cc65 page. The IEC bit timing measured
from the KERNAL's own port accesses under the monitor: the device-present
look 1,103 cycles after ATN, a send bit cell of 94 to 96 cycles stretched
to 136 to 139 by a badline, the listener's EOI acknowledge 539 cycles
after DATA is released, and the drive's replies as VICE's 1541 gives
them; the receive-side timer count is `$01FF` not `$0100` because the
KERNAL writes only timer B's high byte, and the page's older "about
1,024 cycles" is flagged. `drive_code_upload_and_job_queue` on the
file-io page with a recipe: 68 bytes uploaded in three M-W commands and
read back, executed by M-E, a seek job then a read job of track 18
sector 0 through the queue returning the BAM, a read before any seek
failing with result `$0B` and a read of track 40 with `$03`, drive-side
durations by the drive's own clock; a job queue and buffers table on the
IEC page. A Spindle toolchain page (3.1 built from source with xa65):
two parts packaged with mkpef and linked with pefchain, the join between
parts measured at 55 cycles and accounted for instruction by instruction,
part timings on both models, the D64 layout, and pefchain's page-clash
warning; the pictures live under docs/figures because the verifier cannot
boot a prepared disk. Left open: the device-not-present timeout as a
firing timeout (no run without a responding device could be made under
VICE); the write, verify, bump and execute job codes; where Spindle's
drive code lives on the disk.

**Candidate list, Tier B batch 6 (data 748).** `basic_extension_wedge`
on the text page with a KickAssembler recipe: an IGONE wedge that adds
prefixed commands and falls through to the ROM, exercised after a colon,
inside IF THEN and on an unknown letter (the ROM's error still appears),
costing 10.2 cycles a statement on PAL and 10.4 on NTSC against 10 by
the instruction table; the ROM's own paths through `$0308` and `$0300`
read from the BASIC image at the addresses the page quotes.
`lane_depth_engine` on the logic page with an Oscar64 recipe for the
beat-em-up archetype: Y as depth, an insertion sort over the actors
setting both draw order and hit order (157 to 269 cycles a frame), a hit
window in Y and X keyed to the attack's active frames; the whole step
1,413 cycles at its worst; the technique added to the archetype's
fingerprint. Sprite priority measured per pixel class in a recipe: a
multicolour sprite's own bit pair makes no difference to the priority
bit, the playfield's pattern decides (hires 1 bits and multicolour pairs
10 and 11 are foreground; 0 bits and pairs 00 and 01 background whatever
colour they draw in), `$D01F` follows the same classes and ignores the
priority bit, and sprite order is decided before the playfield; the
mob_priority entry extended in place, and the VIC-II reference's layer
diagram, which the measurement contradicts, is reported on the
hardware-verification issue rather than edited. A unit-testing toolchain
page with sim6502 as its tool node and a KickAssembler test-driver
recipe: fourteen cases through a case table with the verdict in `$02FF`,
the same driver run in sim6502 in 0.12 s of host time against 0.4 s in
VICE, 64spec assembling unchanged with KickAssembler 5.25, and sim65's
exit-code channel measured. Left open: the 418-cycle residue between the
wedge's measured and arithmetic cost; sprite priority with both
overlapping sprites set; multicolour bitmap and ECM pixel classes.

**Candidate list, Tier B batch 5 (data 747).** The GCR encoding on the
formats page, measured: the sixteen code words derived from a G64 image
c1541 wrote and confirmed byte for byte against the 1541 ROM's encode
table at `$F77F` (the F code is `10101`; the writer's own memory said
otherwise and the ROM corrected it), the header and data block layouts
decoded with their checksums, the sync and gap as written, the four zone
track lengths and their bit cells as arithmetic, the zone tables at
`$FED1` and `$FED7`; the "4 bytes to 5" sentence corrected with a
clause; c1541 3.10 writes `$A0 $A0` as the header ID while the BAM holds
the command-line ID, and the drive ROM loads the disk anyway. A cc1541
toolchain page (4.2 built from source): how the directory-art tricks are
stored in the entry bytes (a DEL entry is type `$80`, an art line has no
blocks, a name's first `$A0` closes the quote in the listing), what a
LIST shows of them, decoded against the character ROM, and interleave and
placement options measured on the sector chain. `two_word_parser` on the
text page with an Oscar64 recipe for the text-adventure archetype (ten
scripted commands through the KERNAL buffer, parse cost 569 to 2,036
cycles a command, the end state checked), and the technique added to the
archetype's fingerprint. The .VSF section rewritten from a snapshot the
emulator wrote: the previous text claimed a 15-byte module header and
module names the file does not contain; measured, the header is 22 bytes,
twenty-six modules in a stated order, the 64 KiB RAM at byte 209 in
address order, colour RAM at offset 761 of the VIC-II module, and two
runs of the same program differ in 946 bytes of RAM the program never
wrote. Left open: which ID character c1541 should have written; the
meaning of the snapshot's unlabelled bytes; LOAD of a DEL entry.

**Candidate list, Tier B batch 4 (data 746).** A cartconv toolchain page
with the .CRT header and chip packets decoded from files cartconv wrote,
and what each type does when booted in VICE: the generic 8K type ignores a
bank-register write, Magic Desk switches an 8K bank at `$8000` through
`$DE00`, Ocean switches the same bank mirrored at `$A000`, and cartconv's
EasyFlash made from a Magic Desk layout checks clean and does not boot;
byte `$1A` of the header is the hardware revision, not reserved; a
two-bank Magic Desk recipe pinned through the verifier's cartridge path;
KickAssembler has no cartridge directive and Oscar64's three cartridge
targets are decoded. REL files: the directory entry, the side-sector block
and the data chain decoded from a disk image the recipe wrote (a one-byte
write to record 125 of a 254-byte-record file allocates 125 data blocks and
two side sectors), the P command's byte order, the record padding, and the
DOS replies for a record that does not fit; the file-io technique's side-
sector rule corrected. `zx0_lzsa_decrunchers` on the memory-banking page
beside pucrunch: ZX0 v2.2, bitfire's ZX0 packer, Dali 0.3.5, ZX02 and
LZSA 1.4.1 built from source; on the two pucrunch inputs Dali's
self-extractor is 1,041 bytes and 114,369 cycles against Exomizer's 1,103
and 189,276, and bitfire's 1,035 and 99,422; Dali's small mode and
bitfire's stub overwrite the KERNAL's zero page and the subject does not
run or prints nothing, measured; the candidate list credited Dali to the
wrong author (it is Bitbreaker's). `bfs_distance_map` on the logic page
with a recipe: one flood serves four chasers, 404 open cells in 115,912
cycles over fifteen frames at 32 cells a frame, the map equal to a host
BFS byte for byte, every chaser reaching the player in 145 frames; an
Oscar64 -O2 fault met on the way (the first inlined call of a
pointer-walking copy loop) is reported on the gotcha issue. Left open:
raw-mode decrunch times for the ZX0 family; record lengths 0 and 255; the
EasyFlash registers on the tool page are the memory-banking page's, not
measured here.

**Tier A, the eight-way scroller (data 745).** `eight_way_scroll_double_buffer`
on the scroll page with a KickAssembler recipe, after three attempts and
three reviews. A 64 by 48 tile world through a 40 by 25 window along an
eight-leg camera path, two screen matrices flipped by `$D018` in the
blank, the redraw spread over fields in bands of at most seven rows, and
colour RAM, which cannot be paged, rewritten in four calls after the flip.
The first design redrew seventeen rows a field from raster 152 and
overran the field about one apply in four, which stalled the camera and
showed a whole field of stale colours; its verdict could not see it
because its checks compared raster numbers inside a field. The shipped
version caps every band, runs the camera at one pixel every two fields so
a crossing gap of six fields covers the five-field redraw, and its verdict
counts late applies, skipped preps and a first colour band finishing after
row 6's badline, all zero over a full loop on both models. Worst field
13,111 cycles on PAL and 13,152 on NTSC. Stated plainly on the page and in
the technique entry: after each tile crossing the rows not yet rewritten
show the previous position's colours for three displayed fields, about
one field in four over the path; the pin sits in the clean window. The
one-pixel-a-frame form is not shipped: on diagonals its crossing gap is
three fields against the five the redraw needs.

**Candidate list, Tier B batch 3 (data 745).** `light_pen_read` on
the input page with a KickAssembler recipe: the latch, the one trigger a
frame, the interrupt at 94 cycles through the KERNAL vector and the
two-pixel conversion checked on synthetic latch values; VICE 3.10's light
pen never triggers headlessly (no host mouse), and the fire-line route
through joystick autofire breaks the autostart before the program runs, so
the resting registers are measured and the moving pen is not, and the page
says so. A petcat toolchain page: tokenise and de-tokenise measured
against a hand count of tokens (a four-line stub is 64 bytes), the control
macros mapped to their PETSCII bytes, the round trip identical apart from
line-number padding, an unknown keyword accepted silently and failing on
the machine, upper-case keywords stored as text rather than tokens, and
the `-w2` against `-w3` difference on one keyword. `pucrunch_decruncher`
on the memory-banking page: pucrunch 1.14 built from source, its four
modes and Exomizer 3.1.3b0 measured on the same two inputs for size and
decrunch time (on a 4,519-byte mixed program pucrunch's default is 1,084
bytes and 349,505 cycles against Exomizer's 1,103 bytes and 189,276
cycles), the decruncher's footprint at `$F7` and `$0200`, and the
candidate list's claim that pucrunch decrunches faster not borne out on
either input. `text_window_and_menu` on the text page with an Oscar64
recipe: save-under of screen and colour RAM, a PETSCII frame matched glyph
by glyph against the character ROM, a five-item menu moved by joystick and
by the cursor keys through the KERNAL buffer, the restore exact byte for
byte; open 14,923 cycles and close 5,759 on PAL. Left open: what VICE
latches when its pen does trigger; the raw pucrunch decruncher was not
assembled; the anchor for the window technique on the text-mode-render
pitfall page waits for the eight-way scroll to release that page.

**Issue #22, step 3: the honest budget (schema 27, tools 2.0.0, package
0.13.0).** Tools 2.0.0 is a major bump because the briefing's output
changes in a way a client can break on: `cycles_verdict` gains
`undetermined`, and it no longer says `under` when a figure is missing.
VERSION's rule makes a breaking output change a major. The package is
still 0.x, where a minor is the breaking step, so it goes to 0.13.0 as
every tools minor before it moved the package minor; 1.0.0 is a
maintainer's call, not a side effect.

New tool `c64_plan_budget` (CLI `plan-budget`) adds a list of techniques
up against a frame, each in a phase (`name`, `name:transition`,
`name:init`), on PAL, NTSC or both. The rules are in `src/domain/budget.ts`
and came from design 2.1, where summing Cost lines erred from −96 % to
about 10× over on built recipes:

- A missing figure is never zero. A member with no cycles figure is
  listed as unknown, with the recipe to measure it on, and the verdict is
  `undetermined`.
- A figure above one frame (19,656 PAL, 17,095 NTSC) is a multi-frame
  operation and is not summed. It holds nothing in the frame, so a member
  it includes is budgeted as itself.
- A new Cost key, `cycles_per_frame_typical`, gives a range: the low end
  sums typical frames, the high end worst frames. The low end is not a
  floor. The key may hold a common frame or a real run's worst frame
  (`ghost_target_tile_ai`'s 4,171 and `game_tree_search`'s 5,325 are the
  second kind), and two members' such frames need not coincide. So `over`
  is judged on the floor alone: band and per-line charges, which run
  every frame, plus the badline loss no summed figure can already hold.
  This departs from the design, which said `over` whenever low plus
  losses passed the frame; on NTSC that called `sprite_multiplex_game`'s
  built 16,600-cycle reversal frame over, while the recipe runs on NTSC
  with every actor drawn.
- New `**Cost includes:**` line: a member whose work is inside another's
  figure is counted once. Includes are followed through the graph, and of
  two pages that include each other the first listed is kept. A technique
  with `cycles_per_line=63` and a line band is charged band lines × line
  length, and its REQUIRES closure is not added again.
- New `**Cost measured on:**` line names the recipe and its conditions.
  With the screen on, the badlines (lines 51-243, every eighth, 43 cycles
  each) outside any band charge are charged unless every summed figure is
  a band charge or says it was measured with the screen on. A stall takes
  its cycles wherever the code runs, so the charge is exact when no
  summed figure already holds stalls, and too high by what a screen-on
  figure holds. Bytes flagged `whole PRG` are not summed, and a member
  inside another's figure that states bytes is not summed either.
- A name listed twice in one phase is counted once and the repeat is
  listed in `refused`. A region other than pal, ntsc or both is refused.
  PAL-locked and NTSC-locked members in one set are named.

Review corrections before release, each found by running the tool on the
shipped pages: the badline charge was 1,075 even when `fli_image`'s band
45-251 already held all 25 badlines, and was called "a ceiling: code that
runs in the border meets no badline", which is wrong (a stall takes its
cycles wherever the code runs). With `ghost_target_tile_ai`,
`wave_director` and `sprite_animation_table` beside it, that made a low
end of 18,739 into 19,814 and called the set over. `soft_scroll_h`, left
out as multi-frame, still hid `char_scroll_buffer_h`'s missing figure.

The briefing budget now calls the same planner, every proposed technique
in one play frame. Its `cycles_verdict` gains `undetermined` and it gains
`cycles_low`, `fixed_loss_cycles`, `excluded`, `unknown` and
`to_measure`. `c64_timing_budget` is unchanged. It answers a different
question, the cycles left on one raster line, and its README row no
longer claims per-frame math. Ingest now warns about, and counts, a
measured-on recipe that is no Recipe and an included name that is no
Technique.

Content: 68 Cost lines gained a measured-on line, five of them on the #21
pages merged from main. Five pages do not say where their figure came
from, so they got none. Eight gained a measured
typical frame, each one the page already stated: `wave_director`,
`dig_and_refill`, `difficulty_ramp_tables`, `ghost_target_tile_ai`,
`sprite_animation_table`, `sfx_engine_beside_music`, `sprite_cache_flip`
and `game_tree_search` (its worst measured four-node slice, 5,325, beside
the 9,316 bound). Three gained an includes line: `wave_director`
includes `object_pool`, `soft_scroll_h` includes `char_scroll_buffer_h`,
and `fli_image` includes its stable double-IRQ entry.

Four corrections:

- `fli_image` charged 200 lines (12,600). Its band, 45-251, is 207 lines,
  so the figure is 13,041.
- `fli_image` said `bytes_code=3277` and `bytes_data=16384`: 3.2 KB and
  16 KB times 1,024. KickAssembler's `-showmem` for the recipe gives
  3,488 and 16,001, and the basis is now `arithmetic`, not `estimated`.
- `decimal_print` said `bytes_code=0`, a figure the page never measured,
  and a budget summed it as zero bytes. The key is gone.
- `platformer-scaffold` plays a three-voice stub tune every frame but did
  not list `sid_play_routine_pattern`; it does now, and the page says so.

Validation on PAL. "Old sum" is the previous briefing arithmetic over the same pages: every `cycles_per_frame` added, with a missing figure counted as zero.

| Composition | Old sum | New | Measured |
|---|---|---|---|
| platformer-scaffold | 4,953, "under" | [4,731, 4,939] + 1,075, undetermined, 5 unknowns | 4,966 one frame; peak 8,693 |
| simple-shmup | 5,628, "under" | 5,628 + 1,075, undetermined, `soft_scroll_v` unknown | not measured whole |
| cracktro-template | 75,358, "over" | 1,317 + 1,075, undetermined, `soft_scroll_h` multi-frame, `char_scroll_buffer_h` unknown | fits (about 7,000 in the blank) |
| fli-image | 12,884, "under" | 13,041, fits | 13,041 by arithmetic |
| scroll-panel-split | 413, "under" | 413, undetermined, 2 unknowns | carry frame 11,613 by arithmetic |
| sprite-multiplex-game | 16,600, "under" | 16,600 + 1,075, fits (NTSC undetermined) | parts measured in play: about 7,100-8,000 |
| wave-director | 3,568, "under" | [1,170, 3,188] + 1,075, fits | 3,188 worst, screen blanked |
| falling-blocks | 5,902, "under" | 5,902 + 1,075, undetermined, 2 unknowns | 6,276 dearest frame of the run |

`test/plan-budget.test.ts` rebuilds every row from the shipped pages.

Data 742, schema 26, tools 1.31.0, package 0.11.0.
**Candidate list, Tier B batch 2 (data 743).** Four measured items.
`irq_keyboard_own_scan` on the input page with a KickAssembler recipe: an
eight-column matrix scan in the game's interrupt with per-key age
counters, 252 cycles for the scan and 781 for scan, edge pass and ageing
with the matrix empty; the KERNAL's exit points read from the ROM (the
candidate list's phrasing of `$EA7B` was inverted and the page states the
measured one); port 2's fire line does not leak into the matrix image and
port 1's reads as row 4 closed in every column, both measured; no key was
pressed, since VICE's keyboard feed writes the KERNAL buffer, and the page
says so. `directory_read_and_select` on the file-io page with an Oscar64
recipe that writes three files, streams the "$" channel, parses the
listing and lets a selector pick one: 160 bytes with status `$40`, the
transfer 515,635 cycles on PAL and the parse 13,821; the disk name prints
as graphics glyphs because c1541 stores it as shifted PETSCII, explained
on the page. `hires_plot` and `bresenham_line` on the bitmap page with a
recipe: 63 cycles a plot, 136 a further line pixel, a 320-pixel line
43,606 cycles with the display off and about 47,000 with it on, the
badline stalls counted by the CIA; the eleven lines set 2,056 pixels,
matching a host Bresenham and the sum of the endpoints' spans.
`seeded_level_fill` on the logic page with a recipe: a 40 by 22 field from
a 16-bit seed against three thresholds and a five-object list, regenerated
byte for byte, a second seed giving a different checksum, 97,643 cycles a
generation; a flood-fill solvability check is described and not built, and
none of the three levels is claimed solvable. Left open: the steep-loop
line cost is from the instruction table; the standing disagreement between
the high-score-persist and file-io pages about a bare OPEN 15 with no
drive, which the lint still records.

**Issue #21, the last items.** `mixed_sprite_char_actors` (a sprite
fighter and a character fighter, priority per frame), a reference page on
which game and engine sources may be adapted and which are facts only
(`game-design/reference-game-sources.md`; the Oscar64 GPL question is
#31), and tool pages for `sidreloc` and `png2prg`, both run here.
Corrected, each with a clause: `vic-ii-reference.md` defined sprite
priority and `$D01F` background by colour register (multicolour pairs 00
and 01 are background; Bauer 3.8.2 and measured); `asset-pipelines.md`
had the Koala bit pairs swapped; `bitmap-koala-viewer.md` gave an
`#embed` form that does not compile and offsets two bytes late.

**Issue #21, GR-05/10, GR-06, GR-07, GR-11.** Engines for games at the
scale of Elite and Lemmings, each self-checked against a Python model:
`wireframe_pipeline` and `procedural_seed_universe` (pixel-exact
wireframes; Elite's galaxy names reproduced), `adventure_database_engine`,
`game_tree_search` (with a time-sliced form that misses no frame), and
`destructible_char_terrain` with `creature_state_machine`. Two more
Oscar64 faults recorded with their upstream status (#30).

Data 740, schema 26, tools 1.31.0, package 0.11.0 (step 2, below).

**Issue #22, step 2: the zero page each KERNAL routine writes (schema 26,
tools 1.31.0, package 0.11.0).** A `CLOBBERS_ZP` edge from each
KernalRoutine to the `zero_page` unit, from new `**Clobbers zero page:**`
lines on `hardware/kernal-routines-reference.md`. A `may` line per
jump-table routine is a static walk of the 901227-03 ROM through the
power-on vectors (`scripts/kernal-zp-walk.ts`; `npm test` fails when the
page and the walk disagree). `must` lines, 18 calls of 17 routines, are
what a VICE x64sc store trace saw with every interrupt masked
(`scripts/kernal-zp-trace.ts`); every traced byte lies inside its may
set. `c64_check_compatibility` has a new soft kind, `kernal_clobbers_zp`:
a technique's KERNAL calls may write bytes a technique claims. It also
runs inside one input's own chain, the technique against itself and its
own prerequisites.

The design's sets were too small. It put CHROUT, OPEN and the other large
routines at 49-55 bytes; the walk gives 88-94. A tape routine installs
one of four IRQ handlers at `$0314` (table at `$FD9B`) that runs inside
the call, and those handlers write `$92`, `$96`, `$A7`, `$B1` and `$BF`.
SCNKEY dispatches through `$028F`, a vector RESTOR does not set; the walk
follows it to `$EB48`, the value CINT stores, which adds `$F5-$F6`. The
IRQ entry's BRK branch (`JMP ($0316)` at `$FF55`) is not followed: the
tape code's fake IRQ through `$FF43` never takes it, and following it ran
the warm start and counted all of zero page. The traced CHROUT, scrolling
the screen, wrote `$D9-$F4`, the line-link table, so Krill's default
zero page `$E0-$EF` is inside what printing writes.

`krill_loader_integration`'s `**Uses kernal:**` said LOAD, CHKIN, CHKOUT.
The v194 source calls no LOAD; the line now lists the fifteen routines
`install` calls and the fallback's TKSA. Every check naming Krill now
carries a soft `kernal_clobbers_zp` of Krill against itself (a lead to
trace, on #22). The `serial_bus_busy` rule listed CIOUT and ACPTR, names
no KernalRoutine node has; it now uses IECOUT and IECIN. The trace ran
only on the windowed x64sc; it now runs on the windowless build too.

**Issue #21, GR-01 to GR-04.** Four small complete games, each a
technique plus a self-playing recipe checked against a Python model of
the same rules: `falling_block_rules` (NES tables per region, scoring at
the level after the clear), `ghost_target_tile_ai` (the Pac-Man Dossier's
target tiles), `cave_scan_engine` (the scanned flag that stops the double
move) and `dig_and_refill` (Lode Runner's holes and guards; four guards
overrun a frame). A third Oscar64 1.32.271 miscompile, reproduced: at -O2
a loop-invariant `array + signed char` is zero-extended (#30).


**Issue #22, steps 0 and 1: hardware claims (schema 25, tools 1.30.0, package 0.10.0).**
`HardwareUnit` nodes (SID voices, sprites, CIA timers, TOD and ports, the
VIC bank, the serial bus, the raster IRQ, the four vectors, the expansion
pages, zero page) and `CLAIMS` edges from a technique's new `**Claims:**`
line, in four modes: owns, shares, reads, init. `c64_check_compatibility`
now names the unit two techniques contend for (`unit_contention`,
`zero_page_overlap`, `unit_shared`, `unit_read_while_driven`,
`init_order`, the last at a new `info` severity that leaves the verdict
alone). Before, two raster-IRQ owners or two players on the same voices
drew at most a soft shared-register warning. A technique with no Claims line reads as unknown,
never as claiming nothing, and the text says a unit conflict with it
cannot be ruled out. A `prerequisite_conflict` now carries the rule that
fired in `underlying_kind`; it was reported as hard whatever the rule.
Recipe-chosen zero page and vectors are not checked yet (step 8).

A first cut made every raster technique own the raster IRQ, and set
techniques that the KB's own VICE-verified recipes run together against
each other as hard conflicts (fli-image, sideborder-open, fld,
stable-raster-irq, the Oscar64 raster-bars). `stable_raster_irq` and
`double_irq` are ways into a handler, so they now `share` the raster
compare and the effect run from the handler owns it. A technique is not
set against a prerequisite it runs inside its own handler. A test now
checks every recipe's technique set and fails naming any recipe with a
hard unit conflict. The Kick `sprite-multiplex-24` recipe also named
`sprite_multiplex_8`, a second multiplexer it does not contain. `fli_image`
claims the VIC bank and requires `vic_bank_select`: its layout needs bank
1 or 3, because banks 0 and 2 show character ROM where four of the eight
screens go. A resident Krill loader beside a VIC bank owner now says not
to write `$DD00` raw while the loader is armed; it said Krill should
follow the bank owner. `irq_chain_table` against a raster effect names
the table as the host. `sid_play_routine_pattern`'s claims rest on the
player contract, not a listing: basis `estimated`.

Step 0: `sprite_multiplex_8`'s Cost held the recipe's demo payload
(9,162); the three multiplexer calls measure at most 5,301. `simple-shmup`
named `soft_scroll_h` and `sprite_collision_detect`, which it does not
implement.
**Candidate list, Tier B batch 1 (data 737).** Four measured items.
`high_score_table_insert` on the text page with a KickAssembler recipe:
a BCD compare from the most significant byte, a bounded shift and the
tie rule, four inserts checked against an expected table byte for byte,
the worst insert 481 cycles by CIA timer and by the instruction count;
it realises the "table re-sorted" check on the front-end pattern, which
the complete-game build of the night before skipped. The CIA revision:
VICE 3.10 models the one-cycle difference between the old 6526 and the
6526A or 8521, measured as an alternating latency pair of `$12`/`$11`
under `-ciamodel 0` and `$10`/`$11` under model 1, the default behaving
as the new part; new pitfall `cia_revision_irq_one_cycle_late` with a
detection recipe pinned under the old model on both regions. The
time-of-day alarm: `tod_alarm_interrupt` with a recipe that sets the
clock, arms an alarm three seconds ahead and reads the time in the
handler; it fired after 149 PAL and 179 NTSC frames against 150 and 180
expected, the one-frame shortfall being the mains tick's phase, and with
the 50/60 Hz bit the wrong way the same alarm took 180 PAL frames and 149
NTSC, the drift the page quotes. `isqrt_16bit` and `atan2_8bit` on the
maths page: the root exact on 35 cases and within bounds on all 65,536
inputs (869 cycles worst), the angle within one unit of 256 on 36 cases
on the machine and on all 65,536 pairs in the host model (381 cycles
worst). The VICE reference now says that the exit screenshot is the
draw buffer at the cycle the limit hits, rows above the beam new and
rows below from the previous field, measured on the eight-way scroll
recipe while its pin was chosen. Left open: the PAL alarm's arrival
varying by about fifty cycles between identical runs; the machine sweep
of every atan2 pair; every CIA figure is VICE's, none from silicon.

**Issue #21, ES-19 to ES-22.** `reu_dma` (one cycle a byte blanked;
badlines and sprites slow it with the screen on), `four_player_read`
(the user-port adapter; directions under the select are from the sources,
since VICE cannot drive them headless), `cartridge_save` (EasyFlash flash
writes need Ultimax mode; a save survives across two runs) and
`raster_profile_bars` (border bars and a CIA table agree within a line),
each with a recipe pinned on PAL and NTSC. `verify:recipes` now runs
cartridge recipes: a `cartridge` key in runs.json boots the `.crt` the
listing writes, once or several times on the same copy. A new Oscar64
gotcha: `#define A()` with an empty parameter list is refused.
**Design layer, slice 4 (data 735).** Four Oscar64 recipes that realise
the pattern pages, each with a technique entry, a pinned verdict on both
models and its name on the pattern's Realised-by line.
`attract_mode_input_replay` (`oscar64/attract-replay`): the demo is the
game fed from a recorded input stream through the same input byte, with
the random generator reseeded; the reseeded build ends its 285-frame
replay at the recorded position and the unseeded build 210 pixels away,
both agreeing with a host model; the replay step costs 68 cycles a frame.
`difficulty_ramp_tables` (`oscar64/difficulty-tables`): a six-row level
table read at level start with a region scaler from the detection
routine; compensated, level 3 arrives at 22,500 ms on PAL and 22,586 ms
on NTSC; uncompensated, at the same frame count on both and 18,839 ms on
NTSC, the 50:60 ratio. `two_player_state_swap` (`oscar64/two-player`):
alternating play swaps an 8-byte block per player on death (206 cycles),
simultaneous play reads both ports each frame; with `$DC00` set to `$FF`
before the port-1 read, none of 40 reads was column-selected, without it
all 40 were; the phantom press itself is not measured because VICE's
keyboard feed writes the KERNAL buffer, not the matrix.
`flip_screen_rooms` (`oscar64/flip-screen-rooms`): room records with edge
exits and RLE tiles, five rooms, a scripted walk through all of them;
the worst full-room redraw is 42,141 cycles, about two PAL frames, so the
screen is blanked for two frames on PAL and three on NTSC rather than
drawn in one vertical blank, and the pattern page's sentence saying
otherwise is corrected. A defect met on the way and worth a pitfall: a
colour-RAM index past 1,000 lands in the CIA1 register mirror at `$DC00`.

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
