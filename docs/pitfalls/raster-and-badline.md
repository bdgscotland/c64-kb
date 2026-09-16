---
category: raster
---

<!-- doc-type: pitfall-reference -->

# Raster and Badline Pitfalls

The four pitfalls in this document share a common thread: they all stem from
the VIC-II's asynchronous relationship with the CPU. The chip runs on the same
clock but does not wait for the CPU to finish what it is doing. Badlines steal
cycles without warning. The raster compare register wraps silently at line 255.
Sprite DMA freezes the CPU mid-instruction. The stable-raster double-IRQ trick
exists precisely because the first IRQ you enable has unpredictable entry
timing. Each pitfall below has caused demo coders and game developers to lose
hours to glitches that look random but are in fact completely deterministic once
you know the mechanism.

---

## badline_cycle_loss — Badline DMA steals 40-43 cycles from the CPU

**Severity:** critical
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq, sprite_multiplex_8, raster_bars

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
on PAL, 24 on NTSC. On each badline, the VIC-II must fetch the 40 screen code
bytes for the character row that begins on that line. The chip asserts the BA
(Bus Available) signal low 3 cycles before it needs the bus. The CPU, seeing BA
low, can still complete any instruction that has no remaining bus cycles, but
cannot issue new memory accesses. Three cycles later, the VIC takes the phi2
bus for 40 cycles of screen RAM fetch, then releases it.

The net CPU stall is 40 cycles — from 23 cycles available per line (PAL) instead
of 63. Any raster handler that assumes a fixed 63-cycle budget per line will slip
by 40 cycles on every badline it hits. With 8 sprites active, sprite DMA adds
2 cycles per sprite on the sprite's first active line, pushing the stall to 43
cycles and leaving only 20 usable cycles on a PAL badline.

### Fix

Two approaches, often combined:

1. **Badline avoidance:** Schedule IRQ handlers to fire on non-bad lines. Given
   a fixed YSCROLL of 3, any line where `(target_line & 7) != 3` is safe. A
   status bar split at line 200 (200 & 7 = 0) is safe; at line 203 (203 & 7 = 3)
   it is not. Move the split by 1 line.

2. **DEN suppression for effect zones:** When the effect doesn't need the
   character display running, write $D011 bit 4 (DEN) = 0. With DEN clear, the
   VIC-II does not trigger badlines at all — the CPU gets all 63 cycles (PAL)
   per line. Sprite DMA still occurs. Restore DEN before the character display
   area begins.

3. **YSCROLL shift:** Write new YSCROLL bits in $D011 to move the badline pattern
   away from a critical effect window. Write YSCROLL only at a cycle where the
   change cannot trigger an accidental badline on the current line — specifically
   after the BA-low assertion point for the current line has passed (after cycle
   ~12 of the line).

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

// GOOD: suppress display to kill badlines in the effect zone.
// DEN=0 removes badlines; all 63 PAL cycles are available.
effect_irq:
    lda $d011
    and #%11101111      // Clear DEN (bit 4) to suppress badlines
    sta $d011
    // ... write effect registers with full 63-cycle budget ...
    lda $d011
    ora #%00010000      // Restore DEN before display area
    sta $d011
    asl $d019
    rti
```

For code that must run on a potentially bad line (e.g., per-line raster bars),
subtract 40 from the available cycle count and ensure the handler body fits
within 23 cycles on PAL or 25 cycles on NTSC.

### Cross-references

- Technique: `stable_raster_irq` — the double-IRQ trick that this pitfall
  most visibly affects; the technique doc discusses badline avoidance in its
  cycle budget section.
- Technique: `sprite_multiplex_8` — active sprites add 2 cycles/sprite of DMA
  on top of the 40-cycle badline stall; the combination can push total DMA to
  43+ cycles.
- Technique: `badline_synchronization` — the raster.md technique covering the
  full badline accounting framework.
- Registers: `D011` (SCROLY — carries DEN bit and YSCROLL), `D012` (RASTER).

---

## d012_wrap_around — $D012 wraps at line 255; bit 7 of $D011 holds the 9th bit

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq, raster_bars

### Symptom

A raster IRQ set for line 260 (a valid PAL line in the lower border area) either
never fires, or fires twice per frame — once at line 4 and again somewhere else.
Alternatively, after adding PAL border effects that target lines above 256, an
IRQ that previously worked cleanly starts misfiring. The IRQ appears to hit a
completely wrong line, or the frame rate drops by half as handlers chain in a
loop.

On NTSC, the effect is more immediately visible: NTSC has 263 lines per frame,
so raster lines 256-262 are inside the visible vertical blank region. Any effect
targeting those lines encounters the wrap without ever needing to deliberately
target high line numbers — a handler that chains forward by setting `$D012 =
next_line` forgets the 9th bit and wraps to `next_line - 256`.

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
`target - 256` instead of `target`. Two IRQs fire per frame: one at the
accidental low-byte line, and one at the intended high line if RST8 was set
from a previous write.

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
    .if TARGET_LINE >= 256 {
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
    bcc +                   // If target < 256, leave RST8 clear
    ora #%10000000          // Otherwise set RST8
+   sta $d011
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
  affects; the KickAssembler recipe includes correct RST8 handling.
- Registers: `D012` (RASTER — low 8 bits of raster counter and compare),
  `D011` (SCROLY — bit 7 is RST8, the 9th raster bit).

---

## raster_irq_first_line_jitter — First raster IRQ after enable has unpredictable entry timing

**Severity:** high
**Region:** both
**Triggered by registers:** D011, D012
**Triggered by techniques:** stable_raster_irq

### Symptom

A raster effect that works perfectly after the first few frames is unstable on
the very first frame after IRQ enable. Color splits land 1-7 pixels to the right
on the first frame. A sprite multiplex update on the first frame puts sprites
one line too low. The symptom disappears by frame 2. Alternatively, a raster
effect coded without the stable-raster double-IRQ trick shows a permanent 0-7
cycle wobble that makes split lines look "fuzzy" — a 1-7 pixel horizontal smear
on every frame where the interrupted instruction happened to be long.

### Mechanism

The 6510 does not sample the /IRQ line between clock cycles — it samples it at
the end of each instruction. When the VIC-II asserts the IRQ line, the CPU
finishes whatever instruction it is currently executing, then begins the 7-cycle
interrupt entry sequence (push PCH, push PCL, push SR, fetch vector low, fetch
vector high, start handler). The number of cycles between the VIC asserting the
line and the handler's first instruction executing depends on how many cycles
were left in the interrupted instruction. A 2-cycle `NOP` interrupted on its
last cycle adds 1 cycle of delay; a 6-cycle `STA ($zp,X)` interrupted on its
first cycle adds 5 cycles of delay. The total jitter window is 0-6 cycles for
common instructions (the 7-cycle `BRK` is a pathological case that adds up to
6 cycles, but is not found in normal runtime code).

On the very first frame after enabling IRQs (writing $D01A bit 0 = 1), the CPU
has no idea what instruction it will be executing when the first IRQ fires. The
jitter is random within the 0-6 cycle window. On subsequent frames, if the
main loop is a tight `JMP *` or a counted NOP sled, the interrupted instruction
is always the same (a 2-cycle branch or a 2-cycle NOP), so the jitter narrows
— but it does not disappear. The stable-raster double-IRQ trick eliminates
jitter by consuming it deliberately before the cycle-tight register writes begin.

### Fix

Use the stable-raster double-IRQ technique. The pattern:

1. Enable raster IRQs with the IRQ line set to one line before the target line
   (line N-1).
2. In the IRQ handler for line N-1: acknowledge $D019, set $D012 to line N,
   then poll $D012 in a tight loop until the counter increments to N.
3. Once $D012 reads N, execute a precisely counted NOP pad to reach the desired
   cycle within line N.
4. Perform the cycle-tight register writes.

The polling loop at step 2 consumes whatever jitter existed on entry to the
handler. By the time the loop exits ($D012 has just incremented to N), every
subsequent instruction runs at a fixed cycle offset from the start of line N.
The initial first-frame jitter is consumed the same way — the first handler
entry may be anywhere within line N-1, but the polling loop absorbs that and
exits at a deterministic point in line N regardless.

### Worked example

```kick
// Single-IRQ approach — JITTERY. The STA $D020 can land 0-6 cycles
// late depending on what instruction was running when the IRQ fired.
irq_jittery:
    lda #BLUE
    sta $d020               // Horizontal seam varies by 0-6 pixels
    asl $d019               // Ack
    rti

// Stable double-IRQ approach — ZERO JITTER after the polling loop.
// IRQ 1 fires at line TARGET_LINE-1. It acks, advances to TARGET_LINE,
// then spins until $D012 increments.
irq_stable_setup:
    asl $d019               // Ack IRQ for line TARGET_LINE-1
    lda #TARGET_LINE
    sta $d012               // Advance compare to target line
    // Poll until raster reaches TARGET_LINE.
    // Each loop iteration: LDA abs (4) + CMP imm (2) + BNE (3) = 9 cycles.
    // The loop exits within 0-8 cycles of the line start, consuming jitter.
-   lda $d012
    cmp #TARGET_LINE
    bne -
    // Now on line TARGET_LINE. Add NOP padding to reach desired cycle.
    nop                     // 2 cycles — tune count for exact cycle target
    nop
    // Cycle-tight effect code lands here at a fixed cycle within TARGET_LINE.
    lda #RED
    sta $d020               // Lands at a deterministic cycle — no smear
    rti
```

The key insight: the `LDA $D012 / CMP / BNE` loop consumes the jitter window.
The exit of the loop always happens within one loop iteration (9 cycles) of the
raster line's start. NOP pads after the loop bring the writes to the exact
desired cycle. The first-frame case is no different: the polling loop absorbs
any entry-time jitter, including the variable amount from the random interrupted
instruction on frame 1.

For sub-cycle precision, the double-IRQ technique fires two consecutive IRQs
on lines N-1 and N, where the second IRQ's entry timing is constrained by the
known instruction in the main loop between the two handlers (typically a
2-cycle NOP), eliminating even the 0-8 cycle polling-loop residual.

### Cross-references

- Technique: `stable_raster_irq` — the complete description of the double-IRQ
  pattern, including the NOP-pad sizing and the `double_irq` variant for
  sub-cycle work.
- Technique: `double_irq` — scene-tier zero-jitter extension of stable_raster_irq.
- Registers: `D019` (VICIRQ — interrupt flag register; must be acked before
  RTI), `D012` (RASTER — the register being polled), `D011` (SCROLY — RST8 bit
  for targets >= 256).

---

## vic_bus_takeover_on_dma — VIC sprite DMA freezes the CPU for 2-19 cycles per scanline

**Severity:** medium
**Region:** both
**Triggered by registers:** D015
**Triggered by techniques:** sprite_multiplex_8

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
fetches) for each active sprite. All of these accesses happen during phi2 —
the CPU's bus phase — so the CPU cannot execute any instruction that requires
a memory access during those cycles.

The exact stall per sprite, per relevant scanline:
- **2 cycles** are stolen for the p-access (sprite pointer fetch) on the
  sprite's first active scanline.
- **1 cycle** per byte of pixel data, times 3 bytes = **3 cycles** of s-access
  per active scanline per sprite. However, the VIC groups these accesses; the
  practical CPU stall is approximately **2 cycles of BA-low lead-in** plus the
  s-access window.

With all 8 sprites enabled and active on a single line, the VIC steals
approximately 3 cycles of BA + 2 p-access + 16 s-access = 19+ cycles from the
CPU on that line. On PAL, this reduces the effective CPU budget from 63 cycles
to approximately 44 cycles. On NTSC, from 65 cycles to approximately 46 cycles.

The CPU cannot choose when the stall happens — it is determined by the VIC's
internal DMA schedule, which runs on fixed cycle slots within each line. If an
instruction spans a DMA window, the CPU stalls mid-instruction and resumes when
the VIC releases the bus. The instruction completes correctly but takes more wall
clock cycles than its documented cycle count.

### Fix

Account for sprite DMA in the cycle budget wherever sprites are active on the
IRQ handler's scanline:

| Active sprites on handler line | Cycles stolen (approx.) | Usable cycles PAL | Usable cycles NTSC |
|---:|---:|---:|---:|
| 0 | 0 | 63 | 65 |
| 1 | 2 | 61 | 63 |
| 2 | 5 | 58 | 60 |
| 4 | 9 | 54 | 56 |
| 8 | 19 | 44 | 46 |

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
// The handler body takes 48 cycles as written, but sprite DMA steals 19,
// so total wall-clock consumption is 67 cycles — bleeds into the next line.
sprite_irq_buggy:
    asl $d019               // 6 cycles (read-modify-write)
    lda #BLUE
    sta $d020               // 4 cycles — color write 1
    lda #RED
    sta $d021               // 4 cycles — color write 2
    lda #GREEN
    sta $d022               // 4 cycles — color write 3
    // ... 10 more store pairs = 30 more cycles ...
    // Total: ~48 coded cycles + 19 DMA = 67 actual cycles (OVERFLOW)
    rti

// CORRECT: handler is scheduled on a line where 0 sprites are active,
// OR the handler body is trimmed to fit within 44 usable cycles.
// With 8 sprites: coded body must fit in 44 cycles, not 63.
sprite_irq_correct:
    asl $d019               // 6 cycles
    lda #BLUE
    sta $d020               // 4 cycles
    lda #RED
    sta $d021               // 4 cycles
    // Only 2 color writes: 14 coded cycles + 19 DMA = 33 actual cycles (OK)
    rti
```

### Cross-references

- Technique: `sprite_multiplex_8` — the primary technique that enables 8+
  sprites per frame; its cycle budget section discusses DMA accounting.
- Register: `D015` (SPENA — sprite enable bits; each set bit triggers DMA
  on active lines for that sprite).
- Pitfall: `badline_cycle_loss` — the two cycle thieves stack: a badline on
  a line with 8 active sprites leaves only 20-23 usable CPU cycles on PAL.
