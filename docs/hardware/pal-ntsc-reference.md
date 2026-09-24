---
region: PAL+NTSC
---

# PAL vs NTSC Region Reference

## Overview

The Commodore 64 shipped in two main video regions that are mostly software-
compatible but differ in clock rate, frame timing, raster geometry, and SID
audio frequency. Code that ignores the region difference shows one or
more of: music played at the wrong tempo, raster IRQs that
fire on the wrong line, sprite multiplexers that overflow the visible area,
side-border-opening tricks that fail outright, and digi playback that pitches
up or down by roughly 4%.

The two regions:

- **PAL** — used in Europe, Australia, parts of South America, and most of
  Asia. Driven by a 17.734472 MHz crystal divided by 18 (some sources give
  17.734475 MHz, four times the PAL colour subcarrier; the 0.17 Hz that
  makes on the CPU clock is below anything measured here; an earlier
  version of this line paired 17.734475 with the 985,248.444 Hz quotient
  below, which belongs to 17.734472), a CPU clock of approximately
  985,248 Hz. Frame rate is 50 Hz, 312 scanlines per frame,
  63 cycles per scanline.
- **NTSC** — used in the United States, Canada, Japan, and Mexico. Driven by
  a 14.31818 MHz crystal, divides down to a CPU clock of approximately
  1,022,727 Hz. Frame rate is ~59.826 Hz (commonly called "60 Hz"), 263
  scanlines per frame, 65 cycles per scanline.

Two minor variants, **PAL-N** (Argentina/Paraguay/Uruguay; the Drean
C64, VIC 6572) and **PAL-M** (Brazil), are out of scope for the tables
in this reference, but they do NOT share PAL CPU timing, as an earlier
version of this page said. Measured in VICE x64sc with `-model drean`
(not on a 6572 on a bench): 312 raster lines of **65** cycles, 20,280
cycles per frame, CPU clock about 1.0234 MHz (1,023,451 cycles/s read
against the CIA TOD; VICE's own constant is 1,023,440). That is an
NTSC-length line on a PAL-length frame. Consequences: a per-frame CIA
timer needs $4F37 (20,279) there, not $4CC7; any loop padded to 63
cycles per line drifts 2 cycles per line, so PAL stable-raster and
side-border code loses sync; the SID clock follows the CPU clock, so
PAL frequency tables play about 3.9 % sharp (1,023,440 / 985,248); use
NTSC-derived tables. Frame rate is 50.46 Hz, so per-frame music tempo
is within 1 % of PAL. All three detection methods below report PAL-N
as PAL (max raster 311, frame time $4F38 >= $4800, KERNAL $02A6 = 1).
PAL-M is unmeasured here: VICE has no PAL-M model, so do not assume it
shares PAL timing either.

Sources for this document: c64-wiki PAL article, c64-wiki NTSC article,
codebase64 PAL/NTSC compatibility wiki, and the Bauer "VIC-II Article"
(cebix mirror).

## Quick reference

| Property                | PAL (6569)             | NTSC (6567R8)          | NTSC-old (6567R56A)    |
|-------------------------|------------------------|------------------------|------------------------|
| CPU clock               | 985,248.444 Hz         | 1,022,727.143 Hz       | 1,022,727.143 Hz       |
| Dot clock               | 7,881,987 Hz           | 8,181,817 Hz           | 8,181,817 Hz           |
| Frame rate (nominal)    | 50.125 Hz              | 59.826 Hz              | 60.993 Hz              |
| Scanlines per frame     | 312                    | 263                    | 262                    |
| Cycles per scanline     | 63                     | 65                     | 64                     |
| Cycles per frame        | 19,656                 | 17,095                 | 16,768                 |
| Visible Y range (Bauer, not measured here) | 16-299 (284 lines) | 41-262 then 0-12 (235 lines) | 41-261 then 0-12 (234 lines) |
| Visible X range (cycles)| 12-59 (approx)         | 14-61 (approx)         | 13-60 (approx)         |
| First badline (default) | $33 (51)               | $33 (51)               | $33 (51)               |
| Last badline (default)  | $F3 (243)              | $F3 (243)              | $F3 (243)              |
| $D012 wraps at line     | 312 (back to 0)        | 263 (back to 0)        | 262 (back to 0)        |
| Vertical blank starts   | line 300               | line 13                | line 13                |
| Top border opens at     | line 51 ($33)          | line 51 ($33)          | line 51 ($33)          |
| Bottom border starts at | line 251 ($FB)         | line 251 ($FB)         | line 251 ($FB)         |
| Side border CSEL write  | cycle 56 (one cycle)   | not measured here      | not measured here      |
| CIA timer A for frame   | $4CC7 (19,655)         | $42C6 (17,094)         | $417F (16,767)         |

With RSEL = 1 the last display line is 250 and the bottom border starts
on line 251, on PAL and NTSC alike (measured in VICE x64sc). An earlier
version of the table said the bottom border "opens" at 251.

Note on $D012 wrap: $D012 is only 8 bits wide. The 9th bit lives in
$D011 bit 7 (RST8). PAL frames see $D012 take values 0..255 with RST8=0
followed by 0..55 with RST8=1, then wrap; NTSC frames see 0..255 with
RST8=0 followed by 0..6 with RST8=1, then wrap. See
`d012_wrap_around` in [raster-and-badline.md](../pitfalls/raster-and-badline.md)
for the RST8 set/clear pattern, and `raster_line_count_difference` in
[region-timing.md](../pitfalls/region-timing.md) for the per-region wrap
point.

## Timing table — detailed

### Cycles per frame

PAL frames are 19,656 cycles long (312 lines × 63 cycles). NTSC frames
on the modern 6567R8 are 17,095 cycles (263 × 65). The older 6567R56A
NTSC chip uses 262 lines × 64 cycles = 16,768 cycles per frame; the
R56A is uncommon and is reported to have shipped only in the earliest
U.S. machines (production history from published sources, not verified
here). Any code that assumes a fixed cycle count per frame must be
parameterized per region. PAL-N (6572): 312 × 65 = 20,280 cycles per
frame, measured in VICE x64sc `-model drean`.

A PAL frame is roughly 15% longer than an NTSC frame in cycles (19,656
vs 17,095) but about 19% longer in time (19.95 ms vs 16.71 ms), because
the NTSC CPU clock is also 3.8% faster. That means:

- A music routine called once per frame plays about 19% faster on NTSC
  (59.83 Hz vs 50.12 Hz frames; measured in VICE x64sc as 600 vs 502
  frames per 10 s of CIA TOD time). An earlier version of this page said
  15%, which is the cycle-count ratio; it describes the CPU budget per
  frame, not tempo. See [Music tempo](#music-tempo).
- A demo effect that consumes N cycles per frame has 2,561 more cycles
  to work with on PAL.
- Work that fits in a 63-cycle PAL line also fits in a 65-cycle NTSC
  line (64 on the R56A); cycle-counted code still loses sync, by 2
  cycles a line. What shrinks is the frame: 49 fewer lines (50 on the
  R56A) leave 2,561 fewer cycles (2,888 on the R56A), so per-frame work
  that just fits on PAL may not fit on NTSC. An earlier version of this
  bullet said a raster split that fits a PAL line may not fit an NTSC
  one.

### Visible region

The visible region is the rectangle of raster lines where the VIC-II
generates picture content (as opposed to vertical or horizontal blanking).
Lines outside the visible Y range still execute on the CPU, but anything
drawn there will be off-screen.

PAL picture lines are 16-299 (284 lines; vertical blank 300-15). NTSC
picture lines are 41-262 wrapping to 0-12 (235 lines on the R8, 234 on
the R56A; vertical blank 13-40). These spans are from Bauer's VIC-II
article and are not measured here; what is measured (VICE x64sc 3.10)
is the frame length: maximum raster line 311 PAL, 262 R8, 261 R56A. An
earlier revision of this page gave 16-287 (272 lines) for PAL and
41-300 (260 lines) for NTSC. The PAL figure is VICE's default
screenshot crop (384x272, raster 16-287), not the chip's picture area,
and it left lines 288-299 unaccounted for against this page's own
"vertical blank starts line 300"; the NTSC figure ran 38 lines past the
end of a 263-line frame. VICE's default exit screenshots crop to raster
16-287 on PAL and 28-262 then 0-11 (247 rows) on NTSC; do not read
either as the visible area.

The default 25-row text display lives at lines 51-250 in both regions,
which is centered on PAL but slightly low on NTSC. Most games are
unaffected because they target the 200-line display, not the larger
visible area.

### Badline range

A badline is a scanline on which the VIC-II steals 40-43 cycles from
the CPU to fetch character pointers. By default, badlines occur on every
8th line starting at line 51 ($33): lines 51, 59, 67, ..., 243 in both
regions, 25 badlines for 25 character rows (measured in VICE x64sc, PAL
and NTSC R8). An earlier revision gave 247 here and $F8 (248) in the
table; neither is a badline: 248 lies outside the $30–$F7 window the
condition tests, and 247 & 7 = 7 ≠ YSCROLL (3). The badline range
itself is region-independent because it is anchored to the fixed raster
window $30-$F7 (48-247) and to YSCROLL ($D011 bits 0-2), gated by DEN
having been set on line $30, not to the border geometry. RSEL ($D011
bit 3) and CSEL ($D016 bit 3) move the border, not the badlines.
Measured in VICE x64sc 3.10 on the 8565 (VICE's default C64C; an earlier
version said 6569), 6567R8 and 6567R56A: clearing
RSEL or CSEL leaves the badlines on 51, 59, ..., 243; YSCROLL=4 moves
every one of them to 52, 60, ..., 244. An earlier version of this
paragraph attributed the anchor to RSEL/CSEL.

What differs by region is the number of non-badlines before and after
the display window:

- PAL has 51 lines (0-50) before the first badline and 68 lines
  (244-311) after the last.
- NTSC R8 has 51 lines (0-50) before and 19 lines (244-262) after.

The short post-display window on NTSC is the main reason NTSC demos have
trouble with effects that open the bottom border: there are fewer
lines for setup work between the last badline and the next frame's
first badline.

## VIC-II chip differences

The PAL/NTSC split is enforced by which VIC-II chip is socketed.
There is no software register that reports the region; software must
detect it by timing or by the raster line counter (see
[Detection at runtime](#detection-at-runtime)).

### 6569 — PAL VIC-II family

- **6569R1 / 6569R3** — early PAL VIC-II revisions with the same
  timing. (An earlier version of this page said R3 "fixes a
  sprite-vs-background priority bug"; nothing on this machine can check
  a revision history, so that claim is withdrawn rather than repeated.)
- **6569R4 / 6569R5** — later NMOS revisions, same timing as R3.
- **8565** — HMOS-II PAL VIC-II shipped in the C64C (C64-II, 1986+).
  Same timing as 6569R3 but with slightly different colour output
  (brighter greys, slightly different luminance levels). All 8565
  parts are timing-compatible with 6569 from a software perspective.


### 6567 — NTSC VIC-II family

- **6567R56A** — the original NTSC chip. 262 scanlines per frame, 64
  cycles per scanline (measured in VICE x64sc `-model oldntsc`). Its
  shipping history (early U.S. machines, 1982-83) is from published
  sources and not verified here.
- **6567R8** — the standard NTSC chip from 1983 onward. 263
  scanlines per frame, 65 cycles per scanline. Almost all NTSC software
  is written for it.
- **8562** — HMOS-II NTSC VIC-II shipped in the C64C. Timing-
  compatible with 6567R8.

The 6567R56A is the only common case where "NTSC" is not enough
information to write timing-exact code. Code that needs to run
on R56A machines must detect it by counting raster lines in a frame
(262 vs 263); see [Detection at runtime](#detection-at-runtime).

### Cross-region chip swaps

Physically swapping a 6569 for a 6567 (or vice versa) in a real
machine does not work without also changing the crystal oscillator,
because the CPU and VIC-II share a clock. Emulators let the user
select a region independent of any physical part.

## SID frequency table differences

The SID chip's tone generators are clocked from the CPU clock (phi2,
"phase 2"). A given $D400 register value therefore produces
different output frequencies on PAL vs NTSC.

The SID frequency formula is:

```
output_hz = (freq_register * cpu_clock_hz) / 16777216
```

where `freq_register` is the 16-bit value written to $D400/$D401
(or $D407/$D408, $D40E/$D40F) and `16777216` is 2^24.

With the standard clocks:

- PAL: `output_hz = freq_register * 985248 / 16777216`
- NTSC: `output_hz = freq_register * 1022727 / 16777216`

To produce the same audio pitch on both regions, the frequency
register must be scaled:

```
freq_ntsc = freq_pal * (985248 / 1022727)
          = freq_pal * 0.96334...
```

Or in reverse:

```
freq_pal = freq_ntsc * (1022727 / 985248)
         = freq_ntsc * 1.03804...
```

A PAL-tuned music routine played without correction on NTSC plays
roughly 0.65 semitones sharp. Conversely, an NTSC-tuned routine
played on PAL plays roughly 0.65 semitones flat.

### Common approach: two frequency tables

The usual approach is one precomputed frequency table per region
(96 notes × 2 bytes = 192 bytes each, so carrying both is cheap) and a
region flag read once at start-up (`pal_ntsc_detection` in
`techniques/raster.md`) to choose between them. Which named editors and
players do this, and how, is not verified here; an earlier version of
this paragraph named three and called the tables "12-note", which its
own byte count contradicted.

Example PAL-vs-NTSC frequency for middle A (A4, ~440 Hz):

- PAL: $D400/$D401 = $1D45 (7493 decimal)
- NTSC: $D400/$D401 = $1C32 (7218 decimal)

A music driver that hard-codes the PAL table and runs on NTSC plays
A4 at:

```
7493 * 1022727 / 16777216 = 456.8 Hz
```

which is 65 cents sharp, clearly audible.

### Filter cutoff and resonance

The SID filter's cutoff frequency ($D415/$D416) is also clock-
dependent, but the relationship is non-linear and varies by chip
revision (6581 vs 8580). Most code does not try to match filter
behavior precisely across regions because the per-chip variation
within a region is already larger than the cross-region drift.

## CIA timer values

The two CIA chips ($DC00-$DCFF and $DD00-$DDFF) contain 16-bit timers
clocked from phi2 (the CPU clock). A timer loaded with value `N`
fires after `N+1` cycles (the +1 accounts for the reload itself).

For once-per-frame timing without a raster IRQ, the CIA timer A latch
value is:

| Region        | Timer A latch | Cycles per frame |
|---------------|---------------|------------------|
| PAL           | $4CC7 (19,655)| 19,656           |
| NTSC R8       | $42C6 (17,094)| 17,095           |
| NTSC R56A     | $417F (16,767)| 16,768           |

(Latch = cycles - 1: a continuous timer with latch N repeats every N+1
cycles. Measured in VICE x64sc: latch $4CC7 repeats every 19,656 cycles
exactly and stays on the same PAL raster line frame after frame; $4CC6
repeats every 19,655 and drifts one cycle per frame. An earlier version
of this table said cycles - 2.)

The KERNAL's default IRQ uses CIA #1 timer A at roughly 60 Hz on BOTH
regions; it is not once per frame. At reset ($FDDD, entered from IOINIT
and again from CINT once $FF5B has set the PAL/NTSC flag at $02A6:
1 = PAL, 0 = NTSC) it writes the timer A latch as $4025 on PAL (16,422
cycles, 59.996 Hz) and $4295 on NTSC (17,046 cycles, 59.998 Hz), from ROM
bytes $FDE2-$FDF5. Read from the 901227-03 ROM image and confirmed in
VICE x64sc by sampling the free-running counter (maximum seen $401E on
PAL, $428E on NTSC). So TI/TI$ ticks about 60 times a second on a PAL
machine too, and on PAL the KERNAL IRQ drifts against the raster rather
than locking to it. An earlier version of this page gave $4CC6 (PAL) /
$42C5 (NTSC) and "50 Hz on PAL" for the KERNAL's defaults; those are
this page's own once-per-frame latches, which the KERNAL never writes.
Many games disable the KERNAL IRQ and reprogram timer A to
their own value (often once-per-frame, sometimes higher rates for
music routines that run faster than the frame rate).

### Music tempo

A music driver that runs once per frame plays at:

- PAL: 50.12 Hz (one tick per ~19.95 ms)
- NTSC: 59.83 Hz (one tick per ~16.71 ms)

If the music data is authored at 50 Hz tick rate and played on NTSC
without correction, the music plays 19.4% faster. The standard fix is
to skip one call in six on NTSC: run the driver from the frame IRQ but
skip its update on every 6th call, so it ticks on five of every six frames: 59.83 × 5/6 ≈ 49.86 Hz,
0.54% below PAL's 50.12 Hz, inaudible. The other option is to ship
per-region tempo tables in the music data (checklist item (c) below;
region-timing.md, Approach 2). Do not force a 50 Hz tick from a CIA
timer instead (see region-timing.md, "What not to do"). An earlier
revision of this sentence said "every 6th NTSC frame instead of every
5th", which read literally is one call in six, or 9.97 Hz (measured in
VICE x64sc: 50 calls in 300 NTSC frames against 250 for five-of-six).
Most modern drivers handle this automatically given a region flag.

## Border timing differences

The VIC-II has two timing windows that let code open the screen
border, turning the normally fixed border colour region into
addressable pixels. The exact cycle window during which the
border-disable bits ($D011 bit 3 for vertical, $D016 bit 3 for
horizontal) must be toggled differs slightly between PAL and NTSC.

### Top/bottom border (vertical) opening

To open the bottom border, code must clear $D011 bit 3 (24-row mode)
after the VIC-II has finished comparing line 247 (the bottom-border
line for 24-row mode, RSEL=0) and before it starts comparing line
251, the bottom-border line for 25-row mode (RSEL=1); then restore
RSEL=1 from line 252 on. RSEL must still be 1 for the whole of line 247
and already be 0 when line 251 begins, so the RSEL=0 write lands in
lines 248-250. Measured in VICE x64sc 3.10 (PAL, stable IRQ, write
cycle calibrated against the cycle-56 CSEL reference): a write on any
cycle of line 247 up to cycle 62 closes the display (from line 247 if
the write is on cycle 16 or earlier, from 248 otherwise); writes from
cycle 63 of line 247 through cycle 63 of line 250 open it; a write on
cycle 1 of line 251, or anywhere later in 251, leaves the border on
from 251. The open window is three lines plus one cycle:

- PAL: 190 cycles (measured)
- NTSC R8: 196 cycles (3 × 65 + 1, arithmetic; VICE shows the same
  lines closing and opening on NTSC)
- NTSC R56A: 193 cycles (3 × 64 + 1, arithmetic)

The line range is the same in every region because the 247/251 compare
values are internal to the VIC-II; only the per-line cycle count
differs. Bauer's description (one compare at cycle 63, one at the left
edge) would also admit the first 16 cycles of line 251; x64sc latches
the compare on every cycle and does not, and it has not been measured
on a real 6569 here. An earlier version of this page gave lines
247-251 / 5 lines / ~315 cycles, with the two modes' thresholds
swapped.

There is no separate top-border write. Once the bottom comparison has
been suppressed the flip-flop stays clear through the vertical blank
and the next frame's top border, and line 51's top comparison resets a
flip-flop that is already clear; a write near line 55 on its own opens
nothing (measured in VICE x64sc 3.10; the two writes, the window sweep
and the controls are in `recipes/kickassembler/topbottom-border-open.md`).

### Side border (horizontal) opening

The side-border open is a one-cycle target per scanline, not a window.
The VIC-II sets the border flip-flop when the beam reaches X=335 with
CSEL=0 or X=344 with CSEL=1; on PAL the beam is at X=335 during cycle
55 and X=344 during cycle 56 (cycles numbered 1-63 as in VICE and
Bauer), so the write that takes CSEL ($D016 bit 3) from 1 to 0 must
land on cycle 56: a `DEC $D016` on $C8 started on cycle 51 does it. Set
CSEL back to 1 any time before cycle 55 of the next line; there is no
separate left-border or close window, because a flip-flop that was
never set has nothing to reset at X=24/31. Measured in VICE x64sc 3.10
(recipes/kickassembler/sideborder-open.md; a one-cycle sweep with a
badline anchor opens only on the cycle-56 write, and a restore on
cycle 47 of the next line still opens).

NTSC 6567R8 / R56A: not measured here. The X positions are the same,
but the cycle number and the per-line loop length (65 or 64 cycles, not
63) have to be re-derived from the 6567 timing table.

Earlier text here gave a 1-2 cycle window at zero-indexed cycles 57-58
with a close window at 14-15 of the next line, and 58-59 for the R8;
none of those windows exist, and 57-58 in any indexing leaves the
border closed.

## Sample rate caveats for $D418 digi

$D418 digi generates pseudo-PCM audio by
rapidly writing 4-bit volume values to the SID volume register
($D418). The output sample rate equals the rate at which $D418
is written.

A common scheme is to write $D418 once per scanline using a
raster IRQ. The resulting sample rate is:

- PAL: 985,248 Hz ÷ 63 cycles per line = 15,639 Hz
- NTSC R8: 1,022,727 Hz ÷ 65 cycles per line = 15,734 Hz
- NTSC R56A: 1,022,727 Hz ÷ 64 cycles per line = 15,980 Hz

PAL and NTSC R8 are close enough (0.6% apart, about 10 cents) that
the same digi data can play on both regions without resampling and
still sound correct. The pitch shift is below 20 cents, which is at
the limit of audibility. The rare R56A is the exception: it runs
2.2% faster than PAL, about 37 cents, which is audible.

However, a digi played by a CIA timer at a fixed cycle interval
will drift more:

- A timer of $0080 (128+1 = 129 cycles per sample) gives
  ~7,638 Hz on PAL and ~7,928 Hz on NTSC R8, a 290 Hz / ~3.8%
  difference, audible as a pitch shift.

To play a sample at the same rate on both regions, scale the
timer value by the clock ratio:

```
timer_ntsc = timer_pal * (1022727 / 985248)
           = timer_pal * 1.03804
```

### 8580 vs 6581 digi

The 6581 SID has a DC-coupling quirk in $D418 that makes
$D418 digi loud and clear. The 8580 SID fixes this DC quirk, which
makes $D418 digi much quieter (some tracks are barely audible on
an 8580). This is a chip-revision issue, not a region issue:
both 6581 and 8580 ship in both PAL and NTSC machines. C64Cs from
~1986 onward usually ship with 8580; earlier C64s ship with 6581.

## Detection at runtime

There is no register that returns "I am PAL" or "I am NTSC". Code
must detect the region by observation. Three methods follow. The two
raster methods work at any time; the KERNAL flag (Method 3) holds only if
nothing has overwritten it since reset. An earlier version said "two
methods are reliable" above three methods.

### Method 1: Read $D012 + $D011 bit 7 at frame top

Wait for $D011 bit 7 to be set (raster line >= 256), then keep reading
$D012 until bit 7 clears again; the last low byte seen while bit 7 was
set is the last line of the frame: $37 (311) on PAL, $06 (262) on the
6567R8, $05 (261) on the 6567R56A.

Maximum raster line value:
- PAL: 311 ($137, i.e. $D012=$37 with $D011 bit 7=1)
- NTSC R8: 262 ($106: $D012=$06 with $D011 bit 7=1)
- NTSC R56A: 261 ($105: $D012=$05 with $D011 bit 7=1)

The routine below tracks the low byte while RST8 is set and returns
the region when RST8 falls. It works from any entry line. The earlier
listing here ended in `...`, never set A, and its loop exited on the
first pass because it was entered while the raster was still on line
0; it also read $D011 before $D012, which lets it mistake line 256 for
line 0 about 40% of the time (measured in VICE x64sc: 24 of 72 starts).

```kickassembler
// Region by last raster line. On exit A = 0 PAL (6569), 1 NTSC 6567R8, 2 NTSC 6567R56A.
// Trashes X, Y. Call with interrupts disabled. Measured in VICE x64sc 3.10 on all three models.
detect_region:
wait_lo:
    lda $D011
    bmi wait_lo         // a band already in progress: let it finish (see below)
wait_hi:
    lda $D011
    bpl wait_hi         // wait for RST8 = 1 (line >= 256)
    ldy #0
track:
    ldx $D012           // candidate low byte
    lda $D011
    bpl wrapped         // RST8 fell: X may already be line 0, Y is the last good one
    txa
    tay                 // Y = last $D012 seen while RST8 = 1
    jmp track           // 17 cycles a pass, well under one line
wrapped:
    lda #0
    cpy #$10
    bcs done            // $37 -> PAL
    lda #1
    cpy #$06
    beq done            // $06 -> R8
    lda #2              // $05 -> R56A
done:
    rts
```

The `wait_lo` loop closes a race at the end of the band, not the start.
A call landing in the last cycles of line 311 reads $D012 on that line
and $D011 on line 0, so `bpl wrapped` is taken before the first `tay`
and Y is still 0: the routine would answer R56A on a PAL machine. A call
landing mid-band needs no guard (the lines it skips are the smaller
values), but with the guard `wait_hi` can only exit at line 256.
Measured on the equivalent tracking loop (`pal_ntsc_detection` in
`techniques/raster.md`, VICE x64sc 3.10): without the guard, entered on
PAL line 311 with the entry phase swept in 4-cycle steps, 2 of 16 phases
returned the register's preloaded junk; with it, all 16 returned $37.
Runtime depends on the entry line: 57 lines at best on PAL (called from
line 255) and 368 at worst (called as RST8 rises: the rest of that
band, 256 clear lines, and a whole band again), 8 to 270 lines on the
6567R8; that loop measured 3,575 and 23,172 cycles on PAL, 500 and
17,535 on the R8, 432 and 17,131 on the R56A against CIA 1 timer A.

A simpler and more common approach is to time a frame:

```
; Time one frame in cycles using CIA timer B.
; Returns approx 19656 (PAL) or 17095 (NTSC R8) in $FB/$FC
; (measured in VICE x64sc: $4CC2..$4CC9 and $42C0..$42C7; the
; spread is the 7-cycle poll loop).
;
; Method: let any current line 0 pass, wait for raster line 0,
; start timer B counting down from $FFFF, wait for the next
; line 0, read timer B, subtract from $FFFF.
;
; An earlier version of this listing read $D011 before $D012, so
; a read pair straddling the 255->256 wrap passed as line 0, and
; it re-tested for line 0 immediately after arming the timer; in
; VICE it returned ~$0DC8 (lines 256-311 only) or ~$0011 (a few
; cycles), never a frame.

time_frame:
    sei
    lda #$7F
    sta $DC0D           ; mask all CIA #1 IRQ sources
    lda $DC0D           ; ack any pending
    lda #$00
    sta $DC0F           ; stop timer B
    lda #$FF
    sta $DC06           ; timer B latch low
    sta $DC07           ; timer B latch high (loads the counter while stopped)
pre0:
    lda $D012
    beq pre0            ; already on line 0 (or 256): let it pass first
wait0a:
    lda $D012           ; low byte first: a 255->256 straddle cannot pass as line 0
    bne wait0a
    lda $D011
    bmi wait0a          ; RST8 set: that was line 256, keep waiting
    lda #$19            ; start + one-shot + force load, phi2 input
    sta $DC0F
leave0:
    lda $D012
    beq leave0          ; let this line 0 go by before waiting for the next one
wait0b:
    lda $D012
    bne wait0b
    lda $D011
    bmi wait0b
    lda #$00
    sta $DC0F           ; stop timer B
    sec
    lda #$FF
    sbc $DC06
    sta $FB
    lda #$FF
    sbc $DC07
    sta $FC
    cli
    rts

; Caller: if $FC >= $48 -> PAL   ($4CC2..$4CC9; frame latch is $4CC7)
;         else         -> NTSC  ($42C0..$42C7)
```

The threshold $4800 (18,432) lies between the NTSC R8
cycle count (17,095) and the PAL cycle count (19,656).

### Method 2: Read $D012 wrap point

Wait for $D011 bit 7 to go high (i.e., raster line ≥ 256), then
poll $D012 until it stops counting up. The last value before wrap
is the discriminator:

- PAL: $D012 reaches $37 (55) then wraps -> max line 311
- NTSC R8: $D012 reaches $06 (6) then wraps -> max line 262
- NTSC R56A: $D012 reaches $05 (5) then wraps -> max line 261

Practical discriminator: read $D012 when $D011 bit 7 is 1. If
the value is ever $10 or higher, the machine is PAL.

```
; Detect PAL vs NTSC by raster line wrap. Carry clear = NTSC,
; carry set = PAL.
detect_pal:
    sei
wait_lo:
    lda $D011
    bmi wait_lo         ; a band already in progress: let it finish (see below)
wait_hi:
    lda $D011
    bpl wait_hi         ; wait for RST8=1 (raster >= 256)
scan:
    lda $D011
    bpl is_ntsc         ; RST8 fell before $D012 reached $10: 262/263-line frame
    lda $D012
    cmp #$10            ; >= $10 means PAL (NTSC tops at $06/$05)
    bcc scan            ; keep polling while the raster is below 272
    sec                 ; line 272 exists: 312-line frame (PAL, PAL-N)
    rts
is_ntsc:
    clc
    rts
```

An earlier version of this listing read $D012 once, immediately after
RST8 rose (i.e. on line 256, where $D012 is 0), and so returned NTSC
on a PAL machine from every raster phase below 272 (six of eight phases
measured in VICE x64sc); the prose above it already described polling,
the code did not. The `wait_lo` guard is the end-of-band race from
Method 1: a call in the last cycles of line 311 would pass `wait_hi`
there and take `bpl is_ntsc` on line 0. Technique: `pal_ntsc_detection`
in `techniques/raster.md`; recipe: `recipes/oscar64/pal-ntsc-detect.md`.

This is the shortest reliable detect. It does not distinguish R8 from
R56A; for that, use the Method 1 `detect_region` routine above, whose
Y register ends as $06 on the R8 and $05 on the R56A (measured in VICE
x64sc 3.10, `-model ntsc` and `-model oldntsc`, not on hardware).

### Method 3: Read the KERNAL's own flag at $02A6

The stock C64 KERNAL does store a region byte. At reset ($FCFB ->
JSR $FF5B) it runs the screen-editor init at $E518, whose VIC register
table sets the raster compare to line 311 ($D011 = $9B, $D012 = $37)
and clears $D019; $FF5B then waits for $D012 = 0, reads $D019 bit 0
and stores it at $02A6: 0 = NTSC, 1 = PAL (also 1 on 312-line
PAL-N/Drean, which it cannot tell from PAL). It then jumps to $FDDD,
which reads $02A6 to choose the CIA #1 timer A jiffy latch; $F42C
reads it again to pick the RS-232 baud table. Read from the 901227-03
ROM image ($FF5B: `20 18 E5 AD 12 D0 D0 FB AD 19 D0 29 01 8D A6 02 4C
DD FD`). Measured in VICE x64sc after boot: $02A6 = 1 on the PAL and
Drean models, 0 on NTSC 6567R8 and 6567R56A.

It is plain RAM written once at reset, so trust it only if nothing has
overwritten it, and it cannot separate R8 from R56A. $D030 has nothing
to do with it: on a C64 the address is unmapped and reads $FF; on the
C128 it is the VIC-IIe 2 MHz/test register, read/write (bit 0 toggles
when written, measured in x128), and carries no region information. An
earlier version of this page said the stock KERNAL stores no region
byte and called $D030 a read-only C128 region flag; both statements
were wrong.

**Recommendation:** Use Method 2 (poll $D012 while RST8=1) for simple
PAL/NTSC distinction. Use Method 1's `detect_region` to distinguish R8
from R56A (Y = $06 / $05; measured in VICE x64sc 3.10, `-model ntsc`
and `-model oldntsc`, not on hardware), or `time_frame` for the
cycle count itself. $02A6 is a free check only when nothing is known
to have touched it since reset.

## Region-portability checklist

Code intended to run on both regions must parameterize the following:

- [ ] **CPU clock constant.** Define a symbol (e.g., `CPU_CLOCK`)
      and select it at startup based on detected region. Used by
      anything that converts seconds -> cycles.
- [ ] **SID frequency table.** Carry two tables. Select pointer
      at startup. Cost: ~192 bytes per table.
- [ ] **CIA timer values.** Any timer set to "once per frame" or
      "once per N frames" must be region-scaled. Hardcoding
      $4CC7 breaks NTSC; hardcoding $42C6 breaks PAL.
- [ ] **Music driver tick rate.** If the driver is authored at
      50 Hz tick rate, decide whether to (a) accept the 20% tempo
      jump on NTSC, (b) skip 1 frame in 6 on NTSC to approximate
      50 Hz, or (c) ship a re-tuned NTSC version of the music data.
- [ ] **Raster IRQ line numbers.** Most line numbers are
      region-independent because the display window is the same.
      But anything placed below the display window must be checked
      against the NTSC wrap point: lines 263-311 do not exist on the
      6567R8 (262-311 on the R56A); a raster IRQ set there never
      fires on NTSC (measured in VICE x64sc: an IRQ at line 262 fires
      on both regions, one at line 263 fires only on PAL). Lines
      251-262 exist in both regions. An earlier version of this page
      said lines 252-262 did not exist on NTSC; they do.
- [ ] **Sprite multiplexer schedule.** If multiplexer slots are
      placed in the bottom blanking, they must be moved or
      eliminated on NTSC.
- [ ] **Side-border-open timing.** Use a region-dispatch table
      for the cycle offset.
- [ ] **Digi playback rate.** If using a CIA timer for the
      sample rate, scale by clock ratio. If using a raster IRQ
      (one sample per line), the rate auto-adjusts.
- [ ] **Visible Y range assumptions.** Don't write to $D011
      bits 0-2 (vertical scroll) assuming a specific display
      offset on screen.
- [ ] **Frame counter overflow.** A frame counter that wraps
      every N seconds wraps at different real times on PAL vs
      NTSC. If timestamps matter, compute in frames and convert
      to seconds at display time.
- [ ] **Game speed.** Per-frame movement deltas must be scaled by
      the frame-period ratio 50.125/59.826 = 0.838 when moving from
      PAL authoring to NTSC. A delta is applied once per frame, so it
      scales with the frame rate, not with the cycles in a frame; an
      earlier version of this page gave the cycles-per-frame ratio
      17,095/19,656 = 0.870, which is the CPU-budget ratio and leaves
      the game 3.8% fast (the NTSC/PAL clock ratio). Many ported
      European games skip the scaling and play 19.4% faster on U.S.
      machines.
- [ ] **Loader timing.** Custom IRQ-based loaders that bit-
      bang the serial bus often depend on cycle counts; many
      PAL loaders fail on NTSC because the timing windows
      shift.

## Pitfalls

- **Music tempo drift**: Hard-coding a single SID frequency table
  causes 4% pitch error and 20% tempo error across regions. See
  [SID frequency table differences](#sid-frequency-table-differences).
- **Raster IRQ misfire**: A raster IRQ set to fire on line 280
  fires on PAL but never on NTSC (max line is 262). Always
  detect region before installing IRQs that target lines above
  262. See [Detection at runtime](#detection-at-runtime).
- **Sideborder open on NTSC**: PAL side-border code assumes a
  63-cycle line; on the 6567R8 the loop must be 65 cycles (64 on the
  R56A) and the sprite-stall and badline phases differ, so the write
  no longer lands where it did. The cycle of the write on NTSC is not
  measured here; re-derive it, do not shift it by one on faith. See
  [Border timing differences](#border-timing-differences).
- **CIA timer A frame timing**: Loading $4CC7 (PAL frame) on
  NTSC fires every 1.15 frames, producing slow scrolling and
  off-beat music. Always set the timer based on detected region.
- **$D012 raster wrap**: Comparing $D012 against >=256 requires
  combining with $D011 bit 7. The wrap point differs by region
  (312 PAL, 263 NTSC). See `d012_wrap_around` in
  [raster-and-badline.md](../pitfalls/raster-and-badline.md) (RST8
  handling) and `raster_line_count_difference` in
  [region-timing.md](../pitfalls/region-timing.md) (wrap point per
  region).
- **Digi pitch shift**: A fixed CIA timer produces different
  sample rates on PAL vs NTSC. For accurate cross-region digi,
  scale the timer or use a raster-IRQ-driven (per-line) digi.
- **Cross-region 6567R56A**: The R56A has 262 lines / 64 cycles
  rather than 263 / 65. Method 1's `detect_region` tells it from the
  R8 by the frame's last line, $05 against $06; the flag-only
  `detect_pal` (Method 2) cannot, and `time_frame` sees 16,768 against
  17,095 cycles.
- **PAL-N / PAL-M misdetection**: Raster-wrap, frame-timing and
  KERNAL ($02A6) detection all report a PAL-N (Drean, 6572) machine
  as PAL, but its lines are 65 cycles, not 63 (measured in VICE x64sc
  `-model drean`; 20,280 cycles per frame). Cycle-exact PAL code and
  PAL SID tables are wrong there. To tell them apart, time a
  frame: 20,280 vs 19,656 cycles ($4F vs $4C in the high byte)
  separates PAL-N from PAL; the raster wrap cannot. PAL-M is
  unmeasured (no VICE model). An earlier version of this bullet said
  PAL was the correct answer for CPU timing on these machines.
- **Game-speed porting**: Ported games that skip the 50.125/59.826 =
  0.838 movement-delta scaling play 19.4% too fast in the region they
  weren't authored in (the ratio is the frame period, not the
  17,095/19,656 = 0.870 cycle budget this page previously gave). This
  is a content issue, not a hardware issue, but it surfaces during
  region porting.
- **Visible Y range vs display window**: RSEL ($D011 bit 3) and
  YSCROLL (bits 0-2) do not move the display window. On NTSC as on PAL
  it spans lines 51–250 with RSEL = 1 and 55–246 with RSEL = 0, and
  YSCROLL = 7 moves text down inside it, clipped at line 250 (measured in
  VICE x64sc, `-model ntsc` and default). Those lines are inside the
  NTSC visible area. An earlier version of this bullet said these bits
  could push the display below the visible area on NTSC.

## Cross-references

- VIC-II chip register details: [vic-ii-reference.md](vic-ii-reference.md)
- SID chip register details: [sid-reference.md](sid-reference.md)
- CIA chip register details: [cia-reference.md](cia-reference.md)
- $D012 raster-wrap handling: [raster-and-badline.md](../pitfalls/raster-and-badline.md) (`d012_wrap_around`)
- Per-region raster line count: [region-timing.md](../pitfalls/region-timing.md) (`raster_line_count_difference`)

## Source citations

- c64-wiki, "PAL": https://www.c64-wiki.com/wiki/PAL — refresh
  rates, frame structure, region geographies.
- c64-wiki, "NTSC": https://www.c64-wiki.com/wiki/NTSC — NTSC
  timing and chip revisions (6567R56A vs 6567R8).
- codebase64, "PAL/NTSC compatibility":
  https://codebase64.org/doku.php?id=base:pal_ntsc_compatibility —
  detection routines, region-portability practices.
- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II)
  and its application in the Commodore 64" (cebix mirror):
  https://www.cebix.net/VIC-Article.txt — per-region cycle tables,
  raster geometry, border-open cycle windows.
- VICE 3.10, `x64sc`, models `default`, `ntsc`, `oldntsc` — the
  instrument behind every figure marked measured (the three wrap
  bytes, the entry-line runs and the CIA-timed durations under Method
  1, the `wait_lo` race under Method 2). An earlier version filed them
  all under Method 2. https://vice-emu.sourceforge.io/
- KickAssembler 5.25 — assembled the Method 1 and Method 2 listings.
- VICE's `kernal-901227-03.bin` — the bytes at $FF5B, $E518,
  $ECB9 and $FDDD behind Method 3 and the IOINIT timer values.

<!-- doc-type: hardware-reference -->
