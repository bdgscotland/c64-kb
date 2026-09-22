---
recipe: headless-verify
toolchain: oscar64
output_format: PRG
region: both
techniques: [joystick_edge_detect]
file_formats: [PRG]
uses_registers: [D020, DC00, D012]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# Oscar64 Headless Verify: a self-checking program a script can grade

## Synopsis

A C program that does a checkable computation and reports the verdict
three ways a harness can read without a human: a result code at `$02FF`,
the border colour (green for pass, red for fail), and a line of text. The
computation is a 16-bit fold of the first page of the KERNAL ROM
(`$E000` to `$E0FF`), compared against the value computed on the host
from the ROM image, followed by 36 frames of joystick input through the
edge detector of `joystick-input.md`, folded the same way. One define,
`AUTOPILOT`, swaps the port read for a scripted byte so a headless run
exercises the input path (section "Autopilot input"); another,
`FORCE_FAULT`, makes the verdict fail so the harness can be tested
(section "Self-test the harness"). Use it as the template for any Oscar64
test program that must be graded by the exit screenshot or over the
monitor; the harness side is in `runtime/vice-reference.md`, section
"Verifying a run without a human". The KickAssembler version is
`recipes/kickassembler/headless-verify.md`.

## Source

```c
// headless-verify.c
// Folds the first page of the KERNAL ROM ($E000-$E0FF) into a 16-bit
// checksum, then runs 36 frames of joystick input through an edge
// detector and folds the events the same way. Both folds are compared
// with values computed on the host, and the verdict is reported three
// ways: a code at $02FF, the border colour, and a line of text.
// AUTOPILOT=1 replaces the port read with a scripted byte so a headless
// run exercises the input path; FORCE_FAULT=1 makes the verdict fail.
#include <stdio.h>
#include <c64/vic.h>
#include <c64/cia.h>

#ifndef AUTOPILOT
#define AUTOPILOT  0             // 1: scripted port bytes instead of $DC00
#endif
#ifndef FORCE_FAULT
#define FORCE_FAULT 0            // 1: demonstrate the red case
#endif

#define EXPECTED   0xc96f        // fold of kernal-901227-03.bin bytes 0..255
#define FRAMES     36            // input frames folded, same in both builds

#define CODE_PASS  0x01
#define CODE_FAIL  0x02

#define JOY_MASK   0x1f          // bits 0-4: up, down, left, right, fire
#define RESULT     (*(volatile char *)0x02ff)   // verdict byte read by the harness

// Edge detector from recipes/oscar64/joystick-input.md, unchanged.
struct JoyEvents { char newp, held, released; };

static void joy_edge(char prev, char cur, struct JoyEvents *e)
{
    char pressed = ~cur & JOY_MASK;
    e->newp     = pressed & prev;
    e->held     = pressed & ~prev & JOY_MASK;
    e->released = cur & ~prev & JOY_MASK;
}

#if AUTOPILOT
// Scripted input: { frames, port byte }, active low as $DC00 reads it.
// Fire for 4 frames, nothing, right for 6, right and fire for 4, nothing.
#define EXPECT_INPUT 0xccd4      // fold of the events this table produces
static const char script[6][2] = {
    { 8, 0xff }, { 4, 0xef }, { 8, 0xff }, { 6, 0xf7 }, { 4, 0xe7 }, { 6, 0xff }
};
static char ap_index, ap_used;

static char port_read(void)
{
    char out = 0xff;                            // past the table: nothing pressed
    if (ap_index < 6) {
        out = script[ap_index][1];
        if (++ap_used == script[ap_index][0]) { ap_used = 0; ap_index++; }
    }
    return out;
}
#else
#define EXPECT_INPUT 0x2e7c      // fold of 36 frames with nothing pressed
static char port_read(void)
{
    cia1.pra = 0xff;                            // no keyboard column selected
    return cia1.pra;                            // control port 2, active low
}
#endif

static void wait_frame(void)
{
    while (vic.raster == 250) ;
    while (vic.raster != 250) ;
}

int main(void)
{
    const volatile char *rom = (const volatile char *)0xe000;
    unsigned chk = 0, in_chk = 0;
    char prev = 0xff, presses = 0;
    struct JoyEvents e;

    for (unsigned i = 0; i < 256; i++)
        chk = (chk ^ rom[i]) * 5 + 1;           // unsigned is 16-bit: wraps

    for (char f = 0; f < FRAMES; f++) {
        wait_frame();
        char cur = port_read();                 // real port or the script
        joy_edge(prev, cur, &e);
        prev = cur;
        in_chk = (in_chk ^ ((unsigned)e.newp | ((unsigned)e.held << 5)
                            | ((unsigned)e.released << 10))) * 5 + 1;
        for (char n = e.newp; n; n >>= 1) presses += n & 1;
    }

    char code = (chk == (EXPECTED ^ FORCE_FAULT) && in_chk == EXPECT_INPUT)
                ? CODE_PASS : CODE_FAIL;

    RESULT = code;                              // the harness watches this store
    vic.color_border = (code == CODE_PASS) ? 5 : 2;   // green or red

#if AUTOPILOT
    printf("INPUT %04X PRESSES %d\n", in_chk, presses);
#endif
    printf("RESULT %02X %s\n", code, code == CODE_PASS ? "PASS" : "FAIL");
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -n -o=headless-verify.prg headless-verify.c
```

Produces `headless-verify.prg`, 4,676 bytes (Oscar64 build 2026-05-19;
most of it is `printf`; the listing without the input loop was 4,456).
`-n` writes `headless-verify.map`, which puts `main` at `$0880`. The two
other builds this page measures:

```bash
oscar64 -tm=c64 -O2 -dAUTOPILOT=1 -o=headless-verify-auto.prg headless-verify.c     # 4,785 bytes
oscar64 -tm=c64 -O2 -dFORCE_FAULT=1 -o=headless-verify-fault.prg headless-verify.c  # 4,676 bytes
```

`EXPECTED` comes from the host:

```bash
python3 -c "
rom = open('/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin', 'rb').read()
chk = 0
for v in rom[:256]:
    chk = ((chk ^ v) * 5 + 1) & 0xffff
print('%04X' % chk)"        # C96F
```

Both `EXPECT_INPUT` values come from the same edge detector and fold in
Python, run over the script table and over 36 idle frames:

```python
JOY = 0x1f
def edge(prev, cur):
    p = ~cur & JOY
    return p & prev, p & ~prev & JOY, cur & ~prev & JOY
def fold(bytes_in):
    c, prev, presses = 0, 0xff, 0
    for cur in bytes_in:
        n, h, r = edge(prev, cur); prev = cur
        c = ((c ^ (n | h << 5 | r << 10)) * 5 + 1) & 0xffff
        presses += bin(n).count('1')
    return c, presses
script = [(8, 0xff), (4, 0xef), (8, 0xff), (6, 0xf7), (4, 0xe7), (6, 0xff)]
print('%04X %d' % fold([b for f, b in script for _ in range(f)]))   # CCD4 3
print('%04X %d' % fold([0xff] * 36))                                # 2E7C 0
```

## Expected output

Border green. Text area still the power-on blue. Screen rows 5 to 9:

```
READY.
RUN
RESULT 01 PASS

READY.
```

Screenshots from the pinned run, 8,000,000 cycles: `screenshots/headless-verify.png`
(PAL) and `screenshots/headless-verify-ntsc.png` (NTSC). Measured on both:
`RESULT 01 PASS` on screen row 7, border pixel (2, 100) = (98, 213, 50) on
PAL and (114, 189, 103) on NTSC, which is index 5 in both palettes of
`runtime/vice-reference.md`. The NTSC picture is the same as the
KickAssembler recipe's, cell for cell; the PAL picture differs from it
only in the cursor cell at row 10, column 0 (64 pixels).

The pictures were re-pinned on 2026-09-22 when the input loop was added.
The NTSC picture is byte-identical to the one the earlier listing gave.
The PAL picture differs in one cell: the cursor at row 10, column 0, is
lit in this run and was dark before (64 pixels, measured with PIL); the
36 frames of input move the exit into the other phase of the cursor
blink. Each picture was produced twice by the pinned command and the two
files were identical bytes.

The red case, `-dFORCE_FAULT=1`, was run on PAL and NTSC and not pinned:
the same screen with `RESULT 02 FAIL` on row 7 and the border at
(175, 60, 88) on PAL, (169, 71, 100) on NTSC, index 2. The text area does
not change colour. The define was `FORCE_FAIL`, edited in the source; it
is now `FORCE_FAULT` behind `#ifndef`, so a command-line `-d` sets it and
the self-test below needs no edit. The binary-monitor harness stopped
the earlier build at `$08C6` with `$02FF` holding `02`; the address on
this build was not measured here.

The autopilot build, `-dAUTOPILOT=1`, was run on PAL and NTSC and not
pinned: `INPUT CCD4 PRESSES 3` on row 7, `RESULT 01 PASS` on row 8,
`READY.` on row 10, border index 5 on both. `CCD4` and `3` are the
host's values for the script table.

## Why this works

`RESULT` is a `volatile char` at a literal address, so the store is
emitted where it is written and not folded into the `printf` call; the
border write follows it. A store watchpoint on `$02FF` fires once the
byte is in memory (measured in VICE 3.10 on this build: the binary
monitor's stop event reported the PC as the instruction after the store
and the read gave `01`). Two stores reach `$02FF` in a run: the KERNAL
reset clears page 2 first (`STA $0200,Y` at `$FD56` with `A = 0`), so a
harness must ignore a value of `00` and wait for the next hit. That is
why the codes start at `01`: `00` means "never got here", a different
failure from `02`.

`unsigned` is 16 bits in Oscar64, so `(chk ^ rom[i]) * 5 + 1` wraps at
`$FFFF` without an explicit mask, matching the Python that produced
`EXPECTED`. `rom` is `volatile` so the compiler reads the ROM rather than
constant-folding an address it could otherwise treat as unknown memory.
`vic.color_border` is the `struct VIC` field for `$D020` in `c64/vic.h`.
`printf` goes out through `putchar`, which is a `jsr $ffd2` in Oscar64's
`stdio.c`, so the text appears where BASIC's cursor is and the run ends
at `READY.`.

The input loop runs in every build. `port_read()` is the only place the
program touches the port, and `wait_frame()` polls `$D012` for line 250,
so the 36 reads are one per frame on both regions, about 0.7 s on PAL.
The KERNAL IRQ stays on; its keyboard scan can leave
`$DC00` at `$7F` between the write and the read, which is why the events
are masked to bits 0 to 4 and why the idle run gives `2E7C` with `0`
presses on both models. On a real machine the default build expects
nothing on control port 2 during those frames; a stick held gives
`RESULT 02`.

Verified: compiled with Oscar64 (build 2026-05-19), run headless in VICE
x64sc 3.10 with the pinned command on PAL and NTSC; the screenshots were
decoded with the char ROM, not read by eye.

## Autopilot input

A headless VICE run cannot hold a joystick (`joystick-input.md`), so an
input path graded only by the pinned run is never exercised with a press.
The listing above answers that with one define. `AUTOPILOT` selects
which `port_read()` is compiled: `0`, the default, reads control port 2
from `$DC00`; `1` returns the next byte of a scripted table of
`{ frames, byte }` pairs, active low as the port reads it, and `$FF`
once the table is spent. Everything after the read is the same code in
both builds: `joy_edge` from `joystick-input.md` turns the byte into
press, hold and release events, the fold and the press count consume
them, and the verdict compares the fold with the host's value for that
build. Only the source of the byte changes, so a green from the
autopilot build is a statement about the game's own edge detector and
whatever it feeds, not about a test double.

The pattern was kept in the built Source rather than a text fence so the
listing gate compiles it and the pinned run executes the real-port half;
the autopilot half is compiled by `-dAUTOPILOT=1` and was run on both
models (Expected output above), not pinned. The cost was a re-pin of the
PAL picture, one cursor cell.

Measured with `-dAUTOPILOT=1`: the script produces three new presses,
fire at frame 8, right at frame 20 and fire again at frame 26 while right
is held, and the fold `CCD4`; the program printed `INPUT CCD4 PRESSES 3`
and `RESULT 01 PASS` with a green border on PAL and NTSC. A table entry
with a wrong byte or frame count changes the fold, so the host model in
Build has to be updated with the table; a wrong `EXPECT_INPUT` shows as
`RESULT 02`, which was checked by building once with the idle value in
the autopilot build.

A game whose autopilot decides from its own state, the LFSR in
`lfsr-random.md` for instance, replaces the table lookup with that
decision and keeps `port_read()` as the single seam: a walk direction
held for a random spell, a fire bit pulsed for one frame so the edge
detector sees a press exactly as a stick gives one. Its fold is not
predictable on the host, so such a build grades itself on invariants
(no assertion tripped over N frames) rather than on a constant. For a
pinned run the seed must be one the run reproduces; whether a seed taken
from SID voice 3 noise reproduces under `+autostart-delay-random` was not
measured here.

## Self-test the harness

A harness that exits 0 is only evidence once it has been seen to exit
non-zero on a build that fails. `FORCE_FAULT` exists for that: it flips
the expected ROM fold, so the same code path stores `$02` and paints the
border red. Build both, run the same script on both, and keep the green
only if the red exits non-zero. Measured on 2026-09-22 with the Route 1
script `verdict_shot.sh` from `runtime/vice-reference.md`, section
"Verifying a run without a human", PAL:

```bash
oscar64 -tm=c64 -O2 -o=headless-verify.prg headless-verify.c
./verdict_shot.sh headless-verify.prg pal; echo "exit $?"
# border (98, 213, 50) PASS
# exit 0

oscar64 -tm=c64 -O2 -dFORCE_FAULT=1 -o=headless-verify-fault.prg headless-verify.c
./verdict_shot.sh headless-verify-fault.prg pal; echo "exit $?"
# border (175, 60, 88) FAIL
# exit 1
```

The pair must be run again whenever the harness changes: a different
pixel, a different palette table, a different cycle count. A harness
that returns 0 for both builds is not reading the program. One way to
get that was measured while writing this section: `grader | tail -1;
echo $?` prints 0 whatever the grader exited, in `sh` and in `bash`,
because `$?` is the last command in the pipe. Another is a run too short
for the program to reach its store; this recipe's script reports that
as exit 2, and a harness without a "no verdict" arm reports whatever
its default is. `FORCE_FAULT` tests the reporting and the harness, not
the computation: a fault in the ROM fold or the edge detector is what
`EXPECTED` and `EXPECT_INPUT` are for. Building the autopilot variant
with the idle fold as `EXPECT_INPUT` gave `INPUT CCD4 PRESSES 3` and
`RESULT 02 FAIL` with a red border on PAL, so a wrong constant is
caught the same way.
