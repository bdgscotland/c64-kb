---
recipe: rotozoomer
toolchain: kickassembler
output_format: PRG
region: both
techniques: [rotozoomer_charset, mcm_text]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D020, D021, D022, D023, DC0D]
uses_kernal: []
claims: [cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), zero_page $02-$18 (owns)]
harness: [$02F0-$02F1]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: a rotozoomer rendered into a double-buffered character set

## Synopsis

A 16 × 16 texture of four colours, rotated and zoomed into a window of
64 × 64 multicolour pixels, 16 characters wide and 8 high. The window's
128 cells hold codes 0 to 127 column by column, so each character column
is 64 consecutive bytes of the charset, one per pixel line: the charset
is the framebuffer. The main loop renders one step of the animation into
the charset not on screen, waits for raster line 250 and switches
`$D018` to it; the texture coordinates are stepped in 8.8 fixed point,
two additions per pixel. Steps are 5.6 degrees apart, and a pixel
steps between 0.2 and 1 texel. `$02F0` holds the step on screen, so
a model can say what the picture must be. Built `:single=1` the loop
renders into the charset on screen instead. The technique is
`rotozoomer_charset` in `techniques/effects-vector-3d.md`.

## Source

```asm
// rotozoomer.asm
// A rotozoomer drawn into a character set: a 16 x 16 texture of four
// colours, rotated and zoomed into a 64 x 64 window of multicolour pixels,
// one frame of the animation rendered at a time by the main loop.
//
// The window is 16 x 8 characters (columns 12-27, rows 8-15) holding
// codes 0-127 column by column: code 8col + row. So character column col
// is 64 bytes in a row in the charset, one per pixel line y, at
// charset + 64col + y, and each byte is four multicolour pixels. Two
// charsets, $2000 and $2800, take turns: the main loop renders step n into
// the one not shown, then writes $D018 to show it.
//
// Step n (0-63) has angle 360n/64 degrees and scale s = 0.75 + 0.5
// sin(360n/64 degrees); the texture coordinates of window pixel (x, y)
// are (u, v) = (8, 8) + R(n) (x - 32, y - 32) / (4 s), in 8.8 fixed point,
// stepped: u += du/dx per pixel and du/dy per line (the same for v).
// The texel is tex[(v & 15) * 16 + (u & 15)] of the integer parts.
// $02F0 holds the step on screen; $02F1 counts renders. :single=1 draws
// every step into the charset on screen instead.

.const STEPS  = 64
.var SINGLE = cmdLineVars.containsKey("single") ? cmdLineVars.get("single").asNumber() : 0
.const SHOWN  = $02f0           // step on screen
.const RENDERS = $02f1
.const u      = $02             // $02 frac, $03 int
.const v      = $04             // $04/$05
.const ru     = $06             // row start u, $06/$07
.const rv     = $08             // row start v, $08/$09
.const dxu    = $0a             // du/dx, $0a/$0b
.const dxv    = $0c             // dv/dx
.const dyu    = $0e             // du/dy
.const dyv    = $10             // dv/dy
.const out    = $12             // store pointer $12/$13
.const col    = $14
.const line   = $15
.const acc    = $16
.const step   = $17
.const which  = $18             // 0: $2000 shown, render into $2800

BasicUpstart2(start)

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    // Screen: blank character 128 everywhere, the window codes 8col + row.
    ldx #0
    lda #128
!:  sta $0400, x
    sta $0500, x
    sta $0600, x
    sta $06e8, x
    inx
    bne !-
    ldx #0
!:  lda #0                      // colour RAM: multicolour, colour 7 for bits 11
    sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $dae8, x
    inx
    bne !-
    ldy #0                      // row
!r: lda rowlo, y
    sta out
    lda rowhi, y
    sta out + 1
    lda rowhi, y
    clc
    adc #($d800 - $0400) >> 8
    sta acc
    ldx #0                      // col
!c: txa
    asl
    asl
    asl
    sty line
    ora line                    // 8col + row
    sty line
    stx col
    ldy col
    sta (out), y                // out = screen row + 12
    lda out + 1
    pha
    lda acc
    sta out + 1
    lda #8 | 7
    sta (out), y
    pla
    sta out + 1
    ldy line
    inx
    cpx #16
    bne !c-
    iny
    cpy #8
    bne !r-
    // Both charsets cleared.
    lda #0
    tax
!:  sta $2000, x
    sta $2100, x
    sta $2200, x
    sta $2300, x
    sta $2400, x
    sta $2500, x
    sta $2600, x
    sta $2700, x
    sta $2800, x
    sta $2900, x
    sta $2a00, x
    sta $2b00, x
    sta $2c00, x
    sta $2d00, x
    sta $2e00, x
    sta $2f00, x
    inx
    bne !-
    lda #0
    sta $d020
    sta $d021
    lda #2
    sta $d022
    lda #5
    sta $d023
    lda #$d8                    // multicolour text
    sta $d016
    lda #$18                    // screen $0400, charset $2000
    sta $d018
    lda #0
    sta which
    sta step
    sta RENDERS
    lda #$ff
    sta SHOWN
    cli                         // CIA1 masked above: no interrupt runs
frame:
    jsr render
    // show the buffer just drawn
    lda which
    .if (SINGLE == 0) { eor #1 }
    sta which
    beq !+
    lda #$1a                    // charset $2800
    jmp !set+
!:  lda #$18                    // charset $2000
!set:
    ldx #250                    // switch below the window, never inside it
!:  cpx $d012
    bne !-
    sta $d018
    lda step
    sta SHOWN
    inc RENDERS
    lda step
    clc
    adc #1
    and #STEPS - 1
    sta step
    jmp frame

// render: step `step` into the charset not shown.
render:
    ldx step
    lda dxul, x
    sta dxu
    lda dxuh, x
    sta dxu + 1
    lda dxvl, x
    sta dxv
    lda dxvh, x
    sta dxv + 1
    // du/dy = -dv/dx, dv/dy = du/dx (a rotation)
    sec
    lda #0
    sbc dxv
    sta dyu
    lda #0
    sbc dxv + 1
    sta dyu + 1
    lda dxu
    sta dyv
    lda dxu + 1
    sta dyv + 1
    lda u0l, x
    sta ru
    lda u0h, x
    sta ru + 1
    lda v0l, x
    sta rv
    lda v0h, x
    sta rv + 1
    lda #0
    sta line
!line:
    lda ru
    sta u
    lda ru + 1
    sta u + 1
    lda rv
    sta v
    lda rv + 1
    sta v + 1
    // out = charset + line; each column is 64 bytes on
    lda line
    sta out
    lda which                   // 0: draw into $2800
    .if (SINGLE != 0) { lda #1 }  // :single=1: always into $2000, the one shown
    beq !+
    lda #$20
    jmp !h+
!:  lda #$28
!h: sta out + 1
    lda #0
    sta col
!col:
    lda #0
    sta acc
    .for (var p = 0; p < 4; p++) {
        ldx v + 1
        lda u + 1
        and #15
        ora shl4, x
        tax
        lda tex, x
        asl acc
        asl acc
        ora acc
        sta acc
        clc
        lda u
        adc dxu
        sta u
        lda u + 1
        adc dxu + 1
        sta u + 1
        clc
        lda v
        adc dxv
        sta v
        lda v + 1
        adc dxv + 1
        sta v + 1
    }
    ldy #0
    lda acc
    sta (out), y
    lda out
    clc
    adc #64
    sta out
    bcc !+
    inc out + 1
!:  inc col
    lda col
    cmp #16
    beq !+
    jmp !col-
!:  clc
    lda ru
    adc dyu
    sta ru
    lda ru + 1
    adc dyu + 1
    sta ru + 1
    clc
    lda rv
    adc dyv
    sta rv
    lda rv + 1
    adc dyv + 1
    sta rv + 1
    inc line
    lda line
    cmp #64
    beq !+
    jmp !line-
!:  rts

rowlo: .fill 8, <($0400 + 40 * (8 + i) + 12)
rowhi: .fill 8, >($0400 + 40 * (8 + i) + 12)

// Per step: du/dx and dv/dx in 8.8 (cos, sin) / (4s); the start (u0, v0)
// of line 0, pixel 0: (8, 8) + R (-32, -32) / (4s).
.function S(n) { .return 0.75 + 0.5 * sin(toRadians(n * 360 / STEPS)) }
.function DU(n) { .return round(256 * cos(toRadians(n * 360 / STEPS)) / (4 * S(n))) }
.function DV(n) { .return round(256 * sin(toRadians(n * 360 / STEPS)) / (4 * S(n))) }
.function U0(n) { .return (8 * 256 - 32 * DU(n) + 32 * DV(n)) & $ffff }
.function V0(n) { .return (8 * 256 - 32 * DV(n) - 32 * DU(n)) & $ffff }
dxul: .fill STEPS, <(DU(i) & $ffff)
dxuh: .fill STEPS, >(DU(i) & $ffff)
dxvl: .fill STEPS, <(DV(i) & $ffff)
dxvh: .fill STEPS, >(DV(i) & $ffff)
u0l:  .fill STEPS, <U0(i)
u0h:  .fill STEPS, >U0(i)
v0l:  .fill STEPS, <V0(i)
v0h:  .fill STEPS, >V0(i)

.align $100
shl4: .fill 256, (i & 15) << 4
// Texture 16 x 16, colours 0-3: four quadrants 1, 2, 3, 0 with a
// one-texel frame of 3 and a diagonal of 0 in quadrant 1, so a rotation
// and its direction show.
tex:
.for (var ty = 0; ty < 16; ty++) {
    .for (var tx = 0; tx < 16; tx++) {
        .var q = (ty < 8 ? 0 : 2) + (tx < 8 ? 0 : 1)
        .var c = q == 0 ? 1 : q == 1 ? 2 : q == 2 ? 3 : 0
        .eval c = (tx == 0 || ty == 0) ? 3 : c
        .eval c = (q == 0 && tx == ty) ? 0 : c
        .byte c
    }
}
```

## Build

```bash
java -jar KickAss.jar rotozoomer.asm -o rotozoomer.prg
java -jar KickAss.jar rotozoomer.asm :single=1 -o single.prg   # one charset, drawn while shown
```

`-showmem` reports `$0900` to `$0FFF`, the texture and tables included;
the PRG is 2,049 bytes. The two charsets at `$2000` and `$2800` are
cleared at start-up.

## Expected output

A black screen with a 128 × 64 window in the middle (columns 12-27, rows
8-15): the texture's four quadrants in yellow, red, green and black, its
edge in yellow and a black diagonal, turned and scaled. Multicolour
pixels are two hires pixels wide, so the texture is drawn twice as wide
as it is high.

Measured in VICE x64sc 3.10, PAL c64c (8565/8580/8521) and NTSC
(`-model ntsc`, 6567R8). A Python model repeats the listing's
arithmetic (the same rounded tables, the same 16-bit additions) for all
64 steps; each window pixel of the exit screenshot was decoded with PIL
(the left of each two-pixel pair, colour to value with the palette
triples in `runtime/vice-reference.md`) and compared:

| Run | Model | Best step | Pixels equal, of 4,096 | `$02F0` at exit |
|---|---|---|---|---|
| 8,000,000 cycles | PAL | 11 | 4,096 | 11 |
| 8,000,000 cycles | NTSC | 11 | 4,096 | 11 |
| `@later`, 12,000,000 cycles | PAL | 21 | 4,096 | 21 |
| `@later`, 12,000,000 cycles | NTSC | 21 | 4,096 | 21 |

Also exact at 9, 10 and 11 million cycles on PAL and at 9 and 10
million on NTSC. At 11 million on NTSC 4,074 pixels match: window rows
0-5 are step 19 and rows 6-63 step 18, because the exit screenshot was
taken while the beam was on row 6 in the frame after the switch; the
lines above the beam belong to the new frame. Screenshots:
`screenshots/rotozoomer.png`, `screenshots/rotozoomer-ntsc.png`,
`screenshots/rotozoomer-later.png` and
`screenshots/rotozoomer-later-ntsc.png`.

### The render time

A store trace of `$02F1` over 12,000,000 cycles: one render every
393,117 to 393,123 cycles on PAL (20 frames) and 393,184 to 393,188 on
NTSC (23 frames); the wait for line 250 rounds each render up to whole
frames. Before that wait was added the renders were 376,008 to 376,401
cycles apart on PAL: about 92 cycles per pixel, badline stalls
included.

### One charset, drawn while shown

Built `:single=1`, the same comparison at 8 to 12 million cycles found no
picture equal to one step: 3,856 to 4,074 pixels of 4,096, 31 to 62 of
the 64 lines matching the best step entirely, on both models (ten
captures). The render takes about 19 frames, so every frame on screen is part
old step, part new.

## Why this works

### The charset as a framebuffer

A character code selects 8 bytes of the charset, one per pixel row. With
codes 8col + row in the window, character column col covers codes 8col
to 8col + 7, which are the 64 bytes at charset + 64col, top to bottom: a
column-major bitmap of 16 columns of 4 multicolour pixels, any pixel line
at one fixed offset. Only codes 0 to 127 are used, so a 2K charset slot
holds one frame, and two slots are a double buffer switched with the
charset bits of `$D018`. The VIC reads the charset at every g-access
(the charset write lands by cycle 15 for a whole line, measured in
`fpp`), so the switch waits for line 250, below the window.

### The coordinates

For step n, (du/dx, dv/dx) = (cos a, sin a) / (4s) and (du/dy, dv/dy) =
(−sin a, cos a) / (4s), rounded to 8.8 by the assembler, and the first
pixel is (8, 8) − 32 (du/dx + du/dy, dv/dx + dv/dy). Each pixel adds the
x step to (u, v); each line adds the y step to the line's start. The
texel is the integer parts, each masked to 0-15: `shl4[v] | (u & 15)`
indexes the 256-byte texture. Four texels are shifted into one byte and
stored.

### Sources

- None beyond the arithmetic above: the affine step (a scaled rotation
  applied incrementally, two additions per pixel) is written out here
  and measured against a model; no third-party listing was used.
