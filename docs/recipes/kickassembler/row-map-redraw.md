---
recipe: row-map-redraw
toolchain: kickassembler
output_format: PRG
region: both
techniques: [row_map_redraw, soft_scroll_v, invalid_mode_band, frame_sync_loop, self_modifying_code, ram_under_kernal]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC06, DC07, DC0D, DC0F, DD0D]
uses_kernal: []
claims: [cia1_timer_a (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init)]
harness: [cia1_timer_b]
ram: [screen=$0400-$07FF, idle=$3FFF, colour=$D800-$DBFF]
devices: []
---

<!-- doc-type: recipe -->

# KickAssembler — Coarse vertical scroll by redrawing the playfield from a raw row map

## Synopsis

A 21-row playfield scrolls down one pixel a frame over a fixed three-row
panel. It never shifts screen RAM. On every eighth frame, when YSCROLL wraps
from 7 to 0, the main loop redraws all 21 rows (840 bytes) from a raw row
map: one screen code a cell, 40 bytes a row, no tiles. The redraw starts on
line 225, right after the frame counter ticks below the playfield, and runs
top row first, so every row is written before the VIC fetches it in the next
frame. One screen matrix, no second buffer, and colour RAM is written once at
start-up. This is the `row_map_redraw` technique. The panel shows the redraw's
start and end lines, its cycle count and its smallest lead over the beam,
printed on the frame after the redraw.
`:wait=10` holds the redraw back to line 10 and shows the tear this layout
avoids. The panel split is `invalid_mode_band` (`recipes/kickassembler/invalid-mode-band.md`),
and the KERNAL is banked out so the interrupts go through `$FFFE`
(`ram_under_kernal`).

## Source

```asm
// row-map-redraw.asm: a playfield of 21 character rows scrolls down one
// pixel a frame over a fixed three-row panel. Every eighth frame, when
// YSCROLL wraps from 7 to 0, the main loop redraws all 21 rows (840 bytes)
// straight from a raw row map: screen codes, 40 bytes a row, no tiles. The
// redraw starts right after the frame counter ticks on line 224, below the
// playfield's last badline, and runs top row first, so each row is written
// before the VIC fetches it in the next frame. One screen, no row shift, no
// second matrix. That frame runs no other logic.
// A harness records the redraw's start and end raster lines, its CIA1 timer B
// cycle count (interrupts included) and the line each row was finished on,
// and on the next frame, a quiet one, prints them in the panel with the
// smallest lead over the beam.
// Build: java -jar KickAss.jar row-map-redraw.asm -o row-map-redraw.prg
// Variant: :wait=10 holds the redraw until line 10, too late: it tears.

BasicUpstart2(start)

.function cv(n, d) { .return cmdLineVars.containsKey(n) ? cmdLineVars.get(n).asNumber() : d }
// Delay counts for the band split (dex/bpl, 5 cycles a pass, 4 on the way
// out), found in VICE; the page lists what each store's window is.
.var D213  = cv("d213", 9)
.var D213B = cv("d213b", 1)
.var D215  = cv("d215", 3)
.var D222  = cv("d222", 9)
// :wait=L holds the redraw back until raster line L of the next frame, to
// show the tear this layout avoids (0, the default, starts at once).
.var WAIT  = cv("wait", 0)

.const SCREEN     = $0400
.const COLRAM     = $d800
.const PANEL      = SCREEN + 21*40   // panel rows 21-23
.const PF_ROWS    = 21         // rows 0-20 scroll; row 20 ends under the band
.const MAP_ROWS   = 60         // map rows 0-59; row m+40 repeats row m
.const WRAP_TOP   = 39         // top row after 0: the row above row 40 is 39
.const START_TOP  = 39
.const SPLIT_IRQ  = 211        // band split: polls for 213, 215, 222
.const BOTTOM_IRQ = 250        // below the 24-row window: next frame's YSCROLL
.const PF_D011    = $10        // DEN, RSEL=0 (24 rows), text; YSCROLL added
.const BAND_ON    = $60        // ECM + BMM: the display window draws black
.const PANEL_D011 = $17        // DEN, RSEL=0, YSCROLL 7: panel badline on 223
.const LATE       = 216        // a line at or below this is still frame N
.const PF_BG      = 6          // blue
.const PF_FG      = 14         // light blue
.const PANEL_BG   = 11         // dark grey
.const BORDER     = 12         // mid grey, so black in the window is the band

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
        lda #$c8                // 40 columns, XSCROLL 0, hires text
        sta $d016
        lda #$15                // screen $0400, upper-case ROM charset
        sta $d018

        ldx #0                  // colour RAM, once: light blue everywhere,
colfill:                        // then white for the panel. The scroll never
        lda #PF_FG              // touches it.
        sta COLRAM,x
        sta COLRAM+$100,x
        sta COLRAM+$200,x
        sta COLRAM+$2e8,x
        inx
        bne colfill
        ldx #119
panel:  lda panel_text,x
        sta PANEL,x
        lda #1
        sta COLRAM+21*40,x
        dex
        bpl panel

        jsr detect_lines        // 312 on PAL, 263 on NTSC
        jsr calibrate           // the harness's own timer overhead
        lda #START_TOP
        sta top
        jsr redraw              // first picture
        lda #$ff                // forget the first redraw's figures
        sta worstlead
        lda #$7f
        sta worstlead+1
        lda #0
        sta worstcyc
        sta worstcyc+1
        sta count
        sta pending

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

// The frame loop. The split handler ticks `frame` on line 224.
main:
        lda frame
wait:   cmp frame
        beq wait
        ldx yscroll             // content moves down one line a frame
        inx
        txa
        and #7
        sta yscroll             // the line-250 IRQ writes it to $D011
        bne quiet               // seven frames in eight: game logic goes here
        ldx top                 // the eighth: one map row up, then redraw
        dex
        bpl settop
        ldx #WRAP_TOP
settop: stx top
.if (WAIT != 0) {
!:      jsr readline            // the torn variant: wait for line WAIT
        cpx #0
        bne !-
        cmp #WAIT
        bcc !-
        cmp #LATE
        bcs !-
}
        jsr redraw
        lda #1                  // print on the next frame: on NTSC the
        sta pending             // redraw ends on line 181 and the report
        jmp main                // would run past the tick on 224
quiet:  lda pending
        beq main
        lda #0
        sta pending
        jsr report              // harness: lead loop and panel, ~3,500 cycles
        jmp main

// The redraw: rows 0-20 from map row `top` onward, 40 bytes each, top row
// first. The loop's operands are patched: LDA map,Y / STA screen,Y.
redraw:
        jsr readline            // harness: start line
        sta startlo
        stx starthi
        lda #$ff                // harness: CIA1 timer B from $FFFF
        sta $dc06
        sta $dc07
        lda #$11                // force load, start, continuous
        sta $dc0f
        ldx top
        lda maplo,x
        sta src+1
        lda maphi,x
        sta src+2
        lda #<SCREEN
        sta dst+1
        lda #>SCREEN
        sta dst+2
        ldx #0
row:    ldy #39
src:    lda $ffff,y
dst:    sta $ffff,y
        dey
        bpl src
.assert "copy loop in one page: a taken bpl across a page costs 819 more cycles", >src, >*
!:      ldy $d011               // harness: the line this row was finished on,
        lda $d012               // retried if bit 8 changed between the reads
        cpy $d011               // (26 cycles a row)
        bne !-
        sta rowlo,x
        tya
        sta rowhi,x
        lda src+1               // next row: +40 on both operands
        clc
        adc #40
        sta src+1
        bcc !+
        inc src+2
!:      lda dst+1
        clc
        adc #40
        sta dst+1
        bcc !+
        inc dst+2
!:      inx
        cpx #PF_ROWS
        bne row
        lda #0                  // harness: stop the timer
        sta $dc0f
        lda $dc06
        eor #$ff                // $FFFF - timer = cycles since the start
        sec
        sbc calib
        sta cyc
        lda $dc07
        eor #$ff
        sbc calib+1
        sta cyc+1
        jsr readline
        sta endlo
        stx endhi
        rts

// Harness: raster line in A (low 8 bits), X = $80 when the line is 256 or
// more. Reads $D011 on both sides of $D012 and retries on a change.
readline:
        ldx $d011
        lda $d012
        cpx $d011
        bne readline
        pha
        txa
        and #$80
        tax
        pla
        rts

// Harness: the timer start/stop pair with nothing between, for `calib`.
calibrate:
        lda #$ff
        sta $dc06
        sta $dc07
        lda #$11
        sta $dc0f
        lda #0
        sta $dc0f
        lda $dc06
        eor #$ff
        sta calib
        lda $dc07
        eor #$ff
        sta calib+1
        rts

// Harness: the highest raster line + 1, from the low byte seen while bit 8
// is set.
detect_lines:
!:      lda $d011
        bpl !-
        lda #0
        sta lines
!:      lda $d012
        cmp lines
        bcc !+
        sta lines
!:      lda $d011
        bmi !--
        lda lines
        clc
        adc #1                  // + 257 in all
        sta lines
        lda #1
        adc #0
        sta lines+1
        rts

// Harness: lead of each row = the line the VIC fetches it on next frame
// (48 + 8r at YSCROLL 0) minus the line it was finished on, where a line
// above LATE is taken as line - lines, in frame N. Keeps the smallest,
// signed, for this redraw and for the whole run; then prints.
report:
        lda #$ff
        sta minlead
        lda #$7f
        sta minlead+1
        ldx #0
lead:   lda rowlo,x
        sta l0
        lda rowhi,x
        asl
        lda #0
        rol
        sta l1                  // l1:l0 = the 9-bit line
        bne inN
        lda l0
        cmp #LATE
        bcc notN
inN:    lda l0                  // frame N: line - lines (negative)
        sec
        sbc lines
        sta l0
        lda l1
        sbc lines+1
        sta l1
notN:   lda fetch,x             // lead = fetch - line
        sec
        sbc l0
        sta d0
        lda #0
        sbc l1
        sta d1
        lda d0                  // signed d < minlead ?
        cmp minlead
        lda d1
        sbc minlead+1
        bvc !+
        eor #$80
!:      bpl nomin
        lda d0
        sta minlead
        lda d1
        sta minlead+1
        stx minrow
nomin:  inx
        cpx #PF_ROWS
        bne lead

        lda minlead             // whole run: smallest lead, largest count
        cmp worstlead
        lda minlead+1
        sbc worstlead+1
        bvc !+
        eor #$80
!:      bpl !+
        lda minlead
        sta worstlead
        lda minlead+1
        sta worstlead+1
!:      lda worstcyc
        cmp cyc
        lda worstcyc+1
        sbc cyc+1
        bcs !+
        lda cyc
        sta worstcyc
        lda cyc+1
        sta worstcyc+1
!:      inc count

        lda starthi             // row 21: start, end, cycles
        asl
        lda #0
        rol
        ldx #13
        jsr put1
        lda startlo
        jsr put2
        lda endhi
        asl
        lda #0
        rol
        ldx #21
        jsr put1
        lda endlo
        jsr put2
        ldx #32
        lda cyc+1
        jsr put2
        lda cyc
        jsr put2
        ldx #40+9               // row 22: this redraw's smallest lead
        lda minlead+1
        jsr put2
        lda minlead
        jsr put2
        ldx #40+21
        lda minrow
        jsr put2
        ldx #40+28
        lda top
        jsr put2
        ldx #80+13              // row 23: worst over the run
        lda worstcyc+1
        jsr put2
        lda worstcyc
        jsr put2
        ldx #80+27
        lda worstlead+1
        jsr put2
        lda worstlead
        jsr put2
        ldx #80+34
        lda count
        jsr put2
        rts

put2:   pha                     // A as two hex digits at PANEL+X
        lsr
        lsr
        lsr
        lsr
        jsr put1
        pla
        and #$0f
put1:   tay                     // A (0-15) as one hex digit at PANEL+X
        lda hexdigits,y
        sta PANEL,x
        inx
        rts

// The band split, as in invalid-mode-band: ECM+BMM on in line 213's right
// border, YSCROLL 7 on line 215, text mode back in line 222's right border.
// It ticks the frame counter on its way out, on line 224.
split_irq:
        pha
        txa
        pha
        tya
        pha
        ldx yscroll
        lda yscroll
        ora #PF_D011 | BAND_ON  // same YSCROLL, ECM+BMM: no badline moves
        tay
        lda delay213,x
        tax
        lda #213
w213:   cmp $d012
        bne w213
d213:   dex
        bpl d213
        sty $d011               // the band starts on line 214
        lda #PANEL_BG
        sta $d021               // panel background, inside the band
        ldy #PANEL_D011 | BAND_ON
        lda #215
w215:   cmp $d012
        bne w215
        ldx #D215
d215:   dex
        bpl d215
        sty $d011               // YSCROLL 7: the next badline is 223
        ldy #PANEL_D011
        lda #222
w222:   cmp $d012
        bne w222
        ldx #D222
d222:   dex
        bpl d222
        sty $d011               // text mode back before the panel's badline
        inc frame               // wakes the main loop
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

// Below the window: the playfield's YSCROLL and colour for the next frame.
bottom_irq:
        pha
        lda yscroll
        ora #PF_D011
        sta $d011
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

delay213:                       // line 213 is a badline at YSCROLL 5
        .fill 8, i == 5 ? D213B : D213
fetch:  .fill PF_ROWS, 48 + 8*i // row r's badline at YSCROLL 0
maplo:  .fill MAP_ROWS, <(map + 40*i)
maphi:  .fill MAP_ROWS, >(map + 40*i)
hexdigits:
        .text "0123456789abcdef"

panel_text:
        .text "redraw start 000 end 000 cycles 0000    "
        .text "min lead 0000 at row 00 top 00          "
        .text "worst cycles 0000 min lead 0000 n 00    "
panel_end:
.assert "panel is three rows", panel_end - panel_text, 120

// The map: one screen code a cell, 40 a row, row 0 at the top. A solid block
// walks one column right per row (column m mod 40), so every screen row says
// which map row it holds; a dot every fourth column on even rows is the
// ground. Row m+40 repeats row m, so the scroll can wrap from row 0 to 39.
map:
.for (var m = 0; m < MAP_ROWS; m++) {
  .var mm = mod(m, 40)
  .for (var c = 0; c < 40; c++) {
    .byte c == mm ? $a0 : ((mod(mm, 2) == 0 && mod(c + mm, 4) == 0) ? $2e : $20)
  }
}
map_end:

frame:     .byte 0
yscroll:   .byte 0
top:       .byte 0
lines:     .word 0
calib:     .word 0
cyc:       .word 0
startlo:   .byte 0
starthi:   .byte 0
endlo:     .byte 0
endhi:     .byte 0
minlead:   .word 0
minrow:    .byte 0
worstlead: .word 0
worstcyc:  .word 0
count:     .byte 0
pending:   .byte 0
l0:        .byte 0
l1:        .byte 0
d0:        .byte 0
d1:        .byte 0
rowlo:     .fill PF_ROWS, 0
rowhi:     .fill PF_ROWS, 0
```

## Build

```bash
java -jar KickAss.jar row-map-redraw.asm -o row-map-redraw.prg
java -jar KickAss.jar row-map-redraw.asm :wait=10 -o row-map-redraw-torn.prg
```

The PRG is 3,662 bytes, loaded at $0801-$164C. The map is 2,400 of them
(60 rows at $0CA9-$1608).

## Expected output

Mid-grey border. A blue playfield of light-blue dots, with a solid
light-blue block that steps one column right on each row down the screen,
runs from line 55 to line 213 and moves down one line a frame. Lines 214-222
are black. A dark-grey panel from line 223 to line 246 reads, in white:

```
REDRAW START 0E1 END 087 CYCLES 363D
MIN LEAD 004B AT ROW 14 TOP 08
WORST CYCLES 365C MIN LEAD 004A N 1F
```

All panel figures are hex. Row 1: the last redraw's start and end raster
lines and its CIA1 timer B count, less the timer's own start/stop overhead.
Row 2: the smallest lead over the beam in that redraw, the row it was on, and
the map row now at the top. Row 3: the largest count and smallest lead over
every redraw since start-up (not the first draw), and how many redraws that
was.

Measured in VICE x64sc 3.10 (PAL c64c: 8565/8580/8521, and `-model ntsc`,
6567R8) from the exit PNGs with PIL, at the `scripts/verify-recipes.ts`
settings. Raster line = PNG row + 16 on PAL, + 28 on NTSC. The script finds
the block's column on every playfield line and reads the panel by matching
each 8 x 8 cell against the character ROM.

| Pinned shot | Cycles | What the PNG shows |
|---|---|---|
| `row-map-redraw.png` (PAL) | 8,000,000 | YSCROLL 5, top map row 8. 21 rows from line 55, the first 6 lines tall, the rest 8. Block columns 8, 9, … 28, each row one more than the row above. Band 214-222, panel 223-246. |
| `row-map-redraw-ntsc.png` | 8,000,000 | YSCROLL 5, top map row 4, columns 4 to 24, each +1. Same band and panel lines. |
| `row-map-redraw-mid.png` (PAL) | 8,045,360 | The exit lands while the redraw is still copying (it ends on line 135). Lines 55-102 come from the new frame: YSCROLL 0, top map row 7, rows starting on 56, 64, … 96 with columns 8 to 13. From line 103 the PNG still holds the previous frame (YSCROLL 7, top row 8). Every row is one column on from the one above. |
| `row-map-redraw-mid-ntsc.png` | 8,040,923 | The same picture on NTSC with top map row 3 above the cut (columns 3 to 9) and top row 4 below it, cut on the same line; the redraw ends on line 181 there. |
| `row-map-redraw-torn.png` (PAL, `:wait=10`) | 8,137,592 | A whole frame at YSCROLL 0 with top map row 10. Rows 0-12 (to line 151) hold columns 10 to 22; the row from line 152 holds column 24, and the rows below continue from 24. Column 23 is missing: rows 13-20 are the old picture, the tear. |

Panel figures, converted:

| | PAL | NTSC | PAL `:wait=10` |
|---|---|---|---|
| Redraw start line | 225 | 225 | 10 |
| Redraw end line | 135 (next frame) | 181 (next frame) | 252 (same frame) |
| Cycles, last redraw | 13,885 | 14,128 | 15,144 |
| Cycles, worst of the run | 13,916 | 14,175 | 15,191 |
| Smallest lead, last redraw | 75 lines, row 20 | 29 lines, row 20 | −20 lines, row 17 |
| Smallest lead, whole run | 74 lines | 28 lines | −20 lines |
| Redraws counted | 31 | 35 | 28 |

The torn panel reports the redraw before the pictured one; every redraw
in that build starts on line 10, and each one ends after the frame tick on
line 224, so the loop loses a frame per redraw and counts fewer. The default
build loses none: from 8,000,000 to 12,000,000 cycles N goes from $1F to $38
on PAL (25 redraws in 203.5 frames) and from $23 to $40 on NTSC (29 in 234),
eight frames each. An earlier version of this recipe printed the panel right
after the redraw; on NTSC the redraw ended on line 193 and the report
(about 3,500 cycles, measured with CIA1 timer B) ran past the tick on line
224, so NTSC lost a frame on every redraw and scrolled one pixel in nine
frames, not eight. The report now runs on the frame after, a quiet one.

The harness logs a row when its last byte, column 0, is stored. The block
cell is stored earlier in the row, so in the torn build rows 11 and 12 show
their new block although their logged leads are −3 and −5 lines (from a
build that printed each row's line; its row 17 matches the panel's −20). A row
finished after line 216 is read as frame N, so the torn build's smallest
lead covers rows 0-17 only.

The cycle counts include the line-250 interrupt, which lands inside the
redraw, the badline stalls of the display lines it overlaps, and the
harness's per-row `$D011`/`$D012` reads (26 cycles a row, 546 in all,
instruction-table arithmetic). The inner loop is 14 cycles a byte, 559 a row,
plus one cycle for each load that crosses a page (arithmetic). The loop must
sit in one page: a taken `BPL` into another page costs one more cycle a
byte, 819 a redraw, and the listing asserts it. An earlier version of this
recipe had the loop across $08FF/$0900 and measured 14,666 cycles on PAL for
the same copy, and its "14 cycles a byte" was 15 in its own build.

### The cycle sweep

The same default build was run with the exit screenshot at 232 different
cycle counts: every 2,457 cycles (39 PAL lines) over ten frames from
8,000,000 on PAL, every 2,113 over ten frames on NTSC, and every 4 lines from
line 40 to line 160 (PAL) and 40 to 200 (NTSC) of a frame in which the
redraw is running. The sweep was re-run on the current listing. In every one, the block column steps by exactly one from
each playfield row to the next, lines 214-222 are black across the whole
window, line 55 is the first playfield line and the panel reads back as
above (the last redraw's count reads $363D or $363E on PAL). All eight YSCROLL phases appear on both models. Where an exit cuts a
frame, the cut shows as one row a line short (the next frame is one pixel
lower) and never as a skipped or repeated column; in the redraw frame the cut
moved down the screen with the exit point, 56, 64, … 160 on PAL and up to 192
on NTSC, so every row was seen from the half-redrawn screen.

The same check on the `:wait=10` build, 80 exits every 39 lines from
8,000,000, finds the missing column, at line 152, in eight consecutive exits
(8,127,764 to 8,144,963, one frame) and in none of the other 72.

## Why this works

**The VIC reads a character row once, on its badline.** Changing screen RAM
for a row after its badline changes nothing until the next frame. In the
frame before a redraw YSCROLL is 7, so the last playfield row, row 20, is
fetched on line 215 (48 + 160 + 7). From line 216 the whole playfield can be
rewritten without a visible change, and the redraw starts on line 225, when
the band split ticks the frame counter.

**The redraw has to beat the beam once, not every row.** In the next frame
YSCROLL is 0 and row r is fetched on line 48 + 8r. A build that also printed
each row's finish line (PAL, 8,000,000 cycles; its row-20 line matches the
pinned panel's lead) showed rows 0-7 finished on lines 236, 246, 258, 268,
278, 288, 298 and 308, rows 8-12 on 6, 16, 26, 35 and 46 of the next frame,
and rows 13-20 on 57 to 133. So rows 0-12 are done before line 48. A row
takes about 10.3 lines in the border and about 11 on the display lines,
where each badline takes 40-odd cycles, so the lead shrinks by about three
lines a row. It is smallest on the last row: 208 − 133 = 75 lines on PAL.
NTSC's frame has 263 lines, so only rows 0-7 are done by line 48, and row 20
finishes on line 179 against its fetch on 208: 29 lines. Starting the same
copy on line 10 (`:wait=10`) gives rows 0-12 time for the block and loses
from row 13 on: the harness reports −20 lines at row 17, and the PNG shows
the old rows 13-20 under the new rows 0-12. An earlier version quoted 62 and
17 lines and a finish on line 145; those came from the build whose loop
crossed a page (above).

**The new rows and the new YSCROLL must reach the same frame.** The main loop
sets YSCROLL to 0 before the redraw, and the line-250 interrupt writes it
into `$D011` while the copy is running. The next frame shows YSCROLL 0 and
the new rows together, so the content moves one pixel, not seven. A trial
build that waited for line 40 before the redraw drew every row too late: the
whole frame showed the old rows at YSCROLL 0, a jump of seven pixels up and
back, and no tear (measured, PAL; not kept as a variant).

**Colour RAM is not part of it.** Every playfield cell has the same colour,
written once at start-up. A map that needs a colour per cell would have to
copy 840 more bytes into `$D800`, which cannot be double buffered either
(`techniques/scroll.md`, `char_scroll_buffer_v`).

**Seven frames in eight are free.** The recipe runs no game logic, but the
loop shows where it goes: `bne quiet` after the YSCROLL step, where the
harness's report also runs. On the redraw frame, logic fits between the
redraw's end and the split interrupt on line 211. PAL: 76 lines × 63 = 4,788
cycles, less 10 badlines × 43 = 4,358. NTSC: 30 lines × 65 = 1,950, less 4
badlines × 43 = 1,778 (arithmetic from the measured end lines). That window
holds no harness work: the report moved to the next frame. The redraw
itself still holds 546 cycles of harness reads, so a game without them
ends the copy about eight lines sooner and gains that time too. An earlier
version gave 4,131 and 1,332 cycles, by subtracting counts from the frame,
while the report it did not count ran in that time.
