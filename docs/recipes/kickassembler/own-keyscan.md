---
recipe: own-keyscan
toolchain: kickassembler
output_format: PRG
region: both
techniques: [irq_keyboard_own_scan]
file_formats: [PRG]
uses_registers: [DC00, DC01, DC02, DC03, DC04, DC05, DC0D, DC0E, D011, D012, D019, D01A, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Scan the keyboard matrix from your own raster IRQ, with edges, ages and a timed scan

## Synopsis

Masks the CIA1 interrupts so the KERNAL jiffy IRQ and its SCNKEY stop,
takes `$0314` with a raster IRQ on line 250, and in that IRQ walks one
low bit across the eight columns of `$DC00`, reading the rows from
`$DC01` into an eight-byte matrix image. It keeps last frame's image,
derives the pressed and released sets per column by XOR, ages four
watched keys (SPACE, Z, C, B: 0 up, 1 pressed this frame, N held N
frames), counts press events and auto-repeat events, writes `$FF` back
to `$DC00` and reads it as a joystick 2 poll would, and times the scan
with CIA1 Timer A around the scan, the read-back, the edge pass and
the ageing. Before the IRQ starts it runs the same age routine
over a compiled-in sequence of eight matrix images and counts
mismatches against an expected table. Verdict: `$02FF` = `$01` and a
green border when the synthetic sequence matched, no live frame read a
dirty matrix, `$DC00` read back high on every line but port 2's fire,
and the net cost is 700 to 1000 ticks; `$02` and red otherwise. The
technique is `irq_keyboard_own_scan` in `techniques/input.md`.

No key is pressed in the pinned run. VICE's `-keybuf` fills the KERNAL
buffer at `$0277`, which this program never reads, and the headless
build has no host keyboard. What the pinned run drives is port 2's fire
line, through VICE's own autofire (`-joydev2 2 -joystick2autofire
-joystick2autofiremode 1 -joystick2autofirespeed 5`): PA4 goes low five
times a second with nothing pressed on the host. The scan must not see
that as a key, and the `$DC00` read-back must. A second run, not
pinned, moves the autofire to port 1 from the monitor after the program
has started, which grounds row line PB4 and lets the matrix, the edge
sets and the age counters be watched on a driven input. Both are
described under Expected output.

## Source

```asm
// own-keyscan.asm
// A raster IRQ that scans the keyboard matrix itself, once a frame, with
// the KERNAL jiffy IRQ switched off. It keeps this frame's and last frame's
// eight-byte matrix image, derives the pressed and released sets by XOR,
// keeps a per-key age counter for four keys (0 = up, 1 = pressed this
// frame, N = held N frames), counts press events and auto-repeat events,
// times the eight-column scan with CIA1 Timer A, and checks the age logic
// against a compiled-in sequence of matrix images before the IRQ starts.
// Verdict: $02FF = $01 and a green border when the synthetic sequence
// matched, the scan cost is inside the window and $DC00 reads $FF after
// the restore; $02 and red otherwise.
.encoding "screencode_upper"

.const SCREEN     = $0400
.const RESULT     = $02ff
.const IRQ_LINE   = 250         // below the display: no badline inside the scan
.const NKEYS      = 4
.const REPEAT_AT  = 4           // first repeat event when a key has been held this many frames
.const REPEAT_MSK = 1           // then every 2 frames: (age - REPEAT_AT) & 1 == 0
.const NSYN       = 8           // frames in the synthetic sequence
.const NCHK       = 5           // bytes checked per synthetic frame
.const COST_LO    = 700         // pass window for the net cost, Timer A ticks, inclusive
.const COST_HI    = 1000        // (an earlier build compared a byte against 281, which the
                                // assembler truncates to 25, and every run read red)

.const zp_row     = $fb         // screen pointer for the printers
.const zp_tmp     = $fd
.const zp_i       = $02         // a free zero-page byte; $FE would be zp_tmp's high byte
.const zp_col     = $f9         // the IRQ's column mask; the main loop never touches it
.const zp_x       = $f7         // column counter for the eight-byte printer

BasicUpstart2(start)

* = $0900 "code"

start:
    sei
    lda #$7f
    sta $dc0d                   // mask every CIA1 interrupt: the jiffy IRQ and its SCNKEY stop here
    lda $dc0d                   // acknowledge anything pending
    lda #$ff
    sta $dc02                   // port A output: column drive (IOINIT's value, set again on purpose)
    lda #$00
    sta $dc03                   // port B input: row sense
    lda #$ff
    sta $dc00                   // no column selected
    sta prev                    // last frame's image starts empty
    sta prev+1
    sta prev+2
    sta prev+3
    sta prev+4
    sta prev+5
    sta prev+6
    sta prev+7
    lda #$00
    sta $d020
    sta $d021
    jsr clear_screen
    jsr draw_labels

// --- part A: the age logic on a compiled-in sequence of matrix images ---
    lda #0
    sta syn_bad
    sta zp_i
synloop:
    lda zp_i
    asl
    asl
    asl                         // frame * 8
    tax
    ldy #0
copysyn:
    lda syn_frames,x
    sta cur,y
    inx
    iny
    cpy #8
    bne copysyn
    jsr update_keys             // the same routine the IRQ runs
    lda zp_i
    asl
    asl
    adc zp_i                    // frame * 5
    tax
    lda ages
    cmp syn_expect,x
    bne synfail
    lda ages+2
    cmp syn_expect+1,x
    bne synfail
    lda repeats
    cmp syn_expect+2,x
    bne synfail
    lda pressed+7
    cmp syn_expect+3,x
    bne synfail
    lda released+7
    cmp syn_expect+4,x
    beq synok
synfail:
    inc syn_bad
synok:
    inc zp_i
    lda zp_i
    cmp #NSYN
    bne synloop

// reset every counter the synthetic pass touched, so the live run starts clean
    ldx #0
    txa
clrstate:
    sta ages,x
    sta presses,x
    sta repeats,x
    inx
    cpx #NKEYS
    bne clrstate
    lda #$ff
    ldx #0
clrimg:
    sta prev,x
    sta cur,x
    inx
    cpx #8
    bne clrimg
    lda #0
    sta pressed+7
    sta released+7

// --- part B: install the raster IRQ ---------------------------------------
    lda #<irq
    sta $0314
    lda #>irq
    sta $0315
    lda #IRQ_LINE
    sta $d012
    lda $d011
    and #$7f
    sta $d011
    lda #$01
    sta $d01a
    sta $d019
    lda #0
    sta frames
    cli

// --- main loop: show what the IRQ measured --------------------------------
main:
    lda frames
    cmp #100
    bcc main                    // let the scan settle for 100 frames before judging

    // matrix image, row 2
    ldy #2
    ldx #8
    lda #<cur
    sta zp_tmp
    lda #>cur
    sta zp_tmp+1
    jsr print_bytes8
    // pressed set, row 3; released set, row 4
    ldy #3
    ldx #8
    lda #<pressed
    sta zp_tmp
    lda #>pressed
    sta zp_tmp+1
    jsr print_bytes8
    ldy #4
    ldx #8
    lda #<released
    sta zp_tmp
    lda #>released
    sta zp_tmp+1
    jsr print_bytes8

    // per-key lines: age, presses, repeats
    ldx #0
keyline:
    txa
    pha
    stx zp_i
    txa
    clc
    adc #7
    tay                         // rows 7..10
    lda ages,x
    ldx #8
    jsr print_hex
    ldx zp_i
    lda presses,x
    ldy zp_i
    iny
    iny
    iny
    iny
    iny
    iny
    iny
    ldx #13
    jsr print_hex
    ldx zp_i
    lda repeats,x
    ldy zp_i
    iny
    iny
    iny
    iny
    iny
    iny
    iny
    ldx #18
    jsr print_hex
    pla
    tax
    inx
    cpx #NKEYS
    bne keyline

    // scan cost, frames, $DC00 read-back, synthetic mismatches
    lda net+1
    ldy #12
    ldx #8
    jsr print_hex
    lda net
    ldy #12
    ldx #10
    jsr print_hex
    lda cost+1
    ldy #12
    ldx #14
    jsr print_hex
    lda cost
    ldy #12
    ldx #16
    jsr print_hex
    lda cost0+1
    ldy #12
    ldx #20
    jsr print_hex
    lda cost0
    ldy #12
    ldx #22
    jsr print_hex
    lda frames
    ldy #13
    ldx #8
    jsr print_hex
    lda dc00_back
    ldy #14
    ldx #8
    jsr print_hex
    lda syn_bad
    ldy #15
    ldx #8
    jsr print_hex
    lda fire_seen
    ldy #16
    ldx #8
    jsr print_hex
    lda dirty
    ldy #17
    ldx #8
    jsr print_hex

    // verdict
    lda syn_bad
    bne fail
    lda dirty
    bne fail
    lda dc00_back
    ora #$10                    // port 2's fire line may be low; every other bit must read high
    cmp #$ff
    bne fail
    lda net+1
    cmp #>COST_LO
    bcc fail
    bne nothi_lo
    lda net
    cmp #<COST_LO
    bcc fail
nothi_lo:
    lda net+1
    cmp #>COST_HI
    bcc costok
    bne fail
    lda net
    cmp #<COST_HI+1
    bcs fail
costok:
    lda #$01
    sta RESULT
    lda #$05
    sta $d020
    jmp main
fail:
    lda #$02
    sta RESULT
    lda #$02
    sta $d020
    jmp main

// --- the IRQ: scan, derive, age, time ------------------------------------
irq:
    cld                         // D is not cleared on entry; arithmetic below
    lda #$01
    sta $d019                   // acknowledge the raster interrupt
    inc frames

    lda #$00
    sta $dc0e                   // stop Timer A while the latch is loaded (it is CIA1's, the jiffy clock: masked above)
    lda #$ff
    sta $dc04
    sta $dc05                   // latch = $FFFF
    lda #$11
    sta $dc0e                   // start, force load, continuous; ticks at the CPU clock
timed_start:

    ldx #0
    lda #$fe
    sta zp_col
scan:
    lda zp_col
    sta $dc00                   // one column low, seven high
    lda $dc01                   // bit r clear = key (column x, row r) down
    sta cur,x
    sec
    rol zp_col                  // walk the zero bit up: $FE, $FD, ... $7F
    inx
    cpx #8
    bne scan
    lda #$ff
    sta $dc00                   // restore: no column selected, so a joystick 2 read is clean

    lda $dc00
    sta dc00_back               // what a joystick 2 poll would see now
    jsr update_keys             // edges for eight columns, ages for four keys

scan_end:
    lda #$00
    sta $dc0e                   // stop, then read: cost = $FFFF - Timer A
    sec
    lda #$ff
    sbc $dc04
    sta cost
    lda #$ff
    sbc $dc05
    sta cost+1

    lda dc00_back
    and #$10
    bne nofire
    inc fire_seen               // frames in which port 2's fire line was low at this read
nofire:
    ldx #0
    lda #$ff
chkclean:
    and cur,x
    inx
    cpx #8
    bne chkclean
    cmp #$ff
    beq clean
    inc dirty                   // frames in which any matrix byte was not $FF
clean:

    lda #$ff
    sta $dc04
    sta $dc05
    lda #$11
    sta $dc0e                   // the same bracket around nothing: the start and stop stores' own share
    lda #$00
    sta $dc0e
    sec
    lda #$ff
    sbc $dc04
    sta cost0
    lda #$ff
    sbc $dc05
    sta cost0+1

    sec
    lda cost
    sbc cost0
    sta net
    lda cost+1
    sbc cost0+1
    sta net+1                   // net = scan, read-back, edges and ages

    jmp $ea81                   // KERNAL's bare exit: pull Y, X, A and RTI; no SCNKEY, no cursor

// update_keys: from cur and prev derive pressed (1 -> 0 edges) and released
// (0 -> 1 edges) per column, age the four watched keys, then prev = cur.
update_keys:
    ldx #0
edges:
    lda prev,x
    eor cur,x                   // bits that changed
    sta zp_col
    and prev,x                  // changed and was 1 (up): now down
    sta pressed,x
    lda zp_col
    and cur,x                   // changed and is 1 (up): was down
    sta released,x
    lda cur,x
    sta prev,x
    inx
    cpx #8
    bne edges

    ldx #0
agekeys:
    ldy key_col,x
    lda cur,y
    and key_bit,x
    bne keyup
    lda ages,x
    cmp #$ff
    beq agesat                  // hold at 255
    inc ages,x
agesat:
    lda ages,x
    cmp #1
    bne notnew
    inc presses,x               // age 1 = pressed this frame
notnew:
    lda ages,x
    cmp #REPEAT_AT
    bcc nextkey
    sec
    sbc #REPEAT_AT
    and #REPEAT_MSK
    bne nextkey
    inc repeats,x               // held REPEAT_AT frames, then every second frame
    jmp nextkey
keyup:
    lda #0
    sta ages,x
nextkey:
    inx
    cpx #NKEYS
    bne agekeys
    rts

// --- printers ----------------------------------------------------------
// print_bytes8: eight hex bytes from (zp_tmp) at row Y, column X
print_bytes8:
    sty zp_i
    stx zp_x
    ldy #0
pb8:
    tya
    pha
    lda (zp_tmp),y
    ldy zp_i
    ldx zp_x
    jsr print_hex
    inc zp_x
    inc zp_x
    inc zp_x
    pla
    tay
    iny
    cpy #8
    bne pb8
    rts

// print_hex: A as two hex digits at row Y, column X (clobbers A, X, Y)
print_hex:
    pha
    jsr set_row
    txa
    tay                         // Y = column
    pla
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hexdigits,x
    sta (zp_row),y
    pla
    and #$0f
    tax
    lda hexdigits,x
    iny
    sta (zp_row),y
    rts

set_row:
    lda row_lo,y
    sta zp_row
    lda row_hi,y
    sta zp_row+1
    rts

clear_screen:
    ldx #0
    lda #$20
clr:
    sta SCREEN,x
    sta SCREEN+$100,x
    sta SCREEN+$200,x
    sta SCREEN+$300,x
    inx
    bne clr
    ldx #0
    lda #$01
col:
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $db00,x
    inx
    bne col
    rts

draw_labels:
    ldx #0                      // index into the label text
    stx zp_i                    // label number
lbl:
    ldy zp_i
    lda label_row,y
    cmp #$ff
    beq lbldone
    tay
    jsr set_row
    ldy #0
lblchr:
    lda labels,x
    beq lblend
    sta (zp_row),y
    iny
    inx
    bne lblchr
lblend:
    inx
    inc zp_i
    jmp lbl
lbldone:
    rts

// --- data -----------------------------------------------------------------
hexdigits:
    .text "0123456789ABCDEF"

row_lo:
    .fill 25, <(SCREEN + i * 40)
row_hi:
    .fill 25, >(SCREEN + i * 40)

// the four watched keys: column, row bit
key_col:
    .byte 7, 1, 2, 3            // SPACE, Z, C, B: all row 4, so port 1's fire line holds all four
key_bit:
    .byte $10, $10, $10, $10

// synthetic matrix images, eight bytes a frame, $FF = nothing in that column
syn_frames:
    .byte $ff,$ff,$ff,$ff,$ff,$ff,$ff,$ef   // 1: SPACE down
    .byte $ff,$ff,$ef,$ff,$ff,$ff,$ff,$ef   // 2: SPACE and C down
    .byte $ff,$ff,$ff,$ff,$ff,$ff,$ff,$ef   // 3: C up
    .byte $ff,$ff,$ff,$ff,$ff,$ff,$ff,$ef   // 4: SPACE held 4 frames: first repeat
    .byte $ff,$ff,$ff,$ff,$ff,$ff,$ff,$ef   // 5: held 5
    .byte $ff,$ff,$ff,$ff,$ff,$ff,$ff,$ef   // 6: held 6: second repeat
    .byte $ff,$ff,$ff,$ff,$ff,$ff,$ff,$ff   // 7: all up
    .byte $ff,$ef,$ff,$ef,$ff,$ff,$ff,$ff   // 8: Z and B down
// expected after each frame: ages[0] (SPACE), ages[2] (C), repeats[0], pressed[7], released[7]
syn_expect:
    .byte 1, 0, 0, $10, $00
    .byte 2, 1, 0, $00, $00
    .byte 3, 0, 0, $00, $00
    .byte 4, 0, 1, $00, $00
    .byte 5, 0, 1, $00, $00
    .byte 6, 0, 2, $00, $00
    .byte 0, 0, 2, $00, $10
    .byte 0, 0, 2, $00, $00

label_row:
    .byte 0, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, $ff
labels:
    .text "OWN KEYSCAN IN THE RASTER IRQ"
    .byte 0
    .text "MATRIX"
    .byte 0
    .text "PRESS"
    .byte 0
    .text "RELS"
    .byte 0
    .text "KEY     AGE  PRS  RPT"
    .byte 0
    .text "SPACE"
    .byte 0
    .text "Z"
    .byte 0
    .text "C"
    .byte 0
    .text "B"
    .byte 0
    .text "        NET   RAW   BASE"
    .byte 0
    .text "COST"
    .byte 0
    .text "FRAMES"
    .byte 0
    .text "DC00"
    .byte 0
    .text "SYNBAD"
    .byte 0
    .text "FIRE"
    .byte 0
    .text "DIRTY"
    .byte 0

cur:        .fill 8, $ff
prev:       .fill 8, $ff
pressed:    .fill 8, 0
released:   .fill 8, 0
ages:       .fill NKEYS, 0
presses:    .fill NKEYS, 0
repeats:    .fill NKEYS, 0
cost:       .word 0
cost0:      .word 0
net:        .word 0
frames:     .byte 0
fire_seen:  .byte 0
dirty:      .byte 0
dc00_back:  .byte 0
syn_bad:    .byte 0
```

## Build

```bash
java -jar $KICKASS_JAR own-keyscan.asm -o own-keyscan.prg
```

Run headless, pinned (exit status 1 on the cycle limit is normal):

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 6000000 \
  -joydev2 2 -joystick2autofire -joystick2autofiremode 1 -joystick2autofirespeed 5 \
  -exitscreenshot own-keyscan.png -autostart own-keyscan.prg
```

Add `-model ntsc` for the NTSC picture.

## Expected output

Black screen, white text, green border. Measured in VICE x64sc 3.10
with the char-ROM decoder over the exit screenshot; two runs per model
gave byte-identical PNGs (`screenshots/own-keyscan.png`,
`screenshots/own-keyscan-ntsc.png`).

```text
OWN KEYSCAN IN THE RASTER IRQ

MATRIX  FF FF FF FF FF FF FF FF
PRESS   00 00 00 00 00 00 00 00
RELS    00 00 00 00 00 00 00 00

KEY     AGE  PRS  RPT
SPACE   00   00   00
Z       00   00   00
C       00   00   00
B       00   00   00
        NET   RAW   BASE
COST    030D  0312  0005
FRAMES  98
DC00    EF
SYNBAD  00
FIRE    4D
DIRTY   00
```

Line by line:

- `MATRIX` is this frame's image, column 0 to 7. `$FF` in every column
  is the empty matrix: no switch closed, and the port 2 fire line held
  low on PA4 (a column line) does not show, because a grounded column
  with no key pressed pulls no row down.
- `PRESS` and `RELS` are the edge sets for the same eight columns, bit
  r set where key (column, row r) went down or came up this frame.
- `AGE`, `PRS`, `RPT`: the age counter, the count of press events (age
  reached 1) and the count of repeat events (age reached 4, then every
  second frame) for the four watched keys. All zero: nothing pressed.
- `COST`: `NET` is the handler's work with the matrix empty, 781
  cycles (`$030D`): the eight-column scan, the `$FF` restore and
  read-back, the edge pass over eight columns and the ageing of four
  keys. `RAW` is the timed bracket, 786, and `BASE` is the same bracket
  around nothing, 5. Timer A is CIA1's and ticks at the CPU clock; the
  same figure on PAL and NTSC. With all four watched keys held the net
  is 945 (`$03B1`, the port 1 run below): a held key takes the longer
  ageing path, 41 cycles more each.
- `FRAMES`: IRQs since the handler was installed, `$98` = 152 on PAL
  and `$A9` = 169 on NTSC at 6,000,000 cycles.
- `DC00`: the read-back after the `$FF` restore, at the instant of the
  last IRQ. `$EF` is bit 4 low: port 2's fire, asserted by the autofire
  at that moment. It alternates with `$FF` from frame to frame; the
  exit lands on `$EF` at this cycle count on both models.
- `SYNBAD`: mismatches between the synthetic sequence's results and
  the expected table, 0 of 40 bytes.
- `FIRE`: frames in which the read-back had bit 4 low, `$4D` = 77 of
  152 on PAL, `$55` = 85 of 169 on NTSC. Five presses a second, half
  the frames down.
- `DIRTY`: frames in which any matrix byte was not `$FF`, 0. The port 2
  line never leaked into the matrix image.

### What was pressed, and what was not

Pressed: nothing on the keyboard. The pinned run asserts port 2's fire
line through VICE's autofire, with `-joydev2 2` (keyset 1) as the
device so the port has a joystick attached; the keyset itself is never
touched. No row line is ever driven in the pinned run, so the matrix,
edge and age columns show the empty case only, and the age logic's
evidence is the synthetic sequence.

Port 1 autofire from the command line is not usable: its fire line is
row 4, the KERNAL scanner reads it as R-SHIFT then SPACE and types
shift-spaces during boot, and VICE's autostart never sees the READY it
waits for (tried at 1 and 5 presses a second, with keyset 1 and with no
device; the boot screen was still up at the cycle limit every time).
The way round is to switch it on after the program has masked CIA1, from
a monitor breakpoint at `$0900`:

```text
break 0900
command 1 "resourceset \"JoyDevice1\" \"2\" ; resourceset \"JoyStick1AutoFire\" \"1\" ; resourceset \"JoyStick1AutoFireMode\" \"1\" ; resourceset \"JoyStick1AutoFireSpeed\" \"5\" ; delete 1 ; z"
```

(`;` separates monitor commands; `|` is refused with "Unexpected
token".) Run with `-moncommands that-file` and the pinned flags removed.
Measured in VICE x64sc 3.10, PAL, 6,000,000 cycles:

```text
MATRIX  EF EF EF EF EF EF EF EF
PRESS   00 00 00 00 00 00 00 00
RELS    00 00 00 00 00 00 00 00
SPACE   04   10   0F
Z       04   10   0F
C       04   10   0F
B       04   10   0F
COST    03B1  03B6  0005
DC00    FF
DIRTY   4D
```

Row 4 reads low in all eight columns while PB4 is grounded, which is the
"a port 1 direction is a row of keys" effect from `keyboard_matrix_scan`
seen from the other side: F1, Z, C, B, M, `.`, R-SHIFT and SPACE all
appear held. The four watched keys are all on row 4, so all four show
16 press events and 15 repeat events over 152 frames with age 4 at
exit, and the net cost rises to 945. Five presses a second is one press per
ten frames, five frames held: one press event and one repeat event (at age 4) per
cycle, and 152 / 10 rounds to the 16 and 15 seen. `DIRTY` is 77 of
152, the held half. The verdict is red in that run, by design: a dirty
matrix fails it, and the run exists to show a dirty matrix. The exit
screenshot of that run is not committed; the figures above are from
it.

## Why this works

**Killing the KERNAL scan.** `$DC0D` = `$7F` clears every CIA1
interrupt mask, so Timer A's underflow no longer reaches the CPU and
the jiffy IRQ, with SCNKEY inside it, stops. Nothing else is needed:
SCNKEY is only ever called from that handler. The raster IRQ goes
through the KERNAL's `$FF48` entry and `$0314`, so the KERNAL pushes the
registers and the handler leaves through `$EA81`, the six bytes `PLA TAY
PLA TAX PLA RTI` (read from the ROM image). `$EA7E` is `LDA $DC0D` then
those six bytes, a bare exit that also acknowledges CIA1, and `$EA7B`
is `JSR $EA87`, the SCNKEY call itself, followed by the two: jumping to
`$EA7B` runs the KERNAL scan and skips only the cursor blink and tape
motor code above it. A program that keeps the KERNAL IRQ and adds its
own scan therefore leaves through `$EA7E` or `$EA81`, never `$EA7B`.

**The scan.** With `$DC02` = `$FF` and `$DC03` = `$00`, the eight
stores of a walking zero to `$DC00` each drive one column low, and the
read of `$DC01` that follows sees a 0 in row r only for a closed
switch in that column. `SEC` then `ROL` moves the zero up a bit a time
and shifts a 1 in at the bottom: `$FE`, `$FD`, `$FB` … `$7F`. The
final `$FF` store deselects every column, so a joystick 2 read of
`$DC00` afterwards sees only the port's own switches; the KERNAL leaves
`$7F` instead, which is why `hardware/c64-memory-map.md`'s STOP-key
test works and why a port 2 poll after SCNKEY can see column 7's keys.

**Edges by XOR.** `prev EOR cur` is the set of bits that changed;
`AND prev` keeps those that were 1 (up) and so are now down, the
pressed set; `AND cur` keeps those now 1, the released set. Eight
bytes, three operations each, no branches.

**Ages.** A key's age is 0 while up, and counts up from 1 each frame it
is down, saturating at 255. Age 1 is the press event, so no separate
edge test is needed for the watched keys; the repeat rule (age is
REPEAT_AT, or past it by an even count) gives a delayed auto-repeat
from the same byte. A contact bounce that opens the switch for one
scan resets the age and fires a second press event next frame, which
`keyboard_matrix_scan` explains is the accepted cost of a once-a-frame
scan.

**The timer.** Timer A is stopped, its latch set to `$FFFF`, then
started with force load in continuous mode; after the ageing it is
stopped again and read. `$FFFF` minus the count is the elapsed ticks.
The same bracket around nothing reads 5, the stores' own share, and
the difference is the handler's work: 781 empty, 945 with four keys
held. Of the 781, the scan itself is 252, measured by an earlier build
of this listing that stopped the timer straight after the `$FF`
restore, and that agrees with the instruction arithmetic (7 to set up,
eight passes of 30 with the last branch not taken, 6 to restore). An
earlier build restarted a still-running one-shot timer with a force load and no stop, and read 509 where the
monitor's cycle counter said 252 between the start store and the read;
the monitor's own peek of `$DC04/$DC05` at that point said `$FF05`,
250 elapsed, disagreeing with what the CPU's read returned. Stopping
the timer before loading the latch, as `mouse-1351-read.md` does,
removed the discrepancy; why the running restart misreads in VICE was
not established here.

**The verdict window.** 700 to 1000 covers the empty matrix and all
four keys held with margin on both sides; a build before it compared a
single byte against 281, which the assembler truncates to 25, and read
red on every run with a correct 252.

**Why the synthetic sequence.** The age routine is the same code on
both paths: part A copies each table image into `cur` and calls
`update_keys`, exactly as the IRQ does with a live image. The sequence
covers a press, a second key in another column joining and leaving,
the first repeat at age 4 and the second at 6, a release, and two
keys down at once. The expected table checks two ages, the repeat count and column 7's two
edge sets after every frame, forty bytes in all.
