---
tool: petcat
tool_kind: asset-converter
maintainer: VICE team
license: GPL-2.0-or-later
home_url: https://vice-emu.sourceforge.io/
version_verified: "3.10"
---

<!-- doc-type: toolchain-reference -->

# petcat: BASIC v2 text to a tokenised PRG, and back

## Tool

petcat turns BASIC source typed on the host into the tokenised form the
C64's BASIC interpreter runs, and lists a tokenised PRG back as text. It
ships with VICE (the README lists it as "a CBM BASIC de-tokenizer") and
is on this machine at `/opt/homebrew/bin/petcat`. `petcat -version`
prints `petcat (VICE 3.10)`. Everything marked "run here" was done with
that build on 2026-09-23.

A game needs it in two places. The BASIC stub at `$0801` that every
auto-running PRG starts with (`10 SYS2061` and the like) can be written
as one line of text and tokenised, instead of being hand-assembled as
bytes. And a whole BASIC loader or menu, with colour and cursor control
codes in its strings, can live in the repository as readable text and be
built by `make`. Control codes are written as named macros in braces
(`{clr}`, `{wht}`), so the source needs no unprintable bytes.

The licence in the frontmatter is VICE's, read from
`/opt/homebrew/opt/vice/COPYING` (GPL version 2 with the "any later
version" clause). petcat is a build tool; its output PRG carries none of
its code.

**Targets:** 6510

## Build pipeline

Input is plain text on the host, one BASIC line per text line, each
starting with its line number. petcat has no fixed extension for it;
`.bas` is used below. Output is a PRG with a two-byte load address.

### .PRG — Program file (executable)
**Produced by:** petcat
**Consumed by:** petcat, vice

Tokenised BASIC in the C64's own memory layout: for each line a two-byte
link to the next line, a two-byte line number, the line's bytes with
keywords replaced by one-byte tokens (`$80` and up), a zero, and after the
last line two more zeros. The byte layout is in
[c64-file-formats](../formats/c64-file-formats.md), ".PRG"; the stub
arithmetic is `crunched_data_in_basic_stub` in
[loaders-packers](../techniques/loaders-packers.md).

## Command line

```text
petcat -w2 -l 0801 -o stub.prg -- stub.bas     # tokenise BASIC v2 text to a PRG at $0801
petcat -2 -o stub.lst -- stub.prg              # list a PRG back as text, macros in braces
petcat -2 -- stub.prg                          # the same to stdout, with a ";file ==0801==" header
petcat -2 -nc -- stub.prg                      # list without control-code macros
petcat -k2                                     # print the BASIC v2 keyword table
```

| Flag | Meaning (from `petcat -help`, exercised here where the text says so) |
|---|---|
| `-w<version>` | Tokenise ("write") with the keyword set of a BASIC version. `-w2` is BASIC v2.0, the C64's. With no `-w` petcat lists. |
| `-<version>` | List a PRG using that version's keywords; `-2` for the C64. The help text says the default set is v7.0 (C128); what a C128-only token byte lists as under each setting was not measured here. |
| `-l <hex>` | Load address, hex digits only (`0801`, not `$0801` or `0x0801`). Run here: with no `-l` and `-w2` the output still started `01 08`, so `$0801` is the default for the C64 version. Pass it anyway; the file says what you meant. |
| `-o <name>` | Output file. Without it the listing goes to stdout with a header line; `-nh` drops the header and is the default when writing to a file. |
| `-c`, `-nc` | Interpret control codes as brace macros when listing (default in text mode), or print none of them. |
| `-ic` | Match macro names case-insensitively. Run here: `{CLR}` tokenised to `$93` with and without `-ic` on this build, so what `-ic` changes was not established here. |
| `-qc` | Turn every non-alphanumeric character inside quotes into a control code on listing. Not run here. |
| `-skip <n>` | Skip `n` bytes at the start of the input. Not run here. |
| `-k<version>`, `-k` | Print the keyword table for a version, or the list of versions. |
| `--` | Ends the options; the file list follows. Use it so a file name starting with `-` is not read as a flag. |

## Control-code macros

Inside a quoted string the text `{name}` becomes one PETSCII control byte.
Run here: the line below tokenised to exactly the bytes in the third
column, in this order, and listed back as the same names.

```text
10 print "{clr}{home}{up}{down}{left}{rght}{rvon}{rvof}{blk}{wht}{red}{cyn}{pur}{grn}{blu}{yel}{lblu}{gry1}{lred}{orng}"
```

| Macro | Effect | Byte |
|---|---|---|
| `{clr}` | Clear screen, cursor home | `$93` |
| `{home}` | Cursor home | `$13` |
| `{up}` `{down}` `{left}` `{rght}` | Cursor moves | `$91` `$11` `$9D` `$1D` |
| `{rvon}` `{rvof}` | Reverse video on, off | `$12` `$92` |
| `{blk}` `{wht}` `{red}` `{cyn}` | Text colour 0 to 3 | `$90` `$05` `$1C` `$9F` |
| `{pur}` `{grn}` `{blu}` `{yel}` | Text colour 4 to 7 | `$9C` `$1E` `$1F` `$9E` |
| `{orng}` `{lred}` `{gry1}` `{lblu}` | Text colour 8, 10, 11, 14 | `$81` `$96` `$97` `$9A` |

petcat knows more names than this table (the full set is in its source,
`src/petcat.c` in the VICE tree, not read here). A name it does not know
is a hard error: run here, `{foo}` in a string stopped the build with
`unknown control code` and exit 255, and the output file was left holding
only the two load-address bytes. This is the opposite of an unknown
keyword, which passes through as text. See Pitfalls for both.

## The load address rule

`-l` sets the two bytes at the front of the file and nothing else. The
line links inside the file are absolute addresses, and petcat computes
them from the load address, so a file tokenised with `-l 0801` has its
first link at `$081A` when the first line is 25 bytes long (run here, the
stub below). Tokenise for the address the program will be loaded to.
BASIC's own `LOAD` from direct mode recomputes the links afterwards (the
ROM's relink routine; from the ROM's design, not measured here), so a
wrong `-l` is often forgiven there. A file pulled in by a machine-code
loader, or a stub that a packer's depacker rebuilds, gets no such repair.
A `SYS` stub that only ever runs from `$0801` needs `-l 0801` and nothing
else.

## Worked example, run here

The source, `stub.bas`. Lowercase throughout (see Pitfalls):

```text
10 print "{clr}{wht}petcat stub ok"
20 poke 767,42
30 print peek(767)
40 goto 40
```

`petcat -w2 -l 0801 -o stub.prg -- stub.bas` exited 0 and wrote 64 bytes.
A hand count agrees: 2 (load address) + 25 (line 10: link 2, number 2,
`print` token `$99`, the space, the quote, `$93`, `$05`, 14 text bytes,
the quote, the zero) + 13 (line 20) + 13 (line 30) + 9 (line 40) + 2
(end marker) = 64. The links in the file are `$081A`, `$0827`, `$0834`,
`$083D`, each the previous link plus that line's length. `peek` is token
`$C2`, `poke` `$97`, `goto` `$89`. The space after a keyword is kept as
`$20`, as the C64's own tokeniser keeps it.

Run with the pinned command at 5,000,000 cycles, PAL and NTSC:

```text
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 5000000 -exitscreenshot stub.png -autostart stub.prg
```

Measured from the PNGs with the char-ROM decoder: row 0 reads
`PETCAT STUB OK`, row 1 reads ` 42` (the leading space is BASIC's sign
position), and the rest of the screen is background, so `{clr}` ran.
The text pixels are `(255,255,255)`, white, on both models; without
`{wht}` the default text colour is light blue. Two runs per model gave
byte-identical PNGs.

De-tokenising: `petcat -2 -o back.bas -- stub.prg`, then `diff stub.bas
back.bas`. Every line differs, and only in one way: petcat right-aligns
the line number in a five-character field, so each line gains three
leading spaces. With the leading spaces stripped the two files are
identical: the macro names come back as `{clr}` and `{wht}`, lowercase,
and the keywords and the string text are lowercase as they went in.
`-nc` lists the same program with the two control bytes dropped from the
string.

An unknown keyword: `10 frobnicate 5` tokenised with exit 0 and no
message. The PRG holds the letters as plain PETSCII text (`46 52 4F 42
...`), because to petcat a word that is not a keyword is text, exactly as
it is to the C64's line editor. Run in VICE, the program printed
`?SYNTAX  ERROR IN 10`. petcat does not check syntax; the emulator does.

The version flags on one keyword: `10 color 0,1` under `-w2` became
`43 4F 4C B0`, the letters `COL` followed by the v2 token for `or`
(`$B0`), because the tokeniser replaces the first keyword it can match
inside any run of letters, as the C64 does. Under `-w3` (BASIC 3.5) the
same line became the single token `$E7`. A C64 given the `-w3` file would
read `$E7` as a token it has no keyword for. Use `-w2` for the C64, always.

## Build integration

The stub is one text file, tokenised once, and the machine code is
appended after it. Run here: `10 sys 2304` tokenised to a 15-byte file
(13 bytes of stub at `$0801` to `$080D`, so the first free byte is
`$080E`); KickAssembler
assembled a 15-byte program at `$0900` with no `BasicUpstart`; a build
step wrote the stub file, then 242 zero bytes, then the code file minus
its two-byte load address, 270 bytes in all; VICE autostarted it and the
border turned green (`(98,213,50)` in the PAL PNG), the code's own
verdict colour. The same three steps as a Makefile; `make game.prg` with
this file produced a `game.prg` byte-identical to the hand-built one
(run here, GNU make 3.81 on macOS). The first line matters: when petcat
refuses a file it still writes a two-byte `stub.prg` with only the load
address in it, and without `.DELETE_ON_ERROR:` make keeps that file as
up to date, so the next `make game.prg` builds a 270-byte program with no
BASIC in it and no error. Run here both ways: with the guard, a bad stub
failed twice in a row and left no `stub.prg`; without it, the second run
built `game.prg` from the empty stub.

```makefile
.DELETE_ON_ERROR:
PETCAT  ?= petcat
KICKASS ?= java -jar $(KICKASS_JAR)
CODE_AT := 0x0900

stub.prg: stub.bas
	$(PETCAT) -w2 -l 0801 -o $@ -- $<

code.prg: code.asm
	$(KICKASS) $< -o $@

game.prg: stub.prg code.prg
	python3 -c 's=open("stub.prg","rb").read(); c=open("code.prg","rb").read(); pad=$(CODE_AT)-(0x0801+len(s)-2); open("game.prg","wb").write(s+bytes(pad)+c[2:])'
```

The padding is the gap between the stub's last byte and the code's
origin; it must not be negative, and `CODE_AT` must equal the `* =` in
the assembly source and the number after `sys` in the stub. Keep the
three in one place. The same rule serves Oscar64 output built with a
raw origin, but Oscar64 already emits its own SYS stub for the `c64`
target ([oscar64-reference](oscar64-reference.md), ".PRG"), so it only
needs petcat when the loader is a BASIC program in its own right.

The alternative for KickAssembler projects is `BasicUpstart2(label)`
([kickassembler-reference](kickassembler-reference.md)), which emits the
stub from inside the assembly source. petcat earns its place when the
stub is more than one `SYS`: a loader that prints a title in colour,
asks a question, pokes a setting, and then calls the code.

## Pitfalls

**Keywords and text must be lowercase.** petcat maps lowercase host
letters to unshifted PETSCII, the letters the C64 shows as capitals in
its default character set, and uppercase host letters to shifted PETSCII
(`$C1` and up). Run here: `10 PRINT "HELLO"` tokenised to `D0 D2 C9 CE
D4` outside the quotes, five shifted letters and no `print` token; listed
back, petcat printed the `$C9` as `right$`. And `print "{clr}HELLO
hello"` drew screen codes 72, 69, 76, 76, 79 for `HELLO`, which are
graphics symbols in the default set, and 8, 5, 12, 12, 15 for `hello`,
the letters. Write the whole file in lowercase unless a shifted symbol is
wanted.

**Shifted and graphics characters.** An uppercase host letter is the way
to get a shifted letter: the graphics symbol on that key's right face in
the default set, the capital letter once the lowercase set is switched
in. The switch bytes have names: `{swlc}` is `$0E` (lowercase set) and
`{swuc}` is `$8E` (uppercase set). A byte petcat has no name for is
written `{$61}`, a hex escape. Run here: a PRG holding `0E 8E 61` in a
string listed as `{swlc}{swuc}{$61}`, and that text tokenised back to the
same three bytes. The names for the other graphics characters were not
exercised here; `-k` lists versions, not macros, so list an existing PRG
that uses them with `-2` and copy the names it prints, or fall back to
the hex escape.

**Unknown keywords pass silently.** A misspelt keyword becomes text, the
file tokenises with exit 0, and the failure is `?SYNTAX ERROR` at run
time. Run the PRG in VICE and read the screen.

**Unknown macro names stop the build.** A `{name}` petcat has no entry
for is an error, not text. Run here: `10 print "{foo}x"` gave
`Error: line 10 - unknown control code: foo}x"` on stderr and exit 255,
and the output file held two bytes, the load address and nothing after
it. A build script that does not check petcat's exit status, or a make
rule without `.DELETE_ON_ERROR:`, will carry that two-byte file forward
as if it were the program (see Build integration). Check the name against
a listing petcat itself produced, or use the `{$xx}` hex escape.

**Keywords hide inside names.** `color` tokenised as `COL` plus the `or`
token under `-w2`; a variable named `tone` or `format` will meet the same
rule. This is the C64's own behaviour, so petcat is right to do it, but
the listing will not look like the source.

**Line length.** petcat imposed no limit that was met here: a line with a
90-character string tokenised to 103 bytes and ran, printing all 90
characters. The C64's screen editor accepts a logical line of 80
characters (two screen rows), so such a line cannot be re-entered by
typing after a `LIST`; that limit is from the machine's design and was
not measured here. Keep loader lines under 80 characters if anyone will
edit them on the machine.

**The listing is not the source.** A de-tokenised file has the line
number padded to five columns. Strip leading spaces before a diff, or
compare the PRG bytes from two tokenisations instead.

**`-l` takes bare hex.** `-l $0801` and `-l 0x0801` are not the same
argument as `-l 0801`; the help text says "no leading chars". Not
measured here what petcat does with them.

## See also

- `crunched_data_in_basic_stub` in [loaders-packers](../techniques/loaders-packers.md): the stub's byte layout and what it costs.
- [kickassembler-reference](kickassembler-reference.md): `BasicUpstart2`, the in-source alternative.
- [release-disk](release-disk.md): putting the finished PRG on a `.d64` with c1541, from the same VICE install.
- [c64-file-formats](../formats/c64-file-formats.md): the `.PRG` layout.
