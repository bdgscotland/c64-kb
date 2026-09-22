---
category: raster
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Raster Techniques

The VIC-II's raster counter is not merely a diagnostic readout — it is the primary synchronization primitive for every visual effect on the C64. The chip advances through 312 scanlines per frame on PAL (263 on NTSC), and the CPU can receive an interrupt the moment that counter matches a programmed compare value. That single mechanism, when exploited precisely, allows software to reconfigure VIC-II registers mid-frame: changing colors, switching display modes, adjusting scrolling offsets, repositioning sprites, or opening the hardware borders. Without raster control, the C64 renders one static screen per frame like any unadorned character terminal. With it, the same 1 MHz CPU can drive a completely different visual setup on every single scanline if the coder is willing to account for every cycle.

The discipline required is severe. The VIC-II reads its registers continuously and asynchronously — writes take effect on the current dot clock cycle, not at a "safe" point in the frame. Raster compare IRQs fire with 1-2 cycles of jitter due to the variable instruction-completion behavior of the 6510. Badlines steal 40 cycles per line from the CPU without warning unless the coder explicitly tracks them. Opening the side borders requires a write whose write cycle is one specific cycle of the 63. Every technique in this document exists because the raw mechanism is too imprecise or too resource-hungry on its own, and the C64 demo tradition has refined ways to work around each limitation. Stable raster IRQ is the foundation on which all others rest.

---

## stable_raster_irq — Stable raster IRQ

**Complexity:** medium
**Region:** both
**Uses registers:** SCROLY, RASTER, VICIRQ, IRQMSK

### Why

An ordinary raster IRQ is generated when the VIC-II's internal raster counter matches the 9-bit compare value built from $D012 (low 8 bits) and bit 7 of $D011 (RST8, the 9th bit). The IRQ line goes low, the CPU finishes its current instruction, and then begins the interrupt service sequence (7 cycles: fetch PC high, fetch PC low, push PC high, push PC low, push SR, fetch vector low, fetch vector high). The problem is "finishes its current instruction." The 6510 instruction set has variable-length execution: a simple `LDA #imm` completes in 2 cycles while a `STA ($zp,X)` takes 6. When an IRQ fires mid-instruction the CPU waits out the remainder of that instruction before responding. This means the gap between the VIC raising its IRQ line and the first instruction of the handler executing is not fixed — it varies by however many cycles were left in the interrupted instruction, anywhere from 0 to 6 cycles in practice (most instructions are 2-6 cycles; the 7-cycle BRK is a pathological case).

One or two cycles of jitter sounds trivial. It is not. A write to $D020 (border color) that lands one cycle early produces a visible vertical stripe at the left edge of the border. A sprite multiplex update that arrives one cycle late collides with the previous sprite's DMA window. A mode-switch that jitters by a cycle can corrupt the first row of the display. Stable raster IRQ eliminates this jitter entirely. It is the prerequisite for every technique in this document that requires cycle-exact register writes.

### How

The standard stable raster IRQ technique uses an initial IRQ set one line before the target line. This first IRQ fires, re-acknowledges the VIC interrupt flag, programs $D012 to the actual target line, and then executes a tight busy-wait loop that reads $D012 continuously until the counter advances. When the counter matches, the handler is already spinning at a known point in the loop — the jitter has been consumed waiting. The writes that follow land at a predictable cycle offset from the line boundary.

The sequence is:

1. Set bit 0 of $D01A (IRQMSK) to enable raster interrupts.
2. Write the desired interrupt line number (low 8 bits) into $D012. If the line is >= 256, also set RST8 in $D011.
3. In the IRQ handler: write $01 to $D019 (VICIRQ) to acknowledge the interrupt and clear the VIC's interrupt latch; if this is not done, the IRQ line stays low and the CPU re-enters the handler immediately after RTI.
4. Write the next scheduled interrupt line into $D012.
5. If sub-cycle precision is needed (double-IRQ variant), see the `double_irq` technique.

The cycle-exact busy-wait variation uses two NOP instructions of known cycle count inserted after the $D012 write to absorb the jitter window, landing the following store instructions on a predictable cycle of the target line.

### Why it works

The VIC-II maintains an internal 9-bit raster counter. At the start of each new raster line, the hardware increments this counter and compares it against the 9-bit compare value. If they match AND the raster IRQ mask bit in $D01A bit 0 is set, the chip asserts the IRQ line on the CPU's /IRQ input. The assertion happens on a fixed dot-clock cycle within the line — specifically at the start of the line's first half-cycle, which on PAL corresponds to cycle 1 of the 63-cycle line.

The CPU sees the /IRQ pin go low and responds after completing its current instruction. This variable completion time is the source of jitter. The stable-IRQ technique removes jitter by using the raster counter itself as the synchronization point: after the jitter-introducing interrupt fires and the CPU is in the handler, the handler then polls $D012 in a tight loop. Because the raster line has not yet incremented to the next value, the loop spins for whatever fraction of a cycle budget remains. When $D012 finally increments, every subsequent instruction in the handler runs at a fixed cycle offset from that increment — jitter eliminated.

The re-acknowledge step (write $01 to $D019) is critical. $D019 bit 0 is the raster interrupt flag. It is set by the VIC when the interrupt fires and cleared by writing a 1 to that bit (the register uses write-1-to-clear semantics, similar to CIA interrupt clearing). If the flag is not cleared, the VIC continues asserting /IRQ and the CPU re-enters the handler immediately after RTI. A common defensive pattern also reads $D019 before writing it, to check which interrupt source fired, though in a single-source setup the read is skippable.

### Variations

**Single IRQ with NOP pad.** For effects that only need 0-1 cycle precision, the simplest approach is: fire the IRQ, acknowledge, write a few NOPs of known total cycle count, then perform the register writes. The NOP padding absorbs worst-case jitter without a polling loop. This works when the desired action can tolerate 1-cycle imprecision.

**Double IRQ.** When zero jitter is required, use two IRQs on adjacent lines. The first IRQ sets up the second; the second uses a tightly-counted busy-wait-then-NOP sequence to land on cycle 1 of the target line. See the `double_irq` technique for the full protocol.

**Interrupt vector placement.** On stock C64 with KERNAL ROM enabled, the hardware /IRQ vector at $FFFE/$FFFF points into the KERNAL's IRQ dispatcher ($EA31), which costs about 15 cycles before reaching user code. Patching $0314/$0315 (the KERNAL IRQ vector, which the KERNAL dispatcher jumps through) saves those cycles for user code. Disabling KERNAL ROM and pointing $FFFE/$FFFF directly at the handler removes dispatcher overhead entirely, saving an additional 7-8 cycles, but requires the handler to manage CIA interrupts manually.

**NMI-based raster timing.** Some advanced techniques use the CIA2 timer firing an NMI for raster work to avoid contention with the IRQ chain. Outside scope of this document — see CIA2 reference.

### Cycle budget

On PAL (63 cycles/line), the accounting is:

- VIC raises IRQ at start of target line (cycle 0 of the line, approximately).
- CPU finishes current instruction: 0-6 cycles of jitter consumed here.
- CPU executes interrupt sequence (7 cycles): push PC hi, push PC lo, push SR, fetch vector lo, fetch vector hi, first fetch of handler.
- Handler entry overhead (LDA/STA for acknowledgment): 6-8 cycles.
- Total from IRQ assertion to first usable write: approximately 13-21 cycles depending on jitter and handler style.

With the stable technique consuming jitter via busy-wait, the usable cycle budget for register writes on the target line is 63 - (handler overhead after sync) ≈ 40-50 cycles per line, enough for 10-12 stores. On NTSC (65 cycles/line), the budget is 2 cycles wider per line.

Badlines cost 40 cycles of CPU stall within the line. A handler that fires on a badline loses those cycles before any stores execute. The standard defense is to target the IRQ one line before the badline, perform the writes during that non-bad line, and let the badline pass without stores.

### Recipes

- `recipes/oscar64/stable-raster-irq.md`
- `recipes/kickassembler/stable-raster-irq.md`

---

## raster_bars — Raster color bars

**Complexity:** low
**Region:** both
**Uses registers:** EXTCOL, BGCOL0, RASTER, VICIRQ

### Why

The raster color bar effect — horizontal bands of color cycling down the screen — is the "hello world" of raster programming. It demonstrates that the VIC-II reads $D020 (border color) and $D021 (background color 0) continuously and reflects any change immediately on the current raster line. A palette of 16 colors times up to 200+ raster lines per frame means a wide design space with minimal hardware cost: the CPU is simply writing two bytes per line.

Beyond its introductory status, raster bars are a practical building block. Status bars in games typically change the background color at the display mode boundary. Gradient fills simulate additional colors. Parallax bars suggest depth. The technique also serves as a timing diagnostic: if a bar bleeds across lines, a cycle-exact write is arriving late.

### How

The basic sequence in an IRQ handler is:

1. Write the new border color to $D020.
2. Write the new background color to $D021.
3. Advance $D012 to the next target line (the next bar boundary) and acknowledge $D019.
4. Return from interrupt (RTI).

For a smooth color gradient covering many lines, a more efficient approach is to chain multiple IRQs in a ring: each handler writes the current line's colors, advances $D012 by N lines, and exits. The IRQ fires again N lines later for the next color in the palette. This chaining pattern is the foundation for all multi-split raster effects.

For an effect that changes color on every single line (a "rainbow" effect), the handler must write $D020/$D021 in fewer than 63 cycles total — feasible without badline interference, but the 40-cycle badline stall makes single-line changes on badline rows require special handling (typically by writing the badline's color in the preceding line's IRQ, since the CPU is stalled on the badline itself).

### Why it works

The VIC-II reads $D020 and $D021 once per dot-clock cycle during horizontal raster generation. The color value fetched at any given dot position determines the color of that dot. Because the 6510 and VIC-II share the bus via the phi1/phi2 clock scheme, a CPU write to $D020 takes effect at the phi2 edge of the write cycle — which corresponds to the dot position being generated approximately 2 clock cycles after the write. This 2-cycle offset is the same on both PAL and NTSC and is constant, making it predictable for cycle-exact color placement.

The key architectural fact: there is no buffering. Unlike systems with scanline-latched registers, the VIC-II's color registers are transparent — they reflect writes immediately. This means writing too late by one cycle shifts the color right by 2 dots, not onto the next line. The visible effect of a 1-cycle timing error is a fine vertical seam, not a full-line displacement.

### Variations

**Background only.** Write $D021 only, leaving $D020 constant. Produces color bands within the display area without affecting the border.

**Border only.** Write $D020 only. Useful for status bars and frame decorations that must not disturb the display area.

**Gradient via lookup table.** A 16-byte (or 32-byte cycled) table of color values in zero page, indexed by a counter incremented in each IRQ entry, produces a smooth color gradient that can be shifted by adjusting the starting index — a "rotating rainbow" without any compute per frame.

**Parallax bars.** Two separate bar sequences at different speeds — one for background, one for border — shifted by different amounts each frame. Gives a depth illusion cheaply.

**Wide bars with single IRQ per bar.** Program $D012 to the start of each bar region. Within the bar, use NOP padding or a per-line loop to maintain the color for the bar's height. More efficient for tall bars than firing one IRQ per line.

### Cycle budget

Each IRQ on a non-badline has roughly 50-55 usable cycles after overhead. Writing $D020 and $D021 costs 8 cycles (two `STA abs` at 4 cycles each). Acknowledging $D019 and setting $D012 costs another 10 cycles. Total per-IRQ overhead is approximately 25-30 cycles, leaving 20-25 cycles for other work in the same handler. On a badline, the 40-cycle stall removes almost all work budget; designs that change color on badline rows typically write the color value one line early.

### Recipes

- `recipes/oscar64/raster-bars.md`
- `recipes/kickassembler/raster-bars.md`

---

## badline_synchronization — Badline synchronization

**Complexity:** high
**Region:** PAL

**Uses registers:** SCROLY, RASTER

### Why

The badline is not optional — it is the price the VIC-II extracts from the CPU eight times per character row. During a badline, the VIC-II needs to fetch the full 40-character screen codes for the current text row. It does this by asserting BA (Bus Available) low for 40 cycles and then stealing the phi2 bus from the CPU for those cycles. The CPU cannot execute memory reads or writes during this window; it can only continue internal processing of its current instruction if that instruction has no remaining bus cycles. In practice the effect is a 40-cycle stall inserted into the CPU's execution stream.

The cycle loss is large enough to invalidate any timing assumption made without accounting for it. A raster effect that writes 8 registers per line works on non-bad lines but silently slips by 40 cycles on badlines, producing visible glitches. Badline synchronization is the practice of knowing exactly which lines are bad (and therefore where the stalls fall), structuring IRQ handlers to either avoid critical writes on bad lines or explicitly account for the 40-cycle deduction when they must happen on one.

### How

The first step is understanding when badlines occur. A badline fires when two conditions are simultaneously true: the display is enabled (DEN bit in $D011 bit 4 is set, and it was set during cycle 14 of raster line $30 which latches the "DEN for this frame" flag), and the low three bits of the current raster line number equal the YSCROLL value in $D011 bits 2-0. With the default YSCROLL of 3, badlines occur at raster lines 51, 59, 67, ... 243 — every 8th line starting at $33, for a total of 25 badlines per frame on PAL.

Because badlines are deterministic given a fixed YSCROLL, the coder can build a lookup table of "line type" (bad vs non-bad) and schedule IRQ handlers to fire only on non-bad lines when cycle budgets are tight. Alternatively, a handler that fires on every line can subtract 40 from its available cycle count on badlines and ensure only that many cycles of work are attempted.

The second control lever is YSCROLL itself. Writing a new YSCROLL value to $D011 bits 2-0 changes which lines are bad. This is dangerous to do mid-frame without care — see the `raster_split_modes` technique — but it can be used deliberately to move the badline cluster away from a critical raster window.

A third approach used in scene-quality code is to account for badlines at assembly time by building the raster handler as a sequence of cycle-counted instruction blocks, with alternate blocks for bad and non-bad variants selected by a look-up at handler entry.

### Why it works

The VIC-II needs character codes to generate text-mode output. The chip cannot display any character without knowing which character is in each of the 40 cells of the current row. It fetches these from screen RAM (video matrix), which lives in the VIC bank and is not accessible during the CPU's phi2 cycles — the VIC needs the bus to itself. The chip raises BA (bus available) signal three cycles before it actually needs the bus. The CPU, seeing BA low, knows it cannot issue further memory accesses but completes any instruction that has no remaining memory cycles. After 3 cycles, the VIC takes the phi2 bus for 40 cycles of screen RAM fetch, then releases it. The CPU resumes.

The timing is locked to the YSCROLL field because the VIC increments its internal row counter on each badline. The row counter increments when `(current_raster_line & 7) == YSCROLL`. The first badline of a frame must occur while DEN is set, or badlines are suppressed for the entire frame — a technique called "blinking DEN" that blanks the display and gives the CPU all cycles back.

NTSC behaves identically in terms of which lines are bad (same YSCROLL logic), but the cycle loss (40 cycles) and the available cycles per line (65 on NTSC vs 63 on PAL) mean the badline penalty as a fraction of a line's budget is slightly lower on NTSC. However, NTSC has fewer total lines per frame, so the absolute number of badlines per frame is also lower (24 instead of 25 for a full 25-row display).

### Variations

**Badline avoidance.** Schedule IRQs to fire on non-bad lines only. Works when the effect can tolerate one line of imprecision in its split position. Most game status bars use this — nobody notices a 1-pixel vertical shift in the status bar boundary.

**Badline accounting.** Explicitly include the 40-cycle stall in the cycle budget for every handler that can fire on a bad line. The handler can poll $D012 at entry to determine if it is on a bad line and take one of two code paths.

**YSCROLL manipulation.** Write $D011 bits 2-0 to shift the YSCROLL value, moving badlines to a range that doesn't interfere with a critical effect window. Must be done carefully — changing YSCROLL mid-frame can cause FLD (Flexible Line Distance) effects if not done at the precise right cycle. See also `raster_split_modes`.

**DEN suppression.** Clear bit 4 of $D011 (DEN). The display blanks entirely and badlines stop firing — the CPU gets all 63/65 cycles per line. Used in raster bars that cover the entire screen or in effects where the display is generated entirely by sprites or is intentionally blanked.

### Cycle budget

PAL, non-badline: 63 cycles total.
PAL, badline: 20 cycles guaranteed (cycles 1-11 and 55-63). The VIC pulls BA low on cycle 12 and takes the bus for its 40 c-accesses on cycles 15-54; on cycles 12-14 the CPU may only complete write cycles, so "23" is the figure for code that happens to be writing then, and 20 is the one to plan on.
NTSC, non-badline: 65 cycles total.
NTSC, badline: 22 cycles guaranteed, 25 with three write cycles.

For cycle-tight code running on every line, the badline constraint means the worst case is 20 cycles per line on PAL. Any per-line loop must complete in 20 cycles or less to be badline-safe, or must handle the bad-line case separately. Note also that a badline moves every later instruction on that line by 40 cycles: a write planned for cycle 56 cannot be placed there at all, because no read can happen between cycles 12 and 54 and every store's write follows a read.

### Recipes

(No standalone recipe yet — badline synchronization is a prerequisite skill embedded in stable-raster-irq and other recipes.)

---

## double_irq — Double IRQ for jitter elimination

**Complexity:** scene-tier
**Region:** both
**Uses registers:** RASTER, VICIRQ, IRQMSK

### Why

The stable_raster_irq technique reduces jitter to a fraction of a cycle by using a polling loop. However, the polling loop itself has a granularity of one complete loop iteration — typically 5-7 cycles. This means the "stable" IRQ synchronizes to within one loop iteration, not to within one cycle. For the most demanding scene-quality raster work — side-border opening, VSP glitch timing, hardware-sprite multiplexing at exact cycle offsets — even one or two cycles of residual jitter is unacceptable.

The double IRQ technique achieves true zero-jitter synchronization. The CPU's position on the target raster line is known to within one cycle.

### How

The double IRQ uses two raster IRQ handlers, set on two consecutive raster lines. The first IRQ (line N) does minimal work: it re-acknowledges $D019, sets $D012 to line N+1, and exits with RTI. Because this IRQ does almost nothing, its execution is fast and repeatable. The second IRQ (line N+1) uses a precise sequence of instructions chosen to consume exactly the right number of cycles to land at a specific cycle position within line N+1, regardless of the jitter that affected the first IRQ.

The classic implementation of the second handler uses a sequence like:

- At IRQ entry, the handler immediately acknowledges $D019.
- It then executes a tight sequence of instructions with a total known cycle count, padded with NOP instructions if needed, to reach cycle C of line N+1.
- The register write that must be cycle-exact happens at cycle C.

The reason two IRQs work better than one: the first IRQ absorbs all the jitter from the unknown instruction-completion state at IRQ entry. By the time the first IRQ completes and the second fires, the processor is executing a known, counted instruction stream from the end of the first RTI. The second IRQ fires at a fully predictable time relative to the raster line.

### Why it works

The 6510's interrupt response adds a 7-cycle fixed overhead once jitter is absorbed. After the first IRQ's RTI executes, the processor returns to whatever was running between IRQs (usually a tight NOP loop or a `JMP *` halt). The second IRQ fires at line N+1's line 0 cycle, the CPU finishes the current instruction (in the loop body, this is a known NOP or similar), and enters the second handler with precisely known timing.

The mathematical foundation: let `J1` be the jitter in the first IRQ (0-6 cycles). The first handler executes `K1` cycles of work. At RTI, the processor has consumed `J1 + 7 + K1` cycles since the first IRQ fired. Because the first IRQ fired near line N's boundary, RTI returns somewhere within line N or just into line N+1. The second IRQ fires at the same cycle within line N+1 — but now the CPU was executing a known instruction (NOP) between the handlers. The jitter on the second IRQ entry is determined by how far into the NOP the second IRQ arrived, which is known.

The combination of knowing the instruction between IRQs (always a NOP in the loop) and knowing the second IRQ fires at a fixed cycle within its line is what eliminates jitter entirely.

### Variations

**NOP-padded single entry.** Some implementations fold the double-IRQ logic into a single handler that spins until the raster counter advances, then executes a counted NOP sequence to reach the target cycle. This is cleaner to write but harder to reason about cycle-exactly. The explicit two-handler approach is preferred for documentation and maintenance.

**IRQ set on same line.** A variant sets both IRQs to the same $D012 value. The first fires normally; because the VIC's raster interrupt latches immediately, the second $D012 write (to the same value) causes the IRQ to fire again on the next frame at that same line — but this requires the handler to track which "fire" it is on, typically via a flag byte.

**CIA timer second stage.** Some extreme cases use a CIA timer started in the first IRQ handler to fire a second IRQ a counted number of cycles later, decoupling the second trigger from raster line boundaries entirely. This is used for effects that require a write at a specific horizontal dot position across multiple lines.

### Cycle budget

The double-IRQ technique's purpose is to minimize jitter rather than save cycles — it actually spends more cycles than a sloppy single IRQ. The overhead is:
- First IRQ: 7 (enter) + ~12 (ack + set $D012 + RTI) = ~19 cycles consumed on line N.
- Between IRQs: the NOP loop in the main loop body executes for however many cycles remain in line N after the first RTI — variable but bounded.
- Second IRQ: 7 (enter) + NOP pad (0-6 cycles) + actual writes.

Total cost per raster split in double-IRQ mode: approximately 35-45 cycles spread across two lines, vs 20-30 cycles for a sloppy single-IRQ split.

### Recipes

- `recipes/kickassembler/stable-raster-irq.md` (includes double-IRQ pattern)

---

## vsp_glitch — VSP (Variable Screen Position)

**Complexity:** scene-tier
**Region:** PAL

**Uses registers:** SCROLX, SCROLY

### Why

The VIC-II's character-mode display is generated by fetching screen codes from a 40-column video matrix. The VIC fetches one row of 40 characters per character row during badlines, assembling pixel data from character ROM or character RAM to fill the 8 pixel rows between badlines. This architecture means horizontal scrolling can be accomplished by adjusting $D016 bits 2-0 (XSCROLL) to shift the display by up to 7 pixels, but going further — shifting by more than 7 pixels — requires changing the start address of the video matrix, which only takes effect at the beginning of the next character row.

VSP (Variable Screen Position) is a hardware glitch, not a designed feature, that allows mid-character-row screen address changes to take effect immediately by manipulating when the VIC-II thinks a new character row is beginning. The result is pixel-perfect horizontal scrolling independent of the 7-pixel XSCROLL limit, and it requires no extra memory or display-mode changes — it works within standard text mode.

### How

The VSP glitch is triggered by toggling $D016 bit 3 (CSEL — column select, 38/40 column toggle) at a specific cycle within the raster line. Normally CSEL determines whether the display shows 40 columns (CSEL=1) or 38 columns (CSEL=0). The VIC-II uses CSEL to determine the horizontal extent of the active display window. Crucially, the chip also uses the CSEL state to decide when to begin fetching screen data for the next row.

By toggling CSEL from 1 to 0 and back to 1 at cycle 56 of a raster line (the precise timing that exploits the glitch), the VIC-II is tricked into thinking the current character row has ended and a new one is starting. This causes the chip to advance its internal video matrix row pointer one character row early. If the video matrix base address in $D018 has been updated between the trick cycle and the fetch, the new address takes effect for the advancing row.

The net effect: by applying the VSP trigger to each raster line of a character row and updating the video matrix pointer, the horizontal display address can be advanced by any number of character columns on any line — enabling smooth, unlimited horizontal scrolling within standard 40-column text mode.

### Why it works

The VIC-II's internal VC (video counter) advances by 40 on each badline and resets at the top of the display. The chip uses VC to address into the video matrix. When VSP is triggered, the chip's state machine is confused into incrementing VC by 40 prematurely — as if a badline had occurred at a non-badline position. The fetch that follows uses the new VC value, which points to a different 40-character window in the video matrix.

The effect is cycle-exact. The CSEL toggle must hit within approximately a 2-cycle window at cycles 55-56 of the raster line on PAL. Outside this window, toggling CSEL is harmless (it only affects the width of the display border). Inside this window, it corrupts the VIC's row-counter state in the specific, exploitable way that produces VSP.

This is a documented-undocumented effect: it appears in the Commodore 64 Programmer's Reference Guide in no form, but it was discovered empirically by demo coders and is reproduced accurately by the VICE emulator as of version 2.x. The timing is specific to the 6569 (PAL) and varies slightly between the NMOS and HMOS-II parts; NTSC versions of the VIC-II do not exhibit the same glitch at the same cycle positions.

### Variations

**Full-screen VSP scroll.** Apply the trigger on every line of every character row, updating the video matrix address each time. This produces unlimited horizontal pixel scrolling across the full 40-column display. The runtime cost is high: each line requires a cycle-exact CSEL toggle plus a $D018 update, leaving approximately 30 cycles per line for other work.

**Partial-screen VSP.** Apply VSP only to the character rows comprising a horizontal scroll zone. Rows above and below scroll normally or are static. Used in games that need wide scrolling for a play field but want a fixed HUD above and below.

**VSP with multi-color mode.** The same VC corruption occurs in multi-color character mode. The video matrix pointer advances the same way; only the pixel data interpretation changes. No additional technique work required.

### Cycle budget

PAL only. The VSP trigger window is approximately cycles 55-56 out of 63 per line (the exact cycle depends on the CSEL value and the HMOS vs NMOS variant of the VIC-II). On a badline, the CPU is stalled during cycles 15-54 and cannot execute the trigger — VSP cannot be applied on badlines. Because badlines occur every 8 lines within the display area, a full-screen VSP scroll must handle 7 out of 8 lines per character row with the trigger, and deal with the badline the VIC generates naturally.

Per-line cost: the CSEL write at cycle 55 is a 4-cycle `STA abs`; the restore at cycle 57 is another 4 cycles; the video matrix update is another 4 cycles. Total: 12 cycles per triggered line, leaving 51 usable cycles on non-badlines (PAL).

### Recipes

(No standalone recipe yet — VSP is primarily a KickAssembler technique given its cycle-exact assembly requirements.)

---

## sideborder_open — Open the side border

**Complexity:** high
**Region:** both
**Uses registers:** SCROLX

### Why

The VIC-II renders the side (left and right) borders as a solid color region flanking the active display area. In the default 40-column mode (CSEL=1 in $D016 bit 3), the visible left border spans from the left edge of the screen to approximately dot position 24, and the right border spans from dot position 344 to the right edge. Hardware sprites can be positioned anywhere horizontally, including within the border area — but only if the border is suppressed. If the border is not suppressed, sprite pixels that land in the border region are occluded by the border color.

Opening the side borders means suppressing the border rendering so that sprites appear on a background-color area rather than behind a fixed-color wall. This is indispensable for sprite multiplexing that uses all 8 sprites across the full horizontal width of the screen, for 24+ sprite systems that require sprites in the border to achieve higher counts, and for any visual design that extends graphics to the display edges.

### How

The side border is suppressed by toggling $D016 bit 3 (CSEL) from 1 to 0 and back to 1 at a specific cycle within each raster line. The VIC-II uses CSEL to determine the horizontal extent of the active display window and correspondingly when to render border color vs display color. When CSEL transitions from 1 to 0 at the right cycle, the chip interprets the display window as having ended (and border as having begun) slightly earlier than it would otherwise — but if CSEL is quickly returned to 1, the chip is confused into not rendering the border for the right portion of the line.

The precise window: write $D016 with CSEL=0 at cycle 55 (PAL), and $D016 with CSEL=1 at or before cycle 56. This causes the VIC to suppress the right side border for the remainder of the current line. The left side border requires a separate toggle — write CSEL=0 at cycle 0-1 of the line and restore CSEL=1 before the active display starts at cycle 12-13. Both toggles must be performed on every line where border suppression is wanted.

### Why it works

The VIC-II's border logic is a state machine that transitions between "border mode" and "display mode" based on the horizontal dot counter reaching specific values that depend on CSEL. Specifically: with CSEL=1, the display window starts at dot position 24 and ends at dot position 344. With CSEL=0, those boundaries are 31 and 335 instead (the 38-column mode). The state machine latches the transition state on specific cycles, not on the register value itself.

By toggling CSEL between values at the right cycles, the state machine can be made to latch "display mode starts here" based on the CSEL=0 boundary, then see CSEL=1 while still outside the CSEL=1 boundary, putting it in a state where the border suppressor is confused. The chip stops rendering the border color for that region.

This is not a glitch in the sense of unexpected behavior — the VIC-II behavior is fully deterministic and reproducible. It is a consequence of the sequential, cycle-exact register read behavior of the chip and has been documented extensively by the C64 demo community since the late 1980s.

The right side border and left side border require separate toggles because the VIC-II's horizontal state machine has separate transition points for the left and right boundaries. PAL allows a 23-cycle window for the critical right-border toggle; NTSC allows 25 cycles. The left border toggle window is similarly tight.

### Variations

**Right border only.** Open only the right border by performing only the cycle-55 CSEL toggle. The left border remains visible. Used when sprites only extend into the right edge.

**Full-width open on every line.** Perform both the left and right border toggles on every display line. Requires approximately 16 cycles per line for the two pairs of CSEL writes. On badlines, the CPU stall means the cycle-exact CSEL write must be handled carefully — typically the writes are pre-computed and the raster handler adjusts its loop entry point on badlines.

**Selective line opening.** Open the border on only the lines where sprites appear. For a sprite multiplexer, the border is opened only on lines covered by sprites, closed on lines between sprites. Saves cycles on blank lines.

### Cycle budget

PAL: the border flip-flop is set at X=335 when CSEL=0 and at X=344 when CSEL=1, which the beam reaches on cycles 55 and 56. CSEL must go from 1 to 0 between those two comparisons, so the write cycle that clears it has to be cycle 56, a one-cycle window. There is no separate left-border toggle: once the flip-flop has not been set on the right, the next line's left border is not drawn either. CSEL goes back to 1 any time before the next line's cycle 55.

Per-line cost: one `DEC $D016` (6 cycles, new value written on its last cycle) and one `INC $D016` to restore, 12 cycles, plus whatever keeps the loop at exactly 63. On a badline it cannot be done at all: the CPU has no read cycle between 12 and 54, and a write on 56 needs a read on 55 at the latest, which puts the write on 58. Side-border regions are therefore badline-free (idle display, or YSCROLL rewritten each line) or accept a closed border on badline rows. With sprites active the write still lands: BA drops on cycle 55 for sprite 0, the 6510 completes up to three write cycles after BA drops, and `DEC`'s two writes are on 55 and 56. See `recipes/kickassembler/sideborder-open.md`, where this is measured.

Border-opening IRQ overhead combined with a sprite multiplex update on the same line can push the line's cycle budget into deficit on badlines. The standard mitigation is to move the sprite Y coordinate update to the preceding line.

### Recipes

- `recipes/kickassembler/sideborder-open.md`

---

## topbottom_border_open — Open the top/bottom border

**Complexity:** high
**Region:** both
**Uses registers:** SCROLY

### Why

The VIC-II's top and bottom borders are solid-color regions above and below the active display rows. In 25-row mode (RSEL=1, $D011 bit 3 set), the display area spans raster lines 51-250 and the borders fill lines 16-50 (top) and 251-299 (bottom) on PAL. In 24-row mode (RSEL=0), the display area shrinks to lines 55-246 and the borders expand correspondingly.

Opening the top and bottom borders allows the full frame — minus only the genuine vertical blanking interval — to render sprites and bitmap data, extending the effective display height from 200 pixels to roughly 240 on PAL (approximately 192 on NTSC). This is used for effects that require full-frame coverage: overscan demos, raster bars that extend into the borders, sprite effects that "bleed" above and below the traditional display area.

Hardware sprites can be positioned at any Y value 0-255 and will render wherever they land. Opening the top/bottom border does not enable additional sprite rendering per se — sprites already render in the border area when their Y position places them there. What border opening does is suppress the border color so that the background color shows through instead, making any sprites or bitmap data in that region visible.

### How

The top/bottom border suppression works by toggling $D011 bit 3 (RSEL) from 1 to 0 and back to 1 at specific raster line numbers. The VIC-II uses RSEL to determine the start and end of the active display area vertically. Toggling RSEL at the lines adjacent to the border boundaries confuses the VIC's vertical state machine into not entering border mode.

The sequence:

- To open the bottom border: write $D011 with RSEL=0 on raster line 248 (decimal), then restore RSEL=1 on raster line 252 or later. The chip's bottom-border transition logic fires at line 251 with RSEL=1, but if RSEL=0 it fires at line 247 — toggling between these values crosses the transition point in a way that prevents the bottom border from activating.
- To open the top border: write $D011 with RSEL=0 on raster line 55 (one line after the last possible top-border-close point), then restore RSEL=1 before line 51 of the next frame. The logic is symmetric.

In practice, a demo using this technique sets RSEL=0 near the end of the display area and RSEL=1 near the beginning, permanently suppressing the top and bottom borders for every frame where those writes land at the right raster lines.

### Why it works

The VIC-II maintains a vertical border flag (VBORDER) that is set and cleared based on the raster counter reaching specific lines — lines 51/$33 (display start) and 251/$FB (display end) in 25-row mode, or 55/$37 and 247/$F7 in 24-row mode. When VBORDER is set, the chip outputs border color rather than display data. The flag is latched based on RSEL at the transition point.

By toggling RSEL from 1 to 0 before the end-of-display transition at line 251 (making the chip look for the 24-row boundary at 247 instead) and then back to 1 after that line, the chip never sets VBORDER because neither transition point is hit cleanly. The flag stays cleared, and the border is not rendered.

The horizontal borders are not affected by this technique; RSEL only governs the vertical extent of the display area. Sprites and background color show through in the opened border area because the chip is outputting display-mode data (background color, or bitmap/character cell data) instead of border-mode data.

### Variations

**Bottom border only.** Suppress only the bottom border by performing the RSEL toggle around line 248-252. The top border remains visible. More common in demos that want floor effects or a status bar at the bottom of a large display.

**Top border only.** Symmetric with bottom-border-only. Less common because the top border is narrower on PAL (approximately 35 lines vs the bottom's ~50 usable lines).

**Full vertical open with sprite coverage.** Open both borders and position 8 sprites to tile vertically across the entire frame (possible because sprites at Y positions above the visible area wrap around in the sprite's own 0-255 coordinate space). Combined with sprite multiplexing this covers nearly the full frame height with sprites.

**RSEL held at 0 for the full frame.** This permanently opens both borders and also shifts the top of the display area down to line 55 and the bottom up to line 247, shrinking the display area by 4 lines top and bottom while opening the border regions. Not typically used for border opening since it shrinks the display, but useful to know the side effect.

### Cycle budget

The top/bottom border toggle is not cycle-exact in the same way as sideborder_open. The writes need to land on the correct raster line number, which is a coarser target than a specific cycle within a line. A raster IRQ set to fire on line 248 with any reasonable handler latency will hit the correct line in time to write RSEL=0. The write just needs to land before the end of line 248.

However, RSEL is part of $D011 which also carries YSCROLL (bits 2-0), the display mode bits ECM and BMM (bits 6 and 5), and DEN (bit 4). A read-modify-write is required to toggle only RSEL without disturbing the other bits. The RMW sequence costs 3 cycles (LDA abs, AND or ORA imm, STA abs = 4+2+4 = 10 cycles). Plan for 10-12 cycles per toggle.

### Recipes

(No standalone recipe yet — typically bundled with sideborder-open in full-border-open demos.)

---

## raster_split_modes — Mid-frame display mode change

**Complexity:** medium
**Region:** both
**Uses registers:** SCROLY, SCROLX, VMCSB

### Why

The VIC-II supports four display modes: standard character mode (text), multicolor character mode, standard bitmap mode, and multicolor bitmap mode. (Extended Background Color mode is a fifth but is rarely used and is effectively mutually exclusive with sprites and multicolor). Each mode is selected by the combination of $D011 bit 5 (BMM, bitmap mode), $D011 bit 6 (ECM, extended background color), and $D016 bit 4 (MCM, multicolor mode).

Changing these mode bits mid-frame via a raster IRQ switches the display from one mode to another at the target scanline. This is the fundamental mechanism behind one of the most common C64 screen layouts: a full-resolution or multicolor bitmap for the game or demo canvas, with a character-mode status bar at the top or bottom of the screen. On a single-display-mode system this layout would be impossible. With raster mode splits it is standard.

The technique also underlies FLI (Flexible Line Interpretation) and IFLI effects, where mode bits and memory pointers are changed on every single line to defeat the VIC-II's 8-pixel-tall color attribute resolution. FLI is a separate technique (out of scope for this document), but the per-line mode change it uses is a direct extension of raster_split_modes at the limit of 1 IRQ per line.

### How

The mode change sequence in a raster IRQ handler:

1. Write $D011 to set or clear BMM and/or ECM for the new mode.
2. Write $D016 to set or clear MCM for the new mode.
3. Write $D018 to point to the video matrix and character/bitmap base for the new mode's data.

All three writes should be performed as close together as possible and as close to the start of the target line as possible, to avoid partial-line glitches. Writing $D011 a cycle late while $D016 has already been written produces an undefined intermediate mode for one cycle, which can manifest as pixel garbage on the first character position of the split line.

The mode change can happen anywhere in the frame: top to bottom, multiple splits, alternating modes, or even per-line cycling. The only constraint is cycle budget per line.

### Why it works

The VIC-II decides how to decode pixel data (and whether to fetch character ROM/RAM or bitmap data) on a per-character-cell basis within each row. The mode registers ($D011 bits 5-6, $D016 bit 4) are read by the chip as it generates each 8-pixel horizontal span. A write to these registers takes effect on the current or immediately next character cell boundary.

The display mode and the data pointer ($D018) govern three separate things: how pixel bits are interpreted (character vs bitmap), whether two bits per pixel (multicolor) or one bit per pixel (hires) is used, and where in the VIC bank the data lives. Changing $D018 mid-frame redirects character or bitmap fetch to new addresses starting with the next character cell; the change is not batched to the next frame. This allows per-row (or per-line) memory pointer changes without a frame boundary.

The YSCROLL field ($D011 bits 2-0) interacts with mode changes: if YSCROLL changes simultaneously with the mode bits, the VIC may trigger a spurious badline (if the new YSCROLL value matches the current `(raster & 7)` condition). To avoid this, keep YSCROLL constant across mode splits, or change it in a separate write on a line where a badline is acceptable.

### Variations

**Bitmap canvas with text status bar.** The most common application: bitmap mode for lines 50-200, character mode for lines 201-250 (or vice versa). $D018 points to bitmap data in the upper half of the frame and character data in the lower half. One raster IRQ handles the switch; another switches back at the top of the next frame.

**Multiple mode zones.** Three or more display mode regions in a single frame. Each transition requires one raster IRQ. With 16 IRQ slots in Oscar64's rasterirq system, up to 16 transitions per frame are possible.

**Per-line FLI preparation.** Set up mode bits and $D018 on every single line to defeat attribute color resolution. Full FLI implementation requires writing $D018 and possibly $D011 YSCROLL on every line within the FLI zone. This is a distinct and very demanding technique but shares the mode-change mechanism exactly.

**Multicolor-to-hires split.** Switch from multicolor character mode to hires character mode mid-frame. Used for effects where the upper portion of the screen uses 4-color characters and the lower uses high-resolution black-and-white data.

### Cycle budget

Each raster split costs: 3 writes ($D011, $D016, $D018) × 4 cycles = 12 cycles minimum. With IRQ overhead (13-20 cycles), a mode split consumes approximately 25-35 cycles on the split line.

On a badline, a mode-split IRQ has only 20 usable cycles on PAL (cycles 1-11 and 55-63; 12-14 for writes only). A 12-cycle triple write fits, but combined with IRQ overhead it is tight. The standard mitigation is to position the mode split on a non-badline.

YSCROLL manipulation during a mode split requires a fourth write to $D011 — but since $D011 carries both YSCROLL and mode bits, the YSCROLL write and the mode-bit write must be combined into one read-modify-write, costing 10 cycles instead of 4 for two separate stores. If the mode bits and YSCROLL value are known in advance, a precomputed combined value can be stored directly in 4 cycles.

The $D018 write is the most timing-sensitive of the three. The character/bitmap base address latched for the current character row comes from $D018 read at the beginning of the badline fetch for that row. If the $D018 write does not arrive before that fetch, the old base address is used for the first 8 lines of the new mode zone. Target the raster split IRQ at the line immediately before the first badline of the new zone to guarantee the $D018 update lands before the fetch.

### Recipes

(Standalone recipe not yet written — raster_split_modes is demonstrated as part of larger demo or game layout recipes.)
