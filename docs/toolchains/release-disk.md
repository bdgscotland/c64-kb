---
tool: release-disk
tool_kind: reference-catalog
maintainer: bdgscotland
license: BSD-3-Clause
home_url: https://github.com/bdgscotland/c64-kb
---

<!-- doc-type: toolchain-reference -->

# Assembling a release disk and proving it boots

## Tool

This page is a procedure, not a program. It turns a PRG that one of the
toolchains built into a D64 image a user can put in drive 8
and start with `LOAD"*",8,1`, then proves the image boots by autostarting
it in headless VICE and looking at the screen. Every command and every
figure here was run on this machine with VICE 3.10's `c1541` and `x64sc`,
GNU Make 3.81 and Oscar64 build 2026-05-19, on the PRG that the listing in
[oscar64/platformer-scaffold](../recipes/oscar64/platformer-scaffold.md)
builds (6,473 bytes, loading at `$0801`; the build before #93 moved its
start-up read, which is the one measured here. The current listing
builds 6,547 bytes, still 26 blocks by the arithmetic below). That recipe also writes to the
disk it came from, which a release disk has to survive. The per-tool pages hold the build commands; the image
format is in [c64-file-formats](../formats/c64-file-formats.md) and the
drive's error numbers in
[iec-disk-reference](../formats/iec-disk-reference.md).

**Targets:** 6510

## What a release disk is

A D64 is 683 sectors of 256 bytes, 174,848 bytes in the file. Track 18 is
the directory track, so a formatted disk has 664 blocks for files, which
is what `c1541 -list` prints as `664 blocks free.` on an empty image. Each
block holds 254 bytes of file data, the other two being the link to the
next block. A release disk is such an image with four properties:

1. **The game is the first directory entry.** `LOAD"*",8,1` loads the
   first file in the directory, whatever its name, and so does VICE's
   `-autostart disk.d64`. The order of `c1541 -write` calls is the
   directory order, so write the game first and everything else after.
2. **A disk name and ID.** `c1541 -format "name,id"` sets both; they are
   the header line of the directory (`0 "platformer      " ps 2a`). The
   ID is two characters. Nothing on the C64 side reads either, but a
   user does.
3. **The game loads with `,8,1` and also without it, or the page says
   which.** A PRG from any of the three toolchains here starts with a
   BASIC stub at `$0801` (see
   [memory-layout-planning](memory-layout-planning.md), the `$0801` row),
   so `LOAD"*",8` without the `,1` lands it at the same address and `RUN`
   starts it. Measured below with VICE's `-basicload`. A PRG whose first
   two bytes are not `$01 $08` needs the `,1`, and a plain `LOAD` puts it
   at `$0801` where it will not run; say so in the release notes.
4. **Optional directory entries as art.** Extra entries after the game,
   named with dashes or a credit line. Each costs one block, because
   `c1541` will not write an empty file, and each has a file type: a bare
   name becomes `prg`, a `,seq` suffix becomes `seq`, and `,del` is
   refused (all three measured below).

## Making it with c1541

From a built PRG:

```bash
c1541 -format "platformer,ps" d64 platformer.d64
c1541 -attach platformer.d64 -write platformer.prg platformer
c1541 -attach platformer.d64 -list
```

**Names go to c1541 in lower case.** `c1541` maps lower-case ASCII to
unshifted PETSCII, which the C64's upper-case font shows as capitals, and
upper-case ASCII to shifted PETSCII, which it shows as graphics glyphs.
This is the pitfall
[c1541_uppercase_filename_petscii_shift](../pitfalls/kernal-and-io.md)
and it applies to the disk name and ID as well as to file names. Measured
on this disk: after `-format "PLATFORMER,PS"` and `-write ... PLATFORMER`
the BAM's name field at track 18 sector 0 offset `$90` read
`D0 CC C1 D4 C6 CF D2 CD C5 D2` and the directory entry's name read the
same, while `c1541 -list` still printed `PLATFORMER` and the `-write`
line echoed the name as ten unprintable bytes. After the lower-case
commands above the same fields read `50 4C 41 54 46 4F 52 4D 45 52`,
`-list` printed `platformer`, and the `-write` line echoed
`writing file 'PLATFORMER.PRG' as 'PLATFORMER' to unit 8`. The wrong
disk still autostarts, because autostart goes by directory position, but
a user typing `LOAD"PLATFORMER",8,1` gets `?FILE NOT FOUND ERROR` and the
directory shows glyphs.

The listing of the disk the rest of this page tests:

```text
0 "platformer      " ps 2a
26   "platformer"       prg
638 blocks free.
```

**Block arithmetic.** A file of N bytes takes `ceil(N / 254)` blocks; the
PRG's two load-address bytes are part of N. 6,473 / 254 = 25.48, so 26
blocks, and 664 - 26 = 638 free, which is what the listing says. A disk
is full at 664 blocks used, and a game that saves to its own disk needs
its record's blocks free after the release files are on it: the score
file this game writes is one block (measured below). Two art entries
written after the game, one bare name of sixteen dashes and one
`readme,seq`, listed as `1 "----------------" prg` and `1 "readme" seq`
after the game and left `636 blocks free`; a third `-write` of a
zero-byte file with `,del` printed `floppy write failed` and added
nothing.

**Record the image's checksum in the release notes**, taken from the
image before anyone boots it. This one is
`md5 21b91ed52e791ae0efd9faba7666ac12` (`cksum` gives
`4220958840 174848`). Format and write are deterministic here: three
builds of the disk from the same PRG gave the same MD5.

## Proving it boots in VICE

Autostart the image itself, not the PRG:

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random \
  -limitcycles 30000000 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -exitscreenshot platformer-boot.png -autostart platformer.d64
```

VICE's log for that run says what path it took: `Attached file
'platformer.d64' as a disk image`, `Resetting drive 8`, `Resetting the
machine to autostart '*'`, `Loading program '*'`, `Entered ROM at $e5d4`,
`Searching for ...`, `Loading`, `Entered ROM at $ea21`, `Ready`,
`Starting program.`, then `Main CPU: Error - cycle limit reached.` and
exit status 1, which is the `-limitcycles` exit. The KERNAL loaded the
file from the emulated 1541 through the serial bus, which is what the test
checks.

**This is not the path the recipe verifier uses, and the cycle counts
do not carry over.** `scripts/verify-recipes.ts` runs
`-autostartprgmode 1 -autostart out.prg`, which writes the PRG into RAM
once the KERNAL prints `READY.` and types `RUN`; its `disk` entry formats
a fresh D64 and attaches it with `-8`, and nothing is ever loaded from it.
The program is running by 3,000,000 cycles that way
([vice-reference](../runtime/vice-reference.md), "What
`-autostartprgmode` does to a run"). Loading the same 26 blocks through
the 1541 takes far longer. Measured on this disk, PAL: at 18,000,000
cycles the screen still read `LOAD"*",8,1` / `SEARCHING FOR *` /
`LOADING`; at 22,000,000 the game's HUD was up at frame 0; at 30,000,000
the HUD read frame 390. So the load finished between 18 and 22 million
cycles, and a disk-boot test needs `-limitcycles` set from that, not from
the recipe's pinned count. `-autostartprgmode` has no effect on a D64
argument; it selects how a `.prg` argument is delivered.

**What the screen shows at 30,000,000 cycles.** Row 0
`SCORE 00069 LIVES 3 HI 00069 F 00390 DF`, row 1
`CYC 06346 MAX 08550 DROP 00 ERR 0`, the map, and row 24
`DRIVE: 62, FILE NOT FOUND,00,00`, decoded from the exit screenshot
against the character ROM. `F` is the game's own report of a first run
with no score file; 62 is the drive's answer to opening `HISCORE,S,R` on
a disk that has no such file. The picture is
`../recipes/oscar64/screenshots/platformer-scaffold-d64.png`; three runs
of the command gave byte-identical PNGs. Under `-model ntsc` at the same
count the HUD reads frame 421 with the same `F` and the same row 24
(`platformer-scaffold-d64-ntsc.png`, two runs byte-identical).

**Without the `,1`.** `-basicload` makes VICE type `LOAD"*",8` instead.
At 30,000,000 cycles the screen was the same HUD at frame 390 with `F`
and the same row 24. The Oscar64 PRG loads at `$0801` either way.

## The game writes to the disk it booted from

This recipe opens `HISCORE,S,R` on device 8 after fifty frames, and at
game over scratches and rewrites it. Booted from its own D64, device 8
is the release disk, so two things follow and both were measured.

**The first OPEN does not hang.** The recipe's page records a start-up
hang in the OPEN's read-back on PAL, seen when the PRG was injected with
`-autostartprgmode 1`. Its cause is a read of a file that is not on the
disk, whose short answer from the drive a badline can hide (pitfall
`first_open_after_reset_hangs_on_pal`); the fifty `vic_waitFrame` calls
before the OPEN only moved the phase. The recipe has since dropped them
and reads the error channel before the file (#93). From the D64
the OPEN reaches the same drive that has just served the LOAD: the 30
million cycle PAL and NTSC runs above both show the drive's 62 on row 24
and `F` on the HUD, so the OPEN completed and its error channel was read.
A build with `-dDISK_WAIT_FRAMES=0`, written to its own disk the same
way and autostarted from it, also ran: at 30,000,000 cycles PAL its HUD
read frame 440 with `F` and row 24 read
`DRIVE: 62, FILE NOT FOUND,00,00`. That is one run, so it says the wait
was not needed on that run from disk, not that the hang cannot happen
from disk. The recipe now has no wait and reads the error channel
first, which removes the read that hung.

**The image changes.** At 45,000,000 cycles PAL the autopilot's game
over had passed: the HUD read `SCORE 00191 LIVES 0 ... W`, row 1 ended
`B00191`, row 24 read `DRIVE: 00, OK,00,00`, and afterwards
`c1541 -list` showed a third line, `1 "hiscore" seq`, with
`637 blocks free`, and the image's MD5 was
`c8a409ca443cc1e6239c7042dfa6d4da` instead of the value above. So:

- Take the checksum before the boot test, and boot a copy. The Makefile
  below copies the image before `x64sc` touches it.
- Ship the disk writable. A user's real disk with the tab open gives the
  game `26, WRITE PROTECT ON` at game over; in VICE, `-attach8ro`
  answers the same 26 ([iec-disk-reference](../formats/iec-disk-reference.md),
  "The 1541 DOS Error Codes"). This game's HUD letter for a failed write
  is `E`; the protected-disk run itself was not made here. A game that
  does not handle 26 will look broken on a protected disk.
- A release note that says "the disk is unchanged after play" is false
  for any game that saves to it. Say which files it adds.

## Checklist

- The PRG's first two bytes are the load address, low byte first; `$01
  $08` means `$0801` and a BASIC stub. Check with `xxd -l 2 game.prg`.
  This one read `0108`.
- Names to `c1541` in lower case: disk name, ID and every file.
- The game is the first `-write`. `c1541 -list` shows the order.
- Block count: `ceil(bytes / 254)` per file, 664 in total, and room for
  anything the game writes.
- Boot the image itself with `-autostart game.d64`, at a cycle count
  chosen for a serial load of that many blocks, and look at the
  screenshot. A `-autostartprgmode 1` run proves the program and says
  nothing about the disk.
- Boot a copy, and record the pristine image's MD5 or CRC in the release
  notes.
- 1541 or fast loader: the KERNAL load measured here had 26 blocks in
  memory inside 22 million cycles from power-on, about 22 seconds of
  machine time including the reset and autostart delay; a full disk through
  the KERNAL is the half hour that
  [iec-disk-reference](../formats/iec-disk-reference.md) quotes under
  "Speed and Throughput". Nothing here needs a fast loader. A game that
  streams levels does, and its loader's disk layout is then part of the
  release format; no fast loader was run on this page.
- If the game saves to its disk: the image changes, the disk must be
  writable, and the game's answer to 26 needs one run with
  `-attach8ro`.

## Makefile target

`make release` builds the PRG, formats the image, writes the game first,
lists the directory and records the MD5. `make boot` copies the image and
autostarts the copy headless, treating VICE's exit status 1 as the
expected `-limitcycles` exit. Both were run end to end on this machine;
the image's MD5 matched the hand-made one above and the boot screenshot
was byte-identical to the hand-run one. `CYCLES` is the disk-boot count,
not the recipe's.

```makefile
OSCAR64 ?= oscar64
C1541   ?= c1541
X64SC   ?= x64sc
NAME    := platformer
DISKID  := ps
SRC     := platformer-scaffold.c
PRG     := $(NAME).prg
D64     := $(NAME).d64
CYCLES  ?= 30000000

.PHONY: release boot clean

$(PRG): $(SRC)
	$(OSCAR64) -tm=c64 -O2 -o=$(PRG) $(SRC)

$(D64): $(PRG)
	rm -f $(D64)
	$(C1541) -format "$(NAME),$(DISKID)" d64 $(D64)
	$(C1541) -attach $(D64) -write $(PRG) $(NAME)
	$(C1541) -attach $(D64) -list
	md5 $(D64) | tee $(D64).md5

release: $(D64)

boot: $(D64)
	cp $(D64) boot-copy.d64
	$(X64SC) -default -warp +sound +autostart-delay-random \
	  -limitcycles $(CYCLES) -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
	  -exitscreenshot $(NAME)-boot.png -autostart boot-copy.d64; \
	  test $$? -eq 1
	md5 $(NAME)-boot.png

clean:
	rm -f $(PRG) $(D64) $(D64).md5 boot-copy.d64 $(NAME)-boot.png \
	  $(NAME).map $(NAME).asm $(NAME).lbl $(NAME).int $(NAME).dbj
```

On macOS with Homebrew VICE, `GSETTINGS_SCHEMA_DIR` must be in the
environment `make` runs under, as for every other headless run on these
pages. `md5` is the macOS name; `md5sum` on Linux. The recipe's source
file has to be beside the Makefile; the listing gate does not write it
out, so copy the `c` fence from the recipe page.

### The release image: a .D64 with the game as its first directory entry

**Produced by:** c1541
**Consumed by:** vice, c1541

The image format itself is on
[c64-file-formats](../formats/c64-file-formats.md); this page adds only
the ordering and naming rules above.

## Not measured here

- Whether the image boots on a real 1541 or on an SD2IEC. VICE's 1541-II
  ROM served it; no hardware was tried.
- The smallest `-limitcycles` at which the load is complete; it lies
  between 18,000,000 and 22,000,000 on PAL and was not narrowed.
- Whether the start-up hang the recipe page records can occur when the
  game is loaded from disk; one run without the wait did not hang.
- Any fast loader, and any drive other than device 8.

## See also

- [c64-file-formats](../formats/c64-file-formats.md), ".D64"
- [iec-disk-reference](../formats/iec-disk-reference.md), "The 1541 DOS Error Codes" and "Speed and Throughput"
- [vice-reference](../runtime/vice-reference.md), "What `-autostartprgmode` does to a run"
- [memory-layout-planning](memory-layout-planning.md), the `$0801` row
- Pitfall: [c1541_uppercase_filename_petscii_shift](../pitfalls/kernal-and-io.md)
- Recipes: [oscar64/platformer-scaffold](../recipes/oscar64/platformer-scaffold.md),
  [oscar64/high-score-persist](../recipes/oscar64/high-score-persist.md)
