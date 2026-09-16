<!-- doc-type: format-reference -->

# C64 File Formats

This document catalogs the file formats produced and consumed by the C64 toolchain and runtime ecosystem. Each section covers the physical layout, intended use, and relationships to tools in this knowledge base. Disk-image bit-level details follow the authoritative specifications published by Peter Schepers at `https://ist.uwaterloo.ca/~schepers/formats.html`. Producers and consumers reflect the current Tool node set; where the canonical producer is a music tracker or hardware-specific utility not yet represented as a Tool node, this is noted explicitly.

---

## Executables

### .PRG — Program file (executable)

**Produced by:** oscar64, kickassembler, cc65
**Consumed by:** vice, c1541

The `.PRG` file is the fundamental C64 executable container. It consists of a 2-byte little-endian load address followed by raw 6502/6510 machine code. The load address tells the loader (KERNAL or a fastloader) where in the C64's 64 KiB address space to place the data; execution then begins either at the BASIC start vector or at an address specified via a `SYS` call or direct `RUN/STOP + RESTORE` sequence.

Oscar64 produces `.prg` directly via its built-in linker. KickAssembler emits `.prg` as its default output when a load address is specified in the source. cc65 requires a separate `ld65` linker invocation with an appropriate config file to produce a `.prg`.

The 2-byte header makes `.PRG` trivially distinct from `.BIN`: a load address of `$0801` is the standard BASIC program start for autostarting demos (the BASIC stub `10 SYS 2064` or similar). A load address of `$C000` or other high-memory address signals a directly-assembled utility or IRQ routine.

Maximum useful size is bounded by available RAM: roughly 38 KiB for a pure program (bank-switched or streaming loaders can exceed this). On real hardware, programs above approximately 50 KiB require multi-part loading.

---

### .CRT — Cartridge image

**Produced by:** oscar64, kickassembler
**Consumed by:** vice, easyflash, ef3

The `.CRT` format (defined by the VICE team, current spec v1.00) packages one or more ROM banks with metadata about the cartridge hardware type. It is the standard interchange format for C64 cartridge software and EasyFlash cart images used in the demoscene.

**File header (64 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $0000 | 16 | Magic string `"C64 CARTRIDGE   "` (space-padded) |
| $0010 | 4 | Header length (big-endian; typically `$00000040`) |
| $0014 | 2 | Version (big-endian; `$0100` = v1.0) |
| $0016 | 2 | Hardware type (big-endian; 0 = generic 8K/16K) |
| $0018 | 1 | EXROM line state (0 = low/active) |
| $0019 | 1 | GAME line state (0 = low/active) |
| $001A | 6 | Reserved (zero) |
| $0020 | 32 | Cartridge name (null-padded ASCII) |

**CHIP packets** follow the header, one per ROM bank:

| Offset | Size | Field |
|--------|------|-------|
| $0000 | 4 | Signature `"CHIP"` |
| $0004 | 4 | Total packet length including header (big-endian) |
| $0008 | 2 | Chip type: 0=ROM, 1=RAM (no ROM), 2=Flash ROM |
| $000A | 2 | Bank number (`$0000` for single-bank carts) |
| $000C | 2 | Load address (big-endian; `$8000` or `$A000` or `$E000`) |
| $000E | 2 | ROM image size in bytes (big-endian) |
| $0010 | var | ROM data |

The EXROM/GAME line combination determines the cartridge's memory mapping mode. Common combinations: EXROM=0/GAME=1 maps 8K at `$8000`; EXROM=0/GAME=0 maps 16K at `$8000`+`$A000`; EXROM=1/GAME=0 maps Ultimax (8K at `$E000`).

EasyFlash carts (hardware type `$0020`) contain up to 64 banks of 16K, each represented by two CHIP packets (one for `$8000`, one for `$A000`).

Oscar64 can target cartridge memory by setting the appropriate linker segment addresses. KickAssembler produces CRT images via the `.crt` and `.bank` directives combined with a post-assembly packaging step.

---

### .BIN — Raw binary payload

**Produced by:** oscar64, kickassembler
**Consumed by:** vice, c1541

A raw binary file with no header — purely machine code or data at an implicit address. Used for ROM images, screen data, sprite sheets, or intermediate build artifacts before final linking. VICE can load `.BIN` files with an explicit address override via `-autostart-handle-tde` or the monitor's `l` command. The distinction from `.PRG` is the absence of the 2-byte load-address header.

KickAssembler emits `.bin` when the `.pc` directive is used without the auto-generated header. Oscar64 can emit raw binary payloads for specific linker segments.

---

## Disk Images

Disk image formats capture the content of floppy disks used with the Commodore 1541, 1571, and 1581 drives. The canonical technical specifications are maintained by Peter Schepers; the descriptions below draw directly from those specifications.

### .D64 — Single-sided 35-track 1541 disk image

**Consumed by:** vice, c1541

The D64 is a sector-for-sector copy of a Commodore 1541 (or 1540) single-sided floppy disk. It is the most widely used C64 disk image format, standard for software distribution, fastloader testing, and demo release packaging.

**Physical layout:**

The disk has 35 tracks, numbered 1 (outermost) through 35 (innermost). Each track holds a varying number of 256-byte sectors depending on the track's position in the GCR speed zones:

| Tracks | Sectors per track | Cumulative sectors |
|--------|------------------|--------------------|
| 1–17   | 21               | 357 |
| 18–24  | 19               | 490 |
| 25–30  | 18               | 598 |
| 31–35  | 17               | 683 |

Total: **683 sectors, 174,848 bytes** (standard, no error bytes).

**Extended variants by file size:**

| Size (bytes) | Description |
|-------------|-------------|
| 174,848 | 35 tracks, no error bytes |
| 175,531 | 35 tracks + 683 error bytes appended |
| 196,608 | 40 tracks (SpeedDOS/Dolphin extension), no errors |
| 197,376 | 40 tracks + 768 error bytes |

Error bytes, when present, are appended after all sector data: one byte per sector indicating the error code that the 1541 ROM would have returned (0 = no error, 20–29 = various read errors).

**Directory and BAM (track 18):**

Track 18 is the directory track. Sector 0 holds the Block Availability Map (BAM) and disk metadata. Sectors 1–18 hold directory entries (maximum 144 entries; 8 entries × 18 sectors with 3-sector interleave: 18/1 → 18/4 → 18/7 ...).

BAM structure at 18/0:

| Offset | Size | Field |
|--------|------|-------|
| $00–$01 | 2 | Pointer to first directory sector (18, 1) |
| $02 | 1 | DOS version (`$41` = CBM DOS 2; other = soft write-protect) |
| $03 | 1 | Unused |
| $04–$8F | 140 | 35 × 4-byte BAM entries (one per track) |
| $90–$9F | 16 | Disk name (PETASCII, `$A0`-padded) |
| $A0–$A1 | 2 | Filler `$A0` |
| $A2–$A3 | 2 | Disk ID (2-char PETASCII) |
| $A4 | 1 | Filler `$A0` |
| $A5–$A6 | 2 | DOS type (`"2A"`) |

Each 4-byte BAM entry: first byte = free sector count, next 3 bytes = 24-bit bitmap (bit 1 = free, bit 0 = allocated), covering the sectors of that track left-to-right.

**Directory entry (32 bytes each):**

| Offset | Size | Field |
|--------|------|-------|
| $00–$01 | 2 | Track/sector pointer to next directory sector (0/0 if last) |
| $02 | 1 | File type (`$82`=PRG, `$81`=SEQ, `$83`=USR, `$84`=REL) |
| $03–$04 | 2 | First sector of file (track, sector) |
| $05–$14 | 16 | Filename (PETASCII, `$A0`-padded) |
| $1E–$1F | 2 | File size in sectors (little-endian) |

File data uses a 10-sector interleave chain (each sector's first two bytes are the track/sector link to the next; the remaining 254 bytes are data). The last sector in a chain uses `$00` as the next-track link and stores the count of valid data bytes in what would normally be the next-sector byte.

**Typical use:** release distribution, fastloader authoring (Krill/Loader, Spindle, DreamLoad), scene release packaging via c1541 or CBM FileBrowser.

---

### .D71 — Double-sided 1571 disk image

**Consumed by:** vice, c1541

The D71 represents a Commodore 1571 double-sided disk. It is two D64-equivalent sides concatenated, with modified BAM bookkeeping to track both sides.

**Physical layout:**

Side 0 occupies tracks 1–35 (identical sector counts to D64). Side 1 occupies tracks 36–70 (mirroring side 0: tracks 36–52 have 21 sectors, 53–59 have 19, 60–65 have 18, 66–70 have 17).

Total: **1,366 sectors, 349,696 bytes** (without error bytes); 351,062 bytes with 1,366 error bytes appended.

**BAM structure:**

The primary BAM remains at track 18/0 and covers side 0 (tracks 1–35) as in D64. The side 1 BAM is stored at track 53/0: bytes `$DD–$FF` in the primary BAM sector hold free-sector counts for tracks 36–70.

Directory: track 18, same 144-file maximum. Native 1571 mode uses 6-sector interleave (versus 10 for 1541-compatibility mode).

**Typical use:** larger software titles, tools requiring more than 664 KiB of disk storage.

---

### .D81 — 1581 disk image

**Consumed by:** vice, c1541

The D81 represents a Commodore 1581 double-density 3.5-inch disk, offering substantially more capacity than either the 1541 or 1571.

**Physical layout:**

80 tracks, each with 40 sectors of 256 bytes each. Total: **3,200 sectors, 819,200 bytes** (822,400 bytes with 3,200 error bytes appended).

**BAM and directory structure:**

The header, BAM, and first directory entries all reside on track 40:

| Track/Sector | Contents |
|-------------|----------|
| 40/0 | Disk header (name, ID, DOS version) |
| 40/1 | BAM for tracks 1–40 |
| 40/2 | BAM for tracks 41–80 |
| 40/3 | First directory sector |

BAM entries use 6 bytes each: 1 byte free-sector count + 5 bytes (40-bit bitmap).

**Key differences from D64/D71:** sector interleave is 1 for both files and directories (the 1581 buffers a full track in internal RAM, making interleave irrelevant for sequential read performance). Maximum of approximately 296 directory entries at the root. Supports subdirectories and partitions at the DOS level (not represented in the D81 image format itself).

**Typical use:** large software archives, tools requiring subdirectory support.

---

### .G64 — GCR-encoded 1541 disk image (with full track layout)

**Consumed by:** vice, c1541

The G64 format preserves the raw GCR (Group Code Recording) encoding of a 1541 disk, including inter-sector gaps, SYNC marks, and variable track lengths. Unlike D64, which discards the physical encoding and retains only sector data, G64 retains the full magnetic track layout. This makes G64 essential for copy-protected software, custom loader timing, and anything where the exact physical track structure matters.

**File header (12 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $0000–$0007 | 8 | Signature `"GCR-1541"` |
| $0008 | 1 | Version (`$00`) |
| $0009 | 1 | Track count (typically `$54` = 84, for 42 tracks × half-tracks) |
| $000A–$000B | 2 | Maximum track size in bytes, little-endian (commonly 7,928) |

**Track offset table** (starting at `$000C`): 84 × 4-byte little-endian absolute file offsets, one per track/half-track position. A zero entry means no data is stored for that position. Standard 35-track images have non-zero entries only for tracks 1–35 (positions 0, 2, 4, ... 68 in the table); half-track entries are zero.

**Speed zone table** (follows the offset table): 84 × 4-byte entries. Values 0–3 are direct speed zone assignments for the entire track. Values ≥ 4 are file offsets pointing to per-byte speed zone blocks (1,982 bytes each), encoding speed for each 4-byte group in the track.

**Track data** (at each non-zero offset): 2-byte little-endian actual track length, followed by the raw GCR bytes (padded with `$FF` to the maximum track size).

**GCR sector structure within a track:**

Each sector occupies a fixed pattern:
1. Header SYNC: 5 × `$FF` bytes (40 consecutive 1-bits)
2. Header block: 10 GCR-encoded bytes (block ID `$08`, checksum, sector, track, format IDs)
3. Header gap: 8–9 bytes of `$55`
4. Data SYNC: 5 × `$FF` bytes
5. Data block: 325 GCR-encoded bytes (256 data bytes + block ID `$07` + checksum + padding, GCR-encoded at 4 bytes → 5 bytes ratio)
6. Inter-sector gap: 4–19 bytes (variable; `$55`)

Speed zones (1541-standard):

| Track range | Zone | Nominal track size |
|------------|------|-------------------|
| 1–17 | 3 | 7,820 bytes |
| 18–24 | 2 | 7,170 bytes |
| 25–30 | 1 | 6,300 bytes |
| 31–35 | 0 | 6,020 bytes |

**Typical use:** preserving copy-protected originals, testing fastloader sync timing, demoscene releases that rely on non-standard sector ordering or gap manipulation.

---

### .NIB — Nibbler-format disk image (preserves bit-level timing)

**Consumed by:** vice, c1541

The NIB format (produced by the Nibbler hardware device and associated PC software) captures raw GCR bit streams from a 1541, including bit-level flux timing variation. Where G64 stores cleaned-up GCR byte streams padded to a fixed maximum size, NIB stores the actual byte-level content read directly from the disk surface at a fixed 8,192 bytes per half-track regardless of the track's natural length.

The file contains 84 entries (42 tracks × 2 half-tracks), each exactly 8,192 bytes, for a fixed file size of 688,128 bytes. There is no file header; track data begins at offset 0. Track 1 data at offset 0, track 1.5 data at offset 8,192, track 2 at offset 16,384, and so on.

NIB is used almost exclusively for archival of copy-protected originals where flux timing differences between sectors encode protection information that G64 cannot capture. The format is produced by the physical Nibbler hardware device and the `mnib` software tool; it cannot be generated by standard assembler toolchains. VICE can read NIB images via its `diskcontents` handler.

**Typical use:** archival of physically copy-protected disks; supplied to VICE for testing loaders against original protection timing.

---

## Tape Images

Tape images represent the content of Commodore Datasette cassette recordings. The C64 KERNAL routines LOAD and SAVE interact with tape via the cassette port (CIA1 `$DC04`/`$DC05` timer and `$DC0D` ICR). See `../hardware/kernal-routines-reference.md` for LOAD and SAVE details.

### .T64 — Tape archive (PRG container)

**Consumed by:** vice

The T64 format was designed by the C64S emulator as a container for one or more C64 programs, nominally sourced from tape. Despite the name, T64 does not represent the tape data stream — it is a directory-based archive of PRG files with load/end addresses.

**File header (64 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $0000–$001F | 32 | Tape descriptor string (`"C64S tape image file"`, null-padded) |
| $0020–$0021 | 2 | Tape version (`$0100` or `$0101`, little-endian) |
| $0022–$0023 | 2 | Maximum directory entries (little-endian) |
| $0024–$0025 | 2 | Used directory entries (little-endian) |
| $0026–$0027 | 2 | Reserved |
| $0028–$003F | 24 | Tape container name (PETASCII, `$20`-padded) |

**Directory entries** (32 bytes each, starting at offset `$0040`):

| Offset | Size | Field |
|--------|------|-------|
| $00 | 1 | C64s file type: 0=free, 1=normal tape, 3=memory snapshot |
| $01 | 1 | 1541 file type (`$82`=PRG; any non-zero treated as PRG) |
| $02–$03 | 2 | Load address (little-endian) |
| $04–$05 | 2 | End address (little-endian; exclusive — first byte NOT part of file) |
| $06–$07 | 2 | Reserved |
| $08–$0B | 4 | Absolute file offset in container (little-endian) |
| $0C–$0F | 4 | Reserved |
| $10–$1F | 16 | Filename (PETASCII, `$20`-padded) |

File data is stored sequentially after the directory, pointed to by each entry's offset field. File length = end address − load address.

**Known limitations:** T64 does not support multi-load programs, REL files, or files with load address `$0000`. Some early C64S-produced T64 files contain a buggy end address of `$C3C6` regardless of actual file size; VICE works around this by reading the actual file size from the container. Multi-file T64 archives are supported in principle but many authoring tools limited themselves to single-file containers.

**Typical use:** distributing single PRG files as a tape equivalent; legacy emulator interchange.

---

### .TAP — Raw tape pulse-width data

**Consumed by:** vice

The TAP format records the raw pulse-width timing of a Commodore Datasette tape recording. Unlike T64, TAP faithfully represents the actual cassette data stream, including turbo loaders, custom protection schemes, and non-standard encoding. This makes it the preferred format for archival and protection research.

**File header (20 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $0000–$000B | 12 | Signature `"C64-TAPE-RAW"` |
| $000C | 1 | Version: `$00` (original) or `$01` (extended) |
| $000D–$000F | 3 | Reserved (zero) |
| $0010–$0013 | 4 | Data length in bytes, little-endian (excludes this 20-byte header) |

**Data section** (immediately follows header):

Each byte represents a pulse: the duration is `(byte_value × 8) / 985,248` seconds under the PAL clock (985,248 Hz). The NTSC clock (1,022,730 Hz) produces slightly different timing, but the format stores raw cycle counts so VICE applies the correct clock for the target region.

**Version `$00`:** A data byte of `$00` signals a pulse overflow (duration > 255 × 8 cycles); the actual duration is unspecified and varies by implementation.

**Version `$01`:** A data byte of `$00` is followed by 3 additional bytes giving the true pulse duration as a 24-bit little-endian cycle count. This extension handles long pauses and turbo-loader timing precisely.

Standard KERNAL tape encoding uses two pulse lengths: short (~370 µs, PAL) for a 0 bit, long (~530 µs) for a 1 bit. Turbo loaders (e.g., FINISH, Novaload, Freeload) use completely different encoding schemes, all of which TAP preserves faithfully.

**Typical use:** archival of original cassette software; testing turbo loader implementations; copy-protection analysis.

---

## Music

### .SID — PSID/RSID music file

**Consumed by:** vice, sidplayfp, kickassembler

The SID format is a standard container for C64 music, combining a short metadata header with a C64 binary containing the init and play routines. The format exists in two variants: PSID (Portable SID) for files that run under emulated environments, and RSID (Real SID) for files that require an authentic C64 environment (real interrupt timing, BASIC ROM, etc.).

**Note on producers:** SID files are not produced by the assembler toolchains in this knowledge base. The canonical producers are dedicated C64 music trackers: GoatTracker 2 (cross-platform, exports PSID/RSID), SID-Wizard (native C64 tracker), and DefMON. These tools are not currently represented as Tool nodes in this KB. KickAssembler can *consume* SID files via the `LoadSid` directive to embed a SID player's binary into a larger program, but it does not produce `.sid` files.

**File header:**

| Offset | Size | Field |
|--------|------|-------|
| $00–$03 | 4 | Magic: `"PSID"` or `"RSID"` |
| $04–$05 | 2 | Version: `$0001` (v1) or `$0002` (v2) — big-endian |
| $06–$07 | 2 | Data offset: `$0076` (v1) or `$007C` (v2) — big-endian |
| $08–$09 | 2 | Load address (0 = embedded in first 2 bytes of data, little-endian) |
| $0A–$0B | 2 | Init address (0 = load address; called with song number in A) |
| $0C–$0D | 2 | Play address (0 = init installs IRQ handler; must be 0 for RSID) |
| $0E–$0F | 2 | Number of songs (1–256) — big-endian |
| $10–$11 | 2 | Default start song (1-based) — big-endian |
| $12–$15 | 4 | Speed flags: each bit governs one song. 0=VBI (50/60 Hz), 1=CIA1 timer (~60 Hz) |
| $16–$35 | 32 | Song name (null-terminated ASCII, max 31 chars) |
| $36–$55 | 32 | Author name (null-terminated ASCII) |
| $56–$75 | 32 | Released/copyright (null-terminated ASCII) |

**Version 2 extensions (offsets $76–$7B):**

| Offset | Size | Field |
|--------|------|-------|
| $76–$77 | 2 | Flags: bit 0=MUS data, bit 1=PlaySID/BASIC, bits 2-3=video standard (00=unknown,01=PAL,10=NTSC,11=both), bits 4-5=SID model (00=unknown,01=6581,10=8580,11=both) |
| $78 | 1 | Start page (relocation page; 0=clean, $FF=no free pages) |
| $79 | 1 | Page length (number of free pages for relocation) |
| $7A–$7B | 2 | Reserved (zero) |

**RSID** files require the C64 BASIC ROM and run in native-interrupt mode. The play address must be zero (the init routine installs a CIA or raster IRQ). Load address, init address, and any ROM-mapped addresses must be ≥ `$07E8`.

The SID collection at HVSC (High Voltage SID Collection) contains over 50,000 SID files and is the de facto reference corpus for this format.

---

## Memory Snapshots

### .VSF — VICE snapshot

**Produced by:** vice
**Consumed by:** vice

The VSF (VICE Snapshot File) format saves and restores the complete state of a running VICE emulation session. It captures CPU registers, all RAM banks, chip state (VIC-II, SID, CIA1, CIA2), and peripheral state (disk drive contents, tape position).

A VSF file begins with a global file header containing the magic string `"VICE Snapshot File\032\n"`, a version number (major/minor bytes), and the machine type identifier. Following the global header are module snapshots — one per emulated chip or subsystem. Each module has a 15-byte fixed header: a 10-character module name (null-padded), 1-byte major version, 1-byte minor version, and a 4-byte little-endian module data length. Module data follows immediately.

Modules typically present in a C64 snapshot: `MAINCPU` (6510 registers and flags), `MEM` (64 KiB RAM + I/O shadow), `VICII` (VIC-II registers and internal state), `SID` (SID register state), `CIA1`, `CIA2`, `IEC` (serial bus state), `DRIVE8` (1541 drive state including its own RAM and ROM image reference).

VSF is strictly a VICE internal format. It is not suitable for interchange between emulators and has no use in the toolchain build pipeline.

---

## Build Artifacts

### .MAP — Linker map file

**Produced by:** oscar64, cc65
**Consumed by:** vice

A linker map file records the final address assignments for every symbol, segment, and object file resolved during linking. Oscar64 emits `.map` alongside its primary output. cc65's `ld65` linker emits a map file when invoked with `-m`. KickAssembler produces a symbol list via the `--symboldump` flag (see `.VS` below) rather than a traditional map file.

Map files are consumed by VICE's monitor for symbol-name display during debugging: the monitor's `ll` command (load labels) accepts Oscar64's `.lbl` format; `.map` files require conversion or manual parsing.

Format is tool-specific text: Oscar64 emits one `symbol = $ADDR` line per resolved symbol. cc65 `ld65` emits a structured text report with segment summary, module summary, and symbol table sections.

---

### .LBL — VICE symbol file (Oscar64 native output)

**Produced by:** oscar64
**Consumed by:** vice

Oscar64 natively emits `.lbl` files containing symbol-to-address mappings in VICE monitor label format. Each line is:

```
al HHHH .SYMBOLNAME
```

where `HHHH` is the 4-digit hex address and `SYMBOLNAME` is the C or assembly label. The leading `al` prefix is the VICE monitor `add_label` command mnemonic.

VICE loads `.lbl` files via `ll <filename>` in its built-in monitor, enabling symbolic display of disassembly, breakpoints by name (`break main`), and watch expressions. This tight integration between Oscar64 and VICE is a primary reason for Oscar64's status as the preferred toolchain in this KB.

---

### .VS — KickAssembler/VICE symbol file

**Produced by:** kickassembler
**Consumed by:** vice

KickAssembler emits a VICE symbol file (conventionally `.vs` or `-symbols.txt`) when invoked with the `--vicesymbols` flag. Format matches the VICE `al` label format used by `.LBL` files. The file is loaded into VICE the same way (`ll <filename>`) and provides identical symbolic debugging capability to Oscar64's `.lbl` output.

---

### .ASM — Generated assembly listing

**Produced by:** oscar64
**Consumed by:** kickassembler, cc65

Oscar64 can emit an assembly listing (`.asm`) showing the 6502 instructions generated for each C source statement. This intermediate representation is useful for cycle-counting and verifying that the compiler has produced efficient code for hot paths (raster handlers, sprite sorters, etc.).

The listing format is not a formal standard; it is Oscar64-specific human-readable text with C source lines interleaved with the generated opcodes and addresses. It is not directly assembled by KickAssembler or cc65 — the "Consumed by" relationship above refers to the practice of manually extracting hot inner loops for hand-optimization in an assembler.

---

### .S — cc65/ca65 assembly source

**Produced by:** oscar64, cc65
**Consumed by:** cc65

The `.s` extension is the standard assembly source file for ca65 (the assembler component of the cc65 suite). cc65 (the C compiler) emits `.s` files as its intermediate representation before invoking ca65. The ca65 assembler then compiles `.s` to `.o` object files.

Oscar64 can also emit `.s` compatible output in some configurations, but its primary output path does not route through ca65. The `.s` extension is also used generically for 6502 assembly in other contexts (e.g., manual assembly sources targeting ca65 directly).

---

### .O — ca65 object file

**Produced by:** cc65
**Consumed by:** cc65

The `.o` (or `.obj`) file is the output of ca65 after assembling a `.s` source file. Object files are intermediate binary artifacts containing relocatable code and unresolved symbol references. The `ld65` linker consumes one or more `.o` files (plus a linker config file and the cc65 runtime library) to produce a final `.prg`, `.bin`, or other target format.

Object file format is ca65-specific binary and not directly human-readable. It is not used by Oscar64 or KickAssembler, which have their own internal object representations.

---

## Source Archives

### .P00 — PC64 P00 archive (single-file PRG container)

**Consumed by:** vice

The P00 format (from the PC64 emulator by Wolfgang Lorenz) wraps a single C64 PRG file in a 26-byte header that preserves the original PETASCII filename and file type — information that is lost when storing a C64 file on a host filesystem that does not support PETASCII or Commodore file-type metadata.

**File header (26 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $00–$06 | 7 | Magic string `"C64File"` |
| $07 | 1 | Null terminator (`$00`) |
| $08–$17 | 16 | PETASCII filename (null-padded, NOT `$A0`-padded as on disk) |
| $18 | 1 | Null (`$00`) |
| $19 | 1 | REL file record size (`$00` if not a REL file) |
| $1A+ | var | PRG data (load address + program bytes) |

The file extension encodes the C64 file type: `.P00` = PRG, `.S00` = SEQ, `.U00` = USR, `.R00` = REL. When multiple C64 files have names that map to the same host DOS name, the numeric suffix increments (`.P00`, `.P01`, `.P02`, ...).

P00 is a legacy format predating modern emulators' ability to handle PETASCII transparently. VICE supports it for loading archived software collections assembled in the PC64 era. It is not produced by any toolchain in this KB.

---

## See also

- `../hardware/kernal-routines-reference.md` — LOAD, SAVE, OPEN, CLOSE, CHKIN, CHKOUT
- `iec-disk-reference.md` — IEC bus protocol and 1541 drive internals
- `../runtime/vice-reference.md` — VICE emulator usage and debugging
- `../hardware/memory-map-reference.md` — C64 memory map (tape buffer at `$033C`, disk buffer at `$0200`)
