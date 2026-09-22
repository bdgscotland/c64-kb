---
recipe: sprite-multiplex-24
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprite_multiplex_24, sprite_multiplex_8]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D017, D019, D01A, D01C, D01D, D027]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — 24-Sprite Multiplexer

## Synopsis

Twenty-four sprites from eight hardware slots, in three fixed bands. Each
band is a horizontal strip of the screen holding eight logical sprites; a
raster IRQ above each band writes that band's eight sprites into the eight
hardware slots. The bands are far enough apart that every slot has finished
drawing band N's sprite before band N+1's IRQ rewrites it. Because the
animation keeps every sprite inside its band, this recipe does not need the
per-frame Y sort that a general multiplexer needs; the text says what you
give up for that.

Verified in VICE x64sc: three rows of eight sprites, three shapes, fifteen
colours, drifting right and bobbing.

## Source

```asm
// sprite-multiplex-24.asm
// Twenty-four sprites from eight hardware slots, in three fixed bands.
// Each band is a horizontal strip of the screen holding eight logical
// sprites; a raster IRQ above each band writes that band's eight sprites
// into the eight hardware slots. The bands are far enough apart that a
// slot is always finished with band N's sprite before band N+1's IRQ
// rewrites it. The animation keeps every sprite inside its band, which is
// what lets this recipe skip the per-frame Y sort a general multiplexer
// needs (see text).
//
// Region: both. Nothing here is cycle-exact; each IRQ has 17 lines of
// slack before the band it serves.

.const BANDS       = 3
.const BAND_Y      = 60      // top of band 0's sprite area
.const BAND_PITCH  = 64      // band N's sprites sit around BAND_Y + N*BAND_PITCH
.const BOB         = 8       // vertical bob amplitude in lines
.const IRQ_LEAD    = 17      // IRQ this many lines above the band's highest Y

.const SPRITE_PTRS = $07f8

BasicUpstart2(start)

// ---------------------------------------------------------------------------
// Sprite shapes: three 24x21 images at $2000, $2040, $2080 (pointers 128-130).
// ---------------------------------------------------------------------------
* = $2000
shape_ball:
    .byte $00,$7e,$00, $01,$ff,$80, $03,$ff,$c0, $07,$ff,$e0, $0f,$ff,$f0
    .byte $1f,$ff,$f8, $3f,$ff,$fc, $3f,$ff,$fc, $7f,$ff,$fe, $7f,$ff,$fe
    .byte $7f,$ff,$fe, $7f,$ff,$fe, $7f,$ff,$fe, $3f,$ff,$fc, $3f,$ff,$fc
    .byte $1f,$ff,$f8, $0f,$ff,$f0, $07,$ff,$e0, $03,$ff,$c0, $01,$ff,$80
    .byte $00,$7e,$00, $00
shape_diamond:
    .byte $00,$18,$00, $00,$3c,$00, $00,$7e,$00, $00,$ff,$00, $01,$ff,$80
    .byte $03,$ff,$c0, $07,$ff,$e0, $0f,$ff,$f0, $1f,$ff,$f8, $3f,$ff,$fc
    .byte $7f,$ff,$fe, $3f,$ff,$fc, $1f,$ff,$f8, $0f,$ff,$f0, $07,$ff,$e0
    .byte $03,$ff,$c0, $01,$ff,$80, $00,$ff,$00, $00,$7e,$00, $00,$3c,$00
    .byte $00,$18,$00, $00
shape_box:
    .byte $ff,$ff,$ff, $ff,$ff,$ff, $c0,$00,$03, $c0,$00,$03, $c0,$00,$03
    .byte $c0,$00,$03, $c0,$00,$03, $c0,$00,$03, $c0,$00,$03, $c0,$00,$03
    .byte $c0,$00,$03, $c0,$00,$03, $c0,$00,$03, $c0,$00,$03, $c0,$00,$03
    .byte $c0,$00,$03, $c0,$00,$03, $c0,$00,$03, $c0,$00,$03, $ff,$ff,$ff
    .byte $ff,$ff,$ff, $00

// ---------------------------------------------------------------------------
// Logical sprites 0-23: band N holds sprites 8N..8N+7.
// ---------------------------------------------------------------------------
* = $1000
spr_x_lo:  .fill 24, (24 + (i & 7) * 40 + floor(i / 8) * 12) & $ff
spr_x_hi:  .fill 24, floor((24 + (i & 7) * 40 + floor(i / 8) * 12) / 256)
spr_y:     .fill 24, BAND_Y + floor(i / 8) * BAND_PITCH
spr_base_y: .fill 24, BAND_Y + floor(i / 8) * BAND_PITCH
spr_ptr:   .fill 24, $2000 / 64 + mod(i, 3)
spr_col:   .fill 24, 1 + mod(i, 15)
spr_dx:    .fill 24, 1 + mod(i, 3)        // pixels per frame to the right
bob:       .fill 256, round(sin(toRadians(i * 360 / 256)) * BOB)
frame:     .byte 0

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d

    lda #$20                 // blank the screen, black on black
    ldx #0
!:  sta $0400, x
    sta $0500, x
    sta $0600, x
    sta $06e8, x
    inx
    bne !-
    lda #0
    sta $d020
    sta $d021
    lda #$ff
    sta $d015                // all eight slots on for the whole frame
    lda #0
    sta $d017                // no expansion
    sta $d01d
    sta $d01c                // hires sprites

    lda #<irq_band0
    sta $0314
    lda #>irq_band0
    sta $0315
    lda #$1b
    sta $d011
    lda #BAND_Y - BOB - IRQ_LEAD
    sta $d012
    lda #$01
    sta $d01a
    sta $d019
    cli
    jmp *

// ---------------------------------------------------------------------------
// WriteBand(n): copy logical sprites 8n..8n+7 into the eight hardware slots.
// 8 x (Y, X low, pointer, colour) plus the assembled $D010 byte: 176 cycles.
// ---------------------------------------------------------------------------
.macro WriteBand(n) {
    .for (var i = 0; i < 8; i++) {
        lda spr_y + n * 8 + i
        sta $d001 + i * 2
        lda spr_x_lo + n * 8 + i
        sta $d000 + i * 2
        lda spr_ptr + n * 8 + i
        sta SPRITE_PTRS + i
        lda spr_col + n * 8 + i
        sta $d027 + i
    }
    // X bit 8 for the eight slots, bit i = slot i.
    lda #0
    .for (var i = 7; i >= 0; i--) {
        lsr spr_x_hi + n * 8 + i     // bit 0 -> carry (and back again below)
        rol                          // shift it into A from the right
        rol spr_x_hi + n * 8 + i     // restore the table byte
    }
    sta $d010
}

.macro NextIRQ(handler, line) {
    lda #line
    sta $d012
    lda #<handler
    sta $0314
    lda #>handler
    sta $0315
    lda #$01
    sta $d019
}

// Band 0's IRQ also runs the animation: it fires after band 2 has finished
// (by line 60 + 2*64 + 8 + 21 = 217 at the latest) and before band 0 starts.
irq_band0:
    jsr animate
    WriteBand(0)
    NextIRQ(irq_band1, BAND_Y + 1 * BAND_PITCH - BOB - IRQ_LEAD)
    jmp $ea31                // KERNAL housekeeping once a frame

irq_band1:
    WriteBand(1)
    NextIRQ(irq_band2, BAND_Y + 2 * BAND_PITCH - BOB - IRQ_LEAD)
    jmp $ea81

irq_band2:
    WriteBand(2)
    NextIRQ(irq_band0, BAND_Y + 3 * BAND_PITCH - BOB - IRQ_LEAD)
    jmp $ea81

// ---------------------------------------------------------------------------
// Animation: drift right and wrap at X=344; bob around the band's base Y.
// Runs once per frame from irq_band0, in the gap between band 2 and band 0.
// ---------------------------------------------------------------------------
animate:
    inc frame
    ldx #23
!:  lda spr_x_lo, x
    clc
    adc spr_dx, x
    sta spr_x_lo, x
    bcc no_carry
    inc spr_x_hi, x
no_carry:
    lda spr_x_hi, x          // past X=344? back to X=0
    beq y_part
    lda spr_x_lo, x
    cmp #<344
    bcc y_part
    lda #0
    sta spr_x_lo, x
    sta spr_x_hi, x
y_part:
    txa
    asl
    asl
    asl                      // 8 sine steps of phase per sprite
    adc frame
    tay
    lda bob, y
    clc
    adc spr_base_y, x
    sta spr_y, x
    dex
    bpl !-
    rts
```

## Build

```bash
java -jar KickAss.jar sprite-multiplex-24.asm -o sprite-multiplex-24.prg
```

`-showmem` prints the memory map; the tables at $1000 and the shapes at
$2000 must not collide with the code at $0900, which the unrolled
`WriteBand` copies make about 900 bytes long.

## Expected output

A black screen with three rows of eight sprites, at Y ≈ 60, 124 and 188,
each sprite one of three shapes (ball, diamond, box) in one of fifteen
colours. Every sprite drifts right at one, two or three pixels per frame
and wraps from X=344 back to 0, and bobs up and down eight lines on a sine.
Sprites in a row overtake and overlap one another, so at any instant a few
may be hidden behind neighbours; the count is 24 in the register writes
whether or not all 24 are distinguishable in a single frame.

Screenshot from the VICE run this page describes: `screenshots/sprite-multiplex-24.png`.

## Why this works

### The reuse rule

The VIC-II compares each sprite's Y register with the raster line at cycle
55 of every line and turns that sprite's DMA on when they match. From then
on it draws 21 lines (42 if Y-expanded) from the pointer and X the
registers held when each line was drawn, and turns the DMA off. So a slot
whose sprite has finished — its Y plus 21 has passed — can be given a new
Y, X, pointer and colour, and will draw a second sprite lower down the same
frame. Eight slots, three passes, twenty-four sprites.

The rule that makes it safe is: rewrite a slot only after its current
sprite's last line and before its next sprite's first line. Here band 0's
sprites live in lines 52-89 (Y 60 ± 8, plus 21), band 1's in 116-153,
band 2's in 180-217. Band 1's IRQ fires at line 99, after band 0's lowest
possible last line (89) and 17 lines before band 1's highest possible first
line (116); band 2's at 163; band 0's at 227, after band 2 and long before
the next frame's band 0. Each IRQ has 17 lines, over a thousand cycles, to
do its 176 cycles of register writes plus the interrupt overhead, so it
does not need a stable entry.

### Why no sort

A general multiplexer sorts its logical sprites by Y every frame and hands
them out to slots in that order, because its sprites move freely and any
eight of them may be the next eight on screen. That sort is the expensive
and bug-prone part; the earlier version of this recipe had one, and it did
not work — among other things, it read the sprite Y through `lda spr_y`
without an index and its inner loop shuffled the wrong elements. This
recipe removes the need for it by construction: the animation keeps every
sprite within ±8 lines of its band's base Y, so the band membership never
changes and the slot assignment is static. That is a real restriction
(sprites cannot cross between bands), and it is the restriction most
simple games and intros accept. The sorted version is described under
`sprite_multiplex_24` in `docs/techniques/sprite.md`.

### $D010

X positions above 255 need bit 8, which lives in $D010 with one bit per
slot. `WriteBand` assembles the byte from the eight per-sprite high bytes
with `LSR table / ROL A / ROL table`: the first `LSR` drops the sprite's
bit 8 into the carry, `ROL A` shifts it into the accumulator, and the
second `ROL` puts it back in the table. Eight of those, from slot 7 down to
slot 0, leave slot 0's bit in bit 0.

### Housekeeping

Band 0's handler exits through `$EA31`, the KERNAL's interrupt service,
once per frame; the other two exit through `$EA81`, the register-restore
tail. CIA1 is masked so `$EA31`'s CIA read finds nothing, and the keyboard
and jiffy clock keep working. $D019 is acknowledged with a write of $01 in
every handler; unacknowledged, the VIC re-raises the interrupt on RTI.

### Region

`region: both`. Line numbers up to 227 are inside both PAL's 312 and
NTSC's 263 lines, and nothing is cycle-counted. On NTSC the bottom band's
sprites (to line 217) are close to the bottom border at about line 235 but
still inside it.
