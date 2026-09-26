---
recipe: grenade-lob
toolchain: kickassembler
output_format: PRG
region: both
techniques: [grenade_lob]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D018, D020, D021, D027, DD04, DD05, DD0E]
uses_kernal: []
claims: [sprite_0 (owns), vic_char_base (init), vic_raster_irq (init), zero_page $02-$09+$0E-$14 (owns)]
harness: [cia2_timer_a, $0A-$0D]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — A thrown grenade: fixed flight, height animation, box blast

## Synopsis

A grenade sprite is thrown straight up from playfield pixel (250, 178).
It rises 2 pixels a frame for 39 frames while its shape grows from 3x3
to 7x7 and back, which reads as a rise and fall. It then becomes a still
blast for 20 frames. Every blast frame kills each live target inside the
box -18 < dx <= +18, -22 < dy <= +22 around the landing point, with X
compared in 16 bits. Twelve one-pixel targets sit at offsets on and just
outside each edge; the landing point is at X 250, so the box straddles
X 256. At frame 80 row 0 shows the frame the blast began, the blast
frames run and the most cycles one tick took. Row 1 shows which targets
the 16-bit test killed; row 2 which ones an 8-bit bounds test, the form
Commando's measured defect matches, would have killed. The technique is
`grenade_lob` in `techniques/logic.md`.

## Source

```asm
// grenade-lob.asm: a thrown grenade with a fixed flight, a height
// animation and a box blast, tested against a row of targets.
// The grenade is thrown straight up from (250,178) in playfield pixels
// (x 0-319, y 0-199). It rises 2 px a frame for FLIGHT frames while its
// shape grows and shrinks to suggest height, then becomes a still blast
// for BLAST frames. Each blast frame kills every live target with
// -18 < dx <= +18 and -22 < dy <= +22 (d = target minus blast), X in
// 16 bits. Targets are one-pixel dots, white alive, red dead; the landing
// point is a cyan dot. At frame REPORT, row 0 shows the frame the blast
// began, the blast frames counted and the most cycles one tick took; row 1
// the 16-bit test's kills and row 2 what an 8-bit bounds test would kill.
// Variant: :stop=N freezes the game after N ticks (display keeps running).
// Build: java -jar KickAss.jar grenade-lob.asm -o grenade-lob.prg

BasicUpstart2(start)

.function cv(n, d) { .return cmdLineVars.containsKey(n) ? cmdLineVars.get(n).asNumber() : d }
.const STOP    = cv("stop", 255) // freeze after this many ticks
.const SCREEN  = $0400
.const COLRAM  = $D800
.const CHARS   = $3000
.const LINE    = 251        // work line, below the display on PAL and NTSC
.const FLIGHT  = 39         // frames of flight
.const BLAST   = 20         // frames the blast stays
.const VY      = 2          // rise per frame, pixels
.const GX0     = 250        // throw point, playfield pixels
.const GY0     = 178
.const LX      = GX0        // landing point: straight up
.const LY      = GY0 - FLIGHT * VY
.const REPORT  = 80         // frame the result rows are written
.const BXL     = 18         // box: -BXL < dx <= +BXL
.const BYL     = 22         //      -BYL < dy <= +BYL
// targets: offsets from the landing point
.var TDX = List().add(-18, -17,  9,  18, 19,   0,  -8,  0, -8, 18,  19, -17)
.var TDY = List().add( -8,   8,  0,  -8,  8, -22, -21, 22, 23, 22, -21, -21)
.const NT = TDX.size()

// zero page ($0A-$0D are the measurement harness)
.const state   = $02        // 0 idle, 1 flight, 2 blast, 3 spent
.const age     = $03        // ticks in this state
.const gxl     = $04        // grenade X, 16 bits
.const gxh     = $05
.const gy      = $06        // grenade Y
.const frame   = $07        // frames since the throw
.const bstart  = $08        // frame the blast began
.const bcount  = $09        // blast ticks run
.const tmax    = $0A        // most cycles one tick took (2 bytes)
.const tcal    = $0C        // timer reading for an empty call (2 bytes)
.const ptr     = $0E        // colour RAM pointer (2 bytes)
.const bxl     = $10        // box origin: grenade X - (BXL-1), 16 bits
.const bxh     = $11
.const by      = $12        // box origin: grenade Y - (BYL-1), 8 bits
.const lo8     = $13        // 8-bit bounds for the defect demonstration
.const hi8     = $14

start:
    sei
    lda #0
    sta $d020
    sta $d021
    lda #$33                // char ROM in at $D000 to copy 64 glyphs
    sta $01
    ldx #0
!:  lda $d000,x
    sta CHARS,x
    lda $d100,x
    sta CHARS+$100,x
    inx
    bne !-
    lda #$37
    sta $01
    ldx #0
!:  lda #$20                // clear the screen, white colour RAM
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$2e8,x
    lda #1
    sta COLRAM,x
    sta COLRAM+$100,x
    sta COLRAM+$200,x
    sta COLRAM+$2e8,x
    inx
    bne !-
    ldx #NT                 // targets and landing marker: one glyph each
!:  txa
    clc
    adc #64
    ldy scrlo,x
    sty ptr
    ldy scrhi,x
    sty ptr+1
    ldy #0
    sta (ptr),y
    dex
    bpl !-
    lda #3                  // landing marker cyan
    ldx #NT
    jsr setcol
    lda #$1c                // screen $0400, chars $3000
    sta $d018
    lda #$1b
    sta $d011
    lda #0
    ldx #NT-1
!:  sta dead16,x
    sta dead8,x
    dex
    bpl !-
    sta frame
    sta age
    sta bstart
    sta bcount
    sta tmax
    sta tmax+1
    // the throw
    lda #<GX0
    sta gxl
    lda #>GX0
    sta gxh
    lda #GY0
    sta gy
    lda #1
    sta state
    lda #13
    sta $d027
    lda shapes
    sta SCREEN+$3f8
    jsr place
    lda #1
    sta $d015
    lda #LINE               // calibrate the harness with an empty call,
!:  cmp $d012               // on the line the ticks run on, clear of
    bne !-                  // badlines and sprite DMA
    jsr tstart
    jsr empty
    jsr tstop
    lda $dd04
    sta tcal
    lda $dd05
    sta tcal+1

loop:
    lda #LINE
!:  cmp $d012
    bne !-
    lda frame
    cmp #STOP
    bcs !+
    jsr tstart
    jsr tick
    jsr tstop
    jsr tkeep
!:  lda frame
    cmp #REPORT
    bne !+
    jsr naive
    jsr report
!:  inc frame
    bne !+
    dec frame               // hold at 255
!:  lda #LINE
!:  cmp $d012
    beq !-
    jmp loop

// ---- one frame of the grenade ----------------------------------------
tick:
    lda state
    cmp #1
    beq flight
    cmp #2
    beq blast
    rts
flight:
    lda gy                  // straight up, whatever the aim
    sec
    sbc #VY
    sta gy
    inc age
    ldx age
    cpx #FLIGHT
    beq land
    lda shapes,x            // height: the shape grows, then shrinks
    sta SCREEN+$3f8
    jmp place
land:
    lda #2
    sta state
    lda #0
    sta age
    lda frame
    sta bstart
    lda #(sprBlast/64)
    sta SCREEN+$3f8
    lda #8
    sta $d027
    lda gxl                 // box origin, once per blast
    sec
    sbc #BXL-1
    sta bxl
    lda gxh
    sbc #0
    sta bxh
    lda gy
    sec
    sbc #BYL-1
    sta by
place:                      // sprite X = x + 13, Y = y + 40
    lda gxl
    clc
    adc #13
    sta $d000
    lda gxh
    adc #0
    sta $d010               // bit 0 is X bit 8; sprite 0 is the only one
    lda gy
    clc
    adc #40
    sta $d001
    rts
blast:
    jsr boxtest
    inc bcount
    inc age
    lda age
    cmp #BLAST
    bne !+
    lda #3
    sta state
    lda #0
    sta $d015
!:  rts

// d = target - origin, origin = blast - (L-1): a hit is 0 <= d < 2L-1+1,
// one unsigned compare per axis. X in 16 bits: the high byte must be 0.
boxtest:
    ldx #NT-1
bt:
    lda dead16,x
    bne btn
    lda txl,x
    sec
    sbc bxl
    tay
    lda txh,x
    sbc bxh
    bne btn                 // off by 256 or more, or negative
    cpy #2*BXL
    bcs btn
    lda ty,x
    sec
    sbc by
    cmp #2*BYL
    bcs btn
    lda #1                  // killed
    sta dead16,x
    lda #2
    jsr setcol
btn:
    dex
    bpl bt
    rts

setcol:                     // colour A into target (or marker) X's cell
    ldy scrlo,x
    sty ptr
    tay
    lda scrhi,x
    clc
    adc #>(COLRAM-SCREEN)
    sta ptr+1
    tya
    ldy #0
    sta (ptr),y
    rts

// ---- the defect: bounds X-18 and X+18 in 8 bits, high bytes equal ----
naive:
    lda gxl
    sec
    sbc #BXL
    sta lo8                 // wraps below X 18
    lda gxl
    clc
    adc #BXL
    sta hi8                 // wraps above X 237
    ldx #NT-1
nv:
    lda txh,x
    cmp gxh
    bne nvn
    lda txl,x
    cmp lo8
    beq nvn
    bcc nvn                 // needs tx > X-18
    cmp hi8
    beq !+
    bcs nvn                 // needs tx <= X+18
!:  lda ty,x
    sec
    sbc by
    cmp #2*BYL
    bcs nvn
    lda #1
    sta dead8,x
nvn:
    dex
    bpl nv
    rts

// ---- measurement harness: CIA 2 timer A around tick ------------------
tstart:
    lda #$ff
    sta $dd04
    sta $dd05
    lda #%00011001          // force load, one-shot, start
    sta $dd0e
    rts
tstop:
    lda #%00001000          // stop
    sta $dd0e
    rts
tkeep:                      // diff = tcal - reading; keep the largest
    sec
    lda tcal
    sbc $dd04
    tax
    lda tcal+1
    sbc $dd05
    cmp tmax+1
    bcc !+
    bne keep
    cpx tmax
    bcc !+
keep:
    stx tmax
    sta tmax+1
!:  rts
empty:
    rts

// ---- rows 0-2: the results -------------------------------------------
report:
    ldx #0
!:  lda labels,x
    sta SCREEN,x
    inx
    cpx #labels_end-labels
    bne !-
    lda bstart
    ldx #13
    jsr puthex
    lda bcount
    ldx #17
    jsr puthex
    lda tmax                // + 12 for the empty call's jsr and rts
    clc
    adc #12
    sta tmax
    bcc !+
    inc tmax+1
!:  lda tmax+1
    ldx #21
    jsr puthex
    lda tmax
    ldx #23
    jsr puthex
    ldx #NT-1
!:  lda dead16,x
    tay
    lda mark,y
    sta SCREEN+40+7,x
    lda dead8,x
    tay
    lda mark,y
    sta SCREEN+80+7,x
    dex
    bpl !-
    rts

puthex:                     // A as two hex digits at row 0, column X
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hexd,y
    sta SCREEN,x
    pla
    and #$0f
    tay
    lda hexd,y
    sta SCREEN+1,x
    rts

.encoding "screencode_upper"
hexd:   .text "0123456789ABCDEF"
mark:   .text ".X"
labels: .text "GRENADE LOB B   N   C"
        .fill 19, $20
        .text "16 BIT"
        .fill 34, $20
        .text "8 BIT"
labels_end:

// ---- targets (then the landing marker at index NT) -------------------
txl:    .fill NT, <(LX + TDX.get(i))
txh:    .fill NT, >(LX + TDX.get(i))
ty:     .fill NT, LY + TDY.get(i)
.function px(i) { .return i < NT ? LX + TDX.get(i) : LX }
.function py(i) { .return i < NT ? LY + TDY.get(i) : LY }
scrlo:  .fill NT+1, <(SCREEN + floor(py(i) / 8) * 40 + floor(px(i) / 8))
scrhi:  .fill NT+1, >(SCREEN + floor(py(i) / 8) * 40 + floor(px(i) / 8))
dead16: .fill NT, 0
dead8:  .fill NT, 0
// sprite shape per flight age: small, middle, large, middle, small
.function sh(a) {
    .if (a < 8 || a >= 32) .return sprS/64
    .if (a < 16 || a >= 24) .return sprM/64
    .return sprL/64
}
shapes: .fill FLIGHT, sh(i)

// ---- sprites: centre pixel at column 11, row 10 ----------------------
.function inside(k, c, r) {
    .var dx = abs(c - 11)
    .var dy = abs(r - 10)
    .if (k == 0) .return dx <= 1 && dy <= 1
    .if (k == 1) .return dx <= 2 && dy <= 2
    .if (k == 2) .return dx <= 3 && dy <= 3
    .return dx * dx + dy * dy <= 100 && (dx + dy) != 0
}
.macro shape(k) {
    .for (var r = 0; r < 21; r++) {
        .for (var b = 0; b < 3; b++) {
            .var v = 0
            .for (var t = 0; t < 8; t++) {
                .if (inside(k, b * 8 + t, r)) .eval v = v | (128 >> t)
            }
            .byte v
        }
    }
    .byte 0
}
* = $2000 "Sprites"
sprS:   shape(0)
sprM:   shape(1)
sprL:   shape(2)
sprBlast: shape(3)       // a disk of radius 10 with the centre pixel clear

// ---- glyphs 64 on: one dot per target, then the marker ---------------
* = CHARS + 64 * 8 "Dots"
.for (var i = 0; i <= NT; i++) {
    .for (var r = 0; r < 8; r++) {
        .byte (mod(py(i), 8) == r) ? (128 >> mod(px(i), 8)) : 0
    }
}
```

## Build

```bash
java -jar "$KICKASS_JAR" grenade-lob.asm -o grenade-lob.prg
java -jar "$KICKASS_JAR" grenade-lob.asm -o grenade-lob-flight.prg :stop=20
java -jar "$KICKASS_JAR" grenade-lob.asm -o grenade-lob-blast.prg :stop=45
```

## Expected output

`screenshots/grenade-lob.png` (PAL) and `screenshots/grenade-lob-ntsc.png`
(NTSC), pinned at 8,000,000 cycles in `recipes/runs.json`, with two PAL
freeze frames: `screenshots/grenade-lob-flight.png` (`:stop=20`, in
flight) and `screenshots/grenade-lob-blast.png` (`:stop=45`, blast on
screen). Verified in VICE x64sc 3.10 (PAL c64c: 8565/8580/8521, and ntsc:
6567R8), measured with PIL; text was read by matching each 8x8 cell
against the character ROM. Raster line = PNG row + 16 on PAL, + 28 on
NTSC; VIC X = PNG x − 8. Playfield pixel (x, y) is VIC X x + 24 on line
y + 51.

| What | PAL | NTSC |
|---|---|---|
| Row 0 | `GRENADE LOB B26 N14 C03BC` | same |
| Row 1, 16-bit kills | `16 BIT .XXX..XX.X.X` | same |
| Row 2, 8-bit kills | `8 BIT  ............` | same |
| Landing marker, cyan | VIC X 274, line 151 (playfield 250, 100) | same |
| Targets red (dead) / white (alive) | 7 / 5, as in the table below | same |

`B` is the frame the blast began ($26 = 38: ticks 0-38 are the 39
flight moves), `N` the blast ticks run ($14 = 20), `C` the most cycles
one tick took, including its `jsr` and `rts` ($3BC = 956, on the first
blast tick).

Each target's state, read from the picture at its offset from the
marker:

| # | dx, dy | Line | Expected | PAL and NTSC |
|---|---|---|---|---|
| 0 | −18, −8 | 143 | alive (dx edge) | alive |
| 1 | −17, +8 | 159 | dead | dead |
| 2 | +9, 0 (X 259) | 151 | dead | dead |
| 3 | +18, −8 | 143 | dead | dead |
| 4 | +19, +8 | 159 | alive (dx edge) | alive |
| 5 | 0, −22 | 129 | alive (dy edge) | alive |
| 6 | −8, −21 | 130 | dead | dead |
| 7 | 0, +22 | 173 | dead | dead |
| 8 | −8, +23 | 174 | alive (dy edge) | alive |
| 9 | +18, +22 | 173 | dead (corner) | dead |
| 10 | +19, −21 | 130 | alive | alive |
| 11 | −17, −21 | 130 | dead (corner) | dead |

The dead dots span dx −17 to +18 and dy −21 to +22 from the marker, and
the live ones next to them sit at −18, +19, −22 and +23: the box edges
measured from the picture are the ones the listing states. Target 2 is at
X 259, high byte 1, and died: the 16-bit test sees across X 256.

The 8-bit row is all dots. With the grenade at X 250 its bounds are
250 − 18 = 232 and 250 + 18 = 268, which is 12 in 8 bits, and no low
byte is both above 232 and at most 12; targets past X 255 also fail the
equal-high-byte test (arithmetic, and the row shows it). The same code
is right while the grenade's X low byte is 18 to 237 and every target
shares its high byte.

Freeze frames (PAL): in flight after 20 moves the grenade is the 7x7
shape, light green, at VIC X 271-277, lines 186-192, centred on
playfield (250, 138), 40 pixels above the throw point. During the blast
the orange disk covers VIC X 264-284, lines 141-161, centred on the
marker, which shows through the disk's one clear pixel. Six red dots
show; target 2 is under the disk.

Cycles. The 956 splits exactly by instruction count (arithmetic, rung 3,
matching the measured total): 12 cycles of dispatch, 24 of blast
bookkeeping, 12 for the calling `jsr`/`rts`, 14 to enter and leave the
test, and per target 12 when already dead, 32 for a miss on the X high
byte, 36 for a miss on the X low byte, 49 for a miss on Y, and 99 for a
hit, of which 51 are the kill and its colour write. Seven hits and five
misses make the first blast tick. A flight tick is at most 84 cycles
(`C0054` in the flight freeze frame, measured).

## Why this works

The box test moves the box, not the target. Once per blast the code
works out the box's corner, blast − 17 in X and blast − 21 in Y. For each
target it subtracts that corner; the target is inside when the X
difference is 0 to 35 and the Y difference 0 to 43. That is one unsigned
compare per axis, and the lower and upper edges come from the same
subtraction, so neither can wrap on its own. X is 16 bits, so a target
256 or more pixels away, or to the left of the corner, has a non-zero
high byte and fails at once. Y stays 8 bits: playfield Y is 0 to 199, so
a difference plus 21 lies between −178 and 220 and never wraps into 0 to
43.

The flight is a fixed velocity and a fixed age, so where the grenade
lands is known at the throw: 39 moves of 2 pixels. The shape is a table
lookup by age; nothing tests terrain while it flies. The blast keeps its
position for 20 ticks and tests every tick, so a target that walks into
the box later still dies. A killed target is marked and skipped, so it
dies once. The sprite's X runs past 255 here (263 at the throw), so bit 8
goes to `$D010` on every move (`sprite_x_high_bit_wrong_register`,
`pitfalls/sprite.md`).

The measurement runs from line 251, below the display, and the empty
call that calibrates the timer runs on that line too. An earlier draft
calibrated during start-up with the screen on; on NTSC the calibration
call met a stall and every tick then read 19 cycles below zero.
