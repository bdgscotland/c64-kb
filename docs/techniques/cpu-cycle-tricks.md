---
category: cpu
chip: 6510
---

<!-- doc-type: technique-reference -->

# CPU Cycle Tricks and Optimization

The 6510 in the Commodore 64 runs at roughly 1 MHz. The discipline of C64 optimization is per-instruction accounting: how many cycles does this sequence cost, and what is the tightest arrangement that produces the same result?

The techniques here range from portable 6502-family idioms (zero-page addressing, loop unrolling, jump tables) to C64-specific methods that exploit the 6510's coexistence with the VIC-II (phase-inverted IRQs, DMA-steal avoidance). Together they are the toolkit for squeezing effects — open borders, 24-sprite multiplexing, SID music, hardware scrolling — into a single frame.

Cycle counts throughout refer to CPU phi2 cycles: 63 per line on PAL (985,248 Hz), 65 per line on NTSC (1,022,727 Hz). See [6510-cpu-reference.md](../hardware/6510-cpu-reference.md) for the full instruction timing table.

---

## self_modifying_code — In-place opcode/operand mutation

**Complexity:** medium
**Region:** both
**Uses kernal:** (none)

### Why

Every load-and-store pair in a tight inner loop consumes cycles loading a parameter and then consuming it. If the parameter changes across outer-loop iterations but is constant within a given inner-loop run, the canonical structure is to load the parameter once, store it somewhere, then read it again on each inner-loop iteration. The load-and-store costs two instructions per iteration, even when the value has not changed since the last reload.

Self-modifying code eliminates the runtime reload. The outer loop writes the variable directly into the operand byte of the instruction that will use it. When the inner loop runs, the operand is already baked into the code stream.

### How

The pattern targets `LDA #imm` (opcode $A9, 2 bytes: $A9 followed by the immediate value). The immediate operand lives at the byte address `instruction_address + 1`. The outer loop writes directly to that address:

```asm
; Outer loop: compute new fill color in A, patch the inner loop
    lda new_color
    sta fill_loop_lda + 1     ; overwrite the LDA #imm operand byte

; Inner loop: runs N times using the baked-in operand
fill_loop_lda:
    lda #$00                  ; operand at fill_loop_lda+1 is modified above
    sta $0400,x
    dex
    bne fill_loop_lda
```

The same pattern applies to the low byte of an absolute-address operand (at `instruction + 1`) and the high byte (at `instruction + 2`). Modifying both low and high bytes lets you redirect a loop to target a different page on each outer iteration without any indirect addressing overhead.

KickAssembler provides a clean way to express this without computing the +1 offset manually:

```asm
; KickAssembler: define the operand label explicitly
lda_color:
    lda #$00
    .const lda_color_operand = lda_color + 1
; later:
    lda desired_color
    sta lda_color_operand
```

### Why it works

The 6510 has no instruction cache or prefetch buffer. A write to any RAM address takes effect before the next instruction fetch from that address. The self-modified byte is visible immediately on the next iteration. CMOS derivatives (65C02, 65816) have prefetch buffers and do not share this property — self-modification is a reliable NMOS-6510-specific technique.

### Variations

**Opcode mutation.** Write a new opcode byte at runtime to switch instruction behavior — e.g., `BNE` ($D0) to `BEQ` ($F0) to flip a branch condition without a test. Used in loaders and copy-protection stubs. Use sparingly: opcode mutation is hard to debug.

**ROM-resident risk.** Self-modification requires writable RAM. If the patched code is in a region where ROM is mapped (KERNAL/BASIC enabled via $01 bits 0-1), writes land in the RAM beneath but instruction fetches hit the ROM — the modification has no effect. Keep self-modifying code segments in regions with no ROM overlay ($1000-$7FFF is always RAM on a stock C64).

### Cycle budget

Compared to a load-from-variable approach:

| Approach | Cycles per inner-loop parameter access |
|---|---|
| LDA variable_addr (absolute) | 4 cycles |
| LDA #baked (after self-mod patch) | 2 cycles |
| Savings per access | 2 cycles |

For a 256-iteration inner loop, the savings are 512 cycles per outer-loop iteration — approximately 26 full raster lines worth of CPU time on PAL.

### Recipes

- `recipes/kickassembler/cracktro-template.md` (uses self-modification to cycle raster bar colors per frame)

---

## unrolled_loops — Loop unrolling at assembly level

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

Every loop iteration carries overhead: DEX/DEY (2 cycles) plus BNE taken (3 cycles) = 5 cycles per iteration. For inner loops where N is known at assembly time, replicating the body N times eliminates this overhead entirely. The tradeoff is linear code-size growth — an 8x-unrolled body occupies 8x the bytes.

### How

Manual unrolling replicates the body and adjusts any index increments:

```asm
; Rolled version: 8 iterations, 8 * (body + DEX + BNE) = 8 * (N + 5) cycles
    ldx #8
loop:
    lda source,x
    sta dest,x
    dex
    bne loop

; Unrolled 8x: no DEX/BNE, 8 * body_cycles only
    lda source+8
    sta dest+8
    lda source+7
    sta dest+7
    lda source+6
    sta dest+6
    lda source+5
    sta dest+5
    lda source+4
    sta dest+4
    lda source+3
    sta dest+3
    lda source+2
    sta dest+2
    lda source+1
    sta dest+1
```

KickAssembler's `.for` directive makes this mechanical and readable:

```asm
.for (var i = 8; i >= 1; i--) {
    lda source + i
    sta dest + i
}
```

The assembler generates the fully unrolled sequence at build time. The resulting binary contains 8 `LDA/STA` pairs and no branch instructions.

### Why it works

Branch instructions cost 3 cycles when taken (4 on page-cross); DEX/DEY cost 2 cycles. Removing them by replication is safe when the loop count is compile-time constant and the body has no mid-loop counter dependencies. Unrolled loops are also simpler to cycle-count: the budget is `N * (LDA + STA)` with no branch considerations.

### Variations

**Partial unroll.** Unrolling 8x (rather than full-N) converts a 256-iteration loop to 32 iterations of an 8x body: `32 * (8*B + 5)` vs `256 * (B + 5)`. For B=10 this cuts overhead from 1280 to 160 cycles.

**Computed entry point.** For non-power-of-two trip counts, unroll to the next power of two and compute an entry offset to jump into the middle of the unrolled sequence, avoiding a remainder loop.

**Fall-through table.** Replicate the body N times; compute the entry as `table_start + (N - count) * body_bytes`. Execution falls through exactly the required number of iterations with no loop at all.

### Cycle budget

For body B cycles, N iterations: rolled = `N*(B+5)`, 8x unrolled = `(N/8)*(8*B+5)`, fully unrolled = `N*B`. Speedup at 8x: 1.41x for B=10, 1.95x for B=4. Smaller bodies benefit more, which is why unrolling is most valuable for LDA/STA memory-copy loops (B=7).

### Recipes

- `recipes/kickassembler/sine-scroller.md` (unrolled character-copy inner loop)

---

## illegal_opcode_tricks — Useful undocumented opcodes

**Complexity:** high
**Region:** both
**Uses kernal:** (none)

### Why

The MOS 6510 has 256 possible opcode bytes, of which only 151 are officially documented. The remaining 105 execute and produce side effects determined by the chip's microcode decode matrix. On a stock C64, the safe subset (approximately 30 opcodes) is fully reliable across all NMOS 6510 and 8500 parts. Each saves 1-3 cycles and/or 1-2 bytes compared to the legal sequence it replaces.

See [6502-illegal-opcodes.md](../hardware/6502-illegal-opcodes.md) for the full reference, including per-opcode cycle counts, flag effects, and stability ratings. This section covers practical application patterns.

### How

The most useful illegal opcodes by use case:

**LAX (Load A and X)** — `A = X = M`. Zero-page form ($A7): 3 cycles / 2 bytes vs. `LDA zp : LDX zp` at 6 cycles / 4 bytes. Classic sprite-multiplexer use: load a Y-coordinate and simultaneously have it as a table index. Note: `LAX #imm` ($AB) is **unstable** — floating internal bus produces wrong results on some 6510 runs. Use only memory-addressed forms.

**SAX (Store A AND X)** — `M = A & X`. No flags affected. When X holds a nibble mask, `SAX zp` writes the masked accumulator in 3 cycles/2 bytes vs. `AND #mask : STA zp` at 7 cycles/4 bytes.

**AXS (AND A with X, subtract into X)** — `X = (A & X) - imm`. Sets flags like CMP. Decimal mode ignored — always binary. Fused mask-and-decrement: `AXS #1 : BNE loop` = 4 cycles vs. `TXA : AND #mask : TAX : DEX : BNE loop` = 9 cycles.

**ALR (AND then LSR)** — `A = (A & imm) >> 1`. Two cycles / 2 bytes. Equivalent to `AND #imm : LSR A` (4 cycles / 4 bytes).

**ARR (AND then ROR with quirky flags)** — `A = ROR(A & imm)`. In binary mode, C = bit 6 of result (not bit 0 as normal ROR). V = bit 6 XOR bit 5. The non-standard flag semantics come from an internal half-adder; useful in CRC routines.

**DCP (Decrement then Compare)** — `M-- ; compare A to new M`. Zero-page form ($C7): 5 cycles. Legal `DEC zp : CMP zp`: 7 cycles.

**RMW family — SLO, RLA, SRE, RRA:** Each combines a memory read-modify-write (ASL/ROL/LSR/ROR) with an accumulator combine (ORA/AND/EOR/ADC). Every one saves 2 bytes and 2-3 cycles vs. the equivalent legal pair. These are the workhorses of cycle-tight sprite multiplexer and raster code.

| Mnemonic | Equivalent legal pair | Cycles saved (zp) |
|---|---|---|
| SLO | ASL zp : ORA zp | 2 |
| RLA | ROL zp : AND zp | 2 |
| SRE | LSR zp : EOR zp | 2 |
| RRA | ROR zp : ADC zp | 2 |

### Why it works

The 6502 decode matrix assigns addressing modes to columns and operations to rows. "Illegal" cells activate whatever micro-operations the (column, row) pair selects — typically two operation strobes simultaneously. For the safe tier (LAX, SAX, ALR, ARR, ANC, AXS, DCP, ISC, SLO, RLA, SRE, RRA), the fused operations use disjoint internal paths and are deterministic across every NMOS 6510 and 8500 ever produced. For the unstable tier (XAA/ANE, LAX #imm, AHX, TAS, SHX, SHY), a floating internal bus produces results that vary by die revision, batch, and thermal state. Do not use unstable opcodes in production code.

### Variations

**Undocumented NOPs for cycle padding.** The six 1-byte NOPs ($1A, $3A, $5A, $7A, $DA, $FA) cost 2 cycles / 1 byte — tighter than `BIT zp` (3 cycles / 2 bytes). Used in cycle-exact raster code to add exactly 2 cycles without consuming a branch slot or growing code by 2 bytes.

### Cycle budget

Per call site: LAX zp saves 3 cycles vs LDA+LDX; SAX zp saves 5 vs AND+STA; ALR saves 2 vs AND+LSR; DCP zp saves 2 vs DEC+CMP; SLO zp saves 2 vs ASL+ORA. In a 20-entry sprite multiplexer, these accumulate to 30-60 cycles per raster line — enough to free an extra badline slot.

### Recipes

- `recipes/kickassembler/sprite-multiplex-24.md` (uses DCP, SLO, LAX for tight badline multiplexer)
- `recipes/kickassembler/cracktro-template.md` (uses SAX for color-RAM nibble stores)

---

## jump_table_dispatch — JMP indirect through a table

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

A CMP/BEQ chain costs 5 cycles per case — O(N) in the worst case. A jump table reduces any N-way dispatch to a fixed ~26 cycles regardless of N, using two table lookups and a self-modified JMP.

### How

Build a table of 16-bit routine addresses in memory (low byte followed by high byte per entry, standard 6510 little-endian):

```asm
dispatch_table:
    .word handle_state_0
    .word handle_state_1
    .word handle_state_2
    .word handle_state_3
    ; ... up to 256 entries

dispatch:
    lda current_state   ; 4 cycles (abs) or 3 (zp)
    asl                 ; 2 cycles — multiply by 2 for word offset
    tax                 ; 2 cycles
    lda dispatch_table,x    ; 4 cycles — low byte of address
    sta jmp_target+1        ; 4 cycles — patch low byte of JMP operand
    lda dispatch_table+1,x  ; 4 cycles — high byte of address
    sta jmp_target+2        ; 4 cycles — patch high byte of JMP operand
jmp_target:
    jmp $0000           ; 3 cycles — lands at the patched address
```

Total: 3+2+2+4+4+4+4+3 = 26 cycles for any dispatch, regardless of the number of cases.

The self-modification pattern used here (`STA jmp_target+1 / +2`) is the same technique described in `self_modifying_code`. The JMP absolute opcode ($4C) occupies 3 bytes: opcode at `jmp_target`, low byte at `jmp_target+1`, high byte at `jmp_target+2`.

An alternative is `JMP ($abs)` (opcode $6C, 5 cycles): the table holds word pointers and X indexes to the correct entry. This avoids self-modification but costs 2 extra cycles vs the direct form. Caveat: the 6502 JMP indirect page-wrap bug — if the low byte of the pointer is at $xxFF, the high byte is fetched from $xx00 instead of $(xx+1)00. Keep jump tables away from page boundaries.

### Why it works

`JMP $abs` ($4C, 3 cycles) transfers control to the 2-byte address at opcode+1. Writing new values there changes the destination. The 6510 has no instruction cache, so the patched address is visible immediately on the next JMP execution.

### Variations

**RTS table dispatch.** Store `(address - 1)` in the table. Push high then low byte, execute `RTS`. The 6510's RTS adds 1 to the popped address. Avoids self-modification but costs 12-15 cycles vs 26 for the STA-patch form — slower for large N.

**Persistent X.** If the state index is already in X, the prologue shrinks to `TXA : ASL : TAX` (6 cycles), saving 1-4 cycles.

### Cycle budget

| Approach | Cycles (N=4) | Cycles (N=8) | Cycles (N=16) |
|---|---|---|---|
| CMP/BEQ chain (worst case) | 20 | 40 | 80 |
| CMP/BEQ chain (average case) | 13 | 25 | 50 |
| Jump table (self-mod) | 26 | 26 | 26 |
| Jump table (indirect JMP) | 21 | 21 | 21 |

Jump table becomes faster than CMP/BEQ chains at N=6 (self-mod) or N=5 (indirect JMP) for average-case dispatch, and at N=4 (self-mod) or N=3 (indirect JMP) for worst-case dispatch. For state machines with 8+ states, the jump table is always preferred.

### Recipes

- `recipes/oscar64/simple-shmup.md` (game-state dispatcher uses jump table for scene transitions)

---

## zero_page_burst — Zero-page abuse for cycle savings

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

The 6510 has two addressing modes that reference the first 256 bytes of the address space (the "zero page"): zero-page and zero-page indexed. These modes encode the address in one byte instead of two, making zero-page instructions 1 byte shorter than their absolute equivalents. More importantly, they execute 1 cycle faster: `LDA zp` costs 3 cycles versus `LDA abs` at 4 cycles; `STA zp` costs 3 versus 4; `LDA zp,X` costs 4 versus 5.

For a tight inner loop that accesses the same variable many times, moving that variable to zero page saves 1 cycle per access. In a loop that runs 256 iterations and reads two variables, that is 512 cycles — about 26 PAL raster lines.

### How

Identify the hot variables in your inner loops and map them to zero-page addresses. The C64's zero-page layout has pre-allocated areas: $00 (CPU DDR) and $01 (I/O port / banking) are off-limits. $02-$0F is free in most demo contexts. $10-$8F is nominally BASIC workspace — safe when BASIC ROM is disabled. $90-$BF is KERNAL working storage — unsafe without a full KERNAL replacement. $FA-$FB is the conventional demo 16-bit pointer; $FC is often used as a frame counter; $FD-$FF as scratch. See `docs/hardware/c64-memory-map.md` for the full layout.

Demos that take over the machine fully (disable BASIC and KERNAL ROMs, install custom IRQ/NMI/RESET handlers) can use $02-$FF minus $00/$01.

In KickAssembler, declare zero-page variables explicitly:

```asm
.var zp_counter = $02
.var zp_color   = $03
.var zp_ptr_lo  = $FA
.var zp_ptr_hi  = $FB

    lda (zp_ptr_lo),y   ; 5 cycles — indirect indexed from zero page
    sta zp_counter      ; 3 cycles — write to zero page
```

### Why it works

The 6510's bus cycle for zero-page addressing omits the high-byte address fetch. An absolute read requires: (1) fetch opcode, (2) fetch low address byte, (3) fetch high address byte, (4) read data. A zero-page read omits step 3 (the high byte is always $00) and does: (1) fetch opcode, (2) fetch zero-page address byte, (3) read data. One fewer bus cycle = one fewer CPU cycle. The instruction is also 1 byte shorter because the high address byte is absent from the instruction stream.

The (zp),Y addressing mode (indirect indexed) is 5 cycles regardless of page-crossing (unless the read causes a page cross, which adds +1), while abs,Y is 4 cycles with a +1 page-cross penalty. For pointer-dereferencing loops where Y walks through 256 bytes, (zp),Y is the standard approach: the pointer sits in zero page, Y is the offset, and the instruction fetches the 16-bit address from zero page and adds Y.

### Variations

**Zero-page subroutine.** JSR is 6 cycles, RTS is 6 cycles. A subroutine call costs 12+ cycles of overhead. If the subroutine is small and called from a tight loop, inline it (loop unrolling), or if it must be separate, move its key shared state to zero page to minimize the parameter-passing overhead.

**Direct-page overlapping.** In the extreme case, move a small piece of the inner loop itself into zero page. Branch instructions have a range of ±127 bytes; if the branch target is in zero page and the branch source is in the low part of RAM, the branch will still reach. The instruction fetch cost is the same regardless of which RAM page the code occupies — but the zero-page code can be patched via zero-page STA instructions (3 cycles each versus 4 cycles for absolute STA), saving 1 cycle per self-modification.

### Cycle budget

Switching 10 variables from absolute to zero-page in a 256-iteration loop:

- Savings per access: 1 cycle
- Accesses per iteration: assume 2 loads + 2 stores = 4 accesses
- Savings per iteration: 4 cycles
- Total savings over 256 iterations: 1024 cycles ≈ 16 PAL raster lines

For very tight raster effects (stable raster IRQ handlers, sprite multiplexers) where the cycle budget is measured in single digits per scanline, zero-page placement of all loop variables is non-negotiable.

### Recipes

- `recipes/kickassembler/sprite-multiplex-24.md` (sprite coordinate tables in zero page for 3-cycle LDA)

---

## decimal_mode_pitfalls — SED/CLD in IRQs

**Complexity:** medium
**Region:** both
**Uses kernal:** (none)

### Why

The 6510 inherits the 6502's BCD mode. `SED` makes `ADC`/`SBC` perform decimal arithmetic; `CLD` restores binary. Almost no C64 code uses BCD deliberately, but the D flag persists across interrupts unless explicitly cleared. If code sets D and an IRQ fires before the next `CLD`, the IRQ handler's arithmetic produces wrong results. The bug is intermittent — it surfaces only when an IRQ fires during the SED..CLD window.

### How

The rule: any IRQ handler that uses ADC or SBC must clear D on entry with `CLD` and restore it before `RTI` if the interrupted code may have had D=1.

```asm
my_irq_handler:
    pha                 ; save A
    txa : pha           ; save X
    tya : pha           ; save Y
    cld                 ; clear decimal mode — MANDATORY
    ; ... handler body using ADC/SBC safely ...
    pla : tay
    pla : tax
    pla
    rti
```

The KERNAL IRQ handler at $EA31 already executes `CLD` early in its sequence — this is one reason KERNAL-routed IRQs are safe for code that uses BCD. Custom handlers must do this manually.

For code that deliberately uses BCD, bracket the BCD section as tightly as possible with `SED`/`CLD` to minimize the window where an IRQ can fire with D=1 active.

### Why it works

The interrupt sequence pushes the status register P (7 cycles: PC hi, PC lo, P, then vector fetch). RTI pops P and restores all flags including D. The NMOS 6510 does NOT clear D on interrupt entry — this is a documented difference from the CMOS 65C02 (which does clear D on every interrupt). Any handler that uses ADC/SBC must do so explicitly via `CLD`.

### Variations

**NMI handlers** at $FFFA/$FFFB have the same issue. NMI cannot be masked with `SEI`, so NMI handlers must also include `CLD` on entry if they use arithmetic.

**Diagnostic pattern.** Intermittent wrong arithmetic only during IRQ activity is the classic symptom of a missing `CLD`. Trace all `SED` paths to the next `CLD` in your codebase.

### Cycle budget

`CLD` costs 2 cycles. `SED` costs 2 cycles. Adding them to an IRQ handler that runs every frame costs 4 cycles per frame — approximately 0.02% overhead at 50 Hz. This is categorically not worth skipping.

---

## bit_test_trick — BIT instruction as branchless 2-byte NOP

**Complexity:** medium
**Region:** both
**Uses kernal:** (none)

### Why

The 6510's `BIT $abs` instruction (3 bytes, 4 cycles) tests bits in a memory value against the accumulator: bits 7 and 6 of the memory byte are copied into the N and V flags, and Z is set if `A AND M == 0`. Crucially, A itself is not modified. This makes `BIT` usable as a "swallow the next 2 bytes" instruction: if you embed a raw `$2C` byte ($2C is the opcode for `BIT abs`) in the code stream, the following 2 bytes are consumed as the operand and the instruction completes without side effects (beyond setting N, V, Z).

This allows two different entry points into a code sequence to produce two different values in A without a branch instruction.

### How

The canonical pattern is a dual-entry loader:

```asm
entry_a:
    lda #$01            ; 2 bytes: opcode $A9, operand $01
    .byte $2C           ; 1 byte: BIT abs opcode — eats next 2 bytes
entry_b:
    lda #$02            ; 2 bytes: opcode $A9, operand $02
                        ; When fallen through from entry_a: these 2 bytes
                        ; are consumed as the "abs" operand of BIT, and
                        ; execution continues at the instruction AFTER lda #$02
do_work:
    sta result
```

Execution from `entry_a`:
1. `LDA #$01` — A = 1.
2. `$2C` followed by the 2 bytes of `LDA #$02` are decoded as `BIT $02A9` — a read of address $02A9, setting N/V/Z from that read. A unchanged (still 1). 4 cycles.
3. Execution continues at `sta result` with A = 1.

Execution from `entry_b`:
1. `LDA #$02` — A = 2.
2. Execution continues at `sta result` with A = 2.

Total cost for the "skip" path: 2 (LDA #$01) + 4 (BIT abs) = 6 cycles, versus 2 (LDA #$01) + 3 (JMP do_work) = 5 cycles for a branch. The BIT trick saves 1 byte (no JMP instruction needed) at the cost of 1 extra cycle for the BIT. The real win is code density and eliminates a forward-reference label.

KickAssembler can encode this cleanly:

```asm
entry_a:
    lda #$01
    !byte $2C           ; raw byte — BIT abs opcode
entry_b:
    lda #$02
do_work:
    sta result
```

### Why it works

`BIT $abs` has opcode $2C and takes 3 bytes (opcode + 2-byte address). It performs a read from the 16-bit address formed by bytes 2 and 3. The CPU executes the instruction in 4 cycles: (1) fetch opcode $2C, (2) fetch low byte of address, (3) fetch high byte of address, (4) read the target memory. Only N, V, and Z flags are modified. A is unchanged.

When the CPU fetches $2C from `entry_a+2`, it interprets $2C as the start of a BIT abs instruction and then consumes the next 2 bytes — which happen to be the 2 bytes of `LDA #$02` — as the 16-bit address operand. The read happens at address `$02 * 256 + $A9 = $02A9` (interpreting the little-endian value: low byte $A9 = opcode of `LDA imm`, high byte $02 = operand of `LDA #$02`). This read has no side effects. After the BIT completes, the PC is now pointing at `do_work`.

The technique is found throughout the KERNAL ROM, which uses it to share subroutine tails between two entry points that differ only in which initial value is loaded.

### Variations

**Zero-page BIT as 1-byte NOP.** `BIT $zp` (opcode $24, 2 bytes, 3 cycles) consumes only 1 operand byte — it "skips" a 1-byte instruction. Use this to skip a 1-byte NOP, a 1-byte register-to-register transfer (TAX etc.), or a 1-byte stack operation (PHA/PLA). The same flag caveats apply.

**Immediate NOP for 2-cycle padding.** The undocumented `NOP #imm` opcodes ($80, $82, $89, $C2, $E2 — 2 bytes, 2 cycles each) skip 1 byte without touching flags. For cycle-padding scenarios where N/V/Z must not change, prefer these over `BIT zp`.

**Flag side effects.** The BIT instruction does modify N, V, and Z. Any code following the skip that reads these flags will see values from the `BIT` operand fetch, not from whatever the "skipped" instruction would have set. If the subsequent code branches on N/V/Z, this matters. In the dual-entry pattern, `do_work` must either reset the flags or not depend on them.

### Cycle budget

Dual-entry with BIT trick vs explicit branch:

| Approach | Bytes | Cycles (path A) | Cycles (path B) |
|---|---|---|---|
| BIT skip trick | 5 total | 6 (LDA + BIT) | 2 (LDA only) |
| Explicit JMP label | 6 total (adds JMP) | 5 (LDA + JMP) | 2 (LDA only) |

The BIT trick saves 1 byte at the cost of 1 extra cycle on the "path A" execution. In code-size-constrained scenarios (fitting into a 255-byte page, keeping a sequence within branch reach) the byte saving is worth the extra cycle.

---

## phase_inverted_irq — Running tasks during VIC's bus-yield idle cycles

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D012, D019, D01A
**Uses kernal:** (none)

### Why

VIC-II bus-stealing (also called "bad lines") occurs when the VIC needs to fetch character or bitmap data for the current raster line. During these fetches, the VIC asserts AEC (Address Enable Control) low for a fixed number of phi1 half-cycles, placing the address bus under VIC control and preventing the CPU from completing bus cycles. The CPU is effectively halted for 40 cycles on each badline (every 8th displayed line in the character set window).

The standard response is to work around bad lines: minimize computation, precompute, and accept that badline rows cost 40 cycles of CPU time. The advanced response is phase-inverted IRQ scheduling: instead of firing IRQs at the start of each line (where they may or may not land on a badline), fire IRQs timed to land in the free portion of the cycle budget where VIC bus activity is light or absent. On non-badlines, the full 63 cycles are available to the CPU; on badlines, 23 usable cycles remain (63 - 40). By scheduling IRQs to avoid the 40-cycle steal window, code can maintain a more predictable per-IRQ cycle budget.

### How

Badlines occur at raster lines where `(raster_y & 7) == (YSCROLL & 7)`. With default YSCROLL = 3, they fall every 8th visible line (rows 51, 59, 67, ... 243 on PAL). Within each badline, VIC steals cycles 15-54 — leaving 23 free cycles (cycles 0-14 and 55-62).

A phase-inverted IRQ fires on the non-badline immediately preceding the target badline. The IRQ handler executes in the full 63-cycle non-badline, busy-waits through the badline steal window, then performs cycle-exact writes in the post-steal free cycles:

```asm
irq_pre_badline:
    lda #$19
    sta $D019               ; acknowledge
.wait:
    lda $D012
    cmp #TARGET_LINE + 1    ; spin until the badline itself is done
    bne .wait
    lda new_color
    sta $D020               ; write lands in post-steal free cycles
    lda #NEXT_LINE
    sta $D012
    jmp ($0314)
```

### Why it works

VIC's AEC signal halts the CPU for 40 cycles during each badline. The steal window is fixed on all PAL and NTSC variants. By firing IRQs in the pre-steal or post-steal free windows, handlers have a known stable cycle budget. IRQ jitter (see `stable_raster_irq` in `docs/techniques/raster.md`) is absorbed by the polling loop; the 15-cycle pre-steal window is wide enough to contain worst-case jitter.

### Variations

**Sprite fetch avoidance.** Active sprites steal additional cycles per line (4 cycles per sprite in two 2-cycle windows). Disable sprites on critical lines or account for their steal in the cycle budget.

**Blanking the display.** $D011 bit 4 = 0 stops all VIC fetches, eliminating badlines entirely. Useful during loaders or computation phases that need the full 63 cycles/line.

### Cycle budget

PAL per-raster-line budget:

| Line type | Total cycles | VIC-stolen | CPU-available |
|---|---|---|---|
| Non-badline (no sprites) | 63 | 0 | 63 |
| Badline (no sprites) | 63 | 40 | 23 |
| Non-badline (8 sprites active) | 63 | 32 (approx) | ~31 |
| Badline (8 sprites active) | 63 | 40+32 (overlapping) | ~11-15 |

A full-screen effect that runs IRQs on every visible line (200 lines) at a badline rate of 1 in 8 has: 175 non-badlines * 63 + 25 badlines * 23 = 11025 + 575 = 11600 CPU cycles available per frame for the effect work, before overhead. This is approximately 59% of the total frame cycles.

### Recipes

- `recipes/kickassembler/cracktro-template.md` (phase-inverted IRQ scheduling for stable raster bars around the logo sprite)

---

## dma_steal_avoidance — Sequencing code to avoid VIC bus-steal

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D015, D011, D012
**Uses kernal:** (none)

### Why

Every visual element active on a given raster line costs CPU cycles through VIC bus-stealing. Budgeting these steals is essential when an effect must write multiple VIC registers per line within a narrow cycle window. The steal cost is not random — it is fully deterministic given the display configuration. A coder who knows exactly which sprites are enabled on which lines, whether the line is a badline, and whether the border is open can compute the exact cycle count available per line.

The practical problem: many C64 effects need to run cycle-exact code (stable raster writes, multiplexer updates, scroll register tweaks) and simultaneously display sprites and bitmap graphics. The VIC steals cycles for each, and their steal windows overlap in complex ways. Avoidance means structuring the code so that operations requiring contiguous cycle blocks are scheduled on lines where VIC activity leaves those blocks clear.

### How

The VIC-II bus-steal schedule for a fully-enabled PAL display (based on Christian Bauer's VIC-II article, the canonical reference):

**Badline steal:** Cycles 15-54 (40 cycles), active every 8th displayed line where `(raster_y & 7) == (YSCROLL & 7)`.

**Sprite DMA steal:** Each enabled sprite steals approximately 4 cycles per line in two 2-cycle windows near the end of the line. The exact per-sprite slots are in `docs/hardware/vic-ii-reference.md`.

**Avoidance strategies:**

1. **Disable sprites on critical lines.** Write 0 to the relevant bits of $D015 on lines that need contiguous CPU cycle blocks. Re-enable on the following line.

2. **Blank the display on heavy-compute lines.** $D011 bit 4 = 0 stops all VIC character/bitmap fetch, eliminating badlines. Full 63 cycles/line available to CPU.

3. **Sequence writes to non-stolen cycles.** Target IRQ handlers on non-badlines, schedule critical writes to cycles 0-14 or 55-62 (outside the steal window). Requires stable-raster IRQ (see `docs/techniques/raster.md`).

4. **Use the steal window for background work.** An STA issued just before a steal window has its write deferred until AEC goes high — the steal was happening anyway, so the write costs 0 extra programmer cycles. Known as "lazy writes."

### Why it works

The 6510 and VIC-II share the address and data buses via the phi1/phi2 clock. During a DMA steal, VIC asserts AEC low, extending its bus control past the CPU's phi2 slot. The CPU withholds its bus transaction and retries on the next phi2. From software, the CPU's instruction timing stretches: an instruction that would take N cycles takes N + steal_cycles when a steal overlaps it. The total cycle count per line is always exactly 63 (PAL) — the CPU simply executes fewer instructions in those 63 cycles.

The authoritative per-cycle schedule is in Christian Bauer's "The MOS 6567/6569 video controller (VIC-II) and its application in the Commodore 64" (Project 64, 1996; widely reproduced on codebase64.org). That document contains the exact cycle-per-line table for PAL and NTSC, the sprite DMA scheduling formula, and the AEC signal diagram.

### Variations

**Open borders + steal avoidance.** Side border opening requires writes to $D016 and $D011 within a 23-cycle window near the right of the line. If sprites are active on the same line, their steal windows can overlap. Avoidance: disable all sprites on border-open lines.

**Sprite crunch.** Enable sprites only on the lines where they are displayed. A 24-sprite multiplexer that activates each sprite for exactly the lines it occupies has far lower steal overhead than one that leaves all 8 hardware sprites enabled across all 200 visible lines.

### Cycle budget

Total DMA steal per frame on a fully-featured PAL display (all borders open, 8 sprites active on all visible lines, character mode):

| Source | Steal cycles |
|---|---|
| Badlines (25 lines * 40 cycles) | 1000 |
| Sprite DMA (8 sprites * 2 * 2 cycles * 200 lines) | 6400 |
| Total steal | ~7400 |
| Available CPU cycles per frame (63 * 312 = 19656 - 7400) | ~12256 |
| Available as % of frame | ~62% |

A demo that disables sprites on 100 of the 200 visible lines recovers 3200 steal cycles — a 26% improvement in usable CPU time. Combined with display blanking on heavy-compute segments, most C64 demo effects stay within budget by applying avoidance selectively on the lines where tight register writes are needed.

### Recipes

- `recipes/kickassembler/sprite-multiplex-24.md` (explicit per-line sprite enable/disable to stay within cycle budget)
- `recipes/kickassembler/fli-image.md` (badline steal avoidance for FLI color writes)
