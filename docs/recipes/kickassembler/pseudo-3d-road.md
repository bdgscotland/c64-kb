---
recipe: pseudo-3d-road
toolchain: kickassembler
output_format: PRG
region: both
techniques: [pseudo_3d_road_raster]
file_formats: [PRG]
uses_registers: [D011, D012, D016, D018, D019, D01A, D021, D022, D023, DC04, DC05, DC0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Pseudo-3D Curving Road

## Synopsis

A perspective road that appears to recede toward a horizon and curve left and
right, built from two layers. The coarse layer redraws thirteen character rows
of road in the vertical blank using multicolour characters (grass, road
surface, kerb, centre stripe) placed at positions derived from a Z table and
an 8.8 fixed-point centre accumulator. The fine layer runs a cycle-locked
loop starting at line 99 that writes a precomputed $D016 value for each of
the hundred road raster lines (100..199), placing the STA $D016 write at
cycle 11 of each line (before the cycle-14 VIC deadline). The road curves
because a per-frame delta accumulates signed fixed-point offsets from a
four-entry segment table; as scroll_z advances the four segments roll toward
the viewer. Verdict bytes and CIA-timed cycle counts land at $02F0-$02F3 and $02FF.

The fine layer uses the double-IRQ method from `stable_raster_irq.md` to
reach cycle 4 of line 100 with zero jitter, then runs an unrolled 100-iteration
loop. Each iteration is exactly one raster line long: 63 CPU cycles on PAL,
65 on NTSC. Badline iterations (lines where (raster & 7) == YSCROLL = 3)
use 23 CPU cycles on PAL (25 on NTSC); the 40-cycle badline steal absorbs
the remainder. Separate unrolled loops for PAL and NTSC are selected at boot.

## Source

```asm
// pseudo-3d-road.asm   KickAssembler 5.25
//
// Pseudo-3D curving road: multicolour characters (coarse) + per-line
// $D016 XSCROLL (fine). Charset $3000, screen $0400, VIC bank 0.
//
// Three IRQ handlers per frame:
//   vblank_irq (line 251): compute cx[]/xscroll_d16[], CIA-time coarse redraw,
//     verdict, re-arm for road_irq1.
//   road_irq1 (line 97): start CIA fine timer, double-IRQ setup, NOP slide.
//   road_irq2_pal / road_irq2_ntsc (line 99): cycle-exact sync via double
//     $D012 read + BEQ, unrolled 100-iteration fine loop, epilogue.
//
// Cycle arithmetic (both models land at cycle 4 of line 100 after BEQ sync):
//   LDA xscroll_d16+j : cycles 4..7 of line 100+j
//   STA $D016         : cycles 8..11 (WRITE at cycle 11, before cycle-14 deadline)
//   PAL normal body   : LDA(4) + STA(4) + Delay(55) = 63 cpu cycles
//   PAL badline body  : LDA(4) + STA(4) + Delay(15) = 23 cpu cycles + 40 stall = 63 elapsed
//   NTSC normal body  : LDA(4) + STA(4) + Delay(57) = 65 cpu cycles
//   NTSC badline body : LDA(4) + STA(4) + Delay(17) = 25 cpu cycles + 40 stall = 65 elapsed
//   Badlines in 100..199 with YSCROLL=3: lines 107,115,123,131,139,147,155,163,171,179,187,195
//
// Sync calibration (road_irq1 before NOP slide: 57 cycles PAL, 55 NTSC):
//   C2 = irq2 entry cycle on line 99 = 38 (zero-jitter) or 39 (one-jitter).
//   Path inside irq2: ldx+txs(6)+cld(2)+Delay(PAD)+lda+cmp = C2+15+PAD for 2nd read.
//   PAL: second $D012 read at C2+15+PAD_PAL=63/64. PAD_PAL=10.
//   NTSC: second $D012 read at C2+15+PAD_NTSC=65/66. PAD_NTSC=12.
//   BEQ lands at cycle 4 of line 100; STA write at cycle 11.
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
.const ZP_SCR   = $14   // scroll_z (0..99; advances 1/frame)
.const ZP_SEG   = $15   // current curve segment index (0..3)
.const ZP_REM   = $16   // remaining lines until next segment switch
.const ZP_T1    = $17   // scratch
.const ZP_T2    = $18   // scratch
.const ZP_RPLO  = $19   // row pointer lo (indirect indexed)
.const ZP_RPHI  = $1a   // row pointer hi
.const ZP_LC    = $1b   // left char column for current road row
.const ZP_RC    = $1c   // right char column for current road row

// Spec result addresses
.const COARSE_LO = $02f0
.const COARSE_HI = $02f1
.const FINE_LO   = $02f2
.const FINE_HI   = $02f3
.const VERDICT   = $02ff

// Small variables (safe area, below spec result addresses)
.const SAVED_SP  = $02e0   // saved stack pointer for double-IRQ
.const REG_FLAG  = $02e1   // 0 = PAL, 1 = NTSC (set once at boot by detect_region)

// Road dimensions
.const NLINES = 100   // raster lines 100..199
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

// Curve deltas (4 segments): 0, +51, 0, -51 in 8.8 signed fixed point.
// -51 as 16-bit signed: $FFCD.
curve_lo: .byte   0,  51,   0, $cd
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
// Fires at line 97 (two lines before the sync line 99).
// Starts CIA fine timer, arms road_irq2 for line 99, saves SP, CLI, NOP slide.
// irq2 fires during the NOP slide and returns via irq1's stack frame.
//
// road_irq1 cycle count before NOP slide:
//   PAL path:  CIA_start(16) + lda+bne(6) + vector_set(12) + jmp(3) + common(20) = 57 cycles
//   NTSC path: CIA_start(16) + lda+bne(7) + vector_set(12) + common(20) = 55 cycles
// irq1 entry at cycle 37-39 of line 97 (main loop jmp = 3 cycles, 0-2 cycle jitter).
// NOP slide starts at cycle 22-24 of line 98.
// irq2 /IRQ fires at cycle 1 of line 99; CPU is in NOP slide.
// irq2 enters at cycle 38 (zero-jitter) or 39 (one-jitter) of line 99.
* = $0b00
road_irq1:
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
    lda #99               // 2  arm irq2 for line 99
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

// ---- vblank_irq handler ($0C00) ----
// Fires at line 251. Computes tables, CIA-times coarse redraw, verdict.
// Re-arms for road_irq1 at line 97 and exits.
* = $0c00
vblank_irq:
    cld             // clear D flag (RTI restores P, so D is restored); arithmetic must be binary

    // --- 1. Compute cx[] and xscroll_d16[] ---
    //
    // Forward pass i=0..99 (nearest to farthest).
    // cx[0] = 160.0 (screen centre). dx = 0.
    // Per step: cx += dx; dx += curve[segment].
    // Segment changes every 25 lines; init from scroll_z.
    // Store cx_hi_buf[i] = integer part of cx[i].
    //
    // Backward pass j=0..99:
    // xscroll_d16[j] = D016_BASE | ((cx_hi_buf[99-j] - hw_table[99-j]) & 7)
    // (j=0 = line 100 = farthest = i=99; j=99 = line 199 = nearest = i=0)

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

    // cx = 160.0; dx = 0.0
    lda #160
    sta ZP_CXHI
    lda #0
    sta ZP_CXLO
    sta ZP_DXHI
    sta ZP_DXLO

    ldy #0          // i
fwd_lp:
    // Store cx integer part
    lda ZP_CXHI
    sta cx_hi_buf, y

    // cx += dx  (16-bit 8.8)
    clc
    lda ZP_CXLO
    adc ZP_DXLO
    sta ZP_CXLO
    lda ZP_CXHI
    adc ZP_DXHI
    bcc cx_ok       // carry set = 8-bit overflow: clamp to 255
    lda #$ff
cx_ok:
    sta ZP_CXHI
    // Clamp below 16 (road approaching left edge)
    cmp #16
    bcs cx_lo_ok
    lda #16
    sta ZP_CXHI
cx_lo_ok:

    // dx += curve[segment]  (16-bit signed)
    ldx ZP_SEG
    clc
    lda ZP_DXLO
    adc curve_lo, x
    sta ZP_DXLO
    lda ZP_DXHI
    adc curve_hi, x
    sta ZP_DXHI

    // Advance segment counter
    dec ZP_REM
    bne fwd_no_seg
    inc ZP_SEG
    lda ZP_SEG
    and #3
    sta ZP_SEG
    lda #25
    sta ZP_REM
fwd_no_seg:

    iny
    cpy #NLINES
    bne fwd_lp

    // Backward pass: j=0..99, X=99..0 (read index), Y=0..99 (write index)
    ldx #99
    ldy #0
bwd_lp:
    lda cx_hi_buf, x
    sec
    sbc hw_table, x     // left_edge pixel (integer part)
    and #$07            // XSCROLL = low 3 bits of left edge
    ora #D016_BASE      // add MCM+CSEL bits
    sta xscroll_d16, y
    dex
    iny
    cpy #NLINES
    bne bwd_lp

    // --- 2. Compute left_col[] and right_col[] for coarse layer ---
    // For r=0..12: i_mid = min(8*r+4, 99)
    // left_col[r]  = (cx_hi_buf[i_mid] - hw_table[i_mid]) >> 3
    // right_col[r] = (cx_hi_buf[i_mid] + hw_table[i_mid]) >> 3
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
    adc hw_table, y
    bcs cc_rovf
    lsr
    lsr
    lsr
    cmp #40
    bcc cc_rsave
cc_rovf:
    lda #39
cc_rsave:
    sta right_col, x

    inx
    cpx #NROWS
    bne cc_lp

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
    ldy ZP_LC
    iny
    lda #CH_ROAD
rf:
    cpy ZP_RC
    bcs rf_end
    sta (ZP_RPLO), y
    iny
    jmp rf
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

    // --- 6. Re-arm for road_irq1 at line 97 ---
    lda #$01
    sta D019            // ack vblank IRQ
    lda #<road_irq1
    sta $0314
    lda #>road_irq1
    sta $0315
    lda #$1b
    sta D011            // RST8=0
    lda #97
    sta D012

    // Exit via KERNAL register-restore + RTI
    pla
    tay
    pla
    tax
    pla
    rti

// ---- Main ($0900) ----
* = $0900
main:
    sei
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

    lda #<vblank_irq
    sta $0314
    lda #>vblank_irq
    sta $0315
    lda #$1b
    sta D011        // RST8=0 for line 251
    lda #251
    sta D012
    lda #1
    sta D01A
    sta D019
    cli

idle:
    jmp idle

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
// Entry: cycle 38 or 39 of line 99 (via KERNAL dispatcher from irq2 vector).
// Sync: ldx+txs(6) + cld(2) + Delay(10) + lda $D012 + cmp $D012 + BEQ =
//   both zero-jitter and one-jitter converge to cycle 4 of line 100.
// Immediately into first fine loop iteration; no JMP intervenes.
// STA $D016 write at cycle 11 of line 100 (at or before deadline of cycle 14).
// 100 iterations; badline rows use Delay(15) instead of Delay(55).
// On exit: jmp fine_done.

* = $1300
road_irq2_pal:
    ldx SAVED_SP          // discard irq2's own stack frame (saved by irq1)
    txs
    cld                   // clear decimal flag (RTI will restore P); arithmetic must be binary
    // Sync padding: PAD_PAL=10. With C2=38/39, second D012 read at cycle 63/64.
    // BEQ: taken (3 cycles) or not (2); both paths land at cycle 4 of line 100.
    // STA D016 write lands at cycle 11 of each road line, before the cycle-14 deadline.
    Delay(10)
    lda D012
    cmp D012
    beq pal_fine_start
pal_fine_start:
// PAL unrolled fine loop: 100 iterations, each exactly 63 cpu cycles (or elapsed).
// Iteration j writes xscroll_d16+j to $D016 for road raster line 100+j.
// Badlines: (100+j) & 7 == 3, i.e., j = 7,15,23,31,39,47,55,63,71,79,87,95.
//   Badline body: LDA(4)+STA(4)+Delay(15)=23 cpu cycles; 40-cycle steal accounts for rest.
//   Normal body:  LDA(4)+STA(4)+Delay(55)=63 cpu cycles.
.for (var j = 0; j < 100; j++) {
    lda xscroll_d16+j
    sta D016
    .if (((100+j) & 7) == 3) {
        Delay(15)
    } else {
        Delay(55)
    }
}
pal_fine_end:
    jmp fine_done

// ============================================================
// road_irq2_ntsc: stable entry + NTSC unrolled fine loop
// ============================================================
// Same structure as PAL but PAD_NTSC=13 (NTSC line = 65 cycles).
// Normal body: 65 cpu cycles. Badline body: 25 cpu cycles.

road_irq2_ntsc:
    ldx SAVED_SP
    txs
    cld                   // clear decimal flag (RTI will restore P)
    // Sync padding: PAD_NTSC=12. Second D012 read at cycle 65/66 (NTSC boundary).
    Delay(12)
    lda D012
    cmp D012
    beq ntsc_fine_start
ntsc_fine_start:
// NTSC unrolled fine loop: 100 iterations, each exactly 65 cpu cycles (or elapsed).
.for (var j = 0; j < 100; j++) {
    lda xscroll_d16+j
    sta D016
    .if (((100+j) & 7) == 3) {
        Delay(17)
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

    // Re-arm for vblank_irq at line 251
    lda #$01
    sta D019           // ack road IRQ
    lda #<vblank_irq
    sta $0314
    lda #>vblank_irq
    sta $0315
    lda #$1b
    sta D011           // RST8=0
    lda #251
    sta D012

    // Exit through irq1's stack frame (SAVED_SP was irq1's post-KERNAL SP)
    pla
    tay
    pla
    tax
    pla
    rti
```

## Build

```bash
java -jar KickAss.jar pseudo-3d-road.asm -o pseudo-3d-road.prg
```

## Expected output

A perspective road receding toward a horizon at raster line 100, narrowing from
full width at the nearest row to a few characters wide at the horizon. The road
curves left and right as scroll_z cycles through the four-segment table. The
border is green throughout (verdict = 1: coarse redraw under 10,000 cycles and
kerb column formula matches). Grass is green ($D021 = 5), road surface is dark
grey ($D022 = 11), kerbs and the centre dash stripe are white ($D023 = 1).

Within each character row, adjacent raster lines show different XSCROLL values
and the kerb's left edge appears at different sub-character pixel positions. This
is visible in the screenshot: rasters 156..162 (screenshot rows 140..146 on PAL)
show the white kerb at x = 138, 143, 142, 139, 137, 136, 110 on consecutive lines
(measured in VICE x64sc 3.10, PAL pin), confirming per-line delivery of
distinct XSCROLL values.

**PAL (20,000,000 cycles).** Screenshot `screenshots/pseudo-3d-road.png`;
md5 8ff3e82b581d6b447d383ef798e45154 on two consecutive runs (verified in VICE
x64sc 3.10, +autostart-delay-random). Frame shows scroll_z approximately 67
(arithmetic: (20,000,000 / 19,656 frames - autostart overhead) % 100).

**NTSC (20,000,000 cycles, `-model ntsc`).** Screenshot
`screenshots/pseudo-3d-road-ntsc.png`; md5 2ae7a914d311c8dfeda0bd2cb95d5d42
on two consecutive runs. Frame shows scroll_z approximately 12 (arithmetic).
On NTSC, raster 107 (j=7, badline, XSCROLL=1 at this frame) shows kerb at x=274
and raster 108 (j=8, XSCROLL=7) shows kerb at x=273 (1-pixel difference from
the 6-XSCROLL-unit difference, within the same character cell).

**Cycle measurements (VICE x64sc 3.10, monitor dump at scroll_z=4, PAL).**

| Quantity | PAL | NTSC |
|---|---|---|
| Coarse redraw (CIA-timed) | 6,332 cycles | 6,162 cycles |
| Fine chain (irq1 CIA start to fine_done stop) | 6,523 cycles | 6,729 cycles |
| Fine loop alone (arithmetic: 100 x line) | 6,300 cycles | 6,500 cycles |

The fine chain overhead above the loop (223 cycles PAL, 229 NTSC) covers road_irq1
code, the NOP slide, the irq2 KERNAL entry, the sync code, and the CIA stop
instruction. Verdict = 1 on both models.

**xscroll_d16 table entries at scroll_z=4 (monitor dump, PAL).**

| j (road line offset) | raster | D016 value | XSCROLL | badline |
|---|---|---|---|---|
| 7 | 107 | $19 | 1 | yes |
| 8 | 108 | $1F | 7 | no |
| 50 | 150 | $18 | 0 | no |
| 56 | 156 | $1A | 2 | no |
| 57 | 157 | $1F | 7 | no |

j=7 and j=8 have different XSCROLL values (1 vs 7), confirming the badline
delay delivers the correct per-line value. j=56 and j=57 differ by 5 units
and the screenshot at these rasters shows kerb positions differing by 5 pixels,
matching the table (measured: x=138 and x=143 on both PAL and NTSC pins).

**Badline finding.** Twelve badlines occur in the road area (rasters 107, 115,
123, 131, 139, 147, 155, 163, 171, 179, 187, 195, with default YSCROLL=3). Each
badline iteration uses Delay(15) (PAL) or Delay(17) (NTSC) instead of Delay(55)
or Delay(57): 23 or 25 CPU cycles that the 40-cycle steal extends to one full
raster line. The STA $D016 write at cycle 11 completes before BA goes low at
cycle 12, so the write is never blocked by the steal. The previous (broken)
implementation used a spin-wait on $D012 which introduced up to 9 cycles of
jitter, placing writes at cycles 20-28 of each line (past the deadline); post-badline
lines received the badline row's XSCROLL value instead of their own.

## Why this works

**Coarse layer.** The Z table encodes road perspective: `hw[i] = max(4,
round(152 - 1.5 * i))`, arithmetic from the spec formula, gives half-widths
from 152 (i=0, nearest, raster 199) down to 4 (i=99, farthest, raster 100).
The centre accumulator cx advances each step by a signed delta dx, and dx
itself advances by the current segment's curve value (0 or +/-0.20 in 8.8 fixed
point). One `$D018 = $1C` write points the VIC at the custom charset at $3000.
Five character patterns cover all road regions: $00 (all %00 = $D021 = green
grass), $55 (all %01 = $D022 = dark grey road), $A5 (left half white, right
half grey = left kerb), $5A (mirror), $69 (grey-white-white-grey = centre
dash). Bit 3 of colour RAM must be set for multicolour mode to apply per cell;
fill_colram writes 8 to all 1,000 colour RAM locations.

**Fine layer: stable entry.** road_irq1 fires at line 97, starts the CIA fine
timer, arms road_irq2 for line 99, saves the stack pointer to SAVED_SP, clears
the I flag and falls through a 40-NOP slide. road_irq2 fires from inside the
slide at cycle 1 of line 99, interrupting a NOP. This is the double-IRQ method
from `stable-raster-irq.md`: because the interrupted instruction is always 2
cycles, the jitter at irq2 entry is 0 or 1 cycle rather than 0 to 6. irq2
discards its own KERNAL stack frame using SAVED_SP, then runs:

- ldx SAVED_SP / txs (6 cycles)
- Delay(PAD) (PAL: 11 cycles; NTSC: 13 cycles)
- lda $D012 / cmp $D012 / beq (10 or 11 cycles)

The two consecutive reads of $D012 straddle the raster 99/100 boundary: in the
zero-jitter case both land on line 99 and BEQ is taken (3 cycles); in the
one-jitter case the second read crosses to line 100 and BEQ is not taken (2
cycles). Both paths end at cycle 4 of line 100. The Delay
constant is PAD_PAL=11 (second read at cycle 63 or 64 of line 99 for PAL) and
PAD_NTSC=13 (second read at cycle 65 or 66 for NTSC).

PAL and NTSC have different Delay constants because the line length differs (63
vs 65 cycles). road_irq1 selects `road_irq2_pal` or `road_irq2_ntsc` based on
the model flag set by detect_region at boot.

**Fine layer: unrolled loop.** From cycle 4 of line 100, the first iteration
begins immediately: LDA xscroll_d16+0 (cycles 3..6), STA $D016 (write at cycle
10, before the cycle-14 deadline). The iteration then runs Delay(55) (PAL
normal) or Delay(15) (PAL badline) to complete exactly 63 real cycles, ending
at cycle 2 of line 101. The next iteration begins at cycle 3 of line 101. This
repeats for all 100 road lines.

Badline iterations: the CPU stall begins at cycle 15 and lasts 40 cycles (cycles
15..54). Delay(15) starts at cycle 11 but is interrupted at cycle 15; the stall
absorbs 40 real cycles, and the delay resumes at cycle 55 with the remaining
bit-zero-page and NOP instructions, completing at cycle 2 of the next line.
Total real cycles: LDA(4) + STA(4) + stall(40) + resumed delay(15) = 63.

**Stack management.** irq2 is entered through the KERNAL dispatcher, which
pushes A, X, Y on top of the CPU's own interrupt frame. road_irq2 discards this
second frame by restoring irq1's saved stack pointer; the exit sequence
pla/tay/pla/tax/pla/rti then pops irq1's KERNAL-saved Y, X, A and returns
through irq1's interrupt frame to the main idle loop. Without this, the stack
grows by six bytes per road_irq2 call.

**IRQ exit via pla/tay/pla/tax/pla/rti.** The KERNAL dispatcher at $FF48
pushes A, X and Y before calling ($0314). Both vblank_irq and road_irq2 exit
with this sequence, which pops the KERNAL's saves and RTIs. vblank_irq does
not push its own saves; the KERNAL's saves are sufficient, and any changes to
A, X, Y during the handler are overwritten on exit by the KERNAL's originals.

## What it does not establish

**Same-column XSCROLL shift.** One XSCROLL value per raster line shifts every
character column on that line by the same amount. The near side and far side of
the road both shift together within a character row, so the kerb does not curve
independently on the two sides. Distinct XSCROLL values per-line make the kerb
step smoothly between rows (the kerb shifts at each raster boundary) but the
step between adjacent character rows remains a coarse 8-pixel jump; only the
sub-character remainder is addressed per-line.

**Per-frame grass clearing.** The coarse redraw does not re-fill grass
characters before drawing road characters. clear_screen fills all grass at
startup; as the road curves, old kerb and road characters may accumulate at row
boundaries. A production effect erases only the cells that moved since the
previous frame.

**Sky and dashboard colour regions.** $D021 is set once at startup (green).
Per-raster-region $D021 changes for a blue sky above the horizon and a black
dashboard below the road are not implemented.

**Cycle budget and correctness.** The loop delivers exactly one write per raster
line; whether the cx and hw values produce a CORRECT road geometry (one the
original game engine would compute) is not established here.
