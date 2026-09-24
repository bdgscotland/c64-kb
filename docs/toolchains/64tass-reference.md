---
tool: 64tass
tool_kind: assembler
maintainer: soci (Zsolt Kajtar)
license: GPL-2.0-or-later
home_url: https://sourceforge.net/projects/tass64/
version_verified: "1.60.3243"
---

<!-- doc-type: toolchain-reference -->

# 64tass — 6502 cross-assembler (Turbo Assembler syntax)

## Tool

64tass is a multi-pass cross-assembler that accepts the syntax of Turbo
Assembler, the native C64 assembler most 1980s and 1990s sources were
written in, and extends it with scopes, macros, loops, typed
expressions and many output formats. Commented reverse-engineered game
sources (mwenge's Uridium, Iridis Alpha and Gridrunner, in
[../game-design/reference-game-sources.md](../game-design/reference-game-sources.md))
build with it. This page exists so an agent can build such a source, or
port it to KickAssembler, without guessing.

Everything marked "measured" was run on 2026-09-24 with 64tass
1.60.3243 (`64tass Turbo Assembler Macro V1.60.3243`, Homebrew formula
`tass64`) on macOS arm64, and VICE x64sc 3.10 headless (`-default` PAL
and `-model ntsc`). Flag descriptions not marked come from `64tass --help`.

**Targets:** 6510

## Quick reference

```text
brew install tass64                        # installs the 64tass binary
64tass -a -o hello.prg hello.s             # ASCII source, PRG with load address
64tass -a -i -o hello.prg hello.s          # also accept undocumented opcodes
64tass -a -o hello.prg -L hello.lst --vice-labels -l hello.lbl hello.s
```

Always pass `-a` for a source written on a modern machine: without it
64tass treats the source as PETSCII and copies text bytes unchanged (see
Text encodings).

A hello world that prints a line and colours the border red. Measured:
built with `-a` it is 48 bytes of data, `$0801` to `$0830` by 64tass's
summary line, plus the load address; run headless on PAL and NTSC,
both exit screenshots show `HELLO, WORLD!` decoded from screen row 8 against the character ROM, and border colour index 2 at pixel
(2, 100). Built without `-a`, the same source prints nine graphics
characters, a comma, five more and `!` on row 7 on both models: the
`{cr}` escape was copied as four characters and the lower-case letters
were not converted.

```64tass
; hello.s - 64tass 1.60: BASIC line 10 SYS 2061, print a string, colour the border
        * = $0801
        .word basic_end         ; link to the next BASIC line
        .word 10                ; line number 10
        .byte $9e               ; SYS token
        .text "2061"            ; the address as digits
        .byte 0
basic_end
        .word 0                 ; end of program

start   ; = $080d = 2061
        lda #2                  ; red border
        sta $d020
        ldx #0
-       lda message,x
        beq +
        jsr $ffd2               ; CHROUT
        inx
        bne -
+       jmp *

message .null "{cr}hello, world!"
```

`.null` appends the zero byte. `{cr}` is one of 64tass's named PETSCII
escapes, honoured only under `-a`.

## Build pipeline

### .S — 64tass assembly source

**Consumed by:** 64tass

The extension is a convention; `.asm` and `.tas` are common too.

### .PRG — Program file (executable)

**Produced by:** 64tass

The default output is a CBM program with the load address first
(measured: `* = $c000` / `nop` gives `00 C0 EA`). `-b` strips the
address (measured: `EA`); `--intel-hex`, `--s-record` and others are
listed by `--help`. Space reserved at the end of the program with
`.fill n` and no value is not written: a source ending in `.fill 3`
produced a file that stops before those bytes (measured). Space between
two parts of the program is written as zero bytes, including the padding
of `.align` (measured).

### .LBL — VICE label file

**Produced by:** 64tass

`--vice-labels -l file` writes `al addr .name` lines for VICE's monitor
(`ll "file"`). Measured for the hello world: `al 822 .message`,
`al 80d .start`, `al 80b .basic_end` (no `C:` prefix and no leading
zero, unlike ACME's). `-L file` writes a listing with addresses, bytes,
disassembly and source.

## Command line

| Flag | Effect |
|---|---|
| `-a`, `--ascii` | Source is ASCII: convert text to PETSCII and honour `{…}` escapes |
| `-o file` | Output file |
| `-b`, `--nostart` | No load address |
| `-i`, `--m6502` | NMOS 6502 with the undocumented opcodes (measured: `lax $fb` gives `A7 FB`) |
| `--m65xx` | Documented opcodes only; the default |
| `-C`, `--case-sensitive` | Case-sensitive symbols; off by default |
| `-B`, `--long-branch` | Rewrite an out-of-range branch as the inverse branch over a `jmp` (measured: `bne` 203 bytes back became `F0 03 4C 00 10`) |
| `-D name=value` | Define a symbol |
| `-I dir` | Search path for `.include` and `.binary` |
| `-L file`, `-l file` | Listing; labels |
| `--vice-labels` | Write the `-l` file in VICE format |
| `-Wall`, `-Werror` | More warnings; warnings as errors |
| `-q` | No banner or summary |
| `-T`, `--tasm-compatible` | "Enable TASM compatible mode" |

## Syntax for a KickAssembler reader

Each row marked measured was assembled on 1.60.3243.

| Thing | 64tass | KickAssembler |
|---|---|---|
| Comment | `;` only; `//` is an error (`not defined symbol 'comment'`) | `//` only |
| Two statements on a line | not allowed: `txa : pha` is an error | not allowed |
| Directive prefix | `.` (`.byte`, `.word`, `.fill`, `.text`) | `.` |
| Set the PC | `* = $1000` | `*=$1000` |
| Label | name in column 1, no colon; an indented label is accepted silently | `name:` |
| Local label | `_name` belongs to the previous plain label; names inside `.proc` … `.endproc` are private to it (both measured) | labels inside a `{ }` scope |
| Anonymous labels | `-` backward, `+` forward | `!` with `!-` / `!+` |
| Macro | `poke .macro addr, val` … `.endm`; body uses `\addr`; call `#poke $d020, 2` or `.poke $d020, 2` or bare `poke $d020, 2` (all three measured) | `.macro poke(addr, val) { … }` |
| Loop | `.for i = 0, i < 4, i += 1` … `.endfor`, or `.for i in range(4)` (both measured) | `.for (var i=0; i<4; i++)` |
| Conditional | `.if DEBUG == 1` … `.else` … `.endif` | `.if (DEBUG == 1)` |
| Include source | `.include "file.s"` | `#import "file.asm"` |
| Include binary | `.binary "file.prg", 2` skips a load address (measured) | `.import binary "file.prg", 2` |
| Code for another address | `.logical $c000` … `.endlogical` (measured: `jmp` inside gives `4C 00 C0` at `$1000`) | `.pseudopc $c000 { … }` |
| Undocumented opcodes | need `-i` | always available |
| Symbol case | case-insensitive unless `-C` (measured: `Loop` defined, `jmp loop` accepted) | case-sensitive |

## Text encodings

Measured on the string `"Ab"`:

| Build | `.text "Ab"` | after `.enc "screen"` |
|---|---|---|
| without `-a` | `41 62` | `01 42` |
| with `-a` | `C1 42` | `41 02` |

With `-a`, as in ACME's `!pet` and `!scr`, lower-case source letters become
the upper case the power-on character set shows, and source capitals
become shifted codes (graphics until the set is switched). Without `-a`,
`.text` copies the bytes unchanged, which is right only for a source
file that really is PETSCII (one saved from a C64 editor).

## Pitfalls

Each was measured on 1.60.3243.

- **No `-a` on an ASCII source.** Text is copied unconverted and `{cr}`-style
  escapes are not recognised; the hello world printed graphics on both
  models. The build succeeds with no warning.
- **Overlapping code is silent.** `* = $1008` inside a 16-byte `.fill` at
  `$1000` exits 0 with no message, even with `-Wall`, and the `NOP`
  replaces the ninth fill byte. ACME at least warns. Check a map
  (`--map=file`) when segments are placed by hand.
- **Labels are case-insensitive by default.** `Loop` and `loop` are one
  symbol; a source that relies on the difference needs `-C`, and a source
  written for 64tass may fail under `-C` (`not defined symbol 'loop'`).
- **Undocumented opcodes need `-i`.** Without it `lax $fb` is
  `error: general syntax`, which does not name the opcode.
- **Leading zeros do not force absolute addressing.** `lda $00fb` gives
  `A5 FB`, the zero-page form, unlike ACME. `-Wleading-zeros` warns about
  them. A forward-referenced zero-page symbol is also resolved to
  zero page (`lda later` with `later = $fb` defined afterwards: `A5 FB`).
  For a deliberate absolute access to zero page write `lda @w $fb`
  (measured: `AD FB 00`).
- **`jmp ($xxFF)` is caught.** `jmp ($10ff)` assembles and warns
  `possible jmp ($xxff) bug`, the NMOS indirect-jump page wrap.

## Reading the errors

Every message was provoked with 64tass 1.60.3243, `64tass -q -o out.bin
<file>`, on the source named in the second column (files in
`error-sources/64tass/`). A message reads `<file>:<line>:<column>: error:
<text>`, then the source line and a caret under the column. Errors exit 1
and write no output file.

| Message (verbatim text after the location) | Source | Cause | Fix |
|---|---|---|---|
| `error: not defined symbol 'missing'` | `undefined-symbol.s` | The symbol is never defined, or differs only in case under `-C` | Define it |
| `error: branch too far by -75 bytes` | `branch-out-of-range.s` | A branch 203 bytes back; the reach is -128 to +127 | Invert the branch over a `jmp`, or build with `-B` |
| `error: wrong type 'int'` | `unknown-mnemonic.s` | `ldq #2`: an unknown word in the mnemonic column is read as a label, and then `#2` makes no sense. The message names the operand, not the typo | Fix the mnemonic |
| `error: general syntax` | `illegal-opcode-without-cpu.s` | An undocumented opcode (`lax`) without `-i` | Add `-i` |
| `error: too large for a 8 bit unsigned integer int '256'` | `immediate-out-of-range.s` | `lda #256` | Mask with `<` |
| `error: not a direct page address bits '$1234'` | `indirect-not-zero-page.s` | `(ptr),y` with `ptr` outside zero page | Put the pointer in zero page |
| `error: duplicate definition 'x1'` then `note: original definition of 'x1' was here` | `duplicate-symbol.s` | The same label twice | Rename, or use `_name` locals |
| `error: not defined symbol 'comment'` | `slash-comment.s` | `// comment`: `//` is not a comment | Use `;` |
| `error: no 1 operand addressing mode for opcode 'txa'` | `colon-separator.s` | `txa : pha`: `:` does not separate statements | One statement per line |
| `warning: possible jmp ($xxff) bug with argument bits '$10ff' [-Wjmp-bug]` (exit 0) | `jmp-indirect-page-bug.s` | The pointer's high byte would be read from `$1000`, not `$1100` | Move the vector off a page end |
| none (exit 0) | `segment-overlap.s` | Overlapping code | Check with `--map` |

## See also

- [kickassembler-reference.md](kickassembler-reference.md): the assembler
  the recipes use.
- [acme-reference.md](acme-reference.md): the other common third-party
  syntax.
- [../hardware/6502-illegal-opcodes.md](../hardware/6502-illegal-opcodes.md):
  the opcodes `-i` enables.
- [../runtime/vice-reference.md](../runtime/vice-reference.md): the
  screenshot geometry and palette the hello world was measured with.
