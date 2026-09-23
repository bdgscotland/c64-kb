// engine.asm: the KickAssembler half of the platformer. The harness
// assembles it to build/asm.bin (raw bytes from $0900) and build/asm.h,
// which gives C an ASM_<LABEL> for every top-level label below.
//
//   slice_copy                the coarse scroll: five rows of one page into
//                             another, one column over (see "Coarse shift")
//   irq_split, irq_blank      the HUD split at line 212, the playfield back at 251
//   nmi_rti                   RESTORE lands here: the KERNAL is banked out
//   music_init, music_play    an original two-voice tune (see "Tune")
//
// Calling convention: C calls these with `jsr` from __asm blocks. They use
// A, X and Y and no zero page, so they cannot collide with Oscar64's
// registers ($02-$52). The tune keeps its state in this blob.

.const HUD_D016 = $08           // 40 columns, hires, XSCROLL 0
.const HUD_D018 = $28           // screen $C800, characters $E000

* = $0900 "asm"

// ---- Coarse shift, a slice at a time ------------------------------------------
// C prepares the page for the next column crossing in four slices of five
// rows, one slice a frame, while the camera travels the 8 pixels to that
// crossing; the crossing itself is then only a $D018 flip. The page on
// display is only ever read. slice_copy copies 39 bytes of each of five
// rows: dst[k * 40 + x] = src[k * 40 + x], x 38..0, k 0..4. C passes the
// first cell of each: src one column right of dst to move the picture
// left, one column left to move it right.
//
// Cost by arithmetic: the patch, about 170 cycles; each x, 5 x (lda abs,x
// 4 or 5 + sta abs,x 5) + dex/bpl 5, about 52; 39 of them, about 2,000.

.const SLICE = 5                        // rows a call

slice_src: .word 0
slice_dst: .word 0

slice_copy:
    .for (var k = 0; k < SLICE; k++) {
        clc
        lda slice_src
        adc #<(k * 40)
        sta rows[k].rd + 1
        lda slice_src + 1
        adc #>(k * 40)
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
rd:     lda $ffff, x                    // patched above
wr:     sta $ffff, x
    }
        dex
        bpl !loop-
        rts

// ---- Split ----------------------------------------------------------------
// Two raster IRQs a frame. At line 212, inside character row 20 (blank on
// every playfield page), the HUD rows below get 40 columns, hires, XSCROLL
// 0 and their own screen page (c64-kb xscroll_applies_to_all_rows). At
// line 251, below the last display line, the playfield's $D016 and $D018
// come back from pf_d016 and pf_d018, which C publishes as a pair once a
// frame's work is done. Because the IRQ, not the main loop, puts them back,
// a frame whose work overruns shows the previous picture again, never the
// HUD page. Whole values are written, never a read-modify-write of $D016
// (d016_unmasked_rmw_clobbers_csel_mcm). blank_ticks counts the blanks:
// the main loop starts a frame when it changes (polling $D012 for 251
// would miss the line the IRQ spends), and a count that moves during a
// frame's work marks the frame late.
irq_split:
        pha
        lda #HUD_D016
        sta $d016
        lda #HUD_D018
        sta $d018
        lda #<irq_blank
        sta $fffe
        lda #>irq_blank
        sta $ffff
        lda #251
        sta $d012
        lda #$01
        sta $d019               // acknowledge the raster interrupt
        pla
nmi_rti:
        rti

irq_blank:
        pha
        lda pf_d016
        sta $d016
        lda pf_d018
        sta $d018
        lda #<irq_split
        sta $fffe
        lda #>irq_split
        sta $ffff
        lda #212
        sta $d012
        lda #$01
        sta $d019
        inc blank_ticks         // the main loop's frame start
        pla
        rti

blank_ticks: .byte 0
pf_d016:     .byte $17          // multicolour, 38 columns, XSCROLL 7
pf_d018:     .byte $08          // page 0, characters $E000

// ---- Tune -------------------------------------------------------------------
// The init + play convention of c64-kb sid_play_routine_pattern: music_init
// once, music_play once a frame. Voices 1 and 2 only; voice 3 belongs to the
// sound effects in C (sfx_engine_beside_music). Each voice steps through a
// sequence of patterns; a pattern is MIDI note numbers, 0 a rest, $FF its
// end. A note lasts STEP frames and its gate drops one frame before the next
// step, so repeated notes are heard apart.
.const STEP = 7

// SID frequency words for MIDI notes 0-107 on a PAL clock (985,248 Hz):
// f * 2^24 / 985248 (arithmetic). NTSC plays them about 4% sharp.
.function sidfreq(n) { .return round(440 * pow(2, (n - 69) / 12) * 16777216 / 985248) }
freq_lo: .fill 108, <sidfreq(i)
freq_hi: .fill 108, >sidfreq(i)

// One voice's player. sid = the voice's first SID register, wave = its
// waveform bits (gate off).
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

// Point a voice at the first pattern of its sequence.
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
        lda #$00
        sta $d402
        lda #$04
        sta $d403               // voice 1 pulse width $400: a hollow bass
        lda #$28
        sta $d405               // voice 1 attack 2, decay 8
        lda #$44
        sta $d406               // voice 1 sustain 4, release 4
        lda #$00
        sta $d409
        lda #$08
        sta $d40a               // voice 2 pulse width $800: a square lead
        lda #$0a
        sta $d40c               // voice 2 attack 0, decay 10
        lda #$63
        sta $d40d               // voice 2 sustain 6, release 3
        VoiceStart(cnt1, seq1, seq1_data, pos1, voice1.note)
        VoiceStart(cnt2, seq2, seq2_data, pos2, voice2.note)
        rts

// voice1.note and voice2.note are the patched loads inside each tick.
music_play:
voice1: VoiceTick($d400, $40, cnt1, seq1, seq1_data, pos1)
voice2: VoiceTick($d407, $40, cnt2, seq2, seq2_data, pos2)
        rts

cnt1: .byte 0
seq1: .byte 0
pos1: .byte 0
cnt2: .byte 0
seq2: .byte 0
pos2: .byte 0

// The tune: C major, eight patterns a pass, about 16 seconds a loop on PAL.
// Lead (voice 2) over a bass (voice 1): C F C G C F G C.
seq1_data: .byte 4, 5, 4, 6, 4, 5, 6, 7, $ff
seq2_data: .byte 0, 1, 0, 2, 0, 1, 2, 3, $ff

pat_lo: .byte <lead_a, <lead_b, <lead_c, <lead_d, <bass_c, <bass_f, <bass_g, <bass_end
pat_hi: .byte >lead_a, >lead_b, >lead_c, >lead_d, >bass_c, >bass_f, >bass_g, >bass_end

lead_a:   .byte 76, 0, 79, 0, 84, 0, 79, 0, 81, 0, 79, 76, 0, 74, 0, 0, $ff
lead_b:   .byte 77, 0, 81, 0, 84, 0, 81, 0, 79, 0, 76, 0, 72, 0, 0, 0, $ff
lead_c:   .byte 76, 76, 74, 72, 74, 0, 67, 0, 72, 74, 76, 77, 76, 0, 74, 0, $ff
lead_d:   .byte 72, 0, 67, 0, 64, 0, 67, 0, 72, 0, 0, 0, 0, 0, 0, 0, $ff
bass_c:   .byte 48, 0, 55, 0, 48, 0, 55, 0, 48, 0, 55, 0, 48, 0, 55, 0, $ff
bass_f:   .byte 41, 0, 48, 0, 41, 0, 48, 0, 41, 0, 48, 0, 41, 0, 48, 0, $ff
bass_g:   .byte 43, 0, 50, 0, 43, 0, 50, 0, 43, 0, 50, 0, 43, 0, 50, 0, $ff
bass_end: .byte 48, 0, 43, 0, 48, 0, 0, 0, 36, 0, 0, 0, 0, 0, 0, 0, $ff
