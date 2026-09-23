// mux.asm: the sprite multiplexer, imported by kernel.asm.
//
// Mechanism from c64-kb's kickassembler/sprite-multiplex-game recipe
// (technique sprite_multiplex_game): a persistent insertion sort by Y, a
// sorted table built into the half the IRQs are not reading, zone IRQs that
// reuse the eight hardware sprites further down, and a late guard. Changes
// here: no zero page (Oscar64 owns $02-$52), sixteen actors, sprite
// pointers written into both playfield screens, an enable mask for fewer
// than eight sprites, and a cut-off Y below which nothing is shown, so no
// sprite is on the lines where the panel split is timed.
//
// C fills act_y/act_hx/act_ptr/act_col (Y = OFF_Y hides an actor),
// then calls mux_sort and mux_build once a frame, after mux_ready is 0.

.const N       = 16        // actors
.const BUF     = 16        // offset of sorted half 1 (a multiple of 8)
.const MIN_GAP = 21        // a reused slot's next Y must be >= its last Y + 21
.const JOIN    = 4         // sprites within 4 lines of a zone's first join it
.const LEAD    = 3         // zone IRQ line = first Y - LEAD - sprites in zone
.const MARGIN  = 3         // late guard: within 3 lines of the next line? run it now
.const MAX_SY  = 187       // lowest Y shown: its last line is 208, clear of the split
.const OFF_Y   = $ff       // an actor with this Y is not shown

// ---- the actor tables C writes ------------------------------------------
act_y:     .fill N, OFF_Y
act_hx:    .fill N, 0      // half X: sprite X = 2 * hx
act_ptr:   .fill N, 0
act_col:   .fill N, 0
order:     .fill N, i
mux_ready: .byte 0         // C sets nothing; build sets 1, the frame IRQ clears it
mux_shown: .byte 0         // sprites accepted by the last build (for the verdict)
mux_peak:  .byte 0         // most sprites accepted in one build since init
mux_front: .byte 0         // 0 or BUF: the half the IRQs read

// ---- sorted halves and zone tables (half 0 at 0, half 1 at BUF) ---------
sy:      .fill 2*BUF, 0
sx:      .fill 2*BUF, 0
sptr:    .fill 2*BUF, 0
scol:    .fill 2*BUF, 0
sd010:   .fill 2*BUF, 0
zstart:  .fill 2*BUF, 0
zend:    .fill 2*BUF, 0
zline:   .fill 2*BUF, 0
zlast_b: .fill 2*BUF, 0
en_b:    .fill 2*BUF, 0    // $D015 for the half: one bit per slot in use
slot:    .fill 2*BUF, i & 7
slot2:   .fill 2*BUF, (i & 7) * 2
bitm:    .fill 2*BUF, 1 << (i & 7)
enmask:  .byte $00, $01, $03, $07, $0f, $1f, $3f, $7f, $ff

// build's scratch
bo:      .byte 0
acc:     .byte 0
bk:      .byte 0
by:      .byte 0
d010run: .byte 0
zw:      .byte 0
ybase:   .byte 0
ylim:    .byte 0
zn:      .byte 0
key:     .byte 0
cand:    .byte 0
s_i:     .byte 0

// ---------------------------------------------------------------------------
// Persistent insertion sort: order[] keeps last frame's order, so an actor
// that has not passed a neighbour costs one compare. Ties keep their order.
// Aligned so both loop branches stay inside one page (a crossing costs a
// cycle a branch: the recipe measured 611 against 656 cycles).
// ---------------------------------------------------------------------------
.align $100
mux_sort:
        ldx #1
s_loop: ldy order,x
        lda act_y,y
        ldy order-1,x
        cmp act_y,y
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
        lda act_y,y
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

// ---------------------------------------------------------------------------
// Build the back half: accept each sorted actor that can be shown, keep a
// running $D010, then group sprites 8 onward into zones.
// ---------------------------------------------------------------------------
mux_build:
        lda mux_front
        eor #BUF
        sta bo
        sta acc
        lda #0
        sta d010run
        ldx #0
b_loop: stx bk
        ldy order,x
        lda act_y,y
        cmp #MAX_SY+1
        bcs b_done              // sorted: every later actor is lower still
        sta by
        ldx acc
        txa
        sec
        sbc bo
        cmp #8
        bcc b_accept            // the first eight always fit
        lda by
        sec
        sbc sy-8,x              // gap to the last sprite this slot showed
        cmp #MIN_GAP
        bcc b_next              // too close: this actor is not shown this frame
b_accept:
        lda by
        sta sy,x
        lda act_ptr,y
        sta sptr,x
        lda act_col,y
        sta scol,x
        lda act_hx,y            // X = 2 * hx: bit 8 comes out in the carry
        asl
        sta sx,x
        bcc b_clear
        lda d010run
        ora bitm,x
        jmp b_store
b_clear:
        lda bitm,x
        eor #$ff
        and d010run
b_store:
        sta d010run
        sta sd010,x
        inx
        stx acc
b_next: ldx bk
        inx
        cpx #N
        bne b_loop
b_done:
        ldx acc                 // fewer than eight: the frame IRQ writes the
                                // $D010 stored with entry 7, so fill up to it
!:      txa
        sec
        sbc bo
        cmp #8
        bcs !+
        lda d010run
        sta sd010,x
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
        lda #1
        sta mux_ready
        rts

// Zone body: write every sprite of zone zidx, Y first; then the next zone,
// or the panel split after the last one (kernel.asm's arm_split).
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
        sta PTRS_A,x
        sta PTRS_B,x
        lda scol,y
        sta $d027,x
        lda sd010,y
        sta $d010
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
        jsr arm_split           // the split's own vector and line
        lda #SPLIT_LINE-MARGIN
        cmp $d012
        bcs on_time             // in time: return and let it fire
        inc mux_late            // late: run it now; the ack at its end clears
        inc split_late          // the match latched meanwhile
        jmp split_body

// schedule: A = next line. If the raster is already within MARGIN lines of
// it, run the next body now instead of returning and missing it a frame.
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

// The frame IRQ's sprite half: swap in a ready build, write the first eight.
mux_frame:
        lda mux_ready
        beq !+
        lda mux_front
        eor #BUF
        sta mux_front
        lda #0
        sta mux_ready
!:      ldy mux_front
        .for (var s = 0; s < 8; s++) {
            lda sy + s, y
            sta $d001 + s * 2
            lda sx + s, y
            sta $d000 + s * 2
            lda sptr + s, y
            sta PTRS_A + s
            sta PTRS_B + s
            lda scol + s, y
            sta $d027 + s
        }
        lda sd010 + 7, y
        sta $d010
        lda en_b, y
        sta $d015
        sty zidx
        lda zlast_b, y
        sta zlast
        rts
