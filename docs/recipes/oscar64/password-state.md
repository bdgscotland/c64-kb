---
recipe: password-state
toolchain: oscar64
output_format: PRG
region: both
techniques: [password_encoding, world_state_bits]
file_formats: [PRG]
uses_registers: [DC04, DC05, DC0E, D011, D012]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Password State: level passwords with a checksum, and per-level world bits

## Synopsis

Packs a game state of 20 bits (level 0-31, lives 0-7, eight item flags,
four story flags) into a 6-character password and back. The state gets a
10-bit CRC, the 30 bits are permuted and XORed with a fixed key, and each
5 bits become one letter of a 32-letter alphabet that leaves out O, I, L
and 8; a player who types one of those gets 0, 1, 1 or B. The program
checks 4,096 states round trip, tries every single-character mistype of
16 passwords (2,976 strings) and expects the checksum to reject each one,
and saves and restores one bit per object for three levels across a
sequence of level changes. PASS or FAIL per check and the cycle cost of
each routine are on screen. It implements `password_encoding` and
`world_state_bits` (`techniques/logic.md`). The entry field for the
password is `text_input_line` (`techniques/text.md`), which hands over
PETSCII bytes, the form `pw_decode` takes.

## Source

```c
// password-state.c
// Level passwords and per-level world bits. A game state of 20 bits
// (level 5, lives 3, items 8, flags 4) gets a 10-bit CRC, a 30-bit
// permutation and a fixed XOR key, and is written as 6 characters from a
// 32-character alphabet with no O, I, L or 8. The self-checks: 4,096
// states round-trip; every single-character mistype of 16 sample
// passwords is rejected; typing O, I, L or 8 decodes the same state; one
// level's object bits survive a change of level. CIA1 timer A then
// measures each routine. PASS or FAIL per check, on screen.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)

// Expected values, computed by the Python model on the page.
#define EXPECT_SWEEP 0xD690          // fold over the 4,096 sweep passwords
static const char expect_area[10] = {0x98, 0x00, 0x08, 0x01, 0x10, 0x00, 0x01, 0x00, 0x00, 0x80};

// --- password: tables -------------------------------------------------------

// PETSCII of the 32 symbols, value 0 to 31: 0-7, 9, then A-Z without I, L, O.
static const char alpha[32] = {
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x39,
    0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x4A, 0x4B,
    0x4D, 0x4E, 0x50, 0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57,
    0x58, 0x59, 0x5A
};
static const char key[6] = {0x13, 0x05, 0x1C, 0x0A, 0x17, 0x0E};
static const char bitmask[8] = {0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80};

// Bit i of the 30-bit word goes to bit (7 * i) mod 30 of the password:
// symbol p / 5, bit p % 5. Filled once by init_tables.
static char perm_sym[30], perm_mask[30];
// PETSCII $30-$5A to symbol value; $FF is not a password letter.
static char dec_tab[43];

static void init_tables(void)
{
    for (char i = 0; i < 30; i++)
    {
        char p = (char)((7 * (unsigned)i) % 30);
        perm_sym[i] = p / 5;
        perm_mask[i] = bitmask[p % 5];
    }
    for (char i = 0; i < 43; i++) dec_tab[i] = 0xff;
    for (char v = 0; v < 32; v++) dec_tab[alpha[v] - 0x30] = v;
    dec_tab[0x4F - 0x30] = 0;        // O reads as 0
    dec_tab[0x49 - 0x30] = 1;        // I reads as 1
    dec_tab[0x4C - 0x30] = 1;        // L reads as 1
    dec_tab[0x38 - 0x30] = 10;       // 8 reads as B
}

struct State { char level, lives, items, flags; };

// CRC-10, polynomial $233, over the 20 state bits, top bit first.
static unsigned crc10(const char *w)
{
    unsigned c = 0;
    for (signed char i = 19; i >= 0; i--)
    {
        char in = (w[i >> 3] & bitmask[i & 7]) ? 1 : 0;
        char top = (c & 0x200) ? 1 : 0;
        c = (c << 1) & 0x3ff;
        if (in ^ top) c ^= 0x233;
    }
    return c;
}

// State to 6 PETSCII bytes.
__noinline void pw_encode(const struct State *s, char *out)
{
    char w[4];
    w[0] = (s->level & 31) | (s->lives << 5);
    w[1] = s->items;
    w[2] = s->flags & 15;
    w[3] = 0;
    unsigned c = crc10(w);           // bits 20-29 of the word
    w[2] |= (char)(c << 4);
    w[3] = (char)(c >> 4);
    char sym[6] = {0, 0, 0, 0, 0, 0};
    for (char i = 0; i < 30; i++)
        if (w[i >> 3] & bitmask[i & 7]) sym[perm_sym[i]] |= perm_mask[i];
    for (char k = 0; k < 6; k++) out[k] = alpha[sym[k] ^ key[k]];
}

// 6 PETSCII bytes to state. Returns 0 for a good password, 1 for a byte
// that is not a password letter, 2 for a checksum mismatch.
__noinline char pw_decode(const char *in, struct State *s)
{
    char sym[6];
    for (char k = 0; k < 6; k++)
    {
        char c = in[k] - 0x30;
        if (c >= 43 || dec_tab[c] == 0xff) return 1;
        sym[k] = dec_tab[c] ^ key[k];
    }
    char w[4] = {0, 0, 0, 0};
    for (char i = 0; i < 30; i++)
        if (sym[perm_sym[i]] & perm_mask[i]) w[i >> 3] |= bitmask[i & 7];
    unsigned c = (w[2] >> 4) | ((unsigned)w[3] << 4);
    w[2] &= 15;
    w[3] = 0;
    if (crc10(w) != c) return 2;
    s->level = w[0] & 31;
    s->lives = w[0] >> 5;
    s->items = w[1];
    s->flags = w[2];
    return 0;
}

// --- world bits --------------------------------------------------------------

#define LEVELS 3
static const char obj_count[LEVELS] = {20, 13, 40};
static char area_start[LEVELS + 1];      // byte offset of each level's bits
static char world_bits[10];              // all levels: 3 + 2 + 5 bytes
static char flag_bits[2];                // 16 global flags
static char obj_done[40];                // working copy for the current level
static char cur_level;

static void init_world(void)
{
    char o = 0;
    for (char l = 0; l < LEVELS; l++) { area_start[l] = o; o += (obj_count[l] + 7) >> 3; }
    area_start[LEVELS] = o;
    for (char i = 0; i < 10; i++) world_bits[i] = 0;   // new game: nothing done
    flag_bits[0] = flag_bits[1] = 0;
}

// Leaving a level: one bit per object, set when it is collected, opened or killed.
__noinline void level_leave(void)
{
    char *a = world_bits + area_start[cur_level];
    char n = obj_count[cur_level];
    for (char b = 0; b < ((n + 7) >> 3); b++) a[b] = 0;
    for (char i = 0; i < n; i++)
        if (obj_done[i]) a[i >> 3] |= bitmask[i & 7];
}

// Entering a level: rebuild the working copy from its bits.
__noinline void level_enter(char l)
{
    cur_level = l;
    const char *a = world_bits + area_start[l];
    char n = obj_count[l];
    for (char i = 0; i < n; i++)
        obj_done[i] = (a[i >> 3] & bitmask[i & 7]) ? 1 : 0;
}

static void flag_set(char f) { flag_bits[f >> 3] |= bitmask[f & 7]; }
static char flag_test(char f) { return (flag_bits[f >> 3] & bitmask[f & 7]) ? 1 : 0; }

// --- screen helpers ----------------------------------------------------------

static void put_text(char row, char col, const char *s)
{
    char *p = SCREEN + 40 * row + col;
    while (*s)
    {
        char c = *s++;
        if (c >= 'A' && c <= 'Z') c -= 64;    // upper case to screen code
        *p++ = c;
    }
}

// PETSCII password to screen codes: letters $41-$5A become $01-$1A.
static void put_pw(char row, char col, const char *pw)
{
    char *p = SCREEN + 40 * row + col;
    for (char k = 0; k < 6; k++) p[k] = pw[k] >= 0x41 ? pw[k] - 0x40 : pw[k];
}

static const char hexg[16] = {0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
                              0x38, 0x39, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06};
static void put_hex8(char row, char col, char v)
{
    char *p = SCREEN + 40 * row + col;
    p[0] = hexg[v >> 4]; p[1] = hexg[v & 15];
}
static void put_hex16(char row, char col, unsigned v)
{
    put_hex8(row, col, (char)(v >> 8)); put_hex8(row, col + 2, (char)v);
}
static void put_dec(char row, char col, unsigned v)
{
    char *p = SCREEN + 40 * row + col;
    char d[5];
    for (char i = 0; i < 5; i++) { d[4 - i] = 0x30 + v % 10; v /= 10; }
    char lead = 1;
    for (char i = 0; i < 5; i++)
    {
        if (d[i] != 0x30 || i == 4) lead = 0;
        p[i] = lead ? 0x20 : d[i];
    }
}
static void put_pass(char row, char col, char ok) { put_text(row, col, ok ? "PASS" : "FAIL"); }

static unsigned fold(unsigned chk, char v) { return (chk ^ v) * 5 + 1; }

// --- CIA1 timer A harness -----------------------------------------------------

static void t_start(void) { cia1.cra = 0x00; cia1.ta = 0xffff; cia1.cra = 0x11; }
static unsigned t_stop(void) { cia1.cra = 0x00; return 0xffff - cia1.ta; }
__noinline void null_call(void) {}

static struct State st, st2;
static char pw[6], pw2[6];

static void sweep_state(unsigned long i, struct State *s)
{
    unsigned long v = (i * 40503UL) & 0xfffffUL;     // odd multiplier: 4,096 distinct states
    s->level = (char)v & 31;
    s->lives = ((char)v >> 5) & 7;
    s->items = (char)(v >> 8);
    s->flags = (char)(v >> 16) & 15;
}

int main(void)
{
    __asm { sei }
    for (unsigned i = 0; i < 1000; i++) SCREEN[i] = 0x20;
    init_tables();
    init_world();

    put_text(0, 0, "PASSWORD STATE  20+10 BITS = 6 CHARS");
    put_text(1, 0, "ALPHABET");
    for (char v = 0; v < 32; v++)
    {
        char c = alpha[v];
        SCREEN[40 + 8 + v] = c >= 0x41 ? c - 0x40 : c;
    }

    // Samples: levels 0-3 with 3 lives, then everything set.
    put_text(2, 0, "LV LI IT FL PASSWORD");
    for (char r = 0; r < 5; r++)
    {
        if (r < 4) { st.level = r; st.lives = 3; st.items = 0; st.flags = 0; }
        else { st.level = 31; st.lives = 7; st.items = 0xff; st.flags = 15; }
        pw_encode(&st, pw);
        put_hex8(3 + r, 0, st.level); put_hex8(3 + r, 3, st.lives);
        put_hex8(3 + r, 6, st.items); put_hex8(3 + r, 9, st.flags);
        put_pw(3 + r, 12, pw);
    }

    // 1. Round trip over 4,096 states, and the fold over their passwords.
    unsigned chk = 0, rt_bad = 0, fold_bad = 0;
    for (unsigned long i = 0; i < 4096; i++)
    {
        sweep_state(i, &st);
        pw_encode(&st, pw);
        for (char k = 0; k < 6; k++) chk = fold(chk, pw[k]);
        if (pw_decode(pw, &st2) != 0 || st2.level != st.level || st2.lives != st.lives
            || st2.items != st.items || st2.flags != st.flags) rt_bad++;
        // The same password as a player might copy it: 0 as O, 1 as I, B as 8.
        for (char k = 0; k < 6; k++)
        {
            char c = pw[k];
            pw2[k] = c == 0x30 ? 0x4F : c == 0x31 ? ((k & 1) ? 0x49 : 0x4C) : c == 0x42 ? 0x38 : c;
        }
        if (pw_decode(pw2, &st2) != 0 || st2.level != st.level || st2.items != st.items || st2.lives != st.lives || st2.flags != st.flags) fold_bad++;
    }
    put_text(9, 0, "ROUND TRIP 4096 CHK      EXP");
    put_hex16(9, 20, chk); put_hex16(9, 29, EXPECT_SWEEP);
    put_pass(9, 34, rt_bad == 0 && chk == EXPECT_SWEEP);
    put_text(10, 0, "O I L 8 READ AS 0 1 1 B");
    put_pass(10, 34, fold_bad == 0);

    // 2. Every single-character mistype of 16 sample passwords.
    unsigned tried = 0, caught = 0;
    for (unsigned long i = 0; i < 16; i++)
    {
        sweep_state(i * 256 + 7, &st);
        pw_encode(&st, pw);
        for (char pos = 0; pos < 6; pos++)
            for (char v = 0; v < 32; v++)
            {
                if (alpha[v] == pw[pos]) continue;
                for (char k = 0; k < 6; k++) pw2[k] = pw[k];
                pw2[pos] = alpha[v];
                tried++;
                if (pw_decode(pw2, &st2) == 2) caught++;
            }
    }
    put_text(11, 0, "MISTYPES       CAUGHT");
    put_dec(11, 9, tried); put_dec(11, 22, caught);
    put_pass(11, 34, tried == 2976 && caught == tried);

    // 3. World bits across level changes.
    char wb_ok = 1;
    level_enter(0); obj_done[3] = obj_done[7] = obj_done[19] = 1; level_leave();
    level_enter(1); obj_done[0] = obj_done[12] = 1; level_leave();
    level_enter(2); obj_done[8] = obj_done[39] = 1; level_leave();
    flag_set(5);
    level_enter(0);
    for (char i = 0; i < 20; i++)
        if (obj_done[i] != (i == 3 || i == 7 || i == 19)) wb_ok = 0;
    obj_done[4] = 1; level_leave();                    // one more on the second visit
    level_enter(1);
    for (char i = 0; i < 13; i++)
        if (obj_done[i] != (i == 0 || i == 12)) wb_ok = 0;
    level_leave();
    if (!flag_test(5) || flag_test(4)) wb_ok = 0;
    put_text(13, 0, "WORLD BITS");
    for (char i = 0; i < 10; i++)
    {
        put_hex8(13, 11 + 2 * i, world_bits[i]);
        if (world_bits[i] != expect_area[i]) wb_ok = 0;
    }
    put_text(14, 0, "FLAGS");
    put_hex8(14, 11, flag_bits[0]); put_hex8(14, 13, flag_bits[1]);
    put_text(15, 0, "RESTORED ON RE-ENTRY");
    put_pass(15, 34, wb_ok);

    // 4. Cycle costs, display off, from the start of a frame.
    vic.ctrl1 &= ~0x10;
    while (vic.raster != 0x80) ;
    while (vic.raster != 0x00) ;
    unsigned c_null, c_enc, c_dec, c_crc, c_let, c_leave, c_enter;
    st.level = 31; st.lives = 7; st.items = 0xff; st.flags = 15;
    t_start(); null_call(); c_null = t_stop();
    t_start(); pw_encode(&st, pw); c_enc = t_stop();
    t_start(); pw_decode(pw, &st2); c_dec = t_stop();
    for (char k = 0; k < 6; k++) pw2[k] = pw[k];
    pw2[5] = pw[5] == 0x5A ? 0x59 : 0x5A;
    t_start(); pw_decode(pw2, &st2); c_crc = t_stop();
    pw2[0] = 0x21;                   // '!' is not a password letter
    t_start(); pw_decode(pw2, &st2); c_let = t_stop();
    level_enter(2);
    for (char i = 0; i < 40; i++) obj_done[i] = 1;
    t_start(); level_leave(); c_leave = t_stop();
    t_start(); level_enter(2); c_enter = t_stop();
    vic.ctrl1 |= 0x10;

    put_text(17, 0, "CYCLES, BODY ONLY (CIA1 TIMER A)");
    put_text(18, 0, "ENCODE"); put_dec(18, 18, c_enc - c_null);
    put_text(19, 0, "DECODE GOOD"); put_dec(19, 18, c_dec - c_null);
    put_text(20, 0, "DECODE BAD CRC"); put_dec(20, 18, c_crc - c_null);
    put_text(21, 0, "DECODE BAD LETTER"); put_dec(21, 18, c_let - c_null);
    put_text(22, 0, "LEVEL LEAVE 40 OBJ"); put_dec(22, 18, c_leave - c_null);
    put_text(23, 0, "LEVEL ENTER 40 OBJ"); put_dec(23, 18, c_enter - c_null);
    put_text(24, 0, "NULL CALL"); put_dec(24, 18, c_null);

    for (;;) ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=password-state.prg password-state.c
```

Then run headless (PAL; add `-model ntsc` for NTSC):

```bash
timeout 180 x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 80000000 -exitscreenshot password-state.png -autostart password-state.prg
```

The checks finish between 66,000,000 and 67,000,000 cycles on PAL and
NTSC: a run cut at 66,000,000 shows no cycle table, and from 67,000,000 on
the shot is identical to the pinned one (VICE x64sc 3.10). The pin is
80,000,000.

## Expected output

`screenshots/password-state.png` (PAL) and
`screenshots/password-state-ntsc.png` (NTSC), both read cell by cell
against the character ROM. The two decode to the same text:

```text
PASSWORD STATE  20+10 BITS = 6 CHARS
ALPHABET012345679ABCDEFGHJKMNPQRSTUVWXYZ
LV LI IT FL PASSWORD
00 03 00 00 3NSBRC
01 03 00 00 2NS2YF
02 03 00 00 RHS2YC
03 03 00 00 QHSBRF
1F 07 FF 0F SU3PAH

ROUND TRIP 4096 CHK D690 EXP D690 PASS
O I L 8 READ AS 0 1 1 B           PASS
MISTYPES  2976 CAUGHT  2976       PASS

WORLD BITS 98000801100001000080
FLAGS      2000
RESTORED ON RE-ENTRY              PASS

CYCLES, BODY ONLY (CIA1 TIMER A)
ENCODE             3639
DECODE GOOD        3737
DECODE BAD CRC     3702
DECODE BAD LETTER     8
LEVEL LEAVE 40 OBJ 2224
LEVEL ENTER 40 OBJ 2102
NULL CALL            35
```

This Python model of the encoder gives the same sample passwords, the
same fold over the 4,096 sweep passwords (`D690`) and no missed
single-character error:

```python
ALPHA = "012345679ABCDEFGHJKMNPQRSTUVWXYZ"      # value 0..31
KEY = [0x13, 0x05, 0x1C, 0x0A, 0x17, 0x0E]
PERM = [(7 * i) % 30 for i in range(30)]      # word bit i -> password bit PERM[i]

def crc10(d):                                 # polynomial $233, top bit first
    c = 0
    for i in range(19, -1, -1):
        fb = ((d >> i) & 1) ^ ((c >> 9) & 1)
        c = (c << 1) & 0x3ff
        if fb: c ^= 0x233
    return c

def encode(d):                                # d = level | lives<<5 | items<<8 | flags<<16
    w = d | crc10(d) << 20
    p = sum(1 << PERM[i] for i in range(30) if (w >> i) & 1)
    return ''.join(ALPHA[((p >> 5 * k) & 31) ^ KEY[k]] for k in range(6))

FOLD = {'O': '0', 'I': '1', 'L': '1', '8': 'B'}
def decode(pw):                               # state, or None for a bad password
    p = 0
    for k, ch in enumerate(pw):
        ch = FOLD.get(ch, ch)
        if ch not in ALPHA: return None
        p |= (ALPHA.index(ch) ^ KEY[k]) << 5 * k
    w = sum(1 << i for i in range(30) if (p >> PERM[i]) & 1)
    d = w & 0xfffff
    return d if crc10(d) == w >> 20 else None

def fold(chk, v): return ((chk ^ v) * 5 + 1) & 0xffff
chk = 0
for i in range(4096):
    d = (i * 40503) & 0xfffff
    assert decode(encode(d)) == d
    for b in encode(d).encode('ascii'): chk = fold(chk, b)
print(hex(chk))                               # 0xd690
for lv in range(4): print(encode(lv | 3 << 5))   # 3NSBRC 2NS2YF RHS2YC QHSBRF
print(encode(0xfffff))                        # SU3PAH

missed = 0                                    # every single-character error
for pos in range(6):
    for v in range(1, 32):
        q = list(encode(0))
        q[pos] = ALPHA[ALPHA.index(q[pos]) ^ v]
        missed += decode(''.join(q)) is not None
print(missed)                                 # 0
```

The world-bits line is the ten bytes of all three levels' areas: level 0
(20 objects, 3 bytes) with objects 3, 4, 7 and 19 done, level 1 (13
objects, 2 bytes) with 0 and 12, level 2 (40 objects, 5 bytes) with 8
and 39. `FLAGS 2000` is global flag 5 set. The cycle figures are CIA1
timer A after each call less the 35 cycles of the same sequence around
an empty function, identical on PAL and NTSC (rung 1, VICE x64sc 3.10).
Encode and decode were timed on state `1F 07 FF 0F`, all data bits set;
their loops test each bit, so a state with fewer set bits costs a few
cycles less. The level timings are the 40-object level with every object
done. A bad letter returns at the first byte, so its 8 cycles are the
test of one byte.

## Why this works

`pw_encode` builds the 30-bit word in four bytes: level and lives in the
first, items in the second, flags in the low nibble of the third and the
CRC in the 10 bits above them. The permutation sends word bit i to
password bit (7 × i) mod 30; 7 and 30 share no factor, so every bit has
its own place. The key XOR stops the all-zero state from printing as
`000000`. Every step is linear over bits except the key, so a mistyped
letter changes the decoded word by a pattern that does not depend on
the state: the 186 mistypes of one password stand for every password,
and the Python loop over those 186 is a proof for all 2^20 states, not a
sample. The C program repeats it on 16 passwords to show the 6502 code
agrees.

`pw_decode` checks the letters before any arithmetic. `dec_tab` covers
PETSCII `$30` to `$5A`; a byte below `$30` wraps past 43 as an unsigned
char and is refused with the rest. The table maps O, I, L and 8 to the
values of 0, 1, 1 and B, so the four look-alikes the alphabet leaves out
are read as the letter a player most likely meant. The return code tells
a bad letter (1) from a checksum failure (2), so the prompt can say
which.

The password leaves the encoder as PETSCII, because that is what the
keyboard delivers and what a compare against typed input needs. `put_pw`
converts it to screen codes for display: letters `$41` to `$5A` become
`$01` to `$1A`, digits keep their value. Storing the PETSCII bytes
straight into `$0400` would show graphics characters where the letters
should be (`pitfalls/text-mode-render.md`,
`petscii_written_to_screen_ram`).

`level_leave` clears the level's area and sets one bit per object whose
`obj_done` byte is set; `level_enter` rebuilds the bytes from the bits.
`area_start` holds each level's byte offset, worked out once from the
object counts, so levels of different sizes share one packed array and a
save writes it whole. The C loops cost about 55 cycles an object; they
are an upper reference, not a target.
