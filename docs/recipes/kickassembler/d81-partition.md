---
recipe: d81-partition
toolchain: kickassembler
output_format: PRG
region: both
techniques: [d81_partition_subdirectory]
file_formats: [PRG, D81]
uses_registers: []
uses_kernal: [SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CHKIN, CHRIN, CLRCHN, CLOSE, READST]
devices: [disk_1581]
harness: [$02FF]
---

<!-- doc-type: recipe -->

# KickAssembler 1581 Partition as a Sub-directory

## Synopsis

Against a freshly formatted D81 in a 1581 as drive 8: allocate a
120-block partition from track 20 sector 0 with the `/0:` command, select
it, format it as a sub-directory with `N0:`, write a 16-byte SEQ file
inside it and read it back, return to the root with `/`, and try the
same file from the root. Every command's status line is printed. The
program refuses to send `N0:` unless the select answered `02`, because
after any other answer `N0:` formats the whole disk (measured below;
`pitfalls/kernal-and-io.md`, `n0_after_failed_partition_select_formats_disk`).
The verdict at `$02FF` is `01` and the border turns green when all 16
bytes matched inside the partition and none were found from the root.
The technique is `d81_partition_subdirectory` on
`../../techniques/file-io.md`; the on-disk layout is under ".D81 — 1581
disk image" in `../../formats/c64-file-formats.md`.

## Source

```asm
// d81-partition.asm
// On a 1581 in drive 8: allocate a 120-block CBM partition from track 20
// sector 0 with "/0:", select it, format it as a sub-directory with N0:,
// write and read back a SEQ file inside it, return to the root with "/",
// and show that the file is not visible from the root.
BasicUpstart2(start)

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const OPEN   = $ffc0
.const CLOSE  = $ffc3
.const CHKIN  = $ffc6
.const CHKOUT = $ffc9
.const CLRCHN = $ffcc
.const CHRIN  = $ffcf
.const CHROUT = $ffd2
.const READST = $ffb7

.const VERDICT = $02ff
.const PTRACK  = 20          // first track of the partition
.const PBLOCKS = 120         // three whole tracks of 40 sectors

.encoding "petscii_upper"

start:
    lda #$93
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    lda #15                   // command channel, opened bare
    ldx #8
    ldy #15
    jsr SETLFS
    lda #0
    jsr SETNAM
    jsr OPEN
    bcc go
    jmp no_drive
go:
    ldx #<cmd_make
    ldy #>cmd_make
    lda #cmd_make_end-cmd_make
    jsr command
    ldx #<cmd_sel
    ldy #>cmd_sel
    lda #cmd_sel_end-cmd_sel
    jsr command
    lda code                  // "02" is the only answer that selected it:
    cmp #'0'                  // after anything else N0: would format the
    bne refuse                // whole disk, not the partition
    lda code+1
    cmp #'2'
    bne refuse
    ldx #<cmd_new             // format it as a sub-directory
    ldy #>cmd_new
    lda #cmd_new_end-cmd_new
    jsr command

    jsr write_file            // write HELLO inside the partition
    jsr read_file             // and read it back
    lda match
    sta match_in
    ldx #<cmd_root            // leave with "/"
    ldy #>cmd_root
    lda #cmd_root_end-cmd_root
    jsr command
    jsr read_file             // from the root: the file is not there

    lda #15
    jsr CLOSE
    lda match_in              // 16 inside the partition
    cmp #16
    bne done
    lda match                 // and none from the root
    bne done
    lda #1
    sta VERDICT
    lda #5
    sta $d020
done:
    ldx #<lbl_done
    ldy #>lbl_done
    jsr print_z
    rts

refuse:
    ldx #<lbl_refuse
    ldy #>lbl_refuse
    jsr print_z
    lda #15
    jsr CLOSE
    jmp done

no_drive:
    ldx #<lbl_nodrive
    ldy #>lbl_nodrive
    jsr print_z
    rts

// --- send A bytes at X/Y to channel 15, then print the status line -------
command:
    sta clen
    stx cp+1
    sty cp+2
    ldx #15
    jsr CHKOUT
    ldy #0
cp: lda $ffff,y
    jsr CHROUT
    iny
    cpy clen
    bne cp
    jsr CLRCHN
    // fall through
status:
    ldx #15
    jsr CHKIN
    ldy #0
st_loop:
    jsr CHRIN
    cpy #2
    bcs st_show
    sta code,y                // keep the two digits of the error number
    iny
st_show:
    jsr CHROUT
    jsr READST
    beq st_loop
    jmp CLRCHN

// --- write sixteen bytes to HELLO,S,W on channel 2 -----------------------
write_file:
    lda #fn_w_end-fn_w
    ldx #<fn_w
    ldy #>fn_w
    jsr SETNAM
    lda #2
    ldx #8
    ldy #2
    jsr SETLFS
    jsr OPEN
    ldx #2
    jsr CHKOUT
    ldy #0
wf: lda payload,y
    jsr CHROUT
    iny
    cpy #16
    bne wf
    jsr CLRCHN
    lda #2
    jsr CLOSE
    jmp status

// --- read HELLO,S,R and count the bytes that match -----------------------
read_file:
    lda #0
    sta match
    lda #fn_r_end-fn_r
    ldx #<fn_r
    ldy #>fn_r
    jsr SETNAM
    lda #2
    ldx #8
    ldy #2
    jsr SETLFS
    jsr OPEN
    ldx #2
    jsr CHKIN
    ldy #0
rf: jsr CHRIN
    cmp payload,y
    bne rf_next
    inc match
rf_next:
    jsr READST
    bne rf_end
    iny
    cpy #16
    bne rf
rf_end:
    jsr CLRCHN
    lda #2
    jsr CLOSE
    lda #<lbl_match
    ldx #>lbl_match
    jsr print_zax
    lda match
    jsr print_hex
    lda #' '
    jsr CHROUT
    jmp status

print_hex:
    pha
    lsr
    lsr
    lsr
    lsr
    jsr ph_digit
    pla
    and #15
ph_digit:
    cmp #10
    bcc ph_num
    adc #6
ph_num:
    adc #'0'
    jmp CHROUT

print_zax:
    sta pz+1
    stx pz+2
    jmp pz
print_z:
    stx pz+1
    sty pz+2
pz: lda $ffff
    beq pz_done
    jsr CHROUT
    inc pz+1
    bne pz
    inc pz+2
    bne pz
pz_done:
    rts

cmd_make: .text "/0:PART1,"
          .byte PTRACK, 0, <PBLOCKS, >PBLOCKS
          .text ",C"
cmd_make_end:
cmd_sel:  .text "/0:PART1"
cmd_sel_end:
cmd_new:  .text "N0:SUB,S1"
cmd_new_end:
cmd_root: .text "/"
cmd_root_end:
fn_w:     .text "HELLO,S,W"
fn_w_end:
fn_r:     .text "HELLO,S,R"
fn_r_end:
payload:  .text "INSIDE PARTITION"

title:      .text "1581 PARTITION"
            .byte $0d, 0
lbl_match:  .text "MATCH="
            .byte 0
lbl_done:   .text "DONE"
            .byte $0d, 0
lbl_refuse: .text "NOT SELECTED: NO N0"
            .byte $0d, 0
lbl_nodrive: .text "NO DRIVE"
            .byte $0d, 0

clen:   .byte 0
match:  .byte 0
match_in: .byte 0
code:   .byte 0, 0
```

## Build

```bash
java -jar $KICKASS_JAR d81-partition.asm -o d81-partition.prg
c1541 -format "PARTS,81" d81 parts.d81
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 30000000 \
  -8 parts.d81 -drive8type 1581 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -exitscreenshot d81-partition.png -autostart d81-partition.prg
```

Add `-model ntsc` for the NTSC run. The pinned run in `runs.json` is
`"disk": {"name": "PARTS,81", "type": "d81"}`: the verifier formats the
D81 and adds `-drive8type 1581` itself. The disk must be fresh: a second
run on the same image finds `PART1` already in the directory.

## Expected output

```
1581 PARTITION
00, OK,00,00
02, SELECTED PARTITION,20,22
00, OK,00,00
00, OK,00,00
MATCH=10 00, OK,00,00
02, SELECTED PARTITION,01,80
MATCH=00 62, FILE NOT FOUND,00,00
DONE
```

Green border. Line by line: the `/0:PART1,` allocation answers `00`;
the select answers `02` with the partition's first and last track, 20
and 22; `N0:SUB,S1` formats it; the write of `HELLO,S,W` closes with
`00`; the read inside the partition matched `$10` = 16 bytes; `/`
answers `02` with tracks 1 and 80, the whole disk; the same read from
the root matched none and ends on `62, FILE NOT FOUND`.

Measured in VICE x64sc 3.10 with the pinned command at 30,000,000
cycles, PAL and NTSC, identical text on both (rung 1). Every character
cell was decoded against the character ROM. The screenshots are
`screenshots/d81-partition.png` and `screenshots/d81-partition-ntsc.png`.

The image after the PAL run, decoded with Python (offset =
((track − 1) × 40 + sector) × 256; rung 1):

| Where | Bytes | Meaning |
|---|---|---|
| root directory 40/3, entry 0 | `85 14 00 50 41 52 54 31 A0 ...` blocks `78 00` | type `$85` (CBM, closed), start 20/0, name `PART1`, 120 blocks |
| root BAM 40/1, tracks 20–22 | `00 00 00 00 00 00` each | the root's BAM holds the three tracks as used; tracks 19 and 23 read `28 FF FF FF FF FF` (40 free) |
| partition 20/0 | `14 03 44 00 53 55 42 A0 ... 53 31 A0 33 44` | a header in track 40's format: link to 20/3, `D` (`$44`), name `SUB`, ID `S1`, DOS `3D` |
| partition 20/1 | `14 02 44 BB 53 31 C0 ...` | its BAM for tracks 1–40, linked to 20/2 |
| partition 20/2 | `00 FF 44 BB 53 31 C0 ...` | its BAM for tracks 41–80 |
| partition BAM, tracks 20, 21, 22 | `24 F0 FF FF FF FF`, `27 FE FF FF FF FF`, `28 FF FF FF FF FF` | 36 free (header, two BAM sectors and the directory at 20/3 used), 39 (one data block), 40 |
| partition BAM, track 1 | `00 00 00 00 00 00` | every track outside the partition reads as full |
| partition directory 20/3, entry 0 | `81 15 00 48 45 4C 4C 4F A0 ...` blocks `01 00` | `HELLO`, SEQ, one block at 21/0 |

`c1541 -attach parts.d81 -dir` lists `120 "part1" cbm` and 3,040 blocks
free: c1541 does not enter the partition.

Two variants, run once each on PAL and not pinned (rung 1):

| Change | Status lines |
|---|---|
| 20 blocks from 25/0 (`/0:SMALL,` 25, 0, 20, 0) | the allocation answers `00, OK,00,00`; the select answers `77,SELECTED PARTITION ILLEGAL,00,00`; the recipe prints `NOT SELECTED: NO N0` and stops. The root directory holds `SMALL`, type `$85`, 20 blocks |
| 120 blocks from 40/0 | the allocation answers `67,ILLEGAL TRACK OR SECTOR,40,00` |
| the 20-block variant without the `02` check | `N0:SUB,S1` answers `00` and reformats the whole disk: the root header at 40/0 becomes `SUB`/`S1` and `SMALL` is gone |

## Why this works

A partition is a file of type CBM whose blocks the root BAM marks used
in one contiguous run; the allocation command takes the start track, the
start sector and the block count, low byte first, as raw bytes after the
name, which is why the listing builds it with `.byte` rather than text.
The 1581 User's Guide, section 6.8, gives the syntax as
`PRINT#15,"/0:partition name,"+CHR$(starting track)+CHR$(starting
sector)+CHR$(<# of sectors)+CHR$(># of sectors)+",C"`, and four rules
for a partition to serve as a sub-directory: at least 120 sectors,
starting sector 0, a size that is a multiple of 40, and no part of track
40. The run above met them and the first variant broke two (20 blocks
from 25/0): the allocation still succeeded and only the select refused,
so a program learns that a partition is unusable from the select, not
from the allocation.

Selecting makes the partition the working area: the DOS reads its
header, BAM and directory from its first track, in track 40's layout,
so `N0:` writes exactly those sectors, and OPEN, SAVE and the directory
all work inside it (the manual: "Files outside of the selected area are
effectively invisible"). The partition's own BAM marks every track
outside its three as full, so nothing written inside can land outside.
`/` goes back to the root, and the root's BAM still holds the three
tracks used, so nothing written in the root can land inside. The
guide's warning that a failed select leaves `N0:` formatting "the wrong
directory area" is the third variant, measured.

Not measured here: sub-partitions inside a partition, scratching a
partition file (the guide says its files are lost) and VALIDATE, which
the guide says skips CBM entries.
