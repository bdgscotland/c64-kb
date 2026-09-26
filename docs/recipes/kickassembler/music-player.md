---
recipe: music-player
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sid_play_routine_pattern, sid_voice_setup, sid_filter_routing, sfx_in_player]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418, D41C, DC04, DC05, DC0D, DC0E, DD0D]
uses_kernal: []
claims: [irq_vector_fffe (owns), nmi_vector_fffa (owns), cia1_timer_b (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init), vic_raster_irq (owns)]
harness: [cia1_timer_a]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — A full SID music player with measured cost: instruments, wavetable, order lists, hard restart, filter programs, effects on voice 3

Verified on: VICE x64sc 3.10, the windowless build, reSID; PAL c64c
(8565, 8580, 8521) as `-default`, and NTSC (`-model ntsc`, 6567R8).
KickAssembler 5.25. 2026-09-24. Canonical name
`kickassembler-music-player`. Nobody has listened to this tune: every
claim below is a cycle count, a register trace or an ENV3 reading.

## Synopsis

A game-ready three-voice music player with a short original tune, "Test
Card" (E minor, 10 bars, swing). It has an order list per voice with
transposes and a loop, patterns, instruments (AD, SR, a per-frame
wavetable for arpeggios and drums, pulse width and sweep, delayed
vibrato, legato), a two-frame hard restart, two filter programs (a pluck
that closes on every note, a wah that bounces), and six prioritised sound
effects that borrow voice 3 and hand it back after the same hard restart. It uses no zero page. The
API is `music_init` (A = 0 PAL, 1 NTSC), `music_play` once a frame, and
`sfx_request` (A = effect 1-6). The harness plays it from a raster IRQ with
the KERNAL banked out, as a game does, times all 2,000 `music_play` calls
with CIA1 timer A, fires 15 effect requests on fixed frames, and checks
that after every hand-back ENV3 shows the music's next attack on voice 3.
It also checks that every note voice 3 starts, next to a hand-back or
not, begins its attack inside its own play call: the player writes a new
note's gate before its AD and SR, the order `sid-hr-snare` measured
(#118), and gives voice 3 the hard restart when an effect ends (#120).
It prints the figures and
PASS or FAIL. Use it as the play routine of a
game, or as the measured reference for a music budget.

## Source

The listing is in three parts: the harness, the player, the tune. The
tune's data was compiled from note names by a script outside this
repository; each pattern carries its note names in a comment, and the
comment above the tables gives every byte format, so a tune can be
written or edited by hand.

```asm
// music-player.asm: a three-voice SID music player with instruments, a
// wavetable, order lists, hard restart, a filter program and prioritised
// sound effects on voice 3, driven from a raster IRQ with the KERNAL banked
// out, as a game runs it. The harness times every music_play call with
// CIA1 timer A, fires effects on fixed frames, watches ENV3 for the music's
// first attack after each effect hands voice 3 back, checks that every note
// the music starts on voice 3 begins its attack inside its own play call
// (ENV3 read just after the call), and prints the result.
// Build: java -jar KickAss.jar music-player.asm -o music-player.prg
// -define FORCE_FAULT builds the player's first note-start order (AD and SR
// before the gate, SR_FIRST): the note check fails. -define V3_BASS or
// V3_LEAD swaps that part's order list onto voice 3, so the note check
// reads its instruments' attacks.
// In VICE, run it with a real sound sink (-sound -sounddev dump -soundarg
// /dev/null): with +sound, $D41C does not return the envelope.
#if FORCE_FAULT
#define SR_FIRST
#endif

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN  = $0400
.const LINE    = 250        // below the display: no badlines, no sprites
.const NFRAMES = 2000       // play calls timed before the report
.const EXP_ASKED   = 15     // from the script below, worked by hand
.const EXP_STARTED = 13
.const EXP_BACK    = 11

* = $0810 "harness"
start:
        sei
        lda $02a6               // KERNAL: 1 PAL, 0 NTSC
        eor #1
        sta ntsc
        lda #$35                // KERNAL and BASIC out, I/O in
        sta $01
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda $dd0d
        lda #<irq
        sta $fffe
        lda #>irq
        sta $ffff
        lda #<nmi
        sta $fffa
        lda #>nmi
        sta $fffb
        lda #0
        sta $d020
        sta $d021
        ldx #0
!:      lda labels,x
        sta SCREEN,x
        lda labels+$100,x
        sta SCREEN+$100,x
        lda labels+$200,x
        sta SCREEN+$200,x
        lda #$20
        sta SCREEN+$2e8,x
        lda #1
        sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $dae8,x
        inx
        bne !-
        ldx #3                  // clock name on row 2
        ldy #3
        lda ntsc
        beq !+
        ldy #7
!:      lda clocktxt,y
        sta SCREEN+2*40+14,x
        dey
        dex
        bpl !-
        // Stopwatch calibration: the same bracket around an empty call.
        lda #$ff
        sta $dc04
        sta $dc05
        lda #$11                // force load $FFFF, start
        sta $dc0e
        jsr empty
        lda #0
        sta $dc0e
        lda $dc04
        clc
        adc #12                 // the empty call's own JSR and RTS
        sta kc
        lda $dc05
        adc #0
        sta kc+1
#if V3_BASS
        SWAP(tn_ordlo, 0, 2)    // measurement build: the bass on voice 3
        SWAP(tn_ordhi, 0, 2)
#elif V3_LEAD
        SWAP(tn_ordlo, 1, 2)    // measurement build: the lead on voice 3
        SWAP(tn_ordhi, 1, 2)
#endif
        lda ntsc
        jsr music_init
        lda #$1b
        sta $d011
        lda #LINE
        sta $d012
        lda #1
        sta $d01a
        sta $d019
        cli
!:      lda done
        beq !-
        jsr report
idle:   jmp idle                // the music keeps playing

empty:  rts

// ---------------------------------------------------------------------------
// Once a frame: effect requests, the timed call, statistics, hand-back.
// ---------------------------------------------------------------------------
irq:    pha
        txa
        pha
        tya
        pha
        lda #1
        sta $d019
        lda $d41c               // ENV3: voice 3's envelope, before this play
        sta env
        lda done
        beq !+
        jsr music_play          // report shown: play untimed
        jmp irq_out
!:
#if !NO_FX
        jsr script
#endif
        lda sfx_num
        sta fxbefore
        lda mu_gate+14
        sta gatebefore
        lda sfx_pending
        ora sfx_num
        sta fxflag              // nonzero: an effect starts or runs
        lda #$11
        sta $dc0e
        jsr music_play
        lda #0
        sta $dc0e
        lda $d41c               // ENV3 just after the play call
        sta envnow
        lda kc
        sec
        sbc $dc04
        sta cost
        lda kc+1
        sbc $dc05
        sta cost+1
        lda sfx_num
        ora fxflag
        sta fxflag
        jsr stats
        jsr handback
        jsr notes
        lda env
        sta envprev
        inc frame
        bne !+
        inc frame+1
!:      lda frame
        cmp #<NFRAMES
        bne irq_out
        lda frame+1
        cmp #>NFRAMES
        bne irq_out
        inc done
irq_out:
        pla
        tay
        pla
        tax
        pla
nmi:    rti

// If v < cost: v = cost, at = frame.
.macro MAX(v, at) {
        lda v
        cmp cost
        lda v+1
        sbc cost+1
        bcs !+
        lda cost
        sta v
        lda cost+1
        sta v+1
        lda frame
        sta at
        lda frame+1
        sta at+1
!:
}

stats:  lda cost+1
        bne st_play
        lda cost
        cmp #60
        bcs st_play
        sta skipcost            // an NTSC skipped call
        inc skips
        bne !+
        inc skips+1
!:      rts
st_play:
        MAX(worst, worstat)
        lda cost                // best: cost < best
        cmp best
        lda cost+1
        sbc best+1
        bcs !+
        lda cost
        sta best
        lda cost+1
        sta best+1
!:      lda fxflag
        bne st_fx
        MAX(qworst, qworstat)
        rts
st_fx:  MAX(fworst, fworstat)
        rts

// After an effect hands voice 3 back, wait for ENV3 to rise: the music's
// next attack. It must come with the player's voice 3 gate on, and before
// another effect takes the voice.
handback:
        lda waiting
        beq hb_edge
        lda fxbefore
        beq !+
        inc cut                 // an effect took the voice first
        lda #0
        sta waiting
        beq hb_edge
!:      lda env
        cmp envprev
        beq hb_wait
        bcc hb_wait
        lda gatebefore          // ENV3 rose: whose gate?
        bne !+
        inc bad
        jmp hb_done
!:      inc back
        lda wait
        cmp maxwait
        bcc hb_done
        sta maxwait
hb_done:
        lda #0
        sta waiting
        beq hb_edge
hb_wait:
        inc wait
hb_edge:
        lda fxbefore            // this call ended an effect
        beq !+
        lda sfx_num
        bne !+
        inc hb
        lda #1
        sta waiting
        lda #0
        sta wait
!:      rts

// A note start on voice 3: after the call the voice is the music's and the
// player's gate is on; before it the gate was off, or the effect's hard
// restart held the voice (the hand-back gates a note that began during the
// restart). Every such note counts, the ones next to a hand-back too. It is
// on time when ENV3, read just after the call, is above zero: the attack
// began in the call. A note that waits for the ADSR bug's counter wrap
// reads 0 there.
notes:  lda sfx_num
        bne nt_ret
        lda mu_gate+14
        beq nt_ret
        lda gatebefore
        beq !+
        lda fxbefore            // gate already on: only the hand-back call
        beq nt_ret
!:      inc starts
        bne !+
        inc starts+1
!:      lda envnow
        beq nt_ret
        inc ontime
        bne nt_ret
        inc ontime+1
nt_ret: rts

// Swap two bytes of a table (the V3_BASS and V3_LEAD builds).
.macro SWAP(t, a, b) {
        lda t+a
        ldx t+b
        sta t+b
        stx t+a
}

// Effect requests on fixed frames. Two on one frame: the player's queue
// keeps the higher priority.
script: ldx sidx
        lda scfhi,x
        cmp frame+1
        bne sc_ret
        lda scflo,x
        cmp frame
        bne sc_ret
        lda scfx,x
        jsr sfx_request
        inc asked
        inc sidx
        jmp script
sc_ret: rts

// frame, effect (1 shot, 2 thud, 3 boom, 4 crash, 5 oil, 6 missile)
.var events = List().add(
    200, 1,                 // shot: starts, hands back
    300, 2,                 // thud
    400, 3,  410, 1,        // boom; the shot is refused (priority 1 < 4)
    500, 1,  500, 6,        // same frame: the queue keeps the missile
    600, 5,  606, 4,        // oil, cut by the crash (5 > 1)
    750, 1,  753, 1,        // a shot restarted by an equal one
    900, 5,
    1300, 3, 1500, 4, 1700, 2, 1800, 6,
    65535, 0)
scflo:  .fill events.size()/2, <events.get(i*2)
scfhi:  .fill events.size()/2, >events.get(i*2)
scfx:   .fill events.size()/2, events.get(i*2+1)

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
// Five decimal digits of a word (PUT) or a byte (PUTB) at row, column.
.macro PUT(v, row, col) {
        lda #<(SCREEN + row * 40 + col)
        sta pd_st+1
        lda #>(SCREEN + row * 40 + col)
        sta pd_st+2
        lda v
        ldx v+1
        jsr putdec
}
.macro PUTB(v, row, col) {
        lda #<(SCREEN + row * 40 + col)
        sta pd_st+1
        lda #>(SCREEN + row * 40 + col)
        sta pd_st+2
        lda v
        ldx #0
        jsr putdec
}
report: PUT(frame, 3, 14)
        PUT(skips, 4, 14)
        PUTB(skipcost, 4, 30)
        PUT(worst, 5, 14)
        PUT(worstat, 5, 30)
        PUT(qworst, 6, 14)
        PUT(qworstat, 6, 30)
        PUT(fworst, 7, 14)
        PUT(fworstat, 7, 30)
        PUT(best, 8, 14)
        PUTB(asked, 10, 14)
        PUTB(sfx_taken, 10, 30)
        PUTB(hb, 11, 14)
        PUTB(back, 11, 30)
        PUTB(maxwait, 12, 14)
        PUTB(cut, 12, 30)
        PUTB(bad, 13, 14)
        PUT(starts, 14, 14)
        PUT(ontime, 14, 30)
        // verdict
        lda asked
        cmp #EXP_ASKED
        bne fail
        lda sfx_taken
        cmp #EXP_STARTED
        bne fail
        lda hb
        cmp #EXP_BACK
        bne fail
        cmp back
        bne fail
        lda cut
        ora bad
        bne fail
        lda starts              // every voice 3 note start on time
        ora starts+1
        beq fail
        lda starts
        cmp ontime
        bne fail
        lda starts+1
        cmp ontime+1
        bne fail
        ldx #0                  // skipped calls: none on PAL, 1 in 6 on NTSC
        ldy #0
        lda ntsc
        beq !+
        ldx #<(NFRAMES/6)
        ldy #>(NFRAMES/6)
!:      cpx skips
        bne fail
        cpy skips+1
        bne fail
        ldx #3
!:      lda passtxt,x
        sta SCREEN+15*40+14,x
        dex
        bpl !-
        lda #5
        sta $d020
        rts
fail:   ldx #3
!:      lda failtxt,x
        sta SCREEN+15*40+14,x
        dex
        bpl !-
        lda #2
        sta $d020
        rts

// A/X = value; pd_st holds the screen address.
putdec: sta num
        stx num+1
        ldy #0
pd_dig: ldx #$30                // screen code of 0
pd_sub: lda num
        sec
        sbc pow_lo,y
        sta pd_t
        lda num+1
        sbc pow_hi,y
        bcc pd_put
        sta num+1
        lda pd_t
        sta num
        inx
        bne pd_sub
pd_put: txa
pd_st:  sta $ffff,y
        iny
        cpy #5
        bne pd_dig
        rts
pow_lo: .byte <10000, <1000, <100, <10, <1
pow_hi: .byte >10000, >1000, >100, >10, >1

clocktxt: .text "PAL NTSC"
passtxt:  .text "PASS"
failtxt:  .text "FAIL"
labels:
        .text "SID MUSIC PLAYER: COST AND HAND-BACK    "   // row 0
        .text "TUNE: TEST CARD, E MINOR, SWING 7/5     "   // row 1
        .text "CLOCK                                   "   // row 2
        .text "CALLS TIMED                             "   // row 3
        .text "SKIPPED CALLS        COST               "   // row 4
        .text "PLAY WORST           AT FRAME           "   // row 5
        .text "MUSIC ONLY           AT FRAME           "   // row 6
        .text "WITH EFFECT          AT FRAME           "   // row 7
        .text "PLAY BEST                               "   // row 8
        .text "                                        "   // row 9
        .text "FX ASKED             STARTED            "   // row 10
        .text "HAND-BACKS           ATTACKS            "   // row 11
        .text "LONGEST WAIT         CUT                "   // row 12
        .text "WRONG GATE                              "   // row 13
        .text "NOTES ON V3          IN CALL            "   // row 14
        .text "RESULT                                  "   // row 15
        .fill 768 - 16 * 40, $20

// Variables
ntsc:       .byte 0
done:       .byte 0
frame:      .word 0
kc:         .word 0
cost:       .word 0
num:        .word 0
pd_t:       .byte 0
skips:      .word 0
skipcost:   .byte 0
worst:      .word 0
worstat:    .word 0
qworst:     .word 0
qworstat:   .word 0
fworst:     .word 0
fworstat:   .word 0
best:       .word $ffff
fxflag:     .byte 0
fxbefore:   .byte 0
gatebefore: .byte 0
env:        .byte 0
envprev:    .byte 0
envnow:     .byte 0
starts:     .word 0
ontime:     .word 0
sidx:       .byte 0
asked:      .byte 0
hb:         .byte 0
back:       .byte 0
cut:        .byte 0
bad:        .byte 0
waiting:    .byte 0
wait:       .byte 0
maxwait:    .byte 0

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
//     gate off and AD = SR = 0, then the note's gate, AD and SR on its step;
//   - one filter program at a time: a cutoff sweep that stops or bounces;
//   - two speeds (frames a step) that alternate: swing when unequal.
// Effects take voice 3 by priority. When one ends, voice 3 gets the hard
// restart (gate off, AD = SR = 0) and two calls later goes back to the music
// with its pulse width and frequency rewritten; a note the music started in
// those two calls gates then, from its wavetable's first row (#120).
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
                            // mu_s3+0: unused since #120
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
sfx_num:     .byte 0        // effect on voice 3, 0 = none, FX_HR = its restart
.const FX_HR = 7            // after the effect's data (fx_end)
sfx_pos:     .byte 0        // next byte of its data
sfx_taken:   .byte 0        // effects started (for the verdict)

// A new note's gate goes out before its AD and SR (mu_envp). After the
// hard restart AD = SR = 0, so at the gate's edge every rate period is the
// shortest and the rate counter cannot be past it; AD and SR follow within
// 24 cycles. The first version wrote AD and SR about 150 cycles before the
// gate, and an attack-0 note then waited for the ADSR bug's counter wrap,
// about 32,600 cycles: SR's release rate ran until the gate, and reSID uses
// the decay rate for the gate's first cycles. Measured in VICE x64sc 3.10
// (reSID) by sid-hr-snare and by this harness's note check (#118).
// -define SR_FIRST restores the old order; -define AD_FIRST writes AD, then
// the gate, then SR.
mu_envp: .fill 15, 0        // nonzero at X: AD and SR still to write
mu_flo: .fill 96, 0         // frequency table, built by music_init
mu_fhi: .fill 96, 0

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
        lda mu_upd,x            // bit 0 frequency, 1 control, 2 pulse
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
#if !SR_FIRST
        lda mu_envp,x           // a new note's envelope, after its gate
        beq !+                  // (see mu_envp)
#if !AD_FIRST
        lda mu_ad,x
        sta $d405,x
#endif
        lda mu_sr,x
        sta $d406,x
        lda #0
        sta mu_envp,x
#endif
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
        lda mu_upd,x            // frequency and control; the pulse width went
        ora #3                  // out on the frame before (mu_pre), or goes
        sta mu_upd,x            // with these if an effect held the voice then
        lda tn_ad,y
        sta mu_ad,x
        lda tn_sr,y
        sta mu_sr,x
#if SR_FIRST || AD_FIRST
        bit mu_skip             // an effect's voice: fx_hr writes them
        bmi ms_env
        lda mu_ad,x
        sta $d405,x             // AD, then (AD_FIRST) the gate and SR
#endif
#if SR_FIRST
        lda mu_sr,x             // the old order: AD, SR, then the gate in
        sta $d406,x             // mv_out
        rts
#endif
ms_env: lda #1                  // the gate, then AD and SR, in mv_out
        sta mu_envp,x
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
        cmp #FX_HR
        beq fx_hr
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
// The data is over. Before the music gets voice 3 back it has the music's
// hard restart (#120): gate off, AD = SR = 0, then two calls with nothing
// written, so the rate counter is below 9 at the next gate, as after mu_hr.
fx_end: lda fx_data-2,y         // the last row's control, gate off
        and #$fe
        sta $d412
        lda #0
        sta $d413
        sta $d414
        sta mu_gate+14          // a note the music starts from here on
        lda #FX_HR              // waits for the hand-back
        sta sfx_num
        lda #2
        sta sfx_pos             // calls left in the restart
        rts
fx_hr:  dec sfx_pos
        bne fx_ret
        lda #0                  // hand-back: voice 3 is the music's again
        sta sfx_num
        lda #7                  // its frequency, control and pulse this frame
        sta mu_upd+14
        lda mu_gate+14          // a note that began in the restart gates now,
        sta mu_envp+14          // its AD and SR after the gate (mu_envp)
        beq fx_ret
        ldy mu_ci+14            // from its wavetable's first row
        lda tn_wt,y
        sta mu_wpos+14
#if SR_FIRST || AD_FIRST
        lda mu_ad+14            // the old orders: AD (and SR) before the gate
        sta $d405+14
#endif
#if SR_FIRST
        lda mu_sr+14
        sta $d406+14
#endif
        rts

// Priority by effect number; 0 is "none", FX_HR the restart after an effect.
fx_pri: .byte 0, 1, 3, 4, 5, 1, 2, 0
fx_ptr: .byte fx_shot-fx_data, fx_thud-fx_data, fx_boom-fx_data, fx_dead-fx_data
        .byte fx_oil-fx_data, fx_miss-fx_data
fx_data:
fx_shot:                        // a pulse zap falling from $30 in 7 frames
        .byte $00, $a0, $04
        .byte $41, $34, $41, $2c, $41, $24, $41, $1e, $40, $18, $40, $13, $40, $10
        .byte 0
fx_thud:                        // a car's body hit: low noise, fast decay
        .byte $00, $b8, $08
        .byte $81, $09, $81, $06, $41, $03, $80, $04, $80, $03, $80, $02
        .byte 0
fx_boom:                        // explosion: noise falling for 34 frames
        .byte $0a, $f9, $08
        .byte $81, $30, $81, $24, $81, $1c, $81, $16, $81, $12, $81, $10
        .byte $81, $0e, $81, $0d, $81, $0c, $81, $0b, $81, $0a, $81, $09
        .byte $81, $08, $81, $08, $81, $07, $81, $07, $80, $06, $80, $06
        .byte $80, $06, $80, $05, $80, $05, $80, $05, $80, $04, $80, $04
        .byte $80, $04, $80, $04, $80, $03, $80, $03, $80, $03, $80, $03
        .byte $80, $02, $80, $02, $80, $02, $80, $02
        .byte 0
fx_dead:                        // the player's crash: a squeal, then a long boom
        .byte $0b, $fa, $08
        .byte $21, $48, $21, $44, $21, $40, $21, $3a, $21, $34, $41, $2e
        .byte $81, $40, $81, $30, $81, $24, $81, $1c, $81, $16, $81, $12
        .byte $81, $10, $81, $0e, $81, $0c, $81, $0b, $81, $0a, $81, $09
        .byte $81, $08, $81, $07, $81, $06, $81, $05, $80, $05, $80, $04
        .byte $80, $04, $80, $03, $80, $03, $80, $02, $80, $02, $80, $01
        .byte 0
fx_oil:                         // oil slick: a hiss that rises and fades
        .byte $08, $00, $08
        .byte $81, $50, $81, $58, $81, $60, $81, $68, $81, $70, $81, $78
        .byte $81, $80, $81, $88, $81, $90, $80, $98, $80, $a0, $80, $a8
        .byte $80, $b0, $80, $b8
        .byte 0
fx_miss:                        // missile launch: a sawtooth sweep upward
        .byte $02, $a8, $08
        .byte $21, $08, $21, $0a, $21, $0c, $21, $0e, $21, $11, $21, $14
        .byte $81, $60, $21, $18, $21, $1c, $21, $21, $21, $26, $20, $2c
        .byte $20, $32, $20, $38, $20, $40
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
// The tune, "Test Card". Formats:
//   tn_speed    two frame counts a step, alternating (7, 5: swing)
//   tn_ord1-3   order lists: pattern number $00-$7F, transpose $80-$BF
//               ($A0 + semitones), $FF then the loop position
//   tn_p0-12    patterns: note $00-$5F (C0 = 0, A4 = 57), $60 rest, $61
//               tie, $80 + n instrument n, $BF + n duration n steps, $FF end
//   tn_ad ...   instruments, one byte each: AD, SR, wavetable start, pulse
//               width (pwh $80: keep), sweep (added every other frame, so
//               stored doubled), vibrato (depth shift << 4 | half period),
//               vibrato delay, filter program (+$80: restart every note),
//               flags (bit 0 legato)
//   tn_wtw/wtn  wavetable rows: waveform, then note (relative semitones, or
//               $80 + absolute note); waveform 0 jumps to the row in the
//               note column, or holds when that is $FF
//   tn_f...     filter programs 1-2: cutoff, speed, min, max, $D417, mode
//               ($D418 high nibble, bit 0 bounce)
// ===========================================================================
tn_speed: .byte $07, $05
tn_ordlo: .byte <tn_ord1, <tn_ord2, <tn_ord3
tn_ordhi: .byte >tn_ord1, >tn_ord2, >tn_ord3
tn_patlo: .byte <tn_p0, <tn_p1, <tn_p2, <tn_p3, <tn_p4, <tn_p5, <tn_p6, <tn_p7, <tn_p8, <tn_p9, <tn_p10, <tn_p11, <tn_p12
tn_pathi: .byte >tn_p0, >tn_p1, >tn_p2, >tn_p3, >tn_p4, >tn_p5, >tn_p6, >tn_p7, >tn_p8, >tn_p9, >tn_p10, >tn_p11, >tn_p12
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
tn_ord1: .byte $00, $00, $a0, $00, $9c, $01, $9e, $01, $9b, $00, $a0, $02, $02, $9c, $02, $9e, $02, $ff, $02
tn_ord2: .byte $06, $06, $a0, $07, $08, $09, $0a, $0b, $0c, $9c, $0b, $9e, $0c, $ff, $02
tn_ord3: .byte $03, $03, $a0, $04, $9c, $05, $9e, $05, $9b, $04, $a0, $04, $04, $9c, $05, $9e, $05, $ff, $02
// bE: i=bass E2:2 E3:1 E2:1 B2:2 E2:2 D3:2 E2:2 B2:2 E3:2
tn_p0: .byte $80, $c1, $1c, $c0, $28, $1c, $c1, $23, $1c, $26, $1c, $23, $28, $ff
// bM: i=bass E2:2 E3:1 E2:1 B2:2 E2:2 B2:2 E2:2 B2:2 E3:2
tn_p1: .byte $80, $c1, $1c, $c0, $28, $1c, $c1, $23, $1c, $23, $1c, $23, $28, $ff
// bW: i=wbass E2:4 E2:2 E3:2 E2:4 D3:2 B2:2
tn_p2: .byte $81, $c3, $1c, $c1, $1c, $28, $c3, $1c, $c1, $26, $23, $ff
// dI: K:2 H:2 S:2 H:2 K:2 K:2 S:2 H:1 H:1
tn_p3: .byte $86, $c1, $30, $88, $30, $87, $30, $88, $30, $86, $30, $30, $87, $30, $88, $c0, $30, $30, $ff
// dm: K:2 M:2 S:2 M:2 K:1 K:1 M:2 S:2 M:2
tn_p4: .byte $86, $c1, $30, $84, $34, $87, $30, $84, $34, $86, $c0, $30, $30, $84, $c1, $34, $87, $30, $84, $34, $ff
// dM: K:2 J:2 S:2 J:2 K:1 K:1 J:2 S:2 J:2
tn_p5: .byte $86, $c1, $30, $85, $34, $87, $30, $85, $34, $86, $c0, $30, $30, $85, $c1, $34, $87, $30, $85, $34, $ff
// l0: r:16
tn_p6: .byte $cf, $60, $ff
// lA1: i=lead B4:6 A4:2 G4:4 E4:4
tn_p7: .byte $82, $c5, $3b, $c1, $39, $c3, $37, $34, $ff
// lA2: i=lead G4:6 A4:2 C5:4 E5:4
tn_p8: .byte $82, $c5, $37, $c1, $39, $c3, $3c, $40, $ff
// lA3: i=lead D5:6 C5:2 A4:4 F#4:4
tn_p9: .byte $82, $c5, $3e, $c1, $3c, $c3, $39, $36, $ff
// lA4: i=lead F#4:6 B4:2 D5:8
tn_p10: .byte $82, $c5, $36, $c1, $3b, $c7, $3e, $ff
// rB1: i=run E5 D5 B4 G4 B4 D5 E5 G5 E5 D5 B4 G4 B4 D5 E5 F#5
tn_p11: .byte $83, $c0, $40, $3e, $3b, $37, $3b, $3e, $40, $43, $40, $3e, $3b, $37, $3b, $3e, $40, $42, $ff
// rB2: i=run G5 F#5 E5 D5 E5 D5 B4 A4 G4 A4 B4 D5 E5:2 r:2
tn_p12: .byte $83, $c0, $43, $42, $40, $3e, $40, $3e, $3b, $39, $37, $39, $3b, $3e, $c1, $40, $60, $ff
```

## Build

```bash
java -jar KickAss.jar music-player.asm -o music-player.prg
```

Built with KickAssembler 5.25: one assert (the effect data fits one index
byte), 0 failed. The PRG occupies `$0801`-`$1A17`. From the symbol file:

| Part | Range | Bytes |
|---|---|---|
| Harness (code, text, variables) | `$0810`-`$1030` | 2,081 |
| Player state and frequency table | `$1031`-`$1181` | 337 |
| Player code | `$1182`-`$172A` | 1,449 |
| Effect priorities, pointers and data | `$172B`-`$1824` | 250 |
| Octave-6 frequency tables, PAL and NTSC | `$1825`-`$1854` | 48 |
| Tune "Test Card" | `$1855`-`$1A17` | 451 |

The player and tune together are 2,535 bytes, with no zero page. The
gate-first note start (#118) added 15 bytes of state (`mu_envp`) and 21
of code to the 2,484 of the first version; the hard restart at the
hand-back (#120) added 14 bytes of code and one of priority, 2,520 before.

**Build switches.** `-define NO_VIB`, `NO_PWS`, `NO_FLT`, `NO_WT`,
`NO_HR`, `NO_LEG` or `NO_FX` removes one feature, for measuring what it
costs: `java -jar KickAss.jar -define NO_VIB music-player.asm -o
music-player.prg`. With no switch, the PRG is byte-identical to the one
measured below. The cost of each feature is tabled under "Cycle budget"
for `sid_play_routine_pattern` in `techniques/music-sid.md`. Three more
switches change the note start: `SR_FIRST` restores the first version's
order (AD, SR, then the gate), `AD_FIRST` writes AD, the gate, then SR,
and `FORCE_FAULT` is `SR_FIRST`. Two change only the harness: `V3_BASS`
and `V3_LEAD` swap that part's order list with the drums', so the note
check reads the bass's or the lead's instruments on voice 3.

## Expected output

Every figure below was measured in VICE x64sc 3.10 (rung 1). The run is
pinned in `recipes/runs.json`: 50,000,000 cycles, PAL and NTSC, with a
real sound sink so that `$D41C` returns the envelope:

```text
x64sc -default -warp -sound -sounddev dump -soundarg /dev/null \
      +autostart-delay-random -autostartprgmode 1 -limitcycles 50000000 \
      [-model ntsc] -exitscreenshot out.png -autostart music-player.prg
```

The text was decoded from the exit screenshots against the
`chargen-901225-01.bin` glyphs with PIL. Two runs per model gave
byte-identical PNGs. PAL (`screenshots/music-player.png`):

```text
SID MUSIC PLAYER: COST AND HAND-BACK
TUNE: TEST CARD, E MINOR, SWING 7/5
CLOCK         PAL
CALLS TIMED   02000
SKIPPED CALLS 00000  COST     00000
PLAY WORST    01215  AT FRAME 00580
MUSIC ONLY    01215  AT FRAME 00580
WITH EFFECT   01175  AT FRAME 01300
PLAY BEST     00430

FX ASKED      00015  STARTED  00013
HAND-BACKS    00011  ATTACKS  00011
LONGEST WAIT  00009  CUT      00000
WRONG GATE    00000
NOTES ON V3   00169  IN CALL  00169
RESULT        PASS
```

NTSC (`screenshots/music-player-ntsc.png`) differs in these rows:

```text
CLOCK         NTSC
SKIPPED CALLS 00333  COST     00032
PLAY WORST    01223  AT FRAME 00696
MUSIC ONLY    01223  AT FRAME 00696
WITH EFFECT   01149  AT FRAME 00508
PLAY BEST     00438
LONGEST WAIT  00011  CUT      00000
NOTES ON V3   00134  IN CALL  00134
```

The border is green on both (PASS; red is FAIL).

**Cycles per `music_play` call**, including its JSR and RTS, net of the
stopwatch. The call runs from raster line 250, below the badlines, with
no sprites on, so the CIA count is CPU cycles. The medians and means come
from a VICE monitor trace of the harness's `cost` stores over the same
2,000 calls; the trace's worst and best equal the screen's.

| | PAL | NTSC |
|---|---|---|
| Worst call | 1,215 | 1,223 |
| Worst call with no effect running or starting | 1,215 | 1,223 |
| Median | 762 | 768 |
| Mean | 774 | 775 |
| Best | 430 | 438 |
| Skipped calls (NTSC tempo) | 0 | 333 of 2,000, 32 cycles each |

1,223 cycles is 19.4 PAL raster lines of 63 cycles and 18.8 NTSC lines
of 65 (arithmetic). Budget 1,223 cycles a frame for this player with
this tune. A different tune moves the figure; the harness measures any
tune dropped into the third part of the listing. The first version,
which wrote AD and SR before the gate, measured 1,198 PAL and 1,174 NTSC
at worst, 1,159 and 1,167 with no effect, medians 773 and 779, means 787
and 788, best 454 and 462. The gate-first order (#118) costs 7 cycles on
a control write that starts no note (the `mu_envp` test) and 28 on one
that does (instruction table), and the worst frames start three notes;
it read 1,250 and 1,250 at worst, 1,242 and 1,250 with no effect,
medians 782 and 784, means 795 and 795, best 451 and 459. The hard
restart at the hand-back (#120) removed the hand-back's own AD and SR
write, a 7-cycle test (`mu_dirty`) in every voice's output, and 2 cycles
from each note start: 27 cycles on a frame that starts three notes.

**The worst frames.** The costliest PAL frames, 1,212 to 1,215 cycles
(frames 580, 772, 1348 and 1540 at 1,214 and 1,215), all start a note on
all three voices: the gate goes on for voices 1, 2 and 3 in the same
call (a harness variant that logged each voice's gate edge per frame;
46 of the 2,000 frames do this). No effect runs on them. The costliest
frame with an effect, 1,175 on PAL, starts the boom on frame 1300. An
effect's end now costs little: on the frame its data ends voice 3 is
still the effect's, so the music writes nothing there, and the
hand-back two calls later cost at most 1,084 cycles on PAL (the store
trace, the eleven hand-back frames). An earlier version of this
paragraph said the two costliest frames were hand-back frames, 1,250
at frame 1816 and 1,249 at frame 208, 8 cycles above the worst
music-only frame (1,198 and 1,197 before #118): that player rewrote
voice 3's AD, SR, pulse width and control on the frame the effect's
data ended, while voices 1 and 3 started notes. Those two frames now
cost 1,115 and 1,113. The NTSC frames were not traced beyond the
figures above.

**The note check.** ENV3 is read just after every timed call. A note
start is a call after which voice 3 is the music's and the player's
voice 3 gate is on, and before which that gate was off or the effect's
restart held the voice (the hand-back call gates a note that began
during the restart). It is on time when that ENV3 read is not zero.
Every note the music starts on voice 3 counts, the ones next to a
hand-back too. `NOTES ON V3 00169 IN CALL 00169`: every drum hit of the
2,000 PAL calls began its attack inside its call; on NTSC 134 of 134.
Six of the eleven PAL hand-backs gate a drum note that began during
the restart (frames 210, 437, 917, 1337, 1709 and 1818; a store trace
of the hand-back path). An earlier version of this check left out
notes on the two frames after a hand-back, and with them the player
read 45 of 46 lead notes on time: the lead note on frame 916, the frame
after the oil effect's hand-back, had only the hand-back's AD and SR
write behind it and started late (#120). The same count, with the
note-start order and the part on voice 3 changed by the build switches
(PAL, 2,000 calls; every instrument of "Test Card" has attack 0):

| Part on voice 3 (instruments, AD / SR) | gate, AD, SR (this listing) | AD, gate, SR (`AD_FIRST`) | AD, SR, gate (`SR_FIRST`, the first version) |
|---|---|---|---|
| drums (4-8: `$06`-`$08`, `$03` / `$50`, `$00`) | 169 / 169 | 157 / 169 | 148 / 169 |
| bass (`V3_BASS`; 0, 1: `$0A` / `$80`, `$08` / `$A6`) | 146 / 146 | 127 / 146 | 98 / 146 |
| lead (`V3_LEAD`; 2, 3: `$0A` / `$A9`, `$09` / `$C8`) | 46 / 46 | 38 / 46 | 0 / 46 |

NTSC (`-model ntsc`), in the same order: drums 134, 125 and 124 of 134;
bass 114, 109 and 93 of 114; lead 29, 28 and 12 of 29. PAL `-model c64`
(6581) gives the PAL figures exactly. Before #120, with the notes next
to a hand-back counted, the gate-first player read 169 of 169, 146 of
146 and 45 of 46 on PAL and on the 6581, and 134, 114 and 29 on NTSC.
The table before #120 counted fewer notes (163, 139, 43 on PAL) and
read 150, 128, 39 for `AD_FIRST` and 146, 81, 0 for `SR_FIRST`. The late
counts in the two old orders depend on the rate counter's phase at each
gate, so they move when the code moves: a harness variant a few bytes
longer read 143, 94 and 0 for `SR_FIRST`. In that variant every late
note's ENV3 was still 0 one frame after its call and above 0 two frames
after it, which is the ADSR bug's counter wrap of up to 32,768 cycles
(1.66 PAL frames). `-define FORCE_FAULT` reads `IN CALL 00148` on PAL
and `00124` on NTSC, `RESULT FAIL`, red border.

**The register order.** From the dump sink's file of the PAL run (every
SID write with its cycle delta, 50,000,000 cycles, so past the report):
of 460 gate-on edges on `$D404`, `$D40B` and `$D412`, 447 are followed
by that voice's AD 15 cycles and SR 24 cycles after the gate; the other
13 are effect rows, with no AD or SR near them. None has an AD or SR
write in the 200 cycles before it. Before each of the 447, AD and SR
had both been 0 for at least 39,238 cycles; on NTSC, 428 of 428, at
least 34,004. Both are above the 32,768 the rate counter's wrap can
take. Before #120 two of the 447 started on a hand-back frame, with the
hand-back's AD and SR written 84 and 75 cycles before their gate and no
zeros before that, and one more had zeros for only 19,762 cycles. In
the `SR_FIRST` build the note starts write AD 155 to 175 cycles and SR
155 to 161 cycles before the gate (measured before #120).

**The script and the counts.** Frames count from the first IRQ. An
effect requested on frame f starts on frame f (its header: AD, SR, pulse
width, TEST), and plays one row a frame from f + 1. On the frame after
its last row voice 3 gets the hard restart, and two calls later it goes
back to the music. An earlier version of this sentence had the hand-back
on the frame after the last row, with no restart (#120).

| Frame | Request | Outcome |
|---|---|---|
| 200 | shot (1) | starts; restart on 208, hands back on 210 |
| 300 | thud (2) | starts; hands back |
| 400, 410 | boom (3), then shot | boom starts; the shot is refused at play time (priority 1 < 4) |
| 500 | shot and missile (6) on one frame | the request queue keeps the missile; the shot never reaches the player |
| 600, 606 | oil (5), then crash (4) | the crash cuts the oil (5 > 1): no hand-back between them |
| 750, 753 | shot, shot | the second restarts the first (equal priority) |
| 900 | oil | starts; hands back |
| 1300, 1500, 1700, 1800 | boom, crash, thud, missile | each starts and hands back |

15 requests; 13 effects started; 11 hand-backs. The harness compares
these with constants worked from this table, not from the player.

**The hand-back check.** ENV3 (`$D41C`) is read at the top of every IRQ,
before the play call. After each hand-back the harness waits for ENV3 to
rise. A rise counts under ATTACKS if the player's voice 3 gate was on
before the call, and under WRONG GATE if it was off. A new effect taking
the voice first counts under CUT. All 11 hand-backs were followed by a
music attack on voice 3, within 9 frames on PAL and 11 on NTSC (11 and
13 before #120, when the hand-back came two calls earlier). The wait is
the gap to the tune's next note on voice 3, so it depends on the tune.

**NTSC tempo.** The player skips one call in six on NTSC. The harness
expects 2,000 ÷ 6 = 333 skipped calls and counts 333, each 32 cycles.

**The pulse sweep runs.** A trace of `$D409`-`$D40A` (voice 2's pulse
width) over the tune's first bars reads `$800`, `$808`, `$810` and on,
8 more at each write. That is the lead's width `$800` and its sweep of 4
a frame, which the player stores doubled and applies every other frame.

## Why this works

**The step frame carries only envelopes and gates.** Each voice reads its
next event on its own tick: voice 1 two frames before the step, voice 2
three, voice 3 four (`mu_ftktab`). The hard restart happens two frames
before the step. The new instrument's pulse width, vibrato and filter
program load one frame before. The step frame then writes the control
byte, AD and SR for each voice that starts a note. This spread keeps the
worst frame near 1,215 cycles when all three voices start notes on one
step (1,160 before the gate-first order, 1,242 before #120). Speeds under 5 frames a step
would put two of these jobs on one
frame, so the tune's speeds must be 5 or more.

**The hard restart keeps the note's attack, if the gate comes first.**
Two frames before a note that is not legato, the player clears the gate
and writes AD = SR = 0, so the envelope releases at the fastest rate,
period 9 cycles, and the rate counter wraps below 9 within 32,768 cycles
(two PAL frames are 39,312). On the note's own frame it writes the
control byte (for the bass, `$09`: TEST and GATE from its wavetable's
first row; the sawtooth follows on the next frame), then AD 15 cycles
later and SR 24 cycles later. At the gate's edge the registers still hold
the restart's zeros, so every rate period is the shortest and the counter
cannot be past it; the attack starts inside the call. The first version
wrote AD and SR 155 to 175 cycles before the gate, and that could undo
the restart for an instrument with attack 0: SR written with the gate
off makes its release rate the rate at once, and with a release above 0
the counter can run past the attack's period of 9 before the gate; AD
written first leaves the decay rate at the edge, which reSID uses for
the edge's first cycles (`sid-hr-snare`, "Why this works"). A note that
found the counter past 9 waited for its wrap, about 33 ms. An earlier version of this paragraph said the attack
started on the note's frame; the note check above shows it did for 81 of
139 bass notes and none of 43 lead notes. This is not the hard-restart
listing that issue #49 corrects, which sets TEST and GATE a frame early
under SR = `$F0` and loses the attack.

**Effects own voice 3 without stopping the tune.** `fx_frame` runs first
in every call and decides who owns voice 3. While an effect runs, the
music's voice 3 keeps reading its patterns and keeps its state, but
writes nothing to the SID (`mu_skip`). `$D417` is masked with `$FB`, so
voice 3 leaves the filter while the effect plays.

**The hand-back is a note boundary.** A note's hard restart that falls
while an effect owns voice 3 writes nothing to the SID. So when the
effect's data ends, `fx_end` gives voice 3 the restart itself: the gate
off, AD = SR = 0, and `sfx_num` = `FX_HR` (priority 0, so any request
takes the voice back). Two calls later `fx_hr` hands the voice to the
music and marks its frequency, control and pulse width for writing.
The music never writes an instrument's AD or SR to voice 3 with the
gate off, so the zeros stay until the next note's gate, which comes
first and is followed by its AD and SR as on every note. A note the
music started during the two restart calls gates at the hand-back,
from its wavetable's first row, one or two frames after its step; its
vibrato delay and pulse sweep have run those frames. That is the price
of the fix: the alternative is a note that waits for the counter's wrap,
about 33 ms. The first version wrote the music's AD and SR at once when
the data ended, gate off, and a note within two frames of that could
start late: frame 916 of the `V3_LEAD` build did (#120). The restart
also ends the effect's release at the fastest rate. Priorities decide
the rest: `sfx_request` keeps the higher of two requests in one frame,
and a request below the running effect's priority is dropped at play
time.

**Writes go straight to the SID.** There is no shadow copy. A voice whose
wavetable holds and has no vibrato or sweep writes nothing, which is why
the median call is about 780 cycles and the best about 450. The price is
the pitfall `sid_write_only_registers`: the player's state is the only
record of what the SID holds. `recipes/kickassembler/sfx-in-player.md`
uses a 25-byte shadow and pays 351 cycles a frame for the copy.

**Tempo on both clocks.** A PAL frame is 19,656 cycles at 985,248 Hz, so
the PAL rate is 50.125 Hz, not 50. At an average of 6 frames a step, a
sixteenth note lasts 0.1197 s and the tempo is 125.3 beats a minute. The
tune is 960 frames long, 19.15 s, and its loop is 768 frames, 15.32 s.
An NTSC frame is 17,095 cycles at 1,022,727 Hz, or 59.826 Hz. Skipping
one call in six gives 49.855 music frames a second, 0.54 % slower than
PAL, or 124.6 beats a minute. All of this is arithmetic from the clock
constants (rung 3). The NTSC frequency table is built from the NTSC
clock, so pitch is the same on both. Pitfall
`pal_ntsc_tempo_mismatch` in `pitfalls/region-timing.md` gives the
general problem.

## Corrections to the source player

This listing is the #50 player (INTERCEPTOR's `sound.asm`, 2026-09-23)
with four fixes. The first three are in the copy inside
`recipes/kickassembler/sid-env3-filter.md`; the fourth is not, because
that recipe keeps voice 3 for its filter envelope and requests no
effect.

- **Pulse sweep.** The source added the frame-parity test's result to the
  pulse width instead of the sweep, `mu_pws`. The width never moved from
  its start value. The fix is `lda mu_pws,x` after the parity branch. The
  trace above shows the sweep running.
- **NTSC skip.** The source reloaded its skip counter with 4 and so
  skipped one call in five, not the one in six its comment says. That is
  47.86 music frames a second, 4.5 % slower than PAL. This listing
  reloads 5, and the harness counts 333 skips in 2,000 calls.
- **Note-start order** (#118). The source wrote a note's AD and SR in
  `ms_new` and its gate 155 to 175 cycles later in `mv_out`, and so undid
  the hard restart for attack-0 instruments. This listing writes the gate
  first and AD and SR after it (`mu_envp`); the note check above measures
  both orders. The MEASURED demo's copy of the player keeps the old
  order (#119).
- **Hand-back** (#120). The source rewrote voice 3's AD and SR from the
  music's state when an effect ended, with the gate off, so a note
  within two frames had no hard restart behind it and could start
  about 33 ms late. This listing gives the voice the hard restart and
  hands it back two calls later.

The source's debug solo switch and its option to move the state to high
RAM are left out. The API is unchanged.

## Pitfalls met

- **ENV3 needs a real sound sink in VICE.** The first run used `+sound`.
  With sound off, `$D41C` did not follow voice 3: it fell by about 58 a
  frame whatever the voice did. The check then counted 5 of 11 rises
  under WRONG GATE and FAILED. With `-sound -sounddev dump -soundarg
  /dev/null` it passes. `recipes/kickassembler/sid-env3-filter.md` found
  the same.
- **The VICE monitor log appends.** `-monlogname` adds to an existing
  file, so a second traced run doubles the records. Delete the log before
  each run.
- **The KERNAL's RAM test shows up in a store trace.** A trace of the
  harness's variables also catches the boot-time RAM test's `$55` and
  `$AA` stores. Keep only stores whose PC is below `$E000`.
- **The ADSR bug undid the hard restart** (`sid_adsr_bug_8580`). The
  first version wrote a note's AD and SR before its gate, and attack-0
  notes started about 33 ms late despite the restart; the note check
  found it (#118).
- **A check that leaves cases out hides them.** The note check first
  skipped notes on the two frames after a hand-back. Counting them found
  the late lead note on frame 916 (#120).

## What it does not establish

- **How it sounds.** Nobody has listened to this tune. The instruments,
  the filter settings and the composition are the source author's own
  knowledge (rung 4), not measurements.
- **Real chips.** reSID in VICE only. The filter programs will sound
  different on the 6581 and the 8580 (`sid_8580_vs_6581_differences` in
  `techniques/music-sid.md`). The cycle counts do not depend on the SID
  model.
- **The note start on silicon.** The late attacks and the gate-first
  cure are reSID's model, the decay rate at the gate's edge included;
  no chip was sampled.
- **Other tunes.** The worst call depends on where note starts and
  hand-backs fall. For the three INTERCEPTOR tunes, the source's notes
  measured a worst call of 1,142 to 1,178 cycles on PAL with an older
  harness. That figure is from the build's record, not re-measured here.
