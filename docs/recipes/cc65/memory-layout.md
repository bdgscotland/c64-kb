---
recipe: memory-layout
toolchain: cc65
output_format: PRG
region: both
techniques: [cpu_io_port_bank, char_rom_under_vic]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D012, D015, D018, D027, DD00]
uses_kernal: [CHROUT, PLOT]
---

<!-- doc-type: recipe -->

# cc65 memory layout: stub, music, charset, sprites, screen, code

## Synopsis

A cc65 linker config and the segment pragmas that go with it, for a fixed
layout: the BASIC stub at `$0801`, a "music" stub at `$1000` that
increments a counter once per frame, a 2 KB charset at `$2000` with glyph
0 replaced by a hollow box, one sprite at `$2800`, the screen left at
`$0400`, and `CODE` from `$3000`. The program prints the address each of
its own symbols carries, so the screen can be read against `--mapfile`.
The planning behind the addresses is on
[memory-layout-planning](../../toolchains/memory-layout-planning.md).

This recipe needs `-C memory-layout.cfg`. The repository's
`check:listings` and `verify:recipes` gates pass a linker configuration
when the page carries it in a fence tagged `cfg` (the one below), so the
gates build and run this page like any other recipe; an earlier version
of this page was held back because the gates built cc65 with
`cl65 -t c64 -O` and no config, which stops with
`ld65: Error: Missing memory area assignment for segment 'MUSIC'`
(measured with cc65 2.19).

## Source

```c
/* memory-layout.c - build with -C memory-layout.cfg */
#include <conio.h>
#include <string.h>
#include <6502.h>
#include <c64.h>

#define SCREEN ((unsigned char *)0x0400)
#define RASTER (*(volatile unsigned char *)0xD012)
#define CPU_PORT (*(volatile unsigned char *)0x01)

/* ---- $1000: "music" stub. Called once per frame, bumps a counter. */
extern unsigned music_frames;

#pragma code-name (push, "MUSIC")
void music_play(void)
{
    ++music_frames;
}
#pragma code-name (pop)

#pragma data-name (push, "MUSIC")
unsigned music_frames = 0;
#pragma data-name (pop)

/* ---- $2000: charset. Filled at run time from the character ROM,
   then glyph 0 (screen code 0, '@') is replaced. */
#pragma bss-name (push, "CHARSET")
unsigned char charset[2048];
#pragma bss-name (pop)

/* ---- $2800: one sprite. Pointer value = $2800 / 64 = 160. */
#pragma rodata-name (push, "SPRITES")
const unsigned char sprite0[64] = {
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00
};
#pragma rodata-name (pop)

/* ---- from here on: CODE/RODATA/DATA in MAIN, from $3000. */
static const unsigned char glyph0[8] = { 0xff, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0xff };
static const unsigned char hexdigits[16] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06     /* screen codes 0-9, A-F */
};

static void put_hex16(unsigned char *cell, unsigned v);

int main(void)
{
    unsigned char port;
    unsigned bank, screen;

    /* copy the uppercase ROM font ($D000-$D7FF) into RAM at $2000 */
    SEI();
    port = CPU_PORT;
    CPU_PORT = 0x33;            /* char ROM visible at $D000, I/O out */
    memcpy(charset, (const void *)0xD000, 2048);
    CPU_PORT = port;
    CLI();

    /* replace glyph 0 ('@') with a hollow box */
    memcpy(charset, glyph0, 8);

    /* screen $0400, charset $2000 */
    VIC.addr = ((0x0400 >> 10) << 4) | ((0x2000 >> 10) & 0x0e);

    /* sprite 0 from $2800, yellow, at (280, 180) */
    SCREEN[0x3f8] = 0x2800 / 64;
    VIC.spr0_color = COLOR_YELLOW;
    VIC.spr0_x = 280 & 0xff;
    VIC.spr_hi_x = 1;
    VIC.spr0_y = 180;
    VIC.spr_ena = 1;

    /* lower-case source text: cc65 maps ASCII upper case to shifted PETSCII,
       which the upper-case font shows as graphics; lower case becomes the
       upper-case glyphs. Same reason for %04x, not %04X. */
    /* what the VIC is actually showing, from CIA2 and $D018 */
    bank   = (unsigned)(3 - (CIA2.pra & 3)) << 14;
    screen = bank + ((unsigned)(VIC.addr >> 4) << 10);

    clrscr();
    cprintf("stub    $%04x\r\n", *(unsigned *)0x2B);   /* BASIC TXTTAB */
    cprintf("music   $%04x\r\n", (unsigned)music_play);
    cprintf("charset $%04x\r\n", (unsigned)charset);
    cprintf("sprites $%04x\r\n", (unsigned)sprite0);
    cprintf("screen  $%04x\r\n", screen);
    cprintf("code    $%04x\r\n", (unsigned)main);
    cprintf("frames  $\r\n");
    cprintf("@@@@@@@@\r\n");

    for (;;) {
        /* once per frame: leave line 200, wait for the wrap, call the stub */
        while (RASTER < 200) ;
        while (RASTER >= 200) ;
        music_play();
        put_hex16(SCREEN + 8 * 40 + 8, music_frames);
    }
    return 0;
}

static void put_hex16(unsigned char *cell, unsigned v)
{
    cell[0] = hexdigits[(v >> 12) & 15];
    cell[1] = hexdigits[(v >>  8) & 15];
    cell[2] = hexdigits[(v >>  4) & 15];
    cell[3] = hexdigits[ v        & 15];
}
```

The linker config, `memory-layout.cfg`, is the stock
`/opt/homebrew/share/cc65/cfg/c64.cfg` with `MAIN` split into fixed
areas. Every area that reaches the file carries `fill = yes` so the PRG
stays contiguous.

```cfg
# memory-layout.cfg - c64.cfg with four fixed areas carved out of MAIN.
FEATURES {
    STARTADDRESS: default = $0801;
}
SYMBOLS {
    __LOADADDR__:  type = import;
    __EXEHDR__:    type = import;
    __STACKSIZE__: type = weak, value = $0800; # 2k stack
    __HIMEM__:     type = weak, value = $D000;
}
MEMORY {
    ZP:       file = "", define = yes, start = $0002,           size = $001A;
    LOADADDR: file = %O,               start = %S - 2,          size = $0002;
    HEADER:   file = %O, define = yes, start = %S,              size = $000D;
    STARTUP:  file = %O, fill = yes,   start = __HEADER_LAST__, size = $1000 - __HEADER_LAST__;
    MUSIC:    file = %O, fill = yes,   start = $1000,           size = $1000;
    CHARSET:  file = %O, fill = yes,   start = $2000,           size = $0800;
    SPRITES:  file = %O, fill = yes,   start = $2800,           size = $0800;
    MAIN:     file = %O, define = yes, start = $3000,           size = __HIMEM__ - $3000;
    BSS:      file = "",               start = __ONCE_RUN__,    size = __HIMEM__ - __STACKSIZE__ - __ONCE_RUN__;
}
SEGMENTS {
    ZEROPAGE: load = ZP,       type = zp;
    LOADADDR: load = LOADADDR, type = ro;
    EXEHDR:   load = HEADER,   type = ro;
    STARTUP:  load = STARTUP,  type = ro;
    LOWCODE:  load = STARTUP,  type = ro,  optional = yes;
    MUSIC:    load = MUSIC,    type = rw;
    CHARSET:  load = CHARSET,  type = bss, define = yes;
    SPRITES:  load = SPRITES,  type = ro;
    CODE:     load = MAIN,     type = ro;
    RODATA:   load = MAIN,     type = ro;
    DATA:     load = MAIN,     type = rw;
    INIT:     load = MAIN,     type = rw;
    ONCE:     load = MAIN,     type = ro,  define   = yes;
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

## Build

```bash
cl65 -t c64 -O -C memory-layout.cfg --mapfile memory-layout.map -Ln memory-layout.lbl -o memory-layout.prg memory-layout.c
```

`--mapfile` writes the segment list (cc65 2.19, `cl65` reports V2.18):

```
Name                   Start     End    Size  Align
----------------------------------------------------
ZEROPAGE              000002  00001B  00001A  00001
LOADADDR              0007FF  000800  000002  00001
EXEHDR                000801  00080C  00000C  00001
STARTUP               00080D  00083F  000033  00001
MUSIC                 001000  00100A  00000B  00001
CHARSET               002000  0027FF  000800  00001
SPRITES               002800  00283F  000040  00001
CODE                  003000  003983  000984  00001
RODATA                003984  003AB9  000136  00001
DATA                  003ABA  003AED  000034  00001
INIT                  003AEE  003B09  00001C  00001
BSS                   003B0A  003B35  00002C  00001
ONCE                  003B0A  003B2F  000026  00001
```

The map's "Exports list" carried only `_main` (`$308A`) for this program,
so the per-symbol addresses come from the `-Ln` label file:

```
al 001000 ._music_frames
al 001002 ._music_play
al 002000 ._charset
al 002800 ._sprite0
al 00308A ._main
```

The PRG is 13,105 bytes and loads `$0801`-`$3B2F`.

## Expected output

Run with the pinned command (`-limitcycles 8000000`, PAL, and again with
`-model ntsc`); the pictures are
`screenshots/memory-layout.png` and `screenshots/memory-layout-ntsc.png`.
Measured with PIL on both:

- Rows 0-6 from column 0 read `STUB    $0801`, `MUSIC   $1002`,
  `CHARSET $2000`, `SPRITES $2800`, `SCREEN  $0400`, `CODE    $308A`,
  `FRAMES  $`. Each address equals the label-file entry above. `MUSIC` is
  `$1002`, not `$1000`, because cc65 emitted the two-byte counter before
  the function inside the `MUSIC` segment; `CODE` is `$308A` because
  `$8A` bytes of the same translation unit precede `main` in `CODE`. The
  segments themselves start at `$1000` and `$3000`, as the map shows.
- Row 7, columns 0-7: eight cells of the replaced glyph 0. Each 8x8 cell
  is a hollow box: all eight pixels of the top and bottom pixel rows in
  ink, the six middle rows ink only at the left and right edge, six
  background pixels between. On PAL the first cell is at PNG (32, 91), on
  NTSC at (32, 79).
- Row 8, columns 8-11: the frame counter in hex. At 8,000,000 cycles it
  read `00F8` on PAL and `0117` on NTSC (one run each; `verify:recipes`
  is what holds it fixed, with `+autostart-delay-random`).
- The sprite: a 24x21 block of 504 yellow pixels at PNG x 288-311, y
  165-185 on PAL (RGB 255,255,70) and y 153-173 on NTSC (RGB 255,248,141).
  That is sprite X 280 and Y 180: sprite X 24 lines up with text column
  0 at PNG x 32, so X 280 is PNG x 280 + 8 = 288; the top row of a
  sprite at Y 180 is on raster line 181, which is PNG y 181 - 16 = 165
  on PAL and 181 - 28 = 153 on NTSC. Measured on these PNGs (rung 1);
  [vice-reference](../../runtime/vice-reference.md) gives the text-row
  geometry only.
- Border (115,133,255) and background (44,61,236) on PAL; (98,145,251)
  and (25,73,180) on NTSC. The text colour was not measured.

## Why this works

ld65 writes each `MEMORY` area with `file = %O` to the output in the
order listed, so the areas from `HEADER` to `MAIN` must be contiguous and
filled, or the PRG would carry a hole that the loader cannot express.
`STARTUP` stays at `__HEADER_LAST__` because the stub's `SYS 2061` is
fixed; the `CODE`, `RODATA`, `DATA`, `INIT` and `ONCE` segments move to
`MAIN` at `$3000`. The `code-name`, `data-name`, `bss-name` and
`rodata-name` pragmas name the segment the next definitions go into;
`push`/`pop` restores the default afterwards. The compiler orders objects
within a segment in its own order, which is why the counter precedes the
stub.

`$01` = `$33` keeps BASIC and the KERNAL mapped but replaces I/O with the
character ROM, so `SEI()` guards the copy: the KERNAL's IRQ handler would
otherwise read CIA1 through the ROM. The port's previous value is saved
and restored rather than assumed, because the cc65 runtime may not leave
it at `$37`. After glyph 0 is overwritten, `VIC.addr` = `$18` points the
VIC at screen `$0400` and charset `$2000`.

The literals are lower case because cc65 translates ASCII upper case to
shifted PETSCII (`$C1`-`$DA`), which `conio` shows as graphics under the
upper-case font; lower-case ASCII becomes PETSCII `$41`-`$5A`, the
upper-case glyphs. `%x` rather than `%X` for the same reason: the first
build printed `$308` with the `A` as a graphic (measured). The line ends
are `\r\n`, the form the existing cc65 conio recipes use; `\n` alone was
not tried here. The `@` row is screen code 0, the replaced glyph.
