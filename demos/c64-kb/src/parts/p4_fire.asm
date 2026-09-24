// p4_fire.asm: part 4 of MEASURED, the FIRE, maxed out.
//
// The fire: screen RAM holds the reverse space (code 160) in every cell so the
// picture is colour RAM alone; a 40 by 25 heat map (0..63) at $2000 is seeded
// on its bottom row from an 8-bit Galois LFSR (seed $5A, tap $B8), and each
// cell above becomes the mean of the three cells below it and the cell two
// below, less one; a 64-entry luminance-ordered palette maps heat to a VIC
// colour. The kernel (CellEdge, CellX, FireRow), the seed row and the two
// halves are the fire recipe's, byte for byte in shape.
//
// The rhythm: no $D011 bit-7 wait. The sequencer's line-255 interrupt raises
// the frame flag and the main loop calls p4.main once per flag. A half pass
// costs more than one frame, so a flag is always raised while a half runs;
// main compares seq_frame with the frame it recorded when the last half
// finished: equal means this call is the stale flag raised mid-pass, counted
// in `skipped` and returned at once. The next fresh flag runs the other half,
// so each half occupies two frames and the whole screen four.
//
// On top of the fire, three things:
//   - A SPRITE CHAIN: six hires sprites spelling C 6 4 - K B, one bright
//     colour, follow one another along a Lissajous path in the upper third
//     of the screen (X from the sine at the chain phase, Y from the sine at
//     twice it, so Y stays in 64..127). One raster interrupt at line 20 moves
//     the phase and writes six X, six Y and the MSB byte before any sprite
//     fetches. Each sprite trails the one before by CHAIN_GAP phase steps.
//   - A PALETTE WAVE: four 64-entry palettes, each luminance-ordered from
//     black to white through a different hue family. Every PAL_PERIOD frames
//     the next one is copied over the kernel's table at a bottom-half
//     boundary; the fire redraws bottom-up over four frames, so the switch
//     climbs the flames as a wave. That wave is the effect, not a flaw.
//   - A LUMINANCE DISSOLVE for the fade: when seq_fade is set the fire
//     freezes (no more passes) and every frame visits N cells in the order of
//     a maximal 10-bit LFSR (x^10 + x^7 + 1, period 1,023; values 1,000 and
//     above are skipped, and cell 0, which no LFSR state names, is visited
//     each time the seed recurs). Each visit steps the cell's colour RAM
//     nibble three places down the luminance order. N is 60 on PAL and 50 on
//     NTSC, told apart by counting raster lines once in prepare. The sprites
//     step down the same table through their colour registers every eight
//     frames and switch off at black. fadeout returns 1 when no lit cell is
//     left and the sprites are off, or forces black at FADE_CAP frames.
//
// Memory: the $C000 block keeps the contract words, the kernel, the seed
// row, main, the sprite interrupt, cleanup and the selfcheck entry, all of
// which may run whatever $01 says. Everything else, tables, sprite shapes and
// the slower paths, sits in $A000-$A7FF under BASIC ROM: prepare's first
// instruction sets $01 = $36 and cleanup's last write restores $37. The
// sprite shapes are copied to $3000 in bank 0 (pointers $C0..$C5).
//
// The CIA1 timer A bracket (one-shot from $FFFF) wraps one half pass per
// main call; worst is the largest half seen, typical the most recent. The
// bracket includes the one sequencer interrupt (dispatcher plus music) that
// lands inside every half, and now the sprite DMA of the six sprites. The
// palette copy runs outside it. A second bracket wraps the dissolve
// (dissolve_cost, dissolve_worst), reported in the notes only.
//
// Zero page $10..$18. One interrupt: irq_count = 1, line CHAIN_LINE.
// $DC0D is never read or written here: the sequencer owns the mask.

#importonce

.filenamespace p4

.const DECAY        = 1          // heat lost per row
.const SEED         = $5a        // 8-bit seed-row LFSR, never zero
.const HOT          = 63         // heat of a lit seed cell
.const SCREEN       = $0400
.const COLOUR       = $d800
.const HEAT         = $2000      // 25 rows of 40 bytes
.const FADE_CAP     = 200        // fadeout calls after which black is forced
.const P4_EXTRA     = $a000      // 2 KB under BASIC ROM
.const P4_EXTRA_END = $a800
.const SHAPES       = $3000      // six sprite shapes in bank 0
.const SHAPE_PTR    = SHAPES / 64
.const CHAIN_LINE   = 20         // the one raster interrupt
.const CHAIN_GAP    = 14         // phase steps between neighbours in the chain
.const CHAIN_SPEED  = 2          // phase steps per frame
.const CHAIN_COLOUR = 7          // yellow
.const PAL_PERIOD   = 200        // frames between palette switches
.const LFSR_SEED    = $02a5      // 10-bit dissolve seed, never zero
.const LFSR_PERIOD  = 1023
.const DISSOLVE_PAL = 60         // cells visited per fade frame
.const DISSOLVE_NTSC = 50
.const CELLS        = 1000

// Zero page (the part's $10..$7F).
.label sc_ptr  = part_zp         // $10/$11 selfcheck cell pointer
.label ch_p    = part_zp + 2     // $12 phase of the sprite being placed
.label ch_xl   = part_zp + 3     // $13 X low byte in progress
.label ch_xh   = part_zp + 4     // $14 X high byte in progress
.label ds_ptr  = part_zp + 5     // $15/$16 dissolve cell pointer, palette copy source
.label sc_pal  = part_zp + 7     // $17/$18 selfcheck palette pointer

* = P4_CODE "p4 fire"

// ---------------------------------------------------------------------------
// Contract tables and words.
// ---------------------------------------------------------------------------
irq_count:   .byte 1
irq_lines:   .byte CHAIN_LINE
irq_hi:      .byte 0
irq_lo:      .byte <chain_irq
irq_hi_addr: .byte >chain_irq
worst:       .word 0
typical:     .word 0

// Part state that code may read whatever $01 says: it stays in this block.
skipped:      .byte 0        // main calls returned as stale flags
done_frame:   .byte $ff      // seq_frame low byte when the last half finished
half:         .byte 0        // 0 = bottom half next, 1 = top half next
faded:        .byte 0        // 1 once fadeout has finished
lfsr:         .byte SEED     // seed-row LFSR state
phase:        .byte 0        // chain phase, moved by the line-20 interrupt
chain_frozen: .byte 0        // 1 once the sprites are off: the interrupt does nothing
chain_msb:    .byte 0        // $D010 being assembled
pal_idx:      .byte 0        // palette in the kernel's table, 0..3
pal_timer:    .byte 0        // frames since the last switch
pal_bottom:   .byte 0        // palette the bottom half was last drawn with
pal_top:      .byte 0        // palette the top half was last drawn with

// ---------------------------------------------------------------------------
// The kernel. `palette` is the 64-byte active table in the $A000 block.
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

.macro TimerRead(word) {
    lda $dc04                // elapsed = $FFFF - remaining = remaining eor $FFFF
    eor #$ff
    sta word
    lda $dc05
    eor #$ff
    sta word + 1
}

// One step of the 10-bit Galois LFSR held in lo/hi: shift right, and when a
// one fell out fold the taps (bits 9 and 6) back in.
.macro LfsrStep(lo, hi) {
    lsr hi
    ror lo
    bcc !+
    lda hi
    eor #$02
    sta hi
    lda lo
    eor #$40
    sta lo
!:
}

// ---------------------------------------------------------------------------
// prepare: bank BASIC out first, then the body under it.
// ---------------------------------------------------------------------------
prepare:
    lda #$36
    sta $01
    jmp prepare_body

// ---------------------------------------------------------------------------
// The line-20 interrupt: advance the chain and place the six sprites. Enters
// with A, X, Y saved and $D019 acknowledged. Does nothing once frozen, so it
// is harmless if it ever runs after cleanup.
// ---------------------------------------------------------------------------
chain_irq:
    lda chain_frozen
    bne chain_rts
    lda phase
    clc
    adc #CHAIN_SPEED
    sta phase
chain_place:
    lda #0
    sta chain_msb
    lda phase
    sec
    sbc #5 * CHAIN_GAP       // sprite 5 trails furthest; work back to sprite 0
    sta ch_p
    ldx #10                  // register pair index, 2 * sprite
chain_loop:
    lda ch_p                 // Y = 64 + sine[2p] / 4: 64..127
    asl
    tay
    lda sine, y
    lsr
    lsr
    clc
    adc #64
    sta $d001, x
    ldy ch_p                 // X = 24 + s + s / 8, s = sine[p]: 24..310
    lda sine, y
    clc
    adc #24
    sta ch_xl
    lda #0
    adc #0
    sta ch_xh
    lda sine, y
    lsr
    lsr
    lsr
    clc
    adc ch_xl
    sta $d000, x
    lda ch_xh
    adc #0
    lsr                      // bit 8 of X into the carry
    rol chain_msb
    lda ch_p
    clc
    adc #CHAIN_GAP
    sta ch_p
    dex
    dex
    bpl chain_loop
    lda chain_msb
    sta $d010
chain_rts:
    rts

// ---------------------------------------------------------------------------
// main: one half pass per fresh frame flag; a stale flag is counted and
// skipped. Frozen once the fade is requested. Bracketed by CIA1 timer A.
// ---------------------------------------------------------------------------
main:
    lda faded
    bne main_out
    lda seq_fade
    bne main_out             // frozen: fadeout owns the picture now
    inc pal_timer
    lda seq_frame
    cmp done_frame
    bne main_run
    inc skipped
main_out:
    rts
main_run:
    lda half
    bne main_top
    jsr pal_tick             // outside the bracket: the 64-byte copy, once per PAL_PERIOD
    lda pal_idx
    sta pal_bottom
    TimerStart()
    jsr bottom_half
    lda #1
    sta half
    jmp main_stop
main_top:
    lda pal_idx
    sta pal_top
    TimerStart()
    jsr top_half
    lda #0
    sta half
main_stop:
    TimerRead(typical)
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

// Seed row 24: one LFSR step per column, bit 0 of the state lights the cell.
seed_row:
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
// cleanup: stop the stopwatch, freeze the chain, wait for raster line 250,
// leave the contract's register values, bank BASIC back in last.
// ---------------------------------------------------------------------------
cleanup:
    lda #0
    sta $dc0e                // timer A stopped
    lda #1
    sta chain_frozen
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
    sta $d010
    sta $d020
    sta $d021
    sta IDLE_BYTE
    lda #$c7
    sta $dd00
    lda #$37
    sta $01
    rts

// ---------------------------------------------------------------------------
// selfcheck entry: the body lives under BASIC, so bank it in around the call
// and put $01 back to whatever it was. A = 1 when every check agrees.
// ---------------------------------------------------------------------------
selfcheck:
    lda $01
    pha
    lda #$36
    sta $01
    jsr selfcheck_body
    tax
    pla
    sta $01
    txa
    rts

.if (* > P5_CODE) .error "p4 does not fit below P5_CODE"

// ===========================================================================
// The $A000 block: tables, sprite shapes and the paths that only run while
// BASIC is banked out.
// ===========================================================================
* = P4_EXTRA "p4 fire tables"

// 256-entry sine, 0..255, one full turn.
.align $100
sine:
    .fill 256, round(127.5 + 127.5 * sin(toRadians(i * 360 / 256)))

// Four palettes, 64 entries each, luminance order 0 6 9 2 11 4 8 14 12 5 10 3
// 15 7 13 1 (dark to bright). Each climbs from black to white through one
// hue family. Page-aligned so palette k starts at palettes + 64 * k.
.align $100
palettes:
    // 0: warm. black, brown, red, orange, light red, yellow, white
    .fill 8, 0
    .fill 8, 9
    .fill 8, 2
    .fill 8, 8
    .fill 8, 10
    .fill 12, 7
    .fill 12, 1
    // 1: blue to white. black, blue, light blue, cyan, light grey, white
    .fill 10, 0
    .fill 10, 6
    .fill 10, 14
    .fill 10, 3
    .fill 12, 15
    .fill 12, 1
    // 2: green to cyan. black, blue, green, cyan, light green, white
    .fill 10, 0
    .fill 8, 6
    .fill 10, 5
    .fill 12, 3
    .fill 12, 13
    .fill 12, 1
    // 3: violet to pink. black, blue, purple, light red, light grey, white
    .fill 10, 0
    .fill 8, 6
    .fill 12, 4
    .fill 12, 10
    .fill 10, 15
    .fill 12, 1

// The active palette the kernel reads. prepare copies palette 0 here.
palette:
    .fill 64, 0

// Three places down the luminance order, indexed by colour.
step3:
    .byte 0, 15, 0, 12, 9, 8, 0, 10, 2, 0, 14, 6, 4, 3, 11, 5

// The ten cells selfcheck reads back: (row, column) pairs spread over the
// field, offsets row * 40 + column, and which half drew each row.
check_lo:
    .byte <(0*40+0), <(0*40+39), <(5*40+20), <(11*40+0), <(12*40+39)
    .byte <(17*40+10), <(23*40+5), <(23*40+38), <(24*40+0), <(24*40+39)
check_hi:
    .byte >(0*40+0), >(0*40+39), >(5*40+20), >(11*40+0), >(12*40+39)
    .byte >(17*40+10), >(23*40+5), >(23*40+38), >(24*40+0), >(24*40+39)
check_half:
    .byte 0, 0, 0, 0, 1, 1, 1, 1, 1, 1

// Sprite shapes: six 24 by 21 glyphs, drawn here as rows of . and #.
.macro Glyph(rows) {
    .for (var r = 0; r < 21; r++) {
        .var s = rows.get(r)
        .for (var b = 0; b < 3; b++) {
            .var v = 0
            .for (var i = 0; i < 8; i++) {
                .eval v = v * 2 + (s.charAt(b * 8 + i) == '#' ? 1 : 0)
            }
            .byte v
        }
    }
    .byte 0
}

shapes:
    Glyph(List().add(
        "........................",
        "......############......",
        "....################....",
        "...##################...",
        "..######........######..",
        "..#####..........#####..",
        "..####............####..",
        "..####..................",
        "..####..................",
        "..####..................",
        "..####..................",
        "..####..................",
        "..####..................",
        "..####..................",
        "..####............####..",
        "..#####..........#####..",
        "..######........######..",
        "...##################...",
        "....################....",
        "......############......",
        "........................"))
    Glyph(List().add(
        "........................",
        "......############......",
        "....################....",
        "...##################...",
        "..######........######..",
        "..#####..........#####..",
        "..####............####..",
        "..####..................",
        "..####..................",
        "..####...##########.....",
        "..####.##############...",
        "..#####################.",
        "..######........######..",
        "..####............####..",
        "..####............####..",
        "..#####..........#####..",
        "..######........######..",
        "...##################...",
        "....################....",
        "......############......",
        "........................"))
    Glyph(List().add(
        "........................",
        "..............####......",
        ".............#####......",
        "............######......",
        "...........#######......",
        "..........########......",
        ".........####.####......",
        "........####..####......",
        ".......####...####......",
        "......####....####......",
        ".....####.....####......",
        "....####......####......",
        "..####################..",
        "..####################..",
        "..####################..",
        "..............####......",
        "..............####......",
        "..............####......",
        "..............####......",
        "..............####......",
        "........................"))
    Glyph(List().add(
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "....################....",
        "....################....",
        "....################....",
        "....################....",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................",
        "........................"))
    Glyph(List().add(
        "........................",
        "..####..........######..",
        "..####.........######...",
        "..####........######....",
        "..####.......######.....",
        "..####......######......",
        "..####.....######.......",
        "..####....######........",
        "..####...######.........",
        "..####..######..........",
        "..###########...........",
        "..###########...........",
        "..####..######..........",
        "..####...######.........",
        "..####....######........",
        "..####.....######.......",
        "..####......######......",
        "..####.......######.....",
        "..####........######....",
        "..####.........######...",
        "........................"))
    Glyph(List().add(
        "........................",
        "..################......",
        "..##################....",
        "..###################...",
        "..####..........######..",
        "..####............####..",
        "..####............####..",
        "..####...........#####..",
        "..###################...",
        "..##################....",
        "..###################...",
        "..####...........#####..",
        "..####............####..",
        "..####............####..",
        "..####............####..",
        "..####............####..",
        "..####...........#####..",
        "..###################...",
        "..##################....",
        "..################......",
        "........................"))
shapes_end:

// State that only banked code reads.
fade_started:   .byte 0      // 1 once fadeout has taken its census
fade_frames:    .byte 0      // fadeout calls so far
sprites_off:    .byte 0      // 1 once the chain has faded to black and $D015 is 0
spr_col:        .byte 0      // the chain's current colour
ds_lo:          .byte 0      // dissolve LFSR state
ds_hi:          .byte 0
nonblack:       .word 0      // lit cells left, from the census at the freeze
dissolve_n:     .byte 0      // cells per fade frame: DISSOLVE_PAL or DISSOLVE_NTSC
lines_hi:       .byte 0      // highest $D012 seen with $D011 bit 7 set: 55 PAL, 5 or 6 NTSC
lfsr_period:    .word 0      // steps until the dissolve seed recurred: must be 1,023
dissolve_cost:  .word 0      // cycles of the most recent fade frame
dissolve_worst: .word 0      // largest fade frame seen
sc_heat:        .byte 0
sc_want:        .byte 0
sc_got:         .byte 0
sc_n:           .byte 0
sc_phase:       .byte 0
sc_y:           .byte 0

// ---------------------------------------------------------------------------
// prepare body: clear the heat map, reset state, load palette 0, copy the
// shapes to bank 0, count the raster lines, measure the LFSR period. No VIC
// or SID writes.
// ---------------------------------------------------------------------------
prepare_body:
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
    sta faded
    sta phase
    sta chain_frozen
    sta chain_msb
    sta pal_idx
    sta pal_timer
    sta pal_bottom
    sta pal_top
    sta fade_started
    sta fade_frames
    sta sprites_off
    sta dissolve_cost
    sta dissolve_cost + 1
    sta dissolve_worst
    sta dissolve_worst + 1
    lda #$ff
    sta done_frame
    lda #SEED
    sta lfsr
    lda #CHAIN_COLOUR
    sta spr_col
    jsr pal_load             // palette 0 into the kernel's table
    // shapes to bank 0
    ldx #0
!:  lda shapes, x
    sta SHAPES, x
    lda shapes + $100, x
    sta SHAPES + $100, x
    inx
    bne !-
    jsr count_lines
    jsr lfsr_measure
    rts

// Count raster lines once: with interrupts held off, wait for the raster to
// pass through the low lines and cross 256, then keep the highest $D012 seen
// until $D011 bit 7 clears again at the wrap. 55 means 312 lines (PAL); 5 or
// 6 means 262 or 263 (NTSC). The I flag is put back as it was found.
count_lines:
    php
    sei
    lda #0
    sta lines_hi
!:  lda $d011
    bmi !-
!:  lda $d011
    bpl !-
!scan:
    lda $d012
    cmp lines_hi
    bcc !+
    sta lines_hi
!:  lda $d011
    bmi !scan-
    plp
    lda #DISSOLVE_PAL
    ldy lines_hi
    cpy #32
    bcs !+
    lda #DISSOLVE_NTSC
!:  sta dissolve_n
    rts

// Step the dissolve LFSR from its seed until the seed recurs, counting steps.
// A Galois step with the top tap set is a bijection on states, so the seed
// always recurs; the count is 1,023 only if the polynomial is primitive.
lfsr_measure:
    lda #<LFSR_SEED
    sta ds_lo
    lda #>LFSR_SEED
    sta ds_hi
    lda #0
    sta lfsr_period
    sta lfsr_period + 1
!:  LfsrStep(ds_lo, ds_hi)
    inc lfsr_period
    bne !+
    inc lfsr_period + 1
!:  lda ds_lo
    cmp #<LFSR_SEED
    bne !--
    lda ds_hi
    cmp #>LFSR_SEED
    bne !--
    rts

// ---------------------------------------------------------------------------
// setup: every VIC register the contract lists, screen RAM all code 160,
// colour RAM all black, six sprites placed for frame one. Interrupts are off.
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
    sta $d017
    sta $d01b                // sprites in front of the flames
    sta $d01c                // hires
    sta $d01d
    sta $d010
    sta $d020
    sta $d021
    sta $d025
    sta $d026
    ldx #$0f
!:  sta $d000, x
    dex
    bpl !-
    ldx #7
!:  sta $d027, x
    dex
    bpl !-
    lda spr_col
    ldx #5
!:  sta $d027, x
    dex
    bpl !-
    lda #%00111111
    sta $d015
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
    ldx #5                   // shape pointers, after the fill that covers $07F8
!:  txa
    clc
    adc #SHAPE_PTR
    sta SCREEN + $3f8, x
    dex
    bpl !-
    jsr chain_place
    rts

// ---------------------------------------------------------------------------
// Palette wave: at a bottom-half boundary, when PAL_PERIOD frames have gone
// by, advance to the next palette and copy it over the kernel's table.
// ---------------------------------------------------------------------------
pal_tick:
    lda pal_timer
    cmp #PAL_PERIOD
    bcc pal_rts
    lda #0
    sta pal_timer
    inc pal_idx
    lda pal_idx
    and #3
    sta pal_idx
pal_load:
    lda pal_idx
    asl
    asl
    asl
    asl
    asl
    asl                      // idx * 64
    sta ds_ptr
    lda #>palettes
    sta ds_ptr + 1
    ldy #63
!:  lda (ds_ptr), y
    sta palette, y
    dey
    bpl !-
pal_rts:
    rts

// ---------------------------------------------------------------------------
// fadeout: the luminance dissolve. First call takes the census of lit cells;
// every call after visits dissolve_n cells in LFSR order and steps the chain's
// colour every eighth frame. A = 1 once nothing is lit and the sprites are
// off. Bracketed by CIA1 timer A into dissolve_cost / dissolve_worst.
// ---------------------------------------------------------------------------
fadeout:
    lda faded
    beq !+
    jmp fade_ret1
!:  lda fade_started
    bne fade_run
    inc fade_started
    lda #<LFSR_SEED
    sta ds_lo
    lda #>LFSR_SEED
    sta ds_hi
    jsr census
    lda #0
    rts
fade_run:
    TimerStart()
    inc fade_frames
    lda fade_frames
    cmp #FADE_CAP
    bcc !+
    jmp fade_force
!:  lda sprites_off
    bne fade_cells
    lda fade_frames
    and #7
    bne fade_cells
    ldx spr_col              // one step down the luminance order, every eighth frame
    lda step3, x
    sta spr_col
    ldx #5
!:  sta $d027, x
    dex
    bpl !-
    cmp #0
    bne fade_cells
    jsr sprites_kill
fade_cells:
    ldx dissolve_n
fade_loop:
    LfsrStep(ds_lo, ds_hi)
    lda ds_lo                // back at the seed: a whole period has passed, so visit cell 0 too
    cmp #<LFSR_SEED
    bne fade_index
    lda ds_hi
    cmp #>LFSR_SEED
    bne fade_index
    lda #<COLOUR
    sta ds_ptr
    lda #>COLOUR
    sta ds_ptr + 1
    jsr visit_cell
fade_index:
    lda ds_hi                // values 1,000 and above name no cell: not a visit
    cmp #>CELLS
    bne fade_visit
    lda ds_lo
    cmp #<CELLS
    bcs fade_loop
fade_visit:
    lda ds_lo
    sta ds_ptr
    lda ds_hi
    ora #>COLOUR
    sta ds_ptr + 1
    jsr visit_cell
    dex
    bne fade_loop
    TimerRead(dissolve_cost)
    lda dissolve_cost + 1
    cmp dissolve_worst + 1
    bcc fade_judge
    bne fade_new_worst
    lda dissolve_cost
    cmp dissolve_worst
    bcc fade_judge
fade_new_worst:
    lda dissolve_cost
    sta dissolve_worst
    lda dissolve_cost + 1
    sta dissolve_worst + 1
fade_judge:
    lda nonblack
    ora nonblack + 1
    bne fade_ret0
    lda sprites_off
    beq fade_ret0
    lda #1
    sta faded
fade_ret1:
    lda #1
    rts
fade_ret0:
    lda #0
    rts

// The cap: black everywhere, sprites off, done.
fade_force:
    lda #0
    tax
!:  sta COLOUR, x
    sta COLOUR + $100, x
    sta COLOUR + $200, x
    sta COLOUR + $300, x
    inx
    bne !-
    sta nonblack
    sta nonblack + 1
    jsr sprites_kill
    lda #1
    sta faded
    rts

sprites_kill:
    lda #0
    sta $d015
    lda #1
    sta sprites_off
    sta chain_frozen
    rts

// One visit: the cell at ds_ptr steps three places down; when that lands on
// black from a lit colour, one fewer cell is left.
visit_cell:
    ldy #0
    lda (ds_ptr), y
    and #$0f
    beq visit_rts
    tay
    lda step3, y
    ldy #0
    sta (ds_ptr), y
    cmp #0                   // sta leaves the flags alone: test the new colour itself
    bne visit_rts
    lda nonblack
    bne !+
    dec nonblack + 1
!:  dec nonblack
visit_rts:
    rts

// Census: how many of the 1,000 cells are lit right now.
.macro CountCell(base) {
    lda base, x
    and #$0f
    beq !+
    inc nonblack
    bne !+
    inc nonblack + 1
!:
}
census:
    lda #0
    sta nonblack
    sta nonblack + 1
    ldx #0
!:  CountCell(COLOUR)
    CountCell(COLOUR + 250)
    CountCell(COLOUR + 500)
    CountCell(COLOUR + 750)
    inx
    cpx #250
    bne !-
    rts

// ---------------------------------------------------------------------------
// selfcheck body, A = 1 when all of these hold:
//   1. the dissolve LFSR's measured period is 1,023;
//   2. sprite 0's Y register is 64 + sine[2 * phase] / 4 for the phase the
//      chain is at (phase is read twice around the register so a step landing
//      between the reads is caught and the pair re-read);
//   3. for ten fixed cells, colour RAM low nibble == palette[heat] using the
//      palette that half was last drawn with; once the dissolve has started,
//      the nibble may instead be any number of step3 applications below it.
// ---------------------------------------------------------------------------
sc_fail_early:
    lda #0
    rts
selfcheck_body:
    lda lfsr_period
    cmp #<LFSR_PERIOD
    bne sc_fail_early
    lda lfsr_period + 1
    cmp #>LFSR_PERIOD
    bne sc_fail_early
sc_sprite:
    lda phase
    sta sc_phase
    lda $d001
    sta sc_y
    lda phase
    cmp sc_phase
    bne sc_sprite
    asl
    tay
    lda sine, y
    lsr
    lsr
    clc
    adc #64
    cmp sc_y
    bne sc_fail_early
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
    sta sc_heat
    lda check_half, x
    beq sc_top
    lda pal_bottom
    jmp sc_have_pal
sc_top:
    lda pal_top
sc_have_pal:
    asl
    asl
    asl
    asl
    asl
    asl
    sta sc_pal
    lda #>palettes
    sta sc_pal + 1
    ldy sc_heat
    lda (sc_pal), y
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
    sta sc_got
    lda fade_started
    bne sc_orbit
    lda sc_got
    cmp sc_want
    bne sc_fail
    beq sc_next
sc_orbit:
    lda #6                   // white reaches black in five steps
    sta sc_n
    lda sc_want
sc_orbit_loop:
    cmp sc_got
    beq sc_next
    tay
    lda step3, y
    dec sc_n
    bne sc_orbit_loop
    jmp sc_fail
sc_next:
    dex
    bpl sc_loop
    lda #1
    rts
sc_fail:
    lda #0
    rts

.if (* > P4_EXTRA_END) .error "p4 tables do not fit below $A800"
