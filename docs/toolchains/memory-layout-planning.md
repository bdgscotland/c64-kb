---
tool: memory-layout-planning
tool_kind: reference-catalog
maintainer: bdgscotland
license: BSD-3-Clause
home_url: https://github.com/bdgscotland/c64-kb
---

<!-- doc-type: toolchain-reference -->

# Whole-program memory layout planning

## Tool

This page is a planning catalogue, not a program. It lists the fixed
constraints that decide where a C64 program's parts can go, walks one
layout through KickAssembler, Oscar64 and cc65, and shows how to read each
tool's map output to confirm the layout landed. The per-tool pages
([kickassembler](kickassembler-reference.md), [oscar64](oscar64-reference.md),
[cc65](cc65-reference.md)) hold the full directive and flag reference; the
banking mechanics are in
[memory-banking](../techniques/memory-banking.md). Every address and map
quoted here was produced on this machine with KickAssembler 5.25, Oscar64
build 2026-05-19 and cc65 2.19 (`cl65` reports V2.18), and run in VICE
x64sc 3.10; the recipes that carry the layout are
[kickassembler/memory-layout](../recipes/kickassembler/memory-layout.md),
[oscar64/memory-layout](../recipes/oscar64/memory-layout.md) and
[cc65/memory-layout](../recipes/cc65/memory-layout.md). The cc65 build
needs `-C memory-layout.cfg`; the recipe gates pass a linker config the
page carries in a `cfg` fence. Each toolchain page also has a "Multi-file
projects" section (how a second source file joins the build, with the
failing forms provoked) and a "Reading the errors" table of provoked
messages.

**Targets:** 6510, VIC-II

## The constraints

Each row is a fixed fact about the machine or a firm convention. The
"decides" column is what it forces on a layout.

| Range | What | Decides | Source |
|---|---|---|---|
| `$0000`-`$00FF` | Zero page. BASIC and the KERNAL own most of it; `$FB`-`$FE` are the four bytes they leave free. | A compiler's own zero-page use is fixed by its runtime (cc65: 26 bytes at `$02`-`$1B`; Oscar64: `$F7`-`$FF` as the `zeropage` region in the map below). Do not hand-place variables on top of it. | [cc65](cc65-reference.md) "Linker configs"; Oscar64 `.map`, measured |
| `$0100`-`$01FF` | 6510 hardware stack. | Not usable for data while the program runs. | 6510, settled |
| `$0400`-`$07FF` | Default screen (1000 bytes at `$0400`-`$07E7`) and the eight sprite pointers at `$07F8`-`$07FF`. | The pointer block is always `screen + $3F8`; move the screen and the pointers move with it. Pointer value = sprite address / 64, inside the VIC bank. | [memory-banking](../techniques/memory-banking.md) screen_ram_relocation |
| `$0801` | BASIC program start. The `SYS` stub lives here so `RUN` starts the code. | Every PRG that autostarts from BASIC begins at `$0801`. The first byte after the stub is `$080D` under cc65 and `$080E` under KickAssembler; Oscar64 reserves `$0801`-`$0880` as its `startup` region. | the three maps below, measured |
| `$1000`-`$1FFF`, `$9000`-`$9FFF` | The character ROM shadow. The VIC reads ROM here in banks 0 and 2; the CPU reads RAM. | No charset, bitmap, screen or sprite data can live here in banks 0 or 2. The CPU is unaffected, which is why music sits at `$1000` by convention: it is RAM the VIC could never have used. | [memory-banking](../techniques/memory-banking.md) char_rom_under_vic |
| 16 KB VIC bank | Bank 0 `$0000`, 1 `$4000`, 2 `$8000`, 3 `$C000`, selected by CIA2 `$DD00` bits 0-1, inverted. | Screen, charset, bitmap and every sprite must be inside one bank. `$D018` addresses are bank-relative. | [memory-banking](../techniques/memory-banking.md) vic_bank_select |
| `$A000`-`$BFFF` | BASIC ROM, banked by `$01` bit 0. | RAM under it needs BASIC out (`$01` = `$36`); the KERNAL and I/O stay. | [memory-banking](../techniques/memory-banking.md) cpu_io_port_bank |
| `$D000`-`$DFFF` | I/O window: VIC, SID, colour RAM (`$D800`-`$DBFF`, 1000 nibbles), CIA1, CIA2. The character ROM is under it. | Code and data do not go here while I/O is mapped in. Copying the ROM font needs `$01` = `$33` with interrupts off, then `$37` back. | [memory-banking](../techniques/memory-banking.md) cpu_io_port_bank, char_rom_under_vic |
| `$E000`-`$FFFF` | KERNAL ROM, banked by `$01` bit 1. | RAM under it is usable only with a custom IRQ path. | [memory-banking](../techniques/memory-banking.md) ram_under_kernal |
| `$1000` | Music, by convention. | Most SID files relocate to `$1000` and expect `$1000`-`$1FFF` (rung 4, from the SID file corpus; not measured here). | convention |

Two consequences. In bank 0 the VIC can use `$0000`-`$0FFF` (minus zero
page and the stack) and `$2000`-`$3FFF` for graphics, and nothing else.
The only 4 KB the VIC cannot see, `$1000`-`$1FFF`, is where music and other
CPU-only data go.

## The worked layout

| Address | Contents | Size | Why here |
|---|---|---|---|
| `$0400` | Screen | 1 KB | Default; sprite pointers at `$07F8` |
| `$0801` | BASIC stub | 12-16 bytes | `RUN` needs it |
| `$1000` | Music | up to 4 KB | VIC-blind RAM, SID convention |
| `$2000` | Charset | 2 KB | 2 KB-aligned, in the VIC's bank 0, outside the shadow |
| `$2800` | Sprites | 64 bytes each | 64-byte aligned, pointer `$2800 / 64 = 160` |
| `$3000` | Code and data | to `$9FFF` | Above every fixed asset; below BASIC ROM |

`$D018` for this layout is `(($0400 >> 10) << 4) | (($2000 >> 10) & $0E)`
= `$18`. Everything the VIC touches is in bank 0, so `$DD00` stays at its
power-on value.

The three programs fill the charset at run time by copying the ROM font
into `$2000` and overwriting glyph 0, put one 64-byte sprite at `$2800`,
call a stub at `$1000` once per frame that increments a counter, and print
the addresses their own symbols carry. All three print the same six
addresses except `MUSIC` and `CODE` under cc65, explained below.

## KickAssembler

One `*=` block per range. `virtual` keeps the charset block out of the
assembler's own output; it is reserved, not written.

```asm
*=$0801 "BASIC stub"
    BasicUpstart2(start)

*=$1000 "Music"
music_play:
    inc music_frames
    rts
music_frames:
    .byte 0

*=$2000 "Charset" virtual
charset:
    .fill 2048, 0

*=$2800 "Sprites"
sprite0:
    .fill 64, $ff

*=$3000 "Code"
start:
    lda #$18
    sta $d018
    jmp *
```

Confirm with `-showmem`. The virtual block is marked `*`. The stub prints
as three blocks because `BasicUpstart2` opens `Basic` and `Basic End`
inside the named one. This is the map of the full recipe listing:

```
Memory Map
----------
Default-segment:
  $0801-$0800 BASIC stub
  $0801-$080d Basic
  $080e-$080d Basic End
  $1000-$100a Music
  *$2000-$27ff Charset
  $2800-$283f Sprites
  $3000-$313b Code
```

One thing the map does not say: a single PRG is contiguous, so the
assembler fills every gap between blocks with zero, including the
virtual one. The recipe's PRG is 10,557 bytes and loads `$0801`-`$313B`
(measured from the file's load address and length). `virtual` saves
nothing in the file when a non-virtual block follows it; it only stops
the assembler writing the block's own bytes. For a file that skips the
gaps, use `.segment` with separate outputs, described on the
[kickassembler](kickassembler-reference.md) page under "Memory layout".

## Oscar64

Oscar64 places objects into sections and sections into regions. Declare a
section, give it a region with a start and an exclusive end, and route
objects to it with `#pragma code`, `#pragma data` or `#pragma bss`.
Redefining the region named `main` replaces the default `$0880`-`$A000`
one; the `startup` region at `$0801`-`$0880` stays.

```c
#pragma section( music, 0 )
#pragma section( charset, 0, , , bss )
#pragma section( sprites, 0 )

#pragma region( music,   0x1000, 0x2000, , , { music } )
#pragma region( charset, 0x2000, 0x2800, , , { charset } )
#pragma region( sprites, 0x2800, 0x3000, , , { sprites } )
#pragma region( main,    0x3000, 0xa000, , , { code, data, bss, heap, stack } )

#pragma bss( music )
unsigned music_frames;
#pragma bss( bss )

#pragma code( music )
void music_play(void) { music_frames++; }
#pragma code( code )

#pragma bss( charset )
char charset[2048];
#pragma bss( bss )

#pragma data( sprites )
__export const char sprite0[64] = { /* ... */ };
#pragma data( data )
```

Three details, all measured on build 2026-05-19:

- An uninitialised variable is a bss object even under `#pragma data`.
  `music_frames` declared under `#pragma data( music )` landed at `$4287`
  in `main`'s bss; `#pragma bss( music )` put it at `$1009`, right after
  the stub.
- A section declared with the `bss` flag is not written to the PRG and
  not cleared at start-up (the Oscar64 README says so and the map lists it
  as `BSS`). The PRG still spans it, because the file is contiguous: the
  recipe's PRG is 14,984 bytes, `$0801`-`$4286`.
- `__export` keeps the sprite in the output even if nothing else refers
  to it; the linker drops unreferenced placed arrays otherwise (see
  "Pitfalls" on the [oscar64](oscar64-reference.md) page).

There is no flag for the map. Every build writes `<output>.map` next to
the `.prg`, along with `.asm`, `.int` and `.lbl` (measured: the plain
`oscar64 -tm=c64 -O2 -o=memory-layout.prg memory-layout.c` produced all
four). The `-n` in older notes means "pure native code", which is now the
default, and `-g` adds source references to the `.asm`; neither is a map
switch. The `regions` block of the recipe's map:

```
regions
1000 - 2000 : 100b, 000b, music
2000 - 2800 : 0000, 0800, charset
2800 - 3000 : 2840, 0040, sprites
3000 - 9000 : 4287, 1287, main
00f7 - 00ff : 0000, 0000, zeropage
0801 - 0880 : 0853, 0052, startup
```

Each line is `start - end : next free, bytes used, name`. `main` prints
as `3000 - 9000` although it was declared to `0xa000` because the 4 KB
stack is carved from the top (`9000 - 9fa5 : STACK, stack` in the
`sections` block). The `objects` block confirms the individual placements:

```
1000 - 1009 : music_play, NATIVE_CODE:music
1009 - 100b : music_frames, DATA:music
2000 - 2800 : charset, DATA:charset
2800 - 2840 : sprite0, DATA:sprites
3000 - 3161 : main, NATIVE_CODE:code
```

## cc65

cc65 places segments through the linker config, and the source names
segments through pragmas. Start from the stock `cfg/c64.cfg` (at
`/opt/homebrew/share/cc65/cfg/c64.cfg` here) and split its `MAIN` area
into fixed pieces. Each area that lands in the file needs `fill = yes`,
or the PRG has holes and loads wrongly.

```
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
```

The `FEATURES`, `SYMBOLS` and `CONDES` blocks are copied from the stock
file unchanged; the recipe page has the whole file. `STARTUP` cannot move:
the stub's `SYS 2061` targets `__HEADER_LAST__`, so the runtime entry
stays at `$080D` and only `CODE` moves to `$3000`.

In the source:

```c
#pragma code-name (push, "MUSIC")
void music_play(void) { ++music_frames; }
#pragma code-name (pop)

#pragma data-name (push, "MUSIC")
unsigned music_frames = 0;
#pragma data-name (pop)

#pragma bss-name (push, "CHARSET")
unsigned char charset[2048];
#pragma bss-name (pop)

#pragma rodata-name (push, "SPRITES")
const unsigned char sprite0[64] = { /* ... */ };
#pragma rodata-name (pop)
```

Build with `cl65 -t c64 -O -C memory-layout.cfg --mapfile memory-layout.map`.
The map's segment list:

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

Two things the segment list does not show. First, symbol addresses: the
map's "Exports list" only carried `_main` (`$308A`) for this program, so
use `-Ln file` for a VICE label file that lists every symbol:

```
al 001000 ._music_frames
al 001002 ._music_play
al 002000 ._charset
al 002800 ._sprite0
al 00308A ._main
```

Second, order inside a segment is the compiler's. `music_frames` was
emitted before `music_play` even though the function is defined first in
the source, so the stub is at `$1002`, not `$1000`; and `main` is at
`$308A` because `$8A` bytes of the same translation unit precede it in
`CODE`. If an address must be exact under cc65, give it a segment of its
own. The PRG is 13,105 bytes, `$0801`-`$3B2F`.

## Confirming the layout at run time

The map says where the linker put things; the machine says what the VIC
is using. The recipes print both: the symbol addresses, and the screen
base recomputed from CIA2 `$DD00` and `$D018`. When the two disagree the
`$D018` write is wrong, not the layout. A visibly altered glyph 0 and a
sprite on screen are the check that the charset and sprite addresses are
the ones the VIC fetches from; a wrong `$D018` nibble shows the ROM font
or garbage, and a wrong pointer shows a sprite made of code bytes.

## Pitfalls

- KickAssembler's default `.text` encoding is `screencode_mixed`, in
  which `"ABCDEF"` assembles to `$41`-`$46`, the graphics glyphs of the
  upper-case font. A hex-digit table for direct screen writes needs
  `.encoding "screencode_upper"` first (measured: the recipe's counter
  printed `00-♠` until the encoding line went in).
- cc65 maps ASCII upper case in string literals to shifted PETSCII
  (`$C1`-`$DA`), which the upper-case font shows as graphics, and `%X`
  does the same to `A`-`F`. Write lower-case source text and `%x`
  (measured: the labels and the `A` of `$308A` were graphics until the
  literals were lower-cased).
- A cc65 recipe that needs `-C` does not build under the repository's
  gates as they stand: `scripts/check-listings.ts` and
  `scripts/verify-recipes.ts` run `cl65 -t c64 -O -o out.prg src.c` with
  no way to add a config, and the stock config stops with
  `ld65: Error: Missing memory area assignment for segment 'MUSIC'`
  (measured). That is a harness gap, not a layout fault.
- Oscar64 drops an unreferenced placed array; `__export` it.
- Under any of the three, a charset that is not 2 KB-aligned or a sprite
  that is not 64-byte-aligned cannot be addressed: `$D018` and the sprite
  pointers only hold multiples, so the VIC fetches from the aligned
  address below the symbol. None of the tools checks this.

## See also

- [kickassembler-reference](kickassembler-reference.md), "Memory layout"
- [oscar64-reference](oscar64-reference.md), "Memory layout and banking"
- [cc65-reference](cc65-reference.md), "Linker configs"
- [memory-banking](../techniques/memory-banking.md)
- Recipes: [kickassembler/memory-layout](../recipes/kickassembler/memory-layout.md),
  [oscar64/memory-layout](../recipes/oscar64/memory-layout.md),
  [cc65/memory-layout](../recipes/cc65/memory-layout.md)
