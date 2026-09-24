---
recipe: hello-world
toolchain: oscar64
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: []
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# Oscar64 Hello World

## Synopsis

Smallest possible Oscar64 program that prints `HELLO, WORLD!` to the C64
screen and exits to BASIC. Demonstrates the canonical Oscar64
build invocation and the implicit KERNAL-CHROUT-backed `printf`.

## Source

```c
// hello.c
#include <stdio.h>

int main(void) {
    printf("HELLO, WORLD!\n");
    return 0;
}
```

## Build

```bash
oscar64 -o=hello.prg -tf=prg hello.c
```

Produces `hello.prg` (the loadable program), `hello.map` (linker map),
`hello.asm` (generated assembly), `hello.lbl` (VICE symbol file, `al`
lines) and `hello.int` (the intermediate-code dump; an earlier version
of this page omitted it). Checked with Oscar64 1.32.271 (build
2026-05-19): `hello.prg` is 4,730 bytes.

## Expected output

Loading `hello.prg` into VICE or a real C64 prints:

```
HELLO, WORLD!

READY.
```

The `\n` in the string moves the cursor to the next line, and BASIC's
`READY.` message is itself preceded by a carriage return, so one blank
line separates the two (measured in VICE 3.10; an earlier version of this
page showed them on adjacent lines). In the shipped screenshot the text
lands on row 7, under the autostart's `READY.`/`RUN` lines, with the
second `READY.` on row 9.

The READY prompt appears because Oscar64's startup code finishes with a
plain `RTS` after `JSR main` (at `$0852` in the generated `hello.asm`),
which returns to BASIC's `SYS` handler; BASIC then runs off the end of
the one-line stub program and prints `READY.` in the ordinary way. An
earlier version of this page said the runtime "calls into the BASIC
warm-start routine"; it does not call anything, it returns.

## Why this works

Oscar64's `printf` is a real `printf`: it links a format-string
interpreter that emits via the KERNAL CHROUT routine at `$FFD2` (three
`JSR $FFD2` sites in the generated `hello.asm`). Do not assume it is
smaller than cc65's: an earlier version of this page said "unlike cc65,
you don't pay for a full stdio buffering layer", but the same source
built with `cl65 -t c64 -O` gives a 2,664-byte PRG against Oscar64's
4,730 bytes with the build line above (measured here; neither figure
says anything about speed, which was not measured).

The `-tf=prg` flag selects the .prg output target. The default load
address for `-tf=prg` is `$0801` (BASIC start), with a BASIC stub
`SYS 2061` automatically prepended so `LOAD"HELLO",8,1: RUN` works.
