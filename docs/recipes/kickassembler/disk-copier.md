---
recipe: disk-copier
toolchain: kickassembler
output_format: PRG
region: both
techniques: [disk_copy_block_commands]
file_formats: [PRG, D64]
uses_registers: []
uses_kernal: [SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CHKIN, CHRIN, CLRCHN, CLOSE, READST]
devices: [disk_1541_ii, disk_1541_ii_drive_9]
claims: [zero_page $FB-$FC (owns)]
harness: [cia2_timer_a, cia2_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler Disk Copier with U1 and U2

## Synopsis

A two-drive block copier: every block the BAM of the disk in drive 8
marks used is read with `U1` into a `#` buffer channel, moved to the C64
and written to the same track and sector of the disk in drive 9 with
`U2`; then each copied block is read back from drive 9 and compared.
Before copying, the program writes two SEQ files to drive 8 (10 and 7
blocks) so that there is more than the directory to copy. It prints the
block list it built from the BAM, the cycles the copy took (CIA 2 timers
A and B chained, a harness), the verified count and drive 9's status
line. The verdict at `$02FF` is `01` and the border turns green when
every block compared equal. The technique is `disk_copy_block_commands`
on `../../techniques/file-io.md`.

## Source

```asm
// disk-copier.asm
// Copy every block the BAM of the disk in drive 8 marks used onto the disk
// in drive 9, with U1 (block read) and U2 (block write) through a "#"
// buffer channel on each drive, then read each copied block back from
// drive 9 and compare. It first writes two SEQ files to drive 8 so that
// there is something beyond the directory to copy.
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
.const STORE   = $4000       // one page per copied block, up to 64 blocks
.const MAXBLK  = 64
.const BAM     = $3f00       // the source BAM, 18/0
.const CMD8    = 15          // logical files: command channels
.const CMD9    = 14
.const BUF8    = 2           // and "#" buffer channels (secondary 2 and 3)
.const BUF9    = 3
.const ptr     = $fb         // zero page pointer into STORE

.encoding "petscii_upper"

start:
    lda #$93
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    jsr make_files            // two SEQ files on drive 8

    // command and buffer channels on both drives
    lda #CMD8
    ldx #8
    ldy #15
    jsr open_bare
    lda #CMD9
    ldx #9
    ldy #15
    jsr open_bare
    lda #1
    ldx #<hash
    ldy #>hash
    jsr SETNAM
    lda #BUF8
    ldx #8
    ldy #2
    jsr SETLFS
    jsr OPEN
    lda #1
    ldx #<hash
    ldy #>hash
    jsr SETNAM
    lda #BUF9
    ldx #9
    ldy #3
    jsr SETLFS
    jsr OPEN

    // read the source BAM and list the used blocks
    lda #18
    sta trk
    lda #0
    sta sec
    jsr read_block8
    ldx #0
bam_copy:
    lda STORE,x               // read_block8 left it in the first page
    sta BAM,x
    inx
    bne bam_copy
    jsr build_list
    ldx #<lbl_used
    ldy #>lbl_used
    jsr print_z
    lda nblk
    jsr print_hex
    lda #$0d
    jsr CHROUT
    jsr print_list

    // copy: U1 on drive 8 into STORE page n, U2 of that page on drive 9
    jsr timer_start
    lda #0
    sta idx
copy_loop:
    ldx idx
    cpx nblk
    beq copy_done
    lda list_t,x
    sta trk
    lda list_s,x
    sta sec
    txa
    clc
    adc #>STORE
    sta ptr+1
    jsr read_block8_ptr
    jsr write_block9
    inc idx
    jmp copy_loop
copy_done:
    jsr timer_stop
    ldx #<lbl_cyc
    ldy #>lbl_cyc
    jsr print_z
    ldx #3
pc: lda elapsed,x
    jsr print_hex
    dex
    bpl pc
    lda #$0d
    jsr CHROUT

    // verify: read each block back from drive 9 and compare with STORE
    lda #0
    sta idx
    sta bad
ver_loop:
    ldx idx
    cpx nblk
    beq ver_done
    lda list_t,x
    sta trk
    lda list_s,x
    sta sec
    txa
    clc
    adc #>STORE
    sta ptr+1
    jsr compare_block9
    inc idx
    jmp ver_loop
ver_done:
    ldx #<lbl_ver
    ldy #>lbl_ver
    jsr print_z
    lda nblk
    jsr print_hex
    ldx #<lbl_bad
    ldy #>lbl_bad
    jsr print_z
    lda bad
    jsr print_hex
    lda #$0d
    jsr CHROUT
    ldx #<lbl_st9
    ldy #>lbl_st9
    jsr print_z
    ldx #CMD9
    jsr status

    lda #BUF9
    jsr CLOSE
    lda #BUF8
    jsr CLOSE
    lda #CMD9
    jsr CLOSE
    lda #CMD8
    jsr CLOSE
    lda bad
    bne done
    lda nblk
    beq done
    lda #1
    sta VERDICT
    lda #5
    sta $d020
done:
    ldx #<lbl_done
    ldy #>lbl_done
    jsr print_z
    rts

// --- open a logical file with no name: A = lfn, X = unit, Y = secondary --
open_bare:
    jsr SETLFS
    lda #0
    jsr SETNAM
    jmp OPEN

// --- the used blocks: every sector whose BAM bit is 0 --------------------
build_list:
    lda #0
    sta nblk
    lda #1
    sta trk
bl_track:
    ldx trk
    lda spt-1,x               // sectors on this track
    sta nsec
    lda trk
    asl
    asl
    tax                       // X = 4 * track: this track's BAM entry
    lda #0
    sta sec
bl_sec:
    lda sec
    lsr
    lsr
    lsr
    sta tmp                   // byte 1 + sec/8 of the entry
    txa
    clc
    adc tmp
    tay
    lda sec
    and #7
    sta tmp
    lda BAM+1,y
    ldy tmp
bl_shift:
    dey
    bmi bl_bit
    lsr
    jmp bl_shift
bl_bit:
    and #1
    bne bl_next               // 1 = free
    ldy nblk
    cpy #MAXBLK
    beq bl_next
    lda trk
    sta list_t,y
    lda sec
    sta list_s,y
    inc nblk
bl_next:
    inc sec
    lda sec
    cmp nsec
    bne bl_sec
    inc trk
    lda trk
    cmp #36
    bne bl_track
    rts

print_list:
    lda #6
    sta col
    lda #0
    sta idx
pl: ldx idx
    cpx nblk
    beq pl_end
    lda list_t,x
    jsr print_hex
    lda #'/'
    jsr CHROUT
    ldx idx
    lda list_s,x
    jsr print_hex
    inc idx
    dec col
    beq pl_row                // six to a line
    lda #' '
    jsr CHROUT
    jmp pl
pl_row:
    lda #6
    sta col
    lda #$0d
    jsr CHROUT
    jmp pl
pl_end:
    lda #$0d
    jmp CHROUT

// --- U1 on drive 8: trk/sec into the buffer, then 256 bytes into (ptr) ---
read_block8:
    lda #>STORE
    sta ptr+1
read_block8_ptr:
    lda #'1'
    ldx #CMD8
    ldy #'2'
    jsr u_command
    ldx #CMD8
    ldy #'2'
    jsr bp_zero
    ldx #BUF8
    jsr CHKIN
    ldy #0
    sty ptr
rb: jsr CHRIN
    sta (ptr),y
    iny
    bne rb
    jmp CLRCHN

// --- 256 bytes from (ptr) into drive 9's buffer, then U2 to trk/sec -----
write_block9:
    ldx #CMD9
    ldy #'3'
    jsr bp_zero
    ldx #BUF9
    jsr CHKOUT
    ldy #0
    sty ptr
wb: lda (ptr),y
    jsr CHROUT
    iny
    bne wb
    jsr CLRCHN
    lda #'2'
    ldx #CMD9
    ldy #'3'
    jmp u_command

// --- U1 on drive 9 and count the pages that differ from (ptr) ------------
compare_block9:
    lda #'1'
    ldx #CMD9
    ldy #'3'
    jsr u_command
    ldx #CMD9
    ldy #'3'
    jsr bp_zero
    ldx #BUF9
    jsr CHKIN
    ldy #0
    sty ptr
    sty diff
cb: jsr CHRIN
    cmp (ptr),y
    beq cb_same
    inc diff
cb_same:
    iny
    bne cb
    jsr CLRCHN
    lda diff
    beq cb_ok
    inc bad
cb_ok:
    rts

// --- "U<A>:<Y>,0,<trk>,<sec>" to command channel X -----------------------
u_command:
    sta ucmd+1
    sty ucmd+3
    jsr CHKOUT
    ldy #0
uc: lda ucmd,y
    jsr CHROUT
    iny
    cpy #7
    bne uc
    lda trk
    jsr print_dec             // CHROUT goes to the drive while CHKOUT is set
    lda #','
    jsr CHROUT
    lda sec
    jsr print_dec
    jmp CLRCHN

// --- "B-P:<Y>,0" to command channel X ------------------------------------
bp_zero:
    sty bpcmd+4
    jsr CHKOUT
    ldy #0
bpl:
    lda bpcmd,y
    jsr CHROUT
    iny
    cpy #7
    bne bpl
    jmp CLRCHN

// --- the status line of command channel X, printed -----------------------
status:
    jsr CHKIN
st: jsr CHRIN
    jsr CHROUT
    jsr READST
    beq st
    jmp CLRCHN

// --- two SEQ files on drive 8: 2,540 and 1,778 bytes ---------------------
make_files:
    lda #'1'
    sta fname+4
    lda #10
    sta nfill
    jsr write_seq
    lda #'2'
    sta fname+4
    lda #7
    sta nfill
write_seq:
    lda #fname_end-fname
    ldx #<fname
    ldy #>fname
    jsr SETNAM
    lda #2
    ldx #8
    ldy #2
    jsr SETLFS
    jsr OPEN
    ldx #2
    jsr CHKOUT
ws_page:
    ldy #0
ws: tya
    eor fname+4               // the file's digit makes the two files differ
    jsr CHROUT
    iny
    cpy #254
    bne ws
    dec nfill
    bne ws_page
    jsr CLRCHN
    lda #2
    jmp CLOSE

// --- CIA 2 timers A and B chained as a 32-bit cycle counter (harness) ----
timer_start:
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda #$59                  // B: force load, start, count A underflows
    sta $dd0f
    lda #$11                  // A: force load, start, continuous
    sta $dd0e
    rts
timer_stop:
    lda #0
    sta $dd0e                 // stop A: B then counts nothing more
    lda $dd04
    eor #$ff
    sta elapsed
    lda $dd05
    eor #$ff
    sta elapsed+1
    lda $dd06
    eor #$ff
    sta elapsed+2
    lda $dd07
    eor #$ff
    sta elapsed+3
    rts

print_dec:                    // A = 0..99 as one or two digits
    ldx #'0'
pd10:
    cmp #10
    bcc pd1
    sbc #10
    inx
    bne pd10
pd1:
    pha
    cpx #'0'
    beq pd_one
    txa
    jsr CHROUT
pd_one:
    pla
    ora #'0'
    jmp CHROUT

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

print_z:                      // X/Y = zero-terminated PETSCII string
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

// sectors per track, tracks 1 to 35
spt:    .fill 17, 21
        .fill 7, 19
        .fill 6, 18
        .fill 5, 17

hash:   .text "#"
ucmd:   .text "U1:2,0,"
bpcmd:  .text "B-P:2,0"
fname:  .text "FILE1,S,W"
fname_end:

title:     .text "DISK COPY 8 TO 9, U1/U2"
           .byte $0d, 0
lbl_used:  .text "USED BLOCKS $"
           .byte 0
lbl_cyc:   .text "COPY CYCLES $"
           .byte 0
lbl_ver:   .text "VERIFIED $"
           .byte 0
lbl_bad:   .text " BAD $"
           .byte 0
lbl_st9:   .text "DRIVE 9: "
           .byte 0
lbl_done:  .text "DONE"
           .byte $0d, 0

trk:    .byte 0
sec:    .byte 0
nsec:   .byte 0
tmp:    .byte 0
nblk:   .byte 0
idx:    .byte 0
col:    .byte 0
nfill:  .byte 0
diff:   .byte 0
bad:    .byte 0
elapsed: .byte 0, 0, 0, 0
list_t: .fill MAXBLK, 0
list_s: .fill MAXBLK, 0
```

## Build

```bash
java -jar $KICKASS_JAR disk-copier.asm -o disk-copier.prg
c1541 -format "SOURCE,01" d64 source.d64
c1541 -format "TARGET,01" d64 target.d64
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 120000000 \
  -8 source.d64 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -9 target.d64 -drive9type 1542 -drive9wobbleamplitude 0 -drive9wobblefrequency 0 \
  -exitscreenshot disk-copier.png -autostart disk-copier.prg
```

Add `-model ntsc` for the NTSC run. VICE attaches no drive 9 by default
(`-dumpconfig`: `Drive9Type=0`), so `-drive9type 1542` is needed. The
pinned run in `runs.json` has `"disk": {"name": "SOURCE,01"}` and
`"disk9": {"name": "TARGET,01"}`: the verifier formats both and adds the
drive-9 options. Both disks must be fresh: the files are written to
drive 8 on every run.

## Expected output

```
DISK COPY 8 TO 9, U1/U2
USED BLOCKS $15
11/00 11/01 11/02 11/03 11/04 11/05
11/06 11/07 11/08 11/0A 11/0B 11/0C
11/0D 11/0E 11/0F 11/10 11/11 11/12
11/14 12/00 12/01
COPY CYCLES $01C3F16E
VERIFIED $15 BAD $00
DRIVE 9: 00, OK,00,00
DONE
```

Green border. The NTSC run prints the same except `COPY CYCLES
$01D51CEE`. Measured in VICE x64sc 3.10 with the pinned command at
120,000,000 cycles, PAL and NTSC (rung 1); every character cell was
decoded against the character ROM. The screenshots are
`screenshots/disk-copier.png` and `screenshots/disk-copier-ntsc.png`.

What the numbers are, all rung 1 unless marked:

| Figure | PAL | NTSC |
|---|---|---|
| used blocks in the BAM | 21 (`$15`) | 21 |
| copy, all 21 blocks | 29,618,542 cycles | 30,743,790 cycles |
| per block | 1,410,407 cycles, 1.43 s | 1,463,990 cycles, 1.43 s |
| read half only (U1, B-P, 256 CHRIN; a build without the write) | 801,648 cycles a block | not run |

The seconds are the cycles over the clock (985,248 Hz PAL, 1,022,727 Hz
NTSC; rung 3): the same wall time on both, because the drives set the
pace. At that rate the 664 blocks of a full disk would take about 16
minutes (rung 3, not run).

The images after a manual PAL run with the same build, compared with
Python block by block: all 683 blocks of `target.d64` equal
`source.d64`, including 18/0, so the target's header now reads
`SOURCE`: the copy carries the BAM and the disk name with it. The
directory holds `FILE1` (10 blocks, chain 17/0, 17/10, 17/20, ...) and
`FILE2` (7 blocks from 17/1), 17 blocks, and with 18/0 and 18/1 that
is 19. The BAM marks 21: 17/12 and 17/17 are allocated and in no
chain. Each file is an exact multiple of 254 bytes (2,540 and 1,778),
and the DOS allocated the next block when the last one filled. A build
writing 253 bytes a block instead (2,530 and 1,771 bytes, same block
counts) left 19 used blocks, copied 19 in 26,861,679 cycles and
verified them (`pitfalls/kernal-and-io.md`,
`exact_254_multiple_file_leaves_block_allocated`).

## Why this works

`U1` and `U2` are the DOS's block read and block write: `U1:<channel>,
<drive>,<track>,<sector>` reads a sector into the buffer that the `#`
channel with that secondary address owns, and `U2` writes that buffer
to a sector without touching the BAM. `B-P:<channel>,0` sets the
buffer's pointer to byte 0, and the 256 bytes are then moved with CHRIN
and CHROUT on the buffer channel, exactly like a file. Each command goes
to channel 15 with CHKOUT, CHROUT and CLRCHN; the UNLISTEN that CLRCHN
sends makes the DOS act on it, so no CR is sent. One `#` channel per
drive (secondary 2 on drive 8, 3 on drive 9) is all a copier needs; the
two drives answer to their own device numbers on the same bus.

The block list comes from the BAM itself: 18/0 holds four bytes per
track from offset 4, a free count and a 24-bit map in which a set bit is
a free sector, sector n in bit n mod 8 of byte n div 8. Copying every
block with a clear bit copies the files, the directory and the BAM, so
the target needs no BAM update of its own. Copying the BAM also copies
the leaked blocks above, which is harmless; a copier that follows the
directory's chains instead copies only the blocks the files use and has
to write the target's BAM itself.

The time is almost all serial bus and disk rotation. The host reads
sectors in the order of the list, one after the other on a track; with
the KERNAL's bus speed the drive has passed the next sector by the time
it is asked for it, so each read waits for most of a rotation (rung 4:
the per-block time fits it, but where the head was was not traced). Not
measured here: a list sorted by an interleave, and a copier that reads
a whole track into drive RAM before sending it.

`U1`/`U2` copy the 256 data bytes of a sector, not its GCR header. On a
real disk the target keeps the headers its own format wrote, so a copy
onto a disk formatted with a different ID leaves the copied BAM's ID and
the headers' ID disagreeing (rung 4). A D64 holds only the 683 data
blocks, 174,848 bytes, no headers, so the image cannot show it and it
was not tried here; the pinned run formats both disks with ID `01`.
