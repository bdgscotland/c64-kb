// sound.asm: a three-voice music player with sound effects inside it,
// imported by kernel.asm. The split IRQ calls music_play once a frame.
//
// Mechanism from c64-kb's kickassembler/sfx-in-player recipe (technique
// sfx_in_player) and the init + play convention of oscar64/sid-music-player
// (sid_play_routine_pattern). The player writes a 25-byte shadow of the SID
// and copies it to $D400-$D418 once a frame. An effect takes voice 3 for its
// length; the music keeps advancing underneath and, while it owns a voice,
// writes that voice's whole instrument every frame, so the frame an effect
// ends the tune's voice 3 is back at once. No zero page: the pattern and
// effect reads patch their own operands. The tune is original.
//
// On NTSC the play routine skips one call in six, so the tune keeps its PAL
// tempo (pitfall pal_ntsc_tempo_mismatch), and music_init loads the NTSC
// frequency table, so it keeps its pitch.

.const PAL_CLOCK  = 985248
.const NTSC_CLOCK = 1022727

// Instruments, one per voice: bass (pulse), lead (sawtooth), drums (noise).
ilen:   .byte 12, 6, 12            // frames a note lasts
iwave:  .byte $40, $20, $80        // waveform, gate bit clear
iad:    .byte $09, $08, $02
isr:    .byte $a8, $64, $00
ipw:    .byte $04, $08, $08        // pulse width, high byte
patlo:  .byte <pat_bass, <pat_lead, <pat_drum
pathi:  .byte >pat_bass, >pat_lead, >pat_drum
voff:   .byte 0, 7, 14             // voice register offsets

vpos:   .fill 3, 0                 // next byte of the pattern
vtime:  .fill 3, 0                 // frames into the note
vnote:  .fill 3, 0                 // the note, 0 = rest

sfx_pending: .byte 0               // highest effect requested since the last play
sfx_num:     .byte 0               // effect on voice 3, 0 = none
sfx_pos:     .byte 0               // next byte of its data
sfx_taken:   .byte 0               // effects started (for the verdict)
ntsc_cnt:    .byte 4
tempo_ntsc:  .byte 0

ghost:  .fill 25, 0                // the SID as the player wants it

// A = 0 for PAL, 1 for NTSC.
music_init:
        sta tempo_ntsc
        beq mi_pal
        ldx #95
!:      lda ntsc_lo,x
        sta freq_lo,x
        lda ntsc_hi,x
        sta freq_hi,x
        dex
        bpl !-
mi_pal: ldx #2
!:      lda #0
        sta vpos,x
        sta vtime,x
        dex
        bpl !-
        sta sfx_pending
        sta sfx_num
        ldx #24
!:      sta ghost,x
        dex
        bpl !-
        lda #$0f
        sta ghost+24               // volume 15, no filter
        rts

// A = effect number 1-3. A higher number wins; call with interrupts off.
sfx_request:
        cmp sfx_pending
        bcc !+
        sta sfx_pending
!:      rts

music_play:
        lda tempo_ntsc
        beq mp_run
        dec ntsc_cnt
        bpl mp_run
        lda #4                     // every sixth NTSC frame: no step
        sta ntsc_cnt
        rts
mp_run: lda sfx_pending            // start the queued effect unless a
        beq mp_fx                  // higher one is playing
        cmp sfx_num
        bcc mp_drop
        sta sfx_num
        tax
        lda fx_lo-1,x
        sta sfx_pos
        inc sfx_taken
        jsr fx_header
        lda #0                     // gate off for one frame, so the next row's
        sta ghost+14+4             // gate on restarts the envelope
        sta sfx_pending
        jmp mp_music
mp_drop:
        lda #0
        sta sfx_pending
mp_fx:  lda sfx_num
        beq mp_music
        jsr fx_row
mp_music:
        ldx #2
!:      jsr voice
        dex
        bpl !-
        ldx #24                    // ghost copy: every register, once a frame
!:      lda ghost,x
        sta $d400,x
        dex
        bpl !-
        rts

// One voice, X = 0-2. The music advances every frame, owned or not.
voice:  lda vtime,x
        bne v_gate
        lda patlo,x                // first frame of a note: fetch it
        sta v_rd+1
        sta v_rd2+1
        lda pathi,x
        sta v_rd+2
        sta v_rd2+2
        ldy vpos,x
v_rd:   lda $ffff,y
        cmp #$ff
        bne v_got
        ldy #0                     // end of pattern: loop
v_rd2:  lda $ffff,y
v_got:  sta vnote,x
        iny
        tya
        sta vpos,x
v_gate: ldy #0                     // gate on for all but a note's last two frames
        lda vnote,x
        beq v_off
        lda vtime,x
        clc
        adc #2
        cmp ilen,x
        bcs v_off
        iny
v_off:  sty v_g+1
        inc vtime,x
        lda vtime,x
        cmp ilen,x
        bne !+
        lda #0
        sta vtime,x
!:      cpx #2                     // voice 3 while an effect owns it: leave it
        bne v_write
        lda sfx_num
        beq v_write
        rts
v_write:
        ldy voff,x
        lda vnote,x
        beq !+
        stx v_x+1
        tax
        lda freq_lo,x
        sta ghost+0,y
        lda freq_hi,x
        sta ghost+1,y
v_x:    ldx #0
!:      lda #0
        sta ghost+2,y
        lda ipw,x
        sta ghost+3,y
        lda iwave,x
v_g:    ora #0
        sta ghost+4,y
        lda iad,x
        sta ghost+5,y
        lda isr,x
        sta ghost+6,y
        rts

// Effect data: AD, SR, pulse high, then rows of (control, frequency high),
// one row a frame, ended by a control byte of 0. Voice 3 is ghost+14.
fx_header:
        jsr fx_byte
        sta ghost+14+5
        jsr fx_byte
        sta ghost+14+6
        jsr fx_byte
        sta ghost+14+3
        lda #0
        sta ghost+14+2
        sta ghost+14+0
        rts

fx_row: jsr fx_byte
        beq fx_end
        sta ghost+14+4
        jsr fx_byte
        sta ghost+14+1
        rts
fx_end: sta sfx_num                // A = 0: the music takes voice 3 back this frame
        rts

fx_byte:
        ldx sfx_pos
        lda fx_data,x
        inc sfx_pos
        cmp #0
        rts

// ---- data ---------------------------------------------------------------
// Notes: octave * 12 + semitone, C = 0 (A4 = 57). 0 is a rest, $FF loops.
pat_bass:
        .byte 33, 33, 45, 33,  31, 31, 43, 31,  29, 29, 41, 29,  28, 28, 40, 28
        .byte $ff
pat_lead:
        .byte 57, 60, 64, 69, 64, 60, 57, 0
        .byte 55, 59, 62, 67, 62, 59, 55, 0
        .byte 53, 57, 60, 65, 60, 57, 53, 0
        .byte 52, 56, 59, 64, 59, 56, 52, 0
        .byte 57, 64, 69, 72, 69, 64, 60, 64
        .byte 55, 62, 67, 71, 67, 62, 59, 62
        .byte 53, 60, 65, 69, 65, 60, 57, 60
        .byte 52, 59, 64, 68, 64, 59, 56, 0
        .byte $ff
pat_drum:
        .byte 84, 0, 72, 0, 84, 84, 72, 0
        .byte $ff

// Effects: 1 shot, 2 explosion, 3 the player's ship lost.
fx_lo:  .byte fx_shot - fx_data, fx_boom - fx_data, fx_dead - fx_data
fx_data:
fx_shot:
        .byte $00, $a0, $08
        .byte $41, $30, $41, $28, $41, $20, $40, $18, $40, $10
        .byte 0
fx_boom:
        .byte $00, $f9, $08
        .byte $81, $28, $81, $20, $81, $18, $81, $14, $81, $10, $81, $0c
        .byte $80, $0a, $80, $08, $80, $06, $80, $05
        .byte 0
fx_dead:
        .byte $00, $fa, $08
        .byte $21, $40, $21, $38, $21, $30, $21, $28, $81, $30, $81, $28
        .byte $81, $20, $81, $1c, $81, $18, $81, $14, $81, $10, $81, $0e
        .byte $80, $0c, $80, $0a, $80, $08, $80, $06, $80, $05, $80, $04
        .byte 0
.assert "effect data fits one index byte", * - fx_data < 256, true

// Frequency tables, notes 0-95: f = 440 * 2^((n - 57) / 12) Hz and
// register = f * 2^24 / clock (arithmetic, rounded; the top notes clamp at
// $FFFF on PAL).
freq_lo: .fill 96, <min(65535, round(440 * pow(2, (i - 57) / 12) * 16777216 / PAL_CLOCK))
freq_hi: .fill 96, >min(65535, round(440 * pow(2, (i - 57) / 12) * 16777216 / PAL_CLOCK))
ntsc_lo: .fill 96, <min(65535, round(440 * pow(2, (i - 57) / 12) * 16777216 / NTSC_CLOCK))
ntsc_hi: .fill 96, >min(65535, round(440 * pow(2, (i - 57) / 12) * 16777216 / NTSC_CLOCK))
