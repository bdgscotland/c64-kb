---
tool: cc65
tool_kind: c-compiler
maintainer: cc65-team
license: Zlib
home_url: https://cc65.github.io/
version_verified: "2.18"
# cl65 --version reports 2.18 while the Homebrew package is labelled 2.19; the Krill page says tagged 2.18 miscompiles Krill, so do not install tagged 2.18 on the strength of this line.
---

<!-- doc-type: toolchain-reference -->

# cc65 — C Compiler and Assembler Suite

## Tool

cc65 is a complete cross-development package for 65(C)02 systems. It includes a
C compiler (`cc65`), a macro assembler (`ca65`), a linker (`ld65`), a librarian
(`ar65`), and a driver wrapper (`cl65`) that orchestrates the whole pipeline. The
suite targets a wide range of retro platforms; for c64-kb purposes the relevant
target is `-t c64`.

cc65 has an enormous published corpus — decades of tutorials, forum posts, and
open-source games — which makes it the path of least resistance for LLMs trained
on that data. **This doc exists primarily to help the agent recognize cc65 patterns
and evaluate whether switching to [oscar64](oscar64-reference.md) would produce
tighter, faster code.** In most action-game and demo contexts, it would.

**Targets:** 6510

## Quick reference

```bash
# macOS
brew install cc65

# Debian / Ubuntu
sudo apt install cc65

# Arch Linux
sudo pacman -S cc65

# Build a single-file program
cl65 -O -t c64 -o hello.prg hello.c
```

## Build pipeline

The full cc65 pipeline runs three tools in sequence:

```
hello.c  →[cc65]→  hello.s  →[ca65]→  hello.o  →[ld65]→  hello.prg
```

`cl65` is the driver that invokes each step automatically (see next section).
Individual tools can be called directly when fine-grained control is needed —
for example, mixing hand-written ca65 assembly with C translation units.

### .PRG — Program file (executable)

**Produced by:** cc65
**Consumed by:** vice, c1541

Two-byte load address prefix followed by machine code. The standard C64
executable format. `ld65` writes this when given the `c64` target config.

### .S — C compiler assembly output

**Produced by:** cc65

Human-readable 6502 assembly emitted by the `cc65` compiler stage. Useful for
inspecting codegen quality and understanding what overhead the compiler is
adding. Pass directly to `ca65` or let `cl65` handle it.

### .O — Object file

**Produced by:** cc65
**Consumed by:** cc65

Relocatable object produced by `ca65`. Contains code, data segments, and
symbol information. Linked by `ld65` to produce the final binary.

### .LIB — Library archive

**Produced by:** cc65
**Consumed by:** cc65

Static library archive produced by `ar65`. The standard C64 runtime and
platform libraries ship as `.lib` files bundled with the cc65 distribution.

## The cl65 wrapper

`cl65` is the recommended entry point. It detects file types by extension and
invokes `cc65 → ca65 → ld65` in the right order.

Common flags:

| Flag | Effect |
|------|--------|
| `-t c64` | Set target platform to Commodore 64 |
| `-O` | Enable basic optimizer pass |
| `-o hello.prg` | Name the output file |
| `-Cl` | Static locals (faster, not reentrant; see Pitfalls) |
| `--config path.cfg` | Use a custom linker config instead of the built-in c64 one |
| `-T` (`--add-source`) | Interleave the C source as comments in the generated assembly. An earlier version of this row said `-T` keeps intermediate files; it does not, and `cl65` has no such flag. To inspect the `.s`, stop the pipeline with `-S` (or run `cc65 -O -t c64 file.c` directly); `-c` stops after assembling. `cl65` leaves the `.o` files in place by default. |

The `-Cl` flag places local variables in BSS rather than on the software stack.
This cuts call overhead noticeably but breaks reentrancy. Acceptable for most
C64 code where recursion is deliberate and bounded.

For multi-file projects, name each `.c` and `.s` source on the command line and
`cl65` links them in one pass:

```bash
cl65 -O -t c64 -Cl -o game.prg main.c sprite.c irq.s
```

### ca65 notes

Hand-written `.s` files go through `ca65`, which differs from KickAssembler in
three ways that bite (measured with ca65 V2.18, Homebrew cc65 2.19):

- Illegal opcodes (`lax`, `sax`, `dcp`, …) need `.setcpu "6502X"` in the file
  or `--cpu 6502X` on the command line; without it every illegal mnemonic
  fails with `Error: ':' expected`, a message that does not name the CPU.
  `lsr a` is accepted. Spellings are in
  [6502-illegal-opcodes.md](../hardware/6502-illegal-opcodes.md) (Pitfalls).
- Under `-t c64` a string literal is translated to PETSCII, not screen codes:
  `.byte "FILM"` emits `$C6 $C9 $CC $CD` (shifted letters, which `CHROUT`
  draws as graphics glyphs on the power-on charset) and `.byte "film"` emits
  `$46 $49 $4C $4D` (which `CHROUT` draws as `FILM`). Write lowercase in
  source for uppercase on screen. For screen RAM use `.macpack cbm` and
  `scrcode "film"`, which emits `$06 $09 $0C $0D`. There is no
  `cbm_screen_charmap.inc` for ca65; `cbm_screen_charmap.h` is the C-side
  equivalent.
- A `.s` file linked on its own needs
  `cl65 -t c64 -C c64-asm.cfg -u __EXEHDR__`; the default `c64.cfg` expects
  the C runtime and fails with "Start address of memory area 'BSS' is not
  constant".

## Multi-file projects

`cl65` compiles each `.c` with `cc65`, assembles each `.s` (and each
generated `.s`) with `ca65` into a `.o`, and links every `.o` with `ld65`
in one command; the `cl65` line above is the whole build system. Symbols
cross the C/assembly boundary by name, with one rule: a C identifier `x`
is the assembler symbol `_x`. Measured with cl65 V2.18 (Homebrew cc65 2.19)
on the three files below; the 290-byte `out.prg` turned the border and
screen green in VICE x64sc 3.10.

The header is ordinary C. `__fastcall__` passes the last (here the only)
argument in A instead of on the software stack, which is what an assembly
routine wants:

```text
/* border.h */
#ifndef BORDER_H
#define BORDER_H
extern unsigned char border_calls;   /* defined in border.s as _border_calls */
void __fastcall__ border_set(unsigned char colour);
#endif
```

The module exports the underscored names. `.bss` with `.res` is a variable,
`.code` is code; both segments are ones `c64.cfg` already places:

```text
; border.s: ca65 module. C sees border_set and border_calls; the
; assembler names carry a leading underscore.
        .export _border_set
        .export _border_calls

        .bss
_border_calls:  .res 1

        .code
; void __fastcall__ border_set(unsigned char colour): colour arrives in A
_border_set:
        sta $d020
        sta $d021
        inc _border_calls
        rts
```

```text
/* main.c */
#include "border.h"
int main(void)
{
    border_set(5);
    while (border_calls) ;
    return 0;
}
```

```
cl65 -t c64 -O -o out.prg main.c border.s --mapfile out.map
```

The other direction is `.import _name` in the `.s` for a C function or
variable, and `jsr _name` (not measured here). `--mapfile` is how to
confirm what linked. Its "Segment list" gives every segment's start, end
and size (`CODE 000840 0008B5 000076`, `BSS 0008FB 0008FB 000001` for this
build) and its "Exports list" gives every cross-unit symbol with its
address and the module that defined it: `_main 000840`,
`_border_set 00084C`, `_border_calls 0008FB`, each followed by `RLA`
(relocatable label address). A symbol you expected and cannot find in the
Exports list was never `.export`ed, which is the failing form. Delete the
`.export _border_set` line and the link stops:

```text
Unresolved external '_border_set' referenced in:
  main.s(29)
ld65: Error: 1 unresolved external(s) found - cannot create output file
```

`main.s(29)` is the generated assembly of `main.c`, not a line of the C
file; `cl65 -S main.c` writes it if you need the line. The whole-program
view of where each segment lands, and how to move one, is
[memory-layout-planning.md](memory-layout-planning.md).

## Standard library highlights

cc65 ships extensive C64-specific headers alongside the standard ones. The
table below covers the subset relevant to typical C64 use:

| Header | Purpose |
|--------|---------|
| `conio.h` | Text-mode console I/O: `clrscr()`, `cputs()`, `gotoxy()`, `cgetc()` |
| `cbm.h` | KERNAL and BASIC bindings: `cbm_open()`, `cbm_read()`, `cbm_close()` |
| `peekpoke.h` | `PEEK(addr)` / `POKE(addr, val)` macros for direct memory access |
| `joystick.h` | Joystick port reading via `joy_read()` |
| `6502.h` | Low-level CPU operations: `BRK()`, `CLI()`, `SEI()` |
| `stdio.h` | Standard I/O — available but large; prefer `conio.h` for text output |
| `string.h` | Standard string functions |

`conio.h` is the idiomatic output library for text-mode programs. `cbm.h`
exposes the KERNAL routines via C-callable wrappers without requiring inline
assembly. `peekpoke.h` fills the gap where C's type system would otherwise
require casts through pointers.

## When to use cc65

- **Text-mode utilities and tools** — BASIC replacements, directory listers,
  config editors. The `conio.h` API covers the use-case well and the corpus
  of examples is large.
- **Corpus-heavy domains** — when training data for a specific pattern (e.g. CBM
  serial bus access via `cbm.h`) is overwhelmingly cc65-flavored, using cc65
  lowers the chance the agent generates incorrect Oscar64 translations.
- **Educational contrast** — studying a cc65 `.s` output alongside Oscar64's
  output for the same source is a reliable way to demonstrate where and why
  Oscar64 wins on codegen.
- **Porting POSIX-adjacent code** — cc65's header set is closer to standard C
  than Oscar64's, so porting a small existing utility is occasionally easier
  here first.

## When NOT to use cc65

- **Action games, scrollers, platformers** — frame budgets are tight. cc65's
  function-call overhead and absence of register allocation make inner loops
  measurably slower than Oscar64 equivalents.
- **Demos, raster effects, sprite multiplexers** — cycle-exact timing work.
  cc65 is not cycle-aware. Use Oscar64 for C code and KickAssembler for
  hand-rolled timing routines.
- **Anything that needs bitfields or packed structs** — cc65 as installed
  (V2.18; the Homebrew Cellar directory says 2.19 but `cl65 --version` reports
  V2.18) accepts bit-fields only of type `int`, `unsigned int` or `enum`. It
  is not a size rule, as an earlier version of this page said ("int-sized or
  smaller"): `unsigned char x:3;` AND `unsigned short x:3;` (int-sized on
  cc65) both fail with `Bit-field has invalid type` (measured 2026-09-22).
  Newer git cc65 is reported to relax this (unverified here); do not rely on
  char-typed bit-fields from a distro package. Oscar64 treats them as
  first-class.
- **Code-size-sensitive releases** — cc65 produces larger binaries for
  equivalent logic. Under the built-in `c64.cfg` a program gets
  `$080D`–`$D000`: 51,187 bytes, about 50 KB, the top 2 KB of it the software
  stack (`cl65 -Ln` symbols `__MAIN_START__`, `__HIMEM__`, `__STACKSIZE__`;
  the startup code banks BASIC ROM out). An earlier version of this page said
  38 KB, which is BASIC's free-bytes figure, not cc65's. Code size still
  matters on a machine this small.

The rule of thumb: if Oscar64 has a clear idiom for the task (see
[oscar64-reference.md](oscar64-reference.md)), use Oscar64. Reach for cc65 only
when the corpus availability advantage is concrete and measurable.

## Linker configs

`ld65` is driven by a linker configuration file that describes the target's
memory map, segments, and output format. The cc65 distribution ships a
ready-made config for the C64 at `cfg/c64.cfg`. For most programs, the
`-t c64` flag loads this config automatically.

The built-in config maps the standard segments:

- `EXEHDR` — the BASIC stub (`SYS 2061`) at `$0801`–`$080C`; `STARTUP` — the
  C runtime entry, at `$080D` (the stub's SYS target); `LOWCODE` (optional)
  then `CODE` — your compiled code, after STARTUP (`$0840` for a minimal
  conio program built with cc65 2.19 — read the `--mapfile` segment list
  rather than assuming a fixed address; an earlier version of this page put
  `CODE` at `$0801`, which is the stub itself); then `RODATA`, `DATA`,
  `INIT`, `ONCE` in that order within MAIN.
- `RODATA` — read-only data, placed after CODE
- `DATA` — initialized writable data
- `BSS` — zero-initialised (cleared at startup by the runtime)
- `ZEROPAGE` — `$02–$1B`, 26 bytes, all consumed by the cc65 runtime
  (`zpspace = 26` in `asminc/zeropage.inc`). An earlier version of this page
  said "allocate sparingly"; there is nothing to allocate. Adding even one
  byte to this segment under the built-in c64 config fails to link
  (`Segment 'ZEROPAGE' overflows memory area 'ZP' by 1 byte`, measured with
  cc65 2.19). For your own zero-page variables, copy `cfg/c64.cfg` and add a
  second zero-page area on the four bytes BASIC and the KERNAL leave free —
  e.g. `ZP2: file = "", start = $00FB, size = $0004;` in MEMORY and
  `EXTZP: load = ZP2, type = zp, optional = yes;` in SEGMENTS — then define
  the variable in assembly (`.segment "EXTZP" : zeropage` / `_myzp: .res 1`)
  and expose it to C with `extern unsigned char myzp; #pragma zpsym("myzp")`
  (the pragma must follow the declaration). Do not simply enlarge `ZP` past
  `$1B`: `$1C` onward is BASIC/KERNAL workspace. Six of the runtime's 26
  bytes are the `register` bank, so `register` locals (with `-Or`) are the
  only zero-page you get without a custom config.

For non-standard layouts — cartridges, custom load addresses, split-bank
programs — write a custom `.cfg` file and pass it with `--config`. The
linker config language is well-documented in the cc65 `ld65` manual and
the existing `cfg/c64.cfg` is a readable starting template.

## Cartridge builds

A generic 8 KB cartridge is a linker configuration, a start-up routine
and a container. The [cartridge-8k](../recipes/cc65/cartridge-8k.md)
recipe is the worked example; every figure below was measured on it with
cc65 2.19 (`cl65` reports V2.18) and VICE x64sc 3.10.

**The configuration.** Line by line, what each area and segment does:

```cfg
SYMBOLS {
    __STACKSIZE__: type = weak,   value = $0800;
    __STARTUP__:   type = export, value = 1;
}
MEMORY {
    ZP:     file = "",         start = $0002, size = $001A, define = yes;
    CRTHDR: file = "game.crt", start = $0000, size = $0050, fill = yes;
    ROML:   file = "game.crt", start = $8000, size = $2000, fill = yes, fillval = $FF, define = yes;
    RAM:    file = "",         start = $0800, size = $D000 - __STACKSIZE__ - $0800, define = yes;
}
SEGMENTS {
    ZEROPAGE: load = ZP,     type = zp;
    CRTHDR:   load = CRTHDR, type = ro;
    CBM80:    load = ROML,   type = ro;
    STARTUP:  load = ROML,   type = ro;
    ONCE:     load = ROML,   type = ro,  optional = yes;
    CODE:     load = ROML,   type = ro;
    RODATA:   load = ROML,   type = ro;
    DATA:     load = ROML,   run = RAM, type = rw, define = yes;
    BSS:      load = RAM,    type = bss, define = yes;
}
FEATURES {
    CONDES: type = constructor, label = __CONSTRUCTOR_TABLE__, count = __CONSTRUCTOR_COUNT__, segment = ONCE;
    CONDES: type = destructor,  label = __DESTRUCTOR_TABLE__,  count = __DESTRUCTOR_COUNT__,  segment = RODATA;
    CONDES: type = interruptor, label = __INTERRUPTOR_TABLE__, count = __INTERRUPTOR_COUNT__, segment = RODATA, import = __CALLIRQ__;
}
```

This is the recipe's file with its comments and two empty optional
segments (`LOWCODE`, `INIT`) removed; the recipe page holds the complete
file, and this block links as it stands (run here: the same `.crt`,
byte for byte).

- `__STACKSIZE__` is the C stack, which the start-up code puts at the top
  of `RAM`, so `RAM` ends `$0800` below `$D000`.
- `__STARTUP__` exported here satisfies the `.forceimport __STARTUP__`
  the compiler emits for `main`, so the library's `crt0` stays out.
  Without the export the link fails with `Unresolved external
  '__MAIN_SIZE__' referenced in: c64/crt0.s(96)` and the same for
  `__MAIN_START__` (run here): that `crt0` sizes its stack from a `MAIN`
  area a cartridge configuration does not have.
- `ZP` is the runtime's 26 zero-page bytes, unchanged from `c64.cfg`.
- `CRTHDR` is the 80 bytes of `.CRT` header and `CHIP` packet, at file
  offset 0; `fill = yes` keeps it 80 bytes if the segment is short.
- `ROML` is the 8 KB the cartridge maps at `$8000`, padded with `$FF`
  to the size the packet declares.
- `RAM` is where writable data runs; it is written to no file.
- `CBM80` comes first in `ROML` so its nine bytes land at `$8000`.
- `STARTUP` is the cold-start routine; `ONCE` holds library constructor
  code (12 bytes for conio); `CODE` and `RODATA` are read-only and stay
  in ROM.
- `DATA` has `load = ROML` and `run = RAM`: the image is in ROM, every
  address the code uses is in RAM, and `define = yes` gives `copydata`
  the three symbols it needs.
- `BSS` is RAM only, zeroed at start.
- `FEATURES` is `c64.cfg`'s own block and must stay: the runtime's
  `condes.s` imports the constructor and destructor table symbols
  whether or not anything uses them. With the block left out, `ld65`
  stops with `Unresolved external '__CONSTRUCTOR_COUNT__' referenced
  in: runtime/condes.s(30)`, the same for `__CONSTRUCTOR_TABLE__`,
  `__DESTRUCTOR_COUNT__` and `__DESTRUCTOR_TABLE__`, then `4 unresolved
  external(s) found`, and writes no `.crt` (run here). The constructor
  table goes in `ONCE`, the other two in `RODATA`, all in ROM, which is
  where a table of addresses belongs.

Both areas that reach a file name it outright, so `ld65` writes the
finished container and the `.prg` named by `-o` never appears. This is
the route the repository's recipe verifier needs, since it boots what
the build leaves behind; `c64.cfg`'s `LOADADDR` and `EXEHDR` segments,
and the `__LOADADDR__`/`__EXEHDR__` imports that pull them in, are gone
with the stub. With `__EXEHDR__: type = import;` left in, `ld65` stops
with `Missing memory area assignment for segment 'EXEHDR'`, after a
warning that it cannot evaluate an assertion in `cbm/exehdr.s`, and it
still left a `.crt` behind (run here), so read the messages and not the
directory.

**The signature.** The KERNAL's reset code compares the five bytes at
`$8004` with `$C3 $C2 $CD $38 $30` before it initialises anything, and on
a match jumps through the vector at `$8000`; the `RESTORE` key's NMI
makes the same test and takes `$8002`. In C, a `const` struct of two
function pointers and five bytes in the `CBM80` segment is nine bytes
with no padding.

**The start-up code.** cc65 2.19 has no file-scope `asm` (`__asm__ is
not allowed here`) and its inline `asm` refuses `.segment`, `.byte` and
`.res`, so the routine is a C function of inline instructions in the
`STARTUP` segment, no arguments and no locals, which gives it no
prologue. It sets the hardware stack, calls `IOINIT`, `RAMTAS`, `RESTOR`
and `CINT` in that order, then `zerobss`, `copydata`, sets `sp` to the
top of `RAM`, and calls `initlib` and `callmain`. The library names
resolve because the compiler switches `.autoimport` on in every file it
emits. Measured: the KERNAL takes the vector 109 cycles after power-on;
`main` is entered 1,650,044 cycles later on PAL and 1,643,133 on NTSC.
The split, from `trace exec` on each call (run here, PAL): `IOINIT` and
the stack set 147, `RAMTAS` 1,593,289, `RESTOR` 889, `CINT` 53,221,
`CLI` to `main` 2,498, of which the on-screen CIA timer covers 2,281.
`RAMTAS`, the KERNAL's test of every RAM byte below the cartridge, is
96.5 % of it; `CINT` is the one stage that differs on NTSC (46,310).
`IOINIT` writes all four CIA control registers 34 to 46 cycles after the
first cartridge instruction (stopwatch 143 to 155, `trace store` on
`$DC0E`, `$DC0F`, `$DD0E`, `$DD0F`), which is why a CIA timer cannot span
the KERNAL part and the monitor's stopwatch has to.

**Load versus run.** The `DATA` copy exists because a cartridge cannot
take a write. With `load = ROML` alone the same program booted, entered
`main`, and hit a `BRK` 1,049 cycles into its first `cprintf`; nothing
was printed and the KERNAL's `BRK` path at `$FE66` ran fifty-five times
before the cycle limit. The runtime keeps writable state in `DATA` too,
and it was reading its image back from ROM. The globals did not read as
zero; they read as their initialisers, and writes to them were lost.

**The wrap.** The recipe's header is written by the linker, and the same
8 KB image fed to `cartconv -t normal -i rom.bin -o game.crt -n "NAME"`
gave a byte-identical file. Either route ends in `cartconv -c` (exit 0)
and `cartconv -f`, which prints the hardware id, the `EXROM`/`GAME`
levels and one `CHIP` at `$8000`
([cartconv-reference](cartconv-reference.md)).

**Pitfalls met.** Character literals are translated to PETSCII by
`-t c64`, so `'C'` in the header initialiser became `$C3`; VICE answered
`no CRT header found` and `cartconv -f` printed nothing and exited 0.
Write the signature and name as numeric bytes. And a `DATA` segment
without `run` links clean, boots, and fails inside the library, not in
your own code.

## Idioms — cc65 vs Oscar64

cc65 and Oscar64 differ in ways that matter at the codegen level. The agent
should recognize these patterns to avoid inadvertently reaching for the weaker
option.

**Function call overhead.** cc65 uses a software stack (pointed to by `sp`
in zero page, but located in main RAM below `__HIMEM__`; an earlier version
of this page put the stack itself in zero page) for passing arguments. Each
call pushes and pops arguments through this stack, adding several cycles per
parameter. Oscar64 passes leaf-function arguments in fixed zero-page slots
(what its manual calls "zero-page registers": `$0D` upward, `P0`/`P1`/…),
chosen by whole-program analysis, and falls back to its own software stack
only for non-leaf or recursive functions (see
[oscar64-reference.md](oscar64-reference.md)); nothing is passed in A/X/Y.
cc65's default `__fastcall__` convention does put the rightmost argument in
A/X and pushes the rest through its `sp`-indexed software stack. Oscar64's
inner loops are substantially cheaper. If a function is called in a tight
raster IRQ or per-scanline loop, the cc65 overhead accumulates into missed
raster windows.

**Bitfields.** Oscar64 supports bitfields in structs natively and maps them
to efficient read-modify-write sequences. cc65 supports them with restrictions
(only `int`/`unsigned int`/`enum` members; `unsigned char` fields do not
compile) and the codegen is less predictable. Writing a hardware
register struct like `VIC_CR1` with bitfields is idiomatic Oscar64; in cc65
the same code requires explicit masks and shifts or falls back to `POKE`.

**Struct-by-value.** Passing structs by value in cc65 is expensive — the
compiler copies through the software stack. Oscar64 handles small structs in
registers. Where the code passes hardware-register shadow structs or sprite
coordinate pairs around frequently, Oscar64's ABI wins clearly.

**Static locals via `-Cl`.** cc65's `-Cl` flag converts local variables to
static (BSS) allocation. This is a performance hack that produces faster code
at the cost of reentrancy. Oscar64 does not need this flag because it performs
stack allocation analysis and promotes locals to registers or static storage
automatically where safe.

**Choosing cc65.** The agent picks cc65 when the corpus availability advantage
is real: a known-working cc65 snippet for CBM serial I/O, or a text-mode UI
library built around `conio.h`, is worth more than a theoretically optimal
Oscar64 translation that may contain ABI errors. When the task is creative
(new code, not porting), default to Oscar64.

## Debugging with VICE

`cl65 -Ln <file>` makes the linker write a VICE label file. Built from
[recipes/cc65/hello-world-conio.md](../recipes/cc65/hello-world-conio.md):

```bash
cl65 -O -t c64 -Ln hello.lbl -o hello.prg hello.c
```

`hello.lbl` is one `al` command per symbol, six hex digits, no memspace
prefix, and a leading underscore on every C symbol. The file also names
the KERNAL entries the library imports:

```text
al 000840 ._main
al 0008EA ._cputs
al 00E544 ._clrscr
al 00FFD2 .BSOUT
```

Load it and arm a breakpoint from a `-moncommands` file:

```text
ll "hello.lbl"
break ._main
```

Run with the remote text monitor and connect to the port (the flags and
the reason `-console` is not used are in
[../runtime/vice-reference.md](../runtime/vice-reference.md), "Text
monitor for debugging"):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 6000000 \
  -remotemonitor -remotemonitoraddress ip4://127.0.0.1:6510 \
  -moncommands hello.mon -autostart hello.prg
```

The break hit, with the label resolved in both the stop and the
disassembly of the first instruction of `main()`:

```text
#1 (Stop on  exec 0840)   55/$037,  52/$34
.C:0840  20 44 E5    JSR ._clrscr   - A:00 X:00 Y:04 SP:f4 ..-....C    2971573
(C:$0840) break
BREAK: 1  C:$0840  (Stop on exec)
```

`$0840` is `_main` in the label file and in `--mapfile`'s Exports list
(see Multi-file projects). Measured with cc65 V2.18 and VICE x64sc 3.10.
`print ._main` is refused with `Wrong syntax`; the label is usable as an
address in `break`, `watch`, `m` and `until`, not as an expression to
print. The symbol export material for the other toolchains is in
[kickassembler-reference.md](kickassembler-reference.md) ("Symbol export
for VICE/vice-mcp" and "Debugging with VICE") and
[oscar64-reference.md](oscar64-reference.md) ("Debugging").

## Pitfalls

**Static initializers in ROM sections.** The cc65 `DATA` segment holds
initialized writable data. If a custom linker config accidentally places `DATA`
in a ROM region, the program links clean and misbehaves at run time.
Always verify the segment map with `--mapfile` output. An earlier version of
this entry said the globals read back as zeros; measured on the
[cartridge-8k](../recipes/cc65/cartridge-8k.md) recipe with `DATA` in ROM,
they read back their initialisers, writes to them were lost, and the run
ended in a `BRK` inside `cprintf` ("Cartridge builds" above).

**Stack overflow with deep call trees.** cc65's software stack is 2 KB by
default on the C64 (`__STACKSIZE__ = $0800` in `c64.cfg`); it starts at
`__HIMEM__` ($D000) and grows downward through $C800, immediately above the
heap and BSS. Only the two-byte stack pointer `sp` lives in zero page
($02/$03). An earlier version of this page said the stack was in zero page
and about 256 bytes; both were wrong. Deep recursion overflows it silently
downward into heap and BSS data, not into zero page. Raise it with
`-Wl -D,__STACKSIZE__=0x1000` (if you write `$1000`, quote it — an unquoted
`$1000` is eaten by the shell and ld65 reports `Invalid definition`) or a
custom linker config; keep call depth shallow and prefer iterative
algorithms. `-Cl` moves locals off the stack, which reduces per-frame usage,
but does not protect against deep recursion itself.

**`printf` code size.** `printf` from `stdio.h` pulls in the full format-string
parser, adding roughly 2–3 KB to the binary. For output in a C64 program,
`cputs()` from `conio.h` or a direct KERNAL `CHROUT` call (via `cbm.h`) is
far smaller. Reserve `printf` for debugging builds only.

**Mixing `conio.h` screen coordinates with direct VIC writes.** `conio.h`
maintains its own cursor state. Writing directly to screen RAM (`$0400`) or
color RAM (`$D800`) bypasses that state. Either use `conio.h` exclusively for
text output, or bypass it entirely and drive the hardware directly.

**Implicit `int` promotions.** 8-bit values compared or computed in expressions
get promoted to `int` (16-bit) in C. cc65 emits 16-bit arithmetic sequences
for these promotions. Use explicit `uint8_t` casts in hot paths to get 8-bit
sequences.

## Reading the errors

Every message below was provoked with cl65 V2.18 (Homebrew cc65 2.19,
`cl65 -t c64 -O`) on the minimal source named in the second column; the
sources are files in `error-sources/cc65/` and are shown after the table.
Compiler and assembler errors read `file(line): Error: text`; linker errors
are prefixed `ld65:` and name the linker config and its line, not your
source. Each build exits 1 and writes no PRG.

| Message (verbatim) | Source | Cause | Fix |
|---|---|---|---|
| `ld65: Warning: .../cfg/c64.cfg(15): Segment 'BSS' overflows memory area 'BSS' by 1088 bytes` then `ld65: Error: Cannot generate most of the files due to memory area overflow` | `segment-overflow.c` | The program's data (here a 50,000-byte array) does not fit between the end of the code and the software stack under `$D000`. The overflow is reported as a warning; the error line is the one that stops the build | Shrink the data, lower `__STACKSIZE__` (see Pitfalls), or a custom config: [memory-layout-planning.md](memory-layout-planning.md) |
| `Unresolved external '_missing' referenced in:` then `  unresolved-external.s(27)` then `ld65: Error: 1 unresolved external(s) found - cannot create output file` | `unresolved-external.c` | A function or variable was declared and used but no object defined it: a `.s` module without `.export _name`, or a `.c` or `.s` left off the `cl65` line. The reference is located in the generated `.s`, not in the C source | Add the `.export`, or the file to the command line (see Multi-file projects) |
| `range-error.s(3): Error: Range error (300 not in [0..255])` | `range-error.s` | An 8-bit operand or `.byte` given a value outside 0..255, here `lda #300`. A `.word` beyond 65535 gives the same shape with `[0..65535]` (arithmetic, not measured here) | Use `#<value` / `#>value` for one byte of a 16-bit constant, or `.word` |
| `missing-setcpu.s(3): Error: ':' expected` then `missing-setcpu.s(3): Error: Unexpected trailing garbage characters` | `missing-setcpu.s` | An illegal mnemonic (`lax $10`) under the default CPU. `ca65` does not know the word, reads it as a label and expects a colon; the message never names the CPU (see ca65 notes) | `.setcpu "6502X"` at the top of the file, or `--cpu 6502X` on the command line; both assemble the file (measured) |

Sources (each is meant to fail, so none is in a buildable fence):

`segment-overflow.c`

```text
unsigned char big[50000U];
int main(void)
{
    big[0] = 1;
    return big[1];
}
```

`unresolved-external.c`

```text
extern void missing(void);
int main(void)
{
    missing();
    return 0;
}
```

`range-error.s`

```text
        .export _main
_main:
        lda #300
        rts
```

`missing-setcpu.s`

```text
        .export _main
_main:
        lax $10
        rts
```

## See also

- [oscar64-reference.md](oscar64-reference.md) — primary toolchain; most C64 code should start here
- [kickassembler-reference.md](kickassembler-reference.md) — cycle-tight assembly escape hatch
- [recipes/cc65/hello-world-conio.md](../recipes/cc65/hello-world-conio.md) — minimal working cc65 program
- [memory-layout-planning.md](memory-layout-planning.md) — whole-program layout: the constraints, one worked layout in all three toolchains, confirmed from `--mapfile`
- [release-disk.md](release-disk.md) — putting the built PRG on a bootable D64 with c1541, proving it boots by autostarting the image headless, and a Makefile target that does both
