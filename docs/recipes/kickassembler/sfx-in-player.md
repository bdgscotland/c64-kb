---
recipe: sfx-in-player
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sfx_in_player]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021, D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418, DC04, DC05, DC0D, DC0E, DD0D]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Sound effects inside the music player, with voice stealing and hand-back

## Synopsis

A three-voice music player of its own, with a sound-effect entry point
built in. An effect takes one voice for its length. Requests are queued, so
at most one effect starts per frame and the higher effect number wins; an
effect cannot cut a higher-numbered one already on its voice. When an
effect ends, the player re-applies the music voice's instrument (AD, SR,
pulse width, waveform and gate) on that same frame. The player writes into
a 25-byte shadow of the SID and copies the whole shadow to `$D400`-`$D418`
once per frame ("ghost registers"). A script requests effects on fixed
frames, so the run needs no input. The program logs which voices an effect
owned on each of 120 frames, compares the log with an expected table, reads
the shadow on the frames around every hand-back, times each play call with
CIA1 timer A, and prints PASS or FAIL. The technique is `sfx_in_player` in
`techniques/music-sid.md`.

## Source

```asm
// sfx-in-player.asm: sound effects run inside a three-voice music player.
// The player keeps a 25-byte shadow of the SID ("ghost registers"), writes
// music or effect values into it per voice, and copies all 25 bytes to
// $D400-$D418 once per frame, $18 down to $00. An effect takes one voice for
// its length; a request is queued so at most one effect starts per frame and
// the higher effect number wins; an effect cannot cut a higher one already
// playing on its voice. When an effect ends the player re-applies the
// music voice's AD, SR, pulse width and control from its instrument.
// A script requests effects on fixed frames. The program logs which voices
// an effect owned on each of 120 frames, checks the log against an
// expected table, reads the shadow on the frames around each hand-back,
// times every play call with CIA1 timer A, and prints PASS or FAIL.
// Build: java -jar KickAss.jar sfx-in-player.asm -o sfx-in-player.prg

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN  = $0400
.const LINE    = 251        // below the display: no badlines, no sprites
.const NFRAMES = 120        // frames logged and checked
.label fxptr   = $fb        // zero-page pointer to the running effect
.label patptr  = $fd        // zero-page pointer to a voice's pattern

* = $0810

start:
    sei
    lda #$7f
    sta $dc0d               // no CIA interrupts: timer A is the stopwatch
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #0
    sta $d020
    sta $d021
    ldx #0
clr:
    lda #$20
    sta SCREEN,x
    sta SCREEN + $100,x
    sta SCREEN + $200,x
    sta SCREEN + $2e8,x
    lda #1
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne clr
    ldx #0
lab:
    lda labels,x
    sta SCREEN,x
    lda labels + $100,x
    sta SCREEN + $100,x
    inx
    bne lab

    jsr music_init
    jsr calibrate

// ---------------------------------------------------------------------------
// Frame loop: script, timed play, log, checks. No interrupts.
// ---------------------------------------------------------------------------
frameloop:
    jsr waitline
    inc frame
    jsr script
    ldx #2                  // mask of effect voices before play
    jsr fxmask
    sta maskbefore
    jsr timed_play
    ldx #2                  // count effects on their first frame:
cnt1:                       // header and one row read, position 5
    lda sfxnum,x
    beq cnt2
    lda sfxpos,x
    cmp #5
    bne cnt2
    inc starts
cnt2:
    dex
    bpl cnt1
    ldx #2
    jsr fxmask
    ldy frame
    sta log - 1,y           // frame 1 goes to log+0
    ora maskbefore          // an effect ran or handed back this frame
    beq idlecat
    lda cost + 1            // effect frame: keep the maximum
    cmp fxmax + 1
    bcc catdone
    bne fxnew
    lda cost
    cmp fxmax
    bcc catdone
fxnew:
    lda cost
    sta fxmax
    lda cost + 1
    sta fxmax + 1
    lda frame
    sta fxat
    jmp catdone
idlecat:
    lda cost + 1            // music-only frame: keep the maximum
    cmp idmax + 1
    bcc catdone
    bne idnew
    lda cost
    cmp idmax
    bcc catdone
idnew:
    lda cost
    sta idmax
    lda cost + 1
    sta idmax + 1
    lda frame
    sta idat
catdone:
    lda cost + 1            // any frame: keep the minimum
    cmp mnmin + 1
    bcc mnnew
    bne mndone
    lda cost
    cmp mnmin
    bcs mndone
mnnew:
    lda cost
    sta mnmin
    lda cost + 1
    sta mnmin + 1
    lda frame
    sta mnat
mndone:
    jsr checks
    lda frame
    cmp #NFRAMES
    beq alldone
    jmp frameloop
alldone:
    jsr report
idle:                       // music keeps playing; the screen is final
    jsr waitline
    jsr play
    jmp idle

waitline:
    lda $d011
    bmi waitline
    lda $d012
    cmp #LINE
    bne waitline
    rts

// A = mask of voices (bit 0 = voice 1) an effect owns; X = 2 on entry
fxmask:
    lda #0
    sta mtmp
fxm1:
    lda sfxnum,x
    cmp #1                  // carry set if an effect owns voice X
    rol mtmp
    dex
    bpl fxm1
    lda mtmp                // voice 3 rolled in first, ends in bit 2
    rts

// ---------------------------------------------------------------------------
// Stopwatch: CIA1 timer A, one-shot from $FFFF.
// ---------------------------------------------------------------------------
calibrate:
    lda #$ff
    sta $dc04
    sta $dc05
    lda #%00011001          // force load, one-shot, start
    sta $dc0e
    lda #0
    sta $dc0e               // stop
    sec
    lda #$ff
    sbc $dc04
    sta calib
    lda #$ff
    sbc $dc05
    sta calib + 1
    rts

timed_play:
    lda #$ff
    sta $dc04
    sta $dc05
    lda #%00011001
    sta $dc0e
    jsr play
    lda #0
    sta $dc0e
    sec
    lda #$ff
    sbc $dc04
    sta cost
    lda #$ff
    sbc $dc05
    sta cost + 1
    sec                     // less the stopwatch's own start/stop
    lda cost
    sbc calib
    sta cost
    lda cost + 1
    sbc calib + 1
    sta cost + 1
    rts

// ---------------------------------------------------------------------------
// Script: effect requests on fixed frames (the autopilot).
// ---------------------------------------------------------------------------
script:
    ldx sidx
    lda scframe,x
    cmp frame
    bne scdone
    lda scfx,x
    jsr sfx_request
    inc sidx
    jmp script              // two requests may share a frame
scdone:
    rts

// ===========================================================================
// The player
// ===========================================================================

// SFX entry point. A = effect number 1-4; a higher number wins.
// Only one request per frame survives to the player.
sfx_request:
    cmp pending
    bcc srdrop
    ldy pending
    beq srstore
    inc dropped             // a lower request queued this frame is lost
srstore:
    sta pending
    rts
srdrop:
    inc dropped
    rts

music_init:
    ldx #2
mi1:
    lda #0
    sta mtimer,x
    sta mseq,x
    sta sfxnum,x
    sta restore,x
    dex
    bpl mi1
    ldx #$18
mi2:
    lda #0
    sta ghost,x
    dex
    bpl mi2
    lda #$0f
    sta ghost + $18         // volume 15, no filter
    rts

play:
    ldy pending             // start the queued effect, if any
    beq plvoices
    ldx fxvoice,y
    tya
    cmp sfxnum,x
    bcs pltake              // same or higher than the one playing: take
    inc refused
    jmp plclear
pltake:
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
    rts

// One voice. X = voice 0-2. The music advances every frame, owned or not.
voice:
    lda voff,x
    sta vo
    lda #0
    sta noteinit
    lda mtimer,x
    bne vgate
    inc noteinit            // first frame of a note: fetch it
    lda patlo,x
    sta patptr
    lda pathi,x
    sta patptr + 1
    ldy mseq,x
    lda (patptr),y
    cmp #$ff
    bne vnote
    ldy #0                  // end of pattern: loop
    lda (patptr),y
vnote:
    iny
    sta ntmp
    tya
    sta mseq,x
    ldy ntmp
    lda freqlo,y
    sta mflo,x
    lda freqhi,y
    sta mfhi,x
vgate:
    lda mtimer,x            // gate off on a note's first and last frame
    beq vgoff
    clc
    adc #1
    cmp idur,x
    beq vgoff
    lda iwave,x
    ora #1
    bne vgset
vgoff:
    lda iwave,x
vgset:
    sta mctrl,x
    inc mtimer,x
    lda mtimer,x
    cmp idur,x
    bne vowner
    lda #0
    sta mtimer,x
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
    lda iad,x
    sta ghost + 5,y
    lda isr,x
    sta ghost + 6,y
    lda ipw,x
    sta ghost + 3,y
    lda #0
    sta ghost + 2,y
vfc:
    lda mflo,x
    sta ghost + 0,y
    lda mfhi,x
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

// ===========================================================================
// Checks
// ===========================================================================

// Around each hand-back: on the effect's last frame the shadow holds the
// effect's AD and SR; on the next frame it holds the instrument's AD, SR,
// pulse high and waveform with GATE set (the music note is mid-note).
checks:
    ldx cidx
    lda ckframe,x
    cmp frame
    bne ckdone
    ldy ckvoice,x
    lda voff,y
    tay                     // Y = ghost offset
    lda cktype,x
    bne ckback
    lda ckfx,x              // owned: compare with the effect header
    tax
    lda fxlo,x
    sta fxptr
    lda fxhi,x
    sta fxptr + 1
    lda ghost + 5,y
    sta ctmp
    lda ghost + 6,y
    ldy #1
    cmp (fxptr),y
    bne ckfail
    lda ctmp
    dey
    cmp (fxptr),y
    bne ckfail
    jmp ckpass
ckback:
    ldx cidx
    lda ckvoice,x
    tax                     // X = voice
    lda ghost + 5,y
    cmp iad,x
    bne ckfail
    lda ghost + 6,y
    cmp isr,x
    bne ckfail
    lda ghost + 3,y
    cmp ipw,x
    bne ckfail
    ldy cidx                // type 1 wants GATE set, type 2 clear
    lda cktype,y
    and #1
    ldy voff,x              // Y = ghost offset again
    ora iwave,x
    cmp ghost + 4,y
    bne ckfail
ckpass:
    inc ckok
ckfail:
    inc cidx
ckdone:
    rts

// ===========================================================================
// Report
// ===========================================================================
report:
    ldx #0                  // mask log, rows 2 to 4
rp1:
    lda log,x
    ora #$30
    sta SCREEN + 2 * 40,x
    inx
    cpx #NFRAMES
    bne rp1

    ldx #0                  // compare the log with the expected runs
    ldy #0
rp2:
    lda exprun,y            // run length, 0 ends
    beq rp4
    sta rtmp
    lda exprun + 1,y
rp3:
    cmp log,x
    bne rpbad
    inx
    dec rtmp
    bne rp3
    iny
    iny
    jmp rp2
rpbad:
    inc logbad
rp4:
    cpx #NFRAMES
    beq rp5
    inc logbad
rp5:
    lda #<(SCREEN + 5 * 40 + 7)
    ldx #>(SCREEN + 5 * 40 + 7)
    ldy starts
    jsr puthex
    lda #<(SCREEN + 5 * 40 + 18)
    ldx #>(SCREEN + 5 * 40 + 18)
    ldy refused
    jsr puthex
    lda #<(SCREEN + 5 * 40 + 29)
    ldx #>(SCREEN + 5 * 40 + 29)
    ldy dropped
    jsr puthex
    lda #<(SCREEN + 6 * 40 + 16)
    ldx #>(SCREEN + 6 * 40 + 16)
    ldy ckok
    jsr puthex
    lda #<(SCREEN + 7 * 40 + 16)
    ldx #>(SCREEN + 7 * 40 + 16)
    ldy idmax + 1
    jsr puthex
    lda #<(SCREEN + 7 * 40 + 18)
    ldx #>(SCREEN + 7 * 40 + 18)
    ldy idmax
    jsr puthex
    lda #<(SCREEN + 7 * 40 + 31)
    ldx #>(SCREEN + 7 * 40 + 31)
    ldy idat
    jsr puthex
    lda #<(SCREEN + 8 * 40 + 16)
    ldx #>(SCREEN + 8 * 40 + 16)
    ldy fxmax + 1
    jsr puthex
    lda #<(SCREEN + 8 * 40 + 18)
    ldx #>(SCREEN + 8 * 40 + 18)
    ldy fxmax
    jsr puthex
    lda #<(SCREEN + 8 * 40 + 31)
    ldx #>(SCREEN + 8 * 40 + 31)
    ldy fxat
    jsr puthex
    lda #<(SCREEN + 9 * 40 + 16)
    ldx #>(SCREEN + 9 * 40 + 16)
    ldy mnmin + 1
    jsr puthex
    lda #<(SCREEN + 9 * 40 + 18)
    ldx #>(SCREEN + 9 * 40 + 18)
    ldy mnmin
    jsr puthex
    lda #<(SCREEN + 9 * 40 + 31)
    ldx #>(SCREEN + 9 * 40 + 31)
    ldy mnat
    jsr puthex
    lda #<(SCREEN + 10 * 40 + 16)
    ldx #>(SCREEN + 10 * 40 + 16)
    ldy calib + 1
    jsr puthex
    lda #<(SCREEN + 10 * 40 + 18)
    ldx #>(SCREEN + 10 * 40 + 18)
    ldy calib
    jsr puthex

    lda logbad              // verdict
    bne rpfail
    lda ckok
    cmp #8
    bne rpfail
    lda starts
    cmp #5
    bne rpfail
    lda refused
    cmp #1
    bne rpfail
    lda dropped
    cmp #1
    bne rpfail
    ldx #3
rppass:
    lda passtxt,x
    sta SCREEN + 11 * 40 + 7,x
    dex
    bpl rppass
    lda #5                  // green border: PASS
    sta $d020
    rts
rpfail:
    ldx #3
rpf1:
    lda failtxt,x
    sta SCREEN + 11 * 40 + 7,x
    dex
    bpl rpf1
    lda #2                  // red border: FAIL
    sta $d020
    rts

// Y = byte, A/X = screen address: two hex digits
puthex:
    sta patptr
    stx patptr + 1
    tya
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdig,x
    ldy #0
    sta (patptr),y
    pla
    and #$0f
    tax
    lda hexdig,x
    ldy #1
    sta (patptr),y
    rts

// ===========================================================================
// Data
// ===========================================================================
voff:    .byte 0, 7, 14
iwave:   .byte $40, $20, $40            // pulse, saw, pulse
iad:     .byte $08, $0a, $22
isr:     .byte $a6, $80, $b8
ipw:     .byte $08, $04, $06            // pulse width high nybble
idur:    .byte 8, 16, 12                // frames per note
patlo:   .byte <pat1, <pat2, <pat3
pathi:   .byte >pat1, >pat2, >pat3
pat1:    .byte 12, 16, 19, 16, 14, 17, 21, 17, $ff
pat2:    .byte 0, 0, 5, 7, $ff
pat3:    .byte 19, 21, 23, 21, $ff

// 24 semitones from C-3, PAL clock: f * 16777216 / 985248
.const K = 16777216 / 985248
freqlo:  .fill 24, <round(K * 130.81 * pow(2, i / 12))
freqhi:  .fill 24, >round(K * 130.81 * pow(2, i / 12))

// Effect number n: voice and data. Entry 0 is unused.
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

// Script: frame, effect. Frame 0 ends it.
scframe: .byte 20, 30, 49, 49, 81, 87, 97, 0
scfx:    .byte 2,  1,  1,  3,  4,  1,  4,  0

// Checks: frame, voice, type, effect for type 0. Type 0: the effect owns
// the voice. Type 1: hand-back mid-note, GATE set. Type 2: hand-back on a
// note's first frame, GATE clear.
ckframe: .byte 68, 69, 90, 91, 96, 97, 106, 107, 0
ckvoice: .byte 2,  2,  0,  0,  2,  2,  0,   0
cktype:  .byte 0,  1,  0,  1,  0,  2,  0,   1
ckfx:    .byte 3,  0,  4,  0,  1,  0,  4,   0

// Expected mask log as runs of (length, mask), written from the script,
// not from the player: bit 0 voice 1, bit 2 voice 3.
exprun:  .byte 19, 0, 49, 4, 12, 0, 6, 1, 4, 5, 6, 4, 10, 1, 14, 0, 0

hexdig:  .text "0123456789ABCDEF"
passtxt: .text "PASS"
failtxt: .text "FAIL"

labels:
    .text "SFX INSIDE THE PLAYER: VOICE STEALING   "   // row 0
    .text "EFFECT VOICES PER FRAME, FRAMES 1-120:  "   // row 1
    .text "                                        "   // row 2
    .text "                                        "   // row 3
    .text "                                        "   // row 4
    .text "STARTS    REFUSED    DROPPED            "   // row 5
    .text "HANDBACK CHECKS    OF 08                "   // row 6
    .text "PLAY IDLE MAX  $     AT FRAME $         "   // row 7
    .text "PLAY FX   MAX  $     AT FRAME $         "   // row 8
    .text "PLAY MIN       $     AT FRAME $         "   // row 9
    .text "STOPWATCH      $                        "   // row 10
    .text "RESULT                                  "   // row 11
    .fill 512 - 12 * 40, $20

// Variables
frame:      .byte 0
sidx:       .byte 0
cidx:       .byte 0
pending:    .byte 0
refused:    .byte 0
dropped:    .byte 0
starts:     .byte 0
ckok:       .byte 0
logbad:     .byte 0
maskbefore: .byte 0
mtmp:       .byte 0
ntmp:       .byte 0
ctmp:       .byte 0
rtmp:       .byte 0
vo:         .byte 0
vidx:       .byte 0
noteinit:   .byte 0
cost:       .word 0
calib:      .word 0
idmax:      .word 0
idat:       .byte 0
fxmax:      .word 0
fxat:       .byte 0
mnmin:      .word $ffff
mnat:       .byte 0
mtimer:     .fill 3, 0
mseq:       .fill 3, 0
mflo:       .fill 3, 0
mfhi:       .fill 3, 0
mctrl:      .fill 3, 0
sfxnum:     .fill 3, 0
sfxpos:     .fill 3, 0
restore:    .fill 3, 0
ghost:      .fill 25, 0
log:        .fill NFRAMES, 0
```

## Build

```bash
java -jar KickAss.jar sfx-in-player.asm -o sfx-in-player.prg
```

Built with KickAssembler 5.25. Code and data occupy `$0810`-`$110A`. From
the symbol file: the player's code (`sfx_request` to the end of `veffect`)
is 371 bytes, and its tables, patterns, frequency table and four effects
are 282 bytes. The shadow is 25 bytes and the per-voice state 24.

## Expected output

Every figure below was measured in VICE x64sc 3.10 (rung 1) from the exit
screenshot of the pinned run at 8,000,000 cycles, text decoded against the
`chargen-901225-01.bin` glyphs with PIL. Two runs per model gave
byte-identical PNGs. `+sound` is off: every claim is register-level, what
the player put in the shadow and so in the SID. Nobody has listened to it.

```text
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 [-model ntsc] -exitscreenshot out.png \
      -autostart sfx-in-player.prg
```

PAL (`screenshots/sfx-in-player.png`) and NTSC
(`screenshots/sfx-in-player-ntsc.png`) show the same text:

```text
SFX INSIDE THE PLAYER: VOICE STEALING
EFFECT VOICES PER FRAME, FRAMES 1-120:
0000000000000000000444444444444444444444
4444444444444444444444444444000000000000
1111115555444444111111111100000000000000
STARTS 05 REFUSED 01 DROPPED 01
HANDBACK CHECKS 08 OF 08
PLAY IDLE MAX  $0422 AT FRAME $01
PLAY FX   MAX  $04B0 AT FRAME $61
PLAY MIN       $0306 AT FRAME $02
STOPWATCH      $0005
RESULT PASS
```

The border is green (PASS; red would be FAIL).

**The log.** One digit per frame, frames 1 to 120: bit 0 set means an
effect owns voice 1, bit 2 voice 3. The script's requests and what the log
shows:

| Frame | Request | Result in the log |
|---|---|---|
| 20 | effect 2 (voice 3, 40 rows) | voice 3 taken: `4` from frame 20 |
| 30 | effect 1 (voice 3) | refused: effect 2 is higher. `REFUSED 01` |
| 49 | effect 1, then effect 3, same frame | the queue keeps 3 and drops 1 (`DROPPED 01`); 3 cuts 2 |
| 69 | (none) | effect 3's 20 rows are over: voice 3 handed back, `0` |
| 81 | effect 4 (voice 1, 10 rows) | `1` |
| 87 | effect 1 (voice 3, 10 rows) | both voices: `5` |
| 91 | (none) | effect 4 ends, voice 1 handed back: `4` |
| 97 | effect 4 again (voice 1) | voice 3 handed back and voice 1 taken on the same frame: `1` |
| 107 | (none) | voice 1 handed back: `0` to frame 120 |

The program compares the log with a table of runs written from this
script, not from the player (`exprun`). `STARTS 05` counts effects that got
a voice (2, 3, 4, 1, 4), found after each call as a voice whose effect
position is 5, the header and one row.

**Hand-back checks.** On the last frame of each of the four effects the
shadow's AD and SR equal the effect's header (4 checks). On the next frame
they equal the instrument's AD, SR and pulse high byte, and the control
byte equals the instrument's waveform with GATE set (frames 69, 91 and
107, all mid-note) or clear (frame 97, where voice 3's next note starts
and the player holds GATE off for one frame).

A harness build with the one store that sets `restore` changed to store 0
(not this listing) ran the same way: `HANDBACK CHECKS 05 OF 08`, FAIL. The
three mid-note hand-backs failed and the frame-97 one passed, because the
player writes AD, SR and pulse on every note start anyway. Without the
restore, the music voice keeps the effect's envelope and pulse width until
its next note.

**Cycles.** Hex, net of the stopwatch's own 5 cycles; the same on PAL and
NTSC, because the play call runs from raster line 251, below the badlines,
with no sprites on.

| Row | Cycles | Frame | What ran |
|---|---|---|---|
| `PLAY IDLE MAX` | 1,058 | 1 | no effect; a note starts on all three voices |
| `PLAY FX MAX` | 1,200 | 97 | a note starts on all three voices, voice 3 is handed back with its instrument re-applied, and effect 4 starts on voice 1 with its header |
| `PLAY MIN` | 774 | 2 | no effect, no note start |

Frame 97 is the worst frame the script builds on purpose: every
per-voice path that costs extra, on one frame. 351 cycles of every figure
are the shadow copy (25 × 14 − 1 + 2, from the instruction table; `ghost`
does not cross a page). The demonstration's counters are outside the
timed call, except `inc refused` (6 cycles), which runs only on a refused
frame. An earlier layout of this listing, with a counter inside `play`,
measured 1,055, 1,203 and 773: moving code shifts page crossings in the
indexed loads, and the figures move by a few cycles with it.

## Why this works

**The player advances the music on every voice, every frame.** An effect
stops the voice's writes to the shadow, not its sequencer. `voice` fetches
notes and works out the gate for the music whether or not an effect owns
the voice; `vowner` then picks who writes. The tune stays in time, and at
hand-back the music's frequency and gate are already the ones for that
frame.

**Hand-back re-applies the instrument.** This player writes AD, SR and
pulse width only on a note's first frame, as most players do, to save
cycles. The effect overwrote them. So `vend` sets `restore` and jumps into
the music path, which rewrites all three from the instrument table on the
same frame. The effect's last row clears GATE, so the music's GATE on the
next frame is a 0-to-1 edge and a fresh attack with the music's envelope.

**One start per frame.** `sfx_request` only compares and stores: the
higher number stays in `pending`. The player takes it at the top of the
next `play`. Two requests in one frame cost one voice, not two.

**Ghost registers.** Nothing writes the SID but the copy loop at the end of
`play`, `$18` down to `$00`: for each voice SR, AD, control, pulse,
frequency. Every register is written every frame, in the same order, and
a voice's seven writes land within 98 cycles (7 × 14, arithmetic) whatever
path the player took. When they land in the frame still moves with the
player's length, 774 to 1,200 cycles here; copying first and computing
second fixes that too (see the technique). The SID's
registers are write-only (`pitfalls/sid.md`, `sid_write_only_registers`),
so the shadow is also the only place a program can read what it last
wrote; the checks read it.
