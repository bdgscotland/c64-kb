// engine.asm: the KickAssembler half of the brawler. The harness assembles
// it to build/asm.bin (raw bytes from $0900) and build/asm.h, which gives C
// an ASM_<LABEL> for every top-level label below.
//
//   irq_blank, irq_band, irq_split   the IRQ chain: lines 251, 76 and 212
//   band tables (bx0 ... ben2)        what the chain writes to the sprites,
//                                     double-buffered; C fills the back half
//   slice_copy                        the scroll: five rows of one page into
//                                     the other, one column to the left
//   nmi_rti                           RESTORE lands here: the KERNAL is out
//   music_init, music_play            an original two-voice tune
//
// C calls slice_copy and the music with `jsr` from __asm blocks. Nothing
// here uses zero page, so nothing collides with Oscar64's registers
// ($02-$53). Arguments and state live in this blob.

.const BLANK_LINE = 251         // below the last display line on PAL and NTSC
.const BAND_LINE  = 76          // after the sign band (lines 53-73), before any fighter (91 up)
.const SPLIT_LINE = 212         // inside the blank character row 20
.const HUD_D016   = $08         // 40 columns, hires, XSCROLL 0
.const HUD_D018   = $28         // screen $C800, characters $E000
.const HUD_PTRS   = $cbf8       // the HUD page's sprite pointers

* = $0900 "asm"

// ---- The sprite bands ---------------------------------------------------------
// The chain reuses all eight sprites three times a frame. Band 0, written at
// line 251, is the GO sign (sprite 0, lines 53-73). Band 1, written at line
// 76, is the fighters: two parts each, the nearest fighter in sprites 0
// and 1, so the VIC's own priority (a lower sprite is drawn over a higher
// one) is the depth order. Band 2, written at line 212, is the two faces in
// the HUD (sprites 0 and 1, lines 219-239). A band never reuses a sprite
// inside itself, so it never has to drop one; between bands the last use
// of every sprite has ended at least two lines before the next is written
// (c64-kb sprite_dma_overflow).
//
// Every table is 16 bytes: two halves of 8, one per sprite. The IRQs read
// the half at `front` (0 or 8); C writes the other half, then sets `ready`.
// irq_blank swaps the halves only when `ready` is set, so a frame whose
// work runs late shows the last whole set again, never a half-written one
// (sprite_multiplex_game's double-buffered table). $D010 and $D015 are
// whole bytes C computes, one per half, indexed by `fronti` (0 or 1).
front:  .byte 0
fronti: .byte 0
ready:  .byte 0

bx0: .fill 16, 0
by0: .fill 16, 0
bp0: .fill 16, 0
bc0: .fill 16, 0
bx1: .fill 16, 0
by1: .fill 16, 0
bp1: .fill 16, 0
bc1: .fill 16, 0
bx2: .fill 16, 0
by2: .fill 16, 0
bp2: .fill 16, 0
bc2: .fill 16, 0
bmsb0: .byte 0, 0
ben0:  .byte 0, 0
bmsb1: .byte 0, 0
ben1:  .byte 0, 0
bmsb2: .byte 0, 0
ben2:  .byte 0, 0
band_top:  .byte 255            // band 1's lowest Y register, for the late check
band_late: .byte 0              // band 1 IRQs that finished on or after band_top

// Sprites first..first+count-1 from one band's tables, Y = front. The
// pointer stores go to the page on display; for bands 0 and 1 irq_blank
// patches their high byte once a frame (ptrs_hi below).
.macro WriteBand(first, count, tx, ty, tp, tc, tmsb, ten, ptrs) {
sp: .for (var s = first; s < first + count; s++) {
        lda ty + s, y
        sta $d001 + s * 2
        lda tx + s, y
        sta $d000 + s * 2
        lda tp + s, y
ptr:    sta ptrs + s
        lda tc + s, y
        sta $d027 + s
    }
        ldx fronti
        lda tmsb, x
        sta $d010
        lda ten, x
        sta $d015
}

// ---- The meter's share of the IRQs -----------------------------------------------
// In AUTOPILOT builds C sets irq_meter. An IRQ that lands while the main
// loop's meter bracket runs (CIA2 timer A started) is already in that wall
// time; one that lands outside times itself on CIA2 timer B and adds the
// count to irq_cyc, which C folds into the frame (main.c). The cycles
// before the start and after the stop, about 40 an IRQ (arithmetic), are
// not counted.
irq_meter:  .byte 0
irq_timing: .byte 0
irq_cyc:    .word 0
irq_cnt:    .byte 0

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
        sbc $dd06               // $FFFF - timer B, low byte (never borrows)
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

// ---- The chain ------------------------------------------------------------------
// Line 251: the street's $D016 and $D018 from the pair C published, the
// table halves swapped, the pointer page patched, band 0. blank_ticks is
// the main loop's frame start.
irq_blank:
        pha
        txa
        pha
        tya
        pha
        cld
        IrqIn()
        lda pf_d016
        sta $d016
        lda pf_d018
        sta $d018
        lda ready
        beq !keep+
        lda front
        eor #8
        sta front
        lda fronti
        eor #1
        sta fronti
        lda #0
        sta ready
!keep:  lda pf_ptrhi
        sta band0.sp[0].ptr + 2     // the high byte of each pointer store
    .for (var s = 0; s < 8; s++) {
        sta band1.sp[s].ptr + 2
    }
        ldy front
band0:  WriteBand(0, 1, bx0, by0, bp0, bc0, bmsb0, ben0, $c3f8)
        lda #<irq_band
        sta $fffe
        lda #>irq_band
        sta $ffff
        lda #BAND_LINE
        sta $d012
        inc blank_ticks
        jmp irq_done

// Line 76: the fighters.
irq_band:
        pha
        txa
        pha
        tya
        pha
        cld
        IrqIn()
        ldy front
band1:  WriteBand(0, 8, bx1, by1, bp1, bc1, bmsb1, ben1, $c3f8)
        lda $d012
        cmp band_top
        bcc !ok+
        inc band_late           // a part's first line may already have passed
!ok:    lda #<irq_split
        sta $fffe
        lda #>irq_split
        sta $ffff
        lda #SPLIT_LINE
        sta $d012
        jmp irq_done

// Line 212, inside the blank row 20: the HUD's 40 columns, hires and page
// (c64-kb xscroll_applies_to_all_rows), whole values only
// (d016_unmasked_rmw_clobbers_csel_mcm), then the faces.
irq_split:
        pha
        txa
        pha
        tya
        pha
        cld
        IrqIn()
        lda #HUD_D016
        sta $d016
        lda #HUD_D018
        sta $d018
        ldy front
band2:  WriteBand(0, 2, bx2, by2, bp2, bc2, bmsb2, ben2, HUD_PTRS)
        lda #<irq_blank
        sta $fffe
        lda #>irq_blank
        sta $ffff
        lda #BLANK_LINE
        sta $d012
irq_done:
        IrqOut()
        lda #$01
        sta $d019               // acknowledge the raster interrupt
        pla
        tay
        pla
        tax
        pla
nmi_rti:
        rti

blank_ticks: .byte 0
pf_d016:     .byte $17          // multicolour, 38 columns, XSCROLL 7
pf_d018:     .byte $08          // page 0, characters $E000
pf_ptrhi:    .byte $c3          // page 0's pointers at $C3F8

// ---- The scroll, a slice at a time ------------------------------------------------
// The camera only moves right. C prepares the hidden page for the next
// column in four slices of five rows, one a frame, while the camera
// travels the 8 pixels to the crossing; the crossing is then a $D018 flip.
// The page on display is only read. slice_copy copies 39 bytes of each of
// five rows: dst[k * 40 + x] = src[k * 40 + x + 1], x 0..38, k 0..4. C
// passes the first cell of each row. Cost by arithmetic: about 2,000
// cycles (the platformer starter's measure of the same loop).
.const SLICE = 5

slice_src: .word 0
slice_dst: .word 0

slice_copy:
    .for (var k = 0; k < SLICE; k++) {
        clc
        lda slice_src
        adc #<(k * 40 + 1)
        sta rows[k].rd + 1
        lda slice_src + 1
        adc #>(k * 40 + 1)
        sta rows[k].rd + 2
        clc
        lda slice_dst
        adc #<(k * 40)
        sta rows[k].wr + 1
        lda slice_dst + 1
        adc #>(k * 40)
        sta rows[k].wr + 2
    }
        ldx #38
!loop:
rows: .for (var k = 0; k < SLICE; k++) {
rd:     lda $ffff, x            // patched above
wr:     sta $ffff, x
    }
        dex
        bpl !loop-
        rts

// ---- The tune -------------------------------------------------------------------------
// c64-kb sid_play_routine_pattern: music_init once, music_play once a frame.
// Voices 1 and 2 only; voice 3 belongs to the effects in C
// (sfx_engine_beside_music). A voice steps through a sequence of patterns;
// a pattern is MIDI note numbers (36 to 95), 0 a rest, $FF its end. A note
// lasts STEP frames; its gate drops one frame before the next step.
.const STEP = 6
.const LOW  = 36                // the lowest note in the table

// SID frequency words for MIDI notes 36-95 on a PAL clock (985,248 Hz):
// f * 2^24 / 985248 (arithmetic). NTSC plays them about 4% sharp.
.function sidfreq(n) { .return round(440 * pow(2, (n - 69) / 12) * 16777216 / 985248) }
freq_lo: .fill 60, <sidfreq(i + LOW)
freq_hi: .fill 60, >sidfreq(i + LOW)

.macro VoiceTick(sid, wave, cnt, seq, seqdata, pos) {
        dec cnt
        beq !step+
        lda cnt
        cmp #1
        bne !done+
        lda #wave               // the last frame of a step: gate off
        sta sid + 4
        jmp !done+
!step:
        lda #STEP
        sta cnt
!fetch:
        ldy pos
note:   lda $ffff, y            // the pattern's address is patched in
        cmp #$ff
        bne !play+
        ldx seq                 // end of the pattern: the next one
        inx
        lda seqdata, x
        cmp #$ff
        bne !+
        ldx #0                  // end of the sequence: from the top
        lda seqdata
!:      stx seq
        tax
        lda pat_lo, x
        sta note + 1
        lda pat_hi, x
        sta note + 2
        lda #0
        sta pos
        jmp !fetch-
!play:
        inc pos
        cmp #0
        beq !done+              // a rest: the gate is already off
        sec
        sbc #LOW
        tax
        lda freq_lo, x
        sta sid
        lda freq_hi, x
        sta sid + 1
        lda #wave               // restart the envelope
        sta sid + 4
        lda #wave | 1
        sta sid + 4
!done:
}

.macro VoiceStart(cnt, seq, seqdata, pos, note) {
        lda #1
        sta cnt                 // the first play call steps at once
        lda #0
        sta seq
        sta pos
        ldx seqdata
        lda pat_lo, x
        sta note + 1
        lda pat_hi, x
        sta note + 2
}

music_init:
        ldx #$18
        lda #0
!:      sta $d400, x            // SID registers are write-only: set every one
        dex
        bpl !-
        lda #$0f
        sta $d418               // volume 15, no filter
        lda #$18
        sta $d405               // voice 1 (bass, saw): attack 1, decay 8
        lda #$38
        sta $d406               // sustain 3, release 8
        lda #$00
        sta $d409
        lda #$06
        sta $d40a               // voice 2 (lead) pulse width $600
        lda #$09
        sta $d40c               // attack 0, decay 9
        lda #$74
        sta $d40d               // sustain 7, release 4
        VoiceStart(cnt1, seq1, seq1_data, pos1, voice1.note)
        VoiceStart(cnt2, seq2, seq2_data, pos2, voice2.note)
        rts

music_play:
voice1: VoiceTick($d400, $20, cnt1, seq1, seq1_data, pos1)
voice2: VoiceTick($d407, $40, cnt2, seq2, seq2_data, pos2)
        rts

cnt1: .byte 0
seq1: .byte 0
pos1: .byte 0
cnt2: .byte 0
seq2: .byte 0
pos2: .byte 0

// An original tune in A minor, eight patterns a pass, about 15 seconds a
// loop on PAL. Bass (voice 1): A F A E A F E A. Lead (voice 2) over it.
seq1_data: .byte 4, 5, 4, 6, 4, 5, 6, 4, $ff
seq2_data: .byte 0, 1, 0, 2, 0, 1, 2, 3, $ff

pat_lo: .byte <lead_a, <lead_b, <lead_c, <lead_d, <bass_a, <bass_f, <bass_e
pat_hi: .byte >lead_a, >lead_b, >lead_c, >lead_d, >bass_a, >bass_f, >bass_e

lead_a: .byte 69, 0, 72, 0, 76, 0, 74, 72, 69, 0, 67, 0, 69, 0, 0, 0, $ff
lead_b: .byte 72, 0, 74, 0, 76, 0, 79, 0, 77, 76, 74, 0, 72, 0, 0, 0, $ff
lead_c: .byte 76, 0, 76, 74, 72, 0, 74, 0, 76, 0, 81, 0, 79, 77, 76, 0, $ff
lead_d: .byte 74, 0, 72, 0, 71, 0, 68, 0, 69, 0, 0, 0, 0, 0, 0, 0, $ff
bass_a: .byte 45, 0, 45, 57, 45, 0, 45, 57, 45, 0, 45, 57, 43, 0, 43, 55, $ff
bass_f: .byte 41, 0, 41, 53, 41, 0, 41, 53, 43, 0, 43, 55, 43, 0, 43, 55, $ff
bass_e: .byte 40, 0, 40, 52, 40, 0, 40, 52, 40, 0, 40, 52, 44, 0, 44, 56, $ff
