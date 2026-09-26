---
category: cpu
---

<!-- doc-type: pitfall-reference -->

# CPU Pitfalls

Pitfalls in the 6510's own behaviour, and in what a toolchain does to code
that leans on it: code that is correct in isolation and fails in context,
such as a branch cycle count that changes with binary placement, illegal
opcodes that disappear on CMOS silicon, an indirect-jump address fetch that
wraps at page boundaries, a signed compare that turns over, an LFSR that
never leaves zero, an assembler optimiser that separates a patch from
the instruction it patches, a NOP patch that leaves a branch testing old
flags, an upward copy that overwrites its own source, a breakpoint that
resumes past the instruction it replaced, and a 16-bit counter an
interrupt changes between the two loads that read it. Each has broken
cycle-tight or portable C64 code. (An earlier version of this paragraph counted
three.)

---

## branch_page_cross_extra_cycle — Conditional branch costs +1 cycle when crossing a page boundary

**Severity:** high
**Region:** both
**Triggered by techniques:** stable_raster_irq, self_modifying_code, unrolled_loops, double_irq, sideborder_open, fli_image, charset_copy_rom_to_ram, isqrt_16bit, atan2_8bit, bresenham_line, zero_page_burst, delay_loops, midpoint_circle, clock_slide_raster_irq
**Mitigated by techniques:** bit_test_trick

### Symptom

Cycle-counted raster IRQ code drifts by exactly one cycle depending on where
the linker places the assembled output. Color bars that were correct in
development land on the wrong line in the final build. A stable-raster handler
that works at $2000 breaks when the code is relocated to $2FF0
and a branch straddles the $3000 boundary. The one-cycle shift is
reproducible: it changes with the binary's load address, not at random.

### Mechanism

All conditional branches on the 6510 (BCC, BCS, BEQ, BMI, BNE, BPL, BVC,
BVS) use the relative addressing mode. The branch instruction is 2 bytes
(opcode + signed displacement). Cycle cost follows three cases:

| Outcome | Cycles |
|---------|--------|
| Branch not taken | 2 |
| Branch taken, target on same page as the instruction after the branch | 3 |
| Branch taken, target on a different page than the instruction after the branch | 4 |

The "page" check compares the high byte of `PC + 2` (where the CPU is after
fetching the 2-byte branch instruction) with the high byte of the branch target.
If they differ, the CPU performs an extra internal cycle to fix up the high byte
of the program counter (the page-crossing penalty).

For code that does not need cycle precision, this does not matter: one extra
cycle out of thousands is noise. For stable-raster IRQ handlers, per-line
raster effects, or sprite multiplexers where the cycle budget per scanline is
counted in single digits, a one-cycle slip means the write to `$D020` or
`$D001` lands on the wrong scanline. Because the penalty depends on the
branch target's page rather than any runtime value, the same source assembles
to different cycle counts depending on the `.o` file's placement in the binary.

The pitfall is worst in routines that loop across page boundaries. A
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
Tight polling loops can be replaced with NOP chains (`NOP` = 2 cycles; the
undocumented one-byte NOPs $1A/$3A/$5A are also 2 cycles and 1 byte, so they
buy nothing over `NOP` except a CMOS incompatibility; an earlier version of
this sentence recommended them; on a 65816 $1A/$3A/$5A are `INC A`/`DEC A`/
`PHY`, measured in xscpu64, so the third one corrupts the stack; see
illegal_opcode_portability below. For a 3-cycle pad use the
legal `bit zp`, or `nop zp` ($04) if the flags must survive, noting that $04
is itself undocumented and carries the same portability caveat; see the
padding section of `docs/hardware/6502-illegal-opcodes.md`) or the `BIT $abs`
skip trick. A spin-wait with `DEC zp / BNE` that straddles a page boundary
can be replaced with an unrolled NOP sequence calibrated at link time.

**Empirical rule for stable raster IRQs.** Place the entire timing-critical
section in a 256-byte aligned region using `.align $100`. Two separate
constraints apply. Page: a taken branch pays the +1 only when the high byte of
PC+2 differs from the target's, so inside a page-aligned section a branch to a
target in that section crosses only if its opcode sits on the page's last two
bytes (offset $FE or $FF); a branch at offset $F0 back to offset $80 still
costs 3. Range: the displacement is -128..+127 from PC+2, so a backward branch
to the aligned start can sit no further than offset 126. Keeping the whole
section under 128 bytes satisfies both at once, which is why it is a safe rule
of thumb, but it is the range limit, not the page rule, that the 128 figure
comes from (an earlier version of this paragraph attributed it to the page
rule; measured in x64sc: `BNE` at $2FFD to $3000 costs 4, at $20FD back to
$20EE costs 3, at $21FF back to $21D0 costs 4). Verify the final cycle count
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
- Recipe `docs/recipes/kickassembler/hires-circle.md` — the circle
  routine at `$0AA6`, its branches taken into page `$0B`, measured 5
  and 34 cycles above its count for radius 10 and 80; aligned, it
  matches

---

## illegal_opcode_portability — Illegal opcodes behave correctly on NMOS 6510 but break on CMOS and SuperCPU targets

**Severity:** medium
**Region:** both
**Triggered by techniques:** illegal_opcode_tricks, bit_test_trick

### Symptom

Code using LAX, SAX, AXS, ALR, ARR, DCP, or the RMW family works on
real C64 hardware and under VICE. The same code loaded into a SuperCPU-equipped
machine executes differently or hangs. A sim6502 unit test in strict CMOS mode
fails on every illegal opcode. An assembler in 65C02 mode refuses the
mnemonics outright (KickAssembler `.cpu _65c02`: "Pseudo command 'lax' not
defined"; ca65 `.setcpu "65C02"`: error), but a routine emitted with `.byte`
assembles and mis-executes on the CMOS part with no error at all. (An
earlier version of this sentence said the assembler silently treats the bytes
as NOPs; it does not (measured with KickAssembler 5.25 and ca65).) The
assumption that the target CPU is NMOS was never documented.

### Mechanism

Illegal opcodes arise from the NMOS 6502 decode matrix. Each opcode byte selects
a column (addressing mode) and a row (operation). The "illegal" cells are
undefined combinations where two operation strobes activate simultaneously,
producing fused instructions that the MOS engineers did not design but that the
silicon executes deterministically. The safe tier (LAX, SAX, ANC, ALR, ARR,
AXS, DCP, ISC, SLO, RLA, SRE, RRA) is consistent across every NMOS 6502 and
6510 ever manufactured.

The portability boundary is the NMOS / CMOS divide:

**65C02 (CMOS revision):** All undefined opcode slots were filled
with explicit NOPs of varying byte lengths and cycle counts. The decode matrix
was redesigned. On a 65C02 the byte $A7 (LAX zero-page) is either a NOP of
vendor-specific length or, on Rockwell/WDC parts, a bit-manipulation
instruction (the $x7 column is SMB/RMB there); either way A and X are not
loaded and the program continues from the wrong state. (An earlier version of
this paragraph stated flatly "a 2-cycle 2-byte NOP"; that varies by 65C02
vendor and was not measured here.) On the 6510, $A7 executes `A = X = M[zp]`,
a different side effect.

**65816 (WDC 16-bit extension, used in SuperCPU):** The SuperCPU accelerator for
the C64 fits a 65816 CPU and runs C64 code in emulation mode. The 65816 has no
undefined opcodes: every NMOS illegal-opcode byte is a live 65816 instruction
with its own memory, stack or register side effects, not a silent NOP. (An
earlier version of this paragraph and the table below said these bytes execute
as NOPs on the SuperCPU; measured in xscpu64, VICE 3.10: $A7 $F0 loaded A
through the 24-bit pointer at $F0 and left X unchanged, $87 $F0 stored A
through that pointer, $C7 $F0 compared without decrementing, $4B pushed one
byte, $1A incremented A, $EB swapped A with B.) Code that runs identically on
6510 and 8500 will misbehave on SuperCPU.

**8500 (late C64 and C64C):** The 8500 is the same NMOS microarchitecture as the
6510, shrunk to a smaller process. The safe illegal opcodes behave identically
to the 6510.

**VICE default mode (x64sc):** VICE in its default cycle-exact mode (x64sc)
implements the safe NMOS illegal opcodes faithfully. Development under VICE is
not sufficient to catch CMOS portability issues: VICE matches the real 6510.

**sim6502:** Behavior depends on the configuration. sim6502 may run in either
NMOS or strict mode. Code that relies on illegal opcodes must be tested under the
same configuration that the project ships for.

The second portability concern is the **unstable tier:** XAA (ANE), LAX #imm
($AB), AHX, TAS, SHX, SHY. These involve a floating internal bus whose value
varies by chip revision and thermal state. They must never appear in shipping
code.

| Opcode | NMOS 6510 | 65C02 (varies by vendor; not measured here) | 65816 / SuperCPU (xscpu64 unless marked) | Notes |
|--------|-----------|------------------|------------------|-------|
| LAX zp ($A7) | A=X=M | NOP or SMB/RMB | `LDA [dp]` — 24-bit pointer read, X untouched (measured) | Safe NMOS only |
| SAX zp ($87) | M=A&X | NOP or SMB/RMB | `STA [dp]` — writes A through a 24-bit pointer (measured) | Safe NMOS only |
| ALR #imm ($4B) | A=(A&imm)>>1 | NOP | `PHK` — pushes one byte (measured) | Safe NMOS only |
| ARR #imm ($6B) | A=ROR(A&imm) quirky flags | NOP | `RTL` — pops a 24-bit return address and jumps there (measured) | Safe NMOS only |
| AXS #imm ($CB) | X=(A&X)-imm | NOP | `WAI` — stalls until the next IRQ/NMI assertion, even with I set; permanent only if no source is running (measured: 58-line stall) | Safe NMOS only |
| DCP zp ($C7) | M--; CMP A,M | NOP or SMB/RMB | `CMP [dp]` — compares, no decrement (measured) | Safe NMOS only |
| SLO/RLA/SRE/RRA zp ($07/$27/$47/$67) | RMW+combine | NOP or RMB | `ORA [dp]` / `AND [dp]` / `EOR [dp]` / `ADC [dp]` — plain reads through a 24-bit pointer, no RMW ($07 measured; the other three from the opcode map) | Safe NMOS only |
| XAA #imm ($8B) | unstable | NOP | `PHB` — pushes the data bank (measured) | **NEVER USE** |
| LAX #imm ($AB) | unstable | NOP | `PLB` — pulls one byte into the data bank, A untouched (measured) | **NEVER USE** |

The table's third column used to read "NOP" for every row under a single
"65C02 / SuperCPU" heading; the SuperCPU column was wrong in every row, and the
65C02 column depends on which vendor's part is fitted. The one-byte NOPs are
not exempt either: $1A is `INC A` and $EB is `XBA` on the 65816 (measured).

### Fix

**Document the dependency.** At minimum, add a file-level comment to any source
file that uses illegal opcodes. The comment should state which opcodes are used,
why, and that the code requires a stock C64 NMOS 6510 or 8500 CPU:

```kick
// This file uses LAX ($A7), DCP ($C7), and SLO ($07) for cycle savings
// in the sprite multiplexer inner loop. These are NMOS-only opcodes.
// They work on: 6510 (C64), 8500 (C64C), 8502 (C128 native mode).
// They misbehave on: SuperCPU (65816 — each byte is a live instruction
// with side effects), any CMOS board, 65C02.
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
// Works on real C64 and VICE. Misbehaves on SuperCPU — the bytes are not
// skipped, they execute as 65816 instructions with other side effects.

multiplex_loop:
    lax sprite_y,y      // A = X = sprite_y[y] — NMOS only ($B7: LAX zp,Y; there is no zp,X form)
    dcp compare_y       // compare_y-- ; cmp A, new compare_y — NMOS only ($C7: DCP zp)
    bcc multiplex_done
    iny
    bne multiplex_loop

multiplex_done:
    sty active_sprites


// GOOD: same logic with documentation and legal fallback comments

// NMOS-ONLY section: LAX ($B7 zp,Y) and DCP ($C7 zp) used for cycle savings.
// Tested on: 6510 (real HW), 8500 (real HW), VICE x64sc PAL.
// Misbehaves on 65C02 and 65816/SuperCPU (see table above).

multiplex_loop_nmos:
    lax sprite_y,y      // A = X = sprite_y[Y] — $B7 zp,Y, 4 cycles / 2 bytes
    dcp compare_y       // compare_y-- ; flags vs A — $C7 zp, 5 cycles / 2 bytes
    bcc multiplex_done_nmos
    iny
    bne multiplex_loop_nmos

multiplex_done_nmos:
    sty active_sprites
```

An earlier version of the GOOD listing wrapped both instructions in `.byte`
macros ("assembler won't accept LAX zp,Y natively") and used $D7 (DCP zp,X)
where the BAD listing used $C7 (DCP zp) — different addressing, different
logic, and a 6-cycle count that belonged to the wrong mode. KickAssembler 5.25
assembles `lax sprite_y,y` to `B7` and `dcp compare_y` to `C7` natively
(measured), so the macros were unnecessary; worse, `.byte $b7, addr` with a
non-zero-page `addr` silently truncated the label to its low byte with no
error. If a `.byte` escape is ever kept, guard it with
`.errorif addr >= $100, "operand not in zero page"`, not `.assert`. Measured
on KickAssembler 5.25, a failed `.assert` still writes the PRG and exits 0,
while `.errorif` aborts with exit 1 and no output file.

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
**Triggered by techniques:** jump_table_dispatch, basic_extension_wedge
**Mitigated by techniques:** jump_table_dispatch

### Symptom

A jump table dispatch jumps to a wrong address. Changing the target
address in the table has no effect. Moving the table by one byte in memory
makes the bug disappear; moving it back brings it back. Moving it by two does
not help in general: a 2-byte stride keeps every entry's parity, so the fault
just shifts to the neighbouring entry (it only clears if that neighbour would
fall off the end of the table); an earlier version of this sentence said one
or two bytes. The bug is
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
not a timing issue or an edge case in the address decoder; it is the documented
behavior of the original 6502 silicon, reproduced in every NMOS
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
of a jump table entry is at an address ending in $FF, i.e. when
`table_base + (2 * index)` == $xxFF. For a page-aligned table at $xx00,
entries land at $xx00, $xx02, $xx04, ... $xxFE: all even, none at $xxFF.
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
// KickAssembler build-time guard: refuse to build if the vector sits at $xxFF
.errorif (jmp_vector & $FF) == $FF, "jmp_vector at $xxFF: JMP ($abs) would fetch the wrong high byte"
```

This turns a silent runtime misfire into a failed build. Use `.errorif`,
not `.assert`: measured on KickAssembler 5.25, a failed `.assert` prints a
message but still writes the PRG and exits 0, so a build script never sees
it, while `.errorif` aborts with exit 1 and no output file (an earlier
version of this guard used `.assert`).

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
    // If the table started at $27C1 instead, handler_31 would be at $27FF
    // ($27C1 + $3E) — the bug would fire silently. (An earlier version said
    // $27C2, which puts handler_31 at $2800: an even base can never land a
    // 2-byte-stride entry on $xxFF.)

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


// BUILD-TIME GUARD: if you must use JMP ($abs), refuse to build an unsafe address.
// Place this near any JMP ($abs) in the codebase. (.errorif aborts the build;
// .assert, which an earlier version used here, only prints and still emits the PRG.)
.var MY_VECTOR = $2802
.errorif (MY_VECTOR & $FF) == $FF, "MY_VECTOR at $xxFF: JMP indirect page-wrap bug"
```

### Cross-references

- Technique `jump_table_dispatch` in `docs/techniques/cpu-cycle-tricks.md` —
  the self-modified `JMP $abs` pattern avoids this bug by design; prefer it
  over `JMP ($abs)` in new code
- Doc `docs/hardware/6510-cpu-reference.md` — the Indirect addressing mode
  section documents the bug; only opcode $6C (`JMP ($abs)`) triggers the wrap,
  not `JMP $abs` ($4C)

## lfsr_zero_state_lockup — An LFSR seeded with zero outputs zero for ever

**Severity:** medium
**Region:** both
**Triggered by techniques:** lfsr_random, attract_mode_input_replay, difficulty_ramp_tables, ghost_target_tile_ai, seeded_level_fill, starfield, procedural_seed_universe, fire_effect, screen_dissolve_lfsr, random_in_range, fighter_opponent_tables, luminance_dissolve
**Mitigated by techniques:** lfsr_random

### Symptom

Every "random" value the game produces is zero: enemies spawn in the
same corner, the starfield is one column, the noise pattern is blank.
It works on the developer's machine and fails on another, or fails
only after a reset, because the seed happened to be zero there.

### Mechanism

A Galois LFSR shifts its state right and XORs the tap mask in when the
bit that fell out was 1. From state zero the bit that falls out is 0,
nothing is XORed in, and the state is zero again; the map fixes zero
and never leaves it. The 2^n - 1 non-zero states form the one cycle
the period figures on `lfsr_random` describe (255 and 65535, measured
in VICE x64sc 3.10); zero is not on it. Any seed source can deliver
zero: two `$D41B` reads that both return `$00`, a timer read at a
phase where its low and high bytes happen to be zero, a frame count
of zero because the player pressed fire on the first frame, or a
variable the loader never initialised. The technique is on both
metadata lines above because the lockup arises in a naive seeding of
`lfsr_random` and the seed check the technique specifies cures it.

### Fix

Test the seed before the first step and replace zero with a non-zero
constant. Test the 8-bit and 16-bit registers separately: a 16-bit
seed can be non-zero while its low byte, used to seed an 8-bit
register, is zero.

### Worked example

```c
// BAD: whatever the sources gave is the seed
seed = (sid.random << 8) | sid.random;
s16 = seed;                      // zero stays zero for ever

// FIXED: zero is replaced before the first step
seed = (sid.random << 8) | sid.random;
if (seed == 0)
    seed = 0xACE1;
s16 = seed;
seed8 = (char)seed;
if (seed8 == 0)
    seed8 = 0x01;
```

The 6502 form is `lda seed / ora seed+1 / bne ok / lda #$e1 / sta seed /
lda #$ac / sta seed+1 / ok:` (rung 3, not timed).

### Cross-references

- Technique `lfsr_random` in `docs/techniques/maths.md` — taps, periods,
  seeding from `$D41B`, a CIA timer and player input
- Recipe `docs/recipes/oscar64/lfsr-random.md` — the seed check in a
  built and run listing
- `docs/hardware/sid-reference.md` (`$D41B`) — the noise register drifts
  to all ones under TEST and never reads zero there, but a running noise
  voice can return `$00`

## signed_compare_bmi_overflow — BMI after a subtract gives the wrong order when the difference overflows

**Severity:** high
**Region:** both
**Triggered by techniques:** compare_16bit_and_signed, fixed_point_8_8, tile_grid_collision, slope_collision, nav_area_pathfinding, atan2_8bit, game_tree_search, bresenham_line, solid_vector_3d, voxel_landscape, car_contact_response, lane_pursuit_ai, add_sub_16bit, byte_list_sort, midpoint_circle
**Mitigated by techniques:** compare_16bit_and_signed

### Symptom

A signed limit check works through every test and fails on one input:
a sprite falling at a large negative velocity is treated as rising, an
object far to the left of a boundary is placed to its right, a
platformer's jump never terminates once the velocity passes a certain
size. The failing cases are the pairs of opposite sign that are far
apart, so a small test level never shows them.

### Mechanism

`SEC / SBC b` leaves `a - b` in `A` and `N` is bit 7 of that byte. Bit 7
is the sign of the true difference only when the difference fits in
-128 to 127. `-128 - 127` is `-255`; the byte is `$01`, `N` is clear,
and `BMI` says -128 is not less than 127. `127 - (-128)` is `255`; the
byte is `$FF`, `N` is set, and `BMI` says 127 is less than -128. The
CPU reports each of these with `V` set. Measured in VICE x64sc 3.10 over
all 65,536 signed byte pairs: the bare `BMI` disagrees with the
corrected compare on 16,384, one pair in four, and every one of them
has `V` set (`recipes/kickassembler/compare-16bit-signed.md`). The
technique is on both metadata lines above because the fault is the
naive form of its signed compare and its `BVC` / `EOR #$80` form cures
it.

### Fix

After the `SBC`, branch on `V`: if it is clear `N` is right; if it is
set flip bit 7 with `EOR #$80`, which also resets `N`. For 16-bit
values do the `SBC` on the high byte with the borrow from a `CMP` of
the low bytes. Where the test is against a constant in the same half
of the range, or the values can be biased by `$80`, an unsigned `CMP`
needs no fix-up.

### Worked example

```asm
// BAD: right until a - b leaves -128..127
        lda vel
        sec
        sbc limit
        bmi below         // wrong for 16,384 of 65,536 pairs

// FIXED: four more bytes, 3 to 4 more cycles
        lda vel
        sec
        sbc limit
        bvc !+
        eor #$80
!:      bmi below
```

Measured cost of the fixed 8-bit compare with absolute operands: 13 or
14 cycles before the `BMI` (13 when the subtract did not overflow and
the `BVC` is taken, 14 when it falls through into the `EOR`), against
10 for the bad one (rung 1 for the first pair, rung 3 for the second).

### Cross-references

- Technique `compare_16bit_and_signed` in `docs/techniques/maths.md` —
  the flag table on the boundary pairs, the 16-bit form, and what
  Oscar64 emits instead
- Technique `fixed_point_8_8` in `docs/techniques/maths.md` — signed
  velocities in the high byte, the place this bites first
- Recipe `docs/recipes/kickassembler/compare-16bit-signed.md` — the
  sweep that counts the 16,384 misses
- Recipe `docs/recipes/kickassembler/sort-bytes.md` — an insertion
  sort with this compare leaves 7 of 63 neighbours out of order in 64
  random signed keys; with `EOR #$80`, none (`byte_list_sort`)

---

## asm_optimiser_moves_self_modified_instruction — Oscar64's assembler optimiser at -O2 rewrites a non-volatile __asm block, so a store into an instruction's operand byte lands in a copy that never runs

**Severity:** high
**Region:** both
**Triggered by techniques:** table_multiply_8x8

### Symptom

A routine written as an `__asm` block that patches its own operand
bytes (`sta m1 + 1` into a following `lda table,y`) gives the right
answer at `-O0` and the wrong answer at `-O2`, with no warning from the
compiler. The `.asm` listing looks correct at the point a reader opens
it first, because the instruction sequence as written is still in the
file; it is just not the sequence that runs.

Measured on the quarter-square multiply harness from
`techniques/maths.md` (`fpcheck.c`, Oscar64 `-tm=c64 -O2`, VICE x64sc
3.10, PAL, screen decoded with the character ROM). The only change
between the two builds is the word `volatile` on the multiply's block:

```
__asm volatile   mul cs 0f09 exp 0f09 miss 00000   pass
__asm            mul cs c524 exp 0f09 miss 00000   fail
```

The miss counter hides the fault too. It reads `00000` in the
failing build because every one of the 65,536 products is wrong and a
16-bit counter of 65,536 misses wraps to zero. Only the checksum
shows it. Recomputing the checksum in Python from the instruction sequence
that actually executes (below) gives `C524` and 65,536 misses, so the
mechanism explains the number on screen.

### Mechanism

At `-O2` and above Oscar64 runs an assembler optimiser over inline
assembly that is not marked `volatile`. It is free to change addressing
modes and instruction order, and it may emit more than one copy of a
block. It does not know that a store whose target is `label + 1` is
writing an operand byte, so it resolves that store against wherever the
label ended up and optimises the instruction the label points at as if
its operand were the constant the source shows.

In the measured build the executed copy at `$0C00` had `ldy / lda ,y`
rewritten as `ldx / lda ,x` and `sec` moved down one instruction. The
four patch stores in that copy resolve to `$0C3E`, `$0C47`, `$0C41`
and `$0C4A`. Those addresses are inside a second, byte-for-byte
original copy of the block that the assembler placed after the `RTS` at
`$0C27`; nothing jumps to it. The running instructions keep the operands
they were assembled with, `sqr_lo + 0` and `nsq_lo + 0`, which is the
routine with `a = 0` patched into the `sqr` reads and `255 - a = 0`
into the `nsq` reads. Every product is therefore `q(b) - q(|b - 255|)`
instead of `q(a + b) - q(|a - b|)`; for `0 * 0` that is
`0 - 16256 = $C080`, the figure the technique page recorded.

Executed copy, from the `.asm` listing of the non-volatile build:

```
0c00  LDA $0bff       ; mul_a
0c03  STA $0c3e       ; m1 + 1, but in the dead copy below
0c06  STA $0c47       ; m2 + 1
0c09  EOR #$ff
0c0b  STA $0c41       ; m3 + 1
0c0e  STA $0c4a       ; m4 + 1
0c11  LDX $0e9d       ; mul_b, now X
0c14  LDA $0f00,x     ; sqr_lo + 0: operand never patched
0c17  SEC
0c18  SBC $1300,x     ; nsq_lo + 0
0c1b  STA $0e9e       ; mul_r
0c1e  LDA $1100,x
0c21  SBC $1500,x
0c24  STA $0e9f
0c27  RTS
```

Dead copy, immediately after it (no reference to `$0C28` anywhere in
the listing):

```
0c28  LDA $0bff
0c2b  STA $0c3e
0c2e  STA $0c47
0c31  EOR #$ff
0c33  STA $0c41
0c36  STA $0c4a
0c39  LDY $0e9d
0c3c  SEC
0c3d  LDA $0f00,y     ; $0c3e is the low operand byte: this is m1 + 1
0c40  SBC $1300,y     ; $0c41 is m3 + 1
0c43  STA $0e9e
0c46  LDA $1100,y     ; $0c47 is m2 + 1
0c49  SBC $1500,y     ; $0c4a is m4 + 1
0c4c  STA $0e9f
0c4f  RTS
```

With `volatile` the block is emitted once, as written, and the four
stores resolve to `$0C16`, `$0C1F`, `$0C19` and `$0C22`, which are the
operand bytes of the four indexed reads at `$0C15`, `$0C1E`, `$0C18`
and `$0C21` in the same copy. The `-O2` volatile build and the `-O0`
non-volatile build both pass; `-O0` is a control, not a fix, because
the optimiser is not run at that level.

### Fix

Any one of these keeps the patch and the patched instruction in the
same copy of the code. All three were built and run here.

1. Write the block `__asm volatile { ... }`. Measured: pass, 52 cycles
   per call, the figure on the technique page.
2. Wrap the function in `#pragma optimize(push)` / `#pragma
   optimize(noasm)` / `#pragma optimize(pop)` and leave the block
   plain. Measured: pass, and the listing is the same instruction
   sequence as the volatile build.
3. Do not patch code at all. Put the operand in a zero-page pointer and
   index through it with `lda (zp),y`; the store is to a variable, which
   the optimiser treats as data. Measured: pass, 66 cycles per call
   against 52 (arithmetic from the same harness: 11,504 less the 4,904
   empty-loop baseline, over 100 calls). The cost is the four `lda # /
   sta zp` pairs that load the table page bytes, plus the slower
   addressing mode.

Moving the routine to a separate assembler source file is not an option
in Oscar64: the compiler has no object linker and no external symbol
resolution (`toolchains/oscar64-reference.md`, "Calling KickAssembler
code from Oscar64"), so a hand-assembled routine has to be embedded as
bytes at a fixed address and called by `jsr`. That puts it beyond
the optimiser's reach, but it was not measured here.

### Worked example

The C shape that fails, with the two results. Nothing about the
pattern is specific to the multiply: any store to `label + 1` or
`label + 2` where `label` is an instruction inside the same block is
exposed.

```text
__noinline void qmul(void)
{
    __asm                    // BAD at -O2: mul cs c524, miss 00000 (wrapped)
    {
        lda mul_a
        sta m1 + 1           // patches an operand byte of m1 ...
        sta m2 + 1
        eor #$ff
        sta m3 + 1
        sta m4 + 1
        ldy mul_b
        sec
    m1: lda sqr_lo, y        // ... but the m1 that runs is a rewritten copy
    m3: sbc nsq_lo, y
        sta mul_r
    m2: lda sqr_hi, y
    m4: sbc nsq_hi, y
        sta mul_r + 1
    }
}

__noinline void qmul(void)
{
    __asm volatile           // FIXED: mul cs 0f09, miss 00000, 52 cycles
    {
        ... same body ...
    }
}
```

The data-patch form (fix 3), which is safe in a plain block because it
never writes into code. Shown in KickAssembler syntax; the Oscar64
version is the same instructions with `__zeropage char *` pointers in
place of the two `.label` lines:

```asm
        .label zp_sqr = $f7    // two zero-page pointers
        .label zp_nsq = $f9
        lda mul_a
        sta zp_sqr             // low byte = a
        eor #$ff
        sta zp_nsq             // low byte = 255 - a
        ldy mul_b
        sec
        lda #>sqr_lo
        sta zp_sqr + 1         // a store to a variable, not to an instruction
        lda #>nsq_lo
        sta zp_nsq + 1
        lda (zp_sqr),y
        sbc (zp_nsq),y
        sta mul_r
        lda #>sqr_hi
        sta zp_sqr + 1
        lda #>nsq_hi
        sta zp_nsq + 1
        lda (zp_sqr),y
        sbc (zp_nsq),y
        sta mul_r + 1
```

A grep of the Oscar64 recipes for stores to `label + 1` inside
non-volatile `__asm` blocks found only stores into C variables
(`load-asset-runtime.md` writes `ld_end + 1`, a `static unsigned`), so
no shipped recipe carries the failing shape; the technique page is the
one place it was written and caught.

### Cross-references

- Technique `table_multiply_8x8` in `docs/techniques/maths.md`: the
  routine, its 52-cycle figure, and "The measuring program" whose
  checksum caught this
- `docs/toolchains/oscar64-reference.md`: the assembler optimiser
  paragraph (`__asm volatile`, `#pragma optimize(noasm)`) and the
  section on calling KickAssembler code, which is why a separate `.s`
  file is not a remedy here
- Pitfall `getchx_petscii_remaps_return` in
  `docs/pitfalls/kernal-and-io.md`: the other Oscar64-specific pitfall,
  for the same "the source is right, the toolchain did something else"
  reading habit

---

## nop_patch_leaves_stale_flags — Three NOPs over a DEC keep the lives but leave the next branch testing an older instruction's flags

**Severity:** medium
**Region:** both
**Triggered by techniques:** trainer_and_cheat_hooks, self_modifying_code

### Symptom

An infinite-lives patch replaces `DEC lives` with three NOPs. The lives
counter stays at 3 as intended, but the game now ends on the first
death, or never ends a level, or ends at random, depending on what ran
before the patched line.

### Mechanism

`DEC` writes the byte and also sets Z and N from the result, and the
game's next instruction is usually a branch on that result: `BEQ
game_over`. NOP changes no flag, so the branch tests whatever the last
flag-setting instruction before the patch left. In the recipe's death
routine that is `LDA #0` two instructions earlier, so Z is set and the
branch to game over is taken on the first death, with 3 lives still on
the counter. The same patch in a routine that happened to leave Z clear
would appear to work, which is why this is found late.

Measured in VICE x64sc 3.10 on both models with the recipe below: the
unpatched game ends on death 3; with three NOPs it ends on death 1 with
the counter at 3; with `LDA lives` in the same three bytes it survives
all eight deaths played, counter at 3.

### Fix

Replace the instruction with one of the same length that sets the flags
the following code expects. `LDA` of the same address loads the
unchanged, non-zero count and clears Z; use it when A is reloaded before
it is read again, as it is in the recipe. Otherwise patch the branch as
well: two NOPs over the `BEQ`, or its offset byte set to 0. Read the
instructions after the patch site before choosing.

### Worked example

```asm
// The game's code:
            lda #0
            sta player_state
            dec lives           // CE lo hi
            beq game_over       // F0 xx

// BAD: EA EA EA over the DEC; BEQ now tests the Z from LDA #0
            lda #0
            sta player_state
            nop
            nop
            nop
            beq game_over       // taken: Z = 1

// GOOD: AD lo hi, same length; Z comes from the lives byte (3)
            lda #0
            sta player_state
            lda lives
            beq game_over       // not taken
```

### Cross-references

- Technique `trainer_and_cheat_hooks` (`docs/techniques/cpu-cycle-tricks.md`): the search, the scan and the patch forms
- Recipe `docs/recipes/oscar64/trainer-hooks.md`: the three runs above
- Technique `self_modifying_code` (`docs/techniques/cpu-cycle-tricks.md`): a code patch is a store into an instruction, with the same care about what the following instructions assume

---

## overlapping_copy_wrong_direction — An upward block copy onto a higher, overlapping address repeats its first bytes through the rest

**Severity:** high
**Region:** both
**Triggered by techniques:** text_editor_gap_buffer_and_refresh, memory_fill_copy

### Symptom

A move that works in every test starts to scramble text or data once the
block is large. In an editor with a gap buffer: jumping the cursor from
the end of a long document to its start turns most of the document into
a repeating run of the first few hundred characters, but only when the
document is nearly as large as the buffer. Short jumps and a large
free space never show it.

### Mechanism

An ascending copy reads byte `i` of the source and writes byte `i` of the
destination, lowest first. When the destination starts `d` bytes above
the source and the two overlap, byte `d` of the source has already been
overwritten by byte 0 by the time it is read. From there the copy reads
its own output: the first `d` bytes repeat, period `d`, through the rest
of the destination.

A gap buffer's left move is that copy. The bytes `buf[gs-k .. gs-1]` go
to `buf[ge-k .. ge-1]`, `d = ge - gs` above them: the gap. The regions
overlap exactly when the move `k` is longer than the gap. A buffer with a
lot of free space hides the fault; the gap shrinks as the document grows,
and a jump that was safe yesterday is not today.

Measured in the recipe (VICE x64sc 3.10, PAL and NTSC): 1,725 bytes of
text in a 2,048-byte buffer, gap 323. An ascending block copy of a
320-byte move gave text equal to the reference. The ascending copy of the
full 1,725-byte jump left 1,239 bytes different from the reference. The
byte-at-a-time move, highest address first, left 0.

### Fix

Choose the direction from the addresses: when the destination is above
the source, copy from the top down; when it is below, from the bottom
up. For a gap buffer that is fixed per direction: moving left copies
downward from the top (`buf[--ge] = buf[--gs]`), moving right copies
upward (`buf[gs++] = buf[ge++]`). In C, `memmove` must handle overlap and
`memcpy` need not; check what the library's routine does before using
it for a gap move. In assembler, the descending loop is on
`memory_fill_copy`.

### Worked example

```c
// BAD: one ascending copy for a left move of k bytes
s = buf + gs - k;  d = buf + ge - k;
while (k--) *d++ = *s++;        // wrong when k > ge - gs

// GOOD: highest byte first
s = buf + gs;  e = buf + ge;
while (k--) *--e = *--s;
```

```text
text 1,725 bytes, buffer 2,048, gap 323
ascending copy, move 320     bytes differing: 0
ascending copy, move 1,725   bytes differing: 1,239
descending move, 1,725       bytes differing: 0
```

### Cross-references

- Technique `text_editor_gap_buffer_and_refresh` (`docs/techniques/text.md`): the gap buffer and its two move loops
- Recipe `docs/recipes/oscar64/gap-buffer-editor.md`: the three moves above
- Technique `memory_fill_copy` (`docs/techniques/cpu-cycle-tricks.md`): the overlapping move both ways in assembler, measured on a page

---

## brk_resume_at_stacked_pc_skips_instruction — A breakpoint handler that returns to the stacked PC skips the instruction the BRK replaced and the byte after it

**Severity:** medium
**Region:** both
**Triggered by techniques:** machine_language_monitor_core
**Mitigated by techniques:** machine_language_monitor_core

### Symptom

A breakpoint stops where it should and shows sensible registers. After
"go", the program misbehaves: a register holds a value it should have
lost, a store is missing, or, when the replaced instruction was one
byte long, the CPU runs from the middle of the next instruction and
crashes a few instructions later.

### Mechanism

`BRK` is a two-byte instruction. It pushes the address of the BRK plus
2, then the status with the B bit set. The byte after the BRK is never
executed; it is often called the signature byte. A handler that puts the
original opcode back and returns with `RTI` resumes at BRK + 2: the
instruction at the breakpoint never runs, and if it was shorter than two
bytes the CPU lands inside the next one. The pitfall is in the naive
form of a monitor's breakpoint; the technique's resume rule cures it.

Measured in VICE x64sc 3.10 on both models with the recipe below. The
test routine is `LDX #$99`, `LDA #$11`, `LDX #$22` (the breakpoint),
`LDY #$33`, then stores X and Y. The BRK at `$0E66` stacked PC `$0E68`.
Resumed at `$0E68`, the routine stored X = `$99`: the `LDX #$22` was
skipped. Resumed at `$0E66` after the stacked PC was lowered by 2, it
stored X = `$22`. Y was `$33` both times.

### Fix

In the handler, subtract 2 from the stacked PC before `RTI`, after
writing the original opcode back. To keep the breakpoint armed for the
next pass, execute the one instruction with a temporary BRK after it,
then put the breakpoint back. A BRK used as a system call with its
signature byte as an argument is the case where resuming at the stacked
PC is right.

### Worked example

```asm
// Entered through $0316; stack from SP+1: Y, X, A, P, PCL, PCH.
brk_handler:
            tsx
            // ... record registers, write the saved opcode back ...
// BAD: RTI now resumes at BRK + 2
//          jmp $ea81

// GOOD: stacked PC - 2 is the breakpoint address
            sec
            lda $0105,x
            sbc #2
            sta $0105,x
            lda $0106,x
            sbc #0
            sta $0106,x
            jmp $ea81           // PLA TAY PLA TAX PLA RTI
```

### Cross-references

- Technique `machine_language_monitor_core` (`docs/techniques/cpu-cycle-tricks.md`): the breakpoint cycle and the stack layout
- Recipe `docs/recipes/oscar64/monitor-core.md`: the two resumes above
- `docs/hardware/kernal-routines-reference.md`: the IRQ entry at `$FF48` and the exits at `$EA31` and `$EA81`

---

## irq_shared_word_torn_read — A main loop that reads a 16-bit counter the interrupt increments can pair a stale low byte with a new high byte

**Severity:** medium
**Region:** both
**Triggered by techniques:** in_game_level_streaming

### Symptom

A level, a timer or a wave ends early by a whole low-byte wrap: at frame
256 instead of 300, and only sometimes. The next build, with nothing
changed but code elsewhere moving, runs correctly, so the fault looks
fixed when it is not.

### Mechanism

The 6510 reads a 16-bit value as two separate loads. An interrupt can
run between them. When the main loop compares a counter that the
interrupt increments, and the interrupt carries the low byte from `$FF`
to `$00` between the two reads, the main loop sees the old low byte
`$FF` and the new high byte: a value 256 too high.

Measured in VICE x64sc 3.10, PAL, in a build of recipe
`bitfire-level-stream` whose main loop tested for the end of a 300-frame
level with `lda pos / cmp #<300 / lda pos+1 / sbc #>300 / bcc wait`
(rung 1). `$FF` passes the low-byte compare and sets carry; a high byte
of 1 then gives 1 - 1 = 0 with carry set, and the loop exits at frame
256. `trace exec` put 5,228,492 and 5,228,497 cycles between the second
and third level switches and between the third and fourth, 266 frames
including the 10 of the switch, against 310 for the first level. A
rebuild with the code at other addresses did not show it: whether the
interrupt lands between the two loads depends on where the loop's
instructions fall relative to the frame.

### Fix

Make the comparison where the counter is written. The interrupt compares
both bytes after it increments them, which is atomic from the main
loop's side, and sets a one-byte flag; the main loop tests the flag.
This is the form `bitfire-level-stream` ships, and it ran every level
to 300 frames on PAL and NTSC.

Where the main loop must read the value itself, read the high byte, the
low byte and the high byte again, and start over if the two high bytes
differ; or read it with the interrupt masked (`SEI` ... `CLI`), which
delays the interrupt by the few cycles of the read. Neither was measured
here.

### Worked example

```asm
// BAD: two loads; an interrupt between them can make $00FF read as
// $01FF, and the loop exits at frame 256, 44 frames early
wait:
    lda pos
    cmp #<300
    lda pos + 1
    sbc #>300
    bcc wait

// GOOD: the interrupt compares, the main loop reads one byte
// in the interrupt, after incrementing pos:
    lda pos
    cmp #<300
    bne not_yet
    lda pos + 1
    cmp #>300
    bne not_yet
    inc at_end
not_yet:
// in the main loop:
wait2:
    lda at_end
    beq wait2
```

### Cross-references

- Technique `in_game_level_streaming` (`docs/techniques/loaders-packers.md`)
  and recipe `docs/recipes/kickassembler/bitfire-level-stream.md`: where
  it was measured
- Pitfall `signed_compare_bmi_overflow` in this file: the other way a
  multi-byte compare goes wrong

---

## bpl_countdown_index_above_127 — A countdown loop closed with BPL runs once when its index starts above 127

**Severity:** medium
**Region:** both
**Triggered by techniques:** kefrens_bars, sprite_stretcher_d017

### Symptom

A table that a routine fills every frame stays at whatever it held
before. In the c64-kb demo's part 8 a 180-entry table of per-line sprite
masks read all zero at every interrupt, the sprites never repeated a
row, and a store trace on one entry showed the fill's `sta` executing
once per build.

### Mechanism

`BPL` tests the N flag, bit 7 of the result. `LDX #179 / ... / DEX /
BPL loop` sees `DEX` leave `$B2`, whose bit 7 is set, and falls through
after the first pass. The loop is correct for any start up to 127 and
silently wrong above it, and a fill that begins at the top of a table
more than 128 entries long starts above it.

### Fix

Close the loop on a value the flags can carry: `DEX / CPX #$FF / BNE
loop` for a countdown to zero inclusive, or count with `BNE` from the
length down to one and index with an offset. When the body steps X
through the accumulator (`TXA / SEC / SBC #4 / TAX / BCS loop` for a
four-way unrolled fill), reload the value to store at the top of the
loop: the second build of the same fill stored the index instead of the
constant.

### Cross-references

- `signed_compare_bmi_overflow` above: the other reading of the N flag
  as a sign that goes wrong past 127.

---
