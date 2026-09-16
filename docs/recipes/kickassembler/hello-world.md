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

.var msg = "HELLO, WORLD!" + chr($0d)
.const CHROUT = $ffd2

start:
    ldx #0
loop:
    lda message,x
    beq done
    jsr CHROUT
    inx
    jmp loop
done:
    rts

message:
    .text msg
    .byte 0
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

## Why this works

`BasicUpstart2(start)` is a KickAss macro that emits the BASIC stub
`10 SYS <addr-of-start>` at `$0801` and aligns the program counter so
`start:` lives at the calculated SYS target. This is the idiomatic
prologue; writing the stub by hand is a common LLM antipattern.

The character output loop uses CHROUT (`$FFD2`) from the C64 KERNAL
jumptable. The terminator-zero convention matches C-string layout — note
that BASIC strings on the C64 are NOT zero-terminated, so this isn't a
BASIC-string-compatible buffer; it's our own convention.
