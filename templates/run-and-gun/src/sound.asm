// sound.asm: FIREBASE's audio, imported by kernel.asm. One driver plays the
// three-voice tune (src/gen/tune.asm, written by tools/mktune.py) and five
// sound effects. sfx_voice_takeover (c64-kb techniques/music-sid.md, recipe
// kickassembler/sfx-voice-takeover, whose driver this is): an effect takes
// voices 1 and 2 together; the music keeps voice 3 and keeps stepping voices
// 1 and 2 through their patterns without writing the SID, so the tune stays
// in time. No priority: the last request wins. An effect ends by closing both
// gates; a stolen voice gets no music until its next note.
//
//   audio_init     once, from kernel_init, interrupts off. C sets aud_ntsc first.
//   audio_play     once a frame, from the frame IRQ (line 250), after the sprites.
//                  While aud_hold is 1 it only counts the frame (aud_owed); the
//                  next call without the hold plays the owed step, then its own.
//                  C sets aud_hold to 1 before the redraw and to 0 after it
//                  (main.c do_redraw, sound.c), so the frame IRQ that lands in
//                  the copy does not spend the redraw's lead over the beam, and
//                  the light frame after it does not spend its time either
//                  (PLAN.md, "Audio"). kernel.asm tests aud_hold itself first.
//   sfx_request    A = effect 1-5 (src/sound.h); 0 or out of range: ignored.
//                  C calls it with interrupts held off (main.c sfx()).
//
// Changes from the recipe: the effect number is 1-based (0 = none); a rest
// (note 0); a pattern table per voice (the read is patched per voice); the
// NTSC frequency table and one tick count skipped in six on NTSC; the start
// pitches from the table; the hold; counters and a CIA1 timer A stopwatch
// for the verdict (aud_prof, AUTOPILOT builds).
//
// Nothing here may use zero page (Oscar64 owns it). CIA1 timer A is the
// stopwatch: nothing else in FIREBASE uses it (KERNAL out, CIA1 IRQs off).

#import "gen/tune.asm"

// ---- shared with C ------------------------------------------------------------
aud_ntsc:   .byte 0             // C: 1 on NTSC, before kernel_init
aud_hold:   .byte 0             // C: 1 from before the redraw to after it
aud_owed:   .byte 0             // frames the frame IRQ skipped under the hold
aud_prof:   .byte 0             // C: 1 = time every frame's step into aud_log
aud_steps:  .word 0             // driver steps since audio_init
aud_mark:   .byte 0             // stored once a step (the SID trace's frame marker)
aud_cal:    .byte 0             // the stopwatch's own start/stop, cycles
aud_logi:   .byte 0             // entries in aud_loglo/hi (stops at 255)
fx_starts:  .byte 0             // effects started (wraps)
fx_ends:    .byte 0             // effects that ran to their end (a cut one does not)
fx_on:      .byte 0             // $FF while an effect runs
fx_cur:     .byte 0             // the running effect, 0-based

audio_init:
        ldx #$18
        lda #0
!:      sta $d400,x
        dex
        bpl !-
        lda #$0f
        sta $d418               // volume 15, no filter
        lda aud_ntsc
        beq au_i2
        ldx #AU_NNOTES - 1      // NTSC: the same pitches from a faster clock
!:      lda au_ntsclo,x
        sta au_freqlo,x
        lda au_ntschi,x
        sta au_freqhi,x
        dex
        bpl !-
au_i2:  ldx #2
!:      lda #0
        sta au_dur,x            // the first tick fetches a note on every voice
        sta au_ppos,x
        lda au_ipwlo,x
        sta au_pwlo,x
        lda au_ipwhi,x
        sta au_pwhi,x
        dex
        bpl !-
        lda #0
        sta au_tempo
        sta au_six
        sta fx_on
        sta aud_hold
        sta aud_owed
        sta aud_logi
        lda #$ff
        sta fx_req
        sta $dc04               // calibrate the stopwatch: one empty start/stop
        sta $dc05
        lda #%00011001          // force load, one-shot, start
        sta $dc0e
        lda #0
        sta $dc0e
        lda #$ff
        sec
        sbc $dc04
        sta aud_cal
        rts

// Frame IRQ entry. Under the hold, count the frame and leave; after it, the
// owed step first, then this frame's: two steps in the frame IRQ that follows
// the redraw's light frame, so neither the redraw nor the light frame pays.
audio_play:
        lda aud_hold
        beq !+
        inc aud_owed
        rts
!:      lda aud_owed
        beq au_step
        dec aud_owed
        jsr au_step
        jmp audio_play

sfx_request:
        tax
        beq !+
        cpx #AU_NFX + 1
        bcs !+
        dex
        stx fx_req
!:      rts

// One step: the counters, then the driver, timed when aud_prof is 1.
au_step:
        inc aud_steps
        bne !+
        inc aud_steps + 1
!:      lda aud_steps
        sta aud_mark
        lda aud_prof
        bne !+
        jmp au_play
!:      lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001
        sta $dc0e
        jsr au_play
        lda #0
        sta $dc0e
        ldx aud_logi
        cpx #255
        beq !+
        lda #$ff
        sec
        sbc $dc04
        sta aud_loglo,x
        lda #$ff
        sbc $dc05
        sta aud_loghi,x
        inc aud_logi
!:      rts

// ---- the driver: the recipe's play, voice and effect engine -------------------
au_play:
        lda #$ff                // the first voice processed always writes
        sta au_wflag
        lda #0
        sta au_tick
        lda aud_ntsc            // NTSC: every sixth frame does not count, so
        beq au_p1               // the ticks come at PAL's 50 a second
        dec au_six
        bpl au_p1
        lda #5
        sta au_six
        bne au_p0
au_p1:  dec au_tempo
        bpl au_p0
        lda #AU_SPEED
        sta au_tempo
        inc au_tick
au_p0:  ldx #2                  // voice 3 first
!:      jsr au_voice
#if AUDIO_FAULT
        lda #$ff                // make audiotest: every voice writes, effect or not
#else
        lda fx_on               // voices after this one write the SID only
        eor #$ff                // while no effect runs
#endif
        sta au_wflag
        dex
        bpl !-
        jmp fx_engine

// One voice, X = 0-2. The sequencer always advances; au_wflag gates the writes.
au_voice:
        lda au_tick
        beq au_vframe
        dec au_dur,x
        bmi au_vnew
        bne au_vframe
        lda au_wflag            // last tick of the note: gate off
        beq au_vframe
        ldy au_sidoff,x
        lda au_ictrl,x
        and #$fe
        sta $d404,y
au_vframe:
        lda au_ipws,x           // per-frame pulse sweep, $4xx-$7xx
        beq au_vdone
        clc
        adc au_pwlo,x
        sta au_pwlo,x
        lda au_pwhi,x
        adc #0
        and #$03
        ora #$04
        sta au_pwhi,x
        lda au_wflag
        beq au_vdone
        ldy au_sidoff,x
        lda au_pwlo,x
        sta $d402,y
        lda au_pwhi,x
        sta $d403,y
au_vdone:
        rts

// A new event: the next note or rest, and its note-on unless the voice is stolen.
au_vnew:
        lda au_pblo,x           // this voice's pattern table
        sta au_r1 + 1
        sta au_r2 + 1
        sta au_r3 + 1
        lda au_pbhi,x
        sta au_r1 + 2
        sta au_r2 + 2
        sta au_r3 + 2
        ldy au_ppos,x           // next event: note, length in ticks
au_r1:  lda $ffff,y
        cmp #$ff
        bne !+
        ldy #0                  // end of pattern: loop
au_r2:  lda $ffff,y
!:      sta au_note,x
        iny
au_r3:  lda $ffff,y
        sec
        sbc #1
        sta au_dur,x
        iny
        tya
        sta au_ppos,x
        lda au_wflag
        beq au_vframe
        ldy au_note,x           // a rest writes nothing
        beq au_vframe
        lda au_freqlo,y         // note on: frequency, pulse, envelope, gate
        sta au_flo
        lda au_freqhi,y
        ldy au_sidoff,x
        sta $d401,y
        lda au_flo
        sta $d400,y
        lda au_pwlo,x
        sta $d402,y
        lda au_pwhi,x
        sta $d403,y
        lda au_iad,x
        sta $d405,y
        lda au_isr,x
        sta $d406,y
        lda au_ictrl,x
        sta $d404,y
        jmp au_vframe

// Effect engine, after the voices: start a pending effect or step the running one.
fx_engine:
        ldy fx_req
        bmi fx_step
        lda #$ff
        sta fx_req
        sty fx_cur
        inc fx_starts
        lda #0                  // close both gates, then the start image
        sta $d404
        sta $d40b
        ldx fx_base,y
        ldy #0
!:      lda fx_data,x
        sta $d400,y
        inx
        iny
        cpy #14
        bne !-
        lda fx_data,x
        sta fx_idx
        lda fx_data + 1,x
        sta fx_end
        lda fx_data + 2,x
        sta fx_speed
        sta fx_cnt
        lda fx_data + 3,x
        sta fx_dir
        lda fx_data + 4,x
        sta fx_int
        lda fx_data + 5,x
        sta fx_flags
        lda fx_data - 10,x      // the image's two control bytes
        sta fx_c1
        lda fx_data - 3,x
        sta fx_c2
        ldy fx_idx              // start pitches from the table (NTSC too)
        lda au_freqlo,y
        sta $d400
        lda au_freqhi,y
        sta $d401
        tya
        sec
        sbc fx_int
        tay
        lda au_freqlo,y
        sta $d407
        lda au_freqhi,y
        sta $d408
        lda #$ff
        sta fx_on
        rts
fx_step:
        lda fx_on
        beq fx_done
        dec fx_cnt
        bpl fx_done
        lda fx_speed
        sta fx_cnt
        lda fx_idx
        clc
        adc fx_dir
        sta fx_idx
        lda fx_flags            // bit 0: voice 1 keeps its start pitch
        lsr
        bcs !+
        ldy fx_idx
        lda au_freqlo,y
        sta $d400
        lda au_freqhi,y
        sta $d401
!:      lda fx_idx              // voice 2 = index - interval
        sec
        sbc fx_int
        tay
        lda au_freqlo,y
        sta $d407
        lda au_freqhi,y
        sta $d408
        bit fx_flags            // bit 7: stutter voice 1, bit 6: voice 2
        bpl !+
        lda fx_c1
        eor #1
        sta fx_c1
        sta $d404
!:      bvc !+
        lda fx_c2
        eor #1
        sta fx_c2
        sta $d40b
!:      lda fx_idx
        cmp fx_end
        bne fx_done
        lda fx_c1               // the end: close both gates, hand nothing back
        and #$fe
        sta $d404
        lda fx_c2
        and #$fe
        sta $d40b
        lda #0
        sta fx_on
        inc fx_ends
fx_done:
        rts

// ---- state ---------------------------------------------------------------------
au_sidoff:  .byte $00, $07, $0e
au_tempo:   .byte 0
au_six:     .byte 0
au_tick:    .byte 0
au_wflag:   .byte 0
au_flo:     .byte 0
au_dur:     .fill 3, 0
au_ppos:    .fill 3, 0
au_note:    .fill 3, 0
au_pwlo:    .fill 3, 0
au_pwhi:    .fill 3, 0
fx_req:     .byte $ff
fx_idx:     .byte 0
fx_end:     .byte 0
fx_speed:   .byte 0
fx_cnt:     .byte 0
fx_dir:     .byte 0
fx_int:     .byte 0
fx_flags:   .byte 0
fx_c1:      .byte 0
fx_c2:      .byte 0
aud_loglo:  .fill 255, 0        // cycles of each timed step (aud_prof)
aud_loghi:  .fill 255, 0
