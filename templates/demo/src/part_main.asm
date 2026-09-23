// part_main.asm: part 1. A character logo, eight sprites on a sine chain,
// four raster bars from a stable raster kernel, a 1x1 scroller on row 22.
//
//   lines  51-98   logo, rows 0-4, and the subtitle, row 5
//   lines 101-145  the sprite chain (Y 100-124): no sprite on a bar line
//   lines 155-210  the bars, one colour per line, border and background
//   lines 227-234  the scroller, row 22, 38 columns and XSCROLL
//
// Its chain (parts.asm): bars_slot at 148, scroll_slot at 224, frame_slot.
// update runs in the frame slot, below the picture: every register and
// table it writes is used by the next frame, so nothing tears.

.const MSG_START = 40                  // the row starts full: message cells 0-39

main_init:
        lda #0
        sta $d020
        sta $d021
        sta border_colour
        sta $d017                      // every sprite register this part relies on,
        sta $d01b                      // not only the ones it changes (pitfall
        sta $d01c                      // sprite_registers_persist_across_state_change)
        sta $d01d
        ldx #7
!:      lda #SPRITE_BLOCK
        sta SCREEN + $3f8,x
        lda chain_colour,x
        sta $d027,x
        dex
        bpl !-
        ldx #5 * 40 - 1                // the logo and the subtitle, rows 0-5
!:      lda logo_cells,x
        sta SCREEN,x
        lda logo_colours,x
        sta COLOUR,x
        dex
        cpx #$ff
        bne !-
        ldx #39
!:      lda subtitle,x
        sta SCREEN + 5 * 40,x
        lda #15
        sta COLOUR + 5 * 40,x
        lda message,x                  // the scroller's row starts full
        sta SCREEN + SCROLL_ROW * 40,x
        lda scroll_colours,x
        sta COLOUR + SCROLL_ROW * 40,x
        dex
        bpl !-
        lda #<(message + MSG_START)
        sta msg_read+1
        lda #>(message + MSG_START)
        sta msg_read+2
        lda #7
        sta xscroll
        lda #CHAIN_FAULT
        sta ph_x
        lda #0
        sta ph_y
        sta ph_b
        sta updates
        sta updates+1
        sta frozen
        jsr place_sprites
        jsr fill_bars
        lda #$ff
        sta $d015
        rts

// Frame slot. Advance, then compute: after k updates the picture shows
// phase k * speed, which is what the verdict and gen_expect.py predict.
main_update:
        lda frozen
        bne !+
        lda ph_x
        clc
        adc #CHAIN_SX
        sta ph_x
        lda ph_y
        clc
        adc #CHAIN_SY
        sta ph_y
        lda ph_b
        clc
        adc #BAR_SPEED
        sta ph_b
        jsr place_sprites
        jsr fill_bars
        jsr scroll_step
        inc updates
        bne !freeze+
        inc updates+1
!freeze:
#if AUTOPILOT
        lda updates+1                  // the autopilot's fixed frame: hold still
        bne !+
        lda updates
        cmp #FREEZE_UPDATES
        bne !+
        lda #1
        sta frozen
#endif
!:      rts

main_teardown:
        lda #0
        sta $d015
        lda #$c8
        sta $d016
        rts

// ---- sprite chain -------------------------------------------------------------
// Sprite n: X = base_n + chain_sinx[ph_x + n * CHAIN_PX], Y = chain_siny[ph_y +
// n * CHAIN_PY]. X passes 255, so the ninth bits are gathered into $D010
// every frame (pitfall sprite_x_high_bit_wrong_register).
place_sprites:
        .for (var n = 0; n < 8; n++) {
            .var base = CHAIN_X0 + n * CHAIN_DX - CHAIN_AX
            lda ph_x
            clc
            adc #<(n * CHAIN_PX)
            tay
            lda #<base
            clc
            adc chain_sinx,y
            sta $d000 + 2 * n
            lda #>base
            adc #0
            lsr                        // the ninth bit into carry, then into msb
            ror msb
            lda ph_y
            clc
            adc #<(n * CHAIN_PY)
            tay
            lda chain_siny,y
            sta $d001 + 2 * n
        }
        lda msb                        // eight RORs: sprite 0's bit is bit 0
        sta $d010
        rts

// ---- bars -----------------------------------------------------------------------
// bar_colours[i] is the colour of line BARS_TOP + i. Cleared, then four
// 12-line ramps at sine positions; the later bar is drawn over the earlier.
fill_bars:
        lda #0
        ldx #BARS_LINES - 1
!:      sta bar_colours,x
        dex
        bpl !-
        .for (var b = 0; b < 4; b++) {
            lda ph_b
            clc
            adc #<(b * BAR_STEP)
            tay
            ldx bar_top,y
            ldy #0
        !:  lda ramps + b * BAR_H,y
            sta bar_colours,x
            inx
            iny
            cpy #BAR_H
            bne !-
        }
        rts

// ---- the 1x1 scroller -------------------------------------------------------------
// XSCROLL 7 down to 0, a pixel a frame; past 0 the row moves one cell left,
// the next message cell comes in on the right and XSCROLL is 7 again.
scroll_step:
        dec xscroll
        bpl !done+
        lda #7
        sta xscroll
        ldx #0
!:      lda SCREEN + SCROLL_ROW * 40 + 1,x
        sta SCREEN + SCROLL_ROW * 40,x
        inx
        cpx #39
        bne !-
msg_read:
        lda message                    // the operand is the read pointer
        bne !+
        lda #<message                  // 0 ends the message: start again
        sta msg_read+1
        lda #>message
        sta msg_read+2
        lda message
!:      sta SCREEN + SCROLL_ROW * 40 + 39
        inc msg_read+1
        bne !done+
        inc msg_read+2
!done:  rts

// ---- the slots ----------------------------------------------------------------------
// Line 148: stabilise returns on cycle 51 of line 153 (both models, the
// monitor's numbering), then the kernel for this model (patched at start)
// draws lines 155 to 210.
bars_slot:
        jsr stabilise
kernel_call:
        jsr kernel_pal                 // start: kernel_ntsc on a 6567
        rts

// Line 224: row 22 in 38-column mode with this frame's XSCROLL. The frame
// slot writes $C8 back at line 236, so no other row moves (pitfall
// xscroll_applies_to_all_rows).
scroll_slot:
        lda xscroll
        ora #$c0                       // CSEL 0: 38 columns hide the column coming in
        sta $d016
        rts

// ---- the bar kernel -----------------------------------------------------------------
// One chunk a line: load the line's colour, store it to $D020 and $D021 in
// the horizontal blank, then wait for the next line. Measured with the VICE
// monitor (README, "The stable entry and the bars"): each chunk's STA $D020 starts on
// cycle 60 (PAL) or 62 (NTSC) of the line above, so the stores write on
// cycles 0 and 4 of the bar line, in the monitor's numbering (0 to 62 or 64),
// and the next chunk starts exactly one line later, badline or not.
// A normal line gives the CPU all its cycles. A badline ((line & 7) == 3
// with YSCROLL 3) takes the bus from the CPU for 43 cycles, so its chunk
// has only NOPs after the stores: all read cycles, which the VIC holds, and
// the stall is the rest of the line (pitfall badline_cycle_loss). No sprite
// may sit on these lines: sprite DMA falls in the same blank.
//   cycles  line length, 63 (6569) or 65 (6567R8)
//   lead    cycles from the kernel's first instruction to the first chunk
.macro BarKernel(cycles, lead) {
    Delay(lead)
    .for (var i = 0; i < BARS_LINES; i++) {
        .var line = BARS_TOP + i
        lda bar_colours + i            // 4
        sta $d020                      // 4: writes on cycle 0 of `line`
        sta $d021                      // 4: writes on cycle 4
        .if ((line & 7) == 3) {
            Pad(cycles - 55)           // 20 (22) cycles a badline leaves: 12 + 8 (10)
        } else {
            Delay(cycles - 12)
        }
    }
    lda border_colour                  // after the last bar: the part's border
    sta $d020                          // writes on cycle 0
    lda #0
    sta $d021                          // writes on cycle 6
    rts
}

#if PROBE
.const PROBE_SHIFT = 20                // the probe build moves every store 20 cycles right
#else
.const PROBE_SHIFT = 0
#endif
// The leads put the stores mid-blank: measured with the PROBE build and the
// monitor (README, "The stable entry and the bars").
.const LEAD_PAL  = 62 + PROBE_SHIFT
.const LEAD_NTSC = 66 + PROBE_SHIFT

kernel_pal:  BarKernel(63, LEAD_PAL)
kernel_ntsc: BarKernel(65, LEAD_NTSC)

// ---- the part's state ---------------------------------------------------------------
ph_x:          .byte 0
ph_y:          .byte 0
ph_b:          .byte 0
msb:           .byte 0
xscroll:       .byte 7
updates:       .word 0
frozen:        .byte 0
border_colour: .byte 0
bar_colours:   .fill BARS_LINES, 0
