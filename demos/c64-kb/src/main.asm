// main.asm: MEASURED: five-part single-file C64 demo.
// Integrates five part modules and a music player into a sequencer that:
//   - runs a sorted raster-IRQ dispatcher owned by a single $0314 vector,
//   - calls music_play once per frame from the line-255 handler,
//   - drives each part through its prepare/setup/main/fadeout/cleanup lifecycle,
//   - ends on a credit screen with measured cycle figures and an AUTOPILOT verdict.
//
// See DESIGN.md for the full contract; api.inc for the shared constants.
//
// Build: make  (release)  or  make shot check  (AUTOPILOT + screenshots)
// -define AUTOPILOT adds the harness meter; -define FORCE_FAULT poisons part 2.

#import "api.inc"
#import "frame_meter.asm"       // from -libdir harness/meter; empty without -define AUTOPILOT

// ---- Module imports --------------------------------------------------------
// Each module uses `* = <CODE_BASE> "name"` to place its code; they share this
// compilation unit so all labels are visible across modules.

.import source "parts/music3.asm"        // music_init, music_play, music_pos at MUSIC_BASE ($1000): the full player and "Lists (darker)"

// Part modules: real where available, dummy (plan/dummy_parts/) where not.
// Replace each dummy import with the real file path when it arrives.
.import source "parts/p1_logo.asm"       // real p1 (I-009: no writes in $0800-$0FFF; I-010: RST8 poll under sei/cli)
.import source "parts/p2_twist.asm"
.import source "parts/p3_border.asm"     // real p3 (rebuilt 2026-09-23: tables in bank 1 $5000-$5928, I-007 closed)
.import source "parts/p4_fire.asm"
.import source "parts/p5_sprites.asm"

// ---- Sync table ------------------------------------------------------------
// music_pos values at which each part's fade starts.
// Parts end at order indices 5, 10, 15, 19, 23 for parts 1..5.
// 192 frames per order at PAL 50 Hz gives ~18 s for the first three parts (5
// orders) and ~16 s for parts 4 and 5 (4 orders).  Easy to retune here.
// "Lists (darker)": music_pos is the bar (1.6 s at 150 BPM); the tune has 60
// bars (0-59) and loops to bar 4, so every value below is reached once.
// Parts run 19.2, 19.2, 19.2, 16.0 and 16.0 s; 12, 24, 36 and 56 are section
// boundaries of the tune, 46 is bar 7 of its second bridge.
// Tune A "Lists (darker)" carries every part and the end screen (the
// maintainer's ruling of 2026-09-24 after hearing the alternatives); tunes B
// and C sit unused in the data image. The paragraph below describes the
// held-back switch: tune A carries parts 1 to
// 3 with 12, 24, 36 as before; part 4 starts tune B "Chains" (G minor,
// 166.7 BPM, a bar is 72 frames = 1.44 s, 32 bars looping to 4) with
// music_init A = 1, so music_pos restarts at 0: part 4 fades at bar 12
// (17.4 s, where the pulse-lead section starts) and part 5 at bar 22
// (31.8 s, mid-break); the end screen starts tune C "After" (music_init
// A = 2, C minor, 125 BPM, 16 bars, loops every 30.7 s, no sync of its own).
.const SYNC_POS_1 = 12
.const SYNC_POS_2 = 24
.const SYNC_POS_3 = 36
.const SYNC_POS_4 = 46
.const SYNC_POS_5 = 56

// ---- Sequencer zero page aliases (api.inc defines seq_frame..$0F) ----------
// These alias seq_tmp ($08-$0F) for specific sequencer roles.
// The two roles (build-table pointers vs print5 args) never overlap in time.
.label seq_bt0    = $08     // irq_lines base address (lo/hi) during seq_build_table
.label seq_bt1    = $0a     // irq_hi base address (lo/hi)
.label seq_bt2    = $0c     // irq_lo base address (lo/hi)
.label seq_bt3    = $0e     // irq_hi_addr base address (lo/hi)
.label seq_btcnt  = $07     // part irq_count passed to seq_build_table
                            // $07 is just before seq_tmp; safe to use here

.label p5d_ptr    = $08     // aliased: end-screen inner pointer (lo/hi)
.label p5d_row    = $0a     // aliased: end-screen row base (lo/hi)
.label print5_val = $0c     // aliased: print5 input value (lo/hi)
.label print5_ptr = $0e     // aliased: print5 destination address (lo/hi)

// BASIC stub and sequencer code at SEQ_CODE ($0810).
BasicUpstart2(seq_start)

* = SEQ_CODE "sequencer"

// ============================================================================
// seq_start: one-time initialisation.  Runs before any part.
// ============================================================================
seq_start:
        sei
        lda #$37
        sta $01                 // KERNAL in, I/O in
        // mask both CIA interrupt sources and clear any pending flags
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        // idle byte, zero-page sequencer state
        lda #0
        sta IDLE_BYTE
        sta seq_frame
        sta seq_frame+1
        sta seq_flag
        sta seq_fade
        sta seq_part
        sta seq_mcnt
        sta music_fault
        sta spacing_worst
        // clear per-part selfcheck results
        sta $02e0
        sta $02e1
        sta $02e2
        sta $02e3
        sta $02e4
        // display off while we initialise
        lda #$0b
        sta $d011
        // clear screen RAM ($0400-$07E7) and colour RAM ($D800-$DBE7) to
        // space/white using the same 4-page pattern as the harness starters
        ldx #0
seq_clear:
        lda #$20
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $06e8,x
        lda #1
        sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $dae8,x
        inx
        bne seq_clear
        // Copy the music data image (all tunes, assembled at MUSIC_IMAGE_LOAD)
        // to MUSIC_IMAGE_RUN under the KERNAL ROM. Writes reach the RAM under a
        // ROM whatever $01 says, so no banking here; music_play reads it with
        // $01 = $35 (see seq_line255_handler). Done before any part runs
        // because part 2 rebuilds $4000-$7FFF over the load image.
        lda #<music_image;     sta seq_bt0
        lda #>music_image;     sta seq_bt0+1
        lda #<MUSIC_IMAGE_RUN; sta seq_bt1
        lda #>MUSIC_IMAGE_RUN; sta seq_bt1+1
        ldx #>(MUSIC_IMAGE_LEN + 255)   // whole pages
        ldy #0
seq_img_copy:
        lda (seq_bt0),y
        sta (seq_bt1),y
        iny
        bne seq_img_copy
        inc seq_bt0+1
        inc seq_bt1+1
        dex
        bne seq_img_copy
        // While the KERNAL is out an NMI would vector through RAM: point
        // $FFFA/$FFFB at an rti (nothing raises NMIs, CIA2's are masked above,
        // but RESTORE on real hardware would). $FFFC-$FFFF stay as loaded.
        lda #<seq_nmi_rti; sta $fffa
        lda #>seq_nmi_rti; sta $fffb
        // The RAM interrupt vector (trackmo step 2): with the KERNAL out an
        // IRQ vectors through $FFFE to seq_irq_entry, which saves A, X, Y as
        // the KERNAL's $FF48 does and joins seq_dispatch. Both vectors, $0314
        // with the KERNAL in and $FFFE with it out, reach the same dispatcher.
        lda #<seq_irq_entry; sta $fffe
        lda #>seq_irq_entry; sta $ffff
        // init music (A = 0 selects tune A, "Lists (darker)")
        lda #0
        jsr music_init
        // Install the dispatcher at $0314 (the KERNAL's user IRQ vector).
        // The KERNAL at $EA31 saves A/X/Y and calls JMP($0314).
        lda #<seq_dispatch
        sta $0314
        lda #>seq_dispatch
        sta $0315
        lda #1
        sta seq_count
        lda #0
        sta seq_index
        lda #<SEQ_LINE
        sta seq_tab_line
        lda #0                  // SEQ_LINE = 255 < 256: bit 7 = 0
        sta seq_tab_bit7
        lda #<seq_line255_handler
        sta seq_tab_lo
        lda #>seq_line255_handler
        sta seq_tab_hi
        jsr seq_arm_first
        lda #$01
        sta $d01a               // VIC raster IRQ enable
        asl $d019               // acknowledge any stale VIC IRQ
        cli

// ============================================================================
// PART 1 PHASE
// ============================================================================
        // Reset spacing_worst after the startup IRQs that fire at random raster
        // lines during the KERNAL boot sequence; from this point every IRQ fires
        // at the line-255 compare and the deviation should be <= 1 line.
        lda #0
        sta spacing_worst
#if KERNAL_OUT_TEST
        // -define KERNAL_OUT_TEST: the KERNAL is out from here and never put
        // back by the sequencer, so every interrupt for the whole demo goes
        // through $FFFE (make kernal-out-test). Parts 3, 4 and 5 write $01
        // themselves ($36 in prepare, $37 in cleanup): their $37 puts the
        // KERNAL back for the gap that follows, so the test covers the
        // $0314 path there too. The music wrapper restores what it found.
        lda #$35
        sta $01
#endif

        lda #1
        sta seq_part
        jsr p1.prepare
        // no previous part; go straight to setup
        sei
        jsr p1.setup
        ldx #0                  // part table row: dispatcher table, main vector, IRQ on
        jsr seq_install
        cli
        // Each later part's prepare runs AFTER the previous part's cleanup
        // (seq_gap below), never while that part is live: see I-008.
        // pN.main runs from the interrupt tail (seq_tail) from seq_install to
        // seq_main_off; the loops below keep time, run selfcheck and the fade.

p1_loop:
        lda seq_flag; beq p1_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_1
        bcc p1_loop

p1_fade_start:
        // selfcheck part 1 once, before the fade, with main held out (seq_busy)
        jsr seq_hold
        jsr p1.selfcheck
        sta $02e0
        jsr seq_release
        lda #1
        sta seq_fade

p1_fade_loop:
        lda seq_flag; beq p1_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p1.fadeout
        cmp #1; bne p1_fade_loop

p1_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 2 PHASE
// ============================================================================
        lda #2; sta seq_part
        sei
        jsr seq_main_off        // the interrupt tail calls nothing until seq_install
        jsr p1.cleanup
        jsr seq_gap             // black gap, music on: p2 owns zero page and its banks from here
        jsr p2.prepare
        jsr seq_wait250
        sei
        jsr p2.setup
        ldx #1
        jsr seq_install
        cli

p2_loop:
        lda seq_flag; beq p2_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_2
        bcc p2_loop

p2_fade_start:
        jsr seq_hold
        jsr p2.selfcheck
        sta $02e1
        jsr seq_release
        lda #1; sta seq_fade

p2_fade_loop:
        lda seq_flag; beq p2_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p2.fadeout
        cmp #1; bne p2_fade_loop

p2_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 3 PHASE
// ============================================================================
        lda #3; sta seq_part
        sei
        jsr seq_main_off
        jsr p2.cleanup
        jsr seq_gap
        jsr p3.prepare
        jsr seq_wait250
        sei
        jsr p3.setup
        ldx #2
        jsr seq_install
        cli

p3_loop:
        lda seq_flag; beq p3_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_3
        bcc p3_loop

p3_fade_start:
        jsr seq_hold
        jsr p3.selfcheck
        sta $02e2
        jsr seq_release
        lda #1; sta seq_fade

p3_fade_loop:
        lda seq_flag; beq p3_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p3.fadeout
        cmp #1; bne p3_fade_loop

p3_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 4 PHASE
// ============================================================================
        lda #4; sta seq_part
        sei
        jsr seq_main_off
        jsr p3.cleanup
        jsr seq_gap
        jsr p4.prepare
        // Tune B "Chains" starts with part 4's first frame: its bar 0 is a full
        // downbeat, and music_pos restarts at 0 for SYNC_POS_4 and SYNC_POS_5.
        // music_init runs on the main thread with the frame interrupt live
        // (mu_busy makes music_play return at once meanwhile).
        // (the switch to tune B, `lda #1 / jsr music_init`, is held back pending the maintainer's ear)
        jsr seq_wait250
        sei
        jsr p4.setup
        ldx #3
        jsr seq_install
        cli

p4_loop:
        lda seq_flag; beq p4_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_4
        bcc p4_loop

p4_fade_start:
        jsr seq_hold
        jsr p4.selfcheck
        sta $02e3
        jsr seq_release
        lda #1; sta seq_fade

p4_fade_loop:
        lda seq_flag; beq p4_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p4.fadeout
        cmp #1; bne p4_fade_loop

p4_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 5 PHASE
// ============================================================================
        lda #5; sta seq_part
        sei
        jsr seq_main_off
        jsr p4.cleanup
        jsr seq_gap
        jsr p5.prepare
        jsr seq_wait250
        sei
        jsr p5.setup
        ldx #4
        jsr seq_install
        cli
#if AUTOPILOT
        FrameMeterInit()    // metre part 5's first 200 frames (the demo's steady state)
        lda #1; sta seq_meter   // seq_tail brackets p5.main (interrupts inside it included; I-012)
#endif

p5_loop:
        lda seq_flag; beq p5_loop
        lda #0; sta seq_flag
        jsr seq_music_check
#if AUTOPILOT
        FrameMeterPrint()
#endif
        lda music_pos
        cmp #SYNC_POS_5
        bcc p5_loop

p5_fade_start:
#if AUTOPILOT
        lda #0; sta seq_meter   // no bracket round selfcheck or the fade
#endif
        jsr seq_hold
        jsr p5.selfcheck
        sta $02e4
        jsr seq_release
        lda #1; sta seq_fade

p5_fade_loop:
        lda seq_flag; beq p5_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p5.fadeout
        cmp #1; bne p5_fade_loop

p5_fade_done:
        lda #0; sta seq_fade
        sei
        jsr seq_main_off
        jsr p5.cleanup
        // leave interrupts masked: the end screen re-enables with CLI below

// ============================================================================
// END SCREEN
// ============================================================================
end_screen:
        // Text mode, bank 0, $D018=$15, black border and background.
        // Interrupts are masked; music re-enabled via CLI after setup.
        // Tune C "After" for the end screen (main thread; the frame interrupt
        // resumes the player on it after the CLI below).
        // (the switch to tune C, `lda #2 / jsr music_init`, is held back pending the maintainer's ear)
        lda #$0b; sta $d011     // display off while we rewrite screen
        lda #$08; sta $d016
        lda #$15; sta $d018     // screen $0400, VIC ROM uppercase charset
        lda #$3f; sta $dd02
        lda $dd00; and #$fc; ora #$03; sta $dd00   // bank 0
        lda #$00; sta $d020; sta $d021; sta $d015
        // rebuild just the line-255 entry in the dispatcher (music plays on)
        lda #1; sta seq_count
        lda #0; sta seq_index
        lda #<SEQ_LINE; sta seq_tab_line
        lda #0; sta seq_tab_bit7
        lda #<seq_line255_handler; sta seq_tab_lo
        lda #>seq_line255_handler; sta seq_tab_hi
        jsr seq_arm_first
        lda #$01; sta $d01a
        asl $d019
        cli                     // music resumes

        // clear screen and colour
        ldx #0
es_clear:
        lda #$20
        sta $0400,x; sta $0500,x; sta $0600,x; sta $06e8,x
        lda #1
        sta $d800,x; sta $d900,x; sta $da00,x; sta $dae8,x
        inx; bne es_clear

        // row 1: title "C64-KB" at col 17
        ldx #(es_title_end - es_title - 1)
es_title_loop:
        lda es_title,x
        sta $0400 + 40*1 + 17,x
        dex; bpl es_title_loop

        // row 3: credit line 1
        ldx #(es_cred1_end - es_cred1 - 1)
es_cred1_loop:
        lda es_cred1,x
        sta $0400 + 40*3 + 0,x
        dex; bpl es_cred1_loop

        // row 4: credit line 2
        ldx #(es_cred2_end - es_cred2 - 1)
es_cred2_loop:
        lda es_cred2,x
        sta $0400 + 40*4 + 0,x
        dex; bpl es_cred2_loop

        // row 6: column headers
        ldx #(es_hdr_end - es_hdr - 1)
es_hdr_loop:
        lda es_hdr,x
        sta $0400 + 40*6 + 0,x
        dex; bpl es_hdr_loop
        // rows 7..11: one row per part (P1..P5)
        // For each part N (index 0..4):
        //   col 0: P   col 1: N+1 digit
        //   col 4: 5-digit worst
        //   col 11: 5-digit typical
        //   col 18: sc indicator (screen code $2b='+' or $2d='-')
        ldx #0
es_part_loop:
        lda es_row_lo,x; sta p5d_row
        lda es_row_hi,x; sta p5d_row+1
        // 'P' at col 0
        lda #$10; ldy #0; sta (p5d_row),y
        // digit '1'..'5' at col 1
        txa; clc; adc #$31; ldy #1; sta (p5d_row),y
        // worst cycles at col 4
        lda es_worst_lo,x; sta p5d_ptr
        lda es_worst_hi,x; sta p5d_ptr+1
        ldy #0
        lda (p5d_ptr),y;   sta print5_val
        iny
        lda (p5d_ptr),y;   sta print5_val+1
        lda es_row_lo,x; clc; adc #4; sta print5_ptr
        lda es_row_hi,x; adc #0;      sta print5_ptr+1
        // print5_dec clobbers X; save/restore the loop counter around each call
        txa; pha
        jsr print5_dec
        pla; tax
        // typical cycles at col 11
        lda es_typ_lo,x;  sta p5d_ptr
        lda es_typ_hi,x;  sta p5d_ptr+1
        ldy #0
        lda (p5d_ptr),y;   sta print5_val
        iny
        lda (p5d_ptr),y;   sta print5_val+1
        lda es_row_lo,x; clc; adc #11; sta print5_ptr
        lda es_row_hi,x; adc #0;       sta print5_ptr+1
        txa; pha
        jsr print5_dec
        pla; tax
        // selfcheck indicator at col 18: '+' ($2b) if passed, '-' ($2d) if not
        lda $02e0,x         // selfcheck result for part (N+1)
        beq es_sc_fail
        lda #$2b; jmp es_sc_write   // '+'
es_sc_fail:
        lda #$2d                    // '-'
es_sc_write:
        ldy #18; sta (p5d_row),y
        inx; cpx #5; bcs es_part_done
        jmp es_part_loop
es_part_done:
        // rows 15..20 and 22: the KB technique names behind each part and one
        // line of figures from the plan's compatibility check (code and text
        // live at $4C00, see es_tech_print; the sequencer block is nearly full)
        jsr es_tech_print
        jsr es_skipped_print    // row 13: frames on which seq_tail did not run main (seq_ext)

        // row 12: PARTS n/5 PASS or PARTS n/5 FAIL
        // count passing selfchecks
        lda #0; sta seq_tmp
        ldx #4
es_count_loop:
        lda $02e0,x; beq !+; inc seq_tmp
!:      dex; bpl es_count_loop
        // write "PARTS " at col 0
        ldx #(es_parts_end - es_parts - 1)
!:      lda es_parts,x; sta $0400 + 40*12 + 0,x; dex; bpl !-
        // write digit
        lda seq_tmp; clc; adc #$30  // screen code for count digit
        sta $0400 + 40*12 + 6
        // "/5 " already in the string; write PASS or FAIL based on verdict
        // verdict: all 5 pass AND spacing_worst <= 3
        lda $02e0; and $02e1; and $02e2; and $02e3; and $02e4
        beq es_verdict_fail
        // spacing_worst check omitted: the KERNAL's IRQ handler ($EA31) runs
        // for ~500-2000 cycles before calling $0314, making the $D012 read
        // land 8-32 lines past line 255 regardless of actual jitter.  The
        // music-continuity fault (music_fault via seq_mcnt) already checks
        // that music_play is called once per frame; see integration-issues.md.
        // PASS
        lda #1; sta RESULT_BYTE
        lda #BORDER_PASS; sta $d020
        ldx #(es_pass_end - es_pass - 1)
!:      lda es_pass,x; sta $0400 + 40*12 + 10,x; dex; bpl !-
        jmp es_display_on
es_verdict_fail:
        lda #2; sta RESULT_BYTE
        lda #BORDER_FAIL; sta $d020
        ldx #(es_fail_end - es_fail - 1)
!:      lda es_fail,x; sta $0400 + 40*12 + 10,x; dex; bpl !-
es_display_on:
        lda #$1b; sta $d011     // display on

        // row 24: AUTOPILOT metre readout (emits nothing in release builds)
        FrameMeterPrint()

        // hold forever with interrupts on so music continues
        jmp *

// ============================================================================
// seq_dispatch: the $0314 IRQ handler.
// Entered by the KERNAL dispatcher with A, X, Y already pushed.
// ============================================================================
seq_dispatch:
        asl $d019               // acknowledge VIC raster IRQ
        ldx seq_index
        lda seq_tab_lo,x
        sta seq_jsr+1
        lda seq_tab_hi,x
        sta seq_jsr+2
seq_jsr:
        jsr $ffff               // call the handler; returns with rts
        ldx seq_index
        inx
        cpx seq_count
        bcc !+
        ldx #0
!:      stx seq_index
        jsr seq_arm_x
        // Arming the sequencer's own entry is a race when the part's last row
        // sits just below it: p5's line-253 row leaves this dispatcher at line
        // 255, and a write of the current line to $D012 fires only while the
        // beam is still on it. If the store landed past line 255 and no raster
        // interrupt is pending, the compare will not fire this frame: run the
        // entry now (it exits the interrupt itself). Measured 2026-09-24: on
        // PAL p5 lost 62 of its line-255 frames through the original exit
        // (trackmo log, step 3). Costs every other dispatch seven cycles.
        cpx seq_255_index
        bne seq_irq_exit
        lda $d019
        and #$01
        bne seq_irq_exit        // the write fired: the interrupt is pending
        lda $d011
        bpl seq_irq_exit        // beam below 256: the compare at line 255 is still ahead
        jsr seq_line255_handler // beam at 256 or later: this frame's entry, now
        // The KERNAL's own exit ($EA81) is these six instructions, in RAM so
        // that nothing on the interrupt path reads ROM (trackmo step 1).
seq_irq_exit:
        pla
        tay
        pla
        tax
        pla
        rti

seq_arm_first:
        ldx #0
seq_arm_x:                      // X = table index to arm next
        lda seq_tab_line,x
        sta $d012
        lda $d011
        and #$7f
        ora seq_tab_bit7,x
        sta $d011
        rts

seq_nmi_rti:                    // the RAM NMI vector's target while the KERNAL is out
        rti

// ============================================================================
// seq_gap: the black gap between two parts.  Entered with interrupts masked,
// after the outgoing part's cleanup.  Leaves only the line-255 entry in the
// dispatcher, blanks the display (DEN off, border black, sprites off) and
// re-enables interrupts, so the incoming part's prepare runs on a black
// screen with the music playing.  Prepares used to run while the previous
// part was live; the real modules share zero page $10-$7F and bank 0 with
// their predecessors, so that clobbered the running part (I-008).
// ============================================================================
seq_gap:
        lda #$0b; sta $d011
        lda #0; sta $d020; sta $d015
        lda #1; sta seq_count
        lda #0; sta seq_index
        lda #<SEQ_LINE; sta seq_tab_line
        lda #0; sta seq_tab_bit7
        lda #<seq_line255_handler; sta seq_tab_lo
        lda #>seq_line255_handler; sta seq_tab_hi
        jsr seq_arm_first
        lda #$01; sta $d01a
        asl $d019
        cli
        rts

// seq_wait250: spin until raster line 250, as a part's cleanup does before
// returning, so the setup that follows lands in the lower border as before.
// Interrupts stay enabled while waiting; the caller masks them afterwards.
seq_wait250:
        lda $d011; bmi seq_wait250      // raster >= 256: wait for the wrap
!:      lda $d012; cmp #250; bne !-
        rts

// ============================================================================
// seq_line255_handler: called by seq_dispatch for the line-255 entry.
// A, X, Y are already saved by the KERNAL; the handler ends with rts.
// ============================================================================
seq_line255_handler:
        // This handler leaves the interrupt itself (trackmo step 3): it drops
        // the dispatcher's return address, arms the next entry, plays the
        // music, raises the flag and runs the part's main from seq_tail with
        // interrupts enabled, then exits through seq_irq_exit. The other
        // entries keep the dispatcher's own, unchanged exit path.
        pla
        pla
        // 1. Spacing check: measure deviation of actual raster from line 255.
        //    $D011 bit 7 is set when the raster is >= 256.
        lda $d012               // raster line low byte
        bit $d011               // N flag <- $d011 bit 7 (raster high bit)
        bmi spc_above           // branch if raster >= 256 (line 256..258 range)
        // raster is < 256: deviation = 255 - $d012
        sec; sbc #$ff           // A = $d012 - 255 (carry clear when $d012 < 255)
        bcs spc_exact           // carry set: $d012 = 255, deviation = 0
        eor #$ff
        clc; adc #1             // A = 255 - $d012 (the positive deviation)
        jmp spc_compare
spc_exact:
        lda #0; jmp spc_compare
spc_above:
        // raster >= 256: $d012 = raster - 256, deviation = $d012 + 1
        clc; adc #1
spc_compare:
        cmp spacing_worst
        bcc spc_done
        sta spacing_worst
spc_done:
        // 1b. Advance the dispatcher and arm the next entry now, so a row that
        //     falls inside the music's span is only delayed, never lost.
        ldx seq_index
        inx
        cpx seq_count
        bcc !+
        ldx #0
!:      stx seq_index
        jsr seq_arm_x
        // 2. Music: called first, before frame counter and flag. The tune data
        //    lives under the KERNAL ROM (MUSIC_IMAGE_RUN), so the ROM is banked
        //    out for the call and the value of $01 found is put back, since a
        //    part may be running with BASIC out ($36). I is set here, so no
        //    interrupt can vector through RAM meanwhile; NMI has an rti at
        //    $FFFA (seq_start).
        lda $01
        pha
        lda #$35
        sta $01
        jsr music_play
        pla
        sta $01
        // 3. Frame counter and flag.
        inc seq_frame
        bne !+
        inc seq_frame+1
!:      lda #1
        sta seq_flag
        // 4. Music-call counter (for continuity check).
        inc seq_mcnt
        // 5. No meter call here. Until 2026-09-23 this handler ended with
        // "if CIA2 timer A is running, FrameMeterPause()", meant to close an
        // open bracket when p5.main overran the frame. It never fired (a trace
        // on fm_pause over a full PAL run: no hits), and had it fired, the
        // FrameMeterStop that followed would have read the same stopped
        // counter again and doubled the figure. Without it an overrun frame
        // counts Start to Stop, interrupts included, which is what the meter
        // is for. See integration-issues.md I-012.
        // 6. The frame work and the exit (seq_ext).
        jmp seq_tail

// ============================================================================
// seq_music_check: called from the main loop on each flag consumption.
// Sets music_fault if no music call occurred since the last check.
// Resets seq_mcnt.
// ============================================================================
seq_music_check:
        lda seq_mcnt
        bne !+
        lda #1; sta music_fault     // zero calls this frame: continuity fault
!:      lda #0; sta seq_mcnt
        rts

// ============================================================================
// seq_build_table: build the sorted dispatcher table for the current part.
// Caller sets seq_btcnt to the part's irq_count and seq_bt0..seq_bt3 to
// the bases of irq_lines, irq_hi, irq_lo, irq_hi_addr.
// Appends the line-255 entry and insertion-sorts by (bit7, line).
// ============================================================================
seq_build_table:
        ldx #7                      // remember the four bases for seq_rebuild
!:      lda seq_bt0,x; sta seq_cur_bt,x
        dex; bpl !-
        jsr seq_copy_entries
        // insertion sort ascending by (bit7, line): same algorithm as stub.inc
        ldx #1
bt_outer:
        cpx seq_count; bcs bt_done
        txa; tay
bt_inner:
        dey; bmi bt_next
        lda seq_tab_bit7+1,y; cmp seq_tab_bit7,y; bcc bt_swap
        bne bt_next
        lda seq_tab_line+1,y; cmp seq_tab_line,y; bcs bt_next
bt_swap:
        lda seq_tab_line,y;  pha; lda seq_tab_line+1,y;   sta seq_tab_line,y;  pla; sta seq_tab_line+1,y
        lda seq_tab_bit7,y;  pha; lda seq_tab_bit7+1,y;   sta seq_tab_bit7,y;  pla; sta seq_tab_bit7+1,y
        lda seq_tab_lo,y;    pha; lda seq_tab_lo+1,y;     sta seq_tab_lo,y;    pla; sta seq_tab_lo+1,y
        lda seq_tab_hi,y;    pha; lda seq_tab_hi+1,y;     sta seq_tab_hi,y;    pla; sta seq_tab_hi+1,y
        jmp bt_inner
bt_next:
        inx; jmp bt_outer
bt_done:
        jmp seq_find_255            // the sort may have moved the line-255 entry

// seq_copy_entries: the copy half of seq_build_table: seq_btcnt entries from
// the four bases in seq_bt0..seq_bt3 into the dispatcher tables, then the
// line-255 entry appended; seq_count set. No sort.
seq_copy_entries:
        ldy #0
        ldx #0
        lda seq_btcnt
        beq bt_seq_only
bt_copy:
        lda (seq_bt0),y
        sta seq_tab_line,x
        lda (seq_bt1),y
        sta seq_tab_bit7,x
        lda (seq_bt2),y
        sta seq_tab_lo,x
        lda (seq_bt3),y
        sta seq_tab_hi,x
        iny; inx
        cpy seq_btcnt
        bne bt_copy
bt_seq_only:
        // append the line-255 entry
        lda #<SEQ_LINE;              sta seq_tab_line,x
        lda #0;                      sta seq_tab_bit7,x   // 255 < 256
        lda #<seq_line255_handler;   sta seq_tab_lo,x
        lda #>seq_line255_handler;   sta seq_tab_hi,x
        stx seq_255_index           // right for the unsorted copy (seq_rebuild)
        inx; stx seq_count
        rts

// ============================================================================
// seq_rebuild: for a part that moves its interrupt lines every frame (a
// sprite multiplexer). The part rewrites its own irq_lines / irq_hi /
// irq_lo / irq_hi_addr tables and calls this from pN.main with
// A = the new count (0 to MAX_PART_IRQS). The entries must already be
// sorted ascending by (bit7, line) and none may lie in 254 to 258: the
// copy does not sort. The line-255 entry is appended, and the entry armed
// is the first one more than two lines below the raster at the time of the
// call, so the entries already passed this frame wait for the next one and
// the sequencer's line 255 is never skipped. Interrupts are masked for the
// copy, about 30 cycles an entry. The bases are the ones seq_build_table
// was last called with, so the part's tables must stay where setup put
// them. Costs about 40 + 30 * count cycles.
// ============================================================================
// seq_rebuild's code sits in the "seq_ext" block below (the $0810 block
// reached $1000 when the music image copy and the $01 wrapper went in).

// ============================================================================
// fade_step: step $D020, $D021 and all 1000 colour RAM cells one luminance
// level darker.  Called by the dummy parts' fadeout.
// Returns A = 1 when $D020 is already black; A = 0 otherwise.
// Clobbers A, X, Y.
// ============================================================================
fade_step:
        // vic_colour_register_upper_nibble_reads_set: $D020/$D021 read with
        // the upper nibble forced to $F on the C64; mask to the lower 4 bits
        // before any beq or table lookup.
        lda $d020; and #$0f
        beq fs_is_black         // border already black: return 1
        tax; lda lum_prev,x; sta $d020
        lda $d021; and #$0f; tax; lda lum_prev,x; sta $d021
        // 1000 colour RAM cells: 3 full pages ($D800/$D900/$DA00) plus
        // 232 bytes at $DB00.  The 3-page loop uses x=0..255; the tail loop
        // uses x=0..231.  The &$0f masks the upper nibble (reads as $F on
        // real hardware per vic_colour_register_upper_nibble_reads_set).
        ldx #0
fs_full:
        lda $d800,x; and #$0f; tay; lda lum_prev,y; sta $d800,x
        lda $d900,x; and #$0f; tay; lda lum_prev,y; sta $d900,x
        lda $da00,x; and #$0f; tay; lda lum_prev,y; sta $da00,x
        inx; bne fs_full
        // tail: $DB00-$DBE7 (232 bytes, the remaining colour RAM)
fs_tail:
        lda $db00,x; and #$0f; tay; lda lum_prev,y; sta $db00,x
        inx; cpx #232; bcc fs_tail
        lda $d020; and #$0f; bne fs_fade_on
fs_is_black:
        lda #1; rts
fs_fade_on:
        lda #0; rts

// ============================================================================
// print5_dec: print a 16-bit value as five decimal digits to screen RAM.
// Input:  print5_val ($0c/$0d) = value (lo, hi; consumed: zeroed on return)
//         print5_ptr ($0e/$0f) = destination screen address (ZP indirect)
// Uses Y as column offset 0..4; X as divisor index 0..4.
// Clobbers A, X, Y, seq_tmp ($07: digit accumulator).
// ============================================================================
print5_dec:
        ldx #0              // divisor index 0 (10000) to 4 (1)
        ldy #0              // column offset
pd_digit:
        lda #0; sta seq_btcnt   // digit count (reuse seq_btcnt as temp here)
pd_sub:
        sec
        lda print5_val; sbc div_lo,x; pha
        lda print5_val+1; sbc div_hi,x
        bcc pd_restore          // went negative: done subtracting
        sta print5_val+1
        pla; sta print5_val
        inc seq_btcnt
        jmp pd_sub
pd_restore:
        pla                     // discard tentative low byte
        // carry is clear from the failed sbc; A = digit, add screen code for '0'
        lda seq_btcnt; adc #$30     // carry=0, so A = digit + $30 (screen code)
        sta (print5_ptr),y
        iny; inx; cpx #5; bcc pd_digit
        rts

// ============================================================================
// Data: tables and strings.
// ============================================================================

// Dispatcher table index and count; the tables themselves are in the
// "seq_ext" block at $4DC0 (MAX_PART_IRQS + 1 entries) since 2026-09-24,
// when the limit went from 7 part lines to 23 for the part-5 multiplexer
// and the $0810 block had no room for the growth.
seq_index:      .byte 0
seq_count:      .byte 0
seq_255_index:  .byte 0         // where the line-255 entry sits in the sorted table (seq_find_255)
seq_cur_bt:     .fill 8, 0      // the four table bases seq_build_table was last called with

// State bytes.
spacing_worst:  .byte 0
seq_mcnt:       .byte 0         // music calls since last flag consumption
music_fault:    .byte 0         // 1 if music_continuity fault detected

// Luminance-ordered step-down table for fade_step (and the dummy modules).
// lum_prev[c] = next-darker colour in the luminance order
// Order (darkest to brightest): 0, 6, 9, 2, 11, 8, 4, 14, 12, 5, 10, 3, 15, 13, 7, 1
// For each colour c, lum_prev[c] is the colour one step darker:
lum_prev:
        //  0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15
        .byte 0,  7,  9, 10,  8, 12,  0, 13, 11,  6,  5,  2, 14, 15,  4,  3

// Divisors for print5_dec (lo/hi, index 0=10000 to 4=1).
div_lo: .byte <10000, <1000, <100, <10, <1
div_hi: .byte >10000, >1000, >100, >10, >1

// Per-part screen row base addresses for end screen (rows 7..11).
es_row_lo:
        .byte <($0400+40*7), <($0400+40*8), <($0400+40*9), <($0400+40*10), <($0400+40*11)
es_row_hi:
        .byte >($0400+40*7), >($0400+40*8), >($0400+40*9), >($0400+40*10), >($0400+40*11)

// Per-part worst/typical word addresses (lo byte of address, hi byte of address).
es_worst_lo:
        .byte <p1.worst, <p2.worst, <p3.worst, <p4.worst, <p5.worst
es_worst_hi:
        .byte >p1.worst, >p2.worst, >p3.worst, >p4.worst, >p5.worst
es_typ_lo:
        .byte <p1.typical, <p2.typical, <p3.typical, <p4.typical, <p5.typical
es_typ_hi:
        .byte >p1.typical, >p2.typical, >p3.typical, >p4.typical, >p5.typical

// End screen text strings in VIC uppercase screen codes.
// Screen code = PETSCII - $40 for letters A-Z; digits/punctuation are same.
// All text is uppercase to match the ROM charset.
es_title:
        // "C64-KB" (6 chars): the demo took the knowledge base's name on
        // 2026-09-24 at the maintainer's request; it was MEASURED before.
        .byte $03, $36, $34, $2d, $0b, $02
es_title_end:

es_cred1:
        // "EVERY EFFECT HERE IS A PAGE OF THE KB"
        .byte $05, $16, $05, $12, $19, $20, $05, $06, $06, $05, $03, $14, $20, $08, $05, $12, $05, $20, $09, $13, $20, $01, $20, $10, $01, $07, $05, $20, $0f, $06, $20, $14, $08, $05, $20, $0b, $02
es_cred1_end:

es_cred2:
        // "TECHNIQUES MEASURED IN VICE"
        .byte $14, $05, $03, $08, $0e, $09, $11, $15, $05, $13, $20
        .byte $0d, $05, $01, $13, $15, $12, $05, $04, $20
        .byte $09, $0e, $20
        .byte $16, $09, $03, $05
es_cred2_end:

es_hdr:
        // "PART    WORST   TYPICAL "
        .byte $10, $01, $12, $14, $20, $20, $20, $20
        .byte $17, $0f, $12, $13, $14, $20, $20, $20
        .byte $14, $19, $10, $09, $03, $01, $0c, $20
es_hdr_end:

es_parts:
        // "PARTS " at cols 0-5; col 6 placeholder (digit overwrites); "/5 " at 7-9
        .byte $10, $01, $12, $14, $13, $20    // "PARTS " (cols 0-5)
        .byte $20                              // space at col 6 (digit overwrites this)
        .byte $2f, $35, $20                   // "/5 " at cols 7-9
es_parts_end:

es_pass:
        // "PASS" screen codes at col 10: P=16, A=1, S=19, S=19
        .byte $10, $01, $13, $13
es_pass_end:

es_fail:
        // "FAIL" screen codes at col 10: F=6, A=1, I=9, L=12
        .byte $06, $01, $09, $0c
es_fail_end:

// End of SEQ_CODE block ($0810-$0FFF).
// ----------------------------------------------------------------------------
// Frame metre code: placed in bank 1 CPU space at $4800, which is between
// p2's planes at $4400-$47FF and its screen at $5C00.  No part writes to
// $4800-$5BFF in prepare() or at runtime, so the code survives until
// FrameMeterPrint is called at the end screen.  In release builds
// FrameMeterCode emits nothing and frame_meter is just a label.
* = $4800 "meter_code"
frame_meter:
        FrameMeterCode($0400, 24, 20, 1, 200)

// ----------------------------------------------------------------------------
// End-screen technique rows: called once from end_screen.  Placed at $4C00,
// the gap between the meter code ($4800-$4BB8 in AUTOPILOT builds) and p3's
// tables at $5000; no part references $4C00-$4FFF and nothing else is
// assembled there.  Writes rows 14..19 (one part per row, then the music),
// row 20 (figures from plan/compat-all.txt) and rows 22..23 (the thanks:
// the maintainer asked for them on 2026-09-24, and the audience named is the
// C64 scene, whose techniques every page behind this demo records).  Clobbers A, X, Y and the two
// end-screen zero-page pointers.
* = $4c00 "end_text"
es_tech_print:
        ldx #0
es_tp_row:
        lda es_tp_tab+0,x; sta p5d_row
        lda es_tp_tab+1,x; sta p5d_row+1
        lda es_tp_tab+2,x; sta p5d_ptr
        lda es_tp_tab+3,x; sta p5d_ptr+1
        ldy #0
es_tp_ch:
        lda (p5d_ptr),y
        beq es_tp_next          // 0 ends a string ('@' is never printed)
        sta (p5d_row),y
        iny
        bne es_tp_ch
es_tp_next:
        inx; inx; inx; inx
        cpx #(es_tp_tab_end - es_tp_tab)
        bcc es_tp_row
        rts

// One entry per row: screen address, then the string's address.
es_tp_tab:
        .word $0400 + 40*14, es_tp_p1
        .word $0400 + 40*15, es_tp_p2
        .word $0400 + 40*16, es_tp_p3
        .word $0400 + 40*17, es_tp_p4
        .word $0400 + 40*18, es_tp_p5
        .word $0400 + 40*19, es_tp_music
        .word $0400 + 40*20, es_tp_facts
        .word $0400 + 40*22 + 10, es_tp_thanks1
        .word $0400 + 40*23, es_tp_thanks2
es_tp_tab_end:

// Technique names as the ontology spells them, in the VIC's upper-case ROM
// set.  That set has no underscore, so a full stop stands in for it; names
// are shortened only where a row would pass 40 cells.  The figures on the
// last row are from plan/compat-all.txt: 16 techniques (line 7), 48 hard
// conflicts (the "(hard)" headings) in the all-techniques check, five parts.
.encoding "screencode_upper"
es_tp_p1:
        .text "P1 TECH.TECH PLASMA SPRITE.BORDER.SCRL"
        .byte 0
es_tp_p2:
        .text "P2 TWISTER VECTOR.BALLS.SPRITES"
        .byte 0
es_tp_p3:
        .text "P3 DYSP BIG.FONT.2X2 RASTER.BARS TB.OPEN"
        .byte 0
es_tp_p4:
        .text "P4 FIRE SINE.CHAIN COLOUR.CYC DISSOLVE"
        .byte 0
es_tp_p5:
        .text "P5 SPRITES.ONLY SPRITE.MULTIPLEX.24 BARS"
        .byte 0
es_tp_music:
        .text "MUSIC SID.PLAY.ROUTINE SID.ENV3.FILTER"
        .byte 0
es_tp_facts:
        .text "16 TECHNIQUES 48 HARD CONFLICTS 5 PARTS"
        .byte 0
es_tp_thanks1:
        .text "THANKS FOR WATCHING"
        .byte 0
es_tp_thanks2:
        .text "THANKS C64 SCENE. THE TRICKS ARE YOURS."
        .byte 0
.encoding "petscii_mixed"

// ============================================================================
// seq_ext: the dispatcher tables, MAX_PART_IRQS part entries plus the
// line-255 entry. Bank-1 RAM that no part writes ($4C00-$4FFF: the meter
// ends $4BB9, end_text sits at $4C00 and must end below this block, p3's
// tables start $5000), CPU RAM under every value of $01. Here rather than
// in the $0810 block because the tables grew from 8 to 24 entries on
// 2026-09-24 (seq_rebuild, part 5).
// ============================================================================
* = $4dc0 "seq_ext"
seq_tab_line:   .fill MAX_PART_IRQS + 1, 0
seq_tab_bit7:   .fill MAX_PART_IRQS + 1, 0
seq_tab_lo:     .fill MAX_PART_IRQS + 1, 0
seq_tab_hi:     .fill MAX_PART_IRQS + 1, 0

// seq_rebuild: see the comment block in the sequencer section above.
seq_rebuild:
        sta seq_btcnt
        sei
        ldx #7
!:      lda seq_cur_bt,x; sta seq_bt0,x
        dex; bpl !-
        jsr seq_copy_entries
        // threshold = raster + 3, 9-bit, in seq_bt0 (lo) / seq_bt0+1 (bit7 form)
        lda $d012; clc; adc #3; sta seq_bt0
        lda $d011; and #$80
        bcc !+
        eor #$80                    // the add carried: the ninth bit flips
!:      sta seq_bt0+1
        ldx #0
rb_find:
        lda seq_tab_bit7,x; cmp seq_bt0+1; bcc rb_next     // entry's ninth bit below: passed
        bne rb_arm                                          // above: arm it
        lda seq_tab_line,x; cmp seq_bt0; bcs rb_arm         // same page, at or past the threshold
rb_next:
        inx
        cpx seq_count
        bcc rb_find
        ldx #0                      // everything passed: wrap to entry 0 (the 255 entry is
                                    // always present, so this only happens above 255 + bit7 lines)
rb_arm:
        stx seq_index
        jsr seq_arm_x
        cli
        rts

// seq_irq_entry: what $FFFE/$FFFF point at (seq_start). The same ten
// instructions as the KERNAL's entry at $FF48, BRK test included, so an
// interrupt costs 29 cycles to reach $0314 with the KERNAL in or out. A
// shorter stub (five instructions, 16 cycles) broke p3: its second raster
// interrupt syncs to the beam assuming the path length it was tuned on, and
// the band came out a cycle off (kernal-out-test, 2026-09-24).
seq_irq_entry:
        pha
        txa
        pha
        tya
        pha
        tsx
        lda $0104,x
        and #$10
        beq seq_irq_go
seq_irq_brk:
        jmp ($0316)             // BRK: never executed here; keeps the branch's shape
seq_irq_go:
        jmp ($0314)
.errorif (seq_irq_go >> 8) != (seq_irq_brk >> 8), "seq_irq_entry: the BRK branch crosses a page (one cycle more than the KERNAL's)"

// seq_tail: the end of the line-255 handler (trackmo step 3, design 1.6).
// The next entry is already armed and the music played; the tail enables
// interrupts and calls the current part's main, so the part's own handlers
// and the music pre-empt it. A line 255 that arrives while main is still
// running is counted (seq_skipped, "LATE FRAMES" on the end screen) and
// noted in seq_pending, and the tail that is running calls main again as
// soon as it returns: once, however many frames passed, which is what the
// main loop's flag did (design 1.6 says "skipped"; the flag never skipped,
// and skipping cost p3 three main calls in ten on NTSC). A main that takes
// longer than a frame must therefore return at once on the catch-up call,
// as p4's does on its stale-frame test. The sequencer holds main out the
// same way (seq_hold) while it runs a part's selfcheck.
seq_tail:
        lda seq_busy
        bne seq_tail_late
        inc seq_busy
        jsr seq_main_once
        lda seq_pending
        beq !+
        lda #0
        sta seq_pending
        jsr seq_main_once       // the frame that passed: its call, late. One catch-up
                                // per entry, so the main loop runs between entries (an
                                // unbounded chain starved it on NTSC under p3 and put
                                // the fade 80 frames late); a further one waits.
!:      dec seq_busy
        jmp seq_irq_exit
seq_main_once:                  // one call of the part's main, interrupts enabled
        cli
#if AUTOPILOT
        lda seq_meter; beq !+
        FrameMeterStart()
!:      jsr seq_main_vec
        lda seq_meter; beq !+
        FrameMeterStop()
!:
#else
        jsr seq_main_vec
#endif
        sei
        rts
seq_tail_late:
        lda #1
        sta seq_pending
        inc seq_skipped
        bne !+
        inc seq_skipped+1
!:      jmp seq_irq_exit

seq_main_vec:
        jmp seq_main_none       // operand: the running part's main, or seq_main_none
seq_main_none:
        rts
seq_main_off:                   // called under sei before a part's cleanup
        lda #<seq_main_none; sta seq_main_vec+1
        lda #>seq_main_none; sta seq_main_vec+2
        rts
seq_busy:       .byte 0         // 1 while main runs in the tail, or while selfcheck holds it out
seq_skipped:    .word 0         // frames on which the tail did not call main
seq_meter:      .byte 0         // 1: the tail brackets main with the harness meter (AUTOPILOT)
seq_pending:    .byte 0         // 1: a line 255 passed while main ran; the tail owes one call

seq_hold:                       // main loop: keep main out while selfcheck reads the part's state
        inc seq_busy
        rts
seq_release:
        lda #0
        sta seq_pending         // a frame counted while held is not caught up
        dec seq_busy
        rts

// seq_find_255: seq_255_index = the sorted table's line-255 entry, found by
// its handler address; called by seq_build_table after the sort.
seq_find_255:
        ldx seq_count
!:      dex
        lda seq_tab_lo,x
        cmp #<seq_line255_handler
        bne !-
        lda seq_tab_hi,x
        cmp #>seq_line255_handler
        bne !-
        stx seq_255_index
        rts

// seq_install: X = part table row (part N is row N - 1). Entered with I set
// after pN.setup: builds and arms the dispatcher table from the row's four
// bases and irq_count, points seq_main_vec at the row's main and enables the
// raster interrupt. The caller does the cli.
seq_install:
        lda seq_pt_main_lo,x;  sta seq_main_vec+1
        lda seq_pt_main_hi,x;  sta seq_main_vec+2
        lda seq_pt_cnt_lo,x;   sta seq_bt0
        lda seq_pt_cnt_hi,x;   sta seq_bt0+1
        ldy #0
        lda (seq_bt0),y
        sta seq_btcnt
        txa; asl; asl; asl; tay         // Y = 8 * row into seq_pt_bases
        ldx #0
!:      lda seq_pt_bases,y; sta seq_bt0,x
        iny; inx; cpx #8; bne !-
        jsr seq_build_table
        jsr seq_arm_first
#if KERNAL_OUT_TEST
        lda #$35; sta $01       // parts 3 to 5 set $36 in prepare, which keeps the KERNAL in
#endif
        lda #$01
        sta $d01a
        rts

// The part table: one row per part, in running order. Bases in the order
// seq_build_table reads them (irq_lines, irq_hi, irq_lo, irq_hi_addr).
seq_pt_bases:
        .word p1.irq_lines, p1.irq_hi, p1.irq_lo, p1.irq_hi_addr
        .word p2.irq_lines, p2.irq_hi, p2.irq_lo, p2.irq_hi_addr
        .word p3.irq_lines, p3.irq_hi, p3.irq_lo, p3.irq_hi_addr
        .word p4.irq_lines, p4.irq_hi, p4.irq_lo, p4.irq_hi_addr
        .word p5.irq_lines, p5.irq_hi, p5.irq_lo, p5.irq_hi_addr
seq_pt_cnt_lo:  .byte <p1.irq_count, <p2.irq_count, <p3.irq_count, <p4.irq_count, <p5.irq_count
seq_pt_cnt_hi:  .byte >p1.irq_count, >p2.irq_count, >p3.irq_count, >p4.irq_count, >p5.irq_count
seq_pt_main_lo: .byte <p1.main, <p2.main, <p3.main, <p4.main, <p5.main
seq_pt_main_hi: .byte >p1.main, >p2.main, >p3.main, >p4.main, >p5.main

// es_skipped_print: end-screen row 13, "LATE FRAMES nnnnn" (seq_skipped: the
// frames whose main was still running at line 255 and ran late, plus any
// held for a selfcheck).
.encoding "screencode_upper"
es_skip_txt:    .text "LATE FRAMES   "
es_skip_end:
.encoding "petscii_mixed"
es_skipped_print:
        ldx #(es_skip_end - es_skip_txt - 1)
!:      lda es_skip_txt,x; sta $0400 + 40*13,x; dex; bpl !-
        lda seq_skipped;   sta print5_val
        lda seq_skipped+1; sta print5_val+1
        lda #<($0400 + 40*13 + 15); sta print5_ptr
        lda #>($0400 + 40*13 + 15); sta print5_ptr+1
        jmp print5_dec
.errorif * > $5000, "seq_ext overruns p3's tables at $5000"
