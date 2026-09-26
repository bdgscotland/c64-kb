---
recipe: trainer-hooks
toolchain: oscar64
output_format: PRG
region: both
techniques: [trainer_and_cheat_hooks]
file_formats: [PRG]
uses_registers: [D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 trainer hooks: find a lives byte by value search, find the DEC, patch it two ways

## Synopsis

A small "game" death routine, written in machine code, clears a player
state byte, decrements a lives byte and branches to game over on zero.
A trainer that does not know where the lives byte is finds it the way a
freezer cartridge's search does: every address in `$0800-$8FFF` holding
3 at the start, then those holding 2 after one death, then 1 after the
next. It scans the same range for `DEC` of the survivor, then patches
that instruction two ways and plays each patched game for up to eight
deaths. Three NOPs keep the lives at 3 but end the game on the first
death; `LDA` of the same address keeps it running. CIA1 timers A and B
time the first search pass; the count goes to `$02FB-$02FE`, low byte
first, not to the screen. `$02FF` holds `01` and the border is green
when one candidate survives, it is the lives byte, one `DEC` is found,
the unpatched game ends on death 3, the NOP game on death 1 and the LDA
game survives all eight; else `02` and red. It implements
`trainer_and_cheat_hooks` (`techniques/cpu-cycle-tricks.md`) and
measures `nop_patch_leaves_stale_flags` (`pitfalls/cpu.md`).

## Source

```c
// trainer-hooks.c
// A cheat found and applied the way a freezer cartridge or a trainer does.
// The "game" is a death routine in machine code that decrements a lives
// byte and branches to game over on zero. The trainer does not know where
// the byte is: it searches RAM $0800-$8FFF for the value 3 at the start,
// 2 after one death and 1 after the second, keeping a candidate bitmap.
// It then scans the same range for DEC abs/zp of the survivor and patches
// the instruction two ways: three NOPs, and LDA of the same address. The
// NOP patch keeps lives at 3 but the BEQ after it tests the Z flag left by
// the LDA #0 before it, so the first death is game over. The LDA patch
// sets Z from the lives byte and the game runs on. CIA1 timers A and B
// time the first search pass; the count goes to $02FB-$02FE, low byte
// first. $02FF holds 01 and the border is green when
// exactly one candidate survives, one DEC is found, the NOP patch ends the
// game on the first death and the LDA patch survives eight; else 02, red.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)
#define CYCLES ((volatile char *)0x02fb)   // pass 1 cycles, 32 bits, low byte first

#define LO 0x0800u
#define HI 0x9000u
#define SPAN (HI - LO)

volatile char lives;        // the game's lives byte; the trainer never names it
volatile char player_state;
volatile char alive;        // the routine's result, set in the asm below
char cand[SPAN / 8];        // one bit per searched address

// The game's death routine, as the game would ship it: clear the player
// state, take a life, branch on zero. Returns 1 while alive, 0 at game over.
__noinline char player_died(void)
{
    __asm volatile {
        lda #0
        sta player_state
        dec lives
        beq over
        lda #1
        sta alive
        jmp done
    over:
        lda #0
        sta alive
    done:
    }
    return alive;
}

static const char hex_glyph[16] = {
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 1, 2, 3, 4, 5, 6 };

static void put_str(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static void put_hex16(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hex_glyph[v >> 12];
    p[1] = hex_glyph[(v >> 8) & 15];
    p[2] = hex_glyph[(v >> 4) & 15];
    p[3] = hex_glyph[v & 15];
}

static void put_dec(char row, char col, unsigned long v, char width)
{
    char *p = SCREEN + 40 * row + col + width;
    do
    {
        *--p = '0' + (char)(v % 10);
        v /= 10;
    } while (--width);
}

// First pass: every address holding the value becomes a candidate.
__noinline unsigned search_first(char value)
{
    unsigned n = 0;
    const char *p = (const char *)LO;
    for (unsigned i = 0; i < SPAN / 8; i++)
    {
        char bits = 0;
        for (char b = 0; b < 8; b++)
        {
            bits <<= 1;
            if (*p++ == value)
            {
                bits |= 1;
                n++;
            }
        }
        cand[i] = bits;
    }
    return n;
}

// Later passes: keep a candidate only if it now holds the new value.
__noinline unsigned search_next(char value)
{
    unsigned n = 0;
    const char *p = (const char *)LO;
    for (unsigned i = 0; i < SPAN / 8; i++)
    {
        char bits = cand[i];
        if (bits)
        {
            char m = 0x80;
            for (char b = 0; b < 8; b++)
            {
                if ((bits & m) && p[b] != value)
                    bits &= ~m;
                else if (bits & m)
                    n++;
                m >>= 1;
            }
            cand[i] = bits;
        }
        p += 8;
    }
    return n;
}

static unsigned first_candidate(void)
{
    for (unsigned i = 0; i < SPAN / 8; i++)
    {
        char bits = cand[i];
        if (bits)
        {
            unsigned a = LO + i * 8;
            while (!(bits & 0x80))
            {
                bits <<= 1;
                a++;
            }
            return a;
        }
    }
    return 0;
}

// Find DEC abs ($CE lo hi) or, for a zero-page byte, DEC zp ($C6 lo).
static unsigned find_dec(unsigned target, char *count)
{
    unsigned site = 0;
    *count = 0;
    const char *p = (const char *)LO;
    for (unsigned i = 0; i < SPAN - 2; i++)
    {
        bool hit = (p[i] == 0xce && p[i + 1] == (char)target && p[i + 2] == (char)(target >> 8))
                || (target < 0x100 && p[i] == 0xc6 && p[i + 1] == (char)target);
        if (hit)
        {
            site = LO + i;
            (*count)++;
        }
    }
    return site;
}

// Play until game over, at most `limit` deaths; return the deaths taken.
static char play(char limit)
{
    lives = 3;
    char deaths = 0;
    while (deaths < limit)
    {
        deaths++;
        if (!player_died())
            break;
    }
    return deaths;
}

int main(void)
{
    __asm { sei }
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;

    // Search: value 3 at the start, 2 after a death, 1 after another.
    lives = 3;
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;
    cia1.cra = 0x11;
    unsigned n3 = search_first(3);
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    unsigned long cyc = ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
    player_died();
    unsigned n2 = search_next(2);
    player_died();
    unsigned n1 = search_next(1);
    unsigned addr = first_candidate();

    char decs;
    unsigned site = find_dec(addr, &decs);
    char *code = (char *)site;
    char saved[3] = { code[0], code[1], code[2] };

    // Unpatched, the game ends on the third death.
    char d_orig = play(8);

    // Patch 1: three NOPs over the DEC.
    code[0] = 0xea; code[1] = 0xea; code[2] = 0xea;
    char d_nop = play(8);
    char l_nop = lives;

    // Patch 2: LDA of the same address; Z now comes from the lives byte.
    code[0] = 0xad; code[1] = saved[1]; code[2] = saved[2];
    char d_lda = play(8);
    char l_lda = lives;

    bool ok = n1 == 1 && addr == (unsigned)&lives && decs == 1
           && d_orig == 3 && d_nop == 1 && l_nop == 3 && d_lda == 8 && l_lda == 3;

    put_str(0, 0, "trainer: value search, dec scan, patch");
    put_str(2, 0, "search 3:        2:      1:");
    put_dec(2, 9, n3, 5);
    put_dec(2, 19, n2, 3);
    put_dec(2, 27, n1, 3);
    // The count depends on how many bytes match, so on the power-on RAM:
    // it goes to $02FB-$02FE for the monitor, not to the pinned screen.
    put_str(3, 0, "pass 1 cycles at $02fb");
    for (char i = 0; i < 4; i++)
        CYCLES[i] = (char)(cyc >> (8 * i));
    put_str(4, 0, "lives at $      dec at $      decs");
    put_hex16(4, 10, addr);
    put_hex16(4, 24, site);
    put_dec(4, 36, decs, 2);
    put_str(6, 0, "patch  deaths  lives  (8 max)");
    put_str(7, 0, "none");
    put_dec(7, 7, d_orig, 2);
    put_str(8, 0, "nop");
    put_dec(8, 7, d_nop, 2);
    put_dec(8, 14, l_nop, 2);
    put_str(9, 0, "lda");
    put_dec(9, 7, d_lda, 2);
    put_dec(9, 14, l_lda, 2);
    put_str(11, 0, ok ? "pass" : "fail");
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=trainer-hooks.prg trainer-hooks.c
```

Run headless (the program finishes in well under 8,000,000 cycles and
holds its screen). `cycles.mon` logs `$02FB-$02FF` when the verdict is
stored (the route in `runtime/vice-reference.md`, "Route 2: the
machine, over `-moncommands`"):

```
logname "cycles.log"
log on
trace store 02ff
command 1 "m 02fb 02ff"
```

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 8000000 -raminitrandomchance 0 -moncommands cycles.mon -exitscreenshot trainer-hooks.png -autostart trainer-hooks.prg
grep '^>C:02fb' cycles.log | tail -1
```

Add `-model ntsc` for the NTSC picture. The PRG is 1,924 bytes.
`-raminitrandomchance 0` is in the pinned run (`runs.json`); why is in
"Expected output".

## Expected output

White text on black, green border. PAL,
`screenshots/trainer-hooks.png`:

```
trainer: value search, dec scan, patch

search 3:00018   2:001   1:001
pass 1 cycles at $02fb
lives at $0f83  dec at $0b84  decs  01

patch  deaths  lives  (8 max)
none   03
nop    01     03
lda    08     03

pass
```

NTSC, `screenshots/trainer-hooks-ntsc.png`: the same rows. Read from
both screenshots with a PIL decoder that matches each cell against the
character ROM (VICE x64sc 3.10). The two addresses are where this build
put them; another compiler version moves them, and the search finds
them wherever they are.

The monitor log's last line is `>C:02fb  6d a1 16 00` on PAL
($0016A16D, 1,483,117 cycles) and `>C:02fb  39 d0 16 00` on NTSC
($0016D039, 1,495,097), then `>C:02ff  01`: the same bytes on ten runs
of each model with VICE's default RAM and on three with
`-raminitrandomchance 0`.

The search reads RAM the program never wrote, so its first count
depends on the power-on contents. VICE fills RAM with a pattern of
`$00` and `$FF` plus random bit flips (`RAMInitRandomChance=10` in
`-dumpconfig`), and the random part changed between invocations here:
six runs started together at chance 400 put their extra 3s at one set
of addresses, three runs started later at another. At the default the
count was 18 on 40 direct runs of this build and 60 of a probe build
that lists the addresses. One of 38 `verify:recipes` runs of this page
counted 19 (`search 3:00019`), as did one run of the earlier build by
another session, whose pass 1 then took 33 more cycles. With
`-raminitrandomchance 0` the count was 18 on 40 `verify:recipes` runs
of both models, four at a time. A real C64's power-on RAM varies too,
and the search copes the same way: the second pass still left one
candidate in the run that counted 19. (An earlier version printed the
cycle count on row 3, and issue #109 put the change down to interrupt
or autostart timing. Every run here with the same RAM gave the same
cycle count; it is now read from `$02FB`, so the picture does not
carry it.)

## Why this works

The search needs no symbol table. The value 3 sits in 18 of the 34,816
bytes searched; after one death only one of those 18 holds 2, and it
still holds 1 after the second. A real game gives more survivors after
the first narrowing (a score digit, a counter that happens to match),
and the answer is another death and another pass. The first pass reads
every byte and sets a candidate bit; the later passes only visit bytes
whose bit is set, so they cost a fraction of the first. The first pass
takes 1,483,117 cycles on PAL and 1,495,097 on NTSC, about 43 cycles a
byte in C with the screen on (measured with CIA1 timers A and B
chained, interrupts off, read from `$02FB`). The build that printed the
count on screen, laid out two bytes longer, gave 1,483,115 and
1,495,095.

The range stops at `$8FFF` because Oscar64 puts this program's stack at
`$9000-$9FF0` (its `.map` file). A build of this listing searching to
`$9FFF` counts 19 candidates, not 18, on four runs with and four
without `-raminitrandomchance 0`: the searcher's own stack is searched
with the game. A first build counted 19 on one run and 20 on the next;
the 20 was not reproduced here, and the random RAM above is one way to
get it (an earlier version blamed the stack changing between runs). A
search tool running inside the machine it searches has to leave its
own workspace out of the range.

The scan for the code that changes the byte looks for `$CE lo hi`
(`DEC abs`) and, for a zero-page byte, `$C6 lo`. It finds one, at
`$0B84`, whose next two bytes are `$F0 $08`: the game's `BEQ` to game
over. Those bytes were read from the PRG file. A three-byte opcode
pattern can occur in data as well; a scan that finds more than one is
narrowed by patching each and watching the byte, as the next step does.

The two patches differ in what the `BEQ` sees. Three NOPs remove the
decrement and also the flag it set, so the branch tests the Z flag of
the `LDA #0` two instructions earlier: Z is set, and the first death is
game over with 3 lives on the counter. `LDA lives` is the same length,
loads 3 and clears Z, so the branch falls through every time. It
changes A where the DEC did not; here the next instruction loads A
anyway. The unpatched game ending on death 3 is the control.
