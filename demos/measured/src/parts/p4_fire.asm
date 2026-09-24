// p4_fire.asm: part 4 of MEASURED, the FIRE. A port of c64-kb's
// docs/recipes/kickassembler/fire-effect.md (kickassembler-fire-effect):
// screen RAM holds the reverse space (code 160) in every cell so the picture
// is colour RAM alone; a 40 by 25 heat map (0..63) is seeded on its bottom
// row from an 8-bit Galois LFSR (seed $5A, tap $B8), and each cell above
// becomes the mean of the three cells below it and the cell two below, less
// one; a 64-entry luminance-ordered palette maps heat to a VIC colour. The
// kernel (CellEdge, CellX, FireRow), the palette, the seed row and the two
// halves are the recipe's, byte for byte in shape.
//
// Where this module differs from the recipe, and why:
//   - Heat map at $2000 (DESIGN.md gives part 4 that buffer), not $3000;
//     code at P4_CODE = $C000 (api.inc), not $0900; palette and LFSR state
//     sit in the code block, not at $3400.
//   - No $D011 bit-7 wait. The sequencer's line-255 interrupt raises the
//     frame flag and the main loop calls p4.main once per flag. A half pass
//     costs more than one frame (27,301 cycles against a 19,656-cycle PAL
//     frame), so a flag is always raised while a half is running; the stub
//     consumes it and calls main again at once. main compares seq_frame with
//     the frame it recorded when the last half finished: equal means that
//     call is the stale flag raised mid-pass, so main counts it in `skipped`
//     and returns. The next fresh flag runs the other half. That is the
//     recipe's rhythm (each half occupies two frames, the whole screen four)
//     reached through the flag instead of the raster wait.
//   - The CIA1 timer A bracket (one-shot from $FFFF, $DC0E = $19, as the
//     recipe) wraps one half pass per main call. worst is the largest half
//     seen, typical the most recent half. The bracket includes the one
//     sequencer interrupt (dispatcher plus music call) that lands inside
//     every half, which the recipe's free-running measurement did not have.
//     The words hold elapsed cycles ($FFFF less the timer's remaining count),
//     not the raw timer bytes the recipe stored.
//   - The recipe's three timed calls before its main loop are not run; the
//     first two halves of the part are the first two measurements.
//   - The recipe has no fade. Here, once seq_fade is set, the seed row writes
//     0 to every cell instead of the LFSR bit, so nothing feeds the flame;
//     because a pass reads rows already updated below it, one full update
//     (two halves) zeroes the whole buffer. fadeout scans the buffer on the
//     stale-flag frames (the cheap ones), and when it is all zero, or after
//     200 frames, writes colour RAM black, stops main and returns 1.
//   - setup writes every VIC register the contract lists (the recipe wrote
//     $D020 and $D021 only and left the KERNAL's defaults elsewhere).
//   - $DC0D is never read or written here: the sequencer owns the mask.
//
// Zero page: none. All state lives in this code block.
// No interrupts: irq_count = 0. All work is in main.

#importonce

.filenamespace p4

.const DECAY   = 1           // heat lost per row, as the recipe
.const SEED    = $5a         // LFSR seed, never zero
.const HOT     = 63          // heat of a lit seed cell
.const SCREEN  = $0400
.const COLOUR  = $d800
.const HEAT    = $2000       // 25 rows of 40 bytes (DESIGN.md, part 4)
.const FADE_CAP = 200        // frames after which fadeout gives up scanning

* = P4_CODE "p4 fire"

// ---------------------------------------------------------------------------
// Contract tables and words.
// ---------------------------------------------------------------------------
irq_count:   .byte 0
irq_lines:   .byte 0
irq_hi:      .byte 0
irq_lo:      .byte 0
irq_hi_addr: .byte 0
worst:       .word 0
typical:     .word 0

// Part state, quoted by the report.
skipped:     .byte 0         // main calls returned as stale flags (one per half in steady state)
done_frame:  .byte $ff       // seq_frame low byte when the last half finished
half:        .byte 0         // 0 = bottom half next, 1 = top half next
fade_frames: .byte 0         // fadeout calls so far
faded:       .byte 0         // 1 once fadeout has blacked the screen
lfsr:        .byte SEED

// Heat 0..63 to a VIC colour, the recipe's table: black, brown, red, orange,
// light red take eight steps each, yellow and white twelve.
palette:
    .fill 8, 0
    .fill 8, 9
    .fill 8, 2
    .fill 8, 8
    .fill 8, 10
    .fill 12, 7
    .fill 12, 1

// The ten cells selfcheck reads back: (row, column) pairs spread over the
// field, offsets row * 40 + column.
check_lo:
    .byte <(0*40+0), <(0*40+39), <(5*40+20), <(11*40+0), <(12*40+39)
    .byte <(17*40+10), <(23*40+5), <(23*40+38), <(24*40+0), <(24*40+39)
check_hi:
    .byte >(0*40+0), >(0*40+39), >(5*40+20), >(11*40+0), >(12*40+39)
    .byte >(17*40+10), >(23*40+5), >(23*40+38), >(24*40+0), >(24*40+39)

// ---------------------------------------------------------------------------
// The recipe's kernel, unchanged.
// ---------------------------------------------------------------------------
.macro CellEdge(dst, a, b, c, d, cdst) {
    clc
    lda a
    adc b
    adc c
    adc d
    lsr
    lsr
    beq !+
    sec
    sbc #DECAY
!:  sta dst
    tay
    lda palette, y
    sta cdst
}

.macro CellX(r0, r1, r2, cr) {
    clc
    lda r1 - 1, x
    adc r1, x
    adc r1 + 1, x
    adc r2, x
    lsr
    lsr
    beq !+
    sec
    sbc #DECAY
!:  sta r0, x
    tay
    lda palette, y
    sta cr, x
}

.macro FireRow(r) {
    .const r0 = HEAT + r * 40
    .const r1 = HEAT + (r + 1) * 40
    .const r2 = HEAT + min(r + 2, 24) * 40
    .const cr = COLOUR + r * 40
    CellEdge(r0, r1, r1, r1 + 1, r2, cr)
    ldx #1
!loop:
    CellX(r0, r1, r2, cr)
    inx
    cpx #39
    bne !loop-
    CellEdge(r0 + 39, r1 + 38, r1 + 39, r1 + 39, r2 + 39, cr + 39)
}

.macro TimerStart() {
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$19                 // start, one-shot, force load from $FFFF
    sta $dc0e
}

// ---------------------------------------------------------------------------
// prepare: clear the heat map and reset the part's state. No VIC writes.
// ---------------------------------------------------------------------------
prepare:
    lda #0
    tax
!:  sta HEAT, x
    sta HEAT + $100, x
    sta HEAT + $200, x
    sta HEAT + $300, x
    inx
    bne !-
    sta worst
    sta worst + 1
    sta typical
    sta typical + 1
    sta skipped
    sta half
    sta fade_frames
    sta faded
    lda #$ff
    sta done_frame
    sta fade_last_skipped
    lda #SEED
    sta lfsr
    rts

// ---------------------------------------------------------------------------
// setup: every VIC register the contract lists, screen RAM all code 160,
// colour RAM all black. Interrupts are off while this runs.
// ---------------------------------------------------------------------------
setup:
    lda #$1b
    sta $d011
    lda #$c8
    sta $d016
    lda #$15                 // screen $0400, character ROM at $1000 in bank 0
    sta $d018
    lda #$3f
    sta $dd02
    lda #$c7                 // bank 0
    sta $dd00
    lda #0
    sta $d015                // no sprites
    sta $d017
    sta $d01b
    sta $d01c
    sta $d01d
    sta $d010
    sta $d020
    sta $d021
    sta $d025
    sta $d026
    ldx #$0f
!:  sta $d000, x             // sprite positions, all zero
    dex
    bpl !-
    ldx #7
!:  sta $d027, x             // sprite colours, all zero
    dex
    bpl !-
    ldx #0
!:  lda #160                 // reverse space: every pixel takes the cell colour
    sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x
    lda #0
    sta COLOUR, x
    sta COLOUR + $100, x
    sta COLOUR + $200, x
    sta COLOUR + $300, x
    inx
    bne !-
    rts

// ---------------------------------------------------------------------------
// main: one half pass per fresh frame flag; a stale flag is counted and
// skipped (see the header). Bracketed by CIA1 timer A.
// ---------------------------------------------------------------------------
main:
    lda faded
    bne main_out             // the fade has finished: the picture is black and stays so
    lda seq_frame
    cmp done_frame
    bne main_run
    inc skipped              // this flag was raised while the last half was running
main_out:
    rts
main_run:
    TimerStart()
    lda half
    bne main_top
    jsr bottom_half
    lda #1
    sta half
    jmp main_stop
main_top:
    jsr top_half
    lda #0
    sta half
main_stop:
    lda $dc04                // elapsed = $FFFF - remaining = remaining eor $FFFF
    eor #$ff
    sta typical
    lda $dc05
    eor #$ff
    sta typical + 1
    lda seq_frame
    sta done_frame
    // worst = max(worst, typical), 16-bit unsigned
    lda typical + 1
    cmp worst + 1
    bcc main_out
    bne main_new_worst
    lda typical
    cmp worst
    bcc main_out
main_new_worst:
    lda typical
    sta worst
    lda typical + 1
    sta worst + 1
    rts

// Seed row 24: one LFSR step per column, bit 0 of the state lights the cell
// (the recipe's loop, untouched). Once the fade is requested a separate
// loop writes 0 to every cell of the row instead, so nothing feeds the flame.
seed_row:
    lda seq_fade
    bne seed_zero
    ldx #0
!seed:
    lda lfsr
    lsr
    bcc !+
    eor #$b8
!:  sta lfsr
    and #1
    beq !+
    lda #HOT
!:  sta HEAT + 24 * 40, x
    tay
    lda palette, y
    sta COLOUR + 24 * 40, x
    inx
    cpx #40
    bne !seed-
    rts
seed_zero:
    ldx #39
    lda #0
!:  sta HEAT + 24 * 40, x
    sta COLOUR + 24 * 40, x
    dex
    bpl !-
    rts

bottom_half:
    jsr seed_row
    .for (var r = 23; r >= 12; r--) {
        FireRow(r)
    }
    rts

top_half:
    .for (var r = 11; r >= 0; r--) {
        FireRow(r)
    }
    rts

// ---------------------------------------------------------------------------
// fadeout: called after main once seq_fade is set. main has already stopped
// seeding. The heat map is scanned only on the frames where main returned
// on a stale flag (the cheap frames: `skipped` moved since the last scan);
// when the map is all zero, or after FADE_CAP calls, colour RAM is written
// black, main is stopped through `faded`, and A = 1 is returned. Until
// then A = 0.
// ---------------------------------------------------------------------------
fadeout:
    lda faded
    bne fade_done_already
    inc fade_frames
    lda fade_frames
    cmp #FADE_CAP
    bcs fade_black
    lda skipped
    cmp fade_last_skipped    // did main skip this frame? then there is time to scan
    beq fade_running
    sta fade_last_skipped
    // scan 1,000 bytes: four pages of 250 through X
    ldx #0
!:  lda HEAT, x
    ora HEAT + 250, x
    ora HEAT + 500, x
    ora HEAT + 750, x
    bne fade_running
    inx
    cpx #250
    bne !-
fade_black:
    lda #0
    tax
!:  sta COLOUR, x
    sta COLOUR + $100, x
    sta COLOUR + $200, x
    sta COLOUR + $300, x
    inx
    bne !-
    lda #1
    sta faded
fade_done_already:
    lda #1
    rts
fade_running:
    lda #0
    rts
fade_last_skipped: .byte $ff

// ---------------------------------------------------------------------------
// cleanup: stop the stopwatch, wait for raster line 250, leave the
// contract's register values.
// ---------------------------------------------------------------------------
cleanup:
    lda #0
    sta $dc0e                // timer A stopped
!:  lda $d012
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
    lda #$c7
    sta $dd00
    rts

// ---------------------------------------------------------------------------
// selfcheck: for ten fixed cells, colour RAM low nibble == palette[heat].
// Returns A = 1 when all ten agree, else 0. Uses $10/$11 for the cell
// pointer (part zero page).
// ---------------------------------------------------------------------------
.label sc_ptr = part_zp      // $10/$11

selfcheck:
    ldx #9
sc_loop:
    lda check_lo, x
    sta sc_ptr
    lda check_hi, x
    clc
    adc #>HEAT
    sta sc_ptr + 1
    ldy #0
    lda (sc_ptr), y          // heat of the cell
    tay
    lda palette, y
    sta sc_want
    lda sc_ptr + 1
    sec
    sbc #>HEAT
    clc
    adc #>COLOUR
    sta sc_ptr + 1
    ldy #0
    lda (sc_ptr), y          // colour RAM: high nibble undefined
    and #$0f
    cmp sc_want
    bne sc_fail
    dex
    bpl sc_loop
    lda #1
    rts
sc_fail:
    lda #0
    rts
sc_want: .byte 0

.if (* > P4_CODE + $0c00) .error "p4 does not fit its $0C00 block"
