---
recipe: sid-env3-filter
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sid_env3_filter_envelope]
file_formats: [PRG]
uses_registers: [D012, D020, D021, D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418, D41B, D41C, DC04, DC05, DC0D, DC0E, DD0D]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init)]
harness: [cia1_timer_a, $02FF]
ram: [colour=$D800-$DBE7]
---

<!-- doc-type: recipe -->

# KickAssembler — The ENV3 filter envelope: voice 3's ADSR drives the cutoff

Verified on: VICE x64sc 3.10, the `--enable-headlessui` build that
`npm run vice:headless` makes under `.tools/vice-headless`, reSID; PAL
c64c (8565, 8580, 8521) as `-default` and with `-sidenginemodel 256`
(6581); NTSC (`-model ntsc`: 6567R8, 6581, 6526) as is and with
`-sidenginemodel 257` (8580). KickAssembler 5.25. 2026-09-23. Canonical
name `kickassembler-sid-env3-filter`. The pinned pictures are of the
listing on this page, which is the build's four sources folded into one
file (see Source); they replace the build's own pictures, which had the
KB harness's frame meter assembled in and differ from these in row 24
and in cycle figures that moved by up to four cycles with the layout
(see Expected output).

## Synopsis

A two-voice phrase, a pulse lead on voice 1 and a sawtooth bass on voice
2, both through the low-pass filter, played by the #50 full player (order
lists, patterns, instruments, hard restart, filter programs). Voice 3
gives up its sound to be the filter's envelope: the lead's notes gate it,
with 3OFF set and FILT3 clear, and every frame the player writes `$D416` =
(`$D41C` >> 1) + base, so the cutoff has the chip's own attack, staged
decay, sustain and release. The program plays the tune's 192-frame loop
three times: A with the mechanism on, B with voice 3 still gated but the
copy disabled (the cutoff stays at the base), C with no envelope at all.
For every frame of every phase it logs ENV3 as the player read it, the
cutoff it wrote, the play call's cycles from a CIA1 bracket, and ENV3 as
the harness reads it after the call. After phase C it checks the identity
byte by byte and grades itself: `$02FF` = `$01` and a green border on
PASS, `$02` and red on FAIL. `-define FORCE_FAULT` removes the shift from
the copy, so the identity fails. The technique is
`sid_env3_filter_envelope` in `techniques/sid-instruments.md`.

## Source

One listing, in three parts. The first is the harness around the player:
the frame loop, the CIA1 stopwatch, the log, the verdict and the readout.
The second is the #50 full player (order lists, patterns, instruments,
hard restart, filter programs) with filter kind 2 added; every change from
its base is marked `kind 2` or `copy:` in a comment. The third is the
tune's tables, compiled from the phrase in the Python block after the
listing by the build's tune compiler (in the build's record); the tune's
three constants sit at the top of the file because the harness's
constants use them.

The build was four source files plus the KB harness's frame meter; this
page folds them into one file so the verifier can build it from the page.
Two things changed in the fold, neither of them in the player or the
tune: the frame meter's import and its four macro calls are gone (the
CIA1 stopwatch is the recipe's own instrument and stays), and the four
digits the verdict's `WorstDelta` macro prints while finding a maximum go
to four bytes of RAM (`scratch`) instead of screen row 24, which the
meter used to share. The build's pictures show the meter's readout and a
stray `1026` in row 24; this page's pictures do not.

```asm
// sid-env3-filter.asm: the ENV3 filter envelope, measured. c64-kb technique
// sid_env3_filter_envelope, recipe kickassembler-sid-env3-filter.
//
// Voice 3 gives up its sound to be the filter's envelope: the lead's notes
// gate it (3OFF set, FILT3 clear) and every frame the player writes
// $D416 = ($D41C >> 1) + base. The #50 player (the second part of this file)
// does the work; the first part is the harness around it: a raster-synced
// loop calling the player once a frame from line 250, a CIA1 stopwatch
// around every call, and a log of three phases of the tune's 192-frame loop:
//   A  the mechanism on;
//   B  voice 3 still gated but the copy disabled (the cutoff stays at base);
//   C  no envelope at all (the plain player, a static cutoff at base).
// Per frame and phase it logs ENV3 as read, the cutoff as written, and the
// play call's cycles. After phase C it grades itself: PASS when every one
// of phase A's frames satisfies cutoff == (ENV3 >> 1) + base, every one of
// phase B's cutoffs is the base, and the first note's ENV3 rises to $FF,
// holds at the sustain level and reaches zero in the rest after it. $02FF
// = $01 and a green border on PASS, $02 and red on FAIL. (The rise's peak
// is graded at $F0 or more: a once-a-frame sample never lands on the moment
// the attack reaches $FF, because the decay has begun by the next read.)
// -define FORCE_FAULT removes the shift from the copy (in the player), so
// the identity fails. -define WAV_ON / WAV_OFF fix the mode for a sound
// recording and skip the phases and the verdict.
//
// Readout (rows): 2-4 ENV3 of phase A's first 60 frames in hex, 6-8 the
// cutoff written on the same frames, 10-12 phase B's cutoff on the same
// frames, 13 the counts, 14 the envelope's shape, 16-20 the play call's
// cycles per phase and their differences, 21 the stopwatch's own cost,
// the SID detection byte and the base, 22 RESULT.
//
// The pinned VICE run must have a real sound sink: with +sound or
// -sounddev dummy, $D41C does not return the envelope (measured; see the
// page's Expected output).
// Build: java -jar KickAss.jar sid-env3-filter.asm -o sid-env3-filter.prg

// The tune's constants, compiled with the tables at the end of this file
// from the phrase on the page: frames a loop, the filter base, the sustain
// level ENV3 holds at.
.const TN_FRAMES = 192
.const TN_ENV_BASE = $20
.const TN_ENV_SUS = $22

.encoding "screencode_upper"

.const SCREEN      = $0400
.const COLOUR      = $d800
.const RESULT      = $02ff             // $01 pass, $02 fail, $00 not reached
.const LINE        = 250               // below the last badline, PAL and NTSC
.const LOG_E3      = $3000             // + phase page: ENV3 as read, per frame
.const LOG_CUT     = $3300             // the cutoff written
.const LOG_CLO     = $3600             // play call cycles, low byte
.const LOG_CHI     = $3900             // high byte
.const LOG_HE3     = $3c00             // ENV3 read by this harness after the call: the
                                       // player's read (LOG_E3) exists only while the
                                       // copy runs, so phases B and C need this one
.const PHASES      = 3
.const N           = TN_FRAMES         // frames a loop = frames a phase (tune.asm)
.const IDX_NOTE    = 1                 // log index of the first note's step frame
.const IDX_PLAIN   = 20                // a frame with no event on any voice
.const IDX_RESTART = 95                // the hard-restart frame before the second note
.const NOTE_FRAMES = 72                // the first note: 12 steps of 6 frames
.const REST_FRAMES = 24                // the rest after it
.const HOLD_MIN    = 16                // frames at the sustain level the verdict wants

.errorif N > 255, "a phase must fit one index byte"
.errorif IDX_NOTE + NOTE_FRAMES + REST_FRAMES > N, "the shape checks run past the phase"

BasicUpstart2(start)

start:
        sei
        lda #$7f
        sta $dc0d                      // no CIA interrupts: CIA1 timer A is the stopwatch
        sta $dd0d
        lda $dc0d
        lda $dd0d
        ldx #0
!:      lda #$20
        sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$2e8,x
        lda #1
        sta COLOUR,x
        sta COLOUR+$100,x
        sta COLOUR+$200,x
        sta COLOUR+$2e8,x
        inx
        bne !-
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
        inx
        bne !-
!:      lda labels+$300,x
        sta SCREEN+$300,x
        inx
        cpx #labels_end - labels - $300
        bne !-
        // Which SID model is emulated: music-sid.md, sid_8580_vs_6581_differences
        // (VICE 3.10 reSID reads 3 for the 6581 model and 2 for the 8580 model).
        lda #$ff
        sta $d412
        sta $d40e
        sta $d40f
        lda #$20
        sta $d412
        lda $d41b
        sta detect
        // The player: A = 0 PAL, 1 NTSC. $02A6 is 1 on PAL and 0 on NTSC
        // (set by the KERNAL at reset).
        lda $02a6
        eor #1
        and #1
        jsr music_init
#if WAV_ON
        lda #2                         // mode A for the whole recording
        sta mu_emask
        sta mu_vmask
        lda #1
        sta done
#endif
#if WAV_OFF
        lda #0                         // mode B: voice 3 gated, the copy off
        sta mu_emask
        lda #2
        sta mu_vmask
        lda #1
        sta done
#endif
        jsr calibrate

// ---------------------------------------------------------------------------
// Frame loop: one play call a frame from line 250. NTSC skips one call in
// six inside the player; that call is made but not timed or logged.
// ---------------------------------------------------------------------------
loop:
!:      lda $d012
        cmp #LINE
        beq !-
!:      lda $d012
        cmp #LINE
        bne !-
        lda mu_ntsc
        beq lp_run
        lda mu_ncnt                    // 0 before the call: the player will skip it
        bne lp_run
        jsr music_play
        jmp lp_end
lp_run:
        jsr timed_play
        inc tick
        bne !+
        inc tick+1
!:      lda done
        bne lp_end
        lda tick+1
        bne lp_log
        lda tick
        cmp #4                         // calls 1 to 3 are before the first filter load
        bcc lp_end
lp_log: ldx idx
        lda mu_e3
st_e3:  sta LOG_E3,x
        lda mu_fcut
st_cut: sta LOG_CUT,x
        lda cost
st_clo: sta LOG_CLO,x
        lda cost+1
st_chi: sta LOG_CHI,x
        lda $d41c                      // the envelope now, a few hundred cycles after
st_he3: sta LOG_HE3,x                  // the player's own read
        inx
        cpx #N
        bne lp_idx
        ldx #0                         // the phase is over: next page, next masks
        inc phase
        lda phase
        cmp #PHASES
        beq lp_verd
        inc st_e3+2
        inc st_cut+2
        inc st_clo+2
        inc st_chi+2
        inc st_he3+2
        tay
        lda emask_tab,y                // the next loop's first filter load reads these
        sta mu_emask
        lda vmask_tab,y
        sta mu_vmask
        jmp lp_idx
lp_verd:
        jsr verdict
        lda #1
        sta done
        ldx #0
lp_idx: stx idx
lp_end:
        jmp loop

emask_tab: .byte 2, 0, 0               // A: copy on;  B: off; C: off
vmask_tab: .byte 2, 2, 0               // A: gated;    B: gated; C: not gated

// ---------------------------------------------------------------------------
// Stopwatch: CIA1 timer A, one-shot from $FFFF, as in the sfx-in-player
// recipe. cost = the play call including its JSR and RTS, net of the
// bracket's own start and stop (calib).
// ---------------------------------------------------------------------------
calibrate:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001                 // force load, one-shot, start
        sta $dc0e
        lda #0
        sta $dc0e                      // stop
        sec
        lda #$ff
        sbc $dc04
        sta calib
        lda #$ff
        sbc $dc05
        sta calib+1
        rts

timed_play:
        lda #$ff
        sta $dc04
        sta $dc05
        lda #%00011001
        sta $dc0e
        jsr music_play
        lda #0
        sta $dc0e
        sec
        lda #$ff
        sbc $dc04
        sta cost
        lda #$ff
        sbc $dc05
        sta cost+1
        sec
        lda cost
        sbc calib
        sta cost
        lda cost+1
        sbc calib+1
        sta cost+1
        rts

// ---------------------------------------------------------------------------
// The verdict, after phase C: counts, shape, costs, text, $02FF, border.
// ---------------------------------------------------------------------------
verdict:
        // 1. identity, phase A: cutoff == (ENV3 >> 1) + base on every frame
        lda #0
        sta identa
        sta flatb
        sta samee3
        ldx #0
v1:     lda LOG_E3,x
        lsr
        clc
        adc #TN_ENV_BASE
        cmp LOG_CUT,x
        bne !+
        inc identa
!:      lda LOG_CUT+$100,x             // 2. flat, phase B: cutoff == base
        cmp #TN_ENV_BASE
        bne !+
        inc flatb
!:      lda LOG_HE3,x                  // ENV3 the same in A and B (information):
        cmp LOG_HE3+$100,x             // the harness's own reads, one sampling point
        bne !+
        inc samee3
!:      inx
        cpx #N
        bne v1
        // 3. the rise: strictly increasing steps from the note frame
        ldx #IDX_NOTE
v3:     cpx #N-1
        beq v3_end
        lda LOG_E3+1,x
        cmp LOG_E3,x
        beq v3_end
        bcc v3_end
        inx
        jmp v3
v3_end: lda LOG_E3,x
        sta peak
        txa
        sec
        sbc #IDX_NOTE
        sta rise
        // 4. the sustain plateau: the longest run at TN_ENV_SUS inside the first note
        lda #0
        sta run
        sta hold
        ldx #IDX_NOTE
v4:     lda LOG_E3,x
        cmp #TN_ENV_SUS
        bne v4_z
        inc run
        lda run
        cmp hold
        bcc v4_n
        sta hold
        jmp v4_n
v4_z:   lda #0
        sta run
v4_n:   inx
        cpx #IDX_NOTE + NOTE_FRAMES
        bne v4
        // 5. the release: the first frame in the rest where ENV3 is zero
        lda #$ff
        sta zeroat
        ldx #IDX_NOTE + NOTE_FRAMES
v5:     lda LOG_E3,x
        bne !+
        stx zeroat
        jmp v5_end
!:      inx
        cpx #IDX_NOTE + NOTE_FRAMES + REST_FRAMES
        bne v5
v5_end:
        // the readout
        HexRows(LOG_E3, SCREEN + 40*2)
        HexRows(LOG_CUT, SCREEN + 40*6)
        HexRows(LOG_CUT + $100, SCREEN + 40*10)
        Dec3(nval, SCREEN + 40*1 + 35)
        Dec3(identa, SCREEN + 40*13 + 8)
        Dec3(nval, SCREEN + 40*13 + 12)
        Dec3(flatb, SCREEN + 40*13 + 23)
        Dec3(nval, SCREEN + 40*13 + 27)
        Dec3(samee3, SCREEN + 40*13 + 37)
        Hex2(rise, SCREEN + 40*14 + 5)
        Hex2(peak, SCREEN + 40*14 + 13)
        Hex2(susval, SCREEN + 40*14 + 21)
        Dec3(hold, SCREEN + 40*14 + 25)
        Dec3(zeroat, SCREEN + 40*14 + 37)
        .for (var p = 0; p < 3; p++) {
            Worst(p, SCREEN + 40*(16+p) + 16)
            Dec4(LOG_CLO + p*256 + IDX_PLAIN, LOG_CHI + p*256 + IDX_PLAIN, SCREEN + 40*(16+p) + 22)
            Dec4(LOG_CLO + p*256 + IDX_NOTE, LOG_CHI + p*256 + IDX_NOTE, SCREEN + 40*(16+p) + 28)
            Dec4(LOG_CLO + p*256 + IDX_RESTART, LOG_CHI + p*256 + IDX_RESTART, SCREEN + 40*(16+p) + 34)
        }
        .for (var q = 1; q < 3; q++) {
            WorstDelta(q, SCREEN + 40*(18+q) + 15)
            Delta(q, IDX_PLAIN, SCREEN + 40*(18+q) + 21)
            Delta(q, IDX_NOTE, SCREEN + 40*(18+q) + 27)
            Delta(q, IDX_RESTART, SCREEN + 40*(18+q) + 33)
        }
        Dec4(calib, calib+1, SCREEN + 40*21 + 10)
        Hex2(detect, SCREEN + 40*21 + 27)
        Hex2(baseval, SCREEN + 40*21 + 37)
        // the grade
        lda identa
        cmp #N
        bne fail
        lda flatb
        cmp #N
        bne fail
        lda rise
        cmp #3
        bcc fail
        lda peak                       // a once-a-frame sample misses the moment at
        cmp #$f0                       // $FF: the decay has begun by the next read
        bcc fail                       // (PAL reads $FB, NTSC $FE; measured)
        lda hold
        cmp #HOLD_MIN
        bcc fail
        lda zeroat
        cmp #$ff
        beq fail
        lda #1
        sta RESULT
        lda #5
        sta $d020
        ldx #0
        jmp say
fail:   lda #2
        sta RESULT
        sta $d020
        ldx #pass_end - pass
say:    ldy #0
!:      lda pass,x
        sta SCREEN + 40*22,y
        inx
        iny
        cpy #pass_end - pass
        bne !-
        rts

pass:   .text "RESULT 01 PASS"
pass_end:
        .text "RESULT 02 FAIL"

// ---- print helpers ----------------------------------------------------------
// 60 bytes from hd_src as hex, 120 cells from hd_dst: three 40-cell rows.
hexrows:
        lda #0
        sta hd_i
hd_l:   ldx hd_i
hd_src: lda $ffff,x
        sta hd_v
        lsr
        lsr
        lsr
        lsr
        tay
        lda hexdig,y
        sta hd_c
        txa
        asl
        tay
        lda hd_c
hd_dst: sta $ffff,y
        lda hd_v
        and #$0f
        tax
        lda hexdig,x
        iny
hd_dst2: sta $ffff,y
        inc hd_i
        lda hd_i
        cmp #60
        bne hd_l
        rts

.macro HexRows(src, dst) {
        lda #<src
        sta hd_src+1
        lda #>src
        sta hd_src+2
        lda #<dst
        sta hd_dst+1
        sta hd_dst2+1
        lda #>dst
        sta hd_dst+2
        sta hd_dst2+2
        jsr hexrows
}

// pd_v (16 bits, under 10000) as four decimal digits from pd_dst (Y = 0),
// or three from pd_dst + 1 (Y = 1, the caller sets pd_dst one cell early).
putdec4:
        ldy #0
        beq pd_dig
putdec3:
        ldy #1
pd_dig: lda #$30
        sta pd_d
pd_sub: lda pd_v
        cmp p10_lo,y
        lda pd_v+1
        sbc p10_hi,y
        bcc pd_out
        sta pd_v+1
        lda pd_v
        sbc p10_lo,y
        sta pd_v
        inc pd_d
        jmp pd_sub
pd_out: lda pd_d
pd_dst: sta $ffff,y
        iny
        cpy #3
        bne pd_dig
        lda pd_v
        ora #$30
pd_dst2: sta $ffff,y
        rts
p10_lo: .byte <1000, <100, <10
p10_hi: .byte >1000, >100, >10

.macro DecAt(dst, three) {
        lda #<(dst - three)
        sta pd_dst+1
        sta pd_dst2+1
        lda #>(dst - three)
        sta pd_dst+2
        sta pd_dst2+2
        .if (three != 0) { jsr putdec3 } else { jsr putdec4 }
}
.macro Dec4(lo, hi, dst) {
        lda lo
        sta pd_v
        lda hi
        sta pd_v+1
        DecAt(dst, 0)
}
.macro Dec3(src, dst) {
        lda src
        sta pd_v
        lda #0
        sta pd_v+1
        DecAt(dst, 1)
}
// the largest cost in phase p, as four digits
.macro Worst(p, dst) {
        lda #0
        sta pd_v
        sta pd_v+1
        ldx #0
    !w:  lda LOG_CHI + p*256,x
        cmp pd_v+1
        bcc !s+
        bne !n+
        lda LOG_CLO + p*256,x
        cmp pd_v
        bcc !s+
    !n:  lda LOG_CLO + p*256,x
        sta pd_v
        lda LOG_CHI + p*256,x
        sta pd_v+1
    !s:  inx
        cpx #N
        bne !w-
        lda pd_v                       // keep the maximum: the digit printer
        sta wmax                       // consumes pd_v
        lda pd_v+1
        sta wmax+1
        DecAt(dst, 0)
}
// pd_v = cost A - cost q on frame idx, printed as a sign and four digits
.macro Delta(q, idx, dst) {
        sec
        lda LOG_CLO + idx
        sbc LOG_CLO + q*256 + idx
        sta pd_v
        lda LOG_CHI + idx
        sbc LOG_CHI + q*256 + idx
        sta pd_v+1
        SignAt(dst)
        DecAt(dst + 1, 0)
}
// worst A - worst q: the two worst frames found again, then subtracted
.macro WorstDelta(q, dst) {
        Worst(0, scratch)              // printed into scratch RAM: only wmax is wanted
        lda wmax
        sta wa
        lda wmax+1
        sta wa+1
        Worst(q, scratch)
        sec
        lda wa
        sbc wmax
        sta pd_v
        lda wa+1
        sbc wmax+1
        sta pd_v+1
        SignAt(dst)
        DecAt(dst + 1, 0)
}
// the sign of pd_v into a cell; pd_v made positive
.macro SignAt(dst) {
        lda pd_v+1
        bpl !p+
        sec
        lda #0
        sbc pd_v
        sta pd_v
        lda #0
        sbc pd_v+1
        sta pd_v+1
        lda #'-'
        bne !w+
    !p:  lda #'+'
    !w:  sta dst
}

puthex2:
        lda hx_v
        lsr
        lsr
        lsr
        lsr
        tax
        lda hexdig,x
hx_dst: sta $ffff
        lda hx_v
        and #$0f
        tax
        lda hexdig,x
hx_dst2: sta $ffff
        rts
.macro Hex2(src, dst) {
        lda src
        sta hx_v
        lda #<dst
        sta hx_dst+1
        lda #<(dst+1)
        sta hx_dst2+1
        lda #>dst
        sta hx_dst+2
        lda #>(dst+1)
        sta hx_dst2+2
        jsr puthex2
}

hexdig: .text "0123456789ABCDEF"

// ---- screen text: 23 rows of 40 -------------------------------------------
labels:
        .text "ENV3 FILTER ENVELOPE  V3 ADSR TO $D416  "   // row 0
        .text "A: ENV3 PER FRAME, FRAMES 00-59 OF 000  "   // row 1
        .fill 120, $20                                     // rows 2-4
        .text "A: $D416 WRITTEN, SAME FRAMES           "   // row 5
        .fill 120, $20                                     // rows 6-8
        .text "B: $D416 WITH THE COPY OFF, SAME FRAMES "   // row 9
        .fill 120, $20                                     // rows 10-12
        .text "IDENT A 000/000 FLAT B 000/000 E3A=B 000"   // row 13
        .text "RISE 00 PEAK 00 HOLD 00 X000 ZERO AT 000"   // row 14
        .text "PLAY CYCLES    WORST PLAIN  NOTE  RSTRT "   // row 15
        .text "A ENV ON                                "   // row 16
        .text "B COPY OFF                              "   // row 17
        .text "C NO ENVELOPE                           "   // row 18
        .text "A-B                                     "   // row 19
        .text "A-C                                     "   // row 20
        .text "STOPWATCH 0000  SID DETECT 00  BASE $00 "   // row 21
        .text "RESULT                                  "   // row 22
labels_end:
.errorif labels_end - labels != 920, "the label block is not 23 rows of 40"

// ---- variables ------------------------------------------------------------
tick:    .word 0                       // play calls that ran
idx:     .byte 0                       // log index inside the phase
phase:   .byte 0
done:    .byte 0
cost:    .word 0
calib:   .word 0
detect:  .byte 0
identa:  .byte 0
flatb:   .byte 0
samee3:  .byte 0
rise:    .byte 0
peak:    .byte 0
run:     .byte 0
hold:    .byte 0
zeroat:  .byte 0
wa:      .word 0
wmax:    .word 0
nval:    .byte N
susval:  .byte TN_ENV_SUS
baseval: .byte TN_ENV_BASE
hd_i:    .byte 0
hd_v:    .byte 0
hd_c:    .byte 0
pd_v:
pd_v0:   .word 0
pd_d:    .byte 0
hx_v:    .byte 0
scratch: .fill 4, 0                    // WorstDelta's digits go here, not on screen

// ---- the player -----------------------------------------------------------
// The #50 full player (INTERCEPTOR's sound.asm, 2026-09-23, from the
// build's record), with
// filter kind 2 added: the ENV3 filter envelope (c64-kb technique
// sid_env3_filter_envelope). Every change from the base is marked "kind 2"
// or "copy:" in a comment. Effects (sfx_request) are kept from the base and
// unused by this recipe; an effect and the envelope cannot share voice 3.
//
// API, unchanged from the base:
//   music_init   A = 0 PAL, 1 NTSC. Builds the frequency table for that
//                clock, silences the SID, starts the tune from its top.
//   music_play   once a frame. Uses A, X, Y; no zero page.
//   sfx_request  A = effect number. Keeps X and Y. Call with interrupts off.
//   sfx_taken    byte: effects started.
//
// Kind 2, the ENV3 filter envelope (a filter program whose tn_fmode has
// bit 1 set; the tune compiler writes it from a filter entry with env=(ad, sr) and
// base):
//   - the voice whose instrument carries the program is the lead. On its
//     note frame the player writes voice 3's AD and SR from the filter table
//     and gates voice 3 ($D412 = $11) together with the lead; on the lead's
//     hard restart (two frames before a note) voice 3 gets AD = SR = 0 and
//     its gate cleared too; on the lead's rest voice 3's gate is cleared.
//     Voice 3's frequency is never written, so its oscillator stands at
//     zero; $D418 bit 7 (3OFF) comes from the filter's mode byte and FILT3
//     is masked off in $D417 while the envelope owns the voice, as it is
//     while an effect does (pitfall sid_voice3_disable_silent_bit).
//   - every frame, in the filter section: $D416 = ($D41C >> 1) + base. The
//     byte read is kept in mu_e3 and the byte written in mu_fcut, so a
//     harness can log both. FORCE_FAULT (KickAssembler -define) drops the
//     shift, so the identity a harness checks fails.
//   - voice 3's music path writes nothing while the envelope owns it (the
//     mu_skip mechanism effects use); its pattern should be rests.
//   - mu_emask and mu_vmask (default 2 each) let a harness switch the copy
//     and the gating off at the next filter-program load: with mu_emask 0
//     the program runs as a static cutoff at base; with mu_vmask 0 voice 3
//     is not gated at all.
//
// Two corrections to the base, both one instruction:
//   - copy: the NTSC skip counter reloads 5, not 4, so one call in six is
//     skipped as the base's comment and tempo arithmetic say (its code
//     skipped one in five, and its own notes measured 20.0 % of calls).
//   - copy: the pulse-width sweep added the frame-parity test's result to
//     the width instead of the sweep (found by the MEASURED demo's port,
//     in the build's record); `lda mu_pws,x` restored after the test.
//
// The player (base):
//   - an order list per voice: pattern numbers, transposes, a loop;
//   - patterns: notes, rest, tie, instrument and duration commands;
//   - instruments: AD, SR, a wavetable (waveform and note per frame:
//     arpeggios, and absolute notes for drums), pulse width and sweep,
//     vibrato depth, speed and delay, a filter program, legato;
//   - hard restart two frames before every note that is not legato;
//   - one filter program at a time: a cutoff sweep that stops or bounces
//     (kind 1), or voice 3's envelope (kind 2);
//   - two speeds (frames a step) that alternate: swing when unequal.
//
// Cost control: writes go straight to the SID, no shadow copy; a voice whose
// wavetable holds and has no vibrato writes nothing; the three voices read
// their next event on three different frames (4, 3 and 2 frames before the
// step), so pattern and order list reads never pile up. Speeds must be 5 or
// more for that; the tune compiler checks.
//
// On NTSC one call in six is skipped, so the tune keeps its PAL tempo
// (pitfall pal_ntsc_tempo_mismatch), and the NTSC frequency table keeps it
// in tune.

.const PAL_CLOCK  = 985248

.const NTSC_CLOCK = 1022727

// ---- per-voice state -------------------------------------------------------
// X = 0, 7 or 14 indexes both the SID ($D400,X) and this state: each field
// is three bytes seven apart, and five 21-byte blocks hold 35 fields.
#if MUSIC_HIGHRAM
.label mu_s0 = MUSIC_RAM
.label mu_flo = MUSIC_RAM + 105
.label mu_fhi = MUSIC_RAM + 105 + 96
#else
mu_s0: .fill 105, 0
#endif
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
mu_ncnt:  .byte 5           // NTSC skip counter (copy: 5, one call in six)
mu_tick:  .byte 0           // frames left in this step
mu_step:  .byte 0           // 1 on the frame a step starts
mu_sidx:  .byte 0           // which of the two speeds this step uses
mu_skip:  .byte 0           // bit 7: the voice being processed is not the music's
mu_fmask: .byte $ff         // $FB while an effect or the envelope owns voice 3
mu_fprog: .byte 0           // filter program running (0 none)
mu_fcut:  .byte 0           // $D416 as written
mu_fspd:  .byte 0           // cutoff change per frame, signed
mu_fmin:  .byte 0
mu_fmax:  .byte 0
mu_fbnc:  .byte 0           // 1: bounce between min and max, 0: stop
mu_fres:  .byte 0           // $D417: resonance and routing (0: filter off)
mu_fmode: .byte 0           // $D418 high nibble
mu_fenv:  .byte 0           // kind 2: nonzero, the cutoff is voice 3's envelope
mu_fv3:   .byte 0           // kind 2: nonzero, voice 3 is gated with the lead
mu_fvx:   .byte $ff         // kind 2: X (0, 7, 14) of the lead voice
mu_fbase: .byte 0           // kind 2: added to ENV3 >> 1
mu_fad:   .byte 0           // kind 2: voice 3's AD and SR
mu_fsr:   .byte 0
mu_e3:    .byte 0           // kind 2: the ENV3 byte read this frame
mu_emask: .byte 2           // kind 2: a harness clears bit 1 to switch the copy off
mu_vmask: .byte 2           // kind 2: a harness clears bit 1 to leave voice 3 ungated
mu_tmp:   .byte 0
mu_par:   .byte 0           // frame parity, for the pulse sweeps
mu_endpat:.byte $ff         // an empty pattern: the first read goes to the order list
mu_ftktab: .byte 2, 3, 4    // the tick each voice reads its next event on

sfx_pending: .byte 0        // effect requested since the last play
sfx_num:     .byte 0        // effect on voice 3, 0 = none
sfx_pos:     .byte 0        // next byte of its data
sfx_taken:   .byte 0        // effects started

#if !MUSIC_HIGHRAM
mu_flo: .fill 96, 0         // frequency table, built by music_init
mu_fhi: .fill 96, 0
#endif

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
        sta mu_fenv             // kind 2
        sta mu_fv3
        sta mu_e3
        lda #$ff
        sta mu_fvx
        lda #$0f
        sta $d418
        lda #5                  // first reads in 1 to 3 frames, first notes in 5
        sta mu_tick
        sta mu_ncnt             // copy: one NTSC call in six
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
        lda #5                  // every sixth NTSC frame: nothing moves (copy: 5)
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
#if SOLO
        lda #(cmdLineVars.get("solo").asNumber() & 1) == 0 ? $80 : 0      // debug: only the voices in SOLO
        sta mu_skip
#endif
        ldx #0
        jsr mu_voice
#if SOLO
        lda #(cmdLineVars.get("solo").asNumber() & 2) == 0 ? $80 : 0
        sta mu_skip
#endif
        ldx #7
        jsr mu_voice
        lda #$ff
        ldx sfx_num             // an effect, or the envelope (kind 2), owns voice 3:
        bne mp_own              // its music path writes nothing and FILT3 is masked off
        ldx mu_fv3
        beq !+
mp_own: lda #$80
        sta mu_skip
        lda #$fb
!:      sta mu_fmask
#if SOLO
        lda #(cmdLineVars.get("solo").asNumber() & 4) == 0 ? $80 : 0
        sta mu_skip
#endif
        ldx #14
        jsr mu_voice
        // filter program
        lda mu_fres
        beq mp_ret
        lda mu_fenv             // kind 2: the cutoff is voice 3's envelope
        bne mf_env
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
        jmp mf_r
        // Kind 2 (sid_env3_filter_envelope): $D416 = (ENV3 >> 1) + base.
        // LDA abs 4, STA abs 4, LSR 2, CLC 2, ADC abs 4, STA abs 4, STA abs 4:
        // 24 cycles, of which the two stores to mu_e3 and mu_fcut (8) exist
        // for a harness to read; the mechanism alone is 14 with an immediate
        // base, 16 with one in memory (instruction table).
mf_env: lda $d41c
        sta mu_e3
#if FORCE_FAULT
        // the fault build: no shift, so the identity a harness checks fails
#else
        lsr
#endif
        clc
        adc mu_fbase
        sta mu_fcut
        sta $d416
mf_r:   lda mu_fres
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
        lda mu_pws,x            // copy: the base added the parity result here
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
// AD = SR = 0, written here (three stores, not the whole voice). Kind 2:
// the lead's restart is voice 3's too, three more stores.
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
        cpx mu_fvx              // kind 2
        bne mh_ret
        lda mu_fv3
        beq mh_ret
        lda #0
        sta $d413
        sta $d414
        lda #$10
        sta $d412
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
        cpx mu_fvx              // kind 2: the lead's rest releases voice 3
        bne ms_ret
        lda mu_fv3
        beq ms_ret
        lda #$10
        sta $d412
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
        cpx mu_fvx              // kind 2: the lead's note gates voice 3 with
        bne ms_ret              // the filter table's AD and SR (12 cycles of
        lda mu_fv3              // stores, 22 with the loads and the test)
        beq ms_ret
        lda mu_fad
        sta $d413
        lda mu_fsr
        sta $d414
        lda #$11                // triangle + GATE; the frequency stays 0
        sta $d412
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
        lda tn_fmode,y
        and #1
        sta mu_fbnc
        lda tn_fmode,y
        and #$f0
        sta mu_fmode
        lda tn_fmode,y          // kind 2: bit 1 of the mode byte, under the
        and mu_emask            // harness masks
        sta mu_fenv
        lda tn_fmode,y
        and mu_vmask
        sta mu_fv3
        lda tn_fcut,y
        sta mu_fbase
        lda tn_fad,y
        sta mu_fad
        lda tn_fsr,y
        sta mu_fsr
        stx mu_fvx              // this voice is the lead
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

// Priority by effect number; 0 is "none". The base's six effects are kept
// so the player is the #50 player; this recipe requests none.
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

// ---- the tune (tables compiled from the phrase on the page) ---------------
// env3 phrase: tables compiled from the phrase on the page; do not edit here.
tn_speed: .byte $06, $06
tn_ordlo: .byte <tn_ord1, <tn_ord2, <tn_ord3
tn_ordhi: .byte >tn_ord1, >tn_ord2, >tn_ord3
tn_patlo: .byte <tn_p0, <tn_p1, <tn_p2
tn_pathi: .byte >tn_p0, >tn_p1, >tn_p2
tn_ad: .byte $08, $09
tn_sr: .byte $a8, $69
tn_wt: .byte $02, $04
tn_pwl: .byte $00, $00
tn_pwh: .byte $08, $80
tn_pws: .byte $00, $00
tn_vib: .byte $00, $00
tn_vdel: .byte $00, $00
tn_flt: .byte $81, $00
tn_flags: .byte $00, $00
tn_wtw: .byte $10, $00, $40, $00, $20, $00
tn_wtn: .byte $00, $ff, $00, $ff, $00, $ff
tn_fcut: .byte $00, $20
tn_fspd: .byte $00, $00
tn_fmin: .byte $00, $00
tn_fmax: .byte $00, $00
tn_fres: .byte $00, $a3
tn_fmode: .byte $00, $92
tn_fad: .byte $00, $8a
tn_fsr: .byte $00, $28
tn_ord1: .byte $00, $ff, $00
tn_ord2: .byte $01, $ff, $00
tn_ord3: .byte $02, $ff, $00
// lead
tn_p0: .byte $80, $cb, $2d, $c3, $60, $c1, $30, $32, $c3, $34, $c1, $32, $30, $60, $2b, $ff
// bass
tn_p1: .byte $81, $c3, $15, $15, $15, $15, $18, $1a, $c1, $1c, $1c, $c3, $13, $ff
// rest
tn_p2: .byte $df, $60, $ff
.errorif * > LOG_E3, "the program has grown into the log pages"
```

The phrase the tune's tables were compiled from, in the compiler's
notation (note names with lengths in steps, `i=` an instrument, `r` a
rest):

```python
"""The phrase for the ENV3 filter-envelope recipe, compiled by mkmusic.py.

Voice 1: a pulse lead through the filter, whose notes gate voice 3's
envelope (filter program 'env', kind 2). Voice 2: a sawtooth bass through
the same filter. Voice 3: rests only; the player owns it as the filter's
envelope while 'env' runs.

Speed 6 frames a step, 32 steps a loop: 192 frames a loop (PAL 3.83 s).
The lead's first note lasts 12 steps (72 frames) so the envelope's attack,
staged decay and sustain plateau all fall inside it; the 4-step rest after
it shows the release.

Filter envelope (sid-reference.md ADSR table): attack 8 (100 ms nominal,
about 5 PAL frames), decay 10 (500 ms base period), sustain 2 (ENV3 holds
at $22), release 8 (300 ms nominal). Base $20: the cutoff moves between
$20 and $9F.
"""

TUNE = dict(
    name='env3 phrase',
    speed=(6, 6),
    instruments={
        # pulse, width $800, no sweep: the only thing that moves is the filter
        'lead': dict(ad=0x08, sr=0xa8, wave=[(0x41, 0)], pw=0x80, flt='env', fretrig=True),
        # sawtooth bass, unfiltered envelope of its own, through the same filter
        'bass': dict(ad=0x09, sr=0x69, wave=[(0x21, 0)]),
    },
    filters={
        # env=(AD, SR) for voice 3, base added to ENV3 >> 1; res: resonance 10,
        # FILT1 and FILT2 set, FILT3 clear; mode: 3OFF (bit 7) and low-pass
        'env': dict(env=(0x8a, 0x28), base=0x20, res=0xa3, mode=0x90),
    },
    patterns={
        'lead': "i=lead A3:12 r:4 C4:2 D4:2 E4:4 D4:2 C4:2 r:2 G3:2",
        'bass': "i=bass A1:4 A1:4 A1:4 A1:4 C2:4 D2:4 E2:2 E2:2 G1:4",
        'rest': "r:32",
    },
    orders=[
        ['LOOP', 'lead'],
        ['LOOP', 'bass'],
        ['LOOP', 'rest'],
    ],
)
```

## Build

```bash
java -jar KickAss.jar sid-env3-filter.asm -o sid-env3-filter.prg
```

Built with KickAssembler 5.25: `$080E`-`$1F4D` (`-showmem`), a PRG of
5,967 bytes. From the symbol file the harness (loop, stopwatch, log,
verdict, readout and 920 bytes of screen text) is 3,660 bytes at
`$080E`-`$1659`; the player follows, 2,188 bytes (105 of state, 192 of
frequency table built at init, 1,560 of code, 249 of the base's six sound
effects, unused here, 82 of tables: the build's count over its own symbol
file, the player being unchanged); the tune's 104 bytes of tables end the
file. The log pages are `$3000`-`$3EFF`. No zero page. `-define
FORCE_FAULT` builds the fault variant; `-define WAV_ON` or `WAV_OFF` a
recording variant with the mode fixed, no phases and no verdict.

## Expected output

Every figure below was measured in VICE x64sc 3.10 (rung 1) from the exit
screenshot of the pinned run of the listing above, text decoded against
the chargen ROM's glyphs with PIL, and from a monitor memory dump and the
sound driver's register log of the same program. The run must have a real
sound sink: under the verifier's default `+sound`, `$D41C` returns a
meaningless changing byte, under `-sound -sounddev dummy` a frozen `$00`
(measured 2026-09-23 with a forty-sample probe, in the build's record);
the dump and wav sinks clock the envelope. The pinned command is the
verifier's default with the entry's flags after it; VICE takes the last
of `+sound` and `-sound`:

```text
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 18000000 [-model ntsc] -sound -sounddev dump -soundarg /dev/null \
      -exitscreenshot out.png -autostart sid-env3-filter.prg
```

PAL (`screenshots/sid-env3-filter.png`, md5 `abc206c6aef2578a7e8c9fc82fcb70d2`):

```text
ENV3 FILTER ENVELOPE  V3 ADSR TO $D416
A: ENV3 PER FRAME, FRAMES 00-59 OF 192
0001326496C8FBF6ECE2D8CEC4BAB0A69C92887E
73695F59544F4A45403B3634312F2C2A27252222
2222222222222222222222222222222222222222
A: $D416 WRITTEN, SAME FRAMES
202039526B849D9B96918C87827D78736E69645F
59544F4C4A474542403D3B3A3837363533323131
3131313131313131313131313131313131313131
B: $D416 WITH THE COPY OFF, SAME FRAMES
2020202020202020202020202020202020202020
2020202020202020202020202020202020202020
2020202020202020202020202020202020202020
IDENT A 192/192 FLAT B 192/192 E3A=B 190
RISE 05 PEAK FB HOLD 22 X035 ZERO AT 082
PLAY CYCLES    WORST PLAIN  NOTE  RSTRT
A ENV ON        1003  0460  1003  0735
B COPY OFF      0996  0453  0996  0728
C NO ENVELOPE   1026  0459  1026  0719
A-B            +0007 +0007 +0007 +0007
A-C            -0023 +0001 -0023 +0016
STOPWATCH 0005  SID DETECT 02  BASE $20
RESULT 01 PASS
```

Rows 23 and 24 are blank.

NTSC (`screenshots/sid-env3-filter-ntsc.png`, md5 `d356026f8735291f087f101673a24c5f`)
differs where the frame does:

```text
00015783AEDAFEEDE4DBD2CAB8AFA79E95847B72
696156524E49453C383533312C2A282623222222
2222222222222222222222222222222222222222
A: $D416 WRITTEN, SAME FRAMES
20204B61778D9F96928D89857C77736F6A625D59
54504B494744423E3C3A39383635343331313131
3131313131313131313131313131313131313131
...
IDENT A 192/192 FLAT B 192/192 E3A=B 083
RISE 05 PEAK FE HOLD 22 X036 ZERO AT 083
A ENV ON        1011  0468  1011  0743
B COPY OFF      1004  0461  1004  0736
C NO ENVELOPE   1034  0467  1034  0727
A-B            +0007 +0007 +0007 +0007
A-C            -0023 +0001 -0023 +0016
STOPWATCH 0005  SID DETECT 03  BASE $20
RESULT 01 PASS
```

The border is green (PASS; red would be FAIL). Both pictures were made
twice, byte-identical. With `-sidenginemodel 256` on PAL and `257` on
NTSC the pictures differ in one cell, nine pixels: `SID DETECT` reads
`03` on the 6581 model and `02` on the 8580 model (the KB's detection
routine, `sid_8580_vs_6581_differences`); every other cell, the identity
counts and the cycle figures included, is the same.

**The identity (row 13).** `IDENT A 192/192`: on every frame of phase A
the byte written to `$D416` equals the byte read from `$D41C` shifted
right once plus `$20`. `FLAT B 192/192`: with the copy disabled every
cutoff is `$20`, while the harness's own ENV3 reads show the envelope
still moving (peak `$FB` in phase B, `$CE` then zero in phase C, from the
memory dump). `E3A=B 190`: the harness's ENV3 reads agree between phases
A and B on 190 frames of 192 on PAL, the chip's own envelope under the
same gate timing (the build's four-file program, whose read fell a few
hundred cycles later in the frame, agreed on 187); on NTSC only 83,
because 192 play calls are 230.4 frames there (one call in six is skipped) and the second loop starts at a
different point of the skip cycle.

**The shape (rows 2 to 4 and 14).** From the note frame: `01 32 64 96 C8
FB`, five rising steps of 49 to 51 (attack 8, 100 ms nominal, about 50
of 255 per 20 ms frame), a peak sample of `$FB` (the attack reaches 255
and the decay begins inside the same frame, so a per-frame sample never
lands on `$FF`; the verdict asks for `$F0` or more), then the exponential
decay: 9.5 a frame down to 93 (frame 23), 5.0 a frame down to 54 (frame
30), 0.7 a frame down to the sustain level `$22` = 34, held 35 frames
until the note ends at frame 73. In the rest, `22 18 12 0D 0A 07 05 03
02 00`: zero at frame 82, nine frames of release 8. `$D416` on the same
frames is the halved byte plus `$20`: `20 20 39 52 6B 84 9D 9B 96 ... 31
31 31`. On NTSC the rise is 44 a frame (`01 57 83 AE DA FE`, the 86 of
the first step being two frames, a skipped call falling after the gate),
the plateau 36 frames, zero at frame 83.

**Cycles (rows 16 to 20).** The play call including its JSR and RTS, net
of the stopwatch's 5 cycles, on the frame named; the same on the two SID
models; NTSC 8 higher throughout: its path through the player's skip
counter is `LDA`, `BEQ` not taken, `DEC`, `BPL`, 15 cycles against
PAL's `LDA`, `BEQ` taken, 7 (instruction table). An earlier version put
the 8 down to the 6526's one-cycle-later CIA; `sid-hr-snare`, on the
same player, reads the same figures on PAL `-model c64` (6526) as on the
default 8521 (measured). The copy costs 7 cycles more than the
player's static-cutoff path on every one of 192 frames (A minus B, every
frame, both models, from the memory dump). Against the plain player (A
minus C): +1 on 175 frames, +22 where a lead note starts after a hard
restart (six frames: 97, 109, 121, 145, 157, 181), +16 on the seven
hard-restart frames, +6 on the two rests, -44 on the loop's first frame
and -23 on its second, where the plain player writes voice 3's rest event
and the envelope player skips voice 3's music writes. The build's
four-file program, with the KB harness's frame meter assembled in after
the verdict's variables, measured 1,002, 464 and 737 on its A row and +21
on the six note frames: the meter's code moved the player, and page
crossings in its indexed loads moved the figures by up to four cycles.
The differences agree to within one cycle.

**The register log.** The dump driver's file holds every SID write with
its cycle delta; a checker in the build's record reads it with the
monitor dump (`-moncommands`, a store trace on `$02FF` that dumps
`$3000`-`$3EFF`). After the init clear's one `$D416` write, 576 of 576
`$D416` writes (one per play call over the three phases) equal the
program's log of the cutoff it wrote, call by call, on the PAL and NTSC
runs of this listing (the default SID model of each), and on the build's
four model and region runs of its four-file program. Write-to-write
spacing over those calls is 19,066 to 19,865 cycles on PAL; on NTSC
16,506 to 34,388, the long gap being the call the player skips. The
build's runs had one gap of 294,808 cycles on PAL, the frame meter's
insertion sort at its 195th frame; this listing has no meter and no
stall.

**The fault build.** With `-define FORCE_FAULT` the copy writes ENV3 plus
the base without the shift: `IDENT A 016/192` on PAL and `015/192` on
NTSC (the frames where ENV3 was 0 or 1), row 6 reads
`20215284B6E81B160C02F8EEE4DAD0C6BCB2A89E` on PAL (the cutoff wraps past
`$FF` at the peak), `RESULT 02 FAIL`, red border; `A-B` reads `+0005`,
the dropped `LSR`. Measured on this listing, both models.

**Recordings.** From the build's record, made from its `WAV_ON` and
`WAV_OFF` builds of this player and tune and not re-recorded from this
listing: twenty seconds of the phrase from each of the two builds with
the mode fixed, on both SID models, in real time (`+warp -sound
-sounddev wav -soundarg out.wav -soundrate 44100 -soundoutput 1
-limitcycles 23000000`; 20.34 s each, 1,794,412 bytes, the autostart
part is warped and not recorded). RMS per one-second window (a
small script in the build's record):

```text
start_s   on6581  off6581  on8580  off8580
   0.0     3369     3767     2653     2699
   1.0     2786     3099     2325     2342
   2.0     3117     3571     2665     2704
   3.0     2788     3139     2359     2420
   4.0     3000     3409     2587     2630
   5.0     2423     2664     2055     2085
   6.0     3096     3562     2644     2694
   7.0     2854     3223     2430     2486
   8.0     3277     3702     2790     2829
   9.0     2510     2731     2109     2094
  10.0     3150     3606     2694     2739
  11.0     2856     3187     2440     2497
  12.0     3291     3666     2805     2837
  13.0     2558     2841     2146     2141
  14.0     3102     3631     2647     2770
  15.0     2716     3057     2325     2383
  16.0     2914     3274     2484     2510
  17.0     2472     2809     2088     2144
  18.0     2909     3363     2493     2567
  19.0     3234     3667     2766     2814
```

Whole-file RMS: on 2,943 and off 3,325 on the 6581 model; on 2,493 and
off 2,538 on the 8580 model. The two 6581 recordings differ in every
window; the 8580 pair by less. In quarter-second windows the pairs
coincide exactly at 1.80 s (1,151 and 1,151; 858 and 858), the lead's
rest, where the envelope has released to zero and the cutoff is the base
in both. Whether the difference is a better lead is a human's call;
nobody here has listened.

## Why this works

**The envelope runs whether or not the voice is heard.** `$D41C` is the
output of voice 3's envelope generator; 3OFF disconnects voice 3 from the
mixer on the bypass path, and with FILT3 clear that is its only path
(`sid-reference.md`, "$D418" and the pitfall list;
`pitfalls/sid.md`, `sid_voice3_disable_silent_bit`). Voice 3's frequency
is never written after the init clear, so its oscillator stands at zero:
on an 8580 R5 with a bypass residual what would leak is a level that
follows the envelope, not a tone (not measured; reSID has no residual).

**The lead's gate is voice 3's gate.** In `ms_new`, after the lead's AD,
SR and gate, the player writes voice 3's AD and SR from the filter table
and `$11` to `$D412`; in `mu_hr` the lead's hard restart (AD = SR = 0,
gate off, two frames early) is done to voice 3 as well, so the filter's
attack starts from a reset envelope (`sid_adsr_bug_8580`); in `mu_start`
the lead's rest clears voice 3's gate, and the release runs. Legato notes
change neither gate, so the filter holds.

**The copy is the whole per-frame cost.** `mf_env` reads `$D41C`, shifts,
adds the base and writes `$D416`: 14 cycles with an immediate base, 16
with one in memory, 24 here with the two stores the log reads
(instruction table); 7 more than the player's static path, measured on
every frame. Voice 3's music path writes nothing while the envelope owns
it (the player's `mu_skip`, the mechanism effects use), and `$D417` is
written with FILT3 masked off, the FILT3 rule enforced by the player
rather than the tune.

**Halving fits the register.** ENV3 is 0 to 255; the cutoff's high byte
is 8 bits; the shift puts the sweep in the upper half of the register
above a base the tune chooses. `$D415` could take the dropped bit.

## Variations

- **Inverted:** subtract from a top instead of adding to a base; the
  filter closes on the attack.
- **Full range:** no shift, base 0. The fault build shows what a wrap
  looks like if the base is not zero.
- **A second modulator:** voice 3's oscillator is free; `$D41B` can be
  read for pulse-width or pitch modulation at the same time (not built).
- **Kind 1 and kind 2 together:** the player runs one filter program at
  a time; an instrument with a kind-1 sweep takes the filter back at its
  next note and voice 3 stays gated by the last lead note until the next
  kind-2 load. A tune that mixes them should give the kind-1 instrument
  a rest on voice 3 first (not measured).

## Pitfalls met

`sid_voice3_disable_silent_bit` (3OFF with FILT3 clear; frequency zero),
`sid_adsr_bug_8580` (the hard restart mirrored), `sid_filter_chip_variation`
(both models run; nothing here is downstream of the filter, so the
identity and the ENV3 sequence are the same on both),
`sid_write_only_registers` (the identity is on what the player read and
meant to write; the sound driver's log shows what the SID received),
`pal_ntsc_tempo_mismatch` (the player skips one call in six on NTSC and
builds its frequency table per clock; this copy reloads the skip counter
with 5, where the base's code skipped one in five against its own
comment), `sidasid_emulation_notes` (ENV3 does not advance without a
sound sink; the dump sink is the pin's), and `sfx_in_player` (an effect
on voice 3 and the envelope cannot share it; none is requested).

## What it does not establish

- Anything about silicon. Every figure is VICE 3.10 reSID, on the two
  chip models. The 8580 R5 residual through 3OFF is not modelled.
- How it sounds. The RMS tables describe level over time; the recordings
  are in the build's record for a human.
- The register log and the recordings on the model-swapped runs of this
  listing: the log was re-made on the default model of each region, the
  recordings not at all; both stand on the build's four-file program,
  whose player and tune this listing carries unchanged.
- A measured Cost for `sid_filter_routing` alone: the proposed 43 cycles
  is the instruction table over this listing's static path.
- The phase-B envelope's agreement with phase A on NTSC (83 of 192) was
  explained by the skip cycle's phase, not measured frame by frame.
