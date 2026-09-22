---
tool: oscar64-headers
tool_kind: c-library
maintainer: drmortalwombat
license: MIT
home_url: https://github.com/drmortalwombat/oscar64/tree/main/include/c64
---

<!-- doc-type: toolchain-reference -->

# Oscar64 Headers Reference

## Tool

The `include/c64/` directory in the Oscar64 source tree contains a suite of C headers that give Oscar64 programs structured, type-safe access to C64 hardware and operating-system services. Each header declares structs that map directly to the hardware register layout, named constants for all bit flags and enumerations, and helper functions that encapsulate common sequences. Every header with an implementation file uses a `#pragma compile("filename.c")` directive to automatically pull in its implementation (`types.h` and `easyflash.h` are header-only; an earlier version of this page said every header carries the pragma). Including the header is sufficient to link the library, with no separate link step — but a header does not re-export the `vic.h`/`rasterirq.h` names its own API uses, so a fence that calls `vic_waitLine()` or `rirq_wait()` still needs those headers included (see the fences below).

This document is the per-header API reference. For broader context on when to reach for these headers, see [oscar64-reference.md](oscar64-reference.md). The rule of thumb: whenever an Oscar64 recipe needs to touch a hardware register, there is almost certainly a header that makes it cleaner, safer, and more portable between PAL and NTSC builds than direct POKE/PEEK patterns.

## types.h — Fundamental C64 type aliases

Every other C64 header includes `types.h`. It defines four type aliases that appear throughout Oscar64 C64 code:

- `byte` — `unsigned char` (8-bit, used for all hardware register accesses)
- `word` — `unsigned int` (16-bit)
- `dword` — `unsigned long` (32-bit)
- `sbyte` — `signed char` (8-bit signed)

Using `byte` instead of `unsigned char` throughout hardware-access code makes intent clear and avoids accidental signed-extension bugs on values read from registers.

```c
#include <c64/types.h>

byte color = 0x0E;       // light blue
word address = 0xD400;   // SID base address
```

## vic.h — VIC-II chip access

`vic.h` provides the `VIC` struct that maps directly to the VIC-II register file at `$D000`. The macro `vic` dereferences a pointer to that address, so `vic.color_border` is a volatile byte write to `$D020`. The header also declares the `VICColors` enum (sixteen named palette entries from `VCOL_BLACK` to `VCOL_LT_GREY`), bit-flag constants for `ctrl1`, `ctrl2`, and `intr_enable`/`intr_ctrl`, and a `VicMode` enum for `vic_setmode`.

Public functions and macros:

- `vic` — macro reference to the VIC-II struct at `$D000`
- `VICColors` — enum: `VCOL_BLACK`, `VCOL_WHITE`, ..., `VCOL_LT_GREY`
- `vic_setbank(char bank)` — selects one of four 16 KB VIC banks (0–3)
- `vic_setmode(VicMode mode, const char * text, const char * font)` — sets display mode and base addresses
- `vic_sprxy(byte s, int x, int y)` — moves sprite `s` to `(x, y)`, handles the MSB X bit
- `vic_sprgetx(byte s)` — reads the full 9-bit X position of sprite `s`
- `vic_waitBottom()` / `vic_waitTop()` — waits for raster beam to reach bottom/top of frame
- `vic_waitFrame()` — waits for top then bottom (one full frame)
- `vic_isBottom()` — returns true if beam is below the visible area
- `vic_waitFrames(char n)` — busy-waits `n` full frames
- `vic_waitLine(int line)` — busy-waits until beam reaches a specific raster line
- `vic_waitBelow(int line)` / `vic_waitRange(char below, char above)` — positional raster waits

```c
#include <c64/vic.h>

vic.color_border = VCOL_BLACK;
vic.color_back   = VCOL_BLACK;
vic_waitFrame();               // sync to vertical blank
```

### The raster waits, line by line

The one-line summaries above are the header's own comments (`vic.h` lines
106 to 128, comments and declarations; the declarations themselves are
lines 107 to 128). What each routine actually waits for is in `vic.c` (Oscar64
build 2026-05-19; line numbers are that file's, read here). All of them
poll; none installs an interrupt or touches `$D019`. "RST8" is bit 7 of
`$D011` (`VIC_CTRL1_RST8`, `vic.h` line 10), the ninth bit of the raster
counter, set for raster lines 256 and up on every VIC-II.

- `vic_isBottom()` (`vic.c` 56 to 59): returns true if RST8 is set, that is,
  if the beam is on line 256 or later. No wait.
- `vic_waitBottom()` (62 to 66): spins while RST8 is clear. Returns on line
  256 if the beam was above it, and at once if it was already at or past
  256. The header's "bottom of the visual area" means line 256, six lines
  below the 25-row display window's last line, 250.
- `vic_waitTop()` (68 to 72): spins while RST8 is set. Returns on line 0 if
  the beam was in the RST8 band, and at once if it was anywhere in lines 0
  to 255. "Top of the frame" means line 0.
- `vic_waitFrame()` (74 to 80): `vic_waitTop()` then `vic_waitBottom()` in
  one function: spins until RST8 is clear, then until it is set. Always
  returns on line 256 of a frame that had not yet reached 256 when the call
  was made, so consecutive calls are exactly one frame apart. It is not
  "one full frame" from an arbitrary call, as the bullet above says: called
  from line 100 it returns 156 lines later. `vic_waitBottom()` alone does
  not give this guarantee: called twice inside the band it returns twice in
  the same frame, and the band is only 7 lines on the 6567R8 (256 to 262;
  settled frame length, arithmetic).
- `vic_waitFrames(char n)` (82 to 89): `vic_waitFrame()` `n` times. With
  `n == 0` it returns immediately.
- `vic_waitLine(int line)` (91 to 101; compiled native by the `#pragma` on
  line 140): splits the target into a low byte and bit 8 shifted into the
  RST8 position, spins until `$D012` equals the low byte, then checks RST8
  against the target's bit 8 and goes round again if they differ. So it
  distinguishes line 20 from line 276. It is an equality wait: if the
  target line passes while something else holds the CPU for longer than a
  line, it waits for the next frame, and a line the chip does not have (312
  and up on PAL, 263 and up on the 6567R8) never returns.
- `vic_waitBelow(int line)` (103 to 121): waits until the beam is past the
  line. For a target below 256 it spins while `$D012 <= low byte` and
  returns as soon as the raster reads greater, so it cannot miss the line,
  only end late. It compares the low byte alone and never reads RST8 in
  this case, so a call made from inside the RST8 band with a target below
  the band's low-byte range (below 56 on PAL, below 7 on the 6567R8) returns
  inside the band: target 20, called on PAL line 260, returns on line 277,
  whose low byte 21 is the first greater than 20, not on line 21 of the
  next frame (arithmetic from the source, not run here). A target of 100
  from the same place behaves: the band's low bytes are all at most 55, the
  spin continues through line 0, and it returns on line 101. For a target
  of 256 or more it spins on the low byte and then requires RST8 to be set,
  repeating if it is not.
- `vic_waitRange(char below, char above)` (123 to 138): both arguments are
  low bytes, so the range is within lines 0 to 255. It first spins while
  RST8 is set (gets out of the band), then, if `$D012` is already at or
  past `above`, waits through the next band (RST8 set, then clear) to reach
  the following frame, and finally spins while `$D012 < below`. It returns
  with the beam at or after `below` and, on entry, before `above`. The
  header's comment says "in a given range on screen"; the order of the
  arguments is `(below, above)`, lower line first.

For a loop that must run once a frame, `vic_waitFrame()` is the one to call
from the wait-only form; `techniques/raster.md` `frame_sync_loop` covers it,
with the interrupt-driven form and its dropped-frame counter, and
`recipes/oscar64/frame-sync-loop.md` measures both the fitting and the
overrunning case.

## sid.h — SID sound chip access

`sid.h` maps the SID chip at `$D400` to a `SID` struct with three nested `Voice` structs. It provides named constants for all attack, decay, sustain, release, waveform control, and filter mode bits, plus frequency calculation macros for PAL and NTSC clock rates.

Public functions and macros:

- `sid` — macro reference to the SID struct at `$D400`
- `NOTE_C(octave)` through `NOTE_B(octave)` — the note's frequency in **Hz**, not a SID register value: `NOTE_A(o)` is `28160U >> (10 - o)`, so `NOTE_A(4)` = 440 (header-read; measured in VICE). Pass the result through `SID_FREQ_PAL()` / `SID_FREQ_NTSC()` before writing it to `freq`; written raw on PAL, 440 plays 440 × 985248 / 2^24 ≈ 25.8 Hz. The values are integer-truncated (`NOTE_C(4)` = 261, not 261.63) and the octave argument must be 0..10 (the macro shifts right by 10 − octave). An earlier version of this page called them PAL-precomputed register values.
- `SID_FREQ_PAL(hz)` / `SID_FREQ_NTSC(hz)` — convert Hz to frequency register value for the respective clock
- `SID_CLOCK_PAL` (985248), `SID_CLOCK_NTSC` (1022727) — clock constants in Hz
- `SID_CTRL_*` constants — `GATE`, `SYNC`, `RING`, `TEST`, `TRI`, `SAW`, `RECT`, `NOISE`
- `SID_ATK_*` / `SID_DKY_*` constants — named attack/decay times in milliseconds
- `SID_FILTER_*` / `SID_FMODE_*` constants — filter routing and mode bits

```c
#include <c64/sid.h>

sid.voices[0].freq   = SID_FREQ_PAL(NOTE_A(4)); // 440 Hz, octave 4 -> register 7492
sid.voices[0].ctrl   = SID_CTRL_SAW | SID_CTRL_GATE;
sid.voices[0].attdec = SID_ATK_8 | SID_DKY_24;
sid.voices[0].susrel = 0xA0;
```

## cia.h — CIA timer and I/O chip access

`cia.h` maps CIA1 at `$DC00` and CIA2 at `$DD00` to `CIA` structs. CIA1 handles the keyboard matrix and joystick port 2; CIA2 handles the serial port, user port, and VIC bank select. The most common use of this header from Oscar64 code is `cia_init()`, which stops CIA timers and clears pending interrupts so that raster IRQs can take over cleanly.

Public API:

- `cia1` — macro reference to CIA1 struct at `$DC00`
- `cia2` — macro reference to CIA2 struct at `$DD00`
- `CIA` struct fields — `pra`, `prb` (port data), `ddra`, `ddrb` (direction), `ta`/`tb` (timers), `todt`/`tods`/`todm`/`todh` (TOD clock), `sdr` (serial shift), `icr` (interrupt control), `cra`/`crb` (control)
- `ciaa_pra_def` — default value for CIA1 port A (used by `cia_init`)
- `cia_init()` — disables CIA timer interrupts; required before using `rasterirq.h`

```c
#include <c64/cia.h>
#include <c64/memmap.h>

mmap_set(MMAP_NO_ROM);   // disable kernal
cia_init();              // kill CIA IRQs; raster IRQs take over
```

## rasterirq.h — Raster interrupt system

`rasterirq.h` is the demo-development backbone. It manages up to 16 simultaneous raster interrupt slots (configurable with `-dNUM_IRQS=n`). Each slot fires at a specified raster line and executes up to five memory writes in hand-optimized assembly. The system handles IRQ vector installation and slot sorting so that slots always fire in scanline order even when moved between frames. It does not disable the CIAs: no `rirq_init_*` variant writes `$DC0D`/`$DD0D` (header-read, `rasterirq.c`), so call `cia_init()` first when using `rirq_init_crt`, `rirq_init_crt_noio`, `rirq_init_io` or `rirq_init_memmap` (the variants whose handler does not fall through to the kernal), otherwise the CIA1 timer IRQ keeps entering a handler that never acknowledges it and the splits break up. The two kernal-routed variants (`rirq_init_kernal`, `rirq_init_kernal_noio`, i.e. `rirq_init(true)`) acknowledge `$DC0D` and continue into `$EA31`, so they run without `cia_init()`. It is also not cycle-exact: each slot busy-polls `CMP $D012`, so its writes land at the start of the line below `row`, inside horizontal blanking with a few cycles of jitter — a clean full-line colour split, but not a base for FLI, side-border or other cycle-exact effects. An earlier version of this page claimed CIA disabling and stable-raster timing.

`RIRQCode` is 32 bytes: a `size` byte plus a 31-byte code area (`RIRQ_SIZE`), holding up to five operations (address + data pairs). `RIRQCode10` (62 bytes, 61-byte code area) and `RIRQCode20` (107 bytes, 106-byte code area) hold up to 10 and 20 operations. `sizeof(RIRQCode)` measured in VICE = 32; an earlier version of this page said 31. The `size` byte is the number of operations (0–25; `rirq_build` asserts `size < 26`, larger counts need `RIRQCode10`/`RIRQCode20`). A delay is not a sixth slot: an `RIRQCode` carries either five writes or one delay plus four writes, because `rirq_delay()` re-uses write slot 0 — its data byte becomes the loop count and its STY is overwritten with a DEY/BNE loop (about 5 cycles per count; the header comment's own words). The earlier text described the `size` field as a wait value, a misreading of the header's "size (wait + #ops)" comment.

Public API:

- `rirq_build(RIRQCode * ic, byte size)` — initialises the code for `size` operations; the implementation accepts 0–25 (`__assume(size < 26)`, and the setters index 26-entry tables) but only as much room as the caller supplied: the RTS lands at code offset 12 for size 1 and 15+5·(size−2) above that, so size 5 ends at byte 30 (fits `RIRQCode`), size 10 at 55 (fits `RIRQCode10`), size 20 at 105 (exactly fills `RIRQCode20`); sizes 21–25 overflow every declared struct and are only safe in a `rirq_alloc()` block (`malloc(1 + 31 + 5*size)`) or a caller's own larger buffer. `size` = 0 builds a bare RTS. An earlier version of this page gave the range as 1–5.
- `rirq_alloc(byte size)` — heap-allocates an `RIRQCode`
- `rirq_write(RIRQCode * ic, byte n, void * addr, byte data)` — sets write slot `n` to store `data` at `addr`
- `rirq_call(RIRQCode * ic, byte n, void * addr)` — sets slot `n` to JSR `addr` (calls a C function from within the IRQ)
- `rirq_addr(RIRQCode * ic, byte n, void * addr)` — changes the target address of write slot `n` at runtime
- `rirq_addrhi(RIRQCode * ic, byte n, byte hi)` — changes only the high byte of the address (fast path for moving through memory pages)
- `rirq_data(RIRQCode * ic, byte n, byte data)` — changes the data byte of write slot `n` at runtime
- `rirq_delay(RIRQCode * ic, byte cycles)` — converts write slot 0 into a delay of roughly 5 × `cycles` before the remaining writes, for horizontal positioning. Call it after `rirq_build()` (which rebuilds slot 0 as a write) and then only use `rirq_write`/`rirq_data`/`rirq_addr` on slots 1..4 — slot 0's data byte IS the delay count, so `rirq_data(ic, 0, x)` changes the delay. Measured from the emitted bytes in VICE: after `rirq_build(&rc, 2)`, two `rirq_write`, `rirq_delay(&rc, 3)` the code is `A0 03 A2 02 CD 12 D0 B0 FB 88 D0 FD 8E 20 D0 60` with `size` still 2 — write 0 is gone. An earlier version of this page said the delay was added before the first write at no cost to a slot.
- `rirq_set(byte n, byte row, RIRQCode * write)` — installs `write` into slot `n` to fire one line below `row`
- `rirq_clear(byte n)` — removes slot `n`
- `rirq_move(byte n, byte row)` — changes the trigger line of slot `n` without rebuilding the code
- `rirq_init(bool kernalIRQ)` — `true` = `rirq_init_kernal()` (routes via `$0314`, works with the KERNAL ROM in, chains to the KERNAL handler); `false` = `rirq_init_io()`, which writes only the RAM copy of `$FFFE` and does not change `$01`. With the KERNAL ROM in (the default map) the CPU reads `$FFFE` from ROM and the handler never runs — the header's own wording is "if the kernal ROM is turned off". To use `false`: call `cia_init()` (the RAM-vector ISRs do not test `$D019`, so a live CIA timer IRQ would also enter them and misplace the writes), then `mmap_set(MMAP_NO_ROM)`, then `rirq_init(false)` — the order `sprmux32.c` uses. If the ROM may be in or out, use `rirq_init_crt()` / `rirq_init_crt_noio()`, which write both `$0314` and `$FFFE`. An earlier version of this page described `false` as a drop-in "install hardware vector directly".
- `rirq_init_kernal()` / `rirq_init_kernal_noio()` — kernal-routed variants
- `rirq_init_crt()` / `rirq_init_crt_noio()` — cartridge-safe variants
- `rirq_init_io()` / `rirq_init_memmap()` — RAM vector variants
- `rirq_start()` — enables the raster IRQ system
- `rirq_stop()` — disables it
- `rirq_sort(bool inirq)` — sorts the slots by scanline and builds the dispatch schedule (`rasterIRQNext[]`); call once after the initial `rirq_set()` calls and before `rirq_start()`, and again after any `rirq_set`/`rirq_move`/`rirq_clear`; pass `true` when calling from within an interrupt
- `rirq_wait_done()` — blocks until the last slot of the current frame has fired; call before `rirq_sort`
- `rirq_wait()` — blocks until the raster IRQ chain has completed one more pass (end of frame), i.e. until `rirq_count` changes; an earlier version of this page said "the next IRQ tick"
- `rirq_count` — volatile byte incremented once per frame, by the ISR after the last active slot has run (not once per slot: with two slots it advances by 1 per frame, not 2 — header-read, `inc rirq_count` sits only at the "no more interrupts" exit of each ISR variant). `rirq_wait()` returns when it has changed since the last `rirq_wait()`/`rirq_sort()`, which is why `vspr_update()`/`rirq_sort()` are placed after it. With no slots set it never advances and `rirq_wait()` will not return.

```c
#include <c64/vic.h>
#include <c64/rasterirq.h>

RIRQCode topBar, botBar;

void setup_raster(void) {
    rirq_init(true);

    rirq_build(&topBar, 2);
    rirq_write(&topBar, 0, &vic.color_back,   VCOL_RED);
    rirq_write(&topBar, 1, &vic.color_border, VCOL_RED);
    rirq_set(0, 50, &topBar);

    rirq_build(&botBar, 2);
    rirq_write(&botBar, 0, &vic.color_back,   VCOL_BLACK);
    rirq_write(&botBar, 1, &vic.color_border, VCOL_BLACK);
    rirq_set(1, 150, &botBar);

    rirq_sort(false);
    rirq_start();
}
```

This sets up two color splits: a red band from raster 51 to 151, and black above and below it. The order matters: `rirq_init()` resets every slot's row to 255, so it must come before any `rirq_set()`; and `rirq_sort()` is the only routine that builds the dispatch schedule (`rasterIRQNext[]`) and programs the first `$D012` line — `rirq_start()` only enables the raster IRQ. Without `rirq_sort()` the IRQ fires but no slot ever runs. Measured in VICE: with set-before-init, or with init-first but no sort, no band appears at all; with init → set → sort → start the text area is red from raster 51 through 150 and black from 151 (x64sc PAL exit PNG, rows 35–134 red and row 135 black at x = 200, row = line − 16), i.e. the slot set at `row` 150 fires on line 151, as the `rirq_set` bullet says. An earlier version of this fence called `rirq_set()` before `rirq_init()` and never called `rirq_sort()`, and it also lacked `#include <c64/vic.h>` (`rasterirq.h` includes only `types.h`, so `vic` and `VCOL_RED` were undefined).

## sprites.h — Hardware and multiplexed sprite control

`sprites.h` provides two layers of sprite management. The hardware layer (`spr_*`) operates directly on the eight VIC-II hardware sprites. The virtual layer (`vspr_*`) uses `rasterirq.h` slots 0–8 to multiplex 16 virtual sprites onto the eight physical sprites, repositioning them mid-screen as the beam passes.

Public API — hardware sprites:

- `spr_init(char * screen)` — initializes the sprite system for a given screen RAM address
- `spr_set(char sp, bool show, int x, int y, char image, char color, bool multi, bool xexpand, bool yexpand)` — fully configures sprite `sp`
- `spr_show(char sp, bool show)` — shows or hides sprite `sp`
- `spr_move(char sp, int x, int y)` — moves sprite to `(x, y)` with 8-bit Y and 9-bit X
- `spr_move16(char sp, int x, int y)` — moves sprite with 16-bit coordinates, hides when off-screen
- `spr_posx(char sp)` / `spr_posy(char sp)` — read current sprite position
- `spr_image(char sp, char image)` — changes the sprite data block
- `spr_color(char sp, char color)` — changes sprite color
- `spr_expand(char sp, bool xexpand, bool yexpand)` — sets double-size flags

Public API — virtual (multiplexed) sprites:

- `vspr_init(char * screen)` — initializes the multiplexer (occupies rirq slots 0–8)
- `vspr_shutdown()` — releases rirq slots
- `vspr_set(char sp, int x, int y, char image, char color)` — configures virtual sprite `sp` (0–15)
- `vspr_move(char sp, int x, int y)` — moves a virtual sprite
- `vspr_movex(char sp, int x)` / `vspr_movey(char sp, int y)` — single-axis moves
- `vspr_image(char sp, char image)` / `vspr_color(char sp, char color)` — attribute changes
- `vspr_hide(char sp)` — moves sprite off-screen
- `vspr_sort()` — sorts virtual sprites by Y position (call before `vspr_update`)
- `vspr_update()` — reprograms the hardware sprite slots based on sorted order; call at frame bottom after `rirq_wait()`
- `VSPRITES_MAX` define — default 16; override with `-dVSPRITES_MAX=32` for more slots (requires more rirq slots too)

```c
#include <c64/sprites.h>
#include <c64/rasterirq.h>   // rirq_wait / rirq_sort; sprites.h does not include it

vspr_init((char *)0x0400);
vspr_set(0, 160, 100, 1, VCOL_YELLOW);

// In main loop:
vic_waitBottom();
vspr_sort();
rirq_wait();
vspr_update();
rirq_sort();
```

## joystick.h — Joystick input

`joystick.h` provides polling-based joystick input. A single call to `joy_poll(n)` reads `$DC00+n` on CIA1 and populates three global arrays. Port numbering (verified against `include/c64/joystick.c`):

- `joy_poll(0)` reads **`$DC00`** = CIA1 port A = **physical joystick port 2** (the standard "game" port for single-player games).
- `joy_poll(1)` reads **`$DC01`** = CIA1 port B = **physical joystick port 1**.

Public API:

- `joy_poll(char n)` — polls joystick `n` (0 or 1) and updates globals
- `joyx[n]` — `sbyte`: -1 (left), 0 (center), +1 (right)
- `joyy[n]` — `sbyte`: -1 (up), 0 (center), +1 (down)
- `joyb[n]` — `bool`: true when fire button is pressed

```c
#include <c64/joystick.h>

joy_poll(0);             // port 2 — most common for single-player
player.x += joyx[0];
player.y += joyy[0];
if (joyb[0]) fire();
```

Note: `joy_poll` must be called once per frame (typically at the start of the game loop) to get a fresh snapshot. Multiple reads within one frame all see the same snapshot from the last `joy_poll` call.

**Note — port 2 and the keyboard column drive share `$DC00`, but a main-loop `joy_poll(0)` cannot see the scan.** SCNKEY is called from inside the KERNAL jiffy IRQ handler (`JSR $EA87` at `$EA7B`) and restores `$7F` before the handler's RTI, so the main loop is never running while the columns are driven (measured in VICE x64sc: 0 of 76,144 main-loop samples caught the `$00` window — `pitfalls/input.md`, joystick2_scan_phantom_press). Only an NMI handler, or an IRQ handler that `cli`s before chaining to `$EA31`, can read the all-pressed phantom value; if you poll from such a context, treat `$00` as "scan in progress" and re-read, or take over the IRQ. An earlier version of this page blamed the main loop and advised `sei`/`cli` around the poll, which changes nothing there. Port 1 (`joy_poll(1)`) has no timing hazard either, but a held `1`, LEFT-ARROW, CTRL, `2` or SPACE reads as joystick 1 continuously because the KERNAL leaves column 7 selected.

## keyboard.h — Keyboard matrix scan

`keyboard.h` provides matrix-level keyboard scanning. The hardware keyboard on the C64 is an 8x8 matrix read via CIA1 ports A and B; `keyb_poll()` scans the full matrix and records the result. The `KeyScanCode` enum covers all physical keys including shifted variants.

Public API:

- `keyb_poll()` — scans the full 8x8 keyboard matrix and updates `keyb_matrix` and `keyb_key`
- `keyb_matrix[8]` — raw scan results, one byte per column
- `keyb_key` — `KeyScanCode`: the scan code of the most recently detected key, with `KSCAN_QUAL_DOWN` (bit 7) set while pressed
- `keyb_codes[128]` — lookup table mapping scan codes to PETSCII values (first 64 unshifted, next 64 shifted)
- `key_pressed(KeyScanCode code)` — returns true if `code` is currently held down
- `key_shift()` — returns true if either shift key is pressed
- `KEY_F1`–`KEY_F8`, `KEY_RETURN`, `KEY_DEL`, `KEY_HOME`, `KEY_CLR`, `KEY_CSR_*` — PETSCII code constants
- `KSCAN_*` — scan code constants for every key

```c
#include <c64/keyboard.h>

keyb_poll();
if (key_pressed(KSCAN_SPACE)) { jump(); }
if (key_pressed(KSCAN_F1))    { pause_game(); }
```

`keyb_poll` is a full-matrix scan and is relatively expensive. For games that only need joystick input, prefer `joystick.h` and skip `keyb_poll` entirely.

## charwin.h — Character-mode windowed text rendering

`charwin.h` implements a cursor-based text window over a rectangular region of screen RAM. It wraps all screen writes with bounds checking, handles PETSCII versus screen-code distinction through `_raw` variants, and provides scrolling, editing, and console-style I/O within the window bounds.

The `CharWin` struct records the window geometry (`sx`, `sy` — top-left origin; `wx`, `wy` — width and height), the cursor position (`cx`, `cy`), and pointers to the screen and color RAM.

Public API highlights:

- `cwin_init(CharWin * win, char * screen, char sx, char sy, char wx, char wy)` — initialize without clearing
- `cwin_clear(CharWin * win)` — fill with spaces
- `cwin_fill(CharWin * win, char ch, char color)` — fill with character and color
- `cwin_cursor_move(CharWin * win, char cx, char cy)` — position cursor
- `cwin_cursor_show(CharWin * win, bool show)` — show/hide cursor (toggles MSB of char at cursor)
- `cwin_put_char(win, ch, color)` / `cwin_put_string(win, str, color)` — write at cursor, advance
- `cwin_putat_char(win, x, y, ch, color)` / `cwin_putat_string(win, x, y, str, color)` — write at absolute position
- `cwin_put_rect(win, x, y, w, h, chars, color)` — fill a rectangle
- `cwin_scroll_left/right/up/down(win, by)` — scroll the window contents
- `cwin_edit(CharWin * win)` — interactive edit: reads keystrokes, returns when RETURN or STOP is pressed
- `cwin_console_printf(win, color, fmt, ...)` — `printf`-style output to the window

`_raw` variants (`cwin_put_char_raw`, `cwin_putat_string_raw`, etc.) write screen codes directly without PETSCII translation. Use `_raw` when your data is already in screen-code format (e.g. tile indices).

```c
#include <c64/vic.h>       // VCOL_* — charwin.h does not include vic.h
#include <c64/charwin.h>

CharWin win;
cwin_init(&win, (char *)0x0400, 2, 2, 36, 21);
cwin_clear(&win);
cwin_put_string(&win, "SCORE:", VCOL_WHITE);
cwin_console_printf(&win, VCOL_YELLOW, "%d", score);
```

## mouse.h — 1351 mouse input

`mouse.h` reads a Commodore 1351 proportional mouse connected to a joystick port. The 1351 encodes movement in the SID potentiometer registers. `mouse_arm` primes the potentiometer circuit (needs ~4 ms to stabilize before reading) and `mouse_poll` reads the relative displacement.

Public API:

- `mouse_init()` — initializes mouse state
- `mouse_arm(char n)` — arms potentiometer input for port `n` (0 or 1); call ~4 ms before `mouse_poll`
- `mouse_poll()` — reads delta movement into `mouse_dx`/`mouse_dy` and button state
- `mouse_dx` / `mouse_dy` — `sbyte`: signed relative movement since last poll
- `mouse_lb` / `mouse_rb` — `bool`: left and right button state

```c
#include <c64/vic.h>       // vic_waitLine — mouse.h includes only types.h
#include <c64/mouse.h>

mouse_init();
// in frame loop:
mouse_arm(0);
vic_waitLine(200);   // busy-waits until raster line 200: 0-20 ms after arming,
                     // depending on beam position. The pot needs ~4 ms, so either
                     // frame-sync the loop (vic_waitBottom() before mouse_arm) or
                     // wait a fixed line only when mouse_arm ran at a known beam position.
mouse_poll();
cursor_x += mouse_dx;
cursor_y += mouse_dy;
```

## kernalio.h — KERNAL file I/O wrappers

`kernalio.h` wraps the C64 KERNAL file I/O routines (SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, LOAD, SAVE) in a C-callable interface. It uses logical file numbers (0–15) as handles and returns `krnioerr` status codes. A measured write, read-back, status-check and provoked-error run is `../recipes/oscar64/save-load-seq-file.md`; the call sequences as techniques are `../techniques/file-io.md`.

Public API:

- `krnio_setnam(const char * name)` — sets the filename for the next OPEN
- `krnio_setnam_n(const char * name, char len)` — sets filename with explicit length
- `krnio_open(char fnum, char device, char channel)` — opens a channel; returns true on success
- `krnio_close(char fnum)` — closes the channel
- `krnio_chkout(char fnum)` / `krnio_chkin(char fnum)` — redirect output/input to file
- `krnio_clrchn()` — restore default input/output channels
- `krnio_chrout(char ch)` / `krnio_chrin()` — byte-level I/O to current channel
- `krnio_getch(char fnum)` — read byte from file; returns negative on error, sets bit 8 on EOF
- `krnio_putch(char fnum, char ch)` — write byte to file
- `krnio_read(char fnum, char * data, int num)` — read `num` bytes; returns bytes read or negative
- `krnio_write(char fnum, const char * data, int num)` — write `num` bytes
- `krnio_gets(char fnum, char * data, int num)` — read until CR/LF and append zero
- `krnio_puts(char fnum, const char * data)` — write zero-terminated string
- `krnio_load(char fnum, char device, char channel)` — LOAD with KERNAL
- `krnio_save(char device, const char * start, const char * end)` — SAVE range to device
- `krnio_status()` — returns status of last I/O operation as `krnioerr`
- `krnio_read_lzo(char fnum, char * data)` — read and decompress LZO-compressed data from file
- `krnio_pstatus[16]` — per-file-number status array

```c
#include <c64/kernalio.h>

krnio_setnam("SCORES");
krnio_open(2, 8, 2);          // open file 2 on drive 8, channel 2
krnio_write(2, (char *)&hiscores, sizeof(hiscores));
krnio_close(2);
```

Note: string literals passed to `krnio_setnam` should use the `P` prefix (`P"SCORES"`) to ensure PETSCII encoding, since the KERNAL expects PETSCII filenames.

## iecbus.h — Low-level IEC serial bus

`iecbus.h` gives direct access to the IEC serial bus at a lower level than the KERNAL wrappers in `kernalio.h`. Use when implementing custom serial protocols or when the KERNAL overhead is unacceptable. `iec_status` holds the last operation result.

Public API:

- `iec_write(char b)` / `iec_read()` — byte-level bus read/write
- `iec_atn(char dev, char sec)` — ATN sequence to address a device
- `iec_talk(char dev, char sec)` / `iec_untalk()` — put device into talk mode
- `iec_listen(char dev, char sec)` / `iec_unlisten()` — put device into listen mode
- `iec_open(char dev, char sec, const char * fname)` — open a named file on the bus
- `iec_close(char dev, char sec)` — close
- `iec_write_bytes(const char * data, int num)` / `iec_read_bytes(char * data, int num)` — bulk transfer
- `iec_status` — `IEC_STATUS` enum: `IEC_OK`, `IEC_EOF`, `IEC_QUEUED`, `IEC_ERROR`, `IEC_TIMEOUT`, `IEC_DATA_CHECK`

```c
#include <c64/iecbus.h>

iec_listen(8, 15);              // open command channel on drive 8
iec_write_bytes("I0\r", 3);     // initialize disk
iec_unlisten();
```

Prefer `kernalio.h` for standard file operations. Use `iecbus.h` only when you need protocol-level control, such as implementing fast loaders or non-standard device protocols.

## easyflash.h — EasyFlash cartridge banking

`easyflash.h` provides access to the EasyFlash cartridge bank register at `$DE00` and a C++ template wrapper (`EFlashCall<fn>`) that automates bank switching when calling functions in different ROM banks.

The `EasyFlash` struct at `$DE00` has three fields: `bank` (volatile `__memmap byte`) which selects the active 16 KB bank (0–63), `pad1` (unused), and `control` (EasyFlash control flags). The `__memmap` qualifier on `bank` prevents any memory access from being reordered across a bank switch — critical for correctness.

Public API:

- `eflash` — macro reference to `EasyFlash` struct at `$DE00`
- `EFCTRL_GAME` / `EFCTRL_EXROM` / `EFCTRL_MODE` / `EFCTRL_LED` — control register flags
- `ef_call_p<back, fn, P...>(p...)` — switches to `fn`'s bank, calls it, switches back to bank `back`
- `EFlashCall<fn>` — C++ wrapper class; `operator()` resolves the current bank and calls `ef_call_p`
- `EF_CALL(fn)` — declares an `EFlashCall<fn_p>` variable named `fn` for clean call syntax

The template wrapper and `EF_CALL` are only defined under `__cplusplus`, so this must be compiled in C++ mode — either a `.cpp` source file or a `.c` file built with `-pp`. Compiled as plain C it fails with `Identifier not defined 'EF_CALL'` (build, Oscar64 2026-05-19 with `-tf=crt`; the same text as `.cpp` builds). `EF_CALL(render_level)` declares an `EFlashCall<render_level_p>` object named `render_level`, so you must have defined the real function as `render_level_p`. An earlier version of this page tagged the fence as C and omitted the `_p` definition.

```cpp
#include <c64/easyflash.h>

// The real function, placed in bank 2, carries the _p suffix:
int render_level_p(const char *data) { /* lives in bank 2 */ return 0; }

// Declare the cross-bank callable wrapper (EFlashCall<render_level_p> named render_level):
EF_CALL(render_level);

// At call site (works from any bank):
render_level(level_data);
```

`easyflash.h` is only relevant when building with `-tf=crt` targeting EasyFlash hardware. For stock-C64 programs (the primary c64-kb target), this header is not needed.

## memmap.h — Memory map control

`memmap.h` exposes the C64's memory banking register at `$01` and provides constants for common configurations. The C64's PLA interprets three bits of the CPU port to select which combination of BASIC ROM, KERNAL ROM, character ROM, and I/O area is visible at `$A000`–`$FFFF` and `$D000`–`$DFFF`.

Public API:

- `mmap_set(char pla)` — writes `pla` to `$01`; returns previous value; uses `__memmap` to prevent reordering
- `mmap_trampoline()` — installs an IRQ/NMI trampoline that keeps KERNAL interrupts working when the KERNAL ROM is paged out; call before `mmap_set(MMAP_NO_ROM)`

Memory map constants:

| Constant | Value | Configuration |
|----------|-------|---------------|
| `MMAP_ROM` | `$37` | BASIC + I/O + KERNAL (default power-on state) |
| `MMAP_NO_BASIC` | `$36` | I/O + KERNAL only (frees `$A000`–`$BFFF` as RAM) |
| `MMAP_NO_ROM` | `$35` | I/O only (frees `$A000`–`$BFFF` and `$E000`–`$FFFF`) |
| `MMAP_RAM` | `$30` | All RAM, no ROM, no I/O |
| `MMAP_CHAR_ROM` | `$31` | Character ROM visible (for copying glyphs) |
| `MMAP_ALL_ROM` | `$33` | All ROM, no I/O (disables hardware register access) |

```c
#include <c64/memmap.h>

mmap_trampoline();           // keep IRQs working
mmap_set(MMAP_NO_ROM);       // extra 28 KB of code+data space
// Now $A000–$BFFF and $E000–$FFFF are RAM
```

After `mmap_set(MMAP_NO_ROM)` or `mmap_set(MMAP_RAM)` the KERNAL is gone, and every KERNAL call crashes — including the `krnio_*` wrappers, which are plain `JSR $FFxx` calls into the jump table and never touch `$01` (header-read, `kernalio.c`: on the C64 their `BANKIN`/`BANKOUT` macros are empty; only the Plus/4 build banks the ROM in). `mmap_trampoline()` covers only the IRQ/NMI entry path; it does nothing for a `JSR` from your own code. An earlier version of this page said the `krnio_*` wrappers handle the memory map; they do not. To do KERNAL I/O while running with the ROM out, bank it back in around the call and restore the previous map afterwards:

```c
#include <c64/memmap.h>
#include <c64/kernalio.h>

char old = mmap_set(MMAP_ROM);
krnio_setnam(P"SCORES");
krnio_open(2, 8, 2);
/* ... krnio_read / krnio_write ... */
krnio_close(2);
mmap_set(old);
```

`MMAP_NO_BASIC` (`$36`) keeps the KERNAL in, so `krnio_*` works unchanged under it. While the ROM is banked in, a buffer that lives under `$A000–$BFFF` or `$E000–$FFFF` reads back as ROM bytes, so keep I/O buffers below `$A000` or in `$C000–$CFFF`.

## reu.h — RAM Expansion Unit DMA

`reu.h` provides access to the 1700/1764/1750 RAM Expansion Unit connected at `$DF00`. The REU adds 128 KB, 256 KB, or 512 KB of battery-backed RAM accessible via DMA. The header maps the REU control registers to a `REU` struct and provides inline helpers for common transfer operations.

Note: REU support is listed in Oscar64 headers for completeness. The c64-kb scope is stock C64 hardware; REU recipes are out of scope for this KB. This header is documented here so agents know it exists.

Public API:

- `reu` — macro reference to `REU` struct at `$DF00`
- `reu_count_pages()` — tests how many 64 KB pages of REU are present (destructive test)
- `reu_store(unsigned long raddr, const volatile char * sp, unsigned length)` — copy from C64 RAM to REU
- `reu_load(unsigned long raddr, volatile char * dp, unsigned length)` — copy from REU to C64 RAM
- `reu_fill(unsigned long raddr, char c, unsigned length)` — fill REU memory with a value
- `reu_load2d(unsigned long raddr, volatile char * dp, char height, unsigned width, unsigned stride)` — 2D DMA transfer (e.g. for tile blitting from REU)

```c
#include <c64/reu.h>

// Save current screen to REU bank 0
reu_store(0UL, (volatile char *)0x0400, 1000);
// Later, restore it
reu_load(0UL, (volatile char *)0x0400, 1000);
```

## asm6502.h — Runtime 6502 code emitter

`asm6502.h` provides a set of inline functions that write raw 6502 machine instructions into a byte buffer at runtime. This is used to generate self-modifying code, JIT-compiled routines, or custom IRQ stubs that must live at specific addresses. Each `asm_*` function emits one instruction and returns the instruction size in bytes.

The `AsmIns` enum lists all standard 6502 opcodes in their base (implied or zero-page) form. Addressing mode wrappers encode the full instruction.

Public API — addressing mode wrappers (each returns instruction size):

- `asm_np(byte * ip, AsmIns ins)` — implied (e.g. `NOP`, `RTS`, `SEI`)
- `asm_ac(byte * ip, AsmIns ins)` — accumulator (e.g. `ROL`)
- `asm_im(byte * ip, AsmIns ins, byte value)` — immediate
- `asm_zp(byte * ip, AsmIns ins, byte addr)` — zero page
- `asm_zx(byte * ip, AsmIns ins, byte addr)` — zero page indexed X
- `asm_zy(byte * ip, AsmIns ins, byte addr)` — zero page indexed Y
- `asm_ab(byte * ip, AsmIns ins, unsigned addr)` — absolute
- `asm_ax(byte * ip, AsmIns ins, unsigned addr)` — absolute indexed X
- `asm_ay(byte * ip, AsmIns ins, unsigned addr)` — absolute indexed Y
- `asm_in(byte * ip, AsmIns ins, unsigned addr)` — indirect (JMP only)
- `asm_ix(byte * ip, AsmIns ins, byte addr)` — (zp,X) indirect pre-indexed
- `asm_iy(byte * ip, AsmIns ins, byte addr)` — (zp),Y indirect post-indexed
- `asm_rl(byte * ip, AsmIns ins, sbyte addr)` — relative branch

```c
#include <c64/asm6502.h>

// Emit a short routine into a RAM buffer (static: see the note below)
static byte codebuf[16];
byte * p = codebuf;
p += asm_im(p, ASM_LDA, 0x0E);          // LDA #$0E
p += asm_ab(p, ASM_STA, 0xD020);        // STA $D020
p += asm_np(p, ASM_RTS);                // RTS
// codebuf now holds a 6-byte routine (A9 0E 8D 20 D0 60) that sets the border to light blue
__asm { jsr codebuf }                    // call it
```

As of the 2026-05-19 build, calling a byte buffer through a cast function pointer (`((void (*)(void))codebuf)();`) crashes the compiler — exit 139, no `.prg`, no diagnostic — when the buffer is a local, whether the call is direct or through a pointer variable (build; the same class as the `const` function-pointer segfault in the project gotchas). With a global buffer the same cast call compiles, but at `-O2` the stores into the buffer are dead-store-eliminated and the JSR lands on zeroed BSS, so use the inline-asm `jsr`. And `__asm { jsr codebuf }` on a LOCAL (stack) buffer assembles to `JSR $0000` with only a "nullptr dereferenced" warning, which is why the buffer must be `static` or file-scope. The routine is 6 bytes (`asm_im` 2 + `asm_ab` 3 + `asm_np` 1; bytes measured in VICE); an earlier version of this page said 7 and showed the crashing cast call.

Use `asm6502.h` as a last resort — it bypasses all compiler optimizations and type checking. Prefer `__asm { }` inline blocks for most performance-critical code.
