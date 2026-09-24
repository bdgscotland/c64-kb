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
.const IRQ_TOP    = 103         // the double IRQ: 103, then 105
.const SYNC_LINE  = 105         // lines 100-106: no badline, no sprite fetch
.const BLANK_LINE = 251         // below the last display line on PAL and NTSC
.const H_MIN      = 108         // the horizon's highest line (hoff 0)
.const HOFF_N     = 24          // horizon offsets 0-23: lines 108-131
.const L_NEAR     = ROAD_TOP + ROAD_LINES - 1   // 202, the nearest road line
.const ZN         = 24          // world units from the camera to line 202's road
.const W0         = 136         // the road's half-width in pixels at line 202

.const D016_ROAD  = $18         // multicolour, 40 columns, XSCROLL 0
.const D016_HUD   = $08         // hires, 40 columns
.const D018_A     = $08         // road screen A at $C000, characters $E000
.const D018_B     = $18         // road screen B at $C400
.const D018_HUD   = $2a         // HUD screen $C800, characters $E800 (the ROM font)
.const SCREEN_A   = $c000
.const SCREEN_B   = $c400

// Colours. Grass bands on %00 ($D021, per line), the road on %01 ($D022),
// the kerb on %10 ($D023), the centre dash on %11 (colour RAM).
.const C_SKY      = 14          // light blue
.const C_GRASS_A  = 5           // green
.const C_GRASS_B  = 13          // light green
.const C_HUD      = 0           // black

// Road characters (multicolour pairs, left to right).
.const CH_GRASS   = 0           // 00 00 00 00
.const CH_ROAD    = 1           // 01 01 01 01
.const CH_LEFT    = 2           // 2-5: the left kerb in pair 0-3, grass left of it, road right
.const CH_RIGHT   = 6           // 6-9: the right kerb in pair 0-3, road left of it, grass right
.const CH_DASH    = 10          // 01 11 11 01

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
.const zp_xl    = $f2           // 2: left kerb pixel
.const zp_xr    = $f4           // 2: right kerb pixel
.const zp_cl    = $f6           // left kerb column, $FF off the left, 40 off the right
.const zp_cr    = $f7           // right kerb column
.const zp_cd    = $f8           // dash column, $FF none

// Block layout (bytes from a block's start) and cycles before its slide.
#if PROBE
.const NB_HEAD = 17             // + LDA #, STA $D021: the probe colour, written on cycle 19
.const NB_CYC  = 21
#else
.const NB_HEAD = 12
.const NB_CYC  = 15             // LDA #, STA $D016, LDA #, STA $D021, BVC taken
#endif
.const NB_SLIDE = 64 - NB_HEAD
.const BB_HEAD  = 7
.const BB_CYC   = 9             // LDA #, STA $D016, BVC taken
.const BB_SLIDE = 64 - BB_HEAD
.const NB_OPER  = NB_HEAD - 1   // the BVC operand
.const BB_OPER  = BB_HEAD - 1
.const OFF_D016 = 1
.const OFF_COL  = 6

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
row_cref:   .fill 12 * 2, 0
row_w:      .fill 12, 0

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
        lda d018_road, x
        sta $d018
        lda #D016_ROAD
        sta $d016
        lda #C_SKY
        sta $d021
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
        lda road_lo, x          // the road copy the sync jumps to
        sta sync_pal.go + 1
        sta sync_ntsc.go + 1
        lda road_hi, x
        sta sync_pal.go + 2
        sta sync_ntsc.go + 2
        lda spr_msb, x
        sta $d010
        lda spr_en, x
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

road_lo:    .byte <road_a, <road_b
road_hi:    .byte >road_a, >road_b
d018_road:  .byte D018_A, D018_B
set3:       .byte 0, 3

// ---- line 103: the double IRQ (c64-kb double_irq, stable_raster_irq) --------------------
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
    .for (var i = 0; i < 40; i++) { nop }
        jmp *                   // reached only when line 105 was armed late (road_late)

// Line 105: entered from a NOP, so 0 or 1 cycle late. The two $D012 reads
// straddle the change to line 106 in one case and not the other; BEQ takes
// one cycle more in the case that was early. Then the first road block on
// cycle 2 of line 107.
.macro Sync(pad, entry) {
        ldx sp_save
        txs                     // drop this IRQ's frame: irq_top's stays below
        Delay(pad)
        lda $d012
        cmp $d012
        beq !+
!:      cmp #SYNC_LINE          // the first read was line 105: the chain is on time
        bne late
        Delay(entry - 6)        // (BIT in Delay sets V from memory)
        clv                     // every block's BVC is taken
go:     jmp road_a              // patched by irq_blank: the shown copy
late:   inc road_late           // an IRQ held back past 105: this frame's road is wrong
        clv
        jmp go
}
sync_pal:  Sync(SYNC_P, ENTRY_P)
sync_ntsc: Sync(SYNC_N, ENTRY_N)

// ---- after line 203's stores: back to line 251 --------------------------------------------
// Each road copy ends with line 203's block, a badline: $D018 on cycle 7
// (the video matrix is read from cycle 15; c64-kb raster_split_modes),
// $D016 on cycle 56, held by the badline (its STA reads on cycle 12).
// $D021 lands here, after the VIC's fetch: row 19 is
// solid characters, so no background shows on its lines.
hud_rest:
        lda #C_HUD
        sta $d021
        lda $d012               // read on line 204: cycle 6 on PAL, 4 on NTSC
                                // (VICE; an earlier comment said 203 on NTSC)
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
// z * 8, z in units of 8 world units
m8lo:       .fill 256, <(i * 8)
m8hi:       .fill 256, >(i * 8)
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
zt_lo:      .fill HOFF_N, <(ztab + i * ROAD_LINES)
zt_hi:      .fill HOFF_N, >(ztab + i * ROAD_LINES)
ztab:
    .for (var h = 0; h < HOFF_N; h++) {
        .fill ROAD_LINES, zOf(h, i)
    }

// The track: 64 segments of 256 units, a curvature and a hill each.
.import source "track.asm"

// ---- the road, two copies ----------------------------------------------------------------
// One 64-byte block a line, aligned, so no branch into a slide crosses a
// page (3 cycles, always). The last block is line 203's: the HUD split.
.macro Slide(n) {
    .fill n - 2, $c9
    .byte $c5, $ea
}
.macro RoadCopy() {
    .for (var j = 0; j < ROAD_LINES; j++) {
        .if (isBad(ROAD_TOP + j)) {
            lda #D016_ROAD
            sta $d016
            .byte $50, BB_SLIDE     // BVC to the next block: no pad until built
            Slide(BB_SLIDE)
        } else {
            lda #D016_ROAD
            sta $d016
            lda #C_SKY
            sta $d021
#if PROBE
            lda #PROBE_COL
            sta $d021
#endif
            .byte $50, NB_SLIDE
            Slide(NB_SLIDE)
        }
    }
        lda #D018_HUD           // line 203, cycle 2
        sta $d018               // written on cycle 7, before the c-accesses from 15
        lda #D016_HUD
        sta $d016               // reads on 12: held by the badline, written on 56
        jmp hud_rest
}

.align $100
road_a: RoadCopy()
.align $100
road_b: RoadCopy()
