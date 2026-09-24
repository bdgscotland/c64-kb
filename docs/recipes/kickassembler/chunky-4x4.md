---
recipe: chunky-4x4
toolchain: kickassembler
output_format: PRG
region: both
techniques: [chunky_4x4_fli_mode, multicolor_bitmap, vic_bank_select, stable_raster_irq, double_irq, badline_synchronization, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC0D, DD00]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), cia2_vic_bank (owns), zero_page $03-$08 (owns)]
ram: [state=$02E0, vic=$4000-$7FFF, scratch=$C000-$C1FF, colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: a 4×4 chunky-pixel framebuffer from one forced badline per character row

## Synopsis

An 80 × 50 framebuffer of chunky pixels four hires pixels square, one
colour of sixteen each, from a multicolour bitmap that never changes and
two screen matrices that hold the colours. Every bitmap byte is
`%10100101`, so each 8 × 8 cell shows its screen byte's low nibble on the
left half and its high nibble on the right. Screen A gives each character
row's top four lines; halfway down every row a `$D018` write selects
screen B and a `$D011` write on cycle 14 forces a badline that fetches
screen B's colours without resetting the row counter, so the bottom four
lines take B's colours. After the badline's stall the loop puts back
screen A and YSCROLL 3 for the next row. Chunky pixel (x, y) is colour
(x + 3y) mod 16, so the picture checks itself. The technique is
`chunky_4x4_fli_mode` in `techniques/bitmap-modes.md`.

## Source

```asm
// chunky-4x4.asm
// A 4 x 4 chunky-pixel framebuffer: 80 x 50 pixels of 16 colours.
//
// Multicolour bitmap, every byte %10100101: in each cell the left half
// shows the screen byte's low nibble and the right half its high nibble,
// so the screen matrix is the framebuffer and the bitmap never changes.
// Screen A colours the top four lines of each character row. On the
// fifth line $D018 selects screen B and YSCROLL = 7 is written on cycle
// 14: a badline that refetches the colours from B without resetting the
// row counter, so the bottom four lines take B's colours. Chunky pixel
// (x, y) is colour (x + 3y) mod 16.
//
// :nofli=1 aims the forced-badline write at $02FF instead of $D011.
.const FLAG   = $02e0           // 0 = PAL, 1 = NTSC
.const saved  = $03
.const ptr    = $04             // $04/$05
.const ptr2   = $06             // $06/$07
.const tmp    = $08
.const SCRA   = $4000           // screen for the top half of each row
.const SCRB   = $4400           // screen for the bottom half
.const BITMAP = $6000
.const D18A   = $08             // screen $4000, bitmap $6000 (bank 1)
.const D18B   = $18             // screen $4400, bitmap $6000

.var SPP = cmdLineVars.containsKey("spp") ? cmdLineVars.get("spp").asNumber() : 12
.var SPN = cmdLineVars.containsKey("spn") ? cmdLineVars.get("spn").asNumber() : 14
.var EP = cmdLineVars.containsKey("ep") ? cmdLineVars.get("ep").asNumber() : 332
.var EN = cmdLineVars.containsKey("en") ? cmdLineVars.get("en").asNumber() : 344
.var TP = cmdLineVars.containsKey("tp") ? cmdLineVars.get("tp").asNumber() : 390
.var TN = cmdLineVars.containsKey("tn") ? cmdLineVars.get("tn").asNumber() : 406
.var NOFLI = cmdLineVars.containsKey("nofli") ? cmdLineVars.get("nofli").asNumber() : 0

BasicUpstart2(start)

.macro Delay(c) {
    .if (c == 1) .error "Delay cannot make 1 cycle"
    .if (c > 0) {
        .if ((c & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((c & 1) != 0 ? c - 3 : c) / 2; i++) { nop }
    }
}
.macro Wait(c) {
    .var n0 = floor((c - 3) / 5)
    .var n = (c - (5 * n0 + 1)) == 1 ? n0 - 1 : n0
    ldy #n
!:  dey
    bne !-
    Delay(c - (5 * n + 1))
}

// 25 rows. Row r's natural badline is 51 + 8r (YSCROLL 3). On line
// 55 + 8r: $D018 to screen B, then YSCROLL 7 on cycle 14: a badline that
// fetches screen B's row without resetting RC. After its stall: screen A
// and YSCROLL 3 again for the next natural badline.
.macro Rows(ENTRY, T) {
    ldx #25
    Wait(ENTRY)
!row:
    lda #D18B
    sta $d018
    lda #$3f
    .if (NOFLI == 0) { sta $d011 } else { sta $02ff }
    lda #D18A
    sta $d018
    lda #$3b
    sta $d011
    dex
    beq !done+
    Wait(T)
    jmp !row-
!done:
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region
    // Bitmap: every byte %10100101: in each cell the left two multicolour
    // pixels take the screen byte's low nibble, the right two its high
    // nibble. A 4 x 4 block of hires pixels is one chunky pixel.
    lda #<BITMAP
    sta ptr
    lda #>BITMAP
    sta ptr + 1
    ldy #0
    lda #%10100101
!:  sta (ptr), y
    iny
    bne !-
    inc ptr + 1
    ldx ptr + 1
    cpx #$80
    bne !-
    // Chunky pixel (x, y), x 0-79, y 0-49: colour (x + 3y) mod 16. Cell
    // (x / 2, y / 2) of screen A (y even) or B (y odd); x even is the low
    // nibble.
    lda #<SCRA
    sta ptr
    lda #>SCRA
    sta ptr + 1
    lda #<SCRB
    sta ptr2
    lda #>SCRB
    sta ptr2 + 1
    ldx #0                      // cell row r
!r: ldy #0                      // cell column c
!c: // top: y = 2r: low = (2c + 6r), high = (2c + 1 + 6r)
    txa
    asl
    sta tmp
    txa
    clc
    adc tmp                     // 3r
    asl                         // 6r
    sta tmp
    tya
    asl                         // 2c
    clc
    adc tmp                     // 2c + 6r
    jsr pack
    sta (ptr), y
    // bottom: y = 2r + 1: add 3
    lda tmp
    clc
    adc #3
    sta tmp
    tya
    asl
    clc
    adc tmp
    jsr pack
    sta (ptr2), y
    iny
    cpy #40
    bne !c-
    lda ptr
    clc
    adc #40
    sta ptr
    sta ptr2
    bcc !+
    inc ptr + 1
    inc ptr2 + 1
!:  inx
    cpx #25
    bne !r-
    ldx #0
    lda #0
!:  sta $d800, x                // colour RAM (bits 11) unused
    sta $d900, x
    sta $da00, x
    sta $db00, x
    inx
    bne !-
    lda $dd00
    and #$fc
    ora #$02                    // VIC bank 1
    sta $dd00
    lda #D18A
    sta $d018
    lda #$d8                    // multicolour
    sta $d016
    lda #0
    sta $d020
    sta $d021
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$3b
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

// pack: A = colour of the left pixel (mod 16); returns (left & 15) | ((left + 1) & 15) << 4.
pack:
    and #15
    sta saved
    clc
    adc #1
    and #15
    asl
    asl
    asl
    asl
    ora saved
    rts

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

irq1:
    lda #$3b
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
!:  Rows(EP, TP)
    jmp done
irq2n:
    ldx saved
    txs
    Delay(SPN)
    lda $d012
    cmp $d012
    beq !+
!:  Rows(EN, TN)
done:
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #46
    sta $d012
    lda #1
    sta $d019
    jmp $ea81
```

## Build

```bash
java -jar KickAss.jar chunky-4x4.asm -o chunky-4x4.prg
```

The forced write moved for rows 1 to 24, one cycle per step, and turned
off (the first row's write is set by `:ep`/`:en`):

```bash
java -jar KickAss.jar chunky-4x4.asm :tp=N -o s.prg       # PAL, N 387 to 393: cycles 11 to 17 [390: 14]
java -jar KickAss.jar chunky-4x4.asm :tn=N -o s.prg       # NTSC, N 403 to 409 [406: 14]
java -jar KickAss.jar chunky-4x4.asm :nofli=1 -o s.prg    # the write aimed at $02FF
```

`-showmem` reports `$0900` to `$0AE0`; the PRG is 738 bytes. The bitmap
(`$6000`-`$7F3F`) and the two screens (`$4000`, `$4400`) are built at
start-up in VIC bank 1.

## Expected output

A black border around a 320 × 200 grid of 4 × 4 blocks in diagonal
stripes of all sixteen colours, each block row three colours further on
than the one above. The three leftmost cells (six blocks) of every
bottom half-row are light grey.

Measured in VICE x64sc 3.10 with the pinned command at 8,000,000 cycles,
PAL c64c (8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Every 4 × 4
block of the display (x 32 + 4bx, line 51 + 4by) was read with PIL,
checked to be one colour, and turned into a palette index with the
triples in `runtime/vice-reference.md`:

| Model | Blocks | One colour each | Equal to (x + 3y) mod 16 | The rest |
|---|---|---|---|---|
| PAL | 4,000 | 4,000 | 3,859 | 141, all in cells 0-2 of the 25 bottom half-rows, all colour 15 |
| NTSC | 4,000 | 4,000 | 3,859 | the same 141 |

150 blocks lie in cells 0-2 of the bottom halves; 9 of them are
colour 15 in the pattern too. A store trace of `$D011` and `$D018` over
each run put the forced write on cycle 14 of lines 55 + 8r, the screen-B
write on cycle 8 before it and the screen-A write on cycle 60 after it,
in every row of every frame after the first: 6,050 forced writes on PAL
(242 frames) and 6,800 on NTSC (272). Screenshots:
`screenshots/chunky-4x4.png` and `screenshots/chunky-4x4-ntsc.png`.

### The forced write cycle

`:tp`/`:tn` move the forced write of rows 1 to 24; the stall after it
re-times each row, so every row's write lands on the same cycle. Blocks
counted over cells 3 to 39 of those rows (3,552), both models alike:

| Forced write cycle | Blocks right | Cells 0-2 of the bottom halves |
|---|---|---|
| 11, 12, 13 | 444: RC is reset, never reaches 7, and every row from 1 on repeats row 1 | mixed |
| 14 | 3,552, all | colour 15: the FLI bug |
| 15 | 3,507 | the grey moves one cell right; cell 0 keeps the top half's colours |
| 16 | 3,462 | two cells keep the top half's colours |
| 17 | 3,417 | three |
| no write (`:nofli=1`) | 1,776 | every bottom half equals its top half: 4 × 8 blocks |

The window is one cycle wide in VICE: 14 is the only cycle on which the
whole row is right.

## Why this works

### Colours from screen RAM only

In multicolour bitmap mode each pair of bits picks `$D021` (00), the
screen byte's high nibble (01), its low nibble (10) or colour RAM (11).
A constant bitmap of `%10100101` gives every cell two half-cells of four
hires pixels, the left from the low nibble and the right from the high
nibble, so the screen matrix alone is the framebuffer: one byte holds
two chunky pixels. The bitmap and colour RAM are never touched again.

### Half a row from another screen

The VIC reads the screen matrix only on a badline, into a 40-entry
buffer it uses for the next eight lines (Bauer §3.7.2). A badline made on
the fifth line of a row refills that buffer from wherever `$D018` points,
so the row's last four lines get new colours. The write has to make the
condition true on cycle 14 exactly: one cycle earlier and the VIC also
resets RC to 0 in cycle 14, the row never reaches RC = 7, VCBASE never
moves on, and every row shows the same screen row; later and RC is left
alone, but the c-accesses start later too, so the first cells keep the
old colours. On 14 the three cells fetched before the VIC owns the bus
read `$FF` (Bauer §3.14.6), which is light grey in both nibbles: the FLI
bug, three cells wide on every forced line.

### The timing

The forced badline's stall ends at the same cycle whatever the write
cycle, so each row's code after it runs from a fixed point: the wait to
the next row (`:tp`/`:tn`) sets where the next write lands, and every
row after the first lands there. The first row is placed from the double
IRQ of `stable-raster-irq` with `:ep`/`:en`. Both badlines of a row stop
the CPU for 40 cycles or more, and the loop holds the CPU from line 48
to 250; the free time is the border.

### Sources

- Codebase64, "4x4 FLI chunky mode" (a multicolour bitmap of one repeated
  byte, two screens, an NMI every eight lines writing `$D018` and
  `$D011`): https://codebase64.c64.org/doku.php?id=base:4x4_fli_chunky_mode
- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64" (1996), §3.7.2, §3.14.3 "FLI",
  §3.14.6: https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
