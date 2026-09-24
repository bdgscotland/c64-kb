---
recipe: tech-tech
toolchain: kickassembler
output_format: PRG
region: both
techniques: [tech_tech_wobbler, stable_raster_irq, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler recipe: a tech-tech, a character logo on a 63-pixel per-line sine through eight video matrices and XSCROLL

## Synopsis

Puts the word WOBBLE, drawn in 3 by 5 block cells with a rule under it,
into eight 1 KB video matrices at `$2000` to `$3FFF`, each holding the
logo one cell further right than the last, and shows character rows 8 to
13 (raster lines 115 to 162) with a different horizontal shift on every
line. The shift s for a line is 32 + round(31 sin) from a 256-entry
table, 1 to 63; s >> 3 picks the matrix through `$D018` and s & 7 goes
into XSCROLL. Because the VIC-II reads character codes only on a badline,
the code forces one on every line of the band the way FLI does: a stable
raster IRQ reaches a known cycle, and from there one unrolled block per
line writes `$D018`, `$D016` and then `$D011` with YSCROLL = line & 7,
timed so the badline condition arises after the cycle-14 row counter
check and before the c-accesses. The VIC then fetches the 40 codes again
on that line from the matrix just named. The first three cells of each
forced line get no fetch and show screen code 255 (the FLI bug), so the
logo lives in cells 3 to 39. The two register tables for the band are
rebuilt in the vertical blank each frame with the phase advanced by one;
after 300 frames the phase stops and the picture is static. CIA1 timer A
measures the band interrupt and timer B the table build. Built with
`:seven=1` the `$D018` table is a constant, so XSCROLL alone moves the
logo: the seven-pixel control. Built with `:pad=N` the per-line padding
is N instead of 3: the sweep. The technique is `tech_tech_wobbler` in
`techniques/effects-vector-3d.md`.

## Source

```asm
// tech-tech.asm
// A tech-tech: a character logo pushed sideways by a per-line sine of up
// to 63 pixels, which is eight character cells more than XSCROLL alone can
// move it. The VIC-II reads character codes (the c-accesses) only on a
// badline, into a 40-entry buffer it reuses for the next seven lines, so a
// text row cannot normally change its codes line by line. This program
// forces a badline on every line of the logo band the FLI way: on each
// line it writes YSCROLL = line & 7 into $D011 after cycle 14, so the row
// counter is not reset and rows still advance, and before the c-accesses,
// so the VIC fetches the 40 codes again on that line from whichever video
// matrix $D018 names at that moment. Eight matrices hold the same logo
// shifted right by 0 to 7 cells; the line's shift s in 0..63 selects the
// matrix s >> 3 and puts s & 7 into XSCROLL. The first three cells of each
// forced line keep no fetch (the FLI bug), so the logo lives in cells
// 3 to 39 and the strip at the left is measured on the page.
//
// The eight matrices sit at $2000 + k * $400, k = 0..7, in VIC bank 0.
// They cannot sit at $0400 + k * $400: the VIC sees the character ROM,
// not RAM, at $1000-$1FFF of banks 0 and 2, for every kind of access.
//
// Region: both. Separate unrolled bands for PAL (63-cycle line) and NTSC
// (65-cycle line), chosen at boot by detect_region. The per-line padding
// is a command line variable for the sweep: :pad=N sets the PAL block
// padding, the NTSC block gets two more. Default 3, the measured value.
// :seven=1 builds the control that keeps $D018 fixed and moves the logo
// with XSCROLL only.

.const D011 = $d011
.const D012 = $d012
.const D016 = $d016
.const D018 = $d018
.const D019 = $d019
.const D01A = $d01a
.const D020 = $d020
.const D021 = $d021
.const CIA_TALO = $dc04
.const CIA_TAHI = $dc05
.const CIA_TBLO = $dc06
.const CIA_TBHI = $dc07
.const CIA_CRA  = $dc0e
.const CIA_CRB  = $dc0f

// Band geometry: character rows 8 to 13, raster lines 115 to 162.
.const FIRST_LINE = 115           // row 8, line 0: a natural badline (115 & 7 = 3)
.const LAST_LINE  = 162           // row 13, line 7
.const NLINES     = LAST_LINE - FIRST_LINE + 1   // 48
.const SYNC_LINE  = 112           // stable raster here; 112 & 7 = 0, not a badline
.const SYNC_PAD   = 11            // as measured for stable-raster-irq and fli-image

// Padding, measured in VICE (see page). The block for line l is
// Delay(LINE_PAD) + 20 cycles of writes; its $D011 write is the block's
// last cycle. With LINE_PAD 3 the block is 23 cycles from the end of the
// previous line's stall, the same 23 as fli-image's LINE_PAD 11 + 12.
.var padVar = cmdLineVars.get("pad")
.const LINE_PAD_PAL  = (padVar == null) ? 3 : padVar.asNumber()
.const LINE_PAD_NTSC = LINE_PAD_PAL + 2
.var sevenVar = cmdLineVars.get("seven")
.const SEVENONLY = (sevenVar != null)

// From the sync point to cycle 55 of FIRST_LINE, after its natural
// badline stall: fli-image's 197 (PAL) and 204 (NTSC), less the 14
// cycles of line 115's own two writes placed before the delay. Measured:
// 205 - 14 on NTSC put line 116's write one cycle late (four cells lost).
.const ENTRY_PAD_PAL  = 197 - 14
.const ENTRY_PAD_NTSC = 204 - 14

.const MATRIX0   = $2000          // matrix k at MATRIX0 + k * $400
.const D016_BASE = $c8            // 40 columns, hires, XSCROLL 0
.function d018k(k) { .return ((8 + k) << 4) | $04 }   // VM = 8 + k, CB = 2: ROM font at $1000
.function d011l(l) { .return $18 | (l & 7) }          // text mode, DEN, RSEL, YSCROLL = l & 7

// Per-line register tables, rebuilt each frame in the vertical blank.
// Both in zero page so a block's loads take 3 cycles each.
.const D016_ZP = $02              // 48 bytes: $D016 value per band line
.const D018_ZP = $32              // 48 bytes: $D018 value per band line
.const ZP_PH   = $fb              // sine phase while building

.const SAVED_SP = $02e0
.const REG_FLAG = $02e1           // 0 = PAL, 1 = NTSC
.const FRAME_LO = $02e2           // frames advanced
.const FRAME_HI = $02e3
.const T        = $02e4           // wave phase, +1 a frame until DONE
.const BAND_LO  = $02e6           // CIA1 timer A: irq1 entry to band exit, last frame
.const BAND_HI  = $02e7
.const TAB_LO   = $02e8           // CIA1 timer B: one table build, last frame
.const TAB_HI   = $02e9
.const DONE     = $02ff           // 1 once 300 frames have advanced

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// ---------------------------------------------------------------------------
// The logo: the word WOBBLE in 3 by 5 block letters with one blank cell
// between letters, 23 cells wide, and a 23-cell rule under it as row 6.
// Cell $A0 is the reversed space, a solid block in the cell's colour.
// ---------------------------------------------------------------------------
.const WORD = "WOBBLE"
.const LOGO_W = 23
.var font = Hashtable()
.eval font.put("W", List().add("X.X", "X.X", "X.X", "XXX", "X.X"))
.eval font.put("O", List().add("XXX", "X.X", "X.X", "X.X", "XXX"))
.eval font.put("B", List().add("XX.", "X.X", "XX.", "X.X", "XX."))
.eval font.put("L", List().add("X..", "X..", "X..", "X..", "XXX"))
.eval font.put("E", List().add("XXX", "X..", "XX.", "X..", "XXX"))

.function logoCell(r, c) {
    .if (r == 5) .return $a0
    .var lc = mod(c, 4)
    .if (lc == 3) .return $20
    .var glyph = font.get(WORD.substring(floor(c / 4), floor(c / 4) + 1))
    .return (glyph.get(r).charAt(lc) == 'X') ? $a0 : $20
}

// Matrix k, cell i: the logo in rows 8..13 from column 3 + k.
.function matrixCell(k, i) {
    .var r = floor(i / 40)
    .var c = mod(i, 40) - 3 - k
    .if (r < 8 || r > 13 || c < 0 || c >= LOGO_W) .return $20
    .return logoCell(r - 8, c)
}

.for (var k = 0; k < 8; k++) {
    * = MATRIX0 + k * $400
    .fill 1000, matrixCell(k, i)
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
* = $1c00
// s(i) = 32 + round(31 sin(2 pi i / 256)), 1..63. Amplitude 31 so that no
// entry reaches 64 (pitfalls/maths.md, sine_table_peak_wraps_to_zero).
sine:   .fill 256, 32 + round(31 * sin(toRadians(i * 360 / 256)))
// s -> register values, s in 0..63.
s2d018: .fill 64, SEVENONLY ? d018k(4) : d018k(i >> 3)
s2d016: .fill 64, D016_BASE | (i & 7)

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
BasicUpstart2(start)

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    sta $dd0d
    lda $dd0d

    lda #0
    sta D020
    sta D021
    sta FRAME_LO
    sta FRAME_HI
    sta T
    sta DONE
    lda #1                    // colour RAM white everywhere
    ldx #0
!:  sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-

    lda #D016_BASE
    sta D016
    lda #d018k(0)
    sta D018
    lda #$1b
    sta D011

    jsr detect_region         // returns with interrupts enabled
    sei
    jsr build_tables

    lda #<vblank_irq
    sta $0314
    lda #>vblank_irq
    sta $0315
    lda #251
    sta D012
    lda #$01
    sta D01A
    sta D019
    cli
    jmp *

// detect_region: REG_FLAG = 0 (PAL) or 1 (NTSC), as in pseudo-3d-road.
// Tracks $D012 while RST8 is set; the last value is $37 on PAL, $06 or $05
// on NTSC. Call with SEI; returns with CLI.
detect_region:
    sei
dr_wait_lo:
    bit D011
    bmi dr_wait_lo
dr_wait_hi:
    bit D011
    bpl dr_wait_hi
dr_track:
    lda D012
    bit D011
    bpl dr_band_over
    tax
    jmp dr_track
dr_band_over:
    lda #0
    cpx #$10
    bcs dr_set_flag
    lda #1
dr_set_flag:
    sta REG_FLAG
    cli
    rts

// build_tables: for band line l = 0..47, s = sine[(T + 3 l) & 255],
// D018_ZP[l] = s2d018[s], D016_ZP[l] = s2d016[s].
build_tables:
    lda T
    sta ZP_PH
    ldx #0
bt_lp:
    ldy ZP_PH
    lda sine, y
    tay
    lda s2d018, y
    sta D018_ZP, x
    lda s2d016, y
    sta D016_ZP, x
    lda ZP_PH
    clc
    adc #3
    sta ZP_PH
    inx
    cpx #NLINES
    bne bt_lp
    rts

// ---------------------------------------------------------------------------
// vblank_irq, line 251: build next frame's tables (timed), count the frame,
// arm irq1 for the band.
// ---------------------------------------------------------------------------
vblank_irq:
    cld
    lda #$ff
    sta CIA_TBLO
    sta CIA_TBHI
    lda #$11
    sta CIA_CRB
    jsr build_tables
    lda #0
    sta CIA_CRB
    sec
    lda #$ff
    sbc CIA_TBLO
    sta TAB_LO
    lda #$ff
    sbc CIA_TBHI
    sta TAB_HI

    lda DONE
    bne vb_arm
    inc T
    inc FRAME_LO
    bne !+
    inc FRAME_HI
!:  lda FRAME_LO
    cmp #<300
    bne vb_arm
    lda FRAME_HI
    cmp #>300
    bne vb_arm
    lda #1
    sta DONE                  // T stays at 300 from here: the picture is static
vb_arm:
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #SYNC_LINE - 3
    sta D012
    lda #$1b
    sta D011
    lda #$01
    sta D019
    pla
    tay
    pla
    tax
    pla
    rti

// ---------------------------------------------------------------------------
// Double IRQ, as in stable-raster-irq and fli-image. irq1 at SYNC_LINE - 3
// starts the band timer, picks the band for the model and arms irq2 at
// SYNC_LINE - 1; irq2 fires inside the NOP slide and returns through
// irq1's stack frame.
// ---------------------------------------------------------------------------
irq1:
    cld                       // irq2 fires inside this handler and inherits D clear
    lda #$ff
    sta CIA_TALO
    sta CIA_TAHI
    lda #$11
    sta CIA_CRA
    lda REG_FLAG
    bne i1_ntsc
    lda #<irq2_pal
    sta $0314
    lda #>irq2_pal
    sta $0315
    jmp i1_common
i1_ntsc:
    lda #<irq2_ntsc
    sta $0314
    lda #>irq2_ntsc
    sta $0315
i1_common:
    lda #SYNC_LINE - 1
    sta D012
    lda #$01
    sta D019
    tsx
    stx SAVED_SP
    cli
    .for (var i = 0; i < 40; i++) { nop }
    pla
    tay
    pla
    tax
    pla
    rti

// One band: sync, line 115's own registers before its natural badline, the
// entry delay to cycle 55 of line 115, then one block per line 116..162.
// Each block starts on cycle 55 of the previous line, where the stall
// leaves the CPU, and its $D011 write is its last cycle: LINE_PAD + 20.
.macro Band(entryPad, linePad) {
    lda D018_ZP + 0           // 3   line 115: matrix and XSCROLL for its natural fetch
    sta D018                  // 4
    lda D016_ZP + 0           // 3
    sta D016                  // 4
    Delay(entryPad)
    .for (var l = 1; l < NLINES; l++) {
        Delay(linePad)
        lda D018_ZP + l       // 3
        sta D018              // 4
        lda D016_ZP + l       // 3
        sta D016              // 4
        lda #d011l(FIRST_LINE + l)   // 2
        sta D011              // 4   forces this line's badline
    }
}

irq2_pal:
    ldx SAVED_SP
    txs
    Delay(SYNC_PAD)
    lda D012
    cmp D012
    beq !+
!:  Band(ENTRY_PAD_PAL, LINE_PAD_PAL)
    jmp band_done

irq2_ntsc:
    ldx SAVED_SP
    txs
    Delay(SYNC_PAD)
    lda D012
    cmp D012
    beq !+
!:  Band(ENTRY_PAD_NTSC, LINE_PAD_NTSC)

// band_done: cycle 55 of LAST_LINE. Normal registers back so line 163 is
// a natural badline from matrix 0; stop the timer; arm the vertical blank.
band_done:
    lda #$1b
    sta D011
    lda #d018k(0)
    sta D018
    lda #D016_BASE
    sta D016
    lda #0
    sta CIA_CRA
    cld
    sec
    lda #$ff
    sbc CIA_TALO
    sta BAND_LO
    lda #$ff
    sbc CIA_TAHI
    sta BAND_HI
    lda #<vblank_irq
    sta $0314
    lda #>vblank_irq
    sta $0315
    lda #251
    sta D012
    lda #$01
    sta D019
    pla
    tay
    pla
    tax
    pla
    rti
```

## Build

```bash
java -jar KickAss.jar tech-tech.asm -o tech-tech.prg
```

For the seven-pixel control, in which `$D018` is the same on every line:

```bash
java -jar KickAss.jar tech-tech.asm :seven=1 -o tech-tech-seven.prg
```

For the placement sweep, N from 2 to 6:

```bash
java -jar KickAss.jar tech-tech.asm :pad=N -o tech-tech-padN.prg
```

`-showmem` reports the code at `$0900` to `$1221` (2,338 bytes, most of
it the two unrolled bands), the tables at `$1C00` to `$1D7F` (384 bytes)
and the eight matrices at `$2000`, `$2400`, ... `$3C00`, 1,000 bytes each.
The PRG is 14,313 bytes.

## Expected output

A black screen. From raster line 115 to 162 the word WOBBLE in white
block cells, 23 cells wide and six rows tall including the rule under it,
each raster line of it shifted right by its own s between 1 and 63
pixels, so that the letters shear across the band; the phase steps by
three table entries a line, so the 48 lines cover about half a wave and
the shear runs one way. Down the left of the band, on lines 116 to 162,
three cells of screen code 255 in a colour that is not the logo's white:
the FLI bug strip, see below. Line 115 has no strip. The rest of the
screen is empty. After 300 frames the wave stops moving.

Measured in VICE x64sc 3.10 with the pinned command at 12,000,000
cycles on both models: `$02E2` and `$02E3` read 300 (frames advanced),
`$02FF` read `01`, and the picture is byte-identical across two runs on
each model (PAL MD5 `001c304d…`, NTSC `f61dcf58…`). The PAL picture has
5,312 white pixels in PNG rows 99 to 146 (raster 115 to 162) and columns
57 to 302; the NTSC picture the same 5,312 in rows 87 to 134, the same
columns.

With the phase held at 300, band line l (raster 115 + l) shows s =
sine[(300 + 3 l) & 255], matrix k = s >> 3 and XSCROLL = s & 7, so the
logo's left edge sits at display pixel 24 + s, PNG column 56 + s. Five
lines, measured with PIL against the table the listing builds:

| Raster line | s | k | XSCROLL | Edge from the table (56 + s) | First white pixel, PAL | First white pixel, NTSC | First white pixel, `:seven=1` |
|---|---|---|---|---|---|---|---|
| 116 | 60 | 7 | 4 | 116 | 116 | 116 | 92 |
| 131 | 56 | 7 | 0 | 112 | 112 | 112 | 88 |
| 143 | 32 | 4 | 0 | 88 | 88 | 88 | 88 |
| 156 | 7 | 0 | 7 | 63 | 63 | 63 | 95 |
| 162 | 1 | 0 | 1 | 57 | 57 | 57 | 89 |

All 48 lines agree with the table on both models, not only these five.
The `:seven=1` control holds k at 4 (the logo from cell 7, pixel 88) and
its edge is 88 + XSCROLL: the same XSCROLL values, an amplitude of seven
pixels instead of 63. Its picture is `figures/tech-tech-seven-12000000.png`.

**The FLI bug strip.** Classifying every band line's first twelve cells
in the PAL pin: line 115 has cells 0 to 2 black and the logo from cell
10; lines 116 to 162 have cells 0 to 2 filled with one glyph whose rows
are `$0F $0F $0F $0F $F0 $F0 $F0 $F0`, which is screen code 255 in the
uppercase ROM (read from the VICE `chargen` image), and the logo from
cell 3 + k. The strip's colour is not the cell's colour RAM (white): it
is purple (index 4) on lines 116 to 161 and medium grey (12) on line 162
in the PAL picture, purple on 116 to 161 and brown (9) on line 162 in the
NTSC picture, and light red (10) on lines 116 to 161 in the `:pad=2` and
`:pad=4` builds. In each case the low nibble matches the opcode byte the
CPU fetches next after the `$D011` write (`bit $ea` is `$24`, `nop` is
`$EA`, the code after the last block begins `lda #`, `$A9`), except the
PAL line 162, where it does not; how VICE chooses the byte was not read
for this page, and nothing here says what a 6569 or 6567 shows.

**The placement sweep.** `:pad=N` makes each block N + 20 cycles from
the end of the previous line's stall. PAL, 12,000,000 cycles, one run
each:

| pad | Block, cycles | `$D011` write, model cycle | Cells with no fetch | What the picture shows |
|---|---|---|---|---|
| 2 | 22 | 14 | cells 0 and 1 show code 255 | The row counter is reset every line: the band shows only the top pixel row of the letters, sheared, and the whole logo is drawn again unshifted from line 163 to 210. 10,304 white pixels in rows 99 to 194. `figures/tech-tech-pad2-12000000.png` |
| 3 | 23 | 15 | cells 0 to 2 show code 255 | Correct: the pinned picture |
| 4 | 24 | 16 | cell 0 keeps the last full fetch (a space), cells 1 to 3 show code 255 | Lines with k = 0 lose the logo's first cell: line 162 first white at 65, not 57. `figures/tech-tech-pad4-12000000.png` |
| 5 | 25 | 17 | cells 0 and 1 stale, 2 to 4 code 255 | Line 162 first white at 73 |
| 6 | 26 | 18 | cells 0 to 2 stale, 3 to 5 code 255 | Line 162 first white at 81 |

The model cycle is the block length less eight, the numbering
`fli-image` uses for its own 23-cycle block; the padding is the
measurement. One cycle early loses one cell fewer and resets the row
counter; each cycle late loses one cell more, and the cells that miss
their fetch on the early side of the three are not code 255 but whatever
the buffer held from the last complete fetch, here line 115's spaces.
Nothing in the sweep produced a plain, unwobbled logo: a write late
enough to miss the badline window altogether was not tried.

On NTSC the block is `LINE_PAD_NTSC` = 5, 25 cycles of a 65-cycle line,
and the entry delay 204 - 14. With 205 - 14, which `fli-image` suggested
would be right for the 6567R8, line 116 came out one cycle late (cell 0
stale, 1 to 3 code 255) and lines 117 to 162 correct; with 204 - 14 all
47 forced lines are correct. The remaining lines of both models were
identical in the two settings, because from the first block onwards each
line is timed by its own stall.

Screenshots from the VICE runs this page describes:
`screenshots/tech-tech.png` (PAL) and `screenshots/tech-tech-ntsc.png`.

The timer figures, read from the running machine with a `-moncommands`
file that traces the store to `$02FF` and dumps `$02E0` to `$02FF` at
the 300th frame, no overhead removed (the timer's own start and stop
instructions are inside the count, 16 cycles at the start and the stop
sequence after the last write):

| | PAL | NTSC |
|---|---|---|
| Band interrupt, `irq1` entry on line 109 to the register restore after line 162, CIA1 timer A | 3,405 | 3,508 |
| Table build in the vertical blank, 48 lines, CIA1 timer B | 2,041 | 2,041 |

Per band line, 63 cycles elapse on PAL and 65 on NTSC; the CPU sees 23
of them (cycles 55 to 63 of the previous line and 1 to 15 of its own on
PAL, 25 on NTSC) and every one is spent in the block. The band interrupt
is 54 raster lines, 109 to 162, of which the first three are the double
IRQ's entry and the sync (arithmetic from the listing; the timer figure
is the measurement).

## Why this works

### Why the matrix can change per line at all

`hardware/vic-ii-reference.md` states the constraint and the mechanism: "The
chip fetches one character pointer (c-access) per cell during the badline
of each text row, caches it in an internal 40x12-bit row buffer, and then
performs eight g-accesses per cell over the next eight raster lines", and
the badline condition is "($30 <= raster <= $F7) AND (raster & 7 ==
YSCROLL) AND DEN was set on $30", evaluated every cycle. Writing YSCROLL
= line & 7 on a line makes the condition true on that line; the VIC then
performs the 40 c-accesses on cycles 15 to 54 from the matrix `$D018`
names, and the g-accesses that follow on the same line read the new
buffer. `fli-image` uses this to change colours per line in bitmap mode;
here the same fetch changes the character codes, so the row of cells that
the line draws is a different row of a differently shifted logo.

The two timing constraints are `fli-image`'s. The write must land after
the cycle-14 check, where the VIC resets the row counter RC to 0 if the
condition already holds, or the band displays pixel row 0 of every cell
on every line and never advances: that is the `:pad=2` picture, with the
logo drawn again below the band because VCBASE was never moved on. And
the write must land before the c-accesses' slots have passed: the three
cells whose slot is over when BA falls read screen code 255 with a colour
nibble from the data bus. That is the strip, and three cells is the least
the trick costs; each cycle later costs one more, as the sweep shows.

### The stall is the loop counter

After the `$D011` write the CPU's next cycle is an instruction fetch, a
read, and the VIC holds BA low until cycle 54, so the CPU stands still
until cycle 55 whatever it was about to do. Every block therefore begins
on cycle 55 of the previous line and only the 23 cycles from there to the
write need counting: `Delay(3)`, then three loads and three stores. Both
tables are in zero page so the loads take three cycles; with absolute
loads the block would be 25 cycles and the write two cycles late. There
is no room for an index register or a branch inside the block, so the
band is unrolled, 47 blocks per model, and the per-line values are
tables rather than code.

Line 115 is different: it is row 8's natural badline (115 & 7 = 3 with
YSCROLL 3 from the exit of the previous frame), so its fetch is complete
and it has no strip. Its two register values are written before the
entry delay, on line 112, and the natural stall on line 115 leaves the
CPU at cycle 55 for the first block, line 116. The exit after line 162
restores YSCROLL 3, matrix 0 and XSCROLL 0 in the right border of line
162, so line 163 is row 14's natural badline, from an empty matrix.

### Eight matrices, and where they cannot go

Matrix k holds the logo from cell 3 + k, so the pair (matrix s >> 3,
XSCROLL s & 7) puts the left edge at pixel 24 + s for every s from 0 to
63; the table's amplitude is 31 about 32 so no entry reaches 64
(`pitfalls/maths.md`, `sine_table_peak_wraps_to_zero`). The matrices are
in VIC bank 0 at `$2000` to `$3FFF`, not at `$0400` to `$23FF`: the VIC
sees the character ROM in place of RAM at `$1000` to `$1FFF` of banks 0
and 2 for every kind of access, so four matrices there would fetch codes
from the font, not from the logo. The `$D018` value for matrix k is
`((8 + k) << 4) | $04`: VM nibble 8 + k, CB 2 for the ROM font at
`$1000`.

### Where the work runs

The band takes 54 raster lines a frame and the table build about 2,041
cycles in the vertical blank; the rest of the frame is free. A second
sine, a colour wash through `$D021` in the same blocks, or a taller band
all fit; a taller band costs 63 cycles a line and nothing else, until the
tables outgrow zero page.

### Region

`detect_region` sets a flag at boot and `irq1` picks the PAL or NTSC band
from it, as `pseudo-3d-road` does. The NTSC band's blocks have two more
cycles of padding for the 65-cycle line of the 6567R8, which is VICE's
`-model ntsc`, and a different entry delay; the c-accesses still occupy
cycles 15 to 54 and the stall still ends on cycle 55, so the block
structure is the same. The 64-cycle 6567R56A was not run.

## What it does not establish

**Real hardware.** Every figure above is VICE 3.10. The strip's colour in
particular is whatever the emulator puts on the data bus during the three
missed fetches; a 6569 or 6567 may show another colour, or a colour that
changes with what the CPU is doing.

**More than 64 pixels.** Eight matrices give eight cells of shift plus
seven pixels; a wider wave needs more matrices in the same bank or a
smaller logo moved by both matrix and code. Neither was built.

**NTSC beyond the pin.** The NTSC picture and the two timer figures are
one build at one cycle count; the 6567R56A and the entry delay's exact
cycle on NTSC were not settled here.

**The old-fetch cells.** The sweep shows that the cells lost on the early
side of a late write keep the last complete fetch; which fetch that is
when the band starts on a forced line rather than a natural one was not
measured.
