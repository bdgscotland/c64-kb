// p1_logo.asm: part 1 of MEASURED, the LOGO part.
//
// Ports two c64-kb recipes:
//   docs/recipes/kickassembler/tech-tech.md (tech_tech_wobbler)
//   docs/recipes/kickassembler/sprite-border-scroller.md
// Plus topbottom_border_open (h249 + h20).
//
// Deviations from the recipes:
//   1. No double-IRQ stable entry. Cannot write $0314. h109 polls $D012 for
//      line 112, delays POLL_DELAY=53 cycles, then two-read sync.
//   2. Dispatcher entry: A/X/Y saved, $D019 acked. Handlers end with rts.
//   3. Custom font at $3800 (CB=7). Render reads from $3800 directly; no $01.
//   4. Phase advance per line = 1; per frame = 2. Covers ~half a sine wave in
//      128 frames (cycle time 2.56 s at 50 Hz) while keeping each character
//      row stable enough to be legible.
//   5. Sine capped at 55 (k_max=6); k=7 is unused and matrix 7 is not placed
//      in RAM. This avoids any write into $0800-$0FFF, which the sequencer owns.
//   6. Separate PAL/NTSC band loops: 23+40=63 PAL, 25+40=65 NTSC cycles/line.
//   7. Tables (sine, s2d018, s2d016, t0, t1, t2, logo_mat0) at $7800-$7DF7,
//      outside the $8000-$8BFF code window. The scroller text (scr_text) is
//      at $3E00, one page, below part 5's ball shapes at $3F00 and the idle
//      byte at $3FFF; it outgrew the 136 bytes left before the $7E80 epilogue.
//   8. FLAT build (-define FLAT): build_tables fills constant d018(4)/
//      D016_BASE; logo stable at a fixed horizontal position for visual check.
//   9. TEST_P1_MODE build (-define TEST_P1_MODE): selfcheck additionally
//      verifies that the eight bytes at $0BF8-$0BFF equal $AA, proving setup
//      did not write there. The test fills those bytes with $AA before setup.
//  10. Colour plasma around the logo (2026-09-24). Rows 0-7 and 14-20 hold
//      the solid-block code 0 in every matrix, so each cell shows its colour
//      RAM. main repaints a quarter of those 600 cells per frame (the 15
//      rows interleaved four ways, so each row is refreshed every fourth
//      frame) with colour = cmap[colv[x] + rt[y]]: colv[x] = sinP[8x + t],
//      rt[y] = (sinP[10y + t2] + sinP[5y + t3]) / 2, cmap[s] = ramp[s / 16],
//      sinP 0-119, ramp the 16 C64 colours in luminance order (the sum
//      stops at 238, so the top bucket, white, is the logo's alone). t, t2,
//      t3 advance by +1, -1, +2 a frame. The fade lowers the ramp by four steps a level
//      through cmap, one 32-entry slice a frame, so the plasma is black one
//      level before the logo is. main brackets itself with CIA1 timer B
//      (the interrupts' timer A cycles that land inside are subtracted), and
//      the worst/typical words are the two interrupts plus main.
//  11. The band's entry padding (POLL_DELAY and the two ENTRY_PADs) is a
//      counted ldx/dex/bne loop rather than a run of nops: the same cycle
//      count in seven to nine bytes instead of 28 to 95. Freed the 190 bytes
//      the plasma glue needed under the $8C00 ceiling.
//
// Memory used by this part (none in $0800-$0FFF):
//   Matrix 0: $0400 (VM=1). Filled by setup from logo_mat0 and code 0.
//   Matrices 1-6: $2000-$37FF. Font: $3800. Sprite slots: $3C00.
//   Scroller text and fade ramp: $3E00 (one page). Plasma colour map:
//   $3F00-$3FEE ($3FF8-$3FFF is glyph 255 and stays zero).
//   Tables: $7800 (plasma state and colv in the $7980 gap). Epilogue and
//   plasma routines: $7DF8-$7EFF. Plasma sine: $7F00. Code: $8000-$8BFF.
//   ZP: $10-$7F (all of it; the plasma keeps its state in bank 1 RAM).
//
// IRQs: count=3, lines=[20, 109, 249].
// selfcheck: matrix-0 cells hold the C glyph pattern: $0547 (row 8, col 7,
//   C's top-left) = 0, $056F (row 9, col 7, C's stem) = 0, $0570 (row 9,
//   col 8, C's open interior) = $20, AND $D015 != 0, AND (while the fade
//   has not started) the two plasma cells at $D882 (row 3, col 10) and
//   $DAC6 (row 17, col 30) are not white and the pair differs from its
//   snapshot of sixteen frames earlier.

#importonce

.namespace p1 {

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
.const FIRST_LINE     = 115
.const LAST_LINE      = 162
.const NLINES         = 48
.const POLL_LINE      = 112
.const POLL_DELAY     = 53
.const ENTRY_PAD_PAL  = 183
.const ENTRY_PAD_NTSC = 190
.const D016_BASE      = $c8
.const SPRITE_Y       = 254
.const OPEN_LINE      = 249
.const RESTORE_LINE   = 20
.const XSTEP          = 48
.const FADE_FRAMES    = 8
.const FADE_STEPS     = 5
// Plasma: sine phase per column and per row (two row terms), and the two
// probe cells the selfcheck reads (row 3 col 10, row 17 col 30).
.const PL_CX          = 8
.const PL_RY          = 10
.const PL_RY2         = 5
.const PL_CELL_A      = $d800 + 3 * 40 + 10
.const PL_CELL_B      = $d800 + 17 * 40 + 30
.const PL_CMAP        = $3f00
.const PL_SINE        = $7f00
// The 16 C64 colours in luminance order (black to white).
.var ramp = List().add(0, 6, 9, 2, 11, 4, 8, 14, 12, 5, 10, 3, 15, 7, 13, 1)
// The plasma rows: 0-7 above the band, 14-20 below it.
.var plrows = List().add(0, 1, 2, 3, 4, 5, 6, 7, 14, 15, 16, 17, 18, 19, 20)
.const PL_NROWS       = 15
.function isPlasmaRow(r) { .return r <= 7 || (r >= 14 && r <= 20) }
// The logo word. Each glyph is 3 cells wide with a 1-cell gap; the word is
// LOGO_W cells wide and sits at column LOGO_X in matrix 0, one column further
// right in each matrix k. Columns 0-2 are reserved (black colour RAM), so the
// word sweeps columns 3-39 as k runs 0-6; LOGO_X centres that sweep the way
// the eight-letter word did (31 wide at column 3).
.const WORD           = "C64-KB"
.const LOGO_W         = WORD.size() * 4 - 1
.const LOGO_X         = 3 + floor((31 - LOGO_W) / 2)

.var vms = List().add(1, 8, 9, 10, 11, 12, 13, 2)
.function d018(k)  { .return (vms.get(k) << 4) | $0e }
.function d011l(l) { .return $18 | (l & 7) }

// ---------------------------------------------------------------------------
// Block-letter bitmaps (3 wide x 5 tall per glyph). The set covers the
// current word "C64-KB" and the earlier word "MEASURED"; only glyphs named
// in WORD reach the matrices.
// ---------------------------------------------------------------------------
.var ltr = Hashtable()
.eval ltr.put("C",List().add(List().add(1,1,1)).add(List().add(1,0,0)).add(List().add(1,0,0)).add(List().add(1,0,0)).add(List().add(1,1,1)))
.eval ltr.put("6",List().add(List().add(1,1,1)).add(List().add(1,0,0)).add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,1,1)))
.eval ltr.put("4",List().add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,1)).add(List().add(0,0,1)).add(List().add(0,0,1)))
.eval ltr.put("-",List().add(List().add(0,0,0)).add(List().add(0,0,0)).add(List().add(1,1,1)).add(List().add(0,0,0)).add(List().add(0,0,0)))
.eval ltr.put("K",List().add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,0,1)))
// B with full top and bottom rows: the usual 3x5 B (rows 1,1,0 / 1,0,1 /
// 1,1,0 / 1,0,1 / 1,1,0) has two lone right-column cells that the wobble's
// shear detaches from the body, and the word then reads "C64-KE".
.eval ltr.put("B",List().add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,1,1)))
.eval ltr.put("M",List().add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,0,1)))
.eval ltr.put("E",List().add(List().add(1,1,1)).add(List().add(1,0,0)).add(List().add(1,1,0)).add(List().add(1,0,0)).add(List().add(1,1,1)))
.eval ltr.put("A",List().add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,0,1)))
.eval ltr.put("S",List().add(List().add(1,1,1)).add(List().add(1,0,0)).add(List().add(1,1,1)).add(List().add(0,0,1)).add(List().add(1,1,1)))
.eval ltr.put("U",List().add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,1)))
.eval ltr.put("R",List().add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,0,1)))
.eval ltr.put("D",List().add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,0)))

.function lpx(li, r, c) {
    .return ltr.get(WORD.substring(li, li+1)).get(r).get(c)
}

.function matCell(k, i) {
    .var r = floor(i / 40)
    // Plasma rows: solid block in every matrix, the colour comes from colour RAM.
    .if (isPlasmaRow(r)) .return 0
    .var c = mod(i, 40) - LOGO_X - k
    .if (r < 8 || r > 13 || c < 0 || c >= LOGO_W) .return $20
    .if (r == 13) .return 0
    .var li = floor(c / 4)
    .var lc = mod(c, 4)
    .if (lc == 3 || li >= WORD.size()) .return $20
    .return lpx(li, r - 8, lc) == 1 ? 0 : $20
}

// 2x2 doubling: each bit of b -> bits 2i and 2i+1 in 16-bit result.
.function dbl(b) {
    .var e = 0
    .for (var ii = 0; ii < 8; ii++) {
        .if (((b >> ii) & 1) == 1) .eval e = e | (3 << (2 * ii))
    }
    .return e
}

// Screen-code text macro, matching the font at $3800:
//   A-Z (ASCII 65-90) -> 1-26, '-' -> 27, ':' -> 28, '.' -> 29,
//   '0'-'9' (ASCII 48-57) -> 33-42, anything else -> 32 (space).
.function textCode(c) {
    .if (c >= 65 && c <= 90) .return c - 64
    .if (c >= 48 && c <= 57) .return c - 48 + 33
    .if (c == 45) .return 27
    .if (c == 58) .return 28
    .if (c == 46) .return 29
    .return 32
}
.macro ScreenText(t) {
    .for (var i = 0; i < t.size(); i++) {
        .byte textCode(t.charAt(i))
    }
}

// ---------------------------------------------------------------------------
// Zero page ($10-$7F)
// ---------------------------------------------------------------------------
.label region   = $10
.label phase_t  = $11
.label acc_lo   = $12
.label acc_hi   = $13
.label pos_lo   = $14
.label pos_hi   = $15
.label tidx     = $16
.label fade_ctr = $17
.label fade_lvl = $18
.label msb_b    = $19
.label ena_b    = $1a
.label pend     = $1b
.label xl       = $1c
.label xh       = $1d
.label rptr_lo  = $1e
.label rptr_hi  = $1f
.label d018_zp  = $20   // 48 bytes
.label d016_zp  = $50   // 48 bytes

// ---------------------------------------------------------------------------
// Matrix data
// Matrix 0: virtual (setup fills from logo_mat0; not in the PRG image)
// ---------------------------------------------------------------------------
* = $0400 "mat0" virtual
.fill 1000, matCell(0, i)
.fill 24, $20

// Matrices 1-6 live in RAM and ARE emitted into the PRG.
* = $2000 "mat1"
.fill 1000, matCell(1, i)
.fill 24, $20

* = $2400 "mat2"
.fill 1000, matCell(2, i)
.fill 24, $20

* = $2800 "mat3"
.fill 1000, matCell(3, i)
.fill 24, $20

* = $2c00 "mat4"
.fill 1000, matCell(4, i)
.fill 24, $20

* = $3000 "mat5"
.fill 1000, matCell(5, i)
.fill 24, $20

* = $3400 "mat6"
.fill 1000, matCell(6, i)
.fill 24, $20

// ---------------------------------------------------------------------------
// Font at $3800 (CB=7, 128 chars)
// code 0: solid block (logo cells); codes 1-26: A-Z; 27-29: hyphen, colon,
// full stop; 32: space (blank, the matrices' empty cell); 33-42: digits 0-9.
// All other codes are blank.
// ---------------------------------------------------------------------------
* = $3800 "font"
.byte $ff,$ff,$ff,$ff,$ff,$ff,$ff,$ff  // code 0: solid block
.byte $18,$3c,$66,$66,$7e,$66,$66,$00  // A
.byte $7c,$66,$66,$7c,$66,$66,$7c,$00  // B
.byte $3e,$60,$60,$60,$60,$60,$3e,$00  // C
.byte $78,$6c,$66,$66,$66,$6c,$78,$00  // D
.byte $7e,$60,$60,$78,$60,$60,$7e,$00  // E
.byte $7e,$60,$60,$78,$60,$60,$60,$00  // F
.byte $3e,$60,$60,$6e,$66,$66,$3e,$00  // G
.byte $66,$66,$66,$7e,$66,$66,$66,$00  // H
.byte $3c,$18,$18,$18,$18,$18,$3c,$00  // I
.byte $06,$06,$06,$06,$66,$66,$3c,$00  // J
.byte $66,$6c,$78,$70,$78,$6c,$66,$00  // K
.byte $60,$60,$60,$60,$60,$60,$7e,$00  // L
.byte $c6,$ee,$fe,$d6,$c6,$c6,$c6,$00  // M
.byte $66,$76,$7e,$6e,$66,$66,$66,$00  // N
.byte $3c,$66,$66,$66,$66,$66,$3c,$00  // O
.byte $7c,$66,$66,$7c,$60,$60,$60,$00  // P
.byte $3c,$66,$66,$66,$6e,$3c,$06,$00  // Q
.byte $7c,$66,$66,$7c,$78,$6c,$66,$00  // R
.byte $3e,$60,$60,$3c,$06,$06,$7c,$00  // S
.byte $7e,$18,$18,$18,$18,$18,$18,$00  // T
.byte $66,$66,$66,$66,$66,$66,$3c,$00  // U
.byte $66,$66,$66,$66,$66,$3c,$18,$00  // V
.byte $c6,$c6,$c6,$d6,$fe,$ee,$c6,$00  // W
.byte $66,$66,$3c,$18,$3c,$66,$66,$00  // X
.byte $66,$66,$66,$3c,$18,$18,$18,$00  // Y
.byte $7e,$06,$0c,$18,$30,$60,$7e,$00  // Z
.byte $00,$00,$00,$7e,$00,$00,$00,$00  // code 27: hyphen
.byte $00,$00,$18,$00,$00,$18,$00,$00  // code 28: colon
.byte $00,$00,$00,$00,$00,$18,$18,$00  // code 29: full stop
.fill 2 * 8, 0                         // codes 30-31
.fill 8, 0                             // code 32: space
.byte $3c,$66,$6e,$76,$66,$66,$3c,$00  // code 33: 0
.byte $18,$38,$18,$18,$18,$18,$7e,$00  // 1
.byte $3c,$66,$06,$0c,$18,$30,$7e,$00  // 2
.byte $3c,$66,$06,$1c,$06,$66,$3c,$00  // 3
.byte $0c,$1c,$3c,$6c,$7e,$0c,$0c,$00  // 4
.byte $7e,$60,$7c,$06,$06,$66,$3c,$00  // 5
.byte $3c,$60,$60,$7c,$66,$66,$3c,$00  // 6
.byte $7e,$06,$0c,$18,$30,$30,$30,$00  // 7
.byte $3c,$66,$66,$3c,$66,$66,$3c,$00  // 8
.byte $3c,$66,$66,$3e,$06,$06,$3c,$00  // code 42: 9
.fill (128 - 43) * 8, 0               // codes 43-127

// ---------------------------------------------------------------------------
// Sprite slots at $3C00
// ---------------------------------------------------------------------------
* = $3c00 "sprslots"
.fill 512, 0

// ---------------------------------------------------------------------------
// Scroller text at $3E00: screen codes per ScreenText, $ff = wrap. h20 reads
// it one glyph at a time through the byte index tidx and restarts at the $ff,
// so any length up to 255 wraps cleanly; the block must stay within this page
// (part 5's prepare later copies its ball shapes to $3F00).
// ---------------------------------------------------------------------------
* = $3e00 "scrtext"
scr_text:
ScreenText("C64-KB   A KNOWLEDGE GRAPH OF THE COMMODORE 64 FOR CODING AGENTS   EVERY EFFECT IN THIS DEMO IS A TECHNIQUE PAGE WITH A RECIPE PINNED ON PAL AND NTSC   THIS PART: TECH-TECH WOBBLER AND SPRITE BORDER SCROLLER   ")
.byte $ff
// The plasma's fade ramp, static, in the rest of the scroller's page:
// ramp_pad + 16 + k - shift is the faded colour of bucket k, and the sixteen
// zeros (black) in front of the ramp take the place of a clamp.
ramp_pad: .fill 16, 0
          .fill 16, ramp.get(i)
.assert "scr_text stays in its page", * <= $3f00, true

// ---------------------------------------------------------------------------
// Plasma colour map at $3F00-$3FEE: cmap[s] = ramp[s >> 4] for the sum of a
// column term and a row term, each 0-119, so the sum tops out at 238 and
// the map stops nine bytes short of $3FF8. That matters: the charset window
// is $3800-$3FFF (CB=7) and $3FF8-$3FFF is glyph 255, the one the FLI bug
// draws in columns 0-2 of every band line. With map bytes there the strip
// showed as light diagonal stripes; setup zeroes those eight bytes. The top
// bucket (white) is never reached, so the plasma runs black to light green
// and white stays the logo's. The row routine reads the map as cmap + rt, x
// with x = colv[col], and the page alignment keeps every read in the page.
// Rewritten in place by the fade. Parts 2 and 5 later copy their ball
// shapes over it.
// ---------------------------------------------------------------------------
* = PL_CMAP "p1 cmap"
cmap: .fill 239, ramp.get(i >> 4)
.assert "cmap stays clear of glyph 255 and the idle byte", * <= $3ff8, true

// ---------------------------------------------------------------------------
// Tables outside code area ($7800-$7DF7)
// ---------------------------------------------------------------------------

* = $7800 "sine"
sine: .fill 256, min(55, max(1, 32 + round(31 * sin(toRadians(i * 360 / 256)))))

* = $7900 "s2tables"
s2d018: .fill 64, d018(i >> 3)
s2d016: .fill 64, D016_BASE | (i & 7)

// Plasma column vector and row tables, in the gap before the page-aligned t0.
colv:     .fill 40, 0                       // sinP[8x + t] for the 40 columns
pl_rlo:   .fill PL_NROWS, <($d800 + plrows.get(i) * 40)
pl_rhi:   .fill PL_NROWS, >($d800 + plrows.get(i) * 40)
pl_rph:   .fill PL_NROWS, (plrows.get(i) * PL_RY) & $ff
pl_rph2:  .fill PL_NROWS, (plrows.get(i) * PL_RY2) & $ff
.assert "plasma tables fit the $7980 gap", * <= $7a00, true

.align $100
t0: .fill 256, (dbl(i) >> 12) & $0f
.align $100
t1: .fill 256, (dbl(i) >> 4) & $ff
.align $100
t2: .fill 256, (dbl(i) & $0f) << 4

gbuf: .fill 8, 0

// logo_mat0: rows 8-13, 40 cols each = 240 bytes copied by setup into $0540.
logo_mat0:
.for (var r = 8; r <= 13; r++) {
    .for (var c = 0; c < 40; c++) {
        .byte matCell(0, r * 40 + c)
    }
}

// ---------------------------------------------------------------------------
// Code at P1_CODE = $8000
// ---------------------------------------------------------------------------
* = P1_CODE "p1code"

irq_count:   .byte 3
irq_lines:   .byte RESTORE_LINE, 109, OPEN_LINE
irq_hi:      .byte 0, 0, 0
irq_lo:      .byte <h20, <h109, <h249
irq_hi_addr: .byte >h20, >h109, >h249
worst:       .word 0
typical:     .word 0

fade_tab:    .byte 1, 15, 12, 11, 0
slot_lo:     .fill 8, <($3c00 + i * 64)
slot_hi:     .fill 8, >($3c00 + i * 64)
pairs:       .byte 0, 2, 4, 6, 8, 10, 12, 14
bits:        .byte 1, 2, 4, 8, 16, 32, 64, 128
scr_code:    .byte 0
// Plasma state. 16 - shift per fade level 0-4 first: the plasma runs one
// level ahead of the logo, so it is black at level 3.
pl_fsh_tab:  .byte 12, 8, 4, 0, 0
pl_t:        .byte 0                        // column phase
pl_t2:       .byte 0                        // row phase, first term
pl_t3:       .byte 0                        // row phase, second term
pl_frame:    .byte 0                        // main calls; bits 0-1 pick the quarter
pl_step:     .byte 4                        // row index step: 4 (a quarter), 1 (setup paints all)
pl_tmp:      .byte 0
pl_x0:       .byte 0
pl_mc:       .word 0                        // main's cycles last frame (timer B less the interrupts)
pl_old:      .byte 0, 0                     // probe cells A, B sixteen frames before pl_new
pl_new:      .byte 0, 0                     // probe cells A, B at the last multiple of 16 frames

.macro Delay(n) {
    .if (n < 2) .error "Delay < 2"
    .if ((n & 1) != 0) { bit $ea }
    .for (var ii = 0; ii < ((n & 1) != 0 ? n - 3 : n) / 2; ii++) { nop }
}

// DelayLoop(n): exactly n cycles as ldx #k (2) + k * (dex 2 + bne 3) - 1 for
// the last bne not taken = 5k + 1, plus nop (2) or bit $ea (3) to make up the
// remainder. Clobbers X. The dex and the byte after the bne must share a page
// or the taken branch costs one more; the assert checks it.
.macro DelayLoop(n) {
    .if (n < 12) .error "DelayLoop < 12"
    .var k = floor((n - 1) / 5)
    .var rem = n - (5 * k + 1)
    .if (rem == 1) { .eval k = k - 1; .eval rem = 6 }
    ldx #k
dl:     dex
        bne dl
    .assert "DelayLoop stays in one page", (dl >> 8) == ((dl + 3) >> 8), true
    .if (rem == 2) { nop }
    .if (rem == 3) { bit $ea }
    .if (rem == 4) { nop; nop }
    .if (rem == 6) { bit $ea; bit $ea }
}

// ---------------------------------------------------------------------------
// prepare: detect PAL/NTSC; initialise ZP; clear sprite slots; build tables.
// Called by the sequencer with the line-255 interrupt enabled.
// ---------------------------------------------------------------------------
prepare:
        // PAL/NTSC detection via RST8 ($D011 bit 7). On NTSC, RST8 is set for
        // only 7 lines (256-262 = 455 cycles). The line-255 handler takes
        // 900-1274 cycles and always covers that window entirely, so the
        // spinning poll det_hi would never see RST8=1 on NTSC with interrupts
        // enabled. Mask interrupts for the detection only. PAL has 56 RST8
        // lines; the window is wide enough that the handler cannot cover all
        // of them, so the PAL poll completes reliably. Shape follows p2_twist.
        sei
det_lo: bit $d011
        bmi det_lo
det_hi: bit $d011
        bpl det_hi
det_tr: lda $d012
        bit $d011
        bpl det_dn
        tax
        jmp det_tr
det_dn: lda #0
        cpx #$10
        bcs !+
        lda #1
!:      sta region
        cli             // detection done; restore interrupt enable.

        lda #0
        sta phase_t
        sta acc_lo
        sta acc_hi
        sta fade_ctr
        sta fade_lvl
        sta worst
        sta worst+1
        sta typical
        sta typical+1
        lda #6
        sta pos_lo
        lda #0
        sta pos_hi
        sta tidx
        sta pl_t
        sta pl_t2
        sta pl_t3
        sta pl_frame
        sta pl_mc
        sta pl_mc+1
        sta pl_old
        sta pl_old+1
        sta pl_new
        sta pl_new+1

        ldx #0
!:      sta $3c00,x
        sta $3d00,x
        inx
        bne !-

        jsr build_tables
        jsr pl_colv
        rts

// ---------------------------------------------------------------------------
// setup: write VIC state; fill matrix 0; set colour RAM; write sprite state.
// Writes NO bytes in $0800-$0FFF (sequencer territory).
// ---------------------------------------------------------------------------
setup:
        lda #$1b
        sta $d011
        lda #D016_BASE
        sta $d016
        lda #d018(0)
        sta $d018
        lda #$3f
        sta $dd02
        lda #$c7
        sta $dd00
        lda #0
        sta $d020
        sta $d021
        sta $d017
        sta $d01d
        sta $d01c
        sta $d01b
        sta $d010
        sta $d015
        // Glyph 255 of the charset window ($3FF8-$3FFF, the FLI bug's glyph
        // in columns 0-2 of the band) blank; $3FFF is also the idle byte.
        ldx #7
!:      sta $3ff8,x
        dex
        bpl !-

        // Fill matrix 0 ($0400-$07FF) with blank, then copy logo rows.
        lda #$20
        ldx #0
!:      sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $0700,x
        inx
        bne !-

        ldx #0
cp_m0:  lda logo_mat0,x
        sta $0400 + 8 * 40, x
        inx
        cpx #240
        bne cp_m0

        // Plasma rows of matrix 0: code 0 (solid block). Rows 0-7 are
        // $0400-$053F, rows 14-20 are $0630-$0747.
        lda #0
        ldx #0
!:      sta $0400,x
        inx
        bne !-
!:      sta $0500,x
        inx
        cpx #64
        bne !-
        ldx #0
!:      sta $0630,x
        inx
        cpx #208
        bne !-
        ldx #0
!:      sta $0700,x
        inx
        cpx #72
        bne !-

        // Colour RAM: white everywhere.
        lda #1
        ldx #0
!:      sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $db00,x
        inx
        bne !-

        // Cols 0-2 of band rows 8-13: black (hides FLI strip).
        lda #0
        ldx #0
sc_blk: .for (var r = 8; r <= 13; r++) {
            sta $d800 + r * 40, x
        }
        inx
        cpx #3
        bne sc_blk

        // Paint every plasma row once so the first frame is not white.
        lda #1
        sta pl_step
        ldx #0
        jsr pl_rows
        lda #4
        sta pl_step

        // Sprite pointers ($F0-$F7) in matrix 0 and matrices 1-6.
        // $0BF8 (matrix 7's pointer area) is NOT written: matrix 7 is unused
        // and $0800-$0FFF is owned by the sequencer.
        ldx #7
!:      txa
        clc
        adc #$f0
        sta $07f8,x
        sta $23f8,x
        sta $27f8,x
        sta $2bf8,x
        sta $2ff8,x
        sta $33f8,x
        sta $37f8,x
        dex
        bpl !-

        ldx #7
!:      lda #SPRITE_Y
        ldy pairs,x
        sta $d001,y
        lda #1
        sta $d027,x
        dex
        bpl !-

        lda #$ff
        sta $dc04
        sta $dc05
        lda #0
        sta $dc0e
        rts

// ---------------------------------------------------------------------------
// main: update timing; advance phase; rebuild d018/d016 tables.
// Phase step 2 per frame: half-wave visible in 128 frames (2.56 s at 50 Hz).
// ---------------------------------------------------------------------------
main:
        // typical = the two interrupts' timer A sum for the frame just ended
        // plus main's own timer B figure from the previous frame.
        lda acc_lo
        clc
        adc pl_mc
        sta typical
        lda acc_hi
        adc pl_mc+1
        sta typical+1
        lda worst+1
        cmp typical+1
        bcc mn_max
        bne mn_nm
        lda worst
        cmp typical
        bcs mn_nm
mn_max: lda typical
        sta worst
        lda typical+1
        sta worst+1
mn_nm:  lda #0
        sta acc_lo
        sta acc_hi
        // CIA1 timer B brackets the rest of main. An interrupt that lands
        // inside adds its own timer A figure to acc, which is subtracted at
        // the end, so pl_mc is main's cycles plus the dispatcher's overhead.
        lda #$ff
        sta $dc06
        sta $dc07
        lda #$19
        sta $dc0f
#if !FLAT
        inc phase_t
        inc phase_t      // step 2: half-wave period = 128 frames
#endif
        jsr build_tables
        jsr plasma
        lda #0
        sta $dc0f
        sec
        lda #$ff
        sbc $dc06
        sta pl_mc
        lda #$ff
        sbc $dc07
        sta pl_mc+1
        sei
        lda pl_mc
        sec
        sbc acc_lo
        sta pl_mc
        lda pl_mc+1
        sbc acc_hi
        sta pl_mc+1
        cli
        rts

// ---------------------------------------------------------------------------
// build_tables: fill d018_zp and d016_zp for each of the NLINES band lines.
// FLAT: all lines use d018(4)/D016_BASE (stable logo, no wobble).
// Normal: sine[phase_t + l] drives each line's matrix and XSCROLL.
// ---------------------------------------------------------------------------
build_tables:
#if FLAT
        lda #d018(4)
        ldx #0
!:      sta d018_zp,x
        inx
        cpx #NLINES
        bne !-
        lda #D016_BASE
        ldx #0
!:      sta d016_zp,x
        inx
        cpx #NLINES
        bne !-
        rts
#else
        lda phase_t
        ldx #0
        sta acc_hi
bt_lp:  ldy acc_hi
        lda sine,y
        tay
        lda s2d018,y
        sta d018_zp,x
        lda s2d016,y
        sta d016_zp,x
        inc acc_hi
        inx
        cpx #NLINES
        bne bt_lp
        lda #0
        sta acc_hi
        rts
#endif

// ---------------------------------------------------------------------------
// fadeout: luminance-step fade of colour RAM cols 3-39 of rows 8-13,
// and the sprite colours, over FADE_FRAMES per step, FADE_STEPS total.
// Returns A=0 while fading, A=1 when done.
// ---------------------------------------------------------------------------
fadeout:
        lda fade_lvl
        cmp #FADE_STEPS
        bcs fd_done
        inc fade_ctr
        jsr pl_fade      // one 32-entry slice of cmap per frame at this level
        lda fade_ctr
        cmp #FADE_FRAMES
        bcc fd_go
        lda #0
        sta fade_ctr
        ldx fade_lvl
        lda fade_tab,x
        ldy #0
fd_lp:  .for (var r = 8; r <= 13; r++) {
            sta $d800 + r * 40 + 3, y
        }
        iny
        cpy #37
        bne fd_lp
        ldx fade_lvl
        lda fade_tab,x
        ldx #7
!:      sta $d027,x
        dex
        bpl !-
        inc fade_lvl
fd_go:  lda #0
        rts
fd_done:
        lda #1
        rts

// ---------------------------------------------------------------------------
// cleanup: wait for raster 250; restore the VIC and CIA registers the
// contract requires; stop the CIA1 stopwatch.
// ---------------------------------------------------------------------------
cleanup:
!:      lda $d012
        cmp #250
        bne !-
        bit $d011
        bmi !-
        lda #$1b
        sta $d011
        lda #$c8
        sta $d016
        lda #$15
        sta $d018
        lda #0
        sta $d015
        lda #$c7
        sta $dd00
        lda #0
        sta $dc0e
        rts

// ---------------------------------------------------------------------------
// selfcheck: verify matrix-0 contains the correct "C" glyph pattern and
// that sprites are enabled. Three cell checks (solid/space/solid: C's
// top-left, its open interior, its stem) confirm both matrix content and
// font code mapping are correct. Matrix 0 puts the word at column LOGO_X=7,
// so the C occupies columns 7-9 of rows 8-12.
// In TEST_P1_MODE builds the sentinel at $0BF8 is also checked.
// ---------------------------------------------------------------------------
selfcheck:
        lda $0547          // matrix 0, row 8, col 7: C top-left block (code 0)
        bne sc_fail
        lda $0570          // matrix 0, row 9, col 8: C open interior (code $20)
        cmp #$20
        bne sc_fail
        lda $056f          // matrix 0, row 9, col 7: C left stem (code 0)
        bne sc_fail
        lda $d015
        beq sc_fail
#if TEST_P1_MODE
        lda $0bf8          // standalone test: sentinel must equal $AA
        cmp #$aa
        bne sc_fail
#endif
        // Plasma: both probe cells non-white now (colour RAM's high nibble
        // is open bus, so mask it), and the pair of cells differs between
        // the last two snapshots, taken sixteen frames apart by main. Only
        // while the plasma is live: once the fade has started it is meant
        // to go black and still, and the sequencer runs this check before
        // the fade; the FADE test build runs it after.
        lda fade_lvl
        bne sc_ok
        lda PL_CELL_A
        and #$0f
        cmp #1
        beq sc_fail
        lda PL_CELL_B
        and #$0f
        cmp #1
        beq sc_fail
        lda pl_new
        cmp pl_old
        bne sc_ok
        lda pl_new+1
        cmp pl_old+1
        beq sc_fail
sc_ok:  lda #1
        rts
sc_fail:
        lda #0
        rts

// ---------------------------------------------------------------------------
// h249: clear RSEL between lines 247-251 to open the bottom border.
// ---------------------------------------------------------------------------
h249:
        lda $d011
        and #%01110111
        sta $d011
        rts

// ---------------------------------------------------------------------------
// h20: restore RSEL; advance sprite scroller; manage sprite enables and
// positions; hand off the next glyph to render; time the work.
// ---------------------------------------------------------------------------
h20:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$19
        sta $dc0e

        lda $d011
        and #%01111111
        ora #%00001000
        sta $d011

        lda pos_lo
        sec
        sbc #2
        sta pos_lo
        lda pos_hi
        sbc #0
        sta pos_hi
        bpl p_ok
        lda pos_lo
        clc
        adc #<384
        sta pos_lo
        lda pos_hi
        adc #>384
        sta pos_hi
p_ok:
        lda #0
        sta msb_b
        sta ena_b
        sta pend
        lda pos_lo
        sta xl
        lda pos_hi
        sta xh

        ldx #0
sp_nx:
        lda xh
        beq sp_ir
        cmp #1
        bne sp_su
        lda xl
        cmp #<384
        bcc sp_ir
sp_su:  lda xl
        sec
        sbc #<384
        sta xl
        lda xh
        sbc #>384
        sta xh
sp_ir:  lda xh
        beq sp_on
        lda xl
        cmp #<(344 - 256)
        bcs sp_of
        lda bits,x
        ora msb_b
        sta msb_b
sp_on:  lda bits,x
        ora ena_b
        sta ena_b
sp_of:  lda xh
        bne sp_nh
        lda xl
        cmp #4
        bne sp_nh
        inx
        stx pend
        dex
sp_nh:  ldy pairs,x
        lda xl
        sta $d000,y
        clc
        adc #XSTEP
        sta xl
        bcc !+
        inc xh
!:      inx
        cpx #8
        bne sp_nx

        lda msb_b
        sta $d010
        lda ena_b
        sta $d015

        lda pend
        beq sp_nho
        tax
        dex
        ldy tidx
        lda scr_text,y
        cmp #$ff
        bne !+
        ldy #0
        sty tidx
        lda scr_text
!:      sta scr_code
        inc tidx
        jsr render
sp_nho:
        lda #0
        sta $dc0e
        lda $dc04
        eor #$ff
        clc
        adc acc_lo
        sta acc_lo
        lda $dc05
        eor #$ff
        adc acc_hi
        sta acc_hi
        rts

// ---------------------------------------------------------------------------
// render: 2x2-expand glyph `scr_code` into sprite slot X.
// Sprite rows 2+2r and 3+2r carry glyph row r, doubled horizontally.
// ---------------------------------------------------------------------------
render:
        lda slot_lo,x
        sta rptr_lo
        lda slot_hi,x
        sta rptr_hi

        lda #0
        sta xh
        lda scr_code
        asl
        rol xh
        asl
        rol xh
        asl
        rol xh
        sta xl
        lda xh
        clc
        adc #>$3800
        sta xh

        lda #0
        ldy #63
ren_cl: sta (rptr_lo),y
        dey
        bpl ren_cl

        ldy #7
ren_rd: lda (xl),y
        sta gbuf,y
        dey
        bpl ren_rd

        .for (var r = 0; r < 8; r++) {
            ldx gbuf + r
            lda t0,x
            ldy #6 * r + 6
            sta (rptr_lo),y
            ldy #6 * r + 9
            sta (rptr_lo),y
            lda t1,x
            ldy #6 * r + 7
            sta (rptr_lo),y
            ldy #6 * r + 10
            sta (rptr_lo),y
            lda t2,x
            ldy #6 * r + 8
            sta (rptr_lo),y
            ldy #6 * r + 11
            sta (rptr_lo),y
        }
        rts

// ---------------------------------------------------------------------------
// h109: stable entry (poll+delay+sync, shared PAL/NTSC), then per-line FLI
// band. PAL: 23 CPU + 40 badline stall = 63 cycles/line.
//        NTSC: 25 + 40 = 65 cycles/line.
// ---------------------------------------------------------------------------
h109:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$19
        sta $dc0e

pl_pl:  lda $d012
        cmp #POLL_LINE
        bne pl_pl
        DelayLoop(POLL_DELAY)
        lda $d012
        cmp $d012
        beq !+
!:
        lda d018_zp
        sta $d018
        lda d016_zp
        sta $d016

        lda region
        beq h109_pal_pad
        jmp h109_ntsc_pad

h109_pal_pad:
        DelayLoop(ENTRY_PAD_PAL)
        jmp h109_pal_band

h109_ntsc_pad:
        DelayLoop(ENTRY_PAD_NTSC)
        jmp h109_ntsc_band

// PAL band: LINE_PAD=3 + 20 CPU + 40 badline stall = 63 PAL cycles/line.
h109_pal_band:
    .for (var l = 1; l < NLINES; l++) {
        bit $ea
        lda d018_zp + l
        sta $d018
        lda d016_zp + l
        sta $d016
        lda #d011l(FIRST_LINE + l)
        sta $d011
    }
    jmp h109_done

// NTSC band: LINE_PAD=5 + 20 CPU + 40 badline stall = 65 NTSC cycles/line.
h109_ntsc_band:
    .for (var l = 1; l < NLINES; l++) {
        bit $ea
        nop
        lda d018_zp + l
        sta $d018
        lda d016_zp + l
        sta $d016
        lda #d011l(FIRST_LINE + l)
        sta $d011
    }
    jmp h109_done

// The band's epilogue lives in bank 1 RAM after the s2tables block so that
// p1code ends below P2_CODE ($8C00): reached by the absolute jmp above only,
// and part 2 rebuilds this region in its prepare, which the sequencer runs
// after part 1's cleanup. The plasma routines follow it in the same block
// (they run from main and setup, never from an interrupt). It sat at $7E80
// until the plasma; $7DF8 is the first byte after logo_mat0.
* = $7df8 "p1 epilogue"
h109_done:
        lda #$1b
        sta $d011
        lda #d018(0)
        sta $d018
        lda #D016_BASE
        sta $d016
        lda #0
        sta $dc0e
        lda $dc04
        eor #$ff
        clc
        adc acc_lo
        sta acc_lo
        lda $dc05
        eor #$ff
        adc acc_hi
        sta acc_hi
        rts

// ---------------------------------------------------------------------------
// plasma: one frame. Advance the three phases, rebuild colv, repaint the
// rows of this frame's quarter, and every sixteenth frame snapshot the two
// probe cells for the selfcheck.
// ---------------------------------------------------------------------------
plasma:
        inc pl_t
        dec pl_t2
        inc pl_t3
        inc pl_t3
        jsr pl_colv
        lda pl_frame
        and #3
        tax
        jsr pl_rows
        inc pl_frame
        lda pl_frame
        and #15
        bne pl_nosnap
        lda pl_new
        sta pl_old
        lda pl_new+1
        sta pl_old+1
        lda PL_CELL_A
        and #$0f
        sta pl_new
        lda PL_CELL_B
        and #$0f
        sta pl_new+1
pl_nosnap:
        rts

// pl_colv: colv[x] = sinP[(PL_CX * x + t) & 255], two columns per pass.
pl_colv:
        ldy pl_t
        ldx #0
cv_lp:  lda sinP,y
        sta colv,x
        tya
        clc
        adc #PL_CX
        tay
        lda sinP,y
        sta colv+1,x
        tya
        clc
        adc #PL_CX
        tay
        inx
        inx
        cpx #40
        bne cv_lp
        rts

// pl_rows: paint plasma rows j = X, X + pl_step, ... while j < PL_NROWS.
// Per row: rt = (sinP[rph + t2] + sinP[rph2 + t3]) / 2 becomes the low byte
// of the row routine's cmap operand; the row's colour RAM address becomes
// its store operand.
pl_rows:
        stx pl_tmp
pr_next:
        ldx pl_tmp
        lda pl_rlo,x
        sta pr_st+1
        lda pl_rhi,x
        sta pr_st+2
        lda pl_rph,x
        clc
        adc pl_t2
        tay
        lda sinP,y
        sta pl_x0
        lda pl_rph2,x
        clc
        adc pl_t3
        tay
        lda sinP,y
        clc
        adc pl_x0
        ror
        sta pr_cm+1
        jsr prow
        lda pl_tmp
        clc
        adc pl_step
        sta pl_tmp
        cmp #PL_NROWS
        bcc pr_next
        rts

// prow: 40 cells of one row, 18 cycles a cell. cmap + rt never leaves the
// page: rt and colv are both at most 127.
prow:
        ldy #39
pr_lp:  ldx colv,y
pr_cm:  lda cmap,x
pr_st:  sta $d800,y
        dey
        bpl pr_lp
        rts

// pl_fade: one 32-entry slice of cmap per call, entries 32s to 32s + 31 with
// s = fade_ctr (1-8 on entry; 8 << 5 wraps to slice 0, so the eight calls of
// a level cover the map once), rewritten for the current fade level: bucket
// k = entry >> 4 becomes ramp_pad[k + 16 - shift], shift = 4 * (fade_lvl + 1)
// capped at 16. The map ends at entry 238: entries 239 to 255 are glyph 255
// and the idle byte and must stay zero, so the last slice stops there.
pl_fade:
        ldy fade_lvl
        lda pl_fsh_tab,y
        sta pl_tmp
        lda fade_ctr
        asl
        asl
        asl
        asl
        asl
        tax
pf_lp:  cpx #239
        beq pf_done
        txa
        lsr
        lsr
        lsr
        lsr
        clc
        adc pl_tmp
        tay
        lda ramp_pad,y
        sta cmap,x
        inx
        txa
        and #31
        bne pf_lp
pf_done:
        rts
.assert "p1 epilogue and plasma stay below the plasma sine", * <= PL_SINE, true

// ---------------------------------------------------------------------------
// Plasma sine at $7F00: 0-119, a full wave over 256 entries (the cap keeps
// the colour map short of glyph 255, see cmap).
// ---------------------------------------------------------------------------
* = PL_SINE "p1 plasma sine"
sinP: .fill 256, round(59.5 + 59.5 * sin(toRadians(i * 360 / 256)))

} // namespace p1
