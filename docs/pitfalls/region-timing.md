---
category: region
---

<!-- doc-type: pitfall-reference -->

# Region Timing Pitfalls

All three pitfalls in this file stem from the same root: the C64 shipped in two
incompatible clock domains. PAL runs at 985,248 Hz with 312 raster lines per
frame; NTSC runs at 1,022,727 Hz with 263 lines per frame. Any hard-coded
assumption about frame rate, clock speed, or line count breaks when code crosses
regions. The fix in every case is to detect the region at boot — under 30 bytes
— and branch on it.

---

## pal_ntsc_tempo_mismatch — Music written for 50 Hz PAL plays 20% fast on 60 Hz NTSC

**Severity:** high
**Region:** both
**Triggered by techniques:** sid_play_routine_pattern, sid_voice_setup

### Symptom

Music that sounds correct on a PAL machine plays noticeably faster on NTSC —
the tempo is roughly 20% too high, giving ballads a frantic quality and
fast-paced tracks an unintended frenzy. The pitch of each note is correct (the
SID frequency registers produce slightly different Hz but the difference is a
fraction of a semitone); only the rhythm is wrong. On an NTSC machine running a
PAL-authored music driver, a track meant to run at 120 BPM plays at roughly 144
BPM.

The inverse problem — NTSC-authored music played on PAL — produces a tempo 17%
too slow. Energetic chiptunes become sluggish. This is rarer in practice because
most C64 music was authored in Europe on PAL machines.

### Mechanism

Tracker-based music drivers call a `play` subroutine once per video frame from a
raster or CIA IRQ handler. The play routine advances the tracker pattern by one
tick. The composer sets note durations in ticks, so the audible tempo is directly
proportional to the tick rate, which equals the frame rate.

PAL frame rate is 50.125 Hz (one frame every 19.95 ms). NTSC frame rate is
59.826 Hz (one frame every 16.71 ms). If the play routine fires once per frame
unconditionally, the NTSC tick rate is 59.826 / 50.125 = 1.194× the PAL rate —
a 19.4% tempo increase. Rounded to the nearest whole number, this is the "20%
too fast" figure that has followed European C64 ports to U.S. machines for
decades.

The problem is compounded by tempo subdivision: a speed value of N ticks per
note step scales the tempo by the same 20% ratio on NTSC.

### Fix

Two approaches cover all cases:

**Approach 1 — 5-of-6 frame skip on NTSC.** Call the play routine every frame
on PAL. On NTSC, call it every frame *except* every 6th frame (5 calls out of 6).
The effective NTSC tick rate becomes 59.826 × (5/6) = 49.855 Hz — within 0.54%
of the 50.125 Hz PAL rate. Tempo error drops from 19.4% to under 1%, which is
inaudible. Implement this with a single frame counter and a conditional skip:

```kick
// Region-detect at boot (Method 2 from pal-ntsc-reference.md).
// On exit: region_flag = 0 for PAL, 1 for NTSC.
detect_region:
    sei
wait_hi:
    lda $d011
    bpl wait_hi             // Wait for RST8 = 1 (raster >= 256)
    lda $d012
    cmp #$10                // PAL reaches >= $37 before wrap; NTSC tops at $06
    bcc is_ntsc
    lda #0
    sta region_flag
    bne done_detect
is_ntsc:
    lda #1
    sta region_flag
done_detect:
    cli
    rts

// Per-frame IRQ handler calling music play.
frame_irq:
    asl $d019               // Ack VIC raster IRQ
    lda region_flag
    beq call_play           // PAL: always call play
    // NTSC: skip every 6th frame.
    inc ntsc_frame_counter
    lda ntsc_frame_counter
    cmp #6
    bne call_play
    lda #0
    sta ntsc_frame_counter
    jmp skip_play           // Skip this frame's tick
call_play:
    jsr music_play
skip_play:
    rti

region_flag:        .byte 0
ntsc_frame_counter: .byte 0
```

**Approach 2 — Ship two tempo tables.** Some music drivers (GoatTracker,
SID-Wizard) support a per-region speed table embedded in the music data. The
driver reads the active table based on a region flag set at boot. This is the
cleanest solution when the music driver already has the infrastructure — no
frame-skipping artefacts, no timing drift. Approach 1 is preferable when
modifying the driver is not an option (e.g., a pre-built binary player).

**What not to do:** Do not adjust the CIA timer A reload to force a 50 Hz rate
on NTSC. The CIA controls the IRQ rate, not the VIC's frame rate; mismatching
them causes tearing and audio artefacts.

### Worked example

The full dispatcher in **Fix** above covers both detection and skipping. When
the region flag is set elsewhere at boot, reduce it to the skip logic alone:
check `region_flag`, increment a 0-5 counter, call `music_play` unless counter
just reached 6 (then reset it and return without calling play).

### Cross-references

- Technique: `sid_play_routine_pattern` — the canonical per-frame SID player
  structure that this pitfall affects.
- Technique: `sid_voice_setup` — voice envelope setup is unaffected by tempo
  mismatch, but pitch tables must also be region-adjusted (a separate concern;
  see pal-ntsc-reference.md SID frequency section).
- Technique: `pal_ntsc_detection` — the region-detect sub-technique used in
  the fix.
- Reference: `pal-ntsc-reference.md` — canonical clock rates, frame rates, and
  the music-tempo section.

---

## cia_timer_phi2_difference — CIA timers count φ2 cycles; 3.8% clock drift between PAL and NTSC

**Severity:** high
**Region:** both
**Triggered by registers:** DC04, DC05, DC06, DC07

### Symptom

A CIA timer calibrated for one second on PAL fires after 1.038 seconds on NTSC
(38 ms drift per second, accumulating without bound). A digi sample played via a
CIA-timed loop pitches 3.8% sharp on NTSC — well above the ~20-cent audibility
threshold. RS-232 via CIA2 is the most immediately obvious failure: wrong baud-
rate timer values cause framing errors on every byte, making the user port
non-functional.

### Mechanism

CIA timers (Timer A: $DC04/$DC05, Timer B: $DC06/$DC07 for CIA1; same offsets
at $DD04-$DD07 for CIA2) are 16-bit down-counters driven by the CPU's φ2 clock.
They count one tick per φ2 rising edge. φ2 is the CPU clock — the same signal
that clocks the 6510 through each instruction.

The φ2 clock frequency differs by region:

- **PAL:** 985,248.444 Hz (derived from 17.734475 MHz crystal ÷ 18)
- **NTSC R8:** 1,022,727.143 Hz (derived from 14.31818 MHz crystal ÷ 14)

The ratio is 1,022,727 / 985,248 = 1.03804. Any timer reload value calibrated on
PAL fires 3.8% too soon on NTSC, and vice versa.

For a 1-second interval on PAL, the reload value is 985,248 (0xF0960 — but CIA
timers are 16-bit, so the maximum interval is 65,536 cycles, i.e., 66.5 ms on
PAL or 64.1 ms on NTSC). Long intervals require a software counter to chain
multiple timer underflows. Each hardware underflow fires 64.1 ms apart on NTSC
vs 66.5 ms on PAL — a 2.4 ms difference per underflow that accumulates linearly.

Common affected uses: 1-second countdown timers (38 ms drift per second,
visible in under 10 seconds), CIA-driven music ticks (same 20% tempo jump as
the frame-rate pitfall above), $D418 digi via CIA (3.8% pitch shift — ≈ 63
cents, clearly audible), and RS-232 baud-rate timers (wrong baud fails
immediately with framing errors on every byte).

The pal-ntsc-reference.md CIA timer section gives the per-frame timer values:
PAL $4CC6 (19,654), NTSC R8 $42C5 (17,093).

### Fix

Detect the region at boot and apply the appropriate reload constant. Provide
both constants as named symbols and branch on the region flag:

```kick
// CIA1 Timer A configured for once-per-frame, region-adaptive.
// Must be called after detect_region (sets region_flag).

.const CIA1_TA_LO = $DC04
.const CIA1_TA_HI = $DC05
.const CIA1_CRA   = $DC0E

// Timer A latch values for once-per-frame IRQ.
// PAL:  19,654 cycles = $4CC6. Timer fires after $4CC6+1 = 19,655 cycles.
// NTSC: 17,093 cycles = $42C5. Timer fires after $42C5+1 = 17,094 cycles.
.const PAL_FRAME_LATCH_LO  = $C6
.const PAL_FRAME_LATCH_HI  = $4C
.const NTSC_FRAME_LATCH_LO = $C5
.const NTSC_FRAME_LATCH_HI = $42

setup_frame_timer:
    lda region_flag
    bne setup_ntsc

setup_pal:
    lda #PAL_FRAME_LATCH_LO
    sta CIA1_TA_LO
    lda #PAL_FRAME_LATCH_HI
    sta CIA1_TA_HI
    bne timer_go            // Always taken

setup_ntsc:
    lda #NTSC_FRAME_LATCH_LO
    sta CIA1_TA_LO
    lda #NTSC_FRAME_LATCH_HI
    sta CIA1_TA_HI

timer_go:
    // Enable Timer A IRQ (bit 0), start timer in continuous mode (bit 0 of CRA).
    lda #$81
    sta $DC0D               // Enable Timer A IRQ source
    lda #$11                // Start, phi2 input, continuous
    sta CIA1_CRA
    cli
    rts
```

For arbitrary intervals, compute: `reload = round(interval_sec * cpu_hz) - 1`.
For digi or RS-232 timers: `timer_ntsc = round(timer_pal * 1.03804)`.
Custom RS-232 code that bypasses the KERNAL must apply the same ratio — the
KERNAL handles its own baud-rate constants, but custom code does not inherit
those corrections.

### Worked example

```kick
// BAD: hard-coded PAL latch value used on both regions.
// On NTSC, timer fires after 19,655 phi2 cycles.
// NTSC phi2 = 1,022,727 Hz, so interval = 19655 / 1022727 = 19.22 ms.
// PAL frame = 19.95 ms. Delta = 0.73 ms per frame — visible in seconds.
    lda #$C6
    sta $DC04               // $4CC6 = PAL frame latch (WRONG on NTSC)
    lda #$4C
    sta $DC05

// GOOD: region-conditional latch selection.
    lda region_flag
    bne +
    lda #$C6                // PAL lo
    sta $DC04
    lda #$4C                // PAL hi
    sta $DC05
    beq ++
+   lda #$C5                // NTSC lo
    sta $DC04
    lda #$42                // NTSC hi
    sta $DC05
++  // timer latch is now correct for both regions

// For CIA2 (DD04/DD05/DD06/DD07): identical arithmetic, different addresses.
// The 3.8% drift applies equally to CIA2 because both chips are clocked
// from the same phi2 source.
```

### Cross-references

- Registers: `DC04`, `DC05` (CIA1 Timer A latch/counter), `DC06`, `DC07`
  (CIA1 Timer B latch/counter). CIA2 equivalents at `DD04`, `DD05`, `DD06`,
  `DD07` — same arithmetic, different base address.
- Reference: `pal-ntsc-reference.md` CIA timer values table — canonical latch
  constants for PAL ($4CC6) and NTSC R8 ($42C5).
- Pitfall: `pal_ntsc_tempo_mismatch` — the music-tempo problem; closely
  related when a CIA timer drives the music tick instead of the VIC raster IRQ.

---

## raster_line_count_difference — PAL has 312 lines per frame; NTSC has 263; loops that hard-code 312 break

**Severity:** medium
**Region:** both
**Triggered by registers:** D012, D011
**Triggered by techniques:** stable_raster_irq

### Symptom

A raster table loop that walks through IRQ entries for lines 0-311 appears to
work on PAL. On NTSC the same loop reaches line 263 and then either:

- **Fires at the wrong line** — $D012 wraps at line 263 on NTSC. A hard-coded
  target of line 280 becomes target 280 - 263 = 17 (with RST8 clear) — firing
  during the top border instead of the expected bottom area.
- **Never fires** — if the code sets $D012 = 280 without clearing RST8, the
  VIC sees line 280 + 256 = 536, which never occurs on NTSC. The IRQ chain
  halts and the screen freezes.
- **Fires twice per frame** — a target at line 250 is inside the valid range on
  both PAL (250 < 312) and NTSC (250 < 263), but a loop that then increments to
  line 264 wraps to line 1 on NTSC. An IRQ chain that should have terminated at
  "bottom of frame" keeps chaining through the invisible lines and fires again
  inside the next frame's visible area.

More subtly: PAL has 64 post-display blanking lines (248-311); NTSC has only 15
(248-262). A sprite multiplexer that updates Y positions during the blanking area
has enough cycles on PAL; on NTSC it runs into the next frame's visible area.

### Mechanism

The VIC-II's internal raster counter is 9 bits wide (0-511, though not all
values are used). $D012 holds the low 8 bits of the current counter value; bit 7
of $D011 (RST8) holds the 9th bit. The counter increments once per scanline and
wraps at the frame boundary.

The wrap point is chip-specific:

| Chip | Lines/frame | $D012 at wrap |
|---|---|---|
| 6569 (PAL) | 312 | $37 (55) |
| 6567R8 (NTSC) | 263 | $06 (6) |
| 6567R56A (rare) | 262 | $05 (5) |

Code that hard-codes the line count fails in two ways:

1. **Table sized for 312 entries.** A raster effect that allocates one byte per
   raster line and walks the whole table runs off the end of the usable NTSC
   range. Entries for lines 263-311 are NTSC dead zones — those raster lines do
   not exist. The table-walker runs past valid data.

2. **IRQ target lines above 262.** Any line number above 262 is outside the
   NTSC frame. Writing such a value to $D012 with the appropriate RST8 state
   creates a compare that the NTSC VIC never reaches. The IRQ chain stalls. The
   program hangs or loses its raster chain permanently.

PAL has 64 lines in the post-display blanking region (248-311). NTSC has 15
(248-262). The practical consequence: NTSC blanking-region work must complete in
15 × 65 = 975 cycles vs PAL's 64 × 63 = 4,032 cycles — a 4× cycle-budget
reduction that makes some PAL effects impossible on NTSC without redesign.

### Fix

Two strategies:

**Strategy 1 — Clamp line targets to the safe range.** The "safe" raster
lines that exist on both PAL and NTSC are 0-262. Schedule all raster IRQs and
table-driven effects within this range. Accept that the bottom blanking area for
NTSC-targeted code is only 15 lines (248-262) rather than 64 lines.

**Strategy 2 — Region-conditional line tables.** Maintain two versions of any
raster-table structure — one parameterized for PAL (lines 0-311) and one for
NTSC (lines 0-262). Select the active table at boot based on the detected region.
This is the pattern used by production demos that target both regions.

The region-detect reads $D011 bit 7 (RST8) when high, then checks $D012
against $10: PAL reaches $37 before wrap; NTSC tops at $06. The full snippet
is in `pal-ntsc-reference.md` — Method 2, under 20 bytes.

```kick
// BROKEN: raster table loop hard-coded for 312 lines.
// On NTSC, entries for lines 263-311 don't exist — IRQs misfire or stall.
.const NUM_LINES_PAL = 312
setup_irq_table:
    ldx #0
loop_irq:
    lda raster_targets,x
    sta $d012
    // ... install handler ...
    inx
    cpx #NUM_LINES_PAL      // Hard-coded 312 — WRONG on NTSC
    bne loop_irq
    rts

// FIXED: cap the loop at num_lines_active, set at boot.
// For NTSC: 263 entries max. For PAL: 312.
setup_irq_table_fixed:
    ldx #0
loop_irq_fixed:
    cpx num_lines_active    // Region-adjusted at boot
    beq done_loop
    lda raster_targets,x
    cmp num_lines_active    // Skip any target that exceeds the frame
    bcs skip_entry
    sta $d012
    // ... install handler ...
skip_entry:
    inx
    bne loop_irq_fixed
done_loop:
    rts

num_lines_active: .byte 0  // 0 = needs init; set to 56 (low byte of 312) PAL, 7 (263) NTSC
```

For most effects the simplest fix is to cap all IRQ line targets at 262 and
avoid scheduling work in the PAL-only blanking region (lines 263-311). This
sacrifices 49 lines of blanking-region CPU time on PAL but produces code that
works unmodified on both regions.

### Worked example

```kick
// Scenario: raster bar effect that colors every other scanline
// from line 50 to line 250, then resets at the start of each frame.
// The reset IRQ is placed at line 280 — inside PAL blanking, outside NTSC frame.

// BAD: reset IRQ targets line 280.
// On PAL: fires in blanking area — works.
// On NTSC: line 280 doesn't exist. IRQ fires at 280 - 263 = 17 (mod 263)
//          during next frame's top border — corrupts the display.
irq_reset_bad:
    asl $d019
    lda $d011
    and #%01111111          // Clear RST8
    sta $d011
    lda #<280               // $18 — RST8 must be set for 280, but it's cleared above
    sta $d012               // Target = line 24 on NTSC (RST8 clear), not 280
    lda #<irq_color
    sta $0314
    lda #>irq_color
    sta $0315
    rti

// GOOD: reset IRQ targets line 255 (safe on both PAL and NTSC).
// Both regions have raster lines 0-254 inside the active / border area.
irq_reset_good:
    asl $d019
    lda $d011
    and #%01111111          // Clear RST8 (line 255 < 256, RST8 not needed)
    sta $d011
    lda #255
    sta $d012               // Line 255 exists on both PAL (< 312) and NTSC (< 263)
    lda #<irq_color
    sta $0314
    lda #>irq_color
    sta $0315
    rti

// When you need region-specific blanking lines, select at runtime:
irq_reset_region_aware:
    asl $d019
    lda region_flag
    bne +
    // PAL: line 280 (inside 64-line blanking area)
    lda $d011
    ora #%10000000          // Set RST8 — line 280 >= 256
    sta $d011
    lda #<280
    sta $d012
    beq done_reset_irq
+   // NTSC: line 253 (inside 15-line blanking area)
    lda $d011
    and #%01111111          // Clear RST8
    sta $d011
    lda #253
    sta $d012
done_reset_irq:
    lda #<irq_color
    sta $0314
    lda #>irq_color
    sta $0315
    rti
```

### Cross-references

- Technique: `stable_raster_irq` — the double-IRQ pattern that this pitfall
  affects; the technique's NTSC notes discuss the narrower blanking window.
- Registers: `D012` (RASTER — low 8 bits of raster counter and compare
  target), `D011` (SCROLY — bit 7 is RST8, the 9th raster bit).
- Reference: `pal-ntsc-reference.md` — quick-reference table for lines per
  frame, $D012 wrap values, and the post-display blanking line counts.
- Pitfall: `d012_wrap_around` — the complementary pitfall about RST8 and the
  9-bit raster counter; the two pitfalls often co-occur.
