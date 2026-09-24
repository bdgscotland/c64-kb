---
recipe: sprites-off-during-disk-io
toolchain: oscar64
output_format: PRG
region: both
techniques: [kernal_file_write_seq, error_channel_check]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D015, D020, D027, DD04, DD05, DD06, DD07, DD0D, DD0E, DD0F]
uses_kernal: [SETLFS, SETNAM, OPEN, CLOSE, CHKIN, CHKOUT, CLRCHN, CHRIN, CHROUT, READST]
---

<!-- doc-type: recipe -->

# Oscar64 Sprites Off During Disk I/O

## Synopsis

Eight sprites stand over two badlines while the program saves a small
SEQ file to drive 8 through `kernalio.h`: scratch, write five bytes,
read the drive's status line. Part A switches the sprites off around
every save and passes. Part B leaves them on, and the save never
returns. A CIA2 timer-B NMI is a watchdog that prints `HUNG` when one
disk call has run for 3,000,000 cycles. It is the reproduction for
pitfall `sprites_over_badlines_hang_serial_io`. Copy the part A
pattern into any game that saves with sprites on screen. The hang is
measured in VICE x64sc 3.10 with true drive emulation and VICE's
default 1541-II, not on hardware; an earlier version said a 1541.

## Source

```c
// sprites-off-during-disk-io.c
// Eight sprites shown on lines 101-121, over badlines 107 and 115.
// Part A saves a small SEQ file ROUNDS times with the sprites switched
// off around every disk call; part B does the same with them left on.
// A CIA2 timer-B NMI is a watchdog: every disk call re-arms it, and if
// one call takes longer than 3,000,000 cycles (about 3 s) the NMI prints
// HUNG on the part's line and stops. The KERNAL's bit-receive loop runs
// under SEI and have no timeout, so an IRQ could not do this; an NMI can.
#include <stdio.h>
#include <c64/vic.h>
#include <c64/kernalio.h>

#define ROUNDS  3
#define WD_TICKS 60                      // x 50,000 cycles = 3,000,000

#define CIA2 ((volatile char *)0xdd00)
#define SCREEN ((char *)0x0400)

static char part;                        // 'A' or 'B': which line HUNG goes on
static char reply[40];
static const char rec[5] = { 'S', 'V', 1, 2, 3 };

__hwinterrupt void watchdog(void)
{
    // Never returns: the drive and the C64 are stuck in a handshake that
    // nothing on this side can finish.
    char *p = SCREEN + 40 * (part == 'A' ? 11 : 16) + 3;
    p[0] = 8; p[1] = 21; p[2] = 14; p[3] = 7;          // HUNG, screen codes
    vic.color_border = VCOL_RED;
    for (;;) ;
}

static void kick(void)                   // re-arm: B reloads from its latch
{
    CIA2[15] = 0x51;                     // B: force load, start, count A underflows
}

static void watchdog_on(void)
{
    CIA2[13] = 0x7f;                     // no CIA2 sources
    CIA2[4] = 0x50; CIA2[5] = 0xc3;      // A: 50,000 cycles
    CIA2[6] = WD_TICKS; CIA2[7] = 0;     // B: WD_TICKS underflows of A
    CIA2[14] = 0x11;                     // A: force load, start, continuous
    kick();
    *(volatile unsigned *)0x0318 = (unsigned)watchdog;  // KERNAL NMI jumps here
    CIA2[13] = 0x82;                     // enable timer B -> NMI
}

static char status(void)                 // the drive's error number, 99 if none
{
    char code = 99;
    kick();
    krnio_setnam("");
    if (krnio_open(15, 8, 15)) {
        kick();
        if (krnio_gets(15, reply, sizeof(reply)) >= 2)
            code = (reply[0] - '0') * 10 + (reply[1] - '0');
    }
    kick();
    krnio_close(15);
    return code;
}

static void command(const char *c)
{
    kick();
    krnio_setnam(c);
    if (krnio_open(15, 8, 15)) {
        kick();
        krnio_gets(15, reply, sizeof(reply));
    }
    kick();
    krnio_close(15);
}

static char save_once(void)              // scratch, write 5 bytes, read status
{
    command("S0:SLOT");
    kick();
    krnio_setnam("SLOT,S,W");
    if (krnio_open(2, 8, 2)) {
        kick();
        krnio_write(2, rec, 5);
    }
    kick();
    krnio_close(2);
    return status();
}

static char run(char guarded)
{
    char ok = 0;
    for (char i = 0; i < ROUNDS; i++) {
        if (guarded) vic.spr_enable = 0x00;       // the fix
        char s = save_once();
        if (guarded) vic.spr_enable = 0xff;
        if (s == 0) ok++;
    }
    return ok;
}

int main(void)
{
    for (char i = 0; i < 63; i++) ((char *)0x0340)[i] = 0xff;  // block 13
    for (char k = 0; k < 8; k++) {
        ((char *)0x07f8)[k] = 13;
        vic.spr_pos[k].x = 40 + 24 * k;
        vic.spr_pos[k].y = 100;          // shown on lines 101-121
        vic.spr_color[k] = VCOL_YELLOW;
    }
    vic.spr_msbx = 0;

    printf("%c", 147);
    printf("SPRITES OFF DURING DISK I/O\n");
    printf("8 SPRITES ON LINES 101-121\n");
    printf("\n\n\n\n\n\n\n\n");
    printf("A: SPRITES OFF AROUND EACH CALL\n");
    watchdog_on();
    vic.spr_enable = 0xff;

    part = 'A';
    char ok = run(1);
    printf("   %d OF %d SAVES OK\n", ok, ROUNDS);
    printf("\n\n\n");
    printf("B: SPRITES LEFT ON\n");
    part = 'B';
    ok = run(0);
    CIA2[13] = 0x7f;                     // finished: watchdog off
    printf("   %d OF %d SAVES OK\n", ok, ROUNDS);
    vic.color_border = VCOL_GREEN;
    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=sprites-off-during-disk-io.prg sprites-off-during-disk-io.c
```

The run needs a formatted disk in drive 8. VICE's true drive emulation
is on by default, and its default drive is a 1541-II; `runs.json` pins
both with `-drive8truedrive -drive8type 1542`:

```bash
c1541 -format "test,01" d64 test.d64
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 30000000 -8 test.d64 \
      -exitscreenshot sprites-off-during-disk-io.png \
      -autostart sprites-off-during-disk-io.prg
```

Add `-model ntsc` for the NTSC run. Both runs are pinned in
`recipes/runs.json` at 30,000,000 cycles with a fresh disk.

## Expected output

```
SPRITES OFF DURING DISK I/O
8 SPRITES ON LINES 101-121

(a yellow band: eight solid sprites)

A: SPRITES OFF AROUND EACH CALL
   3 OF 3 SAVES OK



B: SPRITES LEFT ON
   HUNG
```

Light blue text on blue, text rows 0, 1, 10, 11, 15 and 16. Red border.
Screenshots: `screenshots/sprites-off-during-disk-io.png` (PAL, the
default c64c: 8565, 8521) and `screenshots/sprites-off-during-disk-io-ntsc.png`
(NTSC 6567R8, 6526).

Measured on both PNGs with PIL, text cells decoded against
`chargen-901225-01.bin`:

- The six text rows read as above.
- The yellow band covers raster lines 101 to 121 and x 48 to 239: VIC X
  40 to 231, eight 24-pixel sprites edge to edge. A sprite at Y 100 is
  drawn from line 101.
- The border is red, the watchdog's colour. A run in which part B
  finished would print `n OF 3 SAVES OK` on row 16 and turn the border
  green.

The picture is final by 20,000,000 cycles on PAL and 25,000,000 on NTSC.
Six runs, three per model, at 30,000,000 gave one PNG per model; so did
25,000,000, and so did PAL and NTSC with `-cia1model 1`, with
`-cia1model 1 -cia2model 1`, and with `-drive8type 1541`: the same
pixels as the baselines. On `-model c64`
(6569, 6526) the text and the band are the same; the palette differs.

## Why this works

**What hangs.** In part B the C64 receives a byte from the drive in the
KERNAL's ACPTR (`$EE13`) and counts eight clock pulses in the loop at
`$EE5A`-`$EE74`. The loop polls `$DD00` under `SEI` and has no timeout.
Stopped with the remote monitor during a hang of this program's test
build, the C64 was in that loop with the bit counter `$A5` at 1, and the
drive was at `$E987`, waiting for the C64 to acknowledge a byte it had
finished sending. The C64 missed one of the drive's eight clock pulses
and waits for a ninth that never comes. The pitfall page has the
measurements, the drive's pulse timing and the conditions under which
the hang does and does not occur.

**Why part A passes.** With `$D015` at 0 the VIC-II fetches no sprite
data, so the CPU loses only the badline's 40-43 cycles. With the
sprites on, the fetches for sprites on the same lines as a badline
lengthen the stall. Blanking the screen (`$D011` bit 4 off) removes the
badlines and passes too (measured in the test build, not in this
listing). Either one alone is enough.

**Why the watchdog is an NMI.** The receive loop runs with the I flag
set, so no raster or CIA1 interrupt can fire inside it. CIA2 drives
`/NMI`, which the I flag does not mask. The KERNAL's NMI entry at
`$FE43` runs `SEI` and `JMP ($0318)`, so the handler goes in `$0318`.
Timer A counts 50,000 cycles in a loop, timer B counts 60 of its
underflows, and `kick()` reloads timer B before every disk call. A
disk call in part A took well under 3,000,000 cycles: all three rounds
passed with the same watchdog.
