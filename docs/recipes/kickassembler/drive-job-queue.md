---
recipe: drive-job-queue
toolchain: kickassembler
output_format: PRG
region: both
techniques: [drive_code_upload_and_job_queue]
file_formats: [PRG, D64]
uses_registers: []
uses_kernal: [SETLFS, SETNAM, OPEN, CHKOUT, CHROUT, CHKIN, CHRIN, CLRCHN, CLOSE, READST]
---

<!-- doc-type: recipe -->

# KickAssembler Drive Code Upload and Job Queue

## Synopsis

Against a freshly formatted disk in drive 8: upload a 68-byte routine
into the 1541's buffer 3 (`$0600`) with three `M-W` commands, read it
back with `M-R` and compare, start it with `M-E`, and let it ask the
drive's own disk controller for sectors through the job queue at `$00`
to `$05`. The routine runs four times with different parameters and the
host reads each result back over channel 15: a read job before the
controller knows the disk ID (it fails with `$0B`), a seek job that
teaches it the ID, the read of track 18 sector 0 that then succeeds with
`$01` and delivers the BAM, and a read of track 40 that fails with
`$03`. It also shows two things about the error channel: a failed job
leaves the status line at `00, OK,00,00`, and a bare read of channel 15
after an `M-R` returns a single CR. The verdict at `$02FF` is `01` and
the border turns green when the sector bytes match a compiled-in copy of
the BAM's first sixteen bytes. The addresses and codes are tabulated in
`../../formats/iec-disk-reference.md`, section "1541 job queue and
buffers"; the technique is `drive_code_upload_and_job_queue` on
`../../techniques/file-io.md`.

## Source

```asm
// drive-job-queue.asm
// Upload a routine into 1541 buffer 3 with M-W, read it back with M-R, start
// it with M-E, and let it read a sector through the drive's own job queue.
// The host reads the result code and the buffer back over channel 15.
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
.const CODE    = $0600       // buffer 3 in the drive: where the routine goes
.const FLAG    = $06f0       // the routine writes $A5 here when it runs
.const RESULT  = $06f1       // the job's result code, copied here
.const P_TRACK = $06f8       // parameters the host sets with M-W before M-E
.const P_SECT  = $06f9
.const P_JOB   = $06fa
.const SECTOR  = $0400       // buffer 1: the job reads into it

start:
    lda #$93
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    lda #15
    ldx #8
    ldy #15
    jsr SETLFS
    lda #0
    jsr SETNAM
    jsr OPEN
    bcc a_upload
    jmp no_drive

    // A. upload the routine in 32-byte chunks, then read it all back
a_upload:
    lda #'A'
    jsr step
    lda #0
    sta off
a_chunk:
    lda off
    cmp #drive_end-drive_code
    bcs a_verify
    jsr send_chunk
    lda off
    clc
    adc #32
    sta off
    jmp a_chunk
a_verify:
    lda #<CODE
    ldx #>CODE
    ldy #drive_end-drive_code
    jsr mem_read              // the readback lands in rbuf
    ldy #0
a_cmp:
    lda rbuf,y
    cmp drive_code,y
    bne a_bad
    iny
    cpy #drive_end-drive_code
    bne a_cmp
    ldx #<lbl_a_ok
    ldy #>lbl_a_ok
    jsr print_z
    jmp b_exec
a_bad:
    ldx #<lbl_bad
    ldy #>lbl_bad
    jsr print_z
    jmp finish

    // B. a read job for track 18 sector 0, and proof it ran: FLAG becomes $A5.
    // The controller has no disk ID yet, so this first job fails with $0B.
b_exec:
    lda #'B'
    jsr step
    lda #18
    ldx #0
    ldy #$80
    jsr run_job
    lda #<FLAG
    ldx #>FLAG
    ldy #1
    jsr mem_read
    ldx #<lbl_flag
    ldy #>lbl_flag
    jsr print_z
    lda rbuf
    jsr print_hex
    jsr print_result
    lda #$0d
    jsr CHROUT

    // S. a seek job: the controller reads any header and keeps its ID
    lda #'S'
    jsr step
    lda #18
    ldx #0
    ldy #$b0
    jsr run_job
    ldx #<lbl_seek
    ldy #>lbl_seek
    jsr print_z
    jsr print_result
    lda #<lbl_id
    ldx #>lbl_id
    jsr print_zax
    lda #$12                  // the master disk ID the controller compares
    ldx #0
    ldy #2
    jsr mem_read
    lda rbuf
    jsr print_hex
    lda rbuf+1
    jsr print_hex
    lda #$0d
    jsr CHROUT
    lda #18
    ldx #0
    ldy #$80
    jsr run_job

    // C. the job byte, the buffer's track/sector bytes, the result, the data
    lda #'C'
    jsr step
    lda #<lbl_job
    ldx #>lbl_job
    jsr print_zax
    lda #$01                  // job slot for buffer 1
    ldx #0
    ldy #1
    jsr mem_read
    lda rbuf
    jsr print_hex
    lda #<lbl_ts
    ldx #>lbl_ts
    jsr print_zax
    lda #$08                  // buffer 1's track and sector
    ldx #0
    ldy #2
    jsr mem_read
    lda rbuf
    jsr print_hex
    lda #'/'
    jsr CHROUT
    lda rbuf+1
    jsr print_hex
    jsr print_result
    lda rbuf
    sta res_c
    lda #$0d
    jsr CHROUT

    lda #<SECTOR
    ldx #>SECTOR
    ldy #16
    jsr mem_read
    ldy #0
c_print:
    lda rbuf,y
    jsr print_hex
    iny
    cpy #16
    beq c_printed
    tya
    and #7
    bne c_print
    lda #' '
    jsr CHROUT
    jmp c_print
c_printed:
    lda #$0d
    jsr CHROUT
    ldy #0
c_cmp:
    lda rbuf,y
    cmp bam_head,y
    bne c_done
    iny
    cpy #16
    bne c_cmp
    lda res_c
    cmp #1
    bne c_done
    lda #1
    sta VERDICT
    lda #5
    sta $d020
c_done:
    lda #<SECTOR+$90          // the disk name from the same buffer
    ldx #>SECTOR+$90
    ldy #16
    jsr mem_read
    lda #' '
    jsr CHROUT
    jsr CHROUT
    ldy #0
c_name:
    lda rbuf,y
    and #$7f
    jsr CHROUT
    iny
    cpy #16
    bne c_name
    lda #$0d
    jsr CHROUT

    // D. the same routine asked for track 40: the controller's error code.
    // The status line is read first, before any M-R: the job's failure is
    // not on it.
    lda #'D'
    jsr step
    lda #40
    ldx #0
    ldy #$80
    jsr run_job
    jsr read_status
    dec clen                  // drop the CR: the codes go on the same line
    jsr print_status
    lda #<lbl_job
    ldx #>lbl_job
    jsr print_zax
    lda #$01
    ldx #0
    ldy #1
    jsr mem_read
    lda rbuf
    jsr print_hex
    jsr print_result
    lda #$0d
    jsr CHROUT

    // E. the error channel after all that: the job queue never wrote to it
    lda #'E'
    jsr step
    jsr read_status
    lda clen
    jsr print_hex
    lda #':'
    jsr CHROUT
    ldy #0
e_hex:
    cpy clen
    beq e_done
    cpy #8
    beq e_done
    lda rbuf,y
    jsr print_hex
    iny
    bne e_hex
e_done:
    lda #$0d
    jsr CHROUT

finish:
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

// --- set the routine's track, sector and job code with M-W, then M-E it --
// A = track, X = sector, Y = job code. Returns when the drive is back in
// its idle loop, because channel 15 takes no new command before then.
run_job:
    sta mw_ts+6
    stx mw_ts+7
    sty mw_ts+8
    ldx #15
    jsr CHKOUT
    ldy #0
rj_1:
    lda mw_ts,y
    jsr CHROUT
    iny
    cpy #9
    bne rj_1
    jsr CLRCHN
    ldx #15
    jsr CHKOUT
    ldy #0
rj_2:
    lda me_cmd,y
    jsr CHROUT
    iny
    cpy #5
    bne rj_2
    jmp CLRCHN

// --- M-W one chunk of the routine: off = offset into drive_code ---------
send_chunk:
    lda #drive_end-drive_code
    sec
    sbc off
    cmp #32
    bcc sc_len_ok
    lda #32
sc_len_ok:
    sta clen
    ldx #15
    jsr CHKOUT
    lda #'M'
    jsr CHROUT
    lda #'-'
    jsr CHROUT
    lda #'W'
    jsr CHROUT
    lda off
    clc
    adc #<CODE
    jsr CHROUT
    lda #>CODE
    adc #0
    jsr CHROUT
    lda clen
    jsr CHROUT
    ldx off
    ldy #0
sc_data:
    lda drive_code,x
    jsr CHROUT
    inx
    iny
    cpy clen
    bne sc_data
    jmp CLRCHN

// --- M-R: A/X = address, Y = count (1..127); bytes land in rbuf ---------
mem_read:
    sta mr_cmd+3
    stx mr_cmd+4
    sty mr_cmd+5
    sty clen
    ldx #15
    jsr CHKOUT
    ldy #0
mr_1:
    lda mr_cmd,y
    jsr CHROUT
    iny
    cpy #6
    bne mr_1
    jsr CLRCHN
    ldx #15
    jsr CHKIN
    ldy #0
mr_2:
    jsr CHRIN
    sta rbuf,y
    iny
    cpy clen
    bne mr_2
    jmp CLRCHN

// --- the status line: a read that also clears it -------------------------
read_status:
    ldx #15
    jsr CHKIN
    ldy #0
rs_loop:
    jsr CHRIN
    sta rbuf,y
    iny
    jsr READST
    bne rs_end
    cpy #39
    bne rs_loop
rs_end:
    sty clen
    jmp CLRCHN

print_status:
    ldy #0
ps_loop:
    cpy clen
    beq ps_done
    lda rbuf,y
    jsr CHROUT
    iny
    bne ps_loop
ps_done:
    rts

print_result:                    // " RESULT=" and the byte at RESULT
    lda #<lbl_res
    ldx #>lbl_res
    jsr print_zax
    lda #<RESULT
    ldx #>RESULT
    ldy #1
    jsr mem_read
    lda rbuf
    jmp print_hex

step:
    jsr CHROUT
    lda #' '
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

print_zax:                       // A/X = the same, low byte in A
    sta pz+1
    stx pz+2
    jmp pz
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

// --- the routine that runs on the drive's 6502 ---------------------------
// Assembled for $0600. It marks FLAG, copies the host's track and sector
// into buffer 1's header bytes, writes the read job code into slot 1 and
// waits for the controller to replace it with a result below $80.
.encoding "petscii_upper"
drive_code:
.pseudopc CODE {
    lda #$a5
    sta FLAG
    lda P_TRACK
    sta $08                   // track for buffer 1
    lda P_SECT
    sta $09                   // sector for buffer 1
    lda P_JOB                 // $80 read, $B0 seek
    sta $01                   // slot 1 = buffer 1 at $0400
wait:
    lda $01
    bmi wait                  // bit 7 set while the job is pending
    sta RESULT
    rts
    .fill 40, i               // padding: a ramp the M-R readback checks too
}
drive_end:

mw_ts:  .text "M-W"
        .byte <P_TRACK, >P_TRACK, 3, 0, 0, 0
me_cmd: .text "M-E"
        .byte <CODE, >CODE
mr_cmd: .text "M-R"
        .byte 0, 0, 0

bam_head: .byte $12, $01, $41, $00, $15, $ff, $ff, $1f
          .byte $15, $ff, $ff, $1f, $15, $ff, $ff, $1f

title:      .text "DRIVE JOB QUEUE"
            .byte $0d, 0
lbl_a_ok:   .text toIntString(drive_end-drive_code) + " BYTES IN "
            .text toIntString(floor((drive_end-drive_code+31)/32))
            .text " M-W, M-R MATCHES"
            .byte $0d, 0
lbl_seek:   .text "SEEK"
            .byte 0
lbl_id:     .text " ID $12/13="
            .byte 0
lbl_bad:    .text "M-R DIFFERS"
            .byte $0d, 0
lbl_flag:   .text "M-E RAN, FLAG="
            .byte 0
lbl_job:    .text "JOB $01="
            .byte 0
lbl_ts:     .text " T/S="
            .byte 0
lbl_res:    .text " RESULT="
            .byte 0
lbl_done:   .text "DONE"
            .byte $0d, 0
lbl_nodrive: .text "NO DRIVE"
            .byte $0d, 0

off:    .byte 0
clen:   .byte 0
res_c:  .byte 0
rbuf:   .fill 128, 0
```

## Build

```bash
java -jar $KICKASS_JAR drive-job-queue.asm -o drive-job-queue.prg
c1541 -format "TEST,01" d64 test.d64
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 16000000 \
  -8 test.d64 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 \
  -exitscreenshot drive-job-queue.png -autostart drive-job-queue.prg
```

Add `-model ntsc` for the NTSC run. `-default` turns true drive
emulation on, and the program needs it: `M-E` runs the routine on the
emulated drive's own 6502, and there is no drive CPU without it. The
disk must be a `TEST,01` format, because the compiled-in sixteen bytes
and the printed name are that disk's BAM. Nothing is written to the
disk, so a second run on the same image gives the same picture.

## Expected output

```
DRIVE JOB QUEUE
A 68 BYTES IN 3 M-W, M-R MATCHES
B M-E RAN, FLAG=A5 RESULT=0B
S SEEK RESULT=01 ID $12/13=3031
C JOB $01=01 T/S=12/00 RESULT=01
1201410015FFFF1F 15FFFF1F15FFFF1F
  TEST
D 00, OK,00,00JOB $01=03 RESULT=03
E 01:0D
DONE
```

What each letter did:

| Step | Host side | Drive side | What the readback shows |
|---|---|---|---|
| A | three `M-W` commands of 32, 32 and 4 bytes to `$0600`, then one `M-R $0600` of 68 bytes | stores the bytes | all 68 bytes match the source, padding ramp included |
| B | `M-W` the parameters track 18, sector 0, job `$80` to `$06F8`, then `M-E $0600` | the routine writes `$A5` to `$06F0`, puts 18/0 in `$08`/`$09`, `$80` in `$01`, waits for bit 7 to clear | `FLAG=A5`: it ran. `RESULT=0B`: the controller compared the header's ID with its master copy at `$12`/`$13`, which nothing had set |
| S | the same with job `$B0` | a seek: the controller reads any header on the track and copies its ID to `$12`/`$13` | `RESULT=01`, and `$12`/`$13` read `30 31`: the ID `01` of the format command. Then the read of B is issued again |
| C | `M-R $0001`, `M-R $0008` for two bytes, `M-R $06F1`, `M-R $0400` for 16 bytes and `M-R $0490` for 16 | nothing new | job byte `01`, track/sector `12/00`, result `01`, then `12 01 41 00 15 FF FF 1F ...`, the BAM the host's `c1541` wrote, and the disk name `TEST` from offset `$90` |
| D | parameters track 40, sector 0, job `$80`; `M-E`; then a read of channel 15 before any `M-R` | the controller steps to a track the image does not have and gives up | `00, OK,00,00`: the job's failure is not on the error channel. Then `$01` and the copy both read `03` |
| E | a bare read of channel 15 after the last `M-R` | | one byte, `$0D`: a lone CR, with READST non-zero after it |

Measured in VICE x64sc 3.10 with the pinned command at 16,000,000
cycles, PAL and NTSC, on a disk formatted by `c1541 -format "TEST,01"`
(rung 1). Two runs per model gave byte-identical screenshots; every
character cell of the ten lines was decoded against the character ROM.
The screenshots are `screenshots/drive-job-queue.png` and
`screenshots/drive-job-queue-ntsc.png`. The BAM bytes were compared
against offset 91,392 (track 18 sector 0) of the `.d64` the host
formatted: `12 01 41 00 15 FF FF 1F 15 FF FF 1F 15 FF FF 1F`, with
`D4 C5 D3 D4 A0 ...` at offset `$90`.

## Why this works

Everything goes through channel 15, opened bare once and closed at the
very end. `send_chunk` sends `M-W`, the address, the count and the
bytes with CHKOUT 15 and CHROUT and then CLRCHN; the UNLISTEN that
CLRCHN performs is what makes the DOS act on the command, so no CR is
sent. `mem_read` sends `M-R` the same way and then reads the bytes back
with CHKIN 15 and CHRIN. `M-E` is the same kind of command whose action
is a JSR into the drive's RAM: `drive_code` runs in the DOS's own
context, so it can do what the DOS does, which is to put a track and
sector in `$08`/`$09`, store a code with bit 7 set in slot `$01`, and
spin on `bmi wait` until the disk controller, running from the drive's
timer interrupt, replaces it with a result. The routine copies that
result to `RESULT` and returns, which puts the drive back in its idle
loop; the host's next `M-R` is not answered until then, so it waits
for free.

The first read fails because the controller checks each header's ID
against `$12`/`$13` and nothing has set those since power-on; the seek
job (`$B0`) reads any header on the track and copies its ID there,
which is what the DOS's own `I0` does before it touches a disk. That is
why the same read then returns `$01` with the BAM in buffer 1, and why
track 40 returns `$03`: there is no header there to find.

The same PAL run with a `-moncommands` file that traces the drive CPU
(`trace exec 8:0600`, `trace store 8:06f1`: the `8:` prefix selects the
drive's address space, and `trace` does not stop the machine) and four
host addresses (`a_upload`, `a_verify`, `a_cmp` and `b_exec`: the start
of the upload, the start and the compare loop of the readback, and step
B) printed these lines, cycle counters as VICE prints them on the
right; the picture was byte-identical to the untraced run:

```text
.8:0600  A9 A5  LDA #$A5   ...  3358170     M-E entry, first job
.8:0618  8D F1 06  STA $06F1  - A:0B  ...  4260800   read before seek: $0B
.8:0600  ...                       4354152     seek job
.8:0618  ... A:01 ...              4480011     $01 after 125,859 drive cycles
.8:0600  ...                       4571206     read job
.8:0618  ... A:01 ...              4795277     $01 after 224,071 drive cycles
.8:0600  ...                       5038884     track 40
.8:0618  ... A:03 ...              5805417     $03 after 766,533 drive cycles
```

The drive's 6502 runs at 1 MHz, so those are microseconds: a seek and a
read of a sector that is there take an eighth to a quarter of a second,
mostly waiting for the sector to come round; the two failures take 0.9 s
and 0.77 s, which is the controller's retry and bump sequence. On the
host side `trace exec` at the upload's first and last instruction gave
132,742 cycles for the three `M-W` commands and 163,545 for the 68-byte
`M-R` readback (PAL, rung 1). The same trace also caught the drive's
reset code storing to `$06F1` three times before the program ran: its
RAM test walks every byte, which is why nothing uploaded survives a
drive reset.

A `command 1 "m 8:0000 8:0011"` attached to a drive-side trace store
crashed this x64sc build (exit 139, the trace line repeated until the
crash); a plain `trace` without a command worked. `dev 8` was not
tried. Writing the sector back and reading through another buffer are
listed as variations under the technique on `../../techniques/file-io.md`.
