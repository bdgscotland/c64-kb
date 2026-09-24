# MEASURED: a five-part single-file C64 demo built from c64-kb

Everything on screen is a technique the knowledge base holds with a pinned recipe behind it. Every part is a module with the same six-stage lifecycle the KB's `part_lifecycle` pattern describes (docs/demo-design/demo-composition.md), the music is called once per frame from one raster interrupt the sequencer owns, parts end on the tune's position (`transition_conditions`, address equals value), no effect dwells past twenty seconds (`pacing_and_length`), and the whole thing runs headless under the harness with a verdict, a frame meter and pinned screenshots on PAL and NTSC.

## The parts, in order

| # | Name | Screen | Techniques (KB names) | Recipe it starts from | Dwell |
|---|---|---|---|---|---|
| 1 | LOGO | text, bank 0 | tech_tech_wobbler, sprite_border_scroller, topbottom_border_open, stable_raster_irq | kickassembler-tech-tech, kickassembler-sprite-border-scroller | 18 s |
| 2 | TWIST | hires bitmap, bank 1 | twister, vector_balls_sprites | kickassembler-twister, kickassembler-vector-balls | 18 s |
| 3 | BORDER | text, bank 0 | dysp_side_border_sprites, soft_scroll_h | kickassembler-dysp, oscar64-soft-scroll-h (ported) | 18 s |
| 4 | FIRE | text, bank 0 | fire_effect, screen_dissolve_lfsr (as the transition in) | kickassembler-fire-effect, kickassembler-screen-dissolve | 16 s |
| 5 | SPRITES | sprites only, bank 0 | sprites_only_screen_mode, vector_balls_sprites | kickassembler-sprites-only-screen, kickassembler-vector-balls | 16 s |
| 6 | END | text, bank 0 | (sequencer's own end screen: credits, the five parts' measured figures, the harness meter, the verdict) | hello-kick | until the limit |

Transitions: colour_fade (luminance fade of $D020/$D021 and the colour RAM of the part on screen) out of parts 1, 2, 3 and 5; screen_dissolve_lfsr into part 4 from a black text screen. Music runs through every join.

## Music

The KB's own three-voice player from `docs/recipes/kickassembler/sfx-in-player.md` (original code, BSD-3), extended by the music module: an order list per voice, a shared `music_pos` byte (the order index of voice 1) that the sequencer reads, frames-per-row tempo, and an original tune of about two and a half minutes written as pattern data. Entry points: `music_init` (A = 0), `music_play` (once per frame, first thing in the sequencer's line-255 interrupt), `music_pos` (read-only for parts). It owns `$D400`-`$D418` through a 25-byte shadow copied once per frame, as the recipe does. No effects are requested in the demo; the effect entry stays in the player for a later release.

## The contract every part keeps (from `part_lifecycle`)

A part is a KickAssembler file `src/parts/pN_<name>.asm` that defines a namespace `pN` with these labels. The sequencer calls them in this order.

| Label | Interrupts | Job |
|---|---|---|
| `pN.prepare` | enabled | Build tables and copy data into the part's own RAM. No VIC or SID writes. May take many frames. The sequencer calls it once, AFTER the previous part's cleanup, inside a black gap it makes itself (display off, border black, sprites off, only the line-255 interrupt armed, so the music plays on); when prepare returns it waits for raster line 250 and calls setup. From the prepare call the part owns zero page $10 to $7F and the bank data areas. Until 2026-09-23 this row read "before the previous part fades; it must not touch the screen the previous part is showing", and that held only while parts 1 and 3 were dummies: against the real modules, p2.prepare writes $12, $13 and $16 while p1 keeps its cycle sum and table index there; p3.prepare writes $10 to $1F while p2 keeps its pointers and PAL/NTSC flag there; p4.prepare clears $2000 to $23FF while p3 reads its sine, $D011 and mask tables from $2000 to $22FF. Only p5.prepare was disjoint from its predecessor. The gap rule is uniform so that no per-part disjointness proof has to be kept true (I-008). A prepare that polls RST8 to tell PAL from NTSC must mask interrupts around the poll, as p2's does: with the line-255 interrupt running, NTSC's seven RST8 lines (455 cycles) pass entirely inside the handler and the poll never sees them. |
| `pN.setup` | disabled by the sequencer | Write $D011, $D016, $D018, $DD02/$DD00, $D015, $D01B, $D01C, $D01D, $D020, $D021, colour RAM and screen RAM for the part's first frame. Fill `pN.irq_lines` and `pN.irq_handlers` (see below). Fast. |
| `pN.irq_lines`, `pN.irq_handlers` | tables | Up to 6 raster lines (byte, plus a high-bit table `pN.irq_hi`) and handler addresses the sequencer's dispatcher runs at those lines. A handler enters with A, X, Y already saved and $D019 acknowledged; it returns with `rts`. A part that needs the double-IRQ stable entry does it inside its own handler, as the recipes do. Line 255 is the sequencer's: no part may use lines 254 to 258. |
| `pN.main` | enabled | Called once per frame from the main loop after the frame flag. Frame-buffer work that may run long (fire). May be a bare `rts`. |
| `pN.fadeout` | enabled | Called once per frame after `pN.main` once the sequencer has started the fade. Returns A = 0 while fading, A = 1 when done. The shared `fade_step` routine (colour_fade) is available: it fades $D020, $D021 and the 1,000 colour RAM cells one luminance step per call and returns done. |
| `pN.cleanup` | enabled | Stop nothing by hand: the sequencer removes the part's IRQ lines first, then calls this. Restore what the part changed that the contract does not cover (the CIA timers it used, $01, $3FFF). Wait for raster line 250 before returning. |
| `pN.selfcheck` | enabled | Called once by the sequencer at the end of the part's dwell, before the fade: returns A = 1 if the part's own measurement passed, as its recipe's verdict byte would, else A = 0. Real state read back: a register, a table entry, a screen cell. |
| `pN.worst`, `pN.typical` | words | Filled by the part: its own CIA1 timer A bracket of its per-frame work (interrupt work summed with the main-loop work), worst frame and median or last frame, as the recipes measure. Printed on the end screen. |

Register ownership while a part runs: the part owns every VIC register except that it must not touch $D012/$D011 bit 7 outside its own handlers (the dispatcher sets the next line) and must leave the interrupt at line 255 reachable (no cycle-locked loop may cover lines 254 to 258). CIA1 timer A is the part's stopwatch; CIA2 timer A is the harness meter's (never touch $DD04-$DD0F); CIA1 interrupts stay masked ($DC0D = $7F) for the whole demo; the KERNAL stays banked in ($01 = $37) and the interrupt vector is $0314 (the sequencer's dispatcher).

Zero page: the sequencer owns $02 to $0F. A part may use $10 to $7F while it runs and must assume nothing survives from the previous part. The music player owns $FB to $FE.

## Memory

| Range | Owner |
|---|---|
| $0801-$080C | BASIC stub |
| $0810-$0FFF | sequencer, dispatcher, fade, dissolve, shared sine table, end screen text |
| $1000-$1CFF | music player and tune ($1000-$1798 today) |
| $1D00-$1FFF | part 5's projection tables px, py, zd (`P5_TABLES` in api.inc): read-only, loaded with the PRG, written by no part. The last 768-byte page-aligned hole in RAM that the CPU sees with $01 = $37; the assembler's overlap check guards it if the tune grows (I-008) |
| $2000-$3FFF | bank 0 data the current part builds in `prepare`: sprites, charsets ($3800 the logo font for part 1; $3000 the sprite slots), matrices for the tech-tech ($0800-$27FF, eight screens), the fire's heat buffer at $2000 (part 4), the vector-ball shapes at $3F00 (parts 2 and 5). $3FFF is 0 (idle byte). |
| $4000-$7FFF | bank 1: part 2's bitmap at $6000 and its screen at $5C00; the twister's phase images at $4400. The AUTOPILOT build's frame meter (code and variables, 953 bytes today) sits at $4800: $4800-$5BFF is written by no part and is CPU RAM under every value of $01, so the meter is never banked out (I-011) |
| $8000-$BFFF | part code, one contiguous block per part in order: p1 $8000, p2 $8C00, p3 $9800, p4 $A400, p5 $B000; each part gets $0C00 for code and small tables; BASIC ROM is out ($01 = $36) only while a part copies over $A000-$BFFF? No: parts run with $01 = $37 and their code lives below $A000 if it is executed with BASIC in. RULE: code at $A000-$BFFF is read as ROM while $01 = $37, so parts 4 and 5 are placed at $C000 and $CC00 instead (RAM at $C000-$CFFF is always visible). The same rule covers $D000-$DFFF, which is I/O while $01 = $37: nothing a part reads may be assembled there either. The assembler places a block there without complaint and the load pours it into the VIC's registers; p5's tables sat at $D100-$D3FF from I-004 until I-008 and every lookup read a VIC register mirror. |
| $C000-$CFFF | p4 $C000-$CB72, p5 code $CC00-$CF7D. p5's tables are at $1D00 (above) because $CC00 + $0500 is $D100 (I-008) |
| $D000-$DFFF | I/O |
| $E000-$FFFF | KERNAL ROM (RAM beneath unused) |

The autopilot build adds the harness meter's code and its 20-cell readout on row 24 of the end screen; the meter records the first 200 frames of part 5 (its `hold`), the part whose cost is the demo's steady state with the most sprites.

## Timing and sync

PAL 50 Hz, NTSC 60 Hz; the player is called every frame, so the tune runs 1.2 times faster on NTSC (the region-timing pitfall; accepted for the demo and stated). The sequencer's part table holds, per part, the `music_pos` value at which its fade starts; the tune is written so those positions fall at the dwell times above. The end screen holds until the cycle limit.

## Autopilot, verdict, meter, checks

There is no input. The AUTOPILOT build differs from the release only by the harness meter and the grading: at the end screen the sequencer ANDs the five `selfcheck` results, prints `PARTS 5/5 PASS` (or the count), each part's worst and typical cycles from its own bracket, the meter's readout on row 24, and stores $02FF = $01 with a green border, or $02 and red. FORCE_FAULT poisons part 2's depth table so its selfcheck fails and one ball is drawn behind another it should cover, which moves pixels a `sprite` check sees.

Pins: the end screen on both models (static) is the harness pin (`SHOT_CYCLES_*`). Each part has its own pin too, taken by the verify script at a cycle count inside its dwell, graded by `check.py` against `expect-pN.json` (a `rect` or `sprite` or `text` check per feature, a `same` area where the two models agree). The recipes' measured facts are what those checks assert.
