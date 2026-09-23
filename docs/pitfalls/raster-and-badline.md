---
category: raster
---

<!-- doc-type: pitfall-reference -->

# Raster and Badline Pitfalls

The pitfalls in this document share a common thread: they all stem from
the VIC-II's asynchronous relationship with the CPU. The chip runs on the same
clock but does not wait for the CPU to finish what it is doing. Badlines steal
cycles without warning. The raster compare register wraps silently at line 255.
Sprite DMA freezes the CPU mid-instruction. The stable-raster polling technique
(and its two-handler `double_irq` refinement) exists precisely because the
first IRQ you enable has unpredictable entry timing. Each pitfall below has
caused demo coders and game developers to lose hours to glitches that look random but are in fact completely deterministic once
you know the mechanism.

---

## badline_cycle_loss — Badline DMA steals 40-43 cycles from the CPU

**Severity:** critical
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq, sprite_multiplex_8, raster_bars, frame_sync_loop, double_irq, badline_synchronization, sideborder_open, fli_image, afli_image, ifli_image, soft_scroll_v, tile_map_render, dma_steal_avoidance, speedcode_generation, big_font_2x2, dycp_scroller, sine_table_generation, scroll_panel_split, sprite_multiplex_game, software_sprite_preshifted

### Symptom

The raster IRQ handler runs correctly during development, then silently breaks
every 8 lines. Color bars bleed across line boundaries. Sprite Y-position writes
arrive one scanline late. A tight per-line loop that works in isolation suddenly
takes 40 extra cycles at unpredictable intervals. The glitch looks like random
jitter but repeats at exactly 8-line intervals because the underlying cause is
perfectly periodic.

### Mechanism

A badline occurs on every raster line where `(raster_line & 7) == YSCROLL`,
where YSCROLL is the low 3 bits of $D011 (default value 3). With the default
YSCROLL, badlines fall at raster lines 51, 59, 67 ... 243 — 25 lines per frame
in both regions (the window $30-$F7 and the 25 character rows do not depend on
frame length; an earlier version of this entry said 24 on NTSC). On each
badline, the VIC-II must fetch the 40 screen code bytes for the character row
that begins on that line. The chip asserts the BA
(Bus Available) signal low 3 cycles before it needs the bus. The CPU, seeing BA
low, can still complete any instruction that has no remaining bus cycles, but
cannot issue new memory accesses. Three cycles later, the VIC takes the phi2
bus for 40 cycles of screen RAM fetch, then releases it.

The VIC takes the bus for 40 cycles (15-54) and pulls BA low three cycles
earlier, on cycle 12; the CPU can spend those three cycles only on write
cycles. So a PAL badline leaves 20 CPU cycles guaranteed (1-11 and 55-63) and
23 at best, not 23 flat. Any raster handler that assumes a fixed 63-cycle
budget per line will slip by 40 or 43 cycles on every badline it hits. Sprite
DMA is on top of that: each active sprite takes two bus cycles at the end of
the line (cycles 58-63 for sprites 0-2, 1-10 of the next line for 3-7), with BA
dropping at cycle 55, three cycles before the first (an earlier version of this
entry put sprites 0-2 at 55-62 and then counted the BA lead-in a second time),
so a badline with all eight sprites active leaves the CPU almost nothing — one
guaranteed cycle; see `vic_bus_takeover_on_dma` below for the measurement.

### Fix

Two approaches, often combined:

1. **Badline avoidance:** Schedule IRQ handlers to fire on non-bad lines. Given
   a fixed YSCROLL of 3, any line where `(target_line & 7) != 3` is safe. A
   status bar split at line 200 (200 & 7 = 0) is safe; at line 203 (203 & 7 = 3)
   it is not. Move the split by 1 line.

2. **DEN off for the whole frame:** the VIC latches DEN once, during raster
   line $30 (48); if it is clear then, no line of that frame is a badline and
   the display is blank. Clearing DEN later in the frame does *not* stop the
   remaining badlines — an earlier version of this entry said it did. Sprite
   DMA still occurs either way.

3. **YSCROLL steering for a region:** on each line of the region write $D011
   with YSCROLL set to a value the line number cannot match (for instance
   `(line + 4) & 7`, written early in the line). The badline condition is
   evaluated every cycle, so no line in the region becomes bad; the character
   display goes idle there (it shows the background colour). This is what
   `recipes/kickassembler/sideborder-open.md` does and measures. Elsewhere,
   rewrite YSCROLL only after the current line's window has passed (from
   cycle 55) so the write cannot create a badline on the line it lands in.

### Worked example

```kick
// BAD: handler fires on a line that may be a badline.
// On badline rows, the STA $D020 arrives ~40 cycles late,
// producing a color bleed into the next line.
irq_handler:
    lda #WHITE
    sta $d020           // May arrive 40 cycles late on badlines
    lda #(irq_handler >> 8)
    sta $0315
    lda #<irq_handler
    sta $0314
    asl $d019           // Ack VIC interrupt
    rti

// GOOD: keep the split off badline rows. With YSCROLL=3 a line is bad when
// (line & 7) == 3; arm the IRQ a line early and spin to the target so the
// colour write lands in the blank, and pick a target with (line & 7) != 3.
.const SPLIT = 200          // 200 & 7 = 0: not a badline
effect_irq:
    ldx #WHITE
    lda #SPLIT
!:  cmp $d012
    bne !-
    stx $d020               // cycle <= 15 of line SPLIT
    // ... other work ...
    asl $d019
    jmp $ea81

// For a whole region with no badlines at all (blank display, all 63 cycles):
// write YSCROLL = (line + 4) & 7 on every line of the region, as
// recipes/kickassembler/sideborder-open.md does. Clearing DEN mid-frame
// does NOT do this; DEN is sampled once, on line $30.
```

For code that must run on a potentially bad line (e.g., per-line raster bars),
subtract 43 from the available cycle count and ensure the handler body fits
within 20 cycles on PAL or 22 cycles on NTSC (23 and 25 only if the three
cycles after BA drops on cycle 12 happen to be write cycles).

### Cross-references

- Technique: `stable_raster_irq` — the polling stable-raster technique that
  this pitfall most visibly affects; the technique doc discusses badline avoidance in its
  cycle budget section.
- Technique: `sprite_multiplex_8` — active sprites add 2 cycles/sprite of DMA
  on top of the 40-43-cycle badline stall; together they take 62 of the 63
  cycles on such a line (see `vic_bus_takeover_on_dma` below).
- Technique: `badline_synchronization` — the raster.md technique covering the
  full badline accounting framework.
- Registers: `D011` (SCROLY — carries DEN bit and YSCROLL), `D012` (RASTER).

---

## d012_wrap_around — $D012 wraps at line 255; bit 7 of $D011 holds the 9th bit

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq, raster_bars, irq_chain_table, raster_split_modes, pal_ntsc_detection, frame_sync_loop, big_font_2x2, dycp_scroller, logic_rate_decoupling, sprite_multiplex_game

### Symptom

A raster IRQ set for line 260 (a valid PAL line in the lower border area) fires
at line 4 instead, because only the low byte was written and RST8 was clear. On
a freshly booted machine the sticky bit points the other way: the KERNAL's VIC
init writes $9B to $D011, so RST8 starts SET and a bare `sta $d012` with a low
target resolves to target+256 — that exists on PAL only for targets 0-55 (NTSC
0-6), so the IRQ usually never fires at all. In a handler chain that rewrites
only $D012, each handler inherits whatever RST8 the previous one left, so
alternate splits land 256 lines away, or the chain stalls on a target above the
last line and the frame rate appears to halve. (An earlier version of this
entry said a single stale write could fire twice per frame; it cannot — see
Mechanism.)

On NTSC the effect is more immediately visible: the frame is only 263 lines
(6567R8; 262 on the 6567R56A), so lines 256-262 are ordinary visible
bottom-border lines (the NTSC vertical blank is lines 13-40, per
`docs/hardware/pal-ntsc-reference.md`; an earlier version of this entry called
256-262 "vertical blank"), and any bottom-border effect crosses line 255 without
deliberately targeting high line numbers — a handler that chains forward by
setting `$D012 = next_line` forgets the 9th bit and wraps to `next_line - 256`.

### Mechanism

The VIC-II's internal raster counter is 9 bits wide. $D012 holds the low 8 bits
of the raster compare target. The 9th bit (the high bit) is bit 7 of $D011 —
the RST8 bit. When the compare target is 256 or higher, RST8 must be set. When
the compare target is 255 or lower, RST8 must be clear.

The failure mode is: code writes only `STA $D012` with the low byte of the
desired line, and never touches $D011 bit 7. On the first frame this works if
the target line is below 256. On a line at or above 256, the actual compare
target the VIC sees is `desired_line & 0xFF` with the 9th bit from whatever
$D011 bit 7 happens to be. If it is clear, the compare fires at line
`target - 256` instead of `target`. One IRQ fires per frame, at the wrong line
— the compare is a single 9-bit value, so it can never match two lines in one
frame. (An earlier version of this page said two IRQs fire per frame; measured
in VICE x64sc: RST8=0/$D012=4 gives exactly one IRQ per frame at line 4,
RST8=1/$D012=80 gives none, on both PAL and NTSC.) Two firings only occur when
a chain of handlers changes RST8 or $D012 between them.

The bit is also sticky: it remains set until explicitly cleared. Code that
handles both low and high lines must clear RST8 when switching to a target below
256, not just omit setting it.

### Fix

Always perform a read-modify-write on $D011 when setting or clearing RST8:

```kick
// Set the raster compare target to TARGET_LINE (may be >= 256).
.const TARGET_LINE = 260

set_irq_line:
    lda $d011
    .if (TARGET_LINE >= 256) {
        ora #%10000000      // Set RST8 (bit 7)
    } else {
        and #%01111111      // Clear RST8
    }
    sta $d011
    lda #<TARGET_LINE       // Low 8 bits
    sta $d012
```

In a dynamic context where the target line is a variable at runtime:

```kick
// runtime: .X = target line low byte, carry = 1 if line >= 256
set_irq_dynamic:
    lda $d011
    and #%01111111          // Clear RST8
    bcc !+                   // If target < 256, leave RST8 clear
    ora #%10000000          // Otherwise set RST8
!:  sta $d011
    stx $d012               // Write low 8 bits
```

### Worked example

```kick
// BAD: only writes $D012, assumes target < 256.
// On PAL line 260, $D012 = 4, RST8 = 0,
// so the IRQ fires at line 4 instead of 260.
    lda #<260               // $04
    sta $d012               // Compare target = line 4 (WRONG)

// GOOD: writes both RST8 and $D012.
    lda $d011
    ora #%10000000          // Set RST8 for line >= 256
    sta $d011
    lda #<260               // $04
    sta $d012               // Compare target = line 260 (correct)

// ALSO BAD: forgets to CLEAR RST8 when switching back to line 80.
// $D011 bit 7 is still set from the previous write above,
// so the compare target becomes 80 + 256 = 336 — which never fires on PAL.
    lda #80
    sta $d012               // Bug: RST8 still set, target = 336

// CORRECT:
    lda $d011
    and #%01111111          // Clear RST8 for line < 256
    sta $d011
    lda #80
    sta $d012
```

### Cross-references

- Technique: `stable_raster_irq` — the technique this pitfall most directly
  affects; the KickAssembler recipe keeps every target below 256 and writes
  RST8=0 once via `lda #$1b`; it does not exercise the >= 256 path.
- Registers: `D012` (RASTER — low 8 bits of raster counter and compare),
  `D011` (SCROLY — bit 7 is RST8, the 9th raster bit).

---

## raster_irq_first_line_jitter — First raster IRQ after enable has unpredictable entry timing

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq, irq_chain_table, phase_inverted_irq, frame_sync_loop, raster_split_modes
**Mitigated by techniques:** stable_raster_irq, double_irq

### Symptom

A raster effect that works perfectly after the first few frames is unstable on
the very first frame after IRQ enable. Color splits land 1-7 pixels to the right
on the first frame. A sprite multiplex update on the first frame puts sprites
one line too low. The symptom disappears by frame 2. Alternatively, a raster
effect coded without the stable-raster polling technique shows a permanent 0-7
cycle wobble that makes split lines look "fuzzy" — a 1-7 pixel horizontal smear
on every frame where the interrupted instruction happened to be long.

### Mechanism

The 6510 does not sample the /IRQ line between clock cycles — it samples it at
the end of each instruction. When the VIC-II asserts the IRQ line, the CPU
finishes whatever instruction it is currently executing, then begins the 7-cycle
interrupt entry sequence (two dummy cycles, push PCH, push PCL, push P, fetch
vector low, fetch vector high; the handler's first opcode fetch is its own first
cycle — an earlier version of this entry counted it inside the 7). The number
of cycles between the VIC asserting the line and the handler's first instruction executing depends on how many cycles
were left in the interrupted instruction. A 2-cycle `NOP` interrupted on its
last cycle adds 1 cycle of delay; a 6-cycle `STA ($zp,X)` interrupted on its
first cycle adds 5 cycles of delay. The total jitter window is 0-6 cycles for
common instructions (the 7-cycle `BRK` is a pathological case that adds up to
6 cycles, but is not found in normal runtime code).

On the very first frame after enabling IRQs (writing $D01A bit 0 = 1), the CPU
has no idea what instruction it will be executing when the first IRQ fires. The
jitter is random within the 0-6 cycle window. On subsequent frames, if the
main loop is a tight `JMP *` or a counted NOP sled, the interrupted instruction
is always the same (a 3-cycle `JMP`, leaving 0-2 cycles of jitter, or a 2-cycle
`NOP`, leaving 0-1 — an earlier version of this entry called `JMP *` a 2-cycle
branch; a taken same-page branch is itself 3 cycles), so the jitter narrows
— but it does not disappear. The polling loop bounds the jitter to one loop
iteration (0-8 cycles for the 9-cycle `LDA/CMP/BNE` form); the `double_irq`
variant then removes that residual before the cycle-tight register writes begin.
That is why `stable_raster_irq` is on both metadata lines above: the pitfall
is what a raster interrupt does before the technique is applied to it (the
naive form), and the technique's polling loop — with `double_irq` for the
last cycle — is the cure.

### Fix

Use the stable-raster technique (`stable_raster_irq`): the polling form below
bounds jitter to one loop iteration (0-8 cycles with the 9-cycle `LDA/CMP/BNE`
loop shown); for zero jitter use the two-handler `double_irq` form described in
the technique doc and in `recipes/kickassembler/stable-raster-irq.md`. The
polling pattern:

1. Enable raster IRQs with the IRQ line set to one line before the target line
   (line N-1).
2. In the IRQ handler for line N-1: acknowledge $D019, leave $D012 at N-1, and
   poll $D012 in a tight loop until the counter increments to N. (An earlier
   version of this entry said to set $D012 to N here; that re-arms the compare
   for a line the handler is still polling through, latches a second IRQ that
   is never acknowledged, and re-enters the handler straight after RTI — see the
   worked example.)
3. Once $D012 reads N, execute a counted NOP pad to place the writes at the
   desired cycle to within the loop's residual (the pad sets the mean position
   only).
4. Perform the cycle-tight register writes.

The polling loop at step 2 bounds whatever jitter existed on entry to the
handler. By the time the loop exits ($D012 has just incremented to N), every
subsequent instruction runs within one poll iteration of the start of line N.
The initial first-frame jitter is bounded the same way — the first handler
entry may be anywhere within line N-1, but the polling loop absorbs that and
exits within one poll iteration of the start of line N regardless — but not at
one fixed cycle: the exit cycle still depends on where in the iteration the
entry fell.

### Worked example

```kick
// Single-IRQ approach — JITTERY. The STA $D020 can land 0-6 cycles
// late depending on what instruction was running when the IRQ fired.
irq_jittery:
    lda #BLUE
    sta $d020               // Horizontal seam varies by 0-6 pixels
    asl $d019               // Ack
    rti

// Stable-raster polling approach — jitter bounded to one 9-cycle poll
// iteration, not zero. Measured in VICE x64sc 3.10: with a frame-locked main
// loop the exit phase kept the entry spread unchanged (two phases 4 cycles
// apart over 60 frames); with a 19-cycle main loop it took three phases
// spanning 5 cycles. Zero jitter needs double_irq.
// IRQ fires at line TARGET_LINE-1. It acks, leaves the compare where it is,
// then spins until $D012 increments to TARGET_LINE.
// An earlier version of this fragment wrote TARGET_LINE to $D012 before the
// poll; that fired a second compare during the poll, left $D019 latched, and
// re-entered the handler right after RTI (measured: ~2 main-loop iterations
// per frame). Leaving $D012 at TARGET_LINE-1 needs no second ack and no re-arm.
irq_stable_setup:
    asl $d019               // Ack IRQ for line TARGET_LINE-1
    // Poll until raster reaches TARGET_LINE.
    // Each loop iteration: LDA abs (4) + CMP imm (2) + BNE (3) = 9 cycles.
    // The loop exits within 0-8 cycles of the line start, bounding jitter.
!:  lda $d012
    cmp #TARGET_LINE
    bne !-
    // Now on line TARGET_LINE. Add NOP padding to reach the desired cycle
    // (to within the loop's residual).
    nop                     // 2 cycles — tune count for the mean cycle target
    nop
    // Effect code lands here within one poll iteration of the line start.
    lda #RED
    sta $d020               // Lands within one poll iteration of the line
                            // start; use double_irq for a fixed cycle
    rti
```

The key insight: the `LDA $D012 / CMP / BNE` loop quantises the jitter window
to its own 9-cycle period; it does not remove it (an earlier version of this
entry said the loop "consumes" the jitter and the writes land at a fixed cycle;
measured in VICE x64sc, the exit phase spread equalled the entry spread). The
exit of the loop always happens within one loop iteration (9 cycles) of the
raster line's start. NOP pads after the loop bring the writes to the desired
cycle to within that residual. The first-frame case is no different: the
polling loop bounds any entry-time jitter, including the variable amount from
the random interrupted instruction on frame 1.

For single-cycle precision, the `double_irq` technique fires two consecutive
IRQs on lines N-1 and N, where the second IRQ's entry timing is constrained by
the known instruction in the main loop between the two handlers (typically a
2-cycle NOP), eliminating even the 0-8 cycle polling-loop residual. "Lines N-1
and N" holds with the KERNAL out; through $0314 the first handler arms the
second IRQ two lines down (see the technique doc and the recipe's "The double
IRQ").

### Cross-references

- Technique: `stable_raster_irq` — the complete description of the polling
  stable-raster pattern, including the NOP-pad sizing and the `double_irq`
  variant for single-cycle work.
- Technique: `double_irq` — scene-tier zero-jitter extension of stable_raster_irq.
- Registers: `D019` (VICIRQ — interrupt flag register; must be acked before
  RTI), `D012` (RASTER — the register being polled), `D011` (SCROLY — RST8 bit
  for targets >= 256).

---

## vic_bus_takeover_on_dma — VIC sprite DMA freezes the CPU for 5-19 cycles per scanline

**Severity:** medium
**Region:** both
**Triggered by registers:** D015
**Triggered by techniques:** sprite_multiplex_8, dma_steal_avoidance, sideborder_open, sprite_multiplex_24, sprite_sine_chain, badline_synchronization, sprite_multiplex_game

### Symptom

A raster IRQ that runs cleanly with no sprites enabled suddenly slips its timing
when sprites are turned on. The slip is not random — it is proportional to the
number of sprites active on the scanline where the IRQ handler runs. With 8
sprites active on the handler's line, the CPU appears to freeze for approximately
19 cycles mid-instruction, then resume. Register writes that were cycle-tight
arrive late. In extreme cases, the handler misses its intended scanline
entirely and writes land on the line below.

### Mechanism

For each sprite enabled in $D015, the VIC-II must fetch 3 bytes of sprite pixel
data (s-accesses) on every raster line covered by that sprite's 21 pixel rows.
The chip claims the bus for these fetches during specific cycles of the scanline.
Before the s-accesses begin, the VIC also issues 2 p-access cycles (pointer
fetches) for each active sprite. Not all of these accesses cost the CPU: the
p-access and one of the three s-accesses are phi1 accesses, the VIC's own bus
phase; only the two phi2 s-accesses take CPU bus cycles, which is why the cost
is two cycles per sprite and not three or five. (An earlier version of this
entry said all of them happen during phi2.)

The exact stall per sprite, per DMA scanline (an earlier version of this entry
charged 2 cycles of p-access on the first line plus 3 of s-access per line, and
its sums did not add up — 3 + 2 + 16 is 21, not 19):
- **0 cycles** for the p-access: it happens on every raster line for every
  sprite regardless of enable state, in phi1, and costs the CPU nothing.
- **2 bus cycles** of s-access per sprite on every line of its 21 DMA lines.
- **3 cycles of BA lead-in** per contiguous group of sprite slots, during which
  the CPU can only complete write cycles.

Measured in VICE x64sc 3.10 with an all-read loop timed by CIA1 between raster
lines 100 and 200, DEN off, sprites at Y=150 (21 DMA lines): 105/147/231/399
cycles stolen over the 21 lines of 1/2/4/8 sprites (= 21 × 5, 7, 11, 19), and
210 for sprites 0 and 7 as two BA groups (21 × 10). The 3 lead-in cycles per
group being write-usable is from the VIC-II reference and Bauer's model, not
measured here. Sprite DMA and badline costs simply add: 8 sprites plus 5
badlines over lines 140-180 measured 614 = 399 + 5 × 43.

With all 8 sprites enabled and active on a single line, the VIC steals 3 cycles
of BA + 8 × 2 s-access = 19 cycles from the CPU on that line. On PAL, this
reduces the effective CPU budget from 63 cycles to 44 cycles. On NTSC, from 65
cycles to 46 cycles.

The CPU cannot choose when the stall happens — it is determined by the VIC's
internal DMA schedule, which runs on fixed cycle slots within each line. If an
instruction spans a DMA window, the CPU stalls mid-instruction and resumes when
the VIC releases the bus. The instruction completes correctly but takes more wall
clock cycles than its documented cycle count.

### Fix

Account for sprite DMA in the cycle budget wherever sprites are active on the
IRQ handler's scanline:

| Active sprites on handler line (one contiguous group) | Cycles stolen | Usable cycles PAL | Usable cycles NTSC |
|---:|---:|---:|---:|
| 0 | 0 | 63 | 65 |
| 1 | 5 | 58 | 60 |
| 2 | 7 | 56 | 58 |
| 4 | 11 | 52 | 54 |
| 8 | 19 | 44 | 46 |

(Measured in VICE x64sc: 2 per sprite plus 3 lead-in per group. An earlier
version of this table gave 2/5/9 for 1/2/4 sprites, under-budgeting by 3 cycles
each; sprites in separate groups pay the lead-in once per group.)

Strategies:

1. **Fire the handler on a line where no sprites are active.** If sprites are
   enabled for display rows 50-100 and the raster handler must run on line 95,
   check whether all 8 sprites are active there. If they are, move the handler
   to line 101 (below the sprite zone) if the effect permits.

2. **Account for DMA in cycle-counted code.** Add the DMA stall cycles to the
   cycle count for any instruction that may execute during the DMA window. Use
   VICE's cycle counter to measure actual cycle consumption rather than the
   documented cycle count.

3. **Disable sprites in the effect zone.** Write $D015 = $00 above the effect
   line to disable all sprites; restore after the effect section. This is
   compatible with sprite multiplexing: the multiplexer can disable sprites it
   is not currently showing.

4. **Use the sprite DMA window deliberately.** Some advanced techniques
   (sprite-crunch, sprite stretching) exploit the DMA cycle slots. Out of scope
   here, but the point is the DMA slots are fixed and therefore predictable.

### Worked example

```kick
// WRONG: assumes 63 available cycles on a line where 8 sprites are active.
// The handler body takes 54 cycles as written (8 colour writes), but sprite
// DMA steals 19, so total wall-clock consumption is 73 cycles — bleeds into
// the next line. (An earlier version of this example counted a LDA #imm /
// STA abs pair as 3 or 4 cycles; it is 2 + 4 = 6.)
sprite_irq_buggy:
    asl $d019               // 6 cycles (read-modify-write)
    lda #BLUE               // 2 cycles
    sta $d020               // 4 cycles — color write 1 (pair = 6)
    lda #RED
    sta $d021               // pair = 6 — color write 2
    lda #GREEN
    sta $d022               // pair = 6 — color write 3
    // ... 5 more store pairs = 30 more cycles ...
    // Total: 54 coded cycles + 19 DMA = 73 actual cycles (OVERFLOW)
    rti

// CORRECT: handler is scheduled on a line where 0 sprites are active,
// OR the handler body is trimmed to fit within 44 usable cycles.
// With 8 sprites: coded body must fit in 44 cycles, not 63.
sprite_irq_correct:
    asl $d019               // 6 cycles
    lda #BLUE               // 2 cycles
    sta $d020               // 4 cycles
    lda #RED                // 2 cycles
    sta $d021               // 4 cycles
    // Only 2 color writes: 18 coded cycles + 19 DMA = 37 actual cycles (OK)
    // The RTI (6) and the IRQ entry (7, plus up to 29 via the KERNAL
    // dispatcher) are on top of the body.
    rti
```

### Cross-references

- Technique: `sprite_multiplex_8` — the primary technique that enables 8+
  sprites per frame; its cycle budget section discusses DMA accounting.
- Register: `D015` (SPENA — sprite enable bits; each set bit triggers DMA
  on active lines for that sprite).
- Pitfall: `badline_cycle_loss` — the two cycle thieves stack, not overlap: a
  badline on a line with 8 active sprites leaves the CPU one cycle on PAL
  (cycle 11), plus at most the three write-only cycles 12-14 if the instruction
  in flight is writing then — 4 at best, never the 20-23 an earlier version of
  this entry gave. Measured in VICE x64sc: 43 (badline) + 19 (eight sprites) =
  62 of 63 cycles stolen on every line where both occur (915 - 516 - 399 = 0
  over two overlapping lines; 1314 - 516 - 798 = 0 over five). The sprite
  lead-in cycles 55-57 are not usable on such a line: BA is already low from
  cycle 12 and does not rise again until cycle 11 of the next line, so a CPU
  halted on a read at cycle 15 cannot reach them.

---

## scroll_phase_breaks_panel_split — A panel split with a fixed delay breaks at one YSCROLL phase

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** scroll_panel_split, soft_scroll_v, char_scroll_buffer_v
**Mitigated by techniques:** scroll_panel_split

### Symptom

A vertically scrolling playfield sits above a fixed score panel. Seven frames
in eight the panel is clean. On the eighth, the panel's first line keeps the
playfield's blue and its 38-column left edge, and the next six lines have the
panel's grey and width but stray light-blue character pixels where the rule
row should be. The rest of the panel is correct. The flicker repeats every
eight pixels of scroll. Measured with PIL on the recipe's `USE_TABLE = 0`
build at YSCROLL 6, PAL and NTSC: line 215 x 39-351 on blue, lines 216-221
x 32-351 on grey (98, 98, 98), line 222 on identical to the reference.

### Mechanism

The split IRQ polls for the playfield's last line and then waits a fixed
delay so its stores land in that line's right border. A line is a badline when
its low three bits equal YSCROLL. The playfield's YSCROLL takes all eight
values, so the split line is a badline at exactly one of them. At that phase
the VIC holds the CPU from cycle 12 to cycle 54 during the delay, and the
stores land about 40 cycles late, inside the panel's first line. The
panel's `$D011` then makes that line a badline too late for a normal fetch,
and the `$D016` and `$D018` changes arrive mid-line.

Measured in VICE x64sc 3.10, PAL and NTSC, with
`recipes/kickassembler/scroll-panel-split.md` and `USE_TABLE = 0` (split
line 214, the same 5-pass delay at every phase): at YSCROLL 0-5 and 7 the
panel region, lines 215-250, is pixel-identical to the reference. At YSCROLL
6, where line 214 is a badline, lines 215-221 differ (1,108 pixels on PAL,
1,107 on NTSC). Two forum threads name YSCROLL 7 as the bad
phase (https://www.lemon64.com/forum/viewtopic.php?t=52763 and
https://www.lemon64.com/forum/viewtopic.php?t=64112, read as search
snippets, and the site returned 403 for the second; forum reports, not
measured here); that is the phase for their split line, not a constant.

`scroll_panel_split` is on both lines above: the naive form of the split
raises the pitfall and the table-driven form cures it.

### Fix

Index the delay by the playfield's YSCROLL and give the phase at which the
split line is a badline a short or zero delay: the badline stall is the wait.
Load every register value before the poll, so that after the stall only the
stores remain. In the recipe the table is 5, 5, 5, 5, 5, 5, 0, 5 passes of 9
cycles, and all eight phases leave the panel pixel-identical on PAL and NTSC.

A second, separate phase effect: put the panel's first line on a line that is
7 mod 8. Elsewhere the panel's first row reads a different screen row at
different phases (measured: panel on line 216 with YSCROLL 0 read screen row
21 at playfield YSCROLL 0 and row 20 at YSCROLL 3).

### Worked example

```text
// Naive: one delay for every phase. Breaks when (split line & 7) = YSCROLL.
        lda #LAST_PF-1
wait:   cmp $d012
        bcs wait
        lda #5
        sta count
delay:  dec count
        bpl delay
        sty $d016 ...

// Fixed: the delay comes from a table indexed by YSCROLL.
        ldx yscroll
        lda delay_tbl,x         // 5, 5, 5, 5, 5, 5, 0, 5 for split line 214
        sta count
        ...                     // load the panel values, poll, dec count / bpl
```

### Cross-references

- Technique: `scroll_panel_split` in `techniques/scroll.md`.
- Pitfall: `badline_cycle_loss`: the 40-43 cycle stall that moves the stores.
- Recipe: `recipes/kickassembler/scroll-panel-split.md`, with the per-phase table.
- Source of the table idea: c64gameframework `raster.s`, `irq4DelayTbl`
  (https://github.com/cadaver/c64gameframework, read, not run).
