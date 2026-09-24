<!-- doc-type: format-reference -->

# C64 File Formats

File formats produced and consumed by the C64 toolchain and runtime: layout, use, and which tools in this knowledge base read or write each. Disk-image bit-level details follow the specifications published by Peter Schepers at `https://ist.uwaterloo.ca/~schepers/formats.html`. Producers and consumers are the current Tool node set; where the canonical producer is a music tracker or hardware utility not yet a Tool node, the section says so.

---

## Executables

### .PRG — Program file (executable)

**Produced by:** oscar64, kickassembler, cc65
**Consumed by:** vice, c1541

The `.PRG` file is the C64 executable container. It consists of a 2-byte little-endian load address followed by raw 6502/6510 machine code. The load address tells the loader (KERNAL or a fastloader) where in the C64's 64 KiB address space to place the data; loading does not start it. The user types `RUN` (for a file at `$0801` whose BASIC line `SYS`es the code) or `SYS` with the start address. RUN/STOP + RESTORE starts nothing: the KERNAL NMI handler (`$FE43`, bytes read from `kernal-901227-03.bin`) finds STOP held, reinitialises the vectors, I/O and screen (`$FD15`, `$FDA3`, `$E518`) and jumps through `($A002)` to BASIC's warm start. (An earlier version listed RUN/STOP + RESTORE as a way to begin execution.)

Oscar64 produces `.prg` directly via its built-in linker. KickAssembler emits `.prg` as its default output when a load address is specified in the source. cc65 requires a separate `ld65` linker invocation with an appropriate config file to produce a `.prg`.

The 2-byte header distinguishes `.PRG` from `.BIN`: a load address of `$0801` is the standard BASIC program start for autostarting demos (the BASIC stub `10 SYS 2064` or similar). A load address of `$C000` or other high-memory address signals a directly-assembled utility or IRQ routine.

Maximum useful size is bounded by available RAM: roughly 38 KiB for a pure program (bank-switched or streaming loaders can exceed this). On real hardware, programs above approximately 50 KiB require multi-part loading.

---

### .CRT — Cartridge image

**Produced by:** oscar64, kickassembler, cartconv
**Consumed by:** vice, easyflash, ef3, cartconv

The `.CRT` format (defined by the VICE team, current spec v1.00) packages one or more ROM banks with metadata about the cartridge hardware type. It is the interchange format for C64 cartridge software and EasyFlash cart images used in the demoscene.

**File header (64 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $0000 | 16 | Magic string `"C64 CARTRIDGE   "` (space-padded) |
| $0010 | 4 | Header length (big-endian; typically `$00000040`) |
| $0014 | 2 | Version (big-endian; `$0100` = v1.0) |
| $0016 | 2 | Hardware type (big-endian; 0 = generic 8K/16K) |
| $0018 | 1 | EXROM line state (0 = low/active) |
| $0019 | 1 | GAME line state (0 = low/active) |
| $001A | 1 | Hardware revision (subtype); 0 unless set. Measured with cartconv 3.10: `-s 1` wrote 1 here and set the version to `$0101`, and `cartconv -f` prints it as "Hardware Revision". An earlier version of this table folded it into six reserved bytes |
| $001B | 5 | Reserved (zero) |
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

EasyFlash carts (hardware type `$0020`) contain up to 64 banks of 16K, each represented by two CHIP packets (one for `$8000`, one for `$A000`). The cartridge boots in Ultimax mode from bank 0 ROMH, so the reset vector is at ROMH offset `$1FFC`. cartconv and the KickAssembler recipes write EXROM 1, GAME 0, chip type 2 and a ROMH load address of `$A000`; Oscar64 writes EXROM 0, GAME 0, chip type 0 and `$E000`; VICE boots both ([cartconv-reference](../toolchains/cartconv-reference.md)). Two places in bank 0 ROMH are conventions EasyProg acts on (its source, `flash.c`): offset `$1800`, 768 bytes, holds the EAPI flash driver when it starts with `65 61 70 69`, and EasyProg then writes its own driver for the fitted chip over `$1800`-`$1AFF`; offset `$1B00` may hold `65 66 2D 6E 41 4D 45 3A` (`EF-Name:`) and a 16-byte PETSCII name for the menu. A save area ships as a packet of `$FF`, because EasyProg erases only the sectors a CRT contains (Programmer's Guide). Decoded from the CRT the `easyflash-eapi` recipe builds, and from the file VICE wrote back after two boots with `-easyflashcrtwrite`: the packets keep their order and size, only the saved bytes change, and VICE rewrites the header's 32-byte name as `EasyFlash`.

Oscar64 writes the container itself with `-tf=crt8`, `-tf=crt16` (type 0) or `-tf=crt` (EasyFlash). KickAssembler has no cartridge directive: in 5.25 `.crt` and `.bank` both fail with `Invalid directive` (run 2026-09-23), so a KickAssembler cartridge is either raw banks written with `outBin` and wrapped by cartconv, or a `.CRT` emitted byte by byte from the source as the `crt-banked` and `easyflash-save` recipes do. An earlier version of this paragraph named those two directives; they do not exist. The header and packet fields as decoded from files built by both tools, the type table, and what each type did when booted are in [cartconv-reference](../toolchains/cartconv-reference.md).

---

### .BIN — Raw binary payload

**Produced by:** oscar64, kickassembler
**Consumed by:** vice, c1541

A raw binary file with no header: machine code or data at an implicit address. Used for ROM images, screen data, sprite sheets, or intermediate build artifacts before final linking. VICE loads one at a given address with the monitor's `bload "file" 0 <address>` (`bl`); its `l` command with an address skips the file's first two bytes, so it is for `.PRG` files. (An earlier version named `-autostart-handle-tde`, which x64sc 3.10's `-help` describes as "Handle True Drive Emulation on autostart", and `l`.) The distinction from `.PRG` is the absence of the 2-byte load-address header.

KickAssembler writes a `.prg` with its load address by default, even for a source that only sets `* = $c000`; `-binfile` writes the same bytes with no header (KickAssembler 5.25, both run here). Oscar64 writes a headerless file with `-tf=bin` (Oscar64 run here: the output begins with code, not a load address). (An earlier version said KickAssembler emits `.bin` whenever `.pc` is used without a header, and that Oscar64 writes raw binaries per linker segment.)

---

## Disk Images

Disk image formats capture the content of floppy disks used with the Commodore 1541, 1571, and 1581 drives. The canonical specifications are maintained by Peter Schepers; the descriptions below follow them.

### .D64 — Single-sided 35-track 1541 disk image

**Consumed by:** vice, c1541

The D64 is a sector-for-sector copy of a Commodore 1541 (or 1540) single-sided floppy disk. It is the most widely used C64 disk image format, used for software distribution, fastloader testing, and demo release packaging.

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

Error bytes, when present, are appended after all sector data: one byte per sector, in track then sector order (track 1 sector 0 first, track 35 sector 16 last). **The byte is the 1541 floppy controller's job return code, not the DOS error number.** `$01` means the sector read cleanly; `$03` means "no sync", which the error channel reports as `21`. A tool that prints the byte as the DOS number is wrong for every non-zero value. The drive ROM's conversion from job code to DOS number is described in `iec-disk-reference.md`, "The 1541 DOS Error Codes"; the table below gives the codes an image can carry and what a stock 1541 prints for each.

| Byte | Controller condition | DOS number | VICE 3.10 (true drive, `U1` block read of a flagged sector, measured here) |
|------|----------------------|-----------|---------------------------------------------------------------------------|
| `$00` | none recorded; image tools treat it as no error | none | `0, OK` |
| `$01` | job returned OK | none | `0, OK` |
| `$02` | header not found | 20 | `20, READ ERROR` |
| `$03` | no sync | 21 | `20, READ ERROR` for one flagged sector; `21, READ ERROR` when every sector of the track carries `$03` |
| `$04` | data block not present | 22 | `22, READ ERROR` |
| `$05` | checksum error in the data block | 23 | `23, READ ERROR` |
| `$07` | verify error (write) | 25 | `0, OK`; a read cannot exercise it |
| `$08` | write protect on | 26 | `0, OK`; a read cannot exercise it |
| `$09` | checksum error in the header | 27 | `20, READ ERROR` |
| `$0B` | disk ID mismatch | 29 | `20, READ ERROR` for one flagged sector; `29, DISK ID MISMATCH` when every sector of the track carries `$0B` |
| `$0F` | drive not ready | 74 | `0, OK` |

The measurement column comes from one run of the windowless x64sc build of VICE 3.10 with `-drive8truedrive -drive8type 1541` and a 175,531-byte image whose flagged sectors sat one per track; three PAL runs produced byte-identical screens. VICE 3.10 builds each sector's GCR from the byte (its `gcr.c`): `$03` replaces the sync marks, `$02` the header block ID, `$09` the header checksum, `$0B` the header's disk ID, `$04` the data block ID and `$05` the data checksum. It does nothing for `$07`, `$08` and `$0F`, so a read of such a sector succeeds. The two "for one flagged sector" rows come from the drive ROM running under emulation, not from the injection: VICE alters exactly the bytes named and the ROM reports what it reports. The reading is consistent with the ROM matching a wanted header by comparing the raw GCR it reads against an image of the header it expects, so a header with a wrong checksum or ID is never matched and the search times out as `20`; that account of the ROM is not measured here. Codes `$0A` (28) and `$10` (24) were not measured here. Whether a write (`U2`) to a `$08` sector reports `26` was not measured here.

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
| $00–$01 | 2 | In the first entry of a sector only: track/sector of the next directory sector, `$00 $FF` in the last one; `$00 $00` in the other seven entries. Read with Python from a VICE-made image (see `iec-disk-reference.md`, "Reading the directory"); an earlier version said 0/0 if last |
| $02 | 1 | File type (`$82`=PRG, `$81`=SEQ, `$83`=USR, `$84`=REL) |
| $03–$04 | 2 | First sector of file (track, sector) |
| $05–$14 | 16 | Filename (PETASCII, `$A0`-padded) |
| $15–$16 | 2 | REL only: track and sector of the first side sector (measured below; `$00 $00` on other types, not measured here) |
| $17 | 1 | REL only: record length (the DOS's stated range is 1 to 254; 32, 100 and 254 measured below) |
| $1E–$1F | 2 | File size in sectors (little-endian); for a REL file the side sectors are counted in |

Directory art lives entirely in these bytes: a type of `$80` (DEL, closed), a first-sector pointer of `0 0` for an entry that owns no blocks, any PETSCII in the name field and any value at `$1E`, all written from the host by [cc1541](../toolchains/cc1541-reference.md), which also shows what the drive's listing makes of an `$A0` inside a name.

File data uses a 10-sector interleave chain (each sector's first two bytes are the track/sector link to the next; the remaining 254 bytes are data). The last sector in a chain uses `$00` as the next-track link and stores the index of the last used byte in what would normally be the next-sector byte, so the sector holds that value minus one data bytes (an earlier version said it stored the count of data bytes; a 91-byte last sector written by the 1541 in VICE holds 92).

**REL file (type `$84`):**

A relative file is a data chain like any other plus one or more **side sectors**, blocks that list the track and sector of every data block in order so the drive can turn a record number into a block without walking the chain. Everything in this subsection was read off `.d64` images written by the 1541 ROM under VICE x64sc 3.10 (`-drive8truedrive`, windowless build) by the recipe `../recipes/oscar64/rel-side-sectors.md` and a side run of the same shape with 254-byte records; the recipe also prints the same bytes from the C64 side through `U1`. The images were decoded on the host with this script, which walks the directory, the side-sector chain and the data chain (`SPT` is the sectors-per-track table above):

```text
img = open('disk.d64', 'rb').read()
SPT = [21]*17 + [19]*7 + [18]*6 + [17]*5
def blk(t, s):
    o = (sum(SPT[:t-1]) + s) * 256
    return img[o:o+256]
ent = blk(18, 1)[0:32]                      # first directory entry
print(hex(ent[2]), ent[3], ent[4], ent[0x15], ent[0x16], ent[0x17],
      ent[0x1e] | ent[0x1f] << 8)
t, s = ent[0x15], ent[0x16]
while t:                                    # side-sector chain
    b = blk(t, s)
    print(t, s, 'next', b[0], b[1], 'number', b[2], 'reclen', b[3],
          'group', [(b[4+2*i], b[5+2*i]) for i in range(6)],
          'data', [(b[16+2*i], b[17+2*i]) for i in range(120) if b[16+2*i]])
    t, s = b[0], b[1]
t, s = ent[3], ent[4]                       # data chain
while t:
    b = blk(t, s)
    print(t, s, 'link', b[0], b[1])
    t, s = b[0], b[1]
```

The directory entry of the recipe's file `SS`, created with `SS,L,` and the byte 100, eight records written, then closed:

| Offset | Bytes read | Meaning |
|--------|-----------|---------|
| $02 | `$84` | REL, closed. The recipe read the entry through `U1` while the file was still open and the byte was already `$84`. |
| $03–$04 | `$11 $00` | first data block, 17/0 |
| $15–$16 | `$11 $0A` | first side sector, 17/10 |
| $17 | `$64` | record length 100 |
| $1E–$1F | `$05 $00` | 5 blocks: 4 data blocks and 1 side sector. Read while the file was open it was `$00 $00`; the drive writes the count at close. |

The side sector at 17/10, byte by byte:

| Offset | Size | Bytes read | Field |
|--------|------|-----------|-------|
| $00–$01 | 2 | `$00 $17` | Track and sector of the next side sector. Track 0 marks the last one, and the sector byte is then the index of the last used byte in this block: `$17` = 23 is the last byte of the fourth data-block pair (16 + 4 × 2 − 1). |
| $02 | 1 | `$00` | This side sector's number in the group, 0 to 5. |
| $03 | 1 | `$64` | Record length, the same value as the directory entry's `$17`. |
| $04–$0F | 12 | `$11 $0A` then ten `$00` | Track and sector of side sectors 0 to 5 of the group, in order, `$00 $00` for those that do not exist. Every side sector carries the whole list. |
| $10–$FF | 240 | `$11 $00 $11 $0B $11 $01 $11 $0C` then zeros | Track and sector of data blocks, in file order, up to 120 pairs; `$00` in a track position ends the list. |

So the file's data chain is 17/0, 17/11, 17/1, 17/12, and the chain's own links agree with the list: each block's bytes 0 and 1 name the next, and the last block's link is `$00 $EF`. That `$EF` = 239 is the last used byte of the data chain, and it is not where record 8 ends: 4 blocks hold 1,016 data bytes, ten 100-byte records fit, and the drive fills every allocated block with whole records, so records 9 and 10 exist on the disk though nobody wrote them, and 239 = 2 + 1000 − 762 − 1 is the last byte of record 10 (both records read back from the image as `$FF` followed by 99 `$00`; a `P` to record 10 answered `00` and read one `$FF`, a `P` to record 11 answered `50`). The last 16 data bytes of the block, after record 10, hold `$FF` then fifteen `$00`: the drive marks the start of every record slot it allocates, including the slot record 11 would begin in, even though record 11 does not fit and a `P` to it answers `50` (read from the image: `$FF` sits at block bytes 40, 140 and 240 of 17/12, one per 100-byte slot).

**Record contents and padding.** Every record the drive allocates starts as `$FF` followed by zeros. A record written short is padded with `$00` to the record length: record 3 of the recipe was written as ten bytes and reads back from the image as those ten bytes then ninety `$00`, and a read of it through the drive returns ten bytes with EOF, the padding not sent. A record can straddle two blocks: with 100-byte records, record 3 occupies bytes 200 to 253 of the first block and 0 to 45 of the second, and the program never sees the seam.

**Two side sectors.** The side run created `BIG,L,` with the byte 254, sent one `P` to record 125 (reply `50, RECORD NOT PRESENT`) and wrote one byte to it (reply `00, OK`). That single write allocated 125 data blocks and two side sectors; the entry then read `$84`, side sector 17/10, record length `$FE`, 127 blocks. Side sector 0 at 17/10 held next = 12/9, number 0, and 120 data-block pairs; side sector 1 at 12/9 held next = `$00 $19` (25 = 16 + 5 × 2 − 1), number 1, and 5 pairs; both carried the group list `$11 $09 $0C $09` then zeros, that is 17/10 and 12/9. The 125-block data chain matched the two lists end to end, and the last block's link was `$00 $FF` because a 254-byte record fills a block exactly. After that write a `P` to record 125 answered `00` and a `P` to record 126 answered `50`: with 254-byte records no extra records fall out of the allocation.

**Limits.** The record length byte is 1 to 254; the DOS's stated range, and the recipes use 32, 100 and 254 (the length 0 and 255 cases were not measured here). A group holds six side sectors of 120 data blocks each, 720 blocks (arithmetic from the tables above), which is more than a 35-track disk has free, so on a 1541 the disk is the limit, and the DOS's stated reply for a `P` past it is `52, FILE TOO LARGE` (not provoked here; its ROM site is in `iec-disk-reference.md`, "The 1541 DOS Error Codes"). The record number in the `P` command is two bytes, so 65,535 is the highest a program can name (arithmetic; not measured here). Drives with more capacity extend the scheme with a further block that lists groups; that is not measured here and this table is the 1541's.

**The P command's byte order.** Five bytes on the command channel: `P`, the data channel's secondary address plus 96 (`$62` for channel 2), the record number low byte, the record number high byte, and the byte within the record counted from 1. Measured in the recipe and its second run: `P` to record 5 byte 1 read all 100 bytes of record 5; `P` to record 5 byte 7 read 94 bytes starting at the seventh; a `P` to a record that does not fit in the allocated data blocks answers `50` and a read after it returns one `$0D` with the status still `50`; a write after that `50` extends the file and answers `00`. Which records answer `50` depends on the record length and on what is allocated: a record answers `00` when the whole of it fits in the allocated data blocks and `50` when any of it would lie past them. With 100-byte records and one allocated block (254 data bytes), records 1 and 2 answered `00` and record 3, whose bytes 200 to 299 cross the end, answered `50`; after the write to 3 allocated the second block (508 bytes), 4 and 5 answered `00` and 6 (500 to 599) answered `50`; after the third block (762 bytes), 7 answered `00` and 8 (700 to 799) answered `50`. The same rule gives the seven records of 32 bytes that fit one block in `../techniques/file-io.md` (`kernal_relative_file_io`) and the ten of 100 bytes that fit four.

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

**Typical use:** larger software titles, tools that need more than a D64's 664 free blocks. A freshly formatted D71 is 349,696 bytes with 1,328 blocks free (c1541 3.10, measured here), 337,312 data bytes at 254 per block. (An earlier version said "more than 664 KiB"; 664 is the 1541's free-block count.)

---

### .D81 — 1581 disk image

**Consumed by:** vice, c1541

The D81 represents a Commodore 1581 double-density 3.5-inch disk, with more capacity than the 1541 or 1571.

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

**Key differences from D64/D71:** sector interleave is 1 for both files and directories (the 1581 buffers a full track in internal RAM, making interleave irrelevant for sequential read performance). Maximum of approximately 296 directory entries at the root. The 1581 DOS supports partitions and subdirectories. A D81 is a dump of all 3,200 sectors (819,200 bytes from `c1541 -format ... d81`, measured here), so whatever the DOS writes to disk for them is in the image. (An earlier version said they are not represented in the image, and a later one that how the DOS records them was not checked.)

**Partitions, as the image shows them** (measured on the image `recipes/kickassembler/d81-partition.md` leaves, VICE x64sc 3.10 with the 1581 DOS; rung 1): a partition is a root directory entry of type `$85` (CBM) with its start track and sector and its block count, and the root BAM (40/1, 40/2) marks its tracks used. Formatted as a sub-directory, its first track takes track 40's layout: header at sector 0 (`14 03 44 00`, name, ID, `33 44`), BAM for tracks 1–40 at sector 1 and 41–80 at sector 2 (`44 BB`, ID, `C0`), directory from sector 3. The partition's BAM marks every track outside it as full (`00 00 00 00 00 00`). Byte offset of a block = ((track − 1) × 40 + sector) × 256. `c1541 -dir` lists the partition as a `cbm` file and does not enter it.

**Typical use:** large software archives, tools requiring subdirectory support.

---

### .G64 — GCR-encoded 1541 disk image (with full track layout)

**Consumed by:** vice, c1541

The G64 format preserves the raw GCR (Group Code Recording) encoding of a 1541 disk, including inter-sector gaps, SYNC marks, and variable track lengths. Unlike D64, which discards the physical encoding and retains only sector data, G64 retains the full magnetic track layout. G64 is therefore needed for copy-protected software, custom loader timing, and anything where the exact physical track structure matters.

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

**Correction (2026-09-23).** Item 5 used to be the whole of what this page said about the code: "GCR-encoded at 4 bytes → 5 bytes ratio". The ratio is right and it is not how the code works. The 1541 splits every byte into two nibbles and replaces each nibble with a five-bit word from a sixteen-entry table, so four bytes fill five, and a decoder written from the ratio alone cannot read a sector. Items 3 and 6 gave the gaps as ranges; in the image measured below c1541 writes 9 and 8. The subsection "GCR encoding" gives the table, the two block layouts, the sync and gaps, and the zones, each as decoded from a G64 or read out of the drive ROM.

Speed zones (1541-standard):

| Track range | Zone | Nominal track size |
|------------|------|-------------------|
| 1–17 | 3 | 7,820 bytes |
| 18–24 | 2 | 7,170 bytes |
| 25–30 | 1 | 6,300 bytes |
| 31–35 | 0 | 6,020 bytes |

#### GCR encoding

Every figure in this subsection was measured here unless it says otherwise. A G64 was formatted and written on the host with VICE 3.10's `c1541` (`c1541 -format "TEST,01" g64 disk.g64 -write known.prg known`, where `known.prg` is 263 bytes: load address `$0801`, the bytes `$00` to `$FF` in order, then `KNOWN`). The image was decoded with the Python script at the end of the subsection, and it was read back under the windowless x64sc build of VICE 3.10 with true drive emulation, where `LOAD"KNOWN",8,1` printed `LOADING` and then `READY.`. The ROM figures come from the 1541 ROM image VICE ships, `DRIVES/dos1541-325302-01+901229-05.bin`, 16,384 bytes mapped at `$C000`.

**Speed zones.** The image's track table and speed-zone table held, for the 35 tracks with data (every half-track offset was zero):

| Tracks | Zone entry | Track length (bytes) | Sectors | Bit rate at 300 rpm | Bit cell |
|--------|------------|----------------------|---------|---------------------|----------|
| 1–17 | 3 | 7,692 | 21 | 307,680 bit/s | 3.25 µs |
| 18–24 | 2 | 7,142 | 19 | 285,680 bit/s | 3.50 µs |
| 25–30 | 1 | 6,666 | 18 | 266,640 bit/s | 3.75 µs |
| 31–35 | 0 | 6,250 | 17 | 250,000 bit/s | 4.00 µs |

The bit-rate and bit-cell columns are arithmetic on the track length: bytes × 8 × 5 revolutions a second. The four rates are 16 MHz divided by 52, 56, 60 and 64, which is the drive's 16 MHz crystal divided by 13, 14, 15 or 16 and then by four per bit cell; the crystal and the divide-by-four are not measured here. The sector counts and the zone boundaries are in the ROM: `$FED1` holds `11 12 13 15` (17, 18, 19 and 21 sectors, zone 0 first) and `$FED7` holds `24 1F 19 12` (36, 31, 25 and 18, the first track above each zone, zone 0 first). The zone numbers in the G64 table are the ROM's: zone 3 is the outermost, fastest zone. The "nominal track size" column in the table above this subsection is not what c1541 3.10 writes; the lengths it wrote are the ones here.

**The code table.** Each byte is split into two nibbles and each nibble becomes a five-bit word, high nibble first, so four bytes occupy five bytes on the track. The table was derived from the image alone, from the bytes whose values were known before decoding (the `$08` and `$07` block IDs, the `$0F $0F` header padding, the track number, the 254 file bytes in the first data block and its `$00 $00` padding), and every one of the sixteen entries then matched the ROM's encode table at `$F77F`, which reads `0A 0B 12 13 0E 0F 16 17 09 19 1A 1B 0D 1D 1E 15` and is the only run of sixteen distinct five-bit values with no three consecutive zero bits in the ROM:

| Nibble | Code | Nibble | Code | Nibble | Code | Nibble | Code |
|--------|------|--------|------|--------|------|--------|------|
| `0` | `01010` | `4` | `01110` | `8` | `01001` | `C` | `01101` |
| `1` | `01011` | `5` | `01111` | `9` | `11001` | `D` | `11101` |
| `2` | `10010` | `6` | `10110` | `A` | `11010` | `E` | `11110` |
| `3` | `10011` | `7` | `10111` | `B` | `11011` | `F` | `10101` |

By inspection of the sixteen words: none holds three zero bits in a row, none starts with more than one zero and none ends with more than one, so two words side by side never put more than two zeros together, which is what the drive's read clock needs; and no word starts or ends with more than four ones, so the longest run of ones inside data is eight, short of the ten that make a sync. `F` is `10101`, not `11111`, for the second reason.

**Header block.** After each header sync, 10 GCR bytes decode to 8:

| Offset | Size | Field | Decoded, track 17 sector 0 |
|--------|------|-------|----------------------------|
| 0 | 1 | Header block ID | `$08` |
| 1 | 1 | Checksum, the XOR of bytes 2 to 5 | `$11` |
| 2 | 1 | Sector | `$00` |
| 3 | 1 | Track | `$11` (17) |
| 4 | 1 | Disk ID, second character | `$A0` |
| 5 | 1 | Disk ID, first character | `$A0` |
| 6–7 | 2 | Padding | `$0F $0F` |

The 10 GCR bytes were `52 56 B5 29 6B D2 B4 A5 55 55`. All 21 headers on track 17 carried sectors 0 to 20 in order, each with a checksum equal to the XOR of its sector, track and two ID bytes. The disk ID differs: c1541 3.10 wrote `$A0 $A0` into every sector header, while the BAM at track 18 sector 0 (bytes `$A2`–`$A3`) holds `30 31`, the `01` given on the command line, and the directory listing shows `01`. The disk still loaded under true drive emulation, as above; the ROM is documented as taking the ID from a sector header when it initialises a disk rather than from the BAM, which would explain that, but the mechanism is not measured here. A tool that expects the header ID to match the directory line will not find that in a c1541-formatted G64. Because both ID bytes were `$A0`, which of the two characters comes first on the track was not measured here; the order in the table is the ROM's as documented, not confirmed by this image. What the ROM's own formatter writes into the header on a real disk is not measured here either.

**Data block.** After each data sync, 325 GCR bytes decode to 260:

| Offset | Size | Field | Decoded, track 17 sector 0 |
|--------|------|-------|----------------------------|
| 0 | 1 | Data block ID | `$07` |
| 1–256 | 256 | Sector data | `11 0A` (link: track 17, sector 10), then `01 08 00 01 02` ... `FB` |
| 257 | 1 | Checksum, the XOR of the 256 data bytes | `$12` |
| 258–259 | 2 | Padding | `$00 $00` |

The 256 data bytes were the file's first sector as DOS lays it out: the two-byte link to the next sector, then 254 file bytes (the load address `01 08`, then `$00` to `$FB`), and the XOR of those 256 bytes is `$12`, as stored.

**Sync and gaps.** As c1541 3.10 wrote this image, byte aligned: 5 × `$FF` (40 one bits), the 10 header bytes, 9 × `$55`, 5 × `$FF`, the 325 data bytes, 8 × `$55`, then the next sector's sync. That is 362 bytes a sector, 21 × 362 = 7,602, and the rest of the 7,692-byte track is `$55` (98 bytes in a row after the last data block, the 8-byte gap included). A scan of the bit stream for runs of ten or more one bits finds 42 on the track, one before each header and one before each data block; the drive's detector fires on ten, so a 40-bit sync is four times what it needs and `disk_protection_tricks` in `../techniques/loaders-packers.md` is about what a loader does with that slack and with the fields above. The gaps a real 1541's formatter writes depend on the track's spare space and are not measured here. The bit clock per zone is why `gcr_timing_assumes_stock_drive` in `../pitfalls/loader.md` exists: a drive that is not stepping its clock through those four rates reads the same bits at the wrong cell width.

**Decoder.** The script that produced the figures above. It takes the image, a track, a sector, and the file whose first 254 bytes sit in that sector; the table it prints is learned from the image, never assumed.

```text
#!/usr/bin/env python3
# Decode one track of a G64 and derive the 4-to-5 GCR table from known bytes.
# usage: gcr_g64.py disk.g64 TRACK SECTOR [file whose first 254 bytes sit in SECTOR]
import struct, sys

img = open(sys.argv[1], "rb").read()
trk, sec = int(sys.argv[2]), int(sys.argv[3])
n = img[9]
offs = [struct.unpack_from("<I", img, 12 + 4 * i)[0] for i in range(n)]
zone = [struct.unpack_from("<I", img, 12 + 4 * n + 4 * i)[0] for i in range(n)]
print(img[:8], "version", img[8], "entries", n, "max", struct.unpack_from("<H", img, 10)[0])
for i in range(0, n, 2):
    if offs[i]:
        print("track", 1 + i // 2, "len", struct.unpack_from("<H", img, offs[i])[0], "zone", zone[i])

o = offs[(trk - 1) * 2]
tb = img[o + 2:o + 2 + struct.unpack_from("<H", img, o)[0]]
bits = "".join(f"{b:08b}" for b in tb)

syncs, i = [], 0                      # runs of ten or more 1 bits
while i < len(bits):
    j = i
    while j < len(bits) and bits[j] == "1":
        j += 1
    if j - i >= 10:
        syncs.append((i, j))
    i = j + 1
print("syncs", len(syncs))

def codes(start, nbytes):             # 5-bit groups for nbytes decoded bytes
    return [int(bits[start + 5 * k:start + 5 * k + 5], 2) for k in range(2 * nbytes)]

table = {}
def learn(cs, known):                 # known: list of byte values or None
    for k, b in enumerate(known):
        if b is not None:
            for c, nib in ((cs[2 * k], b >> 4), (cs[2 * k + 1], b & 15)):
                assert table.setdefault(c, nib) == nib, "table conflict"

blocks = [(e, (syncs[k + 1][0] if k + 1 < len(syncs) else len(bits)) - e)
          for k, (s, e) in enumerate(syncs)]
hdrs = [b for b in blocks if b[1] < 2000]
for start, _ in hdrs:                 # ID, checksum, sector, track, ID2, ID1, $0F, $0F
    learn(codes(start, 8), [0x08, None, None, trk, None, None, 0x0F, 0x0F])
for start, _ in blocks:
    if _ >= 2000:
        learn(codes(start, 1), [0x07])

def decode(cs):
    return bytes((table[cs[k]] << 4) | table[cs[k + 1]] for k in range(0, len(cs), 2))

want = None
for k, (s, e) in enumerate(syncs):
    cs = codes(e, 8)                  # sector byte is codes 4 and 5
    if (e, blocks[k][1]) in hdrs and (table.get(cs[4]), table.get(cs[5])) == (sec >> 4, sec & 15):
        want = k
if len(sys.argv) > 4:                 # learn the rest from the known file
    dstart = syncs[want + 1][1]
    learn(codes(dstart, 260), [None, None, None] + list(open(sys.argv[4], "rb").read()[:254]) + [None, 0, 0])
print("table:", " ".join(f"{nib:X}={c:05b}" for c, nib in sorted(table.items(), key=lambda t: t[1])))

for start, _ in hdrs:
    h = decode(codes(start, 8))
    print("header", h.hex(" "), "checksum", "ok" if h[1] == h[2] ^ h[3] ^ h[4] ^ h[5] else "BAD")
d = decode(codes(syncs[want + 1][1], 260))
x = 0
for b in d[1:257]:
    x ^= b
print("data", d.hex(" "), "\nchecksum", hex(d[257]), "computed", hex(x))
```

Run as `python3 gcr_g64.py disk.g64 17 0 known.prg` it printed the table above, 21 headers each `checksum ok`, and the data block with `checksum 0x12 computed 0x12`. The ROM addresses were found by searching the ROM image for the byte runs quoted, with the file offset plus `$C000` as the address.

**Typical use:** preserving copy-protected originals, testing fastloader sync timing, demoscene releases that rely on non-standard sector ordering or gap manipulation.

---

### .NIB — Nibbler-format disk image (raw GCR bytes per half-track)

The NIB format is written by the MNIB / nibtools software, which reads a real 1541 connected to a PC (not a separate "Nibbler" hardware device, as an earlier version said; rung 4, not checked against a source here). It stores the GCR bytes as the 1541 read them off the disk surface, a fixed 8,192 bytes per half-track regardless of the track's natural length, where G64 stores each track's GCR bytes behind a length field, padded to the image's maximum track size (see .G64 above). Whether any timing information survives beyond the byte stream is not established here (rung 4, no nibtools source or real `.nib` checked); an earlier version said the format keeps "bit-level flux timing variation" and in the same paragraph that it stores byte-level content, and its heading said "preserves bit-level timing".

The file contains 84 entries (42 tracks × 2 half-tracks), each exactly 8,192 bytes, for a fixed file size of 688,128 bytes. This page earlier said there is no file header and track 1 begins at offset 0. nibtools files are reported to begin with a 256-byte header starting `MNIB-1541-RAW`, which would put track data at offset 256; neither layout has been checked against a real `.nib` or the nibtools source here, so read the header before trusting any offset.

NIB is used almost exclusively for archival of copy-protected originals (an earlier version added that it keeps flux timing G64 cannot; see above). No assembler toolchain generates it. VICE 3.10 does not read it: `c1541 -attach` on a 688,128-byte file, and on the same data behind a 256-byte `MNIB-1541-RAW` header, fails the G64 import ("Invalid number of tracks" / "Unknown GCR image version") and then misdetects the file as a DHD image, and neither the `c1541` nor the `x64sc` binary contains the string `nib`. Convert to G64 first (nibtools' `nibconv`, not installed here). (An earlier version said VICE reads NIB through a `diskcontents` handler, and this section carried a `Consumed by: vice, c1541` line.)

**Typical use:** archival of physically copy-protected disks; converted to G64 before VICE can test a loader against the original protection.

---

## Tape Images

Tape images represent the content of Commodore Datasette cassette recordings. The C64 KERNAL routines LOAD and SAVE interact with tape via the cassette port (CIA1 `$DC04`/`$DC05` timer and `$DC0D` ICR). See `../hardware/kernal-routines-reference.md` for LOAD and SAVE details.

### .T64 — Tape archive (PRG container)

**Consumed by:** vice

The T64 format was designed by the C64S emulator as a container for one or more C64 programs, nominally sourced from tape. Despite the name, T64 does not represent the tape data stream. It is a directory-based archive of PRG files with load/end addresses.

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

The TAP format records the raw pulse-width timing of a Commodore Datasette tape recording. Unlike T64, TAP represents the actual cassette data stream, including turbo loaders, custom protection schemes, and non-standard encoding. This makes it the preferred format for archival and protection research.

**File header (20 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $0000–$000B | 12 | Signature `"C64-TAPE-RAW"` |
| $000C | 1 | Version: `$00` (original) or `$01` (extended) |
| $000D–$000F | 3 | Reserved (zero) |
| $0010–$0013 | 4 | Data length in bytes, little-endian (excludes this 20-byte header) |

**Data section** (immediately follows header):

Each byte represents a pulse: the duration is `(byte_value × 8) / 985,248` seconds under the PAL clock (985,248 Hz). The NTSC clock (1,022,727 Hz) produces slightly different timing, but the format stores raw cycle counts so VICE applies the correct clock for the target region.

**Version `$00`:** A data byte of `$00` signals a pulse overflow (duration > 255 × 8 cycles); the actual duration is unspecified and varies by implementation.

**Version `$01`:** A data byte of `$00` is followed by 3 additional bytes giving the true pulse duration as a 24-bit little-endian cycle count. This extension handles long pauses and turbo-loader timing precisely.

Standard KERNAL tape encoding uses three pulse lengths, and a data bit is a pair of pulses, not one pulse. **Correction (2026-09-23).** This paragraph used to say the KERNAL used "two pulse lengths: short (~370 µs, PAL) for a 0 bit, long (~530 µs) for a 1 bit". A decoder written from that sentence reads garbage from every KERNAL tape: the two figures it gave are roughly the short and medium pulses, the long pulse was missing, and no single pulse carries a bit. The subsection below replaces it, from a SAVE recorded in VICE. Turbo loaders (e.g., FINISH, Novaload, Freeload) use other encoding schemes, and TAP preserves them all.

#### KERNAL bit encoding

Every figure in this subsection was measured on the windowless x64sc build of VICE 3.10 (PAL, `-warp`): a writable TAP was attached with `-1`, the monitor command `tapectrl 4` pressed RECORD, and `-keybuf` typed `10 rem abc` and `save"t",1`. The TAP came back at version 1 with 41,802 data bytes, byte-identical on a second run, and a Python reader decoded all 448 bytes of it with no parity failure. VICE records a falling edge at each `1` to `0` change of the write line, so one TAP entry is one complete KERNAL pulse, low half and high half together.

**Pulse lengths.** The pulse bytes fall into three clusters and nothing lies between them:

| Pulse | TAP bytes seen | Most common | Cycles (PAL) | Duration | Role |
|-------|---------------|-------------|--------------|----------|------|
| Short (S) | `$2C`–`$31` | `$2F` (20,191 of 36,862) | 352–392, mode 376 | about 382 µs | leader, sync, first half of a 0 bit, second half of a 1 bit |
| Medium (M) | `$40`–`$44` | `$43` (2,172 of 4,480) | 512–544, mode 536 | about 544 µs | second half of a 0 bit, first half of a 1 bit, second half of the byte marker |
| Long (L) | `$56`–`$59` | `$58` (279 of 452) | 688–712, mode 704 | about 715 µs | first half of the byte marker and of the end-of-block marker |

The spread inside each cluster is the KERNAL's own jitter, not a TAP artefact: the write interrupt reprograms CIA 1 Timer B from software, so an interrupt that is served a few cycles late lengthens the pulse by a few cycles. A reader should classify by threshold (below `$3A` short, `$3A`–`$4B` medium, above `$4B` long worked here), never by exact value.

**Bit and byte layout.** Each unit of the stream is a pulse pair:

| Pair | Meaning |
|------|---------|
| S then M | data bit 0 |
| M then S | data bit 1 |
| L then M | byte marker: a data byte follows |
| L then S | end-of-block marker: no more bytes in this copy |

A byte is 20 pulses: the marker pair, eight data-bit pairs least significant bit first, and a parity pair. Parity is odd: the parity bit is chosen so that the nine bits together hold an odd number of ones. The first byte of the header block, `$89`, was recorded as the pulse bytes `57 41 43 2E 2F 42 2E 43 42 2F 2F 42 2F 42 30 43 42 2E 2F 41`, which read as `LM MS SM SM MS SM SM SM MS SM`: marker, bits `1 0 0 1 0 0 0 1` (`$89` with bit 0 first), parity 0 because the data already holds three ones.

**Block structure.** A block is written twice in a row, and each copy is preceded by a nine-byte countdown that tells the reader which copy it is:

| Element | Pulses or bytes | Measured |
|---------|-----------------|----------|
| Leader before the header block | short pulses | 27,137 shorts, about 10.4 s |
| Countdown, first copy | 9 bytes | `$89 $88 $87 $86 $85 $84 $83 $82 $81` |
| Block data | n bytes | header: 192 bytes; program: 12 bytes (`$0801`–`$080C`) |
| Checksum | 1 byte | XOR of the data bytes: `$59` for the header, `$E6` for the program |
| End-of-block marker | L then S | present after every copy |
| Gap between the two copies | short pulses | 79 shorts |
| Countdown, second copy | 9 bytes | `$09 $08 $07 $06 $05 $04 $03 $02 $01` |
| Trailer after the second copy | short pulses | 78 shorts |
| Silence between header and program | one 24-bit TAP entry | 327,689 cycles, about 0.33 s |
| Leader before the program block | short pulses | 5,376 shorts, about 2.0 s |

The header block's 192 bytes were: type `$01` (relocatable BASIC program), start address `$0801` and end address `$080D` little-endian, the filename `T` and 186 bytes of `$20` padding. The program block held the twelve bytes of `10 REM ABC` exactly as they sit in memory, with the end address exclusive. One further entry sits at the very start of the file, 472,967 cycles long: the time from pressing RECORD at boot to the first pulse, an artefact of the run and not of the format. Which of the two copies the KERNAL reads on LOAD, and how a read error in one is repaired from the other, were not measured here.

**Typical use:** archival of original cassette software; testing turbo loader implementations; copy-protection analysis.

---

### .TCRT — Tapecart image

**Consumed by:** vice

A tapecart is a flash-memory pod on the cassette port: 2 MB of flash, a
microcontroller that plays a KERNAL-format tape of a small loader, and a
fast two-bit transfer over the tape port once that loader asks for it.
A `.tcrt` file holds the pod's whole state: the fastload settings, the
file name, the loader and the flash.
The layout is from Ingo Korb's specification, `doc/TCRT Format.md` in
https://github.com/ikorb/tapecart (version 1, facts only), and VICE
3.10's reader, `load_tcrt()` in `src/tapeport/tapecart.c`, which agrees
with it. `kickassembler/tapecart-boot` builds one byte by byte and VICE
boots it (rung 1); the offsets below are the ones that file uses.

| Offset | Size | Field |
|---|---|---|
| 0 | 16 | signature `tapecartImage` + `$0D $0A $1A` (`74 61 70 65 63 61 72 74 49 6D 61 67 65 0D 0A 1A`) |
| 16 | 2 | version, 1 |
| 18 | 2 | fastload block: offset in flash |
| 20 | 2 | fastload block: length in bytes, the two load-address bytes included |
| 22 | 2 | call address: where the loader jumps after loading |
| 24 | 16 | file name the C64 prints after `FOUND` |
| 40 | 1 | flags: bit 0 = the next 171 bytes are a loader; bit 1 = the program supports data block offsets |
| 41 | 171 | loader code, or 171 zeros when bit 0 is clear |
| 212 | 4 | length of the flash content that follows, 0 to `$200000` |
| 216 | n | flash content from address 0; everything past it reads `$FF` |

All fields are little endian. The fastload block is laid out like a PRG
file: two bytes of load address, then the data. With flag bit 0 clear,
VICE supplies its copy of the default loader (`tapecart-loader.h`).
VICE reads the version as the single byte at offset 16 and the rest of
the header as the specification says; a flash length above 2 MB or a
wrong signature is refused with a log line.

**What the C64 sees.** In its first mode the tapecart plays an endless
KERNAL-format tape (VICE's `construct_pulsestream()`): a header block of
type 3 whose start and end addresses are `$0302` and `$0304`, whose name
field is the TCRT's file name and whose remaining 171 bytes are the
loader, then a two-byte data block `$51 $03`. A plain `LOAD` therefore
reads the loader into the tape buffer at `$0351` and then overwrites the
BASIC idle vector `$0302` with `$0351`, so the loader starts as soon as
LOAD returns to BASIC. The loader switches the pod to fastload mode by
clocking `$CA65` into it on the write line, one bit per motor-on edge,
and receives a six-byte info block (call address, end address, load
address) followed by the data. The file name can be anything; the PRG in
flash decides where the data goes.

Measured with `kickassembler/tapecart-boot` (a 16,641-byte PRG in the
flash, `LOAD` typed at power-on, VICE x64sc 3.10, traced):

| Stage | PAL cycles | NTSC cycles |
|---|---|---|
| header block, `TRD` to `TNIF` | 4,312,537 | 4,311,754 |
| the KERNAL's pause after `FOUND` | 12,499,955 | 12,975,026 |
| the `$0302` block, `TRD` to `TNIF` | 850,231 | 850,269 |
| loader at `$0351` to the program's first instruction | 1,846,677 | 1,850,463 |
| `LOAD` entered to the program's first instruction | 19,517,885 | 19,995,927 |

The fastload stage moved 16,645 bytes (the six-byte info block and
16,639 of data) in 1.87 s on PAL and 1.81 s on NTSC, mode switch and the
pod's 100 ms start delay included: 8,880 and 9,200 bytes a second. The
specification says "around 9500". The loader started 4,704 cycles after
the second block's `TNIF`, as LOAD returned to BASIC. The pause after
`FOUND` is the KERNAL's, the same 12.69 s at either clock as a real
tape's (`hardware/kernal-routines-reference.md`, `FAH`), and it is
two-thirds of the boot.

**Typical use:** single-file releases for the tapecart; an emulator's
persisted tapecart. Not measured here: the command mode, writing flash
from the C64, a custom loader, data block offsets, and SHIFT+RUN/STOP as
the way to start the load.

---

## Music

### .SID — PSID/RSID music file

**Consumed by:** vice, sidplayfp, kickassembler

The SID format is the container for C64 music, combining a short metadata header with a C64 binary containing the init and play routines. There are two variants: PSID (Portable SID) for files that run under emulated environments, and RSID (Real SID) for files that require an authentic C64 environment (real interrupt timing, BASIC ROM, etc.).

**Note on producers:** SID files are not produced by the assembler toolchains in this knowledge base. The canonical producers are dedicated C64 music trackers: GoatTracker 2 (cross-platform, exports PSID/RSID), SID-Wizard (native C64 tracker), and DefMON. These tools are not currently represented as Tool nodes in this KB. KickAssembler can *consume* SID files via the `LoadSid` directive to embed a SID player's binary into a larger program. It has no SID output type, but a `.file [type="bin"]` segment that writes the header bytes itself produces a valid PSID file: [disassembly-reference](../toolchains/disassembly-reference.md), section "A `.sid` file: init and play", assembles one and plays it in VICE's `vsid`. An earlier version of this note said KickAssembler does not produce `.sid` files.

**File header:**

| Offset | Size | Field |
|--------|------|-------|
| $00–$03 | 4 | Magic: `"PSID"` or `"RSID"` |
| $04–$05 | 2 | Version: `$0001` (v1), `$0002` (v2), `$0003` (v3) or `$0004` (v4) — big-endian; RSID must be 2, 3 or 4 |
| $06–$07 | 2 | Data offset: `$0076` (v1) or `$007C` (v2, v3 and v4) — big-endian |
| $08–$09 | 2 | Load address (0 = embedded in first 2 bytes of data, little-endian) |
| $0A–$0B | 2 | Init address (0 = load address; called with song number in A) |
| $0C–$0D | 2 | Play address (0 = init installs IRQ handler; must be 0 for RSID) |
| $0E–$0F | 2 | Number of songs (1–256) — big-endian |
| $10–$11 | 2 | Default start song (1-based) — big-endian |
| $12–$15 | 4 | Speed flags: each bit governs one song. 0=VBI (50/60 Hz), 1=CIA1 timer (~60 Hz) |
| $16–$35 | 32 | Song name (null-terminated ASCII, max 31 chars) |
| $36–$55 | 32 | Author name (null-terminated ASCII) |
| $56–$75 | 32 | Released/copyright (null-terminated ASCII) |

**Version 2, 3 and 4 extensions (offsets $76–$7B):**

| Offset | Size | Field |
|--------|------|-------|
| $76–$77 | 2 | Flags, big-endian: bit 0=MUS data, bit 1=PlaySID-specific (PSID) or C64 BASIC (RSID), bits 2-3=video standard (00=unknown, 01=PAL, 10=NTSC, 11=both), bits 4-5=first SID model (00=unknown, 01=6581, 10=8580, 11=both), bits 6-7=second SID model (v3 and later; same codes, 00 meaning "same as the first SID"), bits 8-9=third SID model (v4; same codes, 00 meaning "same as the first SID"), bits 10-15 reserved |
| $78 | 1 | Start page (relocation page; 0=clean, $FF=no free pages) |
| $79 | 1 | Page length (number of free pages for relocation) |
| $7A | 1 | Second SID address (v3 and later): the middle byte of `$Dxx0`, so the chip sits at `$D000 + byte × 16`. Valid values `$42`–`$7F` and `$E0`–`$FE`, even only, which is `$D420`–`$D7E0` and `$DE00`–`$DFE0`. Zero or any invalid value means no second SID. Must be 0 in v2 |
| $7B | 1 | Third SID address (v4): the same encoding and ranges as `$7A`, and it must differ from `$7A`. Zero means no third SID. Must be 0 in v2 and v3 |

**Correction (2026-09-23).** This table used to stop at version 2 and call `$7A`–`$7B` "Reserved (zero)", and the version row listed only `$0001` and `$0002`. Versions 3 and 4 put the second and third SID addresses in those two bytes and the two extra model fields in the flags word, so a reader written from the old table would play every two-SID and three-SID tune on one chip. The rows above follow the HVSC document `SID_file_format.txt` (in the collection's `DOCUMENTS` directory), and were checked two ways: against HVSC Release 84, and against VICE 3.10's `vsid`. Both are described under "Measured here" below.

**Which fields each version has:**

| Field | v1 | v2 | v3 | v4 |
|-------|----|----|----|----|
| Magic through the three strings (`$00`–`$75`) | yes | yes | yes | yes |
| Flags bits 0-5, start page, page length (`$76`–`$79`) | absent | yes | yes | yes |
| Second SID address (`$7A`) and flags bits 6-7 | absent | must be 0 | yes | yes |
| Third SID address (`$7B`) and flags bits 8-9 | absent | must be 0 | must be 0 | yes |
| Data offset | `$0076` | `$007C` | `$007C` | `$007C` |

**Version history.** Version 1 is Michael Schwendt's original header for SIDPLAY, 118 bytes ending at `$75`. Version 2 added the six bytes at `$76`; the "v2NG" extension by Simon White and Dag Lem gave most of them their meaning (flag bits 1 to 5, start page, page length) and defined RSID, and it kept `$0002` as the version number, so v2 and v2NG cannot be told apart from the header. Wilfred Bos added the second SID address and its model bits as version 3, and the third SID address and its model bits as version 4. The header length has not changed since version 2: the data starts at `$7C` in every file the collection holds. The HVSC document names these authors and gives no dates, so none are given here.

**PSID and RSID.** The magic says what the tune may assume. A PSID tune is driven by the player: the player calls init with the song number in A, then calls play on every VBI (speed bit 0) or on CIA 1 timer A (speed bit 1), and before each call it writes `$01` from the routine's address (`$37` below `$A000`, `$36` below `$D000`, `$35` at `$E000` and above, `$34` inside the `$D000` page). So a PSID tune should not depend on which ROMs are mapped; with a non-zero play address the player does the timing, and with play address 0 its init routine installs the interrupt handler itself, as the table above says. An RSID tune gets the power-on machine and nothing more: `$01` = `$37`, CIA 1 timer A running at 60 Hz with its interrupt enabled, the VIC raster interrupt set to line `$137` but not enabled, and the tune must set up its own interrupt source and handler. That is why RSID pins header fields: the version must be 2, 3 or 4; load address, play address and speed must all be 0; the embedded load address must be at or above `$07E8`; and init must not sit in a ROM or I/O window (`$A000`–`$BFFF`, `$D000`–`$FFFF`). Flag bit 1 is "PlaySID-specific" in PSID and "C64 BASIC" in RSID; with it set, the player puts the song number in `$030C` and runs the tune as a BASIC program, and the init address must then be 0. A player that finds an RSID field outside these rules must reject the file. An earlier version of this paragraph said RSID "requires the C64 BASIC ROM"; both formats have the ROMs present, and the difference is what the tune may rely on. The same contrast, from the tune's side, is in [music-sid.md](../techniques/music-sid.md).

The SID collection at HVSC (High Voltage SID Collection) is the reference corpus for this format. HVSC Release 84 holds 60,572 files: 56,349 PSID v2, 302 PSID v3, 25 PSID v4, 3,885 RSID v2 and 11 RSID v3, and no version-1 file.

**Measured here (2026-09-23).** The script below wrote a PSID v2, v3 and v4 header by hand from the tables above, over a body of two `RTS` routines, and read each one back; every field came back as written. A v3 with `$42` at `$7A` decoded to `$D420`, a v4 with `$42` and `$44` to `$D420` and `$D440`, and a v4 with `$E0` and `$F0` to `$DE00` and `$DF00`. The same reader decoded a two-SID file from the collection to `$DE00` with second-model bits 10 (8580). Across the 338 version-3 and version-4 files in the collection every `$7A` and `$7B` value is even and inside the valid ranges, no version-3 file has a non-zero `$7B`, and no version-4 file has `$7B` equal to `$7A`. VICE 3.10's `vsid` (the windowless build, run with the command below and a monitor script that reads its resources after the load) accepted all three hand-made files, logged `PSID version number: 2`, `3` and `4`, `2nd SID at $d420` and `3rd SID at $d440`, and set `SidStereo` to 1 for the v3 file and 2 for the v4 file with `Sid2AddressStart` 54304 (`$D420`) and `Sid3AddressStart` 54336 (`$D440`); the `$E0`/`$F0` file gave 56832 and 57088 (`$DE00`, `$DF00`). Four negatives behaved as the table says: a v2 header with `$42` at `$7A` left `SidStereo` at 0, and a v3 header with `$41` (`$D410`, odd), `$80` (`$D800`) or `$D8` (`$DD80`) at `$7A` logged the address but left `SidStereo` at 0, so an invalid value means no second SID. One divergence: a v3 header with `$44` at `$7B` set `SidStereo` to 2 and `Sid3AddressStart` to `$D440`, so VICE 3.10 reads the third SID byte from any version-3 file where the document reserves it for version 4; write 0 there in a v3 file. VICE's `psid.c` never reads bits 6-9; a comment there notes where they sit, and every chip gets the first SID's model. That is from its source, not measured here by ear.

```text
vsid -default -directory <VICE data dir> -console -warp +sound -limitcycles 1000000 -moncommands mon.txt tune.sid
# mon.txt
resourceget "SidStereo"
resourceget "Sid2AddressStart"
resourceget "Sid3AddressStart"
x
```

```text
# psidhdr.py: write a PSID v2/v3/v4 header by hand, then read it back.
import struct

def sid_byte(addr):                       # $D420 -> $42, 0 -> 0
    return 0 if addr == 0 else (addr >> 4) & 0xFF

def sid_addr(b):                          # $42 -> $D420, 0 -> 0
    return 0 if b == 0 else 0xD000 | (b << 4)

def sid_ok(addr):
    return addr != 0 and (addr & 0x10) == 0 and (0xD420 <= addr < 0xD800 or addr >= 0xDE00)

def write(version, sid2=0, sid3=0, model2=0, model3=0):
    flags = (1 << 2) | (1 << 4)           # PAL, 6581
    if version >= 3: flags |= (model2 & 3) << 6
    if version >= 4: flags |= (model3 & 3) << 8
    h = bytearray(b"PSID")
    h += struct.pack(">HH", version, 0x76 if version == 1 else 0x7C)
    h += struct.pack(">HHH", 0, 0x1000, 0x1003)      # load (embedded), init, play
    h += struct.pack(">HHI", 1, 1, 0)                 # songs, start song, speed (VBI)
    for s in (b"round trip", b"c64-kb", b"2026"):
        h += s.ljust(32, b"\0")
    if version >= 2:
        h += struct.pack(">HBB", flags, 0, 0)         # flags, start page, page length
        h += bytes([sid_byte(sid2) if version >= 3 else 0,
                    sid_byte(sid3) if version >= 4 else 0])
    return bytes(h) + b"\x00\x10" + b"\x60\xea\xea\x60"   # $1000: RTS  $1003: RTS

def read(d):
    version = struct.unpack(">H", d[4:6])[0]
    r = {"version": version, "data_offset": struct.unpack(">H", d[6:8])[0]}
    if version >= 2:
        flags = struct.unpack(">H", d[0x76:0x78])[0]
        r["model1"] = (flags >> 4) & 3
    if version >= 3:
        r["model2"], r["sid2"] = (flags >> 6) & 3, sid_addr(d[0x7A])
        r["sid2_ok"] = sid_ok(r["sid2"])
    if version >= 4:
        r["model3"], r["sid3"] = (flags >> 8) & 3, sid_addr(d[0x7B])
        r["sid3_ok"] = sid_ok(r["sid3"])
    return r

for v, s2, s3 in ((2, 0, 0), (3, 0xD420, 0), (4, 0xD420, 0xD440), (4, 0xDE00, 0xDF00)):
    d = write(v, s2, s3, model2=2, model3=1)
    back = read(d)
    assert back["version"] == v and back.get("sid2", 0) == s2 and back.get("sid3", 0) == s3, back
    open(f"v{v}-{s2:04x}.sid", "wb").write(d)
```

---

### .SNG — GoatTracker 2 song

The editor's own save format: the song as the composer edits it, before the packer/relocator strips and packs it. Nothing in this knowledge base's Tool node set produces or consumes it; GoatTracker 2 writes it with F11 and reads it back, and the relocator (F9 in the editor, or the standalone `gt2reloc`) turns it into a `.prg`, `.bin` or `.sid` (`../art/asset-pipelines.md`, "Music: GoatTracker"). It sits here beside `.SID` because that is the format it is exported to. Every count below comes from the save routine in GoatTracker 2.77's `gsong.c` and the constants in `gcommon.h`; the layout was then checked by parsing the fourteen `.sng` files in the distribution's `examples/` directory with a script written from this table, and each one was consumed to exactly its file length. GoatTracker 2 writes `GTS5` and loads `GTS2` to `GTS5`; only `GTS5` is described here.

All multi-byte fields are byte sequences, not integers: there is no endianness in the file. Every count is one byte, so no list has more than 255 entries.

**Header (101 bytes):**

| Offset | Size | Field |
|--------|------|-------|
| $00–$03 | 4 | Identifier `"GTS5"` |
| $04–$23 | 32 | Song name, zero-padded |
| $24–$43 | 32 | Author name, zero-padded |
| $44–$63 | 32 | Copyright string, zero-padded |
| $64 | 1 | Number of subtunes `s` (1–32) |

**Order lists:** one record per channel, channels 1, 2, 3 of subtune 0, then channels 1, 2, 3 of subtune 1, and so on for `s` subtunes.

| Offset | Size | Field |
|--------|------|-------|
| +0 | 1 | Length `n`: the number of order-list bytes up to and including the `$FF` end mark |
| +1 | n+1 | Order list: `$00–$CF` pattern number, `$D0–$DF` repeat, `$E0–$EF` transpose down, `$F0–$FE` transpose up, `$FF` end mark; the byte after the end mark is the restart position |

**Instruments:** a count byte, then one 25-byte record per instrument from instrument 1 up to the highest one that has a non-zero parameter or is named in a pattern. Instrument 0, the empty instrument, is never stored.

| Offset | Size | Field |
|--------|------|-------|
| +0 | 1 | Attack/decay |
| +1 | 1 | Sustain/release |
| +2 | 1 | Wave table pointer (row + 1; 0 = none) |
| +3 | 1 | Pulse table pointer |
| +4 | 1 | Filter table pointer |
| +5 | 1 | Speed table pointer (vibrato parameter) |
| +6 | 1 | Vibrato delay |
| +7 | 1 | Gate-off timer |
| +8 | 1 | Hard-restart / first-frame waveform |
| +9 | 16 | Instrument name, zero-padded |

**Tables:** four records in this order: wave, pulse, filter, speed. A table's stored length is the index of its last non-zero row plus one, so an empty table is a single zero byte.

| Offset | Size | Field |
|--------|------|-------|
| +0 | 1 | Row count `r` (0–255) |
| +1 | r | Left column, rows 0 to r-1 |
| +1+r | r | Right column, rows 0 to r-1 |

**Patterns:** a count byte `p` (patterns 0 to p-1, where p-1 is the highest pattern that has content or is named in an order list), then one record per pattern.

| Offset | Size | Field |
|--------|------|-------|
| +0 | 1 | Row count `m`, including the end row (up to 129) |
| +1 | m×4 | Rows of four bytes: note, instrument (`$00–$3F`), command (`$00–$0F`), command data |

Note byte values: `$60–$BC` are the notes C-0 to G#7, `$BD` rest, `$BE` key off, `$BF` key on, `$FF` the end row. A 64-row pattern is therefore stored as 65 rows, 260 bytes. The commands are `1` portamento up, `2` portamento down, `3` tone portamento, `4` vibrato, `5` set AD, `6` set SR, `7` set waveform, `8`, `9`, `A` set wave, pulse or filter table pointer, `B` set filter control, `C` set filter cutoff, `D` master volume, `E` funktempo and `F` set tempo, all read from `gcommon.h`.

Decoded from `examples/consultant.sng` (3,060 bytes): bytes 0–7 are `47 54 53 35 54 68 65 20` (`GTS5` then `The `); name `The Consultant`, author `Cadaver`, copyright `2002 Covert Bitops`; one subtune whose three order lists are 78, 17 and 17 bytes long; eight instruments, the first named `BD+Bass` with AD `$09`, SR `$BB`; table lengths 31, 15, 6 and 4 rows; eleven patterns, the longest 73 rows including the end row. Packed by the relocator with defaults, this song becomes 1,786 bytes at `$1000`.

---

### .MD5 — HVSC song-length database

`C64Music/DOCUMENTS/Songlengths.md5` in the High Voltage SID Collection:
how long each subtune of each `.sid` plays, so a player can move on
instead of looping. A player-side file: a C64 program never reads it.
Described from HVSC's `Songlengths.faq` and checked against release 84 on
this machine (`hv_sids.txt`: `Release 84`). HVSC files are research
material here and are never committed.

The file is INI-style text, CRLF line ends, ASCII only (release 84). Line
one is `[Database]`. Then, per tune, a comment line with the file's path
inside HVSC and a `key=value` line:

```text
; /DEMOS/0-9/12th_Sector_Music.sid
c7c299ce06ec5ccffb2261fb11b42a73=4:33.108
```

- **Key**: the MD5 of the whole `.sid` file, header included, as 32
  lower-case hex digits. Measured: for all 60,572 entries the MD5 of the
  file at the comment's path equals the key, and every `.sid` in the
  release has an entry.
- **Value**: one length per subtune, separated by single spaces, in
  subtune order. Measured: the count equals the header's song count
  (offset `$0E`, big-endian) in every entry.
- **Length**: `m:ss[.SSS]`, minutes with no leading zero, seconds two
  digits, then optionally 1 to 3 digits of fraction. Of the 87,074
  lengths in release 84, 70,114 have no fraction and the rest have 1, 2
  or 3 digits (1,194, 1,469, 14,297). `1:02.5` and `1:02.500` are the
  same length, so read the fraction as a decimal fraction of a second,
  not as a count of milliseconds. A length of `0:00` occurs only with a
  fraction (710 values, the shortest `0:00.001`); the FAQ puts the
  minimum at one second when there is no fraction.

The length assumes the clock the tune was made for (PAL or NTSC, from
the header's flags); played at the other rate it is wrong (FAQ).

**The old format** (before HVSC 71, now generated by a script the FAQ
links to) keyed each tune by an MD5 over selected fields rather than the
whole file: the data from the data offset, then the init, play and
song-count fields low byte first, then per speed bit a 0 (VBI) or 60
(CIA) byte, and a 2 if the tune is NTSC-only. Its lengths are `mm:ss`
without fraction, optionally followed by `(G)`, `(M)`, `(Z)` or `(B)`
(gate off, master volume zero, all voices silent, bad memory use or
estimated). None of this was measured here: release 84 ships only the new
file.

### .SSL — HVSC song lengths for players on the C64

The FAQ's third form, generated by an HVSC script into a `SONGLENGTHS`
folder beside each directory of tunes, one `.ssl` per `.sid`: two bytes
per subtune in BCD, minutes then seconds, no fraction, at most 256
subtunes (512 bytes). The FAQ's example for `Commando.sid`, lengths
`3:57 1:02 0:06 …`, is `03 57 01 02 00 06 …`. From the FAQ only; no
`.ssl` file exists on this machine.

### STIL.txt — HVSC SID Tune Information List

`C64Music/DOCUMENTS/STIL.txt`: covers, subtune names, per-subtune
composers and comments for tunes in HVSC. The format below is
`STIL.faq`'s (last updated 2024-06-28), checked by parsing release 84's
file (108,101 lines).

- **Encoding**: not UTF-8. Every non-ASCII byte is a single-byte Western
  character (`ü` is `$FC`), and two bytes are `$9A`, which only
  Windows-1252 maps (to `š`). Decode as Windows-1252. CRLF line ends.
- **Section headers**: lines starting `###`, 78 characters wide in 1,653
  of 1,674. The FAQ tells a parser to skip every line starting `#`.
- **Entry**: a line starting `/` with the path inside HVSC. A path ending
  `/` is a comment on a whole directory (246 such entries); the others
  name a `.sid`. Measured: all 18,721 paths exist in the release.
- **Subtune marker**: `(#n)` alone on a line; the blocks after it belong
  to subtune `n`, in ascending order. A `COMMENT:` before the first
  marker applies to the whole file. No marker in release 84 exceeds the
  file's song count.
- **Fields**: the tag is right-aligned so the colon is always column 8,
  then one space: `   NAME:`, ` AUTHOR:`, `  TITLE:`, ` ARTIST:`,
  `COMMENT:`, in that order within a block. `NAME` is the subtune's
  original name, `AUTHOR` its composer where the file has several,
  `TITLE` and `ARTIST` a covered piece and its original artist.
  A continuation line starts with nine spaces (all 9,660 in release 84).
- **Cover timestamps**: `TITLE: … (0:18)` means the cover starts at
  0:18 and runs to the next timestamp or the tune's loop; `(0:18-0:35)`
  gives both ends. `<?>` marks a doubtful or missing item.

Release 84's tag counts: `TITLE` 19,332, `ARTIST` 19,332, `COMMENT`
9,427, `NAME` 1,753, `AUTHOR` 741; every non-blank line was a header, a
path, a marker, a tagged field or a nine-space continuation.

---

## Graphics Assets

Project files from the two editors most C64 artists hand over: CharPad for character sets, tiles and maps, SpritePad for sprites. Both are the editor's own save format, not a raw export, so a header and per-section framing sit in front of the bytes a program wants. Oscar64's `#embed` reads both directly (`../toolchains/oscar64-reference.md`); every other toolchain in this KB wants the editor's raw binary export, or a converter. `../art/asset-pipelines.md` covers the pipeline side.

Every figure below that is not marked otherwise was decoded in Python from a file on disk and checked against that file's length. The sample set: five CharPad version 8 files from the Corescape source tree (`background.ctm` 1,056 bytes, `introfont.ctm` 2,602, `statusfont.ctm` 2,602, `scorefont.ctm` 2,170, `tiles.ctm` 12,455), one CharPad version 5 file from the Death Weapon source tree (`Background.ctm`, 7,372 bytes), two SpritePad version 5 files (Oscar64's `samples/resources/mouse.spd`, 1,044 bytes; Corescape's `sprites.spd`, 8,284 bytes) and one SpritePad file with no signature at all (Death Weapon's `Sprites.spd`, 6,147 bytes). No version 9 file was found on this machine; the version 9 layout is read from Oscar64's own reader (`oscar64/Preprocessor.cpp`, release 1.32.271) and is marked as such.

### .CTM — CharPad character set, tiles and map

**Consumed by:** oscar64

Oscar64 reads it through `#embed` with the specifiers `ctm_chars`, `ctm_attr1`, `ctm_attr2`, `ctm_tiles8`, `ctm_tiles8sw`, `ctm_tiles16`, `ctm_map8` and `ctm_map16`; what each one yields is under "What Oscar64 emits" below. The file begins with the three ASCII bytes `CTM` and a version byte. Version 5 is the CharPad 2.x save; versions 8 and 9 are the Pro edition's, and they are a different shape: a short fixed header, then a run of sections, each one opened by a two-byte marker, in a fixed order, some of them present only when a header flag or the colouring method says so. A reader that assumes version 5's fixed 20-byte header on a version 8 file lands 2 bytes inside the first character (the character section starts at `$12`: 14 header bytes, a 2-byte marker and a 2-byte count), and 3 bytes short of it on a version 9 file.

**Fixed header:**

| Offset (v5) | Offset (v8) | Offset (v9) | Size | Field |
|-------------|-------------|-------------|------|-------|
| $00–$02 | $00–$02 | $00–$02 | 3 | Signature `CTM` |
| $03 | $03 | $03 | 1 | Version: `$05`, `$08` or `$09` |
| $04 | – | – | 1 | Background colour (v5 sample: `$00`) |
| $05 | – | – | 1 | Multicolour 1 (v5 sample: `$0B`) |
| $06 | – | – | 1 | Multicolour 2 (v5 sample: `$0C`) |
| $07 | – | – | 1 | Character colour (v5 sample: `$0C`) |
| – | $04 | $04 | 1 | Display mode: `0` hires text and `1` multicolour text in the samples; Oscar64 sizes colour cells at 2 bytes for mode `3` and 3 bytes for mode `4`, which fits hires and multicolour bitmap |
| $08 | $05 | $05 | 1 | Colouring method: `0` global, `1` per tile, `2` per character |
| $09 | $06 | $06 | 1 | Flags: bit 0 set means the file carries tiles (v5 sample: `$05`; v8 samples `$00` and `$01`) |
| – | – | $07–$08 | 2 | Grid width, little-endian (v9 only, not measured here) |
| – | – | $09–$0A | 2 | Grid height, little-endian (v9 only, not measured here) |
| – | – | $0B | 1 | Grid configuration (v9 only, not measured here) |
| – | $07–$0D | $0C–$12 | 7 | Seven colour bytes; Oscar64 skips them, and which byte is which is not measured here (the samples hold `0E 00 0F 0C 09 08 07`, `00 00 01 0C 07 08 07`, `09 00 07 0C 09 08 07`) |
| $0A–$0B | – | – | 2 | Character count minus one (v5 sample: `$00FF`, 256 characters) |
| $0C–$0D | – | – | 2 | Tile count minus one (v5 sample: `$007B`, 124 tiles) |
| $0E | – | – | 1 | Tile width in cells (v5 sample: 4) |
| $0F | – | – | 1 | Tile height in cells (v5 sample: 4) |
| $10–$11 | – | – | 2 | Map width in tiles, little-endian (v5 sample: 10) |
| $12–$13 | – | – | 2 | Map height in tiles, little-endian (v5 sample: 54) |
| header ends | $14 | $0E | $13 | | |

Version 5's four colour names at `$04`–`$07` are the CharPad 2 ordering as remembered, not measured here; the counts, the tile size and the map size at `$0A`–`$13` are measured, because the section sizes they imply walk the sample to its last byte (see below). Version 9's header is version 8's with five grid bytes inserted between the flags and the colours; Oscar64 reads it that way and treats the rest of the file identically. A sibling signature `CTT` with version 9 is a Pro tile set whose header carries six colour bytes rather than seven; Oscar64 accepts it, no sample was found, not measured here.

**Version 5 sections** follow the header with no framing, in this order, and the walk over the sample lands exactly on byte 7,372:

| Section | Present when | Size | Sample |
|---------|--------------|------|--------|
| Characters | always | 8 × characters | 2,048 at `$14` |
| Character attributes | always | 1 × characters (colour in the low nybble; the high nybble is 0 throughout the sample) | 256 at `$814` |
| Tiles | flags bit 0 | 2 × tiles × width × height, little-endian character indices | 3,968 at `$914`, largest index 248 |
| Tile colours | flags bit 0 and colouring method `1` | 1 × tiles | absent (method is `2`) |
| Map | always | 2 × width × height, little-endian tile indices | 1,080 at `$1894`, largest index 123 |

**Version 8 and 9 sections.** Each section opens with a two-byte marker. In every sample the marker bytes run `DA B0`, `DA B1`, `DA B2`, … in file order (read as little-endian words, `$B0DA`, `$B1DA`, `$B2DA`), so the second byte numbers the section's position in this particular file, not its kind: `background.ctm` has tiles under `DA B2` and its map under `DA B5`, while `introfont.ctm`, which has no tiles, has its map under `DA B2`. Oscar64 reads each marker and discards it. The order and the conditions, as Oscar64 walks them and as the five samples confirm:

| Order | Section | Present when | Section header | Data |
|-------|---------|--------------|----------------|------|
| 1 | Characters | always | marker, count minus one (2 bytes) | 8 × count |
| 2 | Character materials | always | marker | 1 × count |
| 3 | Character colours | colouring method `2` | marker | 1 × count; 2 × count in display mode `3`; 3 × count in display mode `4` |
| 4 | Tiles | flags bit 0 | marker, count minus one (2), width (1), height (1) | 2 × count × width × height, little-endian character indices |
| 5 | Tile colours | flags bit 0 and colouring method `1` | marker | 1 × tiles; 2 × or 3 × in display modes `3` and `4` |
| 6 | Tile tags | flags bit 0 | marker | 1 × tiles |
| 7 | Tile names | flags bit 0 | marker | one NUL-terminated string per tile |
| 8 | Map | always | marker, width (2), height (2) | 2 × width × height, little-endian indices (tiles when the file has them, characters otherwise) |

Walks over the five samples, each ending on the file's last byte:

- `background.ctm`: display `1`, method `0`, flags `$01`; 40 characters (320 bytes at `$12`), 40 materials, 10 tiles of 2×2 (80 bytes), 10 tags, 10 names in 90 bytes, map 20×12 (480 bytes at `$240`); 1,056.
- `tiles.ctm`: display `1`, method `0`, flags `$01`; 171 characters, 64 tiles of 4×4 (2,048 bytes), 64 names in 576 bytes, map 16×256 (8,192 bytes); 12,455.
- `introfont.ctm` and `statusfont.ctm` (identical): display `0`, method `0`, flags `$00`; 64 characters, no tiles, map 40×25 (2,000 bytes at `$25A`); 2,602.
- `scorefont.ctm`: display `1`, method `0`, flags `$00`; 16 characters, map 40×25; 2,170.

No sample has colouring method `1` or `2`, or display mode `3` or `4`, so rows 3 and 5 and the wider colour cells are Oscar64's reading and not measured here.

**Decoder.** The walker that produced the figures above, for a version 8 or 9 `.ctm` or a version 5 `.spd`. It prints each section's offset, marker and size and must end on the file's last byte; a mismatch means a section it does not know about.

```text
#!/usr/bin/env python3
# Walk a CharPad v8/v9 .ctm or a SpritePad v5 .spd and print each section's
# offset and size; the walk must end on the file's last byte.
# usage: ctm_walk.py FILE
import struct, sys
b = open(sys.argv[1], "rb").read()
u16 = lambda o: struct.unpack_from("<H", b, o)[0]
sig, ver = b[:3], b[3]
if sig == b"CTM" and ver in (8, 9):
    disp, meth, flags = b[4], b[5], b[6]
    p = 14 if ver == 8 else 19
    per = {3: 2, 4: 3}.get(disp, 1)          # colour bytes per cell
    print(f"CTM v{ver} display={disp} method={meth} flags=${flags:02X}")
    def section(name, size, hdr=0):
        global p
        print(f"  ${p:04X} marker ${u16(p):04X} {name}: {size} bytes")
        p += 2 + hdr + size
    n = u16(p + 2) + 1
    section("chars", 8 * n, 2)
    section("materials", n)
    if meth == 2: section("char colours", per * n)
    t = 0
    if flags & 1:
        t, w, h = u16(p + 2) + 1, b[p + 4], b[p + 5]
        section(f"tiles {t} of {w}x{h}", 2 * t * w * h, 4)
        if meth == 1: section("tile colours", per * t)
        section("tile tags", t)
        q = p + 2
        for _ in range(t):
            q = b.index(0, q) + 1
        section("tile names", q - p - 2)
    mw, mh = u16(p + 2), u16(p + 4)
    section(f"map {mw}x{mh}", 2 * mw * mh, 4)
elif sig == b"SPD" and ver == 5:
    ns, nt, w, h = u16(5), u16(7), b[11], b[12]
    print(f"SPD v5 sprites={ns} tiles={nt} colours={list(b[13:16])}")
    p = 20 + 64 * ns + 2 * nt * w * h
    print(f"  sprites at $14, tiles at ${20 + 64 * ns:04X}, tables after ${p:04X}")
else:
    sys.exit(f"not a CTM v8/v9 or SPD v5 file: {sig!r} version {ver}")
print(f"  walk ends at {p}, file is {len(b)}: {'MATCH' if p == len(b) else 'trailing ' + str(len(b) - p)}")
```

On `background.ctm` it prints markers `$B0DA` to `$B5DA` at `$000E`, `$0152`, `$017C`, `$01D2`, `$01DE` and `$023A`, and `walk ends at 1056, file is 1056: MATCH`; on `sprites.spd`, `trailing 72`.

**What Oscar64 emits.** `ctm_chars` is the character section, 8 bytes a character. `ctm_attr1` is one byte a character: the material in the high nybble, and in colouring method `2` the character's colour in the low nybble; in colouring method `1` it is instead one byte a tile, the tile colour, with the materials discarded (read from Oscar64's reader, not measured here: no sample uses method `1`); `ctm_attr2` in display mode `4` packs the second and third colour bytes. `ctm_tiles8` and `ctm_map8` take the low byte of each 16-bit cell; `ctm_tiles16` and `ctm_map16` keep the word (declare the array `unsigned` and add the `word` specifier); `ctm_tiles8sw` swaps the array so the tile index is innermost. Measured on the windowless x64sc build of VICE 3.10 with Oscar64 1.32.271 embedding `background.ctm` and `mouse.spd`, the program printed, and Python read the same bytes from the same offsets: `CHARS 320: 00 00 00 FF 00 00 55 00`, `ATTR1 40: 00 20 10 30 40 60 50 70`, `TILES8 40: 00 01 02 03 04 05 06 07`, `TILES16 80: 0000 0001 0002 0003`, `MAP8 240: 06 06 06 06 06 06 06 06`, `SPRITES 1024: 00 00 00 F0 00 00 FC 00`. The exit screenshot is `../figures/ctm-spd-embed-probe.png`, identical bytes on two runs. No recipe page pins it: the verifier compiles a listing alone in a fresh directory, and an `#embed` needs the asset beside the source.

Oscar64's documentation names version 8; its reader also takes version 9, and it checks neither the signature nor any other version. Embedding the version 5 sample with `ctm_chars` compiled without a warning and gave an array of 7,364 bytes: the reader took bytes `$04`–`$05` (`$0B00`) as the first marker, `$06`–`$07` plus one (3,085) as the character count, asked for 24,680 bytes and was handed the rest of the file, header, attributes, tiles and map together. Check the version byte before embedding.

---

### .SPD — SpritePad sprite set

**Consumed by:** oscar64

Oscar64 reads it through `#embed` with the specifiers `spd_sprites` and `spd_tiles`. The file begins with the three ASCII bytes `SPD` and a version byte, then a header whose length depends on the version, then the sprites as 64-byte blocks: 63 bytes of pixel data and one attribute byte. Oscar64's reader accepts versions 1, 3 and 5 and refuses a file without the signature.

**Header:**

| Offset (v1) | Offset (v5) | Size | Field |
|-------------|-------------|------|-------|
| $00–$02 | $00–$02 | 3 | Signature `SPD` |
| $03 | $03 | 1 | Version |
| – | $04 | 1 | Flags (samples: `$00`, `$02`; meaning not measured here) |
| $04 | – | 1 | Sprite count minus one (v1, not measured here) |
| $05 | – | 1 | Animation count minus one (v1, not measured here) |
| – | $05–$06 | 2 | Sprite count, little-endian, not minus one (samples: 16, 128) |
| – | $07–$08 | 2 | Tile count, little-endian (samples: 0, 0) |
| – | $09 | 1 | Sprite animation count (samples: 0, 11) |
| – | $0A | 1 | Tile animation count |
| – | $0B | 1 | Tile width in sprites |
| – | $0C | 1 | Tile height in sprites |
| $06–$08 | $0D–$0F | 3 | Transparent (background) colour, multicolour 1, multicolour 2 (v5 samples: `09 00 01`, `0E 00 01`; v1: Oscar64's reader, not measured here) |
| – | $10–$11 | 2 | Sprite overlay distance, signed little-endian (samples: 1) |
| – | $12–$13 | 2 | Tile overlay distance, signed little-endian (samples: 1) |
| header ends | $09 | $14 | | |

Version 3 is version 5 without the two overlay distances, a 16-byte header, from Oscar64's reader and not measured here. After the header come `64 × sprites` bytes, then `2 × tiles × width × height` bytes of little-endian sprite indices, then animation tables that this page does not decode: `mouse.spd` ends exactly after its 16 sprites (`$14` + 1,024 = 1,044), and `sprites.spd` has 72 bytes after its 128 sprites, which its 11 sprite animations account for in some layout not measured here.

The attribute byte at offset 63 of each block carries the sprite colour in bits 0–3, an overlay flag in bit 4 and the multicolour flag in bit 7 (Oscar64's reader comment; not measured here beyond the values seen: `$85` for 14 of the 16 mouse sprites, `$85`, `$87`, `$88` and `$8B` across the 128 game sprites, so bit 7 set and colours 5, 7, 8 and 11).

**A file with no signature.** The third sample starts `00 0B 01` and is 6,147 bytes: three bytes then 96 × 64. That is consistent with the older SpritePad's headerless save (three colour bytes, then the blocks), and the three values `00 0B 01` read as plausible colours; the producer is not established here, since nothing in the file names it. Such a file is distinguishable from the signed form only by the missing `SPD`. Oscar64 refuses it with "SPD file format not recognized"; a converter that keys on length can take it as `(size − 3) / 64` sprites.

---

### .KLA — Koala Painter multicolour bitmap image

Koala Painter's picture file, the usual interchange format for C64
multicolour bitmaps. It is the three regions multicolour bitmap mode reads,
in the order the VIC-II uses them, after a two-byte load address: 10,003
bytes in all.

| Offset | Size | Content |
|--------|------|---------|
| $0000 | 2 | Load address, little-endian (Koala Painter uses `$6000`) |
| $0002 | 8000 | Bitmap |
| $1F42 | 1000 | Screen RAM: the two colours of each cell, one per nibble |
| $232A | 1000 | Colour RAM: the third colour of each cell, low nibble |
| $2712 | 1 | Background colour for `$D021`, low nibble |

The layout is `koala_format`'s in `techniques/bitmap-modes.md`, and
`toolchains/png2prg.md` reports the same layout, 10,003 bytes loading at
`$2000`, for `png2prg -m koala` output it converted on this machine. No file
saved by Koala Painter itself was read here. The `koala_format` technique
displays it (`**Consumes formats:** KLA`);
`recipes/oscar64/bitmap-koala-viewer.md` reads the regions at offsets 2,
8002, 9002 and 10002. No Tool node in this knowledge base writes or reads
a `.KLA` as such.

---

### Four older paint formats: how they were checked

Art Studio, Advanced Art Studio, Doodle and Amica Paint files below were
read from 47 real files: the C64 samples of the dexvert collection
(`https://sembiance.com/fileFormatSamples/image/`, directories
`artStudio`, `advancedArtStudio`, `doodleC64`, `ami`; fetched 2026-09-24,
not committed here). Each file was decoded in Python to bitmap, screen
RAM, colour RAM and background; a KickAssembler viewer showed the decoded
bytes in VICE x64sc 3.10 (PAL, `-default`); the exit screenshot's 320x200
display window matched a Python render of the same bytes in every pixel
of all 47 files, and the decoded pictures are recognisable title screens,
not noise. The layouts agree with RECOIL's decoders (`recoil.fu`,
SourceForge commit `b1329c9`), and for Art Studio with the BSD-licensed
`c64img` 3.5 writer. What the paint programs themselves write was not run
here: nothing below comes from saving a picture in the original program.

The file extension does not tell the formats apart. In the samples,
`.ART`, `.AAS` and `.OCP` names appear on both the 9,009-byte hires format
and the 10,018-byte multicolour one (`TETRISREC.OCP` is hires, `BLADE.ART`
and `sanxion.aas` are multicolour). Decide by length.

### .ART — Art Studio hires bitmap image

OCP Art Studio's hires picture; `.AAS` and `.HPI` are the same format.
Load address `$2000`; 9,009 bytes in six samples, 9,002 in one.

| Offset | C64 address | Size | Content |
|--------|-------------|------|---------|
| $0000 | — | 2 | Load address `$2000` |
| $0002 | $2000 | 8000 | Bitmap |
| $1F42 | $3F40 | 1000 | Screen RAM: pixel-1 colour high nibble, pixel-0 colour low nibble |
| $232A | $4328 | 1 | Border colour, low nibble (9,009-byte files only) |
| $232B | $4329 | 6 | Not picture data |

The border byte was `$F0` or `$F6` where it was not zero: the high nibble
is set, as a VIC colour register reads back, so mask it. Two of the seven
files carry non-zero bytes in the last six (`00 22 00 00 00 22`,
`52 51 28 C7 00 00`); their meaning is not established here, and
`c64img` writes them as zero. A 9,002-byte file is the same without the
border and tail. There is no colour RAM: hires bitmap mode does not read it.

### .OCP — Advanced Art Studio multicolour bitmap image

OCP Advanced Art Studio's multicolour picture; `.MPIC` (the samples'
`… mpic` names) and `.ART`/`.AAS` are used too. 10,018 bytes in all 22
samples, load address `$2000`.

| Offset | C64 address | Size | Content |
|--------|-------------|------|---------|
| $0000 | — | 2 | Load address `$2000` |
| $0002 | $2000 | 8000 | Bitmap |
| $1F42 | $3F40 | 1000 | Screen RAM: bit pair 01 high nibble, 10 low nibble |
| $232A | $4328 | 1 | Border colour, low nibble |
| $232B | $4329 | 1 | Background colour for `$D021` (bit pair 00), low nibble |
| $232C | $432A | 14 | Not picture data |
| $233A | $4338 | 1000 | Colour RAM: bit pair 11, low nibble |

Mask every colour byte to its low nibble. In 11 of the 22 files at least
108 of the 1,000 colour-RAM bytes have the high nibble set (colour RAM is
four bits wide and reads back junk above them), and in ten files the
border byte reads `$F0`, `$F1`, `$FB` or `$FE` and the background `$F0`. A
converter that copies these bytes
unmasked into a `$D021` compare, or into a PNG palette index, goes wrong.
The 14 bytes between background and colour RAM held zero, `$FF`/`$00`
patterns, a repeated byte, or what look like leftover memory; they are not
picture data. Codebase64's list
(`https://codebase64.net/doku.php?id=base:c64_grafix_files_specs_list_v0.03`)
gives the same addresses.

### .DD — Doodle hires bitmap image

OMNI's Doodle. The screen RAM comes first, then the bitmap: the reverse
of Art Studio.

| Offset | C64 address | Size | Content |
|--------|-------------|------|---------|
| $0000 | — | 2 | Load address, `$5C00` in 7 of 10 samples |
| $0002 | $5C00 | 1000 | Screen RAM: pixel-1 colour high nibble, pixel-0 colour low nibble |
| $03EA | $5FE8 | 24 | Unused (the rest of the 1 KB screen block) |
| $0402 | $6000 | 8000 | Bitmap |
| $2342 | $7F40 | 192 | Unused (the rest of the 8 KB bitmap block); absent in 9,026-byte files |

Six samples are 9,218 bytes (screen block 1,024, bitmap block 8,192) and
four are 9,026 (bitmap 8,000, no tail); both decode from the same offsets.
Of the 9,218-byte files, one loads at `$1C00` and two carry `$0000` as the
load address; offset, not load address, locates the data. The 24 unused
screen bytes were zero in nine files and not in one. KickAssembler's
`BF_DOODLE` agrees: `.print BF_DOODLE` on 5.25 gives
`ColorRam=$0000,Bitmap=$0400` (its block name for the screen data is
`ColorRam`). Codebase64's list places the bitmap at `$7000`; every sample,
RECOIL and KickAssembler put it at `$6000`, and a `$7000` start would run
past the end of a 9,218-byte file.

**Consumed by:** kickassembler

### .JJ — Doodle image, run-length packed

A Doodle file packed with a one-byte escape. Load address `$5C00` in both
samples (6,608 and 1,659 bytes). Byte by byte after the load address:

- `$FE value count`: `count` copies of `value`. Counts 1 to 255 were seen;
  a count of 0 never appeared.
- any other byte: itself. A literal `$FE` is `$FE $FE $01`.

Unpack until 9,024 bytes are out: the 1,024-byte screen block, then the
8,000-byte bitmap, at the `.DD` offsets less two. One sample ends exactly
there; the other has 71 more bytes after the 9,024th, which a decoder
must ignore. Koala Painter's `.GG` uses the same scheme (Codebase64's
list; not measured here).

### .AMI — Amica Paint multicolour bitmap image, run-length packed

Amica Paint's picture: Koala's order packed with a different escape.
Load address `$4000` in all 13 samples (Codebase64's list says Amica
loads at `$4400`; no sample does). After the load address:

- `$C2 count value`: `count` copies of `value`. Note the order, count
  first, the reverse of Doodle's `$FE value count`.
- `$C2 $00`: end of data. It is the last two bytes of every sample.
- any other byte: itself. A literal `$C2` is `$C2 $01 $C2` (all 33 runs
  of length 1 in the samples are that).

Unpacked, the first 10,001 bytes are Koala's layout without its load
address: bitmap 8,000, screen RAM 1,000, colour RAM 1,000, background 1
(offsets `$0000`, `$1F40`, `$2328`, `$2710`). One sample unpacks to
exactly 10,001 bytes; the other twelve to 10,257, with 256 more bytes
after the background. Those 256 bytes are not picture data (in one file
they hold groups of four colour indices such as `0A 02 06 07` among `$FF`);
their role in Amica Paint is not established here. Runs of 3 are the
shortest used for a repeated value other than `$C2` (2,211 of them in the
samples), so a packer that emits a run from length 3 up reproduces the
files' style; a decoder does not care.

---

## Memory Snapshots

### .VSF — VICE snapshot

**Produced by:** vice
**Consumed by:** vice

A snapshot is VICE's own dump of the whole emulated machine: the 64 KiB of RAM, the CPU registers, and the state of every emulated chip, drive and port, one module each. VICE reads it back with `undump` or `-autostart` (see `../runtime/vice-reference.md`, Snapshots). ROM images are not stored; the file assumes the ROMs the emulator has loaded. The module layouts are per VICE version, so every offset below is what one file written by one build contained; a different version has to be decoded again with the script at the end of this section.

**Correction (2026-09-23).** This section used to describe a 15-byte module header with a 10-character name, and to list modules called `MEM`, `VICII` and `IEC`. None of that matched a file written by x64sc 3.10: the module header is 22 bytes with a 16-byte name, the memory module is `C64MEM`, the video module is `VIC-II`, and no `IEC` module was present. The tables below replace it, decoded from a file written and read for this page.

**Measured on:** the windowless x64sc 3.10 (`-default`, PAL), a 193,261-byte file written from the remote text monitor after a program had put known bytes in RAM and colour RAM. An NTSC run (`-model ntsc`, 179,053 bytes) gave the same header, the same module names and versions in the same order, and the same offsets inside `C64MEM` and `VIC-II`; only the `VIC-II` module's length differed, which moves every module after it.

**File header (58 bytes):**

| Offset | Size | Field | Value in this file |
|--------|------|-------|--------------------|
| $0000 | 19 | Magic string `VICE Snapshot File` followed by `$1A` | as named |
| $0013 | 1 | Snapshot format major version | 2 |
| $0014 | 1 | Snapshot format minor version | 0 |
| $0015 | 16 | Machine name, zero-padded | `C64SC` |
| $0025 | 13 | Version tag `VICE Version` followed by `$1A` | as named |
| $0032 | 4 | VICE version, one byte per component | 3, 10, 0, 0 |
| $0036 | 4 | Revision, little-endian | 0 |

**Module header (22 bytes, one per module):**

| Offset | Size | Field |
|--------|------|-------|
| +0 | 16 | Module name, zero-padded |
| +16 | 1 | Module major version |
| +17 | 1 | Module minor version |
| +18 | 4 | Module length, little-endian, counting this 22-byte header |

The length counts the header: adding each module's length to its own offset lands on the next module's name, and the last module ends at byte 193,261, the file's length.

**Modules in this file, in order (PAL run):**

| File offset | Name | Version | Length |
|-------------|------|---------|--------|
| 58 | `MAINCPU` | 1.4 | 125 |
| 183 | `C64MEM` | 0.1 | 65,577 |
| 65,760 | `C64CART` | 0.1 | 23 |
| 65,783 | `CIA1` | 2.5 | 99 |
| 65,882 | `CIA2` | 2.5 | 99 |
| 65,981 | `SID` | 1.5 | 58 |
| 66,039 | `SIDEXTENDED` | 1.4 | 155 |
| 66,194 | `DRIVE8` | 2.0 | 167 |
| 66,361 | `DRIVE9` | 2.0 | 167 |
| 66,528 | `DRIVE10` | 2.0 | 167 |
| 66,695 | `DRIVE11` | 2.0 | 167 |
| 66,862 | `DRIVECPU0` | 1.3 | 2,174 |
| 69,036 | `1541VIA1D0` | 2.2 | 50 |
| 69,086 | `VIA2D0` | 2.2 | 50 |
| 69,136 | `FSDRIVE` | 0.0 | 280 |
| 69,416 | `VIC-II` | 1.3 | 123,437 (NTSC: 109,229) |
| 192,853 | `GLUE` | 1.0 | 25 |
| 192,878 | `C64MEMHACKS` | 0.0 | 23 |
| 192,901 | `TAPEPORT` | 1.0 | 24 |
| 192,925 | `DATASETTE` | 1.5 | 100 |
| 193,025 | `KEYBOARD` | 1.1 | 118 |
| 193,143 | `JOYPORT0` | 0.0 | 23 |
| 193,166 | `JOYSTICK0` | 1.2 | 24 |
| 193,190 | `JOYPORT1` | 0.0 | 23 |
| 193,213 | `JOYSTICK1` | 1.2 | 24 |
| 193,237 | `USERPORT` | 1.0 | 24 |

No drive was attached in these runs, so the `DRIVE8` to `DRIVE11` modules are the 167-byte form and there is one `DRIVECPU0`; what a run with a true-drive 1541 attached adds was not measured here.

**`C64MEM` body (65,555 bytes after the header):**

| Body offset | Size | Field | Confirmed by |
|-------------|------|-------|--------------|
| +0 | 1 | Processor port data register (`$01`) | `$37`, the monitor's `01` column at the stop |
| +1 | 1 | Processor port direction register (`$00`) | `$2F`, the monitor's `00` column |
| +2 | 2 | Two bytes, both `$00` here | not decoded |
| +4 | 65,536 | RAM, `$0000` to `$FFFF` in address order | the 256 bytes `i XOR $A5` the program wrote at `$C000` sit at body offset 49,156, which is 4 + `$C000`; the BASIC stub is at 4 + `$0801` |
| +65,540 | 15 | Trailing bytes | not decoded |

RAM address `A` is therefore file byte 209 + `A` in this file (183 + 22 + 4). RAM bytes `$0000` and `$0001` read `$00 $00`: the port lives in the four bytes ahead of RAM, and reading it out of the RAM image gives the wrong answer.

**`VIC-II` body (123,415 bytes PAL, 109,207 NTSC):**

| Body offset | Size | Field | Confirmed by |
|-------------|------|-------|--------------|
| +0 | 1 | One byte: `$01` on the PAL run, `$03` on the NTSC run | meaning not established |
| +1 | 64 | Register block, `$D000` to `$D03F`, holding the values last written | `$D020` at +33 read `$00` after the program wrote 0 to the border (power-on value `$0E`); `$D021` at +34 read `$06`; `$D018` at +25 read `$14` and `$D016` at +23 read `$08`, the written values, where a CPU read returns `$15` and `$C8` |
| +65 | 696 | Internal state | not decoded |
| +761 | 1,024 | Colour RAM, `$D800` to `$DBFF`, one byte per cell, low nybble | the 256 bytes `i AND $0F` the program wrote at `$D800` sit at +761; the cells from `$D900` to `$DBE7` read `$0E`, the KERNAL's text colour after the clear; the 24 cells past the screen's 1,000, `$DBE8` to `$DBFF`, are not touched by the clear and hold other values |
| +1,785 | rest | Internal state; 14,208 bytes longer on PAL than on NTSC | not decoded |

**`MAINCPU` body (103 bytes):**

| Body offset | Size | Field | Confirmed by |
|-------------|------|-------|--------------|
| +0 | 8 | CPU clock, little-endian | 3,022,363, the monitor's `STOPWATCH` at the stop |
| +8 | 1 | A | `$00` |
| +9 | 1 | X | `$00` |
| +10 | 1 | Y | `$00` |
| +11 | 1 | SP | `$F6`, the monitor's `SP` |
| +12 | 2 | PC, little-endian | `$0835`, the address the break was set on |
| +14 | 1 | Status register | `$22`, the monitor's `..-...Z.` |
| +15 | 88 | Rest of the module | not decoded |

**How the file was made.** This program clears the screen, prints a title, fills `$C000` to `$C0FF` with `i XOR $A5`, fills the first 256 colour cells with `i AND $0F`, sets the border to black and parks in a loop at `done` (`$0835`):

```kickass
* = $0801
.byte $0b, $08, $0a, $00, $9e, $32, $30, $36, $31, $00, $00, $00   // 10 SYS2061

* = $080d
start:
    lda #$93            // clear screen
    jsr $ffd2
    ldx #$00
print:
    lda msg,x
    beq fill
    jsr $ffd2
    inx
    bne print
fill:
    ldx #$00
loop:
    txa
    eor #$a5
    sta $c000,x
    txa
    and #$0f
    sta $d800,x
    inx
    bne loop
    lda #$00
    sta $d020
done:
    jmp done

msg:
    .text "VSF PATTERN SET"
    .byte $00
```

A `-moncommands` file runs before the program does, so it cannot dump at once. It can arm a checkpoint whose attached command dumps when the program reaches a known store (`trace store d020` then `command 1 "dump \"file.vsf\""`; one process, and the last dump wins, so the KERNAL's own border write dumps first and the program's `STA $D020` overwrites it), or a remote-monitor client can stop the machine and dump. The second route is the one used below. `-initbreak 2101` is `$0835` in decimal. A Python socket polled the port from the moment x64sc was launched (it connected at 0.03 s and the stop arrived at 0.17 s), then sent the commands shown:

```text
timeout 180 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 8000000 -remotemonitor -remotemonitoraddress ip4://127.0.0.1:6577 \
  -initbreak 2101 -exitscreenshot vsf-pattern.png -autostart vsf-pattern.prg
```

```text
#1 (Stop on  exec 0835)  238/$0ee,   1/$01
.C:0835  4C 35 08    JMP $0835      - A:00 X:00 Y:00 SP:f6 ..-...Z.    3022363
(C:$0835) r
  ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH
.;0835 00 00 00 f6 2f 37 00100010 238 001    3022363
(C:$0835) m c000 c00f
>C:c000  a5 a4 a7 a6  a1 a0 a3 a2  ad ac af ae  a9 a8 ab aa   ..... ..........
(C:$c010) m d800 d80f
>C:d800  00 01 02 03  04 05 06 07  08 09 0a 0b  0c 0d 0e 0f   @abcdefghijklmno
(C:$d810) dump "vsf-pattern.vsf"
(C:$d810) del 1
(C:$d810) x
```

`dump` prints nothing on success; the file appeared at once. Deleting the checkpoint before `x` matters: a break on a `JMP` to itself fires again on every iteration. The decoder that produced the tables above, run on the host against that file:

```text
import struct, sys
d = open(sys.argv[1], "rb").read()
print(d[0:19], d[19], d[20], d[21:37].rstrip(b"\0"), d[37:50], list(d[50:54]), struct.unpack_from("<I", d, 54)[0])
pos, mods = 58, {}
while pos < len(d):
    name = d[pos:pos + 16].rstrip(b"\0").decode()
    size = struct.unpack_from("<I", d, pos + 18)[0]
    print(f"{pos:7d} {name:<12} {d[pos + 16]}.{d[pos + 17]:<2} {size:7d}")
    mods[name] = d[pos + 22:pos + size]
    pos += size
mem, vic = mods["C64MEM"], mods["VIC-II"]
ram = mem.find(bytes(i ^ 0xA5 for i in range(256))) - 0xC000
print("port bytes", mem[:ram].hex(" "), "| RAM at body+%d, trailing %d" % (ram, len(mem) - ram - 65536))
col = vic.find(bytes(i & 0x0F for i in range(256)))
print("colour RAM at body+%d; $D020 at body+%d = %02x" % (col, 1 + 0x20, vic[1 + 0x20]))
```

Its last two lines for the PAL file were `port bytes 37 2f 00 00 | RAM at body+4, trailing 15` and `colour RAM at body+761; $D020 at body+33 = 00`.

**What a snapshot is good for in a headless pipeline.** First, a state to diff: after a run, the RAM image at file byte 209 is the whole address space in order, so a test can compare the bytes a program owns against an expected image, or two runs against each other, without printing anything to the screen. Do not expect two snapshots of the same program to be byte-identical: the PAL run above, repeated, gave a file that differed in 946 bytes, 943 of them single bytes scattered through RAM at addresses the program never wrote (the emulated power-on contents) and 3 in the CIA modules, while the CPU clock was the same 3,022,363 in both. Diff the regions the program wrote, the register block and colour RAM, not the whole file. Second, a save point: a long run can be stopped once at a known address, dumped, and every later test can start from that file with `undump "file.vsf"` in a `-moncommands` file, or by passing it to `-autostart`, which skips the boot and the load each time. The VICE reference's Snapshots section has the restore side.

VSF is a VICE internal format. It is not suitable for interchange between emulators and has no use in the toolchain build pipeline.

---

## Build Artifacts

### .MAP — Linker map file

**Produced by:** oscar64, cc65
**Consumed by:** vice

A linker map file records the final address assignments for every symbol, segment, and object file resolved during linking. Oscar64 emits `.map` alongside its primary output. cc65's `ld65` linker emits a map file when invoked with `-m`. KickAssembler has no map file; `-symbolfile` writes a `.sym` of `.label` lines and `-vicesymbols` a `.vs` (see `.VS` below). KickAssembler 5.25 takes single-dash options: given `-symboldump` or `--symboldump` it prints `Already have an inputfile. Won't use '--symboldump'` and ignores it. (An earlier version named a `--symboldump` flag.)

Map files are consumed by VICE's monitor for symbol-name display during debugging: the monitor's `ll` command (load labels) accepts Oscar64's `.lbl` format; `.map` files require conversion or manual parsing.

Format is tool-specific text: Oscar64's `.map` has `sections`, `regions`, `objects` and `objects by size` blocks with lines such as `0880 - 0887 : main, NATIVE_CODE:code` (Oscar64 run here). (An earlier version said one `symbol = $ADDR` line per symbol; the file has none.) cc65 `ld65` emits a structured text report with segment summary, module summary, and symbol table sections.

---

### .LBL — VICE symbol file (Oscar64 native output)

**Produced by:** oscar64
**Consumed by:** vice

Oscar64 natively emits `.lbl` files containing symbol-to-address mappings in VICE monitor label format. Each line is:

```
al HHHH .SYMBOLNAME
```

where `HHHH` is the 4-digit hex address and `SYMBOLNAME` is the C or assembly label. The leading `al` prefix is the VICE monitor `add_label` command mnemonic.

VICE loads `.lbl` files via `ll <filename>` in its built-in monitor, enabling symbolic display of disassembly, breakpoints by name (`break .main`; labels keep their leading dot, and x64sc 3.10's monitor rejects `break main` with "Unexpected token"), and watch expressions. This link between Oscar64 and VICE is a main reason Oscar64 is the preferred toolchain in this KB.

---

### .VS — KickAssembler/VICE symbol file

**Produced by:** kickassembler
**Consumed by:** vice

KickAssembler emits a VICE symbol file (conventionally `.vs` or `-symbols.txt`) when invoked with the `-vicesymbols` flag (written `--vicesymbols` in an earlier version, which KickAssembler 5.25 ignores with a warning). A label comes out as `al C:c000 .main`; x64sc 3.10's `ll` loads it and Oscar64's `.lbl` alike (both run here). Format matches the VICE `al` label format used by `.LBL` files. The file is loaded into VICE the same way (`ll <filename>`) and gives the same symbolic debugging as Oscar64's `.lbl` output.

---

### .ASM — Generated assembly listing

**Produced by:** oscar64
**Consumed by:** kickassembler, cc65

Oscar64 can emit an assembly listing (`.asm`) showing the 6502 instructions generated for each C source statement. This intermediate representation is useful for cycle-counting and verifying that the compiler has produced efficient code for hot paths (raster handlers, sprite sorters, etc.).

The listing format is not a formal standard; it is Oscar64-specific human-readable text with C source lines interleaved with the generated opcodes and addresses. It is not directly assembled by KickAssembler or cc65. The "Consumed by" relationship above means hot inner loops are extracted by hand and hand-optimized in an assembler.

---

### .S — cc65/ca65 assembly source

**Produced by:** cc65
**Consumed by:** cc65

The `.s` extension is the standard assembly source file for ca65 (the assembler component of the cc65 suite). cc65 (the C compiler) emits `.s` files as its intermediate representation before invoking ca65. The ca65 assembler then compiles `.s` to `.o` object files.

Oscar64 does not write `.s` files: with default options it writes `.prg`, `.asm`, `.int`, `.lbl` and `.map`, its option list has no assembly-source output, and its `Compiler.cpp` names no `.s` extension (all checked here). (An earlier version said it could emit `.s` compatible output.) The `.s` extension is also used generically for 6502 assembly in other contexts (e.g., manual assembly sources targeting ca65 directly).

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

The P00 format (from the PC64 emulator by Wolfgang Lorenz) wraps a single C64 PRG file in a 26-byte header that preserves the original PETASCII filename and file type, information that is lost when storing a C64 file on a host filesystem that does not support PETASCII or Commodore file-type metadata.

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
- `../hardware/c64-memory-map.md` — C64 memory map (tape buffer at `$033C`, disk buffer at `$0200`)
- `../art/asset-pipelines.md` — getting CharPad and SpritePad output into a build
