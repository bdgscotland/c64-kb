# 6502 Illegal Opcodes Reference

## Overview

The MOS 6502 (and its 6510 cousin in the C64) has a one-byte opcode space:
256 possible instruction bytes. The official MOS data sheet documents only
151 of them. The remaining 105 are unassigned in the original
specification. On real silicon they do not trap or NOP silently, and do
not always do the same thing: they execute and have side effects. They
are the **illegal opcodes** (also called *undocumented*,
*unintended*, *unofficial*, or *anomalous* opcodes).

These instructions arise from the way the 6502's micro-instruction matrix
is decoded. Each opcode byte selects a column in an addressing-mode table
and a row in an operation table. Most cells in that grid are filled with
useful combinations. The "illegal" cells are the unfilled ones,
where the chip ANDs together two operation strobes that the
designers never intended to activate simultaneously. The result is usually
predictable: an instruction that does the work of two legal instructions
back-to-back, with one operand fetch shared between them.

A small number of illegal opcodes are *unstable*: they involve internal
buses whose floating-bit values depend on chip revision, temperature, die
process, and even the value of the previous instruction's operand. They
are rarely safe to use in shipping code.

A handful are *fatal*: they hang the CPU until reset (the
**KIL/JAM** opcodes; see [KIL/JAM](#kiljam)).

The illegal opcodes have been reverse-engineered since the late 1970s.
The C64 demoscene uses them as ordinary instructions to save cycles and
bytes, for example to fit a 50-frame-per-second multiplexer in the
badline budget. Modern cycle-exact emulators (VICE, x64sc, Kowalski)
implement them, and modern assemblers accept their mnemonics once told the CPU
is NMOS (acme `!cpu 6510`, ca65 `.setcpu "6502X"`; KickAssembler needs
nothing; dasm not measured here).

This page lists all 105 undocumented opcodes (20 mnemonics), taken from
the Oxyron table, Masswerk's reference and the NESdev wiki. Per-revision
differences are noted where they exist.

### What "illegal" actually means

The term is historical: the decoder executes these instructions like any
other. "Illegal" means **MOS Technology never documented them**, never guaranteed their
behavior, and never promised that future revisions of the silicon would
keep behaving the same way. In practice:

- On every NMOS 6502/6510 ever produced, the *safe* illegal opcodes behave
  identically. They are reliable across all C64 models that ship a 6510 or
  8500 CPU.
- On the **65C02** (the CMOS revision used in the Apple //c, Apple //e
  enhanced, BBC Master, and some later embedded systems) the illegal
  opcodes were **removed**. Most slots are filled with explicit NOPs of
  varying byte/cycle counts. Code that relies on illegal opcodes will *not*
  run on a 65C02.
- The **65816** (Apple IIGS, SNES) does not preserve any illegal-opcode
  behavior either. The same warning applies.
- The C64's 6510 and 8500 and the C128's 8502 are NMOS parts and *do*
  support the illegal opcodes. The SuperCPU accelerator uses a 65816 and
  *does not*.

On a stock C64, illegal opcodes are safe. Outside the C64
NMOS family, they are not portable.

### Safe vs. unstable

The illegal opcodes fall into three reliability tiers:

| Tier | Examples | Use in production? |
|------|----------|--------------------|
| Safe (stable) | LAX, SAX, ANC, ARR, ALR, RLA, RRA, SLO, SRE, ISC, DCP, AXS, LAS (see note), NOPs | Yes — universal across NMOS 6502/6510 |
| Unstable | XAA, LAX #imm, AHX, TAS, SHX, SHY | Risky — output depends on chip and surrounding state |
| Fatal | KIL/JAM (12 opcodes) | Never — hangs the CPU |

LAS ($BB) was in the unstable tier in an earlier version of this page. None
of the sources this page cites marks it unstable (Oxyron and Masswerk
footnote exactly XAA, LAX #imm, AHX, SHX, SHY and TAS), and Oxyron records
only that one source called it "probably unreliable". Its stability cannot
be measured in VICE, which implements one behaviour; the classification
follows the cited tables. It still overwrites S, so it is deterministic,
not harmless.

The safe tier is what almost every demoscene production uses. The unstable
tier shows up in a small number of effects where the instability itself is
the point (random-number generation), but most demos avoid them. KIL/JAM
opcodes are used as crash-out markers and occasionally as fuses in
copy-protection routines.

### Per-revision availability

Tested behavior of the safe illegal opcodes is **identical** on:

- 6502 (Apple I, Apple II, Atari 2600/400/800, NES, BBC Micro early)
- 6510 (Commodore 64)
- 8500 (Commodore 64C, late breadbins; an earlier revision of this page
  also listed the C128 here; the C128 has no 8500)
- 8502 (Commodore 128; its only 65xx CPU, in C128 mode and C64 mode
  alike; same logic as the 8500, 2 MHz capable. The C128 part name is as
  VICE x128 reports it, not measured on hardware)
- 2A03 (NES: a 6502 with disabled BCD)

Tested behavior of the unstable illegal opcodes **varies** between these
parts and sometimes within the same part (different production runs of the
6502 differ on XAA, for example). Only testing on real hardware
settles it.

## Quick reference

All 105 undocumented opcodes are listed below: 20 mnemonics, of which 27
opcodes are NOPs and 12 are KIL/JAM. (An earlier revision omitted eight
SRE/RRA/RLA addressing modes and the $EB SBC alias.) Each has a full H3
entry later with cycles, flags, and behavioral notes.

| Opcode | Mnemonic   | Mode    | Operation                         | Cycles | Stable? |
|--------|------------|---------|-----------------------------------|--------|---------|
| $0B    | ANC #imm   | imm     | A &= imm; C = N                   | 2      | yes     |
| $2B    | ANC #imm   | imm     | A &= imm; C = N (alias of $0B)    | 2      | yes     |
| $4B    | ALR #imm   | imm     | A = (A & imm) >> 1                | 2      | yes     |
| $6B    | ARR #imm   | imm     | A = ((A & imm) >> 1) + ROR carry  | 2      | yes     |
| $8B    | XAA #imm   | imm     | A = (A \| magic) & X & imm        | 2      | NO      |
| $AB    | LAX #imm   | imm     | A = X = (A \| magic) & imm        | 2      | NO      |
| $CB    | AXS #imm   | imm     | X = (A & X) - imm; sets C as CMP  | 2      | yes     |
| $EB    | SBC #imm   | imm     | A = A - imm - !C (alias of $E9)   | 2      | yes     |
| $A3    | LAX (zp,X) | (zp,X)  | A = X = M                         | 6      | yes     |
| $A7    | LAX zp     | zp      | A = X = M                         | 3      | yes     |
| $AF    | LAX abs    | abs     | A = X = M                         | 4      | yes     |
| $B3    | LAX (zp),Y | (zp),Y  | A = X = M  (+1 on page cross)     | 5      | yes     |
| $B7    | LAX zp,Y   | zp,Y    | A = X = M                         | 4      | yes     |
| $BF    | LAX abs,Y  | abs,Y   | A = X = M  (+1 on page cross)     | 4      | yes     |
| $83    | SAX (zp,X) | (zp,X)  | M = A & X                         | 6      | yes     |
| $87    | SAX zp     | zp      | M = A & X                         | 3      | yes     |
| $8F    | SAX abs    | abs     | M = A & X                         | 4      | yes     |
| $97    | SAX zp,Y   | zp,Y    | M = A & X                         | 4      | yes     |
| $C3    | DCP (zp,X) | (zp,X)  | M-- ; CMP A,M                     | 8      | yes     |
| $C7    | DCP zp     | zp      | M-- ; CMP A,M                     | 5      | yes     |
| $CF    | DCP abs    | abs     | M-- ; CMP A,M                     | 6      | yes     |
| $D3    | DCP (zp),Y | (zp),Y  | M-- ; CMP A,M                     | 8      | yes     |
| $D7    | DCP zp,X   | zp,X    | M-- ; CMP A,M                     | 6      | yes     |
| $DB    | DCP abs,Y  | abs,Y   | M-- ; CMP A,M                     | 7      | yes     |
| $DF    | DCP abs,X  | abs,X   | M-- ; CMP A,M                     | 7      | yes     |
| $E3    | ISC (zp,X) | (zp,X)  | M++ ; SBC M                       | 8      | yes     |
| $E7    | ISC zp     | zp      | M++ ; SBC M                       | 5      | yes     |
| $EF    | ISC abs    | abs     | M++ ; SBC M                       | 6      | yes     |
| $F3    | ISC (zp),Y | (zp),Y  | M++ ; SBC M                       | 8      | yes     |
| $F7    | ISC zp,X   | zp,X    | M++ ; SBC M                       | 6      | yes     |
| $FB    | ISC abs,Y  | abs,Y   | M++ ; SBC M                       | 7      | yes     |
| $FF    | ISC abs,X  | abs,X   | M++ ; SBC M                       | 7      | yes     |
| $03    | SLO (zp,X) | (zp,X)  | M <<= 1 ; A \|= M                 | 8      | yes     |
| $07    | SLO zp     | zp      | M <<= 1 ; A \|= M                 | 5      | yes     |
| $0F    | SLO abs    | abs     | M <<= 1 ; A \|= M                 | 6      | yes     |
| $13    | SLO (zp),Y | (zp),Y  | M <<= 1 ; A \|= M                 | 8      | yes     |
| $17    | SLO zp,X   | zp,X    | M <<= 1 ; A \|= M                 | 6      | yes     |
| $1B    | SLO abs,Y  | abs,Y   | M <<= 1 ; A \|= M                 | 7      | yes     |
| $1F    | SLO abs,X  | abs,X   | M <<= 1 ; A \|= M                 | 7      | yes     |
| $23    | RLA (zp,X) | (zp,X)  | M = ROL M ; A &= M                | 8      | yes     |
| $27    | RLA zp     | zp      | M = ROL M ; A &= M                | 5      | yes     |
| $2F    | RLA abs    | abs     | M = ROL M ; A &= M                | 6      | yes     |
| $33    | RLA (zp),Y | (zp),Y  | M = ROL M ; A &= M                | 8      | yes     |
| $37    | RLA zp,X   | zp,X    | M = ROL M ; A &= M                | 6      | yes     |
| $3B    | RLA abs,Y  | abs,Y   | M = ROL M ; A &= M                | 7      | yes     |
| $3F    | RLA abs,X  | abs,X   | M = ROL M ; A &= M                | 7      | yes     |
| $43    | SRE (zp,X) | (zp,X)  | M >>= 1 ; A ^= M                  | 8      | yes     |
| $47    | SRE zp     | zp      | M >>= 1 ; A ^= M                  | 5      | yes     |
| $4F    | SRE abs    | abs     | M >>= 1 ; A ^= M                  | 6      | yes     |
| $53    | SRE (zp),Y | (zp),Y  | M >>= 1 ; A ^= M                  | 8      | yes     |
| $57    | SRE zp,X   | zp,X    | M >>= 1 ; A ^= M                  | 6      | yes     |
| $5B    | SRE abs,Y  | abs,Y   | M >>= 1 ; A ^= M                  | 7      | yes     |
| $5F    | SRE abs,X  | abs,X   | M >>= 1 ; A ^= M                  | 7      | yes     |
| $63    | RRA (zp,X) | (zp,X)  | M = ROR M ; ADC M                 | 8      | yes     |
| $67    | RRA zp     | zp      | M = ROR M ; ADC M                 | 5      | yes     |
| $6F    | RRA abs    | abs     | M = ROR M ; ADC M                 | 6      | yes     |
| $73    | RRA (zp),Y | (zp),Y  | M = ROR M ; ADC M                 | 8      | yes     |
| $77    | RRA zp,X   | zp,X    | M = ROR M ; ADC M                 | 6      | yes     |
| $7B    | RRA abs,Y  | abs,Y   | M = ROR M ; ADC M                 | 7      | yes     |
| $7F    | RRA abs,X  | abs,X   | M = ROR M ; ADC M                 | 7      | yes     |
| $93    | AHX (zp),Y | (zp),Y  | M = A & X & (H+1)                 | 6      | NO      |
| $9F    | AHX abs,Y  | abs,Y   | M = A & X & (H+1)                 | 5      | NO      |
| $9B    | TAS abs,Y  | abs,Y   | S=A&X ; M=A&X&(H+1)               | 5      | NO      |
| $BB    | LAS abs,Y  | abs,Y   | A = X = S = M & S  (+1 on page cross) | 4  | yes     |
| $9E    | SHX abs,Y  | abs,Y   | M = X & (H+1)                     | 5      | NO      |
| $9C    | SHY abs,X  | abs,X   | M = Y & (H+1)                     | 5      | NO      |
| $02    | KIL/JAM    | impl    | halts CPU                         | —      | fatal   |

Additional undocumented NOPs (do nothing but consume bytes/cycles):

| Opcode | Mnemonic | Mode  | Cycles | Notes                        |
|--------|----------|-------|--------|------------------------------|
| $1A    | NOP      | impl  | 2      | undocumented 1-byte NOP      |
| $3A    | NOP      | impl  | 2      | undocumented 1-byte NOP      |
| $5A    | NOP      | impl  | 2      | undocumented 1-byte NOP      |
| $7A    | NOP      | impl  | 2      | undocumented 1-byte NOP      |
| $DA    | NOP      | impl  | 2      | undocumented 1-byte NOP      |
| $FA    | NOP      | impl  | 2      | undocumented 1-byte NOP      |
| $80    | NOP #imm | imm   | 2      | undocumented 2-byte NOP      |
| $82    | NOP #imm | imm   | 2      | undocumented 2-byte NOP      |
| $89    | NOP #imm | imm   | 2      | undocumented 2-byte NOP      |
| $C2    | NOP #imm | imm   | 2      | undocumented 2-byte NOP      |
| $E2    | NOP #imm | imm   | 2      | undocumented 2-byte NOP      |
| $04    | NOP zp   | zp    | 3      | reads zp; flags unaffected   |
| $44    | NOP zp   | zp    | 3      | reads zp; flags unaffected   |
| $64    | NOP zp   | zp    | 3      | reads zp; flags unaffected   |
| $14    | NOP zp,X | zp,X  | 4      | reads zp,X                   |
| $34    | NOP zp,X | zp,X  | 4      | reads zp,X                   |
| $54    | NOP zp,X | zp,X  | 4      | reads zp,X                   |
| $74    | NOP zp,X | zp,X  | 4      | reads zp,X                   |
| $D4    | NOP zp,X | zp,X  | 4      | reads zp,X                   |
| $F4    | NOP zp,X | zp,X  | 4      | reads zp,X                   |
| $0C    | NOP abs  | abs   | 4      | reads abs (4-cycle TOP)      |
| $1C    | NOP abs,X | abs,X | 4     | +1 on page cross             |
| $3C    | NOP abs,X | abs,X | 4     | +1 on page cross             |
| $5C    | NOP abs,X | abs,X | 4     | +1 on page cross             |
| $7C    | NOP abs,X | abs,X | 4     | +1 on page cross             |
| $DC    | NOP abs,X | abs,X | 4     | +1 on page cross             |
| $FC    | NOP abs,X | abs,X | 4     | +1 on page cross             |

KIL/JAM opcodes (CPU halt; these hang until reset):

| Opcode | Mnemonic | Notes                                    |
|--------|----------|------------------------------------------|
| $02    | KIL      | halts CPU                                |
| $12    | KIL      | halts CPU                                |
| $22    | KIL      | halts CPU                                |
| $32    | KIL      | halts CPU                                |
| $42    | KIL      | halts CPU                                |
| $52    | KIL      | halts CPU                                |
| $62    | KIL      | halts CPU                                |
| $72    | KIL      | halts CPU                                |
| $92    | KIL      | halts CPU                                |
| $B2    | KIL      | halts CPU                                |
| $D2    | KIL      | halts CPU                                |
| $F2    | KIL      | halts CPU                                |

## Safe illegal opcodes

The instructions in this section are reliable across every 6502/6510/8500
ever shipped. They fall into families by which two
legal operations they combine.

### Combined load: LAX

**LAX** = LDA + LDX from the same memory operand. Stores the loaded byte
into both A and X in a single 3- or 4-cycle instruction instead of two
separate 3- or 4-cycle loads (6–8 cycles). Available in zp, zp,Y, abs,
abs,Y, (zp,X) and (zp),Y, and *not* zp,X or abs,X. That is not the set of
modes LDA and LDX have in common (only zp, abs, abs,Y and immediate are):
LAX takes LDA's modes with the zp,X and abs,X slots replaced by LDX's zp,Y
and abs,Y, and keeps (zp,X). An earlier version of this page called the six
"the modes LDA and LDX share" (KickAssembler 5.25: `lda $10,y` is silently
promoted to abs,Y $B9, and `ldx ($10),y`, `ldx ($10,x)`, `lax $10,x` are
refused).

The N and Z flags are set from the loaded byte. C, V, D, I are unchanged.

The immediate form `LAX #imm` ($AB) is **unstable**; see
[XAA/LAX immediate](#ab--lax-imm--load-a-and-x-immediate-unstable).

### Combined store: SAX (other references call it AXS or AAX — in this document, in KickAssembler and in ca65, AXS is the $CB subtract-into-X, and neither assembler accepts `axs` with an address operand or knows `aax`; see the Pitfalls note on mnemonics)

**SAX** = STA bitwise-ANDed with X. Stores the value `A & X` to memory.
No flags are affected. Useful with a precomputed mask in X, to
store the masked accumulator value without disturbing A or doing
a separate AND. Two-in-one in 3-4 cycles.

Modes: zp, zp,Y, abs, (zp,X). No X-indexed variant (X is a source).

Frequently used in zeropage table generation: build the table once with
LAX from a source, transform with bit math, write back with SAX, all
without losing X.

### AND-then-set-carry: ANC

**ANC** = AND + copy-bit-7-to-carry. Performs A &= imm, sets N and Z from
the result, and copies bit 7 of the result into C, in one 2-cycle
instruction. The C it leaves is the one `AND #imm : CMP #$80` would leave,
but N and Z are not: CMP #$80 inverts N and sets Z only for a result of
$80 (measured in VICE x64sc: with A=$C5, `anc #$80` leaves A=$80, N=1 Z=0
C=1; `and #$80 : cmp #$80` leaves N=0 Z=1 C=1). An earlier version of this
page called the two sequences identical.

The 6502 silicon has two opcodes for this, $0B and $2B, that do
identical things. Most assemblers accept either.

Useful when the sign of a masked value has to end up in C: for a
following ROL/ROR/ADC/SBC, or so that a later instruction that rewrites N
still leaves the sign test in C. It saves nothing on a plain sign branch:
`and #$80 : bmi` needs no compare either, and takes the same branch as
`anc #$80 : bcs` for every value of A (measured in VICE x64sc, 0
mismatches over 256). An earlier version of this page gave "branch on the
sign without a separate compare" as the use; that compare was never
needed.

### AND-then-shift-right: ALR (a.k.a. ASR)

**ALR** = AND + LSR. Computes `A = (A & imm) >> 1`. The C flag receives
bit 0 of the AND result (i.e., the bit shifted out). Sets N (always 0,
since LSR clears bit 7) and Z from the shifted result. Two cycles.

Equivalent in effect to `AND #imm : LSR A` (4 cycles, 3 bytes; an
earlier version said 4 bytes) compressed into 2 cycles, 2 bytes.

### AND-then-rotate-right: ARR

**ARR** = AND + ROR with different flags. In binary mode the accumulator
is exactly what `AND #imm : ROR A` would leave (measured in VICE x64sc: 0
of 512 operand/carry-in cases differ); only C and V differ:

- `A = (A & imm) >> 1`, with C-in shifted into bit 7
- C = bit 6 of the result (NOT bit 0)
- V = bit 6 XOR bit 5 of the result
- N, Z from the result

In decimal mode (D=1) ARR diverges further: the ROR result is BCD-adjusted
(+$06 if the low nibble of the AND result plus its bit 0 exceeds 5, +$60
if the high nibble plus its bit 4 exceeds $50), C is 1 exactly when the
+$60 fix-up fires rather than bit 6 of the result, and N is the carry-in
rather than bit 7 of the final A. So in decimal mode the accumulator
itself differs from AND + ROR (462 of 512 cases in VICE x64sc) and N no
longer reads the result's sign (352 of 512). An earlier version of this
page had the two modes the wrong way round. The C/V rule is
useful in shift-and-test sequences because C ends up holding what would
have been the carry-out of an add.

### Rotate-then-OR/AND/EOR/ADC families (RMW)

These four save three to five cycles, depending on addressing mode,
each time a byte in memory is bit-shifted and the accumulator updated
with it:

| Mnemonic | Equivalent legal pair | Bytes saved | Cycles saved |
|----------|-----------------------|-------------|--------------|
| SLO     | ASL mem : ORA mem     | 2 (zp, zp,X, (zp,X), (zp),Y) / 3 (abs, abs,X, abs,Y) | 3 (zp), 4 (abs, zp,X), 4-5 (abs,X: the legal ORA pays the page-cross cycle, the RMW never does) |
| RLA     | ROL mem : AND mem     | 2 (zp, zp,X, (zp,X), (zp),Y) / 3 (abs, abs,X, abs,Y) | 3 (zp), 4 (abs, zp,X), 4-5 (abs,X) |
| SRE     | LSR mem : EOR mem     | 2 (zp, zp,X, (zp,X), (zp),Y) / 3 (abs, abs,X, abs,Y) | 3 (zp), 4 (abs, zp,X), 4-5 (abs,X) |
| RRA     | ROR mem : ADC mem     | 2 (zp, zp,X, (zp,X), (zp),Y) / 3 (abs, abs,X, abs,Y) | 3 (zp), 4 (abs, zp,X), 4-5 (abs,X) |

(An earlier version of this table said 2 bytes and 2-3 cycles for every
mode; a 2-cycle saving never occurs. Measured in VICE x64sc: zp 5 vs 8,
abs 6 vs 10, zp,X 6 vs 10, abs,X 7 vs 11 or 12.) The legal shifts have no
abs,Y, (zp,X) or (zp),Y form, so the "equivalent legal pair" column does
not apply to those three modes; there the saving is against a
load/shift/store/ORA sequence and is larger.

Available in every RMW addressing mode (zp, zp,X, abs, abs,X, abs,Y,
(zp,X), (zp),Y). Cycle counts match the equivalent legal RMW (5/6/7/8
cycles depending on mode). Flags: SLO/RLA/SRE set N, Z, C; RRA sets N, Z,
V, C (because it ends in ADC and inherits its V semantics).

Classic use: a multiplexer routine that needs to shift a sprite control
byte and OR it into a register-image table in one instruction. RLA is
similarly used for masking-in bits while rotating a flags byte.

### Decrement-then-compare: DCP

**DCP** = DEC mem + CMP. Decrements memory and then compares A against the
new value. Sets N, Z, C from the comparison. Useful in countdown loops
that decrement a counter and branch on a specific reached
value without restoring A:

```asm
  loop:
    ; ... do work using A ...
    dcp counter        ; counter-- ; CMP A,counter
    bne loop
```

In legal-only code this needs `DEC counter : LDA #target : CMP counter`
(10 cycles with a zero-page counter, 12 absolute; an earlier version said
7+); DCP zp is 5 cycles flat. The shortest legal equivalent that, like
DCP, compares A against the decremented value is `dec counter : cmp
counter` (8 cycles zp, measured in VICE x64sc), so the saving DCP
buys is 3 cycles, not 5.

### Increment-then-subtract: ISC (a.k.a. ISB, INS)

**ISC** = INC mem + SBC. Increments memory, then subtracts the new value
from A with borrow. Sets N, Z, C, V from the subtraction. The compound is
useful for accumulating signed differences against an incrementing index.

### AND-then-subtract: AXS (a.k.a. SBX)

**AXS** = `X = (A & X) - imm`. Performs the AND of A and X, subtracts an
immediate, stores the result in X. The carry and N/Z flags reflect the
comparison the same way CMP would. **Decimal mode does not apply**: AXS
is always binary, even with D=1. This is the only 6502 instruction that
ignores decimal mode for subtraction.

Useful as a "test-then-decrement-X" combo when X holds a loop counter
masked against the accumulator.

### Load A, X and S: LAS (a.k.a. LAR)

**LAS** = `A = X = S = M & S`, abs,Y only ($BB). Reads memory, ANDs it
with the current stack pointer and writes the result into A, X and S at
once; N and Z from the result; 4 cycles, +1 on page cross. It writes S,
so restore the stack pointer before the next push or return. An earlier
version of this page listed it among the unstable opcodes; see the note
under the tier table and the $BB entry.

### Undocumented NOPs

The 6502 has ~27 undocumented NOPs scattered across the opcode map.
They consume 1, 2, or 3 bytes and 2 to 5 cycles depending on the
addressing mode the decoder *would* have applied if the opcode were
legal. Common uses:

- **Padding** for cycle-exact timing in raster code.
- **Branch-target alignment** to ensure a branch never crosses a page
  boundary (and thus has a predictable cycle count).
- **Skip-next-instruction** tricks: a 2-byte NOP $80/$82/$89 will swallow
  the byte that follows it, so code can jump into the middle of a
  two-byte sequence and have it decode as one thing on entry and another
  as a fall-through.

The 3-cycle and 4-cycle NOPs (`NOP zp`, `NOP abs`, `NOP abs,X`) perform a
read of the addressed location with no effect. The read *is* visible on
the address bus, which can have side effects on memory-mapped I/O. Be
careful with `NOP $D019` for example, because reading $D019 has no side
effect but reading some other I/O addresses does.

## Unstable illegal opcodes

These instructions involve internal buses whose values are not fully
controlled by the rest of the chip. The result on real hardware depends
on chip revision, die batch, temperature, and sometimes the immediately
preceding instruction's data bus contents. **Do not use these in
production code** unless the goal is to exploit the instability itself
(rare RNG schemes).

### XAA (a.k.a. ANE)

`A = (A | magic) & X & imm`. The "magic" constant is the value the chip's
internal bus floats to during the operand fetch. Values reported for NMOS
parts include $EE, $EF, $FF and $00, and on one chip it can differ between
fetches depending on whether the VIC-II held RDY low (a badline or sprite
DMA) on that cycle. None of this is measured on silicon here. VICE (x64sc
and x64, 3.10 on this machine) uses $EF (measured: `lda #$00 : ldx #$ff :
xaa #$ff` leaves A=$EF) and substitutes $EE when the operand fetch fell on
a RDY cycle (from VICE's own release notes, not measured here). The result
equals `X & imm` only for the bits of `imm` that are set in `A | magic`;
with A=$FF preloaded it is `X & imm` for every magic value. An earlier
revision of this page said magic was $FF on most silicon; none of the
sources it cites says so and VICE does not model it.

### LAX #imm (a.k.a. LXA)

`A = X = (A | magic) & imm`, not `A = X = imm`. Same mechanism as XAA,
without the X term. VICE uses $EE (its NEWS: 3.5 set $EF, 3.6 "changed to
0xEE as required by wizball"), measured: `lda #$00 : lax #$ff` gives
A=X=$EE and `lda #$00 : lax #$55` gives $44. It loads `imm` only for the
bits set in `A | magic`; preload A=$FF if the instruction cannot be
avoided. Oxyron's table, this page's primary source, reports that on the
author's own C64-II the opcode "loses bits" (`ORA #? : AND #imm : TAX`),
so "works on most parts" was never what the source said; the
memory-addressed LAX forms are unaffected.

### AHX (a.k.a. SHA, AXA)

`M[addr] = A & X & (H+1)` where H is the high byte of the target
address. The `H+1` term comes from a half-cycle race between the
address-bus high byte and the data-output drivers. If the address
crosses a page boundary, the high byte feedback is corrupted and the
result is unpredictable.

### TAS (a.k.a. SHS, XAS)

`S = A & X ; M[addr] = A & X & (H+1)`. Has the same `(H+1)` instability
as AHX, plus it clobbers the stack pointer S, so even an emulator-stable
form trashes the stack.

### SHX / SHY (a.k.a. SXA / SYA)

`M[addr] = X & (H+1)` and `M[addr] = Y & (H+1)`. Same `(H+1)` quirk as
AHX. It stores an index masked against the target's high byte, which few
programs need.

## KIL/JAM

Twelve opcodes ($02, $12, $22, $32, $42, $52, $62, $72, $92, $B2, $D2,
$F2) cause the CPU to enter a state where the instruction-cycle clock
keeps advancing but the PC, registers, and flags never change. The chip
is alive (its address bus continues to walk through the dead instruction
fetch) but the only way out is RESET. Even NMI and IRQ are ignored.

Their use is as crash-out markers. In some copy-protection
schemes, a deliberately-placed KIL after a checksum failure ensures the
cracker has to manually patch the code rather than letting the program
fall through to a meaningful error path. In many emulators, hitting a
KIL pops a debugger.

Mnemonics in the wild: `KIL`, `JAM`, `HLT`, `CIM`, `CRASH`. All point at
the same behavior.

## Detailed opcode list

### $0B — ANC #imm — AND immediate, copy bit 7 to carry (illegal)

**Cycles:** 2
**Flags:** N Z C
**Legal:** no

Performs `A &= imm` and copies bit 7 of the result into the C flag.
Leaves the same C as `AND #imm : CMP #$80`, but N and Z come from the AND
result, which CMP would not give; the two are not identical (an earlier
version said identical; N is inverted and Z differs, measured in VICE
x64sc; see the ANC section). The duplicate opcode $2B does the same
thing. Stable on all NMOS parts.

### $2B — ANC #imm — AND immediate, copy bit 7 to carry (illegal alias)

**Cycles:** 2
**Flags:** N Z C
**Legal:** no

Identical to $0B. The 6502 decode matrix maps both $0B and $2B to the
same micro-operation. Some assemblers emit $0B; others emit $2B; some
let you choose.

### $4B — ALR #imm — AND immediate then LSR (illegal)

**Cycles:** 2
**Flags:** N Z C
**Legal:** no

Computes `A = (A & imm) >> 1`. C receives bit 0 of `A & imm` (the bit
shifted out). N is always 0 after the LSR. Z reflects the final result.
Equivalent to `AND #imm : LSR A` but one instruction shorter and faster.

Also published as **ASR** in some references. The mnemonic ALR is from
the Oxyron table.

### $6B — ARR #imm — AND immediate then ROR with quirky flags (illegal)

**Cycles:** 2
**Flags:** N Z C V
**Legal:** no

Binary mode: `A = ROR(A & imm)` with C-in shifted into bit 7. The
output flags do *not* match a simple ROR:

- C = bit 6 of the final result
- V = bit 6 XOR bit 5 of the final result

In decimal mode (D=1) the result is BCD-adjusted (+$06 / +$60 fix-ups as
for ADC), C = 1 iff the high-nibble fix-up fired, N = carry-in, V = bit 6
XOR bit 5 of the un-adjusted ROR result. Example, measured in VICE x64sc:
SED CLC LDA #$FF ARR #$60 gives A=$90 C=1 where binary mode gives A=$30
C=0. (An earlier version of this entry said the decimal-mode C/V equal an
ADC's; the accumulator itself changes, not only the flags.)

Used in CRC and shift-and-detect-pattern routines.

### $8B — XAA #imm — Load A and X immediate (unstable)

**Cycles:** 2
**Flags:** N Z
**Legal:** no

`A = (A | magic) & X & imm`. The magic constant is the value the chip's
internal bus floats to during the operand fetch; values reported for NMOS
parts include $EE, $EF, $FF and $00, none measured on silicon here. VICE
(x64sc and x64, 3.10 on this machine) uses $EF, measured: `lda #$00 : ldx
#$ff : xaa #$ff` leaves A=$EF. The result equals `X & imm` only for the
bits of `imm` that are set in `A | magic`; with A=$FF preloaded it is
`X & imm` for every magic value. An earlier revision of this entry said
magic was $FF on most silicon; none of the cited sources says so and VICE
does not model it. **Unstable.** Do not use in production.

Also known as ANE.

### $AB — LAX #imm — Load A and X immediate (unstable)

**Cycles:** 2
**Flags:** N Z
**Legal:** no

Immediate-mode LAX. `A = X = (A | magic) & imm`, not `A = X = imm`. Same
floating-bus mechanism as XAA, without the X term. VICE uses $EE,
measured: `lda #$00 : lax #$ff` gives A=X=$EE and `lda #$00 : lax #$55`
gives $44; it loads `imm` only for the bits set in `A | magic`, so
preload A=$FF if the instruction cannot be avoided. An earlier revision of
this entry said it works on most parts; Oxyron's table reports that it
"loses bits" on the author's own C64-II. **Unstable.** The zero-page and
absolute LAX forms ($A3/$A7/$AF/$B3/$B7/$BF) are stable; only the
immediate form is risky.

### $CB — AXS #imm — AND A with X, subtract immediate into X (illegal)

**Cycles:** 2
**Flags:** N Z C
**Legal:** no

`X = (A & X) - imm`. The subtraction sets C the same way CMP does (C=1
if no borrow). Decimal mode is *ignored*: AXS always executes binary
subtraction. Useful as a fused "mask-and-decrement-X" in tight loops.

Also called SBX.

### $EB — SBC #imm — Subtract immediate (undocumented alias of $E9)

**Cycles:** 2
**Flags:** N Z C V
**Legal:** no

`A = A - imm - !C`. Identical arithmetic and flags to the official
`SBC #imm` ($E9), decimal mode included; 2 cycles, measured in VICE x64sc.
Assemblers never emit it for `sbc #`, so it only appears in hand-assembled
or obfuscated code. Stable.

### $A3 — LAX (zp,X) — Load A and X indirect-X (illegal)

**Cycles:** 6
**Flags:** N Z
**Legal:** no

`A = X = M[ind16(zp+X)]`. Loads through the X-indexed pointer in zero
page (the classic indirect-X mode). Stable.

### $A7 — LAX zp — Load A and X from zero page (illegal)

**Cycles:** 3
**Flags:** N Z
**Legal:** no

`A = X = M[zp]`. The fastest LAX form. Stable. Replaces a `LDA zp : LDX
zp` pair (6 cycles, 4 bytes) with 3 cycles, 2 bytes.

### $AF — LAX abs — Load A and X from absolute (illegal)

**Cycles:** 4
**Flags:** N Z
**Legal:** no

`A = X = M[abs]`. Absolute-addressed LAX. Stable.

### $B3 — LAX (zp),Y — Load A and X indirect-Y (illegal)

**Cycles:** 5
**Flags:** N Z
**Page-cross:** +1
**Legal:** no

`A = X = M[ind16(zp)+Y]`. Indirect-Y LAX. Adds one cycle when the
indexed read crosses a page boundary. Stable.

### $B7 — LAX zp,Y — Load A and X from zp,Y (illegal)

**Cycles:** 4
**Flags:** N Z
**Legal:** no

`A = X = M[zp+Y]`. Y-indexed zero-page LAX. Stable. The 6502 wraps
within the zero page (zp+Y stays in $00-$FF).

### $BF — LAX abs,Y — Load A and X from abs,Y (illegal)

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1
**Legal:** no

`A = X = M[abs+Y]`. Stable. +1 cycle on page cross.

### $83 — SAX (zp,X) — Store A AND X indirect-X (illegal)

**Cycles:** 6
**Flags:** —
**Legal:** no

`M[ind16(zp+X)] = A & X`. Stores the bitwise AND of A and X. No flags
affected. Stable.

### $87 — SAX zp — Store A AND X to zero page (illegal)

**Cycles:** 3
**Flags:** —
**Legal:** no

`M[zp] = A & X`. The shortest SAX. Stable. Replaces an `STX zp : AND
#mask : STA zp` sequence when you need a precomputed mask.

### $8F — SAX abs — Store A AND X to absolute (illegal)

**Cycles:** 4
**Flags:** —
**Legal:** no

`M[abs] = A & X`. Absolute SAX. Stable.

### $97 — SAX zp,Y — Store A AND X to zp,Y (illegal)

**Cycles:** 4
**Flags:** —
**Legal:** no

`M[zp+Y] = A & X`. Y-indexed zero-page SAX. Wraps in zero page. Stable.

### $C3 — DCP (zp,X) — Decrement then compare A indirect-X (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M-- ; sets N Z C from (A - M)`. Stable.

### $C7 — DCP zp — Decrement then compare A in zero page (illegal)

**Cycles:** 5
**Flags:** N Z C
**Legal:** no

`M[zp]-- ; sets N Z C from (A - M[zp])`. The most useful DCP form for
zero-page loop counters. Stable.

### $CF — DCP abs — Decrement then compare A absolute (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[abs]-- ; sets N Z C from (A - M[abs])`. Stable.

### $D3 — DCP (zp),Y — Decrement then compare A indirect-Y (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M[ind16(zp)+Y]-- ; sets N Z C from (A - M)`. RMW form; page-cross
penalty is *already included* in the 8-cycle count (RMW always pays
for both reads). Stable.

### $D7 — DCP zp,X — Decrement then compare A zp,X (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[zp+X]-- ; sets N Z C from (A - M[zp+X])`. Wraps in zero page. Stable.

### $DB — DCP abs,Y — Decrement then compare A abs,Y (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+Y]-- ; sets N Z C from (A - M[abs+Y])`. RMW form, no extra
page-cross penalty (the 7-cycle count is the worst case). Stable.

### $DF — DCP abs,X — Decrement then compare A abs,X (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+X]-- ; sets N Z C from (A - M[abs+X])`. RMW form. Stable.

### $E3 — ISC (zp,X) — Increment then SBC indirect-X (illegal)

**Cycles:** 8
**Flags:** N Z C V
**Legal:** no

`M++ ; A = A - M - (1 - C)`. Sets N, Z, V, C from the SBC. Stable.

Also written as ISB or INS in some references.

### $E7 — ISC zp — Increment then SBC zero page (illegal)

**Cycles:** 5
**Flags:** N Z C V
**Legal:** no

`M[zp]++ ; A = A - M[zp] - (1 - C)`. Stable.

### $EF — ISC abs — Increment then SBC absolute (illegal)

**Cycles:** 6
**Flags:** N Z C V
**Legal:** no

`M[abs]++ ; A = A - M[abs] - (1 - C)`. Stable.

### $F3 — ISC (zp),Y — Increment then SBC indirect-Y (illegal)

**Cycles:** 8
**Flags:** N Z C V
**Legal:** no

`M[ind16(zp)+Y]++ ; A = A - M - (1 - C)`. Stable.

### $F7 — ISC zp,X — Increment then SBC zp,X (illegal)

**Cycles:** 6
**Flags:** N Z C V
**Legal:** no

`M[zp+X]++ ; A = A - M[zp+X] - (1 - C)`. Wraps in zero page. Stable.

### $FB — ISC abs,Y — Increment then SBC abs,Y (illegal)

**Cycles:** 7
**Flags:** N Z C V
**Legal:** no

`M[abs+Y]++ ; A = A - M[abs+Y] - (1 - C)`. Stable.

### $FF — ISC abs,X — Increment then SBC abs,X (illegal)

**Cycles:** 7
**Flags:** N Z C V
**Legal:** no

`M[abs+X]++ ; A = A - M[abs+X] - (1 - C)`. Stable.

### $03 — SLO (zp,X) — ASL memory then ORA indirect-X (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M <<= 1 ; A |= M`. C receives the bit shifted out of memory. Stable.

### $07 — SLO zp — ASL zero page then ORA (illegal)

**Cycles:** 5
**Flags:** N Z C
**Legal:** no

`M[zp] <<= 1 ; A |= M[zp]`. The fastest SLO form. Common in
demoscene multiplexer code for shifting a sprite index byte and ORing
it into a register-image accumulator. Stable.

### $0F — SLO abs — ASL absolute then ORA (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[abs] <<= 1 ; A |= M[abs]`. Stable.

### $13 — SLO (zp),Y — ASL memory then ORA indirect-Y (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M[ind16(zp)+Y] <<= 1 ; A |= M`. RMW form; page-cross cost already
included. Stable.

### $17 — SLO zp,X — ASL zp,X then ORA (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[zp+X] <<= 1 ; A |= M[zp+X]`. Wraps in zero page. Stable.

### $1B — SLO abs,Y — ASL abs,Y then ORA (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+Y] <<= 1 ; A |= M[abs+Y]`. Stable.

### $1F — SLO abs,X — ASL abs,X then ORA (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+X] <<= 1 ; A |= M[abs+X]`. Stable.

### $23 — RLA (zp,X) — ROL memory then AND indirect-X (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M = ROL(M) ; A &= M`. Carry rotates through bit 0 of M. Stable.

### $27 — RLA zp — ROL zero page then AND (illegal)

**Cycles:** 5
**Flags:** N Z C
**Legal:** no

`M[zp] = ROL(M[zp]) ; A &= M[zp]`. The fast RLA form. Used in
multiplexer mask-rotation. Stable.

### $2F — RLA abs — ROL absolute then AND (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[abs] = ROL(M[abs]) ; A &= M[abs]`. Stable.

### $33 — RLA (zp),Y — ROL memory then AND indirect-Y (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M[ind16(zp)+Y] = ROL(M) ; A &= M`. RMW form; page-cross cost already
included; cycles measured in VICE x64sc; no page-cross penalty (RMW).
Stable. (Omitted from an earlier revision of this page.)

### $37 — RLA zp,X — ROL zp,X then AND (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[zp+X] = ROL(M[zp+X]) ; A &= M[zp+X]`. Wraps in zero page. Stable.

### $3B — RLA abs,Y — ROL abs,Y then AND (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+Y] = ROL(M[abs+Y]) ; A &= M[abs+Y]`. Stable.

### $3F — RLA abs,X — ROL abs,X then AND (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+X] = ROL(M[abs+X]) ; A &= M[abs+X]`. Stable.

### $43 — SRE (zp,X) — LSR memory then EOR indirect-X (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M >>= 1 ; A ^= M`. C receives bit 0 of M before the shift. Stable.

### $47 — SRE zp — LSR zero page then EOR (illegal)

**Cycles:** 5
**Flags:** N Z C
**Legal:** no

`M[zp] >>= 1 ; A ^= M[zp]`. Stable.

### $4F — SRE abs — LSR absolute then EOR (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[abs] >>= 1 ; A ^= M[abs]`. Stable.

### $53 — SRE (zp),Y — LSR memory then EOR indirect-Y (illegal)

**Cycles:** 8
**Flags:** N Z C
**Legal:** no

`M[ind16(zp)+Y] >>= 1 ; A ^= M`. RMW form; page-cross cost already
included; cycles measured in VICE x64sc; no page-cross penalty (RMW).
Stable. (Omitted from an earlier revision of this page.)

### $57 — SRE zp,X — LSR zp,X then EOR (illegal)

**Cycles:** 6
**Flags:** N Z C
**Legal:** no

`M[zp+X] >>= 1 ; A ^= M[zp+X]`. Wraps in zero page. Cycles measured in
VICE x64sc; no page-cross penalty (RMW). Stable. (Omitted from an earlier
revision of this page.)

### $5B — SRE abs,Y — LSR abs,Y then EOR (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+Y] >>= 1 ; A ^= M[abs+Y]`. Cycles measured in VICE x64sc; no
page-cross penalty (RMW). Stable. (Omitted from an earlier revision of
this page.)

### $5F — SRE abs,X — LSR abs,X then EOR (illegal)

**Cycles:** 7
**Flags:** N Z C
**Legal:** no

`M[abs+X] >>= 1 ; A ^= M[abs+X]`. Stable.

### $63 — RRA (zp,X) — ROR memory then ADC indirect-X (illegal)

**Cycles:** 8
**Flags:** N Z C V
**Legal:** no

`M = ROR(M) ; A = A + M + C`. Sets V from the ADC. Stable.

### $67 — RRA zp — ROR zero page then ADC (illegal)

**Cycles:** 5
**Flags:** N Z C V
**Legal:** no

`M[zp] = ROR(M[zp]) ; A = A + M[zp] + C`. Stable.

### $6F — RRA abs — ROR absolute then ADC (illegal)

**Cycles:** 6
**Flags:** N Z C V
**Legal:** no

`M[abs] = ROR(M[abs]) ; A = A + M[abs] + C`. Stable.

### $73 — RRA (zp),Y — ROR memory then ADC indirect-Y (illegal)

**Cycles:** 8
**Flags:** N Z C V
**Legal:** no

`M[ind16(zp)+Y] = ROR(M) ; A = A + M + C`. RMW form; page-cross cost
already included; cycles measured in VICE x64sc; no page-cross penalty
(RMW). Stable. (Omitted from an earlier revision of this page.)

### $77 — RRA zp,X — ROR zp,X then ADC (illegal)

**Cycles:** 6
**Flags:** N Z C V
**Legal:** no

`M[zp+X] = ROR(M[zp+X]) ; A = A + M[zp+X] + C`. Wraps in zero page.
Cycles measured in VICE x64sc; no page-cross penalty (RMW). Stable.
(Omitted from an earlier revision of this page.)

### $7B — RRA abs,Y — ROR abs,Y then ADC (illegal)

**Cycles:** 7
**Flags:** N Z C V
**Legal:** no

`M[abs+Y] = ROR(M[abs+Y]) ; A = A + M[abs+Y] + C`. Cycles measured in
VICE x64sc; no page-cross penalty (RMW). Stable. (Omitted from an earlier
revision of this page.)

### $7F — RRA abs,X — ROR abs,X then ADC (illegal)

**Cycles:** 7
**Flags:** N Z C V
**Legal:** no

`M[abs+X] = ROR(M[abs+X]) ; A = A + M[abs+X] + C`. Cycles measured in
VICE x64sc; no page-cross penalty (RMW). Stable. (Omitted from an earlier
revision of this page.)

### $93 — AHX (zp),Y — Store A AND X AND (H+1) indirect-Y (unstable)

**Cycles:** 6
**Flags:** —
**Legal:** no

`M[ind16(zp)+Y] = A & X & (H+1)` where H is the high byte of the target
address. **Unstable**: the `H+1` term comes from an internal half-cycle
race, and on page-cross the high byte feedback corrupts the result.

Also called SHA or AXA.

### $9F — AHX abs,Y — Store A AND X AND (H+1) abs,Y (unstable)

**Cycles:** 5
**Flags:** —
**Legal:** no

`M[abs+Y] = A & X & (H+1)`. Same instability as $93. **Unstable.**

### $9B — TAS abs,Y — Transfer A AND X to S, store A AND X AND (H+1) (unstable)

**Cycles:** 5
**Flags:** —
**Legal:** no

`S = A & X ; M[abs+Y] = A & X & (H+1)`. Combines an AHX with a stack
pointer overwrite. **Unstable**: same `H+1` race as AHX, plus the
side effect of clobbering S.

Also called SHS or XAS.

### $BB — LAS abs,Y — Load A, X, and S from memory AND S

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1
**Legal:** no

`A = X = S = M[abs+Y] & S`. Reads memory ANDed with the stack pointer
and writes the result into A, X, and S simultaneously. Page-cross
penalty applies. An earlier version of this page classed it unstable; the
cited tables do not, and Oxyron notes only that one source called it
"probably unreliable". Measured in VICE x64sc: S=$F0, M=$3F gives
A=X=S=$30, N and Z from the result, 4 cycles, 5 on page cross. It writes
S; restore the stack pointer before the next push or return.

Also called LAR.

### $9E — SHX abs,Y — Store X AND (H+1) abs,Y (unstable)

**Cycles:** 5
**Flags:** —
**Legal:** no

`M[abs+Y] = X & (H+1)` where H is the high byte of the target address.
Same `H+1` race as AHX. **Unstable** on page cross.

Also called SXA or XAS.

### $9C — SHY abs,X — Store Y AND (H+1) abs,X (unstable)

**Cycles:** 5
**Flags:** —
**Legal:** no

`M[abs+X] = Y & (H+1)`. Same `H+1` race as AHX. **Unstable** on page
cross.

Also called SYA.

### $02 — KIL — Halt CPU (illegal)

**Cycles:** —
**Flags:** —
**Legal:** no

Halts the CPU. The PC freezes. IRQ and NMI are ignored. The only way out
is RESET. Eleven other opcodes ($12, $22, $32, $42, $52, $62, $72, $92,
$B2, $D2, $F2) do the same thing. Also called JAM, HLT, CIM, or CRASH
in different references.

## Demo-scene uses

Patterns that recur in cycle-tight C64 demos and games:

### LAX for table-driven loops

When a routine needs to read a byte from a table and use it as both a
data value and a future index:

```asm
  lax sprite_y_table,x   ; A = X = next sprite Y
  sta $D001              ; sprite 0 Y register
  ; X is now the same value, ready for indexing into a control table
  ldy multiplex_table,x
```

This saves the second LDX (or LDA) load and frees an instruction slot in
a badline-adjacent raster sequence.

### SAX for masked stores

With a precomputed bitmask in X, to write a masked
version of A to memory without disturbing either register:

```asm
  .const cell = 40*12 + 20   // colour-RAM cell for row 12, column 20
  ldx #$0F                   // nibble mask
  lda color_byte
  sax $D800+cell             // SAX abs ($8F, 3 bytes, 4 cycles): store color_byte & $0F
```

Color RAM is nibble-wide on the C64, and SAX abs makes the masked store
one 3-byte/4-cycle instruction against `AND #$0F : STA abs` at 5 bytes/6
cycles. SAX has no abs,Y or abs,X form; the $9F slot that abs,Y would
occupy is SHA/AHX, which stores A & X & (high byte + 1); measured in
VICE x64sc: $9F to $0300 with A=$FF, X=$0F stores $04, not $0F. If the
cell has to be indexed, the index has to live in the address, not in Y:
with X holding the mask, SAX can only be unindexed (abs/zp) or zp,Y, and
zp,Y cannot reach $D800 at all. An earlier version of this page wrote
`sax $D800,y`, which does not assemble (KickAssembler 5.25: "'sax'
doesn't support ABSOLUTEY mode").

### SLO/RLA for sprite multiplexers

A multiplexer needs to shift a "which sprites are active this slot" byte
and OR new sprite enables into a register-image table:

```asm
  ; flag byte in $FB tracks sprites that just turned on
  slo $FB                ; shift flag byte, OR shifted bit into A
  sta sprite_enable_image
```

Equivalent to `asl $FB : lda $FB : ora ...` in 8+ cycles (an earlier
version said 7+; ASL zp is 5 and LDA zp 3), but SLO fuses it to 5.

RLA is the AND-rotate version, used when rotating a sprite priority mask
into a `$D01B`-bound register image.

### DCP for count-and-test loops

A scrolling routine running 8 cycles per character can decrement an
on-screen counter and branch in one instruction:

```asm
  ; A holds "what value triggers a wrap"
  loop:
    ; ... raster-bar work ...
    dcp scroll_phase
    bne loop
```

This is 8 cycles per iteration (`dcp` zp 5 + taken `bne` 3) vs. 13 for
`dec scroll_phase : lda #wrap_value : cmp scroll_phase : bne loop` (an
earlier version said 5 vs. ~7, which omitted the branch on one side and
undercounted the other). All counts measured in VICE x64sc.

### NOPs for timing alignment

Cycle-exact raster code regularly needs padding of a few cycles to align
register writes to the badline boundary. An earlier version of this page
recommended the 1-byte $1A/$3A/$5A/$7A/$DA/$FA undocumented NOPs for this;
that was wrong: they are exactly the shape of the legal `nop` ($EA,
1 byte, 2 cycles; all seven measured 2 cycles in VICE x64sc) and buy
nothing except a 65C02 incompatibility. No 6502 instruction takes fewer
than 2 cycles, so a 1-cycle adjustment is made by swapping a 2-cycle
instruction for a 3-cycle one, and the illegal family covers
that: `nop zp` ($04, 2 bytes, 3 cycles) pads three cycles and leaves
N, V and Z untouched (measured: P unchanged, where `bit zp` at the same
point rewrote all three), and it is a byte shorter than `jmp *+3`.
`nop #imm` ($80, 2 bytes, 2 cycles) is the no-side-effect 2-byte pad, and
the one-byte skip. For 4 cycles two legal `nop`s (2 bytes) are already the
smallest form; `nop abs` ($0C, 3 bytes, 4 cycles) is a 2-byte skip, not a
pad. Prefer `bit $00` only when the flag change is acceptable; it is
3 cycles, 2 bytes, and legal.

### AXS for fused mask-and-loop

A bit-mask-then-counter pattern: `X = (A & X) - 1; if X != 0 goto loop`
becomes a 5-cycle two-instruction loop body (2 for `axs #1` + 3 for the
taken branch; an earlier version said 4 and 9):

```asm
  axs #1
  bne loop
```

vs. `txa : and #mask : tax : dex : bne loop` (11 cycles, measured in VICE
x64sc).

### ANC for sign-to-carry

When the sign of a masked value is needed in C for the code that follows,
ANC folds the `CMP #$80` away:

```asm
  anc #$80           // A &= $80 ; C = N = bit 7 of the result
  ror                // shifts the sign in: 4 cycles, where and/cmp/ror is 6
```

For a plain branch on the sign, use the legal `and #$80 : bmi`:
`anc #$80 : bcs` takes the same branch at the same cost and gives up CMOS
compatibility for nothing. (The earlier example here, `anc #$80 : bcs
negative`, was sold as saving a compare; AND sets N, so no compare was
ever needed.)

## Pitfalls

- **Revision-dependence**: the unstable illegal opcodes (XAA $8B, LAX
  immediate $AB, AHX $93/$9F, TAS $9B, SHX $9E, SHY $9C) give different
  results across 6510 production runs and even between cold and warm
  silicon. Test on multiple real machines before relying on them, or
  better, don't. Emulators often pick *one* behavior and call it "the"
  behavior, which masks the real-hardware variance.
- **Not portable to 65C02**: the CMOS-revision 6502 (Apple //c, Apple
  //e Enhanced, BBC Master) implements
  almost every illegal opcode as a NOP of varying byte/cycle counts.
  Code that compiles for the C64 with illegal opcodes will not run on
  any 65C02-based machine. The same applies to the 65816 (Apple IIGS,
  SNES, SuperCPU).
- **Assembler-dependent mnemonics**: different references use different
  mnemonics for the same opcode ($87-family store: SAX vs. AXS vs. AAX;
  $CB subtract: AXS vs. SBX; $AB: LAX #imm vs. LXA; AHX vs. SHA vs. AXA;
  KIL vs. JAM vs. HLT vs. CIM). Check
  the assembler's documentation, and prefer the Oxyron names
  for portability between code shared with other coders.
- **3-cycle and 4-cycle NOPs perform a memory read**: `NOP zp`, `NOP
  abs`, `NOP abs,X` *do* drive an address-bus read of the operand.
  Harmless in RAM, but the read reaches memory-mapped I/O exactly as an
  `LDA` would. `NOP $D019` is harmless (a read of the VIC interrupt
  register acknowledges nothing; only a write does), but `NOP $DC0D` or
  `NOP $DD0D` clears the CIA's pending interrupt flags: after a Timer A
  underflow, `.byte $0C,$0D,$DC` left a following `LDA $DC0D` reading $00
  where the control read $01, and `NOP abs,X` ($1C) did the same
  (measured in VICE x64sc). `NOP $D41B` does not disturb the SID: voice
  3's OSC3 ramp advanced identically across sixteen `NOP $D41B` and
  sixteen `NOP` reads of RAM (measured in VICE x64sc reSID); its only
  visible effect is the one any read of $D419-$D41C has, refreshing the
  value the write-only SID registers read back (see
  c64-registers-reference). An earlier revision of this page said
  `NOP $D41B` "resets some internal state"; nothing in the SID does that
  on a read.
- **KIL is one-way**: $02 and its siblings hang the CPU until reset.
  This is occasionally used in copy protection, but in normal
  code, hitting a KIL means execution has gone wrong (corrupted PC,
  errant indirect jump, mistyped opcode). Most emulators will pop a
  debugger on KIL; VICE shows a "JAM" dialog.
- **ARR's flags never match ROR's, and in decimal mode neither does the
  result**: in binary mode `ARR #imm` leaves the same accumulator as
  `AND #imm : ROR A` but C is bit 6 of the result and V is bit 6 XOR
  bit 5; in decimal mode the accumulator is BCD-adjusted as well and N
  holds the carry-in. An earlier version said the flags matched in
  decimal mode, the reverse of what VICE x64sc measures.
- **AXS ignores decimal mode**: AXS ($CB) is the *only* 6502 instruction
  with subtraction that does not honor the D flag. The result is always
  binary regardless of D=0 or D=1. Most other illegal opcodes that
  involve ADC/SBC (RRA, ISC) *do* honor decimal mode.
- **RMW forms always pay the page-cross cost**: SLO/RLA/SRE/RRA/DCP/ISC
  in their abs,X / abs,Y / (zp),Y modes always take the worst-case
  cycle count (7 or 8); there is no page-cross saving on RMW
  instructions, illegal or otherwise.
- **Some assemblers reject illegal opcodes**: acme requires `!cpu 6510`
  (or `--cpu 6510`); ca65 requires `.setcpu "6502X"` or `--cpu 6502X`.
  An earlier version of this page said ca65 accepts them by default; it
  does not, and reports `':' expected` on every illegal mnemonic
  (measured with ca65 V2.18 as the binary reports it, Homebrew cc65
  2.19). KickAssembler accepts them with no directive (its default
  `.cpu _6502` includes them; measured with 5.25, which has no
  `kil`/`jam` mnemonic). dasm (`processor 6502`) and xa65
  (`--no-undefined-opcodes`) are not installed here and those two claims
  are not measured. Even with the CPU set, spellings differ: acme wants
  `asr` where Oxyron says ALR, and ca65 wants `axs` where some tables
  say SBX (both measured). Check the toolchain.
- **VICE accuracy**: VICE's `x64sc` cycle-exact emulator implements all
  illegal opcodes; for the unstable ones it picks one fixed behaviour
  (XAA magic `$EF`, LAX #imm `$EE`, measured above), not a
  configurable model as an earlier version of this bullet said. Whether
  the faster `x64` differs from `x64sc` on them was not measured here.
  Use `x64sc` for any code that relies on illegal opcodes.

## Sources

- Oxyron (Graham), "6502/6510/8500/8502 Opcodes" — https://www.oxyron.de/html/opcodes02.html (page heading and credit as fetched 2026-09-22; an earlier version of this line called it "Frodo's 6502 opcode table")
- Masswerk (Norbert Landsteiner), "6502 illegal opcodes" — https://www.masswerk.at/nowgobang/2021/6502-illegal-opcodes
- NESdev wiki, "CPU unofficial opcodes" — https://www.nesdev.org/wiki/CPU_unofficial_opcodes
- Pagetable / c64ref opcode reference — https://www.pagetable.com/c64ref/6502/

<!-- doc-type: hardware-reference -->
