// engine.asm: the KickAssembler half of the racer. The harness assembles it
// to build/asm.bin (raw bytes from $0880) and build/asm.h, which gives C an
// ASM_<LABEL> for every top-level label below.
//
//   irq_blank, irq_top, sync_pal/ntsc  the IRQ chain: line 251, 103, 105
//   road_a, road_b                     the road: one 64-byte block per raster
//                                      line 107-202, two copies (one shown,
//                                      one being built), then the HUD split
//   rb_init, rb_begin, rb_rows         the builder: per-line $D016, $D021 and
//                                      padding into the back copy, and the
//                                      road's character rows into the back screen
//   detect_model                       PAL or NTSC, from the last raster line
//   nmi_rti                            RESTORE lands here: the KERNAL is out
//
// Zero page: $D0-$D3 and $E0-$FF, the builder only (the KERNAL is banked
// out and never called; Oscar64 stays below $70: the Makefile's
// CLAIMS_ARGS). The IRQs use no zero page.
//
// How the road is drawn (c64-kb pseudo_3d_road_raster, with the sprites that
// recipe leaves out): every road line has one block of code, entered on
// cycle 2 of its line. A block stores the line's $D016 (XSCROLL: the curve,
// written on cycle 7) and $D021 (the grass band, or the sky above the
// horizon: the hill, written on cycle 13), then branches into a slide of
// CMP #$C9 bytes that makes the line 63 cycles (65 on NTSC). A badline
// block stores $D016 only: the VIC holds the bus from cycle 12 to 54, and
// the line keeps the colour of the line above. Sprites 0-2 fetch their data
// at the end of a line and stall the CPU for 5 + 2 * (last - first) cycles,
// last and first being the highest and lowest of them on that line (c64-kb
// docs/hardware/vic-ii-reference.md, Sprite DMA; the arithmetic of
// recipes/kickassembler/dysp.md). The builder knows each sprite's Y, so it
// pads every line by what its sprites leave. Sprites 3-7 would stall the
// start of a line, where the stores are: they stay off.

.const ROAD_TOP   = 107         // first road line: row 7, a badline (YSCROLL 3)
.const ROAD_LINES = 96          // lines 107-202, rows 7-18
.const HUD_LINE   = ROAD_TOP + ROAD_LINES   // 203: row 19, a badline
.const IRQ_TOP    = 101         // the double IRQ: 101, then 105 (103 before: see irq_top)
.const SYNC_LINE  = 105         // lines 100-106: no badline, no sprite fetch
.const BLANK_LINE = 251         // below the last display line on PAL and NTSC
.const H_MIN      = 108         // the horizon's highest line (hoff 0)
.const HOFF_N     = 24          // horizon offsets 0-23: lines 108-131
.const L_NEAR     = ROAD_TOP + ROAD_LINES - 1   // 202, the nearest road line
.const ZN         = 24          // world units from the camera to line 202's road
.const W0         = 136         // the road's half-width in pixels at line 202

// 38 columns everywhere (CSEL 0): with XSCROLL the first 0-7 pixels of a
// line show the background colour, a sawtooth where the road reaches the
// window's edge on a tight bend (seen at speed, 2026-09-26). The 38-column
// border hides them (c64-kb soft_scroll_h).
.const D016_ROAD  = $10         // multicolour, 38 columns, XSCROLL 0
.const D016_HUD   = $00         // hires, 38 columns
.const D018_HUD   = $2a         // HUD screen $C800, characters $E800 (the ROM font)
.const SCREEN_A   = $c000
.const SCREEN_B   = $c400

// The road's four character sets (glyphs.asm assigns rows to them) and the
// $D018 character bits of each; the sky rows use set 3, which holds the
// hills at ids 2-4. $D018 = the screen's bits ($00 A, $10 B) | the set's.
.var SET_ADDR     = List().add($d000, $d800, $e000)
.var SET_BITS     = List().add($04, $06, $08)
.const SKY_SET    = 0
// The two dynamic sets: glyphs the builder makes for sheared rows, one set
// per road copy (builder.asm, sheared).
.const DYN_A      = $f000
.const DYN_B      = $f800
.const DYN_BITS_A = $0c
.const DYN_BITS_B = $0e

// Colours. Grass bands on %00 ($D021), road bands on %01 ($D022), the kerb's
// stripes on %10 ($D023): all three a line. The centre line on %11 (colour RAM).
.const C_SKY      = 14          // light blue
.const C_GRASS_A  = 5           // green
.const C_GRASS_B  = 13          // light green
.const C_ROAD_A   = 11          // dark grey
.const C_ROAD_B   = 12          // grey
.const C_KERB_A   = 2           // red
.const C_KERB_B   = 1           // white
.const C_HUD      = 0           // black

.const CH_GRASS   = 0
.const CH_ROAD    = 1

.function isBad(line) { .return (line & 7) == 3 }

// ---- zero page (builder only) -------------------------------------------------
.const zp_code  = $e0           // 2: the block being written (back copy)
.const zp_scr   = $e2           // 2: the screen row being drawn (back screen)
.const zp_cx    = $e4           // 2: road centre, 10.6 fixed pixels (signed)
.const zp_dx    = $e6           // 2: its change per line upwards, 10.6
.const zp_zt    = $e8           // 2: this frame's z table (per horizon offset)
// $EA: zp_R (builder.asm)
.const zp_row   = $eb           // the row being built, 7-18
.const zp_t0    = $ec
.const zp_t1    = $ed
.const zp_t2    = $ee
.const zp_t3    = $ef
.const zp_cref  = $f0           // 2: the row's content centre, pixels (signed)
.const zp_code2 = $f2           // 2: zp_code + 256 (the row's blocks 4-7)
.const zp_src   = $f4           // 2: the row's template
.const zp_c     = $f6           // the row's centre column (signed)
.const zp_p     = $f7           // the row's phase: 0 centre on a column edge, 1 mid-column
.const zp_t4    = $f8
.const zp_g     = $fd           // 2: a glyph's bytes (builder.asm, sheared)
.const GBASE    = 5             // the first road glyph id (glyphs.asm)

// Block layout (bytes from a block's start) and cycles before its slide.
// Every block is entered on cycle 2 of its line. Four kinds, by the line's
// place in its character row (line 0 is the badline):
//   B, line 0: STY $D018 (the row's character set, before the character
//      fetches from cycle 15; c64-kb raster_split_modes; written on cycle 5),
//      STA $D016 (9), BNE (A and Y loaded by the L block above). The VIC holds
//      the bus from cycle 12 to 54 and sprites 0-2 can take 9 more, which
//      leaves a slide of 9, 4, 2 or no cycles (c64-kb badline_cycle_loss).
//   F, line 1: STX $D021 (X, its grass, loaded by the L block two lines up;
//      written on cycle 5), LDA d016c, STA $D016 (13), then line 2's loads.
//   N, lines 2-6: STA $D016 (5), STX $D021 (9), STY $D022 on even lines
//      (the road band) or $D023 on odd ones (the kerb) (13), then the next
//      line's loads (NextLoads).
//   L, line 7: N's stores, then the next row's line 1 grass into X, the
//      badline's $D016 into A and its $D018 into Y (LDY #), BNE. An earlier
//      version stored $D018 after the slide, at the line's end: with sprite 2
//      on the line its DMA ends a cycle before the next block, a block must
//      end in a read the DMA stalls to be exact, and a block ending in that
//      write came out a cycle short or long (PROBE build, VICE x64sc).
// A line's colours come from zlc (the copy's z * 8 per line, odd above the
// horizon) plus bpos (the camera's position, even; C writes it each frame),
// through the colour tables, so the bands move every frame whatever the
// picture rate. Its $D016 comes from the copy's d016c table (the builder).
// Every block's branch into its slide is BNE: the ADC sets V, so an earlier
// BVC fell through into the whole slide whenever z * 8 + bpos overflowed as
// a signed byte, and the lines drifted (PROBE build, VICE x64sc). Each BNE
// follows a load of a non-zero byte ($D016 $18-$1F, a $D018 value), and the
// slide's CMPs leave Z clear (A is never $C9 nor zp_R, which CMP $EA reads).
#if PROBE
.const PROBE_B = 5              // + LDA #, STA $D021: the probe colour
.const PROBE_C = 6
#else
.const PROBE_B = 0
.const PROBE_C = 0
#endif
.const NB_HEAD  = 28 + PROBE_B
.const NB_CYC   = 40 + PROBE_C  // STA, STX, STY, NextLoads (25), BNE taken
.const NB_SLIDE = 64 - NB_HEAD
.const OFF_LY   = 23 + PROBE_B  // L: the next row's $D018 (LDY #)
.const LB_HEAD  = 26 + PROBE_B
.const LB_SLIDE = 64 - LB_HEAD
.const LB_CYC   = 36 + PROBE_C  // STA, STX, STY, grass (15), LDA abs, LDY #, BNE
.const FB_HEAD  = 28 + PROBE_B
.const FB_CYC   = 40 + PROBE_C  // STX, LDA abs, STA, NextLoads (25), BNE
.const FB_SLIDE = 64 - FB_HEAD
.const BB_HEAD  = 8
.const BB_CYC   = 11            // STY, STA, BNE taken
.const BB_SLIDE = 64 - BB_HEAD
.const NB_OPER  = NB_HEAD - 1   // the BNE operands
.const LB_OPER  = LB_HEAD - 1
.const FB_OPER  = FB_HEAD - 1
.const BB_OPER  = BB_HEAD - 1
.const PRE_CYC  = 24            // a copy's entry (PreBlock)
.const PRE_LY   = 11            // PreBlock's LDY # operand: row 7's $D018
.const PRE_SIZE = 18
.const bpos     = $ff           // the camera's position, even (C, each frame)

// Calibration, found with the PROBE build (README, "The road's timing").
.var SYNC_P   = cmdLineVars.containsKey("SYNCP")   ? cmdLineVars.get("SYNCP").asNumber()   : 40
.var SYNC_N   = cmdLineVars.containsKey("SYNCN")   ? cmdLineVars.get("SYNCN").asNumber()   : 42
.var ENTRY_P  = cmdLineVars.containsKey("ENTRYP")  ? cmdLineVars.get("ENTRYP").asNumber()  : 58
.var ENTRY_N  = cmdLineVars.containsKey("ENTRYN")  ? cmdLineVars.get("ENTRYN").asNumber()  : 60
.var BADLOSS  = cmdLineVars.containsKey("BADLOSS") ? cmdLineVars.get("BADLOSS").asNumber() : 43
.const PROBE_COL = 7

.function lostSet(m) {
    .if (m == 0) .return 0
    .var f = 0
    .while (((m >> f) & 1) == 0) .eval f++
    .var l = 2
    .while (((m >> l) & 1) == 0) .eval l--
    .return 5 + 2 * (l - f)
}

// Delay(n): exactly n cycles of straight-line code, n >= 2 (the
// pseudo-3d-road recipe's macro).
.macro Delay(n) {
    .if (n < 2) .error "Delay needs >= 2 cycles"
    .if ((n & 1) != 0) { bit $ea }
    .for (var i = 0; i < ((n & 1) != 0 ? n - 3 : n) / 2; i++) { nop }
}

* = $0880 "asm"

// ---- the published frame ------------------------------------------------------
// C fills these, calls rb_begin and rb_rows, then sets rb_ready. irq_blank
// takes the new frame (code copy, screen, sprites) as one when rb_ready is set.
rb_pos:     .word 0             // world position of line 202's road, units (256 a segment)
rb_hoff:    .byte 0             // horizon offset 0-23: the horizon on line 108 + hoff
rb_cx0:     .word 0             // centre at line 202, 10.6 pixels from the window's left edge
rb_dx0:     .word 0             // its change per line upwards, 10.6
rb_stop:    .byte 7             // rb_rows builds rows down to this one
rb_ready:   .byte 0             // 1: the back copy is whole; irq_blank shows it
rb_front:   .byte 0             // 0: copy A and screen A shown, 1: B
rb_swaps:   .byte 0             // swaps done
rb_model:   .byte 0             // 0 PAL (63 cycles a line), 1 NTSC (65)

// Sprites 0-2 of both sets: [set * 3 + s]. X bit 8 in spr_msb, enables in
// spr_en (bit s). The builder pads the back set's lines.
spr_x:      .fill 6, 0
spr_y:      .fill 6, 0
spr_ptr:    .fill 6, 0
spr_col:    .fill 6, 0
spr_msb:    .byte 0, 0
spr_en:     .byte 0, 0

// Per row, what the builder made (the back copy after rb_rows): the content
// centre (signed pixels from the window's left) and the half-width. A line's
// shown centre is its row's content centre + its XSCROLL (the $D016 byte in
// its block).
row_cref:   .fill 2 * 12 * 2, 0         // per copy, per row: the content centre (signed)
line_s:     .fill 2 * ROAD_LINES, 0     // per copy: each road line's shift from its row's cref
d016_a:     .fill ROAD_LINES, D016_ROAD // per copy: each road line's $D016 (builder)
d016_b:     .fill ROAD_LINES, D016_ROAD
zlc_a:      .fill ROAD_LINES + 2, 1     // per copy: z * 8 per line, 1 above the horizon (builder)
zlc_b:      .fill ROAD_LINES + 2, 1
zlc_h:      .byte $ff, $ff              // the horizon offset each copy's zlc holds

// ---- counters the chain keeps -----------------------------------------------------
tick:       .byte 0             // incremented at line 251: the frame starts
road_late:  .byte 0             // road chains armed late, synced off line 105 or split off 203-204
irq_meter:  .byte 0             // AUTOPILOT: time the IRQs outside the meter's bracket
irq_timing: .byte 0
irq_cyc:    .word 0
irq_cnt:    .byte 0
sp_save:    .byte 0

// ---- the meter's share of the IRQs (the beat-em-up starter's macros) ----------------
// An IRQ that lands while the main loop's meter bracket runs (CIA2 timer A
// started) is already in that wall time; one that lands outside times
// itself on CIA2 timer B and adds the count to irq_cyc, which C folds in.
.macro IrqIn() {
        lda #0
        sta irq_timing
        lda irq_meter
        beq !no+
        lda $dd0e
        lsr                     // bit 0, timer A running, to the carry
        bcs !no+
        lda #$11
        sta $dd0f               // timer B: force-load $FFFF and start
        inc irq_timing
!no:
}

.macro IrqOut() {
        lda irq_timing
        beq !no+
        lda #$00
        sta $dd0f               // stop timer B
        lda #$ff
        sec
        sbc $dd06
        clc
        adc irq_cyc
        sta irq_cyc
        php
        lda #$ff
        sec
        sbc $dd07
        plp
        adc irq_cyc + 1
        sta irq_cyc + 1
        inc irq_cnt
!no:
}

// ---- line 251: the frame starts ----------------------------------------------------
irq_blank:
        pha
        txa
        pha
        tya
        pha
        cld
        IrqIn()
        inc tick
        jsr take_picture
        lda d018_sky, x
        sta $d018
        lda #D016_ROAD
        sta $d016
        lda #C_SKY
        sta $d021
        lda zlc_off, x          // the road band and kerb until lines 109 and 110
        tax                     // store their own
        lda zlc_a + 2, x
        clc
        adc bpos
        tay
        lda road_col, y
        sta $d022
        lda zlc_a + 3, x
        clc
        adc bpos
        tay
        lda kerb_col, y
        sta $d023
        ldx rb_front
        lda #<irq_top
        sta $fffe
        lda #>irq_top
        sta $ffff
        lda #IRQ_TOP
        sta $d012
        jmp irq_done

// take_picture: a new picture when rb_ready (the other copy, screen and
// sprite set), then the shown one's sync target, sprites and pointers. Safe
// where the beam is below line 202 with no sprite fetching: after the panel
// split (203) and at irq_blank (251). Not at irq_top: its 150 cycles there
// pushed the arming of line 105 past 105, and the chain waited a frame
// (measured with VICE's profiler: 2,770 cycles a frame in JMP *).
// X = rb_front on exit.
take_picture:
        lda rb_ready
        beq !keep+
        lda rb_front
        eor #1
        sta rb_front
        lda #0
        sta rb_ready
        inc rb_swaps
!keep:  ldx rb_front
        lda pre_lo, x           // the road copy's entry, where the sync jumps
        sta sync_pal.go + 1
        sta sync_ntsc.go + 1
        lda pre_hi, x
        sta sync_pal.go + 2
        sta sync_ntsc.go + 2
        lda spr_msb, x
        sta $d010
        lda spr_en, x
#if NOSPRITES
        lda #0                  // (debug) no sprites: the road's timing alone
#endif
        sta $d015
        lda set3, x
        tax
    .for (var s = 0; s < 3; s++) {
        lda spr_x + s, x
        sta $d000 + s * 2
        lda spr_y + s, x
        sta $d001 + s * 2
        lda spr_col + s, x
        sta $d027 + s
        lda spr_ptr + s, x
        sta SCREEN_A + $3f8 + s
        sta SCREEN_B + $3f8 + s
    }
        ldx rb_front
        rts

// rb_take: the main loop's take of a finished picture, when the beam is
// clear of the road and of irq_top (lines 204-311 and 0-93), so the builder
// need not wait for line 203 or 251 (C: road_work, while rb_ready). The
// poll runs with interrupts on: an earlier version held them off for its
// 29 cycles, and when the IRQ at 103 landed in that window irq_top's CLI
// slipped past line 105 and the chain synced on 106 (about 50 times a race
// with the builder idle; road_late, VICE x64sc). Only the swap itself,
// about 150 cycles, runs with them off: in the lower window it can delay
// irq_blank by two lines, which changes nothing it does.
rb_take:
        lda rb_ready
        beq !done+
        lda $d011
        bmi !safe+              // lines 256 up
        lda $d012
        cmp #204
        bcs !safe+
        cmp #94
        bcs !done+
!safe:  sei
        jsr take_picture
        cli
!done:  rts

road_lo:    .byte <road_a, <road_b
road_hi:    .byte >road_a, >road_b
pre_lo:     .byte <pre_a, <pre_b
pre_hi:     .byte >pre_a, >pre_b
d018_sky:   .byte SET_BITS.get(SKY_SET), $10 | SET_BITS.get(SKY_SET)
zlc_off:    .byte 0, zlc_b - zlc_a
set3:       .byte 0, 3

// ---- line 101: the double IRQ (c64-kb double_irq, stable_raster_irq) --------------------
// From entry to CLI is about 107 cycles (arithmetic from the listing): with
// the IRQ on line 103 the CLI came on cycle 44 of line 104, 19 cycles before
// line 105's interrupt, and any 20-cycle delay of the 103 interrupt (a SEI in
// the main loop) put the sync a line late. On 101 the margin is about 80
// cycles; the NOPs then cover to past 105 (84 of them: 168 cycles from
// cycle 44 of line 102 reach cycle 23 of line 105).
irq_top:
        pha
        txa
        pha
        tya
        pha
        cld
        IrqIn()
        lda rb_model
        bne !ntsc+
        lda #<sync_pal
        sta $fffe
        lda #>sync_pal
        sta $ffff
        jmp !arm+
!ntsc:  lda #<sync_ntsc
        sta $fffe
        lda #>sync_ntsc
        sta $ffff
!arm:   lda #SYNC_LINE
        sta $d012
        lda $d012               // armed on line 105 or later: the IRQ comes a frame
        cmp #SYNC_LINE          // late, irq_blank and its tick skipped, and no
        bcc !+                  // other counter sees it
        inc road_late
!:      lda #$01
        sta $d019
        tsx
        stx sp_save
        cli
    .for (var i = 0; i < 84; i++) { nop }
        jmp *                   // reached only when line 105 was armed late (road_late)

// Line 105: entered from a NOP, so 0 or 1 cycle late. The two $D012 reads
// straddle the change to line 106 in one case and not the other; BEQ takes
// one cycle more in the case that was early. Then the first road block on
// cycle 2 of line 107.
.macro Sync(pad, entry) {
        ldx sp_save
        txs                     // drop this IRQ's frame: irq_top's stays below
        ldx #D016_HUD           // kept through the road for line 203's STX $D016
        Delay(pad - 2)
        lda $d012
        cmp $d012
        beq !+
!:      cmp #SYNC_LINE          // the first read was line 105: the chain is on time
        bne late
        Delay(entry - 6 - PRE_CYC)  // (BIT in Delay sets V from memory)
        clv                     // (harmless: the blocks branch on Z now)
go:     jmp pre_a               // patched by irq_blank: the shown copy's entry
late:   inc road_late           // an IRQ held back past 105: this frame's road is wrong
        clv
        jmp go
}
sync_pal:  Sync(SYNC_P, ENTRY_P)
sync_ntsc: Sync(SYNC_N, ENTRY_N)

// ---- after line 203's stores: back to line 251 --------------------------------------------
// Each road copy ends with line 203's block, a badline: $D018 on cycle 7
// (the video matrix is read from cycle 15; c64-kb raster_split_modes),
// $D016 on cycle 11, from X, before BA falls on 12. An earlier version
// loaded A for it: that STA read its operand on 12, waited for the
// badline and wrote on cycle 56, so line 203 was drawn in the road's
// multicolour mode and XSCROLL (VICE store trace, issue #86).
// $D021 lands here, after the VIC's fetch: row 19 is
// solid characters, so no background shows on its lines.
hud_rest:
        lda #C_HUD
        sta $d021
        lda $d012               // read on line 204: cycle 4 on PAL, 2 on NTSC
                                // (VICE exec trace; 6 and 4 before #86)
        cmp #HUD_LINE
        bcc !late+
        cmp #HUD_LINE + 2
        bcc !+
!late:  inc road_late
!:      lda rb_ready            // a picture finished: take it now, not at 251
        beq !+                  // ($D018 stays the panel's until 251)
        jsr take_picture
!:      lda #<irq_blank
        sta $fffe
        lda #>irq_blank
        sta $ffff
        lda #BLANK_LINE
        sta $d012
irq_done:
        IrqOut()
        lda #$01
        sta $d019
        pla
        tay
        pla
        tax
        pla
nmi_rti:
        rti

// ---- PAL or NTSC (the pseudo-3d-road recipe's detect_region) ---------------------------
// The last raster line's low byte, read while RST8 is set: $37 (311) on
// PAL, $06 (262) on NTSC. Call with interrupts off.
detect_model:
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
!:      sta rb_model
        rts

// ---- the builder: builder.asm ---------------------------------------------------------
.import source "builder.asm"
.label rb_row_zp = zp_row       // the next row rb_rows builds (C reads it)

// ---- tables -----------------------------------------------------------------------------
// cx is 10.6: pixel = cx >> 6. The pixel's low byte from the two bytes of
// cx, and its high byte (signed).
.align $100
sh6_lo_lo:  .fill 256, i >> 6
sh6_lo_hi:  .fill 256, (i << 2) & $ff
sh6_hi:     .fill 256, (i < 128) ? (i >> 6) : ((i >> 6) | $fc)
// half-width at a line from its z: w = W0 * ZN / (8 z); z * 8 = ZN at line 202
w_of_z:     .fill 256, (i == 0) ? 0 : min(255, round(W0 * ZN / (i * 8)))

// z per road line for each horizon offset: z = ZN * D / d, D = 202 - H,
// d = line - H; 0 on and above the horizon. Units of 8, 1-255.
.function zOf(h, i) {
    .var H = H_MIN + h
    .var L = ROAD_TOP + i
    .var d = L - H
    .if (d <= 0) .return 0
    .var D = L_NEAR - H
    .return max(1, min(255, round(ZN * D / d / 8)))
}
// Even offsets only (the horizon moves two lines at a time): ztab holds
// offsets 0, 2, ... 22; zt_lo/hi[h] points at h & ~1's.
zt_lo:      .fill HOFF_N, <(ztab + (i >> 1) * ROAD_LINES)
zt_hi:      .fill HOFF_N, >(ztab + (i >> 1) * ROAD_LINES)
ztab:
    .for (var h = 0; h < HOFF_N; h += 2) {
        .fill ROAD_LINES, zOf(h, i)
    }

// The track: 64 segments of 256 units, a curvature and a hill each.
.import source "track.asm"

// The road's glyphs and row templates.
.import source "glyphs.asm"

// ---- the road, two copies ----------------------------------------------------------------
// One 64-byte block a line, aligned, so no branch into a slide crosses a
// page (3 cycles, always). The last block is line 203's: the HUD split.
.macro Slide(n) {
    .fill n - 2, $c9
    .byte $c5, $ea
}
// The next line's loads in an F or N block: its grass to X, its road band
// (even line) or kerb (odd) to Y, its $D016 to A. 25 cycles.
.macro NextLoads(zl, d016, n) {
            lda zl + n
            clc
            adc bpos
            tay
            ldx grass_col, y
          .if ((n & 1) == 0) { lda road_col, y } else { lda kerb_col, y }
            tay
            lda d016 + n
}
.macro RoadCopy(scr, zl, d016) {
    .for (var j = 0; j < ROAD_LINES; j++) {
        .var k = (ROAD_TOP + j - 3) & 7         // the line's place in its row
        .var last = j + 1 == ROAD_LINES         // line 202: the panel is next
        .var nextY = last ? D018_HUD : scr | SET_BITS.get(rowSet.get(min(j + 1, ROAD_LINES - 1) >> 3))
        .if (k == 0) {
blk:        sty $d018
            sta $d016
bb:         .byte $d0, BB_SLIDE     // BNE to the next block (no pad until built)
            Slide(BB_SLIDE)
            .errorif bb + 1 - blk != BB_OPER, "B block layout"
        } else .if (k == 1) {
blk:        stx $d021
            lda d016 + j
            sta $d016
#if PROBE
            lda #PROBE_COL
            sta $d021
#endif
            NextLoads(zl, d016, j + 1)
fb:         .byte $d0, FB_SLIDE
            Slide(FB_SLIDE)
            .errorif fb + 1 - blk != FB_OPER, "F block layout"
        } else {
blk:        sta $d016
            stx $d021
          .if ((j & 1) == 0) { sty $d022 } else { sty $d023 }
#if PROBE
            lda #PROBE_COL
            sta $d021
#endif
          .if (k == 7) {
          .if (last) {
            lda zl + j              // (unused: the others' bytes and cycles)
            clc
            adc bpos
            tay
            ldx hud_d016            // line 203's STX $D016
          } else {
            lda zl + j + 2          // the next row's line 1: its grass
            clc
            adc bpos
            tay
            ldx grass_col, y
          }
            lda d016 + min(j + 1, ROAD_LINES - 1)
ly:         ldy #nextY
lb:         .byte $d0, LB_SLIDE
            Slide(LB_SLIDE)
            .errorif ly + 1 - blk != OFF_LY || lb + 1 - blk != LB_OPER, "L block layout"
          } else {
            NextLoads(zl, d016, j + 1)
nb:         .byte $d0, NB_SLIDE
            Slide(NB_SLIDE)
            .errorif nb + 1 - blk != NB_OPER, "N block layout"
          }
        }
    }
        lda #D018_HUD           // line 203, cycle 2
        sta $d018               // written on cycle 7, before the c-accesses from 15
        stx $d016               // X = D016_HUD from line 202's block: written on cycle 11
        jmp hud_rest            // opcode read on 12: held by the badline to 55
}

// A copy's entry, on line 106: line 107's $D016 into A, row 7's $D018 into
// Y (line 107's block stores both), and line 108's grass into X.
.macro PreBlock(scr, code, zl, d016) {
pb:     lda zl + 1              // line 108's grass, for its F block
        clc
        adc bpos
        tay
        ldx grass_col, y
ly:     ldy #scr | SET_BITS.get(rowSet.get(0))  // row 7's set: line 107's B block stores it
        lda d016                // line 107's $D016
        jmp code
        .errorif ly + 1 - pb != PRE_LY || * - pb != PRE_SIZE, "PreBlock layout"
}
hud_d016:   .byte D016_HUD
.label rc_off_ly = OFF_LY        // for roadcheck: each row's $D018 operand in the L block above
.label rc_pre_ly = PRE_LY        // and row 7's in the copy's entry block
pre_a:  PreBlock($00, road_a, zlc_a, d016_a)
pre_b:  PreBlock($10, road_b, zlc_b, d016_b)

.align $100
road_a: RoadCopy($00, zlc_a, d016_a)
.align $100
road_b: RoadCopy($10, zlc_b, d016_b)
