---
tool: oscar64
tool_kind: c-compiler
maintainer: drmortalwombat
license: GPL-3.0
home_url: https://github.com/drmortalwombat/oscar64
version_verified: "1.32.271"
---

<!-- doc-type: toolchain-reference -->

# Oscar64 — C/C++ Cross-Compiler for 6502

## Tool

Oscar64 is an optimizing C/C++ cross-compiler that runs on a modern host (Windows, macOS, or Linux) and produces 6502 machine code targeting Commodore and other classic systems. It is the primary toolchain for c64-kb recipes. The compiler supports C99 and a large subset of C++, including namespaces, templates, virtual functions, lambdas, and range-based for loops. Its native 6510 code is faster and smaller than cc65's; it scores 442 Dhrystone iterations per second on a stock C64 at -O3.

**Targets:** 6510

Oscar64 compiles the whole program at once: the entire source tree is compiled in one pass, the linker is integrated, and only reachable code lands in the output. Library headers bring in their own implementations via `#pragma compile("lib.c")` directives, so there is no separate link step and most projects need no makefile. The compiler has a second data stack separate from the 6502 hardware stack, static call-graph analysis that converts the dynamic stack to a static layout wherever possible, zero-page register extension, and integer range analysis that narrows many 16-bit operations to 8-bit operations.

Recipes and idioms in this knowledge base are written for Oscar64 first. The cc65 patterns that LLM training data suggests (POKE loops for sprites, manual IRQ vector swapping, raw $DC00 joystick reads) are wrong here. Use the Oscar64 header libraries instead.

## Quick reference

**Install (clone and build on Linux/macOS):**

```bash
git clone https://github.com/drmortalwombat/oscar64.git
cd oscar64
make -C make compiler        # builds the oscar64 binary
sudo make -C make install    # optional: installs to /usr/local/bin
```

A prebuilt Windows installer is on the GitHub releases page. On Windows, the compiler is installed to `%programfiles(x86)%\oscar64\bin\oscar64`.

**Minimal invocation:**

```bash
oscar64 -n hello.c
```

This compiles `hello.c` to `hello.prg` with native code generation (the current default). The `-n` flag is the default in recent releases; it is shown here for clarity.

**Common build command for a game or demo:**

```bash
oscar64 -n -O2 -tf=prg -o=game.prg main.c
```

The output name is `-o=file`, flag and name joined by `=`. The space form `-o game.prg`, which an earlier version of this page showed, is rejected (`error 3004: Invalid command line argument '-o'`, then `game.prg` is opened as a source file; verified on build 2026-05-19).

**Expected outputs** for a typical build:

| File | When generated |
|------|---------------|
| `game.prg` | Always — the runnable C64 program |
| `game.map` | Always — memory layout report |
| `game.asm` | Always — assembler listing |
| `game.lbl` | Always — VICE monitor label commands |
| `game.int` | Always — intermediate-code listing |
| `game.dbj` | With `-g` — full JSON debug info |
| `game.csz` | With `-gp` — static profile data |

## Build pipeline

**Targets:** 6510

Oscar64 takes one or more `.c` or `.cpp` source files and produces a runnable artifact plus debug support files. The format is selected with `-tf=`.

### .PRG — Program file (executable)

**Produced by:** oscar64, kickassembler, cc65

The default output format. A `.prg` file starts with a two-byte load address header followed by the program body. For the `c64` target the load address is `$0801`, where the BASIC stub lives. The BASIC stub contains a single SYS line that jumps to the compiled entry point. In the default native build the `startup` region is `$0801`–`$0880` and `main` is `$0880`–`$A000` (Compiler.cpp region table; the compiler sets native code generation by default and only `-bc` clears it). The `$0801`–`$0900` startup, `$0900`–`$0A00` bytecode and `$0A00`–`$A000` main layout quoted by the upstream manual (and by an earlier version of this sentence) is what `-bc` produces. When checking a `.map`, its `regions` line prints `main` as `0880 - 9000` because the linker has already carved the 4 KB `stack` section (`$9000`–`$A000`) off the top of the declared region; the sections list shows `stack 9000 - a000`. Loading the file in VICE and typing `RUN` (or using autostart) launches the program.

**Consumed by:** vice, c1541

### .CRT — Cartridge image

**Produced by:** oscar64

Cartridge images are selected with `-tf=crt` (EasyFlash), `-tf=crt8` (generic 8 KB), or `-tf=crt16` (generic 16 KB). The EasyFlash format places the first 16 KB bank into RAM at startup and leaves remaining banks accessible for banked data. The 8 KB and 16 KB generic formats write code and data into the `rom` region at `$8000`–`$A000` or `$8000`–`$C000` with an autostart header. BSS, stack, and heap go into the `main` region from `$0800` to `$8000`.

**Consumed by:** vice

### .MAP — Linker map file

**Produced by:** oscar64

A text report of all memory regions, sections, and objects placed by the linker, sorted first by address and then by size. For a program that is too large, the "objects by size" section shows which functions and globals take the most space. Written on every build.

### .ASM — Assembler listing

**Produced by:** oscar64

A listing of the generated bytecode and native 6502 assembly instructions. When `-g` is active, source file and line number annotations are interspersed. Use it to find the source of an address the VICE machine code monitor stopped at.

### .LBL — VICE label file

**Produced by:** oscar64

Contains `al <addr> .<name>` monitor commands for every static symbol. Load into VICE with:

```
(monitor) ll game.lbl
```

or pass on the VICE command line as `-moncommands game.lbl`. After loading, the monitor, disassembly, and watch windows show symbolic names instead of raw addresses.

**Consumed by:** vice

### .DBJ — JSON debug info

**Produced by:** oscar64

Generated only when `-g` is passed. A JSON file with four top-level sections: `memory` (complete label map), `variables` (global/static variables with types and addresses), `functions` (per-function local variables, line numbers, and address ranges), and `types` (all declared types). Used by the Modern VICE PDB Monitor project for source-level debugging. The `-n -g -O0` combination is the easiest to debug.

### .D64 — Commodore 1541 disk image

**Produced by:** oscar64

Created with the `-d64=output.d64` flag. The compiled `.prg` is placed as the first file in the directory. Additional resource files are added with `-f=file.bin` (raw) or `-fz=file.bin` (LZO-compressed). Disk overlays (code split across multiple `.prg` files in the image) are supported via the linker `#pragma overlay` mechanism.

**Consumed by:** vice, c1541

## CLI flags

The full invocation syntax is:

```
oscar64 {-i=path} [-o=output] [-rt=runtime.c] [-tf=format] [-tm=machine] [-e] [-n] [-dSYM[=val]] {source.c}
```

| Flag | Description |
|------|-------------|
| `-v` / `-v2` | Verbose / very verbose diagnostic output |
| `-i=path` | Add an include search path |
| `-ii=path` | Set the default include path |
| `-o=file` | Output file name (defaults to source basename) |
| `-rt=file` | Alternative runtime library, replaces `crt.c`; use empty for no runtime |
| `-e` | Execute the result in the integrated emulator |
| `-ep` | Execute and profile in the integrated emulator |
| `-bc` | Compile all functions to bytecode |
| `-n` | Compile all functions to native 6502 code (current default) |
| `-dSYM[=val]` | Define a preprocessor symbol (no `=` between `-d` and the name: `-dNOFLOAT`, `-dNUM_IRQS=4`; `-d=SYM`, which an earlier version of this row showed, silently defines nothing useful) |
| `-D NAME=VALUE` | GCC-compatible symbol define |
| `-O0` | Disable optimizations |
| `-O1` / `-O` | Default optimizations |
| `-O2` | Aggressive speed optimizations including auto-inline of small functions |
| `-O3` | Maximum speed optimization |
| `-Os` | Optimize for size |
| `-Oi` | Auto-inline small functions (subset of -O2/-O3) |
| `-Oa` | Optimize inline assembler (subset of -O2/-O3) |
| `-Oz` | Auto-place global variables in zero page (subset of -O3) |
| `-Op` | Fold constant parameters into called functions |
| `-Oo` | Outliner: extract repeated code sequences into shared functions |
| `-Ox` | Optimize pointer arithmetic to prevent array page crossing |
| `-g` | Generate source-level debug info; annotate `.asm` with source lines |
| `-gp` | Like `-g` plus static profile data in `.csz` file |
| `-tf=format` | Target format: `prg` (default), `crt`, `crt8`, `crt16`, `bin` |
| `-tm=machine` | Target machine (see Target machines section) |
| `-d64=file.d64` | Create a D64 disk image |
| `-f=file` | Add a raw file to the D64 image |
| `-fz=file` | Add an LZO-compressed file to the D64 image |
| `-fi=n` | Sector skip for data files in the D64 image |
| `-xz` | Extended zero page usage; no return-to-BASIC |
| `-cid=n` | Cartridge type ID for VICE |
| `-csub=n` | Cartridge sub-type |
| `-cname=str` | Cartridge name |
| `-pp` | Compile in C++ mode |
| `-strict` | Strict ANSI C parsing (no C++ extensions) |
| `-psci` | PETSCII encoding for all strings without explicit prefix |
| `-rmp` | Generate `.error.map` and `.error.asm` when the linker fails |

**Runtime library defines** (passed with `-d`):

| Define | Effect |
|--------|--------|
| `NOLONG` | Exclude `long` support from `printf` |
| `NOFLOAT` | Exclude `float` support from `printf` |
| `HEAPCHECK` | Validate heap alloc/free; jam on error |
| `NOBSSCLEAR` | Skip clearing the BSS segment at startup |
| `NOZPCLEAR` | Skip clearing the zero-page BSS at startup |

These are the spellings `crt.c` tests (`#ifndef NOBSSCLEAR`, line 238; `#ifndef NOZPCLEAR`, line 262). An earlier version of this table gave `NOBSSCLR` and `NOZPCLR`; those compile cleanly and change nothing.

## Target machines

The `-tm=` flag selects the target. The default is `c64`.

| Machine | Memory range | Notes |
|---------|-------------|-------|
| `c64` | `$0800`–`$A000` | Stock Commodore 64, default target |
| `c128` | `$1C00`–`$FC00` | Commodore C128 full range |
| `c128b` | `$1C00`–`$4000` | C128 first 16 KB only |
| `c128e` | `$1C00`–`$C000` | C128 first 48 KB only |
| `plus4` | `$1000`–`$FC00` | Commodore PLUS/4 |
| `vic20` | `$1000`–`$1E00` | VIC-20, no expansion |
| `vic20+3` | `$0400`–`$1E00` | VIC-20, 3 KB expansion |
| `vic20+8` | `$1200`–`$4000` | VIC-20, 8 KB expansion |
| `vic20+16` | `$1200`–`$6000` | VIC-20, 16 KB expansion |
| `vic20+24` | `$1200`–`$8000` | VIC-20, 24 KB expansion |
| `pet` | `$0400`–`$2000` | PET 8 KB |
| `pet16` | `$0400`–`$4000` | PET 16 KB |
| `pet32` | `$0400`–`$8000` | PET 32 KB |
| `nes` | — | NES NROM 32 KB, no mirror |
| `nes_nrom_h` | — | NES NROM horizontal mirror |
| `nes_nrom_v` | — | NES NROM vertical mirror |
| `nes_mmc1` | — | NES MMC1 256 KB PRG, 128 KB CHR |
| `nes_mmc3` | — | NES MMC3 512 KB PRG, 256 KB CHR |
| `atari` | `$2000`–`$BC00` | Atari 8-bit |
| `x16` | `$0800`–`$9F00` | Commander X16 |
| `mega65` | `$2000`–`$C000` | Mega 65 |

**c64-kb scope note:** c64-kb covers stock C64 PAL and NTSC only. Recipes and idioms in this KB target `c64` exclusively. The other targets are listed for reference; they are out of scope for KB content.

## C extensions and language features

Oscar64 extends standard C/C++ with the following features for 6502 code.

### Pragmas

`#pragma warning(disable: 2000,2001)` suppresses specific warning codes. `#pragma message("text")` prints a message at compile time. `#pragma native(FuncName)` marks a function for native code generation even in bytecode mode. `#pragma optimize(option,...)` sets per-function optimizer options; valid options include `push`, `pop`, `asm`, `noasm`, `size`, `speed`, `noinline`, `inline`, `autoinline`, `maxinline`, `constparams`, `noconstparams`, `outline`, `nooutline`, and integer levels `0`–`3`.

Loop unrolling is controlled with `#pragma unroll(n)` or `#pragma unroll(full)` applied to the immediately following loop. A special `#pragma unroll(page)` mode reorganizes loop iterations into page-aligned chunks, so the 8-bit index registers cover 256-byte strips; this fills the 1000-byte screen RAM without 16-bit indexing.

Placement pragmas control the linker: `#pragma region(name, start, end, flags, bank, {sections})` defines a physical memory region; `#pragma section(name, 0)` creates a logical section; `#pragma data(section)`, `#pragma code(section)`, and `#pragma bss(section)` redirect subsequent globals/functions into non-default sections. `#pragma align(symbol, power_of_two)` aligns a variable or function to a boundary. `#pragma stacksize(n)` and `#pragma heapsize(n)` set the reserved sizes for those sections.

### `__assume(cond)`

Gives the optimizer facts it cannot deduce from the source. Common uses:

- `__assume(false)` in a switch default marks it as unreachable.
- `__assume(y < 25)` before a screen-index expression lets the compiler use 8-bit arithmetic for the `40 * y` multiply.
- `__assume(p != nullptr)` allows the compiler to omit null checks.

From `samples/games/lander.c`, which uses `__assume(y < 25)` before every screen access to prevent unnecessary 16-bit promotion.

### `__striped`

The 6502 has no multiply instruction and no indirect-plus-offset addressing mode. Accessing element `i` of a `struct S array[N]` requires multiplying `i` by `sizeof(S)`, which is slow. The `__striped` storage qualifier reorders the array so all bytes of field `x` are contiguous, followed by all bytes of field `y`, and so on. This layout, structure of arrays (SoA), allows direct index-register access:

```c
__striped struct Particle { int px, py; char color; } particles[64];
// particles[0].px, particles[1].px, ..., particles[63].px are contiguous
// compiler uses absolute+Y indexing, no multiply needed
```

The `auto` keyword from C++ enables typed pointers into striped arrays: `auto p = particles + i;` followed by `p->px` generates correct striped addressing. It works best when the array has no more than 256 elements.

### `__zeropage`

```c
__zeropage int counter;
```

Places a global variable into the zero-page BSS region. On the `c64` target that region is by default only `$F7`–`$FF` (nine bytes; measured in the `.map` of build 2026-05-19, and set in Compiler.cpp's region table), so a handful of `__zeropage` variables exhausts it. `-xz` widens it to `$80`–`$FF` at the cost of no return to BASIC. The upstream manual's phrase "usually 0x80 to 0xff" (which an earlier version of this sentence repeated) describes the `-xz` layout, not the default. Zero-page addressing saves one byte per instruction and is faster on the 6502. The default region sits in the KERNAL's RS-232 pointers (`$F7`–`$FA`) and the four free bytes `$FB`–`$FE`, so it is safe with the ROMs mapped; widening the region into BASIC's (`$03`–`$8F`) or the KERNAL's (`$90`–`$F6`) workspace is what collides. Zero-page globals are zero-cleared by the startup code (crt.c, `ZeroStart`..`ZeroEnd`) like the ordinary BSS, unless built with `-dNOZPCLEAR`; an earlier version of this sentence said they were not initialised. An initializer on a `__zeropage` global is not honoured in memory: the storage is emitted as zero bytes and cleared at startup (the optimiser may constant-fold reads of a never-written initialised variable, which can mask this), so assign non-zero values in code.

### `__native` and `__noinline`

`__native void func(...)` forces native code generation for a single function regardless of whether `-bc` is active globally. `__noinline` prevents the optimizer from inlining the function even at `-O2`/`-O3`. `__forceinline` does the opposite: forces inlining even without the `inline` keyword.

### `__interrupt` and `__hwinterrupt`

```c
__hwinterrupt void raster_irq(void) {
    vic.color_border++;
    vic.intr_ctrl <<= 1;
}
```

`__interrupt` saves and restores all zero-page registers used by the function on entry and exit. `__hwinterrupt` additionally saves and restores A, X and Y (the generated prologue is `PHA / TXA / PHA / TYA / PHA`, the epilogue `PLA / TAY / PLA / TAX / PLA`) and exits with `RTI` instead of `RTS`; the processor status is not saved by generated code, because the 6510 pushes it on interrupt entry and `RTI` restores it (an earlier version of this sentence listed it among the saved registers). Use `__hwinterrupt` for the top-level interrupt handler installed at `$FFFE`/`$FFFF`. Never read volatile hardware registers in a function called from both interrupt and non-interrupt context without `__interrupt` protection: the optimizer may cache the register value across the IRQ boundary.

### `#embed`

Imports a binary file into an array initializer:

```c
byte spritedata[] = {
#embed "../resources/sprites.bin"
};
```

`#embed` is a preprocessor directive and consumes the rest of its source line, so it must stand alone on its own line inside the initializer braces and the closing `};` must go on the following line; the one-line form `= { #embed "file" };`, which an earlier version of this page used in every example, loses the closing brace and fails with error 3006 / 3008 (verified with Oscar64 build 2026-05-19).

An optional limit and offset select a slice: `#embed 4096 128 "data.bin"` imports 4096 bytes starting at offset 128. The data can be compressed at compile time:

```c
char charset[] = {
#embed 2048 0 lzo "../resources/charset.bin"
};
// runtime: oscar_expand_lzo(CharsetDest, charset);
```

Supported compression methods: `lzo` (LZ-based) and `rle` (run-length). The `word` specifier imports 16-bit words instead of bytes.

`#embed` also understands structured asset formats. `#embed ctm_chars "tiles.ctm"` extracts character data from a CharPad `.ctm` version 8 file; `#embed spd_sprites "sprites.spd"` extracts sprite data from a SpritePad `.spd` version 5 file. Tile variants (`ctm_tiles8`, `ctm_tiles16`, `ctm_map8`, `ctm_map16`) and attribute channels (`ctm_attr1`, `ctm_attr2`) are also supported.

### Console I/O and PETSCII

The C64 uses PETSCII rather than ASCII, and `CR` (13) as the line terminator instead of `LF` (10). Oscar64 handles translation via `iocharmap(IOCHM_PETSCII_2)` (switch to lowercase font and translate all subsequent I/O) or PETSCII string literals with the `p` prefix (`printf(p"Hello\n")`). Screen-code literals use the `s` or `S` prefix. The `-psci` compiler flag makes PETSCII the default encoding for all unadorned string literals. Per-character mapping is set with `#pragma charmap(index, code [, count])`; both are integer character codes (a `'a'` literal is refused with error 3031); `count` maps a run.

### Preprocessor extensions

Oscar64 adds three preprocessor directives beyond standard C:

```c
#assign ry 0          // assign a numeric value to a macro
#repeat               // begin a preprocessor loop
  ...
#assign ry ry + 1
#until ry == 25       // end loop when condition is true
```

A shorthand for single-line expansion: `#for(i, COUNT) text_with_i` replicates `text_with_i` `COUNT` times with `i` substituted. They generate unrolled or table-driven code at compile time, with no runtime cost.

## Memory layout and banking

The whole-program view (the constraints, one worked layout in all three toolchains, and confirming it from the map file) is `memory-layout-planning.md`, with the recipe `../recipes/oscar64/memory-layout.md`.

Oscar64's linker works with three levels: regions (physical memory areas), sections (logical groupings), and objects (functions and data items). The default layout for `c64`/`-tf=prg` on build 2026-05-19 with the default native code generation is:

```
$0801–$0880  startup   — BASIC stub and crt entry
$0880–$A000  main      — code, data, bss, heap, stack (the 4 KB stack is carved from the top, so the .map prints the region as 0880 - 9000 with stack at 9000 - A000)
```

There is no bytecode region and code begins at `$0880`. The vendor manual's `$0801–$0900 startup / $0900–$0A00 bytecode / $0A00–$A000 main` figures, which an earlier version of this table repeated, describe the layout selected when the bytecode interpreter is in use (`-bc`, or any non-native function); building the same file with `-bc` reproduces them exactly. The `#pragma region( main, 0x0a00, ... )` examples below still work in a native build, but starting at `0x0a00` leaves `$0880`–`$0A00` unused; use `0x0880` as the lower bound if you want it back. Verify against your own `.map`, since the split depends on the codegen mode.

To use memory up to `$D000` (displacing BASIC ROM but keeping I/O and KERNAL), include `<c64/memmap.h>` and add:

```c
#pragma region( main, 0x0a00, 0xd000, , , {code, data, bss, heap, stack} )
int main(void) { mmap_set(MMAP_NO_BASIC); ... }
```

To place a character set at a fixed address while splitting code around it:

```c
#pragma region( lower, 0x0a00, 0x2000, , , {code, data} )
#pragma section( charset, 0 )
#pragma region( charset, 0x2000, 0x2800, , , {charset} )
#pragma region( upper, 0x2800, 0xa000, , , {code, data, bss, heap, stack} )

#pragma data(charset)
char MyCharset[2048] = {
#embed "../resources/charset.bin"
};
#pragma data(data)
```

On the C64 target the stack defaults to 4 KB and the heap to a 1 KB minimum; the linker then grows the heap to fill all free space between the end of bss and the start of the stack (an earlier version of this sentence gave heap 4 KB, stack 1 KB; the `.map` shows `stack 9000 - a000` and the heap filling everything below it). `#pragma stacksize(n)` sets the stack reservation exactly; `#pragma heapsize(n)` sets the heap's minimum, and the linker reports "Cannot place heap section" if that minimum does not fit. Other targets use smaller defaults (512/512 on VIC-20 and 8 KB PET, 1 KB/1 KB on X16 and 16 KB+ VIC-20/PET, 256/256 on NES). Override with:

```c
#pragma stacksize(4096)
#pragma heapsize(8192)
```

Setting `heapsize` to zero eliminates the heap section entirely for programs that do not use `malloc`.

**Cartridge banking** uses up to 64 banks. Each bank gets its own section and region:

```c
#pragma section( bcode1, 0 )
#pragma region( bank1, 0x8000, 0xc000, , 1, { bcode1 } )
```

The `__bankof(symbol)` operator returns the bank ID of any function or constant placed in ROM. `__bankof(0)` returns the current bank. The `easyflash.h` header provides the `EFlashCall<fn>` template wrapper that switches banks before and after a call, and the `EF_CALL(fn)` macro that wraps it.

**Overlays** on D64 images work by associating a linker bank with a named overlay file:

```c
#pragma overlay( ovl1, 1 )
// at runtime:
krnio_setnam(P"OVL1");
krnio_load(1, 8, 1);
```

The overlay file is stored as a `.prg` entry in the D64 directory. Use `oscar_expand_lzo` from `oscar.h` to decompress inlays at runtime.

## Multi-file projects

There are no object files and no separate link step. Every source file is
compiled in one run and the linker inside the compiler keeps only what is
reachable from `main`. The manual (`oscar64.md`, "Using libraries"): "Source files are added to the build with the help of a
pragma: `#pragma compile("stdio.c")`". A second unit reaches the build in
one of two ways, measured on build 2026-05-19 with the three files below;
both ways produced a byte-identical 140-byte `out.prg`, which turned the
border and screen green in VICE x64sc 3.10.

**The header pulls in its own `.c`.** This is how every shipped library
works: `include/c64/vic.h` ends with `#pragma compile("vic.c")`,
`include/c64/sprites.h` with `#pragma compile("sprites.c")`, and the file
named is found next to the header, not in the current directory (with `-v`
the build prints `Compiling ".../include/c64/vic.c"` from any working
directory). Do the same for your own module:

```text
/* border.h */
#ifndef BORDER_H
#define BORDER_H
extern char border_calls;
void border_set(char colour);
#pragma compile("border.c")
#endif
```

```text
/* border.c */
#include "border.h"
#include <c64/vic.h>
char border_calls;
void border_set(char colour)
{
    vic.color_border = colour;
    vic.color_back = colour;
    border_calls++;
}
```

```text
/* main.c */
#include "border.h"
int main(void)
{
    border_set(5);
    for (;;) ;
    return border_calls;
}
```

```
oscar64 -tm=c64 -O2 -o=out.prg main.c
```

**Or name every unit on the command line.** The manual's "A list of source
files can be provided" is literal: `oscar64 -tm=c64 -O2 -o=out.prg main.c
border.c` builds the same program with the pragma line deleted from
`border.h`. Use this when a module must not know it is a module (a file
shared with another compiler), or to swap implementations per build. Prefer the
header form: a unit that is only reachable
through the command line is silently missing from any build that forgets
it, which fails like this:

```text
border.h(5, 6) : error 3022: Calling undefined function 'border_set(u8)->void'
border.h(5, 6) : error 3022: Calling undefined function 'border_set(u8)->void'
main.c(5, 5) : info 1003: Called from here
border.h(5, 6) : error 3022: Calling undefined function 'border_set(u8)->void'
```

That is `oscar64 -tm=c64 -O2 -o=out.prg main.c` with the files exactly as
shown above, the `#pragma compile` line deleted from the header and
`border.c` not on the command line. The positions are the declaration on
line 5 of `border.h` and the call on line 5 of `main.c`. The compiler exits
20 and writes no PRG.

**`extern` across units** works as in any C: declare in the header, define
once in the `.c`; `border_calls` above is defined in `border.c`, written
there and readable from `main.c`. Two things differ from a conventional linker. A `#define` in
one unit does not reach another, so a library table size such as `NUM_IRQS`
has to be passed as `-dNUM_IRQS=17` on the command line (see Pitfalls). And
an `extern` variable that is never defined anywhere is not an error: the
build exits 0 and the linker allocates it in `bss` (measured;
`error-sources/oscar64/undefined-extern-var.c` builds, and its `.map` shows
`088b - 088c : missing_var, DATA:bss`). Only an undefined function is
refused.

**What the build reports.** `-n` selects native code and is already the
default (see CLI flags), so it shows nothing new. `-v` is the flag that
shows the units: it prints one `Compiling "..."` line per source file and one
`Including "..."` line per header, in the order the pragmas and includes
pulled them in, so a missing unit is visible as a missing line. The `.map`
written next to the PRG lists sections, regions and objects. Objects are
functions and variables, not files: after this build its `objects` block has
`main` (`0880 - 088a : main, NATIVE_CODE:code`), the startup code and the
section markers, and neither `border_set` nor `border_calls`: at `-O2` the
call was inlined into `main`, and because nothing after the `for (;;)` can
read `border_calls`, the increment and the variable were removed with it
(`bss` is empty, `BSSStart` and `BSSEnd` both at `088b`). A variant of
`main.c` that spun on `while (border_calls) ;` kept it, at
`0899 - 089a : border_calls, DATA:bss`. A function or variable you expect
to see and do not is usually inlined, or unreferenced and dropped (see
Pitfalls, "Data nobody references is dropped"), not missing from the build.

## Header library overview

Oscar64 ships C64-specific headers in `include/c64/`. Including one adds its `.c` implementation to the build via `#pragma compile`; there is no makefile or library link step.

Full per-header documentation: [oscar64-headers-reference.md](oscar64-headers-reference.md)

Headers in `include/c64/`:

- `types.h` — `byte`, `word`, `dword`, `sbyte` typedefs
- `vic.h` — VIC-II struct, color enum, bank/mode helpers, raster wait functions
- `sid.h` — SID struct, note macros, frequency scale constants
- `cia.h` — CIA1/CIA2 struct, `cia_init()` to disable timer interrupts
- `memmap.h` — `mmap_set()`, `mmap_trampoline()`, memory map constants
- `rasterirq.h` — Raster IRQ system: `rirq_init`, `rirq_build`, `rirq_set`, `rirq_sort`
- `sprites.h` — Hardware sprite control (`spr_*`) and 16-sprite multiplexer (`vspr_*`)
- `joystick.h` — `joy_poll()`, `joyx[]`, `joyy[]`, `joyb[]` poll results
- `keyboard.h` — `keyb_poll()`, scan-code enum, `key_pressed()`
- `charwin.h` — Character-mode windowed text rendering (`cwin_*`)
- `mouse.h` — `mouse_poll()`, `mouse_dx/dy`, `mouse_lb/rb`
- `kernalio.h` — KERNAL file I/O wrappers (`krnio_open`, `krnio_read`, `krnio_write`, etc.)
- `iecbus.h` — Low-level IEC serial bus access
- `easyflash.h` — EasyFlash bank register, `EFlashCall<>` template
- `reu.h` — RAM Expansion Unit struct and DMA helpers (`reu_store`, `reu_load`)
- `asm6502.h` — Runtime 6502 code emitter (generates machine instructions into a buffer)

## Debugging


Reaching the monitor prompt headless, the register line, breakpoints, watchpoints and measuring cycles between two points are in `../runtime/vice-reference.md`, "Text monitor for debugging".
Oscar64 produces two debug-support files on every build. The `.lbl` file contains `al` commands for the VICE monitor; loading it with `ll game.lbl` or `-moncommands game.lbl` makes the disassembler show symbolic names. The `.asm` file is the annotated assembler listing; with `-g`, each native instruction is preceded by the source file and line number that generated it.

For deeper source-level debugging, compile with `-n -g -O0`:

```bash
oscar64 -n -g -O0 -o=game.prg main.c
```

This produces a `.dbj` JSON file alongside the `.lbl`. The Modern VICE PDB Monitor (https://github.com/MihaMarkic/modern-vice-pdb-monitor) consumes `.dbj` for breakpoints, variable inspection, and step-through at the C source level.

The `-gp` variant adds a `.csz` file with every source line annotated with its byte count in the output, which shows where the code size goes.

**vice-mcp integration:** The [vice-mcp](../runtime/vice-mcp-reference.md) bridge exposes VICE's binary monitor over MCP. After loading labels, an agent can read memory by symbol name, set breakpoints at C function boundaries, and capture raster screenshots while the program runs; Oscar64's own outputs are static.

## Idioms — Oscar64 vs cc65

LLM training data is mostly cc65 examples; Oscar64 idioms are underrepresented. For every pattern below, prefer the Oscar64 approach.

### Sprite setup: sprites.h vs POKE loops

**Oscar64 — correct:**

```c
#include <c64/sprites.h>
spr_init((char *)0x0400);           // pass screen RAM address
spr_set(0, true, 160, 100, 1, VCOL_WHITE, false, false, false);
// sp=0, visible, x=160, y=100, image block=1, color, no multicolor, no expand
```

**cc65 antipattern — avoid:**

```c
// raw POKE to VIC registers -- fragile, verbose, no type safety
POKE(0xD015, PEEK(0xD015) | 0x01);  // enable sprite 0
POKE(0xD000, 160);                   // x pos low
POKE(0xD001, 100);                   // y pos
```

The `sprites.h` functions set the MSB of the X coordinate, manage the enable bitmask, and work with the `vspr_*` multiplexer. Direct VIC register POKEs scatter the logic across the codebase and break when the screen address changes.

### Raster IRQs: rasterirq.h vs hand IRQ swapping

**Oscar64 — correct:**

```c
#include <c64/vic.h>        // vic and VCOL_* live here; rasterirq.h does not pull it in
#include <c64/rasterirq.h>

RIRQCode colorBar;

void setup(void) {
    rirq_build(&colorBar, 1);
    rirq_write(&colorBar, 0, &vic.color_back, VCOL_RED);
    rirq_set(0, 80, &colorBar);   // fires one line below raster 80
    rirq_init(true);              // use kernal IRQ vector
    rirq_start();
}
```

**cc65 antipattern — avoid:**

```c
// Manual CIA disable + vector swap + SEI/CLI + RTI stub
*(unsigned char *)0xDC0D = 0x7F;     // disable CIA timer
*(unsigned char *)0xD01A = 0x01;     // enable raster IRQ
*(void **)0x0314 = my_irq;           // kernal IRQ vector
```

The `rasterirq.h` system handles CIA disable, vector installation, slot sorting, and line-accurate entry in optimized assembly (every RIRQCode built by `rirq_build` begins with a `CMP $D012 / BCS` spin that lands the first write early in the target line, with up to six cycles of residual jitter: line-stable, not cycle-exact, which an earlier version of this sentence called "stable-IRQ timing"; for $D016/$D018 splits use the double-IRQ method in `recipes/kickassembler/stable-raster-irq.md`). Hand-written IRQ code often breaks between PAL and NTSC and does not extend to multi-split effects.

### SID playback: sid.h helpers vs raw frequency writes

**Oscar64 — correct:**

```c
#include <c64/sid.h>

// Play middle A (440 Hz) on voice 0, square wave
sid.voices[0].freq  = SID_FREQ_PAL(440);
sid.voices[0].pwm   = 0x0800;
sid.voices[0].ctrl  = SID_CTRL_RECT | SID_CTRL_GATE;
sid.voices[0].attdec = SID_ATK_2 | SID_DKY_6;
sid.voices[0].susrel = 0xF0;
```

**cc65 antipattern — avoid:**

```c
// Magic numbers with no semantic meaning
POKE(54272, 177);  // voice 1 freq lo — what frequency is this?
POKE(54273, 28);   // voice 1 freq hi
POKE(54276, 0x11); // gate + triangle
```

`SID_FREQ_PAL(hz)` and `SID_FREQ_NTSC(hz)` compute the 16-bit frequency register value for the given Hz. The named constants (`SID_ATK_*`, `SID_DKY_*`, `SID_CTRL_*`) name the envelope and waveform bits. The struct maps onto the hardware registers at `$D400`; the compiler emits the same single-byte store that a POKE would.

### Joystick input: joystick.h vs direct $DC00 read

**Oscar64 — correct:**

```c
#include <c64/joystick.h>

joy_poll(0);   // poll $DC00 = physical joystick port 2 (standard single-player port)
if (joyb[0])  { /* fire button */ }
if (joyy[0] < 0) { /* up */ }
if (joyx[0] > 0) { /* right */ }
```

Port mapping (verified against `include/c64/joystick.c`): `joy_poll(0)` reads `$DC00` = port 2, `joy_poll(1)` reads `$DC01` = port 1.

**cc65 antipattern — avoid:**

```c
// Direct CIA read with manual bit manipulation
char joy = ~PEEK(0xDC00);
if (joy & 0x10) { /* fire */ }
if (joy & 0x01) { /* up */ }
```

`joy_poll` reads the CIA port, inverts the active-low logic, and deposits signed delta values into `joyx[]`/`joyy[]` and a boolean into `joyb[]`. Signed deltas add directly to a position. The CIA register approach requires knowing which port maps to which player and the active-low polarity.

**Pitfall:** `$DC00` is shared with the keyboard column drive. With the KERNAL IRQ scanning the keyboard 50/60 Hz, `joy_poll(0)` can read all-pressed phantom input if it samples mid-scan. Fix: `sei`/`cli` around the poll, or use keyboard input via `getchx()`/`keyb_poll()`. See `pitfalls/input.md`.

### Packed bitfields and structs: first-class in Oscar64

Oscar64 compiles packed bitfield structs to short read-modify-write sequences:

```c
struct VICFlags {
    unsigned raster_msb : 1;
    unsigned den        : 1;
    unsigned bmm        : 1;
    unsigned ecm        : 1;
    unsigned scroll_y   : 3;
};
```

No mask-and-shift macros are needed. The optimizer recognizes that bit-field stores to volatile hardware registers must not be merged.

### printf is real

Oscar64 provides a working `printf` that calls `CHROUT` internally. It supports `%d`, `%u`, `%x`, `%s`, `%c`, and floating-point with `%f`/`%e`. Long and float support can be stripped with `-dNOLONG` and `-dNOFLOAT` to save code space. The PETSCII translation mode must be set for correct output on the C64 display:

```c
#include <stdio.h>
#include <conio.h>   // iocharmap() and IOCHM_* live here, not in stdio.h
iocharmap(IOCHM_PETSCII_2);
printf("Score: %d\n", score);
```

A hand-written CHROUT loop is not needed.

### `__striped` arrays for tile maps and particle systems

When storing a tile map or particle array where each element has multiple byte fields, the `__striped` qualifier lets the compiler use the 8-bit Y index register directly:

```c
__striped struct Tile {
    char screen_code;
    char color;
    char flags;
} tilemap[256];

// tilemap[i].screen_code compiles to: LDA screen_code_base, Y
// tilemap[i].color compiles to:       LDA color_base, Y
// No multiply, no 16-bit indexing
```

This is the Oscar64 idiom for per-sprite or per-tile parallel arrays. In cc65, programmers declare separate `sprite_x[]`, `sprite_y[]`, `sprite_color[]` arrays by hand for the same layout; `__striped` puts that layout in the type system.

### `#embed` for binary data

For assets that ship with the program, use `#embed` to put them in the `.prg` at compile time instead of loading them at run time:

```c
const char charset_lzo[] = {
#embed lzo "../gfx/charset.bin"
};
// at startup:
oscar_expand_lzo((char *)0xD000, charset_lzo);
```

The cc65 idiom of `#incbin` in an assembler stub does the same but requires a separate `.s` file and a `SEGMENTS` declaration in the config file. Oscar64's `#embed` works directly in C.

## Asm interop with KickAssembler

Use Oscar64 for game logic, asset handling, and most rendering. Use inline assembly or KickAssembler for routines where every cycle is counted: stable-raster IRQ entry, sprite-multiplex sort loops, and hardware register sequences that must hit specific cycle offsets.

### Inline assembly

The `__asm { }` block embeds 6502 instructions directly inside any function:

```c
void fast_copy(const char * src, char * dst, char count) {
    __asm {
        ldx count
        ldy #0         // the compiler emits no ldy; without it the copy starts at whatever Y holds
    loop:
        lda (src),y    // src is a zero-page pointer pair
        sta (dst),y
        iny
        dex
        bne loop
    }
}
```

Local variables and parameters are accessed by name inside `__asm` blocks; the compiler maps them to their zero-page register pairs. Global variables use absolute addressing. Return values go into the `ACCU` zero-page location. Struct member offsets use the `Type::Member` syntax: `ldy #Point::y`. Labels are defined with a colon suffix; they are scoped to the function.

The assembler optimizer runs on inline assembly at `-O2` and above. To suppress it for timing-sensitive code: `__asm volatile { ... }` or `#pragma optimize(noasm)` around the block.

### Calling KickAssembler code from Oscar64

Oscar64 has no object linker and no external-symbol resolution (measured on build 2026-05-19): `extern "C"` is a parse error (`error 3006: Declaration starts with invalid token 'string literal'`), a call to a declared function with no body is `error 3022: Calling undefined function`, and a `.prg` given on the command line is accepted and silently ignored: the output is byte-identical to the build without it. An earlier version of this page described an extern/link workflow; it never worked. To use hand-written assembly either write it as an `__asm { }` block, or assemble it with KickAssembler at a fixed address (`* = $C000`), embed the bytes past the two-byte load address into a placed, exported array, and JSR to the address from inline assembly (a `const` function pointer to a literal address crashes the compiler, see Pitfalls):

```c
#pragma section( asmcode, 0 )
#pragma region( asmreg, 0xc000, 0xc100, , , { asmcode } )
#pragma data( asmcode )
__export const char scroller_code[] = {
#embed 256 2 "scroller.prg"
};
#pragma data( data )
// ...
__asm { jsr $c000 }
```

Put `#embed` on its own line: the directive consumes the rest of the line, so the one-line `{ #embed "f" };` form loses the closing brace and fails with `error 3006` on this build.

Any arguments must be passed through zero-page locations or globals the assembly side knows about; the Oscar64 parameter registers are not a stable interface. If the assembly does read the compiler's slots, it must observe the Oscar64 calling convention. For functions the compiler classifies as leaf calls, parameters are passed in the zero-page block from `$0D` upward (`P0` = `$0D/$0E`, `P2` = `$0F/$10`, `P4` = `$11/$12`, …; each parameter takes as many bytes as its type, so a `char` occupies one slot and a pointer two). `$02` is the compiler's Y-register spill byte, not an argument register; an earlier version of this page said the first argument lived at `$02`/`$03` (vendor manual, "Zero page usage" table; `BC_REG_FPARAMS = 0x0d` in the compiler source). Slot assignment is decided per function by the global analyzer (parameters that constant-fold away free their slots), and non-leaf or recursive functions receive arguments on the software stack instead, so read the generated `.asm` listing for the exact slots of the function you are replacing. A concrete example: for `void unrolled_scroller(char *screen, char scroll_x)` the listing gives `screen` at `$0D/$0E` and `scroll_x` at `$0F`.

## Pitfalls

**Always set `-tf=`** when targeting anything other than `.prg`. Omitting `-tf=crt` when building for EasyFlash produces a `.prg` with the BASIC stub still present; it crashes when the cartridge reset vector fires.

**`__zeropage` lifetime.** `__zeropage` variables go to the linker's `zeropage` region, which on the `c64` target defaults to `$F7`–`$FE` (Compiler.cpp: `AddRegion(zeropage, 0x00f7, 0x00ff)`; read your `.map`). That is the KERNAL's RS-232 buffer pointers (`$F7`–`$FA`, only live if device 2 is opened) plus the four free bytes `$FB`–`$FE`, so with the ROMs mapped and no RS-232 in use they are safe by default. Crashes come from widening the region: `-xz` moves it to `$80`–`$FE` (upstream: "no return to basic"), and `#pragma region(zeropage, ...)` into `$03`–`$8F` (BASIC's workspace) or `$90`–`$F6` (KERNAL's). They ARE zero-filled at startup by crt.c on every entry through the startup code, including a second `RUN` after `STOP`/`RESTORE`, unless you build with `-dNOZPCLEAR` (`-dNOBSSCLEAR` covers the main BSS; the spellings `NOBSSCLR`/`NOZPCLR` are not recognised and silently do nothing). "Not initialized" means only that an initializer such as `__zeropage char z = 0x55;` is silently ignored; the byte still starts at 0. An earlier version of this pitfall said the default region was `$02`–`$61`, that the variables were never cleared and that the flag was `NOBSSCLR`; all three were wrong.

**Banked-RAM context.** When accessing data in an EasyFlash bank, the `eflash.bank` write must not be reordered relative to subsequent reads from that bank. The `__memmap` qualifier on the bank register (already present in the `EasyFlash` struct definition) provides the necessary memory fence. Do not cast the bank register to plain `volatile byte *`; that loses the fence.

**Register stomping in `__interrupt`.** An `__interrupt`/`__hwinterrupt` function saves and restores the zero-page registers used by itself *and* by every function it reaches through direct calls: the compiler walks the static call graph, adding each callee's zero-page set and a fixed ACCU/WORK set for each runtime routine (measured: a handler calling a plain function that multiplies saves that function's WORK `$03`–`$06` and ACCU `$1B`–`$1E`). An earlier version of this pitfall said callees were unprotected; they are not. Calls it cannot follow are rejected, not left unprotected: a call through a function pointer fails with error 3035 `No recursive functions in interrupt`, and `printf` or anything else needing a stack frame fails with error 3035 `Function to complex for interrupt`. The hole that does exist is the runtime scratch byte `__tmpy` at `$02`: runtime routines such as `mul16by8` use it, it is not in the saved set, and a handler that multiplies (directly or via a callee) corrupts a multiply the main code was in the middle of (measured 1,706 wrong products in 30,000 with a multiplying IRQ handler, 0 with a control handler whose multiply skips `$02`). Avoid multiplication, division and other runtime-routine arithmetic inside interrupt handlers, or save `$02` yourself around the call.

**Avoid recursion and function pointers.** The compiler's static call graph analysis, which removes the need for a runtime software stack, fails in the presence of recursion or indirect calls through function pointers. Recursive functions and indirect calls force the compiler to allocate stack frames dynamically, which is expensive on the 6502. Use switch statements instead of vtable-style function-pointer dispatch, and convert recursive algorithms to iterative form.

**Prefer `unsigned` and 8-bit types.** Signed arithmetic (signed shifts, signed compares, signed multiply) generates more code than unsigned equivalents. The compiler narrows 16-bit operations to 8-bit when it can prove the range fits, but it cannot do so through global variables or pointer-accessed values without help. Add `__assume(x < 256)` where you know the range, and declare loop counters as `char` or `byte` rather than `int`.

The next nine were found by compiling and running this knowledge base's own recipes with Oscar64 (build 2026-05-19, commit c1270bc) and VICE; see `scripts/check-listings.ts`.

**A call through a `const` function pointer initialised with a literal address crashes the compiler.** `static void (* const f)(void) = (void (*)(void))0x1003; f();` is a segmentation fault at every `-O` level, with no diagnostic. Casting the pointer without calling it is fine, so `rirq_call(&slot, 0, (void *)0x1003)` works; for a direct call use `__asm { jsr $1003 }`.

**Data nobody references is dropped, even in a placed section.** A `static const` array in a `#pragma data(section)` block that exists only to be at a fixed address (a SID stub at `$1000` that will be `JSR`ed by address) is removed by the linker because no C code names it, and the `JSR` then lands on zero bytes (`BRK`, so BASIC's warm start and a cleared screen). Declare it `__export` to keep it. The `.map` file shows the section's size as 0000 when this has happened.

**`NUM_IRQS` and the other library table sizes are per translation unit.** `rasterirq.c` is compiled as its own unit through the header's `#pragma compile`, so a `#define NUM_IRQS 17` in your main file changes what your file believes and not what the library allocates; slot 16 then overwrites something else, silently. Pass `-dNUM_IRQS=17` on the command line so every unit agrees, or stay within the default 16. `rirq_set` has no bounds check.

**A guarded index into an array shorter than 256 loses its guard.** Oscar64 1.32.271 at `-O1`, `-O2` and `-O3` compiles `char h = l == NONE ? NONE : lt[l];` (with `NONE` 255 and `char lt[64]`) to an unguarded `lda nextl,y / tax / cmp lt,x`: it infers `l < 64` from the size of `lt` and applies that to an access that only runs when `l != NONE`, so `l == 255` reads `lt[255]`, past the array. Measured in VICE x64sc: a 25-line test turns the border red at `-O1` to `-O3` and green at `-O0` and `-Os`, and green at `-O2` when `lt` has 256 entries. The same happens in the `nav-area-pathfinding` recipe's table check. Write the guard as a statement (`char h = NONE; if (l != NONE) h = lt[l];`), which compiles correctly. There is no diagnostic. Oscar64 HEAD 9a902f6 still emits the unguarded compare (tested here, #30).

**A function-like macro with an empty parameter list is refused.** `#define A() (x = 1)` followed by `A();` fails with `error 3006: ';' expected` on the line after the call, whatever the body (`(x = 1)`, `x = 1` or `do { x = 1; } while (0)`); `#define A(v) (x = (v))` with `A(1);` builds. Measured with Oscar64 1.32.271 at `-O2`. Give such a macro one parameter, or use a function. Fixed upstream: the same test builds and runs correctly on Oscar64 HEAD 9a902f6 (tested here, #30).

**A loop-invariant `array + signed char` is zero-extended.** Oscar64 1.32.271 compiles a loop storing `board[rowoff[y] + px + cx[i]]`, with `px` a global `signed char` equal to -2, by hoisting `board + px` out of the loop as a 16-bit pointer and adding `px` as unsigned (`CLC; LDA #<board; ADC px; ...; LDA #>board; ADC #$00`), so `px` = `$FE` lands the store 256 bytes above the intended cell. Measured in VICE x64sc with a 20-line test (border red; 2 written at `$0400` instead of 4) and in the `falling-blocks` recipe's draft, whose board check failed. It fails at every level (`-O0` to `-Os`), and still fails on Oscar64 HEAD 9a902f6 (tested here, #30). Compute the sum in a variable first (`char x = px + cx[i]; board[rowoff[y] + x] = 1;`), or keep the offset unsigned. There is no diagnostic.

**A read-modify-write after a store can lose its reload.** With `char i = ((height[c] + 1) << 3) + c; board[i] = side; height[c]++;` in a function that returns `i`, the 6502 back-end drops the reload of `height[c]` and emits `LDA side; STA board,y; ADC #$01; STA height,x`, storing `side + 1` into `height[c]`; the intermediate code is correct. Measured with a 24-line test in VICE x64sc at every level (`-O0`, `-O1`, `-O2`, `-O3`, `-Os`) on Oscar64 1.32.271 as built locally (commit c1270bc, see #25); the `game-tree-search` recipe's draft failed its check the same way. Read the old value into a variable first (`char h = height[c] + 1; height[c] = h;`). Oscar64 HEAD 9a902f6 compiles the pattern correctly at `-O1` to `-Os` but stops with an assertion in `GlobalRegisterYMap` at `-O0` (tested here, #30).

**Stores to a local `volatile` are deleted at `-O1` and `-O2`.** A `volatile char sink;` inside a function loses every store: a single `sink = 5;`, and a loop that only stores to it, compile to nothing, so a delay loop or a benchmark sink placed between a CIA timer start and stop leaves an empty timing window. C11 5.1.2.3 makes every access to a volatile object a side effect, so this is a miscompile. `-O0` keeps the stores; a global `volatile` is kept at `-O2`. Measured with Oscar64 1.32.271 (local build c1270bc) and Oscar64 HEAD 9a902f6 from the `-g` listings (tested here, #30). Use a global `volatile`, or write through a `volatile` pointer to a fixed address.

**Two byte tables read with one index can have the second load indexed by the first load's value.** In a loop that also calls a `__noinline` function, `cx[c] = (unsigned)sx[c] << 8; cy[c] = (unsigned)sy[c] << 8;` (with `sx`, `sy` `const char` tables and `cx`, `cy` `unsigned` arrays) compiles to `LDA sx,Y / STA cx+1,X / TAY / LDA sy,Y`: the value loaded from `sx` replaces the index before `sy` is read. Without the call in the loop the `TAY` is not emitted and the code is right. Measured with a 22-line test in VICE x64sc on Oscar64 1.32.271 (local build c1270bc): border red at `-O1`, `-O2`, `-O3` and `-Os`, green at `-O0`; found by the `car-contact` recipe's draft. Not tested on upstream HEAD (#30). Storing the values as 8.8 words, so no shift is needed, compiles correctly (the recipe's workaround). There is no diagnostic.

**Several fixed-address arrays cleared in one loop can have one array's stores sent to another's page.** `for (unsigned i = 0; i < 1024; i++) { A[i] = 32; B[i] = 32; C[i] = 32; D[i] = 32; }` with `A`..`D` at `$C000`, `$C400`, `$E800` and `$C800` compiles to one pointer shared by three of the arrays. Its high byte is set to `B`'s page before the inner loop and overwritten inside it for `D` and `C`, so from the second byte on, `B`'s stores land at `$E8xx`. Measured with a 12-line test in VICE x64sc on Oscar64 1.32.271 (local build c1270bc): border green at `-O0`, red at `-O1`, `-O2`, `-O3` and `-Os`. The #39 platformer's review saw the same on upstream HEAD 9a902f6. Found by the platformer starter, whose blank row showed `@` and `$FF` garbage. Clear each array in its own loop or with its own `memset`. There is no diagnostic (#30).

**GCC attribute syntax is not accepted.** `__attribute__((unused))` is a parse error; use `(void)x;` for a deliberately unused read. Oscar64's own qualifiers are keywords (`__interrupt`, `__zeropage`, `__striped`, `__export`, ...).

## Reading the errors

Every message below was provoked on build 2026-05-19 (`oscar64 -tm=c64 -O2`)
with the minimal source named in the second column; the sources are files in
`error-sources/oscar64/` and are shown after the table. The format is
`path(line, column) : error NNNN: text`, followed on some errors by an
`info` line with the call site or the sizes. A build with an error exits 20
and writes no PRG. Paths are printed absolute; they are shortened here.

| Message (verbatim) | Source | Cause | Fix |
|---|---|---|---|
| `error 3022: Calling undefined function 'missing()->void'` then `info 1003: Called from here` | `undefined-extern.c` | A function is declared and called but no unit in the build defines it. With a module of your own this means its `.c` was neither named by `#pragma compile` nor on the command line (see Multi-file projects). The error is printed against the declaration, twice before and once after the `info` line | Add `#pragma compile("file.c")` to the header, or the `.c` to the command line |
| (no error; exit 0) | `undefined-extern-var.c` | An `extern` variable with no definition is allocated by the linker in `bss`, silently | Define it once; check the `.map` if a value is unexpectedly zero |
| `error 3034: Could not place object 'big'` then `info 1004: Size 40000 Available 34672 in section 'bss'` | `region-overflow.c` | An object is larger than the free space in its section. The `info` line gives both numbers; 34,672 is the default `main` region (`$0880` to `$9000`, the 4 KB stack already carved off the top) less this program's own 16 bytes of code | Shrink the object, move it to its own region with `#pragma region` / `#pragma section` (see Memory layout and banking), or lower `#pragma stacksize` |
| `error 3006: ',y' expected` then `error 3006: End of line expected`, both at the same column | `asm-addressing-mode.c` | Inside `__asm`, an indirect operand in a form the 6502 lacks, here `lda ($fb),x`. `lda ($fb,x),y` gives only the `End of line expected` line; an unknown mnemonic gives `error 3006: ':' expected` then `error 3028: Invalid assembler token`, because the word is taken for a label | Use `($fb),y` or `($fb,x)` |
| (no error; exit 0) | `asm-addressing-mode.c`, second form | `sta #5`, `inc #5` and `jmp #$1000` are accepted. The `.asm` listing shows the opcode byte emitted as `ff` (`INV`), so the program executes an invalid opcode at run time. Only the indirect forms above are diagnosed | Read the `.asm` listing of any `__asm` block once; look for `INV` |
| `crt.c(30, 5) : error 3025: Function declaration differs 'main'` | `void-main.c` | `void main(void)`: the startup code in `include/crt.c` calls `main` as `int main(void)`, so the error is reported in crt.c, not in your file | Declare `int main(void)` and return a value |
| `error 3005: Struct member identifier not found 'border'` | `unknown-vic-field.c` | A field name `vic.h` does not have. The border colour register is `vic.color_border`, the background `vic.color_back` | Read the struct in `include/c64/vic.h`, or the [headers reference](oscar64-headers-reference.md) |

One thing seen while building this section is a crash, not an error. With
`while (border_calls) ;` as the idle loop in `main.c` (a global `char`,
nothing else in the loop), `-O0` and `-O1` aborted with `Assertion failed:
(size > 0), function Last, file Array.h, line 569.` (exit 134), and `-O2`
printed `Oops 29` repeatedly, after `warning 2007: Optimizer locked in
infinite loop 'main'`, and still wrote a PRG. How many times depends on the
surrounding source: eleven with the `main.c` shown above and `while
(border_calls) ;` in place of `for (;;) ;`, a different count with a shorter
file. `for (;;) ;` builds cleanly at every level. Not reduced further than
that.

Sources (each is meant to fail or misbehave, so none is in a buildable
fence):

`undefined-extern.c`

```text
extern void missing(void);
int main(void)
{
    missing();
    return 0;
}
```

`undefined-extern-var.c`

```text
extern char missing_var;
int main(void)
{
    return missing_var;
}
```

`region-overflow.c`

```text
char big[40000];
int main(void)
{
    big[0] = 1;
    return big[39999];
}
```

`asm-addressing-mode.c` (the file holds the diagnosed form; the accepted
forms were tried one at a time in the same frame)

```text
int main(void)
{
    __asm {
        lda ($fb),x
    }
    return 0;
}
```

`void-main.c`

```text
void main(void)
{
}
```

`unknown-vic-field.c`

```text
#include <c64/vic.h>
int main(void)
{
    vic.border = 5;
    return 0;
}
```

## See also

- [oscar64-headers-reference.md](oscar64-headers-reference.md) — Full per-header API reference
- [recipes/oscar64/hello-world.md](../recipes/oscar64/hello-world.md) — First buildable example
- [formats/c64-file-formats.md](../formats/c64-file-formats.md) — PRG, CRT, D64 format details
- [hardware/vic-ii-reference.md](../hardware/vic-ii-reference.md) — VIC-II register reference
- [hardware/sid-reference.md](../hardware/sid-reference.md) — SID register reference
- [memory-layout-planning.md](memory-layout-planning.md) — whole-program layout: the constraints, one worked layout in all three toolchains, confirmed from the map file; recipe `../recipes/oscar64/memory-layout.md`
- [release-disk.md](release-disk.md) — putting the built PRG on a bootable D64 with c1541, proving it boots by autostarting the image headless, and a Makefile target that does both; measured with `../recipes/oscar64/platformer-scaffold.md`
