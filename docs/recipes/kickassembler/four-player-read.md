---
recipe: four-player-read
toolchain: kickassembler
output_format: PRG
region: both
techniques: [four_player_read]
file_formats: [PRG]
uses_registers: [D000, D001, D011, D012, D015, D020, D021, D027, DC00, DC01, DC02, DC04, DC05, DC0D, DC0E, DD01, DD03]
uses_kernal: []
claims: [cia1_timer_b (init), cia1_tod (init), cia1_port_a (init)]
harness: [cia1_timer_a]
---

<!-- doc-type: recipe -->

# KickAssembler — Read four joysticks every frame through a user-port 4-player adapter

## Synopsis

Reads joysticks 1 and 2 from CIA1 and joysticks 3 and 4 from CIA2 port B
through a CGA/Protovision 4-player adapter, once per frame, and leaves
four bytes in the `$DC00` layout (bit 0 up, 1 down, 2 left, 3 right,
4 fire, 0 when pressed). It shows each player's directions and fire as
text and as four sprites, and prints the read's cost measured with a
CIA timer. Over a 100-frame window it counts fire presses per player and
checks the adapter. It writes `$01` to `$02FF` and turns the border green
when every check passes, `$02` and red otherwise. The technique is
`four_player_read` in `techniques/input.md`.

What a headless VICE run can drive, and what it cannot:

- **Fire on joysticks 3 and 4: driven.** VICE's permanent autofire
  presses fire on its own clock with no host input. The run sets 5
  presses a second on joystick 3 and 7 on joystick 4, so the two counts
  differ and a swapped fire bit would show.
- **Directions on joysticks 3 and 4: not driven.** Nothing in VICE 3.10
  moves them without a host keyboard or joystick: the headless build has
  neither, and the monitor's joyport command (binary monitor `0xa2`)
  accepts ports 1 and 2 only (`mon_joyport_set_output` in
  `src/monitor/monitor.c`). So the select line's effect on PB0-PB3 is not
  observed here; the page checks only that both selects read idle.
- **Joysticks 1 and 2: not driven.** Autofire on those ports holds a
  keyboard row or column low from power-on, and the autostart `RUN`
  never executed in the run that tried it. They are read and shown idle.

## Source

```asm
// four-player-read.asm
// Reads joysticks 1 to 4 every frame: ports 1 and 2 on CIA1, ports 3 and 4
// on the user port through a CGA/Protovision 4-player adapter on CIA2 port B.
// PB7 is the adapter's select output: 1 puts joystick 3's directions on
// PB0-PB3, 0 puts joystick 4's there. Fire 3 is PB4 and fire 4 is PB5 under
// either select. read4 leaves four bytes in the $DC00 layout: bit 0 up,
// 1 down, 2 left, 3 right, 4 fire, 0 = pressed.
//
// Self-check over a 100-frame window, then a live display with four sprites.
// Verdict at $02FF ($01 pass, $02 fail) and in the border (green, red).
.encoding "screencode_upper"

.const SCREEN   = $0400
.const RESULT   = $02ff
.const WINDOW   = 100           // frames in the self-check window
.const SPRBLK   = 13            // sprite data at $0340

.const J1       = $f0           // read4 output, one byte per player
.const J2       = $f1
.const J3       = $f2
.const J4       = $f3
.const zp_row   = $f7           // screen pointer for the printers
.const zp_tmp   = $f9
.const zp_prev  = $fa           // four bytes: last frame's J1-J4 ($fa-$fd)

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$7f
    sta $dc0d                   // no CIA1 interrupts: nothing scans the keyboard
    lda $dc0d
    lda #$ff
    sta $dc02                   // CIA1 port A all output (IOINIT's value)
    sta $dc00                   // no keyboard column driven: port 1 reads only joystick 1
    lda #$80
    sta $dd03                   // CIA2 DDR B: PB7 output (adapter select), PB0-PB6 input
    lda #$00
    sta $d020
    sta $d021
    jsr clear_screen
    jsr draw_labels
    jsr setup_sprites

// --- the DDR, read back ---------------------------------------------------
    lda $dd03
    sta ddr_seen
    ldy #2
    ldx #13
    jsr print_hex

// --- read4's cost: CIA1 timer A around a call, minus the same around a bare rts
    ldx #<read4
    ldy #>read4
    jsr time_call
    sta t_read
    ldx #<stub
    ldy #>stub
    jsr time_call
    sta t_stub
    lda t_read
    sec
    sbc t_stub                  // body cycles: the jsr and rts cancel
    sta body_cyc
    ldy #3
    ldx #12
    jsr print_dec
    lda body_cyc
    clc
    adc #12                     // plus jsr (6) and rts (6)
    ldy #3
    ldx #29
    jsr print_dec

// --- the window: one read4 per frame, count fire presses, check the adapter
    lda #$1f
    sta zp_prev
    sta zp_prev+1
    sta zp_prev+2
    sta zp_prev+3
    lda #WINDOW
    sta frames
win:
    jsr wait_frame
    jsr read4
    jsr count_presses
    jsr check_adapter
    jsr show_players
    dec frames
    bne win

// --- verdict ----------------------------------------------------------------
    lda mismatch
    ldy #11
    ldx #35
    jsr print_dec
    lda idle_bad
    ldy #12
    ldx #35
    jsr print_dec

    lda ddr_seen
    cmp #$80
    bne fail
    lda mismatch
    bne fail
    lda idle_bad
    bne fail
    lda presses
    ora presses+1
    bne fail                    // ports 1 and 2 are not driven: no presses there
    lda presses+2
    beq fail                    // port 3 saw no press: the input never arrived
    cmp presses+3
    bcs fail                    // port 4 runs the faster autofire: more presses than port 3
    lda #$01
    sta RESULT
    lda #5
    sta $d020
    ldx #0
!:  lda txt_pass,x
    sta SCREEN + 15*40 + 8,x
    inx
    cpx #4
    bne !-
    jmp live
fail:
    lda #$02
    sta RESULT
    lda #2
    sta $d020
    ldx #0
!:  lda txt_fail,x
    sta SCREEN + 15*40 + 8,x
    inx
    cpx #4
    bne !-

// --- live: the same read every frame, shown as text and sprites -----------
live:
    jsr wait_frame
    jsr read4
    jsr show_players
    jmp live

// ===========================================================================
// read4: the technique. Ports 1 and 2 from CIA1, ports 3 and 4 from CIA2
// port B with the select on PB7. 62 cycles of body, branch-free.
read4:
    lda $dc01                   // port 1
    and #$1f
    sta J1
    lda $dc00                   // port 2
    and #$1f
    sta J2
    lda #$80
    sta $dd01                   // select joystick 3
    lda $dd01
    and #$1f                    // directions PB0-PB3, fire 3 on PB4
    sta J3
    lda #$00
    sta $dd01                   // select joystick 4
    lda $dd01
    tax
    and #$0f                    // directions PB0-PB3
    sta J4
    txa
    and #$20                    // fire 4 is PB5
    lsr                         // move it to bit 4
    ora J4
    sta J4
    rts

stub:
    rts

// time_call: X/Y = routine address. Returns A = low byte of elapsed cycles
// from the timer start to its stop (the fixed overhead cancels in a difference).
time_call:
    stx tc_jsr+1
    sty tc_jsr+2
    lda #$ff
    sta $dc04
    sta $dc05
    lda #$11                    // force load, start, continuous
    ldy #$00
    sta $dc0e
tc_jsr:
    jsr stub                    // patched
    sty $dc0e                   // stop
    lda #$ff
    sec
    sbc $dc04                   // elapsed low byte; both calls are under 256 cycles
    rts

// wait_frame: return once per frame, as line 250 begins ($FA exists on PAL and NTSC)
wait_frame:
!:  lda $d011
    bmi !-
    lda $d012
    cmp #$fa
    bne !-
!:  lda $d012
    cmp #$fa
    beq !-
    rts

// count_presses: a press is a fire bit going from 1 (released) to 0
count_presses:
    ldx #3
!:  lda J1,x
    and #$10
    bne cp_next                 // released now
    lda zp_prev,x
    and #$10
    beq cp_next                 // was already held
    inc presses,x
cp_next:
    lda J1,x
    sta zp_prev,x
    dex
    bpl !-
    rts

// check_adapter: fire bits must not depend on the select, directions must be
// idle ($0F: nothing drives them headless) and PB6 high under both selects.
check_adapter:
    lda #$80
    sta $dd01
    lda $dd01
    sta raw3
    lda #$00
    sta $dd01
    lda $dd01
    sta raw4
    eor raw3
    and #$30                    // PB4, PB5: fire 3 and fire 4
    beq !+
    inc mismatch
!:  lda raw3
    and #$4f
    cmp #$4f
    bne ca_bad
    lda raw4
    and #$4f
    cmp #$4f
    beq ca_ok
ca_bad:
    inc idle_bad
ca_ok:
    lda J1
    and J2
    cmp #$1f                    // ports 1 and 2 idle as well
    beq !+
    inc idle_bad
!:  rts

// show_players: row 6+n: directions as U D L R or '-', fire as F or '-',
// and the press count; sprite n moves 12 px per held direction, white on fire.
show_players:
    ldx #0
sp_loop:
    stx pl
    lda row_lo,x
    sta zp_row
    lda row_hi,x
    sta zp_row+1
    lda J1,x
    sta zp_tmp
    ldy #17
    ldx #0
sp_dir:
    lsr zp_tmp
    lda dir_chr,x
    bcc !+
    lda #'-'
!:  sta (zp_row),y
    iny
    inx
    cpx #5
    bne sp_dir
    ldx pl
    lda presses,x
    ldy row_n,x
    ldx #25
    jsr print_dec
    ldx pl
    // sprite position: home plus 12 px per held direction
    txa
    asl
    tay                         // Y = 2 * player: $D000/$D001 index
    lda J1,x
    sta zp_tmp
    lda home_x,x
    lsr zp_tmp                  // up
    lsr zp_tmp                  // down
    lsr zp_tmp                  // left
    bcs !+
    sec
    sbc #12
!:  lsr zp_tmp                  // right
    bcs !+
    clc
    adc #12
!:  sta $d000,y
    lda J1,x
    sta zp_tmp
    lda #206
    lsr zp_tmp                  // up
    bcs !+
    sec
    sbc #12
!:  lsr zp_tmp                  // down
    bcs !+
    clc
    adc #12
!:  sta $d001,y
    lda J1,x
    and #$10
    beq !+
    lda colour,x
    .byte $2c                   // bit abs: skip the white load
!:  lda #1
    sta $d027,x
    inx
    cpx #4
    beq !+
    jmp sp_loop
!:  rts

setup_sprites:
    ldx #62
!:  lda sprite_src,x
    sta SPRBLK*64,x
    dex
    bpl !-
    ldx #3
!:  lda #SPRBLK
    sta SCREEN+$3f8,x
    dex
    bpl !-
    lda #$0f
    sta $d015
    lda #$00
    sta $d010
    sta $d01c
    sta $d017
    sta $d01d
    rts

clear_screen:
    ldx #0
!:  lda #' '
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$2e8,x
    lda #14
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne !-
    rts

// draw_labels: fixed text, one macro call per label
.macro label(row, col, str) {
    ldx #0
!:  lda txt,x
    sta SCREEN + row*40 + col,x
    inx
    cpx #str.size()
    bne !-
    jmp done
txt: .text str
done:
}

draw_labels:
    label(0, 0, "4-PLAYER READ: CGA/PROTOVISION ADAPTER")
    label(2, 0, "DDR B $DD03:    (WANT 80)")
    label(3, 0, "READ4 BODY:     CYC, AS JSR:     CYC")
    label(5, 0, "PORT SOURCE      UDLRF  PRESSES")
    label(6, 0, "P1 $DC01")
    label(7, 0, "P2 $DC00")
    label(8, 0, "P3 $DD01/80")
    label(9, 0, "P4 $DD01/00")
    label(11, 0, "FIRE BITS DIFFER BETWEEN SELECTS:")
    label(12, 0, "FRAMES WITH A NON-IDLE DIRECTION:")
    label(13, 0, "WINDOW: 100 FRAMES")
    label(15, 0, "RESULT:")
    rts

// print_hex: A at row Y, column X
print_hex:
    pha
    jsr set_row
    pla
    pha
    lsr
    lsr
    lsr
    lsr
    tay
    lda hex_chr,y
    ldy #0
    sta (zp_row),y
    pla
    and #$0f
    tay
    lda hex_chr,y
    ldy #1
    sta (zp_row),y
    rts

// print_dec: A (0-255) as three digits at row Y, column X
print_dec:
    pha
    jsr set_row
    pla
    ldx #'0'
!:  cmp #100
    bcc !+
    sbc #100
    inx
    bne !-
!:  pha
    txa
    ldy #0
    sta (zp_row),y
    pla
    ldx #'0'
!:  cmp #10
    bcc !+
    sbc #10
    inx
    bne !-
!:  pha
    txa
    ldy #1
    sta (zp_row),y
    pla
    clc
    adc #'0'
    ldy #2
    sta (zp_row),y
    rts

// set_row: zp_row = SCREEN + 40*Y + X
set_row:
    txa
    clc
    adc scr_lo,y
    sta zp_row
    lda scr_hi,y
    adc #0
    sta zp_row+1
    rts

// ===========================================================================
ddr_seen:   .byte 0
t_read:     .byte 0
t_stub:     .byte 0
body_cyc:   .byte 0
frames:     .byte 0
pl:         .byte 0
raw3:       .byte 0
raw4:       .byte 0
mismatch:   .byte 0
idle_bad:   .byte 0
presses:    .byte 0, 0, 0, 0

dir_chr:    .text "UDLRF"
hex_chr:    .text "0123456789ABCDEF"
txt_pass:   .text "PASS"
txt_fail:   .text "FAIL"
home_x:     .byte 60, 120, 180, 240
colour:     .byte 2, 3, 6, 8     // red, cyan, blue, orange
row_n:      .byte 6, 7, 8, 9
row_lo:     .fill 4, <(SCREEN + 40*(6+i))
row_hi:     .fill 4, >(SCREEN + 40*(6+i))
scr_lo:     .fill 25, <(SCREEN + 40*i)
scr_hi:     .fill 25, >(SCREEN + 40*i)

sprite_src:
    .fill 3, $ff
    .for (var r = 0; r < 19; r++) {
        .byte $c0, $00, $03     // a hollow square: the sides
    }
    .fill 3, $ff

```

## Build

```bash
java -jar $KICKASS_JAR four-player-read.asm -o four-player-read.prg
```

KickAssembler 5.25 produces a 1,635-byte PRG; the code segment runs
`$0900` to `$0E61`.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -userportdevice 3 \
      -extrajoystick1autofire -extrajoystick1autofiremode 1 -extrajoystick1autofirespeed 5 \
      -extrajoystick2autofire -extrajoystick2autofiremode 1 -extrajoystick2autofirespeed 7 \
      -exitscreenshot four-player-read.png -autostart four-player-read.prg
```

Add `-model ntsc` for the second picture. The flags, from `x64sc -help`
and the VICE 3.10 source:

- `-userportdevice 3` is VICE's "CGA userport joy adapter". Its wiring in
  `src/userport/userport_joystick.c` is the one the Protovision page
  gives: PB7 selects, PB0-PB3 carry the selected joystick's directions,
  PB4 is joystick 3's fire and PB5 joystick 4's.
- `-extrajoystick1autofire` sets the resource `JoyStick3AutoFire`
  (`src/joyport/joystick.c`); VICE's read function puts that joystick on
  PB4 for fire, and on PB0-PB3 when PB7 = 1. Measured: the speed-5
  autofire counted on PB4. VICE's pin-table comment in
  `userport_joystick.c` labels the joysticks the other way round; the code
  is what runs. The
  first run of this recipe used `-extrajoystick3autofire` and
  `-extrajoystick4autofire`, drove adapter ports 3 and 4, which the CGA
  adapter does not have, and counted no presses.
- Autofire mode 1 is permanent: fire is held for the first half of each
  press period, timed from the CPU clock (`get_joystick_autofire` in
  `src/joyport/joystick.c`), so two runs of the same PRG see the same
  presses.

## Expected output

Green border, black background, light blue text, four sprites. The screen
on PAL:

```text
row  0  4-PLAYER READ: CGA/PROTOVISION ADAPTER
row  2  DDR B $DD03: 80 (WANT 80)
row  3  READ4 BODY: 062 CYC, AS JSR: 074 CYC
row  5  PORT SOURCE      UDLRF  PRESSES
row  6  P1 $DC01         -----   000
row  7  P2 $DC00         -----   000
row  8  P3 $DD01/80      ----F   011
row  9  P4 $DD01/00      -----   015
row 11  FIRE BITS DIFFER BETWEEN SELECTS:  000
row 12  FRAMES WITH A NON-IDLE DIRECTION:  000
row 13  WINDOW: 100 FRAMES
row 15  RESULT: PASS
```

PASS means: `$DD03` reads `$80`; fire 3 arrives on PB4 and fire 4 on PB5,
in that order (a swap fails the count order); the fire bits do not change
with the select; the direction lines read idle. It does not show the
select routing directions, which VICE cannot drive headless.

On NTSC rows 8 and 9 read `009` and `012`; every other text row is the
same. `recipes/kickassembler/screenshots/four-player-read.png` (PAL, 384
by 272) and `four-player-read-ntsc.png` (NTSC, 384 by 247) were each
produced twice by the pinned command with identical bytes, and decoded by
matching every 8 by 8 cell against `chargen-901225-01.bin` (measured in
VICE x64sc 3.10). The border is palette index 5 on both models.

What each line shows:

- Row 2: `$DD03` reads back `$80`: PB7 output, PB0-PB6 input.
- Row 3: the read's body, 62 cycles, measured by CIA1 timer A around
  `jsr read4` minus the same around `jsr` to a bare `rts`, on both
  models. It matches the instruction table: 22 instructions, no branch,
  so every frame costs the same. 74 is the body plus `jsr` and `rts`
  (arithmetic).
- Rows 6 to 9: the live read at the moment of the screenshot, one
  letter per held line, and the presses counted in the window. Joystick
  3 shows `F` because autofire holds its fire at that cycle. The counts
  agree with VICE's autofire clock: 100 PAL frames are 1,965,600 cycles,
  2.0 seconds at 985,248 cycles a second, so about 10 presses at 5 a
  second and 14 at 7, give or take the phase of the first and last
  (arithmetic). On NTSC the window is 1,709,500 cycles, 1.67 seconds at
  1,022,727, so about 8 and 12. Every run of this PRG gave 11 and 15 on
  PAL and 9 and 12 on NTSC.
- Row 11: each frame the check reads `$DD01` under PB7 = 1 and PB7 = 0
  and compares PB4 and PB5. They never differed: the fire lines do not
  go through the select. The two reads are 14 cycles apart, so an
  autofire edge falling between them would count once; none did.
- Row 12: frames where PB0-PB3 were not `$F` or PB6 was low under
  either select, or where joystick 1 or 2 was not `$1F`. None: nothing
  drives a direction in this run.
- Sprites: red, cyan, blue and orange for players 1 to 4, at VIC X 60,
  120, 180 and 240, each moved 12 pixels per held direction and white
  while fire is held. Measured in the PAL and NTSC PNGs: each sprite
  covers X 60-83, 120-143, 180-203 and 240-263 and raster lines 207 to
  227 (sprite Y register 206); sprite 3 is white `(255, 255, 255)`,
  the others their colour's palette triple.

Two control runs, not pinned, with the same PRG and autofire flags:

- No `-userportdevice`: `$DD01` reads `$FF` under both selects, rows 8
  and 9 count 0 presses, and the result is FAIL.
- `-userportdevice 8`, VICE's Kingsoft adapter: row 8 counts 11 presses
  (the Kingsoft wiring also puts joystick 3's fire on PB4), row 9 counts
  0 (Kingsoft joystick 4's fire is on the serial pin SP2, not port B),
  and the result is FAIL. A 4-player read is written for one adapter.

## Why this works

With `$DD03` at `$80`, a write to `$DD01` drives only PB7; bits 0 to 6
stay inputs and the write does not touch them. PB7 goes to the adapter's
multiplexer, a 74LS257 in VICE's pin table, which passes joystick 3's
four direction lines to PB0-PB3 when PB7 is high and joystick 4's when
it is low. The two fire lines bypass the multiplexer and sit on PB4 and
PB5 all the time. So the read needs one select write before each
direction read, and joystick 4's fire has to be moved from bit 5 to
bit 4 to match the `$DC00` layout the rest of a game already decodes.

VICE changes the multiplexer at the store; a load 4 cycles later sees
the new joystick. No settle time on real hardware is measured here.

Ports 1 and 2 need `$DC00` to drive no keyboard column: the recipe writes
`$FF` there and owns the machine (`SEI`, CIA1 interrupts off), so no
KERNAL scan rewrites it between frames. With the KERNAL IRQ live, see
`pitfalls/input.md` for what the scan does to `$DC00`.
