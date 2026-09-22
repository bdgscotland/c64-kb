---
tool: vice
tool_kind: emulator
maintainer: VICE Team
license: GPL-2.0
home_url: https://vice-emu.sourceforge.io/
---
<!-- doc-type: toolchain-reference -->

# VICE — Versatile Commodore Emulator

## Tool

VICE (Versatile Commodore Emulator) is an open-source emulator that runs software
written for the Commodore 8-bit computer family on modern hardware. For c64-kb purposes
the only relevant binary is `x64sc`, the cycle-accurate C64 emulator. VICE exposes a
TCP-based binary monitor protocol on port 6502 that allows external programs to inspect
and control the running machine — read and write memory, set breakpoints, capture the
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
`/usr/share/vice/C64/`; Debian's does not include them. VICE will refuse to start
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
slower than `x64` on the host but produces correct raster timing, correct CIA timer
behaviour, and correct SID timing — all of which matter when verifying demo or game
code. Always use `x64sc` for correctness. See the Pitfalls section for the consequences
of reaching for `x64` instead.

---

## CLI Flags

The table below covers flags relevant to build-and-test automation and basic operation.
VICE accepts many more; run `x64sc --help` for the full list.

| Flag | Argument | Effect |
|------|----------|--------|
| `-autostart <file>` | PRG, D64, T64, TAP, VSF | Load and RUN the named file or the first file on a disk/tape image; a `.vsf` is autodetected as a snapshot and restored (after the normal autostart delay — allow well over 3,000,000 cycles under `-limitcycles`) |
| `-binarymonitor` | — | Enable the TCP binary monitor |
| `-binarymonitoraddress <addr>` | `ip4://127.0.0.1:6502` | Monitor listen address and port |
| `-moncommands <file>` | path to text file | Execute text-monitor commands at startup (useful for loading labels) |
| `-warp` | — | Disable real-time throttle; run as fast as the host allows |
| `-limitcycles <n>` | cycles | Quit after n emulated cycles (985,248 per PAL second, 1,022,727 per NTSC second); VICE exits with a non-zero status when the limit fires, so a wrapper must not treat rc=1 alone as failure |
| `-pal` | — | Force PAL machine model |
| `-ntsc` | — | Force NTSC machine model |
| `-model <name>` | `c64`, `c64c`, … | Select machine sub-model |
| `-drive8type <n>` | 1541, 1571, … | Drive type for device 8 |
| `-8 <file>` | D64, G64, … | Attach disk image to device 8 |
| `-1 <file>` | T64, TAP | Attach a tape image to the datasette (unit 1) |
| `-soundvolume <n>` | 0–100 | Audio output level (0 = mute) |
| `-keymap <n>` | 0 symbolic, 1 positional, 2/3 user files | Keymap type (default 0) |
| `-keyboardmapping <n>` | 0 = US, other values select other host layouts | Host keyboard layout used to pick the `.vkm` file |
| `-cartcrt <file>` | CRT | Attach a cartridge image |
| `+cart` | — | Disable cartridge (note: plus sign, not minus) |

Flags that begin with `+` instead of `-` are boolean toggles that explicitly turn a
feature off; their `-` counterparts turn it on.

An earlier revision of this page listed `-quitafter <seconds>`, `-1541-8`,
`-tape1 <file>`, `-snapshot <file>` and `-keyboard <layout>`; x64sc 3.10 has none of
them and rejects each as an unknown (or, for `-keyboard`, ambiguous) option, aborting
startup. The rows above hold the real names (measured with `x64sc -default -console`).

---

## The Binary Monitor Protocol

VICE exposes a binary remote monitor over TCP when started with `-binarymonitor`. The
default address is `ip4://127.0.0.1:6502`. The port number is a deliberate nod to the
6502 processor.

### Enabling the monitor

```bash
x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502 -autostart hello.prg
```

Once VICE is running, any TCP client can connect and send commands.

### Frame format

Every message — command or response — shares a common wire layout:

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
disk images and `-1 <file>` for tape images. `-autostart` can also accept a
disk or tape image path directly and will load the first file.

### .D64 — Single-sided 35-track 1541 disk image

The standard 1541 disk image format. A D64 file contains 35 tracks of raw sector data.
Sector count varies by zone: tracks 1–17 carry 21 sectors each, tracks 18–24 carry 19
sectors each, tracks 25–30 carry 18 each, and tracks 31–35 carry 17 each — 683 sectors
total. Each sector is 256 bytes, giving a total image size of 174,848 bytes (or 175,531
bytes with the optional per-sector error-code extension). Track 18 / sector 0 holds the
BAM (Block Availability Map) and disk name; the directory occupies track 18 sectors 1–18
and supports up to 144 file entries.

**Produced by:** c1541
**Consumed by:** vice

D64 is the go-to format for distributing finished software. It cannot represent
non-standard track layouts or copy-protection schemes; for those cases use G64.

### .G64 — GCR-encoded 1541 disk image

G64 stores raw GCR (Group Code Recording) bitstream data — the actual flux transitions
the 1541 read head would encounter. The format supports up to 84 track slots (42 full
tracks plus 42 half-tracks), though typical 1541 media uses only 35. Because the
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
the raw file data. T64 is not a raw tape recording — it is closer to a ZIP file for
PRGs. It has no concept of tape timing or loader protocol. `c1541` can only read a T64
(its `tape` command extracts files from one); it does not write them.

**Consumed by:** vice

T64 is a convenient way to ship a single PRG for distribution via "tape" when accurate
tape timing is not required. For raw pulse-level fidelity use TAP.

### .TAP — Raw tape pulse-width data

TAP stores the cassette signal as a sequence of bytes, each representing the time (in
hardware counter units) between successive signal transitions — the literal pulse widths
the C64 CIA timer measured. A 20-byte file header carries the signature `C64-TAPE-RAW`,
a version byte, three reserved bytes, and a 4-byte little-endian data-area size (the
length excludes the header). Version 0 encodes
each pulse as `period = (8 × byte) / 985248` seconds; a `0x00` byte signals an
overflow. Version 1 reuses `0x00` as an escape: three following bytes give the actual
cycle count for long pulses. TAP files are typically 8–16 times larger than the
equivalent PRG data because each source bit expands to one pulse-width byte.

**Produced by:** tapclk, mtap
**Consumed by:** vice

TAP is required when the software uses a custom tape loader that relies on pulse timing,
such as Turbo Tape or commercial fast loaders. For simple PRG distribution, T64 is
smaller and easier to work with.

### The c1541 companion utility

`c1541` is a standalone command-line disk-image maintenance tool shipped with VICE. It
can create D64 and G64 images, list and extract files, write PRG files into a disk
image, validate the BAM, inspect block chains, and perform low-level block operations
(peek, poke, fill). It supports batch mode — prefix commands with `-` to chain them
non-interactively — and interactive mode with tab completion.

```bash
# Create a fresh D64 and write a PRG into it
c1541 -format "mygame,01" d64 mygame.d64
c1541 -attach mygame.d64 -write hello.prg hello
```

`c1541` is the right tool for assembling a releasable disk image from one or more
compiled PRG files before handing the D64 to VICE for a run.

---

## Symbol Files

The VICE text monitor (launched interactively or via `-moncommands`) can load symbol
tables that map label names to addresses. Two formats are relevant:

| Format | Extension | Produced by | Example entry |
|--------|-----------|-------------|---------------|
| Oscar64 label file | `.lbl` | oscar64 (written alongside the `.prg` by default; there is no flag, and `-l` is rejected) | `al 0880 .main` |
| KickAssembler vice symbol file | `.vs` | KickAssembler (`-vicesymbols`) | `al C:1000 .main` |

Oscar64 entries carry a bare 4-digit hex address with no `C:` memspace prefix
(`al HHHH .name`, as [../formats/c64-file-formats.md](../formats/c64-file-formats.md)
describes); KickAssembler's `-vicesymbols` output uses `al C:HHHH .name`. The VICE
monitor accepts both, and `break .main` works after `ll` either way. An earlier version
of this table gave Oscar64 a `-l` flag and a `C:` prefix; neither exists.

Load a symbol file in the monitor with:

```
ll "build/hello.lbl"
```

Once loaded, the disassembler, breakpoint expressions, and memory commands can use label
names instead of raw hex addresses. This makes monitor sessions with `vice-mcp` far more
readable. Load symbols at startup by putting the `ll` command in a file and passing it
via `-moncommands`.

---

## Snapshots

VICE can save and restore complete machine state using the `.vsf` (VICE Snapshot File)
format. A snapshot captures RAM, ROM shadow, CPU registers, CIA state, VIC-II state,
SID state, and optional drive state. ROM images are not embedded in the snapshot.

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

Via the binary monitor, `Dump` (opcode `0x41`) and `Undump` (opcode `0x42`) provide the
same capability programmatically. vice-mcp exposes both operations as MCP tools.

Snapshots are useful for reproducible automated testing: run to a known program counter,
save a snapshot, then restore it at the start of each test run to eliminate variable
boot-time state.

---

## Region Selection

VICE supports both PAL and NTSC machine configurations. The difference is significant
for cycle-accurate timing work: PAL machines run at 985,248 cycles/second with 312 scan
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
locales — the locale moves the keyboard mapping, not the video standard). A saved config
file (vicerc) can override it, and `-default` bypasses that file, so pass `-pal`, `-ntsc`
or `-model` explicitly in automated runs. An earlier version of this sentence said the
default depended on the system locale; it does not. If a program behaves differently
under PAL vs NTSC, a raster timing assumption is almost always the cause.

For a full treatment of the hardware differences between PAL and NTSC C64 variants, see
[../hardware/pal-ntsc-reference.md](../hardware/pal-ntsc-reference.md).

---

## Headless and Automated Invocation

An agent (or CI script) running VICE in a build-verify loop wants no GUI, maximum
speed, and deterministic exit. The pattern is:

1. Compile the PRG with oscar64or KickAssembler.
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
pixel data for the current frame. This lets an agent record what the screen looks like
at a given execution point without requiring a visible window.

On Linux CI, add `Xvfb` or set `SDL_VIDEODRIVER=offscreen` (SDL2 build) to suppress the
display requirement.

---

## Integration with vice-mcp

vice-mcp is a separate MCP server that acts as a bridge between agents and a running
VICE instance. It maintains a TCP connection to VICE's binary monitor, translates MCP
tool calls into binary monitor frames, and returns structured results. Agents invoke
vice-mcp tools such as `vice_read_memory`, `vice_set_breakpoint`, `vice_screenshot`, and
`vice_autostart`; they never send raw binary monitor frames.

From a deployment perspective: start `x64sc` first with `-binarymonitor
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
programmatic input, but it matters when a test scenario types characters through the
emulated keyboard. Pass `-keymap 0 -keyboardmapping 0` explicitly for a US symbolic
keymap regardless of host locale. There is no `-keyboard` option: `-keyboard en` is
rejected as ambiguous (it is a prefix of `-keyboardmapping`, `-keyboardtype` and
`-keyboardstatusbar`).

### ROM image licensing

The VICE source tarball ships the Commodore ROM images (kernal, basic, chargen) in its
data/ tree, and the Homebrew formula installs them from that tarball into
`/opt/homebrew/share/vice/C64/` — nothing is fetched separately (an earlier version of
this page said the formula downloaded them from a community source; `brew cat vice` has
no such resource). Some Linux distributions strip them for licensing reasons: Debian's
`vice` package lives in contrib and explicitly excludes the ROMs (see its README.ROMs),
so there you must obtain them yourself. In that case, and in any Docker or CI image
built from such a package, supply the ROM images and point VICE at them via `-kernal`,
`-basic`, and `-chargen`, or place them in the expected directory. Failure to provide
ROMs produces a startup error and a blank screen.

### Monitor port conflicts

Port 6502 may be in use if multiple VICE instances or other tools occupy it. Pass a
different port via `-binarymonitoraddress ip4://127.0.0.1:6510` (or any free port) when
running parallel test instances.

### macOS Homebrew: g_settings_new crash on launch

On macOS Homebrew (`brew install vice`, 3.10 at time of writing) both `x64` and
`x64sc` crash at launch with:

```
GLib-GIO-ERROR **: No GSettings schemas are installed on the system
```

The compiled schemas DO exist at `/opt/homebrew/share/glib-2.0/schemas/`, but
GTK3 doesn't search that path by default. Export the schema location before
launching:

```bash
export XDG_DATA_DIRS="/opt/homebrew/share:/usr/local/share:/usr/share:$XDG_DATA_DIRS"
export GSETTINGS_SCHEMA_DIR="/opt/homebrew/share/glib-2.0/schemas"
x64sc -binarymonitor -binarymonitoraddress ip4://127.0.0.1:6502 -autostart hello.prg
```

The `templates/c64-demo-starter` and `templates/c64-game-starter` Makefiles
bake these env vars into the `run` target. They are harmless on Linux (the
paths just don't exist).

This is a packaging issue in the Homebrew GTK3 bottle, not a VICE bug.

### True drive emulation and speed

When `-drive8type 1541` is active with true drive emulation enabled (the default in
`x64sc`), disk access is cycle-accurate and slow even in warp mode. If load time
dominates a test run and timing accuracy of the drive is not the subject of the test,
disable true drive emulation for unit 8 with `+drive8truedrive` to use the faster IEC
fast-path (the option is per unit — `+drive9truedrive` … `+drive11truedrive` likewise —
since VICE 3.6; a bare `+truedrive`, which an earlier version of this page gave, is
rejected as an unknown option by x64sc 3.10).

---

## See Also

- [vice-mcp-reference.md](vice-mcp-reference.md) — MCP tool surface for agent-driven VICE control
- [../formats/c64-file-formats.md](../formats/c64-file-formats.md) — PRG, CRT, D64, and other C64 file format details
- [../hardware/pal-ntsc-reference.md](../hardware/pal-ntsc-reference.md) — PAL vs NTSC hardware differences and timing tables
