// game.h: what the modules share. One header, so an agent sees the whole
// game's state in one place. Each module's .c is pulled in by the
// #pragma compile lines at the end (Oscar64 has no object linker).
#ifndef GAME_H
#define GAME_H

#include <c64/vic.h>
#include <c64/cia.h>

#ifndef AUTOPILOT
#define AUTOPILOT 0
#endif
#ifndef FORCE_FAULT
#define FORCE_FAULT 0
#endif
#ifndef STAGE_CROWD
#define STAGE_CROWD 0               // 1: the crowded first view of make stage
#endif
#ifndef TEAR_DEMO
#define TEAR_DEMO 0                 // 1: shift the page on display in place (the old, torn way)
#endif

// ---- memory: VIC bank 3 ($C000-$FFFF) -----------------------------------
#define PAGE0     ((char *)0xc000)  // playfield pages (rows 0-19 used, 20 blank)
#define PAGE1     ((char *)0xc400)
#define PAGE2     ((char *)0xe800)  // RAM under the KERNAL, which is banked out
#define HUDPAGE   ((char *)0xc800)  // the HUD rows 21-24 are read from here
#define SPRMEM    ((char *)0xcc00)  // sprite blocks 48-63
#define CHARSET   ((char *)0xe000)  // RAM under the KERNAL
#define COLOUR    ((char *)0xd800)
#define SPR_BLOCK 48                // block number of SPRMEM in bank 3
#define D018_PAGE0 0x08             // screen $C000, characters $E000
#define D018_PAGE1 0x18             // screen $C400
#define D018_PAGE2 0xa8             // screen $E800
#define D018_HUD   0x28             // screen $C800
#define D016_PLAY  0x10             // multicolour, 38 columns; | XSCROLL
#define RESULT    (*(volatile char *)0x02ff)   // $01 pass, $02 fail

#define PF_ROWS    20               // playfield character rows
#define HUD_ROW    21               // first HUD row
#define SYNC_LINE  251              // the frame starts here (engine.asm's irq_blank)
#define SPLIT_LINE 212              // the HUD split, inside the blank row 20

// ---- colours ----------------------------------------------------------------
#define COL_SKY    VCOL_BLUE        // $D021, also the border in play
#define COL_EARTH  VCOL_BROWN       // $D022, multicolour 01
#define COL_GOLD   VCOL_YELLOW      // $D023, multicolour 10
#define COL_GRASS  VCOL_GREEN       // colour RAM low bits, multicolour 11
#define COL_PLAYER VCOL_WHITE
#define COL_WALKER VCOL_LT_RED
#define COL_HOPPER VCOL_CYAN

// ---- joystick (active low, as $DC00 reads it) --------------------------------
#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10

// ---- level (level.c) ----------------------------------------------------------
#define LEVEL_TW  128               // tiles across; a tile is 2 x 2 characters
#define LEVEL_TH  10                // tiles down: the 20 playfield rows
#define LEVEL_CW  (LEVEL_TW * 2)    // characters across
#define CAM_MAX   ((LEVEL_CW - 40) * 8)

// Cell attribute bits (the slope-collision recipe's byte, plus coin and goal).
#define A_GROUND 0x01               // has a ground surface
#define A_WALL   0x02               // blocks a sideways move and a rising head
#define A_DROP   0x04               // one-way: landed on from above only
#define A_COIN   0x08
#define A_SLOPE  0x70               // slope type 0-7 in bits 4-6
#define A_GOAL   0x80

// Glyphs. 0-63 are the ROM's upper-case set (text, digits, the meter);
// the playfield's own glyphs start at CH_FIRST. The sky is the ROM space.
// GLYPHS-BEGIN
#define CH_SKY     32
#define CH_FIRST   64
#define CH_DIRT    64
#define CH_GRASS   65
#define CH_BRICK   66
#define CH_LEDGE   67
#define CH_SLOPE1  68               // slope type n is glyph 67 + n
#define CH_SLOPE2  69
#define CH_SLOPE3  70
#define CH_SLOPE4  71
#define CH_SLOPE5  72
#define CH_SLOPE6  73
#define CH_COIN_TL 74
#define CH_COIN_TR 75
#define CH_COIN_BL 76
#define CH_COIN_BR 77
#define CH_FLAG    78
#define CH_POLE    79
#define CH_COUNT   16
// GLYPHS-END

extern char level[LEVEL_TH][LEVEL_TW];     // tile per cell; coins are taken out
extern const char heights[64];             // ground row in a cell per slope type and column
extern unsigned start_x;                   // the player's start, from the level text
extern char start_y;

void level_reset(void);                    // decode the text; fill the actor table
char cell_char(unsigned col, char row);    // glyph at a world character cell
char cell_attr(unsigned col, char row);
char surface_at(unsigned x, char row, char a);  // ground row of cell (row, a) at world x
void level_column(char *dst, unsigned col);     // 20 glyphs down one page column
bool take_coin(unsigned col, char row);         // remove the coin tile over this cell

// ---- art (art.c) ----------------------------------------------------------------
// Sprite shapes, one per block from SPR_BLOCK: all sixteen are used.
// Player shapes 0-4 face right and 5-9 are the same five mirrored at
// start-up. SH_FALL is the only frame with a stomp box.
enum Shape {
    SH_STAND, SH_RUN1, SH_RUN2, SH_JUMP, SH_FALL,
    SH_MIRROR = 5,
    SH_HURT = 10, SH_WALK1, SH_WALK2, SH_SQUASH, SH_HOP_SIT, SH_HOP_UP,
    SH_COUNT
};

// Hit boxes per animation frame (c64-kb per_frame_hitbox): a frame owns
// hb_count[shape] boxes from hb_first[shape]. A box has a group, and a mask
// of the groups it can hit; only pairs whose mask and group meet are tested.
#define G_PLAYER 0x01               // the player's body
#define G_STOMP  0x02               // the player's feet, on the falling frame only
#define G_ENEMY  0x04
struct HBox { char x0, y0, x1, y1, group, mask; };  // inclusive, from the art's top-left
extern struct HBox hbox[];
extern const char hb_first[SH_COUNT], hb_count[SH_COUNT];
void art_build(void);                      // charset and sprite shapes into bank 3

// ---- animation (anim.c) ----------------------------------------------------------
struct Anim { const char *seq; char pos, count, shape; };
extern const char an_stand[], an_run[], an_jump[], an_fall[], an_hurt[];
extern const char an_walk[], an_squash[], an_hop_sit[], an_hop_up[];
void anim_set(struct Anim *a, const char *seq);   // restarts only if it is a new sequence
void anim_step(struct Anim *a);
bool anim_done(struct Anim *a);                   // a held sequence has reached its last frame

// ---- physics (player.c) -------------------------------------------------------------
#define BODY_H     20               // feet to head, pixels
#define BODY_HALF  3                // foot column to body edge
#define JUMP_LEN   44
#define JUMP_APEX  24               // first entry with vy >= 0: walking off a ledge starts here
#define JUMP_BOUNCE 10              // after a stomp
extern const int vy_tab[JUMP_LEN];
#define MAX_RISE   2                // a step up steeper than this is a wall
#define MAX_SNAP   2                // a step down deeper than this is a fall
char surface_walk(unsigned x, char fy);   // the ground under feet at fy moved to x; 0xff none
bool wall_at(unsigned x, char fy, char height);                          // a wall cell beside the body
char ground_step(unsigned *x, unsigned *y, signed char dx, char height); // 0 moved, 1 blocked, 2 off an edge
bool air_step(unsigned x, unsigned *y, char *jump, char height, bool drop); // true: landed

extern unsigned px;                 // foot column, world pixels
extern unsigned py;                 // ground row under the feet, world pixels, 8.8
extern char pjump;                  // vy_tab index while airborne
extern bool pground, pleft;
extern char pinvuln;                // frames of blinking after a respawn
extern struct Anim panim;
extern unsigned safe_x;             // the last flat ground stood on: the respawn point
extern char safe_y;
void player_reset(unsigned x, char y);
void player_update(char joy, char pressed);

// ---- actors (actors.c) --------------------------------------------------------------------
#define NLVL   32                   // actors placed in a level, at most
#define NSLOT  5                    // live at once: sprites 1-5; six overran NTSC (README, "Enemies on screen")
#define T_WALKER 0
#define T_HOPPER 1
extern char lvl_count;
extern char lvl_col[NLVL], lvl_ty[NLVL], lvl_type[NLVL], lvl_flags[NLVL];
#define LF_LEFT 0x01
#define LF_LIVE 0x40
#define LF_DEAD 0x80
extern char slot_lvl[NSLOT];        // level index, or NO_SLOT
extern char drop_lo, drop_top;      // the drop window actors_update used this frame
extern unsigned slot_x[NSLOT];      // foot column, world pixels
extern unsigned slot_y[NSLOT];      // feet row, 8.8
extern char slot_type[NSLOT];
extern bool slot_squashed[NSLOT];   // stomped: shows its squash, then frees the slot
extern struct Anim slot_anim[NSLOT];
#define NO_SLOT 0xff
void actors_reset(void);
void actors_update(void);           // window, wake, move, drop
void actors_collide(void);          // player against every live box
bool enemy_near(unsigned x, char dist);   // a live enemy within dist pixels of x

// ---- view (view.c) -----------------------------------------------------------------------------
#define NPAGES 3
extern unsigned camx;               // world pixel at the window's left edge (XSCROLL 7)
extern unsigned shown_col;          // first world column on the page on display
extern unsigned pub_camx;           // the camera of the pair last published
extern char shown_page;             // 0-2: on display from the next vertical blank
extern int page_col[NPAGES];        // the column each page holds (or is being prepared for)
extern char page_rows[NPAGES];      // rows of it that are done: PF_ROWS is ready
void view_init(void);               // VIC, bank, colours, IRQ
void view_cut(void);                // draw both pages at camx; no scrolling
void view_follow(void);             // move the camera after the player; shift the hidden page
void view_sprites(void);            // sprite shadows from the model
void view_publish(void);            // the next picture's page and XSCROLL, for the IRQ at 251
void view_apply(void);              // the vertical blank: sprites
void view_erase_tile(unsigned col, char row);   // a taken coin, on the page on display
char *page_ptr(char page);

// ---- HUD, score, sound (hud.c, sound.c) --------------------------------------------------------------
extern char score[6], hiscore[6];   // decimal digits, most significant first
extern char lives, coins;
extern bool hud_dirty;
void put_text(char row, char col, const char *s);
void hud_clear(void);
void hud_labels(void);             // once per level: the words around the figures
void hud_draw(void);
void hud_hiscore(void);
void score_add(char hundreds, char tens);

enum Sfx { SFX_JUMP, SFX_COIN, SFX_STOMP, SFX_HURT };
void sfx_play(char id);
void sfx_update(void);

// ---- events the verdict checks (main.c) ------------------------------------------------------
#define EV_JUMP     0x0001
#define EV_LAND     0x0002
#define EV_SLOPE    0x0004          // stood on a slope cell
#define EV_LEDGE    0x0008          // landed on a one-way ledge
#define EV_COIN     0x0010
#define EV_STOMP    0x0020
#define EV_HURT     0x0040
#define EV_RESPAWN  0x0080
#define EV_WAKE     0x0100
#define EV_SLEEP    0x0200          // a live actor went back to the level table
#define EV_SHIFT_L  0x0400          // the camera crossed a column going right
#define EV_SHIFT_R  0x0800          // and going left
#define EV_BLOCKED  0x1000          // a wall stopped the player
extern unsigned events;
extern char stomps;
extern bool goal_reached;           // the player touched the flag
void player_hurt(void);             // main.c owns lives and the state machine

#pragma compile("level.c")
#pragma compile("art.c")
#pragma compile("anim.c")
#pragma compile("player.c")
#pragma compile("actors.c")
#pragma compile("view.c")
#pragma compile("hud.c")
#pragma compile("sound.c")

#endif
