// frame_meter.asm: the CIA2 timer A frame meter for KickAssembler starters.
// The same contract as frame_meter.h (read that header's comment):
// frames recorded stop at `hold` (1 to 255: the script's play frames);
// worst = the largest recorded frame; typical = the median of the recorded
// frames, computed when recording stops (0 until then). The readout is
// "F00144 W01234 T01100", 20 cells.
//
//   #import "frame_meter.asm"          // -libdir <harness>/meter
//   ...
//   FrameMeterInit()                   // once, before the loop
// loop:
//   (wait for the frame)
//   FrameMeterStart()
//   (one frame of work)
//   FrameMeterStop()                   // records the frame
//   (grading, logging: outside the bracket)
//   FrameMeterPrint()
//   jmp loop
//   ...
// frame_meter:                        // this label is required: the macros jsr into it
//   FrameMeterCode($0400, 24, 20, 1, 144)   // screen, row, column, colour, hold
//
// Work split over a frame is summed: FrameMeterStart() ... FrameMeterPause()
// as often as needed, then FrameMeterStop() (or FrameMeterEnd() after a
// Pause) once a frame. Brackets must not nest.
//
// It uses no zero page: A, X and Y are clobbered by Init, Pause, Stop, End and
// Print; Start clobbers A. The flags are not preserved.
// Unless AUTOPILOT or FRAME_METER is defined (KickAssembler -define), every
// macro emits nothing, so a release build carries none of it.

#if AUTOPILOT || FRAME_METER

.macro FrameMeterInit() { jsr frame_meter.fm_init }
.macro FrameMeterStart() {
    lda #$11                    // force-load $FFFF, start, count phi2
    sta $dd0e
}
.macro FrameMeterPause() { jsr frame_meter.fm_pause }
.macro FrameMeterStop() { jsr frame_meter.fm_stop }
.macro FrameMeterEnd() { jsr frame_meter.fm_frame }
.macro FrameMeterPrint() { jsr frame_meter.fm_print }

// Stops timer A, then raw = $FFFF - count; saturates at $FFFF when the
// timer passed zero (bit 0 of $DD0D, cleared by the read).
.macro fm_stop_and_read(fm_raw) {
    lda #$00
    sta $dd0e
    sec
    lda #$ff
    sbc $dd04
    sta fm_raw
    lda #$ff
    sbc $dd05
    sta fm_raw+1
    lda $dd0d
    and #$01
    beq !+
    lda #$ff
    sta fm_raw
    sta fm_raw+1
!:
}

.macro FrameMeterCode(screen, row, col, colour, hold) {
    .errorif (hold < 1 || hold > 255), "FrameMeterCode: hold must be 1 to 255 frames"
    .var cell = screen + 40*row + col
    .var tint = $d800 + 40*row + col

fm_init:
    ldx #19
    lda #colour
!:  sta tint,x
    dex
    bpl !-
    lda #$01                    // mask timer A's NMI (bit 7 clear: clear this mask bit only)
    sta $dd0d
    lda #$00
    sta $dd0e
    lda #$ff                    // the latch every FrameMeterStart reloads
    sta $dd04
    sta $dd05
    sta fm_zero
    sta fm_zero+1
    lda $dd0d                   // clear a stale underflow flag
    php                         // no interrupt inside the calibration
    sei
    lda #4                      // the empty bracket, four times at line 0 (no DMA there);
    sta fm_try                  // the least count is the bracket's own cost
fm_cal:
!:  lda $d012
    beq !-
!:  lda $d012
    bne !-
    lda #$11                    // the same code as Start and Stop
    sta $dd0e
    jsr fm_read
    lda fm_raw
    cmp fm_zero
    lda fm_raw+1
    sbc fm_zero+1
    bcs !+
    lda fm_raw
    sta fm_zero
    lda fm_raw+1
    sta fm_zero+1
!:  dec fm_try
    bne fm_cal
    plp
    lda #0
    ldx #fm_vars_end - fm_vars - 1
!:  sta fm_vars,x
    dex
    bpl !-
    rts

fm_read:
    fm_stop_and_read(fm_raw)
    rts

// acc += raw - zero
fm_pause:
    fm_stop_and_read(fm_raw)
fm_accumulate:
    sec
    lda fm_raw
    sbc fm_zero
    tax
    lda fm_raw+1
    sbc fm_zero+1
    tay
    clc
    txa
    adc fm_acc
    sta fm_acc
    tya
    adc fm_acc+1
    sta fm_acc+1
    rts

fm_stop:
    fm_stop_and_read(fm_raw)
    jsr fm_accumulate
// Records the frame's sum, once a frame.
fm_frame:
    lda fm_frames
    cmp #hold
    bcs fm_clear                // recording stopped
    tax
    lda fm_acc
    sta fm_lo,x
    sta fm_last
    lda fm_acc+1
    sta fm_hi,x
    sta fm_last+1
    lda fm_worst+1              // worst = max(worst, last)
    cmp fm_last+1
    bcc fm_newworst
    bne fm_count
    lda fm_worst
    cmp fm_last
    bcs fm_count
fm_newworst:
    lda fm_last
    sta fm_worst
    lda fm_last+1
    sta fm_worst+1
fm_count:
    inc fm_frames
    lda fm_frames
    cmp #hold
    bne fm_clear
    jsr fm_sort                 // recording ends: typical = the median
    ldx #hold/2
    lda fm_lo,x
    sta fm_typical
    lda fm_hi,x
    sta fm_typical+1
fm_clear:
    lda #0
    sta fm_acc
    sta fm_acc+1
    rts

// Insertion sort of fm_lo/fm_hi[0 .. hold-1], ascending.
fm_sort:
    ldx #1
fm_si:
    cpx #hold
    bcs fm_sorted
    lda fm_lo,x
    sta fm_klo
    lda fm_hi,x
    sta fm_khi
    txa
    tay
fm_sj:
    cpy #0
    beq fm_ins
    lda fm_klo                  // key >= a[j-1]: insert here
    cmp fm_lo-1,y
    lda fm_khi
    sbc fm_hi-1,y
    bcs fm_ins
    lda fm_lo-1,y
    sta fm_lo,y
    lda fm_hi-1,y
    sta fm_hi,y
    dey
    jmp fm_sj
fm_ins:
    lda fm_klo
    sta fm_lo,y
    lda fm_khi
    sta fm_hi,y
    inx
    jmp fm_si
fm_sorted:
    rts

fm_print:
    ldy #0
    lda #6                      // screen code 6 = F
    ldx #0                      // frames
    jsr fm_put5
    lda #23                     // W
    ldx #2                      // worst
    jsr fm_put5
    lda #20                     // T
    ldx #4                      // typical
    jsr fm_put5
    rts

// A = letter, X = offset of the value in fm_shown, Y = cell index.
// Writes letter, five digits and a space; Y advances by 7.
fm_put5:
    sta cell,y
    iny
    lda fm_shown,x
    sta fm_v
    lda fm_shown+1,x
    sta fm_v+1
    ldx #0
fm_digit:
    lda #$30
    sta fm_d
!:  lda fm_v                    // while v >= pow10[x]: v -= pow10[x]; d++
    cmp fm_p10_lo,x
    lda fm_v+1
    sbc fm_p10_hi,x
    bcc !+
    sta fm_v+1
    lda fm_v
    sbc fm_p10_lo,x
    sta fm_v
    inc fm_d
    jmp !-
!:  lda fm_d
    sta cell,y
    iny
    inx
    cpx #4
    bne fm_digit
    lda fm_v
    ora #$30
    sta cell,y
    iny
    cpy #20
    bcs !+
    lda #$20
    sta cell,y
    iny
!:  rts

fm_p10_lo: .byte <10000, <1000, <100, <10
fm_p10_hi: .byte >10000, >1000, >100, >10
fm_raw:    .word 0
fm_zero:   .word 0
fm_v:      .word 0
fm_d:      .byte 0
fm_try:    .byte 0
fm_klo:    .byte 0
fm_khi:    .byte 0
fm_vars:
fm_shown:
fm_frames:  .word 0
fm_worst:   .word 0
fm_typical: .word 0
fm_last:    .word 0
fm_acc:     .word 0
fm_vars_end:
fm_lo:      .fill hold, 0
fm_hi:      .fill hold, 0
}

#else

.macro FrameMeterInit() {}
.macro FrameMeterStart() {}
.macro FrameMeterPause() {}
.macro FrameMeterStop() {}
.macro FrameMeterEnd() {}
.macro FrameMeterPrint() {}
.macro FrameMeterCode(screen, row, col, colour, hold) {}

#endif
