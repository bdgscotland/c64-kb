---
category: kernal
---

<!-- doc-type: pitfall-reference -->

# KERNAL and I/O Pitfalls

Most pitfalls here come from the KERNAL's implicit contract with the
hardware state. The KERNAL assumes interrupts enabled, registers free to
clobber, the CPU memory map at its stock $37 configuration, and decimal
mode cleared. Each entry describes one way that assumption fails in a
demo or game with customised IRQs, banked memory, or BCD arithmetic.

Three entries are library and host-tooling traps in the same
disk-and-keyboard I/O workflow: the Oscar64 `krnio_save()` splat, the
c1541 uppercase-filename PETSCII shift and the Oscar64 `getchx()` RETURN
remap. `restore_nmi_not_maskable` is a hardware-wiring trap: RESTORE
drives /NMI directly, so no CIA mask reaches it. The last two entries
are VIC-II traps in the KERNAL's receive routine: sprites next to
badlines make it miss a bit, and on an old 6526 sprite DMA can make it
miss the EOI timer. Either way it waits for ever.

---

## kernal_assumes_sei_cleared — KERNAL re-enables interrupts internally; calling under SEI breaks IRQ discipline

**Severity:** high
**Region:** both
**Triggered by kernal:** OPEN, LOAD, SAVE, CHKIN, CHKOUT, CLOSE, CLRCHN
**Triggered by techniques:** stable_raster_irq, kernal_file_write_seq, kernal_file_read_seq, error_channel_check, kernal_load_to_address, kernal_relative_file_io, directory_read_and_select

### Symptom

A raster IRQ scheme runs cleanly until the code issues a disk or tape I/O call.
Immediately after the JSR to OPEN, LOAD or CHKIN, the raster split collapses:
color bars bleed, sprites misplace, or the entire display tears. In subtler
cases the raster handler appears to execute twice on the same frame, or the
stable-raster double-IRQ polling loop hangs. With tape routines the
symptom is often a machine hang: the KERNAL is waiting for a
keyboard character inside CLI context, the raster IRQ fires at an unexpected
stack depth, and the machine can no longer process RESTORE.

A variation: the code wraps a KERNAL call in SEI to protect a critical section.
The routine returns normally but the critical section's register state has been
scrambled: the KERNAL's own CLI re-enabled IRQs and the raster handler
fired mid-section.

### Mechanism

The CLIs are not in OPEN, LOAD, SAVE, CHKIN, CHKOUT, CLOSE or CLRCHN
themselves; none of those bodies contains a CLI (ROM census of
`kernal-901227-03.bin`: no $58 byte in OPEN $F34A-$F3D4, CHKIN $F20E-$F24F,
CHKOUT $F250-$F290, LOAD $F49E-$F5DC or SAVE $F5DD-$F68E; an earlier version
of this entry said the CLIs were "in their bodies"). They are in the serial-bus
primitives those routines call (LISTEN, TALK, SECOND, TKSA, ACPTR, CIOUT, UNTALK,
UNLSN, $ED09-$EEB2). Each primitive brackets its bit-level handshake in
SEI ... CLI: the byte transfer itself runs with interrupts DISABLED, and the
routine exits with an unconditional CLI ($EDAB and $EDB5 after LISTEN/TALK/
SECOND, $EDDB after the bus turnaround, $EE82 after ACPTR) whatever the I flag
the caller had. Every routine that reaches them on a serial device (OPEN,
CHKIN, CHKOUT, CLOSE, CLRCHN, LOAD and SAVE) therefore returns with
interrupts enabled (measured in VICE x64sc with a true-drive 1541 and traps
off: all seven return with I=0 when entered under SEI). Tape does the same by
a different route: tape LOAD and SAVE set up their own IRQ under SEI and then
execute an unconditional CLI at $F8BD, run the whole transfer with interrupts
enabled, and the restore at $FC93 (PHP/SEI ... PLP) puts back that post-CLI
state, so they too return with I=0.

This is by design: OPEN, LOAD, and SAVE can take millions of cycles (a
standard KERNAL IEC LOAD from a 1541, measured in VICE x64sc with true
drive emulation: 8,192 bytes in 871 jiffies, about 14.5 s, so about 565
bytes per second or 1.8 s per kilobyte;
`hardware/cia-reference.md`, `formats/iec-disk-reference.md` and
`techniques/loaders-packers.md` measure the same order. An earlier version of
this entry said "tens of thousands of cycles" and "roughly 1 second per
kilobyte", which understated the exposure window by almost half; a later one
said "300-600 bytes per second, two to three seconds per kilobyte", which
does not match its own measurement), and the jiffy
clock IRQ at $EA31 must continue running during that time to keep the
jiffy clock accurate and to service the keyboard queue. The jiffy is about
60 Hz on both PAL and NTSC: the KERNAL loads CIA1 Timer A with $4025 on PAL
and $4295 on NTSC (ROM bytes at $FDDD-$FDF5), which is 59.99 Hz at 985,248 Hz
and 60.00 Hz at 1,022,727 Hz. (An earlier version said "60/50 Hz time base".) The KERNAL
authors assumed the caller had IRQs enabled at the JSR: the machine
boots with CLI, BASIC runs with CLI, and the KERNAL's own IRQ handler at $EA31
is designed to be re-entrant only in specific ways.

When a demo or game installs a custom raster IRQ scheme, the raster handler's
stack discipline assumes IRQs arrive only when the CPU is in the main loop. If
the main loop calls OPEN under SEI and the KERNAL executes CLI, the raster IRQ
fires with the stack at an unexpected depth. The handler RTIs into the middle of
the KERNAL routine, and the KERNAL either hangs or corrupts its own zero-page
workspace because the handler saved new state on top of the KERNAL's
partially-built stack frame.

SETLFS and SETNAM do not contain CLI (they only store values in zero page:
SETLFS at $FE00 is STA $B8/STX $BA/STY $B9/RTS, and P measured after
SEI;SETLFS is $35, I still set), but OPEN, LOAD, SAVE, CHKIN, CHKOUT, CLRCHN
and CLOSE all return with interrupts enabled when the channel is a serial-bus
(IEC) device. The CLI sits in the byte-send tail at $EDAB and the receive
tail at $EE82, so LISTEN/TALK/SECOND/TKSA/ACPTR/UNLSN/UNTLK inherit it.
Addressed to the screen or keyboard (devices 0-3) the same calls leave the I
flag untouched (measured: CHKIN on a screen file under SEI left P = $36).
An earlier version of this entry listed SETLFS on the trigger line and left
CLOSE, CLRCHN and SAVE off it.

### Fix

Never call KERNAL file I/O routines from inside a raster IRQ handler. The IRQ
handler is the wrong context for long, unpredictable-duration operations.

Leave IRQs enabled (CLI) when issuing KERNAL file I/O. The raster IRQ
fires during the operation, which is harmless if the handler is
reentrant-safe. If a critical section must use SEI, complete it before the KERNAL
call:

```kick
    sei                     // Begin critical section
    // ... modify shared state ...
    cli                     // End critical section BEFORE KERNAL call
    jsr $ffba               // SETLFS — safe; IRQs are now enabled
    jsr $ffbd               // SETNAM
    jsr $ffc0               // OPEN — may internally CLI/SEI; we are already at CLI
    bcs open_error
```

If I/O must be triggered from a protected context, set a flag and service the
KERNAL call from the main loop's next idle frame, where IRQs are enabled and
the stack is at its natural depth.

### Worked example

```kick
// BAD: KERNAL OPEN called from inside the raster IRQ handler.
// OPEN's serial primitives execute CLI; the raster scheme re-enters at wrong stack depth.
raster_irq_bad:
    lda #WHITE
    sta $d020
    jsr $ffc0               // OPEN from IRQ — WRONG; CLI inside OPEN corrupts IRQ scheme
    asl $d019
    rti

// GOOD: queue a flag; main loop services I/O with IRQs naturally enabled.
io_requested: .byte 0       // flag byte (lives with the code, not in zero page)

raster_irq_good:
    lda #WHITE
    sta $d020
    asl $d019
    rti

main_loop:
    lda io_requested
    beq main_loop
    lda #0
    sta io_requested
    // IRQs are enabled here — KERNAL calls are safe
    lda #1
    ldx #8
    ldy #2
    jsr $ffba               // SETLFS
    lda #fname_end - fname
    ldx #<fname
    ldy #>fname
    jsr $ffbd               // SETNAM
    jsr $ffc0               // OPEN — KERNAL may CLI/SEI internally; fine here
    bcs io_error
    jmp main_loop

fname: .text "MYFILE,S,R"
fname_end:
```

### Cross-references

- Technique: `stable_raster_irq` — the raster scheme most likely to be
  disrupted by an unexpected CLI from the KERNAL; the technique doc covers
  IRQ vector placement ($0314 through the $FF48 dispatcher versus
  $FFFE/$FFFF with the KERNAL out). Stack depth across a chained pair of
  handlers is covered by `double_irq` (the dispatcher's own TSX clobbers X,
  so a saved stack pointer goes through memory) and in detail by
  `recipes/kickassembler/stable-raster-irq.md`, section "The stack".
- KERNAL routines: `SETLFS` ($FFBA), `OPEN` ($FFC0), `LOAD` ($FFD5),
  `SAVE` ($FFD8), `CHKIN` ($FFC6), `CHKOUT` ($FFC9), `CLOSE` ($FFC3),
  `CLRCHN` ($FFCC).
- Pitfall: `kernal_io_mapping_dependency` — the two pitfalls often appear
  together; banking out the KERNAL and calling OPEN hits both.

---

## kernal_clobbers_a_x_y — KERNAL routines do not preserve A, X, or Y unless the Affects line says otherwise

**Severity:** medium
**Region:** both
**Triggered by kernal:** CHROUT, CHRIN, GETIN, CHKIN, CHKOUT
**Triggered by techniques:** text_input_line, kernal_relative_file_io, petscii_screen_code_conversion

### Symptom

A loop that calls GETIN to poll the keyboard loses its Y index. A sprite
multiplex routine that calls GETIN to check for keypresses returns with the
sprite index in Y replaced by the key code and X by the old queue length, but
only when a key was waiting; with an empty queue both come back intact, so the
bug appears only while the player types (measured in VICE x64sc: empty queue,
X=$77/Y=$88 unchanged; one key queued, X=$01, Y=$41; an earlier version of
this entry said Y came back as zero, which it never does for a real key). A
character output sequence that builds a string index in X finds X reset to a
garbage value after CHKOUT. The bugs surface only on some code paths: the
loop works without KERNAL calls, and a single JSR $FFE4 breaks it silently
if the code assumed Y was preserved. (An earlier version
of this entry used CHROUT as the example; CHROUT preserves A on success, so
that loop worked as written; see the contract list below.)

A subtler variant: the code saves only A around CHKIN, assumes X and Y are
untouched, then finds X changed on return and mistakes it for an error
sentinel. On a disk or other serial-bus channel X is the device number (8),
on a keyboard or screen file the open-file-table index (0 for the first
file), on a tape file the stored secondary address ($60). An earlier
version of this entry said X was always the table index; ROM $F237 is TAX on
the device number before TALK, and CHKIN on logical file 1, device 8 was
measured in VICE x64sc returning X=$08.

### Mechanism

The KERNAL authors saved space and cycles by preserving only the registers that
callers need back. The documented contract is the Affects line in each
routine's reference entry. Any register listed in Affects may be changed; any
register absent from Affects is not guaranteed preserved either; absence means
"not documented as changed on the success path only". The safe assumption:
any register not listed as output may be clobbered.

Specific contracts for the most-called routines:

- **CHROUT ($FFD2):** Affects C; A is preserved on success (C=0) and comes
  back as 0 on the error return (C=1). Sources: KERNAL reference; measured in VICE
  x64sc (LDA #$41 / JSR $FFD2 to the screen returned A=$41) and in ROM ($E716
  PHA … $E6B0 PLA/TAX/PLA/CLC/CLI/RTS; error tail $F201 LDA $9E / BCC +2 /
  LDA #0 / RTS). X and Y are preserved. An earlier version of this entry listed A
  as clobbered.
- **CHRIN ($FFCF):** Affects A, X, Y, C: all three registers may change.
- **GETIN ($FFE4):** Affects A, X, Y, C, as CHRIN.
- **CHKIN ($FFC6):** Affects A, X, C. A returns the device number on success
  (A=8 disk, A=3 screen, A=0 keyboard, measured; ROM $F233 STA $99 with
  A = FA).
- **CHKOUT ($FFC9):** Affects A, X, C.

OPEN, CLOSE, LOAD, and SAVE clobber A, X, Y, and C. Only SETLFS and SETNAM
preserve all three (their Affects lines say None).

### Fix

Audit every KERNAL call site. For each JSR $FFxx, check the Affects line. Save
and restore every register listed in Affects that the caller also needs after
the call returns. Use PHA/PLA for A, TXA/PHA/PLA/TAX for X, and TYA/PHA/PLA/TAY
for Y.

Unless the Affects line has been checked against what the caller needs after
the call, preserve all three around every KERNAL JSR.
The cost is 29 cycles (13 to save, 16 to restore, from the 6510 reference's
per-instruction figures: PHA 3, PLA 4, the transfers 2 each) plus the
JSR/RTS, negligible outside tight raster loops. An earlier version of this
entry said 15, which no subset that saves all three registers can reach.

```kick
// Canonical full-preservation wrapper macro.
// Saves A, X, Y; calls the given KERNAL address; restores Y, X, A.
.macro KernalCall(addr) {
    pha
    txa
    pha
    tya
    pha
    jsr addr
    pla
    tay
    pla
    tax
    pla
}
```

In tight loops, check Affects and save only what is needed. If the counter is
in X and the routine touches only A and C (e.g. CHROUT), a bare PHA/JSR/PLA
suffices; for CHROUT even that is needed only on the error path.

### Worked example

```kick
// BAD: assumes CHKIN leaves X untouched.
// CHKIN Affects A and X; on a disk channel X comes back as the device number
// (8 here), not 1; on a screen or keyboard file it is the open-file-table
// index (measured in VICE x64sc).
    ldx #1                  // logical file number
    jsr $ffc6               // CHKIN — X is clobbered
    cpx #1                  // WRONG: comparing clobbered X

// GOOD: save and restore around CHKIN.
    ldx #1
    txa
    pha    // save X
    jsr $ffc6               // CHKIN — Affects: A, X, C
    bcs chkin_error
    pla
    tax    // restore X = 1

// BAD: keyboard poll loop keeps its count in Y across GETIN (Y is in Affects).
// With the queue empty Y survives, so the loop works until the player types;
// then GETIN hands back the key code in Y and the count is gone.
poll_loop:
    jsr $ffe4               // GETIN — A, X, Y may change
    dey                     // WRONG: Y may now be the key code
    bne poll_loop

// GOOD: save Y around GETIN.
poll_loop_good:
    tya
    pha
    jsr $ffe4               // GETIN — Affects: A, X, Y, C
    pla
    tay
    dey
    bne poll_loop_good

// CHROUT is the exception this entry used to get wrong: A comes back intact
// when C=0 and as 0 when C=1, so test C after CHROUT, not A.
print_loop:
    lda msg,y
    jsr $ffd2               // CHROUT — A preserved on success, C=1 on error
    bcs print_error
    iny
    dex
    bne print_loop
print_error:

msg: .text "HELLO"
msg_end:
```

### Cross-references

- KERNAL routines: `CHROUT` ($FFD2), `CHRIN` ($FFCF), `GETIN` ($FFE4),
  `CHKIN` ($FFC6), `CHKOUT` ($FFC9).
- Pitfall: `kernal_assumes_sei_cleared` — both come from one cause: the
  KERNAL assumes a runtime contract that the caller must uphold.

---

## decimal_mode_in_irq_handler — IRQ may fire mid-SED arithmetic; handler must CLD on entry or BCD corruption ensues

**Severity:** critical
**Region:** both
**Triggered by techniques:** stable_raster_irq, decimal_mode_pitfalls, irq_chain_table, logic_rate_decoupling, sprite_multiplex_game, tod_alarm_interrupt, irq_keyboard_own_scan, add_sub_16bit

### Symptom

BCD arithmetic running in the main loop produces correct results in isolation
but yields random garbage when the raster IRQ fires during the calculation.
The corruption is intermittent: it depends on whether the IRQ fires between
the SED and CLD instructions in the main-loop BCD block. A SEI/CLI wrapper
around the BCD block fixes the problem, by keeping the IRQ out of that window,
and so hides the real cause. The same corruption appears in SID player timing
code that uses BCD to accumulate tick counts, and in any BASIC-style score
counter kept as packed BCD in zero page.

A related variant: two handlers coexist (music player + raster effect) and one
uses SED/CLD for a BCD calculation. If the second handler fires while the first
is between SED and CLD (via NMI or a chained IRQ that re-enables interrupts),
the second handler's ADC/SBC produces wrong results.

### Mechanism

The 6502/6510 decimal mode flag (D flag) is one bit of the processor status
register (P). When D = 1, ADC and SBC perform BCD (binary-coded-decimal)
arithmetic: result nibbles are adjusted so that each hex digit represents a
decimal digit 0-9. When D = 0, addition and subtraction are pure binary.

The D flag is **not cleared on IRQ entry** on the NMOS 6510. It is saved, as
one bit of the pushed P, and RTI restores it. (An earlier version said "not
automatically cleared or saved".) The 6502 interrupt sequence pushes the program counter (PCH, PCL) and the
processor status register (P) onto the stack, then fetches the IRQ vector and
begins executing the handler. The pushed P contains the D flag as it was at
the time of the interrupt, but the processor does not clear D. The
handler runs with D still set if the interrupted code had executed SED and not
yet executed CLD.

If main-loop code is between `SED` and `CLD` and an IRQ fires, the IRQ
handler's ADC and SBC instructions run in BCD mode. Every ADC or SBC in the
handler, including pointer arithmetic and counters stepped with ADC or SBC,
produces BCD-adjusted results instead of binary results. INC, DEC, INX, DEX,
INY, DEY, ASL, LSR, ROL, ROR and CMP are binary whatever D holds. A handler
that adds 8 to a zero-page pointer holding $00 gets $08 either way, but from
$08 it gets $16 in BCD instead of $10. (An earlier version listed counter
decrements as affected and mixed an add-8 example with 9 + 1.) The pointer
lands in the wrong place.
The raster effect writes to the wrong address. The corruption is data-dependent
and hard to trace without knowing that D is set.

On NMOS silicon, N, V, and Z are undefined after a decimal-mode ADC/SBC. C
reflects decimal carry. Code in the handler that branches on carry after an
addition will take the wrong branch when D is set.

RTI restores P from the stack, including D. After RTI, the main-loop BCD block
resumes with D = 1, but the damage inside the handler's execution
window may already have corrupted effect or music state for the current frame.

### Fix

Every IRQ handler must execute `CLD` as part of its entry stanza, before any
arithmetic. The canonical IRQ handler prelude is:

```kick
irq_handler:
    pha                     // save A
    txa
    pha                     // save X
    tya
    pha                     // save Y
    cld                     // !! MANDATORY: clear decimal mode !!
    // ... handler body — all arithmetic is now binary ...
    pla
    tay
    pla
    tax
    pla
    rti                     // RTI restores P, which restores the D flag
                            // to whatever the interrupted code had set
```

The `CLD` costs 2 cycles and 1 byte. Place it after the
register saves (the PHA/TXA/PHA/TYA/PHA sequence does not perform arithmetic,
so those instructions are safe even with D set) and before any instruction that
uses ADC, SBC, or reads the C/N/V/Z flags after such an instruction.

The RTI at the end of the handler restores D (with all
other flags) from the pushed P, so the main-loop BCD block resumes correctly
with D = 1 after the handler exits. No explicit SED is needed in the handler's
exit path.

NMI handlers require the same discipline. The NMI vector fires regardless of
the I flag and also does not clear D. An NMI handler for digi playback or
any other purpose needs CLD too.

### Worked example

```kick
// BAD: handler has no CLD. ADC in the handler runs in BCD mode if main-loop
// code was between SED and CLD when the IRQ fired.
// E.g. $15 + $06 = $1B binary, but BCD adjusts it to $21 — wrong sprite Y.
irq_bad:
    pha
    txa
    pha
    tya
    pha
    // No CLD!
    lda sprite_y,x
    clc
    adc #21                 // BCD mode if D=1: result may be wrong
    sta $d001
    pla
    tay
    pla
    tax
    pla
    rti

// GOOD: CLD as the first post-save instruction.
irq_good:
    pha
    txa
    pha
    tya
    pha
    cld                     // Mandatory: clears D before any arithmetic
    lda sprite_y,x
    clc
    adc #21                 // Always binary — correct regardless of D on entry
    sta $d001
    pla
    tay
    pla
    tax
    pla
    rti                     // RTI restores P from stack, including original D flag

// Main-loop BCD block — safe with the corrected handler above.
update_score:
    sed
    lda score_lo
    clc
    adc #$10                // +10 in BCD
    sta score_lo
    lda score_hi
    adc #$00
    sta score_hi
    cld                     // Exit BCD mode — keep this window as short as possible
    rts

score_lo: .byte 0
score_hi: .byte 0
sprite_y: .fill 8, i * 21 + 50
```

### Cross-references

- Technique: `stable_raster_irq` — the raster handler this pitfall most
  commonly hits. The technique doc does not show a handler prelude (it only
  notes that the KERNAL dispatcher pushes A, X and Y); the
  PHA/TXA/PHA/TYA/PHA + CLD stanza above is the reference form. Neither
  stable-raster recipe currently executes CLD, and on the Oscar64 side
  `rasterirq.h`'s own ISRs do not either: the KERNAL's $FF48 dispatcher and
  $EA31 service routine contain no CLD, so a handler reached through $0314
  inherits whatever D was. (An earlier version of this entry said the
  technique doc discussed the prelude; it does not.)
- Opcodes: `SED` ($F8), `CLD` ($D8) — the two instructions that set and clear
  the decimal flag.
- Pitfall: `kernal_clobbers_a_x_y` — the PHA/TXA/PHA/TYA/PHA prelude described
  in both pitfalls is the same stanza; the CLD belongs between the last PHA
  and the first handler instruction.

---

## kernal_io_mapping_dependency — KERNAL file/disk routines crash when $01 has banked out the KERNAL ROM

**Severity:** high
**Region:** both
**Triggered by registers:** R6510
**Triggered by kernal:** SETLFS, LOAD, SAVE, OPEN, CLOSE
**Triggered by techniques:** cpu_io_port_bank, kernal_file_write_seq, kernal_file_read_seq, error_channel_check, kernal_load_to_address, kernal_relative_file_io, directory_read_and_select

### Symptom

Disk or tape I/O that works in a plain BASIC or kernal environment crashes
silently when called from a demo or game that has changed $01 to enable an
all-RAM or partial-RAM banking mode. The crash is a wild branch: the
CPU fetches an opcode from RAM at $E000-$FFFF where the KERNAL ROM used to be,
executes whatever byte it finds there as an opcode, and runs on into garbage.
In some configurations the machine appears to freeze; in others it resets.

A variant: the code correctly sets $01 = $37 for the KERNAL call, but later
restores $01 to $34 (all RAM) or $35 (I/O only; BASIC and KERNAL are RAM, as
the table below shows; an earlier version said "I/O + KERNAL but no BASIC",
which is $36) without
saving and restoring the exact value it found. Subsequent KERNAL calls use the
restored value, which may not match what the KERNAL's internal routines expect.

A related issue: code banks in $35 for bitmap RAM access, then calls CHROUT.
CHROUT at $FFD2 is a three-byte JMP in KERNAL ROM. With HIRAM = 0 ($35 has
bit 1 clear), the address $FFD2 contains RAM, not ROM. The JSR executes
whatever bytes are there and branches to a garbage address.

### Mechanism

The 6510 processor port at $01 controls three memory mapping lines through the
PLA (906114):

- **Bit 0 (LORAM):** When 0, $A000-$BFFF is RAM. When 1 (and HIRAM = 1),
  $A000-$BFFF is BASIC ROM.
- **Bit 1 (HIRAM):** When 0, $E000-$FFFF is RAM. When 1, $E000-$FFFF is
  KERNAL ROM.
- **Bit 2 (CHAREN):** When 0, $D000-$DFFF is character ROM (if HIRAM or LORAM).
  When 1, $D000-$DFFF is the I/O block (VIC-II, SID, CIA1, CIA2).

The stock reset state is $01 = $37 (binary %00110111), giving LORAM=1, HIRAM=1,
CHAREN=1: KERNAL ROM at $E000-$FFFF, BASIC ROM at $A000-$BFFF, I/O at
$D000-$DFFF.

Common demo/game banking modes and their effects on KERNAL accessibility:

| $01 value | LORAM | HIRAM | CHAREN | KERNAL ROM visible? | I/O visible? |
|-----------|-------|-------|--------|---------------------|--------------|
| $37       |  1    |  1    |  1     | **Yes**             | Yes          |
| $36       |  0    |  1    |  1     | **Yes**             | Yes (BASIC hidden) |
| $35       |  1    |  0    |  1     | **No — RAM**        | Yes          |
| $34       |  0    |  0    |  1     | **No — RAM**        | Yes          |
| $33       |  1    |  1    |  0     | **Yes**             | No (char ROM)|
| $30       |  0    |  0    |  0     | **No — RAM**        | No           |

Modes $35, $34, and $30 are popular in demos because they let the CPU
see RAM at $E000-$FFFF (useful for placing time-critical code, decompression
buffers, or sprite data up high). But KERNAL ROM must be visible ($01 bit 1
HIRAM = 1) for any KERNAL call to work, including the jump-table entries
themselves. The jump table entries at $FF81-$FFF3 are three-byte JMP instructions
in KERNAL ROM. If HIRAM = 0, those addresses contain whatever the program wrote
into RAM there, not JMP instructions.

KERNAL routines also require I/O to be visible (CHAREN = 1) because they drive
CIA1/CIA2 and the IEC bus directly. The safe values for KERNAL file I/O are
$37 (stock) or $36 (no BASIC, which is fine since the KERNAL does not call
BASIC ROM during I/O). Both have HIRAM = 1 and CHAREN = 1.

### Fix

Wrap every KERNAL file I/O call with a save-and-restore of $01:

```kick
.macro KernalBankIn() {
    lda $01
    pha                     // save current banking state
    lda #$37
    sta $01                 // KERNAL + I/O + BASIC all visible
}

.macro KernalBankOut() {
    pla
    sta $01                 // restore caller's banking state
}
```

This ensures:
1. The KERNAL jump table entries are ROM (HIRAM = 1).
2. The CIA1/CIA2 I/O is visible (CHAREN = 1).
3. The exact caller's $01 value is restored after the call, not a hardcoded
   value that may not match what the caller had.

The save is to the stack (PHA/PLA). A zero-page byte also works; the stack
needs no zero-page scratch byte.

### Worked example

```kick
// BAD: LOAD called with $01 = $35 (HIRAM = 0 — KERNAL ROM is RAM).
// JSR $FFD5 executes whatever byte is in RAM at $FFD5, not the KERNAL JMP.
    lda #$35
    sta $01                 // Bank out KERNAL for bitmap buffer access
    lda #0
    ldx #<$0801
    ldy #>$0801
    jsr $ffd5               // CRASHES — $FFD5 is RAM, not KERNAL jump table

// GOOD: save $01, bank in KERNAL, call, restore.
    lda $01
    pha                     // Save current banking state ($35)
    lda #$37
    sta $01                 // KERNAL ROM + I/O visible
    lda #0
    ldx #<$0801
    ldy #>$0801
    jsr $ffd5               // LOAD — safe: $FFD5 is KERNAL ROM JMP
    pla
    sta $01                 // Restore $35 — bitmap RAM back at $E000

// BAD: restoring to a hard-coded literal rather than the saved value.
    lda $01
    pha
    lda #$37
    sta $01
    jsr $ffc0               // OPEN
    lda #$35
    sta $01                 // !! Wrong if caller had $36 or $34

// CORRECT: always PLA back, never restore to a literal.
    lda $01
    pha
    lda #$37
    sta $01
    jsr $ffc0               // OPEN
    pla
    sta $01                 // Exact pre-call value, whatever it was
```

### Cross-references

- Memory region [$0000-$0001 — Processor I/O port](../hardware/c64-memory-map.md#0000-0001--processor-io-port)
  — the 6510 processor port data register; bits 0-2 control
  LORAM/HIRAM/CHAREN. Also the Register R6510 (`c64_lookup_register $01`);
  an earlier version said the KB had no Register node for the port.
- KERNAL routines: `SETLFS` ($FFBA), `OPEN` ($FFC0), `CLOSE` ($FFC3),
  `LOAD` ($FFD5), `SAVE` ($FFD8).
- Pitfall: `kernal_assumes_sei_cleared` — the two pitfalls often occur
  together in demo loaders; OPEN trips both if the caller has disabled IRQs and banked out the KERNAL.
- `docs/hardware/c64-memory-map.md` — full PLA truth table with all 32 banking
  mode combinations.

---

## krnio_save_leaves_splat_file — a *PRG splat after krnio_save() means the emulator was stopped before the drive finished, not that SAVE is broken

**Severity:** high
**Region:** both
**Triggered by kernal:** SAVE, OPEN, CLOSE

### Symptom

An Oscar64 game calls `krnio_save(8, &state, &state + sizeof(state))` to
persist a struct to a `.d64` attached as drive 8. The function returns
`true` (apparent success) and a directory entry appears with the chosen
filename, but the entry is marked `*PRG` with 0 blocks, and the file
cannot be read back via `c1541 -read`, via the game's own `krnio_load`,
or via BASIC `LOAD"NAME",8`. It appears in two forms: no blocks allocated
at all; or blocks allocated (the free-block count drops) with no directory
record of them. Both forms were reproduced on demand by terminating x64sc
with `-limitcycles` while the 1541 was still writing, which is what the
symptom means (see Mechanism).

The `*` flag preceding `PRG` in a `c1541 -list` output is the
"improperly closed" marker: the directory entry was created, but the
DOS-side close handshake that finalises block count and clears the
splat bit never completed.

### Mechanism

Oscar64's `krnio_save()` wraps KERNAL `SAVE` ($FFD8): SETLFS plus
`JSR $FFD8`, per `kernalio.c`. That is the same routine BASIC's
`SAVE"NAME",8` invokes. The KERNAL SAVE flow snapshots a contiguous memory
block as a PRG file (two-byte load address header + raw bytes): it forces
the secondary address to $61 at $F5FA (ROM bytes A9 61 85 B9) and closes the
file through the KERNAL's own IEC close path. It is not broken. Under VICE
3.10 with true drive emulation (the default, and the only configuration
in which drive 8 exists under `-default`; with `+drive8truedrive` there is
no device 8 at all and the program never returns from its first IEC call),
`krnio_save()` of a 64-byte struct to a fresh c1541-formatted `.d64`
produces a clean 1-block PRG (`c1541 -list`: `1 "tideline" prg`, no `*`,
663 blocks free; a fresh D64 has 664, and a 66-byte file written with
`c1541 -write` leaves 663; an earlier version said 662) that reads back intact (66 bytes = load address + struct),
and `krnio_save` returns true. Built with Oscar64 2026-05-19 and run in
x64sc 3.10; an earlier version of this entry said the splat was
"observed under VICE 3.x with and without -drive8truedrive", and that
does not reproduce.

The splat arises when the emulator exits (`-limitcycles`,
`-exitscreenshot`, window close) or the program resets while the 1541 is
still writing: the directory entry has been created but the DOS-side
close that finalises the block count has not happened yet. A 64-byte SAVE
needs on the order of 1-2 M emulated cycles after autostart with true drive
on. The open/write/close pattern splats identically when cut at the same
point (measured: `*prg`, 643 blocks free), so it is not a remedy for this
symptom.

The Oscar64 sample at `samples/kernalio/filewrite.c` does NOT use
`krnio_save`. It uses the structured file API instead:

1. `krnio_setnam("@0:NAME,P,W")` — name with the `@0:` replace prefix
   and a `,P,W` (PRG write) suffix
2. `krnio_open(fnum, dev, 2)` — open a logical file on a secondary
   address that the DOS recognises as a user data channel (2)
3. `krnio_write(fnum, data, size)` — stream bytes through the channel
4. `krnio_close(fnum)` — close, which gives the DOS the explicit
   "end of file" signal that finalises the directory entry

This sequence does not rely on the KERNAL SAVE routine at all; it produces
a file with no 2-byte load-address header, reads back symmetrically with
`krnio_read`, and takes the `@0:` replace prefix.

### Fix

Give the drive time to finish. In a headless run, do not cut x64sc before
the program's own done marker appears on screen; interactively, wait for
the busy LED to go out or for `krnio_save` to return, and check the disk
only afterwards. An earlier version of this entry said to avoid
`krnio_save()`; the splat it described was the emulator being stopped
mid-write, and the same cut splats the open/write/close pattern too.

`krnio_open` / `krnio_write` / `krnio_close` is still the better fit for
arbitrary structured data (game state, score tables, scenario maps), for
its own reasons: no 2-byte load-address header in the file, a symmetric
read with `krnio_read`, and `@0:` replace semantics. Reserve `krnio_save()`
for BASIC-compatible memory snapshots (e.g. a sprite table at a
fixed address that BASIC will `LOAD` into the right place).

### Worked example

```c
// krnio_save produces a clean PRG (load address + bytes) when the drive is
// allowed to finish; measured under VICE 3.10 with true drive emulation.
krnio_setnam("TIDELINE,P,W");
bool ok = krnio_save(8,
    (const char*)&state,
    (const char*)&state + sizeof(state));
// ok == true; c1541 -list shows 1 "tideline" prg, 1 block, reads back as
// 66 bytes ($0B00 load address + the 64-byte struct).

// PREFERRED for structured data: open/write/close as in
// samples/kernalio/filewrite.c (no load-address header, symmetric read).
krnio_setnam("@0:TIDELINE,P,W");
if (krnio_open(2, 8, 2)) {
    krnio_write(2, (const char*)&state, sizeof(state));
    krnio_close(2);
}
// Read back symmetrically: setnam("TIDELINE,P,R"); open(2, 8, 2);
//                          read(2, &state, sizeof(state)); close(2).
```

The `@0:` replace prefix matters if the file might already exist.
Without it the drive refuses the open with DOS error 63 FILE EXISTS, but
`krnio_open()` still returns true, because it only reports KERNAL OPEN's
carry, which a serial device sets for device-not-present or too-many-files,
never for a DOS error. The following `krnio_write()` also reports the full
byte count, yet nothing reaches the disk and the old file is left as it was
(measured under VICE 3.10: open returned true, write returned 64, command
channel read 63, file contents unchanged; an earlier version of this entry
said the call returned false). To detect it, open the command channel
(secondary address 15) and `krnio_read` the status line after the open.

### Cross-references

- Oscar64 sample: `samples/kernalio/filewrite.c` and `fileread.c` —
  the reference pattern.
- Oscar64 header: `c64/kernalio.h` exposes both `krnio_save` (memory
  snapshots with a load address) and `krnio_open`/`write`/`close`
  (structured data).
- KERNAL routines: `SETNAM` ($FFBD), `SETLFS` ($FFBA), `OPEN`
  ($FFC0), `CHKOUT` ($FFC9), `CHROUT` ($FFD2), `CLRCHN` ($FFCC),
  `CLOSE` ($FFC3). `krnio_open` chains setlfs + open; `krnio_write`
  chains chkout + per-byte chrout + clrchn.
- Pitfall: `kernal_io_mapping_dependency` — both save APIs need the
  KERNAL ROM banked in at $E000 when called.

---

## c1541_uppercase_filename_petscii_shift — c1541 -write of an UPPERCASE c64 name stores shifted PETSCII the game can't open

**Severity:** medium
**Region:** both
**Triggered by kernal:** SETNAM, OPEN
**Triggered by techniques:** kernal_file_write_seq, kernal_file_read_seq, kernal_load_to_address, directory_read_and_select

### Symptom

A host tool authors a data file onto a `.d64` with
`c1541 -attach disk.d64 -write host.bin TDLVL00`. The file appears in the
directory, and `c1541 -read TDLVL00` round-trips it byte-for-byte. But the C64
program that opens it with `krnio_setnam("TDLVL00")` + `krnio_open(2, 8, 2)`
gets an open that appears to succeed (`krnio_open` returns true, because
KERNAL OPEN's carry reports only device-not-present and table errors, never a
DOS error), but `krnio_read` returns 0 bytes and the command channel (open
15,8,15 and read) answers `62, FILE NOT FOUND` (measured in VICE x64sc; an
earlier version of this entry said `krnio_open` returned false). Listing the
disk directory from inside the emulator (`LOAD"$",8` then `LIST`) shows the
filename rendered as graphics characters (e.g. `#####00`) instead of `TDLVL00`.
A file the *game itself* wrote with the same logical name (via `krnio_write`)
opens fine; only the host-authored file fails.

### Mechanism

`c1541` converts the host-supplied c64 filename from ASCII to PETSCII:

- **lowercase** ASCII `a-z` (0x61-0x7A) → unshifted PETSCII 0x41-0x5A, which
  render as `A-Z` in the default uppercase/graphics charset.
- **UPPERCASE** ASCII `A-Z` (0x41-0x5A) → **shifted** PETSCII 0xC1-0xDA, which
  render as graphics symbols in uppercase mode.

So `-write host.bin TDLVL00` stores the filename bytes
`0xD4,0xC4,0xCC,0xD6,0xCC,0x30,0x30`.

A C64 program (e.g. Oscar64) sends the bytes of its C-string literal to SETNAM.
The char literals `'T','D','L','V','L'` are ASCII / PETSCII-uppercase
`0x54,0x44,0x4C,0x56,0x4C`. The 1541 DOS matches directory filenames
**byte-for-byte**, so `0x54...` never matches the stored `0xD4...`, and the
drive answers 62, FILE NOT FOUND on the command channel; KERNAL OPEN itself
still returns C=0, so the C64 side sees a successful open with an empty file.

Game-written files are immune because the game both writes and reads with the
same ASCII byte sequence, so the bytes match whatever the encoding. The mismatch appears only when one side is `c1541` (host) and the
other is the game (C64). `c1541 -read` is symmetric with `-write`, so a
host-only round-trip never reveals the problem; only a real C64-side open does.

### Fix

Pass the c64 filename to `c1541` in **lowercase**. `c1541` then maps lowercase
ASCII `a-z` to unshifted PETSCII 0x41-0x5A (`'t'` (0x74) → 0x54), the bytes
the game's uppercase-ASCII C string requests, and they render
correctly as `TDLVL00` in the C64 directory.

```bash
# BAD: uppercase c64 name -> shifted PETSCII; game krnio_open("TDLVL00") returns true but reads 0 bytes (DOS error 62).
c1541 -attach disk.d64 -write tdlvl00.bin TDLVL00

# GOOD: lowercase c64 name -> 0x54... matches the game's request + renders right.
c1541 -attach disk.d64 -write tdlvl00.bin tdlvl00
```

Diagnose a suspected mismatch by listing the directory from inside the running
emulator (`LOAD"$",8` then `LIST`): a name rendered as graphics characters is
the tell. Test for the condition by reading the error channel after OPEN, or
by checking `krnio_read`'s byte count, not by testing `krnio_open`'s return
value, which is true either way. (The autostart program name's encoding does
not matter: autostart loads by directory position, not by name match.)

### Worked example

```python
# Host authoring tool (Python + c1541). The on-disk file content is identical
# either way; only the FILENAME's PETSCII encoding differs.
slot = 0
c64name = f"tdlvl{slot:02d}"      # lowercase -> matches game's krnio_setnam("TDLVL00")
# c64name = f"TDLVL{slot:02d}"    # WRONG: uppercase -> shifted PETSCII -> no match
subprocess.run(["c1541", "-attach", "disk.d64", "-write", "tdlvl00.bin", c64name])
```

### Cross-references

- KERNAL routines: `SETNAM` ($FFBD), `OPEN` ($FFC0). The 1541 DOS matches
  directory filenames byte-for-byte; SETNAM passes the bytes verbatim.
- Pitfall: `krnio_save_leaves_splat_file` — the other half of the host↔C64
  disk-data round-trip; both live in the structured-file save/load workflow,
  and both are cases where `krnio_open`/`krnio_save` return true and the
  evidence is on the disk or the command channel, not in the return value.
- Tooling: VICE `c1541 -write` / `-read` perform ASCII→PETSCII on the c64
  filename; their conversion is self-consistent, which is why a host-only
  round-trip hides the bug.
- Discovered authoring Tideline level files (`TDLVLnn`) for Phase H4. (An
  earlier version pointed to disk-testing notes in a file outside this
  repository.)

---

## getchx_petscii_remaps_return — Oscar64 getchx() delivers RETURN as $0A (not $0D) under every charmap except IOCHM_TRANSPARENT — including the default IOCHM_ASCII

**Severity:** medium
**Region:** both
**Triggered by kernal:** GETIN
**Triggered by techniques:** text_input_line

### Symptom

A key handler that tests `key == 0x0d` for RETURN never fires, so RETURN
looks dead while letter and space keys work. It shows up on a menu ("press
RETURN to start") or a confirm action: the cursor moves, letters
register, but RETURN does nothing.

### Mechanism

Oscar64's `conio` input functions (`getch`, `getchx`, `getche`) run the raw key
through `convch()`. When `iocharmap()` is set to an input map at or above ASCII
(`IOCHM_ASCII`, `IOCHM_PETSCII_1`, `IOCHM_PETSCII_2`), `convch()` rewrites
carriage return to line feed:

```c
// Oscar64 include/conio.c (convch)
if (giocharmap >= IOCHM_ASCII) {
    if (ch == 13)        // PETSCII RETURN
        ch = 10;         // delivered to your code as $0A
    ...
}
```

`giocharmap` starts at IOCHM_ASCII (`conio.c` line 3: `static IOCharMap
giocharmap = IOCHM_ASCII;`), so the remap is on unless the program calls
`iocharmap(IOCHM_TRANSPARENT)`. A program that never calls `iocharmap()` is
affected. Measured in VICE 3.10 with Oscar64 2026-05-19 (`-keybuf` with
a newline, which puts PETSCII $0D in the KERNAL buffer): raw GETIN $0D;
`getchx()` on the default map $0A; after `iocharmap(IOCHM_TRANSPARENT)` $0D;
after `iocharmap(IOCHM_PETSCII_2)` $0A. An earlier version of this entry named
only IOCHM_PETSCII_2 as the cause.

So a RETURN keypress (PETSCII `$0D`) reaches the program as `$0A`. Any comparison
against `$0D` silently misses. (The reverse map preserves `$0D` on *output*, so
printing is unaffected; only keyboard input is remapped.)

The bug hides when input can also be driven by a test harness that writes
an action code directly (e.g. a state byte) instead of going through `getchx`:
the harness path never exercises the key comparison, so RETURN looks fine in
automated tests but is broken for a real keypress.

### Fix

Accept `$0A` (or both `$0A` and `$0D`) wherever the code tests for RETURN:

```c
// bad — never matches RETURN unless iocharmap(IOCHM_TRANSPARENT) was called
if (key == 0x0d) start_level();

// good
if (key == 0x0d || key == 0x0a) start_level();
```

In a `switch`, add `case 0x0a:` alongside `case 0x0d:`.

The alternative is `iocharmap(IOCHM_TRANSPARENT)`, which disables the
rewrite. It also disables the PETSCII case-swap, so use it only when the
program wants raw PETSCII throughout.

### Cross-references

- Oscar64 `include/conio.c` (`convch`); the active map defaults to
  IOCHM_ASCII and is changed by `iocharmap()`; only IOCHM_TRANSPARENT
  disables the $0D→$0A rewrite.
- Discovered wiring RETURN-to-start on the Tideline level-select screen; the
  select→play path had only ever been exercised via the test-harness action
  byte, which masked the remap.

---

## restore_nmi_not_maskable — RESTORE drives /NMI directly; masking $DD0D does nothing, only the $0318 vector or an NMI lock neutralises it

**Severity:** high
**Region:** both
**Triggered by registers:** DD0D
**Triggered by kernal:** RESTOR, VECTOR
**Triggered by techniques:** nmi_handler_and_restore_key, nmi_sample_player

### Symptom

A demo or game drops to a cleared blue screen and `READY.` when the user
presses RUN/STOP+RESTORE, even though its init wrote `$10` (or `$7F`) to
`$DD0D` "to switch the RESTORE NMI off". Everything the program held through
the KERNAL goes with it: `$0314` is back at `$EA31`, the jiffy IRQ is running
again, `$01` is back to the stock map, the VIC is in text mode at `$0400`. The
code is still in memory, which is what the key is for.

RESTORE alone, without RUN/STOP, is quieter: a stable-raster split tears or a
sprite multiplexer misplaces for one frame per press, while `$DD0D` reads
`$00` and no CIA2 source is enabled. The KERNAL's handler ran 182 cycles at an unpredictable point in the frame, from the NMI sequence
to its `RTI`, with no cartridge, `$02A1 = 0` and no key held (rung 1: measured
in VICE x64sc 3.10 as 189 cycles across a CIA1 Timer A count, 7 of them the
trampoline described under Mechanism; the instruction path summed by hand
from the bytes gives the same 189). A program with its own NMI-timed player is not in this
case: it owns `$0318`, so the KERNAL path never runs for it, and a press hands
its handler one extra, early entry instead, spurious unless the handler
tests bit 7 of `$DD0D` before acting.

A third form: the protection was there and vanished. The program pointed
`$0318` at its own handler, then later ran the customary "put the KERNAL
vectors back" line. `JSR $FF8A` (RESTOR) copies the ROM table at `$FD30` and
writes `$FE47` back unconditionally. VECTOR with C = 0 (`$FF8D`) installs
whatever 32-byte table the caller points at (VECTOR, `$FF8D` → `$FD1A`,
copies through a 32-byte loop at `$FD20`, whose C = 0 path is `LDA ($C3),Y`
(`$FD25`) `: STA ($C3),Y : STA $0314,Y` (`$FD29`); an earlier draft put the
pair at `$FD1A`, which is the entry's `STX $C3`). So it puts `$FE47` back
when that table was captured with C = 1
before `$0318` was changed, which is the usual snapshot-then-restore idiom.
Either way `$0318` is `$FE47` again.

### Mechanism

There are two halves, and they stand on different rungs.

**The wiring — rung 4 for the circuit, rung 2–3 for the part list.** RESTORE
is one of the two keys outside the 8×8 matrix that CIA1 scans (SHIFT LOCK is
the other, and it is only LSHIFT's wire); the C64-Wiki's keyboard page has it
as "tied to the NMI line and not part of the matrix". The switch is coupled
through a capacitor, C38, to a monostable whose output pulls the 6510's /NMI
pin low for the length of its pulse. CIA2's /IRQ output is on the same pin.
The two are in parallel: either can assert /NMI, neither passes through the
other, and nothing about the key touches CIA2's FLAG pin, its interrupt
control register, or any writable bit in `$DD0D`. The monostable is one
half of the 556 dual timer at U20 on the boards whose parts lists the
C64-Wiki's motherboard page carries: ASSY 326298 (1982, schematic 326106),
250407 (1983), 250425 (1984) and 250466 (1986, schematic 252278); on the
250469 (1987 on) U20 is the 8701 clock generator and the RESTORE one-shot was
not traced for this entry. On early boards C38 is 51 pF, small enough that a
slow press does not fire the one-shot (the German C64-Wiki's cure is 4.7 nF).
No figure for the pulse length is claimed here; it was not measured. The key
was not pressed for this entry (`-keybuf` stuffs the KERNAL's keyboard
buffer, and RESTORE is not a matrix key), so the circuit itself stands on the
C64-Wiki's description; what the KERNAL does with the resulting NMI, below,
is from the bytes. An earlier draft cited "drawing 252278, reproduced in the
Programmer's Reference Guide": 252278 is the 250466's schematic and the 1982
Guide cannot contain it.

**The KERNAL's side — rung 1, from the bytes of `kernal-901227-03.bin`.**
The CPU vector at `$FFFA` holds `$FE43`. What runs from there:

| Where | Bytes | Does |
|---|---|---|
| `$FE43` | `78` `6C 18 03` | `SEI`, then `JMP ($0318)`. The `SEI` (2 cycles) is the only thing that runs before the RAM vector — harmless to a handler, since `RTI` restores P. The vector's default is `$FE47` (vector table at `$FD30`). |
| `$FE47` | `48 8A 48 98 48` | Push A, X, Y. No BRK test — that is the IRQ dispatcher's job at `$FF48`, not this one's. |
| `$FE4C` | `A9 7F 8D 0D DD` | `LDA #$7F : STA $DD0D` — mask every CIA2 source. |
| `$FE51` | `AC 0D DD` | `LDY $DD0D` — read the flags, which also clears them. |
| `$FE54` | `30 1C` | `BMI $FE72` — bit 7 set means some enabled CIA2 source fired: take the RS-232 path. |
| `$FE56` | `20 02 FD` `D0 03` `6C 02 80` | No flag. `JSR $FD02` compares `$8004-$8008` with `CBM80`; on a match, `JMP ($8002)` — a cartridge's warm-start vector. |
| `$FE5E` | `20 BC F6` | `JSR $F6BC` — the tail of UDTIM: reads `$DC01` until two reads agree. Bit 7 set (nothing in column 7): store the row in `$91`. Bit 7 clear: re-read with `$DC00 = $BD` (columns 1 and 6, where the SHIFT keys are), write the first row value back to `$DC00` (`$F6D4`), and if anything in those columns is down skip the store (`INX : BNE $F6DC`) — SHIFT held with STOP leaves `$91` unwritten. A fresh hardware sample, not the IRQ scan's leftover. |
| `$FE61` | `20 E1 FF` | `JSR $FFE1` — STOP, through `($0328)` = `$F6ED`: `LDA $91 : CMP #$7F`. Z is set only when `$91` is exactly `$7F`: RUN/STOP down and no other column-7 key with it (1, ←, CTRL, 2, SPACE, C=, Q) — a second key in that column clears another bit and blinds the check the same way a wrong `$DC00` does. |
| `$FE64` | `D0 0C` | `BNE $FE72` — not held: join the RS-232 path, which finds nothing to do, writes `$02A1` back to `$DD0D` (`$FEB6`-`$FEBB`), pulls Y, X, A and `RTI`s (`$FEBC`-`$FEC1`). |
| `$FE66` | `20 15 FD` `20 A3 FD` `20 18 E5` `6C 02 A0` | Held: RESTOR, IOINIT, the screen editor's VIC and screen reset, then `JMP ($A002)` — the BASIC warm start. |

At the branch at `$FE54` the handler decides "this was RESTORE" by finding
**no** CIA2 flag. It never sees the key. Masking FLAG, or every source, in
`$DD0D` only guarantees that the flag is absent, which is the RESTORE case. `$DD0D = $10` is a no-op twice over: bit 7 clear makes it a
CLEAR-mask write, so it clears a FLAG mask that IOINIT had already cleared,
and the key never raises that flag.

The same bytes show one more effect. The `LDA #$7F : STA $DD0D` at
`$FE4C` wipes whatever CIA2 mask the program had set, and the exit at `$FEB6`
re-enables only what `$02A1` (the KERNAL's RS-232 shadow) holds. A program
that arms a CIA2 timer NMI while leaving `$0318` at `$FE47` loses that mask
on the first RESTORE press or RS-232 event (rung 1, from the bytes; not run).

Measured (rung 1; VICE x64sc 3.10, PAL C64C: 8565 VIC-II, 8580 SID, 8521
CIAs, which is what `x64sc -default` selects, read from `-dumpconfig`:
`VICIIModel=1`, `SidModel=1`, `CIA1Model=1`; an earlier version said PAL
6569, and that the rest of the repository was checked against 3.9; it pins
3.10): a CIA2 Timer A one-shot NMI
was sent through `$0318` to a trampoline of `BIT $DD0D` and `JMP $FE47`,
preceded by a counter increment, with IRQs off and `$91` pre-set to `$00`.
After the NMI, `$91`
read `$FF`: the KERNAL's handler took the no-flag branch and `$F6BC` wrote the
keyboard row into it. The control, the same trampoline without the `BIT`,
left `$91` at `$00`: the standing flag sent it down the `BMI`. The screen
cells that displayed `$91` were decoded against the character ROM, not read
by eye. The warm-start branch itself (`$FE66` onward) was not exercised: it
needs RUN/STOP held, and a headless run has no keys.

**RUN/STOP without the IRQ.** Because `$F6BC` samples the hardware,
RUN/STOP+RESTORE warm-starts with IRQs disabled and the keyboard scan stopped.
It does need `$DC00` still driving column 7 low: IOINIT leaves
`$DC00 = $7F` (the store at `$FDAB`) and SCNKEY writes `$7F` back on exit
(`$EB42`), so the row read at `$F6BC` sees STOP on bit 7. A program that has
left another value in `$DC00` with bit 7 high blinds the check, and
RUN/STOP+RESTORE then behaves like RESTORE alone. Read from the bytes; not
measured.

### Fix

**A — take the vector (`$0318`).** `$FE43` runs `SEI` and then jumps through
`$0318`, so a handler there replaces the whole dispatch from its second
instruction on. The smallest one is a single `RTI`; from BASIC, `POKE
792,193` aims `$0318` at `$FEC1`, which is the `RTI` at the end of the
KERNAL's own handler (the byte at `$FEC1` is `$40`). Conditions and costs:

- Every press still costs 20 cycles at an arbitrary point in the frame:
  the NMI sequence (7), the `SEI` (2), the `JMP ($0318)` (5) and the
  `RTI` (6). Cycle-exact code shows it once per press. Measured (rung 1, VICE
  x64sc 3.10): CIA1 Timer A counting across a 200-cycle block of `NOP`s with
  DEN off read `$FF2C` with the CIA2 NMI masked and `$FF18` with it taken,
  through a RAM `rti` and through the `$FEC1` stub alike: 20 either way. An
  earlier draft of this entry said 13, having left out the `SEI` and the
  indirect jump.
- The handler gets control with nothing saved. The KERNAL's `PHA : TXA : PHA
  : TYA : PHA` is at `$FE47`, after the vector, not before it. A handler
  that does more than `RTI` saves what it touches.
- Do not read `$DD0D` in this handler "to be safe" if the program also uses
  CIA2 NMIs: the read discards a CIA2 flag that may have arrived, and with it
  the timer or RS-232 event it announced. If both are in play, test bit 7 of
  `$DD0D` and read it only when the handler is meant to consume the event.
- It holds only while `$0318` does. RESTOR (`$FF8A`) copies the ROM table
  and writes `$FE47` back unconditionally, and so does the warm start, which
  calls it (`$FE66`). VECTOR with C = 0 (`$FF8D`) installs whatever table the
  caller passes; the usual snapshot-then-restore idiom passes one captured
  before `$0318` was changed, and that one holds `$FE47`. That is why those
  two routines are on this entry's Triggered-by line.
- It needs the KERNAL ROM mapped in (`$01` bit 1 set). With HIRAM = 0 the CPU
  fetches `$FFFA` from RAM and the program must supply the vector there;
  `ram_under_rom_traps` in `pitfalls/banking.md` shows the pattern.

**B — the NMI lock.** The 6510's NMI input is edge-sensitive: an NMI is taken
on the high-to-low transition of /NMI, and a line that then stays low is not
taken again. Arm a CIA2 Timer A one-shot with its NMI mask set and give it a
handler that never reads `$DD0D`. The timer underflows once, CIA2 sets its IR
bit and pulls /NMI low, the handler runs once, and /NMI then stays low for as
long as the flag stands. No later source can make an edge: not a second
underflow, not the 556. The lock holds until something reads `$DD0D`.

Measured (rung 1; VICE x64sc 3.10): with the handler in the listing below, two
one-shots produced one NMI (the counter cell showed `1`); the same program
with `LDA $DD0D` in the handler produced two (`2`); and the locked program
with a single `LDA $DD0D` from the main loop before a third one-shot produced
two: the read, and nothing else, re-arms the edge. Costs: every CIA2 NMI is
forfeited (RS-232, NMI-timed digi and music players), and any code that reads
`$DD0D` (the program's own, or a KERNAL RS-232 routine) silently unlocks it.

**What does not work.** Any value written to `$DD0D`; `SEI` (it masks /IRQ
only); stopping the KERNAL IRQ scan (the NMI path samples STOP itself).

### Worked example

The pattern the registers page used to recommend. It clears a mask that is
already clear, and the key never went through the CIA:

```kick
// DOES NOTHING TO RESTORE. Bit 7 clear = CLEAR-mask write; FLAG's mask is
// already clear after IOINIT, and RESTORE never raises a CIA2 flag.
        lda #$10
        sta $dd0d
```

Fix A. Only the `SEI` at `$FE43` runs between the CPU's vector fetch and
`($0318)`, so the stub is all that a RESTORE press runs:

```kick
// Fix A: take the NMI vector. $FE43 is SEI / JMP ($0318); only the SEI runs
// before the vector, and RTI puts P back.
install_nmi_stub:
        sei
        lda #<nmi_stub
        sta $0318
        lda #>nmi_stub
        sta $0319
        cli
        rts

nmi_stub:
        rti                     // a press now costs 20 cycles (7 NMI + 2 SEI
                                // + 5 JMP ind + 6 RTI, measured) and does
                                // nothing (do not add "lda $dd0d" here if
                                // CIA2 NMIs are also in use — it discards
                                // their flag)
```

Fix B, exactly as run and measured. Cell 0 of the screen counts NMIs, cell 1
gets a `*` when the program reaches its end; `pause` busy-waits about a
second (3 × 256 × 1286 cycles, rung 3). Two one-shots, one NMI:

```kick
// lock.asm — fix B, the NMI lock. Handler never reads $DD0D, so CIA2 keeps
// /NMI low; a second Timer A underflow produces no new edge.
// Expected: cell 0 = '1', cell 1 = '*'.
BasicUpstart2(start)
* = $0810
start:
        sei
        ldx #39
        lda #$20
clr:    sta $0400,x
        dex
        bpl clr
        lda #<nmi
        sta $0318
        lda #>nmi
        sta $0319
        lda #$30                // '0'
        sta $0400
        lda #$7f
        sta $dd0d               // mask every CIA2 source
        lda $dd0d               // drop anything pending
        lda #$ff
        sta $dd04
        lda #$00
        sta $dd05               // Timer A latch = 255: 256 cycles to underflow
        lda #$81
        sta $dd0d               // Timer A underflow -> /NMI
        lda #$19
        sta $dd0e               // force load, one-shot, start
        jsr pause
        lda #$19
        sta $dd0e               // second one-shot: a second underflow
        jsr pause
        lda #$2a                // '*' = reached the end
        sta $0401
hang:   jmp hang

nmi:    inc $0400
        rti                     // no read of $DD0D: /NMI stays low

pause:  lda #3
        sta $02
p1:     ldx #0
p2:     ldy #0
p3:     dey
        bne p3
        dex
        bne p2
        dec $02
        bne p1
        rts
```

Change the handler to `inc $0400 : pha : lda $dd0d : pla : rti` and the same
program shows `2`. That variant is also the shape of fix A when the program
has its own CIA2 NMI source: the handler runs, acknowledges, returns, and the
main program continues.

The experiment behind the "absence of a flag" claim. Put this at `$0318`,
fire a CIA2 timer NMI, and the KERNAL's own handler cannot tell it from a
RESTORE press; with RUN/STOP held it would warm-start:

```kick
tramp:  bit $dd0d               // clear the CIA2 flag before the KERNAL looks
        jmp $fe47               // KERNAL NMI handler, as if from RESTORE
```

### Cross-references

- `hardware/cia-reference.md` → "NMI vector (CIA2 + RESTORE)" — the dispatch
  summary; its "Disabling RESTORE" paragraph points back here.
- `hardware/c64-registers-reference.md` → CIA2 key wiring points and quick
  lookup, corrected together with this entry; they used to name FLAG bit 4
  and recommend `$DD0D = $10`.
- `hardware/kernal-routines-reference.md` → Vectors table (NMINV `$0318`,
  ISTOP `$0328`), RESTOR (`$FF8A`), VECTOR (`$FF8D`).
- Pitfall `decimal_mode_in_irq_handler` — an NMI handler that does arithmetic
  needs `CLD` as well.
- Pitfall `ram_under_rom_traps` (`pitfalls/banking.md`) — the all-RAM case,
  where the program supplies `$FFFA` and the KERNAL dispatch is out of the picture.
- Technique `stable_raster_irq` — the routine whose once-per-press jitter is
  the RESTORE-alone symptom.

### Sources

- Commodore 64 KERNAL ROM 901227-03 (`kernal-901227-03.bin` as shipped with
  VICE), bytes read and disassembled by hand for this entry — rung 1.
- VICE x64sc 3.10, headless PAL runs of the listings above and their controls,
  screen cells decoded against `chargen-901225-01.bin` — rung 1.
- C64-Wiki, "RESTORE (Key)", https://www.c64-wiki.com/wiki/RESTORE_(Key) —
  the direct connection to the CPU, `POKE 792,193`, the edge-triggered lock.
- C64-Wiki, "Keyboard", https://www.c64-wiki.com/wiki/Keyboard — RESTORE and
  SHIFT LOCK outside the matrix.
- C64-Wiki (German), "RESTORE (Taste)",
  https://www.c64-wiki.de/wiki/RESTORE_(Taste) — the capacitor coupling
  (C38, 51 pF on early boards, 4.7 nF as the cure) and early boards'
  insensitivity to a slow press.
- C64-Wiki, "Motherboard", https://www.c64-wiki.com/wiki/Motherboard
  (fetched 2026-09-22) — the per-board parts lists: U20 = LM556/NE556 dual
  timer on ASSY 326298, 250407, 250425 and 250466, U20 = 8701 clock generator
  on 250469; schematic drawing numbers 326106 (326298) and 252278 (250466).
  Rung 2–3. An earlier draft of this list cited "drawing 252278, reproduced in
  the Programmer's Reference Guide", from memory; the Guide is from 1982 and
  252278 is the 1986 board's drawing.
- Joe Forster/STA, "Commodore 64 memory map", https://sta.c64.org/cbm64mem.html
  — `$0318` default `$FE47`, `$02A1`.

---

## raster_irq_during_serial_io — A raster IRQ armed across KERNAL disk I/O misses most frames, and rirq_stop() does not stop it

**Severity:** medium
**Region:** both
**Triggered by kernal:** OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, LOAD, SAVE
**Triggered by techniques:** stable_raster_irq, frame_sync_loop, kernal_file_write_seq, kernal_file_read_seq, kernal_relative_file_io, kernal_load_to_address, directory_read_and_select

### Symptom

A border split at rows 100 and 200 is clean while the bus is idle. While
a 2 KB sequential file is written to drive 8 the split is gone from most
frames; when it appears it is a few lines low, or a three-line white
sliver near line 240 with the rest of the border in the idle colour. A
frame counter kept in the raster handler falls behind by two frames in
three. Wrapping the file calls in `rirq_stop()` and `rirq_start()`
changes nothing. The file itself is correct: status `$00` after the
write, `$40` after the read, the read-back checksum matches.

Measured in VICE x64sc 3.10 with a true-drive 1541 on a fresh D64, an
Oscar64 `rasterirq.h` split (row 100 white, row 200 light blue) and a
`rirq_call` handler on the row-100 slot that counts entries and records
the lowest and highest `$D012` at entry; the test source is quoted on
`recipes/oscar64/high-score-persist.md`, section "A raster IRQ during
file I/O". Cycles are CIA2 timers A and B cascaded; frames are those
cycles over 19,656 (PAL) or 17,095 (NTSC), arithmetic.

| Build | Model | Write 2,048 B | Handler entries | `$D012` at entry | Read 2,048 B | Handler entries | `$D012` at entry |
|---|---|---|---|---|---|---|---|
| IRQ armed | PAL | 9,359,321 cycles, 476 frames | 145 | 101 to 240 | 5,656,966 cycles, 288 frames | 226 | 101 to 234 |
| IRQ armed | NTSC | 9,702,621 cycles, 568 frames | 169 | 101 to 241 | 5,991,068 cycles, 350 frames | 268 | 101 to 242 |
| `rirq_stop()` around each call | PAL | 9,359,424 cycles, 476 frames | 144 | 101 to 238 | 5,659,833 cycles, 288 frames | 226 | 101 to 233 |
| `rirq_stop()` around each call | NTSC | 9,702,713 cycles, 568 frames | 168 | 101 to 240 | 5,983,652 cycles, 350 frames | 270 | 101 to 247 |
| `$D01A` cleared around each call | PAL | 9,158,718 cycles, 466 frames | 0 | none | 5,553,710 cycles, 283 frames | 0 | none |
| `$D01A` cleared around each call | NTSC | 9,498,969 cycles, 556 frames | 0 | none | 5,765,998 cycles, 337 frames | 0 | none |

Idle, the same handler entered on line 101 in every one of 50 frames on
both models. Every row above ended with status `$00` after the write,
`$40` (EOF) after the read, 2,048 bytes back, checksum `F000` matching,
and `00, OK` on the error channel.

### Mechanism

The KERNAL's serial primitives run each byte with interrupts off. The
send routine at `$ED40` opens with `SEI` and exits through `CLI` at
`$EDAB`; the receive routine at `$EE13` does the same and exits at
`$EE82`; the talk turnaround at `$EDCC` to `$EDDB` is bracketed the same
way (ROM `kernal-901227-03.bin`, rung 1; `kernal_assumes_sei_cleared`
above has the census). Inside those brackets are wait loops with no
timeout: `$ED50` to `$ED5D` wait on DATA for the listener to be ready
before each byte, `$EE1B` waits on CLK for the talker, `$EDD6` waits on
CLK for the drive to take the bus. Between bytes the drive is doing its
own work, and while it is the C64 sits in one of those loops with the I
flag set. Under the monitor, the byte that follows a directory lookup
spent 1,512,351 cycles between `$ED40` and `$EDAB`, about 77 PAL frames
in one `SEI` bracket.

The VIC raster latch holds one interrupt. A match that lands inside a
bracket is delivered at the `CLI`, wherever the beam is by then, which is
the handler entering at line 240 for a slot armed at row 100. A second
match inside the same bracket is not remembered, which is the 331 PAL
frames out of 476 with no entry at all. The `rasterirq.h` slot code spins
on `CMP $D012` until the counter passes its row, so a handler that is
delivered after the counter has wrapped waits for the next pass of its
row and reads 101 again; the recorded maximum is therefore a floor on
the lateness, not its extent.

`rirq_stop()` is one instruction, `SEI` (`rasterirq.c`), and the first
serial primitive's `CLI` cancels it. That is why the second pair of rows
matches the first. Clearing `$D01A` removes the source instead of masking
the CPU, and the transfer then runs about two per cent faster, the
handler time it no longer pays.

The split in the exit screenshot at 8,000,000 cycles, mid-write: IRQ
armed on PAL, white on lines 240 to 242 only, the row-100 slot delivered
late and the row-200 slot run straight after it; IRQ armed on NTSC, white
on lines 104 to 201 against 101 to 200 idle; `$D01A` cleared, one colour
for the whole frame, white on PAL and light blue on NTSC, whichever the
border held when the register was cleared. The right border changes one
row before the left in every split, the store landing mid-line.

### Fix

Do not run file I/O under a raster effect that must stay intact. For a
game, save and load on a static screen with the raster IRQ off, and set
the screen and border to the state to be held before the first call:

```c
    vic.color_border = VCOL_BLACK;      // whatever the static screen wants
    vic.intr_enable = 0;                // $D01A: no raster IRQ source
    krnio_setnam("HISCORE,S,W");
    if (krnio_open(2, 8, 2)) {
        krnio_write(2, buf, sizeof(buf));
        krnio_close(2);
    }
    vic.intr_ctrl = 1;                  // $D019: drop a match latched meanwhile
    vic.intr_enable = 1;                // re-arm; rasterirq.h resumes on its next row
```

`rirq_stop()` is not a substitute; it cannot outlive the first byte on
the bus. If the raster IRQ must stay armed, expect it to enter late or
not at all for the length of the transfer, and do not count frames or
drive music from it across the calls: the cascaded CIA2 timer the test
used kept time, the handler did not. The transfer speed (about 216
bytes per second writing and 355 reading, either model, measured above)
is the KERNAL's; the IRQ costs it two per cent.

### Worked example

```text
// BAD: the split is expected to survive the write
rirq_stop();                     // sei -- undone at $EDAB by the first byte
krnio_open(2, 8, 2); krnio_write(2, buf, 2048); krnio_close(2);
rirq_start();
// measured: 144 handler entries in 476 PAL frames, entry as late as line 238

// GOOD: take the source away, hold the picture still, put it back after
vic.intr_enable = 0;
krnio_open(2, 8, 2); krnio_write(2, buf, 2048); krnio_close(2);
vic.intr_ctrl = 1; vic.intr_enable = 1;
// measured: 0 entries during the write, the split back on line 101 after
```

### Cross-references

- Pitfall `kernal_assumes_sei_cleared` above: where the `SEI`/`CLI`
  pairs are; this entry is what they do to a raster IRQ that is armed
  when the bus is busy.
- Technique `stable_raster_irq`, `frame_sync_loop`
  (`techniques/raster.md`): the schemes whose handler and frame counter
  this measurement stalled.
- Techniques `kernal_file_write_seq`, `kernal_file_read_seq`
  (`techniques/file-io.md`): the calls that hold the bus.
- Recipe `recipes/oscar64/high-score-persist.md`, section "A raster IRQ
  during file I/O": the test program and the same figures beside the
  save-file recipe.
- `recipes/oscar64/stable-raster-irq.md`, "What `rirq_init` actually
  does": the dispatcher shares the IRQ line with the CIA jiffy timer,
  which the brackets above stall in the same way (not measured here).

### Sources

- Commodore 64 KERNAL ROM 901227-03 (`kernal-901227-03.bin` as shipped
  with VICE), `$ED40`-`$EDB9`, `$EDC7`-`$EDDC`, `$EE13`-`$EE84`,
  disassembled for this entry, rung 1.
- VICE x64sc 3.10 `-default` with `-8` and a fresh `TEST,01` D64, PAL and
  `-model ntsc`, six builds run to completion at 40,000,000 cycles and
  again to an exit screenshot at 8,000,000; screen cells decoded against
  `chargen-901225-01.bin`, border colour read down x = 2 and x = 380,
  rung 1.
- Oscar64 `include/c64/rasterirq.c`, `rirq_start` and `rirq_stop`,
  rung 1.

---

## first_open_after_reset_hangs_on_pal — Reading a file whose OPEN failed can hang for ever: the drive answers the TALK with a 68-microsecond CLK pulse, and a badline can hide it

**Severity:** high
**Region:** PAL
**Triggered by kernal:** OPEN, CHKIN
**Triggered by techniques:** kernal_file_read_seq, kernal_file_write_seq, error_channel_check, kernal_load_to_address, directory_read_and_select

The id says "first open after reset" because that is where it was
found. The cause is not start-up: it is a read of a channel the drive
does not have. An earlier version of this entry blamed a race at the
TALK turnaround and could not say which side missed what; the drive
trace below settles it.

### Symptom

A program opens a file on drive 8 that is not on the disk and reads it.
The read never returns. The screen keeps whatever was drawn before the
call; a frame counter kept by the main loop stays at zero. The KERNAL
status byte `$90` is `$00`, so nothing is reported, and the CPU sits in
the KERNAL with the I flag set. Left for 30,000,000 cycles it is still
there.

Whether it hangs is fixed for a given binary, model and launch: a build
that hung did so in three runs out of three. A build that waits one
frame more or less before the call usually runs. On a fresh disk the
first read of a high-score file is exactly this case, which is why it
was seen at start-up.

### Mechanism

Measured in VICE x64sc 3.10 (PAL c64c, true drive emulation, default
1541-II) with the monitor's CPU history (`chis` over `c:` and `8:`),
which records both CPUs' instructions without stopping either. The
history was read at a stop 7,000 cycles into the hang, after the events
below. Three hanging builds of the platformer scaffold (10, 19 and 56
frames of wait) showed the same sequence, rung 1:

1. OPEN of `HISCORE,S,R` fails on the drive: `62, FILE NOT FOUND`. The
   drive keeps no channel for the secondary address. The KERNAL does
   not report this; OPEN returns success.
2. The read's CHKIN sends TALK and TKSA (`$62`, secondary address 2).
   The C64 releases ATN and CLK, holds DATA, and waits at `$EDD6` for
   the drive to pull CLK low.
3. The drive sees ATN go, finds it is the talker (`$7A` = 1), releases
   DATA at `$E9A1` and pulls CLK low at `$E9B3`. TALK at `$E909` then
   looks up the channel for secondary address 2 (`$D0EB`): `$022D`
   reads `$FF`, no channel, so TALK returns at once and `$EA50` releases every line. The
   drive goes back to its idle loop at `$EBE7`. CLK was low for 68
   drive cycles, measured between the two stores in all three runs:
   67 PAL C64 cycles.
4. The C64's loop at `$EDD6` is `JSR $EEA9` (`LDA $DD00`, `CMP $DD00`,
   `BNE`, `ASL`, `RTS`) and `BMI $EDD6`: 27 cycles a pass. It accepts
   CLK low only when two reads 4 cycles apart both see it.
5. In each hang a badline stopped the CPU for 43 cycles inside the
   pulse, on raster lines 179, 195 and 155 (all lines with
   `(line & 7) = 3`, the default `YSCROLL`). In the 10-frame run the
   reads before the stall saw CLK high; after it, the `LDA` saw CLK low
   and the `CMP` 4 cycles later saw it high, so the pair was refused;
   every read after that saw CLK high. The 56-frame run was the same.
   In the 19-frame run the `LDA` caught the start of the pulse and the
   stall came before the `CMP`'s read, which saw CLK high.
6. The drive is idle and will not pull CLK again. `$EDD6` has no
   timeout. The C64 waits for ever.

Why a badline is needed (rung 3, from the cycle counts above): the
reads come every 27 cycles, so a 67-cycle pulse always holds a full
pair unless something stops the CPU. A 40 to 43 cycle stall makes the
gap between two pairs 67 to 70 cycles, and the pulse fits inside that
gap when it starts in a window of about 4 to 7 cycles. That is why
most frame counts run and a few hang.

When the file exists, TALK finds the channel and holds CLK low until
`$E9BC`, about 138 drive cycles by the ROM path (rung 3, the same count
gives the 68 above). A single badline cannot hide that. Sprites on the
badline stretch the stall; that case is
`sprites_over_badlines_hang_serial_io` below.

On NTSC the pulse is 70 C64 cycles, so the window shrinks to about 1 to
4 cycles (rung 3). No NTSC run hung (below). Region stays PAL because
that is what was seen; do not read it as "NTSC is safe".

**What the frame wait did.** The wait moves the TALK's cycle against
the raster. It does not settle anything on the drive. Earlier readings
of this entry said the drive "stayed a listener" and that a monitor
read of the drive "let the run through"; the history shows the drive
did become the talker and let go 68 cycles later. A monitor stop moves
the phase by a few cycles, enough to leave or enter the window.

The ROM bytes are the same in both drive ROMs VICE ships
(`dos1541-325302-01+901229-05.bin` and `dos1541ii-251968-03.bin`,
`$D0EB`-`$D106`, `$E853`-`$EA55` and `$EBE7`-`$EBFF` compared with
Python). The C64 side is ROM code and the badline stall is VIC-II
behaviour, so nothing here depends on VICE; that a real C64 and 1541
hang the same way is inferred, not measured.

### Fix

There is no safe frame wait. Across 0 to 250 frames of wait, the PAL
build hung at 16 of 251 counts (10, 19, 22, 56, 113, 116, 143, 149,
152, 159, 183, 226, 228, 234, 240, 241). Fifty ran; fifty-six hung.

Two fixes, each measured at every wait from 0 to 60 frames on PAL and
NTSC (122 runs each, none hung):

- **Read the error channel before the file.** After the OPEN, open
  channel 15 and read it. Read the file only if the reply is `00`. A
  `62` means there is no channel to read, so the program never sends
  that TALK. Channel 15 always exists, so its own TALK gets the long
  pulse. Close channel 15 after the file, not before: closing the
  command channel closes every file on the drive, and a read after it
  got `READ 0 ST=42` from a file that was there
  (`recipes/oscar64/high-score-persist.md`, one PAL run). An earlier
  version of this fix and of the worked example closed 15 between the
  reply and the read; the runs below that measured it used a fresh disk,
  so they only took the `62` path, where no read follows.
- **Or blank the screen for the read.** Clear `$D011` bit 4, wait one
  frame (DEN is sampled on line `$30`, so the frame the bit is cleared
  in still has badlines), read, set the bit again. With no badlines the
  67-cycle pulse is always seen.

In either case check `$90` and the error channel after the read.
Nothing gets the program out once it is inside `$EDD6`: the I flag is
set, so a raster or CIA IRQ watchdog cannot fire. An NMI can;
`recipes/oscar64/sprites-off-during-disk-io.md` uses a CIA2 NMI
watchdog for the other hang of this kind.

The listings that read the file first (the platformer scaffold,
`high-score-persist`, `save-load-seq-file`, and the action-puzzle,
shmup-vertical and adventure starters) were changed to read channel 15
first, with 15 closed last (#93).

### Worked example

The runs used the platformer scaffold's listing
(`recipes/oscar64/platformer-scaffold.md`), built with
`oscar64 -tm=c64 -O2 -dDISK_WAIT_FRAMES=N`, run in x64sc 3.10 `-default
-warp +sound +autostart-delay-random -autostartprgmode 1` with a fresh
`TEST,01` D64 on the default true drive, wobble off, 12,000,000 cycles
(16,000,000 for 61 frames and up), one run per cell. "Ran" means the top
row shows a frame count and the bottom row `DRIVE: 62, FILE NOT
FOUND,00,00`; "hung" means `F 00000` and no drive line. Cells decoded
against `chargen-901225-01.bin`.

| Build | PAL, 0 to 60 frames | PAL, 61 to 250 frames | NTSC, 0 to 250 frames |
|---|---|---|---|
| listing as shipped (read, then error channel) | hung at 10, 19, 22, 56 | hung at 12 of 190 counts | none hung, 251 runs |
| error channel first, file read only on `00` | none hung | not run | none hung, 0 to 60 |
| the listing after #93: channel 15 opened after the file, read first, closed last; no wait knob, one put back for the sweep | none hung, fresh disk; none hung, disk with the file (the `00` path) | not run | none hung, 0 to 60, both disks |
| `$D011` bit 4 cleared, one frame, read, bit set | none hung | not run | none hung, 0 to 60 |

The 0, 5, 10, 20 and 50-frame cells agree with the earlier table this
replaced: ran, ran, hung, ran, ran on PAL; all ran on NTSC.

The 10-frame PAL build, one thing changed at a time, one run each
(from the earlier session; each moves the phase):

| Change | Outcome |
|---|---|
| `-iecreset 1` | hung |
| `-drive8idle 0`, `1` or `2` (no idle trap, skip cycles, trap idle) | hung, all three (this session) |
| `-drive8type 1541` in place of the default 1541-II | ran (this session) |
| `-autostart-delay 6` (12,000,000 cycles) | ran, F 206 |
| PRG written to the disk and loaded by the drive | ran, F 800 |

More binaries that did not hang, each a different phase (from the
earlier sessions; each answers for its own binary only):

| Binary | First disk call | PAL | NTSC |
|---|---|---|---|
| `templates/adventure`, autopilot build (15,435 bytes) | OPEN 2,060,200 cycles after the program's first instruction (traced, `$F34A`) | ran | ran |
| `templates/adventure`, `DISKTEST=2` build (15,161 bytes) | LOAD typed first after a cold start | ran | ran |

```text
// BAD: the file's absence is only read after the file has been read
krnio_setnam("HISCORE,S,R");
if (krnio_open(2, 8, 2))            // succeeds: OPEN does not see 62
    n = krnio_read(2, buf, 16);     // TALK to a channel the drive freed
krnio_close(2);
drive_reply("");                    // too late
// measured: F 00000 at 12,000,000 cycles, PAL, 10, 19, 22 and 56-frame builds

// GOOD: ask the drive first, read only on 00, close 15 last
krnio_setnam("HISCORE,S,R");
bool ok = krnio_open(2, 8, 2);      // the named OPEN is the device test
bool cmd = drive_ask("");           // OPEN 15, read the status line, leave 15 open
if (ok && drive_code == 0)
    n = krnio_read(2, buf, 16);
krnio_close(2);
if (cmd) krnio_close(15);           // CLOSE 15 closes every file on the drive
// measured: every wait 0 to 60 frames ran, PAL and NTSC, on a fresh disk
// and on a disk holding the file
```

`drive_reply` is the scaffold's own: it opens channel 15 with an empty
name, reads one line with `krnio_gets` and closes it. It only runs after
a named OPEN has shown a device answers (`recipes/oscar64/high-score-persist.md`
explains why).

### Cross-references

- `recipes/oscar64/high-score-persist.md`, "A start-up hang seen in
  VICE": the first trace of the same spin, with the byte timings of
  the OPEN and the directory search.
- `recipes/oscar64/platformer-scaffold.md`, `DISK_WAIT_FRAMES`: the
  listing the runs above were built from.
- `formats/iec-disk-reference.md`, "Drive-Not-Ready and Timeout Errors":
  the KERNAL's one timeout and the waits that have none.
- Pitfall `badline_cycle_loss` (`pitfalls/raster-and-badline.md`): the
  40 to 43 cycle stall.
- Pitfall `sprites_over_badlines_hang_serial_io` below: the same kind of
  miss inside a byte, where sprites lengthen the stall.
- Pitfall `kernal_assumes_sei_cleared` above: the `SEI` bracket the spin
  sits in.
- Technique `error_channel_check` (`techniques/file-io.md`): the status
  read the fix moves ahead of the file read.

### Sources

- Commodore 1541 DOS ROMs 325302-01 + 901229-05 and 251968-03 as
  shipped with VICE, `$D0EB`-`$D106`, `$E853`-`$EA55`, `$EBE7`-`$EC2D`,
  disassembled with da65 for this entry, rung 1.
- Commodore 64 KERNAL ROM 901227-03, `$EDC7`-`$EDDC` and
  `$EEA9`-`$EEB2`, rung 1.
- VICE x64sc 3.10, 2026-09-24: CPU history of both CPUs in three
  hanging PAL builds; 746 runs of the scaffold at waits 0 to 250 on PAL
  and NTSC and of the two fixed builds at 0 to 60; the idle-method and
  drive-type runs. Rung 1.
- VICE x64sc 3.10, 2026-09-22: the first monitor session and the
  `-iecreset`, `-autostart-delay` and load-from-disk runs. Rung 1.

---

## sprites_over_badlines_hang_serial_io — Sprites on the same lines as badlines during a KERNAL disk read make the C64 miss a clock pulse and wait for ever

**Severity:** high
**Region:** both
**Triggered by registers:** D015, D011
**Triggered by kernal:** IECIN, CHRIN, CHKIN, OPEN, CLOSE, LOAD
**Triggered by techniques:** kernal_file_write_seq, kernal_file_read_seq, kernal_load_to_address, error_channel_check, sprite_multiplex_8, sprite_multiplex_24, sprite_multiplex_game

Measured in VICE x64sc 3.10 with true drive emulation, not on a real
C64 and 1541 (rung 1, VICE only). VICE's default drive 8 is a 1541-II
(`Drive8Type=1542`, `formats/iec-disk-reference.md`); an earlier
version of this line said a 1541. `-drive8type 1541` gave the same
thresholds (below).

### Symptom

A game saves its high-score file with its sprites on screen, and the
save never returns. The screen keeps its last frame. Music, raster
splits and anything else driven by an interrupt stop, because the C64
is inside a KERNAL serial routine with the I flag set. `$90` is `$00`,
so nothing is reported. The same save with the sprites off, or with the
screen blanked, completes. With fewer sprites, or on the other video
standard, it may complete, or hang a few saves later.

### Mechanism

**What was measured.** A test program (Oscar64, stock KERNAL, its IRQ
running) enables N solid sprites at Y 100, drawn on raster lines 101 to
121 over the badlines at 107 and 115. It then does 20 rounds of: scratch
`TEST` on the command channel, write a 5-byte SEQ file, read the status
line. Each round paints a cell on the bottom text row: white when it
starts, green when the drive answered `00`. A hung round is the white
cell left at the end of 150,000,000 cycles; a round took 5,000,000 to
6,000,000. Run with `x64sc -default -warp +autostart-delay-random` and a
fresh D64. PAL is the default c64c (8565 VIC-II, 8521 CIA); NTSC is
`-model ntsc` (6567R8, 6526). Each cell had three runs, and the three
always agreed to the round, so they are one sample, not three: as in
`first_open_after_reset_hangs_on_pal` above, the outcome is fixed for a
given binary, model and launch.

| Sprites on | PAL c64c | NTSC 6567R8 |
|---|---|---|
| 0 | 20 of 20 | 20 of 20 |
| 1 | 20 of 20 | 20 of 20 |
| 2 | 20 of 20 | 20 of 20 |
| 3 | hung in round 1 | 20 of 20 |
| 4 | hung in round 9 | hung in round 1 |
| 5 | hung in round 3 | hung in round 1 |
| 6 | hung in round 1 | hung in round 4 |
| 7 | hung in round 1 | hung in round 1 |
| 8 | hung in round 1 | hung in round 4 |
| 8 at Y 0: from line 1, no badline under them | 20 of 20 | 20 of 20 |
| 8 at Y 250: from line 251, in the lower border | 20 of 20 | hung in round 1, a different hang (below) |
| 8, screen blanked (`$D011` bit 4 off) | 20 of 20 | 20 of 20 |
| 8, `$D015` = 0 around each disk call | 20 of 20 | 20 of 20 |

Badlines fall on lines 48 to 247 (`$30` to `$F7`), so Y 0 and Y 250
put no badline under the sprites (arithmetic from the measured start
line). On `-model c64` (6569, 6526) the PAL column repeated for Y 0,
Y 250, blanked and sprites-off.

**The CIA model does not matter; the video standard does.** The 0 to 8
sprite rows at Y 100 were run once more on six machines: PAL c64c
(8521s), PAL c64c with `-cia1model 0 -cia2model 0` (6526s), `-model
c64` (6569, 6526s), `-model c64 -cia1model 1 -cia2model 1`, NTSC
(6526s) and NTSC with `-cia1model 1 -cia2model 1`. Every PAL machine
gave the PAL column above to the round, and both NTSC machines the NTSC
column. So neither CIA model nor the 8565-versus-6569 VIC-II changes
the outcome; PAL hangs from 3 sprites, NTSC from 4. That the hang
survives a new CIA1 on NTSC also separates it from
`kernal_eoi_wait_misses_timer_b_on_old_cia` below, which a new CIA1
removes. With `-drive8type 1541` in place of the default 1541-II, the
thresholds were the same and the round moved: PAL 3 to 8 sprites hung in
rounds 12, 6, 8, 2, 3 and 1; NTSC 4 to 8 in rounds 1, 1, 1, 2 and 1. The
round depends on how the run starts: launched under the remote
monitor without `+autostart-delay-random`, the 8-sprite PAL build hung
in round 1 once and round 2 once, and the 3-sprite PAL build in round 8
or later. Whether a build hangs did not change.

The review of the shmup-vertical starter (#39) measured the game
itself, with 11 multiplexed sprites: it hung on PAL in 1 of 3 runs (PC
`$ED55`, in the send routine) and on NTSC in 3 of 3 (PC `$EE5A` to
`$EE63`). With the sprites on and the screen blanked it passed 3 of 3 on
each model. Those runs are the reviewer's and were not repeated here;
the send-side hang at `$ED55` was not reproduced by the test program.

**Where it stops.** Six hangs were stopped with the remote monitor: 8
sprites on PAL and NTSC, 6 on PAL and NTSC, 4 on NTSC, 3 on PAL:

- The C64 is in ACPTR, the KERNAL's receive routine (`$EE13`, reached
  through IECIN `$FFA5`), in the bit loop at `$EE5A` to `$EE63`, which
  waits for CLK to go high. The bit counter `$A5` is 1: the C64 has
  counted seven bits and waits for the eighth. This held in all six.
- The drive's `$1800` reads `$0C` in all six: it holds CLK low and
  waits for the listener to pull DATA, the acknowledgement that the
  byte arrived. In the five stops where the drive's stack was read, its
  return address (`$E989` or `$E98C`) is inside the loop at `$E987` to
  `$E98F` that runs after the eighth bit.

So the drive sent eight bits and the C64 saw seven. Neither loop has a
timeout, so both wait for ever.

**The drive's pulse (rung 1 bytes, rung 3 arithmetic).** In the 1541
ROM (`dos1541-325302-01+901229-05.bin`; the default 1541-II's
`dos1541ii-251968-03.bin` has the same bytes in both ranges), the bit loop at `$E95C` puts a
bit on DATA, releases CLK at `$E9B7` (the bit is valid), then runs
`LDA $23`, `BNE`, `JSR $FEF3`, `JSR $FEFB`, and pulls CLK low again at
`$E9AE`. `$FEF3` is a delay loop (`LDX #$05`, `DEX`, `BNE`); it runs
when `$23` is 0, and `$23` read `$00` in the monitor. From the store
that releases CLK to the store that pulls it, by instruction count, is
75 drive cycles: 75 µs at the drive's 1 MHz, 74 PAL or 77 NTSC C64
cycles. The low half of the bit is 114 to 116 µs by the same count.
The period, 189 to 191 µs, agrees with the 188 to 199 µs measured on
the bus for most bits in `formats/iec-disk-reference.md` (a trace, not
this arithmetic).

**The C64's sample (rung 1 bytes).** The loop at `$EE5A` is `LDA
$DD00`, `CMP $DD00`, `BNE`, `ASL`, `BPL`: 15 cycles an iteration, and
it accepts CLK only when two reads 4 cycles apart agree. It must land
both reads inside the 74-cycle (PAL) window.

**Why the sprites matter (inferred, not traced).** A badline alone
stops the CPU for 40 to 43 cycles (`badline_cycle_loss`), which leaves
about 30 cycles of the window. Each sprite on the line adds its own
fetch cycles next to the badline's. When the stop covers nearly all of
the window, the loop misses a whole high pulse. The measurements fit
this: no hang without a badline under the sprites (Y 0, blanked), none
without sprites, and a threshold in the number of sprites. Where each
sprite's fetch cycles sit relative to the badline, and why the NTSC
threshold is one sprite higher, were not traced here; the 6567R8's
65-cycle line would give a longer gap, but that is not measured.

**LOAD hangs the same way (#107).** LOAD's serial path calls ACPTR
three times, at `$F4D5`, `$F4E0` and `$F501` (rung 1, the ROM bytes). A
second test program, the save test's sprites and CIA2 NMI watchdog
around `krnio_load` of a 1,000-byte PRG, ran 5 LOADs with the sprites
off around each call, then 5 with them left on. One run per cell;
each cell reads "sprites off / sprites left on":

| Sprites | PAL c64c | NTSC 6567R8 |
|---|---|---|
| 0 | 5 of 5 / 5 of 5 | 5 of 5 / 5 of 5 |
| 3 | 5 of 5 / hung | 5 of 5 / 5 of 5 |
| 4 | not run | 5 of 5 / hung |
| 8 | 5 of 5 / hung | 5 of 5 / hung |

The thresholds are the save test's: 3 sprites on PAL, 4 on NTSC. An
earlier version of the trigger lines named only the byte and channel
routines, so `c64_check_compatibility` did not raise this pitfall
beside `kernal_load_to_address`; a game that loads its next level with
sprites on hits it.

**A different hang in the same runs.** 8 sprites at Y 250 hung on NTSC
in round 1, in the other wait inside ACPTR: `$EE30` to `$EE3A`, where
the C64 waits for the drive's CLK or for CIA1 timer B to signal EOI.
Timer B was stopped (`$DC0F` = `$08`, one-shot, not running) at its
latch value `$01FF`: it had run out, and the loop had not seen its
flag. With `-cia1model 1` (a new CIA) the same build passed 20 of 20
twice. It is not a sprite-and-badline hang: the sprite DMA put the
loop's `$DC0D` read in the one cycle where VICE's old CIA loses the
timer B flag. Measured and explained in
`kernal_eoi_wait_misses_timer_b_on_old_cia` below (#69).

### Fix

- **Turn the sprites off around every disk call.** Write 0 to `$D015`
  before the call and restore it after. Measured: 20 of 20 on both
  models, and part A of `recipes/oscar64/sprites-off-during-disk-io.md`.
- **Or blank the screen.** Clear `$D011` bit 4 before the call and set
  it after; with no badlines there is nothing for the sprite fetches to
  add to. Measured: 20 of 20 on both models with 8 sprites on.
- **Stop the multiplexer too.** ACPTR ends with `CLI` at `$EE82`, and
  the send routine with `CLI` at `$EDAB` (rung 1), so interrupts run
  between bytes. A multiplexer IRQ that writes `$D015` there turns the
  sprites back on before the next byte (rung 3, from the ROM, not
  measured). Stop its raster interrupt as `raster_irq_during_serial_io`
  above describes (clear `$D01A`), or make it write 0 while a flag is
  set.
- Do not rely on where the sprites are. Sprites at Y 0 ran here, but a
  game's sprites move, and three over a badline were enough on PAL.

### Worked example

```c
// BAD: the multiplexer's sprites stay on while the high score is saved
krnio_setnam("HISCORE,S,W");
if (krnio_open(2, 8, 2)) krnio_write(2, rec, sizeof(rec));
krnio_close(2);
// measured (test program, 8 sprites on lines 101-121): hangs in ACPTR
// at $EE5A, $A5 = 1, PAL round 1 and NTSC round 4

// GOOD: raster IRQ off, sprites off, save, then both back on
vic.intr_enable = 0x00;              // $D01A: the multiplexer cannot run
vic.spr_enable = 0x00;               // $D015: no sprite fetches
krnio_setnam("HISCORE,S,W");
if (krnio_open(2, 8, 2)) krnio_write(2, rec, sizeof(rec));
krnio_close(2);
vic.spr_enable = saved_enable;
vic.intr_enable = 0x01;
// measured with the $D015 line alone (test program, no multiplexer):
// 20 of 20 saves on PAL and NTSC. The $D01A line is from the ROM (CLI
// between bytes), not measured here.
```

`recipes/oscar64/sprites-off-during-disk-io.md` runs both halves in one
program and reports `HUNG` from a CIA2 NMI watchdog, since no IRQ can
fire inside the receive loop.

### Cross-references

- Recipe `oscar64/sprites-off-during-disk-io`: the reproduction and the
  fix, pinned on PAL and NTSC.
- Pitfall `raster_irq_during_serial_io` above: the `SEI` brackets and
  the `$D01A` fix for the raster IRQ.
- Pitfall `first_open_after_reset_hangs_on_pal` above: another wait
  without a timeout, and why one run of a build is one sample.
- Pitfall `badline_cycle_loss` (`pitfalls/raster-and-badline.md`): the
  40 to 43 cycles.
- `formats/iec-disk-reference.md`, "IEC bit timing, measured": the
  bit period when the drive sends.
- `recipes/oscar64/high-score-persist.md`: a save with no sprites on,
  the path this pitfall adds sprites to.

### Sources

- Commodore 64 KERNAL ROM 901227-03, `$EE13` to `$EE84`, disassembled
  in the VICE monitor for this entry, rung 1.
- Commodore 1541 DOS ROM 325302-01 + 901229-05 as shipped with VICE,
  `$E909` to `$E9C8` and `$FEF3` to `$FF00`, disassembled for this entry,
  rung 1.
- VICE x64sc 3.10, 80 runs of the test program across the conditions in
  the table and six remote-monitor stops, 2026-09-23 and 2026-09-24,
  and 72 more for the CIA-model and drive-type rows (0 to 8 sprites on
  eight machine setups, one run each), 2026-09-24, rung 1.
- `dos1541ii-251968-03.bin`, the default drive's ROM: `$E909` to `$E9C8`
  and `$FEF3` to `$FF00` are byte-identical to the 1541 ROM cited
  above (compared with Python), so the pulse arithmetic holds for both.
- The review of #39's shmup-vertical starter, point 4: the game runs
  and the first minimal repro. Reported there, not repeated here.

---

## kernal_eoi_wait_misses_timer_b_on_old_cia — On an old 6526, sprite DMA can put the KERNAL's EOI poll in the one cycle where the timer B flag is lost, and the last byte of a read never arrives

**Severity:** high
**Region:** both
**Triggered by registers:** DC0D, DC06, D015
**Triggered by kernal:** IECIN, CHRIN, GETIN, LOAD
**Triggered by techniques:** kernal_file_read_seq, error_channel_check, kernal_load_to_address, directory_read_and_select, sprite_multiplex_8, sprite_multiplex_24, sprite_multiplex_game

Measured in VICE x64sc 3.10 with a true-drive 1541 and the old CIA
model (`-cia1model 0`), not on a real 6526 (rung 1, VICE only).

### Symptom

A disk read with sprites on screen stops at the last byte of a file or
of the drive's status line. The screen keeps its last frame and
interrupts stop, because the C64 is inside ACPTR with the I flag set.
`$90` is `$00`. It happens on a machine with the old 6526 CIA and not
on one with a 6526A or 8521; in VICE, `-model c64` and `-model ntsc`
have the old CIA, the default c64c the new one. The sprites need not be
over a badline: sprites in the lower border are enough.

### Mechanism

**The wait (rung 1, ROM bytes).** After the drive signals it is ready to
send, ACPTR releases DATA and starts CIA1 timer B one-shot (`$EE20` to
`$EE27`: `$DC07` = `$01`, `$DC0F` = `$19`). It then polls at `$EE30`:
`LDA $DC0D`, `AND #$02`, `BNE $EE3E`, `JSR $EEA9`, `BMI $EE30`. The loop
leaves when CLK goes low (a normal byte) or when the timer B flag is
set (EOI: the drive is holding back the last byte). The loop reads
`$DC0D` once every 35 cycles, and a read clears the flag. On EOI the
drive waits for the C64 to acknowledge by pulling DATA (`$E941` to
`$E949` in the 1541 ROM, the loop the drive was in when stopped for
#69). If the C64 never sees the flag, neither side moves.

The KERNAL writes only the high byte of the latch. The low byte is
whatever `$DC06` last held: `$FF` from reset, so the count is `$01FF`
(read in the monitor during the #69 hang). The tape routines write
`$DC06` (`$F93D`, `$FBB1`), and so does any program that uses timer B.

**The lost flag (rung 1, probe).** The probe below copies `$EE20` to
`$EE2D` instruction for instruction and polls `$DC0D` in a loop of the
same 35 cycles, with the display blanked so no DMA stalls the CPU. It
repeats with the latch at `$01E0 + j` for j = 0 to 35, which moves the
underflow across every phase of the loop, and marks each trial green
(flag seen) or red (no flag in 1,400 cycles). Screenshot cells measured
with PIL, one run per model:

| Model | Phases that lost the flag |
|---|---|
| `-model c64 -cia1model 0` (6569, 6526) | j = 3 only (latch `$01E3`) |
| `-model ntsc -cia1model 0` (6567R8, 6526) | j = 3 only |
| `-model c64c -cia1model 0` | j = 3 only |
| each of the three with `-cia1model 1` (8521) | none of 36 |

One read phase in 35 loses the flag, which is a one-cycle window. VICE's
source gates a timer B bug on the old model: an ICR read in the cycle
before a timer B underflow loses the flag (`cia_revision_irq_one_cycle_late`
in `pitfalls/cia.md` cites it). The probe fits that rule. The stock
latch `$01FF` is j = 31, which saw the flag on every model: with no
stall, the stock KERNAL is safe.

**What moves the phase (rung 1, trace).** The KERNAL runs this wait with
the I flag set, so only VIC-II DMA can delay the loop's reads. A delay
of `d` cycles between the timer start and the read near the underflow
moves that read `d` cycles later. From the probe, the flag is lost when
`d` is 28, 63, 98 or 133 cycles (28 plus a multiple of 35; arithmetic
from j = 31 against j = 3).

A test program (the #43 program, `recipes/oscar64/sprites-off-during-disk-io.md`
with 8 sprites at Y 250 on lines 251 to 271, part B only, 20 rounds of
scratch, 5-byte SEQ write and status read) hung in round 12 on
`-model c64 -cia1model 0`, in 3 of 3 runs. A VICE trace of the third run
(`tr exec ee27`, `tr exec ee30`, `tr exec ee3e`) shows 491 timer starts
and 24 EOI waits:

- In the hung wait, the timer started on line 264. The polls on lines
  265 to 271 came 54 cycles apart instead of 35: 8 sprites cost 19
  cycles a line, 133 cycles in all. The read near the underflow landed
  516 cycles after the `STA $DC0F`, the one the probe predicts is lost
  (its `$01E3` loss at 488 plus the 28-cycle latch difference). The
  flag was never seen; the loop ran until the trace stopped.
- None of the other 23 EOI waits had a read at 516. Each saw the flag
  at its first read after 516, 523 to 574 cycles after the start; no
  earlier read in them came later than 499.

The same build passed 20 of 20 on `-model c64 -cia1model 1` and on the
default c64c (one run each), and on `-model ntsc -cia1model 0` (two
runs). The NTSC pass is phase, not safety: the #69 build, a slightly
different binary, hung on NTSC in round 1 in 3 of 3 runs and passed
with `-cia1model 1`.
Which binary and model hang is a lottery set by where the sprites sit
when each EOI wait starts.

**Why badlines alone do not do it (rung 3).** A badline stops the CPU
for 40 to 43 cycles (`badline_cycle_loss`). The wait is about 8 lines
long, so it holds at most two badlines: 0, 40 to 43, or 80 to 86
cycles, none of which is 28, 63 or 98. Sprite DMA can make other
totals: 19 cycles a line for 8 sprites here. This holds for the stock
latch `$01FF` only.

**The same loop elsewhere (rung 3, not measured).** The send routine
polls the same way at `$ED9F` with latch `$04FF`. There the timer only
matters when the listener never acknowledges; a lost flag would turn
the `$03` timeout into a hang. With a latch low byte other than `$FF`,
the no-stall phase can itself be the lost one: `$E3` (measured, the
probe's j = 3), and by the same arithmetic `$C0`, `$9D`, `$7A`, `$57`,
`$34` and `$11`.

Whether a real 6526 loses the flag this way is not measured here. VICE's
model is the only source this page has for it.

### Fix

- **Turn the sprites off around every disk call.** Write 0 to `$D015`
  before the call and restore it after, as for
  `sprites_over_badlines_hang_serial_io` above. With no sprite DMA the
  only stall is a badline, which cannot reach the lost phase with the
  stock latch. Measured: the hanging build with this change passed 20
  of 20 on `-model c64` and `-model ntsc`, both `-cia1model 0`, one run
  each; so did the same with the screen blanked too.
- **Put `$FF` back in `$DC06` before disk calls** if the program uses
  CIA1 timer B. The KERNAL keeps whatever low byte it finds.
- **Know which CIA you have.** `recipes/kickassembler/cia-revision-detect.md`
  tells the old 6526 from the others at start-up. In VICE's new-CIA
  model this wait is safe with sprites on; the sprite-and-badline hang
  above is not.
- A CIA2 NMI watchdog, as in the sprites-off recipe, turns the silent
  hang into a message. It does not recover the transfer.

### Worked example

The probe. It prints 36 cells on the top row: green where the flag was
seen, red where it was lost. `$C000 + j` holds the colour, `$C040 + j`
the loop counter left at exit.

```asm
// Timer B flag loss probe: the KERNAL ACPTR EOI wait ($EE20-$EE3A),
// same start sequence and same 35-cycle $DC0D read period, with
// timer B latch $01E0+j for j = 0..35 and a bounded loop.
BasicUpstart2(start)
.const N = 36
* = $0810
start:
        jsr $e544               // clear screen
        sei
        lda #$7f
        sta $dc0d
        sta $dd0d
        lda $dc0d
        lda #0
        sta $d015
        lda $d011
        and #$ef
        sta $d011               // blank: no badlines
        ldx #3                  // wait three frames so DEN=0 takes hold
!w:     lda $d012
        bne !w-
!w2:    lda $d012
        beq !w2-
        dex
        bne !w-
        ldy #0
trial:  tya
        clc
        adc #$e0
        sta $dc06               // latch low
        ldx #40                 // loop bound, set before the copy
        // --- the KERNAL's $EE20-$EE2D, instruction for instruction ---
        lda #$01
        sta $dc07
        lda #$19
        sta $dc0f
        jsr $ee97
        lda $dc0d
        // --- 35-cycle loop, $DC0D read at its start as at $EE30 ---
loop:   lda $dc0d               // 4
        and #$02                // 2
        bne seen                // 2
        dex                     // 2
        beq lost                // 2
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop
        nop                     // 20
        jmp loop                // 3  = 35
seen:   lda #5                  // green
        .byte $2c
lost:   lda #2                  // red
        sta $d800,y
        sta $c000,y
        txa
        sta $c040,y
        lda #160
        sta $0400,y
        iny
        cpy #N
        bne trial
        lda $d011
        ora #$10
        sta $d011
        lda #0
        sta $d020
forever: jmp forever
```

Run with `x64sc -default -warp +sound -autostartprgmode 1 -limitcycles
6000000 -model c64 -cia1model 0`: cell 3 is red, the other 35 green.
With `-cia1model 1` all 36 are green.

In a game, the fix is the same line as for the badline hang:

```c
// BAD: sprites stay on in the lower border while the status is read
krnio_gets(15, reply, sizeof(reply));
// measured (-model c64 -cia1model 0, 8 sprites on lines 251-271):
// hung at an EOI on channel 15 in round 12, polling $EE30 for ever

// GOOD
vic.spr_enable = 0x00;              // $D015: no sprite DMA
krnio_gets(15, reply, sizeof(reply));
vic.spr_enable = saved_enable;
// measured: 20 of 20 rounds, -model c64 and -model ntsc, old CIA
```

### Cross-references

- Pitfall `sprites_over_badlines_hang_serial_io` above: the other hang
  in the same receive routine, and the same fix. That page's "A
  different hang in the same runs" is this one.
- Pitfall `cia_revision_irq_one_cycle_late` (`pitfalls/cia.md`): the
  two CIA models in VICE and the source that gates the timer B bug.
- Recipe `kickassembler/cia-revision-detect`: telling the old 6526 apart.
- `hardware/kernal-routines-reference.md`, "CIA1 timer B": which KERNAL
  routines start the timer.
- `formats/iec-disk-reference.md`, "EOI (End Or Identify)": the
  handshake the lost flag breaks.

### Sources

- Commodore 64 KERNAL ROM 901227-03, `$ED92` to `$EDAC` and `$EE13` to
  `$EEB2`, disassembled with da65 for this entry, rung 1.
- VICE x64sc 3.10, the probe above on six model settings, and the
  test program and its two fixed builds in 14 runs, one of them
  traced, 2026-09-24, rung 1.
- Issue #69: the NTSC hang, the monitor stop at `$EE30`-`$EE3A`, the
  timer B state (`$01FF`, `$DC0F` = `$08`) and the drive's return
  address `$E943`. Reported there, not repeated here.

---

## page_table_assumes_consecutive_sectors — A program that computes a file block's position as first sector plus n reads sectors that are not in the file

**Severity:** high
**Region:** both
**Triggered by techniques:** story_file_virtual_memory_paging, drive_code_upload_and_job_queue

### Symptom

Random access to a file by track and sector returns garbage for every
block but the first. The first block is right, so the directory lookup
looks correct.

### Mechanism

The 1541's DOS does not put a file's blocks on consecutive sectors. It
leaves a gap between one block and the next; the usual account is that
this gives the drive time to hand a block over before the next one
passes under the head (not measured here). In the measurement below the
file started on track 17, beside the directory on track 18. The only
record of where block `n` is lies in block `n - 1`'s first two bytes. Computing `(t0,
s0 + n)` reads whatever that sector holds: another file, or a sector
the disk has never written.

Measured in VICE x64sc 3.10 with 1541 emulation, both models, with the
recipe below: a 24-block SEQ file written to a freshly formatted disk
started at 17/00 and went on 17/10, 17/20, 17/08, 17/18. The guess
`17/01` for block 1 read a sector whose 254 data bytes all differed from
block 1's, and the guess was wrong for all 23 blocks after the first.

### Fix

Build the table from the chain: read each block once, in order, and
record where the next one is. A program that owns its disk layout can
instead write its data with its own sector order (drive code, or `U2`
block writes of sectors it has allocated) and then compute positions,
because it chose them.

### Worked example

```c
// BAD: block n assumed to follow block 0 on the same track
t = t0;
s = s0 + n;

// GOOD: the chain, walked once when the file is opened
for (n = 0, t = t0, s = s0; t != 0; n++) {
    pt_t[n] = t; pt_s[n] = s;
    read_block(t, s, blk);          // U1 5 0 t s, 256 bytes
    t = blk[0]; s = blk[1];
}
```

```text
chain on a fresh disk   17/00 17/10 17/20 17/08 17/18 ...
guess for block 1       17/01: 254 of 254 data bytes wrong
```

### Cross-references

- Technique `story_file_virtual_memory_paging` (`docs/techniques/file-io.md`): the page table and the cache
- Recipe `docs/recipes/oscar64/story-paging.md`: the chain and the refuted guess
- Technique `drive_code_upload_and_job_queue` (`docs/techniques/file-io.md`): reading sectors by track and sector from drive code, where the same table is needed
