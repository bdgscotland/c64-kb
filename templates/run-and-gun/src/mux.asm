// mux.asm: the sprite multiplexer, imported by kernel.asm.
//
// Mechanism from c64-kb's kickassembler/sprite-multiplex-game recipe
// (technique sprite_multiplex_game), as the shmup-vertical starter's mux.asm
// adapts it: a persistent insertion sort by Y, a sorted table built into the
// half the IRQs are not reading, zone IRQs that reuse the eight hardware
// sprites further down, and a late guard. Changes here: 16 slots, a full
// 9-bit X (the soldier walks 1 pixel a frame), a $D01B priority bit per slot
// (char_attribute_flags: the canopy draws over the sprite), one screen's
// pointers, and the swap done by the frame IRQ only when C commits.
//
// Slot policy (sprite_slot_parking): C never tells the multiplexer a slot is
// free. A free slot is parked as data: pointer to the blank block, X = 356 (the
// right border on PAL and NTSC), Y = PARK_Y. The sort and the build treat all
// 16 alike. PARK_Y is 255, below MAX_SY, so the build's reject step (it stops
// at the first sorted Y past MAX_SY) drops parked slots with the lowest
// sprites: a parked slot takes no hardware sprite and no sprite DMA. The
// recipe parks at Y 0 instead, where each parked slot is drawn blank for 21
// lines and costs 105 cycles of DMA a frame on PAL (techniques/sprite.md,
// measured there); its fixed groups have no reject step to drop them with.
//
// C fills slot_y/slot_xl/slot_xh/slot_ptr/slot_col/slot_pri, then calls
// mux_sort and mux_build once a frame and commits (kernel.asm commit bit 1).

.const N       = 16        // slots: soldier, 3 bullets, grenade, 11 pool (game.h)
.const BUF     = 16        // offset of sorted half 1 (a multiple of 8, >= N)
.const MIN_GAP = 21        // a reused hardware sprite's next Y must be >= its last Y + 21
.const JOIN    = 4         // sprites within 4 lines of a zone's first join it
.const LEAD    = 3         // zone IRQ line = first Y - LEAD - sprites in zone
.const MARGIN  = 3         // late guard: within 3 lines of the next line? run it now
// Lowest Y shown: last line 208 (a sprite at Y is on lines Y+1 to Y+21), three
// lines above the band IRQ at 211 and five above the band's first store, so no
// sprite DMA falls on the band's lines (its store windows were measured with
// one sprite across the band, recipe invalid-mode-band; eight were not).
.const MAX_SY  = 187
.const PARK_Y  = 255

// ---- the slot tables C writes ------------------------------------------------
slot_y:    .fill N, PARK_Y
slot_xl:   .fill N, <356
slot_xh:   .fill N, >356   // 0 or 1: bit 8 of X
slot_ptr:  .fill N, 0
slot_col:  .fill N, 0
slot_pri:  .fill N, 0      // 1: behind the playfield's foreground pixels ($D01B)
order:     .fill N, i
mux_shown: .byte 0         // sprites accepted by the last build
mux_peak:  .byte 0         // most sprites accepted in one build since init
mux_front: .byte 0         // 0 or BUF: the half the IRQs read

// ---- sorted halves and zone tables (half 0 at 0, half 1 at BUF) ----------
sy:      .fill 2*BUF, 0
sx:      .fill 2*BUF, 0
sptr:    .fill 2*BUF, 0
scol:    .fill 2*BUF, 0
sd010:   .fill 2*BUF, 0
sd01b:   .fill 2*BUF, 0
zstart:  .fill 2*BUF, 0
zend:    .fill 2*BUF, 0
zline:   .fill 2*BUF, 0
zlast_b: .fill 2*BUF, 0
en_b:    .fill 2*BUF, 0    // $D015 for the half: one bit per hardware sprite in use
slot:    .fill 2*BUF, i & 7
slot2:   .fill 2*BUF, (i & 7) * 2
bitm:    .fill 2*BUF, 1 << (i & 7)
bitc:    .fill 2*BUF, $ff ^ (1 << (i & 7))
enmask:  .byte $00, $01, $03, $07, $0f, $1f, $3f, $7f, $ff

// build's scratch
bo:      .byte 0
acc:     .byte 0
bk:      .byte 0
bo8:     .byte 0
by:      .byte 0
d010run: .byte 0
d01brun: .byte 0
zw:      .byte 0
ybase:   .byte 0
ylim:    .byte 0
zn:      .byte 0
key:     .byte 0
cand:    .byte 0
s_i:     .byte 0

// ---------------------------------------------------------------------------
// Persistent insertion sort: order[] keeps last frame's order, so a slot that
// has not passed a neighbour costs one compare. Ties keep their order.
// Aligned so both loop branches stay inside one page.
// ---------------------------------------------------------------------------
.align $100
mux_sort:
        ldx #1
s_loop: ldy order,x
        lda slot_y,y
        ldy order-1,x
        cmp slot_y,y
        bcs s_next              // in place
        sta key
        lda order,x
        sta cand
        stx s_i
s_shift:
        lda order-1,x
        sta order,x
        dex
        beq s_place
        ldy order-1,x
        lda slot_y,y
        cmp key
        beq s_place
        bcs s_shift             // still greater than the key
s_place:
        lda cand
        sta order,x
        ldx s_i
s_next: inx
        cpx #N
        bne s_loop
        rts
.assert "mux_sort in one page", >mux_sort, >*

// ---------------------------------------------------------------------------
// Build the back half: accept each sorted slot that can be shown, keep a
// running $D010 and $D01B, then group sprites 8 onward into zones. X is the
// write place, Y the slot, bk the read place in order[].
// ---------------------------------------------------------------------------
mux_build:
        lda mux_front
        eor #BUF
        sta bo
        tax
        clc
        adc #8
        sta bo8                 // the first eight always fit
        lda #0
        sta d010run
        sta d01brun
        sta bk
b_loop: ldy bk
        cpy #N
        beq b_done
        inc bk
        lda order,y
        tay                     // Y: the slot
        lda slot_y,y
        cmp #MAX_SY+1
        bcs b_done              // sorted: every later slot is lower still (parked ones last)
        cpx bo8
        bcc b_accept
        sta by
        sec
        sbc sy-8,x              // gap to the last sprite this hardware sprite showed
        cmp #MIN_GAP
        bcc b_loop              // too close: this slot is not shown this frame
        lda by
b_accept:
        sta sy,x
        lda slot_ptr,y
        sta sptr,x
        lda slot_col,y
        sta scol,x
        lda slot_xl,y
        sta sx,x
        lda slot_xh,y           // bit 8 of X into the running $D010
        lsr
        lda d010run
        bcc b_clear
        ora bitm,x
        bcs b_store             // ora leaves the carry set
b_clear:
        and bitc,x
b_store:
        sta d010run
        sta sd010,x
        lda slot_pri,y          // priority into the running $D01B
        lsr
        lda d01brun
        bcc b_pclear
        ora bitm,x
        bcs b_pstore
b_pclear:
        and bitc,x
b_pstore:
        sta d01brun
        sta sd01b,x
        inx
        jmp b_loop
b_done:
        stx acc                 // fewer than eight: the frame IRQ writes the
!:      txa                     // $D010/$D01B stored with entry 7, so fill up to it
        sec
        sbc bo
        cmp #8
        bcs !+
        lda d010run
        sta sd010,x
        lda d01brun
        sta sd01b,x
        inx
        bne !-
!:      lda acc                 // sprites shown, and the enable mask
        sec
        sbc bo
        sta mux_shown
        cmp mux_peak
        bcc !+
        sta mux_peak
!:      ldx mux_shown
        cpx #8
        bcc !+
        ldx #8
!:      lda enmask,x
        ldy bo
        sta en_b,y

        lda bo                  // zones over accepted sprites 8..acc-1
        sta zw
        clc
        adc #8
        tax
z_loop: cpx acc
        bcs z_done
        ldy zw
        txa
        sta zstart,y
        lda sy,x
        sta ybase
        clc
        adc #JOIN
        sta ylim
        lda #0
        sta zn
z_in:   inx
        inc zn
        cpx acc
        bcs z_close
        lda sy,x
        cmp ylim
        bcc z_in
        beq z_in
z_close:
        txa
        sta zend,y
        lda ybase
        sec
        sbc #LEAD
        sbc zn
        sta zline,y
        inc zw
        jmp z_loop
z_done: ldy bo
        lda zw
        sta zlast_b,y
        rts

// Zone body: write every sprite of zone zidx, Y first; then the next zone, or
// the band IRQ after the last one (kernel.asm's arm_split).
zone_body:
        ldx zidx
        lda zend,x
        sta zend_tmp
        ldy zstart,x
zl:     ldx slot2,y
        lda sy,y
        sta $d001,x
        lda sx,y
        sta $d000,x
        ldx slot,y
        lda sptr,y
        sta PTRS,x
        lda scol,y
        sta $d027,x
        lda sd010,y
        sta $d010
        lda sd01b,y
        sta $d01b
        iny
        cpy zend_tmp
        bne zl
        ldx zidx
        inx
        stx zidx
        cpx zlast
        beq z_to_split
        lda zline,x
        jmp schedule
z_to_split:
        jsr arm_split           // the band's own vector and line
        lda #SPLIT_IRQ-MARGIN
        cmp $d012
        bcs on_time             // in time: return and let it fire
        inc mux_late            // late: run it now, with the band's three pushes
        lda irq_own
        bne !+
        lda #$00                // this zone's timer B pair ends here
        sta $dd0f
!:      ldy save_y
        ldx save_x
        lda save_a
        pha
        txa
        pha
        tya
        pha
        jmp split_body

// schedule: A = next line. If the raster is already within MARGIN lines of it,
// run the next body now instead of returning and missing it a frame.
schedule:
        sta $d012
        sec
        sbc #MARGIN
        cmp $d012
        bcs on_time
        inc mux_late
        jmp dispatch
on_time:
        lda #$01
        sta $d019
        jmp irq_exit

zidx:     .byte 0
zlast:    .byte 0
zend_tmp: .byte 0
mux_late: .byte 0          // times the late guard ran a zone at once (wraps)

// The frame IRQ: swap in the half C committed.
mux_swap:
        lda mux_front
        eor #BUF
        sta mux_front
        rts

// The frame IRQ's sprite half: write the first eight of the front half.
mux_frame:
        ldy mux_front
        .for (var s = 0; s < 8; s++) {
            lda sy + s, y
            sta $d001 + s * 2
            lda sx + s, y
            sta $d000 + s * 2
            lda sptr + s, y
            sta PTRS + s
            lda scol + s, y
            sta $d027 + s
        }
        lda sd010 + 7, y
        sta $d010
        lda sd01b + 7, y
        sta $d01b
        lda en_b, y
        sta $d015
        sty zidx
        lda zlast_b, y
        sta zlast
        rts
