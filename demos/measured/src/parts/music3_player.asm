// music.asm: TOURNEY's music player, imported first by engine.asm so that
// music_init is the blob's first byte at $1000.
//
// Provenance: our own code. Copied on 2026-09-23 from the MEASURED demo's
// the MEASURED music2 port (the earlier module of this demo), which is
// itself a port of the player written for the INTERCEPTOR game by the
// c64-kb agent (its player.asm and mkmusic.py; public issue
// bdgscotland/c64-kb #50, programme #55): original work under the same
// BSD-3 licence as the kb's recipes. Nothing here is taken from any
// published SID player. The techniques it uses are the kb's:
// sid_play_routine_pattern (docs/techniques/music-sid.md, the init and
// play convention), sid_voice_setup (the seven registers a voice, the
// frequency formula F = f * 2^24 / clock), sid_filter_routing (cutoff,
// resonance, routing, mode), sfx_in_player (the effect slot on voice 3 with
// priority and hand-back), the hard restart of docs/hardware/sid-reference.md
// "Hard restart" in its "aggressive" form (gate off with AD = SR = 0 two
// frames before the note), and the pal_ntsc_tempo_mismatch pitfall (one
// call in six skipped on NTSC, and an NTSC frequency table, so the tune
// keeps its PAL tempo and pitch on both models).
//
// What TOURNEY changed against music2.asm (the TOURNEY audio build's log):
//   music_init takes A = tune number: 0 the title tune, 1 the silent list
//   (one all-rest pattern per voice, looping, so the effect path stays warm
//   and music_pos stays 0); any other number plays the silent list. The
//   order lists are chosen per tune; patterns, instruments and effects are
//   shared. mu_busy makes music_play return at once while an init runs,
//   because TOURNEY's state entries call music_init with the frame IRQ
//   live. music_calls counts every music_play call (two bytes, never reset)
//   so an AUTOPILOT build can prove the IRQ is calling it. A filter program
//   with no routing byte writes $D417 = 0 once, so an instrument can switch
//   the filter off (the original left the last routing in place for ever).
//   The NTSC skip counter reloads with 5, not 4: the original's reload of 4
//   ran four calls and skipped the fifth (measured with a trace on mp_run,
//   277 of 345 calls; the TOURNEY audio build's log), against its own comment,
//   so its NTSC tune ran 4 per cent slow; with 5 it is five of six, the
//   PAL rate. The demo's two effects are replaced by TOURNEY's four. The SOLO debug
//   switch and the demo's end-address checks are gone; engine.asm checks
//   the blob's end against $2000.
//
// The contract:
//   music_init   A = tune number (above). Reads the KERNAL's region flag at
//                $02A6 (1 PAL, 0 NTSC; written by the reset path at $FF5B,
//                docs/techniques/raster.md 884) and builds the frequency
//                table for that clock. A 901227-01 KERNAL leaves the byte 0
//                and is treated as NTSC. Clears every SID register, sets
//                volume 15. Uses A, X, Y. Interrupts may be on (mu_busy).
//   music_play   once per frame from engine.asm's line-251 IRQ, never from
//                C. Uses A, X, Y. No zero page at all (the pattern and order
//                reads are self-modified absolute,Y).
//   music_pos    voice 1's pattern index: 0 on the first read, N when voice
//                1 reads pattern N, the tune's loop index when the order
//                list wraps. It advances two calls BEFORE the first note of
//                the new pattern sounds (voice 1 reads its next event on
//                tick 2), 40 ms at PAL. Under the silent list it stays 0.
//   sfx_request  A = effect number 1 to 4 (1 swing, 2 block, 3 hit, 4
//                knockdown and the round sting). The higher number wins
//                within a frame and over a running effect; equal restarts.
//                Every effect takes voice 3 and hands it back to the tune
//                when its rows end. Keeps X and Y.
//   music_calls  two bytes, low first: music_play calls since load.
//   sfx_taken    one byte: effects started since load.
//
// What the player does, in one paragraph: an order list per voice of
// pattern numbers, transposes and a loop; patterns of notes, rests, ties,
// instrument and duration commands; instruments with AD, SR, a wavetable
// (waveform and relative or absolute note per frame: arpeggios, drums,
// attack transients), pulse width and a bouncing pulse sweep, vibrato
// (depth, half period, delay), a filter program (cutoff sweep that stops or
// bounces, resonance, routing, mode) and a legato flag; a hard restart two
// frames before every note that is not legato; two alternating speeds
// (swing when unequal); the three voices read their next event on three
// different frames so pattern and order list reads never pile up (speeds
// must be 5 or more; mkmusic.py checks); writes go straight to the SID
// (no 25-byte shadow) and a voice whose wavetable holds and has no vibrato
// writes nothing that frame.
//
// The tune data (tn_* tables) is src/music_data.asm, generated by
// tools/mkmusic.py from tools/tune_title.py and imported at the end of this
// file; the per-tune order tables follow it.

.const PAL_CLOCK  = 985248
.const NTSC_CLOCK = 1022727
.const TUNES = 2                // 0 the title tune, 1 the silent list

// ---- entry points ----------------------------------------------------------
// The program counter is engine.asm's (* = $1000); this file is imported
// first, so music_init is at $1000.
music_init:
        sta mu_tune
        inc mu_busy             // music_play returns at once until the init is done
        lda $02a6               // KERNAL: 1 PAL, 0 NTSC
        eor #1                  // the player wants 0 PAL, 1 NTSC
        jsr mu_init
        dec mu_busy
        rts

// ---- per-voice state -------------------------------------------------------
// X = 0, 7 or 14 indexes both the SID ($D400,X) and this state: each field
// is three bytes seven apart, and five 21-byte blocks hold 35 fields.
mu_s0: .fill 105, 0
.label mu_s1 = mu_s0 + 21
.label mu_s2 = mu_s0 + 42
.label mu_s3 = mu_s0 + 63
.label mu_s4 = mu_s0 + 84
.label mu_olo  = mu_s0+0    // order list address
.label mu_ohi  = mu_s0+1
.label mu_opos = mu_s0+2    // next order list byte
.label mu_plo  = mu_s0+3    // pattern address
.label mu_phi  = mu_s0+4
.label mu_ppos = mu_s0+5    // next pattern byte
.label mu_trn  = mu_s0+6    // transpose, semitones
.label mu_dur  = mu_s1+0    // steps left in this note
.label mu_dset = mu_s1+1    // duration setting, steps
.label mu_ni   = mu_s1+2    // instrument setting (the next note's)
.label mu_note = mu_s1+3    // note sounding (transposed)
.label mu_nn   = mu_s1+4    // next event: note, $60 rest, $61 tie
.label mu_wave = mu_s1+5    // waveform from the wavetable, gate clear
.label mu_gate = mu_s1+6    // 1 gate on, 0 off
.label mu_wpos = mu_s2+0    // wavetable row
.label mu_arp  = mu_s2+1    // note this frame, after the wavetable
.label mu_pwl  = mu_s2+2    // pulse width, 12 bits
.label mu_pwh  = mu_s2+3
.label mu_pws  = mu_s2+4    // pulse sweep per frame, signed
.label mu_ad   = mu_s2+5    // AD and SR the voice should have
.label mu_sr   = mu_s2+6
.label mu_dirty= mu_s3+0    // nonzero: write AD and SR this frame
.label mu_vsp  = mu_s3+1    // vibrato half period, frames (0 none)
.label mu_vdl  = mu_s3+2    // vibrato delay left, frames
.label mu_vc   = mu_s3+3    // frames to the next turn
.label mu_vdir = mu_s3+4    // 0 up, $FF down
.label mu_vdlo = mu_s3+5    // vibrato step, frequency units
.label mu_vdhi = mu_s3+6
.label mu_vol  = mu_s4+0    // vibrato offset, signed
.label mu_voh  = mu_s4+1
.label mu_upd  = mu_s4+2    // nonzero: write frequency, pulse and control
.label mu_ftk  = mu_s4+3    // the tick this voice reads its next event on
.label mu_ci   = mu_s4+4    // instrument of the sounding note

// ---- global state ----------------------------------------------------------
music_pos: .byte 0          // voice 1's order index (see the header)
mu_pidx:  .byte 0           // the index voice 1's next pattern will have
mu_ntsc:  .byte 0           // 1 on NTSC
mu_ncnt:  .byte 5           // NTSC skip counter: 5 runs, then one skipped call
mu_tick:  .byte 0           // frames left in this step
mu_step:  .byte 0           // 1 on the frame a step starts
mu_sidx:  .byte 0           // which of the two speeds this step uses
mu_skip:  .byte 0           // bit 7: the voice being processed is an effect's
mu_fmask: .byte $ff         // $FB while an effect owns voice 3
mu_fprog: .byte 0           // filter program running (0 none)
mu_fcut:  .byte 0           // $D416
mu_fspd:  .byte 0           // cutoff change per frame, signed
mu_fmin:  .byte 0
mu_fmax:  .byte 0
mu_fbnc:  .byte 0           // 1: bounce between min and max, 0: stop
mu_fres:  .byte 0           // $D417: resonance and routing (0: filter off)
mu_fmode: .byte 0           // $D418 high nibble
mu_tmp:   .byte 0
mu_par:   .byte 0           // frame parity, for the pulse sweeps
mu_endpat:.byte $ff         // an empty pattern: the first read goes to the order list
mu_ftktab: .byte 2, 3, 4    // the tick each voice reads its next event on

sfx_pending: .byte 0        // effect requested since the last play
sfx_num:     .byte 0        // effect on voice 3, 0 = none
sfx_pos:     .byte 0        // next byte of its data
sfx_taken:   .byte 0        // effects started
mu_tune:     .byte 0        // the tune number music_init was given (clamped)
mu_busy:     .byte 0        // nonzero while music_init runs: music_play returns at once
mu_loop1:    .byte 0        // the pattern index voice 1's order list loops to, this tune
music_calls: .byte 0, 0     // music_play calls since load, low byte first

mu_flo: .fill 96, 0         // frequency table, built by mu_init
mu_fhi: .fill 96, 0

// ---- init: A = 0 PAL, 1 NTSC ------------------------------------------------
mu_init:
        and #1
        sta mu_ntsc
        // Frequency table: octave 6 from the data, octave 7 doubled (clamped
        // at $FFFF), octaves 5 to 0 halved with rounding.
        ldx #11
mi_oct: lda mu_ntsc
        bne mi_n
        lda o6_pal_lo,x
        sta mu_vol              // scratch until the state is cleared below
        lda o6_pal_hi,x
        jmp mi_have
mi_n:   lda o6_ntsc_lo,x
        sta mu_vol
        lda o6_ntsc_hi,x
mi_have:
        sta mu_voh
        lda mu_vol
        asl
        sta mu_flo+84,x
        lda mu_voh
        rol
        bcc !+
        lda #$ff
        sta mu_flo+84,x
!:      sta mu_fhi+84,x
        txa
        clc
        adc #72
        tay
mi_down:
        lda mu_vol
        sta mu_flo,y
        lda mu_voh
        sta mu_fhi,y
        lsr mu_voh
        ror mu_vol
        bcc !+
        inc mu_vol              // round half up
        bne !+
        inc mu_voh
!:      tya
        sec
        sbc #12
        tay
        bcs mi_down
        dex
        bpl mi_oct

        lda #0
        ldx #104
!:      sta mu_s0,x
        dex
        bpl !-
        ldx #$18
!:      sta $d400,x
        dex
        bpl !-
        sta sfx_pending
        sta sfx_num
        sta mu_fprog
        sta mu_fcut
        sta mu_fspd
        sta mu_fres
        sta mu_fmode
        sta mu_sidx
        sta mu_skip
        sta mu_par
        sta music_pos
        sta mu_pidx
        lda #$ff
        sta mu_fmask
        lda #$0f
        sta $d418
        lda #5                  // first reads in 1 to 3 frames, first notes in 5
        sta mu_tick
        lda #5
        sta mu_ncnt
        // The tune: its loop index and its three order lists. tune_ord_lo
        // and tune_ord_hi hold 3 bytes a tune (voices 1 to 3); the two
        // loads in the loop below are patched to the tune's base.
        ldy mu_tune
        cpy #TUNES
        bcc !+
        ldy #1                  // an unknown tune number plays the silent list
        sty mu_tune
!:      lda tune_loop,y
        sta mu_loop1
        tya
        asl
        clc
        adc mu_tune             // 3 x tune
        sta mu_tmp
        clc
        adc #<tune_ord_lo
        sta mi_olo+1
        lda #>tune_ord_lo
        adc #0
        sta mi_olo+2
        lda mu_tmp
        clc
        adc #<tune_ord_hi
        sta mi_ohi+1
        lda #>tune_ord_hi
        adc #0
        sta mi_ohi+2
        ldx #14
        ldy #2
mi_v:
mi_olo: lda tune_ord_lo,y
        sta mu_olo,x
mi_ohi: lda tune_ord_hi,y
        sta mu_ohi,x
        lda #<mu_endpat
        sta mu_plo,x
        lda #>mu_endpat
        sta mu_phi,x
        lda #1
        sta mu_dur,x
        sta mu_dset,x
        lda mu_ftktab,y
        sta mu_ftk,x
        txa
        sec
        sbc #7
        tax
        dey
        bpl mi_v
        rts

// ---- effects request -------------------------------------------------------
// A = effect number. The higher priority wins; equal restarts. Keeps X, Y.
sfx_request:
        sta sr_new+1
        stx sr_x+1
        tax
        lda fx_pri,x
        ldx sfx_pending
        cmp fx_pri,x
        bcc sr_x
sr_new: lda #0
        sta sfx_pending
sr_x:   ldx #0
        rts

// ---- play ------------------------------------------------------------------
music_play:
        lda mu_busy
        beq !+
        rts                     // music_init is running on the main thread
!:      inc music_calls
        bne !+
        inc music_calls+1
!:      lda mu_ntsc
        beq mp_run
        dec mu_ncnt
        bpl mp_run              // 5, 4, 3, 2, 1 after the decrement: run; -1: skip
        lda #5                  // every sixth NTSC frame: nothing moves
        sta mu_ncnt
        rts
mp_run: jsr fx_frame            // first: decides who owns voice 3
        lda mu_par
        eor #1
        sta mu_par
        lda #0
        sta mu_step
        sta mu_skip
        dec mu_tick
        bne mp_v
        inc mu_step
        lda mu_sidx
        eor #1
        sta mu_sidx
        tax
        lda tn_speed,x
        sta mu_tick
mp_v:
        ldx #0
        jsr mu_voice
        ldx #7
        jsr mu_voice
        lda #$ff
        ldx sfx_num
        beq !+
        lda #$80
        sta mu_skip
        lda #$fb
!:      sta mu_fmask
        ldx #14
        jsr mu_voice
        // filter program
        lda mu_fres
        beq mp_ret
        lda mu_fspd
        beq mf_w
        bmi mf_dn
        clc
        adc mu_fcut
        bcs mf_hi
        cmp mu_fmax
        bcs mf_hi
        sta mu_fcut
        jmp mf_w
mf_hi:  lda mu_fmax
        sta mu_fcut
        jmp mf_turn
mf_dn:  clc
        adc mu_fcut
        bcc mf_lo
        cmp mu_fmin
        bcc mf_lo
        sta mu_fcut
        jmp mf_w
mf_lo:  lda mu_fmin
        sta mu_fcut
mf_turn:
        lda #0
        ldx mu_fbnc
        beq !+
        sec
        sbc mu_fspd
!:      sta mu_fspd
mf_w:   lda mu_fcut
        sta $d416
        lda mu_fres
        and mu_fmask
        sta $d417
        lda mu_fmode
        ora #$0f
        sta $d418
mp_ret: rts

// ---- one voice, X = 0, 7 or 14 ----------------------------------------------
mu_voice:
        lda mu_step
        beq mv_nostep
        dec mu_dur,x
        bne mv_frame
        jsr mu_start            // a voice with an event this frame skips its
        jmp mv_wt               // vibrato and pulse sweep for the frame
mv_nostep:
        lda mu_dur,x            // last step of the note: read the next event
        cmp #1                  // on this voice's tick, restart on tick 2,
        bne mv_frame            // set up the new instrument on tick 1
        lda mu_tick
        cmp mu_ftk,x
        bne mv_n2
        jsr mu_fetch
        lda mu_tick
        cmp #2
        bne mv_wt
        jsr mu_hr
        jmp mv_wt
mv_n2:  cmp #2
        bne !+
        jsr mu_hr               // C set: restarted, the voice is silent
        bcs mv_out2
        jmp mv_frame
!:      cmp #1
        bne mv_frame
        jsr mu_pre              // C set: the new instrument is loaded
        bcc mv_frame
mv_out2:
        jmp mv_out
mv_wt:  jsr mv_wave
        jmp mv_out
mv_frame:
        jsr mv_wave
        jmp mv_vib0
        // wavetable: waveform and note for this frame. Waveform 0 is a
        // jump to the row in the note column, or a hold when that is $FF.
mv_wave:
        ldy mu_wpos,x
        lda tn_wtw,y
        bne mv_w
        lda tn_wtn,y
        cmp #$ff
        beq mv_wr
        tay
        lda tn_wtw,y
mv_w:   sta mu_wave,x
        lda tn_wtn,y
        bmi mv_abs
        clc
        adc mu_note,x
        jmp mv_n
mv_abs: and #$7f
mv_n:   sta mu_arp,x
        iny
        tya
        sta mu_wpos,x
        lda mu_upd,x
        ora #3                  // frequency and control
        sta mu_upd,x
mv_wr:  rts
mv_vib0:
        // vibrato: a triangle about the note, after its delay
        lda mu_vsp,x
        beq mv_pw
        lda mu_vdl,x
        beq mv_vib
        dec mu_vdl,x
        jmp mv_pw
mv_vib: lda mu_vdir,x
        bne mv_vdn
        lda mu_vol,x
        clc
        adc mu_vdlo,x
        sta mu_vol,x
        lda mu_voh,x
        adc mu_vdhi,x
        sta mu_voh,x
        jmp mv_vc
mv_vdn: lda mu_vol,x
        sec
        sbc mu_vdlo,x
        sta mu_vol,x
        lda mu_voh,x
        sbc mu_vdhi,x
        sta mu_voh,x
mv_vc:  lda mu_upd,x
        ora #1                  // frequency
        sta mu_upd,x
        dec mu_vc,x
        bne mv_pw
        lda mu_vsp,x
        sta mu_vc,x
        lda mu_vdir,x
        eor #$ff
        sta mu_vdir,x
mv_pw:  // pulse sweep, every other frame (voice 2 on the frames voices 1
        // and 3 skip): bounce inside $100-$EFF
        lda mu_pws,x
        beq mv_out
        txa
        and #7                  // X = 0, 7, 14: bit 0 is 0, 1, 0
        eor mu_par
        lsr
        bcs mv_out
        lda mu_pws,x            // INTERCEPTOR's player added the parity test's
        ldy #0                  // result here instead of the sweep (0 on voices
        cmp #$80                // 1 and 3, 3 on voice 2): found by regtrace.py
        bcc !+
        dey
!:      clc
        adc mu_pwl,x
        sta mu_pwl,x
        tya
        adc mu_pwh,x
        beq mv_pwt
        cmp #$0f
        bcs mv_pwt
        sta mu_pwh,x
        lda mu_upd,x
        ora #4                  // pulse
        sta mu_upd,x
        jmp mv_out
mv_pwt: lda #0
        sec
        sbc mu_pws,x
        sta mu_pws,x
mv_out: bit mu_skip
        bmi mv_ret
        lda mu_dirty,x
        beq !+
        lda mu_ad,x
        sta $d405,x
        lda mu_sr,x
        sta $d406,x
        lda #0
        sta mu_dirty,x
!:      lda mu_upd,x            // bit 0 frequency, 1 control, 2 pulse
        beq mv_ret
        lsr
        sta mu_tmp
        bcc mv_c
        ldy mu_arp,x
        lda mu_flo,y
        clc
        adc mu_vol,x
        sta $d400,x
        lda mu_fhi,y
        adc mu_voh,x
        sta $d401,x
mv_c:   lsr mu_tmp
        bcc !+
        lda mu_wave,x
        ora mu_gate,x
        sta $d404,x
!:      lda #0
        sta mu_upd,x
        lsr mu_tmp
        bcc mv_ret
mv_pwr: lda mu_pwl,x
        sta $d402,x
        lda mu_pwh,x
        sta $d403,x
mv_ret: rts

// Read the next event, 4, 3 or 2 frames before the step it starts on.
mu_fetch:
        lda mu_plo,x
        sta mf_rd+1
        lda mu_phi,x
        sta mf_rd+2
        ldy mu_ppos,x
mf_rd:  lda $ffff,y
        iny
        cmp #$62
        bcc mf_ev
        cmp #$ff
        beq mf_order
        cmp #$c0
        bcs mf_dur
        and #$3f                // $80-$BF: instrument
        sta mu_ni,x
        jmp mf_rd
mf_dur: sbc #$bf                // $C0-$FE: duration 1-63 steps (C set)
        sta mu_dset,x
        jmp mf_rd
mf_ev:  sta mu_tmp
        tya
        sta mu_ppos,x
        lda mu_tmp
        cmp #$60
        bcs mf_st               // rest or tie
        adc mu_trn,x            // C clear
mf_st:  sta mu_nn,x
        rts
// End of pattern: the next order list entry.
mf_order:
        lda mu_olo,x
        sta mo_rd+1
        sta mo_rd2+1
        lda mu_ohi,x
        sta mo_rd+2
        sta mo_rd2+2
        ldy mu_opos,x
mo_rd:  lda $ffff,y
        iny
        cmp #$ff
        beq mo_rd2
        cmp #$80
        bcc mo_pat
        sbc #$a0                // $80-$BF: transpose -32..+31 (C set)
        sta mu_trn,x
        jmp mo_rd
mo_rd2: lda $ffff,y             // $FF, position: loop
        tay
        cpx #0                  // voice 1 wrapped: its next pattern has the
        bne mo_rd               // loop's index (music_pos contract)
        lda mu_loop1
        sta mu_pidx
        jmp mo_rd
mo_pat: sta mu_tmp
        tya
        sta mu_opos,x
        cpx #0                  // voice 1 starts pattern number mu_pidx:
        bne !+                  // that is music_pos from this frame
        lda mu_pidx
        sta music_pos
        inc mu_pidx
!:      ldy mu_tmp
        lda tn_patlo,y
        sta mu_plo,x
        sta mf_rd+1
        lda tn_pathi,y
        sta mu_phi,x
        sta mf_rd+2
        ldy #0
        jmp mf_rd

// Hard restart, two frames before a note that is not legato: gate off,
// AD = SR = 0, written here (three stores, not the whole voice).
mu_hr:  lda mu_nn,x
        cmp #$60
        bcs mh_no
        jsr mu_leg
        bcs mh_no
        lda #0
        sta mu_gate,x
        sta mu_ad,x
        sta mu_sr,x
        bit mu_skip
        bmi mh_ret
        sta $d405,x
        sta $d406,x
        lda mu_wave,x
        sta $d404,x
mh_ret: sec
        rts
mh_no:  clc
        rts

// C set when the next note is legato onto the sounding one: the instrument
// has the legato flag, it is the instrument sounding, and the gate is on.
// Returns Y = the next instrument.
mu_leg: ldy mu_ni,x
        lda tn_flags,y
        lsr
        bcc ml_ret
        lda mu_gate,x
        beq ml_no
        tya
        cmp mu_ci,x
        beq ml_ret              // equal: C set
ml_no:  clc
ml_ret: rts

// The step a note starts on.
mu_start:
        lda mu_dset,x
        sta mu_dur,x
        lda mu_nn,x
        cmp #$60
        bcc ms_note
        bne ms_ret              // tie: the note goes on
        lda #0                  // rest: release
        sta mu_gate,x
        lda #2
        sta mu_upd,x
ms_ret: rts
ms_note:
        sta mu_note,x
        jsr mu_leg
        lda tn_wt,y             // legato: the wavetable restarts, no gate,
        sta mu_wpos,x           // no envelope
        bcs ms_ret
        tya
        sta mu_ci,x
ms_new: lda #1
        sta mu_gate,x
        lda #3                  // frequency and control; the pulse width went
        sta mu_upd,x            // out on the frame before (mu_pre)
        lda tn_ad,y
        sta mu_ad,x
        bit mu_skip
        bmi !+
        sta $d405,x
        lda tn_sr,y
        sta mu_sr,x
        sta $d406,x
        rts
!:      lda tn_sr,y
        sta mu_sr,x
        lda #1
        sta mu_dirty,x
        rts

// The frame before a new note (the voice is in its hard restart, silent):
// the new instrument's pulse, vibrato and filter, so the step frame, where
// all three voices may start a note, carries only the envelope and gate.
mp_r:   clc
        rts
mu_pre: lda mu_nn,x
        cmp #$60
        bcs mp_r
        jsr mu_leg              // a legato note onto a sounding one: nothing
        bcs mp_r
        lda tn_pwh,y            // bit 7: keep the pulse width
        bmi !+
        sta mu_pwh,x
        lda tn_pwl,y
        sta mu_pwl,x
!:      lda tn_pws,y
        sta mu_pws,x
        lda tn_vdel,y
        sta mu_vdl,x
        lda #0
        sta mu_vol,x
        sta mu_voh,x
        sta mu_vdir,x
        lda #4
        sta mu_upd,x
        lda tn_vib,y            // depth shift (high nibble), half period (low)
        and #$0f
        sta mu_vsp,x
        beq ms_flt
        lsr
        adc #0
        sta mu_vc,x             // start mid-slope: the pitch swings about the note
        lda tn_vib,y            // step = (f(n+1) - f(n)) >> depth
        lsr
        lsr
        lsr
        lsr
        sta mu_tmp
        tya
        pha
        ldy mu_nn,x
        lda mu_flo+1,y
        sec
        sbc mu_flo,y
        sta mu_vdlo,x
        lda mu_fhi+1,y
        sbc mu_fhi,y
        ldy mu_tmp
        beq mp_vh
!:      lsr
        ror mu_vdlo,x
        dey
        bne !-
mp_vh:  sta mu_vdhi,x
        pla
        tay
ms_flt: lda tn_flt,y            // filter program: bit 7 restarts it on every note
        beq mp_ret2
        bmi !+
        cmp mu_fprog
        beq mp_ret2
!:      and #$7f
        sta mu_fprog
        tay
        lda tn_fcut,y
        sta mu_fcut
        lda tn_fspd,y
        sta mu_fspd
        lda tn_fmin,y
        sta mu_fmin
        lda tn_fmax,y
        sta mu_fmax
        lda tn_fres,y
        sta mu_fres
        bne !+
        sta $d417               // a program with no routing: the filter is off from now
!:      lda tn_fmode,y
        and #1
        sta mu_fbnc
        lda tn_fmode,y
        and #$f0
        sta mu_fmode
mp_ret2:
        sec
        rts

// ---- effects ---------------------------------------------------------------
// Data: AD, SR, pulse width high nibble, then one row a frame of (control,
// frequency high byte), ended by a control byte of 0. The start frame
// writes the header with TEST set and GATE clear, so the effect's first row
// gates a fresh attack from an oscillator at zero. Two effects are kept
// (INTERCEPTOR had six) so the tune has the room; the table grows by data
// alone.
fx_frame:
        ldx sfx_pending
        beq fx_row
        lda fx_pri,x
        ldy sfx_num
        cmp fx_pri,y
        bcc fx_drop
        stx sfx_num
        ldy fx_ptr-1,x
        lda fx_data,y
        sta $d413
        lda fx_data+1,y
        sta $d414
        lda fx_data+2,y
        sta $d411
        lda #0
        sta $d410
        sta $d40e
        sta sfx_pending
        lda #$08
        sta $d412
        iny
        iny
        iny
        sty sfx_pos
        inc sfx_taken
        rts
fx_drop:
        lda #0
        sta sfx_pending
fx_row: lda sfx_num
        beq fx_ret
        ldy sfx_pos
        lda fx_data,y
        beq fx_end
        sta $d412
        lda fx_data+1,y
        sta $d40f
        iny
        iny
        sty sfx_pos
fx_ret: rts
fx_end: sta sfx_num             // A = 0: voice 3 is the music's again
        sta mu_gate+14          // this frame: its AD, SR, pulse, gate off
        lda #1
        sta mu_dirty+14
        lda #7
        sta mu_upd+14
        rts

// Priority by effect number; 0 is "none". TOURNEY's four (the TOURNEY audio specification,
// DESIGN.md "Audio"): each is AD, SR, pulse width high nibble, then rows of
// (control, frequency high byte), one a frame, ended by a control byte of
// 0. The last rows of each drop the gate so the release runs inside the
// effect with its own SR: the hand-back that follows restores the tune's
// AD and SR for voice 3, which under the silent list are 0 and would cut
// the tail.
fx_pri: .byte 0, 1, 2, 3, 4
fx_ptr: .byte fx_swing-fx_data, fx_block-fx_data, fx_hit-fx_data, fx_down-fx_data
fx_data:
fx_swing:                       // 1: a noise burst falling, 13 frames (the whoosh of a swing)
        .byte $01, $a6, $00
        .byte $81, $40, $81, $34, $81, $2a, $81, $22, $81, $1a
        .byte $80, $12, $80, $0c, $80, $08, $80, $06, $80, $04, $80, $03, $80, $02, $80, $02
        .byte 0
fx_block:                       // 2: a click of noise then a thin high pulse, 7 frames (blade on staff)
        .byte $00, $46, $01
        .byte $81, $6e, $41, $5c, $41, $60, $41, $5c
        .byte $40, $5c, $40, $5c, $40, $5c
        .byte 0
fx_hit:                         // 3: a low thud, noise then a pulse falling, 8 frames
        .byte $00, $b4, $08
        .byte $81, $22, $41, $14, $41, $10, $41, $0d, $41, $0b
        .byte $40, $0a, $40, $09, $40, $08
        .byte 0
fx_down:                        // 4: a sawtooth sting falling an octave and a half, 20 frames
        .byte $08, $8a, $00
        .byte $21, $30, $21, $32, $21, $30, $21, $2c, $21, $28, $21, $24, $21, $20, $21, $1c, $21, $18
        .byte $20, $16, $20, $14, $20, $12, $20, $10, $20, $0f, $20, $0e, $20, $0d, $20, $0c, $20, $0b, $20, $0a, $20, $0a
        .byte 0
.assert "effect data fits one index byte", * - fx_data < 256, true

// Octave 6 (notes 72-83) for each clock: register = f * 2^24 / clock,
// f = 440 * 2^((n - 57) / 12) (arithmetic, rounded; sid_voice_setup's
// formula). mu_init derives the other octaves.
o6_pal_lo:  .fill 12, <round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / PAL_CLOCK)
o6_pal_hi:  .fill 12, >round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / PAL_CLOCK)
o6_ntsc_lo: .fill 12, <round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / NTSC_CLOCK)
o6_ntsc_hi: .fill 12, >round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / NTSC_CLOCK)

music_player_end:

// ---- tune data: src/music_data.asm, generated by tools/mkmusic.py from ----
// tools/tune_title.py (make regenerates it; do not edit it by hand). It
// defines the tn_* tables, TN_LOOP1 (the index voice 1 loops to) and
// TN_SILENT (the index of its all-rest pattern).
#import "music3_data.asm"

// ---- per-tune order lists: 3 bytes a tune, voices 1 to 3 -------------------
tune_ord_lo: .byte <tn_ord1, <tn_ord2, <tn_ord3, <mu_silent_ord, <mu_silent_ord, <mu_silent_ord
tune_ord_hi: .byte >tn_ord1, >tn_ord2, >tn_ord3, >mu_silent_ord, >mu_silent_ord, >mu_silent_ord
tune_loop:   .byte TN_LOOP1, 0
// The silent list: the all-rest pattern, then a loop back to it. One list
// serves all three voices (each keeps its own position in it). Its loop
// index is 0, so music_pos reads 0 for as long as it plays.
mu_silent_ord: .byte TN_SILENT, $ff, $00

music_end:
