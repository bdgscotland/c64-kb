---
tool: sid-wizard
tool_kind: asset-converter
maintainer: Hermit (Mihaly Horvath)
license: Public Domain (SourceForge project page)
home_url: https://sourceforge.net/projects/sid-wizard/
version_verified: "1.7"
---

<!-- doc-type: toolchain-reference -->

# SID-Wizard: .swm work files and SID-Maker exports

## Tool

SID-Wizard is a music tracker that runs on the C64 itself (or in VICE).
The composer saves a work file, `.swm`; a separate C64 program on the same
disk, SID-Maker, packs a `.swm` with a player into something a program can
use: "Normal", "Raw", "Executable" or `.sid`. A host-side C program,
SWMconvert, converts `.swm` to and from XM and MIDI. This page is for an
agent handed a `.swm` or a SID-Maker export and asked to put the music in
a game or demo.

Everything marked "measured" was done on 2026-09-24 with SID-Wizard 1.7
(`SID-Wizard-1.7.zip` from SourceForge, 2014), its shipped demo tunes and
their shipped exports, and VICE x64sc 3.10 headless. The current release
is 1.94 on CSDb (release 258573, 2026); it was not checked here. The
exports below were made by the author with SID-Maker, not re-made here:
SID-Maker is an interactive C64 program and was not driven headless.

**Targets:** SID

## The package

| Path in the zip | What it is |
|---|---|
| `application/SID-Wizard-1.7.prg`, `-2SID`, `-3SID` | The editor, for one, two or three SID chips |
| `application/SID-Maker-1.7.prg`, `-2SID`, `-3SID`, `-SFX`, `-SWP` | The exporters (SFX adds a sound-effect entry; SWP makes relocatable data and player) |
| `application/SWMconvert`, `sng2swm` | Host tools: `.swm` ↔ XM/MIDI, `.P00` ↔ `.prg`; GoatTracker `.sng` → `.swm` |
| `sources/` | Source in 64tass syntax, `SWM-spec.src` (the format), `SWMconvert.c` |
| `demotunes/` | Tunes as `.swm.prg` and `.swm.P00`, and `sid-exports/`, `prg-exports/` made from them |

SWMconvert's source is old-style C: `SWM-spec.src`, included at file scope,
declares its constants as `name=value;` with no type. Apple clang refuses
it (20 errors, the first `INSTR_MAX=62 ;` needing `int`); it builds with
`cc -std=gnu89 -w -O2 -o SWMconvert SWMconvert.c -lm` (measured). It
does not write `.sid`: its usage text lists XM, MIDI, `.prg`/`.P00`,
S00 to SID (VICE's PC64 wrapper) and `.swm` to `.sws`.

## Build pipeline

### .SWM — SID-Wizard module (work file)

**Consumed by:** sid-wizard

The header is 64 bytes, from `SWM-spec.src`; the values in the last
column were read from the 12 `.swm.prg` demo tunes (measured).

| Offset | Content | Seen in the demo tunes |
|---|---|---|
| $00-$03 | `SWM1` | all 12 |
| $04 | Frame speed, 1 to 8 calls a frame | 1, and 4 in `lenore` |
| $05 | Pattern highlight step | 3, 4 |
| $08-$0A | Mute/solo switches | |
| $0B | Default pattern length | 32, 48, 64 |
| $0C | Sequences stored (3 per subtune) | 3; 15 in `nepzenek` (5 subtunes) |
| $0D | Patterns stored | 27 to 88 |
| $0E | Instruments stored | 8 to 40 |
| $0F | Packed chord-table length | 0 to 44 |
| $10 | Packed tempo-table length | 0, 4, 9 |
| $13 | Player type the tune was written for | 0 to 4 |
| $14 | Tuning: 0 = 440 Hz, 1 = 432 Hz, 2 = just intonation in C | 0 |
| $18-$3F | Author and title, 40 characters; a `:` separates author from title for the SID export | e.g. `HERMIT : FEEL THE CONGA BEAT COVER` |

Offsets 7, 17 and 18 are marked obsolete in the spec. After the header:
sequences, patterns, instruments (16 fixed bytes, then wave/arpeggio,
pulse and filter programs, then an 8-character name), the chord table,
the tempo table, and one pair of tempo bytes per subtune, as the spec
describes. On disk the file is a PRG: two load-address bytes first, and
the demo tunes carry six different ones (`$1F10` to `$2003`), so the
address means nothing to the format. The `.swm.P00` copies start with
`C64File`, the C64 name at offset 8, and the same bytes from offset 26.
`.sws` and `.swt` are the 2SID and 3SID variants.

### .SID — PSID file exported by SID-Maker

**Produced by:** sid-wizard

Read from the 24 `.sid` files in `demotunes/sid-exports/` (measured):

- Load address `$1000` in 23, with init = load and play = load + 3.
- The code starts with a jump table of four `JMP`s: +0 init, +3 play,
  +6 multispeed play, +9 set volume. The manual adds +12, trigger a sound
  effect (X = note, Y = instrument, A = length in frames), in exports made
  with SID-Maker-SFX, and, for SWP exports, init with the data address in
  X/Y and the subtune in A, and +15 tape slowdown (A = 0 to 24
  semitones). Subtune goes in A for init.
- The one multispeed tune (`lenore`, frame speed 4) loads at `$0FB8` with
  play at `$0FCF` and speed bits `$FFFFFFFF` (CIA timing): SID-Maker put a
  stub in front of the player that sets the CIA timer (`STX $DC05`,
  `STX $DC04` in its first bytes).
- PSID v2, and v3 for `egblues` (a 2SID tune) and `thizizda` (a 3SID
  tune). Flags `$0024` (PAL, 8580) on every v2 file, `$00A4` on the two
  v3 ones; the manual says the SID model comes from the exporter's
  old/new setting.
- The author field holds bytes left over after its terminating zero
  (`HERMIT` `$00` `ROPOLO`): a reader must stop at the first zero byte.

Played through that jump table in VICE (KickAssembler `LoadSid`, init
with A = 0, play once a frame at raster line `$F8`, SID writes dumped with
`-sounddev dump`): `actingup.sid` wrote all 25 SID registers, 1,360 writes
in 6,000,000 cycles, `$D418` taking 0, 15 and 31.

### .PRG — SID-Maker "Executable" export

**Produced by:** sid-wizard

The 24 `.exe.prg` files load at `$0801` with a BASIC line `SYS 2064`;
autostarted in VICE, `actingup.exe.prg` wrote 2,438 SID registers in
6,000,000 cycles (measured). It is a standalone player with its own
display, not something to link into a program: use the `.sid` or the Raw
or Normal export for that.

## Relocation

SID-Maker asks for a relocation address for each export and a player type
for it (manual): the same tune can be packed at any address with the
player it needs. That is the place to relocate. Every shipped `.sid`
export has its player at `$1000`, so no relocated export was examined
here.
A `.sid` already exported can be moved with [sidreloc](sidreloc.md),
which traces the player; that was not run on a SID-Wizard export here.

Player types, smallest first (manual): Bare (no subtunes, no multispeed,
no external volume, no filter shift, among others), Light, Medium,
Normal, Extra; the manual lists the effects each one lacks or adds. The
header byte `$13` records which
player the tune was composed for.

## See also

- [sidreloc.md](sidreloc.md): moving a finished `.sid`.
- [../formats/c64-file-formats.md](../formats/c64-file-formats.md):
  the PSID header, and GoatTracker's `.sng`.
- [../runtime/vice-reference.md](../runtime/vice-reference.md),
  "Recording the SID output": the register dump used above.
