---
recipe: easyflash-save
toolchain: kickassembler
output_format: CRT
region: both
techniques: [cartridge_save, cartridge_bank_easyflash]
file_formats: [CRT]
uses_registers: [DE00, DE02, DC04, DC05, DC06, DC07, DC0E, DC0F, D011, D016, D018, D020, D021]
uses_kernal: []
devices: [easyflash]
---

<!-- doc-type: recipe -->

# KickAssembler — EasyFlash high-score save in the cartridge's own flash

## Synopsis

A complete EasyFlash cartridge that keeps a five-entry high-score table in
its own flash memory. The listing emits the whole `.crt` itself (header,
a bank 0 ROMH packet with the boot code, and an erased bank 8 ROML packet
for the save area), so there is no cartconv step. Each boot reads the
newest saved record, adds a score, and appends a new 32-byte record to
bank 8 with the Am29F040 command sequences, erasing the 64 KB sector only
on first use or when the bank is full. It times the erase and the
programming with a CIA timer, checks the record against its RAM copy, and
shows `VERIFY PASS` with a green border. This is the `cartridge_save`
technique with nothing else in it; a game replaces the table with its own
save data. It does not use EAPI, so it only drives Am29F040-type flash:
see "Why this works".

## Source

```asm
// easyflash-save.asm: an EasyFlash cartridge that keeps a high-score table in
// its own flash. The whole .crt is emitted by this file (header + two CHIP
// packets); no cartconv step. The save lives in LOROM bank 8 (flash sector 1
// of the ROML chip), written with the AM29F040 command sequences directly.
// Each boot: read the newest record, add a score, append a new record.
// Build: java -jar KickAss.jar easyflash-save.asm -o easyflash-save.prg
//        (writes easyflash-save.crt beside the source; the .prg is empty)
// Run:   x64sc -easyflashcrtwrite -cartcrt easyflash-save.crt

.const EF_BANK   = $de00
.const EF_CTRL   = $de02
.const SAVE_BANK = 8              // banks 8..15 of ROML = flash sector 1
.const SCREEN    = $0400
.const RECLEN    = 32
.const CMD1      = $8555          // chip address $555 (A0-A10 decoded)
.const CMD2      = $82aa          // chip address $2AA
.const RUNADDR   = $0800          // main code runs from RAM; $0000-$0FFF is
                                  // the only RAM visible in Ultimax mode
.const MODE16K   = $07            // MODE|EXROM|GAME: ROML $8000, ROMH $A000
.const ULTIMAX   = $05            // MODE|GAME: ROML $8000, ROMH $E000, no KERNAL
.const CARTOFF   = $04

.const ptr  = $fb                 // flash slot pointer
.const scr  = $fd                 // screen pointer
.const n    = $02                 // slot being scanned
.const last = $03                 // newest valid slot, 0 = none
.const free = $04                 // first free slot after it, 0 = none
.const tmp  = $05
.const cnt  = $06
.const erased = $07               // 1 when this boot erased the sector
.const bad  = $08                 // verify failures
.const t0   = $09                 // 4 bytes: elapsed cycles, little-endian

.segmentdef Main [start=RUNADDR]         // code that runs from RAM
.segmentdef Romh [start=$e000, min=$e000, max=$ffff, fill, fillByte=$ff]
.segmentdef Crt  [start=0, outBin="easyflash-save.crt"]
.segment Crt

// ---- CRT file header (64 bytes, big-endian fields) ----
.encoding "ascii"
        .text "C64 CARTRIDGE   "
        .byte 0,0,0,$40           // header length
        .byte 1,0                 // version 1.0
        .byte 0,32                // hardware type 32 = EasyFlash
        .byte 1,0                 // EXROM inactive, GAME active: Ultimax boot
        .fill 6,0
        .text "FLASH SAVE"
        .fill 32-10,0
// ---- CHIP packet: bank 0 ROMH (seen at $E000 in Ultimax) ----
        .text "CHIP"
        .byte 0,0,$20,$10         // packet length $2010
        .byte 0,2                 // chip type 2 = flash
        .byte 0,0                 // bank 0
        .byte $a0,$00             // load address $A000 (ROMH)
        .byte $20,$00             // 8 KB
        .segmentout [segments="Romh"]
// ---- CHIP packet: bank 8 ROML, the save area, shipped erased ($FF) ----
// (EasyProg erases only the sectors a CRT contains; the boot code checks
// a signature anyway, in case the bank holds another image's bytes.)
        .text "CHIP"
        .byte 0,0,$20,$10
        .byte 0,2
        .byte 0,SAVE_BANK
        .byte $80,$00             // load address $8000 (ROML)
        .byte $20,$00
        .fill $2000,$ff
.encoding "screencode_upper"

.segment Romh
reset:  sei
        cld
        ldx #$ff
        txs
        lda #$2f
        sta $00
        lda #$37
        sta $01
        ldx #0                    // copy main code to RAM ($0800-$0FFF is
copy:   .for (var p = 0; p < 8; p++) {   // visible in Ultimax mode)
        lda image + p*$100,x
        sta RUNADDR + p*$100,x
        }
        inx
        bne copy
        jmp RUNADDR

image:  .segmentout [segments="Main"]
nmi:    rti
        * = $fffa
        .word nmi, reset, nmi

.segment Main
main:   lda #CARTOFF                // mark the RAM under the command addresses
        sta EF_CTRL
        lda #0
        sta CMD1
        sta CMD2
        lda #MODE16K
        sta EF_CTRL
        jsr screen_init
        lda #SAVE_BANK
        sta EF_BANK
        lda #0
        sta erased
        sta bad
        // ---- format check: signature in the first 4 bytes of the bank ----
        ldx #3
sig:    lda $8000,x
        cmp signature,x
        bne format
        dex
        bpl sig
        jmp scan
format: jsr erase_sector          // blank or foreign bank: erase it
        jsr write_signature
        // ---- find newest valid record and first free slot ----
scan:   lda #0
        sta last
        sta free
        lda #1
        sta n
scanlp: jsr slot_ptr
        ldy #RECLEN-1
        lda (ptr),y
        bne notvalid              // commit byte $00 = complete record
        lda n
        sta last
        lda #0
        sta free
        beq scannext
notvalid:
        lda (ptr),y               // all 32 bytes $FF = free; else torn, skip
        cmp #$ff
        bne scannext
        dey
        bpl notvalid
        lda free
        bne scannext
        lda n
        sta free
scannext:
        inc n
        bne scanlp
        // ---- load newest record or the default table ----
        ldx #RECLEN-1
        lda last
        beq usedef
        sta n
        jsr slot_ptr
        ldy #RECLEN-1
ld:     lda (ptr),y
        sta rec,y
        dey
        bpl ld
        bmi update
usedef: lda defaults,x
        sta rec,x
        dex
        bpl usedef
        // ---- this boot's score: boot number x 1250 (BCD) ----
update: inc rec                   // boot counter, stops at 255
        bne !+
        dec rec
!:
        lda #0
        sta newsc
        sta newsc+1
        sta newsc+2
        ldx rec
        sed
mul:    clc
        lda newsc+2
        adc #$50
        sta newsc+2
        lda newsc+1
        adc #$12
        sta newsc+1
        lda newsc
        adc #0
        sta newsc
        dex
        bne mul
        cld
        jsr insert
        // ---- save: append, erasing only when the bank is full ----
        lda free
        bne havefree
        jsr erase_sector
        jsr write_signature
        lda #1
havefree:
        sta n
        jsr slot_ptr
        lda #0
        sta rec+RECLEN-1          // commit byte, programmed last
        jsr timer_start
        ldy #0
prog:   lda rec,y
        jsr program_byte
        iny
        cpy #RECLEN
        bne prog
        jsr timer_stop
        ldx #3
cpp:    lda t0,x
        sta progt,x
        dex
        bpl cpp
        ldy #RECLEN-1             // verify against the RAM copy
ver:    lda (ptr),y
        cmp rec,y
        beq verok
        inc bad
verok:  dey
        bpl ver
        // ---- what the command writes left in the RAM under ROML ----
        lda #CARTOFF              // cartridge off: $8000 reads RAM
        sta EF_CTRL
        lda CMD1
        sta ram555
        lda CMD2
        sta ram2aa
        lda #MODE16K
        sta EF_CTRL
        jmp report

// slot n -> ptr = $8000 + n*32
slot_ptr:
        lda n
        asl
        asl
        asl
        asl
        asl
        sta ptr
        lda n
        lsr
        lsr
        lsr
        ora #$80
        sta ptr+1
        rts

// unlock cycles common to every command
unlock: lda #$aa
        sta CMD1
        lda #$55
        sta CMD2
        rts

// program A at (ptr),y; waits until the toggle bit stops.
// Ultimax mode for the whole command: only then do writes reach ROML.
program_byte:
        sta tmp
        lda #ULTIMAX
        sta EF_CTRL
        jsr unlock
        lda #$a0
        sta CMD1
        lda tmp
        sta (ptr),y
pwait:  lda (ptr),y               // DQ6 toggles on each read while busy
        cmp (ptr),y
        bne pwait
        lda #MODE16K
        sta EF_CTRL
        rts

// erase the 64 KB sector holding the selected bank (timed)
erase_sector:
        jsr timer_start
        lda #ULTIMAX
        sta EF_CTRL
        jsr unlock
        lda #$80
        sta CMD1
        jsr unlock
        lda #$30
        sta $8000
ewait:  lda $8000
        cmp $8000
        bne ewait
        lda #MODE16K
        sta EF_CTRL
        jsr timer_stop
        ldx #3
cpe:    lda t0,x
        sta eraset,x
        dex
        bpl cpe
        inc erased
        rts

write_signature:
        lda #<$8000
        sta ptr
        lda #>$8000
        sta ptr+1
        ldy #0
ws:     lda signature,y
        jsr program_byte
        iny
        cpy #4
        bne ws
        rts

// insert "YOU" + newsc into the 5-entry table at rec+1 (6 bytes each:
// 3 screen-code initials, 3 BCD score bytes, high byte first)
insert: ldx #0                    // entry offset 0, 6, .. 24
ilp:    lda newsc
        cmp rec+4,x
        bne idec
        lda newsc+1
        cmp rec+5,x
        bne idec
        lda newsc+2
        cmp rec+6,x
        beq inext                 // equal: the older entry stays above
idec:   bcs place                 // new > entry
inext:  txa
        clc
        adc #6
        tax
        cpx #30
        bne ilp
        rts                       // not in the top five
place:  stx tmp                   // move entries x..18 down by one row
        ldy #23
shift:  cpy tmp
        bcc put
        lda rec+1,y
        sta rec+7,y
        dey
        bpl shift
put:    ldy #0
putlp:  lda you,y                 // "YOU" then newsc, adjacent in memory
        sta rec+1,x
        inx
        iny
        cpy #6
        bne putlp
        rts

// ---- CIA1 timer A and B chained: 32-bit down-counter ----
timer_start:
        lda #0
        sta $dc0e
        sta $dc0f
        lda #$ff
        sta $dc04
        sta $dc05
        sta $dc06
        sta $dc07
        lda #$51                  // B: count A underflows, force load, start
        sta $dc0f
        lda #$11                  // A: continuous, force load, start
        sta $dc0e
        rts
timer_stop:
        lda #0
        sta $dc0e                 // stop A, then read
        lda $dc04
        eor #$ff
        sta t0
        lda $dc05
        eor #$ff
        sta t0+1
        lda $dc06
        eor #$ff
        sta t0+2
        lda $dc07
        eor #$ff
        sta t0+3
        rts

// ---- screen output ----
screen_init:
        lda #$1b
        sta $d011
        lda #$08
        sta $d016
        lda #$15
        sta $d018
        lda #0
        sta $d020
        sta $d021
        ldx #0
cls:    lda #$20
        sta SCREEN,x
        sta SCREEN+$100,x
        sta SCREEN+$200,x
        sta SCREEN+$2e8,x
        lda #1
        sta $d800,x
        sta $d900,x
        sta $da00,x
        sta $dae8,x
        inx
        bne cls
        rts

// print zero-terminated text at (scr); x:y = address of text (lo, hi)
print:  stx pp+1
        sty pp+2
        ldy #0
pp:     lda $ffff,y
        beq pdone
        sta (scr),y
        iny
        bne pp
pdone:  tya                       // advance scr past the text
        clc
        adc scr
        sta scr
        bcc !+
        inc scr+1
!:      rts

// print A as two hex digits at (scr), advance
hex:    pha
        lsr
        lsr
        lsr
        lsr
        jsr nib
        pla
        and #$0f
nib:    tax
        lda hexd,x
        ldy #0
        sta (scr),y
        inc scr
        bne !+
        inc scr+1
!:      rts

at:     // x = row
        lda #<SCREEN
        sta scr
        lda #>SCREEN
        sta scr+1
        cpx #0
        beq atd
atl:    lda scr
        clc
        adc #40
        sta scr
        bcc !+
        inc scr+1
!:      dex
        bne atl
atd:    rts

report: ldx #1
        jsr at
        ldx #<s_title
        ldy #>s_title
        jsr print
        ldx #3
        jsr at
        ldx #<s_boot
        ldy #>s_boot
        jsr print
        lda rec
        jsr hex
        ldx #<s_slot
        ldy #>s_slot
        jsr print
        lda n
        jsr hex
        ldx #5
        jsr at
        ldx #<s_erase
        ldy #>s_erase
        jsr print
        lda erased
        bne showe
        ldx #<s_none
        ldy #>s_none
        jsr print
        jmp prow
showe:  lda eraset+2
        jsr hex
        lda eraset+1
        jsr hex
        lda eraset
        jsr hex
        ldx #<s_cyc
        ldy #>s_cyc
        jsr print
prow:   ldx #6
        jsr at
        ldx #<s_prog
        ldy #>s_prog
        jsr print
        lda progt+2
        jsr hex
        lda progt+1
        jsr hex
        lda progt
        jsr hex
        ldx #<s_cyc
        ldy #>s_cyc
        jsr print
        ldx #7
        jsr at
        ldx #<s_ram
        ldy #>s_ram
        jsr print
        lda ram555
        jsr hex
        ldx #<s_ram2
        ldy #>s_ram2
        jsr print
        lda ram2aa
        jsr hex
        // table
        lda #0
        sta cnt
tab:    lda cnt
        clc
        adc #10
        tax
        jsr at
        lda #6
        clc
        adc scr
        sta scr
        ldx cnt                   // entry offset = cnt*6
        lda mul6,x
        tax
        ldy #0
ini:    lda rec+1,x
        sta (scr),y
        inx
        iny
        cpy #3
        bne ini
        lda scr
        clc
        adc #4
        sta scr
        lda rec+1,x
        jsr hex
        ldx cnt
        lda mul6,x
        tax
        lda rec+6,x
        pha
        lda rec+5,x
        jsr hex
        pla
        jsr hex
        inc cnt
        lda cnt
        cmp #5
        bne tab
        ldx #17
        jsr at
        lda bad
        bne fail
        ldx #<s_pass
        ldy #>s_pass
        jsr print
        lda #5                    // green border = pass
        sta $d020
        jmp *
fail:   ldx #<s_fail
        ldy #>s_fail
        jsr print
        lda #2                    // red border = fail
        sta $d020
        jmp *

mul6:     .byte 0,6,12,18,24
hexd:     .text "0123456789ABCDEF"
signature:.text "HS01"
you:      .text "YOU"
newsc:    .byte 0,0,0
defaults: .byte 0                 // boot counter
          .text "ACE"
          .byte $01,$00,$00
          .text "BOB"
          .byte $00,$75,$00
          .text "CAT"
          .byte $00,$50,$00
          .text "DAN"
          .byte $00,$25,$00
          .text "EVE"
          .byte $00,$10,$00
          .byte $ff               // commit byte (set to 0 when saved)
s_title:  .text "EASYFLASH SAVE  BANK 08  AM29F040"
          .byte 0
s_boot:   .text "BOOT $"
          .byte 0
s_slot:   .text "  SLOT $"
          .byte 0
s_erase:  .text "ERASE    "
          .byte 0
s_none:   .text "NONE"
          .byte 0
s_prog:   .text "PROGRAM  "
          .byte 0
s_cyc:    .text " CYCLES"
          .byte 0
s_ram:    .text "RAM $8555=$"
          .byte 0
s_ram2:   .text " $82AA=$"
          .byte 0
s_pass:   .text "VERIFY PASS"
          .byte 0
s_fail:   .text "VERIFY FAIL"
          .byte 0
eraset:   .byte 0,0,0,0
progt:    .byte 0,0,0,0
ram555:   .byte 0
ram2aa:   .byte 0
rec:      .fill RECLEN,0
mainend:
.assert "main code fits in $0800-$0FFF", mainend <= $1000, true
```

## Build

```bash
java -jar $KICKASS_JAR easyflash-save.asm -o easyflash-save.prg
# writes easyflash-save.crt (16,480 bytes) beside the source.
# The .prg named by -o is not written: the default segment is empty.
```

## Expected output

Run it twice on the same file, with VICE allowed to write the flash back:

```bash
cp easyflash-save.crt run.crt
x64sc -default -warp +sound -limitcycles 8000000 -easyflashcrtwrite \
  -exitscreenshot run1.png -cartcrt run.crt
x64sc -default -warp +sound -limitcycles 8000000 -easyflashcrtwrite \
  -exitscreenshot run2.png -cartcrt run.crt
```

Run 1 (`screenshots/easyflash-save.png`), text decoded from the PNG
against the character ROM with PIL:

```text
EASYFLASH SAVE  BANK 08  AM29F040
BOOT $01  SLOT $01
ERASE    0F42FF CYCLES
PROGRAM  000B87 CYCLES
RAM $8555=$00 $82AA=$00
      ACE 010000
      BOB 007500
      CAT 005000
      DAN 002500
      YOU 001250
VERIFY PASS
```

Run 2 (`screenshots/easyflash-save-run2.png`) boots from the `.crt` that
run 1 wrote back. It shows `BOOT $02  SLOT $02`, `ERASE    NONE`,
`PROGRAM  000B32 CYCLES`, and `YOU 002500` below `DAN 002500`: run 1's
`YOU 001250` has dropped off the table. The border is green (98, 213, 50)
in both. Measured in VICE x64sc 3.10, PAL, run twice from a fresh copy of
the built `.crt`, with byte-identical PNGs each time.

NTSC: the same two commands with `-model ntsc` after `-default`
(`screenshots/easyflash-save-ntsc.png`,
`screenshots/easyflash-save-ntsc-run2.png`) show the same text except
`ERASE    0F42D3 CYCLES` and `PROGRAM  000C33 CYCLES` in run 1 and
`PROGRAM  000BDE CYCLES` in run 2. The border is NTSC green
(114, 189, 103). Measured in VICE x64sc 3.10 (6567R8), two runs from
each of two fresh copies, byte-identical PNGs.

The figures, in decimal:

| Measurement | PAL run 1 | PAL run 2 | PAL full bank (side run) | NTSC run 1 | NTSC run 2 |
|---|---|---|---|---|---|
| Sector erase, cycles | 1,000,191 | not erased | 1,000,169 | 1,000,147 | not erased |
| Program 32 bytes, cycles | 2,951 | 2,866 | 3,122 | 3,123 | 3,038 |

The side run filled slots 3 to 255 of run 2's bank 8 with copies of a
valid record (a Python edit of the `.crt`) and booted once. The program
found no free slot, erased the sector, rewrote the signature, saved to
`SLOT $01` and showed `BOOT $FF` (the counter stops at 255) and
`VERIFY PASS`.

Every figure includes the timer's start and stop code and the mode
switches. The erase figure is VICE's model of the flash chip. The
Am29F040B datasheet gives 1 s typical and 8 s maximum for a sector erase,
and 7 µs typical and 300 µs maximum for a byte (not measured here). So on
hardware, 32 bytes take about 0.2 ms to 10 ms of chip time (arithmetic
from the datasheet), plus the code.

`RAM $8555=$00 $82AA=$00` shows that the command writes did not reach
the C64 RAM under ROML. The program zeroes both bytes with the cartridge
off, saves, turns the cartridge off again and reads them back
(VICE-measured; hardware not checked).

## Why this works

**Writes go to flash only in Ultimax mode.** EasyFlash's control
register value `$07` (16 KB mode) is how the program reads: ROML at
`$8000`. A version of this listing that wrote the command sequence in
that mode ran, but the flash never changed: the erase "finished" after
130 cycles, every verify failed, and VICE wrote back a `.crt` with no
bank 8. The same data went into the RAM under `$8000` instead (the page
showed `$8555=$A0`). EAPI, the EasyFlash flash driver, switches
`$DE02` to `$85` (Ultimax plus the LED) around every flash write,
including writes to the low chip at `$8xxx`. The listing does the same
with `$05`. In Ultimax mode only `$0000-$0FFF` of RAM is mapped, so the
code that writes runs from `$0800` and keeps its variables in zero page
and below `$1000`. The boot code copies it there from ROMH. The boot code
and its image fill bank 0 ROMH offsets `$0000-$04FB` (`$E000-$E4FB`, from
the symbol file). Offsets `$1800-$1BFF`, which the Programmer's Guide
reserves for EAPI, stay `$FF`, so EAPI can be added without moving code.

**The command sequences are the chip's.** Program: `$AA` to `$555`, `$55`
to `$2AA`, `$A0` to `$555`, then the byte to its address. Sector erase:
`$AA`/`$555`, `$55`/`$2AA`, `$80`/`$555`, `$AA`/`$555`, `$55`/`$2AA`, then
`$30` to any address in the sector (Am29F040B datasheet, Table 4). The
chip decodes only A0-A10 for the command addresses, so `$8555` and
`$82AA` work with any bank selected. The bank register supplies the upper
chip address lines: 8 banks of 8 KB make one 64 KB sector, so bank 8 is
the first bank of ROML sector 1, and erasing it also erases the ROML
halves of banks 9 to 15. Completion is detected by the toggle bit: two
reads in a row differ while the chip is busy. The datasheet says the
toggle bit is valid during the 50 µs sector-erase time-out too. The wait
loops do not check DQ5, which the datasheet sets when an operation
exceeds its time limit ("DQ5: Exceeded Timing Limits"); on a failing chip
they would spin forever. A released game should add that check or use
EAPI. Hardware failure was not tested here.

**The record format fits the erase size.** A byte can only be programmed
from 1 to 0, so a save that overwrote its record in place would need an
erase every time. Here each save programs the next free 32-byte slot.
The commit byte (the record's last) is programmed last, as `$00`. A
record counts only if its commit byte is `$00`. A slot counts as free
only if all 32 bytes are `$FF`. A slot that is neither (power lost
mid-save) is skipped, and the previous record still loads. That torn-slot
path was not exercised in these runs. With 255 slots in one bank, the
sector is erased once every 255 saves. The recipe uses only bank 8 of the
8-bank sector; using all eight banks would give about 2,047 slots per
erase (arithmetic).

Two power-cut windows remain. (a) When the bank is full, the program
erases the sector before it writes the new record, so a cut there loses
every save. (b) A cut during an erase can leave the signature and a `$00`
commit byte over half-erased data, and without a checksum the program
cannot tell. Remedies: alternate between two sectors, and add a checksum
byte to each record.

**The CRT ships the save bank erased.** The EasyFlash Programmer's Guide
says EasyProg erases only the sectors a CRT contains. So the image
includes bank 8 as `$FF`, and the boot code also checks a 4-byte
signature. A foreign signature means the bank holds someone else's bytes:
format it.

Sources: EasyFlash Programmer's Guide, Thomas Giesel,
http://skoe.de/easyflash/files/devdocs/EasyFlash-ProgRef.pdf (boot
modes, EAPI location and calls, "Game States and High Scores");
Am29F040B data sheet, AMD publication 21445,
https://instrumentation.obs.carnegiescience.edu/ccd/parts/AM29F040B.pdf
(command table, toggle bit, erase and program times); c64gameframework,
Lasse Öörni, MIT, https://github.com/cadaver/c64gameframework `efboot.s`
and `eapi-am29f040-14.bin` (the `$85` write mode read from a disassembly
of the binary; nothing copied).
