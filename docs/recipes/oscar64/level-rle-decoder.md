---
recipe: level-rle-decoder
toolchain: oscar64
output_format: PRG
region: both
techniques: [tile_map_render]
file_formats: [PRG]
uses_registers: [D011, D020, D021, DC06, DC07, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Level RLE Decoder: three rooms compressed on the host, decoded and measured on the machine

## Synopsis

Puts numbers on the claim that run-length coding is enough for a tile
level. Three 40 x 22 rooms are authored as tile arrays in a Python script
(a platform room, a maze, a sparse room), run-length encoded on the host
with the stream format of `tile-map-render.md` (run byte `0x80 | n`,
literal count, `0` at the end of each row), and compiled in as byte arrays.
On the machine each room is decoded into RAM twice, once by a C decoder
and once by the same decoder written by hand in `__asm`, and each decode
is checksummed against the value the host computed from the source arrays
and timed with CIA1 timer B. Rows 0 to 2 print one line per room: packed
bytes, ratio, C cycles, hand-written cycles, PASS or FAIL. Row 0 also
carries the verdict code, which is mirrored to `$02FF` and the border
colour in the manner of `headless-verify.md`. Rows 3 to 24 draw the
decoded platform room. The decoders' code sizes come from the `.map` file
Oscar64 writes next to the `.prg`. This is the decode half of the
`tile_map_render` technique in `docs/techniques/scroll.md`; the figures
replace the unmeasured ratio and decoder-size sentences that
`docs/game-design/game-design-patterns.md` used to carry.

## Source

```c
// level-rle-decoder.c
//
// Decodes three RLE-compressed 40 x 22 rooms into RAM, checksums each
// against a value computed on the host from the source tile arrays,
// and measures the decode cost with CIA1 timer B. Rows 0-2 print one
// line per room: packed bytes, ratio, cycles, PASS or FAIL. Row 0 also
// carries the overall RESULT code, which is mirrored to $02FF and the
// border colour. Rows 3-24 draw the decoded platform room.
//
// Stream format (the tile-map-render format): control byte c
//   c & 0x80 : run, the next byte repeated (c & 0x7f) times
//   c < 0x80 : c literal bytes follow
//   0x00     : end of row
// Each of the 22 rows is its own stream; a run never crosses a row.
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen ((char *)0x0400)
#define Color  ((char *)0xd800)

#define ROOM_W  40
#define ROOM_H  22
#define ROOM_SIZE (ROOM_W * ROOM_H)

#define RESULT     (*(volatile char *)0x02ff)
#define CODE_PASS  0x01
#define CODE_FAIL  0x02

// --- compressed rooms, emitted by rle_rooms.py ------------------------
// platform: 880 bytes -> 213 bytes, ratio 4.13, checksum 0xce8a
const char rle_platform[] = {
    0xa8, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x05, 0x01, 0x00, 0x00, 0x04, 0x04, 0xa2, 0x00, 0x01, 0x01, 0x00, 0x02, 0x01, 0x00,
    0x86, 0x02, 0x9d, 0x00, 0x03, 0x06, 0x00, 0x01, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x88, 0x02, 0x05, 0x00, 0x00, 0x05, 0x05, 0x01, 0x00, 0x01, 0x01,
    0xa4, 0x00, 0x03, 0x05, 0x05, 0x01, 0x00, 0x01, 0x01, 0x8c, 0x00, 0x85, 0x02, 0x93, 0x00, 0x03, 0x05, 0x05, 0x01, 0x00, 0x01, 0x01, 0x9e, 0x00,
    0x88, 0x05, 0x01, 0x01, 0x00, 0x01, 0x01, 0x85, 0x00, 0x88, 0x03, 0x99, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x05,
    0x01, 0x00, 0x00, 0x05, 0x05, 0x8d, 0x00, 0x87, 0x02, 0x8e, 0x00, 0x01, 0x01, 0x00, 0x05, 0x01, 0x00, 0x00, 0x05, 0x05, 0xa2, 0x00, 0x01, 0x01,
    0x00, 0x05, 0x01, 0x00, 0x00, 0x05, 0x05, 0x86, 0x00, 0x02, 0x04, 0x04, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x99, 0x02, 0x8d, 0x00, 0x01,
    0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x89, 0x02, 0x01, 0x01,
    0x00, 0x01, 0x01, 0x8a, 0x00, 0x86, 0x02, 0x96, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x04, 0x01, 0x00, 0x04, 0x04,
    0x92, 0x00, 0x8c, 0x03, 0x85, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x91, 0x02, 0x84, 0x00, 0x92, 0x01, 0x00, 0xa8, 0x01, 0x00,
};
// maze: 880 bytes -> 629 bytes, ratio 1.40, checksum 0xf439
const char rle_maze[] = {
    0xa8, 0x01, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x87, 0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01,
    0x01, 0x8a, 0x00, 0x01, 0x01, 0x00, 0x06, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x85, 0x01, 0x03, 0x00, 0x01, 0x00, 0x83, 0x01, 0x03, 0x00, 0x01,
    0x00, 0x83, 0x01, 0x07, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x88, 0x01, 0x02, 0x00, 0x01, 0x00, 0x03, 0x01, 0x00, 0x01, 0x83, 0x00, 0x01,
    0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00, 0x05, 0x01, 0x00, 0x01, 0x00,
    0x01, 0x86, 0x00, 0x03, 0x01, 0x00, 0x01, 0x00, 0x02, 0x01, 0x00, 0x85, 0x01, 0x03, 0x00, 0x01, 0x00, 0x85, 0x01, 0x01, 0x00, 0x85, 0x01, 0x01,
    0x00, 0x85, 0x01, 0x05, 0x00, 0x01, 0x00, 0x01, 0x00, 0x84, 0x01, 0x04, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x01, 0x87, 0x00, 0x01, 0x01, 0x87,
    0x00, 0x01, 0x01, 0x89, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x84, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x00, 0x02, 0x01, 0x00, 0x89,
    0x01, 0x01, 0x00, 0x83, 0x01, 0x03, 0x00, 0x01, 0x00, 0x87, 0x01, 0x01, 0x00, 0x85, 0x01, 0x04, 0x00, 0x01, 0x01, 0x00, 0x83, 0x01, 0x02, 0x00,
    0x01, 0x00, 0x03, 0x01, 0x00, 0x01, 0x87, 0x00, 0x03, 0x01, 0x00, 0x01, 0x83, 0x00, 0x03, 0x01, 0x00, 0x01, 0x85, 0x00, 0x01, 0x01, 0x85, 0x00,
    0x04, 0x01, 0x00, 0x00, 0x01, 0x83, 0x00, 0x03, 0x01, 0x00, 0x01, 0x00, 0x04, 0x01, 0x00, 0x01, 0x00, 0x85, 0x01, 0x05, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x83, 0x01, 0x03, 0x00, 0x01, 0x00, 0x83, 0x01, 0x01, 0x00, 0x85, 0x01, 0x04, 0x00, 0x01, 0x01, 0x00, 0x83, 0x01, 0x04, 0x00, 0x01, 0x00,
    0x01, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00, 0x03, 0x01, 0x00, 0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00,
    0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x84, 0x00, 0x01, 0x01, 0x83, 0x00, 0x03, 0x01, 0x00, 0x01, 0x00, 0x83, 0x01, 0x05, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x85, 0x01, 0x03, 0x00, 0x01, 0x00, 0x85, 0x01, 0x01, 0x00, 0x85, 0x01, 0x01, 0x00, 0x86, 0x01, 0x06, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x83, 0x00, 0x03, 0x01, 0x00, 0x01, 0x87, 0x00, 0x01, 0x01, 0x87, 0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x86, 0x00, 0x01,
    0x01, 0x83, 0x00, 0x01, 0x01, 0x00, 0x02, 0x01, 0x00, 0x83, 0x01, 0x01, 0x00, 0x89, 0x01, 0x01, 0x00, 0x87, 0x01, 0x01, 0x00, 0x83, 0x01, 0x03,
    0x00, 0x01, 0x00, 0x88, 0x01, 0x02, 0x00, 0x01, 0x00, 0x03, 0x01, 0x00, 0x01, 0x83, 0x00, 0x01, 0x01, 0x87, 0x00, 0x03, 0x01, 0x00, 0x01, 0x85,
    0x00, 0x03, 0x01, 0x00, 0x01, 0x83, 0x00, 0x03, 0x01, 0x00, 0x01, 0x86, 0x00, 0x03, 0x01, 0x00, 0x01, 0x00, 0x04, 0x01, 0x00, 0x01, 0x00, 0x83,
    0x01, 0x01, 0x00, 0x85, 0x01, 0x05, 0x00, 0x01, 0x00, 0x01, 0x00, 0x83, 0x01, 0x05, 0x00, 0x01, 0x00, 0x01, 0x00, 0x83, 0x01, 0x03, 0x00, 0x01,
    0x00, 0x84, 0x01, 0x04, 0x00, 0x01, 0x00, 0x01, 0x00, 0x03, 0x01, 0x00, 0x01, 0x85, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01,
    0x01, 0x83, 0x00, 0x07, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x83, 0x00, 0x01, 0x01, 0x84, 0x00, 0x01, 0x01, 0x83, 0x00, 0x01, 0x01, 0x00,
    0x02, 0x01, 0x00, 0x87, 0x01, 0x03, 0x00, 0x01, 0x00, 0x87, 0x01, 0x09, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x01, 0x00, 0x86, 0x01, 0x01,
    0x00, 0x85, 0x01, 0x00, 0x01, 0x01, 0x89, 0x00, 0x01, 0x01, 0x89, 0x00, 0x01, 0x01, 0x83, 0x00, 0x03, 0x01, 0x00, 0x01, 0x88, 0x00, 0x01, 0x01,
    0x83, 0x00, 0x01, 0x01, 0x00, 0x02, 0x01, 0x00, 0x87, 0x01, 0x01, 0x00, 0x8b, 0x01, 0x01, 0x00, 0x83, 0x01, 0x01, 0x00, 0x8a, 0x01, 0x04, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x03, 0x01, 0x00, 0x01, 0x85, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x8a, 0x00, 0x03, 0x01,
    0x00, 0x01, 0x00, 0x04, 0x01, 0x00, 0x01, 0x00, 0x83, 0x01, 0x01, 0x00, 0x8b, 0x01, 0x01, 0x00, 0x87, 0x01, 0x01, 0x00, 0x8a, 0x01, 0x02, 0x00,
    0x01, 0x00, 0xa8, 0x01, 0x00,
};
// sparse: 880 bytes -> 82 bytes, ratio 10.73, checksum 0xaad9
const char rle_sparse[] = {
    0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0x8a, 0x00, 0x01, 0x04, 0x9d, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00,
    0x00, 0x9b, 0x00, 0x01, 0x04, 0x8c, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0x84, 0x00, 0x01, 0x04, 0xa3, 0x00, 0x00,
    0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0x92, 0x00, 0x01, 0x04, 0x95, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00,
    0x00, 0xa8, 0x00, 0x00, 0xa8, 0x00, 0x00, 0xa8, 0x07, 0x00,
};

// Host checksums, printed by rle_rooms.py from the source tile arrays.
#define EXPECT_PLATFORM 0xce8a
#define EXPECT_MAZE     0xf439
#define EXPECT_SPARSE   0xaad9

// One screen code per tile id, for drawing the platform room.
const char glyph[8] = { 0x20, 0xa0, 0x63, 0x66, 0x51, 0x5f, 0x5b, 0xe6 };

char room[ROOM_SIZE];

// --- the decoder -----------------------------------------------------
// Expands ROOM_H row streams into dst. Returns the decoded length.
unsigned rle_room(const char *src, char *dst)
{
    unsigned n = 0;
    for (char y = 0; y < ROOM_H; y++) {
        for (;;) {
            char c = *src++;
            if (c == 0)
                break;
            if (c & 0x80) {
                char v = *src++;
                char k = c & 0x7f;
                do { dst[n++] = v; } while (--k);
            } else {
                do { dst[n++] = *src++; } while (--c);
            }
        }
    }
    return n;
}

// --- the same decoder by hand ----------------------------------------
// Six zero-page bytes: source and destination pointers, a count and a
// row counter. Y indexes the destination within the row; the source is
// read through (zsrc,x) with X = 0 and the pointer stepped by hand.
__zeropage const char *zsrc;
__zeropage char *zdst;
__zeropage char zcnt;
__zeropage char zrows;

__noinline void rle_room_asm(void)
{
    __asm volatile
    {
        lda #ROOM_H
        sta zrows
    nextrow:
        ldy #0
    ctl:
        ldx #0
        lda (zsrc,x)
        inc zsrc
        bne c1
        inc zsrc + 1
    c1: tax
        beq rowend
        bmi run
        stx zcnt
    lit:
        ldx #0
        lda (zsrc,x)
        inc zsrc
        bne l1
        inc zsrc + 1
    l1: sta (zdst),y
        iny
        dec zcnt
        bne lit
        beq ctl
    run:
        and #0x7f
        sta zcnt
        ldx #0
        lda (zsrc,x)
        inc zsrc
        bne r1
        inc zsrc + 1
    r1: sta (zdst),y
        iny
        dec zcnt
        bne r1
        beq ctl
    rowend:
        tya
        clc
        adc zdst
        sta zdst
        bcc r2
        inc zdst + 1
    r2: dec zrows
        bne nextrow
    }
}

// --- CIA1 timer B harness --------------------------------------------
static inline void timer_start(void)
{
    cia1.crb = 0x00;
    cia1.tb = 0xffff;
    cia1.crb = 0x11;          // force load, start, count phi2
}

static inline unsigned timer_stop(void)
{
    cia1.crb = 0x00;
    return 0xffff - cia1.tb;
}

// --- checksum fold, the same as rle_rooms.py -------------------------
static inline unsigned fold(unsigned chk, unsigned v)
{
    return (chk ^ v) * 5 + 1;
}

unsigned room_checksum(unsigned len)
{
    unsigned chk = 0;
    for (unsigned i = 0; i < len; i++)
        chk = fold(chk, room[i]);
    return fold(chk, len);
}

// --- text helpers (screen codes) -------------------------------------
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

// One report line: NAME PACKED RATIO C-CYCLES ASM-CYCLES PASS/FAIL.
// Returns 1 when both decoders reproduce the host checksum.
char report(char row, const char *name, const char *src, unsigned packed,
            unsigned expect)
{
    char *p = Screen + row * 40;

    __asm { sei }
    timer_start();
    unsigned overhead = timer_stop();

    // The C decoder.
    timer_start();
    unsigned len = rle_room(src, room);
    unsigned cycles_c = timer_stop() - overhead;
    char ok = (len == ROOM_SIZE && room_checksum(len) == expect);

    // The hand-written decoder, into a buffer first filled with 0xff so
    // a short decode cannot pass on the C decoder's leftovers.
    for (unsigned i = 0; i < ROOM_SIZE; i++)
        room[i] = 0xff;
    zsrc = src;
    zdst = room;
    timer_start();
    rle_room_asm();
    unsigned cycles_asm = timer_stop() - overhead;
    __asm { cli }
    ok &= (room_checksum(ROOM_SIZE) == expect);

    // ratio x 100, in 32 bits because 88000 does not fit in 16.
    unsigned r100 = (unsigned)(((unsigned long)ROOM_SIZE * 100 + packed / 2) / packed);

    put_str(p, name);
    put_dec(p + 5, packed, 4);
    put_dec(p + 10, r100 / 100, 2);
    p[12] = 0x2e;
    put_dec(p + 13, r100 % 100, 2);
    put_dec(p + 16, cycles_c, 5);
    put_dec(p + 22, cycles_asm, 5);
    put_str(p + 28, ok ? s"pass" : s"fail");
    if (p[10] == 0x30)
        p[10] = 0x20;
    return ok;
}

void draw_room(void)
{
    char *s = Screen + 3 * 40;
    for (unsigned i = 0; i < ROOM_SIZE; i++)
        s[i] = glyph[room[i]];
}

int main(void)
{
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }

    // Blank the display so no badline lands in the timed regions; DEN
    // is sampled on line $30, so wait two frames for it to take effect.
    vic.ctrl1 = 0x0b;
    vic_waitFrame();
    vic_waitFrame();

    char ok = 1;
    ok &= report(1, s"maze", rle_maze, sizeof(rle_maze), EXPECT_MAZE);
    ok &= report(2, s"spar", rle_sparse, sizeof(rle_sparse), EXPECT_SPARSE);
    // The platform room is decoded last so it is the one left in RAM.
    ok &= report(0, s"plat", rle_platform, sizeof(rle_platform), EXPECT_PLATFORM);
    draw_room();

    char code = ok ? CODE_PASS : CODE_FAIL;
    RESULT = code;
    vic.color_border = ok ? 5 : 2;
    put_str(Screen + 34, s"r 0");
    Screen[37] = 0x30 + code;

    vic.ctrl1 = 0x1b;

    for (;;)
        ;
    return 0;
}
```

The three `rle_*` arrays and the three `EXPECT_*` values are the output of
this host script. Each room is drawn as 22 strings of 40 characters and
turned into tile ids by the `TILES` table, so the source array is the
picture. The encoder emits a run for three or more equal tiles, a literal
group otherwise, and a zero after every row; runs never cross a row. The
script decodes its own output and asserts it matches before printing.

```text
# rle_rooms.py -- author three 40x22 rooms, RLE-encode them, print C arrays.
# Format (same as tile-map-render.md): control byte c
#   c & 0x80 : run, next byte repeated (c & 0x7f) times (1..127)
#   c < 0x80 : c literal bytes follow (1..127)
#   0x00     : end of row
# Each of the 22 rows is its own stream; a run never crosses a row.

TILES = {'.': 0, '#': 1, '=': 2, 'X': 3, 'o': 4, 'L': 5, 'D': 6, 'W': 7}

PLATFORM = [
    "########################################",
    "#......................................#",
    "#..oo..................................#",
    "#.======.............................D.#",
    "#..........................========..LL#",
    "#....................................LL#",
    "#............=====...................LL#",
    "#..............................LLLLLLLL#",
    "#.....XXXXXXXX.........................#",
    "#......................................#",
    "#..LL.............=======..............#",
    "#..LL..................................#",
    "#..LL......oo..........................#",
    "#=========================.............#",
    "#......................................#",
    "#......................................#",
    "#.............................=========#",
    "#..........======......................#",
    "#......................................#",
    "#.oo..................XXXXXXXXXXXX.....#",
    "#=================....##################",
    "########################################",
]

MAZE = [
    "########################################",
    "#...#.......#.....#.....#...#..........#",
    "#.#.#.#####.#.###.#.###.#.#.#.########.#",
    "#.#...#...#...#...#...#...#.#.#......#.#",
    "#.#####.#.#####.#####.#####.#.#.####.#.#",
    "#.......#.......#.........#...#....#...#",
    "#.#########.###.#.#######.#####.##.###.#",
    "#.#.......#.#...#.#.....#.....#..#...#.#",
    "#.#.#####.#.#.###.#.###.#####.##.###.#.#",
    "#...#...#...#.#...#...#.....#....#...#.#",
    "###.#.#.#####.#.#####.#####.######.#.#.#",
    "#...#.#.......#.......#.....#......#...#",
    "#.###.#########.#######.###.#.########.#",
    "#.#...#.......#.#.....#.#...#.#......#.#",
    "#.#.###.#####.#.#.###.#.#.###.#.####.#.#",
    "#.#.....#...#...#...#.#.#.#...#....#...#",
    "#.#######.#.#######.#.#.#.#.######.#####",
    "#.........#.........#...#.#........#...#",
    "#.#######.###########.###.##########.#.#",
    "#.#.....#...........#.....#..........#.#",
    "#.#.###.###########.#######.##########.#",
    "########################################",
]

SPARSE = [
    "........................................",
    "........................................",
    "........................................",
    "..........o.............................",
    "........................................",
    "........................................",
    "........................................",
    "...........................o............",
    "........................................",
    "........................................",
    "........................................",
    "....o...................................",
    "........................................",
    "........................................",
    "........................................",
    "........................................",
    "..................o.....................",
    "........................................",
    "........................................",
    "........................................",
    "........................................",
    "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
]

def tiles(room):
    assert len(room) == 22 and all(len(r) == 40 for r in room)
    return [[TILES[ch] for ch in r] for r in room]

def encode_row(row):
    out, lit, i = [], [], 0
    def flush():
        if lit:
            out.append(len(lit)); out.extend(lit); lit.clear()
    while i < len(row):
        j = i
        while j < len(row) and row[j] == row[i] and j - i < 127:
            j += 1
        if j - i >= 3:
            flush(); out.append(0x80 | (j - i)); out.append(row[i]); i = j
        else:
            lit.append(row[i]); i += 1
            if len(lit) == 127: flush()
    flush(); out.append(0)
    return out

def decode(stream):
    out, i, rows = [], 0, 0
    while rows < 22:
        c = stream[i]; i += 1
        if c == 0: rows += 1
        elif c & 0x80: out.extend([stream[i]] * (c & 0x7f)); i += 1
        else: out.extend(stream[i:i + c]); i += c
    return out, i

def fold(chk, v):
    return ((chk ^ v) * 5 + 1) & 0xffff

def checksum(data):
    chk = 0
    for v in data: chk = fold(chk, v)
    return fold(chk, len(data))

for name, room in (("platform", PLATFORM), ("maze", MAZE), ("sparse", SPARSE)):
    grid = tiles(room)
    flat = [t for r in grid for t in r]
    stream = [b for r in grid for b in encode_row(r)]
    back, used = decode(stream)
    assert back == flat and used == len(stream)
    print("// %s: %d bytes -> %d bytes, ratio %.2f, checksum 0x%04x"
          % (name, len(flat), len(stream), len(flat) / len(stream), checksum(flat)))
    print("const char rle_%s[] = {" % name)
    for k in range(0, len(stream), 24):
        print("    " + ", ".join("0x%02x" % b for b in stream[k:k + 24]) + ",")
    print("};")
```

## Build

```bash
python3 rle_rooms.py            # prints the rle_* arrays and the checksums
oscar64 -tm=c64 -O2 -o=level-rle-decoder.prg level-rle-decoder.c
```

Produces `level-rle-decoder.prg`, 3,030 bytes (Oscar64 build 2026-05-19),
plus `level-rle-decoder.map`, `.asm` and `.lbl`. Then run headless in
VICE (PAL):

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas x64sc -default -warp +sound \
  +autostart-delay-random -autostartprgmode 1 -limitcycles 6000000 \
  -exitscreenshot level-rle-decoder.png -autostart level-rle-decoder.prg
```

Add `-model ntsc` for the NTSC picture.

## Expected output

Green border, black background, white text. Rows 0 to 2 read:

```text
PLAT 0213  4.13 33562 19158 PASS  R 01
MAZE 0629  1.40 50447 27673 PASS
SPAR 0082 10.73 28193 16470 PASS
```

The columns are: room, packed bytes, ratio (880 bytes over packed bytes,
rounded to two places), cycles for the C decoder, cycles for the
hand-written decoder, and PASS when both decoders reproduce the host
checksum. `R 01` is the verdict code, `01` for pass and `02` for fail;
the same byte is at `$02FF` and the border is green (5) or red (2).
Rows 3 to 24 are the platform room: a solid frame, eight platform runs
drawn as bars, ladder tiles in two columns and one horizontal run, two
rows of spikes, a door at the upper right and three pairs of coins.

The same text and the same cycle counts appear on PAL and NTSC (measured
in VICE x64sc 3.10, both models; the timed regions run with interrupts
masked and the display blanked, so only CPU cycles are counted).

Screenshots at 6,000,000 cycles: `screenshots/level-rle-decoder.png` (PAL)
and `screenshots/level-rle-decoder-ntsc.png` (NTSC).

The figures, all read off the picture or the `.map` file:

| Room | Source bytes | Packed bytes | Ratio | C decoder cycles | Hand-written cycles |
|---|---|---|---|---|---|
| Platform | 880 | 213 | 4.13 : 1 | 33,562 (38.1 per byte) | 19,158 (21.8 per byte) |
| Maze | 880 | 629 | 1.40 : 1 | 50,447 (57.3 per byte) | 27,673 (31.4 per byte) |
| Sparse | 880 | 82 | 10.73 : 1 | 28,193 (32.0 per byte) | 16,470 (18.7 per byte) |

| Decoder | Bytes of code | Source |
|---|---|---|
| `rle_room` (C, `-O2`) | 149 | `.map`, `objects by size`: `rle_room, NATIVE_CODE:code (0095)` |
| `rle_room_asm` (hand-written) | 80 | `.map`: `rle_room_asm, NATIVE_CODE:code (0050)`, including the `rts` |

The hand-written decoder also uses six zero-page bytes (`$F7` to `$FC`
in the `.map`). Both cycle figures are net of the harness's own
start/stop cost, which the program measures once with an empty timed
region and subtracts. The per-byte figures are arithmetic from the
cycle counts.

## Why this works

The stream format is the one `tile-map-render.md` established, so a
level built for that recipe decodes here unchanged. The C decoder is that
recipe's `rle_row` with the row loop folded in: it returns the total
decoded length, and the caller checks that it is 880 before it trusts the
checksum. The hand-written decoder does the same work with Y as the
destination index within a row and the source read through `(zsrc,x)`
with X held at zero, which is the 6502's only way to read through a
pointer without spending Y. After each row `tya` adds the row's length
to the destination pointer, so a row that decodes short or long shifts
every later row and the checksum catches it. The two `beq ctl` branches
after `bne` are unconditional in effect: `dec zcnt` has just left Z set.

The three rooms are chosen to span the range a game meets. The platform
room is long runs of floor and air broken by short features and packs
4.13 : 1. The maze is a wall every other cell, which defeats a
three-byte run threshold on most rows, and packs 1.40 : 1; a tile-pair
dictionary would do better on it (not measured here). The sparse room is nearly empty and packs 10.73 : 1. The
ratio a game sees depends on its rooms, and a design document that quotes
one figure should say which room it came from.

The cycle counts depend on the mix of runs and literals, not only on the
output size: the maze costs the most because every control byte does
little work. The hand-written decoder is a little under twice as fast as
the C one at `-O2` and about half its size. A 20 to 30 byte decoder is
possible only by dropping the row structure and the 16-bit pointer
arithmetic, and neither of the decoders here is one; the smallest
decoder for this exact format is not measured here.

The timing harness is the CIA1 timer B pattern of `tile-map-render.md`:
the timer is stopped before it is read so the two-byte read cannot
straddle a decrement, interrupts are masked around the timed region, and
the display is blanked two frames earlier because DEN is sampled once
per frame on line `$30`. The checksum fold `(chk ^ v) * 5 + 1` in 16
bits is order-sensitive, so a decoder that produced the right bytes in
the wrong order would fail. The hand-written decoder writes into a buffer
filled with `0xff` first, so it cannot pass on the C decoder's output.

## Verification

Three instruments, run against the committed PNGs (VICE x64sc 3.10,
Oscar64 build 2026-05-19).

**Text, room and border.** A script matched every cell of rows 0 to 2
against the glyphs of `chargen-901225-01.bin` and read the border pixel
at (2, 100). Both pictures give the three lines quoted above and the
border RGB VICE emits for colour 5 on each model, (98, 213, 50) on PAL
and (114, 189, 103) on NTSC. The same script then took the platform
room's 22 strings from `rle_rooms.py`, mapped each character through
`TILES` and `glyph`, and compared the 8 x 8 ink pattern of each of the
880 cells on rows 3 to 24 with the char ROM glyph: 880 compared, 0
differing, on both pictures. The `.map` of the same build gives
`rle_room` 149 bytes and `rle_room_asm` 80 bytes.

**Checksums.** The host script computed `0xCE8A`, `0xF439` and `0xAAD9`
from the source arrays; the machine folds 880 decoded bytes and the
length the same way and prints PASS three times for each decoder, on
both models. This is rung 1 for these three streams and says nothing
about streams these rooms do not exercise (no row here has a run of more
than 40, and a run count of zero is undefined by the format).

**Reproducibility.** The pinned command was run twice per model and the
PNG bytes were identical each time.

The first build printed the maze ratio as `1.39` where the host said
`1.40`: the machine truncated where Python rounded. The ratio now adds
half the divisor before dividing, and the two agree on all three rooms.
