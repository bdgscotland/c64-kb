---
category: loader
chip: 6510
---

<!-- doc-type: technique-reference -->

# Loaders, Packers, and Disk Tricks

The C64's standard KERNAL LOAD routine, entering via the jump table at `$FFD5`, delivers around 300-400 bytes per second over the IEC serial bus. That ceiling shaped the entire culture of C64 software distribution: games shipped on multiple disks, each side holding one or two parts of a game; demos were structured as multi-part shows with a loading screen between parts; and a cottage industry of fast-loader technology emerged almost immediately after the machine launched in 1982. By the late 1980s, fast loaders delivering 20 times the KERNAL throughput had become the standard assumption for any serious demoscene production.

Packing runs parallel to loading. A crunched PRG that expands in place occupies less disk space (fitting more onto a side), loads faster (fewer bytes to transfer even before decompression), and presents a smaller RAM footprint before decompression begins. The interplay between loading speed and decompression time is the central engineering trade-off in this area: a very fast loader with no packing may wait on disk; an extremely compact packer with a slow depacker may erase the transfer savings.

This document covers the demoscene-standard fast loaders and packers in operational order — how to adopt them, how they work internally at the IEC and GCR level, and how to combine them into multi-part productions that stream content without visible loading pauses.

For the IEC bus hardware details underlying all fast-loader operation, see `../formats/iec-disk-reference.md`. For KERNAL jump-table entries (`LOAD`, `SAVE`, `CHKIN`, `CHKOUT`, `OPEN`, `CLOSE`, `CLALL`, `SETLFS`, `SETNAM`), see `../hardware/kernal-routines-reference.md`.

---

## krill_loader_integration — Adopting Krill's fast loader

**Complexity:** high
**Region:** both
**Uses registers:** DD00
**Uses kernal:** LOAD, CHKIN, CHKOUT
**Demands:** serial_bus_exclusive

### Why

The KERNAL LOAD path at `$FFD5` is rate-limited by the 1541's software serial protocol, which delivers roughly 300-400 bytes per second in practice. Loading a packed 50 KB part takes around 130 seconds at KERNAL speed — more than two minutes. Krill's fast loader (by Krill of Plush, active development since around 2010 with frequent revisions through 2024) achieves about 7 kB/s typical and 7.7 kB/s peak on a 1541 (the v194 README's figures; an earlier version of this page said 7,500-7,800 B/s), a roughly 18-20x improvement over the KERNAL. At that speed, the same 50 KB loads in about seven seconds. The difference is the boundary between a production that feels responsive and one that tries the audience's patience.

### How

Krill uses a parallel protocol: instead of the KERNAL's bit-banged serial handshake driven by software on the C64 side, it loads custom 6502 machine code into the 1541 drive's RAM via the drive's memory-write (`M-W`) command followed by a memory-execute (`M-E`) command. The drive-side code replaces the 1541's normal serial-protocol loop with a tighter loop that drives the IEC lines directly through VIA1 port B in a tight handshake loop (the VIA shift register is used for GCR reading from the disk, not for the bus transfer — an earlier version of this page said the transfer used it). On the C64 side the program calls the resident's own entry points (`loadraw`, `loadcompd`) directly: Krill v194 does not hook the KERNAL LOAD vector at `$0330`/`$0331` and its source contains no write to it — that is how the classic cartridge fastloaders work, see `pitfalls/loader.md` (`fastloader_kernal_dependency`). An earlier version of this paragraph said Krill patched `$0330` so that `JSR $FFD5` took the fast path.

The installation sequence is:

1. Open a command channel to drive 8 (or whichever device number): `SETLFS 15, 8, 15`, `SETNAM ""`, `OPEN`. See `../hardware/kernal-routines-reference.md` for the SETLFS/SETNAM/OPEN sequence.
2. Send the drive-side code via `M-W` commands over the command channel. Krill's distribution includes a pre-assembled drive binary; the installer sends it in 35-byte `M-W` blocks (35 is the DOS maximum per command — v194 `src/install.s` compares against `#35`; an earlier version of this page said 32).
3. Send `M-E $0500` (or whatever address the drive code was loaded to) via the command channel. The 1541 begins executing the receiver loop.
4. The C64-side stub (a few hundred bytes, typically placed at a known spare area like `$0200` or tacked above the BASIC program area) initializes its state and signals the drive that the handshake is ready; it does not touch `$0330`/`$0331` (an earlier version of this step said it installed itself there).
5. Loads are made by calling the resident directly — `loadraw` for a raw file, `loadcompd` for a crunched one, filename pointer in X/Y (see the v194 reference below). `JSR $FFD5` is not accelerated, and while the drive is in loader mode every KERNAL serial call (`$FFD5`, `krnio`, `CHKIN`/`CHKOUT` on device 8) stalls until `uninstall` returns the drive to DOS. An earlier version of this step said all subsequent `JSR $FFD5` calls took the fast protocol and that `CHKIN`/`CHKOUT` kept working.

Because the patched vector intercepts the KERNAL jump table's LOAD entry rather than replacing the ROM, the KERNAL's file-open state management (logical file numbers, SETLFS/SETNAM bookkeeping) is preserved. (An earlier version of this page described a `KRILL_OPEN_CHANNEL` build option for servicing `OPEN`/`CHKIN` channels; no such option exists in v194, which exposes only `loadraw`/`loadcompd` and does not service KERNAL logical-file channels — see the v194 note below.)

### Why it works

The 1541's standard serial protocol is slow because it was designed for robustness on a bus shared with printers and other peripherals, and because Commodore's engineers optimized for component cost rather than speed. The tight software loop in the KERNAL's `IECIN`/`IECOUT` routines introduces handshake overhead for every bit. Krill's drive-side code takes full control of the 1541's 6502 and VIA chip, eliminating that overhead. The transfer sends two bits per handshake, one on CLK and one on DATA, with ATN as the clock: it exploits the ATN line (CIA2 `$DD00` bit 3 on the C64 side, VIA pin on the drive side) as the out-of-band handshake signal. On C64 hardware the IEC lines are CIA2 `$DD00` bits 3-7: ATN OUT bit 3, CLK OUT bit 4, DATA OUT bit 5, CLK IN bit 6, DATA IN bit 7 — the C64-side stub drives and samples those bits directly in the tight loop, bypassing the KERNAL's slower bit-banging. (Bit 2 is the RS-232 TXD output and is not part of the IEC bus; an earlier version of this page put ATN on bit 4 and CLK/DATA on bits 4, 3 and 2, and spoke of the VIA clocking "multiple bits per cycle". See `../hardware/cia-reference.md` §`$DD00`.)

NTSC compatibility: Krill includes an NTSC-compatible build option (the `NTSC_COMPATIBILITY` define in `loaderconfig.inc` for the cc65 build — **not** a KickAssembler `-DNTSC=1` flag; older KB text was wrong about the toolchain) because the timing loop on the C64 side is tuned to clock counts. NTSC's slightly different system clock (1.022 MHz vs PAL's 0.985 MHz) shifts the timing window slightly. Enabling `NTSC_COMPATIBILITY` makes a single resident binary run on both PAL and NTSC at a slight PAL-speed cost. Important: **PAL vs NTSC is not auto-detected by the install routine**, and no error is returned when running a PAL-only build on NTSC — for maximum speed you detect the machine yourself and select either the PAL-only or the NTSC-compatible resident. Using a PAL-only build on NTSC hardware typically causes load corruption or hangs.

### Variations

**Integrated decruncher (loadcompd).** Krill loads and depacks compressed files on the fly via the `loadcompd` entry point (enabled with `LOAD_COMPD_API` + a non-NONE `DECOMPRESSOR` in `loaderconfig.inc`), enabling load-and-decrunch pipelines that eliminate a separate decompression pass. The bundled decompressors live in `loader/tools/` and are selected by the `DECOMPRESSOR` config define — TSCrunch and ZX0 are "strongly recommended for demos", BITNAX / LZSA2 / TinyCrunch are recommended, and Exomizer / ByteBoozer2 / Doynax / NuCrunch / PuCrunch / SubSizer are also available (see `exomizer_basics` and `byteboozer_packer`).

**Multiple drive support.** Krill can be configured to install on drives at device addresses 8 through 11. On a multi-drive system, install separate drive stubs; the C64-side dispatch table selects the drive by device number before each LOAD call.

**Resetting the drive after use.** If the fast-loader stubs are in the 1541's RAM and the C64 resets, the drive stubs remain active and may interfere with a subsequent cold KERNAL LOAD attempt. A `UJ` (power-on reset: it jumps through the 1541's own reset vector, `$FFFC` -> `$EAA0`) or a bare `UI` (soft/warm reset via the vector at `$65`, default `$EB22`) sent over the command channel restarts the DOS and abandons RAM-resident code. `UI-` and `UI+` do not reset anything — they only set the drive's bus-timing flag at `$23` (`UI-` = VIC-20 timing, `UI+` = C64 timing) and return; an earlier version of this page named `UI-` as a reset. Krill also offers an `uninstall` entry point when built with `UNINSTALL_API`, which returns the drive to DOS cleanly without a reset.

### Cycle budget

Krill's 2-bit+ATN protocol moves each byte as four bit pairs on CLK/DATA, clocked by the host toggling ATN. Both ends are handshake loops of about 72 cycles per byte (v194 source: four 18-cycle phases on the C64 side, 69 cycles in the 1541's sendloop; the README states "72 cycles per byte"), which is a raw ceiling of roughly 13.7 kB/s; sector reads, GCR decoding, head stepping and per-block handshakes bring it down to the README's figures: 7.7 kB/s peak on a 1541, about 7 kB/s typical. The loading call blocks the mainline, but the receive loop leaves interrupts enabled and the drive simply waits on the handshake, so IRQ/NMI, sprites and badlines are allowed without restriction — music and IRQ-driven effects normally keep running while a part loads. (An earlier version of this page gave 17-22 C64 cycles and ~85 drive cycles per byte, 7,500-7,800 B/s, and said the CPU could run no other code during a load; the v194 README contradicts all three.) Sparkle (see `sparkle_irq_loader`) is the same kind of loader: 2-bit+ATN, 72 cycles a byte, blocking calls with interrupts free (an earlier version of this sentence said Sparkle loaded without a blocking mainline call; its manual says its calls block).

### v194 concrete integration reference (cc65 build)

Primary-source facts, verified against **Krill's Loader, repository version 194** (Plush, Nov 2022). This corrects/expands the generic description above.

**Provenance + distribution.** Krill's Loader is distributed as `loader-vNNN.zip` releases via CSDb (the "Repository Version NNN" releases). There is **no public git repository**; CSDb blocks automated downloads, so fetch it in a browser. The archive layout is `loader/{src,include,build,samples,docs,tools}` + `shared/`.

**Build system: cc65 — not KickAssembler or ACME.** The loader assembles with `ca65`/`ld65`/`ar65` plus GNU `make`, `gcc` (to build `cc1541` and the bundled compressors), and `perl` (symbol-file generation). **Use cc65 from git (V2.19+); the tagged 2.18 release (e.g. Homebrew's) silently miscompiles Krill v194 — the build is clean but the resident returns DEVICE_NOT_PRESENT / hangs on install.** Verified 2026-05-20: Homebrew cc65 2.18 produced a broken loader; cc65 git V2.19 (`cc3c40c`) produced a working one. (Also: `make-loadersymbolsinc.pl` uses `grep -P`, so on macOS put GNU grep ahead of BSD grep, or the symbol-file step errors.) `docs/Prerequisites.txt` lists the exact dependencies. Two integration modes, both driven by the `Makefile` in `loader/src/`:

- **`lib` target** → `build/loader-c64.lib`, linked directly into a **cc65** program by `ld65` via the `DISKIO`, `DISKIO_ZP`, and `DISKIO_INSTALL` segments (see `samples/cc65/`: `Makefile`, `Linkfile`, `c-program.c`). Use this only when your whole program is cc65.
- **`prg` target** → standalone binary blobs `build/install-c64.prg`, `build/loader-c64.prg`, and the symbol file `build/loadersymbols-c64.inc`. Built with `make PLATFORM=c64 prg INSTALL=<hexaddr> RESIDENT=<hexaddr> ZP=<hexbyte> [config defines]`. **This is the path for non-cc65 toolchains** (Oscar64, KickAssembler, raw asm): place the two blobs (after stripping each PRG's 2-byte load-address header) at the configured addresses and `JSR` the entry-point addresses from the symbol file. `samples/minexample/minexample.s` shows the blob-embedding pattern with `.incbin`.

**Memory footprint (default prebuilt config `INSTALL=1000 RESIDENT=0200 ZP=e0`).** Three relocatable pieces:
- *Installer* — transient, ~6.7 KB (`install` at `$1000`, code `$1000-$2B53`). Runs once to upload drive code + initialise the resident, then its RAM can be reused.
- *Resident loader* — tiny, ~520 B (`$0200-$0407`); holds the `loadraw`/`loadcompd` entry points. Must persist for all loads.
- *Zeropage* — a small window (default `$E0-$EF`; `loadaddrlo=$E0`, `loadaddrhi=$E1`).

All three are relocatable via the `INSTALL=`/`RESIDENT=`/`ZP=` make args. **Watch for zeropage collision** with a C compiler's own ZP register window — pick `ZP=` in a range the compiler leaves free.

**API (resident entry points — called directly, no `$FFD5` interposition required).** From `include/loader.inc`:
- `install` — KERNAL ROM must be enabled; it executes `CLI`. Out: `C`=set on error, `A`=status, `X`=drive type, `Y`=zp address of a version string. Call once at startup.
- `loadraw` — load a file without decompression. In: `X`/`Y` = lo/hi of a 0-terminated filename (an empty name loads the *next* file). If `LOAD_TO_API` is enabled, `C=0` loads to the file's stored address and `C=1` loads to a caller address in `loadaddrlo`/`loadaddrhi`. Out: `C`=error, `A`=status.
- `loadcompd` — load + depack (needs a `DECOMPRESSOR`).
- `fileexists`, `memdecomp`, `save` (`SAVE_OVERWRITE` — Krill **can** save, by overwriting an existing file of the same block size), `swapdrvcod` (run custom drive code), `uninstall` (if `UNINSTALL_API`). Status codes: `OK=$00`, `FILE_NOT_FOUND=$FF`, `DEVICE_NOT_PRESENT=$FE`, `GENERIC_KERNAL_ERROR=$FD`, `TOO_MANY_DEVICES=$FC`, `DEVICE_INCOMPATIBLE=$FB`.

Note: the documented usage calls `install`/`loadraw` **directly**, so the `$0330` vector-interposition model — which an earlier version of the How section above presented as Krill's mechanism — is not how v194 works at all: that concern (and the `fastloader_kernal_dependency` pitfall) applies to loaders that hook `$FFD5`. Krill's optional `LOAD_VIA_KERNAL_FALLBACK` mode does not hook it either; its fallback path calls `OPEN`/`CHKIN`/`BASIN` byte by byte and writes no vector.

**Raw-file load addressing.** Raw files are standard PRGs: `loadraw` consumes the first two bytes as the load address. To land a *header-less* data blob at a known buffer, build with `LOAD_TO_API=1` and set `loadaddrlo`/`loadaddrhi` with `C=1` — but the file must still carry a 2-byte prefix (those bytes are consumed even when the destination is overridden). Give author-time data files a 2-byte prefix.

**VIC-bank / bus-lock protocol (`$DD00` is shared between the VIC bank bits and the IEC bus).** `include/loader.inc` provides `SET_VIC_BANK` (A = VIC bank 0..3) to tell the loader the active bank, and `ENTER_BUS_LOCK` / `LEAVE_BUS_LOCK`. The rules (verified the hard way 2026-05-20):
- The loader does **not** magically preserve a non-default VIC bank by itself — a raw `loadraw` left `$DD00`'s bank bits changed across the load. You must tell it the bank via `SET_VIC_BANK`, or re-assert the bank yourself **between** loads.
- **Never raw-write `$DD00` while the loader is armed/resident.** Doing so corrupts its bus-lock state and the *next* drive op (load or uninstall) hangs. While the loader is idle you may write `$DD00` (e.g. to set the VIC bank), but a load must be entered through the loader's expectations (`LEAVE_BUS_LOCK` before / `ENTER_BUS_LOCK` after in the macro API). For a turn-based game that loads only at screen transitions, re-asserting the VIC bank as an idle write after each load (display paused) is the simplest safe pattern.

**Drive compatibility + fallback.** `ONLY_1541_AND_COMPATIBLE=1` shrinks install code by treating every drive as a 1541. `LOAD_VIA_KERNAL_FALLBACK=1` makes the loader fall back to the KERNAL load path when drive-code installation fails (incompatible drive such as SD2IEC, or true-drive emulation disabled) — directly mitigating `gcr_timing_assumes_stock_drive` at the cost of speed on those devices. Other tunables: `FILENAME_MAXLENGTH`, `DIRTRACK`/`DIRTRACK81` (shadow directory for dir-art), `FILE_EXISTS_API`, `UNINSTALL_API`, `LOAD_UNDER_D000_DFFF`, `END_ADDRESS_API` (progress displays).

**Emulator requirement.** Krill needs cycle-accurate **true-drive emulation** — in VICE keep true-drive enabled (the `x64sc` default — the monitor reports `Drive8TrueEmulation=1`); do **not** pass `+drive8truedrive` (per unit, 9-11 likewise; disabling it breaks the GCR protocol). An earlier version of this page named a `+truedrive` option, which `x64sc` rejects as unknown. See `../runtime/vice-reference.md`.

**Bundled tooling.** `loader/tools/` ships the compressors (exomizer-3.1, b2/ByteBoozer2, tscrunch, dali/zx0, bitnax, lzsa, pucrunch, nucrunch, subsizer, tinycrunch, doynamite, wcrush) and `cc1541` for building disk images.

**Embedding into an Oscar64 program (verified recipe, 2026-05-20).** Oscar64 cannot link the cc65 `.lib`, so use the `prg` target and embed the blobs:
- Build with git cc65: `make PLATFORM=c64 prg INSTALL=c000 RESIDENT=cd00 ZP=e0 EXTCONFIGPATH=<cfg> LOAD_RAW_API=1 LOAD_TO_API=1 NTSC_COMPATIBILITY=1 ONLY_1541_AND_COMPATIBLE=1 UNINSTALL_API=1`. Sizes: installer ~3.2 KB (transient), resident ~250 B.
- **Copy the resident after install, or put it OFF page 2.** Copying the resident to `$0200` *before* calling `install` lets install's KERNAL file-table writes (`$0259+`, made when it opens the drive command channel for the `M-W` upload) corrupt it, and the copy itself replaces the IRQ/BRK/NMI vectors at `$0314-$0319` with loader code; either copy after install with the CIA1 timer IRQ masked, or relocate (e.g. `INSTALL=$C000`, `RESIDENT=$CD00` in the free `$C000` block above the transient installer). `$0200` is Krill's own prebuilt default and the README requires only that a sub-`$0400` resident be copied *after* install — the hang an earlier version of this page attributed to page 2 itself is the ordering mistake. After install, the installer's RAM is reusable.
- Convert each blob to a C array (strip the 2-byte PRG header), `memcpy` to its origin at boot, then call the entry points via `__asm` (`jsr $C000` install, `jsr $CD00` loadraw with `X/Y`=filename ptr and `SEC`+`loadaddrlo/hi` for LOAD_TO). Disabling the CIA1 timer IRQ (`$DC0D=$7F`) is *not* required for install to succeed for a resident placed off page 2, but is good hygiene during cycle-exact transfers; a `$0200` resident destroys the `$0314` vector, so it is mandatory there.
- **Filename matching:** Krill compares the name bytes you pass against the directory entry. A file written by `c1541 -write host.bin name` (lowercase host arg) matches an **uppercase** ASCII request (`"TDLVL00"`, `0x54...`) — same convention as KERNAL `krnio`. A lowercase request gives FILE_NOT_FOUND.
- **Raw data files need a 2-byte prefix:** `loadraw` consumes the first two bytes of a raw file as a load address even with `LOAD_TO_API` overriding the destination. Prepend two dummy bytes to header-less data blobs at authoring time.
- **Save coexistence:** while the loader is resident the drive is in loader mode, so *all* KERNAL serial (`krnio` / `$FFD5`) stalls. To save via KERNAL: `uninstall` (drive returns to DOS) → KERNAL write → `install` again. Loads (incl. load-game) go through `loadraw`. Validated round-trip: install → loadraw → uninstall → krnio save+readback → reinstall → loadraw.
- **Keeping Krill resident is incompatible with `vic_setmode`/VIC-bank switches (important).** Any code that raw-writes `$DD00` — including Oscar64's `vic_setmode()`, which sets the VIC bank — corrupts the *armed* loader's bus-lock, hanging the next `loadraw`/`uninstall`. A game that switches VIC modes (e.g. a bitmap title ↔ text play screen) therefore should **not** keep the loader installed across those switches. The robust pattern (VICE-verified in Tideline) is **lazy install**: install only around each load batch (probe / level load / load-game), `uninstall` immediately after, then re-assert the VIC bank. With this model the drive sits in DOS by default, so **saves are plain `krnio` with no uninstall dance**, and there is no `$DD00` conflict because no `vic_setmode` runs inside the install→loads→uninstall window. Cost: one install (drive-code upload) per load batch — fine for infrequent loads; reconsider only if loads are very frequent.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; that recipe is a single self-contained PRG with no loader, no disk access and `uses_kernal: []`. For the blob-embedding pattern see Krill's own `samples/minexample/minexample.s`, already cited above — external, not a recipe in this set.)

---

## wcf_packer — WCF (William Crucial Files) format compression

**Complexity:** medium
**Region:** both
**Uses kernal:** (none — runtime depacker is standalone)

### Why

WCF (William Crucial Files) is a classic C64 LZ-style packer from the early-to-mid 1990s. It uses a simple LZ77-style sliding-window encoder: the compressor searches a look-back buffer for matches to the current input sequence and emits either literal bytes or (offset, length) copy references. The runtime depacker is self-contained, requires no KERNAL calls, and runs entirely in C64 RAM. WCF does not achieve the compression ratios of Exomizer or ByteBoozer, and its depacker is larger than ByteBoozer's, but it remains relevant for legacy codebases that were built around it and for understanding the lineage of C64 packing tools.

**Legacy notice:** For new work, prefer Exomizer (see `exomizer_basics`) for best compression ratio or ByteBoozer (see `byteboozer_packer`) for smallest depacker. WCF is documented here for completeness and for reverse-engineering situations involving older cracker productions.

### How

The WCF workflow is offline:

1. Run the WCF compressor on the input PRG: `wcf input.prg output.wcf`. The output includes an embedded depacker stub.
2. The depacker stub is entered at the SYS target; it decompresses the payload in-place, expanding upward from the end of the packed data to the original load address. The expansion is back-to-front to avoid overwriting source bytes before they are consumed.
3. The resulting `.prg` file is loaded normally via KERNAL LOAD or a fast loader.

### Why it works

LZ77 compression works because real data (code and screen graphics especially) contains many repeated byte sequences. The encoder stores a single (offset, length) tuple instead of repeating the sequence, and the decoder reconstructs the original by copying from the already-decoded portion of the output buffer. The back-to-front depacking direction guarantees that the copy source is always in already-decoded space even when the output overwrites the packed input — a standard in-place decompression technique.

### Variations

**Standalone depacker.** The depacker can be extracted from the packed PRG and assembled independently if the target production has its own loader that handles the depacker setup. This is occasionally used in cracktro pipelines that chain multiple depackers.

### Cycle budget

Decompressing a 50 KB part takes on the order of seconds on PAL, not milliseconds: writing 50 KB with a bare `LDA (zp),Y` / `STA (zp),Y` copy loop alone costs about 820,000 cycles (0.83 s, measured in VICE with the screen blanked), and an LZ depacker adds bit-decoding on top of that — tens of cycles per output byte, so roughly 2-5 s depending on the data and the depacker (an estimate; no WCF binary is on this machine to time). An earlier version of this page gave 80-120 ms, which is under one CPU cycle per byte and impossible. The depacker size is approximately 150-200 bytes; specific figures depend on the version of the tool in use (no publicly canonical version number; tool was distributed through the warez scene with no formal release cycle).

---

## exomizer_basics — Exomizer compression workflow

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

Exomizer, written by Magnus Lind and actively maintained through version 3.1.2 (released 2021), is the de-facto standard C64 packer. It produces better compression ratios than WCF or ByteBoozer for typical C64 code and graphics, and its runtime depacker is both well-understood and small enough (~200 bytes for the `sys` variant) to embed in any production. The tool is cross-platform (runs on Linux, macOS, Windows), open-source, and its output is reproducible. When a C64 demoscene production needs to pack a part, Exomizer is the default choice unless depacker byte-count is the primary constraint.

### How

Offline compression produces a self-extracting PRG:

```
exomizer sfx sys -o packed.prg unpacked.prg
```

The `-o packed.prg` specifies the output; `unpacked.prg` is the source file. The `sfx sys` variant embeds a depacker that, on SYS, decompresses the payload and jumps to the original entry point. The depacker executes from a scratch area (default: `$0100` stack page, which Exomizer can use since the stack is not needed during decompression).

For raw streams without a SYS stub — used when Krill's `loadcompd` decrunches the file on the fly (built with the Exomizer decompressor selected) or when your own loader calls the depacker — use:

```
exomizer raw -o packed.raw unpacked.prg
```

The raw format carries no entry-point metadata; the calling code is responsible for setting up the depacker and passing the source and destination addresses.

**Level mode** (`exomizer level`) targets multi-file scenarios where individual files in a game level must be decompressed independently. Level mode trades some ratio for faster decompression because it avoids back-references that cross file boundaries.

### Why it works

Exomizer uses a variant of the LZMA algorithm adapted for 8-bit targets. It models the input with an LZ77 sliding-window matcher combined with a Huffman-like variable-length coding stage that assigns shorter codes to more frequent literals and match lengths. The result approaches 60-80% of original size for typical C64 machine code and 40-60% for graphics data (lower ratios for already-structured bitmap data). Decompression is slow relative to a plain copy: roughly 75-110 cycles per output byte for the sfx decruncher (Exomizer 3.1's `exo31info.txt` tables), so a 50 KB block takes seconds, not milliseconds — see the cycle budget below. An earlier version of this page said 50-80 ms per 50 KB, which is about one CPU cycle per byte and impossible.

Exomizer's standard depacker (`exodecrunch.s`, and the sfx stub built from it) decrunches backwards: it writes output from the highest destination address down, reading the packed data from its end toward its start. This is what makes in-place expansion work — the packed buffer is placed so that its end sits at (or just above) the end of the destination range, and every packed byte is consumed before output reaches it. The `sfx sys` mode handles this layout automatically; in `raw` mode you must place the packed data accordingly (or leave the ranges non-overlapping). Forward decrunching (low to high) is an option, not the default: a forward decruncher contributed by Krill shipped with 2.0beta5 (2006), and since 3.1.0 (2020-12-22) it is a build switch in `exodecrunch.s` (`DECRUNCH_FORWARDS = 1`; the file defaults it to 0); the data must then be crunched with the matching forward option, since the stream direction is fixed at crunch time. An earlier version of this section said the default was forward.

### Variations

**Exomizer 3 vs Exomizer 2.** Version 3 (available from `https://bitbucket.org/magli143/exomizer`) introduced improved compression for small files and the explicit `level` and `raw` modes. Version 2 had a slightly different raw format; if using Krill's built-in Exomizer decompression (`loadcompd`), verify which Exomizer version the loader build expects — the Krill README specifies this per Krill release.

**Multiple input files.** Exomizer accepts several input files, but it does not chain them:
```
exomizer sfx sys -o part.prg code.prg gfx.prg music.prg
```
All inputs are loaded into one 64 KiB memory image in command-line order (a later file overwrites any earlier one at the same addresses), and that single image — from the lowest start to the highest end, gaps zero-filled — is crunched once and decrunched once, with one entry point (the SYS at the BASIC start, or the address given with `sfx <jmpaddress>`). The `sfx` usage text says so: "All infiles are merged into the outfile. They are loaded in the order given." This is for assembling one part from separate code, graphics and music files, not for running parts one after another; a multi-part production still needs a loader such as Krill with Exomizer `raw` streams. An earlier version of this page said the parts "decompress in sequence".

### Cycle budget

Depacker size: approximately 200 bytes for the `sfx sys` variant (Exomizer 3.1.2, measured from the default depacker template). Decompression time: roughly 75-110 cycles per output byte for the sfx decruncher and roughly 60-100 for the raw/memory decruncher (Exomizer 3.1's `exo31info.txt` tables; measured here at 45 KB in 3.37 M cycles with `exomizer desfx -S` and 3.4-3.8 M cycles end-to-end in VICE x64sc), so a 50 KB part takes about 4-6 seconds on PAL, not milliseconds. An earlier version of this page said 50-80 ms (50,000-80,000 cycles) per 50 KB, about 50x too fast. Time is data-dependent; highly compressible data (long matches) is at the low end.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; that recipe is assembled to a plain PRG and is not packed with Exomizer, ByteBoozer or any cruncher.)

---

## doynax_decruncher — Doynax LZ packer integration

**Complexity:** medium
**Region:** both
**Uses kernal:** (none)

### Why

Doynamite (by Doynax; the author's real name is not verifiable here and an earlier version's "Johan Forsberg" attribution is dropped) is a compact, fast LZ depacker of roughly 225-260 bytes: the regular `decrunch.asm` assembles to 259 bytes with ACME, the stripped "simple" variant to `$E1` = 225 bytes (as its readme states), and the self-extracting form measured 309 bytes of total sfx overhead — comparable to Exomizer's depacker, not half of it (an earlier version of this page said ~100 bytes). The trade-off against Exomizer is a modestly worse compression ratio for the same input data; typical code files compress to around 65-85% of original size versus Exomizer's 60-80%. The Doynax packer is a niche choice, valued for depack speed rather than depacker size; a 225-259-byte depacker cannot be the reason a 256-byte intro would use it.

### How

The Doynax packer toolchain workflow is similar to Exomizer:

1. Compress offline: `lz [-o out.lz] [--sfx addr | --raw | --level] [--binfile] in.prg` from the Doynamite 1.1 distribution bundled in Krill's `loader/tools/doynamite1.1/` (`lz.c` source, plus the depacker sources `decrunch.asm` and `sfx.asm` in ACME syntax). An earlier version of this page named a `doynax-pack` command, which does not exist.
2. Assemble the depacker with the packed data appended: the depacker is a subroutine that takes a source pointer in ZP and a destination pointer in ZP, expands the data, and returns with `RTS`. It is not position-independent — it self-modifies absolute pointer operands (`lz_sector_ptr1..3 = *+1`) and the shipped `sfx.asm` relocates it with `!pseudopc` — so assemble it for the address it will run at. Include it in your project's assembler source.
3. At runtime: store source and destination pointers, `JSR decrunch_entry`.

The depacker source is in the Doynamite 1.1 distribution shipped with Krill's loader (v194); an earlier version of this page pointed at a `doynax/doynax-lz` GitHub path, which is not verifiable from this machine.

### Why it works

Doynax uses a two-level LZ scheme: a literal run mode and a back-reference mode, with a simple 1-bit tag in the compressed stream indicating which mode each token uses. The tag-bit approach avoids Huffman-like code tables in the depacker, which is the primary reason the depacker is so compact — there is no code table to initialize or walk. The cost is that optimal encoding (choosing between literal and back-reference) is done entirely by the offline compressor with no adaptive coding, which limits the ratio on data with non-uniform symbol frequencies.

### Variations

**Integrate with Krill.** Krill v194 decrunches Doynamite streams on the fly through `loadcompd` when the Doynamite decompressor is selected in `loaderconfig.inc` (the same `DECOMPRESSOR` switch as the ByteBoozer 2 and Exomizer options); there is no post-load callback hook — an earlier version of this paragraph described one. The alternative is `loadraw` into a buffer followed by a `JSR` to the depacker with ZP pointers set to the loaded block: load, decompress in place, continue.

**Zero-page/stack-page depacker.** The shipped `sfx.asm` copies the ~227-byte depacker to `$00C2`, where it spans the top of zero page and the low stack page, freeing the `$0801` area for the payload. This is useful in productions where low-RAM real estate is fully allocated. (An earlier version of this page said a 100-byte position-independent depacker "fits comfortably in the stack page"; it is neither 100 bytes nor position-independent.)

### Cycle budget

Decompression time: decompressing a 50 KB part takes on the order of seconds on PAL, not milliseconds: writing 50 KB with a bare `LDA (zp),Y` / `STA (zp),Y` copy loop alone costs about 820,000 cycles (0.83 s, measured in VICE with the screen blanked), and an LZ depacker adds bit-decoding on top of that — tens of cycles per output byte, so roughly 2-5 s depending on the data and the depacker (an estimate; Doynamite's depacker was not timed here). Its per-token overhead is lower than Exomizer's, so it sits toward the fast end. An earlier version of this page gave 40-60 ms per 50 KB, which is under one CPU cycle per byte and impossible. Depacker size: 259 bytes for the regular `decrunch.asm`, 225 (`$E1`) for the "simple" variant (Doynamite 1.1 as shipped in Krill v194, assembled with ACME; an earlier version said 100-110).

---

## sparkle_irq_loader — Sparkle: an interrupt-tolerant loader and disk builder

**Complexity:** high
**Region:** both
**Uses registers:** DD00, DD02
**Uses kernal:** (none)
**Demands:** serial_bus_exclusive, kernal_rom_out

(An earlier version of this section credited Sparkle to JackAsser and Hollowman, marked it PAL-only, and described a raster IRQ at line 0 that received bytes in the background at 2,500-3,000 B/s while the main program polled a flag, with double-buffered blocks and a pause mode; the Sparkle 3.4 user manual contradicts or does not describe all of it, and the section below is rewritten from that manual. Nothing in it was measured here.)

### Why

Sparkle is a disk builder and loader in one, by Sparta (OMG), released under the BSD 3-Clause licence. A PC tool reads a text script (`.sls`) that lists the files, packs them into bundles and writes a D64 with the loader installer on it (manual pp. 2-4). The C64 side is a small resident loader and depacker. Its loader calls block, like Krill's (manual p. 23: "Sparkle's loader calls ... are blocking calls"), but the transfer is "freely interruptible" (p. 3), so raster IRQs, music and effects keep running while a bundle loads. The manual calls it an "all-in-one" solution: the same tool handles compression, disk layout and multi-side productions (p. 3).

### How

1. **Build the disk.** List files in the script; each bundle is loaded by one call. Files bound for `$D000`-`$DFFF` are marked with `*` so the depacker switches `$01` for them (pp. 10, 13).
2. **Boot.** Every directory entry on a Sparkle disk loads the installer. It installs the C64 resident code and the drive code, sets the I flag, writes `$35` to `$01` (KERNAL and BASIC banked out), cuts the stack to its lower `$60` bytes, and loads the first bundle. It then jumps to the start address with IRQs still disabled; it changes no other vector and no VIC register (pp. 15-16).
3. **Load the next part.** `JSR Sparkle_LoadNext` (`$021C`) loads the next bundle in script order, with no parameters (p. 17). `LDA #index : JSR Sparkle_LoadA` (`$019C`) loads bundle `$00`-`$7F` by index; `$80`+side requests another disk side (pp. 17-18).
4. **Prefetch.** `JSR Sparkle_SendCmd` (`$017A`) with a bundle index makes the drive find the bundle's first sector without transferring it; `JSR Sparkle_LoadFetched` (`$019F`) then loads it. `SendCmd` with `A=$FF` resets the drive (p. 18).
5. **Between parts.** `Sparkle_IRQ` (`$0160`) is a fallback interrupt handler that saves `$01`, sets `$35`, acknowledges `$D019` and calls `Sparkle_IRQ_JSR` (`$016E`, initially pointing at an RTS; patch it to a music player). Its RTI is at `$0179` (pp. 19-20).

Resident memory (pp. 3, 16):

| Range | Contents |
|---|---|
| `$0100`-`$015F` | the stack, reduced from a full page; restore SP to `$5F`, never `$FF` (p. 30) |
| `$0160`-`$0179` | `Sparkle_IRQ` |
| `$017A`-`$019B` | `Sparkle_SendCmd` |
| `$019C`-`$019E` | `Sparkle_LoadA` |
| `$019F`-`$02FF` | `Sparkle_LoadNext` and the depacker |
| `$0300`-`$03FF` | loader buffer; holds the start of the next bundle between sequential calls, so leave it alone or make the next call indexed (p. 16) |

Zero page: three bytes, `$02`-`$04` by default, chosen in the script, and free to use between loader calls (pp. 3, 9). Do not load anything into pages 1-3 (p. 30).

Drives: "Tested on 1541, 1541-II, 1571, and Oceanic drives, compatible with the 1541 Ultimate family" (p. 3). PAL and NTSC are both supported, plugins included (p. 3).

### Why it works

The C64 talks to the drive through CIA2 `$DD00`, 2 bits at a time plus ATN, at 72 cycles a byte (p. 3). Because the C64 clocks each bit pair with ATN, an interrupt between pairs only delays the transfer; the drive waits. The manual states the result ("Transfer is freely interruptible", p. 3), not this reasoning, which is from `krill_loader_integration`'s description of the same protocol family (rung 4 here).

Two rules follow from sharing `$DD00` with the VIC bank bits:

- **VIC bank.** Do not write `$DD00`; the loader may read the change as a drive command and reset the drive. Select the bank with `LDA #$3C+bank : STA $DD02`, bank 0-3 (pp. 20-21; common issue 1, p. 29). Any value may go into `$DD02` between loader calls if `$3C`+bank is back before the next call (the "indirect bus lock", pp. 21-22).
- **Free `$DD00`.** Write `$03` (any value with bits 3-5 clear) to `$DD02` first; then any value may go into `$DD00`. Restore `$DD00` to `$38`, then `$DD02` to `$3C`+bank, in that order (the "direct bus lock", pp. 22-23).

`pitfalls/loader.md` `fastloader_dd00_write_corrupts_resident` compares these rules with Krill's and Bitfire's.

Interrupt handlers must cope with `$01`: each loader call writes `$35` and may switch to `$34` while it depacks under I/O. A handler that touches I/O saves `$01`, sets `$35` and restores it (p. 20). Nested IRQs must save A, X, Y and `$01` to different places, or the outer handler returns the inner one's values to the loader and it crashes (common issue 7, p. 30).

### Variations

**More stack.** `Config: noirq` in the script drops the fallback IRQ and frees `$0160`-`$0179` for the stack (SP `$79`); `Config: basic` also drops `SendCmd` and `LoadA`, leaving sequential loading only, and frees the stack up to `$019E` (SP `$9E`) (pp. 9, 16).

**Disk flip without blocking.** `SendCmd` with `$80`+side returns at once; the program then writes `$08` to `$DD00` (the manual's own sanctioned `$DD00` write) and polls `$DD00` for the drive's ready signal from the main loop or an IRQ (pp. 23-24).

**Plugins.** A hi-score saver overwrites pre-defined files, also freely interruptible; a custom drive-code plugin lets a part upload its own drive code and restore Sparkle afterwards (pp. 3, 25-28).

### Cycle budget

Transfer: 72 C64 cycles a byte (p. 3). At 985,248 cycles a second on PAL that is a ceiling of about 13.7 kB/s before sector reads, head steps and depacking (rung 3; the manual gives no bytes-per-second figure). The drive's GCR fetch, decode and verify loop is 124 cycles and tolerates 272-314 rpm (p. 3). Real disks can take up to one extra revolution (10 frames) per bundle, more on a checksum retry, so the manual advises a sync buffer of at least 10 frames and preferably 20 after a load (common issue 9, p. 30). No figure here was measured.

### Sources

- Sparkle 3.4 user manual, Sparta (OMG), `manual/` in https://github.com/spartaomg/SparkleCPP (page numbers above are the manual's).
- Licence: BSD 3-Clause, "Copyright (c) 2019-2026, Sparta/OMG", `LICENSE` in the same repository.

---

## byteboozer_packer — ByteBoozer compression specifics

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

ByteBoozer 2 (by HCL, Booze Design; its decruncher source is headed "ByteBoozer Decruncher /HCL May.2003" and "B2 Decruncher December 2014") ships in Krill's `loader/tools/b2/`. The standalone decruncher `Decruncher.inc` assembles to 245 bytes including its 8-byte offset table. The tool's own executable form (`b2 -c 0801 file.prg`, which writes `file.prg.b2`) prepends a 213-byte block at `$0801`: a 12-byte BASIC line (`SYS 2061`), a 17-byte entry at `$080D` that banks out ROM (`LDA #$34` / `STA $01`) and copies 183 bytes to zero page `$0010`, and a zero-page-resident decruncher plus exit that restores `$01` to `$37` and JMPs to the start address. An earlier version of this page said the depacker was 85 bytes, dated B2 to 2016 and named a `byteboozer2` command; the measured b2 build from Krill v194 contradicts all three. The compression ratio is modestly worse than Exomizer — typical code files compress to around 65-80% of original size versus Exomizer's 60-75% for comparable input — and the depacker's speed, not its size, is its selling point: a ~200-byte depacker is not what 256-byte intros use.

### How

Offline workflow:

```
b2 input.prg              (raw; writes input.prg.b2)
b2 -c 0801 input.prg      (runnable sfx form; writes input.prg.b2)
```

The usage string is `b2 [-[c|e|r] xxxx] <filename>`; output is always `<filename>.b2`, there is no separate output-file argument, and there is no `byteboozer2` command (an earlier version of this page gave `byteboozer2 input.prg output.b2`). The raw `.b2` is the packed data without a SYS stub. The `-c` form is a runnable PRG:

1. The BASIC stub occupies `$0801` in the standard layout: `10 SYS 2061` (12 bytes) followed by the machine-code entry at address 2061 (`$080D`).
2. The 17-byte entry at `$080D` banks out ROM (`LDA #$34` / `STA $01`), copies the 183-byte decruncher to zero page `$0010` and runs it there; it decompresses to the original load address.
3. After decompression, the exit restores `$01` to `$37` and JMPs to the original entry point.

The depacker source is `Decruncher.inc` in the b2 distribution (not `depack.asm`; 245 bytes assembled standalone including its 8-byte offset table). The packed data follows the 213-byte stub in the sfx PRG, or in raw form is loaded to a scratch area first and then decompressed.

### Why it works

ByteBoozer uses a proprietary LZ-style compression that prioritizes depacker simplicity over encoder complexity. The format uses a fixed token structure: each token is either a literal byte or a (distance, length) back-reference. The token header uses a 1-bit flag for literal vs reference, followed by either the literal value or encoded distance/length fields. No Huffman table and no dynamic coding means the depacker needs no initialization beyond setting the read pointer — it simply iterates tokens and writes output. The encoder runs an exhaustive brute-force match search offline to compensate for the format's limited flexibility, which is why encoding a large file takes longer than Exomizer but the depacker is drastically simpler.

### Variations

**ByteBoozer 1 vs ByteBoozer 2.** ByteBoozer 1 dates from May 2003 and ByteBoozer 2 from December 2014 (the dates in the decruncher source's own header; an earlier version of this page said 2004 and 2016, and gave an unverified ~120-byte B1 depacker size, dropped here). B2 revised the token format; the two formats are incompatible. All current scene usage targets ByteBoozer 2.

**Krill integration.** Krill decrunches ByteBoozer 2 data on the fly through its `loadcompd` entry point when built with `LOAD_COMPD_API` enabled and `DECOMPRESSOR = DECOMPRESSORS::BYTEBOOZER2` in `loaderconfig.inc` (v194); there is no separate post-load hook, and the `DECRUNCH_BYTEBOOZER2` option an earlier version of this page named does not exist in the v194 archive.

**Depacker placement.** The depacker can be placed on the zero page, in the stack page, or in the BASIC stub area; the b2 sfx form does run from zero page, but occupies ~184 bytes of it (`$0010-$00C6`), not 85. Zero-page placement does not make the depacker run faster: instruction fetches cost the same from any page, and the depacker's source/destination pointers and bit buffer are zero-page variables wherever the code itself sits (only a self-modifying depacker that reads or writes its own operand bytes with zero-page addressing would gain a cycle per such access). Measured: identical depacker-style code at `$0040` and `$0300` took 11,382 cycles each under VICE. An earlier version of this page claimed a speed gain from zero-page placement. The reason to put the depacker in zero page or the stack page is space: it frees the `$0801` area for the packed payload, as in the layout in `crunched_data_in_basic_stub` below.

### Cycle budget

Depacker size: 245 bytes standalone (`Decruncher.inc` with its 8-byte offset table), 213 bytes of sfx overhead in the `b2 -c` form (measured from the b2 build in Krill v194; an earlier version of this page said 85 bytes). Decompression time: decompressing a 50 KB part takes on the order of seconds on PAL, not milliseconds: writing 50 KB with a bare `LDA (zp),Y` / `STA (zp),Y` copy loop alone costs about 820,000 cycles (0.83 s, measured in VICE with the screen blanked), and an LZ depacker adds bit-decoding on top of that — tens of cycles per output byte, so roughly 2-5 s depending on the data and the depacker (an estimate; the b2 depacker was not timed here). It is faster than Exomizer for similar data because the simpler token format has lower per-token overhead, partially offset by the somewhat lower compression ratio meaning slightly more bytes to read. An earlier version of this page gave 30-50 ms per 50 KB, which is under one CPU cycle per byte and impossible. With a 213-byte sfx stub, a 256-byte PRG leaves 41 bytes of packed data, so a general-purpose packer is not what 256-byte intros use.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; that recipe is assembled to a plain PRG and is not packed with Exomizer, ByteBoozer or any cruncher.)

---

## disk_protection_tricks — GCR-level tricks for copy protection

**Complexity:** scene-tier
**Region:** both
**Uses registers:** DD00
**Uses kernal:** (none — KERNAL bypassed)

### Why

Commercial C64 software from approximately 1984 through 1995 was distributed on floppy disks with copy protection intended to prevent casual duplication. The protection mechanisms operated below the level of the DOS filesystem — at the GCR (Group Code Recording) encoding layer that the 1541 uses to store bits on the magnetic surface. Understanding these techniques matters today for two reasons: reverse-engineering preservation copies of commercial games requires recognizing and neutralizing protections, and the body of GCR-level technique that copy-protection authors developed represents some of the most creative exploitation of the 1541 hardware documented anywhere.

**Scope note:** New productions do not use copy protection. This section documents techniques for recognition and reverse-engineering purposes.

### How

The 1541 stores data using GCR encoding: each 4-bit nibble maps to a 5-bit GCR code, giving 10 bits on disk per byte. Sectors are framed by SYNC marks — sequences of ten or more consecutive 1 bits, which the 1541's bit-counter hardware recognizes as frame delimiters. Standard disk format uses fixed-length SYNC marks, predictable sector IDs, and a fixed number of sectors per track. Copy protection exploits every degree of freedom the hardware allows:

**Half-tracks.** The 1541's stepper motor moves the head in half-track increments (track 1.0, 1.5, 2.0, etc.) even though the standard DOS only steps in full-track increments. A protected disk can write data on half-track 17.5, which a standard DOS never reads. The protection scheme steps the head to 17.5 at startup, reads a signature byte, and verifies it before proceeding. A copy program that only reads full tracks produces a disk missing the half-track data, which fails the check.

**Track signatures and non-standard SYNC patterns.** The standard SYNC is ten or more consecutive 1 bits. A protected disk can write a custom SYNC-length signature: the write routine explicitly pulses the write gate to produce a SYNC of exactly 11 bits, or uses SYNC-like patterns between sectors that the standard DOS interprets as errors. The protection reader uses bit-level polling of the 1541's VIA shift register to detect the exact bit count, which a standard copy cannot reproduce because copy programs reset SYNC detection on the first SYNC edge.

**Variable sector counts.** A standard 1541 track holds 17-21 sectors depending on the track zone. A protection can format a track with 22 sectors by shortening the inter-sector gap, or with 13 sectors by lengthening it. The standard DOS fails to read a track with non-standard sector count because it expects a fixed count. The protection loader uses a custom sector scanner that finds sectors by SYNC polling rather than by count.

**Killer tracks.** Some protections deliberately write malformed GCR data on a track to cause the 1541's read PLA to lock up or the DOS to spin indefinitely looking for a valid sector header that never appears. The protection code times out and interprets the timeout as a "copy-not-present" signal. Killer tracks can damage real disk drives if the disk is inserted in a drive that repeatedly attempts to read the bad track; they are considered hostile by the preservation community.

**Bad-sector signatures.** A sector can be written with an intentionally wrong checksum byte. The standard DOS reports a read error on that sector. The protection's custom reader knows to expect the bad checksum and interprets it as the "original disk" signature. A copy program that tries to duplicate the bad sector writes a corrected-checksum copy, which the protection code rejects.

### Why it works

All of these tricks work because the 1541 provides raw access to the GCR bitstream via its VIA port and shift register if you bypass the DOS ROM. Custom loader code running in the 1541's RAM (installed via `M-W`/`M-E`, exactly as fast loaders do) can read raw GCR sequences, count SYNC widths, step to half-tracks, and tolerate checksum errors that the standard DOS treats as fatal. The C64-side protection code sends parameters to the drive-side code and receives a signed response that only the original disk geometry can produce.

### Variations

**Burst Nibbler / Maverick.** The most widely used copy tools of the era (Burst Nibbler, Maverick, Copy II PC, Final Cartridge) progressively learned to capture each new protection technique by reading raw GCR tracks and reproducing the exact bit patterns. The arms race between protection authors and copy-tool authors drove the GCR techniques to ever more exotic territory, culminating in protections that required specialized hardware or multi-pass reading to defeat.

**Preservation approach.** Modern preservation uses drive-introspection tools (notably Kryoflux, an open-source USB floppy controller that captures raw flux transitions) to create full magnetic images of disks, including all half-tracks and malformed sectors. VICE reads G64 (GCR bit-level) and P64 (flux-pulse-level) images, attached with `-8 image.g64` (or `-autostart`); true drive emulation, on by default, is required for them. It does not read raw KryoFlux stream or SCP dumps — convert to G64/P64 with the KryoFlux/nibtools/HxC tools first. There is no `-floppytype` option (an earlier version of this page named one; `x64sc -help` lists `-drive8type`, which only matters when a different drive mechanism is wanted — the default type reads G64/P64).

---

## multi_load_sequencing — Designing demos around incremental load

**Complexity:** medium
**Region:** both
**Uses kernal:** (none — loads go through Krill's own entry points, not $FFD5; an earlier version of this line said LOAD, which made the compatibility check report a false serial-bus conflict with krill_loader_integration)

### Why

A C64 has 64 KB of RAM, of which roughly 38-40 KB is usable by a production after accounting for the video matrix, character ROM shadow, sprite data, SID, CIA and VIC-II register space, stack, zero page, and the BASIC/KERNAL ROM areas. A multi-part demo cannot hold all its parts in RAM simultaneously: a three-part demo with three distinct sets of graphics, music, and code easily requires 150-200 KB uncompressed. The solution is multi-load sequencing: each part loads the next part's data while (or before) transitioning out of the current part's effect. Done correctly, the audience perceives a continuous flowing production; done badly, a blank screen and a spinning drive indicator for thirty seconds between parts.

### How

The canonical multi-load memory layout dedicates a fixed "persistent zone" that survives across all parts:

```
$0000-$00FF  Zero page — persistent (ZP variables used by loader + IRQ)
$0100-$01FF  Stack — persistent (loader subroutine calls)
$0200-$0407  Krill resident (v194 prebuilt default RESIDENT=0200, 519 B with the
             ZX0 loadcompd entry; a raw-load-only build is ~250 B, see the Oscar64
             notes in krill_loader_integration). Copy it here only AFTER `install`
             returns: install's KERNAL OPEN/CLOSE calls write the file tables at
             $0259-$0276 and other lowmem. This placement also overwrites the
             KERNAL RAM vectors at $0314-$0333, so either mask the CIA1 timer IRQ
             ($DC0D=$7F, as Krill's minexample does) or relocate with RESIDENT=
             (Krill's own sample uses RESIDENT=$2000). An earlier version of this
             layout gave the resident 256 bytes at $0200-$02FF and called
             $0300-$03FF persistent vectors, which the default resident overwrites.
$0800-$0FFF  Music data + SID player (persistent across parts if music loops)
$1000-$BFFF  Part area (fully reclaimed between parts — code + graphics)
```

Transition procedure from Part N to Part N+1:

1. Part N queues its final effect (a fade, a wipe, a scroll-off) that takes approximately 5-10 seconds — enough time to load Part N+1's data.
2. Part N calls the Krill LOAD stub to begin loading `PART_N1.PRG` (or the packed `PART_N1.B2`/`PART_N1.EXO`) into the part area at `$1000`.
3. While the load proceeds, Part N continues its fade effect using only the persistent zone (music player, IRQ handler, border tweak). Code in the part area is finished and no longer called.
4. When the load completes (Krill's LOAD returns to the caller), the transition effect finishes its last frame.
5. Part N JMPs to `$1000` (or the actual entry point specified by the packed PRG's SYS target).

Sparkle (see `sparkle_irq_loader`) follows the same steps: its loader calls block too, and the fade keeps running from interrupts (an earlier version of this sentence said Sparkle loaded in the background so that steps 2-4 ran concurrently; its manual says its calls block).

### Why it works

The key insight is that the 6510's program counter is just another register — once Part N has finished its effect and launched Part N+1, Part N's code is irrelevant. Reusing the same memory range for each successive part is safe as long as the code that initiates the load (the transition code) lives entirely in the persistent zone and the load destination is not the persistent zone itself.

The persistent music zone (`$0800-$0FFF` in the layout above) requires careful negotiation: if Part N+1 brings its own music, it must either load to a different address than the current music, or signal Part N's IRQ to stop calling the old SID player before overwriting it. The standard solution is a "music handshake" flag: Part N+1's init code sets a flag, Part N's IRQ reads it and stops calling the player, and Part N+1's init code then overwrites the music area and installs the new player pointer.

### Variations

**Load during effects vs load-then-start.** The simpler approach is to load the entire next part before starting its effect — load screen displayed, then JMP. The sophisticated approach (concurrent load + effect) requires that the effect code use only persistent-zone resources. Which approach is appropriate depends on whether the production has a "loading screen" aesthetic or demands seamless flow.

**Packed vs unpacked part files.** Loading a packed file via Krill + Exomizer into the part area and decompressing in-place is the most space-efficient strategy. The part area must be large enough to hold the packed data plus the headroom for the depacker to work (the default depacker expands in-place from high address to low, so no extra buffer is needed for the Exomizer `raw` format — see `exomizer_basics`).

**Part numbering and disk layout.** For fastest sequential loading, lay the parts out on disk in the order they will be read. The 1541's track-seek time is the dominant latency for multi-part sequencing: seeking from track 5 to track 30 takes approximately 500ms; sequential parts on adjacent tracks load with minimal seek overhead. Krill does not manage disk layout; use a custom disk-image builder (e.g., `cc1541` or `cbmconvert`) to place files in the desired track order.

### Cycle budget

Per-part load time (Krill fast loader, 50 KB packed part, ~30 KB after Exomizer compression): approximately 4 s transfer plus 2-5 s decompression (Exomizer measured at roughly 4-6 s per 50 KB of output, see `exomizer_basics`; faster depackers toward the low end) — roughly 6-9 s total. A 5-second transition does NOT cover this on its own: either decompress while the next transfer streams (Krill's `loadcompd` path, ideally with a faster decompressor such as ZX0 or TSCrunch) or budget the transition for 6-9 s. An earlier version of this page costed decompression at 50 ms and claimed 0.95 s of margin. Timing varies with disk geometry and seek distance — measure on real hardware or in VICE with accurate 1541 emulation enabled.

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; it is a one-part PRG whose only hand-off is a fire-button JMP to a configured entry address, with no load between parts.)

---

## crunched_data_in_basic_stub — Compressing the BASIC stub

**Complexity:** low
**Region:** both
**Uses kernal:** (none)

### Why

Every C64 PRG file that auto-runs loads to `$0801` and begins with the standard BASIC stub: two bytes of link address, two bytes of line number, a `SYS` token, the address digits as PETSCII characters, and a pair of null bytes for end-of-line and end-of-program. The canonical form `10 SYS2061` (link, line number, `$9E`, the four PETSCII digits, EOL, end-of-program: `0B 08 0A 00 9E 32 30 36 31 00 00 00`) occupies 12 bytes; the first machine-code instruction sits at `$080D` (decimal 2061), and `$080D - $0801 = 12`. An earlier version of this page said 13 bytes, which is probably KickAssembler's default `BasicUpstart2`: it emits `10 SYS2062` with one pad byte (13 bytes to `$080D`, code at `$080E`). For a 256-byte intro, 12 bytes of stub overhead before the first instruction byte is about 4.7% of the total budget. For a 1-kilobyte intro it is 1.2%. For any production where byte count matters, eliminating or compressing this overhead is worthwhile.

The technique of placing the compressed payload immediately after the SYS and pointing the SYS target to a depacker changes the layout so that the entire PRG (from `$0801` onward) is either BASIC stub or executable code — there is no gap of dead bytes and no separate load address overhead beyond the 2-byte PRG load address prefix.

### How

The compressed-stub layout:

```
$0000-$0001  PRG load address (2 bytes: $01, $08 — loads to $0801)
$0801-$080C  BASIC stub: 10 SYS 2061 (12 bytes)
$080D-$08D5  Depacker/entry code (e.g., the b2 -c sfx form: 201 bytes, which copy
             a 183-byte decruncher to zero page $0010 before running it)
$08D6-$...   Packed payload (compressed code + data)
```

The SYS target (`2061` = `$080D`) jumps directly to the depacker. The depacker reads the packed payload beginning at the byte immediately following its last instruction, decompresses to the original target address (which could be `$0801` itself, or any other address), then JMPs to the original entry point.

For a 256-byte intro the arithmetic does not favour a general-purpose packer:

- BASIC stub: 12 bytes
- ByteBoozer 2 sfx stub (BASIC line + entry + decruncher): 213 bytes in total, measured from `b2 -c 0801` in Krill v194
- Remaining for packed payload: 256 - 2 (PRG header) - 213 = **41 bytes**

An earlier version of this page put the depacker at 85 bytes and computed 156 bytes of payload expanding to ~223 bytes of effect code; with the measured stub size that budget does not exist, which is why 256-byte intros hand-roll their own tiny depackers (or none) rather than embed ByteBoozer or Exomizer.

### Why it works

The BASIC interpreter runs the SYS statement, which calls `SYS` at `$080D`. At that point the BASIC program is "running" but control has immediately exited to machine code, and the BASIC interpreter's state is no longer used. The depacker occupies the same address space as the beginning of the machine code section and overwrites its own bytes after they have been executed — legal because the CPU fetches instructions sequentially and never revisits the already-executed depacker bytes after they are done. The packed payload bytes are non-executable until after decompression; they sit in the memory layout as inert data until the depacker reads and expands them.

An important constraint: the depacker itself must not overlap its output destination until the corresponding output byte has been written. ByteBoozer and Exomizer both guarantee this by construction (they decompress in a direction that always reads packed source bytes before they are overwritten by expanded output). Doynax LZ has the same guarantee. A custom depacker that naively decompresses forward without checking this invariant can corrupt itself.

### Variations

**Zero-page depacker.** Instead of placing the depacker at `$080D`, a very small depacker (under 30 bytes) can reside in free zero-page space (`$02-$7F` is largely free on a stock C64 with KERNAL + BASIC disabled, though care is needed around VIC-II pointer ZP variables and KERNAL workspace). This frees the `$0801-$...` area entirely for the payload. Assembling to zero page requires position-independent or zero-page-addressed code.

**Combined load + unpack stub.** A self-installing production that loads additional packed files can place the Krill resident at its default `$0200-$0407` (~520 B in the v194 prebuilt; a raw-load-only build is ~250 B), which the BASIC stub does not reach, leaving the `$0800` range available for the effect proper. The resident must be copied there only *after* `install` returns (install's KERNAL calls write the file tables at `$0259+`), and the installer itself is ~3-7 KB of transient code, so this is a two-stage boot whose first stage is a few kilobytes, not 256 bytes — an earlier version of this page put the stubs in 256 bytes at `$0200-$02FF`. See `multi_load_sequencing` for the layout.

**BASIC stub compression.** Technically the BASIC stub itself (`10 SYS 2061`) can be shortened: `0 SYS826` uses a line number of 0 and decimal address 826 = `$033A`. If the depacker can live at `$033A` (free on a stock machine with KERNAL ROM disabled), the BASIC stub shrinks from 12 to 11 bytes. Combined with the zero-page depacker variant, this squeezes 1 more byte into the payload at the cost of careful ZP + low-RAM placement (an earlier version of this page counted the saving as 2 bytes, from the 13-byte figure corrected above).

### Cycle budget

The depacker execution overhead (BASIC calls SYS, depacker runs, jumps to effect entry) is small for a tiny payload: a 200-byte payload decompresses in roughly 10,000-20,000 cycles (10-20 ms) at tens of cycles per output byte, so the SYS-plus-depack overhead is invisible to the user — the PRG loads in under a second and the effect begins immediately. For larger payloads, scale proportionally: 2 KB of packed output at tens of cycles per byte is on the order of 0.1-0.2 s, still negligible. (An earlier version of this page gave "100-300 ms for a 200-byte payload" and "85 bytes/ms ... roughly 24 ms for 2 KB", two figures that disagreed with each other by 40-100x; the 85 bytes/ms rate is 11.6 cycles per byte, below the 16-cycle cost of a bare `LDA (zp),Y` / `STA (zp),Y` / `INY` / `BNE` copy loop.)

### Recipes

- No recipe yet. (An earlier version of this page pointed at `recipes/kickassembler/cracktro-template.md`; that recipe is assembled to a plain PRG and is not packed with Exomizer, ByteBoozer or any cruncher.)

---

## runtime_relocation — Load a code overlay at a run-time address and relocate it

**Complexity:** medium
**Region:** both
**Cost:** bytes_code=43, zp_bytes=4
**Cost basis:** derived-listing

### Why

A game that outgrows 64 KB keeps per-level code on disk: a level script,
a boss routine, a cutscene. Build-time placement (`.pseudopc`) fixes the
address when you assemble. When the free block is only known at run
time, because levels load different graphics and music and a heap hands
out what is left, the code has to be moved after it is loaded. Metal
Warrior 4 loads its event scripts as 2 KB chunks of native code with a
jump table at the start, named by a 16-bit id (high byte the file, low
byte the entry point), instead of running an interpreter (Cadaver's
MW4 article; not measured here).

### How

1. Assemble the overlay twice, at two origins one page apart (the recipe
   uses `$3000` and `$3100`).
2. Diff the two images. A byte one higher in the second image is treated as the
   high byte of an address inside the overlay; record its offset. A byte
   that is equal is an opcode, a low byte, a zero-page operand, a
   constant or an address outside the overlay, and is left alone. A byte
   that moved by any other amount cannot be page-relocated: refuse the
   build.
3. Ship the first image plus the table of offsets (two bytes each for an
   overlay over 256 bytes).
4. At run time, take a block of whole pages from the heap, load the
   image there, and add `delta` = load page − origin page to each listed
   byte.
5. Enter the overlay only through a jump table at a fixed offset
   (`JMP` at offsets 0, 3, 6, …). The host knows the overlay's page and
   those offsets, nothing else.

The heap can be a bump pointer by pages (free everything at level end),
or a first-fit list of page runs if overlays come and go during play.
c64gameframework uses a bump pointer that compacts: loading a chunk ages
the others from `C_FIRSTPURGEABLE` up, purging one moves every chunk
above it down, relocates those chunks again by the new delta, and
patches return addresses on the stack that point into them (`file.s`,
`PurgeFile`, read here, not run). Because relocation is an add, a copy
that has moved can be relocated again with the same table, as long as
nothing has rewritten a listed byte.

### Why it works

Moving by whole pages changes only high bytes, and each by the same
`delta`. Low bytes, and every byte's position within its page, stay the
same. So page-aligned tables stay aligned, and no branch or indexed read
gains or loses a page-crossing cycle: the relocated copy runs in the
same cycles as the original. The diff finds the immediate `#>label` and
the high bytes of address words in data tables, which a scan of the
instruction stream does not.

### What cannot be relocated this way

- An address stored as its low byte only (`#<label` alone, a split
  low-byte table without its high half) is fine, because whole-page moves
  leave low bytes alone. A byte-granular move would break it; do not
  offer one.
- An expression that is not a plain high byte: `label / 64` (a sprite
  pointer), `label >> 4`. It moves by some other amount; the diff
  refuses it. `>label + 1` moves by exactly one and is relocated
  correctly (assembled at $3000 and $3100 with KickAssembler 5.25).
- A byte that moves by one but is not an address is relocated wrongly
  and silently. An offset measured from a fixed origin constant,
  `>(label - $3000)`, is $00 in one image and $01 in the other, so it is
  listed and gets the delta added. Measure offsets from an overlay label
  (`label - base`, where `base` is the overlay's first label); that
  expression is the same in both images.
- An operand the overlay builds at run time from its own address (self-
  modifying code that computes an address with arithmetic rather than
  `#>label`) is invisible to the diff. Build such operands from
  `#<label` and `#>label` immediates, which are relocated.
- An address the host stores that points into the overlay (an IRQ
  vector, a callback) must come from the jump table after relocation,
  not from a symbol file.
- An overlay that has rewritten one of its own listed bytes is no
  longer the image the table describes. Relocate a fresh load, or keep
  listed bytes out of self-modification if the heap compacts.

### Variations

**Instruction walker.** Cadaver's scheme assembles overlays at `$8000`,
inside the dynamic area, and needs no table: a walker steps through the
code using a 32-byte packed table of instruction lengths, adds the
delta to every 3-byte operand whose high byte falls inside the dynamic
area, and stops at a `BRK`. It forbids `BIT`-skip tricks, since they hide
an instruction inside another's operand, and it cannot see address
tables, which it replaces with run-time resource lookups (Cadaver's
relocation article; not measured here). It saves the table's disk space and
costs a walk over every instruction.

**Bitmap instead of offsets.** One bit per overlay byte costs size / 8
bytes whatever the count; an offset list costs 2 bytes per entry. The
list is smaller when fewer than one byte in 16 is relocated (arithmetic).
Dense code (one in 4.4 in the recipe) favours the bitmap; an overlay that
is mostly data favours the list.

### Cycle budget

Relocation runs once per load, outside the frame loop, so the Cost line
carries no per-frame figure. In the recipe, one relocation of a 340-byte
overlay with 19 listed bytes took 855 cycles: 20 fixed plus 44 per byte while the
offset tables do not cross a page (one more cycle per read past 213
entries),
45.0 per byte overall (measured in VICE x64sc, CIA2 timer, screen
blanked, PAL and NTSC). The overlay's 79 bytes of code carry 18 of the
19 entries, one byte in 4.4; a 2 KB chunk of such code would have about
465 entries and take about 20,500 cycles, about one PAL frame of 19,656
(arithmetic from the measured per-byte cost). The recipe's count is one
byte, so a table over 255 entries needs a 16-bit count. The
43 bytes of code are the recipe's `relocate` routine; the 4 zero-page
bytes are its pointer, the destination page and `delta`.

### Recipes

- `recipes/kickassembler/runtime-relocation.md`: assembles one overlay
  twice with `.pseudopc`, diffs the images into a table on the C64 (and
  gives the host-side Python for shipping), relocates two copies from a
  page heap and checks both through their jump tables.

### Sources

- Cadaver, relocation article: https://cadaver.github.io/rants/relocation.html
- Cadaver, Metal Warrior 4 script chunks: https://cadaver.github.io/rants/mw4trick.html
- c64gameframework (MIT), `main.s` and `file.s`: https://github.com/cadaver/c64gameframework

---

## iffl_single_file — All level files in one disk file, found by a scanned offset table

**Complexity:** medium
**Region:** both
**Uses kernal:** SETNAM, SETLFS, OPEN, CHKIN, CHRIN, CLRCHN, CLOSE, READST

### Why

A multi-load game keeps each level's graphics, map and music on disk.
One disk file per level costs a directory entry each, and the 1541
directory holds 144 (`formats/c64-file-formats.md`). Every load also
starts with a directory search by name. IFFL puts all the data files
into one disk file: one directory entry, no name search after the first,
and a loader that goes straight to file N. Cadaver notes it in some newer
cracks of multi-load games.

### How

1. **Pack** on the PC. Concatenate the files with nothing between them
   and put a table of their lengths in front. Cadaver's format fills the
   first block with it: 127 low bytes, then 127 high bytes, 254 bytes in
   all, so the data starts at the second block. That allows 127 files
   of up to 65,535 bytes each.
2. **Scan** once, at game start. Walk the file and record, for each
   subfile, where it starts: the track and sector of the block, and the
   byte offset in that block. With a 16-bit counter per file, the scan
   only has to follow the chain of track/sector links, not transfer the
   data (Cadaver). The table costs 3 bytes per subfile (track, sector,
   offset), 381 bytes for a full 127, plus the lengths (arithmetic).
3. **Load** subfile N. Read its first block, send the C64 only the bytes
   from the recorded offset on, then follow the links until the length
   runs out.

The scan and the mid-file start are custom drive code. The 1541 DOS
opens a file only at its start, and the C64 KERNAL has no seek on a
sequential channel. So:

| Part | Needs drive code | KERNAL-only form |
|---|---|---|
| Pack the file | no (PC side) | the same file |
| Scan | yes, to record track/sector/offset | read the length table and add it up to byte offsets |
| Start mid-file | yes | open the file and read and discard every byte before subfile N |
| Transfer speed | a fast-loader protocol | serial bus at KERNAL speed |

The KERNAL-only form keeps the one directory entry and works on any
drive, including ones that run no custom code. It loses the seek: every
skipped byte crosses the bus like a kept one.

### Why it works

A disk file is a chain of 256-byte blocks, each starting with the track
and sector of the next and carrying 254 data bytes. Once the scan has
turned "subfile N" into "this block, this byte", a drive-side loader
can read that block directly, as the DOS does for any block, without
the directory or the earlier blocks. A byte offset in the file maps to
block `offset / 254`, data byte `offset % 254` of the chain
(arithmetic); the recipe prints these pairs.

### Variations

**KERNAL skip loader.** The fallback when the fast loader cannot
install (an SD2IEC, a drive that is not 1541-compatible). Measured in
`recipes/oscar64/iffl-kernal-skip.md`: the time to load subfile N rises
by about 2,526 cycles on PAL (2,621 on NTSC) for every byte before its
end, plus about 0.44 million cycles of `OPEN` and `CLOSE` per load. At
that rate the last subfile of a file filling a whole disk, 168,656
bytes, is about 7 minutes away (arithmetic). Keep the KERNAL form to
small files, or put the most-loaded subfiles first.

**Lengths up front.** If the loader can start at a byte offset, the
lengths give each subfile's byte offset by arithmetic. A drive-side
loader still has to walk the chain, because the DOS writes a file's
blocks with an interleave (`formats/c64-file-formats.md`), so the
position of block K cannot be worked out from the first block.

**IFFL with a fast loader.** `krill_loader_integration` and
`sparkle_irq_loader` load by name or by an index into their own file
table; neither page here documents an IFFL mode, so check the loader's
own docs before assuming one. Level sequencing on top of either is
`multi_load_sequencing`.

### Cycle budget

The scan and the loads run between levels, outside the frame loop, so
there is no Cost line. In the KERNAL recipe (VICE x64sc, CIA2 timer,
five subfiles, 1,615 bytes): the scan, one `OPEN` and 11 bytes, took
475,342 cycles on PAL with the drive already running and 1,824,005 on
first access to a packer-built disk (spin-up included); the loads took
974,300 cycles (subfile 1, 211 bytes read) to 4,521,555 cycles (subfile
5, 1,615 bytes read) over all runs. The
cost of the drive-code scan and seek was not measured here.

### Recipes

- `recipes/oscar64/iffl-kernal-skip.md` — packs five subfiles behind a
  length table (Python packer, and the same bytes written on the C64
  when the disk is empty), scans the table, loads subfiles 3, 1, 2, 4
  and 5 by skipping with KERNAL `CHRIN`, and checks and times each.
  No recipe yet for the drive-code scan and seek.

### Sources

- Cadaver, "IFFL system": https://cadaver.github.io/rants/iffl.html

---
