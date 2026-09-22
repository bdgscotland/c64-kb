---
category: cpu
---

<!-- doc-type: pitfall-reference -->

# CPU Pitfalls

Three pitfalls in this document. Each concerns 6510 behavior that is locally
correct but globally surprising: a branch cycle count that changes with binary
placement, illegal opcodes that disappear on CMOS silicon, and an indirect-jump
address fetch that wraps at page boundaries. All three have caused cycle-tight
and portable C64 code to fail in production.

---

## branch_page_cross_extra_cycle — Conditional branch costs +1 cycle when crossing a page boundary

**Severity:** high
**Region:** both
**Triggered by techniques:** stable_raster_irq, self_modifying_code, unrolled_loops

### Symptom

Cycle-counted raster IRQ code drifts by exactly one cycle depending on where
the linker places the assembled output. Color bars that were pixel-perfect in
development land on the wrong line in the final build. A stable-raster handler
that was verified working at $2000 breaks when the code is relocated to $2FF0
and a branch straddles the $3000 boundary. The symptom is a one-cycle jitter
that is completely reproducible — it is not random, it just changes with the
binary's load address.

### Mechanism

All conditional branches on the 6510 — BCC, BCS, BEQ, BMI, BNE, BPL, BVC,
BVS — use the relative addressing mode. The branch instruction is 2 bytes
(opcode + signed displacement). Cycle cost follows three cases:

| Outcome | Cycles |
|---------|--------|
| Branch not taken | 2 |
| Branch taken, target on same page as the instruction after the branch | 3 |
| Branch taken, target on a different page than the instruction after the branch | 4 |

The "page" check compares the high byte of `PC + 2` (where the CPU is after
fetching the 2-byte branch instruction) with the high byte of the branch target.
If they differ, the CPU performs an extra internal cycle to fix up the high byte
of the program counter — a "page-crossing penalty."

For code that does not need cycle precision, this is irrelevant — one extra
cycle out of thousands is noise. For stable-raster IRQ handlers, per-line
raster effects, or sprite multiplexers where the cycle budget per scanline is
counted in single digits, a one-cycle slip means the write to `$D020` or
`$D001` lands on the wrong scanline. Because the penalty depends on the
branch target's page rather than any runtime value, the same source assembles
to different cycle counts depending on the `.o` file's placement in the binary.

The pitfall is most acute in routines that loop across page boundaries. A
`BNE loop` at `$20FD` branching back into `$20xx` costs 3 cycles. The
identical instruction at `$20FF` branching to the same target costs 4 cycles
because `$20FF + 2 = $2101`, whose high byte differs from `$20xx`.

### Fix

**Alignment.** The standard fix for KickAssembler is a `.align $100` directive
before the branch target. This forces the target to the start of the next
page, guaranteeing that the branch and its target share the same high byte for
any branch instruction within the first 127 bytes of that page:

```kick
.align $100         // force raster_loop to $xx00
raster_loop:
    lda $d012       // 4 cycles (absolute read)
    cmp #TARGET     // 2 cycles
    bne raster_loop // 3 cycles — same page guaranteed by .align
```

**Eliminate the branch.** Branchless equivalents remove the variable entirely.
Tight polling loops can be replaced with NOP chains (`NOP` = 2 cycles;
undocumented single-byte NOPs $1A/$3A/$5A also = 2 cycles) or the `BIT $abs`
skip trick. A spin-wait with `DEC zp / BNE` that straddles a page boundary
can be replaced with an unrolled NOP sequence calibrated at link time.

**Empirical rule for stable raster IRQs.** Place the entire timing-critical
section in a 256-byte aligned region using `.align $100`. The section must be
under 128 bytes to ensure branches stay on-page. Verify the final cycle count
in VICE x64sc using the `cpuhistory` monitor command.

### Worked example

```kick
// BAD: branch target may or may not be on the same page as the BNE
// Cycle cost of BNE depends on the binary's load address — unpredictable.

stable_raster_entry:
    pha
    txa
    pha
    tya
    pha

    // Double-IRQ jitter removal loop
    // If this loop straddles a page boundary, the BNE costs 4 cycles on
    // some runs and 3 on others — raster hits the wrong line.
jitter_loop:
    lda $d012           // 4 cycles
    cmp #TARGET_LINE    // 2 cycles
    bne jitter_loop     // 3 OR 4 cycles — page-dependent

    lda #BLACK
    sta $d020           // Lands on wrong line if BNE cost was 4 not 3


// GOOD: force both jitter_loop and the BNE target to the same page.

.align $100
stable_raster_entry_fixed:
    pha
    txa
    pha
    tya
    pha

jitter_loop_fixed:
    lda $d012           // 4 cycles
    cmp #TARGET_LINE    // 2 cycles
    bne jitter_loop_fixed // Always 3 cycles — same page guaranteed

    lda #BLACK
    sta $d020           // Arrives on the correct scanline, every time
```

### Cross-references

- Technique `stable_raster_irq` (`docs/techniques/raster.md`) — the double-IRQ
  jitter removal loop where this pitfall most commonly strikes
- Technique `self_modifying_code` (`docs/techniques/cpu-cycle-tricks.md`) —
  SMC blocks with tight backward branches need page-aligned placement
- Technique `unrolled_loops` (`docs/techniques/cpu-cycle-tricks.md`) — remaining
  loop-exit branches must be checked for page-crossing after unrolling
- Register `D012` — the raster compare register read in every polling loop

---

## illegal_opcode_portability — Illegal opcodes behave correctly on NMOS 6510 but break on CMOS and SuperCPU targets

**Severity:** medium
**Region:** both
**Triggered by techniques:** illegal_opcode_tricks

### Symptom

Code using LAX, SAX, AXS, ALR, ARR, DCP, or the RMW family works perfectly on
real C64 hardware and under VICE. The same code loaded into a SuperCPU-equipped
machine executes differently or hangs. A sim6502 unit test in strict CMOS mode
fails on every illegal opcode. An assembler targeting a 65C02 silently treats
each illegal opcode byte as a NOP — the routine produces garbage with no error.
The assumption that the target CPU is NMOS was never documented.

### Mechanism

Illegal opcodes arise from the NMOS 6502 decode matrix. Each opcode byte selects
a column (addressing mode) and a row (operation). The "illegal" cells are
undefined combinations where two operation strobes activate simultaneously —
producing fused instructions that the MOS engineers never designed but that the
silicon executes deterministically. The safe tier (LAX, SAX, ANC, ALR, ARR,
AXS, DCP, ISC, SLO, RLA, SRE, RRA) is consistent across every NMOS 6502 and
6510 ever manufactured.

The portability boundary is the NMOS / CMOS divide:

**65C02 (CMOS revision):** All undefined opcode slots were deliberately filled
with explicit NOPs of varying byte lengths and cycle counts. The decode matrix
was redesigned. Code that emits $A7 (LAX zero-page) on a 65C02 executes a
2-cycle 2-byte NOP — the instruction is consumed silently, A and X are
unchanged, and the program continues from the wrong state. On the 6510, $A7
executes `A = X = M[zp]` — a completely different side effect.

**65816 (WDC 16-bit extension, used in SuperCPU):** The SuperCPU accelerator for
the C64 fits a 65816 CPU and runs C64 code in emulation mode. The 65816 does not
implement NMOS illegal opcodes. Code that runs identically on 6510 and 8500 will
misbehave on SuperCPU.

**8500 (late C64 and C64C):** The 8500 is the same NMOS microarchitecture as the
6510, shrunk to a smaller process. The safe illegal opcodes behave identically
to the 6510. This part is fine.

**VICE default mode (x64sc):** VICE in its default cycle-exact mode (x64sc)
implements the safe NMOS illegal opcodes faithfully. Development under VICE is
not sufficient to catch CMOS portability issues — VICE matches the real 6510.

**sim6502:** Behavior depends on the configuration. sim6502 may run in either
NMOS or strict mode. Code that relies on illegal opcodes must be tested under the
same configuration that the project ships for.

The second portability concern is the **unstable tier:** XAA (ANE), LAX #imm
($AB), AHX, TAS, SHX, SHY. These involve a floating internal bus whose value
varies by chip revision and thermal state. They must never appear in shipping
code.

| Opcode | NMOS 6510 | 65C02 / SuperCPU | Notes |
|--------|-----------|------------------|-------|
| LAX zp | A=X=M | NOP | Safe NMOS only |
| SAX zp | M=A&X | NOP | Safe NMOS only |
| ALR #imm | A=(A&imm)>>1 | NOP | Safe NMOS only |
| ARR #imm | A=ROR(A&imm) quirky flags | NOP | Safe NMOS only |
| AXS #imm | X=(A&X)-imm | NOP | Safe NMOS only |
| DCP zp | M--; CMP A,M | NOP | Safe NMOS only |
| SLO/RLA/SRE/RRA | RMW+combine | NOP | Safe NMOS only |
| XAA #imm | unstable | NOP | **NEVER USE** |
| LAX #imm | unstable | NOP | **NEVER USE** |

### Fix

**Document the dependency.** At minimum, add a file-level comment to any source
file that uses illegal opcodes. The comment should state which opcodes are used,
why, and that the code requires a stock C64 NMOS 6510 or 8500 CPU:

```kick
// This file uses LAX ($A7), DCP ($C7), and SLO ($07) for cycle savings
// in the sprite multiplexer inner loop. These are NMOS-only opcodes.
// They work on: 6510 (C64), 8500 (C64C), 8502 (C128 native mode).
// They do NOT work on: SuperCPU (65816), any CMOS board, 65C02.
// Verify under x64sc (VICE) before shipping. Do not run in sim6502 strict mode.
```

**Verify in the target emulator.** If the project uses sim6502 for unit tests,
confirm that the sim6502 configuration matches NMOS behavior. If it does not,
either add a separate test harness for the illegal-opcode routines that runs
under VICE, or provide legal fallback paths for the test environment.

**Replace with legal equivalents when portability matters.** The cost is 1–3
extra cycles and 1–2 extra bytes per site. See `illegal_opcode_tricks` in
`cpu-cycle-tricks.md` for the equivalent legal sequence for each opcode.

### Worked example

```kick
// BAD: uses LAX and DCP without documentation
// Works on real C64 and VICE. Silently produces wrong output on SuperCPU.

multiplex_loop:
    lax sprite_y,y      // A = X = sprite_y[y] — NMOS only ($B7: LAX zp,Y; there is no zp,X form)
    dcp compare_y       // compare_y-- ; cmp A, new compare_y — NMOS only ($C7: DCP zp)
    bcc multiplex_done
    iny
    bne multiplex_loop

multiplex_done:
    sty active_sprites


// GOOD: same logic with documentation and legal fallback comments

// NMOS-ONLY section: LAX ($B7 zp,Y) and DCP ($D7 zp,X) used for cycle savings.
// Tested on: 6510 (real HW), 8500 (real HW), VICE x64sc PAL.
// NOT portable to 65C02 or 65816/SuperCPU.
.macro LAX_ZPY(addr) { .byte $b7, addr }   // assembler won't accept LAX zp,Y natively on all versions
.macro DCP_ZPX(addr) { .byte $d7, addr }

multiplex_loop_nmos:
    LAX_ZPY(sprite_y)   // A = X = sprite_y[Y] — 4 cycles / 2 bytes
    DCP_ZPX(compare_y)  // compare_y[X]-- ; sets flags vs A — 6 cycles / 2 bytes
    bcc multiplex_done_nmos
    iny
    bne multiplex_loop_nmos

multiplex_done_nmos:
    sty active_sprites
```

### Cross-references

- Technique `illegal_opcode_tricks` (`docs/techniques/cpu-cycle-tricks.md`) —
  per-opcode semantics, cycle counts, and stable vs unstable tier classification
- Doc `docs/hardware/6502-illegal-opcodes.md` — per-opcode reference with flag
  effects and per-revision availability
- VICE x64sc — the cycle-exact NMOS-faithful emulator; use as verification platform

---

## jmp_indirect_page_boundary_bug — JMP ($xxFF) fetches the high byte from $xx00 instead of $(xx+1)00

**Severity:** high
**Region:** both
**Triggered by techniques:** jump_table_dispatch
**Mitigated by techniques:** jump_table_dispatch

### Symptom

A jump table dispatch jumps to a completely wrong address. Changing the target
address in the table has no effect. Moving the table by one or two bytes in
memory makes the bug disappear; moving it back brings it back. The bug is
deterministic: it fires whenever a jump table entry's low-byte slot falls at
an address ending in $FF. The same bug occurs when `JMP ($addr)` is used
directly and the vector is placed at $xxFF.

### Mechanism

`JMP ($addr)` (opcode $6C) is the 6510's indirect jump. It takes the 16-bit
address stored at the 2-byte operand location and jumps there. The fetch works
as two separate byte reads:

1. Low byte of destination: fetched from `$addr`.
2. High byte of destination: fetched from `$addr + 1`.

The 6510 uses an 8-bit adder with no carry propagation for the second-byte
fetch. The high byte of the address is not incremented when `$addr + 1` would
cross a page boundary. Concretely:

- If `$addr` = $10FE, the low byte is read from $10FE and the high byte from
  $10FF. Correct.
- If `$addr` = $10FF, the low byte is read from $10FF and the high byte from
  $1000 (not $1100). **Wrong.**

The CPU wraps the low byte of the pointer address within the same page. This is
not a timing issue or an edge case in the address decoder — it is the documented
behavior of the original 6502 silicon, reproduced faithfully in every NMOS
6510 and 8500. It is sometimes called the "JMP indirect page-wrap bug" or the
"6502 JMP indirect bug."

The bug surfaces whenever an entry's low-byte slot lands at $xxFF. With a
page-aligned table at $xx00 and 2-byte strides, all slots are at even offsets
from $xx00 and none land at $xxFF. The only dangerous placement is when the
assembler places the table at an offset that puts any entry's low-byte at an
address ending in $FF.

`jump_table_dispatch` is on both metadata lines above for that reason: the
bug arises in the naive form of the technique, a `JMP ($abs)` through an
unaligned table, and the technique's store-then-jump form (self-modified
`JMP $abs`, or a page-aligned table) is what sidesteps it.

**CMOS note:** The 65C02 corrects this bug — it always fetches the high byte
from `$addr + 1` with correct carry. Code targeting both 6510 and 65C02 must
still avoid $xxFF placement to be safe on the 6510.

### Fix

**Never place a JMP indirect vector or jump table entry at a $xxFF address.**

The safest approach is page-alignment. The bug fires when the low-byte slot
of a jump table entry is at an address ending in $FF — i.e., when
`table_base + (2 * index)` == $xxFF. For a page-aligned table at $xx00,
entries land at $xx00, $xx02, $xx04, ... $xxFE — all even, none at $xxFF.
Page alignment with a 2-byte stride is a complete fix.

```kick
// FIXED: page-aligned jump table, no entry at $xxFF

.align $100
dispatch_table:
    .word handler_0     // vector at $xx00 — safe
    .word handler_1     // vector at $xx02 — safe
    .word handler_2     // vector at $xx04 — safe
    // ... entries continue at $xx06, $xx08, ... $xxFE — all safe

dispatch:
    lda current_state
    asl
    tax
    lda dispatch_table,x
    sta jmp_indir+1
    lda dispatch_table+1,x
    sta jmp_indir+2
jmp_indir:
    jmp $0000           // Self-modified; avoids JMP ($abs) entirely
```

The example above uses a self-modified `JMP $abs` rather than `JMP ($abs)`.
The self-modified form is immune to the page-wrap bug because it uses the
absolute addressing mode ($4C), not the indirect mode ($6C). The two-step
store-then-jump pattern from `jump_table_dispatch` in `cpu-cycle-tricks.md`
sidesteps the bug entirely.

If `JMP ($abs)` must be used directly (for code-size reasons, or when the
vector table is not under the programmer's control), add a build-time assertion:

```kick
// KickAssembler build-time check: assert the vector is not at $xxFF
.assert "jmp_vector not at page boundary", (jmp_vector & $FF) != $FF, true
```

This turns a silent runtime misfire into an assembler error at build time.

### Worked example

```kick
// BAD: vector table placed without alignment check
// If any table entry lands at $xxFF, the dispatch goes to a random address.

// Suppose the assembler places this table at $27C0 (example)
dispatch_table_bad:
    .word handler_0     // at $27C0 — safe
    .word handler_1     // at $27C2 — safe
    .word handler_2     // at $27C4 — safe
    // ... 15 more entries ...
    .word handler_17    // at $27E2 — safe
    .word handler_18    // at $27E4 — safe
    // If the table started at $27C2 instead, handler_31 would be at $27FF
    // — the bug would fire silently

// The 6510 has no JMP (abs,X) — that is a 65C02 instruction, and an earlier
// version of this example used it. The 6502 idiom that hits the bug is an
// indirect JMP whose operand is patched to point at the table entry:
dispatch_bad:
    lda current_state
    asl
    clc
    adc #<dispatch_table_bad
    sta jmp_ind+1
    lda #>dispatch_table_bad
    adc #0
    sta jmp_ind+2
jmp_ind:
    jmp ($0000)                  // reads the vector from the table entry; if that
                                 // entry sits at $xxFF the high byte comes from $xx00


// GOOD: page-aligned table + self-modified absolute JMP

.align $100
dispatch_table_good:
    .word handler_0     // at $2800 — safe
    .word handler_1     // at $2802 — safe
    .word handler_2     // at $2804 — safe
    .word handler_3     // at $2806 — safe
    // All entries at even offsets from $2800 — none at $xxFF

dispatch_good:
    lda current_state   // 4 cycles
    asl                 // 2 cycles — word offset
    tax                 // 2 cycles
    lda dispatch_table_good,x   // 4 cycles — low byte
    sta jmp_abs+1              // 4 cycles — patch low byte of JMP operand
    lda dispatch_table_good+1,x // 4 cycles — high byte
    sta jmp_abs+2              // 4 cycles — patch high byte
jmp_abs:
    jmp $0000           // 3 cycles — absolute, not indirect; no page-wrap bug


// BUILD-TIME GUARD: if you must use JMP ($abs), assert the address is safe.
// Place this near any JMP ($abs) in the codebase.
.var MY_VECTOR = $2802
.assert "MY_VECTOR safe from JMP indirect bug", (MY_VECTOR & $FF) != $FF, true
```

### Cross-references

- Technique `jump_table_dispatch` in `docs/techniques/cpu-cycle-tricks.md` —
  the self-modified `JMP $abs` pattern avoids this bug by design; prefer it
  over `JMP ($abs)` in new code
- Doc `docs/hardware/6510-cpu-reference.md` — the Indirect addressing mode
  section documents the bug; only opcode $6C (`JMP ($abs)`) triggers the wrap,
  not `JMP $abs` ($4C)
