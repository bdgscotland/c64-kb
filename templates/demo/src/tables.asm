// tables.asm: the main part's data, built by the assembler. The sine tables
// round with KickAssembler's round(); tools/gen_expect.py recomputes them.

.align $100
// X swing, 0 to 2 * CHAIN_AX: added to base_n = CHAIN_X0 + n * CHAIN_DX - CHAIN_AX.
chain_sinx:
        .fill 256, CHAIN_AX + round(CHAIN_AX * sin(toRadians(i * 360 / 256)))
// The Y register, CHAIN_Y0 +- CHAIN_AY.
chain_siny:
        .fill 256, CHAIN_Y0 + round(CHAIN_AY * sin(toRadians(i * 360 / 256)))
// A bar's top line, 0 to BARS_LINES - BAR_H, as an index into bar_colours.
bar_top:
        .fill 256, BARS_CENTRE + round(BARS_AMP * sin(toRadians(i * 360 / 256)))
.errorif (BARS_CENTRE + BARS_AMP + BAR_H > BARS_LINES), "a bar would run past the kernel"

// Four ramps, dark to light to dark (luminance order as in colour-fade.md).
// bar_ramps is in config.asm, so the verdict can draw the same bars.
ramps:
        .for (var b = 0; b < 4; b++) {
            .for (var i = 0; i < BAR_H; i++) .byte bar_ramps.get(b).get(i)
        }

chain_colour:
        .fill 8, (i & 1) == 0 ? CHAIN_COL_A : CHAIN_COL_B

// A filled ellipse, 24 x 21, touching all four edges of the sprite box.
sprite_image:
        .for (var r = 0; r < 21; r++) {
            .var dy = (r - 10) / 10.5
            .var hw = 12 * sqrt(1 - dy * dy)
            .var bits = 0
            .for (var c = 0; c < 24; c++) {
                .var dx = c + 0.5 - 12
                .eval bits = bits * 2 + (abs(dx) <= hw + 0.5 ? 1 : 0)
            }
            .byte (bits >> 16) & $ff, (bits >> 8) & $ff, bits & $ff
        }
        .byte 0

// The logo: "DEMO" in a 5 x 5 cell font, reverse spaces, rows 0-4.
.var logo_font = List().add(
    "####.  #####  #...#  .###.",
    "#...#  #....  ##.##  #...#",
    "#...#  ####.  #.#.#  #...#",
    "#...#  #....  #...#  #...#",
    "####.  #####  #...#  .###.")
.const LOGO_COL = 7
logo_cells:
        .for (var r = 0; r < 5; r++) {
            .var s = logo_font.get(r)
            .for (var c = 0; c < 40; c++) {
                .var k = c - LOGO_COL
                .byte (k >= 0 && k < s.size() && s.charAt(k) == '#') ? $a0 : $20
            }
        }
logo_colours:
        .for (var r = 0; r < 5; r++) {
            .fill 40, List().add(4, 10, 7, 10, 4).get(r)
        }

scroll_colours:
        .byte 11, 12, 15
        .fill 34, 1
        .byte 15, 12, 11

.encoding "screencode_upper"
subtitle:
        .text "     C64-KB DEMO STARTER * PART ONE     "
message:
        .text "HELLO FROM THE C64-KB DEMO STARTER. A PART TABLE, A TABLE-DRIVEN IRQ CHAIN, "
        .text "A STABLE RASTER KERNEL, EIGHT SPRITES ON A SINE, FOUR BARS AND THIS SCROLLER, "
        .text "ALL IN ONE MEASURED FRAME. ADD A PART, CHANGE THE TUNE, MAKE IT YOURS...     "
        .byte 0
