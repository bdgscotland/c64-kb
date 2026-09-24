---
recipe: sprite-priority-classes
toolchain: kickassembler
output_format: PRG
region: both
techniques: [mob_priority, sprite_collision_detect]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D012, D015, D016, D017, D018, D01B, D01C, D01D, D01E, D01F, D020, D021, D022, D023, D025, D026, D027, D028, D029, D02A, D02B, D02C, D02D, D02E]
uses_kernal: []
claims: [vic_char_base (owns), sprite_0-7 (owns)]
harness: [$02FF]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Sprite priority by pixel class

## Synopsis

Which pixels of a multicolour sprite go behind the playfield when its
`$D01B` bit is set, which playfield pixels count as foreground for that,
what happens where a background-priority sprite overlaps a foreground-priority
one, and which of those overlaps latch `$D01E` and `$D01F`. Eight sprites sit
still on blocks of one character each. The top of the screen is standard
text and the bottom multicolour text (`$D016` is switched at raster line
145 and switched back below the window), so both text modes are in one
picture. Each test character's rows cycle through the playfield pixel
classes and each multicolour test sprite's columns cycle through its own
classes (bit pairs 01, 10, 11), so every sprite is a grid of sprite class
against playfield class, readable from the exit screenshot alone. The program reads both collision registers once, two frames after
clearing them, and turns the border green with `$02FF` = 1 when they equal
the compiled-in expectation, red with `$02FF` = 2 otherwise. It is the
`mob_priority` and `sprite_collision_detect` techniques from
`docs/techniques/sprite.md`.

Verified in VICE x64sc: border green, row 0 reads `PRIORITY 30 3F`, and
the pixel table below holds on PAL and on NTSC.

## Source

```asm
// sprite-priority-classes.asm
// Which pixels of a multicolour sprite go behind the playfield when its
// $D01B bit is set, which playfield pixels count as foreground, and which
// of those latch $D01F. The top of the screen is standard text, the
// bottom multicolour text ($D016 switched at raster line 145 and back
// below the window). Every test sprite sits on a block of one character
// whose rows cycle through the playfield pixel classes, and the sprite's
// own columns cycle through its pixel classes, so the picture is a grid
// of sprite class against playfield class.
//
//   sprites 0 and 1: multicolour, over a hires cell (rows 0-3 clear,
//                    4-7 set); 0 has $D01B clear, 1 has it set
//   sprites 2 and 3: the same over a multicolour cell whose row pairs
//                    are bit pairs 00, 01, 10, 11; 2 clear, 3 set
//   sprites 4 and 5: hires solid blocks overlapping by 12 pixels over
//                    the hires cell; 4 has $D01B set, 5 has it clear
//   sprites 6 and 7: multicolour, over a cell of bit pair 01 only;
//                    6 clear, 7 set
//
// After two full frames $D01E and $D01F are read once and compared with
// the compiled-in expectation. $02FF is 1 and the border green on a
// match, 2 and red otherwise. Row 0 prints both registers in hex.
//
// Region: both. Nothing is cycle-exact.

.const SCREEN  = $0400
.const COLRAM  = $d800
.const CHARSET = $3000            // 2 KB copy of the ROM font, three glyphs replaced
.const SPRMC   = $2000            // pointer $80: multicolour class stripes
.const SPRHI   = $2040            // pointer $81: solid hires block
.const CH_HI   = $80              // rows 0-3 clear, rows 4-7 set
.const CH_MC   = $81              // row pairs 00, 01, 10, 11
.const CH_01   = $82              // every row bit pair 01
.const EXPECT_1E = %00110000      // sprites 4 and 5 overlap each other
.const EXPECT_1F = %00111111      // 0-5 touch foreground; 6 and 7 touch only pair 01
.const SPLIT   = 145              // last blank line before the multicolour rows

.pc = $0801 "basic"
:BasicUpstart(start)

.pc = $0810 "code"
start:
    sei
    lda #0
    sta $d020
    sta $d021
    sta $d015                     // sprites off while the screen is built
    sta $02ff

    sei                           // copy the ROM font under I/O
    lda $01
    pha
    lda #$33
    sta $01
    ldx #0
copy:
    .for (var p = 0; p < 8; p++) {
        lda $d000 + p*256,x
        sta CHARSET + p*256,x
    }
    inx
    bne copy
    pla
    sta $01

    ldx #7                        // the three test glyphs
glyphs:
    lda glyph_hi,x
    sta CHARSET + CH_HI*8,x
    lda glyph_mc,x
    sta CHARSET + CH_MC*8,x
    lda #%01010101
    sta CHARSET + CH_01*8,x
    dex
    bpl glyphs

    ldx #0                        // clear screen, white hires text colour
    lda #$20
clr:
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne clr
    ldx #0
    lda #1
clrcol:
    sta COLRAM,x
    sta COLRAM+$100,x
    sta COLRAM+$200,x
    sta COLRAM+$300,x
    inx
    bne clrcol

    ldx #7                        // row 0 label
lbl:
    lda label,x
    sta SCREEN,x
    dex
    bpl lbl

    // hires blocks, rows 3-5: columns 2-5, 8-11 and 16-22, glyph CH_HI, colour 1
    ldx #2
    jsr hi_block
    ldx #8
    jsr hi_block
    ldx #16
    jsr hi_block
    ldx #19
    jsr hi_block

    // multicolour blocks, rows 15-17: columns 2-5 and 8-11 glyph CH_MC,
    // columns 14-17 and 20-23 glyph CH_01, colour 8+6 so pair 11 is blue
    ldx #2
    lda #CH_MC
    jsr mc_block
    ldx #8
    lda #CH_MC
    jsr mc_block
    ldx #14
    lda #CH_01
    jsr mc_block
    ldx #20
    lda #CH_01
    jsr mc_block

    lda #$1c                      // screen $0400, font $3000
    sta $d018
    lda #2                        // multicolour text: pair 01 red, pair 10 green
    sta $d022
    lda #5
    sta $d023
    lda #7                        // sprite pair 01 yellow, pair 11 purple
    sta $d025
    lda #4
    sta $d026

    ldx #7
setup:
    lda ptrs,x
    sta SCREEN+$3f8,x
    lda colours,x
    sta $d027,x
    txa                           // registers are at $d000 + 2n
    asl
    tay
    lda sprx,x
    sta $d000,y
    lda spry,x
    sta $d001,y
    dex
    bpl setup
    lda #0
    sta $d010
    sta $d017
    sta $d01d
    lda #%11001111                // multicolour: 0-3, 6, 7
    sta $d01c
    lda #%10011010                // $D01B set: 1, 3, 4, 7
    sta $d01b
    lda #$ff
    sta $d015

    lda $d01e                     // clear anything latched during setup
    lda $d01f
    lda #3
    sta frames

loop:
    lda #SPLIT
!:  cmp $d012
    bne !-
    lda #$d8                      // multicolour text from here down
    sta $d016
    lda #251
!:  cmp $d012
    bne !-
    lda #$c8                      // standard text for the next frame's top
    sta $d016

    lda frames
    beq loop
    dec frames
    bne loop

    lda $d01e                     // the one read, two full frames after the clear
    sta got1e
    lda $d01f
    sta got1f

    ldx #10                       // print both at row 0, columns 10-14
    lda got1e
    jsr hex2
    inx
    lda got1f
    jsr hex2

    lda got1e                     // verdict
    cmp #EXPECT_1E
    bne fail
    lda got1f
    cmp #EXPECT_1F
    bne fail
    lda #1
    sta $02ff
    lda #5
    sta $d020
    jmp loop
fail:
    lda #2
    sta $02ff
    sta $d020
    jmp loop

// X = first column; three rows of four (or three) CH_HI cells from row 3
hi_block:
    ldy #2
!:  lda #CH_HI
    sta SCREEN + 3*40,x
    sta SCREEN + 4*40,x
    sta SCREEN + 5*40,x
    inx
    dey
    bpl !-
    rts

// X = first column, A = glyph; three rows of four cells from row 15, colour 14
mc_block:
    ldy #3
!:  sta SCREEN + 15*40,x
    sta SCREEN + 16*40,x
    sta SCREEN + 17*40,x
    pha
    lda #14
    sta COLRAM + 15*40,x
    sta COLRAM + 16*40,x
    sta COLRAM + 17*40,x
    pla
    inx
    dey
    bpl !-
    rts

// A = byte, X = screen column; writes two hex digits and leaves X after them
hex2:
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hexdig,y
    sta SCREEN,x
    inx
    pla
    and #$0f
    tay
    lda hexdig,y
    sta SCREEN,x
    inx
    rts

frames:  .byte 0
got1e:   .byte 0
got1f:   .byte 0

label:   .text "priority"        // $D01E then $D01F follow in hex
hexdig:  .text "0123456789abcdef"

glyph_hi: .byte $00, $00, $00, $00, $ff, $ff, $ff, $ff
glyph_mc: .byte $00, $00, $55, $55, $aa, $aa, $ff, $ff

// sprite n: X, Y, pointer, colour ($D027+n is pair 10 in multicolour)
sprx:    .byte 40, 88, 40, 88, 152, 164, 136, 184
spry:    .byte 74, 74, 170, 170, 74, 74, 170, 170
ptrs:    .byte SPRMC/64, SPRMC/64, SPRMC/64, SPRMC/64, SPRHI/64, SPRHI/64, SPRMC/64, SPRMC/64
colours: .byte 3, 3, 3, 3, 10, 13, 3, 3

.pc = SPRMC "sprites"
// columns 0-3 pair 01, 4-7 pair 10, 8-11 pair 11, all 21 rows
.for (var r = 0; r < 21; r++) { .byte %01010101, %10101010, %11111111 }
.byte 0
.pc = SPRHI
.fill 63, $ff
.byte 0
```

## Build

```bash
java -jar KickAss.jar sprite-priority-classes.asm -o sprite-priority-classes.prg
```

## Expected output

Green border, black screen, `PRIORITY 30 3F` in white on row 0: `$D01E`
read `$30` (sprites 4 and 5 touched each other) and `$D01F` read `$3F`
(sprites 0 to 5 touched foreground, sprites 6 and 7 did not). Below it,
two rows of test sprites:

- Rows 3 to 5 (standard text, white cells whose lower four lines are set):
  sprite 0 at X 40 and sprite 1 at X 88, both multicolour with yellow,
  cyan and purple columns; then sprites 4 (light red, `$D01B` set) and
  5 (light green, `$D01B` clear) overlapping by twelve pixels from X 152.
- Rows 15 to 17 (multicolour text, `$D022` red, `$D023` green, cell
  colour blue): sprites 2 and 3 at X 40 and X 88 over a cell whose row
  pairs are bit pairs 00, 01, 10 and 11; sprites 6 and 7 at X 136 and
  X 184 over a cell of bit pair 01 only, which draws solid red.

Sprites 1, 3, 4 and 7 have their `$D01B` bit set.

### The pixel table

Measured with PIL on both screenshots. A sprite at (X, Y) has its top
left pixel at column X + 8 and row Y - 15 on PAL, Y - 27 on NTSC
(`docs/runtime/vice-reference.md`). For each sprite the 24 by 21 box was
split into the three 8-pixel-wide sprite-class columns and into the row
classes the test character draws, and every pixel in each cell of the
grid was named by its colour. Each cell below was one colour on every
pixel; the count in brackets is the pixels in that cell.

Standard text cell (a 0 bit is 4 lines, a 1 bit is 4 lines per 8):

| Sprite, `$D01B` | Playfield | Sprite pair 01 | Sprite pair 10 | Sprite pair 11 |
|---|---|---|---|---|
| 0, clear | bit 0 | yellow (96) | cyan (96) | purple (96) |
| 0, clear | bit 1 | yellow (72) | cyan (72) | purple (72) |
| 1, set | bit 0 | yellow (96) | cyan (96) | purple (96) |
| 1, set | bit 1 | white (72) | white (72) | white (72) |

Multicolour text cell (two lines per bit pair):

| Sprite, `$D01B` | Playfield | Sprite pair 01 | Sprite pair 10 | Sprite pair 11 |
|---|---|---|---|---|
| 2, clear | pair 00 | yellow (48) | cyan (48) | purple (48) |
| 2, clear | pair 01 | yellow (48) | cyan (48) | purple (48) |
| 2, clear | pair 10 | yellow (40) | cyan (40) | purple (40) |
| 2, clear | pair 11 | yellow (32) | cyan (32) | purple (32) |
| 3, set | pair 00 | yellow (48) | cyan (48) | purple (48) |
| 3, set | pair 01 | yellow (48) | cyan (48) | purple (48) |
| 3, set | pair 10 | green (40) | green (40) | green (40) |
| 3, set | pair 11 | blue (32) | blue (32) | blue (32) |
| 6, clear | pair 01 only | yellow (168) | cyan (168) | purple (168) |
| 7, set | pair 01 only | yellow (168) | cyan (168) | purple (168) |

Sprite 4 (`$D01B` set, light red) and sprite 5 (`$D01B` clear, light
green), both solid hires, 5 twelve pixels to the right of 4, over the
standard text cell:

| Playfield | Sprite 4 alone (12 columns) | Overlap (12 columns) | Sprite 5 alone (12 columns) |
|---|---|---|---|
| bit 0 | light red (144) | light red (144) | light green (144) |
| bit 1 | white (108) | white (108) | light green (108) |

What the tables say:

1. The sprite's own pixel class never matters. Pairs 01, 10 and 11 of a
   multicolour sprite behave the same in every row of every table; the
   only thing `$D01B` distinguishes is a sprite pixel that is drawn from
   one that is transparent (pair 00).
2. The playfield's class is what decides. With the bit set, a 1 bit in
   standard text and pairs 10 and 11 in multicolour text cover the sprite;
   a 0 bit and pairs 00 and 01 show it. Pair 01 is background whatever
   colour it draws in: sprite 7 is entirely visible over a solid red cell
   of pair 01, and sprite 3's pair-01 rows show it where its pair-10 rows
   hide it.
3. `$D01F` follows the same classes: sprites 6 and 7 sit on nothing but
   pair 01 and latch no bit, the other six sit on 1 bits or pairs 10 and
   11 and latch theirs, `$D01B` set or clear. The read is `$3F`.
4. Sprite order is decided before the playfield is. In the overlap over a
   0 bit, sprite 4 shows, being the lower number, although sprite 5 is a
   foreground-priority sprite. Over a 1 bit the overlap is white: the
   playfield covers sprite 4 because its bit is set, and sprite 5 is not
   drawn there either, although its own bit is clear and it is drawn over
   the same 1 bits twelve pixels further right. The VIC picks one sprite
   per pixel first, the lowest number with a drawn pixel, and then applies
   that sprite's `$D01B` bit. A sprite behind the playfield therefore
   punches a hole in every higher-numbered sprite it overlaps wherever
   the playfield is foreground. `$D01E` still reads `$30`: the two
   sprites' drawn pixels overlapped, and the register does not care what
   was displayed.

### Cycles

4,000,000 cycles is about 203 PAL frames (rung 3, 19,656 cycles a frame);
the program's own work is over after its third frame in the loop and the
picture is then static, so any larger count gives the same picture. The
two shots are `screenshots/sprite-priority-classes.png` (PAL) and
`screenshots/sprite-priority-classes-ntsc.png`; each was byte-identical
over two runs of the pinned command.

## Why this works

### Two text modes in one frame

The multicolour flag in `$D016` is not latched per frame, so a write at
raster line 145 puts the rows below it in multicolour text and a write at
line 251, below the window on both models, restores standard text before
the next frame's top. Rows 11 and 12 are spaces, which draw nothing in
either mode, so the exact line the write lands on inside them does not
show. The row-0 text is in colour 1, below 8, so it would draw as standard
text even if the switch were early.

### One read, after the picture is settled

Enabling the sprites and then reading `$D01E` and `$D01F` throws away
whatever latched while the screen was being built. The loop then lets
three raster passes reach line 251 before the one read that counts, so the
registers hold two complete frames of the finished picture and nothing
else; the read clears them, and nothing reads them again
(`sprite_priority_collision_silent` in `docs/pitfalls/sprite.md`). The
expectation is compiled in, so a change in VICE's rule would turn the
border red rather than move a number.

### Why the classes are rows and columns

The character's rows carry the playfield class and the sprite's columns
carry the sprite class, so their product is visible as a grid inside one
24 by 21 box, and PIL can count each cell of the grid without knowing
anything but the two geometries. Had both varied along X, a
double-width multicolour sprite pixel would straddle two playfield
classes and no cell would be one colour.
