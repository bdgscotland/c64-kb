---
recipe: invalid-mode-band
toolchain: kickassembler
output_format: PRG
region: both
techniques: [invalid_mode_band, ram_under_kernal]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D016, D018, D019, D01A, D01B, D01C, D020, D021, D027, DC0D, DD0D]
uses_kernal: []
claims: [cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init), sprite_0 (owns)]
ram: [screen=$0400-$07FF, idle=$3FFF, colour=$D800-$DBFF, sprite=$0340-$037E]
---

<!-- doc-type: recipe -->

# KickAssembler — A black invalid-mode band between a scrolled playfield and a panel

## Synopsis

A playfield at any YSCROLL sits above a three-row text panel. Between them,
lines 214-222 are black: the split sets ECM and BMM together (`$D011` bits 6
and 5), an invalid mode in which the VIC draws the display window black. Inside
the band the program changes the charset, the background colour and YSCROLL,
so the panel always starts on line 223. A yellow sprite crosses the band and
stays visible, because the invalid mode blanks only the character pixels. This
is the `invalid_mode_band` technique. `:ys=0` to `:ys=7` set the playfield's
YSCROLL; `:band=0` leaves ECM and BMM off, so you can see what the band hides.
The KERNAL is banked out and both interrupts go through `$FFFE`
(`ram_under_kernal`).

## Source

```asm
// invalid-mode-band.asm: a playfield at a fixed YSCROLL over a three-row text
// panel, with a black band between them made by setting ECM and BMM together
// ($D011 bits 6 and 5), an invalid mode that draws the display window black.
// Inside the band the program switches the charset, the background colour and
// YSCROLL, so the panel starts on line 223 whatever the playfield's YSCROLL.
// A yellow sprite spans the playfield, the band and the panel: the band does
// not hide it.
// Build: java -jar KickAss.jar invalid-mode-band.asm -o invalid-mode-band.prg
// Variants: add :ys=0 to :ys=7 for the playfield YSCROLL (default 3), and
// :band=0 to leave ECM+BMM off and see what the band hides. :irq=214 enters
// the split after line 213, as a late chained entry would.

BasicUpstart2(start)

.function cv(n, d) { .return cmdLineVars.containsKey(n) ? cmdLineVars.get(n).asNumber() : d }
.var YS   = cmdLineVars.containsKey("ys") ? cmdLineVars.get("ys").asNumber() : 3
.var BAND = cmdLineVars.containsKey("band") ? cmdLineVars.get("band").asNumber() : 1

.const SCREEN     = $0400
.const COLRAM     = $d800
.const SPRDATA    = $0340      // sprite block 13
.const PF_ROWS    = 21         // rows 0-20 are playfield; row 20 ends under the band
.const PANEL_ROW  = 21         // first panel row: its badline is line 223
.const SPLIT_IRQ  = cv("irq", 211) // the split handler is entered here and polls for 213
.const BOTTOM_IRQ = 250        // below the 24-row window (bottom border from 247)
.const PF_D011    = $10 | YS   // DEN, RSEL=0 (24 rows), text, playfield YSCROLL
.const BAND_ON    = BAND != 0 ? $60 : $00   // ECM + BMM
.const PANEL_D011 = $17        // DEN, RSEL=0, text, YSCROLL 7: badline on 223
.const PF_D018    = $15        // screen $0400, upper-case ROM charset
.const PANEL_D018 = $17        // screen $0400, lower-case ROM charset
.const PF_BG      = 6          // blue
.const PANEL_BG   = 11         // dark grey
.const BORDER     = 12         // mid grey, so black in the window is the band
.const SPR_Y      = 206        // shown on lines 207-227: playfield, band, panel
.const SPR_X      = 200
// Delay counts: dex/bpl runs count+1 passes, 5 cycles a pass and 4 on the
// way out. Set in VICE so that each store lands inside its window (the page
// lists the windows).
.var D213  = cv("d213", 9)
.var D213B = cv("d213b", 1)
.var D215  = cv("d215", 3)
.var D222  = cv("d222", 9)

* = $0810
start:
        sei
        lda #$35                // KERNAL out, I/O in: IRQs through $FFFE
        sta $01
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda #BORDER
        sta $d020
        lda #PF_BG
        sta $d021
        lda #0
        sta $3fff               // idle-state byte

        ldx #0                  // playfield: solid rows (reverse space) on even
fill:                           // rows, blank rows on odd rows; light blue
        lda #14
        sta COLRAM,x
        sta COLRAM+$100,x
        sta COLRAM+$200,x
        sta COLRAM+$300,x
        lda #$20
        sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$2e8,x
        inx
        bne fill
.for (var r = 0; r < PF_ROWS; r += 2) {
        ldx #39
!:      lda #$a0
        sta SCREEN+r*40,x
        dex
        bpl !-
}
        ldx #119                // panel rows 21-23: white text
panel:
        lda panel_text,x
        sta SCREEN+PANEL_ROW*40,x
        lda #1
        sta COLRAM+PANEL_ROW*40,x
        dex
        bpl panel

        ldx #62                 // sprite 0: a solid 24 x 21 block
        lda #$ff
spr:    sta SPRDATA,x
        dex
        bpl spr
        lda #SPRDATA/64
        sta SCREEN+$3f8
        lda #SPR_X
        sta $d000
        lda #SPR_Y
        sta $d001
        lda #0
        sta $d010
        sta $d01b               // in front of the characters
        sta $d01c
        lda #7
        sta $d027               // yellow
        lda #1
        sta $d015

        lda #PF_D018
        sta $d018
        lda #$c8                // 40 columns, XSCROLL 0, no multicolour
        sta $d016
        lda #PF_D011
        sta $d011               // bit 7 clear: raster compare below 256
        lda #<split_irq
        sta $fffe
        lda #>split_irq
        sta $ffff
        lda #SPLIT_IRQ
        sta $d012
        lda #1
        sta $d01a
        sta $d019
        cli
        jmp *

// The split. Each $D011 store has a window of at least 15 cycles (PAL) in
// which it shows nothing: the right border of the line before, or the band.
// A plain $D012 poll (one read every 7 cycles) lands well inside each one.
// Each poll waits while $D012 is below its line, not until it equals it:
// the same 7 cycles a pass and the same exit cycle, but a handler entered
// after the line (chained behind a multiplexer's late zone, or :irq=214)
// falls through instead of spinning to the line in the next frame.
split_irq:
        pha
        txa
        pha
        tya
        pha
        ldx yscroll
        lda yscroll
        ora #$10 | BAND_ON      // same YSCROLL, ECM+BMM: no badline moves
        tay
        lda delay213,x
        tax
        lda #212
w213:   cmp $d012
        bcs w213                // wait while $D012 <= 212
d213:   dex                     // 5 cycles a pass, 4 on the way out
        bpl d213
        sty $d011               // right border of line 213: the band starts on 214
        lda #PANEL_D018
        sta $d018               // lower-case charset for the panel: in the band
        lda #PANEL_BG
        sta $d021               // panel background: in the band
        ldy #PANEL_D011 | BAND_ON
        lda #214
w215:   cmp $d012
        bcs w215                // wait while $D012 <= 214
        ldx #D215
d215:   dex
        bpl d215
        sty $d011               // YSCROLL 7 lands on line 215, before line 216's
                                // badline check: no line from 216 to 222 matches,
                                // and the next badline is 223
        ldy #PANEL_D011
        lda #221
w222:   cmp $d012
        bcs w222                // wait while $D012 <= 221
        ldx #D222
d222:   dex
        bpl d222
        sty $d011               // valid text mode in line 222's right border,
                                // before the panel's badline on 223
        lda #BOTTOM_IRQ
        sta $d012
        lda #<bottom_irq
        sta $fffe
        lda #>bottom_irq
        sta $ffff
        lda #1
        sta $d019
        pla
        tay
        pla
        tax
        pla
        rti

// Below the window: back to the playfield's registers for the next frame.
bottom_irq:
        pha
        lda yscroll
        ora #$10
        sta $d011
        lda #PF_D018
        sta $d018
        lda #PF_BG
        sta $d021
        lda #SPLIT_IRQ
        sta $d012
        lda #<split_irq
        sta $fffe
        lda #>split_irq
        sta $ffff
        lda #1
        sta $d019
        pla
        rti

// Delay count before the line-213 store, per playfield YSCROLL. At 5, line
// 213 is a badline, and the VIC holds the CPU for 40 cycles inside the loop.
delay213:
        .fill 8, i == 5 ? D213B : D213
yscroll:
        .byte YS

// Panel rows 21-23 in screen codes: lower-case letters are 1-26 in the
// lower-case set, which the default .text encoding produces.
panel_text:
        .text "  score 004250          hi 012900       "
        .text "                                        "
        .text "  lives 3    stage 2    time 173        "
panel_end:
.assert "panel is three rows", panel_end - panel_text, 120
```

## Build

```bash
java -jar KickAss.jar invalid-mode-band.asm -o invalid-mode-band.prg
java -jar KickAss.jar invalid-mode-band.asm :ys=0 -o invalid-mode-band-ys0.prg
java -jar KickAss.jar invalid-mode-band.asm :ys=7 -o invalid-mode-band-ys7.prg
java -jar KickAss.jar invalid-mode-band.asm :ys=0 :band=0 -o invalid-mode-band-noband.prg
java -jar KickAss.jar invalid-mode-band.asm :irq=214 -o invalid-mode-band-late.prg
```

The PRG is 569 bytes, loaded at $0801-$0A37.

## Expected output

Mid-grey border. A blue playfield of light-blue stripes, eight lines tall,
runs from line 55 to line 213. Lines 214-222 are black from edge to edge of
the window. A dark-grey panel, 40 columns wide, runs from line 223 to line 246
and reads `score 004250  hi 012900` and `lives 3  stage 2  time 173` in white
lower case. A yellow 24 x 21 block at x 208-231 runs from line 207 to line 227
and crosses the playfield, the band and the panel.

Measured in VICE x64sc 3.10 (PAL c64c: 8565/8580/8521, and `-model ntsc`,
6567R8) from the exit PNG with PIL, at the `scripts/verify-recipes.ts`
settings (8,000,000 cycles). Raster line = PNG row + 16 on PAL, + 28 on NTSC.
Builds with `:ys=0` to `:ys=7` were run on both models:

| Line | Every YSCROLL 0-7, PAL and NTSC |
|---|---|
| 55 | first playfield line (24-row top border) |
| 64+YSCROLL | first line of the second solid stripe: 64, 65, … 71, so the playfield really moves |
| 213 | last playfield line |
| 214-222 | black: 296 of the window's 320 pixels on each line, the other 24 the sprite |
| 223 | first panel line; lines 223-246 are pixel-identical in all eight builds |
| 247 | bottom border |

No pixel in lines 214-222 has the playfield's blue, its light blue or the
panel's dark grey, at any YSCROLL, on either model. The sprite covers x
208-231 on each band line.

With `:ys=0 :band=0` (PAL) the picture differs from the `:ys=0` build on
lines 214-222 only. Those lines are no longer black: the playfield's
light-blue last stripe runs on to line 222. Line 214 has 296 light-blue
pixels and the 24-pixel sprite. Lines 215-222 have 272 light-blue pixels, the
sprite, and at x 160-183 12 black and 12 dark-grey pixels: the late character
fetch of the badline that the YSCROLL store starts on line 215 (see "Why this
works"). That is what the band hides. The panel still starts on line 223.

Pinned in `runs.json`: the default build (YSCROLL 3) on PAL and NTSC as
`screenshots/invalid-mode-band.png` and `-ntsc.png`, `@ys0` and `@ys7` on
both models, `@noband` on PAL, and `@late` (below) on both.

### A late entry (`:irq=214`)

A game chains this handler after other raster work. FIREBASE
(`templates/run-and-gun`, `src/mux.asm`) jumps into it from its
multiplexer's late guard when the last sprite zone ends past line 208
(`SPLIT_IRQ - MARGIN`), so the handler can start later than line 211. If it
starts after 213, the first poll's line has gone. `:irq=214` makes that
happen every frame. Each poll waits
while `$D012` is at or below the line before its own (`LDA #212 / CMP
$D012 / BCS`), so a late entry falls through. Measured in VICE x64sc 3.10,
PAL and NTSC, four exit screenshots one frame apart (8,000,000 cycles and
the next three frames), PIL down column x 100:

| Poll | Every frame shows |
|---|---|
| `BCS` while below, this listing, `:irq=214` | band from line 215 (x 264 on PAL, x 236 on NTSC) to 222, whole from 216; panel from 223, identical to the default build's; all four frames alike |
| `BNE` until equal, a probe build (not this listing), `:irq=214` | frames 1 and 3: band 214-222, as the default build. Frames 0 and 2: no black line at all, and lines 211-235 differ from the default build: the panel is shifted and drawn in the playfield's upper-case charset on its blue |

The equality poll never sees 213 in the frame it was entered, so it
spins until line 213 of the next frame with interrupts held: nearly a
whole frame of CPU, and no band in the frame it missed. It then returns
at about line 224 and acknowledges the line-214 interrupt that came
while it spun, so the next entry is two frames on, and the band shows one
frame in two. The same pitfall, met through a dispatcher, is
`raster_poll_equality_misses_under_dispatch_latency` in
`pitfalls/raster-and-badline.md`.

The `BCS` poll costs what the `BNE` poll did: 4 + 3 cycles a pass and
2 on the way out (instruction table, rung 3), and all seven pinned
screenshots of the default and `@ys`/`@noband` builds stayed pixel-identical
when the listing changed from one to the other. A late entry still costs
one torn line; it no longer costs a frame. An earlier version of this
listing polled with `CMP $D012 / BNE`.

### The store windows

Each `$D011` store has a window in which it shows nothing. The windows were
found by changing the delay counts one step (5 cycles) at a time and tracing
the stores with the VICE monitor (`trace store d011`; the cycle is the
monitor's column, 0-62 on PAL). The sprite on these lines adds its DMA to
some of the landings.

| Store | Shows nothing when it lands | Too early | Too late |
|---|---|---|---|
| ECM+BMM on | 213/61 to 214/12 with YSCROLL 6 (line 214 a badline); to 214/14, the latest tried, otherwise | 213/51-53: 40, 32 and 24 pixels of line 213 black, 8 a cycle, so the edge is near 213/56 | 214/13 with YSCROLL 6: the badline holds the store until line 215 and line 214 is not black |
| YSCROLL 7 | 215/7 to 215/54, every YSCROLL tried (0, 1, 3, 6, 7) | not tried before cycle 7 | 215/62 with YSCROLL 0: line 216 is a badline, the panel shows rows 22-23 |
| ECM+BMM off | 222/55 to 223/10 | 222/53: 24 pixels of line 222 not black | 224/0: panel line 223 black |

With the listing's delays the stores land at 213/61-62 or 214/1, 215/30-32
and 223/2-5 on PAL, and at 213/64 to 214/2, 215/28-31 and 223/0-3 on NTSC
(cycles 0-64). At YSCROLL 7 the YSCROLL store lands on 216 (216/14 PAL,
216/12 NTSC), because line 215 is then a badline; the value does not change,
so it does not matter. A poll of `$D012` exits up to 7 cycles late, which each window
covers. With YSCROLL 5, line 213 is a badline and holds the CPU for 40 cycles
inside the delay loop, so `delay213` holds a count of 1 for that phase and 9 for
the others.

### CPU cost

Traced in VICE (`trace exec` on the handler's first instruction and its
`RTI`): the split handler runs from line 211 to line 224, 852 cycles on PAL
and 874 on NTSC including the 7-cycle interrupt entry and the `RTI`, most of
it polling. The line-250 handler costs 66, more than one line, so it runs into line 251. That is 918 cycles a frame on PAL.

## Why this works

ECM with BMM is one of the three invalid mode combinations
(`hardware/vic-ii-reference.md`, "Illegal display modes"). The VIC keeps
fetching and keeps classifying pixels as foreground or background, but every
character or bitmap pixel comes out black, whatever `$D021` and colour RAM
hold. Sprites are drawn over it as usual, which the yellow block shows. The
pitfall `ecm_with_mcm_set_is_invalid_black_mode`
(`pitfalls/text-mode-render.md`) is the same mode reached by accident.

The band turns three exact-cycle stores into stores with windows of at least
15 cycles. The smallest measured is the switch-on at the badline phase
(YSCROLL 6): 213/61 to 214/12, 15 cycles on PAL. Its early edge near 213/56 is
extrapolated from the too-early landings (rung 3), not measured as a clean
landing. An earlier version said 19 cycles or more here and 20 in the
listing, both counted from that edge. The switch-on lands in line 213's right border or before the window
opens on line 214. The charset (`$D018`) and background (`$D021`) stores can
land anywhere in the band. The YSCROLL store is the one that decides where
the panel starts: the playfield's row 20 starts on line 208+YSCROLL, so its
next row would start on 216+YSCROLL. With YSCROLL 7 in place before line
216's badline check, no line from 216 to 222 matches, and the next badline is
223 at every playfield phase. Every store in the 215/7-54 window makes 215 a
badline when YSCROLL was not already 7, the listing's own stores at 215/28-32
included (Bauer's model; not measured separately). In VICE that did not move
the panel (stores at 215/7-10 and the listing's gave the same panel): a
badline in the middle of a row fetches the same row again, because the row
base advances only when the row counter reaches 7 (Bauer's VIC article;
consistent with this run, not measured further). The badline stalls the CPU
for up to about 40 cycles, inside the band. Its late character fetch is the
12 black and 12 dark-grey pixels at x 160-183 in the `@noband` picture. The switch-off lands in
line 222's right border, before the panel's badline stalls the CPU on line
223.

Without the band these writes would need the exact timing of
`scroll_panel_split` (`techniques/scroll.md`), where a delay table per phase
puts the stores into one line's right border. The band's price is nine black
lines.
