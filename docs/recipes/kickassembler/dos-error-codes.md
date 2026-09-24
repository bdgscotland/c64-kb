---
recipe: dos-error-codes
toolchain: kickassembler
output_format: PRG
region: both
techniques: [error_channel_check]
file_formats: [PRG]
uses_registers: []
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
devices: [disk_1541_ii]
---

<!-- doc-type: recipe -->

# KickAssembler DOS Error Codes

## Synopsis

Against a freshly formatted disk in drive 8, keep the command channel
open and provoke twelve replies from the 1541 DOS one after another,
printing each status line as the drive sends it: the power-on banner,
a missing file, a clean write, a second write to the same name, a type
mismatch, a wildcard in a write name, four kinds of syntax error, an
impossible block address, a fifth buffer channel and a scratch. Use it
to see what each code looks like on the wire, and as the source of the
exact strings when a program parses them. The table of every code the
ROM can produce, with causes and the D64 mapping, is in
`../../formats/iec-disk-reference.md`, section "The 1541 DOS Error
Codes".

## Source

```asm
// dos-error-codes.asm
// Against a freshly formatted disk in drive 8: keep channel 15 open, provoke
// one DOS error after another, and print the drive's reply to each. Every
// line on screen is the status string exactly as the 1541 ROM assembled it.
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

start:
    lda #$93                     // clear screen
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    // channel 15 stays open for the whole run; CLOSE 15 would close every
    // file on the drive, so the data channels are closed one by one instead
    lda #15
    ldx #8
    ldy #15
    jsr SETLFS
    lda #0                       // bare open: no command travels with it
    jsr SETNAM
    jsr OPEN
    bcc a_banner
    jmp no_drive

    // A. the power-on message: the first read after reset
a_banner:
    lda #'A'
    jsr step
    jsr read_status
    jsr print_status

    // B. a name that is not on the disk (OPEN itself returns C=0)
    lda #'B'
    jsr step
    lda #n_nofile_end-n_nofile
    ldx #<n_nofile
    ldy #>n_nofile
    jsr open_2_status_close

    // C. write T,S,W with two bytes and close it: the clean case
    lda #'C'
    jsr step
    lda #2
    ldx #8
    ldy #2
    jsr SETLFS
    lda #n_tw_end-n_tw
    ldx #<n_tw
    ldy #>n_tw
    jsr SETNAM
    jsr OPEN
    ldx #2
    jsr CHKOUT
    lda #'H'
    jsr CHROUT
    lda #'I'
    jsr CHROUT
    jsr CLRCHN
    lda #2
    jsr CLOSE                    // the entry is written here
    jsr read_status
    jsr print_status

    // D. the same name for write again, without @
    lda #'D'
    jsr step
    lda #n_tw_end-n_tw
    ldx #<n_tw
    ldy #>n_tw
    jsr open_2_status_close

    // E. the SEQ file opened as a PRG
    lda #'E'
    jsr step
    lda #n_tp_end-n_tp
    ldx #<n_tp
    ldy #>n_tp
    jsr open_2_status_close

    // F. a wildcard in a name opened for write
    lda #'F'
    jsr step
    lda #n_wild_end-n_wild
    ldx #<n_wild
    ldy #>n_wild
    jsr open_2_status_close

    // G. a command letter the DOS does not have
    lda #'G'
    jsr step
    lda #c_xyz_end-c_xyz
    ldx #<c_xyz
    ldy #>c_xyz
    jsr cmd_status

    // H. RENAME with no "=" in it
    lda #'H'
    jsr step
    lda #c_r_end-c_r
    ldx #<c_r
    ldy #>c_r
    jsr cmd_status

    // I. NEW with nothing after the letter
    lda #'I'
    jsr step
    lda #c_n_end-c_n
    ldx #<c_n
    ldy #>c_n
    jsr cmd_status

    // J. block-read of a track the disk does not have
    lda #'J'
    jsr step
    lda #2
    ldx #8
    ldy #2
    jsr SETLFS
    lda #n_hash_end-n_hash
    ldx #<n_hash
    ldy #>n_hash
    jsr SETNAM
    jsr OPEN                     // "#": a buffer channel for B-R
    lda #c_br_end-c_br
    ldx #<c_br
    ldy #>c_br
    jsr send_cmd
    jsr read_status
    lda #2
    jsr CLOSE
    jsr print_status

    // K. a fifth buffer channel: the 1541 has four to give
    lda #'K'
    jsr step
    lda #2
    sta lf
k_loop:
    lda lf
    ldx #8
    ldy lf                       // logical file = secondary = 2..6
    jsr SETLFS
    lda #n_hash_end-n_hash
    ldx #<n_hash
    ldy #>n_hash
    jsr SETNAM
    jsr OPEN
    inc lf
    lda lf
    cmp #7
    bne k_loop
    jsr read_status              // the fifth open is the one refused
    lda #6
k_close:
    pha
    jsr CLOSE
    pla
    sec
    sbc #1
    cmp #1
    bne k_close
    jsr print_status

    // L. scratch the file that C wrote
    lda #'L'
    jsr step
    lda #c_st_end-c_st
    ldx #<c_st
    ldy #>c_st
    jsr cmd_status

    lda #15
    jsr CLOSE
    ldx #<lbl_done
    ldy #>lbl_done
    jsr print_z
    rts

no_drive:
    ldx #<lbl_nodrive
    ldy #>lbl_nodrive
    jsr print_z
    rts


// --- print the step letter and a space -----------------------------------
step:
    jsr CHROUT
    lda #' '
    jmp CHROUT

// --- OPEN a name on logical file 2, channel 2, read the status, CLOSE ----
// A/X/Y = the SETNAM arguments. The reply is printed after the CLOSE.
open_2_status_close:
    sta nlen                     // SETLFS needs X and Y too, so park the
    stx nptr                     // SETNAM arguments first
    sty nptr+1
    lda #2
    ldx #8
    ldy #2
    jsr SETLFS
    lda nlen
    ldx nptr
    ldy nptr+1
    jsr SETNAM
    jsr OPEN
    jsr read_status
    lda #2
    jsr CLOSE
    jmp print_status

// --- send a command, read the reply, print it ----------------------------
cmd_status:
    jsr send_cmd
    jsr read_status
    jmp print_status


// --- send A bytes at X/Y to channel 15; UNLISTEN makes the DOS run it ----
send_cmd:
    sta sc_len
    stx sc+1
    sty sc+2
    ldx #15
    jsr CHKOUT
    ldy #0
sc: lda $ffff,y
    jsr CHROUT
    iny
    cpy sc_len
    bne sc
    jmp CLRCHN                   // no CR needed: UNLISTEN ends the command

// --- read the status line from the already-open channel 15 --------------
read_status:
    ldx #15
    jsr CHKIN
    ldy #0
rs_loop:
    jsr CHRIN
    sta stbuf,y
    iny
    jsr READST
    bne rs_end                   // EOI arrives with the final CR
    cpy #39
    bne rs_loop
rs_end:
    sty stlen
    jmp CLRCHN

print_status:
    ldy #0
ps_loop:
    cpy stlen
    beq ps_done
    lda stbuf,y
    jsr CHROUT                   // the reply ends in its own CR
    iny
    bne ps_loop
ps_done:
    rts

print_z:                         // X/Y = zero-terminated PETSCII string
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

// --- data ---------------------------------------------------------------
.encoding "petscii_upper"
n_nofile: .text "NOFILE,S,R"
n_nofile_end:
n_tw:     .text "T,S,W"
n_tw_end:
n_tp:     .text "T,P,R"
n_tp_end:
n_wild:   .text "T*,S,W"
n_wild_end:
n_hash:   .text "#"
n_hash_end:
c_xyz:    .text "XYZ"
c_xyz_end:
c_r:      .text "R0:A"
c_r_end:
c_n:      .text "N"
c_n_end:
c_br:     .text "B-R 2 0 40 0"
c_br_end:
c_st:     .text "S0:T"
c_st_end:

title:      .text "DOS ERROR CODES"
            .byte $0d, 0
lbl_done:   .text "DONE"
            .byte $0d, 0
lbl_nodrive: .text "NO DRIVE"
            .byte $0d, 0

lf:     .byte 0
nlen:   .byte 0
nptr:   .word 0
stlen:  .byte 0
sc_len: .byte 0
stbuf:  .fill 40, 0
```

## Build

```bash
java -jar $KICKASS_JAR dos-error-codes.asm -o dos-error-codes.prg
c1541 -format "test,01" d64 test.d64
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 32000000 \
  -8 test.d64 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -exitscreenshot dos-error-codes.png -autostart dos-error-codes.prg
```

Add `-model ntsc` for the NTSC run. The disk must be freshly formatted:
step C writes a file called `T` and step L scratches it, so a second
run on the same image gives the same picture, but a disk that already
holds a `T` turns step C into a 63.

## Expected output

Thirteen lines of text at the top left, each reply exactly as the drive
sent it, then `DONE` and the BASIC `READY.` prompt:

```
DOS ERROR CODES
A 73,CBM DOS V2.6 1541,00,00
B 62, FILE NOT FOUND,00,00
C 00, OK,00,00
D 63, FILE EXISTS,00,00
E 64, FILE TYPE MISMATCH,00,00
F 33,SYNTAX ERROR,00,00
G 31,SYNTAX ERROR,00,00
H 30,SYNTAX ERROR,00,00
I 34,SYNTAX ERROR,00,00
J 66,ILLEGAL TRACK OR SECTOR,40,00
K 70,NO CHANNEL,00,00
L 01, FILES SCRATCHED,01,00
DONE
```

What each letter did:

| Step | Action | Reply |
|---|---|---|
| A | first read of channel 15 after reset | `73,CBM DOS V2.6 1541,00,00` |
| B | OPEN `NOFILE,S,R` on channel 2 (OPEN returned C=0) | `62, FILE NOT FOUND,00,00` |
| C | OPEN `T,S,W`, write two bytes, CLOSE | `00, OK,00,00` |
| D | OPEN `T,S,W` again, no `@` | `63, FILE EXISTS,00,00` |
| E | OPEN `T,P,R` on the SEQ file | `64, FILE TYPE MISMATCH,00,00` |
| F | OPEN `T*,S,W` | `33,SYNTAX ERROR,00,00` |
| G | command `XYZ` | `31,SYNTAX ERROR,00,00` |
| H | command `R0:A` (RENAME without `=`) | `30,SYNTAX ERROR,00,00` |
| I | command `N` (NEW with no name) | `34,SYNTAX ERROR,00,00` |
| J | OPEN `#` on channel 2, command `B-R 2 0 40 0` | `66,ILLEGAL TRACK OR SECTOR,40,00` |
| K | OPEN `#` on channels 2, 3, 4, 5 and 6 | `70,NO CHANNEL,00,00` |
| L | command `S0:T` | `01, FILES SCRATCHED,01,00` |

Measured in VICE x64sc 3.10 with the pinned command at 32,000,000
cycles, PAL and NTSC, on a disk formatted by `c1541 -format "test,01"`
(rung 1). Every character cell of the thirteen lines was decoded against
the character ROM and matched the text above on both models. The
screenshots are `screenshots/dos-error-codes.png` and
`screenshots/dos-error-codes-ntsc.png`. The same PRG run with
`-attach8ro -8 test.d64` turns line C into `26, WRITE PROTECT ON,18,00`
and run with no disk attached turns line B into
`74,DRIVE NOT READY,00,00`; those two pictures are not committed.

Codes 32, 39, 50, 51, 52, 60, 61, 65, 67, 71, 72 and 20 to 29 other
than 26 were not provoked here. Their texts are read out of the ROM's
message table in the reference page named above.

## Why this works

The status line lives in the drive, and only a read of channel 15
fetches it. Channel 15 is opened once, bare, and held for the whole run;
`read_status` does CHKIN 15, reads bytes until READST turns non-zero
(the drive raises EOI on the closing CR), and CLRCHN. Each read also
resets the line to `00, OK,00,00`, which is why C reads clean after B's
62. CLOSE 15 is left to the very end because closing the command
channel closes every file the drive has open. Commands go out the same
channel through CHKOUT 15 and CHROUT; no CR is sent, since the UNLISTEN
that CLRCHN performs is what makes the DOS execute what it has in its
command buffer.

Steps B, D, E and F are refused OPENs. The KERNAL's OPEN returns C=0
for every one of them: the DOS takes the name, decides, and puts its
answer on channel 15, and nothing on the C64 side changes. A program
that trusts the carry flag learns about a missing or duplicate file only
when its reads return nothing or its writes vanish. Reading the line
before CLOSE, as `open_2_status_close` does, is a habit rather than a
requirement; the DOS keeps the code until it is read.

Two of the replies carry a number in the track field. 66 echoes the
track the block command asked for (40 on a 35-track disk), and 01 gives
the count of files removed. The leading space in some message fields
(`62, FILE NOT FOUND` against `31,SYNTAX ERROR`) comes from the
ROM, which stores common words once and prefixes each with a space
when it expands them, so any message that begins with one of those
words begins with a space. The reference page has the table and the
expansion routine's addresses.

Step K opens `#` five times: the 1541 has five 256-byte buffers, one is
the BAM's, and the fifth request gets 70. The KERNAL side has ten
logical-file slots, so it is the drive and not the KERNAL that refuses.

The helper `open_2_status_close` parks its three SETNAM arguments before
calling SETLFS, because SETLFS also takes X and Y. The first version of
this listing did not, called SETNAM with X=8 and Y=2, and sent the drive
five bytes from `$0208` as the file name; every open then came back 62.
That looked like CLOSE overwriting the status; the cause was the
clobbered register.
