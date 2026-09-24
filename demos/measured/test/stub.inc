// test/stub.inc: the standalone runner a part module is measured in before
// integration. Include it from test/pN_test.asm AFTER these definitions:
//
//   #import "../src/api.inc"
//   .const TEST_PART      = 1            // the part number
//   .const TEST_FRAMES    = 300          // frames to run before grading and freezing
//   .const TEST_FADE_AT   = 0            // 0 = never request the fade; else the frame on which seq_fade is set
//   .import source "../src/parts/p1_logo.asm"   // the module under test, defining .namespace p1
//   .macro PartPrepare()   { jsr p1.prepare }   // one macro per label, so the stub is namespace-agnostic
//   .macro PartSetup()     { jsr p1.setup }
//   .macro PartMain()      { jsr p1.main }
//   .macro PartFadeout()   { jsr p1.fadeout }
//   .macro PartCleanup()   { jsr p1.cleanup }
//   .macro PartSelfcheck() { jsr p1.selfcheck }
//   .label part_irq_count  = p1.irq_count
//   .label part_irq_lines  = p1.irq_lines
//   .label part_irq_hi     = p1.irq_hi
//   .label part_irq_lo     = p1.irq_lo
//   .label part_irq_hi_addr = p1.irq_hi_addr
//   .label part_worst      = p1.worst
//   .label part_typical    = p1.typical
//   #import "stub.inc"
//
// What the stub does: BASIC stub at $0801, code at $0810; SEI; KERNAL in
// ($01 = $37); CIA1 interrupts masked ($DC0D = $7F, then a read); $3FFF = 0;
// IRQ vector $0314 -> dispatcher; PartPrepare; PartSetup; the dispatcher's
// table = the part's lines plus SEQ_LINE (255); CLI. Every frame the line-255
// interrupt increments seq_frame, sets seq_flag and calls music_stub (which
// only counts calls, standing in for music_play). The main loop waits for
// seq_flag, calls PartMain, then PartFadeout once seq_fade is set. At frame
// TEST_FRAMES it calls PartSelfcheck, stores $02FF = $01 or $02, sets the
// border, records the part's worst/typical words at $02F0-$02F3 and the
// music-call count at $02F4/$02F5, then freezes (jmp *) with interrupts
// still running so the picture stays live for the pin.
//
// Build: java -jar KickAss.jar test/pN_test.asm -o build/pN_test.prg
// Pin:   the harness's x64sc command with -limitcycles well past TEST_FRAMES frames.

BasicUpstart2(stub_start)

* = SEQ_CODE "stub"

stub_start:
        sei
        lda #$37
        sta $01
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda #0
        sta IDLE_BYTE
        sta seq_frame
        sta seq_frame+1
        sta seq_flag
        sta seq_fade
        sta stub_calls
        sta stub_calls+1
        lda #TEST_PART
        sta seq_part
        lda #$0b                    // display off while the part prepares and sets up
        sta $d011
        PartPrepare()
        PartSetup()
        jsr stub_build_table
        lda #<stub_dispatch
        sta $0314
        lda #>stub_dispatch
        sta $0315
        lda #0
        sta stub_index
        jsr stub_arm_first
        lda #$01
        sta $d01a
        asl $d019
        cli
stub_loop:
        lda seq_flag
        beq stub_loop
        lda #0
        sta seq_flag
        PartMain()
        lda seq_fade
        beq stub_nofade
        PartFadeout()
stub_nofade:
        lda seq_frame+1
        cmp #>TEST_FRAMES
        bne stub_check_fade
        lda seq_frame
        cmp #<TEST_FRAMES
        bcs stub_grade
stub_check_fade:
        .if (TEST_FADE_AT > 0) {
        lda seq_frame+1
        cmp #>TEST_FADE_AT
        bne stub_loop
        lda seq_frame
        cmp #<TEST_FADE_AT
        bcc stub_loop
        lda #1
        sta seq_fade
        }
        jmp stub_loop

stub_grade:
        PartSelfcheck()             // A = 1 pass, 0 fail
        cmp #1
        beq stub_pass
        lda #BORDER_FAIL
        sta $d020
        lda #$02
        sta RESULT_BYTE
        jmp stub_done
stub_pass:
        lda #BORDER_PASS
        sta $d020
        lda #$01
        sta RESULT_BYTE
stub_done:
        lda part_worst
        sta $02f0
        lda part_worst+1
        sta $02f1
        lda part_typical
        sta $02f2
        lda part_typical+1
        sta $02f3
        lda stub_calls
        sta $02f4
        lda stub_calls+1
        sta $02f5
        jmp *

// The dispatcher: a sorted table of raster lines and handlers, the part's
// entries plus SEQ_LINE. Entered through $0314 with A, X, Y already pushed by
// the KERNAL. Acknowledges, runs the handler, arms the next entry.
stub_dispatch:
        asl $d019
        ldx stub_index
        lda stub_tab_lo,x
        sta stub_jsr+1
        lda stub_tab_hi,x
        sta stub_jsr+2
stub_jsr:
        jsr $ffff
        ldx stub_index
        inx
        cpx stub_count
        bcc !+
        ldx #0
!:      stx stub_index
        jsr stub_arm_x
        jmp $ea81                   // pla/tay/pla/tax/pla/rti

stub_arm_first:
        ldx #0
stub_arm_x:                         // X = table index to arm
        lda stub_tab_line,x
        sta $d012
        lda $d011
        and #$7f
        ora stub_tab_bit7,x
        sta $d011
        rts

// The sequencer's own handler at line 255: frame count, flag, music stand-in.
stub_seq_irq:
        inc seq_frame
        bne !+
        inc seq_frame+1
!:      lda #1
        sta seq_flag
        jsr music_stub
        rts

music_stub:                         // stands in for music_play: counts calls only
        inc stub_calls
        bne !+
        inc stub_calls+1
!:      rts

// Merge the part's table with the line-255 entry, sorted ascending by line
// (9-bit: bit7 table first). The part's table is at most 6 entries.
stub_build_table:
        ldx #0
        ldy #0
stub_bt_copy:
        cpx part_irq_count
        beq stub_bt_seq
        lda part_irq_lines,x
        sta stub_tab_line,y
        lda part_irq_hi,x
        sta stub_tab_bit7,y
        lda part_irq_lo,x
        sta stub_tab_lo,y
        lda part_irq_hi_addr,x
        sta stub_tab_hi,y
        inx
        iny
        bne stub_bt_copy
stub_bt_seq:
        lda #<SEQ_LINE
        sta stub_tab_line,y
        lda #>SEQ_LINE
        beq !+
        lda #$80
!:      sta stub_tab_bit7,y
        lda #<stub_seq_irq
        sta stub_tab_lo,y
        lda #>stub_seq_irq
        sta stub_tab_hi,y
        iny
        sty stub_count
        // insertion sort by (bit7, line)
        ldx #1
stub_sort_outer:
        cpx stub_count
        bcs stub_sort_done
        txa
        tay
stub_sort_inner:
        dey
        bmi stub_sort_next
        // compare entry y+1 against entry y: swap if smaller
        lda stub_tab_bit7+1,y
        cmp stub_tab_bit7,y
        bcc stub_swap
        bne stub_sort_next
        lda stub_tab_line+1,y
        cmp stub_tab_line,y
        bcs stub_sort_next
stub_swap:
        lda stub_tab_line,y
        pha
        lda stub_tab_line+1,y
        sta stub_tab_line,y
        pla
        sta stub_tab_line+1,y
        lda stub_tab_bit7,y
        pha
        lda stub_tab_bit7+1,y
        sta stub_tab_bit7,y
        pla
        sta stub_tab_bit7+1,y
        lda stub_tab_lo,y
        pha
        lda stub_tab_lo+1,y
        sta stub_tab_lo,y
        pla
        sta stub_tab_lo+1,y
        lda stub_tab_hi,y
        pha
        lda stub_tab_hi+1,y
        sta stub_tab_hi,y
        pla
        sta stub_tab_hi+1,y
        jmp stub_sort_inner
stub_sort_next:
        inx
        jmp stub_sort_outer
stub_sort_done:
        rts

stub_index:     .byte 0
stub_count:     .byte 0
stub_calls:     .word 0
stub_tab_line:  .fill 8, 0
stub_tab_bit7:  .fill 8, 0
stub_tab_lo:    .fill 8, 0
stub_tab_hi:    .fill 8, 0
