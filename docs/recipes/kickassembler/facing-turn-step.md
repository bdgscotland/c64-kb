---
recipe: facing-turn-step
toolchain: kickassembler
output_format: PRG
region: both
techniques: [facing_turn_step]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D012, D015, D020, D021, D027, DC00, DD04, DD05, DD0E]
uses_kernal: []
claims: [sprite_0 (owns), zero_page $02-$07+$0C-$0F (owns)]
harness: [cia2_timer_a, $08-$0B]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Sixteen-direction facing that turns one step per frame

## Synopsis

A 40-frame stick script drives an eight-way mover and a sixteen-direction
facing. Each frame the four direction bits are decoded to a target facing
and a move. The facing takes one 22.5-degree step toward the target, the
shorter way round, so the aim lags the stick: a 180-degree reversal takes
eight frames. The screen plots one column per frame, the target in grey
and the facing in yellow, so the turn can be read off the picture step by
step. Row 1 reports the final facing, the sprite's position and the most
cycles one frame's work took. The technique is `facing_turn_step` in
`techniques/input.md`.

## Source

```asm
// facing-turn-step.asm: sixteen-direction aim that turns one step per
// frame toward the stick, with eight-way movement.
// A 40-frame stick script stands in for a player (it is ANDed into the
// $DC00 read, so a real stick in port 2 also counts). Each frame the four
// direction bits are decoded to a target facing (0-14, even) and a move;
// the facing (0-15, 22.5 degrees a step, 0 up, 4 right) takes one step
// toward the target, the shorter way round, clockwise on a 180-degree tie.
// The plot, rows 4-19, is one column per frame: row 4 + target in grey,
// row 4 + facing in yellow. Row 1 reports the end state.
// Build: java -jar KickAss.jar facing-turn-step.asm -o facing-turn-step.prg

BasicUpstart2(start)

.const SCREEN = $0400
.const COLRAM = $D800
.const LINE   = 251         // work line, below the display on PAL and NTSC
.const NFR    = 40          // frames of scripted input, one plot column each
.const PROW   = 4           // screen row of facing 0
.const SX0    = 120         // sprite start X
.const SY0    = 218         // sprite start Y

// zero page ($08-$0B are the measurement harness)
.const facing = $02         // 0-15
.const target = $03         // 0-14 even, $FF = stick centred
.const frame  = $04
.const px     = $05
.const py     = $06
.const pcol   = $07
.const tmax   = $08         // most cycles one tick took (2 bytes)
.const tcal   = $0A         // timer reading for an empty call (2 bytes)
.const sptr   = $0C         // plot pointers, screen and colour (2 each)
.const cptr   = $0E

start:
    sei
    lda #0
    sta $d020
    sta $d021
    ldx #0
!:  lda #$20
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
    lda #0
    sta facing
    sta frame
    sta tmax
    sta tmax+1
    lda #$ff
    sta target
    lda #SX0
    sta px
    lda #SY0
    sta py
    lda #(spr/64)
    sta SCREEN+$3f8
    lda #1
    sta $d027
    lda #0
    sta $d010
    jsr putspr
    lda #1
    sta $d015
    jsr tstart              // calibrate the harness with an empty call
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
    cmp #NFR
    bcs wait                // script over: the picture stays
    jsr tstart
    jsr tick
    jsr tstop
    jsr tkeep
    jsr putspr
    ldy frame               // plot this frame's column
    lda target
    bmi !+                  // centred: no target cell
    ldx #11
    jsr plot
!:  ldy frame
    lda facing
    ldx #7
    jsr plot
    inc frame
    lda frame
    cmp #NFR
    bne wait
    jsr report
wait:
    lda #LINE
!:  cmp $d012
    beq !-
    jmp loop

// ---- one frame of the technique ------------------------------------
tick:
    ldx frame
    lda $dc00               // port 2, 0 = pressed
    and script,x            // the scripted stick
    eor #$ff
    and #$0f                // up, down, left, right as 1 bits
    tax
    lda dirtab,x
    sta target
    lda px                  // eight-way move, 2 px across, 1 px down
    clc
    adc dxtab,x
    sta px
    lda py
    clc
    adc dytab,x
    sta py
    lda target              // turn one step toward the target
    bmi tdone               // centred: hold the facing
    sec
    sbc facing
    and #15                 // clockwise distance, 0-15
    beq tdone
    cmp #8
    beq cw                  // 180 degrees: clockwise
    bcs ccw                 // 9-15: anticlockwise is shorter
cw: lda facing
    clc
    adc #1
    and #15
    sta facing
    rts
ccw:
    lda facing
    sec
    sbc #1
    and #15
    sta facing
tdone:
    rts

putspr:
    lda px
    sta $d000
    lda py
    sta $d001
    rts

// A = row value 0-15, X = colour, Y = column
plot:
    stx pcol
    tax
    lda rowlo,x
    sta sptr
    sta cptr
    lda rowhi,x
    sta sptr+1
    clc
    adc #>(COLRAM-SCREEN)
    sta cptr+1
    lda #$a0                // reversed space: a solid cell
    sta (sptr),y
    lda pcol
    sta (cptr),y
    rts

// ---- measurement harness: CIA 2 timer A around tick ----------------
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

// ---- row 1: facing, sprite X and Y, most cycles per tick -----------
report:
    ldx #0
!:  lda labels,x
    sta SCREEN+40,x
    inx
    cpx #labels_end-labels
    bne !-
    lda facing
    ldx #1
    jsr puthex
    lda px
    ldx #5
    jsr puthex
    lda py
    ldx #9
    jsr puthex
    lda tmax                // + 12 for the empty call's jsr and rts
    clc
    adc #12
    sta tmax
    bcc !+
    inc tmax+1
!:  lda tmax+1
    ldx #13
    jsr puthex
    lda tmax
    ldx #15
    jsr puthex
    rts

puthex:                     // A as two hex digits at row 1, column X
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hexd,y
    sta SCREEN+40,x
    pla
    and #$0f
    tay
    lda hexd,y
    sta SCREEN+41,x
    rts

.encoding "screencode_upper"
hexd:   .text "0123456789ABCDEF"
labels: .text "F   X   Y   C"
labels_end:

// ---- tables --------------------------------------------------------
// index = pressed bits: 1 up, 2 down, 4 left, 8 right
// facing 0 up, 2 up-right, 4 right ... 14 up-left; $FF centred or invalid
dirtab: .byte $ff, 0, 8, $ff, 12, 14, 10, $ff
        .byte 4, 2, 6, $ff, $ff, $ff, $ff, $ff
dxtab:  .byte 0, 0, 0, 0, -2, -2, -2, 0
        .byte 2, 2, 2, 0, 0, 0, 0, 0
dytab:  .byte 0, -1, 1, 0, 0, -1, 1, 0
        .byte 0, -1, 1, 0, 0, 0, 0, 0
rowlo:  .fill 16, <(SCREEN + (PROW + i) * 40)
rowhi:  .fill 16, >(SCREEN + (PROW + i) * 40)

// the stick, one byte a frame, $DC00 form (0 = pressed)
script: .fill 6,  $fe       // up
        .fill 10, $fd       // down: a 180-degree turn
        .fill 8,  $f7       // right
        .fill 8,  $fa       // up-left: through facing 0
        .fill 4,  $ff       // centred: the facing holds
        .fill 4,  $f5       // down-right: another 180, cut short

.align 64
spr:                        // 8x8 solid square
.for (var y = 0; y < 21; y++) {
    .if (y < 8) { .byte $ff, $00, $00 } else { .byte 0, 0, 0 }
}
.byte 0
```

## Build

```bash
java -jar "$KICKASS_JAR" facing-turn-step.asm -o facing-turn-step.prg
```

## Expected output

`screenshots/facing-turn-step.png` (PAL) and
`screenshots/facing-turn-step-ntsc.png` (NTSC), pinned at 8,000,000
cycles in `recipes/runs.json`. Verified in VICE x64sc 3.10 (PAL c64c:
8565/8580/8521, and ntsc: 6567R8), measured with PIL: each plot cell was
classed by colour, and row 1 was read by matching each 8x8 cell against
the character ROM. Raster line = PNG row + 16 on PAL, + 28 on NTSC;
VIC X = PNG x − 8. Both models give the same picture.

Row 1 reads `F02 X80 YDA C005D`: final facing 2, sprite X 128, sprite
Y 218, and 93 cycles for the worst frame's `tick`, its `jsr` and `rts`
included.

The facing plotted in columns 0-39 (one frame each, the value after that
frame's step):

| Frames | Stick | Target | Facing |
|---|---|---|---|
| 0-5 | up | 0 | 0 0 0 0 0 0 |
| 6-15 | down | 8 | 1 2 3 4 5 6 7 8 8 8 |
| 16-23 | right | 4 | 7 6 5 4 4 4 4 4 |
| 24-31 | up-left | 14 | 3 2 1 0 15 14 14 14 |
| 32-35 | centred | none | 14 14 14 14 |
| 36-39 | down-right | 6 | 15 0 1 2 |

Grey target cells show in frames 6-12, 16-18, 24-28 and 36-39, the
frames on which the facing had not yet arrived; in the other columns the
yellow cell covers the grey one or the stick is centred.

- The reversal at frame 6 is a tie (distance 8). The listing breaks it
  clockwise, so the facing runs 1 to 8 and arrives on frame 13, the
  eighth frame of the turn.
- Right from 8 is 12 steps clockwise or 4 anticlockwise; it goes
  anticlockwise in 4 frames (16-19).
- Up-left from 4 wraps through 0: 3, 2, 1, 0, 15, 14 in 6 frames.
- Centred holds the facing: the decode gives `$FF` and the turn is
  skipped.
- The last turn is cut off by the end of the script at facing 2, halfway
  round.

The 8x8 white sprite ends at VIC X 128-135, lines 219-226: X 120 + 2 × 8
(right) − 2 × 8 (up-left) + 2 × 4 (down-right) = 128, and Y 218 − 6 + 10
− 8 + 4 = 218, drawn from line Y + 1.

## Why this works

The target is a direction on the same sixteen-step circle as the facing,
on its even values, so one subtraction masked to four bits gives the
clockwise distance from the facing to the target. Distance 1 to 7 means
clockwise is shorter, 9 to 15 means anticlockwise is, 0 means arrived and
8 is a tie the code has to break one way. The facing then moves by one
and is masked again, which wraps 15 to 0 and 0 to 15 with no compare.

Movement and facing are decoded from the same four bits in the same
table lookup, so the mover goes the way the stick points at once while
the facing takes its frames to follow. A bullet spawned from the facing
leaves along an in-between angle during a turn. The move tables give
2 px across and 1 px down a frame; any speeds work.

The script is ANDed into the `$DC00` read. With the KERNAL interrupt off
and no stick in port 2, the read gives `$7F` or `$FF` and the low four
bits are all 1, so the script alone decides; a stick in port 2 adds its
presses. The work runs once a frame after the raster reaches line 251,
below the display on both PAL and NTSC.
