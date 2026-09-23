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
// KickAssembler: define the operand label explicitly
lda_color:
    lda #$00
    .const lda_color_operand = lda_color + 1
// later:
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

For a 256-iteration inner loop, the savings are 512 cycles per outer-loop iteration — approximately 8 full raster lines worth of CPU time on PAL (512 / 63 = 8.1; an earlier version of this page said 26 lines, which does not follow from 63 cycles per line).

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; that recipe writes zero-page pointers for `(zp),y` indirection and rotates its bar colours through a `palette` table, and contains no self-modifying code.)

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

**SAX (Store A AND X)** — `M = A & X`. No flags affected. When X holds a nibble mask, `SAX zp` writes the masked accumulator in 3 cycles/2 bytes vs. `AND #mask : STA zp` at 5 cycles/4 bytes (and A keeps its unmasked value, so SAX is not a drop-in replacement where the masked A is needed afterwards). Measured in VICE x64sc: AND #imm 2 + STA zp 3 = 5; an earlier version of this page said 7.

**AXS (AND A with X, subtract into X)** — `X = (A & X) - imm`. Sets flags like CMP. Decimal mode ignored — always binary. Fused mask-and-decrement: `AXS #1 : BNE loop` = 5 cycles vs. `TXA : AND #mask : TAX : DEX : BNE loop` = 11 cycles (measured in VICE x64sc: AXS #imm 2 + BNE taken 3; TXA/AND/TAX/DEX 8 + BNE taken 3; an earlier version of this page said 4 and 9).

**ALR (AND then LSR)** — `A = (A & imm) >> 1`. Two cycles / 2 bytes. Equivalent to `AND #imm : LSR A` (4 cycles / 3 bytes — AND #imm is 2 bytes and LSR A is 1; an earlier version of this page said 4 bytes).

**ARR (AND then ROR with quirky flags)** — `A = ROR(A & imm)`. In binary mode, C = bit 6 of result (not bit 0 as normal ROR). V = bit 6 XOR bit 5. The non-standard flag semantics come from an internal half-adder; useful in CRC routines.

**DCP (Decrement then Compare)** — `M-- ; compare A to new M`. Zero-page form ($C7): 5 cycles. Legal `DEC zp : CMP zp`: 8 cycles (DEC zp 5 + CMP zp 3, measured in VICE x64sc; an earlier version of this page said 7).

**RMW family — SLO, RLA, SRE, RRA:** Each combines a memory read-modify-write (ASL/ROL/LSR/ROR) with an accumulator combine (ORA/AND/EOR/ADC). Every one saves 2 bytes and 3 cycles in zero page (4 in abs and zp,X, 4-5 in abs,X) vs. the equivalent legal pair — the legal pair is 5 + 3 = 8 in zero page against the illegal's 5 (an earlier version of this page said 2-3 cycles and tabulated 2). These are the workhorses of cycle-tight sprite multiplexer and raster code.

| Mnemonic | Equivalent legal pair | Cycles saved (zp) |
|---|---|---|
| SLO | ASL zp : ORA zp | 3 |
| RLA | ROL zp : AND zp | 3 |
| SRE | LSR zp : EOR zp | 3 |
| RRA | ROR zp : ADC zp | 3 |

### Why it works

The 6502 decode matrix assigns addressing modes to columns and operations to rows. "Illegal" cells activate whatever micro-operations the (column, row) pair selects — typically two operation strobes simultaneously. For the safe tier (LAX, SAX, ALR, ARR, ANC, AXS, DCP, ISC, SLO, RLA, SRE, RRA), the fused operations use disjoint internal paths and are deterministic across every NMOS 6510 and 8500 ever produced. For the unstable tier (XAA/ANE, LAX #imm, AHX, TAS, SHX, SHY), a floating internal bus produces results that vary by die revision, batch, and thermal state. Do not use unstable opcodes in production code.

### Variations

**Undocumented NOPs for cycle padding.** The six 1-byte NOPs ($1A, $3A, $5A, $7A, $DA, $FA) cost 2 cycles / 1 byte — tighter than `BIT zp` (3 cycles / 2 bytes). Used in cycle-exact raster code to add exactly 2 cycles without consuming a branch slot or growing code by 2 bytes.

### Cycle budget

Per call site: LAX zp saves 3 cycles vs LDA+LDX; SAX zp saves 2 vs AND+STA; ALR saves 2 vs AND+LSR; DCP zp saves 3 vs DEC+CMP; SLO zp saves 3 vs ASL+ORA (measured in VICE x64sc; an earlier version of this page had SAX saving 5 and DCP/SLO saving 2). In a 20-entry sprite multiplexer, these accumulate to 30-60 cycles per raster line — enough to free an extra badline slot.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/sprite-multiplex-24.md` and `recipes/kickassembler/cracktro-template.md`; neither uses an illegal opcode.)

---

## jump_table_dispatch — JMP indirect through a table

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

A CMP #imm/BEQ pair costs 4 cycles when it falls through and 5 when it matches (6 if the taken branch crosses a page), so an N-way chain costs 4N+1 cycles in the worst case — O(N). (An earlier version of this page charged 5 cycles per case; the untaken BEQ is 2, not 3.) A jump table reduces any N-way dispatch to a fixed ~26 cycles regardless of N, using two table lookups and a self-modified JMP.

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

An alternative is `JMP (ind)` ($6C, 5 cycles) through a zero-page pointer: copy the table entry into the pointer (`STA ptr` / `STA ptr+1`, 3 cycles each) and jump through it. The 6510 has no `JMP (abs,X)`, so the copy is unavoidable; the total is 3+2+2+4+3+4+3+5 = 26 cycles — the same as the STA-patch form (measured 27 vs 27 in VICE x64sc with an absolute state byte, 26 vs 26 with a zero-page one). Its only advantage is that the code stays read-only (usable from ROM or shared code). An earlier version of this page described X indexing the table directly through `JMP ($abs)` at 21 cycles; that addressing mode does not exist on the 6510. Caveat: the 6502 JMP indirect page-wrap bug — if the pointer's low byte sits at $xxFF, the high byte is fetched from $xx00 instead of $(xx+1)00. With this form the constraint is on the *pointer*, not the table; a zero-page pointer at $FF/$00 would trigger it, so avoid $FF. Separately, keep the table itself from straddling a page: each `LDA table,X` that crosses adds a cycle (measured 28 rather than 26 with the table at $09FE).

### Why it works

`JMP $abs` ($4C, 3 cycles) transfers control to the 2-byte address at opcode+1. Writing new values there changes the destination. The 6510 has no instruction cache, so the patched address is visible immediately on the next JMP execution.

### Variations

**RTS table dispatch.** Store `(address - 1)` in the table. Push high then low byte, execute `RTS`. The 6510's RTS adds 1 to the popped address. Avoids self-modification but is not faster: `LDA tbl+1,X / PHA / LDA tbl,X / PHA / RTS` is 4+3+4+3+6 = 20 cycles (measured in VICE x64sc; 4 for each `LDA abs,X` assumes the table does not cross a page boundary, +1 each if it does), and with the same LDA/ASL/TAX prologue (7) the dispatch is 27 cycles — one more than the 26 of the STA-patch form. An earlier version of this page said 12-15 cycles and "slower for large N"; the cost is constant in N.

**Persistent X.** If the state index is already in X, the prologue shrinks to `TXA : ASL : TAX` (6 cycles), saving 1-2 cycles (the listed prologue is 7 with a zero-page state byte, 8 with an absolute one; an earlier version said 1-4); store the index pre-doubled and the prologue disappears entirely (dispatch = 19 cycles).

### Cycle budget

| Approach | Cycles (N=4) | Cycles (N=8) | Cycles (N=16) |
|---|---|---|---|
| CMP/BEQ chain (worst case) | 17 | 33 | 65 |
| CMP/BEQ chain (average case, uniform) | 11 | 19 | 35 |
| Jump table (self-mod) | 26 | 26 | 26 |
| Jump table (indirect JMP via pointer) | 26 | 26 | 26 |

Worst case is 4(N−1)+5 = 4N+1; the uniform average of 4k+5 over k = 0..N−1 is 2N+3. Either jump table (26 cycles) beats the chain from N=7 in the worst case (a 6-way chain is 25) and from N=12 on average. For state machines with 8+ states the jump table is preferred for its bounded worst case. An earlier version of this table charged the chain 5 cycles per case (20/40/80 worst case), gave the indirect-JMP table 21 cycles through a non-existent `JMP (abs,X)`, and put the break-even at N=3-6.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/oscar64/simple-shmup.md`; that recipe has no switch or jump-table dispatcher.)

---

## zero_page_burst — Zero-page abuse for cycle savings

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

The 6510 has two addressing modes that reference the first 256 bytes of the address space (the "zero page"): zero-page and zero-page indexed. These modes encode the address in one byte instead of two, making zero-page instructions 1 byte shorter than their absolute equivalents. More importantly, they execute 1 cycle faster: `LDA zp` costs 3 cycles versus `LDA abs` at 4 cycles; `STA zp` costs 3 versus 4; `LDA zp,X` costs 4 versus 4 for `LDA abs,X` (5 only when the indexed address crosses a page) — for indexed loads the zero-page form saves a byte, and a cycle only on page-crossing accesses; indexed stores are the exception, `STA zp,X` at 4 versus `STA abs,X` at a fixed 5. (Measured in VICE x64sc; an earlier version of this page gave `LDA abs,X` a flat 5.)

For a tight inner loop that accesses the same variable many times, moving that variable to zero page saves 1 cycle per access. In a loop that runs 256 iterations and reads two variables, that is 512 cycles — about 8 PAL raster lines (512 / 63 = 8.1; an earlier version of this page said 26).

### How

Identify the hot variables in your inner loops and map them to zero-page addresses. The C64's zero-page layout has pre-allocated areas: $00 (CPU DDR) and $01 (I/O port / banking) are off-limits. $02 and $FB-$FE are the only bytes neither ROM touches after reset. $03-$8F is BASIC workspace (free once you never return to BASIC). $90-$FA is KERNAL working storage — the jiffy clock ($A0-$A2), keyboard buffer count ($C6), cursor/blink state ($CC-$CF), screen-line pointer ($D1-$D2), cursor column ($D3) and line-link table ($D9-$F2) are all above $BF and are written by the default IRQ every frame, so this range is unsafe while the KERNAL IRQ or CHROUT is in use, not merely without a full KERNAL replacement. $F7-$FA are the RS-232 buffer pointers, touched only by OPEN/CLOSE of device 2, which is why the demo convention of a 16-bit pointer at $FA-$FB survives in practice. $FF is BASIC's FOUT (number-to-string) scratch. (An earlier version of this page ended the KERNAL range at $BF and listed $FA-$FF as conventional free scratch.) See `docs/hardware/c64-memory-map.md` for the full layout.

Demos that take over the machine fully (disable BASIC and KERNAL ROMs, install custom IRQ/NMI/RESET handlers) can use $02-$FF minus $00/$01.

In KickAssembler, declare zero-page variables explicitly:

```asm
.const zp_counter = $02
.const zp_color   = $03
.const zp_ptr_lo  = $FA     // safe only because RS-232 (device 2) is never opened; $FB/$FC is the ROM-free choice
.const zp_ptr_hi  = $FB

    lda (zp_ptr_lo),y   // 5 cycles — indirect indexed from zero page
    sta zp_counter      // 3 cycles — write to zero page
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

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/sprite-multiplex-24.md`; its sprite tables sit at `* = $1000`, not in zero page.)

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
    txa                 ; save X
    pha
    tya                 ; save Y
    pha
    cld                 ; clear decimal mode — MANDATORY
    ; ... handler body using ADC/SBC safely ...
    pla                 ; restore Y
    tay
    pla                 ; restore X
    tax
    pla
    rti
```

(Generic 6502 syntax, one instruction per line; an earlier version wrote `txa : pha`, which is ACME/64tass statement syntax that KickAssembler and ca65 reject.)

The KERNAL IRQ path never executes CLD: neither the dispatcher at $FF48 nor the default service routine at $EA31 (nor the NMI path) contains a CLD — the KERNAL clears D only once, in its reset routine at $FCE6 (the sole CLD opcode on the reset/interrupt paths). Verified on the ROM bytes and in VICE x64sc: P captured at the service routine's exit ($EA7E) still has D=1 when the interrupted code had executed SED. The default KERNAL IRQ nevertheless does no harm to BCD code, by accident rather than design: RTI restores the interrupted P including D, and the only ADC/SBC on the whole default path are UDTIM's three compare-style SBCs ($F6AA/$F6AE/$F6B2), which use only the carry — and on the NMOS 6510 SBC's carry-out is identical in decimal and binary mode (all 65,536 operand pairs checked in VICE). Do not rely on that: any handler you chain through ($0314) or ($0318) inherits the caller's D, so a custom handler that uses ADC/SBC must CLD on entry. (An earlier version of this page said $EA31 executed CLD early in its sequence; the ROM bytes show no $D8 anywhere on that path.)

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
    lda #$01            // 2 bytes: opcode $A9, operand $01
    .byte $2C           // 1 byte: BIT abs opcode — eats next 2 bytes
entry_b:
    lda #$02            // 2 bytes: opcode $A9, operand $02
                        // When fallen through from entry_a: these 2 bytes
                        // are consumed as the "abs" operand of BIT, and
                        // execution continues at the instruction AFTER lda #$02
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

Total cost for the "skip" path: 2 (LDA #$01) + 4 (BIT abs) = 6 cycles, versus 2 (LDA #$01) + 3 (JMP do_work) = 5 cycles for a branch. The BIT trick saves 2 bytes (no 3-byte JMP instruction needed; an earlier version of this page said 1 byte, counting JMP as one) at the cost of 1 extra cycle for the BIT. The real win is code density and eliminates a forward-reference label. (Against an always-taken 2-byte relative branch — `BNE` after `LDA #$01`, since a non-zero immediate clears Z — the saving is 1 byte at the same 5 cycles.)

The fence above is already the KickAssembler encoding (`.byte $2C` with `//` comments); an earlier version of this page repeated it with `!byte $2C` and a `;` comment under the same heading, which is ACME syntax and does not assemble in KickAssembler.

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
| Explicit JMP label | 7 total (adds JMP) | 5 (LDA + JMP) | 2 (LDA only) |

The BIT trick saves 2 bytes at the cost of 1 extra cycle on the "path A" execution (2 + 1 + 2 = 5 bytes against 2 + 3 + 2 = 7; an earlier version of this table counted the JMP form as 6 bytes and the saving as 1). In code-size-constrained scenarios (fitting into a 255-byte page, keeping a sequence within branch reach) the byte saving is worth the extra cycle.

---

## phase_inverted_irq — Running tasks during VIC's bus-yield idle cycles

**Complexity:** scene-tier
**Region:** both
**Uses registers:** D012, D019, D01A
**Uses kernal:** (none)
**Demands:** midframe_raster_irqs

### Why

VIC-II bus-stealing (also called "bad lines") occurs when the VIC needs to fetch character or bitmap data for the current raster line. During these fetches, the VIC asserts AEC (Address Enable Control) low for a fixed number of phi1 half-cycles, placing the address bus under VIC control and preventing the CPU from completing bus cycles. The CPU is effectively halted for 40 cycles on each badline (every 8th displayed line in the character set window).

The standard response is to work around bad lines: minimize computation, precompute, and accept that badline rows cost 40 cycles of CPU time. The advanced response is phase-inverted IRQ scheduling: instead of firing IRQs at the start of each line (where they may or may not land on a badline), fire IRQs timed to land in the free portion of the cycle budget where VIC bus activity is light or absent. On non-badlines, the full 63 cycles are available to the CPU; on badlines, 20 cycles are guaranteed (23 if the CPU happens to be in write cycles when BA drops on cycle 12). By scheduling IRQs to avoid the 40-cycle steal window, code can maintain a more predictable per-IRQ cycle budget.

### How

Badlines occur at raster lines where `(raster_y & 7) == (YSCROLL & 7)`. With default YSCROLL = 3, they fall every 8th visible line (rows 51, 59, 67, ... 243 on PAL). Within each badline, VIC steals cycles 15-54 and holds BA low from cycle 12 — leaving 20 free cycles (1-11 and 55-63) plus cycles 12-14 for write accesses only.

A phase-inverted IRQ fires on the non-badline immediately preceding the target badline. The IRQ handler executes in the full 63-cycle non-badline, busy-waits through the badline steal window, then performs cycle-exact writes in the post-steal free cycles:

```asm
// phase-inverted IRQ handler, installed at $0314/$0315
irq_pre_badline:
    lda #$19
    sta $D019               // acknowledge
!:
    lda $D012
    cmp #TARGET_LINE + 1    // spin until the badline itself is done
    bne !-
    lda new_color
    sta $D020               // write lands in post-steal free cycles
    lda #NEXT_LINE
    sta $D012
    jmp $EA81               // PLA/TAY/PLA/TAX/PLA/RTI: entered through $0314, so the dispatcher pushed A, X, Y
```

The handler is installed at $0314/$0315 with the KERNAL in, which is why it exits through $EA81 (see `stable_raster_irq` in `docs/techniques/raster.md`, interrupt vector placement). An earlier version of this fence used an ACME local label (`.wait:`), `;` comments, and exited with `jmp ($0314)` — which from a handler installed at $0314 is an infinite loop; it did not assemble in KickAssembler.

### Why it works

VIC's AEC signal halts the CPU for 40 cycles during each badline. The steal window is fixed on all PAL and NTSC variants. By firing IRQs in the pre-steal or post-steal free windows, handlers have a known stable cycle budget. IRQ jitter (see `stable_raster_irq` in `docs/techniques/raster.md`) is absorbed by the polling loop; the 11-cycle pre-steal window (cycles 1-11; stores may also land on 12-14) is wide enough to contain worst-case jitter (an earlier version said 15 cycles).

### Variations

**Sprite fetch avoidance.** Active sprites steal additional cycles per line: 2 bus cycles of s-accesses per enabled sprite, plus a 3-cycle BA lead-in (write-only for the CPU) paid once per contiguous group of active sprite slots — up to 3 + 8 × 2 = 19 cycles per line with all eight on (measured in VICE x64sc: 105 / 399 / 210 cycles over the 21 DMA lines for one sprite / eight sprites / sprites 0+7, the last forming two BA groups; badline + eight sprites measured 40 + 19 = 59 stolen, 4 left). An earlier version of this page counted 4 cycles per sprite in two 2-cycle windows, which double-counts the single 2-cycle s-access window per sprite. Disable sprites on critical lines or account for their steal in the cycle budget.

**Blanking the display.** DEN ($D011 bit 4) is sampled once per frame, on raster line $30 (48): hold it clear across line $30 and that frame has no badlines at all, so every line gives the CPU 63 cycles (measured in VICE x64sc: a 14-cycle poll loop over lines 100-199 ran 450 iterations with DEN clear across $30 against 412 with DEN set). Clearing DEN later in the frame does not remove the remaining badlines of that frame — the same loop with DEN cleared at line 100 still ran 412 — so this is a per-frame choice for loaders and compute phases, not a per-line one; an earlier version of this page implied it worked mid-frame. Keep DEN clear across line 51 too if you want the border colour over the whole screen; clear on $30 but set again before 51 gives a badline-free frame whose window still opens on idle-state graphics (see `docs/hardware/vic-ii-reference.md`, $D011).

### Cycle budget

PAL per-raster-line budget:

| Line type | Total cycles | VIC-stolen | CPU-available |
|---|---|---|---|
| Non-badline (no sprites) | 63 | 0 | 63 |
| Badline (no sprites) | 63 | 40 (bus 15–54; BA low from 12, so 12–14 are write-only) | 20 (+3 write-only) |
| Non-badline (8 sprites active) | 63 | up to 19 (3 BA lead-in + 8 × 2) | ~44 |
| Badline (8 sprites active) | 63 | 40 + 19 | 4 (measured in VICE x64sc) |

Sprite rows are the all-eight figure on lines where the sprites are displayed; an earlier version of this table had 32 stolen per line for eight sprites (~31 / ~11-15 left), from the 4-cycles-per-sprite count corrected above.

A full-screen effect that runs IRQs on every visible line (200 lines) at a badline rate of 1 in 8 has: 175 non-badlines * 63 + 25 badlines * 20 = 11025 + 500 = 11525 CPU cycles available per frame for the effect work, before overhead. This is approximately 59% of the total frame cycles (11525 / 19656). An earlier version of this table and sum used 23 per badline, which counted the three BA-low cycles 12–14 as free; they are usable only by write cycles, as the prose above says.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; that recipe has a text logo, not a sprite, and its bars avoid badlines by choosing `BAR_START = 88` from an IRQ ring — not phase-inverted scheduling.)

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

**Sprite DMA steal:** Each enabled sprite steals 2 bus cycles per line (its s-accesses; the p-access is a phi1 access and costs the CPU nothing), plus a 3-cycle BA lead-in — write-only for the CPU — paid once per contiguous group of active sprite slots, so all eight together cost up to 3 + 8 × 2 = 19 cycles per line (measured in VICE x64sc: 105 / 399 / 210 cycles over the 21 DMA lines for one sprite / eight sprites / sprites 0+7 as two BA groups). An earlier version of this page said approximately 4 cycles per sprite in two 2-cycle windows, which double-counts the single 2-cycle window. The exact per-sprite slots are in `docs/hardware/vic-ii-reference.md`.

**Avoidance strategies:**

1. **Disable sprites on critical lines.** Write 0 to the relevant bits of $D015 on lines that need contiguous CPU cycle blocks. Re-enable on the following line.

2. **Blank the display on heavy-compute frames.** DEN ($D011 bit 4) held clear across raster line $30 removes every badline of that frame: full 63 cycles/line for the CPU. DEN is sampled only on line $30, so clearing it on a particular line does not free the badlines that follow in the same frame; use it for whole-frame compute or load phases, and use strategies 1, 3 and 4 for per-line scheduling. (An earlier version of this item was titled "on heavy-compute lines" and implied a mid-frame clear worked.)

3. **Sequence writes to non-stolen cycles.** Target IRQ handlers on non-badlines, schedule critical writes to cycles 1-11 or 55-63 (outside the steal window; 12-14 admit writes only), cycles numbered 1-63 as in `docs/hardware/vic-ii-reference.md` (an earlier version wrote 0-14 / 55-62). Requires stable-raster IRQ (see `docs/techniques/raster.md`).

4. **Put a write in the BA tail, not a read.** When BA drops (cycle 12 on a badline; three cycles before the first sprite's DMA) the CPU keeps running until its next read cycle and stops there; write cycles are never halted. So a store whose fetches are done by cycle 11 and whose write cycle lands on cycle 12 completes before the halt, and the halt then costs 41-42 cycles instead of 43 — one write cycle for STA/STX/STY, two for a read-modify-write (INC/DEC/ASL/LSR/ROL/ROR abs), three only for the interrupt push sequence. That is where the "23 versus 20 cycles" figure above comes from. Nothing is deferred and no write is free: an instruction whose read cycle meets BA low simply stretches by the whole steal (measured in VICE x64sc: an STA stream spanning a PAL badline loses 42 or 43 cycles, a NOP stream 43, an INC stream 41-43). An earlier version of this item said a store issued before a steal was "deferred until AEC goes high" at no cost and called it "lazy writes"; neither the mechanism nor the term has a source in this repo or in Bauer's article.

### Why it works

The 6510 and VIC-II share the address and data buses via the phi1/phi2 clock. During a DMA steal, VIC asserts AEC low, extending its bus control past the CPU's phi2 slot. The CPU withholds its bus transaction and retries on the next phi2. From software, the CPU's instruction timing stretches: an instruction that would take N cycles takes N + steal_cycles when a steal overlaps it. The total cycle count per line is always exactly 63 (PAL) — the CPU simply executes fewer instructions in those 63 cycles.

The authoritative per-cycle schedule is in Christian Bauer's "The MOS 6567/6569 video controller (VIC-II) and its application in the Commodore 64" (Project 64, 1996; widely reproduced on codebase64.org). That document contains the exact cycle-per-line table for PAL and NTSC, the sprite DMA scheduling formula, and the AEC signal diagram.

### Variations

**Open borders + steal avoidance.** Side border opening needs one `$D016` write per covered line whose store cycle is cycle 56 (PAL) — CSEL taken from 1 to 0 between the X=335 and X=344 border comparisons — and CSEL set back to 1 before cycle 55 of the next line; `$D011` (RSEL) governs the top/bottom border and is not involved. It is a one-cycle target, not a window, so the CPU must be cycle-exact on every line covered; sprite DMA on those lines shifts the CPU's position, which is why the recipe (`recipes/kickassembler/sideborder-open.md`) keeps the sprite set identical on every line of the region, or you disable sprites there. (An earlier version of this page said `$D016` and `$D011` writes within a 23-cycle window.)

**Sprite crunch.** Enable sprites only on the lines where they are displayed. A 24-sprite multiplexer that activates each sprite for exactly the lines it occupies has far lower steal overhead than one that leaves all 8 hardware sprites enabled across all 200 visible lines.

### Cycle budget

Total DMA steal per frame on a fully-featured PAL display (all borders open, 8 sprites active on all visible lines, character mode):

| Source | Steal cycles |
|---|---|
| Badlines (25 lines * 40 cycles) | 1000 |
| Sprite DMA (3 BA lead-in + 8 sprites * 2 cycles = 19 * 200 lines, upper bound) | 3800 |
| Total steal | ~4800 |
| Available CPU cycles per frame (63 * 312 = 19656 - 4800) | ~14856 |
| Available as % of frame | ~76% |

The sprite row is an upper bound: sprite DMA occurs only on lines where a sprite is displayed, and the 3-cycle lead-in is per contiguous group of active slots, so a sparse enable pattern can cost slightly more per sprite than the all-eight figure. An earlier version of this table counted 4 cycles per sprite in two 2-cycle windows (32 per line, 6400 per frame, ~62% available), which double-counts the single 2-cycle s-access window per sprite; the 19-per-line figure is measured in VICE x64sc (399 cycles over the 21 DMA lines of eight sprites).

A demo that disables sprites on 100 of the 200 visible lines recovers about 1900 steal cycles (an earlier version said 3200) — roughly a 13% improvement in usable CPU time. Combined with display blanking on heavy-compute segments, most C64 demo effects stay within budget by applying avoidance selectively on the lines where tight register writes are needed.

### Recipes

- `recipes/kickassembler/fli-image.md` (forces a badline on every line and lays its $D018/$D011 writes out around the 40-cycle steal; the opposite of avoidance, useful as the worked cost example)
- An earlier version of this list also named `recipes/kickassembler/sprite-multiplex-24.md` for per-line sprite enable/disable; that recipe writes `sta $d015` with all eight slots on for the whole frame.

## table_generation — Lookup-table generation at build time or at start-up

**Complexity:** low
**Region:** both
**Uses registers:** (none)
**Uses kernal:** (none)

### Why

A sine, a reciprocal or a product costs hundreds to thousands of cycles to compute on a 6510 and 4 cycles to read from a table. Almost every effect on this machine reads a table instead of computing. The question is where the table comes from: the assembler, the compiler, a generator that runs at start-up, or a file built on the host and embedded. Each has a different cost in bytes, in start-up time and in exactness, and the choice is rarely written down. The figures below were measured on this machine: KickAssembler 5.25, Oscar64 (build 2026-05-19), VICE x64sc 3.10.

### How

**KickAssembler builds the table at assembly time.** `.fill N, expr` evaluates `expr` once per entry with `i` running 0 to N-1 and emits the low byte. The scalings that matter:

```asm
// Sine tables at assembly time. Each expression is evaluated by the
// assembler; nothing runs on the C64.
.const AMP = 40
.const MID = 100

* = $2000
// Unsigned, 0..255 centred on 128, floor form: 128 + 127.5 * sin.
// Range 0..255, entry 64 is 255, entry 192 is 0.
sin_u8:     .fill 256, floor(128 + 127.5 * sin(toRadians(i * 360 / 256)))
// Unsigned, rounded, amplitude 127 about 128. Range 1..255, symmetric:
// entry 128+k is 256 minus entry k. Use this one when a quarter wave
// or an integer unfold must reproduce it exactly.
sin_r127:   .fill 256, 128 + round(127 * sin(toRadians(i * 360 / 256)))
// Signed two's complement, -127..127. Read with a signed add.
sin_s8:     .fill 256, round(127 * sin(toRadians(i * 360 / 256)))
// Arbitrary amplitude and offset: MID plus or minus AMP.
sin_a40:    .fill 256, round(MID + AMP * sin(toRadians(i * 360 / 256)))
// Quarter wave, 65 entries covering 0 to 90 degrees inclusive.
sin_q:      .fill 65, round(127 * sin(toRadians(i * 90 / 64)))
// 16-bit table split into a low page and a high page. The 65-byte
// sin_q in front of it is odd-sized, so realign or both halves
// straddle a page and every read with X >= $BF costs 5 cycles.
.align $100
sin_w:      .lohifill 256, round(1000 + 1000 * sin(toRadians(i * 360 / 256)))

// Reading them: X is the angle, 0..255 is one turn.
            ldx #$40
            lda sin_u8,x        // 255
            lda sin_w.lo,x      // low byte of 2000
            lda sin_w.hi,x      // high byte of 2000
            rts
```

The 256-entry form is the norm because the angle is then a byte that wraps by itself. The quarter-wave form saves 191 bytes and costs an unfold at start-up or a branch on every read (mirror the index for 90 to 180 degrees, negate the value for 180 to 360). `sine-scroller.md` and `cracktro-template.md` use the round form with an `AMPLITUDE` constant and no offset; `kickassembler-reference.md` documents `.fill` with the `127.5 + 127.5 * sin` form.

Rounding matters. `round()` behaved as `floor(x + 0.5)` in every table below, including the negative half of `sin_s8`; no entry fell on an exact half, so the tie rule is not established here. `floor()` on `128 + 127.5 * sin` gives the same bytes as a C `(char)` cast of the same expression, which truncates towards zero and is floor for a non-negative value. `.fill` wraps a value outside 0..255 without an error: `.fill 4, 254 + i` assembled to `$FE $FF $00 $01` (measured, KickAssembler 5.25). The `127.5 + 127.5 * sin` round form does not reach 256, because `sin(90 degrees)` evaluates to exactly 1.0 and the peak is 255 (measured; an earlier draft of this section assumed it wrapped).

**Oscar64 folds a table at compile time when the initialiser is constant.** `math.h` declares `sin` and `cos` as intrinsics (`#pragma intrinsic(sin)`, `math.h` line 33), and the preprocessor `#for(i,N) text` directive (Oscar64 manual, "Pre-Processor control") repeats a one-line template N times with `i` substituted. Together they put the table in the data segment with no floating point in the binary:

```c
#include <math.h>

// Unsigned, 0..255 centred on 128. (char) truncates towards zero; the
// value is never negative, so this is the floor form.
__export const char sin_u8[256] = {
#for(i,256) (char)(128 + 127.5 * sin(i * PI / 128)),
};
#pragma align(sin_u8, 256)

// Rounded, amplitude 127 about 128: add 0.5 before the cast.
__export const char sin_r127[256] = {
#for(i,256) (char)(128 + 127 * sin(i * PI / 128) + 0.5),
};

// Signed: round half away from zero on both sides.
__export const signed char sin_s8[256] = {
#for(i,256) (signed char)(127 * sin(i * PI / 128) + (i < 128 ? 0.5 : -0.5)),
};
```

Compiled with `oscar64 -tm=c64 -O2 -n` and an empty `main`, this gives a 1,025-byte PRG; the map file places `sin_u8` at `$0900` in `DATA:data` with the other two on the pages after it, and no `sin`, `crt_fmul` or `crt_fdiv` symbol is linked (measured). Two details cost a rebuild each. Without `__export`, a table nothing references is dropped by the linker and the PRG is 137 bytes. `#pragma align(name, 256)` page-aligns a table but must come after the declaration; before it the compiler reports `error 3005: Variable not found`. `PI` is `3.141592653` in `math.h`; a Python reference has to use that constant, not `math.pi`, although for these three tables both gave identical bytes. Not built by the listings gate: these fragments were compiled in scratch and their bytes diffed as described under Verification.

**What Oscar64 does not fold.** A start-up loop that calls `sin` is compiled as written. `samples/rasterirq/movingbars.c` and `samples/sprites/multiplexer.c` in the Oscar64 tree do this, and so does `sprite-multiplex-8.md` in this repo. The cost is the floating-point library plus the time: the loop below links `sin` (396 bytes), `crt_fmul`, `crt_fdiv` and `sint16_to_float`, and takes 3,739,920 cycles for 256 entries, about 14,600 per entry or 190 PAL frames, measured with a CIA1 timer A harness in VICE x64sc (harness below, base overhead of 54 cycles subtracted).

```c
void gen_float(char *t)
{
	for (int i = 0; i < 256; i++)
		t[i] = (char)(128 + 127.5 * sin(i * PI / 128));
}
```

**An integer start-up generator.** When the table has to live in RAM and 256 bytes of data is too much, unfold a quarter wave with integer arithmetic. It reproduces `sin_r127` exactly, because that scaling is symmetric by construction, and it links no floating point:

```c
// 65 entries, round(127 * sin(i * PI / 128)) for i = 0..64,
// generated by Python and embedded (or written as a #for initialiser).
static const char quarter[65] = {
#embed "quarter.bin"
};

void gen_int(char *t)
{
	for (char i = 0; i <= 64; i++)
	{
		char a = quarter[i];
		t[i] = 128 + a;
		t[(char)(128 - i)] = 128 + a;
		t[(char)(128 + i)] = 128 - a;
		t[(char)(256 - i)] = 128 - a;
	}
}
```

Measured cost: 5,190 cycles, about a quarter of a PAL frame, and a 65-byte table in place of 256. The `(char)` casts on the indices keep `256 - 0` at 0 rather than at 256.

**Embedding a host-built table.** `#embed "file"` (Oscar64 manual, "Embedding binary data") pastes a binary file into an initialiser; `#embed LIMIT SKIP "file"` takes a slice. A table Python wrote is then data, with no start-up cost and no dependence on the compiler's arithmetic. This is the pragmatic route for anything `#for` cannot express on one line, such as a curve that needs a loop to generate, and for tables shared with a KickAssembler build.

**Reciprocal table for the perspective divide.** `effects-vector-3d.md` projects with `screen_x = cx + (tx * FOCAL) / (tz + DEPTH_OFFSET)`. A division per point per frame is out of budget; a table indexed by depth turns it into a multiply, which `table_multiply_8x8` in `maths.md` does in 52 cycles. Store `FOCAL * 256 / (z + DEPTH)` rounded, and the projection becomes `(tx * recip[z]) >> 8`:

```asm
// Reciprocal table: recip[z] = round(FOCAL * 256 / (z + DEPTH)).
// DEPTH >= 1 keeps z = 0 off a divide by zero; FOCAL * 256 / DEPTH
// must be at most 255 or the entry wraps (128 * 256 / 160 = 204.8).
.const FOCAL = 128
.const DEPTH = 160

* = $2000
recip:      .fill 256, round(FOCAL * 256 / (i + DEPTH))

            ldx #0
            lda recip,x         // 205 at z = 0, 79 at z = 255
            rts
```

The `DEPTH = 160` here is chosen so that the 8-bit form holds, and it is not the value `effects-vector-3d.md` suggests. With the `DEPTH_OFFSET` of 4 to 8 that page quotes, an 8-bit reciprocal does not fit: `128 * 256 / 4` is 8,192 and the whole near range wraps. Either build the table 16-bit (`.lohifill 256, round(FOCAL * 256 / (i + DEPTH))`, read as low and high pages) or clamp the near range so the largest entry is at most 255.

An 8-bit reciprocal carries a rounding error of at most half a unit in 79 at the far end, about 0.6 % of the projected coordinate (arithmetic from the table's own values, not measured on screen). The multiply table itself is covered by `table_multiply_8x8` in `maths.md` and is not repeated here.

### Why it works

The assembler and the compiler evaluate the expression on the host with double precision and emit bytes; the 6510 never sees a float. That is why the two toolchains agree byte for byte with each other and with Python on every scaling above: all three round the same real number the same way, and the only decisions left are the cast (truncate or round) and the scaling. Oscar64's intrinsic declaration is what lets its constant folder treat `sin(constant)` as a constant; a call with a loop variable is not constant and is compiled against its 32-bit float library, which is where the 14,600 cycles per entry go.

The integer unfold works because a rounded, zero-offset sine is odd about 180 degrees and even about 90 degrees, so 65 values determine all 256. The floor form `128 + 127.5 * sin` is not symmetric once floored: entry 64 is 255, so the mirror rule `t[128 + k] = 256 - t[k]` would put 1 at entry 192, where the floored table has 0. That is why the unfold targets `sin_r127` and not `sin_u8`.

### Variations

**Cosine from the same table.** `cos(a) = sin(a + 64)` for a 256-entry turn; index with `(x + 64) & 255`, which a byte index does for free. `effects-vector-3d.md` describes the 512-entry form that avoids even the add.

**Two amplitudes from one table.** Store amplitude 127 and shift right for 63, 31, 15. For a signed table the shift must be arithmetic (`CMP #$80 : ROR`), and each shift loses a bit of precision; for non-power-of-two amplitudes build a second table.

**Screen row tables.** `.fill 25, <(SCREEN + i * 40)` and the `>` twin, or `.lohifill 25, SCREEN + i * 40`, give the row address split into pages; Oscar64's `#for(i,25) Screen + 40 * i,` in a pointer array does the same (Oscar64 manual example).

### Verification

Every table above was dumped from the built binary and compared with a table generated by stdlib Python; every comparison was zero differences.

KickAssembler: assemble with a symbol file, then slice the PRG at the label's address minus the load address.

```
java -jar KickAss.jar tables.asm -o tables.prg -symbolfile
grep sin_u8 tables.sym            # .label sin_u8=$2000
python3 -c "
import math,re
prg=open('tables.prg','rb').read(); load=prg[0]|prg[1]<<8
a=int(re.search(r'sin_u8=\\\$([0-9a-f]+)',open('tables.sym').read())[1],16)
got=prg[2+a-load:2+a-load+256]
ref=bytes(math.floor(128+127.5*math.sin(math.radians(i*360/256))) for i in range(256))
print(sum(1 for i in range(256) if got[i]!=ref[i]))"    # 0
```

Repeated for `sin_r127` (`128 + floor(127 * sin + 0.5)`), `sin_s8`, `sin_a40`, `sin_q` (65 entries), the `127.5 + 127.5` round form, the 512 bytes of `sin_w` and `recip`: 0, 0, 0, 0, 0, 0, 0 differences. `sin_q` is byte-identical to the 65-byte `quarter.bin` the Oscar64 generator embeds, and `sin_r127` is byte-identical to the 256-byte table that generator produces.

Oscar64: `-n` writes a `.map` beside the PRG with one line per symbol (`0900 (0100) : sin_u8, DATA:data`); slice the PRG at that address.

```
oscar64 -tm=c64 -O2 -n -o=fold.prg fold.c
grep sin_u8 fold.map | head -1    # 0900 - 0a00 : sin_u8, DATA:data
python3 -c "
import math
prg=open('fold.prg','rb').read(); load=prg[0]|prg[1]<<8
got=prg[2+0x900-load:2+0x900-load+256]
ref=bytes(int(128+127.5*math.sin(i*3.141592653/128)) for i in range(256))
print(sum(1 for i in range(256) if got[i]!=ref[i]))"    # 0
```

`sin_u8` from Oscar64 is byte-identical to `sin_u8` from KickAssembler, and the Oscar64 `sin_r127` and `sin_s8` folds matched Python with 0 differences each.

The runtime generators were checked on the C64 itself: a self-checking program folds each 256-byte table into a 16-bit checksum (`chk = ((chk ^ byte) * 5 + 1) & 0xffff`) and prints PASS against the value Python computed. The float loop, the integer unfold and the `#embed` copy all printed PASS in VICE x64sc (`$6A73` for the floor form, `$A15E` for `sin_r127`, twice). The timer harness in the same program: stop CIA1, load timer A and timer B with `$FFFF`, start B counting A underflows (`CRB = $51`) and A counting phi2 (`CRA = $11`), call the generator, stop A, and read `(0xFFFF - TB) << 16 | (0xFFFF - TA)`; an empty call measured 54 cycles and was subtracted. Interrupts were off for the measurement, since the KERNAL's jiffy IRQ runs on the same timer A.

### Cycle budget

| Method | Bytes in PRG | Start-up cycles (PAL frames) | Exact to Python |
|---|---|---|---|
| KickAssembler `.fill`, 256 entries | 256 | 0 | yes, 0 diffs |
| Oscar64 `#for` + `sin` in a const initialiser | 256 | 0 | yes, 0 diffs |
| Oscar64 `#embed` of a host-built file | 256 | 0 | by construction |
| Oscar64 integer quarter-wave unfold | 65 + code | 5,190 (0.26) | yes, checksum PASS |
| Oscar64 runtime `sin` loop | 256 bss + float library | 3,739,920 (190) | yes, checksum PASS |

Cycle figures are measured in VICE x64sc with the CIA harness above; the PAL frame is 19,656 cycles (63 x 312). A read from any of these tables is `LDA abs,X` at 4 cycles, 5 across a page boundary, which is why the KickAssembler tables sit at `* = $2000` and the Oscar64 one carries `#pragma align`; without the pragma the linker put `sin_u8` at `$0888` (measured). Placing the block on a page boundary is not enough on its own: each 256-byte table that follows is aligned only because the one before it is exactly 256 bytes. The 16-bit `sin_w` needs its own `.align $100` because the odd-sized 65-byte `sin_q` precedes it. Without the align it assembled to `$2441`, so its low half straddled `$2441` to `$2540` and its high half `$2541` to `$2640`, and every read with X at or above `$BF` crossed a page on both halves; with it, `sin_w` sits at `$2500` and its halves at `$2500` and `$2600` (measured from the symbol file of the page fragment, 0 diffs against Python at the new address). The align pads the gap with 191 bytes.

### Recipes

- `recipes/kickassembler/sine-scroller.md` (assembly-time `.fill` with `round()` and an `AMPLITUDE` constant)
- `recipes/kickassembler/cracktro-template.md` (the same form, plus `row_lo` / `row_hi` screen tables)
- `recipes/oscar64/sprite-multiplex-8.md` (fills `sinx` / `siny` at start-up with the float `sin` loop; the compile-time or integer forms above are the cheaper replacement)
- No recipe yet for the reciprocal table; `techniques/effects-vector-3d.md` describes the projection it serves.

## sine_table_generation — Building a sine table on the machine, with no table from the assembler

**Complexity:** medium
**Region:** both
**Uses registers:** (none)
**Uses kernal:** (none)
**Requires:** table_generation
**Cost:** bytes_code=221, bytes_data=256, zp_bytes=12
**Cost basis:** derived-listing

### Why

`table_generation` above gives a sine table three ways, and all three
come from the host: the assembler's `.fill`, the compiler's constant
folder, or a file. A program that must make its table in RAM has two
routes on that page, a float loop at 3,739,920 cycles or an integer
unfold that still embeds 65 host bytes. This entry is the third route:
compute the values on the 6510 with integer arithmetic, in a few frames,
close enough to the host table that a scroller or a sprite chain cannot
tell. It presupposes `table_generation`, whose scaling, symmetry and
verification it reuses; the Cost line is the quarter-wave route in the
recipe (its code from the symbol file, the 256-byte table it writes, and
zero page $02 to $0C and $11; the parabola's own two words at $0D to $10
are not counted), with no per-frame figure because the build runs
once. All cycle and error figures below were measured in VICE x64sc 3.10
by `recipes/kickassembler/sine-table-runtime.md`, which times each
generator with the CIA2 cascade and checks every entry against the
assembler's own `128 + round(127 * sin)`.

### How

**Quarter-wave symmetry, first.** A rounded sine of amplitude 127 about
128 is even about entry 64 and odd about entry 128, so 65 computed
values fix all 256: entry `128 - i` is entry `i`, and entries `128 + i`
and `256 - i` are `256 - entry i`. Whatever method makes the quarter,
generate 65 values and write four entries per value. The floor form
`128 + 127.5 * sin` is not symmetric once floored (`table_generation`,
Why it works), so a generated table targets the rounded scaling.

**Second-difference recurrence.** A sampled sine obeys
`y[n+1] = 2 y[n] - y[n-1] - d y[n]` with `d = 2 - 2 cos(2 pi / 256)`,
about `0.000602`. Keep the value `y` and its first difference `v` in
fixed point, and each step is `y += v` then `v -= d * y`. `d` is too
small for an 8-bit multiplier, but it is a sum of powers of two:
`2^-11 + 2^-14 + 2^-15 + 2^-16 + 2^-17` is `0.00060272`, 0.06 % over the
true value (arithmetic), and each term is an arithmetic shift of the one
before. The amplitude and the phase are set by the two starting values
alone: `y[0] = 0` and `v[0] = A * sin(2 pi / 256)`, a single constant the
assembler or compiler folds (`round(127 * sin(toRadians(360 / 256)) *
65536)` is 204,258 in 8.16); `A * 2 pi / 256` is within 0.1 % of it
(arithmetic) for a build that will not evaluate a sine at all.

```asm
// One step of the recurrence in 8.16 fixed point. y and v are 24-bit
// signed in zero page; the byte for this entry is taken before the
// state advances. d * y is five arithmetic shifts, each of the last.
.const y = $02
.const v = $05
.const a = $08
.const t = $0a
.const o = $11

* = $2000
step:
    lda y+1                      // 128 + round(y): carry = bit 15
    asl
    lda y+2
    adc #0
    eor #$80
    sta o
    clc                          // y += v
    lda y
    adc v
    sta y
    lda y+1
    adc v+1
    sta y+1
    lda y+2
    adc v+2
    sta y+2
    lda y+1                      // a = y >> 11: drop a byte, shift 3
    sta a
    lda y+2
    sta a+1
    jsr asr3
    lda a                        // t = y >> 11
    sta t
    lda a+1
    sta t+1
    jsr asr3                     // + y >> 14
    jsr addt
    jsr asr1                     // + y >> 15
    jsr addt
    jsr asr1                     // + y >> 16
    jsr addt
    jsr asr1                     // + y >> 17
    jsr addt
    sec                          // v -= t, sign-extended
    lda v
    sbc t
    sta v
    lda v+1
    sbc t+1
    sta v+1
    ldy #0
    lda t+1
    bpl !+
    dey
!:  sty t+1
    lda v+2
    sbc t+1
    sta v+2
    lda o
    rts

asr3:
    jsr asr1
    jsr asr1
asr1:                            // 16-bit arithmetic shift right of a
    lda a+1
    cmp #$80
    ror a+1
    ror a
    rts

addt:                            // t += a
    clc
    lda t
    adc a
    sta t
    lda t+1
    adc a+1
    sta t+1
    rts
```

Run for 256 steps this gives a table within one unit of the host's
everywhere, off by one in 21 entries, in 129,190 cycles (505 a step, 6.6
PAL frames). Run for 65 steps and unfolded, it is off by one in 4
entries and costs 38,067 cycles, 1.9 frames.

**Parabola.** `p(i) = i * (128 - i)` for `i` 0 to 127 has a constant
second difference, so a half wave is two 16-bit additions per entry:
the first difference starts at 127 and falls by 2. Scale to amplitude
127 with `p - p / 128`, add 16, shift right five times, and mirror the
half. It costs 25,266 cycles for 256 entries, 99 an entry, and it is a
parabola: 8 units from the sine at worst, near the zero crossings, and
3.8 on average. Good enough for a bounce; visibly wrong under a scroller
that reads it every pixel.

**Amplitude and offset.** For a sprite Y or a scroll position the table
wants `MID + AMP * sin`, not `128 + 127 * sin`. Three ways, cheapest
first. Generate at the amplitude: the recurrence's `v[0]` is
`AMP * sin(2 pi / 256)`, so a different `AMP` is a different constant,
and the `eor #$80` that turns the signed byte into `128 + y` becomes
`clc : adc #MID` for any offset (the recipe's sprites take the third
way instead: read the 127 table, `lsr` for amplitude 63, `adc #100` for
the offset, 6 cycles a read). Shift a signed table right for 63, 31, 15
(`table_generation`, Variations). Or multiply on the way out with
`table_multiply_8x8` from `maths.md` for an amplitude that is not a
power of two. Whichever way, check the range: an offset plus amplitude
past 255 wraps silently in a byte table.

### Why it works

The recurrence is exact for a sine when `d` is exact and the arithmetic
is; its two errors are the approximation of `d`, which is a frequency
error of 0.03 % and shows as a phase drift, and the floor in each
arithmetic shift, which under-corrects `v` by a fraction of its last bit
per step and grows into `y` as the square of the step count. Sixteen
fraction bits keep both under a unit for one turn (arithmetic bound;
measured, 21 entries off by one). The quarter-wave form is more accurate
than the full turn because the drift has 64 steps to grow in rather
than 256, and the unfold copies the good early values into the second
half instead of computing it last.

The drift is the reason not to run the recurrence as an oscillator
across frames: on the host, the same integer algorithm reaches a worst
error of 2 units in the fifth turn and 267 units summed over the eighth
(Python, not run on the machine). Generate once and stop, or reset the
state each turn.

### Variations

**Bhaskara's rational approximation.** `16 x (pi - x) / (5 pi^2 - 4 x
(pi - x))` for `x` in 0 to pi is within one unit of a rounded 127-sine
over the whole half wave (host arithmetic, not run on the machine). It
needs a 16-bit divide per entry, which is why the recurrence is the
usual choice on a 6510; it earns its place where a table must be exact
from a cold start with no drift at all.

**Cosine and phase.** Start the recurrence at `y[0] = A`, `v[0] = A *
(cos(2 pi / 256) - 1)` for a cosine, or index the sine table with
`(x + 64) & 255`, which a byte index does for free.

**A second harmonic.** A second table at twice the frequency is the same
recurrence with `d = 2 - 2 cos(4 pi / 256)`, about 0.002409, which is
the shifts `2^-9 + 2^-12 + 2^-13 + 2^-14 + 2^-15` (arithmetic, not built
here); adding the two tables entry by entry gives the breathing wave
`scroll.md` describes under `sine_scroller`.

### Cycle budget

The build runs once, so it has no per-frame cost. Measured for 256
entries in VICE x64sc with the CIA2 cascade, screen blanked: parabola
25,266 cycles, quarter-wave recurrence 38,067, full-turn recurrence
129,190. With the screen on, every badline in the build's span adds its
40 to 43 stolen cycles; a 38,067-cycle build that starts at the top of
the display crosses about two frames' worth of them. The float loop in
`table_generation` is 3,739,920 for the same table, the host-table
unfold 5,190.

### Recipes

- `recipes/kickassembler/sine-table-runtime.md` (all three generators
  timed and checked on screen against the assembler's table, then eight
  sprites on the quarter-wave table)

---

## speedcode_generation — Generating unrolled code into RAM at run time

**Complexity:** medium
**Region:** both
**Uses registers:** (none)
**Uses kernal:** (none)
**Cost:** cycles_per_frame=8000, bytes_code=849, bytes_data=1185
**Cost basis:** derived-listing

The figures on the Cost line are for the recipe's job, a 1,000-byte copy:
8,000 cycles each time the generated code runs, measured, and the PRG's
own segment read off the listing, 849 bytes of generator and harness code
and 1,185 bytes of row tables, source block and text. The 6,001-byte
block the generator fills is RAM, not load, so it is not on the line; it
scales with the byte count, as the cycle figure does, and belongs in the
memory plan. The generation itself runs once and is not on the line
either; it is 92,485 cycles for that job, measured.

### Why

`unrolled_loops` removes the loop overhead by having the assembler
replicate the body, and pays for it in bytes of PRG: a fully unrolled
1,000-byte copy is 6,000 bytes on disk and in the load. `self_modifying_code`
patches an operand inside code that already exists. Speedcode generation
is the run-time form of the first, built with the mechanism of the
second: a short generator writes the whole unrolled instruction stream
into RAM from tables when the program starts, or when a part starts, so
the load carries a 90-byte generator and four small tables instead of
6 KB of straight-line code. It is `table_generation` for code rather than
data: the same trade of start-up cycles for bytes in the file, and the
same choice of when to pay.

### How

The generator knows the opcode bytes and writes them itself. `LDA abs` is
`$AD lo hi`, `STA abs` is `$8D lo hi`, `LDA #imm` is `$A9 imm`, and the
stream ends with `RTS`, `$60`. For a copy, each byte moved is one
`LDA abs / STA abs` pair, six bytes of code; for a fill, `LDA #imm` once
and then `STA abs` per byte, three bytes each. The source and destination
addresses come from tables, typically one low and one high byte per row,
and the generator increments a working copy of each address as it emits:

```asm
// Emit COLS pairs of LDA abs / STA abs for one row. out is a zero-page
// pointer to the next free byte of the code block; cur_src and cur_dst
// were loaded from the row tables. Y counts bytes of code, so one row of
// 40 pairs is Y = 0..239, so the pointer advances by 240 per row.
.const OP_LDA_ABS = $ad
.const OP_STA_ABS = $8d
.const COLS = 40
.const out = $fb
        ldy #$00
pair:   lda #OP_LDA_ABS
        sta (out),y
        iny
        lda cur_src
        sta (out),y
        iny
        lda cur_src+1
        sta (out),y
        iny
        lda #OP_STA_ABS
        sta (out),y
        iny
        lda cur_dst
        sta (out),y
        iny
        lda cur_dst+1
        sta (out),y
        iny
        inc cur_src
        bne !+
        inc cur_src+1
!:      inc cur_dst
        bne !+
        inc cur_dst+1
!:      cpy #COLS * 6
        bne pair
        rts
cur_src: .word $0c18
cur_dst: .word $4000
```

The size is fixed before the generator runs: bytes per emitted unit times
the count, plus one for the `RTS`. A 1,000-byte copy is 1,000 × 6 + 1 =
6,001 bytes; a 1,000-byte fill is 2 + 1,000 × 3 + 1 = 3,003. That number
goes in the memory plan next to the charset and the screen, because
nothing else will check it. In the recipe the block is at `$5000` and the
`RTS` was read back at `$6770` over the monitor.

Generated code is called like any subroutine. The pairs read and write
with absolute addressing, so there is no index register to set up and no
page-crossing penalty on the reads: `LDA abs` is 4 cycles at any address,
where `LDA abs,X` is 5 when the sum crosses a page.

### Why it works

The 6510 fetches every instruction from memory with no cache, so bytes
written by `STA (zp),Y` are the instruction stream the moment the CPU
reaches them; this is the same property `self_modifying_code` rests on.
The generated stream has no loop counter, no compare and no branch, so
its cost is exactly the sum of its instructions. Measured with a CIA2
timer in VICE x64sc 3.10 (recipe below, harness overhead subtracted):

| Job: copy 1,000 bytes | Cycles | Per byte |
|---|---|---|
| Generated `LDA abs / STA abs` stream | 8,000 | 8.0 |
| Indexed loop, `LDA abs,X / STA abs,X`, four 250-byte strides | 10,787 | 10.8 |
| Generating the stream, once | 92,485 | 92.5 per pair |

8,000 is the arithmetic (4 + 4 per pair) and the loop count is too: 2 for
the `LDX`, 250 iterations of 43 less the final untaken branch, plus 36
cycles of page crossings on the reads, which move when the source block
moves. The generated code is 1.35 times the speed of a loop that is
already partly unrolled; against a naive `(zp),Y` loop the ratio is
larger, not measured here. The generator costs about 11.6 runs of the
code it generates, so it pays back after a dozen copies.

The measurement was taken with the screen blanked (DEN cleared and a
frame waited out). A CIA timer counts phi2 whether or not the CPU has the
bus, so 8,000 cycles of generated code running across the display take
8,000 plus 40 to 43 for every badline they cross, and a plan that
schedules them by the measured figure is short by that much;
`badline_cycle_loss` in `pitfalls/raster-and-badline.md`.

### When to generate

**Once at init.** The common case: the code depends only on constants
(a fixed source, a fixed screen) and is generated before the first frame.
The 92,485 cycles are under five PAL frames and invisible behind a
blanked screen or a loading picture.

**Per part.** A demo whose parts want different speedcode regenerates
between them, into the same block. The generator is small enough to keep
resident; the block is reused, so the memory plan holds one block, not
one per part.

**Per frame.** When the code itself has to move, for example a copy whose
source row shifts each frame for a scroll, or a plot whose addresses come
from this frame's sine positions, the generator runs every frame and its
cost joins the frame budget. At 92.5 cycles per emitted pair that is
affordable for tens or hundreds of pairs, not thousands; beyond that,
generate once and patch the operands that change (`self_modifying_code`),
or keep the addresses in tables and index them.

### Variations

**Generated with page-crossing avoided.** Straight-line `LDA abs / STA
abs` has no page-crossing cost, so the recipe's stream needs nothing. A
generator that emits indexed reads (`LDA abs,X`, `$BD`) or branches to
tie sections together does, and then it can choose the bases and the
section lengths so no read crosses a page, or align each section's start;
`branch_page_cross_extra_cycle` in `pitfalls/cpu.md` is the branch case
and does not arise in a stream with no branches.

**Generated into a bank the VIC does not see.** The recipe's block at
`$5000` to `$6770` is in VIC bank 1, which a stock machine never
displays, so 6 KB of code costs no screen, charset or sprite space.
The ROM windows at `$A000` to `$BFFF` (inside bank 2) and `$E000` to
`$FFFF` (inside bank 3) give another 8 KB each, but sit under BASIC and
the KERNAL: the generator's writes land in the
RAM and the CPU fetches the ROM until `$01` banks it out, and then the
KERNAL's interrupt vectors and `CHROUT` are gone too;
`ram_under_rom_traps` in `pitfalls/banking.md`.

**STA-only sequences from a value table.** For a fill, or a screen whose
contents are known at generation time, emit `LDA #imm` (`$A9 v`) only
when the value changes and `STA abs` for every address: a run of equal
bytes costs 4 cycles a byte instead of 8 and 3 bytes instead of 6. The
generator reads the values from a table beside the addresses and
compares each with the last one loaded. The result is a routine that
paints a fixed picture at 4 cycles a byte with no source buffer at all.

### Cycle budget

Per byte moved, at any address: `LDA abs` 4 + `STA abs` 4 = 8 cycles,
measured as 8,000 for 1,000. A full 1,000-byte screen copy is therefore
8,000 cycles, about 127 PAL raster lines, and longer than the PAL
vertical blank of about 7,100 cycles between line 250 and the next
frame's first badline (`recipes/kickassembler/sine-scroller.md`), so a
per-frame full-screen speedcopy run from a raster interrupt at the
bottom of the display finishes some 14 lines into the next frame's
top rows, and with badlines inside those rows later still;
`full_field_redraw_exceeds_vblank` in `pitfalls/text-mode-render.md`.
Split the copy across two interrupts, copy fewer rows, or write the top
rows first so the VIC fetches finished cells. Generation: 92.5 cycles
per emitted pair with the generator above, which is about 68 cycles of
six `STA (zp),Y` stores with their loads and increments plus the
address and loop bookkeeping; 1,000 pairs are 4.7 PAL frames.

### Recipes

- `recipes/kickassembler/speedcode-generator.md` (generates a 1,000-byte copy from row tables, verifies it and times it against the indexed loop; the three figures above)

---

## nmi_handler_and_restore_key — Installing an NMI handler, and what to do about RESTORE

**Complexity:** low
**Region:** both
**Uses registers:** DD04, DD05, DD0D, DD0E
**Cost:** cycles_per_frame=20
**Cost basis:** measured-vice

### Why

Two things reach the 6510's `/NMI` pin: CIA2's interrupt output and the
RESTORE key. `SEI` masks neither. A program that does nothing about the
vector leaves the KERNAL's handler in charge, and that handler treats a
RESTORE press with RUN/STOP held as a request to warm-start BASIC over
whatever is running. A program that takes the vector and gets the
acknowledge wrong either loses every later NMI or, in the other
direction, throws away a timer event it wanted. This entry is the
minimal correct handler for each case: RESTORE disarmed, a CIA2 timer
tick taken on purpose, and the two together.

### How

**The vector.** With the KERNAL ROM mapped in, an NMI goes through
`$FFFA` to `$FE43`, which is `SEI` and then `JMP ($0318)`. Nothing is
pushed there, so the RAM vector at `$0318`/`$0319` is the whole
dispatch from its second instruction on, and a handler installed there
gets control with A, X and Y untouched. With the KERNAL banked out
(`$01` bit 1 clear) the CPU reads `$FFFA`/`$FFFB` from RAM and the
handler's address goes there instead; `memory_layout_plan` in
`techniques/memory-banking.md` covers the all-RAM layout.

**What the KERNAL's handler does.** The default `$0318` target is
`$FE47`. It pushes A, X and Y, writes `$7F` to `$DD0D` and reads it
back. If a CIA2 flag was set it runs the RS-232 code. If none was, it
takes the NMI to be a RESTORE press: it checks for a cartridge at
`$8000`, samples the keyboard for RUN/STOP, and if that key is down runs
RESTOR, IOINIT and CINT and jumps through `$A002`, the BASIC warm start,
which puts `$0314` back to `$EA31` and the VIC back to text mode at
`$0400`. RESTORE alone returns through `$FEBC`, having spent 189 cycles
at an arbitrary point in the frame. The bytes and the cycle count are
in `pitfalls/kernal-and-io.md`, `restore_nmi_not_maskable`, and
`hardware/cia-reference.md`, "NMI vector (CIA2 + RESTORE)".

**Disarming RESTORE.** Point `$0318` at an `RTI`. Nothing about the key
passes through CIA2, so no value written to `$DD0D` can mask it; the
vector is the only software answer.

```asm
// Disarm RESTORE: the smallest complete NMI handler.
install:
        sei
        lda #<nmi_stub
        sta $0318
        lda #>nmi_stub
        sta $0319
        cli
        rts

nmi_stub:
        rti
```

**Acknowledging a CIA2 NMI.** The CIA drops its interrupt output only
when its interrupt control register is read. A handler for a CIA2 source
reads `$DD0D` before `RTI`; `BIT $DD0D` does it without disturbing A, and
`RTI` restores the flags `BIT` changed.

```asm
// Count a CIA2 timer tick and acknowledge it.
nmi_tick:
        inc tick_count
        bit $dd0d               // clears the flag; /NMI returns high
        rti

tick_count:
        .byte $00
```

**The NMI lock.** A handler that never reads `$DD0D` leaves the flag
standing, `/NMI` stays low, and because the 6510 takes an NMI on the
falling edge only, no further NMI is taken from any source, RESTORE
included, until something reads `$DD0D`. That is a second way to kill
RESTORE, at the price of every CIA2 interrupt, and it is also the
commonest way to break an NMI-driven player by accident.

**A timer tick on purpose.** Latch CIA2 Timer A with the period less
one, set bit 0 of `$DD0D` with bit 7 (`$81`) so the underflow drives
`/NMI`, and start the timer in continuous mode (`$11` to `$DD0E`). The
tick then arrives every latch + 1 cycles regardless of the raster, which
is what a sample player or a music driver that must not depend on a
raster interrupt needs. A RESTORE press then reaches the same handler
as one extra, early entry; a handler that must not act on it tests bit 7
of `$DD0D` first, since a press sets no CIA2 flag.

```asm
// A tick every 10,000 cycles through nmi_tick above.
arm_tick:
        lda #<9999
        sta $dd04
        lda #>9999
        sta $dd05
        lda #$81                // set: Timer A underflow -> /NMI
        sta $dd0d
        lda #$11                // start, force load, continuous
        sta $dd0e
        rts
```

### Why it works

The 6510's NMI input is edge-sensitive: the interrupt sequence starts on
the high-to-low transition of `/NMI`, and a line that then stays low is
not sampled again. CIA2 holds its output low while any enabled flag in
`$DD0D` is set, and a read of `$DD0D` clears all flags at once. So the
read is both the acknowledge and the re-arm, and its absence is the
lock. The key is wired to the pin in parallel with the CIA, not through
it, which is why it cannot be masked in `$DD0D` and why the KERNAL's
handler recognises it by finding no flag.

Measured in VICE x64sc 3.10, PAL and NTSC alike (the recipe below): with
a tick every 10,000 cycles and a window of 1,005,000 cycles, the
acknowledging handler was entered 100 times; the same tick with a
handler that never read `$DD0D` was entered once; and one `LDA $DD0D`
from the main loop, with the timer still running, produced exactly one
more entry.

### Variations

- **Vector and lock together.** A game with no CIA2 use can take both:
  the `RTI` stub at `$0318` and a one-shot NMI left unacknowledged. The
  stub alone is enough and costs nothing while the key is up.
- **Chaining.** `JMP $FE47` at the end of a handler hands the NMI on to
  the KERNAL, and a CIA2 flag the handler already cleared makes the
  KERNAL treat it as RESTORE; clear the flag only when you mean to
  drop the RS-232 path.
- **Arithmetic in the handler.** The NMI path executes no `CLD`; a
  handler that uses `ADC` or `SBC` clears D on entry
  (`decimal_mode_pitfalls`).
- **KERNAL out.** Put the handler's address at `$FFFA`/`$FFFB` in RAM
  and skip `$0318`; `$FE43` is not there to run its `SEI`, so the
  handler is entered with I as the interrupted code left it.

### Cycle budget

The `RTI` stub costs 20 cycles per press: the NMI sequence (7), the
`SEI` at `$FE43` (2), the `JMP ($0318)` (5) and the `RTI` (6), measured
in VICE x64sc 3.10 as CIA1 Timer A across a 400-cycle block of `NOP`s
with the NMI taken minus the same block with it masked, on PAL and
NTSC. The count-and-acknowledge handler above costs 30 by the same
measurement: 20 plus `INC abs` (6) and `BIT abs` (4). A tick every
10,000 cycles is 1.97 entries per PAL frame, 59 cycles a frame for the
30-cycle handler (arithmetic); a sample player at 8 kHz on PAL is one
entry every 123 cycles, and its handler's cost is the player's, not
this entry's. The `Cost` line above is the stub's: one press in the
worst frame.

### Recipes

- `recipes/kickassembler/nmi-timer-tick.md` (the stub, the acknowledging handler, the lock and the unlock, with the counts and the two costs above; CIA2 Timer A stands in for the key, which a headless run cannot press)
