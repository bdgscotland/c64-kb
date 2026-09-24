---
recipe: vsp
toolchain: kickassembler
output_format: PRG
region: both
techniques: [vsp_glitch, stable_raster_irq, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init)]
---

<!-- doc-type: recipe -->

# KickAssembler — VSP: a late first badline moves the text screen ten characters right

## Synopsis

VSP (variable screen position, also called DMA delay) in its smallest
form. The text screen holds screen code `i & 63` at offset `i`, so every
cell names its own place in screen RAM. YSCROLL is 7 at the top of the
frame, so no line up to 50 is a badline and line 51 is not one at cycle
14. A stable raster interrupt then writes `$D011` with YSCROLL 3 (51 & 7)
part-way through line 51, the badline condition becomes true late, and
from character row 1 down the whole screen is shown ten characters to the
right. One write per frame does it. PAL and NTSC are told apart at start
and each gets its own delay.

VICE x64sc is the only machine this ran on. On real hardware a VSP write
can corrupt RAM on some machines (technique `vsp_glitch`, "The VSP
crash"); VICE does not emulate that by default, and this listing does not
follow the Safe VSP rules. Nothing on this page says it is safe on a real
C64.

## Source

```asm
// vsp.asm
// VSP (DMA delay): the first badline of the frame is made late on
// purpose, so the whole text screen moves sideways by whole characters.
// YSCROLL is 7 until line 51; on line 51 a cycle-exact write sets it to 3
// (51 & 7), and the badline condition becomes true mid-line.
//
// The screen holds screen code (i & 63) at offset i, white on black, so
// the shift can be read off the picture cell by cell.

// Region: both. Measured in VICE x64sc: the shift is N = VSP_PAD - 194 on
// PAL and VSP_PAD - 202 on NTSC, for N = 1 to 40. 204 and 212 give N = 10.
// :pad=N and :npad=N on the command line override them for a sweep.

BasicUpstart2(start)

.var padVar = cmdLineVars.get("pad")
.var ntscVar = cmdLineVars.get("npad")
.const VSP_PAD_PAL  = (padVar == null) ? 204 : padVar.asNumber()
.const VSP_PAD_NTSC = (ntscVar == null) ? 212 : ntscVar.asNumber()

.const SYNC_LINE = 48            // stable raster here; YSCROLL 7, not a badline
.const SYNC_PAD  = 11            // as measured for stable-raster-irq and fli-image
.const BOTTOM    = 252           // below the display: YSCROLL back to 7

.const SCREEN   = $0400
.const REG_FLAG = $02            // 0 PAL, 1 NTSC
.const SAVED_SP = $03

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

* = $0810
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    lda #0
    sta $d020
    sta $d021
    ldx #0
!:  txa
    and #$3f
    sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x         // $07E8-$07FF too: sprite pointers, no sprite is on
    lda #1
    sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-
    lda #$15                     // matrix $0400, upper-case ROM font
    sta $d018
    lda #$c8
    sta $d016

    jsr detect_region            // returns with interrupts enabled
    sei
    lda #<irq_bottom
    sta $0314
    lda #>irq_bottom
    sta $0315
    lda #BOTTOM
    sta $d012
    lda #$1b
    sta $d011
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// detect_region, as in tech-tech: the last line's low byte is $37 on PAL,
// $06 or $05 on NTSC.
detect_region:
dr_wait_lo:
    bit $d011
    bmi dr_wait_lo
dr_wait_hi:
    bit $d011
    bpl dr_wait_hi
dr_track:
    lda $d012
    bit $d011
    bpl dr_over
    tax
    jmp dr_track
dr_over:
    lda #0
    cpx #$10
    bcs !+
    lda #1
!:  sta REG_FLAG
    cli
    rts

// Line 252: YSCROLL 7 for the top of the next frame, so no line from $30
// to 50 is a badline and line 51 is not one at cycle 14.
irq_bottom:
    lda #$1f
    sta $d011
    lda #SYNC_LINE - 3
    sta $d012
    lda REG_FLAG
    bne !+
    lda #<irq1_pal
    ldx #>irq1_pal
    jmp ib_set
!:  lda #<irq1_ntsc
    ldx #>irq1_ntsc
ib_set:
    sta $0314
    stx $0315
    lda #$01
    sta $d019
    jmp $ea81

// Double IRQ, as in stable-raster-irq: irq1 two lines above the sync line
// arms irq2 and slides through NOPs with interrupts on.
.macro Irq1(irq2) {
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda #SYNC_LINE - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx SAVED_SP
    cli
    .for (var i = 0; i < 40; i++) { nop }
}

.macro Irq2(pad) {
    ldx SAVED_SP
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:  Delay(pad)
    lda #$1b                     // YSCROLL 3: line 51 becomes a badline now
    sta $d011
    jmp irq_done
}

irq1_pal:  Irq1(irq2_pal)
irq1_ntsc: Irq1(irq2_ntsc)
irq2_pal:  Irq2(VSP_PAD_PAL)
irq2_ntsc: Irq2(VSP_PAD_NTSC)

irq_done:
    lda #<irq_bottom
    sta $0314
    lda #>irq_bottom
    sta $0315
    lda #BOTTOM
    sta $d012
    lda #$01
    sta $d019
    jmp $ea81
```

## Build

```bash
java -jar KickAss.jar vsp.asm -o vsp.prg
```

Produces `vsp.prg`, `$0801` to `$0A52`, 596 bytes on disk.
`java -jar KickAss.jar vsp.asm -o vsp.prg :pad=200 :npad=208` builds
another shift for a sweep.

## Expected output

Black border and background, white upper-case characters. Character rows
1 to 24 show screen RAM ten cells late: the cell at row `r`, column `c`
holds the glyph of screen code `(40 r + c - 10) & 63`, so row 1 starts
with codes 30, 31, 32 (up arrow, left arrow, space). Row 0 is not screen RAM
in order: columns 0 to 2 are a mid-grey pattern, columns 3 to 29 show
codes 3 to 29, and columns 30 to 39 repeat codes 20 to 29; cells 10 to
12 have a mid-grey first line.

`screenshots/vsp.png` (PAL c64c, VICE x64sc 3.10, 8,000,000 cycles) and
`screenshots/vsp-ntsc.png` (`-model ntsc`, 6567R8). Each of the 960 cells
of rows 1 to 24 was decoded against `chargen-901225-01.bin` with PIL and
matched `(40 r + c - 10) & 63` on both models; every pixel outside the
display window is black. Row 0 is the same on both models: 902 white and
96 mid-grey pixels.

### The sweep

`VSP_PAD` moved one cycle at a time, PAL, the same decode:

| `VSP_PAD` (PAL) | Row 0 | Rows 1 to 24 |
|---|---|---|
| 191 and below | screen RAM, normal | normal |
| 192 | column 0 wrong | normal |
| 193 | columns 0 and 1 wrong | normal |
| 194 | every column wrong | normal |
| 195 to 234 | wrong | shifted right by `VSP_PAD - 194` (1 to 40) |
| 235 to 237 | wrong | shifted by 40 |
| 238 to 242 | blank but for column 30 | normal |
| 243 and up | blank | row `r` shows screen RAM row `r - 1` |

NTSC gives the same sequence eight cycles later: 200 and 201 lose one and
two columns of row 0, 202 loses the row, and 203 to 210 shift by
`VSP_PAD - 202` (not measured past 210). Three lines of 65 cycles against
63 account for six of the eight; the other two are where the sync lands on
the longer line, not analysed here.

### What the page's model predicts, and what was not settled

With VICE's VSP-bug emulation on (`-VICIIvspbug`), VICE logs each event
as `VSP Bug: Line: 3/51  Cycle: 24` for the pinned PAL build: its write
lands on line 51 at VICE's cycle 24. That log prints VICE's cycle-table
index, which is Bauer's cycle minus one (`runtime/vice-reference.md`,
"What the CYC column counts", from the VICE source), so the write is
cycle 25 in Bauer's numbering, and a shift of 10 is `25 - 15`, what the
technique page's formula gives. An earlier version left the counting
base unchecked. The recipe does not otherwise tie
`VSP_PAD` to an absolute cycle.

### One frame without the write

A variant that stops the late write after 100 frames (irq_bottom stores
`$1B` from then on, so line 51 is an ordinary badline) shows the shift at
4,000,000 cycles and the normal screen at 8,000,000. The offset does not
carry into the next frame; the write has to be made every frame.

### With VICE's VSP-bug emulation

Eleven runs of the pinned PAL build with `-VICIIvspbug`, which picks the
"safe channels" at random at power-on: nine screenshots were identical
to `screenshots/vsp.png`; one showed the power-on blue screen with no
text, the program gone; one showed no shift and some wrong characters in
screen RAM. That is VICE's model of the corruption, not a measurement of
a real machine, and it is why the warning in the synopsis stands.

## Why this works

**The late badline.** The VIC-II loads its video counter VC from VCBASE
in cycle 14 of every line. If the badline condition holds then, the line
is an ordinary first line of a character row: 40 c-accesses from cycle
15, and VC counts 40 characters across the row. Here YSCROLL is 7 until
line 51, so in cycle 14 of line 51 the condition is false and the VIC is
still idle. The `STA $D011` with YSCROLL 3 makes it true later in the
line. The VIC then starts fetching from whichever column the beam has
reached, and VC advances by fewer than 40 over the row. At the end of the
row VCBASE takes that short count, so every later row starts that many
characters early in screen RAM, and the picture moves right. The sweep
shows one column per cycle of delay, up to 40.

**Row 0.** The row whose fetch started late shows what the VIC had in
its internal buffers where it fetched nothing. What it shows here is
VICE's model of that; the table above records it, and it is pinned
pixel-exact by `verify:recipes`, but it is not a claim about a 6569. A
program that uses VSP keeps this row in a border or covers it.

**Every frame.** VCBASE starts from 0 again at the top of each frame, as
the one-frame variant shows, so `irq_bottom` puts YSCROLL back to 7 on
line 252 and the stable interrupt repeats the late write on line 51.

**The timing.** The write has to land on one cycle, so it follows a
double interrupt as in `stable-raster-irq.md` (sync on line 48, which is
not a badline with YSCROLL 7) and a counted delay. `detect_region` reads
the last raster line's low byte ($37 on PAL, $06 or $05 on NTSC) and the
bottom interrupt arms the PAL or the NTSC pair.

**Scrolling with it.** Change the delay by one cycle per character and
XSCROLL (`$D016` bits 0-2) for the pixels in between; the screen RAM never
moves. That is the technique's use in games; this recipe shows one fixed
position.
