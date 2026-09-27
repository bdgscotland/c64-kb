---
recipe: centred-sprite-map-scroll
toolchain: kickassembler
output_format: PRG
region: both
techniques: [centred_sprite_map_scroll, soft_scroll_h, soft_scroll_v, screen_double_buffer_d018, facing_turn_step]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D016, D017, D018, D019, D01A, D01B, D01C, D01D, D020, D021, D027, DC00, DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: []
claims: [irq_vector_0314 (owns), vic_raster_irq (owns), sprite_0 (owns), cia1_port_a (reads), zero_page $02-$0E+$CC (owns)]
harness: [cia2_timer_a, cia2_timer_b, $0F-$20]
ram: [$0288, screen=$0400-$07FF, back=$2400-$27FF, colour=$D800-$DBFF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler — The player fixed at screen centre while the map window moves under him

## Synopsis

A character map of 64 x 40 cells, larger than the 38 x 24 display window,
with the player's ship as sprite 0 fixed at the centre of the window and
eight heading shapes (the 16 facings of `facing_turn_step`, halved to
poses). Every fifth frame is a step: read joystick port 2, turn the facing
one step toward the stick's direction, move the camera one map pixel along
the facing, redraw the window from the map into the matrix that is not on
display, and hand the fine scroll and the screen page to the raster IRQ
through one dirty byte. The IRQ never reads the map; the map code never
writes `$D011`, `$D016` or `$D018`. A scripted stick is ANDed into the
`$DC00` read, so the pinned run is deterministic and a real stick in port 2
still steers. Rows 1-2 of the window report the camera position, the
facing, the step count, the redraw's cycles and the line it ended on, and
the whole step's cycles. The technique is `centred_sprite_map_scroll` in
`techniques/scroll.md`.

## Source

```asm
// centred-sprite-map-scroll.asm: the player fixed at screen centre while the
// world window moves under him. A 64 x 40 character map, a ship sprite at the
// centre of the display, eight heading poses. Every STEPFRAMES frames is a
// step: read joystick port 2 (a scripted stick is ANDed into the port read, so
// the pinned run is deterministic and a real stick still steers), turn the
// facing one step toward the stick's direction, move the camera one map pixel
// along the facing, redraw the window from the map into the matrix that is not
// on display, and hand the fine scroll and the screen page to the raster IRQ
// through one dirty byte. The IRQ never reads the map; the map code never
// writes $D011, $D016 or $D018. The raster source exits through $EA81; the
// CIA1 source alone runs the KERNAL service ($EA31: jiffy clock, keyboard). Rows 1-2 report the measurements.
// Build: java -jar KickAss.jar centred-sprite-map-scroll.asm -o centred-sprite-map-scroll.prg
.encoding "screencode_upper"

BasicUpstart2(start)

.const SCRA    = $0400        // the matrix on display at start (VM nibble 1)
.const SCRB    = $2400        // the other matrix (VM nibble 9)
.const MAP     = $1000        // 64 x 40 cells of screen codes, CPU-only RAM
.const MAPW    = 64
.const MAPH    = 40
.const SPRBLK  = $2000        // eight heading shapes, 64-byte aligned
.const COLRAM  = $d800
.const STEPFRAMES = 5         // frames per step (the study measured 5.2)
.const CAMXMAX = 199          // 24 cells x 8 + 7: the window never leaves the map
.const CAMYMAX = 127          // 15 rows x 8 + 7
.const SPX     = 172          // sprite X: centred in the 38-column window
.const SPY     = 139          // sprite Y: first line 140, centre line 150
.const STARTX  = 160          // camera start, in map pixels
.const STARTY  = 64

// zero page. $02-$0E and $CC are the technique, $0F-$20 the harness.
// The KERNAL service reached through $EA31 may write $01, $91, $A0-$A2,
// $C0, $C5-$C6, $CB, $CD-$CF and $F3-$F6 (kernal-routines-reference.md);
// none of those bytes are used here.
.const frame   = $02          // frames, counted by the raster IRQ
.const lastfrm = $03          // frame of the last step
.const camx    = $04          // camera in map pixels
.const camy    = $05
.const facing  = $06          // 0-15: 0 up, 4 right, 8 down, 12 left
.const target  = $07          // the stick's facing, $ff when it holds
.const stepc   = $08          // steps taken, 2 bytes
.const backpg  = $0a          // page high byte of the matrix drawn into
.const frontpg = $0b          // page high byte of the matrix on display
// the hand-off block the IRQ reads (the study's mp block at $9B80)
.const sx      = $0c          // XSCROLL 0-7
.const sy      = $0d          // YSCROLL 0-7
.const hpage   = $0e          // screen page high byte, bit 7 = dirty
// the measurement harness
.const tmaxC   = $0f          // most cycles one redraw took (2 bytes)
.const tcalA   = $11          // timer A reading for an empty call (2 bytes)
.const tmaxT   = $13          // most cycles one whole step took (2 bytes)
.const tcalB   = $15          // timer B reading for an empty call (2 bytes)
.const tdiff   = $17          // this call's cycles (2 bytes)
.const reprow  = $19          // report row pointer (2 bytes)
.const rline   = $1b          // $D012 when the last redraw returned
.const eline   = $1c          // line the last hand-off landed on (2 bytes, 0-311)
.const elmax   = $1e          // the latest such line (2 bytes)
.const latec   = $20          // steps whose hand-off crossed line 0

start:
    sei
    lda #0
    sta $d020
    sta $d021
    lda #1
    sta $cc                 // the KERNAL's cursor must not blink into the window
    lda #14                 // colour RAM: light blue, one colour, never scrolled
    ldx #0
cloop:
    sta COLRAM,x
    sta COLRAM+$100,x
    sta COLRAM+$200,x
    sta COLRAM+$2e8,x
    inx
    bne cloop
    lda #(SPRBLK/64)        // sprite 0: the ship, fixed at the centre
    sta SCRA+$3f8
    sta SCRB+$3f8
    lda #SPX
    sta $d000
    lda #SPY
    sta $d001
    lda #0
    sta $d010
    sta $d017
    sta $d01b
    sta $d01c
    sta $d01d
    lda #1
    sta $d027               // white ship on a light blue map
    lda #%00000001
    sta $d015
    lda #STARTX
    sta camx
    lda #STARTY
    sta camy
    lda #0
    sta facing
    sta stepc
    sta stepc+1
    sta frame
    sta lastfrm
    sta tmaxC
    sta tmaxC+1
    sta tmaxT
    sta tmaxT+1
    sta rline
    sta eline
    sta eline+1
    sta elmax
    sta elmax+1
    sta latec
    lda #$ff
    sta target
    lda #>SCRA
    sta backpg
    lda #>SCRB
    sta frontpg
    jsr setsxy
    // calibrate both timers with an empty call
    jsr tstartA
    jsr empty
    jsr tstopA
    lda tdiff
    sta tcalA
    lda tdiff+1
    sta tcalA+1
    jsr tstartB
    jsr empty
    jsr tstopB
    lda tdiff
    sta tcalB
    lda tdiff+1
    sta tcalB+1
    // the first window into SCRA, then hand it to the IRQ
    jsr redraw
    jsr report
    jsr swap
    // DEN on, RSEL 0 (24 rows), CSEL 0 (38 columns), the ROM charset
    lda #$10
    sta $d011
    lda #0
    sta $d016
    lda #$14
    sta $d018
    // the raster IRQ on line 0 through $0314, exiting through $EA31
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #0
    sta $d012
    lda $d011
    and #$7f
    sta $d011               // RST8 = 0: the compare stays on line 0
    lda $d019
    sta $d019
    lda #%00000001
    sta $d01a
    cli

loop:
    lda frame
    sec
    sbc lastfrm
    cmp #STEPFRAMES
    bcc loop
    lda frame
    sta lastfrm
    jsr step
    jmp loop

// ---- one step of the technique --------------------------------------
step:
    jsr tstartB
    // 1. the stick, ANDed with the script so the pinned run is deterministic
    lda stepc+1
    bne scrmax              // past step 255 the script holds its last byte
    ldx stepc
    cpx #$ff
    bcc scrok
scrmax:
    ldx #$ff
scrok:
    lda $dc00
    and scripttbl,x
    eor #$ff
    and #$0f
    tax
    lda targtbl,x
    sta target
    // 2. turn the facing one step toward the target (facing_turn_step)
    cmp #$ff
    beq noturn
    sec
    sbc facing
    and #$0f
    beq noturn
    cmp #9
    bcs turnl
    inc facing
    jmp turned
turnl:
    dec facing
turned:
    lda facing
    and #$0f
    sta facing
noturn:
    // 3. move the camera one map pixel along the facing, clamped at the map
    ldx facing
    lda movex,x
    bmi xleft
    beq ystep
    lda camx
    cmp #CAMXMAX
    bcs ystep
    inc camx
    jmp ystep
xleft:
    lda camx
    beq ystep
    dec camx
ystep:
    ldx facing
    lda movey,x
    bmi yup
    beq moved
    lda camy
    cmp #CAMYMAX
    bcs moved
    inc camy
    jmp moved
yup:
    lda camy
    beq moved
    dec camy
moved:
    jsr setsxy
    // 4. redraw the window from the map into the back matrix, timed
    jsr tstartA
    jsr redraw
    jsr tstopA
    lda $d012
    sta rline
    ldx #tmaxC
    jsr tkeep
    // 5. the ship's pose, the report rows and the hand-off to the IRQ
    jsr setpose
    jsr report
    jsr swap
    // 6. the publication deadline: the hand-off must land before line 0
    lda $d011
    asl                     // RST8, the line's 9th bit, into carry
    lda $d012
    sta eline
    lda #0
    rol
    sta eline+1             // the line the hand-off landed on, 0-311
    lda eline+1
    cmp elmax+1
    bcc nomax
    bne maxst
    lda eline
    cmp elmax
    bcc nomax
maxst:
    lda eline
    sta elmax
    lda eline+1
    sta elmax+1
nomax:
    lda frame               // the raster IRQ bumps frame on line 0, so a step
    cmp lastfrm             // that outlived its frame published one frame late
    beq ontime
    inc latec
ontime:
    inc stepc
    bne !+
    inc stepc+1
!:  jsr tstopB
    ldx #tmaxT
    jsr tkeep
    rts

// ---- the hand-off: what the IRQ applies -----------------------------
swap:
    lda backpg              // the matrix just drawn
    ldx frontpg
    stx backpg              // the one on display is drawn into next
    sta frontpg             // the drawn one is now the one on display
    ora #$80
    sta hpage               // page + dirty: the IRQ applies it on line 0
    rts

// ---- the fine scroll the camera asks for ---------------------------
setsxy:                     // XSCROLL = 7 - (camx AND 7), YSCROLL likewise
    lda camx
    and #$07
    eor #$07
    sta sx
    lda camy
    and #$07
    eor #$07
    sta sy
    rts

// ---- the ship's pose: one sprite pointer in the matrix drawn into ---
setpose:                    // the facing is 16 steps, the hull has 8 shapes
    lda backpg
    clc
    adc #3
    sta spptr+2
    lda #$f8
    sta spptr+1
    lda facing
    lsr
    clc
    adc #(SPRBLK/64)
spptr: sta $ffff
    rts

// ---- the raster IRQ: the frame counter and the dirty byte -----------
irq:
    lda $d019
    and #$01
    beq kernal              // not the raster compare: the CIA1 source
    sta $d019               // acknowledge the raster compare
    inc frame
    lda hpage
    bpl irqout              // bit 7 clear: nothing handed over
    and #$7f
    sta $0288               // the KERNAL's screen page follows the visible matrix
    asl
    asl
    ora #$04                // matrix page, char base $1000 (the ROM charset)
    sta $d018
    lda sx
    sta $d016
    lda sy
    ora #$10                // DEN on, RSEL 0
    sta $d011
    lda hpage
    and #$7f
    sta hpage
irqout:
    jmp $ea81               // bare restore and RTI: no KERNAL work on this source
kernal:
    jmp $ea31               // the CIA1 source: jiffy clock and keyboard scan

// ---- screen redraw from the map into the back matrix ----------------
redraw:
    lda camy                // source row 0 = map + (camy>>3)*64 + (camx>>3)
    lsr
    lsr
    lsr
    tax
    lda camx
    lsr
    lsr
    lsr
    clc
    adc maplo,x
    sta rs0+1
    lda maphi,x
    adc #0
    sta rs0+2
    lda backpg              // destination row 0 = the back matrix
    sta rd0+2
    lda #0
    sta rd0+1
    ldx #25                 // 25 rows: the window's partial rows at both edges
rrow:
    lda rs0+1               // the row's second half: +20
    clc
    adc #20
    sta rs1+1
    lda rs0+2
    adc #0
    sta rs1+2
    lda rd0+1
    clc
    adc #20
    sta rd1+1
    lda rd0+2
    adc #0
    sta rd1+2
    ldy #19
rs0:
    lda $ffff,y
rd0:
    sta $ffff,y
rs1:
    lda $ffff,y
rd1:
    sta $ffff,y
    dey
    bpl rs0
    lda rs0+1               // next row: 64 bytes on in the map
    clc
    adc #64
    sta rs0+1
    bcc !+
    inc rs0+2
!:  lda rd0+1               // and 40 on in the matrix
    clc
    adc #40
    sta rd0+1
    bcc !+
    inc rd0+2
!:  dex
    bne rrow
    rts

// ---- rows 1-2: what the program measured ---------------------------
report:
    lda backpg
    sta reprow+1
    lda #41                 // row 1, column 1: column 0 is behind the left border
    sta reprow
    ldx #0
    ldy #0
!:  lda row1txt,x
    beq !+
    sta (reprow),y
    inx
    iny
    bne !-
!:
    lda camx
    ldy #2
    jsr puthex
    lda camy
    ldy #7
    jsr puthex
    lda facing
    ldy #12
    jsr puthex
    lda stepc+1
    ldy #17
    jsr puthex
    lda stepc
    ldy #19
    jsr puthex
    lda #81                 // row 2, column 1
    sta reprow
    ldx #0
    ldy #0
!:  lda row2txt,x
    beq !+
    sta (reprow),y
    inx
    iny
    bne !-
!:
    lda tmaxC+1
    ldy #2
    jsr puthex
    lda tmaxC
    ldy #4
    jsr puthex
    lda tmaxT+1
    ldy #9
    jsr puthex
    lda tmaxT
    ldy #11
    jsr puthex
    lda rline
    ldy #16
    jsr puthex
    lda elmax+1
    ldy #21
    jsr puthex
    lda elmax
    ldy #23
    jsr puthex
    lda latec
    ldy #28
    jsr puthex
    rts

puthex:                     // A as two hex digits at (reprow),y
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexd,x
    sta (reprow),y
    iny
    pla
    and #$0f
    tax
    lda hexd,x
    sta (reprow),y
    rts

// ---- measurement harness: CIA 2 timers A and B ---------------------
tstartA:
    lda #$ff
    sta $dd04
    sta $dd05
    lda #%00011001          // force load, one-shot, start
    sta $dd0e
    rts
tstopA:
    lda #%00001000          // stop
    sta $dd0e
    lda $dd04
    sta tdiff
    lda $dd05
    sta tdiff+1
    rts
tstartB:
    lda #$ff
    sta $dd06
    sta $dd07
    lda #%00011001
    sta $dd0f
    rts
tstopB:
    lda #%00001000
    sta $dd0f
    lda $dd06
    sta tdiff
    lda $dd07
    sta tdiff+1
    rts
tkeep:                      // (x):2 keeps the larger of itself and tcal - tdiff
    sec
    lda $02,x
    sbc tdiff
    sta tdiff
    lda $03,x
    sbc tdiff+1
    sta tdiff+1
    lda tdiff+1
    cmp $01,x
    bcc tkdone
    bne tkstore
    lda tdiff
    cmp $00,x
    bcc tkdone
tkstore:
    lda tdiff
    sta $00,x
    lda tdiff+1
    sta $01,x
tkdone:
    rts
empty:
    rts

// ---- tables --------------------------------------------------------
targtbl:                    // stick nibble (1 = pressed) -> facing, $ff holds
    .byte $ff, 0, 8, $ff, 12, 14, 10, $ff, 4, 2, 6, $ff, $ff, $ff, $ff, $ff
movex:                      // one pixel a step along the facing
    .byte 0, 1, 1, 1, 1, 1, 1, 1, 0, -1, -1, -1, -1, -1, -1, -1
movey:
    .byte -1, -1, -1, -1, 0, 1, 1, 1, 1, 1, 1, 1, 0, -1, -1, -1
hexd:   .text "0123456789ABCDEF"
row1txt: .text "X=   Y=   H=   S=    "
row1txt_end: .byte 0
row2txt: .text "C=     T=     L=   E=     N=  "
row2txt_end: .byte 0

// the scripted stick: the mask ANDed into $DC00 for that step
.function script(i) {
    .if (i < 16) .return $fb        // left held: the facing turns 0 -> 12
    .if (i < 40) .return $ff        // centred: the heading is held
    .if (i < 56) .return $f7        // right held: the facing turns 12 -> 4
    .if (i < 72) .return $ff        // centred: the ship sails right
    .if (i < 88) .return $fe        // up held: the facing turns 4 -> 0
    .return $ff                     // centred: the ship sails up
}
scripttbl: .fill 256, script(i)

* = MAP "Map"
// the map: a chart of hex digits, a row label in columns 0-1 and four
// landmark cells (inverse space) at (12,22), (18,32), (24,42) and (28,52)
.function hx(n) {
    .if (n < 10) .return $30 + n
    .return $41 + n - 10
}
.function mapcell(r, c) {
    .if (r == 12 && c == 22) .return $a0
    .if (r == 18 && c == 32) .return $a0
    .if (r == 24 && c == 42) .return $a0
    .if (r == 28 && c == 52) .return $a0
    .if (c == 0) .return hx(floor(r / 16))
    .if (c == 1) .return hx(mod(r, 16))
    .return hx(mod(r * 5 + c * 3 + floor(r / 4) * 7 + floor(c / 4) * 11, 16))
}
map:
.for (var r = 0; r < MAPH; r++) {
    .for (var c = 0; c < MAPW; c++) {
        .byte mapcell(r, c)
    }
}
maplo:  .fill MAPH, <(map + i * MAPW)
maphi:  .fill MAPH, >(map + i * MAPW)

* = SPRBLK "Sprites"
// eight heading shapes: the hull of a ship, 45 degrees apart, built at
// assembly time by rotating the pixel back into the up-pointing hull
.function shipbit(h, x, y) {
    .var dx = x - 11.5
    .var dy = y - 10
    .var a = h * 0.7853981634       // 45 degrees, in radians
    .var rx = dx * cos(a) + dy * sin(a)
    .var ry = -dx * sin(a) + dy * cos(a)
    .if (ry >= -9 && ry <= 9) {
        .var w = (ry + 9) * 0.62
        .if (abs(rx) <= w) .return 1
    }
    .return 0
}
.function shipbyte(h, y, b) {
    .var v = 0
    .for (var i = 0; i < 8; i++) {
        .if (shipbit(h, b * 8 + i, y) != 0) .eval v = v | (1 << (7 - i))
    }
    .return v
}
.for (var h = 0; h < 8; h++) {
    .for (var y = 0; y < 21; y++) {
        .byte shipbyte(h, y, 0), shipbyte(h, y, 1), shipbyte(h, y, 2)
    }
    .byte 0
}
```

## Build

```bash
java -jar "$KICKASS_JAR" centred-sprite-map-scroll.asm -o centred-sprite-map-scroll.prg
```

## Expected output

`screenshots/centred-sprite-map-scroll.png` and
`screenshots/centred-sprite-map-scroll-ntsc.png` (8,000,000 cycles), and
`screenshots/centred-sprite-map-scroll-later.png` and
`screenshots/centred-sprite-map-scroll-later-ntsc.png` (8,600,000), all
pinned in `recipes/runs.json`. Verified in VICE x64sc 3.10 (PAL
c64c: 8565/8580/8521, and ntsc: 6567R8), measured with PIL and decoded
against the character ROM. Screenshot x = VIC x + 8; a screenshot row is
raster line − 16 on PAL and − 28 on NTSC.

Row 1 of the window is `X=camx Y=camy H=facing S=steps` and row 2 is
`C=redraw cycles T=step cycles L=line the redraw returned on E=line the
hand-off landed on N=steps published a frame late`, all hex, the largest
`C`, `T` and `E` seen so far.

| What | PAL 8.0M | PAL 8.6M | NTSC 8.0M | NTSC 8.6M |
|---|---|---|---|---|
| Row 1 | `X=7B Y=36 H=04 S=0031` | `X=81 Y=36 H=04 S=0037` | `X=81 Y=36 H=04 S=0037` | `X=88 Y=36 H=04 S=003E` |
| Row 2 | `C=3AA6 T=4407 L=F3 E=0116 N=00` | `C=3AA6 T=4407 L=F3 E=0116 N=00` | `C=3A7B T=4453 L=EA E=0007 N=37` | `C=3A7B T=4453 L=E7 E=0007 N=3E` |
| Fine scroll XSCROLL, YSCROLL | 4, 1 | 6, 1 | 6, 1 | 7, 1 |
| The four landmark cells | (92,81) (172,129) (252,177) (332,209) | (86,81) (166,129) (246,177) (326,209) | (86,69) (166,117) (246,165) (326,197) | (79,69) (159,117) (239,165) (319,197) |
| The ship's white hull | x 183-200, rows 124-144 | same | x 183-200, rows 112-132 | same |

The landmark cells are the map's inverse-space cells at (row 12, column
22), (18, 32), (24, 42) and (28, 52), read as 8x8 blocks in the map's
colour; the ship is the only white shape. A script reads every figure
above from the pixels and prints pass or fail for each of these claims:

- Every one of the 39 report cells matches a glyph of the character ROM
  at one 8x8 offset, and both rows agree on that offset.
- That offset is `XSCROLL = 7 − (camx AND 7)`, `YSCROLL = 7 − (camy AND
  7)`: 4 and 1 for camx $7B, camy $36.
- Each landmark's top-left corner is at VIC x `31 + x − camx` and raster
  line `55 + y − camy` for its map pixel (x, y), exactly, on both models.
- The ship's pixels lie inside its 24x21 sprite box (the listing's SPX
  172 and SPY 139: VIC x 172-195, lines 140-160) and the hull points
  along the reported facing.
- Between the two shots every landmark moved (−6, 0) on PAL and (−7, 0)
  on NTSC, the difference of the two reported camera positions, and the
  ship's box did not move at all.

All pass on both models. The numbers agree with the constants: the
scripted stick holds left for steps 0-15, centred 16-39, right 40-55,
centred 56-71, up 72-87 and centred after, so the facing turns 0 to 12
in four steps, 12 back to 4 in eight, and 4 to 0 in four. It holds 4 at
the four shots of the first pair and 0 at the vertical pair. The 600,000 cycles between
the shots are 30.5 PAL frames, six steps at five frames each, and 35.1
NTSC frames, seven steps (arithmetic): exactly the six and seven pixels
the landmarks moved. One pixel a step is the move table; the redraw is
1,000 bytes whether the camera crossed a cell or not.

The redraw cost is against the frame: 15,014 cycles, 76% of the 19,656
PAL cycles, and 14,971 of the 17,095 NTSC cycles, 88%, once every five
frames. The frame lengths and the two percentages are arithmetic (63
cycles a line over 312 lines on PAL, 65 over 263 on NTSC). The whole
step, stick to hand-off, measures 17,415 cycles on PAL and 17,491 on
NTSC, which on NTSC is longer than the frame itself: the copy runs
across the display's badlines and sprite fetches and pays for them. The
redraw ends on line 243 (PAL) and 230-234 (NTSC), inside the display's
lines 55-246 (measured): the copy runs while the beam is reading the
window, which is safe only because it writes the matrix that is not on
display.

What a step has to meet is not a cycle count but a publication
deadline: the next line 0, where the IRQ applies the hand-off. The
cycle count starts inside the step, after the line-0 interrupt and any
KERNAL work that ran before it, so cycles left at the end of a frame
are not headroom. `E` is the line the hand-off landed on and `N` counts
the steps whose hand-off crossed line 0 and so reached the IRQ a frame
late. On PAL the hand-off lands by line 278 at the latest, 33 lines
before the frame's last line 311 (arithmetic), and none of the 49 and
55 steps at the two pinned shots is late. On NTSC the step outlives its
frame: the hand-off lands on line 0-7 of the next frame and every step
is late, 55 of 55 and 62 of 62 at the pinned shots. A late hand-off
loses no step: the camera still moves that step and the step count
still advances one per five frames, but the IRQ publishes the window at
the following line 0, so the old window stays one more frame.

An earlier build of the listing let every raster interrupt exit through
`$EA31`, so the KERNAL service ran once per raster interrupt as well as
once per CIA1 interrupt: the jiffy clock advanced on both sources and
every raster interrupt carried a keyboard scan. The handler now sends
each source its own way, the raster source to the bare `$EA81` exit,
and the figures above are from that build; the earlier one read
`C=3AA5 T=421B L=F5` on PAL and `C=3A7C T=416E L=EA` on NTSC.

Two more pinned runs cover the vertical axis and the deadline. `@up`
(10,800,000) and `@uplater` (11,400,000) are the same build with the
scripted stick holding up from step 72, so the camera moves up;
`@frame1`, `@frame2` and `@frame3` (8,068,380, 8,085,475 and 8,102,570
on NTSC) are three consecutive frames around one publication.

| What | PAL up | PAL uplater | NTSC up | NTSC uplater |
|---|---|---|---|---|
| Row 1 | `X=94 Y=2F H=00 S=004E` | `X=94 Y=29 H=00 S=0054` | `X=94 Y=25 H=00 S=0058` | `X=94 Y=1E H=00 S=005F` |
| Row 2 | `C=3AA6 T=4407 L=F2 E=0116 N=00` | `C=3AA6 T=4407 L=F2 E=0116 N=00` | `C=3A7B T=4453 L=EB E=0007 N=58` | `C=3A7B T=4453 L=EB E=0007 N=5F` |
| The landmark cells | (67,88) (147,136) (227,184) (307,216) | (67,94) (147,142) (227,190) (307,222) | (67,86) (147,134) (227,182) | (67,93) (147,141) (227,189) |
| The ship's white hull | x 181-202, rows 126-143 | same | x 181-202, rows 114-131 | same |

The landmarks moved (0, +6) on PAL and (0, +7) on NTSC, the difference of
the two camera positions in each pair: the window moves vertically here
and horizontally in the pair above. On NTSC the fourth landmark is
clipped by the window's bottom edge at these cameras and the script says
so rather than counting it. The hull points up (facing 0) in all four.

| Consecutive frames, NTSC | frame1 | frame2 | frame3 |
|---|---|---|---|
| Row 1 | `X=82 Y=36 H=04 S=0038` | `X=82 Y=36 H=04 S=0038` | `X=83 Y=36 H=04 S=0039` |
| The landmark cells | (85,69) (165,117) (245,165) (325,197) | same | (84,69) (164,117) (244,165) (324,197) |

frame1 and frame2 are the same window. The step that moved the camera to
(131,54) published its hand-off a frame late, so the old window stayed
one frame more and frame3 shows it one pixel to the left, one step on.
No step is lost. Every frame is whole: each report's camera puts every
landmark at its exact position, which is the check the script runs on
every shot, and the pair check across consecutive frames reports the
identical pair and the one-step pair as such.

One more pinned run is past the end of the script. `@step256`
(29,000,000 on PAL) is 263 steps in, where the stick script's table has
run out:

| What | PAL step256 |
|---|---|
| Row 1 | `X=94 Y=00 H=00 S=0107` |
| Row 2 | `C=3AA6 T=4407 L=F2 E=0116 N=00` |

The facing is still 0 and the camera is still at X $94: the script holds
its last byte, centred, and the ship keeps sailing up into the map's
edge, where the camera stops (camy $00). An earlier build indexed the
table with the low byte of the step counter, so at step 256 the index
wrapped to 0 and the scripted stick replayed from its start: the facing
turned back to 12 and the camera walked left. The index now saturates at
255.

A capture note. `-exitscreenshot` can land mid-frame and the picture is
then the top of one frame and the bottom of the next; the script catches
it, because the two halves carry different cameras. One capture at
11,000,000 on NTSC read the report at YSCROLL 5 and put the landmarks
below the split one pixel higher, and the landmark check failed; the
captures at 10,800,000 and 11,400,000 are whole. Every figure above
comes from a capture that passes every check.

Off by one: with the report written from matrix column 0, the first
field decoded as a space on every shot. With CSEL 0 the display window
starts at VIC x 32 and column 0 spans VIC x 24+XSCROLL to 31+XSCROLL,
so it is behind the left border at XSCROLL 0 and one pixel of it shows
at XSCROLL 7. The report starts at column 1, the first column fully
visible at every XSCROLL.

## Why this works

The camera is one pair of bytes in map pixels, and everything else is
derived from it: the window's origin cell is `camx >> 3`, `camy >> 3`,
the fine scroll is the low three bits inverted, and the redraw's source
pointer is the map row at that origin plus `camx >> 3`. The values can
never disagree, because one store changes them all.

The redraw fills the matrix that is not on display and the swap is one
byte: the page high byte with bit 7 set. The raster IRQ sees that dirty
byte on line 0 and writes `$0288`, `$D018`, `$D016` and `$D011` from it,
then clears the bit. So the map code never touches a scroll register,
the IRQ never reads the map, and the new window, the new screen page and
the new fine scroll reach the VIC in the same handler on the same frame.
The IRQ runs at line 0 and needs no cycle-exact entry (a handler that
must write at a fixed cycle wants `stable_raster_irq`,
`techniques/raster.md`); it exits through `$EA31` so the jiffy clock and
the keyboard scan keep working, with `$CC` set to 1 at start-up because
the KERNAL's cursor blink would otherwise write into the window.

Turning is one write: the facing is 16 steps (`facing_turn_step`) and
the hull has 8 shapes, so the pose is `facing >> 1` into the sprite
pointer of the matrix being drawn. The ship's X and Y registers are
written once, before the frame loop, and never again: the world moves
because the map window moves. Colour RAM is filled with one colour and
never scrolled, which is what lets the redraw copy screen codes alone; a
world that colours per cell has to move colour RAM too
(`eight_way_scroll_double_buffer`, `techniques/scroll.md`).
