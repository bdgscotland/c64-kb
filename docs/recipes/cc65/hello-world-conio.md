---
recipe: hello-world-conio
toolchain: cc65
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: []
uses_kernal: [CHROUT, PLOT]
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

The screen clears, then prints `HELLO, WORLD!` at the top-left (row 0,
columns 0-12). The screen is in the **upper/lower-case** character set,
not the power-on upper-case/graphics set: cc65's conio initialiser sends
PETSCII `$0E` through CHROUT before `main()` runs (the built PRG contains
`LDA #$0E ; JSR $FFD2`). That is why an upper-case C string comes out as
upper-case letters rather than graphics glyphs, and why the `ready.`
that BASIC prints on row 1 after `main()` returns appears in lower case.
Write the string in lower case and it prints in lower case. Measured on
VICE 3.10 (PAL) with cc65 V2.18; the earlier version of this page said
only "at the top-left" and did not mention the character-set switch.

## Why this works

`conio.h` is cc65's hardware-aware text-mode library. `clrscr()` and
`cputs()` compile down to KERNAL/direct-screen-RAM writes with no stdio
buffering: the built PRG calls the ROM clear-screen body at `$E544`
(`JSR $E544`, not a jump-table entry), the PLOT vector `$FFF0` to read
and set the cursor, and CHROUT `$FFD2` once, in the initialiser, for the
character-set switch described above; the characters themselves are
stored straight into screen RAM. The `-O` flag enables the optimizer.
For this listing it barely matters — 478 bytes with `-O` against 482
without, measured with cc65 V2.18 — because almost all of the PRG is
library and startup code; the earlier version of this page said the
unoptimised output is "markedly larger and slower", which is not true
of this program and was not measured for any other.

cc65's `printf` would also work here but pulls in the full format-string
interpreter and is significantly heavier than `cputs`: the same program
with `printf("HELLO, WORLD!")` in place of `cputs` builds to 2,663 bytes
against 478 (cc65 V2.18, `-O`, measured). For text-mode
utilities, `conio` is the cc65 idiom; for anything more complex,
consider whether Oscar64 is the better choice.
