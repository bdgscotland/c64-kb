---
tool: acme
tool_kind: assembler
maintainer: Marco Baye
license: GPL-2.0-or-later
home_url: https://sourceforge.net/projects/acme-crossass/
version_verified: "0.97"
---

<!-- doc-type: toolchain-reference -->

# ACME — 6502 cross-assembler

## Tool

ACME is a portable command-line cross-assembler for the 6502 family,
maintained by Marco Baye. It has no script language; it has macros, loops,
conditional assembly, zones for local labels, and output as a CBM
`.PRG` (two-byte load address) or a flat binary. Much published C64 source
is ACME: Doynamite's depacker, Exomizer's `acme` decruncher copy, many
demo-group sources. This page exists so an agent can build such a source,
or port it to KickAssembler, without guessing at the syntax.

Everything marked "measured" was run on 2026-09-24 with ACME 0.97
("Zem", 28 June 2020) from Homebrew on macOS arm64, and VICE x64sc 3.10
headless (`-default` PAL and `-model ntsc`). Claims marked "manual" come
from the documentation Homebrew installs with it (`QuickRef.txt`,
`AllPOs.txt`, `Errors.txt` under `share/doc/acme/`).

**Targets:** 6510

## Quick reference

```text
brew install acme                     # 0.97 on this machine
acme -f cbm -o hello.prg hello.a      # PRG with load address
acme -v1 hello.a                      # uses the !to line in the source; prints the address range
acme -f cbm -o hello.prg --vicelabels hello.lbl -r hello.lst hello.a
```

A hello world that prints a line and colours the border red. Measured:
it assembles to 50 bytes (ACME's `-v1` reports "Saving 48 (0x30) bytes
(0x801 - 0x831 exclusive)", the load address not counted); run headless
on PAL and NTSC, both exit screenshots show `HELLO, WORLD!` decoded from
screen row 8 against the character ROM, and border colour index 2 at
pixel (2, 100).

```acme
; hello.a - ACME 0.97: BASIC line 10 SYS 2061, print a string, colour the border
        !cpu 6510               ; 6502 opcodes plus the undocumented ones
        !to "hello.prg", cbm    ; cbm = two-byte load address first

        * = $0801
        !word basic_end         ; link to the next BASIC line
        !word 10                ; line number 10
        !byte $9e               ; SYS token
        !text "2061"            ; the address, as PETSCII digits
        !byte 0
basic_end
        !word 0                 ; end of program

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

message !pet 13, "hello, world!", 0
```

ACME has no `BasicUpstart` macro; the upstart is the eleven bytes above.
`!pet` with lower-case source text prints upper case on the power-on
character set (see Text encodings).

## Build pipeline

### .A — ACME assembly source

**Consumed by:** acme

The extension is a convention (the manual's examples use `.a`); ACME
reads any name.

### .PRG — Program file (executable)

**Produced by:** acme

`-f cbm`, or a `!to "name", cbm` line, writes the load address first.
`-f plain`, and `-o` given without `-f`, write the bytes only (measured:
`* = $c000` / `nop` with `-o` alone gives the one byte `EA`; with
`-f cbm`, `00 C0 EA`). `-f apple` is the third format.

When the source has a `!to` line and the command line has `-o`, the
command line wins, format included: `acme -o other.bin hello.a` warns
`Output file already chosen.` at the `!to` line and writes `other.bin`
with no load address (it starts `0B 08`, the BASIC link), not
`hello.prg`. Give `-f cbm` with every `-o`.

### .LBL — VICE label file

**Produced by:** acme

`--vicelabels file` writes one `al C:addr .name` line per label, the
format VICE's monitor loads with `ll "file"`. Measured for the hello
world: `al C:0822 .message`, `al C:080d .start`, `al C:080b .basic_end`.

`-r file` writes a listing (source line, address, bytes, source text);
`-l file` a symbol list in ACME's own `name = $value` form.

## Command line

| Flag | Effect (from `acme --help`, checked where marked) |
|---|---|
| `-f`, `--format` | `plain`, `cbm`, `apple` (a bogus name lists them; measured) |
| `-o`, `--outfile` | Output file |
| `-r`, `--report` | Listing file |
| `-l`, `--symbollist` | Symbol list |
| `--vicelabels` | VICE monitor labels |
| `--setpc` | Start address, as `* =` in the source |
| `--cpu` | `6502`, `nmos6502`, `6510`, `65c02`, `r65c02`, `w65c02`, `65816`, `65ce02`, `4502`, `m65`, `c64dtv2` (listed by a bogus name; measured). Default `6502` |
| `--strict-segments` | Segment overlap becomes an error (measured: exit 1) |
| `-DSYMBOL=VALUE` | Define a global symbol |
| `-I dir` | Search path for `!source` and `!binary` |
| `-v1` to `-v3` | Report the output range, then passes and segments, then files |
| `--maxerrors` | Errors before stopping (default 10, manual) |
| `-Wtype-mismatch` | Warn when an address symbol is used as an immediate |

## Syntax for a KickAssembler reader

Each row was assembled on 0.97 unless it says "manual".

| Thing | ACME | KickAssembler |
|---|---|---|
| Comment | `;` or `//` (both measured) | `//` only; `;` is not a comment |
| Two statements on a line | `txa : pha` (measured: `8A 48`) | not allowed |
| Pseudo-op prefix | `!` (`!byte`, `!word`, `!fill`, `!align`) | `.` |
| Set the PC | `* = $1000` | `*=$1000` or `.pc` |
| Label | name in column 1, no colon | `name:` |
| Local label | `.name` inside a `!zone` or macro; `@name` between two global labels (both measured: two zones each with a `.loop`) | labels inside a `{ }` scope |
| Anonymous labels | `-` / `--` backward, `+` / `++` forward | `!` with `!-` / `!+` |
| Macro | `!macro poke .addr, .val { … }`, called `+poke $d020, 2` | `.macro poke(addr, val) { … }`, called `poke($d020, 2)` |
| Loop | `!for i, 0, 3 { … }` (0 to 3 inclusive; measured `00 02 04 06` for `!byte i * 2`) | `.for (var i=0; i<4; i++)` |
| Conditional | `!if DEBUG = 1 { … } else { … }` (`=` compares) | `.if (DEBUG == 1)` |
| Include source | `!source "file.a"` (`!src`) | `#import "file.asm"` |
| Include binary | `!binary "file.prg", , 2` skips a load address (`!bin`; measured) | `.import binary "file.prg", 2` |
| Code for another address | `!pseudopc $c000 { … }` (measured: `jmp` inside assembles to `4C 00 C0` at `$1000`) | `.pseudopc $c000 { … }` |
| Undocumented opcodes | need `!cpu 6510` | always available |
| Symbol case | case-sensitive (manual) | case-sensitive |

`!align and, equal [, fill]` pads until `(* & and) = equal`, and the
default fill is `$EA`, not zero: `!align 255, 0` after code filled with
`EA` bytes (measured). Pass the third argument when the padding is data.

## Text encodings

`!text` (and `!tx`, `!raw`) writes the source bytes unchanged. `!pet`
converts ASCII to PETSCII and `!scr` to screen codes. Measured on the
string `"Ab"`:

| Directive | Bytes | On the power-on (upper case) set |
|---|---|---|
| `!text "Ab"` | `41 62` | `A` then a graphics character |
| `!pet "Ab"` | `C1 42` | a graphics character then `B` |
| `!scr "Ab"` | `41 02` | a graphics character then `B` |

So write lower case in the source to get upper case on screen. Source
capitals map to the shifted codes, which show as graphics until the
character set is switched to lower case. The `!text "2061"` in the hello
world is safe because digits are the same in ASCII and PETSCII.

## Pitfalls

Each was measured on 0.97.

- **An undocumented opcode without `!cpu 6510` is a syntax error, and the
  first message blames the label column.** `lax $fb` gives
  `Warning - … Label name not in leftmost column.` then
  `Error - … Syntax error.`: ACME read `lax` as an indented label. The same
  pair appears for any misspelt mnemonic and for a macro called without
  its `+`.
- **A zero-page symbol defined after its use assembles as absolute.**
  `lda later` with `later = $fb` further down gives `AD FB 00` (three bytes,
  four cycles) and `Warning - … Using oversized addressing mode.` The
  program works but is a byte and a cycle longer per use; in a timed
  raster loop that moves every later write. Define zero-page symbols
  before the code, or read the warning.
- **Leading zeros force absolute addressing on purpose.** `lda $00fb`
  gives `AD FB 00`; `lda $fb` gives `A5 FB`. `--ignore-zeroes` turns this
  off (manual). Use it deliberately for a cycle-exact absolute access.
- **Overlapping segments are only a warning.** `* = $1008` inside a
  16-byte `!fill` at `$1000` prints `Segment starts inside another one,
  overwriting it.`, exits 0, and the `NOP` replaces the ninth fill byte.
  Build with `--strict-segments` so it fails.
- **`-o` alone writes no load address, even over a `!to …, cbm` line.**
  Without `-f cbm` the file is a flat binary; VICE's autostart and
  `LOAD"…",8,1` read its first two code bytes as the address. The only
  sign is the warning `Output file already chosen.` when the source also
  has `!to`.
- **`(label),y` with a non-zero-page label is refused**, unlike
  KickAssembler, which assembles it silently (`CLAUDE.md`, gotchas):
  `Error - … Number out of range.`

## Reading the errors

Every message was provoked with ACME 0.97, `acme -o out.bin <file>`, on the
source named in the second column (files in `error-sources/acme/`). A
message reads `Error - File <file>, line <n> (Zone <zone>): <text>`; a
serious error reads `Serious error - …` and stops assembly at once. Errors
exit 1 and write no output file; warnings exit 0.

| Message (verbatim text after the location) | Source | Cause | Fix |
|---|---|---|---|
| `Value not defined (missing).` | `undefined-symbol.a` | The symbol is never defined, or is a `.local` used outside its zone | Define it, or fix the zone |
| `Target out of range (-203; 75 too far).` | `branch-out-of-range.a` | A branch target 203 bytes back; the reach is -128 to +127 | Invert the branch over a `jmp` |
| `Label name not in leftmost column.` (warning) then `Syntax error.` | `unknown-mnemonic.a`, `illegal-opcode-without-cpu.a`, `macro-without-plus.a` | An unknown word in the mnemonic column is taken for a label: a typo, an undocumented opcode without `!cpu 6510`, or a macro call without `+` | Fix the word, add `!cpu 6510`, or write `+name` |
| `Number out of range.` | `immediate-out-of-range.a`, `indirect-not-zero-page.a` | `lda #256`; or `(ptr),y` where `ptr` is not a zero-page address | Mask with `<`; put the pointer in zero page |
| `Serious error - … Found end-of-file instead of '}'.` | `missing-brace.a` | A `!macro`, `!for`, `!if` or `!zone` block not closed | Close the block |
| `Symbol already defined.` | `duplicate-symbol.a` | The same global label twice | Rename, or make one local with `.` inside a `!zone` |
| `Segment starts inside another one, overwriting it.` (warning, exit 0) | `segment-overlap.a` | A `* =` into bytes already written | Move the segment; build with `--strict-segments` |
| `Using oversized addressing mode.` (warning, exit 0) | `forward-zero-page.a` | A zero-page symbol defined after its first use | Define it earlier |
| `Output file already chosen.` (warning, exit 0) | the hello world with `-o` | `-o` on the command line overrides the source's `!to`, and its format with it | Add `-f cbm`, or drop `-o` |

## See also

- [kickassembler-reference.md](kickassembler-reference.md): the assembler
  the recipes use; its "Reading the errors" table is the model here.
- [64tass-reference.md](64tass-reference.md): the other common
  third-party syntax.
- [../hardware/6502-illegal-opcodes.md](../hardware/6502-illegal-opcodes.md):
  the undocumented opcodes `!cpu 6510` enables and their ACME spellings.
- [../runtime/vice-reference.md](../runtime/vice-reference.md): the
  screenshot geometry and palette the hello world was measured with.
