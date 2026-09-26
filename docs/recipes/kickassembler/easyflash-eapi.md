---
recipe: easyflash-eapi
toolchain: kickassembler
output_format: CRT
region: both
techniques: [cartridge_save, cartridge_bank_easyflash]
file_formats: [CRT]
uses_registers: [DE00, DE02, DC04, DC05, DC06, DC07, DC0E, DC0F, D011, D016, D018, D020, D021]
uses_kernal: []
devices: [easyflash]
claims: [expansion_io1 (owns), expansion_io2 (owns), zero_page $02-$08+$FB-$FE (owns)]
claims_basis: derived-listing
ram: [screen=$0400-$07E7, main=$0800-$0FFF, eapi=$C000-$C2FF, colour=$D800-$DBE7]
harness: [cia1_timer_a, cia1_timer_b, $02FF]
---

<!-- doc-type: recipe -->

# KickAssembler EasyFlash Save Through EAPI

## Synopsis

An EasyFlash cartridge that saves to its own flash through EAPI, the
EasyFlash project's flash driver, rather than sending the flash chip's
commands itself as `easyflash-save` does. The listing emits the whole
`.crt` in the layout EasyProg expects: the boot code in bank 0 ROMH, a
768-byte EAPI slot at offset `$1800` (EasyFlash address `00:1:1800`), the
cartridge name at `00:1:1B00`, and an erased bank 8 ROML packet for the
save area. A build step outside the listing puts the driver into the
slot. Each boot copies EAPI to `$C000`, calls EAPIInit, and appends an
8-byte record to bank 8 with EAPISetPtr and EAPIWriteFlashInc, erasing
the 64 KB sector with EAPIEraseSector only when bank 8 is not yet
formatted. It reads the record back with EAPISetLen and
EAPIReadFlashInc, times each call, and shows `VERIFY PASS` on a green
border. Use it when a released cartridge must save: EasyProg replaces the
driver in the slot with the one for the flash chip actually fitted, which
code that sends Am29F040 commands itself cannot get.

## Source

```asm
// easyflash-eapi.asm: an EasyFlash cartridge that saves through EAPI, the
// EasyFlash flash driver, instead of sending flash commands itself.
// The listing emits the whole .crt: header, bank 0 ROMH (boot code, the
// 768-byte EAPI slot at offset $1800, the cartridge name at $1B00) and an
// erased bank 8 ROML for the save area. The EAPI slot is left $FF here; the
// Build section patches the driver into it (it is not part of this listing).
// Each boot: copy EAPI to $C000, EAPIInit, find the newest 8-byte record in
// bank 8, erase the sector if it is not formatted, append a record with
// EAPIWriteFlashInc and read it back with EAPIReadFlashInc.

.const EF_BANK   = $de00
.const EF_CTRL   = $de02
.const MODE16K   = $07            // M|X|G: ROML $8000, ROMH $A000
.const SAVE_BANK = 8              // ROML banks 8-15 = flash sector 1
.const SCREEN    = $0400
.const RUNADDR   = $0800          // $0000-$0FFF is the RAM Ultimax mode leaves
.const EAPI_ROM  = $b800          // 00:1:1800 as seen in 16K mode
.const EAPI_RAM  = $c000          // page aligned, in $C000-$CFFF as EAPI requires
.const EAPIInit  = EAPI_RAM + 20
.const EAPIEraseSector   = $df83
.const EAPISetBank       = $df86
.const EAPISetPtr        = $df8c
.const EAPISetLen        = $df8f
.const EAPIReadFlashInc  = $df92
.const EAPIWriteFlashInc = $df95
.const RECLEN    = 8
.const VERDICT   = $02ff

.const scr  = $fb                 // screen pointer
.const ptr  = $fd                 // slot pointer
.const t0   = $02                 // 4 bytes: elapsed cycles
.const last = $06                 // newest committed slot's count, 0 = none
.const cnt  = $07
.const bad  = $08

.segmentdef Main [start=RUNADDR]
.segmentdef Romh [start=$e000, min=$e000, max=$ffff, fill, fillByte=$ff]
.segmentdef Crt  [start=0, outBin="easyflash-eapi.crt"]
.segment Crt

// ---- CRT header (64 bytes, big-endian fields) ----
.encoding "ascii"
        .text "C64 CARTRIDGE   "
        .byte 0,0,0,$40           // header length
        .byte 1,0                 // version 1.0
        .byte 0,32                // hardware type 32 = EasyFlash
        .byte 1,0                 // EXROM inactive, GAME active: Ultimax boot
        .fill 6,0
        .text "EAPI SAVE"
        .fill 32-9,0
// ---- CHIP packet: bank 0 ROMH (seen at $E000 in Ultimax, $A000 in 16K) ----
        .text "CHIP"
        .byte 0,0,$20,$10         // packet length $2010
        .byte 0,2                 // chip type 2 = flash
        .byte 0,0                 // bank 0
        .byte $a0,$00             // load address $A000 = ROMH
        .byte $20,$00             // 8 KB
        .segmentout [segments="Romh"]
// ---- CHIP packet: bank 8 ROML, the save area, shipped erased ----
        .text "CHIP"
        .byte 0,0,$20,$10
        .byte 0,2
        .byte 0,SAVE_BANK
        .byte $80,$00             // load address $8000 = ROML
        .byte $20,$00
        .fill $2000,$ff

.segment Romh
reset:  sei
        cld
        ldx #$ff
        txs
        lda #$2f
        sta $00
        lda #$37
        sta $01
        ldx #0
copy:   .for (var p = 0; p < 8; p++) {
        lda image + p*$100,x
        sta RUNADDR + p*$100,x
        }
        inx
        bne copy
        jmp RUNADDR
image:  .segmentout [segments="Main"]
nmi:    rti

        * = $f800 "EAPI slot, 00:1:1800"
        .fill $300, $ff           // the driver goes here (Build section)
        * = $fb00 "cartridge name, 00:1:1B00"
        .byte $65, $66, $2d, $6e, $41, $4d, $45, $3a     // "EF-Name:" in PETSCII
.encoding "petscii_mixed"
        .text "EAPI Save"
        .fill 16-9, 0
        * = $fffa
        .word nmi, reset, nmi

.segment Main
.encoding "screencode_mixed"
main:   lda #MODE16K
        sta EF_CTRL
        lda #0
        sta EF_BANK
        sta bad
        sta VERDICT
        jsr screen_init
        ldx #0
        jsr at
        ldx #<s_title
        ldy #>s_title
        jsr print

        // ---- 1. copy EAPI from 00:1:1800 to RAM and check its signature ----
        ldx #0
ecopy:  lda EAPI_ROM,x
        sta EAPI_RAM,x
        lda EAPI_ROM+$100,x
        sta EAPI_RAM+$100,x
        lda EAPI_ROM+$200,x
        sta EAPI_RAM+$200,x
        inx
        bne ecopy
        ldx #3
esig:   lda EAPI_RAM,x
        cmp eapi_sig,x
        bne noeapi
        dex
        bpl esig
        ldx #1
        jsr at
        ldx #<s_eapi
        ldy #>s_eapi
        jsr print
        ldx #0                    // the 16-byte PETSCII version string
ever:   lda EAPI_RAM+4,x
        beq everd
        jsr petscii_out
        inx
        cpx #16
        bne ever
everd:
        // ---- 2. EAPIInit ----
        jsr timer_start
        jsr EAPIInit
        php
        sta dev
        stx mfr
        sty banks
        jsr timer_stop
        plp
        bcc initok
        ldx #2
        jsr at
        ldx #<s_initfail
        ldy #>s_initfail
        jsr print
        lda dev
        jsr hex
        jmp fail
noeapi: ldx #1
        jsr at
        ldx #<s_noeapi
        ldy #>s_noeapi
        jsr print
        jmp fail
initok: ldx #2
        jsr at
        ldx #<s_init
        ldy #>s_init
        jsr print
        lda mfr
        jsr hex
        ldx #<s_dev
        ldy #>s_dev
        jsr print
        lda dev
        jsr hex
        ldx #<s_banks
        ldy #>s_banks
        jsr print
        lda banks
        jsr hex
        ldx #3
        jsr at
        ldx #<s_tinit
        ldy #>s_tinit
        jsr print
        jsr show_t0

        // ---- 3. is bank 8 formatted? signature in its first 4 bytes ----
        lda #SAVE_BANK
        jsr EAPISetBank           // takes effect for reads at $8000 at once
        ldx #3
fsig:   lda $8000,x
        cmp save_sig,x
        bne format
        dex
        bpl fsig
        ldx #4
        jsr at
        ldx #<s_noerase
        ldy #>s_noerase
        jsr print
        jmp scan
format: jsr timer_start
        lda #SAVE_BANK
        ldy #$80                  // $80 = the ROML chip
        jsr EAPIEraseSector
        php
        jsr timer_stop
        plp
        bcc !+
        jmp fail
!:
        ldx #4
        jsr at
        ldx #<s_erase
        ldy #>s_erase
        jsr print
        jsr show_t0
        lda #$b0                  // wrap within ROML banks
        ldx #<$8000
        ldy #>$8000
        jsr EAPISetPtr
        ldx #0
wsig:   lda save_sig,x
        jsr EAPIWriteFlashInc
        bcc !+
        jmp fail
!:
        inx
        cpx #4
        bne wsig

        // ---- 4. find the newest committed record and the first free slot ----
scan:   lda #0
        sta last
        lda #<$8008
        sta ptr
        lda #>$8008
        sta ptr+1
scanlp: ldy #RECLEN-1
        lda (ptr),y
        bne notrec                // commit byte $00 = complete record
        ldy #0
        lda (ptr),y
        sta last
        jmp next
notrec: cmp #$ff
        beq freeslot              // commit byte still $FF: the first free slot
next:   lda ptr
        clc
        adc #RECLEN
        sta ptr
        bcc scanlp
        inc ptr+1
        lda ptr+1
        cmp #$a0
        bne scanlp
        jmp fail                  // bank full: a game would erase and start again
freeslot:
        ldx last
        inx
        stx cnt
        // the record: count, "EAPI", count EOR $FF, $5A, commit $00
        stx rec
        txa
        eor #$ff
        sta rec+5
        ldx #5
        jsr at
        ldx #<s_boot
        ldy #>s_boot
        jsr print
        lda cnt
        jsr hex
        ldx #<s_at
        ldy #>s_at
        jsr print
        lda ptr+1
        jsr hex
        lda ptr
        jsr hex

        // ---- 5. write it with EAPISetPtr + EAPIWriteFlashInc ----
        jsr timer_start
        lda #$b0
        ldx ptr
        ldy ptr+1
        jsr EAPISetPtr
        ldx #0
wrec:   lda rec,x
        jsr EAPIWriteFlashInc
        bcc !+
        jmp fail
!:
        inx
        cpx #RECLEN
        bne wrec
        jsr timer_stop
        ldx #6
        jsr at
        ldx #<s_write
        ldy #>s_write
        jsr print
        jsr show_t0

        // ---- 6. read it back with EAPISetLen + EAPIReadFlashInc ----
        lda #$b0
        ldx ptr
        ldy ptr+1
        jsr EAPISetPtr
        ldx #RECLEN
        ldy #0
        lda #0
        jsr EAPISetLen
        ldx #0
rrec:   jsr EAPIReadFlashInc
        cmp rec,x
        beq rok
        inc bad
rok:    inx
        cpx #RECLEN
        bne rrec
        jsr EAPIReadFlashInc      // one more: the length is used up, C = EOF
        lda #0
        rol
        sta eof
        ldx #7
        jsr at
        ldx #<s_read
        ldy #>s_read
        jsr print
        lda bad
        jsr hex
        ldx #<s_eof
        ldy #>s_eof
        jsr print
        lda eof
        jsr hex
        lda bad
        beq !+
        jmp fail
!:
        lda eof
        bne !+
        jmp fail
!:
        lda #1
        sta VERDICT
        lda #5
        sta $d020
        ldx #9
        jsr at
        ldx #<s_pass
        ldy #>s_pass
        jsr print
halt:   jmp halt

fail:   lda #2
        sta $d020
        ldx #9
        jsr at
        ldx #<s_fail
        ldy #>s_fail
        jsr print
        jmp halt

// ---- timing: CIA 1 timer A counts cycles, timer B counts its underflows ----
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
        sta $dc0e
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
show_t0:
        lda t0+2
        jsr hex
        lda t0+1
        jsr hex
        lda t0
        jsr hex
        ldx #<s_cyc
        ldy #>s_cyc
        jmp print

// ---- screen output (no KERNAL: a cartridge boot never initialised it) ----
screen_init:
        lda #$1b
        sta $d011
        lda #$08
        sta $d016
        lda #$17                  // screen $0400, lower/upper case set
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
print:  stx pp+1
        sty pp+2
        ldy #0
pp:     lda $ffff,y
        beq pdone
        sta (scr),y
        iny
        bne pp
pdone:  tya
        clc
        adc scr
        sta scr
        bcc !+
        inc scr+1
!:      rts
petscii_out:                      // PETSCII in A to a screen code at (scr)
        cmp #$c0
        bcc !+
        and #$7f                  // $C1-$DA upper case -> $41-$5A
        bne pc_put
!:      cmp #$40
        bcc pc_put                // digits, space, punctuation as they are
        and #$1f                  // $41-$5A lower case -> $01-$1A
pc_put: ldy #0
        sta (scr),y
        inc scr
        bne !+
        inc scr+1
!:      rts
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
at:     lda #<SCREEN              // x = row
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

hexd:       .text "0123456789ABCDEF"
eapi_sig:   .byte $65, $61, $70, $69          // "eapi", EasyProg's test at 00:1:1800
save_sig:   .text "EP01"
rec:        .byte 0
            .text "EAPI"
            .byte 0, $5a, $00
s_title:    .text "EasyFlash EAPI save, bank 08 ROML"
            .byte 0
s_eapi:     .text "EAPI found: "
            .byte 0
s_noeapi:   .text "NO EAPI at 00:1:1800"
            .byte 0
s_initfail: .text "EAPIInit failed, A="
            .byte 0
s_init:     .text "Init MFR "
            .byte 0
s_dev:      .text " DEV "
            .byte 0
s_banks:    .text " BANKS "
            .byte 0
s_tinit:    .text "EAPIInit        "
            .byte 0
s_noerase:  .text "Erase           none"
            .byte 0
s_erase:    .text "EraseSector     "
            .byte 0
s_boot:     .text "Boot "
            .byte 0
s_at:       .text " record at $"
            .byte 0
s_write:    .text "Write 8 bytes   "
            .byte 0
s_read:     .text "Read back, bad "
            .byte 0
s_eof:      .text " EOF "
            .byte 0
s_cyc:      .text " cycles"
            .byte 0
s_pass:     .text "VERIFY PASS"
            .byte 0
s_fail:     .text "FAIL"
            .byte 0
dev:        .byte 0
mfr:        .byte 0
banks:      .byte 0
eof:        .byte 0
```

## Build

The listing builds on its own, and the listing gate builds it, but the
cartridge it writes has an empty EAPI slot: it shows `NO EAPI at
00:1:1800` and `FAIL` on a red border, and VICE logs `EF: EAPI not
found! Are you sure this is a proper EasyFlash image?`. The driver is not
part of this page. It is `eapi-am29f040.s` from the EasyFlash SDK
(Thomas Giesel, zlib licence, which allows redistribution of the built
driver), assembled with ACME; this page used the copy in
https://github.com/KimJorgensen/easyflash (a fork of skoe's Bitbucket
repository, commit 9278c9f), directory `EasySDK/eapi`, as its own
Makefile does:

```bash
java -jar $KICKASS_JAR easyflash-eapi.asm -o easyflash-eapi.prg
# writes easyflash-eapi.crt (16,480 bytes); the .prg is empty
(cd easyflash/EasySDK/eapi && acme -o ../../../eapi-am29f040-14 eapi-am29f040.s)
# 770 bytes: load address $C000, then 768 bytes starting "eapi"
python3 patch_eapi.py easyflash-eapi.crt eapi-am29f040-14 easyflash-eapi-with-eapi.crt
cp easyflash-eapi-with-eapi.crt run.crt
x64sc -default -warp +sound +autostart-delay-random -limitcycles 8000000 \
  -easyflashcrtwrite -exitscreenshot run1.png -cartcrt run.crt
x64sc -default -warp +sound +autostart-delay-random -limitcycles 8000000 \
  -easyflashcrtwrite -exitscreenshot run2.png -cartcrt run.crt
```

Add `-model ntsc` after `-default` for NTSC. `patch_eapi.py` walks the
CRT's CHIP packets, finds bank 0 ROMH, checks that offset `$1800` holds
768 bytes of `$FF`, and copies the driver there, less its load address.
It printed `EAPI (768 bytes) at file offset $1850: bank 0 ROMH offset
$1800`:

```text
#!/usr/bin/env python3
"""patch_eapi.py in.crt eapi-binary out.crt

Put an EAPI driver (a file with a 2-byte load address, then at most 768
bytes that start with $65 $61 $70 $69) into bank 0 ROMH at offset $1800 of
an EasyFlash CRT. Walks the CHIP packets; refuses anything it does not
recognise instead of guessing."""
import struct
import sys

src, drv, dst = sys.argv[1:4]
crt = bytearray(open(src, 'rb').read())
eapi = open(drv, 'rb').read()[2:]
assert crt[:16] == b'C64 CARTRIDGE   ', 'not a CRT file'
hdr_len = struct.unpack('>I', crt[16:20])[0]
hw = struct.unpack('>H', crt[22:24])[0]
assert hw == 32, f'hardware type {hw}, not 32 (EasyFlash)'
assert eapi[:4] == b'eapi' and len(eapi) <= 0x300, 'not an EAPI driver'
pos = hdr_len
while pos < len(crt):
    assert crt[pos:pos + 4] == b'CHIP', f'no CHIP packet at {pos}'
    plen, ctype, bank, load, size = struct.unpack('>IHHHH', crt[pos + 4:pos + 16])
    if bank == 0 and load in (0xA000, 0xE000):
        at = pos + 16 + 0x1800
        assert all(b == 0xFF for b in crt[at:at + 0x300]), 'EAPI slot is not empty ($FF)'
        crt[at:at + len(eapi)] = eapi
        open(dst, 'wb').write(crt)
        print(f'EAPI ({len(eapi)} bytes) at file offset ${at:X}: bank 0 ROMH offset $1800')
        sys.exit(0)
    pos += plen
sys.exit('no bank 0 ROMH packet')
```

**Not pinned.** The verifier builds the listing and boots what it
writes; it has no step to add the driver, and the cartridge it would boot
is the failing one above. `../runs.json` therefore lists the page with a
`"skip"` key, the pictures are under `docs/figures/`, and the commands
above made them.

The frontmatter's `claims:` is read from the listing and the driver's
documented behaviour (`claims_basis: derived-listing`), not from a
`claims-watch` trace, since the watch autostarts a PRG. `expansion_io2`
is the jump table EAPIInit builds at `$DF80`; the driver's borrowed zero
page `$4B`-`$4C` is restored and not claimed.

## Expected output

Boot 1 (`../../figures/easyflash-eapi-pal.png`), every cell decoded
against the character ROM:

```text
EasyFlash EAPI save, bank 08 ROML
EAPI found: Am/M29F040 V1.4
Init MFR 01 DEV A4 BANKS 40
EAPIInit        001493 cycles
EraseSector     0F4429 cycles
Boot 01 record at $8008
Write 8 bytes   000904 cycles
Read back, bad 00 EOF 01

VERIFY PASS
```

Boot 2 (`../../figures/easyflash-eapi-pal-run2.png`) boots the `.crt`
that boot 1 wrote back: `Erase           none`, `Boot 02 record at
$8010`, `Write 8 bytes   0008D8 cycles`, the rest the same. The border is
green (98, 213, 50) both times. NTSC (`../../figures/easyflash-eapi-ntsc.png`,
`../../figures/easyflash-eapi-ntsc-run2.png`) shows the same text with
the figures in the table, on NTSC green (114, 189, 103).

| Call | PAL boot 1 | PAL boot 2 | NTSC boot 1 | NTSC boot 2 |
|---|---|---|---|---|
| EAPIInit | 5,267 | 5,267 | 5,270 | 5,270 |
| EAPIEraseSector, bank 8 ROML | 1,000,489 | not called | 1,000,446 | not called |
| EAPISetPtr + 8 × EAPIWriteFlashInc | 2,308 | 2,264 | 2,265 | 2,093 |

Cycles by CIA 1 timer A and B chained, start and stop code included.
Measured in VICE x64sc 3.10 with the commands above (rung 1); a second
pair of PAL boots from a fresh copy gave byte-identical screenshots and
an identical written-back `.crt`, and the PAL and NTSC written-back files
are identical. The erase figure is VICE's model of the chip; the
Am29F040B data sheet gives 1 s typical, 8 s maximum (not measured here).
EAPIInit reported manufacturer `$01` (AMD), device `$A4` (Am29F040) and
`$40` = 64 banks: VICE answers the chip's ID commands as that chip.

What the flash holds after two boots, decoded from the written-back
`.crt` with Python: bank 8 ROML starts `45 50 30 31` (the signature
`EP01`), then `01 45 41 50 49 FE 5A 00` at `$8008` and `02 45 41 50 49
FD 5A 00` at `$8010`, and `$FF` for the other 8,172 bytes. Bank 0 ROMH is
unchanged, EAPI included. VICE rewrote the header's name field as
`EasyFlash`; the 32-byte name in the header is not the cartridge name
the EasyFlash menu shows (that is `00:1:1B00`).

## Why this works

**The layout is EasyProg's contract.** An EasyFlash cartridge boots in
Ultimax mode from bank 0 ROMH, so the reset vector is at `00:1:1FFC`
(`$FFFC`), and in 16 KB mode the same chip is at `$A000`: the slot at
offset `$1800` is `$F800` while booting and `$B800` afterwards. EasyProg,
when it writes bank 0 ROMH from a CRT, compares offset `$1800` with `65
61 70 69` and, on a match, writes its own driver for the fitted chip into
offsets `$1800` to `$1AFF` instead of the CRT's; it reads a menu name from
offset `$1B00` when that starts with `65 66 2D 6E 41 4D 45 3A`
(`EF-Name:` in PETSCII) followed by 16 bytes (EasyProg source,
`EasyProg/src/flash.c`, `flashWriteBankFromFile`, read here, not run).
The Programmer's Guide says both that `00:1:1800`-`00:1:1BFF` is reserved
for EAPI and that the name starts at `00:1:1B00`; the EasyProg code
replaces three pages, `$1800`-`$1AFF`, which is what makes both true.
Start-up code therefore goes elsewhere: this listing's boot code and the
copied program fill `$E000`-`$E4AA` (from `-showmem`).

**EAPI runs from RAM and keeps its state in the cartridge RAM.** The
driver switches banks, so it cannot run from the flash it is switching:
the program copies the 768 bytes to `$C000` (the guide allows `$0200`-
`$7FFF` and `$C000`-`$CFFF`, page aligned) and calls EAPIInit at the copy
plus 20. EAPIInit reads the chip's IDs, returns the chip and bank count,
and builds the jump table at `$DF80` in the EasyFlash's own 256 bytes of
RAM: EAPIWriteFlash `$DF80`, EAPIEraseSector `$DF83`, EAPISetBank
`$DF86`, EAPIGetBank `$DF89`, EAPISetPtr `$DF8C`, EAPISetLen `$DF8F`,
EAPIReadFlashInc `$DF92`, EAPIWriteFlashInc `$DF95`, EAPISetSlot `$DF98`,
EAPIGetSlot `$DF9B` (driver source, V1.4). It borrows zero page `$4B`-
`$4C` and restores them. Every call that writes switches `$DE02` to
Ultimax around the write itself, so the caller stays in 16 KB mode and
the KERNAL, the screen and all of RAM stay where they are, which is the
difference from `easyflash-save`, whose writing code has to live below
`$1000`.

**The calls in this listing.** EAPISetBank with A = 8 selects bank 8 for
reads at `$8000` at once. EAPIEraseSector takes the bank in A and `$80`
(the ROML chip) in Y and erases the 64 KB sector that holds it: banks 8
to 15 of ROML. EAPISetPtr takes a wrap mode in A (`$B0`: continue in the
next ROML bank) and an address in X/Y in the `$8000`-`$BFFF` range;
EAPIWriteFlashInc then writes one byte per call and returns C set on an
error, and EAPIReadFlashInc returns one byte per call and C set once the
length given to EAPISetLen (X/Y/A, 24 bits) is used up. The listing's
ninth read returned C set, `EOF 01`. The record format (append, commit
byte last, erase only when formatting) is `cartridge_save`'s; with 8-byte
records one bank holds 1,023 of them (arithmetic).

The driver used here is the Am29F040 one, the chip VICE emulates. The
SDK ships drivers for M29W160T, MX29640B and SST39SF040 beside it, and
the guide says EasyProg's replacement is what lets one CRT run on
cartridges built with any of them (not tested here).
