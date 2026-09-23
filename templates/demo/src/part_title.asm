// part_title.asm: part 0, the title card. Three lines of text, the first
// one colour-cycled, on a black screen; the wipe takes it off. The smallest
// complete part: copy it to start a new one.
//
// The text sits on rows 13, 15 and 17, inside the main part's bar lines
// (155-210), so the bar checks in expect.json also prove it is gone.

.const TITLE_ROW = 13

title_init:
        lda #0
        sta $d015                      // no sprites
        sta $d020
        sta $d021
        lda #$c8
        sta $d016
        lda #$15                       // screen $0400, the ROM's upper-case set
        sta $d018
        ldx #0
!:      lda #$20                       // the whole screen blank, white ink
        sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$2e8,x
        lda #1
        sta COLOUR,x
        sta COLOUR+$100,x
        sta COLOUR+$200,x
        sta COLOUR+$2e8,x
        inx
        bne !-
        ldx #39
!:      lda title_text,x
        sta SCREEN + TITLE_ROW * 40,x
        lda title_text+40,x
        sta SCREEN + (TITLE_ROW + 2) * 40,x
        lda title_text+80,x
        sta SCREEN + (TITLE_ROW + 4) * 40,x
        lda #14                        // light blue under the second and third lines
        sta COLOUR + (TITLE_ROW + 2) * 40,x
        sta COLOUR + (TITLE_ROW + 4) * 40,x
        dex
        bpl !-
        lda #0
        sta title_phase
        rts

// Each frame the first line's colours step one place along a 16-entry cycle.
title_update:
        inc title_phase
        lda title_phase
        lsr                            // one step every second frame
        sta title_tmp
        ldx #39
!:      lda title_tmp
        and #$0f
        tay
        lda title_cycle,y
        sta COLOUR + TITLE_ROW * 40,x
        inc title_tmp
        dex
        bpl !-
        rts

title_teardown:
        lda #1
        sta title_done                 // the verdict reads it
        rts

.encoding "screencode_upper"
title_text:
        .text "            A C64-KB STARTER            "
        .text "                PRESENTS                "
        .text "        A DEMO FOR YOU TO FINISH        "
title_cycle:
        .byte 6, 6, 14, 14, 3, 3, 1, 1, 1, 1, 3, 3, 14, 14, 6, 6
title_phase: .byte 0
title_tmp:   .byte 0
title_done:  .byte 0
