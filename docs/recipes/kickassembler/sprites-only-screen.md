---
recipe: sprites-only-screen
toolchain: kickassembler
output_format: PRG
region: both
techniques: [sprites_only_screen_mode]
file_formats: [PRG]
uses_registers: [D011, D012, D019, D01A, D020, D021, D000, D001, D010, D015, D017, D01B, D01C, D01D, D027, DC04, DC05, DC0D, DC0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler: a sprites-only screen, no badlines and no vertical border

## Synopsis

Turns the frame into a surface that shows sprites and nothing else, and
gives the CPU every cycle that is not sprite DMA. Three things are done to
`$D011` from five plain raster interrupts: DEN is clear while line 48
passes, so the badline condition is never met and the character display
never fetches a row; DEN is set for the top comparison at line 51, so the vertical border flip-flop is reset once; and
RSEL is clear while line 251 passes, so the flip-flop is never set again.
With `$3FFF` zero the idle graphics sequencer draws plain background, the
border and background are both black, and eight white ring sprites stand
at Y 8, 30, 60, 100, 140, 200, 240 and 252, two of them where the border
would normally be.

The main loop is a fixed twenty-cycle loop that counts its iterations, and
the last interrupt of each frame latches the count. Iterations times
twenty is the CPU time the frame left free, so the same listing measures
the cycles the mode saves. Three build variants are controls: `NORMAL` keeps
`$D011 = $1B` in every slot, `NOBORDER` keeps DEN clear and never sets it,
`NOSPRITES` leaves `$D015` at zero.

Verified in VICE x64sc 3.10 (PAL C64C, VIC-II 8565, and NTSC 6567R8): the
picture holds two colours only, black and white; sprites at Y 8 and Y 252
are drawn; the free-CPU meter reads 904 iterations a frame on PAL against
847 for the ordinary screen; and both controls behave as the mechanism
predicts. Every figure below is from those runs.

## Source

```asm
// sprites-only-screen.asm
// A frame with no badlines and no vertical border: the character display
// is switched off for the whole frame (DEN clear while line 48 passes, so
// the badline condition is never met), the vertical border flip-flop is
// reset once at line 51 (DEN set for that one moment) and never set again
// (RSEL clear while line 251 passes), and $3FFF, the idle graphics byte,
// is zero so the sequencer draws plain background. What remains on the
// screen is the sprites and nothing else, and what remains for the CPU is
// every cycle except sprite DMA and the five interrupts below.
//
// Frame plan, one raster interrupt per row of the table:
//   line  40  $D011 = $0B  DEN clear before line 48: no badlines this frame
//   line  50  $D011 = $1B  DEN set before line 51: the flip-flop resets
//   line  53  $D011 = $0B  DEN clear again; nothing sets the flip-flop
//   line 249  $D011 = $03  RSEL clear before line 251: 251 is not a match
//   line 253  $D011 = $0B  RSEL set again: next frame's 247 is not either
//
// Eight ring sprites stand at Y 8, 30, 60, 100, 140, 200, 240 and 252,
// two of them where the border would be. The main loop is a fixed
// twenty-cycle loop that counts its iterations; the line-253 handler
// latches the count once per frame, so iterations x 20 is the CPU time
// the frame left free. Counting stops after 300 frames.
//
// Build variants (-define): NORMAL keeps $D011 = $1B in every slot (the
// ordinary text screen, borders closed); NOBORDER keeps $0B in every slot
// (DEN never set: border everywhere); NOSPRITES leaves $D015 clear.

.const FRAMES_TO_COUNT = 300

.const cnt     = $0340      // 16-bit iteration counter, main loop
.const prev    = $0342      // its value at the last latch
.const meter   = $0344      // iterations in the last counted frame
.const frames  = $0346      // frames counted, 16-bit
.const done    = $0348      // 1 once FRAMES_TO_COUNT frames are in
.const d011_rd = $0349      // $D011 as read in the last handler
.const d012_rd = $034a      // $D012 as read in the last handler
.const step    = $034b      // index into the tables below
.const ticks   = $034c      // five bytes: CIA1 timer A low byte per handler

BasicUpstart2(start)

// The ring, 24 x 21, one shape shared by all eight sprites.
* = $0e00
ring:
    .byte %00000000, %00000000, %00000000
    .byte %00000001, %11111111, %10000000
    .byte %00000111, %11111111, %11100000
    .byte %00001111, %11111111, %11110000
    .byte %00011111, %00000000, %11111000
    .byte %00111100, %00000000, %00111100
    .byte %01111000, %00000000, %00011110
    .byte %01110000, %00000000, %00001110
    .byte %01110000, %00000000, %00001110
    .byte %01110000, %00000000, %00001110
    .byte %11110000, %00000000, %00001111
    .byte %01110000, %00000000, %00001110
    .byte %01110000, %00000000, %00001110
    .byte %01110000, %00000000, %00001110
    .byte %01111000, %00000000, %00011110
    .byte %00111100, %00000000, %00111100
    .byte %00011111, %00000000, %11111000
    .byte %00001111, %11111111, %11110000
    .byte %00000111, %11111111, %11100000
    .byte %00000001, %11111111, %10000000
    .byte %00000000, %00000000, %00000000
    .byte 0

* = $0900
line_tab:
    .byte 40, 50, 53, 249, 253
d011_tab:
#if NORMAL
    .byte $1b, $1b, $1b, $1b, $1b
#elif NOBORDER
    .byte $0b, $0b, $0b, $0b, $0b
#else
    .byte $0b, $1b, $0b, $03, $0b
#endif
sprite_y:
    .byte 8, 30, 60, 100, 140, 200, 240, 252

start:
    sei
    lda #$7f
    sta $dc0d                // mask every CIA1 source
    lda $dc0d                // and drop a pending one
    lda #$ff
    sta $dc04                // timer A latch $FFFF; each handler restarts it
    sta $dc05

    lda #0
    sta $3fff                // idle graphics byte: nothing to draw
    sta $d020                // border black
    sta $d021                // background black
    sta $d017                // no expansion
    sta $d01d
    sta $d01c                // single colour
    sta $d01b                // sprites in front
    ldx #11
clear:
    sta cnt,x                // cnt .. step
    dex
    bpl clear

    ldx #7                   // sprite k: X = 40 + 36 k, Y from the table
    ldy #14                  // register pair offset 2 k
place:
    txa
    asl
    asl                      // 4 k
    sta $02
    asl
    asl
    asl                      // 32 k
    clc
    adc $02                  // 36 k
    adc #40
    sta $d000,y
    lda sprite_y,x
    sta $d001,y
    lda #ring / 64
    sta $07f8,x
    lda #1
    sta $d027,x              // white
    dey
    dey
    dex
    bpl place
    lda #$c0
    sta $d010                // sprites 6 and 7 stand at X 256 and 292
#if NOSPRITES
    lda #$00
#else
    lda #$ff
#endif
    sta $d015

    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #$1b
    sta $d011                // the ordinary value until the first handler
    lda line_tab
    sta $d012
    lda #$01
    sta $d01a                // raster source on
    sta $d019                // stale flag off
    cli

// The free-CPU meter: exactly 20 cycles round, either way through.
loop:
    inc cnt                  // 6
    beq carry                // 2 not taken
    bit $ea                  // 3
    nop                      // 2
    nop                      // 2
    nop                      // 2
    jmp loop                 // 3   = 20
carry:                       // 6 + 3 taken
    inc cnt+1                // 6
    nop                      // 2
    jmp loop                 // 3   = 20

// One handler for the five slots. Entered on cycle 37-43 of its line
// through the KERNAL dispatcher; the $D011 write lands about 20 cycles in.
irq:
    lda #$19
    sta $dc0e                // timer A: one shot from $FFFF, starts now
    ldx step
    lda d011_tab,x
    sta $d011
    lda $d011
    sta d011_rd
    lda $d012
    sta d012_rd
    inx
    cpx #5
    bne next
    jsr latch                // the line-253 slot closes the frame
    ldx #0
next:
    stx step
    lda line_tab,x
    sta $d012
    lda #$01
    sta $d019
    ldx step
    lda $dc04
    sta ticks,x              // low byte of the count-down: cost so far
    jmp $ea81                // pla/tay/pla/tax/pla/rti

// Read the counter, adjusted if the interrupt fell between a low-byte
// wrap and its carry: the saved return address then points at the beq
// (with cnt now 0) or at carry, and the high byte is one short.
latch:
    lda done
    bne latched
    tsx
    lda cnt
    sta $02
    lda cnt+1
    sta $03
    lda cnt
    bne no_fix
    lda $0108,x              // PCH under the jsr and the six saved bytes
    cmp #>carry
    bne no_fix
    lda $0107,x              // PCL
    cmp #<carry
    beq fix
    cmp #<(loop + 3)         // the beq itself, not yet executed
    bne no_fix
fix:
    inc $03
no_fix:
    sec
    lda $02
    sbc prev
    sta meter
    lda $03
    sbc prev+1
    sta meter+1
    lda $02
    sta prev
    lda $03
    sta prev+1
    inc frames
    bne count_ok
    inc frames+1
count_ok:
    lda frames
    cmp #<FRAMES_TO_COUNT
    bne latched
    lda frames+1
    cmp #>FRAMES_TO_COUNT
    bne latched
    lda #1
    sta done
latched:
    rts
```

## Build

```bash
java -jar KickAss.jar sprites-only-screen.asm -o sprites-only-screen.prg
```

The controls are the same file with one symbol defined:

```bash
java -jar KickAss.jar sprites-only-screen.asm -define NORMAL    -o normal.prg
java -jar KickAss.jar sprites-only-screen.asm -define NOBORDER  -o noborder.prg
java -jar KickAss.jar sprites-only-screen.asm -define NOSPRITES -o nosprites.prg
```

`-showmem` reports the code segment at `$0900` to `$0A44`, 325 bytes, of
which 18 are the three tables, and the sprite block at `$0E00`, 64 bytes.

## Expected output

A black picture with eight white rings on it and nothing else: no text,
no frame, no top or bottom border. The rings stand in a row that steps
36 pixels right and irregularly down, the first one cut off by the top of
the picture and the last two in what is normally the bottom border.

Screenshot from the pinned run: `screenshots/sprites-only-screen.png`
(PAL, 384 by 272, screenshot row = raster line minus 16) and
`screenshots/sprites-only-screen-ntsc.png` (NTSC, 384 by 247, row = line
minus 28, wrapping into the next frame's lines 0 to 11 at the bottom).
Pinned at 12,000,000 cycles on both models. The picture is static from the
program's second frame, so the beam position at the limit does not change
it; for the record it is line 156, cycle 12 on PAL and line 252, cycle 25
on NTSC, arithmetic from the last traced interrupt entry (checked against
the six entries before it). Two runs per model gave byte-identical files:
MD5 `fa6585d3223bfdb7aecf0135e9683862` (PAL) and
`60d418e7941332ba382e22a614e0f85f` (NTSC).

Measured on the PAL screenshot with a script, none of it by eye:

- Exactly two colours in the picture, black and white. 1,518 white
  pixels. Not one pixel of border colour, background colour or text; the
  background is black too, so "no border" is read from the sprites, not
  from a colour change.
- White columns 48 to 71, 84 to 107, 120 to 143, 156 to 179, 192 to 215,
  228 to 251, 264 to 287 and 300 to 323: the eight sprites at screen X
  40 + 36 k, which the picture shows at X + 8.
- White rows by column: 0 to 12 (Y 8, whose first drawn line, 9, is above
  the picture), 16 to 34 (Y 30), 46 to 64, 86 to 104, 126 to 144, 186 to
  204, 226 to 244 (Y 240, lines 242 to 260), 238 to 256 (Y 252, lines 254
  to 272) and, in the first column again, 250 to 268: the Y 8 sprite's
  second copy, because its Y compare matches line 264 as well (264 and
  $FF is 8). The ring's first and last rows are blank, so each copy is 19
  rows of white.
- The lowest white row is 0 and the highest 268 of 271. The sprite at Y 8
  and the sprite at Y 252 are both drawn.

On the NTSC screenshot: two colours, 1,266 white pixels, the same eight
columns. The Y 252 sprite occupies rows 226 to 244, which is lines 254 to
262 and then 0 to 10 of the next frame; the sprite's row counter runs
through the frame wrap. The Y 8 sprite is drawn on lines 9 to 29, and the
NTSC picture begins at line 28, so only its last drawn row shows, row 0,
plus rows 245 and 246, which are lines 10 and 11 of the next frame. The Y
240 sprite is on rows 214 to 232. Lowest white row 0, highest 246 of 246.

The controls, each one symbol away from the listing:

- **`NORMAL`, `$D011 = $1B` in every slot.** The BASIC start-up screen
  with its text and blue frame, three colours plus white. 788 white
  pixels. White rows 46 to 64, 86 to 104, 126 to 144, 186 to 204 and 226
  to 234: the sprites at Y 60, 100, 140 and 200, and the top nine drawn
  lines of the Y 240 sprite (lines 242 to 250), which the border covers
  from line 251. The sprites at Y 8, 30 and 252 have no visible pixel.
  NTSC: 788 white pixels, rows 34 to 52, 74 to 92, 114 to 132, 174 to
  192 and 214 to 222, the same rows 12 higher.
- **`NOBORDER`, DEN clear in every slot and never set.** One colour in the
  picture, black, on both models: zero white pixels. The vertical border
  flip-flop is reset only while DEN is set, so it stays set from the
  first frame's line 251 onwards and the border colour covers everything,
  sprites included. Clearing DEN to remove the badlines without setting it
for that one line gives this picture.
- **`NOSPRITES`.** One colour, black, zero white pixels; this build exists
  for the meter, below.

If the picture is all black, either DEN never reached line 51 set
(`NOBORDER`) or the sprites are off. If the two bottom rings are missing
and the text is back, the slot table is the `NORMAL` one. If rings appear
in the border with a stripe pattern behind them, `$3FFF` is not zero.

### The free-CPU meter

The RAM at `$0340` was dumped from the monitor on the store to `done`
(`-moncommands` with `tr store 0348` and `m 0340 0350`); the store lands
at cycle 8,881,007 on PAL, 300 frames after the first interrupt at
2,990,271. `frames` read 300 in every run, `d011_rd` read `$0B` and
`d012_rd` 254 (the handler enters line 253 on cycle 37 to 43 and the read
is 25 cycles later, in line 254), so the writes landed where the table
says. `meter` is the iterations counted in frame 300; one iteration is 20
cycles.

| build | PAL iterations | PAL free cycles | NTSC iterations | NTSC free cycles |
|---|---|---|---|---|
| sprites-only (this listing) | 904 | 18,080 | 776 | 15,520 |
| `NORMAL` | 847 | 16,940 | 723 | 14,460 |
| `NOSPRITES` (sprites-only, `$D015` = 0) | 945 | 18,900 | 817 | 16,340 |
| `NORMAL` and `NOSPRITES` together | 891 | 17,820 | 763 | 15,260 |

A PAL frame is 19,656 cycles (312 lines of 63) and this NTSC frame 17,095
(263 lines of 65); those two are arithmetic, the rest of this section is
the table above and subtraction:

- Badlines cost 57 iterations on PAL and 53 on NTSC with the sprites on,
  1,140 and 1,060 cycles; 54 on both without them, 1,080 cycles. Twenty-
  five badlines at 40 to 43 cycles each is 1,000 to 1,075.
- Sprite DMA for these eight sprites costs 41 iterations, 820 cycles, on
  both models in this mode (44 and 40 iterations under the ordinary
  screen, where some sprite lines are also badlines).
- What is left in the `NOSPRITES` build, 756 cycles on PAL and 755 on
  NTSC, is the five interrupts through the KERNAL dispatcher, the meter's
  own latch included. The per-handler timer below puts the latch at about
  99 of those.
- The meter's resolution is one iteration. An earlier build of this
  listing, five bytes shorter before the `$D010` write was added, read 944
  where this one reads 945 with nothing else changed: the phase of the
  loop against the interrupt moves the count by one.

The CIA1 timer A low bytes in `ticks`, one per slot, give the handler's
cost from the `STA $DC0E` that starts the timer to the `LDA $DC04` that
reads it (the timer counts down from `$FFFF`; `$FF` minus the byte is the
figure): 58 cycles in every slot in the `NOSPRITES` build. With the
sprites on, the line-40 and line-50 handlers read 62 (63 on NTSC), stalled
by the Y 30 sprite's DMA, the line-249 handler 63 (the Y 240 sprite) and
the line-53 handler 58, no sprite there. The line-253 handler carries the
latch: 157 without sprites, 178 with two of them active. In the `NORMAL`
build the line-50 handler reads 105 (101 without sprites): it runs into
line 51, the first badline, and loses 43 cycles there. The same handler in
this listing reads 62, which is the badline not happening, measured from
inside the CPU.

## Why this works

### No badlines: DEN clear across line 48

The badline condition needs DEN to have been set at some point during
raster line `$30`, 48, and holds for the whole frame once it has been
(`hardware/vic-ii-reference.md`, the `$D011` section; Bauer §3.5). The
line-40 handler writes `$0B`, DEN clear, and the line-50 handler is the
next write, so DEN is clear for all of line 48 and no line of the frame
can be a badline. The VIC stays in its idle state: it fetches no video
matrix row, no character pointers and no graphics data, and the CPU loses
nothing to it on lines 51 to 250. The `NORMAL` control, whose slots all
write `$1B`, has DEN set on line 48 and its line-50 handler pays the
line-51 badline in the timer readings above.

### The border opens once and never closes

The vertical border flip-flop is reset when the raster reaches the top
comparison line, 51 with RSEL set, at cycle 63 and at the left edge, and
only while DEN is set; it is set when the raster reaches the bottom
comparison line, 251 with RSEL set or 247 with it clear, at the same two
moments (`hardware/vic-ii-reference.md`, "the vertical border flip-flop is
reset only if DEN is set at cycle 63 of the top comparison line"; Bauer
§3.9). Nothing else moves it.

So DEN must be set for the checks on line 51, and the line-50 write of
`$1B` does that; the line-53 write of `$0B` takes DEN away again with the
flip-flop already clear, and the flip-flop has no rule that reads DEN
except the reset. That is the only reason the line-50 and line-53 writes
exist. Leave them out and the picture is the `NOBORDER` control: black,
no sprite, because the flip-flop was set at line 251 of the first frame
and nothing has reset it since.

The bottom set is suppressed the way `topbottom-border-open.md` does it:
RSEL is set while line 247 passes (the checks look for 251), the line-249
write clears it (`$03`: DEN clear, RSEL clear, YSCROLL 3), so while line
251 passes the checks look for 247, and neither matches. The line-253
write puts RSEL back so that the next frame's line 247 is not a match
either. The write window is the one measured on that page, lines 248 to
250 for a handler entered through `$0314`; 249 is the middle of it.

With the flip-flop clear all frame and the display disabled, the graphics
sequencer is in its idle state everywhere and draws the byte at `$3FFF`
of the current VIC bank in colour 0 over the background (Bauer §3.7.3.9).
The listing writes `$3FFF` to zero, so what it draws is black background;
in VICE the byte reads zero anyway, and `topbottom-border-open.md` records
that measurement. Sprites are fetched and drawn regardless of DEN and of
the flip-flop, which is why they are the only thing left.

### The writes as values, not read-modify-write

`topbottom-border-open.md` reads `$D011`, changes one bit and writes it
back. This listing writes whole values from a table because every write
sets DEN and RSEL together and YSCROLL is fixed at 3; the table is also
what makes the controls one symbol away. Bit 7 is written as zero in
every slot, which is what a raster compare below 256 needs; a slot moved
above line 255 needs it set (`d012_wrap_around`).

### The meter

`loop` is 20 cycles round on both paths: `INC cnt` 6, `BEQ` 2 not taken,
`BIT $EA` 3, three `NOP`s 6, `JMP` 3; or `BEQ` 3 taken, `INC cnt+1` 6,
`NOP` 2, `JMP` 3. Sprite DMA and badlines stretch an iteration without
changing what it counts, so iterations times 20 is CPU time in the loop.
The latch reads a 16-bit counter that the loop updates in two
instructions; if the interrupt lands after the low byte wraps and before
the high byte is carried, the saved return address on the stack is either
the `BEQ` or `carry`, with `cnt` zero, and the latch adds the missing
carry before it subtracts. The difference from the previous latch is the
frame's count.

### The sprite that was not there

The design says X = 40 + 36 k, and for k = 6 and 7 that is 256 and 292,
above the eight bits of `$D000`. The first build of this listing left
`$D010` clear; sprite 6 was drawn at X 0, entirely under the left side
border, and the PAL picture had 1,322 white pixels and no ring in the
264 to 287 column. `$D010 = $C0` is the fix; the count went to 1,518 and
the column appeared (`sprite_x_high_bit_wrong_register` in
`pitfalls/sprite.md`).

### Region

`region: both`. The lines the mechanism cares about, 48, 51, 247 and 251,
are the same on the 6567R8, and the frame plan does not go near the NTSC
line count. Measured with `-model ntsc`: both controls give the same
result as on PAL, the meter table has its own NTSC column, and the
handler timer reads 63 rather than 62 on lines 40 and 50, one cycle more
of sprite stall on a 65-cycle line. The picture differs only in what the
shorter frame and VICE's 247-row window include, as itemised above.

## Sources

- Christian Bauer, *The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64*, 28 August 1996: §3.5 (the badline
  condition and the DEN test on line `$30`), §3.9 (the two border
  flip-flops and their six rules), §3.7.3.9 (the idle state and `$3FFF`),
  §3.8.1 (sprite Y compared against the low eight bits of the raster).
  https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
- This repository: `hardware/vic-ii-reference.md` (the `$D011` section:
  DEN on line `$30`, and the flip-flop reset needing DEN at cycle 63 of
  the top comparison line, both measured in VICE);
  `recipes/kickassembler/topbottom-border-open.md` (the RSEL write window
  and the `$3FFF` readback); `recipes/kickassembler/stable-raster-irq.md`
  (handler entry on cycle 37 to 43); `pitfalls/raster-and-badline.md`
  (`d012_wrap_around`, `idle_fetch_byte_shows_in_gaps`,
  `vic_bus_takeover_on_dma`); `pitfalls/sprite.md`
  (`sprite_x_high_bit_wrong_register`).
- VICE 3.10 x64sc, headless, `-model` default (PAL C64C) and `ntsc`
  (6567R8); KickAssembler 5.25. All row, column, colour and cycle figures
  on this page are from those runs.

## What it does not establish

- Real hardware. Every figure is VICE x64sc 3.10; the badline and border
  rules it relies on are Bauer's, measured here only in the emulator.
- NTSC beyond what the screenshot and the meter show: the 6567R56A with
  its 262-line, 64-cycle frame was not run.
- Whether the idle byte is read from `$3FFF` of the selected bank on
  every VIC revision; this listing runs in bank 0 and writes `$3FFF`
  there, and VICE read it back as zero before the write.
- What the mode costs with more than two sprites on a line; the eight
  here overlap at most two deep.
- Anything about the meter's absolute accuracy beyond one iteration:
  a different code alignment moved one control's count by one.
