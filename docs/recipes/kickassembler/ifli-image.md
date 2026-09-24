---
recipe: ifli-image
toolchain: kickassembler
output_format: PRG
region: pal
techniques: [ifli_image, fli_image, stable_raster_irq, double_irq]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC0D, DD00]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), zero_page $FB-$FD (owns)]
ram: [colour=$D800-$DBFF, screens=$D000-$DFFF]
---

<!-- doc-type: recipe -->

# KickAssembler — IFLI: two FLI images in two banks, alternated with a one-pixel shift

## Synopsis

IFLI shows two multicolour FLI images on alternate frames. Each image is a
whole FLI layout, eight screen pages and a bitmap, 16 KB, so the two live in
two VIC banks: image A in bank 1 (`$4000`), image B in bank 3 (`$C000`, its
pages 4 to 7 under the I/O area and its bitmap under the KERNAL ROM, where
the VIC reads RAM). The per-line engine is
`recipes/kickassembler/fli-image.md`'s, unchanged. Below the last FLI line
one `$DD00` write picks the bank for the next frame and one `$D016` write
sets XSCROLL 0 for A and 1 for B, so B's two-pixel-wide multicolour pixels
sit one hires pixel to the right of A's. The images are test patterns
built at start. After 200 frames of alternation the program holds image A,
so the pinned screenshot does not depend on which frame the run ends on.

## Source

```asm
// ifli-image.asm
// IFLI: two multicolour FLI images in two VIC banks, shown on alternate
// frames, the second one hires pixel to the right (XSCROLL 1), so their
// two-pixel-wide multicolour pixels interleave. The per-line engine is
// fli-image's, unchanged; one $DD00 write and one $D016 write in the
// border after the last FLI line pick the image for the next frame.
//
// Test pattern. Image A (bank 1): bitmap $44 (%01 %00 %01 %00), page p
// holds colour p + 1 in its high nibble. Image B (bank 3): bitmap $88
// (%10 %00 %10 %00), page p holds colour 15 - p in its low nibble.
// Background black. After TOGGLES frames the program holds image A, so
// the exit screenshot is the same whatever frame it lands on.
//
// Region: pal. The per-line timing is fli-image's 63-cycle arithmetic.

.const FIRST_LINE = 51       // first display line: the natural badline
.const LAST_LINE  = 250
.const SYNC_LINE  = 48       // stable raster here; 48 & 7 = 0, not a badline
.const SYNC_PAD   = 11       // as measured for stable-raster-irq
.const ENTRY_PAD  = 197      // fli-image's value: sync to cycle 55 of FIRST_LINE
.const LINE_PAD   = 11       // fli-image's value
.const TOGGLES    = 200      // frames of alternation before the hold on A

.const BANK_A   = $4000      // $DD00 bits 0-1 = %10
.const BANK_B   = $c000      // $DD00 bits 0-1 = %00; pages 4-7 lie under I/O
.const D016_A   = $d8        // multicolour, 40 columns, XSCROLL 0
.const D016_B   = $d9        // XSCROLL 1: one hires pixel right

.const PTR      = $fb        // fill pointer
.const COUNT    = $fd        // frames shown so far, stops at TOGGLES

BasicUpstart2(start)

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

.function d018(p) { .return (p << 4) | $08 }
.function d011(l) { .return $38 | (l & 7) }

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    lda #0
    sta $d020
    sta $d021
    sta COUNT
    ldx #0                   // colour RAM black: the %11 colour, unused here
!:  sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-

    // Both images, built here. $01 = $34 while writing: RAM at $D000-$DFFF
    // for image B's pages 4-7. Interrupts stay off until $37 is back.
    lda #$34
    sta $01
    ldy #0
!:  lda fill_hi, y
    beq !+
    sta PTR + 1
    ldx fill_pages, y
    lda fill_val, y
    jsr fill
    iny
    bne !-
!:  ldx #$3f                 // B's bitmap ends at $FF3F: the last 64 bytes
    lda #$88                 // here, so nothing is written over $FFFA-$FFFF
!:  sta BANK_B + $3f00, x
    dex
    bpl !-
    lda #$37
    sta $01

    jsr show_a
    lda #d018(FIRST_LINE & 7)
    sta $d018
    lda #$3b
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

// fill: X pages of 256 bytes from PTR+1:00 with A. Each 1,000-byte page
// gets four; the 24 extra bytes are overwritten by the next page or lie
// in unused RAM past the last one.
fill:
    sty fill_y
    ldy #0
    sty PTR
!:  sta (PTR), y
    iny
    bne !-
    inc PTR + 1
    dex
    bne !-
    ldy fill_y
    rts
fill_y: .byte 0

// Fill table: start page, 256-byte pages, value. Zero ends it.
fill_hi:
    .for (var p = 0; p < 8; p++) { .byte >(BANK_A + p * $400) }
    .for (var p = 0; p < 8; p++) { .byte >(BANK_B + p * $400) }
    .byte >(BANK_A + $2000), >(BANK_B + $2000), 0
fill_pages:
    .fill 16, 4
    .byte 32, 31                 // A's bitmap: $6000-$7FFF; B's: $E000-$FEFF
fill_val:
    .for (var p = 0; p < 8; p++) { .byte (p + 1) << 4 }
    .for (var p = 0; p < 8; p++) { .byte 15 - p }
    .byte $44, $88

show_a:
    lda $dd00
    and #$fc
    ora #$02
    sta $dd00
    lda #D016_A
    sta $d016
    rts

show_b:
    lda $dd00
    and #$fc
    sta $dd00
    lda #D016_B
    sta $d016
    rts

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
    .for (var l = FIRST_LINE + 1; l <= LAST_LINE; l++) {
        Delay(LINE_PAD)
        lda #d018(l & 7)
        sta $d018
        lda #d011(l)
        sta $d011
    }

    // Lines 248-250 cannot be badlines, so their blocks do not stall and
    // the CPU is early, on line 249. Wait for line 251 before switching,
    // or the last two lines show the next frame's image.
!:  lda $d012
    cmp #LAST_LINE + 1
    bne !-
    lda #$3b
    sta $d011
    lda #d018(FIRST_LINE & 7)
    sta $d018
    lda COUNT
    cmp #TOGGLES
    bcs hold
    inc COUNT
    and #1                   // COUNT before the increment: even -> B next
    bne next_a
    jsr show_b
    jmp armed
hold:
next_a:
    jsr show_a
armed:
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
java -jar KickAss.jar ifli-image.asm -o ifli-image.prg
```

Produces `ifli-image.prg`, `$0801` to `$1744`, 3,910 bytes on disk: the
32 KB of image data is written by the program, not loaded.

## Expected output

Black border and background. Image A: on raster line `L` (51 to 250) every
cell shows two pixels of colour `(L & 7) + 1`, two black, two colour, two
black, from its bitmap byte `$44`. Image B: two pixels of colour
`15 - (L & 7)` from `$88`, one hires pixel further right, with display
column 0 black. In both, lines 52 to 250 have the FLI bug in character
columns 0 to 2 (the image's coloured pixels light grey), and lines 248 to
250 keep page 7's colours, line 247's fetch.

`screenshots/ifli-image.png` (PAL c64c, VICE x64sc 3.10, 8,000,000
cycles, the hold on A) and `screenshots/ifli-image-frame-b.png` (the same
command at 5,010,000 cycles, during the alternation; not pinned in
`runs.json`). A PIL script built both models pixel by pixel: the pinned
picture equals image A in all 64,000 display pixels, and the frame-B
picture equals image B in all 64,000. Each was produced twice with
identical bytes (md5 `8d64bddb...` A, `077ca260...` B). Every pixel outside
the display is black in both. Line 60, pixels 24 to 31: A is green, green,
black, black, green, green, black, black; B is black, dark grey, dark grey,
black, black, dark grey, dark grey, black.

The screenshots at 5,030,000 cycles and 8,000,000 are image A, and at
5,010,000 and 5,015,000 image B, each exact; at 4,000,000 the limit lands
mid-display and the picture is part one image, part the other, the
exit-screenshot behaviour `runtime/vice-reference.md` describes.

Only PAL was run, as `fli-image`.

## Why this works

**Two banks, one engine.** `$D018`'s values select a page (bits 4-7) and
the bitmap at offset `$2000` (bit 3) inside whatever bank `$DD00` names, so
the same 200 unrolled blocks draw either image; only the bank changes. Bank
3 is used for B because banks 0 and 2 show the character ROM at
`$1000-$1FFF` to the VIC, where FLI needs screen pages. The CPU writes B's
pages 4 to 7 at `$D000-$DFFF` with `$01` = `$34` (all RAM) and interrupts
off, then restores `$37`.

**Where the swap goes.** Lines 248 to 250 are past `$F7`, the last line
on which a badline can be forced, so their three blocks do not stall and
the CPU leaves the loop early, not on cycle 55 of line 250 as an
earlier version of `fli-image`'s comment there said (arithmetic: three 23-cycle blocks from
cycle 55 of line 247). Measured: with the swap made straight after the
loop, lines 249 and 250 of every frame showed the other image (204 pixels
wrong in the frame-B shot). The listing waits for raster line 251 first.

**The one-pixel shift.** A multicolour pixel is two hires pixels wide, so
two images drawn from the same grid cannot interleave by moving data;
XSCROLL can move the whole of B one hires pixel. Display column 0 of B
then shows the background and B's last pixel is under the right border,
as in `mci-interlace`. What the eye makes of the two frames on a CRT, and
how much it flickers, is not measured here.

**Colour RAM.** There is one colour RAM, not banked, so the `%11` colour
is the same in both images. The listing does not use `%11`.
