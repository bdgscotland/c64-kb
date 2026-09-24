// music.asm: the tune and its player for MEASURED, at MUSIC_BASE ($1000).
// Ported from c64-kb's kickassembler-sfx-in-player recipe (BSD-3): the
// 25-byte shadow copied to $D400-$D418 once per frame, $18 down to $00;
// per-voice patterns; instruments with AD, SR, waveform and pulse; gate off
// on a note's first frame; the effect entry sfx_request with the queue,
// the voice stealing and the hand-back that re-applies the instrument.
//
// Where this module differs from the recipe, and why:
//   1. It is not a program: no BasicUpstart, no display, no checks, no
//      script. It exposes music_init (A = 0), music_play and music_pos.
//   2. Rows are 2 bytes (note, instrument) and a pattern is 32 rows; the
//      recipe had 1-byte rows of one instrument per voice and idur frames
//      per note. Tempo is a global tick of 6 frames per row; the recipe
//      advanced each voice on its own idur.
//   3. Order lists: each voice walks a table of pattern numbers ended by
//      $FF and a loop-to index. The recipe looped one pattern per voice.
//      music_pos is voice 1's order index, advanced on the frame its
//      previous order's last row ends.
//   4. Instruments are a table indexed by the row's instrument byte, not
//      by voice, and carry a gate length in frames (igate) so notes end,
//      and a vibrato depth (ivib) added to the frequency from frame 16 of
//      a note. Note $FE in a row is an explicit key-off.
//   5. music_init writes the 25 SID registers to 0 directly as well as
//      resetting the shadow, and loads each voice's first pattern.
//   6. The stopwatch lives in the caller (the test runner and the
//      sequencer bracket the call with CIA1 timer A), not in the player.
// Zero page $FB-$FE only, as the recipe (fxptr $FB, patptr $FD).
// Nothing here is called from a raster wait: the caller's line-255
// interrupt is below the badlines, so the call costs the same on PAL and
// NTSC (the recipe's own reason for its LINE 251).

.label fxptr   = $fb        // zero-page pointer to the running effect
.label patptr  = $fd        // zero-page pointer to a voice's pattern

.const ROWS_PER_PATTERN = 32
.const FRAMES_PER_ROW   = 6
.const KEYOFF           = $fe
.const DRUM             = 200   // in the pattern source only: see LeadPat

* = MUSIC_BASE "music"

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

// A = 0 (the only tune). Every SID register and the shadow to a known state.
music_init:
    ldx #$18
mi0:
    lda #0
    sta $d400,x
    sta ghost,x
    dex
    bpl mi0
    lda #$0f
    sta ghost + $18         // volume 15, no filter ($D417 stays 0)
    lda #0
    sta pending
    sta tick
    sta row
    ldx #2
mi1:
    lda #$ff
    sta mtimer,x            // $FF: past every igate, so no gate fires before a note
    lda #0
    sta vord,x              // voice 1's is music_pos
    sta vinst,x
    sta mflo,x
    sta mfhi,x
    sta mctrl,x
    sta sfxnum,x
    sta sfxpos,x
    sta restore,x
    jsr loadpat
    dex
    bpl mi1
    rts

// SFX entry point. A = effect number 1-4; a higher number wins.
// Only one request per frame survives to the player. The demo never calls it.
sfx_request:
    cmp pending
    bcc srdrop
    sta pending
srdrop:
    rts

// Once per frame.
music_play:
    ldy pending             // start the queued effect, if any
    beq plvoices
    ldx fxvoice,y
    tya
    cmp sfxnum,x
    bcc plclear             // lower than the one playing: refused
    sta sfxnum,x
    lda #0
    sta sfxpos,x
plclear:
    lda #0
    sta pending
plvoices:
    ldx #2
plv:
    jsr voice
    dex
    bpl plv
    ldx #$18                // ghost copy: every register, once per frame
plcopy:
    lda ghost,x
    sta $d400,x
    dex
    bpl plcopy
    // tempo: 6 frames per row, 32 rows per pattern, then the next order
    inc tick
    lda tick
    cmp #FRAMES_PER_ROW
    bne pldone
    lda #0
    sta tick
    inc row
    lda row
    cmp #ROWS_PER_PATTERN
    bne pldone
    lda #0
    sta row
    ldx #2
plord:
    jsr nextorder
    dex
    bpl plord
pldone:
    rts

// X = voice: step its order index (loop marker $FF, loop-to index follows)
// and point patptr tables at the new pattern.
nextorder:
    inc vord,x
    jsr loadpat
    rts

loadpat:
    lda ordlo,x
    sta patptr
    lda ordhi,x
    sta patptr + 1
    ldy vord,x
    lda (patptr),y
    cmp #$ff
    bne lp1
    iny
    lda (patptr),y          // the loop-to index
    sta vord,x
    tay
    lda (patptr),y
lp1:
    tay
    lda pt_lo,y
    sta patlo,x
    lda pt_hi,y
    sta pathi,x
    rts

// ---------------------------------------------------------------------------
// One voice. X = voice 0-2. The music advances every frame, owned or not.
// ---------------------------------------------------------------------------
voice:
    lda voff,x
    sta vo
    lda #0
    sta noteinit
    lda tick
    bne vgate               // a row is read on its first frame only
    lda patlo,x
    sta patptr
    lda pathi,x
    sta patptr + 1
    lda row
    asl
    tay
    lda (patptr),y          // note: 0 nothing, $FE key-off, else a note
    beq vgate
    cmp #KEYOFF
    bne vnote
    lda #$ff                // key-off: the timer saturates past every igate
    sta mtimer,x
    bne vgate
vnote:
    sta ntmp
    iny
    lda (patptr),y
    sta vinst,x
    ldy ntmp
    lda freqlo,y
    sta mflo,x
    lda freqhi,y
    sta mfhi,x
    lda #0
    sta mtimer,x
    inc noteinit            // first frame of a note
vgate:
    ldy vinst,x
    lda mtimer,x            // gate off on a note's first frame and from igate
    beq vgoff
    cmp igate,y
    bcs vgoff
    lda iwave,y
    ora #1
    bne vgset
vgoff:
    lda iwave,y
vgset:
    sta mctrl,x
    lda mtimer,x
    cmp #$ff
    beq vowner
    inc mtimer,x
vowner:
    lda sfxnum,x
    bne veffect
vmusic:
    ldy vo
    lda restore,x           // hand-back frame or note start: instrument
    ora noteinit
    beq vfc
    lda #0
    sta restore,x
    stx vidx
    ldy vinst,x             // Y = instrument, X = ghost offset for the writes
    ldx vo
    lda iad,y
    sta ghost + 5,x
    lda isr,y
    sta ghost + 6,x
    lda ipw,y
    sta ghost + 3,x
    lda #0
    sta ghost + 2,x
    ldx vidx
vfc:
    // vibrato: from frame 16 of a note, a signed offset from the
    // instrument's 16-entry table (ivib = 0, 16 or 32) by frame and 15
    lda #0
    sta vtmp
    sta vhi
    lda mtimer,x
    cmp #16
    bcc vnovib
    and #15
    sta vtmp
    ldy vinst,x
    lda ivib,y
    clc
    adc vtmp
    tay
    lda vibtab,y
    sta vtmp
    bpl vnovib
    dec vhi                 // sign extend
vnovib:
    ldy vo
    lda mflo,x
    clc
    adc vtmp
    sta ghost + 0,y
    lda mfhi,x
    adc vhi
    sta ghost + 1,y
    lda mctrl,x
    sta ghost + 4,y
    rts

// Effect data: AD, SR, pulse high, then rows of (control, freq high),
// one row per frame, ended by a control byte of 0.
veffect:
    stx vidx
    ldy sfxnum,x
    lda fxlo,y
    sta fxptr
    lda fxhi,y
    sta fxptr + 1
    ldy sfxpos,x
    ldx vo
    cpy #0
    bne vrow
    lda (fxptr),y           // first frame: the effect's envelope and pulse
    sta ghost + 5,x
    iny
    lda (fxptr),y
    sta ghost + 6,x
    iny
    lda (fxptr),y
    sta ghost + 3,x
    lda #0
    sta ghost + 2,x
    iny
vrow:
    lda (fxptr),y
    beq vend
    sta ghost + 4,x
    iny
    lda (fxptr),y
    sta ghost + 1,x
    lda #0
    sta ghost + 0,x
    iny
    tya
    ldx vidx
    sta sfxpos,x
    rts
vend:
    ldx vidx                // effect over: hand the voice back this frame
    lda #0
    sta sfxnum,x
    lda #1
    sta restore,x
    jmp vmusic

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------
tick:       .byte 0
row:        .byte 0
pending:    .byte 0
ntmp:       .byte 0
vo:         .byte 0
vidx:       .byte 0
vtmp:       .byte 0
vhi:        .byte 0
noteinit:   .byte 0
vord:                       // order index per voice; voice 1's is music_pos
music_pos:  .byte 0
            .byte 0, 0
vinst:      .fill 3, 0
mtimer:     .fill 3, 0
mflo:       .fill 3, 0
mfhi:       .fill 3, 0
mctrl:      .fill 3, 0
patlo:      .fill 3, 0
pathi:      .fill 3, 0
sfxnum:     .fill 3, 0
sfxpos:     .fill 3, 0
restore:    .fill 3, 0
music_shadow:               // the 25-byte shadow, readable by a test runner
ghost:      .fill 25, 0

// ---------------------------------------------------------------------------
// Instruments: index = the row's instrument byte
//   0 bass pulse    1 bass triangle (intro)   2 arpeggio saw   3 pad saw
//   4 lead pulse    5 snare noise             6 lead short     7 kick noise
// ---------------------------------------------------------------------------
voff:    .byte 0, 7, 14
iwave:   .byte $40, $10, $20, $20, $40, $80, $40, $80
iad:     .byte $09, $0a, $08, $2a, $07, $03, $05, $05
isr:     .byte $a8, $c9, $79, $9a, $8a, $00, $69, $00
ipw:     .byte $08, $00, $00, $00, $04, $00, $06, $00   // pulse width high nybble
igate:   .byte 20,  40,  5,   34,  30,  2,   10,  3    // frames the gate stays on
ivib:    .byte 0,   0,   0,   0,   16,  0,   32,  0    // vibtab offset

// 16 frames of signed frequency offset: depth 1 (small) and depth 2 (wider)
vibtab:  .byte 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
         .byte 0, 6, 11, 14, 16, 14, 11, 6, 0, -6, -11, -14, -16, -14, -11, -6
         .byte 0, 12, 22, 28, 32, 28, 22, 12, 0, -12, -22, -28, -32, -28, -22, -12

// 84 semitones from C-0, PAL clock: f * 16777216 / 985248. Entry 0 unused.
.const K = 16777216 / 985248
freqlo:  .byte 0
         .fill 84, <round(K * 16.3516 * pow(2, i / 12))
freqhi:  .byte 0
         .fill 84, >round(K * 16.3516 * pow(2, i / 12))

// Effect number n: voice and data. Entry 0 is unused. Kept for a later
// release; the demo never requests one.
fxvoice: .byte 0, 2, 2, 2, 0
fxlo:    .byte 0, <fx1, <fx2, <fx3, <fx4
fxhi:    .byte 0, >fx1, >fx2, >fx3, >fx4
fx1:     .byte $00, $f0, $02                    // 10 frames, falling blip
.for (var r = 0; r < 9; r++) { .byte $41, $30 - r * 3 }
         .byte $40, $08, 0
fx2:     .byte $0c, $00, $08                    // 40 frames, noise
.for (var r = 0; r < 39; r++) { .byte $81, $28 - (r >> 1) }
         .byte $80, $10, 0
fx3:     .byte $00, $c9, $03                    // 20 frames, rising
.for (var r = 0; r < 19; r++) { .byte $41, $10 + r * 2 }
         .byte $40, $38, 0
fx4:     .byte $05, $50, $0c                    // 10 frames, voice 1
.for (var r = 0; r < 9; r++) { .byte $11, $20 + r * 4 }
         .byte $10, $40, 0

// ---------------------------------------------------------------------------
// The tune. Four chords, eight rows each, per pattern: Am F C G.
// Orders 0-4 intro, 5-9 first lead, 10-14 second lead, 15-18 high lead,
// 19-22 the calm end loop. 23 orders per voice, loop to 19.
// ---------------------------------------------------------------------------
.function N(semi, oct) { .return oct * 12 + semi + 1 }
.const C = 0
.const D = 2
.const E = 4
.const F = 5
.const G = 7
.const A = 9
.const B = 11

.const A2 = N(A, 2)
.const F2 = N(F, 2)
.const C3 = N(C, 3)
.const G2 = N(G, 2)
.const A3 = N(A, 3)
.const F3 = N(F, 3)
.const C4 = N(C, 4)
.const G3 = N(G, 3)
.const E4 = N(E, 4)
.const F4 = N(F, 4)
.const G4 = N(G, 4)
.const A4 = N(A, 4)
.const B4 = N(B, 4)
.const C5 = N(C, 5)
.const D5 = N(D, 5)
.const E5 = N(E, 5)
.const F5 = N(F, 5)
.const G5 = N(G, 5)
.const A5 = N(A, 5)

// A chord pattern: 4 chords x 8 rows from a template of intervals.
// -1 rest; 3 the chord's third (minor or major); 15 the third an octave up;
// anything else a semitone offset from the root.
.var bassroots = List().add(A2, F2, C3, G2)
.var arproots  = List().add(A3, F3, C4, G3)
.var thirds    = List().add(3, 4, 4, 4)

.macro ChordPat(roots, tmpl, inst) {
    .for (var c = 0; c < 4; c++) {
        .for (var r = 0; r < 8; r++) {
            .var iv = tmpl.get(r)
            .if (iv < 0) {
                .byte 0, 0
            } else {
                .if (iv == 3) { .eval iv = thirds.get(c) }
                .if (iv == 15) { .eval iv = thirds.get(c) + 12 }
                .byte roots.get(c) + iv, inst
            }
        }
    }
}

// A lead pattern: 32 explicit rows. 0 nothing, DRUM a snare (instrument 5),
// KEYOFF a key-off, else a note on instrument inst.
.macro LeadPat(rows, inst) {
    .for (var r = 0; r < 32; r++) {
        .var v = rows.get(r)
        .if (v == 0) {
            .byte 0, 0
        } else {
            .if (v == DRUM) {
                .byte A4, 5
            } else {
                .if (v == KEYOFF) {
                    .byte KEYOFF, 0
                } else {
                    .byte v, inst
                }
            }
        }
    }
}

// Voice 1: bass
pat_b0:  ChordPat(bassroots, List().add(0, -1, -1, -1, 12, -1, -1, -1), 1)   // intro, triangle
pat_b1:  ChordPat(bassroots, List().add(0, -1, 0, 12, 0, -1, 12, 0), 0)      // driving
pat_b2:  ChordPat(bassroots, List().add(0, -1, 0, 7, 12, -1, 7, 0), 0)       // walking
pat_b3:  ChordPat(bassroots, List().add(0, -1, -1, 7, -1, -1, 12, -1), 0)    // calm end
// Voice 2: chords and arpeggios (sawtooth)
pat_a0:  ChordPat(arproots, List().add(0, -1, 3, -1, 7, -1, 12, -1), 3)      // slow pad
pat_a1:  ChordPat(arproots, List().add(0, 3, 7, 12, 7, 3, 0, 3), 2)          // arpeggio up and down
pat_a2:  ChordPat(arproots, List().add(12, 7, 3, 0, 3, 7, 12, 15), 2)        // arpeggio from the top
// Voice 3: lead with drums where it rests
pat_l0:  LeadPat(List().add(
            0, 0, DRUM, 0, 0, 0, DRUM, 0,
            0, 0, DRUM, 0, 0, 0, DRUM, 0,
            0, 0, DRUM, 0, 0, 0, DRUM, 0,
            E5, 0, DRUM, 0, A4, 0, DRUM, 0), 6)
pat_l1:  LeadPat(List().add(
            A4, 0, C5, 0, E5, 0, DRUM, 0,
            F5, 0, E5, 0, C5, 0, DRUM, 0,
            E5, 0, G5, 0, E5, 0, DRUM, 0,
            D5, 0, B4, 0, G4, 0, DRUM, 0), 4)
pat_l2:  LeadPat(List().add(
            A4, C5, E5, A5, G5, E5, DRUM, C5,
            F5, E5, C5, A4, C5, F5, DRUM, E5,
            E5, D5, C5, E5, G5, E5, DRUM, D5,
            D5, B4, G4, B4, D5, G5, DRUM, B4), 6)
pat_l3:  LeadPat(List().add(
            A5, 0, 0, 0, E5, 0, DRUM, 0,
            F5, 0, 0, 0, C5, 0, DRUM, 0,
            G5, 0, 0, 0, E5, 0, DRUM, 0,
            B4, 0, D5, 0, G5, 0, DRUM, 0), 4)
pat_l4:  LeadPat(List().add(
            E5, 0, C5, 0, A4, 0, DRUM, 0,
            C5, 0, A4, 0, F4, 0, DRUM, 0,
            G4, 0, 0, 0, E4, 0, DRUM, KEYOFF,
            G4, A4, B4, 0, D5, 0, DRUM, 0), 4)

// Pattern numbers
pt_lo:   .byte <pat_b0, <pat_b1, <pat_b2, <pat_b3, <pat_a0, <pat_a1, <pat_a2
         .byte <pat_l0, <pat_l1, <pat_l2, <pat_l3, <pat_l4
pt_hi:   .byte >pat_b0, >pat_b1, >pat_b2, >pat_b3, >pat_a0, >pat_a1, >pat_a2
         .byte >pat_l0, >pat_l1, >pat_l2, >pat_l3, >pat_l4

// Order lists: 23 entries, $FF, loop-to index. Character changes at
// orders 5, 10, 15 and 19.
ord1:    .byte 0, 0, 0, 0, 0,  1, 1, 1, 1, 1,  2, 2, 2, 2, 2,  1, 1, 1, 1,  3, 3, 3, 3,  $ff, 19
ord2:    .byte 4, 4, 4, 4, 4,  5, 5, 5, 5, 5,  6, 6, 6, 6, 6,  5, 5, 5, 5,  4, 4, 4, 4,  $ff, 19
ord3:    .byte 7, 7, 7, 7, 7,  8, 8, 8, 8, 8,  9, 9, 9, 9, 9,  10, 10, 10, 10,  11, 11, 11, 11,  $ff, 19
ordlo:   .byte <ord1, <ord2, <ord3
ordhi:   .byte >ord1, >ord2, >ord3

music_end:
.assert "music fits below $2000", music_end <= $2000, true
