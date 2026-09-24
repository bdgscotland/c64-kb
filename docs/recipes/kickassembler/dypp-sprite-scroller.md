---
recipe: dypp-sprite-scroller
toolchain: kickassembler
output_format: PRG
region: both
techniques: [dypp_sprite_sine_scroller]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D012, D015, D017, D01B, D01C, D01D, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DC04, DC05, DC0E]
uses_kernal: []
claims: [zero_page $FB-$FE (owns)]
harness: [cia1_timer_a, $02FF]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — DYPP Sprite Sine Scroller

## Synopsis

A text scroller built from the eight hardware sprites and nothing else:
no character buffer, no custom charset and no `$D016` fine scroll. Each
sprite carries one character, rendered when it is handed the character by
doubling an 8 by 8 glyph from the character ROM into a 2 by 2 block per
pixel inside its 24 by 21 image. A shared 9-bit scroll position `p` steps
down by 2 a frame; sprite `k` sits at `X = (p + 48k) mod 384` and bobs on
`Y = 130 + siny[(p + 32k) & 255]`, so every column rides the sine at its
own phase. A sprite is enabled only while its X is 0 to 343; when it
reaches X 4, where its glyph is wholly under the left border, it takes the
next character of the message and re-renders, and it comes back in from
the right at X 342 twenty-three frames later. After 300 frames `p` is
frozen, so the
pinned picture is static. The position update and each re-render are
timed with CIA 1 timer A and logged to RAM. This is the
`dypp_sprite_sine_scroller` technique.

Verified in VICE x64sc: at the pinned cycle count every visible glyph's
left edge and top row are where the table says, on PAL and on NTSC, and
`$D010` reads `$0C` for the two sprites past X 255. A control build with
the `$D010` write left out puts those two glyphs at X 14 and X 62 instead.

## Source

```asm
// dypp-sprite-scroller.asm
// DYPP: a text scroller made of the eight hardware sprites. Each sprite
// carries one character, rendered at hand-off time from the character ROM
// into its own 64-byte slot (a 2x2 block per glyph pixel, sprite rows 2..17,
// columns 4..19). A shared 9-bit scroll position p steps down by 2 a frame;
// sprite k sits at X = (p + 48k) mod 384 and Y = 130 + siny[(p + 32k) & 255],
// so each column bobs on its own phase. A sprite is enabled only while its
// X is 0..343; when X reaches 4 its glyph is wholly under the left border,
// it takes the next character of the text and re-renders, and it comes back
// in at X 342 twenty-three frames later. There is no character buffer and $D016
// is never touched. After FRAMES frames p is frozen and the picture is static.
//
// The position update and each re-render are timed with CIA 1 timer A
// (one-shot from $FFFF) and logged to RAM for a -moncommands dump.
// Region: both. Registers are written once a frame at raster line 255.

.const SCREEN  = $0400
.const SPRBASE = $2000            // eight 64-byte slots $2000..$21c0, pointers $80..$87
.const XSTEP   = 48               // pixels between adjacent columns
.const YMID    = 130
.const YAMP    = 40               // Y = 90..170, sprite rows to 191
.const FRAMES  = 300              // updates before p is frozen
.const ULOG    = $3000            // update time per frame, 2 bytes each ($ffff - timer)
.const RLOG    = $3400            // render time per hand-off, 2 bytes each
.const DONE    = $02ff            // written once when the picture is frozen

.const ptr = $fb                  // zero page: sprite slot pointer
.const src = $fd                  // zero page: character ROM pointer

// Each glyph bit becomes two sprite bits: dbl(b) is the 16-bit doubling of
// byte b. Glyph column gx lands on sprite columns 4+2gx and 5+2gx, so
// byte 0 of the sprite row takes the top 4 bits of dbl, byte 1 the middle 8
// and byte 2 the bottom 4 shifted into its high nibble.
.function dbl(b) {
    .var e = 0
    .for (var i = 0; i < 8; i++) {
        .if (((b >> i) & 1) == 1) .eval e = e | (3 << (2 * i))
    }
    .return e
}

.pc = $0801 "basic"
:BasicUpstart(start)

.pc = $0810 "code"
start:
    sei
    lda #0
    sta $d020
    sta $d021
    sta frame
    sta frame+1
    sta tidx
    sta rcount
    sta DONE
    lda #<6                       // p starts at 6: sprite 0 reaches X 4 on frame 1
    sta pos
    lda #>6
    sta pos+1

    // stopwatch overhead: an empty bracket
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$19
    sta $dc0e
    lda #$08
    sta $dc0e
    lda $dc04
    sta ovh
    lda $dc05
    sta ovh+1

    ldx #0                        // clear the screen and the eight slots
    lda #$20
clr:
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne clr
    lda #0
clr2:
    sta SPRBASE,x
    sta SPRBASE+$100,x
    inx
    bne clr2

    ldx #9                        // row 0: "frame" and four hex digits, grey
lbl:
    lda #12
    sta $d800,x
    cpx #6
    bcs !+
    lda label,x
    sta SCREEN,x
!:  dex
    bpl lbl

    ldx #7                        // pointers $80+k, one colour, no expansion
setup:
    txa
    clc
    adc #SPRBASE/64
    sta SCREEN+$3f8,x
    lda #7
    sta $d027,x
    dex
    bpl setup
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    sta $d01b
    sta $d015                     // enabled per sprite by the update

loop:
    lda #255                      // wait for raster line 255
!:  cmp $d012
    bne !-

    lda frame+1                   // frozen after FRAMES updates
    cmp #>FRAMES
    bne go
    lda frame
    cmp #<FRAMES
    bne go
    lda #1
    sta DONE
halt:
    jmp halt

go:
    inc frame
    bne !+
    inc frame+1
!:
    lda pos                       // p = (p - 2) mod 384
    sec
    sbc #2
    sta pos
    lda pos+1
    sbc #0
    sta pos+1
    bpl !+
    lda pos
    clc
    adc #<384
    sta pos
    lda pos+1
    adc #>384
    sta pos+1
!:
    lda #$ff                      // start the stopwatch
    sta $dc04
    sta $dc05
    lda #$19
    sta $dc0e

    lda #0
    sta msb
    sta ena
    sta pend
    lda pos                       // running X = p + 48k, 16-bit
    sta xl
    sta yi                        // running Y index = (p + 32k) & 255
    lda pos+1
    sta xh
    ldx #0
next:
    lda xh                        // X >= 384 ? X -= 384
    beq inrange
    cmp #1
    bne sub384
    lda xl
    cmp #<384
    bcc inrange
sub384:
    lda xl
    sec
    sbc #<384
    sta xl
    lda xh
    sbc #>384
    sta xh
inrange:
    lda xl
    sta sxlo,x
    lda xh
    sta sxhi,x
    beq onscreen                  // X < 256: on screen, no MSB
    lda xl
    cmp #344-256
    bcs offscreen                 // X 344..383: sprite off this frame
    lda bits,x                    // X 256..343: MSB set
    ora msb
    sta msb
onscreen:
    lda bits,x
    ora ena
    sta ena
offscreen:
    lda xh                        // X == 4: glyph wholly under the left border
    bne nohand
    lda xl
    cmp #4
    bne nohand
    inx                           // pend = k + 1
    stx pend
    dex
nohand:
    ldy yi
    lda siny,y
    clc
    adc #YMID
    sta sy,x
    ldy pairs,x
    sta $d001,y
    lda xl
    sta $d000,y
    lda xl                        // next column: X += 48, Y index += 32
    clc
    adc #XSTEP
    sta xl
    bcc !+
    inc xh
!:  lda yi
    clc
    adc #32
    sta yi
    inx
    cpx #8
    beq !+
    jmp next
!:  lda msb
#if !NOMSB
    sta $d010                     // the control build omits this write
#endif
    lda ena
    sta $d015

    lda #$08                      // stop the stopwatch, log it at ULOG + 2*(frame-1)
    sta $dc0e
    lda frame
    sec
    sbc #1
    sta ptr
    lda frame+1
    sbc #0
    asl ptr
    rol
    clc
    adc #>ULOG
    sta ptr+1
    ldy #0
    lda $dc04
    sta (ptr),y
    iny
    lda $dc05
    sta (ptr),y

    lda pend                      // a sprite reached X 4: hand it the next character
    beq nohandoff
    tax
    dex
    ldy tidx
    lda text,y
    cmp #$ff
    bne !+
    ldy #0
    sty tidx
    lda text
!:  sta code
    inc tidx
    lda #$ff                      // time the render on its own
    sta $dc04
    sta $dc05
    lda #$19
    sta $dc0e
    jsr render
    lda #$08
    sta $dc0e
    lda rcount
    asl
    tay
    lda $dc04
    sta RLOG,y
    lda $dc05
    sta RLOG+1,y
    inc rcount
nohandoff:

    lda frame+1                   // frame counter in hex after the label
    lsr
    lsr
    lsr
    lsr
    tax
    lda hex,x
    sta SCREEN+6
    lda frame+1
    and #$0f
    tax
    lda hex,x
    sta SCREEN+7
    lda frame
    lsr
    lsr
    lsr
    lsr
    tax
    lda hex,x
    sta SCREEN+8
    lda frame
    and #$0f
    tax
    lda hex,x
    sta SCREEN+9

!:  lda $d012                     // leave line 255 before waiting again
    cmp #255
    beq !-
    jmp loop

// Render screen code `code` into sprite slot X (0..7). The eight glyph
// bytes are copied out of the character ROM with $01 = $33, then each is
// expanded through three tables into two identical sprite rows.
render:
    lda slotlo,x
    sta ptr
    lda slothi,x
    sta ptr+1
    lda #0
    sta src+1
    lda code                      // ROM address = $d000 + code * 8
    asl
    rol src+1
    asl
    rol src+1
    asl
    rol src+1
    sta src
    lda src+1
    ora #$d0
    sta src+1
    lda #$33
    sta $01
    ldy #7
!:  lda (src),y
    sta gbuf,y
    dey
    bpl !-
    lda #$37
    sta $01
    .for (var r = 0; r < 8; r++) {
        ldx gbuf+r
        lda t0,x                  // sprite rows 2+2r and 3+2r, bytes 0..2
        ldy #6*r+6
        sta (ptr),y
        ldy #6*r+9
        sta (ptr),y
        lda t1,x
        ldy #6*r+7
        sta (ptr),y
        ldy #6*r+10
        sta (ptr),y
        lda t2,x
        ldy #6*r+8
        sta (ptr),y
        ldy #6*r+11
        sta (ptr),y
    }
    rts

label:  .text "frame "            // lowercase: .text is screen codes
hex:    .text "0123456789abcdef"
bits:   .byte 1, 2, 4, 8, 16, 32, 64, 128
pairs:  .byte 0, 2, 4, 6, 8, 10, 12, 14
slotlo: .fill 8, <(SPRBASE + i * 64)
slothi: .fill 8, >(SPRBASE + i * 64)

// The message: screen codes, $ff ends it and it wraps.
text:   .text "eight sprites carry the words and each column bobs on its own sine    "
        .byte $ff

.align $100
t0:   .fill 256, dbl(i) >> 12
t1:   .fill 256, (dbl(i) >> 4) & $ff
t2:   .fill 256, (dbl(i) & $0f) << 4
siny: .fill 256, (round(YAMP * sin(toRadians(i * 360 / 256))) + 256) & $ff

.pc = $3800 "state" virtual
sxlo:   .fill 8, 0                // shadow X low bytes, this frame
sxhi:   .fill 8, 0                // shadow X high bytes
sy:     .fill 8, 0                // shadow Y
msb:    .byte 0                   // $d010 as written
ena:    .byte 0                   // $d015 as written
pend:   .byte 0                   // sprite number + 1 due a hand-off, or 0
frame:  .word 0
pos:    .word 0                   // p, 0..383
tidx:   .byte 0                   // next character of text
rcount: .byte 0                   // renders so far
ovh:    .word 0                   // stopwatch reading of an empty bracket
xl:     .byte 0
xh:     .byte 0
yi:     .byte 0
code:   .byte 0
gbuf:   .fill 8, 0
```

## Build

```bash
java -jar KickAss.jar dypp-sprite-scroller.asm -o dypp-sprite-scroller.prg
```

## Expected output

Black screen and border. Row 0 reads `FRAME nnnn` in grey, the frame
counter in hex, counting up once a frame until it stops at `012C` (300).
Below it, yellow capital letters 16 pixels wide and 16 tall (each glyph
pixel is a 2 by 2 block) drift left two pixels a frame, 48 pixels apart,
each riding up and down its own sine 40 lines either side of Y 130, one
sine phase step of 32 between neighbours. The message is
`EIGHT SPRITES CARRY THE WORDS AND EACH COLUMN BOBS ON ITS OWN SINE`,
followed by four spaces, repeating. The first character enters at the
right edge about twenty frames in; before that the sprites are blank.
Usually seven of the eight sprites are on screen and the eighth is
between X 344 and X 383, disabled, carrying the character that comes
next. When `p mod 48` is 0, 2, 4 or 6 (4 of the 24 phases) no sprite is
in that gap and all eight are enabled, the last at X 336 to 342, partly
under the right border. (An earlier version said at most seven are ever
on screen; arithmetic from the 48-pixel spacing, not measured here.)

At frame 300 the picture freezes and holds. It shows, left to right,
`S P R I T E` with a space before the `S`.

### How the glyph lands in the sprite

Sprite row `r` is bytes `3r`, `3r + 1` and `3r + 2` of the 64-byte slot.
Glyph row `gy` (0 to 7) is written to sprite rows `2 + 2gy` and
`3 + 2gy`; glyph column `gx` (0 is the leftmost bit) becomes sprite
columns `4 + 2gx` and `5 + 2gx`. So the 8 by 8 glyph fills sprite rows 2
to 17 and columns 4 to 19, with two blank rows above, three below and
four blank columns each side. The three tables `t0`, `t1`, `t2`, built by
the assembler from `dbl(b)`, the 16-bit bit-doubling of byte `b`, give
the three bytes of a sprite row for any glyph byte: byte 0 holds
`dbl >> 12` in its low nibble, byte 1 the middle eight bits, byte 2 the
low four bits of `dbl` in its high nibble. The 15 bytes outside rows 2 to
17 are zeroed once at start and never written again; a re-render writes
the 48 bytes of rows 2 to 17.

The eight slots are `$2000 + 64k`, `$2000` to `$21C0`, pointers `$80` to
`$87` at `$07F8 + k`. All eight are yellow (colour 7), single colour,
unexpanded.

### Reading a glyph's position off the picture

Screenshot column `x` is VIC X `x - 8` and a sprite's first row is drawn
on the line after the one in its Y register; the picture's row is the
line minus 16 on PAL and minus 28 on NTSC
(`docs/runtime/vice-reference.md`). The glyph starts at sprite column 4
and row 2, and the ROM capitals in this message have their first ink in
glyph column 1 except `I`, whose first ink is in column 2, so a glyph's
leftmost lit column is `X + 8 + 4 + 2` for most letters and `X + 8 + 4 +
4` for `I`. These capitals have ink in glyph rows 0 to 6, so a glyph's
top lit row is `Y - 15 + 2`, that is `Y - 13`, on PAL (`Y - 25` on NTSC)
and its bottom lit row 13 below that. The figures below were measured with PIL as the bounding
box of yellow (255, 255, 70 on PAL, 255, 248, 141 on NTSC) in each
column cluster.

### PAL, pinned: 10,000,000 cycles, frame 300 frozen

`p` after 300 steps of 2 from 6 is `(6 - 600) mod 384 = 174`. The
message index at hand-off `n` is `n`; sprite `k` was handed characters
`k` and `k + 8`, sprites 0 to 4 twice and 5 to 7 once by frame 300. The
whole table was also read back from RAM (`$3800`, the shadow copy the
loop keeps) and from `$D000` to `$D010` with a `-moncommands` store trace
on `$02FF`, which the program writes once when it freezes; the dump
matches this table on both models.

| Sprite | Character | X | siny index | Y | On screen | $D010 bit | Predicted column, row | Measured box |
|---|---|---|---|---|---|---|---|---|
| 0 | `R` (char 8) | 174 | 174 | 94 | yes | 0 | 188, 81 | x 188 to 199, y 81 to 94 |
| 1 | `I` (char 9) | 222 | 206 | 92 | yes | 0 | 238, 79 | x 238 to 245, y 79 to 92 |
| 2 | `T` (char 10) | 270 | 238 | 113 | yes | 1 | 284, 100 | x 284 to 295, y 100 to 113 |
| 3 | `E` (char 11) | 318 | 14 | 143 | yes | 1 | 332, 130 | x 332 to 343, y 130 to 143 |
| 4 | `S` (char 12) | 366 | 46 | 166 | no, disabled | 0 | not drawn | none |
| 5 | space (char 5) | 30 | 78 | 168 | yes, blank | 0 | no ink | none |
| 6 | `S` (char 6) | 78 | 110 | 147 | yes | 0 | 92, 134 | x 92 to 103, y 134 to 147 |
| 7 | `P` (char 7) | 126 | 142 | 117 | yes | 0 | 140, 104 | x 140 to 151, y 104 to 117 |

`$D010` is `$0C` (bits 2 and 3) and `$D015` is `$EF` (all but sprite 4).
Sprite 4's low byte is written (110) but its enable bit is clear, so its
MSB is left out of the mask. The VIC registers read back as X low bytes
174, 222, 14, 62, 110, 30, 78, 126 and Y 94, 92, 113, 143, 166, 168,
147, 117. All six visible glyphs match their predicted column and row.
`DONE` (`$02FF`) is stored at cycle 8,880,950, so at 10,000,000 the
picture has been static for about 57 PAL frames; the exit lands in a
frame identical to the one before it.

### NTSC, pinned: 10,000,000 cycles, frame 300 frozen

The same state: NTSC frames are shorter, so the freeze comes earlier,
`$02FF` stored at cycle 8,239,296, and the picture is then static for
about 103 NTSC frames. The same X, Y, `$D010` and `$D015` read back. The
six visible boxes are the PAL boxes with every row 12 less: `R` x 188 to
199, y 69 to 82; `I` x 238 to 245, y 67 to 80; `T` x 284 to 295, y 88 to
101; `E` x 332 to 343, y 118 to 131; `S` x 92 to 103, y 122 to 135; `P`
x 140 to 151, y 92 to 105.

### Mid-motion, not pinned: 6,000,000 cycles

PAL: the counter reads `009A` (154) but the five visible glyphs are at
the positions of frame 153, `p = 84`: `E` at column 98 (X 84), `I` at
148 (X 132), `G` at 194 (X 180), `H` at 242 (X 228), `T` at 290
(X 276), each two columns right of the frame-154 value. The counter is
written at line 255 with the new positions, the counter's row is line 51
to 58 and the first glyph row is line 96, so the exit landed with the
beam between them: rows above it show the new field, rows below the
previous one, which is the rule in `docs/runtime/vice-reference.md`.
Sprite 7 is still blank at X 36 (its first hand-off is frame 169) and
sprite 5 carries a space at X 324. NTSC: the counter reads `00A9` (169)
and the glyphs are at frame 169's positions, `p = 52`: `E` at 66, `I`
at 116, `G` at 162, `H` at 210, `T` at 258; sprite 6's `S` at X 340 is
under the right border (its first ink column would be 354, past the
last visible column 351) and sprite 7 has just taken `R` at X 4, under
the left one.

### The control: `$D010` never written

Built with `-define NOMSB`, which drops the one `sta $d010`, and run to
the same 10,000,000 cycles. PAL: sprites 2 and 3, which should be at X
270 and 318, appear at X 14 and X 62, their low bytes alone: `T` shows
columns 32 to 39 (its left half under the border) and `E` columns 76 to
87, both at their correct rows (100 to 113 and 130 to 143). The other
four glyphs are where the pinned table puts them. NTSC gives the same
columns with the rows 12 less. That is the pitfall
`sprite_x_high_bit_wrong_register` on purpose: the MSB never set, the
sprite is drawn 256 pixels left of where it belongs.

### Cycle costs, CIA 1 timer A

Timer A is loaded with `$FFFF`, started one-shot (`$DC0E = $19`),
stopped (`$DC0E = $08`) and read; the cost is `$FFFF` minus the reading.
An empty bracket reads 5, and the figures below are raw, with that 5
still in them. Every value was read back from the logs at `$3000` (one
16-bit entry per frame, 300 of them) and `$3400` (one per hand-off) with
the same `-moncommands` dump; PAL and NTSC logs are identical to the
cycle.

- **Position update, eight sprites**, from the timer start after `p` has
  stepped to the timer stop after the `$D015` write: 1,147 cycles in 218
  of the 300 frames, minimum 1,091 (4 frames), maximum 1,154 (11
  frames); the other values are 1,114 (21), 1,121 (2) and 1,124 (44).
  The spread is the branches: how many of the eight columns need the 384
  subtracted, how many are past 255, whether one is off, and whether one
  is at X 4. The update runs from line 255, below the display, so no
  badline or sprite fetch is inside the bracket on either model.
- **One character re-render**, the `jsr render` alone: 715 cycles, the
  same for all thirteen hand-offs in the run. That is the eight-byte ROM
  copy with `$01` at `$33` plus 48 stores through the three tables.

Rung 3 from those: a frame with a hand-off costs 1,869 cycles at most
(1,154 + 715; a typical frame with a hand-off is 1,862, 1,147 + 715),
about 30 raster lines on PAL, all of it below the display.

Screenshots from the pinned runs: `screenshots/dypp-sprite-scroller.png`
(PAL) and `screenshots/dypp-sprite-scroller-ntsc.png`. Two runs of each
pinned command produced byte-identical files.

## Why this works

### Sprites instead of a charset

A DYCP scroller (`recipes/kickassembler/dycp-scroller.md`) moves a glyph
to any pixel row by copying it into a strip of a custom charset, and
scrolls it sideways with `$D016` and a ring buffer. Here the hardware
does both: a sprite's Y register is a pixel row and its X register a
pixel column, so a column's height and its scroll are two register
writes. Nothing is copied per frame. The limit is that there are eight
sprites, so eight columns, and a sprite image is 24 pixels wide, so the
columns sit 48 apart and each one carries a doubled 16 by 16 glyph.

### The 9-bit X and the mask

`X = (p + 48k) mod 384` is kept as a 16-bit running sum: `p`, then 48
added per column with the carry into the high byte, and 384 subtracted
once when the sum reaches it. The low byte goes to `$D000 + 2k` as it
is; the high byte decides three things. Zero: the sprite is on screen
and its `$D010` bit is clear. One with a low byte under 88 (X 256 to
343): on screen, bit set. One with a low byte of 88 or more (X 344 to
383): the sprite is disabled in `$D015` this frame and its bit is left
clear. The mask and the enable byte are built in two locals and written
once each after the loop, so every sprite's low byte, MSB and enable
change in the same update. The 40 pixels between 344 and 383 are the
gap a sprite spends off screen. With 48-pixel spacing and 384 for the
lap, one sprite is in it on 20 of the 24 even phases of `p mod 48`; on
the other four (0 to 6) the nearest sprite is at X 336 to 342 and none
is disabled. (An earlier version said one sprite is always in it.)

### The hand-off at X 4

`X` is always even (`p` starts even and steps by 2, and 48, 32 and 384
are even), so a column passes X 4 exactly once a lap. At X 4 the glyph
occupies X 8 to 23, all under the left border, which ends at X 23, so
the character can change without a visible glitch. The loop records the
sprite number and the re-render is done after the registers are
written, from the message index `tidx`, which wraps at the `$FF` that
ends the text. Sprite 0 starts at X 6 so that its first hand-off is on
frame 1, and the message then streams in one character per 24 frames.
Before its first hand-off a sprite shows the zeros the slots were
cleared to.

### The render

The eight glyph bytes are read from the character ROM at
`$D000 + code * 8` with `$01` set to `$33`, which maps the ROM over the
I/O page, into an eight-byte buffer, and `$01` goes back to `$37` before
anything touches a register. Interrupts are off throughout (`sei` at
start), so no handler runs while I/O is hidden. Then each glyph byte is
an index into `t0`, `t1` and `t2`, and each table value is stored twice
through the zero-page pointer, at the two sprite rows the glyph row
becomes. The unrolled `.for` gives every store a constant `Y`, so the
render is straight-line code and its 715 cycles do not vary.

### The sine

`siny` is `round(40 sin)` as a signed byte, added to 130. The amplitude
is well under 128, so no entry reaches 256 and wraps to zero, the
failure `sine_table_peak_wraps_to_zero` in `docs/pitfalls/maths.md`
describes for amplitude 128. Sprite `k` reads the table at
`(p + 32k) & 255`, the low byte of `p` plus 32 per column, so
neighbours are an eighth of a period apart and the eight span seven
eighths of the wave.

## What it does not establish

Nothing here was run on hardware; the positions, the `$D010` behaviour
and the cycle counts are VICE x64sc figures. It shows eight columns and
no more; a wider scroller needs a multiplexer, which this recipe does not
build. The glyphs are single-colour doublings of the ROM capitals;
multicolour or hand-drawn sprite fonts are not tried. The 300-frame
freeze is for the pin, not part of the technique.
