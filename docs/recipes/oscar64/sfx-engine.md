---
recipe: sfx-engine
toolchain: oscar64
output_format: PRG
region: both
techniques: [sfx_engine_beside_music]
file_formats: [PRG]
uses_registers: [D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D418, DC04, DC05, DC0E]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 sound-effect engine beside a three-voice tune

## Synopsis

A table-driven sound-effect engine that borrows SID voice 2 from a music
play routine and hands it back when the effect ends. The "tune" is a stub
that writes every register of all three voices and `$D418` on every frame,
which is what a real player does, so the engine has to run after the play
call and re-poke the voice each frame while an effect owns it. Two effects
with different priorities are fired from a scripted cue list so that every
case is exercised: a free voice, a higher-priority effect cutting a lower
one, a lower-priority request refused, and an equal-priority restart. The
screen shows the counters, a checksum over every byte the engine wrote to
`$D408-$D40B` matched against a Python model, and the cost per call of the
tune and the engine from CIA1 timer A. The technique is
`sfx_engine_beside_music` in `techniques/music-sid.md`. Nobody on this
machine has listened to the result; the verification is register-level.

## Source

```c
// sfx-engine.c
// A table-driven sound-effect engine running beside a music play routine.
// The "tune" is a stub that writes all three voices and $D418 every frame,
// like a real player would. Effects borrow voice 2 ($D407-$D40D): the engine
// runs AFTER the play call each frame and re-pokes the voice while an effect
// owns it; when the effect's table hits its terminator the engine stops
// writing and the tune's own values stand again from the next frame.
// A priority byte per effect decides what happens when two collide.
// Counters on screen: effects started, effects refused, frames borrowed,
// a checksum over every byte the engine wrote to $D408-$D40B, and the cost
// per frame of the tune and of the engine, from CIA1 timer A.
// Nobody has listened to this; the check is register-level.
#include <c64/vic.h>
#include <c64/sid.h>
#include <c64/cia.h>

#define SCREEN      ((char *)0x0400)
#define SFX_REGS    ((volatile char *)0xd407)   // voice 2: freq lo/hi, pw lo/hi, ctrl, AD, SR
#define EXPECT_CHK  0xF2B4                       // from the Python model of the same tables and cues

// ---- effect tables ---------------------------------------------------------
// One row per frame: frequency, pulse width, control byte. ADSR is per effect,
// written when it starts (and re-poked each frame, because the tune writes
// AD/SR too). The row with ctrl == SFX_END ends the effect and frees the voice.
struct SfxFrame { unsigned freq; unsigned pw; char ctrl; };
#define SFX_END 0xff

struct Sfx { char prio; char attdec; char susrel; const struct SfxFrame *frames; };

// Laser: pulse wave, pitch falling over 8 frames. First row is the TEST+GATE
// ($09) frame of the classic hard restart in sid-reference, so the attack
// starts from a reset oscillator; the row after it is the real waveform
// with GATE. Last row drops GATE.
static const struct SfxFrame laser_frames[] = {
    { 0x3800, 0x0800, SID_CTRL_TEST | SID_CTRL_GATE },
    { 0x3400, 0x0800, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x2e00, 0x0880, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x2600, 0x0900, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x1e00, 0x0980, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x1600, 0x0a00, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x1000, 0x0a80, SID_CTRL_RECT | SID_CTRL_GATE },
    { 0x0c00, 0x0b00, SID_CTRL_RECT },
    { 0x0000, 0x0000, SFX_END }
};

// Explosion: noise, 24 frames, pitch falling, gate released for the tail.
static const struct SfxFrame boom_frames[] = {
    { 0x2000, 0x0000, SID_CTRL_TEST | SID_CTRL_GATE },
    { 0x1e00, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1c00, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1a00, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1800, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1600, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1400, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1200, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x1000, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x0e00, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x0c00, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x0a00, 0x0000, SID_CTRL_NOISE | SID_CTRL_GATE },
    { 0x0900, 0x0000, SID_CTRL_NOISE },
    { 0x0800, 0x0000, SID_CTRL_NOISE },
    { 0x0700, 0x0000, SID_CTRL_NOISE },
    { 0x0600, 0x0000, SID_CTRL_NOISE },
    { 0x0500, 0x0000, SID_CTRL_NOISE },
    { 0x0480, 0x0000, SID_CTRL_NOISE },
    { 0x0400, 0x0000, SID_CTRL_NOISE },
    { 0x0380, 0x0000, SID_CTRL_NOISE },
    { 0x0300, 0x0000, SID_CTRL_NOISE },
    { 0x0280, 0x0000, SID_CTRL_NOISE },
    { 0x0200, 0x0000, SID_CTRL_NOISE },
    { 0x0180, 0x0000, SID_CTRL_NOISE },
    { 0x0000, 0x0000, SFX_END }
};

static const struct Sfx laser = { 1, SID_ATK_2 | SID_DKY_48,  0xa0 | SID_DKY_204, laser_frames };
static const struct Sfx boom  = { 3, SID_ATK_2 | SID_DKY_114, 0xf0 | SID_DKY_750, boom_frames  };

// ---- effect engine ---------------------------------------------------------
static const struct Sfx      *sfx_cur;   // effect that owns voice 2, or 0
static const struct SfxFrame *sfx_pos;
static unsigned sfx_started, sfx_refused, sfx_borrowed, sfx_chk;
static char     sfx_last[4];             // last $D408-$D40B bytes written
static bool     sfx_wrote;

static unsigned fold(unsigned chk, char value)
{
    return (chk ^ value) * 5 + 1;
}

// Start an effect. A running effect of higher priority keeps the voice;
// equal or lower priority is cut and the new effect starts from its first row.
static bool sfx_play(const struct Sfx *fx)
{
    if (sfx_cur && fx->prio < sfx_cur->prio)
    {
        sfx_refused++;
        return false;
    }
    sfx_cur = fx;
    sfx_pos = fx->frames;
    sfx_started++;
    return true;
}

// Call once per frame, after the tune's play routine.
static void sfx_update(void)
{
    if (!sfx_cur)
        return;
    if (sfx_pos->ctrl == SFX_END)
    {
        sfx_cur = nullptr;              // hand the voice back: no more writes
        return;
    }
    SFX_REGS[5] = sfx_cur->attdec;      // $D40C, re-poked: the tune wrote it
    SFX_REGS[6] = sfx_cur->susrel;      // $D40D
    SFX_REGS[0] = (char)sfx_pos->freq;  // $D407
    SFX_REGS[1] = sfx_pos->freq >> 8;   // $D408  } these four bytes are
    SFX_REGS[2] = (char)sfx_pos->pw;    // $D409  } folded into the
    SFX_REGS[3] = sfx_pos->pw >> 8;     // $D40A  } checksum, in this
    SFX_REGS[4] = sfx_pos->ctrl;        // $D40B  } order
    sfx_last[0] = sfx_pos->freq >> 8;   // copy for the checksum, folded by
    sfx_last[1] = (char)sfx_pos->pw;    // the caller outside the timed region
    sfx_last[2] = sfx_pos->pw >> 8;
    sfx_last[3] = sfx_pos->ctrl;
    sfx_wrote = true;
    sfx_borrowed++;
    sfx_pos++;
}

// ---- stub tune: writes every register of all three voices each frame -----
static unsigned tune_frame;
static const unsigned tune_base[3] = { 0x0800, 0x0c00, 0x1200 };

static void tune_play(void)
{
    char     step = tune_frame & 31;
    char     gate = (tune_frame & 8) ? SID_CTRL_GATE : 0;
    volatile char *r = (volatile char *)0xd400;
    for (char v = 0; v < 3; v++)
    {
        unsigned f = tune_base[v] + (unsigned)step * 16;
        r[0] = (char)f;
        r[1] = f >> 8;
        r[2] = 0x00;                    // pulse width $0400
        r[3] = 0x04;
        r[4] = SID_CTRL_TRI | gate;
        r[5] = SID_ATK_8 | SID_DKY_168;
        r[6] = 0x80 | SID_DKY_300;
        r += 7;
    }
    sid.fmodevol = 0x0f;
    tune_frame++;
}

// ---- cue script ------------------------------------------------------------
struct Cue { unsigned frame; const struct Sfx *fx; };
static const struct Cue script[] = {
    {  40, &laser },   // voice free: starts
    {  44, &boom  },   // prio 3 over 1: cuts the laser after 4 frames
    {  50, &laser },   // refused, boom still owns the voice
    {  60, &laser },   // refused
    {  90, &laser },   // boom ended at frame 68: starts
    {  94, &laser },   // equal priority: restarts from row 0
    { 140, &boom  },   // starts
    { 150, &laser },   // refused
    {   0, 0 }
};

// ---- timing harness: CIA1 timer A, force-loaded from $FFFF, phi2 ----------
static void timer_start(void)
{
    cia1.cra = 0x00;
    cia1.ta  = 0xffff;
    cia1.cra = 0x11;
}

static unsigned timer_stop(void)
{
    cia1.cra = 0x00;
    return 0xffff - cia1.ta;
}

// ---- screen helpers --------------------------------------------------------
static const char hex_glyph[16] = { 0x30,0x31,0x32,0x33,0x34,0x35,0x36,0x37,0x38,0x39,1,2,3,4,5,6 };

static void put_text(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;
        *p++ = c;
    }
}

static void put_hex16(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[(v >> 12) & 15]; p[1] = hex_glyph[(v >> 8) & 15];
    p[2] = hex_glyph[(v >> 4) & 15];  p[3] = hex_glyph[v & 15];
}

int main(void)
{
    __asm { sei }                       // no KERNAL IRQ: CIA1 timer A is ours
    vic.color_border = 0;
    vic.color_back   = 0;
    for (unsigned i = 0; i < 1000; i++) { SCREEN[i] = 0x20; ((char *)0xd800)[i] = 1; }

    put_text(0, 0, "SFX ENGINE BESIDE A THREE-VOICE TUNE");
    put_text(2, 0, "STARTED");
    put_text(3, 0, "REFUSED");
    put_text(4, 0, "BORROWED");
    put_text(6, 0, "CHK      EXP");
    put_text(8, 0, "CYCLES PER CALL (CIA1 TIMER A)");
    put_text(9, 0, "TUNE");
    put_text(10, 0, "SFX ON");
    put_text(11, 0, "SFX OFF");
    put_text(12, 0, "EMPTY");
    put_text(14, 0, "VOICE 2 OWNER");

    unsigned frame = 0, cue = 0;
    unsigned t_tune = 0, t_on = 0, t_off = 0, t_empty;

    timer_start(); t_empty = timer_stop();
    put_hex16(12, 9, t_empty);

    for (;;)
    {
        vic_waitFrame();

        while (script[cue].fx && script[cue].frame == frame)
            sfx_play(script[cue++].fx);

        timer_start(); tune_play();  unsigned t = timer_stop();
        if (t > t_tune) t_tune = t;

        bool owned = sfx_cur != 0;
        timer_start(); sfx_update(); t = timer_stop();
        if (owned) { if (t > t_on)  t_on  = t; }
        else       { if (t > t_off) t_off = t; }
        if (sfx_wrote)
        {
            for (char i = 0; i < 4; i++) sfx_chk = fold(sfx_chk, sfx_last[i]);
            sfx_wrote = false;
        }

        put_hex16(2, 9, sfx_started);
        put_hex16(3, 9, sfx_refused);
        put_hex16(4, 9, sfx_borrowed);
        put_hex16(6, 4, sfx_chk);
        put_hex16(6, 13, EXPECT_CHK);
        put_text(6, 18, sfx_chk == EXPECT_CHK ? "PASS" : "FAIL");
        put_hex16(9, 9, t_tune);
        put_hex16(10, 9, t_on);
        put_hex16(11, 9, t_off);
        put_text(14, 14, sfx_cur ? "SFX " : "TUNE");
        frame++;
    }
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=sfx-engine.prg sfx-engine.c
```

Oscar64 build 2026-05-19. An earlier draft drew one warning:
`sfx_cur = 0;` produces `warning 2014: Numeric 0 used for nullptr`;
the listing uses `nullptr`.

## Expected output

Black border and background, white text. Every figure below was measured in
VICE x64sc 3.10 (rung 1) from the exit screenshot of the pinned run:

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 [-model ntsc] -exitscreenshot out.png -autostart sfx-engine.prg
```

decoding the text cells against the `chargen-901225-01.bin` glyphs (PAL
text row 0 at PNG y = 35, NTSC at y = 23). PAL (`screenshots/sfx-engine.png`)
and NTSC (`screenshots/sfx-engine-ntsc.png`) show the same text, because
the whole cue list is over by frame 164 and both runs go well past it:
about 250 frames on PAL and 290 on NTSC (arithmetic from the first traced
store at cycle 3,043,377 and the settled 19,656 and 17,095 cycles per
frame; an earlier draft of this sentence said 400, which was the Python
model's loop bound, not the run):

```
SFX ENGINE BESIDE A THREE-VOICE TUNE

STARTED  0005
REFUSED  0003
BORROWED 0040

CHK F2B4 EXP F2B4 PASS

CYCLES PER CALL (CIA1 TIMER A)
TUNE     014C
SFX ON   0107
SFX OFF  0037
EMPTY    0005

VOICE 2 OWNER TUNE
```

Reading the counters against the cue list: eight cues, five started, three
refused. The laser at frame 40 starts on a free voice; the explosion at 44
(priority 3) cuts it after four frames; the lasers at 50 and 60 are refused
while the explosion (24 rows, frames 44 to 67) owns the voice; the laser at
90 starts, the one at 94 restarts it at equal priority; the explosion at 140
starts and the laser at 150 is refused. Frames borrowed: 4 + 24 + 4 + 8 + 24
= 64 = `$0040`. The Python model below computes the same three counters and
the checksum `$F2B4` from the tables:

```python
def fold(chk, v): return ((chk ^ v) * 5 + 1) & 0xffff
# rows = list of (freq, pw, ctrl) per effect, cues = [(frame, name)], prio per effect
cur = None; pos = 0; chk = 0
for frame in range(400):
    for f, name in cues:
        if f == frame:
            if cur and prio[name] < prio[cur]: refused += 1
            else: cur, pos = name, 0; started += 1
    if cur:
        if pos == len(rows[cur]): cur = None
        else:
            freq, pw, ctrl = rows[cur][pos]
            for b in (freq >> 8, pw & 0xff, pw >> 8, ctrl): chk = fold(chk, b)
            borrowed += 1; pos += 1
```

The cycle figures are the largest value of CIA1 timer A seen over the run
for each call, in hex: the tune's play routine `$014C` = 332 cycles, the
engine with an effect running `$0107` = 263 cycles, the engine idle `$0037`
= 55 cycles, and an empty timed region `$0005` = 5 cycles, which is the
harness's own start/stop overhead and is included in the other three. Net of
it, the engine costs 258 cycles on a frame it owns the voice and 50 when it
does not, against a PAL frame of 19,656 cycles (about 1.3 % and 0.25 %,
arithmetic from the settled 63 cycles per line). The checksum fold runs
outside the timed region; an earlier build folded inside `sfx_update` and
measured `$01B2` = 434 cycles for the same seven stores, so 171 cycles of
that figure were the four 16-bit multiplies of the instrument, not the
engine.

### Register-level trace of the borrow and the hand-back

The claim that the engine's values land after the tune's, and that the
tune's values stand again once the effect ends, was checked with a VICE
trace checkpoint on the four bytes rather than by ear. `wp.mon` holds two
lines:

```
tr store d408 d40b
x
```

and the run was

```
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 5000000 -moncommands wp.mon -monlog -monlogname trace.log \
      -exitscreenshot tr.png -autostart sfx-engine.prg
```

Three things about that command were found by running it, not read. With
`-moncommands` the monitor plays the file and resumes on its own: a run
with the `x` line and a run without it both produced 553-store logs with
the same first stamp, and both exit screenshots show the program screen.
The `x` line is harmless and is kept. (An earlier version of this page said
the program never started without it; that run was short of cycles, not
short of an `x`.) `-limitcycles 2500000` was too few: the autostart
sequence takes about 3.0 million cycles before the program's first frame
(the first traced store is at cycle 3,043,377), so 5,000,000 gives about
100 frames. And `-monlogname` appends to an existing file; delete it
between runs. A `tr` (trace) checkpoint logs and continues; a `watch`
would stop in the monitor and hang a headless run, which was not tried.

The log has one `#1 (Trace store ...)` line and one disassembly line per
store, with the stored value in A for `STA` and in X for `STX`. The 100
frames logged 553 stores. Frame 39 (tune only) and frame 40 (the first
laser row) read, with the log's own cycle stamps on the right:

```
#1 (Trace store d408)  259/$103,  36/$24
.C:0d80  9D 01 D4    STA $D401,X    - A:0C X:07 Y:02 SP:f2 ..-..I..    3809961
#1 (Trace store d409)  259/$103,  43/$2b
.C:0d85  9D 02 D4    STA $D402,X    - A:00 X:07 Y:02 SP:f2 ..-..IZ.    3809968
#1 (Trace store d40a)  259/$103,  50/$32
.C:0d8a  9D 03 D4    STA $D403,X    - A:04 X:07 Y:02 SP:f2 ..-..I..    3809975
#1 (Trace store d40b)  259/$103,  58/$3a
.C:0d8f  9D 04 D4    STA $D404,X    - A:10 X:07 Y:02 SP:f2 ..-..I..    3809983

#1 (Trace store d408)  261/$105,  50/$32
.C:0d80  9D 01 D4    STA $D401,X    - A:0C X:07 Y:02 SP:f2 ..-..I..    3829757
#1 (Trace store d409)  261/$105,  57/$39
.C:0d85  9D 02 D4    STA $D402,X    - A:00 X:07 Y:02 SP:f2 ..-..IZ.    3829764
#1 (Trace store d40a)  262/$106,   1/$01
.C:0d8a  9D 03 D4    STA $D403,X    - A:04 X:07 Y:02 SP:f2 ..-..I..    3829771
#1 (Trace store d40b)  262/$106,   9/$09
.C:0d8f  9D 04 D4    STA $D404,X    - A:11 X:07 Y:02 SP:f2 ..-..I..    3829779
#1 (Trace store d408)  267/$10b,  50/$32
.C:0e13  8D 08 D4    STA $D408      - A:38 X:00 Y:02 SP:f2 ..-..I..    3830135
#1 (Trace store d409)  267/$10b,  54/$36
.C:0e16  8E 09 D4    STX $D409      - A:38 X:00 Y:02 SP:f2 ..-..I..    3830139
#1 (Trace store d40a)  267/$10b,  61/$3d
.C:0e1b  8D 0A D4    STA $D40A      - A:08 X:00 Y:02 SP:f2 ..-..I..    3830146
#1 (Trace store d40b)  268/$10c,  40/$28
.C:0e35  8E 0B D4    STX $D40B      - A:08 X:09 Y:03 SP:f2 ..-..I..    3830188
```

The tune's four stores come from one indexed loop (`STA $D401,X` with
X = 7 is `$D408`; Oscar64 turned the pointer walk into indexed stores) and
carry the tune's values `$0C $00 $04` and control `$10` or `$11`. In frame
40 the engine follows six raster lines later with `$38 $00 $08 $09`: row 0
of the laser table, frequency `$3800`, pulse width `$0800`, control
TEST+GATE. Frames 41 to 43 carry rows 1 to 3 (`$34`, `$2E`, `$26`); in
frame 44 the engine's first byte is `$20`, row 0 of the explosion, which
is the priority cut. The explosion's last row (`$01 $00 $00 $80`) is in
frame 67; frame 68 has the tune's four stores and nothing else. The voice
was handed back by the engine falling silent, not by writing anything. The
frames are one PAL frame apart (19,656 cycles); the first-store stamps of
consecutive frames differ by that give or take up to about 150 cycles
(19,506 to 19,809 across the 100 logged frames), because the loop's work
before the tune's store varies from frame to frame. All writes sit on
raster lines 259 to 268, below the display window, because the loop waits
on `vic_waitFrame()`.

## Why this works

The SID has no register latch: the last write to a register is what the
chip runs with. So a tune that writes voice 2 every frame and an engine that
writes voice 2 every frame do not fight if they run in a fixed order. The
tune goes first, the engine second, and whichever wrote last owns the
voice. Handing the voice back needs no code at all: the engine stops
writing, and the tune's next frame stands. That is why the terminator row
is the whole hand-back. The one cost of this arrangement is that the
effect's ADSR cannot be written "once at start" in the literal sense,
because the tune overwrites `$D40C`/`$D40D` every frame; the engine keeps
them in the effect header and re-pokes them with the row. AD and SR are
rate settings, so rewriting the same value should not disturb a running
envelope; that is rung 4, not measured here as audio. A player that
honours a voice mask lets the engine skip the
AD/SR re-poke and write them once; see the technique entry.

The priority rule is two comparisons: a request is refused only if an
effect is running and the request's priority is lower. Equal priority
restarts, which is what a repeated gun shot wants. The effect's first row
sets TEST+GATE (`$09`): the TEST+GATE frame of the hard restart in
`hardware/sid-reference.md`, followed a frame later by the real waveform
with GATE, which are that sequence's last two frames without the AD=0/SR=$F0
frame before them. (The SID page's own "test-bit restart" variant is a
different thing: TEST alone, cleared on the gate frame; this recipe does not
use it.) So the oscillator restarts from zero whatever
the tune left in it; the last gated row drops GATE so the tune's next
gate-on begins a fresh attack rather than inheriting a sustain. Whether
those choices sound right is not established here: nothing on this machine
can listen. What is established is that the bytes reach the registers in
the order the table says, and that the tune's bytes return the frame after
the terminator.

The tune stub is a triangle wave on each voice, pitch
stepping through 32 values, gate toggling every eight frames, fixed pulse
width and ADSR, volume 15. It exists to write all 22 registers each frame
so the engine's re-poke is tested against the same load a real player
gives it. Replace `tune_play()` with a real player's play call and the
engine is unchanged; keep the order.

The timing harness stops CIA1 timer A before reading it so the two byte
reads cannot straddle a borrow, and the program runs with interrupts off
(`sei`) so the KERNAL's 60 Hz use of the same timer cannot land inside a
measurement. The main loop runs once per frame on `vic_waitFrame()`, which
is a poll, not an interrupt; a game would call `tune_play()` then
`sfx_update()` from its raster IRQ in the same order.
