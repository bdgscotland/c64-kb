---
category: input
chip: CIA
---

<!-- doc-type: technique-reference -->

# Input Techniques

Reading the joystick ports and the keyboard matrix directly from CIA1,
without the KERNAL's once-per-jiffy scanner. All three techniques share
one fact: CIA1 port A (`$DC00`) is control port 2 and the keyboard's
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
