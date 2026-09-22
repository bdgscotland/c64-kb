---
recipe: headless-verify
toolchain: oscar64
output_format: PRG
region: both
techniques: []
file_formats: [PRG]
uses_registers: [D020]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# Oscar64 Headless Verify: a self-checking program a script can grade

## Synopsis

A C program that does a checkable computation and reports the verdict
three ways a harness can read without a human: a result code at `$02FF`,
the border colour (green for pass, red for fail), and a line of text. The
computation is a 16-bit fold of the first page of the KERNAL ROM
(`$E000` to `$E0FF`), compared against the value computed on the host
from the ROM image. Use it as the template for any Oscar64 test program
that must be graded by the exit screenshot or over the monitor; the
harness side is in `runtime/vice-reference.md`, section "Verifying a run
without a human". The KickAssembler version is
`recipes/kickassembler/headless-verify.md`.

## Source

```c
// headless-verify.c
// Folds the first page of the KERNAL ROM ($E000-$E0FF) into a 16-bit
// checksum, compares it with the value computed from the ROM image on
// the host, and reports the verdict three ways: a code at $02FF, the
// border colour, and a line of text.
#include <stdio.h>
#include <c64/vic.h>

#define EXPECTED   0xc96f        // fold of kernal-901227-03.bin bytes 0..255
#define FORCE_FAIL 0             // set to 1 to demonstrate the red case

#define CODE_PASS  0x01
#define CODE_FAIL  0x02

#define RESULT     (*(volatile char *)0x02ff)   // verdict byte read by the harness

int main(void)
{
    const volatile char *rom = (const volatile char *)0xe000;
    unsigned chk = 0;

    for (unsigned i = 0; i < 256; i++)
        chk = (chk ^ rom[i]) * 5 + 1;           // unsigned is 16-bit: wraps

    char code = (chk == (EXPECTED ^ FORCE_FAIL)) ? CODE_PASS : CODE_FAIL;

    RESULT = code;                              // the harness watches this store
    vic.color_border = (code == CODE_PASS) ? 5 : 2;   // green or red

    printf("RESULT %02X %s\n", code, code == CODE_PASS ? "PASS" : "FAIL");
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -n -o=headless-verify.prg headless-verify.c
```

Produces `headless-verify.prg`, 4,456 bytes (Oscar64 build 2026-05-19;
most of it is `printf`). `-n` writes `headless-verify.map`, which puts
`main` at `$0880`. `EXPECTED` comes from the host:

```bash
python3 -c "
rom = open('/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin', 'rb').read()
chk = 0
for v in rom[:256]:
    chk = ((chk ^ v) * 5 + 1) & 0xffff
print('%04X' % chk)"        # C96F
```

## Expected output

Border green. Text area still the power-on blue. Screen rows 5 to 9:

```
READY.
RUN
RESULT 01 PASS

READY.
```

Screenshots from the pinned run, 8,000,000 cycles: `screenshots/headless-verify.png`
(PAL) and `screenshots/headless-verify-ntsc.png` (NTSC). Measured on both:
`RESULT 01 PASS` on screen row 7, border pixel (2, 100) = (98, 213, 50) on
PAL and (114, 189, 103) on NTSC, which is index 5 in both palettes of
`runtime/vice-reference.md`. The picture is the same as the KickAssembler
recipe's, cell for cell.

The red case, `#define FORCE_FAIL 1`, was run on PAL and NTSC and not
pinned: the same screen with `RESULT 02 FAIL` on row 7 and the border at
(175, 60, 88) on PAL, (169, 71, 100) on NTSC, index 2. The text area does
not change colour. The binary-monitor harness stopped that build at
`$08C6` with `$02FF` holding `02`.

## Why this works

`RESULT` is a `volatile char` at a literal address, so the store is
emitted where it is written and not folded into the `printf` call; the
border write follows it. A store watchpoint on `$02FF` fires once the
byte is in memory (measured in VICE 3.10 on this build: the binary
monitor's stop event reported the PC as the instruction after the store
and the read gave `01`). Two stores reach `$02FF` in a run: the KERNAL
reset clears page 2 first (`STA $0200,Y` at `$FD56` with `A = 0`), so a
harness must ignore a value of `00` and wait for the next hit. That is
why the codes start at `01`: `00` means "never got here", a different
failure from `02`.

`unsigned` is 16 bits in Oscar64, so `(chk ^ rom[i]) * 5 + 1` wraps at
`$FFFF` without an explicit mask, matching the Python that produced
`EXPECTED`. `rom` is `volatile` so the compiler reads the ROM rather than
constant-folding an address it could otherwise treat as unknown memory.
`vic.color_border` is the `struct VIC` field for `$D020` in `c64/vic.h`.
`printf` goes out through `putchar`, which is a `jsr $ffd2` in Oscar64's
`stdio.c`, so the text appears where BASIC's cursor is and the run ends
at `READY.`.

Verified: compiled with Oscar64 (build 2026-05-19), run headless in VICE
x64sc 3.10 with the pinned command on PAL and NTSC; the screenshots were
decoded with the char ROM, not read by eye.
