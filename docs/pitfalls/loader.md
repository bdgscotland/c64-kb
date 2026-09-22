---
category: loader
---

<!-- doc-type: pitfall-reference -->

# Loader Pitfalls

The pitfalls in this document share a common thread: they all arise from
the gap between what a fast loader expects and what the surrounding program
(or its build toolchain) provides. Fast loaders are invasive by design — they patch KERNAL vectors, bypass
the 1541 ROM entirely, and assume that the drive's hardware is exactly as stock as
the day it left the factory. Any code that assumes it can restore "normal" state,
any hardware that deviates from 1541 timing, and any program data layout that
conflicts with the BASIC stub can each silently corrupt loading in ways that look
like intermittent hardware failure. The pitfalls below have burned every C64
coder who encountered them for the first time: the symptoms appear random but the
mechanisms are completely deterministic.

---

## fastloader_kernal_dependency — Fastloader KERNAL-vector patch breaks after IRQ setup

**Severity:** high
**Region:** both
**Triggered by kernal:** LOAD
**Triggered by techniques:** krill_loader_integration, sparkle_irq_loader

### Symptom

A production installs Krill or Sparkle successfully during startup. The first
part loads at full speed. After the first part installs its own raster IRQ handler
— or after any block of initialization code that includes "restore KERNAL vectors"
as a housekeeping step — subsequent LOAD calls revert to the slow KERNAL serial
protocol. The second part loads in 130 seconds instead of 6 seconds. On hardware
with a serial bus that has even marginal IEC signal quality, the slow KERNAL
protocol may also produce read errors that never appeared with the fast path
active.

A subtler variant: code that calls KERNAL `RESTOR` ($FF8D, mode=0) at the start
of initialization resets all KERNAL RAM vectors to their ROM defaults, including
`$0330/$0331` (the LOAD vector). This silently undoes the fastloader installation
before the first LOAD call ever happens.

### Mechanism

Fast loaders such as Krill and Sparkle install themselves by patching the KERNAL's
RAM-based indirect jump vectors. The KERNAL jump table entry at `$FFD5` (LOAD)
does not call ROM code directly — it executes an indirect jump through `$0330`
(`ILOAD` vector, two bytes, little-endian). On a cold machine these bytes point
to the ROM's own serial-load routine. The Krill installation routine overwrites
`$0330/$0331` with the address of its own C64-side receive loop. All subsequent
`JSR $FFD5` calls take the fast path transparently.

The problem arises when anything restores these vectors to their default ROM
targets. Three common culprits:

1. **Generic "restore KERNAL" init sequences.** Many tutorials and old code
   bases include a block like this as part of IRQ installation:

   ```kick
   SEI
   LDA #$31        // ROM ILOAD lo
   STA $0330
   LDA #$FA        // ROM ILOAD hi  ($FA31 = ROM LOAD in KERNAL 901227-03)
   STA $0331
   CLI
   ```

   This pattern appears in generic IRQ-setup templates where the author
   intended only to stabilize the IRQ vector (`$0314/$0315`) but copied a
   broader vector-reset block that also clobbers the LOAD vector.

2. **KERNAL RESTOR call.** `JSR $FF8D` with A=0 restores all fifteen KERNAL
   RAM vectors to their ROM defaults in a single call. Any init sequence that
   includes `JSR $FF8D` after Krill's install routine runs will silently undo
   the installation.

3. **Cold-start or warm-start flow.** A production that jumps to `$FCE2`
   (KERNAL cold-start) or `$FD15` (KERNAL warm-start) as part of a "reset to
   safe state" sequence will reinitialize RAM vectors. This is rare but
   occasionally appears in cracktros that chain off a previous production's
   reset path.

The fastloader's drive-side code is unaffected — it remains running in the
1541's RAM until the drive is reset. The C64 side is what breaks: the receive
loop address is gone, and `JSR $FFD5` now calls the slow ROM routine. Because
the drive is still in its fast-protocol mode, the slow ROM routine and the fast
drive protocol are completely mismatched. Depending on the Krill version and
drive state, this manifests as extremely slow loading (the drive times out and
falls back to a safe state), as a hung bus (the drive is waiting for the fast
handshake that never comes), or as a "?FILE NOT FOUND" error.

### Fix

Two approaches, depending on what the IRQ setup code actually needs:

**Option A — Save and restore the LOAD vector around IRQ install:**

```kick
SEI

// Save the current LOAD vector (fast path or ROM, whichever is live)
LDA $0330
STA saved_load_lo
LDA $0331
STA saved_load_hi

// Install IRQ handler into $0314/$0315 only — do NOT touch $0330/$0331
LDA #<irq_handler
STA $0314
LDA #>irq_handler
STA $0315

// Restore the LOAD vector in case anything above clobbered it
LDA saved_load_lo
STA $0330
LDA saved_load_hi
STA $0331

CLI

// ...

saved_load_lo: .byte 0
saved_load_hi: .byte 0
```

The save is before `SEI` only for illustration; in practice save the vector
before any code that might disturb it and restore after `CLI`.

**Option B — Audit the init sequence and remove LOAD-vector writes:**

Search the codebase for writes to `$0330` and `$0331` and for calls to
`JSR $FF8D`. Unless there is a deliberate reason to restore the LOAD vector,
delete those writes. The IRQ vector at `$0314/$0315` can be patched without
touching the LOAD vector — they are independent RAM vectors.

**Option C — Re-run Krill install after IRQ setup:**

If the init sequence is too intertwined to safely audit, run Krill's C64-side
install sequence again after all IRQ setup is complete. Krill's C64-side
installer is idempotent: calling it when the drive is already in fast mode
re-patches `$0330/$0331` and resynchronizes the handshake. This is the
fallback when the init sequence is provided by a third-party library that
cannot be modified.

Note that Sparkle's IRQ handler itself depends on `$0330/$0331` being intact —
its raster IRQ uses the patched LOAD vector internally for each block receive.
Clobbering the vector while Sparkle's IRQ is active causes the same hang
described above, but now from within the IRQ handler. Always audit IRQ chains
for hidden vector writes before integrating Sparkle.

### Cross-references

- KERNAL routine `LOAD` (`$FFD5`), RAM vector `ILOAD` at `$0330/$0331`
- Technique `krill_loader_integration` — installation and NTSC/PAL build flags
- Technique `sparkle_irq_loader` — IRQ-driven loader with the same vector dependency

---

## gcr_timing_assumes_stock_drive — GCR loaders assume stock 1541 timing; non-stock drives fail or corrupt

**Severity:** medium
**Region:** both
**Triggered by techniques:** sparkle_irq_loader, krill_loader_integration

### Symptom

A demo that loads cleanly on a real stock 1541 hangs indefinitely on an SD2IEC,
corrupts data silently on a 1571 running in 1541-compatibility mode, produces
random read errors on a JiffyDOS-modified 1541, or loads correctly on PAL but
not on NTSC. The loading symptom looks like a hardware fault — the drive's
activity LED may flash abnormally, or the C64 may freeze at the loading screen
with no visible error. On SD2IEC the LED typically blinks in an error pattern;
on a JiffyDOS 1541 the machine may hang at the first block receive with the
drive motor spinning continuously.

The symptom is drive-dependent and consistently reproducible: the same disk image
that fails on SD2IEC loads correctly every time on a real 1541.

### Mechanism

GCR-level fast loaders — Krill, Sparkle, and similar — bypass the KERNAL's IEC
serial routines entirely. Instead of calling `IECIN` or `IECOUT`, they install
custom drive-side code (via `M-W`/`M-E` commands) and then communicate with that
code using direct bit-banging of CIA2 `$DD00` on the C64 side. The C64-side
receive loop is a tight, cycle-counted loop. Each iteration tests a specific bit
of `$DD00` (the CLK line, bit 6, or the DATA line, bit 7) and waits for a
transition within a hard cycle-count window.

The drive-side code sends each byte at a cadence tuned to the stock 1541's 1 MHz
6502 clock (1,000,000 cycles per second at the drive's internal clock rate). The
C64-side loop expects each bit transition to arrive within a window of
approximately 4-6 µs. If the drive's bit timing deviates — because it is running
at a different clock speed, because it has different VIA peripheral chip
characteristics, or because its protocol is JiffyDOS rather than the Krill
protocol — the C64-side loop times out. Depending on the loader's error handling,
a timeout either hangs (spin loop) or returns a garbled byte.

Common non-stock configurations and why each fails:

**SD2IEC.** An SD card reader that emulates 1541 filesystem operations at the
Commodore DOS level. It speaks the standard KERNAL IEC serial protocol but does
not emulate GCR at the hardware level at all. `M-W`/`M-E` commands either return
an error or are silently ignored, so Krill's drive-side code never installs. The
C64 side then tries to do the fast handshake with a device that has no idea what
the fast protocol is, and the bus hangs.

**1571 in 1541-compatibility mode.** The 1571 can be addressed as device 8 in
1541 mode, but its VIA chip timings and its internal bus arbitration differ from
the 1541. Krill's drive-side timing constants were measured on 1541 hardware; the
1571's slightly different VIA propagation delays shift the bit window outside the
C64-side tolerance. This causes occasional bit errors that corrupt the loaded data
in ways that are not immediately obvious — the program may start but behave
incorrectly because a few bytes of code or data were flipped.

**JiffyDOS-modified 1541.** JiffyDOS replaces the 1541 ROM with a ROM that
implements the JiffyDOS burst protocol. When Krill's drive-side code is uploaded
via `M-W`/`M-E` and executed, it overwrites the JiffyDOS RAM driver in the
drive's RAM workspace. This usually causes Krill to work correctly on a JiffyDOS
machine — but only if the Krill version's timing constants were compiled for the
stock 1541 MHz clock, and only if the JiffyDOS kernel does not re-initialize the
RAM workspace between command-channel operations. Some JiffyDOS revisions
periodically restore their RAM workspace, which can corrupt the in-place Krill
drive code during a multi-part load sequence.

**NTSC timing.** The C64-side receive loop's cycle counts are valid at PAL's
0.985 MHz system clock. NTSC runs at 1.022 MHz — approximately 3.8% faster.
At Krill's default timing, this shifts every wait window by roughly 3-4 cycles.
For bit transitions that are already near the edge of the timing window, this
causes intermittent bit errors on NTSC. Krill provides an NTSC build flag
(`-DNTSC=1` in its KickAssembler distribution) that adjusts the window constants.
Using the PAL binary on NTSC hardware is reliable enough on fast, well-terminated
hardware but causes errors on borderline machines.

### Fix

**Detect the drive before installing the fast loader.** Ask the DOS for its own
version string. `M-R` on the command channel returns raw bytes of drive memory,
and the 1541's power-on message `CBM DOS V2.6 1541` sits in ROM at
`$E5B7`–`$E5C7`, so the four bytes from `$E5C4` read `1541` — the last of them
`$B1`, `'1'` with bit 7 set, which is the message table's end marker, so strip
bit 7 before comparing. A 1571 answers `1571` from the same address, a 1581
answers `$FF $FF $FF $FF` (its ROM has nothing there), and what an SD2IEC answers
was not measured here. `1541` at `$E5C4` is rung 1 from the two 1541 ROM images
VICE 3.10 ships (325302-01+901229-05 and the 1541-II's 251968-03); the
behaviour is rung 1 in VICE x64sc 3.10 with `-drive8truedrive` on drive types
1541, 1541-II, 1571 and 1581, where the routine below returned carry clear for
the 1541 and carry set for the 1571. What the test identifies is the firmware,
not the mechanism. A 1540 — the same mechanism, older DOS — answers `V170` from
that address (rung 1, its ROM image), and a 1541 whose ROM has been replaced
(JiffyDOS, SpeedDOS, Dolphin DOS) will not say `1541` there either (rung 4; no
such ROM ships with VICE), so the routine sends both down the KERNAL path. That
is the safe side to fail on, but note it is stricter than the Mechanism paragraph
above, which says Krill's drive code usually runs on a JiffyDOS 1541. The table of
images and addresses is in `../formats/iec-disk-reference.md`, "Identifying the
drive over the command channel".

```kick
    jsr detect_1541
    bcc install_krill
    jmp use_kernal_load     // anything that is not a 1541: KERNAL path

// Carry clear on return: the drive says "1541" at $E5C4. Carry set: anything
// else, including a drive that never answered.
detect_1541:
    lda #15
    ldx #8
    ldy #15
    jsr $ffba          // SETLFS 15,8,15
    lda #cmd_end-cmd
    ldx #<cmd
    ldy #>cmd
    jsr $ffbd          // SETNAM: the command text goes where a filename would
    jsr $ffc0          // OPEN sends "M-R" $C4 $E5 $04
    bcs no_answer
    ldx #15
    jsr $ffc6          // CHKIN channel 15
    ldy #0
read:
    jsr $ffcf          // CHRIN: one reply byte per call
    and #$7f           // the last byte of the ROM string has bit 7 set
    sta reply,y
    iny
    cpy #4
    bne read
    jsr $ffcc          // CLRCHN
    lda #15
    jsr $ffc3          // CLOSE
    ldy #3
compare:
    lda reply,y
    cmp expect,y
    bne mismatch
    dey
    bpl compare
    clc
    rts
mismatch:
    sec
    rts
no_answer:
    lda #15
    jsr $ffc3
    sec
    rts
cmd:
    .byte $4d, $2d, $52   // "M-R" in PETSCII
    .byte $c4, $e5        // $E5C4, low byte first
    .byte $04             // four bytes
cmd_end:
expect:
    .byte $31, $35, $34, $31   // "1541"
reply:
    .byte 0, 0, 0, 0
```

**Correction (2026-09-21).** The earlier text expected `$41` at `$E5C3` and called
it "the DOS version byte". `$E5C3` is `$20` — the space between `V2.6` and `1541`
— in every 1541-family ROM VICE ships (1540, 1541, 1541-II, 1570, 1571), so that
test never matched and the fast path was never installed. `$41` ("A") is the
DOS-version marker at offset 2 of the BAM sector, track 18 sector 0, which the
format routine writes to the disk; the ROM keeps that constant at `$FED5`, not at
`$E5C3`.

**Provide a KERNAL fallback branch.** The most robust approach is to ship two
load paths: the GCR fast path for stock 1541 hardware, and a `JSR $FFD5` KERNAL
LOAD fallback for everything else. Detect the drive at startup, set a flag, and
branch on the flag at each load call. This adds ~50 bytes of overhead but
eliminates drive-compatibility bugs from the entire production.

Krill's Loader has this built in: set `LOAD_VIA_KERNAL_FALLBACK=1` in
`loaderconfig.inc` and the loader transparently falls back to the KERNAL load
path when drive-code installation fails (incompatible drive such as SD2IEC, or
true-drive emulation disabled) — no hand-rolled detection branch needed. The
cost is a larger host-side stub and KERNAL-speed loading on those devices; see
`../techniques/loaders-packers.md` "v194 concrete integration reference".

**Compile NTSC binaries separately.** If the production targets both PAL and NTSC,
compile the Krill C64-side stub twice with the appropriate clock constant and
select the right binary at startup based on the CIA timer reading (standard PAL/
NTSC detection: count CIA1 timer ticks per VBL interrupt; PAL = ~19,656 cycles,
NTSC = ~16,715 cycles — a 15% difference that is easy to detect reliably within
a single frame).

### Cross-references

- Technique `sparkle_irq_loader` — PAL-only by default; NTSC needs explicit timing constants
- Technique `krill_loader_integration` — NTSC build flag, drive detection discussion
- `docs/formats/iec-disk-reference.md` — IEC bus signal levels, timing diagrams, 1541 GCR zones

**Sources for the Fix.** The drive ROM images VICE 3.10 ships in
`/opt/homebrew/opt/vice/share/vice/DRIVES/` and the KERNAL 901227-03 image, read
byte by byte (rung 1); VICE x64sc 3.10 with `-drive8truedrive` for the runs
(rung 1); `../formats/iec-disk-reference.md` for the per-image table.

---

## basic_stub_collision_with_data — BASIC SYS stub at $0801 overlaps program data

**Severity:** medium
**Region:** both
**Triggered by kernal:** LOAD

### Symptom

A program loads without error. Typing `RUN` causes BASIC to execute the SYS stub
and launch the machine code as expected — but the machine code immediately
behaves incorrectly: the first few reads from the data area return garbage values,
a lookup table produces wrong results, a sprite shape read from `$0801` produces
a corrupt sprite, or a character set starting at `$0800` is garbled in its first
glyph. The bug manifests only when the program is launched from BASIC via `RUN`;
loading with a custom autostart that jumps directly to the entry point (bypassing
the BASIC stub execution) produces correct behavior. The data corruption is
precisely in the first 12-13 bytes of the program's data area, which coincides
with the BASIC stub's footprint.

A second pattern: a program that places data at `$0801` and tests it at startup
reads the correct data in the assembler's simulation but reads BASIC stub bytes
on real hardware or in VICE, because the programmer forgot that the loaded PRG
begins with the stub at `$0801` — the data they assembled at `$0801` was
overwritten by the stub in the final PRG layout.

### Mechanism

A C64 PRG file that auto-starts via BASIC begins at address `$0801`. The BASIC
interpreter's program area starts at `$0801`. The canonical autostart stub
occupies the first 13 bytes of that area:

```
Address  Byte   Meaning
$0801    $0B    Link to next BASIC line (lo): $0801 + $0A = $080B
$0802    $08    Link to next BASIC line (hi)
$0803    $0A    Line number lo: 10
$0804    $00    Line number hi
$0805    $9E    BASIC token for SYS
$0806    $32    PETSCII '2'
$0807    $30    PETSCII '0'
$0808    $36    PETSCII '6'
$0809    $34    PETSCII '4'
$080A    $00    End of BASIC line
$080B    $00    End of BASIC program (link lo = 0)
$080C    $00    End of BASIC program (link hi = 0)
$080D    ...    First byte of machine code (entry point = 2061 decimal)
```

This layout means that `$0801` through `$080C` (inclusive — 12 bytes) belong to
BASIC, and the machine code proper begins at `$080D`. Any data the programmer
places at addresses `$0801` through `$080C` will be overwritten by the stub
bytes above when the final PRG is assembled with the standard BASIC autostart.

The collision arises in two distinct ways:

**Collision type A — data intended to reside at $0801.** The programmer explicitly
places a data table, sprite shape, or character ROM copy at `$0801`, intending to
use it from machine code. Because the PRG loads to `$0801` and the BASIC stub
occupies the first 12 bytes, those 12 bytes of the programmer's data are replaced
by BASIC stub bytes. The machine code reads `$9E $32 $30 $36 $34 $00 ...` (the
SYS token and address digits) instead of the intended data values.

**Collision type B — SYS target address mismatch with data placement.** The
programmer adjusts the SYS address in the stub (e.g., changing `SYS 2064` to
`SYS 2061` or `SYS 2080`) to accommodate a slightly longer or shorter header
sequence, but does not correspondingly move the data that follows. If the SYS
target is `2064` (`$0810`) but data is placed starting at `$080D`, the region
`$080D`-`$0810` is ambiguously both stub and data and will contain the stub's
trailing null bytes.

Note that `SYS 2064` points to `$0810`, not `$080D`. The difference of three
bytes is the end-of-program null word (`$0000`) plus one byte of alignment in
some assembler output. Different assemblers and different stub templates produce
slightly different layouts; the canonical addresses to check are wherever the
PRG assembles the stub and wherever the PRG's data begins — if they overlap, the
collision exists regardless of which specific addresses are involved.

### Fix

Three options, each with different trade-offs:

**Option A — Move data after the stub (preferred for new code).**

Place all data that needs to survive program startup at `$0820` or higher. Leave
`$0801`-`$081F` as BASIC stub + entry code. This is the safe default layout. The
cost is 31 bytes of address space before the programmer's first data byte, which
is negligible in any context except a 256-byte intro.

```kick
* = $0801           // BASIC stub at $0801
.byte $0B, $08      // link to $080B
.byte $0A, $00      // line 10
.byte $9E           // SYS token
.text "2061"        // SYS target = $080D
.byte $00           // end of line
.byte $00, $00      // end of BASIC program

* = $080D           // machine code entry
entry:
    JMP main

* = $0820           // data safely after stub
lookup_table:
    .byte $00, $01, $04, $09, $10, $19, $24, $31   // square table, safe here
```

**Option B — Overwrite the stub at runtime (for productions that never use `RUN`
again after launch).**

The BASIC stub is only needed once: for the initial `RUN` that invokes `SYS`.
After `SYS` transfers control to machine code, the stub bytes at `$0801`-`$080C`
are dead — BASIC is no longer running and the BASIC program area is not used by
the machine code. The entry code can immediately overwrite those bytes with real
data:

```kick
* = $0801
.byte $0B, $08, $0A, $00, $9E  // SYS stub start
.text "2061"
.byte $00, $00, $00             // end markers

* = $080D
entry:
    // Overwrite the now-dead BASIC stub area with real data
    LDX #0
overwrite_loop:
    LDA real_data, X
    STA $0801, X
    INX
    CPX #12
    BNE overwrite_loop
    // $0801-$080C now contains real_data[0..11]
    JMP main

real_data:
    .byte $00, $01, $04, $09, $10, $19, $24, $31, $40, $51, $64, $79
```

This technique is common in 256-byte intros where every available byte of address
space is used and the stub area must double as a data carrier.

**Option C — Use a CRT (cartridge) format to bypass the BASIC stub entirely.**

A `.CRT` image starts execution from the cartridge reset vector, bypassing BASIC
and the BASIC stub entirely. The `$0801` area is free for program use from the
moment the cartridge takes control. This option requires distributing a `.CRT`
file rather than a `.PRG`, which is appropriate for cartridge releases or EasyFlash
productions but not for disk-based demos or games that load via KERNAL `LOAD`.

**Detecting the collision before runtime.** In KickAssembler, assert that the
data placement does not overlap the stub using the `.assert` directive:

```kick
.assert "Data must be after BASIC stub", data_start >= $080D, true
```

If data is intended to start at exactly `$080D` (immediately after the stub), also
ensure the SYS target in the stub matches: `SYS 2061` for entry at `$080D`,
`SYS 2064` for entry at `$0810`. Mismatches between the SYS operand and the
actual entry label are a second source of subtle boot failures distinct from the
data collision described above.

### Cross-references

- KERNAL routine `LOAD` (`$FFD5`) — the loading mechanism that delivers the PRG to `$0801`
- `docs/formats/c64-file-formats.md` — PRG file layout, load address header, CRT format

---

## krill_cc65_2_18_miscompile — Building Krill v194 with cc65 2.18 silently produces a broken loader

**Severity:** high
**Region:** both
**Triggered by techniques:** krill_loader_integration

### Symptom

You build Krill's Loader from source, the build is clean (exit 0, no warnings),
the blobs are the expected size and disassemble to sane code — but at runtime the
installed loader does not work: `install` either hangs or returns
`DEVICE_NOT_PRESENT` (`$FE`), and `loadraw` never succeeds. Meanwhile Krill's own
*prebuilt* `loadertest-cNN.d64` (shipped in the archive) runs perfectly in the
same emulator, which makes it look like your integration is at fault when the real
culprit is the assembler.

### Mechanism

Krill's Loader (repository version 194, 2022) is developed against cc65 **git
master**, not the last tagged release. The Homebrew/distro `cc65` is **V2.18**
(2018) — four years of cc65 codegen changes behind. Some construct in Krill's
drive/host code is miscompiled by 2.18 in a way that passes assembly cleanly but
breaks the cycle-exact serial protocol, so the drive never responds. Verified
2026-05-20: Homebrew cc65 2.18 → broken loader; cc65 git **V2.19** (`cc3c40c`) →
working loader, from identical Krill sources and config.

### Fix

Build cc65 from git and use it for the Krill build:

```
git clone --depth 1 https://github.com/cc65/cc65 && make -C cc65
PATH=<cc65-git>/bin:$PATH CC65_HOME=<cc65-git> make -C loader/src PLATFORM=c64 prg ...
```

Validate against Krill's prebuilt `loadertest` first: if the prebuilt works in
your emulator but your freshly-built loader does not, suspect the assembler before
your integration. Also note `make-loadersymbolsinc.pl` calls `grep -P`, so on
macOS put GNU grep ahead of BSD grep or the symbol-file step errors.

### Cross-references

- Technique `krill_loader_integration` — full v194 build + integration reference
- `docs/techniques/loaders-packers.md` "v194 concrete integration reference (cc65 build)"

---

## fastloader_resident_in_kernal_workspace — Fast-loader resident at $0200-$03FF collides with KERNAL tables; install hangs

**Severity:** high
**Region:** both
**Triggered by techniques:** krill_loader_integration

### Symptom

A fast loader whose resident/host code is placed low in RAM (e.g. `RESIDENT=$0200`)
hangs the moment `install` runs — before the first load. Move the resident
elsewhere and install completes normally.

### Mechanism

`install` opens the drive command channel (KERNAL `SETLFS`/`SETNAM`/`OPEN`) to
upload the drive code via `M-W`. KERNAL `OPEN` writes the logical-file tables
(LAT/FAT/SAT) at **`$0259-$0276`**, and `$0200-$0258` is the BASIC/KERNAL input
buffer. A resident placed at `$0200` (e.g. `$0200-$02EC`) overlaps that workspace;
the KERNAL OPEN corrupts the resident (or vice-versa) mid-install, so the
handshake never completes. The address looks "free" because nothing visible uses
it once BASIC is out of the way — but the KERNAL serial path does.

### Fix

Place the resident outside KERNAL/BASIC zero-page-adjacent workspace. The free
4 KB block at `$C000-$CFFF` works well: put the (transient) installer at `$C000`
and the (persistent) resident just above it (e.g. `$CD00`). Verified 2026-05-20:
`RESIDENT=$0200` hung install; `RESIDENT=$CD00` fixed it.

### Cross-references

- Technique `krill_loader_integration` — "Embedding into an Oscar64 program"
- `docs/hardware/c64-memory-map.md` — page 2/3 KERNAL workspace ($0200-$03FF)

---

## fastloader_dd00_write_corrupts_resident — Raw $DD00 writes (VIC bank switch) while a GCR loader is resident corrupt its bus-lock

**Severity:** high
**Region:** both
**Triggered by registers:** DD00
**Triggered by techniques:** krill_loader_integration

### Symptom

A GCR fast loader is installed and one load works. Then the program switches VIC
graphics mode or VIC bank (anything that writes CIA2 `$DD00`) — e.g. a bitmap
title screen toggling to a text play screen — and the *next* `loadraw` (or
`uninstall`) hangs. The first load worked, so the loader looks fine until the mode
switch; the hang then looks unrelated to graphics.

### Mechanism

`$DD00` is shared: bits 0-1 select the VIC bank, bits 2-7 are the IEC bus lines the
loader bit-bangs. While the loader is installed it owns the IEC bits and keeps a
"bus-lock" state in them. A raw write of the whole `$DD00` byte — exactly what a
VIC-bank set does, including Oscar64's `vic_setmode()` and any
`STA $DD00` / `LDA #v:STA $DD00` — overwrites the IEC bits with values the loader
did not expect, desyncing the drive protocol. The next drive op then waits forever.
(A read-modify-write that changes *only* bits 0-1 while the loader is idle is
tolerated; a full-byte write, or any write while the loader is mid-transfer, is not.)

### Fix

Don't keep the loader resident across VIC mode/bank switches. Two options:

1. **Lazy install (robust, verified):** install only around each load batch
   (probe / level load / load-game), `uninstall` immediately after, then re-assert
   the VIC bank with a read-modify-write (`$DD00 = ($DD00 & $FC) | bank`). With the
   loader uninstalled by default, the drive sits in DOS, so saves are plain KERNAL
   `krnio` with no uninstall dance and no `vic_setmode` ever runs inside the
   install→loads→uninstall window. Cost: one drive-code upload per load batch —
   fine for infrequent loads. (Tideline ships this, VICE-verified 2026-05-20.)
2. If the loader must stay resident, use its VIC-bank-aware API (Krill's
   `SET_VIC_BANK` + `ENTER_BUS_LOCK`/`LEAVE_BUS_LOCK`) and never raw-write `$DD00`.

### Cross-references

- Technique `krill_loader_integration` — VIC-bank / bus-lock protocol; lazy-install recipe
- Register `$DD00` (CIA2) — VIC bank select bits 0-1 vs IEC lines bits 2-7
- Pitfall `fastloader_kernal_dependency` — the other "first load works, later loads break" trap
