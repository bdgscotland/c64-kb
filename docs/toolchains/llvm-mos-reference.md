---
tool: llvm-mos
tool_kind: c-compiler
maintainer: llvm-mos
license: Apache-2.0 WITH LLVM-exception
home_url: https://github.com/llvm-mos/llvm-mos-sdk
version_verified: "v23.2.0"
---

<!-- doc-type: toolchain-reference -->

# llvm-mos — Clang/LLVM for the 6502, C64 target

## Tool

llvm-mos is a fork of LLVM with a 6502 back end; the llvm-mos SDK packages
the compiler (`clang`, `ld.lld`, the binutils) with C libraries, headers
and linker scripts for many 6502 machines (one directory each under
`mos-platform/`). For the C64 it is a
third C compiler beside [cc65](cc65-reference.md) and
[Oscar64](oscar64-reference.md): C and C++ (the SDK's examples include
both) from a current Clang front end, whole-program link-time optimisation, and a PRG as output.

Everything marked "measured" was run on 2026-09-24 with SDK release
v23.2.0 (published 2026-09-06), whose `mos-c64-clang --version` reports
`clang version 24.0.0git (https://github.com/llvm-mos/llvm-mos 9e5efd81…)`,
on macOS arm64, and VICE x64sc 3.10 headless (`-default` PAL and
`-model ntsc`). No recipe in this knowledge base uses llvm-mos yet.
`check:listings` builds this page's C listing with `mos-c64-clang -Os`
when it finds the SDK (`LLVM_MOS`, PATH, or `~/Developer/c64/llvm-mos`);
an earlier version of this page said it built no llvm-mos code, which was
true before issue #102.

**Targets:** 6510

## Quick reference

The release's `llvm-mos-macos.tar.xz` holds universal binaries (x86_64
and arm64, per `file`); Linux and Windows archives sit beside it. No
build is needed:

```text
curl -LO https://github.com/llvm-mos/llvm-mos-sdk/releases/download/v23.2.0/llvm-mos-macos.tar.xz
tar xJf llvm-mos-macos.tar.xz            # unpacks to llvm-mos/
llvm-mos/bin/mos-c64-clang -Os -o hello.prg hello.c
```

The archive was 174,854,328 bytes, SHA-256
`ef71b9b8f5a91f0b0b44ba7975036ec1ffeda385b7528fd6ca0a88fd7cbf5813`.
`mos-c64-clang` is `clang` with `bin/mos-c64.cfg`, which adds the C64
include and library paths, `-D__C64__` and `-mlto-zp=110`, then includes
the shared Commodore configuration.

A hello world, measured: 206 bytes at `-Os`, `-O2` and `-Oz` alike. Run
headless on PAL and NTSC, both exit screenshots show border colour index
2 at pixel (2, 100) and `hello, world!` on screen row 7, in the
lower/upper-case character set (see Startup and exit).

```c
// hello.c - llvm-mos SDK v23.2.0, mos-c64-clang
#include <c64.h>
#include <stdio.h>

int main(void) {
  VIC.bordercolor = COLOR_RED;
  printf("hello, world!\n");
  return 0;
}
```

## Build pipeline

### .C — C source

**Consumed by:** llvm-mos

### .PRG — Program file (executable)

**Produced by:** llvm-mos

The linker script `mos-platform/c64/lib/link.ld` writes the load address
`$0801`, a BASIC line `SYS 2061`, then the program, trimmed at its last
byte. Beside it the linker leaves `<name>.prg.elf`, which
`llvm-mos/bin/llvm-objdump -d` disassembles with symbol names; that is how
the startup below was read.

## Startup and exit

Read from the disassembly of the measured hello world:

| Step | What the code does |
|---|---|
| `_start` | `$00` = `$2F`, `$01` = `$3E`: BASIC ROM out, KERNAL and I/O in (`unmap-basic.o`) |
| soft stack | `$02`/`$03` = `$D000`; the C stack grows down from under the I/O area (`__stack = 0xD000` in `link.ld`) |
| before `main` | `lda #$0E` / `jsr $FFD2`: CHROUT of `$0E` switches the screen to the lower/upper-case character set |
| `putchar` | ASCII to PETSCII on the way to CHROUT: `a`-`z` become `$41`-`$5A`, `A`-`Z` become `$C1`-`$DA`, `\n` becomes `$0D` |
| `exit` | `$01` = `$3F`, then `jmp *` |

Three consequences, all measured with this build:

- **`return` from `main` does not return to BASIC.** `exit` ends in a
  loop on itself; no `READY.` appears, even at 20,000,000 cycles. The
  linker script lets the program use BASIC's zero page (`$02`-`$8F`) and
  RAM freely, so BASIC could not resume anyway.
- **The whole screen changes character set** at startup, the BASIC
  banner included. A program that draws with upper-case PETSCII graphics
  must print `$8E` or set `$D018` itself.
- **`$01` is left at `$3F` on exit, not `$37`.** Bit 3 (cassette write
  line) is set.

Memory, from `link.ld`: region `ram` is `$0801`, length `$C7FF`, so code,
data and BSS end below `$D000`, shared with the soft stack
(`__stack_reserve_size` `$400`). The KERNAL's own zero page and vectors are
left alone (the comment at the top of `link.ld`). `-mlto-zp=110` lets link-time optimisation place up to 110
bytes of variables in zero page.

## Headers

`mos-platform/c64/include/c64.h` is cc65's `c64.h`, modified (its header
says so). It defines `VIC`, `SID`, `CIA1`, `CIA2` as `volatile` structs at
`$D000`, `$D400`, `$DC00`, `$DD00`, and `COLOR_RAM` at `$D800`. The VIC
field names are cc65's: `bordercolor`, `bgcolor0`, `ctrl1`,
`rasterline`, `spr_ena`, and so on (`_vic2.h`). `cbm.h` in
`mos-platform/commodore/include/` carries the KERNAL wrappers shared by the
Commodore targets.

## Pitfalls

Each was measured with v23.2.0.

- **Undocumented opcodes need `-mcpu=mos6502x`.** `__asm__ volatile
  ("lax $fb")` fails with `instruction requires: Feature6502XOrDTV`; with
  `-mcpu=mos6502x` it builds.
- **Inline-assembly errors surface at link time.** With whole-program
  LTO the assembler runs inside `ld.lld`, so the message is prefixed
  `ld.lld: error: ld-temp.o <inline asm>:` and names no C file or line.
- **Unused data vanishes.** A 60,000-byte static array written once and
  read back at a constant index linked into a 56-byte PRG: LTO folded it
  away. Declare such an array `volatile` (or use it for real) before
  judging whether it fits.

## Reading the errors

Every message below came from `mos-c64-clang -Os -o out.prg <file>` with
v23.2.0; each run exited 1 and wrote no PRG.

| Message (verbatim) | Source | Cause | Fix |
|---|---|---|---|
| `ld.lld: error: undefined symbol: missing` then `>>> referenced by ld-temp.o` / `>>> undef.prg.lto.o:(main)` | a call to a function declared and never defined | The definition is in no file on the command line | Add the `.c` to the command |
| `error: no member named 'border' in 'struct __vic2'` | `VIC.border = 2` | The VIC struct uses cc65's names | `VIC.bordercolor` |
| `ld.lld: error: ld-temp.o <inline asm>:1:2: invalid instruction, any one of the following would fix this:` | `__asm__ volatile ("ldq #1")` | Not a 6502 mnemonic; the following notes list operand fixes that do not apply | Fix the mnemonic |
| `ld.lld: error: ld-temp.o <inline asm>:1:2: instruction requires: Feature6502XOrDTV` | `__asm__ volatile ("lax $fb")` | An undocumented opcode on the default CPU | `-mcpu=mos6502x` |
| `ld.lld: error: section '.bss' will not fit in region 'ram': overflowed by 8917 bytes` | a `static volatile char big[60000]` | BSS past `$CFFF` | Shrink the data, or place it under the I/O area yourself |

Each linker failure ends with `mos-c64-clang: error: ld.lld command
failed with exit code 1 (use -v to see invocation)`.

## See also

- [cc65-reference.md](cc65-reference.md): the compiler whose `c64.h` this
  SDK adapts.
- [oscar64-reference.md](oscar64-reference.md): the C compiler the
  recipes use.
- [../runtime/vice-reference.md](../runtime/vice-reference.md): the
  screenshot geometry and palette the hello world was measured with.
