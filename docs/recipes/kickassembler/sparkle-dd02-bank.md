---
recipe: sparkle-dd02-bank
toolchain: kickassembler
output_format: D64
region: both
techniques: [sparkle_irq_loader]
file_formats: [PRG, D64]
uses_registers: [D011, D012, D018, D019, D01A, D020, D021, DC0D, DD00, DD02, DD0D]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler Sparkle Loader with a $DD02 VIC-Bank Switch

## Synopsis

Load eight bundles with the Sparkle loader while a raster interrupt
switches the VIC bank twice a frame, and check every bundle by checksum.
The Sparkle 3.4 manual says to select the bank with `LDA #$3C+bank : STA
$DD02` and never to write `$DD00` (pp. 20-21). This recipe runs that rule
in VICE with true drive emulation, and runs the two usual `$DD00` forms
beside it. SparkleCPP (Sparta/OMG, BSD 3-Clause) builds the disk: bundle 0
is the test program, and bundles 1-8 are 4 KB each of LFSR bytes, loaded
to `$2000`-`$7FFF` and `$A000`-`$BFFF`. The interrupt shows VIC bank 0
(screen `$0400`) above raster line 150 and bank 2 (screen `$8400`) below
it. Each screen fills the other bank's half with a marker digit, so a
missed bank switch shows on the picture. The interrupt also reads `$DD00`
bits 0-1 before each switch, which is the bank the VIC is using, and
counts every read that is not the bank it set. When the loads finish, the
program adds and XORs each bundle and compares both with values
KickAssembler computed from the same generator. The technique is
`sparkle_irq_loader` on `../../techniques/loaders-packers.md`. The pitfall
is `fastloader_dd00_write_corrupts_resident` on `../../pitfalls/loader.md`.

## Source

```asm
// sparkle-dd02-bank.asm
// KickAssembler 5.25 writes sparkle-dd02-bank.prg (bundle 0, the test)
// and sparkle-data.prg (the data the other eight bundles are cut from).
// SparkleCPP then builds the disk from sparkle-dd02-bank.sls.
// :mode=0 switches the VIC bank with STA $DD02 (the Sparkle way),
// :mode=1 with LDA $DD00 : AND #$FC : ORA : STA $DD00,
// :mode=2 with a plain LDA #bank : STA $DD00.
.encoding "screencode_upper"

.var MODE = 0
.if (cmdLineVars.containsKey("mode")) {
    .eval MODE = cmdLineVars.get("mode").asNumber()
}

.const Sparkle_LoadNext   = $021c      // Sparkle.inc, SparkleCPP
.const Sparkle_NTSC_Check = $01b7      // $DD on PAL, $DC on NTSC

.const SCR0  = $0400                   // screen in VIC bank 0
.const SCR2  = $8400                   // screen in VIC bank 2
.const NB    = 8                       // data bundles
.const BLK   = $1000                   // bytes per bundle
.const TOP   = $10                     // IRQ line: bank 0 from here (border)
.const SPLIT = $96                     // IRQ line 150: bank 2 from here (blank row 12)

.var addrs = List().add($2000, $3000, $4000, $5000, $6000, $7000, $a000, $b000)

// zero page ($02-$04 belong to the loader)
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

// ---------------------------------------------------------------
// The data: 16-bit Galois LFSR bytes, and each block's sum and XOR
// ---------------------------------------------------------------
.segmentdef Data [outPrg="sparkle-data.prg"]
.segment Data
.var sums = List()
.var xors = List()
.var lfsr = $ace1
.for (var b = 0; b < NB; b++) {
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
.segment Default

// ---------------------------------------------------------------
.macro bank(b) {
    .if (MODE == 0) {
        lda #$3c + b                   // the Sparkle manual's formula
        sta $dd02
    }
    .if (MODE == 1) {
        lda $dd00                      // the usual read-modify-write
        and #$fc
        ora #3 - b
        sta $dd00
    }
    .if (MODE == 2) {
        lda #3 - b                     // a plain store
        sta $dd00
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

* = $1000 "Main"
start:
    sei
    lda #$7f
    sta $dc0d
    sta $dd0d
    lda $dc0d
    lda $dd0d
    .if (MODE != 0) {
        lda #$3f                       // bits 0-1 output, as the KERNAL leaves it
        sta $dd02
    }
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
    lda Sparkle_NTSC_Check
    cmp #$dc
    beq ntsc
    puts(SCR0 + 40 + 36, t_pal)
    jmp vid
ntsc:
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
rowlp:                                 // "B0 2000 LOADING" for every bundle
    stx cur
    jsr rowptr
    ldy #0
    lda #$02
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
    jsr Sparkle_LoadNext               // blocks; the IRQ keeps switching banks
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
    lda $01
    pha
    lda #$35
    sta $01
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
    sta $01
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

t_title:   .text "SPARKLE VIC BANK SWITCH WHILE LOADING"
           .byte 0
t_mode:    .text "MODE "
           .byte $30 + MODE
.if (MODE == 0) {
           .text " STA $DD02"
}
.if (MODE == 1) {
           .text " RMW $DD00"
}
.if (MODE == 2) {
           .text " STA $DD00"
}
           .byte 0
t_pal:     .text "PAL"
           .byte 0
t_ntsc:    .text "NTSC"
           .byte 0
t_head:    .text "BN ADDR SUM   XOR   RESULT"
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
t_allok:   .text "ALL 8 BUNDLES MATCH"
           .byte 0
t_fail:    .text "CHECKSUM MISMATCH"
           .byte 0
```

## Build

This needs the Sparkle PC tool as well as KickAssembler. Neither the tool
nor the disk it writes is part of this repository. Build the tool from its
source; it needs `make` and `g++` (tested with Sparkle 3.4.260829 on
macOS):

```bash
git clone --depth 1 https://github.com/spartaomg/SparkleCPP
make -C SparkleCPP            # writes SparkleCPP/bin/macos/sparkle (bin/linux on Linux)
```

Save this loader script as `sparkle-dd02-bank.sls` beside the source.
Sparkle wants a TAB between an entry's name and its values. A blank line
starts a new bundle, so this script makes nine bundles: the test program,
then eight 4 KB pieces of `sparkle-data.prg`, each cut out by address
(`-` first, then the first and last address):

```text
Path:	"sparkle-dd02-bank.d64"
Header:	sparkle dd02
ID:	c64kb
Name:	sparkle dd02
Start:	1000
ProdID:	0c64cb

File:	"sparkle-dd02-bank.prg"

File:	"sparkle-data.prg"	-	2000	2fff

File:	"sparkle-data.prg"	-	3000	3fff

File:	"sparkle-data.prg"	-	4000	4fff

File:	"sparkle-data.prg"	-	5000	5fff

File:	"sparkle-data.prg"	-	6000	6fff

File:	"sparkle-data.prg"	-	7000	7fff

File:	"sparkle-data.prg"	-	a000	afff

File:	"sparkle-data.prg"	-	b000	bfff
```

Then:

```bash
java -jar $KICKASS_JAR sparkle-dd02-bank.asm -o sparkle-dd02-bank.prg :mode=0
SparkleCPP/bin/macos/sparkle sparkle-dd02-bank.sls
x64sc -default -warp +sound +autostart-delay-random -drive8truedrive \
  -limitcycles 20000000 -exitscreenshot sparkle-dd02-bank.png \
  -autostart sparkle-dd02-bank.d64
```

KickAssembler writes both PRGs: `sparkle-data.prg` comes from the `Data`
segment's `outPrg`. Sparkle packs the nine bundles into 112 blocks and
writes a D64 whose directory entry loads its installer. `-autostart` on
the D64 loads and runs that entry. `-drive8truedrive` is already the
default in x64sc 3.10; it is written out because the loader runs its own
code in the emulated 1541 and does nothing without it. Add `-model ntsc`
for the NTSC run. `:mode=1` and `:mode=2` build the two `$DD00` variants;
rebuild the disk after each.

## Expected output

Mode 0, PAL:

```
SPARKLE VIC BANK SWITCH WHILE LOADING
MODE 0 STA $DD02                    PAL
BN ADDR SUM   XOR   RESULT
B0 2000 2E/2E CC/CC OK
B1 3000 FD/FD 07/07 OK
B2 4000 A0/A0 B0/B0 OK
B3 5000 EF/EF BD/BD OK
B4 6000 49/49 59/59 OK
B5 7000 0B/0B 27/27 OK
B6 A000 8A/8A 60/60 OK
B7 B000 68/68 96/96 OK


THIS HALF IS VIC BANK 2 ($8400)

LOAD FRAMES  $0105
BANK WRITES  $020B
WRONG BANK   $0000

ALL 8 BUNDLES MATCH
```

The border is green. Rows 0-11 come from the bank 0 screen and rows
13-24 from the bank 2 screen. Neither half shows the other screen's
marker digits, so the bank changed at line 150 and again at line 16 in
every frame of the picture. `SUM` and `XOR` are the loaded bytes' 8-bit
sum and XOR, each beside the value KickAssembler computed.

The three modes, measured on the windowless x64sc build of VICE 3.10 with
the command above (rung 1). Two runs per model and mode gave byte-identical
screenshots, and every character cell was decoded against the character
ROM:

| Mode | Bank switch in the interrupt | Model | Load frames | Bank writes | Wrong bank | Bundles |
|---|---|---|---|---|---|---|
| 0 | `LDA #$3C+bank : STA $DD02` | PAL | 261 | 523 | 0 | all 8 match |
| 0 | same | NTSC | 312 | 625 | 0 | all 8 match |
| 1 | `LDA $DD00 : AND #$FC : ORA #3-bank : STA $DD00`, `$DD02` = `$3F` | PAL | 261 | 523 | 400 | all 8 match |
| 1 | same | NTSC | 312 | 625 | 468 | all 8 match |
| 2 | `LDA #3-bank : STA $DD00`, `$DD02` = `$3F` | PAL | 538 when the run stopped | 1,077 | 1 | bundle 1 never returns |
| 2 | same | NTSC | 599 when the run stopped | 1,199 | 1 | bundle 1 never returns |

Mode 0 loads the 32,768 bytes in 261 PAL frames, 5,130,216 cycles or
5.21 s, about 6.3 kB/s with two bank switches a frame. NTSC takes 312
frames of 17,095 cycles, also 5.21 s (rung 3 from the measured frame
counts). The data packs to 108 blocks.

Mode 1 loads every bundle correctly but shows the wrong bank. In 400 of
the 523 PAL checks (76 %) the VIC was reading bank 3, `$C000`-`$FFFF`,
not the bank the last interrupt had set. Its final picture looks like
mode 0's, because the loads have ended by then; the damage is only
visible while a load runs.

Mode 2 hangs in the first data bundle. On both models the monitor log of a traced run
(`-monlog`, `trace exec 8:eaa0`) shows the 1541 entering its ROM reset
routine at `$EAA0` a second time, after the test program started and before its first
`Sparkle_LoadNext`: the interrupt's stores reset the drive between
loader calls, before any load began. The loader then
waits forever for a drive running DOS. A second build that stored to
`$DD00` only while a load was running (PAL) hung in bundle 1 too; that
run was not traced.

The pictures are `../../figures/sparkle-dd02-bank-mode0-pal.png`,
`../../figures/sparkle-dd02-bank-mode0-ntsc.png`,
`../../figures/sparkle-dd02-bank-mode1-pal.png` and
`../../figures/sparkle-dd02-bank-mode2-pal.png`.

**Not pinned.** The listing gate assembles the source, but the verifier
cannot pin this run in `runs.json`. It can only attach a freshly formatted
blank disk, and this program has to boot from the D64 that the Sparkle
tool writes. The pictures are therefore under `docs/figures/`, and the
command above is the one that made them. They were taken at 20,000,000
cycles; a PAL run stopped at 16,000,000 already shows
the mode 0 verdict, an NTSC run does not.

## Why this works

Sparkle's loader talks to the drive by writing whole bytes to `$DD00`, and
it always writes 0 in bits 0-1. The VIC bank bits are therefore decided by
`$DD02`. A bank bit set to output drives the latch's 0. A bank bit set to
input floats high and reads 1. `$3C+bank` sets the bank bits to the
inverted pattern the VIC expects (`$3C` = both inputs = `%11` = bank 0;
`$3E` = `%01` = bank 2), and keeps bits 3-5 (ATN, CLK and DATA out) as
outputs, as the loader needs. So an interrupt can write `$DD02` in the
middle of a byte transfer and change nothing on the serial bus. That is
the mode 0 result: 523 bank writes during the loads, no wrong bank and no
bad byte. The manual prescribes the formula; the reason it holds while a
load runs is read from `sl.asm` in SparkleCPP (`$DD00` is written with
`#$08`, `#$C0` or `#$X0` in the receive loop) and confirmed by the run.

Mode 1 follows the usual rule for a `$DD00` bank switch: make bits 0-1
outputs and write the inverted bank into them. The loader's next write to
`$DD00` puts 0 back in both bits, so the VIC is in bank 3 until the next
interrupt. The serial bits survive, because the interrupt writes back the
value it has just read.

Mode 2 changes the serial bits as well. The drive code waits between
loader calls in a loop that reads ATN (`ChkLines` in `sd.asm`). Released
ATN means the C64 was reset, and the drive then jumps through `$FFFC` to
its own reset. `#$03` and `#$01` have bit 3 clear, which releases ATN, so
the first interrupt resets the drive. This is the "premature reset of the
drive" the manual warns about (p. 21).
