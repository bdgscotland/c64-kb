---
category: input
chip: CIA
---

<!-- doc-type: technique-reference -->

# Input Techniques

Reading the joystick ports, the paddles and the keyboard matrix directly
from CIA1 and the SID, without the KERNAL's once-per-jiffy scanner. The
techniques share one fact: CIA1 port A (`$DC00`) is control port 2 and the keyboard's
column drive, CIA1 port B (`$DC01`) is control port 1 and the keyboard's
row sense, and every switch on either port reads as a 0 bit when closed.
The wiring is in `hardware/cia-reference.md`; the ways it bites are in
`pitfalls/input.md`. Every number below that came from an instrument says
so; the rest is marked as arithmetic or as not measured here.

---

## joystick_edge_detect — Joystick press events by previous-frame XOR

**Complexity:** low
**Region:** both
**Uses registers:** DC00, DC01
**Claims:** cia1_port_a (reads), cia1_port_b (reads)
**Claims basis:** derived-listing

### Why

A port byte is a level: bit 4 low means the fire button is down right
now. A game usually wants an event: the frame the button went down, so
one press fires one shot, or the frame it came up. Reading the level
every frame and acting on it gives one shot per frame for as long as the
button is held.

### How

Keep last frame's port byte. Once per frame read the port again and
compare the two:

```
pressed  = ~cur & $1F           ; lines that are low now
new      = pressed & prev        ; low now, high last frame
held     = pressed & ~prev & $1F ; low now, low last frame
released = cur & ~prev & $1F     ; high now, low last frame
prev     = cur
```

`cur ^ prev` is the set of lines that changed; masking that with `prev`
picks the ones that changed from high to low, which is the same set as
`new` above. Bit 0 is up, 1 down, 2 left, 3 right, 4 fire, on both ports
(`hardware/cia-reference.md`, and Oscar64's `joystick.c` tests the same
five bits). Bits 5 to 7 are keyboard lines and paddle plumbing; mask them
off or a held key turns into a phantom event.

Port 2 is `$DC00`, port 1 is `$DC01`. The same code serves both; only the
address differs. The first `prev` should be `$FF` (nothing pressed), so a
button already down when the program starts counts as a new press on
frame 0 rather than being missed.

Oscar64's library path is `joy_poll(n)` from `<c64/joystick.h>`, which
reads `$DC00 + n` (so `joy_poll(0)` is control port 2) and leaves
`joyx[n]`, `joyy[n]` as signed -1, 0 or 1 and `joyb[n]` as a bool (read
from the header and `joystick.c`). It reports levels, not edges; keep the
previous `joyb[n]` yourself if you use it. The bare-register path is one
`LDA $DC00` per frame and the four lines above.

### Why it works

The five switch lines have pull-ups inside the CIA; a closed switch grounds
its line and the port read returns 0 in that bit. Nothing latches: the byte
is the state of the switches at the cycle of the read. The comparison with
the previous frame is the only memory in the system, which is why the
program has to hold it.

Timing the read to the frame matters. The read is instantaneous; the
comparison assumes one read per frame. A read on a raster line the game
picks (the recipe waits for line 250) gives a steady 50 or 60 samples a
second on PAL or NTSC. If the KERNAL IRQ is still running, a main-loop read
of `$DC00` sees `$7F` at rest, not `$FF`: the KERNAL leaves column 7
driven low between scans (measured in `pitfalls/input.md`). With the
mask applied it makes no difference to the five joystick bits.

### Variations

**Released events.** `released` above is free; use it for a charge-and-let-go
shot or to end a jump early.

**Both ports in one pass.** Read `$DC00` and `$DC01` back to back into two
bytes and run the four lines twice. For port 1 write `$FF` to `$DC00`
first so no keyboard column is selected; otherwise a key held in the
selected column reads as a port 1 direction (see `keyboard_matrix_scan`).

**Diagonal cleanup.** Up and down cannot both be low on a working stick,
but a cheap one can bounce through it. Oscar64's `joy_poll` resolves the
conflict by testing up before down and left before right; do the same or
mask the pair to zero.

### Exhaustive check

The recipe below runs the four lines over every (prev, cur) pair, all
65,536 of them, and folds `new | held << 5 | released << 10` into a 16-bit
checksum. The 6502 shows `1800 PASS`; the same fold in Python gives `1800`
(measured in VICE x64sc 3.10, rung 1).

### Recipes

- `recipes/oscar64/joystick-input.md`

---

## joystick_autorepeat — Delayed auto-repeat from per-direction age counters

**Complexity:** low
**Region:** both
**Uses registers:** DC00, DC01
**Requires:** joystick_edge_detect
**Claims:** cia1_port_a (reads), cia1_port_b (reads)
**Claims basis:** derived-listing

### Why

A falling-block or menu game wants a held direction to move once at
once, pause, then step at a steady rate. Acting on the level moves every
frame, which is too fast to steer; acting only on the press event needs a
tap per cell, which is too slow. The KERNAL keyboard queue has its own
repeat but no joystick equivalent and no way to tune the delay per
direction, which is why `game-design/c64-game-archetypes.md` says
action-puzzle games keep their own age counters.

### How

One byte per direction counts frames held. Each frame:

```
if line is high:  age = 0, no fire
else:             age = age + 1
                  if age == DELAY + RATE: age = DELAY
                  fire if age == 1 or age == DELAY
```

`DELAY` is the number of frames before the first repeat and `RATE` the
frames between repeats after that. Resetting `age` to `DELAY` instead of
letting it climb keeps the counter in a byte and avoids a modulo. The
recipe uses `DELAY` 20 and `RATE` 4: on PAL that is a first repeat after
0.4 s and then 12.5 steps a second, on NTSC 0.33 s and 15 a second
(arithmetic from 50 and 60 frames a second, rung 3). A 100-frame hold
fires 22 times: once at frame 1, once at frame 20, then every four frames
(arithmetic, and the same number from the Python model).

The first-frame fire is the press event from `joystick_edge_detect`
expressed through the counter: `age == 1` is true only on the frame after
the line went low. Games that already consume press events elsewhere can
drop that term and fire only on `age == DELAY`.

Frames, not jiffies. The counters advance once per frame the game draws,
so the feel tracks the region: the same `DELAY` is a fifth slower on PAL.
A region-aware program scales the two constants after
`pal_ntsc_detection` (`techniques/raster.md`) or accepts the difference.

### Why it works

The CIA gives no press history; the age counter is the history. Because it
is per direction, a player rolling from left to down keeps a fresh counter
for down while left's counter clears, so the first step in the new
direction is immediate. A single shared counter would inherit the old
direction's age and skip the initial delay.

### Variations

**Count-down timer.** Load a timer with `DELAY` on the press, decrement
while held, fire and reload with `RATE` when it hits zero. Same behaviour,
one compare fewer per frame, but the count of frames held is lost.

**Accelerating repeat.** Shrink `RATE` each time it fires, with a floor, for
a cursor that speeds up while held.

**Soft drop.** For a falling piece, hold down usually bypasses the delay
and moves every `RATE` frames from the first; use `DELAY` = 1 for that
direction only.

### Exhaustive check

The recipe runs the step over every (age, pressed) pair, 256 by 2, and
folds `age' | fire << 8` into the same 16-bit checksum. The 6502 shows
`D1CC PASS`; Python gives `D1CC` (measured in VICE x64sc 3.10, rung 1).

### Recipes

- `recipes/oscar64/joystick-input.md`

---

## keyboard_matrix_scan — Read the keyboard matrix from the main loop, without the KERNAL

**Complexity:** medium
**Region:** both
**Uses registers:** DC00, DC01, DC02, DC03
**Claims:** cia1_port_a (owns), cia1_port_b (reads)
**Claims basis:** derived-listing

### Why

`GETIN` hands out one PETSCII character per call from a ten-byte queue.
It cannot say whether a key is still down, cannot see two keys at once
outside the shift and control modifiers, and runs on the jiffy IRQ's
schedule. A game that steers with keys needs the matrix itself: which of
the 64 switches is closed this frame.

### How

The keyboard is 8 columns by 8 rows. Columns hang on port A, rows on port
B. Set the direction registers once, then walk one low bit across the
columns and read the rows after each write:

```
$DC02 = $FF          ; port A all output (column drive)
$DC03 = $00          ; port B all input  (row sense)
col   = $FE
for i in 0..7:
    $DC00 = col      ; drive column i low, the other seven high
    rows[i] = $DC01  ; bit r is 0 if key (column i, row r) is down
    col = col << 1 | 1
$DC00 = $FF          ; leave no column selected
```

Key (column c, row r) is down when bit r of `rows[c]` is 0. The layout
table is in `hardware/cia-reference.md`; SPACE is column 7, row 4, so
`rows[7] & $10` is 0 while SPACE is held. Keep last frame's eight bytes
and the XOR trick from `joystick_edge_detect` gives press and release
events per key; an age counter per key gives auto-repeat.

The Oscar64 library does exactly this in `keyb_poll()` from
`<c64/keyboard.h>`: `keyb_matrix[8]` holds the eight row bytes as read,
`key_pressed(KSCAN_x)` tests bit `code & 7` of `keyb_matrix[code >> 3]`,
so the scan code is `column * 8 + row` and `KSCAN_SPACE` is 60. It also
keeps the previous scan and reports the newest press in `keyb_key` with
`KSCAN_QUAL_DOWN` (`$80`) set. All from the header and `keyboard.c`,
build 2026-05-19. The library's scan first tests `$DC01` with every
column driven low and returns early if it reads `$FF`, which is the
KERNAL's own no-key shortcut.

### Why it works

There are no diodes in the matrix: a closed switch is a wire from its
column line to its row line. With one column pulled low and the rows
floating high through their pull-ups, only switches in that column can pull
a row down. Eight passes cover the 64 switches. Leaving all columns high
afterwards, or all low, is a choice; the KERNAL leaves `$7F` (column 7
low), which is why the STOP key can be tested with a single read of
`$DC01` bit 7 (`hardware/c64-memory-map.md`).

**Ghosting.** Because a switch is just a wire, three closed keys at three
corners of a rectangle in the matrix connect the fourth corner's column to
its row through the other three, and the scan reads four keys. Two keys
in the same row or the same column never ghost; three keys sharing no
row or column never ghost. From the wiring (`hardware/cia-reference.md`),
not measured here: a headless VICE run cannot hold three keys.

**Why a main-loop scan and a joystick in port 1 interfere.** Port 1's five
switches sit on the row lines PB0 to PB4. A held direction grounds its
row regardless of which column is driven, so the scan reads that row as
pressed in all eight columns: up (PB0) looks like DEL, 3, 5, 7, 9, +,
pound and 1 held together. In the other direction, while the scan has
column c driven low, any key in column c pulls its row down, and a read of
`$DC01` taken as joystick 1 at that moment sees a direction. The KERNAL's
version of this, with column 7 left selected, is measured in
`pitfalls/input.md`: 1, left-arrow, CTRL, 2 and SPACE read as up, down,
left, right and fire on port 1. The fix is ordering: read port 1 only
with `$DC00` = `$FF`, and read the matrix only when the game does not also
expect port 1 input, or accept that a port 1 stick is a set of keys. Port
2 sits on the column lines PA0 to PA4; a held port 2 direction grounds a
column the scan did not select, so keys in that column show up in every
pass (from the wiring, not measured here). Games that use port 2 and the
keyboard together therefore see keyboard corruption only while the stick
is held, and only for keys in five of the eight columns.

**Why the KERNAL IRQ must be out of the way.** SCNKEY writes `$DC00` on
its own schedule inside the jiffy IRQ. If it fires between your column
write and your row read, the row byte belongs to whichever column SCNKEY
left selected, and its final `$7F` clobbers your walk. Either take over
the IRQ, or bracket the eight-column loop with `SEI`/`CLI`, or (the
recipe's choice) run with interrupts off and sync to a raster line
instead of the jiffy. The pitfall page's measurements put the main-loop
hazard on `$DC00` only, but a matrix scan writes `$DC00`, so it is exposed
where a plain joystick poll is not.

**Debouncing is not needed.** A mechanical contact bounces for a few
milliseconds when it closes (rung 4, not measured here); a scan once per
frame samples every 20 ms on PAL and 16.7 ms on NTSC (arithmetic from the
frame rates). The sample period is the debounce: the read lands inside a
bounce rarely, and when it does the worst case is one press event that
arrives a frame late, or one extra release-and-press pair, which a
per-key age counter absorbs since the counter resets to 0 and fires
again on the next frame. The KERNAL's SCNKEY does no bounce filtering
either; it keeps the last scan's matrix code in `$C5`
(`hardware/c64-memory-map.md`) and decides new-versus-repeat against it,
which is the same previous-scan comparison, not a timing filter (from the
ROM's variable layout; the comparison itself is not measured here). A scan
that runs many times per frame, for instance inside a tight wait loop,
does need a filter, because it can see both edges of a bounce.

### Variations

**Only the keys you use.** Drive just the columns holding the game's keys
and skip the rest; a WASD plus SPACE game needs columns 1, 2 and 7.

**Shift handling.** Left shift is column 1 row 7, right shift column 6
row 4 (`hardware/cia-reference.md`; Oscar64's `key_shift()` tests the
same two bits). Read them as ordinary keys and use them as modifiers in
software.

**No-key shortcut.** Drive all eight columns low (`$DC00` = `$00`) and read
`$DC01` once; `$FF` means no key and no port 1 input, and the eight-pass
scan can be skipped that frame.

### Recipes

- `recipes/oscar64/joystick-input.md`

---

## paddle_read — Read the paddles through the SID's POTX/POTY with the CIA1 port select

**Complexity:** medium
**Region:** both
**Uses registers:** D419, D41A, DC00, DC01, DC02
**Cost:** cycles_per_frame=1152, zp_bytes=0, irq_slots=0
**Cost basis:** arithmetic

### Why

A paddle is a potentiometer, and the C64 reads it through the SID, not
the CIA. `$D419` (POTX) and `$D41A` (POTY) hold an 8-bit conversion of
the voltage on the two pot pins of one control port. Which port is a
choice the program makes through CIA1 port A: bit 6 of `$DC00` set
selects control port 1, bit 7 set selects port 2. Both ports carry two
pots, so a four-paddle game reads all four values through the same two
registers by switching the select and reading twice. The registers are
read-only; there is nothing to set up on the SID side.

### How

The direction register `$DC02` must be `$FF`, which is how IOINIT
leaves it; the select bits are outputs. Then, per port:

```text
$DC00 = $40          ; bit 6: control port 1 (or $80, bit 7: port 2)
wait                 ; a conversion has to start and finish after the switch
x1 = $D419           ; paddle 1 (port 1 pin 9)
y1 = $D41A           ; paddle 2 (port 1 pin 5)
$DC00 = $80
wait
x2 = $D419
y2 = $D41A
```

The wait is the whole difficulty. The SID converts on its own clock, one
conversion every 512 cycles, and the switch does not restart it. A read
taken before a conversion that began after the switch has completed
returns the old port's value or a byte from the middle of a conversion.
Measured in VICE x64sc 3.10 with a 1351 as the pot source, sampling
`$D419` every 8 cycles after the select write at eight phases 65 cycles
apart: at six phases the settled value was present within 480 cycles
(from cycle 476 at phase 0, on PAL and NTSC), at two phases it needed
more than 512 and was present within 544; nothing settled between 481
and 512. So in VICE 512 is the conversion period, not a safe delay from
the write. Wait at least 576 cycles, which is the measured worst case of
544 plus 32 of margin; that figure is measured in VICE, and the hardware
worst case after a mid-conversion switch is not measured here. Or use
the schedule most games use, select on one frame and read on the next:
a frame is 19,656 cycles on PAL and 17,095 on NTSC (arithmetic: 312
lines of 63 and 263 lines of 65), and both ports fit in two frames.

Reading both ports means alternating the select and paying the wait
each time. The cost line is two waits of 576 cycles, the recommended
wait, for a two-port read done in one frame; the reads and writes
themselves are under 30 cycles. A program that selects at the end of
its frame and reads at the start of the next spends none of that
waiting.

The paddle buttons are not on the SID. They are read on the port's
LEFT and RIGHT switch lines (bits 2 and 3 of the joystick byte: `$DC00`
for port 2, `$DC01` for port 1, low when pressed). That the paddle
buttons ride those two lines is not measured here, since a headless
VICE run cannot press one, and is not stated on
`hardware/cia-reference.md`, which places the paddle switches somewhere
in PA0-PA4. The recipe shows both bytes.

### Why it works

The two select bits drive the SID's analogue multiplexer directly from
the CIA pins; the SID sees one port's pots at a time and converts what
it sees. The usual account of the SID's converter, not measured here,
is that each conversion discharges a capacitor and then counts cycles
until the pot charges it again, which would make the result a cycle
count in 0 to 255 and the period 512 cycles, half to discharge and half
to count. The two-bucket settle pattern measured above is VICE's model
of that converter, and this page does not claim it for the chip. What
the measurement does show is that the register holds the last finished
conversion, whichever port that was for, until the next one completes.
Selecting neither port reads
`$FF`, as does an empty port, since the pin floats high (measured in
VICE; the same reading a paddle at one end of its travel gives, so a
game cannot tell an empty port from a paddle at full scale).

The keyboard scan interferes because it owns the same bits. SCNKEY, in
the jiffy IRQ, writes `$DC00` to drive the columns and leaves `$7F`
there when it is done: bit 6 set, bit 7 clear, control port 1
selected. A program that selected port 2 and is waiting for the
conversion has, after the interrupt, port 1 selected and does not know
it. Measured in VICE: 2,000 passes of select port 2, wait 530 cycles,
read, with the KERNAL IRQ live, returned something other than port 2's
value 53 to 59 times per run, about one per jiffy interrupt, and the
wrong values were port 1's or a mid-conversion byte. The same 2,000
passes under `SEI` were wrong 0 times. Three ways to time the read
against the scan: bracket select, wait and read with `SEI`/`CLI`; own
the IRQ, so no scan runs; or select and read at fixed raster lines and
keep the KERNAL scan's line, which is wherever the jiffy IRQ lands, out
of the window. Re-selecting immediately before the read, as
`hardware/sid-reference.md` suggests, is not enough on its own: the
conversion still needs its 512 cycles after that write.

The DDR matters for the same reason it matters for the keyboard:
`cia1_ddr_cleared_kills_keyboard` in `pitfalls/input.md`. With `$DC02`
cleared, the select bits are inputs, the write reaches no pin, and
both select bits read high: both ports selected, a case the SID page
does not define and this page does not measure (the recipe's `$C0` row
shows only what VICE does with it).

### Variations

**One port, no switching.** A single-port paddle game writes the select
once and never touches `$DC00` again, and then only the KERNAL scan can
disturb it. With the KERNAL IRQ off it can read `$D419` whenever it
likes.

**Interleaved frames.** Select port 1 on even frames and read it on odd
frames, port 2 the other way. Every paddle updates at half the frame
rate, which is enough for a bat, and no frame carries a wait.

**Position sweeps.** Not measured here: the host mouse that drives
VICE's paddles cannot be moved headlessly, so the value's range and
linearity against the knob are from `hardware/sid-reference.md`, which
gives the usable span as about `$00` to `$DF`.

### Cycle budget

The reads and writes are 4 cycles each. The whole cost is the wait
between a select and its first trustworthy read: 544 cycles at the
worst phase in the runs here, 576 with 32 of margin, which is just over
nine PAL raster lines. The Cost line states 1,152, two waits of 576, as
the worst frame of a two-port read done inside one frame.

### Recipes

- `recipes/kickassembler/paddle-read.md`

---

## mouse_1351_read — Read a 1351 mouse's position counter from POTX/POTY once per frame

**Complexity:** medium
**Region:** both
**Uses registers:** D419, D41A, DC00, DC01, DC02
**Cost:** cycles_per_frame=104, zp_bytes=0, irq_slots=0
**Cost basis:** measured-vice

### Why

The Commodore 1351 in its proportional mode is not a joystick and not a
paddle, though it uses both sets of lines. Its movement arrives through
the SID's pot registers, `$D419` and `$D41A`, as a position counter the
mouse keeps itself; its two buttons arrive on the control port's switch
lines. A program that reads it as a paddle sees a value that wanders
and wraps; a program that reads it as a joystick sees nothing at all
unless the mouse was powered up in its joystick mode. The 1350, and the
1351 with the right button held at power-up, report movement as
joystick direction pulses on the switch lines instead; nothing below
applies to that mode.

### How

Select the mouse's port through CIA1 port A, bit 6 of `$DC00` for
control port 1 or bit 7 for port 2, with `$DC02` at `$FF` so the write
reaches the pins; that is the same select as `paddle_read`, and the
same 512-cycle conversion follows it. Then, once per frame:

```text
x = ($D419 >> 1) & $3F        ; bits 1 to 6 are the counter, bit 0 is noise
dx = (x - prev_x) & $3F       ; the difference modulo 64
if dx >= 32: dx = dx - 64     ; 0..31 forward, 32..63 back
prev_x = x
```

and the same for `$D41A`. The button byte is the port's joystick byte,
`$DC01` for port 1 or `$DC00` for port 2: the left button is on the
FIRE line, bit 4, and the right button on the UP line, bit 0, both low
when pressed.

The register format is from the 1351's documentation and is not
measured against a real mouse here. What is measured, in VICE x64sc
3.10 with its 1351 on port 1 (`recipes/kickassembler/mouse-1351-read.md`):
over 250 frames at rest the masked counter read 32 on every frame on
both axes and both models, while the raw byte alternated between `$40`
and `$41`, bit 0 set in 128, 112 and 112 of the 250 frames across three
runs. Bit 0 is noise from one frame to the next, not a constant offset,
and any code that compares raw pot bytes will see movement that is not
there. Shift it off before anything else.

### Why it works

The mouse counts its own quadrature transitions in a 6-bit counter per
axis and encodes the counter as a voltage on the pot line, timed against
the SID's conversion cycle, so that the byte the SID finishes every 512
cycles carries the counter in bits 1 to 6. The period is the SID's, not
the mouse's, and it is the figure `paddle_read` measured: 512 cycles a
conversion, about 520 microseconds on PAL and 500 on NTSC (arithmetic
from the clock rates). A frame is 38 conversions on PAL and 33 on
NTSC (arithmetic), so the register has been refreshed many times over
before the next read, and one read per frame loses nothing so long as
the counter has moved fewer than 32 steps in between. Whether a hand
can move a 1351 faster than that in one frame, a fiftieth of a second
on PAL and a sixtieth on NTSC, is not measured here; the delta arithmetic is exact below that speed and
wrong above it, with no way to tell from the data.

The modulo-64 subtraction is what makes the wrap invisible. 63 to 0 is
`(0 - 63) & $3F` = 1, a step forward; 0 to 63 is `(63 - 0) & $3F` = 63,
read as -1. The two half-turn cases, a difference of exactly 32, are
ambiguous by construction and the recipe's convention reads them as
-32. The recipe runs ten such pairs, including both wraps and both
half-turns, against expected values and prints `OK` for each.

The select bits are the ones `paddle_read` describes, with the same
consequence: the KERNAL's SCNKEY drives `$DC00` from the jiffy IRQ and
changes bit 6 as it walks the columns, so a conversion started during
the scan converts the wrong source. `paddle_read` measured about one
bad read per jiffy interrupt with the KERNAL IRQ live and none under
`SEI`; the mouse read is the same read on the same register and the
same three remedies apply, `SEI` around the read, owning the IRQ, or a
read on a raster line at least 576 cycles after the scan's last column
write. The recipe reads at raster line 250 with interrupts off. Because
both ports' pots go through the same two SID registers, a mouse and a
pair of paddles on the other port share the select and cannot be read
in the same conversion; `paddle_read`'s interleaved-frame schedule
handles the pair.

Both button lines are joystick lines, so `joystick2_scan_phantom_press`
and `cia1_ddr_cleared_kills_keyboard` in `pitfalls/input.md` apply to a
mouse in port 2 exactly as to a stick: read `$DC00` from the main loop
or from a handler that cannot interrupt the scan, and never clear
`$DC02` to do it. A mouse in port 1 has the keyboard problem the other
way round, and the select makes it worse: `$40` in `$DC00` sets bit 6
and clears the other seven, so keyboard columns 0 to 5 and 7 are driven
low for as long as port 1 is selected, and any held key in those
columns pulls its row line low on `$DC01`, where the mouse's right
button is row 0 (UP, PB0) and its left button row 4 (FIRE, PB4). That
is the wiring `keyboard_matrix_scan` describes for port 1 sticks, not
measured here with a mouse. A game that reads the keyboard as well as a
port 1 mouse selects with `$7F`, the value SCNKEY itself leaves behind:
bit 6 still set, only column 7 driven, so only that column's keys can
alias the mouse lines (1, left-arrow, CTRL, 2 and SPACE, measured for
port 1 in `pitfalls/input.md`). The recipe uses `$40` with no keyboard
in play.

### Variations

**Accumulated position.** Add each frame's `dx` and `dy` to a 16-bit
pointer position and clamp to the screen; the pointer sprite's
coordinate comes from that sum, never from the counter.

**Acceleration.** Scale `dx` by its own magnitude, doubling a delta of
8 or more, so slow moves are precise and fast ones cross the screen.
The threshold is a matter of feel and is not measured here.

**Half-rate reads.** Reading every other frame halves the cost and
halves the speed at which the 32-step ambiguity is reached; a game that
reads at half rate should say so in its own budget.

### Cycle budget

One call of the recipe's `read_mouse`, both axes with their deltas and
including `jsr` and `rts`, costs 102 to 104 cycles by the sign of each
axis's delta: a delta of 0 to +31 takes a `bcc` (3 cycles), a negative
delta falls through it and runs the `ora` sign-extend (2 plus 2), one
cycle more per axis. 102 is both non-negative, 103 one of each, 104
both negative. The worst case measured 104 cycles by CIA2 timer A
difference on raster line 250, on both models, with both previous
counters set to force the negative path (measured in VICE x64sc 3.10).
The Cost line states that figure. There is no wait in the per-frame
cost because the
select is written once and never changed; a program that switches the
select to read paddles on the other port pays `paddle_read`'s settle.

### Recipes

- `recipes/kickassembler/mouse-1351-read.md`

## attract_mode_input_replay — The title screen plays the game from a recorded input stream

**Complexity:** low
**Region:** both
**Uses registers:** DC00, D012
**Requires:** joystick_edge_detect, lfsr_random, frame_sync_loop
**Cost:** cycles_per_frame=68
**Cost basis:** measured-vice

### Why

A title screen that idles is a still frame. The arcade answer is the
attract mode: after a while the game plays itself, and anyone watching
sees what the game is. The cheap way to get one is not a second code
path that moves the player about; it is the game itself, with its input
coming from somewhere other than the joystick port. The player code
reads one input byte. During play the port fills it. During the demo a
recording fills it. Nothing else changes, so the demo does exactly what
the game does, and a change to the game's rules is a change to the demo
for free.

### How

Route every input read through one byte. `joystick_edge_detect` already
keeps last frame's port byte; put this frame's byte beside it and have
the game read the pair, never `$DC00` directly. The main loop is the
only place that writes it: from the port on the title and in play, from
the recording during the demo.

Store the recording as run-length pairs: the port byte exactly as
`$DC00` gives it, active low, and the number of frames it was held. A
joystick changes a few times a second, so a 285-frame demo is eight
pairs. A count of zero ends the stream. Beside the stream keep the seed
the random generator had when the recording was made, and the state the
recording ends in, here the player's X and Y on its last frame, so the
program can check its own replay.

Count idle frames on the title: a byte that goes up once a frame while
the port reads nothing and back to zero on any bit. When it reaches the
attract delay, start the demo: reset the playfield the way a new game
would, set the LFSR to the recorded seed, and point the stream at its
first pair. Each demo frame, if the current pair has frames left, hold
its byte; otherwise load the next pair; when the next pair's count is
zero the demo is over and the title comes back.

Keep reading the port during the demo. Any bit low is a real press: end
the demo that frame, before the stream is consulted, and let the title
take over. The player then starts a game from the title as usual.

### Why it works

The replay is exact because the game is deterministic from its seed.
Its state on any frame is a function of the state before it and the
input byte, and the only source of variation is the random generator.
Reseed the generator, feed the same bytes in the same frames, and every
intermediate state is the one the recording saw, so the last frame lands
where the table says. The recipe shows the other side: built with the
reseed left out, the same 285 bytes end 210 pixels from the recorded
position, because the title screen had moved the generator on. The
frame is the unit that makes "the same frames" true on both regions: a
`frame_sync_loop` runs one step per frame, so a count of 50 is 50 steps
on PAL and on NTSC, in less wall time on NTSC and with the same result.

The seed must not be zero. An LFSR at zero stays at zero, so the reseed
maps zero to one; a recording tool should never store zero, and the
guard costs one compare.

### Variations

Öörni's control override, named on `game-design/game-structure.md`, is
the same seam used the other way: enemies and cutscene actors read a
virtual joystick byte that the AI or the script writes, and a
conversation freezes the player by writing zero. A recorded human run is
the natural source for the stream: log the byte and the frame count
through the same variable during a real game and dump the pairs. The
verdict constants are then whatever the recording ended on, which is how
a shipped game can check its own attract mode after a rules change. A
longer attract can chain several recordings, or a recorded run and a
scripted one, through the same byte.

### Cycle budget

The replay step, the code that decides whether to hold the current pair
or load the next one and writes the input byte, was timed with CIA1
timer B, interrupts held off for the timed window, over a 285-frame
demo. The longest step was 68 cycles on PAL and NTSC and in all three
builds, and that figure includes the timer's own start and stop stores.
The Cost line states it; the game step it feeds is the game's own cost,
not the technique's. The idle counter on the title is one increment and
one compare a frame. Measured in VICE x64sc 3.10 on the recipe's
listing.

### Recipes

- `recipes/oscar64/attract-replay.md`

---

## four_player_read — Read joysticks 3 and 4 through a user-port 4-player adapter

**Complexity:** low
**Region:** both
**Uses registers:** DC00, DC01, DD01, DD03
**Cost:** cycles_per_frame=62, irq_slots=0
**Cost basis:** measured-vice

### Why

The C64 has two control ports. Party and sports games for four players
add two more joysticks through an adapter on the user port, read through
CIA2 port B (`$DD01`). The common design, sold by Protovision and
emulated by VICE as the "CGA userport joy adapter", has seven port-B
lines (six inputs and a select) for ten switches, so it multiplexes the directions and gives each
fire button its own line. A game has to know which bit is which, and
that the adapter types are not interchangeable.

### How

Set PB7 as an output once. It is the adapter's select line; PB0 to PB6
stay inputs:

```text
$DD03 = $80          ; DDR B: PB7 out, PB0-PB6 in
```

Then, each frame:

```text
j1 = $DC01 & $1F                ; port 1
j2 = $DC00 & $1F                ; port 2 ($DC00 must drive no keyboard column)
$DD01 = $80                     ; PB7 = 1: joystick 3's directions on PB0-PB3
j3 = $DD01 & $1F                ; PB0-PB3 directions, PB4 = fire 3
$DD01 = $00                     ; PB7 = 0: joystick 4's directions on PB0-PB3
v  = $DD01
j4 = (v & $0F) | ((v & $20) >> 1)   ; PB5 = fire 4, moved to bit 4
```

All four bytes then have the `$DC00` layout: bit 0 up, 1 down, 2 left,
3 right, 4 fire, 0 when pressed. `joystick_edge_detect` and the rest of
a game's input code work on them unchanged.

Fire 3 on PB4 and fire 4 on PB5 are present under either select. Only
the directions go through the select. Joystick 4's fire therefore is not
bit 4 of its read; forgetting the shift reads joystick 4 as never firing.

### Why it works

Writing `$DD01` with `$DD03` at `$80` drives only PB7; the input bits
ignore the write. PB7 drives a 74LS257 multiplexer (VICE's pin table)
that routes one joystick's four direction lines to PB0-PB3. Protovision
and the icomp wiki both give PB7 = 1 for joystick 3 and PB7 = 0 for
joystick 4, with fire 4 on PB5. VICE 3.10's source agrees
(`src/userport/userport_joystick.c`): PB7 high selects joystick 3's
directions, and the read carries joystick 3's fire on PB4 and joystick
4's on PB5 whatever the select.

What was run: the recipe, in VICE x64sc 3.10 with the CGA adapter and
autofire on joysticks 3 and 4 at 5 and 7 presses a second, counted 11
and 15 presses in 100 PAL frames, 9 and 12 in 100 NTSC frames, and
found PB4 and PB5 equal under both selects on every frame. Directions on
joysticks 3 and 4 were not injected: VICE has no headless way to move
them. The select's effect on PB0-PB3 is therefore from the two sources
and the VICE source, not measured here.

VICE switches the multiplexer at the store, so a load 4 cycles later
sees the new joystick. No settle time on hardware is measured here.

### Variations

**Kingsoft adapter.** A different wiring with no select line. In VICE's
source (`src/userport/userport_hks_joystick.c`, not exercised here
beyond one control run) joystick 4's directions are on PB0-PB3 in the
order right, left, down, up; joystick 3's fire is PB4, its right, left
and down are PB5-PB7 and its up is PA2, bit 2 of `$DD00`; joystick 4's
fire arrives on CIA2's serial data pin SP2, clocked from CIA1's CNT1. The
control run in the recipe read a Kingsoft adapter with the CGA code:
joystick 3's fire counted, joystick 4's never did. VICE also emulates
HIT and StarByte adapters with other wirings. A game that supports more
than one adapter needs a menu choice or a per-type read.

**Detecting the adapter.** With no adapter, PB0-PB6 read high under
both selects (measured in VICE, the recipe's control run with no
user-port device), which is also what a connected adapter with every
joystick idle returns.
There is no reliable detect; ask the player.

**Two reads a frame for responsiveness.** The read is 62 cycles, so a
game that polls twice a frame, for example once in the IRQ and once in
the main loop, spends 124.

### Conflicts on the user port

The adapter uses PB0-PB5 and PB7, and its DDR setting owns port B, so it cannot share the port with anything else
that uses port B. `hardware/cia-reference.md` lists the KERNAL RS-232
driver (RXD sampled on `$DD01` bit 0 from its NMI) and user-port parallel
cables for 1541 fastloaders. Either one active at the same time would
corrupt the other's reads or writes (not measured here), and the adapter's `$DD03` setting is lost
if the other code rewrites the DDR. The IEC-bus loaders this repository
covers, Krill and Sparkle, are described in `pitfalls/loader.md` as
driving `$DD00` only; no `$DD01` use is stated for them, and none was
measured. A parallel-cable build of a loader is a different case and is
not covered here.

Ports 1 and 2 share `$DC00` and `$DC01` with the keyboard. The KERNAL
scan rewrites `$DC00`; `pitfalls/input.md` has what that does to a
port 2 read.

### Cycle budget

The read is 22 instructions and no branch: 62 cycles every frame,
measured by CIA1 timer A in VICE on PAL and NTSC, and the same from the
instruction table. As a subroutine it is 74 with the `jsr` and `rts`
(arithmetic). The Cost line states 62, the read inlined. The one-off
`$DD03` write is not part of the frame.

### Sources

- Protovision, 4-player adapter build page:
  https://www.protovision.games/hardw/build4player.php?language=en
  (PB7 select, `$DD03` = `$80`, fire 4 on bit 5)
- icomp wiki, "4 Player Adapter": https://wiki.icomp.de/wiki/4_Player_Adapter
  (DDR `%10000000`, `$80` selects joystick 3, `$00` joystick 4, fire 4 on PB5)
- VICE 3.10 source, `src/userport/userport_joystick.c` (CGA adapter) and
  `src/userport/userport_hks_joystick.c` (HIT, Kingsoft, StarByte)

### Recipes

- `recipes/kickassembler/four-player-read.md`

---

## irq_keyboard_own_scan — Scan the keyboard from your own IRQ, with per-key age counters and the KERNAL's exit points

**Complexity:** medium
**Region:** both
**Uses registers:** DC00, DC01, DC02, DC03
**Requires:** keyboard_matrix_scan
**Cost:** cycles_per_frame=945, irq_slots=1, zp_bytes=1
**Cost basis:** measured-vice

### Why

A game that takes the IRQ vector and masks CIA1 has switched off
SCNKEY, so `GETIN`, the buffer at `$0277` and the STOP key all go
quiet; the fix a platformer built for a blind test needed on 2026-09-22
(`pitfalls/input.md`, `cia1_ddr_cleared_kills_keyboard`) is the general
one. Scan the matrix yourself, once a frame, from the same IRQ that
drives the game. Done there rather than in the main loop, the scan
cannot be torn by the KERNAL's column writes, runs at a fixed point in
the frame, and gives every key a frame-accurate history: pressed this
frame, held N frames, released this frame.

### How

1. Mask CIA1 (`$DC0D` = `$7F`, then read it) and take `$0314`, or
   `$FFFE` with the KERNAL out. The direction registers stay as IOINIT
   left them, `$DC02` = `$FF` and `$DC03` = `$00`; write them anyway,
   because a loader or a previous program may not have.
2. In the IRQ, walk a single zero bit across `$DC00` from `$FE` to
   `$7F` and read `$DC01` after each store into an eight-byte image,
   one byte a column, bit r clear for a closed switch on row r. The
   layout is in `hardware/cia-reference.md`.
3. Write `$FF` back to `$DC00`. A joystick 2 poll later in the frame,
   or in the same handler, then reads only the port's own switches. The
   KERNAL leaves `$7F` and a game that copies that habit sees column 7's
   keys on port 2.
4. Edges: `prev EOR cur` is the set of changed bits; `AND prev` keeps
   the presses, `AND cur` the releases. Then `prev` = `cur`.
5. Ages: for each key the game uses, a byte that is 0 while the key is
   up and counts up from 1 while it is down, saturating at 255. Age 1 is
   the press event; age N is "held N frames"; a repeat rule on the age
   (first at REPEAT_AT, then every second frame) is `joystick_autorepeat`
   applied to a key.
6. Leave through the KERNAL's exit that matches what you kept. Read from
   the ROM image: `$EA81` is `PLA TAY PLA TAX PLA RTI`, the bare exit;
   `$EA7E` is `LDA $DC0D` then the same, a bare exit that also
   acknowledges CIA1; `$EA7B` is `JSR $EA87`, the SCNKEY call, then the
   two above; `$EA31` is the whole service routine, jiffy clock and
   cursor blink and tape motor and scan. A handler that keeps the KERNAL
   jiffy IRQ alive and adds its own scan exits through `$EA7E`, or does
   the acknowledge itself and uses `$EA81`; jumping to `$EA7B` runs the
   KERNAL scan too and defeats the point.

### Why it works

There are no diodes in the matrix, so one column pulled low lets only
that column's closed switches pull rows down; eight passes see all 64
switches (`keyboard_matrix_scan`). SCNKEY can no longer interleave its
own column writes with yours because it is not running: it is only
ever called from the handler at `$EA31`, and masking CIA1 stops that
handler. Everything the KERNAL did with the result, the decode to
PETSCII, the modifier tables, the ten-byte buffer, the repeat delay
in `$028B/$028C`, is now the game's to do or to skip; a game that
steers with keys skips all of it and reads the image directly.

The age counter carries the whole per-key state in one byte. It is
also the debounce, for the reason `keyboard_matrix_scan` gives: at one
sample per frame, a bounce costs at worst one extra release-and-press
pair, which shows as a second age 1.

### Variations

**Ghosting with three keys.** Three closed switches at three corners of
a rectangle in the matrix make the fourth corner read closed. A
key-steered game picks its keys so no three of them form three corners
of a rectangle: SPACE, Z, C, B are all row 4 and can never ghost with
each other, but Z (column 1, row 4) with W (column 1, row 1) and S
(column 1, row 5) is fine while Z, W and R (column 2, row 1) ghosts C
(column 2, row 4) on. From the wiring, not measured: a headless run
cannot hold three keys.

**The shift and control lines.** Left shift is column 1 row 7, right
shift column 6 row 4, CTRL column 7 row 2, C= column 7 row 5. They are
ordinary switches to the scan; a game reads them as modifiers by
testing those bits alongside the key. SHIFT LOCK is left shift held
mechanically.

**A keyboard-driven menu.** Ages give a menu its repeat for free: move
the cursor when a direction key's age is 1, again when it is
REPEAT_AT, then every second frame. The press set gives one event per
key per press for the confirm key, whatever the frame rate.

**Keeping the KERNAL IRQ.** If the game needs the jiffy clock or the
KERNAL's STOP handling, leave `$DC0D` alone, scan in your own raster
IRQ and exit through `$EA81` after acknowledging `$D019`; the KERNAL's
own SCNKEY still runs on the CIA timer and still leaves `$7F` on
`$DC00`. A joystick 2 read then has to tolerate `$7F`, or write `$FF`
first, and the two scans' column writes can interleave if the raster
IRQ is allowed to pre-empt the timer one (`pitfalls/input.md`,
`joystick2_scan_phantom_press`, and `keyboard_matrix_scan`, "Why the
KERNAL IRQ must be out of the way").

### Cycle budget

Measured in VICE x64sc 3.10 with CIA1 Timer A in the recipe's
handler, PAL and NTSC alike: the scan alone, eight columns with the
`$FF` restore, is 252 cycles; the scan plus the `$DC00` read-back, the
edge pass over eight columns and the ageing of four keys is 781 with
the matrix empty and 945 with all four watched keys held (41 cycles a
held key, the longer ageing branch). The Cost line carries the 945,
the worst frame. On PAL that is under 5 % of a 19,656-cycle frame,
about fifteen raster lines; it runs from line 250 in the recipe, below
the display, where no badline can stretch it.

### Recipes

- `recipes/kickassembler/own-keyscan.md`
