---
recipe: relocated-code-block
toolchain: cc65
output_format: PRG
region: both
techniques: [relocated_code_block]
file_formats: [PRG]
uses_registers: [D011, D012, D020]
uses_kernal: []
---

<!-- doc-type: recipe -->

# cc65: code stored at $2000, run at $C000 with a load/run segment

## Synopsis

The cc65 form of
[kickassembler/relocated-code-block](../kickassembler/relocated-code-block.md).
The linker configuration gives two segments a load address in the PRG at
`$2000` and a run address at `$C000`. `main` copies them with the
linker's own symbols, wipes the stored copy, and calls `flash()`. The
border steps through seven colours, one per frame, and stays green; then
`main` writes 1 to `$02FF`. The `-Ln` label file already carries the run
addresses, so `break ._flash` stops at `$C000`.

## Source

```c
/* relocated-code-block.c - build with -C relocated-code-block.cfg
   A routine stored at $2000, copied to $C000, run there. */
#include <c64.h>
#include <string.h>
#include <peekpoke.h>

/* ---- The block: code in segment RELOC, its table in RELOCRO. The linker
   configuration stores both at $2000 and links both for $C000. cc65
   writes a file's read-only data ahead of its code, so one segment for
   both would put the table at $C000. */
#pragma code-name (push, "RELOC")
#pragma rodata-name (push, "RELOCRO")

void flash(void);                  /* declared first: cc65 emits functions in declaration order */
static void frame(void);
extern const unsigned char colours[7];

void flash(void)
{
    unsigned char i;
    for (i = 0; i < sizeof colours; ++i) {
        VIC.bordercolor = colours[i];      /* LDA $C0xx,Y: absolute, relocated */
        frame();                           /* JSR $C0xx */
    }
}

/* Wait for the next frame: raster line 0 once, then away from it. */
static void frame(void)
{
    while (VIC.rasterline != 0 || (VIC.ctrl1 & 0x80)) ;
    while (VIC.rasterline == 0) ;
}

const unsigned char colours[7] = {
    COLOR_RED, COLOR_YELLOW, COLOR_WHITE, COLOR_YELLOW, COLOR_RED, COLOR_BLACK, COLOR_GREEN
};

#pragma rodata-name (pop)
#pragma code-name (pop)

/* Linker symbols: __RELOC_LOAD__ and __RELOC_RUN__ from the segment's
   define = yes, __HIRAM_START__ and __HIRAM_LAST__ from the memory
   area's. A C name gains one underscore, so _RELOC_LOAD__ here is
   __RELOC_LOAD__ to the linker. */
extern unsigned char _RELOC_LOAD__[], _RELOC_RUN__[], _HIRAM_START__[], _HIRAM_LAST__[];

int main(void)
{
    unsigned size = (unsigned)_HIRAM_LAST__ - (unsigned)_HIRAM_START__;   /* both segments */

    memcpy(_RELOC_RUN__, _RELOC_LOAD__, size);
    /* Wipe the load image: anything still addressed at $20xx now reads
       zeros, so only the copy linked for $C000 can finish. */
    memset(_RELOC_LOAD__, 0, size);
    flash();
    POKE(0x02FF, 1);
    for (;;) ;
    return 0;
}
```

The linker configuration, `relocated-code-block.cfg`: the stock
`c64.cfg` of cc65 2.19 with the changes listed after it.

```cfg
# relocated-code-block.cfg - the stock c64.cfg with MAIN filled to $2000,
# a 256-byte BLOCK stored at $2000, and segments RELOC and RELOCRO linked
# for $C000.
FEATURES {
    STARTADDRESS: default = $0801;
}
SYMBOLS {
    __LOADADDR__:  type = import;
    __EXEHDR__:    type = import;
    __STACKSIZE__: type = weak, value = $0400;   # 1 KB C stack, top at $2000
}
MEMORY {
    ZP:       file = "", define = yes, start = $0002,           size = $001A;
    LOADADDR: file = %O,               start = %S - 2,          size = $0002;
    HEADER:   file = %O, define = yes, start = %S,              size = $000D;
    # fill = yes pads the PRG to $2000, so BLOCK's bytes load at $2000
    MAIN:     file = %O, define = yes, start = __HEADER_LAST__, size = $2000 - __HEADER_LAST__, fill = yes;
    BLOCK:    file = %O,               start = $2000,           size = $0100;
    HIRAM:    file = "", define = yes, start = $C000,           size = $0100;
    BSS:      file = "",               start = __ONCE_RUN__,    size = $2000 - __STACKSIZE__ - __ONCE_RUN__;
}
SEGMENTS {
    ZEROPAGE: load = ZP,       type = zp;
    LOADADDR: load = LOADADDR, type = ro;
    EXEHDR:   load = HEADER,   type = ro;
    STARTUP:  load = MAIN,     type = ro;
    LOWCODE:  load = MAIN,     type = ro,  optional = yes;
    CODE:     load = MAIN,     type = ro;
    RODATA:   load = MAIN,     type = ro;
    DATA:     load = MAIN,     type = rw;
    INIT:     load = MAIN,     type = rw;
    ONCE:     load = MAIN,     type = ro,  define   = yes;
    RELOC:    load = BLOCK,    run = HIRAM, type = ro, define = yes;
    RELOCRO:  load = BLOCK,    run = HIRAM, type = ro;
    BSS:      load = BSS,      type = bss, define   = yes;
}
FEATURES {
    CONDES: type    = constructor,
            label   = __CONSTRUCTOR_TABLE__,
            count   = __CONSTRUCTOR_COUNT__,
            segment = ONCE;
    CONDES: type    = destructor,
            label   = __DESTRUCTOR_TABLE__,
            count   = __DESTRUCTOR_COUNT__,
            segment = RODATA;
    CONDES: type    = interruptor,
            label   = __INTERRUPTOR_TABLE__,
            count   = __INTERRUPTOR_COUNT__,
            segment = RODATA,
            import  = __CALLIRQ__;
}
```

What changed from the stock file: `MAIN` ends at `$2000` and is
filled, the `BLOCK` and `HIRAM` areas and the two `RELOC` segments are
new, `BSS` and the C stack end at `$2000` instead of `__HIMEM__`, and
the stack is 1 KB instead of 2 KB.

## Build

```bash
cl65 -t c64 -O -C relocated-code-block.cfg --mapfile relocated-code-block.map \
  -Ln relocated-code-block.lbl -o relocated-code-block.prg relocated-code-block.c
```

`--mapfile`, cc65 2.19:

```text
Name                   Start     End    Size  Align
----------------------------------------------------
STARTUP               00080D  00083F  000033  00001
CODE                  000840  0009B4  000175  00001
RELOC                 00C000  00C036  000037  00001
RELOCRO               00C037  00C03D  000007  00001
```

The map lists the two segments at their run addresses. The label file
has `al 002000 .__RELOC_LOAD__`, `al 00C000 .__RELOC_RUN__`, `al 00C000
._flash` and `al 00C037 ._colours`. The PRG is 6,207 bytes because
`MAIN` is padded to `$2000`. Its bytes at `$2000` begin `20 A2 08 A9 00
A8 91 02 C9 07 B0 16 B1 02 A8 B9 37 C0 8D 20 D0 20 25 C0`: a `JSR` to
`decsp1` at `$08A2` in `MAIN`, which stays put, then `LDA $C037,Y` for
the table and `JSR $C025` for `frame`.

The order inside the segment was set by the source, measured by
building with `-S`. With `frame` declared before `flash`, `frame` came
first and `._flash` was `$C012`. With the table and the code in one
segment, the table came first and `._flash` was `$C019`, even with the
table defined after the functions.

## Expected output

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 6000000 -exitscreenshot relocated-code-block.png -autostart relocated-code-block.prg
```

The border is green: `(98, 213, 50)` in the PAL PNG
(`screenshots/relocated-code-block.png`), `(114, 189, 103)` in the NTSC
one (`screenshots/relocated-code-block-ntsc.png`). A `trace store 02ff`
logged `STA $02FF` at `$0879` with `A:01` on both models. Measured in
VICE x64sc 3.10.

**The monitor break at `$C000`, symbols loaded.** `ll
"relocated-code-block.lbl"`, `break ._flash` and `command 1 "r"` in a
logged `-moncommands` file, as in the KickAssembler recipe. PAL:

```text
BREAK: 1  C:$c000  (Stop on exec)
#1 (Stop on  exec c000)   94/$05e,  11/$0b
.C:c000  20 A2 08    JSR .decsp1    - A:00 X:20 Y:00 SP:f2 N.-.....    2973989
  ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH
.;c000 00 20 00 f2 2f 36 10100000 094 011    2973989
```

NTSC stopped at `$C000` on line 146, cycle 54. At the stop the C stack
pointer `sp` (`$02`/`$03`) read `$1FFA`, just under the `$2000` the
configuration sets. The run continued and ended green on both models.

## Why this works

A segment with `load` and `run` in different memory areas is written
into the output at its load area and linked for its run area. `define =
yes` on the segment makes ld65 export `__RELOC_LOAD__`,
`__RELOC_RUN__` and `__RELOC_SIZE__`; on a memory area it exports
`__HIRAM_START__`, `__HIRAM_SIZE__` and `__HIRAM_LAST__`. The copy uses
the area's `LAST - START` because it covers both segments. The label
file lists all of them. The
[cartridge-8k](cartridge-8k.md) recipe's `DATA` segment is the same
mechanism with the library's `copydata` doing the copy.

`fill = yes` on `MAIN` is what puts the block at `$2000`. ld65 writes
memory areas that share a file one after the other. Without the fill the
build succeeded with no warning and the PRG was 607 bytes, not 6,207
(run here): the block's bytes followed the end of `MAIN` in the file,
while `__RELOC_LOAD__` still named `$2000`. The C stack starts at the
top of `MAIN`, which is now `$2000`, so `__STACKSIZE__` and `BSS` are
sized to stay under it.
