---
recipe: hello-world-conio
toolchain: cc65
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: []
uses_kernal: []
---

<!-- doc-type: recipe -->

# cc65 Hello World (conio)

## Synopsis

Smallest cc65 program that uses `conio.h` to print `HELLO, WORLD!` to
the C64 screen. `conio` is cc65's text-mode UI library and produces
tighter code than `printf` for character output.

## Source

```c
// hello.c
#include <conio.h>

int main(void) {
    clrscr();
    cputs("HELLO, WORLD!");
    return 0;
}
```

## Build

```bash
cl65 -O -t c64 -o hello.prg hello.c
```

Produces `hello.prg`.

## Expected output

The screen clears, then prints `HELLO, WORLD!` at the top-left.

## Why this works

`conio.h` is cc65's hardware-aware text-mode library. `clrscr()` and
`cputs()` compile down to KERNAL/direct-screen-RAM writes with no stdio
buffering. The `-O` flag enables the optimizer; without it, cc65's
output is markedly larger and slower.

cc65's `printf` would also work here but pulls in the full format-string
interpreter and is significantly heavier than `cputs`. For text-mode
utilities, `conio` is the cc65 idiom; for anything more complex,
consider whether Oscar64 is the better choice.
