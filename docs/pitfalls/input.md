---
category: input
---

<!-- doc-type: pitfall-reference -->

# Input Pitfalls

Pitfalls in keyboard, joystick, and shared-pin input handling. The
recurring theme: CIA1 multiplexes joystick, keyboard, and paddle I/O
onto the same eight pins per port, and stock KERNAL services
(SCNKEY, jiffy IRQ) drive those pins on a fixed schedule. Because the
scan runs entirely inside the IRQ handler, a main-loop poll of
`$DC00`/`$DC01` sees the KERNAL's idle state (`$DC00` = `$7F`,
`$DC01` = `$FF`); the ghost input this page used to promise a
main-loop poller does not occur (measured in VICE x64sc, below). What
does bite is code that pre-empts the IRQ handler — an NMI or a nested
handler — and the static crosstalk between held keys and port 1.

---

## joystick2_scan_phantom_press — `$DC00` reads `$00` mid-SCNKEY, but only an NMI or nested handler can see it; a main-loop `joy_poll(0)` cannot

**Severity:** high
**Region:** both
**Triggered by registers:** DC00
**Triggered by kernal:** SCNKEY
**Triggered by techniques:** joystick_edge_detect, joystick_autorepeat, keyboard_matrix_scan, paddle_read, mouse_1351_read, attract_mode_input_replay, two_player_state_swap

### Symptom

Code that samples `$DC00` from a context that can interrupt the
KERNAL's jiffy IRQ handler — an NMI handler, or an IRQ handler that
`cli`s before chaining to `$EA31` — occasionally reads `$00`: all
five joystick-2 bits low, UP+DOWN+LEFT+RIGHT+FIRE at once. A binary
monitor stopped at the right moment sees the same `$00`; a moment
later it reads `$7F` (no input). The reading appears only while the
KERNAL IRQ is enabled — programs that `sei` and install their own
IRQ don't exhibit it.

An earlier revision of this entry said a *main-loop* `joy_poll(0)`
(Oscar64 `joystick.h`) races the scan and produces the same phantom
presses — a "press fire to start" screen advancing by itself. That
was wrong: SCNKEY is called from inside the IRQ handler and finishes
before the handler's RTI, so the main loop is never executing while
the columns are driven. Measured in VICE x64sc (PAL): a main loop
polling `$DC00` roughly every 50 cycles for 250 jiffies with the
KERNAL IRQ live read `$7F` on all 76,144 samples, `$00` on none. A
CIA2 timer NMI (~101-cycle period) doing the same poll in the same
program caught `$00` roughly once per jiffy scan (242 and 277 hits in
two 250-jiffy runs — it is run-dependent) while the main loop in the
same runs saw it 0 times in 35,653 and 28,382 reads. If a main-loop
poll sees ghost input, look elsewhere: a held key in column 7 on port
1 (Fix C), or a bug in the poller.

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
(`$EA87`, the routine behind the `$FF9F` jump-table entry; the
handler's own call is a direct `JSR $EA87` at `$EA7B`). SCNKEY's
first step is to detect *any* key-pressed by driving all eight
columns active-low simultaneously — it writes `$00` to the `$DC00`
data register (DDR A was set to `$FF` by IOINIT at reset and SCNKEY
never touches it; an earlier revision said the scan wrote the DDR,
which it does not — the only DDR-A store in the KERNAL is `STX $DC02`
at `$FDC8`) — then reads `$DC01` looking for any zero bit.

From that store until the scan restores `$7F` (`LDA #$7F / STA $DC00`
at `$EB42-$EB44`), `$DC00` reads `$00`. On the no-key path that is 38
cycles by ROM cycle count (`$EA90` through `$EB44`:
4+2+3+4+3+3+4+4+2+3+2+4), not "a few microseconds" as this page once
said; with a key held, the column walk keeps `$DC00` at a single-column
pattern for hundreds of cycles more. Anything that samples `$DC00`
inside that window sees all five joystick-2 bits low and interprets
the result as UP+DOWN+LEFT+RIGHT+FIRE simultaneously pressed.
Oscar64's `joy_poll` resolves this to `joyy[0]=-1` (up wins the
y-axis tiebreak), `joyx[0]=-1` (left wins x-axis), `joyb[0]=true`.

Who can be inside that window: the IRQ handler itself is not
re-entered (the I flag is set), so only an NMI, a handler that `cli`s
before chaining to the KERNAL, or an external monitor can observe it.
The main loop cannot — the CPU is in the handler for the whole scan.
The roughly one-hit-per-scan rate of the NMI probe above does not
contradict the 38-cycle figure: each NMI pre-emption costs the
interrupted handler on the order of 40-60 cycles of the ~101-cycle
NMI period (arithmetic from the probe's instruction counts, not
measured), so the IRQ handler advances well under 101 cycles between
NMI samples and a 38-cycle window is rarely stepped over — and is
sometimes sampled twice, which is why one run logged 277 hits in 250
scans.

This isn't an Oscar64 bug — a `PEEK($DC00)` from an NMI in any
toolchain has the same hazard. It's a shared-pin property of the C64
plus the KERNAL's choice to drive the columns from the jiffy IRQ.

### Fix

Three reliable options, in order of effort:

**A. Use keyboard input instead of joystick port 2.** The KERNAL
keyboard buffer at `$0277-$0280` is filled by SCNKEY itself; reading
it via `getchx()` (Oscar64 conio, which calls KERNAL GETIN at
`$FFE4`; an earlier revision also named a `getin()` function, which
`conio.h` does not declare) does not race with the scan. What comes
back is the KERNAL's PETSCII code after Oscar64's `convch()`: under
the default `iocharmap` (`IOCHM_ASCII`) letters pass through
unchanged, so the W key arrives as `$57` (`'W'`) in either display
case mode (KERNAL unshifted table at `$EB81`, index 9), and a
comparison against `'w'` (`$77`) is a dead branch. Compare against
the upper-case literal, or call `iocharmap(IOCHM_PETSCII_1)` first —
which also emits CHR$(142) and switches the display to the
uppercase/graphics font. This page used to call the result "clean
PETSCII codes"; it is not quite: RETURN arrives as `10`, not PETSCII
`13`. See `pitfalls/kernal-and-io.md` (getchx_petscii_remaps_return)
for the RETURN remap.

```c
#include <conio.h>

unsigned char k = getchx();   // 0 if no key, else the key's code
if (k == ' ')  start();
if (k == 'W')  fast();        // 'w' ($77) never matches under IOCHM_ASCII
```

**B. Keep the poll out of anything that pre-empts the jiffy IRQ.**
If you must read `$DC00` from an NMI handler or from a handler that
`cli`s before chaining to `$EA31`, either take over the IRQ so no
KERNAL scan runs at all, or treat a `$00` sample as "scan in
progress" and re-read. Taking over the IRQ stops the KERNAL keyboard
buffer filling, so combine it with `keyb_poll()` (which reads the
matrix directly) for key input.

```c
__asm { sei }
joy_poll(0);
__asm { cli }
```

The `sei`/`cli` bracket above, which an earlier revision of this page
recommended for a main-loop poll, changes nothing there — the
main-loop measurement in the Symptom was taken *without* it and saw
no phantom reads — and `sei` does not hold off an NMI. It is kept
only as the shape of the call inside a handler you own. Taking over
the IRQ entirely is the conventional approach for action games.

**C. Poll port 1 (`joy_poll(1)` → `$DC01`) instead.** Port 1
(`joy_poll(1)`, `$DC01`) has no scan-timing hazard either — from the
main loop, neither port does: SCNKEY runs entirely inside the jiffy
IRQ, so only an NMI or a nested handler can observe it mid-scan, and
the scan reads the rows without driving them (measured in VICE
x64sc: 0 of 140,179 main-loop reads of `$DC01` across three
250-jiffy runs differed from `$FF`, and a CIA2-NMI probe that
pre-empted the scan still never saw `$DC01` move — 0 deviations in
~40,000 NMI samples — while `$DC00` was caught at `$00` 277 times in
the same run). Port 1's real problem is static: the KERNAL leaves
`$DC00` at `$7F` between scans (`$EB42`, and IOINIT), so column 7 is
always selected and five held keys read as joystick 1 continuously —
`1` = UP, LEFT-ARROW = DOWN, CTRL = LEFT, `2` = RIGHT, SPACE = FIRE
(C=, Q and RUN/STOP share the column but land on bits 5-7, which
`joy_poll` ignores). Conversely a joystick in port 1 makes the KERNAL
type keys (see `hardware/cia-reference.md`, joystick interference).
An earlier revision of this fix described a "narrower" timing race
on port 1; there is none. Single-player games conventionally use
port 2 anyway, so this only helps if your design naturally fits
two-player or supports port-1 input.

### Worked example

The unlock-trap demo (`loop/demo/unlock-trap.c`, not in this
repository) originally polled port 2 alongside `getchx()` from its
main loop:

```c
// Attributed to SCNKEY phantom presses; see the note below
joy_poll(0);
bool fire = joyb[0] != 0 || getchx() == ' ';
```

Its title screen advanced to PLAY on tick 1, the game applied a FAST
action without user input, and reached a steady phase=PLAY state in
~3 seconds. This page originally blamed phantom joystick reads from
the scan window. Given the measurement in the Symptom — a main-loop
poll never sees the window — that attribution was wrong; the real
cause was not established (a held or stuck column-7 key, a `$DC02`
left at `$00` by earlier code, or the poller itself are candidates).
Replacing the joystick path with keyboard-only made the symptom
stop, which removes the joystick read but does not name the cause:

```c
// Keyboard only; the KERNAL buffer is filled by the scan itself
unsigned char key = getchx();
bool fire = key == ' ';
```

### Cross-references

- **Hardware:** `hardware/cia-reference.md` documents the shared-pin
  table for `$DC00`/`$DC01`.
- **KERNAL:** `SCNKEY` (`$EA87`; `$FF9F` is its jump-table entry) is
  the routine that drives the columns; the IRQ handler calls it
  directly at `$EA7B`.
- **Idiomatic input:** `toolchains/oscar64-headers-reference.md`
  → `joystick.h`, `keyboard.h`, `conio.h`.

---

## cia1_ddr_cleared_kills_keyboard — Clearing `$DC02` to read joystick 2 leaves the keyboard dead until something writes `$FF` back

**Severity:** high
**Region:** both
**Triggered by registers:** DC02, DC00
**Triggered by kernal:** SCNKEY
**Triggered by techniques:** joystick_edge_detect, joystick_autorepeat, keyboard_matrix_scan, paddle_read, mouse_1351_read, attract_mode_input_replay, two_player_state_swap

### Symptom

The joystick works, the game plays, and no key does anything: not the
pause key, not RUN/STOP, not RUN/STOP+RESTORE's usual effect on a BASIC
program either, until a reset. Nothing in a headless run shows it,
because a headless run never presses a key.

### Mechanism

Joystick 2 shares port A (`$DC00`) with the keyboard's column drive.
IOINIT sets the port A data-direction register `$DC02` to `$FF` (all
output) at reset and on RUN/STOP+RESTORE, and the KERNAL keyboard
scanner SCNKEY relies on that: it writes column patterns to `$DC00` and
never touches a DDR. A program that clears `$DC02` "to make port A an
input for the joystick" turns every column line into a high-impedance
input. SCNKEY's column writes then drive nothing, `$DC01` reads `$FF`
whatever is held, and the jiffy scan reports no key for as long as the
DDR stays clear. The reference page states this directly
(`hardware/cia-reference.md`, the `$DC02` entry): "if you clear `$DC02`
to read joystick 2 you must restore `$FF` yourself; the jiffy scan will
not."

The joystick still reads correctly either way, which is why the fault
survives testing: the stick grounds its lines, and a read of `$DC00`
returns the pin level.

### Fix

Leave the direction registers as IOINIT set them, `$DC02` = `$FF` and
`$DC03` = `$00`, and read `$DC00` directly for joystick 2. That is what
`recipes/oscar64/joystick-input.md` does (it writes those two values
itself rather than trusting the state it inherited). If some other code
must clear `$DC02`, write `$FF` back before the next jiffy interrupt, or
keep the keyboard scan out of the picture by disabling the KERNAL IRQ
and scanning the matrix yourself (`keyboard_matrix_scan`).

### Worked example

A platformer built for a blind test on 2026-09-22 wrote `cia1.ddra = 0`
once before its main loop, with the comment "port A input for joystick
2", and never wrote it again. Its joystick build was never run with a
key pressed, so the run looked fine. The consequence is read from the
reference page's statement of what SCNKEY needs, not measured on a
keyboard here: there is no headless way to press a key in this harness,
and the code was found by reading the source against the page.

### Cross-references

- **Hardware:** `hardware/cia-reference.md`, the `$DC02` entry: IOINIT's
  store, when it runs again, and that SCNKEY never writes a DDR.
- **Sibling pitfall:** `joystick2_scan_phantom_press` covers the other
  direction of the same shared-pin problem, a main-loop read seeing the
  scanner's column pattern.
- **Recipe:** `recipes/oscar64/joystick-input.md` sets both DDRs to the
  IOINIT values before its first read.
