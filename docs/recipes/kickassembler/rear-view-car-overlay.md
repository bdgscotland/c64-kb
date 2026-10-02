---
recipe: rear-view-car-overlay
toolchain: kickassembler
output_format: PRG
region: both
techniques: [rear_view_car_sprite, hires_sprite_overlay, sprite_luma_colours, multicolour_sprite_aspect, sprite_light_source_shading]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D015, D017, D01B, D01C, D01D, D020, D021, D025, D026, D027, D028, D029, D02A, D02B, D02C, D02D, D02E]
uses_kernal: []
claims: [sprite_0-7 (owns)]
---

<!-- doc-type: recipe -->

# KickAssembler: a racing car seen from behind, with hires overlays

## Synopsis

A player car for a behind-the-car racer, built the way the C64 Out Run
and Turbo Out Run car sprites are built: three multicolour sprites wide
by two high, unexpanded, so the car is 36 x 42 multicolour pixels, 72 x 42
on screen. Its three colours sit on three luminance levels: black outline,
red body, light red for surfaces lit from above and for the tail lights.
Two hires sprites lie over the middle column and add white at full
resolution: glints, a window reflection that steps one pixel per line,
and the plate text. The car art is text in the listing, packed into sprite
bytes at assembly time, so it can be read and edited in place. It
implements the techniques in `docs/techniques/sprite-art.md`.

Verified in VICE x64sc 3.10, PAL c64c (8565/8580/8521) and NTSC
(6567R8): the screenshot matches the art in the listing pixel for pixel.

## Source

```asm
// rear-view-car-overlay.asm
// A racing car seen from behind, drawn the way the C64 Out Run and Turbo
// Out Run rips are laid out: 3 multicolour sprites wide by 2 high
// (36 x 42 multicolour pixels, 72 x 42 screen pixels), unexpanded,
// in three colours on three luminance levels:
//   %01 = $D025 black       (outline, bumper, tyres)
//   %10 = $D027+n red       (the body's vertical faces)
//   %11 = $D026 light red   (surfaces lit from above, tail lights)
// Two hires sprites lie over the middle column and add white at full
// resolution: glints on the roof and deck lid, a reflection on the rear
// window that steps one pixel per line, and the plate text. A lower-numbered sprite is drawn in front, so each
// row's overlay takes the number just below its three body sprites:
// 0 over 1-3 on the top row, 4 over 5-7 on the bottom row. Each line then
// fetches four consecutively numbered sprites, one DMA group.
//
// The art is written as text below and packed into sprite bytes by
// KickAssembler's script language at assembly time.
// Region: both. Nothing is cycle-exact.

.const SCREEN = $0400
.const SPRITES = $2000            // pointers $80-$87
.const X0 = 136                   // left edge of the car, sprite X
.const Y0 = 120                   // top edge of the car, sprite Y

// '.' transparent, 'k' %01 ($D025), 'r' %10 (sprite colour), 'p' %11 ($D026)
.var car = List()
.eval car.add("...........kkkkkkkkkkkkkk...........")
.eval car.add("..........kppppppppppppppk..........")
.eval car.add("..........kppppppppppppppk..........")
.eval car.add(".........krrrrrrrrrrrrrrrrk.........")
.eval car.add(".........k................k.........")
.eval car.add("........k..................k........")
.eval car.add("........k..................k........")
.eval car.add(".......k....................k.......")
.eval car.add(".......k....................k.......")
.eval car.add("......k......................k......")
.eval car.add(".....kkkkkkkkkkkkkkkkkkkkkkkkkk.....")
.eval car.add("....kppppppppppppppppppppppppppk....")
.eval car.add("...kppppppppppppppppppppppppppppk...")
.eval car.add("..kprrrrrrrrrrrrrrrrrrrrrrrrrrrrpk..")
.eval car.add(".kprrrrrrrrrrrrrrrrrrrrrrrrrrrrrrpk.")
.eval car.add("kprrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrpk")
.eval car.add("krrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk")
.eval car.add("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
.eval car.add("kpppppppkrrrrrrrrrrrrrrrrrrkpppppppk")
.eval car.add("kpppppppkrrrrrrrrrrrrrrrrrrkpppppppk")
.eval car.add("kpppppppkrrrrrrrrrrrrrrrrrrkpppppppk")
.eval car.add("kpppppppkrrrrrrrrrrrrrrrrrrkpppppppk")
.eval car.add("kkkkkkkkkrrrrrrrrrrrrrrrrrrkkkkkkkkk")
.eval car.add("krrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrkkkkkkkkkkkkrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrkkkkkkkkkkkkrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrkkkkkkkkkkkkrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrkkkkkkkkkkkkrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrkkkkkkkkkkkkrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrkkkkkkkkkkkkrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk")
.eval car.add("krrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrk")
.eval car.add("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
.eval car.add("kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk")
.eval car.add("kkkkkkk......kk......kk......kkkkkkk")
.eval car.add("kkkkkkk......kk......kk......kkkkkkk")
.eval car.add("kkkkkkk......................kkkkkkk")
.eval car.add("kkkkkkk......................kkkkkkk")
.eval car.add("kkkkkkk......................kkkkkkk")
.eval car.add("kkkkkkk......................kkkkkkk")
.eval car.add("kkkkkkk......................kkkkkkk")

// Hires overlays, 24 x 21 each, 'w' = set (white). Top: over car rows
// 0-20 of the middle column; bottom: over rows 21-41.
.var top = List()
.eval top.add("........................")
.eval top.add("....wwwwwwwwwwww........")
.eval top.add("........................")
.eval top.add("........................")
.eval top.add(".............ww.........")
.eval top.add("............ww..........")
.eval top.add("...........ww...........")
.eval top.add("..........ww............")
.eval top.add(".........ww.............")
.eval top.add("........ww..............")
.eval top.add("........................")
.eval top.add("..wwwwwwww..............")
.for (var i = 0; i < 9; i++) .eval top.add("........................")
.var bot = List()
.for (var i = 0; i < 5; i++) .eval bot.add("........................")
.eval bot.add("......www.www.w.w.......")
.eval bot.add("......w...w...w.w.......")
.eval bot.add("......w...www.www.......")
.eval bot.add("......w...w.w...w.......")
.eval bot.add("......www.www...w.......")
.for (var i = 0; i < 11; i++) .eval bot.add("........................")

.function mcCode(ch) {
    .if (ch == "k") .return 1
    .if (ch == "r") .return 2
    .if (ch == "p") .return 3
    .return 0
}

.macro McSprite(rows, row0, col0) {
    .for (var y = 0; y < 21; y++) {
        .var s = rows.get(row0 + y)
        .for (var b = 0; b < 3; b++) {
            .var v = 0
            .for (var p = 0; p < 4; p++) {
                .var i = col0 + b * 4 + p
                .eval v = v * 4 + mcCode(s.substring(i, i + 1))
            }
            .byte v
        }
    }
    .byte 0
}

.macro HiSprite(rows) {
    .for (var y = 0; y < 21; y++) {
        .var s = rows.get(y)
        .for (var b = 0; b < 3; b++) {
            .var v = 0
            .for (var p = 0; p < 8; p++) {
                .var i = b * 8 + p
                .eval v = v * 2
                .if (s.substring(i, i + 1) == "w") .eval v = v + 1
            }
            .byte v
        }
    }
    .byte 0
}

.pc = $0801 "basic"
:BasicUpstart(start)

.pc = $0810 "code"
start:
    sei
    lda #11                       // dark grey border
    sta $d020
    lda #12                       // medium grey road
    sta $d021
    ldx #0
    lda #$20                      // clear the text screen to spaces
clr:
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$2e8,x
    inx
    bne clr

    lda #0                        // %01: black outline
    sta $d025
    lda #10                       // %11: light red, lit surfaces
    sta $d026
    ldx #7
setup:
    lda ptrs,x
    sta SCREEN+$3f8,x
    lda colours,x
    sta $d027,x
    txa
    asl
    tay
    lda sprx,x
    sta $d000,y
    lda spry,x
    sta $d001,y
    dex
    bpl setup
    lda #0
    sta $d010                     // all X below 256
    sta $d017                     // no expansion: the car is 72 x 42 pixels
    sta $d01d
    sta $d01b                     // all sprites in front of the background
    lda #%11101110                // 1-3 and 5-7 multicolour, 0 and 4 hires
    sta $d01c
    lda #$ff
    sta $d015
hold:
    jmp hold

//          top row: overlay, body L, M, R   bottom row: overlay, body L, M, R
ptrs:    .byte $80,   $82, $83,   $84,       $81,   $85, $86,   $87
colours: .byte 1,     2,   2,     2,         1,     2,   2,     2
sprx:    .byte X0+24, X0,  X0+24, X0+48,     X0+24, X0,  X0+24, X0+48
spry:    .byte Y0,    Y0,  Y0,    Y0,        Y0+21, Y0+21, Y0+21, Y0+21

.pc = SPRITES "sprites"
    :HiSprite(top)                // $80
    :HiSprite(bot)                // $81
    :McSprite(car, 0, 0)          // $82 top left
    :McSprite(car, 0, 12)         // $83 top middle
    :McSprite(car, 0, 24)         // $84 top right
    :McSprite(car, 21, 0)         // $85 bottom left
    :McSprite(car, 21, 12)        // $86 bottom middle
    :McSprite(car, 21, 24)        // $87 bottom right

```

## Build

```bash
java -jar "$KICKASS_JAR" rear-view-car-overlay.asm -o rear-view-car-overlay.prg
```

## Expected output

A dark grey border, a medium grey screen, and the car in the middle.
Screenshots: `screenshots/rear-view-car-overlay.png` (PAL) and
`screenshots/rear-view-car-overlay-ntsc.png` (NTSC), pinned in
`runs.json` at 8,000,000 cycles.

Measured with PIL on both pictures:

| Check | PAL | NTSC |
|---|---|---|
| Car bounding box | x 144–215, y 105–146 (72 x 42) | x 144–215, y 93–134 (72 x 42) |
| Raster line of the top row | 121 (sprite Y 120 + 1) | 121 |
| Pixels in a 76 x 46 window that differ from the listing's art (multicolour art, overlays on top) | 0 | 0 |
| Pixels by colour in the 72 x 42 box | road 908, black 790, red 996, light red 268, white 62 | the same counts |
| Even–odd pixel pairs that differ, white excluded | 0 | 0 |
| White runs that start on an odd column | 3 | 3 |

The last two rows are the overlay's point. Every multicolour pixel is two
screen pixels wide and starts on an even column. The three odd-column
white runs are the window reflection, which only a hires sprite can draw.

Sensitivity, measured on PAL: with the overlays renumbered behind their
body sprites (body 0–2 and 4–6, overlays 3 and 7), 50 of the 62 white
pixels disappear. The 12 that stay are the window reflection, which lies
over transparent body pixels. Every white pixel over black, red or light
red is hidden, because a lower-numbered sprite is drawn in front
(`hardware/vic-ii-reference.md`, "Priority").

## Why this works

`$D01C` makes sprites 1–3 and 5–7 multicolour and leaves 0 and 4 hires.
In a multicolour sprite bit pair 01 takes `$D025`, 10 the sprite's own
`$D027+n` and 11 `$D026` (`hardware/vic-ii-reference.md`). The two shared
registers carry the outline and the lit colour, which every car can share;
the per-sprite colour carries the body, so a rival car in another body
colour needs only different `$D027+n` values. Black, red and light red
are three luminance levels (0, 10 and 16 in Pepto's scale), so the car
still reads as shaded on a monochrome display.

Each overlay takes the number just below its row's three body sprites, so
a raster line fetches four consecutively numbered sprites. The KB's
measured DMA rule for a run of k sprites with no gap is 3 + 2k cycles a
line, 11 here; a gap in the numbering starts a second group with its own
3-cycle lead-in (`hardware/vic-ii-reference.md`, "Sprite DMA"). The
overlay doubles the sprites on the car's lines from three to four only
because it covers one column of three; a full overlay of all three
columns would need six sprites a line.

The art is written in `.eval car.add("...")` strings and packed by two
macros. `McSprite` reads four characters per byte from one 12-pixel
column of 21 rows; `HiSprite` reads eight. Nothing is cycle-exact: the
program sets the registers once and loops, so the picture is the same on
PAL and NTSC apart from the frame's vertical position.
