---
recipe: pseudo-3d-road
toolchain: kickassembler
output_format: PRG
region: both
techniques: [pseudo_3d_road_raster]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D021, D022, D023, DC04, DC05, DC0E]
uses_kernal: []
claims: [irq_vector_0314 (owns), cia1_timer_b (init), cia1_tod (init)]
harness: [cia1_timer_a]
---

<!-- doc-type: recipe -->

# KickAssembler — Pseudo-3D Curving Road

## Synopsis

A perspective road that recedes toward a horizon, built from two layers.
The coarse layer draws thirteen character rows of road in multicolour
characters (grass, road surface, kerb, centre stripe) at positions derived
from a Z table and an 8.8 fixed-point centre accumulator. The fine layer
writes a precomputed $D016 value on cycle 4 of each of the hundred road
lines (100..199), so each line gets its own XSCROLL. Both facts are
measured in VICE x64sc 3.10, PAL and NTSC: the write cycle on every frame
of a 20,000,000-cycle run from the monitor, and each line's XSCROLL from
the screenshot. The road curves left and right as scroll_z rolls a
four-entry curve table toward the viewer: in the PAL screenshot the far row
is centred 88 pixels left of the near row, in the NTSC one 95 pixels right.
(An earlier version added the signed curve delta as unsigned, so the road
only bent right and pinned at the right edge; see "Road geometry".) Verdict
bytes and CIA-timed cycle counts land at $02F0-$02F3 and $02FF.

The fine layer uses the double-IRQ method from `stable-raster-irq.md` to
reach a fixed cycle of line 98, crosses badline 99 with a fixed delay, then
runs an unrolled 100-iteration loop: 63 CPU cycles per normal line on PAL,
65 on NTSC, and 20 (PAL) or 22 (NTSC) on the badline rows (lines where
(raster & 7) == YSCROLL = 3), which lose 43 cycles to the stall. Separate
loops for PAL and NTSC are selected at boot. The table computation and the
coarse redraw run in the main program, one road step every two frames; the
fine loop runs every frame. (An earlier version of this listing wrote on
cycle 56 of the line, one line late, and did all the work in a vertical-blank
IRQ that overran into the next frame, so the whole effect ran only every
second frame; see "Fine layer: unrolled loop".)

## Source

```asm
// pseudo-3d-road.asm   KickAssembler 5.25
//
// Pseudo-3D curving road: multicolour characters (coarse) + per-line
// $D016 XSCROLL (fine). Charset $3000, screen $0400, VIC bank 0.
//
// Two IRQ handlers per frame and a main loop:
//   road_irq1 (line 95): start CIA fine timer, arm road_irq2, NOP slide.
//   road_irq2_pal / road_irq2_ntsc (line 97): sync on the 97/98 boundary
//     (double $D012 read + BEQ), entry delay across badline 99, unrolled
//     100-iteration fine loop, fine_done (line 200).
//   main loop: compute the next tables (about 11,300 cycles, interrupted
//     by the fine loop), wait for fine_done, publish them (copy + CIA-timed
//     coarse redraw + verdict, lines 201..1 PAL, 201..47 NTSC). One road
//     step every two frames; the fine loop runs every frame.
//
// Fine loop timing, measured in the VICE x64sc monitor on every frame of a
// 20,000,000-cycle run: each STA $D016 writes on cycle 4 of its own line
// 100+j, PAL and NTSC. The write must land before the line's display
// starts; see the page for the window.
//   Normal body  : LDA(4) + STA(4) + Delay(55 PAL / 57 NTSC) = one line
//   Badline body : LDA(4) + STA(4) + Delay(12 PAL / 14 NTSC) = 20 / 22 cpu
//                  cycles; the badline stall takes cycles 12..54, 43 cycles,
//                  because the body is reading (NOPs) when BA falls.
//   Badlines in 100..199 with YSCROLL=3: lines 107,115,...,195 (and 99).
//
// Verdict $02FF = 1 if coarse < 10 000 cycles AND kerb column matches.
// Coarse cycles at $02F0/$02F1; fine chain (irq1 start to fine_done) at $02F2/$02F3.

BasicUpstart2(main)

// ---- Memory map ----
.const SCREEN   = $0400
.const CHARSET  = $3000
.const COLRAM   = $d800

// VIC registers
.const D011 = $d011
.const D012 = $d012
.const D016 = $d016
.const D018 = $d018
.const D019 = $d019
.const D01A = $d01a
.const D020 = $d020
.const D021 = $d021
.const D022 = $d022
.const D023 = $d023

// CIA1 timer A
.const CIA_TALO = $dc04
.const CIA_TAHI = $dc05
.const CIA_CRA  = $dc0e
.const CIA_ICR  = $dc0d

// Character codes (multicolour char pixel encoding)
// %00 -> $D021 (green, grass bg)   CH_GRASS: all $00
// %01 -> $D022 (dark grey, road)   CH_ROAD:  all $55
// %10 -> $D023 (white, kerb)       CH_KLEFT: $a5; CH_KRIGHT: $5a
// %11 -> colour RAM (bit3 set)     CH_DASH:  $69 (grey-white-white-grey)
.const CH_GRASS  = 0
.const CH_ROAD   = 1
.const CH_KLEFT  = 2
.const CH_KRIGHT = 3
.const CH_DASH   = 4

// VIC colours
.const C_GREEN  = 5
.const C_DGREY  = 11
.const C_WHITE  = 1
.const C_BLACK  = 0
.const C_RED    = 2
.const C_BLUE   = 6

// $D016 constant bits: MCM (bit4=1), CSEL/40col (bit3=1), XSCROLL=0
.const D016_BASE = $18

// Zero page
.const ZP_CXHI  = $10   // cx high byte  (integer pixel; 8.8 fixed point)
.const ZP_CXLO  = $11   // cx low byte   (8.8 fraction)
.const ZP_DXHI  = $12   // dx high byte  (signed per-line-per-line curvature)
.const ZP_DXLO  = $13   // dx low byte
.const ZP_SCR   = $14   // scroll_z (0..99; advances once per publish, every second frame)
.const ZP_SEG   = $15   // current curve segment index (0..3)
.const ZP_REM   = $16   // remaining lines until next segment switch
.const ZP_T1    = $17   // scratch
.const ZP_T2    = $18   // scratch
.const ZP_RPLO  = $19   // row pointer lo (indirect indexed)
.const ZP_RPHI  = $1a   // row pointer hi
.const ZP_LC    = $1b   // left char column for current road row
.const ZP_RC    = $1c   // right char column for current road row
.const ZP_CVLO  = $1d   // curve[segment] lo, the current dx step
.const ZP_CVHI  = $1e   // curve[segment] hi

// Spec result addresses
.const COARSE_LO = $02f0
.const COARSE_HI = $02f1
.const FINE_LO   = $02f2
.const FINE_HI   = $02f3
.const VERDICT   = $02ff

// Small variables (safe area, below spec result addresses)
.const SAVED_SP  = $02e0   // saved stack pointer for double-IRQ
.const REG_FLAG  = $02e1   // 0 = PAL, 1 = NTSC (set once at boot by detect_region)
.const FRAMES    = $02e2   // incremented by fine_done once a frame

// Road dimensions
.const NLINES = 100   // raster lines 100..199

// Fine-layer timing constants, each found by measurement (see the page).
.const SYNC_PAD_PAL   = 11   // puts the two $D012 reads across the 97/98 boundary
.const SYNC_PAD_NTSC  = 13
.const ENTRY_PAD_PAL  = 76   // sync to the first write on cycle 4 of line 100
.const ENTRY_PAD_NTSC = 80
.const BADLINE_PAD_PAL  = 12 // 20 cpu cycles + 43 stall = 63
.const BADLINE_PAD_NTSC = 14 // 22 cpu cycles + 43 stall = 65
.const NROWS  = 13    // character rows 6..18 (r=0=nearest=row18 .. r=12=farthest=row6)

// Delay(n): exactly n cpu cycles of straight-line code, n >= 2.
.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

// ---- Working tables ($1100) ----
* = $1100
cx_hi_buf:    .fill NLINES, 0          // cx integer part per i=0..99 (i=0=nearest)
xscroll_d16:  .fill NLINES, D016_BASE  // $D016 value per road line (index 0=line 100)
left_col:     .fill NROWS, 0
right_col:    .fill NROWS, 0
old_left:     .fill NROWS, 0           // left_col and right_col as last drawn
old_right:    .fill NROWS, 0

// ---- Static tables ($1200) ----
* = $1200
// hw[i] = max(4, round(152-1.5*i)), i=0..99. Arithmetic from spec.
hw_table:
    .byte 152,151,149,148,146,145,143,142,140,139
    .byte 137,136,134,133,131,130,128,127,125,124
    .byte 122,121,119,118,116,115,113,112,110,109
    .byte 107,106,104,103,101,100, 98, 97, 95, 94
    .byte  92, 91, 89, 88, 86, 85, 83, 82, 80, 79
    .byte  77, 76, 74, 73, 71, 70, 68, 67, 65, 64
    .byte  62, 61, 59, 58, 56, 55, 53, 52, 50, 49
    .byte  47, 46, 44, 43, 41, 40, 38, 37, 35, 34
    .byte  32, 31, 29, 28, 26, 25, 23, 22, 20, 19
    .byte  17, 16, 14, 13, 11, 10,  8,  7,  5,  4

// Curve deltas (4 segments): 0, +18, 0, -18 in 8.8 signed fixed point
// (0.07 pixel per line per line). -18 as 16-bit signed: $FFEE. 18 keeps cx
// in 72..247 and cx - hw >= 8 for every scroll_z; 20 or more hits a clamp.
curve_lo: .byte   0,  18,   0, $ee
curve_hi: .byte   0,   0,   0, $ff

// Screen base addresses for road rows r=0..12 (row 18 down to row 6).
// SCREEN + row*40. Precomputed: row18=$06D0, row17=$06A8, ..., row6=$04F0.
road_lo: .byte $d0,$a8,$80,$58,$30,$08,$e0,$b8,$90,$68,$40,$18,$f0
road_hi: .byte $06,$06,$06,$06,$06,$06,$05,$05,$05,$05,$05,$05,$04

// ---- detect_region subroutine ($0A00) ----
// Sets REG_FLAG = 0 (PAL) or 1 (NTSC). Call with SEI; re-enables interrupts on exit.
// Method: track $D012 while RST8 is set; last value is $37 on PAL, $06/$05 on NTSC.
* = $0a00
detect_region:
    sei
dr_wait_lo:
    bit D011
    bmi dr_wait_lo        // let any current RST8 band finish
dr_wait_hi:
    bit D011
    bpl dr_wait_hi        // wait for RST8 to set (line 256)
dr_track:
    lda D012              // sample low byte
    bit D011
    bpl dr_band_over      // keep only if RST8 still set
    tax
    jmp dr_track
dr_band_over:             // X = last $D012 in band: $37=PAL, $06/$05=NTSC
    lda #0
    cpx #$10
    bcs dr_set_flag       // $10 or above: PAL, flag=0
    lda #1                // below $10: NTSC, flag=1
dr_set_flag:
    sta REG_FLAG
    cli
    rts

// ---- road_irq1 handler ($0B00) ----
// Fires at line 95. Starts the CIA fine timer, arms road_irq2 for line 97,
// saves SP, CLI, NOP slide. irq2 fires during the slide, so its entry
// jitter is 0 or 1 cycle, and it returns through irq1's stack frame.
// Lines 95..97 are not badlines; line 99 is (99 & 7 = 3), which is why the
// sync happens on the 97/98 boundary and not on line 99.
* = $0b00
road_irq1:
    cld                   // irq2 runs inside this handler and inherits D clear
    // Start CIA fine timer (will run until fine_done stops it)
    lda #$ff              // 2
    sta CIA_TALO          // 4
    sta CIA_TAHI          // 4
    lda #$11              // 2  (START, PHI2 clock, continuous)
    sta CIA_CRA           // 4  = 16 cycles

    // Select road_irq2 based on model
    lda REG_FLAG          // 4
    bne ri1_ntsc          // 2 (PAL: not taken); 3 (NTSC: taken)
ri1_pal:
    lda #<road_irq2_pal   // 2
    sta $0314             // 4
    lda #>road_irq2_pal   // 2
    sta $0315             // 4
    jmp ri1_common        // 3
ri1_ntsc:
    lda #<road_irq2_ntsc  // 2
    sta $0314             // 4
    lda #>road_irq2_ntsc  // 2
    sta $0315             // 4
ri1_common:
    lda #97               // 2  arm irq2 for line 97
    sta D012              // 4
    lda #$01              // 2
    sta D019              // 4  ack irq1
    tsx                   // 2
    stx SAVED_SP          // 4  save SP for irq2 to discard irq2's own frame
    cli                   // 2  allow irq2 to fire during NOP slide

    // NOP slide: 40 NOPs = 80 cycles.
    // irq2 fires before this completes and returns through irq1's frame.
    .for (var i = 0; i < 40; i++) { nop }

    // Should not reach here. Safety exit.
    pla
    tay
    pla
    tax
    pla
    rti

// ---- compute ($0C00), called from the main loop ----
// Builds cx_hi_buf[], xscroll_next[], left_col[] and right_col[] for the
// current scroll_z. About 11,300 cycles, so it runs in the main program,
// where road_irq1 can interrupt it; the fine loop meanwhile reads
// xscroll_d16[], which only publish changes.
* = $0c00
compute:

    // --- 1. Compute cx[] and xscroll_next[] in one pass ---
    //
    // i = 0..99, nearest to farthest (i = 0 is raster 199).
    // cx[0] = 160.0 (screen centre), dx = 0.
    // Per step: cx += dx (signed, clamped to 0..255); dx += curve[segment].
    // Segment changes every 25 lines; init from scroll_z.
    // cx_hi_buf[i] = integer part of cx[i]
    // xscroll_next[99-i] = D016_BASE | ((cx_hi_buf[i] - hw_table[i]) & 7)
    // (index 99-i = j, the road line offset: line 100+j reads entry j)

    // Compute initial segment: scroll_z / 25 and scroll_z % 25
    lda ZP_SCR
    tax
    lda #0
    sta ZP_SEG
div25:
    cpx #25
    bcc div25_done
    txa
    sec
    sbc #25
    tax
    inc ZP_SEG
    jmp div25
div25_done:
    // X = scroll_z % 25; ZP_SEG = scroll_z / 25
    lda #25
    stx ZP_T1
    sec
    sbc ZP_T1
    sta ZP_REM      // remaining = 25 - (scroll_z % 25)
    ldx ZP_SEG
    lda curve_lo, x
    sta ZP_CVLO
    lda curve_hi, x
    sta ZP_CVHI

    // cx = 160.0; dx = 0.0
    lda #160
    sta ZP_CXHI
    lda #0
    sta ZP_CXLO
    sta ZP_DXHI
    sta ZP_DXLO

    ldy #0          // i = 0..99
    ldx #NLINES-1   // 99-i
fwd_lp:
    // Store cx integer part and this line's $D016 value
    lda ZP_CXHI
    sta cx_hi_buf, y
    sec
    sbc hw_table, y     // left edge pixel (integer part)
    and #$07            // XSCROLL = low 3 bits of left edge
    ora #D016_BASE      // add MCM+CSEL bits
    sta xscroll_next, x
    dex

    // cx += dx  (unsigned 8.8 plus signed 8.8)
    clc
    lda ZP_CXLO
    adc ZP_DXLO
    sta ZP_CXLO
    lda ZP_CXHI
    adc ZP_DXHI
    bit ZP_DXHI     // N = sign of dx; BIT leaves C alone
    bmi cx_neg
    bcc cx_ok       // dx >= 0: carry = past 255, clamp to 255
    lda #$ff
    bne cx_ok
cx_neg:
    bcs cx_ok       // dx < 0: carry clear = borrow below 0, clamp to 0
    lda #0
cx_ok:
    sta ZP_CXHI
    // Clamp below 16 (road approaching left edge)
    cmp #16
    bcs cx_lo_ok
    lda #16
    sta ZP_CXHI
cx_lo_ok:

    // dx += curve[segment]  (16-bit signed, held in ZP_CVLO/HI)
    clc
    lda ZP_DXLO
    adc ZP_CVLO
    sta ZP_DXLO
    lda ZP_DXHI
    adc ZP_CVHI
    sta ZP_DXHI

    // Advance segment counter
    dec ZP_REM
    bne fwd_no_seg
    stx ZP_T1
    lda ZP_SEG
    clc
    adc #1
    and #3
    sta ZP_SEG
    tax
    lda curve_lo, x
    sta ZP_CVLO
    lda curve_hi, x
    sta ZP_CVHI
    lda #25
    sta ZP_REM
    ldx ZP_T1
fwd_no_seg:

    iny
    cpy #NLINES
    bne fwd_lp

    // --- 2. Compute left_col[] and right_col[] for coarse layer ---
    // For r=0..12: i_mid = min(8*r+4, 99)
    // left_col[r]  = (cx_hi_buf[i_mid] - hw_table[i_mid]) >> 3
    // right_col[r] = min(39, (cx_hi_buf[i_mid] + hw_table[i_mid]) >> 3)
    ldx #0
cc_lp:
    txa
    asl
    asl
    asl             // r*8
    clc
    adc #4          // r*8 + 4
    cmp #NLINES
    bcc cc_iok
    lda #99
cc_iok:
    tay             // Y = i_mid

    lda cx_hi_buf, y
    sec
    sbc hw_table, y
    lsr
    lsr
    lsr             // >> 3 = char column
    cmp #40
    bcc cc_lsave
    lda #39
cc_lsave:
    sta left_col, x

    lda cx_hi_buf, y
    clc
    adc hw_table, y     // 9-bit sum: carry is bit 8
    ror                 // carry into bit 7: A = sum >> 1
    lsr
    lsr                 // A = sum >> 3, 0..63
    cmp #40
    bcc cc_rsave
    lda #39
cc_rsave:
    sta right_col, x

    inx
    cpx #NROWS
    bne cc_lp
    rts

// ---- publish, called from the main loop just after fine_done (line 200) ----
// Copies xscroll_next[] into xscroll_d16[], CIA-times the coarse redraw,
// advances scroll_z and writes the verdict. It must end before road_irq1
// at line 95; it ends by line 1 (PAL) or 47 (NTSC), see the page.
publish:
    ldx #NLINES-1
pub_cp:
    lda xscroll_next, x
    sta xscroll_d16, x
    dex
    bpl pub_cp

    // --- 3. CIA-timed coarse screen redraw ---
    lda #$ff
    sta CIA_TALO
    sta CIA_TAHI
    lda #$11            // bit4=LOAD, bit0=START; phi2 clock, continuous
    sta CIA_CRA

    ldx #0              // r = 0..12
rdr_lp:
    lda road_lo, x
    sta ZP_RPLO
    lda road_hi, x
    sta ZP_RPHI

    // Left kerb
    ldy left_col, x
    lda #CH_KLEFT
    sta (ZP_RPLO), y

    // Road fill from left_col+1 to right_col-1
    lda left_col, x
    sta ZP_LC
    lda right_col, x
    sta ZP_RC

    // Erase what the road left since the last redraw: grass on
    // old_left..LC-1 and RC+1..old_right. The fill below covers LC..RC.
    lda #CH_GRASS
    ldy old_left, x
er_l:
    cpy ZP_LC
    bcs er_l_end
    sta (ZP_RPLO), y
    iny
    bne er_l            // always taken, Y < 40
er_l_end:
    ldy old_right, x
er_r:
    cpy ZP_RC
    beq er_r_end
    bcc er_r_end
    sta (ZP_RPLO), y
    dey
    bpl er_r            // always taken, Y >= 1
er_r_end:
    lda ZP_LC
    sta old_left, x
    lda ZP_RC
    sta old_right, x

    ldy ZP_LC
    iny
    cpy ZP_RC
    bcs rf_end
    lda #CH_ROAD
rf:
    sta (ZP_RPLO), y
    iny
    cpy ZP_RC
    bcc rf
rf_end:

    // Right kerb
    ldy ZP_RC
    lda #CH_KRIGHT
    sta (ZP_RPLO), y

    // Centre dash: place CH_DASH at centre col if (r + scroll_z/8) & 1 == 0
    lda ZP_LC
    clc
    adc ZP_RC
    ror                 // A = (LC+RC)/2 (carry=0 since LC+RC<=78)
    tay                 // Y = centre column

    lda ZP_SCR
    lsr
    lsr
    lsr                 // scroll_z / 8
    stx ZP_T2           // save r
    clc
    adc ZP_T2           // + r
    and #1
    bne skip_dash
    lda #CH_DASH
    sta (ZP_RPLO), y
skip_dash:
    ldx ZP_T2
    inx
    cpx #NROWS
    bne rdr_lp

    // Stop coarse timer, record cycles
    lda #0
    sta CIA_CRA
    sec
    lda #$ff
    sbc CIA_TALO
    sta COARSE_LO
    lda #$ff
    sbc CIA_TAHI
    sta COARSE_HI

    // --- 4. Advance scroll_z ---
    inc ZP_SCR
    lda ZP_SCR
    cmp #NLINES
    bcc scr_ok
    lda #0
    sta ZP_SCR
scr_ok:

    // --- 5. Verdict ---
    // (a) coarse < 10000 ($2710)
    // (b) kerb col for row 18 (r=0, i_mid=4) == left_col[0]
    lda cx_hi_buf+4
    sec
    sbc hw_table+4
    lsr
    lsr
    lsr
    cmp left_col+0
    bne vfail
    lda COARSE_HI
    cmp #$27
    bcc vpass
    bne vfail
    lda COARSE_LO
    cmp #$11            // < $2711 passes "under 10000"
    bcc vpass
vfail:
    lda #0
    sta VERDICT
    lda #C_RED
    sta D020
    jmp vdone
vpass:
    lda #1
    sta VERDICT
    lda #C_GREEN
    sta D020
vdone:
    rts

// ---- Main ($0900) ----
* = $0900
main:
    sei
    cld             // compute and publish run here and need binary arithmetic
    lda #$7f
    sta CIA_ICR     // mask all CIA1 IRQ sources
    lda CIA_ICR     // clear pending CIA1 flag

    // Detect PAL vs NTSC before enabling display
    jsr detect_region   // sets REG_FLAG; re-enables interrupts on return

    sei                 // re-disable until fully set up

    lda #$1b
    sta D011        // DEN=1, RSEL=1, YSCROLL=3, bitmap=0, ECM=0
    lda #D016_BASE
    sta D016        // MCM=1, CSEL=1, XSCROLL=0
    lda #$1c
    sta D018        // VM=$0400, charset=$3000
    lda #C_GREEN
    sta D021        // %00 pixels = green (grass)
    lda #C_DGREY
    sta D022        // %01 pixels = dark grey (road)
    lda #C_WHITE
    sta D023        // %10 pixels = white (kerb/stripe)
    lda #C_BLUE
    sta D020        // border = blue initially (turns green on verdict pass)
    lda #0
    sta $d015       // sprites off

    jsr init_charset
    jsr fill_colram
    jsr clear_screen

    lda #0
    sta ZP_SCR

    lda #<road_irq1
    sta $0314
    lda #>road_irq1
    sta $0315
    lda #$1b
    sta D011        // RST8=0 for line 95
    lda #95
    sta D012
    lda #1
    sta D01A
    sta D019
    cli

    // One road step per pass: compute the next tables while the fine loop
    // shows the current ones, wait for fine_done, publish. Two frames a step.
main_loop:
    jsr compute
    lda FRAMES
wait_frame:
    cmp FRAMES
    beq wait_frame      // fine_done increments FRAMES at line 200
    jsr publish
    jmp main_loop

// ---- init_charset: 5 chars * 8 bytes at $3000 ----
init_charset:
    ldx #0
ics_lp:
    lda cs_data, x
    sta CHARSET, x
    inx
    cpx #40         // 5 * 8
    bne ics_lp
    rts

cs_data:
    .byte $00,$00,$00,$00,$00,$00,$00,$00   // CH_GRASS  (0): %00 all = green
    .byte $55,$55,$55,$55,$55,$55,$55,$55   // CH_ROAD   (1): %01 all = grey
    .byte $a5,$a5,$a5,$a5,$a5,$a5,$a5,$a5  // CH_KLEFT  (2): left %10 white, right %01 grey
    .byte $5a,$5a,$5a,$5a,$5a,$5a,$5a,$5a  // CH_KRIGHT (3): left %01 grey, right %10 white
    .byte $69,$69,$69,$69,$69,$69,$69,$69   // CH_DASH   (4): %01%10%10%01 = grey-white-white-grey

// ---- fill_colram: set bit3 in all colour RAM cells (enables MCM per cell) ----
fill_colram:
    ldx #0
    lda #8          // %1000: bit3=MCM enable
fcr_lp:
    sta COLRAM, x
    sta COLRAM+$100, x
    sta COLRAM+$200, x
    sta COLRAM+$300, x
    inx
    bne fcr_lp
    rts

// ---- clear_screen: fill with CH_GRASS ----
clear_screen:
    ldx #0
    lda #CH_GRASS
cls_lp:
    sta SCREEN, x
    sta SCREEN+$100, x
    sta SCREEN+$200, x
    sta SCREEN+$300, x
    inx
    bne cls_lp
    rts

// ============================================================
// road_irq2_pal: stable entry + PAL unrolled fine loop ($1300)
// ============================================================
// Entry at line 97 with 0 or 1 cycle of jitter. The two $D012 reads
// straddle the 97/98 boundary: BEQ is taken (3 cycles) when both read 97
// and not (2) when the second reads 98, so both paths leave on the same
// cycle of line 98. ENTRY_PAD then crosses line 98 and badline 99.
* = $1300
road_irq2_pal:
    ldx SAVED_SP          // discard irq2's own stack frame (saved by irq1)
    txs
    Delay(SYNC_PAD_PAL)
    lda D012
    cmp D012
    beq pal_sync
pal_sync:
    Delay(ENTRY_PAD_PAL)
pal_fine_start:
// Iteration j writes xscroll_d16+j to $D016 on cycle 4 of line 100+j.
.for (var j = 0; j < 100; j++) {
    lda xscroll_d16+j
    sta D016
    .if (((100+j) & 7) == 3) {
        Delay(BADLINE_PAD_PAL)
    } else {
        Delay(55)
    }
}
pal_fine_end:
    jmp fine_done

// ============================================================
// road_irq2_ntsc: the same for the 65-cycle NTSC line
// ============================================================
road_irq2_ntsc:
    ldx SAVED_SP
    txs
    Delay(SYNC_PAD_NTSC)
    lda D012
    cmp D012
    beq ntsc_sync
ntsc_sync:
    Delay(ENTRY_PAD_NTSC)
ntsc_fine_start:
.for (var j = 0; j < 100; j++) {
    lda xscroll_d16+j
    sta D016
    .if (((100+j) & 7) == 3) {
        Delay(BADLINE_PAD_NTSC)
    } else {
        Delay(57)
    }
}
ntsc_fine_end:
// fall through to fine_done

// ============================================================
// fine_done: epilogue shared by both fine loops
// ============================================================
fine_done:
    // Stop CIA fine timer (started in road_irq1)
    lda #0
    sta CIA_CRA
    sec
    lda #$ff
    sbc CIA_TALO
    sta FINE_LO
    lda #$ff
    sbc CIA_TAHI
    sta FINE_HI

    // Restore $D016 to base (XSCROLL=0)
    lda #D016_BASE
    sta D016

    inc FRAMES         // releases the main loop's publish

    // Re-arm road_irq1 for line 95 of the next frame
    lda #$01
    sta D019           // ack road IRQ
    lda #<road_irq1
    sta $0314
    lda #>road_irq1
    sta $0315
    lda #$1b
    sta D011           // RST8=0
    lda #95
    sta D012

    // Exit through irq1's stack frame (SAVED_SP was irq1's post-KERNAL SP)
    pla
    tay
    pla
    tax
    pla
    rti

// Next frame's $D016 values, built by compute, copied by publish.
* = $2f00
xscroll_next: .fill NLINES, D016_BASE
```

## Build

```bash
java -jar KickAss.jar pseudo-3d-road.asm -o pseudo-3d-road.prg
```

## Expected output

A road that is full width at the nearest row (raster 199) and a few
characters wide at the horizon (raster 100). It bends left in the PAL
screenshot and right in the NTSC one. The border is
green (verdict = 1: coarse redraw under 10,000 cycles and kerb column
formula matches). Grass is green ($D021 = 5), road surface dark grey
($D022 = 11), kerbs and the centre dash white ($D023 = 1).

Each road line shows its own XSCROLL. The check: dump screen RAM and
`xscroll_d16` at `fine_done`, render every road line from the screen codes,
the charset and XSCROLL 0..7, and compare with the screenshot row. On both
pins all 100 lines match their own table entry, and no other XSCROLL value
reproduces any of them. On PAL, rasters 147..162 (rows 12 and 13, left
kerb in column 5) carry XSCROLL 5, 5, 6, 5, 6, 6, 7, 6, 7, 7, 0, 7, 0, 0,
0, 0 and the first white kerb pixel sits at x = 72 + XSCROLL on every line.

**Road geometry in the screenshots.** For each of the 13 rows the kerb
columns in the dumped screen RAM equal the listing's arithmetic, and no
road, kerb or dash cell lies outside them; this held on every frame of both
runs after the first publish. The centre of the non-grass span on each
row's middle line:

| Row (raster) | PAL, scroll_z = 59: kerbs, centre x | NTSC, scroll_z = 24: kerbs, centre x |
|---|---|---|
| 18 (199) | columns 1..38, 191.5 | columns 1..38, 191.5 |
| 14 (167) | 6..30, 186.5 | 12..37, 238.5 |
| 10 (135) | 5..17, 125.5 | 24..36, 277.5 |
| 6 (103) | 8..9, 103.5 | 30..31, 286.5 |

x is the screenshot column; x = 32 is the first display pixel, so the
screen centre, cx = 160, is x = 192.

**PAL (21,100,000 cycles).** Screenshot `screenshots/pseudo-3d-road.png`,
md5 48362775112a3a141d47e797c5036ddc, the same with and without monitor
tracepoints (VICE x64sc 3.10, PAL c64c, `+autostart-delay-random`). The
frame shows scroll_z = 59 (monitor dump).

**NTSC (21,100,000 cycles, `-model ntsc`).** Screenshot
`screenshots/pseudo-3d-road-ntsc.png`, md5 15be311b61bc933ea7573d3527b66d81.
The frame shows scroll_z = 24 (monitor dump). (Earlier versions pinned
20,000,000 cycles; the pin moved so that one picture shows each bend.)

**Write cycles (VICE x64sc 3.10 monitor, a tracepoint on each of the 100
STA $D016, every frame of the 21,100,000-cycle run).**

| | PAL | NTSC |
|---|---|---|
| Frames traced | 920 | 1,052 |
| STA $D016 writes on | cycle 4 of line 100+j, every j, every frame | cycle 4 of line 100+j, every j, every frame |
| Loop span | first LDA on cycle 60 of line 99; `fine_done` on cycle 63 of line 199, after a 3-cycle JMP: 6,300 cycles of loop | first LDA on cycle 62 of line 99; `fine_done` on cycle 62 of line 199: 6,500 cycles |

Cycle numbers count from 1, so the monitor's CYC column plus one; on this
scale the badline stall starts on cycle 12.

**Which write cycles work.** Moving ENTRY_PAD moves every write by the same
amount. On both models all 100 lines matched their table entry for a write
from cycle 56 of the line before through cycle 12 of the line itself. A
write on cycle 54 of the line before matched 32 lines (31 on NTSC); one on
cycle 13 or 14 matched 88, failing on exactly the twelve badlines. Cycle 55
was not reached by the sweep. Cycle 4 sits 8 cycles inside the late edge.
These edges are what this picture shows: the first cells of most road lines
are grass, so a write that shifts only a line's first pixels can go unseen
here; the VIC's own window may be narrower than this sweep shows. The header comment of an earlier
version put a "cycle-14 deadline" on the write; on a badline it is cycle 12.
The sweep and the sync runs below were made before the geometry fix for
issue #73; that fix did not touch the IRQ handlers or the fine loop, which
assemble to the same bytes at the same addresses.

**Sync constants.** SYNC_PAD_PAL = 11 and SYNC_PAD_NTSC = 13 give one write
pattern on every frame. One cycle either side gives two patterns a cycle
apart, the 0-or-1-cycle irq2 jitter left uncorrected.

**Cycle measurements (CIA1 timer A, read from $02F0-$02F3 by the monitor).**

| Quantity | PAL | NTSC |
|---|---|---|
| Coarse redraw at scroll_z = 4 | 5,264 cycles | 5,264 cycles |
| Coarse redraw, range over the run | 5,257..5,422 | 5,257..5,422 |
| Fine chain (irq1 CIA start to fine_done stop) | 6,559..6,563 cycles | 6,766..6,770 cycles |
| Fine loop alone (measured span, above) | 6,300 cycles | 6,500 cycles |

The range leaves out the first redraw (8,324 cycles PAL, 8,582 NTSC),
which writes grass from column 0 because nothing has been drawn yet. The
fine chain above the loop (259..263 cycles PAL, 266..270 NTSC) covers
road_irq1, the NOP slide, the irq2 KERNAL entry, the sync, the entry delay
across line 99 and the CIA stop. It varies by up to 3 cycles because irq1
interrupts the main program mid-instruction. (An earlier version gave
6,332 and 6,162 cycles for the coarse redraw and 6,523 and 6,729 for the
fine chain; the redraw then ran during the display, where badlines steal
from it, and the chain started a line later. The redraw figures before
the #73 fix, 4,872..5,984 PAL and 4,873..6,027 NTSC, drew a road pinned
against column 39.)

**Main-loop timing (monitor tracepoints, every step of the run).**
`publish` takes 6,879..7,047 cycles and runs from line 201 to line 310..1
of the next frame on PAL and to line 44..47 on NTSC, before road_irq1 at
line 95 and outside rows 6..18. `compute` then runs, interrupted once by
the fine chain, and ends on line 280..285 (PAL) or line 58..63 (NTSC), so
the main loop waits for the next `fine_done`: one road step every two
frames, on all 457 PAL and 522 NTSC steps. Compute's first instruction to
its RTS is 17,747..17,884 cycles on PAL and 17,993..18,178 on NTSC; less
the fine chain that interrupts it, compute costs about 11,200..11,400
cycles with badline steals (arithmetic). (An earlier version gave 18,806
and about 12,200 cycles, and publish ending on line 304 PAL, line 38 NTSC.)

**xscroll_d16 at scroll_z = 4 (monitor dump, PAL; the same values from the
listing's arithmetic run in Python).** Every table dumped at `fine_done`
after the first publish, 919 of 920 PAL frames and 1,050 of 1,052 NTSC,
equals the arithmetic for one scroll_z.

| j (road line offset) | raster | $D016 value | XSCROLL | badline |
|---|---|---|---|---|
| 7 | 107 | $19 | 1 | yes |
| 8 | 108 | $1E | 6 | no |
| 50 | 150 | $1B | 3 | no |
| 56 | 156 | $18 | 0 | no |
| 57 | 157 | $1D | 5 | no |

(An earlier version gave $1F, $1E and $18 for j = 8, 56 and 57: the values
of the saturating arithmetic fixed under "Road geometry". One before that
gave $18, $1A and $1F for j = 50, 56 and 57, which were not the scroll_z = 4
values.)

**Badline finding.** Thirteen badlines touch the fine layer with YSCROLL = 3:
line 99, crossed by the entry delay, and rasters 107, 115, ..., 195 inside
the loop. The loop's body for a badline is 20 CPU cycles on PAL (22 on
NTSC): the write lands on cycle 4, the NOPs are reading when BA falls on
cycle 12, and the CPU gets cycles 1..11 and 55..63 of the line, losing
43. (An earlier version used 23 and 25 cycles against a 40-cycle steal; the
stall is 43 whenever the CPU is reading on cycles 12..14, so every badline
moved the rest of the loop 3 cycles later. An earlier implementation still
spun on $D012 and wrote on cycles 20..28.)

## Why this works

**Coarse layer.** The Z table encodes road perspective: `hw[i] = max(4,
round(152 - 1.5 * i))`, arithmetic from the spec formula, gives half-widths
from 152 (i=0, nearest, raster 199) down to 4 (i=99, farthest, raster 100).
The centre accumulator cx advances each step by a signed delta dx, and dx
itself advances by the current segment's curve value (0 or ±18/256, about
±0.07 pixel, in 8.8 fixed point). cx is unsigned and dx signed, so the add
reads the carry by dx's sign: with dx >= 0 a carry means past 255, with
dx < 0 a clear carry means below 0. The right kerb column is the 9-bit sum
cx + hw shifted right 3, carry rotated in. One `$D018 = $1C` write points the VIC at the custom charset at $3000.
Five character patterns cover all road regions: $00 (all %00 = $D021 = green
grass), $55 (all %01 = $D022 = dark grey road), $A5 (left half white, right
half grey = left kerb), $5A (mirror), $69 (grey-white-white-grey = centre
dash). Bit 3 of colour RAM must be set for multicolour mode to apply per cell;
fill_colram writes 8 to all 1,000 colour RAM locations.

**Fine layer: stable entry.** road_irq1 fires at line 95, starts the CIA
fine timer, arms road_irq2 for line 97, saves the stack pointer to SAVED_SP,
clears the I flag and falls through a 40-NOP slide. road_irq2 fires from
inside the slide on line 97. This is the double-IRQ method from
`stable-raster-irq.md`: because the interrupted instruction is always a
2-cycle NOP, the jitter at irq2 entry is 0 or 1 cycle. irq2 discards its own
KERNAL stack frame using SAVED_SP, then runs:

- ldx SAVED_SP / txs (6 cycles)
- Delay(SYNC_PAD) (PAL: 11 cycles; NTSC: 13 cycles)
- lda $D012 / cmp $D012 / beq (10 or 11 cycles)
- Delay(ENTRY_PAD) (PAL: 76; NTSC: 80), across line 98 and badline 99

The two reads of $D012 straddle the 97/98 boundary: with zero jitter both
read 97 and BEQ is taken (3 cycles); with one cycle of jitter the second
reads 98 and BEQ is not taken (2 cycles). Both paths leave on the same
cycle of line 98. The sync is on 97/98 because line 99 is a badline (99 & 7
= 3): an earlier version synced on 99/100 with irq1 at 97 and irq2 at 99,
where the stall landed in the IRQ entry and the sync, and its loop started
on cycle 49 (PAL) and moved by 2 cycles between frames. road_irq1 clears
the D flag; irq2 runs inside it and inherits that.

PAL and NTSC have different constants because the line length differs (63
vs 65 cycles). road_irq1 selects `road_irq2_pal` or `road_irq2_ntsc` from
the model flag set by detect_region at boot.

**Fine layer: unrolled loop.** Each normal iteration is LDA xscroll_d16+j,
STA $D016 and Delay(55) (PAL) or Delay(57) (NTSC): one line. Each badline
iteration uses Delay(12) or Delay(14): 20 or 22 CPU cycles plus the
43-cycle stall. The write is the STA's last cycle, cycle 4 of line 100+j.

Measured before this fix, in the same monitor, with Delay(15) and Delay(17)
on the badlines and the sync on line 99:

| Iterations j | PAL: write landed on | NTSC: write landed on |
|---|---|---|
| 0..6 | cycle 56 of line 100+j | cycle 54 of line 100+j |
| 8..14 | cycle 59 of line 100+j | cycle 57 of line 100+j |
| 40..46 | cycle 8 of line 101+j | cycle 4 of line 101+j |
| 96..99 | cycle 29 of line 101+j | cycle 25 of line 101+j |

Checked against the screenshot the same way as above, that listing showed
each line with the previous line's XSCROLL (0 of 100 lines matched their own
entry); lines where a write fell inside the displayed part matched no
single XSCROLL. (Before that, the page said the loop wrote on cycle 10 or 11 of every line and that
the badline stall ran from cycle 15 for 40 cycles. A badline leaves the CPU
20 cycles, 23 only when the instructions on cycles 12..14 are writes.)

**Main loop and frame rate.** The table computation costs about 11,300
cycles and `publish` about 7,000. Outside the fine chain a PAL
frame has about 13,100 cycles (19,656 - 6,562) and an NTSC frame about
10,300 (17,095 - 6,768), so one road step takes two frames. The redraw
must also not touch rows 6..18 while the beam draws them. So the main loop computes the next tables into
`xscroll_next` while the fine loop shows the current ones, waits for
`fine_done` to increment FRAMES at line 200, then `publish` copies the
tables and redraws the rows before line 95. (An earlier version did both in
an IRQ at line 251; measured, it ran until line 222 of the next frame,
missed that frame's line 97 interrupt, and so the fine loop ran every second
frame, with XSCROLL 0 and the redraw in progress on the frames between.)

Two NTSC frames leave about 20,600 cycles outside the fine chains, and the
pair needs about 18,300, so the margin is small. A first build of the #73
fix, with a separate backward pass for `xscroll_next`, the curve read
through `curve_lo,x` on every line and a 16-cycle fill loop, took 21,171
cycles for one compute and publish and fell to one road step every three
NTSC frames (measured). Writing `xscroll_next` in the forward pass, holding
curve[segment] in zero page and a 14-cycle fill loop brought it back to two.

**Road geometry.** `fwd_lp` adds the signed dx to the unsigned cx and
clamps by dx's sign (see "Coarse layer"). With curve steps of ±18/256, the
arithmetic run in Python for all 100 scroll_z values keeps cx in 72..247
and cx - hw at 8 or more, so no clamp fires and no left kerb column wraps;
±20 hits a clamp, and ±24 puts the left edge below 0. The four segments
are straight, right, straight, left, and dx starts at 0 on the nearest line
each frame, so the nearer bend is right for scroll_z 0..49 and left for
50..99. The screenshots show 59 (left) and 24 (right). (An earlier version added dx as if
unsigned and treated any carry as overflow, so a negative dx pinned cx at
255 at once and a positive dx of up to 5 pixels a line, from steps of
±51/256, saturated it within a few rows: the road bent right and never
left. Its right kerb clamped to column 39 whenever cx + hw passed 255, not
319, so near rows reached the right edge whatever cx was. Issue #73.)

**Clearing the grass.** `publish` keeps the kerb columns it last drew for
each row in `old_left` and `old_right`, writes grass on old_left..LC-1 and
RC+1..old_right, then draws LC..RC. Every cell outside the road is grass
after each redraw (checked on every frame of both runs). (An earlier
version wrote only LC..RC and listed clearing as not done; left kerbs and
road cells from earlier steps stayed on screen.)

**Stack management.** irq2 is entered through the KERNAL dispatcher, which
pushes A, X, Y on top of the CPU's own interrupt frame. road_irq2 discards this
second frame by restoring irq1's saved stack pointer; the exit sequence
pla/tay/pla/tax/pla/rti then pops irq1's KERNAL-saved Y, X, A and returns
through irq1's interrupt frame to the main loop. Without this, the stack
grows by six bytes per road_irq2 call.

**IRQ exit via pla/tay/pla/tax/pla/rti.** The KERNAL dispatcher at $FF48
pushes A, X and Y before calling ($0314). fine_done exits with this
sequence, which pops the KERNAL's saves and RTIs to the main loop with its
A, X and Y intact.

## What it does not establish

**Same-column XSCROLL shift.** One XSCROLL value per raster line shifts every
character column on that line by the same amount. The near side and far side of
the road both shift together within a character row, so the kerb does not curve
independently on the two sides. Distinct XSCROLL values per-line make the kerb
step smoothly between rows (the kerb shifts at each raster boundary) but the
step between adjacent character rows remains a coarse 8-pixel jump; only the
sub-character remainder is addressed per-line.

**Sky and dashboard colour regions.** $D021 is set once at startup (green).
Per-raster-region $D021 changes for a blue sky above the horizon and a black
dashboard below the road are not implemented.

**Sprites on the road.** The sprites are off: a sprite's fetches take
cycles from every line it is on, and the unrolled loop counts every
cycle. `road-sprite-lines.md` keeps each line's `$D016` store on one cycle
with three sprites moving over the road lines, by padding each line for
the sprites that fetch on it.

**Game-engine geometry.** cx is one byte, so the road centre can reach
display pixel 255 of 319 and no further. Whether these cx and hw values
match the road of any real game engine is not established here.
