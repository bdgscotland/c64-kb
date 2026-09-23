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
#ifndef FLICKER_DEMO
#define FLICKER_DEMO 0              // 1: the fighter band drops its last part (tools/flickercheck.py must see it)
#endif

// ---- memory: VIC bank 3 ($C000-$FFFF) -----------------------------------
#define PAGE0     ((char *)0xc000)  // street pages (rows 0-19 used, 20 blank)
#define PAGE1     ((char *)0xc400)
#define HUDPAGE   ((char *)0xc800)  // the HUD rows 21-24 are read from here
#define CHARSET   ((char *)0xe000)  // RAM under the KERNAL, which is banked out
#define SPRMEM    ((char *)0xf000)  // sprite blocks 192-254
#define COLOUR    ((char *)0xd800)
#define SPR_BLOCK 192               // block number of SPRMEM in bank 3
#define D018_PAGE0 0x08             // screen $C000, characters $E000
#define D018_PAGE1 0x18             // screen $C400
#define D016_PLAY  0x10             // multicolour, 38 columns; | XSCROLL
#define RESULT    (*(volatile char *)0x02ff)   // $01 pass, $02 fail

#define PF_ROWS    20               // street character rows
#define HUD_ROW    21               // first HUD row

// ---- colours ------------------------------------------------------------------
#define COL_ROAD   VCOL_DARK_GREY   // $D021: pavement and road
#define COL_BRICK  VCOL_BROWN       // $D022
#define COL_LIGHT  VCOL_YELLOW      // $D023: windows, lamps, road marks
#define COL_SKIN   VCOL_LT_RED      // $D025: sprite pixels 01
#define COL_INK    VCOL_BLACK       // $D026: sprite pixels 11 (hair, outline, shoes)

// ---- joystick (active low, as $DC00 reads it) --------------------------------
#define JOY_UP    0x01
#define JOY_DOWN  0x02
#define JOY_LEFT  0x04
#define JOY_RIGHT 0x08
#define JOY_FIRE  0x10

// ---- the street (street.c) ----------------------------------------------------
#define LEVEL_TW  64                // tiles across; a tile is 2 x 2 characters
#define LEVEL_TH  10                // tiles down: the 20 street rows
#define LEVEL_CW  (LEVEL_TW * 2)    // characters across
#define CAM_MAX   ((LEVEL_CW - 40) * 8)
#define NSTAGE    3
extern const unsigned stage_lock[NSTAGE];      // the camera stops here until the stage is clear
void street_init(void);                        // decode the text into tile indices, once
char cell_char(unsigned col, char row);        // glyph at a world character cell
void level_column(char *dst, unsigned col);    // 20 glyphs down one page column

// Glyphs. 0-63 are the ROM's upper-case set (text, digits, the meter);
// the street's own glyphs start at CH_FIRST. The HUD's bar glyphs follow.
#define CH_SPACE   32
#define CH_FIRST   64
#define CH_SKY     64
#define CH_ROOF    65
#define CH_BRICK   66
#define CH_WIN_T   67
#define CH_WIN_B   68
#define CH_DOOR    69
#define CH_SIGN    70
#define CH_PAVE    71
#define CH_KERB    72
#define CH_ROAD    73
#define CH_DASH    74
#define CH_LAMP    75
#define CH_POLE    76
#define CH_BAR_FULL  77             // hires, HUD only
#define CH_BAR_HALF  78
#define CH_BAR_EMPTY 79
#define CH_COUNT   16

// ---- art (art.c) ----------------------------------------------------------------
// Sprite blocks, facing right; each fighter block has a mirrored twin at
// + B_MIRROR (built at start-up). B_GO and the faces are not mirrored.
enum Block {
    B_T_STAND, B_T_WIND, B_T_PUNCH, B_T_LEAN, B_T_HURT, B_T_JUMP,
    B_L_STAND, B_L_WALK1, B_L_WALK2, B_L_CHAMBER, B_L_KICK, B_L_TUCK, B_L_KNEEL,
    B_D_HEAD, B_D_FEET,
    B_FIGHTER_COUNT,
    B_MIRROR = B_FIGHTER_COUNT,
    B_GO = 2 * B_FIGHTER_COUNT, B_FACE_HERO, B_FACE_THUG, B_FACE_BRUTE,
    B_COUNT
};

// A pose: two parts, each a block and an offset from the fighter's origin
// (his foot column, the ground line under him). dx is the part's left edge
// from the origin facing right; dy is its Y register from the ground line.
enum Pose {
    P_STAND, P_WALK1, P_WALK2, P_WIND, P_PUNCH, P_CHAMBER, P_KICK,
    P_JUMP, P_JKICK, P_HURT, P_DOWN, P_KNEEL,
    P_COUNT
};
struct Part { char block; signed char dx, dy; };
extern const struct Part pose_part[P_COUNT][2];

// Boxes in pixels from the origin, facing right; y is height above the
// ground line (0 at the feet). A hurt box per pose; a hit box per attack.
struct Box { signed char x0, x1; char y0, y1; };
extern const struct Box hurt_box[P_COUNT];     // y1 = 0: none (cannot be hit)
enum HitBox { HB_NONE, HB_PUNCH, HB_KICK, HB_JKICK, HB_COUNT };
extern const struct Box hit_box[HB_COUNT];
void art_build(void);                          // charset and sprite blocks into bank 3

// ---- animation (anim.c) ----------------------------------------------------------
// A sequence is (pose, frames, hit box) triples ending in AN_LOOP n (go to
// triple n), AN_HOLD (stay on the last) or AN_END (done: the fighter's
// move is over). Only the attack frames carry a hit box.
struct Anim { const char *seq; char pos, count; };
extern const char an_stand[], an_walk[], an_punch[], an_kick[], an_jump[], an_jkick[];
extern const char an_hurt[], an_fly[], an_down[], an_kneel[];
void anim_set(struct Anim *a, const char *seq);   // restarts only if it is a new sequence
void anim_start(struct Anim *a, const char *seq); // always restarts
void anim_step(struct Anim *a);
char anim_pose(const struct Anim *a);
char anim_hit(const struct Anim *a);              // the hit box of this frame, HB_NONE mostly
bool anim_done(const struct Anim *a);             // an AN_END sequence has finished

// ---- fighters (fighter.c) -----------------------------------------------------------
// Slot 0 is the player, 1-3 the enemies (an object pool of three).
#define NFIGHT   4
#define NENEMY   3
#define PLANE_TOP 150               // ground lines a fighter may stand on
#define PLANE_BOT 204
#define WIN       6                 // a hit needs the ground lines within 6 (lane_depth_engine)
enum Kind { K_HERO, K_THUG, K_BRUTE };
enum Mode { M_OFF, M_FREE, M_ATTACK, M_JUMP, M_HURT, M_FLY, M_DOWN, M_KNEEL, M_KO };
extern char fmode[NFIGHT], fkind[NFIGHT], fface[NFIGHT], fhp[NFIGHT], ftimer[NFIGHT];
extern unsigned fx[NFIGHT];         // foot column, world pixels
extern char fy[NFIGHT];             // ground line (raster line of the feet)
extern char fh[NFIGHT];             // height above the ground, pixels
extern char farc[NFIGHT];           // index into the arc table while airborne
extern signed char fvx[NFIGHT];     // pixels a frame while airborne or pushed
extern char fcombo[NFIGHT];         // punches landed in a row
extern bool flanded[NFIGHT];        // this attack has already hit
extern struct Anim fanim[NFIGHT];
extern char finvuln[NFIGHT];        // frames of blinking after a respawn
#define FACE_RIGHT 0
#define FACE_LEFT  1
void fighter_spawn(char f, char kind, unsigned x, char y, char face);
void fighter_walk(char f, signed char dx, signed char dy);
void fighter_attack(char f, char move);          // A_PUNCH, A_KICK, A_JUMP
enum Move { A_PUNCH, A_KICK, A_JUMP };
void fighters_step(void);                        // animation, flight, timers
void hits_resolve(void);                         // attacks against the other side
bool fighter_can_act(char f);
extern const char arc[];                         // height by frame of a jump or a fall
#define ARC_JUMP   0                             // arc start indices
#define ARC_FLY    26
void player_control(char joy, char pressed);

// ---- enemies (enemy.c) --------------------------------------------------------------
enum AiState { AI_ENTER, AI_APPROACH, AI_WAIT, AI_ATTACK, AI_RETREAT };
extern char ai_state[NFIGHT], ai_timer[NFIGHT];
extern char stage;                  // 0-2
extern char wave;                   // the stage's next wave
extern bool stage_clear;            // every wave of this stage beaten
void waves_reset(void);
void waves_update(void);            // the wave director: spawns at the lock
void enemies_update(void);          // the AI

// ---- view (view.c) ------------------------------------------------------------------
#define NPAGES 2
extern unsigned camx;               // world pixel at the window's left edge (XSCROLL 7)
extern unsigned shown_col;          // first world column on the page on display
extern char shown_page;
extern int page_col[NPAGES];
extern char page_rows[NPAGES];
extern char order[NFIGHT];          // fighters far to near (the depth sort)
extern char parts_dropped;          // fighter parts that found no sprite (never, by design)
extern bool go_sign;                // blink the GO sign
extern bool faces_off;              // AUTOPILOT photo stops: no faces over the HUD text
extern char face_enemy;             // the enemy whose face and bar the HUD shows, or 0xff
void view_init(void);               // VIC, bank, colours, IRQ chain
void view_cut(void);                // draw both pages at camx; no scrolling
void view_follow(void);             // move the camera after the player; prepare the hidden page
void view_sprites(void);            // the three bands' back tables from the model
void view_publish(void);            // the next picture's page and XSCROLL, for the IRQ at 251
int part_vic_x(char f, char k);     // sprite X of fighter f's part k, as the band tables hold it
char *page_ptr(char page);

// ---- HUD, score, sound (hud.c, sound.c) -----------------------------------------------
extern char score[6], hiscore[6];   // decimal digits, most significant first
extern char lives;
extern bool hud_dirty;
void put_text(char row, char col, const char *s);
void hud_clear(void);
void hud_draw(void);
void hud_hiscore(void);
void score_add(char hundreds, char tens);

enum Sfx { SFX_SWING, SFX_HIT, SFX_DOWN, SFX_JUMP, SFX_KO };
void sfx_play(char id);
void sfx_update(void);

// ---- events and counts the verdict checks (main.c) -----------------------------------
#define EV_PUNCH_HIT 0x0001
#define EV_KICK_HIT  0x0002
#define EV_JKICK_HIT 0x0004
#define EV_KNOCKDOWN 0x0008         // an enemy went down
#define EV_GETUP     0x0010         // and got up again
#define EV_KO        0x0020
#define EV_HERO_HIT  0x0040
#define EV_HERO_DOWN 0x0080
#define EV_LIFE_LOST 0x0100
#define EV_LOCK      0x0200         // the camera stopped at a stage lock
#define EV_UNLOCK    0x0400         // a stage was cleared
#define EV_SCROLL    0x0800         // the camera crossed a column
#define EV_DEPTH     0x1000         // a fighter changed ground line
extern unsigned events;
extern char hits_punch, hits_kick, hits_jkick, kos_thug, kos_brute, locks;
void hero_hurt(void);               // main.c owns lives and the state machine
void enemy_ko(char f);

#pragma compile("street.c")
#pragma compile("art.c")
#pragma compile("anim.c")
#pragma compile("fighter.c")
#pragma compile("enemy.c")
#pragma compile("view.c")
#pragma compile("hud.c")
#pragma compile("sound.c")

#endif
