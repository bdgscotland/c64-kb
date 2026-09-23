---
category: region
---

<!-- doc-type: pitfall-reference -->

# Region Timing Pitfalls

All three pitfalls in this file stem from the same root: the C64 shipped in two
incompatible clock domains. PAL runs at 985,248 Hz with 312 raster lines per
frame; NTSC runs at 1,022,727 Hz with 263 lines per frame. Any hard-coded
assumption about frame rate, clock speed, or line count breaks when code crosses
regions. The fix in every case is to detect the region at boot — 36 bytes of
6502 and just over one frame of waiting at worst, usually much less — and
branch on it.

---

## pal_ntsc_tempo_mismatch — Music written for 50 Hz PAL plays 20% fast on 60 Hz NTSC

**Severity:** high
**Region:** both
**Triggered by techniques:** sid_play_routine_pattern, sid_voice_setup, frame_sync_loop, sfx_engine_beside_music, colour_fade, colour_cycling, screen_wipe, logic_rate_decoupling, difficulty_ramp_tables, falling_block_rules, ghost_target_tile_ai, cave_scan_engine, jump_arc_table
**Mitigated by techniques:** pal_ntsc_detection

### Symptom

Music that sounds correct on a PAL machine plays noticeably faster on NTSC —
the tempo is roughly 20% too high, giving ballads a frantic quality and
fast-paced tracks an unintended frenzy. The pitch of each note is correct (the
SID frequency registers produce slightly different Hz but the difference is a
fraction of a semitone); only the rhythm is wrong. On an NTSC machine running a
PAL-authored music driver, a track meant to run at 120 BPM plays at roughly 144
BPM.

The inverse problem — NTSC-authored music played on PAL — produces a tempo about
16% too slow (50.125 / 59.826 = 0.838, the inverse of the 19.4% below; an
earlier version said 17%). Energetic chiptunes become sluggish. This is rarer in practice because
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
// Region-detect at boot (Method 2 from pal-ntsc-reference.md; technique
// pal_ntsc_detection). On exit: region_flag = 0 for PAL, 1 for NTSC.
detect_region:
    sei
wait_lo:
    bit $d011
    bmi wait_lo             // If already inside the RST8 band, let it finish
wait_hi:
    bit $d011
    bpl wait_hi             // RST8 rises: raster line 256 on every chip
track:
    lda $d012               // Sample the low byte...
    bit $d011
    bpl band_over           // ...kept only if RST8 was still set
    tax
    jmp track
band_over:
    lda #0                  // Last line seen: PAL $37, NTSC $06 or $05
    cpx #$10
    bcs set_flag            // $10 or more exists only on PAL: flag 0
    lda #1                  // Below $10: NTSC, flag 1
set_flag:
    sta region_flag
    cli
    rts

// Per-frame IRQ handler calling music play. Installed at $0314, so the
// KERNAL dispatcher at $FF48 has already pushed A, X, Y; the handler exits
// through $EA81 (PLA/TAY/PLA/TAX/PLA/RTI), which pops them. Use $EA31
// instead if the KERNAL's jiffy clock and keyboard scan are wanted.
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
    jmp $ea81               // Not rti: the dispatcher's A, X, Y are still on the stack

region_flag:        .byte 0
ntsc_frame_counter: .byte 0
```

**Correction (2026-09-22).** `frame_irq` used to end in a bare `rti`. From a
`$0314` handler that pops the dispatcher's saved Y, X and A as P, PCL and
PCH, so the first interrupt returns to whatever address the interrupted
code's A:X happened to form (measured in VICE x64sc 3.10: the verbatim
listing warm-starts on the first frame; with A:X pointed at a label,
execution lands on that label). It is not a 3-byte-per-frame stack leak.
The same change applies to the three `irq_reset_*` handlers in the third
pitfall below, which also write `$0314`.

**Correction (2026-09-21).** The `detect_region` above replaces one that had
two faults. It read `$D012` once, immediately after RST8 rose — that read is
line 256, the first line of the band, and returns `$00` on every chip, so
its `cmp #$10` always failed. And its PAL path ran `lda #0` / `sta
region_flag` / `bne done_detect`: `lda #0` sets Z, so the `bne` never
branched and execution fell through into `is_ntsc`, leaving `region_flag`
at 1 whichever way the compare had gone. Measured in VICE x64sc 3.10: the old
fragment, unchanged, in a wrapper that paints `region_flag` to the border,
reported NTSC on the default PAL model both when entered from raster line 100
and when entered from line 288 — inside the band, where the single read was
`$20` and the compare passed, which isolates the second fault. The fragment
above reported PAL when entered from lines 100, 300 and 311 on the PAL model,
and NTSC when entered from lines 100 and 262 with `-model ntsc` and from 100
with `-model oldntsc`.

**Approach 2 — Ship two tempo tables.** Some music drivers (GoatTracker,
SID-Wizard) support a per-region speed table embedded in the music data. The
driver reads the active table based on a region flag set at boot. This is the
cleanest solution when the music driver already has the infrastructure — no
frame-skipping artefacts, no timing drift. Approach 1 is preferable when
modifying the driver is not an option (e.g., a pre-built binary player).

**A 50 Hz CIA tick is a valid third approach for the music alone.** Set CIA1
Timer A to one tick per 20 ms of the *local* φ2 clock — latch $4FE5 (20,454
cycles) on NTSC R8, $4CE5 (19,686) on PAL — and call the play routine from its
IRQ; CIA-timed and multi-speed tunes already run this way (see music-sid.md,
`sid_play_routine_pattern` Variations). Measured in VICE x64sc 3.10: on the
NTSC model that latch fired 251 times in 300 frames (300 × 17,095 / 20,454 =
250.7), a 50.0 Hz tick, so the tempo is correct without frame-skipping. Two
costs come with it. The latch must be region-corrected — the same NTSC latch
on PAL fired 289 times in 300 frames, 3.8% slow (see
`cia_timer_phi2_difference` below) — and the IRQ is not locked to the frame:
across those 300 frames it entered on every raster line ($D012 min 0, max
255), so any screen update placed in the same handler lands mid-frame and
drifts against the display, and a long play routine in it can delay a raster
IRQ it collides with. Keep the music IRQ to the play call, or re-enable IRQs
around it, and do screen work from the raster IRQ. **What not to do** is run
one per-frame latch or one per-frame raster tick unchanged on both regions.
An earlier version of this paragraph forbade a 50 Hz CIA tick on NTSC and
claimed it caused tearing and audio artefacts; a music tick does not draw,
and no instrument or independent page supported the claim.

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
**Triggered by techniques:** frame_sync_loop, pwm_digi, difficulty_ramp_tables, digi_4bit
**Mitigated by techniques:** pal_ntsc_detection

### Symptom

A CIA timer calibrated for one second on PAL fires after 0.963 s on NTSC
(985,248 counts at 1,022,727 Hz — about 37 ms early per intended second; a
PAL-calibrated software clock reads 1.038 s after one real NTSC second, and
the error accumulates without bound; an earlier version had the direction
backwards, "fires after 1.038 seconds"). A digi sample played via a
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

- **PAL:** 985,248.444 Hz (derived from 17.734472 MHz crystal ÷ 18; an earlier
  version paired this quotient with a 17.734475 MHz crystal, which gives
  985,248.61 Hz)
- **NTSC R8:** 1,022,727.143 Hz (derived from 14.31818 MHz crystal ÷ 14)

The ratio is 1,022,727 / 985,248 = 1.03804. Any timer reload value calibrated on
PAL fires 3.8% too soon on NTSC, and vice versa.

For a 1-second interval on PAL, the reload value is 985,248 ($F08A0, not the
$F0960 an earlier version gave — but CIA
timers are 16-bit, so the maximum interval is 65,536 cycles, i.e., 66.5 ms on
PAL or 64.1 ms on NTSC). Long intervals require a software counter to chain
multiple timer underflows. Each hardware underflow fires 64.1 ms apart on NTSC
vs 66.5 ms on PAL — a 2.4 ms difference per underflow that accumulates linearly.

Common affected uses: 1-second countdown timers (about 37 ms short per second,
visible in under 10 seconds), CIA-driven music ticks (3.8% fast, not 20%: a
CIA tick is insulated from the frame-rate difference but not from the φ2
clock difference; measured in VICE x64sc 3.10 as 217 CIA underflows of the
PAL latch $4CC6 per 250 NTSC frames versus 250 per 250 PAL frames — an
earlier version claimed the "same 20% tempo jump" as the frame-rate pitfall,
which only a per-frame latch set for the wrong region gives), $D418 digi via
CIA (3.8% pitch shift — ≈ 65 cents, clearly audible; 1200 × log2(1.03804) =
64.6, not the 63 given earlier), and RS-232 baud-rate timers (wrong baud
fails immediately with framing errors on every byte).

The pal-ntsc-reference.md CIA timer section gives the once-per-frame timer
latches: PAL $4CC7 (19,655) for a 19,656-cycle frame, NTSC R8 $42C6 (17,094)
for 17,095. Latch = cycles − 1, because a continuous timer with latch N
repeats every N + 1 cycles. An earlier version of this page gave $4CC6 /
$42C5 and attributed them to the reference; those are one cycle short of a
frame (63 × 312 = 19,656; 65 × 263 = 17,095) and the reference measured them
drifting one cycle per frame — in VICE x64sc a continuous $4CC7 timer holds
the same PAL raster line indefinitely while $4CC6 walks one raster line every
63 frames; $42C6 / $42C5 behave the same way on the 6567R8 (one line every 65
frames).

### Fix

Detect the region at boot and apply the appropriate reload constant. Provide
both constants as named symbols and branch on the region flag:

```kick
// CIA1 Timer A configured for once-per-frame, region-adaptive.
// Must be called after detect_region (sets region_flag).

.const CIA1_TA_LO = $DC04
.const CIA1_TA_HI = $DC05
.const CIA1_CRA   = $DC0E

// Timer A latch values for once-per-frame IRQ (latch = cycles - 1).
// PAL:  latch $4CC7 = 19,655. Timer fires after $4CC7+1 = 19,656 cycles = 63 x 312.
// NTSC: latch $42C6 = 17,094. Timer fires after $42C6+1 = 17,095 cycles = 65 x 263.
// (An earlier version used $4CC6 / $42C5, one cycle short of a frame.)
.const PAL_FRAME_LATCH_LO  = $C7
.const PAL_FRAME_LATCH_HI  = $4C
.const NTSC_FRAME_LATCH_LO = $C6
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
// On NTSC, timer fires after 19,656 phi2 cycles ($4CC7+1).
// NTSC phi2 = 1,022,727 Hz, so interval = 19656 / 1022727 = 19.22 ms.
// PAL frame = 19.95 ms. Delta = 0.73 ms per frame — visible in seconds.
    lda #$C7
    sta $DC04               // $4CC7 = PAL frame latch (WRONG on NTSC)
    lda #$4C
    sta $DC05

// GOOD: region-conditional latch selection.
    lda region_flag
    bne !+
    lda #$C7                // PAL lo
    sta $DC04
    lda #$4C                // PAL hi
    sta $DC05
    bne !++                 // Always taken: A = $4C, Z clear (same idiom as
                            // setup_frame_timer's bne timer_go); jmp also works
!:  lda #$C6                // NTSC lo
    sta $DC04
    lda #$42                // NTSC hi
    sta $DC05
!:  // timer latch is now correct for both regions

// For CIA2 (DD04/DD05/DD06/DD07): identical arithmetic, different addresses.
// The 3.8% drift applies equally to CIA2 because both chips are clocked
// from the same phi2 source.
```

**Correction (2026-09-22).** The GOOD block above used to leave the PAL path
with `beq !++`. `lda #$4C` clears Z, so that branch was never taken and the
PAL path fell straight through into the NTSC stores. Measured in VICE x64sc
3.10 on the PAL model: with the block assembled verbatim and `region_flag` =
0, stopping Timer A and force-loading the latch (`$DC0E` = $10) read
`$DC04`/`$DC05` = $C5/$42 — the NTSC value — and the same with
`region_flag` = 1. The same run confirmed that `setup_frame_timer`'s `bne
timer_go` is always taken (PAL gave $C6/$4C, NTSC $C5/$42, before the latch
constants themselves were corrected to $4CC7 / $42C6 as noted above).

### Cross-references

- Registers: `DC04`, `DC05` (CIA1 Timer A latch/counter), `DC06`, `DC07`
  (CIA1 Timer B latch/counter). CIA2 equivalents at `DD04`, `DD05`, `DD06`,
  `DD07` — same arithmetic, different base address.
- Reference: `pal-ntsc-reference.md` CIA timer values table — canonical
  once-per-frame latch constants for PAL ($4CC7) and NTSC R8 ($42C6), with
  the latch = cycles − 1 rule and the drift measurement for $4CC6.
- Pitfall: `pal_ntsc_tempo_mismatch` — the music-tempo problem; closely
  related when a CIA timer drives the music tick instead of the VIC raster IRQ.

---

## raster_line_count_difference — PAL has 312 lines per frame; NTSC has 263; loops that hard-code 312 break

**Severity:** medium
**Region:** both
**Triggered by registers:** D012, D011
**Triggered by techniques:** stable_raster_irq, frame_sync_loop, irq_chain_table, raster_split_modes, sideborder_open
**Mitigated by techniques:** pal_ntsc_detection

### Symptom

A raster table loop that walks through IRQ entries for lines 0-311 appears to
work on PAL. On NTSC the same loop reaches line 263 and then either:

- **Fires at the wrong line** — the raster compare is a 9-bit equality against
  the counter; nothing is reduced modulo the line count. A hard-coded target
  of 280 with RST8 clear is the low byte alone: 280 → $18 → line 24, inside
  the NTSC vertical blank / PAL top border (measured in VICE x64sc 3.10, both
  models: RST8 clear + $D012 = $18 fires at $D012 = $18 = 24) instead of the
  expected bottom area. An earlier version said the target "wraps" to 280 −
  263 = 17; the VIC does no such reduction.
- **Never fires** — if the code sets RST8 and $D012 = $18 (the 9-bit value
  280), the NTSC counter never reaches 280. The IRQ chain halts and the screen
  freezes. (280 cannot be written to $D012 at all; it is RST8 = 1 with low
  byte $18. An earlier version described this as "280 + 256 = 536".)
- **Stalls, or wraps on both chips** — a target at line 250 is inside the
  valid range on both PAL (250 < 312) and NTSC (250 < 263), but a chain that
  then steps to 264 behaves in one of two ways, neither of them "wrap to line
  1 on NTSC" as an earlier version said. A chain that sets RST8 for 264 stalls
  on NTSC (0 fires) and fires at 264 on PAL — a region difference. A chain
  that steps only $D012 and never sets RST8 arms $08 and fires at line 8 on
  BOTH chips (measured: RST8 clear + $08 → line 8 on PAL and NTSC); that is
  the 8-bit wrap covered by `d012_wrap_around`, not a region difference.

More subtly: PAL has 64 lines past the badline window (248-311, where no
badline can steal cycles: the window is $30-$F7); NTSC has only 15 (248-262).
A sprite multiplexer that updates Y positions in that range has enough cycles
on PAL; on NTSC it runs into the next frame's visible area. These lines are
not blanking, as an earlier version called them: on PAL, 248-250 are the last
three lines of the 25-row display window, 251-299 are visible lower border
and only 300-311 (12 lines) are in vertical blank; on NTSC all of 248-262 is
display or border and visible (NTSC vertical blank is 13-40). A $D020/$D021 or
sprite write in that range is visible in the border on both regions.

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

PAL has 64 lines past the badline window (248-311). NTSC has 15 (248-262).
The practical consequence: NTSC end-of-frame work must complete in 15 × 65 =
975 cycles vs PAL's 64 × 63 = 4,032 cycles — a 4× cycle-budget reduction that
makes some PAL effects impossible on NTSC without redesign. (Anchored on the
last badline, line 243, pal-ntsc-reference.md counts 68 and 19 lines after
it: 4,284 vs 1,235 cycles; the ratio is the same. Most of those lines are
visible border, not blanking — see the Symptom above.)

### Fix

Two strategies:

**Strategy 1 — Clamp line targets to the safe range.** The "safe" raster
lines that exist on both PAL and NTSC are 0-262. Schedule all raster IRQs and
table-driven effects within this range. Accept that the bottom-of-frame window
past the badlines for NTSC-targeted code is only 15 lines (248-262) rather
than 64 lines.

**Strategy 2 — Region-conditional line tables.** Maintain two versions of any
raster-table structure — one parameterized for PAL (lines 0-311) and one for
NTSC (lines 0-262). Select the active table at boot based on the detected region.
This is the pattern used by production demos that target both regions.

The region-detect waits for $D011 bit 7 (RST8) to clear and then set, keeps
the last $D012 seen while it stays set, and compares that value against $10
once it clears: PAL ends its frame at $37, NTSC at $06 or $05. The
three-way form is `detect_region` in `pal-ntsc-reference.md` (Method 1);
the flag-store form is `detect_region` in the first pitfall above (36 bytes).

```kick
// BROKEN: raster table loop hard-coded for 312 lines.
// On NTSC, entries for lines 263-311 don't exist — IRQs misfire or stall.
// Illustrative only: KickAssembler 5.25 assembles `cpx #312` as `cpx #$38`
// (the immediate is truncated to 8 bits, no error), and an 8-bit X cannot
// count to 312 anyway. The fault shown is the hard-coded constant.
.const NUM_LINES_PAL = 312
setup_irq_table:
    ldx #0
loop_irq:
    lda raster_lo,x
    sta $d012
    lda raster_hi,x         // 0 or 1: the 9th bit of the target
    lsr                     // ... into carry
    lda $d011
    and #%01111111
    bcc !+
    ora #%10000000          // Set RST8 for targets >= 256
!:  sta $d011
    // ... install handler ...
    inx
    cpx #NUM_LINES_PAL      // Hard-coded 312 — WRONG on NTSC (and truncated to $38)
    bne loop_irq
    rts

// FIXED: walk a table of NUM_ENTRIES 9-bit targets (two bytes each) and skip
// any entry at or above num_lines_active, a 16-bit line count set at boot.
.const NUM_ENTRIES = 8      // Table length (< 256) — not the frame's line count
setup_irq_table_fixed:
    ldx #0
loop_irq_fixed:
    cpx #NUM_ENTRIES
    beq done_loop
    // 16-bit compare: target (hi:lo) against num_lines_active; skip if >=.
    lda raster_hi,x
    cmp num_lines_active+1
    bcc install_entry       // hi below: target is in range
    bne skip_entry          // hi above: target is past the frame
    lda raster_lo,x
    cmp num_lines_active
    bcs skip_entry          // hi equal, lo at or above: past the frame
install_entry:
    lda raster_lo,x
    sta $d012
    lda raster_hi,x
    lsr                     // 9th bit into carry
    lda $d011
    and #%01111111
    bcc !+
    ora #%10000000          // Set RST8 for targets >= 256
!:  sta $d011
    // ... install handler ...
skip_entry:
    inx
    bne loop_irq_fixed
done_loop:
    rts

num_lines_active: .word 0   // set to 312 (PAL) or 263 (NTSC) at boot
raster_lo: .fill NUM_ENTRIES, <(50 + i * 30)   // example targets 50, 80, ... 260
raster_hi: .fill NUM_ENTRIES, >(50 + i * 30)
```

**Correction (2026-09-22).** An earlier FIXED listing kept `num_lines_active`
as one byte "set to 56 (low byte of 312) PAL, 7 (263) NTSC" and compared
8-bit targets against it. 312 & 255 = 56 and 263 & 255 = 7, so `cpx
num_lines_active` stopped the walk after 56 entries on PAL and 7 on NTSC, and
`cmp num_lines_active / bcs skip_entry` skipped every target at or above 56
(PAL) or 7 (NTSC) — nearly the whole frame. Neither listing installed RST8,
so a 9-bit target could not be armed. Both now carry two-byte targets, and
the FIXED one loops on the table length and compares 16 bits (arithmetic;
the truncation of `cpx #312` was confirmed by assembling it: `E0 38`).

For most effects the simplest fix is to cap all IRQ line targets at 262 and
avoid scheduling work in the PAL-only lines (263-311; visible lower border up
to 299, vertical blank from 300). This sacrifices 49 lines of end-of-frame CPU
time on PAL but produces code that works unmodified on both regions.

### Worked example

```kick
// Scenario: raster bar effect that colors every other scanline
// from line 50 to line 250, then resets at the start of each frame.
// The reset IRQ is placed at line 280 — PAL lower border, outside NTSC frame.
// All three handlers are installed at $0314 and exit via $EA81, which pops
// the A, X, Y that the KERNAL dispatcher at $FF48 pushed.

// BAD: reset IRQ targets line 280.
// On PAL: fires in the lower border — the line exists, so the chain runs;
//         any colour/sprite change there is visible.
// On NTSC: line 280 doesn't exist. With RST8 cleared as below the compare
//          is the low byte alone, $18 = line 24 (inside the NTSC vertical
//          blank) — the reset runs during the next frame's top and corrupts
//          the display. (The VIC does not reduce 280 modulo 263 to 17, as an
//          earlier comment said; measured in VICE x64sc 3.10, both models.)
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
    jmp $ea81

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
    jmp $ea81

// When you need region-specific end-of-frame lines, select at runtime:
irq_reset_region_aware:
    asl $d019
    lda region_flag
    bne !+
    // PAL: line 280 (lower border; 64 lines past the badline window)
    lda $d011
    ora #%10000000          // Set RST8 — line 280 >= 256
    sta $d011
    lda #<280
    sta $d012
    jmp done_reset_irq      // Not a conditional branch: <280 = $18 leaves Z clear
!:  // NTSC: line 253 (lower border; 15 lines past the badline window)
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
    jmp $ea81
```

**Correction (2026-09-22).** The PAL path of `irq_reset_region_aware` ended
`lda #<280` / `sta $d012` / `beq done_reset_irq`; `<280` is $18, so Z was
clear, the branch never taken, and the code fell through into the NTSC
branch — clearing RST8 and arming line 253. Measured in VICE x64sc 3.10 on
the PAL model with `region_flag` = 0: the next raster IRQ read $D012 = $FD,
$D011 = $1B; with the branch replaced by `jmp done_reset_irq` it read $D012 =
$18, $D011 = $9B (9-bit line 280). `jmp` rather than `bne` because `bne`
would only work while the low byte happens to be non-zero — a target of 256
or 512 would silently break it again, the same failure the `detect_region`
correction in the first pitfall records. All three handlers also ended in a
bare `rti`, which from a `$0314` handler pops the dispatcher's saved
registers as the return frame (see the `frame_irq` correction above); they
exit through `$EA81` now.

### Cross-references

- Technique: `stable_raster_irq` — the double-IRQ pattern this pitfall
  affects (its NTSC notes cover the per-line budget only; the narrower
  post-display window is in pal-ntsc-reference.md, Badline range).
- Registers: `D012` (RASTER — low 8 bits of raster counter and compare
  target), `D011` (SCROLY — bit 7 is RST8, the 9th raster bit).
- Reference: `pal-ntsc-reference.md` — quick-reference table for lines per
  frame and $D012 wrap values; its "Badline range" section gives the lines
  after the last badline (68 PAL, 19 NTSC R8) and its "Visible region"
  section the vertical blank (300-15 PAL, 13-40 NTSC). It does not give the
  "post-display blanking" counts an earlier version of this entry cited.
- Pitfall: `d012_wrap_around` — the complementary pitfall about RST8 and the
  9-bit raster counter; the two pitfalls often co-occur.

## Sources

- VICE 3.10, `x64sc`, models `default`, `ntsc`, `oldntsc` — the instrument
  behind every "measured" figure on this page (the `detect_region`
  correction and the entry-line runs; the 2026-09-22 corrections' latch
  reads, raster-compare targets, CIA tick counts and handler-exit runs).
  https://vice-emu.sourceforge.io/
- KickAssembler 5.25 — assembled every `kick` fragment here; the 36-byte
  count is its.
- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64", https://www.cebix.net/VIC-Article.txt —
  §3.2 (RST8 as bit 8 of the raster register), §3.4 (lines per frame for
  the 6569, 6567R8 and 6567R56A).
- This repository: `hardware/pal-ntsc-reference.md` (clock rates, frame
  rates, CIA latch table, Method 2), `techniques/raster.md`
  (`pal_ntsc_detection`, with the duration and race measurements).
