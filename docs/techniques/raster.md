---
category: raster
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Raster Techniques

The VIC-II's raster counter is not merely a diagnostic readout — it is the primary synchronization primitive for every visual effect on the C64. The chip advances through 312 scanlines per frame on PAL (263 on NTSC), and the CPU can receive an interrupt the moment that counter matches a programmed compare value. That single mechanism, when exploited precisely, allows software to reconfigure VIC-II registers mid-frame: changing colors, switching display modes, adjusting scrolling offsets, repositioning sprites, or opening the hardware borders. Without raster control, the C64 renders one static screen per frame like any unadorned character terminal. With it, the same 1 MHz CPU can drive a completely different visual setup on every single scanline if the coder is willing to account for every cycle.

The discipline required is severe. The VIC-II reads its registers continuously and asynchronously — writes take effect on the current dot clock cycle, not at a "safe" point in the frame. Raster compare IRQs fire with 0–6 cycles of jitter due to the variable instruction-completion behavior of the 6510 (an earlier version of this sentence said 1-2). Badlines steal 40-43 cycles per line from the CPU (plan on 43) without warning unless the coder explicitly tracks them. Opening the side borders requires a write whose write cycle is one specific cycle of the 63. Every technique in this document exists because the raw mechanism is too imprecise or too resource-hungry on its own, and the C64 demo tradition has refined ways to work around each limitation. Stable raster IRQ is the foundation on which all others rest.

---

## stable_raster_irq — Stable raster IRQ

**Complexity:** medium
**Region:** both
**Uses registers:** SCROLY, RASTER, VICIRQ, IRQMSK
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=124, lines_active=2, irq_slots=1, zp_bytes=0
**Cost basis:** arithmetic

### Why

An ordinary raster IRQ is generated when the VIC-II's internal raster counter matches the 9-bit compare value built from $D012 (low 8 bits) and bit 7 of $D011 (RST8, the 9th bit). The IRQ line goes low, the CPU finishes its current instruction, and then begins the interrupt service sequence (7 cycles: two dummy-read cycles, push PC high, push PC low, push P, fetch vector low, fetch vector high; the handler's first opcode fetch follows — an earlier version listed "fetch PC high, fetch PC low" as steps, which they are not: the PC is pushed, not fetched). The problem is "finishes its current instruction." The 6510 instruction set has variable-length execution: a simple `LDA #imm` completes in 2 cycles while a `STA ($zp,X)` takes 6. When an IRQ fires mid-instruction the CPU waits out the remainder of that instruction before responding. This means the gap between the VIC raising its IRQ line and the first instruction of the handler executing is not fixed — it varies by however many cycles were left in the interrupted instruction, anywhere from 0 to 6 cycles in practice (most instructions are 2-6 cycles; the 7-cycle BRK is a pathological case).

Up to six cycles of jitter sounds trivial. It is not. A write to $D020 (border color) that lands one cycle early produces a visible vertical stripe at the left edge of the border. A sprite multiplex update that arrives one cycle late collides with the previous sprite's DMA window. A mode-switch that jitters by a cycle can corrupt the first row of the display. Stable raster IRQ eliminates this jitter entirely. It is the prerequisite for every technique in this document that requires cycle-exact register writes.

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

**Interrupt vector placement.** With the KERNAL ROM in, the hardware vector at $FFFE/$FFFF points at the KERNAL dispatcher at $FF48, which pushes A, X and Y, checks for BRK and jumps through $0314/$0315: 29 cycles before the first instruction of whatever $0314 points at. Patching $0314 is the normal way in and pays all 29. Banking the KERNAL out and pointing $FFFE/$FFFF at the handler removes the dispatcher, leaving the 7-cycle interrupt sequence plus whatever registers the handler saves itself, at the cost of servicing CIA interrupts and the keyboard yourself.

**NMI-based raster timing.** Some advanced techniques use the CIA2 timer firing an NMI for raster work to avoid contention with the IRQ chain. Outside scope of this document — see CIA2 reference.

### Cycle budget

On PAL (63 cycles/line), the accounting is:

- VIC pulls /IRQ low at the start of cycle 1 of the target line (cycle 2 for line 0). An earlier version said "cycle 0"; cycle numbering in this knowledge base starts at 1.
- CPU finishes current instruction: 0-6 cycles of jitter consumed here.
- CPU executes interrupt sequence (7 cycles): two dummy-read cycles, push PC high, push PC low, push P, fetch vector low, fetch vector high; the handler's first opcode fetch follows. (An earlier version counted the handler's first fetch inside the 7; it is the handler's own first cycle.)
- Entry path: with the KERNAL banked out and $FFFE/$FFFF pointing at the handler, nothing more; through the KERNAL vector, the $FF48 dispatcher adds 29 cycles before the first instruction at $0314 (see Interrupt vector placement).
- Handler entry overhead (LDA/STA for acknowledgment): 6-8 cycles.
- Total from IRQ assertion to first usable write: approximately 13-21 cycles with the KERNAL out, 42-50 through $0314 (handler entered on cycle 37-43; measured in VICE, `recipes/kickassembler/stable-raster-irq.md`). An earlier version gave only 13-21 and did not name the entry path.

Once the busy-wait has synced to the next line boundary the budget on that line is ~55 cycles whichever way the interrupt was entered — the entry cost is paid on the arming line, which is why the IRQ is set one line early. Without a sync, on the arming line itself, about 50 cycles remain with $FFFE pointing at the handler (KERNAL out) and about 20 through $0314 (handler entered on cycle 37-43; see Interrupt vector placement). An earlier version gave 40-50 without saying which entry path. On NTSC (65 cycles/line), the budget is 2 cycles wider per line.

Badlines cost 40-43 cycles of CPU stall within the line (plan on 43; see `badline_synchronization`). A handler that fires on a badline loses those cycles before any stores execute. The standard defense is to target the IRQ one line before the badline, perform the writes during that non-bad line, and let the badline pass without stores.

### Recipes

- `recipes/oscar64/stable-raster-irq.md`
- `recipes/kickassembler/stable-raster-irq.md`

---

## raster_bars — Raster color bars

**Complexity:** low
**Region:** both
**Uses registers:** EXTCOL, BGCOL0, RASTER, VICIRQ
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=990, lines_active=10, irq_slots=10, bytes_code=600
**Cost basis:** estimated

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

For an effect that changes color on every single line (a "rainbow" effect), the handler must write $D020/$D021 in fewer than 63 cycles total — feasible without badline interference, but the 40-43-cycle badline stall (plan on 43) makes single-line changes on badline rows require special handling (typically by writing the badline's color in the preceding line's IRQ, since the CPU is stalled on the badline itself).

### Why it works

The VIC-II reads $D020 and $D021 once per dot-clock cycle during horizontal raster generation. The color value fetched at any given dot position determines the color of that dot. Because the 6510 and VIC-II share the bus via the phi1/phi2 clock scheme, a CPU write to $D020 takes effect at the phi2 edge of the write cycle — which corresponds to the dot position being generated approximately 2 clock cycles after the write. This 2-cycle offset is the same on both PAL and NTSC and is constant, making it predictable for cycle-exact color placement. Note that this latency is measured in cycles, each of which is eight pixels wide (not measured here; the pixels-per-cycle figure below is).

The key architectural fact: there is no buffering. Unlike systems with scanline-latched registers, the VIC-II's color registers are transparent — they reflect writes immediately. This means writing too late by one cycle shifts the colour change right by 8 pixels — one CPU cycle is eight dots on both PAL and NTSC (dot clock / CPU clock = 8.000; measured in VICE x64sc: a colour toggled every 4 cycles gave a 64-pixel period) — not onto the next line. The visible effect of a 1-cycle timing error is an 8-pixel step in the seam, not a full-line displacement. An earlier version of this paragraph said "2 dots", probably by confusing the 2-cycle latency above with a pixel count.

### Variations

**Background only.** Write $D021 only, leaving $D020 constant. Produces color bands within the display area without affecting the border.

**Border only.** Write $D020 only. Useful for status bars and frame decorations that must not disturb the display area.

**Gradient via lookup table.** A 16-byte (or 32-byte cycled) table of color values in zero page, indexed by a counter incremented in each IRQ entry, produces a smooth color gradient that can be shifted by adjusting the starting index — a "rotating rainbow" without any compute per frame.

**Parallax bars.** Two separate bar sequences at different speeds — one for background, one for border — shifted by different amounts each frame. Gives a depth illusion cheaply.

**Wide bars with single IRQ per bar.** Program $D012 to the start of each bar region. Within the bar, use NOP padding or a per-line loop to maintain the color for the bar's height. More efficient for tall bars than firing one IRQ per line.

### Cycle budget

Through $0314 the handler is entered on cycle 37-43 (`recipes/kickassembler/raster-bars.md`, measured in VICE), leaving about 20 cycles on the line — enough for the two colour stores (8 cycles, two `STA abs` at 4 each) and the $D012/$D019 bookkeeping (10) and little else; with the KERNAL out and $FFFE pointing at the handler about 50 remain. An earlier version said 50-55 usable and did not name the entry path. On a badline, the 40-43-cycle stall removes almost all work budget; designs that change color on badline rows typically write the color value one line early.

### Recipes

- `recipes/oscar64/raster-bars.md`
- `recipes/kickassembler/raster-bars.md`

---

## badline_synchronization — Badline synchronization

**Complexity:** high
**Region:** both

**Uses registers:** SCROLY, RASTER
**Demands:** midframe_raster_irqs

### Why

The badline is not optional — it is the price the VIC-II extracts from the CPU eight times per character row. During a badline, the VIC-II needs to fetch the full 40-character screen codes for the current text row. It does this by pulling BA (Bus Available) low on cycle 12 and taking the phi2 bus for the 40 c-accesses on cycles 15-54. The CPU may only complete write cycles on 12-14 and cannot read again until cycle 55, so the stall it sees is 40-43 cycles — 43 for any ordinary instruction stream (measured 43 for a NOP stream, 42-43 for STA zp in VICE), 40 only when three consecutive write cycles happen to fall on 12-14. Plan on 43 lost and 20 left (63 - 43) on PAL, 22 on NTSC. An earlier version of this paragraph said BA was low "for 40 cycles" and called the stall 40; that counts only the c-access cycles.

The cycle loss is large enough to invalidate any timing assumption made without accounting for it. A raster effect that writes 8 registers per line works on non-bad lines but silently slips by 40-43 cycles on badlines, producing visible glitches. Badline synchronization is the practice of knowing exactly which lines are bad (and therefore where the stalls fall), structuring IRQ handlers to either avoid critical writes on bad lines or explicitly account for the 40-43-cycle deduction (plan on 43) when they must happen on one.

### How

The first step is understanding when badlines occur. A badline fires when two conditions are simultaneously true: the display is enabled (DEN, $D011 bit 4, was set at some point during raster line $30 — any cycle of that line arms badlines for the frame; an earlier version said cycle 14 specifically), and the low three bits of the current raster line number equal the YSCROLL value in $D011 bits 2-0. With the default YSCROLL of 3, badlines occur at raster lines 51, 59, 67, ... 243 — every 8th line starting at $33, for a total of 25 badlines per frame on PAL.

Because badlines are deterministic given a fixed YSCROLL, the coder can build a lookup table of "line type" (bad vs non-bad) and schedule IRQ handlers to fire only on non-bad lines when cycle budgets are tight. Alternatively, a handler that fires on every line can subtract 43, not 40, from its available cycle count on badlines (63 - 43 = 20) and ensure only that many cycles of work are attempted.

The second control lever is YSCROLL itself. Writing a new YSCROLL value to $D011 bits 2-0 changes which lines are bad. This is dangerous to do mid-frame without care — see the `raster_split_modes` technique — but it can be used deliberately to move the badline cluster away from a critical raster window.

A third approach used in scene-quality code is to account for badlines at assembly time by building the raster handler as a sequence of cycle-counted instruction blocks, with alternate blocks for bad and non-bad variants selected by a look-up at handler entry.

### Why it works

The VIC-II needs character codes to generate text-mode output. The chip cannot display any character without knowing which character is in each of the 40 cells of the current row. It fetches these from screen RAM (video matrix), which lives in the VIC bank and is not accessible during the CPU's phi2 cycles — the VIC needs the bus to itself. The chip raises BA (bus available) signal three cycles before it actually needs the bus. The CPU, seeing BA low, knows it cannot issue further memory accesses but completes any instruction that has no remaining memory cycles. After 3 cycles, the VIC takes the phi2 bus for 40 cycles of screen RAM fetch, then releases it. The CPU resumes.

The timing is locked to the YSCROLL field because the VIC increments its internal row counter on each badline. The row counter increments when `(current_raster_line & 7) == YSCROLL`. The first badline of a frame must occur while DEN is set, or badlines are suppressed for the entire frame — a technique called "blinking DEN" that blanks the display and gives the CPU all cycles back.

NTSC behaves identically in terms of which lines are bad (same YSCROLL logic), but the cycle loss (40-43 cycles) and the available cycles per line (65 on NTSC vs 63 on PAL, so 65 - 43 = 22 left on NTSC) mean the badline penalty as a fraction of a line's budget is slightly lower on NTSC. NTSC has fewer lines per frame, but the badline window ($30–$F7) and the 25 character rows inside it do not depend on the frame length, so an NTSC frame has the same 25 badlines as PAL — 51, 59, …, 243 (measured in VICE x64sc: 2,500 stalls in 100 frames on both the 6569 and the 6567R8, and none with DEN clear). The shorter NTSC frame loses lines from the vertical blank, not from the display; per frame the CPU has fewer non-bad lines than on PAL (238 against 287), and the 40-cycle stall is a slightly smaller fraction of each 65-cycle bad line. (An earlier version of this paragraph said 24.) An earlier revision of this entry also carried a PAL-only Region tag; the technique applies to both regions, as the figures above show.

### Variations

**Badline avoidance.** Schedule IRQs to fire on non-bad lines only. Works when the effect can tolerate one line of imprecision in its split position. Most game status bars use this — nobody notices a 1-pixel vertical shift in the status bar boundary.

**Badline accounting.** Explicitly include the 40-43-cycle stall (plan on 43) in the cycle budget for every handler that can fire on a bad line. The handler can poll $D012 at entry to determine if it is on a bad line and take one of two code paths.

**YSCROLL manipulation.** Write $D011 bits 2-0 to shift the YSCROLL value, moving badlines to a range that doesn't interfere with a critical effect window. Must be done carefully — changing YSCROLL mid-frame can cause FLD (Flexible Line Distance) effects if not done at the precise right cycle. See also `raster_split_modes`.

**DEN suppression.** Clear bit 4 of $D011 (DEN). The display blanks entirely and badlines stop firing — the CPU gets all 63/65 cycles per line. Used in raster bars that cover the entire screen or in effects where the display is generated entirely by sprites or is intentionally blanked.

### Cycle budget

PAL, non-badline: 63 cycles total.
PAL, badline: 20 cycles guaranteed (cycles 1-11 and 55-63). The VIC pulls BA low on cycle 12 and takes the bus for its 40 c-accesses on cycles 15-54; on cycles 12-14 the CPU may only complete write cycles, so "23" is the figure for code that happens to be writing then, and 20 is the one to plan on.
NTSC, non-badline: 65 cycles total.
NTSC, badline: 22 cycles guaranteed, 25 with three write cycles.

For cycle-tight code running on every line, the badline constraint means the worst case is 20 cycles per line on PAL. Any per-line loop must complete in 20 cycles or less to be badline-safe, or must handle the bad-line case separately. Note also that a badline moves every later instruction on that line by 43 cycles (an earlier version said 40): a write planned for cycle 56 cannot be placed there at all, because no read can happen between cycles 12 and 54 and every store's write follows a read.

### Recipes

(No standalone recipe yet — badline synchronization is a prerequisite skill embedded in stable-raster-irq and other recipes.)

---

## double_irq — Double IRQ for jitter elimination

**Complexity:** scene-tier
**Region:** both
**Uses registers:** RASTER, VICIRQ, IRQMSK
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=160, lines_active=2, irq_slots=2
**Cost basis:** arithmetic

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

Measured form (`recipes/kickassembler/stable-raster-irq.md`, VICE x64sc): through the KERNAL vector the handler's first instruction starts on cycle 37-43 of the line (7 interrupt sequence + 29 dispatcher + 0-6 jitter), so the first handler cannot finish its setup and be sliding through NOPs before the *next* line's interrupt; it arms the second IRQ two lines down, not one. Entered from a NOP, the second handler has one cycle of residual jitter, which two consecutive reads of $D012 four cycles apart plus a `BEQ` remove: with the right padding the reads straddle the line boundary in one case and not the other, and the branch costs 3 or 2 cycles to compensate. The padding is found by measurement — the recipe's bars align at `SYNC_PAD = 11` and split into two columns at 10 or 12. Two traps: the KERNAL dispatcher executes `TSX` itself, so a stack pointer saved in X by the first handler does not survive into the second (save it in memory); and every line the two handlers and the timed code occupy must be a non-badline except the one inside the NOP slide, where a stall is harmless.

### Variations

**NOP-padded single entry.** Some implementations fold the double-IRQ logic into a single handler that spins until the raster counter advances, then executes a counted NOP sequence to reach the target cycle. This is cleaner to write but harder to reason about cycle-exactly. The explicit two-handler approach is preferred for documentation and maintenance.

**IRQ set on same line.** A variant sets both IRQs to the same $D012 value. The first fires normally; because the VIC's raster interrupt latches immediately, the second $D012 write (to the same value) causes the IRQ to fire again on the next frame at that same line — but this requires the handler to track which "fire" it is on, typically via a flag byte.

**CIA timer second stage.** Some extreme cases use a CIA timer started in the first IRQ handler to fire a second IRQ a counted number of cycles later, decoupling the second trigger from raster line boundaries entirely. This is used for effects that require a write at a specific horizontal dot position across multiple lines.

### Cycle budget

The double-IRQ technique's purpose is to minimize jitter rather than save cycles — it actually spends more cycles than a sloppy single IRQ. The overhead is:
- First IRQ: through $0314, 36-42 (7 interrupt sequence + 29 dispatcher + 0-6 jitter) + ~12 (ack + set $D012 + RTI) = ~48-54 cycles consumed on the arming line; with the KERNAL out, 7-13 + ~12 = ~19-25. An earlier version gave only the ~19 figure without naming the entry path.
- Between IRQs: the NOP loop in the main loop body executes for however many cycles remain in line N after the first RTI — variable but bounded.
- Second IRQ: 7 (enter) + NOP pad (0-6 cycles) + actual writes.

Total cost per raster split in double-IRQ mode: through $0314, 36-42 + ~12 on the arming line for the first handler, then 36-42 + pad for the second — about 100 cycles over three lines (the first handler arms the second IRQ two lines down, see Why it works), not 35-45 over two as an earlier version said; roughly 60 over two lines with the KERNAL out. Compare 20-30 cycles for a sloppy single-IRQ split with the KERNAL out.

### Recipes

- `recipes/kickassembler/stable-raster-irq.md` (includes double-IRQ pattern)

---

## vsp_glitch — VSP (Variable Screen Position)

**Complexity:** scene-tier
**Region:** both

**Uses registers:** SCROLY, VMCSB
**Demands:** midframe_raster_irqs

### Why

The VIC-II's character-mode display is generated by fetching screen codes from a 40-column video matrix. The VIC fetches one row of 40 characters per character row during badlines, assembling pixel data from character ROM or character RAM to fill the 8 pixel rows between badlines. This architecture means horizontal scrolling can be accomplished by adjusting $D016 bits 2-0 (XSCROLL) to shift the display by up to 7 pixels, but going further — shifting by more than 7 pixels — requires changing the start address of the video matrix, which only takes effect at the beginning of the next character row.

VSP (Variable Screen Position) is a hardware glitch, not a designed feature, that allows mid-character-row screen address changes to take effect immediately by manipulating when the VIC-II thinks a new character row is beginning. The result is pixel-perfect horizontal scrolling independent of the 7-pixel XSCROLL limit, and it requires no extra memory or display-mode changes — it works within standard text mode.

### How

VSP is a $D011 trick — the CSEL toggle described here before belongs to
`sideborder_open`. On the line that is about to be a badline for a
character row, arrange for the badline condition to be *false* in cycle 14
(YSCROLL not equal to `line & 7` at that moment), then at a chosen cycle
between 15 and 53 write $D011 with YSCROLL = `line & 7`, so the condition
becomes true late. The VIC starts its c-accesses three cycles after BA drops,
from whichever column slot the beam has reached, and the columns before it
are not fetched for this row. Because the video counter VC advances only by
the number of c-accesses actually performed, the row ends with VC short by
that many characters, and every row after it — and every frame after it,
until the counter is re-based — starts that many characters earlier in
screen RAM. The display has moved left by N characters, N being the cycle
the condition became true minus 15. One cycle-exact write per character row,
plus a matching adjustment of the screen base, scrolls the whole screen by
whole characters at no per-line cost; XSCROLL still handles the seven pixel
steps in between.

### Why it works

The VIC loads VC from VCBASE and clears VMLI in cycle 14, and only then; a
badline condition that becomes true later leaves those alone and starts the
c-access sequence mid-row, with VMLI counting from where the accesses start.
Christian Bauer's VIC-II article documents this as "DMA delay" (§3.14.6),
and it is the same mechanism FLI uses to lose its three leftmost columns —
VSP uses it to lose N columns and keep the offset.

The write cycle is N, so the write has to be placed from a stable raster
entry. The technique is not PAL-specific.

**The VSP crash.** On some machines the VSP write corrupts RAM. Linus
Åkesson's "Safe VSP" article (2013) traced it to DRAM metastability and
gives the rule a programmer can use: call every address ending in `$7` or
`$F` fragile; during a VSP, each bit of a fragile byte may take the value of
the same bit in another fragile byte of the same 256-byte page. No other
address is affected. It offers three workarounds: make every fragile byte in
a page identical (all `$EA` in code, a blank bottom line in each character of
a font); leave the fragile bytes unused, skipping them in code with `$80`
(NOP immediate) and leaving gaps in data; or keep safe copies of data that
cannot have gaps, such as graphics, and restore from them continuously. The
article gives no way to detect a susceptible machine. It says the timing
depends on temperature, VIC revision, trace capacitance and resistance,
power-supply ripple, and the colour carrier's phase against the dot clock,
which is set at random at power-on. A test at start cannot therefore show a
machine is safe (an inference from those factors, not measured here).
Kodiak64 draws the same conclusion ("no automated VSP vulnerability
detection routine makes much sense") and puts the cost of the gap method in
code at "128 NOPs ... per 1K of executable code", 12.5 % of the code (his
arithmetic, not measured here). VICE x64sc 3.10 can emulate the corruption
(`-VICIIvspbug`, "Enable VSP bug emulation" in its `-help`) and logs "VSP
Bug: safe channels are: ...". (An earlier version of this paragraph said
the crash depended on the DRAM chips and not the VIC revision, that Safe
VSP showed how to detect susceptible machines, and that productions test
for it at start; the article names the VIC revision as a factor and
describes no detection.)

### Variations

**Whole-screen scroll.** One write per character row, on the row's badline,
plus the base-pointer adjustment. **Partial zone.** Only the rows of the
play field; rows above and below are ordinary. **Combined with XSCROLL.**
Whole characters by VSP, pixels by $D016 bits 2-0.

### Cycle budget

One cycle-exact `STA $D011` per character row on the badline row, plus the
stable entry that positions it; the badline still costs its 40-43 cycles (plan on 43).
Nothing per line. The earlier figure of 12 cycles per line via a CSEL toggle
described the side-border mechanism, misattributed. Not yet measured in this
knowledge base — there is no VSP recipe, and the account above is from
Bauer's article and the VICE source, not from a run.

### Recipes

(No standalone recipe yet — VSP is primarily a KickAssembler technique given its cycle-exact assembly requirements.)

### Sources

- Linus Åkesson, "Safe VSP" (2013): https://www.linusakesson.net/scene/safevsp/index.php
- Kodiak64, "The future of VSP scrolling": https://kodiak64.co.uk/blog/future-of-VSP-scrolling

---

## sideborder_open — Open the side border

**Complexity:** high
**Region:** both
**Uses registers:** SCROLX
**Demands:** cpu_every_line, constant_sprite_set, badline_free_region
**Requires:** double_irq
**Raster band:** movable (the program picks the lines; the sideborder-open recipe loops on lines 101-142)
**Cost:** cycles_per_line=63, lines_active=42, cycles_per_frame=2646, irq_slots=2, sprites_per_line=8
**Cost basis:** arithmetic

### Why

The VIC-II renders the side (left and right) borders as a solid color region flanking the active display area. In the default 40-column mode (CSEL=1 in $D016 bit 3), the visible left border spans from the left edge of the screen to approximately dot position 24, and the right border spans from dot position 344 to the right edge. Hardware sprites can be positioned anywhere horizontally, including within the border area — but only if the border is suppressed. If the border is not suppressed, sprite pixels that land in the border region are occluded by the border color.

Opening the side borders means suppressing the border rendering so that sprites appear on a background-color area rather than behind a fixed-color wall. This is indispensable for sprite multiplexing that uses all 8 sprites across the full horizontal width of the screen, for 24+ sprite systems that require sprites in the border to achieve higher counts, and for any visual design that extends graphics to the display edges.

### How

One write per line. Change CSEL ($D016 bit 3) from 1 to 0 with the write
cycle landing on cycle 56 of the line (PAL): `DEC $D016` on a value of $C8,
started on cycle 51, writes $C7 on exactly that cycle. Restore CSEL=1 any time
before the next line's cycle 55; `INC $D016` straight after does. Every line
of the region gets the write, from a loop of exactly 63 cycles per line
entered through a stable raster (`double_irq`).

Two constraints on the region. No line in it may be a badline: the VIC holds
the bus from cycle 12 to 54, no read cycle is possible in between, and every
store's write follows a read, so the write cannot be placed on cycle 56 —
either idle the character display inside the region by rewriting YSCROLL
every line so no line matches, or accept a closed border on those rows. And
if sprites are active in the region, the same sprites must be active on
every line of it: sprite DMA stalls the CPU from cycle 55 to cycle 10 of the
next line and that stall sets the loop's phase; the `DEC`'s two write cycles
on 55 and 56 fall inside the three write cycles the CPU is still allowed
after BA drops. Both are measured in
`recipes/kickassembler/sideborder-open.md`.

### Why it works

The main border flip-flop is *set* when the beam reaches X=344 with CSEL=1
or X=335 with CSEL=0, and *reset* at X=24 or X=31 respectively, while the
vertical border flip-flop is clear. On PAL the beam is at X=335 during cycle
55 and at X=344 during cycle 56. If CSEL is 1 at the 335 comparison and 0 at
the 344 comparison, neither sets the flip-flop; it stays clear for the rest
of the line, so the right border is not drawn, and because it was never set,
the next line's reset has nothing to do and the left border is not drawn
either. There is no separate left-border toggle and no multi-cycle window:
one write cycle, cycle 56. Earlier text here described a 23-cycle window and
a left-border write at cycle 1; neither exists.

### Variations

**Sprites in the border.** The usual reason for the technique. X coordinates
run 0-503; the visible left border is X 480-503 then 0-23, the right border
344-375. A sprite at X=500 straddles the wrap; X=344 starts the right
border. Both need bit 8 in $D010.

**Region-limited opening.** Open only the lines the sprites occupy so the
character display keeps its badlines everywhere else. The stable entry is
per region.

**Graphics on the same lines.** Needs the badline rows handled by other
means, since the write cannot happen on them; beyond this document.

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
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=132, lines_active=2, irq_slots=2
**Cost basis:** arithmetic

### Why

The VIC-II's top and bottom borders are solid-color regions above and below the active display rows. In 25-row mode (RSEL=1, $D011 bit 3 set), the display area spans raster lines 51-250 and the borders fill lines 16-50 (top) and 251-299 (bottom) on PAL. In 24-row mode (RSEL=0), the display area shrinks to lines 55-246 and the borders expand correspondingly.

Opening the top and bottom borders lets the whole frame, minus only the vertical blank, show sprites and the idle-state graphics byte (`$3FFF`, which can be changed per line) instead of border colour. The character or bitmap display itself does not grow — there are no badlines outside lines 48–247, so no new rows are fetched — but sprites and background colour reach every drawable line. Measured in VICE x64sc 3.10, every row of the emulator's viewport is drawable with the borders open: 272 lines on PAL and 247 on NTSC, against the display window's 200 (an earlier version of this paragraph gave "roughly 240 on PAL, approximately 192 on NTSC"). This is used for effects that require full-frame coverage: overscan demos, raster bars that extend into the borders, sprite effects that "bleed" above and below the traditional display area.

Hardware sprites can be positioned at any Y value 0-255 and will render wherever they land. Opening the top/bottom border does not enable additional sprite rendering per se — sprites already render in the border area when their Y position places them there. What border opening does is suppress the border color so that the background color shows through instead, making any sprites or bitmap data in that region visible.

### How

One mechanism, two writes per frame, both at the bottom of the display:

- Clear RSEL ($D011 bit 3) on a line from 248 to 250 — after the raster has passed line 247 and before it reaches line 251 — with a read-modify-write that keeps YSCROLL, DEN and the mode bits and masks off bit 7 (which reads back as the raster's ninth bit, not the compare value).
- Set RSEL again anywhere from line 252 to line 246 of the next frame, so that the next frame's line 247 is not a bottom comparison either.

That is all. The bottom border of this frame and the top border of the next frame both open, because the vertical border flip-flop is never set. Nothing is written near line 51 or 55, and plain raster IRQs through $0314 are precise enough: the target is a line, not a cycle.

An earlier version of this section described a separate top-border write (RSEL=0 on line 55, "symmetric" with the bottom) and a top-only variant. The vertical border flip-flop has no top-side set, so the top opens as a consequence of suppressing the bottom set — measured in VICE x64sc 3.10: the line-55 write on its own leaves both borders closed and moves the bottom border up to line 247, while the two bottom-side writes on their own open both borders.

### Why it works

The VIC-II's vertical border flip-flop (Bauer §3.9) is **set** only when the raster reaches the bottom comparison line — 251 with RSEL=1, 247 with RSEL=0 — checked in cycle 63 of the line and again when the beam reaches the left comparison X; it is **reset** only when the raster reaches the top comparison line — 51 with RSEL=1, 55 with RSEL=0 — at the same two moments, and only while DEN is set. Comparisons match on equality, never over a range, and no frame-start event touches the flip-flop. While it is set, the main border flip-flop cannot be reset at the left edge and the graphics sequencer outputs background colour, so the border is drawn; while it is clear, whatever the sequencer and the sprites produce is shown.

RSEL=1 while line 247 passes means both of that line's checks look for 251; RSEL=0 while line 251 passes means both of its checks look for 247. Neither matches, the flip-flop stays clear, and there is no other set event until the next frame's bottom comparison — the vertical blank and lines 0–50 go by with the flip-flop clear, so the top border is not drawn either. At line 51 the top comparison resets a flip-flop that is already clear. Restoring RSEL=1 before the next line 247 keeps the cycle going frame after frame.

The window for the clearing write is smaller than "before line 251 ends": the left-edge check on line 251 comes at X=24, about cycle 16, before a raster IRQ handler through $0314 has been entered (cycle 37–43). Measured in VICE x64sc 3.10: a clear on line 247 closes the border from line 248 (the cycle-63 check on 247 saw RSEL=0), clears on 248, 249 and 250 open it, and clears on 251 and 252 leave an ordinary frame with the border from line 251.

The side borders are not affected; RSEL only governs the vertical comparison lines. In the opened area the VIC is in its idle state and shows the byte at `$3FFF` in colour 0 over the background colour, so `$3FFF` should be zero — VICE's RAM starts so; hardware RAM is not guaranteed to. Sprites are visible there because the border is no longer drawn over them, not because they render anywhere new.

### Variations

**Bottom only, top only.** Neither exists with RSEL alone: the flip-flop has one set (a bottom comparison) and one reset (a top comparison), and once the bottom set has been suppressed nothing can set it again before the next frame's line 247, so the two borders open as a pair. An earlier version of this section listed both as variations; the recipe below writes nothing near line 51 and the top opens anyway. A demo that shows one of them closed is painting it back — `$D021` set to the border colour over those lines from another raster interrupt — not closing it.

**Full vertical open with sprite coverage.** Open both borders and position 8 sprites to tile vertically across the entire frame (possible because sprites at Y positions above the visible area wrap around in the sprite's own 0-255 coordinate space). Combined with sprite multiplexing this covers nearly the full frame height with sprites.

**RSEL held at 0 for the full frame.** Opens nothing: both comparison lines simply move (top 55, bottom 247) and the border is drawn four lines further in at top and bottom. An earlier version of this paragraph said it "permanently opens both borders"; the control build with RSEL=0 from line 55 to line 0 shows a closed frame whose bottom border begins on line 247 (VICE x64sc 3.10). Worth knowing as the side effect of a raster split that leaves RSEL clear when line 247 arrives.

### Cycle budget

Coarse: the writes need a line, not a cycle. A raster IRQ on any of lines 248–250 clears RSEL in time with the KERNAL dispatcher's latency included; 247 is too early and 251 too late for a write that lands after cycle 37 (see Why it works). RSEL is part of $D011 with YSCROLL (bits 2–0), DEN (bit 4), BMM and ECM (bits 5 and 6) and RST8 (bit 7), so the toggle is a read-modify-write — `LDA $D011`, `AND` or `ORA` immediate, `STA $D011`: 4 + 2 + 4 = 10 cycles — with bit 7 masked off. With the interrupt bookkeeping ($D012, $0314/$0315, the $D019 acknowledge and the exit) each handler body is about 40 cycles plus the 29-cycle dispatcher, twice per frame — except that the restore handler exits through `$EA31`, the full KERNAL service, which costs about 190 cycles once per frame while no key is held and about 1,600 while one is (measured in VICE x64sc for `recipes/kickassembler/raster-bars.md`; an earlier version of this sentence said "about a thousand", a figure nobody had measured); the opening handler exits through `$EA81`. An earlier version of this paragraph said the write "just needs to land before the end of line 248" and gave the RMW as "3 cycles"; both are replaced by the measured window and the cycle count above.

### Recipes

- `recipes/kickassembler/topbottom-border-open.md`

---

## raster_split_modes — Mid-frame display mode change

**Complexity:** medium
**Region:** both
**Uses registers:** SCROLY, SCROLX, VMCSB
**Demands:** midframe_raster_irqs

### Why

The VIC-II supports four display modes: standard character mode (text), multicolor character mode, standard bitmap mode, and multicolor bitmap mode. (Extended Background Color mode is a fifth; it is exclusive with multicolor and bitmap — ECM+MCM and ECM+BMM are the black "invalid" modes — and restricts the character set to 64 glyphs, since character code bits 7–6 select one of four background colours. Sprites, single- or multicolour, are unaffected: measured in VICE x64sc, a sprite renders identically with ECM set and clear. An earlier version of this sentence said ECM was "effectively mutually exclusive with sprites"; it is not.) Each mode is selected by the combination of $D011 bit 5 (BMM, bitmap mode), $D011 bit 6 (ECM, extended background color), and $D016 bit 4 (MCM, multicolor mode).

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

Each raster split costs: 3 writes ($D011, $D016, $D018) × 4 cycles = 12 cycles minimum. With IRQ overhead — 13-20 cycles with the KERNAL out and $FFFE pointing at the handler, 42-50 through $0314, where the handler is entered on cycle 37-43 — a mode split consumes approximately 25-35 or 55-65 cycles on the split line respectively. An earlier version gave only 13-20 without naming the entry path.

On a badline, a mode-split IRQ has only 20 usable cycles on PAL (cycles 1-11 and 55-63; 12-14 for writes only). A 12-cycle triple write fits, but combined with IRQ overhead it is tight. The standard mitigation is to position the mode split on a non-badline.

YSCROLL manipulation during a mode split requires a fourth write to $D011 — but since $D011 carries both YSCROLL and mode bits, the YSCROLL write and the mode-bit write must be combined into one read-modify-write, costing 10 cycles instead of 4 for two separate stores. If the mode bits and YSCROLL value are known in advance, a precomputed combined value can be stored directly in 4 cycles.

The $D018 write is the most timing-sensitive of the three, and its two halves behave differently. The character/bitmap base (CB bits 3-1) is read on every g-access, so a mid-row write changes the glyph or bitmap source from the very line the write lands on — measured in VICE x64sc: a CB switch on line 100 redrew lines 100-106 of that row from the new set, and a CB switch on line 98 redrew line 98, the last line of the previous row. A CB-only split therefore takes effect where it lands, and the advice to fire the IRQ "on the line before the first badline" tears that previous row's last line unless the store completes after the last g-access (cycle 55 on PAL) of that line; land the write in cycles 56-63 of the previous line or before cycle 16 of the zone's first line. The video-matrix pointer (VM bits 7-4) is consumed by the badline's c-accesses (cycles 15-54), whose 40 codes are held in the row buffer, so a VM change shows on the next character row — measured: a VM switch on line 100 left row 6 unchanged and row 7 drawn from the new matrix. Note the same VM bits also address the sprite pointers at VM+$3F8, which the p-accesses read on every line, so a VM move shifts sprite pointer reads at once. Put a split that moves the video matrix anywhere in the 8 lines before the zone's first badline, before cycle 15 of that badline. An earlier version of this paragraph said the whole of $D018 was latched once per row at the badline fetch, so a late write was ignored for eight lines; that is true only of the VM half.

### Recipes

(Standalone recipe not yet written — raster_split_modes is demonstrated as part of larger demo or game layout recipes.)

---

## pal_ntsc_detection — Detect PAL vs NTSC at boot

**Complexity:** low
**Region:** both
**Uses registers:** D011, D012

### Why

A C64 does not know which video standard it was built for, and neither does the program it is running: no register says PAL or NTSC. Yet almost everything timed by the frame or by the CPU clock differs between the two — 312 raster lines a frame against 263 (6567R8) or 262 (6567R56A), 63 cycles a line against 65 or 64, 985,248 Hz against 1,022,727 Hz (settled figures; `hardware/pal-ntsc-reference.md` has the tables). Music ticked once a frame runs a fifth too fast on NTSC, a CIA reload drifts 3.8 %, a raster interrupt set for line 280 never fires on a chip whose frame ends at 262; `pitfalls/region-timing.md` walks through all three. The cure in each case is the same: find out once, at boot, which chip this is, store the answer in a byte, and branch on it. This technique is that one measurement.

### How

The VIC-II's raster counter is nine bits wide: `$D012` holds the low eight and bit 7 of `$D011` (RST8) is the ninth. RST8 is therefore set for exactly the raster lines from 256 upward, and the frames of the three chips differ only in how many of those lines they have — 56 on PAL (256–311), 7 on the 6567R8 (256–262), 6 on the 6567R56A (256–261). The routine reads the length of that band:

1. Disable interrupts (`SEI`). A handler that ran for longer than a raster line would hide a line from the loop.
2. Wait until RST8 is clear. This is not for calls that land in the middle of the band — the lines such a call skips are the smaller values, and a loop that keeps the latest one is indifferent to them (measured: the loop with this wait deleted, entered on PAL lines 256 and 300, still returned `$37`). It closes a race at the far end of the band. A call landing in the last cycles of the frame's final line takes its first `$D012` sample on that line and its RST8 check on line 0, so step 5 is reached before any value has been kept and the result is whatever the register held before the call (measured: the same wait-less loop entered on PAL line 311 with its result register preloaded to `$EE`, and the entry phase swept in 4-cycle steps, returned `$EE` at two of sixteen phases and `$37` at the other fourteen; with the wait restored, both racing phases returned `$37`). Waiting for RST8 to be clear first means step 3 can only exit at line 256, never at line 311. This page gave the mid-band reason until 2026-09-22; it was wrong.
3. Wait until RST8 is set. That is line 256 on every chip, and `$D012` reads `$00` there.
4. While RST8 stays set, read `$D012` and keep the value — the most recent one, or the highest; inside the band they are the same. Read `$D012` first and RST8 second, and keep the sample only if RST8 was still set after it, so a read that has already wrapped to `$00` on line 0 is never recorded. The Oscar64 recipe tests RST8 at the top of its loop instead, because that is where the compiler puts a `while` condition, and keeps the highest value, which makes the wrapped `$00` harmless without the ordering; the two forms agree.
5. When RST8 clears, the kept value is the low byte of the last line of the frame: `$37` on the 6569, `$06` on the 6567R8, `$05` on the 6567R56A. Store it, or reduce it to one flag, and re-enable interrupts. Anything that became pending during the wait — the KERNAL's 60 Hz timer interrupt, if its vector is still installed — is serviced the moment interrupts are back on, so call the routine before the KERNAL interrupt is replaced, or expect one KERNAL service to run right after it returns.

For a two-way PAL/NTSC answer a shortcut suffices: any `$D012` value of `$10` or more seen while RST8 is set means PAL, because lines 272–311 exist on no NTSC chip. Keeping the whole value costs nothing more and tells the two NTSC chips apart.

Measured in VICE x64sc 3.10 (rung 1): the kept value was `$37` on the default PAL model, `$06` with `-model ntsc` and `$05` with `-model oldntsc`, read back from the screen as hex digits, and the same when the run was stopped at 5,000,000 and at 8,000,000 cycles. The same wait-and-track loop, entered deliberately from raster lines 100, 300 and 311 on PAL and from 100 and 262 on NTSC, gave the right answer every time.

**What does not work, and stood in this knowledge base until 2026-09-21:** polling for RST8 to become set and then reading `$D012` once. That read lands on line 256, the first line of the band, and returns `$00` on every chip — measured as `00` on all three VICE models — so a `cmp #$10` after it says NTSC unless the routine was called from inside lines 272–311 by luck. Both copies of the "shortest reliable detect" here did exactly that (`hardware/pal-ntsc-reference.md` Method 2, and the fix in `pitfalls/region-timing.md`, whose copy also fell through a `bne` after `lda #0` and so answered NTSC from either branch). Both are corrected on their own pages, with the measurements.

### Why it works

The counter is incremented at the start of each raster line and reset to zero for line 0 (Bauer, §3.6.3; not measured here beyond the wrap values above). RST8 is nothing more than bit 8 of that counter, so it is a level, not an event: it reads 1 for the whole of lines 256 onward and 0 for the whole of lines 0–255, and a polling loop can watch it change without a raster interrupt and without touching `$D019`. The last line of the frame is the only place the three chips disagree, and it is the last line on which RST8 reads 1 — sampling the low byte until RST8 falls therefore reads that line's number without knowing it in advance. The display window is not involved: lines 256 and up are lower border or vertical blanking on every chip, and no badline can occur there since the badline condition needs a raster line between `$30` and `$F7` (Bauer, §3.5; not measured here), so with no sprites enabled — the state at boot; sprite DMA would take cycles from these lines too, since the sprite Y compare uses the low byte of the raster counter (Bauer, §3.8; not measured here) — the CPU keeps every cycle of every line in the band and a loop of fifteen to twenty-two cycles samples each line two to four times.

The frame is the same length however the routine is entered, so the answer does not depend on when the program started; the two waits guarantee that sampling begins at line 256 and ends at line 0, so the band's last line is always among the samples. How long the routine holds the CPU does depend on the entry line. Called from line L below 256 it runs N − L lines, the rest of the frame; called from inside the band it runs 2N − L lines — the rest of that band, the 256 lines with RST8 clear, and the whole of the next band. So it takes at least N − 255 lines — 57 on PAL (3,591 cycles, about 3.6 ms), 8 on the 6567R8 (520 cycles, about 0.5 ms), 7 on the 6567R56A — and at most 2N − 256 lines — 368 on PAL (23,184 cycles, about 23.5 ms, 1.18 frames), 270 on the 6567R8 (17,550 cycles, about 17.2 ms, 1.03 frames), 268 on the 6567R56A (arithmetic from the settled constants). Measured in VICE x64sc 3.10 with CIA 1 timer A wrapped around the 26-byte tracking loop that `detect_region` in `pitfalls/region-timing.md` extends with its flag store, CIA interrupts masked and any pending one acknowledged first, and the wrapper's own 17 cycles taken off by a null-call control: 3,575 cycles from PAL line 255 and 23,172 from line 256; 500 and 17,535 on the 6567R8; 432 and 17,131 on the 6567R56A; 13,337 from PAL line 100 and 19,707 from line 311 — each within one line of the arithmetic. **Correction (2026-09-22):** until this date this page said the measurement "takes between one and two frames — about 40 ms on PAL, 33 ms on NTSC". That was a bound written from the shape of the loop, not measured, and it is wrong at both ends: the routine never reaches two frames, and from most entry lines it takes well under one.

### Variations

**Time a frame with a CIA timer.** Start a CIA timer at one raster line 0 and read it at the next: about 19,656 cycles on PAL (312 × 63), 17,095 on the 6567R8 (263 × 65), 16,768 on the 6567R56A (262 × 64) — arithmetic from the settled constants; this variant was not run here. `hardware/pal-ntsc-reference.md` Method 1 lists it. It yields the cycle count, which the raster method does not, at the cost of a CIA timer, more code and a threshold to choose. On a stock machine the raster band is the shorter and more direct read.

**Store, do not repeat.** Take the measurement once, before interrupts are installed, into a byte the rest of the program branches on: the music tick (`pal_ntsc_tempo_mismatch`), CIA reloads (`cia_timer_phi2_difference`), raster tables (`raster_line_count_difference`). Nothing about the chip changes later.

**Three-way or two-way.** Keep the raw last-line byte if the program counts cycles per line or lines per frame on NTSC — the R8 and the R56A differ in both, 65 against 64 and 263 against 262 (settled); reduce it to PAL/NTSC with one compare against `$10` otherwise.

**The KERNAL's own answer.** The stock KERNAL takes a two-way measurement of its own at reset and leaves it at `$02A6` (PALNTS): 1 for PAL, 0 for NTSC. The mechanism is in the ROM bytes (`kernal-901227-03.bin`, read here): the reset path at `$FF5B` initialises the VIC from a table that sets the raster compare to line 311 and acknowledges `$D019`, clears the screen, waits for `$D012` to read zero, then reads `$D019`, keeps bit 0 and stores it at `$02A6` — the raster-compare flag can only have been raised if a line 311 exists. It cannot tell the R8 from the R56A, a replacement KERNAL or an earlier program may have left anything there, and its reliability was not measured here; `hardware/pal-ntsc-reference.md` Method 3 has the detail. Measure the chip yourself when the answer matters.

### Cycle budget

None per line. The routine runs once, with interrupts disabled, and holds the CPU for between 57 and 368 lines on PAL (about 3.6 to 23.5 ms) or between 8 and 270 lines on the 6567R8 (about 0.5 to 17 ms) depending on where in the frame it is entered — a fifth of a frame at best, 1.2 frames at worst, measured as described above; nothing else is expected to run during it. It takes no raster interrupt and writes neither `$D011` nor `$D012`. 36 bytes with the compare and flag store as `detect_region` in `pitfalls/region-timing.md` (assembler count); the hardware page's Method 1 `detect_region` returns a three-way code in A and its Method 2 `detect_pal` a carry flag, both with the same `wait_lo` guard.

### Recipes

- `recipes/oscar64/pal-ntsc-detect.md`

### Sources

- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its application in the Commodore 64", https://www.cebix.net/VIC-Article.txt — §3.2 (RST8), §3.4 (lines per frame per chip), §3.5 (bad line condition), §3.6.3 (raster counter increment and reset), §3.8 (sprite DMA and the Y compare).
- VICE 3.10, `x64sc`, models `default`, `ntsc`, `oldntsc` — the instrument for every figure marked measured above; the durations were read from CIA 1 timer A, the verdicts from the screen.
- KickAssembler 5.25 — the listing the durations were measured on is the hardware page's, and the byte counts are its.
- VICE's `kernal-901227-03.bin` — the bytes at `$FF5B`, `$ECB9` and `$FDDD` behind the `$02A6` variation.
- This repository: `hardware/pal-ntsc-reference.md`, `pitfalls/region-timing.md`, `recipes/oscar64/pal-ntsc-detect.md`.

---

## frame_sync_loop — Raster-synced frame loop

**Complexity:** low
**Region:** both
**Uses registers:** D011, D012, D020
**Cost:** bytes_code=985
**Cost basis:** arithmetic

### Why

A game loop that runs as fast as the CPU allows draws at a rate the VIC-II
does not share: sprites move while the beam is drawing them, screen writes
land half-way down a character row, and the speed of the game changes with
the amount on screen. Locking the loop to the frame fixes all three. Once a
frame, at a raster line of your choosing, the loop wakes, does its work, and
goes back to waiting. Everything that follows needs an answer to three
questions: how does the loop know a new frame has begun, how much of the
frame did the work take, and did any frame go by without it. This technique
is the standard answer to each, and it is the first thing to put in a game
before anything else is written, because the budget bar it gives you is the
profiler you will use for the rest of the project.

### How

**The wait, without an interrupt.** The raster counter is nine bits, the low
eight in `$D012` and RST8 in bit 7 of `$D011`, and RST8 is a level: it reads
1 for the whole of lines 256 upward and 0 for lines 0 to 255 (see
`pal_ntsc_detection` above). Spinning until RST8 is set therefore returns at
line 256 on every chip. That is what Oscar64's `vic_waitBottom()` does
(`vic.c` lines 62 to 66), and `vic_waitFrame()` first spins until RST8 is
clear and then until it is set (lines 74 to 80), so two calls in a row are
always one frame apart. The distinction matters: the RST8 band is 56 lines
on PAL and 7 on the 6567R8 (settled frame lengths), so a loop that calls
`vic_waitBottom()` twice with less than seven lines of work between the
calls on NTSC gets two returns from one frame (arithmetic from the source
and the constants; not run here). Prefer `vic_waitFrame()`, or a wait that
compares a line.

**Why the wrap line matters.** `$D012` on its own is ambiguous. Its low byte
wraps to zero twice a frame, once at line 256 and once at line 0, so the
values 0 to 55 each occur on two lines of a PAL frame (0 to 6 on the
6567R8), and a loop that watches for the counter to "wrap" fires twice a
frame unless it also reads RST8. A spin on `$D012 == N` for a line at or
above 256 needs the ninth bit or it matches the low line too; Oscar64's
`vic_waitLine()` does exactly this, matching the low byte and then checking
RST8 against bit 8 of the target (`vic.c` lines 91 to 101). An equality spin
has a second weakness: if anything holds the CPU for longer than a line
while it is spinning, the target line goes by unseen and the loop waits a
whole extra frame. A line is 63 cycles on PAL; the KERNAL's own timer
service, if its vector is still installed, is about 190 cycles idle and
about 1,600 with a key held (measured in VICE for
`recipes/kickassembler/raster-bars.md`, quoted in `topbottom_border_open`
above), so either is enough. A compare that accepts "at or past" the line, which is the
form `vic_waitBelow()` uses (`vic.c` lines 103 to 121), can end late but
cannot miss. And a target line the chip does not have, 300 on NTSC, never
matches at all: the loop hangs (`pitfalls/region-timing.md`).

**The wait, with an interrupt.** The cleaner form takes one raster interrupt
at the sync line and lets it do one thing: increment a byte. The main loop
keeps its own copy of the byte and spins while the two are equal. The
interrupt only ever increments and the main loop only ever catches up;
nothing is cleared across the boundary, so a tick cannot be lost between a
read and a clear, and the byte is one byte so the read needs no `SEI`. In
Oscar64, `rirq_count` and `rirq_wait()` (`rasterirq.c` lines 606 to 614) are
this exact loop, with the byte incremented once per frame by the dispatcher
after the last slot of the schedule; a `rirq_call` to an `__interrupt`
function that increments a byte of your own is the same thing with the
counting on the page. The recipe below does the latter. A plain flag,
set by the interrupt and cleared by the loop, works too, but it cannot count
how many frames were missed; the tick byte can.

**A frame counter.** Count the loop's iterations in a 16-bit variable owned
by the main loop. That is the game's clock: animation phases, spawn timers
and music tempo divide it. Count ticks separately if you also want a clock
that keeps running while the loop is late.

**Dropped-frame detection.** When the wait ends, subtract the copy from the
tick byte in eight bits. The result is 1 when the loop kept up and more when
it did not; every count above one is a frame that passed while the loop was
still working. Add them to a dropped counter, then set the copy equal to the
tick so every tick seen is consumed. The eight-bit subtraction makes the
counter's wrap from 255 to 0 harmless for up to 255 missed frames, and the
whole arithmetic was run over all 65,536 (tick, copy) byte pairs on the 6502
against the same fold in Python (`recipes/oscar64/frame-sync-loop.md`). With
the tick form a loop that overran does not wait: the tick has already moved,
so the next frame starts at once and the game runs at the speed of the work.
With a line-compare wait the same loop would sit out the rest of the frame
and run at a whole number of frames per iteration, two for anything between
one and two frames of work (arithmetic; only the tick form was run here).

**The budget bar.** Write a bright colour to `$D020` as the first thing after
the wait and the background colour as the last thing before it. The beam
paints whatever `$D020` holds into the border as it goes, so the border is
lit for exactly the lines the loop was working and the band's lower end is
the budget used. Every C64 programmer does this; it costs two stores and it
turns the raster into a profiler with a resolution of one line, which is 63
cycles. Measured in VICE x64sc 3.10, rung 1 (`recipes/oscar64/frame-sync-loop.md`,
PNG read down the border column): an IRQ on rirq row 250, landing on
line 251, gives a bar that begins on line 254 and, for a fixed 8-unit
workload, ends on line 106 on PAL and line 158 on the 6567R8: 165 and 168
lines, 53 % of the PAL frame and 64 % of the NTSC one. The same cycles are a
bigger slice of the shorter frame, and cover slightly more lines because
the NTSC bar crosses twice as many badlines. Tripled to 24 units
(`recipes/oscar64/frame-sync-loop-overrun.md`, the same listing with the
constant changed, pinned separately) the bar has no end: the border is lit
on every visible line, the only black is a
one-line gap where the loop's two stores fall a few cycles apart, and that
gap walks about two thirds of a frame down the picture every loop because
each loop is 1.65 frames long. The dropped counter read 100 against 153
loops in that run. An all-white border is the usual face of an overrun; do
not wait for a gap to appear before believing the counter.

### Why it works

The VIC-II increments its raster counter at the start of every line and
resets it to zero for line 0 (Bauer, §3.6.3; not measured here beyond the
wrap values on this page). RST8 is bit 8 of that counter, read back through
`$D011` bit 7, which is why a read of `$D011` and a read of `$D012` together
name a line without ambiguity and a read of `$D012` alone does not. A raster
interrupt fires when the counter equals the nine-bit compare value written
to `$D012` and `$D011` bit 7, once per frame per compare value, so an
interrupt at the sync line is a once-a-frame event by construction; a spin
is the same comparison done by the CPU. `$D020` is read by the VIC every
pixel it draws as border, so a change shows within the same line, which is
what makes the border a display of the CPU's timeline.

Where the sync line sits decides what the loop can safely touch. From line
251, the first line after the 25-row display window, the beam spends the
bottom border, the vertical blank and the top border before the first
badline of the next frame at line 51: 112 lines on PAL, 63 on the 6567R8
(settled frame lengths). Screen RAM, colour RAM, the sprite registers and
the scroll registers written in that window are all read by the VIC after
the write, so nothing tears. Work that spills past line 51 pays the
badlines it crosses, 40 to 43 cycles each, and any sprite fetches on those
lines; the bar shows the cost as extra lines.

### Variations

**Flag instead of tick.** The interrupt sets a byte to 1 and the main loop
clears it. Simplest possible form; cannot count missed frames, and a loop
that runs long finds the flag already set and starts the next frame at once,
exactly as the tick form does.

**Spin-only, no interrupt.** `vic_waitFrame()` or `vic_waitLine(n)` at the
top of the loop, nothing installed. Fine for a demo or a tool, and the
only choice while the KERNAL interrupt is left running for the keyboard. It
cannot detect a dropped frame, because a wait that ends does not know how
many lines went by before it started; pair it with the tick byte if that
matters.

**Bar per subsystem.** Change the colour between stages, red for the
sprite multiplexer sort, green for the game logic, blue for the music call,
and the border becomes a stacked bar chart of the frame. The music player's
band in particular should be flat from frame to frame; one that is not is a
player with a data-dependent path.

**Sync to a line inside the display.** A loop whose display writes all go to
the lower half of the screen can sync higher, to the last line above them,
and gain the top of the display as working time. The rule is only that the
writes land before the beam reaches what they change.

### Cycle budget

None per line. The wait costs nothing useful, only the cycles until the
line arrives. The interrupt form pays the interrupt's entry and exit once
per frame, 36 cycles to the handler through `$0314` (settled) plus whatever
the dispatcher and the handler body add; not broken down here. The bar is
two absolute stores. What the loop has left is the frame: 312 × 63 =
19,656 cycles on PAL and 263 × 65 = 17,095 on the 6567R8, less 40 to 43
for each of the 25 badlines and less any sprite DMA (arithmetic from
the settled constants); `game-design/game-design-patterns.md` budgets
about 19,700 after interrupt overhead on PAL, which is a rounding of the
same figure.

### Recipes

- `recipes/oscar64/frame-sync-loop.md`
- `recipes/oscar64/frame-sync-loop-overrun.md`

### Sources

- Oscar64 (build 2026-05-19), `include/c64/vic.h` lines 107 to 128 (the
  declarations; the comment above the first is line 106) and
  `include/c64/vic.c` lines 56 to 138, read here; `include/c64/rasterirq.c`
  lines 606 to 614 (`rirq_wait`) and the `inc rirq_count` after the last
  slot of the schedule.
- VICE 3.10, `x64sc`, models `default` and `ntsc`: the instrument for every
  figure marked measured above, read from the exit PNG.
- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64", https://www.cebix.net/VIC-Article.txt,
  §3.6.3 (raster counter) and §3.2 (RST8).
- This repository: `pitfalls/region-timing.md`,
  `game-design/game-design-patterns.md` (game loop patterns),
  `recipes/oscar64/simple-shmup.md` (a full game on the same loop shape).

## irq_chain_table — Table-driven raster IRQ chain

**Complexity:** medium
**Region:** both
**Uses registers:** D011, D012, D019, D01A, D020
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=273, lines_active=3, irq_slots=3
**Cost basis:** estimated

### Why

A raster interrupt fires once per frame at one line. A program that wants
several things done at several lines has two choices: one handler per line,
each re-pointing `$0314` at the next handler and arming `$D012` for it, which
is the ring in `recipes/kickassembler/raster-bars.md` and
`recipes/kickassembler/cracktro-template.md`; or one dispatcher that walks a
table of (line, handler) pairs. The ring spreads the arming and acknowledge
logic across every handler, and a slot cannot be added, removed or moved
without editing its neighbours. The table puts that logic in one place, so a
slot is one table row and a handler is a plain subroutine that ends in
`RTS`. Oscar64's `rasterirq.h` is this shape with a sorter in front of it
(`recipes/oscar64/raster-bars.md`); this entry is the same thing on the page
for KickAssembler, with each step measured in VICE.

### How

**The table.** Two parallel byte arrays for the line, low eight bits and
the ninth bit already shifted into bit 7 so it can be ORed straight into
`$D011`, and two for the handler address. Rows are in raster order. A
slot index byte says which row runs next. The chain below is the one the
recipe runs: three slots at lines 40, 130 and 260, so one slot is above the
display, one inside it and one needs RST8.

**The dispatcher.** One routine behind `$0314`. In this order:

1. Acknowledge: `LDA #$01 / STA $D019`.
2. Compute the next index (wrap to 0 at the table's end) and arm its line:
   low byte to `$D012`, then `$D011` with bit 7 replaced by the row's ninth
   bit and the other seven bits kept.
3. Call this slot's handler through the table: copy the address into the
   operand of a `JSR` and run it. The 6510 has no `JMP (abs,X)`, and a
   `JSR` lets the handler end in `RTS` and leave the exit to the dispatcher.
4. Store the next index. If it wrapped to 0, the frame is complete:
   increment the frame counter, call the music player, do anything else that
   runs once per frame.
5. Exit through `$EA81` (register restore and `RTI`).

```asm
.const NSLOTS = 3

irq:
    lda #$01
    sta $d019                // 1. acknowledge

    ldx slot                 // 2. arm the next slot's line, all nine bits
    inx
    cpx #NSLOTS
    bne !+
    ldx #0
!:  stx next
    lda line_lo,x
    sta $d012
    lda $d011
    and #$7f
    ora line_hi,x
    sta $d011

    ldx slot                 // 3. call this slot's handler
    lda handler_lo,x
    sta call + 1
    lda handler_hi,x
    sta call + 2
call:
    jsr $ffff

    ldx next                 // 4. advance; a wrap to 0 is the once-a-frame point
    stx slot
    bne done
    inc frame_lo
    bne !+
    inc frame_hi
!:  jsr music_tick
done:
    jmp $ea81                // 5. restore A, X, Y and RTI

line_lo:    .byte <40, <130, <260
line_hi:    .byte (40 >> 8) << 7, (130 >> 8) << 7, (260 >> 8) << 7
handler_lo: .byte <slot0, <slot1, <slot2
handler_hi: .byte >slot0, >slot1, >slot2

slot0:      lda #2
            sta $d020
            rts
slot1:      lda #5
            sta $d020
            rts
slot2:      lda #6
            sta $d020
            rts
music_tick: rts

slot:       .byte 0
next:       .byte 0
frame_lo:   .byte 0
frame_hi:   .byte 0
```

**Install.** `SEI`; mask CIA1 with `$7F` to `$DC0D` and read `$DC0D` once,
so the only interrupt that reaches `$0314` is the raster one; set the slot
index to 0 and arm row 0's line the same way step 2 does; point `$0314/$0315`
at the dispatcher; `$01` to `$D01A`; `$01` to `$D019` to drop any flag left
from before; `CLI`. If the KERNAL's timer interrupt is left enabled it
arrives through the same vector and the dispatcher runs a slot early.

**Acknowledge first, arm second.** The order matters when a handler runs
long. Measured in VICE x64sc 3.10 (PAL, 8,000,000 cycles) with slot 1's
handler padded to about 9,000 cycles so that it returns after slot 2's line
260 has gone by: with the order above, the raster flag raised at line 260 is
still set when the dispatcher exits, the CPU takes the interrupt again at
once, slot 2 runs late (its colour write first appears at line 287, the
last line in the picture; from line 130, 9,000 cycles is 143 lines and the
fifteen badlines crossed add about ten more) and the frame counter reads
254, the same as the unpadded chain. With the acknowledge moved to the end
of the dispatcher, the same padded chain reads 127: the flag from line 260
is cleared by the late acknowledge, slot 2 waits for line 260 of the next
frame, and the chain takes two frames per lap. A late slot is recoverable; a
lost one halves the frame rate. Arming the next line before the handler
runs is what makes the pending interrupt possible: with the arm after the
handler, `$D012` still holds the current line while the handler overruns and
nothing is raised at all, which is the same lost frame.

**The next-line arm and RST8.** `$D012` holds bits 0 to 7 of the compare
line and `$D011` bit 7 holds bit 8. Writing only `$D012` for a line at or
above 256 arms line minus 256. The `AND #$7F / ORA` keeps YSCROLL, DEN, RSEL
and the mode bits, so the dispatcher can arm any line without knowing what
the display is doing. The recipe's slot at 260 lands where the table says
(measured: blue border from line 261 in the right border, 262 at the left,
both models).

**The wrap at the frame top.** The last row arms the first row's line,
which is smaller than its own. The compare is not reached again in this
frame, so the next interrupt is at that line in the next frame. Nothing
special is needed for the wrap beyond the index going back to 0; the
raster counter's own reset to 0 does it. This is also why the index and
the table order must agree: a row out of raster order is armed after its
line has passed and the whole chain waits a frame for it.

**A frame counter and the music tick.** Step 4 runs once per lap of the
table, which is once per frame as long as no slot is lost. Put the 16-bit
frame counter increment and the `JSR` to the music player there and only
there. A music call in a slot handler runs once per frame too, but it then
sits on that slot's line and its data-dependent length eats that slot's
margin (frame_sync_loop above measures a player's band with the border).
The counter is the game's clock: in the recipe it reads 254 after
8,000,000 cycles on PAL and 458 after 12,000,000, a difference of 204 for
4,000,000 cycles, which is 4,000,000 / 19,656 = 203.5 frames (measured in
VICE; the frame length is the settled constant).

**A slot's handler must finish before the next slot's line.** The deadline
for a handler is the next row's line minus the dispatcher's exit and
re-entry: the handler's `RTS`, steps 4 and 5 (about 40 cycles idle, plus the
frame work at the wrap), the interrupt sequence and the KERNAL dispatcher
(36 cycles to `$0314`, settled) and steps 1 and 2 again. A handler that ends
later than that makes the next slot late by the overrun; one that ends
after the next line has been and gone makes it late by the whole overrun
plus the re-entry, as measured above. Budget each slot as (next line minus
this line) × 63 cycles on PAL, less 40 to 43 for each badline in between
and less about 150 for the dispatcher (arithmetic from the settled
constants and the cycle counts below).

### Why it works

The VIC raises IRST in `$D019` when its raster counter equals the nine-bit
compare value, once per frame per value, and holds /IRQ low while IRST and
ERST (`$D01A` bit 0) are both set. Writing 1 to `$D019` bit 0 clears IRST
and nothing else. The compare value can be changed at any time; the next
match is at the new line, in this frame if it is still ahead of the beam
and in the next frame if not. That is the whole mechanism: one compare
register, re-pointed once per interrupt, walks the beam through the table.
Because the interrupt is level-triggered, a match that arrives while the
CPU has interrupts disabled is not lost as long as IRST is still set when
`RTI` clears the I flag; that is why the acknowledge belongs at the start of
the dispatcher and not at its end.

The colour write of the recipe's handlers completes about 111 cycles after
the start of the interrupt's line, plus 0 to 6 cycles of jitter: 36 to the
first instruction of the dispatcher (settled), 69 through steps 1 to 3 to
the handler's first instruction, and 6 for its `LDA #` and `STA` (counted
from the listing). That is cycle 48 of the line after the one in the table,
so every band in the recipe begins one line below its table entry, part-way
across. The picture agrees: on line 41, which is all border, the new colour
begins at x = 305 in the PAL PNG (x = 304 is one light grey pixel, VICE's
rendering of the VIC's grey dot on a colour-register write, not examined
further here) and at x = 281 on NTSC, and lines 132 and 261 show the change
in the right border and not the left. With the KERNAL out (the variant
below) the same write lands at x = 169 on PAL, 136 pixels or 17 cycles
earlier, against 16 from the listing: the 29-cycle KERNAL dispatcher
replaced by 13 cycles of the handler's own register saves. A chain that
needs the change at the left edge of the line arms each row one line early
and spins on `$D012` inside the handler, as `raster_bars` describes, or
uses `stable_raster_irq` for the slots that need it; this technique on its
own does neither, and the recipe says where its edges are.

### Variations

**Hardware vector, KERNAL out.** Point `$FFFE/$FFFF` at the dispatcher and
set `$01` to `$35`. The dispatcher must then save and restore A, X and Y
itself and end in `RTI`; there is no `$EA81`. CIA2's NMI needs masking too
(`$7F` to `$DD0D`, read once) or a vector at `$FFFA/$FFFB`. Measured in VICE
with the recipe's table: identical band lines and an identical frame count
of 254 at 8,000,000 cycles, and the colour write 17 cycles earlier as above.
The entry and exit of that variant:

```asm
irq:
    pha                      // no KERNAL dispatcher: save the registers yourself
    txa
    pha
    tya
    pha
    lda #$01
    sta $d019
    // ... steps 2 to 4 as in the $0314 form ...
    pla                      // what $EA81 would have done
    tay
    pla
    tax
    pla
    rti

install:
    sei
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    lda #<irq
    sta $fffe                // RAM under the ROM; read once $01 = $35
    lda #>irq
    sta $ffff
    lda #<nmi
    sta $fffa
    lda #>nmi
    sta $fffb
    lda #$35
    sta $01
    lda #$01
    sta $d01a
    sta $d019
    cli
    rts
nmi:
    rti
```

**KERNAL housekeeping once a frame.** Exit through `$EA31` instead of
`$EA81` at the wrap only, with CIA1 left masked, to keep the jiffy clock and
keyboard scan alive: about 186 cycles idle and about 1,600 with a key held
(`recipes/kickassembler/raster-bars.md`, measured there). Every other exit
stays on `$EA81`.

**Data-only slots.** For slots that only write registers, replace the
handler address with a (register, value) list and let the dispatcher write
it, which is what Oscar64's `rirq_write` compiles to. Fewer bytes per slot
and a fixed time per write; no code per slot.

**Stable slots.** A row whose handler needs cycle-exact timing can carry a
flag that makes the dispatcher enter it through the `double_irq` protocol
while the other rows use the plain entry. Not run here.

### Cycle budget

Per interrupt, from the interrupt's line start, counted from the listing:
36 cycles to the dispatcher (settled), 69 through the acknowledge, arm and
call to the handler's first instruction, 6 for its `RTS`, 14 through the
advance to `JMP $EA81` when the index does not wrap, 25 for `$EA81` through
`RTI` (measured for `recipes/kickassembler/raster-bars.md`). About 150
cycles of overhead per slot with the handler empty, two and a half PAL
lines; the x position of the colour write above is consistent with the
count but was not converted to a cycle number here. The wrap adds the
16-bit increment and whatever the music player and frame work cost; the
recipe's decimal print is a few hundred cycles, not measured.

### Recipes

- `recipes/kickassembler/irq-chain.md`

### Sources

- VICE 3.10, `x64sc`, models `default` and `ntsc`, 8,000,000 and
  12,000,000 cycles: every figure marked measured, read from the exit PNG
  with PIL and the character ROM.
- This repository: `recipes/kickassembler/raster-bars.md` (the ring form,
  `$EA31` and `$EA81` costs, where the write lands),
  `recipes/kickassembler/cracktro-template.md` (a thirteen-handler ring and
  its badline lesson), `recipes/oscar64/raster-bars.md` (`rasterirq.h`,
  the same table with a sorter), `frame_sync_loop` above (the once-a-frame
  tick).
