---
tool: vice
tool_kind: emulator
maintainer: VICE Team
license: GPL-2.0
home_url: https://vice-emu.sourceforge.io/
version_verified: "3.10"
---
<!-- doc-type: toolchain-reference -->

# VICE — Versatile Commodore Emulator

## Tool

VICE (Versatile Commodore Emulator) is an open-source emulator that runs software
written for the Commodore 8-bit computer family on modern hardware. c64-kb uses only
`x64sc`, the cycle-accurate C64 emulator. VICE exposes a
TCP-based binary monitor protocol on port 6502 that allows external programs to inspect
and control the running machine: read and write memory, set breakpoints, capture the
screen, load and execute programs, and save snapshots. The vice-mcp server speaks this
protocol on behalf of agents; agents do not drive the protocol directly.

**Targets:** 6510, VIC-II, SID, CIA1, CIA2

---

## Quick Reference

### Install

```bash
# macOS — Homebrew
brew install vice

# Debian / Ubuntu
sudo apt install vice

# Fedora
sudo dnf install vice
```

After installation, ROM images must be present. On Homebrew macOS they land in
`/opt/homebrew/share/vice/C64/`. On Linux, packages that include the ROMs place them in
`/usr/share/vice/C64/`; Debian's does not include them. VICE refuses to start
without a valid `kernal`, `basic`, and `chargen` ROM.

### Basic run

```bash
# Load and auto-run a PRG directly
x64sc -autostart hello.prg

# Attach a D64 disk image and autostart the first file
x64sc -autostart mygame.d64

# Headless automated run: warp speed, quit after 5,000,000 cycles (about 5 s PAL), binary monitor on
x64sc -warp -limitcycles 5000000 -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502 \
      -autostart hello.prg
```

---

## Emulator Binaries

VICE ships multiple binaries, one per emulated machine.

| Binary | Machine emulated | Notes |
|--------|-----------------|-------|
| `x64sc` | Commodore 64 (cycle-accurate) | **Use this for all c64-kb work** |
| `x64` | Commodore 64 (fast) | Higher host performance; not cycle-accurate |
| `x128` | Commodore 128 | Out of scope for c64-kb |
| `xvic` | VIC-20 | Out of scope |
| `xpet` | PET series | Out of scope |
| `xplus4` | PLUS/4 | Out of scope |
| `xcbm2` | CBM-II | Out of scope |

`x64sc` uses a cycle-exact 6510/VIC-II core; both binaries offer true 1541 drive
emulation (an earlier version of this page credited it to `x64sc` alone). It is
slower than `x64` on the host but gets raster timing, CIA timer behaviour and SID
timing right, which demo and game code depend on. Always use `x64sc` for correctness. See the Pitfalls section for the consequences
of reaching for `x64` instead.

---

## CLI Flags

Flags for build-and-test automation and basic operation. VICE accepts many more; run `x64sc --help` for the full list.

| Flag | Argument | Effect |
|------|----------|--------|
| `-autostart <file>` | PRG, D64, T64, TAP, VSF | Load and RUN the named file or the first file on a disk/tape image; a `.vsf` is autodetected as a snapshot and restored (after the normal autostart delay — allow well over 3,000,000 cycles under `-limitcycles`) |
| `-binarymonitor` | — | Enable the TCP binary monitor |
| `-binarymonitoraddress <addr>` | `ip4://127.0.0.1:6502` | Monitor listen address and port |
| `-moncommands <file>` | path to text file | Execute text-monitor commands at startup (useful for loading labels) |
| `-warp` | — | Disable real-time throttle; run as fast as the host allows (`-help`: "Initially enable warp mode"; `+warp` is the default). The pinned run uses it so 8,000,000 cycles take seconds, not eight of them |
| `-limitcycles <n>` | cycles | Quit after n emulated cycles (985,248 per PAL second, 1,022,727 per NTSC second); VICE exits with a non-zero status when the limit fires (`-help`: "quitting with an error"), so a wrapper must not treat rc=1 alone as failure. The pinned run's exit point: the frame on screen when it fires is the one `-exitscreenshot` writes, so a recipe's cycle count is part of its identity |
| `-exitscreenshot <file>` | PNG path | Write the current frame to `<file>` when the emulator exits, including the `-limitcycles` exit. The only picture the verification protocol reads; the file is 384x272 RGBA on PAL and 384x247 on NTSC (see "Reading the exit screenshot" below) |
| `-autostartprgmode <n>` | 0, 1, 2 | How `-autostart file.prg` gets the PRG into memory (`-help`: "0: VirtualFS, 1: Inject, 2: Disk image"). 0 types `LOAD"HELLO.PRG",8,1` and expects VICE's host-directory device to answer; 1 writes the PRG into RAM once the KERNAL reaches `READY.` and types `RUN`; 2 puts the file on a disk image and loads it through the emulated drive as `LOAD"HELLO",8,1`. The protocol pins 1: it is the fastest, and under `-default` mode 0 never ran the program at all; measurements below |
| `-default` | — | "Restore default settings": start from VICE's built-in configuration rather than whatever the user last saved, so a run on another machine starts from the same settings. Without it a saved palette, model or drive setting would change the picture (the effect of a saved settings file was not measured here) |
| `+sound` | — | "Disable sound playback". No audio device is opened, so a headless run cannot stall or fail on the host's audio stack; SID emulation itself still runs |
| `+autostart-delay-random` | — | "Disable random initial autostart delay". VICE otherwise adds a random delay before autostart, so the same `-limitcycles` would land on a different frame each run; with it off the exit screenshot is reproducible pixel for pixel |
| `-console` | — | "Console mode (for music playback)": the flag under which this page's option names were confirmed (`x64sc -default -console`). The pinned run does not use it; every screenshot cited on this page was produced without it, and whether it changes the screenshot was not measured here |
| `-pal` | — | Force PAL machine model |
| `-ntsc` | — | Force NTSC machine model |
| `-model <name>` | `c64`, `c64c`, `c64old`, `ntsc`, `newntsc`, `oldntsc`, `drean`, `jap`, `c64gs`, `pet64`, `ultimax` | Select machine sub-model (list from `x64sc -help`; there is no `pal` value). With no `-model`, `-default` runs the `c64c` configuration: VIC-II 8565, SID 8580, CIA 8521 (`x64sc -default -dumpconfig` gives VICIIModel=1, SidModel=1, CIA1Model=1, identical to `-model c64c`; `-model c64` gives 0, 0, 0, the 6569, 6581 and 6526). An earlier version of this row said the default was the PAL 6569 `c64`; `recipes/kickassembler/cia-revision-detect.md` reads the new CIA on the default machine and the old one on `-model c64`, which settles it (measured 2026-09-23). Both PAL parts run 312 lines of 63 cycles. Decision (#36): the harness keeps this default. Every runs.json `pal` run and PAL screenshot is the C64C, and pages name it "PAL c64c (8565/8580/8521)"; add `-model c64` (6569, 6581, 6526) to check a listing on the older machine, which differs in the CIA timer interrupt (one cycle later on the 6526; `cia-revision-detect` reads `12 11` there and `10 11` on the default), the SID filter and `$D418` digis (not measured here), and eleven palette entries. The protocol's second run adds `-model ntsc` for the 6567R8 (with a 6581 and a 6526); that changes the frame height, the timing and eleven of the sixteen palette entries |
| `-drive8type <n>` | 1541, 1571, … | Drive type for device 8 |
| `-8 <file>` | D64, G64, … | Attach disk image to device 8 (`-help`: "Attach <name> as a disk image in unit #8"). A recipe whose `runs.json` entry carries `"disk": {"name": "TEST,01"}` gets a D64 freshly formatted with `c1541 -format "test,01" d64` attached this way before every run, so the program always sees the same empty disk |
| `-1 <file>` | T64, TAP | Attach a tape image to the datasette (unit 1) |
| `-soundvolume <n>` | 0–100 | Audio output level (0 = mute) |
| `-sounddev <name>` / `-soundarg <file>` | `wav`, `dump`, `dummy`, `coreaudio` | Sound sink. `wav` records audio in real time only; `dump` writes every SID write as text, warp or not. See "Recording the SID output" below |
| `-keymap <n>` | 0 symbolic, 1 positional, 2/3 user files | Keymap type (default 0) |
| `-keyboardmapping <n>` | 0 = US, other values select other host layouts | Host keyboard layout used to pick the `.vkm` file |
| `-cartcrt <file>` | CRT | Attach a cartridge image |
| `+cart` | — | Disable cartridge (note: plus sign, not minus) |

A flag that begins with `+` instead of `-` turns a feature off; its `-` counterpart
turns it on.

An earlier revision of this page listed `-quitafter <seconds>`, `-1541-8`,
`-tape1 <file>`, `-snapshot <file>` and `-keyboard <layout>`; x64sc 3.10 has none of
them and rejects each as an unknown (or, for `-keyboard`, ambiguous) option, aborting
startup. The rows above hold the real names (measured with `x64sc -default -console`).

Every flag in the table was checked again on 2026-09-22 against the output of
`x64sc -help` from the Homebrew VICE 3.10 on this machine (1,929 lines); the quoted
phrases in the table are that output's own wording. The ten flags the pinned
verification run uses (`-default -warp +sound +autostart-delay-random
-autostartprgmode 1 -limitcycles N [-model ntsc] [-8 disk.d64] -exitscreenshot
out.png -autostart out.prg`) all appear in it under exactly those names.

### What `-autostartprgmode` does to a run

Measured with the committed `docs/recipes/kickassembler/hello-world.md` listing
(assembled with KickAssembler 5.25, 44-byte PRG), the pinned command with
`GSETTINGS_SCHEMA_DIR` set, PAL, one run per cell, decoding the screenshot's text
cells against the character ROM. A PNG was written in all fourteen runs and every run
exited with status 1, which is the `-limitcycles` exit, not a failure.

| Mode | 2,000,000 | 2,500,000 | 3,000,000 | 3,500,000 to 4,500,000 | 5,000,000 | 5,500,000 to 8,000,000 |
|---|---|---|---|---|---|---|
| 1 Inject | all-black frame | `READY.` only | `RUN` / `HELLO, WORLD!` / `READY.` | not run | not run | not run |
| 0 VirtualFS | not run | not run | `LOAD"HELLO.PRG",8,1` typed | `SEARCHING FOR HELLO.PRG` | not run | `?FILE NOT FOUND  ERROR` at 6,000,000 and 8,000,000 |
| 2 Disk image | not run | not run | `LOAD"HELLO",8,1` typed | 4,500,000: all-black frame | `SEARCHING` / `LOADING` / `READY.` / `RUN` / `HELLO, WORLD!` / `READY.` | same as 5,000,000 |

So the smallest `-limitcycles`, to the nearest 500,000, at which the program's
output is on screen is **3,000,000 for mode 1** and **5,000,000 for mode 2**; under
`-default` **mode 0 never shows it**: the typed `LOAD` ends in
`?FILE NOT FOUND  ERROR`. The likely reason is that `-default` turns true drive
emulation on, so unit 8 is an empty 1541 and the host-directory device never
answers; that is an inference, since no run was made with `+drive8truedrive` or a
virtual device enabled, and whether mode 0 works under some other configuration
was not measured here. Two runs produced a frame in which every one of the 104,448 pixels is
(0, 0, 0), border included: mode 1 at 2,000,000 and mode 2 at 4,500,000. The cause
was not established. A machine reset would blank the border like this (the VIC-II
registers read zero after reset), but the mode 2 run at 5,000,000 shows the whole
load already finished, which a reset at 4,500,000 does not leave time for. Treat an
all-black exit screenshot as a cycle count that landed somewhere the frame was not
drawn, not as evidence about the program; move `-limitcycles` and look again.

---

## The Binary Monitor Protocol

VICE exposes a binary remote monitor over TCP when started with `-binarymonitor`. The
default address is `ip4://127.0.0.1:6502`. Port 6502 is named after the
processor.

### Enabling the monitor

```bash
x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502 -autostart hello.prg
```

Once VICE is running, any TCP client can connect and send commands.

### Frame format

Commands and responses share one wire layout:

**Request frame**

| Offset | Length | Field |
|--------|--------|-------|
| 0 | 1 | STX marker: `0x02` |
| 1 | 1 | API version: `0x02` |
| 2–5 | 4 | Payload length (little-endian, header excluded) |
| 6–9 | 4 | Request ID (little-endian, caller-chosen) |
| 10 | 1 | Command opcode |
| 11+ | varies | Command body |

**Response frame**

| Offset | Length | Field |
|--------|--------|-------|
| 0 | 1 | STX marker: `0x02` |
| 1 | 1 | API version: `0x02` |
| 2–5 | 4 | Body length (little-endian) |
| 6 | 1 | Response type |
| 7 | 1 | Error code |
| 8–11 | 4 | Request ID (`0xffffffff` = event-triggered) |
| 12+ | varies | Response body |

Error code `0x00` means success. Other codes: `0x01` object not found, `0x02` invalid
memspace, `0x80` incorrect command length, `0x81` invalid parameter, `0x82` API
version unsupported, `0x83` unknown command, `0x8f` general failure.

### Command opcode table

| Opcode | Name | Description |
|--------|------|-------------|
| `0x01` | Memory Get | Read bytes from an address range |
| `0x02` | Memory Set | Write bytes to an address range |
| `0x11` | Checkpoint Get | Retrieve details of a checkpoint |
| `0x12` | Checkpoint Set | Create a breakpoint or watchpoint |
| `0x13` | Checkpoint Delete | Remove a checkpoint |
| `0x14` | Checkpoint List | Enumerate all checkpoints |
| `0x15` | Checkpoint Toggle | Enable or disable a checkpoint |
| `0x22` | Condition Set | Attach a condition expression to a checkpoint |
| `0x31` | Registers Get | Read current CPU register values |
| `0x32` | Registers Set | Write CPU register values |
| `0x41` | Dump | Save machine state to a VSF snapshot file |
| `0x42` | Undump | Restore machine state from a VSF snapshot file |
| `0x51` | Resource Get | Read an emulator resource/setting |
| `0x52` | Resource Set | Write an emulator resource/setting |
| `0x71` | Advance Instructions | Step over N instructions |
| `0x72` | Keyboard Feed | Inject PETSCII text into the keyboard buffer |
| `0x73` | Execute Until Return | Run until the next RTS or RTI |
| `0x81` | Ping | Connectivity test (echoes request ID) |
| `0x82` | Banks Available | List available memory banks |
| `0x83` | Registers Available | List register names and IDs |
| `0x84` | Display Get | Capture current screen buffer as pixel data |
| `0x85` | VICE Info | Return version and build information |
| `0x86` | CPU History | Return instruction execution history |
| `0x91` | Palette Get | Fetch the current color palette |
| `0xa2` | Joyport Set | Simulate joystick input |
| `0xb2` | Userport Set | Simulate user-port input |
| `0xaa` | Exit | Resume execution (release the monitor) |
| `0xbb` | Quit | Terminate VICE |
| `0xcc` | Reset | Soft or hard reset the machine or a drive |
| `0xdd` | Autostart | Load and execute a named file |

All multi-byte fields in command bodies use little-endian byte order. The memspace
parameter in memory and checkpoint commands takes `0x00` for the main C64 address space
and `0x01`–`0x04` for drives 8–11 respectively.

**Important:** agents should not drive this protocol directly. The vice-mcp server
wraps the protocol in a clean MCP tool surface; see
[vice-mcp-reference.md](vice-mcp-reference.md) for the agent-facing API.

---

## Disk and Tape Handling

VICE attaches disk and tape images as virtual peripheral devices. Device 8 is the
primary disk drive (1541 by default). The relevant attachment flags are `-8 <file>` for
disk images and `-1 <file>` for tape images. `-autostart` also accepts a
disk or tape image path and loads the first file.

### .D64 — Single-sided 35-track 1541 disk image

A D64 file, the standard 1541 disk image, contains 35 tracks of raw sector data.
Sector count varies by zone: tracks 1–17 carry 21 sectors each, tracks 18–24 carry 19
sectors each, tracks 25–30 carry 18 each, and tracks 31–35 carry 17 each; 683 sectors
total. Each sector is 256 bytes, giving a total image size of 174,848 bytes (or 175,531
bytes with the optional per-sector error-code extension). Track 18 / sector 0 holds the
BAM (Block Availability Map) and disk name; the directory occupies track 18 sectors 1–18
and supports up to 144 file entries.

**Produced by:** c1541
**Consumed by:** vice

D64 is the usual format for distributing finished software. It cannot represent
non-standard track layouts or copy-protection schemes; for those cases use G64.

### .G64 — GCR-encoded 1541 disk image

G64 stores raw GCR (Group Code Recording) bitstream data: the flux transitions
the 1541 read head would see. The format supports up to 84 track slots (42 full
tracks plus 42 half-tracks), though standard 1541 media uses only 35. Because the
bitstream is preserved verbatim, G64 can represent disks with non-standard sector
interleavings, custom loaders, weak bits, and copy-protection schemes that D64 cannot
encode. Track size varies by zone, with outer tracks holding more GCR bytes than inner
tracks (approximately 7,692 bytes for tracks 1–17 down to around 6,250 bytes for track
31+).

**Produced by:** c1541
**Consumed by:** vice

Use G64 when the software relies on a non-standard 1541 format, or when a D64 round-trip
loses copy-protection data you need to preserve for testing.

### .T64 — Tape archive (PRG container)

T64 is a container format created for the C64s emulator. It stores one or more PRG
files in a simple 32-byte-aligned directory structure: a 64-byte file header (signature
+ tape version + directory capacity + tape name), followed by 32-byte directory entries
(file type, load address, end address, data offset, filename in PETSCII), followed by
the raw file data. T64 is not a raw tape recording; it is closer to a ZIP file for
PRGs. It has no concept of tape timing or loader protocol. `c1541` can only read a T64
(its `tape` command extracts files from one); it does not write them.

**Consumed by:** vice

T64 can ship a single PRG as a tape image when tape timing is not
required. For raw pulse-level fidelity use TAP.

### .TAP — Raw tape pulse-width data

TAP stores the cassette signal as a sequence of bytes, each representing the time (in
hardware counter units) between successive signal transitions: the pulse widths
the C64 CIA timer measured. A 20-byte file header carries the signature `C64-TAPE-RAW`,
a version byte, three reserved bytes, and a 4-byte little-endian data-area size (the
length excludes the header). Version 0 encodes
each pulse as `period = (8 × byte) / 985248` seconds; a `0x00` byte signals an
overflow. Version 1 reuses `0x00` as an escape: three following bytes give the actual
cycle count for long pulses. Each pulse is one TAP byte, so the file is far larger
than the PRG. KERNAL format spends 40 TAP bytes per payload byte (twenty pulses,
written twice) plus constant leaders: a 202-byte program made a 49,418-byte TAP and a
1,183-byte one 88,658 bytes (measured in
[tape-mastering.md](../toolchains/tape-mastering.md)). A turbo format with one pulse
per bit spends about 8 per byte (arithmetic, not measured here). (An earlier version
said TAP files were typically 8–16 times larger than the PRG, one pulse byte per
source bit.)

**Produced by:** tapclk, mtap
**Consumed by:** vice

TAP is required when the software uses a custom tape loader that relies on pulse timing,
such as Turbo Tape or commercial fast loaders. For simple PRG distribution, T64 is
smaller and easier to work with.

### The c1541 companion utility

`c1541` is a standalone command-line disk-image maintenance tool shipped with VICE. It
can create D64 and G64 images, list and extract files, write PRG files into a disk
image, validate the BAM, inspect block chains, and perform low-level block operations
(peek, poke, fill). It runs in batch mode (prefix commands with `-` to chain them
non-interactively) or interactively with tab completion.

```bash
# Create a fresh D64 and write a PRG into it
c1541 -format "mygame,01" d64 mygame.d64
c1541 -attach mygame.d64 -write hello.prg hello
```

Use `c1541` to build a disk image from one or more compiled PRG files before handing
the D64 to VICE for a run.

---

## Symbol Files

The VICE text monitor (launched interactively or via `-moncommands`) can load symbol
tables that map label names to addresses. The formats:

| Format | Extension | Produced by | Example entry |
|--------|-----------|-------------|---------------|
| Oscar64 label file | `.lbl` | oscar64 (written alongside the `.prg` by default; there is no flag, and `-l` is rejected) | `al 0880 .main` |
| KickAssembler vice symbol file | `.vs` | KickAssembler (`-vicesymbols`) | `al C:1000 .main` |
| cc65 VICE label file | any (`.lbl` by convention) | ld65 via `cl65 -Ln name` | `al 000840 ._main` |

Oscar64 entries carry a bare 4-digit hex address with no `C:` memspace prefix
(`al HHHH .name`, as [../formats/c64-file-formats.md](../formats/c64-file-formats.md)
describes); KickAssembler's `-vicesymbols` output uses `al C:HHHH .name`. The VICE
monitor accepts both, and `break .main` works after `ll` either way. An earlier version
of this table gave Oscar64 a `-l` flag and a `C:` prefix; neither exists. cc65's
`-Ln` file uses six hex digits, no prefix, and a leading underscore on every C
symbol (`_main`, `_cputs`); it also lists the KERNAL names the library imports
(`al 00FFD2 .BSOUT`). `break ._main` after `ll` stopped at `$0840` (measured,
cc65 V2.18, VICE 3.10; the session is in
[../toolchains/cc65-reference.md](../toolchains/cc65-reference.md)).

Load a symbol file in the monitor with:

```
ll "build/hello.lbl"
```

Once loaded, the disassembler, breakpoint expressions, and memory commands can use label
names instead of raw hex addresses, which also applies to monitor sessions with
`vice-mcp`. Load symbols at startup by putting the `ll` command in a file and passing it
via `-moncommands`.

---

## Snapshots

VICE can save and restore complete machine state using the `.vsf` (VICE Snapshot File)
format. A snapshot captures RAM, ROM shadow, CPU registers, CIA state, VIC-II state,
SID state, and optional drive state. ROM images are not embedded in the snapshot.
The file's layout, decoded from a snapshot the windowless x64sc 3.10 wrote (header,
module list, and where the 64 KiB RAM, the processor port and colour RAM sit inside
`C64MEM` and `VIC-II`), is the `.VSF` section of
[../formats/c64-file-formats.md](../formats/c64-file-formats.md).

Save from the text monitor:

```
dump "checkpoint.vsf"
```

Restore:

```
undump "checkpoint.vsf"
```

To restore at startup, either pass the snapshot to `-autostart file.vsf` (restored after
the autostart delay) or put `undump "file.vsf"` in a `-moncommands` file (restored
immediately, before the first instruction). There is no `-snapshot` option; an earlier
version of this page listed one, and x64sc 3.10 rejects it as unknown.

Via the binary monitor, `Dump` (opcode `0x41`) and `Undump` (opcode `0x42`) do the
same over the socket. vice-mcp exposes both operations as MCP tools.

For reproducible automated tests, run to a known program counter, save a snapshot, then
restore it at the start of each test run to remove variable boot-time state.

---

## Region Selection

VICE emulates both PAL and NTSC machines. For cycle-accurate timing work: PAL machines run at 985,248 cycles/second with 312 scan
lines per frame (50 Hz), while NTSC machines run at 1,022,727 cycles/second with 263
scan lines per frame (60 Hz). Raster positions, raster IRQ timing, and the number of
cycles available per frame differ between regions.

Select the region at launch:

```bash
x64sc -pal   -autostart demo.prg    # PAL
x64sc -ntsc  -autostart demo.prg    # NTSC
```

The compiled-in default is a PAL C64 (MachineVideoStandard=1, VICIIModel=1; measured on
x64sc 3.10 with `-default -dumpconfig`, unchanged under en_US, de_DE, ja_JP and C
locales; the locale moves the keyboard mapping, not the video standard). A saved config
file (vicerc) can override it, and `-default` bypasses that file, so pass `-pal`, `-ntsc`
or `-model` explicitly in automated runs. An earlier version of this sentence said the
default depended on the system locale; it does not. If a program behaves differently
under PAL vs NTSC, a raster timing assumption is almost always the cause.

For the hardware differences between PAL and NTSC C64 variants, see
[../hardware/pal-ntsc-reference.md](../hardware/pal-ntsc-reference.md).

---

## Headless and Automated Invocation

An agent (or CI script) running VICE in a build-verify loop needs no GUI, maximum
speed, and a deterministic exit:

1. Compile the PRG with oscar64 or KickAssembler.
2. Launch `x64sc` in warp mode with a binary monitor and a short timeout.
3. Connect via vice-mcp (or a raw TCP client) to set a checkpoint at the expected
   success address.
4. Autostart the PRG; wait for the checkpoint or for the timeout to fire.
5. Optionally capture a screenshot via the `Display Get` (`0x84`) command.
6. Inspect result state; quit VICE via the `Quit` (`0xbb`) command or let
   `-limitcycles` terminate it.

Minimal headless invocation:

```bash
x64sc \
  -warp \
  -limitcycles 10000000 \
  -binarymonitor \
  -binarymonitoraddress ip4://127.0.0.1:6502 \
  -moncommands monitor-init.mon \
  -pal \
  -soundvolume 0 \
  -autostart hello.prg
```

`monitor-init.mon` might contain:

```
ll "build/hello.lbl"
break .success
```

so that vice-mcp can detect the breakpoint hit via a Checkpoint event response
(request ID `0xffffffff`).

For screenshot capture without user interaction, `Display Get` (`0x84`) returns raw
pixel data for the current frame. An agent can record the screen at a given
execution point without a visible window.

On Linux CI, add `Xvfb` or set `SDL_VIDEODRIVER=offscreen` (SDL2 build) to suppress the
display requirement.

### The SID under `+sound`

The pinned headless command passes `+sound`, which is fastest, but then the
SID's read-back registers are wrong: `$D41B` (OSC3) and `$D41C` (ENV3)
follow the emulator's sound buffer, not the voice. A program that reads
them, for random numbers or an envelope follower, needs a sink that clocks
the SID: `-sound -sounddev dump -soundarg /dev/null` (or `wav`). Measured
in the windowless x64sc 3.10, PAL, voice 3 gated with noise, attack 10
(500 ms), both registers read once a frame for 64 frames, two runs each:

| Sink | `$D41C` (ENV3) | `$D41B` (OSC3, noise) |
|---|---|---|
| `+sound` | 1, 201, 145, 89 ...: down 56 a frame, wrapping; not an envelope | 10, 210, 154, 98 ...: the same ramp, 32 values |
| `-sounddev dummy` | 0 every frame | 254 every frame |
| `-sounddev dump` | 6, 16, 26, 37 ...: the attack, about 10 a frame | 56 values of 64: noise |
| `-sounddev wav` | as dump | as dump |

Every sink gave the same bytes on both runs. The template harness takes
`SOUND_SINK := dump` for this. An earlier version of
`docs/workflow/agent-harness.md` withdrew a claim that the dummy driver
breaks these reads, on the evidence of 16 different values from a noise
voice under `+sound`: those were distinct, but they were the ramp above,
not noise. Issue #55's filter build found the same (a six-run probe, not
in this repository).

---

## Reading the exit screenshot

`-exitscreenshot` writes an 8-bit RGBA PNG (IHDR colour type 6, no interlace) of the
whole frame including borders. Everything below was measured on 2026-09-22 from the
two pictures of `docs/recipes/kickassembler/palette-cells.md` and the fourteen
`hello-world` runs above, all VICE x64sc 3.10 with `-default`.

The picture is the draw buffer at the cycle the limit hits, not a finished
frame: the rows the beam has passed in the current field are new and the
rows below it still hold the previous field. Measured 2026-09-23 on the
eight-way scroll recipe while its pin was chosen: cycle limits from
21,000,000 to 21,014,500 gave one identical picture, 21,017,000 differed
from it only in rows 39 to 59, and 21,019,500 only in rows 59 to 98. So a
program that changes what a row shows from one field to the next can be
caught half-way by a pin that lands mid-display, and the split reads as
a fault in the program. Pin in the blank, or where consecutive fields
draw the same thing, and say which on the page.

### Geometry

| | PAL (default, the `c64c` configuration) | NTSC (`-model ntsc`) |
|---|---|---|
| PNG size | 384 x 272 | 384 x 247 |
| Display rows (y) | 35 to 234 | 23 to 222 |
| Display columns (x) | 32 to 351 | 32 to 351 |
| Screenshot row from raster line | y = line - 16 | y = line - 28 |
| Border sample point | (2, 100) | (2, 100) |

The display bounds are the first and last row and column whose pixel is not the
border colour, read off the palette pictures; they agree with the bounds
`docs/pitfalls/cia.md` measured independently for its tenths-of-a-second probe. The
line offsets are `CLAUDE.md`'s figures, derived from three boundaries in
`docs/recipes/kickassembler/topbottom-border-open.md`; they were not re-measured here.
`x = 8` is VIC-II X coordinate 0 (same source, not re-measured).

A text cell is 8 x 8 pixels. Screen row `r` (0 to 24) and column `c` (0 to 39) sit
at

```
x = 32 + 8 * c
y = 35 + 8 * r        # PAL
y = 23 + 8 * r        # NTSC
```

so the centre of a cell is `(x + 4, y + 4)`, which is the safe place to sample a
colour. Any pixel in the left border (x 0 to 31) reads the border colour; (2, 100)
is used throughout the KB because it is inside the display's vertical range on both
models, well clear of the corner. `hello-world`'s `HELLO, WORLD!` at screen row 7 is
at y 91 to 98 on PAL: the decoder below finds it there, which is the check that the
arithmetic is right.

### The default palette

With `-default` VICE 3.10 uses its internally generated palette, not one of the
`.vpl` files in its data directory: the sixteen triples below match none of the
27 files installed under `/opt/homebrew/opt/vice/share/vice/C64/`, compared entry
for entry. The triples come from the palette recipe, one solid 32-cell band per
colour index, all 2,048 pixels of each band identical.

| Index | PAL RGB | NTSC RGB | Index | PAL RGB | NTSC RGB |
|---|---|---|---|---|---|
| 0 | (0, 0, 0) | (0, 0, 0) | 8 | (183, 99, 30) | (196, 98, 65) |
| 1 | (255, 255, 255) | (255, 255, 255) | 9 | (119, 83, 0) | (151, 64, 0) |
| 2 | (175, 60, 88) | (169, 71, 100) | 10 | (238, 123, 149) | (230, 134, 163) |
| 3 | (126, 243, 214) | (138, 230, 203) | 11 | (98, 98, 98) | (98, 98, 98) |
| 4 | (170, 64, 245) | (154, 88, 185) | 12 | (148, 148, 148) | (148, 148, 148) |
| 5 | (98, 213, 50) | (114, 189, 103) | 13 | (183, 255, 134) | (198, 255, 186) |
| 6 | (44, 61, 236) | (25, 73, 180) | 14 | (115, 133, 255) | (98, 145, 251) |
| 7 | (255, 255, 70) | (255, 248, 141) | 15 | (205, 205, 205) | (205, 205, 205) |

The PAL column is the default machine, the `c64c` (8565) configuration, not
the 6569. Under `-model c64` (6569) indices 0, 1, 11, 12 and 15 match the
default's and the other eleven differ. Measured 2026-09-23 from the
`palette-cells` listing run with `-model c64`, one triple per band (each band
uniform); its default run matched the committed PNG pixel for pixel:

| Index | `-model c64` | Index | `-model c64` |
|---|---|---|---|
| 2 | (171, 60, 101) | 8 | (183, 100, 24) |
| 3 | (135, 240, 203) | 9 | (129, 76, 0) |
| 4 | (178, 61, 239) | 10 | (234, 121, 163) |
| 5 | (94, 214, 56) | 13 | (178, 255, 141) |
| 6 | (58, 49, 255) | 14 | (129, 120, 255) |
| 7 | (255, 255, 59) | | |

An earlier version of this section did not say which PAL chip the column
was, and the next one compared index 5 only.

Indices 0, 1, 11, 12 and 15 are the same on both models; the other eleven differ,
so a script that recognises colours by exact triple needs a table per model. The
power-on screen is index 6 on index 14: PAL (44, 61, 236) text area, (115, 133, 255)
border, as every `hello-world` run above shows. A screenshot taken with a user
configuration, another VICE version or `-VICIIextpal` will not match this table;
run the palette recipe on that setup first.

### Decoding with PIL

```python
from PIL import Image
im = Image.open('out.png').convert('RGB')
px = im.load()
w, h = im.size                     # (384, 272) PAL, (384, 247) NTSC
y0 = 35 if h == 272 else 23
border = px[2, 100]
def cell_colour(row, col):         # centre pixel of a text cell
    return px[32 + 8*col + 4, y0 + 8*row + 4]
```

To read text, compare each cell's 8 x 8 pattern with the character ROM. Take the
text area's most common colour as background; a pixel is "ink" if it differs from
it. Each glyph in `chargen-901225-01.bin` is eight bytes, bit 7 the leftmost pixel;
the first 2 KiB is the upper-case/graphics set the machine powers on with, codes 0
to 255. Codes 128 to 255 are the reversed forms, stored as separate glyphs: 127 of
them are the exact complement of code - 128, and one is not. Reversed `@` (code 128)
has row 6 as `$99` where the complement of `@`'s `$62` would be `$9D`, one pixel
different (ROM bytes read on this machine; the lower-case set at offset 2048 has the
same single exception). Build the lookup from the ROM bytes, not from complementing,
and match the packed rows:

```python
rom = open('/opt/homebrew/opt/vice/share/vice/C64/chargen-901225-01.bin', 'rb').read()
glyph = {}
for code in range(256):
    glyph.setdefault(tuple(rom[code*8:code*8+8]), code)   # first code wins: $20 for blank, not $60
def cell_code(row, col, bg):
    return glyph.get(tuple(
        sum((px[32 + 8*col + xx, y0 + 8*row + yy] != bg) << (7 - xx) for xx in range(8))
        for yy in range(8)))
```

Screen codes 1 to 26 are `A` to `Z`, `$20` to `$3F` are space, punctuation and
digits as in ASCII, 0 is `@`. Two blank glyphs share the all-zero pattern (`$20`
space and `$60` shifted space); `setdefault` keeps the lower code. Reversed text
comes back as code + 128 because the ROM holds those forms; mask with `& 0x7f` to
get the character, and note the palette recipe's solid bands are `$A0`, reversed
space. A cell whose pattern is not in the table returns `None`: a sprite, a custom
character set, a colour that happens to equal the background, or a screenshot taken
mid-frame with two frames' contents in it.

### Decoding without PIL

The PNG is small enough to decode in pure Python. Concatenate the `IDAT` chunks,
`zlib.decompress` them, and undo the per-row filter byte (0 none, 1 Sub, 2 Up,
3 Average, 4 Paeth; the two palette PNGs use 1, 2 and 4). Each row is one filter
byte followed by `384 * 4` bytes of RGBA. A 40-line implementation of that on this
machine returned the same border pixel and the same sixteen triples as PIL from
both palette pictures. Ignore the alpha byte; every pixel VICE wrote had it at 255
in the pictures checked, but nothing here depends on that.

---

## Verifying a run without a human

A test program can grade itself and leave the verdict where a script can
read it. The pattern, and three routes for reading it back, were measured
on 2026-09-22 with VICE x64sc 3.10 `-default` and the two `headless-verify`
recipes (`docs/recipes/kickassembler/headless-verify.md`,
`docs/recipes/oscar64/headless-verify.md`). Every exit code quoted below
came from a run on this machine.

### The result-byte contract

The program does its computation, then, at one checkpoint and in this
order:

1. stores a result code at `$02FF`: `$01` pass, `$02` fail;
2. sets the border (`$D020`) to 5 (green) on pass or 2 (red) on fail;
3. prints the code and returns to BASIC.

`$02FF` is the last byte of the KERNAL's unused `$02A7`-`$02FF`
(`docs/hardware/c64-memory-map.md`); BASIC does not touch it after the
program returns, so the exit screenshot and a late memory read see the
same value. It is not untouched before the program runs: the KERNAL reset
clears page 2 (`STA $0200,Y` at `$FD56`, `A = 0`, cycle 5305 in the
monitor log), so `$02FF` is `00` when the program starts and a store
watchpoint on it fires once at boot. Codes therefore start at `01`, and a
harness that reads `00` has a program that never reached its checkpoint,
which is a different failure from `02`.

The harness returns the verdict as a shell exit code: 0 pass, 1 fail,
2 no verdict. `x64sc`'s own exit status was 1 on every `-limitcycles` run
made for this section, pass or fail; it carries nothing.

### Route 1: the exit screenshot

No monitor, no second process: run the pinned command and read the border
pixel. The palette triples are the ones in "The default palette" above,
selected by the picture's height.

```bash
#!/bin/bash
# usage: verdict_shot.sh prog.prg [pal|ntsc]   exit 0 = PASS, 1 = FAIL, 2 = no verdict
prg=$1; model=${2:-pal}; shot=$(mktemp -t verdict).png
flags=""; [ "$model" = ntsc ] && flags="-model ntsc"
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 $flags \
  -exitscreenshot "$shot" -autostart "$prg" >/dev/null 2>&1
python3 - "$shot" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
pal = im.size[1] == 272
green = (98, 213, 50) if pal else (114, 189, 103)     # index 5
red   = (175, 60, 88) if pal else (169, 71, 100)      # index 2
border = im.getpixel((2, 100))
verdict = {green: 0, red: 1}.get(border, 2)
print('border', border, ['PASS', 'FAIL', 'NONE'][verdict])
sys.exit(verdict)
PY
```

Measured: the KickAssembler recipe on PAL printed `border (98, 213, 50)
PASS` and exited 0; the Oscar64 recipe built with `FORCE_FAIL 1` (the
define is now `FORCE_FAULT`, set with `-dFORCE_FAULT=1`) on NTSC
printed `border (169, 71, 100) FAIL` and exited 1. The route reads only
the border, so it tells pass from fail from "still the power-on light
blue"; it cannot read the code itself. For that, decode row 7 with the
char ROM snippet above (`RESULT 01 PASS` or `RESULT 02 FAIL` in the
recipes), or use a machine route.

**Palette-safe grading by channel dominance.** The exact-triple test
above fails closed on any picture that did not come from `-default` on
this VICE version: a `.vpl` palette, another release, a capture from a
real machine. When the program paints only index 5 or index 2, grade by
which channel dominates instead:

```python
def is_green(c): return c[1] > c[0] + 60 and c[1] > c[2] + 60
def is_red(c):   return c[0] > c[1] + 60 and c[0] > c[2] + 60
verdict = 0 if is_green(border) else 1 if is_red(border) else 2
```

Against the triples in "The default palette": PAL green (98, 213, 50) has
G over R by 115 and over B by 163; NTSC green (114, 189, 103) by 75 and
86. PAL red (175, 60, 88) has R over G by 115 and over B by 87; NTSC red
(169, 71, 100) by 98 and 69. The power-on border, index 14, is neither on
either model. Any margin up to 68 accepts NTSC red, whose R exceeds B by
69; sixty leaves a little room and was the value checked. Run over all
sixteen triples of both models
(arithmetic from the table), `is_green` also accepts index 13, light
green, on PAL (G over R by 72; on NTSC only by 57, so it is rejected
there), and `is_red` also accepts 8 and 10 on both models and 9 on NTSC.
Measured on the six exit screenshots of the Oscar64 `headless-verify`
recipe (default, `-dAUTOPILOT=1` and `-dFORCE_FAULT=1`, PAL and NTSC),
the dominance test and the exact-triple test gave the same verdict on
every one.

The exact triple remains the right test when the harness must tell the
pass shade from any other green, index 13 in particular, or red from
orange and light red; a program that uses those colours elsewhere on the
screen, or a bar that grades several things by shade, keeps the table
per model. It is also the test `npm run verify:recipes` implies, since
that compares whole pictures.

### Route 2: the machine, over `-moncommands`

A `-moncommands` file runs at startup, before the program, so it cannot
dump `$02FF` directly. It can arm a tracepoint that dumps it when the store
happens, and log everything the monitor prints to a file:

```
logname "/tmp/verdict.log"
log on
trace store 02ff
command 1 "m 02ff 02ff"
```

`trace` does not stop the machine; `command 1` runs the memory dump each
time checkpoint 1 hits; `-limitcycles` still ends the run. The log from
the green KickAssembler build:

```
#1 (Trace store 02ff)   84/$054,  13/$0d
.C:fd56  99 00 02    STA $0200,Y    - A:00 X:FF Y:FF SP:fd N.-..I.C       5305
Executing: m 02ff 02ff
>C:02ff  00
#1 (Trace store 02ff)  129/$081,   2/$02
.C:086f  8D FF 02    STA $02FF      - A:01 X:00 Y:05 SP:f6 ..-....C    2995841
Executing: m 02ff 02ff
>C:02ff  01
```

The first hit is the reset clearing page 2; the second is the program.
The dump runs after the store: the value on the second hit is `01`, not
the `00` that was there before it. A harness takes the last `>C:02ff`
line:

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 \
  -moncommands verdict.mon -autostart prog.prg >/dev/null 2>&1
code=$(grep '^>C:02ff' /tmp/verdict.log | tail -1 | awk '{print $2}')
case "$code" in 01) exit 0;; 02) exit 1;; *) exit 2;; esac
```

### A windowless build for batch runs

The GTK build opens a window on every launch and takes the desktop's focus,
so a verifier run over the recipes keeps interrupting the desktop;
`-minimized` does not help, because the window still activates before it shrinks.
VICE 3.10 ships a third front end besides GTK and SDL: configure the
source with `--enable-headlessui` and the resulting `x64sc` has no window,
no Dock tile and never registers with the window server, while the exit
screenshot still works because it is taken from the emulated frame in the
machine core. Measured 2026-09-22 on macOS: the headless build's exit
screenshots for four pinned recipes, PAL and NTSC, were byte-identical to
the pins, and the process never appeared in LaunchServices while a GTK
instance next to it was listed as the frontmost application. Two caveats:
a build that is not installed needs `-directory <vice data dir>` and
it must come after `-default`, because `-default` resets the search path;
and the exit status on the cycle limit is 1 by design in both builds. The
build takes under a minute (`brew install dos2unix xa` first; a plain
top-level `make` succeeds where `make x64sc` races). In this repository `npm run vice:headless` builds one into `.tools/` with
the tarball digest pinned and a wrapper that inserts `-directory`, and every
emulator launch (the verifier, the run tool) prefers it when present, with
`X64SC_BIN` as an override; every command on this page runs unchanged under
it.

The red Oscar64 build logged `00` then `02` with this file. Do not use
`watch` or `break` here: a stopping checkpoint enters the monitor with
nothing to type `x`, cycles stop counting, `-limitcycles` never fires and
the run hangs. Measured: `watch store 02ff` with the same `command`
line sat until `timeout 180` killed it (exit 124) and the log was empty.
The `command` text is one monitor command; whether it can chain a
continue was not measured here.

### Route 3: the machine, over the binary monitor

A Python client that speaks the frame format in "The Binary Monitor
Protocol" above. It sets a store watchpoint on `$02FF` first and only then
autostarts the program from the monitor, because a client that connects
to an already-autostarted VICE in warp mode is too late: a first version
that passed `-autostart` on the command line missed the store on every
run and reported no verdict. Each stop is handled the same way: read
`$02FF`; if it is `01` or `02` that is the verdict, otherwise resume.

```python
#!/usr/bin/env python3
"""Run a PRG in x64sc, watch $02FF over the binary monitor, exit 0 on PASS ($01), 1 on FAIL ($02), 2 otherwise."""
import socket, struct, subprocess, sys, time, os

PRG = sys.argv[1]
PORT = 6502
env = dict(os.environ, GSETTINGS_SCHEMA_DIR='/opt/homebrew/share/glib-2.0/schemas')
vice = subprocess.Popen(['x64sc', '-default', '-warp', '+sound', '+autostart-delay-random',
                         '-autostartprgmode', '1', '-limitcycles', '8000000',
                         '-binarymonitor', '-binarymonitoraddress', 'ip4://127.0.0.1:%d' % PORT],
                        env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def frame(op, body=b'', rid=1):
    return b'\x02\x02' + struct.pack('<II', len(body), rid) + bytes([op]) + body

def recvn(s, n):
    buf = b''
    while len(buf) < n:
        chunk = s.recv(n - len(buf))
        if not chunk:
            raise EOFError
        buf += chunk
    return buf

def response(s):
    stx, api, blen, rtype, err, rid = struct.unpack('<BBIBBI', recvn(s, 12))
    return rtype, err, rid, recvn(s, blen)

def wait_for(s, rtype, rid=None):
    while True:
        t, e, r, body = response(s)
        if t == rtype and (rid is None or r == rid):
            return e, body

s = None
for _ in range(100):                      # VICE takes a moment to open the port
    try:
        s = socket.create_connection(('127.0.0.1', PORT), timeout=1)
        break
    except OSError:
        time.sleep(0.1)
if s is None:
    sys.exit(2)
s.settimeout(30)

# Checkpoint Set (0x12): start, end, stop, enabled, operation (2 = store), temporary, memspace
s.sendall(frame(0x12, struct.pack('<HHBBBBB', 0x02ff, 0x02ff, 1, 1, 2, 0, 0), rid=10))
err, info = wait_for(s, 0x11, 10)
# Autostart (0xdd) only now, so the watchpoint is in place before the program runs:
# run after load, file index, filename length, filename
name = os.path.abspath(PRG).encode()
s.sendall(frame(0xdd, struct.pack('<BHB', 1, 0, len(name)) + name, rid=11))
err, _ = wait_for(s, 0xdd, 11)
verdict = 2
try:
    while True:
        e, body = wait_for(s, 0x62)          # Stopped event: body is the PC
        pc = struct.unpack('<H', body[:2])[0]
        # Memory Get (0x01): side effects, start, end, memspace, bank
        s.sendall(frame(0x01, struct.pack('<BHHBH', 0, 0x02ff, 0x02ff, 0, 0), rid=20))
        e, body = wait_for(s, 0x01, 20)
        value = body[2]                      # u16 length, then the bytes
        print('stopped at PC=$%04X  $02FF=$%02X' % (pc, value))
        if value in (1, 2):
            verdict = 0 if value == 1 else 1
            break
        s.sendall(frame(0xaa, rid=30))       # Exit the monitor: resume
        wait_for(s, 0xaa, 30)
except (EOFError, socket.timeout):
    print('VICE went away before a verdict was stored')
try:
    s.sendall(frame(0xbb, rid=40))           # Quit VICE
    wait_for(s, 0xbb, 40)
except (EOFError, socket.timeout, OSError):
    pass
vice.wait(timeout=30)
print('verdict', ['PASS', 'FAIL', 'NONE'][verdict])
sys.exit(verdict)
```

Measured output, green KickAssembler build:

```
stopped at PC=$FD59  $02FF=$00
stopped at PC=$0872  $02FF=$01
verdict PASS
```

exit 0; red Oscar64 build: `PC=$FD59 $02FF=$00`, `PC=$08C6 $02FF=$02`,
`verdict FAIL`, exit 1. The stop lands after the store (the PC is the
next instruction, `$FD59` after the three-byte `STA $0200,Y` at `$FD56`),
so the read is the stored value. The body layouts in the comments are
the ones VICE 3.10 accepted; they were taken from the VICE binary monitor
documentation and confirmed only by these runs, not by a wider survey of
the protocol. The event type `0x62` (stopped) is not in the opcode table above,
which lists commands only; the reply to Checkpoint Set arrives as type
`0x11` and the Autostart reply echoes `0xdd`. If VICE exits on `-limitcycles` before a verdict is
stored the socket closes, `recvn` raises `EOFError`, and the script exits
2.

### Choosing a route

The screenshot route needs nothing but the pinned command and is the one
`npm run verify:recipes` already exercises; it sees the border, not the
code. The `-moncommands` route sees the byte and needs no second process,
but its output is a text log to parse. The binary monitor route sees the
byte, the PC and anything else in the machine, and ends the run itself
with `Quit` instead of waiting for the cycle limit; it is the one to grow
into a test runner. All three agree on both builds. None of them was run
against `sim6502-reference.md`'s VICE backend, which uses a different
server on port 6510.

### Pressing the joystick headless

Joyport Set (`0xa2`, body: port and value, two little-endian words) and
the text monitor's `jpdb <port> <value>` set a control port's lines only
when that port holds device 37, "Joyport I/O simulation"
(`-controlport2device 37`). Port 0 is control port 1, port 1 is control
port 2. The value is the lines as `$DC00` reads them, active low: `$FF`
is nothing pressed, `$EF` is fire. The device starts with every line low,
all four directions and fire held, so set `$FF` before the program reads
the port. Measured in the windowless x64sc 3.10: a program that waits for
fire on `$DC00` saw the press with device 37 and never with the default
joystick device, which ignores the command. The starters under
`templates/` once said the windowless build's joyport commands never reach
`$DC00`; that was the default device. An Undump restores the device the
snapshot was taken with: after undumping a default-device snapshot, the
press did not arrive.

A run repeats exactly when time is counted in frames and the machine starts
under the monitor's control. Two exec checkpoints over `$0000-$FFFF`, with
the conditions `RL == $00` and `RL == $80`, are enabled in turn, so the
machine stops at the first instruction of raster line 0 once a frame
(about 500 frames a second of wall time here). The start: connect, set
`$FF`, Reset (`0xcc`, type 1, a power cycle), then Autostart (`0xdd`).
Measured: the platformer starter's title came 190 frames in, six runs of
six; autostarted from the command line instead, and stopped when the
client connected, it came 180, 185 or 190 frames in. `-initbreak` does not
help: with no client connected yet it opens the text monitor, which reads
end of input and lets the machine run. A fire press at a fixed frame gave
the same CIA1 timer A reading on three PAL and three NTSC runs.
`templates/_harness/drive.py` does all of this; `make joyprobe` in any
starter is its proof.

VICE's event history (`-playback`, `-eventsnapshotdir`) is not a way in.
In 3.10 `-playback` sets a CPU trap while the command line is parsed, and
the power-on reset during initialisation clears pending traps
(`interrupt_cpu_status_reset` in `src/interrupt.c`, source read, not
traced). No monitor command starts playback, and the windowless build has
no menu. Measured once: an end snapshot carrying a hand-written `EVENT`
module (one fire press) and its start snapshot, played with `-playback`,
left the machine at the READY prompt with the start snapshot never loaded.

### Checking every store against the claims: `scripts/claims-watch.ts`

Route 2 applied to every store a program makes. The script runs a PRG
windowless with `trace store` on `$0000-$03FF`, `$D000-$DFFF` and
`$FFFA-$FFFF` (add `--all-ram` for `$0400-$CFFF` and `$E000-$FFF9`), and
checks each store against what the program declared:

```bash
node scripts/claims-watch.ts game.prg --recipe docs/recipes/kickassembler/x.md \
  --technique ram_under_kernal --claim 'zero_page $02-$39' \
  --range 'screen=$0400-$07FF,colour=$D800-$DBFF' --screen 0400 \
  --harness cia2_timer_a,cia2_timer_b --kernal IRQ,CHROUT --all-ram
```

- `--technique` and a recipe's `techniques:` add each technique's
  `**Claims:**` units, and those of the techniques it REQUIRES. A technique
  with no Claims line is named in the output; declare its units with
  `--claim`, in the Claims-line grammar.
- `--range` is the program's own RAM. The PRG's load span is always declared.
  Colour RAM counts as RAM here, not as a unit.
- `--harness` names measurement timers and counters. Their stores are
  listed apart and never fail the run.
- `--kernal` names the routines the program calls; `IRQ` and `NMI` name the
  two services. A KERNAL zero-page store must lie inside the union of their
  `(may; ...)` sets in `kernal-routines-reference.md`.

Exit 1 on a program store to a unit or byte nobody declared (or declared
`reads` only), on a KERNAL zero-page store outside the may-sets, or on a
store the watch cannot attribute (see the banking bullet below).

How it reads the log (VICE x64sc 3.10, measured):

- The register line of a store hit shows the registers after the
  instruction: a PHA logged `SP:f5` and stored `$01F6`. The hit does not
  log the byte written. So STA, STX and STY give the value, and a push
  lands at `$0100 + SP + 1` to `+3`. Pushes are dropped; other stores to
  page 1 are judged like any RAM.
- A read-modify-write logs one hit (two `DEC $01` gave two hits). On `$00`
  and `$01` the watch computes the new byte from the last one: INC, DEC,
  ASL, LSR, and ROR (its new bit 7 is the N flag after it). ROL's new
  bit 0 is the carry it shifted in, which the log does not show, so ROL
  leaves the port unknown unless Z is set.
- An I/O store counts against a unit only for the bits it changes, by the
  last value stored there: `STA $D015` with `$03` over `$01` touches
  sprite 1 only. The first `STA $D011` of a program usually clears bit 7
  that the KERNAL's boot left set (`$9B`), which touches `vic_raster_irq`.
  A read-modify-write touches every unit bit of its register.
- `$D019` and the CIA interrupt control registers `$DC0D`/`$DD0D` are read
  by the value, not the change. On `$D019` a 1 bit acknowledges its source.
  On an ICR, bits 0-4 name the sources whose mask bit the write sets
  (bit 7 = 1) or clears (bit 7 = 0); timer A is bit 0, timer B bit 1, the
  TOD alarm bit 2 (`cia-reference.md`). `lda #$7f : sta $dc0d` touches
  `cia1_timer_a`, `cia1_timer_b` and `cia1_tod`. Before this rule the
  write changed no unit's bits and was reported as unowned I/O.
- A store is the KERNAL's when its PC is `$E000` or above and HIRAM is set
  in the last value stored to `$01`; BASIC's when `$A000-$BFFF` with LORAM and
  HIRAM set; otherwise the program's. So code in RAM under a banked-out
  KERNAL is attributed to the program. While `$01` is unknown (after a
  ROL), a store from `$A000-$BFFF` or `$E000-$FFFF` could be either, and it
  fails the run as unattributed. An earlier version assumed ROM there, and
  also left `$01` unknown after any INC or DEC: a program that banked the
  KERNAL out with `dec $01` and wrote the SID from `$E000` passed.
- Judging starts at the `SYS` address of the BASIC stub (a `trace exec`
  there). At the first execution of BASIC's READY entry, `$A474`, with
  BASIC ROM mapped in, the watch stops judging ROM stores: the
  KickAssembler file round trip, which returns to BASIC, was flagged for
  `$9D` before this cut, because READY calls SETMSG. The program's own
  stores after READY (its IRQ or NMI handler) are still judged. An earlier
  version stopped judging everything at `$A474`, and took a jump to RAM at
  `$A474` with BASIC banked out as READY; both let a violation pass.

Four recipes, built and run with `--all-ram` at 8,000,000 cycles PAL (the
file round trip at 40,000,000 with a fresh D64):

| Recipe | Declared from the page alone: violations | What had to be added to pass |
|---|---|---|
| `kickassembler/sprite-multiplex-game` | `irq_vector_fffe`, `nmi_vector_fffa`, zero page `$02-$39`, screen, colour RAM, `cia2_timer_a`, `cia2_timer_b`; since the ICR rule also `cia1_timer_a`, `cia1_timer_b`, `cia1_tod` (`sta $dc0d`) and `cia2_tod` (`sta $dd0d`) | `ram_under_kernal` (the recipe banks the KERNAL out; its `techniques:` omitted it until #35), the zero page, the screen and colour RAM, the two timers and `cia2_tod` as harness, `cia1_timer_a (init), cia1_timer_b (init), cia1_tod (init)` |
| `kickassembler/scroll-panel-split` | `irq_vector_fffe`, screen `$0400-$0747`, panel `$0F20-$0FE7`, `$3FFF`, colour RAM | `ram_under_kernal` (added to `techniques:` in #35), the ranges; `soft_scroll_v` and `char_scroll_buffer_v` had no Claims line (now `none`) |
| `oscar64/sfx-engine` | Oscar64 runtime zero page (`$0D-$56` seen), BSS, its stack at `$9FFC-$9FFF`, screen, colour RAM, `cia1_timer_a` | the zero page, the map file's BSS and stack, the screen and colour RAM, `cia1_timer_a` as harness |
| `kickassembler/file-io-roundtrip` | `cia2_timer_a`, `cia2_timer_b` | the two timers as harness; every KERNAL zero-page store fell inside the ten routines' may-sets |

A variant of the multiplexer with `sta $d40b` and `sta $fb` added at its
entry failed with exactly those two stores, `sid_voice_2` and zero page
`$FB`. The KERNAL's serial routines in the file round trip write
`cia1_timer_b`: `STA $DC07` and `STA $DC0F` at `$ED94`/`$ED99` and
`$EE22`/`$EE27` (ROM bytes `8D 07 DC`, `8D 0F DC`). The count varies by
run (212 and 314 seen). A program that owns `cia1_timer_b` loses it
across a disk call.

Four probes, built with KickAssembler and run in x64sc, fail on their
`sta $d40b`: an IRQ handler that writes it after the program returns to
BASIC; a jump to `$A474` with BASIC banked out; `dec $01` twice, then code
at `$E000`; `rol $01`, then code at `$A000` (unattributed).

What the watch does not see:

- Writes by DMA (an REU, a cartridge) are not CPU stores, and `trace store`
  is not expected to log them (not measured here).
- The register mirrors (VIC `$D040-$D3FF`, SID `$D420-$D7FF`, each CIA's
  `$xx10-$xxFF`) are not mapped to units: a store to one is reported as
  unowned I/O and never fails the run.
- ROM stores to I/O and RAM outside zero page are listed, not judged; after
  READY, ROM stores are dropped.
- Without `--all-ram`, stores to `$0400-$CFFF` and `$E000-$FFF9` are not
  traced.
- A read-modify-write on an I/O register is valued as unknown, so it
  touches every unit bit there.

---

## Text monitor for debugging

Everything in this section was measured on 2026-09-22 with VICE x64sc
3.10 `-default` (PAL) on the PRG built from
`docs/recipes/kickassembler/stable-raster-irq.md` with `-vicesymbols`.
Every command and output line below is quoted from those sessions.
Disassembly from the monitor is the subject of
[issue #3](https://github.com/bdgscotland/c64-kb/issues/3) and is not
covered here.

### Getting a prompt

The GTK build's `-console` flag does not put the monitor on stdio. With
`-console`, a `-moncommands` file containing `break .start`, and stdin
fed from a pipe or a pty, the machine stopped at the breakpoint (it never
reached `-limitcycles`) but no stop line and no prompt ever appeared on
stdout: `timeout 60` killed it and a `logname`/`log on` monitor log stayed
empty. The route that works headless is the remote
text monitor, a TCP port that speaks the same commands:

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas timeout 180 x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 6000000 \
  -remotemonitor -remotemonitoraddress ip4://127.0.0.1:6510 \
  -moncommands session.mon -autostart stable-raster-irq.prg
```

`session.mon` loads the labels and arms the first stop before the program
runs:

```text
ll "stable-raster-irq.vs"
break .start
```

Connect to the port with a TCP client, and connect it before the first
checkpoint fires. A stop with no client connected leaves the machine
stopped with no way in: a client that connected 8 seconds after launch,
once `break .start` had already fired, received nothing, its `r` and `x`
got no reply, and x64sc was still stopped 20 seconds later when it was
killed. That is the same hang as `-console`. Under `-warp` the `break
.start` stop fired 0.40 s after launch (the client had connected at
0.09 s) and a boot-time watch fires sooner still, so start the client
from the same script and poll the port from the moment x64sc is
launched; the sessions here used a Python socket polling every 0.3 s for
the break and every 0.01 s for the watch, which the slower poll missed
twice. `nc 127.0.0.1 6510` by hand only works when the first stop is far
enough out: drop `-warp`, or arm the watch from the prompt after a
scripted first break. Once the client is connected VICE writes each stop
to it and reads commands from it. Port 6510 is the one
`sim6502-reference.md`'s VICE backend uses;
choose another if both run. `-initbreak 0x900` (or `-initbreak 2304`)
sets the same first breakpoint with no file and no labels. `-initbreak
$0900` is refused before the emulator starts:

```text
Argument '$0900' not valid for option `-initbreak'.
Error parsing command-line options, bailing out. For help use '-help'
```

### The stop and the register line

```text
#1 (Stop on  exec 0900)   36/$024,  59/$3b
.C:0900  78          SEI            - A:00 X:00 Y:00 SP:f6 ..-.....    2970383
(C:$0900)
```

The first line is the checkpoint number, its kind and address, then the
raster line and the cycle within it, each as decimal/hex (0-based, and
what it counts depends on the checkpoint: "What the CYC column counts"
below). The second is
the instruction about to execute, not yet executed: memory space and PC,
opcode bytes, the disassembly with labels substituted, the registers, the
flags as `NV-BDIZC` with a letter for set and `.` for clear, and the
stopwatch, a cycle count since power-on. The prompt carries the current
address.

`r` prints the same state as a table:

```text
(C:$0900) r
  ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH
.;0900 00 00 00 f6 2f 37 00100000 036 059    2970383
```

`00` and `01` are the 6510 port bytes at `$0000` and `$0001`. `LIN` and
`CYC` are the raster line and the cycle within it, decimal. Two steps
later (`SEI` then `LDA #$7F`, 2 cycles each) the line read `037 000` at
stopwatch `2970387`: cycle 59 plus 4 is 63, which wraps to cycle 0 of the
next line. That is the PAL 63 cycles per line, seen from the register
line.

### step, next and until

```text
(C:$0900) step
.C:0901  A9 7F       LDA #$7F       - A:00 X:00 Y:00 SP:f6 ..-..I..    2970385
(C:$0901) step
.C:0903  8D 0D DC    STA $DC0D      - A:7F X:00 Y:00 SP:f6 ..-..I..    2970387
(C:$0903) next
.C:0906  AD 0D DC    LDA $DC0D      - A:7F X:00 Y:00 SP:f6 ..-..I..    2970391
```

`step` (abbreviation `z`) executes one instruction and prints the next.
`next` (`n`) does the same but runs a `JSR` through to its `RTS` as one
instruction. Both take an optional count. `until .irq2` (`un`) sets a
one-shot breakpoint and resumes; it printed `UNTIL: 2  C:$0976  (Stop on
exec)`, and when another checkpoint fired first that one won and the
one-shot stayed armed. `x` resumes.

### break, watch and conditions

The monitor's own `help` lines:

```text
Syntax: break [load|store|exec] [address [address] [if <cond_expr>]]
Syntax: watch [load|store|exec] [address [address] [if <cond_expr>]]
Syntax: condition <checknum> if <cond_expr>
```

`break` defaults to `exec`; `watch` defaults to `load` and `store`
(`watch .irq2_line` was listed as `WATCH: 2  C:$09d8  (Stop on load
store)`). A store watchpoint on a program variable fires before the
program runs,
because the KERNAL reset's RAM test writes every byte. `watch store
.irq2_line` in the `-moncommands` file stopped three times at boot:

```text
#1 (Stop on store 09d8)   24/$018,  50/$32
.C:fd73  91 C1       STA ($C1),Y    - A:55 X:00 Y:D8 SP:fd ..-..I.C      80186
```

then at `$FD7A` with `A:AB` and `$FD81` with `A:00`, and only on the
fourth `x` at the program's own store, with the label in the operand:

```text
#1 (Stop on store 09d8)   68/$044,  23/$17
.C:09be  8D D8 09    STA .irq2_line - A:4C X:01 Y:00 SP:f0 ..-..I..    2972363
```

Type `x` through the boot hits, or arm the watch from the prompt after a
breakpoint in the program.

A condition compares registers (`A`, `X`, `Y`, `PC`, `SP`, `FL`), `RL`
(the raster line), `CY` (the cycle within it) or memory
(`@io:$d020 == $f0`) with `==`, `!=`, `<`, `>`, `<=`, `>=`, and joins
them with `&&`, `||` and arithmetic. `break .bar_line if Y == 3` in the
`-moncommands` file stopped at:

```text
#1 (Stop on  exec 098e)   64/$040,  13/$0d
.C:098e  A9 01       LDA #$01       - A:06 X:00 Y:03 SP:f0 ..-..I..    2972101
(C:$098e) break
BREAK: 1  C:$098e  (Stop on exec)
	Condition: Y == $03
(C:$098e) cond 1 if Y == 1
Setting checkpoint 1 condition to: Y == $01
(C:$098e) x
#1 (Stop on  exec 098e)   66/$042,  13/$0d
.C:098e  A9 01       LDA #$01       - A:06 X:00 Y:01 SP:f0 ..-..I..    2972227
```

`break` or `watch` with no argument lists the checkpoints of that kind.
`delete 1` removes one; `delete` alone prints `Deleting all checkpoints`.
Numbers are reused: after deleting checkpoints 1 and 2 the next `break`
was numbered 1 again. `cond` on a number that does not exist says `#3 not
a valid checkpoint`. A bare number in a condition is hex: `break
.bar_line if RL == 70 && Y == 2` was echoed as `Setting checkpoint 3
condition to: RL == $70 && Y == $02`, which is raster line 112, not 70.
Write `RL == $c8` or `RL == c8` for line 200.

### Measuring cycles between two points

Two register lines at the same breakpoint, one `x` apart. `.bar_line` is
the top of the recipe's one-raster-line loop:

```text
.;098e 3c f0 06 f0 2f 37 00100100 061 013    2971912
.;098e 06 00 05 f0 2f 37 00100100 062 013    2971975
```

2971975 − 2971912 = 63 cycles: `LIN` went up by one and `CYC` stayed at
13. The third hit was at 2972038, 63 again. Cross-checked two ways.
Arithmetic from the listing's own cycle column: 2 + 4 + 4 + 2 + 4 + 2 +
4 + 2 + (7 × 5 − 1) + 2 + 3 = 63. sim6502 (`--backend sim`, commit
d6f6812) on the same PRG with `jsr([bar_line], stop_on_address = $09a8)`
reported 129 cycles with `y = 2` and 66 with `y = 1`, a difference of 63;
each figure carries 4 cycles beyond the loop itself, the difference does
not.

The stopwatch counts only while the machine runs. Twenty seconds of real
time at the prompt left it at `2970383`; `r` before and after read the
same line.

### What the CYC column counts

This knowledge base numbers the cycles of a raster line 1 to 63 (65 on
the 6567R8) as Bauer's VIC-II article does: `$D012` changes on cycle 1,
a badline's BA falls on 12, its c-accesses run 15 to 54
(`hardware/vic-ii-reference.md`). The monitor prints 0 to 62 (0 to 64),
and what one of its numbers means depends on the checkpoint:

| Monitor output | Its CYC is | Bauer's cycle |
|---|---|---|
| exec checkpoint, `step`, `r` (an instruction about to run) | the instruction's first cycle, the opcode fetch | CYC + 1; its k-th cycle is CYC + k |
| store checkpoint (`watch store`, `tr store`) | one past the store's write cycle: the line is printed after the instruction ends | the write's cycle is CYC as printed |

So for an `STA $D020` traced on exec at CYC 60 the write is Bauer's
cycle 64, which is cycle 1 of the next line, and the store trace prints
that line with CYC 1. A store trace's CYC 0 is the previous line's last
cycle (63, or 65), with the next line's number in the LIN column.
Before issue #82, pages quoted three numberings: the store trace as
printed, the exec CYC as printed, and the exec CYC plus one.

Measured 2026-09-24 in VICE x64sc 3.10, PAL (`-default`) and NTSC
(`-model ntsc`), the same result on both:

- **Exec against store.** `STA $02` traced both ways: exec at CYC 49,
  stopwatch 3299989; store at CYC 52, stopwatch 3299992. The
  instruction takes 3 cycles and writes on its third, so the store line
  is printed one cycle after the write. The source agrees: a store
  watchpoint is queued during the access and checked after the
  instruction (`monitor_watch_push_store_addr`, `src/monitor/monitor.c`).
- **The `$D012` edge.** `LDA $D012 : STA $02 : JMP` with DEN clear
  (no badline), exec trace on the `STA`, which gives the `LDA`'s read
  cycle as its CYC − 1: 25,477 reads on PAL over all 63 CYC values,
  57,197 on NTSC. Every read on CYC 0 returned the new line and every
  read on CYC 62 (64) the old one. Bauer puts the increment on cycle 1.
- **The badline stall.** A slide of `NOP`s with DEN set, exec trace on
  every `NOP`: a `NOP` that started on CYC 10 held its second read and
  the next instruction started on CYC 55; one that started on CYC 11
  held its opcode read and the next started on 56; one that started on
  CYC 9 or earlier ran in 2 cycles. Reads are held from CYC 11 to 53
  and the first free read is on 54, which is Bauer's cycles 12 to 54
  and 55. PAL and NTSC give the same numbers.

The monitor takes CYC from the CPU clock modulo the line length
(`machine_get_line_cycle`, `src/c64/c64.c`), not from the VIC-II, which
is why it had to be tied to the chip by measurement. VICE's own VIC-II
log (for example the `VSP Bug: ... Cycle: 24` line of `-VICIIvspbug`)
prints `vicii.raster_cycle`, a table index that is Bauer's cycle minus
one (`VICII_PAL_CYCLE(c) = c - 1`, `src/viciisc/viciitypes.h`; not
checked against the monitor beyond that).

**Where a store shows in the exit screenshot.** A loop exactly one line
long locks to the raster, so each of its stores lands on the same cycle
of every line. DEN is set only on lines 49 to 52, never on line 48, so
there is no badline and the open display shows `$D021`:

```asm
BasicUpstart2(start)
.var ntsc = cmdLineVars.get("NTSC") != null
* = $0810
start:  sei
        lda #$7f
        sta $dc0d
        lda $dc0d
        lda #0
        sta $3fff           // the idle fetch: background only
        sta $d015
        jmp loop
* = $0a00
loop:   ldx $d012           // 4
        lda dentab,x        // 4
        sta $d011           // 4: DEN on lines 49-52 only
        lda #2
        sta $d020           // red border
        lda #6
        sta $d021           // blue background
        .fill 6, $ea
        lda #0
        sta $d020           // black border
        .fill 6, $ea
        lda #1
        sta $d021           // white background
        .if (ntsc) { nop }
        jmp loop            // 63 cycles, 65 with the NTSC NOP
* = $0b00
dentab: .fill 256, (i >= 49 && i <= 52) ? $1b : $0b
```

Every row of the picture had the same colour edges. A store the trace
prints as CYC `c` shows its new colour from screenshot x = 8c − 103,
border and background alike. On PAL the 8565 first draws one light grey
pixel at 8c − 104; the NTSC picture has none. Pairs measured, with
different lock phases (set by a delay loop before `jmp loop`, not shown):

| Model | Store-trace CYC → first pixel x |
|---|---|
| PAL | 30 → 137, 48 → 281, 50 → 297, 29 → 129, 56 → 345 |
| NTSC | 22 → 73, 46 → 265, 28 → 121 |

Stores on other cycles fall in the horizontal blank or beyond x 383.
`recipes/kickassembler/road-sprite-lines.md` found the same line: its
probe traced on 15 shows from x 17.

### Memory dump and save

```text
(C:$0906) m 0900 090f
>C:0900  78 a9 7f 8d  0d dc ad 0d  dc a9 34 8d  14 03 a9 09   X..
(C:$0910)
```

Sixteen bytes per row, a PETSCII column after them (trimmed here), and
the prompt moves to the byte after the dump. `m .irq2_line` with a label
and no end address printed nine rows (`$09D8` to `$0A67`) and left the
prompt at `(C:$0a68)`. The full syntax is
`mem [<data_type>] [<address_opt_range>]`.

```text
(C:$0900) save "/tmp/saved.prg" 0 0900 09ff
Saving file '/tmp/saved.prg' from $0900 to $09ff
```

Device 0 is the host file system. The file was 258 bytes: the two-byte
load address `00 09` and the 256 bytes, a PRG that loads back where it
came from.

### `-limitcycles` and a stopped machine

`-limitcycles` counts emulated cycles and the monitor stops the clock.
Three consequences, each measured:

- A breakpoint past the limit never fires. With `-limitcycles 1000000`
  and `break .start`, which fires at stopwatch 2,970,383 on this PRG,
  VICE exited with status 1 and printed no stop.
- A machine left at the prompt never exits. A session that ended stopped
  at `.bar_line` was still there when `timeout` killed it. After `x` with
  no further stop ahead the remaining cycles run and the limit exit
  happens as usual, status 1.
- Real time at the prompt costs nothing on the stopwatch (the twenty
  seconds above).

This is the fact behind Route 2's warning: a stopping checkpoint in a
`-moncommands` file with no client connected hangs the run.

Related pages: the binary monitor for the same operations from a
program is "The Binary Monitor Protocol" above and
[vice-mcp-reference.md](vice-mcp-reference.md); cycle assertions without
an emulator are [sim6502-reference.md](sim6502-reference.md); the label
files each toolchain writes are in "Symbol Files" above and in the
KickAssembler, Oscar64 and cc65 pages' debugging sections.

---

## Recording the SID output

A run can write the SID's audio to a WAV file, or every SID register
write to a text file, with no audio device. Measured 2026-09-24 with the
windowless x64sc 3.10 build and reSID, on a one-voice test program
(a table of waveforms at 440 Hz), at 6,000,000 and 26,000,000 cycles.

| Invocation | Result |
|---|---|
| `+warp -sound -sounddev wav -soundarg out.wav` | Works. 16-bit PCM, 48,000 Hz by default; `-soundrate 44100 -soundoutput 1` gives 44,100 Hz mono. Runs in real time: 26,000,000 cycles took 24 to 27 s of wall clock |
| `-warp -sound -sounddev wav -soundarg out.wav` | A 44-byte header and no samples |
| the same with `-soundwarpmode 1` | A 44-byte header and no samples |
| `+warp -sound -sounddev dummy -soundrecdev wav -soundrecarg out.wav` | A 44-byte header and no samples; the log repeats "Sound buffer overflow (cycle based)" |
| `-sound -sounddev dump -soundarg out.txt` | Every SID write, one line each. Byte-identical with and without `-warp` |
| `-sound -sounddev dummy -residrawoutput` | The log says "reSID: raw output enabled"; no `resid.raw` appeared in the working directory, with or without warp |

`x64sc -help` lists only `coreaudio/dummy/dump` for `-sounddev`, but
the startup log lists `coreaudio dummy dump fs wav voc iff aiff
soundmovie`, and `wav` is accepted.

**What the WAV covers.** Autostart turns warp on while it loads and
off when the program starts (the log prints "AUTOSTART: Turning Warp
mode on" and "off"). Nothing is recorded while warp is on, so the file
starts at about the program's start, not at power-on. At 26,000,000
cycles the file held 23.389 s. The program's first SID write came at
cycle 2,970,434 (from the dump), which leaves 23.374 s of emulated time
after it (arithmetic at 985,248 Hz). The first tone began 7 ms into the
file.

**The dump format.** One line per write: cycles since the previous
write, register number (0-24, decimal), value (decimal). From the test
program, a sawtooth gated on, then off 49.6 frames later:

```text
8 4 33
976058 4 32
```

It needs no real time, so it is the sink for a register trace under
`-warp`. It is also a "real sound sink" for `$D41B`/`$D41C` reads,
which return meaningless values under `+sound`
(`recipes/kickassembler/music-player.md`, "Pitfalls met").

**A loudness measurement.** Record in real time on each model
(`-sidmodel 0` for the 6581, `1` for the 8580) and read the WAV with
Python's `wave` and `numpy`. Take the RMS of the samples with the mean
removed, over a window inside each held note:

```text
x64sc -default +warp -sidmodel 0 -sound -sounddev wav -soundarg out.wav \
      -soundrate 44100 -soundoutput 1 +autostart-delay-random \
      -autostartprgmode 1 -limitcycles 26000000 -autostart test.prg
```

The combined-waveform table in `hardware/sid-reference.md` was made
this way. A run is as long as the music, so keep the program short and
put the notes on known frames.

---

## Integration with vice-mcp

vice-mcp is a separate MCP server between agents and a running
VICE instance. It maintains a TCP connection to VICE's binary monitor, translates MCP
tool calls into binary monitor frames, and returns structured results. Agents invoke
vice-mcp tools such as `readMemory`, `setBreakpoint`, `screenshot` and
`loadProgram`; they never send raw binary monitor frames. (An earlier version
named them `vice_read_memory`, `vice_set_breakpoint`, `vice_screenshot` and
`vice_autostart`; the names above are the ones registered in vice-mcp's
`src/index.ts` and listed in [vice-mcp-reference.md](vice-mcp-reference.md).)

Start `x64sc` first with `-binarymonitor
-binarymonitoraddress ip4://127.0.0.1:6502`, then start the vice-mcp server, which
connects to that address. Both processes run concurrently for the duration of the
inspection session.

See [vice-mcp-reference.md](vice-mcp-reference.md) for the full tool surface.

---

## Pitfalls

### x64 (fast) vs x64sc (cycle-accurate)

`x64` skips the cycle-exact 6510 core and uses a timing approximation. It runs faster
but breaks any code that depends on precise cycle counts: raster IRQs, sprite
multiplexers, SID timing, and CIA timer-based effects will behave incorrectly or
intermittently. Always use `x64sc` when verifying code against hardware. The speed
penalty is acceptable for automated runs with `-warp`.

### Default keyboard layout

VICE picks the host keyboard layout from the locale (LANG/LC_ALL) at RUN time, not
build time as an earlier version of this page said: the same x64sc 3.10 binary loads
`gtk3_sym.vkm` under `en_US` and `gtk3_sym_de.vkm` under `de_DE.UTF-8` (measured with
`-default`). The default keymap type is symbolic (KeymapIndex 0). Code injected via
`Keyboard Feed` (`0x72`) sends raw PETSCII, so this does not affect monitor or
programmatic input, but it does affect a test that types characters through the
emulated keyboard. Pass `-keymap 0 -keyboardmapping 0` explicitly for a US symbolic
keymap regardless of host locale. There is no `-keyboard` option: `-keyboard en` is
rejected as ambiguous (it is a prefix of `-keyboardmapping`, `-keyboardtype` and
`-keyboardstatusbar`).

### ROM image licensing

The VICE source tarball ships the Commodore ROM images (kernal, basic, chargen) in its
data/ tree, and the Homebrew formula installs them from that tarball into
`/opt/homebrew/share/vice/C64/`; nothing is fetched separately (an earlier version of
this page said the formula downloaded them from a community source; `brew cat vice` has
no such resource). Some Linux distributions strip them for licensing reasons: Debian's
`vice` package lives in contrib and explicitly excludes the ROMs (see its README.ROMs),
so there you must obtain them yourself. In that case, and in any Docker or CI image
built from such a package, supply the ROM images and point VICE at them via `-kernal`,
`-basic`, and `-chargen`, or place them in the expected directory. Without the
ROMs VICE gives a startup error and a blank screen.

### Monitor port conflicts

Port 6502 may be in use if multiple VICE instances or other tools occupy it. Pass a
different port via `-binarymonitoraddress ip4://127.0.0.1:6503` (or any free port) when
running parallel test instances. Avoid 6510: the text monitor sessions above and
`sim6502-reference.md`'s VICE backend already use it. (An earlier version suggested
6510.)

### macOS Homebrew: g_settings_new crash on launch

On macOS Homebrew (`brew install vice`, 3.10 at time of writing) both `x64` and
`x64sc` crash at launch with:

```
GLib-GIO-ERROR **: No GSettings schemas are installed on the system
```

The compiled schemas exist at `/opt/homebrew/share/glib-2.0/schemas/`, but
GTK3 does not search that path by default. Export the schema location before
launching:

```bash
export XDG_DATA_DIRS="/opt/homebrew/share:/usr/local/share:/usr/share:$XDG_DATA_DIRS"
export GSETTINGS_SCHEMA_DIR="/opt/homebrew/share/glib-2.0/schemas"
x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502 -autostart hello.prg
```

The template harness (`templates/_harness/harness.mk`) exports
`GSETTINGS_SCHEMA_DIR` for its `run` target, which is enough on this machine. The two exports are harmless on Linux, where
the paths do not exist.

This is a packaging issue in the Homebrew GTK3 bottle, not a VICE bug.

### True drive emulation and speed

When `-drive8type 1541` is active with true drive emulation enabled (the default in
`x64sc`), disk access is cycle-accurate and slow even in warp mode. If load time
dominates a test run and timing accuracy of the drive is not the subject of the test,
disable true drive emulation for unit 8 with `+drive8truedrive` to use the faster IEC
fast-path (the option is per unit, with `+drive9truedrive` … `+drive11truedrive` likewise,
since VICE 3.6; a bare `+truedrive`, which an earlier version of this page gave, is
rejected as an unknown option by x64sc 3.10).

---

## See Also

- [vice-mcp-reference.md](vice-mcp-reference.md) — MCP tool surface for agent-driven VICE control
- [../formats/c64-file-formats.md](../formats/c64-file-formats.md) — PRG, CRT, D64, and other C64 file format details
- [../hardware/pal-ntsc-reference.md](../hardware/pal-ntsc-reference.md) — PAL vs NTSC hardware differences and timing tables
