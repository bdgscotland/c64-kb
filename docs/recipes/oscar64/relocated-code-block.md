---
recipe: relocated-code-block
toolchain: oscar64
output_format: PRG
region: both
techniques: [relocated_code_block]
file_formats: [PRG]
uses_registers: [D011, D012, D020]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64: code stored at $2000, run at $C000 with a region's run address

## Synopsis

The Oscar64 form of
[kickassembler/relocated-code-block](../kickassembler/relocated-code-block.md).
A section holds a border-flash routine and its colour table. Its region
is stored at `$2000` in the PRG and linked for `$C000`, through the
seventh argument of `#pragma region`. `main` copies the 256-byte region
to `$C000`, wipes the stored copy, and calls `flash()`. The border steps
through seven colours, one per frame, and stays green; then `main`
writes 1 to `$02FF`. The label file lists the storage address, so the
monitor needs the labels rewritten before a break at `$C000` can use
them.

## Source

```c
// relocated-code-block.c - a routine stored at $2000, copied to $C000, run there
#include <c64/vic.h>
#include <string.h>

// The main program and its data below $2000, the block's 256 bytes at
// $2000, and BSS, heap and stack above it.
#pragma region(main, 0x0880, 0x2000, , , {code, data})

// rblock is stored at $2000 in the PRG but linked for $C000: the seventh
// argument is the run address, so every absolute address inside the
// section's code and data is a $C0xx address.
#pragma section(rcode, 0)
#pragma region(rblock, 0x2000, 0x2100, , , {rcode}, 0xc000)

#pragma region(upper, 0x2100, 0xa000, , , {bss, heap, stack})

#define BLOCK_LOAD ((char *)0x2000)
#define BLOCK_RUN  ((char *)0xc000)

#pragma code(rcode)
#pragma data(rcode)

// The colour table, read through an absolute LDA $C0xx,X.
const char colours[7] = {VCOL_RED, VCOL_YELLOW, VCOL_WHITE, VCOL_YELLOW, VCOL_RED, VCOL_BLACK, VCOL_GREEN};

// Wait for the next frame: raster line 0 once, then away from it.
__noinline void frame(void)
{
    while (vic.raster != 0 || (vic.ctrl1 & VIC_CTRL1_RST8)) ;
    while (vic.raster == 0) ;
}

// The entry. main calls it by name; the map puts it at $2000, run $C000.
__noinline void flash(void)
{
    for (char i = 0; i < sizeof(colours); i++)
    {
        vic.color_border = colours[i];
        frame();                     // absolute JSR $C0xx
    }
}

#pragma code(code)
#pragma data(data)

int main(void)
{
    memcpy(BLOCK_RUN, BLOCK_LOAD, 0x100);
    // Wipe the load image: code or data still addressed at $20xx would
    // now read zeros, so only the copy linked for $C000 can finish.
    memset(BLOCK_LOAD, 0, 0x100);
    flash();
    *(volatile char *)0x02ff = 1;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -g -o=relocated-code-block.prg relocated-code-block.c
```

The `.map` (Oscar64 1.32.271 local build):

```text
regions
0880 - 2000 : 089d, 001d, main
2000 - 2100 : 202c, 002c, rblock
2100 - 9000 : 0000, 0000, upper

objects
0880 - 089c : main, NATIVE_CODE:code
2000 - 2015 : flash, NATIVE_CODE:rcode
2015 - 201c : colours, DATA:rcode
201c - 202c : frame, NATIVE_CODE:rcode
```

The block is 44 bytes. The map and the `.lbl` give the storage
addresses (`al 2000 .flash`, `al 201c .frame`); the code inside uses the
run addresses. The `.asm` listing, left column storage address, operand
run address:

```text
2004 : bd 15 c0 LDA $c015,x
2007 : 8d 20 d0 STA $d020
200a : 20 1c c0 JSR $c01c
```

and `main` calls `JSR $c000`. `memcpy` and `memset` with a constant size
compiled to two inline loops, `LDA $2000,y / STA $c000,y` and
`STA $2000,y`.

## Expected output

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 6000000 -exitscreenshot relocated-code-block.png -autostart relocated-code-block.prg
```

The border is green: `(98, 213, 50)` in the PAL PNG
(`screenshots/relocated-code-block.png`), `(114, 189, 103)` in the NTSC
one (`screenshots/relocated-code-block-ntsc.png`). A `trace store 02ff`
logged `STA $02FF` at `$0897` with `A:01` on both models. Measured in
VICE x64sc 3.10.

**The monitor break at `$C000`, symbols loaded.** With the `.lbl` as
Oscar64 writes it, `ll` then `break .flash` set the checkpoint at
`C:$2000`, and it never fired: the code there was wiped and nothing
jumps to it. The labels in the region need the run offset, `$C000 -
$2000 = $A000`, added:

```bash
python3 -c "import sys; [print('al %04x %s' % (int(a,16) + (0xa000 if 0x2000 <= int(a,16) < 0x2100 else 0), n)) for _,a,n in (l.split() for l in open('relocated-code-block.lbl'))]" > run.lbl
```

`run.lbl` then has `al c000 .flash`, `al c015 .colours` and `al c01c
.frame`. The monitor file loads it (`ll "run.lbl"`, `break .flash`,
`command 1 "r"`, logged as in the KickAssembler recipe), and the log on
PAL:

```text
BREAK: 1  C:$c000  (Stop on exec)
#1 (Stop on  exec c000)  146/$092,  60/$3c
.C:c000  A2 00       LDX #$00       - A:00 X:F7 Y:00 SP:f2 ..-...ZC    2977314
  ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH
.;c000 00 f7 00 f2 2f 37 00100011 146 060    2977314
```

NTSC stopped at `$C000` on line 198, cycle 47. The run continued after
the stop and ended green on both models.

## Why this works

`#pragma region(name, start, end, flags, bank, {sections}, runaddr)`
places the region's bytes at `start` in the output and links them for
`runaddr`: the parser stores `runaddr - start` as the region's
relocation (`Parser.cpp`, the `region` pragma, read here), and
Oscar64's own `samples/memmap/tsr.c` uses it the same way for code that
runs at `$C003`. `#pragma section(rcode, 0)` declares the section and
`#pragma code(rcode)` / `#pragma data(rcode)` send the following
functions and initialised data to it, so the colour table moves with
the code that indexes it.

`main` is redefined to end at `$2000` and a third region takes BSS, heap
and stack above the block. Without the two lines the build still
succeeded, with no diagnostic, and the map showed the default `main`
region at `$0880`-`$9000` overlapping `rblock` (run here): nothing
stops the program's own code, BSS or heap from growing into `$2000`.
The copy size is the whole region, 256 bytes; the map gives the 44
bytes used.
