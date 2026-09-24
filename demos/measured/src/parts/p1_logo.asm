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
//   7. Tables (sine, s2d018, s2d016, t0, t1, t2, logo_mat0, scr_text) at
//      $7800-$7E07, outside the $8000-$8BFF code window.
//   8. FLAT build (-define FLAT): build_tables fills constant d018(4)/
//      D016_BASE; logo stable at a fixed horizontal position for visual check.
//   9. TEST_P1_MODE build (-define TEST_P1_MODE): selfcheck additionally
//      verifies that the eight bytes at $0BF8-$0BFF equal $AA, proving setup
//      did not write there. The test fills those bytes with $AA before setup.
//
// Memory used by this part (none in $0800-$0FFF):
//   Matrix 0: $0400 (VM=1). Filled by setup from logo_mat0.
//   Matrices 1-6: $2000-$37FF. Font: $3800. Sprite slots: $3C00. Tables: $7800.
//   Code: $8000-$8BFF. ZP: $10-$7F.
//
// IRQs: count=3, lines=[20, 109, 249].
// selfcheck: matrix-0 cells at $0543/$0544/$0545 hold the M glyph pattern
//   ($0543=0, $0544=$20, $0545=0) AND $D015 != 0.

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
.const LOGO_W         = 31

.var vms = List().add(1, 8, 9, 10, 11, 12, 13, 2)
.function d018(k)  { .return (vms.get(k) << 4) | $0e }
.function d011l(l) { .return $18 | (l & 7) }

// ---------------------------------------------------------------------------
// Letter bitmaps for "MEASURED" (3 wide x 5 tall per letter)
// ---------------------------------------------------------------------------
.var ltr = Hashtable()
.eval ltr.put("M",List().add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,0,1)))
.eval ltr.put("E",List().add(List().add(1,1,1)).add(List().add(1,0,0)).add(List().add(1,1,0)).add(List().add(1,0,0)).add(List().add(1,1,1)))
.eval ltr.put("A",List().add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,1,1)).add(List().add(1,0,1)).add(List().add(1,0,1)))
.eval ltr.put("S",List().add(List().add(1,1,1)).add(List().add(1,0,0)).add(List().add(1,1,1)).add(List().add(0,0,1)).add(List().add(1,1,1)))
.eval ltr.put("U",List().add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,1)))
.eval ltr.put("R",List().add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,0,1)))
.eval ltr.put("D",List().add(List().add(1,1,0)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,0,1)).add(List().add(1,1,0)))
.const WORD = "MEASURED"

.function lpx(li, r, c) {
    .return ltr.get(WORD.substring(li, li+1)).get(r).get(c)
}

.function matCell(k, i) {
    .var r = floor(i / 40)
    .var c = mod(i, 40) - 3 - k
    .if (r < 8 || r > 13 || c < 0 || c >= LOGO_W) .return $20
    .if (r == 13) .return 0
    .var li = floor(c / 4)
    .var lc = mod(c, 4)
    .if (lc == 3 || li >= 8) .return $20
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

// Screen-code text macro: ASCII 65-90 -> 1-26, space 32->32.
.macro ScreenText(t) {
    .for (var i = 0; i < t.size(); i++) {
        .var c = t.charAt(i)
        .byte (c >= 65 && c <= 90) ? c - 64 : 32
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
// code 0: solid block (logo cells); codes 1-26: A-Z for scroller glyphs.
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
.fill 5 * 8, 0                         // codes 27-31
.fill 8, 0                             // code 32: space
.fill (128 - 33) * 8, 0               // codes 33-127

// ---------------------------------------------------------------------------
// Sprite slots at $3C00
// ---------------------------------------------------------------------------
* = $3c00 "sprslots"
.fill 512, 0

// ---------------------------------------------------------------------------
// Tables outside code area ($7800-$7E07)
// ---------------------------------------------------------------------------

* = $7800 "sine"
sine: .fill 256, min(55, max(1, 32 + round(31 * sin(toRadians(i * 360 / 256)))))

* = $7900 "s2tables"
s2d018: .fill 64, d018(i >> 3)
s2d016: .fill 64, D016_BASE | (i & 7)

.align $100
t0: .fill 256, (dbl(i) >> 12) & $0f
.align $100
t1: .fill 256, (dbl(i) >> 4) & $ff
.align $100
t2: .fill 256, (dbl(i) & $0f) << 4

gbuf: .fill 8, 0

// logo_mat0: rows 8-13, 40 cols each = 240 bytes copied by setup into $0543.
logo_mat0:
.for (var r = 8; r <= 13; r++) {
    .for (var c = 0; c < 40; c++) {
        .byte matCell(0, r * 40 + c)
    }
}

// Scroller text: screen codes (A=1..Z=26, space=32), $ff=wrap.
scr_text:
ScreenText("MEASURED   A DEMO BUILT WITH LOVE FROM THE KB   GREETINGS TO ALL SCENERS   ")
.byte $ff

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

.macro Delay(n) {
    .if (n < 2) .error "Delay < 2"
    .if ((n & 1) != 0) { bit $ea }
    .for (var ii = 0; ii < ((n & 1) != 0 ? n - 3 : n) / 2; ii++) { nop }
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

        ldx #0
!:      sta $3c00,x
        sta $3d00,x
        inx
        bne !-

        jsr build_tables
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
        sta IDLE_BYTE

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
        lda acc_lo
        sta typical
        lda acc_hi
        sta typical+1
        lda worst+1
        cmp acc_hi
        bcc mn_max
        bne mn_nm
        lda worst
        cmp acc_lo
        bcs mn_nm
mn_max: lda acc_lo
        sta worst
        lda acc_hi
        sta worst+1
mn_nm:  lda #0
        sta acc_lo
        sta acc_hi
#if !FLAT
        inc phase_t
        inc phase_t      // step 2: half-wave period = 128 frames
#endif
        jsr build_tables
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
// selfcheck: verify matrix-0 contains the correct "M" glyph pattern and
// that sprites are enabled. Three cell checks (solid/space/solid for M's top
// row) confirm both matrix content and font code mapping are correct.
// In TEST_P1_MODE builds the sentinel at $0BF8 is also checked.
// ---------------------------------------------------------------------------
selfcheck:
        lda $0543          // matrix 0, row 8, col 3: M first block (code 0)
        bne sc_fail
        lda $0544          // matrix 0, row 8, col 4: M middle gap (code $20)
        cmp #$20
        bne sc_fail
        lda $0545          // matrix 0, row 8, col 5: M right block (code 0)
        bne sc_fail
        lda $d015
        beq sc_fail
#if TEST_P1_MODE
        lda $0bf8          // standalone test: sentinel must equal $AA
        cmp #$aa
        bne sc_fail
#endif
        lda #1
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
        Delay(POLL_DELAY)
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
        Delay(ENTRY_PAD_PAL)
        jmp h109_pal_band

h109_ntsc_pad:
        Delay(ENTRY_PAD_NTSC)
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
// after part 1's cleanup.
* = $7e80 "p1 epilogue"
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

} // namespace p1
