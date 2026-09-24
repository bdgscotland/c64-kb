---
recipe: afli-image
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [afli_image, fli_image, stable_raster_irq, double_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC0D, DD00]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — AFLI: hires FLI, two colours per 8x1 cell

## Synopsis

AFLI is FLI on a hires bitmap. The per-line engine is
`recipes/kickassembler/fli-image.md`'s, unchanged: a stable raster entry,
then one unrolled block per line that points `$D018` at that line's screen
page and forces a badline through `$D011`. The only change is `$D016` =
`$C8`, MCM clear. Each 8x1 cell then draws its 1 bits in the high nibble of
the line's screen byte and its 0 bits in the low nibble. The listing shows
a test pattern that makes both the colour pair and the bitmap row of every
line measurable: page `p` holds foreground `p + 8` on background `p`, and
bitmap row `r` of every cell is `$FF >> r`.

## Source

```asm
// afli-image.asm
// AFLI, hires FLI: the fli-image engine unchanged, with $D016's MCM bit
// clear, so the bitmap is hires and each 8x1 cell takes both of its
// colours from that line's screen page: high nibble for 1 bits, low
// nibble for 0 bits.
//
// The image is a test pattern. Page p holds foreground p + 8 and
// background p. Bitmap row r of every cell is $FF >> r, so a cell line
// shows 8 - r foreground pixels, then r background pixels: the picture
// shows both the colour pair of every line and which bitmap row the VIC
// read for it. Replace the .fill blocks with converter output for a real
// image.
//
// Region: pal. The per-line timing is fli-image's 63-cycle arithmetic.

.const FIRST_LINE = 51       // first display line: the natural badline
.const LAST_LINE  = 250
.const SYNC_LINE  = 48       // stable raster here; 48 & 7 = 0, not a badline
.const SYNC_PAD   = 11       // as measured for stable-raster-irq
.const ENTRY_PAD  = 197      // fli-image's value: sync to cycle 55 of FIRST_LINE
.var padVar = cmdLineVars.get("pad")
.const LINE_PAD   = (padVar == null) ? 11 : padVar.asNumber()   // fli-image's 11; :pad=N for the check

// VIC bank 1 ($4000-$7FFF): eight screen pages at $4000 + p*$400, bitmap at $6000.
.const BANK     = $4000
.const BITMAP   = BANK + $2000

BasicUpstart2(start)

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// $D018 for page p: VM = p (bits 7-4), CB bit 3 set = bitmap at $2000 in the bank.
.function d018(p) { .return (p << 4) | $08 }
// $D011 for line l: BMM, DEN, RSEL, YSCROLL = l & 7.
.function d011(l) { .return $38 | (l & 7) }

// ---------------------------------------------------------------------------
// Test pattern
// ---------------------------------------------------------------------------
.for (var p = 0; p < 8; p++) {
    * = BANK + p * $400
    .fill 1000, ((p + 8) << 4) | p   // foreground p + 8, background p
}
* = BITMAP
    .fill 8000, $ff >> (i & 7)       // row r of each cell: $FF >> r

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d

    lda $dd00
    and #$fc
    ora #$02                 // VIC bank 1
    sta $dd00
    lda #0
    sta $d020
    sta $d021                // not used by hires bitmap mode

    lda #$c8                 // hires (MCM clear), 40 columns
    sta $d016
    lda #d018(FIRST_LINE & 7)
    sta $d018                // the page line 51's natural badline will fetch
    lda #$3b                 // bitmap mode on, YSCROLL 3
    sta $d011

    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #SYNC_LINE - 3
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// Double IRQ, as in stable-raster-irq.asm.
irq1:
    lda #<irq2
    sta $0314
    lda #>irq2
    sta $0315
    lda #SYNC_LINE - 1
    sta $d012
    lda #$01
    sta $d019
    tsx
    stx saved_sp
    cli
    .for (var i = 0; i < 40; i++) { nop }

irq2:
    ldx saved_sp
    txs
    Delay(SYNC_PAD)
    lda $d012
    cmp $d012
    beq !+
!:
    Delay(ENTRY_PAD)

    // One block per line, as in fli-image: $D018 to the line's page, then
    // $D011 with YSCROLL = line & 7, its write on cycle 15 of the line.
    .for (var l = FIRST_LINE + 1; l <= LAST_LINE; l++) {
        Delay(LINE_PAD)
        lda #d018(l & 7)
        sta $d018
        lda #d011(l)
        sta $d011
    }

    lda #$3b
    sta $d011
    lda #d018(FIRST_LINE & 7)
    sta $d018
    lda #SYNC_LINE - 3
    sta $d012
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$01
    sta $d019
    pla
    tay
    pla
    tax
    pla
    rti

saved_sp: .byte 0
```

## Build

```bash
java -jar KickAss.jar afli-image.asm -o afli-image.prg
```

The PRG is 30,529 bytes, `$0801` to `$7F3F`: KickAssembler joins the code
at `$0900` and the 16 KB of pages and bitmap at `$4000` with zero fill, as
in `fli-image`. `:pad=N` on the command line sets `LINE_PAD` for the check
below.

## Expected output

Black border. In the display, line `L` (raster line, 51 to 250) uses page
`L & 7` and bitmap row `r = (L - 51) & 7`: each cell starts with `r`
pixels of the background colour `L & 7` and ends with `8 - r` pixels of
the foreground `(L & 7) + 8`. Line 51 is all dark grey (page 3's
foreground, row 0 = `$FF`); line 52 is purple then seven mid-grey pixels
per cell; line 53 green, green, then light green. Columns 0 to 2 are light
grey on lines 52 to 250, the FLI bug. Lines 248 to 250 keep page 7's
colours, line 247's fetch, while their bitmap rows still advance.

`screenshots/afli-image.png` (PAL c64c, VICE x64sc 3.10, 8,000,000
cycles). A PIL script computed that model for every pixel of the 320 by
200 display and found all 64,000 equal; every pixel outside the display
is black.

The padding is the one `fli-image` measured, and the pattern shows it
doing its work. Built with `:pad=10`, 27,052 display pixels differ: every
line from 52 draws bitmap row 0 (all foreground), because the `$D011`
write lands on cycle 14 and resets the row counter, and the grey band is
two columns wide. With `:pad=12`, 3,078 differ, all in columns 0 and 3:
column 0 keeps line 51's page on every line and the grey band moves to
columns 1 to 3.

Only PAL was run. `fli-image` gives the NTSC padding and says its NTSC
entry was not settled; this recipe inherits that.

## Why this works

**One bit, and where the colours come from.** In hires bitmap mode a cell
has two colours, both from the video matrix byte the VIC fetched for it:
high nibble for a 1 bit, low nibble for a 0 bit. Colour RAM is fetched
but not used. FLI makes the VIC fetch the matrix on every line from a
different page, so the pair changes every line while the bitmap byte for
the line is read from its usual place, row `r` of the cell. That is the
whole of AFLI: `fli-image`'s engine with MCM off.

**Why the pattern is `$FF >> r`.** A test pattern with one colour per line
would pass even if the VIC read the wrong bitmap row. `$FF >> r` gives
each of the eight rows a different split, so the measurement checks the
row counter as well as the page. The `:pad=10` build is the failure it
catches.

**The FLI bug in hires.** The three columns whose matrix fetch was missed
read `$FF`: light grey on light grey, the same band as in multicolour
FLI. Lines 248 to 250 are below the last line on which a badline can be
forced (`$F7`), so they keep line 247's colours, as in `fli-image`.
