---
recipe: agsp
toolchain: kickassembler
output_format: PRG
region: both
techniques: [agsp_free_scroll, linecrunch, fld_flexible_line_distance, vsp_glitch, stable_raster_irq, double_irq, pal_ntsc_detection]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D020, D021, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), vic_char_base (owns), zero_page $02-$08 (owns)]
harness: [$02F0-$02FF]
ram: [state=$02E0, colour=$D800-$DBFF, idle=$3FFF]
---

<!-- doc-type: recipe -->

# KickAssembler recipe: AGSP, the text screen at any pixel position each frame from linecrunch, FLD, VSP and XSCROLL

## Synopsis

Places the whole text screen at a pixel position (x, y) that follows two
sines, x from 0 to 319 and y from 0 to 135, without moving a byte of
screen RAM. Vertically, a band of one `$D011` write per raster line from
line 50 crunches M = y div 8 rows (`linecrunch`) and then holds the next
badline off with FLD for 16 − M + YS more lines, YS = 7 − y mod 8, so the
row fetch always comes on line B = 67 + YS whatever M is. Horizontally,
that badline is made late: a write on cycle 14 + N of line B, N = x div 8,
starts the row fetch N cells late (`vsp_glitch`), and every row after it
starts N cells early in screen RAM; XSCROLL adds x mod 8 pixels. The late
row and everything above it are drawn in an invalid mode (ECM and BMM),
which is black, so the text starts on line B + 8 = 75 + YS with row M + 1.
Screen RAM holds each offset's low byte, `$0400`-`$07FF`, in the ROM
font, so every cell names where it came from. The program times the lines
after the band to find the first ordinary badline and checks it against
B + 8; `$02FF` is `01` while every frame has matched. `:n`, `:m`, `:ys`
and `:xs` fix one coordinate, for the sweeps below.

The VSP write can corrupt RAM on some real machines (`vsp_glitch`, "The
VSP crash"). VICE does not emulate that by default, this listing does not
follow the Safe VSP rules, and nothing here says it is safe on a real C64.

## Source

```asm
// agsp.asm
// AGSP (any given screen position): the text screen placed at any pixel
// position in both axes each frame with a handful of $D011 writes and one
// $D016 write, no screen RAM moved.
//
// Vertical: linecrunch (technique linecrunch) uses up M rows in M raster
// lines from line 51, then FLD (fld_flexible_line_distance) holds the
// next badline off for MMAX - M + YS more lines, so the row fetch always
// comes MMAX + YS lines after line 51 whatever M is: M is the coarse
// vertical position and YS (0-7) the fine one. Horizontal: that badline
// is made late, by a write on cycle 14 + N (vsp_glitch; the store trace's
// cycle, measured for N = 0 to 39), so the row after it and every row
// below start N cells early in screen RAM, and XSCROLL (0-7) adds the
// pixels. The late row itself and every line above it are drawn
// in an invalid mode (ECM and BMM), black.
//
// Screen RAM holds VC & 255 at every video-matrix offset VC, $0400-$07FF
// (the sprite-pointer bytes too), shown in the ROM upper-case font, so
// every cell says where in screen RAM it came from. The position follows two sines; each frame's
// M, YS, N, XS are at $02F0-$02F3. After the band the program times the
// lines to find the first ordinary badline and compares it with B + 8
// ($02F4 expected, $02F5 measured); $02FF is $01 while every frame has
// matched and $02 from the first that did not.
//
// The VSP write is the one that can corrupt RAM on some real machines
// (vsp_glitch, "The VSP crash"). VICE does not emulate that by default,
// and this listing does not follow the Safe VSP rules.

.const MMAX     = 16
.const RESULT   = $02ff
.const REC      = $02f0           // M, YS, N, XS, expected text line, measured
.const FLAG     = $02e0           // 0 = PAL, 1 = NTSC
.const frame    = $02
.const cnt      = $03             // band writes this frame: MMAX + YS (lines 50 to B - 2)
.const bline    = $04             // the late badline B = 51 + MMAX + YS
.const cur      = $05
.const saved    = $06
.const ptr      = $07             // $07-$08: the VSP variant for this frame's N

// Measured in VICE with a store trace (see the recipe page): the sync pads
// that give one write cycle every frame, the entry delays that put the
// band's writes on cycle 60, and the VSP delay that puts the late write on
// cycle 14 + N. :n, :m, :ys, :xs hold one coordinate fixed, for sweeps.
.var SPP = cmdLineVars.containsKey("spp") ? cmdLineVars.get("spp").asNumber() : 12
.var SPN = cmdLineVars.containsKey("spn") ? cmdLineVars.get("spn").asNumber() : 14
.var EP  = cmdLineVars.containsKey("ep") ? cmdLineVars.get("ep").asNumber() : 110
.var EN  = cmdLineVars.containsKey("en") ? cmdLineVars.get("en").asNumber() : 112
.var VB  = cmdLineVars.containsKey("vb") ? cmdLineVars.get("vb").asNumber() : 51    // VSP base delay
.var NX  = cmdLineVars.containsKey("nx") ? cmdLineVars.get("nx").asNumber() : 4     // NTSC: two lines of 65
.var FIXN = cmdLineVars.containsKey("n") ? cmdLineVars.get("n").asNumber() : -1    // test: fixed N
.var FIXM = cmdLineVars.containsKey("m") ? cmdLineVars.get("m").asNumber() : -1    // test: fixed M
.var FIXYS = cmdLineVars.containsKey("ys") ? cmdLineVars.get("ys").asNumber() : -1
.var FIXXS = cmdLineVars.containsKey("xs") ? cmdLineVars.get("xs").asNumber() : -1

BasicUpstart2(start)

.macro Delay(c) {
    .if (c == 1) .error "Delay cannot make 1 cycle"
    .if (c > 0) {
        .if ((c & 1) != 0) { bit $ea }
        .for (var i = 0; i < ((c & 1) != 0 ? c - 3 : c) / 2; i++) { nop }
    }
}

// cnt writes (lines 50 to B - 2), one per line on cycle 60, LINE cycles an iteration; then
// the VSP variant through ptr.
.macro Band(LINE, ENTRY) {
    ldx #0
    Delay(ENTRY)
!loop:
    lda wtab, x         // 4
    sta $d011           // 4: cycle 60
    inx                 // 2
    cpx cnt             // 3
    beq !done+          // 2 (3 taken)
    Delay(LINE - 18)
    jmp !loop-          // 3
!done:
    .if (LINE == 65) { Delay(NX) }
    jmp (ptr)           // 5
}

* = $0900
start:
    sei
    lda #$7f
    sta $dc0d
    lda $dc0d
    jsr detect_region
    // $0400-$07FF: VC & 255; colour RAM white, all 1024 bytes.
    ldx #0
!:  txa
    sta $0400, x
    sta $0500, x
    sta $0600, x
    sta $0700, x
    lda #1
    sta $d800, x
    sta $d900, x
    sta $da00, x
    sta $db00, x
    inx
    bne !-
    lda #$14                    // screen $0400, character ROM
    sta $d018
    lda #0
    sta $3fff                   // idle fetch: rows past line 247 show it
    sta $d021
    lda #11
    sta $d020
    lda #1
    sta RESULT
    lda #0
    sta frame
    jsr plan
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #$1b
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

// plan: this frame's M, YS, N, XS from the frame counter, the write table
// and the VSP variant.
plan:
    ldx frame
    lda tm, x
    .if (FIXM >= 0) { lda #FIXM }
    sta REC
    lda tys, x
    .if (FIXYS >= 0) { lda #FIXYS }
    sta REC + 1
    lda tn, x
    .if (FIXN >= 0) { lda #FIXN }
    sta REC + 2
    lda txs, x
    .if (FIXXS >= 0) { lda #FIXXS }
    sta REC + 3
    // lines 50 .. B - 2 from the loop, B - 1 and B from the VSP variant
    lda REC + 1
    clc
    adc #MMAX
    sta cnt                     // loop writes: lines 50 .. B - 2
    clc
    adc #51
    sta bline                   // B = 51 + MMAX + YS
    and #7
    ora #$78
    sta vval                    // the late write on line B
    lda bline
    clc
    adc #1
    and #7
    ora #$78
    sta fval                    // FLD write on line B - 1: no match for B
    // wtab[i], line 50 + i: crunch (YSCROLL = line) for i < M, else FLD
    // (YSCROLL = line + 2); ECM and BMM set throughout.
    ldx #0
!:  cpx REC
    bcs !fld+
    lda crunch, x
    bcc !put+
!fld:
    lda fld, x
!put:
    sta wtab, x
    inx
    cpx cnt
    bne !-
    ldx REC + 2
    lda vlo, x
    sta ptr
    lda vhi, x
    sta ptr + 1
    rts

irq1:
    lda #$1b
    sta $d011
    lda REC + 3                 // XSCROLL for this frame
    ora #$08
    sta $d016
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
!:  Band(63, EP)
irq2n:
    ldx saved
    txs
    Delay(SPN)
    lda $d012
    cmp $d012
    beq !+
!:  Band(65, EN)

// vsps[N]: entered from the band after its last write (line B - 2,
// cycle 60). Writes YSCROLL = (B + 1) & 7 on line B - 1, so B does not
// match at its cycle 14, then YSCROLL = B & 7 on cycle 14 + N of line B.
vsps: .for (var n = 0; n < 40; n++) {
entry:
    lda fval                    // line B - 1: YSCROLL = (B + 1) & 7
    sta $d011
    lda vval
    Delay(VB + n)
    sta $d011                   // line B, cycle 15 + N
    jmp after
}

after:
    // Text mode from line B + 8: the write lands after line B + 7 is drawn.
    lda bline
    clc
    adc #7
!:  cmp $d012
    bne !-
    Delay(43)
    lda vval
    and #$1f                    // clear ECM and BMM, keep YSCROLL = B & 7
    sta $d011
    // First badline from here: count 12-cycle iterations per line, from
    // the start of line B + 8 (the write above is on line B + 7).
    lda bline
    clc
    adc #7
    sta cur
!wait:
    lda $d012
    cmp cur
    beq !wait-
    sta cur
    ldy #16
!line:
    ldx #0
!:  inx
    lda $d012
    cmp cur
    beq !-
    sta cur
    cpx #4                      // a badline leaves 1 to 3; a whole line 5
    bcs !+
    lda cur
    sec
    sbc #1
    sta REC + 5
    jmp !found+
!:  dey
    bne !line-
    lda #0
    sta REC + 5
!found:
    lda bline
    clc
    adc #8
    sta REC + 4
    cmp REC + 5
    beq !+
    lda #2
    sta RESULT
!:  inc frame
    jsr plan
    lda #<irq1
    sta $0314
    lda #>irq1
    sta $0315
    lda #46
    sta $d012
    lda #1
    sta $d019
    jmp $ea81

vval: .byte 0                   // $78 | (B & 7), set by plan
fval: .byte 0                   // $78 | ((B + 1) & 7)
crunch:
    .fill MMAX + 1, $78 | ((50 + i) & 7)
fld:
    .fill MMAX + 9, $78 | ((52 + i) & 7)
wtab:
    .fill MMAX + 9, 0
vlo:
    .fill 40, <vsps[i].entry
vhi:
    .fill 40, >vsps[i].entry

.align $100
// Position tables: px 0..319 and py 0..MMAX*8+7 on two sines.
.var px = List()
.var py = List()
.for (var f = 0; f < 256; f++) {
    .eval px.add(round(159.5 + 159.5 * sin(toRadians(f * 360 / 256))))
    .eval py.add(round(67.5 + 67.5 * sin(toRadians(f * 720 / 256 + 90))))
}
tn:  .fill 256, px.get(i) >> 3
txs: .fill 256, px.get(i) & 7
tm:  .fill 256, py.get(i) >> 3
tys: .fill 256, 7 - (py.get(i) & 7)
```

## Build

```bash
java -jar KickAss.jar agsp.asm -o agsp.prg
```

One coordinate held, for the sweeps (each of the four can be given):

```bash
java -jar KickAss.jar agsp.asm :n=10 :m=4 :ys=3 :xs=0 -o agsp-fixed.prg
```

`-showmem` reports one segment, `$0900` to `$18FF`: the code, the 40 VSP
variants and the position tables. The font is the character ROM. The PRG
is 4,353 bytes.

## Expected output

A dark grey border. Under it a black band 24 to 31 lines deep, then the
screen RAM offsets as ROM characters, white on black, shifted so that the
cell at the top left is somewhere inside screen RAM rather than at
`$0400`, and moving from frame to frame along the two sines.

Measured in VICE x64sc 3.10 with the pinned command at 8,000,000 cycles,
PAL c64c (8565/8580/8521) and NTSC (`-model ntsc`, 6567R8). Every line
from 51 to 250 of each picture was compared pixel by pixel with the
model: black to line B + 7; from line B + 8, text row j = M + 1 + k div 8
and pixel row k mod 8 (k lines into the text), cell c showing the ROM
glyph of ((40 j + c − N) mod 1024) and 255, shifted XS pixels right;
black from any row whose badline would fall after line 247. The frame's
M, YS, N and XS were found by trying every frame of the position tables:

| Model | Frame | M | YS | N | XS | Text from line | Lines matching | With N − 1 or XS − 1 |
|---|---|---|---|---|---|---|---|---|
| PAL | 131 | 16 | 1 | 18 | 4 | 76 | 200 of 200 | 25 of 200 |
| NTSC | 29 | 9 | 2 | 33 | 0 | 77 | 200 of 200 | 26 of 200 (N − 1; XS = 7 also 26) |

A store trace of `$D011` over the whole run put every band write on
cycle 60 of its line and the late write on cycle 14 + N (store CYC,
Bauer's numbering, `runtime/vice-reference.md`), on all 254 PAL and 286
NTSC frames; `$02FF` was stored only by the reset and the program's
`01`.

Screenshots from these runs: `screenshots/agsp.png` (PAL) and
`screenshots/agsp-ntsc.png`.

### The sweeps

One coordinate fixed at a time, the others fixed too (N = 7 or 10, M = 4
or 5, YS = 3, XS = 0), 8,000,000 cycles, one run each, the same
200-line model:

| Swept | Values | PAL | NTSC |
|---|---|---|---|
| N | 0 to 39 | 200 of 200 lines, every value | the same |
| M | 0 to 16 | 200 of 200, every value | the same |
| YS | 0 to 7 | 200 of 200, every value | the same |
| XS | 0 to 7 | 200 of 200, every value | the same |

The late write, traced: cycle 14 + N for every N on both models. Moved
one cycle either way with `:vb=50` and `:vb=52` (N = 10 asked for), the
write lands on 23 and 25 and the picture matches N = 9 and N = 11 on all
200 lines. The shift is therefore the write's cycle minus 14.

With YS of 5 to 7 the last one to three lines above the lower border are
black: that row's badline would come after line 247, the last line on
which a badline can occur, so the VIC stays idle and draws the byte at
`$3FFF`, which the listing clears (`idle_fetch_byte_shows_in_gaps`).

## Why this works

### Vertical: crunch, then FLD

`linecrunch` measured the window: a write of YSCROLL = line & 7 on cycle
58 to 62 (PAL) or 58 to 64 (NTSC) of a line whose row counter is 7 makes
the next line use up one character row. The band writes that on lines 50
to 49 + M, all on cycle 60. Crunching alone would start the text M lines
lower for every M; the rest of the band is FLD, which writes
YSCROLL = (line + 2) & 7 so no line matches (`fld_flexible_line_distance`),
and makes the band always 16 + YS lines long. The top of the text moves
only with YS.

### Horizontal: the late badline

On line B − 1 the VSP variant writes YSCROLL = (B + 1) & 7, so line B does
not match at cycle 14 and the row counter is not reset. On cycle 14 + N it
writes YSCROLL = B & 7: the condition becomes true late, the VIC fetches
the row's screen codes only from there on, and the video counter ends the
row N cells short. Every row below starts N cells earlier in screen RAM,
and the picture moves N cells right. XSCROLL, written once per frame on
line 46, adds the pixels. The late row is drawn wrong (the cells before
the fetch are stale), which is why it stays in the invalid mode; the write
that clears ECM and BMM lands on cycle 60 of line B + 7.

### The numbers

`vsp_glitch` gave the shift as N = cycle − 15 from VICE's VSP-bug log,
whose `Cycle: 24` for the `vsp` recipe's 10-cell write it read as Bauer's
cycle 25. A store trace of that recipe's write reads CYC 24 on both
models, and this recipe's sweep gives N = CYC − 14 for every N; the
technique page now states both numberings.

The band is timed as in `linecrunch`: the double IRQ's sync pad is 12 on
PAL and 14 on NTSC, and the entry delays `EP` and `EN` put the first write
on cycle 60 of line 50, found with the store trace. The 40 VSP variants
are unrolled delays reached through `jmp (ptr)`, so each frame's N costs
no computation inside the band.

### What it costs

The handler runs from the interrupt on line 46 to its acknowledge on
line 86 to 95 (store trace, every frame of both runs): up to 50 raster
lines of CPU time a frame, most of it the band and the late row, the rest
the badline check and the next frame's table. Not timed with a CIA here.
