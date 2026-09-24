---
recipe: raster-split-modes
toolchain: kickassembler
output_format: PRG
region: both
techniques: [raster_split_modes, standard_bitmap, screen_ram_relocation, ram_under_kernal]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC0D, DD0D]
uses_kernal: []
claims: [cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init), vic_matrix_base (owns)]
ram: [colour=$D800-$DBFF, colours=$0400-$07E7, text=$0C00-$0FE7, bitmap=$2000-$3FFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Bitmap above, text below, switched in one line

## Synopsis

A hires bitmap fills character rows 0 to 11 and text fills rows 12 to 24.
The last bitmap line is raster line 146 and the first text line is 147:
no line in between shows a mix of the two. The split costs two stores. One
`$D018` store in line 145 moves the video matrix, which the VIC only uses
at the next badline, and keeps the bitmap base bit, which it uses at once.
One `$D011` store clears BMM in the right border of line 146. This is
`raster_split_modes` (`docs/techniques/raster.md`) with the two halves of
`$D018` placed by the rule that technique measured. The KERNAL is banked
out and both IRQs go through `$FFFE` (`ram_under_kernal`).

## Source

```asm
// raster-split-modes.asm: hires bitmap on character rows 0-11, text on rows
// 12-24, switched between raster lines 146 and 147 with no glitch line.
// One $D018 store in line 145 moves the video matrix (it shows from the next
// badline) and keeps the bitmap/charset base bit 3, so the bitmap stays; the
// charset is a RAM copy at $3800 for that reason. One $D011 store clears BMM between
// line 146's last pixel and line 147's first.
// Build: java -jar KickAss.jar raster-split-modes.asm -o raster-split-modes.prg

BasicUpstart2(start)

.const SPLIT_LINE  = 147      // first text line: row 12's badline with YSCROLL 3
.const PREP_IRQ    = 145      // the split IRQ fires here and polls for SPLIT_LINE
.const DELAY       = 11       // with the NOP: the $D011 store lands on cycles 2-4 (PAL) or 6 (NTSC) of line 147
.const TOP_IRQ     = 252      // below the display: restore the bitmap for next frame

.const BMP_SCREEN  = $0400    // bitmap colour matrix
.const TXT_SCREEN  = $0c00    // text matrix
.const BITMAP      = $2000
.const COLRAM      = $d800
.const BMP_D011    = $3b      // BMM, DEN, RSEL, YSCROLL 3
.const TXT_D011    = $1b      // DEN, RSEL, YSCROLL 3
.const BMP_D018    = $18      // matrix $0400, bitmap $2000 (CB bit 3)
.const CHARSET     = $3800    // ROM lower-case set copied here; bitmap rows 12-24 are unused
.const TXT_D018    = $3e      // matrix $0C00, charset $3800; bit 3 set, as for the bitmap

* = $0810
start:
        sei
        lda #$35                // KERNAL and BASIC out, I/O in: IRQs through $FFFE
        sta $01
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda #0
        sta $d020
        lda #6
        sta $d021

        ldx #0                  // bitmap rows 0-11: vertical stripes ($AA);
!:      lda #$aa                // rows 12-24 of the bitmap stay zero
        .for (var p = 0; p < 15; p++) {
            sta BITMAP + p*256,x
        }
        lda #0
        .for (var p = 15; p < 32; p++) {
            sta BITMAP + p*256,x
        }
        inx
        bne !-

        lda #$33                // character ROM in at $D000 for the copy
        sta $01
        ldx #0
!:      .for (var p = 0; p < 8; p++) {
            lda $d800 + p*256,x // the second set: lower and upper case
            sta CHARSET + p*256,x
        }
        inx
        bne !-
        lda #$35
        sta $01

        ldx #0                  // bitmap colours: column colour 1-15 on black
!:      txa
        and #$0f
        bne !+
        lda #$0f
!:      asl
        asl
        asl
        asl
        .for (var r = 0; r < 12; r++) {
            sta BMP_SCREEN + r*40,x
        }
        inx
        cpx #40
        bne !--

        ldx #0                  // text rows 12-24: row 12 reverse spaces,
!:      lda #$a0                // the rest spaces, then the caption
        sta TXT_SCREEN + 12*40,x
        lda #$20
        .for (var r = 13; r < 25; r++) {
            sta TXT_SCREEN + r*40,x
        }
        lda #14                 // light blue on blue
        .for (var r = 12; r < 25; r++) {
            sta COLRAM + r*40,x
        }
        inx
        cpx #40
        bne !-
        ldx #caption_end - caption - 1
!:      lda caption,x
        sta TXT_SCREEN + 14*40 + 4,x
        dex
        bpl !-

        lda #BMP_D018
        sta $d018
        lda #$c8                // 40 columns, hires, XSCROLL 0
        sta $d016
        lda #<top_irq
        sta $fffe
        lda #>top_irq
        sta $ffff
        lda #TOP_IRQ
        sta $d012
        lda #BMP_D011           // bit 7 clear: compare line below 256
        sta $d011
        lda #1
        sta $d01a
        sta $d019
        cli
        jmp *

// Below the display: bitmap mode and matrix back for the next frame.
top_irq:
        pha
        lda #BMP_D011
        sta $d011
        lda #BMP_D018
        sta $d018
        lda #PREP_IRQ
        sta $d012
        lda #<split_irq
        sta $fffe
        lda #>split_irq
        sta $ffff
        lda #1
        sta $d019
        pla
        rti

// Line 145: move the matrix now, clear BMM at the start of line 147.
split_irq:
        pha
        txa
        pha
        tya
        pha
        lda #TXT_D018           // VM shows from the badline on 147; CB bit 3
        sta $d018               // unchanged, so lines 145-146 still read $2000
        ldx #TXT_D011           // loaded before the poll: only the store remains
        lda #SPLIT_LINE - 1
!:      cmp $d012               // 7-cycle poll for line 146
        bne !-
        ldy #DELAY              // 2 + 5 * DELAY - 1 + 2 cycles; measured in VICE,
!:      dey                     // the store lands on cycles 2-4 (PAL) or 6 (NTSC)
        bne !-                  // of line 147: after line 146's last pixel, before
        nop                     // line 147's BA (12) and first fetch (15)
        stx $d011
        lda #TOP_IRQ
        sta $d012
        lda #<top_irq
        sta $fffe
        lda #>top_irq
        sta $ffff
        lda #1
        sta $d019
        pla
        tay
        pla
        tax
        pla
        rti

.encoding "screencode_mixed"
caption:
        .text "Bitmap above line 147, text below."
caption_end:
```

## Build

```bash
java -jar KickAss.jar raster-split-modes.asm -o raster-split-modes.prg
```

## Expected output

Black border. Rows 0 to 11 are vertical stripes one pixel wide: each
8-pixel cell alternates its column colour (1 to 15, then 15 again for
column 0 of each group of 16) with black. Row 12 is a solid light blue bar;
below it, on blue, the caption `Bitmap above line 147, text below.` in the
ROM's lower-case set on row 14.

Measured with PIL on both screenshots, every display line classified as
the stripe pattern (all 320 pixels match), the bar (all 320 light blue),
text (only blue and light blue) or none of these: PAL c64c (8565/8580/8521)
and NTSC 6567R8 both read stripes on lines 51 to 146, the bar on 147 to
154 and text on 155 to 250, with no other line.
Screenshots: `screenshots/raster-split-modes.png` (PAL),
`screenshots/raster-split-modes-ntsc.png` (NTSC).

### Where the `$D011` store may land

A store trace on `$D011` (Bauer's cycle numbering,
`docs/runtime/vice-reference.md`, "What the CYC column counts") gave the
landing cycle in every frame of an 8,000,000-cycle run. The listing's store
lands on cycles 2 to 4 of line 147 on PAL and on cycle 6 on NTSC. Changing
`DELAY` (5 cycles a step) and the number of `NOP`s moved it; each row below
is the exit screenshot of such a build, classified line by line:

| Build | PAL: store (line, cycle) and picture | NTSC: store and picture |
|---|---|---|
| `DELAY` 8, no `NOP` | 146, 48-50: line 146 wrong from x 296 | 146, 53-54: line 146 wrong from x 334 |
| `DELAY` 9, with or without the `NOP` | 146, 53-55: line 146 wrong from x 336 (columns 38-39) | 146, 59 and 61: clean |
| `DELAY` 10 to 12, with or without the `NOP` (the listing: 11 with) | 146, 59-63 and 147, 1-7: clean | 146, 63-65 and 147, 1-11: clean |
| `DELAY` 13, no `NOP` | 147, 11-12: clean | pushed to 147, 56: line 147 black |
| `DELAY` 14, no `NOP` | pushed to 147, 58-60: line 147 black | pushed to 147, 56-61: line 147 black |

Clean on PAL is 59 of line 146 to 12 of line 147; on NTSC, 59 to 11.
Cycles 56 to 58 of line 146 were not measured. A wrong line 146 is its
last cells changing mode while they are still being drawn. The black
row is the badline stall: line 147 is row 12's badline, BA falls on cycle
12, and a store that has not written by then waits until the c-accesses
end. By then the line was fetched in bitmap mode: bitmap bytes from `$2F00`
(zero) coloured by the text matrix's `$A0` codes, whose low nibble, black,
is the colour of a 0 bit.

The poll leaves 0 to 6 cycles after `$D012` changes, depending on the
loop's phase against the line, and that phase depends on what the main
program was doing when the IRQ came. The landing points above are this
listing's, with `jmp *` as its main loop; the listing sits 6 (PAL) and 5
(NTSC) cycles from the nearest measured edge. Other main-loop code can move
the store anywhere in a 7-cycle span. Check a changed program with a store
trace on `$D011`, or put `stable_raster_irq` in front of the store.

## Why this works

### Two halves of `$D018`, two different times

The video-matrix bits (7 to 4) are read only by a badline's c-accesses,
which fill the 40-byte row buffer. Writing them on line 145, in the middle
of row 11, changes nothing on screen until line 147's badline fetches row
12 from `$0C00`. The character or bitmap base bits (3 to 1) are read on
every g-access, so they change the picture on the line the store lands on.
The two values share bit 3 on purpose: `$18` selects the bitmap at `$2000`
and `$3E` selects the character set at `$3800`. In bitmap mode only bit 3
of that field is used, so lines 145 and 146 keep reading the bitmap after
the store. That rules out the ROM character set, which the VIC sees in bank
0 at `$1000` and `$1800`, both with bit 3 clear: `$34` or `$36` would
switch the bitmap to `$0000` on line 145. The listing copies
the ROM's second set to `$3800`, inside bitmap rows 12 to 24, which the
bitmap never shows (`charset_copy_rom_to_ram`). `$3C` is the easy
mistake: its bits 3 to 1 are `110`, which is `$3000`, not `$1800`, and
every text line comes out blank (measured).

### One `$D011` store, placed between two lines

BMM decides how the VIC fetches and draws each 8-pixel cell. Clearing it
after line 146's last cell is drawn and before line 147's badline takes the
bus (BA on cycle 12, first fetch on 15) switches the mode for whole lines.
The IRQ fires on line 145 and polls `$D012` for 146 rather than 147, then
waits a fixed time, because on 147 itself the poll would leave too close to
cycle 12. `ldx` loads the value before the poll so that only the store is
left after it.

### Restoring the bitmap

The second IRQ, on line 252, below the display window, sets BMM and the
bitmap's matrix back for the next frame. Line 250 is too early: it is the
window's last line, and a store there on cycle 19 turned the right part of
that line into bitmap bytes (measured). Any line after 250 and before 51 of
the next frame works for `$D011`; `$D018`'s matrix bits must be back before
line 51's badline.
