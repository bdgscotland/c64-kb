---
recipe: cartridge-8k
toolchain: oscar64
output_format: CRT
region: both
techniques: []
file_formats: [CRT]
uses_registers: [D011, D016, D018, D020, D021]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 8 KB cartridge: `-tf=crt8`, no KERNAL set-up, writable state in BSS

## Synopsis

One `oscar64 -tf=crt8` line writes a generic 8 KB `.CRT` that
`x64sc -cartcrt` boots. Oscar64's crt8 start-up does not call the
KERNAL's set-up routines and does not copy initialised data to RAM. The
program therefore sets up the VIC-II itself, writes screen codes
straight to `$0400`, and shows what happens to an initialised global
(it stays in ROM and ignores a write) and to an uninitialised one (BSS,
in RAM). The border turns green when all four checks pass and the
verdict goes to `$02FF`. The cc65 counterpart, which does call the
KERNAL and copies `DATA`, is
[cc65 cartridge-8k](../cc65/cartridge-8k.md); the container fields are
in [cartconv-reference](../../toolchains/cartconv-reference.md).

## Source

```c
// cartridge-8k.c - build with -tf=crt8; oscar64 writes cartridge-8k.crt
#include <c64/vic.h>

// Initialised, writable: -tf=crt8 links it into the ROM at $8080 and up,
// and no start-up code copies it to RAM. A write reaches the RAM under
// the ROM; a read returns the ROM byte.
volatile char in_rom = 0x42;

// Uninitialised: BSS in the "main" region at $0900, zeroed by the
// start-up code. This is where a crt8 program's writable state goes.
volatile char in_ram;
char zeroed[16];

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)

static char * cursor;

// Screen codes straight into screen RAM: the KERNAL screen editor was
// never initialised, so there is no CHROUT to call.
static void put(const char * s)
{
    while (*s)
        *cursor++ = *s++;
}

static void hex(unsigned v, char digits)
{
    static const char dig[] = s"0123456789abcdef";
    for (char i = digits; i > 0; i--)
        cursor[i - 1] = dig[v & 15], v >>= 4;
    cursor += digits;
}

static void line(char row)
{
    cursor = SCREEN + 40 * row;
}

int main(void)
{
    // No KERNAL set-up ran: the VIC-II is as reset left it, display off.
    // Text mode, screen $0400, character ROM at $1000 in bank 0.
    vic.ctrl1 = VIC_CTRL1_DEN | VIC_CTRL1_RSEL | 3;
    vic.ctrl2 = VIC_CTRL2_CSEL;
    vic.memptr = 0x14;
    vic.color_back = VCOL_BLUE;
    vic.color_border = VCOL_BLUE;
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = ' ';
        COLOUR[i] = VCOL_LT_BLUE;
    }

    char rom_before = in_rom;
    in_rom = 0x99;
    char rom_after = in_rom;

    in_ram = 0x99;
    char ram_after = in_ram;

    char bss_ok = 1;
    for (char i = 0; i < 16; i++)
        if (zeroed[i]) bss_ok = 0;

    line(0);  put(s"oscar64 crt8 cartridge");
    line(2);  put(s"main at $");        hex((unsigned)&main, 4);
    line(3);  put(s"in rom at $");      hex((unsigned)&in_rom, 4);
    line(4);  put(s"in ram at $");      hex((unsigned)&in_ram, 4);
    line(5);  put(s"in rom before ");   hex(rom_before, 2);
              put(s" after ");          hex(rom_after, 2);
    line(6);  put(s"in ram after ");    hex(ram_after, 2);
    line(7);  put(s"bss zero ");        put(bss_ok ? s"yes" : s"no");

    // The addresses are printed, not tested: this Oscar64 build folds some
    // comparisons of a function's address with a constant (see the page).
    char ok = rom_before == 0x42 && rom_after == 0x42 && ram_after == 0x99 && bss_ok;
    *(volatile char *)0x02ff = ok;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -tf=crt8 -o=cartridge-8k.prg cartridge-8k.c
# writes cartridge-8k.crt (8,272 bytes: 80 + 8,192), .map, .asm, .lbl; no .prg
cartconv -c cartridge-8k.crt   # exit 0
cartconv -f cartridge-8k.crt   # Hardware ID: 0 (Generic C64 Cartridge), exrom 0 game 1, one CHIP at $8000, name OSCAR
```

`-o=` names the output; with `-tf=crt8` the extension is replaced by
`.crt`. The verifier builds it the same way through the `build` key in
`runs.json`. The `.map` (Oscar64 build 1.32.271 local, see CLAUDE.md):

```text
regions
00f7 - 00ff : 0000, 0000, zeropage
8000 - 8080 : 8053, 0053, startup
0900 - 3700 : 0000, 0013, main
8080 - a000 : 8321, 02a1, rom

objects
--:0900 - 0901 : in_ram, DATA:bss
--:0901 - 0911 : zeroed, DATA:bss
00:8000 - 8053 : startup, NATIVE_CODE:startup
00:8080 - 820b : main, NATIVE_CODE:code
```

`in_rom` is at `$82F9`, among the `rom` region's data objects. The
software stack is `$3700`-`$4700` and the heap `$0918`-`$3700`, both
in RAM. The ROM holds `$8000`-`$8320`, 801 bytes of the 8,192.

## Expected output

```bash
x64sc -default -warp +sound +autostart-delay-random -limitcycles 4000000 \
  -exitscreenshot cartridge-8k.png -cartcrt cartridge-8k.crt
```

Text decoded from the PNG against the character ROM with PIL, from row 0:

```text
OSCAR64 CRT8 CARTRIDGE

MAIN AT $8080
IN ROM AT $82F9
IN RAM AT $0900
IN ROM BEFORE 42 AFTER 42
IN RAM AFTER 99
BSS ZERO YES
```

The border is green: `(98, 213, 50)` on `(44, 61, 236)` in the PAL PNG
(`screenshots/cartridge-8k.png`), `(114, 189, 103)` on `(25, 73, 180)`
in the NTSC one (`screenshots/cartridge-8k-ntsc.png`, the same command
with `-model ntsc` after `-default`). Every row reads the same on both
models. Measured in VICE x64sc 3.10.

`IN ROM BEFORE 42 AFTER 42` is the trap: the store to `in_rom` compiled
to an `STA` at its ROM address and reached the RAM underneath, and the
read came back from the ROM
([ram_under_rom_traps](../../pitfalls/banking.md#ram_under_rom_traps--writes-go-to-ram-under-rom-reads-return-rom-bytes)).
`volatile` keeps the compiler from forwarding the stored value to the
read. The BSS variable took the write.

**Cold-start cost.** A `-moncommands` log (`trace exec 8009`, `trace
exec 8080`, `trace store 02ff`) gave these stopwatch values, identical
on PAL and NTSC for the first two:

| Point | PAL | NTSC |
|---|---|---|
| `LDA #$E7` at `$8009`, first cartridge instruction | 109 | 109 |
| `main` at `$8080` | 414 | 414 |
| `STA $02FF` at `$81F7`, `A:01` | 56,256 | 56,428 |

Vector to `main` takes 305 cycles: the BSS clear over 19 bytes, the
zero-page clear and the stack pointer. The cc65 cartridge takes
1,650,044 cycles on PAL for the same path, because it calls the
KERNAL's four set-up routines and `RAMTAS` alone is 1,593,289 of them.

## Why this works

The KERNAL reset routine at `$FCE2` starts `LDX #$FF / SEI / TXS / CLD /
JSR $FD02 / BNE / JMP ($8000)` (bytes `A2 FF 78 9A D8 20 02 FD D0 03 6C
00 80`, read from `kernal-901227-03.bin`): the stack and the interrupt
mask are set, then `$FD02` compares `$8004`-`$8008` with `CBM80` and,
on a match, the KERNAL jumps through `$8000`. Oscar64's crt8 header is
`09 80 09 80 C3 C2 CD 38 30` (read from the `.crt`), so both the
cold-start and the warm-start vector point at `$8009`. The start-up
code there (`include/crt.c`, the `OSCAR_TARGET_CRT8` branch, and the
`.asm` listing) writes `$E7` to `$01` and `$2F` to `$00`, clears BSS
and its zero page, sets the software stack pointer and calls `main`.
It never calls `IOINIT`, `RAMTAS`, `RESTOR` or `CINT`.

That has three consequences, all visible in this run:

- **The screen is off.** The VIC-II registers are as reset left them;
  with `$D011` at 0 the display is disabled and the whole frame is
  border colour. A first probe that wrote only `$D020` produced a
  screenshot of one colour, every pixel. `main`
  therefore sets `$D011`, `$D016` and `$D018` itself and clears
  screen and colour RAM.
- **There is no KERNAL output.** `printf` and `putchar` go through
  `CHROUT`, whose screen editor state `CINT` never set, so the program
  writes screen codes. The `s"..."` prefix makes screen codes; letters
  must be lower case in the source to get codes 1-26, since upper-case
  letters became `$41`-`$5A` (graphics characters in the upper-case
  set; the first build here showed them).
- **Initialised writable data stays in ROM.** The linker places it in
  the `rom` region with the code and nothing copies it out. Keep
  writable state uninitialised and set it in `main`, or copy it
  yourself.

The interrupt mask stays set: the KERNAL's `SEI` is never undone and
`CIA 1` was never started, so no IRQ arrives unless the program enables
one. To use KERNAL routines, call the four set-up routines first, as the
cc65 recipe does; `RAMTAS` clears `$0002`-`$03FF`, which includes the
zero page Oscar64's runtime uses, so it must run before the start-up
code sets the stack pointer. This recipe does not do that.

**A compiler fault met on the way.** The first version of `ok` also
tested `(unsigned)&main >= 0x8000`. With `main` at `$8080`, the
compiler emitted `LDA #$00` for that term and for the whole `ok`, so the
border came out red with every printed value correct. A probe with
eight comparisons of `&main` against constants, built with `-tf=crt8`,
emitted a real compare for some (`>= 0x8000` there, `> 0x7fff`) and a
constant 0 for others (`((unsigned)&main >> 8) >= 0x80`; `>= 0x8000`
inside a function where it was the only test, at `-O0`, `-O1` and
`-O2` alike). Run here with the local 1.32.271 build; upstream was not
checked. The listing prints the addresses and leaves them out of the
verdict.
