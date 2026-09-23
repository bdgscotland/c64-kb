# Changelog

Versions are in `VERSION` (data, schema, tool surface) and `package.json`.
Entries below start at the first public audit; earlier history is in git.

## Unreleased

Data 758, schema 29, tools 2.1.0, package 0.14.0.

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
