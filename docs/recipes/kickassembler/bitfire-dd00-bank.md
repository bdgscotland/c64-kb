---
recipe: bitfire-dd00-bank
toolchain: kickassembler
output_format: D64
region: both
techniques: [bitfire_loader]
file_formats: [PRG, D64]
uses_registers: [D011, D012, D018, D019, D01A, D020, D021, DC0D, DD00, DD02, DD0D]
uses_kernal: [SETLFS, SETNAM, LOAD]
---

<!-- doc-type: recipe -->

# KickAssembler Bitfire Loader with a $DD00 VIC-Bank Switch

## Synopsis

Load eight files with the Bitfire loader while a raster interrupt switches
the VIC bank twice a frame, and check every file by checksum. Bitfire's
readme says to switch the bank with a plain store of `$00`-`$03` to
`$DD00` "at any time, also while loading", and never with a
read-modify-write of `$DD00` (section "Bank switching"). This recipe runs
that rule in VICE with true drive emulation, and beside it the
read-modify-write and Sparkle's `$DD02` rule. Bitfire (Tobias Bindhammer,
BSD 3-Clause) is used as a tool: its `d64write` builds the disk and its
installer is loaded from that disk; no Bitfire source is on this page. The
program loads the installer with the KERNAL, calls it, banks the KERNAL
out and loads files 0-7, 4 KB each of LFSR bytes, to `$2000`-`$7FFF` and
`$A000`-`$BFFF`. The interrupt shows VIC bank 0 (screen `$0400`) above
raster line 150 and bank 2 (screen `$8400`) below it; each screen fills
the other bank's half with a marker digit, so a missed bank switch shows
on the picture. The interrupt also reads `$DD00` bits 0-1 before each
switch and counts every read that is not the bank it set. The layout
follows `sparkle-dd02-bank`, so the two loaders' rules can be compared
line for line. The technique is `bitfire_loader` on
`../../techniques/loaders-packers.md`; the pitfall is
`fastloader_dd00_write_corrupts_resident` on `../../pitfalls/loader.md`.

## Source

```asm
// bitfire-dd00-bank.asm
// KickAssembler 5.25 writes bitfire-dd00-bank.prg (the test, booted from
// the disk) and blk0.prg-blk7.prg (the eight data files). Bitfire's
// d64write puts the test in the directory, Bitfire's installer beside it
// as a standard file, and the eight data files in Bitfire's own format.
// :mode=0 switches the VIC bank with a plain LDA #bank : STA $DD00 (the
// Bitfire way), :mode=1 with LDA $DD00 : AND #$FC : ORA : STA $DD00,
// :mode=2 with LDA #$3C+bank : STA $DD02 (the Sparkle way).
.encoding "screencode_upper"

.var MODE = 0
.if (cmdLineVars.containsKey("mode")) {
    .eval MODE = cmdLineVars.get("mode").asNumber()
}

// loader/loader_kickass.inc as Bitfire 5a3964b's make writes it, default config.inc
.const bitfire_install_  = $1000       // the installer's entry; it loads at $1000
.const bitfire_loadraw_  = $f038       // A = file number; returns when the file is in

.const SETLFS = $ffba
.const SETNAM = $ffbd
.const LOAD   = $ffd5

.const SCR0  = $0400                   // screen in VIC bank 0
.const SCR2  = $8400                   // screen in VIC bank 2
.const NB    = 8                       // data files
.const BLK   = $1000                   // bytes per file
.const TOP   = $10                     // IRQ line: bank 0 from here (border)
.const SPLIT = $96                     // IRQ line 150: bank 2 from here (blank row 12)

.var addrs = List().add($2000, $3000, $4000, $5000, $6000, $7000, $a000, $b000)

// zero page: Bitfire owns $00 (it must hold $37) and $02-$0C
.const scr     = $10
.const ptr     = $12
.const sum     = $14
.const xr      = $15
.const cur     = $16
.const phase   = $17
.const loading = $18
.const frames  = $19                   // 2 bytes, frames while loading
.const writes  = $1b                   // 2 bytes, bank writes while loading
.const stray   = $1d                   // 2 bytes, IRQs that found the wrong bank
.const bad     = $1f
.const tick    = $20                   // frames since the IRQ started
.const ntsc    = $21

// ---------------------------------------------------------------
// The data: 16-bit Galois LFSR bytes, one 4 KB file per segment
// ---------------------------------------------------------------
.var sums = List()
.var xors = List()
.var lfsr = $ace1
.macro block(b) {
    * = addrs.get(b)
    .var s = 0
    .var x = 0
    .for (var i = 0; i < BLK; i++) {
        .eval lfsr = (lfsr >> 1) ^ ((lfsr & 1) * $b400)
        .byte lfsr & $ff
        .eval s = (s + (lfsr & $ff)) & $ff
        .eval x = x ^ (lfsr & $ff)
    }
    .eval sums.add(s)
    .eval xors.add(x)
}
.segment B0 [outPrg="blk0.prg"]
    block(0)
.segment B1 [outPrg="blk1.prg"]
    block(1)
.segment B2 [outPrg="blk2.prg"]
    block(2)
.segment B3 [outPrg="blk3.prg"]
    block(3)
.segment B4 [outPrg="blk4.prg"]
    block(4)
.segment B5 [outPrg="blk5.prg"]
    block(5)
.segment B6 [outPrg="blk6.prg"]
    block(6)
.segment B7 [outPrg="blk7.prg"]
    block(7)
.segment Default

// ---------------------------------------------------------------
.macro bank(b) {
    .if (MODE == 0) {
        lda #3 - b                     // a plain store of $00-$03
        sta $dd00
    }
    .if (MODE == 1) {
        lda $dd00                      // the usual read-modify-write
        and #$fc
        ora #3 - b
        sta $dd00
    }
    .if (MODE == 2) {
        lda #$3c + b                   // Sparkle's formula
        sta $dd02
    }
}

.macro check(expect) {                 // $DD00 bits 0-1 = the bank the VIC used
    lda $dd00
    and #$03
    cmp #expect
    beq ok
    inc stray
    bne ok
    inc stray + 1
ok:
}

.macro puts(dst, src) {
    ldx #0
loop:
    lda src,x
    beq done
    sta dst,x
    inx
    bne loop
done:
}

.macro puthex(dst, src) {
    lda src
    jsr tohex
    sta dst
    stx dst + 1
}

BasicUpstart2(start)
start:
    lda $02a6                          // the KERNAL's PAL/NTSC flag: 0 = NTSC
    eor #1
    sta ntsc
    lda #1                             // LOAD"INSTALLER",8,1 to $1000
    ldx $ba                            // the drive we booted from
    ldy #1
    jsr SETLFS
    lda #t_inst_end - t_inst
    ldx #<t_inst
    ldy #>t_inst
    jsr SETNAM
    lda #0
    jsr LOAD
    jsr bitfire_install_               // uploads the drive code; KERNAL still in

    sei
    lda #$35                           // I/O in, BASIC and KERNAL out:
    sta $01                            // the resident part is at $F000
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    ldx #0
    stx $d020
    stx $d021
    stx phase
    stx loading
    stx frames
    stx frames + 1
    stx writes
    stx writes + 1
    stx stray
    stx stray + 1
    stx bad
    stx tick
clr:
    lda #$20
    sta SCR0,x
    sta SCR0 + $100,x
    sta SCR0 + $200,x
    sta SCR0 + $2e8,x
    sta SCR2,x
    sta SCR2 + $100,x
    sta SCR2 + $200,x
    sta SCR2 + $2e8,x
    lda #1
    sta $d800,x
    sta $d900,x
    sta $da00,x
    sta $dae8,x
    inx
    bne clr
    ldx #0                             // markers: each screen's hidden half
mark:
    lda #$30                           // "0" on bank 0, rows 13-24
    sta SCR0 + 13 * 40,x
    sta SCR0 + 13 * 40 + 240,x
    lda #$32                           // "2" on bank 2, rows 0-11
    sta SCR2,x
    sta SCR2 + 240,x
    inx
    cpx #240
    bne mark

    puts(SCR0, t_title)
    puts(SCR0 + 40, t_mode)
    puts(SCR0 + 80, t_head)
    puts(SCR2 + 13 * 40, t_half)
    puts(SCR2 + 15 * 40, t_frames)
    puts(SCR2 + 16 * 40, t_writes)
    puts(SCR2 + 17 * 40, t_stray)
    lda ntsc
    bne isntsc
    puts(SCR0 + 40 + 36, t_pal)
    jmp vid
isntsc:
    puts(SCR0 + 40 + 36, t_ntsc)
vid:
    lda #$14                           // screen +$0400, characters +$1000 (ROM image)
    sta $d018
    lda #$1b
    sta $d011
    lda #TOP
    sta $d012
    lda #<irq
    sta $fffe
    lda #>irq
    sta $ffff
    lda #1
    sta $d01a
    sta $d019
    cli

    ldx #0
rowlp:                                 // "F0 2000" for every file
    stx cur
    jsr rowptr
    ldy #0
    lda #$06
    sta (scr),y
    iny
    txa
    ora #$30
    sta (scr),y
    ldy #3
    lda ahi,x
    jsr puthexy
    lda #0
    jsr puthexy
    ldx cur
    inx
    cpx #NB
    bne rowlp

    lda #2                             // two whole frames of IRQs first, so
wait:                                  // the bank checks start from a known state
    cmp tick
    bcs wait
    lda #1
    sta loading
    ldx #0
loadlp:
    stx cur
    jsr rowptr
    ldy #8
    ldx #0
wr: lda t_loading,x
    beq go
    sta (scr),y
    iny
    inx
    bne wr
go:
    lda cur                            // file number = order on the disk
    jsr bitfire_loadraw_               // blocks; the IRQ keeps switching banks
    ldx cur
    jsr rowptr
    ldy #8
    ldx #0
wr2:
    lda t_loaded,x
    beq nx
    sta (scr),y
    iny
    inx
    bne wr2
nx:
    ldx cur
    inx
    cpx #NB
    bne loadlp
    lda #0
    sta loading

    ldx #0                             // checksums
cklp:
    stx cur
    lda #0
    sta ptr
    sta sum
    sta xr
    lda ahi,x
    sta ptr + 1
    ldx #>BLK
    ldy #0
ck: lda (ptr),y
    pha
    clc
    adc sum
    sta sum
    pla
    eor xr
    sta xr
    iny
    bne ck
    inc ptr + 1
    dex
    bne ck

    ldx cur
    jsr rowptr
    ldy #8
    lda sum
    jsr puthexy
    lda #$2f                           // "/"
    sta (scr),y
    iny
    ldx cur
    lda esum,x
    jsr puthexy
    lda #$20
    sta (scr),y
    iny
    lda xr
    jsr puthexy
    lda #$2f
    sta (scr),y
    iny
    ldx cur
    lda exor,x
    jsr puthexy
    iny
    ldx cur
    lda sum
    cmp esum,x
    bne nok
    lda xr
    cmp exor,x
    bne nok
    lda #$0f                           // "OK "
    sta (scr),y
    iny
    lda #$0b
    sta (scr),y
    iny
    lda #$20
    sta (scr),y
    jmp nextck
nok:
    inc bad
    lda #$02                           // "BAD"
    sta (scr),y
    iny
    lda #$01
    sta (scr),y
    iny
    lda #$04
    sta (scr),y
nextck:
    ldx cur
    inx
    cpx #NB
    beq ckdone
    jmp cklp
ckdone:
    lda bad
    bne fail
    puts(SCR2 + 19 * 40, t_allok)
    lda #5
    sta $d020
    jmp *
fail:
    puts(SCR2 + 19 * 40, t_fail)
    lda #2
    sta $d020
    jmp *

rowptr:                                // scr = SCR0 + (3 + X) * 40
    lda rlo,x
    sta scr
    lda rhi,x
    sta scr + 1
    rts

puthexy:                               // A as two hex digits at (scr),y; y += 2
    jsr tohex
    sta (scr),y
    iny
    txa
    sta (scr),y
    iny
    rts

tohex:                                 // A -> A = high digit, X = low digit
    pha
    and #$0f
    jsr nyb
    tax
    pla
    lsr
    lsr
    lsr
    lsr
nyb:
    cmp #10
    bcc dig
    sbc #9
    rts
dig:
    ora #$30
    rts

// ---------------------------------------------------------------
irq:
    pha
    txa
    pha
    tya
    pha
    lda #$ff
    sta $d019
    lda phase
    bne atsplit
    inc tick
    lda loading
    beq t0
    check(%01)                         // bank 2 was set at SPLIT
    inc frames
    bne t0
    inc frames + 1
t0:
    bank(0)
    lda #SPLIT
    sta $d012
    lda #1
    sta phase
    jmp count
atsplit:
    lda loading
    beq t2
    check(%11)                         // bank 0 was set at TOP
t2:
    bank(2)
    lda #TOP
    sta $d012
    lda #0
    sta phase
count:
    lda loading
    beq show
    inc writes
    bne show
    inc writes + 1
show:
    puthex(SCR2 + 15 * 40 + 14, frames + 1)
    puthex(SCR2 + 15 * 40 + 16, frames)
    puthex(SCR2 + 16 * 40 + 14, writes + 1)
    puthex(SCR2 + 16 * 40 + 16, writes)
    puthex(SCR2 + 17 * 40 + 14, stray + 1)
    puthex(SCR2 + 17 * 40 + 16, stray)
    pla
    tay
    pla
    tax
    pla
    rti

// ---------------------------------------------------------------
ahi:  .fill NB, >addrs.get(i)
esum: .fill NB, sums.get(i)
exor: .fill NB, xors.get(i)
rlo:  .fill NB, <(SCR0 + (3 + i) * 40)
rhi:  .fill NB, >(SCR0 + (3 + i) * 40)

.encoding "petscii_upper"
t_inst:    .text "INSTALLER"
t_inst_end:
.encoding "screencode_upper"
t_title:   .text "BITFIRE VIC BANK SWITCH WHILE LOADING"
           .byte 0
t_mode:    .text "MODE "
           .byte $30 + MODE
.if (MODE == 0) {
           .text " STA $DD00"
}
.if (MODE == 1) {
           .text " RMW $DD00"
}
.if (MODE == 2) {
           .text " STA $DD02"
}
           .byte 0
t_pal:     .text "PAL"
           .byte 0
t_ntsc:    .text "NTSC"
           .byte 0
t_head:    .text "FN ADDR SUM   XOR   RESULT"
           .byte 0
t_loading: .text "LOADING"
           .byte 0
t_loaded:  .text "LOADED "
           .byte 0
t_half:    .text "THIS HALF IS VIC BANK 2 ($8400)"
           .byte 0
t_frames:  .text "LOAD FRAMES  $"
           .byte 0
t_writes:  .text "BANK WRITES  $"
           .byte 0
t_stray:   .text "WRONG BANK   $"
           .byte 0
t_allok:   .text "ALL 8 FILES MATCH"
           .byte 0
t_fail:    .text "CHECKSUM MISMATCH"
           .byte 0
```

## Build

This needs Bitfire's tools as well as KickAssembler. Neither the tools nor
the disk they write are part of this repository. Build them from the
source at https://github.com/bboxy/bitfire; `make` in its root needs a C
compiler and ACME 0.97, and writes `d64write/d64write`, `loader/installer`
and `packer/dali/dali` (tested at commit `5a3964b`, 2026-09-10, on macOS).

`loader/installer` is a PRG that loads at `$1000`. The same build writes
`loader/loader_kickass.inc`, whose `bitfire_install_` (`$1000`) and
`bitfire_loadraw_` (`$F038`) are the two constants the listing copies for
the default `config.inc` (resident part at `$F000`, zero page `$02`-`$0C`).
Then:

```bash
java -jar $KICKASS_JAR bitfire-dd00-bank.asm -o bitfire-dd00-bank.prg :mode=0
cp bitfire/loader/installer installer
bitfire/d64write/d64write -c bitfire-dd00-bank.d64 -h "bitfire dd00" -i c64kb \
  --boot bitfire-dd00-bank.prg -s installer \
  -b blk0.prg -b blk1.prg -b blk2.prg -b blk3.prg \
  -b blk4.prg -b blk5.prg -b blk6.prg -b blk7.prg
x64sc -default -warp +sound +autostart-delay-random \
  -limitcycles 40000000 -exitscreenshot bitfire-dd00-bank.png \
  -autostart bitfire-dd00-bank.d64
```

KickAssembler writes the test PRG and, from the eight `outPrg` segments,
`blk0.prg`-`blk7.prg`. `d64write` puts the test in the directory track as
the boot file, the installer as a standard file named `INSTALLER`, and the
eight data files in Bitfire's own format with no directory entry: they
are numbered 0-7 in the order of the `-b` options, and each takes 17
blocks. `-autostart` on the D64 loads and runs the directory's first
entry, the test. Add `-model ntsc` for the NTSC run. `:mode=1` and
`:mode=2` build the other two variants; rebuild the disk after each.

## Expected output

Mode 0, PAL:

```
BITFIRE VIC BANK SWITCH WHILE LOADING
MODE 0 STA $DD00                    PAL
FN ADDR SUM   XOR   RESULT
F0 2000 2E/2E CC/CC OK
F1 3000 FD/FD 07/07 OK
F2 4000 A0/A0 B0/B0 OK
F3 5000 EF/EF BD/BD OK
F4 6000 49/49 59/59 OK
F5 7000 0B/0B 27/27 OK
F6 A000 8A/8A 60/60 OK
F7 B000 68/68 96/96 OK


THIS HALF IS VIC BANK 2 ($8400)

LOAD FRAMES  $0154
BANK WRITES  $02A9
WRONG BANK   $0000

ALL 8 FILES MATCH
```

The border is green. Rows 0-11 come from the bank 0 screen and rows 13-24
from the bank 2 screen, and neither half shows the other screen's marker
digits. `SUM` and `XOR` are the loaded bytes' 8-bit sum and XOR, each
beside the value KickAssembler computed. The data are the same 32 KB as
`sparkle-dd02-bank`'s, so the expected values are the same.

The three modes, measured on the windowless x64sc build of VICE 3.10 with
the command above (rung 1). Every character cell was decoded against the
character ROM by a script; two runs of mode 0 per model gave
byte-identical screenshots.

| Mode | Bank switch in the interrupt | Model | Load frames | Bank writes | Wrong bank | Files |
|---|---|---|---|---|---|---|
| 0 | `LDA #3-bank : STA $DD00` | PAL | 340 | 681 | 0 | all 8 match |
| 0 | same | NTSC | 408 | 817 | 0 | all 8 match |
| 1 | `LDA $DD00 : AND #$FC : ORA #3-bank : STA $DD00` | PAL | 14 | 29 | 0 | all 8 wrong |
| 1 | same | NTSC | 15 | 30 | 0 | all 8 wrong |
| 2 | `LDA #$3C+bank : STA $DD02` (Sparkle's rule) | PAL | not visible | not visible | not visible | all 8 wrong |
| 2 | same | NTSC | not visible | not visible | not visible | all 8 wrong |

Mode 0 loads the 32,768 bytes in 340 PAL frames, 6,683,040 cycles or
6.78 s, about 4.8 kB/s with two bank switches a frame. NTSC takes 408
frames of 17,095 cycles, 6.82 s. The seconds are rung 3, from the
measured frame counts. The files are loaded raw, not packed.

Mode 1 does not hang. Every load returns, all eight in 14 frames, and
every file's sum and XOR are wrong. A `trace store dd00` run of the PAL
build to cycle 18,000,000 logged what the interrupt stored, during the
loads and in the frames after them: of 156 stores, 125 were `$8B` or
`$89`, which set bit 3 as well as the bank bits; the rest were `$43`,
`$41`, `$C3` and `$C1`.

Mode 2 fails both ways. Every file is wrong, and the lower half shows bank
0's marker digits, so the `$DD02` writes never selected bank 2. The
counters are on the bank 2 screen, so they are not visible.

The pictures are `../../figures/bitfire-dd00-bank-mode0-pal.png`,
`../../figures/bitfire-dd00-bank-mode0-ntsc.png`,
`../../figures/bitfire-dd00-bank-mode1-pal.png` and
`../../figures/bitfire-dd00-bank-mode2-pal.png`.

**Not pinned.** The listing gate assembles the source, but the verifier
cannot pin this run in `runs.json`: it can only attach a freshly formatted
blank disk, and this program has to boot from the D64 that `d64write`
writes. The pictures are therefore under `docs/figures/`, and the command
above made them, at 40,000,000 cycles.

## Why this works

Bitfire clocks the transfer with `$DD02`, not `$DD00`. Its receive loop in
`loader/resident.asm` stores `$37` and `$3F` to `$DD02` in turn, which
switches bit 3 (ATN out) between input and output, and it only reads
`$DD00`. The `$DD00` output latch must therefore hold 0 in bits 3-5, so
that making ATN an output drives it and making it an input releases it.
Bits 0-1 are outputs in both values, so the latch's bits 0-1 are the VIC
bank, and a plain store of `$00`-`$03` changes the bank and nothing else.
That is mode 0: 681 bank writes during the loads, no wrong bank and no
wrong byte. The C64 clocks the loop, so an interrupt between two `$DD02`
writes only delays the transfer; the drive waits.

A read-modify-write reads the pins, not the latch. While the loader has
bit 3 set to input, that pin reads 1, and the interrupt writes the 1 back
into the latch: the traced `$8B` and `$89`. From the loader's next `$3F`
store on, ATN is driven where the protocol expects it released, and the
received bits are wrong. The loader does not detect it and returns with
the wrong bytes.

Sparkle's rule (mode 2) writes `$3C` or `$3E` to the `$DD02` the loader
clocks with, which makes ATN, CLK and DATA outputs in the middle of its
handshake. It cannot select the bank either: Bitfire never writes
`$DD00`, so the latch keeps the `$C3` the KERNAL left there (bits 0-1
both 1), and an output or an input bit 1 both read 1, bank 0.

The two loaders' rules are opposite. Sparkle drives the bus through
`$DD00` and takes the bank from `$DD02`; Bitfire drives the bus through
`$DD02` and takes the bank from `$DD00`. A program that changes loader
must change its bank switch too.
