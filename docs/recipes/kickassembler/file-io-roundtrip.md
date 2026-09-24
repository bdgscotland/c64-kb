---
recipe: file-io-roundtrip
toolchain: kickassembler
output_format: PRG
region: both
techniques: [kernal_file_write_seq, kernal_file_read_seq, error_channel_check]
file_formats: [PRG]
uses_registers: [DD04, DD05, DD06, DD07, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
harness: [cia2_timer_a, cia2_timer_b]
---

<!-- doc-type: recipe -->

# KickAssembler File I/O Round Trip

## Synopsis

Against a freshly formatted disk in drive 8, read the drive's error
channel and print it, write a 32-byte payload to a sequential file
called `SCORES`, read it back into a second buffer, compare, read the
error channel again, and put everything on screen: both status lines,
the byte count and final ST, MATCH or MISMATCH, a 16-bit checksum of
the bytes read back against a compiled-in expectation, and the time the
whole exchange took. Use it as the skeleton for a save slot or a
high-score file, and run it when a disk routine misbehaves to tell a
drive fault from a code fault.

## Source

```asm
// file-io-roundtrip.asm
// Against a freshly formatted disk in drive 8: read the error channel,
// write SCORES as a 32-byte SEQ file, read it back, compare, read the
// error channel again, and print everything. Ends with the jiffy clock so
// the run's own drive time is on screen.
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

.const PAYLOAD_LEN = 32
.const READ_CAP    = 64          // never read past the second buffer
.const EXPECT_CHK  = $8605       // python: same fold over the payload

start:
    lda #$ff                     // CIA2 timers as a free-running 32-bit
    sta $dd04                    // cycle counter: A counts cycles, B counts
    sta $dd05                    // A's underflows; nothing else uses them
    sta $dd06                    // while the KERNAL talks to the drive
    sta $dd07
    lda #$41                     // B: start, count timer A underflows
    sta $dd0f
    lda #$01                     // A: start, continuous
    sta $dd0e
    lda $a1                      // jiffy clock at entry, for the elapsed
    sta t0+1                     // figure printed at the end
    lda $a2
    sta t0
    lda #$93                     // clear screen
    jsr CHROUT
    ldx #<title
    ldy #>title
    jsr print_z

    // 1. error channel before anything else (a fresh drive says 73)
    ldx #<lbl_st1
    ldy #>lbl_st1
    jsr print_z
    jsr read_status
    jsr print_status

    // 2. write the payload to SCORES,S,W
    ldx #<lbl_write
    ldy #>lbl_write
    jsr print_z
    lda #2                       // logical file 2
    ldx #8                       // device 8
    ldy #2                       // secondary 2: a data channel
    jsr SETLFS
    lda #wname_end-wname
    ldx #<wname
    ldy #>wname
    jsr SETNAM
    jsr OPEN
    bcs fail_far
    ldx #2
    jsr CHKOUT                   // CHROUT now goes to the file
    bcs fail_far
    ldy #0
wloop:
    lda payload,y
    jsr CHROUT
    iny
    cpy #PAYLOAD_LEN
    bne wloop
    jsr CLRCHN                   // back to the screen BEFORE closing
    lda #2
    jsr CLOSE                    // the drive finalises the entry here
    jmp readback
fail_far:
    jmp fail                     // the branches above cannot reach fail

readback:

    // 3. read it back into readbuf
    lda #3
    ldx #8
    ldy #3
    jsr SETLFS
    lda #rname_end-rname
    ldx #<rname
    ldy #>rname
    jsr SETNAM
    jsr OPEN
    bcs fail_far
    ldx #3
    jsr CHKIN                    // CHRIN now comes from the file
    bcs fail_far
    ldy #0
rloop:
    jsr CHRIN
    sta readbuf,y
    iny
    jsr READST
    bne rdone                    // $40 = that was the last byte; else error
    cpy #READ_CAP
    bne rloop
rdone:
    sta status_r                 // keep ST for the screen
    sty count
    jsr CLRCHN
    lda #3
    jsr CLOSE

    ldx #<lbl_read
    ldy #>lbl_read
    jsr print_z
    lda count
    jsr print_dec2
    ldx #<lbl_bytes
    ldy #>lbl_bytes
    jsr print_z
    lda status_r
    jsr print_hex2
    lda #$0d
    jsr CHROUT

    // 4. compare length and bytes
    lda count
    cmp #PAYLOAD_LEN
    bne mismatch
    ldy #0
cmploop:
    lda readbuf,y
    cmp payload,y
    bne mismatch
    iny
    cpy #PAYLOAD_LEN
    bne cmploop
    ldx #<lbl_match
    ldy #>lbl_match
    jsr print_z
    jmp checksum
mismatch:
    ldx #<lbl_mismatch
    ldy #>lbl_mismatch
    jsr print_z

    // 5. checksum of what came back: chk = ((chk ^ b) * 5 + 1) & $ffff
checksum:
    lda #0
    sta chk
    sta chk+1
    ldy #0
ckloop:
    cpy count
    beq ckdone
    lda readbuf,y
    eor chk
    sta chk                      // t = chk ^ b (low byte only changes)
    lda chk
    sta tmp
    lda chk+1
    sta tmp+1
    asl chk                      // chk = t << 2
    rol chk+1
    asl chk
    rol chk+1
    clc                          // chk += t  -> 5t
    lda chk
    adc tmp
    sta chk
    lda chk+1
    adc tmp+1
    sta chk+1
    inc chk                      // +1
    bne ckn
    inc chk+1
ckn:
    iny
    bne ckloop
ckdone:
    ldx #<lbl_chk
    ldy #>lbl_chk
    jsr print_z
    lda chk+1
    jsr print_hex2
    lda chk
    jsr print_hex2
    lda chk
    cmp #<EXPECT_CHK
    bne ckfail
    lda chk+1
    cmp #>EXPECT_CHK
    bne ckfail
    ldx #<lbl_pass
    ldy #>lbl_pass
    jmp ckprint
ckfail:
    ldx #<lbl_fail
    ldy #>lbl_fail
ckprint:
    jsr print_z

    // 6. error channel again: the write and read left it at 00
    ldx #<lbl_st2
    ldy #>lbl_st2
    jsr print_z
    jsr read_status
    jsr print_status

    // 7. jiffies elapsed since entry, so the drive time is on the picture
    ldx #<lbl_time
    ldy #>lbl_time
    jsr print_z
    sec
    lda $a2
    sbc t0
    tax
    lda $a1
    sbc t0+1
    jsr print_hex2
    txa
    jsr print_hex2
    lda #$0d
    jsr CHROUT
    ldx #<lbl_cyc
    ldy #>lbl_cyc
    jsr print_z
    lda $dd07                    // elapsed cycles = $FFFFFFFF - B:A
    eor #$ff
    jsr print_hex2
    lda $dd06
    eor #$ff
    jsr print_hex2
    lda $dd05
    eor #$ff
    jsr print_hex2
    lda $dd04
    eor #$ff
    jsr print_hex2
    lda #$0d
    jsr CHROUT
    rts

fail:
    pha
    jsr CLRCHN
    ldx #<lbl_fail_open
    ldy #>lbl_fail_open
    jsr print_z
    pla
    jsr print_hex2
    lda #$0d
    jsr CHROUT
    rts

// --- error channel: open 15, read the reply into stbuf, close ---------
read_status:
    lda #15
    ldx #8
    ldy #15                      // secondary 15 = command channel
    jsr SETLFS
    lda #0                       // no filename: just open the channel
    jsr SETNAM
    jsr OPEN
    bcs rs_fail
    ldx #15
    jsr CHKIN
    bcs rs_fail
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
    jsr CLRCHN
    lda #15
    jsr CLOSE
    rts
rs_fail:
    ldy #0
    sty stlen
    jsr CLRCHN
    lda #15
    jsr CLOSE
    rts

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

// --- small print helpers -----------------------------------------------
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

print_hex2:                      // A as two hex digits
    pha
    lsr
    lsr
    lsr
    lsr
    jsr hexdigit
    pla
    and #$0f
hexdigit:
    cmp #10
    bcc hd_num
    adc #6                       // carry set: +7 -> 'A'..'F'
hd_num:
    adc #$30
    jmp CHROUT

print_dec2:                      // A (0..99) as two decimal digits
    ldx #0
pd_tens:
    cmp #10
    bcc pd_out
    sbc #10
    inx
    bne pd_tens
pd_out:
    pha
    txa
    ora #$30
    jsr CHROUT
    pla
    ora #$30
    jmp CHROUT

// --- data ---------------------------------------------------------------
.encoding "petscii_upper"        // filenames and messages are PETSCII
wname:  .text "SCORES,S,W"
wname_end:
rname:  .text "SCORES,S,R"
rname_end:

title:      .text "FILE-IO ROUNDTRIP"
            .byte $0d, 0
lbl_st1:    .text "STATUS 1: "
            .byte 0
lbl_write:  .text "WRITE SCORES,S,W 32 BYTES"
            .byte $0d, 0
lbl_read:   .text "READ BACK "
            .byte 0
lbl_bytes:  .text " BYTES ST="
            .byte 0
lbl_match:  .text "MATCH"
            .byte $0d, 0
lbl_mismatch: .text "MISMATCH"
            .byte $0d, 0
lbl_chk:    .text "CHK "
            .byte 0
lbl_pass:   .text " PASS"
            .byte $0d, 0
lbl_fail:   .text " FAIL"
            .byte $0d, 0
lbl_st2:    .text "STATUS 2: "
            .byte 0
lbl_time:   .text "ELAPSED JIFFIES $"
            .byte 0
lbl_cyc:    .text "ELAPSED CYCLES $"
            .byte 0
lbl_fail_open: .text "OPEN/CHK FAILED A="
            .byte 0

payload:    .text "TOP SCORE 0042 XYZ"
            .byte 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13

count:      .byte 0
status_r:   .byte 0
stlen:      .byte 0
chk:        .word 0
tmp:        .word 0
t0:         .word 0
stbuf:      .fill 40, 0
readbuf:    .fill READ_CAP, 0
```

## Build

```bash
java -jar KickAss.jar file-io-roundtrip.asm -o file-io-roundtrip.prg
```

Produces `file-io-roundtrip.prg`. The run needs a disk in drive 8:

```bash
c1541 -format "test,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 16000000 -8 test.d64 \
      -exitscreenshot file-io-roundtrip.png -autostart file-io-roundtrip.prg
```

## Expected output

```
FILE-IO ROUNDTRIP
STATUS 1: 73,CBM DOS V2.6 1541,00,00
WRITE SCORES,S,W 32 BYTES
READ BACK 32 BYTES ST=40
MATCH
CHK 8605 PASS
STATUS 2: 00, OK,00,00
ELAPSED JIFFIES $000E
ELAPSED CYCLES $0049E80E

READY.
```

Light blue text on blue, the ordinary power-on screen. The two elapsed
lines are the run's own measurement and are the only lines that may
differ between runs and regions: the NTSC picture shows `$0010` jiffies
and `$004CBED6` cycles (with the emulated drive's RPM wobble switched off, as the verifier pins it; with VICE's default wobble the figures moved by a few hundred cycles between runs and an earlier version of this page quoted one such run). Screenshots from the VICE runs this page
describes: `screenshots/file-io-roundtrip.png` (PAL) and
`screenshots/file-io-roundtrip-ntsc.png` (NTSC), both from the pinned
command above with a disk formatted as `TEST,01` immediately before the
run.

The first status line is `73`, not `00`. A 1541 answers its first
status read after reset with its DOS banner, and VICE's drive resets with
the machine; a program that treats any non-zero code as failure must
read this line once before it starts judging. The second line is the
`00, OK` a clean write and read leave behind.

After the run the disk holds the file. `c1541 -attach test.d64 -list`
printed:

```
0 "test            " 01 2a
1    "scores"           seq
663 blocks free.
```

and `c1541 -attach test.d64 -read "scores,s" scores.bin` followed by
`xxd scores.bin` printed the payload byte for byte:

```
00000000: 544f 5020 5343 4f52 4520 3030 3432 2058  TOP SCORE 0042 X
00000010: 595a 0001 0203 0405 0607 0809 0a0b 0c0d  YZ..............
```

The `,s` in the `-read` argument is needed: c1541 looks for a PRG by default,
and `-read scores` on this disk answered `ERR = 62, FILE NOT FOUND`
(measured). The 32 bytes compared identical to the payload in Python,
and Python's fold `chk = ((chk ^ b) * 5 + 1) & 0xffff` over them gives
`0x8605`, the value compiled in as `EXPECT_CHK` and printed with PASS.

## Why this works

The disk work is three pairs of OPEN/CLOSE on three logical files. File
15 with secondary 15 is the command channel: opened with no name it
sends nothing, and CHKIN plus a CHRIN loop reads the status line until
READST comes back non-zero, which happens on the CR that ends the line.
File 2 with secondary 2 and the name `SCORES,S,W` creates the file;
CHKOUT points CHROUT at it, 32 CHROUTs send the payload, and the order
that follows matters: CLRCHN first, so output is back on the screen and
the drive has been sent UNLISTEN, then CLOSE, which is the call that
makes the drive write its last block and finish the directory entry.
File 3 with secondary 3 and `SCORES,S,R` reads it back. The read loop
stores each byte and then tests READST, never the carry: CHRIN returns
the last byte with C=0 like every other, and only ST = `$40` says it was
the last. `READ_CAP` bounds the loop so a wrong file cannot run past the
buffer. The compare checks the count and then every byte, so a short or
long file reads MISMATCH rather than a lucky prefix match.

Every filename and message is emitted under `.encoding "petscii_upper"`.
A drive parses PETSCII; KickAssembler's default is screen codes, which
for upper-case letters coincide, so the line is there to keep the habit
rather than because these strings need it.

The cycle count comes from CIA2. Both timers are started at `$FFFF`,
timer A counting cycles and timer B counting timer A's underflows, so
the complement of B:A at the end is the elapsed cycle count; the KERNAL
serial code uses CIA2's port A for the bus lines but not its timers, and
the figure agrees between regions once divided by the clock: 4,846,078
cycles is 4.92 s at PAL's 985,248 Hz and the NTSC run's 5,032,153 is
4.92 s at 1,022,727 Hz. The jiffy figure on the line above it is there
as a warning: the jiffy clock counted 13 ticks, about 0.2 s, across the
same 4.9 s, because the KERNAL's serial routines hold interrupts off
for most of a transfer and the 60 Hz tick is lost while they do. Do not
time disk I/O with `$A0-$A2`. The mechanism is the ROM's; only the
numbers were measured here.

The pin of 16,000,000 cycles is about twice what the run needs: the
same program on the same disk finished, with the identical screen, at
8,000,000 cycles, so 16,000,000 leaves room for a slower host or an
emulator that seats the drive differently. An earlier draft of this
listing printed only the jiffy count and read it as the drive time; the
CIA2 counter was added when 13 jiffies for a run that visibly took
seconds did not add up.

Verified: assembled with KickAssembler 5.25 and run in VICE 3.10 x64sc
with true drive emulation, PAL and NTSC; the screens read as above, the
directory shows `scores seq`, and the file's bytes match the payload.
