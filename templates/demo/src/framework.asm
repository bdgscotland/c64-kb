// framework.asm: the part sequencer, the table-driven IRQ chain, the
// stable entry, model detection, the once-a-frame slot and the wipe.
// Nothing here knows what a part draws. Parts are rows of parts.asm.
//
// One frame, main part (PAL and NTSC use the same lines):
//   148  bars_slot    stabilise, then the bar kernel (lines 155-210)
//   224  scroll_slot  XSCROLL for row 22
//   236  frame_slot   music, the part's update, the sequencer (every chain ends here)
//
// All IRQs enter through the KERNAL's $FF48 and $0314 and leave through
// $EA81 (registers back, RTI; no KERNAL housekeeping). CIA1's interrupt is
// off, so every IRQ is a raster match.

// ---- Delay(n): exactly n cycles of straight-line code (n = 0 or n >= 2) ----
// n >= 11 is a DEX loop, unless its branch would cross a page (a taken
// branch that crosses costs a cycle more: pitfall
// branch_page_cross_extra_cycle); then it is NOPs. The assert checks it.
.macro Delay(n) {
    .errorif (n == 1 || n < 0), "Delay: n must be 0 or at least 2"
    .var crosses = (>(* + 2)) != (>(* + 5))
    .if (n >= 11 && !crosses) {
        .var k = floor((n - 1) / 5)
        .var r = n - (5 * k + 1)
        .if (r == 1) {
            .eval k = k - 1
            .eval r = r + 5
        }
        ldx #k
    !:  dex
        bne !-
        .errorif (>(*)) != (>(!-)), "Delay: the loop branch crosses a page"
        Pad(r)
    } else {
        Pad(n)
    }
}
.macro Pad(n) {
    .if ((n & 1) == 1) {
        bit $ea                        // 3 cycles, a zero-page read
        .for (var i = 0; i < (n - 3) / 2; i++) { nop }
    } else {
        .for (var i = 0; i < n / 2; i++) { nop }
    }
}

// A chain row: the raster line, the handler, and whether the chain wraps
// after it. Rows of one chain are consecutive and in rising line order; the
// last row of every chain is the frame slot.
.const ROW = 5
.macro Slot(line, handler, last) {
    .errorif (line > 311), "Slot: line past PAL's last line"
    .byte <line, (line >> 8) << 7, <handler, >handler, last ? $80 : $00
}

// ---- the dispatcher, behind $0314 ------------------------------------------
// Acknowledge, arm the next row, call this row's handler, advance. The next
// row is armed before the handler runs, so a handler that overruns makes the
// next slot late instead of losing it (irq-chain.md measures this).
irq:
        FrameMeterStart()              // AUTOPILOT: this IRQ's work is timed
        cld                            // pitfall decimal_mode_in_irq_handler
        lda #$01
        sta $d019
        ldx slot
        ldy chain_first                // the last row wraps to the current chain
        lda slots+4,x
        bmi !+
        txa
        clc
        adc #ROW
        tay
!:      sty next
        lda slots+0,y                  // arm all nine bits of the next row's line
        sta $d012
        lda $d011
        and #$7f
        ora slots+1,y
        sta $d011
        lda slots+2,x
        sta call+1
        lda slots+3,x
        sta call+2
call:   jsr $ffff
        lda next
        sta slot
        FrameMeterPause()
        jmp $ea81

// ---- stabilise: a slot handler's JSR returns on a fixed cycle --------------
// The double IRQ of stable-raster-irq.md, as a subroutine. Arms a second
// raster IRQ STABLE_LINES below this row's line and slides through NOPs; the
// second IRQ lands in a NOP (0 or 1 cycle late), the two $D012 reads absorb
// that cycle, and the table's own next line is put back before the RTS.
// The slot's line must be below 256 - STABLE_LINES.
stabilise:
        lda #<irq2
        sta $0314
        lda #>irq2
        sta $0315
        ldx slot
        lda slots+0,x
        clc
        adc #STABLE_LINES
        sta $d012
        lda $d011                      // this line is below 256: RST8 off
        and #$7f
        sta $d011
        lda #$01
        sta $d019
        tsx                            // the KERNAL's $FF48 does TSX itself: keep
        stx saved_sp                   // the stack pointer in memory (the recipe's trap)
        cli
        .fill 90, NOP                  // irq2 is always taken inside this slide

irq2:   ldx saved_sp                   // drop irq2's own stack frame: back in the
        txs                            // slot handler's JSR to stabilise
        lda model
        bne irq2_ntsc
        .errorif (>(*)) != (>irq2_ntsc), "irq2: the model branch crosses a page"
        Delay(SYNC_PAD_PAL)
        jmp irq2_sync
irq2_ntsc:
        Delay(SYNC_PAD_NTSC)
irq2_sync:
        lda $d012                      // the two reads straddle the line's end in one
        cmp $d012                      // of the two entry phases; BEQ costs 3 when
        beq !+                         // they match and 2 when not (offset 0: no
!:                                     // page crossing is possible)
        lda #<irq
        sta $0314
        lda #>irq
        sta $0315
        ldy next                       // the line the dispatcher armed
        lda slots+0,y
        sta $d012
        lda $d011
        ora slots+1,y
        sta $d011
        lda #$01
        sta $d019
        rts                            // the caller goes on at cycle 51 of line L + 5

// ---- the frame slot: the last row of every chain ---------------------------
frame_slot:
        lda #$c8                       // 40 columns, XSCROLL 0: the whole value,
        sta $d016                      // never a read-modify-write
        jsr music_frame
        inc frames
        bne !+
        inc frames+1
!:      jsr sequencer
        inc frame_flag                 // the main loop's once-a-frame point
        rts

// PAL: play every frame. NTSC: skip every sixth call, so a tune written for
// 50 Hz keeps its tempo at 60 (pitfall pal_ntsc_tempo_mismatch).
music_frame:
        lda model
        beq !play+
        inc ntsc_div
        lda ntsc_div
        cmp #6
        bne !play+
        lda #0
        sta ntsc_div
        inc music_skips
        bne !+
        inc music_skips+1
!:      rts
!play:  jsr MUSIC_PLAY
        inc music_calls
        bne !+
        inc music_calls+1
!:      rts

// ---- the part sequencer ------------------------------------------------------
// PLAY: the part's update each frame; when its frame count runs out, OUT.
// OUT: update and the part's out-transition step each frame until the step
// returns carry set; then the idle chain (the frame slot alone) and SWITCH.
// SWITCH: the main loop runs the teardown and the next part's init.
.const PLAY   = 0
.const OUT    = 1
.const SWITCH = 2

sequencer:
        lda seq_state
        beq !play+
        cmp #OUT
        beq !out+
        rts                            // SWITCH: the main loop owns it
!play:  jsr call_update
        lda part_timer                 // 0 from the start: the part runs forever
        ora part_timer+1
        beq !done+
        lda part_timer
        bne !+
        dec part_timer+1
!:      dec part_timer
        lda part_timer
        ora part_timer+1
        bne !done+
        lda #0
        sta tr_step
        lda #OUT
        sta seq_state
!done:  rts
!out:   jsr call_update
        jsr call_out
        bcc !done-
        lda #chain_idle - slots
        sta chain_first                // one byte: the dispatcher reads it at the wrap
        lda #SWITCH
        sta seq_state
        rts

.macro CallPart(lo, hi) {
        ldx part
        lda lo,x
        sta jump+1
        lda hi,x
        sta jump+2
jump:   jmp $ffff
}
call_init:     CallPart(part_init_lo, part_init_hi)
call_update:   CallPart(part_update_lo, part_update_hi)
call_out:      CallPart(part_out_lo, part_out_hi)
call_teardown: CallPart(part_teardown_lo, part_teardown_hi)

// Starts the part in `part`: init, its frame count, its chain, PLAY.
// Called before the IRQs start (part 0) and from the main loop.
start_part:
        jsr call_init
        ldx part
        lda part_frames_lo,x
        sta part_timer
        lda part_frames_hi,x
        sta part_timer+1
        lda part_chain,x
        sta chain_first
        lda #PLAY                      // last: the frame slot reads seq_state
        sta seq_state
        rts

// Main loop: once the out-transition has finished, tear the part down and
// start the next. The idle chain keeps the music playing meanwhile.
switch_parts:
        lda seq_state
        cmp #SWITCH
        bne !+
        jsr call_teardown
        ldx part
        inx
        cpx #PART_COUNT
        bne !next+
        ldx #LOOP_PART
!next:  stx part
        jsr start_part
!:      rts

// ---- model detection, interrupts off ----------------------------------------
// The last raster line before the wrap: $37 (311) on PAL, $06 (262) on the
// 6567R8, $05 (261) on the 6567R56A. model = 0 PAL, 1 NTSC.
detect_model:
!w1:    lda $d012
!w2:    cmp $d012
        beq !w2-
        bmi !w1-                       // the line went up by one: keep looking
        ldx #0
        cmp #$20
        bcs !+
        inx
!:      stx model
        rts

// ---- the wipe: an out-transition any part can name ---------------------------
// Clears WIPE_COLS columns of screen RAM a frame, left to right; carry set
// once all 40 are clear. Colour RAM is left alone.
wipe_columns:
        ldy #WIPE_COLS
!col:   ldx tr_step
        lda #$20
        .for (var r = 0; r < 25; r++) {
            sta SCREEN + r * 40, x
        }
        inx
        stx tr_step
        cpx #40
        bcs !+                         // carry set: finished
        dey
        bne !col-
        clc
!:      rts

// A part that needs no transition, update or teardown names this.
no_op:  clc
        rts

// ---- the framework's state ---------------------------------------------------
slot:        .byte 0                   // the row the next IRQ runs
next:        .byte 0
chain_first: .byte 0                   // the current chain's first row
saved_sp:    .byte 0
model:       .byte 0
seq_state:   .byte PLAY
part:        .byte 0
part_timer:  .word 0
tr_step:     .byte 0                   // the transition's own counter
frame_flag:  .byte 0
frames:      .word 0                   // frame slots since the start
ntsc_div:    .byte 0
music_calls: .word 0
music_skips: .word 0
