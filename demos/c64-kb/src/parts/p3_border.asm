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
// The DYSP (maxed out 2026-09-24, plan/notes-p3-max.md): EIGHT sprites on
// PAL, each on its own X and Y sine, crossing the whole width and both open
// side borders (sprites 2 to 7 over X 0 to 511, sprites 0 and 1 over 0 to
// 255 because at X 344 their own data fetch cuts them at X 362); Y bases
// 63 + 15k with amplitude 12, so Y runs 51 to 180 and the lowest sprite row
// is line 200. NTSC runs FIVE (0 to 4, bases 63 + 24k): see the layout note
// at Y_SPACING. Shapes: ring, disc, the glyphs C, 6, 4, K, B, a thin ring.
// The band is lines 51 to 200: one DEC $D016 a line whose new value lands on
// cycle 56, followed by a delay read from a 256-entry table indexed by WHICH
// sprites the VIC fetches on that line, so that code plus padding plus
// stall is 63 (65) cycles on every line. The table is built each frame by
// an event-delta pass (build_tables) and the stall per set is the size of
// the union of the sprites' five-cycle BA windows (lostcycles).
//
// Raster bars: three polled colour runs from dispatcher entries, lines 30 to
// 42, 207 to 215 and 247 to 252, a 64-entry gradient rolling a line a frame;
// the last run clears RSEL on 249 and sets it on 252, so the bottom border
// is open and the frame's bottom and the next frame's top show the colours
// across the full width. The write lands a few cycles into each line: the
// left edge of a step is ragged by a character or so, accepted.
//
// The scroller: a 2x2 charset built by prepare from the ROM font into
// $3000 (glyph g becomes g, 64+g, 128+g, 192+g), screen rows 3 and 4 drawn
// on lines 227 to 242 (the band suppresses every badline from 51 to 202, so
// VCBASE stays 0 and line 203 shows row 0). The line-225 interrupt sets
// $D016 = $C8 | xscroll, line 243 restores $C8; main advances the scroll as
// its last act (a shift of both rows when xscroll wraps, a half glyph
// entering at column 39), waiting past the band if it would start after
// line 20, so that main is never running when irq1 fires.
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
//      then adopts it under SEI (try_adopt): the eight Y and X registers,
//      $D010, the loops' page operand and $D015 together, so the band never
//      reads a half-built table or one for other positions. try_adopt waits
//      if the raster is within 38 to 52, 223 to 227 or 251 to 255, because
//      an SEI there once held irq1 or irq2 past the sync and let line 51 be
//      a badline (+26 to +40 cycles in 12 of 884 frames). The top handler
//      (line 28) adopts a table main left behind.
//   4. The cell shift is main's last act; the rows are drawn on 227 to 242
//      and a shift that would begin after line 20 waits for line 202.
//   5. Stopwatch: CIA1 timer A brackets the band (started after the sync,
//      so the count is exact) and every other handler (irq_open/irq_close);
//      CIA1 timer B brackets main, and the interrupts pause it on entry and
//      let it run on from the held count on exit.
//   6. selfcheck reads the band's CIA count: it must never have varied over
//      the run and must equal the model's constant within two cycles; both
//      big rows' last cells must be the half glyph last inserted; and the
//      colour the top bar run last wrote must be the gradient's entry for
//      the roll it recorded (roll or the one before).
//   7. Constant tables are loaded with the PRG into bank 1 at $5000-$5BFF,
//      where no part writes (I-007). Sprite shapes are copied to $3C00 by
//      prepare because the VIC must see them in bank 0; the 2x2 charset is
//      built at $3000. Cold code sits at $5700.
//   8. The body block at $A800 is RAM under BASIC ROM: prepare's first store
//      sets $01 = $36, cleanup puts $37 back; build_font reads the character
//      ROM with $01 = $32 (LORAM clear keeps the body readable).
//
// Memory: code $9920-$9FFF (contract tables, irq1, handler_226 in the first
// page; loop_pal + irq2 at $9A00; loop_ntsc at $9B00; band_done, handlers,
// build_tables, main from $9C00). Bank 1: sine $5000, d011 $5100, mask pages
// $5200 and $5300, small tables and scroll text $5400, slide entries $5600,
// cold code and the gradient $5700, odd flags $5A00, delta page $5B00. Body
// $A800: shapes, conversion tables, X sines, update_x, bar handlers,
// build_font. Bank 0 at run time only: $3000-$37FF charset, $3C00-$3DFF
// shapes, $0400 screen.

#importonce

.namespace p3 {

// --- Constants ---------------------------------------------------------------

.const BAND_TOP    = 51             // first DEC line; the band opens 51 to 200
.const BAND_LINES  = 150
.const IRQ1_LINE   = BAND_TOP - 6   // 45: arms irq2
.const IRQ2_LINE   = BAND_TOP - 3   // 48: the stable entry
.const XS_LINE     = 225            // XSCROLL set: the dispatcher latency puts the write on line 226
.const XR_LINE     = 243            // XSCROLL restore, after both big rows (227 to 242);
                                    // the same handler runs the open-border bars
// Raster bars: three polled runs. No entry may lie in 46 to 201 (the band
// holds the CPU) and none may delay 45, 225 or the sequencer's 255.
.const BAR_TOP_LINE   = 28          // two lines of lead: the dispatch lands a line late
.const BAR_TOP_FIRST  = 30
.const BAR_TOP_FIRST_N = 36         // NTSC: 2,561 fewer cycles a frame
.const BAR_TOP_LAST   = 42
.const BAR_BOT_LINE   = 205         // band_done has returned by then; two lines of lead
.const BAR_BOT_FIRST  = 207
.const BAR_BOT_LAST   = 215         // was 221: NTSC's frame is 2,561 cycles shorter
.const BAR_OPEN_FIRST = 247
.const BAR_OPEN_LAST  = 252         // done before the sequencer's 254
.const OPEN_AT        = 249         // RSEL cleared while 249 and 250 pass
.const CLOSE_AT       = 252         // and set again
.const GRAD_MASK      = 63          // 64 gradient entries
.const NSPR        = 8
.const EXTRA_MAX   = 12             // six NOPs; the odd cycle from the branch
// Eight sprites in one band: the slide pays back at most EXTRA_MAX cycles, and
// the DMA of a set spanning more than four consecutive sprites costs more than
// that (5 + 2 * 4 = 13). PAL: Y bases 15 apart with amplitude 12 keep sprites
// k and k + 3 from ever sharing a line (45 > 2 * 12 + 20), so every set is
// consecutive sprites, three at most, and stalls 9 or fewer: the sets the
// window rule was measured exact on (884 frames). With k and k + 3 allowed
// (amplitude 15, spacing 14) two frames in 792 read +5 and +6: a set with a
// gap of two whose single free BA cycle meets a write of the loop regains
// nothing, so the gap discount is not general. NTSC: FIVE sprites, 0 to 4,
// bases 24 apart, sprites 5 to 7 off and parked out of the band. Eight on
// NTSC met one-cycle stalls the rule does not give (first {4, 5}, then three
// other sets once {4, 5} was designed out), each at one alignment only, so
// no table entry meets them. See plan/notes-p3-max.md. The loop is not read.
.const Y_SPACING   = 15
.const Y_AMP       = 12
.const Y_BASE0     = BAND_TOP + Y_AMP   // 63: the top sprite's highest line is 51
.const NSPR_NTSC   = 5
.const Y_SPACING_N = 24                 // 63, 87, 111, 135, 159: the lowest row is 191
.errorif Y_BASE0 + (NSPR_NTSC - 1) * Y_SPACING_N + Y_AMP + 20 > BAND_TOP + BAND_LINES - 1, "NTSC bottom sprite leaves the band"
// Sync and entry pads, all four set from the monitor (plan/notes-p3-fix.md):
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
.const SCROLL_SCR2 = SCREEN + (SCROLL_MEM_ROW + 1) * 40    // the lower halves, lines 235 to 242
.const SCROLL_COL2 = $d800 + (SCROLL_MEM_ROW + 1) * 40
.const D018_BIG    = $1c            // screen $0400, characters at BIGFONT ($3000)
.const SPRITE_BASE = $3c00          // pointers $F0-$F3
.const SPR_X_RIGHT = 344
.const SPR_X_LEFT  = 0
.const BORDER_COL  = 11             // dark grey: the open band shows the black background
.const XSCROLL_INIT = 4             // 300 steps later the standalone freeze lands on 0, so the pinned row is cell-aligned

// Bank 1 data, loaded with the PRG; nothing else writes $5000-$5BFF.
.const sine_tab    = $5000          // 256 bytes, amplitude Y_AMP
.const d011_tab    = $5100          // 256 bytes, YSCROLL per band index
.const mask_a      = $5200          // per-line sprite set, page A
.const mask_b      = $5300          // page B
.const PAGE_XOR    = (mask_a >> 8) ^ (mask_b >> 8)   // 1: swaps the two page numbers
.const small_tabs  = $5400          // conversions, sprite constants, scroll text
.const entry_page  = $5600          // 256 slide entries, one per sprite set (was the shapes)
.const COLD_CODE   = $5700          // prepare, setup, fadeout, cleanup, selfcheck
.const odd_page    = $5a00          // 256 odd-cycle flags, one per sprite set
.const delta_page  = $5b00          // build_tables' enter and leave events
.const COLD_END    = odd_page       // the cold code must stop short of it
// The delta build indexes entries 1 to 150 only: every Y must lie in 51 to 179.
.errorif Y_BASE0 - Y_AMP < BAND_TOP, "top sprite can leave the band upwards"
.errorif Y_BASE0 + (NSPR - 1) * Y_SPACING + Y_AMP + 21 > BAND_TOP + BAND_LINES, "bottom sprite can leave the band downwards"
// Max-out block: 2 KB under BASIC ROM (prepare's first store sets $01 = $36;
// cleanup puts $37 back). Shape sources, conversion tables, X sines, bars.
.const HI_CODE     = $a800
.const HI_CODE_END = $b000
.const BIGFONT     = $3000          // 2x2 charset built by prepare from the ROM font

// --- Assembly-time functions (recipe) ---------------------------------------

// CPU cycles lost after the DEC to the sprite DMA of the sprites in mask m:
// p-access slots 58, 60, 62, then 1, 3, 5, 7, 9 of the next line (PAL; NTSC
// 60, 62, 64, 1, 3, 5, 7, 9). Each fetched sprite holds BA low for five
// cycles, from three before its slot to one after, and the lost count is
// the size of the UNION of those windows, less the DEC's two write cycles
// that run on under BA when sprite 0 is in the set (one on NTSC). For sets
// with no gap of two this is the recipe's 3 + 2l / 5 + 2(l - f); a set such
// as {3, 6} leaves BA high for one cycle between the windows and costs one
// less, which the span rule missed (measured: -1 a line, 55 of 884 frames).
// Sets the Y layout cannot produce (span over four) would cost more than
// the slide can pay; their entries are clamped to EXTRA_MAX.
.function lostcycles(m, ntsc) {
    .if (m == 0) .return 0
    .var low = 0
    .for (var n = 0; n < 8; n++) { .if (((m >> n) & 1) == 1) .eval low = low | (%11111 << (2 * n)) }
    .var c = 0
    .for (var b = 0; b < 24; b++) { .if (((low >> b) & 1) == 1) .eval c++ }
    .if ((m & 1) == 1) .eval c = c - (ntsc ? 1 : 2)
    // Not in this table, by construction of the Y layout: {4, 5} on NTSC.
    // Measured with a store trace on $D016, it costs one cycle less than its
    // window when the loop pads it as 7 at the standard phase (the DEC moved
    // from 56 to 55 and stayed), and padding it as 6 or entering it a cycle
    // late made it cost the full 7 again (the DEC moved to 57 and stayed).
    // A one-cycle gift that exists at one alignment only cannot be met by a
    // table entry, so the layout keeps sprites 4 and 5 apart instead. The
    // mechanism is not established; the loop is not read here.
    .return min(c, EXTRA_MAX)
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

// A thinner ring, and a filled disc.
.function thinringbyte(row, col) {
    .var v = 0
    .for (var b = 0; b < 8; b++) {
        .var dx = (col * 8 + b - 11.5) / 11.5
        .var dy = (row - 10) / 10
        .var d = dx * dx + dy * dy
        .if (d <= 1.0 && d >= 0.72) .eval v = v | (128 >> b)
    }
    .return v
}
.function discbyte(row, col) {
    .var v = 0
    .for (var b = 0; b < 8; b++) {
        .var dx = (col * 8 + b - 11.5) / 11.5
        .var dy = (row - 10) / 10
        .if (dx * dx + dy * dy <= 0.85) .eval v = v | (128 >> b)
    }
    .return v
}

// A glyph drawn as a 6x7 cell pattern, each cell 4 pixels wide and 3 lines
// tall, so the sprite is 24x21. The pattern is one string of 42 characters.
.function glyphbyte(pat, row, col) {
    .var v = 0
    .var sub = floor(row / 3)
    .for (var b = 0; b < 8; b++) {
        .var gx = floor((col * 8 + b) / 4)
        .if (pat.charAt(sub * 6 + gx) == '#') .eval v = v | (128 >> b)
    }
    .return v
}
.const GLYPH_C = ".####." + "#....#" + "#....." + "#....." + "#....." + "#....#" + ".####."
.const GLYPH_6 = ".####." + "#....." + "#....." + "#####." + "#....#" + "#....#" + ".####."
.const GLYPH_4 = "#....#" + "#....#" + "#....#" + "######" + ".....#" + ".....#" + ".....#"
.const GLYPH_K = "#....#" + "#...#." + "#..#.." + "###..." + "#..#.." + "#...#." + "#....#"
.const GLYPH_B = "#####." + "#....#" + "#....#" + "#####." + "#....#" + "#....#" + "#####."

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
.label spr_y_new = $2a              // 8 bytes, the frame main built
.label ptr       = $32
.label tmp       = $34
.label spr_ena   = $35              // $D015 shadow: $FF, or 0 once the fade has switched the sprites off
.label phase     = $36              // 8 bytes, the Y sine phases
.label xphase    = $3e              // 8 bytes, the X sine phases
.label spr_x_new = $46              // 8 bytes, X low bytes main built
.label spr_x_msb = $4e              // their $D010 byte
.label tab_ready = $4f              // main has built a table the 236 handler has not adopted yet
.label bar_roll  = $50              // gradient entry of the top run's first line
.label bars_on   = $51              // 0 once the fade has started: the runs write nothing
.label bar_seen  = $52              // the colour the top run last wrote on its first line
.label bar_idx   = $53              // and the gradient entry it took it from
.label half      = $54              // 0: the next half glyph to enter is a left one
.label bf_y      = $55              // build_font's row
.label dst       = $56              // build_font's destination pointer (2 bytes)
.label spr_base  = $58              // 8 bytes, the model's Y bases (prepare copies them)
.label ta_wait   = $60              // try_adopt waits (1) or defers (0) near a sensitive line
.label bars_side = $61              // $80: the runs write $D020 too; 0 after selfcheck

// --- Bank 1 tables ----------------------------------------------------------

* = sine_tab "p3 sine"
    .fill 256, (round(Y_AMP * sin(toRadians(i * 360 / 256))) + 256) & 255

* = d011_tab "p3 d011"
    .fill 256, $18 | ((BAND_TOP + i + 4) & 7)

* = mask_a "p3 mask_a"
    .fill 256, 0

* = mask_b "p3 mask_b"
    .fill 256, 0

* = small_tabs "p3 tables"
spr_base_pal:  .fill NSPR, Y_BASE0 + i * Y_SPACING          // 63, 78, ... 168
spr_base_ntsc: .fill NSPR, (i < NSPR_NTSC) ? Y_BASE0 + i * Y_SPACING_N : 0   // 0: parked, index out of the pass
ena_tab:       .byte %11111111, %00011111
spr_speed:   .byte 2, 3, 5, 7, 3, 2, 6, 4
xspeed:      .byte 2, 3, 1, 2, 3, 1, 2, 3
spr_col:     .byte 1, 7, 3, 13, 10, 14, 15, 5
lum_down:    .byte 0, 7, 9, 10, 11, 12, 0, 15, 4, 6, 14, 2, 8, 3, 5, 13
band_exp_lo: .byte <BAND_CYC_PAL, <BAND_CYC_NTSC
band_exp_hi: .byte >BAND_CYC_PAL, >BAND_CYC_NTSC
.encoding "screencode_upper"
scroll_text:
    .text "C64-KB   PART THREE: BORDER   EIGHT SPRITES CROSS THE OPEN SIDE BORDERS ON A DYSP: ONE DEC OF D016 A LINE AND A STALL TABLE BUILT FROM THE SPRITE SET   RASTER BARS THROUGH THE OPEN BOTTOM BORDER   2X2 SOFT SCROLL FROM THE ROM FONT   "
scroll_end:
.encoding "petscii_mixed"
.const SCROLL_LEN = scroll_end - scroll_text
.if (SCROLL_LEN > 255) .error "scroll text longer than 255 bytes: msg_pos is one byte"

// The two 256-entry per-set tables the band loops index by the mask byte.
* = entry_page "p3 entry"
entry16:     .fill 256, 0
* = odd_page "p3 odd"
odd16:       .fill 256, 0
* = delta_page "p3 delta"
             .fill 256, 0

// --- First page $9920-$99FF: contract tables, irq1, handler_226 -------------

* = P3_CODE "p3 code"

irq_count:   .byte 5
irq_lines:   .byte BAR_TOP_LINE, IRQ1_LINE, BAR_BOT_LINE, XS_LINE, XR_LINE
irq_hi:      .byte 0, 0, 0, 0, 0
irq_lo:      .byte <handler_top, <irq1_handler, <handler_bar_bot, <handler_226, <handler_243
irq_hi_addr: .byte >handler_top, >irq1_handler, >handler_bar_bot, >handler_226, >handler_243
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

// irq_open / irq_close: the bracket every bar handler uses. Main's
// stopwatch pauses, timer A times the handler, acc_irq takes the count.
irq_open:
        jsr pause_b
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$11
        sta $dc0e
        rts
irq_close:
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
        jmp resume_b
first_page_end:
.errorif first_page_end > $9a00, "p3 first page reaches loop_pal"

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

// handler_243: XSCROLL back to the resting value now that both big rows
// (227 to 242) are drawn, then the open-border bar run 246 to 252.
handler_243:
        lda #$c8
        sta $d016
        jsr irq_open
        ldx #BAR_OPEN_FIRST
        ldy #BAR_OPEN_LAST
        lda bar_roll
        clc
        adc #(BAR_OPEN_FIRST - BAR_TOP_FIRST)
        jsr bar_run
        jmp irq_close

// handler_top (line 28): adopt the table main built if main left it for us
// (main adopts under SEI itself unless it ended near a line whose interrupt
// must not wait), then the top bar run 30 to 42. Must be done by 45.
handler_top:
        jsr irq_open
        lda tab_ready
        beq ht_bars
        jsr adopt
        lda #0
        sta tab_ready
ht_bars:
        lda bar_roll
        sta bar_idx             // for selfcheck: the entry the first line took
        tay
        lda gradient, y
        sta bar_seen
        ldx #BAR_TOP_FIRST
        lda reg_flag
        beq !+
        ldx #BAR_TOP_FIRST_N    // NTSC: a shorter run, see BAR_BOT_LAST
!:      ldy #BAR_TOP_LAST
        lda bar_roll
        jsr bar_run
        jmp irq_close
// build_tables: Y from the sines into spr_y_new, then the back page: clear
// entries 1 to BAND_LINES and OR each sprite's bit into the 21 entries from
// its Y line. Entry j stands for line 50 + j, the loop's X after its INX.
// Raster bars: three polled colour runs, one dispatcher entry each, one
// gradient entry a line from (line + roll); main moves roll a step a frame
// so the pattern flows down a line a frame. The write lands a few cycles
// into the line, so each step's left edge is ragged by a character or so;
// accepted. The third run also opens the bottom border: RSEL cleared while
// 249 and 250 pass, set again on 252, so the frame's bottom and the next
// frame's top show the colours across the full width. Each run is
// bracketed like the 236 handler; none writes once the fade has begun.
// The code is in the body block under BASIC ROM: the routines block reached
// $A000 with them here.

// irq_open / irq_close are in the first code page (this block is full).

// Eight sprites made the per-sprite OR loops cost about 5,000 cycles a
// frame; this build drops an enter event at each sprite's first entry and a
// leave event 21 on into the delta page, EORs the running set through the
// 150 entries in one pass, then drops the same events again to clear them.
build_tables:
        jsr update_x
        lda back_page
        .for (var u = 0; u < 5; u++) { sta bt_unit + 7 * u + 5 }
        .for (var s = 0; s < NSPR; s++) {
            ldx phase + s
            lda sine_tab, x
            clc
            adc spr_base + s
            sta spr_y_new + s
        }
        lda spr_ena
        beq bt_pass             // sprites off: no events, the pass writes zeros
        jsr bt_events
bt_pass:
        lda #0
        ldy #1
bt_unit:
        .for (var u = 0; u < 5; u++) {
            eor delta_page, y
            sta mask_a, y       // page byte patched above
            iny
        }
        cpy #BAND_LINES + 1
        bne bt_unit
        lda spr_ena
        beq bt_done
        jsr bt_events           // the same EORs clear the slots
bt_done:
        rts

// bt_events: toggle each sprite's bit at its enter and leave entries.
bt_events:
        .for (var s = 0; s < NSPR; s++) {
            lda spr_ena
            and #(1 << s)
            beq !+              // a sprite that is off (NTSC parks three) drops no event
            lda spr_y_new + s
            sec
            sbc #(BAND_TOP - 1)
            tay
            lda delta_page, y
            eor #(1 << s)
            sta delta_page, y
            tya
            clc
            adc #21
            tay
            lda delta_page, y
            eor #(1 << s)
            sta delta_page, y
        !:
        }
        rts

// adopt: the table just built becomes the band's, with the Y positions and
// the sprite enable it was built for. Interrupts must be off around it.
adopt:
        .for (var s = 0; s < NSPR; s++) {
            lda spr_y_new + s
            sta $d001 + 2 * s
            lda spr_x_new + s
            sta $d000 + 2 * s
        }
        lda spr_x_msb
        sta $d010
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
        lda bars_on
        beq !+
        lda bar_roll            // the bars flow down a line a frame
        sec
        sbc #1
        and #GRAD_MASK
        sta bar_roll
!:      lda tab_ready           // a table deferred last frame: adopt it now (main has
        beq !+                  // just been called, far from 45) rather than skip
        lda #1
        sta ta_wait
        jsr try_adopt
!:      lda #0
        sta ta_wait
        .for (var s = 0; s < NSPR; s++) {
            lda phase + s
            clc
            adc spr_speed + s
            sta phase + s
        }
        jsr build_tables
        jsr try_adopt
mn_built:
        // The scroll step last: a pixel a frame, and when xscroll wraps a
        // cell shift of both rows (about 700 cycles; a half glyph enters at
        // column 39, left then right). Main must not be running when irq1
        // fires at 45: the double IRQ's fallback then raced the real irq2
        // (+4 to +11 on the band count in 4 of 792 frames). The rows are
        // drawn on 227 to 242, so a shift that would start past line 20
        // waits for the band to end, main's stopwatch held meanwhile.
        lda xscroll
        beq mn_carry
        dec xscroll
        jmp mn_scrolled
mn_carry:
        lda $d011
        bmi mn_shift
        lda $d012
        cmp #20
        bcc mn_shift
        cmp #202
        bcs mn_shift
        lda #0
        sta $dc0f
!:      lda $d012
        cmp #202
        bcc !-
        lda #$01
        sta $dc0f
mn_shift:
        lda #7
        sta xscroll
        ldy #0
!:      lda SCROLL_SCR + 1, y
        sta SCROLL_SCR, y
        lda SCROLL_SCR2 + 1, y
        sta SCROLL_SCR2, y
        iny
        cpy #39
        bne !-
        ldy msg_pos
        lda scroll_text, y
        ldx half
        beq mn_left
        ora #64
        iny
        cpy #SCROLL_LEN
        bcc mn_left
        ldy #0
mn_left:
        sty msg_pos
        sta SCROLL_SCR + 39
        ora #128
        sta SCROLL_SCR2 + 39
        lda half
        eor #1
        sta half
mn_scrolled:
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

// try_adopt: adopt under SEI, waiting first if the raster is near a line
// whose interrupt must not wait: irq1 and irq2 (45 to 49), the XSCROLL set
// (225) or the sequencer's 255. The wait is at most 15 lines and holds no
// interrupt off; if the band interrupts it, the adopt follows the band.
// (An SEI of main's near 45 once held the sync and let line 51 be a
// badline: +26 to +40 cycles in 12 of 884 frames. Deferring instead of
// waiting made the next main skip its build when it started in the same
// window: 8 of 219 NTSC frames.)
// (try_adopt itself is in the body block: the routines block is full.)

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
        lda #$36                // BASIC ROM out: the body at $A800 is RAM from here on
        sta $01
        jsr detect_region
        ldx #0
!:      lda shapes_src, x
        sta SPRITE_BASE, x
        lda shapes_src + $100, x
        sta SPRITE_BASE + $100, x
        inx
        bne !-
        jsr build_font
        // mask -> lost cycles -> slide entry and odd cycle (recipe conv_loop),
        // for all 256 sets
        ldx #0
cv_loop:
        lda conv_pal, x
        ldy reg_flag
        beq !+
        lda conv_ntsc, x
!:      sta tmp
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
        inx
        bne cv_loop
        .for (var s = 0; s < NSPR; s++) { lda #(s * 32); sta xphase + s }
        ldx #NSPR - 1           // the model's Y bases
!:      lda spr_base_pal, x
        ldy reg_flag
        beq !+
        lda spr_base_ntsc, x
!:      sta spr_base, x
        dex
        bpl !--
        lda #0
        .for (var s = 0; s < NSPR; s++) { sta phase + s }
        sta irq_state
        sta b_paused
        sta frame_go
        sta tab_ready
        sta bar_roll
        sta bars_on
        sta bar_seen
        sta bar_idx
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
        lda #D018_BIG
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
        ldx reg_flag
        lda ena_tab, x          // eight on PAL, five on NTSC
        sta $d015
        sta spr_ena
        // X, Y and $D010 come from the adopt below
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
        // the two big rows: white, the first 20 glyphs of the message, each
        // as its left and right halves
        ldx #39
!:      txa
        lsr                     // glyph index; C = the half
        tay
        lda scroll_text, y
        bcc !+
        ora #64
!:      sta SCROLL_SCR, x
        ora #128
        sta SCROLL_SCR2, x
        lda #1
        sta SCROLL_COL, x
        sta SCROLL_COL2, x
        dex
        bpl !--
        lda #20
        sta msg_pos
        lda #0
        sta half
        // the first frame's table, adopted here (interrupts are off)
        jsr build_tables
        jsr adopt
        lda #1
        sta bars_on
        lda #$80
        sta bars_side
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
        bcc !+
        jmp fd_done
!:      inc fade_ctr
        lda fade_ctr
        cmp #FADE_FRAMES
        bcc fd_going
        lda #0
        sta fade_ctr
        sta bars_on             // the bars go out at the first step; the border
                                // is the fade's from here (the runs last wrote 11)
        inc fade_lvl
        lda $d020
        and #$0f
        tax
        lda lum_down, x
        sta $d020
        ldy #NSPR - 1
!:      lda $d027, y
        and #$0f
        tax
        lda lum_down, x
        sta $d027, y
        dey
        bpl !-
        ldy #79                 // both big rows' colour cells are contiguous
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
        lda #$37                // BASIC ROM back in
        sta $01
        rts

// selfcheck: the band's count never varied and is the model's constant
// within two cycles; the scroll row's last cell is the character last inserted.
selfcheck:
        lda #0                  // from here the bars paint $D021 only: a runner that
        sta bars_side           // puts its verdict on $D020 after this call keeps it (the
                                // standalone stub freezes with the interrupts running)
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
        // the top row's last cell is the half glyph last inserted, the
        // bottom row's its lower half
        ldy msg_pos
        lda half
        bne sc_lefthalf         // a left half went in last: text[msg_pos]
        tya
        bne !+
        ldy #SCROLL_LEN
!:      dey
        lda scroll_text, y
        ora #64
        bne sc_cmp              // always
sc_lefthalf:
        lda scroll_text, y
sc_cmp:
        cmp SCROLL_SCR + 39
        bne sc_fail
        ora #128
        cmp SCROLL_SCR2 + 39
        bne sc_fail
        // the top bar run kept the entry its first line took and the colour
        // it wrote: the entry is roll or the one before, the colour the table's
        lda bar_idx
        sec
        sbc bar_roll
        and #GRAD_MASK
        cmp #2
        bcs sc_fail
        ldy bar_idx
        lda gradient, y
        cmp bar_seen
        bne sc_fail
        lda #1
        rts
sc_fail:
        lda #0
        rts

// The bar gradient: four 16-line bars, blue, red, green and grey, in bank 1
// so that selfcheck can read it after cleanup has put BASIC ROM back.
gradient:
        .byte 0, 6, 6, 14, 14, 3, 1, 1, 3, 14, 14, 6, 6, 0, 0, 0
        .byte 0, 2, 2, 10, 10, 7, 1, 1, 7, 10, 10, 2, 2, 0, 0, 0
        .byte 0, 5, 5, 13, 13, 7, 1, 1, 7, 13, 13, 5, 5, 0, 0, 0
        .byte 0, 11, 11, 12, 12, 15, 1, 1, 15, 12, 12, 11, 11, 0, 0, 0
cold_end:
.errorif cold_end > COLD_END, "p3 cold code reaches the odd page at $5A00"

// --- Body: RAM under BASIC ROM, readable once prepare has set $01 = $36 -----
// Nothing here runs before prepare; $B000-$BFFF is not ours.

* = HI_CODE "p3 body"
body_start:
// The eight shape sources, copied to SPRITE_BASE by prepare: ring, disc,
// C, 6, 4, K, B, thin ring.
shapes_src:
    .for (var r = 0; r < 21; r++) { .byte ringbyte(r, 0), ringbyte(r, 1), ringbyte(r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte discbyte(r, 0), discbyte(r, 1), discbyte(r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte glyphbyte(GLYPH_C, r, 0), glyphbyte(GLYPH_C, r, 1), glyphbyte(GLYPH_C, r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte glyphbyte(GLYPH_6, r, 0), glyphbyte(GLYPH_6, r, 1), glyphbyte(GLYPH_6, r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte glyphbyte(GLYPH_4, r, 0), glyphbyte(GLYPH_4, r, 1), glyphbyte(GLYPH_4, r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte glyphbyte(GLYPH_K, r, 0), glyphbyte(GLYPH_K, r, 1), glyphbyte(GLYPH_K, r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte glyphbyte(GLYPH_B, r, 0), glyphbyte(GLYPH_B, r, 1), glyphbyte(GLYPH_B, r, 2) }
    .byte 0
    .for (var r = 0; r < 21; r++) { .byte thinringbyte(r, 0), thinringbyte(r, 1), thinringbyte(r, 2) }
    .byte 0
// Lost cycles per sprite set, one table per model; prepare converts them.
conv_pal:    .fill 256, lostcycles(i, false)
conv_ntsc:   .fill 256, lostcycles(i, true)
// X sine, 1 to 511, split in two bytes.
xsin_lo:     .fill 256, <(256 + round(255 * sin(toRadians(i * 360 / 256))))
xsin_hi:     .fill 256, >(256 + round(255 * sin(toRadians(i * 360 / 256))))

// update_x: advance the eight X phases and take the X positions from the
// sine: sprites 2 to 7 over the full 0 to 511, sprites 0 and 1 over 0 to
// 255 (the same sine halved) so that their own fetch never cuts them.
// Called by build_tables; adopt writes the results.
update_x:
        lda #0
        sta spr_x_msb
        .for (var s = 0; s < NSPR; s++) {
            lda xphase + s
            clc
            adc xspeed + s
            sta xphase + s
            tax
            .if (s < 2) {
                lda xsin_hi, x
                lsr
                lda xsin_lo, x
                ror
                sta spr_x_new + s
            } else {
                lda xsin_lo, x
                sta spr_x_new + s
                lda xsin_hi, x
                beq !+
                lda spr_x_msb
                ora #(1 << s)
                sta spr_x_msb
            !:
            }
        }
        rts

// The bottom raster bar handler and the run (the top and open runs are in
// handler_top and handler_243 in the routines block).
handler_bar_bot:
        lda reg_flag            // NTSC has 2,561 fewer cycles a frame and held one
        bne br_done             // frame in five with this run: no bottom run there
        jsr irq_open
        ldx #BAR_BOT_FIRST
        ldy #BAR_BOT_LAST
        lda bar_roll
        clc
        adc #(BAR_BOT_FIRST - BAR_TOP_FIRST)
        jsr bar_run
        jmp irq_close

// bar_run: X = first line, Y = last, A = gradient entry of the first line.
bar_run:
        iny                     // the loop runs while X != last + 1
        sty br_last + 1
        and #GRAD_MASK
        sta br_idx + 1
        lda bars_on
        beq br_done
br_loop:
        cpx $d012               // wait while the raster is short of X; an
        beq br_go               // equality wait missed 207 after the dispatch
        bcs br_loop             // latency and spun a whole frame (measured)
br_go:
br_idx: ldy #0
        lda gradient, y
        bit bars_side           // clear after selfcheck: $D020 is a runner's verdict then
        bpl !+
        sta $d020
!:      sta $d021
        iny
        tya
        and #GRAD_MASK
        sta br_idx + 1
        cpx #OPEN_AT
        bne !+
        lda $d011
        and #%11110111
        sta $d011
!:      cpx #CLOSE_AT
        bne !+
        lda $d011
        ora #%00001000
        sta $d011
!:      inx
br_last:
        cpx #0
        bne br_loop
        lda #BORDER_COL         // the rest of the frame keeps the resting look
        bit bars_side
        bpl !+
        sta $d020
!:      lda #0
        sta $d021
br_done:
        rts

// build_font: the 2x2 charset at BIGFONT from the ROM font's first 64
// glyphs. Character ROM in with $01 = $32 (I/O out, so interrupts are
// masked; LORAM clear keeps this body readable), $36 back after. Glyph g
// becomes codes g (top left), 64 + g (top right), 128 + g (bottom left)
// and 192 + g (bottom right): each source row doubled in both directions.
build_font:
        sei
        lda #$32
        sta $01
        lda #0
        sta ptr
        sta dst
        lda #$d0
        sta ptr + 1
        lda #>BIGFONT
        sta dst + 1
        lda #64
        sta tmp
bf_glyph:
        ldy #7
bf_row:
        lda (ptr), y
        pha
        lsr
        lsr
        lsr
        lsr
        tax
        lda dbl_tab, x
        jsr bf_store            // left half to the left char
        pla
        and #15
        tax
        lda dbl_tab, x
        inc dst + 1             // the right chars sit $200 on
        inc dst + 1
        jsr bf_store
        dec dst + 1
        dec dst + 1
        dey
        bpl bf_row
        lda ptr
        clc
        adc #8
        sta ptr
        bcc !+
        inc ptr + 1
!:      lda dst
        clc
        adc #8
        sta dst
        bcc !+
        inc dst + 1
!:      dec tmp
        bne bf_glyph
        lda #$36
        sta $01
        cli
        rts

// bf_store: A = the doubled byte, Y = the source row. Rows 0 to 3 go to
// the top char, 4 to 7 to the bottom one ($400 on), each twice.
bf_store:
        sty bf_y
        pha
        tya
        and #3
        asl
        tay
        lda bf_y
        cmp #4
        bcc bf_top
        inc dst + 1
        inc dst + 1
        inc dst + 1
        inc dst + 1
        pla
        sta (dst), y
        iny
        sta (dst), y
        dec dst + 1
        dec dst + 1
        dec dst + 1
        dec dst + 1
        ldy bf_y
        rts
bf_top:
        pla
        sta (dst), y
        iny
        sta (dst), y
        ldy bf_y
        rts

try_adopt:
        lda $d011
        bmi ta_adopt            // 256 up: the 255 interrupt has fired (main is called on its flag)
        lda $d012
        cmp #38
        bcc ta_adopt
        cmp #53
        bcc ta_defer
        cmp #223
        bcc ta_adopt
        cmp #228
        bcc ta_defer
        cmp #251
        bcc ta_adopt
ta_defer:
        lda ta_wait             // at main's start: spin until the raster has left the
        bne try_adopt           // window (at most 15 lines); at its end: leave the
        lda #1                  // table for the top handler at 28, which is when the
        sta tab_ready           // band would first see it anyway
        rts
ta_adopt:
        sei
        jsr adopt
        cli
        lda #0
        sta tab_ready
        rts

// Each nibble's four pixels doubled to eight.
dbl_tab:
        .fill 16, (((i & 8) != 0) ? $c0 : 0) | (((i & 4) != 0) ? $30 : 0) | (((i & 2) != 0) ? $0c : 0) | (((i & 1) != 0) ? $03 : 0)

body_end:
.errorif body_end > HI_CODE_END, "p3 body overruns $B000"

}
