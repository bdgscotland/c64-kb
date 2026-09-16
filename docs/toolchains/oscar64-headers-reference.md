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

The `include/c64/` directory in the Oscar64 source tree contains a suite of C headers that give Oscar64 programs structured, type-safe access to C64 hardware and operating-system services. Each header declares structs that map directly to the hardware register layout, named constants for all bit flags and enumerations, and helper functions that encapsulate common sequences. Every header uses a `#pragma compile("filename.c")` directive to automatically pull in its implementation: including the header is sufficient to use the library, with no separate link step.

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

## sid.h — SID sound chip access

`sid.h` maps the SID chip at `$D400` to a `SID` struct with three nested `Voice` structs. It provides named constants for all attack, decay, sustain, release, waveform control, and filter mode bits, plus frequency calculation macros for PAL and NTSC clock rates.

Public functions and macros:

- `sid` — macro reference to the SID struct at `$D400`
- `NOTE_C(octave)` through `NOTE_B(octave)` — 16-bit frequency register values for musical notes, precomputed for PAL clock
- `SID_FREQ_PAL(hz)` / `SID_FREQ_NTSC(hz)` — convert Hz to frequency register value for the respective clock
- `SID_CLOCK_PAL` (985248), `SID_CLOCK_NTSC` (1022727) — clock constants in Hz
- `SID_CTRL_*` constants — `GATE`, `SYNC`, `RING`, `TEST`, `TRI`, `SAW`, `RECT`, `NOISE`
- `SID_ATK_*` / `SID_DKY_*` constants — named attack/decay times in milliseconds
- `SID_FILTER_*` / `SID_FMODE_*` constants — filter routing and mode bits

```c
#include <c64/sid.h>

sid.voices[0].freq   = NOTE_A(4);            // 440 Hz, octave 4
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

`rasterirq.h` is the demo-development backbone. It manages up to 16 simultaneous raster interrupt slots (configurable with `-dNUM_IRQS=n`). Each slot fires at a specified raster line and executes up to five memory writes in hand-optimized assembly. The system handles IRQ vector installation, CIA disabling, stable-raster timing, and slot sorting so that slots always fire in scanline order even when moved between frames.

`RIRQCode` is a 31-byte structure that encodes up to five writes (address + data pairs). Larger variants `RIRQCode10` and `RIRQCode20` hold 10 and 20 writes respectively. A sixth slot in the sequence (`size` field) is a wait value for sub-line delay.

Public API:

- `rirq_build(RIRQCode * ic, byte size)` — initializes an `RIRQCode` for `size` writes (1–5); `size` = 0 is a no-op slot
- `rirq_alloc(byte size)` — heap-allocates an `RIRQCode`
- `rirq_write(RIRQCode * ic, byte n, void * addr, byte data)` — sets write slot `n` to store `data` at `addr`
- `rirq_call(RIRQCode * ic, byte n, void * addr)` — sets slot `n` to JSR `addr` (calls a C function from within the IRQ)
- `rirq_addr(RIRQCode * ic, byte n, void * addr)` — changes the target address of write slot `n` at runtime
- `rirq_addrhi(RIRQCode * ic, byte n, byte hi)` — changes only the high byte of the address (fast path for moving through memory pages)
- `rirq_data(RIRQCode * ic, byte n, byte data)` — changes the data byte of write slot `n` at runtime
- `rirq_delay(RIRQCode * ic, byte cycles)` — adds a 5-cycle delay (per count) before the first write; used for horizontal positioning
- `rirq_set(byte n, byte row, RIRQCode * write)` — installs `write` into slot `n` to fire one line below `row`
- `rirq_clear(byte n)` — removes slot `n`
- `rirq_move(byte n, byte row)` — changes the trigger line of slot `n` without rebuilding the code
- `rirq_init(bool kernalIRQ)` — initializes the system; `true` = route through kernal IRQ vector (safe, slower), `false` = install hardware vector directly
- `rirq_init_kernal()` / `rirq_init_kernal_noio()` — kernal-routed variants
- `rirq_init_crt()` / `rirq_init_crt_noio()` — cartridge-safe variants
- `rirq_init_io()` / `rirq_init_memmap()` — RAM vector variants
- `rirq_start()` — enables the raster IRQ system
- `rirq_stop()` — disables it
- `rirq_sort(bool inirq)` — re-sorts slots by scanline after moving any; call once per frame after changes; pass `true` when calling from within an interrupt
- `rirq_wait_done()` — blocks until the last slot of the current frame has fired; call before `rirq_sort`
- `rirq_wait()` — waits for the next IRQ tick
- `rirq_count` — volatile counter incremented on each raster IRQ (useful for timing)

```c
#include <c64/rasterirq.h>

RIRQCode topBar, botBar;

void setup_raster(void) {
    rirq_build(&topBar, 2);
    rirq_write(&topBar, 0, &vic.color_back,   VCOL_RED);
    rirq_write(&topBar, 1, &vic.color_border, VCOL_RED);
    rirq_set(0, 50, &topBar);

    rirq_build(&botBar, 2);
    rirq_write(&botBar, 0, &vic.color_back,   VCOL_BLACK);
    rirq_write(&botBar, 1, &vic.color_border, VCOL_BLACK);
    rirq_set(1, 150, &botBar);

    rirq_init(true);
    rirq_start();
}
```

This sets up two color splits: a red band from raster 51 to 151, and black above and below it.

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

**Pitfall — port 2 and the keyboard column drive share `$DC00`.** With the KERNAL IRQ enabled (the default), the keyboard scanner writes `$00` to `$DC00` (drives all columns active-low) while checking for any-key-pressed. If your main loop calls `joy_poll(0)` during that window, all four direction bits and the fire bit read as pressed — phantom input. See `pitfalls/input.md` for fixes (disable IRQ around the poll, or use `keyboard.h` / `getchx()` instead).

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
#include <c64/mouse.h>

mouse_init();
// in frame loop:
mouse_arm(0);
vic_waitLine(200);   // ~4ms delay
mouse_poll();
cursor_x += mouse_dx;
cursor_y += mouse_dy;
```

## kernalio.h — KERNAL file I/O wrappers

`kernalio.h` wraps the C64 KERNAL file I/O routines (SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, LOAD, SAVE) in a C-callable interface. It uses logical file numbers (0–15) as handles and returns `krnioerr` status codes.

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

```c
#include <c64/easyflash.h>

// Declare a cross-bank callable function (defined in bank 2):
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

After `mmap_set(MMAP_NO_ROM)` or `MMAP_RAM`, direct KERNAL calls via JSR to ROM addresses will crash. Use `krnio_*` wrappers (which handle the memory map) or the trampoline.

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

// Emit a short routine into a RAM buffer
byte codebuf[16];
byte * p = codebuf;
p += asm_im(p, ASM_LDA, 0x0E);          // LDA #$0E
p += asm_ab(p, ASM_STA, 0xD020);        // STA $D020
p += asm_np(p, ASM_RTS);                // RTS
// codebuf now contains a 7-byte routine that sets the border to light blue
((void (*)(void))codebuf)();             // call it
```

Use `asm6502.h` as a last resort — it bypasses all compiler optimizations and type checking. Prefer `__asm { }` inline blocks for most performance-critical code.
