---
recipe: logic-rate-decoupling
toolchain: kickassembler
output_format: PRG
region: both
techniques: [logic_rate_decoupling]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D019, D01A, D020, D021, D027, DC0D]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Game logic at half the display rate, sprites interpolated

## Synopsis

Eight sprites moved by game logic that runs once every two display
frames, drawn every frame with the position on the in-between frame
interpolated. The logic runs in the main loop and carries an artificial
load: every eighth tick runs a 40-page delay, about 51,440 cycles or 2.6
PAL frames by the instruction table before badlines and sprite DMA take
their share. A raster interrupt
below the display counts frames, owes the logic one tick every second
frame, and runs the display update with interrupts re-enabled behind a
re-entrancy guard; one display update is made to overrun on purpose so the
guard trips. The logic hands positions to the display through a
double-buffered table flipped by one byte. The screen shows display
frames, logic ticks, loop passes, skipped frames, guard trips, input
latency for two events, sprite 0's step on 32 consecutive frames, and a
PASS/FAIL check that game time kept to half the display frame count. The
technique is `logic_rate_decoupling` in `techniques/logic.md`.

## Source

```asm
// logic-rate-decoupling.asm: game logic at half the display rate.
// Main loop: the game logic, one tick per two display frames, with an
// artificial load that overruns on every eighth tick. Raster IRQ at line
// 251: counts display frames, owes the logic one tick every second frame,
// and runs the display update with interrupts re-enabled, guarded so a
// nested entry skips it. The update shows the midpoint between the last
// two logic positions on the frame after a publish and the newer position
// on the frames after that. The screen shows the counters, the input
// latency, sprite 0's per-frame step, and a PASS/FAIL check on game speed.
// Build: java -jar KickAss.jar logic-rate-decoupling.asm -o logic-rate-decoupling.prg

BasicUpstart2(start)

.encoding "screencode_upper"

.const SCREEN   = $0400
.const IRQLINE  = 251       // below the lowest sprite (y 226, 21 lines)
.const NSPR     = 8
.const LIGHT    = 3         // delay pages for an ordinary logic tick
.const HEAVY    = 40        // delay pages for every eighth tick
.const SPIKE    = 60        // display frame whose update overruns once
.const SPIKEPG  = 20        // delay pages in that update
.const EVT_A    = 100       // input event on an even frame: sprite 6 starts
.const EVT_B    = 131       // input event on an odd frame: sprite 7 starts
.const DSTART   = 160       // first frame of the sprite-0 step record
.const REST6    = 40        // rest x of sprite 6 before its event
.const REST7    = 140       // rest x of sprite 7 before its event

* = $0810

start:
    sei
    lda #$7f
    sta $dc0d               // CIA1 timer IRQ off: only the raster reaches $0314
    lda $dc0d
    lda #0
    sta $d020
    sta $d021
    ldx #0
!:  lda #$20
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
    bne !-
    ldx #0                  // labels, rows 0 to 12
!:  lda labels,x
    sta SCREEN,x
    lda labels + $100,x
    sta SCREEN + $100,x
    inx
    bne !-

    ldx #62                 // one solid sprite shape at $2000, block $80
    lda #$ff
!:  sta $2000,x
    dex
    bpl !-
    ldx #NSPR - 1
!:  lda #$80
    sta SCREEN + $3f8,x
    lda colours,x
    sta $d027,x
    lda lx,x                // both table halves start at the start position
    sta fromx,x
    sta fromx + 8,x
    sta tox,x
    sta tox + 8,x
    dex
    bpl !-
    ldx #0
    ldy #0
!:  lda ypos,x
    sta $d001,y
    lda lx,x
    sta $d000,y
    iny
    iny
    inx
    cpx #NSPR
    bne !-
    lda #0
    sta $d010
    lda #$ff
    sta $d015

    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #IRQLINE
    sta $d012
    lda $d011
    and #$7f
    sta $d011
    lda #1
    sta $d01a
    lda #$ff
    sta $d019
    cli

// ---------------------------------------------------------------------------
// Main loop: the game logic. Runs every tick it is owed, publishes once.
// ---------------------------------------------------------------------------
mainloop:
!:  lda owed                // wait until the IRQ owes a tick
    beq !-
    lda #0
    sta batch
runtick:
    dec owed                // one RMW instruction: the IRQ cannot split it
    jsr logic_tick
    inc ticks
    bne !+
    inc ticks + 1
!:  inc batch
    lda owed                // still owed: run again before publishing,
    bne runtick             // so game speed holds while the display skips
    inc passes
    bne !+
    inc passes + 1
!:  ldx batch               // every tick past the first went undisplayed
    dex
    txa
    clc
    adc skipped
    sta skipped
    bcc !+
    inc skipped + 1

// Publish: write the half the IRQ is not reading, then flip one byte.
!:  lda fresh               // the IRQ has not taken the last table yet
    bne !-
    lda front
    eor #1
    asl
    asl
    asl
    tay                     // Y = back half * 8
    ldx #0
!:  lda prevx,x
    sta fromx,y
    lda lx,x
    sta tox,y
    iny
    inx
    cpx #NSPR
    bne !-
    lda front
    eor #1
    sta ready
    lda #1
    sta fresh               // one store hands the table over

    jsr show_counters
    lda checked
    bne !+
    jsr check_speed
!:  jmp mainloop

// One logic tick: input, movement with bounce, and the artificial load.
logic_tick:
    lda joyA                // an input event starts sprite 6
    cmp #1
    bne !+
    lda #2
    sta vx + 6
    sta joyA
!:  lda joyB                // and another starts sprite 7
    cmp #1
    bne !+
    lda #2
    sta vx + 7
    sta joyB
!:  ldx #NSPR - 1
tickspr:
    lda lx,x
    sta prevx,x             // the position before this tick, for interpolation
    lda vx,x
    beq nextspr
    bmi goleft
    lda lx,x
    cmp #236
    bcc !+
    lda #$fe
    sta vx,x
    jmp nextspr
!:  clc
    adc #2
    sta lx,x
    jmp nextspr
goleft:
    lda lx,x
    cmp #26
    bcs !+
    lda #2
    sta vx,x
    jmp nextspr
!:  sec
    sbc #2
    sta lx,x
nextspr:
    dex
    bpl tickspr
    lda ticks               // the artificial load
    and #7
    cmp #7
    bne !+
    lda #HEAVY
    jmp delay
!:  lda #LIGHT
    // fall through

// Delay: A pages of 256 DEY/BNE loops, about 1,286 cycles a page.
delay:
    tax
d1: ldy #0
!:  dey
    bne !-
    dex
    bne d1
    rts

// ---------------------------------------------------------------------------
// Raster IRQ, entered through the KERNAL at $0314 (A, X, Y already stacked).
// ---------------------------------------------------------------------------
irq:
    lda #$ff
    sta $d019               // acknowledge before CLI, or it re-enters at once
    inc frames              // timekeeping runs on every entry, nested or not
    bne !+
    inc frames + 1
!:  lda half
    eor #1
    sta half
    bne !+
    inc owed                // the speed counter: one tick per two frames
!:  lda frames + 1
    bne noevt
    lda frames
    cmp #EVT_A
    bne !+
    lda #1
    sta joyA
!:  cmp #EVT_B
    bne noevt
    lda #1
    sta joyB
noevt:
    inc busy                // re-entrancy guard
    lda busy
    cmp #2
    bcs nested
    cli                     // lower-level raster IRQs could now run
    jsr frame_update
    sei
    dec busy
    jmp $ea81
nested:
    inc guard
    dec busy
    jmp $ea81

// Display update: pick the table, write interpolated x to the VIC-II.
frame_update:
    lda fresh
    beq holdto
    lda ready
    sta front
    lda #0
    sta fresh
    lda #1                  // first frame of a new table: midpoint
    bne setmid
holdto:
    lda #0                  // later frames: the newer position
setmid:
    sta mid
    lda front
    asl
    asl
    asl
    tax                     // X = front half * 8
    ldy #0
fuloop:
    lda mid
    beq !+
    lda tox,x
    clc
    adc fromx,x             // (from + to) / 2: the carry holds bit 8
    ror
    jmp !++
!:  lda tox,x
!:  sta $d000,y
    sta shown,y
    inx
    iny
    iny
    cpy #NSPR * 2
    bne fuloop

    lda frames + 1          // one deliberate overrun of the update
    bne !+
    lda frames
    cmp #SPIKE
    bne !+
    lda #SPIKEPG
    jsr delay

!:  lda latA                // latency: frames from event to first motion
    bne !+
    lda joyA
    beq !+
    lda shown + 12
    cmp #REST6
    beq !+
    lda frames
    sec
    sbc #EVT_A
    sta latA
!:  lda latB
    bne !+
    lda joyB
    beq !+
    lda shown + 14
    cmp #REST7
    beq !+
    lda frames
    sec
    sbc #EVT_B
    sta latB

!:  lda shown               // sprite 0 step this frame, |x - last x|
    sec
    sbc last0
    bcs !+
    eor #$ff
    adc #1
!:  cmp #10
    bcc !+
    lda #9
!:  tay
    lda shown
    sta last0
    lda frames + 1
    bne fudone
    lda frames
    sec
    sbc #DSTART
    cmp #32
    bcs fudone
    tax
    lda hexdig,y
    sta SCREEN + 7 * 40 + 8,x
fudone:
    rts

// ---------------------------------------------------------------------------
// Screen output.
// ---------------------------------------------------------------------------
.macro print16(src, dst) {
    lda src + 1
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdig,x
    sta dst
    lda src + 1
    and #15
    tax
    lda hexdig,x
    sta dst + 1
    lda src
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdig,x
    sta dst + 2
    lda src
    and #15
    tax
    lda hexdig,x
    sta dst + 3
}

show_counters:
    sei                     // frames is two bytes the IRQ writes
    lda frames
    sta fcopy
    lda frames + 1
    sta fcopy + 1
    cli
    print16(fcopy, SCREEN + 1 * 40 + 8)
    print16(ticks, SCREEN + 2 * 40 + 8)
    print16(passes, SCREEN + 3 * 40 + 8)
    print16(skipped, SCREEN + 4 * 40 + 8)
    lda guard
    sta gcopy
    print16(gcopy, SCREEN + 5 * 40 + 8)
    lda latA
    sta lcopy
    lda latB
    sta lcopy2
    print16(lcopy, SCREEN + 6 * 40 + 8)
    print16(lcopy2, SCREEN + 6 * 40 + 13)
    rts

// At the first publish on or after frame 256: game time must equal half
// the display frames, less at most one owed tick, and the load must have
// forced at least one frame skip and one guard trip.
check_speed:
    lda fcopy + 1
    bne !+
    rts
!:  lda #1
    sta checked
    print16(fcopy, SCREEN + 8 * 40 + 9)
    print16(ticks, SCREEN + 8 * 40 + 20)
    lda fcopy + 1           // want = frames / 2
    lsr
    sta want + 1
    lda fcopy
    ror
    sta want
    sec                     // lag = want - ticks
    lda want
    sbc ticks
    sta lag
    lda want + 1
    sbc ticks + 1
    bne fail                // negative, or 256 or more
    lda lag
    cmp #2
    bcs fail
    lda skipped
    ora skipped + 1
    beq fail
    lda guard
    beq fail
    ldx #3
!:  lda passtxt,x
    sta SCREEN + 8 * 40 + 25,x
    dex
    bpl !-
    lda #5                  // green border
    sta $d020
    rts
fail:
    ldx #3
!:  lda failtxt,x
    sta SCREEN + 8 * 40 + 25,x
    dex
    bpl !-
    lda #2                  // red border
    sta $d020
    rts

// ---------------------------------------------------------------------------
// Data.
// ---------------------------------------------------------------------------
hexdig:  .text "0123456789ABCDEF"
passtxt: .text "PASS"
failtxt: .text "FAIL"
colours: .byte 1, 7, 3, 5, 14, 10, 13, 15
ypos:    .byte 124, 140, 156, 172, 188, 204, 226, 226
lx:      .byte 24, 54, 84, 114, 144, 174, REST6, REST7
vx:      .byte 2, 2, $fe, 2, $fe, 2, 0, 0
prevx:   .fill NSPR, 0
fromx:   .fill 16, 0
tox:     .fill 16, 0
shown:   .fill 16, 0
frames:  .word 0
ticks:   .word 0
passes:  .word 0
skipped: .word 0
fcopy:   .word 0
gcopy:   .word 0
lcopy:   .word 0
lcopy2:  .word 0
want:    .word 0
owed:    .byte 0
half:    .byte 0
batch:   .byte 0
busy:    .byte 0
guard:   .byte 0
fresh:   .byte 0
ready:   .byte 0
front:   .byte 0
mid:     .byte 0
joyA:    .byte 0
joyB:    .byte 0
latA:    .byte 0
latB:    .byte 0
last0:   .byte 24
checked: .byte 0
lag:     .byte 0

labels:
    .text "LOGIC AT HALF RATE, SPRITES INTERPOLATED"   // row 0
    .text "FRAMES                                  "   // row 1
    .text "TICKS                                   "   // row 2
    .text "PASSES                                  "   // row 3
    .text "SKIPPED                                 "   // row 4
    .text "GUARD                                   "   // row 5
    .text "LATENCY                                 "   // row 6
    .text "STEP                                    "   // row 7
    .text "AT FRAME       TICKS                    "   // row 8
    .text "                                        "   // row 9
    .fill 512 - 400, $20
```

## Build

```bash
java -jar KickAss.jar logic-rate-decoupling.asm -o logic-rate-decoupling.prg
```

Built with KickAssembler 5.25. Code and data occupy `$0810`-`$0F9D`; the
labels block is 512 bytes of that.

## Expected output

Every figure below was measured in VICE x64sc 3.10 (rung 1) from the exit
screenshot of the pinned run at 10,000,000 cycles, text decoded against
the `chargen-901225-01.bin` glyphs and sprites located by colour with PIL.
Two runs per model gave byte-identical PNGs.

```text
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 10000000 [-model ntsc] -exitscreenshot out.png \
      -autostart logic-rate-decoupling.prg
```

| Row | PAL (`screenshots/logic-rate-decoupling.png`) | NTSC (`screenshots/logic-rate-decoupling-ntsc.png`) |
|---|---|---|
| `FRAMES` | `0164` (356) | `018E` (398) |
| `TICKS` | `00B2` (178) | `00C7` (199) |
| `PASSES` | `009C` (156) | `00AF` (175) |
| `SKIPPED` | `0016` (22) | `0018` (24) |
| `GUARD` | `0001` | `0001` |
| `LATENCY` | `0001 0002` | `0001 0001` |
| `STEP` | `10003211111111111000321111111111` | the same |
| check row | `AT FRAME 0103  TICKS0081 PASS` | the same |

The border is green on both (PASS; red would be FAIL). Eight solid
24-pixel sprites sit below the text. On PAL sprite 0 is at X 97, an odd
number, so the shot caught a midpoint frame: every logic position is even.
On NTSC it is at X 52, a logic position.

What the rows show:

- **Game speed held.** `TICKS` is exactly half `FRAMES` on both models, and
  the check at frame 259 found 129 ticks against the 129 owed. `PASSES`
  counts trips round the main loop: 22 fewer than the ticks on PAL. A loop
  that ran one tick per pass, the one-step-per-frame form of
  `frame_sync_loop`, would have fallen 22 ticks behind, about 12% slow.
- **Skipped frames.** `SKIPPED` is `TICKS - PASSES`: ticks run back to back
  with no display in between.
- **Guard.** Display frame 60's update carries a 20-page delay, longer than
  a frame. The next raster interrupt arrived while it ran, counted its
  frame and owed its tick, found the guard set and returned. `GUARD` counts
  that one nested entry.
- **Latency.** Frames from an input event, raised by the interrupt at
  frames 100 and 131, to the first frame the responding sprite (6, then 7)
  was drawn moved. On PAL the event on the even frame, which is the frame
  that owes a tick, showed after 1 frame; the event on the odd frame waited
  for the next tick and showed after 2. On NTSC both showed after 1; why the
  odd event was quick there was not traced.
- **STEP.** Sprite 0's movement in pixels on frames 160 to 191. The logic
  moves it 2 pixels a tick; interpolation turns that into 1 pixel every
  frame. Frames 161 to 163 and 177 to 179 are 0: a heavy tick is running
  and the display holds the last table. Then 3 and 2 as the owed ticks run
  back to back and publish. The 32 steps sum to 32 pixels, 16 ticks of 2.
  Without interpolation the row would alternate 2 and 0.

The display update's own cost, the table pick and the interpolation loop
over eight sprites, was measured with CIA1 timer B around it in a harness
build (not this listing): 384 cycles on the midpoint frame, identical on
PAL and NTSC because line 251 onwards has no badline and no sprite DMA. The
same count comes from the instruction table: 49 cycles for the call and the
pick, 42 per sprite, one less for the last branch.

## Why this works

**Two clocks, one owner each.** The interrupt owns `frames` and `owed`,
the main loop owns `ticks`. The interrupt adds one to `owed` every second
frame whatever the logic is doing, and the logic takes one off with `DEC`,
which the interrupt cannot split. When a tick ends and `owed` is still not
zero the loop runs the next tick at once without publishing. That is the
frame skip, and it is why `TICKS` equals `FRAMES / 2` however long a tick
takes. The check at the first publish past frame 255 compares `frames / 2`
with `ticks`, allows one owed tick, and also requires a skip and a guard
trip so that a run where the load never overran cannot pass.

**Positions, not state.** The logic keeps `lx`, `vx` and everything else.
Before moving a sprite it copies `lx` to `prevx`. Publishing copies `prevx`
and `lx` into the half of the table the display is not reading, then sets
`ready` and, last, `fresh`. The display update takes a fresh table on the
next frame and shows `(from + to) / 2`: `ADC` leaves bit 8 in the carry and
`ROR` brings it back, so the average of two unsigned bytes is exact. On the
frames after that it shows `to`. The logic never writes the half in use,
because it waits for `fresh` to clear before writing, so a half-written
table is never drawn.

**The re-entrant update.** The interrupt acknowledges `$D019` first, does
the timekeeping, then increments `busy`. At 1 it runs `CLI` and calls the
update, so any lower-level raster interrupt (a split, a multiplexer) would
still be taken on time. At 2 it is a nested entry: it counts a guard trip
and leaves. The KERNAL's entry at `$FF48` has already pushed A, X and Y on
the stack and `$EA81` pulls them, so the nested entry corrupts nothing.
The interrupt line is 251, below the lowest sprite (Y 226 plus 21 lines),
so the sprite registers change after the beam has drawn every sprite. Bit 7
of `$D011` is cleared because 251 is below 256 (`d012_wrap_around`).

**What the listing leaves out.** Every X stays between 24 and 238, so
`$D010` stays 0; a game using the full width interpolates nine bits and
writes `$D010` in the same pass (`sprite_x_high_bit_wrong_register`). The
update uses `ADC` and `SBC` without `CLD` because nothing here sets decimal
mode; a program that does needs `CLD` at the top of the handler
(`decimal_mode_in_irq_handler`). The delay loop's cost in frames is
stretched by badlines and by the eight sprites' DMA, which is why the
heavy tick is given in pages, not frames. On NTSC the same listing runs the
logic at 30 Hz, so the sprites move 20% faster in real time
(`pal_ntsc_tempo_mismatch`); a game that must keep its speed on both
scales the movement per tick by region.
