---
chip: 6510
---

# 6510 CPU Reference

## Overview

The MOS 6510 is the CPU of the Commodore 64. It is binary-compatible with the
MOS 6502 (same instruction set, cycle counts, addressing modes, bus
protocol and interrupt behavior) with one Commodore-specific addition: a built-in six-bit I/O port mapped into the lowest two bytes of the
CPU's address space at $00 (data direction) and $01 (data). That port drives
the C64's bank-switching logic and the cassette motor / sense lines. Apart
from those two addresses the 6510 looks and behaves exactly like a 6502 to
software.

For the assembly programmer the practical consequences are:

- All 151 official 6502 opcodes work unchanged.
- The ~30 documented "illegal" / unofficial opcodes behave exactly as on
  any NMOS 6502: the stable majority identically across 6502/6510/8500,
  and the small unstable group (XAA/ANE, LAX #imm and the AHX/SHX/SHY/TAS
  family) varying per chip on the 6510 just as on the 6502. They are
  documented, with per-opcode stability ratings, in
  [6502-illegal-opcodes.md](6502-illegal-opcodes.md).
- The classic 6502 errata are all present: the JMP indirect page-wrap bug,
  the BRK 2-byte signature, the undefined decimal flag at reset, the
  invalid N/V/Z flags after ADC/SBC in decimal mode (C is correct; an
  earlier version of this bullet named a "lack of carry-propagation" in
  decimal mode, which is not a real erratum; measured in VICE,
  SED / CLC / LDA #$99 / ADC #$01 gives A=$00 with C=1, see
  [BCD mode](#bcd-mode)), and so on.
- Reading address $00 returns the data-direction register; reading $01
  returns the value at the port pins, AND-ed with the direction mask in a
  way that depends on which lines are configured as outputs vs inputs.
- The CPU runs at one of two slightly different clock rates depending on
  region: 0.985 MHz on PAL machines (985248 Hz) and 1.022 MHz on NTSC
  machines (1022727 Hz). All instruction cycle counts in this document are
  CPU cycles; convert to wall-clock time using the regional clock.

Below: the 6510's programmer-visible model (registers, status
flags, addressing modes, stack mechanics, interrupt vectors, page-crossing
penalties, the I/O port at $00/$01, and a per-opcode reference for every
legal instruction). Illegal/undocumented opcodes are in a companion document.

### 6510 vs 6502 — the differences

| Item | 6502 | 6510 |
|------|------|------|
| Instruction set | 56 mnemonics, 151 opcodes | identical |
| Illegal opcodes | NMOS behaviour: most stable, a handful unstable per chip | identical — same NMOS core, same stable set, same unstable set |
| Address space | full 64 KB visible | full 64 KB visible (banked via $01) |
| Built-in I/O port | none | 6-bit port at $00 (DDR) / $01 (data) |
| Clock | external | external, divided from VIC dot clock |
| BCD mode | works | works |
| Reset behavior | I=1, D undefined | I=1, D undefined (KERNAL clears D) |

A 6502 disassembler reads 6510 code without modification,
a 6502 cycle-counter is accurate on a 6510, and a 6502 assembler emits valid
6510 code. The only place 6510-specific behavior shows up is when code reads
or writes addresses $00 or $01.

### What this document is for

- Looking up the encoding, cycles, flag effects, and page-cross penalty of
  any legal opcode.
- Understanding the addressing modes well enough to read and write 6510
  assembly fluently.
- Understanding the interrupt model (IRQ, NMI, BRK, RESET) and the layout
  of stack frames each one pushes.
- Understanding the 6510-specific I/O port and how it controls C64 banking.
- Avoiding the classic 6502 pitfalls (JMP indirect, BRK is 2 bytes, decimal
  mode tricks).

For complete C64 memory layout including ROM/RAM banking driven by $01, see
[c64-memory-map.md](c64-memory-map.md). For the illegal opcodes, see
[6502-illegal-opcodes.md](6502-illegal-opcodes.md).

## Registers

The 6510 has three 8-bit
general-purpose registers, an 8-bit stack pointer, a 16-bit program counter,
and an 8-bit status register. That is the entire programmer-visible state.

### A — Accumulator

The 8-bit accumulator is the primary arithmetic and logic register. All
ADC, SBC, AND, ORA, EOR, ASL, LSR, ROL, ROR, BIT, CMP, LDA, STA, and the
transfer instructions involving A (TAX, TAY, TXA, TYA) operate on or
through it. The accumulator can be pushed and pulled from the stack with
PHA/PLA. Most arithmetic results land here.

### X — Index Register X

An 8-bit index register. It can be used as a loop counter (INX/DEX/CPX),
as a stack pointer for relocatable stack frames (TXS, TSX), and as the
offset in zero-page,X / absolute,X / (zp,X) addressing modes. Unlike the
accumulator, X cannot be pushed/pulled directly on the stack; transfer
via A (TXA/PHA, PLA/TAX) or use TXS to dump X into the SP register.

### Y — Index Register Y

An 8-bit index register similar to X but with a different addressing-mode
footprint. Y is used in zero-page,Y (only LDX/STX), absolute,Y, and
(zp),Y addressing. The (zp),Y mode (indirect indexed) is the most common
way to dereference a 16-bit pointer in zero page; Y is the index added
*after* the indirection.

X is used for *pre-indexed* indirect addressing `(zp,X)` and
Y is used for *post-indexed* indirect addressing `(zp),Y`. The two modes
have very different semantics; see [Addressing modes](#addressing-modes).

### SP — Stack Pointer

An 8-bit register that always points to the *next free byte* on the stack.
The stack lives at $0100–$01FF, so the effective stack address is
$01 || SP. SP decrements on push and increments on pull. Both operations
happen *before* the value is written / *after* the value is read, which
gives the "next-free-byte" semantics.

Initial value at reset: 6502 hardware does not initialize SP. The C64
KERNAL reset routine sets SP to $FF, giving an empty stack at $01FF
working downward. Code that runs at startup can rely on this; code that
takes over from the KERNAL should set its own SP via LDX #$FF / TXS.

### PC — Program Counter

A 16-bit register holding the address of the next instruction byte to
fetch. It increments through instruction fetches; JMP, JSR, RTS, RTI,
branches, BRK, and interrupts all modify it explicitly. PC cannot be
read or written directly by software; it is observed only via the
addresses pushed on the stack by JSR/BRK/IRQ/NMI.

The PC pushed for JSR points to the *last byte of the JSR instruction*,
not the next instruction. RTS therefore pulls and adds 1. Fake return
addresses built on the stack must allow for this.

### P — Processor Status Register

An 8-bit register containing six independent flags. Bit layout:

```
  7 6 5 4 3 2 1 0
  N V - B D I Z C
```

| Bit | Symbol | Name | Set when |
|-----|--------|------|----------|
| 7   | N      | Negative | Result MSB is 1 (treating the byte as signed) |
| 6   | V      | Overflow | Signed overflow in ADC/SBC, or bit 6 of BIT operand |
| 5   | -      | (unused) | Always 1 when pushed; physically not a flip-flop |
| 4   | B      | Break    | Set in pushed status if the push was from BRK or PHP |
| 3   | D      | Decimal  | ADC/SBC use BCD arithmetic |
| 2   | I      | Interrupt disable | IRQ line is ignored when set |
| 1   | Z      | Zero     | Result was zero |
| 0   | C      | Carry    | Unsigned carry-out or borrow-not from ADC/SBC; shift bit |

See [Status flags + BCD mode](#status-flags--bcd-mode) for full semantics
including how each instruction modifies each flag.

## Addressing modes

The 6510 has 13 addressing modes. Operand length, cycle count, and which
opcodes encode in which mode are determined entirely by the mode. The
mnemonics in this section follow the syntax used in most modern 6502/6510
assemblers (cc65, kickass, dasm, acme): `#$xx` for immediate, `$xxxx,X`
for absolute,X, and so on.

### Implied

No operand. The instruction byte itself encodes the entire operation.
Examples: NOP, CLC, SEI, INX, RTS. One byte total.

### Accumulator

Operates on A directly. Encoded the same way as implied: no operand
byte. Most assemblers write this as `LSR A` or just `LSR`. Examples:
ASL A, LSR A, ROL A, ROR A. One byte total.

### Immediate — `#$xx`

The operand byte *is* the value. Two bytes total: opcode + immediate
value. Example: `LDA #$10` loads the literal value $10 into A. Cycles:
always 2 for register loads, 2 for ADC/SBC/AND/ORA/EOR/CMP/CPX/CPY.

### Zero page — `$xx`

The operand byte is the low byte of a zero-page address; the high byte
is implicitly $00. Two bytes total. Faster than absolute (saves one
cycle) because the CPU does not need to fetch a separate high byte.
Example: `LDA $80` loads from address $0080.

On the 6510, zero page is fast and is the only location where indirect addressing modes can dereference pointers.
On the C64, BASIC's workspace occupies most of $02–$8F and the KERNAL's
most of $90–$FA ($00–$01 are the 6510 port, $FF is BASIC's
number-formatting scratch). With BASIC running, the only bytes both
leave alone are $02 and $FB–$FE, not "$02–$07", as an earlier version
of this paragraph said. $03–$06 hold the float↔integer conversion
vectors that BASIC's cold start installs ($B1AA at $03/$04, $B391 at
$05/$06, stored at $E3D4–$E3DE); BASIC never calls through them itself,
so they are usable only if nothing else on the machine relies on them.
$07–$08 are live BASIC temporaries (string literals, DATA/READ, GOTO
line numbers, AND/OR and INT all write them) and are not free while
BASIC runs. Much more is usable once BASIC is not in use. See
[c64-memory-map.md](c64-memory-map.md).

### Zero page,X — `$xx,X`

Operand byte plus X gives the effective zero-page address, *modulo 256*
(the address wraps within zero page; it never crosses into $0100). Two
bytes total. Adds 1 cycle over plain zero-page to perform the addition.
Example: `LDA $80,X` with X=$04 reads from $0084. With X=$F0 it reads
from `($80 + $F0) & $FF` = $70.

The wrap is a frequent source of bugs in code that walks a table near
the top of zero page: the index runs off the top and back to the bottom
of zero page rather than into $0100.

### Zero page,Y — `$xx,Y`

Same as zero page,X but using Y. Only available for `LDX $xx,Y` and
`STX $xx,Y`. There is no `LDA $xx,Y`; use absolute,Y or copy Y into X
first.

### Absolute — `$xxxx`

Three bytes total: opcode + low byte + high byte. The effective address
is the full 16-bit operand. Example: `LDA $1234` reads from address
$1234. No page-cross consideration because the address is fully fixed.

### Absolute,X — `$xxxx,X`

Three bytes total. Effective address = `$xxxx + X`. If the addition
crosses a page boundary (i.e. the high byte of the sum differs from the
high byte of the base), read operations pay a +1 cycle penalty. Write
operations always pay the penalty (a "dummy read" is performed at the
unfixed address, then a real write to the corrected address) so STA
absolute,X is always 5 cycles, never 4.

### Absolute,Y — `$xxxx,Y`

Same as absolute,X but using Y. Same +1 page-cross penalty for reads,
same always-pay-the-penalty rule for writes.

### Indirect — `($xxxx)`

Only used by JMP. Three bytes total. The effective address is the
16-bit value stored at $xxxx (low byte) and $xxxx+1 (high byte). Cycles:
5. **Known bug:** if the low byte of the operand is $FF, the high byte
of the pointer is fetched from $xx00, not $xx00+$100. So
`JMP ($10FF)` fetches the low byte from $10FF and the high byte from
$1000 (not $1100). This is a 6502 silicon bug; the 6510 inherits it.
See [Pitfalls](#pitfalls).

### Indexed indirect — `($xx,X)` ("pre-indexed")

Two bytes total. Add X to the operand byte (modulo 256, no carry into
the high byte), then fetch a two-byte little-endian pointer from
zero page starting at that address. The effective address is what that
pointer holds. Cycles: 6.

Useful for jump tables and small dispatch trees in zero page where X
selects which entry. Far less common than `(zp),Y`.

### Indirect indexed — `($xx),Y` ("post-indexed")

Two bytes total. Fetch a two-byte little-endian pointer from
`$00xx` and `$00xx+1` (with the high byte address wrapping inside zero
page if `$xx`=$FF), then add Y to that pointer to form the effective
address. Cycles: 5 plus 1 if adding Y crosses a page boundary. Writes
always pay the penalty (always 6 cycles for STA ($zp),Y).

The standard pointer-dereference mode. Every "for each byte in
this string / buffer" loop on the C64 uses it.

### Relative — `$xx` (branches)

Two bytes total: opcode + signed 8-bit displacement. The displacement
is added to the PC *after* the branch instruction has been fetched
(i.e. PC points to the next instruction). Range: −128 to +127 bytes
from the byte following the branch. Cycles: 2 if not taken, 3 if
taken, 4 if taken and the target is on a different page.

All conditional branches (BCC, BCS, BEQ, BMI, BNE, BPL, BVC, BVS) use
this mode. There is no unconditional relative branch on the 6510;
`JMP abs` is the substitute (3 cycles, 3 bytes).

## Stack mechanics

The stack is a 256-byte region at $0100–$01FF. It is *not* relocatable
(the high byte is hardwired to $01). The 8-bit SP register holds the
low byte and always points to the next free byte. Operations:

| Op | What it does | Cycles |
|----|--------------|--------|
| PHA | Store A at $0100+SP, then SP = SP − 1 | 3 |
| PHP | Store P (with B=1, bit-5=1) at $0100+SP, then SP = SP − 1 | 3 |
| PLA | SP = SP + 1, then A = byte at $0100+SP | 4 |
| PLP | SP = SP + 1, then P = byte at $0100+SP (bits B and unused are ignored on pull) | 4 |
| JSR | Push (PC + 2) high, push (PC + 2) low, jump to operand | 6 |
| RTS | Pull low, pull high, PC = (pulled) + 1 | 6 |
| BRK | Push (PC + 2) high, push (PC + 2) low, push P with B=1, set I=1, load PC from $FFFE/$FFFF | 7 |
| IRQ | Push PC high, push PC low, push P with B=0, set I=1, load PC from $FFFE/$FFFF | 7 |
| NMI | Push PC high, push PC low, push P with B=0, set I=1, load PC from $FFFA/$FFFB | 7 |
| RTI | Pull P, pull low, pull high, PC = (pulled) — **no +1**, unlike RTS | 6 |

Notes on the JSR / RTS pairing:

- JSR pushes the address of *its last operand byte*: PC + 2 where PC
  is the address of the JSR opcode, which is one less than the address
  of the next instruction (an earlier version of this note said
  "(PC + 2) minus one", using PC in a different sense from the table
  above). RTS pulls that and adds 1, landing on the correct next
  instruction. So code can JSR to a location whose return path
  is constructed by hand on the stack: push (target − 1) and execute
  RTS to "jump" to `target`.

Notes on the B flag:

- The B flag is a software-only convention: there is no B flip-flop in
  the silicon. When P is pushed, bit 4 of the pushed byte indicates
  whether the push happened due to a software cause (BRK or PHP → B=1)
  or a hardware cause (IRQ or NMI → B=0). The CPU's *live* P register
  has no meaningful B bit; PLP and RTI ignore the B and unused bits
  of the pulled byte.
- This is how a BRK handler distinguishes a BRK from an IRQ: both
  vector through $FFFE/$FFFF, but only BRK pushes a P value with bit
  4 set. The handler inspects the pushed P on the stack.

Notes on stack overflow:

- The 6502/6510 has no overflow detection. If SP wraps from $00 back
  to $FF, the stack silently corrupts whatever was at the top of
  $0100. Defensive code occasionally checks SP after deep nesting but
  this is uncommon.

## Status flags + BCD mode

### Flag semantics

#### N — Negative

Set whenever the most significant bit of the most recent ALU result is
1. Loads, transfers, arithmetic, logical, increment, decrement, and
shifts all set N. CMP/CPX/CPY set N to bit 7 of the implied subtraction
(A/X/Y − operand), the same direction as the C rule below (C set if
register ≥ operand) and as the CMP entry in the instruction reference;
an earlier version of this sentence had the operands the other way
round (measured in VICE: LDA #$10 / CMP #$20 leaves N=1, C=0). Because
this is bit 7 of an 8-bit unsigned difference, N after CMP is not a
signed less-than test (e.g. A=$80 CMP #$01 gives N=0, C=1 although
−128 < +1): use C (BCS/BCC) for unsigned ≥/<, and for a signed compare
use SEC / SBC and test N XOR V (BVC/BVS then BMI/BPL); CMP itself
never writes V.

BIT is the exception: BIT sets N to bit 7 of the *operand*, regardless
of A. This is the standard trick for reading the high bit of a memory
byte without disturbing A.

#### V — Overflow

Set when a signed ADC or SBC produced a result outside the range
−128..+127. Specifically, V is set when the sign of the result differs
from the sign of *both* operands.

BIT also writes V: BIT sets V to bit 6 of the operand.

Cleared by CLV. Set only by ADC, SBC, BIT, and PLP/RTI (which restore
it from the pushed status byte).

#### B — Break

Software-visible only in the pushed-status byte. See the stack-mechanics
section above. Not a hardware flip-flop.

#### D — Decimal

When set, ADC and SBC perform BCD (binary-coded-decimal) arithmetic on
their operands. See [BCD mode](#bcd-mode) below for details.

D is **undefined at power-on / reset** on a real 6502; the silicon
makes no guarantee. The 6510 inherits this, and the C64 KERNAL reset
routine explicitly executes `CLD` before any ADC/SBC. Code that takes
over the reset vector and forgets to CLD can hit garbage arithmetic on
the first ADC after a cold boot.

#### I — Interrupt disable

When set, the IRQ pin is ignored. The NMI pin is *not* affected (NMI
is non-maskable). I is automatically set to 1 by BRK and by hardware
IRQ/NMI acknowledgment; it is the handler's responsibility to clear
it (via PLP / RTI / explicit CLI) when ready to accept further IRQs.

Cleared by CLI. Set by SEI.

#### Z — Zero

Set when the most recent ALU result was zero. Affected by essentially
all loads, transfers, arithmetic, logical, increment/decrement, and
shift instructions. BIT sets Z to whether `A AND operand` is zero.

CMP/CPX/CPY set Z when the operand equals the register (so BEQ after
a CMP means "equal").

#### C — Carry

Multiple meanings depending on instruction:

- ADC: C is the carry-in; after the operation, C holds the carry-out.
- SBC: C is the *inverted* borrow-in (SEC before the first SBC means
  "no borrow"). After the operation C holds the
  inverted borrow-out.
- CMP/CPX/CPY: C is set if register ≥ operand (unsigned).
- ASL/ROL: C receives the bit shifted *out of* bit 7.
- LSR/ROR: C receives the bit shifted *out of* bit 0.
- ROL/ROR: C also supplies the bit shifted *in* on the empty side.

Cleared by CLC. Set by SEC. Restored on PLP/RTI from the pushed byte.

### BCD mode

When D=1, ADC and SBC interpret their operands as packed BCD: the high
nibble is the tens digit, the low nibble is the units digit, both in
the range 0–9. The result is a packed BCD value.

Key behaviors and gotchas:

- N, V, and Z flags after a BCD ADC/SBC are **undefined** on the NMOS
  6502/6510. Only C is reliable. (The 65C02 fixed this; the 6510 did
  not.) Code that runs BCD arithmetic and then branches on N/V/Z is
  buggy on 6510.
- A nibble outside 0–9 (i.e. $0A–$0F) as input produces a defined but
  not-very-useful result. Avoid feeding hex digits to BCD ADC.
- BCD applies only to ADC and SBC. INC/DEC/INX/INY/DEX/DEY ignore D.
- CLD before regular arithmetic; SED only when entering a BCD block;
  always CLD before returning to caller code that may not expect D=1.
- The KERNAL clears D only in its reset routine ($FCE6, the sole CLD
  instruction in either ROM). Neither the IRQ dispatcher at $FF48, the
  default IRQ service at $EA31, nor the NMI path at $FE43/$FE47
  executes CLD, so KERNAL interrupt code runs with whatever D the
  interrupted code left. An earlier version of this bullet said the
  KERNAL clears D at the start of every IRQ/NMI, and it does not. The
  default IRQ path survives D=1 only by accident: its only ADC/SBC are
  UDTIM's three compare-style SBCs ($F6AA/$F6AE/$F6B2), which use just
  the carry, and on the NMOS 6510 SBC's carry-out is the same in
  decimal and binary mode. Do not rely on that: anything else routed
  through ($0314)/($0318) inherits the caller's D. Keep SED/CLD
  pairs short, SEI around them if an interrupt that does arithmetic
  could land inside, and CLD first thing in any handler of your own
  that uses ADC/SBC.

### Flag-modification summary

Which flags each instruction touches (the per-opcode H3 entries below
give the canonical list):

| Instruction | N | V | Z | C | I | D |
|-------------|---|---|---|---|---|---|
| ADC         | ✓ | ✓ | ✓ | ✓ |   |   |
| AND, ORA, EOR | ✓ |   | ✓ |   |   |   |
| ASL, LSR, ROL, ROR | ✓ |   | ✓ | ✓ |   |   |
| BIT         | M7 | M6 | ✓ |  |   |   |
| BRK         |   |   |   |   | 1 |   |
| CLC, SEC    |   |   |   | ✓ |   |   |
| CLD, SED    |   |   |   |   |   | ✓ |
| CLI, SEI    |   |   |   |   | ✓ |   |
| CLV         |   | ✓ |   |   |   |   |
| CMP, CPX, CPY | ✓ |   | ✓ | ✓ |   |   |
| DEC, INC, DEX, DEY, INX, INY | ✓ |   | ✓ |   |   |   |
| LDA, LDX, LDY | ✓ |   | ✓ |  |   |   |
| PLA, PLP, RTI | (PLP/RTI: all flags from stack; PLA: N,Z) |
| SBC         | ✓ | ✓ | ✓ | ✓ |   |   |
| TAX, TAY, TSX, TXA, TYA | ✓ |   | ✓ |  |   |   |
| TXS         |   |   |   |   |   |   |
| JMP, JSR, RTS, branches, PHA, PHP, NOP, STA, STX, STY | none | | | | | |

## IRQ / NMI / BRK / RESET vectors

The top six bytes of the address space hold three 16-bit interrupt vectors:

| Address     | Vector | Triggered by |
|-------------|--------|--------------|
| $FFFA / $FFFB | NMI  | Falling edge on NMI pin (on the C64: CIA2's /IRQ output and the RESTORE key — an earlier version of this row named only CIA2; the expansion port's /NMI line shares the pin, which is why the KERNAL's NMI handler at $FE47 tests for a cartridge signature and jumps through $8002 when CIA2 was not the source) |
| $FFFC / $FFFD | RESET | RESET pin held low then released |
| $FFFE / $FFFF | IRQ/BRK | Low level on IRQ pin (with I=0), or BRK instruction |

All three vectors are 16-bit little-endian pointers. On the C64 they
sit in KERNAL ROM at the top of $FFxx. The IRQ/BRK and NMI vectors
point to small ROM dispatchers ($FF48 and $FE43) which in turn jump
through user-modifiable RAM vectors in page 3 ($0314–$0319), page 3
only; an earlier version of this sentence said "zero page or page 3",
and nothing in zero page is involved. The RESET vector points to the
KERNAL reset routine ($FCE2), which ends in `JMP ($A000)` (or
`JMP ($8000)` when a cartridge signature is present) and reads no
page-3 vector:

| RAM vector | Address  | What ROM dispatcher reads here |
|------------|----------|--------------------------------|
| IRQ        | $0314/$0315 | KERNAL hardware IRQ handler |
| BRK        | $0316/$0317 | KERNAL BRK handler |
| NMI        | $0318/$0319 | KERNAL NMI handler |

For a custom IRQ on the C64, either:

1. Bank out KERNAL ROM (set $01 bit 1 to 0) so that $FFFE/$FFFF reads
   from RAM, *or*
2. Leave KERNAL banked in but overwrite the RAM vector at $0314/$0315
   so that the KERNAL dispatcher jumps to your handler.

Option 2 is more common in BASIC-friendly code; option 1 is the
demo-coder default because the ROM dispatcher at $FF48 (PHA TXA PHA TYA
PHA TSX LDA $0104,X AND #$10 BEQ JMP ($0314)) costs 29 cycles before
your handler's first instruction, on top of the 7-cycle interrupt
sequence you pay either way (measured in VICE: a $0314 handler starts
exactly 29 cycles after a $FFFE handler does; an earlier version of
this paragraph said "~40", which matches no path through the ROM).
Returning through $EA81 (PLA TAY PLA TAX PLA RTI) costs 22. A direct
handler that saves and restores the same three registers pays 13 in
and 22 out itself, so the net saving is the 16 cycles of
TSX/LDA/AND/BEQ/JMP plus whatever register saves your handler can skip.

### IRQ / NMI / BRK detail

When an IRQ or NMI is taken, the CPU:

1. Finishes the current instruction.
2. Pushes the high byte of PC.
3. Pushes the low byte of PC.
4. Pushes P with bit 4 (B) = 0 and bit 5 = 1.
5. Sets I = 1.
6. Loads PC from the vector ($FFFE/$FFFF for IRQ, $FFFA/$FFFB for NMI).
7. Begins executing at the new PC.

Total: 7 cycles.

For BRK, the same sequence runs except:

1. The instruction is one of these.
2. PC is pushed *after being advanced by 2* (so the pushed PC points
   one past the BRK signature byte).
3. P is pushed with bit 4 (B) = 1.

The B-flag trick is how a handler that vectors through $FFFE
distinguishes IRQ from BRK: pull the stacked P, AND with $10, BEQ to
IRQ path / BNE to BRK path.

### RESET detail

RESET does *not* save state. The CPU:

1. Sets I = 1.
2. Loads PC from $FFFC/$FFFD.
3. Begins execution.

SP is not initialized by the hardware. D is undefined. The KERNAL
reset routine on the C64 explicitly sets SP = $FF, clears D, sets up
the I/O port at $00/$01, banks in KERNAL/BASIC/IO, and jumps to the
BASIC cold-start routine. Code that hooks $FFFC should do the same.

## Quick reference — all 151 official opcodes

The table below lists every legal 6502/6510 opcode grouped by mnemonic.
"Mode" uses the standard assembler shorthand. "Bytes" includes the
opcode itself. "Cyc" is the base cycle count; entries with `+1*` add
one cycle when the address calculation crosses a page boundary
(only for reads; writes always pay the penalty as part of their base
count). Entries with `+1**` add one cycle for a taken branch and
+2 for a taken branch that crosses a page (only the branch
instructions). Flags column lists flags affected (N V Z C I D B).

| Opcode | Mnemonic | Mode | Bytes | Cyc | Flags |
|--------|----------|------|-------|-----|-------|
| $69 | ADC | #imm        | 2 | 2 | N V Z C |
| $65 | ADC | zp          | 2 | 3 | N V Z C |
| $75 | ADC | zp,X        | 2 | 4 | N V Z C |
| $6D | ADC | abs         | 3 | 4 | N V Z C |
| $7D | ADC | abs,X       | 3 | 4+1* | N V Z C |
| $79 | ADC | abs,Y       | 3 | 4+1* | N V Z C |
| $61 | ADC | (zp,X)      | 2 | 6 | N V Z C |
| $71 | ADC | (zp),Y      | 2 | 5+1* | N V Z C |
| $29 | AND | #imm        | 2 | 2 | N Z |
| $25 | AND | zp          | 2 | 3 | N Z |
| $35 | AND | zp,X        | 2 | 4 | N Z |
| $2D | AND | abs         | 3 | 4 | N Z |
| $3D | AND | abs,X       | 3 | 4+1* | N Z |
| $39 | AND | abs,Y       | 3 | 4+1* | N Z |
| $21 | AND | (zp,X)      | 2 | 6 | N Z |
| $31 | AND | (zp),Y      | 2 | 5+1* | N Z |
| $0A | ASL | A           | 1 | 2 | N Z C |
| $06 | ASL | zp          | 2 | 5 | N Z C |
| $16 | ASL | zp,X        | 2 | 6 | N Z C |
| $0E | ASL | abs         | 3 | 6 | N Z C |
| $1E | ASL | abs,X       | 3 | 7 | N Z C |
| $90 | BCC | rel         | 2 | 2+1** | — |
| $B0 | BCS | rel         | 2 | 2+1** | — |
| $F0 | BEQ | rel         | 2 | 2+1** | — |
| $24 | BIT | zp          | 2 | 3 | N V Z |
| $2C | BIT | abs         | 3 | 4 | N V Z |
| $30 | BMI | rel         | 2 | 2+1** | — |
| $D0 | BNE | rel         | 2 | 2+1** | — |
| $10 | BPL | rel         | 2 | 2+1** | — |
| $00 | BRK | impl        | 1 | 7 | I (B in pushed P) |
| $50 | BVC | rel         | 2 | 2+1** | — |
| $70 | BVS | rel         | 2 | 2+1** | — |
| $18 | CLC | impl        | 1 | 2 | C |
| $D8 | CLD | impl        | 1 | 2 | D |
| $58 | CLI | impl        | 1 | 2 | I |
| $B8 | CLV | impl        | 1 | 2 | V |
| $C9 | CMP | #imm        | 2 | 2 | N Z C |
| $C5 | CMP | zp          | 2 | 3 | N Z C |
| $D5 | CMP | zp,X        | 2 | 4 | N Z C |
| $CD | CMP | abs         | 3 | 4 | N Z C |
| $DD | CMP | abs,X       | 3 | 4+1* | N Z C |
| $D9 | CMP | abs,Y       | 3 | 4+1* | N Z C |
| $C1 | CMP | (zp,X)      | 2 | 6 | N Z C |
| $D1 | CMP | (zp),Y      | 2 | 5+1* | N Z C |
| $E0 | CPX | #imm        | 2 | 2 | N Z C |
| $E4 | CPX | zp          | 2 | 3 | N Z C |
| $EC | CPX | abs         | 3 | 4 | N Z C |
| $C0 | CPY | #imm        | 2 | 2 | N Z C |
| $C4 | CPY | zp          | 2 | 3 | N Z C |
| $CC | CPY | abs         | 3 | 4 | N Z C |
| $C6 | DEC | zp          | 2 | 5 | N Z |
| $D6 | DEC | zp,X        | 2 | 6 | N Z |
| $CE | DEC | abs         | 3 | 6 | N Z |
| $DE | DEC | abs,X       | 3 | 7 | N Z |
| $CA | DEX | impl        | 1 | 2 | N Z |
| $88 | DEY | impl        | 1 | 2 | N Z |
| $49 | EOR | #imm        | 2 | 2 | N Z |
| $45 | EOR | zp          | 2 | 3 | N Z |
| $55 | EOR | zp,X        | 2 | 4 | N Z |
| $4D | EOR | abs         | 3 | 4 | N Z |
| $5D | EOR | abs,X       | 3 | 4+1* | N Z |
| $59 | EOR | abs,Y       | 3 | 4+1* | N Z |
| $41 | EOR | (zp,X)      | 2 | 6 | N Z |
| $51 | EOR | (zp),Y      | 2 | 5+1* | N Z |
| $E6 | INC | zp          | 2 | 5 | N Z |
| $F6 | INC | zp,X        | 2 | 6 | N Z |
| $EE | INC | abs         | 3 | 6 | N Z |
| $FE | INC | abs,X       | 3 | 7 | N Z |
| $E8 | INX | impl        | 1 | 2 | N Z |
| $C8 | INY | impl        | 1 | 2 | N Z |
| $4C | JMP | abs         | 3 | 3 | — |
| $6C | JMP | (abs)       | 3 | 5 | — |
| $20 | JSR | abs         | 3 | 6 | — |
| $A9 | LDA | #imm        | 2 | 2 | N Z |
| $A5 | LDA | zp          | 2 | 3 | N Z |
| $B5 | LDA | zp,X        | 2 | 4 | N Z |
| $AD | LDA | abs         | 3 | 4 | N Z |
| $BD | LDA | abs,X       | 3 | 4+1* | N Z |
| $B9 | LDA | abs,Y       | 3 | 4+1* | N Z |
| $A1 | LDA | (zp,X)      | 2 | 6 | N Z |
| $B1 | LDA | (zp),Y      | 2 | 5+1* | N Z |
| $A2 | LDX | #imm        | 2 | 2 | N Z |
| $A6 | LDX | zp          | 2 | 3 | N Z |
| $B6 | LDX | zp,Y        | 2 | 4 | N Z |
| $AE | LDX | abs         | 3 | 4 | N Z |
| $BE | LDX | abs,Y       | 3 | 4+1* | N Z |
| $A0 | LDY | #imm        | 2 | 2 | N Z |
| $A4 | LDY | zp          | 2 | 3 | N Z |
| $B4 | LDY | zp,X        | 2 | 4 | N Z |
| $AC | LDY | abs         | 3 | 4 | N Z |
| $BC | LDY | abs,X       | 3 | 4+1* | N Z |
| $4A | LSR | A           | 1 | 2 | N Z C |
| $46 | LSR | zp          | 2 | 5 | N Z C |
| $56 | LSR | zp,X        | 2 | 6 | N Z C |
| $4E | LSR | abs         | 3 | 6 | N Z C |
| $5E | LSR | abs,X       | 3 | 7 | N Z C |
| $EA | NOP | impl        | 1 | 2 | — |
| $09 | ORA | #imm        | 2 | 2 | N Z |
| $05 | ORA | zp          | 2 | 3 | N Z |
| $15 | ORA | zp,X        | 2 | 4 | N Z |
| $0D | ORA | abs         | 3 | 4 | N Z |
| $1D | ORA | abs,X       | 3 | 4+1* | N Z |
| $19 | ORA | abs,Y       | 3 | 4+1* | N Z |
| $01 | ORA | (zp,X)      | 2 | 6 | N Z |
| $11 | ORA | (zp),Y      | 2 | 5+1* | N Z |
| $48 | PHA | impl        | 1 | 3 | — |
| $08 | PHP | impl        | 1 | 3 | — |
| $68 | PLA | impl        | 1 | 4 | N Z |
| $28 | PLP | impl        | 1 | 4 | all |
| $2A | ROL | A           | 1 | 2 | N Z C |
| $26 | ROL | zp          | 2 | 5 | N Z C |
| $36 | ROL | zp,X        | 2 | 6 | N Z C |
| $2E | ROL | abs         | 3 | 6 | N Z C |
| $3E | ROL | abs,X       | 3 | 7 | N Z C |
| $6A | ROR | A           | 1 | 2 | N Z C |
| $66 | ROR | zp          | 2 | 5 | N Z C |
| $76 | ROR | zp,X        | 2 | 6 | N Z C |
| $6E | ROR | abs         | 3 | 6 | N Z C |
| $7E | ROR | abs,X       | 3 | 7 | N Z C |
| $40 | RTI | impl        | 1 | 6 | all |
| $60 | RTS | impl        | 1 | 6 | — |
| $E9 | SBC | #imm        | 2 | 2 | N V Z C |
| $E5 | SBC | zp          | 2 | 3 | N V Z C |
| $F5 | SBC | zp,X        | 2 | 4 | N V Z C |
| $ED | SBC | abs         | 3 | 4 | N V Z C |
| $FD | SBC | abs,X       | 3 | 4+1* | N V Z C |
| $F9 | SBC | abs,Y       | 3 | 4+1* | N V Z C |
| $E1 | SBC | (zp,X)      | 2 | 6 | N V Z C |
| $F1 | SBC | (zp),Y      | 2 | 5+1* | N V Z C |
| $38 | SEC | impl        | 1 | 2 | C |
| $F8 | SED | impl        | 1 | 2 | D |
| $78 | SEI | impl        | 1 | 2 | I |
| $85 | STA | zp          | 2 | 3 | — |
| $95 | STA | zp,X        | 2 | 4 | — |
| $8D | STA | abs         | 3 | 4 | — |
| $9D | STA | abs,X       | 3 | 5 | — |
| $99 | STA | abs,Y       | 3 | 5 | — |
| $81 | STA | (zp,X)      | 2 | 6 | — |
| $91 | STA | (zp),Y      | 2 | 6 | — |
| $86 | STX | zp          | 2 | 3 | — |
| $96 | STX | zp,Y        | 2 | 4 | — |
| $8E | STX | abs         | 3 | 4 | — |
| $84 | STY | zp          | 2 | 3 | — |
| $94 | STY | zp,X        | 2 | 4 | — |
| $8C | STY | abs         | 3 | 4 | — |
| $AA | TAX | impl        | 1 | 2 | N Z |
| $A8 | TAY | impl        | 1 | 2 | N Z |
| $BA | TSX | impl        | 1 | 2 | N Z |
| $8A | TXA | impl        | 1 | 2 | N Z |
| $9A | TXS | impl        | 1 | 2 | — |
| $98 | TYA | impl        | 1 | 2 | N Z |

Total: 151 opcodes.

## Detailed opcode list

Each opcode below has a structured H3 entry suitable for entity
extraction. Entries are grouped by mnemonic in alphabetical order.

### ADC — Add with Carry

ADC adds the operand to A together with the current carry flag. In
binary mode (D=0): `A := A + operand + C`, setting C if the unsigned
sum exceeds $FF, V if the signed result overflows. In decimal mode
(D=1): both operands are packed BCD; the result is packed BCD with C
set on decimal carry; N, V, Z are undefined on NMOS.

To start an addition chain, **clear C first with CLC**. ADC always
uses the live C, so leftover C from a comparison or shift will perturb
the sum if not cleared.

### $69 — ADC #imm — Add with carry, immediate

**Cycles:** 2
**Flags:** N V Z C

### $65 — ADC zp — Add with carry, zero page

**Cycles:** 3
**Flags:** N V Z C

### $75 — ADC zp,X — Add with carry, zero page indexed by X

**Cycles:** 4
**Flags:** N V Z C

### $6D — ADC abs — Add with carry, absolute

**Cycles:** 4
**Flags:** N V Z C

### $7D — ADC abs,X — Add with carry, absolute indexed by X

**Cycles:** 4
**Flags:** N V Z C
**Page-cross:** +1

### $79 — ADC abs,Y — Add with carry, absolute indexed by Y

**Cycles:** 4
**Flags:** N V Z C
**Page-cross:** +1

### $61 — ADC (zp,X) — Add with carry, indexed indirect

**Cycles:** 6
**Flags:** N V Z C

### $71 — ADC (zp),Y — Add with carry, indirect indexed

**Cycles:** 5
**Flags:** N V Z C
**Page-cross:** +1

### AND — Logical AND

AND performs a bitwise AND between A and the operand and stores the
result in A. The result is reflected in N (bit 7 of result) and Z.

Common uses: masking off unwanted bits (e.g. `AND #$0F` to keep the
low nibble), testing whether specific bits are set (followed by a
BEQ/BNE), and clearing flags inside packed status bytes.

### $29 — AND #imm — Logical AND, immediate

**Cycles:** 2
**Flags:** N Z

### $25 — AND zp — Logical AND, zero page

**Cycles:** 3
**Flags:** N Z

### $35 — AND zp,X — Logical AND, zero page indexed by X

**Cycles:** 4
**Flags:** N Z

### $2D — AND abs — Logical AND, absolute

**Cycles:** 4
**Flags:** N Z

### $3D — AND abs,X — Logical AND, absolute indexed by X

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $39 — AND abs,Y — Logical AND, absolute indexed by Y

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $21 — AND (zp,X) — Logical AND, indexed indirect

**Cycles:** 6
**Flags:** N Z

### $31 — AND (zp),Y — Logical AND, indirect indexed

**Cycles:** 5
**Flags:** N Z
**Page-cross:** +1

### ASL — Arithmetic Shift Left

Shifts the operand left one bit. The bit shifted out of bit 7 goes
into C; bit 0 is filled with 0. Effectively multiplies by 2 for
unsigned values. N and Z are set from the result.

ASL on the accumulator is `ASL A` (or just `ASL` in some assemblers).
ASL on memory performs a read-modify-write cycle on that location.

### $0A — ASL A — Arithmetic shift left, accumulator

**Cycles:** 2
**Flags:** N Z C

### $06 — ASL zp — Arithmetic shift left, zero page

**Cycles:** 5
**Flags:** N Z C

### $16 — ASL zp,X — Arithmetic shift left, zero page indexed by X

**Cycles:** 6
**Flags:** N Z C

### $0E — ASL abs — Arithmetic shift left, absolute

**Cycles:** 6
**Flags:** N Z C

### $1E — ASL abs,X — Arithmetic shift left, absolute indexed by X

**Cycles:** 7
**Flags:** N Z C

### BCC — Branch if Carry Clear

If C=0, branch to PC + signed displacement; otherwise fall through.
2 cycles if not taken, 3 if taken (same page), 4 if taken to a
different page. Branches do not modify flags.

Typical idiom after CMP: BCC is "branch if A < operand" (unsigned).

### $90 — BCC rel — Branch if carry clear

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### BCS — Branch if Carry Set

If C=1, branch. Typical idiom after CMP: BCS is "branch if
A ≥ operand" (unsigned).

### $B0 — BCS rel — Branch if carry set

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### BEQ — Branch if Equal (Z=1)

If Z=1, branch. Typical idiom: branch when the last value was zero,
or after CMP, branch when A equals the operand.

### $F0 — BEQ rel — Branch if equal (Z=1)

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### BIT — Test Bits

BIT performs `A AND operand` but discards the result. Z is set from
the AND result. N and V are set from the *operand* (not the AND): N
gets bit 7 of the operand, V gets bit 6 of the operand.

This makes BIT the only way to non-destructively read bits 6 and 7 of
a memory location into the flags. Common uses: polling VIA/CIA bit-7
status registers without destroying A; testing two bits at once.

### $24 — BIT zp — Test bits, zero page

**Cycles:** 3
**Flags:** N V Z

### $2C — BIT abs — Test bits, absolute

**Cycles:** 4
**Flags:** N V Z

### BMI — Branch if Minus (N=1)

If N=1, branch.

### $30 — BMI rel — Branch if minus (N=1)

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### BNE — Branch if Not Equal (Z=0)

If Z=0, branch.

### $D0 — BNE rel — Branch if not equal (Z=0)

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### BPL — Branch if Plus (N=0)

If N=0, branch.

### $10 — BPL rel — Branch if plus (N=0)

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### BRK — Force Interrupt

Software interrupt. Pushes (PC + 2), pushes P with B=1, sets I=1,
and jumps to the address in $FFFE/$FFFF. The byte following the
BRK opcode is reserved as a signature byte and is *skipped*: the
return address pushed is PC + 2, not PC + 1. BRK is therefore
a 2-byte instruction even though its opcode is one byte.

Used historically for breakpoints in monitors (the monitor inserts a
$00 byte and reads its own table by the address of the BRK − 1).

### $00 — BRK impl — Force interrupt / break

**Cycles:** 7
**Flags:** I

### BVC — Branch if Overflow Clear (V=0)

If V=0, branch.

### $50 — BVC rel — Branch if overflow clear (V=0)

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### BVS — Branch if Overflow Set (V=1)

If V=1, branch. V is set by ADC/SBC and by BIT; CLV explicitly
clears it. A common trick: use BVS with V cleared as a hand-rolled
unconditional non-branch placeholder, or use BVS / BVC as control
flow based on BIT's bit-6 readout.

### $70 — BVS rel — Branch if overflow set (V=1)

**Cycles:** 2 (+1 if taken)
**Flags:** —
**Page-cross:** +1 (only when the branch is taken; total 4)

### CLC — Clear Carry

Clears C. Standard preamble before the first ADC of an addition chain.

### $18 — CLC impl — Clear carry flag

**Cycles:** 2
**Flags:** C

### CLD — Clear Decimal

Clears D, returning ADC/SBC to binary mode. The KERNAL reset routine
runs this; user code that hooks $FFFC should also run this before
any arithmetic.

### $D8 — CLD impl — Clear decimal flag

**Cycles:** 2
**Flags:** D

### CLI — Clear Interrupt Disable

Clears I, allowing IRQ requests through. Typical at the end of an
interrupt handler that wants to be re-entrant, or at the end of a
critical section that started with SEI.

### $58 — CLI impl — Clear interrupt disable

**Cycles:** 2
**Flags:** I

### CLV — Clear Overflow

Clears V. There is no "SEV": V can only be set by ADC/SBC, BIT, or
restored from a pushed status byte by PLP/RTI.

### $B8 — CLV impl — Clear overflow flag

**Cycles:** 2
**Flags:** V

### CMP — Compare with Accumulator

CMP performs `A − operand`, discards the result, and sets N, Z, C from
the subtraction:

- C is set if A ≥ operand (unsigned).
- Z is set if A == operand.
- N reflects bit 7 of the subtraction result.

CMP does not modify A. Typical idiom: `CMP #$xx / BEQ / BCS / BCC` to
dispatch on the value of A.

### $C9 — CMP #imm — Compare A with immediate

**Cycles:** 2
**Flags:** N Z C

### $C5 — CMP zp — Compare A with zero page

**Cycles:** 3
**Flags:** N Z C

### $D5 — CMP zp,X — Compare A with zero page indexed by X

**Cycles:** 4
**Flags:** N Z C

### $CD — CMP abs — Compare A with absolute

**Cycles:** 4
**Flags:** N Z C

### $DD — CMP abs,X — Compare A with absolute indexed by X

**Cycles:** 4
**Flags:** N Z C
**Page-cross:** +1

### $D9 — CMP abs,Y — Compare A with absolute indexed by Y

**Cycles:** 4
**Flags:** N Z C
**Page-cross:** +1

### $C1 — CMP (zp,X) — Compare A with indexed indirect

**Cycles:** 6
**Flags:** N Z C

### $D1 — CMP (zp),Y — Compare A with indirect indexed

**Cycles:** 5
**Flags:** N Z C
**Page-cross:** +1

### CPX — Compare with X

Same as CMP but uses X. Three addressing modes: immediate, zero page,
absolute.

### $E0 — CPX #imm — Compare X with immediate

**Cycles:** 2
**Flags:** N Z C

### $E4 — CPX zp — Compare X with zero page

**Cycles:** 3
**Flags:** N Z C

### $EC — CPX abs — Compare X with absolute

**Cycles:** 4
**Flags:** N Z C

### CPY — Compare with Y

Same as CMP but uses Y. Three addressing modes: immediate, zero page,
absolute.

### $C0 — CPY #imm — Compare Y with immediate

**Cycles:** 2
**Flags:** N Z C

### $C4 — CPY zp — Compare Y with zero page

**Cycles:** 3
**Flags:** N Z C

### $CC — CPY abs — Compare Y with absolute

**Cycles:** 4
**Flags:** N Z C

### DEC — Decrement Memory

Subtracts 1 from the memory operand. N and Z are set from the result.
Read-modify-write: the original value is read, the new value is
computed, and the new value is written back.

### $C6 — DEC zp — Decrement zero page

**Cycles:** 5
**Flags:** N Z

### $D6 — DEC zp,X — Decrement zero page indexed by X

**Cycles:** 6
**Flags:** N Z

### $CE — DEC abs — Decrement absolute

**Cycles:** 6
**Flags:** N Z

### $DE — DEC abs,X — Decrement absolute indexed by X

**Cycles:** 7
**Flags:** N Z

### DEX — Decrement X

Subtracts 1 from X. N and Z reflect the new X.

### $CA — DEX impl — Decrement X

**Cycles:** 2
**Flags:** N Z

### DEY — Decrement Y

Subtracts 1 from Y. N and Z reflect the new Y.

### $88 — DEY impl — Decrement Y

**Cycles:** 2
**Flags:** N Z

### EOR — Exclusive OR

Bitwise exclusive-or between A and the operand, result in A. Useful
for inverting specific bits (`EOR #$FF` flips all bits, `EOR #$80`
flips the high bit), comparing two values for difference, and
running stream XOR ciphers.

### $49 — EOR #imm — Exclusive OR, immediate

**Cycles:** 2
**Flags:** N Z

### $45 — EOR zp — Exclusive OR, zero page

**Cycles:** 3
**Flags:** N Z

### $55 — EOR zp,X — Exclusive OR, zero page indexed by X

**Cycles:** 4
**Flags:** N Z

### $4D — EOR abs — Exclusive OR, absolute

**Cycles:** 4
**Flags:** N Z

### $5D — EOR abs,X — Exclusive OR, absolute indexed by X

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $59 — EOR abs,Y — Exclusive OR, absolute indexed by Y

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $41 — EOR (zp,X) — Exclusive OR, indexed indirect

**Cycles:** 6
**Flags:** N Z

### $51 — EOR (zp),Y — Exclusive OR, indirect indexed

**Cycles:** 5
**Flags:** N Z
**Page-cross:** +1

### INC — Increment Memory

Adds 1 to the memory operand. N and Z are set from the result.
Read-modify-write.

### $E6 — INC zp — Increment zero page

**Cycles:** 5
**Flags:** N Z

### $F6 — INC zp,X — Increment zero page indexed by X

**Cycles:** 6
**Flags:** N Z

### $EE — INC abs — Increment absolute

**Cycles:** 6
**Flags:** N Z

### $FE — INC abs,X — Increment absolute indexed by X

**Cycles:** 7
**Flags:** N Z

### INX — Increment X

Adds 1 to X.

### $E8 — INX impl — Increment X

**Cycles:** 2
**Flags:** N Z

### INY — Increment Y

Adds 1 to Y.

### $C8 — INY impl — Increment Y

**Cycles:** 2
**Flags:** N Z

### JMP — Jump

Unconditional jump. Two modes: absolute (jump to a fixed address) and
indirect (jump to the address stored at the operand). The indirect
form has the page-wrap bug; see [Pitfalls](#pitfalls).

### $4C — JMP abs — Jump, absolute

**Cycles:** 3
**Flags:** —

### $6C — JMP (abs) — Jump, indirect

**Cycles:** 5
**Flags:** —

### JSR — Jump to Subroutine

Pushes (PC + 2) (the address of the last byte of the JSR
instruction), then jumps to the operand address. The matching RTS
pulls the address and adds 1 to land on the next instruction.

### $20 — JSR abs — Jump to subroutine, absolute

**Cycles:** 6
**Flags:** —

### LDA — Load Accumulator

Loads the operand into A. Sets N and Z from the loaded value. The
most heavily used instruction in 6502/6510 code.

### $A9 — LDA #imm — Load A, immediate

**Cycles:** 2
**Flags:** N Z

### $A5 — LDA zp — Load A, zero page

**Cycles:** 3
**Flags:** N Z

### $B5 — LDA zp,X — Load A, zero page indexed by X

**Cycles:** 4
**Flags:** N Z

### $AD — LDA abs — Load A, absolute

**Cycles:** 4
**Flags:** N Z

### $BD — LDA abs,X — Load A, absolute indexed by X

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $B9 — LDA abs,Y — Load A, absolute indexed by Y

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $A1 — LDA (zp,X) — Load A, indexed indirect

**Cycles:** 6
**Flags:** N Z

### $B1 — LDA (zp),Y — Load A, indirect indexed

**Cycles:** 5
**Flags:** N Z
**Page-cross:** +1

### LDX — Load X

Loads the operand into X.

### $A2 — LDX #imm — Load X, immediate

**Cycles:** 2
**Flags:** N Z

### $A6 — LDX zp — Load X, zero page

**Cycles:** 3
**Flags:** N Z

### $B6 — LDX zp,Y — Load X, zero page indexed by Y

**Cycles:** 4
**Flags:** N Z

### $AE — LDX abs — Load X, absolute

**Cycles:** 4
**Flags:** N Z

### $BE — LDX abs,Y — Load X, absolute indexed by Y

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### LDY — Load Y

Loads the operand into Y.

### $A0 — LDY #imm — Load Y, immediate

**Cycles:** 2
**Flags:** N Z

### $A4 — LDY zp — Load Y, zero page

**Cycles:** 3
**Flags:** N Z

### $B4 — LDY zp,X — Load Y, zero page indexed by X

**Cycles:** 4
**Flags:** N Z

### $AC — LDY abs — Load Y, absolute

**Cycles:** 4
**Flags:** N Z

### $BC — LDY abs,X — Load Y, absolute indexed by X

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### LSR — Logical Shift Right

Shifts the operand right one bit. Bit 0 goes into C; bit 7 is filled
with 0. N is always 0 after LSR. Z reflects whether the result is zero.

### $4A — LSR A — Logical shift right, accumulator

**Cycles:** 2
**Flags:** N Z C

### $46 — LSR zp — Logical shift right, zero page

**Cycles:** 5
**Flags:** N Z C

### $56 — LSR zp,X — Logical shift right, zero page indexed by X

**Cycles:** 6
**Flags:** N Z C

### $4E — LSR abs — Logical shift right, absolute

**Cycles:** 6
**Flags:** N Z C

### $5E — LSR abs,X — Logical shift right, absolute indexed by X

**Cycles:** 7
**Flags:** N Z C

### NOP — No Operation

Does nothing for 2 cycles. The single legal NOP is $EA; there are
several illegal NOP opcodes documented in
[6502-illegal-opcodes.md](6502-illegal-opcodes.md) covering 1, 2, and
3 byte forms with various cycle counts.

### $EA — NOP impl — No operation

**Cycles:** 2
**Flags:** —

### ORA — Logical Inclusive OR

Bitwise OR between A and the operand, result in A. Common uses:
setting specific bits in A, combining flags.

### $09 — ORA #imm — Logical OR, immediate

**Cycles:** 2
**Flags:** N Z

### $05 — ORA zp — Logical OR, zero page

**Cycles:** 3
**Flags:** N Z

### $15 — ORA zp,X — Logical OR, zero page indexed by X

**Cycles:** 4
**Flags:** N Z

### $0D — ORA abs — Logical OR, absolute

**Cycles:** 4
**Flags:** N Z

### $1D — ORA abs,X — Logical OR, absolute indexed by X

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $19 — ORA abs,Y — Logical OR, absolute indexed by Y

**Cycles:** 4
**Flags:** N Z
**Page-cross:** +1

### $01 — ORA (zp,X) — Logical OR, indexed indirect

**Cycles:** 6
**Flags:** N Z

### $11 — ORA (zp),Y — Logical OR, indirect indexed

**Cycles:** 5
**Flags:** N Z
**Page-cross:** +1

### PHA — Push Accumulator

Pushes A onto the stack. SP decrements after the push.

### $48 — PHA impl — Push accumulator

**Cycles:** 3
**Flags:** —

### PHP — Push Processor Status

Pushes P onto the stack with bit 4 (B) = 1 and bit 5 = 1.

### $08 — PHP impl — Push processor status

**Cycles:** 3
**Flags:** —

### PLA — Pull Accumulator

Pulls a byte from the stack into A. SP increments before the read.
N and Z reflect the value pulled.

### $68 — PLA impl — Pull accumulator

**Cycles:** 4
**Flags:** N Z

### PLP — Pull Processor Status

Pulls a byte from the stack into P. Bits 4 (B) and 5 (unused) of the
pulled byte are *ignored*: they are not transferred to the live P
register, which has no B flip-flop.

### $28 — PLP impl — Pull processor status

**Cycles:** 4
**Flags:** N V Z C I D

### ROL — Rotate Left

Rotates the operand left one bit through C. C becomes new bit 0; old
bit 7 becomes new C.

### $2A — ROL A — Rotate left, accumulator

**Cycles:** 2
**Flags:** N Z C

### $26 — ROL zp — Rotate left, zero page

**Cycles:** 5
**Flags:** N Z C

### $36 — ROL zp,X — Rotate left, zero page indexed by X

**Cycles:** 6
**Flags:** N Z C

### $2E — ROL abs — Rotate left, absolute

**Cycles:** 6
**Flags:** N Z C

### $3E — ROL abs,X — Rotate left, absolute indexed by X

**Cycles:** 7
**Flags:** N Z C

### ROR — Rotate Right

Rotates the operand right one bit through C. C becomes new bit 7; old
bit 0 becomes new C.

The original NMOS 6502 mask-rev A did not have ROR; it executed as
an unspecified result. All 6510s and all post-rev-A 6502s implement
ROR correctly. Practical C64 code can assume ROR works.

### $6A — ROR A — Rotate right, accumulator

**Cycles:** 2
**Flags:** N Z C

### $66 — ROR zp — Rotate right, zero page

**Cycles:** 5
**Flags:** N Z C

### $76 — ROR zp,X — Rotate right, zero page indexed by X

**Cycles:** 6
**Flags:** N Z C

### $6E — ROR abs — Rotate right, absolute

**Cycles:** 6
**Flags:** N Z C

### $7E — ROR abs,X — Rotate right, absolute indexed by X

**Cycles:** 7
**Flags:** N Z C

### RTI — Return from Interrupt

Pulls P, then pulls a 16-bit return address (low first, then high)
into PC. Unlike RTS, RTI does *not* add 1 to the pulled address. This
matches the way IRQ/NMI/BRK pushed the address.

### $40 — RTI impl — Return from interrupt

**Cycles:** 6
**Flags:** N V Z C I D

### RTS — Return from Subroutine

Pulls a 16-bit address (low first, then high), adds 1, and stores
the result in PC. This matches JSR, which pushed (PC + 2) i.e. the
address of its last operand byte.

### $60 — RTS impl — Return from subroutine

**Cycles:** 6
**Flags:** —

### SBC — Subtract with Carry

SBC subtracts the operand and the inverted carry from A: `A := A − operand − (1 − C)`.
The carry flag is the *inverted borrow*: SEC before the first SBC of
a subtraction chain.

After the operation, C=1 means "no borrow out" (i.e. A ≥ operand) and
C=0 means "borrow out". V is set on signed overflow. In decimal mode,
SBC produces packed BCD output; N, V, Z are undefined on NMOS.

### $E9 — SBC #imm — Subtract with carry, immediate

**Cycles:** 2
**Flags:** N V Z C

### $E5 — SBC zp — Subtract with carry, zero page

**Cycles:** 3
**Flags:** N V Z C

### $F5 — SBC zp,X — Subtract with carry, zero page indexed by X

**Cycles:** 4
**Flags:** N V Z C

### $ED — SBC abs — Subtract with carry, absolute

**Cycles:** 4
**Flags:** N V Z C

### $FD — SBC abs,X — Subtract with carry, absolute indexed by X

**Cycles:** 4
**Flags:** N V Z C
**Page-cross:** +1

### $F9 — SBC abs,Y — Subtract with carry, absolute indexed by Y

**Cycles:** 4
**Flags:** N V Z C
**Page-cross:** +1

### $E1 — SBC (zp,X) — Subtract with carry, indexed indirect

**Cycles:** 6
**Flags:** N V Z C

### $F1 — SBC (zp),Y — Subtract with carry, indirect indexed

**Cycles:** 5
**Flags:** N V Z C
**Page-cross:** +1

### SEC — Set Carry

Sets C. Standard preamble before the first SBC of a subtraction chain.

### $38 — SEC impl — Set carry flag

**Cycles:** 2
**Flags:** C

### SED — Set Decimal

Sets D, switching ADC/SBC to BCD mode.

### $F8 — SED impl — Set decimal flag

**Cycles:** 2
**Flags:** D

### SEI — Set Interrupt Disable

Sets I, blocking IRQ. NMI is still allowed. Used to protect critical
code sections.

### $78 — SEI impl — Set interrupt disable

**Cycles:** 2
**Flags:** I

### STA — Store Accumulator

Writes A to the operand address. Does not modify flags. The indexed
modes always take their unindexed cycle count plus one (write modes
always pay the page-cross-style penalty as a dummy-read cycle).

### $85 — STA zp — Store A, zero page

**Cycles:** 3
**Flags:** —

### $95 — STA zp,X — Store A, zero page indexed by X

**Cycles:** 4
**Flags:** —

### $8D — STA abs — Store A, absolute

**Cycles:** 4
**Flags:** —

### $9D — STA abs,X — Store A, absolute indexed by X

**Cycles:** 5
**Flags:** —

### $99 — STA abs,Y — Store A, absolute indexed by Y

**Cycles:** 5
**Flags:** —

### $81 — STA (zp,X) — Store A, indexed indirect

**Cycles:** 6
**Flags:** —

### $91 — STA (zp),Y — Store A, indirect indexed

**Cycles:** 6
**Flags:** —

### STX — Store X

Writes X to the operand address. The zero-page-indexed form uses Y
(`STX zp,Y`), not X, matching LDX zp,Y. There is no
`STX abs,X` or `STX abs,Y`.

### $86 — STX zp — Store X, zero page

**Cycles:** 3
**Flags:** —

### $96 — STX zp,Y — Store X, zero page indexed by Y

**Cycles:** 4
**Flags:** —

### $8E — STX abs — Store X, absolute

**Cycles:** 4
**Flags:** —

### STY — Store Y

Writes Y to the operand address. There is no `STY abs,X` or
`STY abs,Y`.

### $84 — STY zp — Store Y, zero page

**Cycles:** 3
**Flags:** —

### $94 — STY zp,X — Store Y, zero page indexed by X

**Cycles:** 4
**Flags:** —

### $8C — STY abs — Store Y, absolute

**Cycles:** 4
**Flags:** —

### TAX — Transfer A to X

Copies A into X. Sets N and Z from the new X.

### $AA — TAX impl — Transfer A to X

**Cycles:** 2
**Flags:** N Z

### TAY — Transfer A to Y

Copies A into Y. Sets N and Z from the new Y.

### $A8 — TAY impl — Transfer A to Y

**Cycles:** 2
**Flags:** N Z

### TSX — Transfer Stack Pointer to X

Copies SP into X. Sets N and Z. The only way to *read* SP.

### $BA — TSX impl — Transfer stack pointer to X

**Cycles:** 2
**Flags:** N Z

### TXA — Transfer X to A

Copies X into A.

### $8A — TXA impl — Transfer X to A

**Cycles:** 2
**Flags:** N Z

### TXS — Transfer X to Stack Pointer

Copies X into SP. **Does not set flags.** It is the one transfer
instruction that is flag-silent, so SP can be set up without
disturbing the rest of the program state. Conventional startup:
`LDX #$FF / TXS`.

### $9A — TXS impl — Transfer X to stack pointer

**Cycles:** 2
**Flags:** —

### TYA — Transfer Y to A

Copies Y into A.

### $98 — TYA impl — Transfer Y to A

**Cycles:** 2
**Flags:** N Z

## Page-crossing penalties

A "page" on the 6510 is a 256-byte aligned region of address space:
$0000–$00FF is page 0, $0100–$01FF is page 1 (the stack), $0200–$02FF
is page 2, etc. Crossing a page during effective-address computation
costs an extra cycle on read instructions because the CPU performs
the high-byte addition as a separate microcode step.

### Which instructions pay

Page-cross penalties apply to:

- `abs,X` and `abs,Y` read forms of ADC, AND, CMP, EOR, LDA, LDY, LDX,
  ORA, SBC.
- `(zp),Y` read form of ADC, AND, CMP, EOR, LDA, ORA, SBC.
- Taken branches that land on a different page (+1; the branch is
  always +1 cycle when taken, +2 when taken across a page).

### Which instructions do not pay (always max cycles)

Write instructions always take their worst-case cycle count regardless
of page-cross, because the CPU performs a dummy read at the
pre-fixup address before the real write:

- `STA abs,X`, `STA abs,Y`, `STA (zp),Y`: always 5 / 5 / 6 cycles.
- Read-modify-write instructions (`ASL abs,X`, `DEC abs,X`,
  `INC abs,X`, `LSR abs,X`, `ROL abs,X`, `ROR abs,X`): always 7
  cycles.

For these, the cycle count in the table and detail entries is the
*real* cycle count; there is no "+1*" because the penalty is
already baked in.

### Cycle-counting in practice

Demo coders avoid page crosses in their innermost loop to keep the
cycle count constant. The standard trick is to align tables so the
indexed-into-table reads never cross a page; or to use zero-page
indirection (`(zp),Y`) with a manually-incremented high byte; or to
unroll the loop so each iteration's address is a fixed absolute.

For branches, keep tight loops within a
single page so the back-branch is always same-page (3 cycles, not 4).

## The I/O port at $00 / $01

The 6510 (and 6502) instruction set has no built-in I/O. The 6510
adds a six-bit on-chip I/O port mapped into the low two bytes of
the address space:

| Address | Name | Description |
|---------|------|-------------|
| $00     | DDR  | Data direction register: bit n = 1 means "pin n is output", bit n = 0 means "pin n is input" |
| $01     | DATA | Data register: writing sets output-pin levels; reading returns pin levels (output pins return what was last written; input pins return live pin state) |

The port has six physical pins on the chip. Bits 6 and 7 have no pins
on the 6510. If configured as outputs they read back whatever was last
written; if configured as inputs they read the last driven value,
decaying to 0 over hundreds of milliseconds (see
[Reading the port](#reading-the-port)). Mask them off (AND #$3F) before
comparing $01. An earlier version of this paragraph said the two bits
"behave as if always 0"; measured in VICE, $F7 written to $01 with
DDR=$EF reads back as $F7.

### What each bit controls on the C64

Wired to the C64 board, the six port pins drive the C64's
ROM/RAM/IO banking and the Datasette interface:

| Bit | Output meaning | Input meaning |
|-----|----------------|---------------|
| 0   | LORAM: bank BASIC ROM at $A000–$BFFF (0=RAM, 1=ROM) | (output) |
| 1   | HIRAM: bank KERNAL ROM at $E000–$FFFF (0=RAM, 1=ROM) | (output) |
| 2   | CHAREN: when LORAM or HIRAM is 1, 0 = character ROM at $D000–$DFFF, 1 = I/O. When LORAM=HIRAM=0 the region is RAM regardless of CHAREN (an earlier version of this row conditioned the character ROM on HIRAM alone; mode %001 shows it with HIRAM=0) | (output) |
| 3   | Datasette write line | (output) |
| 4   | (no output — input only) | Datasette switch sense: 0 = a tape button is pressed, 1 = none. Not the tape data line — tape READ pulses arrive on CIA1 /FLAG ($DC0D bit 4). |
| 5   | Datasette motor (0=motor on, 1=motor off) | (output) |

The KERNAL uses bit 4 only as a button switch: its cassette-switch test
at $F82E (`LDA #$10 / BIT $01`) drives the "PRESS PLAY ON TAPE" wait at
$F817 and the "PRESS RECORD & PLAY ON TAPE" wait at $F838 (the same
single bit, so software cannot tell which button is down), and the
default IRQ's motor interlock at $EA61 turns the motor off (bit 5 = 1)
while bit 4 reads 1 and on while it reads 0. Tape data is never read
from this port: the tape-read setup enables the CIA1 FLAG interrupt
(clears $DC0D, then writes $90 to it, at $F877/$F87A) and the read IRQ
at $F92C times pulses with CIA1 timer B. An earlier version of the
table above called bit 4 the "Datasette read sense", which reads as the
data line; it is the switch.

The KERNAL's IOINIT ($FDA3; entered from RESET at $FCE2 and from the
jump table at $FF84) writes DATA=$E7 to $01 first and then DDR=$2F to
$00 (`LDA #$E7 / STA $01 / LDA #$2F / STA $00` at $FDD5). An earlier
version of this paragraph said "DATA=$37", which is what the port
*reads back*, not what is written. DDR=$2F makes bits 0,1,2,3,5 outputs
and bit 4 an input. With no tape button pressed, $01 then reads back as
$37: LORAM=HIRAM=CHAREN=1, datasette write=0, sense=1 (input, pulled
high), motor off; bits 6/7 are not connected on the 6510 and read as 0
once the written 1s have decayed. This gives the default boot
configuration: BASIC ROM at $A000, KERNAL ROM at $E000, I/O at $D000,
datasette idle.

### The seven banking modes

The bottom three bits of $01 select one of eight combinations, seven of
them distinct: %000 and %100 are both all-RAM. %110 ($36) and %111 ($37)
are NOT the same: %110 has RAM at $A000–$BFFF, %111 has BASIC ROM
there (an earlier version of this sentence called 6 and 7 the identical
pair; the table below, and a VICE read of $A000 in each mode, say
otherwise):

| Bits 210 | $A000–$BFFF | $D000–$DFFF | $E000–$FFFF |
|----------|-------------|-------------|-------------|
| 000      | RAM | RAM | RAM |
| 001      | RAM | CHARROM | RAM |
| 010      | RAM | CHARROM | KERNAL |
| 011      | BASIC | CHARROM | KERNAL |
| 100      | RAM | RAM | RAM |
| 101      | RAM | I/O | RAM |
| 110      | RAM | I/O | KERNAL |
| 111      | BASIC | I/O | KERNAL |

(With expansion-port cartridge signals GAME and EXROM, additional
banking modes are available; those are covered in
[c64-memory-map.md](c64-memory-map.md).)

### Use cases

- Bank out I/O (set bit 2 = 0 with bit 1 = 1) to access character
  ROM at $D000–$DFFF for copying it into RAM.
- Bank out everything (set bits 0,1,2 = 0) for a 64KB RAM space,
  needed by full-RAM games and many demos.
- Bank out KERNAL (bit 1 = 0) to install a custom IRQ vector at
  $FFFE/$FFFF without going through the KERNAL dispatcher.

### Reading the port

When reading $01, the value returned is:

- For each pin configured as output (DDR bit = 1): the value last
  written to $01 for that bit.
- For each pin configured as input (DDR bit = 0): the live state of
  the input pin.

Reading $00 returns the data direction register itself.

Bits 6 and 7 have
no package pin, so when they are switched from output to input the
last driven level lingers on the floating input. A 1 written there
keeps reading as 1 for a few hundred milliseconds before decaying to 0
(VICE models 350,000–420,000 cycles, about 0.35–0.43 s, randomised
independently for each bit, and its source notes a measured average of
roughly 350 ms for a 6510 and 1.5 s for an 8500, varying with
temperature); a driven 0 stays 0. An earlier version of this paragraph
said "several milliseconds" and attributed the effect to every pin:
two orders of magnitude short, and wrong about the wired pins. The six
wired pins do not behave this way on a C64 board: LORAM/HIRAM/CHAREN
(bits 0–2) have pull-ups and read 1 as inputs regardless of what was
last driven, bit 4 is always an input, and bits 3 and 5 read whatever
the cassette circuitry holds them at (VICE: bit 3 keeps its last driven
level, bit 5 reads 0). Do not rely on bits 6/7 for anything; the memory
map's $0000–$0001 entry says the same. Defensive code that toggles DDR
mid-frame should account for this; see
[$0000-$0001 — Processor I/O port](c64-memory-map.md#0000-0001--processor-io-port)
and the [Pitfalls](c64-memory-map.md#pitfalls) bullet on bits 6/7 in
the memory map, which note the decay but give no figure.

### Why this matters for code

Any code that writes to $00 or $01 changes the visible memory map for
the very next instruction fetch. If the code is running from a
location that gets banked out, the *next* fetch returns the new
mapping's contents. Standard practice: run banking-switch code from a
location that maps to RAM in BOTH the old and the new configuration.
With no cartridge, $0002–$9FFF and $C000–$CFFF are RAM in every $01
setting (in practice use $0200 upward, clear of zero page and the
stack), so put general-purpose banking switchers there. $A000–$BFFF,
$D000–$DFFF and $E000–$FFFF are the multiplexed region (see the table
above). Code there is fetched from BASIC ROM, character ROM/I/O or
KERNAL ROM the instant a write to $01 selects them, so only place a
switcher there if neither configuration it switches between maps ROM
or I/O over it. An earlier version of this paragraph said "$0200–$BFFF
is always present"; $A000–$BFFF is BASIC ROM whenever LORAM and HIRAM
are both 1.

The common idiom:

```asm
    SEI                ; block IRQ (which would re-read KERNAL)
    LDA #$35           ; LORAM=1, HIRAM=0, CHAREN=1  → KERNAL out, I/O in
    STA $01
    ; ... do stuff with KERNAL banked out ...
    LDA #$37           ; restore default
    STA $01
    CLI
```

## Pitfalls

- **BRK is a 2-byte instruction.** The opcode is $00, but the byte
  following it is reserved as a "signature" byte. BRK pushes
  (PC + 2), not (PC + 1), as the return address. A BRK followed by
  RTI returns to the byte *two* past the BRK. Code that disassembles
  raw bytes naively will misalign after a BRK.
- **JMP indirect page-wrap bug.** `JMP ($xxFF)` reads the low byte
  from $xxFF but the high byte from $xx00, not $xx00+$100. Always
  place indirect-JMP pointers so the low byte is not on the last
  byte of a page.
- **Decimal flag undefined at reset.** The hardware does not zero D
  on RESET. The KERNAL reset routine clears it; custom reset
  handlers must do `CLD` before any ADC/SBC.
- **N/V/Z undefined after BCD ADC/SBC.** Only C is reliable after a
  BCD operation on the NMOS 6510. Code that needs to branch on the
  result of a BCD compare must convert back to binary first or use
  CMP after a SED block.
- **Zero-page,X wraps inside zero page.** `LDA $80,X` with X=$F0
  reads from $70, not $0170. The same applies to `STA $xx,X` and
  the rest of the `zp,X` family.
- **(zp,X) and (zp),Y are different.** `LDA ($10,X)` adds X
  to the pointer *address* inside zero page; `LDA ($10),Y` adds Y
  to the dereferenced pointer *value*. Mixing them up is the most
  common 6510 bug.
- **Branches are signed 8-bit relative.** Range is −128 to +127. If
  the assembler reports "branch out of range", insert a `BCC :+ /
  JMP target / :` trampoline.
- **C must be cleared before first ADC, set before first SBC.** ADC
  and SBC always use the live C; stale C from a CMP or shift will
  perturb arithmetic by 1.
- **PHP and BRK push P with B=1; IRQ and NMI push P with B=0.** The
  pushed B bit is how a handler distinguishes BRK from IRQ when
  both vector through $FFFE.
- **RTI does not add 1.** RTS does. Mismatching them (RTI from a JSR
  or RTS from an IRQ) lands one byte off.
- **TXS does not modify flags.** All other T?? transfers do. This is
  intentional so SP can be set between flag-sensitive operations.
- **STA abs,X/Y, STA (zp),Y, and all RMW indexed always pay the
  page-cross penalty.** No "+1*" in their cycle table; the penalty
  is baked into the constant cycle count. Demo coders who balance
  read and write cycles need to remember this.
- **Reading $01 with input pins.** Pins configured as input in $00
  return live pin state. If a cartridge or external hardware drives
  these lines, the read value is not what was last written.
- **Writing to $01 immediately remaps memory.** If the code is
  located in the region being remapped, the next fetch hits the
  new mapping. Always bank-switch from a region that is identical
  in both mappings (i.e. $0200–$9FFF or $C000–$CFFF on the C64).
- **The IRQ handler must save A, X, Y by hand on the 6510.** Only PC
  and P are pushed by the hardware. A handler that clobbers A but
  did not PHA on entry will corrupt the interrupted code's state.
- **CLI inside an IRQ handler immediately re-enables IRQ.** If the
  IRQ source has not been acknowledged before CLI, a second IRQ will
  re-enter the handler.

## Sources

- "6502 Instruction Set", *masswerk.at*.
  https://www.masswerk.at/6502/6502_instruction_set.html
- "6502/6510 Opcodes", *oxyron.de* (legal opcode section).
  https://www.oxyron.de/html/opcodes02.html
- "Processor (C64)", *C64-Wiki*. https://www.c64-wiki.com/wiki/Processor
- "6502", *pagetable.com c64ref*. https://www.pagetable.com/c64ref/6502/
- *MCS 6500 Microcomputer Family Programming Manual*, MOS Technology,
  1976. The original MOS programmer's reference.
- *Programming the Commodore 64*, Raeto West, Compute! Publications,
  1985. Chapters on the 6510 and the $00/$01 port.
- "Zeropage", Codebase 64. https://codebase64.org/doku.php?id=base:zeropage
- "6510 I/O port", Codebase 64.
  https://codebase64.org/doku.php?id=base:6510_processor_port

<!-- doc-type: hardware-reference -->
