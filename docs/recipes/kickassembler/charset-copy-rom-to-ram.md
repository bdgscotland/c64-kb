---
recipe: charset-copy-rom-to-ram
toolchain: kickassembler
output_format: PRG
region: both
techniques: [charset_copy_rom_to_ram]
file_formats: [PRG]
uses_registers: [D011, D012, D018, D020, DC0D, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# KickAssembler — Copy the character ROM into RAM, checked, timed, and done wrong once

## Synopsis

Copies the 4 KB character ROM into RAM at `$3000` with the I/O window
swapped for the ROM under `SEI`, checks every byte of the copy through a
16-bit sum against the value the host computed from
`chargen-901225-01.bin`, times the 2 KB and 4 KB copies with the CIA2
timers (display on and display blanked), points `$D018` at the copy and
overwrites one glyph in it so the screen proves the VIC is reading RAM.
Then it does the copy once the wrong way: interrupts enabled while the
KERNAL IRQ is live, under a CIA2 timer NMI that acts as a watchdog. The
program reports how far that copy got, how many times the interrupt
handler ran before the watchdog fired, and how many keys the handler
queued from a keyboard it could not see. Verdict for a harness: `$02FF`
= `$01` and a green border when the checksum matches and the
unprotected copy was caught, `$02` and red otherwise.

## Source

```asm
// charset-copy-rom-to-ram.asm
// Copies the character ROM into RAM at $3000 with the I/O window swapped
// for the ROM under SEI, times the 2 KB and 4 KB copies with the CIA2
// timers (display on and display blanked), checks the copy against a
// checksum of chargen-901225-01.bin computed on the host, points $D018
// at the copy and alters one glyph to prove the VIC is reading it. Then
// it repeats the copy the wrong way, with interrupts enabled while the
// KERNAL IRQ is live, under a CIA2 timer NMI that acts as a watchdog,
// and reports how far the copy got, how many times the IRQ handler ran,
// and how many keys the handler queued from a keyboard it could not see.
// Verdict for a harness: $02FF = $01 and a green border when the
// checksum matches and the unprotected copy was caught, $02 and red
// otherwise.

BasicUpstart2(start)
.encoding "screencode_upper"

.const SCREEN     = $0400
.const COLRAM     = $d800
.const RESULT     = $02ff        // verdict byte read by the harness
.const BORDER     = $d020
.const CODE_PASS  = $01
.const CODE_FAIL  = $02
.const FONT       = $3000        // 4 KB copy: VIC bank 0, $D018 CB = %110
.const SCRATCH    = $4000        // target of the unprotected copy
.const EXP_SUM    = $f7f8        // 16-bit sum of the 4,096 ROM bytes, host-computed
.const KERNAL_IRQ = $ea31
.const KERNAL_NMI = $fe47
.const MARK       = $66          // screen code whose glyph is replaced after the switch

.const src = $fb                 // zero-page pointer: string source
.const dst = $fd                 // zero-page pointer: screen destination

// ---------------------------------------------------------------- macros

// CopyRom(pages, dest): the technique. ROM in, copy, I/O back. The
// caller holds SEI across the whole macro: no interrupt may run while
// the I/O chips are out of the map.
.macro CopyRom(pages, dest) {
    lda $01
    and #$f8                     // keep the datasette bits 3-5
    ora #$03                     // $33: char ROM at $D000-$DFFF
    sta $01
    ldx #0
!:
    .for (var p = 0; p < pages; p++) {
        lda $d000 + p * 256, x
        sta dest + p * 256, x
    }
    inx
    bne !-
    lda $01
    and #$f8
    ora #$07                     // $37: I/O back
    sta $01
}

// Time(routine, slot): CIA2 timer A counts phi2, timer B counts A
// underflows; the 24-bit count lands in slot. The CIAs keep counting
// while the CPU cannot see them; only the start and the read need I/O.
// SEI is held from before the start to after the read, so the count is
// the routine alone: an IRQ deferred by the copy would otherwise run at
// the CLI, inside the window.
.macro Time(routine, slot) {
    sei
    lda #$ff
    sta $dd04
    sta $dd05
    sta $dd06
    sta $dd07
    lda #$51
    sta $dd0f
    lda #$11
    sta $dd0e
    jsr routine
    lda #$00
    sta $dd0e
    sta $dd0f
    sec
    lda #$ff
    sbc $dd04
    sta slot
    lda #$ff
    sbc $dd05
    sta slot+1
    lda #$ff
    sbc $dd06
    sta slot+2
    cli
}

.macro PrintAt(row, col, text) {
    lda #<(SCREEN + row * 40 + col)
    sta dst
    lda #>(SCREEN + row * 40 + col)
    sta dst+1
    lda #<text
    sta src
    lda #>text
    sta src+1
    jsr print
}

.macro Hex24At(row, col, slot) {
    lda #<(SCREEN + row * 40 + col)
    sta dst
    lda #>(SCREEN + row * 40 + col)
    sta dst+1
    ldy #0
    lda slot+2
    jsr hex_byte
    lda slot+1
    jsr hex_byte
    lda slot
    jsr hex_byte
}

.macro Hex16At(row, col, slot) {
    lda #<(SCREEN + row * 40 + col)
    sta dst
    lda #>(SCREEN + row * 40 + col)
    sta dst+1
    ldy #0
    lda slot+1
    jsr hex_byte
    lda slot
    jsr hex_byte
}

.macro Hex8At(row, col, slot) {
    lda #<(SCREEN + row * 40 + col)
    sta dst
    lda #>(SCREEN + row * 40 + col)
    sta dst+1
    ldy #0
    lda slot
    jsr hex_byte
}

// ---------------------------------------------------------------- main

start:
    jsr clear_screen
    PrintAt(0, 0, t_title)

    // 1. The technique, timed three ways.
    Time(copy2k, t_2k_on)
    jsr blank_display
    Time(copy2k, t_2k_off)
    jsr show_display
    Time(copy4k, t_4k_on)
    Time(nothing, t_empty)

    // 2. Check the 4 KB copy against the host checksum.
    jsr checksum
    PrintAt(2, 0, t_sum)
    Hex16At(2, 4, sum)
    lda sum
    cmp #<EXP_SUM
    bne sum_bad
    lda sum+1
    cmp #>EXP_SUM
    bne sum_bad
    PrintAt(2, 14, t_pass)
    lda #1
    sta sum_ok
    jmp sum_done
sum_bad:
    PrintAt(2, 14, t_fail)
sum_done:
    PrintAt(3, 0, t_2k_on_l)
    Hex24At(3, 8, t_2k_on)
    PrintAt(4, 0, t_2k_off_l)
    Hex24At(4, 8, t_2k_off)
    PrintAt(5, 0, t_4k_on_l)
    Hex24At(5, 8, t_4k_on)
    PrintAt(6, 0, t_empty_l)
    Hex24At(6, 8, t_empty)

    // 3. Point the VIC at the copy, then alter one glyph in the copy.
    PrintAt(7, 0, t_live)
    lda #$1c                     // screen $0400, charset $3000
    sta $d018
    ldx #7
    lda #$ff
!:  sta FONT + MARK * 8, x       // MARK becomes a solid 8x8 block
    dex
    bpl !-

    // 4. The mistake, caught: copy with interrupts enabled.
    jsr bad_copy
    PrintAt(9, 0, t_nosei)
    lda completed
    beq !+
    PrintAt(9, 13, t_completed)
    jmp !++
!:  PrintAt(9, 13, t_caught)
!:  PrintAt(10, 0, t_irqs)
    Hex16At(10, 11, irq_count)
    PrintAt(11, 0, t_iter)
    Hex8At(11, 11, progress)
    PrintAt(12, 0, t_keys)
    Hex8At(12, 12, $c6)

    // 5. Verdict.
    lda sum_ok
    beq verdict_fail
    lda completed
    bne verdict_fail
    lda #CODE_PASS
    sta RESULT
    lda #5
    sta BORDER
    jmp forever
verdict_fail:
    lda #CODE_FAIL
    sta RESULT
    lda #2
    sta BORDER
forever:
    jmp forever

// ---------------------------------------------------------------- copies

copy2k:
    CopyRom(8, FONT)
    rts

copy4k:
    CopyRom(16, FONT)
    rts

nothing:                         // the timing window's own overhead
    rts

// The wrong way. Same loop, interrupts enabled, the KERNAL IRQ live. A
// CIA2 timer A one-shot of 65,535 cycles raises an NMI as a watchdog;
// the copy would take about 39,000 cycles if nothing stopped it.
bad_copy:
    sei
    lda #<irq_hook
    sta $0314
    lda #>irq_hook
    sta $0315
    lda #<nmi_catch
    sta $0318
    lda #>nmi_catch
    sta $0319
    lda #0
    sta irq_count
    sta irq_count+1
    sta progress
    sta completed
    sta $c6                      // empty the keyboard buffer
    tsx
    stx saved_sp
    lda #$7f
    sta $dd0d                    // mask every CIA2 source
    lda $dd0d                    // and drop anything pending
    lda #$ff
    sta $dd04
    sta $dd05
    lda #$81
    sta $dd0d                    // timer A may raise the NMI
    lda #$19
    sta $dd0e                    // one-shot, force load, start
    lda $01
    and #$f8
    ora #$03
    sta $01                      // ROM in
    cli                          // the mistake
    ldx #0
bad_loop:
    stx progress
    .for (var p = 0; p < 16; p++) {
        lda $d000 + p * 256, x
        sta SCRATCH + p * 256, x
    }
    inx
    bne bad_loop
    // Only reached if no interrupt fired for the whole copy.
    sei
    lda $01
    and #$f8
    ora #$07
    sta $01
    lda #$7f
    sta $dd0d
    lda $dd0d
    lda #0
    sta $dd0e
    lda #1
    sta completed
    jmp recovered

irq_hook:
    inc irq_count
    bne !+
    inc irq_count+1
!:  jmp KERNAL_IRQ

nmi_catch:
    lda $01
    and #$f8
    ora #$07
    sta $01                      // I/O back before touching a CIA
    lda $dd0d                    // acknowledge the watchdog
    lda $dc0d                    // acknowledge the stuck KERNAL IRQ
    ldx saved_sp
    txs                          // unwind the nested handler frames
    // falls through: I is set from the NMI entry

recovered:
    lda #<KERNAL_IRQ
    sta $0314
    lda #>KERNAL_IRQ
    sta $0315
    lda #<KERNAL_NMI
    sta $0318
    lda #>KERNAL_NMI
    sta $0319
    cli
    rts

// ---------------------------------------------------------------- support

checksum:                        // sum = 16-bit sum of FONT..FONT+$0FFF
    lda #0
    sta sum
    sta sum+1
    sta src
    lda #>FONT
    sta src+1
    ldx #16
    ldy #0
cs_loop:
    lda (src), y
    clc
    adc sum
    sta sum
    bcc !+
    inc sum+1
!:  iny
    bne cs_loop
    inc src+1
    dex
    bne cs_loop
    rts

blank_display:                   // DEN off, then wait past line $30 of a new frame
    lda $d011
    and #$ef
    sta $d011
!:  lda $d012
    bne !-
!:  lda $d012
    cmp #100
    bne !-
    rts

show_display:
    lda $d011
    ora #$10
    sta $d011
    rts

clear_screen:
    ldx #0
    lda #$20
!:  sta SCREEN, x
    sta SCREEN + $100, x
    sta SCREEN + $200, x
    sta SCREEN + $300, x
    inx
    bne !-
    lda #1
!:  sta COLRAM, x
    sta COLRAM + $100, x
    sta COLRAM + $200, x
    sta COLRAM + $300, x
    inx
    bne !-
    rts

print:                           // (src) zero-terminated -> (dst)
    ldy #0
!:  lda (src), y
    beq !+
    sta (dst), y
    iny
    bne !-
!:  rts

hex_byte:                        // A -> two hex digits at (dst),y; Y advances
    pha
    lsr
    lsr
    lsr
    lsr
    tax
    lda hex_digits, x
    sta (dst), y
    iny
    pla
    and #$0f
    tax
    lda hex_digits, x
    sta (dst), y
    iny
    rts

hex_digits: .text "0123456789ABCDEF"

t_title:     .text "CHARSET COPY ROM TO RAM"
             .byte 0
t_sum:       .text "SUM"
             .byte 0
t_pass:      .text "PASS"
             .byte 0
t_fail:      .text "FAIL"
             .byte 0
t_2k_on_l:   .text "2K ON"
             .byte 0
t_2k_off_l:  .text "2K OFF"
             .byte 0
t_4k_on_l:   .text "4K ON"
             .byte 0
t_empty_l:   .text "EMPTY"
             .byte 0
t_live:      .text "D018=1C COPY LIVE "
             .fill 8, MARK
             .byte 0
t_nosei:     .text "NO SEI COPY:"
             .byte 0
t_caught:    .text "CAUGHT BY NMI"
             .byte 0
t_completed: .text "COMPLETED"
             .byte 0
t_irqs:      .text "IRQ PASSES"
             .byte 0
t_iter:      .text "ITERATIONS"
             .byte 0
t_keys:      .text "KEYS QUEUED"
             .byte 0

t_2k_on:     .byte 0, 0, 0
t_2k_off:    .byte 0, 0, 0
t_4k_on:     .byte 0, 0, 0
t_empty:     .byte 0, 0, 0
sum:         .byte 0, 0
sum_ok:      .byte 0
irq_count:   .byte 0, 0
progress:    .byte 0
completed:   .byte 0
saved_sp:    .byte 0
```

## Build

```bash
java -jar KickAss.jar charset-copy-rom-to-ram.asm -o charset-copy-rom-to-ram.prg
```

Produces `charset-copy-rom-to-ram.prg`, `$0801` to `$0E53`, 1,621 bytes
on disk.

## Expected output

Border green, text white on the power-on blue. PAL (VICE x64sc 3.10,
`-limitcycles 8000000`; the screenshot is
`screenshots/charset-copy-rom-to-ram.png`):

```
CHARSET COPY ROM TO RAM

SUM F7F8      PASS
2K ON   005141
2K OFF  004D26
4K ON   009AAD
EMPTY   000011
D018=1C COPY LIVE ████████

NO SEI COPY: CAUGHT BY NMI
IRQ PASSES 001A
ITERATIONS 1E
KEYS QUEUED 01
```

The eight cells after `COPY LIVE` are screen code `$66`, a checkerboard
in the ROM; every pixel of them is white in the screenshot because the
program overwrote that glyph in the RAM copy after the `$D018` switch.
Measured with PIL over the 8 × 64 pixels on both models.

NTSC (`-model ntsc`, `screenshots/charset-copy-rom-to-ram-ntsc.png`)
differs on four lines: `2K ON 0052AF`, `4K ON 009D5C`, `IRQ PASSES 001B`,
`ITERATIONS 07`. `2K OFF`, `EMPTY`, the checksum and `KEYS QUEUED` are
the same on both models.

Each figure was produced twice per model with identical PNG bytes.
In decimal, with the 17-cycle window overhead (`EMPTY`) taken off:

| Measurement | PAL | NTSC | Arithmetic |
|---|---|---|---|
| 2 KB copy, display blanked | 19,733 | 19,733 | 19,733 |
| 2 KB copy, display on | 20,784 | 21,150 | 19,733 + badlines |
| 4 KB copy, display on | 39,580 | 40,267 | 38,165 + badlines |
| Unprotected copy: loop iterations before the first IRQ (of 256) | 30 | 7 | phase-dependent |
| Unprotected copy: IRQ handler passes before the watchdog | 26 | 27 | |
| Keyboard buffer bytes after recovery | 1 | 1 | |

The arithmetic column is the instruction table: eight `LDA abs,X` /
`STA abs,X` pairs at 9 cycles, `INX` and a taken `BNE` at 5, 256
iterations less the last branch not taken, 19,711; the bank switch in
(12) and out (10) make 19,733. The 4 KB loop is 16 pairs, 38,143 + 22.
The 4 KB copy with the display blanked was not measured here.

## Why this works

**The technique.** `CopyRom` reads `$01`, clears bits 0-2 and sets
`$33`: CHAREN low, HIRAM and LORAM high, so `$D000-$DFFF` reads the
character ROM while BASIC and KERNAL stay in place. The copy is a plain
indexed loop, one page per load/store pair. Then `$01` goes back to
`$37`. Bits 3-5 are preserved by the read-modify-write; a bare
`LDA #$33 / STA $01` would also work on a machine with no datasette
running but the habit costs nothing. The caller holds `SEI` from before
the switch to after the restore; `Time` does that here, and a program
that is not timing anything does `SEI / CopyRom / CLI`.

**Why the interrupt flag matters.** While `$01` is `$33` there is no
I/O in the map. The KERNAL IRQ fires from CIA1 timer A, which the
KERNAL latches with `$4025` on PAL and `$4295` on NTSC (the writes are
at `$FDE2` and `$FDEC` in the 901227-03 image), a period of about
16,400 and 17,000 cycles; its handler ends by reading `$DC0D` to
acknowledge the timer. With the ROM mapped, that read returns a font
byte, the CIA flag is never cleared, `/IRQ` stays low, and the handler
is re-entered the moment `RTI` clears the I flag. The main program never
gets another instruction. The recipe shows this as measured, not as a
warning: the unprotected copy managed 30 of 256 iterations on PAL
(7 on NTSC; the count depends only on where in the timer period the
copy started), the handler then ran 26 times in the 61,000 cycles that
remained before the watchdog, and the copy never advanced. Along the
way the KERNAL keyboard scan read its column byte from the ROM instead
of CIA1 port B, decoded a key nobody pressed, and left one byte in the
keyboard buffer (`$C6` = 1 on both models). What that key was is not
measured here. Pitfall `irq_during_charen_window` has the mechanism.

**How the crash is caught.** The watchdog is CIA2 timer A, one-shot,
65,535 cycles, with its interrupt enabled: CIA2 drives `/NMI`, and an
NMI cannot be masked. The KERNAL NMI entry at `$FE43` jumps through
`$0318`, which the recipe points at `nmi_catch`. The catcher restores
`$37` first, because until it does neither CIA is reachable; then it
reads `$DD0D` to drop the watchdog and `$DC0D` to drop the stuck IRQ,
reloads the stack pointer saved before the copy, and falls into the
same recovery code the completed path would take. The completed path
exists so that the assertion is real: if a future machine or a future
KERNAL let the copy finish, the screen would say `COMPLETED` and the
verdict would be `FAIL`, because the page's claim would then be wrong.

**Why the timing window holds `SEI`.** An earlier build of this program
put `SEI` and `CLI` inside the copy routine and measured 468 cycles too
many: a KERNAL IRQ falls due during any copy longer than one timer
period, and it ran at the `CLI`, inside the window. The pinned listing
holds `SEI` across the timer start and the timer read, so the figure is
the routine alone. A second earlier figure, 20,005 for the blanked 2 KB
copy, was 255 too many for a different reason: that build's loop branch
crossed a page boundary and paid one cycle on each of the 255 taken
branches (pitfall `branch_page_cross_extra_cycle`). The final layout has
all three loop branches on one page, checked from the symbol file. The
display-on figures are larger by the badlines the window spans, about
1,050 cycles on PAL for the 2 KB copy; blank the display (`$D011` bit 4)
and wait for a frame past line `$30` if the copy has to be fast, or put
it before the display is turned on.

**The checksum.** The host figure is one line:
`python3 -c "print(hex(sum(open('chargen-901225-01.bin','rb').read()) & 0xffff))"`
over the VICE image `/opt/homebrew/opt/vice/share/vice/C64/chargen-901225-01.bin`,
which gives `0xf7f8`; the program sums the 4,096 bytes at `$3000` the
same way. A 16-bit sum is not a strong hash, but here the alternative
failure is not a subtle one: a copy made with `$01` = `$37` reads VIC,
SID and CIA registers, and a copy that was cut short leaves whatever was
in RAM. Either moves the sum.

**The switch.** `$D018` = `$1C` keeps the screen at `$0400` and sets the
character base to `$3000` inside VIC bank 0 (CB field %110, × `$0800`).
The VIC reads the copy from the next character fetch; the program then
writes eight `$FF` bytes at `$3000 + $66 × 8`, and the eight `$66` cells
already on the screen turn solid. The font at `$1000-$1FFF` in the same
bank is the ROM shadow (technique `char_rom_under_vic`); the copy has to
sit outside it, and `$3000-$3FFF` does.
