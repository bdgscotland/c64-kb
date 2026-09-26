---
recipe: sfx-voice-takeover
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sfx_voice_takeover]
file_formats: [PRG]
uses_registers: [D011, D012, D020, D021, D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D418, DC04, DC05, DC0D, DC0E, DD0D]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), cia2_timer_a (init), cia2_timer_b (init), cia2_tod (init)]
harness: [cia1_timer_a, $02FF]
ram: [colour=$D800-$DBE7]
---

<!-- doc-type: recipe -->

# KickAssembler — Sound effects that take two voices while the music steps them silently

## Synopsis

One driver, called once per frame, plays a three-voice tune and its sound
effects. An effect takes voices 1 and 2 together. The music keeps voice 3,
and it keeps stepping voices 1 and 2 through their patterns without writing
the SID, so the tune stays in time. There is no priority: the last request
wins. An effect ends by closing both gates, and each stolen voice gets no
music until its next note (it is silent sooner only if the effect's
sustain is 0 or its release has run out). A script requests effect A on
frame 31, effect B on frame 91, and effect A again on frame 107, which
cuts B. The program logs the running effect on each of 160 frames, checks
the log, and times every play call with CIA1 timer A. It writes each frame
number to `$02FF`, and 0 after frame 160,
so a VICE store trace of `$D400`-`$D414` can be cut into frames: the trace
is the proof of which code wrote which voice. The technique is
`sfx_voice_takeover` in `techniques/music-sid.md`; `sfx-in-player.md` is the
costlier variant with priority and hand-back.

## Source

```asm
// sfx-voice-takeover.asm: one driver plays a three-voice tune and its sound
// effects. An effect takes voices 1 AND 2 for its length; the music keeps
// voice 3 and keeps stepping voices 1 and 2 through their patterns without
// writing the SID, so the tune stays in time. A write flag is recomputed
// after each voice and the voices run 3, 2, 1, so voice 3 always writes.
// No priority: the last request wins. An effect ends by closing both gates;
// a stolen voice gets no music until its next note. An effect is a table
// entry: a 14-byte image of $D400-$D40D plus a note sweep (start, end,
// frames per step, direction, voice-2 interval, flags).
// A script requests effects on fixed frames. The program logs the running
// effect on each of 160 frames, checks the log, times every play call with
// CIA1 timer A, and writes each frame number to $02FF so that a VICE store
// trace of $D400-$D414 can be cut into frames.
// Build: java -jar KickAss.jar sfx-voice-takeover.asm -o sfx-voice-takeover.prg

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN  = $0400
.const LINE    = 251        // below the display: no badlines, no sprites
.const NFRAMES = 160        // frames logged and checked
.const SPEED   = 2          // a tick every SPEED + 1 = 3 frames
.label MARK    = $02ff      // frame number, for the store trace

.function fq(n) { .return round(16.3516 * pow(2, n / 12) * 16777216 / 985248) }

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
    lda labels + 200,x
    sta SCREEN + 200,x
    lda labels + 400,x
    sta SCREEN + 400,x
    inx
    cpx #200
    bne lab

    jsr music_init
    jsr calibrate

// ---------------------------------------------------------------------------
// Frame loop: script, timed play, log. No interrupts.
// ---------------------------------------------------------------------------
frameloop:
    jsr waitline
    inc frame
    lda frame
    sta MARK
    jsr script
    lda fxreq               // effect frame: running, pending or ending
    eor #$ff
    ora fxon
    sta before
    jsr timed_play
    lda fxon
    beq lg0
    ldx fxcur
    inx
    txa                     // 1 = effect A, 2 = effect B
lg0:
    ldy frame
    sta log - 1,y
    tax
    lda digit,x
    sta SCREEN + 80 - 1,y
    lda frame
    jsr hexa
    stx SCREEN + 12 * 40 + 7
    sty SCREEN + 12 * 40 + 8
    lda before
    ora fxon
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
    lda frame
    cmp #NFRAMES
    beq alldone
    jmp frameloop
alldone:
    jmp stopmark            // at the end, so no code or table moves
idle:                       // the music keeps playing; the screen is final
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
scdone:
    rts

// ===========================================================================
// The driver: music and effects, one call per frame
// ===========================================================================

// Effect request. A = effect number. No priority: the last request wins.
sfx_request:
    sta fxreq
    rts

music_init:
    ldx #$14
mi1:
    lda #0
    sta $d400,x
    dex
    bpl mi1
    lda #$0f
    sta $d418               // volume 15, no filter
    ldx #2
mi2:
    lda #0
    sta dur,x               // the first tick fetches a note on every voice
    lda pstart,x
    sta ppos,x
    lda ipwlo,x
    sta pwlo,x
    lda ipwhi,x
    sta pwhi,x
    dex
    bpl mi2
    lda #0
    sta tempo
    sta fxon
    lda #$ff
    sta fxreq
    rts

play:
    lda #$ff                // the first voice processed always writes
    sta wflag
    lda #0
    sta tick
    dec tempo
    bpl pl0
    lda #SPEED
    sta tempo
    inc tick
pl0:
    ldx #2                  // voice 3 first
plv:
    jsr voice
    lda fxon                // voices after this one write the SID only
    eor #$ff                // while no effect runs
    sta wflag
    dex
    bpl plv
    jmp fxengine

// One voice, X = 0-2. The sequencer always advances; wflag gates the writes.
voice:
    lda tick
    beq vframe
    dec dur,x
    bmi vnew
    bne vframe
    lda wflag               // last tick of the note: gate off
    beq vframe
    ldy sidoff,x
    lda ictrl,x
    and #$fe
    sta $d404,y
    jmp vframe
vnew:
    ldy ppos,x              // next event: note, length in ticks
    lda patdata,y
    cmp #$ff
    bne vn1
    ldy pstart,x            // end of pattern: loop
    lda patdata,y
vn1:
    sta note,x
    iny
    lda patdata,y
    sec
    sbc #1
    sta dur,x
    iny
    tya
    sta ppos,x
    lda wflag
    beq vframe
    ldy note,x              // note on: frequency, pulse, envelope, gate
    lda freqlo,y
    sta flo
    lda freqhi,y
    ldy sidoff,x
    sta $d401,y
    lda flo
    sta $d400,y
    lda pwlo,x
    sta $d402,y
    lda pwhi,x
    sta $d403,y
    lda iad,x
    sta $d405,y
    lda isr,x
    sta $d406,y
    lda ictrl,x
    sta $d404,y
vframe:
    lda ipws,x              // per-frame pulse sweep, $4xx-$7xx
    beq vdone
    clc
    adc pwlo,x
    sta pwlo,x
    lda pwhi,x
    adc #0
    and #$03
    ora #$04
    sta pwhi,x
    lda wflag
    beq vdone
    ldy sidoff,x
    lda pwlo,x
    sta $d402,y
    lda pwhi,x
    sta $d403,y
vdone:
    rts

// Effect engine, after the voices: start a pending effect or step the running one.
fxengine:
    ldy fxreq
    bmi fxstep
    lda #$ff
    sta fxreq
    sty fxcur
    lda #0                  // close both gates, then the start image
    sta $d404
    sta $d40b
    ldx fxbase,y
    ldy #0
fxcopy:
    lda fxdata,x
    sta $d400,y
    inx
    iny
    cpy #14
    bne fxcopy
    lda fxdata,x
    sta fxidx
    lda fxdata + 1,x
    sta fxend
    lda fxdata + 2,x
    sta fxspeed
    sta fxcnt
    lda fxdata + 3,x
    sta fxdir
    lda fxdata + 4,x
    sta fxint
    lda fxdata + 5,x
    sta fxflags
    lda fxdata - 10,x       // the image's two control bytes
    sta fxc1
    lda fxdata - 3,x
    sta fxc2
    lda #$ff
    sta fxon
    rts
fxstep:
    lda fxon
    beq fxdone
    dec fxcnt
    bpl fxdone
    lda fxspeed
    sta fxcnt
    lda fxidx
    clc
    adc fxdir
    sta fxidx
    lda fxflags             // bit 0: voice 1 keeps its start pitch
    lsr
    bcs fxv2
    ldy fxidx
    lda freqlo,y
    sta $d400
    lda freqhi,y
    sta $d401
fxv2:
    lda fxidx               // voice 2 = index - interval
    sec
    sbc fxint
    tay
    lda freqlo,y
    sta $d407
    lda freqhi,y
    sta $d408
    bit fxflags             // bit 7: stutter voice 1, bit 6: voice 2
    bpl fxg2
    lda fxc1
    eor #1
    sta fxc1
    sta $d404
fxg2:
    bvc fxend1
    lda fxc2
    eor #1
    sta fxc2
    sta $d40b
fxend1:
    lda fxidx
    cmp fxend
    bne fxdone
    lda fxc1                // the end: close both gates, hand nothing back
    and #$fe
    sta $d404
    lda fxc2
    and #$fe
    sta $d40b
    lda #0
    sta fxon
fxdone:
    rts

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
.macro PutHex16(addr, dest) {
    lda addr + 1
    jsr hexa
    stx dest
    sty dest + 1
    lda addr
    jsr hexa
    stx dest + 2
    sty dest + 3
}
.macro PutHex8(addr, dest) {
    lda addr
    jsr hexa
    stx dest
    sty dest + 1
}

report:
    ldx #0                  // count frames whose log matches the table
    ldy #0
rp1:
    lda log,x
    cmp explog,x
    bne rp2
    iny
rp2:
    inx
    cpx #NFRAMES
    bne rp1
    sty matches
    PutHex8(matches, SCREEN + 7 * 40 + 11)
    PutHex16(idmax, SCREEN + 8 * 40 + 15)
    PutHex8(idat, SCREEN + 8 * 40 + 30)
    PutHex16(fxmax, SCREEN + 9 * 40 + 15)
    PutHex8(fxat, SCREEN + 9 * 40 + 30)
    PutHex16(mnmin, SCREEN + 10 * 40 + 15)
    PutHex8(mnat, SCREEN + 10 * 40 + 30)
    PutHex16(calib, SCREEN + 11 * 40 + 15)
    ldx #3
    lda matches
    cmp #NFRAMES
    bne rpfail
rpp:
    lda passtxt,x
    sta SCREEN + 13 * 40 + 7,x
    dex
    bpl rpp
    lda #5                  // green border: PASS
    sta $d020
    rts
rpfail:
    lda failtxt,x
    sta SCREEN + 13 * 40 + 7,x
    dex
    bpl rpfail
    lda #2                  // red border: FAIL
    sta $d020
    rts

// A -> X = high hex digit, Y = low hex digit (screen codes)
hexa:
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hexch,y
    tax
    pla
    and #$0f
    tay
    lda hexch,y
    tay
    rts

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
hexch:   .text "0123456789ABCDEF"
digit:   .text "012"
passtxt: .text "PASS"
failtxt: .text "FAIL"

scframe: .byte 31, 91, 107, 0
scfx:    .byte 0, 1, 0

// Per voice, index 0 = voice 1: SID offset, instrument, pulse sweep, pattern
sidoff:  .byte $00, $07, $0e
ictrl:   .byte $41, $21, $41
iad:     .byte $09, $28, $06
isr:     .byte $a6, $84, $a0
ipwlo:   .byte $00, $00, $00
ipwhi:   .byte $04, $08, $06
ipws:    .byte $40, $00, $00
pstart:  .byte v1pat - patdata, v2pat - patdata, v3pat - patdata

// Patterns: note, length in ticks (2 or more); $FF loops. 32 ticks each.
patdata:
v1pat:   .byte 57,2, 60,2, 64,2, 60,2, 62,2, 65,2, 64,4
         .byte 60,2, 59,2, 57,2, 52,2, 55,2, 59,2, 57,4, $ff
v2pat:   .byte 52,4, 53,4, 55,4, 55,4, 52,4, 52,4, 50,4, 52,4, $ff
v3pat:   .byte 33,2, 45,2, 33,2, 45,2, 29,2, 41,2, 29,2, 41,2
         .byte 36,2, 48,2, 36,2, 48,2, 28,2, 40,2, 28,2, 40,2, $ff

// Effects: 14-byte image of $D400-$D40D, then start note, end note,
// frames per step - 1, direction, voice-2 interval, flags.
fxbase:  .byte fxa - fxdata, fxb - fxdata
fxdata:
fxa:     .byte <fq(84), >fq(84), $00, $00, $81, $0a, $00   // voice 1 noise, fixed
         .byte <fq(48), >fq(48), $00, $00, $11, $0a, $00   // voice 2 triangle
         .byte 48, 72, 0, 1, 0, %00000001                  // up 24 steps, 1 a frame
fxb:     .byte <fq(72), >fq(72), $00, $08, $41, $00, $f9   // voice 1 pulse
         .byte <fq(65), >fq(65), $00, $04, $41, $00, $f9   // voice 2 pulse, a fifth down
         .byte 72, 56, 1, $ff, 7, %01000000                // down 16 steps, 1 per 2 frames, v2 stutters

freqlo:  .fill 95, <fq(i)   // C-0 to A#7, PAL clock
freqhi:  .fill 95, >fq(i)

// The expected log, written from the script: A 24 frames, B cut after 16.
explog:
.for (var f = 1; f <= NFRAMES; f++) {
    .if (f >= 31 && f <= 54) {
        .byte 1
    } else {
        .if (f >= 91 && f <= 106) {
            .byte 2
        } else {
            .if (f >= 107 && f <= 130) {
                .byte 1
            } else {
                .byte 0
            }
        }
    }
}

.macro Row(s) {
    .text s
    .fill 40 - s.size(), $20
}
labels:
    Row("SFX VOICE TAKEOVER: THE MUSIC STEPS ON")
    Row("EFFECT PER FRAME 1-160, 1=A 2=B:")
    .fill 160, $20
    Row("REQUESTS: A AT 31, B AT 91, A AT 107")
    Row("LOG CHECK $   OF $A0")
    Row("PLAY IDLE MAX $     AT FRAME $")
    Row("PLAY FX   MAX $     AT FRAME $")
    Row("PLAY MIN      $     AT FRAME $")
    Row("STOPWATCH     $")
    Row("FRAME $")
    Row("RESULT")
    .fill 40, $20

// Variables
frame:   .byte 0
sidx:    .byte 0
before:  .byte 0
cost:    .word 0
calib:   .word 0
idmax:   .word 0
fxmax:   .word 0
mnmin:   .word $ffff
idat:    .byte 0
fxat:    .byte 0
mnat:    .byte 0
matches: .byte 0
tempo:   .byte 0
tick:    .byte 0
wflag:   .byte 0
flo:     .byte 0
dur:     .fill 3, 0
ppos:    .fill 3, 0
note:    .fill 3, 0
pwlo:    .fill 3, 0
pwhi:    .fill 3, 0
fxreq:   .byte $ff
fxon:    .byte 0
fxcur:   .byte 0
fxidx:   .byte 0
fxend:   .byte 0
fxspeed: .byte 0
fxcnt:   .byte 0
fxdir:   .byte 0
fxint:   .byte 0
fxflags: .byte 0
fxc1:    .byte 0
fxc2:    .byte 0
log:     .fill NFRAMES, 0

stopmark:                   // frames 1-160 done: MARK = 0, so the idle
    lda #0                  // loop's plays fall outside the store trace
    sta MARK
    jsr report
    jmp idle
```

## Build

```bash
java -jar KickAss.jar sfx-voice-takeover.asm -o sfx-voice-takeover.prg
```

Built with KickAssembler 5.25; the PRG loads at `$0801` and code and data
end at `$11B8`. From the symbol file: the driver's code (`sfx_request` to
the end of `fxengine`) is 493 bytes, 221 of them the effect engine. Its data
is 24 bytes of per-voice instrument tables, 79 bytes of patterns, 42 bytes
for the two effects (a two-byte index and 20 bytes per effect), 190 bytes of
frequency table and 31 bytes of state.

## Expected output

Every figure below was measured in VICE x64sc 3.10 (rung 1): the screen
from the exit screenshot of the pinned run at 8,000,000 cycles, text
decoded against the `chargen-901225-01.bin` glyphs with PIL; the register
evidence from a store trace. `+sound` is off. Nobody has listened to it.

```text
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 [-model ntsc] -exitscreenshot out.png \
      -autostart sfx-voice-takeover.prg
```

PAL (`screenshots/sfx-voice-takeover.png`) and NTSC
(`screenshots/sfx-voice-takeover-ntsc.png`) show the same text:

```text
SFX VOICE TAKEOVER: THE MUSIC STEPS ON
EFFECT PER FRAME 1-160, 1=A 2=B:
0000000000000000000000000000001111111111
1111111111111100000000000000000000000000
0000000000222222222222222211111111111111
1111111111000000000000000000000000000000
REQUESTS: A AT 31, B AT 91, A AT 107
LOG CHECK $A0 OF $A0
PLAY IDLE MAX $0289 AT FRAME $55
PLAY FX   MAX $0360 AT FRAME $1F
PLAY MIN      $00D7 AT FRAME $5C
STOPWATCH     $0005
FRAME $A0
RESULT PASS
```

The border is green (PASS; red would be FAIL).

**The log.** One digit per frame, frames 1 to 160: the effect running
after that frame's call. Effect A runs 24 frames, 31 to 54, and closes its
gates on frame 55. Effect B starts on frame 91; effect A's request on
frame 107 cuts it after 16 frames, because the last request wins. That A
runs to frame 130. `LOG CHECK` counts frames that match a table written
from the script (`explog`).

**The store trace.** `scripts/claims-watch.ts` on the built PRG, PAL,
8,000,000 cycles, with `--keep-log`; a Python script cut the log into
frames at each store to `$02FF` and named each SID store's writer by its
PC from the symbol file: `M` for the music (`voice`), `E` for the effect
engine (`fxengine`). Stores after `$02FF` returns to 0 (the idle loop)
are left out. A second build with the three script frames set to 0,
so no effect is ever requested (not this listing; same symbols), was
traced the same way. Frames 1 to 160:

| Check | Result |
|---|---|
| Music stores to `$D400`-`$D40D` on frames 32-55 and 92-131 | 0 |
| Effect stores | 183, all on frames 31-131, none to voice 3 |
| Voice 3 music stores, this build against the build with no requests | 216 and 216, identical in frame, register and value |
| Voices 1-2 music stores outside frames 32-55 and 92-131, both builds | 381 and 381, identical |
| First voice 1 and voice 2 note starts after frame 55 | frame 61 in both builds, same frequencies |
| First voice 1 and voice 2 note starts after frame 131 | frame 133 in both builds, same frequencies |

Effect A ends and the music takes voices 1 and 2 back (frame, register,
value, writer, raster line at the store; SID frequency stores are high
byte then low byte in the music code):

```text
54 $D407 $B4 E 256      effect A steps voice 2
54 $D408 $41 E 256
55 $D40F $11 M 254      voice 3: a new note, as in the build without effects
55 $D40E $67 M 254
55 $D410 $00 M 254
55 $D411 $06 M 255
55 $D413 $06 M 255
55 $D414 $A0 M 255
55 $D412 $41 M 255
55 $D407 $9C E 260      the last step, index = end note
55 $D408 $45 E 260
55 $D404 $80 E 260      both gates closed; nothing handed back
55 $D40B $10 E 260
56 $D402 $00 M 255      voice 1's pulse sweep writes again
56 $D403 $06 M 255
61 $D408 $15 M 257      voice 2's next note, on its scheduled frame
61 $D407 $ED M 257
61 $D409 $00 M 257
61 $D40A $08 M 257
61 $D40C $28 M 257
61 $D40D $84 M 258
61 $D40B $21 M 258
61 $D401 $1D M 260      voice 1's next note
61 $D400 $45 M 260
61 $D402 $00 M 260
61 $D403 $07 M 260
61 $D405 $09 M 260
61 $D406 $A6 M 260
61 $D404 $41 M 261
```

Frame 61 also carries voice 3's seven stores, left out here. On the start
frame, 31, the music writes voice 1's new note first, then the effect
writes control `$00` to both voices and the 14-byte image; the two
`$D404` stores are 91 cycles apart.

**Cycles.** Hex on the screen, net of the stopwatch's own 5 cycles; the
same on PAL and NTSC, because the play call runs from raster line 251 with
no sprites.

| Row | Cycles | Frame | What ran |
|---|---|---|---|
| `PLAY IDLE MAX` | 649 | 85 | no effect; a tick with note starts |
| `PLAY FX MAX` | 864 | 31 | a tick, then effect A's start: two gates closed and the 14-byte image |
| `PLAY MIN` | 215 | 92 | effect B waiting for its first step; voices 1 and 2 skip their writes |

A VICE store trace of `cost` (`trace store`, the net figure written after
each call, frames cut at `$02FF`) gives every frame's call: median 294
cycles over frames 1 to 160, and 228 on 63 of them, the frames with no
tick and no effect. PAL and NTSC give the same 160 figures.

Per-frame costs read with a monitor checkpoint after each call, in this
build and the build with no requests, give the effect engine's own work
by difference: +342 cycles on a start frame (31 and 91), +321 when a
request cuts a running effect (107), +66 on a step of A and +98 on a step
of B. A note start on a stolen voice saves up to 90 cycles (557 against
647). The build with no requests peaks at 669 cycles, on frame 97.

The frequency table is computed for the PAL clock. On NTSC the same
register values play about 3.8 % sharp (1,022,727 / 985,248, arithmetic),
and the tick, one in three frames on both, makes the tune 19.4 % fast
(59.826 / 50.125, arithmetic; an earlier version of this paragraph named
only the pitch). The mechanism and the trace do not depend on either. A
game that ships on both needs an NTSC frequency table and one tick count
skipped in six (`pal_ntsc_tempo_mismatch`, `pitfalls/region-timing.md`).

**Pattern space.** `voice` reads every pattern through `patdata,y`, so
the three patterns share the 256 bytes from `patdata`; this tune uses 79.
KickAssembler 5.25 assembles a `pstart` entry past 255 silently as its low
byte (measured: 230 bytes of padding before `v2pat` put its start at 259,
and `pstart` held `$03`). A longer tune needs a base per voice: a
zero-page pointer read with `(zp),y`, or the table address patched per
voice.

## Why this works

**The sequencer and the SID writes are separate.** `voice` updates the
duration, the pattern position and the note on every tick for every
voice, and only then asks `wflag` whether to write. An effect removes the
writes and leaves the counting alone, so the tune's timing cannot drift:
the trace's voice 3 and the post-effect notes match the build with no
effects store for store.

**The flag is recomputed after each voice, voice 3 first.** `play` sets
`wflag` to `$FF` before the loop and recomputes it from `fxon` after each
voice. Voice 3 runs before any recompute, so it always writes; voices 2
and 1 write only while no effect runs. The frame an effect ends, the
engine clears `fxon` after the voices ran, so the music's writes come
back on the next frame.

**The last write wins, and there is no latch.** On the start frame the
music writes voices 1 and 2 before the engine copies its image, and the
image stands. On the end frame the engine closes the gates; the music's
next note on each voice rewrites frequency, pulse width, AD, SR and
control, so no restore is needed.

**The request is one store.** `sfx_request` stores the number in `fxreq`.
The engine starts whatever is there at its next call, so a request made
while an effect runs replaces it.
