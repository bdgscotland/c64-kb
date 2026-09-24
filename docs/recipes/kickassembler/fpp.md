---
recipe: fpp
toolchain: kickassembler
output_format: PRG
region: both
techniques: [fpp_flexible_pixel_position, linecrunch, stable_raster_irq, double_irq, badline_synchronization, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D019, D01A, D020, D021, DC0D, DD00]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_vic_bank (owns), zero_page $02-$06 (owns)]
ram: [state=$02E0, vic=$4000-$7FFF, scratch=$C000-$C1FF, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: FPP, any of eight pixel lines on every raster line, three ways

## Synopsis

A 128-line band (lines 59 to 186) in which each raster line shows one
pixel line picked by a `$D018` write on that line. Eight charsets hold
eight source lines, and a table repeats them, reverses them and moves them
one line per frame. The listing builds three ways of stopping the VIC from
moving on to the next pixel row, chosen with `:mode`. Mode 0, the
default, makes every band line a badline, so the row counter RC is 0 on
every line and the line shows pixel row 0; the VIC takes 40 cycles a
line. Mode 1 writes the linecrunch value on cycle 60 of every line, so RC
stays 7, no row is fetched and the line shows pixel row 7; no DMA. Mode 2
writes the same value on cycle 56, so each character row restarts from
pixel row 0 without a fetch (Bauer's doubled text lines): line L shows
pixel row (L − 59) & 7 of the charset named for it; no DMA. Pixel row r
of character c in charset k is the byte 32k + 4r + (c & 3), so every line
of the picture says where it came from. The technique is
`fpp_flexible_pixel_position` in `techniques/raster.md`.

## Source

```asm
// fpp.asm
// FPP (flexible pixel position): on each of 128 raster lines (59 to 186)
// the VIC shows one pixel line chosen by a $D018 write on that line, so the
// source lines can be repeated, reversed or skipped at will.
//
// Eight charsets sit at $4000 + $800k in VIC bank 1, screen at $4400. Every
// screen row holds characters 0-39, and pixel row r of character c in
// charset k is the byte 32k + 4r + (c & 3), so each displayed line says
// which charset and which pixel row it came from. pat[] is the source
// charset per band line: 0..7 each twice, then 7..0 each twice, moved one
// line per frame.
//
// :mode picks how the VIC is kept from moving on to the next pixel row:
//   0  every band line is made a badline: YSCROLL = line & 7 written
//      before cycle 12 of the line. RC is reset to 0 each line, so the line
//      shows pixel row 0 of the charset $D018 names. The VIC takes 40
//      cycles a line; the CPU has 20 (PAL) or 22 (NTSC).
//   1  YSCROLL = line & 7 written on cycle 60 of every line (the linecrunch
//      write): RC stays 7 and no character row is fetched, so every line
//      shows pixel row 7 of the pointers fetched on line 51. No DMA.
//   2  YSCROLL = line & 7 written on cycle 56 of every line (Bauer's
//      doubled text lines): at the end of each character row RC wraps to 0
//      with no fetch, so line L shows pixel row (L - 59) & 7. No DMA.
// Sweep knobs (measured in the page): :ep/:en move the mode 1/2 writes,
// :g the $D018 write, :late the first mode 0 YSCROLL write.

.const H      = 128             // band lines 59 .. 186
.const FLAG   = $02e0           // 0 = PAL, 1 = NTSC
.const frame  = $02
.const saved  = $03
.const ptr    = $04             // $04/$05
.const cnt    = $06
.const WAIT   = 43              // 5-cycle loop from line 48 past line 51's stall

.var MODE = cmdLineVars.containsKey("mode") ? cmdLineVars.get("mode").asNumber() : 0
// Pads and entry delays found with a store trace (the page lists them).
.var SPP = cmdLineVars.containsKey("spp") ? cmdLineVars.get("spp").asNumber() : 12
.var SPN = cmdLineVars.containsKey("spn") ? cmdLineVars.get("spn").asNumber() : 14
.var EP = cmdLineVars.containsKey("ep") ? cmdLineVars.get("ep").asNumber() : (MODE == 2 ? 36 : 40)
.var EN = cmdLineVars.containsKey("en") ? cmdLineVars.get("en").asNumber() : (MODE == 2 ? 44 : 48)
.var G = cmdLineVars.containsKey("g") ? cmdLineVars.get("g").asNumber() : 0
.var EBP = cmdLineVars.containsKey("ebp") ? cmdLineVars.get("ebp").asNumber() : 0
.var EBN = cmdLineVars.containsKey("ebn") ? cmdLineVars.get("ebn").asNumber() : 2
.var LATE = cmdLineVars.containsKey("late") ? cmdLineVars.get("late").asNumber() : 0
.const PADP   = 6               // mode 0 block: 14 cycles + pad = 20 (PAL)
.const PADN   = 8               // 22 (NTSC)

BasicUpstart2(start)

.macro Delay(c) {
    .if (c == 1) .error "Delay cannot make 1 cycle"
    .if (c > 0) {
        .if ((c & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((c & 1) != 0 ? c - 3 : c) / 2; i++) { nop }
    }
}

// Lines 53 .. 52+N, one iteration per line: $D011 from d11[], then $D018
// from d18[] for the next line. Entered at a fixed cycle of line 48.
.macro Lines(LINE, ENTRY, N) {
    ldy #WAIT                        // past line 51's badline
!:  dey
    bne !-
    ldx #0
    Delay(ENTRY)
!loop:
    lda d11, x          // 4
    sta $d011           // 4
    Delay(G)
    lda d18, x          // 4
    sta $d018           // 4
    inx                 // 2
    cpx #N              // 2
    beq !done+          // 2 (3 taken)
    Delay(LINE - 25 - G)
    jmp !loop-          // 3
!done:
}

// Mode 0: one block per band line from line 60. Each block is exactly the
// CPU's free cycles on a badline, so the stall holds every block at the
// same cycle. Block k writes the charset for line 60 + k, then YSCROLL for
// it, both before the line's cycle 12: a store trace puts them on cycles 2
// and 6 (PAL), 1 and 5 (NTSC).
.macro Blocks(pad, eb) {
    ldx #$18 | (60 & 7)
    Delay(eb)                        // straddles line 59's stall
    .for (var k = 0; k < H - 1; k++) {
        lda d18 + 6 + k
        sta $d018                    // charset for line 60 + k
        .if (k == 0) { Delay(LATE) }
        stx $d011                    // YSCROLL = (60 + k) & 7: a badline
        ldx #$18 | ((61 + k) & 7)
        Delay(pad)
    }
    stx $d011                        // YSCROLL 3 again: line 187 on
    lda #$10                         // charset 0 from line 188
    sta $d018
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region
    // Clear $4000-$7FFF.
    lda #0
    sta ptr
    lda #$40
    sta ptr + 1
    ldy #0
    tya
!:  sta (ptr), y
    iny
    bne !-
    inc ptr + 1
    ldx ptr + 1
    cpx #$80
    bne !-
    // Charsets k = 0..7 at $4000 + $800k, characters 0-39: pixel row r
    // of character c is 32k + 4r + (c & 3). Every line on the screen says
    // which charset and pixel row it came from.
    ldx #0                      // k
!k: txa
    asl
    asl
    asl
    clc
    adc #$40
    sta ptr + 1
    lda #0
    sta ptr
    txa
    asl
    asl
    asl
    asl
    asl
    sta cnt                     // 32k
    ldy #0
!b: tya                         // offset 8c + r: r = y & 7, c & 3 = (y >> 3) & 3
    and #7
    asl
    asl
    sta saved
    tya
    lsr
    lsr
    lsr
    and #3
    ora saved
    ora cnt
    sta (ptr), y
    iny
    bne !b-
    inc ptr + 1
!b: tya
    and #7
    asl
    asl
    sta saved
    tya
    lsr
    lsr
    lsr
    and #3
    ora saved
    ora cnt
    sta (ptr), y
    iny
    cpy #64                     // 320 bytes: characters 0-39
    bne !b-
    inx
    cpx #8
    bne !k-
    // Screen $4400: byte j = j mod 40 for j = 0..1023, so every row, and
    // the rows past 24 that VCBASE reaches in mode 1, holds 0..39.
    lda #0
    sta ptr
    lda #$44
    sta ptr + 1
    ldx #0
    ldy #0
!:  txa
    sta (ptr), y
    inx
    cpx #40
    bne !+
    ldx #0
!:  iny
    bne !--
    inc ptr + 1
    lda ptr + 1
    cmp #$48
    bne !--
    ldx #0
    lda #1
!:  sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $db00, x
    inx
    bne !-
    lda $dd00
    and #$fc
    ora #$02                    // VIC bank 1, $4000-$7FFF
    sta $dd00
    lda #$10                    // screen $4400, charset $4000
    sta $d018
    lda #6
    sta $d021
    lda #14
    sta $d020
    lda #0
    sta frame
    jsr fill
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
    sta $d011
    lda #46
    sta $d012
    lda #1
    sta $d01a
    sta $d019
    cli
main:
    inc $c000, x
    inc $c100, x
    inx
    jmp main

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

// irq1 (line 46) and irq2p/irq2n (line 48): the double IRQ of
// stable-raster-irq. The pads 12 (PAL) and 14 (NTSC) put every frame's
// writes on one cycle; neighbours alternate between two.
irq1:
    lda #$1b
    sta $d011
    ldx #<irq2p
    ldy #>irq2p
    lda FLAG
    beq !+
    ldx #<irq2n
    ldy #>irq2n
!:  stx $0314
    sty $0315
    lda #48
    sta $d012
    lda #1
    sta $d019
    tsx
    stx saved
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2p:
    ldx saved
    txs
    Delay(SPP)
    lda $d012
    cmp $d012
    beq !+
!:
    .if (MODE == 0) {
        Lines(63, EP, 6)
        Blocks(PADP, EBP)
    } else {
        Lines(63, EP, 6 + H)
    }
    jmp done
irq2n:
    ldx saved
    txs
    Delay(SPN)
    lda $d012
    cmp $d012
    beq !+
!:
    .if (MODE == 0) {
        Lines(65, EN, 6)
        Blocks(PADN, EBN)
    } else {
        Lines(65, EN, 6 + H)
    }
done:
    inc frame
    jsr fill
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #46
    sta $d012
    lda #1
    sta $d019
    jmp $ea81

// fill: d18[5 + y] = pat[(y + frame) & 255], y = 0 .. H-1
fill:
    ldx frame
    ldy #0
!:  lda pat, x
    sta d18 + 5, y
    inx
    iny
    cpy #H
    bne !-
    rts

.align $100
// d11[i]: written on line 53 + i.
d11:
    .if (MODE == 0) {
        .fill 6, $1b
    } else {
        .fill 5, $1b
        .fill H, $18 | ((58 + i) & 7)      // YSCROLL = line: crunch the next line
        .byte $18 | ((59 + H) & 7)         // line 59 + H is a badline again
    }
.align $100
// d18[i]: written on line 53 + i, for line 54 + i.
d18:
    .fill 5, $10
    .fill H, $10
    .fill 16, $10
.align $100
// pat: source line for each band line; a triangle of period 32: lines
// 0..7 each twice, then 7..0 each twice.
pat:
    .fill 256, $10 | (((mod(i, 32) < 16) ? (mod(i, 16) >> 1) : (7 - (mod(i, 16) >> 1))) << 1)
```

## Build

```bash
java -jar KickAss.jar fpp.asm -o fpp.prg                  # mode 0: a badline every line
java -jar KickAss.jar fpp.asm :mode=1 -o fpp-crunch.prg   # mode 1: RC held at 7
java -jar KickAss.jar fpp.asm :mode=2 -o fpp-restart.prg  # mode 2: rows restarted
```

The sweeps, one cycle per step (the default in brackets):

```bash
java -jar KickAss.jar fpp.asm :mode=1 :ep=N -o s.prg   # PAL YSCROLL write, N 32 to 45 [40: cycle 60]
java -jar KickAss.jar fpp.asm :mode=1 :en=N -o s.prg   # NTSC, N 40 to 55 [48: cycle 60]
java -jar KickAss.jar fpp.asm :mode=1 :g=N -o s.prg    # the $D018 write N cycles later [0]
java -jar KickAss.jar fpp.asm :late=N -o s.prg         # mode 0: the first band write N cycles later [0]
```

`-showmem` reports `$0900` to `$1CFF` for mode 0 (the 127 unrolled
blocks) and `$0900` to `$0EFF` for modes 1 and 2. The charsets and the
screen are built at start-up in `$4000`-`$7FFF`.

## Expected output

A light blue border and a blue background with white pixels. Lines 51 to
58 are screen row 0 drawn normally from charset 0 (pixel rows 0 to 7).
Lines 59 to 186 are the band: every line is one pixel line of the charset
`pat[]` names for it, so the band is a stack of stripes two lines high
whose pattern steps from charset 0 to 7 and back every 32 lines. Below
line 186 the display carries on without the effect; it is not modelled.

Measured in VICE x64sc 3.10 with the pinned command at 8,000,000 cycles,
PAL c64c (8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Each band line
was decoded with PIL (all 40 cells, white pixels to a byte, byte to
charset, pixel row and c & 3) and compared with the model "line 59 + y is
charset pat[y + f], pixel row R", f read from the picture:

| Build | Model | f | Pixel row R | Band lines matching | Lines 51-58: rows 0-7 of charset 0 |
|---|---|---|---|---|---|
| mode 0 | PAL | 13 | 0 | 128 of 128 | yes |
| mode 0 | NTSC | 10 | 0 | 128 of 128 | yes |
| mode 1 | PAL | 13 | 7 | 128 of 128 | yes |
| mode 1 | NTSC | 10 | 7 | 128 of 128 | yes |
| mode 2 | PAL | 13 | (L − 59) & 7 | 128 of 128 | yes |
| mode 2 | NTSC | 10 | (L − 59) & 7 | 128 of 128 | yes |

A store trace of `$D011` and `$D018` over each whole run put every band
write on one cycle after the first frame (store CYC as printed, Bauer's
numbering, `runtime/vice-reference.md`):

| Build | `$D011`, PAL / NTSC | `$D018`, PAL / NTSC |
|---|---|---|
| mode 0 | 6 / 5 of the line it makes a badline | 2 / 1 of the line it serves |
| mode 1 | 60 / 60 | 5 / 3 of the next line |
| mode 2 | 56 / 56 | 1 of the next line / 64 of the same line |

That is 29,988 band writes of each register on PAL (238 frames) and
33,642 on NTSC (267 frames). At 8,000,000 cycles the exit screenshot is
taken while the beam is outside the band; at 8,008,000 it lands inside
it, the lines above the beam belong to the next frame, and only 101 (PAL)
or 104 (NTSC) lines match one f. Screenshots: `screenshots/fpp.png` and
`screenshots/fpp-ntsc.png` (mode 0), and from the `@crunch` and
`@restart` runs `screenshots/fpp-crunch.png`, `fpp-crunch-ntsc.png`,
`fpp-restart.png` and `fpp-restart-ntsc.png`.

### The YSCROLL write cycle (modes 1 and 2)

`:ep` and `:en` move every write of the loop together. The cycle is the
store trace's for the write on line 100, the same on every frame; the row
is the pixel row decoded on lines 59 to 90.

| Write cycle | PAL | NTSC |
|---|---|---|
| 52, 53 on line 58 | No FPP: the write starts a late badline, which holds the CPU to cycle 54 and throws the loop off | The same |
| 54 to 57 | Rows 0 to 7 in turn: each row restarts (mode 2) | The same |
| 58 to 62 | Row 7 on every line: RC held (mode 1) | The same |
| 63, 64 | (63 is the line's last cycle) | Row 7 on every line |
| The line's last cycle (store CYC 0) | No FPP | No FPP |

The 58-to-last-but-one window is the one `linecrunch` measured; 54 to 57
is the doubled-text-line window of Bauer §3.14.5, measured here on both
models.

### The `$D018` write cycle

`:g` moves the `$D018` write of mode 1 later. On the lines where the
charset changes, the first cell drawn from the new charset:

| `$D018` write cycle | PAL | NTSC |
|---|---|---|
| 13 to 15 of the line | cell 0: the whole line | cell 0 |
| 16 | cell 1 | cell 1 |
| 17 | cell 2 | cell 2 |
| 18 | cell 3 | cell 3 |
| 19 | cell 4 | (not run) |

The charset for a line must be written by its cycle 15; a later write
splits the line at cell (cycle − 15).

### The badline write cycle (mode 0)

`:late` delays only the first band block's `$D011` write, the one that
makes line 60 a badline. Line 60, decoded, is the same on both models:

| `$D011` write cycle | Line 60 |
|---|---|
| up to 11 | All 40 cells pixel row 0: a full badline |
| 12 | Cell 0 blank, cells 1-39 row 0 |
| 13 | Cells 0-1 blank, cells 2-39 row 0 |
| 14 | Cells 0-2 blank, cells 3-39 pixel row 1: RC was not reset |
| 15 | Cell 0 row 1, cells 1-3 blank, the rest row 1 |
| 16 | Cells 0-1 row 1, cells 2-4 blank, the rest row 1 |

The blank cells are character `$FF`: in the three cycles after BA falls
the VIC does not yet have the bus and reads `$FF` as the pointer, the FLI
bug (Bauer §3.14.6). From cycle 14 on RC is not reset, so the line shows
pixel row 1, with the three `$FF` cells one cell further right for each
cycle later. A block entered late does not stay late: the stall pulls it
to a write on cycle 11, the last that works, and holds it there (`:ebp`
of 5 or more on PAL, `:ebn` of 8 or more on NTSC). The listing's entry
delays put the writes on 6 and 5 instead, found by store trace.

## Why this works

### What the VIC draws on a line

In display state the VIC draws each line from the character pointers
fetched on the last badline and, for each cell, the byte at charset + 8 ×
pointer + RC (Bauer §3.7.2). The charset is the one `$D018` names at that
cell's g-access. A line therefore shows pixel row RC of the charset
`$D018` names during the line. FPP is holding RC at a known value and
choosing the charset on each line.

### Three ways to hold RC

RC is reset to 0 in cycle 14 of a badline, and advances in cycle 58
unless the VIC goes idle there with RC = 7 (Bauer §3.7.2). Mode 0 makes
every line a badline: RC is 0 on every line, and the pointers are fetched
again each line from a VCBASE that never moves, because RC never reaches
7. Mode 1 writes a matching YSCROLL after cycle 58 of a line with RC = 7,
the linecrunch write: the VIC returns to display state with RC still 7
and no fetch, and so on every following line. VCBASE moves on 40 cells a
line, but no pointers are fetched, so every line keeps the pointers of
line 51. Mode 2 writes the same value in cycles 54 to 57: on a row's last
line RC wraps from 7 to 0 in cycle 58 with no fetch, so the row starts
again from pixel row 0; on the other lines the write changes nothing,
since the next line no longer matches.

### What each costs

Mode 0 costs the VIC's 40 cycles on every band line and leaves the CPU 20
(PAL) or 22 (NTSC). Each block is exactly that long, so the stall re-times
every block and only the first needs a set entry. It is the only mode in
which each line can also take new pointers: FLI does that with the
screen bits of `$D018`. Modes 1 and 2 take no DMA, but need a write on a
fixed cycle of every line, so the CPU is held by a 63- or 65-cycle loop
entered from a stable raster. Mode 1 shows one pixel row (7) of each
charset: eight source lines. Mode 2 shows every row in turn, and the
charset picks one of eight images per line: 64 source lines, with the row
set by the line.

### The timing

The double IRQ is the one in `stable-raster-irq`, set for line 48, so
that line 51's badline falls inside the wait loop after it rather than
in the per-line loop. Its pad is 12 on PAL and 14 on NTSC, measured: 11
and 13 (PAL), 13 and 15 (NTSC) let the writes alternate between two
cycles from frame to frame.

### Sources

- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64" (1996), §3.7.2, §3.14.3 "FLI", §3.14.4
  "Linecrunch", §3.14.5 "Doubled text lines", §3.14.6 "DMA delay":
  https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
- Codebase64, "Introduction to Vertical Tweaks" (the ways to repeat a
  line, named there "repeating the last line", "repeating char-line",
  "every line is a badline" and "repeating the first line") and
  "Flexible Pixel Position (FPP)":
  https://codebase64.c64.org/doku.php?id=base:introduction_to_vertical_tweaks,
  https://codebase64.c64.org/doku.php?id=base:fpp
