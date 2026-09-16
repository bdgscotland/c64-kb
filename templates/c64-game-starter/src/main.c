// main.c — c64-game-starter entry point
//
// Demonstrates the foundational Oscar64 game loop pattern:
//   - Joystick port 2 input via joystick.h (joy_poll / joyx / joyy / joyb)
//   - A single hardware sprite (player) moved by the joystick
//   - A score variable displayed as digits on screen row 0
//   - Frame-synchronised main loop via vic_waitBottom()
//
// Build:
//   oscar64 -O2 -o=game.prg -tf=prg src/main.c
//
// References:
//   docs/recipes/oscar64/simple-shmup.md         — full shmup with vspr_*
//   docs/recipes/oscar64/hello-world.md           — minimal build
//   docs/toolchains/oscar64-reference.md           — flag reference
//
// Next steps:
//   1. Call c64_game_briefing("your idea", archetype="shmup") first.
//   2. Add bullets, enemies, and collision following simple-shmup.md.
//   3. Replace the single spr_set call with vspr_* multiplexer for > 8 sprites.
//   4. Wire a SID music player following docs/recipes/oscar64/sid-music-player.md.

#include <c64/vic.h>       // vic struct, VCOL_* constants, spr_* functions, vic_waitBottom
#include <c64/sprites.h>   // spr_set, spr_move, hardware sprite helpers
#include <c64/joystick.h>  // joy_poll, joyx[], joyy[], joyb[]

// ---------------------------------------------------------------------------
// Screen and color RAM
// ---------------------------------------------------------------------------
#define Screen ((char *)0x0400)
#define Color  ((char *)0xd800)
#define COLS   40

// ---------------------------------------------------------------------------
// Sprite data
// Sprite 0 bitmap: a simple plus-sign / crosshair shape.
// 24x21 pixels = 63 bytes (+ 1 pad = 64-byte block).
// Placed at $2000; sprite pointer = $2000 / 64 = 128.
// ---------------------------------------------------------------------------
#pragma section( spriteset, 0 )
#pragma region( spriteset_region, 0x2000, 0x2040, , , {spriteset} )

#pragma data(spriteset)
static char player_sprite[64] = {
    // Row 0-2: vertical bar centre
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    // Row 3: full horizontal bar
    0x7F, 0xFF, 0xFE,
    // Row 4-8: vertical bar
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    // Row 9: full horizontal bar
    0x7F, 0xFF, 0xFE,
    // Row 10-20: vertical bar
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00, 0x18, 0x00,
    0x00  // pad byte
};
#pragma data(data)

// Sprite block number for sprite pointer register ($07F8)
#define PLAYER_SPR_BLOCK  ((unsigned)player_sprite / 64)  // = $2000/64 = 128

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------
static int  player_x  = 160;  // hardware sprite X range: 24-311 (centre ~160)
static char player_y  = 140;  // hardware sprite Y range: 50-250 (centre ~150)

#define PLAYER_SPEED  2

// ---------------------------------------------------------------------------
// Score
// Stored as a 6-digit decimal value; displayed on screen row 0.
// ---------------------------------------------------------------------------
static int score = 0;

static void score_draw(void)
{
    // Write "SCORE: " label (screen codes). Note: ':' is screen code 58
    // (not 26 — that's 'Z'). Letters A-Z map to 1-26, but punctuation
    // lives in the 32-63 range matching ASCII.
    static const char label[] = {19,3,15,18,5,58,32}; // S C O R E : spc
    for (char i = 0; i < 7; i++) {
        Screen[i] = label[i];
        Color[i]  = VCOL_YELLOW;
    }

    // Write up to 5 decimal digits of score
    int s = score;
    char digits[5];
    for (char d = 4; d != 255; d--) {
        digits[d] = (char)(s % 10) + 48; // screen code for '0'..'9'
        s /= 10;
    }
    for (char d = 0; d < 5; d++) {
        Screen[7 + d] = digits[d];
        Color[7 + d]  = VCOL_WHITE;
    }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int main(void)
{
    // --- Screen setup ---
    vic.color_border = VCOL_BLACK;
    vic.color_back   = VCOL_BLACK;

    for (int i = 0; i < 1000; i++) {
        Screen[i] = 0x20; // space
        Color[i]  = VCOL_BLACK;
    }

    score_draw();

    // --- Sprite setup ---
    // Write the sprite pointer: tells VIC which 64-byte block sprite 0 uses.
    // The pointer block for the default screen at $0400 is at $07F8.
    ((char *)0x07f8)[0] = PLAYER_SPR_BLOCK;

    // Set sprite 0 position and colour.
    vic.spr_pos[0].x = (char)player_x; // low 8 bits of X
    vic.spr_pos[0].y = player_y;
    vic.spr_color[0] = VCOL_LT_BLUE;

    // Enable sprite 0 (bit 0 of $D015).
    vic.spr_enable = 0x01;

    // Clear $D010 (X MSBs): player starts at X < 256.
    vic.spr_msbx = 0x00;

    // --- Main game loop ---
    // Frame sync via vic_waitBottom — busy-polls $D012 until the beam exits
    // the visible area, then proceeds. This is the canonical sync primitive
    // when NO display-effect IRQ slots are needed. (Calling rirq_init/start
    // without registering at least one slot would hang rirq_wait forever,
    // because the frame-complete flag is only set by the last slot firing.
    // Switch to rirq_init/rirq_set/rirq_start/rirq_wait once you add a
    // raster effect.)
    for (;;)
    {
        // Wait until the raster beam is below the visible display area.
        // This is the safe window to update sprite positions: no character
        // or sprite fetches are active, so writes don't tear.
        vic_waitBottom();

        // Read joystick port 2.
        // joy_poll(1) reads port 2 (standard player-1 port in C64 games).
        // Results are written into joyx[1], joyy[1], joyb[1].
        joy_poll(1);

        // Move player based on joystick direction.
        // joyx[1]: -1 = left, 0 = centre, 1 = right
        // joyy[1]: -1 = up,   0 = centre, 1 = down (Y axis: down = positive)
        player_x += (int)(joyx[1]) * PLAYER_SPEED;
        player_y += (char)(joyy[1]) * (char)PLAYER_SPEED;

        // Clamp to sprite display area.
        if (player_x < 24)  player_x = 24;
        if (player_x > 311) player_x = 311;
        if (player_y < 50)  player_y = 50;
        if (player_y > 234) player_y = 234;

        // Update hardware sprite 0 position.
        vic.spr_pos[0].y = player_y;
        if (player_x < 256) {
            vic.spr_pos[0].x = (char)player_x;
            vic.spr_msbx &= 0xFE; // clear bit 0 (sprite 0 X MSB)
        } else {
            vic.spr_pos[0].x = (char)(player_x - 256);
            vic.spr_msbx |= 0x01; // set bit 0 (sprite 0 X MSB)
        }

        // Fire button: increment score (placeholder for shooting logic).
        if (joyb[1]) {
            score++;
            if (score > 99999) score = 0;
            score_draw();
        }

        // TODO: add bullet update, enemy update, collision detection here.
        // See docs/recipes/oscar64/simple-shmup.md for the full pattern.
    }

    return 0;
}
