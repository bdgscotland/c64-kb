// verdict.asm: AUTOPILOT only. Once the main part has frozen, the main loop
// reads the demo's real state back and grades it against what the assembler
// predicts from config.asm. $02FF = $01 and a green border on pass, $02 and
// red on fail; "RESULT 01 PASS" or "RESULT 02 FAIL" on row 24.

.const EXP_PX    = (FREEZE_UPDATES * CHAIN_SX) & 255   // the frozen phases
.const EXP_PY    = (FREEZE_UPDATES * CHAIN_SY) & 255
.const EXP_PB    = (FREEZE_UPDATES * BAR_SPEED) & 255
.const EXP_SHIFTS = floor(FREEZE_UPDATES / 8)          // XSCROLL 7 - (k mod 8)
.const EXP_XSCROLL = 7 - mod(FREEZE_UPDATES, 8)

.function SinR(amp, step) { .return round(amp * sin(toRadians(step * 360 / 256))) }
.function ExpX(n) { .return CHAIN_X0 + n * CHAIN_DX + SinR(CHAIN_AX, (EXP_PX + n * CHAIN_PX) & 255) }
.function ExpY(n) { .return CHAIN_Y0 + SinR(CHAIN_AY, (EXP_PY + n * CHAIN_PY) & 255) }

.var msb_bits = 0
.for (var n = 0; n < 8; n++) {
    .if (ExpX(n) > 255) .eval msb_bits = msb_bits | (1 << n)
}
.const exp_msb = msb_bits

// A failed check jumps to vfail; the checks are too long for one branch.
.macro FailNe() {
        beq !+
        jmp vfail
!:
}
.macro FailEq() {
        bne !+
        jmp vfail
!:
}

verdict:
        lda part                       // the transition happened: the main part plays,
        cmp #MAIN_PART                        // the wipe cleared all 40 columns, the
        FailNe()                     // title's teardown ran
        lda seq_state
        cmp #PLAY
        FailNe()
        lda tr_step
        cmp #40
        FailNe()
        lda title_done
        FailEq()
        .for (var n = 0; n < 8; n++) {  // the chain against the sine formula
            lda $d000 + 2 * n
            cmp #<ExpX(n)
            FailNe()
            lda $d001 + 2 * n
            cmp #ExpY(n)
            FailNe()
        }
        lda $d010
        cmp #exp_msb
        FailNe()
        lda xscroll                    // the scroller: phase, read pointer, row 22
        cmp #EXP_XSCROLL
        FailNe()
        lda msg_read+1
        cmp #<(message + MSG_START + EXP_SHIFTS)
        FailNe()
        lda msg_read+2
        cmp #>(message + MSG_START + EXP_SHIFTS)
        FailNe()
        ldx #37
!:      lda SCREEN + SCROLL_ROW * 40 + 1,x
        cmp message + EXP_SHIFTS + 1,x
        FailNe()
        dex
        bpl !-
        ldx #BARS_LINES - 1            // the bar table the kernel draws
!:      lda bar_colours,x
        cmp exp_bars,x
        FailNe()
        dex
        bpl !-
        lda music_calls                // every frame slot played or (NTSC) skipped
        clc
        adc music_skips
        tax
        lda music_calls+1
        adc music_skips+1
        cmp frames+1
        FailNe()
        cpx frames
        FailNe()
        lda music_skips                // PAL never skips; NTSC skips one in six
        ora music_skips+1
        ldx model
        beq !pal+
        cmp #0
        FailEq()
        jmp !pass+
!pal:   cmp #0
        FailNe()
!pass:
        lda irq_late                   // every IRQ on its line, every chain whole,
        ora irq_bad                    // every frame slot done before the next chain
        ora frame_late
        FailNe()
        // The player's place against its call count: after c calls the
        // tick is c mod STEP_FRAMES and the step (c div STEP_FRAMES) mod
        // STEPS. Read together, with the IRQ that advances them held off.
        sei
        lda music_calls
        sta v_calls
        lda music_calls+1
        sta v_calls+1
        lda m_tick
        sta v_tick
        lda m_step
        sta v_step
        cli
        ldx #0                         // v_calls div STEP_FRAMES, low byte in X
!:      lda v_calls
        sec
        sbc #STEP_FRAMES
        tay
        lda v_calls+1
        sbc #0
        bcc !+
        sta v_calls+1
        sty v_calls
        inx
        jmp !-
!:      lda v_calls                    // the remainder
        cmp v_tick
        FailNe()
        txa
        and #STEPS - 1
        cmp v_step
        FailNe()
        lda #1
        ldy #5
        ldx #0
        jmp !say+
vfail:  lda #2
        ldy #2
        ldx #pass_end - pass
!say:   sta RESULT
        sty border_colour              // the bar kernel writes it after the last bar
        sty $d020
        ldy #0
!:      lda pass,x
        sta SCREEN + 24 * 40 + 1,y
        lda #1
        sta COLOUR + 24 * 40 + 1,y
        inx
        iny
        cpy #pass_end - pass
        bne !-
        lda #1
        sta verdict_done
        rts

// The bar table at the frozen phase, drawn as fill_bars draws it.
.var expected = List()
.for (var i = 0; i < BARS_LINES; i++) .eval expected.add(0)
.for (var b = 0; b < 4; b++) {
    .var top = BARS_CENTRE + SinR(BARS_AMP, (EXP_PB + b * BAR_STEP) & 255)
    .for (var i = 0; i < BAR_H; i++) .eval expected.set(top + i, bar_ramps.get(b).get(i))
}
exp_bars:
        .for (var i = 0; i < BARS_LINES; i++) .byte expected.get(i)

.encoding "screencode_upper"
pass:   .text "RESULT 01 PASS"
pass_end:
        .text "RESULT 02 FAIL"
verdict_done: .byte 0
v_calls: .word 0
v_tick:  .byte 0
v_step:  .byte 0

