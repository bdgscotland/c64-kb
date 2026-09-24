---
category: raster
---

<!-- doc-type: pitfall-reference -->

# Raster and Badline Pitfalls

These pitfalls come from the VIC-II sharing the bus with the CPU. The chip
runs on the same clock but does not wait for the CPU to finish what it is
doing. Badlines steal
cycles without warning. The raster compare register wraps silently at line 255.
Sprite DMA freezes the CPU mid-instruction. The stable-raster polling technique
(and its two-handler `double_irq` refinement) exists because the first IRQ
enabled has unpredictable entry timing. Each glitch below looks random and is
deterministic once the mechanism is known.

---

## badline_cycle_loss — Badline DMA steals 40-43 cycles from the CPU

**Severity:** critical
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq, sprite_multiplex_8, raster_bars, frame_sync_loop, double_irq, badline_synchronization, sideborder_open, fli_image, afli_image, ifli_image, soft_scroll_v, tile_map_render, dma_steal_avoidance, speedcode_generation, big_font_2x2, dycp_scroller, sine_table_generation, scroll_panel_split, sprite_multiplex_game, software_sprite_preshifted, fld_flexible_line_distance, raster_profile_bars, reu_dma, pwm_digi, eight_way_scroll_double_buffer, sprite_color_swap_mid_line, solid_vector_3d, mode7_lookalike, vsp_glitch, pseudo_3d_road_raster, sprite_stretcher_d017, tech_tech_wobbler, dysp_side_border_sprites, memory_fill_copy, delay_loops
**Mitigated by techniques:** screen_blank_full_cpu

### Symptom

The raster IRQ handler runs correctly during development, then breaks
every 8 lines. Color bars bleed across line boundaries. Sprite Y-position writes
arrive one scanline late. A tight per-line loop that works in isolation takes
40 extra cycles on some lines. The glitch looks like random jitter but repeats
at 8-line intervals.

### Mechanism

A badline occurs on every raster line where `(raster_line & 7) == YSCROLL`,
where YSCROLL is the low 3 bits of $D011 (default value 3). With the default
YSCROLL, badlines fall at raster lines 51, 59, 67 ... 243: 25 lines per frame
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
so a badline with all eight sprites active leaves the CPU almost nothing (one
guaranteed cycle); see `vic_bus_takeover_on_dma` below for the measurement.

### Fix

Three approaches, often combined (an earlier version said two and listed three):

1. **Badline avoidance:** Schedule IRQ handlers to fire on non-bad lines. Given
   a fixed YSCROLL of 3, any line where `(target_line & 7) != 3` is safe. A
   status bar split at line 200 (200 & 7 = 0) is safe; at line 203 (203 & 7 = 3)
   it is not. Move the split by 1 line.

2. **DEN off for the whole frame:** the VIC latches DEN once, during raster
   line $30 (48); if it is clear then, no line of that frame is a badline and
   the display is blank. Clearing DEN later in the frame does *not* stop the
   remaining badlines; an earlier version of this entry said it did. Sprite
   DMA still occurs either way. Measured, with a harness, in
   `screen_blank_full_cpu` (`docs/techniques/cpu-cycle-tricks.md`).

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
**Triggered by techniques:** stable_raster_irq, raster_bars, irq_chain_table, raster_split_modes, pal_ntsc_detection, frame_sync_loop, big_font_2x2, dycp_scroller, logic_rate_decoupling, sprite_multiplex_game, sprite_border_scroller, sprites_only_screen_mode

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
entry said a single stale write could fire twice per frame; it cannot. See
Mechanism.)

On NTSC the effect shows sooner: the frame is only 263 lines
(6567R8; 262 on the 6567R56A), so lines 256-262 are ordinary visible
bottom-border lines (the NTSC vertical blank is lines 13-40, per
`docs/hardware/pal-ntsc-reference.md`, which takes it from Bauer's VIC-II
article, not a measurement; VICE's NTSC screenshot crop of lines 28-262 and
0-11 is not the blank; an earlier version of this entry called
256-262 "vertical blank"), and any bottom-border effect crosses line 255 without
deliberately targeting high line numbers: a handler that chains forward by
setting `$D012 = next_line` forgets the 9th bit and wraps to `next_line - 256`.

### Mechanism

The VIC-II's internal raster counter is 9 bits wide. $D012 holds the low 8 bits
of the raster compare target. The 9th bit (the high bit) is bit 7 of $D011,
the RST8 bit. When the compare target is 256 or higher, RST8 must be set. When
the compare target is 255 or lower, RST8 must be clear.

The fault: code writes only `STA $D012` with the low byte of the
desired line, and never touches $D011 bit 7. On the first frame this works if
the target line is below 256. On a line at or above 256, the actual compare
target the VIC sees is `desired_line & 0xFF` with the 9th bit from whatever
$D011 bit 7 happens to be. If it is clear, the compare fires at line
`target - 256` instead of `target`. One IRQ fires per frame, at the wrong line:
the compare is a single 9-bit value, so it can never match two lines in one
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
**Triggered by techniques:** stable_raster_irq, irq_chain_table, phase_inverted_irq, frame_sync_loop, raster_split_modes, mode7_lookalike, vsp_glitch, pseudo_3d_road_raster, sprite_stretcher_d017, tech_tech_wobbler, dysp_side_border_sprites
**Mitigated by techniques:** stable_raster_irq, double_irq

### Symptom

A raster effect that works after the first few frames is unstable on the
first frame after IRQ enable. Color splits land up to 6 cycles (48 pixels;
one cycle is 8 pixels) to the right on the first frame; an earlier version
said 1-7 pixels, then 1-7 cycles. A sprite multiplex update on the first frame puts sprites
one line too low. The symptom disappears by frame 2. Alternatively, a raster
effect coded without the stable-raster polling technique shows a permanent 0-6
cycle wobble that makes split lines look fuzzy: a horizontal smear of up to
48 pixels on every frame where the interrupted instruction happened to be
long (0-7 cycles, 56 pixels, if the code uses undocumented 8-cycle opcodes;
an earlier version said 0-7 and 8-56 pixels for all code, against the
0-6 window below).

### Mechanism

The 6510 does not sample the /IRQ line between clock cycles; it samples it at
the end of each instruction. When the VIC-II asserts the IRQ line, the CPU
finishes whatever instruction it is currently executing, then begins the 7-cycle
interrupt entry sequence (two dummy cycles, push PCH, push PCL, push P, fetch
vector low, fetch vector high; the handler's first opcode fetch is its own first
cycle; an earlier version of this entry counted it inside the 7). The number
of cycles between the VIC asserting the line and the handler's first instruction executing depends on how many cycles
were left in the interrupted instruction. A 2-cycle `NOP` interrupted on its
last cycle adds 1 cycle of delay; a 6-cycle `STA ($zp,X)` interrupted on its
first cycle adds 5 cycles of delay. The total jitter window is 0-6 cycles for
common instructions (the 7-cycle read-modify-write
`abs,X` forms such as `INC abs,X` add up to 6 cycles and are common in
ordinary code: measured in VICE x64sc, a sled of `INC abs,X` gives seven
distinct entry cycles, per `vic-ii-reference.md`; undocumented 8-cycle
opcodes such as `SLO (zp),Y` widen the window to 0-7. An earlier version
named only `BRK` as a 7-cycle instruction and called it rare in runtime code).

On the first frame after enabling IRQs (writing $D01A bit 0 = 1), the CPU
may be executing any instruction when the first IRQ fires. The
jitter is random within the 0-6 cycle window. On subsequent frames, if the
main loop is a tight `JMP *` or a counted NOP sled, the interrupted instruction
is always the same (a 3-cycle `JMP`, leaving 0-2 cycles of jitter, or a 2-cycle
`NOP`, leaving 0-1; an earlier version of this entry called `JMP *` a 2-cycle
branch; a taken same-page branch is itself 3 cycles), so the jitter narrows
but does not disappear. The polling loop bounds the jitter to one loop
iteration (0-8 cycles for the 9-cycle `LDA/CMP/BNE` form); the `double_irq`
variant then removes that residual before the cycle-tight register writes begin.
That is why `stable_raster_irq` is on both metadata lines above: the pitfall
is what a raster interrupt does before the technique is applied to it (the
naive form), and the technique's polling loop (with `double_irq` for the
last cycle) is the cure.

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
   is never acknowledged, and re-enters the handler straight after RTI; see the
   worked example.)
3. Once $D012 reads N, execute a counted NOP pad to place the writes at the
   desired cycle to within the loop's residual (the pad sets the mean position
   only).
4. Perform the cycle-tight register writes.

The polling loop at step 2 bounds whatever jitter existed on entry to the
handler. By the time the loop exits ($D012 has just incremented to N), every
subsequent instruction runs within one poll iteration of the start of line N.
The first-frame jitter is bounded the same way. The first handler
entry may be anywhere within line N-1, but the polling loop absorbs that and
exits within one poll iteration of the start of line N regardless, though not
at one fixed cycle: the exit cycle still depends on where in the iteration the
entry fell.

### Worked example

```kick
// Single-IRQ approach — JITTERY. The STA $D020 can land 0-6 cycles
// late depending on what instruction was running when the IRQ fired.
irq_jittery:
    lda #BLUE
    sta $d020               // Seam varies by 0-6 cycles (0-48 pixels)
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

The `LDA $D012 / CMP / BNE` loop quantises the jitter window
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
**Triggered by techniques:** sprite_multiplex_8, dma_steal_avoidance, sideborder_open, sprite_multiplex_24, sprite_sine_chain, badline_synchronization, sprite_multiplex_game, reu_dma, raster_profile_bars, sprites_only_screen_mode, dysp_side_border_sprites, vector_balls_sprites

### Symptom

A raster IRQ that runs cleanly with no sprites enabled slips its timing
when sprites are turned on. The slip is not random: it is proportional to the
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
measured here. Sprite DMA and badline costs add: 8 sprites plus 5
badlines over lines 140-180 measured 614 = 399 + 5 × 43.

With all 8 sprites enabled and active on a single line, the VIC steals 3 cycles
of BA + 8 × 2 s-access = 19 cycles from the CPU on that line. On PAL, this
reduces the effective CPU budget from 63 cycles to 44 cycles. On NTSC, from 65
cycles to 46 cycles.

The CPU cannot choose when the stall happens; it is determined by the VIC's
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
   (sprite-crunch, sprite stretching) exploit the DMA cycle slots. They are out of
   scope here; the DMA slots are fixed and therefore predictable.

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
- Pitfall: `badline_cycle_loss` — the two costs add and do not overlap: a
  badline on a line with 8 active sprites leaves the CPU one cycle on PAL
  (cycle 11), plus at most the three write-only cycles 12-14 if the instruction
  in flight is writing then: 4 at best, never the 20-23 an earlier version of
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
x 32-351 on grey (98, 98, 98), line 222 onward identical to the reference.

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

---

## idle_fetch_byte_shows_in_gaps — The byte at $3FFF is drawn wherever the VIC has no row to show

**Severity:** medium
**Region:** both
**Triggered by registers:** D011
**Triggered by techniques:** fld_flexible_line_distance, sideborder_open, topbottom_border_open, sprites_only_screen_mode, dysp_side_border_sprites, agsp_free_scroll

### Symptom

A band of thin vertical stripes, or a repeated pattern, appears across the
display window where there should be plain background: in the gap an FLD
opens above the screen, in the lines a side-border loop keeps badline-free,
or in the opened top and bottom borders. On the developer's machine or in a
fresh emulator the same lines are clean. Garbage that "only shows on real
hardware", or only after another program has run, is the usual report.

### Mechanism

When no badline has loaded the video matrix latch the VIC is in idle state,
and its g-accesses read one fixed address instead of the character
generator: `$3FFF` in VIC bank 0, `$7FFF`, `$BFFF` or `$FFFF` in banks 1-3,
and `$39FF` (or the bank equivalent) with ECM set. The byte fetched is
drawn as pixels across the whole window on every idle line, bit 1 in colour
0, bit 0 in the background colour. VICE's RAM starts cleared, so the byte
is zero and the idle lines look like background. On hardware the byte holds
whatever was there: the power-on RAM pattern, or the tail of a previous
program's data, tables or code. Every technique that opens lines the VIC
does not fetch a row for exposes it: the FLD gap (`fld_flexible_line_distance`),
a side-border region whose YSCROLL is rewritten each line
(`sideborder_open`), the top and bottom borders once opened
(`topbottom_border_open`), and the last lines of an AGSP screen whose row
would need a badline after line 247 (`agsp_free_scroll`: one to three
lines when its fine scroll is 5 to 7, measured in its recipe). Measured in VICE x64sc 3.10: with `$3FFF` set to
`%10101010`, every line of an 18-line FLD gap on PAL and a 22-line gap on
NTSC is 160 black and 160 background pixels across x 32-351, alternating
from x = 32.

### Fix

Own the byte. Store `$00` at the idle address of the bank in use before the
effect starts, or store a chosen pattern when the stripes are wanted; in
bank 3 the address is `$FFFF`, which is RAM to the VIC and to a CPU store
even with the KERNAL ROM banked in. Do it once at start-up and again
whenever the VIC bank changes. The address is not free memory: a table
that ends at `$3FFF` puts its last byte on the screen.

### Worked example

From `recipes/kickassembler/fld.md`: the recipe wants the gap to be
visible, so it plants the pattern deliberately.

```text
// Bank 0: the idle fetch reads $3FFF. Plant the stripe once at start-up.
    lda #%10101010
    sta $3fff

// The same program wanting a clean gap stores zero instead:
    lda #0
    sta $3fff

// Bank 3 ($C000-$FFFF): the equivalent address is $FFFF, RAM under the
// KERNAL for both the VIC's fetch and the CPU's store.
    lda #0
    sta $ffff
```

### Cross-references

- Technique: `fld_flexible_line_distance` in `techniques/raster.md`: the gap is idle lines by design.
- Technique: `sideborder_open` and `topbottom_border_open` in `techniques/raster.md`: idle lines as a side effect.
- Hardware: `hardware/vic-ii-reference.md`, "Idle vs display state" and the `$3FFF` phantom-pixel note.
- Recipe: `recipes/kickassembler/fld.md`, where the byte is `%10101010` and the stripes are measured.

---

## charset_glyph_255_shows_in_fli_bug_columns — A table whose tail reaches glyph 255 of the character set is drawn in the three FLI-bug columns of every forced-badline line

**Severity:** medium
**Region:** both
**Triggered by registers:** D011, D018
**Triggered by techniques:** tech_tech_wobbler, fli_image, afli_image, plasma

### Symptom

In a text-mode effect that forces a badline on every line of a band, the
three leftmost columns of the band carry thin light stripes, often
diagonal, instead of the plain colour the FLI bug normally leaves there.
They appear after a table or colour map is added somewhere else in the
program, and go away when it is shortened. In a five-part KickAssembler
demo built from the KB the plasma's 256-entry colour map was placed at
`$3F00` in VIC bank 0 and first ran to `$3FFE`; the tech-tech band under
the logo then showed light diagonal stripes in columns 0 to 2 of every
band line. After the map was cut short, a fade that rewrote it in
32-entry slices up to entry 254 brought the stripes back for the length
of the fade.

### Mechanism

A badline forced on cycle 15 or later skips the c-accesses for the
columns whose slot has passed, and those columns read `$FF` from the
video matrix (`fli_image`, "Why it works"). In text mode a matrix byte of
`$FF` sends the g-access to glyph 255 of the character set, the eight
bytes at the charset base plus `$07F8` to `$07FF`. With the font at
`$3800` that is `$3FF8` to `$3FFF`, the top of bank 0, and the last of
the eight is the byte `idle_fetch_byte_shows_in_gaps` is about. The
glyph's set bits are drawn as ink in those three columns on every
forced-badline line, so whatever table ends in those eight bytes draws
its tail across the band. The colour map reached `$3FFE` and so wrote
seven of the eight rows of the glyph; the stripes were the map's values
read as pixel rows. Which colour the FLI columns paint that ink in text
mode was not established in the demo; the stripes read as light.

### Fix

Treat the last glyph of the character set as owned, like the idle byte,
and keep every table short of it. The demo capped the plasma's sine at
119 so the map ends at `$3F77`, well short of `$3FF8`; its setup zeroes
the eight bytes `$3FF8` to `$3FFF`; and the fade that walks the map in
32-entry slices stops at entry 238. Make the assembler catch growth:
reserve the eight bytes as an explicit block, or `.errorif` any table
that shares the page. Repeat the zeroing whenever the VIC bank changes;
the address moves with it.

### Worked example

```text
// Bank 0, font at $3800: glyph 255 is $3FF8-$3FFF. Own it at start-up.
    ldx #7
    lda #0
!:  sta $3ff8,x
    dex
    bpl !-

// A page-aligned table at $3F00 must end below $3FF8. The plasma's sine
// tops out at 119, so the map has 120 entries and ends at $3F77.
    * = $3f00
cmap:   .fill 120, palette_for(i)
    .errorif * > $3ff8, "table reaches glyph 255"

// A fade that rewrites the map in slices must stop short as well:
// the demo's stops at entry 238, not 254.
```

### Cross-references

- `idle_fetch_byte_shows_in_gaps` above: the same eight bytes' last one
  drawn on idle lines; this entry is the display-line case, where a
  forced badline draws all eight.
- Technique: `fli_image` in `techniques/bitmap-modes.md`, "Why it works":
  the skipped c-accesses that read `$FF`.
- Technique: `tech_tech_wobbler` in `techniques/effects-vector-3d.md`:
  the forced-badline band the stripes appeared in.
- Technique: `plasma` in `techniques/effects-vector-3d.md`: the colour
  map that grew into the glyph.
- Hardware: `hardware/vic-ii-reference.md`, the FLI note under the
  badline section: "first three columns show grey".

---

## sei_in_main_spans_band_entry_line — A SEI in the main loop that spans the band interrupt's line delays the sync, and the first display line falls as a real badline

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** double_irq, sideborder_open, dysp_side_border_sprites, badline_synchronization

### Symptom

A side-border band that is cycle-exact in most frames loses its border,
or its CIA bracket jumps, in a few frames a second with no pattern in
the picture. In a five-part KickAssembler demo built from the KB the
DYSP band's per-frame cycle count, a constant 9,540 on PAL, read +26 to
+40 in 12 frames of 884 traced. The fault appeared when the main loop
grew: its table build had come to end near line 45, and it took the new
table under `SEI`.

### Mechanism

The band's entry is a `double_irq` at line 45 to 49: the first interrupt
lands with jitter, the second is taken from a known instruction, and the
loop then rewrites YSCROLL on every line from 51 down so that no line of
the band is a badline (`sideborder_open`). An interrupt that arrives
while the CPU has I set is not lost, it is held until `CLI`, and a `SEI`
in the main loop that happens to span line 45 holds the first interrupt
past it. The second interrupt then syncs late, the YSCROLL rewrite
starts late, and line 51, where the display begins with YSCROLL 3 still
in `$D011`, is a badline: the VIC takes its 40 to 43 cycles
(`badline_cycle_loss`) and the loop's next `DEC $D016` is off cycle 56.
The demo's notes read the +26 to +40 as one badline; why the bracket
sees less than the full 40 to 43 was not established. The frames hit are
those in which the main loop's end drifted onto the entry line, which is
why the fault looked random.

### Fix

Never hold `SEI` in the main loop across a line the band's entry
interrupt needs. Either move the critical section into an interrupt
that already runs at a safe line, or guard it with a raster read and
skip the section when the beam is near the entry. The demo did both in
turn: first the table adopt moved into the handler at line 236, and
after the main loop grew again it adopts under `SEI` only when `$D012`
is outside 38 to 52, 223 to 227 and 251 to 255, with the line-28 handler
as the fallback. Re-measured, the band read 9,540 in 793 of 793 PAL
frames and 9,840 in 420 of 420 NTSC frames.

### Worked example

```text
// Main loop, before taking the new table: adopt only when the raster
// is clear of the band entry (45-49), the bottom handler and the frame
// wrap. Otherwise leave tab_ready set and let the line-28 handler do it.
adopt_if_clear:
    lda $d012
    cmp #38
    bcc !ok+
    cmp #53
    bcc !skip+          // 38..52: the entry's lines, do not hold SEI here
    cmp #223
    bcc !ok+
    cmp #228
    bcc !skip+          // 223..227
    cmp #251
    bcc !ok+
!skip:
    rts                 // the handler at 28 adopts on the next frame
!ok:
    sei
    jsr adopt_table     // the critical section, well under a line
    cli
    rts
```

### Cross-references

- `badline_cycle_loss` above: the 40 to 43 cycles line 51 costs once
  the YSCROLL rewrite is late.
- `raster_irq_first_line_jitter` above: why the entry is a double
  interrupt in the first place; a held interrupt defeats the second half.
- Technique: `double_irq` and `sideborder_open` in `techniques/raster.md`:
  the entry and the per-line YSCROLL rewrite.
- Technique: `dysp_side_border_sprites` in `techniques/raster.md`: the
  band measured here, 9,540 PAL and 9,840 NTSC a frame.

---

## raster_poll_equality_misses_under_dispatch_latency — A `CMP $D012 / BNE` poll for a run's first line, entered through a dispatcher a hundred cycles late, misses the line and spins a whole frame

**Severity:** high
**Region:** both
**Triggered by registers:** D012
**Triggered by techniques:** raster_bars, irq_chain_table, topbottom_border_open

### Symptom

Raster bars or a border-opening run scheduled from a table-driven
interrupt dispatcher show up one frame in two or three, and every other
effect in the chain, the music included, slows with them. In a five-part
KickAssembler demo built from the KB three polled runs were entered from
dispatcher entries at lines 28, 205 and 244; traced at the dispatcher's
jump, the bottom and open runs each spun a whole frame, "the cycle took
three frames and the band ran once in three". The same runs also stopped
one line short, so a `$D011` restore written for line 252 never ran.

### Mechanism

A KERNAL-vectored dispatcher takes the interrupt at the entry's line,
saves the registers, acknowledges `$D019`, reads its table and jumps to
the handler: about 100 cycles here, more than one raster line (63 PAL,
65 NTSC). A poll for the run's first line written as an equality,
`lda $d012 / cmp #line / bne`, therefore starts after that line has gone
by. The raster compare register only equals that value again in the next
frame, and the handler spins there with interrupts held, so every entry
behind it, including the sequencer's frame tick, is a frame late. The
exit test had the same shape: a loop that leaves on equality with its
last line leaves one line early when the count and the line are off by
one, and the restore on 252 was never reached.

### Fix

Poll with a greater-or-equal test and give the entry two lines of lead:
`lda $d012 / cmp #first / bcc` waits when the beam is still above the
line and passes at once when the dispatcher was late. Count the lines of
the run rather than testing the exit line for equality. Re-measured after
the change, the dispatch cycle was exactly 19,656 cycles a frame on PAL,
every entry on its line. Keep the compare inside one half of the frame;
across line 255 the value wraps (`d012_wrap_around`) and a `>=` on the
low byte alone inverts.

### Worked example

```text
// Dispatcher entry armed at FIRST - 2. The handler lands about 100
// cycles after the interrupt, one to two lines late. Wait for the line
// with >=, so a late arrival falls straight through.
bar_run:
    ldx #0
!wait:
    lda $d012
    cmp #FIRST
    bcc !wait-          // still above FIRST: keep polling
!line:
    lda gradient,x
    sta $d020
    sta $d021
    // ... pad to one line ...
    inx
    cpx #LINES          // count the lines; do not test $D012 for the last
    bne !line-
    rts

// The fault, for contrast: `cmp #FIRST / bne !wait-` never passes if
// FIRST went by during dispatch, and the handler holds the frame.
```

### Cross-references

- `d012_wrap_around` above: the compare is nine bits; a `>=` on the low
  byte is only safe inside one half of the frame.
- `raster_irq_first_line_jitter` above: the latency that makes the
  equality miss is the same jitter, made larger by the dispatcher.
- Technique: `irq_chain_table` in `techniques/raster.md`: the
  table-driven dispatcher whose latency this is.
- Technique: `raster_bars` in `techniques/raster.md`: the polled run.

---

## irq_table_rebuilt_per_frame_loses_close_entries — A dispatcher table rebuilt every frame from the main loop loses a frame for any two entries armed under about four lines apart

**Severity:** high
**Region:** both
**Triggered by registers:** D012
**Triggered by techniques:** irq_chain_table, sprite_multiplex_24, sprite_multiplex_game

### Symptom

A sprite multiplexer that writes its reposition interrupts as per-frame
entries in a shared dispatcher table shows torn or missing sprites
wherever two logical sprites are close in Y, and the entries behind
them, a sequencer's line-255 tick among them, arrive a frame late. In a
five-part KickAssembler demo built from the KB the first design of the
24-ball part put one reposition entry at each ball's previous Y + 22 and
rebuilt the table at the top of the main loop. Its notes: rows under
about four lines apart lost a whole frame, the sequential walk delayed
every row behind them including the sequencer's 255, and because the
main loop ran at about raster line 90 (later on NTSC) a rebuild there
skipped the rows already passed in every frame. The design was abandoned.

### Mechanism

A table-driven dispatcher walks its entries in order and arms the raster
compare for entry n + 1 only when handler n returns, and the compare
fires only at the start of a line. Interrupt entry, register save,
acknowledge, table lookup and return cost about 100 cycles around the
handler's own work, so when two entries lie fewer than about four lines
apart the second's line has already passed by the time it is armed. The
compare is next met a frame later, and every entry behind it in the walk
waits with it. The per-frame rebuild adds a second fault of its own: the
table is replaced at whatever line the main loop has reached, and an
entry for a line already past in the current frame is not armed until
the next. Together they cost the multiplexer a frame in every row where
two balls sat close, which is the common case in a ring.

### Fix

Assemble the rows fixed and further apart than the dispatcher's
latency, and let one handler take every entry due by its row from a
running index (the "fixed reposition rows" variation of
`sprite_multiplex_24`). The demo's rows sit twenty lines apart, each
entry is due at its predecessor's Y + 22, so an entry runs at most eight
lines late against a 31-line margin, and a compile-time proof holds the
Y gap between a ball and the one eight places above it at 50 lines or
more over all 256 offsets (the shipped minimum is 53). The schedule is
triple-buffered so the build never straddles the row that publishes it.
Measured per frame with 24 balls and a 16-band gradient: PAL worst
8,294, NTSC worst 9,176. If entries must change per frame, arm them from
a handler that runs before the first of them, never from the main loop
at an unknown line.

### Worked example

```text
// One handler serves every fixed reposition row. Entries are sorted by
// due line; take every entry due before this row's line + 2.
rp_run:
    ldy rp_idx
!next:
    lda sched_due,y
    cmp row_limit           // the row's stub stores its line + 2 here
    bcs !done+
    ldx sched_slot,y        // hardware sprite times two
    lda sched_y,y
    sta $d001,x
    lda sched_x,y
    sta $d000,x
    iny
    bne !next-
!done:
    sty rp_idx
    rts
```

### Cross-references

- `raster_poll_equality_misses_under_dispatch_latency` above: the same
  dispatcher latency, seen by a polled run instead of a table walk.
- `sprite_dma_overflow` in `pitfalls/sprite.md`: what a slot re-armed
  after its line has passed looks like on screen.
- Technique: `irq_chain_table` in `techniques/raster.md`: the
  dispatcher.
- Technique: `sprite_multiplex_24` in `techniques/sprite.md`, "Variation:
  fixed reposition rows": the design that replaced the per-frame table.

---

## badline_every_line_block_length — A loop that forces a badline on every line breaks when its block is not exactly the free cycles

**Severity:** high
**Region:** both
**Triggered by registers:** D011
**Triggered by techniques:** kefrens_bars

### Symptom

A Kefrens band, or any loop that keeps the VIC on one pixel row by making
every line a badline, works for a few lines and then breaks: every 20
lines on PAL (22 on NTSC) a few lines of the character's lower rows show
through, or from some line on the first one or two cells of every line
are black, or the band falls apart into rows after a few lines. The code
looks right and the cycle count was done by hand.

### Mechanism

Each line's block runs between two badline stalls, and the stall
re-aligns the CPU every line. The block writes YSCROLL for the next line,
and that write must land after the current line's stall ends (cycle 55)
and before the next line reaches cycle 12. The CPU has 20 cycles there on
PAL and 22 on NTSC. Measured in VICE x64sc 3.10 with the `kefrens-bars`
recipe built `:proof=1` and the block length swept (store trace of
`$D011`, picture decoded with PIL):

| Block, PAL | Block, NTSC | Where the writes settle | What shows |
|---|---|---|---|
| 19 | 21 | anywhere; two or more writes in some lines | The band breaks every 20 (22) lines: the second write in a window takes the badline off the current line |
| 20 | 22 | PAL 3-6, NTSC 62-64 of the line before or 3-4 | Correct on every line |
| 21 | 23 | PAL 12; NTSC 3 in the traced frame | Cell 0 black on every line from line 58 (PAL) or 60 (NTSC, in the pictured frame): the late badline skips one c-access |
| 22 | 24 | 13 | Cells 0 and 1 black |
| 23 | 25 | 14 | RC not reset: rows 1-7 show, then the band is lost |

A block that is too long drifts later by its excess every line until its
write meets the stall, and settles there. Where it settles depends on the
instruction order: in one test build a 21-cycle PAL block settled on
cycle 3 and was correct.

### Fix

Make every block exactly 20 cycles on PAL and 22 on NTSC: count the
instructions, pad with `nop` and `bit $ea`, and build a separate band for
each model. Check with a store trace that every `$D011` write lands on the
same few cycles below 12 in every frame, and look at the first two cells
of the band, where a late write shows first.

### Worked example

From `recipes/kickassembler/kefrens-bars.md`, the PAL block:

```text
    stx $d011                    // 4: YSCROLL for the next line
    ldy pos + k                  // 4
    sta $2020, y                 // 5: the bar byte into the line buffer
    ldx #$18 | ((53 + k) & 7)    // 2: YSCROLL for the line after
    nop                          // 2
    bit $ea                      // 3: 20 in all; NTSC adds nop to 22
```

### Cross-references

- Technique: `kefrens_bars` in `techniques/raster.md`.
- Technique: `badline_synchronization` in `techniques/raster.md`: the 20 and 22 free cycles.
- Recipe: `recipes/kickassembler/kefrens-bars.md`, "The block-length sweep".

---

## linecrunch_write_outside_window — A linecrunch write outside cycles 58-62 (PAL) repeats a row or crunches nothing

**Severity:** high
**Region:** both
**Triggered by registers:** D011
**Triggered by techniques:** linecrunch

### Symptom

A linecrunch that should scroll the screen up N rows shows row 0 N lines
lower instead, as if it were an FLD; or shows one row twice and skips
the next; or loses one row whatever N is; or puts a few stray cells at the
right end of the line above the text. A change of one cycle in the loop
switches between these and the working effect, and a self-check that
only times the first badline after the crunch still passes.

### Mechanism

The write must make the badline condition true after the VIC's row-end
check in cycle 58 of a line with RC = 7, and the condition must be false
when the next line starts. Measured in VICE x64sc 3.10 with
`recipes/kickassembler/linecrunch.md` swept one cycle at a time
(`:ep`, `:en`), store-trace cycles in Bauer's numbering:

| Write cycle | PAL | NTSC |
|---|---|---|
| 53 to 57 | No crunch; at 53 to 55 one or two fetched cells at the right of the line above the text | No crunch; at 53 to 56 one to three such cells |
| 58 to 62 | Crunch | Crunch |
| 63, 64 | (63 is the last cycle: no crunch) | Crunch on 63 and 64 |
| The line's last cycle (63 / 65) | No crunch | No crunch |
| 1, 2 of the next line | One row lost, not N | The same |

In a separate PAL and NTSC test with the writes in the middle of a row,
a write on 54 to 57 of the row's last line showed that row again and
skipped the next (Bauer's doubled text lines), and on PAL a matching
write on cycles 15 to 54 started a late badline, the `vsp_glitch`
mechanism, and crunched nothing.

The window is five cycles on PAL, so an unstable raster entry with its
usual jitter lands some frames outside it.

### Fix

Enter from a stable raster and put every write on one cycle in the
middle of the window: 60 works on both models. Confirm with a store
trace of `$D011`: every write of the loop on the same cycle, every frame.
Check the crunch in the picture, not only by timing the badline after
it: a program's own check that line 51 + N is a badline passes whether or
not the rows were crunched, because the loop's last write makes that line
a badline in every case.

### Worked example

From `recipes/kickassembler/linecrunch.md`: a 63-cycle loop (65 on NTSC)
entered from the double IRQ at a traced delay, one store per line.

```text
!loop:
    lda tab, x          // $78 | (line & 7): ECM+BMM blank the crunched line
    sta $d011           // cycle 60 on both models, by store trace
    inx
    cpx n
    beq !done+
    Delay(63 - 18)      // 65 - 18 on NTSC
    jmp !loop-
```

### Cross-references

- Technique: `linecrunch` in `techniques/raster.md`.
- Technique: `vsp_glitch` in `techniques/raster.md`: the late badline a write before cycle 55 makes.
- Recipe: `recipes/kickassembler/linecrunch.md`, "The write-cycle sweep".
- Source: Christian Bauer, VIC-II article, §3.7.2, §3.14.4, §3.14.5.

---

## fpp_write_outside_window — An FPP line split in two, blank at the left, or showing the wrong pixel row

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D018
**Triggered by techniques:** fpp_flexible_pixel_position, char_zoomer_d018

### Symptom

In an FPP band, some lines show the old charset on their left cells and
the new one on the rest; or the first one to three cells of a line are
blank; or a whole line shows the next pixel row of the source instead of
the one chosen. A one-cycle change in the loop switches between these
and a clean band.

### Mechanism

Each form of FPP needs its `$D011` write inside a window, and every form
needs its `$D018` write early enough. Measured in VICE x64sc 3.10, PAL
c64c and NTSC, with `recipes/kickassembler/fpp.md` swept one cycle at a
time (store-trace cycles, Bauer's numbering); the results were the same
on both models except where the table says:

| Write | Cycle | Result |
|---|---|---|
| `$D018` for line L | up to 15 of L | whole line from the new charset |
| | 16 + c | cells 0 to c from the old charset |
| `$D011`, badline form (YSCROLL = L & 7 on line L) | up to 11 | full badline, pixel row 0 |
| | 12, 13 | cells 0, or 0 and 1, blank: the VIC reads `$FF` as the pointer before it has the bus (the FLI bug) |
| | 14 on | RC not reset: the line shows pixel row 1, with three blank cells moving right one cell a cycle |
| `$D011`, restart form | 54 to 57 | row restarts |
| | 52, 53 | a late badline instead, which holds the CPU to cycle 54 and breaks a cycle-counted loop |
| `$D011`, RC-held form | 58 to 62 (PAL), 58 to 64 (NTSC) | RC held at 7 |
| | the line's last cycle | nothing held |

In the badline form a block that runs late is pulled by the stall to a
write on cycle 11, the last that works, and stays there: it passes in
VICE with no margin.

### Fix

Pick the form, then put each write on one cycle inside its window, away
from the edges, and confirm with a store trace of `$D011` and `$D018`:
every band write on the same cycle, every frame. In the badline form set
the entry into the first block by trace rather than leaving it to the
stall; the recipe's writes land on cycles 6 and 2 (PAL), 5 and 1 (NTSC).
Check the picture line by line, not by eye: a split at cell 1 is one
character wide.

### Worked example

From `recipes/kickassembler/fpp.md`, mode 0: one 20-cycle block per band
line (22 on NTSC), the charset first, then the YSCROLL that makes the line
a badline.

```text
    lda d18 + 6 + k
    sta $d018                    // charset for line 60 + k: cycle 2 (PAL)
    stx $d011                    // YSCROLL = (60 + k) & 7: cycle 6 (PAL)
    ldx #$18 | ((61 + k) & 7)
    Delay(6)                     // 8 on NTSC
```

### Cross-references

- Technique: `fpp_flexible_pixel_position` in `techniques/raster.md`.
- Technique: `linecrunch` in `techniques/raster.md`: the RC-held write.
- Pitfall: `linecrunch_write_outside_window`, the same window for a crunch.
- Recipe: `recipes/kickassembler/fpp.md`, the three sweep sections.
- Source: Christian Bauer, VIC-II article, §3.7.2, §3.14.3 to §3.14.6.

---

## doubled_row_skips_a_screen_row — A doubled text row uses up two rows of screen and colour RAM

**Severity:** medium
**Region:** both
**Triggered by registers:** D011
**Triggered by techniques:** line_doubling_and_colour_ram_double_buffer

### Symptom

Text rows made 16 lines tall by the doubled-line write show rows 0, 2, 4
... of the screen: every second row of the text and of its colours never
appears, and the last rows of a 25-row screen are unreachable. In bitmap
mode, by the same rule, the second half of a doubled row would show the
next row's graphics in the first row's colours (not measured here).

### Mechanism

The write on cycles 54 to 57 of a row's last line wraps RC to 0 and the
row is drawn again from its latched pointers and colours, but the VIC's
cycle-58 step still loads VCBASE from VC, which has counted the 40 cells
of the half just drawn (Bauer §3.7.2, §3.14.5). Each 8-line half moves
the row base on by one row. Measured in VICE x64sc 3.10, PAL c64c and
NTSC, with `recipes/kickassembler/line-doubling.md`: with the write the
rows shown from line 52 in 8-line halves are 1, 1, 3, 3, 5, 5, 7, 7 (PAL,
buffer 1); built `:nodbl=1`, with the write aimed at RAM, they are 1, 2,
3, 4, 5, 6, 7, 8.

### Fix

Lay the screen and colour data out in every second row, or use the
skipped rows on purpose: they are a second colour RAM, picked by starting
the display one row on with a single crunched line (the recipe's
buffer 1). Put the text for doubled row j in screen row 2j (or 2j + 1).

### Worked example

From `recipes/kickassembler/line-doubling.md`: row j of buffer b is
screen row 2j + b, so the refill steps 80 bytes a row.

```text
    lda ptr
    clc
    adc #80                     // the buffer's next row: two screen rows on
    sta ptr
```

### Cross-references

- Technique: `line_doubling_and_colour_ram_double_buffer` in `techniques/raster.md`.
- Technique: `linecrunch` in `techniques/raster.md`: the one-line crunch that picks the odd rows.
- Recipe: `recipes/kickassembler/line-doubling.md`, "The doubling write cycle".
- Source: Christian Bauer, VIC-II article, §3.7.2, §3.14.5.

---

## mid_row_badline_write_off_by_one — A mid-row forced badline one cycle early freezes every row; one cycle late shifts the colours

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D018
**Triggered by techniques:** chunky_4x4_fli_mode, fli_image, ufli_sprite_underlay

### Symptom

A 4 × 4 chunky or FLI-style screen that refetches colours halfway down
each character row shows the same row over and over from the second row
down; or its leftmost cells show the colours of the half-row above, with
the light grey FLI-bug cells one or more cells in from the left edge.

### Mechanism

The `$D011` write that forces the mid-row badline must make the
condition true on cycle 14 exactly. Earlier, the VIC's cycle-14 check
sees it and resets RC to 0; RC never reaches 7 in that row, VCBASE is not
moved on in cycle 58, and every later row is fetched from the same
VCBASE. Later, RC is left alone but the c-accesses start later, so the
leftmost cells keep the colours already in the buffer. Measured in VICE
x64sc 3.10, PAL c64c and NTSC alike, with
`recipes/kickassembler/chunky-4x4.md` (blocks right in cells 3-39 of rows
1-24, of 3,552):

| Write cycle | Result |
|---|---|
| 11, 12, 13 | 444 right: every row from 1 on shows row 1 |
| 14 | 3,552 right; cells 0-2 of the bottom half light grey (the FLI bug) |
| 15, 16, 17 | 3,507, 3,462, 3,417: 1, 2, 3 cells keep the top half's colours |

### Fix

Put the write on cycle 14 and confirm it with a store trace of `$D011`
on every forced line. Enter the loop from a stable raster; the forced
badline's own stall then re-times each row, so a correct first row keeps
the rest correct. Write `$D018` for the new screen before cycle 15 of the
line and restore it after the stall.

### Worked example

From `recipes/kickassembler/chunky-4x4.md`, one row:

```text
    lda #D18B
    sta $d018                   // screen B: cycle 8
    lda #$3f
    sta $d011                   // YSCROLL 7 on line 55 + 8r: cycle 14
    lda #D18A
    sta $d018                   // screen A again after the stall: cycle 60
    lda #$3b
    sta $d011
```

### Cross-references

- Technique: `chunky_4x4_fli_mode` in `techniques/bitmap-modes.md`.
- Technique: `fli_image` in `techniques/bitmap-modes.md`.
- Pitfall: `fpp_write_outside_window`, the same cycles for a badline on every line.
- Recipe: `recipes/kickassembler/chunky-4x4.md`, "The forced write cycle".
- Source: Christian Bauer, VIC-II article, §3.7.2, §3.14.6.
