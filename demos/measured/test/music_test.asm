// test/music_test.asm: standalone runner for the music module. Not a part
// module and not the stub: a BASIC stub at $0801, code at $0810, a text
// readout on rows 0 to 5 of $0400 in the ROM font, and a line-255 raster
// interrupt that calls music_play once per frame, bracketed by CIA1 timer A
// (the sfx-in-player recipe's stopwatch: one-shot from $FFFF, net of its
// own start and stop). At frame 300 it grades: $02FF = 1 if music_pos has
// advanced as arithmetic predicts (300 / 192 rows to order 1) and the call
// count equals the frame count, else 2; green or red border. The readout
// freezes at frame 300 so the pin is static; the music keeps playing and
// the runner records music_pos at frames 1000 and 4000 in $02F6 and $02F7
// for the monitor to dump.
//   $02F0/1 worst play cycles over frames 1 to 300   $02F2/3 the frame-300 call's cycles
//   $02F4/5 calls at frame 300                       $02F8 music_pos at frame 300
//   $02F6 music_pos at frame 1000                    $02F7 music_pos at frame 4000
//   $02F9/A worst play cycles over frames 1 to 4000 (row 6 shows the same)
// Build: java -jar KickAss.jar test/music_test.asm -odir build -o build/music_test.prg

#import "../src/api.inc"

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN     = $0400
.const GRADE_AT   = 300
.const POS_AT_A   = 1000
.const POS_AT_B   = 4000

* = $0810 "runner"

start:
    sei
    lda #$37
    sta $01
    lda #$7f
    sta $dc0d               // no CIA interrupts: timer A is the stopwatch
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #0
    sta $d020
    sta $d021
    ldx #0
clr:
    lda #$20
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $2e8,x
    lda #1
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne clr
    ldx #0
lab:
    lda labels,x            // seven rows of labels: 280 bytes in two passes
    sta SCREEN,x
    inx
    bne lab
lab2:
    lda labels + 256,x
    sta SCREEN + 256,x
    inx
    cpx #24
    bne lab2
    lda #0
    sta frame
    sta frame + 1
    sta calls
    sta calls + 1
    sta worst
    sta worst + 1
    sta done
    sta frame_tick
    sta $02f6
    sta $02f7
    lda #0
    jsr music_init
    jsr calibrate
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #SEQ_LINE
    sta $d012
    lda $d011
    and #$7f
    sta $d011
    lda #$01
    sta $d01a
    asl $d019
    cli
// Count frames from a tick flag set in the IRQ.
// The IRQ sets frame_tick = 1 once per call; the idle loop converts each
// tick into a frame increment. calls is the IRQ's own count; frame is the
// idle loop's count. The grade check calls == frame measures whether the
// IRQ fires at the right rate, not a tautology (the two counters are in
// separate code paths and can diverge if the IRQ fires too often or is
// missed).
idle:
    lda frame_tick
    beq idle                // wait for the IRQ to post a tick
    lda #0
    sta frame_tick
    inc frame
    bne idle
    inc frame + 1
    jmp idle

// ---------------------------------------------------------------------------
// Stopwatch: CIA1 timer A, one-shot from $FFFF (the recipe's).
// ---------------------------------------------------------------------------
calibrate:
    lda #$ff
    sta $dc04
    sta $dc05
    lda #%00011001          // force load, one-shot, start
    sta $dc0e
    lda #0
    sta $dc0e               // stop
    sec
    lda #$ff
    sbc $dc04
    sta calib
    lda #$ff
    sbc $dc05
    sta calib + 1
    rts

timed_play:
    lda #$ff
    sta $dc04
    sta $dc05
    lda #%00011001
    sta $dc0e
    jsr music_play
    lda #0
    sta $dc0e
    sec
    lda #$ff
    sbc $dc04
    sta cost
    lda #$ff
    sbc $dc05
    sta cost + 1
    sec                     // less the stopwatch's own start/stop
    lda cost
    sbc calib
    sta cost
    lda cost + 1
    sbc calib + 1
    sta cost + 1
    rts

// ---------------------------------------------------------------------------
// Line 255, once per frame: count the call, time it, keep the worst,
// count the frame, update the readout until frame 300, grade at 300.
// ---------------------------------------------------------------------------
irq:
    asl $d019
    lda #1
    sta frame_tick          // post a tick; the idle loop converts it to a frame count
    // calls is incremented at irqcounts (after the grade check) so that at
    // grade time calls and frame have the same value and the check is not a tautology.
    jsr timed_play
    lda cost + 1
    cmp worst + 1
    bcc nw
    bne newworst
    lda cost
    cmp worst
    bcc nw
newworst:
    lda cost
    sta worst
    lda cost + 1
    sta worst + 1
nw:
    lda done
    bne later
    jsr readout
    lda frame + 1
    cmp #>GRADE_AT
    bne irqcounts
    lda frame
    cmp #<GRADE_AT
    bne irqcounts
    jsr grade
    // fall through to later -> irqcounts (incrementing calls)
later:
    lda frame + 1
    cmp #>POS_AT_A
    bne !+
    lda frame
    cmp #<POS_AT_A
    bne !+
    lda music_pos
    sta $02f6
    lda #<(SCREEN + 6 * 40 + 18)
    ldx #>(SCREEN + 6 * 40 + 18)
    ldy music_pos
    jsr puthex
!:  lda frame + 1
    cmp #>POS_AT_B
    bne irqcounts
    lda frame
    cmp #<POS_AT_B
    bne irqcounts
    lda music_pos
    sta $02f7
    lda #<(SCREEN + 6 * 40 + 30)
    ldx #>(SCREEN + 6 * 40 + 30)
    ldy music_pos
    jsr puthex
    lda worst               // the running worst over frames 1 to 4000
    sta $02f9
    lda worst + 1
    sta $02fa
    lda #<(SCREEN + 6 * 40 + 36)
    ldx #>(SCREEN + 6 * 40 + 36)
    ldy worst + 1
    jsr puthex
    lda #<(SCREEN + 6 * 40 + 38)
    ldx #>(SCREEN + 6 * 40 + 38)
    ldy worst
    jsr puthex
irqcounts:
    inc calls
    bne irqdone
    inc calls + 1
irqdone:
    jmp $ea81               // pla/tay/pla/tax/pla/rti

grade:
    lda #1
    sta done
    lda worst
    sta $02f0
    lda worst + 1
    sta $02f1
    lda cost
    sta $02f2
    lda cost + 1
    sta $02f3
    lda calls
    sta $02f4
    lda calls + 1
    sta $02f5
    lda music_pos
    sta $02f8
    cmp #GRADE_AT / (32 * 6)    // 300 / 192 = 1
    bne gfail
    lda calls
    cmp frame
    bne gfail
    lda calls + 1
    cmp frame + 1
    bne gfail
    ldx #3
gp:
    lda passtxt,x
    sta SCREEN + 5 * 40 + 10,x
    dex
    bpl gp
    lda #BORDER_PASS
    sta $d020
    lda #$01
    sta RESULT_BYTE
    rts
gfail:
    ldx #3
gf:
    lda failtxt,x
    sta SCREEN + 5 * 40 + 10,x
    dex
    bpl gf
    lda #BORDER_FAIL
    sta $d020
    lda #$02
    sta RESULT_BYTE
    rts

// Rows 0 to 4: position, frames, calls, the 25 shadow bytes, cycles.
readout:
    lda #<(SCREEN + 33)
    ldx #>(SCREEN + 33)
    ldy music_pos
    jsr puthex
    lda #<(SCREEN + 40 + 7)
    ldx #>(SCREEN + 40 + 7)
    ldy frame + 1
    jsr puthex
    lda #<(SCREEN + 40 + 9)
    ldx #>(SCREEN + 40 + 9)
    ldy frame
    jsr puthex
    lda #<(SCREEN + 40 + 19)
    ldx #>(SCREEN + 40 + 19)
    ldy calls + 1
    jsr puthex
    lda #<(SCREEN + 40 + 21)
    ldx #>(SCREEN + 40 + 21)
    ldy calls
    jsr puthex
    lda #<(SCREEN + 2 * 40 + 7)
    sta rdptr
    lda #>(SCREEN + 2 * 40 + 7)
    sta rdptr + 1
    lda #0
    sta rdidx
rd1:
    ldx rdidx
    ldy music_shadow,x
    lda rdptr
    ldx rdptr + 1
    jsr puthex
    clc
    lda rdptr
    adc #2
    sta rdptr
    bcc !+
    inc rdptr + 1
!:  inc rdidx
    lda rdidx
    cmp #13
    bne rd2
    lda #<(SCREEN + 3 * 40 + 7)     // second row: bytes $0D to $18
    sta rdptr
    lda #>(SCREEN + 3 * 40 + 7)
    sta rdptr + 1
rd2:
    lda rdidx
    cmp #25
    bne rd1
    lda #<(SCREEN + 4 * 40 + 12)
    ldx #>(SCREEN + 4 * 40 + 12)
    ldy worst + 1
    jsr puthex
    lda #<(SCREEN + 4 * 40 + 14)
    ldx #>(SCREEN + 4 * 40 + 14)
    ldy worst
    jsr puthex
    lda #<(SCREEN + 4 * 40 + 22)
    ldx #>(SCREEN + 4 * 40 + 22)
    ldy cost + 1
    jsr puthex
    lda #<(SCREEN + 4 * 40 + 24)
    ldx #>(SCREEN + 4 * 40 + 24)
    ldy cost
    jsr puthex
    rts

// Y = byte, A/X = screen address: two hex digits (pointer $10, the part zp)
puthex:
    sta $10
    stx $11
    tya
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdig,x
    ldy #0
    sta ($10),y
    pla
    and #$0f
    tax
    lda hexdig,x
    ldy #1
    sta ($10),y
    rts

hexdig:  .text "0123456789ABCDEF"
passtxt: .text "PASS"
failtxt: .text "FAIL"

labels:
    .text "MEASURED MUSIC TEST         POS $       "   // row 0
    .text "FRAME $     CALLS $                     "   // row 1
    .text "SHADOW                                  "   // row 2
    .text "                                        "   // row 3
    .text "PLAY WORST $     NOW $                  "   // row 4
    .text "RESULT                                  "   // row 5
    .text "POS AT FRAME 1000 $   AT 4000 $   W $   "   // row 6, written at those frames

frame:      .word 0
calls:      .word 0
worst:      .word 0
cost:       .word 0
calib:      .word 0
done:       .byte 0
frame_tick: .byte 0        // set to 1 by the IRQ; cleared by the idle loop
rdptr:      .word 0
rdidx:      .byte 0

runner_end:
.assert "runner fits below MUSIC_BASE", runner_end <= MUSIC_BASE, true

// The module under test, at MUSIC_BASE.
.import source "../src/parts/music.asm"
