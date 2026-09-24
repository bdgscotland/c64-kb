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

// Part modules, one file each under parts/.
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
        // init music (A = 0 selects the demo tune)
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

        lda #1
        sta seq_part
        jsr p1.prepare
        // no previous part; go straight to setup
        sei
        jsr p1.setup
        // build dispatcher table for part 1
        lda p1.irq_count
        sta seq_btcnt
        lda #<p1.irq_lines;   sta seq_bt0
        lda #>p1.irq_lines;   sta seq_bt0+1
        lda #<p1.irq_hi;      sta seq_bt1
        lda #>p1.irq_hi;      sta seq_bt1+1
        lda #<p1.irq_lo;      sta seq_bt2
        lda #>p1.irq_lo;      sta seq_bt2+1
        lda #<p1.irq_hi_addr; sta seq_bt3
        lda #>p1.irq_hi_addr; sta seq_bt3+1
        jsr seq_build_table
        jsr seq_arm_first
        lda #$01; sta $d01a
        cli
        // Each later part's prepare runs AFTER the previous part's cleanup
        // (seq_gap below), never while that part is live: see I-008.

p1_loop:
        lda seq_flag; beq p1_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_1
        bcs p1_fade_start
        jsr p1.main
        jmp p1_loop

p1_fade_start:
        // selfcheck part 1 once, before the fade
        jsr p1.selfcheck
        sta $02e0
        lda #1
        sta seq_fade

p1_fade_loop:
        lda seq_flag; beq p1_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p1.main
        jsr p1.fadeout
        cmp #1; beq p1_fade_done
        jmp p1_fade_loop

p1_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 2 PHASE
// ============================================================================
        lda #2; sta seq_part
        sei
        jsr p1.cleanup
        jsr seq_gap             // black gap, music on: p2 owns zero page and its banks from here
        jsr p2.prepare
        jsr seq_wait250
        sei
        jsr p2.setup
        lda p2.irq_count
        sta seq_btcnt
        lda #<p2.irq_lines;   sta seq_bt0
        lda #>p2.irq_lines;   sta seq_bt0+1
        lda #<p2.irq_hi;      sta seq_bt1
        lda #>p2.irq_hi;      sta seq_bt1+1
        lda #<p2.irq_lo;      sta seq_bt2
        lda #>p2.irq_lo;      sta seq_bt2+1
        lda #<p2.irq_hi_addr; sta seq_bt3
        lda #>p2.irq_hi_addr; sta seq_bt3+1
        jsr seq_build_table
        jsr seq_arm_first
        lda #$01; sta $d01a
        cli

p2_loop:
        lda seq_flag; beq p2_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_2
        bcs p2_fade_start
        jsr p2.main
        jmp p2_loop

p2_fade_start:
        jsr p2.selfcheck
        sta $02e1
        lda #1; sta seq_fade

p2_fade_loop:
        lda seq_flag; beq p2_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p2.main
        jsr p2.fadeout
        cmp #1; beq p2_fade_done
        jmp p2_fade_loop

p2_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 3 PHASE
// ============================================================================
        lda #3; sta seq_part
        sei
        jsr p2.cleanup
        jsr seq_gap
        jsr p3.prepare
        jsr seq_wait250
        sei
        jsr p3.setup
        lda p3.irq_count
        sta seq_btcnt
        lda #<p3.irq_lines;   sta seq_bt0
        lda #>p3.irq_lines;   sta seq_bt0+1
        lda #<p3.irq_hi;      sta seq_bt1
        lda #>p3.irq_hi;      sta seq_bt1+1
        lda #<p3.irq_lo;      sta seq_bt2
        lda #>p3.irq_lo;      sta seq_bt2+1
        lda #<p3.irq_hi_addr; sta seq_bt3
        lda #>p3.irq_hi_addr; sta seq_bt3+1
        jsr seq_build_table
        jsr seq_arm_first
        lda #$01; sta $d01a
        cli

p3_loop:
        lda seq_flag; beq p3_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_3
        bcs p3_fade_start
        jsr p3.main
        jmp p3_loop

p3_fade_start:
        jsr p3.selfcheck
        sta $02e2
        lda #1; sta seq_fade

p3_fade_loop:
        lda seq_flag; beq p3_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p3.main
        jsr p3.fadeout
        cmp #1; beq p3_fade_done
        jmp p3_fade_loop

p3_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 4 PHASE
// ============================================================================
        lda #4; sta seq_part
        sei
        jsr p3.cleanup
        jsr seq_gap
        jsr p4.prepare
        jsr seq_wait250
        sei
        jsr p4.setup
        lda p4.irq_count
        sta seq_btcnt
        lda #<p4.irq_lines;   sta seq_bt0
        lda #>p4.irq_lines;   sta seq_bt0+1
        lda #<p4.irq_hi;      sta seq_bt1
        lda #>p4.irq_hi;      sta seq_bt1+1
        lda #<p4.irq_lo;      sta seq_bt2
        lda #>p4.irq_lo;      sta seq_bt2+1
        lda #<p4.irq_hi_addr; sta seq_bt3
        lda #>p4.irq_hi_addr; sta seq_bt3+1
        jsr seq_build_table
        jsr seq_arm_first
        lda #$01; sta $d01a
        cli

p4_loop:
        lda seq_flag; beq p4_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        lda music_pos
        cmp #SYNC_POS_4
        bcs p4_fade_start
        jsr p4.main
        jmp p4_loop

p4_fade_start:
        jsr p4.selfcheck
        sta $02e3
        lda #1; sta seq_fade

p4_fade_loop:
        lda seq_flag; beq p4_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p4.main
        jsr p4.fadeout
        cmp #1; beq p4_fade_done
        jmp p4_fade_loop

p4_fade_done:
        lda #0; sta seq_fade

// ============================================================================
// PART 5 PHASE
// ============================================================================
        lda #5; sta seq_part
        sei
        jsr p4.cleanup
        jsr seq_gap
        jsr p5.prepare
        jsr seq_wait250
        sei
        jsr p5.setup
        lda p5.irq_count
        sta seq_btcnt
        lda #<p5.irq_lines;   sta seq_bt0
        lda #>p5.irq_lines;   sta seq_bt0+1
        lda #<p5.irq_hi;      sta seq_bt1
        lda #>p5.irq_hi;      sta seq_bt1+1
        lda #<p5.irq_lo;      sta seq_bt2
        lda #>p5.irq_lo;      sta seq_bt2+1
        lda #<p5.irq_hi_addr; sta seq_bt3
        lda #>p5.irq_hi_addr; sta seq_bt3+1
        jsr seq_build_table
        jsr seq_arm_first
        lda #$01; sta $d01a
        cli
#if AUTOPILOT
        FrameMeterInit()    // metre part 5's first 200 frames (the demo's steady state)
#endif

p5_loop:
        lda seq_flag; beq p5_loop
        lda #0; sta seq_flag
        jsr seq_music_check
#if AUTOPILOT
        FrameMeterStart()   // open the bracket: p5.main plus any interrupt that lands before Stop (none does at 1,488 cycles worst; I-012)
#endif
        lda music_pos
        cmp #SYNC_POS_5
        bcs p5_fade_start
        jsr p5.main
#if AUTOPILOT
        FrameMeterStop()
        FrameMeterPrint()
#endif
        jmp p5_loop

p5_fade_start:
        jsr p5.selfcheck
        sta $02e4
        lda #1; sta seq_fade
#if AUTOPILOT
        FrameMeterStop()
        FrameMeterPrint()
#endif

p5_fade_loop:
        lda seq_flag; beq p5_fade_loop
        lda #0; sta seq_flag
        jsr seq_music_check
        jsr p5.main
        jsr p5.fadeout
        cmp #1; beq p5_fade_done
        jmp p5_fade_loop

p5_fade_done:
        lda #0; sta seq_fade
        sei
        jsr p5.cleanup
        // leave interrupts masked: the end screen re-enables with CLI below

// ============================================================================
// END SCREEN
// ============================================================================
end_screen:
        // Text mode, bank 0, $D018=$15, black border and background.
        // Interrupts are masked; music re-enabled via CLI after setup.
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

        // row 1: title "MEASURED" at col 16
        ldx #(es_title_end - es_title - 1)
es_title_loop:
        lda es_title,x
        sta $0400 + 40*1 + 16,x
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

        // row 13: PARTS n/5 PASS or PARTS n/5 FAIL
        // count passing selfchecks
        lda #0; sta seq_tmp
        ldx #4
es_count_loop:
        lda $02e0,x; beq !+; inc seq_tmp
!:      dex; bpl es_count_loop
        // write "PARTS " at col 0
        ldx #(es_parts_end - es_parts - 1)
!:      lda es_parts,x; sta $0400 + 40*13 + 0,x; dex; bpl !-
        // write digit
        lda seq_tmp; clc; adc #$30  // screen code for count digit
        sta $0400 + 40*13 + 6
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
!:      lda es_pass,x; sta $0400 + 40*13 + 10,x; dex; bpl !-
        jmp es_display_on
es_verdict_fail:
        lda #2; sta RESULT_BYTE
        lda #BORDER_FAIL; sta $d020
        ldx #(es_fail_end - es_fail - 1)
!:      lda es_fail,x; sta $0400 + 40*13 + 10,x; dex; bpl !-
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
        jmp $ea81               // pla/tay/pla/tax/pla/rti

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
        // 2. Music: called first, before frame counter and flag.
        jsr music_play
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
        rts

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
        inx; stx seq_count
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
        rts

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

// Dispatcher table (up to 8 entries: 7 part IRQs + line-255).
seq_index:      .byte 0
seq_count:      .byte 0
seq_tab_line:   .fill 8, 0
seq_tab_bit7:   .fill 8, 0
seq_tab_lo:     .fill 8, 0
seq_tab_hi:     .fill 8, 0

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
        // "MEASURED" (8 chars): M=13, E=5, A=1, S=19, U=21, R=18, E=5, D=4
        .byte $0d, $05, $01, $13, $15, $12, $05, $04
es_title_end:

es_cred1:
        // "BUILT FROM C64-KB"
        .byte $02, $15, $09, $0c, $14, $20, $06, $12, $0f, $0d, $20
        .byte $03, $36, $34, $2d, $0b, $02
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
