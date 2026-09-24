---
recipe: kefrens-bars
toolchain: kickassembler
output_format: PRG
region: both
techniques: [kefrens_bars, badline_synchronization, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, D022, DC0D, DD04, DD05, DD0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), vic_char_base (owns), zero_page $02-$04 (owns)]
harness: [cia2_timer_a, $02F0-$02FF]
ram: [state=$02E0, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: Kefrens bars, one pixel line re-shown on 129 raster lines while the CPU stamps a bar into it each line

## Synopsis

Makes raster lines 51 to 179 all badlines, so the VIC resets its row
counter on every one of them and never advances its row base: all 129
lines show pixel row 0 of text row 0, the same 40 bytes. Those bytes are
row 0 of characters 0 to 39 in a RAM charset at `$2000`, one byte every
eight: the line buffer. Between two lines' badline stalls the CPU has 20
cycles on PAL and 22 on NTSC. One unrolled block per line uses exactly
that: it writes the next line's YSCROLL, stamps one multicolour bar byte
into the buffer at the column the sine tables give for that line, and
loads the next YSCROLL. Nothing clears the buffer inside the band, so
each line shows every bar stamped above it and the bars trail down: the
Kefrens pattern. The badline stall re-aligns the CPU every line, so the
band needs no stable raster. CIA2 timer A times the 128 blocks; text row
2 shows the reading and `$02FF` reads `01` while every frame took exactly
128 lines. Built with `:proof=1` the buffer holds one fixed byte and
nothing changes it, which shows the re-shown line alone. Built with
`:padp=N` or `:padn=N` the block length is N + 15 cycles: the sweep. The
technique is `kefrens_bars` in `techniques/raster.md`.

## Source

```asm
// kefrens-bars.asm
// Kefrens bars: one displayed pixel line re-shown on 129 raster lines
// (51 to 179) while the CPU stamps one bar into it per line, so each line shows every
// bar drawn above it and the bars trail down the band.
//
// The VIC resets its row counter RC to 0 in cycle 14 of a line only when
// the badline condition ((line & 7) == YSCROLL) holds there, and advances
// its row base VCBASE only in cycle 58 of a line on which RC is 7. Here
// every band line is made a badline, so RC is 0 on every one of them and
// never reaches 7: the VIC shows pixel row 0 of screen row 0 on all 129
// lines, and it re-reads screen row 0 and the character data on each.
// Screen row 0 holds characters 0 to 39, so the bytes the VIC shows are
// row 0 of those 40 characters: $2000 + 8c. That is the line buffer.
//
// Each band line has one unrolled block. After the line's badline stall
// (cycles 12 to 54) the CPU has 20 cycles on PAL, 22 on NTSC, before the
// next stall. A block is exactly that long: it writes YSCROLL for the next
// line into $D011, stamps the bar byte at its column, loads the next
// YSCROLL value and pads. The stall re-aligns the CPU to the raster every
// line, so the blocks need no stable raster: only the entry into block 0
// has to straddle line 51's stall.
//
// CIA2 timer A times blocks 0 to 127; the reading is shown on text row 2
// and kept in $02F0/$02F1. $02FF is $01 while every frame's reading has
// equalled BAND_PAL or BAND_NTSC and $02 from the first that did not.

.const H         = 128          // blocks; block k runs after line 51+k's stall
.const ROW0      = $2000        // charset; pixel row 0 of character c is ROW0 + 8c
.const COL0      = 4            // leftmost bar column; Y = 8 * (column - COL0) <= 248
.var proof = cmdLineVars.containsKey("proof") ? cmdLineVars.get("proof").asNumber() : 0
// :proof=1 fills the line buffer with FILL and stamps FILL, so the band
// should show one unchanging line: the test of the re-shown line.
.const FILL      = proof != 0 ? %11110000 : 0
.const BAR       = proof != 0 ? FILL : %01111101  // multicolour: $D022, cram, cram, $D022
.const FLAG      = $02e0        // 0 = PAL, 1 = NTSC
.const ELAPSED   = $02f0        // lo, hi
.const RESULT    = $02ff
.const BAND_PAL  = H * 63 - 2   // 128 lines less the timer's 2-cycle
.const BAND_NTSC = H * 65 - 2   // start/stop overhead, measured in VICE
.const frame     = $02
.const tmp       = $03
.const tmp2      = $04

.var padP = cmdLineVars.containsKey("padp") ? cmdLineVars.get("padp").asNumber() : 5
.var padN = cmdLineVars.containsKey("padn") ? cmdLineVars.get("padn").asNumber() : 7

.macro Delay(n) {
    .if (n == 1) .error "Delay cannot make 1 cycle"
    .if (n > 0) {
        .if ((n & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
    }
}

// One band. Block 0 also starts CIA2 timer A (Y = %00010001 on entry) and
// is one cycle longer than the rest (21/23, both measured to hold). After
// the last block the timer is stopped with A = 0 before anything else.
.macro Band(pad) {
    .for (var k = 0; k < H; k++) {
        stx $d011                    // YSCROLL for line 52 + k
        .if (k == 0) { sty $dd0e }   // start the band timer
        ldy pos + k
        sta ROW0 + 8 * COL0, y       // stamp the bar into the line buffer
        ldx #$18 | ((53 + k) & 7)    // text mode, DEN, 25 rows
        .if (k == 0) { Delay(max(pad - 3, 2)) } else { Delay(pad) }
    }
    lda #0
    sta $dd0e
}

BasicUpstart2(start)

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region

    // Hex glyphs: ROM characters 0-9 and A-F copied to codes 64-79.
    lda #$33
    sta $01
    ldx #0
!:  lda $d000 + 48 * 8, x        // "0".."9"
    sta ROW0 + 64 * 8, x
    lda $d000 + 1 * 8, x         // "A".."F"
    sta ROW0 + 74 * 8, x
    inx
    cpx #80
    bne !-
    lda #$37
    sta $01

    // Screen: row 0 is characters 0..39, everything else the blank 255.
    ldx #0
!:  lda #255
    sta $0400, x
    sta $0500, x
    sta $0600, x
    sta $06e8, x
    lda #1                       // white, hires, for the readout
    sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-
    ldx #39
!:  txa
    sta $0400, x
    lda #$0f                     // multicolour, colour 7 (yellow)
    sta $d800, x
    dex
    bpl !-

    lda #$18                     // screen $0400, charset $2000
    sta $d018
    lda #$d8                     // multicolour on, 40 columns
    sta $d016
    lda #11
    sta $d020
    lda #0
    sta $d021
    lda #8                       // orange
    sta $d022
    lda #1
    sta RESULT
    lda #0
    sta frame
    jsr build

    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #$1b
    sta $d011
    lda #44
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// detect_region: FLAG = 0 (PAL) or 1 (NTSC), as in tech-tech.
detect_region:
!wlo:
    bit $d011
    bmi !wlo-
!whi:
    bit $d011
    bpl !whi-
!track:
    lda $d012
    bit $d011
    bpl !over+
    tax
    jmp !track-
!over:
    lda #0
    cpx #$10
    bcs !+
    lda #1
!:  sta FLAG
    rts

// build: pos[k] = 8 * column offset, from two sines moving at different
// rates: sa[(2k + 3f) & 255] + sb[(3k - 2f) & 255], 0..248. Unrolled over
// tables repeated past 256 entries, so no index wraps inside the loop.
build:
    lda frame
    asl
    clc
    adc frame
    tax                          // 3f
    lda frame
    asl
    eor #$ff
    clc
    adc #1
    tay                          // -2f
    clc                          // no sum exceeds 248: carry stays clear
    .for (var k = 0; k < H; k++) {
        lda sa2 + 2 * k, x
        adc sb2 + 3 * k, y
        sta pos + k
    }
    rts

// X = byte, Y = column on text row 2.
put_hex:
    stx tmp
    txa
    lsr
    lsr
    lsr
    lsr
    ora #64
    sta $0450, y
    lda tmp
    and #15
    ora #64
    sta $0451, y
    rts

irq:
    lda #$1b                     // YSCROLL 3: line 51 is the first badline
    sta $d011
    lda #FILL                    // empty line buffer
    .for (var c = COL0; c < COL0 + 32; c++) { sta ROW0 + 8 * c }
    lda #$ff
    sta $dd04
    sta $dd05
    lda FLAG
    beq !+
    jmp irq_ntsc
!:
    ldx #$1c                     // YSCROLL 4 for line 52
    ldy #%00010001               // timer: force load, start
    lda #51
!:  cmp $d012
    bne !-
    lda #BAR
    Delay(10)                    // straddles cycle 12 of line 51: held to 55
    Band(padP)
    lda #<BAND_PAL
    ldx #>BAND_PAL
    jmp irq_done
irq_ntsc:
    ldx #$1c
    ldy #%00010001
    lda #51
!:  cmp $d012
    bne !-
    lda #BAR
    Delay(10)
    Band(padN)
    lda #<BAND_NTSC
    ldx #>BAND_NTSC
irq_done:
    // Elapsed = $FFFF - timer (the timer is stopped); compare with A/X.
    sta tmp
    stx tmp2
    lda $dd04
    eor #$ff
    sta ELAPSED
    lda $dd05
    eor #$ff
    sta ELAPSED + 1
    lda ELAPSED
    cmp tmp
    bne !bad+
    lda ELAPSED + 1
    cmp tmp2
    beq !ok+
!bad:
    lda #2
    sta RESULT
!ok:
    ldx ELAPSED + 1
    ldy #0
    jsr put_hex
    ldx ELAPSED
    ldy #2
    jsr put_hex
    ldx RESULT
    ldy #5
    jsr put_hex

    inc frame
    jsr build
    lda #$01
    sta $d019
    jmp $ea81

// Characters 0..39: row 0 is the line buffer (cleared each frame), rows
// 1..7 are %01010101, orange. The band never shows rows 1..7; the seven
// lines under it do.
* = ROW0
.for (var c = 0; c < 40; c++) {
    .byte FILL, $55, $55, $55, $55, $55, $55, $55
}
* = ROW0 + 8 * 255
    .fill 8, 0

* = $2800
sa2:
    .fill 512, 8 * round(8 + 8 * sin(toRadians(i * 360 / 256)))
sb2:
    .fill 640, 8 * round(7.5 + 7.5 * sin(toRadians(i * 360 / 256)))
pos:
    .fill H, 0
```

## Build

```bash
java -jar KickAss.jar kefrens-bars.asm -o kefrens-bars.prg
```

The re-shown line without the bars:

```bash
java -jar KickAss.jar kefrens-bars.asm :proof=1 -o kefrens-bars-proof.prg
```

The block-length sweep, N from 4 to 8 on PAL and 6 to 10 on NTSC:

```bash
java -jar KickAss.jar kefrens-bars.asm :proof=1 :padp=N -o kefrens-bars-pN.prg
java -jar KickAss.jar kefrens-bars.asm :proof=1 :padn=N -o kefrens-bars-nN.prg
```

`-showmem` reports the code at `$0900` to `$1DE2` (5,347 bytes, almost
all of it the two unrolled bands and the unrolled table build), the
charset at `$2000` to `$213F` and `$27F8` to `$27FF`, and the sine and
position tables at `$2800` to `$2CFF`. The PRG is 9,473 bytes.

## Expected output

A black display window in a dark grey border. From raster line 51 down,
yellow bars with orange edges, each 8 pixels wide, fill in from the top:
each line has every bar of the lines above it and one more, so the bars
trail down and the band ends on line 179 wider than it began. Under it
seven solid orange lines (rows 1 to 7 of the characters, which the band
never shows), then black. Text row 2 reads `1F7E 01` on PAL and
`207E 01` on NTSC.

Measured in VICE x64sc 3.10 with the pinned command at 8,000,000 cycles,
PAL c64c (8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Every one of
the 129 band lines was decoded as 40 multicolour cells with PIL and
compared with the listing's tables: line 51 + j shows the bar byte
(`%01111101`: orange, yellow, yellow, orange) at the columns of
pos[0] to pos[j - d] and black in every other cell, where d is the bar's
lag (below). Every line matched for exactly one frame value, and no cell
held anything else:

| Model | Frame value matched | Lag d | First bar on line | Columns lit on line 179 | Non-black pixels, lines 51-179 | Text row 2 |
|---|---|---|---|---|---|---|
| PAL | 253 | 2 | 53 | 12 to 34 | 17,840 | `1F7E 01` |
| NTSC | 29 | 1 | 52 | 9 to 35 | 11,400 | `207E 01` |

Lines 180 to 186 are the orange `%01010101` of rows 1 to 7 across all 32
bar columns, and line 187 onward is black. `$1F7E` is 8,062 = 128 × 63 −
2 and `$207E` is 8,318 = 128 × 65 − 2: the 128 blocks took exactly 128
raster lines, the 2 being the timer's start and stop stores. A store
trace of `$02F0`-`$02F1` and `$02FF` over the whole run saw the same
reading on all 254 PAL and 286 NTSC frames and never a `02`.

Screenshots from these runs: `screenshots/kefrens-bars.png` (PAL) and
`screenshots/kefrens-bars-ntsc.png`.

### The lag

A store trace of `$D011` and `$2000`-`$21FF` over the pinned run (VICE
monitor; a store's CYC is Bauer's cycle, `runtime/vice-reference.md`)
shows, for the frame in the picture, one `$D011` write and one bar store
per line, 128 of each:

| Model | `$D011` write for line L | Bar store of block k |
|---|---|---|
| PAL | cycle 4 of line L (the first, 3) | cycle 56 of line 52 + k, after that line's stall, so it shows from line 53 + k |
| NTSC | cycle 63 of line L − 1 (the first, 62) | cycle 7 of line 52 + k, before that line's stall, so it shows on line 52 + k |

Over all 254 PAL frames of the run the writes landed on cycles 3 to 6,
and over all 286 NTSC frames on cycles 62 to 64 of the line before or 3
to 4 of the line itself. Where in its window the block settles depends on
the cycle the entry poll left line 51 on, so it moves by a few cycles
from frame to frame. The bar store moves with it, and on PAL it can fall
on either side of the stall: a bar shows one line after its block in some
frames and two in others. The pattern does not change; the pinned PAL
frame has lag 2.

### The re-shown line without bars

`:proof=1` fills row 0 of the 40 characters with `%11110000` and stamps
the same byte, so the band can show only that byte or whatever a missed
badline leaves. PAL and NTSC, 8,000,000 cycles: every line from 51 to 179
is yellow, yellow, black, black in all 40 cells; lines 180 to 186 are
orange; 187 on is black. Row 0 on 129 lines means RC was 0 on each, and
the same 40 cells on each means VCBASE never moved. In a test build that
left the band out, the same row showed its eight pixel rows on lines 51
to 58 and row 1 began on line 59.

### The block-length sweep

`:padp=N` / `:padn=N` pads each block after block 0 with N cycles, so a
block is N + 15. `:proof=1`, one run each at 8,000,000 cycles for the
picture and 4,000,000 for the trace; the write cycle is where the `$D011`
writes settled in the traced frame:

| Model | Block, cycles | `$D011` write | Picture |
|---|---|---|---|
| PAL | 19 | anywhere from 0 to 62; two to four writes in some lines | Breaks every 20 lines: three orange lines (RC advanced), one line missing its first two cells, then the re-shown line again |
| PAL | 20 (the listing) | 4 to 5 | Lines 51-179 all the re-shown line |
| PAL | 21 | 12 from line 58 on | Cell 0 black from line 58: one cell without a fetch |
| PAL | 22 | 13 | Cell 0 black on line 56, cells 0 and 1 from line 57 |
| PAL | 23 | 14 | RC not reset: lines 56-62 show rows 1-7 (orange) with three black cells, then black lines and broken cells; the band is gone |
| NTSC | 21 | anywhere; two or three writes in some lines | Breaks every 22 lines |
| NTSC | 22 (the listing) | 3 to 4 | Lines 51-179 all the re-shown line |
| NTSC | 23 | 3 in the traced frame | Cell 0 black from line 60 in the pictured frame |
| NTSC | 24 | 13 | Cell 0 black on line 59, cells 0 and 1 from line 60 |
| NTSC | 25 | 14 | RC not reset, as PAL 23 |

A block shorter than the free cycles fits twice into some windows. The
second write names the line after next before the current line reaches
cycle 12, so the current line is no badline. A longer block drifts later
by its excess every line until its write meets the stall. At cycle 12 or
13 the badline still starts, late: the VIC skips the first one or two
c-accesses, the mechanism of `vsp_glitch` and of the FLI bug. At 14 it is
too late for the row-counter reset. On NTSC a 23-cycle block settled
early in one frame and late in another; only the exact length held in
every frame traced. In a test build with a different instruction order a
21-cycle PAL block settled on cycle 3 and held the line, so where a
too-long block settles depends on the order of its instructions as well
as its length.

## Why this works

### Every line a badline

The row counter RC is reset to 0 in cycle 14 only when the badline
condition holds there, and the row base VCBASE takes the video counter
only in cycle 58 of a line on which RC is 7 (Bauer, "The MOS 6567/6569
video controller (VIC-II)", §3.7.2, rules 2 and 5). Making every line a
badline pins both: RC starts every line at 0 and is 1 after cycle 58,
never 7, so VCBASE stays at row 0 for the whole band. The VIC fetches the
40 screen codes again on every line (the c-accesses, cycles 15 to 54)
and draws pixel row 0 of each character. Screen row 0 holds codes 0 to
39, so what it draws for column c is the byte at `$2000 + 8c`. The CPU
writes those bytes and the following lines show them. On line L the
block writes `(L + 1) & 7` into YSCROLL after the line's stall, so the
condition is true for line L + 1 from its first cycle.

### The CPU budget

A badline holds the CPU from cycle 12 to 54; the first free read is on
55 (`runtime/vice-reference.md`, "What the CYC column counts"). A
63-cycle line leaves 20 cycles and a 65-cycle line 22. The block is
`stx $d011` (4), `ldy pos + k` (4), `sta $2020,y` (5), `ldx #` (2) and
padding (5 PAL, 7 NTSC). The CIA reading, 128 lines of 63 or 65 cycles
less two, is the frame-timing check that each block took exactly one
line. The stall holds every block in place, so the effect needs no
stable raster, but the block length must be exact (the sweep above).

### What does not fit

One byte a line is the whole bar: `sta abs,y` places it on a character
column, 8 pixels at a time, and the bar is the same byte everywhere. A
bar placed to the pixel needs two or three bytes a line from pre-shifted
tables, which does not fit in 20 cycles beside the `$D011` write; not
built here. Y reaches 256 bytes of the buffer, 32 of the 40 columns
(4 to 35 here). The sines for the next frame are rebuilt after the band,
unrolled over tables repeated past 256 entries so no index has to wrap;
the handler acknowledges its interrupt on line 209 to 214 on both models.
