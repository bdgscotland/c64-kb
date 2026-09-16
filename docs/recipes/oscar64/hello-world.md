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
`hello.asm` (generated assembly), `hello.lbl` (VICE symbol file).

## Expected output

Loading `hello.prg` into VICE or a real C64 prints:

```
HELLO, WORLD!
READY.
```

The READY prompt appears because Oscar64's runtime calls into the BASIC
warm-start routine when `main()` returns.

## Why this works

Oscar64's `printf` is a real `printf` — it links a compact format-string
interpreter that emits via the KERNAL CHROUT routine at `$FFD2`. Unlike
cc65, you don't pay for a full stdio buffering layer; the runtime is
designed for the 6502's call-overhead profile.

The `-tf=prg` flag selects the .prg output target. The default load
address for `-tf=prg` is `$0801` (BASIC start), with a BASIC stub
`SYS 2061` automatically prepended so `LOAD"HELLO",8,1: RUN` works.
