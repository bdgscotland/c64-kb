---
recipe: flip-screen-rooms
toolchain: oscar64
output_format: PRG
region: both
techniques: [flip_screen_rooms, tile_grid_collision, tile_map_render, object_pool]
file_formats: [PRG]
uses_registers: [D000, D001, D010, D011, D012, D015, D017, D01C, D01D, D020, D021, D027, DC00, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Flip-Screen Rooms: five rooms as records, a full redraw on every edge, timed

## Synopsis

A flip-screen world. Each room is one record: four edge exits (target
room, entry column, entry row, or none), a wall colour, an object count,
a run-length coded 40 x 22 tile stream in the format `tile-map-render.md`
and `level-rle-decoder.md` use, then the objects. Five rooms sit in a
2 x 2 block with one dead end off the top right. A one-sprite player
walks against the decoded tile map (`tile-grid-collision.md`) and, on the
move that would take it past an edge with an exit, the sprite is hidden,
the display is blanked, the next room's record is decoded and drawn in one
pass, and the sprite is placed on the entry cell. Nothing scrolls. The
redraw is timed with CIA1 timers A and B cascaded and the last and worst
cost in cycles sit on the HUD row. An autopilot walks a scripted path
through every room and back, taking three keys; the verdict compares the
final room, cell and key count with a prediction the host script made
from the same room data, and the worst redraw with a stated budget.
`$02FF` is `01` and the border green for pass, `02` and red for fail, in
the manner of `headless-verify.md`. The room format is this page's own;
it is not any shipped game's.

## Source

```c
// flip-screen-rooms.c
//
// A flip-screen world of five 40 x 22 rooms. Each room is one record:
// four edge exits, a wall colour, an object count, a run-length coded
// tile stream in the tile-map-render format, then the objects. Leaving
// an edge that has an exit redraws the whole screen from the next
// room's record; nothing scrolls. The redraw is timed with CIA1 timers
// A and B cascaded, the sprite is hidden and the display blanked (DEN
// off) while it runs, and the HUD on row 0 shows the room, the player's
// cell, the last and worst redraw in cycles, the keys taken and the
// verdict. An autopilot walks a scripted path through every room and
// back; the verdict compares the final room, cell and key count with
// the host's prediction and the worst redraw with BUDGET. RESULT at
// $02FF is 01 (green border) for pass, 02 (red) for fail.
//
// Room record:
//   bytes 0..11  exits up, down, left, right: target room (0xff none),
//                entry column, entry row
//   byte 12      wall colour
//   byte 13      object count n
//   then         22 row streams: c & 0x80 run of (c & 0x7f), c < 0x80
//                literal count, 0 end of row
//   then         n objects of 3 bytes: type, column, row
//
#include <c64/vic.h>
#include <c64/cia.h>

#define Screen  ((char *)0x0400)
#define Color   ((char *)0xd800)
#define SprData ((char *)0x0340)
#define SprPtr  ((char *)0x07f8)

#define ROOM_W    40
#define ROOM_H    22
#define ROOM_SIZE (ROOM_W * ROOM_H)
#define MAP_ROW   1                // screen row the room starts on
#define MAX_OBJ   8
#define NONE      0xff

#define RESULT    (*(volatile char *)0x02ff)
#define CODE_PASS 0x01
#define CODE_FAIL 0x02

#ifndef AUTOPILOT
#define AUTOPILOT 1
#endif
#ifndef BUDGET
#define BUDGET 58968UL             // three PAL frames of 19,656 cycles
#endif

enum { DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT };
enum { T_FLOOR, T_WALL };

// --- world, emitted by rooms.py ------------------------------------
// room 0: 181 bytes (164 of tile stream)
const char room0[] = {
    0xff, 0x00, 0x00, 0x02, 0x14, 0x00, 0xff, 0x00, 0x00, 0x01, 0x00, 0x0a, 0x0e, 0x01, 0xa8, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00,
    0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6,
    0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01,
    0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa7, 0x00, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00,
    0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x89, 0x00, 0x01, 0x01, 0x85,
    0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x8a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01,
    0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00,
    0x01, 0x01, 0x00, 0x94, 0x01, 0x01, 0x00, 0x93, 0x01, 0x00, 0x01, 0x05, 0x03,
};
// room 1: 166 bytes (149 of tile stream)
const char room1[] = {
    0xff, 0x00, 0x00, 0x03, 0x26, 0x00, 0x00, 0x27, 0x0a, 0x04, 0x00, 0x05, 0x0d, 0x01, 0xa8, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00,
    0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa7,
    0x00, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01,
    0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0xa7, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01,
    0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x83, 0x00, 0xa0, 0x01, 0x83, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01,
    0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01,
    0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0xa6, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01, 0x1e, 0x0c,
};
// room 2: 205 bytes (188 of tile stream)
const char room2[] = {
    0x00, 0x14, 0x15, 0xff, 0x00, 0x00, 0xff, 0x00, 0x00, 0x03, 0x00, 0x14, 0x0a, 0x01, 0x94, 0x01, 0x01, 0x00, 0x93, 0x01, 0x00, 0x01, 0x01, 0xa6,
    0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01,
    0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01,
    0x9d, 0x00, 0x01, 0x01, 0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01, 0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00,
    0x01, 0x01, 0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01, 0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01,
    0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01, 0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01, 0x88, 0x00,
    0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01, 0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01, 0x88, 0x00, 0x01, 0x01,
    0x00, 0x01, 0x01, 0x9d, 0x00, 0x01, 0x01, 0x88, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01,
    0x01, 0x00, 0x01, 0x01, 0xa7, 0x00, 0x00, 0xa8, 0x01, 0x00, 0x01, 0x14, 0x0f,
};
// room 3: 180 bytes (163 of tile stream)
const char room3[] = {
    0x01, 0x26, 0x15, 0xff, 0x00, 0x00, 0x02, 0x27, 0x14, 0xff, 0x00, 0x00, 0x07, 0x01, 0xa6, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00,
    0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00,
    0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x89,
    0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x85, 0x00, 0x01, 0x01, 0x8a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00,
    0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00,
    0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6,
    0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01,
    0x00, 0xa7, 0x00, 0x01, 0x01, 0x00, 0xa8, 0x01, 0x00, 0x01, 0x1e, 0x14,
};
// room 4: 201 bytes (184 of tile stream)
const char room4[] = {
    0xff, 0x00, 0x00, 0xff, 0x00, 0x00, 0x01, 0x27, 0x05, 0xff, 0x00, 0x00, 0x0c, 0x01, 0xa8, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00,
    0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0xa7, 0x00, 0x01,
    0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00,
    0x01, 0x01, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01,
    0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01,
    0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x8b,
    0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01, 0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0x8b, 0x00, 0x01,
    0x01, 0x9a, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00, 0x01, 0x01, 0x00, 0x01, 0x01, 0xa6, 0x00,
    0x01, 0x01, 0x00, 0xa8, 0x01, 0x00, 0x01, 0x0a, 0x05,
};
// world: 933 bytes
const char * const rooms[5] = { room0, room1, room2, room3, room4 };
// script: direction, frames
const char script[] = {
    3, 150,
    3, 150,
    0, 20,
    3, 170,
    2, 160,
    2, 160,
    1, 20,
    2, 81,
    1, 140,
    3, 240,
    0, 180,
    2, 40,
};
// walk: 1511 frames
#define EXPECT_ROOM 1
#define EXPECT_COL  28
#define EXPECT_ROW  1
#define EXPECT_KEYS 3

// --- state ------------------------------------------------------------
char map[ROOM_SIZE];               // decoded tiles of the current room
char room;                         // current room index
int px, py;                        // player body top-left, room pixels (x reaches 312)
char room_bits[5];                 // one bit per object per room: taken

// Object pool: parallel arrays, freed on every room change.
char obj_live[MAX_OBJ], obj_col[MAX_OBJ], obj_row[MAX_OBJ];
char obj_type[MAX_OBJ], obj_bit[MAX_OBJ];

unsigned long last_cost, worst_cost;
char keys;

void hud_cost(void);

const char glyph[2]  = { 0x20, 0xa0 };
const char keyglyph  = 0x2a;

// --- CIA1 timers A and B cascaded: B counts A underflows ----------------
static inline void timer_start(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;               // force load, start, count TA underflow
    cia1.cra = 0x11;               // force load, start, count phi2
}

static inline unsigned long timer_stop(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    unsigned lo = 0xffff - cia1.ta;
    unsigned hi = 0xffff - cia1.tb;
    return ((unsigned long)hi << 16) | lo;
}

// --- text helpers -------------------------------------------------------
void put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
}

// --- the record: decode and draw in one pass -------------------------
// Expands the 22 row streams at src into map and, as each byte lands,
// writes its glyph and colour to the screen. Pointers step by one row
// and a char index walks the row, which is the 6502's (zp),y shape.
// Returns the byte after the stream.
const char *rle_room(const char *src, char colour)
{
    char *m = map;
    char *s = Screen + MAP_ROW * 40;
    char *c = Color + MAP_ROW * 40;
    for (char y = 0; y < ROOM_H; y++) {
        char x = 0;
        for (;;) {
            char ctl = *src++;
            if (ctl == 0)
                break;
            if (ctl & 0x80) {
                char v = *src++;
                char g = glyph[v], k = v ? colour : 11;
                ctl &= 0x7f;
                do {
                    m[x] = v; s[x] = g; c[x] = k; x++;
                } while (--ctl);
            } else {
                do {
                    char v = *src++;
                    m[x] = v; s[x] = glyph[v]; c[x] = v ? colour : 11; x++;
                } while (--ctl);
            }
        }
        m += ROOM_W; s += 40; c += 40;
    }
    return src;
}

void load_objects(const char *src, char count)
{
    for (char i = 0; i < MAX_OBJ; i++)
        obj_live[i] = 0;
    for (char i = 0; i < count && i < MAX_OBJ; i++) {
        char t = src[0], col = src[1], row = src[2];
        src += 3;
        if (room_bits[room] & (1 << i))
            continue;               // taken on an earlier visit
        obj_live[i] = 1;
        obj_type[i] = t;
        obj_col[i]  = col;
        obj_row[i]  = row;
        obj_bit[i]  = 1 << i;
        unsigned at = (MAP_ROW + row) * 40 + col;
        Screen[at] = keyglyph;
        Color[at]  = 7;
    }
}

// Full redraw from the record of room r. Called at raster 251 with the
// sprite already hidden and DEN already off, so the frame that follows
// is blank and no half-drawn frame shows.
void enter_room(char r)
{
    room = r;
    const char *rec = rooms[r];
    timer_start();
    const char *p = rle_room(rec + 14, rec[12]);
    load_objects(p, rec[13]);
    last_cost = timer_stop();
    if (last_cost > worst_cost)
        worst_cost = last_cost;
}

// --- collision against the decoded map --------------------------------
// Body is the 8 x 8 block at sprite columns 8..15, rows 0..7. A point
// outside the room is solid; the edge test in move() runs first.
static inline char solid(int x, int y)
{
    if (x < 0 || y < 0 || x >= ROOM_W * 8 || y >= ROOM_H * 8)
        return 1;
    return map[(y >> 3) * ROOM_W + (x >> 3)] == T_WALL;
}

// The edge triggers on the attempted move, not on the cell the player
// stands in, so the entry cell on the far side never fires it again.
char try_exit(char dir)
{
    const char *e = rooms[room] + dir * 3;
    if (e[0] == NONE)
        return 0;
    char target = e[0];
    px = e[1] * 8;
    py = e[2] * 8;
    vic.spr_enable = 0;
    vic.ctrl1 &= 0xef;              // DEN off: next frame is blank
    enter_room(target);
    vic.ctrl1 |= 0x10;              // DEN on before the untimed HUD work
    hud_cost();
    return 1;
}

void move(char dir)
{
    int nx = px, ny = py;
    switch (dir) {
    case DIR_UP:    ny -= 2; break;
    case DIR_DOWN:  ny += 2; break;
    case DIR_LEFT:  nx -= 2; break;
    case DIR_RIGHT: nx += 2; break;
    }
    if (nx < 0 || nx > (ROOM_W - 1) * 8 || ny < 0 || ny > (ROOM_H - 1) * 8) {
        try_exit(dir);
        return;
    }
    // Leading edge, two corners: an 8-pixel edge needs no more.
    char hit;
    switch (dir) {
    case DIR_UP:    hit = solid(nx, ny) | solid(nx + 7, ny); break;
    case DIR_DOWN:  hit = solid(nx, ny + 7) | solid(nx + 7, ny + 7); break;
    case DIR_LEFT:  hit = solid(nx, ny) | solid(nx, ny + 7); break;
    default:        hit = solid(nx + 7, ny) | solid(nx + 7, ny + 7); break;
    }
    if (!hit) {
        px = nx;
        py = ny;
    }
}

void pick_up(void)
{
    char col = (char)(px >> 3), row = (char)(py >> 3);
    for (char i = 0; i < MAX_OBJ; i++) {
        if (obj_live[i] && obj_col[i] == col && obj_row[i] == row) {
            obj_live[i] = 0;
            room_bits[room] |= obj_bit[i];
            Screen[(MAP_ROW + row) * 40 + col] = 0x20;
            keys++;
        }
    }
}

// --- HUD ------------------------------------------------------------
// Row 0: R room  C col,row  L last redraw  W worst redraw  K keys  V code.
// The two 32-bit fields are written only after a transition; a 32-bit
// decimal conversion every frame cost more than the frame.
void put_long(char *p, unsigned long v, char digits)
{
    for (char i = digits; i > 0; i--) {
        p[i - 1] = 0x30 + (char)(v % 10);
        v /= 10;
    }
}

void hud_cost(void)
{
    put_long(Screen + 11, last_cost, 5);
    put_long(Screen + 18, worst_cost, 5);
}

void hud(char code)
{
    char *p = Screen;
    p[1] = 0x30 + room;
    char col = (char)(px >> 3), row = (char)(py >> 3);
    p[4] = 0x30 + col / 10;  p[5] = 0x30 + col % 10;
    p[7] = 0x30 + row / 10;  p[8] = 0x30 + row % 10;
    p[25] = 0x30 + keys;
    p[28] = 0x30 + code / 10; p[29] = 0x30 + code % 10;
}

// --- sprite ------------------------------------------------------------
void sprite_init(void)
{
    for (char i = 0; i < 63; i++)
        SprData[i] = 0;
    for (char i = 0; i < 8; i++)
        SprData[i * 3 + 1] = 0xff;
    SprPtr[0] = 0x0340 / 64;
    vic.spr_color[0] = 1;
    vic.spr_multi = 0;
    vic.spr_expand_x = 0;
    vic.spr_expand_y = 0;
}

void sprite_place(void)
{
    // Body columns 8..15 sit on the cell: sprite X = 24 + px - 8.
    vic_sprxy(0, 16 + px, 50 + MAP_ROW * 8 + py);
    vic.spr_enable = 1;
}

static inline void wait_bottom(void)
{
    while (vic.raster != 251)
        ;
}

// --- main ----------------------------------------------------------------
int main(void)
{
    __asm { sei }
    vic.color_border = 0;
    vic.color_back = 0;
    for (unsigned i = 0; i < 1000; i++) {
        Screen[i] = 0x20;
        Color[i] = 1;
    }
    sprite_init();
    put_str(Screen, s"r  c  ,   l      w      k  v  ");
    px = 5 * 8;
    py = 10 * 8;
    vic.ctrl1 &= 0xef;
    vic_waitFrame();
    vic_waitFrame();
    enter_room(0);
    worst_cost = 0;                 // the first draw is not a transition
    hud_cost();
    sprite_place();
    vic.ctrl1 |= 0x10;

    char code = 0;
#if AUTOPILOT
    char step = 0;
    char left = script[1];
#endif
    for (;;) {
        wait_bottom();
        sprite_place();
        hud(code);
#if AUTOPILOT
        if (step < sizeof(script)) {
            move(script[step]);
            if (--left == 0) {
                step += 2;
                if (step < sizeof(script))
                    left = script[step + 1];
            }
        } else if (code == 0) {
            code = CODE_PASS;
            if (room != EXPECT_ROOM || (px >> 3) != EXPECT_COL ||
                (py >> 3) != EXPECT_ROW || keys != EXPECT_KEYS ||
                worst_cost > BUDGET)
                code = CODE_FAIL;
            RESULT = code;
            vic.color_border = (code == CODE_PASS) ? 5 : 2;
        }
#else
        char j = ~cia1.pra;
        if (j & 1) move(DIR_UP);
        else if (j & 2) move(DIR_DOWN);
        else if (j & 4) move(DIR_LEFT);
        else if (j & 8) move(DIR_RIGHT);
#endif
        pick_up();
    }
    return 0;
}
```

## Build

```bash
python3 rooms.py > gen.h       # the room arrays, the script and the EXPECT_* lines
oscar64 -tm=c64 -O2 -n -o=flip-screen-rooms.prg flip-screen-rooms.c
```

Produces `flip-screen-rooms.prg`, 3,665 bytes (Oscar64 build 2026-05-19),
plus `flip-screen-rooms.map`, which puts `rle_room` at 224 bytes of code
(`0b00 - 0be0`). The listing above is the generator's output pasted in;
`rooms.py` is the script below. Then run headless in VICE (PAL):

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 34000000 -exitscreenshot flip-screen-rooms.png \
  -autostart flip-screen-rooms.prg
```

Add `-model ntsc` for the NTSC picture. The walk is 1,511 frames; at
19,656 cycles a PAL frame that is 29.7 million cycles after the autostart,
and the limit leaves room for the transitions and the BASIC start.

`-dAUTOPILOT=0` builds the joystick version: port 2, four directions, the
same rooms, 3,482 bytes. It was built and not run here.

### The generator

`rooms.py` authors the five rooms as character grids, opens the exit gaps
in both rooms of each link, encodes each row with the three-byte run
threshold, and walks the script pixel by pixel with the same two-corner
probe the C code uses, so its `EXPECT_*` lines are a prediction and not a
reading. An earlier version walked cells and was one cell out on the leg
after an edge crossing: a crossing costs one frame, not the four a cell
takes at 2 px per frame.

```python
# rooms.py: authors five 40 x 22 rooms, run-length encodes them with the
# tile-map-render stream format, prints the C arrays, and predicts the
# autopilot's final state by walking the script at pixel level.
W, H = 40, 22
UP, DOWN, LEFT, RIGHT = 0, 1, 2, 3
NONE = 0xFF

def blank(colour):
    g = [['#'] * W] + [['#'] + ['.'] * (W - 2) + ['#'] for _ in range(H - 2)] + [['#'] * W]
    return g, colour

# World: 0 -- 1 -- 4 (dead end)
#        |    |
#        2 -- 3
rooms = [blank(c) for c in (14, 13, 10, 7, 12)]   # wall colours per room
exits = [{} for _ in rooms]

def link(a, da, b, db, ca, ra, cb, rb):
    """Open a gap at (ca, ra) in room a and (cb, rb) in room b, and set
    both exits. The entry cell is the gap cell on the far side."""
    rooms[a][0][ra][ca] = '.'
    rooms[b][0][rb][cb] = '.'
    exits[a][da] = (b, cb, rb)
    exits[b][db] = (a, ca, ra)

link(0, RIGHT, 1, LEFT, 39, 10, 0, 10)
link(1, RIGHT, 4, LEFT, 39, 5, 0, 5)
link(0, DOWN, 2, UP, 20, 21, 20, 0)
link(2, RIGHT, 3, LEFT, 39, 20, 0, 20)
link(3, UP, 1, DOWN, 38, 0, 38, 21)

# A few pillars so the rooms are not all one run; none on the script path.
for x in range(10, 30, 6):
    rooms[0][0][15][x] = '#'
    rooms[3][0][8][x] = '#'
for y in range(8, 18):
    rooms[2][0][y][30] = '#'
    rooms[4][0][y][12] = '#'
for x in range(4, 36):
    rooms[1][0][14][x] = '#'

# Objects: type 1 = key. (room, col, row)
objects = {0: [(1, 5, 3)], 1: [(1, 30, 12)], 2: [(1, 20, 15)],
           3: [(1, 30, 20)], 4: [(1, 10, 5)]}

def rle_row(row):
    out, i = [], 0
    while i < W:
        j = i
        while j < W and row[j] == row[i]:
            j += 1
        n = j - i
        if n >= 3:
            out += [0x80 | n, row[i]]
            i = j
        else:
            k = i
            while k < W:
                m = k
                while m < W and row[m] == row[k]:
                    m += 1
                if m - k >= 3:
                    break
                k = m
            lit = row[i:k]
            out += [len(lit)] + lit
            i = k
    return out + [0]

def encode(idx):
    grid, colour = rooms[idx]
    tiles = [[1 if ch == '#' else 0 for ch in row] for row in grid]
    hdr = []
    for d in (UP, DOWN, LEFT, RIGHT):
        t = exits[idx].get(d)
        hdr += list(t) if t else [NONE, 0, 0]
    objs = objects[idx]
    hdr += [colour, len(objs)]
    body = []
    for row in tiles:
        body += rle_row(row)
    tail = [b for o in objs for b in o]
    return hdr + body + tail, len(body)

# Autopilot script: (direction, frames), 2 px per frame, one entry at most
# 255 frames. An edge crossing costs one frame, so the predictor walks
# pixels, not cells, with the same two-corner probe the C code uses.
script = [(RIGHT, 150), (RIGHT, 150), (UP, 20), (RIGHT, 170), (LEFT, 160),
          (LEFT, 160), (DOWN, 20), (LEFT, 81), (DOWN, 140), (RIGHT, 240),
          (UP, 180), (LEFT, 40)]
DX = {UP: 0, DOWN: 0, LEFT: -2, RIGHT: 2}
DY = {UP: -2, DOWN: 2, LEFT: 0, RIGHT: 0}

def wall(room, x, y):
    if x < 0 or y < 0 or x >= W * 8 or y >= H * 8:
        return True
    return rooms[room][0][y >> 3][x >> 3] == '#'

def predict(room, col, row):
    px, py, picked = col * 8, row * 8, set()
    for d, frames in script:
        for _ in range(frames):
            nx, ny = px + DX[d], py + DY[d]
            if nx < 0 or nx > (W - 1) * 8 or ny < 0 or ny > (H - 1) * 8:
                t = exits[room].get(d)
                if t:
                    room, px, py = t[0], t[1] * 8, t[2] * 8
            else:
                if d == UP:      hit = wall(room, nx, ny) or wall(room, nx + 7, ny)
                elif d == DOWN:  hit = wall(room, nx, ny + 7) or wall(room, nx + 7, ny + 7)
                elif d == LEFT:  hit = wall(room, nx, ny) or wall(room, nx, ny + 7)
                else:            hit = wall(room, nx + 7, ny) or wall(room, nx + 7, ny + 7)
                if not hit:
                    px, py = nx, ny
            for o in objects[room]:
                if (o[1], o[2]) == (px >> 3, py >> 3):
                    picked.add((room, o[1], o[2]))
    return room, px >> 3, py >> 3, len(picked), sum(f for _, f in script)

if __name__ == '__main__':
    total = 0
    for i in range(len(rooms)):
        data, body = encode(i)
        total += len(data)
        print('// room %d: %d bytes (%d of tile stream)' % (i, len(data), body))
        print('const char room%d[] = {' % i)
        for k in range(0, len(data), 24):
            print('    ' + ', '.join('0x%02x' % b for b in data[k:k + 24]) + ',')
        print('};')
    print('// world: %d bytes' % total)
    print('const char * const rooms[%d] = { %s };' %
          (len(rooms), ', '.join('room%d' % i for i in range(len(rooms)))))
    print('// script: direction, frames')
    print('const char script[] = {')
    for d, f in script:
        print('    %d, %d,' % (d, f))
    print('};')
    r, c, y, k, frames = predict(0, 5, 10)
    print('// walk: %d frames' % frames)
    print('#define EXPECT_ROOM %d' % r)
    print('#define EXPECT_COL  %d' % c)
    print('#define EXPECT_ROW  %d' % y)
    print('#define EXPECT_KEYS %d' % k)
```

## Expected output

Green border, black background. Row 0 reads, on both models:

```text
R1 C28,01 L40204 W42141 K3 V01
```

The fields are: room index, the player's cell (column, row), the last
redraw in cycles, the worst redraw in cycles, keys taken, verdict code.
Rows 1 to 22 are room 1: a light green frame with a gap in the left wall
at row 10, in the right wall at row 5 and in the bottom wall at column 38,
a bar of wall across row 14, the key at (30, 12) still in place because
the walk never crosses it, and the white 8 x 8 player at column 28 of
room row 1 (screen row 2). The picture is a room other than the first.

Measured on the committed PNGs with PIL (VICE x64sc 3.10, both models,
34,000,000 cycles): row 0 decoded cell by cell against
`chargen-901225-01.bin` gives the line above; the border pixel (2, 100)
is (98, 213, 50) on PAL and (114, 189, 103) on NTSC, colour 5 in each
palette of `runtime/vice-reference.md`; the 24 x 24 block around the
player's cell holds exactly 64 white pixels, all inside the 8 x 8 cell at
x 256 to 263; the key cell (30, 12) has 24 lit pixels. The pinned command
was run twice per model and the PNG bytes were identical each time.

The final state matches the generator's prediction (room 1, cell 28,1,
3 keys), and the worst redraw, 42,141 cycles, is under the 58,968-cycle
budget (`BUDGET`, three PAL frames). The worst is one of the seven
transitions the walk makes; the last, into room 1, cost 40,204. The
first draw of room 0 at start-up cost 40,941 and is excluded from the
worst by design, since it is not a transition.

The red case was seen twice while the listing was being built and is
recorded here as the shape of a failure: with the player's x held in a
`char` the position wrapped at column 32, no edge was ever reached, and
the verdict was `R0 C19,01 L40941 W00000 K0 V02` with a red border; with
the cell-level predictor the walk ended in room 0 at (28, 1) with one key
and the same red verdict. Neither picture is committed.

## Why this works

**The record.** Fourteen header bytes, then the tile stream, then the
objects. `rle_room` returns the byte after the last row's terminator, so
the object list needs no offset field and a room with more or fewer rows
of runs still finds its objects. The exits are three bytes per edge in
the order up, down, left, right, which is the order of the direction
enum, so `try_exit` indexes the header with `dir * 3` and nothing else.

**The edge rule.** The transition fires on the attempted move that would
take the body past the room's last cell, not on the cell the player
stands in. The entry cell is the gap cell on the far side of the next
room. A rule that fired on position would fire again on the first frame
in the new room and bounce the player back; this one fires only when the
player pushes at the edge again, which is the way back.

**The redraw and the frame it spans.** The frame loop waits for raster
251, so `move` and therefore `try_exit` run in the lower border. The
sprite is disabled and DEN is cleared before the first screen write. DEN
is sampled once per frame on line `$30`, so the frame that follows is
blank in the border colour and makes no badlines, and the writes that
land before that sample fall in the border. DEN is set again as soon as
`enter_room` returns and before the HUD's decimal conversions, so the
interval from DEN clear to DEN set is the timed redraw plus the few
cycles that start and stop the timers: 40,000 to 42,000 cycles, 2.1 PAL
frames or 2.5 NTSC frames. Arithmetic from the measured cycles, not
measured as a frame count: the screen is blank for two frames on PAL
(line `$30` falls at about 6,900, 26,500 and 46,200 cycles after raster
251, and the redraw ends before the third sample) and three on NTSC
(3,900, 21,000, 38,100 and 55,200). The order of the two writes matters.
An earlier build ran the HUD's two 32-bit conversions between the redraw
and the DEN set, and an instrumented copy with CIA2 timers cascaded
around the whole of `try_exit` measured that interval at 55,483 cycles
from DEN clear to DEN set on both models: three blank frames on PAL, and
three or four on NTSC, because the worst case passes the fourth sample
by about 300 cycles. The frame count is a property of the whole blanked
interval, not of the timed redraw alone. No frame is ever torn, because
no visible line is drawn while screen RAM is half-written. The other
policy, leaving DEN set and accepting the torn frames, was not run here.

**One pass, per row.** The first version decoded into `map` and then
copied 880 cells to the screen in a second loop indexed by a 16-bit
counter, and cost 99,262 cycles, five PAL frames. The decoder now writes
the tile, its glyph and its colour as each byte lands, with three
pointers stepped by one row and a `char` index along the row, which
Oscar64 compiles to indexed stores. That is 40,204 to 42,141 cycles for
a room of 149 to 188 stream bytes, or 46 to 48 cycles per cell. The
`level-rle-decoder.md` figures for the decode alone, 33,562 for its
platform room in C and 19,158 by hand, show where the next factor of two
is: a hand-written decoder that writes the three destinations from one
`(zp),y` triple.

**The HUD costs most of a frame.** The first build converted the two
32-bit cycle counts to decimal every frame and the walk crawled at about
two frames per step. The two five-digit conversions cost 13,311 cycles on
both models in the instrumented copy above, most of a PAL frame, on top
of the per-frame work and the wait for raster 251. The cost fields are
now written only after a transition, and after DEN is set, and the
per-frame HUD is `char` arithmetic.

**Objects.** Each room's list is loaded into an eight-slot pool on entry
and the pool is cleared first, so nothing carries over from the last
room. One bit per object per room in `room_bits` records what has been
taken, and `load_objects` skips those, so a key does not come back on a
second visit. The walk re-enters rooms 1 and 0 and the counts stay at
three.

**Collision.** The body is the 8 x 8 block at sprite columns 8 to 15,
rows 0 to 7, so `vic_sprxy` places the sprite at `16 + px`. The step is 2
px, under a tile, and the leading edge is probed at its two corners,
which is enough for an 8-pixel edge (`tile_grid_collision`, probe
spacing). A point outside the room is solid; the edge test in `move`
runs first, so an edge with an exit is passable and one without is a
wall.

## Verification

Three instruments, run against the committed PNGs (VICE x64sc 3.10,
Oscar64 build 2026-05-19).

**Text, sprite and border.** A script matched every cell of row 0
against the char ROM glyphs and read the border pixel at (2, 100) on both
pictures; it counted the white pixels in the 24 x 24 block around the
player's cell (64, all in one 8 x 8 cell) and the lit pixels in the key
cell (24). The figures are quoted above.

**Prediction.** `rooms.py` walked the script over the same room data
before the machine did and printed room 1, cell (28, 1), 3 keys. The
machine printed the same and set `V01`. Room, column, row and key count
are four independent bytes; a wrong exit table, a wrong entry cell, a
wrong probe or a missed pickup each moves at least one of them.

**Reproducibility.** The pinned command was run twice per model and the
PNG bytes were identical each time.

What this does not establish: the frame counts of the blank are
arithmetic on measured cycle intervals, not a raster measurement, and
the DEN-clear-to-DEN-set interval of the committed listing was not timed
separately, only the redraw inside it; the joystick build was compiled and
not run; the redraw cost of a room with a picture in it, or with a
metatile layer, is not measured here.
