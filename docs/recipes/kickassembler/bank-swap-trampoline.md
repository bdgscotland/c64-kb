---
recipe: bank-swap-trampoline
toolchain: kickassembler
output_format: PRG
region: both
techniques: [bank_swap_trampoline]
file_formats: [PRG]
uses_registers: [R6510]
uses_kernal: []
claims: [zero_page $FB (owns)]
ram: [colour=$D800-$DBFF]
---

<!-- doc-type: recipe -->

# KickAssembler — Bank-swap trampoline is sequential only

## Synopsis

This runnable example measures sequential and nested calls separately. The
sequential call restores `$37`; the nested call leaves `$01=$35` because the
inner entry overwrites the shared restore operand.

## Source

```asm
// bank-swap-trampoline.asm
// Build: java -jar KickAss.jar bank-swap-trampoline.asm -o bank-swap-trampoline.prg
BasicUpstart2(start)
.encoding "screencode_upper"

* = $080d
start:
    sei
    jsr enter_bank
    jsr leave_bank
    lda $01
    cmp #$37
    bne failed
    lda #$31
    sta $0401
    bne report
failed:
    lda #$30
    sta $0401
report:
    lda #$13
    sta $0400
    lda #$33
    sta $0402
    lda #$37
    sta $0403
    jsr enter_bank
    jsr enter_bank
    jsr leave_bank
    jsr leave_bank
    lda $01
    sta $fb
    cmp #$35
    bne nested_failed
    lda #$31
    sta $0429
    bne show
nested_failed:
    lda #$30
    sta $0429
show:
    lda #$0e
    sta $0428
    lda #$33
    sta $042a
    lda #$35
    sta $042b
    lda #$05
    sta $d800
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
    rts
```

## Build

```bash
java -jar "$KICKASS_JAR" bank-swap-trampoline.asm -o bank-swap-trampoline.prg
```

## Expected output

Verified in VICE x64sc 3.10, PAL C64C. The top row displays `S137` (the
sequential check passed and `$01=$37`); the next row displays `N135` (the
nested check observed `$01=$35`). The second character is `1` when the check
matches its expected result and `0` otherwise.
The screenshot is `screenshots/bank-swap-trampoline.png` (384 × 272).

## Why this works

Each sequential `enter_bank` saves `$37` in the restore instruction's
immediate operand, and `leave_bank` restores it. In the nested case, the
inner entry saves `$35` over the outer `$37`; both exits then restore `$35`.
The displayed results show sequential success and the nested failure.
