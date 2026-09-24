---
category: raster
chip: VIC-II
---

<!-- doc-type: technique-reference -->

# Raster Techniques

The VIC-II's raster counter is the synchronization point for every visual effect on the C64. The chip advances through 312 scanlines per frame on PAL (263 on NTSC), and the CPU can receive an interrupt when that counter matches a programmed compare value. With that interrupt, software can reconfigure VIC-II registers mid-frame: change colors, switch display modes, adjust scrolling offsets, reposition sprites or open the borders. Without raster control the C64 shows one static screen per frame. With it, the 1 MHz CPU can set up a different display on every scanline, provided every cycle is accounted for.

The VIC-II reads its registers continuously and asynchronously. A write takes effect on the current dot clock cycle, not at a safe point in the frame. Raster compare IRQs fire with 0–6 cycles of jitter, because the 6510 first finishes the current instruction, whose length varies (an earlier version of this sentence said 1-2). Badlines steal 40-43 cycles per line from the CPU (plan on 43) unless the code tracks them. Opening the side borders requires a write whose write cycle is one specific cycle of the 63. Each technique below is the C64 demo scene's way round a mechanism that is too imprecise or too costly on its own. Stable raster IRQ is the base the others build on.

---

## stable_raster_irq — Stable raster IRQ

**Complexity:** medium
**Region:** both
**Uses registers:** SCROLY, RASTER, VICIRQ, IRQMSK
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=310, lines_active=3, irq_slots=1, zp_bytes=0
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-stable-raster-irq (one double-IRQ entry through $0314 to the synced line, plus the re-arm and exit; screen on, badlines inside; NTSC, 262 on PAL)
**Claims:** vic_raster_irq (shares)
**Claims basis:** derived-listing

### Why

An ordinary raster IRQ is generated when the VIC-II's internal raster counter matches the 9-bit compare value built from $D012 (low 8 bits) and bit 7 of $D011 (RST8, the 9th bit). The IRQ line goes low, the CPU finishes its current instruction, and then begins the interrupt service sequence (7 cycles: two dummy-read cycles, push PC high, push PC low, push P, fetch vector low, fetch vector high; the handler's first opcode fetch follows; an earlier version listed "fetch PC high, fetch PC low" as steps, which they are not: the PC is pushed, not fetched). The jitter comes from finishing the current instruction. 6510 instructions take different numbers of cycles: `LDA #imm` completes in 2 cycles, `STA ($zp,X)` takes 6. When an IRQ fires mid-instruction the CPU waits out the rest of that instruction. The gap between the VIC raising its IRQ line and the handler's first instruction therefore varies by the cycles left in the interrupted instruction: 0 to 6 cycles in practice (most instructions are 2-6 cycles; the 7-cycle BRK is an edge case).

Up to six cycles of jitter is visible. A write to $D020 (border color) that lands one cycle early produces a vertical stripe at the left edge of the border. A sprite multiplex update that arrives one cycle late collides with the previous sprite's DMA window. A mode-switch that jitters by a cycle can corrupt the first row of the display. Stable raster IRQ removes this jitter. Every technique on this page that needs cycle-exact register writes depends on it.

### How

The standard stable raster IRQ sets an initial IRQ one line before the target line. This first IRQ fires, re-acknowledges the VIC interrupt flag, programs $D012 to the target line, and then runs a tight busy-wait loop that reads $D012 until the counter advances. When the counter matches, the handler leaves the loop within one iteration of the line change: 7 cycles for the tightest loop, `CMP $D012` + `BNE` (4 + 3). The writes that follow land within that window, not on one cycle; the `double_irq` technique removes the rest. (An earlier version said the writes land at a predictable cycle offset.)

The sequence is:

1. Set bit 0 of $D01A (IRQMSK) to enable raster interrupts.
2. Write the desired interrupt line number (low 8 bits) into $D012. If the line is >= 256, also set RST8 in $D011.
3. In the IRQ handler: write $01 to $D019 (VICIRQ) to acknowledge the interrupt and clear the VIC's interrupt latch; if this is not done, the IRQ line stays low and the CPU re-enters the handler immediately after RTI.
4. Write the next scheduled interrupt line into $D012.
5. If sub-cycle precision is needed (double-IRQ variant), see the `double_irq` technique.

**Who owns the raster compare.** A stable raster IRQ is a way into a handler, not an effect. The effect that runs in the handler (raster bars, an FLI display, an open border, a multiplexer zone) owns the compare; this technique is how that handler is entered. Its Claims line therefore says `shares`: two effects that each use a stable entry still contend for the one compare, and a stable entry inside an effect's own handler does not.

NOPs inserted after the $D012 write do not absorb jitter. They delay every entry by the same number of cycles, so the following stores still spread over the same 0-6 cycles, only later in the line. Landing on one cycle needs the `double_irq` technique. (An earlier version said two NOPs, 4 cycles, absorb the jitter window.)

### Why it works

The VIC-II maintains an internal 9-bit raster counter. At the start of each new raster line, the hardware increments this counter and compares it against the 9-bit compare value. If they match AND the raster IRQ mask bit in $D01A bit 0 is set, the chip asserts the IRQ line on the CPU's /IRQ input. The assertion happens on a fixed cycle at the start of the line, one cycle later for line 0. This knowledge base calls it cycle 1 (cycle 2 for line 0), numbering cycles 1-63. That is from Christian Bauer's VIC-II article, whose own numbering gives it as cycle 0 or 1; it has not been measured here.

The CPU sees the /IRQ pin go low and responds after completing its current instruction. That variable completion time is the jitter. The stable-IRQ technique uses the raster counter itself as the synchronization point: once the CPU is in the handler, the handler polls $D012 in a tight loop. The raster line has not yet incremented, so the loop spins for whatever remains of the line. When $D012 increments, the loop sees it on its next read, 0-6 cycles later for a 7-cycle `CMP $D012` / `BNE` loop, so every later instruction runs within one loop iteration of that increment. (An earlier version said a fixed cycle offset; only the `double_irq` technique gets that.)

The re-acknowledge step (write $01 to $D019) must not be skipped. $D019 bit 0 is the raster interrupt flag. It is set by the VIC when the interrupt fires and cleared by writing a 1 to that bit (the register uses write-1-to-clear semantics, similar to CIA interrupt clearing). If the flag is not cleared, the VIC keeps asserting /IRQ and the CPU re-enters the handler immediately after RTI. Handlers often read $D019 before writing it, to check which interrupt source fired; with a single source the read can be skipped.

### Variations

**Single IRQ with NOP pad.** For effects that tolerate the full 0-6 cycles of jitter: fire the IRQ, acknowledge, run a few NOPs of known total cycle count, then do the register writes. The pad moves the writes later in the line; it does not narrow the jitter. (An earlier version said the pad absorbs worst-case jitter to 1-cycle precision.)

**Double IRQ.** When zero jitter is required, use two IRQs on adjacent lines. The first IRQ sets up the second; the second uses a counted busy-wait-then-NOP sequence to land on cycle 1 of the target line. See the `double_irq` technique for the full protocol.

**Interrupt vector placement.** With the KERNAL ROM in, the hardware vector at $FFFE/$FFFF points at the KERNAL dispatcher at $FF48, which pushes A, X and Y, checks for BRK and jumps through $0314/$0315: 29 cycles before the first instruction of whatever $0314 points at. Patching $0314 is the normal way in and pays all 29. Banking the KERNAL out and pointing $FFFE/$FFFF at the handler removes the dispatcher, leaving the 7-cycle interrupt sequence plus whatever registers the handler saves itself, at the cost of servicing CIA interrupts and the keyboard in the program.

**NMI-based raster timing.** Some techniques use a CIA2 timer NMI for raster work, to avoid contention with the IRQ chain. Not covered here; see the CIA2 reference.

### Cycle budget

On PAL (63 cycles/line), the accounting is:

- VIC pulls /IRQ low at the start of cycle 1 of the target line (cycle 2 for line 0). An earlier version said "cycle 0"; cycle numbering in this knowledge base starts at 1. The cycle is from Bauer's VIC-II article, not measured here.
- CPU finishes current instruction. The interrupt follows the first instruction that ends on cycle 2 or later; one that ends on cycle 1 runs on into the next instruction, which also completes. So the interrupt sequence starts on cycle 3 at the earliest (a 2-cycle instruction on cycles 1-2) and on cycle 9 at the latest (an instruction ending on cycle 1, then a 7-cycle `INC abs,X` on cycles 2-8): a 2-cycle minimum plus 0-6 cycles of jitter. Measured in VICE x64sc 3.10 (table below). That the 6510 samples /IRQ on an instruction's second-to-last cycle is the usual 6502 account of why; it is not measured here. An earlier version gave only the 0-6 cycles and no minimum.
- CPU executes interrupt sequence (7 cycles): two dummy-read cycles, push PC high, push PC low, push P, fetch vector low, fetch vector high; the handler's first opcode fetch follows. (An earlier version counted the handler's first fetch inside the 7; it is the handler's own first cycle.)
- Entry path: with the KERNAL banked out and $FFFE/$FFFF pointing at the handler, nothing more; through the KERNAL vector, the $FF48 dispatcher adds 29 cycles before the first instruction at $0314 (see Interrupt vector placement).
- Handler entry overhead (LDA/STA for acknowledgment): 6-8 cycles.
- Handler's first instruction: cycle 10-16 of the line with the KERNAL out, 39-45 through $0314, so a first write 6-8 cycles in lands on about cycle 16-24 or 45-53. An earlier version said the handler was entered on cycle 37-43 and the write came 13-21 or 42-50 cycles after the assertion, and called that measured; it was arithmetic (1 + 0-6 + 7 + 29) without the 2-cycle minimum.

Measured in VICE x64sc 3.10 (issue #85): an exec tracepoint on the handler's first instruction, raster IRQ on line 20 (no badline, no sprites), a probe varying its own length each frame, main loops of `NOP`s, `INC abs,X` or `ROR abs,X` sleds, a taken `BNE *`, a taken branch across a page, and mixed code. Cycles are Bauer's, the exec CYC plus one (`runtime/vice-reference.md`, "What the CYC column counts"):

| Entry path | Main loop | First instruction, PAL | First instruction, NTSC |
|---|---|---|---|
| $FF48 → ($0314) | all loops (7,742 PAL and 8,850 NTSC entries) | 39-45 | 39-45 |
| $FF48 → ($0314) | `NOP`s and `JMP` | 39-41 | 39-41 |
| $FF48 → ($0314) | taken `BNE *` | 40-42 | 41-42 |
| $FFFE (KERNAL out) | all loops (7,738 and 8,835 entries) | 10-16 | 10-16 |

The two ranges differ by the 29 dispatcher cycles. The upper end needs a 7-cycle instruction in the main loop; code built from short instructions enters earlier and over a narrower spread.

Once the busy-wait has synced to the next line boundary the budget on that line is ~55 cycles whichever way the interrupt was entered. The entry cost is paid on the arming line, which is why the IRQ is set one line early. Without a sync, on the arming line itself, about 50 cycles remain with $FFFE pointing at the handler (KERNAL out) and about 20 through $0314 (handler entered on cycle 39-45, 37-43 before #85; see Interrupt vector placement). An earlier version gave 40-50 without saying which entry path. On NTSC (65 cycles/line), the budget is 2 cycles wider per line.

Measured per stable entry, traced in VICE x64sc 3.10 in `recipes/kickassembler/stable-raster-irq.md` from the first interrupt's acceptance to the first instruction after the `$D012` compare, and from the end of the payload to the end of `RTI`: entry 185 to 190 cycles on PAL and 189 to 195 on NTSC, exit 71 to 72 on PAL and 114 to 115 on NTSC. The entry spans three lines, from the arming line to the synced line, and one of them is a badline in the recipe's placement; the NTSC exit crosses a second one. The worst entry plus exit, 262 on PAL and 310 on NTSC, is the Cost line. It said 124 before, by arithmetic that left out the two-line wait of the double IRQ.

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
**Cost:** cycles_per_frame=1471, lines_active=10, irq_slots=10, bytes_code=577, bytes_data=33
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** kickassembler-raster-bars (ten handlers through $0314 with their $D012 spins, the $EA31 exit once, no key held; NTSC, 1,464 on PAL)
**Claims:** vic_raster_irq (owns)
**Claims basis:** derived-listing

### Why

Raster color bars (horizontal bands of color down the screen) are the first raster effect most coders write. They show that the VIC-II reads $D020 (border color) and $D021 (background color 0) continuously and shows any change immediately on the current raster line. 16 colors times up to 200+ raster lines per frame costs the CPU two byte writes per line.

Raster bars are also a building block. Status bars in games change the background color at the display mode boundary. Gradient fills simulate additional colors. Parallax bars suggest depth. The technique is also a timing diagnostic: if a bar bleeds across lines, a cycle-exact write is arriving late.

### How

The basic sequence in an IRQ handler is:

1. Write the new border color to $D020.
2. Write the new background color to $D021.
3. Advance $D012 to the next target line (the next bar boundary) and acknowledge $D019.
4. Return from interrupt (RTI).

For a color gradient covering many lines, chain IRQs in a ring: each handler writes the current line's colors, advances $D012 by N lines, and exits. The IRQ fires again N lines later for the next color in the palette. Every multi-split raster effect uses this chaining pattern.

For a color change on every line (a rainbow), the handler must write $D020/$D021 in fewer than 63 cycles total. That fits on ordinary lines, but the 40-43-cycle badline stall (plan on 43) means badline rows need separate handling: the badline's color is written in the preceding line's IRQ, since the CPU is stalled on the badline itself.

### Why it works

The VIC-II reads $D020 and $D021 once per dot-clock cycle during horizontal raster generation. The color value fetched at a dot position is the color of that dot. The 6510 and VIC-II share the bus via the phi1/phi2 clock scheme, so a CPU write to $D020 takes effect at the phi2 edge of the write cycle, which corresponds to the dot position being generated about 2 clock cycles after the write. This 2-cycle offset is constant and the same on PAL and NTSC, so cycle-exact color placement is predictable. The latency is in cycles, each eight pixels wide (not measured here; the pixels-per-cycle figure below is).

The VIC-II's color registers have no buffering. Unlike systems with scanline-latched registers, they reflect writes immediately. Writing one cycle late shifts the colour change right by 8 pixels, not onto the next line: one CPU cycle is eight dots on both PAL and NTSC (dot clock / CPU clock = 8.000; measured in VICE x64sc: a colour toggled every 4 cycles gave a 64-pixel period). The visible effect of a 1-cycle timing error is an 8-pixel step in the seam, not a full-line displacement. An earlier version of this paragraph said "2 dots", probably by confusing the 2-cycle latency above with a pixel count.

### Variations

**Background only.** Write $D021 only, leaving $D020 constant. Produces color bands within the display area without affecting the border.

**Border only.** Write $D020 only. Useful for status bars and frame decorations that must not disturb the display area.

**Gradient via lookup table.** A 16-byte (or 32-byte cycled) table of color values in zero page, indexed by a counter incremented in each IRQ entry, produces a color gradient that shifts when the starting index changes: a rotating rainbow with no computation per frame.

**Parallax bars.** Two bar sequences at different speeds, one for background and one for border, shifted by different amounts each frame. A cheap depth illusion.

**Wide bars with single IRQ per bar.** Program $D012 to the start of each bar region. Within the bar, use NOP padding or a per-line loop to hold the color for the bar's height. Cheaper for tall bars than one IRQ per line.

### Cycle budget

Through $0314 the handler is entered on cycle 39-45 (measured in VICE, see the `stable_raster_irq` Cycle budget; an earlier version said 37-43, arithmetic, and called it measured), leaving about 20 cycles on the line: enough for the two colour stores (8 cycles, two `STA abs` at 4 each) and the $D012/$D019 bookkeeping (10) and little else; with the KERNAL out and $FFFE pointing at the handler about 50 remain. An earlier version said 50-55 usable and did not name the entry path. On a badline, the 40-43-cycle stall removes almost all work budget; designs that change color on badline rows write the color value one line early.

Measured per frame in `recipes/kickassembler/raster-bars.md`, traced in VICE x64sc 3.10 from each interrupt's acceptance to the end of `RTI`: 125 cycles for each of bars 1 to 8, 119 (PAL) or 126 (NTSC) for bar 0, and 345 for bar 9, which rotates the palette and exits through `$EA31`; 1,464 a frame on PAL and 1,471 on NTSC. Each handler is armed a line early and spins on `$D012`, and the spin is inside the figure. The code is 577 bytes and the palette 33, from KickAssembler's memory map (`$0900-$0928`, `$0B00-$0D17`; `$0A00-$0A20`). The Cost line said 990 cycles and 600 bytes before, both estimates. Before #72 one basis word covered the whole Cost line, so it said `derived-listing`, the bytes' rung, beside measured cycles; the cycles now say `measured-vice` and the bytes keep `derived-listing` on their own line.

### Recipes

- `recipes/oscar64/raster-bars.md`
- `recipes/kickassembler/raster-bars.md`

---

## badline_synchronization — Badline synchronization

**Complexity:** high
**Region:** both

**Uses registers:** SCROLY, RASTER
**Demands:** midframe_raster_irqs
**Claims:** vic_yscroll (reads)
**Claims basis:** measured-vice

A store trace (`scripts/claims-watch.ts`, VICE x64sc, PAL) of
`recipes/kickassembler/fld.md`, the one recipe that lists this technique,
found no store of its own: every `$D011` store there is
`fld_flexible_line_distance`'s (its per-line YSCROLL writes and its
per-frame reset to `$1B`). What it needs is which lines are bad, and that
follows YSCROLL, so it reads the unit whoever owns it. The YSCROLL
variation below writes the unit and should claim it where a program uses it.

### Why

The VIC-II takes the badline's cycles from the CPU once per character row, on its first line (every eighth line), and the program cannot opt out. (An earlier version said eight times per character row.) During a badline, the VIC-II fetches the 40 screen codes for the current text row. It does this by pulling BA (Bus Available) low on cycle 12 and taking the phi2 bus for the 40 c-accesses on cycles 15-54. The CPU may only complete write cycles on 12-14 and cannot read again until cycle 55, so the stall it sees is 40-43 cycles: 43 for any ordinary instruction stream (measured 43 for a NOP stream, 42-43 for STA zp in VICE), 40 only when three consecutive write cycles happen to fall on 12-14. Plan on 43 lost and 20 left (63 - 43) on PAL, 22 on NTSC. An earlier version of this paragraph said BA was low "for 40 cycles" and called the stall 40; that counts only the c-access cycles.

Any timing plan that ignores this loss is wrong. A raster effect that writes 8 registers per line works on non-bad lines but slips by 40-43 cycles on badlines, producing visible glitches. Badline synchronization means knowing which lines are bad (and so where the stalls fall), and writing IRQ handlers that either avoid critical writes on bad lines or account for the 40-43-cycle deduction (plan on 43) when a write must happen on one.

### How

A badline occurs when two conditions are true at once: the display is enabled (DEN, $D011 bit 4, was set at some point during raster line $30; any cycle of that line arms badlines for the frame; an earlier version said cycle 14 specifically), and the low three bits of the current raster line number equal the YSCROLL value in $D011 bits 2-0. With the default YSCROLL of 3, badlines occur at raster lines 51, 59, 67, ... 243: every 8th line starting at $33, 25 badlines per frame on PAL.

With a fixed YSCROLL the badlines are deterministic, so a program can build a lookup table of line type (bad vs non-bad) and schedule IRQ handlers only on non-bad lines when cycle budgets are tight. Or a handler that fires on every line can subtract 43, not 40, from its available cycle count on badlines (63 - 43 = 20) and attempt no more work than that.

YSCROLL itself is the second lever. Writing a new YSCROLL value to $D011 bits 2-0 changes which lines are bad. Doing this mid-frame can go wrong (see the `raster_split_modes` technique), but it can move the badline cluster away from a critical raster window.

A third approach, used in demo code, accounts for badlines at assembly time: the raster handler is a sequence of cycle-counted instruction blocks, with bad and non-bad variants selected by a look-up at handler entry.

### Why it works

The VIC-II needs character codes to generate text-mode output: which character is in each of the 40 cells of the current row. It fetches these from screen RAM (video matrix), which lives in the VIC bank and is not accessible during the CPU's phi2 cycles; the VIC needs the bus to itself. The chip pulls BA (bus available) low on cycle 12, three cycles before it needs the bus. In those three cycles the CPU may still complete write cycles, but it stops at its first read. From cycle 15 the VIC takes the phi2 bus for 40 cycles of screen RAM fetch (cycles 15-54), then releases it, and the CPU resumes on cycle 55. The CPU loses 40-43 cycles; plan on 43, as in "Why" above. (An earlier version said the chip "raises" BA, and counted only the 40 fetch cycles.)

The timing is locked to the YSCROLL field because the VIC increments its internal row counter on each badline. The row counter increments when `(current_raster_line & 7) == YSCROLL`. The first badline of a frame must occur while DEN is set, or badlines are suppressed for the entire frame. Clearing DEN this way ("blinking DEN") blanks the display and gives the CPU all cycles back.

NTSC behaves identically in terms of which lines are bad (same YSCROLL logic), but the cycle loss (40-43 cycles) and the available cycles per line (65 on NTSC vs 63 on PAL, so 65 - 43 = 22 left on NTSC) mean the badline penalty as a fraction of a line's budget is slightly lower on NTSC. NTSC has fewer lines per frame, but the badline window ($30–$F7) and the 25 character rows inside it do not depend on the frame length, so an NTSC frame has the same 25 badlines as PAL: 51, 59, …, 243 (measured in VICE x64sc: 2,500 stalls in 100 frames on both the PAL default, a C64C with the 8565, and the 6567R8, and none with DEN clear; an earlier version said the PAL run was a 6569). The shorter NTSC frame loses lines from the vertical blank, not from the display; per frame the CPU has fewer non-bad lines than on PAL (238 against 287), and the 43-cycle stall (an earlier version said 40) is a slightly smaller fraction of each 65-cycle bad line. (An earlier version of this paragraph said 24.) An earlier revision of this entry also carried a PAL-only Region tag; the technique applies to both regions, as the figures above show.

### Variations

**Badline avoidance.** Schedule IRQs on non-bad lines only. Works when the effect tolerates one line of imprecision in its split position. Most game status bars do this; a 1-pixel vertical shift in the status bar boundary is not noticed.

**Badline accounting.** Include the 40-43-cycle stall (plan on 43) in the cycle budget of every handler that can fire on a bad line. The handler can poll $D012 at entry to tell whether it is on a bad line and take one of two code paths.

**YSCROLL manipulation.** Write $D011 bits 2-0 to shift the YSCROLL value, moving badlines out of a critical effect window. Changing YSCROLL mid-frame at the wrong cycle can cause FLD (Flexible Line Distance) effects. See also `raster_split_modes`.

**DEN suppression.** Clear bit 4 of $D011 (DEN). The display blanks and badlines stop; the CPU gets all 63/65 cycles per line. Used in raster bars that cover the whole screen, and in effects where the display is drawn only by sprites or is deliberately blanked.

### Cycle budget

PAL, non-badline: 63 cycles total.
PAL, badline: 20 cycles guaranteed (cycles 1-11 and 55-63). The VIC pulls BA low on cycle 12 and takes the bus for its 40 c-accesses on cycles 15-54; on cycles 12-14 the CPU may only complete write cycles, so "23" is the figure for code that happens to be writing then, and 20 is the one to plan on.
NTSC, non-badline: 65 cycles total.
NTSC, badline: 22 cycles guaranteed, 25 with three write cycles.

For cycle-tight code running on every line, the badline constraint means the worst case is 20 cycles per line on PAL. Any per-line loop must complete in 20 cycles or less to be badline-safe, or must handle the bad-line case separately. A badline also moves every later instruction on that line by 43 cycles (an earlier version said 40): a write planned for cycle 56 cannot be placed there at all, because no read can happen between cycles 12 and 54 and every store's write follows a read.

### Recipes

(No standalone recipe yet. Badline synchronization is built into stable-raster-irq and other recipes.)

---

## double_irq — Double IRQ for jitter elimination

**Complexity:** scene-tier
**Region:** both
**Uses registers:** RASTER, VICIRQ, IRQMSK
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=160, lines_active=2, irq_slots=2
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-stable-raster-irq (one zero-jitter entry)
**Claims:** vic_raster_irq (shares)
**Claims basis:** derived-listing

### Why

The stable_raster_irq technique synchronizes with a polling loop, and the loop has a granularity of one iteration: 7 cycles for the tightest form, `CMP $D012` + `BNE` (4 + 3; no read of an I/O register is shorter than 4). So the stable IRQ synchronizes to within one loop iteration, not one cycle. (An earlier version said it reduces jitter to a fraction of a cycle and gave the granularity as 5-7 cycles.) For side-border opening, VSP glitch timing and hardware-sprite multiplexing at exact cycle offsets, any residual jitter is too much.

The double IRQ gives zero-jitter synchronization: the CPU's position on the target raster line is known to within one cycle.

### How

The double IRQ uses two raster IRQ handlers on two consecutive raster lines. The first IRQ (line N) does minimal work: it re-acknowledges $D019, sets $D012 to line N+1, and exits with RTI. Because this IRQ does almost nothing, its execution is fast and repeatable. The second IRQ (line N+1) uses a sequence of instructions chosen to consume exactly the right number of cycles to land at a specific cycle position within line N+1, regardless of the jitter that affected the first IRQ.

The classic implementation of the second handler uses a sequence like:

- At IRQ entry, the handler immediately acknowledges $D019.
- It then executes a tight sequence of instructions with a total known cycle count, padded with NOP instructions if needed, to reach cycle C of line N+1.
- The register write that must be cycle-exact happens at cycle C.

Like `stable_raster_irq`, of which it is the zero-jitter form, this is a way into a handler: the effect the second handler runs owns the raster compare, and the Claims line says `shares`. In `recipes/kickassembler/fli-image.md` and `recipes/kickassembler/sideborder-open.md` the double IRQ is the entry of the FLI and open-border code.

Two IRQs work better than one because the first IRQ absorbs the jitter from the unknown instruction-completion state at IRQ entry. By the time the first IRQ completes and the second fires, the processor is executing a known, counted instruction stream from the end of the first RTI, so the second IRQ lands at a predictable time relative to the raster line.

### Why it works

The 6510's interrupt response adds a fixed 7-cycle overhead once jitter is absorbed. After the first IRQ's RTI, the processor returns to whatever was running between IRQs (usually a tight NOP loop or a `JMP *` halt). The second IRQ fires at line N+1's line 0 cycle; the CPU finishes the current instruction (a known NOP or similar in the loop body) and enters the second handler with known timing.

The arithmetic: let `J1` be the jitter in the first IRQ (0-6 cycles). The first handler executes `K1` cycles of work. At RTI, the processor has consumed `J1 + 7 + K1` cycles since the first IRQ fired. Because the first IRQ fired near line N's boundary, RTI returns somewhere within line N or just into line N+1. The second IRQ fires at the same cycle within line N+1, but now the CPU was executing a known instruction (NOP) between the handlers. The jitter on the second IRQ entry is set by how far into the NOP the second IRQ arrived, which is known.

Knowing the instruction between IRQs (always a NOP in the loop) and knowing the second IRQ fires at a fixed cycle within its line together remove the jitter.

Measured form (`recipes/kickassembler/stable-raster-irq.md`, VICE x64sc): through the KERNAL vector the handler's first instruction starts on cycle 39-45 of the line (interrupt sequence from cycle 3-9, then 7 for the sequence and 29 for the dispatcher; measured, see the `stable_raster_irq` Cycle budget; an earlier version said 37-43, arithmetic that missed the 2-cycle minimum), so the first handler cannot finish its setup and be sliding through NOPs before the *next* line's interrupt; it arms the second IRQ two lines down, not one. Entered from a NOP, the second handler has one cycle of residual jitter, which two consecutive reads of $D012 four cycles apart plus a `BEQ` remove: with the right padding the reads straddle the line boundary in one case and not the other, and the branch costs 3 or 2 cycles to compensate. The padding is found by measurement: the recipe's bars align at `SYNC_PAD = 11` and split into two columns at 10 or 12. Two traps: the KERNAL dispatcher executes `TSX` itself, so a stack pointer saved in X by the first handler does not survive into the second (save it in memory); and every line the two handlers and the timed code occupy must be a non-badline except the one inside the NOP slide, where a stall is harmless.

### Variations

**NOP-padded single entry.** Some implementations fold the double-IRQ logic into a single handler that spins until the raster counter advances, then executes a counted NOP sequence to reach the target cycle. This is shorter to write but harder to count cycle-exactly. The two-handler form is easier to document and maintain.

**IRQ set on same line: not a variant.** Writing the same $D012 value again from the handler gives no second IRQ in that frame. The next match is the next frame, 312 lines (19,656 cycles) later on PAL: the ordinary once-per-frame IRQ. Measured in VICE x64sc: a handler on line 100 that rewrites $D012 with 100 counted the same one IRQ per frame as one that does not. (An earlier version listed this as a double-IRQ variant, explained by the raster interrupt "latching immediately", and had the handler track which firing it was on.)

**CIA timer second stage.** A CIA timer started in the first IRQ handler fires a second IRQ a counted number of cycles later, so the second trigger does not depend on raster line boundaries. Used for effects that need a write at a specific horizontal dot position across multiple lines.

### Cycle budget

The double IRQ removes jitter; it does not save cycles, and it spends more than an uncounted single IRQ. The overhead is:
- First IRQ: through $0314, 38-44 (the handler starts on cycle 39-45, measured) + ~12 (ack + set $D012 + RTI) = ~50-56 cycles consumed on the arming line; with the KERNAL out, 9-15 + ~12 = ~21-27. Before #85 this said 36-42 and 7-13, arithmetic without the 2-cycle minimum. An earlier version gave only the ~19 figure without naming the entry path.
- Between IRQs: the NOP loop in the main loop body runs for whatever cycles remain in line N after the first RTI (variable but bounded).
- Second IRQ: 7 (enter) + NOP pad (0-6 cycles) + actual writes.

Total cost per raster split in double-IRQ mode: through $0314, 38-44 + ~12 on the arming line for the first handler, then 38-44 + pad for the second (36-42 twice before #85), about 100 cycles over three lines (the first handler arms the second IRQ two lines down, see Why it works), not 35-45 over two as an earlier version said; roughly 60 over two lines with the KERNAL out. Compare 20-30 cycles for an uncounted single-IRQ split with the KERNAL out.

### Recipes

- `recipes/kickassembler/stable-raster-irq.md` (includes double-IRQ pattern)

---

## clock_slide_raster_irq — Stable raster IRQ by clock slide: a CIA timer measures the lateness, a branch into a slide removes it

**Complexity:** scene-tier
**Region:** both
**Uses registers:** RASTER, VICIRQ, IRQMSK, DC04, DC05, DC0E
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=36, lines_active=1, irq_slots=1
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-clock-slide (one entry, first instruction to the end of the slide, lateness 0; KERNAL out)
**Claims:** vic_raster_irq (shares)
**Claims basis:** derived-listing
**Alternative to:** double_irq (one interrupt and one line instead of two interrupts over three; needs a CIA timer running for good and a start-up sync)

### Why

`stable_raster_irq` and `double_irq` remove the entry jitter by
waiting for a raster line to change: the double IRQ spends a second
interrupt and, in `recipes/kickassembler/stable-raster-irq.md`, 185 to
190 cycles over three lines. A CIA timer that runs with the period of a
raster line can tell the handler how late it is instead, and the
handler can wait exactly that much less, on the interrupt's own line.

### How

1. Once, with interrupts off and the display blanked, start a CIA timer
   in continuous mode with a latch of one line less one: 62 on PAL, 64
   on NTSC. Start it on a known cycle of a line: a loop whose passes
   are one cycle longer than a line reads `$D012` one cycle later each
   time, and the first read that sees the next line was made on its
   first cycle.
2. In the raster handler, read the timer low byte early. The earliest
   possible entry reads a fixed value `V0` (found by measurement);
   `V0 - timer` is the lateness `j`.
3. Store `j` as the offset of a `BPL` into a slide of `$A9` bytes ended
   by `$24 $EA`. Skipping `j` bytes waits `j` cycles less.

```asm
irq:    sta za
        lda #V0          // the timer value of the earliest entry
        sec
        sbc $dc04        // j = how many cycles late
        and #$07
        sta slide+1
slide:  bpl slide+2      // skip j bytes
        .byte $a9, $a9, $a9, $a9, $a9, $a9, $a9, $24, $ea
        // here on the same cycle every time
```

The whole program is `recipes/kickassembler/clock-slide.md`.

### Why it works

The timer's period equals a raster line, and a frame is a whole number
of lines, so the value it holds on a given cycle of a line is the same
on every line of every frame. A late entry reads the timer later, and
the timer counts down, so the reading falls by one for each cycle of
lateness. In the slide, `n` bytes before the `$24` run as `LDA #$A9`
pairs and then `BIT $EA`, or as pairs, `LDA #$24` and `NOP`: `n + 3`
cycles either way, one per byte skipped. Measured in VICE x64sc 3.10
over 2,000 entries: lateness 0 to 6, and one timer value after the
slide, on PAL and NTSC; the store after the slide lands on x = 305 of
every bar in both screenshots.

The branch and the slide must sit in one page: a `BPL` taken into the
next page costs a cycle more and shifts every entry
(`pitfalls/cpu.md`, `branch_page_cross_extra_cycle`). The recipe checks
it with `.errorif`.

The handler's own length must not vary if the next entry's lateness is
to depend only on the main program: an `INC` / `BNE` / `INC` counter in
the handler of the recipe's first build shifted one entry in a later
frame, from run to run.

### Variations

- **Through `$0314`.** With the KERNAL in, the handler starts 29 cycles
  later but the jitter is the same, and the same slide removes it; only
  `V0` changes.
- **CIA2 timer, or timer B.** Any free-running timer works; the one
  chosen is held for good, and the others stay free.
- **Several lines a frame.** One timer serves every raster interrupt of
  the frame. The recipe takes seven, three lines apart; two lines apart
  its handler, with the recording it does, overran the next line's
  interrupt.

### Cycle budget

From the handler's first instruction to the end of the slide:
3 + 2 + 4 + 2 + 2 + 4 + 2 + 4 + 3 + (10 - j) = 36 - j cycles, by the
instruction table; the synced point is on the same cycle of the
interrupt's line for every `j` (rung 1, the timer read after the
slide). With the handler entered on cycle `10 + j` (KERNAL out,
`stable_raster_irq`), that is cycle 46 (rung 3). The `**Cost:**` line
carries the 36 cycles and one line; the effect's own work and the
`RTI` are extra. The start-up sync runs once, about 50 lines with the
display blanked.

### Recipes

- `recipes/kickassembler/clock-slide.md`: seven stable interrupts a
  frame on PAL and NTSC, 2,000 entries recorded, and the synced store
  measured in the screenshots.

---

## vsp_glitch — VSP (Variable Screen Position)

**Complexity:** scene-tier
**Region:** both

**Uses registers:** SCROLY, VMCSB
**Demands:** midframe_raster_irqs
**Requires:** stable_raster_irq
**Claims:** vic_raster_irq (owns), vic_yscroll (owns)
**Claims basis:** measured-vice

Store trace (`scripts/claims-watch.ts`, VICE x64sc, PAL) of
`recipes/kickassembler/vsp.md`: each frame one `$D011` store on line 252
sets YSCROLL 7 and the timed store on line 51 sets YSCROLL 3, so the
technique drives YSCROLL for the whole top of the frame. Its raster
interrupts are the effect's own, entered through `stable_raster_irq`.

### Why

The VIC-II's character-mode display is generated from screen codes in a 40-column video matrix. The VIC fetches one row of 40 characters per character row during badlines, and builds the 8 pixel rows between badlines from character ROM or character RAM. Horizontal scrolling by up to 7 pixels is done with $D016 bits 2-0 (XSCROLL). Shifting by more than 7 pixels requires changing the start address of the video matrix, which only takes effect at the beginning of the next character row.

VSP (Variable Screen Position) is a hardware glitch, not a designed feature. It makes a mid-character-row screen address change take effect immediately by changing when the VIC-II thinks a new character row begins. The result is pixel-exact horizontal scrolling beyond the 7-pixel XSCROLL limit, with no extra memory or display-mode changes; it works in standard text mode.

### How

VSP is a $D011 trick; the CSEL toggle described here before belongs to
`sideborder_open`. On the line that is about to be a badline for a
character row, arrange for the badline condition to be *false* in cycle 14
(YSCROLL not equal to `line & 7` at that moment), then at a chosen cycle
between 14 and 53 (the store's cycle) write $D011 with YSCROLL = `line & 7`, so the condition
becomes true late. The VIC starts its c-accesses three cycles after BA drops,
from whichever column slot the beam has reached, and the columns before it
are not fetched for this row. Because the video counter VC advances only by
the number of c-accesses actually performed, the row ends with VC short by
that many characters, and every row after it in the same frame starts that
many characters earlier in screen RAM: the picture moves right by N
characters. One cycle-exact write per frame, on the first badline, moves the
whole screen; the screen base is adjusted for whole screens of travel, and
XSCROLL still handles the seven pixel steps in between.

Measured in VICE x64sc by `recipes/kickassembler/vsp.md` (PAL and NTSC):
each cycle of extra delay moves the screen one more character right, from 1
to 40; the three delays before the first shift spoil only the late row
itself (one column, two columns, the whole row). The offset does not carry
into the next frame: a frame without the late write is normal, so the write
is made every frame. In the numbering the other pages use, the cycle of
the store as a VICE store trace prints it (`runtime/vice-reference.md`),
N = cycle − 14: the recipe's 10-character write traces on cycle 24 on
both models, and `recipes/kickassembler/agsp.md` traced its late write on
14 + N for every N from 0 to 39 and saw the picture follow, one cell per
cycle. VICE's VSP-bug log prints `Cycle: 24` for the same write; an
earlier version of this paragraph read that as a table index one below
Bauer's cycle, made it 25 and gave N = cycle − 15, and "How" said
"between 15 and 53". The log and the store trace print the same number
for the same store, so either the log's "+1" reading was wrong or the log
reports the cycle after the store; not settled here. By the store's cycle
the range is 14 to 53. (An earlier version of this paragraph said the display moved left,
that the offset persisted into later frames until re-based, and that one
write per character row was needed; the recipe shows right, one frame, and
one write per frame.)

### Why it works

The VIC loads VC from VCBASE and clears VMLI in cycle 14, and only then; a
badline condition that becomes true later leaves those alone and starts the
c-access sequence mid-row, with VMLI counting from where the accesses start.
Christian Bauer's VIC-II article documents this as "DMA delay" (§3.14.6),
and it is the same mechanism FLI uses to lose its three leftmost columns;
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

**Whole-screen scroll.** One write per frame, on the first badline, plus
the base-pointer adjustment (an earlier version said one per character row). **Partial zone.** Only the rows of the
play field; rows above and below are ordinary. **Combined with XSCROLL.**
Whole characters by VSP, pixels by $D016 bits 2-0.

### Cycle budget

One cycle-exact `STA $D011` per frame on the first badline, plus the
stable entry that positions it and the wait to the chosen cycle (in the
recipe, from a sync on line 48 to line 51); the badline still costs its 40-43
cycles (plan on 43). Nothing per line. The earlier figure of 12 cycles per
line via a CSEL toggle described the side-border mechanism, misattributed.
An earlier version said one write per character row; the recipe measured
one per frame. The recipe's delay loop was not timed with a CIA.

### Recipes

- `recipes/kickassembler/vsp.md`: a fixed ten-character shift on PAL and
  NTSC, with the one-cycle sweep, measured in VICE x64sc only. VICE does not
  emulate the VSP crash by default, and the recipe is not Safe-VSP hardened.

### Sources

- Linus Åkesson, "Safe VSP" (2013): https://www.linusakesson.net/scene/safevsp/index.php
- Kodiak64, "The future of VSP scrolling": https://kodiak64.co.uk/blog/future-of-VSP-scrolling

---

## fld_flexible_line_distance — FLD (Flexible Line Distance)

**Complexity:** high
**Region:** both

**Uses registers:** SCROLY, RASTER
**Demands:** midframe_raster_irqs
**Requires:** badline_synchronization, stable_raster_irq
**Cost:** cycles_per_line=63, lines_active=40, irq_slots=2
**Cost basis:** arithmetic
**Cost measured on:** kickassembler-fld (40 lines, the recipe's largest)
**Claims:** vic_raster_irq (owns), vic_yscroll (owns)
**Claims basis:** measured-vice

A `scripts/claims-watch.ts` store trace of `recipes/kickassembler/fld.md`
saw YSCROLL change on every line of the gap and the raster compare
re-armed each frame. FLD sets the display's row phase, so beside
`soft_scroll_v` it is an ownership conflict ([#71](https://github.com/bdgscotland/c64-kb/issues/71)). The recipe's
`$0314` vector, CIA2 timer and zero-page bytes are its own choices.

### Why

The text display starts on the first badline of the frame, line 51 with the default YSCROLL of 3, and nothing in the register set moves it further down than YSCROLL's seven lines. FLD moves it by any number of lines. It is the oldest of the badline tricks and the parent of the rest: linecrunch, FPP and AGSP all begin with the same write.

### How

A badline needs `(line & 7) == YSCROLL` (see `badline_synchronization`). Each line, rewrite YSCROLL so that the current line never matches. The VIC then finds no badline, fetches no character row, and stays in its idle state; the raster lines go by and the first row of text has not been drawn. Stop rewriting after N lines and the next matching line is the first badline of the frame: the whole display appears N lines lower, and its last N lines are cut off by the lower border, which does not move.

The recipe writes, on line L, the value `(L + 2) & 7`. That value differs from `L & 7`, so it does not make L a badline, and from `(L + 1) & 7`, so line L + 1 starts clean and the next write has the whole of it to land in. After the last write on line 49 + N, YSCROLL holds `(51 + N) & 7`, and line 51 + N is the first badline. The rest of the frame keeps that YSCROLL, so the rows below stay eight lines apart; the handler restores YSCROLL 3 before line 50 of the next frame.

In the gap the VIC is in idle state and its g-accesses read one fixed address, `$3FFF` in VIC bank 0 (`$39FF` with ECM set; `$7FFF`, `$BFFF`, `$FFFF` in the other banks). That byte is drawn across the 320 pixels of every gap line, bit 1 in colour 0 (black) over the background colour. A stock machine has zero there and the gap is blank; the recipe plants `%10101010` and the gap shows 160 black and 160 blue pixels on every line (measured in VICE x64sc 3.10, PAL and NTSC). That striped band is the proof that no badline occurred: a row fetch would have replaced it with characters.

### Why it works

The badline condition is evaluated on every cycle of a line in the display window, not once. A match still in force when the row fetch is due starts it; a value that matches at the line's first cycle and is changed early enough in the line does not. The cycle at which that decision falls is not measured here; `badline_synchronization` puts BA low at cycle 12 and the c-accesses at 15-54. That sets the safe constraint: if the value in force when a line starts already differs from the line's own bits, the write during that line can land at any cycle. Measured in VICE x64sc 3.10 with the recipe's listing rebuilt to write `(L + 1) & 7` instead of `(L + 2) & 7`, so that each line begins matching: the display did not move at all, the measured first badline disagreed with the expected one and the verdict byte read `$02`. An earlier build of the same variant, writing two cycles earlier in each line, moved the display one line, so the write on line 51 landed in time there and not in the shipped build. The shift is 0 or 1 by the cycle that write lands on, never N. With `(L + 2) & 7` the display moved exactly N lines on every frame of an 8,000,000-cycle run on both models.

Given a value that is safe for the next line, the write itself may land anywhere in the current line. The recipe polls `$D012` for the line change and writes about ten to twenty cycles in; a cycle-counted 63-cycle loop from a stable raster is the classic form and works the same way, but has to be recounted at 65 cycles for NTSC. Either way the entry has to start on a known line, which is why the technique presupposes a stable raster IRQ and the badline rule.

### Variations

**Linecrunch.** The reverse: a YSCROLL write that matches the line after its cycle 58 makes the next line use up a whole character row, so the display moves up instead of down; see `linecrunch`, measured. (An earlier version of this paragraph said to make a badline happen and then rewrite YSCROLL on the same line so the row counter advances; a badline made during the line is a late badline, `vsp_glitch`, not a crunch.)

**FPP (flexible pixel position).** Rewrite YSCROLL on every line of a row so the VIC repeats or skips single pixel lines of the character data, which stretches and squashes the picture vertically. Not measured here.

**AGSP (any given screen position).** Linecrunch, FLD and VSP (`vsp_glitch`) together place the whole screen at any pixel position in one frame; see `agsp_free_scroll`, measured.

**Border stripes.** With the top and bottom borders open (`topbottom_border_open`) the same idle fetch draws `$3FFF` there too; the byte can be changed per line for a cheap full-height pattern.

### Cycle budget

The CPU is held for every line of the gap: the loop's work is 35 cycles per line (the six-instruction YSCROLL update, the counter and the branch) and the rest is spent polling for the next line, so the technique costs the whole line, 63 cycles on PAL and 65 on NTSC, for N lines. Measured in VICE x64sc 3.10 with CIA2 timer A from just before the first write to the end of the loop: 1,131 cycles for 18 lines on PAL (62.8 a line) and 1,423 cycles for 22 lines on NTSC (64.7 a line); the start and stop follow `$D012` polls, so the figure is within a poll's seven cycles of N times the line. The Cost line states 40 lines, the recipe's largest N. The double IRQ that enters the loop is the two slots.

### Recipes

- `recipes/kickassembler/fld.md` — a bouncing display driven by a sine table, `$3FFF` striped, the first badline read back and checked against 51 + N each frame, PAL and NTSC.

---

## linecrunch — Linecrunch: one character row used up per raster line

**Complexity:** high
**Region:** both

**Uses registers:** SCROLY, RASTER
**Demands:** cpu_every_line, midframe_raster_irqs
**Requires:** stable_raster_irq, badline_synchronization
**Claims:** vic_raster_irq (owns), vic_yscroll (owns)
**Claims basis:** measured-vice

A `scripts/claims-watch.ts` store trace of
`recipes/kickassembler/linecrunch.md` saw `$D011` written once per
crunched line and once per frame on line 46, and the raster compare
re-armed each frame. The recipe's `$0314` vector and zero-page bytes are
its own choices.

### Why

FLD moves the text display down without moving screen RAM; linecrunch
moves it up. Each crunched raster line uses up a whole character row, so
N lines scroll the screen N rows. With the colour and screen data left in
place, a whole screen, bitmap included, scrolls vertically by rows for a
few `$D011` writes per frame (Bauer §3.14.4; codebase64 "Linecrunch").

### How

On a line whose row counter RC is 7, write `$D011` with YSCROLL equal to
that line's low three bits on a cycle between 58 and the line's
second-to-last cycle: 58 to 62 on PAL, 58 to 64 on NTSC (measured). The
next line is drawn from the next row with RC still 7, and uses that row
up. Repeat on every line for N rows. RC is 7 before the first badline of
a frame, so a run of writes from line 50 crunches from line 51. On the
last crunched line write a YSCROLL that makes the following line a
badline: the display resumes there with row N. The crunched lines show
pixel row 7 of stale character pointers; set ECM and BMM in the same
writes and they are black.

### Why it works

Bauer (§3.7.2): in cycle 58 of a line with RC = 7 the VIC loads VCBASE
from VC and goes idle; RC is reset to 0 only by a badline condition in
cycle 14; VC counts the g-accesses in display state. A condition made
true after cycle 58 returns the VIC to display state with RC still 7 and
no c-access. The next line, which no longer matches, is drawn from the
new VCBASE with RC = 7, VC advances 40, and its cycle 58 moves VCBASE on
another row. Measured in VICE x64sc 3.10, PAL c64c and NTSC, by
`recipes/kickassembler/linecrunch.md`: with N writes on cycle 60 the
first text line is 51 + N and shows row N, pixel row 0, on every frame;
every line from 51 to the last modelled row matches, 172 on PAL and 144
on NTSC.

The window is the whole of the design. Swept one cycle at a time in the
recipe: 58 to 62 crunch on PAL, 58 to 64 on NTSC; the line's last cycle
(63 or 65) and cycles 53 to 57 do not. A write on 54 to 57 of a row's
last line repeats the row instead (Bauer's doubled text lines, §3.14.5);
a matching write on 15 to 54 starts a late badline, the `vsp_glitch`
mechanism. An earlier plan for this entry (#19, 2026-09-23) made the
condition true after cycle 14 and false before 58; that is the late
badline, and it crunched nothing.

### Variations

**Top of screen.** The recipe's form: crunch from line 51, the screen
starts N rows on and N lines lower. **Mid-screen.** Writes on the last
line of a row and the lines after it crunch from there; the rows above
are untouched. **With FLD.** Crunch N rows, then hold the next badline
off with FLD for the same N lines, and the display starts on line 51
again, N rows on: a vertical coarse scroll with no gap; measured as part
of `agsp_free_scroll`. **AGSP.** With VSP for the horizontal part
(`vsp_glitch`): `agsp_free_scroll`.

### Cycle budget

One `$D011` write per crunched line, at a fixed cycle, so the CPU is
held for every crunched line: 63 cycles on PAL, 65 on NTSC, from a
stable raster. In the recipe the loop is 15 cycles of work and the rest
padding. The picture after the crunch costs nothing.

### Recipes

- `recipes/kickassembler/linecrunch.md` — 0 to 12 rows crunched from a
  sine, PAL and NTSC, every line of the picture checked, with the
  write-cycle sweep.

### Sources

- Christian Bauer, "The MOS 6567/6569 video controller (VIC-II) and its
  application in the Commodore 64" (1996), §3.7.2, §3.14.4 "Linecrunch",
  §3.14.5: https://www.zimmers.net/cbmpics/cbm/c64/vic-ii.txt
- Codebase64, "Linecrunch": https://codebase64.c64.org/doku.php?id=base:linecrunch

---

## agsp_free_scroll — AGSP: the whole screen at any pixel position, from linecrunch, FLD and VSP

**Complexity:** scene-tier
**Region:** both

**Uses registers:** SCROLY, SCROLX, RASTER
**Demands:** cpu_every_line, midframe_raster_irqs
**Requires:** linecrunch, fld_flexible_line_distance, vsp_glitch, stable_raster_irq
**Raster band:** 46-95 (the agsp recipe's IRQ line is 46; its handler acknowledges on line 86 to 95, measured)
**Claims:** vic_raster_irq (owns), vic_yscroll (owns), vic_xscroll (owns)
**Claims basis:** measured-vice

A `scripts/claims-watch.ts` store trace of `recipes/kickassembler/agsp.md`
saw `$D011` written on every line from 50 to the late badline and once
after it, `$D016` once per frame, and the raster compare re-armed each
frame. The recipe's `$0314` vector and zero-page bytes are its own choices.

### Why

A game that scrolls in eight directions normally copies screen and colour
RAM every eight pixels of travel. AGSP (any given screen position) moves
the VIC's view of screen RAM instead: a few register writes at the top of
each frame put the text screen at any pixel position, and no byte of the
screen is copied. The codebase64 article of that name gives the method,
"VSP ... for the horizontal position and a line crunch ... for the
vertical position".

### How

At the top of the frame, before the first text row:

1. Crunch M rows with `linecrunch`: M lines, one write each.
2. Hold the next badline off with FLD for MMAX − M + YS lines, so the
   crunch and the gap together are always MMAX + YS lines and the top of
   the text does not move with M. YS (0-7) is the fine vertical scroll.
3. Make that badline late with `vsp_glitch`: YSCROLL not matching at
   cycle 14, matching from the write on cycle 14 + N (store-trace cycle).
   The rows below start N cells earlier in screen RAM.
4. XSCROLL for the last seven pixels.

Draw every line above the text, the late row included, in an invalid
mode (ECM and BMM set): it is black, and the late row's first cells are
stale. The text starts MMAX + YS + 8 lines below line 51.

### Why it works

Each part is its own measured technique. `linecrunch`: a YSCROLL write
on cycles 58-62 (PAL) or 58-64 (NTSC) of a line with RC = 7 uses up a
row. `fld_flexible_line_distance`: a YSCROLL that never matches keeps
the VIC idle. `vsp_glitch`: a late badline fetches the row from the cell
the beam has reached and leaves the video counter short. Put together in
`recipes/kickassembler/agsp.md` (VICE x64sc 3.10, PAL c64c and NTSC)
with MMAX = 16: every value of N (0-39), M (0-16), YS (0-7) and XS (0-7)
swept one at a time gave a picture whose 200 lines 51-250 all match the
model pixel for pixel, on both models, and the late write traced on cycle
14 + N every time. The video counter wraps at 1024, so screen RAM is a
1,024-byte torus in both axes: `$07E8`-`$07FF` (the sprite pointers)
appear in the picture. A playfield wider or taller than the screen needs
the rows and columns that scroll into view written as they arrive, which
the recipe does not do.

### Variations

**Bitmap.** The video counter also addresses bitmap data, so the same
writes place a bitmap (Bauer §3.14.6); not measured here. **Fewer rows
of range.** A smaller MMAX shortens the band and the black area above the
text, at the cost of vertical range. **Split screen.** The same writes
lower down move a part of the screen and leave a status area above.

### Cycle budget

The band holds the CPU for every line from 50 to the late badline, one
write per line at a fixed cycle, from a stable raster; in the recipe the
handler runs from line 46 to line 86-95, up to 50 raster lines a frame.
Not timed with a CIA.

The late write is the VSP write, with its crash on some machines
(`vsp_glitch`, "The VSP crash"): AGSP inherits the Safe VSP rules.

### Recipes

- `recipes/kickassembler/agsp.md` — the text screen on two sines, x 0 to
  319 and y 0 to 135, PAL and NTSC, every line of the picture checked,
  with the sweeps of N, M, YS and XS.

### Sources

- Codebase64, "Any Given Screen Positioning (AGSP) VSP with a line
  crunch": https://codebase64.c64.org/doku.php?id=base:agsp_any_given_screen_position

---

## kefrens_bars — Kefrens bars: one pixel line re-shown on every raster line

**Complexity:** high
**Region:** both

**Uses registers:** SCROLY, RASTER
**Demands:** cpu_every_line, midframe_raster_irqs
**Requires:** badline_synchronization
**Raster band:** 44-214 (the kefrens-bars recipe's IRQ line is 44; its handler acknowledges on line 209 to 214, measured)
**Cost:** cycles_per_line=63, lines_active=129, irq_slots=1
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-kefrens-bars (128 blocks timed by CIA2: 8,062 cycles PAL, 8,318 NTSC)
**Claims:** vic_raster_irq (owns), vic_yscroll (owns)
**Claims basis:** measured-vice

A `scripts/claims-watch.ts` store trace of
`recipes/kickassembler/kefrens-bars.md` saw `$D011` written on every
line of the band with YSCROLL = the next line's `& 7`, and the raster
compare set once. The recipe's `$0314` vector, CIA2 timer and zero-page
bytes are its own choices.

### Why

A Kefrens bar screen shows one horizontal line of graphics repeated down a
band, with a bar stamped into that line once per raster line and never
erased inside the band, so each line shows every bar drawn above it and
the bars trail downward. The C64 has no register that repeats a line.
Redrawing the band as a bitmap each frame costs far more than the 20
cycles a line the effect uses.

### How

Make every line of the band a badline. On line L, after its badline
stall, write YSCROLL = `(L + 1) & 7` into `$D011`, so line L + 1 is a
badline from its first cycle. The VIC then resets its row counter to 0 on
every line and never advances to the next text row: every line of the
band shows pixel row 0 of the same text row. Fill that row with 40
different characters, 0 to 39, and pixel row 0 of those characters, the
bytes at charset + 8c, is a 40-byte line buffer the CPU can write. In the
20 cycles between two stalls on PAL (22 on NTSC) the CPU writes the next
YSCROLL and stores one bar byte into the buffer at the line's column,
taken from a sine table. The next line shows it, and every line after.

One unrolled block per line, exactly as long as the free cycles: `stx
$d011`, `ldy pos + k`, `sta buffer,y`, `ldx #next`, and 5 cycles of
padding on PAL, 7 on NTSC. The badline stall holds the CPU at the same
place every line, so the block needs no stable raster; the entry only has
to reach the stall of the first band line before its first write. Clear
the buffer once per frame, before the band.

### Why it works

Bauer's rules (§3.7.2): RC is reset to 0 in cycle 14 when the badline
condition holds; VCBASE takes the video counter only in cycle 58 of a
line with RC = 7. With a badline on every line RC is 0 at cycle 14 and 1
after cycle 58, never 7, so VCBASE stays at the band's first row. The
c-accesses re-read the same 40 screen codes each line and the g-accesses
read row 0 of each character, so a store to a buffer byte before that
column's g-access shows on that line. Measured in VICE x64sc 3.10, PAL
c64c and NTSC, with the buffer filled with one fixed byte
(`kefrens-bars` built `:proof=1`): all 129 lines from 51 to 179 showed
that byte in all 40 cells, and the character's rows 1 to 7 appeared only
on the seven lines after the band.

The block length is the whole design. Measured (the recipe's sweep): a
block one cycle shorter than the free cycles fits twice into some windows,
its second write removes the badline from the current line, and the band
breaks every 20 lines (PAL) or 22 (NTSC). A longer block drifts later
every line until its write meets the stall: landing on cycle 12 or 13 the
badline still starts but the first one or two cells get no c-access and
show black; on cycle 14 RC is no longer reset and the band is lost.

This corrects the plan in #16, which asked for a badline-free region: the
repeated line needs a badline on every line, and the cycle budget is the
20 or 22 cycles a badline leaves.

### Variations

**Bitmap line buffer.** In bitmap mode the g-access reads bitmap +
8·VC + RC, so with RC = 0 the buffer is again every eighth byte. Not
measured here.

**Pixel-positioned bars.** Two or three pre-shifted bytes per line put a
bar anywhere to the pixel; with the `$D011` write that exceeds 20 cycles
on PAL. Not measured here.

**Colour per column.** Colour RAM of the buffer row gives each column its
own colour for every line of the band; multicolour gives three colours
per byte. The recipe uses one multicolour bar byte.

### Cycle budget

The band takes the CPU for every line: 43 cycles of badline stall and 20
of block on PAL (22 of 65 on NTSC). Measured with CIA2 timer A around
the recipe's 128 blocks: 8,062 cycles on PAL and 8,318 on NTSC, which is
128 × 63 and 128 × 65 less the 2 cycles of the timer's own start and stop
stores, identical in every frame of an 8,000,000-cycle run. The Cost
line counts the 129 badlines the band shows; the recipe's handler also
spends lines 44 to 50 clearing the buffer and 180 to 214 rebuilding the
position table.

### Recipes

- `recipes/kickassembler/kefrens-bars.md` — a 129-line band of multicolour
  bars from two sine tables, PAL and NTSC, every band line checked against
  the tables, with the `:proof=1` test and the block-length sweep.

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
**Cost measured on:** kickassembler-sideborder-open (42 lines, eight sprites on the line)
**Claims:** sprite_0-7 (owns), vic_raster_irq (owns), vic_xscroll (shares), vic_yscroll (shares)
**Claims basis:** derived-listing

`DEC $D016` / `INC $D016` clears CSEL only when XSCROLL is 0, and passes
XSCROLL through 7 on the way. The badline-free region is made by
rewriting YSCROLL on every line. Both are writes inside the band that
must follow whatever scroll the rest of the frame uses, so `shares`. A
store trace of `recipes/kickassembler/sideborder-open.md`
(`scripts/claims-watch.ts`) saw both fields change on every line of the
band. The two items were added with the units ([#71](https://github.com/bdgscotland/c64-kb/issues/71)).

### Why

The VIC-II renders the side (left and right) borders as a solid color region flanking the active display area. In the default 40-column mode (CSEL=1 in $D016 bit 3), the visible left border spans from the left edge of the screen to approximately dot position 24, and the right border spans from dot position 344 to the right edge. Hardware sprites can be positioned anywhere horizontally, including in the border area, but they show there only if the border is suppressed. Otherwise sprite pixels in the border region are hidden by the border color.

Opening the side borders suppresses the border so that sprites appear on a background-color area instead of behind the border color. It is required for sprite multiplexing that uses all 8 sprites across the full width of the screen, for 24+ sprite systems that place sprites in the border to reach higher counts, and for any design that extends graphics to the display edges.

### How

One write per line. Change CSEL ($D016 bit 3) from 1 to 0 with the write
cycle landing on cycle 56 of the line (PAL): `DEC $D016` on a value of $C8,
started on cycle 51, writes $C7 on exactly that cycle. Restore CSEL=1 any time
before the next line's cycle 55; `INC $D016` straight after does. Every line
of the region gets the write, from a loop of exactly 63 cycles per line
entered through a stable raster (`double_irq`).

Two constraints on the region. No line in it may be a badline: the VIC holds
the bus from cycle 12 to 54, no read cycle is possible in between, and every
store's write follows a read, so the write cannot be placed on cycle 56.
Either idle the character display inside the region by rewriting YSCROLL
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

Border-opening IRQ overhead plus a sprite multiplex update on the same line can exceed the line's cycle budget on badlines. The usual fix is to move the sprite Y coordinate update to the preceding line.

### Recipes

- `recipes/kickassembler/sideborder-open.md`

---

## dysp_side_border_sprites — DYSP: sprites at different Y in the opened side border

**Complexity:** high
**Region:** both
**Uses registers:** SCROLX, D011, D012, D000, D001, D010, D015, DC04, DC05, DC0E
**Uses kernal:** (none)
**Demands:** cpu_every_line, badline_free_region, midframe_raster_irqs
**Requires:** sideborder_open, stable_raster_irq, pal_ntsc_detection
**Raster band:** 40-200
**Cost:** cycles_per_line=63, lines_active=161, cycles_per_frame=13713, cycles_per_frame_typical=13703, irq_slots=3, sprites_per_line=3
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-dysp (the 161-line band at 63 wall cycles a line, every `DEC $D016` traced on cycle 56, plus the CIA-timed table rebuild: 3,570 worst and 3,560 in 254 of 357 frames; the design's largest sprite set on one line is three)
**Claims:** sprite_0-3 (owns), vic_raster_irq (owns), vic_xscroll (shares), vic_yscroll (shares)
**Claims basis:** derived-listing

The two `shares` items are `sideborder_open`'s, for the same reasons; a
store trace of `recipes/kickassembler/dysp.md` saw both fields change on
every line of the band ([#71](https://github.com/bdgscotland/c64-kb/issues/71)).

### Why

`sideborder_open` demands a constant sprite set: every sprite in the
region must be on every line of it, which is why its recipe stacks all
eight at one Y. A scroller or a logo that bobs in the side border wants
the opposite, sprites at different heights that move, and on any line
the set of sprites the VIC fetches then changes with the frame. DYSP
(different Y sprite positions) keeps the border open anyway. It is a demo
staple and the usual reason for opening the side border.

### How

The write is `sideborder_open`'s: `DEC $D016` on a value of $C8 started
on cycle 51, new value on cycle 56 (PAL), `INC $D016` afterwards, one
line at a time from a `double_irq` entry. What changes is the padding
between one `DEC` and the next. The recipe keeps a per-line table,
rebuilt every frame from the sprites' Y positions, of which sprites the
VIC fetches after that line's write (sprite s on lines Y to Y + 20), and
a sixteen-entry conversion from that set to the cycles the line must
leave unspent: a slide of six `NOP`s entered part way, plus a taken
branch for an odd cycle. Code cycles per line are 51 plus that padding,
and padding plus stall is 12 on every line, so every iteration is 63
wall cycles and the next `DEC` starts on 51 again. Between the `DEC` and
cycle 3 of the next line the loop does nothing but read, because a write
inside the stall window would go through during BA low and change the
count. YSCROLL is rewritten on every line so no line of the band is a
badline, as in the sideborder recipe. The table rebuild runs below the
band and costs 3,560 cycles a frame for four sprites over 161 lines.

The stable entry's lines must carry no sprite DMA, or the sync is
stalled by an amount that changes with the frame: the band starts at
the lowest Y any sprite reaches, so the interrupt sits above it.

### Why it works

`hardware/vic-ii-reference.md`, Sprite DMA, states the p-access slots as
cycles 58, 60, 62, 1, 3, 5, 7, 9 for sprites 0 to 7 on PAL, that BA falls
three cycles before the first fetch, that the CPU completes up to three
write cycles after BA falls, and that with sprites 0..k active the CPU
resumes two cycles after sprite k's slot. From that, for a line whose
first fetched sprite is f and last is l: with sprite 0 in the set BA
falls on 55, the `DEC`'s writes on 55 and 56 go through, and the CPU
loses 3 + 2l cycles; without sprite 0 BA falls on 55 + 2f, after the
write, and the loss is 5 + 2(l - f); with no sprite, nothing. A line
with sprite 1 alone therefore costs five cycles and a line with sprite 0
alone three, and no per-sprite constant covers both. The recipe measured
that: a table of two cycles per sprite holds the border open on every
line whose set contains sprite 0 and loses it on the first line that does
not, three or four cycles per sprite lose it on the first sprite line,
and the set-indexed table holds it on all 150 lines of the display band
with all four sprites showing. The stall lengths themselves are inferred
from the border and the VIC page's statements, not timed per line.

### Cycle budget

PAL: 63 cycles on every line of the band, all of them; NTSC 65, with the
`DEC` one cycle later and sprite 0's lead-in starting one cycle after the
write, so a set with sprite 0 costs 4 + 2l there. The band is 161 lines
here, 10,143 cycles a frame (arithmetic), plus the rebuild, 3,570 worst
and 3,560 typical (CIA, both models), plus the two raster interrupts'
entries. Lines 40 to 50 of the band lie in the upper border, where the
write does nothing: the visible open band is 51 to 200.

### Variations

**All eight sprites.** The tables become eight bits wide and the largest
stall 19 cycles (the VIC page's measured figure), more than the six-`NOP`
slide can give back on a sprite-free line unless the loop's other work
moves out of it. Not built.

**Multiplexing in the border.** `sprite_multiplex_8` re-arms Y and
pointers between bands; inside a DYSP band those writes must fall
outside the stall window, and the set table must be rebuilt from the
multiplexer's per-frame plan rather than from eight fixed Y values. Not
built.

**DYSP with DYCP.** `dycp_scroller` moves characters on sines in the
display while this moves sprites on sines in the border; the badline-free
band forbids the character display here, so a combined effect needs the
DYCP rows above or below the band. Not built.

### Pitfalls

- `badline_cycle_loss` (`pitfalls/raster-and-badline.md`): a badline
  inside the band moves the write off cycle 56; the recipe rewrites
  YSCROLL on every line so none occurs.
- `vic_bus_takeover_on_dma` (`pitfalls/raster-and-badline.md`): the
  stall this entry is built around; the per-set table is the account of
  it.
- `raster_irq_first_line_jitter` (`pitfalls/raster-and-badline.md`):
  the entry is a double IRQ, and its sync lines must also be free of
  sprite DMA.
- `idle_fetch_byte_shows_in_gaps` (`pitfalls/raster-and-badline.md`):
  the band is badline-free and idle, so `$3FFF` is what the display
  shows across it.
- `sprite_x_range_hidden_and_seam` (`pitfalls/sprite.md`): the sprites
  stand at X 344, wholly under the right border by that entry's
  mechanism, and are visible only because the border is open; their
  top rows are under the upper border whenever Y falls below 50.
- `sprite_x_high_bit_wrong_register` (`pitfalls/sprite.md`): X 344
  needs bit 8, so all four bits of `$D010` are set.

### Sources

- `recipes/kickassembler/dysp.md`: the sweep, the write-cycle traces,
  the table dump and the CIA figures.
- `hardware/vic-ii-reference.md`, Sprite DMA: the slots, BA and the
  resume cycles quoted above.
- `sideborder_open` above and `recipes/kickassembler/sideborder-open.md`
  for the write and the badline-free band.

### Recipes

- `recipes/kickassembler/dysp.md` (four ring sprites at X 344 on
  independent sines about Y 60, 90, 120 and 150; band 40 to 200; the
  set-indexed table against a count table and a fixed delay; PAL and
  NTSC pinned at frame 300)

---

## topbottom_border_open — Open the top/bottom border

**Complexity:** high
**Region:** both
**Uses registers:** SCROLY
**Demands:** midframe_raster_irqs
**Cost:** cycles_per_frame=371, lines_active=2, irq_slots=2
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-topbottom-border-open (two handlers with the $EA31 exit, no key held; NTSC, 353 on PAL)
**Claims:** vic_raster_irq (owns)
**Claims basis:** derived-listing

### Why

The VIC-II's top and bottom borders are solid-color regions above and below the active display rows. In 25-row mode (RSEL=1, $D011 bit 3 set), the display area spans raster lines 51-250 and the borders fill lines 16-50 (top) and 251-299 (bottom) on PAL. In 24-row mode (RSEL=0), the display area shrinks to lines 55-246 and the borders expand correspondingly.

Opening the top and bottom borders lets the whole frame, minus only the vertical blank, show sprites and the idle-state graphics byte (`$3FFF`, which can be changed per line) instead of border colour. The character or bitmap display itself does not grow (there are no badlines outside lines 48–247, so no new rows are fetched), but sprites and background colour reach every drawable line. Measured in VICE x64sc 3.10, every row of the emulator's viewport is drawable with the borders open: 272 lines on PAL and 247 on NTSC, against the display window's 200 (an earlier version of this paragraph gave "roughly 240 on PAL, approximately 192 on NTSC"). Uses: overscan demos, raster bars that extend into the borders, sprites above and below the usual display area.

Hardware sprites can be positioned at any Y value 0-255 and will render wherever they land. Opening the top/bottom border does not add sprite rendering: sprites already render in the border area when their Y position places them there. Opening suppresses the border color so that the background color shows through, making any sprites or bitmap data in that region visible.

### How

One mechanism, two writes per frame, both at the bottom of the display:

- Clear RSEL ($D011 bit 3) on a line from 248 to 250 (after the raster has passed line 247 and before it reaches line 251) with a read-modify-write that keeps YSCROLL, DEN and the mode bits and masks off bit 7 (which reads back as the raster's ninth bit, not the compare value).
- Set RSEL again anywhere from line 252 to line 246 of the next frame, so that the next frame's line 247 is not a bottom comparison either.

The bottom border of this frame and the top border of the next frame both open, because the vertical border flip-flop is never set. Nothing is written near line 51 or 55, and plain raster IRQs through $0314 are precise enough: the target is a line, not a cycle.

An earlier version of this section described a separate top-border write (RSEL=0 on line 55, "symmetric" with the bottom) and a top-only variant. The vertical border flip-flop has no top-side set, so the top opens as a consequence of suppressing the bottom set. Measured in VICE x64sc 3.10: the line-55 write on its own leaves both borders closed and moves the bottom border up to line 247, while the two bottom-side writes on their own open both borders.

### Why it works

The VIC-II's vertical border flip-flop (Bauer §3.9) is **set** only when the raster reaches the bottom comparison line (251 with RSEL=1, 247 with RSEL=0), checked in cycle 63 of the line and again when the beam reaches the left comparison X; it is **reset** only when the raster reaches the top comparison line (51 with RSEL=1, 55 with RSEL=0), at the same two moments, and only while DEN is set. Comparisons match on equality, never over a range, and no frame-start event touches the flip-flop. While it is set, the main border flip-flop cannot be reset at the left edge and the graphics sequencer outputs background colour, so the border is drawn; while it is clear, whatever the sequencer and the sprites produce is shown.

RSEL=1 while line 247 passes means both of that line's checks look for 251; RSEL=0 while line 251 passes means both of its checks look for 247. Neither matches, the flip-flop stays clear, and there is no other set event until the next frame's bottom comparison. The vertical blank and lines 0–50 go by with the flip-flop clear, so the top border is not drawn either. At line 51 the top comparison resets a flip-flop that is already clear. Restoring RSEL=1 before the next line 247 keeps the cycle going frame after frame.

The window for the clearing write is smaller than "before line 251 ends": the left-edge check on line 251 comes at X=24, about cycle 16, before a raster IRQ handler through $0314 has been entered (cycle 39–45, measured; 37–43 before #85). Measured in VICE x64sc 3.10: a clear on line 247 closes the border from line 248 (the cycle-63 check on 247 saw RSEL=0), clears on 248, 249 and 250 open it, and clears on 251 and 252 leave an ordinary frame with the border from line 251.

The side borders are not affected; RSEL only governs the vertical comparison lines. In the opened area the VIC is in its idle state and shows the byte at `$3FFF` in colour 0 over the background colour, so `$3FFF` should be zero. VICE's RAM starts so; hardware RAM is not guaranteed to. Sprites are visible there because the border is no longer drawn over them, not because they render anywhere new.

### Variations

**Bottom only, top only.** Neither exists with RSEL alone: the flip-flop has one set (a bottom comparison) and one reset (a top comparison), and once the bottom set has been suppressed nothing can set it again before the next frame's line 247, so the two borders open as a pair. An earlier version of this section listed both as variations; the recipe below writes nothing near line 51 and the top opens anyway. A demo that shows one of them closed is painting it back (`$D021` set to the border colour over those lines from another raster interrupt), not closing it.

**Full vertical open with sprite coverage.** Open both borders and position 8 sprites to tile vertically across the entire frame (possible because sprites at Y positions above the visible area wrap around in the sprite's own 0-255 coordinate space). With sprite multiplexing this covers nearly the full frame height.

**RSEL held at 0 for the full frame.** Opens nothing: both comparison lines simply move (top 55, bottom 247) and the border is drawn four lines further in at top and bottom. An earlier version of this paragraph said it "permanently opens both borders"; the control build with RSEL=0 from line 55 to line 0 shows a closed frame whose bottom border begins on line 247 (VICE x64sc 3.10). It is also the side effect of a raster split that leaves RSEL clear when line 247 arrives.

### Cycle budget

Coarse: the writes need a line, not a cycle. A raster IRQ on any of lines 248–250 clears RSEL in time with the KERNAL dispatcher's latency included; 247 is too early and 251 too late for a write that lands after cycle 39 (see Why it works; this said 37 before #85). RSEL is part of $D011 with YSCROLL (bits 2–0), DEN (bit 4), BMM and ECM (bits 5 and 6) and RST8 (bit 7), so the toggle is a read-modify-write (`LDA $D011`, `AND` or `ORA` immediate, `STA $D011`: 4 + 2 + 4 = 10 cycles) with bit 7 masked off. With the interrupt bookkeeping ($D012, $0314/$0315, the $D019 acknowledge and the exit) each handler body is about 40 cycles plus the 29-cycle dispatcher, twice per frame, except that the restore handler exits through `$EA31`, the full KERNAL service, which costs about 190 cycles once per frame while no key is held and about 1,600 while one is (measured in VICE x64sc for `recipes/kickassembler/raster-bars.md`; an earlier version of this sentence said "about a thousand", a figure nobody had measured); the opening handler exits through `$EA81`. Traced in the recipe in VICE x64sc 3.10, from the interrupt's acceptance to the end of `RTI`: the opening handler 95 cycles, the restore handler with `$EA31` 258 on PAL and 276 on NTSC, 353 and 371 a frame with no key held. The Cost line states the NTSC 371; it said 132 before, the two handler bodies without the `$EA31` exit. With a key held, add about 1,400 (the raster-bars figures above, about 1,600 against 190; not measured on this recipe, because a headless run holds no key). An earlier version of this paragraph said the write "just needs to land before the end of line 248" and gave the RMW as "3 cycles"; both are replaced by the measured window and the cycle count above.

### Recipes

- `recipes/kickassembler/topbottom-border-open.md`

---

## sprites_only_screen_mode — Sprites-only screen: no badlines, no vertical border

**Complexity:** medium
**Region:** both
**Uses registers:** SCROLY, RASTER
**Demands:** midframe_raster_irqs, badline_free_region
**Requires:** topbottom_border_open
**Raster band:** 40-256 (interrupts on lines 40, 50, 53, 249 and 253; the line-253 handler with the meter latch, 178 cycles, exits about three lines later; the mode itself covers the whole frame)
**Cost:** cycles_per_frame=756, lines_active=5, irq_slots=5, sprites_per_line=2
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-sprites-only-screen (five handlers through $0314 with the KERNAL dispatcher, the recipe's meter latch included; 755 on NTSC)
**Claims:** vic_raster_irq (owns)
**Claims basis:** derived-listing

### Why

A frame whose only content is sprites has no use for the character display, and the character display is what costs: twenty-five badlines a frame, 40 to 43 cycles each, and a border that hides any sprite outside lines 51 to 250. Switching the display off for the whole frame removes every badline, and opening the top and bottom border as `topbottom_border_open` does lets sprites stand on any of the drawable lines, 272 on PAL and 247 on NTSC in VICE's picture. The CPU keeps every cycle except sprite DMA and the interrupts that run the mode. Measured in VICE x64sc 3.10 with eight sprites on screen: 18,080 cycles a frame free on PAL against 16,940 for the ordinary text screen with the same sprites, 15,520 against 14,460 on NTSC.

It suits a sprite multiplexer with nothing behind it, a sprite-built logo or scroller, a vector-ball display, or any effect that wants the screen as a black backdrop and the CPU to itself.

### How

Five writes to `$D011` per frame from plain raster interrupts through `$0314`, the same handler shape as `topbottom_border_open` with three writes added at the top of the frame. `$D020` and `$D021` are the same colour, black, and `$3FFF`, the idle graphics byte, is zero.

| line | `$D011` | what it does |
|---|---|---|
| 40 | `$0B` | DEN clear before line 48: the badline condition fails for the whole frame |
| 50 | `$1B` | DEN set before line 51: the vertical border flip-flop is reset there |
| 53 | `$0B` | DEN clear again; nothing sets the flip-flop until a bottom comparison |
| 249 | `$03` | RSEL clear after line 247 and before line 251: 251 is not a match |
| 253 | `$0B` | RSEL set again so the next frame's line 247 is not a match either |

DEN has to be clear across the whole of line 48, because a write setting it on any cycle of that line enables the frame's badlines. DEN has to be set while line 51 passes, because the flip-flop's reset is the only thing that opens the display, and it happens only then and only with DEN set. Once reset, the flip-flop is set again only by a bottom comparison, so DEN can go back to clear on line 53 and stay clear; leaving DEN clear throughout instead, with no write at line 50, leaves the flip-flop set from the first frame's line 251 and the whole picture is border colour with the sprites under it (the recipe's `NOBORDER` control: zero sprite pixels on both models). The bottom is handled as on `topbottom_border_open`: RSEL cleared in the measured window, lines 248 to 250, and restored after 251.

The writes are whole values, not read-modify-write, because each one sets DEN and RSEL together with a fixed YSCROLL; the table is also what a control build swaps. Bit 7 goes out as zero in every write, correct for compare lines below 256 (`d012_wrap_around`).

### Why it works

Badlines: `hardware/vic-ii-reference.md` states that "DEN must be set at some point during raster line $30 (decimal 48) for badlines to be enabled for the frame" and that "holding DEN clear for the whole of line $30 removes every badline of that frame" (Bauer §3.5). With no badline the VIC never leaves its idle state: no video matrix fetch, no character pointers, no graphics data, and nothing taken from the CPU on lines 51 to 250. The recipe measures this from inside the CPU with a CIA timer in the handler: the line-50 handler, which runs into line 51, costs 105 cycles under the ordinary screen and 62 in this mode, the 43-cycle badline stall gone.

The border: the same page states that "the vertical border flip-flop is reset only if DEN is set at cycle 63 of the top comparison line (51 with RSEL = 1, 55 with RSEL = 0), so with DEN clear across that line the border colour ($D020) covers the whole screen, sprites hidden under it". The flip-flop is set only at a bottom comparison, 251 with RSEL set or 247 with it clear, checked at cycle 63 and at the left edge (Bauer §3.9, and the measured table on `topbottom_border_open`). With DEN set for line 51 the reset happens; with RSEL set while 247 passes and clear while 251 passes neither bottom check matches; and DEN being clear again from line 53 does not matter, because no rule that sets the flip-flop reads DEN. The rest is measured: two colours in the picture, black and white, and the sprites at Y 8 and Y 252 drawn on both models.

The idle sequencer draws the byte at `$3FFF` in colour 0 over the background wherever it has no row to show, which in this mode is everywhere (Bauer §3.7.3.9; `idle_fetch_byte_shows_in_gaps`). With the byte zero it draws background, and with background and border the same colour the only thing that distinguishes an open frame from a closed one is whether the sprites show. Sprite fetch and display do not depend on DEN or on the flip-flop.

### Cycle budget

From the recipe's free-CPU meter, a fixed twenty-cycle loop whose iterations per frame are counted (VICE x64sc 3.10; one iteration, 20 cycles, is the resolution):

| build | PAL free cycles | NTSC free cycles |
|---|---|---|
| this mode, eight sprites | 18,080 | 15,520 |
| ordinary text screen, same sprites | 16,940 | 14,460 |
| this mode, sprites off | 18,900 | 16,340 |
| ordinary screen, sprites off | 17,820 | 15,260 |

By subtraction (arithmetic on those measurements): the badlines cost 1,140 cycles on PAL and 1,060 on NTSC with the sprites on, 1,080 on both without; the eight sprites' DMA costs 820 on both models in this mode; and the five interrupts through the KERNAL dispatcher, with the meter's own latch, cost 756 on PAL and 755 on NTSC out of the 19,656 and 17,095 cycle frames. Each handler body measures 58 cycles from timer start to timer read when no sprite stalls it, 62 or 63 when one does.

An interrupt every frame at line 253 is also a free frame tick; the recipe counts frames there.

### Variations

**Side border too.** `sideborder_open` on top of this mode gives the whole picture to sprites. Its region condition is met for free: no line in this mode is a badline, so the cycle-56 `$D016` write can land on every line of the region, and the constant sprite set it needs is a matter of placement.

**A multiplexer in this mode.** `sprite_multiplex_8` gains 272 lines of drawable height on PAL instead of 200, and the raster interrupts it re-arms sprites from share the frame with these five; the two table-driven chains merge into one. The mode does not change the eight-per-line limit or the DMA cost per sprite line.

**Something behind the sprites.** `$3FFF` can be rewritten per line for a one-byte pattern in colour 0, as `topbottom_border_open` notes; the character display cannot be brought back for part of the frame without a badline, and a badline needs DEN set on line 48, which brings back all of them.

### Pitfalls

- `d012_wrap_around` (`pitfalls/raster-and-badline.md`): every write here puts a zero in bit 7; a slot moved above line 255 needs the bit set and the compare written as line and $FF.
- `idle_fetch_byte_shows_in_gaps` (`pitfalls/raster-and-badline.md`): the whole frame is the gap in this mode; a non-zero `$3FFF` puts a stripe pattern across all of it.
- `vic_bus_takeover_on_dma` (`pitfalls/raster-and-badline.md`): sprite DMA is the one stall left, 820 cycles a frame for the recipe's eight sprites.
- `badline_cycle_loss` (`pitfalls/raster-and-badline.md`) is what the mode removes; a DEN write that reaches line 48 set brings every badline back for that frame.
- `sprite_x_high_bit_wrong_register` (`pitfalls/sprite.md`): the recipe's first build had a sprite at X 256 with `$D010` clear and it stood under the left side border.

### Recipes

- `recipes/kickassembler/sprites-only-screen.md`

### Sources

- Christian Bauer, *The MOS 6567/6569 video controller (VIC-II) and its application in the Commodore 64*, 1996: §3.5 (badline condition), §3.9 (border flip-flops), §3.7.3.9 (idle state).
- `hardware/vic-ii-reference.md`, the `$D011` section (DEN on line `$30`; the reset needs DEN at cycle 63 of the top comparison line), measured in VICE.
- `recipes/kickassembler/sprites-only-screen.md`: every cycle, row and colour figure above.

---

## raster_split_modes — Mid-frame display mode change

**Complexity:** medium
**Region:** both
**Uses registers:** SCROLY, SCROLX, VMCSB
**Demands:** midframe_raster_irqs
**Claims:** vic_raster_irq (owns)
**Claims basis:** estimated

### Why

The VIC-II supports four display modes: standard character mode (text), multicolor character mode, standard bitmap mode, and multicolor bitmap mode. (Extended Background Color mode is a fifth; it is exclusive with multicolor and bitmap (ECM+MCM and ECM+BMM are the black "invalid" modes) and restricts the character set to 64 glyphs, since character code bits 7–6 select one of four background colours. Sprites, single- or multicolour, are unaffected: measured in VICE x64sc, a sprite renders identically with ECM set and clear. An earlier version of this sentence said ECM was "effectively mutually exclusive with sprites"; it is not.) Each mode is selected by the combination of $D011 bit 5 (BMM, bitmap mode), $D011 bit 6 (ECM, extended background color), and $D016 bit 4 (MCM, multicolor mode).

Changing these mode bits mid-frame via a raster IRQ switches the display from one mode to another at the target scanline. One of the most common C64 screen layouts depends on it: a full-resolution or multicolor bitmap for the game or demo canvas, with a character-mode status bar at the top or bottom of the screen. A system with one display mode per frame cannot show this layout.

The technique also underlies FLI (Flexible Line Interpretation) and IFLI effects, where mode bits and memory pointers are changed on every line to get past the VIC-II's 8-pixel-tall color attribute resolution. FLI is a separate technique (not covered here); its per-line mode change is raster_split_modes at the limit of 1 IRQ per line.

### How

The mode change sequence in a raster IRQ handler:

1. Write $D011 to set or clear BMM and/or ECM for the new mode.
2. Write $D016 to set or clear MCM for the new mode.
3. Write $D018 to point to the video matrix and character/bitmap base for the new mode's data.

Make all three writes as close together and as close to the start of the target line as possible, to avoid partial-line glitches. Writing $D011 a cycle late while $D016 has already been written produces an undefined intermediate mode for one cycle, which can show as pixel garbage on the first character position of the split line.

The mode change can happen anywhere in the frame: top to bottom, multiple splits, alternating modes, or per-line cycling. The only constraint is cycle budget per line.

### Why it works

The VIC-II decides how to decode pixel data (and whether to fetch character ROM/RAM or bitmap data) on a per-character-cell basis within each row. The mode registers ($D011 bits 5-6, $D016 bit 4) are read by the chip as it generates each 8-pixel horizontal span. A write to these registers takes effect at the next 8-pixel cycle boundary on screen, not at a character cell boundary. Measured in VICE x64sc for the ECM bit: toggling it in a loop over blank cells put every colour change at the same pixel phase with XSCROLL 0 and 3, while a marker cell moved 3 pixels; so with XSCROLL non-zero the change lands inside a cell. MCM and BMM were not measured. (An earlier version said the write takes effect on the current or next character cell boundary.)

The display mode and the data pointer ($D018) govern three separate things: how pixel bits are interpreted (character vs bitmap), whether two bits per pixel (multicolor) or one bit per pixel (hires) is used, and where in the VIC bank the data lives. Changing $D018 mid-frame is not batched to the next frame. The character or bitmap base (bits 3-1) is read on every g-access, so it changes the source from the line the write lands on; the video-matrix bits (7-4) show from the next character row (both measured in VICE, see the timing paragraph below). Whether a mid-line write switches exactly at the next character cell is not measured here. (An earlier version said the whole of $D018 took effect from the next character cell.) This allows per-row (or per-line) memory pointer changes without a frame boundary.

The YSCROLL field ($D011 bits 2-0) interacts with mode changes: if YSCROLL changes simultaneously with the mode bits, the VIC may trigger a spurious badline (if the new YSCROLL value matches the current `(raster & 7)` condition). To avoid this, keep YSCROLL constant across mode splits, or change it in a separate write on a line where a badline is acceptable.

### Variations

**Bitmap canvas with text status bar.** The most common use: bitmap mode for lines 50-200, character mode for lines 201-250 (or vice versa). $D018 points to bitmap data in the upper half of the frame and character data in the lower half. One raster IRQ handles the switch; another switches back at the top of the next frame.

**Multiple mode zones.** Three or more display mode regions in a single frame. Each transition requires one raster IRQ. With 16 IRQ slots in Oscar64's rasterirq system, up to 16 transitions per frame are possible.

**Per-line FLI preparation.** Set up mode bits and $D018 on every line to get past the attribute color resolution. Full FLI requires writing $D018 and possibly $D011 YSCROLL on every line within the FLI zone. It is a separate technique with the same mode-change mechanism.

**Multicolor-to-hires split.** Switch from multicolor character mode to hires character mode mid-frame. Used for effects where the upper portion of the screen uses 4-color characters and the lower uses high-resolution black-and-white data.

### Cycle budget

Each raster split costs: 3 writes ($D011, $D016, $D018) × 4 cycles = 12 cycles minimum. With IRQ overhead (a first write on about cycle 16-24 with the KERNAL out and $FFFE pointing at the handler, 45-53 through $0314, where the handler is entered on cycle 39-45, measured) a mode split uses about 25-35 or 55-65 cycles on the split line respectively. An earlier version gave only 13-20 without naming the entry path; before #85 the overhead read 13-20 and 42-50 cycles with entry on cycle 37-43, arithmetic.

On a badline, a mode-split IRQ has only 20 usable cycles on PAL (cycles 1-11 and 55-63; 12-14 for writes only). A 12-cycle triple write fits, with little room for the IRQ overhead. The usual fix is to put the mode split on a non-badline.

YSCROLL manipulation during a mode split requires a fourth write to $D011. Since $D011 carries both YSCROLL and mode bits, the YSCROLL write and the mode-bit write must be combined into one read-modify-write, costing 10 cycles instead of 4 for two separate stores. If the mode bits and YSCROLL value are known in advance, a precomputed combined value can be stored directly in 4 cycles.

The $D018 write is the most timing-sensitive of the three, and its two halves behave differently. The character/bitmap base (CB bits 3-1) is read on every g-access, so a mid-row write changes the glyph or bitmap source from the line the write lands on. Measured in VICE x64sc: a CB switch on line 100 redrew lines 100-106 of that row from the new set, and a CB switch on line 98 redrew line 98, the last line of the previous row. A CB-only split therefore takes effect where it lands, and the advice to fire the IRQ "on the line before the first badline" tears that previous row's last line unless the store completes after the last g-access (cycle 55 on PAL) of that line; land the write in cycles 56-63 of the previous line or before cycle 16 of the zone's first line. The video-matrix pointer (VM bits 7-4) is consumed by the badline's c-accesses (cycles 15-54), whose 40 codes are held in the row buffer, so a VM change shows on the next character row. Measured: a VM switch on line 100 left row 6 unchanged and row 7 drawn from the new matrix. The same VM bits also address the sprite pointers at VM+$3F8, which the p-accesses read on every line, so a VM move shifts sprite pointer reads at once. Put a split that moves the video matrix anywhere in the 8 lines before the zone's first badline, before cycle 15 of that badline. An earlier version of this paragraph said the whole of $D018 was latched once per row at the badline fetch, so a late write was ignored for eight lines; that is true only of the VM half.

### Recipes

- `recipes/kickassembler/raster-split-modes.md`: hires bitmap on rows 0-11, text on rows 12-24, switched between lines 146 and 147 by one `$D018` store on line 145 and one `$D011` store, with the store cycles that tear and the ones that do not, measured on PAL and NTSC.

---

## pal_ntsc_detection — Detect PAL vs NTSC at boot

**Complexity:** low
**Region:** both
**Uses registers:** D011, D012
**Cost:** cycles_per_frame=23032, bytes_code=339
**Cost basis:** measured-vice
**Cost bytes basis:** derived-listing
**Cost measured on:** oscar64-pal-ntsc-detect (one call at boot, SEI to CLI, the worst of 56 entry points, PAL; NTSC 17,514; screen on; whole PRG: the 341-byte file less its load address, built with Oscar64 here)
**Claims:** none
**Claims basis:** measured-vice

Store trace of `recipes/oscar64/pal-ntsc-detect.md` (`scripts/claims-watch.ts`,
PAL): the measurement reads `$D011` and `$D012` and stores to no
HardwareUnit; the recipe's other stores are screen, colour RAM and the
border colour.

The cycle figure is one call of the recipe's `last_raster_line`, from its `SEI` to its `CLI`, timed by a VICE monitor exec trace (x64sc 3.10). VICE's random autostart delay was left on so that each run entered the routine on a different line: 150 runs per model gave 56 distinct durations on PAL, 3,904 to 23,032 cycles, and 50 on NTSC (`-model ntsc`), 1,263 to 17,514. The worst entry, line 256, was not among them; by arithmetic it takes 23,184 cycles on PAL and 17,550 on the 6567R8 ("Why it works"). Either way one call can take more than a PAL frame, so it belongs before the frame loop. A first sweep timed to the `RTS` instead and got up to 23,291 on PAL and 17,731 on NTSC, above the arithmetic bound: the KERNAL interrupt that became pending during the wait runs between `CLI` and `RTS`, and that time is the KERNAL's, not the routine's. Until #96 the Cost line carried no cycle figure, and the durations under "Why it works" (3,575 to 23,172 cycles on PAL) were measured on the hardware page's KickAssembler listing, which is no recipe. An earlier graph gave this card the fire effect's frame cost (27,301 cycles, measured on kickassembler-fire-effect); ingest now warns when a Cost line names a recipe that does not realise its technique.

### Why

A C64 does not know which video standard it was built for, and neither does the program it is running: no register says PAL or NTSC. Almost everything timed by the frame or by the CPU clock differs between the two: 312 raster lines a frame against 263 (6567R8) or 262 (6567R56A), 63 cycles a line against 65 or 64, 985,248 Hz against 1,022,727 Hz (settled figures; `hardware/pal-ntsc-reference.md` has the tables). Music ticked once a frame runs a fifth too fast on NTSC, a CIA reload drifts 3.8 %, a raster interrupt set for line 280 never fires on a chip whose frame ends at 262; `pitfalls/region-timing.md` covers all three. The fix in each case is to find out once, at boot, which chip this is, store the answer in a byte, and branch on it. This technique is that measurement.

### How

The VIC-II's raster counter is nine bits wide: `$D012` holds the low eight and bit 7 of `$D011` (RST8) is the ninth. RST8 is therefore set for exactly the raster lines from 256 upward, and the frames of the three chips differ only in how many of those lines they have: 56 on PAL (256–311), 7 on the 6567R8 (256–262), 6 on the 6567R56A (256–261). The routine reads the length of that band:

1. Disable interrupts (`SEI`). A handler that ran for longer than a raster line would hide a line from the loop.
2. Wait until RST8 is clear. This is not for calls that land in the middle of the band: the lines such a call skips are the smaller values, and a loop that keeps the latest one is indifferent to them (measured: the loop with this wait deleted, entered on PAL lines 256 and 300, still returned `$37`). It closes a race at the far end of the band. A call landing in the last cycles of the frame's final line takes its first `$D012` sample on that line and its RST8 check on line 0, so step 5 is reached before any value has been kept and the result is whatever the register held before the call (measured: the same wait-less loop entered on PAL line 311 with its result register preloaded to `$EE`, and the entry phase swept in 4-cycle steps, returned `$EE` at two of sixteen phases and `$37` at the other fourteen; with the wait restored, both racing phases returned `$37`). Waiting for RST8 to be clear first means step 3 can only exit at line 256, never at line 311. This page gave the mid-band reason until 2026-09-22; it was wrong.
3. Wait until RST8 is set. That is line 256 on every chip, and `$D012` reads `$00` there.
4. While RST8 stays set, read `$D012` and keep the value (the most recent one, or the highest); inside the band they are the same. Read `$D012` first and RST8 second, and keep the sample only if RST8 was still set after it, so a read that has already wrapped to `$00` on line 0 is never recorded. The Oscar64 recipe tests RST8 at the top of its loop instead, because that is where the compiler puts a `while` condition, and keeps the highest value, which makes the wrapped `$00` harmless without the ordering; the two forms agree.
5. When RST8 clears, the kept value is the low byte of the last line of the frame: `$37` on the 6569, `$06` on the 6567R8, `$05` on the 6567R56A. Store it, or reduce it to one flag, and re-enable interrupts. Anything that became pending during the wait (the KERNAL's 60 Hz timer interrupt, if its vector is still installed) is serviced the moment interrupts are back on, so call the routine before the KERNAL interrupt is replaced, or expect one KERNAL service to run right after it returns.

For a two-way PAL/NTSC answer a shortcut suffices: any `$D012` value of `$10` or more seen while RST8 is set means PAL, because lines 272–311 exist on no NTSC chip. Keeping the whole value costs nothing more and tells the two NTSC chips apart.

Measured in VICE x64sc 3.10 (rung 1): the kept value was `$37` on the default PAL model, `$06` with `-model ntsc` and `$05` with `-model oldntsc`, read back from the screen as hex digits, and the same when the run was stopped at 5,000,000 and at 8,000,000 cycles. The same wait-and-track loop, entered deliberately from raster lines 100, 300 and 311 on PAL and from 100 and 262 on NTSC, gave the right answer every time.

**What does not work, and stood in this knowledge base until 2026-09-21:** polling for RST8 to become set and then reading `$D012` once. That read lands on line 256, the first line of the band, and returns `$00` on every chip (measured as `00` on all three VICE models), so a `cmp #$10` after it says NTSC unless the routine was called from inside lines 272–311 by luck. Both copies of the "shortest reliable detect" here did exactly that (`hardware/pal-ntsc-reference.md` Method 2, and the fix in `pitfalls/region-timing.md`, whose copy also fell through a `bne` after `lda #0` and so answered NTSC from either branch). Both are corrected on their own pages, with the measurements.

### Why it works

The counter is incremented at the start of each raster line and reset to zero for line 0 (Bauer, §3.6.3; not measured here beyond the wrap values above). RST8 is bit 8 of that counter, so it is a level, not an event: it reads 1 for the whole of lines 256 onward and 0 for the whole of lines 0–255, and a polling loop can watch it change without a raster interrupt and without touching `$D019`. The last line of the frame is the only place the three chips disagree, and it is the last line on which RST8 reads 1. Sampling the low byte until RST8 falls therefore reads that line's number without knowing it in advance. The display window is not involved: lines 256 and up are lower border or vertical blanking on every chip, and no badline can occur there since the badline condition needs a raster line between `$30` and `$F7` (Bauer, §3.5; not measured here), so with no sprites enabled (the state at boot; sprite DMA would take cycles from these lines too, since the sprite Y compare uses the low byte of the raster counter: Bauer, §3.8; not measured here) the CPU keeps every cycle of every line in the band and a loop of fifteen to twenty-two cycles samples each line two to four times.

The frame is the same length however the routine is entered, so the answer does not depend on when the program started; the two waits guarantee that sampling begins at line 256 and ends at line 0, so the band's last line is always among the samples. How long the routine holds the CPU does depend on the entry line. Called from line L below 256 it runs N − L lines, the rest of the frame; called from inside the band it runs 2N − L lines: the rest of that band, the 256 lines with RST8 clear, and the whole of the next band. So it takes at least N − 255 lines: 57 on PAL (3,591 cycles, about 3.6 ms), 8 on the 6567R8 (520 cycles, about 0.5 ms), 7 on the 6567R56A. It takes at most 2N − 256 lines: 368 on PAL (23,184 cycles, about 23.5 ms, 1.18 frames), 270 on the 6567R8 (17,550 cycles, about 17.2 ms, 1.03 frames), 268 on the 6567R56A (arithmetic from the settled constants). Measured in VICE x64sc 3.10 with CIA 1 timer A wrapped around the 26-byte tracking loop that `detect_region` in `pitfalls/region-timing.md` extends with its flag store, CIA interrupts masked and any pending one acknowledged first, and the wrapper's own 17 cycles taken off by a null-call control: 3,575 cycles from PAL line 255 and 23,172 from line 256; 500 and 17,535 on the 6567R8; 432 and 17,131 on the 6567R56A; 13,337 from PAL line 100 and 19,707 from line 311, each within one line of the arithmetic. **Correction (2026-09-22):** until this date this page said the measurement "takes between one and two frames — about 40 ms on PAL, 33 ms on NTSC". That was a bound written from the shape of the loop, not measured, and it is wrong at both ends: the routine never reaches two frames, and from most entry lines it takes well under one.

### Variations

**Time a frame with a CIA timer.** Start a CIA timer at one raster line 0 and read it at the next: about 19,656 cycles on PAL (312 × 63), 17,095 on the 6567R8 (263 × 65), 16,768 on the 6567R56A (262 × 64) (arithmetic from the settled constants; this variant was not run here). `hardware/pal-ntsc-reference.md` Method 1 lists it. It yields the cycle count, which the raster method does not, at the cost of a CIA timer, more code and a threshold to choose. On a stock machine the raster band is the shorter read.

**Store, do not repeat.** Take the measurement once, before interrupts are installed, into a byte the rest of the program branches on: the music tick (`pal_ntsc_tempo_mismatch`), CIA reloads (`cia_timer_phi2_difference`), raster tables (`raster_line_count_difference`). Nothing about the chip changes later.

**Three-way or two-way.** Keep the raw last-line byte if the program counts cycles per line or lines per frame on NTSC (the R8 and the R56A differ in both, 65 against 64 and 263 against 262, settled); reduce it to PAL/NTSC with one compare against `$10` otherwise.

**The KERNAL's own answer.** The stock KERNAL takes a two-way measurement of its own at reset and leaves it at `$02A6` (PALNTS): 1 for PAL, 0 for NTSC. The mechanism is in the ROM bytes (`kernal-901227-03.bin`, read here): the reset path at `$FF5B` initialises the VIC from a table that sets the raster compare to line 311 and acknowledges `$D019`, clears the screen, waits for `$D012` to read zero, then reads `$D019`, keeps bit 0 and stores it at `$02A6`. The raster-compare flag can only have been raised if a line 311 exists. It cannot tell the R8 from the R56A, a replacement KERNAL or an earlier program may have left anything there, and its reliability was not measured here; `hardware/pal-ntsc-reference.md` Method 3 has the detail. Measure the chip when the answer matters.

### Cycle budget

None per line. The routine runs once, with interrupts disabled, and holds the CPU for between 57 and 368 lines on PAL (about 3.6 to 23.5 ms) or between 8 and 270 lines on the 6567R8 (about 0.5 to 17 ms) depending on where in the frame it is entered: a fifth of a frame at best, 1.2 frames at worst, measured as described above; nothing else is expected to run during it. It takes no raster interrupt and writes neither `$D011` nor `$D012`. 36 bytes with the compare and flag store as `detect_region` in `pitfalls/region-timing.md` (assembler count); the hardware page's Method 1 `detect_region` returns a three-way code in A and its Method 2 `detect_pal` a carry flag, both with the same `wait_lo` guard.

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
**Cost:** cycles_per_frame=314, irq_slots=1
**Cost basis:** measured-vice
**Cost measured on:** oscar64-platformer-scaffold (the raster IRQ from entry to return, 291, plus the loop's tick bookkeeping, 23; PROFILE=1 build, PAL and NTSC; the budget bar's two stores are not inside)
**Claims:** vic_raster_irq (shares)
**Claims basis:** measured-vice

Store trace of `recipes/oscar64/frame-sync-loop.md` (`scripts/claims-watch.ts`,
PAL): Oscar64's `rasterirq`, which runs the tick, is the program's only
writer of `$D011`, `$D012`, `$D019` and `$D01A`. The tick is one slot at the sync line and can be
one entry in another effect's chain, so it shares the compare rather
than owning it. The `$0314` store in the trace is the recipe's choice of
entry (Oscar64's `rirq_init_kernal`); the spin-only variation writes
none of these.

### Why

A game loop that runs as fast as the CPU allows draws at a rate the VIC-II
does not share: sprites move while the beam is drawing them, screen writes
land half-way down a character row, and the speed of the game changes with
the amount on screen. Locking the loop to the frame fixes all three. Once a
frame, at a chosen raster line, the loop wakes, does its work, and
goes back to waiting. Three questions follow: how does the loop know a new
frame has begun, how much of the frame did the work take, and did any frame
go by without it. This technique answers each. Put it in a game before
anything else, because its budget bar is the profiler for the rest of the
project.

### How

**The wait, without an interrupt.** The raster counter is nine bits, the low
eight in `$D012` and RST8 in bit 7 of `$D011`, and RST8 is a level: it reads
1 for the whole of lines 256 upward and 0 for lines 0 to 255 (see
`pal_ntsc_detection` above). Spinning until RST8 is set therefore returns at
line 256 on every chip. That is what Oscar64's `vic_waitBottom()` does
(`vic.c` lines 62 to 66), and `vic_waitFrame()` first spins until RST8 is
clear and then until it is set (lines 74 to 80), so two calls in a row are
always one frame apart. The difference counts: the RST8 band is 56 lines
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
`vic_waitLine()` does this, matching the low byte and then checking
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

**The wait, with an interrupt.** This form takes one raster interrupt
at the sync line and lets it do one thing: increment a byte. The main loop
keeps its own copy of the byte and spins while the two are equal. The
interrupt only ever increments and the main loop only ever catches up;
nothing is cleared across the boundary, so a tick cannot be lost between a
read and a clear, and the byte is one byte so the read needs no `SEI`. In
Oscar64, `rirq_count` and `rirq_wait()` (`rasterirq.c` lines 606 to 614) are
this loop, with the byte incremented once per frame by the dispatcher
after the last slot of the schedule; a `rirq_call` to an `__interrupt`
function that increments a program byte is the same thing with the
counting on the page. The recipe below does the latter. A plain flag,
set by the interrupt and cleared by the loop, works too, but it cannot count
how many frames were missed; the tick byte can.

**A frame counter.** Count the loop's iterations in a 16-bit variable owned
by the main loop. That is the game's clock: animation phases, spawn timers
and music tempo divide it. Count ticks separately for a clock that keeps
running while the loop is late.

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
the budget used. C64 programmers use this as standard; it costs two stores and
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
clears it. The simplest form; it cannot count missed frames, and a loop
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
line arrives. The bar is two absolute stores. What the loop has left is
the frame: 312 × 63 = 19,656 cycles on PAL and 263 × 65 = 17,095 on the
6567R8, less 40 to 43 for each of the 25 badlines and less any sprite DMA
(arithmetic from the settled constants);
`game-design/game-design-patterns.md` budgets about 19,700 after
interrupt overhead on PAL, which is a rounding of the same figure.

The interrupt form pays the interrupt once per frame: 36 cycles to the
handler through `$0314` (settled), then the dispatcher and the handler
body. For Oscar64's `rasterirq.h` with one slot calling a handler that
bumps a byte, the whole path is 291 cycles, and the loop's tick
bookkeeping after the wait 23 more. Measured in VICE x64sc 3.10 on
`recipes/oscar64/platformer-scaffold.md`'s `PROFILE=1` build: one busy
loop timed on CIA1 timer B across line 251, where the IRQ lands, against
the same loop from line 20, least of 32 runs each, the same on PAL and
NTSC. The Cost line states those 314 cycles since #37. Before, it
carried only `bytes_code=985`, the whole `frame-sync-loop.md` PRG, which
a budget does not sum, so every plan named this technique unknown.

`rirq_init(true)` leaves the KERNAL's 60 Hz CIA interrupt running. Each
time it fires it takes 235 cycles in that build, wherever the loop is.
It is the KERNAL's cost, not this technique's; a loop that needs the
cycles turns it off.

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
**Cost:** cycles_per_frame=498, lines_active=3, irq_slots=3
**Cost basis:** measured-vice
**Cost measured on:** kickassembler-irq-chain (three slots with two-store handlers and an empty music call, frame-counter print left out, badline stalls left out)
**Claims:** vic_raster_irq (owns)
**Claims basis:** derived-listing

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
and less about 160 for the dispatcher (measured: see below).

**Measured per frame.** Traced in VICE x64sc 3.10 (PAL) with
monitor tracepoints on `$FF48` and on the `RTI` of `$EA81`, from the
interrupt's acceptance to the end of `RTI`: 159 cycles for a slot that
does not wrap, with the recipe's handler (two stores and `RTS`); 180 for
the wrap slot, frame counter and empty `JSR music_tick` included, with
the recipe's decimal frame print left out; 498 for the three-slot frame.
Slot 1 at line 130 measured 202 because the badline at 131 falls inside
it; the Cost line leaves that stall out, because a budget charges the
frame's badlines separately. An earlier Cost line said 273, an estimate
of about 91 a slot; the page's own sum was already about 150 a slot.

### Why it works

The VIC raises IRST in `$D019` when its raster counter equals the nine-bit
compare value, once per frame per value, and holds /IRQ low while IRST and
ERST (`$D01A` bit 0) are both set. Writing 1 to `$D019` bit 0 clears IRST
and nothing else. The compare value can be changed at any time; the next
match is at the new line, in this frame if it is still ahead of the beam
and in the next frame if not. So one compare register, re-pointed once per
interrupt, walks the beam through the table.
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

## raster_profile_bars — Per-subsystem border bars and a CIA timer table

**Complexity:** low
**Region:** both
**Uses registers:** D020, DD04, DD05, DD0E
**Requires:** frame_sync_loop
**Cost:** cycles_per_frame=467
**Cost basis:** measured-vice
**Cost measured on:** oscar64-raster-profile-bars (worst frame, screen blanked)

### Why

`frame_sync_loop` above gives one budget bar and a dropped-frame count:
it says a frame overran, not which part of the game did it. Games answer
that with one border colour per subsystem, so the border becomes a
stacked bar of where the frame goes, behind a build switch so the release
carries none of it. c64gameframework has one assembly-time switch per
subsystem (`SHOW_PLAYROUTINE_TIME`, `SHOW_SPRITEIRQ_TIME`,
`SHOW_SCROLLWORK_TIME`, `SHOW_CHARSETANIM_TIME`, `SHOW_SKIPPED_FRAME`,
`SHOW_FREE_TIME` in `main.s`, used in `raster.s` and `screen.s`); Corescape
colours the border between its stages under one `TIME_DEBUG` define
(`enemies.h`, used in `display.cpp`). A bar is readable at a glance but
only to the line. For exact numbers, bracket each subsystem with a CIA
timer as well and keep the last and worst count per subsystem in a table.

### How

**Bars.** At the start of each subsystem, store its colour to `$D020`;
after the last one, store the idle colour. Give every subsystem its own
colour and keep the order fixed, so a band's position identifies it. Wrap
the stores in a macro that compiles to nothing when the switch is 0.

**Reading a bar.** Its height in raster lines is the subsystem's
duration: 63 cycles a line on PAL, 65 on the 6567R8. A screenshot turns
this into numbers with no eye involved: read the border column (x = 2) of
VICE's exit PNG with PIL, map each pixel to a subsystem by its palette
triple, and convert PNG row to raster line (PAL line = row + 16; NTSC line
= row + 28, and NTSC rows 235 to 246 are lines 0 to 11 of the next frame;
`runtime/vice-reference.md`, "Reading the exit screenshot"). The recipe
carries the snippet. Lines 288 to 311 and 0 to 15 on PAL, and 12 to 27 on
NTSC, are not in the PNG at all, so a bar there cannot be read headless:
a loop synced at line 251 profiles into that gap, and either moves the
sync line for a profiling build or relies on the table.

**Bars are wall time.** The beam does not wait for the CPU. On a badline
the VIC-II takes 40 to 43 cycles (`pitfalls/raster-and-badline.md`,
`badline_cycle_loss`), so the same code covers more lines inside the
display window than in the border. Measured in the recipe (VICE x64sc
3.10): a busy loop of 3,255 CPU cycles took 3,556 cycles in the display,
seven badlines at 43 each. A bar that grows when its subsystem moves down
the screen has not got slower. Sprite DMA stretches bars and the timer the
same way, 5 to 19 cycles a line with sprites on (`vic_bus_takeover_on_dma`).

**The table.** Bracket each subsystem with CIA2 timer A: load the latch
with `$FFFF` once, write `$11` to `$DD0E` to force-load and start, write
`$00` to stop, then read `$DD04`/`$DD05` and subtract from `$FFFF`.
Subtract the count of an empty start/stop pair (5 cycles in the recipe's
build, measured). Store the result as the subsystem's last value and
raise its maximum if larger. The timer counts phi2 cycles, stolen or not,
so it measures the same wall time as the bar, to the cycle. For CPU
cycles alone, run the same bracket once with the display blanked and
sprites off (clear DEN and wait until line $30 (48) has passed with DEN
clear, two `vic_waitFrame()` calls; the VIC-II samples DEN once per frame;
and write 0 to `$D015`). An interrupt
that fires inside a bracket is counted in that subsystem; mask them, or
read `MAX` knowing one may be in it. CIA2 timer A is free while RS-232 is
unused (`hardware/cia-reference.md`); mask its interrupt so it raises no
NMI. It is also taken by any CIA2 timer NMI, such as NMI sample playback
or the NMI lock that disables RESTORE (`hardware/cia-reference.md`); use a
timer nothing else runs.

**Reading the table headless.** Print it, or dump it from the VICE
monitor: a `-moncommands` file with `trace store` on the last byte the
frame writes and `command 1 "m <table> <end>"` logs the table every
frame, and the last dump in the log is the exit state (recipe, rung 1;
the screenshot was byte-identical with and without the trace). Take the
addresses from the build's map file.

### Why it works

`$D020` is read by the VIC-II for every border pixel it draws, so a store
shows within the same line (`frame_sync_loop` above). The
interval between two stores is therefore drawn as one band, and its
height counts the line starts inside the interval: a bar of W cycles is
W / 63 lines, give or take one. The CIA timer runs on the same phi2 clock
as the VIC-II's raster, so the two methods must agree to that
quantisation, and in the recipe they do: bar cycles less the timer's
figure came to 84 to 135 across all eight bars (PAL and NTSC), against
117 cycles of profiling code per subsystem outside the timer and one line
of 63 or 65.

### Variations

**Free time.** Mark the waits instead of the work and the band shows
what is left. c64gameframework's `SHOW_FREE_TIME` does it with `DEC $D020`
before each wait loop and `INC $D020` after, which needs no colour table
and works over any base colour.

**Bars only.** Five `$D020` stores cost 42 cycles a frame for four
subsystems (measured, below). This is the form to leave in a debug build
all the time.

**Table only.** For a subsystem shorter than a line, or bars that would
fall in the lines the PNG does not show.

**Worst frame.** `MAX` is the number a budget needs, not `LAST`. A
subsystem with a rare expensive frame (a spawn, a column carry) shows it
only in `MAX`: the recipe's actors subsystem spikes by 10 blocks one frame
in 64, and its `MAX` read 4,695 against a `LAST` of 3,556 on PAL.

### Cycle budget

Measured in VICE x64sc 3.10 by timing the recipe's whole frame of work
with CIA1 while blanked, built four ways
(`recipes/oscar64/raster-profile-bars.md`): 7,374 cycles with both
switches off, 7,416 with bars only (+42), 7,818 with the table only
(+444) and 7,841 with both (+467), for four subsystems. The measured run
updated all four maxima, the dearest path, so 467 is the worst frame;
without a new maximum it is about 60 cycles less (arithmetic from the
listing, not measured). In the recipe's Oscar64 build most of the table's
cost is the call and 16-bit compare of the record routine; a hand-written
assembly record would be cheaper (not measured here).

### Recipes

- `recipes/oscar64/raster-profile-bars.md`

### Sources

- c64gameframework (MIT), https://github.com/cadaver/c64gameframework,
  `main.s` (the `SHOW_*` switches), `raster.s` and `screen.s` (where they
  colour the border), read here for names only.
- Corescape (GPL-3.0), https://github.com/drmortalwombat/corescape,
  `enemies.h` (`TIME_DEBUG`) and `display.cpp` (the border colours between
  stages), read here for names only.
- VICE 3.10, `x64sc`, models `default` and `ntsc`, 8,000,000 cycles:
  every figure marked measured, from the exit PNG and the monitor log.
- This repository: `frame_sync_loop` above (the single budget bar),
  `pitfalls/raster-and-badline.md` (`badline_cycle_loss`),
  `hardware/cia-reference.md` (CIA2 timer A and RS-232),
  `runtime/vice-reference.md` (screenshot geometry, palette, monitor).
