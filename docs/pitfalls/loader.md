---
category: loader
---

<!-- doc-type: pitfall-reference -->

# Loader Pitfalls

Each pitfall here comes from a mismatch between what a fast loader expects
and what the surrounding C64 program (or its build toolchain) provides. Fast
loaders patch KERNAL vectors, bypass the 1541 ROM, and assume the drive is
stock. Code that restores "normal" state, hardware that deviates from 1541
timing, and a data layout that conflicts with the BASIC stub can each corrupt
loading silently. The symptoms look like intermittent hardware failure; the
mechanisms are deterministic.

---

## fastloader_kernal_dependency — Fastloader KERNAL-vector patch breaks after IRQ setup

**Severity:** high
**Region:** both
**Triggered by kernal:** LOAD
**Triggered by techniques:** multi_load_sequencing

### Symptom

A production installs a `$FFD5`-hooking fast loader successfully during startup. The first
part loads at full speed. After the first part installs its own raster IRQ handler,
or runs any initialization block that includes "restore KERNAL vectors" as a
housekeeping step, later LOAD calls revert to the slow KERNAL serial
protocol. The second part loads in 130 seconds instead of 6 seconds. On a serial
bus with marginal IEC signal quality, the slow KERNAL protocol may also produce
read errors that never appeared with the fast path active.

A subtler variant: code that calls KERNAL `RESTOR` (`$FF8A`, no arguments; an
earlier version of this page said `$FF8D, mode=0`; `$FF8D` is `VECTOR`) at the
start of initialization resets all sixteen KERNAL RAM vectors `$0314-$0333` to
their ROM defaults, including `$0330/$0331` (the LOAD vector). This silently undoes
the fastloader installation before the first LOAD call ever happens.

### Mechanism

Loaders that interpose on the KERNAL LOAD hook `ILOAD` at `$0330/$0331` so that
`JSR $FFD5` takes the fast path; the classic cartridge fastloaders work this way.
The KERNAL jump table entry at `$FFD5` (LOAD) is `JMP $F49E`; `$F49E` saves X/Y
to `$C3/$C4` and then jumps through `$0330` (`ILOAD`, two bytes, little-endian),
whose ROM default is `$F4A5` (KERNAL 901227-03, read from the `$FD30` vector
table, rung 1; an earlier version of this page gave `$FA31`, which is inside the
tape-read code). A hooking loader overwrites `$0330/$0331` with the address of
its own C64-side receive loop, and every later `JSR $FFD5` call takes the fast
path.

Krill v194 does NOT work this way, and neither does Sparkle; an earlier version
of this page said both did. Krill's API (`install`/`loadraw`/`loadcompd`) is
called directly and its source contains no write to `$0330`, not even in
`LOAD_VIA_KERNAL_FALLBACK` mode, whose fallback path calls `OPEN`/`CHKIN`/`BASIN`
byte-by-byte rather than `$FFD5` (from the v194 source as read for this
correction; the source is not on this machine, so rung 4 here; the technique
page `../techniques/loaders-packers.md` "v194 concrete integration reference"
agrees that the documented usage never goes through `$FFD5`). Sparkle's IRQ
loader uses no KERNAL routine at all (see `sparkle_irq_loader`, "Uses kernal:
(none)"). For Krill and Sparkle this pitfall does not apply: restoring `$0330` or
calling `RESTOR` (`$FF8A`) leaves them working. The real Krill hazards are listed
at the end of the Fix below.

The problem arises when anything restores these vectors to their default ROM
targets. Three common culprits:

1. **Generic "restore KERNAL" init sequences.** Many tutorials and old code
   bases include a block like this as part of IRQ installation:

   ```kick
   sei
   lda #$a5        // ROM ILOAD lo
   sta $0330
   lda #$f4        // ROM ILOAD hi ($F4A5 = LOAD body in KERNAL 901227-03; the $FD30 table value. $FFD5 -> $F49E does JMP ($0330))
   sta $0331
   cli
   ```

   (An earlier version of this block wrote `$FA31`, which is inside the KERNAL's
   tape-read code, and spelled the mnemonics in capitals, which KickAssembler 5.25
   rejects ("Pseudo command SEI not defined"); the fence had never been assembled.)

   This pattern appears in generic IRQ-setup templates where the author
   intended only to stabilize the IRQ vector (`$0314/$0315`) but copied a
   broader vector-reset block that also clobbers the LOAD vector.

2. **KERNAL RESTOR call.** `JSR $FF8A` restores all sixteen KERNAL RAM vectors
   `$0314-$0333` to their ROM defaults in a single call; it takes no argument
   (`VECTOR` at `$FF8D` with carry clear writes the same block from a
   caller-supplied table at X/Y, and with carry set reads it out). An earlier
   version of this page said `JSR $FF8D` with A=0 and fifteen vectors; the ROM
   bytes are `$FF8A: JMP $FD15` (RESTOR: `LDX #$30 / LDY #$FD / CLC`, falling
   into VECTOR) and `$FF8D: JMP $FD1A` (VECTOR, which copies `$1F`+1 = 32 bytes
   and selects direction on the carry), rung 1. Any init sequence that includes
   `JSR $FF8A` after a hooking loader's install routine runs will silently undo
   the installation.

3. **Cold-start or warm-start flow.** A production that jumps to `$FCE2`
   (KERNAL RESET / cold start) or `$FE66` (the KERNAL RUN/STOP-RESTORE warm
   start) as part of a "reset to safe state" sequence will reinitialize RAM
   vectors: both paths run RESTOR (`$FD15`, the body behind `$FF8A`), which
   rewrites `$0314-$0333` from the ROM table. An earlier version of this page
   named `$FD15` itself as the warm start; it is the RESTOR body, rung 1 from
   the ROM bytes. This is rare but occasionally appears in cracktros that chain
   off a previous production's reset path.

The fastloader's drive-side code is unaffected: it keeps running in the
1541's RAM until the drive is reset. The C64 side breaks: the receive
loop address is gone, and `JSR $FFD5` now calls the slow ROM routine. The
drive is still in its fast-protocol mode, so the slow ROM routine and the fast
drive protocol do not match. Depending on the loader and the
drive state, the result is very slow loading (the drive times out and
falls back to a safe state), as a hung bus (the drive is waiting for the fast
handshake that never comes), or as a "?FILE NOT FOUND" error.

### Fix

Two approaches, depending on what the IRQ setup code needs:

**Option A — Save and restore the LOAD vector around IRQ install:**

```kick
sei

// Save the current LOAD vector (fast path or ROM, whichever is live)
lda $0330
sta saved_load_lo
lda $0331
sta saved_load_hi

// Install IRQ handler into $0314/$0315 only — do NOT touch $0330/$0331
lda #<irq_handler
sta $0314
lda #>irq_handler
sta $0315

// Restore the LOAD vector in case anything above clobbered it
lda saved_load_lo
sta $0330
lda saved_load_hi
sta $0331

cli

// ...

saved_load_lo: .byte 0
saved_load_hi: .byte 0
```

(An earlier version of this listing was in capitals, which KickAssembler 5.25
rejects; it now assembles.) Both the save and the restore sit inside the
`SEI`/`CLI` window here only to keep the example compact. In practice, save the
vector before any code that might disturb it, and restore it as soon as that code
has run (before `CLI` if an IRQ handler reads the LOAD vector). (An earlier
version of this sentence said the save was "before `SEI`", which described a
different listing.)

**Option B — Audit the init sequence and remove LOAD-vector writes:**

Search the codebase for writes to `$0330` and `$0331` and for calls to
`JSR $FF8A` (RESTOR) and `JSR $FF8D` (VECTOR, which with carry clear writes the
same block from a caller-supplied table; an earlier version of this page named
only `$FF8D`, so a search that followed it missed every real `JSR $FF8A`). Unless
there is a deliberate reason to restore the LOAD vector,
delete those writes. The IRQ vector at `$0314/$0315` can be patched without
touching the LOAD vector; they are independent RAM vectors.

**What this page used to say, and no longer does.** An earlier version carried an
"Option C — re-run Krill install after IRQ setup", claiming the installer was
idempotent and re-patched `$0330/$0331`, and a paragraph saying Sparkle's raster
IRQ dispatched through the LOAD vector on every block. Neither loader touches
`$0330`, so there is no vector to re-patch; Krill's `install` tests CIA2 DDRA for
an existing installation and returns OK without doing anything, and if that test
fails while the drive is already in loader mode a second `install` hangs on the
KERNAL serial path (rung 4 here; the Krill source is not on this machine). Both
passages were deleted.

**The real Krill hazards** are the ones `../techniques/loaders-packers.md`
documents, and neither involves `$0330`:

- A write to `$DD02`, or a `$DD00` value with any of bits 2-7 set (a generic
  CIA init, a read-modify-write that keeps the read bits), while Krill is armed
  corrupts its bus-lock/installed-state test; see
  `fastloader_dd00_write_corrupts_resident` below. A plain store of `$00`-`$03`
  to `$DD00` is Krill v194's own VIC-bank switch (its README; an earlier version
  of this bullet forbade every raw `$DD00` write). This is Krill's rule only;
  Sparkle prescribes a `$DD02` write for the VIC bank (an earlier version of
  this bullet said "the loader", which read as a rule for every loader).
- Any KERNAL serial call (`JSR $FFD5`, a `krnio` save) while the drive is in
  loader mode stalls, because the drive is no longer running DOS; call
  `uninstall` first.

### Cross-references

- KERNAL routine `LOAD` (`$FFD5` → `$F49E` → `JMP ($0330)`), RAM vector `ILOAD` at `$0330/$0331`, ROM default `$F4A5`
- KERNAL routines `RESTOR` (`$FF8A`) and `VECTOR` (`$FF8D`) — `../hardware/kernal-routines-reference.md`
- Technique `krill_loader_integration` — called directly through its own API; this pitfall does not apply to it (see Mechanism)
- Technique `sparkle_irq_loader` — uses no KERNAL routine; this pitfall does not apply to it
- Pitfall `fastloader_dd00_write_corrupts_resident` — the hazard that does apply to a resident Krill

---

## gcr_timing_assumes_stock_drive — GCR loaders assume stock 1541 timing; non-stock drives fail or corrupt

**Severity:** medium
**Region:** both
**Triggered by techniques:** sparkle_irq_loader, krill_loader_integration, disk_protection_tricks, iffl_single_file, drive_code_upload_and_job_queue, bitfire_loader

### Symptom

A demo that loads cleanly on a real stock 1541 hangs indefinitely on an SD2IEC,
corrupts data silently on a 1571 running in 1541-compatibility mode, produces
random read errors on a JiffyDOS-modified 1541, or loads correctly on PAL but
not on NTSC. It looks like a hardware fault: the drive's
activity LED may flash abnormally, or the C64 may freeze at the loading screen
with no visible error. On SD2IEC the LED typically blinks in an error pattern;
on a JiffyDOS 1541 the machine may hang at the first block receive with the
drive motor spinning continuously.

The symptom is drive-dependent and consistently reproducible: the same disk image
that fails on SD2IEC loads correctly every time on a real 1541.

### Mechanism

GCR-level fast loaders (Krill, Sparkle and similar) bypass the KERNAL's IEC
serial routines. Instead of calling `IECIN` or `IECOUT`, they install
custom drive-side code (via `M-W`/`M-E` commands) and talk to that
code by bit-banging CIA2 `$DD00` on the C64 side. The C64-side
receive loop is a tight, cycle-counted loop. Each iteration tests a specific bit
of `$DD00` (the CLK line, bit 6, or the DATA line, bit 7) and waits for a
transition within a hard cycle-count window.

The drive-side code sends each byte at a cadence tuned to the stock 1541's 1 MHz
6502 clock (1,000,000 cycles per second at the drive's internal clock rate). The
C64-side loop expects each bit transition to arrive within a window of
approximately 4-6 µs. If the drive's bit timing deviates (a different clock
speed, different VIA peripheral chip characteristics, or the JiffyDOS protocol
instead of the Krill protocol), the C64-side loop times out. Depending on the loader's error handling,
a timeout either hangs (spin loop) or returns a garbled byte.

Bitfire states the same limit for itself: its readme says it carries no
workarounds for virtual drives with broken firmware, and names a 1541
Ultimate-II on firmware 3.7 and an up-to-date VICE as working (section
"What it can't"). Here it was run in VICE only.

Common non-stock configurations and why each fails:

**SD2IEC.** An SD card reader that emulates 1541 filesystem operations at the
Commodore DOS level. It speaks the standard KERNAL IEC serial protocol but does
not emulate GCR at the hardware level at all. `M-W`/`M-E` commands either return
an error or are silently ignored, so Krill's drive-side code never installs. The
C64 side then attempts the fast handshake with a device that does not speak
the fast protocol, and the bus hangs.

**1571 in 1541-compatibility mode.** The 1571 can be addressed as device 8 in
1541 mode, but its VIA chip timings and its internal bus arbitration differ from
the 1541. Krill's drive-side timing constants were measured on 1541 hardware; the
1571's slightly different VIA propagation delays shift the bit window outside the
C64-side tolerance. The result is occasional bit errors that corrupt the loaded
data without an obvious sign: the program may start but behave incorrectly
because a few bytes of code or data were flipped.

**JiffyDOS-modified 1541.** JiffyDOS replaces the 1541 ROM with a ROM that
implements JiffyDOS's own fast serial protocol. (An earlier version called it a burst protocol; burst is the 1571/1581 fast-serial mode, a different thing. Rung 4, not checked here.) When Krill's drive-side code is uploaded
via `M-W`/`M-E` and executed, it overwrites the JiffyDOS RAM driver in the
drive's RAM workspace. Krill then usually works on a JiffyDOS
machine, but only if the Krill version's timing constants were compiled for the
stock 1541's 1 MHz clock, and only if the JiffyDOS kernel does not re-initialize the
RAM workspace between command-channel operations. Some JiffyDOS revisions
periodically restore their RAM workspace, which can corrupt the in-place Krill
drive code during a multi-part load sequence.

**NTSC timing.** The C64-side receive loop's cycle counts are valid at PAL's
0.985 MHz system clock. NTSC runs at 1.022 MHz, approximately 3.8% faster.
Each of the four 18-cycle handshake phases in Krill's receive loop resynchronises
on an ATN edge, so the drift does not accumulate across a byte; what matters is
the fixed gap of about 10 C64 cycles between toggling ATN and reading the bus,
which the 1541 (whose 1 MHz clock does not change with the video standard) needs
up to 14 of its own cycles to beat. At 3.8% that gap shrinks by well under one
cycle, which is enough to push a phase already at the edge of its window over
it; Krill's own `NTSC_COMPATIBILITY` build restores the gap by adding exactly one
cycle to each phase. (An earlier version of this page said the shift was "roughly 3-4
cycles" per window; 3.8% of an 18-cycle phase is 0.7 cycles, and of the whole
72-cycle byte 2.7; rung 3 from the phase lengths in
`../techniques/loaders-packers.md` "Cycle budget".) Krill's build has an NTSC
switch: the `NTSC_COMPATIBILITY` define in `loaderconfig.inc` (the config file
selected with `EXTCONFIGPATH=`, or `include/config.inc`) of its cc65/ca65 build;
it is not a KickAssembler `-D` flag, and it is not a `make` command-line variable
either (the Makefile does not forward one to ca65). An earlier version of this
page said `-DNTSC=1`. Enabling it pads the C64-side transfer loop by one cycle at
each ATN sync point (and one NOP in the send routine) so a single resident works
on PAL and NTSC at a small PAL-speed cost; PAL/NTSC is not auto-detected by the
installer and a PAL-only resident gives no error on NTSC. Using the PAL binary on
NTSC hardware is reliable enough on fast, well-terminated hardware but causes
errors on borderline machines.

### Fix

**Detect the drive before installing the fast loader.** Ask the DOS for its own
version string. `M-R` on the command channel returns raw bytes of drive memory,
and the 1541's power-on message `CBM DOS V2.6 1541` sits in ROM at
`$E5B7`–`$E5C7`, so the four bytes from `$E5C4` read `1541`. The last of them is
`$B1`, `'1'` with bit 7 set, which is the message table's end marker, so strip
bit 7 before comparing. A 1571 answers `1571` from the same address, a 1581
answers `$FF $FF $FF $FF` (its ROM has nothing there), and what an SD2IEC answers
was not measured here. `1541` at `$E5C4` is rung 1 from the two 1541 ROM images
VICE 3.10 ships (325302-01+901229-05 and the 1541-II's 251968-03); the
behaviour is rung 1 in VICE x64sc 3.10 with `-drive8truedrive` on drive types
1541, 1541-II, 1571 and 1581, where the routine below returned carry clear for
the 1541 and carry set for the 1571. What the test identifies is the firmware,
not the mechanism. A 1540 (the same mechanism, older DOS) answers `V170` from
that address (rung 1, its ROM image), and a 1541 whose ROM has been replaced
(JiffyDOS, SpeedDOS, Dolphin DOS) will not say `1541` there either (rung 4; no
such ROM ships with VICE), so the routine sends both down the KERNAL path. That
is the safe side to fail on, but it is stricter than the Mechanism paragraph
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
it "the DOS version byte". `$E5C3` is `$20` (the space between `V2.6` and `1541`)
in every 1541-family ROM VICE ships (1540, 1541, 1541-II, 1570, 1571), so that
test never matched and the fast path was never installed. `$41` ("A") is the
DOS-version marker at offset 2 of the BAM sector, track 18 sector 0, which the
format routine writes to the disk; the ROM keeps that constant at `$FED5`, not at
`$E5C3`.

**Provide a KERNAL fallback branch.** Ship two
load paths: the GCR fast path for stock 1541 hardware, and a `JSR $FFD5` KERNAL
LOAD fallback for everything else. Detect the drive at startup, set a flag, and
branch on the flag at each load call. This adds ~50 bytes of overhead but
eliminates drive-compatibility bugs from the entire production.

Krill's Loader has this built in: set `LOAD_VIA_KERNAL_FALLBACK=1` in
`loaderconfig.inc` and the loader falls back to the KERNAL load
path when drive-code installation fails (incompatible drive such as SD2IEC, or
true-drive emulation disabled), with no hand-rolled detection branch. The
cost is a larger host-side stub and KERNAL-speed loading on those devices; see
`../techniques/loaders-packers.md` "v194 concrete integration reference".

**Compile NTSC binaries separately.** If the production targets both PAL and NTSC,
compile the Krill C64-side stub twice with the appropriate clock constant and
select the right binary at startup based on the CIA timer reading (standard PAL/
NTSC detection: count CIA1 timer ticks per VBL interrupt; PAL = 19,656 cycles,
NTSC = 17,095 on the 6567R8 (16,768 on the older 6567R56A), a 15% difference
that is easy to detect within a single frame. An earlier version of this
page gave NTSC as ~16,715, which is the NTSC frame time in microseconds, not its
cycle count; 65 × 263 = 17,095 and 64 × 262 = 16,768, rung 3, matching
`../hardware/pal-ntsc-reference.md`).

### Cross-references

- Technique `sparkle_irq_loader` — PAL and NTSC, plugins included (Sparkle 3.4 manual p. 3; an earlier version of this line said PAL-only by default with NTSC needing timing constants)
- Technique `krill_loader_integration` — `NTSC_COMPATIBILITY` config define, drive detection discussion
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
**Triggered by techniques:** crunched_data_in_basic_stub, exomizer_basics

### Symptom

A program loads without error. Typing `RUN` causes BASIC to execute the SYS stub
and launch the machine code as expected, but the machine code immediately
behaves incorrectly: the first few reads from the data area return garbage values,
a lookup table produces wrong results, a sprite shape read from `$0801` produces
a corrupt sprite, or a character set starting at `$0800` is garbled in its first
glyph. The bug manifests only when the program is launched from BASIC via `RUN`;
loading with a custom autostart that jumps directly to the entry point (bypassing
the BASIC stub execution) produces correct behavior. The data corruption is
in the first 12 bytes of the program's data area (13 where the assembler pads the
stub so code starts at `$080E`, as KickAssembler's `BasicUpstart2` does), which
coincides with the BASIC stub's footprint.

A second pattern: a program that places data at `$0801` and tests it at startup
reads the correct data in the assembler's simulation but reads BASIC stub bytes
on real hardware or in VICE, because the programmer forgot that the loaded PRG
begins with the stub at `$0801`: the data they assembled at `$0801` was
overwritten by the stub in the final PRG layout.

### Mechanism

A C64 PRG file that auto-starts via BASIC begins at address `$0801`. The BASIC
interpreter's program area starts at `$0801`. The canonical autostart stub
occupies the first 12 bytes of that area (an earlier version of this sentence
said 13; the table below and the Option B listing's `cpx #12` both count 12):

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
$0809    $31    PETSCII '1'
$080A    $00    End of BASIC line
$080B    $00    End of BASIC program (link lo = 0)
$080C    $00    End of BASIC program (link hi = 0)
$080D    ...    First byte of machine code (entry point = 2061 decimal)
```

This layout means that `$0801` through `$080C` (inclusive, 12 bytes) belong to
BASIC, and the machine code proper begins at `$080D`. Any data the programmer
places at addresses `$0801` through `$080C` will be overwritten by the stub
bytes above when the final PRG is assembled with the standard BASIC autostart.

The collision arises in two distinct ways:

**Collision type A — data intended to reside at $0801.** The programmer explicitly
places a data table, sprite shape, or character ROM copy at `$0801`, intending to
use it from machine code. Because the PRG loads to `$0801` and the BASIC stub
occupies the first 12 bytes, those 12 bytes of the programmer's data are replaced
by BASIC stub bytes. The machine code reads `$9E $32 $30 $36 $31 $00 ...` (the
SYS token and address digits) instead of the intended data values.

**Collision type B — SYS target address mismatch with data placement.** The
programmer adjusts the SYS address in the stub (e.g., changing `SYS 2064` to
`SYS 2061` or `SYS 2080`) to accommodate a slightly longer or shorter header
sequence, but does not correspondingly move the data that follows. If the SYS
target is `2064` (`$0810`) but the code that follows the stub starts at
`$080D`, the CPU enters three bytes into it. If the target is `2061` but the
code starts at `$0810`, the CPU executes the three bytes at `$080D`-`$080F`
first.

`SYS 2064` points to `$0810`, not `$080D`. A four-digit stub ends at `$080C`,
its end-of-program null word included (`$080B`-`$080C`), so the three bytes
`$080D`-`$080F` are padding that some templates leave before the code. (An
earlier version of this entry spelled `2064` in the stub table above while
naming `$080D` as the entry, and called the three bytes "the end-of-program
null word plus one byte of alignment"; the null word is inside the stub.) Different assemblers and different stub templates produce
slightly different layouts. Check where the PRG assembles the stub and where
the PRG's data begins; if they overlap, the collision exists.

### Fix

Three options:

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
    jmp main

* = $0820           // data safely after stub
lookup_table:
    .byte $00, $01, $04, $09, $10, $19, $24, $31   // square table, safe here
```

**Option B — Overwrite the stub at runtime (for productions that never use `RUN`
again after launch).**

The BASIC stub is only needed once: for the initial `RUN` that invokes `SYS`.
After `SYS` transfers control to machine code, the stub bytes at `$0801`-`$080C`
are dead: BASIC is no longer running and the BASIC program area is not used by
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
    ldx #0
overwrite_loop:
    lda real_data,x
    sta $0801,x
    inx
    cpx #12
    bne overwrite_loop
    // $0801-$080C now contains real_data[0..11]
    jmp main

real_data:
    .byte $00, $01, $04, $09, $10, $19, $24, $31, $40, $51, $64, $79
```

This technique is common in 256-byte intros where every available byte of address
space is used and the stub area must double as a data carrier. (The Option A and
Option B listings were in capitals until 2026-09-22, which KickAssembler 5.25
rejects ("Pseudo command JMP not defined"), so neither had ever been assembled;
both build now.)

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
check that the SYS target in the stub matches: `SYS 2061` for entry at `$080D`,
`SYS 2064` for entry at `$0810`. Mismatches between the SYS operand and the
actual entry label are a second cause of boot failures, separate from the
data collision.

### Cross-references

- KERNAL routine `LOAD` (`$FFD5`) — the loading mechanism that delivers the PRG to `$0801`
- `docs/formats/c64-file-formats.md` — PRG file layout, load address header, CRT format

---

## krill_cc65_2_18_miscompile — Building Krill v194 with cc65 2.18 silently produces a broken loader

**Severity:** high
**Region:** both
**Triggered by techniques:** krill_loader_integration

### Symptom

Krill's Loader builds from source cleanly (exit 0, no warnings), and
the blobs are the expected size and disassemble to sane code, but at runtime the
installed loader does not work: `install` either hangs or returns
`DEVICE_NOT_PRESENT` (`$FE`), and `loadraw` never succeeds. Krill's own
*prebuilt* `loadertest-cNN.d64` (shipped in the archive) runs in the
same emulator, so the integration looks at fault when the assembler is.

### Mechanism

Krill's Loader (repository version 194, 2022) is developed against cc65 **git
master**, not the last tagged release. The Homebrew/distro `cc65` is **V2.18**
(2018), four years of cc65 codegen changes behind. Some construct in Krill's
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
the emulator but the freshly built loader does not, suspect the assembler before
the integration. `make-loadersymbolsinc.pl` calls `grep -P`, so on
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
hangs as soon as `install` runs, before the first load. Move the resident
elsewhere and install completes normally.

### Mechanism

`install` opens the drive command channel (KERNAL `SETLFS`/`SETNAM`/`OPEN`) to
upload the drive code via `M-W`. KERNAL `OPEN` writes the logical-file tables
(LAT/FAT/SAT) at **`$0259-$0276`**, and `$0200-$0258` is the BASIC/KERNAL input
buffer. A resident placed at `$0200` (e.g. `$0200-$02EC`) overlaps that workspace;
the KERNAL OPEN corrupts the resident (or vice-versa) mid-install, so the
handshake never completes. The address looks free because nothing visible uses
it once BASIC is out of the way, but the KERNAL serial path does.

### Fix

Place the resident outside KERNAL/BASIC zero-page-adjacent workspace. The free
4 KB block at `$C000-$CFFF` works: put the (transient) installer at `$C000`
and the (persistent) resident just above it (e.g. `$CD00`). Verified 2026-05-20:
`RESIDENT=$0200` hung install; `RESIDENT=$CD00` fixed it.

### Cross-references

- Technique `krill_loader_integration` — "Embedding into an Oscar64 program"
- `docs/hardware/c64-memory-map.md` — page 2/3 KERNAL workspace ($0200-$03FF)

---

## fastloader_dd00_write_corrupts_resident — Raw $DD00 writes (VIC bank switch) while a Krill, Sparkle or Bitfire loader is resident corrupt its bus-lock

**Severity:** high
**Region:** both
**Triggered by registers:** DD00
**Triggered by techniques:** krill_loader_integration, sparkle_irq_loader, bitfire_loader

### Symptom

A GCR fast loader is installed and one load works. Then the program switches VIC
graphics mode or VIC bank (anything that writes CIA2 `$DD00`, e.g. a bitmap
title screen toggling to a text play screen), and the *next* `loadraw` (or
`uninstall`) hangs. The first load worked, so the loader looks fine until the mode
switch; the hang then looks unrelated to graphics.

### Mechanism

`$DD00` is shared: bits 0-1 select the VIC bank, bit 2 is the user-port RS-232 TXD
line, and bits 3-7 are the IEC bus lines the loader bit-bangs (3-5 ATN/CLK/DATA
out, 6-7 CLK/DATA in; an earlier version of this page said bits 2-7; see
`../hardware/cia-reference.md` §`$DD00`). While the loader is installed it owns the IEC bits and keeps a
"bus-lock" state in them. A raw write of the whole `$DD00` byte (what a
VIC-bank set does, including Oscar64's `vic_setmode()` and any
`STA $DD00` / `LDA #v:STA $DD00`) overwrites the IEC bits with values the loader
did not expect, desyncing the drive protocol. The next drive op then waits forever.
Krill v194 drives ATN, CLK and DATA through `$DD02` and keeps `$DD00` bits 2-7 at
0, so a store of `$00`-`$03` to `$DD00` is safe at any time, even from an
interrupt while a load runs; a value with any of bits 2-7 set is not (v194
`README`, "Setting the VIC bank"). An earlier version of this paragraph said
Krill tolerated only a read-modify-write of bits 0-1 while idle and no
full-byte write; the v194 README prescribes the full-byte store. Sparkle is
the reverse: it drives the bus through `$DD00` and takes the bank from `$DD02`.
Bitfire is Krill's side of that split: it clocks the bus through `$DD02`
and keeps `$DD00` bits 3-5 at 0, so a plain store of `$00`-`$03` is safe
and a read-modify-write is not, because it copies a pin that reads 1 back
into the latch. The table under Fix gives each loader's rule. (An earlier version of this page stated
Krill's rule as the rule for every resident loader.)

### Fix

Don't keep the loader resident across VIC mode/bank switches. Two options:

1. **Lazy install (verified):** install only around each load batch
   (probe / level load / load-game), `uninstall` immediately after, then re-assert
   the VIC bank with a read-modify-write (`$DD00 = ($DD00 & $FC) | bank`). With the
   loader uninstalled by default, the drive sits in DOS, so saves are plain KERNAL
   `krnio` with no uninstall step and no `vic_setmode` ever runs inside the
   install→loads→uninstall window. Cost: one drive-code upload per load batch,
   acceptable for infrequent loads. (Tideline ships this, VICE-verified 2026-05-20.)
2. If the loader must stay resident, switch the bank the way that loader
   documents. The Sparkle and Bitfire rows were run in VICE (below); the
   Krill row is from the loader's own documentation and source, not run
   here. (An earlier version of this item said none of the rows was run,
   and a later one that the Bitfire row was not run.)

| Loader | VIC bank switch while resident | Arbitrary `$DD00` values |
|---|---|---|
| Krill v194 | `LDA #bank : STA $DD00` with bank `$00`-`$03` in the usual encoding (`$03` = `$0000`-`$3FFF`), at any time, also from an interrupt while loading; bits 2-7 must be 0, so no read-modify-write that keeps the read bits (README, "Setting the VIC bank"; `SET_VIC_BANK` in `include/loader.inc` is this store). Not `$DD02`: the loader switches ATN, CLK and DATA by writing `$DD02` (`src/hal/hal-c64-c128.inc`), so a Sparkle-style `$DD02` bank write would change the bus. An earlier version of this row said `SET_VIC_BANK` and never a raw `$DD00` write; `SET_VIC_BANK` is a raw `$DD00` write. | While idle only: `ENTER_BUS_LOCK` after a load (empty in v194), `LEAVE_BUS_LOCK` before the next (clears bits 2-7 of `$DD00`) |
| Sparkle 3.4 | Do not write `$DD00`: the loader may read it as a drive command and reset the drive. Write `LDA #$3C+bank : STA $DD02`, bank 0-3 (manual pp. 20-21; common issue 1, p. 29). Measured in VICE x64sc 3.10 with true drive emulation, PAL and NTSC, by recipe `sparkle-dd02-bank`: 523 such writes from a raster interrupt during eight loads (PAL), every bundle's checksum matched, the VIC never in the wrong bank. A plain `STA $DD00` of `$03`/`$01` from the same interrupt reset the drive and the next load never returned; a read-modify-write of `$DD00` loaded correctly but left the VIC in bank 3 at 400 of 523 checks. | "Direct bus lock": `$03` (bits 3-5 clear) to `$DD02`, then any `$DD00` value; restore `$DD00` to `$38` first, then `$DD02` to `$3C`+bank (pp. 22-23). Not run here. |
| Bitfire | Plain stores of `$00`-`$03` to `$DD00` "at any time, also while loading"; not a read-modify-write (`LDA $DD00 : AND #$FC : ORA #bank`) (readme, "Bank switching"). Measured in VICE x64sc 3.10 with true drive emulation, PAL and NTSC, by recipe `bitfire-dd00-bank`: 681 plain stores from a raster interrupt during eight loads (PAL), every file's checksum matched, the VIC never in the wrong bank. A read-modify-write from the same interrupt stored `$8B` and `$89` (bit 3 set): every load returned and all eight files were wrong. Sparkle's `$DD02` write also broke every file and never selected bank 2. | Only while idle, between the `bus_lock` and `bus_unlock` macros. Not run here. |

   Sparkle also accepts any `$DD02` value between loader calls, as long as
   `$3C`+bank is back before the next call (the "indirect bus lock", pp. 21-22).
   Why the `$DD02` write selects the bank (not stated in the manual): the
   loader writes `$DD00` with bits 0-1 at 0 (its receive loop stores `#$08`,
   `#$C0` and `#$X0`, `sl.asm` in SparkleCPP), so a bit set to output drives 0
   and a bit set to input floats to 1, and `$3C`+bank gives the inverted bank
   value the VIC reads. The recipe's interrupt read `$DD00` bits 0-1 before each
   switch and always found the bank it had set (rung 1; an earlier version of
   this paragraph was rung 4).

**Sources.** Sparkle 3.4 user manual, Sparta (OMG), chapters "Switching VIC
banks", "Bus lock" and "Common issues", `manual/` in
https://github.com/spartaomg/SparkleCPP. Bitfire `readme.txt`, sections "Bank
switching" and the macro list, https://github.com/bboxy/bitfire. Krill's
Loader v194 (Plush, 2022, https://csdb.dk/release/?id=226124): `README`,
section "Setting the VIC bank"; `include/loader.inc`; `src/hal/hal-c64-c128.inc`,
the `CIA2_DDRA_*` definitions. (An earlier version said the Krill row was
unchanged from earlier versions of this page.)

### Cross-references

- Technique `krill_loader_integration` — VIC-bank / bus-lock protocol; lazy-install recipe
- Technique `sparkle_irq_loader` — bank switch through `$DD02`, direct and indirect bus lock
- Technique `bitfire_loader` — bank switch by plain `$DD00` stores; the bus clocked through `$DD02`
- Register `$DD00` (CIA2) — VIC bank select bits 0-1 vs IEC lines bits 3-7
- Pitfall `fastloader_kernal_dependency` — the other "first load works, later loads break" trap

---

## d64_error_byte_is_a_controller_code — The D64 error byte is the 1541 job code, not the DOS error number

**Severity:** medium
**Region:** both
**Triggered by techniques:** disk_protection_tricks, drive_code_upload_and_job_queue

### Symptom

A tool, a loader's own D64 reader or a page reads the 683-byte error block appended to a `.d64` as DOS error numbers. It then reports "error 3" for a sector the drive would report as `21, READ ERROR`, or looks for the value `21` in the block and never finds it, so a protected disk's bad-sector signature is invisible to it. The other way round, a tool that writes the DOS number into the block produces an image whose byte `21` (`$15`) means nothing to the drive ROM or to VICE, and the protection check that expected a read error gets `0, OK`.

### Mechanism

The 1541's one 6502 runs two layers of code: the floppy controller side runs sector jobs and hands back a one-byte return code, and the DOS side turns that code into the number and text on the error channel. The D64 error block stores the controller's return code, one byte per sector in track then sector order. `$01` is a clean read. The codes an image can carry, and what the error channel prints for each, measured on the windowless x64sc build of VICE 3.10 with `-drive8truedrive -drive8type 1541` and a `U1` block read of each flagged sector:

| Byte | Controller condition | DOS number | Measured on VICE 3.10 |
|------|----------------------|-----------|-----------------------|
| `$01` | OK | none | `0, OK` |
| `$02` | header not found | 20 | `20, READ ERROR` |
| `$03` | no sync | 21 | `20, READ ERROR` for one flagged sector; `21, READ ERROR` when the whole track is flagged |
| `$04` | data block not present | 22 | `22, READ ERROR` |
| `$05` | data checksum error | 23 | `23, READ ERROR` |
| `$07` | verify error | 25 | `0, OK` (not exercised by a read) |
| `$08` | write protect on | 26 | `0, OK` (not exercised by a read) |
| `$09` | header checksum error | 27 | `20, READ ERROR` |
| `$0B` | disk ID mismatch | 29 | `20, READ ERROR` for one flagged sector; `29, DISK ID MISMATCH` when the whole track is flagged |
| `$0F` | drive not ready | 74 | `0, OK` |

VICE 3.10 honours `$02`, `$03`, `$04`, `$05`, `$09` and `$0B` by building the sector's GCR with the named field spoiled (`gcr.c` in its source: sync bytes, header block ID, data block ID, the two checksums, the header's disk ID). It ignores `$07`, `$08` and `$0F`, so a read of such a sector returns `0, OK`. Codes `$0A` and `$10` were not measured here.

Two rows say the printed number depends on how many sectors on the track are flagged. The drive ROM causes this, not the emulator: VICE spoils only the flagged sector, and a ROM that cannot find the header it wants reports `20` whether the header is missing, has a wrong checksum or has a wrong ID. `21` (no sync at all) and `29` (ID mismatch) appear when every sector on the track carries the code. A first version of this measurement put all the flags on track 1 and read `29` for the `$02` and `$05` sectors and `20` for the `$0B` one: a wrong-ID header on the same track leaks into the ROM's per-track seek. When testing an image tool, keep flagged sectors on separate tracks.

### Fix

Convert at the boundary, in both directions, and name which side a variable holds. The drive ROM's rule (see `../formats/iec-disk-reference.md`, "The 1541 DOS Error Codes") is: take the low four bits; `0` gives `24`; `15` gives `74`; anything else is ORed with `$20` and decremented twice, read as a decimal number. So `$03` gives `$23 - 2 = $21`, printed as `21`. Treat `$00` and `$01` as no error when reading an image, and write `$01` for a clean sector.

### Worked example

Bad pattern, a Python image reader that prints the block as DOS numbers:

```text
errs = img[174848:]                  # 683 bytes after the sector data
for i, b in enumerate(errs):
    if b:
        print(f"sector {i}: error {b}")   # prints "error 3"; the drive says 21
```

Fixed, with the ROM's conversion:

```text
def dos_number(job):
    job &= 0x0F
    if job in (0, 1):
        return 0 if job == 1 else 24
    if job == 15:
        return 74
    return int(f"{(job | 0x20) - 2:x}")   # $23 - 2 = $21 -> 21

errs = img[174848:]
for i, b in enumerate(errs):
    if b not in (0, 1):
        print(f"sector {i}: job {b:#04x} -> DOS {dos_number(b)}")
```

The measurement itself. Build the image (a `c1541`-formatted 174,848-byte file plus 683 error bytes, one flagged sector per track, and two whole tracks flagged):

```text
SPT = [21]*17 + [19]*7 + [18]*6 + [17]*5          # sectors per track, tracks 1..35
def index(t, s): return sum(SPT[:t-1]) + s
img = bytearray(open("disk.d64", "rb").read())    # c1541 -format "TEST,01" d64 disk.d64
errs = bytearray([0x01] * 683)
for t, code in {1:0x02, 2:0x03, 3:0x04, 4:0x05, 5:0x07, 6:0x08,
                7:0x09, 8:0x0B, 9:0x0F, 10:0x00, 11:0x01}.items():
    errs[index(t, 0)] = code
for s in range(21): errs[index(12, s)] = 0x03     # whole track: no sync
for s in range(21): errs[index(13, s)] = 0x0B     # whole track: wrong ID
open("err2.d64", "wb").write(img + errs)          # 175,531 bytes
```

Read each flagged sector through the command channel (BASIC, tokenised with `petcat -w2` from lowercase source):

```text
10 open 15,8,15:open 2,8,2,"#"
20 for i=1 to 14:read t,s
30 print#15,"u1 2 0";t;s
40 input#15,e,e$,a,b
50 print t;s;e;e$
60 next:close 2:close 15
70 data 1,0,2,0,3,0,4,0,5,0,6,0,7,0,8,0,9,0,10,0,11,0,8,5,12,0,13,0
```

Run: `x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 200000000 -drive8truedrive -drive8type 1541 -8 err2.d64 -drive8wobbleamplitude 0 -drive8wobblefrequency 0 -exitscreenshot out.png -autostart read2.prg`. The screen reads, in order: `20`, `20`, `22`, `23`, `0`, `0`, `20`, `20`, `0`, `0`, `0`, then `0` for the control read of 8,5 on the ID-flagged track, `21` for track 12 and `29` for track 13. Three PAL runs gave byte-identical screenshots.

### Cross-references

- `../formats/c64-file-formats.md`, ".D64": the error block's size, position and the same table
- `../formats/iec-disk-reference.md`, "The 1541 DOS Error Codes": the ROM's conversion and the full DOS table
- Technique `disk_protection_tricks`: bad-sector signatures are written as controller codes in a preserved image
- Pitfall `gcr_timing_assumes_stock_drive`: the other place a loader's model of the drive diverges from the drive

---

## tape_bit_is_a_pulse_pair_not_a_pulse — A KERNAL tape bit is a pair of pulses, and there are three pulse lengths, not two

**Severity:** high
**Region:** both
**Triggered by registers:** DC04, DC05, DC06, DC07, DC0D
**Triggered by kernal:** LOAD, SAVE
**Triggered by techniques:** tape_turbo_loader

### Symptom

A tape tool, a TAP-to-PRG converter or a loader's own tape reader treats each pulse of a KERNAL-written tape as one bit: short means 0, long means 1. It reads garbage. The leader decodes as thousands of zero bits, the filename comes out as noise, no block ever ends where the header says it should, and a checksum written from the same model never matches. A tool built the other way round, one that writes a bit as one pulse, produces a TAP the KERNAL cannot LOAD: it never finds a byte marker and sits at `SEARCHING` until the tape runs out.

### Mechanism

The KERNAL tape stream has three pulse lengths, and a bit is a pair of them. Measured from a SAVE recorded on the windowless x64sc build of VICE 3.10 (PAL), one TAP entry per full pulse: short pulses centre on `$2F` (376 cycles, about 382 µs), medium on `$43` (536 cycles, about 544 µs) and long on `$58` (704 cycles, about 715 µs), each cluster a few units wide because the write interrupt reprograms the timer from software. Short then medium is a 0, medium then short is a 1, long then medium is the byte marker that opens every byte, and long then short closes a block copy. A byte is twenty pulses: the marker pair, eight data-bit pairs least significant bit first, and a parity pair that makes the count of ones in the nine bits odd. Every block is written twice, each copy opened by a countdown, `$89` down to `$81` before the first and `$09` down to `$01` before the second, and closed by a one-byte XOR checksum of the data and the end-of-block marker.

A single-pulse model cannot see any of that. It has no symbol for the medium pulse, so it lumps it with one neighbour or the other, and it has no byte boundary, so any timing hiccup shifts every later bit. The leader before a block is a run of single short pulses, so the first ten seconds of a tape look like a one-pulse-per-bit stream of zeros, and the medium and long pulses only appear once data starts.

### Fix

Decode in two stages. First classify every TAP entry into S, M or L by threshold (below `$3A`, `$3A`–`$4B`, above `$4B` worked on the VICE recording; a real cassette needs wider bands). Then walk the symbols in pairs, starting at the first L: `LM` opens a byte, then take nine pairs, `SM` as 0 and `MS` as 1, check that the nine bits hold an odd number of ones, and stop the copy at `LS`. Skip the nine countdown bytes, XOR the rest, and compare with the last byte. Read the second copy the same way when the first copy has a parity or checksum failure. When writing, emit the same pairs, and put a leader of short pulses in front of each copy: the KERNAL wrote 27,137 shorts before the header block and 5,376 before the program block.

### Worked example

The bad pattern, a Python converter that calls each pulse a bit:

```text
raw = open("save.tap", "rb").read()[20:]
bits = [0 if b < 0x40 else 1 for b in raw if b]      # one pulse, one bit: wrong
bytes_out = [sum(bits[i+k] << k for k in range(8)) for i in range(0, len(bits) - 8, 8)]
# prints thousands of $00 for the leader, then noise; no $89 countdown, no filename
```

The fix, on the same file. The first twenty pulses after the leader in the recording were `57 41 43 2E 2F 42 2E 43 42 2F 2F 42 2F 42 30 43 42 2E 2F 41`:

```text
def sym(b):
    return "S" if b < 0x3A else "M" if b < 0x4C else "L"

def read_byte(s, i):                 # s: symbol string, i: index of an 'L'
    if s[i:i+2] != "LM":
        return None                  # 'LS' is the end of this copy
    bits = []
    for k in range(9):
        pair = s[i+2+2*k : i+4+2*k]
        bits.append({"SM": 0, "MS": 1}[pair])
    assert sum(bits) % 2 == 1        # odd parity over data + parity bit
    return sum(bits[k] << k for k in range(8)), i + 20

syms, j = [], 0
while j < len(raw):
    if raw[j]:
        syms.append(sym(raw[j])); j += 1
    else:
        syms.append("Z"); j += 4         # a zero byte carries a 24-bit count: skip the whole entry
s = "".join(syms)
i = s.index("L")
val, i = read_byte(s, i)             # LM MS SM SM MS SM SM SM MS SM -> $89, the first countdown byte
```

Running that over the recording gives `$89 $88 ... $81`, then `$01 $01 $08 $0D $08 $54 $20 ...` for the header (type 1, load `$0801`, end `$080D`, name `T`), and the second copy opens with `$09 $08 ... $01`. The 12-byte program block that follows XORs to `$E6`, the checksum byte the KERNAL wrote after it.

### Cross-references

- `../formats/c64-file-formats.md`, ".TAP", "KERNAL bit encoding": the measured pulse table, byte layout and block structure
- `../hardware/cia-reference.md`, the Timer B and `$DC0D` notes: tape write runs on Timer B underflow interrupts and tape read measures pulse widths on the same timer
- `../hardware/c64-memory-map.md`, `$01`: bit 3 is the write line the pulses come out of, bit 4 the button sense, bit 5 the motor
- Technique `cpu_io_port_bank`: why a banking write to `$01` must preserve bits 3 to 5 while tape code runs
- Pitfall `gcr_timing_assumes_stock_drive`: the disk-side pitfall of modelling a medium's timing from the wrong assumption

---

## exomizer3_proto_flags_mismatch — Exomizer 3 streams need a decruncher built for the same -P bits; a classic decruncher needs -P0 at crunch time

**Severity:** high
**Region:** both
**Triggered by techniques:** exomizer_basics, crunched_data_in_basic_stub

### Symptom

A file crunched with Exomizer 3's `mem`, `raw` or `level` command is fed to a decruncher that does not match it: a decruncher written for Exomizer 2, a copy of `exodecrunch.s` lifted from an older production or a tutorial, or the shipped decruncher assembled with a different set of `#define` switches than the `-P` flags used at crunch time. What happens depends on which bits disagree. Measured here on the windowless x64sc build of VICE 3.10: a stream crunched with `-P0` and read by the shipped decruncher at its defaults writes its output straight past the start of the destination, overwrites its own crunched input, and lands in the KERNAL's BRK handler; the machine comes back to a cleared screen and `READY.` with no message. A stream that differs in bit 5 only decrunches to completion and leaves wrong bytes behind, with nothing to say so; which bytes are wrong varies from run to run, because the misread references pull from RAM the image never wrote. The `sfx` command is not affected, because the cruncher embeds a decruncher generated for the same flags.

### Mechanism

Exomizer 3.0.0 (2018-05-16) changed the crunched bit stream to make the 6502 decruncher faster, and its changelog says the change is incompatible. Which shape the stream takes is set by `-P<bitfield>`, a value from 0 to 63. `exo31info.txt` gives the bits, paraphrased here:

| Bit | Value | What it changes in the stream |
|-----|-------|-------------------------------|
| 0 | 1 | Bit order inside the stream: set reads most significant bit first, clear is the Exomizer 2 order |
| 1 | 2 | A read of more than 7 bits is split into a short shift plus a whole byte instead of shifting every bit |
| 2 | 4 | The first literal byte is implicit, with no flag bit in front of it |
| 3 | 8 | The stream is aligned toward its start without a shift flag bit |
| 4 | 16 | Sequences of length 3 get an offset table of their own, three tables instead of two; the decrunch table grows from 156 to 204 bytes |
| 5 | 32 | Lets a match repeat the offset of the match before it when only one literal byte or one literal run separates them (new in 3.1.0, 2020-12-22) |

`raw`, `mem` and `level` defaulted to `-P7` in 3.0 and to `-P39` from 3.1. `-P0` clears every bit and writes the Exomizer 2 format. Since 3.1 the flag also takes relative forms: `-P+16` sets bit 4 and leaves the rest, `-P-32` clears bit 5, and they chain (`-P-32+16`). `sfx` accepts `-P` for bits 2 to 5 and forces bits 0 and 1 on, with a warning; the stub it emits always matches the payload.

The stream carries no byte that says which bits it was written with. The decruncher's assumptions are assembled in. In the shipped 6502 decrunchers (`exodecrs/exodecrunch.s` for ca65, and the `kick`, `acme` and `dasm` copies) two of the bits have a switch: `EXTRA_TABLE_ENTRY_FOR_LENGTH_THREE` must be defined for a stream crunched with `-P+16`, and `DONT_REUSE_OFFSET` for one crunched with `-P-32`. Bits 0 to 3 have no switch: those sources read the 3.x form only, so they cannot read a `-P0` stream at all, and a decruncher that reads the `-P0` form cannot read theirs. The readme in `exodecrs/` says the two streaming decrunchers, `exostreamdecr1.s` and `exostreamdecr2.s`, still read the old layout, so streams for them are crunched with `-P0`. The decruncher source also names `DECRUNCH_FORWARDS` for a stream crunched with `-f`, `LITERAL_SEQUENCES_NOT_USED` for `-c` and `MAX_SEQUENCE_LENGTH_256` for `-M256`; the last two are optional size savings, the first is a hard requirement like the `-P` pair.

Why the `-P0` case crashes rather than stalling: the decruncher first builds its tables from the encoding at the head of the stream, then copies literals and back-references downward from the end address the stream names. Read with the wrong bit order, the lengths and offsets are noise. In the measured run the output pointer crossed below the destination start with a store to `$2FFF` at 3,100,944 cycles and wrote another 9,747 bytes, one per address, down through the embedded crunched stream (`$0A8B` to `$0C23` in that build) and the decruncher's own 156-byte table (`$09EF` to `$0A8A`) to `$09EC`, before the CPU executed a `$00` byte and reached `$FE66`, the KERNAL's BRK entry, at 3,377,428 cycles. The KERNAL's BRK path goes through the BASIC warm-start vector, which clears the screen and prints `READY.`; the border colour the harness had set was reset along with it, which distinguishes this from a hang.

### Fix

Crunch with the flags the decruncher was built for, and keep the two from the same Exomizer release:

- A decruncher from Exomizer 2, a hand-copied one from an older source, or `exostreamdecr1.s`/`exostreamdecr2.s`: add `-P0` to the `mem`, `raw` or `level` command line.
- The shipped 3.x `exodecrunch` source: use the default flags, or if you add `-P+16` also define `EXTRA_TABLE_ENTRY_FOR_LENGTH_THREE`, and if you add `-P-32` also define `DONT_REUSE_OFFSET`. Match `-f` with `DECRUNCH_FORWARDS`.
- A third-party loader with Exomizer decrunching built in (Krill's `loadcompd`, for example): read its release notes for the Exomizer version and flags it expects and crunch with those.
- `sfx` output needs nothing; the stub always matches its payload.

When a decrunch misbehaves and the cruncher's version is in doubt, `exomizer -v` prints it, and the stream itself gives a rough hint: in the `mem -l auto` files made here from one input the third byte was `$01` under the defaults and `$80` under `-P0`. That is an observation, not a documented signature.

### Worked example

The measurements below were made with Exomizer 3.1.3b0, built here from the author's zlib-licensed source (Bitbucket `magli143/exomizer`, commit `ba91318`, 2025-05-01) with `make` in `src/`, and the KickAssembler decruncher `exodecrs/kick/exodecrunch.asm` from the same tree, assembled with KickAssembler 5.25. The subject is a 4,287-byte PRG that sets the border and background green, writes a marker to `$02FF`, and carries about 4 KB of patterned filler so there is something to crunch.

Self-extracting form; this is the tutorial command and it works as written:

```text
exomizer sfx sys -o green_sfx.prg green.prg      # 4,287 bytes in, 724 bytes out
```

Run in the windowless x64sc (`-default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 6000000 -exitscreenshot out.png -autostart green_sfx.prg`), the exit screenshot has a green border and reads `GREEN BORDER OK`; a second run gave a byte-identical PNG.

The same file through `mem`, with the defaults and with `-P0`:

```text
exomizer mem -o mem_def.exo green.prg            # 412 bytes; identical to -P39
exomizer mem -P0 -o mem_p0.exo green.prg         # 411 bytes
exomizer mem -P7 -o mem_p7.exo green.prg         # 411 bytes (the 3.0 default)
exomizer mem -P55 -o mem_p55.exo green.prg       # 419 bytes (-P+16: the third table)
```

Both `mem_def.exo` and `mem_p0.exo` begin with the load address `$07FE` and end with the decrunched end address `$18BE`; 86 of the 411 bytes between them differ, and the third byte is `$01` in one and `$80` in the other.

The decrunch matrix. A harness at `$0801` embeds one stream (crunched with `mem -l none` and the input relocated to `$3000`), calls `exod_decrunch`, then sums the 4,285 output bytes and compares the sum with the expected `$30F1`: border green and `$02FF = $A5` on a match, border red and `$02FF = $E5` on a mismatch, border yellow if it never returns. Each row is one run at 8,000,000 cycles; the first two were repeated and gave byte-identical screenshots.

| Decruncher build | Stream | Result |
|------------------|--------|--------|
| defaults | `-P39` (default) | green; `30F1 30F1` on screen |
| defaults | `-P0` | cleared screen, `READY.`, light-blue border: BRK at `$FE66` after 3,377,428 cycles |
| defaults | `-P7` | the same crash |
| defaults | `-P55` (`-P+16`) | the same crash |
| `EXTRA_TABLE_ENTRY_FOR_LENGTH_THREE` | `-P55` | green; `30F1 30F1` |
| `DONT_REUSE_OFFSET` | `-P7` (`-P-32`) | green; `30F1 30F1` |
| `DONT_REUSE_OFFSET` | `-P39` | red; finished, wrong bytes, no crash. The wrong sum differs from run to run (three default runs gave `3874`, `3752` and `3612`): the misread back-references pull from RAM outside the decrunched image, which VICE fills with a random component by default. With `-raminitrandomchance 0` added, two runs were byte-identical and read `385F 30F1` |

The harness's crunched-byte reader is the shipped `main.asm` pattern, a self-modifying `lda $ffff` walked downward from the label after the embedded data. Nothing else in the harness depends on the flags; every difference in the table comes from the `-P` value and the two `#define` lines.

Not measured here: a genuine Exomizer 2 decruncher against a 3.x stream. The shipped 3.x source has no `-P0` build, and no Exomizer 2 tree was fetched. The `exodecrs/` readme's statement that such a decruncher needs `-P0` is read, not run.

### Cross-references

- Technique `exomizer_basics`: the commands, and the version they hold for
- Technique `crunched_data_in_basic_stub`: where a hand-rolled or borrowed depacker meets a cruncher's output
- Pitfall `krill_cc65_2_18_miscompile`: the other loader-side failure that comes from mismatched tool versions
- `exo31info.txt` and `exodecrs/README_exo3.txt` in the Exomizer source tree: the bit definitions and the -P0 note, read for facts only

---

## atn_assert_drives_data_low_via_atna — Asserting ATN pulls the drive's DATA line low through the 1541's ATNA gate, whatever the drive program writes

**Severity:** high
**Region:** both
**Triggered by registers:** DD00
**Triggered by techniques:** drive_code_upload_and_job_queue, krill_loader_integration, sparkle_irq_loader

### Symptom

A drive program is uploaded with `M-W`, started with `M-E`, and takes over
the bus with a protocol of its own. The host side uses ATN as a strobe or
as a clock and reads the drive's reply on DATA IN. The bits sampled under
ATN never change; whole bytes come back fixed when the drive's data is
constant, and garbled when it is not. Looked at one bit at a time, DATA IN
is 0 for as long as ATN is held, whatever the drive program puts in its
DATA OUT bit, and follows DATA OUT only while ATN is released; or, if the
drive program set its ATNA bit, the other way round (the control rows in
the table below show the released-phase reading following DATA OUT). The
drive code is correct in isolation and the host code
is correct in isolation. The case that prompted this entry was a loader
that strobed bit pairs with ATN and read a fixed `$22` for every byte
(reported; not measured here).

### Mechanism

The 1541 does not connect its DATA OUT bit straight to the bus. The DATA
line's driver is fed by DATA OUT or-ed with a second term, ATN IN
exclusive-or ATNA, where ATNA is bit 4 of `$1800`, the "attention
acknowledge" output of the serial VIA. Whenever the level of the ATN line
differs from the ATNA bit, that term is 1 and the hardware pulls DATA low.
This is how a 1541 answers ATN before any code has run: ATN falls, ATNA is
still 0, DATA drops at once. The DOS's ATN service then sets ATNA to 1,
which takes the hardware pull off and hands DATA back to the DATA OUT bit,
and the idle loop clears ATNA again once ATN is released (see the ROM's
`$EBE7` entry in `../formats/iec-disk-reference.md`, "1541 Drive ROM"). The
gate itself is on the 1541 schematic (rung 4 here); its effect is measured
below.

A resident drive program that leaves ATNA at 0 therefore gets the same
hardware answer every time the host asserts ATN: DATA goes low, and
nothing the program writes to DATA OUT can lift it, because the term is
or-ed in. Set ATNA to 1 and the reverse happens: DATA is held low the
whole time ATN is released, and freed only while ATN is asserted. Either
way a host that strobes ATN and reads DATA sees ATN, not data.

Measured in VICE x64sc 3.10, headless build, PAL and NTSC, with true drive
emulation of a 1541 and a `TEST,01` image attached: a drive program of
12 or 14 bytes (34 for the last row, and that one also went up in a
single `M-W`) uploaded to `$0500` and started with `M-E` did
`SEI`, cleared DATA OUT, CLK OUT and ATNA in `$1800`, set the bits the row
names, and looped for ever. The host then released its own ATN, CLK OUT and
DATA OUT (`$DD00` bits 3 to 5 clear), waited about 25,000 cycles, read
`$DD00` eight times some 2,600 cycles apart, asserted ATN (bit 3 set) and
did the same, then released it and did the same again. All eight reads in
every phase of every run were the one byte the table gives. The drive's
`$1800` is the monitor's read (`m 8:1800`) at the start of each phase.
On the host, `$DD00` bit 7 is DATA IN and 1 means the line is released;
on the drive, `$1800` bit 0 is DATA IN and 1 means the line is low, bit 7
is ATN IN and 1 means ATN is asserted. The two control rows fix the sense:
with DATA OUT held low by the drive program, the host read bit 7 clear
in every phase.

| Drive program holds | `$DD00`, ATN released | `$DD00`, ATN asserted | `$DD00`, released again | drive `$1800`, same three phases |
|---|---|---|---|---|
| ATNA 0, DATA OUT 0 | `$C7` (DATA released) | `$4F` (DATA low) | `$C7` | `00`, `81`, `00` |
| ATNA 1, DATA OUT 0 | `$47` (DATA low) | `$CF` (DATA released) | `$47` | `11`, `90`, `11` |
| ATNA 0, DATA OUT 1 (control) | `$47` | `$4F` | `$47` | `03`, `83`, `03` |
| ATNA 1, DATA OUT 1 (control) | `$47` | `$4F` | `$47` | `13`, `93`, `13` |
| interrupts left enabled, ATNA 0, DATA OUT 0 | `$C7` | `$4F` | `$C7` | `00`, `81`, `00` |
| ATNA copied from ATN IN on every pass (the fix) | `$C7` | `$CF` | `$C7` | `00`, `90`, `00` |

PAL and NTSC gave the same bytes in the two rows run on both (the first
two); the other rows are PAL. In the first row the drive never touched
DATA OUT (its `$1800` bit 1 read 0 throughout) and DATA still went low
with ATN; in the second it went low without ATN. Leaving the drive's
interrupts enabled changes nothing: the ATN edge raised the drive's IRQ,
which set the DOS's attention flag at `$7C` from `00` to `01` (measured,
monitor read at each phase; it stayed `01` after ATN was released), but
the routine that would act on it, set ATNA and take the bus runs from the
DOS idle loop (ROM listing, rung 4), and a resident program never returns
there. So the DOS does not take over a bus a resident program holds; it
only records the request.

### Fix

Either keep ATN out of the data phase, or make the drive program track it.

1. Do not use ATN as a data-phase signal. Run the custom protocol on CLK
   and DATA with ATN released on the host side, as the KERNAL itself does
   for data bytes: it asserts ATN only while it sends LISTEN, TALK and the
   secondary address (`ORA #$08` into `$DD00` at `$ED2E`), and releases it
   at `$EDBE` (`AND #$F7`). (An earlier version said the KERNAL releases ATN
   between the command bytes, which is backwards.) Reserve ATN for what the DOS expects it to
   mean: get the drive's attention. This is the simple case and the one
   the job-queue recipe leaves the bus in.
2. If ATN is the strobe, the drive program must copy ATN IN into ATNA
   every time it changes, before it drives or reads DATA. With ATNA equal
   to the ATN level the exclusive-or term is 0 and DATA belongs to DATA
   OUT again. The last table row is that fix running: DATA read released
   in all three phases. Loaders that clock bit pairs with ATN do this
   inside their drive-side receive loop; a program that copies their host
   half and writes its own drive half without the ATNA update meets this
   pitfall on the first byte.

The C64's `$DD00` has no such gate, so the host cannot see the cause
from its own port; it reads what the drive's hardware put on the line.

### Worked example

Host side, the read that shows the fault. With a drive program that has
cleared ATNA and released DATA, the first sample is `$C7` and the second
`$4F`: DATA followed ATN. With ATNA set they are `$47` and `$CF`.

```kick
// Sample DATA IN with ATN released, then with ATN asserted.
// $DD00 bit 7 is DATA IN (1 = released); bit 3 is ATN OUT (1 = pull low).
        lda $dd00
        and #$07            // keep VIC bank and TXD; ATN, CLK OUT, DATA OUT released
        sta $dd00
        jsr settle          // a few thousand cycles
        lda $dd00
        sta samples         // measured: $C7 with ATNA clear, $47 with ATNA set
        lda $dd00
        and #$07
        ora #$08            // assert ATN
        sta $dd00
        jsr settle
        lda $dd00
        sta samples+1       // measured: $4F with ATNA clear, $CF with ATNA set
```

The drive program that produced those bytes, assembled for `$0500` and
started with `M-E` (the second `ora` selects the row):

```text
        sei
        lda $1800
        and #$e5            ; DATA OUT (bit 1), CLK OUT (bit 3), ATNA (bit 4) all clear
        ora #$00            ; $10 for the ATNA-set row; $02 to hold DATA OUT low as a control
        sta $1800
loop    jmp loop
```

The fix, in the same loop: move ATN IN down to the ATNA position and write
it back each pass, so the two never differ for longer than the loop takes.

```text
loop    lda $1800
        lsr
        lsr
        lsr
        and #$10            ; ATN IN (bit 7) in the ATNA position (bit 4)
        sta $05f0
        lda $1800
        and #$ef
        ora $05f0
        sta $1800
        jmp loop
```

That loop is 22 bytes on top of the 12-byte program, and the whole 34
bytes went to the drive in one `M-W` (the technique's 32-byte figure is
what loaders send, not a limit the emulated DOS enforced here; 35 or more
was not tried).

Not measured here: the same on a 1571 or 1581 (different ports and
addresses), an SD2IEC (no code upload at all), and how long the hardware pull lasts after ATN
changes when a real drive's loop is slower than the host's strobe.

### Cross-references

- Technique `drive_code_upload_and_job_queue`: how the program gets onto the drive and what `M-E` does with it
- Techniques `krill_loader_integration` and `sparkle_irq_loader`: protocols that clock bit pairs with ATN, and so must keep ATNA in step
- Recipe `../recipes/kickassembler/drive-job-queue.md`: the upload, readback and execute code the measurement reused
- `../formats/iec-disk-reference.md`, "Pin Map and Electrical Characteristics": the sense of the host's bits, which the control rows here agree with; "1541 VIA registers, measured": `$1800` bit by bit. Its ATN IN row reads `1` in every state, and until this entry it said ATN was released in all of them; here bit 7 read `0` with ATN released and `1` with it asserted in every run, both models, so the row now says `1` is the asserted level. Those rows were `M-R` reads, and the DOS runs a command while the UNLISTEN that ends it is still under ATN (ROM flow, rung 4, an inference not measured here), which is why the table saw `1`
- Register `$DD00` (CIA2), `../hardware/cia-reference.md`: bits 3 to 5 out, 6 and 7 in
- Pitfall `fastloader_dd00_write_corrupts_resident`: the other way a `$DD00` bit ends up meaning something the loader did not intend
