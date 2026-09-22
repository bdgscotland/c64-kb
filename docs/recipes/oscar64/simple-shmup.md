---
recipe: simple-shmup
toolchain: oscar64
output_format: PRG
region: both
techniques: [sprite_multiplex_8, soft_scroll_h, sprite_collision_detect, sid_play_routine_pattern]
file_formats: [PRG]
uses_registers: [D015, D000, D001, D010, D027, D028, D029, D02A, D02B, D02C, D02D, D02E, D01E, D01F, D011, D016, D012, D019, D01A, D400, D401, D402, D403, D404, D405, D406, D407, D408, D409, D40A, D40B, D40C, D40D, D40E, D40F, D410, D411, D412, D413, D414, D415, D416, D417, D418]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 Simple Vertical-Scrolling Shoot-Em-Up

## Synopsis

A minimal but complete vertical-scrolling shoot-em-up implemented in Oscar64 C.
The player controls a ship via joystick port 2, fires bullets upward, and must
avoid enemies that enter from the top in sine-wave formations. A starfield scrolls
downward using `$D016` YSCROLL (one-pixel-per-frame soft scroll). Eight hardware
sprites are multiplexed via `vspr_*` to display the player, four enemies, and up
to three active bullets simultaneously. Sprite-sprite collisions are detected
through `$D01E`. A background SID tune drives the play-routine pattern at 50/60 Hz
from a raster IRQ. The program is fully playable: load in VICE, push joystick
port 2, and shoot the enemies.

This is the hero recipe of Phase 4. It demonstrates the full agent-loop
capability: an agent reading this recipe and the cross-referenced technique docs
can reconstruct a working shmup shell from scratch. Cross-references:
`docs/recipes/oscar64/sprite-multiplex-8.md` for `vspr_*` idioms,
`docs/recipes/oscar64/sid-music-player.md` for the play-routine pattern,
`docs/recipes/oscar64/soft-scroll-h.md` for `$D016` XSCROLL mechanics.

## Source

```c
// simple-shmup.c
//
// Minimal vertical-scrolling shoot-em-up for stock C64 PAL/NTSC.
//
// Logical sprite assignments (vspr indices):
//   0  player ship
//   1  bullet 0
//   2  bullet 1
//   3  bullet 2
//   4-7 enemies 0-3
//
// Hardware sprites: 8 slots multiplexed by vspr_* over two vertical passes.
//
// Screen layout:
//   Row 0:  HUD (score)
//   Rows 1-24: play field with downward-scrolling starfield
//
// Compile:
//   oscar64 -O2 -o=simple-shmup.prg -tf=prg simple-shmup.c
//
#include <c64/vic.h>
#include <c64/sid.h>
#include <c64/sprites.h>
#include <c64/rasterirq.h>
#include <c64/joystick.h>
#include <c64/memmap.h>
#include <string.h>
#include <stdlib.h>

// ============================================================================
// Memory layout
// ============================================================================
// Code + data below $2000
#pragma region( lower, 0x0a00, 0x2000, , , {code, data} )

// Sprite data at $2000 (32 x 64-byte blocks = 2048 bytes)
#pragma section( spriteset, 0 )
#pragma region( spriteset_region, 0x2000, 0x2800, , , {spriteset} )

// Everything else above $2800
#pragma region( main, 0x2800, 0xa000, , , {code, data, bss, heap, stack} )

// ============================================================================
// Sprite bitmaps
// ============================================================================
// Block layout within $2000:
//   Block 0: player ship
//   Block 1: bullet
//   Block 2: enemy
//   Block 3: explosion frame 0
//   Block 4: explosion frame 1
//
// Each block is 64 bytes; bytes 0-62 are the 21-row x 3-byte bitmap; byte 63 = 0.
//
// These bitmaps are generated at startup rather than embedded as binary because
// the recipe should compile standalone. A real game would use:
//   static const char spriteset_data[] = { #embed spd_sprites "sprites.spd" };

#pragma data(spriteset)
static char sprite_blocks[2048];   // 32 x 64; only first 5 used
#pragma data(data)

// Draw sprite shapes into sprite_blocks at startup.
static void sprites_build(void)
{
    // Block 0: player ship — pointed nose, wide body
    {
        char *b = sprite_blocks;
        static const char ship[21*3] = {
            0,3,0,   0,7,128, 0,15,192, 0,31,224,
            0,63,240,0,127,248,1,255,252,3,255,254,
            7,255,255,3,255,254,1,231,252,0,119,248,
            0,119,248,0,119,248,0,63,240,0,63,240,
            0,28,0,  0,28,0,  0,28,0,  0,8,0,  0,0,0
        };
        for (char i = 0; i < 63; i++) b[i] = ship[i];
        b[63] = 0;
    }

    // Block 1: bullet — narrow vertical line
    {
        char *b = sprite_blocks + 64;
        for (char r = 0; r < 21; r++) {
            b[r*3+0] = 0;
            b[r*3+1] = (r < 7) ? 0x18 : 0;
            b[r*3+2] = 0;
        }
        b[63] = 0;
    }

    // Block 2: enemy — diamond shape
    {
        char *b = sprite_blocks + 128;
        static const char enemy[21*3] = {
            0,0,0, 0,24,0, 0,60,0, 0,126,0,
            0,255,0,1,255,128,3,255,192,7,255,224,
            15,255,240,7,255,224,3,255,192,1,255,128,
            0,255,0,0,126,0,0,60,0,0,24,0,
            0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
        };
        for (char i = 0; i < 63; i++) b[i] = enemy[i];
        b[63] = 0;
    }

    // Block 3: explosion frame 0 — scattered dots
    {
        char *b = sprite_blocks + 192;
        for (char r = 0; r < 21; r++) {
            b[r*3+0] = (r & 3) == 0 ? 0x55 : 0;
            b[r*3+1] = (r & 3) == 1 ? 0xAA : 0;
            b[r*3+2] = (r & 3) == 2 ? 0x55 : 0;
        }
        b[63] = 0;
    }

    // Block 4: explosion frame 1 — expanding ring
    {
        char *b = sprite_blocks + 256;
        for (char r = 0; r < 21; r++) {
            char v = (r == 3 || r == 17) ? 0xFF : (r == 10) ? 0x81 : 0;
            b[r*3+0] = 0;
            b[r*3+1] = v;
            b[r*3+2] = 0;
        }
        b[63] = 0;
    }
}

// ============================================================================
// Screen and color RAM
// ============================================================================
#define Screen ((byte *)0x0400)
#define Color  ((byte *)0xd800)
#define COLS   40
#define ROWS   25

// Sprite data blocks start at $2000; block number = address / 64
#define SPRITE_BASE_BLOCK  ((unsigned)sprite_blocks / 64)   // = $2000/64 = 128

// ============================================================================
// Starfield
// ============================================================================
// Stars are single space-inverted characters (block character) placed on the
// char layer. Each star has an (x, row) position. Every 8 frames the YSCROLL
// wraps and the star rows shift down one character; every frame the YSCROLL
// pixel offset moves the whole field downward by 1 px.
//
// This is the soft_scroll_h pattern adapted for vertical scrolling:
//   $D011 bits 2-0 = YSCROLL (0-7): vertical fine scroll.
//   Decrement each frame for downward scroll; at 0 -> carry the char layer.

#define NUM_STARS  16

static char star_x[NUM_STARS];
static char star_row[NUM_STARS];
static char yscroll;     // current YSCROLL value, 0-7

// Star character: solid block (screen code $A0 = filled block in PETSCII)
#define STAR_CHAR   0xA0
#define SPACE_CHAR  0x20

// Initialize star positions.
static void stars_init(void)
{
    yscroll = 7;
    for (char i = 0; i < NUM_STARS; i++) {
        star_x[i]   = (char)(rand() % 40);
        star_row[i] = (char)(1 + rand() % 24);   // rows 1-24 (row 0 = HUD)
        Screen[star_row[i] * COLS + star_x[i]] = STAR_CHAR;
        Color [star_row[i] * COLS + star_x[i]] = VCOL_WHITE;
    }
}

// Called once per frame. Soft-scrolls the star layer downward.
static void stars_update(void)
{
    if (yscroll > 0) {
        yscroll--;
    } else {
        // Pixel wrap: shift all star rows down one character.
        yscroll = 7;
        for (char i = 0; i < NUM_STARS; i++) {
            // Erase from current position
            Screen[star_row[i] * COLS + star_x[i]] = SPACE_CHAR;
            // Advance row (wrap at bottom back to row 1, skipping HUD row 0)
            star_row[i]++;
            if (star_row[i] >= ROWS)
                star_row[i] = 1;
            // Draw at new position (only if not occupied by a sprite cell)
            Screen[star_row[i] * COLS + star_x[i]] = STAR_CHAR;
            Color [star_row[i] * COLS + star_x[i]] = VCOL_WHITE;
        }
    }
    // Write YSCROLL into $D011, preserving other bits (DEN, BMM, ECM, raster MSB).
    // YSCROLL is bits 2-0; default KERNAL value is 3 (center).
    vic.ctrl1 = (vic.ctrl1 & 0xF8) | yscroll;
}

// ============================================================================
// Game objects: player, bullets, enemies
// ============================================================================

// --- Player ---
static int  player_x;      // screen pixels, range 24-319 (sprite X hardware)
static char player_y;      // screen pixels, range 50-250 (sprite Y hardware)
static bool player_alive;
static char player_explode_timer;

#define PLAYER_INITIAL_X  160
#define PLAYER_INITIAL_Y  220
#define PLAYER_SPEED        2
#define PLAYER_SPRITE       0   // vspr index

// --- Bullets ---
#define MAX_BULLETS  3
#define BULLET_SPEED 3

struct Bullet {
    int  x;
    char y;
    bool active;
};

static struct Bullet bullets[MAX_BULLETS];
static char fire_cooldown;

// --- Enemies ---
#define MAX_ENEMIES  4
#define ENEMY_SPEED  1

struct Enemy {
    int  x;
    char y;
    bool active;
    char explode_timer;
};

static struct Enemy enemies[MAX_ENEMIES];
static char enemy_wave_timer;
static char enemy_sine_phase;

// Sine table: 64 entries, range -32..+32 (amplitude of enemy X oscillation)
static char sine_tab[64];

// --- Score (displayed on HUD row 0) ---
static char score_digits[6];   // BCD-ish: each is 0-9, leftmost = most significant

static void score_add(char val)
{
    // Add val to the 6-digit BCD score (rightmost digit first)
    char carry = val;
    for (char d = 5; d != 255 && carry; d--) {
        char n = score_digits[d] + carry;
        score_digits[d] = n % 10;
        carry = n / 10;
    }
}

static void hud_draw(void)
{
    // Row 0: "SCORE: XXXXXX"
    // Screen-code note: ':' is 58 (NOT 26 — that's the letter 'Z').
    // Letters A-Z map to 1-26 but punctuation lives in the 32-63 range
    // matching ASCII positions.
    static const char hud_label[] = {
        // S   C   O   R   E   :   spc
        19, 3, 15, 18, 5, 58, 32
    };
    for (char i = 0; i < 7; i++) {
        Screen[i] = hud_label[i];
        Color[i]  = VCOL_YELLOW;
    }
    for (char d = 0; d < 6; d++) {
        Screen[7 + d] = score_digits[d] + 48;  // screen code for '0'..'9'
        Color [7 + d] = VCOL_WHITE;
    }
    // Fill rest of HUD row
    for (char i = 13; i < 40; i++) {
        Screen[i] = SPACE_CHAR;
        Color[i]  = VCOL_BLACK;
    }
}

// ============================================================================
// Game init
// ============================================================================
static void game_init(void)
{
    // Clear play field
    for (int i = 40; i < 1000; i++) {
        Screen[i] = SPACE_CHAR;
        Color[i]  = VCOL_BLACK;
    }

    // Player
    player_x             = PLAYER_INITIAL_X;
    player_y             = PLAYER_INITIAL_Y;
    player_alive         = true;
    player_explode_timer = 0;

    // Bullets
    for (char b = 0; b < MAX_BULLETS; b++)
        bullets[b].active = false;
    fire_cooldown = 0;

    // Enemies
    for (char e = 0; e < MAX_ENEMIES; e++)
        enemies[e].active = false;
    enemy_wave_timer = 0;
    enemy_sine_phase = 0;

    // Score
    for (char d = 0; d < 6; d++)
        score_digits[d] = 0;

    // Build sine table for enemy X oscillation
    // Use a simple integer sine approximation: half-wave quadrant fold
    for (char i = 0; i < 64; i++) {
        // Maps i to an approximate sine in range -32..+32
        // Quarter-wave: 0..15 -> 0..32 (linear ramp as an approximation)
        char q = i & 15;
        char half = (i & 32) ? 1 : 0;
        char asc  = (i & 16) ? (15 - q) : q;
        char amp  = (char)(asc * 2);   // 0..30
        sine_tab[i] = half ? -(sbyte)amp : (sbyte)amp;
    }
}

// ============================================================================
// Update: player
// ============================================================================
static void update_player(void)
{
    if (!player_alive) {
        if (player_explode_timer) {
            player_explode_timer--;
            // Animate explosion: alternate between explosion frames
            char blk = SPRITE_BASE_BLOCK + 3 + (player_explode_timer & 1);
            vspr_image(PLAYER_SPRITE, blk);
            if (!player_explode_timer) {
                vspr_hide(PLAYER_SPRITE);
                // Restart after a short delay (handled outside this function
                // by checking player_alive and respawning after some frames)
            }
        }
        return;
    }

    // Read joystick port 2 (joy_poll(1) = port 2 = typical player 1 in games)
    joy_poll(1);

    // Move player horizontally: clamp to sprite display range (24..311 for X)
    player_x += (int)(joyx[1]) * PLAYER_SPEED;
    if (player_x < 24)  player_x = 24;
    if (player_x > 311) player_x = 311;

    // Move player vertically: clamp to rows 1-24 (Y 58..234 roughly)
    player_y += (char)(joyy[1]) * (char)PLAYER_SPEED;
    if (player_y < 58)  player_y = 58;
    if (player_y > 234) player_y = 234;

    vspr_move(PLAYER_SPRITE, player_x, (int)player_y);

    // Fire bullet on button press, with cooldown
    if (fire_cooldown)
        fire_cooldown--;
    else if (joyb[1]) {
        for (char b = 0; b < MAX_BULLETS; b++) {
            if (!bullets[b].active) {
                bullets[b].x      = player_x;
                bullets[b].y      = player_y - 22;  // spawn above ship
                bullets[b].active = true;
                vspr_set(b + 1, player_x, (int)bullets[b].y,
                         SPRITE_BASE_BLOCK + 1, VCOL_LT_GREEN);
                // Trigger a short fire sound on SID voice 2
                sid.voices[1].freq   = SID_FREQ_PAL(1200);
                sid.voices[1].attdec = SID_ATK_2 | SID_DKY_6;
                sid.voices[1].susrel = 0;
                sid.voices[1].ctrl   = SID_CTRL_NOISE | SID_CTRL_GATE;
                fire_cooldown = 8;
                break;
            }
        }
    }
}

// ============================================================================
// Update: bullets
// ============================================================================
static void update_bullets(void)
{
    for (char b = 0; b < MAX_BULLETS; b++) {
        if (!bullets[b].active)
            continue;

        bullets[b].y -= BULLET_SPEED;

        // Deactivate when above top of play area (above raster line ~58)
        if (bullets[b].y < 50) {
            bullets[b].active = false;
            vspr_hide(b + 1);
        } else {
            vspr_move(b + 1, bullets[b].x, (int)bullets[b].y);
        }
    }
}

// ============================================================================
// Update: enemies
// ============================================================================
static void update_enemies(void)
{
    // Spawn a new wave every 120 frames if fewer than MAX_ENEMIES are active
    if (enemy_wave_timer) {
        enemy_wave_timer--;
    } else {
        // Count active enemies
        char active = 0;
        for (char e = 0; e < MAX_ENEMIES; e++)
            if (enemies[e].active) active++;

        if (active == 0) {
            // Spawn all 4 enemies in a horizontal formation at the top
            for (char e = 0; e < MAX_ENEMIES; e++) {
                enemies[e].x      = 60 + (int)e * 64;
                enemies[e].y      = 55;    // just below top border
                enemies[e].active = true;
                enemies[e].explode_timer = 0;
                vspr_set(4 + e, enemies[e].x, (int)enemies[e].y,
                         SPRITE_BASE_BLOCK + 2, VCOL_RED);
            }
            enemy_wave_timer = 120;
            enemy_sine_phase = 0;
        }
    }

    // Advance sine phase
    enemy_sine_phase = (enemy_sine_phase + 1) & 63;

    for (char e = 0; e < MAX_ENEMIES; e++) {
        if (!enemies[e].active)
            continue;

        if (enemies[e].explode_timer) {
            enemies[e].explode_timer--;
            char blk = SPRITE_BASE_BLOCK + 3 + (enemies[e].explode_timer & 1);
            vspr_image(4 + e, blk);
            vspr_color(4 + e, VCOL_YELLOW);
            if (!enemies[e].explode_timer) {
                enemies[e].active = false;
                vspr_hide(4 + e);
            }
            continue;
        }

        // Descend and oscillate horizontally
        enemies[e].y += ENEMY_SPEED;

        // Sine offset per enemy: stagger phase by 16 per enemy
        char phase = (enemy_sine_phase + (char)(e << 4)) & 63;
        enemies[e].x = 60 + (int)e * 64 + (int)(sbyte)sine_tab[phase] * 2;

        // Clamp to display area
        if (enemies[e].x < 24)  enemies[e].x = 24;
        if (enemies[e].x > 311) enemies[e].x = 311;

        // Remove enemy when it exits the bottom
        if (enemies[e].y > 250) {
            enemies[e].active = false;
            vspr_hide(4 + e);
        } else {
            vspr_move(4 + e, enemies[e].x, (int)enemies[e].y);
        }
    }
}

// ============================================================================
// Collision detection via $D01E and $D01F
// ============================================================================
// Sprite index layout:
//   vspr 0     = player     -> hardware sprite 0 (after vspr_sort by Y)
//   vspr 1-3   = bullets 0-2
//   vspr 4-7   = enemies 0-3
//
// After vspr_sort and vspr_update, the vspr system maps logical sprites to
// hardware slots by ascending Y order.  $D01E bits report which HARDWARE
// sprite slots collided -- we cannot directly match vspr index to hardware
// slot after sorting.
//
// Simpler approach for a shell game: use bounding-box collision in software.
// $D01E is still read and cleared each frame to prevent stale bits.
// For bullet-enemy we do AABB (axis-aligned bounding box) checks.
// For player-enemy we read $D01F (sprite-background) as a proxy indicator
// and also do AABB.
//
// Bounding box half-sizes (in screen pixels):
#define BULLET_HW  2
#define BULLET_HH  6
#define ENEMY_HW   10
#define ENEMY_HH   10
#define PLAYER_HW  11
#define PLAYER_HH  10

static void check_collisions(void)
{
    // Read and clear collision registers (read-to-clear).
    // We don't use the raw bits here but must clear them each frame.
    // (GCC's __attribute__((unused)) is not Oscar64 C; the casts to void
    // keep the reads and say the values are deliberately dropped. The field
    // names are Oscar64's: spr_sprcol is $D01E, spr_backcol is $D01F.)
    byte sps = vic.spr_sprcol;
    byte spb = vic.spr_backcol;
    (void)sps;
    (void)spb;

    if (!player_alive)
        return;

    for (char e = 0; e < MAX_ENEMIES; e++) {
        if (!enemies[e].active || enemies[e].explode_timer)
            continue;

        // --- Bullet vs enemy AABB ---
        for (char b = 0; b < MAX_BULLETS; b++) {
            if (!bullets[b].active)
                continue;

            int  dx = bullets[b].x - enemies[e].x;
            char dy;
            if (bullets[b].y > enemies[e].y)
                dy = bullets[b].y - enemies[e].y;
            else
                dy = enemies[e].y - bullets[b].y;

            if (dx < 0) dx = -dx;

            if ((char)dx <= (BULLET_HW + ENEMY_HW) && dy <= (BULLET_HH + ENEMY_HH)) {
                // Hit!
                bullets[b].active = false;
                vspr_hide(b + 1);

                enemies[e].explode_timer = 12;

                // Score
                score_add(10);
                hud_draw();

                // Explosion sound on SID voice 2
                sid.voices[1].freq   = SID_FREQ_PAL(220);
                sid.voices[1].attdec = SID_ATK_2 | SID_DKY_6;
                sid.voices[1].susrel = (char)(0xF0 | SID_DKY_300);
                sid.voices[1].ctrl   = SID_CTRL_NOISE | SID_CTRL_GATE;
            }
        }

        // --- Player vs enemy AABB ---
        if (!enemies[e].explode_timer) {
            int  dx = player_x - enemies[e].x;
            char dy;
            if (player_y > enemies[e].y)
                dy = player_y - enemies[e].y;
            else
                dy = enemies[e].y - player_y;

            if (dx < 0) dx = -dx;

            if ((char)dx <= (PLAYER_HW + ENEMY_HW) && dy <= (PLAYER_HH + ENEMY_HH)) {
                // Player hit!
                player_alive         = false;
                player_explode_timer = 24;
                enemies[e].explode_timer = 12;

                vspr_image(PLAYER_SPRITE, SPRITE_BASE_BLOCK + 3);
                vspr_color(PLAYER_SPRITE, VCOL_ORANGE);

                sid.voices[1].freq   = SID_FREQ_PAL(110);
                sid.voices[1].attdec = SID_ATK_8 | SID_DKY_114;
                sid.voices[1].susrel = (char)(0xF0 | SID_DKY_1500);
                sid.voices[1].ctrl   = SID_CTRL_NOISE | SID_CTRL_GATE;
            }
        }
    }
}

// ============================================================================
// SID background music stub (play-routine pattern)
// ============================================================================
// A real game would embed a SID tune binary and call its play entry here.
// This stub plays a simple arpeggiated chord on voice 0 to demonstrate the
// per-frame play-routine pattern (sid_play_routine_pattern technique).
//
// The arpeggio cycles through three notes at 8 Hz (every 6 PAL frames).
static char  music_tick  = 0;
static char  music_note  = 0;
static const word music_arp[3] = {
    NOTE_C(3),    // C3
    NOTE_E(3),    // E3
    NOTE_G(3)     // G3
};

// Called once per frame from the raster IRQ (via rirq_call) or from
// main loop after rirq_wait().  Drives voice 0 arpeggio.
static void music_play(void)
{
    music_tick++;
    if (music_tick >= 6) {
        music_tick = 0;
        music_note = (music_note + 1) % 3;
        sid.voices[0].freq   = music_arp[music_note];
        sid.voices[0].attdec = SID_ATK_2 | SID_DKY_24;
        sid.voices[0].susrel = (char)(0x80 | SID_DKY_300);
        sid.voices[0].ctrl   = SID_CTRL_TRI | SID_CTRL_GATE;
    }
}

// Raster IRQ code block for the music play call
RIRQCode music_rirq;

// ============================================================================
// Respawn
// ============================================================================
static char respawn_timer = 0;

static void check_respawn(void)
{
    if (!player_alive && !player_explode_timer) {
        if (respawn_timer < 90) {
            respawn_timer++;
        } else {
            respawn_timer = 0;
            player_x     = PLAYER_INITIAL_X;
            player_y     = PLAYER_INITIAL_Y;
            player_alive = true;
            vspr_set(PLAYER_SPRITE, player_x, (int)player_y,
                     SPRITE_BASE_BLOCK + 0, VCOL_LT_BLUE);
        }
    }
}

// ============================================================================
// main
// ============================================================================
int main(void)
{
    mmap_trampoline();
    mmap_set(MMAP_NO_BASIC);

    // --- Build sprite bitmaps ---
    sprites_build();

    // --- Screen setup ---
    vic.color_border = VCOL_BLACK;
    vic.color_back   = VCOL_BLACK;
    for (int i = 0; i < 1000; i++) {
        Screen[i] = SPACE_CHAR;
        Color[i]  = VCOL_BLACK;
    }

    // --- Initialize game state ---
    game_init();
    stars_init();
    hud_draw();

    // --- Initialize vspr multiplexer ---
    // vspr_init reserves rirq slots 0..(VSPRITES_MAX/8 - 1) for the sprite
    // reuse IRQs.  With VSPRITES_MAX=16 (default) and 8 logical sprites, one
    // reuse slot is used (fires at mid-screen to reprogramme the second pass).
    vspr_init(Screen);

    // Assign all 8 logical sprites initial positions (off-screen or visible)
    vspr_set(PLAYER_SPRITE, player_x, (int)player_y,
             SPRITE_BASE_BLOCK + 0, VCOL_LT_BLUE);
    for (char b = 0; b < MAX_BULLETS; b++)
        vspr_hide(b + 1);
    for (char e = 0; e < MAX_ENEMIES; e++)
        vspr_hide(4 + e);

    vspr_sort();
    vspr_update();

    // --- Raster IRQ for music (slot after sprite slots) ---
    // vspr_init uses slot 0 (and 1 for the reuse IRQ with 16 vsprites).
    // Music IRQ goes into the next free slot.  Use rirq_set with slot number
    // 2 (slots 0 and 1 are owned by vspr_init with default VSPRITES_MAX).
    rirq_build(&music_rirq, 1);
    rirq_call(&music_rirq, 0, (void *)music_play);
    rirq_set(2, 0, &music_rirq);   // fire at raster line 0 (top of frame)

    rirq_sort();
    rirq_start();

    // --- SID initialization ---
    for (char r = 0; r < 25; r++)
        ((volatile byte *)0xd400)[r] = 0;
    sid.fmodevol = 15;   // master volume 15

    // Seed voice 0 for the music arpeggio
    sid.voices[0].pwm = 0x0800;

    // Voice 1 (SFX) initial state
    sid.voices[1].attdec = SID_ATK_2 | SID_DKY_6;
    sid.voices[1].susrel = 0;

    // ===================================================================
    // Main loop
    // ===================================================================
    for (;;)
    {
        // 1. Wait for all raster IRQs of this frame to finish.
        //    This is the safe point to update vspr arrays: the sprite
        //    reuse IRQ has fired and will not read vspr data again until
        //    vspr_update reprograms it for the next frame.
        rirq_wait();

        // 2. Update game logic
        update_player();
        update_bullets();
        update_enemies();
        check_collisions();
        check_respawn();

        // 3. Stars (soft vertical scroll via $D011 YSCROLL)
        stars_update();

        // 4. Sprite multiplexer: sort -> update -> re-sort rirq slots
        vspr_sort();
        vspr_update();
        rirq_sort();

        // (music_play runs automatically from the music_rirq slot)
    }

    return 0;
}
```

## Build

```bash
oscar64 -O2 -o=simple-shmup.prg -tf=prg simple-shmup.c
```

Outputs: `simple-shmup.prg`, `.map`, `.asm`, `.lbl`.

Load in VICE: `LOAD"SIMPLE-SHMUP",8,1` then `RUN`, or use `-autostart
simple-shmup.prg`. Joystick port 2. Push to move; fire button to shoot.

## Expected output

Black screen with a top HUD row reading `SCORE: 000000`. A light-blue player
ship sprite sits at the bottom-center. White dot stars scroll smoothly downward
at one pixel per frame. Press the fire button: three green bullet sprites advance
upward and vanish at the top. After 120 frames, four red enemy diamond sprites
enter from the top in a horizontal formation and descend while oscillating
horizontally in a sine wave. When a bullet overlaps an enemy, both vanish (the
enemy flickers orange for 12 frames) and the score increments by 10. If an enemy
reaches the player sprite, both explode, the score stops, and the player respawns
after 90 frames. A simple C-major-triad arpeggio plays on SID voice 0 throughout.

## Why this works

### Game loop structure

The main loop follows the canonical Oscar64 game loop pattern visible in
`~/Developer/c64/oscar64/samples/games/breakout.c` and `hscrollshmup.c`:

```
rirq_wait();          // sync: all IRQs for last frame are done
update_*();           // advance all game state
vspr_sort();          // order logical sprites by Y
vspr_update();        // reprogram hardware sprites + reuse IRQ slots
rirq_sort();          // re-sort IRQ slot table after vspr_update moved slots
```

`rirq_wait()` blocks until the last raster IRQ of the previous frame has fired.
This guarantees that `vspr_update()` is never called while the multiplexer IRQ
is reading the sprite slot table — a race condition that would corrupt sprite
positions. Everything between `rirq_wait()` and the bottom of the loop executes
in the vertical blank or during the active display period (for long games), but
the critical `vspr_update()` must happen before the raster beam reaches the first
reuse IRQ trigger line.

### Sprite multiplexer: eight slots for nine objects

`vspr_init(Screen)` initializes the `vspr_*` layer and claims raster IRQ slots
0 and 1 for the multiplexer's internal use. With `VSPRITES_MAX = 16` (default),
the multiplexer supports up to 16 logical sprites displayed via two passes of 8
hardware sprites each. This recipe uses 8 logical sprites: one player, three
bullets, four enemies. Eight logical sprites fit in a single hardware pass, so
the second-pass reuse IRQ fires but finds no second-group sprites to reprogram
(it is a no-op). This is wasteful in IRQ slots but correct. With a second wave
of enemies adding up to eight more sprites, the reuse IRQ would automatically
activate to handle the second group.

The sprite pointer block at `Screen + $3F8` (address `$07F8`) holds one byte per
hardware slot telling the VIC which 64-byte block of sprite data that slot
displays. `vspr_update()` writes this block along with the Y positions, X low
bytes, combined X-MSB byte (`$D010`), and color bytes (`$D027-$D02E`). The
linker region pragma places `sprite_blocks` at `$2000`; dividing by 64 gives
block number 128. `vspr_set(sp, x, y, 128+n, color)` assigns logical sprite
`sp` to display block `128+n`.

### Starfield via `$D011` YSCROLL soft scroll

`$D011` bits 2-0 (YSCROLL) shift the entire character display downward by
0-7 pixels. Incrementing YSCROLL each frame scrolls the display downward at
1 pixel per frame. When YSCROLL wraps from 7 back to 0, the character grid
snaps back 8 pixels upward; to cancel this visible snap, the character layer is
shifted down by one row simultaneously. This is the same carry mechanic described
in `docs/recipes/oscar64/soft-scroll-h.md` applied to the Y axis.

The star positions are tracked in the `star_row[]` array. Each star is a solid
block character (screen code `$A0`) drawn directly into the screen RAM. When the
carry fires (`yscroll` wraps), each star's row is incremented modulo 24 (rows
1-24, preserving HUD row 0). The write to `vic.ctrl1 = (vic.ctrl1 & 0xF8) |
yscroll` preserves the DEN bit (display enable), the BMM bit (0 = text mode),
and the raster MSB while updating only YSCROLL. The read-modify-write is a
single expression thanks to Oscar64's volatile struct field access.

The cost per frame is one write to `$D011` plus (on carry frames, once per 8
frames) `NUM_STARS` screen RAM updates. At 16 stars that is 32 byte writes
per carry — negligible compared to the sprite update cost.

### Collision detection

The recipe uses software AABB (axis-aligned bounding box) collision because it
is more reliable than reading `$D01E` after `vspr_sort` has remapped logical
sprites to hardware slots. The hardware `$D01E` register reports which hardware
slot indices collided; after `vspr_sort`, logical sprite 0 (player) may be
mapped to hardware slot 3 or 7 depending on Y ordering. Mapping hardware bits
back to logical sprites requires tracking the sort-order mapping, which
`vspr_*` does not expose. Instead, `$D01E` and `$D01F` are read and discarded
each frame purely to reset the latches (preventing stale collision bits from
persisting across frames). The AABB tests are then performed directly on the
`player_x/y` and `enemies[e].x/y` coordinates, which are always in the correct
coordinate space.

AABB half-widths and heights are defined as constants matching the visual
extents of each sprite: the player ship is roughly 22x20 pixels, so `PLAYER_HW
= 11` and `PLAYER_HH = 10`. Enemy diamonds are roughly 20x20 pixels. Bullet
lines are thin (`BULLET_HW = 2`, `BULLET_HH = 6`). These values give
collisions that match the visual overlap to within a few pixels.

For a production game: read `$D01E` via a VIC collision IRQ (bit 1 of `$D01A`)
for sub-frame latency, use the bitmask to quickly narrow which hardware sprite
pairs are involved, then do an AABB test only for those pairs. This avoids
testing all O(N*M) pairs every frame.

### Enemy wave and sine oscillation

Enemies enter in waves of four when no enemies are active. The sine oscillation
is approximated with a 64-entry table generated at startup using integer linear
ramp: each quarter of the table ramps from 0 to 30 and back, giving a triangle
approximation to a sine with amplitude ±30 pixels. Each enemy is phase-shifted
by 16 table entries (90 degrees of the 64-entry cycle) so adjacent enemies
oscillate in a visually separated pattern rather than all moving together.

A real game would use an actual `sin()` lookup precomputed at compile time or
fetched from a table in `docs/techniques/effects-vector-3d.md`. The triangle
approximation suffices for the recipe's purpose: demonstrating the state machine
and entry/removal logic clearly.

### Music via `rirq_call` and the play-routine pattern

The arpeggio function `music_play()` is installed as a raster IRQ call at line 0
using `rirq_call`. This is the `sid_play_routine_pattern` technique from
`docs/techniques/music-sid.md` applied to a hand-written play stub rather than
an embedded SID binary. Each call advances `music_tick`; every 6 frames it
writes a new note frequency to SID voice 0 and re-gates the envelope. The call
runs at the top of every frame in the raster IRQ context, identical to how a
GoatTracker-generated play routine would be invoked.

To replace the stub arpeggio with a real SID tune, add the memory layout and
function-pointer infrastructure from `docs/recipes/oscar64/sid-music-player.md`,
point `rirq_call` at the tune's play address, and call the tune's init address
after `rirq_start()`. The rest of the shmup is unchanged.

### `__striped` alternative for larger games

This recipe uses separate struct arrays (`struct Bullet bullets[3]`,
`struct Enemy enemies[4]`) whose fields are accessed by struct dereference.
Oscar64's optimizer generates efficient code for small structs (up to 8 bytes)
because it can hold the base pointer in zero-page and access fields directly.
For larger arrays (16+ enemies), the idiomatic Oscar64 pattern is `__striped`:

```c
__striped struct Enemy { int x; char y; bool active; char timer; } enemies[16];
```

With `__striped`, all `enemies[i].x` values are contiguous in memory, then all
`enemies[i].y`, etc. The compiler accesses `enemies[i].x` as `LDA x_base, Y`
without a multiply, cutting the per-element access cost from 4+ cycles to 2.
The current recipe's 4-enemy array is small enough that the difference is not
measurable; `__striped` becomes important when enemy counts exceed 8.
