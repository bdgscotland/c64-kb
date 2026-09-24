// frame_meter.asm: the CIA2 timer A frame meter for KickAssembler starters.
// The same contract as frame_meter.h (read that header's comment):
// frames recorded stop at `hold` (1 to 255: the script's play frames);
// worst = the largest recorded frame; typical = the median of the recorded
// frames, found by selection when recording stops (0 until then). The
// readout is "F00144 W01234 T01100", 20 cells.
//
// Costs outside the brackets, measured in VICE x64sc 3.10 (see
// docs/workflow/agent-harness.md, "The frame meter"): the median at the
// hold frame is a selection, not a sort. FrameMeterPrint renders a field
// only when its value changed (F is stepped in place) into a 20-byte copy,
// then writes the screen cells that differ from it, so a cleared row comes
// back on the next print. An earlier version sorted by insertion, which held
// the main loop for 294,808 cycles (15 PAL frames) at the hold in one
// build, and rendered all three fields to the screen every frame.
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
// The frame's work starts and ends, for the harness's DEADLINE_LINE check
// (watch.py): $01, then $00, stored to $02FE. Each clobbers A.
.macro WorkBegin() {
    lda #$01
    sta $02fe
}
.macro WorkEnd() {
    lda #$00
    sta $02fe
}

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
    .var fm_k = floor(hold / 2)  // the median's index, as frame_meter.c's hold >> 1

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
    lda #$ff                    // nothing rendered yet: the first print is whole
    ldx #5
!:  sta fm_printed,x
    dex
    bpl !-
    lda #$20
    sta fm_cells + 6
    sta fm_cells + 13
    rts

fm_read:
    fm_stop_and_read(fm_raw)
    rts

// acc += raw - zero, saturating at $FFFF: a frame whose brackets sum past
// 65,535 cycles reads 65,535, not the sum modulo 65,536
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
    bcc !+
    lda #$ff
    sta fm_acc
    sta fm_acc+1
!:  rts

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
    jsr fm_select               // recording ends: typical = the median
fm_clear:
    lda #0
    sta fm_acc
    sta fm_acc+1
    rts

// The median of fm_lo/fm_hi[0 .. hold-1] into fm_typical, by selection
// (Wirth's FIND, as frame_meter.c): partition around the middle element and
// follow only the part that holds it. Indices are bytes: j can step to -1
// ($FF, never a real index, since hold <= 255), which counts as below k.
fm_select:
    lda #0
    sta fm_slo
    lda #hold - 1
    sta fm_shi
fm_outer:
    lda fm_slo                  // lo >= hi: a[k] is in place
    cmp fm_shi
    bcc !+
    jmp fm_found
!:  ldx #fm_k
    lda fm_lo,x
    sta fm_xlo
    lda fm_hi,x
    sta fm_xhi
    lda fm_slo
    sta fm_si
    lda fm_shi
    sta fm_sj
fm_part:
    ldx fm_si                   // while a[i] < x: i++
fm_scan_i:
    lda fm_lo,x
    cmp fm_xlo
    lda fm_hi,x
    sbc fm_xhi
    bcs !+
    inx
    jmp fm_scan_i
!:  stx fm_si
    ldy fm_sj                   // while x < a[j]: j--
fm_scan_j:
    lda fm_xlo
    cmp fm_lo,y
    lda fm_xhi
    sbc fm_hi,y
    bcs !+
    dey
    jmp fm_scan_j
!:  sty fm_sj
    cpy fm_si                   // j < i: the partition is done
    bcc fm_parted
    lda fm_lo,x                 // swap a[i] and a[j]
    sta fm_t
    lda fm_lo,y
    sta fm_lo,x
    lda fm_t
    sta fm_lo,y
    lda fm_hi,x
    sta fm_t
    lda fm_hi,y
    sta fm_hi,x
    lda fm_t
    sta fm_hi,y
    inc fm_si
    dec fm_sj
    lda fm_sj                   // j = -1: done; else go on while i <= j
    cmp #$ff
    beq fm_parted
    cmp fm_si
    bcs fm_part
fm_parted:
    lda fm_sj                   // below = (j < k), with j = -1 below
    cmp #$ff
    beq fm_below
    cmp #fm_k
    bcc fm_below
    lda fm_sj                   // not below, so k < i: hi = j
    sta fm_shi
    jmp fm_outer
fm_below:
    lda #fm_k                   // k < i as well: a[k] is in place
    cmp fm_si
    bcc fm_found
    lda fm_si                   // lo = i
    sta fm_slo
    jmp fm_outer
fm_found:
    ldx #fm_k
    lda fm_lo,x
    sta fm_typical
    lda fm_hi,x
    sta fm_typical+1
    rts

// Renders a field into fm_cells only when its value changed since it was
// rendered; F, which grows by one a frame while recording, is stepped in
// its digits. Then every screen cell that differs from fm_cells is written.
fm_print:
    ldx #0                      // frames at cell 0, letter F (screen code 6)
    ldy #0
    lda #6
    jsr fm_field
    ldx #2                      // worst at cell 7, W
    ldy #7
    lda #23
    jsr fm_field
    ldx #4                      // typical at cell 14, T
    ldy #14
    lda #20
    jsr fm_field
    ldx #19
!:  lda fm_cells,x
    cmp cell,x
    beq fm_same
    sta cell,x
fm_same:
    dex
    bpl !-
    rts

// A = letter, X = the value's offset in fm_shown and fm_printed, Y = its first cell.
fm_field:
    sta fm_letter
    lda fm_shown,x
    cmp fm_printed,x
    bne !+
    lda fm_shown+1,x
    cmp fm_printed+1,x
    bne !+
    rts                         // unchanged
!:  lda fm_printed,x            // printed + 1 = shown: step the digits
    clc
    adc #1
    sta fm_v
    lda fm_printed+1,x
    adc #0
    bcs fm_full                 // printed was $FFFF: never rendered
    cmp fm_shown+1,x
    bne fm_full
    lda fm_v
    cmp fm_shown,x
    bne fm_full
    lda fm_shown,x
    sta fm_printed,x
    lda fm_shown+1,x
    sta fm_printed+1,x
    tya                         // the last digit is 5 cells past the letter
    clc
    adc #5
    tay
fm_step:
    lda fm_cells,y
    cmp #$39
    bne !+
    lda #$30                    // 9 rolls over to 0 and carries left
    sta fm_cells,y
    dey
    jmp fm_step
!:  clc
    adc #1
    sta fm_cells,y
    rts
fm_full:
    lda fm_shown,x
    sta fm_printed,x
    lda fm_shown+1,x
    sta fm_printed+1,x
    lda fm_letter
// A = letter, X = offset of the value in fm_shown, Y = cell index in fm_cells.
// Writes the letter and five digits.
fm_put5:
    sta fm_cells,y
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
    sta fm_cells,y
    iny
    inx
    cpx #4
    bne fm_digit
    lda fm_v
    ora #$30
    sta fm_cells,y
    rts

fm_p10_lo: .byte <10000, <1000, <100, <10
fm_p10_hi: .byte >10000, >1000, >100, >10
fm_raw:    .word 0
fm_zero:   .word 0
fm_v:      .word 0
fm_d:      .byte 0
fm_try:    .byte 0
fm_slo:    .byte 0
fm_shi:    .byte 0
fm_si:     .byte 0
fm_sj:     .byte 0
fm_xlo:    .byte 0
fm_xhi:    .byte 0
fm_t:      .byte 0
fm_letter: .byte 0
fm_printed: .word $ffff, $ffff, $ffff  // the values in fm_cells; $FFFF: never rendered
fm_cells:   .fill 20, $20              // the readout as rendered
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
.macro WorkBegin() {}
.macro WorkEnd() {}
.macro FrameMeterCode(screen, row, col, colour, hold) {}

#endif
