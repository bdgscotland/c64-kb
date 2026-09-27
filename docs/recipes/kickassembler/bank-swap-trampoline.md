---
recipe: bank-swap-trampoline
toolchain: kickassembler
output_format: PRG
region: both
techniques: [bank_swap_trampoline]
file_formats: [PRG]
uses_registers: [R6510, D020]
uses_kernal: []
claims: [zero_page $FB (owns)]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Bank-swap trampoline restores the caller's $01

## Synopsis

This runnable example calls the trampoline twice before restoring the bank.
Both calls have the same incoming `$01`, so the shared immediate operand
retains the correct value. The program checks and displays that `$01` is
restored to `$37`.

## Source

```asm
// bank-swap-trampoline.asm
// Build: java -jar KickAss.jar bank-swap-trampoline.asm -o bank-swap-trampoline.prg
BasicUpstart2(start)
.encoding "screencode_upper"

* = $080d
start:
    sei
    lda $01
    sta $fb
    jsr enter_bank
    jsr enter_bank       // same-value nested entry leaves the operand intact
    jsr leave_bank
    jsr leave_bank
    lda $01
    cmp $fb
    bne failed
    lda #1
    sta $d020
    bne report
failed:
    lda #0
    sta $d020
report:
    sta $0400
    lda #$05
    sta $d800
    lda $01
    sta $0401
    cli
done:
    jmp done

enter_bank:
    sei
    lda $01
    sta leave_bank + 1
    lda #$35
    sta $01
    rts

leave_bank:
    lda #$37
    sta $01
    cli
    rts
```

## Build

```bash
java -jar "$KICKASS_JAR" bank-swap-trampoline.asm -o bank-swap-trampoline.prg
```

## Expected output

Verified in VICE x64sc 3.10, PAL C64C. The first screen cell reports pass
and the second reports `$37`, the restored caller value. A PIL measurement
of the screenshot finds 27 green pixels in the pass cell and 25 light-blue
glyph pixels in the value cell (VICE palette RGB `(98, 213, 50)` and
`(115, 133, 255)`). The screenshot is
`screenshots/bank-swap-trampoline.png` (384 × 272).

## Why this works

Each `enter_bank` writes the same incoming `$37` value into the restore
instruction's immediate operand. Nested same-value calls therefore leave
the value needed by both exits. The restored byte check in the running
program confirms the round trip; mixed-value callers and an interrupt that
also enters the trampoline remain unsafe because they overwrite this one
operand.
