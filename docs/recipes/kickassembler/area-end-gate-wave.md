---
recipe: area-end-gate-wave
toolchain: kickassembler
output_format: PRG
region: both
techniques: [area_end_gate_wave, object_pool, lfsr_random]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D010, D012, D015, D020, D021, D027, D028, D029, D02A, D02B, D02C, D02D, DC00, DD04, DD05, DD0E]
uses_kernal: []
claims: [sprite_0-6 (owns), zero_page $02-$1E (owns)]
harness: [cia2_timer_a, $1F-$22]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — End of an area: counted gate wave, cleared check, scripted walk to the exit

## Synopsis

A map-row counter stands in for the scroll and runs down to 0, where the
scroll stops. A wave of 12 objects then comes out into a pool of six
sprite slots, each spawn decided by a seeded LFSR, so every run is the
same. Two counters end the wave: objects still to come out, and objects
alive, recounted from the slots every frame. Each object is "shot" 40
frames after it spawns, a stand-in for the player's gun. When the map
has ended and both counters are 0, the joystick is ignored and a script
walks the player sprite along to the gate's column and up into the gap
in a wall. Arriving ends the area: a 1,000-point bonus and the area
number go up, and rows 1 to 3 print the frame of each phase, the counts,
the slowest frame's cycles and the order of the spawns. The technique is
`area_end_gate_wave` in `techniques/logic.md`.

## Source

```asm
// area-end-gate-wave.asm: the end of an area.
// A map-row counter stands in for the scroll and counts down to 0; the
// scroll then stops. A wave of NWAVE objects is released into a pool of
// NSLOT slots: each frame, each free slot rolls a seeded LFSR and spawns
// when (roll AND CHANCE) = 0. Two counters rule the end: tospawn (left
// to come out) and alive (recounted from the slots every frame). Each
// object is "shot" LIFE frames after it spawns (a stand-in for the
// player's gun). When the scroll has stopped and both counters are 0,
// the joystick is ignored and a script walks the player to the gate:
// along to GATEX, then up to GATEY. Arriving there ends the area: bonus,
// area number, and rows 1-3 print the frame of each phase.
// Build: java -jar KickAss.jar area-end-gate-wave.asm -o area-end-gate-wave.prg

BasicUpstart2(start)

.const SCREEN = $0400
.const COLRAM = $D800
.const LINE   = 251         // work line, below the display on PAL and NTSC
.const ROWS0  = 8           // map rows left to scroll at start
.const SPEED  = 8           // frames per map row (1 px a frame)
.const NWAVE  = 12          // objects in the gate wave
.const NSLOT  = 6           // pool slots, hardware sprites 1-6
.const CHANCE = 31          // spawn when (roll AND CHANCE) = 0: 1 in 32
.const LIFE   = 40          // frames from spawn to "shot"
.const XMIN   = 96          // spawn X = XMIN + (roll AND 63)
.const SPAWNY = 106         // spawn Y: screen row 7
.const GATEX  = 168         // gate: screen column 18 ...
.const GATEY  = 90          // ... screen row 5
.const WALLROW = 5
.const P0X    = 120         // player start
.const P0Y    = 210
.const SEED   = $A5

// zero page ($1F-$22 are the measurement harness)
.const frame   = $02        // 16-bit frame counter
.const row     = $04        // map row; 0 = the end of the area
.const sub     = $05        // frames to the next row
.const tospawn = $06        // wave objects still to come out
.const alive   = $07        // wave objects alive, recounted each frame
.const peak    = $08        // most alive at once
.const spawned = $09
.const killed  = $0A
.const walk    = $0B        // 1: the script has the player
.const done    = $0C        // 1: the area has ended
.const xrec    = $0D        // 1: GATEX reached and stamped
.const pX      = $0E
.const pY      = $0F
.const seed    = $10        // LFSR state
.const score   = $11        // BCD: low byte = hundreds, thousands
.const area    = $13
.const rstop   = $14        // frame the scroll stopped (2 bytes each)
.const lspawn  = $16        // frame of the last spawn
.const cframe  = $18        // frame the wave was cleared
.const xframe  = $1A        // frame the walk reached GATEX
.const aframe  = $1C        // frame the area ended
.const reported = $1E
.const tmax    = $1F        // most cycles one tick took (2 bytes)
.const tcal    = $21        // timer reading for an empty call (2 bytes)

.macro stamp(dst) {
    lda frame
    sta dst
    lda frame+1
    sta dst+1
}

start:
    sei
    lda #0
    sta $d020
    sta $d021
    ldx #0
!:  lda #$20                // clear the screen, colour RAM white
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
    ldx #39                 // the wall, with a one-cell gate at column 18
!:  lda #$a0
    cpx #(GATEX-24)/8
    bne !+
    lda #$20
!:  sta SCREEN+WALLROW*40,x
    lda #12
    sta COLRAM+WALLROW*40,x
    dex
    bpl !--
    ldx #$1E-$02            // zero the variables $02-$1E
    lda #0
!:  sta frame,x
    dex
    bpl !-
    ldx #NSLOT-1
!:  sta on,x
    dex
    bpl !-
    sta tmax
    sta tmax+1
    lda #ROWS0
    sta row
    lda #SPEED
    sta sub
    lda #NWAVE
    sta tospawn
    lda #SEED
    sta seed
    lda #P0X
    sta pX
    lda #P0Y
    sta pY
    ldx #7                  // one 8x8 shape for every sprite
    lda #(spr/64)
!:  sta SCREEN+$3f8,x
    dex
    bpl !-
    lda #7
    sta $d027               // player yellow
    ldx #NSLOT-1
    lda #10                 // wave light red
!:  sta $d028,x
    dex
    bpl !-
    lda #0
    sta $d010
    jsr writespr
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
    jsr tstart
    jsr tick
    jsr tstop
    jsr tkeep
    jsr writespr
    lda done
    beq !+
    lda reported
    bne !+
    inc reported
    jsr report
!:  inc frame
    bne !+
    inc frame+1
!:  lda #LINE
!:  cmp $d012
    beq !-
    jmp loop

// ---- one frame of the technique ------------------------------------
tick:
    lda row                 // 1. the scroll, until the map ends
    beq wave
    dec sub
    bne !+
    lda #SPEED
    sta sub
    dec row
    bne !+
    :stamp(rstop)
!:  jmp player              // no gate wave while the map moves
wave:
    ldx #0                  // 2. the pool: age, "shoot", spawn
pool:
    lda on,x
    beq free
    inc oy,x
    inc age,x
    lda age,x
    cmp #LIFE
    bne next
    lda #0                  // shot: the slot is free again
    sta on,x
    inc killed
    jmp next
free:
    lda tospawn
    beq next
    jsr rnd
    and #CHANCE
    bne next
    jsr rnd                 // spawn: X from a second roll
    and #63
    clc
    adc #XMIN
    sta ox,x
    lda #SPAWNY
    sta oy,x
    lda #0
    sta age,x
    lda #1
    sta on,x
    dec tospawn
    ldy spawned             // row 3: the slot of each spawn, in order
    txa
    clc
    adc #$31
    sta SCREEN+120,y
    inc spawned
    :stamp(lspawn)
next:
    inx
    cpx #NSLOT
    bne pool
    lda #0                  // 3. recount the living from the slots
    ldx #NSLOT-1
!:  clc
    adc on,x
    dex
    bpl !-
    sta alive
    cmp peak
    bcc player
    sta peak
player:
    lda walk
    bne script
    lda $dc00               // 4. the stick, port 2 (up, down, left, right)
    lsr
    bcs !+
    dec pY
!:  lsr
    bcs !+
    inc pY
!:  lsr
    bcs !+
    dec pX
!:  lsr
    bcs !+
    inc pX
!:  lda row                 // 5. cleared: map ended, none to come, none alive
    ora tospawn
    ora alive
    bne pdone
    lda #1                  // take the stick away
    sta walk
    :stamp(cframe)
    rts
script:
    lda done
    bne pdone
    lda pX                  // along to the gate's column
    cmp #GATEX
    beq xok
    bcc !+
    dec pX
    rts
!:  inc pX
    rts
xok:
    lda xrec
    bne !+
    inc xrec
    :stamp(xframe)
!:  lda pY                  // then up into it
    cmp #GATEY
    beq arrive
    dec pY
    rts
arrive:
    lda #1                  // the area ends
    sta done
    :stamp(aframe)
    sed
    clc
    lda score               // bonus 1,000: $10 in the hundreds byte
    adc #$10
    sta score
    lda score+1
    adc #0
    sta score+1
    cld
    inc area
pdone:
    rts

rnd:                        // 8-bit Galois LFSR, taps $B8, period 255
    lda seed
    lsr
    bcc !+
    eor #$b8
!:  sta seed
    rts

writespr:
    lda pX
    sta $d000
    lda pY
    sta $d001
    ldx #0
    ldy #0
!:  lda ox,x
    sta $d002,y
    lda oy,x
    sta $d003,y
    iny
    iny
    inx
    cpx #NSLOT
    bne !-
    lda #0                  // enable: live slots, then the player
    ldx #NSLOT-1
!:  asl
    ora on,x
    dex
    bpl !-
    asl
    ora #1
    sta $d015
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

// ---- rows 1 and 2: the measured values -----------------------------
report:
    ldx #0
!:  lda labels,x
    sta SCREEN+40,x
    inx
    cpx #labels_end-labels
    bne !-
    lda rstop+1
    ldx #1
    jsr puthex
    lda rstop
    ldx #3
    jsr puthex
    lda lspawn+1
    ldx #7
    jsr puthex
    lda lspawn
    ldx #9
    jsr puthex
    lda cframe+1
    ldx #13
    jsr puthex
    lda cframe
    ldx #15
    jsr puthex
    lda xframe+1
    ldx #19
    jsr puthex
    lda xframe
    ldx #21
    jsr puthex
    lda aframe+1
    ldx #25
    jsr puthex
    lda aframe
    ldx #27
    jsr puthex
    lda spawned
    ldx #41
    jsr puthex
    lda killed
    ldx #45
    jsr puthex
    lda peak
    ldx #49
    jsr puthex
    lda tmax                // + 12 for the empty call's jsr and rts
    clc
    adc #12
    sta tmax
    bcc !+
    inc tmax+1
!:  lda tmax+1
    ldx #53
    jsr puthex
    lda tmax
    ldx #55
    jsr puthex
    lda score+1
    ldx #59
    jsr puthex
    lda score
    ldx #61
    jsr puthex
    lda area
    ldx #67
    jsr puthex
    rts

puthex:                     // A as two hex digits at SCREEN+40+X
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
labels: .text "R     L     C     X     A    "
        .fill 11, $20
        .text "N   K   P   T     S    00 G"
labels_end:

// ---- the pool: one entry per slot ----------------------------------
on:     .fill NSLOT, 0
ox:     .fill NSLOT, 0
oy:     .fill NSLOT, 0
age:    .fill NSLOT, 0

* = $2000 "Sprites"         // $1000-$1FFF is the char ROM to the VIC
spr:                        // 8x8 solid block
.for (var y = 0; y < 21; y++) {
    .if (y < 8) { .byte $ff, $00, $00 } else { .byte 0, 0, 0 }
}
.byte 0
```

## Build

```bash
java -jar "$KICKASS_JAR" area-end-gate-wave.asm -o area-end-gate-wave.prg
```

## Expected output

`screenshots/area-end-gate-wave.png` (PAL) and
`screenshots/area-end-gate-wave-ntsc.png` (NTSC), pinned at 12,000,000
cycles in `recipes/runs.json`. Verified in VICE x64sc 3.10 (PAL c64c:
8565/8580/8521, and ntsc: 6567R8), measured with PIL; text was read by
matching each 8x8 cell against the character ROM. Raster line = PNG row
+ 16 on PAL, + 28 on NTSC; VIC X = PNG x − 8. Both models give the same
picture inside the display window.

| What | PAL and NTSC |
|---|---|
| Row 1 text | `R003F L00E2 C010A X013B A01B3` |
| Row 2 text | `N0C K0C P05 T0257 S001000 G01` |
| Row 3 text | `456134561345` |
| Wall, grey (12) | VIC X 24-343, lines 91-98, less one 8x8 cell |
| Player, yellow 8x8 | VIC X 168-175, lines 91-98: the gap in the wall |
| Wave sprites, light red | none drawn (all 12 freed) |

Row 1 is five frame numbers, hex: `R` the frame the map row reached 0
and the scroll stopped (63), `L` the frame of the last spawn (226), `C`
the frame the wave was cleared and the stick taken away (266), `X` the
frame the walk reached the gate's column (315) and `A` the frame the
area ended (435). Row 2: `N` objects spawned and `K` objects shot (12
each), `P` the most alive at once (5), `T` the most cycles one tick took,
including its `jsr` and `rts` (599), `S` the score in BCD with a fixed
`00` (1,000) and `G` the area number (1). Row 3 is the pool slot of each
spawn in order.

The numbers agree with the constants and with a Python model of the
same LFSR (seed $A5, taps $B8, period 255) and the same rules, which
gives the same five frames, the same spawn order and the same peak.
Eight map rows at 8 frames each end on frame 63. The last object lives
40 frames, 226 + 40 = 266, and the check runs on that frame. The walk
starts the frame after: 48 pixels to X 168 by frame 314, stamped on 315,
then 120 pixels up, Y 210 to 90, arriving on frame 435. Slot 2 never
spawns: in this seed's sequence its rolls never pass the mask while
`tospawn` is above 0 (the model agrees). Frames are the same on NTSC,
which shows them about 19% faster in real time (59.826 against
50.125 Hz, arithmetic).

Off by one term: with `ora tospawn` removed from the cleared check, row
1 read `R003F L00E2 C003F X0070 A00E8` and row 2 `N0C K0A`: the wave
counted as cleared on frame 63, before its first spawn, and the area
ended on frame 232 with 2 objects still alive.

## Why this works

The scroll, the pool and the walk run in a fixed order inside one
tick, once a frame, from line 251 below the display: the scroll first,
so the pool starts on the frame after the stop; the pool next, so a slot
freed this frame is counted free; the recount; then the cleared check,
which reads counters that are already this frame's. Recounting `alive`
from the `on` bytes makes the check independent of how a slot was freed.

The spawn roll happens once per free slot per frame, so the time a wave
takes depends on how full the pool is. Rolling an LFSR from a fixed
seed, rather than a timer or `$D012`, makes that time the same on every
run and both models, which is what lets the screenshot pin it. A game
seeds once at power-on from something that varies and gets a different
wave each time.

The walk ignores `$DC00` and moves X before Y, one pixel a frame, and
compares with `==`. A 1-pixel step reaches any target exactly; a
larger step needs a clamp (the technique's pitfalls). The sprites are written
after the tick from the pool and player bytes, with `$D015` built from
the `on` bytes, so a freed slot vanishes on the frame it is freed. The
interrupts stay masked (`sei`) and the loop polls `$D012`, so nothing
else runs. The CIA 2 timer and `$1F-$22` are the measurement harness.
