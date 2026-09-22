---
region: PAL+NTSC
---

# PAL vs NTSC Region Reference

## Overview

The Commodore 64 shipped in two main video regions that are mostly software-
compatible but differ in clock rate, frame timing, raster geometry, and SID
audio frequency. Code that does not account for the region difference will
exhibit one or more of: music played at the wrong tempo, raster IRQs that
fire on the wrong line, sprite multiplexers that overflow the visible area,
side-border-opening tricks that fail outright, and digi playback that pitches
up or down by roughly 4%.

The two regions covered by this document are:

- **PAL** — used in Europe, Australia, parts of South America, and most of
  Asia. Driven by a 17.734475 MHz crystal, divides down to a CPU clock of
  approximately 985,248 Hz. Frame rate is 50 Hz, 312 scanlines per frame,
  63 cycles per scanline.
- **NTSC** — used in the United States, Canada, Japan, and Mexico. Driven by
  a 14.31818 MHz crystal, divides down to a CPU clock of approximately
  1,022,727 Hz. Frame rate is ~59.826 Hz (commonly called "60 Hz"), 263
  scanlines per frame, 65 cycles per scanline.

Two minor variants — **PAL-N** (Argentina/Paraguay/Uruguay) and **PAL-M**
(Brazil) — are out of scope for this reference. They use different colour
sub-carrier frequencies but share PAL-region CPU timing, so PAL code
generally works on them. Code targeting only PAL and NTSC will run on
PAL-N and PAL-M machines without further adjustment.

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
| Visible Y range         | 16-287                 | 41-300                 | 41-299                 |
| Visible X range (cycles)| 12-59 (approx)         | 14-61 (approx)         | 13-60 (approx)         |
| First badline (default) | $33 (51)               | $33 (51)               | $33 (51)               |
| Last badline (default)  | $F8 (248)              | $F8 (248)              | $F8 (248)              |
| $D012 wraps at line     | 312 (back to 0)        | 263 (back to 0)        | 262 (back to 0)        |
| Vertical blank starts   | line 300               | line 13                | line 13                |
| Top border opens at     | line 51 ($33)          | line 51 ($33)          | line 51 ($33)          |
| Bottom border opens at  | line 251 ($FB)         | line 251 ($FB)         | line 251 ($FB)         |
| Side border CSEL write  | cycle 56 (one cycle)   | not measured here      | not measured here      |
| CIA timer A for frame   | $4CC7 (19,655)         | $42C6 (17,094)         | $417F (16,767)         |

Note on $D012 wrap: $D012 is only 8 bits wide. The 9th bit lives in
$D011 bit 7 (RST8). PAL frames see $D012 take values 0..255 with RST8=0
followed by 0..55 with RST8=1, then wrap; NTSC frames see 0..255 with
RST8=0 followed by 0..6 with RST8=1, then wrap. See
[c64-pitfalls.md](c64-pitfalls.md) for the $D012-wrap pattern.

## Timing table — detailed

### Cycles per frame

PAL frames are 19,656 cycles long (312 lines × 63 cycles). NTSC frames
on the modern 6567R8 are 17,095 cycles (263 × 65). The older 6567R56A
NTSC chip uses 262 lines × 64 cycles = 16,768 cycles per frame; the
R56A is rare and only shipped in the earliest "silver-label" U.S. C64s
from 1982. Any code that assumes a fixed cycle count per frame must be
parameterized per region.

A PAL frame is roughly 15% longer than an NTSC frame. That means:

- A music routine called once per frame plays roughly 15% faster on NTSC.
- A demo effect that consumes N cycles per frame has 2,560 more cycles
  to work with on PAL.
- A raster split that "just barely fits" on PAL may not fit on NTSC
  because each scanline is 2 cycles longer (giving more time per line)
  but each frame contains 50 fewer scanlines to work with — the cycle
  budget is what matters, not the line count.

### Visible region

The "visible region" is the rectangle of raster lines where the VIC-II
generates picture content (as opposed to vertical or horizontal blanking).
Lines outside the visible Y range still execute on the CPU, but anything
drawn there will be off-screen.

PAL visible Y is approximately lines 16-287 (272 visible lines).
NTSC visible Y is approximately lines 41-300 (260 visible lines on R8).

The default 25-row text display lives at lines 51-250 in both regions,
which is centered on PAL but pushed slightly low on NTSC. Most games
work fine because they target the 200-line display, not the larger
visible area.

### Badline range

A "badline" is a scanline on which the VIC-II steals 40-43 cycles from
the CPU to fetch character pointers. By default, badlines occur on every
8th line starting at line 51 ($33) — so lines 51, 59, 67, ..., 247 in
both regions. The badline range itself is region-independent because
it is anchored to where the VIC-II starts drawing the display window
(set by $D011 bit 3 / $D016 bit 3).

What differs by region is the number of non-badlines before and after
the display window:

- PAL has 50 lines (0-50) before the first badline and 64 lines
  (248-311) after the last.
- NTSC R8 has 50 lines (0-50) before and 15 lines (248-262) after.

The narrow post-display window on NTSC is the main reason NTSC
demos struggle with effects that "open" the bottom border — there
are far fewer lines to do setup work between the last badline and
the next frame's first badline.

## VIC-II chip differences

The PAL/NTSC split is enforced by which VIC-II chip is socketed.
There is no software register to read region directly; agents must
detect by timing or by the raster line counter (see
[Detection at runtime](#detection-at-runtime)).

### 6569 — PAL VIC-II family

- **6569R1 / 6569R3** — early PAL VIC-II revisions. 6569R1 is the
  original NMOS part; 6569R3 fixes a sprite-vs-background priority
  bug. Both have the same timing.
- **6569R4 / 6569R5** — later NMOS revisions, same timing as R3.
- **8565** — HMOS-II PAL VIC-II shipped in the C64C (C64-II, 1986+).
  Same timing as 6569R3 but with slightly different colour output
  (brighter greys, slightly different luminance levels). All 8565
  parts are timing-compatible with 6569 from a software perspective.

PAL VIC-II chips were the most-produced variant because Europe was
Commodore's largest market for the C64.

### 6567 — NTSC VIC-II family

- **6567R56A** — the original NTSC chip, 1982. 262 scanlines per
  frame, 64 cycles per scanline. Shipped in early "silver-label"
  C64s sold in the U.S. and Canada in 1982-1983. Extremely rare.
- **6567R8** — the standard NTSC chip from 1983 onward. 263
  scanlines per frame, 65 cycles per scanline. This is what
  virtually all NTSC software is written for.
- **8562** — HMOS-II NTSC VIC-II shipped in the C64C. Timing-
  compatible with 6567R8.

The 6567R56A is the only common case where "NTSC" is not enough
information to write timing-exact code. Code that needs to run
on R56A machines must detect by counting raster lines in a frame
(262 vs 263) — see [Detection at runtime](#detection-at-runtime).

### Cross-region chip swaps

Physically swapping a 6569 for a 6567 (or vice versa) in a real
machine does not work without also changing the crystal oscillator,
because the CPU and VIC-II share a clock. Emulators sidestep this
by letting you select a region independent of any physical part.

## SID frequency table differences

The SID chip's tone generators are clocked from the CPU clock (called
phi2 — "phase 2"). A given $D400 register value therefore produces
different output frequencies on PAL vs NTSC.

The SID frequency formula is:

```
output_hz = (freq_register * cpu_clock_hz) / 16777216
```

where `freq_register` is the 16-bit value written to $D400/$D401
(or $D407/$D408, $D40E/$D40F) and `16777216` is 2^24.

Using the canonical clocks:

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

Most music drivers (Goattracker, SID-Wizard, Cubase64) ship two
precomputed 12-note frequency tables — one for each region — and
detect at startup which one to use. The tables are typically
~192 bytes each (96 notes × 2 bytes), so carrying both is cheap.

Example PAL-vs-NTSC frequency for middle A (A4, ~440 Hz):

- PAL: $D400/$D401 = $1D45 (7493 decimal)
- NTSC: $D400/$D401 = $1C32 (7218 decimal)

A music driver that hard-codes the PAL table and runs on NTSC plays
A4 at:

```
7493 * 1022727 / 16777216 = 456.8 Hz
```

which is 65 cents sharp — clearly audible.

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

For "once per frame" timing without a raster IRQ, the typical CIA
timer A latch value is:

| Region        | Timer A latch | Cycles per frame |
|---------------|---------------|------------------|
| PAL           | $4CC6 (19,654)| 19,656           |
| NTSC R8       | $42C5 (17,093)| 17,095           |
| NTSC R56A     | $417E (16,766)| 16,768           |

(Latch = cycles - 2 because the timer fires when it rolls past zero
and the reload takes one cycle.)

The KERNAL's default IRQ setup uses CIA #1 timer A to fire at roughly
60 Hz on NTSC and 50 Hz on PAL. The default latch values written by
KERNAL reset on a stock NTSC machine are $42C5; on a stock PAL machine,
$4CC6. Many games disable the KERNAL IRQ and reprogram timer A to
their own value (often once-per-frame, sometimes higher rates for
music routines that run faster than the frame rate).

### Music tempo

A music driver that runs once per frame plays at:

- PAL: 50.12 Hz (one tick per ~19.95 ms)
- NTSC: 59.83 Hz (one tick per ~16.71 ms)

If the music data is authored at 50 Hz tick rate and played on NTSC
without correction, the music plays 19.4% faster — a noticeably
brighter tempo. The standard fix is to play the music driver every
6th NTSC frame instead of every 5th (skipping a frame periodically),
or to interpolate by running the driver every frame and skipping
its update every Nth call. Most modern drivers handle this
automatically given a region flag.

## Border timing differences

The VIC-II has two famous timing windows that let demo code "open"
the screen border — turning the normally-fixed border colour region
into addressable pixels. The exact cycle window during which the
border-disable bits ($D011 bit 3 for vertical, $D016 bit 3 for
horizontal) must be toggled differs slightly between PAL and NTSC.

### Top/bottom border (vertical) opening

To open the top or bottom border, code must clear $D011 bit 3 (24
rows mode) just before the VIC-II compares the current raster line
against the bottom-border-enable threshold (line 251 in 24-row mode,
line 247 in 25-row mode), then restore it.

The open window is:

- PAL: lines 247-251 (5 lines, ~315 cycles)
- NTSC R8: lines 247-251 (5 lines, ~325 cycles)
- NTSC R56A: lines 247-251 (5 lines, ~320 cycles)

The line range is identical because the comparison register is
internal to the VIC-II and uses the same constant. The cycle
budget differs because each line has a different cycle count.

### Side border (horizontal) opening

The side-border open is much tighter. It requires toggling $D016
bit 3 within a specific 1-2 cycle window per scanline. The
window position differs by region:

- PAL: cycle 57-58 of the scanline (close window: cycle 14-15 of
  the next line)
- NTSC R8: cycle 58-59 (close: cycle 15-16 of next line)
- NTSC R56A: cycle 57-58 (close: cycle 14-15 of next line)

Cycle counts here are zero-indexed from the start of the scanline
(where "start" is defined as the VIC-II's internal cycle 0, which
is not the same as the first visible pixel — see Bauer §3 for
the full diagram).

Side-border code that hard-codes PAL cycle offsets will fail on
NTSC R8 because the open window has moved by one cycle. Most
production side-border opens use a region-dispatch table.

## Sample rate caveats for $D418 digi

"$D418 digi" is the technique of generating pseudo-PCM audio by
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
  ~7,638 Hz on PAL and ~7,928 Hz on NTSC R8 — a 290 Hz / ~3.8%
  difference, audible as a pitch shift.

To play a sample at the same rate on both regions, scale the
timer value by the clock ratio:

```
timer_ntsc = timer_pal * (1022727 / 985248)
           = timer_pal * 1.03804
```

### 8580 vs 6581 digi

The 6581 SID has a known DC-coupling quirk in $D418 that makes
$D418 digi loud and clear. The 8580 SID fixes this DC quirk, which
makes $D418 digi much quieter (some tracks are barely audible on
an 8580). This is a chip-revision issue, not a region issue —
both 6581 and 8580 ship in both PAL and NTSC machines. C64Cs from
~1986 onward typically ship with 8580; earlier C64s ship with 6581.

## Detection at runtime

There is no register that returns "I am PAL" or "I am NTSC". Code
must detect the region by observation. Two methods are reliable.

### Method 1: Read $D012 + $D011 bit 7 at frame top

Wait for the raster to reach a known line in the top blanking
region (e.g., line 0), then read $D012 again on the next vertical
blank — the maximum raster line value tells you the region.

Maximum raster line value:
- PAL: 311 ($137 — i.e., $D012=$37 with $D011 bit 7=1)
- NTSC R8: 262 ($106 — $D012=$06 with $D011 bit 7=1)
- NTSC R56A: 261 ($105 — $D012=$05 with $D011 bit 7=1)

A self-modifying loop that walks $D012 until it wraps back to 0
and tracks the maximum seen value works on all three:

```
; Detect region by maximum raster line.
; On exit: A = 0 if PAL, A = 1 if NTSC R8, A = 2 if NTSC R56A.
; Trashes X.

detect_region:
    sei
    ; Wait for raster to reach line 0
wait_zero:
    lda $D011
    bmi wait_zero       ; wait for RST8=0
    lda $D012
    bne wait_zero       ; wait for $D012=0
    ; Now we're at line 0. Wait one full frame.
    ldx #0              ; X tracks high bit history
walk:
    lda $D011
    and #$80            ; isolate RST8
    cmp #$80
    bne not_high
    inx                 ; saw RST8=1 at least once
not_high:
    lda $D012
    ; loop until $D012=0 again with RST8=0
    bne walk
    lda $D011
    bmi walk            ; still in high region
    ; Now back at line 0. The highest line we saw was either
    ; $137 (PAL), $106 (NTSC R8), or $105 (R56A). The cleanest
    ; discriminator is to read $D012 one more time at the
    ; moment $D011 RST8 went from 1 -> 0 (that's the wrap).
    ; Simpler: read $D012 when RST8=1 just before wrap.
    ...
    cli
    rts
```

A simpler and more common approach is to time a frame:

```
; Time one frame in cycles using CIA timer B.
; Returns approx 19656 (PAL) or 17095 (NTSC R8) in $FB/$FC.
;
; Method: wait for raster line 0, start timer B counting down
; from $FFFF, wait for raster line 0 again, read timer B,
; subtract from $FFFF.

time_frame:
    sei
    lda #$7F
    sta $DC0D           ; mask all CIA #1 IRQ sources
    lda $DC0D           ; ack any pending
    ; Configure timer B as one-shot phi2 counter
    lda #$00
    sta $DC0F           ; stop timer B
    lda #$FF
    sta $DC06           ; timer A latch low (used as timer B input chain? no — use B directly)
    sta $DC07
    sta $DC06           ; timer B latch low
    sta $DC07           ; timer B latch high
    ; Wait for line 0
wait0a:
    lda $D011
    bmi wait0a
    lda $D012
    bne wait0a
    ; Start timer B counting down
    lda #$11            ; start, phi2 input, one-shot
    sta $DC0F
    ; Wait for next line 0
wait0b:
    lda $D012
    bne wait0b
    lda $D011
    bmi wait0b
    ; Stop and read timer B
    lda #$00
    sta $DC0F
    sec
    lda #$FF
    sbc $DC06
    sta $FB
    lda #$FF
    sbc $DC07
    sta $FC
    cli
    rts

; Caller: if $FC >= $48 -> PAL ($4CC6 ~= 19654)
;         else         -> NTSC
```

The threshold $4800 sits between 19,000 and 20,000, comfortably
between the NTSC R8 cycle count (17,095) and the PAL cycle count
(19,656).

### Method 2: Read $D012 wrap point

Wait for $D011 bit 7 to go high (i.e., raster line ≥ 256), then
poll $D012 until it stops counting up. The last value before wrap
is the discriminator:

- PAL: $D012 reaches $37 (55) then wraps -> max line 311
- NTSC R8: $D012 reaches $06 (6) then wraps -> max line 262
- NTSC R56A: $D012 reaches $05 (5) then wraps -> max line 261

Practical discriminator: read $D012 when $D011 bit 7 is 1. If
the value is ever $10 or higher, you're on PAL.

```
; Detect PAL vs NTSC by raster line wrap. Carry clear = NTSC,
; carry set = PAL.
detect_pal:
    sei
wait_hi:
    lda $D011
    bpl wait_hi         ; wait for RST8=1
    lda $D012
    cmp #$10            ; >= $10 means PAL (NTSC tops at $06/$05)
    bcs is_pal
    clc
    rts
is_pal:
    sec
    rts
```

This is the shortest reliable detect. It does not distinguish
R8 from R56A — for that, a longer frame-counting routine like
Method 1 is needed.

### Method 3: Check the KERNAL detect byte (some KERNALs only)

The C128 KERNAL stores a region flag at $D030 (read-only on the
C128, the value reflects 1MHz vs 2MHz CPU mode and is not a
region flag — do not use). Stock C64 KERNAL does not store a
region byte anywhere reliable. Some replacement KERNALs
(JiffyDOS, EasyFlash) do; those are not portable enough to
rely on.

**Recommendation:** Use Method 2 (read $D012 after RST8=1) for
simple PAL/NTSC distinction. Use Method 1 (frame timing) if
you need to distinguish R8 from R56A or want extra confidence.

## Region-portability checklist

When writing code intended to run on both regions, parameterize
the following:

- [ ] **CPU clock constant.** Define a symbol (e.g., `CPU_CLOCK`)
      and select it at startup based on detected region. Used by
      anything that converts seconds -> cycles.
- [ ] **SID frequency table.** Carry two tables. Select pointer
      at startup. Cost: ~192 bytes per table.
- [ ] **CIA timer values.** Any timer set to "once per frame" or
      "once per N frames" must be region-scaled. Hardcoding
      $4CC6 breaks NTSC; hardcoding $42C5 breaks PAL.
- [ ] **Music driver tick rate.** If the driver is authored at
      50 Hz tick rate, decide whether to (a) accept the 20% tempo
      jump on NTSC, (b) skip 1 frame in 6 on NTSC to approximate
      50 Hz, or (c) ship a re-tuned NTSC version of the music data.
- [ ] **Raster IRQ line numbers.** Most line numbers are
      region-independent because the display window is the same.
      But anything in the bottom blanking region (lines 252-311
      PAL / 252-262 NTSC) must be region-aware — those lines
      don't exist on NTSC.
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
- [ ] **Game speed.** Per-frame movement deltas must be
      adjusted by 17,095/19,656 = 0.870 ratio when moving from
      PAL authoring to NTSC. Many ported European games skip
      this and play 20% faster on U.S. machines (the famous
      "European games run too fast in the U.S." problem).
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
- **Sideborder open cycle counts**: PAL sideborder code with
  cycle 57-58 toggle does not work on NTSC R8 where the window
  is at cycle 58-59. Use a per-region dispatch. See
  [Border timing differences](#border-timing-differences).
- **CIA timer A frame timing**: Loading $4CC6 (PAL frame) on
  NTSC fires every 1.15 frames, producing slow scrolling and
  off-beat music. Always set the timer based on detected region.
- **$D012 raster wrap**: Comparing $D012 against >=256 requires
  combining with $D011 bit 7. The wrap point differs by region
  (312 PAL, 263 NTSC). See [c64-pitfalls.md](c64-pitfalls.md).
- **Digi pitch shift**: A fixed CIA timer produces different
  sample rates on PAL vs NTSC. For accurate cross-region digi,
  scale the timer or use a raster-IRQ-driven (per-line) digi.
- **Cross-region 6567R56A**: The R56A has 262 lines / 64 cycles
  rather than 263 / 65. R56A-targeted code must detect via
  frame timing (Method 1), not raster wrap (Method 2).
- **PAL-N / PAL-M misdetection**: Detection routines see these
  variants as PAL. That is the correct answer for CPU timing
  purposes; do not add code that tries to distinguish them
  unless you specifically care about colour sub-carrier.
- **Game-speed porting**: Ported games that skip the 17,095 /
  19,656 movement-delta adjustment play 20% too fast in the
  region they weren't authored in. This is a content issue,
  not a hardware issue, but it surfaces during region porting.
- **Visible Y range vs display window**: Setting $D011 bit 3
  (24 vs 25 rows) and bits 0-2 (vertical scroll) on NTSC can
  push the display below the visible area; values that look
  fine on PAL may clip on NTSC.

## Cross-references

- VIC-II chip register details: [vic-ii-reference.md](vic-ii-reference.md)
- SID chip register details: [sid-reference.md](sid-reference.md)
- CIA chip register details: [cia-reference.md](cia-reference.md)
- $D012 raster-wrap handling: [c64-pitfalls.md](c64-pitfalls.md)

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

<!-- doc-type: hardware-reference -->
