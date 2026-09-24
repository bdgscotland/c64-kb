---
recipe: sid-sync-lead
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sid_sync_lead]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418, DC04, DC05, DC0D, DC0E, DD0D]
uses_kernal: []
claims: [irq_vector_fffe (owns), nmi_vector_fffa (owns), cia1_timer_b (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init), vic_raster_irq (owns)]
harness: [cia1_timer_a, $02FF]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — A hard-sync lead through the music player: voice 3 the unheard master, voice 1 the slave

Verified on: VICE x64sc 3.10, the windowless build, reSID; PAL c64c
(8565, 8580, 8521) as `-default` and PAL `-model c64` (6569, 6581,
6526); NTSC `-model ntsc` (6567R8, 6581, 6526). KickAssembler 5.25.
2026-09-24. Canonical name `kickassembler-sid-sync-lead`. Nobody has
listened to the recordings: every figure below is a register trace or a
measurement of a WAV file, all reSID, none silicon.

## Synopsis

A lead played by the #50 music player (`music-player.md`, with the
note-start order of `sid-hr-snare`). Voice 1 is the slave: sawtooth with
SYNC set, and a wavetable that steps its pitch from 12 to 29 semitones
above the note over nine frames and holds there. Voice 3 is the master:
the same eight notes, unheard behind 3OFF (bit 7 of `$D418`, set by the
tune's filter program, which routes no voice through the filter). The
harness plays the tune's first 192 calls twice: A as written, B with
SYNC cleared and voice 3 resting, the slave alone. It logs voice 1's
control byte and note and voice 3's note after every call, times every
call, checks the logs and grades itself: `$02FF` = `$01` and a green
border on PASS, `$02` and red on FAIL. In the recordings, A sounds at the
master's pitch on every note, to 0.1 %, while B sounds at the slave's.
`-define FORCE_FAULT` writes phase A without SYNC. The technique is
`sid_sync_lead` in `techniques/sid-instruments.md`.

## Source

One file in four parts: the harness, the instrument's log and report,
the #50 player (its sound effects compiled out; one change, the
note-start order, marked at `mu_envp`), and the tune.

```asm
// sid-sync-lead.asm: a hard-sync lead played by the #50 music player.
// Voice 1 is the slave: sawtooth with SYNC set, a wavetable that steps its
// pitch 12 to 29 semitones above the note. Voice 3 is the master: the same
// notes, unheard behind 3OFF (bit 7 of $D418, set by the tune's filter
// program, FILT3 clear). The harness plays the tune's first 192 calls
// twice: A as written, B with the SYNC bit cleared and voice 3 resting (the
// slave alone). It logs voice 1's control byte and note and voice 3's note
// every call, times every call with CIA1 timer A, checks the log and prints
// the result: $02FF = $01 and a green border on PASS, $02 and red on FAIL.
// After the report the tune keeps playing, A and B alternating, for a
// recording. -define FORCE_FAULT writes phase A without the SYNC bit.
// Build: java -jar KickAss.jar sid-sync-lead.asm -o sid-sync-lead.prg
#define NO_FX

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN = $0400
.const LINE   = 250         // below the display: no badlines, no sprites
.const LOOP   = 192         // play calls per phase
.const WARM   = 50          // silent frames before phase A
.const RESULT = $02ff
.const LOGA0  = $3000       // phase A: four bytes a call, chosen by LOG
.const LOGA1  = $3100
.const LOGA2  = $3200
.const LOGA3  = $3300
.const LOGB0  = $3400       // phase B, the same four
.const LOGB1  = $3500
.const LOGB2  = $3600
.const LOGB3  = $3700
.const CYALO  = $3800       // play call cycles, A then B
.const CYAHI  = $3900
.const CYBLO  = $3a00
.const CYBHI  = $3b00

* = $0810 "harness"
start:
        sei
        lda #0
        sta RESULT
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
        lda labels+$2e8,x
        sta SCREEN+$2e8,x
        lda #1
        sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $dae8,x
        inx
        bne !-
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
        lda #$1b
        sta $d011
        lda #LINE
        sta $d012
        lda #1
        sta $d01a
        sta $d019
        cli
!:      lda phase
        cmp #2
        bcc !-
        jsr report
idle:   jmp idle                // the tune keeps playing, A and B alternating

empty:  rts

// ---------------------------------------------------------------------------
// Once a frame: the timed call and the log, then the phase changes.
// ---------------------------------------------------------------------------
irq:    pha
        txa
        pha
        tya
        pha
        lda #1
        sta $d019
        lda started             // start-up: silence the SID on the first
        cmp #WARM               // interrupt, wait, then start the tune, so
        bcs st_go               // that phase A starts, as B does, one frame
        inc started             // before its first call, from a SID that
        cmp #0                  // has run silent for WARM frames
        bne st_wait
        lda ntsc
        jsr music_init
st_wait:
        jmp irq_out
st_go:  bne !+
        inc started
        jsr set_a
        jmp restart
!:      lda phase
        cmp #2
        bcc !+
        jmp irq_free
!:      PRE()                   // the instrument's reads before the call
        lda #$11
        sta $dc0e
        jsr music_play
        lda #0
        sta $dc0e
        lda kc
        sec
        sbc $dc04
        sta cost
        lda kc+1
        sbc $dc05
        sta cost+1
        ldy fr
        lda phase
        bne log_b
        lda cost
        sta CYALO,y
        lda cost+1
        sta CYAHI,y
        LOG(LOGA0, LOGA1, LOGA2, LOGA3)
        jmp next
log_b:  lda cost
        sta CYBLO,y
        lda cost+1
        sta CYBHI,y
        LOG(LOGB0, LOGB1, LOGB2, LOGB3)
next:   inc fr
        lda fr
        cmp #LOOP
        bne irq_out
        lda #0
        sta fr
        inc phase
        lda phase
        cmp #1
        bne !+
        jsr set_b
        jmp restart
!:      jsr set_a               // phase 2: logs done, the report runs
        jmp restart
irq_free:                       // after the report: A, B, A, B ... untimed
        jsr music_play
        inc fr
        lda fr
        cmp #LOOP
        bne irq_out
        lda #0
        sta fr
        lda alt
        eor #1
        sta alt
        beq !+
        jsr set_b
        jmp restart
!:      jsr set_a
restart:
        lda ntsc
        jsr music_init          // the tune from its top, the SID silenced
irq_out:
        pla
        tay
        pla
        tax
        pla
nmi:    rti

// ---------------------------------------------------------------------------
// The instrument's log, its A and B settings, and the report.
// ---------------------------------------------------------------------------
.const ROWRES = 20
.const SHOW   = 4           // first call shown on screen
.const WT_SYNC  = 2             // instrument 1's wavetable start in A
.const WT_PLAIN = 12            // and in B: the same rows without SYNC
#if FORCE_FAULT
.const SYNCW = $20              // the fault: phase A has no SYNC either
#else
.const SYNCW = $22              // sawtooth + SYNC
#endif

// Nothing to read before the call.
.macro PRE() {
}

// Per call, after music_play: what the player last gave the SID, from its
// state (the SID's registers cannot be read back).
.macro LOG(c0, c1, c2, c3) {
        lda mu_wave             // voice 1 control: waveform, SYNC, GATE
        ora mu_gate
        sta c0,y
        lda mu_arp              // voice 1 note this frame (the slave)
        sta c1,y
        lda mu_arp+14           // voice 3 note this frame (the master)
        sta c2,y
        lda mu_note             // voice 1's pattern note
        sta c3,y
}

// A: the sync lead as written. B: the SYNC bit off, voice 3 resting.
set_a:  lda #WT_SYNC
        sta tn_wt+1
        lda #<tn_ord3
        sta tn_ordlo+2
        lda #>tn_ord3
        sta tn_ordhi+2
        rts
set_b:  lda #WT_PLAIN
        sta tn_wt+1
        lda #<tn_rest
        sta tn_ordlo+2
        lda #>tn_rest
        sta tn_ordhi+2
        rts

report: HEXROW(LOGA0, 2)
        HEXROW(LOGA1, 4)
        HEXROW(LOGA2, 6)
        HEXROW(LOGB0, 8)
        HEXROW(LOGB2, 10)
        ldx #0
rp_n:   lda LOGA0,x             // A: gated calls, and those with SYNC
        lsr
        bcc !+
        inc gated_a
        and #1                  // SYNC, bit 1 before the shift
        beq !+
        inc sync_a
!:      lda LOGA2,x             // A: the master on the slave's pattern note
        cmp LOGA3,x
        bne !+
        inc mast_a
!:      lda LOGB0,x             // B: no SYNC
        and #2
        beq !+
        inc sync_b
!:      lda LOGB2,x             // B: voice 3 never given a note
        bne !+
        inc zero_b
!:      lda LOGA1,x             // the slave's note stream, A against B
        cmp LOGB1,x
        bne !+
        inc same_ab
!:      inx
        cpx #LOOP
        bne rp_n
        PUTB(gated_a, 12, 7)
        PUTB(sync_a, 12, 21)
        PUTB(sync_b, 12, 35)
        PUTB(mast_a, 13, 7)
        PUTB(zero_b, 13, 21)
        PUTB(same_ab, 13, 35)
        CYCLES(CYALO, CYAHI, 16, 15)
        CYCLES(CYBLO, CYBHI, 17, 15)
        lda gated_a             // the verdict
        beq rp_fail
        cmp sync_a
        bne rp_fail
        lda sync_b
        bne rp_fail
        lda mast_a
        cmp #LOOP
        bne rp_fail
        lda zero_b
        cmp #LOOP
        bne rp_fail
        lda same_ab
        cmp #LOOP
        bne rp_fail
        lda #0
        jmp verdict
rp_fail:
        lda #1
        jmp verdict

gated_a: .byte 0
sync_a:  .byte 0
sync_b:  .byte 0
mast_a:  .byte 0
zero_b:  .byte 0
same_ab: .byte 0

labels:
        .text "SYNC LEAD: V1 SAW+SYNC, V3 MASTER, 3OFF "   // row 0
        .text "A: V1 CONTROL, CALLS 04-23              "   // row 1
        .text "                                        "   // row 2
        .text "A: V1 NOTE (THE SLAVE), SAME CALLS      "   // row 3
        .text "                                        "   // row 4
        .text "A: V3 NOTE (THE MASTER), SAME CALLS     "   // row 5
        .text "                                        "   // row 6
        .text "B: V1 CONTROL, SYNC OFF, V3 RESTING     "   // row 7
        .text "                                        "   // row 8
        .text "B: V3 NOTE, SAME CALLS                  "   // row 9
        .text "                                        "   // row 10
        .text "OF 192 CALLS                            "   // row 11
        .text "GATE A        SYNC A        SYNC B      "   // row 12
        .text "MAST A        V3 0 B        V1 A=B      "   // row 13
        .text "                                        "   // row 14
        .text "PLAY CYCLES    WORST BEST               "   // row 15
        .text "A SYNC LEAD                             "   // row 16
        .text "B SLAVE ALONE                           "   // row 17
        .text "                                        "   // row 18
        .text "                                        "   // row 19
        .text "RESULT                                  "   // row 20
        .fill 1000 - 21 * 40, $20

// ---------------------------------------------------------------------------
// Report helpers
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
// Twenty bytes of a log page, from call SHOW, as hex across a row.
.macro HEXROW(page, row) {
        lda #<(page + SHOW)
        sta hx_rd+1
        lda #>(page + SHOW)
        sta hx_rd+2
        lda #<(SCREEN + row * 40)
        sta hx_st+1
        lda #>(SCREEN + row * 40)
        sta hx_st+2
        jsr hexrow
}
// Worst and best play call of a phase: calls under 60 cycles are the
// player's skipped NTSC calls and are left out.
.macro CYCLES(lo, hi, row, col) {
        lda #<lo
        sta cy_lo+1
        lda #>lo
        sta cy_lo+2
        lda #<hi
        sta cy_hi+1
        lda #>hi
        sta cy_hi+2
        jsr cycles
        PUT(worst, row, col)
        PUT(best, row, col + 6)
}

hexrow: ldx #0
        ldy #0
hx_rd:  lda $ffff,x
        pha
        lsr
        lsr
        lsr
        lsr
        jsr hx_dig
        pla
        and #$0f
        jsr hx_dig
        inx
        cpx #20
        bne hx_rd
        rts
hx_dig: cmp #10
        bcc !+
        sbc #9                  // C set: 10-15 to screen codes 1-6 (A-F)
        jmp hx_st
!:      ora #$30
hx_st:  sta $ffff,y
        iny
        rts

cycles: lda #0
        sta worst
        sta worst+1
        lda #$ff
        sta best
        sta best+1
        ldx #0
cy_lo:  lda $ffff,x
        sta cost
cy_hi:  lda $ffff,x
        sta cost+1
        bne !+
        lda cost
        cmp #60
        bcc cy_next             // a skipped NTSC call
!:      lda worst               // worst < cost: worst = cost
        cmp cost
        lda worst+1
        sbc cost+1
        bcs !+
        lda cost
        sta worst
        lda cost+1
        sta worst+1
!:      lda cost                // cost < best: best = cost
        cmp best
        lda cost+1
        sbc best+1
        bcs cy_next
        lda cost
        sta best
        lda cost+1
        sta best+1
cy_next:
        inx
        cpx #LOOP
        bne cy_lo
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

// The verdict: A = 0 PASS, else FAIL, on the result row.
verdict:
        bne vd_fail
        lda #1
        sta RESULT
        ldx #3
!:      lda passtxt,x
        sta SCREEN+ROWRES*40+7,x
        dex
        bpl !-
        lda #5
        sta $d020
        rts
vd_fail:
        lda #2
        sta RESULT
        ldx #3
!:      lda failtxt,x
        sta SCREEN+ROWRES*40+7,x
        dex
        bpl !-
        lda #2
        sta $d020
        rts
passtxt:  .text "PASS"
failtxt:  .text "FAIL"

// Variables
ntsc:   .byte 0
started: .byte 0
phase:  .byte 0             // 0 A logged, 1 B logged, 2 report
alt:    .byte 0             // after the report: 0 A playing, 1 B
fr:     .byte 0             // call within the phase
kc:     .word 0
cost:   .word 0
worst:  .word 0
best:   .word 0
num:    .word 0
pd_t:   .byte 0
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

// One change to the #50 player: a new note's gate goes out before its AD
// and SR (mu_envp), not after them. After the hard restart AD = SR = 0, so
// at the gate's edge every rate period is the shortest and the rate
// counter cannot be past it; AD and SR follow 12 and 24 cycles later. In
// the #50 order (AD, SR, then the gate about 150 cycles later) an attack-0
// note waits for the ADSR bug's counter wrap, about 32,600 cycles: SR's
// release rate runs until the gate, and reSID uses the decay rate for the
// gate's first cycles. Measured in VICE x64sc 3.10 (reSID) by sid-hr-snare
// (#118). -define SR_FIRST restores the #50 order; -define AD_FIRST writes
// AD, then the gate, then SR.
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
        lda #3                  // frequency and control; the pulse width went
        sta mu_upd,x            // out on the frame before (mu_pre)
        lda tn_ad,y
        sta mu_ad,x
        bit mu_skip
        bmi !+
#if SR_FIRST
        sta $d405,x             // the #50 order: AD, SR, then the gate in
        lda tn_sr,y             // mv_out
        sta mu_sr,x
        sta $d406,x
#elif AD_FIRST
        sta $d405,x             // AD, then the gate, then SR
        lda tn_sr,y
        sta mu_sr,x
        lda #1
        sta mu_envp,x
#else
        lda tn_sr,y             // the gate, then AD and SR, in mv_out
        sta mu_sr,x
        lda #1
        sta mu_envp,x
#endif
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

// Priority by effect number; 0 is "none".
fx_pri: .byte 0, 1, 3, 4, 5, 1, 2
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
// The tune: eight notes, E4 G4 A4 B4 D5 B4 A4 G4, four steps of six frames
// each, on voice 1 (the sync lead) and voice 3 (its master). Formats as in
// the music-player recipe: patterns of note $00-$5F (A4 = 57), $60 rest,
// $80 + n instrument, $BF + n duration; order lists of patterns and $FF
// loop; instruments AD, SR, wavetable start, pulse, sweep, vibrato, delay,
// filter program, flags; wavetable rows of waveform and relative note
// (waveform 0 with note $FF holds); filter program 1 of cutoff, speed,
// min, max, $D417, mode.
// ===========================================================================
tn_speed: .byte $06, $06
tn_ordlo: .byte <tn_ord1, <tn_ord2, <tn_ord3
tn_ordhi: .byte >tn_ord1, >tn_ord2, >tn_ord3
tn_patlo: .byte <tn_p0, <tn_p1, <tn_p2
tn_pathi: .byte >tn_p0, >tn_p1, >tn_p2
//        instrument 0: the master (triangle, unheard); 1: the sync lead
tn_ad:    .byte $00, $09
tn_sr:    .byte $f0, $a9
tn_wt:    .byte $00, WT_SYNC
tn_pwl:   .byte $00, $00
tn_pwh:   .byte $80, $80
tn_pws:   .byte $00, $00
tn_vib:   .byte $00, $00
tn_vdel:  .byte $00, $00
tn_flt:   .byte $01, $00        // the master loads filter program 1: 3OFF
tn_flags: .byte $00, $00
// rows 0-1 the master; 2-11 the lead, A; 12-21 the lead, B
tn_wtw:   .byte $10, $00
          .byte SYNCW, SYNCW, SYNCW, SYNCW, SYNCW, SYNCW, SYNCW, SYNCW, SYNCW, $00
          .byte $20, $20, $20, $20, $20, $20, $20, $20, $20, $00
tn_wtn:   .byte $00, $ff
          .byte 12, 14, 17, 19, 22, 24, 26, 27, 29, $ff
          .byte 12, 14, 17, 19, 22, 24, 26, 27, 29, $ff
// filter program 1: no voice filtered, no filter mode, 3OFF, volume 15
tn_fcut:  .byte $00, $00
tn_fspd:  .byte $00, $00
tn_fmin:  .byte $00, $00
tn_fmax:  .byte $00, $00
tn_fres:  .byte $00, $f0
tn_fmode: .byte $00, $80
tn_ord1:  .byte $00, $ff, $00
tn_ord2:  .byte $02, $ff, $00
tn_ord3:  .byte $01, $ff, $00
tn_rest:  .byte $02, $ff, $00
// lead: i=sync E4 G4 A4 B4 D5 B4 A4 G4, 4 steps each
tn_p0:    .byte $81, $c3, $34, $37, $39, $3b, $3e, $3b, $39, $37, $ff
// master: i=master, the same notes
tn_p1:    .byte $80, $c3, $34, $37, $39, $3b, $3e, $3b, $39, $37, $ff
// rest: 32 steps
tn_p2:    .byte $cf, $60, $cf, $60, $ff
```

## Build

```bash
java -jar KickAss.jar sid-sync-lead.asm -o sid-sync-lead.prg
```

KickAssembler 5.25: one assert, 0 failed. The PRG loads at `$0801` and
ends at `$1926`. From the symbol file: harness `$0810`-`$10A4`; player
`$10A5`-`$18A5`; tune `$18A6`-`$1926`. Logs at `$3000`-`$3BFF`, outside
the PRG. No zero page. The player's build switches (`SR_FIRST`,
`AD_FIRST`, and the #50 page's `NO_VIB` and the rest) still apply.

## Expected output

Every figure was measured in VICE x64sc 3.10 (rung 1): the screen from
the exit screenshot, decoded against the character ROM with PIL; the
register trace from the dump sink (`-sound -sounddev dump`); the logs
from a monitor memory dump at the verdict. The program reads no SID
register, so the pinned run is the verifier's default:

```text
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 13000000 [-model ntsc] -exitscreenshot out.png -autostart sid-sync-lead.prg
```

PAL (`screenshots/sid-sync-lead.png`, md5 `ed156c8ea816f167b55bf4c3cc2b18a7`):

```text
SYNC LEAD: V1 SAW+SYNC, V3 MASTER, 3OFF
A: V1 CONTROL, CALLS 04-23
2323232323232323232323232323232323232323
A: V1 NOTE (THE SLAVE), SAME CALLS
404245474A4C4E4F515151515151515151515151
A: V3 NOTE (THE MASTER), SAME CALLS
3434343434343434343434343434343434343434
B: V1 CONTROL, SYNC OFF, V3 RESTING
2121212121212121212121212121212121212121
B: V3 NOTE, SAME CALLS
0000000000000000000000000000000000000000
OF 192 CALLS
GATE A 00174  SYNC A 00174  SYNC B 00000
MAST A 00192  V3 0 B 00192  V1 A=B 00192

PLAY CYCLES    WORST BEST
A SYNC LEAD    01012 00393
B SLAVE ALONE  00967 00357
```

Row 20 reads `RESULT PASS`; the border is green. `-model c64` gives the
same text.

NTSC (`screenshots/sid-sync-lead-ntsc.png`, md5 `b7a46b972fa95eb0044db49b0fc36087`) differs
in the slave row, where a skipped call holds a step for a second call,
and in the cycles:

```text
40404245474A4C4C4E4F51515151515151515151
A SYNC LEAD    01020 00401
B SLAVE ALONE  00975 00365
```

**The rows.** The first note, E4 (`$34`), is gated on call 4. Voice 1's
control byte is `$23`: sawtooth, SYNC, gate. Its note steps `$40 $42 $45
$47 $4A $4C $4E $4F` and holds `$51` (E4 + 29, A6). Voice 3 sits on the
note itself. In B the control byte is `$21` and voice 3 is never given a
note. The counts: SYNC on all 174 gated calls of A and none of B; voice
3's note equals voice 1's pattern note on 192 of 192 calls of A; voice 1's
note stream is the same in A and B on 192 of 192.

**The register trace.** From the dump sink, on PAL (both SID models) and
NTSC: `$D404`, voice 1's frequency and voice 3's frequency equal the
program's log on 192 of 192 calls in each phase. SYNC is set on 188
calls of A (the 174 gated and the 14 hard-restart calls, gate off) and
on none of B. `$D418` becomes `$8F` on call 3 of A, when voice 3's first
note loads the filter program, and `$D417` `$F0` (resonance 15, no voice
routed); in B they stay `$0F` and `$00`. The slave-to-master frequency
ratios, register over register: 2.000, 2.245, 2.669, 2.996, 3.563,
4.000, 4.490, 4.756 and, held, 5.339.

**The fault build.** `-define FORCE_FAULT`: control `$21` in A, `SYNC A
00000`, `RESULT FAIL`, red border, on PAL and NTSC.

**Cycles.** Per call, A minus B, PAL: +36 on 147 calls of 192 (voice
3 holding a note), +57 on 12; for each of voice 3's notes, +112 on the
call that reads it, +99 on its hard restart, +190 on the call before it
(the instrument's set-up) and +292 on its own call; up to +210 around
the first note. Worst +292. Voice 1's code path is the same in
both phases: SYNC is one bit of a byte the wavetable already writes. The
difference is voice 3 playing notes instead of rests. NTSC reads the
same differences and 8 more in every play figure (the player's NTSC
skip counter; `sid-hr-snare`).

**Recordings.** Real time, 44,100 Hz mono (`+warp -sound -sounddev wav
-soundrate 44100 -soundoutput 1 -limitcycles 20000000`), once with
`-model c64` (6581) and once as `-default` (8580); the files are not
committed. Calls are placed from the start-up `music_init`'s `$D418`
click as in `sid-hr-snare`. For each note, ten calls from 10 calls
after its gate (the sweep is over): the fundamental by autocorrelation
(the first lag whose peak is within 10 % of the highest, 60 to 5,000 Hz,
parabolic refinement). Master and slave frequencies are the registers
times the clock over 2^24 (arithmetic).

| Note | Master, Hz | Slave, Hz | A heard, 6581 / 8580 | B heard, 6581 / 8580 |
|---|---|---|---|---|
| E4 | 329.6 | 1,760.0 | 329.5 / 329.5 | 1,760.7 / 1,760.7 |
| G4 | 392.0 | 2,093.0 | 392.0 / 392.0 | 2,094.3 / 2,094.2 |
| A4 | 440.0 | 2,349.4 | 440.2 / 440.2 | 2,345.1 / 2,345.2 |
| B4 | 493.9 | 2,637.0 | 494.1 / 494.1 | 2,631.0 / 2,631.1 |
| D5 | 587.4 | 3,135.9 | 587.5 / 587.5 | 3,138.5 / 3,138.5 |

The last three notes (B4, A4, G4) read as their first appearance, and the
second A and B passes in each file agree with the first. A is at the
master's pitch within 0.1 % on every note; B at the slave's within 0.2 %,
the autocorrelation's lag resolution at 44.1 kHz. Level (RMS over the
same windows, the first seven notes; the eighth's window runs into the
next phase's init): A 1,684 to 1,762 on the 6581 model and 1,276 to
1,334 on the 8580; B 1,550 to 1,628 and 1,240 to 1,300.

## Why this works

**SYNC restarts the slave on the master's cycle.** With SYNC set, voice
1's accumulator is reset each time voice 3's accumulator MSB rises
(`sid-reference.md`, "Oscillator sync"). The output then repeats at voice
3's period, whatever voice 1's frequency; voice 1's frequency decides how
much of its sawtooth ramp plays inside each period, which is the timbre.
Stepping the slave upward while the master holds moves that timbre and
not the pitch: A's heard pitch is the master's on every note, B's is the
slave's.

**The master needs to run, not to be heard.** Sync reads voice 3's
oscillator, which advances whenever its frequency is non-zero and TEST
is clear, gate or no gate (`sid-reference.md`, measured). 3OFF takes
voice 3 off the bypass path; with FILT3 clear that is its only path
(`pitfalls/sid.md`, `sid_voice3_disable_silent_bit`). The tune's filter
program writes `$D417` = `$F0` and `$D418` = `$8F`: no voice filtered,
no filter mode, 3OFF, volume 15.

**The player needs nothing new.** SYNC is bit 1 of the waveform byte the
wavetable already carries (`$22`); the master is a second pattern with
the same notes and a plain instrument; 3OFF is a filter program. The
cost is voice 3's own play work.

## Pitfalls met

`sid_voice3_disable_silent_bit` (3OFF with FILT3 clear),
`sid_adsr_bug_8580` (the lead's attack is 0; the player writes the gate
before AD and SR, #118), `pal_ntsc_tempo_mismatch` (a skipped NTSC call
stretches a wavetable step).

## What it does not establish

- Anything about silicon. On an 8580 R5 with a bypass residual, voice 3
  may leak through 3OFF; reSID models none.
- How it sounds. The figures are pitch, level and register ratios;
  nobody here has listened.
- A sweep by vibrato or a moving master: not built.
