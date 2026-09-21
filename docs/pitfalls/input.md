---
category: input
---

<!-- doc-type: pitfall-reference -->

# Input Pitfalls

Pitfalls in keyboard, joystick, and shared-pin input handling. The
recurring theme: CIA1 multiplexes joystick, keyboard, and paddle I/O
onto the same eight pins per port, and stock KERNAL services
(SCNKEY, jiffy IRQ) drive those pins on a fixed schedule. User code
that polls `$DC00`/`$DC01` without coordinating with the KERNAL sees
ghost input.

---

## joystick2_scan_phantom_press — `joy_poll(0)` reads phantom presses while KERNAL scans the keyboard

**Severity:** high
**Region:** both
**Triggered by registers:** DC00
**Triggered by kernal:** SCNKEY
**Triggered by techniques:** stable_raster_irq

### Symptom

A program built with Oscar64's `joystick.h`, polling joystick port 2
via `joy_poll(0)` once per frame, sees seemingly random fire-button
and direction events even though no joystick is connected and the
user is not pressing keys. In the most visible form: a "press fire
to start" title screen advances to gameplay on the first frame
without any user input. Inside gameplay, the player character
twitches in random directions. Polling at a different point in the
frame changes the symptom but doesn't eliminate it.

The same program reads `$DC00` directly via the binary monitor and
sees `$7F` (no input), then reads it microseconds later and sees
`$00` (all input bits low). The bug correlates with the KERNAL IRQ
being enabled — programs that `sei` and install their own IRQ don't
exhibit it.

### Mechanism

CIA1 port A (`$DC00`) is the shared **column-drive output** for the
keyboard matrix AND the **input** for joystick port 2's five
direction/fire switches. Both functions multiplex onto the same
eight physical pins:

| Bit | Keyboard column | Joystick port 2 |
|-----|-----------------|-----------------|
| 0   | Column 0 drive  | UP              |
| 1   | Column 1 drive  | DOWN            |
| 2   | Column 2 drive  | LEFT            |
| 3   | Column 3 drive  | RIGHT           |
| 4   | Column 4 drive  | FIRE            |

The KERNAL IRQ handler at `$EA31` runs every jiffy and calls SCNKEY
at `$FF9F`. SCNKEY's first step is to detect *any* key-pressed by
driving all eight columns active-low simultaneously — it writes
`$00` to `$DC00`'s data direction register and `$00` to the data
register — then reads `$DC01` looking for any zero bit.

During that window (a few microseconds), `$DC00` reads `$00`. If
user code in the main loop samples `$DC00` (`joy_poll(0)` does
exactly this), it sees all five joystick-2 bits low and interprets
the result as UP+DOWN+LEFT+RIGHT+FIRE simultaneously pressed.
Oscar64's `joy_poll` resolves this to `joyy[0]=-1` (up wins the
y-axis tiebreak), `joyx[0]=-1` (left wins x-axis), `joyb[0]=true`.

This isn't an Oscar64 bug — direct `PEEK($DC00)` in any toolchain
has the same hazard. It's a fundamental shared-pin property of the
C64.

### Fix

Three reliable options, in order of effort:

**A. Use keyboard input instead of joystick port 2.** The KERNAL
keyboard buffer at `$0277-$0280` is filled by SCNKEY itself; reading
it via `getchx()`/`getin()` does not race with the scan. Buffer
reads return clean PETSCII codes.

```c
#include <conio.h>

unsigned char k = getchx();   // 0 if no key, else PETSCII
if (k == ' ')  start();
if (k == 'w')  fast();
```

**B. Disable the KERNAL IRQ around the poll.** Install your own IRQ
handler or `sei`/`cli`-bracket the call. The KERNAL keyboard buffer
stops filling, so combine this with `keyb_poll()` (which reads the
matrix directly) for key input.

```c
__asm { sei }
joy_poll(0);
__asm { cli }
```

This is the conventional approach for action games that take over
the IRQ entirely.

**C. Poll port 1 (`joy_poll(1)` → `$DC01`) instead.** Port 1 reads
keyboard *rows*, which the scan reads but doesn't drive. The race
is narrower but not eliminated — single-player games conventionally
use port 2 anyway, so this only helps if your design naturally fits
two-player or supports port-1 input.

### Worked example

The unlock-trap demo (`loop/demo/unlock-trap.c`) originally polled
port 2 alongside `getchx()`:

```c
// BUG: joy_poll(0) gets phantom presses from SCNKEY
joy_poll(0);
bool fire = joyb[0] != 0 || getchx() == ' ';
```

Symptom: the title screen advanced to PLAY on tick 1, the game
applied a FAST action without user input, and reached a steady
phase=PLAY state in ~3 seconds — entirely from phantom joystick
reads. Replacing the joystick path with keyboard-only fixed it:

```c
// FIX: keyboard only; KERNAL buffer is race-free
unsigned char key = getchx();
bool fire = key == ' ';
```

### Cross-references

- **Hardware:** `hardware/cia-reference.md` documents the shared-pin
  table for `$DC00`/`$DC01`.
- **KERNAL:** `SCNKEY` at `$FF9F` is the routine that races.
- **Idiomatic input:** `toolchains/oscar64-headers-reference.md`
  → `joystick.h`, `keyboard.h`, `conio.h`.

---
