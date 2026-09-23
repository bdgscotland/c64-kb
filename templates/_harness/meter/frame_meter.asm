// frame_meter.asm: the CIA2 timer A frame meter for KickAssembler starters.
// The same contract as frame_meter.h (read that header's comment):
// worst = largest bracket recorded; typical = mean of the last 16 recorded
// frames, 0 until 16 are recorded; recording stops at `hold` frames (0 =
// never). The readout is "F00200 W01234 T01100", 20 cells.
//
//   #import "frame_meter.asm"          // -libdir <harness>/meter
//   ...
//   FrameMeterInit()                   // once, before the loop
// loop:
//   (wait for the frame)
//   FrameMeterStart()
//   (one frame of work)
//   FrameMeterStop()
//   FrameMeterPrint()
//   jmp loop
//   ...
// frame_meter:                        // this label is required: the macros jsr into it
//   FrameMeterCode($0400, 24, 20, 1, 200)   // screen, row, column, colour, hold
//
// It uses no zero page: A, X and Y are clobbered by Init, Stop and Print;
// Start clobbers A. The flags are not preserved.
// Unless AUTOPILOT or FRAME_METER is defined (KickAssembler -define), every
// macro emits nothing, so a release build carries none of it.

#if AUTOPILOT || FRAME_METER

.macro FrameMeterInit() { jsr frame_meter.fm_init }
.macro FrameMeterStart() {
    lda #$11                    // force-load $FFFF, start, count phi2
    sta $dd0e
}
.macro FrameMeterStop() { jsr frame_meter.fm_stop }
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
    lda $dd0d                   // clear a stale underflow flag
    lda #$11                    // calibrate: an empty bracket, same code as Start/Stop
    sta $dd0e
    jsr fm_read
    lda fm_raw
    sta fm_zero
    lda fm_raw+1
    sta fm_zero+1
    lda #0
    ldx #fm_vars_end - fm_vars - 1
!:  sta fm_vars,x
    dex
    bpl !-
    rts

fm_read:
    fm_stop_and_read(fm_raw)
    rts

fm_stop:
    fm_stop_and_read(fm_raw)
    .if (hold != 0) {
        lda fm_frames+1         // frames >= hold: stop recording
        cmp #>hold
        bcc fm_rec
        bne fm_held
        lda fm_frames
        cmp #<hold
        bcc fm_rec
    fm_held:
        rts
    }
fm_rec:
    sec                         // last = raw - zero
    lda fm_raw
    sbc fm_zero
    sta fm_last
    lda fm_raw+1
    sbc fm_zero+1
    sta fm_last+1
    lda fm_worst+1              // worst = max(worst, last)
    cmp fm_last+1
    bcc fm_newworst
    bne fm_ring
    lda fm_worst
    cmp fm_last
    bcs fm_ring
fm_newworst:
    lda fm_last
    sta fm_worst
    lda fm_last+1
    sta fm_worst+1
fm_ring:
    ldx fm_ri                   // sum = sum - ring[i] + last; ring[i] = last
    sec
    lda fm_sum
    sbc fm_ring_lo,x
    sta fm_sum
    lda fm_sum+1
    sbc fm_ring_hi,x
    sta fm_sum+1
    lda fm_sum+2
    sbc #0
    sta fm_sum+2
    clc
    lda fm_sum
    adc fm_last
    sta fm_sum
    lda fm_sum+1
    adc fm_last+1
    sta fm_sum+1
    lda fm_sum+2
    adc #0
    sta fm_sum+2
    lda fm_last
    sta fm_ring_lo,x
    lda fm_last+1
    sta fm_ring_hi,x
    inx
    txa
    and #15
    sta fm_ri
    inc fm_frames               // frames++
    bne !+
    inc fm_frames+1
!:  lda fm_frames+1             // typical = sum / 16 once 16 are recorded
    bne fm_mean
    lda fm_frames
    cmp #16
    bcs fm_mean
    lda #0
    sta fm_typical
    sta fm_typical+1
    rts
fm_mean:
    lda fm_sum
    sta fm_typical
    lda fm_sum+1
    sta fm_typical+1
    lda fm_sum+2
    ldx #4
!:  lsr
    ror fm_typical+1
    ror fm_typical
    dex
    bne !-
fm_done:
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
fm_vars:
fm_shown:
fm_frames:  .word 0
fm_worst:   .word 0
fm_typical: .word 0
fm_last:    .word 0
fm_sum:     .byte 0, 0, 0
fm_ri:      .byte 0
fm_ring_lo: .fill 16, 0
fm_ring_hi: .fill 16, 0
fm_vars_end:
}

#else

.macro FrameMeterInit() {}
.macro FrameMeterStart() {}
.macro FrameMeterStop() {}
.macro FrameMeterPrint() {}
.macro FrameMeterCode(screen, row, col, colour, hold) {}

#endif
