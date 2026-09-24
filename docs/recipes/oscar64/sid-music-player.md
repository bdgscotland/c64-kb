---
recipe: sid-music-player
toolchain: oscar64
output_format: PRG
region: both
techniques: [sid_voice_setup, sid_play_routine_pattern, sid_filter_routing]
file_formats: [PRG]
uses_registers: [D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 SID Music Player

## Synopsis

Drives a precompiled SID tune's init and play subroutines from Oscar64 C using
`rasterirq.h`. The SID binary is embedded into the PRG at compile time with
`#embed`, placed at a fixed address, and called by literal address: init
from a two-line `__asm` block, play through `rirq_call` with
`(void *)0x1003`. (An earlier version said "two extern function pointers";
a call through a const function pointer crashes the compiler, see below.)
A raster IRQ calls the play routine once a frame, on line 255,
so the play rate stays at 50/60 Hz whatever the main loop costs. A second
voice uses the `sid_voice_setup` and `sid_filter_routing` techniques for a
sound effect beside the tune. This is the Oscar64 pattern for playing SID
files from HVSC or GoatTracker.

## Source

```c
// sid-music-player.c
//
// Drives a SID tune's init+play convention from Oscar64 C.
// The tune binary is embedded at compile time and placed at $1000.
// A raster IRQ calls the play routine once per frame.
// A second SID voice demonstrates sid_voice_setup and sid_filter_routing.
//
// SID tune format assumed: PSID (not RSID).
// init entry: $1000, A = song index (0 = first subtune)
// play entry: $1003
//
// To use a different SID file, replace "mytune.bin" with the raw SID data
// starting at the load address (strip the PSID header first: 124 bytes for
// v2, 118 for v1; the big-endian word at $06-$07 gives the exact length).
// Header words (big-endian): $08-$09 load_address, $0A-$0B init, $0C-$0D play.
// If load_address is 0 the body's first two bytes (little-endian) hold it:
// strip those two as well.
//
#include <c64/vic.h>
#include <c64/sid.h>
#include <c64/rasterirq.h>
#include <c64/memmap.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Memory layout
// ---------------------------------------------------------------------------
// Keep main code below $1000 so the SID tune fits at $1000.
#pragma region( lower, 0x0a00, 0x1000, , , {code, data} )

// Reserve $1000-$2000 for the embedded SID tune binary.
#pragma section( sidtune, 0 )
#pragma region( sidtune, 0x1000, 0x2000, , , {sidtune} )

// All other code, data, bss, heap, stack go above $2000.
#pragma region( main, 0x2000, 0xa000, , , {code, data, bss, heap, stack} )

// ---------------------------------------------------------------------------
// Embedded SID tune
// ---------------------------------------------------------------------------
// #embed imports the raw tune body (no PSID header) into a section placed at
// $1000 by the linker region above.  The file must be the raw 6502 binary
// starting at the tune's load address, NOT the full .sid file with its header.
//
// For testing without a real SID file, the stub below replaces the embed.
// Uncomment the #embed line and remove the stub array when you have a tune.
//
// Real use:
//   #pragma data(sidtune)
//   __export const char sid_binary[] = { #embed "mytune.bin" };
//   #pragma data(data)
//
// Stub tune: init at $1000 (RTS), play at $1003 (RTS).
// This lets the recipe compile and run silently while you supply a real tune.
// __export keeps the array in the build: nothing in C refers to it (the
// calls are by address), and without __export the linker drops it, the
// sidtune section ends up empty, and JSR $1000 executes zero bytes: BRK.
#pragma data(sidtune)
__export const char sid_binary[] = {
    0x60,               // $1000: RTS  (init stub)
    0x00, 0x00,         // $1001-$1002: padding
    0x60,               // $1003: RTS  (play stub)
    0x00                // $1004: padding
};
#pragma data(data)

// ---------------------------------------------------------------------------
// The tune's entry points
// ---------------------------------------------------------------------------
// The linker places sid_binary at $1000: init at $1000, play at $1003.
// They are called by address. Do NOT write them as
//     static void (* const tune_play)(void) = (void (*)(void))0x1003;
// and call through it: Oscar64 (build 2026-05-19) crashes with a
// segmentation fault compiling a call through a const function pointer
// initialised with a literal address. Inline assembly for init, and the
// raw address for rirq_call, work.
#define TUNE_INIT  0x1000
#define TUNE_PLAY  0x1003

static void tune_init(void)
{
    __asm {
        lda #0          // subtune 0
        jsr TUNE_INIT
    }
}

// ---------------------------------------------------------------------------
// Raster IRQ: call the play routine once per frame (rirq_set row 0 runs on line 255)
// ---------------------------------------------------------------------------
// rirq_call installs a JSR to a C function inside an RIRQCode slot.
// This is the canonical way to call a SID play routine from the raster engine:
// the call is data-driven (no inline IRQ handler to write), and composes
// with other rirq slots. rasterirq.h polls $D012, so the entry cycle varies.
RIRQCode play_rirq;

// ---------------------------------------------------------------------------
// Filter sweep state
// ---------------------------------------------------------------------------
// Demonstrates sid_filter_routing: voice 2 plays a short descending tone
// while the filter sweeps from open to closed, then voice 2 is released.
static byte  fx_active  = 0;
static byte  fx_timer   = 0;
static word  fx_cutoff  = 2000;   // 11-bit cutoff, starts open

#define FX_DURATION  40           // frames the tone lasts

// Trigger a filter-routed sound effect on voice 2.
static void fx_trigger(void)
{
    // Voice 2 setup: sawtooth, short attack, low sustain
    sid.voices[1].freq   = SID_FREQ_PAL(880);   // A5, one octave above A4
    sid.voices[1].pwm    = 0x0800;
    sid.voices[1].attdec = SID_ATK_2 | SID_DKY_24;
    sid.voices[1].susrel = (4 << 4) | SID_DKY_300;
    sid.voices[1].ctrl   = SID_CTRL_SAW | SID_CTRL_GATE;

    // Route voice 2 through the filter; low-pass mode, full resonance
    sid.resfilt  = (15 << 4) | SID_FILTER_2;
    sid.fmodevol = SID_FMODE_LP | 15;

    // Open the filter cutoff so the note starts bright
    fx_cutoff  = 2000;
    sid.ffreq  = (word)((fx_cutoff & 7) | ((fx_cutoff >> 3) << 8));

    fx_timer   = FX_DURATION;
    fx_active  = 1;
}

// Update the filter sweep each frame.  Called from the main loop.
static void fx_update(void)
{
    if (!fx_active)
        return;

    // Close the filter by 50 units per frame (descending sweep)
    if (fx_cutoff > 50)
        fx_cutoff -= 50;
    else
        fx_cutoff = 0;

    // Write new cutoff to $D415/$D416 through the 16-bit ffreq field.
    // ffreq low byte = D415 (bits 2-0 of cutoff), high byte = D416 (bits 10-3).
    // Oscar64 emits this as two 8-bit stores, $D415 first.
    sid.ffreq = (word)((fx_cutoff & 7) | ((fx_cutoff >> 3) << 8));

    fx_timer--;
    if (!fx_timer)
    {
        // Release voice 2 and disable filter routing
        sid.voices[1].ctrl  = SID_CTRL_SAW;          // gate off
        sid.resfilt         = 0;                      // no voices filtered
        sid.fmodevol        = 15;                     // LP off, volume maintained
        fx_active           = 0;
    }
}

// ---------------------------------------------------------------------------
// HUD: display a minimal status line on the top screen row
// ---------------------------------------------------------------------------
static byte * const Screen = (byte *)0x0400;
static byte * const Color  = (byte *)0xd800;

static void hud_init(void)
{
    // Fill screen row 0 with a simple "SID PLAYER" label in screen codes
    static const char label[] = {
        // S   I   D   spc P   L   A   Y   E   R
        19, 9, 4, 32, 16, 12, 1, 25, 5, 18,
        32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
        32, 32, 32, 32, 32, 32, 32, 32, 32, 32,
        32, 32, 32, 32, 32, 32, 32, 32, 32, 32
    };
    for (char i = 0; i < 40; i++)
    {
        Screen[i] = label[i];
        Color[i]  = VCOL_CYAN;
    }
    // Clear remaining rows
    for (int i = 40; i < 1000; i++)
        Screen[i] = 32;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main(void)
{
    // Free up BASIC ROM so code can use the full lower 38 KB.
    // mmap_trampoline keeps the KERNAL IRQ chain working.
    mmap_trampoline();
    mmap_set(MMAP_NO_BASIC);

    // Silence SID completely before init (good practice; avoids pops).
    for (char r = 0; r < 25; r++)
        ((volatile byte *)0xd400)[r] = 0;
    sid.fmodevol = 15;    // master volume 15, filter off

    vic.color_border = VCOL_BLACK;
    vic.color_back   = VCOL_BLACK;
    for (int i = 0; i < 1000; i++)
        Color[i] = VCOL_WHITE;

    // After the white fill, so row 0 keeps the cyan hud_init gives it.
    hud_init();

    // --- Initialize the raster IRQ system ---
    // rirq_call installs a JSR to tune_play in slot 0, row 0. The engine
    // arms $D012 at row - 1, which wraps to 255: play runs on line 255.
    rirq_init(true);
    rirq_build(&play_rirq, 1);
    rirq_call(&play_rirq, 0, (void *)TUNE_PLAY);
    rirq_set(0, 0, &play_rirq);
    rirq_sort();
    rirq_start();

    // --- Initialize the SID tune (song index 0) ---
    // The init routine resets all SID registers and sets up player state.
    // Call AFTER rirq_start so the play routine is already armed.
    tune_init();

    // --- Main loop ---
    // All audio work happens in the raster IRQ.  The main loop handles
    // the filter effect and any other non-audio work.
    char fx_delay = 90;   // wait ~1.8 s before first effect trigger

    for (;;)
    {
        // Wait for all raster IRQs this frame to complete, then do
        // per-frame work during the vertical blank window.
        rirq_wait();

        // Trigger the filter effect every ~3 seconds
        if (fx_delay)
        {
            fx_delay--;
        }
        else
        {
            if (!fx_active)
            {
                fx_trigger();
                fx_delay = 150;   // 3 s at 50 Hz
            }
        }

        fx_update();
    }

    return 0;
}
```

## Build

```bash
oscar64 -O2 -o=sid-music-player.prg -tf=prg sid-music-player.c
```

Outputs: `sid-music-player.prg`, `.map`, `.asm`, `.lbl`.

To use a real SID tune: strip the PSID header from the `.sid` file (124 bytes
for a v2 header, 118 for v1; the big-endian word at `$06-$07` is the exact
length), confirm the load address is `$1000` (edit the linker region
otherwise), replace the stub `sid_binary` array with the `#embed` line shown
in the source comments, and verify `TUNE_INIT`/`TUNE_PLAY` point to the correct
offsets. The PSID header words `$08-$09` (load address), `$0A-$0B` (init
address) and `$0C-$0D` (play address), all big-endian, are the authoritative
source; if the load-address word is zero, the body's first two bytes hold it
little-endian and must be stripped too. An earlier version of this recipe
gave the init and play words as `$08-$09` and `$0A-$0B`, one word too early.

Load and run: `LOAD"SID-MUSIC-PLAYER",8,1` then `RUN`, or pass
`-autostart sid-music-player.prg` to VICE.

## Expected output

The screen displays `SID PLAYER` in cyan on a black background with a black
border. (An earlier version of the
listing called `hud_init()` before the loop that fills colour RAM with white,
so the label came out white while this section said cyan; measured on the
VICE screenshot, row 0 held 216 white pixels. `hud_init()` now runs after the
fill and the same 216 pixels are cyan.)

Verified with Oscar64 (build 2026-05-19) and VICE x64sc. Two things kept the
earlier version of this recipe from getting that far: the compiler crashed
on its function-pointer calls (see below), and once that was worked around
the linker had discarded the unreferenced stub array, so `JSR $1000`
executed zeros (a `BRK`) and the machine dropped to BASIC's warm start
with a cleared screen. `__export` on the array is the fix; the `.map` file
shows the `sidtune` section at five bytes instead of zero.

With the stub tune the only sound is the effect. Measured from VICE's SID
register dump (`-sounddev dump`, PAL, 12,000,000 cycles): about 90 frames
after start-up voice 2 is gated on with sawtooth (`$D40B` = `$21`) at
frequency `$3A89` (A5, 880 Hz on PAL; the same value is 913 Hz on NTSC,
3.8% sharp, from `sid.h`'s clocks 985,248 and 1,022,727 Hz: arithmetic, and
`SID_FREQ_NTSC(880)` is the NTSC value), `$D417` = `$F2` (resonance 15, voice 2
filtered) and `$D418` = `$1F` (low-pass, volume 15); the cutoff falls each
frame, and 39 frames later the gate drops (`$D40B` = `$20`), `$D417` = 0 and
`$D418` = `$0F`. The trigger repeats every 151 frames, 3.01 s on PAL and
2.52 s on NTSC. (An earlier version said the stub produced no audio.)

With a real PSID tune embedded at `$1000` the tune plays at 50 Hz (PAL) or
60 Hz (NTSC) as well; that case has not been run here. The effect writes
voice 2, `$D417` and `$D418`, so it only leaves the tune intact if the tune
leaves voice 2 free, which is what this recipe assumes (see
`sid_filter_routing` below). A tune that writes `$D417` or `$D418` while
the effect is active overrides it until the next trigger. An earlier
version said a typical three-voice play routine "only writes voices 1
and 3" and that `$D417`/`$D418` were reserved for the effect; a three-voice
tune writes all three voices, and nothing reserves those registers.

## Why this works

### The PSID init+play contract

Every SID tune produced by GoatTracker, SidFactory II, defMON, or similar
trackers exposes exactly two entry points. The `init` subroutine accepts the
subtune index in the accumulator, zeroes all SID registers, and configures the
player's internal sequencer state. The `play` subroutine advances the sequencer
by one tick (one frame at 50/60 Hz) and writes the resulting frequency, waveform,
envelope, and filter register values to `$D400-$D418`. The contract is documented
in the PSID v2 specification: the big-endian words at `$0A-$0B` of the header
hold the init address and `$0C-$0D` the play address (`$08-$09` is the load
address; this paragraph used to place init and play one word earlier). Most
players save and restore all CPU registers on entry and exit so
that `play` is safe to call from any context.

The recipe strips the PSID header (124 bytes for v2, 118 for v1; the data
offset word at `$06-$07` says which) and embeds only the raw 6502 binary
body, which starts at the tune's load address. By placing the `sidtune` section
at `$1000` via the linker region pragma, the embedded bytes land at
`$1000`, so `TUNE_INIT` is `$1000` and `TUNE_PLAY` is `$1003`. This is the
conventional distance between init and play for single-subtune PSID files;
multi-subtune or non-standard tunes may have different offsets, so read
the header.

The calls are by literal address: `rirq_call` takes a `void *` and gets
`(void *)TUNE_PLAY`; init is a two-line `__asm` block. The earlier version of
this recipe declared `static void (* const tune_play)(void) = (void
(*)(void))0x1003;` and called through it, which is idiomatic C and makes the
Oscar64 compiler (build 2026-05-19) segfault before it emits anything; the
minimal reproduction is a one-line `main` that calls such a pointer. Casting
the pointer to `void *` without calling it compiles, so the `rirq_call` form
was never the problem.

### `rirq_call` and the per-frame play cadence

`rirq_call(&play_rirq, 0, addr)` encodes a JSR to `addr` inside an `RIRQCode`
slot. When the raster IRQ for the slot is taken, the raster engine executes the JSR,
the play routine runs, and execution returns to the engine's exit path. It calls
a subroutine from the raster system without a
custom `__hwinterrupt` handler. The slot fires on the same raster line every
frame, so play runs once per frame, below the display window; the entry
cycle varies by a few cycles, because `rasterirq.h` spins on `$D012` and
is not cycle-exact (`stable-raster-irq.md`, "What stable means here").
An earlier version called this a "stable-raster guarantee" and a "fixed
cycle offset". Music tempo is therefore independent of main-loop duration: even if the main loop
takes 30,000 cycles one frame and 2,000 the next, the play routine fires in
the same window of each frame.

`play` is called on line 255. Measured with a VICE monitor tracepoint on
`$1003`, PAL and NTSC: every call starts on line 255, between cycles 32
and 38. `rirq_set(0, 0, ...)` asks for row 0, but the engine arms `$D012`
at row - 1, which wraps to 255, and its check that the row has been reached
(`$D012` above the row) is already true there, so the "one below" rule of
`stable-raster-irq.md` does not apply to row 0. (An earlier version said
play ran at line 0, in the top border.) Any fixed line gives one call per
frame; line 255 is below the display window, which spans lines 51 to 250
on PAL and NTSC alike (see `hardware/pal-ntsc-reference`; an earlier
version put the NTSC start "around line 41", where NTSC's vertical blank
ends), away from any raster work on the visible screen. (An earlier version said line 0 was
needed because `$D418` "must not change during active rendering"; no source
was given, and the SID's registers have no link to the raster.)

### PAL vs NTSC frame-rate difference

The play routine is designed to be called at a fixed rate; 50 Hz on PAL, 60 Hz
on NTSC. SID tunes authored for 50 Hz tempo play about 20 percent faster
on NTSC because the frame arrives 10 Hz more often. The PSID header's speed
flags, four bytes at `$12-$15` with one bit per song (an earlier version said
"byte `$12`"), record whether a tune is CIA-timer-driven (its own timer, immune
to this) or VBI-driven (frame-rate-dependent). Most GoatTracker tunes are
VBI-driven and therefore play faster on NTSC. A
cross-region product should detect the machine at startup (the
`pal-ntsc-detect` recipe watches one frame's RST8 band and keeps the highest
`$D012` value seen; an earlier version said to read `$D011` across two known
raster lines, a method no page here specifies or measures) and use a CIA timer IRQ for the
play call on NTSC at the PAL equivalent period. For a demo or game that targets
one region, accept the tempo difference or compose for NTSC.

### `#embed` for binary assets

Oscar64's `#embed` directive includes a raw binary file as an array initializer:

```c
const char sid_binary[] = { #embed "mytune.bin" };
```

With the section and region pragmas, this puts
binary data at a fixed address in a PRG without a separate assembler stub
or a runtime file-load. The full workflow: strip the PSID header with a hex
editor or `tail -c +125 tune.sid > tune.bin` for a 124-byte v2 header
(check the data-offset word at `$06-$07` first; an earlier version named a
`sidstripe` utility that could not be found), confirm the stripped file starts at the
correct load address, embed it, rebuild. No makefile changes; no extra linker
scripts.

### `sid_filter_routing` — voice 2 SID effect

The filter effect runs `sid_filter_routing` on top of an active tune.
An effect beside a play routine has to know which registers the
play routine owns. A standard three-voice tune occupies voices 1, 2, and 3
(`$D400-$D414`) and the master volume nibble of `$D418`. If the play routine
is GoatTracker-generated and uses all three voices, adding a fourth sound
requires either silencing one tune voice or using the play routine's effect
voice. The recipe assumes a two-voice tune leaving voice 2 free. The `$D417`
filter-routing register is written by both the tune and the effect. As
listed, the effect writes `$D417` once at trigger and once at release (an
earlier version of this paragraph said "every frame while active", which the
code never did), so a tune that writes `$D417` during the 40-frame window
wins until the next trigger. Most play routines only write
`$D417` on note-change frames, not on every frame, so the filter effect is
stable for the duration of a held note (not measured here).

The `sid.ffreq` write packs both `$D415` (low 3 bits of cutoff, in the low
byte of the 16-bit value) and `$D416` (high 8 bits of cutoff, in the high
byte): `(cutoff & 7) | ((cutoff >> 3) << 8)`. Oscar64's SID struct declares
`ffreq` as `volatile unsigned`; the 6502 has no 16-bit store, so the
assignment compiles to two 8-bit stores, and with build 2026-05-19 at `-O2`
the low byte goes to `$D415` first, then the high byte to `$D416` (read from
the generated `.asm`). An earlier version of this recipe had the bytes the
other way round in both the listing and this paragraph: the expression was
`(cutoff >> 3) | ((cutoff & 7) << 13)`, which compiled to `STA $D415` of the
eight high cutoff bits (where bits 7-3 are ignored) and `STA $D416` of the
low three bits shifted up, so the "open" cutoff of 2000 set the
filter to 2 and the sweep never moved it. `techniques/music-sid` records the
same correction for its own example.
