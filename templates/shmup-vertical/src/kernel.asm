// kernel.asm: the display and sound kernel of shmup-vertical. The harness
// assembles it (with mux.asm and sound.asm) to build/asm.bin, a raw blob
// from $0880, and writes build/asm.h so C can reach every label below as
// ASM_<LABEL>. C places the blob with #pragma region and calls it with jsr.
//
// It owns the raster IRQ. One chain runs every frame:
//
//   line 252  frame IRQ   playfield $D011/$D018/$D016/$D021, first eight
//                         sprites, frame_flag = 1 for the C main loop
//   zones     zone IRQs   reuse the eight sprites further down (mux.asm)
//   line 204  split IRQ   the panel: $D011, $D018, $D016 from line 206's
//                         right border, $D021 after the panel's badline;
//                         sprites off; then the music (sound.asm)
//
// The split is c64-kb's kickassembler/scroll-panel-split recipe (technique
// scroll_panel_split): the panel starts on a line with YSCROLL 7, and the
// wait before the writes comes from a table indexed by the playfield's
// YSCROLL, short at YSCROLL 6, where the last playfield line is a badline.
// The playfield here is multicolour and 40 columns; the delays are the
// recipe's. Changed: $D016 is written last, not first (see split_stores),
// the split has its own vector entry (see arm_split), and the split is 8
// lines above the recipe's (#107). The recipe's panel starts on line 215,
// so its fifth row starts on line 247 and only lines 247-250 of it show
// above the border: the panel showed four rows. Here it starts on line 207
// and shows screen rows 19-23 on lines 207-246. It must start on a line
// with YSCROLL 7: the forced badline then re-starts the row the playfield
// is in at every YSCROLL, and moving it a whole row keeps each line's
// badline status, so the recipe's delays still apply. RSEL = 0 in the
// panel closes the border on line 247, over the top of row 24.
//
// Nothing here uses zero page: Oscar64 owns $02-$52. KERNAL and BASIC are
// banked out ($01 = $35), so the vectors are $FFFE and $FFFA.
//
// Frame meter: CIA2 timer B adds up the time of every IRQ that does not land
// inside the C main loop's own bracket (mtr_open = 0); an IRQ inside it is
// already in that bracket's wall time. The frame IRQ hands the sum of the
// frame that just ended to C (irq_cyc, irq_cnt start/stop pairs). C sets
// mtr_open to 1 for good in a build without the meter. The split IRQ starts
// timer B only after its panel writes, so its timing stays the recipe's;
// split_prev tells C to add those first cycles (a constant it measured).

.const PF_A       = $8000     // playfield screen 0 (VIC bank 2, $8000-$BFFF)
.const PF_B       = $8400     // playfield screen 1
.const PANEL      = $8800     // panel screen
.const PTRS_A     = PF_A + $3f8
.const PTRS_B     = PF_B + $3f8
.const PF_D016    = $d8       // multicolour, 40 columns, XSCROLL 0
.const PANEL_D016 = $c8       // hires, 40 columns
.const PANEL_D011 = $17       // DEN, RSEL = 0, YSCROLL 7: panel badlines 207, 215, ... 239; border from 247
.const PANEL_D018 = $2e       // screen $8800, characters $B800
.const PANEL_BG   = 11        // dark grey
.const LAST_PF    = 206       // last playfield line at every YSCROLL
.const SPLIT_LINE = 204       // split IRQ fires here and polls for LAST_PF
.const BOTTOM     = 252       // frame IRQ, below the panel

* = $0880 "kernel"

// ---- shared with C --------------------------------------------------------
pf_d011:    .byte $13         // $D011 for the next frame: DEN, 24 rows, YSCROLL
pf_d018:    .byte $0e         // $D018 for the next frame: which playfield screen
pf_bg:      .byte 6           // $D021 for the playfield
frame_flag: .byte 0           // the frame IRQ sets 1; the main loop clears it
frame_cnt:  .byte 0           // frame IRQs taken (wraps)
cur_y:      .byte 0           // the YSCROLL the frame IRQ applied
mtr_open:   .byte 1           // 1: IRQs do not time themselves
mtr_on:     .byte 0           // 1: a meter build (C sets it once)
irq_own:    .byte 1
irq_n:      .byte 0           // start/stop pairs of timer B this frame
irq_cnt:    .byte 0           // ... of the frame that just ended
irq_cyc:    .word 0           // timer B count of the frame that just ended
irq_cal:    .byte 0           // timer B count of one empty start/stop pair
save_a:     .byte 0
save_x:     .byte 0
save_y:     .byte 0
next_hnd:   .word bottom_body
count:      .byte 0

// Called once from C with interrupts off. A = 0 PAL, 1 NTSC.
kernel_init:
        jsr music_init
        lda #$7f
        sta $dc0d               // no CIA interrupts
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda #$35                // KERNAL and BASIC out, I/O in
        sta $01
        lda #<irq_entry
        sta $fffe
        lda #>irq_entry
        sta $ffff
        lda #<nmi
        sta $fffa
        lda #>nmi
        sta $fffb
        lda #$ff                // timer B: latch $FFFF, loaded, stopped
        sta $dd06
        sta $dd07
        lda #$10
        sta $dd0f
        lda #$01                // one empty start/stop pair, for irq_cal
        sta $dd0f
        lda #$00
        sta $dd0f
        lda #$ff
        sec
        sbc $dd06
        sta irq_cal
        lda #$10
        sta $dd0f
        lda #<bottom_body
        sta next_hnd
        lda #>bottom_body
        sta next_hnd+1
        lda #BOTTOM
        sta $d012
        lda pf_d011             // bit 7 clear: the compare line is below 256
        sta $d011
        lda #$01
        sta $d01a
        sta $d019
        rts

// ---- IRQ entry and exit ---------------------------------------------------
irq_entry:
        sta save_a
        lda mtr_open            // inside the main loop's bracket: already timed
        sta irq_own
        bne !+
        lda #$01
        sta $dd0f               // timer B resumes from its count
        inc irq_n
!:      stx save_x
        sty save_y
        cld
dispatch:
        jmp (next_hnd)

irq_exit:
        lda irq_own
        bne !+
        lda #$00
        sta $dd0f
!:      ldy save_y
        ldx save_x
        lda save_a
nmi:    rti

// ---- frame IRQ, line 252 --------------------------------------------------
bottom_body:
        lda mtr_on              // a build without the meter skips the hand-over
        beq bb_regs             // (60 cycles a frame)
        lda #$00                // the frame ends here: hand its IRQ time to C
        sta $dd0f
        lda #$ff
        sec
        sbc $dd06
        sta irq_cyc
        lda #$ff
        sbc $dd07
        sta irq_cyc+1
        lda irq_n
        sta irq_cnt
        lda split_self
        sta split_prev
        lda #0
        sta split_self
        lda #$10
        sta $dd0f               // reload $FFFF, stopped
        lda #0
        sta irq_n
        lda irq_own
        bne !+
        lda #$01                // the rest of this IRQ counts in the new frame
        sta $dd0f
        inc irq_n
!:
bb_regs:
        lda pf_d011
        sta $d011
        and #7
        sta cur_y
        lda pf_d018
        sta $d018
        lda #PF_D016            // whole-register store: MCM and CSEL set on purpose
        sta $d016
        lda pf_bg
        sta $d021
        jsr mux_frame
        lda #1
        sta frame_flag
        inc frame_cnt
        ldx zidx
        cpx zlast
        beq no_zones
        lda #<zone_body
        sta next_hnd
        lda #>zone_body
        sta next_hnd+1
        lda zline,x
        jmp arm
no_zones:
        jsr arm_split
        jmp on_time
arm:    sta $d012               // next frame's lines: no late check across the wrap
        jmp on_time

// The split has its own vector entry, so the poll starts early in its
// first line as in the recipe. Through irq_entry it started about 30 cycles
// later, and at YSCROLL 5 on PAL (line 213 a badline; the split was then 8
// lines lower) the panel's writes then landed in line 215 in 4 frames of
// every 12, following the music's cost: the panel's first row showed
// playfield characters (measured in VICE, then fixed so).
arm_split:
        lda #<split_irq
        sta $fffe
        lda #>split_irq
        sta $ffff
        lda #SPLIT_LINE
        sta $d012
        rts

// ---- split IRQ, line 204 --------------------------------------------------
// Poll for line 206, wait delay_tbl[YSCROLL] passes, switch to the panel.
split_irq:
        sta save_a              // 12 cycles, like the recipe's three pushes
        stx save_x
        sty save_y
split_body:                     // a late zone jumps here, registers saved
        ldx cur_y
        lda delay_tbl,x
        sta count
        ldx #PANEL_D018         // everything loaded before the poll, so after
        ldy #PANEL_D016         // a badline stall only the stores remain
        lda #LAST_PF-1
waitline:
        cmp $d012               // until $D012 > 205: never waits a whole frame
        bcs waitline
        lda #PANEL_D011
delay:  dec count               // absolute: 9 cycles a pass, 8 on the way out
        bpl delay
// The writes start between cycle 57 of the last playfield line and cycle 1
// of the panel's first on PAL (57 to 65 on NTSC), the poll's jitter, in
// Bauer's numbering, measured under the VICE monitor with the split on
// lines 214-215, before #107 moved it up 8 lines (an earlier comment gave
// the exec trace's 0-based 58 to 0 and 58 to 64; a 20,000,000-cycle re-run
// for c64-kb issue #82 also started one on exec CYC 56). In the recipe's
// order ($D016 first) the $D018 write came a cycle from too late at the far
// end: a run with it at cycle 12 of the panel's first line showed
// playfield characters in the panel's first row.
// $D016 last buys four cycles; it only switches multicolour off, and the
// panel's first pixels are background in both modes.
split_stores:
        sta $d011               // before cycle 12 of line 207, the panel's badline
        stx $d018               // before that badline's first screen fetch
        sty $d016               // last: the panel's first pixels are blank either way
        lda #LAST_PF
waitpanel:
        cmp $d012               // until $D012 > 206
        bcs waitpanel
        nop                     // reads across cycle 12 of line 207: the panel's
        nop                     // badline holds the CPU until cycle 55 at every
        nop                     // phase, which removes the poll jitter
        nop
        lda #PANEL_BG
        sta $d021               // right border of line 207
        lda #0
        sta $d015               // no sprite under the panel
        cld
        lda split_late          // came from a late zone: its entry started timer B
        bne !+
        lda mtr_open            // came through the vector: time the rest, as
        sta irq_own             // irq_entry does for every other IRQ
        bne !+
        lda #$01
split_tb_on:
        sta $dd0f
        inc irq_n
        inc split_self          // C adds the untimed start of this IRQ
!:      lda #0
        sta split_late
#if !NO_PLAYER                  // make watchtest: the build without it fails SID_FRAMES
        jsr music_play
#endif
        lda #<irq_entry
        sta $fffe
        lda #>irq_entry
        sta $ffff
        lda #<bottom_body
        sta next_hnd
        lda #>bottom_body
        sta next_hnd+1
        lda #BOTTOM
        sta $d012
        jmp on_time

split_late: .byte 0
split_self: .byte 0             // this frame's split started timer B late ...
split_prev: .byte 0             // ... and the frame that just ended

// Delay passes per playfield YSCROLL (dec abs / bpl: 9 cycles a pass).
delay_tbl:
        .byte 5, 5, 5, 5, 5, 5, 0, 5

// copy_rows: three playfield rows, 120 bytes from row_src to row_dst, for
// level.c. C writes both addresses; the patch step points each of three
// load/store pairs at one row (+0, +40, +80), and the loop moves a column of
// three bytes a pass: 32 cycles a column, 1,280 a call, against 12.5 a byte
// (about 1,500) for the two-byte loop it replaces (arithmetic). The idea is
// the other #39 version's copy3.
row_src: .word 0
row_dst: .word 0
copy_rows:
        .for (var k = 0; k < 3; k++) {
            lda row_src
            clc
            adc #40 * k
            sta cr_ld + 6 * k + 1
            lda row_src+1
            adc #0
            sta cr_ld + 6 * k + 2
            lda row_dst
            clc
            adc #40 * k
            sta cr_ld + 6 * k + 4
            lda row_dst+1
            adc #0
            sta cr_ld + 6 * k + 5
        }
        ldx #39
cr_loop:
cr_ld:
        .for (var k = 0; k < 3; k++) {
            lda $ffff,x         // patched above
            sta $ffff,x
        }
        dex
        bpl cr_loop
        rts

#import "mux.asm"
#import "sound.asm"
#import "glyph.asm"
#import "hit.asm"
#import "step.asm"
