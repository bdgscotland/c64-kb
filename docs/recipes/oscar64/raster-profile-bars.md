---
recipe: raster-profile-bars
toolchain: oscar64
output_format: PRG
region: both
techniques: [raster_profile_bars]
file_formats: [PRG]
uses_registers: [D011, D012, D015, D020, D021, DC04, DC05, DC0E, DD04, DD05, DD0D, DD0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 per-subsystem profiling: border bars and a CIA2 table

## Synopsis

A frame loop with four stand-in subsystems (music, input, actors, scroll),
each a calibrated busy loop of a different length, profiled two ways at
once. Each subsystem writes its own colour to `$D020` as it starts, so the
border shows a stacked bar of where the frame goes. Each is also bracketed
by CIA2 timer A, and the count goes into a table of last and worst values
that the program prints. A Python snippet reads the bars from the exit
screenshot and turns them into lines and cycles, and the page checks the
two methods against each other. Build switches `PROFILE_BARS` and
`PROFILE_CIA` remove either method. Use it as the harness to drop real
subsystems into when a frame overruns and you need to know which one did
it. The technique is `raster_profile_bars` in `techniques/raster.md`.

## Source

```c
// raster-profile-bars.c
// Per-subsystem profiling two ways at once. Each of four stand-in
// subsystems sets its own border colour when it starts, so the border
// shows a stacked bar of where the frame goes; and each is bracketed by
// CIA2 timer A, whose count goes into a table of last and worst values
// printed on screen. PROFILE_BARS and PROFILE_CIA switch either method
// off at build time (-dPROFILE_BARS=0). The subsystems are calibrated
// busy loops of different lengths; the third one spikes every 64th frame.
#include <c64/vic.h>
#include <c64/cia.h>

#ifndef PROFILE_BARS
#define PROFILE_BARS 1
#endif
#ifndef PROFILE_CIA
#define PROFILE_CIA 1
#endif

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define SYNC_LINE 56                // bars start here, inside the display
#define NSUB 4
#define SPIKE_BLOCKS 10             // extra work for ACTORS, 1 frame in 64

static const char sub_colour[NSUB] = {VCOL_RED, VCOL_YELLOW, VCOL_GREEN, VCOL_CYAN};
static const char sub_blocks[NSUB] = {6, 20, 32, 14};
static const char sub_name[NSUB][7] = {"music ", "input ", "actors", "scroll"};

// Cycle tables: the last frame, the worst frame, and the blanked calibration.
unsigned t_last[NSUB], t_max[NSUB], t_cpu[NSUB];
unsigned t_zero;                    // CIA2 count of an empty start/stop pair
char n[NSUB];                       // this frame's blocks per subsystem

// ---- the two instruments, each behind its build switch -----------------
#if PROFILE_BARS
#define BAR(c) (vic.color_border = (c))
#else
#define BAR(c)
#endif

#if PROFILE_CIA
#define T_START (cia2.cra = 0x11)            // force-load $FFFF, start, phi2
#define T_STOP  (cia2.cra = 0x00)            // stop before reading both bytes
static void t_record(char k)
{
    unsigned t = 0xffff - cia2.ta - t_zero;
    t_last[k] = t;
    if (t > t_max[k])
        t_max[k] = t;
}
#else
#define T_START
#define T_STOP
#define t_record(k)
#endif

#define PROF_BEGIN(k) do { BAR(sub_colour[k]); T_START; } while (0)
#define PROF_END(k)   do { T_STOP; t_record(k); } while (0)

// ---- a stand-in subsystem: n blocks of about 100 cycles -----------------
volatile char burn_n;
static void burn(char n)
{
    burn_n = n;
    __asm volatile
    {
        ldy burn_n
    ob: ldx #19
    ib: dex
        bne ib
        dey
        bne ob
    }
}

// ---- one frame's work: the four subsystems, each profiled ---------------
static void run_frame(void)
{
    for (char k = 0; k < NSUB; k++)
    {
        PROF_BEGIN(k);
        burn(n[k]);
        PROF_END(k);
    }
    BAR(VCOL_BLACK);
}

// ---- CIA1 timer A times run_frame whole, to price the instruments --------
__noinline static void c1_start(void) { cia1.cra = 0x00; cia1.ta = 0xffff; cia1.cra = 0x11; }
__noinline static unsigned c1_stop(void) { cia1.cra = 0x00; return 0xffff - cia1.ta; }

// ---- text -----------------------------------------------------------------
static void put_text(char row, char col, const char *s, char colour)
{
    char *p = SCREEN + 40 * row + col;
    char *q = COLOUR + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
        *q++ = colour;
    }
}

static const unsigned pow10[4] = {10000, 1000, 100, 10};

static void put_dec5(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    for (char i = 0; i < 4; i++)
    {
        char d = 0x30;
        while (v >= pow10[i]) { v -= pow10[i]; d++; }
        *p++ = d;
    }
    *p = 0x30 + (char)v;
}

int main(void)
{
    __asm { sei }                   // no KERNAL IRQ: nothing lands inside a bracket
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;
    vic.spr_enable = 0;

    cia2.icr = 0x7f;                // no NMI from CIA2
    cia2.cra = 0x00;
    cia2.ta = 0xffff;               // the latch every T_START reloads

    // Calibration with the display blanked: no badlines, so these are the
    // subsystems' own CPU cycles. DEN is sampled once a frame, so wait one.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    vic_waitFrame();
#if PROFILE_CIA
    T_START; T_STOP;
    t_zero = 0xffff - cia2.ta;      // the bracket's own count, subtracted
    for (char k = 0; k < NSUB; k++)
    {
        T_START; burn(sub_blocks[k]); T_STOP;
        t_cpu[k] = 0xffff - cia2.ta - t_zero;
    }
#endif
    // The whole frame's work, blanked, timed with CIA1: build with the
    // switches on and off and the difference is what profiling costs.
    for (char k = 0; k < NSUB; k++)
        n[k] = sub_blocks[k];
    c1_start(); unsigned c1_zero = c1_stop();
    c1_start(); run_frame(); unsigned frame_cpu = c1_stop() - c1_zero;
    for (char k = 0; k < NSUB; k++)
        t_max[k] = 0;               // forget the blanked run
    vic.color_border = VCOL_BLACK;
    vic.ctrl1 |= VIC_CTRL1_DEN;

    put_text(0, 0, "raster profile bars", VCOL_WHITE);
    put_text(2, 0, "sub      cpu  last   max", VCOL_WHITE);
    for (char k = 0; k < NSUB; k++)
    {
        put_text(3 + k, 0, sub_name[k], sub_colour[k]);
        put_dec5(3 + k, 7, t_cpu[k]);
    }
    put_text(8, 0, "frame cpu", VCOL_WHITE);
    put_dec5(8, 13, frame_cpu);
    put_text(9, 0, "cia zero", VCOL_WHITE);
    put_dec5(9, 13, t_zero);
    put_text(10, 0, "frames", VCOL_WHITE);

    unsigned frames = 0;
    for (;;)
    {
        for (char k = 0; k < NSUB; k++)
            n[k] = sub_blocks[k];
        if ((frames & 63) == 0)
            n[2] += SPIKE_BLOCKS;   // the worst frame: ACTORS spikes

        vic_waitLine(SYNC_LINE);
        run_frame();

        for (char k = 0; k < NSUB; k++)
        {
            put_dec5(3 + k, 13, t_last[k]);
            put_dec5(3 + k, 19, t_max[k]);
        }
        frames++;
        put_dec5(10, 13, frames);
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=raster-profile-bars.prg raster-profile-bars.c
oscar64 -tm=c64 -O2 -dPROFILE_BARS=0 -dPROFILE_CIA=0 -o=raster-profile-bars-off.prg raster-profile-bars.c
```

Built with Oscar64 (build 2026-05-19). The PRG is 1,251 bytes with both
switches on, 1,111 with bars only, 1,243 with the CIA table only and
1,082 with both off. The `.map` file Oscar64 writes beside the PRG gives
the table addresses for the monitor dump below: in this build `t_last` is
at `$0CF1` and `t_max` at `$0D00`, two bytes per subsystem, low byte first.

## Expected output

Black screen, white text. Row 0 reads `RASTER PROFILE BARS`. Rows 3 to 6
hold one subsystem each, its name in its bar colour (music red, input
yellow, actors green, scroll cyan), then three five-digit decimal columns:
`CPU` (the subsystem timed once at start-up with the display blanked),
`LAST` (this frame, timed in the display) and `MAX` (the worst frame so
far). Below: `FRAME CPU`, the whole frame's work timed with CIA1 while
blanked; `CIA ZERO`, the count of an empty start/stop pair; `FRAMES`. The
left and right borders show four coloured bands stacked from raster line
57 down, then black.

Measured in VICE x64sc 3.10 (rung 1) from the exit screenshot of the
pinned run, text decoded against `chargen-901225-01.bin` and the border
read down PNG column x = 2:

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 [-model ntsc] -exitscreenshot out.png -autostart raster-profile-bars.prg
```

| | CPU | PAL LAST | PAL MAX | NTSC LAST | NTSC MAX |
|---|---|---|---|---|---|
| music | 629 | 715 | 715 | 672 | 672 |
| input | 2,043 | 2,215 | 2,215 | 2,215 | 2,215 |
| actors | 3,255 | 3,556 | 4,695 | 3,556 | 4,652 |
| scroll | 1,437 | 1,566 | 1,566 | 1,566 | 1,566 |

`FRAME CPU 07841`, `CIA ZERO 00005` on both models; `FRAMES 00249` on PAL
(`screenshots/raster-profile-bars.png`), `00275` on NTSC
(`screenshots/raster-profile-bars-ntsc.png`).

The bars, from the snippet below:

| | PAL lines | lines | × 63 | NTSC lines | lines | × 65 |
|---|---|---|---|---|---|---|
| music | 57 to 69 | 13 | 819 | 57 to 68 | 12 | 780 |
| input | 70 to 106 | 37 | 2,331 | 69 to 104 | 36 | 2,340 |
| actors | 107 to 164 | 58 | 3,654 | 105 to 160 | 56 | 3,640 |
| scroll | 165 to 191 | 27 | 1,701 | 161 to 186 | 26 | 1,690 |

**The check.** A bar spans from one subsystem's `$D020` store to the
next, so it holds the subsystem plus the profiling code around it, which
the switch builds put at 117 cycles per subsystem (467 per frame, below).
Bar cycles less `LAST` came to 104, 116, 98 and 135 on PAL and 108, 125,
84 and 124 on NTSC: each within one line (63 or 65 cycles) of 117, which
is the quantisation of a bar read at one pixel column. The two methods
agree.

**The badline tax.** `LAST` less `CPU` is 86, 172, 301 and 129 on PAL:
2, 4, 7 and 3 times 43. A monitor trace on the `$DD0E` stores put the
four timer windows on lines 56 to 68, 69 to 104, 106 to 162 and 165 to
190, which hold exactly 2, 4, 7 and 3 badlines (every eighth line from
51 with the default YSCROLL of 3). A bar can touch one more than its
window: the actors bar reaches line 164, but its timer stopped on line
162, before line 163's fetch. On NTSC the windows are 56 to 66, 69 to
103, 104 to 159 and 160 to 185, holding 1, 4, 7 and 3 badlines, and
music's 672 is 629 + 43. The actors spike (10 more blocks every 64th
frame) is 4,695 on PAL: 3,556 + 1,010 for the blocks + 3 × 43 for the
badlines the longer run reaches; 4,652 on NTSC with two. 43 rather than
40: the busy loop only reads, so it also stalls for the three cycles BA
is low before the fetch.

**The cost of profiling.** `FRAME CPU` per build, all blanked, so no
badline enters it: 7,374 with both switches off, 7,416 with bars only
(+42 for five `$D020` stores), 7,818 with the CIA table only (+444) and
7,841 with both (+467). The start-up run updates every `MAX` entry, the
most expensive path, so 467 is the worst frame for four subsystems. A
frame with no new maximum skips four of those stores, about 60 cycles
less (arithmetic from the listing; not measured). PAL and NTSC agree to
the cycle on every blanked figure.

**The table without the screen.** A tracepoint on the store of scroll's
`LAST` high byte dumps the table every frame into a log, and the last
dump is the exit state:

```text
logname "/tmp/prof.log"
log on
trace store 0cf8
command 1 "m 0cf1 0d08"
```

Run with `-moncommands prof.mon` added to the pinned command, the log's
last dump read `cb 02 a7 08 e4 0d 1e 06` for `t_last` (715, 2,215,
3,556, 1,566, low byte first) and `cb 02 a7 08 57 12 1e 06` for `t_max`,
the same as the screen, and the screenshot was byte-identical to the run
without the monitor. The trace fired on raster line 190, the end of the
scroll bar. The log holds the PETSCII column of each dump, so `grep`
needs `-a` to treat it as text. The addresses are this build's; take
them from the `.map` after any change.

Reading the bars from the PNG:

```python
# read_bars.py: border bars from a VICE exit screenshot -> lines and cycles
import sys
from PIL import Image

MODELS = {  # PNG height: (name, row-to-line offset, lines per frame, cycles per line, colours)
    272: ('PAL', 16, 312, 63, {(175, 60, 88): 'music', (255, 255, 70): 'input',
                               (98, 213, 50): 'actors', (126, 243, 214): 'scroll'}),
    247: ('NTSC', 28, 263, 65, {(169, 71, 100): 'music', (255, 248, 141): 'input',
                                (114, 189, 103): 'actors', (138, 230, 203): 'scroll'}),
}

im = Image.open(sys.argv[1]).convert('RGB')
px = im.load()
name, offset, frame_lines, cpl, colours = MODELS[im.size[1]]
runs = []                                   # [subsystem, first line, last line]
for row in range(im.size[1]):
    line = (row + offset) % frame_lines     # NTSC rows 235 to 246 are lines 0 to 11
    sub = colours.get(px[2, row])           # x = 2: left border
    if runs and runs[-1][0] == sub and runs[-1][2] == line - 1:
        runs[-1][2] = line
    else:
        runs.append([sub, line, line])
for sub, first, last in runs:
    if sub:
        n = last - first + 1
        print(f'{name} {sub:7s} lines {first:3d}-{last:3d}  {n:3d} lines  {n * cpl:5d} cycles')
```

The colour triples are VICE 3.10's `-default` palette entries 2, 7, 5 and 3
per model (`runtime/vice-reference.md`, "The default palette"). The line
count times 63 or 65 is wall time, not CPU time; see the badline tax above.

## Why this works

The border is drawn from whatever `$D020` holds at the moment the beam
passes, so a store at the start of each subsystem cuts the border into
bands whose heights are the subsystems' durations in raster lines. That is
wall time: a line is 63 cycles on PAL and 65 on the 6567R8 whether the CPU
ran for all of them or the VIC-II took 40 to 43 for a badline. The same
code costs more lines in the display than in the border, which is what
`LAST` against `CPU` shows. A change smaller than one line (63 or 65
cycles) may not move a band's edge at all; that needs the timer.

CIA2 timer A counts every phi2 cycle, stolen or not, so it measures the
same wall time as the bar, to the cycle instead of the line. Timer A of
CIA2 is free while RS-232 is not in use (`hardware/cia-reference.md`), and
its interrupt is masked here, so it raises no NMI. The latch is loaded with
`$FFFF` once; `cra = $11` force-loads it and starts counting, and
`cra = $00` stops it before the two bytes are read, so the read cannot
straddle a borrow. `CIA ZERO` is what an empty start/stop pair counts, 5,
and is subtracted from every figure. `CPU` is the same bracket run once
with the display blanked (DEN cleared and two frames waited, because the
VIC-II samples DEN once a frame), so no badline lands in it; it is what
the subsystem would cost in the border.

The program runs `SEI` first: an interrupt that lands inside a bracket is
counted as that subsystem's time and stretches its band. A game with a
raster IRQ chain sees exactly that, and should either accept it or read
`MAX` knowing an interrupt may be in it. `vic_waitLine(56)` starts the
bars in the display on purpose, so the badline tax is visible. Bars
that fall in lines 288-311 or 0-15 (PAL) are not in the exit screenshot;
move the sync line or rely on the table.

`PROFILE_BARS` and `PROFILE_CIA` are macros that compile to nothing when
set to 0, so the release build carries neither. The CIA macros are
object-like (`T_START;`) because Oscar64 (build 2026-05-19) does not
accept a function-like macro with an empty parameter list:
`#define A() (x = 1)` followed by `A();` fails with `error 3006: ';'
expected`.
