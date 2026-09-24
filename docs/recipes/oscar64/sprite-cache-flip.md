---
recipe: sprite-cache-flip
toolchain: oscar64
output_format: PRG
region: both
techniques: [sprite_cache_flip]
file_formats: [PRG]
uses_registers: [D000, D001, D002, D003, D004, D005, D006, D007, D008, D009, D00A, D00B, D00C, D00D, D00E, D00F, D010, D011, D015, D01C, D020, D021, D025, D026, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 sprite cache: packed frames depacked and mirrored on demand

## Synopsis

The `sprite_cache_flip` technique in C. Five multicolour frames are
stored once, facing right and packed: a 21-bit mask of the rows that are
not empty, then 3 bytes for each such row. A request for a frame and a
facing returns a sprite pointer. On a miss the frame is depacked into the
next of 8 cache slots, round-robin, mirrored on the way when it faces
left through a table that keeps each bit pair whole; the key the slot
held is cleared from `slot_of`. The program fills the cache, lets a ninth
key evict slot 0 and checks the old key misses again; then it shows
frames 0 to 3 facing right (sprites 0 to 3) and left (sprites 4 to 7)
from a fresh cache, and checks each slot pair by pair against the frame
built another way. CIA1 timer B times a miss facing each way for a full
and a sparse frame, and a hit. `$02FF` = `01` and a green border on a
pass, `02` and red otherwise (`headless-verify.md`). The KickAssembler
version, `kickassembler/sprite-cache-flip`, has the hires table as well
and carries the technique's Cost line.

## Source

```c
// sprite-cache-flip.c
//
// A sprite cache in C: frames stored once, facing right and packed (a
// 21-bit mask of the rows that are not empty, then 3 bytes per such
// row), outside the VIC bank's sprite area, and depacked into one of 8
// cache slots only when requested, mirrored on the way when the frame
// faces left. The multicolour mirror table keeps each bit pair whole.
// slot_of[key] and key_of[slot] map both ways, key = frame * 2 + facing;
// a miss takes the next slot round-robin and clears the key that slot
// held. Rows 2-4: the eviction test and the mirror check. Rows 6-10:
// CIA1 timer B cycles for a miss facing each way, full and sparse
// frames, and a hit. Sprites 0-3 show frames 0-3 facing right, sprites
// 4-7 the same frames facing left from the cache. $02FF = 01 and a green
// border on a pass, 02 and red otherwise.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define Cache   ((char *)0x3000)            // 8 slots, blocks 192..199
#define MFLIP   ((char *)0x3400)            // page-aligned mirror table
#define SPR_BLK 192
#define VR      ((volatile char *)0xd000)
#define PTR     ((volatile char *)0x07f8)
#define RESULT  (*(volatile char *)0x02ff)

#define FRAMES  5
#define SLOTS   8
#define NONE    0xff

// Packed frames: 3 mask bytes, then 3 bytes for each row in the mask.
char packed[FRAMES][3 + 63];

// --- the cache ----------------------------------------------------------------
char slot_of[FRAMES * 2], key_of[SLOTS], next_slot;

void cache_reset(void)
{
    for (char k = 0; k < FRAMES * 2; k++)
        slot_of[k] = NONE;
    for (char s = 0; s < SLOTS; s++)
        key_of[s] = NONE;
    next_slot = 0;
}

// Depack one frame into a slot; mirrored rows go through the table with
// their bytes swapped.
void depack(const char *p, char *d, char left)
{
    char m0 = p[0], m1 = p[1], m2 = p[2];
    const char *s = p + 3;
    for (char r = 0; r < 21; r++) {
        if (m0 & 1) {
            if (left) {
                d[0] = MFLIP[s[2]];
                d[1] = MFLIP[s[1]];
                d[2] = MFLIP[s[0]];
            } else {
                d[0] = s[0];
                d[1] = s[1];
                d[2] = s[2];
            }
            s += 3;
        } else {
            d[0] = 0;
            d[1] = 0;
            d[2] = 0;
        }
        d += 3;
        m0 = (m0 >> 1) | (m1 << 7);         // next row's bit into bit 0
        m1 = (m1 >> 1) | (m2 << 7);
        m2 >>= 1;
    }
}

// The sprite pointer for a frame facing one way; depacks on a miss.
char request(char frame, char left)
{
    char key = frame * 2 + left;
    char s = slot_of[key];
    if (s != NONE)
        return SPR_BLK + s;
    s = next_slot;
    next_slot = (s + 1) & (SLOTS - 1);
    char old = key_of[s];
    if (old != NONE)
        slot_of[old] = NONE;                // the classic bug is to forget this
    key_of[s] = key;
    slot_of[key] = s;
    depack(packed[frame], Cache + s * 64, left);
    return SPR_BLK + s;
}

// --- the table -------------------------------------------------------------------
void mflip_build(void)
{
    char i = 0;
    do {
        MFLIP[i] = (i << 6) | ((i << 2) & 0x30) | ((i >> 2) & 0x0c) | (i >> 6);
        i++;
    } while (i != 0);
}

// --- frames: multicolour shapes, packed ---------------------------------------
// Frame 1 has rows 0-2 and 18-20 empty: 15 of 21 rows present.
char row_byte(char f, char r, char k)
{
    if (f == 1 && (r < 3 || r > 17))
        return 0;
    char v = 0;
    for (char q = 0; q < 4; q++) {
        char c = k * 4 + q, pr = 0;
        if (c <= (r + f * 5) % 12)
            pr = 1 + (c + r / 3 + f) % 3;
        v = (v << 2) | pr;
    }
    return v;
}

void make_frames(void)
{
    for (char f = 0; f < FRAMES; f++) {
        char *p = packed[f], *s = p + 3;
        p[0] = p[1] = p[2] = 0;
        for (char r = 0; r < 21; r++) {
            char a = row_byte(f, r, 0), b = row_byte(f, r, 1), c = row_byte(f, r, 2);
            if (a | b | c) {
                p[r >> 3] |= 1 << (r & 7);
                s[0] = a;
                s[1] = b;
                s[2] = c;
                s += 3;
            }
        }
    }
}

// --- checks ------------------------------------------------------------------------
char pair_at(const char *blk, char r, char c)
{
    char b = blk[r * 3 + (c >> 2)];
    return (b >> (6 - 2 * (c & 3))) & 3;
}

// A slot against the frame built another way: row_byte read directly,
// pair by pair, backwards when mirrored.
unsigned slot_errors(char slot, char f, char left)
{
    unsigned e = 0;
    const char *d = Cache + slot * 64;
    for (char r = 0; r < 21; r++) {
        char src[3];
        src[0] = row_byte(f, r, 0);
        src[1] = row_byte(f, r, 1);
        src[2] = row_byte(f, r, 2);
        for (char c = 0; c < 12; c++) {
            char a = (src[c >> 2] >> (6 - 2 * (c & 3))) & 3;
            if (pair_at(d, r, left ? 11 - c : c) != a)
                e++;
        }
    }
    return e;
}

// --- CIA1 timer B ------------------------------------------------------------
static inline void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;
}

static inline unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

char arg_f, arg_l;
__noinline void nothing(void) { }
__noinline void one_request(void) { request(arg_f, arg_l); }

unsigned time_req(char f, char l)
{
    arg_f = f;
    arg_l = l;
    __asm { sei }
    timer_start();
    one_request();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

unsigned time_none(void)
{
    __asm { sei }
    timer_start();
    nothing();
    unsigned t = timer_stop();
    __asm { cli }
    return t;
}

// --- text (screen codes) -----------------------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

void put_dec(char *p, unsigned v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + v % 10;
        v /= 10;
    }
}

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }
    mflip_build();
    make_frames();

    // Cycles, screen blanked, one request less an empty call.
    vic.ctrl1 &= ~VIC_CTRL1_DEN;
    vic_waitFrame();
    unsigned t0 = time_none();
    cache_reset();
    unsigned t_mr = time_req(0, 0) - t0;    // miss, 21 rows, right
    unsigned t_ml = time_req(0, 1) - t0;    // miss, 21 rows, left
    unsigned t_sr = time_req(1, 0) - t0;    // miss, 15 rows, right
    unsigned t_sl = time_req(1, 1) - t0;    // miss, 15 rows, left
    unsigned t_hit = time_req(0, 1) - t0;   // hit
    vic.ctrl1 |= VIC_CTRL1_DEN;

    // Eviction: fill all 8 slots, then a ninth key takes slot 0 and the
    // key slot 0 held must miss again.
    char fault = 0;
    cache_reset();
    for (char f = 0; f < 4; f++) {
        request(f, 0);
        request(f, 1);
    }
    char s9 = request(4, 0) - SPR_BLK;
    char evicted_ok = s9 == 0 && slot_of[0] == NONE && key_of[0] == 8;
    char refill = request(0, 0) - SPR_BLK;  // misses: takes slot 1
    char refill_ok = refill == 1 && slot_of[1] == NONE && slot_of[0] == 1;
    if (!evicted_ok || !refill_ok)
        fault = 1;

    // The display: frames 0-3 facing right, then left, from a fresh cache.
    cache_reset();
    for (char f = 0; f < 4; f++) {
        PTR[f] = request(f, 0);
        PTR[4 + f] = request(f, 1);
    }
    unsigned errs = 0;
    for (char f = 0; f < 4; f++) {
        errs += slot_errors(PTR[f] - SPR_BLK, f, 0);
        errs += slot_errors(PTR[4 + f] - SPR_BLK, f, 1);
    }
    if (errs)
        fault = 2;

    for (char s = 0; s < 8; s++) {
        VR[s * 2] = 40 + (s & 3) * 40;
        VR[s * 2 + 1] = s < 4 ? 150 : 180;
        vic.spr_color[s] = VCOL_RED;        // pair 10
    }
    VR[0x10] = 0;
    vic.spr_multi = 0xff;
    vic.spr_mcolor0 = VCOL_WHITE;           // pair 01
    vic.spr_mcolor1 = VCOL_YELLOW;          // pair 11
    vic.spr_enable = 0xff;

    put_str(Screen + 0,       s"sprite cache flip");
    put_str(Screen + 2 * 40,  s"ninth key slot   old key cleared");
    Screen[2 * 40 + 15] = 0x30 + s9;
    put_str(Screen + 2 * 40 + 33, evicted_ok ? s"yes" : s"no ");
    put_str(Screen + 3 * 40,  s"refill slot   ok");
    Screen[3 * 40 + 12] = 0x30 + refill;
    put_str(Screen + 3 * 40 + 17, refill_ok ? s"yes" : s"no ");
    put_str(Screen + 4 * 40,  s"slots checked 8 pair errors");
    put_dec(Screen + 4 * 40 + 28, errs, 5);
    put_str(Screen + 6 * 40,  s"miss 21 rows right");
    put_dec(Screen + 6 * 40 + 22, t_mr, 5);
    put_str(Screen + 7 * 40,  s"miss 21 rows left");
    put_dec(Screen + 7 * 40 + 22, t_ml, 5);
    put_str(Screen + 8 * 40,  s"miss 15 rows right");
    put_dec(Screen + 8 * 40 + 22, t_sr, 5);
    put_str(Screen + 9 * 40,  s"miss 15 rows left");
    put_dec(Screen + 9 * 40 + 22, t_sl, 5);
    put_str(Screen + 10 * 40, s"hit");
    put_dec(Screen + 10 * 40 + 22, t_hit, 5);

    RESULT = fault ? 2 : 1;
    vic.color_border = fault ? 2 : 5;
    put_str(Screen + 40, fault ? s"result fail" : s"result pass");
    Screen[40 + 12] = 0x30 + fault;

    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=sprite-cache-flip.prg sprite-cache-flip.c
```

Produces `sprite-cache-flip.prg`, 2,642 bytes. The cache is at `$3000`,
blocks 192 to 199, and the table at `$3400`, page aligned; the packed
frames are in the program's data, outside the cache. Then run headless
in VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 6000000 \
  -exitscreenshot sprite-cache-flip.png -autostart sprite-cache-flip.prg
```

Add `-model ntsc` for the NTSC picture.

## Expected output

Measured in VICE x64sc 3.10 with the pinned command, text decoded
against the character ROM (rows 0 to 10, PAL):

```text
SPRITE CACHE FLIP
RESULT PASS 0
NINTH KEY SLOT 0 OLD KEY CLEARED YES
REFILL SLOT 1 OK YES
SLOTS CHECKED 8 PAIR ERRORS 00000

MISS 21 ROWS RIGHT    03692
MISS 21 ROWS LEFT     03902
MISS 15 ROWS RIGHT    03344
MISS 15 ROWS LEFT     03494
HIT                   00042
```

NTSC reads the same. The border is palette index 5, (98, 213, 50) on
PAL and (114, 189, 103) on NTSC.

What the numbers say:

- `NINTH KEY SLOT 0 OLD KEY CLEARED YES`: with frames 0 to 3 cached both
  ways, all 8 slots are full; frame 4 took slot 0 and `slot_of` no
  longer points frame 0 (right) at it. `REFILL SLOT 1 OK YES`: asking
  for frame 0 again missed, took slot 1 and cleared the key slot 1 held.
- `PAIR ERRORS 00000`: every pair of the eight displayed slots equals the
  frame built directly, read backwards for the left-facing ones.
- The cycles are one request through a wrapper, less an empty call,
  CIA1 timer B, interrupts masked, screen blanked, the same on PAL and
  NTSC. A miss is 3,692 cycles for a full frame facing right and 3,902
  facing left: mirroring costs 210 cycles, 10 a row. A frame with 15 of
  21 rows present is 3,344 and 3,494. A hit is 42. These are compiled C;
  the KickAssembler recipe's hand-written loop does the same misses in
  2,441 and 2,672 and a hit in 20 (`docs/techniques/sprite.md`,
  `sprite_cache_flip`, "Cycle budget").

The pictures: `screenshots/sprite-cache-flip.png` (PAL) and
`screenshots/sprite-cache-flip-ntsc.png` (NTSC). Sprite f is at X
40 + 40f, the right-facing row at Y 150 (lines 151 to 171) and the
left-facing row at Y 180 (lines 181 to 201). Measured with PIL on both
models: all 2,016 pixels of the four right-facing sprites have the
colour a Python model of the frames gives them (pair 01 white, 10 red,
11 yellow, 00 background), and every pixel of each left-facing sprite
equals the right-facing pixel at the mirrored column, 0 mismatches of
2,016. The column either side of each sprite and the line above and
below are background, 720 of 720.

## Why this works

A sprite pointer names a 64-byte block, and the VIC reads the block
each line the sprite is shown, so a frame only has to be in the bank
while it is on screen. The cache keeps the frames that are in use in 8
slots and the rest packed elsewhere; `slot_of[key]` answers "is it
here" in one lookup and `key_of[slot]` says what to forget when a slot
is reused. Forgetting it is the classic bug: `slot_of` would still point
the old key at a slot that now holds another frame, and the eviction
check would fail. Round-robin is safe here because no more frames are on
screen than slots; a game must skip slots in use this frame and the last
(`sprite_cache_flip`, "Eviction").

Depacking and mirroring are one pass. A present row is three loads and
three stores, through `MFLIP` with the bytes swapped when the frame
faces left; an empty row is three stores of zero. The table reverses the
four bit pairs of a byte and keeps each pair's own bits, so pairs 01
and 10 keep their colours; a table that reverses all 8 bits would swap
them. Request frames in the main loop before the frame is built, never
in a raster IRQ: a miss here is 3,902 cycles, 62 PAL lines.

Verified: compiled with Oscar64, run headless in VICE x64sc 3.10 with
the pinned command on PAL and NTSC; the text was decoded against the
character ROM and every sprite pixel located by colour with PIL, not by
eye.
