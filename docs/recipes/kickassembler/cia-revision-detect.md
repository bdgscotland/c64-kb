---
recipe: cia-revision-detect
toolchain: kickassembler
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: [DC04, DC05, DC06, DC07, DC0D, DC0E, DC0F, D011, D012, D020]
uses_kernal: []
claims: [irq_vector_fffe (owns), nmi_vector_fffa (owns), cia1_timer_a (owns), cia1_timer_b (owns), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init), vic_raster_irq (init), zero_page $FB-$FE (owns)]
harness: [$02FE-$02FF]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Detect the CIA revision from its interrupt latency

## Synopsis

Tells an old 6526 from a 6526A or 8521 at CIA1 by measuring how many
cycles pass between a Timer A underflow and the first instruction of the
interrupt handler. Timer B free-runs from `$FFFF` as the clock; the
handler's first instruction reads it. The old part raises its interrupt
one cycle later than the new one, and against a run of 2-cycle `NOP`s
that shows as a pair of readings the program can classify. The result
goes to `$02FE` (`00` old 6526, `01` new 8521 or 6526A, `FF` neither
signature) and the verdict to `$02FF` and the border. Use it once at
start-up, before a raster routine or a loader that counts on the CIA's
cycle-exact interrupt timing. The pitfall it serves is
`cia_revision_irq_one_cycle_late` in `pitfalls/cia.md`.

## Source

```asm
// cia-revision-detect.asm
// Detects which CIA revision sits at CIA1 by measuring how many cycles
// pass between a Timer A underflow and the first instruction of the IRQ
// handler. Timer B free-runs from $FFFF as the clock. The test runs at
// two phases (Timer A latch $40 and $41) against a run of 2-cycle NOPs:
// on VICE's old 6526 the pair reads $12/$11, on its new 8521 $10/$11.
// Result byte at $02FE: 0 = old 6526, 1 = new 8521 / 6526A, $FF = neither
// signature. $02FF = 1 and a green border when a signature matched,
// 2 and red otherwise.
.encoding "screencode_upper"

.const SCREEN   = $0400
.const BASE     = $40
.const REVISION = $02fe
.const RESULT   = $02ff
.const zp_ph    = $fb        // phase index 0 or 1
.const zp_flag  = $fc        // handler sets to 1
.const txt_ptr  = $fd        // verdict text pointer

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$35
    sta $01                  // I/O in, KERNAL and BASIC out
    lda #<irq
    sta $fffe
    lda #>irq
    sta $ffff
    lda #<nmi
    sta $fffa
    lda #>nmi
    sta $fffb
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #$00
    sta $d01a
    lda #$ff
    sta $d019
    lda #$00
    sta $d015
    lda #$0b
    sta $d011                // DEN = 0: no badlines while measuring
    lda #$00
    sta $d020
    sta $d021
    jsr clear_screen
    jsr wait_frame
    jsr wait_frame

    lda #$00
    sta zp_ph
phase_loop:
    jsr arm_timers
    lda zp_ph
    clc
    adc #BASE
    sta $dc04                // Timer A latch = $40 + phase
    lda #$00
    sta $dc05
    sta zp_flag
    lda #$81
    sta $dc0d                // Timer A may interrupt
    lda #$40
sync:
    cmp $d012
    bne sync
    cli
    lda #$11
    ldx #$19
    sta $dc0f                // Timer B: continuous, load, start
    stx $dc0e                // Timer A: one-shot, load, start, 4 cycles later
    .fill 200, $ea           // the IRQ lands in these NOPs
    sei
    lda zp_flag
    beq unknown
    inc zp_ph
    lda zp_ph
    cmp #$02
    beq classify
    jmp phase_loop

classify:
    // lat[k] = ($FF - TBlo) - ($40 + k): the phase-0 value decides
    lda #$ff
    sec
    sbc tb_lo
    sec
    sbc #BASE
    sta lat
    lda #$ff
    sec
    sbc tb_lo+1
    sec
    sbc #BASE+1
    sta lat+1
    cmp #$11
    bne unknown              // the odd phase reads $11 on both models
    lda lat
    cmp #$12
    beq old_cia
    cmp #$10
    bne unknown
    lda #$01
    sta REVISION
    ldx #<txt_new
    ldy #>txt_new
    jmp report
old_cia:
    lda #$00
    sta REVISION
    ldx #<txt_old
    ldy #>txt_old
    jmp report
unknown:
    lda #$ff
    sta REVISION
    ldx #<txt_unknown
    ldy #>txt_unknown
    jsr show
    lda #$02
    sta $d020
    sta RESULT
    jmp hang
report:
    jsr show
    lda #$05
    sta $d020
    lda #$01
    sta RESULT
hang:
    jmp hang

irq:
    lda $dc06                // the read is this instruction's 4th cycle
    ldx zp_ph
    sta tb_lo,x
    lda $dc0d                // acknowledge
    lda #$01
    sta zp_flag
    rti

nmi:
    rti

arm_timers:
    lda #$00
    sta $dc0e
    sta $dc0f
    lda #$7f
    sta $dc0d
    lda $dc0d
    lda #$ff
    sta $dc06
    sta $dc07                // Timer B latch $FFFF
    rts

wait_frame:
    lda $d012
    bne wait_frame
    lda $d011
    bmi wait_frame
!:  lda $d012
    beq !-
    rts

clear_screen:
    ldx #$00
    lda #$20
!:  sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne !-
    ldx #$00
    lda #$01
!:  sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $db00,x
    inx
    bne !-
    rts

// X/Y = verdict text. Row 0: title. Row 2: the two latency bytes.
// Row 4: the verdict.
show:
    stx txt_ptr
    sty txt_ptr+1
    lda #$1b
    sta $d011                // display back on
    ldx #$00
!:  lda txt_title,x
    beq !+
    sta SCREEN,x
    inx
    bne !-
!:  lda lat
    ldy #$00
    jsr put_hex
    lda lat+1
    ldy #$03
    jsr put_hex
    ldy #$00
!:  lda (txt_ptr),y
    beq !+
    sta SCREEN+160,y
    iny
    bne !-
!:  rts

put_hex:                     // A = byte, Y = column on row 2
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdig,x
    sta SCREEN+80,y
    iny
    pla
    and #$0f
    tax
    lda hexdig,x
    sta SCREEN+80,y
    rts

hexdig:      .text "0123456789ABCDEF"
txt_title:   .text "CIA1 IRQ LATENCY, PHASES 0 AND 1:"
             .byte 0
txt_old:     .text "OLD 6526: IRQ ONE CYCLE LATER (02FE=00)"
             .byte 0
txt_new:     .text "NEW 8521 OR 6526A (02FE=01)"
             .byte 0
txt_unknown: .text "NO KNOWN SIGNATURE (02FE=FF)"
             .byte 0
tb_lo:       .byte 0, 0
lat:         .byte 0, 0
```

## Build

```bash
java -jar $KICKASS_JAR cia-revision-detect.asm -o cia-revision-detect.prg
```

KickAssembler 5.25 produces a 1,019-byte PRG; the code segment runs
`$0900` to `$0BF9`.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -ciamodel 0 \
      -exitscreenshot cia-revision-detect.png -autostart cia-revision-detect.prg
```

Add `-model ntsc` for the second picture. `-ciamodel 0` selects VICE's
old 6526 for both CIAs (`1` is the new 8521; the names and values are
from `x64sc -help`, VICE 3.10). The pin uses the old part because it is
not the PAL default: a run with no `-ciamodel` flag reads as the new
part on the PAL default (VICE's C64C) and on `-model c64c`, so a picture
of it would not show the flag doing anything. The default depends on the
model: with no flag, `-model c64` and `-model ntsc` read `12 11`, the old
part, and `-model newntsc` reads `10 11`, the new one (measured in VICE
x64sc 3.10). An earlier version of this paragraph
said a run with no flag reads as the new part, without naming the model.

## Expected output

Green border, black background, white text:

```text
row 0  CIA1 IRQ LATENCY, PHASES 0 AND 1:
row 2  12 11
row 4  OLD 6526: IRQ ONE CYCLE LATER (02FE=00)
```

`recipes/kickassembler/screenshots/cia-revision-detect.png` (PAL, 384 by
272) and `cia-revision-detect-ntsc.png` (NTSC, 384 by 247) were each
produced three times by the pinned command with identical bytes, and
decoded by matching every 8 by 8 cell against `chargen-901225-01.bin`
(measured in VICE x64sc 3.10, rung 1). With `-ciamodel 1` instead, on
either model, row 2 reads `10 11` and row 4 `NEW 8521 OR 6526A
(02FE=01)`, border green. `$02FF` is `01` in all four cases. The
verdict is internal: the pair of readings matched one of the two
signatures. Which one it matched is what the command line set, and the
picture shows it.

Row 2 is the number of Timer B counts between the start of the test and
the handler's read, less the Timer A latch, for the latch `$40` and then
`$41`. The two models differ at the even phase by two cycles and agree
at the odd one; averaged over both phases the old part is one cycle
later, which is the mechanism, and the 2-cycle `NOP` boundary is why it
shows as 0 or 2 rather than 1. The eight-phase form of the same
measurement is in `pitfalls/cia.md`, `cia_revision_irq_one_cycle_late`.

## Why this works

The measurement needs a fixed instruction stream from the timer start
to the handler's first read, so nothing may steal a cycle: the display
is blanked (`$D011` bit 4 clear) two frames ahead so no badline occurs,
sprites are off, and the KERNAL is banked out so the hardware vector at
`$FFFE` goes straight to the handler with no dispatcher in the way. The
`$D012` wait only orders the test within the frame; with no badlines
the CIA figures do not depend on the raster position, and the PAL and
NTSC pictures agree.

Two writes start the clocks four cycles apart: `sta $DC0F` starts Timer
B counting down from `$FFFF`, `stx $DC0E` starts Timer A one-shot from
the latch. When Timer A underflows the chip sets ICR bit 0 and, with
the mask set, pulls `/IRQ`. The 6510 finishes the `NOP` it is in, runs
its seven-cycle interrupt sequence and fetches the handler's `lda
$DC06`, whose fourth cycle reads the low byte of Timer B. `$FF` less
that byte, less the latch, is the figure on screen. Everything in that
path is fixed except the CIA's own delay between underflow and `/IRQ`,
and the 6510 samples `/IRQ` once per instruction, so a one-cycle change
in the CIA either changes nothing or costs a whole `NOP`. Running two
latches one apart puts one test on each side of that boundary, which
is why the odd phase reads the same on both parts and the even one
tells them apart.

The classifier compares against the two pairs measured in VICE. A pair
that matches neither reports `$FF`; on hardware this recipe has not
been run, and a third pair is a case this page does not cover.
