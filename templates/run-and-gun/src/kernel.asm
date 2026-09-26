// kernel.asm: the display kernel of FIREBASE (the run-and-gun starter). The
// harness assembles it (with mux.asm and sound.asm) to build/asm.bin, a raw
// blob from $0880, and writes build/asm.h so C reaches every label below as
// ASM_<LABEL>. C places the blob with #pragma region and calls it with jsr.
//
// It owns the raster IRQ. One chain runs every frame:
//
//   line 250  frame IRQ  applies what C committed (YSCROLL, the sprite table),
//                        the playfield's $D011/$D016/$D021, the first eight
//                        sprites, the player (sound.asm), frame_flag = 1
//   zones     zone IRQs  reuse the eight sprites further down (mux.asm)
//   line 211  band IRQ   invalid_mode_band: ECM+BMM on in line 213's right
//                        border, YSCROLL 7 on line 215, text mode back in line
//                        222's right border: lines 214-222 black, the panel
//                        from line 223 at every YSCROLL; band_tick = 1
//
// The band is c64-kb's kickassembler/invalid-mode-band recipe as the
// row-map-redraw recipe uses it: the same polls, delay counts and entry
// (three pushes through its own vector). Added inside the band, where no
// store shows: the panel's $D016 (hires) and $D021, and the start of CIA2
// timer B for the frame meter before the first poll (the poll re-syncs, so
// what runs before it does not move the stores).
//
// The redraw (row_map_redraw, recipe kickassembler/row-map-redraw) copies 21
// rows of the raw map to the screen, top row first, 14 cycles a byte. C calls
// it on the frame YSCROLL wraps, after band_tick, and commits YSCROLL 0 in the
// same frame (scroll.c).
//
// Nothing here uses zero page: Oscar64 owns $02-$5x. KERNAL and BASIC are
// banked out ($01 = $35), so the vectors are $FFFE and $FFFA.

.const SCREEN     = $8000     // the one screen matrix (VIC bank 2)
.const PTRS       = SCREEN + $3f8
.const MAP        = $9000     // raw row map, 40 screen codes a row (the VIC sees ROM here)
.const MAP_ROWS   = 96
.const PF_ROWS    = 21        // rows 0-20 scroll; row 20 ends under the band
.const PF_D011    = $10       // DEN, RSEL = 0 (24 rows), text; YSCROLL added
.const BAND_ON    = $60       // ECM + BMM: the display window draws black
.const PANEL_D011 = $17       // DEN, RSEL = 0, YSCROLL 7: panel badline on 223
.const PF_D016    = $d8       // multicolour, 40 columns
.const PANEL_D016 = $c8       // hires, 40 columns
.const VIC_D018   = $02       // screen $8000, characters $8800 (playfield and panel)
.const PF_BG      = 9         // brown earth
.const PF_MC1     = 13        // $D022 light green
.const PF_MC2     = 0         // $D023 black
.const PANEL_BG   = 11        // dark grey
.const BORDER     = 0
.const SPLIT_IRQ  = 211       // band IRQ: polls for 213, 215, 222
.const BOTTOM     = 250       // frame IRQ, below the 24-row window
.const D213       = 9         // the recipe's delay counts (dex/bpl, 5 cycles a pass)
.const D213B      = 1         // line 213 is a badline at YSCROLL 5
.const D215       = 3
.const D222       = 9

* = $0880 "kernel"

// ---- shared with C --------------------------------------------------------
cur_ys:     .byte 0           // the YSCROLL the frame IRQ applied
pend_ys:    .byte 0           // the YSCROLL C wants from the next frame IRQ
commit:     .byte 0           // C sets once a frame: bit 0 apply pend_ys, bit 1 swap
                              // in the sprite table mux_build made. One store, so an
                              // IRQ never sees half of it. The frame IRQ clears it.
frame_flag: .byte 0           // the frame IRQ sets 1; the main loop clears it
frame_cnt:  .byte 0           // frame IRQs taken (wraps)
band_tick:  .byte 0           // the band IRQ sets 1 on its way out (line 224)
redraw_top: .byte 0           // map row for screen row 0 (C sets, redraw reads)
redraw_end: .word 0           // raster line (9 bits) the last redraw ended on
redraw_fc:  .byte 0           // frame_cnt when it ended
mtr_open:   .byte 1           // 1: IRQs do not time themselves (no meter, or inside C's bracket)
mtr_on:     .byte 0           // 1: a meter build (C sets it once)
irq_own:    .byte 1
split_own:  .byte 1
irq_n:      .byte 0           // start/stop pairs of timer B this frame
irq_cnt:    .byte 0           // ... of the frame that just ended
irq_cyc:    .word 0           // timer B count of the frame that just ended
irq_cal:    .byte 0           // timer B count of one empty start/stop pair
save_a:     .byte 0
save_x:     .byte 0
save_y:     .byte 0
next_hnd:   .word bottom_body

// Called once from C with interrupts off.
kernel_init:
        jsr audio_init
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
        lda #BORDER
        sta $d020
        lda #PF_MC1
        sta $d022
        lda #PF_MC2
        sta $d023
        lda #VIC_D018
        sta $d018
        lda #$ff                // every sprite multicolour; shared colours
        sta $d01c
        lda #0
        sta $d017
        sta $d01d
        sta $d01b
        lda #0                  // $D025 black: outline and gun
        sta $d025
        lda #10                 // $D026 light red: face and hands
        sta $d026
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
        lda cur_ys
        ora #PF_D011            // bit 7 clear: the compare line is below 256
        sta $d011
        lda #$01
        sta $d01a
        sta $d019
        rts

// ---- IRQ entry and exit (frame and zone IRQs) ------------------------------
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

// ---- frame IRQ, line 250 -------------------------------------------------
bottom_body:
        lda mtr_on              // a build without the meter skips the hand-over
        beq bb_regs
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
        lda #$10
        sta $dd0f               // reload $FFFF, stopped
        lda #0
        sta irq_n
        lda irq_own
        bne bb_regs
        lda #$01                // the rest of this IRQ counts in the new frame
        sta $dd0f
        inc irq_n
bb_regs:
        lda commit              // what C committed last frame, both halves at once
        beq bb_apply
        lsr
        bcc !+
        ldx pend_ys
        stx cur_ys
!:      lsr
        bcc !+
        jsr mux_swap
!:      lda #0
        sta commit
bb_apply:
        lda cur_ys
        ora #PF_D011
        sta $d011
        lda #PF_D016            // whole-register store: MCM set on purpose
        sta $d016
        lda #PF_BG
        sta $d021
        jsr mux_frame
#if !NO_PLAYER
        jsr audio_play
#endif
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
        sta $d012               // next frame's lines: no late check across the wrap
        jmp on_time
no_zones:
        jsr arm_split
        jmp on_time

// The band IRQ has its own vector entry, three pushes long as in the recipe.
arm_split:
        lda #<split_irq
        sta $fffe
        lda #>split_irq
        sta $ffff
        lda #SPLIT_IRQ
        sta $d012
        rts

// ---- band IRQ, line 211 (invalid_mode_band) --------------------------------
// ECM+BMM on in line 213's right border, YSCROLL 7 on line 215, text mode
// back in line 222's right border. The polls wait while $D012 is below the
// line (the recipe's "cmp / bne" costs the same 7 cycles a pass and exits on
// the same cycle), so a late zone that jumps here after line 211 cannot wait
// a whole frame (pitfall raster_poll_equality_misses_under_dispatch_latency).
split_irq:
        pha
        txa
        pha
        tya
        pha
split_body:                     // a late zone jumps here with the same three pushes
        lda mtr_open            // time this IRQ unless C's bracket already does
        sta split_own
        bne !+
        lda #$01
        sta $dd0f
        inc irq_n
!:      ldx cur_ys
        lda cur_ys
        ora #PF_D011 | BAND_ON  // same YSCROLL, ECM+BMM: no badline moves
        tay
        lda delay213,x
        tax
        lda #212
w213:   cmp $d012
        bcs w213
d213:   dex
        bpl d213
        sty $d011               // the band starts on line 214
        lda #PANEL_BG
        sta $d021               // panel background, inside the band
        lda #PANEL_D016
        sta $d016               // panel hires, inside the band
        ldy #PANEL_D011 | BAND_ON
        lda #214
w215:   cmp $d012
        bcs w215
        ldx #D215
d215:   dex
        bpl d215
        sty $d011               // YSCROLL 7: the next badline is 223
        ldy #PANEL_D011
        lda #221
w222:   cmp $d012
        bcs w222
        ldx #D222
d222:   dex
        bpl d222
        sty $d011               // text mode back before the panel's badline
        lda #1
        sta band_tick           // the redraw may start: row 20 was fetched on line 215 at most
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
        lda #$01
        sta $d019
        lda split_own
        bne !+
        lda #$00
        sta $dd0f
!:      pla
        tay
        pla
        tax
        pla
        rti

delay213:                       // line 213 is a badline at YSCROLL 5
        .fill 8, i == 5 ? D213B : D213

// ---- the redraw: rows 0-20 from map row redraw_top, top row first ----------
// LDA map,Y / STA screen,Y with both operands patched per row (the recipe's
// loop). The loop sits in one page: a taken BPL across a page costs one more
// cycle a byte, 819 a redraw (the recipe measured it).
.align $100
redraw:
        ldx redraw_top
        lda maplo,x
        sta rd_src+1
        lda maphi,x
        sta rd_src+2
        lda #<SCREEN
        sta rd_dst+1
        lda #>SCREEN
        sta rd_dst+2
        ldx #PF_ROWS
rd_row: ldy #39
rd_src: lda $ffff,y
rd_dst: sta $ffff,y
        dey
        bpl rd_src
.assert "redraw copy loop in one page", >rd_src, >*
        lda rd_src+1            // next row: +40 on both operands
        clc
        adc #40
        sta rd_src+1
        bcc !+
        inc rd_src+2
!:      lda rd_dst+1
        clc
        adc #40
        sta rd_dst+1
        bcc !+
        inc rd_dst+2
!:      dex
        bne rd_row
!:      lda $d011               // the line it ended on, retried if bit 8 changed
        ldx $d012
        cmp $d011
        bne !-
        stx redraw_end
        and #$80
        asl
        rol
        sta redraw_end+1
        lda frame_cnt
        sta redraw_fc
        rts

maplo:  .fill MAP_ROWS, <(MAP + 40*i)
maphi:  .fill MAP_ROWS, >(MAP + 40*i)

#import "mux.asm"
#import "sound.asm"
