---
tool: spindle
tool_kind: linker
maintainer: Linus Åkesson (lft)
license: MIT
home_url: https://linusakesson.net/software/spindle/
version_verified: "3.1"
---

<!-- doc-type: toolchain-reference -->

# Spindle: a trackmo linker and IRQ loader that builds the D64

## Tool

Spindle is Linus Åkesson's loading and linking system for trackmos. A
demo is written as parts. Each part is assembled with a small header
that names its lifecycle routines and declares the memory it touches.
`mkpef` bundles a part's code and data into a `.pef` file. `pefchain`
reads a script listing the parts in order, with a condition for ending
each one, and writes a bootable D64: the loader, the drive code, every
part crunched and scattered across the disk, and a short driver per part
that calls the routines and the loader at the right moments. At run time
the loader occupies one page of RAM and streams the next parts in while
the current one runs. The part does not call the loader; the driver
does, in an order pefchain worked out at link time.

Everything marked "run here" was done on 2026-09-23 with Spindle 3.1
built from the release archive, KickAssembler 5.25, and VICE 3.10's
windowless `x64sc` with true drive emulation of a 1541. `pefchain
--version` and every tool's usage banner print `Spindle 3.1 by lft`.

This page is the tool: the command lines, the part contract, the file
formats and the timings measured through it. The design questions (what
a part owes the next, the three ways a part ends) are
`part_lifecycle` and `transition_conditions` in
[demo-composition](../demo-design/demo-composition.md), and the
general shape of loading between parts is `multi_load_sequencing` in
[loaders-packers](../techniques/loaders-packers.md). Those pages
describe Spindle v2; the reserved memory moved in v3 and this page has
the v3 figures.

**Targets:** 6510

## Building Spindle

The release is `spindle-3.1.zip` from the home page. The `src/` tree
builds with `make` on a Unix host and needs a C compiler and the xa65
cross-assembler (`xa`), which Spindle does not ship: the Makefile
assembles the loader's bootstrap, the resident code, the drive code and
the blank part with `xa` and bakes them into C headers before the host
tools compile. Run here: `make` in `src/` with Homebrew's `xa 2.4.1`
and Apple clang as `gcc` produced `mkpef`, `pef2prg`, `pefchain`,
`spin` and `mkheader` with no warnings. The tools are self-contained
binaries; nothing installs. The archive also carries prebuilt Linux and
Windows binaries, the `spindle-handbook.pdf` the facts below are taken
from, a `template/effect.s` in xa syntax, and four examples.

`xa` is only needed to build Spindle. Parts can be written in any
assembler that can emit a raw binary; the worked example below uses
KickAssembler.

## Build pipeline

```text
part.asm  --assembler-->  part.efo  --mkpef-->  part.pef  --pefchain + script-->  demo.d64
                          data files ----^
```

### .EFO — Effect object (a part's code with the Spindle header in front)
**Produced by:** kickassembler
**Consumed by:** spindle

A raw binary with no load address. It starts with the fixed header
described under "The part contract", then the tag list, then a two-byte
load address for the code that follows. Any assembler can write one;
KickAssembler needs `-binfile` so the two-byte PRG load address is not
prepended.

### .PEF — Packaged effect (one part with all its data chunks)
**Produced by:** spindle
**Consumed by:** spindle

`mkpef -o part.pef part.efo [data,addr[,offset[,length]] ...]`. The
first file is the effect object; further files are data chunks, each
with an optional load address, byte offset and length in hex (a `+`
prefix means decimal). `--music` marks chunks that must stay resident
until another music player is installed; `--stream` marks chunks to be
fed in across later parts. `pef2prg` turns one `.pef` into a standalone
PRG for testing, with the condition fixed to the space bar.

### .D64 — Single-sided 35-track 1541 disk image
**Produced by:** spindle
**Consumed by:** vice, c1541

`pefchain -o demo.d64 script`. The image has a normal BAM and directory
with one PRG in it, the bootstrap. Everything else sits in sectors the
directory does not describe; the BAM marks them allocated so a DOS copy
leaves them alone. `-F` writes a 40-track image, `-t` names the disk,
`-i` sets the ID, `-a` adds directory art, `-d` sets which directory
entry is the PRG.

## The part contract

A part is a set of routines the driver calls, plus declarations. The
handbook's lifecycle, in this page's words: with the previous part still
on screen, the driver finishes loading anything of this part that is
not in yet and calls `prepare`. Then it disables interrupts, writes the
part's interrupt handler address to `$FFFE`, calls `setup`, and enables
interrupts. While the part runs, the driver polls the script's condition
and, if the part has a `main` routine, calls it in a loop. Once the
condition holds it calls `fadeout` until that returns with carry set,
then `cleanup`, then jumps to the next part's driver. Every routine is
optional: a zero in the header skips it.

The header, in the order the file holds it. Sizes are what the worked
example assembled and pefchain accepted:

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | The ASCII text `EFO2` |
| 4 | 2 | Address of `prepare`, or 0 |
| 6 | 2 | Address of `setup`, or 0 |
| 8 | 2 | Address of the interrupt handler, written to `$FFFE` by the driver |
| 10 | 2 | Address of `main`, or 0 |
| 12 | 2 | Address of `fadeout`, or 0 |
| 14 | 2 | Address of `cleanup`, or 0 |
| 16 | 2 | Address of the three-byte music-call slot in the handler, or 0 |
| 18 | n | Tag list: one letter, then that tag's parameter bytes; a zero byte ends it |
| 18+n+1 | 2 | Load address of the code that follows |

The tags, from the handbook (the worked example used none, and pefchain
took that as "only the loaded pages are used"):

| Tag | Bytes | Meaning |
|---|---|---|
| `P` first, last | 3 | The part writes this page range at run time (generated tables, buffers). Pages a chunk loads into need no tag. |
| `I` first, last | 3 | The part inherits this page range from the previous part instead of colliding with it. |
| `Z` first, last | 3 | Zero-page range the part uses. |
| `S` | 1 | The interrupt handler saves, sets to `$35` and restores address 1, so loading under I/O may go on during the part. |
| `U` | 1 | `prepare` or `main` switch the I/O area out; pefchain puts a blank part between this and a preceding part without `S`. |
| `A` | 1 | Load as little as possible during this part. |
| `X` | 1 | Load nothing during this part. |
| `M` lo, hi | 3 | This part installs a music player at that address; `M 0 0` uninstalls. |
| `J` | 1 | `fadeout` returns a label number in A to jump elsewhere in the script. |

The music-call slot is a `bit` instruction with a two-byte absolute
operand, three bytes long, inside the handler. At link time pefchain
rewrites it as `jsr` to whichever player the script has installed by
then, and leaves it as `bit` when none is. See Pitfalls for what
happens when an assembler shortens it.

Rules the handbook states and the example kept: VIC bank selection goes
through `$DD02`, never `$DD00`; address 1 stays `$35` when the loader
is called; `prepare` writes no VIC register because the previous part
still owns the screen; `setup` must write `$D011`, `$D012`, `$D015`,
`$D016`, `$D018` and `$DD02` because the previous part may have left
anything in them. Before the first part the framework has already
disabled CIA 1 interrupts, written 1 to `$D01A`, `$FF` to `$DC02`,
armed an unacknowledged CIA 2 interrupt so Restore does nothing, and set
CIA 1 timer B free-running with a 63-cycle period in step with the
raster for jitter correction.

## Memory the loader keeps

Spindle 3 keeps one resident page, `$0200` to `$02FF` by default, and
during a loader call also writes a buffer page, `$0300` to `$03FF` by
default, and five zero-page bytes at `$F4` to `$F8`. `pefchain -r`, `-b`
and `-z` move all three. Between loader calls the buffer page and the
zero-page bytes may be used, if declared with `P` and `Z`; the resident
page may not be touched. pefchain's own suggestion text confirms the
defaults: it offered "pages 04-2f,31-ff and zero-page locations
02-f3,f9-ff" as the free space around a part that used page `$30` (run
here, quoted from the collision case below). `$0400` to `$07FF` is not
reserved: the default screen is ordinary free memory to pefchain, and
the worked example shows the result.

## The script and the pefchain command line

One part per line: the `.pef` path, whitespace, the condition. `#`
starts a comment. Blank lines are ignored. `-` as the part name is the
built-in blank part (black screen, no badlines, a handler that only
calls the music player). `|` as the part name continues the previous
part with a further condition. Numbers are hex unless prefixed `+`.

| Condition | Meaning |
|---|---|
| `space` | Advance when space is pressed. |
| `-` | Advance as soon as any loading scheduled for this part is done. |
| `addr = value` | Advance when the byte at `addr` holds `value`; the way a part follows the tune. |
| `stay` | Never advance; for the last line. |
| `@...` | Music interlock, see the handbook's Music section; not exercised here. |

A label is a line `n:` with `n` in hex `00` to `3F`; a part with the `J`
tag can jump to it, and `-L n` loops the script back to it at the end.

```text
pefchain -v -o demo.d64 script              # link; -v prints each part's driver address, crunch ratio and a load chart
pefchain -vv -o demo.d64 script             # also dumps every driver's bytes
pefchain -r 0c -b 0d -z 02 -o demo.d64 script   # move the resident page, buffer page and zero-page bytes
pefchain -t "my demo" -i xy -o demo.d64 script  # disk name and ID
pefchain -E 5 -o demo.d64 script            # simulate read errors with 5 % probability (decimal)
mkpef -v -o part.pef part.efo               # package; -v prints the part's memory chart
pef2prg -o part.prg -m bounds.mon part.pef  # standalone test build plus a VICE watch script for undeclared writes
```

The `-v` chart has one row per part and one column per four pages:
`r` the resident page, `|` the buffer page, `c` code loaded for this
part, `*` data being loaded ahead for a later part, `.` free. The last
column is the number of disk sectors the loader reads during that
part's slot. A byte size of the loader is not printed; the resident is
one page by construction, and the bootstrap PRG's size is in the D64
layout below.

## Worked example, run here

Two parts, each one source file assembled twice. Part 1 sets the border
red and ends after 150 frames; part 2 sets it green and ends after 200.
The frame count is a byte the handler increments, and the script's
`addr = value` condition reads it. `fadeout` sets carry at once, and its
store to `$D020` (the same colour, so nothing visible changes) marks the
instant the part ended for the trace below.

```kickass
// One Spindle part, built twice: part 1 by default, part 2 with -define PART2.
// Assemble with -binfile: an .efo has no load address, the header comes first.
//   java -jar KickAss.jar -binfile spindle-part.asm -o part1.efo
//   java -jar KickAss.jar -binfile -define PART2 spindle-part.asm -o part2.efo
#if PART2
.const CODE   = $4000
.const BORDER = 5              // green
#else
.const CODE   = $3000
.const BORDER = 2              // red
#endif

.encoding "ascii"
.pc = CODE - 21 "efo header"
.text "EFO2"                   // magic
.word 0                        // prepare: none
.word setup                    // setup: VIC registers, interrupts off
.word irq                      // interrupt handler, written to $fffe by the driver
.word 0                        // main: none, so the loader may run freely
.word fadeout                  // fadeout: returns with carry set at once
.word 0                        // cleanup: none
.word playcall                 // the three-byte slot the linker patches to a jsr
.byte 0                        // end of the tag list: no P/I/Z tags, every page used is loaded
.word CODE                     // load address of the code that follows
.errorif * != CODE, "header is not 21 bytes"

.pc = CODE "part"
frames:  .byte 0               // pefchain's "address = value" condition reads this byte

setup:
    lda #$3c
    sta $dd02                  // VIC bank 0 through $dd02, never $dd00
    lda #0
    sta $d015                  // sprites off
    sta $d021                  // black screen
    lda #BORDER
    sta $d020                  // the part's colour
    lda #$1b
    sta $d011                  // text mode, 25 rows, raster bit 8 clear
    lda #$f0
    sta $d012                  // one interrupt per frame, line 240
    lda #$c8
    sta $d016
    lda #$15
    sta $d018                  // screen $0400, upper-case charset
    rts

irq:
    pha
    inc frames                 // one count per frame
playcall:
    bit.abs $0000              // must be the three-byte form; plain "bit $0000" assembles to two bytes
    lsr $d019                  // acknowledge the raster interrupt
    pla
    rti

fadeout:
    lda #BORDER
    sta $d020                  // same colour: the store only marks the moment the part ended
    sec                        // carry set: fade finished, move on
    rts
```

The script, `script`. The blank part at the end keeps the disk from
running off the script:

```text
# Two parts, then the built-in blank part. Numbers are hex: 96 = 150 frames, c8 = 200.
part1.pef	3000 = 96
part2.pef	4000 = c8
-		stay
```

The commands, all exit 0:

```text
java -jar KickAss.jar -binfile spindle-part.asm -o part1.efo                  # 80 bytes
java -jar KickAss.jar -binfile -define PART2 spindle-part.asm -o part2.efo    # 80 bytes
mkpef -o part1.pef part1.efo
mkpef -o part2.pef part2.efo
pefchain -v -o demo.d64 script
```

pefchain's report: drivers for part 1 and part 2 at `$303B` and
`$403B`, right after each part's code, and the blank part's driver at
`$0426`; the chunks `3000-30cc` (205 bytes with the driver, crunched to
199), `0400-043d` (the blank part, 62 bytes, crunched to 63) and
`4000-405b` (92 bytes, crunched to 91); one sector read in the
bootstrap's slot and one during part 1; `662 blocks free (643 for
DOS)`.

Booted with the pinned command shape and the disk in place of a PRG:

```text
x64sc -default -warp +sound +autostart-delay-random -limitcycles N \
  -drive8truedrive -drive8type 1541 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -exitscreenshot out.png -autostart demo.d64
```

At `N = 8500000` the picture is part 1 (red border, black screen); at
`N = 12000000` it is part 2 (green). Each was taken twice and the two
files were byte-identical:
`../figures/spindle-two-parts-part1.png` and
`spindle-two-parts-part2.png`. They are not verifier pins: the recipe
verifier formats a fresh empty D64 when a run asks for a disk and
autostarts a PRG the page's listing built, so it cannot boot a D64
pefchain made. A recipe page for this example would have nothing the
verifier could check, and there is none.

Both pictures show two rows of junk characters at the top of the screen
above the KERNAL's boot text. That is the blank part's code and driver
at `$0400` to `$043D`, loaded into the screen while part 1 ran: neither
part declared pages `$04` to `$07`, so to pefchain they were free. A
part that shows the default screen must clear it in `setup` or declare
it with `P $04 $07`.

### The D64's layout

Read from the image with c1541 and a sector walk (run here):

- Directory: disk name `spindle disk`, ID `uk`, one entry, `demo`, PRG,
  3 blocks, chained through track 18 sectors 8, 18 and 9. Extracted, the
  file is 663 bytes with its load address and begins with a one-line
  BASIC stub, `1 sys2061`. It is byte-for-byte the length of
  `src/stage1.prg` from the Spindle build, the bootstrap that installs
  the resident page and the drive code.
- BAM: track 1 has all 21 sectors allocated and every other data track
  is empty; track 18 has 12 sectors allocated (the BAM, the directory,
  the three of the bootstrap, and seven more this page did not
  identify). DOS therefore reports 643 blocks free, which is 664 less
  track 1's 21.
- The parts and the blank part live on track 1 in Spindle's own sector
  format, outside any directory entry. Unused sectors elsewhere are not
  zero: each holds its own sector number in its first byte. A sector
  census that looks for non-zero blocks sees the whole disk as used;
  read the BAM instead.
- The drive code assembled from `src/drivecode.s` is 1,536 bytes. Where
  the bootstrap reads it from was not established here.

### Timings, measured

From a `-moncommands` file with `trace exec 080d`, `trace exec 0200`
and `trace store d020`, logging the cycle counter. `$080D` is the
`SYS` target, so its first fetch is the moment `RUN` starts the
program. `$0200` is the loader entry. PAL:

| Cycle | Event |
|---|---|
| 6,179,517 | First fetch at `$080D`: `RUN` |
| 6,644,809 | First loader call from the bootstrap |
| 7,033,873 | Part 1's `setup` writes `$D020`: 854,356 cycles after `RUN`, 0.87 s |
| 7,033,917 | Part 1's driver calls the loader: part 2 and the blank part load while part 1 runs |
| 9,980,779 | Part 1's `fadeout` store: 2,946,906 cycles after its `setup`, 149.92 frames of 19,656 |
| 9,980,834 | Part 2's `setup` writes `$D020`: 55 cycles after part 1 ended |
| 13,911,974 | Part 2's `fadeout` store: 3,931,140 cycles after its `setup`, 199.997 frames |
| 13,912,017 | The blank part's `setup` writes `$D020`: 43 cycles after part 2 ended |

NTSC (`-model ntsc`): part 1's `setup` at 7,299,419; its end at
9,862,381, which is 2,562,962 cycles or 149.92 frames of 17,095; part 2's
`setup` 55 cycles after that, the same join as PAL.

The 55 cycles are all straight-line code and the arithmetic reaches
them: `sec` and `rts` finishing `fadeout` (8), the driver's `bcc` not
taken (2) and `jmp` to the next driver (3), `sei` (2), two
load-and-store pairs writing `$FFFE` and `$FFFF` (12), `jsr setup` (6),
and the seven instructions of part 2's `setup` up to and including the
border store (22). The join is that short because part 2 had been in
memory since the loader call at 7,033,917; a part whose data was not in
yet would wait in the driver's "load any remaining sectors" step first,
and how long that takes was not measured here. The 149.92 rather than
150 frames is the poll catching the count on the frame it changes:
`setup` runs partway down a frame, the handler counts at line 240, and
the driver reads the byte within a few cycles of the store.

### When two parts want the same memory

Run here: part 2 rebuilt at `$3000`, the page part 1 occupies, with no
`I` tag. pefchain still exits 0 and writes the disk, but prints:

```text
Warning: Inserting blank filler because 'part1' and 'clash2' share pages 30.
Suggestion: Move things around or insert a part that only touches pages 04-2f,31-ff and zero-page locations 02-f3,f9-ff.
```

The chart then shows the blank part between them and a second blank
part's driver at `$0526`, and the free-block count drops by one. The
handbook says the filler is a black screen while the loader clears the
way; that disk was not booted here. It is not an error even when the
seam is unwanted; read the warnings. To share memory on purpose, the
second part declares `I first, last` and pefchain treats the
overlap as inherited rather than colliding (from the handbook, not
provoked here).

## Build integration

Three make rules build the disk, with the `.efo` rule using
`-binfile` and `.DELETE_ON_ERROR:` so a failed assembly does not leave
a stale object for `mkpef` to package. Keep each part in its own
directory with its own script line, as the bundled example does, so a
part can be reordered by editing one line. During development give
every line the `space` condition and swap in `addr = value` once the
tune is in (the handbook's advice; `transition_conditions` says why).
`pef2prg -m` writes a VICE `-moncommands` file that stops the machine on
a write outside the declared ranges; run each part standalone under it
before linking, since a part that stays inside its declarations alone
can still overwrite a later part's preloaded data in the chain.
`pefchain` on this two-part disk returned without noticeable delay (not
timed here); relinking on every build is the intended way to work.

## Pitfalls

**An assembler that shortens the music-call slot breaks the interrupt.**
KickAssembler assembled `bit $0000` to the two-byte zero-page form
`24 00`. The header's slot address then pointed at a two-byte
instruction where pefchain expects three, and the byte after it, the
first of `lsr $d019`, was no longer where the linker and the code
agreed. Run here: the raster interrupt was never acknowledged, the
handler re-entered mostly every 30 to 37 cycles, the frame counter
reached 49 in 1,535 cycles and the driver never got to its poll, so
part 1 never ended. `bit.abs $0000` (`2c 00 00`) fixed it and nothing
else changed. Check the three bytes in the `.efo` before blaming the loader.

**The screen is not reserved.** Pages `$04` to `$07` are free memory to
pefchain and it used them for the blank part's code. A part that shows
the default screen sees the junk (both pictures above). Clear the screen
in `setup`, or declare `P $04 $07`, or point `$D018` somewhere the part
loads.

**A shared page is a warning, not an error.** The link succeeds with a
blank filler inserted. A seam that turns black for a frame means this
warning was ignored.

**`bit $0000` stays if no player is installed.** The handbook says so;
with no `M` tag anywhere in this script the part ran to its frame count
with the slot in place. The loaded bytes were not disassembled here, so
whether the slot was rewritten to a `jsr` to a stub or left as `bit` is
from the handbook. Budget 4 cycles a frame for it either way.

**The `-limitcycles` picture on a D64 boot is later than on a PRG.**
Autostart of a disk goes through the KERNAL's `LOAD"*",8,1` and the
real drive; `RUN` came at 6,179,517 cycles here against about 3,000,000
for a PRG in this repository's pins. Sweep the cycle count with the
`$D020` trace before choosing a pin.

## Licence

The `src/` directory is under the MIT licence (the `COPYING` file,
copyright 2013 to 2022 Linus Åkesson): free to use, copy, modify and
redistribute, including in sold work, provided the copyright and
permission notice travel with copies of the software. The `template/`
directory and the Spindle logo example are declared public domain. The
other examples may be redistributed as they are. The README asks for a
credit such as "Loader by lft" and says the logo is optional. The
loader and drive code that pefchain writes into a demo's D64 are part of
the demo the author ships; nothing on this page copies them.

## See also

- `part_lifecycle` and `transition_conditions` in [demo-composition](../demo-design/demo-composition.md): the contract this tool enforces, described for v2.
- `multi_load_sequencing` in [loaders-packers](../techniques/loaders-packers.md): loading between parts with a loader the part calls itself.
- [kickassembler-reference](kickassembler-reference.md): `-binfile`, `-define`, and the `.abs` suffix.
- [vice-reference](../runtime/vice-reference.md): `-moncommands`, `trace`, and reading the exit screenshot.
- [c64-file-formats](../formats/c64-file-formats.md): the `.D64` layout the BAM walk above follows.
