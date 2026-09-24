---
recipe: bitfire-level-stream
toolchain: kickassembler
output_format: D64
region: both
techniques: [in_game_level_streaming, bitfire_loader]
file_formats: [PRG, D64]
uses_registers: [D000, D001, D011, D012, D015, D018, D019, D01A, D020, D021, D027, DC04, DC05, DC06, DC07, DC0D, DC0E, DC0F, DD0D]
uses_kernal: [SETLFS, SETNAM, LOAD]
---

<!-- doc-type: recipe -->

# KickAssembler Level Streaming with Bitfire

## Synopsis

Play a level while the next one loads. The game runs in a raster
interrupt at line 250: a sprite moves one pixel a frame, a position
counter advances, and one screen row is redrawn from the current level's
data every frame. The main program only loads and switches. Ten frames
into each level it asks Bitfire for the next level file, which lands in a
staging buffer at `$6000` while play goes on; at frame 300 of the level it
copies the staging buffer into the play buffer at `$4000` and relocates
the level's sixteen row pointers by `-$2000`, then checks every row
through the relocated pointers against a checksum KickAssembler computed.
Four levels of 4,128 bytes each are played in turn. A CIA1 timer pair
running one underflow per frame counts real frames beside the interrupt's
own count, so a frame with no interrupt shows up as a missed frame. A
`:block=1` build loads with interrupts off, as a loader that needs the
whole CPU would, as the control. Bitfire is used as a tool, as in
`bitfire-dd00-bank`; no Bitfire source is on this page. The technique is
`in_game_level_streaming` on `../../techniques/loaders-packers.md`.

## Source

```asm
// bitfire-level-stream.asm
// KickAssembler 5.25 writes bitfire-level-stream.prg (the game, booted from
// the disk) and level0.prg-level3.prg (four levels, each assembled for the
// staging buffer at $6000). Bitfire's d64write puts the game in the
// directory, Bitfire's installer beside it as a standard file, and the four
// levels in Bitfire's own format.
// The game runs in a raster interrupt. The main program loads the next
// level into the staging buffer while the current one is played, then at
// the level's end copies it into the play buffer at $4000 and relocates
// its row pointers by -$2000.
.encoding "screencode_upper"

// :block=1 is the control: the load runs with interrupts off, as a loader
// that needs the whole CPU would, and the missed-frame count must show it.
.var BLOCK = 0
.if (cmdLineVars.containsKey("block")) {
    .eval BLOCK = cmdLineVars.get("block").asNumber()
}

// loader/loader_kickass.inc as Bitfire 5a3964b's make writes it, default config.inc
.const bitfire_install_  = $1000       // the installer's entry; it loads at $1000
.const bitfire_loadraw_  = $f038       // A = file number; returns when the file is in

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const LOAD   = $ffd5

.const SCR     = $0400
.const PLAY    = $4000                 // the level being played
.const STAGE   = $6000                 // the level being loaded
.const ROWS    = 16                    // rows of 256 bytes per level
.const LSIZE   = 2 * ROWS + ROWS * 256 // pointer table, then the rows
.const NL      = 4                     // levels
.const LEN     = 300                   // frames a level lasts
.const AHEAD   = 10                    // frame of a level at which the next load starts
.const IRQLINE = 250
.const SPR     = $0340                 // sprite 0's shape

// zero page: Bitfire owns $00 (it must hold $37) and $02-$0C
.const src     = $10
.const dst     = $12
.const pos     = $14                   // 2 bytes, frames into the level
.const frames  = $16                   // 2 bytes, interrupt frames since start
.const missed  = $18                   // 2 bytes, frames without an interrupt
.const tbprev  = $1a                   // CIA1 timer B at the last interrupt
.const freeze  = $1b                   // 1 while the play buffer is rewritten
.const lvl     = $1c
.const t0      = $1d                   // 2 bytes
.const sum     = $1f
.const xr      = $20
.const ntsc    = $21
.const row     = $22                   // 2 bytes, screen pointer for the report
.const bad     = $24
.const started = $25
.const atend   = $26                   // set by the IRQ at frame LEN of a level

// ---------------------------------------------------------------
// The levels: a pointer table, then ROWS rows of LFSR bytes
// ---------------------------------------------------------------
.var sums = List()
.var xors = List()
.macro level(n) {
    * = STAGE
    .for (var r = 0; r < ROWS; r++) {
        .word STAGE + 2 * ROWS + r * 256
    }
    .var lfsr = $ace1 + n * $1111
    .var s = 0
    .var x = 0
    .for (var i = 0; i < ROWS * 256; i++) {
        .eval lfsr = (lfsr >> 1) ^ ((lfsr & 1) * $b400)
        .byte lfsr & $ff
        .eval s = (s + (lfsr & $ff)) & $ff
        .eval x = x ^ (lfsr & $ff)
    }
    .eval sums.add(s)
    .eval xors.add(x)
}
.segment L0 [outPrg="level0.prg"]
    level(0)
.segment L1 [outPrg="level1.prg"]
    level(1)
.segment L2 [outPrg="level2.prg"]
    level(2)
.segment L3 [outPrg="level3.prg"]
    level(3)
.segment Default

.macro puts(dst, src) {
    ldx #0
loop:
    lda src,x
    beq done
    sta dst,x
    inx
    bne loop
done:
}

BasicUpstart2(start)
start:
    lda $02a6                          // the KERNAL's PAL/NTSC flag: 0 = NTSC
    eor #1
    sta ntsc
    lda #1                             // LOAD"INSTALLER",8,1 to $1000
    ldx $ba
    ldy #1
    jsr SETLFS
    lda #t_inst_end - t_inst
    ldx #<t_inst
    ldy #>t_inst
    jsr SETNAM
    lda #0
    jsr LOAD
    jsr bitfire_install_

    sei
    lda #$35                           // the resident part is at $F000
    sta $01
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    ldx #0
    stx $d020
    stx $d021
    stx pos
    stx pos + 1
    stx frames
    stx frames + 1
    stx missed
    stx missed + 1
    stx freeze
    stx lvl
    stx bad
    stx started
    stx atend
clr:
    lda #$20
    sta SCR,x
    sta SCR + $100,x
    sta SCR + $200,x
    sta SCR + $2e8,x
    lda #1
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne clr
    ldx #62
spr:
    lda #$ff
    sta SPR,x
    dex
    bpl spr
    lda #SPR / 64
    sta SCR + $3f8
    lda #1
    sta $d015
    lda #7
    sta $d027
    lda #162                           // rows 14-16, clear of the report
    sta $d001
    puts(SCR, t_title)
    puts(SCR + 2 * 40, t_head)
    lda ntsc
    bne isntsc
    puts(SCR + 36, t_pal)
    jmp vid
isntsc:
    puts(SCR + 36, t_ntsc)
vid:
    lda #$14
    sta $d018
    lda #$1b
    sta $d011

    // level 0: loaded and put in place before play starts
    lda #0
    jsr bitfire_loadraw_
    jsr install                        // copy to PLAY, relocate, check

    // CIA1 timer A counts one frame of cycles; timer B counts its underflows.
    // Started at line 100, so the interrupt at line 250 never meets an underflow.
    ldx #<19655
    ldy #>19655
    lda ntsc
    beq cyc
    ldx #<17094                        // NTSC 6567R8: 263 lines of 65
    ldy #>17094
cyc:
    stx $dc04
    sty $dc05
    lda #$ff
    sta $dc06
    sta $dc07
    lda #$50                           // timer B: count timer A underflows, load
    sta $dc0f
w100:
    lda $d012
    cmp #100
    bne w100
    lda #$11                           // timer A: continuous, load, start
    sta $dc0e
    lda #$41                           // timer B: count timer A underflows, start
    sta $dc0f
    lda #IRQLINE
    sta $d012
    lda #<irq
    sta $fffe
    lda #>irq
    sta $ffff
    lda #1
    sta $d01a
    sta $d019
    cli

    // --- the level loop: load ahead, wait for the end, switch ---
next:
    inc lvl
    lda lvl
    cmp #NL
    beq finished
wahead:                                // play the first AHEAD frames undisturbed
    lda pos + 1
    bne go
    lda pos
    cmp #AHEAD
    bcc wahead
go:
    lda frames                         // frames the load takes, counted by the IRQ
    sta t0
    lda frames + 1
    sta t0 + 1
    .if (BLOCK != 0) {
        sei
    }
    lda lvl
    jsr bitfire_loadraw_               // blocks; the game keeps running in the IRQ
    .if (BLOCK != 0) {
        cli
    }
    jsr rowptr
    sec
    lda frames
    sbc t0
    tax
    lda frames + 1
    sbc t0 + 1
    ldy #3
    jsr puthex16                       // load frames
    lda pos                            // where the player was when it arrived
    ldx pos + 1
    ldy #9
    jsr puthexax
wend:
    lda atend                          // the IRQ compares both bytes of pos;
    beq wend                           // two reads here can tear (see page)
    lda frames
    sta t0
    lda frames + 1
    sta t0 + 1
    lda #1
    sta freeze                         // the IRQ stops drawing and advancing
    jsr install
    lda #0
    sta pos
    sta pos + 1
    sta atend
    sta freeze
    jsr rowptr
    sec
    lda frames
    sbc t0
    tax
    lda frames + 1
    sbc t0 + 1
    ldy #15
    jsr puthex16                       // frames the switch took
    jmp next

finished:
    sei
    puts(SCR + 20 * 40, t_frames)
    puts(SCR + 21 * 40, t_missed)
    lda #20
    jsr rowat
    lda frames
    ldx frames + 1
    ldy #14
    jsr puthexax
    lda #21
    jsr rowat
    lda missed
    ldx missed + 1
    ldy #14
    jsr puthexax
    lda bad
    ora missed
    ora missed + 1
    bne fail
    puts(SCR + 23 * 40, t_ok)
    lda #5
    sta $d020
    jmp *
fail:
    puts(SCR + 23 * 40, t_fail)
    lda #2
    sta $d020
    jmp *

// --- copy STAGE to PLAY, relocate the pointers, check through them ---
install:
    lda #<STAGE
    sta src
    lda #>STAGE
    sta src + 1
    lda #<PLAY
    sta dst
    lda #>PLAY
    sta dst + 1
    ldx #>(LSIZE + 255)
    ldy #0
cp: lda (src),y
    sta (dst),y
    iny
    bne cp
    inc src + 1
    inc dst + 1
    dex
    bne cp
    ldx #0                             // the relocation: every pointer's
rl: lda PLAY + 1,x                     // high byte moves by PLAY - STAGE
    clc
    adc #>(PLAY - STAGE)
    sta PLAY + 1,x
    inx
    inx
    cpx #2 * ROWS
    bne rl
    lda #0                             // sum and XOR of every row, read
    sta sum                            // through the relocated pointers
    sta xr
    ldx #0
ckr:
    lda PLAY,x
    sta src
    lda PLAY + 1,x
    sta src + 1
    cmp #>PLAY                         // a pointer left in STAGE counts as bad
    bcc ptrbad
    cmp #>(PLAY + LSIZE + 255)
    bcs ptrbad
    ldy #0
ckb:
    lda (src),y
    pha
    clc
    adc sum
    sta sum
    pla
    eor xr
    sta xr
    iny
    bne ckb
    inx
    inx
    cpx #2 * ROWS
    bne ckr
    jmp report
ptrbad:
    inc bad
report:
    jsr rowptr
    ldy #0
    lda #$0c                           // "L"
    sta (row),y
    iny
    lda lvl
    ora #$30
    sta (row),y
    ldy #21
    lda sum
    jsr puthexy
    ldy #24
    lda xr
    jsr puthexy
    ldx lvl
    ldy #27
    lda sum
    cmp esum,x
    bne ckbad
    lda xr
    cmp exor,x
    bne ckbad
    lda #$0f
    sta (row),y
    iny
    lda #$0b
    sta (row),y
    rts
ckbad:
    inc bad
    lda #$02
    sta (row),y
    iny
    lda #$01
    sta (row),y
    iny
    lda #$04
    sta (row),y
    rts

rowptr:                                // row = screen line 4 + lvl
    lda lvl
    clc
    adc #4
rowat:                                 // row = screen line A
    tax
    lda slo,x
    sta row
    lda shi,x
    sta row + 1
    rts

puthex16:                              // X = low, A = high, at (row),y
    pha
    txa
    tax
    pla
    stx t0 + 1
    jsr puthexy
    lda t0 + 1
    jmp puthexy
puthexax:                              // A = low, X = high, at (row),y
    pha
    txa
    jsr puthexy
    pla
puthexy:                               // A as two hex digits at (row),y; y += 2
    pha
    lsr
    lsr
    lsr
    lsr
    jsr nyb
    sta (row),y
    iny
    pla
    and #$0f
    jsr nyb
    sta (row),y
    iny
    rts
nyb:
    cmp #10
    bcc dig
    sbc #9
    rts
dig:
    ora #$30
    rts

// ---------------------------------------------------------------
// The game: one interrupt a frame at line 250
// ---------------------------------------------------------------
irq:
    pha
    txa
    pha
    tya
    pha
    lda #$ff
    sta $d019
    lda $dc06                          // frames by the CIA since the last IRQ
    ldx started
    bne tb
    inc started                        // the first IRQ only takes the value
    sta tbprev
    jmp moved
tb: tax
    lda tbprev
    stx tbprev
    sec
    sbc tbprev                         // normally 1; 0 after a late IRQ
    cmp #2
    bcc moved
    sbc #1                             // frames that passed without an IRQ
    clc
    adc missed
    sta missed
    bcc moved
    inc missed + 1
moved:
    inc frames
    bne f1
    inc frames + 1
f1: inc $d000                          // the sprite moves every frame
    lda freeze
    bne out
    inc pos
    bne p1
    inc pos + 1
p1: lda pos                            // frame LEN: tell the main loop
    cmp #<LEN
    bne p2
    lda pos + 1
    cmp #>LEN
    bne p2
    inc atend
p2: lda pos                            // draw 40 bytes of the current row
    lsr
    lsr
    lsr
    lsr
    and #ROWS - 1
    asl
    tax
    lda PLAY,x
    sta dst
    lda PLAY + 1,x
    sta dst + 1
    lda pos
    and #$3f
    tay
    ldx #0
drw:
    lda (dst),y
    and #$3f
    sta SCR + 12 * 40,x
    iny
    inx
    cpx #40
    bne drw
out:
    pla
    tay
    pla
    tax
    pla
    rti

slo:  .fill 25, <(SCR + i * 40)
shi:  .fill 25, >(SCR + i * 40)
esum: .fill NL, sums.get(i)
exor: .fill NL, xors.get(i)

.encoding "petscii_upper"
t_inst:    .text "INSTALLER"
t_inst_end:
.encoding "screencode_upper"
t_title:   .text "BITFIRE LEVEL STREAMING"
           .byte 0
t_pal:     .text "PAL"
           .byte 0
t_ntsc:    .text "NTSC"
           .byte 0
t_head:    .text "LV LOAD  AT    SWCH  SM XR"
           .byte 0
t_frames:  .text "IRQ FRAMES   $"
           .byte 0
t_missed:  .text "MISSED       $"
           .byte 0
t_ok:      .text "ALL LEVELS MATCH, NO FRAME MISSED"
           .byte 0
t_fail:    .text "FAILED"
           .byte 0
```

## Build

The Bitfire tools come from https://github.com/bboxy/bitfire, built with
`make` in its root, as in `bitfire-dd00-bank` (commit `5a3964b`). Then:

```bash
java -jar $KICKASS_JAR bitfire-level-stream.asm -o bitfire-level-stream.prg
cp bitfire/loader/installer installer
bitfire/d64write/d64write -c bitfire-level-stream.d64 -h "bitfire stream" -i c64kb \
  --boot bitfire-level-stream.prg -s installer \
  -b level0.prg -b level1.prg -b level2.prg -b level3.prg
x64sc -default -warp +sound +autostart-delay-random \
  -limitcycles 50000000 -exitscreenshot bitfire-level-stream.png \
  -autostart bitfire-level-stream.d64
```

KickAssembler writes the game PRG and, from four `outPrg` segments,
`level0.prg`-`level3.prg`, each assembled for the staging buffer at
`$6000`. The levels become Bitfire files 0-3, 17 blocks each. Add
`-model ntsc` for the NTSC run, and `:block=1` to the KickAssembler line
for the control; rebuild the disk after it.

## Expected output

PAL, at 50,000,000 cycles:

```
BITFIRE LEVEL STREAMING             PAL

LV LOAD  AT    SWCH  SM XR

L0                   2E CC OK
L1 0034  003E  000A  E3 F7 OK
L2 002F  0039  000A  6E 8A OK
L3 0027  0031  000A  8C DE OK
```

then, further down, one row of level bytes as characters, the sprite,
and:

```
IRQ FRAMES   $03A2
MISSED       $0000

ALL LEVELS MATCH, NO FRAME MISSED
```

The border is green. `LOAD` is the frames the interrupt counted while the
load call ran, `AT` the level frame at which the file was in, and `SWCH`
the frames the switch took; `SM` and `XR` are the level's sum and XOR read
through its relocated pointers, and `OK` means both match KickAssembler's
values and every pointer lies in the play buffer.

Measured on the windowless x64sc build of VICE 3.10 with true drive
emulation (rung 1). Every character cell was decoded against the
character ROM by a script, and two runs per model gave byte-identical
screenshots:

| Model | Build | Load frames, levels 1-3 | Level frame when in | Switch frames | IRQ frames | Missed |
|---|---|---|---|---|---|---|
| PAL | default | 52, 47, 39 | 62, 57, 49 of 300 | 10 each | 930 | 0 |
| NTSC | default | 52, 57, 47 | 62, 67, 57 of 300 | 12 each | 936 | 0 |
| PAL | `:block=1` | 1 each (no IRQ ran) | 11 | 10 each | 930 | 126 |
| NTSC | `:block=1` | 1 each | 11 | 12 each | 936 | 154 |

Each level file was in by frame 67 of 300, so the lookahead had at least
233 frames to spare on either model. No frame was missed while a file
loaded: the interrupt ran every frame and the sprite moved every frame.
The control shows the counter works: with interrupts off during the
load, 126 PAL frames passed without an interrupt over three loads. A
`trace exec` on the control's `SEI` and `CLI` timed those loads at
832,245, 936,399 and 775,651 cycles, 42.3, 47.6 and 39.5 frames, 129.4
frames in all; the 126 is those frames less the one per load on which
the late interrupt that `CLI` lets through ran.

The switch is the one pause. `trace exec` at its three steps gave, on
PAL, 75,024 to 75,030 cycles (3.8 frames) for copying seventeen pages and
relocating the sixteen pointers, and 136,863 cycles (7.0 frames) for the
check that reads every row back. The check is this page's instrument, not
part of the technique; without it a switch is under four frames.

The pictures are `../../figures/bitfire-level-stream-pal.png`,
`../../figures/bitfire-level-stream-ntsc.png` and, for the control,
`../../figures/bitfire-level-stream-block-pal.png`.

**Not pinned.** The listing gate assembles the source, but the verifier
cannot pin this run in `runs.json`: it can only attach a freshly
formatted blank disk, and this program boots from the D64 that
`d64write` writes. The pictures are under `docs/figures/`, and the
command above made them.

## Why this works

Bitfire's load call blocks the main program but not the interrupt: the
C64 clocks the transfer, so the handler can take any cycle between two
bit pairs and the drive waits. Putting the game in the interrupt and the
loader in the main program is what lets both run. The loads here took 39
to 57 frames for 17 blocks, and the game started each one ten frames into
a level of 300, so the file was always in with more than two thirds of
the level to go. How early a load must start is the load time plus the
margin a real disk needs (Sparkle's manual advises 10 to 20 frames after
a load, `sparkle_irq_loader`); both depend on where the head and the
sector are, which is why the three loads differ by 13 frames.

The level files all load to one staging address, because a Bitfire file
has one load address. The copy into the play buffer is what lets the
next load start while the level just copied is being played, and the
relocation is what makes one file layout work at either address: the
level's row table holds absolute pointers assembled for `$6000`, and
adding `-$2000` to each high byte moves them to `$4000`. The interrupt
stops drawing and advancing (`freeze`) for the switch, so it never reads
a half-copied row.

The main program learns that a level has ended from a flag the interrupt
sets when its 16-bit position reaches 300; it does not compare the
position itself. An earlier build of this recipe did, reading the low
byte and then the high byte in a loop, and it ended levels 2 and 3 at
frame 256: `trace exec` put 5,228,492 and 5,228,497 cycles between
switches, 266 frames with the 10 of the switch, where the first level
took 310. An
interrupt between the two reads paired a low byte of `$FF`, which passes
the low compare, with a high byte already incremented to 1. That build
was not kept, and a rebuild with the code moved did not show it, which is
how this fault hides. The pitfall is `irq_shared_word_torn_read` on
`../../pitfalls/cpu.md`.

The missed-frame count needs the CIA, not the interrupt: a counter the
interrupt increments cannot count the frames on which it did not run.
Timer A underflows once a frame (19,655 + 1 cycles PAL, 17,094 + 1 NTSC)
and timer B counts the underflows. Both start at raster line 100, so each
underflow falls a half frame away from the interrupt at line 250, and the
interrupt reads timer B's low byte: a step of 1 is a normal frame, 0 is
the frame after a late interrupt, and a step of n > 1 is n - 1 frames
without an interrupt. An earlier build treated the step of 0 as a wrap
and added 255; the control's count of 381 exposed it.
