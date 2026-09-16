---
tool: cc65
tool_kind: c-compiler
maintainer: cc65-team
license: Zlib
home_url: https://cc65.github.io/
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
| `-T` | Keep intermediate `.s` and `.o` files for inspection |

The `-Cl` flag places local variables in BSS rather than on the software stack.
This cuts call overhead noticeably but breaks reentrancy. Acceptable for most
C64 code where recursion is deliberate and bounded.

For multi-file projects, name each `.c` and `.s` source on the command line and
`cl65` links them in one pass:

```bash
cl65 -O -t c64 -Cl -o game.prg main.c sprite.c irq.s
```

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
- **Anything that needs bitfields or packed structs** — cc65 supports bitfields
  only for int-sized-or-smaller types and with several restrictions; Oscar64
  treats them as first-class.
- **Code-size-sensitive releases** — cc65 produces larger binaries for
  equivalent logic. On a platform with 38 KB of usable RAM, this matters.

The rule of thumb: if Oscar64 has a clear idiom for the task (see
[oscar64-reference.md](oscar64-reference.md)), use Oscar64. Reach for cc65 only
when the corpus availability advantage is concrete and measurable.

## Linker configs

`ld65` is driven by a linker configuration file that describes the target's
memory map, segments, and output format. The cc65 distribution ships a
ready-made config for the C64 at `cfg/c64.cfg`. For most programs, the
`-t c64` flag loads this config automatically.

The built-in config maps the standard segments:

- `CODE` — starts at `$0801` (after the BASIC stub)
- `RODATA` — read-only data, placed after CODE
- `DATA` — initialized writable data
- `BSS` — zero-initialised (cleared at startup by the runtime)
- `ZEROPAGE` — zero-page variables (limited; allocate sparingly)

For non-standard layouts — cartridges, custom load addresses, split-bank
programs — write a custom `.cfg` file and pass it with `--config`. The
linker config language is well-documented in the cc65 `ld65` manual and
the existing `cfg/c64.cfg` is a readable starting template.

## Idioms — cc65 vs Oscar64

cc65 and Oscar64 differ in ways that matter at the codegen level. The agent
should recognize these patterns to avoid inadvertently reaching for the weaker
option.

**Function call overhead.** cc65 uses a software stack in zero page for
passing arguments. Each call pushes and pops arguments through this stack,
adding several cycles per parameter. Oscar64 uses register-based calling
conventions and performs whole-function optimization; inner loops are
substantially cheaper. If a function is called in a tight raster IRQ or per-
scanline loop, the cc65 overhead accumulates into missed raster windows.

**Bitfields.** Oscar64 supports bitfields in structs natively and maps them
to efficient read-modify-write sequences. cc65 supports them with restrictions
(int-sized or smaller) and the codegen is less predictable. Writing a hardware
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

## Pitfalls

**Static initializers in ROM sections.** The cc65 `DATA` segment holds
initialized writable data. If a custom linker config accidentally places `DATA`
in a ROM region, initialized globals silently read back as zeros at runtime.
Always verify the segment map with `--mapfile` output.

**Stack overflow with deep call trees.** cc65's software stack lives in zero
page and is small by default (typically 256 bytes). Recursive functions or
deep call chains overflow it silently, corrupting zero-page state. Keep call
depth shallow; use iterative algorithms where recursion would naturally arise.
The `-Cl` flag mitigates this by promoting locals out of the stack, but does
not protect against deep recursion itself.

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

## See also

- [oscar64-reference.md](oscar64-reference.md) — primary toolchain; most C64 code should start here
- [kickassembler-reference.md](kickassembler-reference.md) — cycle-tight assembly escape hatch
- [recipes/cc65/hello-world-conio.md](../recipes/cc65/hello-world-conio.md) — minimal working cc65 program
