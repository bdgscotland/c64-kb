// music.asm: the racer's tune, imported by engine.asm. The player is
// c64-kb's recipes/kickassembler/music-player.md (its API, code and
// instruments, unchanged but for the effects' data); the tune "Redline" is
// this starter's own (from racing-port-110). sound.c plays it on the title,
// on the grid, in the race and between the stages, its effects (the
// lights, a bump, a checkpoint, a crash) on voice 3, and engine_note (at
// the end) keeps the car's engine on voice 3 whenever no effect has it.

// ===========================================================================
// The player. API:
//   music_init   A = 0 PAL, 1 NTSC. Builds the frequency table for that
//                clock, silences the SID, starts the tune from its top.
//   music_play   once a frame. Uses A, X, Y; no zero page.
//   sfx_request  A = effect number (1 shot, 2 thud, 3 boom, 4 crash, 5 oil,
//                6 missile). Keeps X and Y. Call with interrupts off.
//   sfx_taken    byte: effects started.
//
//   - an order list per voice: pattern numbers, transposes, a loop;
//   - patterns: notes, rest, tie, instrument and duration commands;
//   - instruments: AD, SR, a wavetable (waveform and note per frame:
//     arpeggios, and absolute notes for drums), pulse width and sweep,
//     vibrato depth, speed and delay, a filter program, legato;
//   - hard restart two frames before every note that is not legato:
//     gate off and AD = SR = 0, then the note's AD, SR and gate on its step;
//   - one filter program at a time: a cutoff sweep that stops or bounces;
//   - two speeds (frames a step) that alternate: swing when unequal.
// Effects take voice 3 by priority and give it back with the music's AD, SR
// and pulse width rewritten and the gate off, so the music's next note there
// starts a fresh attack.
//
// Cost control: writes go straight to the SID, no shadow copy; a voice
// whose wavetable holds and has no vibrato writes nothing; the three voices
// read their next event on three different frames (4, 3 and 2 frames
// before the step), so pattern and order list reads never pile up. Speeds
// must be 5 or more for that.
//
// On NTSC one call in six is skipped, so the tune keeps its PAL tempo, and
// the NTSC frequency table keeps it in tune.
//
// Build switches (java -jar KickAss.jar -define NO_VIB ...) remove a feature
// to measure what it costs; with none defined, this is the full player.
// NO_VIB vibrato, NO_PWS pulse sweep, NO_FLT filter program (the
// $D418 volume set by music_init stays), NO_WT the wavetable after a note's
// first frame (no arpeggios or drum sweeps), NO_HR hard restart, NO_LEG
// legato (every note gates), NO_FX sound effects (the harness requests none).
// ===========================================================================

.const PAL_CLOCK  = 985248
.const NTSC_CLOCK = 1022727

// ---- per-voice state -------------------------------------------------------
// X = 0, 7 or 14 indexes both the SID ($D400,X) and this state: each field
// is three bytes seven apart, and five 21-byte blocks hold 35 fields.
mu_s0:      .fill 105, 0        // (music_init clears it)
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
mu_ntsc:  .byte 0           // 1 on NTSC
mu_ncnt:  .byte 5           // NTSC skip counter
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
sfx_taken:   .byte 0        // effects started (for the verdict)

// the frequency table, built by music_init
mu_flo:     .fill 96, 0
mu_fhi:     .fill 96, 0

// ---- init ------------------------------------------------------------------
music_init:
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
// music_restart: the tune from its top and the SID quiet, the table kept
// (sound.c: the table's 3,000 or so cycles once, at start, not in a step)
music_restart:
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
        lda #$0f
        sta $d418
        lda #5                  // first reads in 1 to 3 frames, first notes in 5
        sta mu_tick
        lda #5                  // five calls run, the sixth is skipped
        sta mu_ncnt
        ldx #14
        ldy #2
mi_v:   lda tn_ordlo,y
        sta mu_olo,x
        lda tn_ordhi,y
        sta mu_ohi,x
        lda #<mu_endpat
        sta mu_plo,x
        lda #>mu_endpat
        sta mu_phi,x
        lda #1
        sta mu_dur,x
        sta mu_dset,x
        lda mu_ftktab,y
        sta mu_ftk,x            // the tick each voice reads its next event on
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
        lda mu_ntsc
        beq mp_run
        dec mu_ncnt
        bpl mp_run
        lda #5                  // every sixth NTSC call: nothing moves
        sta mu_ncnt
        rts
mp_run:
#if !NO_FX
        jsr fx_frame            // first: decides who owns voice 3
#endif
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
#if !NO_FX
        lda #$ff
        ldx sfx_num
        beq !+
        lda #$80
        sta mu_skip
        lda #$fb
!:      sta mu_fmask
#endif
        ldx #14
        jsr mu_voice
        // filter program
#if NO_FLT
        rts
#endif
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
#if NO_WT                        // vibrato and pulse sweep for the frame
        jsr mv_wave
        jmp mv_out
#endif
        jmp mv_wt
mv_nostep:
        lda mu_dur,x            // last step of the note: read the next event
        cmp #1                  // on this voice's tick, restart on tick 2,
        bne mv_frame            // set up the new instrument on tick 1
        lda mu_tick
        cmp mu_ftk,x
        bne mv_n2
        jsr mu_fetch
#if !NO_HR
        lda mu_tick
        cmp #2
        bne mv_wt
        jsr mu_hr
#endif
        jmp mv_wt
mv_n2:
#if !NO_HR
        cmp #2
        bne !+
        jsr mu_hr               // C set: restarted, the voice is silent
        bcs mv_out2
        jmp mv_frame
#endif
!:      cmp #1
        bne mv_frame
        jsr mu_pre              // C set: the new instrument is loaded
        bcc mv_frame
mv_out2:
        jmp mv_out
mv_wt:
#if !NO_WT
        jsr mv_wave
#endif
        jmp mv_out
mv_frame:
#if !NO_WT
        jsr mv_wave
#endif
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
#if NO_VIB
        jmp mv_pw
#endif
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
#if NO_PWS
        jmp mv_out
#endif
        lda mu_pws,x
        beq mv_out
        txa
        and #7                  // X = 0, 7, 14: bit 0 is 0, 1, 0
        eor mu_par
        lsr
        bcs mv_out
        lda mu_pws,x            // the sweep, signed
        ldy #0
        cmp #$80
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
        jmp mo_rd
mo_pat: sta mu_tmp
        tya
        sta mu_opos,x
        ldy mu_tmp
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
#if NO_LEG
        clc
        rts
#endif
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
!:
#if !NO_PWS
        lda tn_pws,y
        sta mu_pws,x
#endif
#if NO_VIB
        lda #4
        sta mu_upd,x
        jmp ms_flt
#endif
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
ms_flt:
#if NO_FLT
        jmp mp_ret2
#endif
        lda tn_flt,y            // filter program: bit 7 restarts it on every note
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
        lda tn_fmode,y
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
// gates a fresh attack from an oscillator at zero.
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

// Priority by effect number; 0 is "none". The racer's effects: 1 tick (the
// start lights, the last seconds), 2 bump (cars touching), 3 checkpoint, 4
// crash, 5 go, 6 skid (the kerb and the grass).
fx_pri: .byte 0, 2, 3, 4, 5, 4, 1
fx_ptr: .byte fx_tick-fx_data, fx_bump-fx_data, fx_chk-fx_data, fx_crash-fx_data
        .byte fx_go-fx_data, fx_skid-fx_data
fx_data:
fx_tick:                        // a short square beep
        .byte $00, $f0, $08
        .byte $41, $1c, $41, $1c, $41, $1c, $41, $1c, $41, $1c, $40, $1c
        .byte 0
fx_bump:                        // a body knock: low noise, fast decay
        .byte $00, $b8, $08
        .byte $81, $09, $81, $06, $41, $03, $80, $04, $80, $03, $80, $02
        .byte 0
fx_chk:                         // checkpoint: a rising three-note chime
        .byte $00, $f4, $08
        .byte $41, $22, $41, $22, $41, $22, $41, $2b, $41, $2b, $41, $2b
        .byte $41, $33, $41, $33, $41, $33, $41, $33, $40, $33, $40, $33
        .byte 0
fx_crash:                       // a squeal, then a long crunch
        .byte $0b, $fa, $08
        .byte $21, $48, $21, $44, $21, $40, $21, $3a, $21, $34, $41, $2e
        .byte $81, $40, $81, $30, $81, $24, $81, $1c, $81, $16, $81, $12
        .byte $81, $10, $81, $0e, $81, $0c, $81, $0b, $81, $0a, $81, $09
        .byte $81, $08, $81, $07, $81, $06, $81, $05, $80, $05, $80, $04
        .byte $80, $04, $80, $03, $80, $03, $80, $02, $80, $02, $80, $01
        .byte 0
fx_go:                          // the green light: a long high beep
        .byte $00, $f0, $08
        .byte $41, $38, $41, $38, $41, $38, $41, $38, $41, $38, $41, $38
        .byte $41, $38, $41, $38, $41, $38, $41, $38, $41, $38, $41, $38
        .byte $40, $38
        .byte 0
fx_skid:                        // a tyre hiss
        .byte $00, $a0, $08
        .byte $81, $60, $81, $5c, $81, $58, $81, $54, $80, $50, $80, $4c
        .byte 0
.assert "effect data fits one index byte", * - fx_data < 256, true

// Octave 6 (notes 72-83) for each clock: register = f * 2^24 / clock,
// f = 440 * 2^((n - 57) / 12) (arithmetic, rounded). music_init derives
// the other octaves.
o6_pal_lo:  .fill 12, <round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / PAL_CLOCK)
o6_pal_hi:  .fill 12, >round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / PAL_CLOCK)
o6_ntsc_lo: .fill 12, <round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / NTSC_CLOCK)
o6_ntsc_hi: .fill 12, >round(440 * pow(2, (i + 72 - 57) / 12) * 16777216 / NTSC_CLOCK)
// ===========================================================================
// The tune, "Redline" (original, for this starter): A minor, i - VI - III -
// VII (Am F C G), sixteenth steps of five frames (150 steps a minute on
// PAL, 120 beats; the player skips one NTSC call in six to keep it). Voice 1
// the bass, bouncing octaves with a snare on beats 2 and 4; voice 2 the
// lead; voice 3 rests: the car's engine note has it (engine_note), and the
// effects borrow it. Formats as the player's recipe (c64-kb
// recipes/kickassembler/music-player.md, "The tune"); the instruments and
// wavetable are that recipe's.
// ===========================================================================
tn_speed: .byte $05, $05
tn_ordlo: .byte <tn_ord1, <tn_ord2, <tn_ord3
tn_ordhi: .byte >tn_ord1, >tn_ord2, >tn_ord3
tn_patlo: .byte <tn_p0, <tn_p1, <tn_p2, <tn_p3, <tn_p4, <tn_p5
tn_pathi: .byte >tn_p0, >tn_p1, >tn_p2, >tn_p3, >tn_p4, >tn_p5
// instruments (the recipe's): 0 bass, 1 wbass, 2 lead, 3 run, 4-5 toms, 6 kick, 7 snare, 8 hat
tn_ad: .byte $0a, $08, $0a, $09, $06, $06, $07, $08, $03
tn_sr: .byte $80, $a6, $a9, $c8, $50, $50, $00, $00, $00
tn_wt: .byte $02, $05, $08, $0c, $0e, $12, $16, $1e, $26
tn_pwl: .byte $00, $00, $00, $00, $00, $00, $00, $00, $00
tn_pwh: .byte $80, $80, $08, $06, $04, $04, $08, $08, $80
tn_pws: .byte $00, $00, $08, $0a, $06, $06, $00, $00, $00
tn_vib: .byte $00, $00, $35, $00, $00, $00, $00, $00, $00
tn_vdel: .byte $00, $00, $0a, $00, $00, $00, $00, $00, $00
tn_flt: .byte $81, $02, $00, $00, $00, $00, $00, $00, $00
tn_flags: .byte $00, $00, $00, $01, $00, $00, $00, $00, $00
tn_wtw: .byte $10, $00, $08, $20, $00, $08, $20, $00, $08, $40, $40, $00, $40, $00, $40, $40, $40, $00, $40, $40, $40, $00, $80, $40, $40, $40, $40, $40, $40, $00, $80, $40, $40, $80, $80, $80, $80, $00, $80, $00
tn_wtn: .byte $00, $ff, $00, $00, $ff, $00, $00, $ff, $00, $0c, $00, $ff, $00, $ff, $00, $03, $07, $0e, $00, $04, $07, $12, $be, $a8, $a2, $9e, $9b, $99, $97, $ff, $ca, $b0, $ad, $c6, $c4, $c3, $c2, $ff, $de, $ff
tn_fcut: .byte $00, $58, $10
tn_fspd: .byte $00, $fb, $02
tn_fmin: .byte $00, $14, $10
tn_fmax: .byte $00, $58, $60
tn_fres: .byte $00, $a1, $c1
tn_fmode: .byte $00, $10, $11
// order lists: the bass bar under Am, F, C, G (transposes $A0 + semitones);
// the lead's two four-bar phrases then its run; voice 3 rests
tn_ord1: .byte $a0, $01, $9c, $01, $a3, $01, $9e, $01, $a0, $01, $9c, $01, $a3, $01, $9e, $01
         .byte $a0, $01, $9c, $01, $a3, $01, $9e, $01, $a0, $01, $9c, $01, $a3, $01, $9e, $01
         .byte $ff, $00
tn_ord2: .byte $a0, $02, $03, $02, $04, $05, $05, $ff, $00
tn_ord3: .byte $00, $ff, $00
// p0 rest: r:16
tn_p0: .byte $cf, $60, $ff
// p1 bass bar (A): A2:2 A3:2 snare:2 A3:2 A2:2 A3:2 snare:2 A3:2
tn_p1: .byte $80, $c1, $21, $2d, $87, $30, $80, $2d, $21, $2d, $87, $30, $80, $2d, $ff
// p2 lead A, Am F C G: E5:2 A5:2 E5:2 C5:2 D5:2 E5:4 r:2 | F5:2 E5:2 C5:2 A4:2 C5:4 A4:4 |
//   G5:2 E5:2 C5:2 E5:2 G5:4 E5:4 | D5:2 B4:2 G4:2 B4:2 D5:6 r:2
tn_p2: .byte $82, $c1, $40, $45, $40, $3c, $3e, $c3, $40, $c1, $60
       .byte $41, $40, $3c, $39, $c3, $3c, $39
       .byte $c1, $43, $40, $3c, $40, $c3, $43, $40
       .byte $c1, $3e, $3b, $37, $3b, $c5, $3e, $c1, $60, $ff
// p3 lead B: A5:4 G5:2 E5:2 A5:4 C6:4 | A5:4 G5:2 F5:2 C5:4 F5:4 |
//   E5:2 G5:2 C6:2 G5:2 E5:2 C5:2 E5:2 G5:2 | B5:4 A5:2 G5:2 D5:8
tn_p3: .byte $82, $c3, $45, $c1, $43, $40, $c3, $45, $48
       .byte $45, $c1, $43, $41, $c3, $3c, $41
       .byte $c1, $40, $43, $48, $43, $40, $3c, $40, $43
       .byte $c3, $47, $c1, $45, $43, $c7, $3e, $ff
// p4 run, Am F C G, sixteenths up the chord: A4 C5 E5 A5 E5 C5 A4 C5 ... (run instrument)
tn_p4: .byte $83, $c0, $39, $3c, $40, $45, $40, $3c, $39, $3c, $40, $45, $48, $45, $40, $3c, $40, $45
       .byte $35, $39, $3c, $41, $3c, $39, $35, $39, $3c, $41, $45, $41, $3c, $39, $3c, $41
       .byte $3c, $40, $43, $48, $43, $40, $3c, $40, $43, $48, $4c, $48, $43, $40, $43, $48
       .byte $37, $3b, $3e, $43, $3e, $3b, $37, $3b, $3e, $43, $47, $43, $c3, $3e, $ff
// p5 lead held: A5:8 E5:8 | F5:8 C5:8 | G5:8 E5:8 | B5:8 D6:8
tn_p5: .byte $82, $c7, $45, $40, $41, $3c, $43, $40, $47, $4a, $ff


// ---- the engine note ---------------------------------------------------------------------
// Voice 3, when no effect has it: a pulse at en_freq (sound.c: from the
// speed), gated while en_on. Taking the voice back after an
// effect sets its envelope.
engine_note:
        lda sfx_num
        ora sfx_pending
        beq en_mine
        lda #0
        sta en_owned            // an effect has the voice
        rts
en_mine:
        lda en_owned
        bne en_have
        lda #$00                // attack 0, decay 0; sustain 15, release 6
        sta $d413
        lda #$f6
        sta $d414
        lda #$04
        sta $d411               // pulse width $400 (25%)
        lda #0
        sta $d410
        lda #1
        sta en_owned
en_have:
        lda en_freq
        sta $d40e
        lda en_freq + 1
        sta $d40f
        lda en_on
        beq en_off
        lda #$41                // pulse, gate on
        sta $d412
        rts
en_off: lda #$40
        sta $d412
        rts
en_freq:  .word 0
en_on:    .byte 0
en_owned: .byte 0
