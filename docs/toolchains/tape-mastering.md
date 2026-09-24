---
tool: tape-mastering
tool_kind: reference-catalog
maintainer: bdgscotland
license: BSD-3-Clause
home_url: https://github.com/bdgscotland/c64-kb
---

<!-- doc-type: toolchain-reference -->

# Mastering a tape image and proving it loads

## Tool

This page is a procedure, not a program. It turns a PRG that one of the
toolchains built into a TAP image a user can attach as a
cassette and start with `LOAD` and `RUN`, then proves the image loads by
running it in headless VICE and looking at the screen. Two routes are
shown: the KERNAL's own format, which any C64 reads with no software of
its own, and a turbo block placed behind a small KERNAL-format loader,
which is how commercial tapes loaded faster. Every command and every
figure here was run on this machine with the windowless x64sc build of
VICE 3.10 (`-warp`, PAL unless the line says NTSC) on two payloads: a
202-byte KickAssembler test program that sets the border green and
prints one line, and the 1,183-byte loader from
[kickassembler/tape-turbo-loader](../recipes/kickassembler/tape-turbo-loader.md).
The pulse lengths and the block layout come from the "KERNAL bit
encoding" subsection of [c64-file-formats](../formats/c64-file-formats.md),
which measured them on a TAP the KERNAL itself recorded; the writer here
was checked against that recording with the same decoder. No third-party
mastering tool was used: a search for a licence-clear `prg2tap` source
could not be run inside this session's budget, none is installed on this
machine, and the writers below are short enough to keep on this page.

**Targets:** 6510

## What a LOAD from tape needs

The KERNAL's tape reader wants, in this order, and it wants each of the
two blocks twice:

1. **A leader of short pulses.** The reader locks its timing to them. The
   KERNAL writes about ten seconds of leader before the first block on a
   tape and about two seconds before every later block; the writer below
   uses the same counts, 27,136 and 5,376 shorts. Shorter leaders were
   not tried here.
2. **A header block of 192 bytes.** Byte 0 is the file type: `$01` for a
   relocatable program, which a plain `LOAD` puts at the start of BASIC
   and `LOAD"",1,1` puts at the header's address, and `$03` for one that
   always goes to the header's address. Only the plain `LOAD` of a type
   1 file was run here; the other two paths are not measured here. A
   PRG with a BASIC stub at `$0801` wants type 1. Bytes 1 and 2 are
   the start address and bytes 3 and 4 the end address, low byte first,
   the end exclusive. Bytes 5 to 20 are the file name in PETSCII, padded
   with `$20` to sixteen characters; the rest of the block is `$20`
   here. The name is what `FOUND` prints and what `LOAD"NAME"` matches;
   a plain `LOAD` takes the first header it finds.
3. **A data block** of end minus start bytes, the PRG with its two
   load-address bytes stripped.
4. **Two copies of each block.** Each copy opens with a nine-byte
   countdown, `$89` down to `$81` for the first and `$09` down to `$01`
   for the second, and closes with a one-byte XOR checksum of its data
   and the end-of-block marker. The two copies are separated by a short
   gap of leader pulses.

Every byte is twenty pulses: a byte marker, eight data bits least
significant first, and an odd parity bit, each bit a pair of pulses.
Those rules are the formats page's measurement and are restated in the
pitfall
[tape_bit_is_a_pulse_pair_not_a_pulse](../pitfalls/loader.md); this page
uses the figures without repeating them.

## The KERNAL-format writer

Save this beside the PRG as `kernal_tap.py`. It is not a listing the
gate builds; it is the mastering step.

```text
#!/usr/bin/env python3
"""Write a TAP v1 file that a plain LOAD from tape reads: a PRG in the
KERNAL's own pulse-pair format, header block and data block, each
written twice with the countdowns.

usage: kernal_tap.py in.prg out.tap [NAME] [--type 3] [--leader N] [--append other.tap]

--append copies the pulses of another TAP after the data block, so a
turbo block can follow a loader written in the KERNAL format.
"""
import struct
import sys

SHORT, MEDIUM, LONG = 0x2F, 0x43, 0x58   # TAP units of 8 cycles: 376, 536, 704 cycles
LEADER_HEADER = 27136    # short pulses before the header block, about 10 s
LEADER_DATA = 5376       # short pulses before the data block, about 2 s
GAP = 79                 # short pulses between the two copies of a block
TRAILER = 78             # short pulses after the second copy
SILENCE = 327680         # cycles of silence between header and data block
NAME_LEN = 16
HEADER_LEN = 192


def bit_pair(bit):
    return (MEDIUM, SHORT) if bit else (SHORT, MEDIUM)


def byte_pulses(value):
    out = [LONG, MEDIUM]                       # byte marker
    ones = 0
    for k in range(8):
        bit = (value >> k) & 1                 # least significant bit first
        ones += bit
        out += bit_pair(bit)
    out += bit_pair(1 - (ones & 1))            # odd parity over nine bits
    return out


def block_pulses(data, leader):
    """One block: leader, then two copies, each countdown + data + checksum
    + end-of-block marker, separated by a short gap."""
    check = 0
    for b in data:
        check ^= b
    out = [SHORT] * leader
    for first_copy in (True, False):
        base = 0x80 if first_copy else 0x00
        for n in range(9, 0, -1):
            out += byte_pulses(base + n)
        for b in data:
            out += byte_pulses(b)
        out += byte_pulses(check)
        out += [LONG, SHORT]                   # end-of-block marker
        out += [SHORT] * (GAP if first_copy else TRAILER)
    return out


def silence(cycles):
    return [0, cycles & 0xFF, (cycles >> 8) & 0xFF, (cycles >> 16) & 0xFF]


def make_tap(prg, name, file_type=1, leader=LEADER_HEADER):
    start = prg[0] | (prg[1] << 8)
    body = prg[2:]
    end = start + len(body)                    # exclusive
    padded = name.upper().encode("ascii")[:NAME_LEN].ljust(NAME_LEN, b" ")
    header = bytes([file_type, start & 0xFF, start >> 8, end & 0xFF, end >> 8])
    header += padded
    header += b" " * (HEADER_LEN - len(header))
    first = block_pulses(header, leader)
    second = block_pulses(body, LEADER_DATA)
    cycles = sum(p * 8 for p in first + second) + SILENCE
    return first + silence(SILENCE) + second, cycles


def tap_bytes(pulses):
    body = bytes(pulses)
    return b"C64-TAPE-RAW" + bytes([1, 0, 0, 0]) + struct.pack("<I", len(body)) + body


def main(argv):
    src, dst = argv[1], argv[2]
    name = argv[3] if len(argv) > 3 and not argv[3].startswith("--") else "PROGRAM"
    file_type = 1
    leader = LEADER_HEADER
    if "--type" in argv:
        file_type = int(argv[argv.index("--type") + 1])
    if "--leader" in argv:
        leader = int(argv[argv.index("--leader") + 1])
    prg = open(src, "rb").read()
    pulses, cycles = make_tap(prg, name, file_type, leader)
    if "--append" in argv:
        tail = open(argv[argv.index("--append") + 1], "rb").read()
        assert tail[:12] == b"C64-TAPE-RAW" and tail[12] in (0, 1)
        pulses += list(tail[20:20 + struct.unpack("<I", tail[16:20])[0]])
    out = tap_bytes(pulses)
    open(dst, "wb").write(out)
    print(f"wrote {dst}: {len(prg) - 2} payload bytes, {len(out)} TAP bytes, "
          f"{cycles} cycles of tape ({cycles / 985248:.2f} s PAL)")


if __name__ == "__main__":
    main(sys.argv)
```

Three choices in the writer. The pulse values `$2F`, `$43`
and `$58` are the most common bytes in the KERNAL's own recording, so a
reader that copes with the KERNAL's tapes copes with these. The
0.33 s silence between the two blocks is a 24-bit TAP v1 entry, the
form VICE itself recorded at that point. The file name goes in as
upper-case ASCII, which is unshifted PETSCII and shows as capitals in
the C64's default font; the same shift trap that
[release-disk](release-disk.md) records for `c1541` applies to any name
typed in lower case in a shell, and this script upper-cases the name.

On the test program:

```text
python3 kernal_tap.py hello.prg hello.tap HELLO
wrote hello.tap: 202 payload bytes, 49418 TAP bytes, 20497520 cycles of tape (20.80 s PAL)
```

A 202-byte program is 49,418 bytes of TAP. The ratio is fixed by the
format: every payload byte is twenty pulses in each of two copies, and
the leaders are constant. For a 1,183-byte payload the same command
printed `88658 TAP bytes` and `39.62 s`.

## Proving it loads in VICE

The run does not autostart the PRG; that would prove the program and
say nothing about the tape. It attaches the TAP, presses PLAY from the
monitor command file, and types `LOAD` and `RUN` into the keyboard
buffer:

```bash
printf 'tapectrl 1\n' > play.mon
x64sc -default -warp +sound +autostart-delay-random \
  -limitcycles 40000000 +dsresetwithcpu \
  -dstapewobbleamp 0 -dstapewobblefreq 0 -dsspeedtuning 0 -dstapeerror 0 \
  -1 hello.tap -moncommands play.mon -keybuf 'load\nrun\n' \
  -exitscreenshot hello-pal.png
```

Add `-model ntsc` for the NTSC run. `-1` attaches the TAP, `tapectrl 1`
presses PLAY at power-on, and `+dsresetwithcpu` keeps that press through
the reset; without it the KERNAL prints `PRESS PLAY ON TAPE` and waits.
The four `-ds` options switch off VICE's tape speed error and wobble so
that two runs give identical bytes (see Limits). Because PLAY is
already down, the KERNAL skips its prompt, prints `SEARCHING`, blanks
the screen while the tape runs, shows `FOUND HELLO` with the screen
back on, pauses, blanks again for `LOADING`, and returns to BASIC,
where the buffered `RUN` starts the program. The exit screenshot is the
program's own output on a green border, `TAPE MASTER OK  JIFFIES 770`,
followed by `READY.`; the pictures are
`../figures/tape-kernal-master-pal.png` and
`../figures/tape-kernal-master-ntsc.png`, each byte-identical on two
runs, every character cell decoded against the character ROM.

**Timing was measured by bisecting `-limitcycles`**, not from the
jiffy clock. The program stores `$A0`-`$A2` as its first act, and both
models printed `770` for a load that took over thirty seconds of
machine time: the KERNAL's tape interrupt does not advance the jiffy
clock, so `TI` measures only the boot and the pause at `FOUND`. Each
row below is the smallest cycle count, to within 50,000, at which the
exit screenshot showed the stage, found by nine or ten runs per row:

| Stage (PAL, 202-byte payload) | Cycles from power-on | Frames (19,656 cycles) |
|------|------|------|
| `LOAD` typed, screen blanks, tape starts | 2,160,000 to 2,200,000 | 110 |
| `FOUND HELLO` on screen (both header copies read) | 16,150,000 to 16,200,000 | 822 |
| Screen blanks again (`FOUND` pause over) | 28,650,000 to 28,690,000 | 1,458 |
| Program running, border green | 35,000,000 to 35,040,000 | 1,782 |

From `LOAD` to the program's first instruction is 32.80 to 32.88
million cycles, 1,669 to 1,673 PAL frames, 33.3 s. (An earlier version
gave a single 1,671 frames, the midpoint of that bracket.) The tape itself holds 20.5 million cycles of
pulses; the other 12.5 million, 12.7 s, is the KERNAL's pause at
`FOUND`, during which the motor is stopped. The rule that ends that
pause is read from the ROM bytes under `FAH` on
`../hardware/kernal-routines-reference.md`: a jiffy-clock target or a
key down in the RUN/STOP key's keyboard row. A key press was not tested
in this run. (An earlier version called the key rule common knowledge.)
On
NTSC the same image reached the green border between 35,470,000 and
35,510,000 cycles, 2,076 NTSC frames of 17,095 cycles, 34.7 s: the TAP
stores cycles, so the tape costs the same count on either model and the
faster clock finishes sooner in wall time.

**Cost per byte.** A second image with the payload padded to 500 bytes
reached the green border between 40,630,000 and 40,670,000 cycles PAL.
The 298 extra bytes cost 5.63 million cycles, 18,890 per byte, which is
two copies of the 9,448 cycles a byte's twenty pulses sum to at the
writer's pulse values (704 + 536 for the marker, 912 for each of nine
bit pairs). A KERNAL-format program therefore loads at about 52 bytes
per second once the leaders and the pause are paid.

## The turbo route: a KERNAL-format stub in front of a turbo block

A turbo tape is a KERNAL-format program that is itself a loader,
followed on the same tape by a block in the loader's own encoding. The
user types `LOAD` and `RUN` as before; the KERNAL loads the stub, the
stub turns the motor back on and reads the fast block. The loader from
[kickassembler/tape-turbo-loader](../recipes/kickassembler/tape-turbo-loader.md)
serves unchanged: it waits for PLAY, drives the motor through bit 5 of
`$01`, and reads a one-pulse-per-bit block whose TAP its own
`make_tap.py` writes. Master the pair with `--append`:

```text
java -jar $KICKASS_JAR tape-turbo-loader.asm -o turbo.prg
python3 make_tap.py turbo.tap
python3 kernal_tap.py turbo.prg turbo-master.tap TURBO --append turbo.tap
wrote turbo-master.tap: 1183 payload bytes, 107690 TAP bytes, 39034496 cycles of tape (39.62 s PAL)
```

The cycle figure is the KERNAL part only; the appended 19,032 turbo
pulses add 7.68 million. Run it with the command above, `-1
turbo-master.tap` and `-limitcycles 80000000`. The exit screenshot is
the recipe's own report on a green border:

```
TAPE TURBO LOADER
LEADIN 11995 LEN 500 CHK 40/40
CYCLES 1540487 B/S 321 PAL
BIT0 248-264 BIT1 506-520
OK
```

The pictures are `../figures/tape-turbo-master-pal.png` and
`../figures/tape-turbo-master-ntsc.png` (NTSC reads `CYCLES 1540493
B/S 334 NTSC`), byte-identical on two runs each. `LEADIN 11995` shows
the motor timing: the KERNAL stops the motor within a handful of
pulses of the end of its second copy, and the stub restarts it, so the
loader saw 11,995 of the 12,000 lead-in pulses the recipe writes for a
tape that runs from power-on. Behind a stub the lead-in can be short.
With `LEADIN = 1000` in `make_tap.py` the same run printed `LEADIN
995`, the same cycle count and `OK`; the recipe's `LEADIN_MIN` of 64 is
the floor, and 1,000 leaves a margin of 0.5 s of tape.

**Whole-image time.** The green border appeared between 61,480,000 and
61,520,000 cycles PAL (3,129 frames, 62.4 s from power-on) and between
61,990,000 and 62,030,000 on NTSC (3,627 NTSC frames, 60.6 s). That is
the stub's 39.0 million cycles of KERNAL-format tape, the boot, the
`FOUND` pause, and 7.68 million for the turbo lead-in and block.

**Time saved for the same payload size.** The turbo block carries 500
bytes in 1,540,487 cycles, measured by the loader's own CIA 2 stopwatch,
1.56 s, about 3,081 cycles per byte (an earlier version said 3,060;
1,540,487 / 500 = 3,081). The same 500 bytes as a KERNAL data
block are 11.72 million cycles by the writer's arithmetic (two copies of
510 bytes at 9,448, the 5,376-short leader, the gaps and markers), and
the per-byte cost above confirms the arithmetic to within three cycles a
byte. The block loads 7.6 times faster and saves 10.3 s per 500 bytes
(10.18 million cycles at 985,248 Hz; an earlier version said 10.2 s);
with a 1,000-pulse lead-in in front of it the whole turbo section is
2.05 million cycles against 11.72 million, 5.7 times faster. Against
that, the stub costs what any KERNAL-format program costs: this one,
1,183 bytes of loader with its statistics printing, is 22.4 million
cycles of tape, and by the same arithmetic the turbo route pays back
once the payload passes about 1,400 bytes. A production loader is a few
hundred bytes and pays back sooner; none was written here.

### .TAP — Tape image carrying a KERNAL-format program

**Produced by:** tape-mastering
**Consumed by:** vice

The container is on [c64-file-formats](../formats/c64-file-formats.md)
under ".TAP"; this page adds only the block order, the two copies and
the stub-then-turbo layout.

## Checks a mastering step should run

Decode the image back before anyone loads it. This reader classifies
each pulse by the thresholds the formats page found, walks the pulse
pairs into bytes, checks parity, the countdowns and the XOR, compares
the data block with the PRG, and reports what follows the last KERNAL
block, which is where a turbo block sits. Save it as `tapcheck.py`:

```text
#!/usr/bin/env python3
"""Decode the KERNAL-format blocks in a TAP and check them against a PRG.

usage: tapcheck.py file.tap [file.prg]

Prints the pulse histogram by class, every block found (countdown copy,
byte count, checksum, parity failures), the header fields, and whether
the data block equals the PRG. Pulses after the last KERNAL block are
reported as a tail, which is where a turbo block sits.
"""
import sys


def read_tap(path):
    d = open(path, "rb").read()
    assert d[:12] == b"C64-TAPE-RAW", "not a TAP"
    version = d[12]
    n = int.from_bytes(d[16:20], "little")
    body = d[20:20 + n]
    pulses = []                       # cycles per pulse; a pause is one long entry
    i = 0
    while i < len(body):
        b = body[i]
        if b == 0:
            if version == 0:
                pulses.append(256 * 8)
                i += 1
            else:
                pulses.append(int.from_bytes(body[i + 1:i + 4], "little"))
                i += 4
        else:
            pulses.append(b * 8)
            i += 1
    return version, n, pulses


def classify(cycles):
    if cycles < 0x3A * 8:
        return "S"
    if cycles < 0x4C * 8:
        return "M"
    if cycles < 0x80 * 8:
        return "L"
    return "Z"                        # pause or a pulse no KERNAL routine wrote


def decode_block(sym, pos):
    """Decode bytes from a byte marker at pos until the end-of-block marker.
    Returns (bytes, parity_failures, end_pos, clean_end)."""
    out, bad = [], 0
    while pos + 1 < len(sym):
        if sym[pos:pos + 2] == "LS":
            return bytes(out), bad, pos + 2, True
        if sym[pos:pos + 2] != "LM":
            return bytes(out), bad, pos, False
        pos += 2
        bits = []
        for _ in range(9):
            pair = sym[pos:pos + 2]
            pos += 2
            if pair == "SM":
                bits.append(0)
            elif pair == "MS":
                bits.append(1)
            else:
                return bytes(out), bad, pos, False
        value = sum(bit << k for k, bit in enumerate(bits[:8]))
        if sum(bits) % 2 == 0:
            bad += 1
        out.append(value)
    return bytes(out), bad, pos, False


def main(argv):
    version, n, pulses = read_tap(argv[1])
    prg = open(argv[2], "rb").read() if len(argv) > 2 else None
    sym = "".join(classify(c) for c in pulses)
    total = sum(pulses)
    print(f"{argv[1]}: TAP v{version}, {n} data bytes, {len(pulses)} entries, "
          f"{total} cycles ({total / 985248:.2f} s PAL), "
          f"{len(pulses) * 985248 / total:.0f} pulses/s")
    for k in "SMLZ":
        print(f"  {k}: {sym.count(k)}")
    blocks = []
    pos = last_end = 0
    while True:
        pos = sym.find("LM", pos)
        if pos < 0:
            break
        data, bad, end, clean = decode_block(sym, pos)
        if len(data) < 10 or not clean:
            pos += 1
            continue
        countdown, payload, check = data[:9], data[9:-1], data[-1]
        copy = "first" if countdown[0] == 0x89 else "second" if countdown[0] == 0x09 else "?"
        xor = 0
        for b in payload:
            xor ^= b
        print(f"  block at entry {pos}: {copy} copy, {len(payload)} bytes, "
              f"checksum ${check:02X} {'ok' if xor == check else 'BAD'}, "
              f"parity failures {bad}")
        blocks.append((copy, payload))
        pos = last_end = end
    tail = len(sym) - last_end
    firsts = [p for c, p in blocks if c == "first"]
    if len(firsts) >= 1 and len(firsts[0]) == 192:
        h = firsts[0]
        start = h[1] | (h[2] << 8)
        end = h[3] | (h[4] << 8)
        name = h[5:21].decode("ascii", "replace")
        print(f"  header: type {h[0]}, ${start:04X}-${end:04X} exclusive, name '{name}'")
        if len(firsts) >= 2:
            body = firsts[1]
            print(f"  data block: {len(body)} bytes, "
                  f"{'length matches header' if len(body) == end - start else 'LENGTH MISMATCH'}")
            if prg is not None:
                same = prg[:2] == bytes([start & 0xFF, start >> 8]) and prg[2:] == body
                print(f"  against {argv[2]}: {'identical' if same else 'DIFFERENT'}")
    seconds = [p for c, p in blocks if c == "second"]
    if len(firsts) == len(seconds) and all(a == b for a, b in zip(firsts, seconds)):
        print("  both copies of every block agree")
    print(f"  tail after the last KERNAL block: {tail} entries")


if __name__ == "__main__":
    main(sys.argv)
```

On the two images above it printed, in part:

```text
hello.tap: TAP v1, 49398 data bytes, 49395 entries, 20497520 cycles (20.80 s PAL), 2374 pulses/s
  block at entry 27136: first copy, 192 bytes, checksum $89 ok, parity failures 0
  block at entry 31257: second copy, 192 bytes, checksum $89 ok, parity failures 0
  block at entry 40754: first copy, 202 bytes, checksum $23 ok, parity failures 0
  block at entry 45075: second copy, 202 bytes, checksum $23 ok, parity failures 0
  header: type 1, $0801-$08CB exclusive, name 'HELLO           '
  data block: 202 bytes, length matches header
  against hello.prg: identical
  both copies of every block agree
  tail after the last KERNAL block: 78 entries

turbo-master.tap: TAP v1, 107670 data bytes, 107667 entries, 48258176 cycles (48.98 s PAL), 2198 pulses/s
  header: type 1, $0801-$0CA0 exclusive, name 'TURBO           '
  against turbo.prg: identical
  tail after the last KERNAL block: 19110 entries
```

The same reader, run on the TAP that VICE recorded from the KERNAL's
own `SAVE` for the formats page, found the header block with checksum
`$59`, a 12-byte data block with checksum `$E6`, `type 1,
$0801-$080D exclusive, name 'T'`, both copies agreeing and no parity
failure. A writer and a reader that both agree with the KERNAL's tape
is the check this page rests on; a reader that only agrees with its own
writer proves nothing.

What to look at in the output:

- **`against x.prg: identical`** and **`length matches header`**. A
  mismatch between header and data lengths is the commonest way to make
  a tape that `FOUND`s and then fails.
- **Zero parity failures and every checksum `ok`** in all four blocks.
- **Pulses per second.** A KERNAL-format stream cannot exceed 2,620,
  which is a tape of nothing but short pulses; the images here read
  2,374 and, with the turbo tail included, 2,198. A figure above 2,700
  means a pulse the KERNAL never writes, and a figure far below means a
  long pause or a leader of something other than shorts.
- **The tail.** For a plain image it is the 78-pulse trailer. For a
  turbo image it is the trailer plus the turbo block, 19,110 here; if
  it is only 78 the `--append` was left off.
- **The file's MD5**, recorded before anyone loads it: `hello.tap`
  is `4984f15a118db310f84ddaa0f95eb658` and `turbo-master.tap` is
  `610745f60cb5c925378dc1ec97d574d8`; both writers are deterministic.

## Limits

- **VICE models a speed error and a wobble, and this page turned them
  off.** With the four `-ds` options at their defaults the turbo recipe
  measured its pulses spreading from 16 cycles to 52 on either bit and
  the block taking 0.5 % longer; it still loaded. The same defaults were
  not run against the KERNAL-format image here, and the KERNAL reader's
  own tolerance was not measured.
- **A real Datasette is not measured here.** Its motor speed differs
  from the nominal by an amount that varies by unit and by tape
  position, and a TAP written at the KERNAL's exact pulse values says
  nothing about how far off a deck can be before the reader loses a
  bit. The KERNAL's two copies exist for that case.
- **Only the plain-`LOAD` path was run.** `LOAD"NAME"`, `LOAD"",1,1`
  with a type 3 header, `VERIFY`, and a tape with more than one program
  on it were not tried.
- **Timing granularity.** Every stage figure is a bracket of 50,000
  cycles, about two and a half frames, from a bisection on the exit
  screenshot; the program's own jiffy count is not a load timer.
- **No hardware tool.** Nothing here writes a physical cassette; the
  TAP is the release artefact and the player's own TAP-to-audio step is
  outside this page.

## Checklist

- The PRG's first two bytes are the load address; `01 08` wants header
  type 1 and a name. Check with `xxd -l 2 game.prg`.
- Write the KERNAL image with `kernal_tap.py`; the cycle figure it
  prints is the tape's own running time, not the load time.
- Decode it back with `tapcheck.py` and read `identical`, `length
  matches header`, zero parity failures, both copies agreeing, and a
  pulse rate in the KERNAL's range.
- Prove the load headless: `-1 image.tap`, `-moncommands play.mon`
  holding `tapectrl 1`, `+dsresetwithcpu`, `-keybuf 'load\nrun\n'`, no
  `-autostart`, and a cycle limit above the tape's running time plus
  the boot and the pause at `FOUND`: about 15 million cycles more than
  the writer's figure was enough for both images here.
- Look at the screenshot on both models.
- For a turbo release: the stub is a KERNAL-format program, so master
  it with `kernal_tap.py` and append the turbo TAP; check the tail in
  `tapcheck.py`'s output; shorten the turbo lead-in, since the motor
  restarts within a few pulses of the stub's end.
- Record the TAP's MD5 in the release notes.

## Not measured here

- The shortest leader the KERNAL reader accepts before the header
  block; 27,136 shorts is the KERNAL's own figure and the only one run.
- How the KERNAL uses the second copy of a block, and what it does with
  a tape that carries only one.
- The rule that ends the pause at `FOUND` and whether a key press
  shortens it in this KERNAL revision.
- Loading with VICE's speed error and wobble at their defaults, and on
  a real Datasette.
- Whether `-autostart image.tap` reproduces the `LOAD` path; it was not
  used, so the keyboard route above is the one the figures describe.

## See also

- [c64-file-formats](../formats/c64-file-formats.md), ".TAP" and its
  "KERNAL bit encoding" subsection
- [release-disk](release-disk.md), the disk counterpart of this page
- [vice-reference](../runtime/vice-reference.md), the monitor and
  `-moncommands`
- Pitfall: [tape_bit_is_a_pulse_pair_not_a_pulse](../pitfalls/loader.md)
- Recipe: [kickassembler/tape-turbo-loader](../recipes/kickassembler/tape-turbo-loader.md),
  whose `make_tap.py` writes the turbo block and whose listing is the
  stub used here
