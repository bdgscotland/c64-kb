---
recipe: sprite-sine-chain
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprite_sine_chain]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D012, D015, D017, D01C, D01D, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, D02E]
uses_kernal: []
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Sprite Sine Chain

## Synopsis

Eight hardware sprites run round an ellipse as a chain, phased sixteen
table steps apart along one assembler-built sine table. X spans the whole
width, 0 to 343, so the table is split into low and high bytes and $D010
is rebuilt from the high bytes every frame. Y reads the same sine a
quarter period ahead of X. Positions are written once a frame at raster
line 255, below the display, and a frame counter is printed in hex at the
top left so a screenshot names its own frame. This is the `sprite_sine_chain`
technique; it is not a multiplexer, the eight sprites stay enabled all the
time.

Verified in VICE x64sc: at the pinned cycle count every sprite's left edge
and top row in the picture are where the table says, on PAL and on NTSC.

## Source

```asm
// sprite-sine-chain.asm
// Eight hardware sprites phased along one sine table. Each frame every
// sprite reads X from a 256-entry table at index (frame*STRIDE + n*PHASE)
// and Y from the same index plus a quarter period, so each sprite runs an
// ellipse and the eight together form a chain. X spans 0..343, so the
// table is split into a low byte and a high byte and $D010 is rebuilt
// every frame from the high bytes. The frame counter is printed in hex
// at the top left so a screenshot names its own frame.
//
// Region: both. Positions are written once a frame at raster line 255,
// below the display, so a frame is never torn. Nothing is cycle-exact.

.const SCREEN  = $0400
.const SPRDATA = $2000            // 64-byte aligned; pointer = $2000/64 = $80
.const STRIDE  = 2                // table steps per frame
.const PHASE   = 16               // table steps between adjacent sprites
.const YOFF    = 64               // Y reads a quarter period ahead of X
.const XMID    = 171.5            // X = XMID + XAMP*sin, so 0..343
.const XAMP    = 171.5
.const YMID    = 150              // Y = 100..200, inside the display
.const YAMP    = 50

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

    ldx #0                        // clear the screen
    lda #$20
clr:
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne clr

    ldx #9                        // row 0, columns 0-9: label + 4 hex digits
lbl:
    lda #12                       // grey text, not a sprite colour
    sta $d800,x
    cpx #6
    bcs !+
    lda label,x
    sta SCREEN,x
!:  dex
    bpl lbl

    ldx #7                        // pointers, colours, no expansion
setup:
    lda #SPRDATA/64
    sta SCREEN+$3f8,x
    lda colours,x
    sta $d027,x
    dex
    bpl setup
    lda #0
    sta $d017
    sta $d01d
    sta $d01c
    lda #$ff
    sta $d015

loop:
    lda #255                      // wait for raster line 255
!:  cmp $d012
    bne !-

    inc frame
    bne !+
    inc frame+1
!:
    lda frame                     // base index = frame * STRIDE (mod 256)
    asl                           // STRIDE is 2
    sta idx

    lda #0
    sta msb
    ldx #0                        // sprite number
next:
    ldy idx
    lda xlo,y
    sta xtmp
    lda xhi,y
    beq !+
    lda bits,x                    // this sprite is past X 255
    ora msb
    sta msb
!:  tya                           // Y reads the same table a quarter on
    clc
    adc #YOFF
    tay
    lda ysin,y
    ldy pairs,x                   // register pair = sprite * 2
    sta $d001,y
    lda xtmp
    sta $d000,y
    lda idx
    clc
    adc #PHASE
    sta idx
    inx
    cpx #8
    bne next
    lda msb
    sta $d010

    // frame counter, four hex digits after the label
    lda frame+1
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

frame:  .word 0
idx:    .byte 0
msb:    .byte 0
xtmp:   .byte 0

label:  .text "frame "            // lowercase: .text is screen codes
hex:    .text "0123456789abcdef"
bits:   .byte 1, 2, 4, 8, 16, 32, 64, 128
pairs:  .byte 0, 2, 4, 6, 8, 10, 12, 14
colours: .byte 1, 2, 3, 4, 5, 6, 7, 8

.align $100
xlo:  .fill 256, <round(XMID + XAMP * sin(toRadians(i * 360 / 256)))
xhi:  .fill 256, >round(XMID + XAMP * sin(toRadians(i * 360 / 256)))
ysin: .fill 256, round(YMID + YAMP * sin(toRadians(i * 360 / 256)))

.pc = SPRDATA "sprite"
// A 24x21 frame three pixels thick: every corner pixel is set, so the
// bounding box of a sprite's colour in a screenshot is its full 24x21.
.fill 3*3, $ff
.for (var r = 0; r < 15; r++) { .byte $e0, $00, $07 }
.fill 3*3, $ff
```

## Build

```bash
java -jar KickAss.jar sprite-sine-chain.asm -o sprite-sine-chain.prg
```

## Expected output

Black screen and border. Row 0 reads `FRAME nnnn` in grey, `nnnn` the frame
counter in hex, counting up once a frame. Eight hollow 24 by 21 squares in
colours 1 to 8 (white, red, cyan, purple, green, blue, yellow, orange for
sprites 0 to 7) run anticlockwise round an ellipse 344 pixels wide and 100
lines tall, one sprite every sixteen table steps, so the chain covers just
under half the ellipse. At the sides the squares slide under the border
and come back: the side borders have priority over sprites, so a sprite
past X 319 loses columns off its right and one below X 24 off its left.

### Reading a sprite's position off the picture

Screenshot column `x` is VIC X `x - 8` (screen X 24 is column 32,
`docs/runtime/vice-reference.md`). A sprite's first row is drawn on the
line after the one in its Y register, and the picture's row is the line
minus 16 on PAL and minus 28 on NTSC, so a sprite at (X, Y) has its top
left pixel at column `X + 8` and row `Y - 15` on PAL, `Y - 27` on NTSC.
Every figure below was measured with PIL as the bounding box of each
sprite's colour; the square's corner pixels are set, so the box is the
sprite unless the border cuts it.

### PAL, pinned: 8,000,000 cycles, frame $00FF (255)

Base index 2 × 255 = 510, so sprite n reads entry (254 + 16n) mod 256 for
X and that plus 64 for Y.

| Sprite | Table entry | X | Y | Predicted column, row | Measured box | Note |
|---|---|---|---|---|---|---|
| 0 white | 254 | 163 | 200 | 171, 185 | x 171 to 194, y 185 to 205 | |
| 1 red | 14 | 229 | 197 | 237, 182 | x 237 to 260, y 182 to 202 | |
| 2 cyan | 30 | 287 | 187 | 295, 172 | x 295 to 318, y 172 to 192 | MSB set |
| 3 purple | 46 | 327 | 171 | 335, 156 | x 335 to 351, y 156 to 176 | MSB set; 7 columns under the border |
| 4 green | 62 | 343 | 152 | 351, 137 | x 351 only, y 137 to 155 | MSB set; one column shows |
| 5 blue | 78 | 333 | 133 | 341, 118 | x 341 to 351, y 118 to 138 | MSB set; 13 columns under the border |
| 6 yellow | 94 | 299 | 116 | 307, 101 | x 307 to 330, y 101 to 121 | MSB set |
| 7 orange | 110 | 245 | 105 | 253, 90 | x 253 to 276, y 90 to 110 | |

All eight left edges and top rows match the prediction; $D010 is $7C. The
green square shows one column, at 351, because 343 is the last display
column; the picture's right border starts at 352.

### NTSC, pinned: 8,000,000 cycles, frame $011F (287)

NTSC frames are shorter, so the same cycle count is 32 frames further on.
Base index 574, sprite n reads entry (62 + 16n) mod 256: the NTSC picture
is the PAL chain moved on by four sprites.

| Sprite | Table entry | X | Y | Predicted column, row | Measured box | Note |
|---|---|---|---|---|---|---|
| 0 white | 62 | 343 | 152 | 351, 125 | x 351 only, y 125 to 145 | MSB set; one column shows |
| 1 red | 78 | 333 | 133 | 341, 106 | x 341 to 351, y 106 to 126 | MSB set |
| 2 cyan | 94 | 299 | 116 | 307, 89 | x 307 to 330, y 89 to 109 | MSB set |
| 3 purple | 110 | 245 | 105 | 253, 78 | x 253 to 276, y 78 to 98 | |
| 4 green | 126 | 180 | 100 | 188, 73 | x 188 to 211, y 73 to 93 | |
| 5 blue | 142 | 114 | 103 | 122, 76 | x 122 to 145, y 76 to 96 | |
| 6 yellow | 158 | 56 | 113 | 64, 86 | x 64 to 87, y 86 to 106 | |
| 7 orange | 174 | 16 | 129 | 24, 102 | x 32 to 47, y 102 to 122 | 8 columns under the left border |

All eight match; $D010 is $07. The orange square is at X 16, so its first
eight columns are under the left border and the box starts at column 32.

### A second frame, not pinned: PAL, 6,150,000 cycles, frame $00A1 (161)

Base index 322, entry (66 + 16n) mod 256. Sprites 0, 1 and 2 are past
255 here (X 343, 327, 287; $D010 = $07) where at frame 255 it was sprites
2 to 6. The other five are at X 229, 163, 98, 44 and 10; the orange
square at X 10 shows ten columns, 32 to 41. All eight measured boxes match
the table.

### Frame count and cycles

Rung 3 from the runs above: 8,000,000 cycles is about 407 PAL frames at
19,656 cycles each, and the counter reads 255, so about 152 frames (3
seconds) go to reset, BASIC and the autostart before the loop's first
frame. On both models the counter on row 0 and all eight sprites agree
with one frame, so the exit did not land between the counter and the
chain; a different cycle count can (`docs/runtime/vice-reference.md`).

Screenshots from the VICE runs this page describes:
`screenshots/sprite-sine-chain.png` (PAL) and
`screenshots/sprite-sine-chain-ntsc.png`.

## Why this works

### The 9-bit X in two tables

`.fill 256, <round(...)` and `.fill 256, >round(...)` give the low and
high bytes of every X at assembly time, so the loop never adds. The high
byte is 0 or 1; `beq` skips the mask update when it is 0, otherwise the
sprite's bit from `bits` is ORed into `msb`. `$D010` is written once,
after the sixteen position registers, so the low byte and the MSB of every
sprite change in the same update. Written in the other order, a sprite
crossing 255 would briefly pair the new MSB with the old low byte; below
the window nothing is being drawn, so here the order is habit rather than
necessity.

### One table, three uses

`ysin` is the same sine as `xlo`/`xhi` with a different centre and
amplitude. The Y index is the X index plus 64, a quarter period, so each
sprite follows a circle stretched to 344 by 100. The 8-bit index arithmetic
wraps on its own and the three tables are page-aligned (`.align $100`), so
no indexed read crosses a page and every iteration costs the same. Sprite
`n` starts at `base + 16n`: adjacent sprites are 16 steps apart, and the
eighth is 112 steps behind the first.

### Writing in the blank

`lda #255 / cmp $d012 / bne` waits for raster line 255, which is below
the 200-line window on both models (PAL has 312 lines, NTSC 263). The
update takes about ten lines (rung 3 from the instruction costs, not
measured with a timer), so by the time the loop returns the raster has
left 255; the second wait at the end is there in case a shorter update is
substituted. Because the eight sprites are set once, between frames, no
sprite is ever split between two positions, and the exit screenshot shows
one consistent frame.

### Screen codes and the measurement

`.text` in KickAssembler is screen codes, and the default mixed encoding
maps upper-case letters to codes 65 to 90, which the upper-case character
set draws as graphics; the label and hex digits are therefore lower case
in the source and appear as capitals on screen. The first build of this
page had `FRAME` in capitals and printed six graphics characters. The
label is written in grey (colour 12) rather than the default because
sprite 0 is white, and a white label would join sprite 0's bounding box
in the measurement.
