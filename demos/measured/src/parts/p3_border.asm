// p3_border.asm: part 3 of MEASURED, the BORDER part.
//
// Recipes ported:
//   docs/recipes/kickassembler/dysp.md (dysp_side_border_sprites): the
//     line loop, the SET-indexed stall table and its conversion, the
//     double-IRQ entry, the region detection.
//   docs/techniques/scroll.md soft_scroll_h (oscar64-soft-scroll-h, ported):
//     one text row scrolled a pixel a frame by XSCROLL, shifted a cell when
//     XSCROLL wraps.
//
// The DYSP: four sprites bob on their own sines in the opened side borders,
// bars on the left (sprites 0 and 1 at X 0), rings on the right (sprites 2
// and 3 at X 344), Y bases 71, 100, 129 and 158 with amplitude 20, so Y runs
// 51 to 179 and the lowest sprite row is line 200. The band is lines 51 to
// 200: one DEC $D016 a line whose new value lands on cycle 56 (PAL) or 57
// (NTSC), followed by a delay read from a table indexed by WHICH sprites the
// VIC fetches on that line, so that code plus padding plus stall is 63 (65)
// cycles on every line and the next DEC starts on the same cycle again.
// Sprites 0 and 1 are on the left because at X 344 their own data fetch
// (cycles 58 to 61) falls under their display and cuts them at X 362: the
// recipe's own pinned picture shows its white ring as 18 columns wide.
//
// The scroller: the text row the VIC draws on lines 227 to 234. The line-225
// interrupt sets $D016 = $C8 | xscroll (the write lands on line 226 after the
// dispatcher latency), line 236 restores $C8 and then advances the
// scroll (a cell shift when xscroll wraps from 0 to 7), after the row has
// been drawn. The row's MEMORY is screen row 3, not 22: the band suppresses
// every badline from 51 to 202, so VCBASE stays 0 and the first badline
// after the band (line 203) shows screen row 0; lines 227 to 234 show row 3.
//
// Deviations from the recipes:
//   1. Entry through the sequencer's dispatcher, twice. irq1 (line 45) arms
//      $D012 = 48, clears the raster flag, CLIs and idles in 60 NOPs (and, if
//      irq2 has not come by then, waits for line 47 and slides again). irq2
//      (line 48) comes through the dispatcher again (same table index;
//      irq_state routes it), restores SP so that its rts returns into irq1's
//      dispatcher frame, syncs with the two-read $D012 compare whose CMP read
//      straddles the end of line 49, then pads to the first DEC on line 51.
//      The dispatcher's latency is constant per entry; it only moves where
//      the band can start.
//   2. The pad before the first DEC writes $D011 = $18: line 51 & 7 equals
//      the resting YSCROLL of 3, so line 51 would be the first badline.
//   3. mask_tab is double-buffered ($5200/$5300). main builds the back page,
//      then under SEI writes the four Y registers and patches the loops'
//      operand together, so the band never reads a half-built table or a
//      table for other Y positions. main can only run outside the band.
//   4. The cell shift lives in the line-236 handler, not main, so it cannot
//      tear the row on a frame where main runs late.
//   5. Stopwatch: CIA1 timer A brackets the band (started after the sync,
//      so the count is exact) and the 236 handler; CIA1 timer B brackets
//      main, and the interrupts pause it on entry and let it run on from the
//      held count on exit, so main's figure excludes them even when the band
//      lands inside main (it does on NTSC).
//   6. selfcheck reads the band's CIA count: it must never have varied over
//      the run (sprite sets differ from frame to frame) and must equal the
//      model's constant within two cycles; and the scroll row's last cell
//      must be the character the scroller last inserted.
//   7. Constant tables are loaded with the PRG into bank 1 at $5000-$56FF,
//      where no part writes (I-007: the PRG image must not overlap p1's bank
//      0 blocks). Sprite shapes are copied to $3C00 by prepare because the
//      VIC must see them in bank 0. Cold code sits at $5700.
//   8. The scroller advances only on frames in which main ran (frame_go),
//      so the standalone runner's frozen picture is static.
//
// Memory: code $9920-$9FFF (contract tables, irq1, handler_226 in the first
// page; loop_pal + irq2 at $9A00; loop_ntsc at $9B00; band_done, handlers,
// build_tables, main from $9C00). Bank 1: sine $5000, d011 $5100, mask pages
// $5200 and $5300, small tables and scroll text $5400-$55FF, shape sources
// $5600, cold code $5700. Bank 0 at run time only: $3C00-$3CFF shapes, $0400
// screen.

#importonce

.namespace p3 {

// --- Constants ---------------------------------------------------------------

.const BAND_TOP    = 51             // first DEC line; the band opens 51 to 200
.const BAND_LINES  = 150
.const IRQ1_LINE   = BAND_TOP - 6   // 45: arms irq2
.const IRQ2_LINE   = BAND_TOP - 3   // 48: the stable entry
.const XS_LINE     = 225            // XSCROLL set: the dispatcher latency puts the write on line 226
.const XR_LINE     = 236            // XSCROLL restore, after the row (227 to 234)
.const NSPR        = 4
.const EXTRA_MAX   = 12             // six NOPs; the odd cycle from the branch
// Sync and entry pads, all four set from the monitor:
// irq2_path's first instruction executes on line 49 cycle 31 or 32 on both
// models. With these pads the store trace reports every DEC on cycle 56 and
// every INC on 42 (PAL) or 40 (NTSC), the recipe's own figures.
.const SYNC_PAD    = 24             // PAL: CMP read on cycle 62 of line 49 when arrival is 31
.const SYNC_PADN   = 26             // NTSC: CMP read on cycle 64 of line 49 when arrival is 31
.const ENTRYPAD    = 83             // PAL: from the timer start to the first DEC
.const ENTRYPADN   = 85             // NTSC
// The band's CIA1 timer A count, timer start in the line-50 pad to the stop
// after the last INC; constant when the loop is phase-locked. Measured:
// min = max over 300 frames on each model.
.const BAND_CYC_PAL  = 9540
.const BAND_CYC_NTSC = 9840
.const FADE_FRAMES = 3
.const FADE_LEVELS = 15
.const SCREEN      = $0400
.const SCROLL_MEM_ROW = 3           // shown on lines 227 to 234, see the header
.const SCROLL_SCR  = SCREEN + SCROLL_MEM_ROW * 40
.const SCROLL_COL  = $d800 + SCROLL_MEM_ROW * 40
.const SPRITE_BASE = $3c00          // pointers $F0-$F3
.const SPR_X_RIGHT = 344
.const SPR_X_LEFT  = 0
.const BORDER_COL  = 11             // dark grey: the open band shows the black background
.const XSCROLL_INIT = 4             // 300 steps later the standalone freeze lands on 0, so the pinned row is cell-aligned

// Bank 1 data, loaded with the PRG; nothing else writes $5000-$5BFF.
.const sine_tab    = $5000          // 256 bytes, amplitude 20
.const d011_tab    = $5100          // 256 bytes, YSCROLL per band index
.const mask_a      = $5200          // per-line sprite set, page A
.const mask_b      = $5300          // page B
.const PAGE_XOR    = (mask_a >> 8) ^ (mask_b >> 8)   // 1: swaps the two page numbers
.const small_tabs  = $5400          // conversions, sprite constants, scroll text
.const shapes_src  = $5600          // four 64-byte sprite shapes
.const COLD_CODE   = $5700          // prepare, setup, fadeout, cleanup, selfcheck

// --- Assembly-time functions (recipe) ---------------------------------------

// CPU cycles lost after the DEC to the sprite DMA of the sprites in mask m:
// p-access slots 58, 60, 62, 1 (PAL) and 60, 62, 64, 1 (NTSC); BA falls
// three cycles before the first, the CPU resumes two after the last.
.function lostcycles(m, ntsc) {
    .if (m == 0) .return 0
    .var f = 0
    .while (((m >> f) & 1) == 0) .eval f++
    .var l = 3
    .while (((m >> l) & 1) == 0) .eval l--
    .if (f == 0) .return (ntsc ? 4 : 3) + 2 * l
    .return 5 + 2 * (l - f)
}

// A 24x21 ring: an ellipse two to three pixels thick.
.function ringbyte(row, col) {
    .var v = 0
    .for (var b = 0; b < 8; b++) {
        .var x = col * 8 + b
        .var dx = (x - 11.5) / 11.5
        .var dy = (row - 10) / 10
        .var d = dx * dx + dy * dy
        .if (d <= 1.0 && d >= 0.5) .eval v = v | (128 >> b)
    }
    .return v
}

// A 24x7 bar on rows 7 to 13 with its corners taken off.
.function barbyte(row, col) {
    .if (row >= 8 && row <= 12) .return $ff
    .if (row == 7 || row == 13) .return (col == 0) ? $7f : ((col == 2) ? $fe : $ff)
    .return 0
}

.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// --- Zero page ($10-$7F) ----------------------------------------------------

.label acc_main  = $10              // main's bracket, summed per frame
.label acc_irq   = $12              // the band's and the 236 handler's
.label sum       = $14
.label irq_state = $16              // 0: next dispatch is irq1; 1: irq2
.label saved_sp  = $17
.label reg_flag  = $18              // 0 PAL, 1 NTSC
.label phase     = $19              // 4 bytes
.label xscroll   = $1d
.label msg_pos   = $1e
.label fade_ctr  = $1f
.label fade_lvl  = $20
.label b_paused  = $21              // timer B was running when the interrupt came
.label back_page = $22              // high byte of the page main writes next
.label frame_go  = $23              // main ran since the last scroll step
.label band_cyc  = $24              // last band count (CIA1 timer A)
.label band_min  = $26
.label band_max  = $28
.label spr_y_new = $2a              // 4 bytes, the frame main built
.label ptr       = $2e
.label tmp       = $30
.label spr_ena   = $31              // $D015 shadow: $0F, or 0 once the fade has switched the sprites off

// --- Bank 1 tables ----------------------------------------------------------

* = sine_tab "p3 sine"
    .fill 256, (round(20 * sin(toRadians(i * 360 / 256))) + 256) & 255

* = d011_tab "p3 d011"
    .fill 256, $18 | ((BAND_TOP + i + 4) & 7)

* = mask_a "p3 mask_a"
    .fill 256, 0

* = mask_b "p3 mask_b"
    .fill 256, 0

* = small_tabs "p3 tables"
conv_pal:
    .fill 16, lostcycles(i, false)
conv_ntsc:
    .fill 16, lostcycles(i, true)
conv_active: .fill 16, 0
entry16:     .fill 16, 0
odd16:       .fill 16, 0
spr_base:    .byte 71, 100, 129, 158
spr_speed:   .byte 2, 3, 5, 7
spr_col:     .byte 1, 7, 3, 13
lum_down:    .byte 0, 7, 9, 10, 11, 12, 0, 15, 4, 6, 14, 2, 8, 3, 5, 13
band_exp_lo: .byte <BAND_CYC_PAL, <BAND_CYC_NTSC
band_exp_hi: .byte >BAND_CYC_PAL, >BAND_CYC_NTSC
.encoding "screencode_upper"
scroll_text:
    .text "MEASURED   *   PART THREE: BORDER   *   ONE DEC OF D016 A LINE OPENS THE SIDE BORDER AND A TABLE BUILT EVERY FRAME FROM THE SPRITE POSITIONS PAYS BACK THE DMA STALL   *   BARS AND RINGS ON SINES   *   DYSP FROM THE C64 KNOWLEDGE BASE        "
scroll_end:
.encoding "petscii_mixed"
.const SCROLL_LEN = scroll_end - scroll_text
.if (SCROLL_LEN > 255) .error "scroll text longer than 255 bytes: msg_pos is one byte"

* = shapes_src "p3 shapes"
    .for (var r = 0; r < 21; r++) { .byte barbyte(r, 0), barbyte(r, 1), barbyte(r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte barbyte(r, 0), barbyte(r, 1), barbyte(r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte ringbyte(r, 0), ringbyte(r, 1), ringbyte(r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte ringbyte(r, 0), ringbyte(r, 1), ringbyte(r, 2) }
    .byte 0

// --- First page $9920-$99FF: contract tables, irq1, handler_226 -------------

* = P3_CODE "p3 code"

irq_count:   .byte 3
irq_lines:   .byte IRQ1_LINE, XS_LINE, XR_LINE
irq_hi:      .byte 0, 0, 0
irq_lo:      .byte <irq1_handler, <handler_226, <handler_236
irq_hi_addr: .byte >irq1_handler, >handler_226, >handler_236
worst:       .word 0
typical:     .word 0

// The dispatcher enters here for line 45 and again for line 48.
irq1_handler:
        lda irq_state
        beq irq1_path
        jmp irq2_path

irq1_path:
        tsx
        stx saved_sp
        lda #1
        sta irq_state
        lda #IRQ2_LINE
        sta $d012
        lda #$01
        sta $d019
        jsr pause_b             // main's stopwatch, if main is running
        cli
irq1_slide:
        .for (var i = 0; i < 60; i++) { nop }
        // Only reached when irq2 did not come inside the slide: irq1 ran
        // too late to arm line 48 in this frame (the runner's first frame,
        // whose raster flag latched before its CLI). A `jmp *` here would
        // give irq2 a three-cycle jitter the sync cannot absorb, and the
        // first band was one cycle late for it. Wait for line 47 and slide
        // again, so irq2 always lands in a NOP.
!:      lda $d012
        cmp #IRQ2_LINE - 1
        bne !-
        jmp irq1_slide          // irq2 leaves through irq1's frame; this never returns

// handler_226: XSCROLL for the scroll row (lines 227 to 234); armed at 225.
handler_226:
        lda xscroll
        ora #$c8
        sta $d016
        rts

// pause_b / resume_b: CIA1 timer B is main's stopwatch. An interrupt that
// lands inside main's bracket stops it on entry and lets it run on from the
// held count on exit (START without LOAD), so main's figure excludes the
// interrupt's own cycles.
pause_b:
        lda $dc0f
        and #$01
        sta b_paused
        beq !+
        lda #$00
        sta $dc0f
!:      rts

resume_b:
        lda b_paused
        beq !+
        lda #$01
        sta $dc0f
!:      rts

// --- $9A00: the PAL loop, then the stable entry -----------------------------

* = $9a00 "p3 loop_pal"

loop_pal:
        dec $d016               // 51-56: writes on 55 and 56, new value on 56
        inx                     // reads only from here until the stall ends
        lda d011_tab, x
        sta $d011               // the next line's YSCROLL: no badline
lp_mask_pal:
        ldy mask_a, x           // which sprites the VIC fetches after this DEC
        lda odd16, y
        bne !+                  // taken: one cycle more
!:      lda entry16, y
        sta jm_pal + 1
jm_pal: jmp slide_pal
slide_pal:
        nop
        nop
        nop
        nop
        nop
        nop
        inc $d016               // CSEL back to 1
        cpx #BAND_LINES
        bne !+
        jmp band_done
!:      jmp loop_pal            // 51 + extra code cycles a line

// irq2: through the dispatcher a second time. Everything before the sync is
// constant per model; the sync removes the one-cycle jitter of the NOP idle.
irq2_path:
        ldx saved_sp
        txs                     // discard irq2's frame: rts returns into irq1's
        lda #0
        sta irq_state
        lda reg_flag
        beq irq2_pal
        jmp irq2_ntsc

irq2_pal:
        Delay(SYNC_PAD)
        lda $d012
        cmp $d012
        beq !+
!:      ldx #0
        lda #$18
        sta $d011               // line 51 & 7 = 3 = YSCROLL: keep it off the badline
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$11
        sta $dc0e               // CIA1 timer A: the band's bracket
        Delay(ENTRYPAD)
        jmp loop_pal

// --- $9B00: the NTSC loop, same layout so slide_ntsc shares the low byte ---

* = $9b00 "p3 loop_ntsc"

loop_ntsc:
        dec $d016               // 52-57: writes on 56 and 57
        inx
        lda d011_tab, x
        sta $d011
lp_mask_ntsc:
        ldy mask_a, x
        lda odd16, y
        bne !+
!:      lda entry16, y
        sta jm_ntsc + 1
jm_ntsc: jmp slide_ntsc
slide_ntsc:
        nop
        nop
        nop
        nop
        nop
        nop
        inc $d016
        cpx #BAND_LINES
        bne !+
        jmp band_done
!:      Delay(2)
        jmp loop_ntsc           // 53 + extra code cycles a line

irq2_ntsc:
        Delay(SYNC_PADN)
        lda $d012
        cmp $d012
        beq !+
!:      ldx #0
        lda #$18
        sta $d011
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$11
        sta $dc0e
        Delay(ENTRYPADN)
        jmp loop_ntsc

// --- $9C00: band end, handlers, table build, main ---------------------------

* = $9c00 "p3 routines"

// band_done: stop the band's stopwatch, keep its count and its extremes,
// restore the display for the rows below, let main's stopwatch run on,
// return to the dispatcher.
band_done:
        lda #0
        sta $dc0e
        lda #$1b
        sta $d011               // badlines again from line 203: written now, on line 201,
                                // because a write during line 203 starts that badline late
        sec
        lda #$ff
        sbc $dc04
        sta band_cyc
        lda #$ff
        sbc $dc05
        sta band_cyc + 1
        lda band_cyc
        clc
        adc acc_irq
        sta acc_irq
        lda band_cyc + 1
        adc acc_irq + 1
        sta acc_irq + 1
        // min
        lda band_cyc + 1
        cmp band_min + 1
        bcc bd_newmin
        bne bd_ckmax
        lda band_cyc
        cmp band_min
        bcs bd_ckmax
bd_newmin:
        lda band_cyc
        sta band_min
        lda band_cyc + 1
        sta band_min + 1
bd_ckmax:
        lda band_cyc + 1
        cmp band_max + 1
        bcc bd_out
        bne bd_newmax
        lda band_cyc
        cmp band_max
        bcc bd_out
bd_newmax:
        lda band_cyc
        sta band_max
        lda band_cyc + 1
        sta band_max + 1
bd_out:
        jsr resume_b
        rts

// handler_236: restore XSCROLL, then advance the scroller now that the row
// has been drawn. Bracketed with CIA1 timer A; pauses main's timer B.
handler_236:
        lda #$c8
        sta $d016
        jsr pause_b
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$11
        sta $dc0e
        lda frame_go
        beq h236_stop
        lda #0
        sta frame_go
        lda xscroll
        beq h236_carry
        dec xscroll
        jmp h236_stop
h236_carry:
        lda #7
        sta xscroll
        ldy #0
!:      lda SCROLL_SCR + 1, y
        sta SCROLL_SCR, y
        iny
        cpy #39
        bne !-
        ldy msg_pos
        lda scroll_text, y
        sta SCROLL_SCR + 39
        iny
        cpy #SCROLL_LEN
        bcc !+
        ldy #0
!:      sty msg_pos
h236_stop:
        // stop timer A, acc_irq += elapsed
        lda #0
        sta $dc0e
        sec
        lda #$ff
        sbc $dc04
        tax
        lda #$ff
        sbc $dc05
        tay
        txa
        clc
        adc acc_irq
        sta acc_irq
        tya
        adc acc_irq + 1
        sta acc_irq + 1
        jsr resume_b
        rts

// build_tables: Y from the sines into spr_y_new, then the back page: clear
// entries 1 to BAND_LINES and OR each sprite's bit into the 21 entries from
// its Y line. Entry j stands for line 50 + j, the loop's X after its INX.
build_tables:
        lda #0
        sta ptr
        lda back_page
        sta ptr + 1
        .for (var s = 0; s < NSPR; s++) {
            ldx phase + s
            lda sine_tab, x
            clc
            adc spr_base + s
            sta spr_y_new + s
        }
        ldy #BAND_LINES
        lda #0
!:      sta (ptr), y
        dey
        bne !-
        lda spr_ena
        beq bt_done             // sprites off: no DMA on any line, the table stays empty
        .for (var s = 0; s < NSPR; s++) {
            lda spr_y_new + s
            sec
            sbc #(BAND_TOP - 1)
            tay
            ldx #21
        !:  lda (ptr), y
            ora #(1 << s)
            sta (ptr), y
            iny
            dex
            bne !-
        }
bt_done:
        rts

// adopt: the table just built becomes the band's, with the Y positions and
// the sprite enable it was built for. Interrupts must be off around it.
adopt:
        lda spr_y_new + 0
        sta $d001
        lda spr_y_new + 1
        sta $d003
        lda spr_y_new + 2
        sta $d005
        lda spr_y_new + 3
        sta $d007
        lda back_page
        sta lp_mask_pal + 2
        sta lp_mask_ntsc + 2
        eor #PAGE_XOR
        sta back_page
        lda spr_ena
        sta $d015               // with the table: a table built for no sprites must not
                                // meet sprites still on, nor the reverse
        rts

// main: close the previous frame's brackets into worst and typical, then
// advance the sines, build the next table into the back page and adopt it.
main:
        lda #1
        sta frame_go
        sei                     // read and clear the interrupt accumulator whole
        lda acc_irq
        sta sum
        lda acc_irq + 1
        sta sum + 1
        lda #0
        sta acc_irq
        sta acc_irq + 1
        cli
        lda sum
        clc
        adc acc_main
        sta sum
        lda sum + 1
        adc acc_main + 1
        sta sum + 1
        lda #0
        sta acc_main
        sta acc_main + 1
        lda sum + 1
        cmp worst + 1
        bcc mn_skip_w
        bne mn_upd_w
        lda sum
        cmp worst
        bcc mn_skip_w
mn_upd_w:
        lda sum
        sta worst
        lda sum + 1
        sta worst + 1
mn_skip_w:
        lda sum
        sta typical
        lda sum + 1
        sta typical + 1
        lda #$ff
        sta $dc06
        sta $dc07
        lda #$11
        sta $dc0f               // CIA1 timer B: main's bracket
        .for (var s = 0; s < NSPR; s++) {
            lda phase + s
            clc
            adc spr_speed + s
            sta phase + s
        }
        jsr build_tables
        sei
        jsr adopt
        cli
        lda #0
        sta $dc0f
        sec
        lda #$ff
        sbc $dc06
        sta acc_main
        lda #$ff
        sbc $dc07
        sta acc_main + 1
        rts

// --- Cold code in bank 1 ----------------------------------------------------

* = COLD_CODE "p3 cold"

// detect_region (recipe): the highest raster low byte with bit 8 set is
// 55 on PAL and 6 on NTSC. Interrupts masked around the poll.
detect_region:
        sei
!:      bit $d011
        bmi !-
!:      bit $d011
        bpl !-
!:      lda $d012
        bit $d011
        bpl !+
        tax
        jmp !-
!:      lda #0
        cpx #$10
        bcs !+
        lda #1
!:      sta reg_flag
        cli
        rts

// prepare: region, sprite shapes into bank 0, the per-model conversion,
// zero page. No VIC or SID writes.
prepare:
        jsr detect_region
        ldx #0
!:      lda shapes_src, x
        sta SPRITE_BASE, x
        inx
        bne !-
        // mask -> lost cycles -> slide entry and odd cycle (recipe conv_loop)
        ldx #15
cv_loop:
        lda conv_pal, x
        ldy reg_flag
        beq !+
        lda conv_ntsc, x
!:      sta conv_active, x
        sta tmp
        lda #EXTRA_MAX
        sec
        sbc tmp                 // extra = 12 - lost
        lsr                     // A = extra / 2, C = the odd cycle
        sta tmp
        lda #0
        adc #0
        sta odd16, x
        lda #<slide_pal + 6     // six NOPs less extra / 2
        sec
        sbc tmp
        sta entry16, x
        dex
        bpl cv_loop
        lda #0
        .for (var s = 0; s < NSPR; s++) { sta phase + s }
        sta irq_state
        sta b_paused
        sta frame_go
        sta fade_ctr
        sta fade_lvl
        sta msg_pos
        sta acc_main
        sta acc_main + 1
        sta acc_irq
        sta acc_irq + 1
        sta worst
        sta worst + 1
        sta typical
        sta typical + 1
        sta band_max
        sta band_max + 1
        lda #$ff
        sta band_min
        sta band_min + 1
        lda #XSCROLL_INIT
        sta xscroll
        lda #>mask_a
        sta back_page
        rts

// setup: registers, screen, the first frame's table.
setup:
        lda #$1b
        sta $d011
        lda #$c8
        sta $d016
        lda #$15
        sta $d018
        lda #$3f
        sta $dd02
        lda #$c7
        sta $dd00
        lda #BORDER_COL
        sta $d020
        lda #0
        sta $d021
        sta $d017
        sta $d01d
        sta $d01c
        sta $d01b
        lda #%00001111
        sta $d015
        sta spr_ena
        lda #%00001100
        sta $d010               // sprites 2 and 3 past X 255
        lda #<SPR_X_LEFT
        sta $d000
        sta $d002
        lda #<SPR_X_RIGHT
        sta $d004
        sta $d006
        .for (var s = 0; s < NSPR; s++) {
            lda spr_col + s
            sta $d027 + s
        }
        // screen to spaces, colour RAM to black (four pages each)
        lda #32
        ldx #0
!:      sta SCREEN, x
        sta SCREEN + $100, x
        sta SCREEN + $200, x
        sta SCREEN + $300, x
        inx
        bne !-
        lda #0
        ldx #0
!:      sta $d800, x
        sta $d900, x
        sta $da00, x
        sta $db00, x
        inx
        bne !-
        // sprite pointers, after the clear that covered $07F8
        .for (var s = 0; s < NSPR; s++) {
            lda #(SPRITE_BASE / 64) + s
            sta SCREEN + $3f8 + s
        }
        // the scroll row: white, the first 40 characters of the message
        ldx #39
!:      lda scroll_text, x
        sta SCROLL_SCR, x
        lda #1
        sta SCROLL_COL, x
        dex
        bpl !-
        lda #40
        sta msg_pos
        // the first frame's table, adopted here (interrupts are off)
        jsr build_tables
        jsr adopt
        lda #0
        sta irq_state
        sta b_paused
        rts

// fadeout: every FADE_FRAMES frames step the border, the four sprite colours
// and the scroll row's colour cells one luminance down; after FADE_LEVELS
// steps, sprites off (through the shadow, so the band's table follows) and done.
fadeout:
        lda fade_lvl
        cmp #FADE_LEVELS
        bcs fd_done
        inc fade_ctr
        lda fade_ctr
        cmp #FADE_FRAMES
        bcc fd_going
        lda #0
        sta fade_ctr
        inc fade_lvl
        lda $d020
        and #$0f
        tax
        lda lum_down, x
        sta $d020
        .for (var s = 0; s < NSPR; s++) {
            lda $d027 + s
            and #$0f
            tax
            lda lum_down, x
            sta $d027 + s
        }
        ldy #39
!:      lda SCROLL_COL, y
        and #$0f
        tax
        lda lum_down, x
        sta SCROLL_COL, y
        dey
        bpl !-
fd_going:
        lda #0
        rts
fd_done:
        lda #0
        sta spr_ena             // main's next adopt switches the sprites off together with an
                                // empty table; the sequencer's cleanup writes $D015 itself
        lda #1
        rts

// cleanup: the sequencer has removed the part's lines. Wait for line 250,
// then the contract's resting values; both stopwatches stopped.
cleanup:
!:      lda $d011
        bmi !-
!:      lda $d012
        cmp #250
        bne !-
        lda #$1b
        sta $d011
        lda #$c8
        sta $d016
        lda #$15
        sta $d018
        lda #0
        sta $d015
        sta $d020
        sta $d021
        sta $dc0e
        sta $dc0f
        lda #$c7
        sta $dd00
        rts

// selfcheck: the band's count never varied and is the model's constant
// within two cycles; the scroll row's last cell is the character last inserted.
selfcheck:
        lda band_min
        cmp band_max
        bne sc_fail
        lda band_min + 1
        cmp band_max + 1
        bne sc_fail
        ldx reg_flag
        sec
        lda band_min
        sbc band_exp_lo, x
        tay
        lda band_min + 1
        sbc band_exp_hi, x
        bne sc_fail
        cpy #3
        bcs sc_fail
        ldy msg_pos
        bne !+
        ldy #SCROLL_LEN
!:      dey
        lda scroll_text, y
        cmp SCROLL_SCR + 39
        bne sc_fail
        lda #1
        rts
sc_fail:
        lda #0
        rts

}
