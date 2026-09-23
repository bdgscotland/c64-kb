// music.asm: an original three-voice tune and the player that plays it,
// behind the init/play convention most tracker exports use
// (sid_play_routine_pattern): JSR $1000 once with A = subtune, JSR $1003
// once a frame. To use a GoatTracker or other export instead, replace this
// file with the tune's binary at $1000 (`.import binary`, header stripped)
// and keep the two calls; the NTSC tempo skip lives in the framework.
//
// This player's one extension of the convention: X = 0 (PAL) or 1 (NTSC) at
// init picks the frequency table, so the pitch is right on both clocks.
//
// The tune: A minor, F, C, G; a sawtooth bass, a pulse arpeggio that steps
// through the chord every frame, and noise and triangle drums on voice 3.
// 32 steps of 7 frames: 224 frames a loop, 4.48 s on PAL.

* = $1000 "music"
MUSIC_INIT: jmp m_init
MUSIC_PLAY: jmp m_play

.const STEP_FRAMES = 7
.const STEPS       = 32
.const NOTE0       = 24                // the frequency tables start at C1 (MIDI 24)
.const NOTES       = 73                // to C7

m_init:
        ldy #NOTES - 1                 // X = model: copy that clock's table
!:      cpx #0
        bne !ntsc+
        lda freq_lo_pal,y
        sta freq_lo,y
        lda freq_hi_pal,y
        sta freq_hi,y
        jmp !next+
!ntsc:  lda freq_lo_ntsc,y
        sta freq_lo,y
        lda freq_hi_ntsc,y
        sta freq_hi,y
!next:  dey
        bpl !-
        lda #0
        ldx #$18
!:      sta $d400,x                    // silence every register first
        dex
        bpl !-
        sta m_step
        sta m_tick
        sta m_arp
        sta m_drum_left
        lda #$09                       // bass: attack 0, decay 9, sustain 10, release 9
        sta $d405
        lda #$a9
        sta $d406
        lda #$00                       // arpeggio: pulse width 50 %, sustain 10
        sta $d409
        lda #$08
        sta $d40a
        lda #$00
        sta $d40c
        lda #$a6
        sta $d40d
        lda #$41                       // pulse, gate on: held for the whole tune
        sta $d40b
        lda #$0f                       // volume 15, no filter
        sta $d418
        rts

m_play:
        // Voice 2: the next tone of the current chord, every frame.
        lda m_step
        lsr
        lsr
        lsr                            // chord = step / 8
        sta m_tmp
        asl
        adc m_tmp                      // x 3 tones
        adc m_arp
        tax
        ldy chord_tones,x
        lda freq_lo - NOTE0,y
        sta $d407
        lda freq_hi - NOTE0,y
        sta $d408
        inc m_arp
        lda m_arp
        cmp #3
        bne !+
        lda #0
        sta m_arp
!:
        // Voice 3: the running drum's pitch slide, then its gate off.
        lda m_drum_left
        beq !+
        lda m_drum_hi
        clc
        adc m_drum_step
        sta m_drum_hi
        sta $d40f
        dec m_drum_left
        bne !+
        lda m_drum_wave
        sta $d412                      // gate off: the release runs
!:
        // A new step on tick 0.
        lda m_tick
        bne !later+
        ldx m_step
        ldy bass,x
        beq !+
        lda freq_lo - NOTE0,y
        sta $d400
        lda freq_hi - NOTE0,y
        sta $d401
        lda #$21                       // sawtooth, gate on
        sta $d404
!:      ldy drums,x
        beq !advance+
        lda drum_ad - 1,y
        sta $d413
        lda drum_sr - 1,y
        sta $d414
        lda drum_hi - 1,y
        sta m_drum_hi
        sta $d40f
        lda drum_step - 1,y
        sta m_drum_step
        lda drum_frames - 1,y
        sta m_drum_left
        lda drum_wave - 1,y
        sta m_drum_wave
        ora #$01
        sta $d412                      // gate on
        jmp !advance+
!later: cmp #STEP_FRAMES - 1           // last frame of a step: gate the bass off
        bne !advance+                  // if the next step plays a note, so its
        ldx m_step                     // envelope restarts cleanly
        inx
        txa
        and #STEPS - 1
        tax
        lda bass,x
        beq !advance+
        lda #$20
        sta $d404
!advance:
        inc m_tick
        lda m_tick
        cmp #STEP_FRAMES
        bne !+
        lda #0
        sta m_tick
        lda m_step
        clc
        adc #1
        and #STEPS - 1
        sta m_step
!:      rts

// ---- the tune ---------------------------------------------------------------
.function BassBar(root) {
    .return List().add(root, 0, root + 12, root, 0, root, root + 12, root + 7)
}
bass:
        .for (var c = 0; c < 4; c++) {
            .var bar = BassBar(List().add(33, 29, 36, 31).get(c))
            .for (var i = 0; i < 8; i++) { .byte bar.get(i) }
        }
chord_tones:                           // Am, F, C, G: three tones each
        .byte 57, 60, 64,  53, 57, 60,  55, 60, 64,  55, 59, 62
drums:                                 // 1 kick, 2 snare, 3 hat
        .for (var c = 0; c < 4; c++) {
            .byte 1, 0, 3, 0, 2, 0, 3, 3
        }
//                   kick  snare  hat
drum_wave:   .byte   $10,  $80,   $80
drum_ad:     .byte   $00,  $00,   $00
drum_sr:     .byte   $a0,  $a8,   $80
drum_hi:     .byte   $18,  $20,   $50
drum_step:   .byte   $f9,  $00,   $00  // kick: $18, $11, $0a, $03
drum_frames: .byte   3,    2,     1

// SID frequency = Hz * 2^24 / clock; A4 = 440 Hz. PAL 985,248 Hz, NTSC
// 1,022,727 Hz (docs/hardware/pal-ntsc-reference.md; the tables are arithmetic).
.function NoteHz(n) { .return 440 * pow(2, (n - 69) / 12) }
freq_lo_pal:  .fill NOTES, <round(NoteHz(NOTE0 + i) * 16777216 / 985248)
freq_hi_pal:  .fill NOTES, >round(NoteHz(NOTE0 + i) * 16777216 / 985248)
freq_lo_ntsc: .fill NOTES, <round(NoteHz(NOTE0 + i) * 16777216 / 1022727)
freq_hi_ntsc: .fill NOTES, >round(NoteHz(NOTE0 + i) * 16777216 / 1022727)
freq_lo:      .fill NOTES, 0
freq_hi:      .fill NOTES, 0

m_step:      .byte 0
m_tick:      .byte 0
m_arp:       .byte 0
m_tmp:       .byte 0
m_drum_left: .byte 0
m_drum_hi:   .byte 0
m_drum_step: .byte 0
m_drum_wave: .byte 0
