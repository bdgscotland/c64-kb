---
tool: cc1541
tool_kind: asset-converter
maintainer: PTV_Claus
license: MIT
home_url: https://bitbucket.org/PTV_Claus/cc1541/src/master/
version_verified: "4.2"
---

<!-- doc-type: toolchain-reference -->

# cc1541: D64 images with directory art and controlled sector placement

## Tool

cc1541 writes `.d64`, `.d71` and `.d81` disk images from the host, with
control over things c1541 leaves to the drive ROM: the exact PETSCII
bytes of a file name, the file type byte, the block count shown in the
directory, directory entries that own no data, and the track and sector
every block of a file lands on. Its README names JackAsser as the
original author, with later work by Krill, Claus and Björn Esser, and
the licence file is MIT. It is a build tool; the image it writes carries
none of its code.

It was built here from source on 2026-09-23 with `make` (a single C99
file, `cc1541.c`, no dependencies) into `/tmp/c64kb-tools/cc1541/`. The
binary announces itself as `cc1541 version 4.2`. The official
repository is on Bitbucket at the `home_url` above; an anonymous `git
clone` of it asked for credentials on this machine, so the build used
the GitHub mirror `rtlprmft/cc1541` (its README calls it "a fork of the
bitbucket repository"), commit `d9e21c9` of 2026-06-19, whose
`cc1541.c` defines `VERSION "4.2"`. Everything marked "run here" was
done with that binary.

Two jobs bring it into a game's build. Directory art: a directory that
draws a title, a box or a picture when the player types `LOAD"$",8`
and `LIST`, made of entries whose names are PETSCII graphics and whose
type is DEL, so they load nothing. Loader-friendly placement: a custom
loader that reads sectors in an order it chooses wants the file's
blocks laid out to match, which `-s`, `-e`, `-b` and `-r` set per file.

**Targets:** 6510

## Build pipeline

Input is any host file; the `.prg` two-byte load address is written to
the disk as data, as the drive would. Output is a disk image, created
if it does not exist and extended if it does.

### .D64 — 1541 disk image
**Produced by:** cc1541, c1541
**Consumed by:** vice, c1541, cc1541

The 174,848-byte 35-track image whose field tables are in
[c64-file-formats](../formats/c64-file-formats.md), "Disk Images".
Everything cc1541 does to the directory is visible in the 32-byte
entries described there, and the "As decoded" section below reads them
back.

## Command line

The commands used for the worked example, run here:

```text
cc1541 -n "dir art" -i "26" \
  -f "#b0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#ae" -T DEL -L \
  -f "#dd  DEMO  2026  #dd" -T DEL -L \
  -f "#dd cc1541 v4.2 #dd" -T DEL -B 42 -L \
  -f "#ad#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#bd" -T DEL -L \
  -f "#a0#a0#a0#a0#a0#a0#a0#a0#a0#a0#a0#a0#a0#a0#a0#a0" -T DEL -L \
  -f "game#a0,8,1" -w game.prg \
  -f "level1" -s 3 -w level1.prg \
  -f "level2" -e -w level2.prg \
  art.d64
cc1541 art.d64          # list the directory
cc1541 -a art.d64       # print the options that would recreate this directory
cc1541 -h               # the full option list
```

The `-i "26"` above is deliberate: it is the form that produced the
header line discussed under Pitfalls, and `cc1541 -a art.d64` prints it
back as `-i "26"`. A separate one-file image built with `-i "26 2a"`
(`id.d64`) put `32 36 20 32 41` at `$A2` to `$A6`.

| Flag | Meaning (from `cc1541 -h`, exercised here where the text says so) |
|---|---|
| `-n name`, `-i id` | Disk name and ID. `-i` takes the whole five-byte field after the name: the two ID characters, a space and the two DOS-type characters, default `00 2a`. Run here: `-i "26"` alone left the DOS-type bytes at `$A5` and `$A6` as `$A0 $A0`, and `-i "26 2a"` wrote `32 36 20 32 41` at `$A2` to `$A6`. c1541's own format writes `32 36 A0 32 41`: the ID and DOS-type bytes match, and the separator at `$A4` is `$20` from cc1541 where c1541 puts `$A0`. See Pitfalls. |
| `-f name` | The PETSCII name for the next file. `#xx` (two hex digits) inserts any byte; see the escape table. Run here: names shorter than 16 bytes were padded with `$A0`. |
| `-w file` | Write a host file under that name. |
| `-T type` | `PRG`, `SEQ`, `USR`, `REL`, `DEL` or a decimal 0 to 255 written straight into the type byte. Run here: `DEL` stored `$80`. |
| `-L` | Make a directory entry with no data; the help says track and sector will be 0. Run here: `$00 $00` at `$03`, block count 0 unless `-B` is given. Needs `-f`. |
| `-B n` | Write `n` as the block count. Run here: `-B 42` put `$2A $00` at `$1E`. |
| `-P`, `-O` | Set the write-protect bit or the open (unclosed) bit of the type byte. Not run here. |
| `-l name` | A second directory entry pointing at an existing file's blocks. Not run here. |
| `-N`, `-o` | Force a new entry when the name already exists, or refuse to overwrite. `-a` emits `-N` before every entry (run here). |
| `-S n`, `-s n` | Default sector interleave (10) and the interleave for the next file. The help says the `-s` value falls back to the `-S` default after the first sector of that file; the chain measured below held it for every block. |
| `-e`, `-E`, `-r t`, `-b s`, `-F n` | Placement: start on an empty track; try to keep the file on one track; do not go below track `t`; start at sector `s`; first sector on a new track. `-e` and `-b` measured below. |
| `-t`, `-u n`, `-x` | Use the directory track for data, how many directory blocks to keep free when doing so, and do not split a file across the directory track. Not run here. |
| `-a` | Print a command line that recreates the directory of an existing image. Run here on `art.d64`; it printed every entry as `-T 128 -N -f "..." -L` and the file entries as `-L` with their block counts, so it is a directory importer, not a file extractor. It prints every byte outside plain ASCII as a `#xx` escape (`DEMO` came back as `#c4#c5#cd#cf`) and drops trailing `$A0` padding (the all-padding name came back as a single `#a0`): the bytes it recreates are the same, the spelling is not. `-X` extracts files. |
| `-U n` | Print names as Unicode graphics. Not run here. |
| `-4`, `-5`, `-d`, `-g`, `-H`, `-p` | 40-track BAM styles, shadow directory, additional G64 output, hidden BAM message, binary patch at track/sector/offset. Not run here. |
| `-M`, `-m`, `-W`, `-A`, `-K` | Krill's loader file-name hashing and Transwarp files. Not run here. |

## The escape syntax

Inside `-f`, `#` followed by two hex digits is one PETSCII byte. Every
other character is one byte too, with the host's case mapped the way
petcat maps it: a lowercase host letter becomes an unshifted PETSCII
letter (`$41` to `$5A`, a capital in the C64's default character set)
and an uppercase host letter becomes a shifted one (`$C1` to `$DA`, a
graphics symbol in that set). Run here: `game` was stored `47 41 4D
45` and `DEMO` was stored `C4 C5 CD CF`. Names are not case-folded, so
spell an ordinary file name in lowercase.

The escapes used in the worked example, with the screen code the drive's
listing produced for each (PETSCII `$C0` to `$DF` land on screen codes
`$40` to `$5F`; `$A0` to `$BF` on `$60` to `$7F`), read from the
emulator's screen against the character ROM:

| Escape | PETSCII | Screen code | Draws |
|---|---|---|---|
| `#c0` | `$C0` | `$40` | horizontal bar (shifted `*`) |
| `#dd` | `$DD` | `$5D` | vertical bar (shifted `-`) |
| `#b0` | `$B0` | `$70` | top-left corner (Commodore `A`) |
| `#ae` | `$AE` | `$6E` | top-right corner (Commodore `S`) |
| `#ad` | `$AD` | `$6D` | bottom-left corner (Commodore `Z`) |
| `#bd` | `$BD` | `$7D` | bottom-right corner (Commodore `X`) |
| `#a0` | `$A0` | none | the padding byte; the listing turns it into a closing quote, see below |

The key names in the last column are what an outside reference would
call these symbols and were not checked against a keyboard here; the
bytes and screen codes were measured.

## As decoded

The image was read on the host with this script, which prints every
directory entry's type byte, first track and sector, name bytes and
block count, and follows each file's block chain:

```text
img = open('art.d64', 'rb').read()
SPT = [21]*17 + [19]*7 + [18]*6 + [17]*5
def blk(t, s):
    return img[(sum(SPT[:t-1]) + s) * 256:][:256]
t, s = 18, 1
while t:
    b = blk(t, s)
    for i in range(8):
        e = b[i*32:(i+1)*32]
        if e[2] == 0 and e[0x1e] == 0: continue
        print(i, 'type %02x' % e[2], 'ts', e[3], e[4],
              e[5:0x15].hex(' '), 'blocks', e[0x1e] | e[0x1f] << 8)
        t2, s2 = e[3], e[4]; chain = []
        while t2:
            chain.append((t2, s2)); nb = blk(t2, s2); t2, s2 = nb[0], nb[1]
        if chain: print('  chain', chain)
    t, s = b[0], b[1]
```

Run here, the eight entries of block 18/1 (one block; its link was
`$00 $FF`):

| Entry | `$02` type | `$03-$04` | Name bytes (`$05-$14`) | `$1E-$1F` blocks |
|---|---|---|---|---|
| 0 | `$80` | `0 0` | `B0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 AE` | 0 |
| 1 | `$80` | `0 0` | `DD 20 20 C4 C5 CD CF 20 20 32 30 32 36 20 20 DD` | 0 |
| 2 | `$80` | `0 0` | `DD 20 43 43 31 35 34 31 20 56 34 2E 32 20 DD A0` | 42 |
| 3 | `$80` | `0 0` | `AD C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 C0 BD` | 0 |
| 4 | `$80` | `0 0` | `A0 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0` | 0 |
| 5 | `$82` | `1 0` | `47 41 4D 45 A0 2C 38 2C 31 A0 A0 A0 A0 A0 A0 A0` | 1 |
| 6 | `$82` | `1 10` | `4C 45 56 45 4C 31 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0` | 4 |
| 7 | `$82` | `2 1` | `4C 45 56 45 4C 32 A0 A0 A0 A0 A0 A0 A0 A0 A0 A0` | 4 |

So the three tricks are three fields. `-T DEL` is the type byte `$80`:
DEL (0) with the closed bit (`$80`) set, the value `-a` prints back as
`-T 128`. `-L` is a first-block pointer of `0 0` and no blocks
allocated: the BAM still reported 655 blocks free with five art entries
on the disk, the count a freshly formatted disk has after 9 blocks (1
for the game, 8 for the two 1,000-byte files) are taken. `-B` is the
16-bit count at `$1E`; nothing checks it against the chain. The `$A0`
trick is in the name bytes alone: `-f "game#a0,8,1"` stores `GAME`,
one `$A0`, then `,8,1` and the padding.

Entry 2's name was 15 characters, so the sixteenth byte is the `$A0`
padding; entry 4 is sixteen bytes of padding and nothing else.

## What the drive's listing shows

Run here: the image was attached to the windowless x64sc build of VICE
3.10 (`-drive8truedrive`, PAL, `-warp`, 20,000,000 cycles) and
`-keybuf` typed `load"$",8` then `list`. Two runs gave byte-identical
PNGs. Decoded against the character ROM, the eight directory rows read:

```text
0    "<box top>       " DEL
0    "|  ....  2026  |" DEL      the four dots are shifted D E M O, graphics in this set
42   "| CC1541 V4.2 |"  DEL
0    "<box bottom>    " DEL
0    ""                 DEL
1    "GAME",8,1         PRG
4    "LEVEL1"           PRG
4    "LEVEL2"           PRG
655 BLOCKS FREE.
```

Three things the listing does, all measured from that screen:

- The closing quote is placed at the first `$A0` in the name, and every
  later byte is printed after the quote with `$A0` shown as a space. That
  is why `"GAME",8,1` appears with the `,8,1` outside the quotes and why
  the all-`$A0` name prints as `""` followed by spaces: the name field
  is blank, the line is not. The DOS's own rule for this was not read
  here; the behaviour was.
- The type column does not move. Entry 2's quote closed one cell early
  and the `DEL` still sat at the same column as its neighbours (screen
  column 24 in every row).
- A `DEL` entry lists like any other, with its block count and the
  type name `DEL`. `LOAD"<name>",8` on one was not run here.

`c1541 -attach art.d64 -list` and `cc1541 art.d64` print the same eight
rows with the same block counts; both render the graphics bytes as
ASCII stand-ins (c1541 printed `.` for every one; cc1541's default
mapping printed `.`, `@` and `]`), so the emulator screen is the only
one of the three that shows the art.

## Interleave and placement

The default interleave is 10, and a file's chain wraps within the
track: run here on a fresh image, a 1,000-byte file after a one-block
file at 1/0 was laid out 1/10, 1/20, 1/9, 1/19 (20 + 10 = 30, less the
21 sectors of track 1, is 9). `-s 3` before `-w` made the same file
1/10, 1/13, 1/16, 1/19, so `-s` governs the whole of the next file, not
only its first step; a following file without `-s` went back to steps
of 10 (run here on a third image). The help text says the value falls
back to the `-S` default after the first sector of the next file; the
chain measured here held it for all four blocks, so the measurement
stands over the text. `-e` moved the next file to track 2;
its first sector was 1, which is the previous file's last sector 19 plus
that file's interleave 3, wrapped, consistent with the help's "current
sector plus interleave" (arithmetic; the rule was not read from the
source). `-b 0` with `-e` put it at 2/0 (run here). `-E`, `-r`, `-F`,
`-t`, `-x` and `-S` were not run here. A loader that expects a fixed
layout should be given the same flags in the same order every build;
cc1541 places files in argument order, so reordering the arguments
reorders the disk.

## Build integration

Directory art belongs in the makefile, not in a hand-edited image,
because every rebuild of the game file rewrites the image. One rule
does it, and `cc1541 -a` on an image an artist made turns that art into
the `-f ... -L` arguments for the rule (run here: `-a` on `art.d64`
gave back the five art entries' bytes, with every non-ASCII byte as a
`#xx` escape and the trailing `$A0` padding dropped). Keep the art lines
in a shell variable or a file the rule reads, and put the art entries
before the `-w` files so they lead the directory.

```makefile
CC1541 ?= /tmp/c64kb-tools/cc1541/cc1541
ART = -f "#b0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#ae" -T DEL -L \
      -f "#dd  demo  2026  #dd" -T DEL -L \
      -f "#ad#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#c0#bd" -T DEL -L

game.d64: game.prg level1.prg level2.prg
	rm -f $@
	$(CC1541) -n "game" -i "26 2a" $(ART) -f "game#a0,8,1" -w game.prg -f level1 -w level1.prg -f level2 -w level2.prg $@
```

The `rm -f` matters: cc1541 adds to an existing image, so without it
every `make` appends a second copy of each entry (the `-o` flag refuses
duplicates instead, not run here). The image is a plain file, so
[release-disk](release-disk.md)'s checks apply to it unchanged, and
`c1541 -list` is a cheap gate that the entries are where the rule put
them.

## Pitfalls

**`-i` is five bytes, not two.** `-i "26"` writes the ID and leaves the
DOS-type bytes at `$A5` and `$A6` as `$A0 $A0`. Run here: the drive's
header line then ended `26  1` on the emulated 1541 where a
c1541-formatted control disk ended `26 2A`; where that `1` comes from
was not established here. `-i "26 2a"` wrote `32 36 20 32 41` at `$A2`
to `$A6`; c1541's format writes `32 36 A0 32 41`, so the ID and
DOS-type bytes match and only the separator at `$A4` differs, `$20`
from cc1541 where the drive and c1541 put `$A0`. That byte does not
show: run here, the cc1541 image and the c1541 control disk listed the
header row cell for cell the same, `0 "dir art         " 26 2a`.

**Host case is PETSCII shift.** `-f "DEMO"` is four graphics symbols in
the default character set; `-f "demo"` is the word. Run here, both ways
(entry 1 above). The same rule as petcat's, for the same reason.

**A name shorter than 16 is `$A0`-padded, and the listing closes the
quote at the first `$A0`.** So an art line that should reach the right
edge of the name field must be exactly 16 bytes; entry 2 above was 15
and its quote closed a cell early.

**`-L` entries own no blocks, and `-B` is not checked.** A DEL art line
with `-B 42` shows 42 blocks and holds none; the free count is
unaffected (655 with five such entries, run here). A loader that trusts
the directory's block count for a real file should not be given `-B`.

**cc1541 appends.** Running the same command twice on one image gives
every entry twice (from the help: `-N` forces a new entry, `-o` refuses
an overwrite). Delete or `rm -f` the image in the rule.

**The picture is only on the machine.** c1541 and cc1541 both print the
graphics bytes as ASCII stand-ins. Judge art in the emulator with
`LOAD"$",8` and `LIST`, as above.

## See also

- [c64-file-formats](../formats/c64-file-formats.md): the D64 directory entry and BAM field tables these bytes were read against.
- [release-disk](release-disk.md): putting a finished PRG on a `.d64` with c1541, from the VICE install.
- [petcat-reference](petcat-reference.md): the same lowercase-is-unshifted rule for BASIC text.
- [dos-error-codes](../recipes/kickassembler/dos-error-codes.md): reading the drive's status channel from a program.
