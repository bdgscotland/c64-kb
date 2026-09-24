---
recipe: music-sync
toolchain: kickassembler
output_format: PRG
region: both
techniques: [music_sync_timeline]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, D40E, D40F, D412, D413, D414, D418, D41C, DC0D]
uses_kernal: []
claims: [irq_vector_0314 (owns), vic_raster_irq (owns), cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init), zero_page $FB-$FE (owns)]
ram: [colour=$D800-$DBFF]
kernal_services: [IRQ]
---

<!-- doc-type: recipe -->

# KickAssembler: a border flash on the beat from the player's row counter

## Synopsis

A stub player, called once a frame from a raster interrupt, advances one
row every 6 frames and strikes voice 3 on every fourth row. After each
call the interrupt reads the player's `row` and `tick` and turns the
border white for the first three frames of every beat row. It also reads
`$D41C`, voice 3's envelope, and shows it as a hex value and a bar. The
page is pinned twice on PAL and NTSC: once on a beat, once between beats.
The technique is `music_sync_timeline` in
[music-sid](../../techniques/music-sid.md).

## Source

```asm
// music-sync.asm - a stub player's row counter drives a $D020 flash on the beat
// Build: java -jar KickAss.jar music-sync.asm -o music-sync.prg
//
// The player advances one row every SPEED frames (a tracker's "speed").
// Every ROWS_PER_BEAT rows it strikes voice 3 (gate on); one row later it
// releases it. The effect reads the player's own counters, not the
// clock: the border is white for the first FLASH frames of every beat
// row. ENV3 ($D41C), the output of voice 3's envelope, is shown beside
// the counters as the other way to find the beat.

.const SPEED         = 6       // frames per row
.const ROWS_PER_BEAT = 4
.const ROWS          = 32      // rows per pattern
.const FLASH         = 3       // frames the border stays white
.const IRQ_LINE      = 251     // below the text window
.const BG            = 6       // blue
.const OFF           = 14      // light blue border between beats
.const ON            = 1       // white on the beat

.label frame   = $fb           // 16-bit frame counter
.label hexptr  = $fd           // screen pointer for the hex printer

.encoding "screencode_upper"

BasicUpstart2(start)

* = $0810 "Main"
start:
        sei
        lda #$7f
        sta $dc0d               // CIA 1 interrupts off: the raster IRQ is the only one
        lda $dc0d
        lda #BG
        sta $d021
        lda #OFF
        sta $d020
        ldx #0                  // clear the screen: spaces, light blue text
cls:    lda #' '
        sta $0400,x
        sta $0500,x
        sta $0600,x
        sta $06e8,x
        lda #OFF
        sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $dae8,x
        inx
        bne cls
title:  lda text,x
        beq !+
        sta $0400,x
        inx
        bne title
!:      ldx #0
labels: lda text2,x
        sta $0400+2*40,x
        lda text3,x
        sta $0400+3*40,x
        lda text4,x
        sta $0400+4*40,x
        inx
        cpx #40
        bne labels
        jsr init                // the player's init: SID reset, counters to 0
        lda #0
        sta frame
        sta frame+1
        lda #<irq
        sta $0314
        lda #>irq
        sta $0315
        lda #IRQ_LINE
        sta $d012
        lda $d011
        and #$7f
        sta $d011
        lda #1
        sta $d01a
        sta $d019
        cli
        jmp *

irq:    lda #1
        sta $d019
        jsr play                // once a frame, as a real player is called
        // ---- the sync: read the player's counters
        lda row
        and #ROWS_PER_BEAT-1
        bne off                 // not a beat row
        lda tick
        cmp #SPEED-FLASH+1      // tick counts SPEED..1 inside a row
        bcc off
        lda #ON
        bne border
off:    lda #OFF
border: sta $d020
        // ---- the readout
        inc frame
        bne !+
        inc frame+1
!:      ldy #7                  // column 7, row 2: frame counter
        lda #<($0400+2*40)
        ldx #>($0400+2*40)
        jsr at
        lda frame+1
        jsr hex
        lda frame
        jsr hex
        ldy #9                  // row 3: pattern, row, tick
        lda #<($0400+3*40)
        ldx #>($0400+3*40)
        jsr at
        lda pattern
        jsr hex
        ldy #17
        lda row
        jsr hex
        ldy #26
        lda tick
        jsr hex
        ldy #6                  // row 4: ENV3
        lda #<($0400+4*40)
        ldx #>($0400+4*40)
        jsr at
envrd:  lda $d41c               // ENV3: voice 3's envelope, 0-255
        sta env
        jsr hex
        ldy #11                 // and BEAT while the border is white
        ldx #0
        lda $d020
        and #$0f
        cmp #ON
        bne nobeat
!:      lda beattext,x
        sta (hexptr),y
        iny
        inx
        cpx #4
        bne !-
        beq bar
nobeat: lda #' '
!:      sta (hexptr),y
        iny
        inx
        cpx #4
        bne !-
bar:    lda env                 // row 6: a bar ENV3/8 characters long
        lsr
        lsr
        lsr
        tax
        ldy #0
!:      cpy #32
        beq done
        lda #' '
        cpx #0
        beq !+
        lda #$a0                // reverse space
        dex
!:      sta $0400+6*40,y
        iny
        bne !--
done:   jmp $ea81

at:     sta hexptr
        stx hexptr+1
        rts

// A in hex at (hexptr),y; Y advances by two.
hex:    pha
        lsr
        lsr
        lsr
        lsr
        tax
        lda digits,x
        sta (hexptr),y
        iny
        pla
        and #$0f
        tax
        lda digits,x
        sta (hexptr),y
        iny
        rts

digits: .text "0123456789ABCDEF"
text:   .text "MUSIC SYNC: SPEED 6, 4 ROWS A BEAT"
        .byte 0
text2:  .text "FRAME $0000                             "
text3:  .text "PATTERN $00 ROW $00 TICK $00            "
text4:  .text "ENV3 $00                                "
beattext: .text "BEAT"
env:    .byte 0

// ---- The stub player -------------------------------------------------
// init: silence the SID, set voice 3 up as a percussive noise hit.
init:   ldx #$18
        lda #0
!:      sta $d400,x
        dex
        bpl !-
        lda #$0f
        sta $d418               // volume 15
        lda #$00
        sta $d40e
        lda #$08
        sta $d40f               // voice 3 frequency $0800
        lda #$09
        sta $d413               // attack 0, decay 9
        lda #$00
        sta $d414               // sustain 0, release 0
        lda #0
        sta row
        sta pattern
        lda #1
        sta tick                // the first call starts row 0
        rts

// play: count down SPEED frames a row; on a new row strike or release voice 3.
play:   dec tick
        bne out
        lda #SPEED
        sta tick
        lda started
        beq first
        inc row
        lda row
        cmp #ROWS
        bne first
        lda #0
        sta row
        inc pattern
first:  lda #1
        sta started
        lda row
        and #ROWS_PER_BEAT-1
        bne !+
        lda #$81                // noise, gate on: the beat
        sta $d412
        rts
!:      cmp #1
        bne out
        lda #$80                // gate off one row later
        sta $d412
out:    rts

row:     .byte 0
pattern: .byte 0
tick:    .byte 0
started: .byte 0
```

## Build

```bash
java -jar KickAss.jar music-sync.asm -o music-sync.prg -vicesymbols
```

## Expected output

```bash
x64sc -default -warp -sound -sounddev dump -soundarg /dev/null +autostart-delay-random \
  -autostartprgmode 1 -limitcycles 10115000 -exitscreenshot music-sync.png -autostart music-sync.prg
```

The sound device matters. With `+sound`, which every other recipe uses,
`$D41C` does not return the envelope: the first seven reads on PAL were
`85 2E F5 BD 84 4B 40`, against `2F ED D9 C5 B1 9D 89` with the dump
device below. `-sounddev dump` writes the SID register stream
to `/dev/null` and keeps the SID emulated, as `sid-env3-filter` found.

Two pinned runs, text decoded from the PNGs against the character ROM
with PIL:

| Run | Model | Border | Frame | Pattern | Row | Tick | ENV3 | `BEAT` |
|---|---|---|---|---|---|---|---|---|
| 10,115,000 cycles, on the beat | PAL | white `(255, 255, 255)` | `$016A` | `$01` | `$1C` | `$05` | `$ED`, bar 29 cells | yes |
| | NTSC | white `(255, 255, 255)` | `$019A` | `$02` | `$04` | `$05` | `$F0`, bar 30 cells | yes |
| 9,950,000 cycles, off the beat (`@off`) | PAL | light blue `(115, 133, 255)` | `$0161` | `$01` | `$1A` | `$02` | `$00`, no bar | no |
| | NTSC | light blue `(98, 145, 251)` | `$0190` | `$02` | `$02` | `$03` | `$00`, no bar | no |

Row `$1C` and row `$04` are beat rows (multiples of 4); rows `$1A` and
`$02` are not. The cycle counts were chosen from a `trace store d020` over
the first 12,000,000 cycles of each model so that the border has the
same value one frame before and one frame after the exit on both models;
the exit screenshot can land mid-frame, and a flash lasts three frames.
The neighbouring count 10,110,000 showed why: on NTSC the ENV3 digits
were the new frame's `$F0` and the bar below them the previous frame's
5 cells, because the exit fell between the two text rows. Every border
pixel of the four pinned PNGs is one colour. Measured in VICE x64sc
3.10.

**The beat period.** The same trace logged the first flash of each beat,
from stopwatch 3,003,647 on PAL and 3,110,634 on NTSC. Beat to beat was
471,744 cycles on PAL and 410,280 on NTSC for most beats: exactly 24
frames of 19,656 and 17,095 cycles. The first beat and the one where the
pattern wraps were up to 15 cycles off, from the shorter and longer
paths through `play`. In time that is 0.479 s on PAL and 0.401 s on
NTSC, 125.3 and 149.6 beats a minute. The tune is the same number of
frames per beat on both; NTSC plays it faster.

**ENV3, read through the monitor.** A `-moncommands` file with
`ll "music-sync.vs"`, `trace exec 08f7` (the `sta env` after the read) and
`command 1 "m d41c d41c"`, logged, PAL:

```text
#1 (Trace  exec 08f7)  259/$103,   9/$09
.C:08f7  8D 0B 0A    STA .env       - A:2F X:04 Y:06 SP:f0 ..-..I..    3004038
>C:d41c  00
#1 (Trace  exec 08f7)  258/$102,  41/$29
.C:08f7  8D 0B 0A    STA .env       - A:ED X:04 Y:06 SP:f0 N.-..I..    3023663
>C:d41c  00
```

The value the CPU read is the `A:` in the register line. The monitor's
own read of `$D41C` printed `00` every time: it does not read the
envelope. Over one beat the CPU read, one value a frame from the strike:

| Model | ENV3 on frames 1-10 of the beat |
|---|---|
| PAL | `2F ED D9 C5 B1 9D 89 89 00 00` |
| NTSC | `2E F0 DE CD BB AA 99 99 18 00` |

The first read comes a few hundred cycles after the gate goes on, in the
same interrupt, with attack 0 still rising. Decay 9 then takes about
`$14` a frame on PAL and `$11` on NTSC, whose frames are shorter. On the
seventh frame `play` starts row 1 and clears the gate. The envelope then
held its value for one more read (`89 89` on PAL, `99 99` on NTSC)
before release 0 emptied it. That hold matches the ADSR bug in
[sid-reference](../../hardware/sid-reference.md): the switch from decay
9 to release 0 lowers the rate below the rate counter, which must wrap
first, up to 32,768 cycles. The hold was measured; that the ADSR bug
causes it is inferred from that page, not isolated here.

## Why this works

`play` is the only code that changes `row` and `tick`, and the interrupt
reads them right after calling it. `tick` counts 6 down to 1 inside a
row and is 6 on the frame the row starts, the frame the player writes
the gate. So "row a multiple of 4 and tick 4 or more" is exactly the first
three frames of every beat, with no clock of its own to drift. A real
player keeps the same counters (a speed counter and a row or pattern
position); the effect needs their addresses, from the player's source or
its symbol file.

ENV3 needs no counters at all: it is the chip's own envelope for voice 3.
It follows only voice 3, and only while the SID is emulated or real.
