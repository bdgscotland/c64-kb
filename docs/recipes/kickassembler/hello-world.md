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

`.encoding "petscii_upper"` matters. KickAssembler's default text encoding
is `screencode_mixed`, which emits *screen codes* (what you poke into
$0400), not PETSCII (what CHROUT expects); with the default, `.text
"HELLO"` sends bytes $08 $05 $0C $0C $0F to CHROUT and nothing readable
appears. There is no `chr()` function in KickAssembler's script language;
control characters go in as `.byte` values. Both of these were wrong in an
earlier version of this recipe, which did not assemble.

Verified: assembled with KickAssembler 5.25 and run in VICE x64sc; the
screen shows `HELLO, WORLD!` followed by `READY.`.
