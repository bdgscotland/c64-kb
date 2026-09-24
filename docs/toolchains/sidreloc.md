---
tool: sidreloc
tool_kind: asset-converter
maintainer: Linus Akesson (lft)
license: MIT
home_url: https://www.linusakesson.net/software/sidreloc/index.php
version_verified: "1.0"
---

<!-- doc-type: toolchain-reference -->

# sidreloc: move a SID tune to where the game has room

## Tool

sidreloc moves a PSID tune by whole pages and can move its zero-page
variables to a given range. Most tunes are linked to run at `$1000`,
which is often where a game's code or map wants to be. sidreloc rewrites
the tune so it runs somewhere else, then checks the result by playing the
original and the moved tune side by side.

It does not disassemble. It emulates the 6510 running the tune's init and
play routines, and every byte in its emulated memory carries the list of
program bytes that contributed to its value. When an effective address
lands inside the relocation range, one of those program bytes must be an
address high byte. `cmp` and `eor` add equations too. A constraint solver
then decides which bytes to shift. The page moves are whole pages, so only
high bytes change. Source: lft's page, linked below.

Everything on this page marked "run here" was done on 2026-09-23 with
sidreloc 1.0 (banner `sidreloc 1.0 by Linus Akesson`) built with Apple clang
21.0.0 on macOS arm64. The official tarball could not be downloaded on this
machine (the local network filter blocks `hd0.linusakesson.net`), so the
build used the sources in the unofficial mirror
https://github.com/theclue/sidreloc at commit `2de6b01`, the commit before
that mirror patched `sidreloc.c` for autotools:

```text
cc -O2 -DHAVE_ERR_H -o sidreloc sidreloc.c cpu.c solver.c -lm
```

The mirror's `HEAD` does not compile with clang 21: its added `errx`
fallback passes `...` as an argument (`error: expected expression`).

**Targets:** SID, 6510

## Build pipeline

### .SID — PSID/RSID music file
**Produced by:** sidreloc
**Consumed by:** sidreloc

Input and output are both PSID files. sidreloc refuses RSID tunes that break
RSID rules, MUS files, BASIC tunes and tunes with no play routine (exit
codes below). A game then strips `dataOffset` bytes (124, `$7C`, for PSID v2), plus 2 more
when the header's load address is 0: then the first two data bytes are the
load address. sidreloc's own output is written that way (load field `0000`,
124 + 2 + data bytes). Or it imports the file with an offset; the byte
layout is in [c64-file-formats](../formats/c64-file-formats.md), ".SID".

## Command line

```text
sidreloc [OPTIONS] input.sid output.sid
```

| Flag | Default | Meaning |
|---|---|---|
| `-p XX` | `10` | First page (hex) of the relocated tune |
| `-z XX-YY` | `80-ff` | Free zero-page range; used addresses are packed from its start |
| `-k` | off | Keep the tune's zero-page addresses |
| `-r XX-YY` | from the file | Pages to relocate; must cover the whole load range |
| `-t N` | `2` | Tolerance, in percent, for wrong pitches during verification |
| `-s` | off | Also verify pulse widths |
| `-f` | off | Write the output even if verification fails |
| `-v` | off | Print statistics and a map of every program byte |
| `-q` | off | Silence warnings about writes outside the load range |
| `--frames N` | `100000` | Play calls per subtune (about 33 minutes of PAL) |

The flag table is from `sidreloc -h` run here; the meanings are from the
manual page (`sidreloc.txt` on lft's site).

**Give `-r` for a small tune.** With no `-r`, sidreloc 1.0 takes the load
range and extends it by up to 64 pages, stopping at `$CFFF` or `$FFFF`
(`sidreloc.c`, where `reloc_end` is set). For the 196-byte test tune below
that range was `$1000-$50FF`. Asked to move it to page `$C0`, sidreloc
refused with exit 12, "Neither the source nor the destination relocation
range may overlap with the zero-page.", because `$C000` plus 65 pages wraps
past `$FFFF`. With `-r 10-10` the same move succeeded. Run here.

### Exit status

From the manual page. 8 and 12 were seen here; the rest were not provoked.

| Code | Meaning |
|---|---|
| 0 | Relocation successful |
| 1 to 5 | Bad header, bad RSID, MUS, BASIC tune, unsupported PSID extension |
| 6, 7 | Bad parameters, I/O error |
| 8 | No solution found |
| 9 | Zero page full |
| 10 | Verification failed |
| 11 | Could not find the play routine |
| 12 | Invalid relocation range |
| 13 | Clock-cycle limit exhausted |
| +32 | Success, but the tune writes outside its load range and the SID |
| +64 | Success, but some pitches or pulse widths differ |

## A run, measured

The subject was a 196-byte tune written for this test in KickAssembler 5.25
(not committed): load, init and play at `$1000`/`$1000`/`$1003`, a split
pattern-pointer table (low bytes in one table, high bytes in another), a
pattern pointer in `$FB/$FC` read with `lda ($FB),y`, and a 24-note
frequency table. A small Python script added the PSID v2 header.

```text
sidreloc -v -r 10-10 -p c0 -z 20-2f tune.sid tune-c000.sid
```

sidreloc printed: 22 high-byte relocations (`R`), 3 zero-page relocations
(`Z`), 108 static bytes, 35 undetermined, 28 unused; zero page `fb fc`
became `20 21`; bad pitches 0, bad pulse widths 0; "Relocation
successful."; exit 0. `sidreloc -p 80 tune.sid tune-8000.sid` (default range)
also exited 0. Run here.

"Undetermined" bytes are ones no equation mentions; sidreloc leaves them
alone. In this tune, read against the assembler's symbol file, they were
the three runtime variables, the pattern bytes, part of the frequency
tables and a few code bytes. The unused bytes were frequency-table
entries no pattern plays.

## Checking a relocated tune yourself

sidreloc's own check emulates the original and the relocated tune and
compares SID registers after each play call. Pitches pass within `-t`
percent, and pulse widths are not compared unless `-s` is given. Its author
notes that pulse width is often an integrator, so one wrong delta makes every
later value differ even when the tune sounds the same.

An independent check: run both files in a separate 6502 emulator and
compare every write to `$D400-$D418`, play call by play call. The script
below uses py65 1.2.0 (`pip install py65`, an NMOS 6502 without the
undocumented opcodes). sidreloc's emulator lacks them too (see "What
defeats it"), so a tune that uses them fails there first. It calls init with
A = 0, then play N times, and returns to a `NOP` at `$0300` through a pushed
return address.

```python
import struct, sys
from py65.devices.mpu6502 import MPU
from py65.memory import ObservableMemory

def run(path, frames):
    d = open(path, 'rb').read()
    off = struct.unpack('>H', d[6:8])[0]
    load, init, play = struct.unpack('>HHH', d[8:14])
    data = d[off:]
    if load == 0:
        load, data = data[0] | data[1] << 8, data[2:]
    mem, log = ObservableMemory(), []
    mem.subscribe_to_write(range(0xD400, 0xD419), lambda a, v: log.append((a, v)))
    cpu = MPU(memory=mem)
    for i, b in enumerate(data):
        mem[load + i] = b
    trap = 0x0300
    mem[trap] = 0xEA
    def call(addr):
        mem[0x1FF], mem[0x1FE] = (trap - 1) >> 8, (trap - 1) & 0xFF
        cpu.sp, cpu.pc, cpu.a = 0xFD, addr, 0
        for _ in range(200000):
            if cpu.pc == trap:
                return
            cpu.step()
        raise SystemExit('routine did not return')
    out = []
    for addr in [init] + [play] * frames:
        log.clear(); call(addr); out.append(list(log))
    return out

a, b = run(sys.argv[1], 3000), run(sys.argv[2], 3000)
print('calls that differ:', sum(x != y for x, y in zip(a, b)))
```

On the test tune, original against `tune-c000.sid` and against
`tune-8000.sid`: 2,003 SID writes each over init plus 3,000 play calls, and
0 calls that differ. A control that copied the unchanged bytes to `$C000`
did not return from init within 200,000 instructions, because its `jmp`
operands still pointed at `$10xx`. Run here.

After the check, play the moved tune in the game itself. Neither check
sees the game's own use of the `-z` zero-page range, or of any RAM the tune
writes outside its load range.

## What defeats it

| Case | What happens | Evidence |
|---|---|---|
| A pointer high byte passes through `and`, `ora`, `eor`, `asl`, `lsr`, `rol` or `ror` | Those clear the list of program bytes that contributed to the value. Binary-mode `adc` merges the operand's list in; `sbc`, `inc`/`dec`, `inx`/`dex`/`iny`/`dey` and `tax`/`txa`/`tay`/`tya` keep it (`cpu.c`, source read). With the list gone the solver finds no consistent answer. Exit 8, "Inconsistency: Want to relocate one of {} but this would contradict other equations." `-f` does not help: no file is written | Run here: the test tune with `ora #0` after `lda pat_hi,x` |
| Undocumented (illegal) opcodes | Emulation stops: `Illegal opcode: $xx (PC = $xxxx)`, error `ERR_ILLEGAL` | `cpu.c`, source read; not provoked here |
| Compressed or packed code | Addresses come out of a bit stream, not from program bytes, so no byte can be shifted to fix them | lft's page, not provoked here |
| Subtracting two addresses to get a size | sidreloc assumes `sbc` never produces an address difference | lft's page. A test here that wrote `#>far - #>pat_lo` to `$D403` relocated correctly and matched in py65, so this form alone did not trigger it; which forms do was not established |
| Tunes that never return from init | Not supported (exit 11) | Manual page |
| Memory outside the load range | Relocated fine, but the tune still touches that memory; sidreloc warns. Fix by moving in two steps: first `-r` over the code with `-p` next to the data, then `-r` over both | lft's page, not provoked here |
| A pitch table read past its end picks up an address high byte | Pitch changes after relocation; reported as bad pitches but still accepted within `-t` | lft's page |

lft reports sidreloc relocating 91% of HVSC #56 with default settings. That
figure is his, not measured here.

## Not measured here

- Any HVSC tune: none was downloaded or run.
- Digi tunes that use NMI (`--nmi-calls`).
- Whether the official 1.0 tarball matches the mirror's `2de6b01` sources
  byte for byte. At `2de6b01` the mirror already has an `#ifdef HAVE_ERR_H`
  guard in `sidreloc.c` and `solver.c`, hence `-DHAVE_ERR_H` above. The
  mirror's README says no source changes were made; the AUR package records the tarball's MD5 as `987cac9c5c5e210eee897f4689aea002`.

## Sources

- lft, "Sidreloc": https://www.linusakesson.net/software/sidreloc/index.php
  (algorithm, limitations, the 91% figure)
- Manual page: https://www.linusakesson.net/software/sidreloc/sidreloc.txt
  (flags, exit codes)
- Unofficial source mirror: https://github.com/theclue/sidreloc
- AUR package record: https://github.com/aur-archive/sidreloc
- py65: https://github.com/mnaberez/py65

## See also

- [music-production-reference](../music/music-production-reference.md), tracker output
- [asset-pipelines](../art/asset-pipelines.md), "Music: GoatTracker (.sng) → usable output": a
  GoatTracker song is relocated by `gt2reloc` at export; sidreloc is for tunes you only
  have as a `.sid`
- [music-sid](../techniques/music-sid.md), the init/play calling convention
- [memory-layout-planning](memory-layout-planning.md), choosing the page to pass to `-p`
