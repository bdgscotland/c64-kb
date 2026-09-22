---
category: kernal
---

<!-- doc-type: pitfall-reference -->

# KERNAL and I/O Pitfalls

Most pitfalls in this document share a common thread: they arise from
the KERNAL's implicit contract with the surrounding hardware state (the final
entry is a host-tooling/PETSCII-encoding trap in the same disk-I/O workflow). The KERNAL
was written assuming a specific execution environment — interrupts enabled,
registers free to clobber, the CPU memory map at its stock $37 configuration,
and decimal mode cleared. Each entry below describes one way that assumption
collides with the real-world context of a demo or game that has customised
IRQs, banked memory, or BCD arithmetic.

---

## kernal_assumes_sei_cleared — KERNAL re-enables interrupts internally; calling under SEI breaks IRQ discipline

**Severity:** high
**Region:** both
**Triggered by kernal:** SETLFS, OPEN, LOAD, CHKIN, CHKOUT
**Triggered by techniques:** stable_raster_irq

### Symptom

A raster IRQ scheme runs cleanly until the code issues a disk or tape I/O call.
Immediately after the JSR to OPEN, LOAD, or SETLFS, the raster split collapses:
color bars bleed, sprites misplace, or the entire display tears. In more subtle
cases the raster handler appears to execute twice on the same frame, or the
stable-raster double-IRQ polling loop hangs indefinitely. With tape routines the
symptom is often a complete machine hang — the KERNAL is waiting for a
keyboard character inside CLI context, the raster IRQ fires at an unexpected
stack depth, and the machine can no longer process RESTORE.

A variation: the code wraps a KERNAL call in SEI to protect a critical section.
The routine returns normally but the critical section's register state has been
scrambled — the KERNAL's own internal CLI re-enabled IRQs and the raster handler
fired mid-section.

### Mechanism

Many KERNAL file I/O routines contain one or more CLI instructions in their
bodies. This is by design: OPEN, LOAD, and SAVE can take tens of thousands of
cycles (an IEC disk LOAD at standard speed takes roughly 1 second per kilobyte),
and the jiffy clock IRQ at $EA31 must continue running during that time to keep
the 60/50 Hz time base accurate and to service the keyboard queue. The KERNAL
authors assumed the caller had IRQs enabled at the time of the JSR — the machine
boots with CLI, BASIC runs with CLI, and the KERNAL's own IRQ handler at $EA31
is designed to be re-entrant only in specific ways.

When a demo or game installs a custom raster IRQ scheme, the raster handler's
stack discipline assumes IRQs arrive only when the CPU is in the main loop. If
the main loop calls OPEN under SEI and the KERNAL executes CLI, the raster IRQ
fires with the stack at an unexpected depth. The handler RTIs into the middle of
the KERNAL routine, and the KERNAL either hangs or corrupts its own zero-page
workspace because the handler saved new state on top of the KERNAL's
partially-built stack frame.

SETLFS does not contain CLI (it merely stores three values in zero page), but
OPEN, LOAD, SAVE, CHKIN, and CHKOUT all drive the IEC bus with interrupts
enabled.

### Fix

Never call KERNAL file I/O routines from inside a raster IRQ handler. The IRQ
handler is the wrong context for long, unpredictable-duration operations.

Leave IRQs enabled (CLI) when issuing KERNAL file I/O. The raster IRQ will
fire during the operation, but as long as the handler is reentrant-safe this
is harmless. If a critical section must use SEI, complete it before the KERNAL
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
// OPEN executes CLI internally; the raster scheme re-enters at wrong stack depth.
raster_irq_bad:
    lda #WHITE
    sta $d020
    jsr $ffc0               // OPEN from IRQ — WRONG; CLI inside OPEN corrupts IRQ scheme
    asl $d019
    rti

// GOOD: queue a flag; main loop services I/O with IRQs naturally enabled.
io_requested: .byte 0       // zero-page flag

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
  disrupted by unexpected CLI from KERNAL; the technique doc covers stack
  depth and IRQ vector discipline.
- KERNAL routines: `SETLFS` ($FFBA), `OPEN` ($FFC0), `LOAD` ($FFD5),
  `CHKIN` ($FFC6), `CHKOUT` ($FFC9).
- Pitfall: `kernal_io_mapping_dependency` — the two pitfalls often appear
  together; banking out the KERNAL while also calling OPEN is doubly fatal.

---

## kernal_clobbers_a_x_y — KERNAL routines do not preserve A, X, or Y unless the Affects line says otherwise

**Severity:** medium
**Region:** both
**Triggered by kernal:** CHROUT, CHRIN, GETIN, CHKIN, CHKOUT

### Symptom

A loop that calls CHROUT to print characters loses its loop counter. A sprite
multiplex routine that calls GETIN to check for keypresses returns with the
sprite index in Y overwritten with zero. A character output sequence that builds
a string index in X finds X reset to a garbage value after CHKOUT. The bugs are
particularly elusive because they surface only on certain code paths — if the
developer tests the loop without any KERNAL calls inserted, everything is fine;
adding even a single JSR $FFD2 breaks the loop silently if the developer assumed
A was preserved.

A subtler variant: the code saves only A around CHKIN, assumes X and Y are
untouched, then finds X = 0 on return (CHKIN's internal table index) and
mistakes it for an error sentinel.

### Mechanism

The KERNAL authors saved space and cycles by preserving only the registers that
callers genuinely need back. The documented contract is the Affects line in each
routine's reference entry. Any register listed in Affects may be changed; any
register absent from Affects is not guaranteed preserved either — treat absence
as "not documented as changed on the success path only." The safe assumption is:
any register not explicitly listed as output is potentially clobbered.

Specific contracts for the most-called routines:

- **CHROUT ($FFD2):** Affects A, C. X and Y are preserved.
- **CHRIN ($FFCF):** Affects A, X, Y, C — all three registers may change.
- **GETIN ($FFE4):** Affects A, X, Y, C — same as CHRIN.
- **CHKIN ($FFC6):** Affects A, X, C.
- **CHKOUT ($FFC9):** Affects A, X, C.

OPEN, CLOSE, LOAD, and SAVE clobber A, X, Y, and C. Only SETLFS and SETNAM
preserve all three (their Affects lines say None).

### Fix

Audit every KERNAL call site. For each JSR $FFxx, check the Affects line. Save
and restore every register listed in Affects that the caller also needs after
the call returns. Use PHA/PLA for A, TXA/PHA/PLA/TAX for X, and TYA/PHA/PLA/TAY
for Y.

Unless you have verified the Affects line and confirmed which registers the
caller doesn't need after the call, preserve all three around every KERNAL JSR.
The cost is 15 cycles — negligible outside of tight raster loops.

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
in X and CHROUT only touches A and C, a bare PHA/JSR/PLA suffices.

### Worked example

```kick
// BAD: assumes CHKIN leaves X untouched.
// CHKIN Affects A and X; X comes back as the internal table index, not 1.
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

// BAD: tight print loop uses A after CHROUT (A is in Affects).
print_loop:
    lda msg,y
    jsr $ffd2               // CHROUT — A may change
    cmp #0                  // comparing stale A — unreliable
    beq done
    iny
    dex
    bne print_loop

// GOOD: loop on X or Y, not on A's post-call value.
print_loop_good:
    lda msg,y
    jsr $ffd2
    iny
    dex
    bne print_loop_good

msg: .text "HELLO"
msg_end:
```

### Cross-references

- KERNAL routines: `CHROUT` ($FFD2), `CHRIN` ($FFCF), `GETIN` ($FFE4),
  `CHKIN` ($FFC6), `CHKOUT` ($FFC9).
- Pitfall: `kernal_assumes_sei_cleared` — both pitfalls stem from the same
  root cause: the KERNAL assumes a specific runtime contract that the caller
  must uphold.

---

## decimal_mode_in_irq_handler — IRQ may fire mid-SED arithmetic; handler must CLD on entry or BCD corruption ensues

**Severity:** critical
**Region:** both
**Triggered by techniques:** stable_raster_irq
**Triggered by kernal:** SETLFS

### Symptom

BCD arithmetic running in the main loop produces correct results in isolation
but yields random garbage when the raster IRQ fires during the calculation.
The corruption is intermittent — it depends on whether the IRQ fires between
the SED and CLD instructions in the main-loop BCD block. Debugging is painful
because inserting a SEI/CLI wrapper around the BCD block "fixes" the problem
(it does — by preventing the IRQ from firing during the critical window) without
revealing the real cause. The same corruption appears in SID player timing
code that uses BCD to accumulate tick counts, and in any BASIC-style score
counter kept as packed BCD in zero page.

A related variant: two handlers coexist (music player + raster effect) and one
uses SED/CLD for a BCD calculation. If the second handler fires while the first
is between SED and CLD — via NMI or a chained IRQ that re-enables interrupts —
the second handler's ADC/SBC produces wrong results.

### Mechanism

The 6502/6510 decimal mode flag (D flag) is one bit of the processor status
register (P). When D = 1, ADC and SBC perform BCD (binary-coded-decimal)
arithmetic: result nibbles are adjusted so that each hex digit represents a
decimal digit 0-9. When D = 0, addition and subtraction are pure binary.

Crucially, the D flag is **not automatically cleared or saved on IRQ entry**.
The 6502 interrupt sequence pushes the program counter (PCH, PCL) and the
processor status register (P) onto the stack, then fetches the IRQ vector and
begins executing the handler. The pushed P contains the D flag as it was at
the time of the interrupt — but the processor itself does not clear D. The
handler runs with D still set if the interrupted code had executed SED and not
yet executed CLD.

This means: if main-loop code is between `SED` and `CLD`, and an IRQ fires,
the IRQ handler's ADC and SBC instructions run in BCD mode. Any addition or
subtraction in the handler — including pointer arithmetic, counter decrements,
and index calculations — will produce BCD-adjusted results instead of binary
results. A handler that adds 8 to a pointer stored in zero page will compute
8 + 0 = 8 correctly in BCD, but 9 + 1 will produce $10 (decimal 10 as BCD)
instead of $0A (decimal 10 as binary). The pointer lands in the wrong page.
The raster effect writes to the wrong address. The corruption is data-dependent
and nearly impossible to trace without knowing that D is set.

On NMOS silicon, N, V, and Z are undefined after a decimal-mode ADC/SBC. C
reflects decimal carry. Code in the handler that branches on carry after an
addition will take the wrong branch when D is unexpectedly set.

RTI restores P from the stack, including D. After RTI, the main-loop BCD block
resumes with D = 1 as expected — but the damage inside the handler's execution
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

The `CLD` costs 2 cycles and 1 byte. It is not optional. Place it after the
register saves (the PHA/TXA/PHA/TYA/PHA sequence does not perform arithmetic,
so those instructions are safe even with D set) and before any instruction that
uses ADC, SBC, or reads the C/N/V/Z flags after such an instruction.

The RTI at the end of the handler automatically restores D (along with all
other flags) from the pushed P — so the main-loop BCD block resumes correctly
with D = 1 after the handler exits. No explicit SED is needed in the handler's
exit path.

NMI handlers require the same discipline. The NMI vector fires regardless of
the I flag and also does not clear D — if you use the NMI for digi playback or
any other purpose, it needs CLD too.

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
  commonly hits; the technique doc discusses the canonical IRQ prelude.
- Opcodes: `SED` ($F8), `CLD` ($D8) — the two instructions that set and clear
  the decimal flag.
- Pitfall: `kernal_clobbers_a_x_y` — the PHA/TXA/PHA/TYA/PHA prelude described
  in both pitfalls is the same stanza; the CLD belongs between the last PHA
  and the first handler instruction.

---

## kernal_io_mapping_dependency — KERNAL file/disk routines crash when $01 has banked out the KERNAL ROM

**Severity:** high
**Region:** both
**Triggered by kernal:** SETLFS, LOAD, SAVE, OPEN, CLOSE
**Triggered by techniques:** cpu_io_port_bank

### Symptom

Disk or tape I/O that works in a plain BASIC or kernal environment crashes
silently when called from a demo or game that has changed $01 to enable an
all-RAM or partial-RAM banking mode. The crash is typically a wild branch: the
CPU fetches an opcode from RAM at $E000-$FFFF where the KERNAL ROM used to be,
executes whatever byte it finds there as an opcode, and veers off into garbage.
In some configurations the machine appears to freeze; in others it resets.

A variant: the code correctly sets $01 = $37 for the KERNAL call, but later
restores $01 to $34 (all RAM) or $35 (I/O + KERNAL but no BASIC) without
saving and restoring the exact value it found. Subsequent KERNAL calls use the
restored value, which may not match what the KERNAL's internal routines expect.

A related issue: code banks in $35 for bitmap RAM access, then calls CHROUT.
CHROUT at $FFD2 is a three-byte JMP in KERNAL ROM. With HIRAM = 0 ($35 has
bit 1 clear), the address $FFD2 contains RAM, not ROM. The JSR executes
whatever bytes happen to be there and branches to a garbage address.

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
CHAREN=1 — KERNAL ROM at $E000-$FFFF, BASIC ROM at $A000-$BFFF, I/O at
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

Modes $35, $34, and $30 are popular in demos because they allow the CPU to
see RAM at $E000-$FFFF (useful for placing time-critical code, decompression
buffers, or sprite data up high). But KERNAL ROM must be visible ($01 bit 1
HIRAM = 1) for any KERNAL call — including the jump-table entries themselves —
to work. The jump table entries at $FF81-$FFF3 are three-byte JMP instructions
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

The save is to the stack (PHA/PLA). Using a zero-page byte for the save is
also common, but the stack is simpler and does not require allocating a
zero-page scratch byte.

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

- Register: `01` — the 6510 processor port data register; bits 0-2 control
  LORAM/HIRAM/CHAREN.
- KERNAL routines: `SETLFS` ($FFBA), `OPEN` ($FFC0), `CLOSE` ($FFC3),
  `LOAD` ($FFD5), `SAVE` ($FFD8).
- Pitfall: `kernal_assumes_sei_cleared` — the two pitfalls are frequently
  encountered together in demo loaders; OPEN can simultaneously trip both
  if the caller has disabled IRQs and banked out the KERNAL.
- `docs/hardware/c64-memory-map.md` — full PLA truth table with all 32 banking
  mode combinations.

---

## krnio_save_leaves_splat_file — Oscar64 krnio_save() writes a *PRG splat instead of a structured file

**Severity:** high
**Region:** both
**Triggered by kernal:** SAVE, OPEN, CLOSE

### Symptom

An Oscar64 game calls `krnio_save(8, &state, &state + sizeof(state))` to
persist a struct to a `.d64` attached as drive 8. The function returns
`true` (apparent success) and a directory entry appears with the chosen
filename — but the entry is marked `*PRG` with 0 blocks, and the file
cannot be read back via `c1541 -read`, via the game's own `krnio_load`,
or via BASIC `LOAD"NAME",8`. Sometimes blocks ARE allocated on disk
(the free-block count drops), but the directory record never records
them; sometimes no blocks are written at all.

The `*` flag preceding `PRG` in a `c1541 -list` output is the
"improperly closed" marker: the directory entry was created, but the
DOS-side close handshake that finalises block count and clears the
splat bit never completed.

### Mechanism

Oscar64's `krnio_save()` wraps KERNAL `SAVE` ($FFD8), which is the same
routine that BASIC's `SAVE"NAME",8` invokes. The KERNAL SAVE flow is
specialised for snapshotting a contiguous memory block as a BASIC PRG
file (two-byte load address header + raw bytes). It assumes the caller
will accept whatever the drive's DOS does for end-of-file housekeeping
— there is no application-level signal to drive that the write is
complete, and the directory close sequence is fragile in environments
where the IEC bus emulation deviates even slightly from the original
1541 timing (notably observed under VICE 3.x with a `.d64` attached
on drive 8, with and without `-drive8truedrive`).

The Oscar64 sample at `samples/kernalio/filewrite.c` does NOT use
`krnio_save`. It uses the structured file API instead:

1. `krnio_setnam("@0:NAME,P,W")` — name with the `@0:` replace prefix
   and a `,P,W` (PRG write) suffix
2. `krnio_open(fnum, dev, 2)` — open a logical file on a secondary
   address that the DOS recognises as a user data channel (2)
3. `krnio_write(fnum, data, size)` — stream bytes through the channel
4. `krnio_close(fnum)` — close, which gives the DOS the explicit
   "end of file" signal that finalises the directory entry

This sequence does not rely on the KERNAL SAVE routine at all. The
DOS-side close handshake is driven by `UNLISTEN` after a clean write,
and the splat bit is cleared as a side effect.

### Fix

Don't use `krnio_save()` to persist program data. Reserve it for
genuinely BASIC-compatible memory snapshots (e.g. embedding a sprite
table at a fixed address that BASIC will `LOAD` into the right place).
For arbitrary structured data — game state, score tables, scenario
maps — use `krnio_open` / `krnio_write` / `krnio_close`.

### Worked example

```c
// BAD: krnio_save leaves a splat file under VICE.
krnio_setnam("TIDELINE,P,W");
bool ok = krnio_save(8,
    (const char*)&state,
    (const char*)&state + sizeof(state));
// ok == true, but the disk shows "TIDELINE" *PRG with 0 blocks.

// CORRECT: open/write/close as in samples/kernalio/filewrite.c.
krnio_setnam("@0:TIDELINE,P,W");
if (krnio_open(2, 8, 2)) {
    krnio_write(2, (const char*)&state, sizeof(state));
    krnio_close(2);
}
// Read back symmetrically: setnam("TIDELINE,P,R"); open(2, 8, 2);
//                          read(2, &state, sizeof(state)); close(2).
```

The `@0:` replace prefix is important if the file might already
exist; without it the OPEN fails with "file exists" and the call
returns false.

### Cross-references

- Oscar64 sample: `samples/kernalio/filewrite.c` and `fileread.c` —
  the authoritative pattern.
- Oscar64 header: `c64/kernalio.h` exposes both `krnio_save` (don't
  use for data) and `krnio_open`/`write`/`close` (do use).
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

### Symptom

A host tool authors a data file onto a `.d64` with
`c1541 -attach disk.d64 -write host.bin TDLVL00`. The file appears in the
directory, and `c1541 -read TDLVL00` round-trips it byte-for-byte. But the C64
program that opens it with `krnio_setnam("TDLVL00")` + `krnio_open(2, 8, 2)`
gets a failed open (`krnio_open` returns false / FILE NOT FOUND). Listing the
disk directory from inside the emulator (`LOAD"$",8` then `LIST`) shows the
filename rendered as graphics characters (e.g. `#####00`) instead of `TDLVL00`.
A file the *game itself* wrote with the same logical name (via `krnio_write`)
opens fine — only the host-authored file fails.

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
**byte-for-byte**, so `0x54...` never matches the stored `0xD4...`, and OPEN
returns file-not-found.

Game-written files are immune because the game both writes and reads with the
same ASCII byte sequence — they match each other regardless of absolute
encoding. The mismatch appears only when one side is `c1541` (host) and the
other is the game (C64). `c1541 -read` is symmetric with `-write`, so a
host-only round-trip never reveals the problem — only a real C64-side open does.

### Fix

Pass the c64 filename to `c1541` in **lowercase**. `c1541` then maps lowercase
ASCII `a-z` to unshifted PETSCII 0x41-0x5A — i.e. `'t'` (0x74) → 0x54 — exactly
the bytes the game's uppercase-ASCII C string requests, and they render
correctly as `TDLVL00` in the C64 directory.

```bash
# BAD: uppercase c64 name -> shifted PETSCII; game krnio_open("TDLVL00") fails.
c1541 -attach disk.d64 -write tdlvl00.bin TDLVL00

# GOOD: lowercase c64 name -> 0x54... matches the game's request + renders right.
c1541 -attach disk.d64 -write tdlvl00.bin tdlvl00
```

Diagnose a suspected mismatch by listing the directory from inside the running
emulator (`LOAD"$",8` then `LIST`): a name rendered as graphics characters is
the tell. (The autostart program name's encoding does not matter — autostart
loads by directory position, not by name match.)

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
  disk-data round-trip; both live in the structured-file save/load workflow.
- Tooling: VICE `c1541 -write` / `-read` perform ASCII→PETSCII on the c64
  filename; their conversion is self-consistent, which is why a host-only
  round-trip hides the bug.
- Discovered authoring Tideline level files (`TDLVLnn`) for Phase H4; see
  `loop/games/CLAUDE.md` disk-testing notes.

---

## getchx_petscii_remaps_return — Oscar64 getchx() delivers RETURN as $0A (not $0D) under IOCHM_PETSCII_2

**Severity:** medium
**Region:** both
**Triggered by kernal:** GETIN

### Symptom

A key handler that tests `key == 0x0d` for RETURN never fires — RETURN feels
"dead" — while letter and space keys work normally. Typically shows up on a
menu ("press RETURN to start") or a confirm action: the cursor moves, letters
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

So a RETURN keypress (PETSCII `$0D`) reaches your code as `$0A`. Any comparison
against `$0D` silently misses. (The reverse map preserves `$0D` on *output*, so
printing is unaffected — only keyboard input is remapped.)

The bug hides easily when input is also drivable by a test harness that writes
an action code directly (e.g. a state byte) instead of going through `getchx` —
the harness path never exercises the key comparison, so RETURN looks fine in
automated tests but is broken for a real keypress.

### Fix

Accept `$0A` (or both `$0A` and `$0D`) everywhere you test for RETURN:

```c
// bad — never matches RETURN under IOCHM_PETSCII_2
if (key == 0x0d) start_level();

// good
if (key == 0x0d || key == 0x0a) start_level();
```

In a `switch`, add `case 0x0a:` alongside `case 0x0d:`.

### Cross-references

- Oscar64 `include/conio.c` (`convch`); the active map is set by
  `iocharmap(IOCHM_PETSCII_2)`.
- Discovered wiring RETURN-to-start on the Tideline level-select screen; the
  select→play path had only ever been exercised via the test-harness action
  byte, which masked the remap.

---

## restore_nmi_not_maskable — RESTORE drives /NMI directly; masking $DD0D does nothing, only the $0318 vector or an NMI lock neutralises it

**Severity:** high
**Region:** both
**Triggered by registers:** DD0D
**Triggered by kernal:** RESTOR, VECTOR

### Symptom

A demo or game drops to a cleared blue screen and `READY.` when the user
presses RUN/STOP+RESTORE, even though its init wrote `$10` (or `$7F`) to
`$DD0D` "to switch the RESTORE NMI off". Everything the program held through
the KERNAL goes with it: `$0314` is back at `$EA31`, the jiffy IRQ is running
again, `$01` is back to the stock map, the VIC is in text mode at `$0400`. The
code is still in memory, which is the whole point of the key.

RESTORE alone, without RUN/STOP, is quieter: a stable-raster split tears or a
sprite multiplexer misplaces for one frame per press — the KERNAL's handler
ran 182 cycles at an unpredictable point in the frame, from the NMI sequence
to its `RTI`, with no cartridge, `$02A1 = 0` and no key held (rung 1: measured
in VICE x64sc 3.10 as 189 cycles across a CIA1 Timer A count, 7 of them the
trampoline described under Mechanism; the instruction path summed by hand
from the bytes gives the same 189) — while `$DD0D` reads `$00` and no CIA2
source is enabled. A program with its own NMI-timed player is not in this
case: it owns `$0318`, so the KERNAL path never runs for it, and a press hands
its handler one extra, early entry instead — spurious unless the handler
tests bit 7 of `$DD0D` before acting.

A third form: the protection was there and vanished. The program pointed
`$0318` at its own handler, then later ran the customary "put the KERNAL
vectors back" line. `JSR $FF8A` (RESTOR) copies the ROM table at `$FD30` and
writes `$FE47` back unconditionally. VECTOR with C = 0 (`$FF8D`) installs
whatever 32-byte table the caller points at — `$FD1A` is `LDA ($C3),Y : STA
$0314,Y` — so it puts `$FE47` back when that table was captured with C = 1
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
control register, or any bit you can write in `$DD0D`. The monostable is one
half of the 556 dual timer at U20 on the boards whose parts lists the
C64-Wiki's motherboard page carries — ASSY 326298 (1982, schematic 326106),
250407 (1983), 250425 (1984) and 250466 (1986, schematic 252278); on the
250469 (1987 on) U20 is the 8701 clock generator and the RESTORE one-shot was
not traced for this entry. On early boards C38 is 51 pF, small enough that a
slow press does not fire the one-shot (the German C64-Wiki's cure is 4.7 nF).
No figure for the pulse length is claimed here; it was not measured. The key
was not pressed for this entry — `-keybuf` stuffs the KERNAL's keyboard
buffer, and RESTORE is not a matrix key — so the circuit itself stands on the
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

Read the branch at `$FE54` again. The handler decides "this was RESTORE" by
finding **no** CIA2 flag. It never sees the key; it cannot. Masking FLAG — or
every source — in `$DD0D` only guarantees that the flag is absent, which *is*
the RESTORE case. `$DD0D = $10` is a no-op twice over: bit 7 clear makes it a
CLEAR-mask write, so it clears a FLAG mask that IOINIT had already cleared,
and the key was never going to raise that flag in the first place.

The same bytes give one more thing for free. The `LDA #$7F : STA $DD0D` at
`$FE4C` wipes whatever CIA2 mask the program had set, and the exit at `$FEB6`
re-enables only what `$02A1` — the KERNAL's RS-232 shadow — holds. A program
that arms a CIA2 timer NMI while leaving `$0318` at `$FE47` loses that mask
on the first RESTORE press or RS-232 event (rung 1, from the bytes; not run).

Measured (rung 1; VICE x64sc 3.10, PAL 6569 — the build on this machine, the
rest of this repository was checked against 3.9): a CIA2 Timer A one-shot NMI
was sent through `$0318` to a trampoline of `BIT $DD0D` and `JMP $FE47`,
preceded by a counter increment, with IRQs off and `$91` pre-set to `$00`.
After the NMI, `$91`
read `$FF`: the KERNAL's handler took the no-flag branch and `$F6BC` wrote the
keyboard row into it. The control — the same trampoline without the `BIT` —
left `$91` at `$00`: the standing flag sent it down the `BMI`. The screen
cells that displayed `$91` were decoded against the character ROM, not read
by eye. The warm-start branch itself (`$FE66` onward) was not exercised: it
needs RUN/STOP held, and a headless run has no keys.

**RUN/STOP without the IRQ.** Because `$F6BC` samples the hardware,
RUN/STOP+RESTORE warm-starts with IRQs disabled and the keyboard scan stopped.
What it does need is `$DC00` still driving column 7 low: IOINIT leaves
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

- Every press still costs 20 cycles — the NMI sequence (7), the `SEI` (2),
  the `JMP ($0318)` (5) and the `RTI` (6) — at an arbitrary point in the
  frame; cycle-exact code shows it once per press. Measured (rung 1, VICE
  x64sc 3.10): CIA1 Timer A counting across a 200-cycle block of `NOP`s with
  DEN off read `$FF2C` with the CIA2 NMI masked and `$FF18` with it taken,
  through a RAM `rti` and through the `$FEC1` stub alike — 20 either way. An
  earlier draft of this entry said 13, having left out the `SEI` and the
  indirect jump.
- The handler gets control with nothing saved. The KERNAL's `PHA : TXA : PHA
  : TYA : PHA` is at `$FE47`, after the vector, not before it — a handler
  that does more than `RTI` saves what it touches.
- Do not read `$DD0D` in this handler "to be safe" if the program also uses
  CIA2 NMIs: the read discards a CIA2 flag that may have arrived, and with it
  the timer or RS-232 event it announced. If both are in play, test bit 7 of
  `$DD0D` and read it only when you mean to.
- It holds only while `$0318` does. RESTOR (`$FF8A`) copies the ROM table
  and writes `$FE47` back unconditionally, and so does the warm start, which
  calls it (`$FE66`). VECTOR with C = 0 (`$FF8D`) installs whatever table the
  caller passes — the usual snapshot-then-restore idiom passes one captured
  before `$0318` was changed, and that one holds `$FE47`. That is why those
  two routines are on this entry's Triggered-by line.
- It needs the KERNAL ROM mapped in (`$01` bit 1 set). With HIRAM = 0 the CPU
  fetches `$FFFA` from RAM and the vector is yours to supply there;
  `ram_under_rom_traps` in `pitfalls/banking.md` shows the pattern.

**B — the NMI lock.** The 6510's NMI input is edge-sensitive: an NMI is taken
on the high-to-low transition of /NMI, and a line that then stays low is not
taken again. Arm a CIA2 Timer A one-shot with its NMI mask set and give it a
handler that never reads `$DD0D`. The timer underflows once, CIA2 sets its IR
bit and pulls /NMI low, the handler runs once — and /NMI then stays low for as
long as the flag stands. No later source can make an edge: not a second
underflow, not the 556. The lock holds until something reads `$DD0D`.

Measured (rung 1; VICE x64sc 3.10): with the handler in the listing below, two
one-shots produced one NMI (the counter cell showed `1`); the same program
with `LDA $DD0D` in the handler produced two (`2`); and the locked program
with a single `LDA $DD0D` from the main loop before a third one-shot produced
two — the read, and nothing else, re-arms the edge. Costs: every CIA2 NMI is
forfeited (RS-232, NMI-timed digi and music players), and any code that reads
`$DD0D` — yours, or a KERNAL RS-232 routine — silently unlocks it.

**What does not work.** Any value written to `$DD0D`; `SEI` (it masks /IRQ
only); stopping the KERNAL IRQ scan (the NMI path samples STOP itself).

### Worked example

The pattern the registers page used to recommend. It clears a mask that is
already clear, and the key never went through the CIA anyway:

```kick
// DOES NOTHING TO RESTORE. Bit 7 clear = CLEAR-mask write; FLAG's mask is
// already clear after IOINIT, and RESTORE never raises a CIA2 flag.
        lda #$10
        sta $dd0d
```

Fix A. Only the `SEI` at `$FE43` runs between the CPU's vector fetch and
`($0318)`, so the stub is the whole story of a RESTORE press:

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
RESTORE press — with RUN/STOP held it would warm-start:

```kick
tramp:  bit $dd0d               // clear the CIA2 flag before the KERNAL looks
        jmp $fe47               // KERNAL NMI handler, as if from RESTORE
```

### Cross-references

- `hardware/cia-reference.md` → "NMI vector (CIA2 + RESTORE)" — the dispatch
  summary; its "Disabling RESTORE" paragraph points back here.
- `hardware/c64-registers-reference.md` → CIA2 key wiring points and quick
  lookup — corrected together with this entry; they used to name FLAG bit 4
  and recommend `$DD0D = $10`.
- `hardware/kernal-routines-reference.md` → Vectors table (NMINV `$0318`,
  ISTOP `$0328`), RESTOR (`$FF8A`), VECTOR (`$FF8D`).
- Pitfall `decimal_mode_in_irq_handler` — an NMI handler that does arithmetic
  needs `CLD` as well.
- Pitfall `ram_under_rom_traps` (`pitfalls/banking.md`) — the all-RAM case,
  where `$FFFA` is yours and the KERNAL dispatch is out of the picture.
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
