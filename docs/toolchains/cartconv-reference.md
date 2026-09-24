---
tool: cartconv
tool_kind: asset-converter
maintainer: VICE team
license: GPL-2.0-or-later
home_url: https://vice-emu.sourceforge.io/
version_verified: "3.10"
---

<!-- doc-type: toolchain-reference -->

# cartconv: raw ROM binaries to a .CRT cartridge image, and back

## Tool

cartconv wraps a raw ROM binary in the `.CRT` container that VICE, the
EasyFlash tools and most cartridge hardware menus read, and unwraps a
`.CRT` back to a binary. It ships with VICE and is on this machine at
`/opt/homebrew/bin/cartconv`. `cartconv --version` prints
`cartconv (VICE 3.10)`. Everything marked "run here" was done with that
build on 2026-09-23, booting the results in the windowless x64sc 3.10.

A game needs it when its code is assembled or compiled as a flat ROM
image and the emulator or the flash tool wants the container: the
header names the hardware type, and from that VICE decides which bank
register to emulate. The other route is to emit the `.CRT` from the
assembler itself, as the two KickAssembler cartridge recipes do;
cartconv is then the checker (`-c`) and the inspector (`-f`).

The licence in the frontmatter is VICE's, read from
`/opt/homebrew/opt/vice/COPYING` (GPL version 2 with the "any later
version" clause). cartconv is a build tool; the output carries none of
its code.

**Targets:** 6510

## Build pipeline

Input is a raw binary with no load address (what KickAssembler's
`outBin` and Oscar64's `-tf=bin` write) or a PRG whose two-byte load
address cartconv strips. Output is a `.CRT`: a 64-byte header and one
`CHIP` packet per 8 KB or 16 KB of ROM. The reverse direction (`-t bin`)
concatenates the packets' data back into a binary.

### .CRT — Cartridge image
**Produced by:** cartconv, kickassembler, oscar64
**Consumed by:** cartconv, vice

Header, then CHIP packets. The layout as decoded here is under "The
file, as decoded"; the reference table is in
[c64-file-formats](../formats/c64-file-formats.md), ".CRT".

### .BIN — Raw ROM image
**Produced by:** kickassembler, oscar64, cartconv
**Consumed by:** cartconv

The bytes of the ROM in bank order, nothing else. For a banked type
the file is bank 0's 8 KB, then bank 1's, and so on.

## Command line

```text
cartconv -t normal -l 0x8000 -i bank0.bin -o normal.crt -n "NORMAL 8K"   # generic 8 KB, type 0
cartconv -p -t md -i banks.bin -o md.crt -n "MAGIC DESK"                  # Magic Desk, type 19
cartconv -p -t ocean -i banks.bin -o ocean.crt -n "OCEAN"                 # Ocean, type 5
cartconv -f md.crt                                                        # print header and packet table
cartconv -c md.crt                                                        # check; exit 0 when sound (and when the file is missing)
cartconv -t bin -i md.crt -o md.bin                                       # unwrap to a raw binary
cartconv --types                                                          # the type table with each name and id
```

| Flag | Meaning (from `cartconv` with no arguments, exercised here where the text says so) |
|---|---|
| `-t <type>` | Output type, by short name or by `.CRT` hardware id (`md` or `19`). Run here with `normal`, `md`, `ocean`, `easy`. Without `-t` cartconv expects a `.crt` input and unwraps it to a binary; a raw binary given without `-t` is refused with `File is already in binary format` (run here). The `(Default bin->crt)` note in `--types` names the hardware type a binary becomes once `-t normal` or its id is given, not what happens when `-t` is omitted. |
| `-i`, `-o` | Input and output file names. |
| `-n <name>` | The 32-byte cartridge name field. Run here: written as given (case kept), zero-padded to 32 bytes. |
| `-l <addr>` | Load address of the input, decimal or `0x` hex. Run here with `0x8000` for the 8 KB type. Not run here without it. |
| `-p` | Accept an input whose size is not one of the type's sizes. Run here: a 16 KB binary was refused by `md`, `ocean` and `easy` with "Input file size (16384) doesn't match ... requirements", and accepted with `-p`. A 32 KB binary was accepted by `md` and `ocean` without it. |
| `-b` | Write every bank, including all-`$FF` ones. Run here on a 32 KB Magic Desk input: the file was byte-identical with and without `-b`, so the two empty banks were kept either way at this size. |
| `-s <rev>` | Hardware revision, the subtype byte. Run here with `-s 1` on `easy`: the version field became 1.01 and byte `$1A` became 1. |
| `-f <file>` | Print the header, the mode the EXROM and GAME bytes select, and one line per CHIP packet. |
| `-c <file>` | Check a `.CRT`. Run here: exit 0 on every file this page built, and also when the file cannot be opened (`Error: Can't open` is printed but the status is 0), so check the file exists before trusting the status. |
| `-r` | Repair mode: accept a broken input. Not run here. |
| `-q`, `-v` | Quiet, verbose. |
| `--options-file` | Write the options that reverse the conversion. Not run here. |

## Type table

Ids and short names are cartconv's own (`--types`, run here). The bank
register and the bank size are measured only where the row says so: the
program in "Boot results" wrote the register from RAM and read a marker
byte back from the new bank.

| Type | Id | Short name | Bank register | Bank at `$8000` | Rung |
|---|---|---|---|---|---|
| Generic 8 KB / 16 KB | 0 | `normal` | none | 8 KB, or 16 KB with `$A000` | measured: a write to `$DE00` changed nothing |
| Ocean | 5 | `ocean` | `$DE00` | 8 KB, and the same 8 KB seen at `$A000` | measured in VICE with a 32 KB image; larger Ocean images not measured here |
| Magic Desk | 19 | `md` | `$DE00` | 8 KB | measured; the bit that switches the ROM off is not measured here |
| EasyFlash | 32 | `easy` | `$DE00`, mode in `$DE02` | 8 KB ROML plus 8 KB ROMH per bank | from `cartridge_bank_easyflash` in [memory-banking](../techniques/memory-banking.md) and the `easyflash-save` recipe, not measured here |
| Magic Desk 16K | 85 | `md16` | not measured here | 16 KB | cartconv's table only |
| C64 Games System | 15 | `gs` | not measured here | not measured here | cartconv's table only |
| GMod2 | 60 | `gmod2` | not measured here | not measured here | cartconv's table only |
| Action Replay V5 | 1 | `ar5` | not measured here | not measured here | cartconv's table only |
| Final Cartridge III | 3 | `fc3` | not measured here | not measured here | cartconv's table only |
| Retro Replay | 36 | `rr` | not measured here | not measured here | cartconv's table only |

`ulti` (Ultimax, 4, 8 or 16 KB) has no id of its own: it is type 0 with
EXROM high and GAME low.

## The file, as decoded

Every `.CRT` this page built was read with the script below and with
`cartconv -f`, and the two agreed on every field.

```text
import struct, sys
for path in sys.argv[1:]:
    d = open(path, "rb").read()
    hlen, ver, hw, exrom, game = struct.unpack(">IHHBB", d[16:26])
    name = d[32:64].split(b"\0")[0].decode("ascii", "replace")
    print(path, len(d), d[0:16], hlen, f"{ver>>8}.{ver&255:02d}", hw, exrom, game, name)
    off = hlen
    while off + 16 <= len(d):
        plen, ctype, bank, load, size = struct.unpack(">IHHHH", d[off+4:off+16])
        print(f"  CHIP@{off:#x} {d[off:off+4]} len {plen} type {ctype} bank {bank}"
              f" load ${load:04X} size {size} first {d[off+16]:02X} last {d[off+16+size-1]:02X}")
        off += plen
```

Header, 64 bytes, every multi-byte field big-endian:

| Offset | Size | Field | Run here |
|---|---|---|---|
| `$00` | 16 | `C64 CARTRIDGE` and three spaces | every file |
| `$10` | 4 | header length | `$40` in every file |
| `$14` | 2 | version | `$0100` (1.00); `$0101` after `-s 1` |
| `$16` | 2 | hardware type | 0, 5, 19, 32 as ordered |
| `$18` | 1 | EXROM line level, 0 low | 0 for types 0, 5, 19; 1 for cartconv's EasyFlash |
| `$19` | 1 | GAME line level, 0 low | 1 for types 0 (8 KB) and 19; 0 for type 5 and cartconv's EasyFlash |
| `$1A` | 1 | hardware revision (subtype), 0 unless `-s` | 0; 1 after `-s 1`, which `-f` prints as "Hardware Revision: 1" |
| `$1B` | 5 | reserved | zero |
| `$20` | 32 | name, zero-padded | as given to `-n`, or `OSCAR` from Oscar64 |

CHIP packet, 16 bytes then the data:

| Offset | Size | Field | Run here |
|---|---|---|---|
| `$00` | 4 | `CHIP` | every packet |
| `$04` | 4 | packet length including these 16 bytes | `$2010` for 8 KB, `$4010` for 16 KB |
| `$08` | 2 | chip type: 0 ROM, 1 RAM, 2 flash | 0 from cartconv for types 0, 5, 19 and from Oscar64 for every target; 2 from cartconv for `easy` |
| `$0A` | 2 | bank number | 0, 1, 2, 3 in order for the banked types |
| `$0C` | 2 | load address | `$8000`; `$A000` for cartconv's EasyFlash ROMH; `$E000` for Oscar64's |
| `$0E` | 2 | data size | `$2000`, or `$4000` for Oscar64's `crt16` |

Sizes seen: 8,272 bytes for one 8 KB packet (64 + 8,208); 32,896 for
Magic Desk and Ocean from a 16 KB input, because cartconv padded the
image to four banks and wrote all four; 16,480 for EasyFlash from the
same input, split into bank 0 ROML at `$8000` and bank 0 ROMH at `$A000`.

## Boot results

One program, two 8 KB banks (the `crt-banked` recipe's listing, with
`outBin` writing the raw banks instead of the container). Bank 0 boots
through the `CBM80` signature, prints the marker byte it sees at `$9FFF`
and the byte at `$BFFF`, copies a routine to `$0334`, and that routine
writes 1 to `$DE00`, calls a routine at `$9FF0` in the new bank, reads
`$9FFF` and `$BFFF`, and writes 0 back. Bank 1's routine turns the border
green. Bank 0's marker is `$B0`, bank 1's `$B1`. Each file was booted
with `x64sc -default -warp +sound -limitcycles 4000000 -exitscreenshot
out.png -cartcrt file.crt`; VICE picked the hardware from the header,
with no per-type option. The text was read from the PNG with the
char-ROM decoder.

| File | Line 1 | Line 2 | Border | Reading |
|---|---|---|---|---|
| `normal.crt` (type 0, 8 KB) | `BANK 0 BYTE B0 HI E0` | `BANK 1 BYTE B0 HI E0` | red | the `$DE00` write changed nothing; `$BFFF` is BASIC ROM (`$E0`) |
| `md.crt` (type 19) | `BANK 0 BYTE B0 HI E0` | `BANK 1 BYTE B1 HI E0` | green | `$DE00` = 1 put bank 1 at `$8000`; `$A000` stayed BASIC: 8 KB mode |
| `ocean.crt` (type 5) | `BANK 0 BYTE B0 HI B0` | `BANK 1 BYTE B1 HI B1` | green | `$DE00` = 1 switched both windows; `$BFFF` reads the same bank as `$9FFF`, so VICE mirrors the 8 KB bank at `$A000` for this image size |
| `easy.crt` (type 32, from the same binary with `-p`) | none | none | orange screen | no program: EasyFlash boots in Ultimax mode from bank 0 ROMH at `$E000`, and this binary's second 8 KB is bank 1's ROML, not a ROMH with a reset vector |

The red border on the generic type is the program's own failure path:
the marker did not change, so the switch did not happen, which is the
correct result for a cartridge with no bank register. The EasyFlash row
is a statement about the input layout, not about cartconv or the type:
a working EasyFlash image is built in the `easyflash-save` recipe.

Oscar64's own containers, from a program that sets the border green and
loops: `-tf=crt8` wrote type 0, EXROM 0, GAME 1, one 8 KB packet;
`-tf=crt16` wrote type 0, EXROM 0, GAME 0, one 16 KB packet; `-tf=crt`
wrote type 32 with EXROM 0, GAME 0, bank 0 ROML at `$8000` and bank 0
ROMH at `$E000`, both chip type 0. `crt8` and `crt` booted green in
x64sc; `crt16` was not booted here. The EasyFlash headers differ:
cartconv writes EXROM 1, GAME 0 and chip type 2 for the same
hardware id. VICE booted both. Which one a flash tool prefers was not
measured here.

## Build integration

**KickAssembler.** Two routes. Emit the banks as raw binaries with
`.segmentdef Bank0 [start=$8000, min=$8000, max=$9fff, fill,
fillByte=$ff]` per bank, gather them in bank order with `.segmentout`
into a segment with `outBin="banks.bin"`, and run cartconv. Or write
the container from the source: a `Crt` segment starting at 0 with
`outBin="name.crt"` that lays down the 64-byte header, then for each
bank a 16-byte `CHIP` packet followed by `.segmentout
[segments="BankN"]`. The `crt-banked` and `easyflash-save` recipes do
the second; the verifier here boots those files directly, so a recipe's
listing must take that route. KickAssembler 5.25 has no cartridge
directive: `.crt` and `.bank` both stop the assembler with `Invalid
directive` (run here). An earlier version of the formats page said it
produced `.CRT` files through those two directives; it does not.

**Oscar64.** `-tf=crt8` and `-tf=crt16` write a generic type 0
container; `-tf=crt` writes EasyFlash, with `-cid`, `-csub` and `-cname`
to override the id, subtype and name
([oscar64-reference](oscar64-reference.md), "CLI flags" and "Memory
layout and banking"). No cartconv step is needed; `cartconv -f` still
reads the result, and `-t bin` unwraps it when a flash tool wants the
raw image.

**Checking.** `cartconv -c` exits 0 on a sound file. Run here on three
damaged copies: a bank 16 bytes short of its packet header's claim, and a
file cut off before its last bank, both exited 255 with `this file seems
broken`; a packet length larger than the data that follows it only
printed `chunk length exceeds data size` and exited 0, so read the
output as well as the status. It also exits 0 when it cannot open the
file (run here), so a script should test that the file exists first.
`cartconv -f` prints what VICE will see. Run both on any hand-emitted container before
blaming the emulator: a wrong packet length makes the next `CHIP`
signature land in the wrong place, and VICE's error names the offset.

## Pitfalls

**The input size must match the type, or pass `-p`.** Run here: 16 KB
was refused by `md`, `ocean` and `easy`. The refusal names the size and
the type. With `-p` cartconv pads to the next size in its table, so the
file is bigger than the code: 32,896 bytes for two banks of Magic Desk.

**A banked binary is bank order, not address order.** Bank 1's 8 KB
follows bank 0's in the file even though both map at `$8000`. For
EasyFlash the order is bank 0 ROML, bank 0 ROMH, bank 1 ROML, and so on
(from the `-p easy` split, run here, and the `easyflash-save` recipe).
Feeding a Magic Desk layout to `easy` produces a file that checks clean
and does not boot.

**Code that switches banks cannot run from the bank it switches out.**
The routine that writes `$DE00` must be in RAM or in a bank that stays
mapped. The measurement program copies it to `$0334`.

**`-t` names are short and unlike the hardware names.** `md` is Magic
Desk, `easy` is EasyFlash, `normal` is the generic type; `--types`
prints the whole table. A number works too, and it is the `.CRT`
hardware id, so `-t 19` and `-t md` are the same request.

## See also

- [crt-banked](../recipes/kickassembler/crt-banked.md): the two-bank Magic Desk program above, emitting its own `.CRT`.
- [easyflash-save](../recipes/kickassembler/easyflash-save.md): an EasyFlash container with a ROMH boot bank, written from KickAssembler.
- `cartridge_bank_easyflash` in [memory-banking](../techniques/memory-banking.md): the EasyFlash registers.
- [oscar64-reference](oscar64-reference.md): `-tf=crt`, `-cid`, `-csub`, `-cname` and `__bankof`.
- [c64-file-formats](../formats/c64-file-formats.md): the `.CRT` field tables.
