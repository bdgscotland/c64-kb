---
recipe: fighter-opponent
toolchain: oscar64
output_format: PRG
region: both
techniques: [fighter_opponent_tables, fighter_guard_state, lfsr_random]
file_formats: [PRG]
uses_registers: [D011, D020, DD04, DD05, DD0E]
uses_kernal: [CHROUT]
---

<!-- doc-type: recipe -->

# Oscar64 Fighter Opponent: reaction delay, range keeping, and guard and feint choice from tables

## Synopsis

The computer opponent of a one-on-one fighter, with all its decisions in
data. It reads the player's action from a 32-byte delay line a level's
number of frames behind, sorts the distance into close, mid and far, and
picks attack, guard, feint or a step toward its preferred range from a
row of three thresholds chosen by (seen action, band) and one random
byte. A feint sets a flag: if the player is seen guarding when it ends,
the opponent attacks without a roll. A guard frame replaces the
opponent's body box with a guard box, and a blade that meets a guard box
is blocked. A scripted player fights a 600-tick bout at each of four
levels that differ only in the delay. The screen prints each level's
choices and hits, the cycles of one opponent step and one hit
resolution, and a checksum a Python model of the same rules also gives.
It is the recipe for the techniques `fighter_opponent_tables`
(`techniques/logic.md`) and `fighter_guard_state` (`techniques/sprite.md`),
and for the patterns of the same names in
`game-design/enemy-behaviour-and-difficulty.md`. An earlier version listed
only `lfsr_random` in its frontmatter, so no lookup linked it to either (#113).

## Source

```c
// fighter-opponent.c
// A one-on-one fighter's computer opponent run from tables. It sees the
// player's action through a delay line (the reaction delay), steps to keep
// a preferred range, and picks attack, guard, feint or step from a weight
// row chosen by (seen action, range band). A guard frame replaces the
// opponent's body box with a guard box of the same extent; an attack box
// that meets a guard box is blocked. A scripted player fights one bout of
// 600 ticks at each of four levels, which differ only in the delay. The
// counters are printed, folded into a checksum the Python model on the
// page also gives, and each opponent step is timed with CIA2 timer A.
#include <stdio.h>
#include <c64/vic.h>
#include <c64/cia.h>

#define RESULT (*(volatile char *)0x02ff)    // 1 pass, 2 fail, for a harness

// Actions. The player uses 0-4; FEINT and STUN are the opponent's.
#define A_IDLE   0
#define A_FWD    1
#define A_BACK   2
#define A_ATTACK 3
#define A_GUARD  4
#define A_FEINT  5
#define A_STUN   6

#define BODY_W   16                  // body and guard box width
#define REACH    12                  // blade box beyond the body
#define NEAR     (BODY_W + REACH)    // under this, an attack can land
#define FAR      56                  // at or over this, nothing reaches
#define PREF     34                  // the range a step makes for
#define X_MIN    24
#define X_MAX    232

#define WINDUP   4                   // attack: frames before the blade is out
#define ACTIVE   3                   // frames the blade box exists
#define ATK_LEN  12                  // with 5 frames of recovery
#define GUARD_LEN 10
#define FEINT_LEN 4
#define STEP_LEN 8
#define STUN_LEN 8
#define PUSH_HIT 6
#define PUSH_BLK 3

#define TICKS    600
#define EXPECT   0xF036              // the page's Python model

// Reaction delay per level, in frames: the opponent acts on what the
// player was doing this many frames ago.
static const char level_delay[4] = { 20, 14, 9, 5 };

// One row per (seen action, band): thresholds out of 256 for attack,
// guard and feint; a random byte at or above the third is a step.
// Band 0 close (under NEAR), 1 mid, 2 far (FAR and over).
static const char choice_row[5][3][3] = {
    //             close             mid              far
    /* IDLE   */ {{150, 180, 230}, { 40,  60, 110}, {  0,  10,  20}},
    /* FWD    */ {{120, 200, 220}, { 30, 110, 150}, {  0,  30,  40}},
    /* BACK   */ {{100, 120, 150}, { 20,  30,  40}, {  0,   0,   0}},
    /* ATTACK */ {{ 30, 200, 200}, {  0, 120, 120}, {  0,  20,  20}},
    /* GUARD  */ {{ 40,  60, 190}, { 10,  20, 110}, {  0,   0,  30}},
};

// The player's script: { frames, action }, looped.
static const char script[12][2] = {
    {30, A_FWD}, {12, A_ATTACK}, {10, A_GUARD}, {12, A_ATTACK},
    {20, A_BACK}, {15, A_IDLE}, {25, A_FWD}, {10, A_GUARD},
    {12, A_ATTACK}, {12, A_ATTACK}, {20, A_BACK}, {8, A_IDLE}
};

static char hist[32];                // the delay line, one action per frame
static unsigned seed;
static char px, ox;                  // left edges; the player faces right
static char p_act, p_t, p_done;      // action, frame in it, blade spent
static char o_act, o_t, o_len, o_done, o_dir, followup;
static char delay, tick;

// Per level: attack, guard, feint, step, follow-up, the player's hits
// landed and blocked, the opponent's hits landed and blocked.
static unsigned cnt[4][9];
static unsigned *c;

static unsigned cost, base, worst[2];   // [0] opponent_step, [1] resolve
static unsigned long sum[2];

static char rnd(void)                // 16-bit Galois LFSR, taps $B400
{
    char low = seed & 1;
    seed >>= 1;
    if (low) seed ^= 0xb400;
    return (char)seed;
}

static void start(char a, char len)
{
    o_act = a; o_len = len; o_t = 0; o_done = 0;
}

static void decide(char seen, char band)
{
    if (followup) {                          // the feint's second half
        followup = 0;
        if (seen == A_GUARD) { start(A_ATTACK, ATK_LEN); c[4]++; return; }
    }
    char r = rnd();
    const char *row = choice_row[seen][band];
    if (r < row[0])      { start(A_ATTACK, ATK_LEN);  c[0]++; }
    else if (r < row[1]) { start(A_GUARD, GUARD_LEN); c[1]++; }
    else if (r < row[2]) { start(A_FEINT, FEINT_LEN); c[2]++; followup = 1; }
    else {
        char d = ox - px;
        o_dir = d > PREF ? 0xff : (d < PREF ? 1 : 0);
        start(A_FWD, STEP_LEN);                      // a step, either way
        c[3]++;
    }
}

// One frame of the opponent: what it sees, its band, a decision when the
// last action has run out, and its movement.
static __noinline void opponent_step(void)
{
    char seen = hist[(char)(tick - delay) & 31];
    char d = ox - px;
    char band = d < NEAR ? 0 : (d < FAR ? 1 : 2);
    if (o_t >= o_len) decide(seen, band);
    if (o_act == A_FWD) {
        char nx = ox + o_dir;
        if (nx - px >= BODY_W && nx <= X_MAX) ox = nx;
    }
}

static void push_apart(char n)
{
    for (char i = 0; i < n; i++) {
        if (px > X_MIN) px--;
        if (ox < X_MAX) ox++;
    }
}

// Blade boxes against body or guard boxes, X only: both fighters stand
// on one floor. A guard box replaces the body box, so a blade meets one
// or the other, never both.
static __noinline void resolve(void)
{
    if (p_act == A_ATTACK && !p_done && p_t >= WINDUP && p_t < WINDUP + ACTIVE) {
        char l = px + BODY_W, r = l + REACH;         // blade, right of the body
        if (l < ox + BODY_W && ox < r) {
            p_done = 1;
            if (o_act == A_GUARD) { c[6]++; push_apart(PUSH_BLK); }
            else { c[5]++; start(A_STUN, STUN_LEN); push_apart(PUSH_HIT); }
        }
    }
    if (o_act == A_ATTACK && !o_done && o_t >= WINDUP && o_t < WINDUP + ACTIVE) {
        char r = ox, l = r - REACH;                  // blade, left of the body
        if (l < px + BODY_W && px < r) {
            o_done = 1;
            if (p_act == A_GUARD) { c[8]++; push_apart(PUSH_BLK); }
            else { c[7]++; push_apart(PUSH_HIT); }
        }
    }
}

static void time_begin(void)
{
    __asm { sei }
    cia2.cra = 0x00;
    cia2.ta  = 0xffff;
    cia2.cra = 0x11;
}

static void time_end(void)
{
    cia2.cra = 0x00;
    cost = 0xffff - cia2.ta;
    __asm { cli }
}

static void tally(char k)
{
    cost -= base;
    if (cost > worst[k]) worst[k] = cost;
    sum[k] += cost;
}

static void bout(char level)
{
    c = cnt[level];
    delay = level_delay[level];
    seed = 0xace1;
    for (char i = 0; i < 32; i++) hist[i] = A_IDLE;
    px = 80; ox = 160;
    o_act = A_IDLE; o_t = 0; o_len = 0; o_done = 0; followup = 0;
    char si = 0, left = script[0][0];
    p_act = script[0][1]; p_t = 0; p_done = 0;
    tick = 0;
    time_begin(); time_end();
    base = cost;                             // the empty start and stop
    for (unsigned n = 0; n < TICKS; n++) {
        hist[tick & 31] = p_act;
        if (p_act == A_FWD && ox - px > BODY_W) px++;
        if (p_act == A_BACK && px > X_MIN) px--;

        time_begin(); opponent_step(); time_end(); tally(0);
        time_begin(); resolve();       time_end(); tally(1);
        o_t++; p_t++; tick++;
        if (--left == 0) {
            if (++si == 12) si = 0;
            left = script[si][0]; p_act = script[si][1]; p_t = 0; p_done = 0;
        }
    }
}

int main(void)
{
    // Blank the screen so no badline steals a cycle from a timed span.
    // DEN is sampled on line $30, so wait for line 256: every frame after
    // it has no badlines.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    for (char l = 0; l < 4; l++) bout(l);
    vic.ctrl1 |= VIC_CTRL1_DEN;

    unsigned crc = 0;
    for (char l = 0; l < 4; l++)
        for (char k = 0; k < 9; k++) crc = (crc ^ cnt[l][k]) * 5 + 1;

    printf("%c", 147);
    printf("FIGHTER OPPONENT FROM TABLES\n\n");
    printf("L DLY ATK GRD FNT STP PHT PBK OHT OBK\n");
    for (char l = 0; l < 4; l++) {
        unsigned *v = cnt[l];
        printf("%d %3d %3d %3d %3d %3d %3d %3d %3d %3d\n", l, level_delay[l],
               v[0], v[1], v[2], v[3], v[5], v[6], v[7], v[8]);
    }
    printf("\nFEINT FOLLOW-UPS %d %d %d %d\n",
           cnt[0][4], cnt[1][4], cnt[2][4], cnt[3][4]);
    printf("STEP    CYCLES WORST %3d MEAN %3d\n", worst[0], (unsigned)(sum[0] / 2400));
    printf("RESOLVE CYCLES WORST %3d MEAN %3d\n", worst[1], (unsigned)(sum[1] / 2400));
    char ok = crc == EXPECT;
    printf("CHECK %04X %s\n", crc, ok ? "PASS" : "FAIL");
    RESULT = ok ? 1 : 2;
    vic.color_border = ok ? 5 : 2;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=fighter-opponent.prg fighter-opponent.c
```

The Oscar64 build named in CLAUDE.md produces a 6,242-byte PRG.

Pinned VICE run (both models, `docs/recipes/runs.json`):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
      -limitcycles 8000000 -exitscreenshot fighter-opponent.png \
      -autostart fighter-opponent.prg
```

Add `-model ntsc` for the second picture. The four bouts end before
5,000,000 cycles.

## Expected output

Green border (`PASS`), the KERNAL's blue screen and light blue text:

```
FIGHTER OPPONENT FROM TABLES

L DLY ATK GRD FNT STP PHT PBK OHT OBK
0  20   5  13   6  49   2   1   2   0
1  14  12  10   4  41   3   1   6   2
2   9   7  18   4  39   4   3   1   2
3   5   6  17   5  40   4   2   1   2

FEINT FOLLOW-UPS 0 1 1 2
STEP    CYCLES WORST 295 MEAN 120
RESOLVE CYCLES WORST 364 MEAN  41
CHECK F036 PASS
```

`recipes/oscar64/screenshots/fighter-opponent.png` (PAL, 384 by 272) and
`recipes/oscar64/screenshots/fighter-opponent-ntsc.png` (NTSC, 384 by
247) were decoded by matching every 8 by 8 cell against
`chargen-901225-01.bin`; both read the text above (measured in VICE
x64sc 3.10, rung 1).

- One row per level. `DLY` is the reaction delay in frames. `ATK`,
  `GRD`, `FNT` and `STP` count the table's choices; `PHT` and `PBK` are
  the player's blows that landed and that the opponent blocked; `OHT`
  and `OBK` the opponent's. `FEINT FOLLOW-UPS` counts attacks the feint
  flag started without a roll.
- `CHECK F036 PASS`. The 36 counters folded by
  `crc = (crc ^ v) * 5 + 1` in 16 bits give `F036`, and so does the
  Python model below, which runs the same rules on the same script and
  seed. The counts are the tables' result, not a tuning: the weights are
  a starting point for playtest.
- `STEP CYCLES WORST 295 MEAN 120`. CIA2 timer A around each of the
  2,400 `opponent_step` calls, less an empty start and stop pair, with
  interrupts held off and the screen blanked, so no badline takes a
  cycle. The worst is a decision frame; most frames only read the delay
  line and the band. `RESOLVE` is the same for `resolve`, both blades
  against body or guard boxes; its worst is a hit with the push-apart
  loop. Both are Oscar64 -O2 code and the same on PAL and NTSC.
  The step is this recipe's minimal opponent. A fuller one in a game
  built from the KB was reported at 652 cycles worst on PAL and 702 on
  NTSC (#115, not measured here); `fighter_opponent_tables` in
  `techniques/logic.md` gives both.

A first version blanked the screen and started at once. DEN is sampled
on line $30, so the frame it was cleared in still had its badlines, and
PAL read `STEP CYCLES WORST 322`, 27 cycles over the NTSC figure. The
`vic_waitFrame()` after the store removed the difference.

The Python model:

```python
IDLE, FWD, BACK, ATTACK, GUARD, FEINT, STUN = range(7)
BODY_W, REACH = 16, 12
NEAR, FAR, PREF, X_MIN, X_MAX = BODY_W + REACH, 56, 34, 24, 232
WINDUP, ACTIVE, ATK_LEN, GUARD_LEN, FEINT_LEN, STEP_LEN, STUN_LEN = 4, 3, 12, 10, 4, 8, 8
PUSH_HIT, PUSH_BLK, TICKS = 6, 3, 600
DELAY = [20, 14, 9, 5]
ROW = [
    [[150, 180, 230], [40, 60, 110], [0, 10, 20]],
    [[120, 200, 220], [30, 110, 150], [0, 30, 40]],
    [[100, 120, 150], [20, 30, 40], [0, 0, 0]],
    [[30, 200, 200], [0, 120, 120], [0, 20, 20]],
    [[40, 60, 190], [10, 20, 110], [0, 0, 30]],
]
SCRIPT = [(30, FWD), (12, ATTACK), (10, GUARD), (12, ATTACK), (20, BACK), (15, IDLE),
          (25, FWD), (10, GUARD), (12, ATTACK), (12, ATTACK), (20, BACK), (8, IDLE)]


def bout(delay):
    s = {"seed": 0xACE1}
    c = [0] * 9
    hist = [IDLE] * 32
    st = dict(px=80, ox=160, oact=IDLE, ot=0, olen=0, odone=0, odir=0, follow=0)

    def rnd():
        low = s["seed"] & 1
        s["seed"] >>= 1
        if low:
            s["seed"] ^= 0xB400
        return s["seed"] & 0xFF

    def start(a, n):
        st.update(oact=a, olen=n, ot=0, odone=0)

    def push(n):
        for _ in range(n):
            if st["px"] > X_MIN:
                st["px"] -= 1
            if st["ox"] < X_MAX:
                st["ox"] += 1

    si, left = 0, SCRIPT[0][0]
    pact, pt, pdone, tick = SCRIPT[0][1], 0, 0, 0
    for _ in range(TICKS):
        hist[tick & 31] = pact
        if pact == FWD and st["ox"] - st["px"] > BODY_W:
            st["px"] += 1
        if pact == BACK and st["px"] > X_MIN:
            st["px"] -= 1
        # opponent_step
        seen = hist[((tick - delay) & 0xFF) & 31]
        d = st["ox"] - st["px"]
        band = 0 if d < NEAR else (1 if d < FAR else 2)
        if st["ot"] >= st["olen"]:
            done = False
            if st["follow"]:
                st["follow"] = 0
                if seen == GUARD:
                    start(ATTACK, ATK_LEN)
                    c[4] += 1
                    done = True
            if not done:
                r = rnd()
                row = ROW[seen][band]
                if r < row[0]:
                    start(ATTACK, ATK_LEN); c[0] += 1
                elif r < row[1]:
                    start(GUARD, GUARD_LEN); c[1] += 1
                elif r < row[2]:
                    start(FEINT, FEINT_LEN); c[2] += 1; st["follow"] = 1
                else:
                    st["odir"] = -1 if d > PREF else (1 if d < PREF else 0)
                    start(FWD, STEP_LEN); c[3] += 1
        if st["oact"] == FWD:
            nx = st["ox"] + st["odir"]
            if nx - st["px"] >= BODY_W and nx <= X_MAX:
                st["ox"] = nx
        # resolve
        px, ox = st["px"], st["ox"]
        if pact == ATTACK and not pdone and WINDUP <= pt < WINDUP + ACTIVE:
            l = px + BODY_W; r = l + REACH
            if l < ox + BODY_W and ox < r:
                pdone = 1
                if st["oact"] == GUARD:
                    c[6] += 1; push(PUSH_BLK)
                else:
                    c[5] += 1; start(STUN, STUN_LEN); push(PUSH_HIT)
        px, ox = st["px"], st["ox"]
        if st["oact"] == ATTACK and not st["odone"] and WINDUP <= st["ot"] < WINDUP + ACTIVE:
            r = ox; l = r - REACH
            if l < px + BODY_W and px < r:
                st["odone"] = 1
                if pact == GUARD:
                    c[8] += 1; push(PUSH_BLK)
                else:
                    c[7] += 1; push(PUSH_HIT)
        st["ot"] = (st["ot"] + 1) & 0xFF
        pt = (pt + 1) & 0xFF
        tick = (tick + 1) & 0xFF
        left -= 1
        if left == 0:
            si = (si + 1) % 12
            left, pact = SCRIPT[si]
            pt, pdone = 0, 0
    return c


crc = 0
for lv, dl in enumerate(DELAY):
    c = bout(dl)
    print(lv, dl, c)
    for v in c:
        crc = (((crc ^ v) * 5) + 1) & 0xFFFF
print(f"{crc:04X}")
```

It prints the four counter rows in the order
attack, guard, feint, step, follow-up, `PHT`, `PBK`, `OHT`, `OBK`, and
`F036`.

## Why this works

The delay line is the reaction time. The player's action goes into
`hist[tick & 31]` every frame and the opponent reads
`hist[(tick - delay) & 31]`, so it answers what the player was doing
`delay` frames ago; at 20 frames an attack is over before the opponent
has seen it start, at 5 it can still guard. One table row per (seen
action, band) holds three thresholds; one LFSR byte against them picks
the action, so the tendencies are data and the choice is not
predictable. An action runs to its length before the next decision:
the opponent commits, as the player must. The step's direction comes
from comparing the distance with `PREF`, which is the range keeping.

The guard is a box swap. On a guard frame the opponent emits a guard
box where its body box would be, so a blade can meet one or the other,
never both, and the resolution is the group of the box it met: guard,
blocked, both pushed 3 pixels apart; body, a hit, a stun and 6 pixels.
`p_done` and `o_done` end a blade after its first contact, so one swing
resolves once. The test is on X only because both fighters stand on one
floor; with jumps or crouches it is `per_frame_hitbox`'s full box test.
