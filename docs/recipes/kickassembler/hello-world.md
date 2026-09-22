---
recipe: hello-world
toolchain: kickassembler
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: []
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# KickAssembler Hello World

## Synopsis

Smallest KickAssembler program that prints `HELLO, WORLD!` via KERNAL
CHROUT and returns to BASIC. Demonstrates the canonical BASIC-stub
prologue and direct CHROUT use without any framework.

## Source

```asm
// hello.asm
BasicUpstart2(start)

.const CHROUT = $ffd2

start:
    ldx #0
loop:
    lda message,x
    beq done
    jsr CHROUT
    inx
    bne loop
done:
    rts

.encoding "petscii_upper"    // CHROUT wants PETSCII, not screen codes
message:
    .text "HELLO, WORLD!"
    .byte $0d, 0             // carriage return, then the terminator
```

## Build

```bash
java -jar KickAss.jar hello.asm -o hello.prg
```

Produces `hello.prg`.

## Expected output

```
HELLO, WORLD!
READY.
```

Screenshot from the VICE run this page describes: `screenshots/hello-world.png`.

## Why this works

`BasicUpstart2(start)` is a KickAss macro that emits the BASIC stub
`10 SYS <addr-of-start>` at `$0801` and aligns the program counter so
`start:` lives at the calculated SYS target. This is the idiomatic
prologue; writing the stub by hand is a common LLM antipattern.

The character output loop uses CHROUT (`$FFD2`) from the C64 KERNAL
jumptable. The terminator-zero convention matches C-string layout — note
that BASIC strings on the C64 are NOT zero-terminated, so this isn't a
BASIC-string-compatible buffer; it's our own convention.

`.encoding "petscii_upper"` is there on principle, not because this
particular string needs it. KickAssembler's default text encoding is
`screencode_mixed` (manual §3.7), which emits *screen codes* (what you poke
into $0400), not PETSCII (what CHROUT expects). For upper-case source text
the two happen to coincide: `screencode_mixed` maps `A`-`Z` to $41-$5A,
which are also the PETSCII codes CHROUT prints as upper-case letters, so
with the default encoding `.text "HELLO"` assembles to $48 $45 $4C $4C $4F
and the screen comes out pixel-identical to this recipe's (measured,
KickAssembler 5.25 + VICE 3.10). The trap bites as soon as the letters
land in the $01-$1A screen-code range — lower-case source text under the
default, or `.encoding "screencode_upper"` — where `"HELLO"` becomes
$08 $05 $0C $0C $0F, and CHROUT reads those as control codes ($05 turns
the pen white, $12 in `WORLD` switches reverse on): the run shows `, `, a
reversed white glyph and a white `READY.`. An earlier version of this
paragraph said the default encoding itself produced the $08 $05 $0C $0C $0F
bytes and printed nothing readable; it does not for upper-case text.
There is no `chr()` function in KickAssembler's script language
(`Error: Unknown function 'chr'`); control characters go in as `.byte`
values. An earlier version of this recipe used `chr()` and did not
assemble.

Verified: assembled with KickAssembler 5.25 and run in VICE x64sc; the
screen shows `HELLO, WORLD!` followed by `READY.`.
