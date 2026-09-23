// LEDGE RUNNER - a single-screen platformer for the stock Commodore 64.
// Oscar64, PAL first, NTSC-safe.  Built with no knowledge base: what is
// in here comes from the compiler's own headers, from the author's own
// memory of the machine, or from experiments in VICE (see DECISIONS.md).

#include <c64/vic.h>
#include <c64/sid.h>
#include <c64/cia.h>
#include <c64/kernalio.h>
#include <string.h>

// ---------------------------------------------------------------- config

#ifndef AUTOPILOT
#define AUTOPILOT 1            // 1 = demo plays itself, 0 = joystick port 2
#endif
#ifndef BUDGET_BAR
#define BUDGET_BAR 1           // 1 = border shows frame cost, 0 = off
#endif
#ifndef DEMO_END_FRAME
#define DEMO_END_FRAME 720     // autopilot forces game over here (0 = never)
#endif
#define PASS_FRAMES 600        // frames without a fault before border goes green

#define BAR_COLOR   VCOL_LT_GREY
#define ENEMY_MAX   4
#define MAP_COLS    40
#define MAP_ROWS    23         // screen rows 1..23; row 0 = HUD, row 24 = message
#define MAP_SIZE    (MAP_COLS * MAP_ROWS)
#define PF_HEIGHT   (MAP_ROWS * 8)   // 184 px
#define SPR_X0      24         // sprite X of playfield pixel column 0
#define SPR_Y0      58         // sprite Y of playfield pixel row 0 (50 + one HUD row)

#define T_EMPTY 0
#define T_SOLID 1
#define T_LADDER 2

// Fault codes (written to $02FF with bit 7 set)
#define F_PLAYER_X   1
#define F_PLAYER_Y   2
#define F_TILE_IDX   3
#define F_JUMP_IDX   4
#define F_WAVE_IDX   5
#define F_POOL       6
#define F_MAP_LEN    7

// ------------------------------------------------------------ placement

#pragma region( main, 0x0a00, 0x3f00, , , {code, data, bss, heap, stack} )
#pragma stacksize( 1024 )
#pragma section( sprites, 0 )
#pragma region( sprites, 0x3f00, 0x3f80, , , {sprites} )

#pragma data(sprites)
// Player, 24x21, drawn in the middle 8 columns (byte 1 of each row)
const char spr_player[64] = {
	0x00,0x3c,0x00, 0x00,0x7e,0x00, 0x00,0x5a,0x00, 0x00,0x7e,0x00,
	0x00,0x3c,0x00, 0x00,0x18,0x00, 0x00,0x7e,0x00, 0x00,0xdb,0x00,
	0x00,0xdb,0x00, 0x00,0xdb,0x00, 0x00,0x5a,0x00, 0x00,0x18,0x00,
	0x00,0x18,0x00, 0x00,0x3c,0x00, 0x00,0x24,0x00, 0x00,0x24,0x00,
	0x00,0x24,0x00, 0x00,0x24,0x00, 0x00,0x66,0x00, 0x00,0x66,0x00,
	0x00,0xe7,0x00, 0x00
};
// Enemy blob, 24x21, wider (16 px) body
const char spr_enemy[64] = {
	0x00,0x00,0x00, 0x00,0x00,0x00, 0x00,0x00,0x00, 0x00,0x00,0x00,
	0x00,0x00,0x00, 0x00,0x00,0x00, 0x00,0x00,0x00, 0x03,0xc0,0x00,
	0x0f,0xf0,0x00, 0x1f,0xf8,0x00, 0x3c,0x3c,0x00, 0x39,0x9c,0x00,
	0x7f,0xfe,0x00, 0x7f,0xfe,0x00, 0x7f,0xfe,0x00, 0x6f,0xf6,0x00,
	0x37,0xec,0x00, 0x1f,0xf8,0x00, 0x0f,0xf0,0x00, 0x1b,0xd8,0x00,
	0x31,0x8c,0x00, 0x00
};
#pragma data(data)

// --------------------------------------------------------------- memory

#define screen   ((char *)0x0400)
#define colram   ((char *)0xd800)
#define sprptr   ((char *)0x07f8)
#define RESULT   (*(volatile char *)0x02ff)

// ------------------------------------------------------------ map (RLE)

// Pairs of (run length, tile).  Run of 0 terminates.  23 rows x 40 cols.
static const char map_rle[] = {
	200,T_EMPTY, 80,T_EMPTY,                      // rows 0-6 empty
	11,T_SOLID, 17,T_EMPTY, 12,T_SOLID,           // row 7: two ledges
	160,T_EMPTY,                                  // rows 8-11
	8,T_EMPTY, 4,T_SOLID, 1,T_LADDER, 19,T_SOLID, 8,T_EMPTY,   // row 12
	12,T_EMPTY, 1,T_LADDER, 27,T_EMPTY,           // rows 13-16: ladder col 12
	12,T_EMPTY, 1,T_LADDER, 27,T_EMPTY,
	12,T_EMPTY, 1,T_LADDER, 27,T_EMPTY,
	12,T_EMPTY, 1,T_LADDER, 27,T_EMPTY,
	2,T_EMPTY, 13,T_SOLID, 9,T_EMPTY, 14,T_SOLID, 2,T_EMPTY,   // row 17
	160,T_EMPTY,                                  // rows 18-21
	40,T_SOLID,                                   // row 22: floor
	0
};

static char tiles[MAP_SIZE];
static const unsigned row_off[MAP_ROWS] = {
	0, 40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440,
	480, 520, 560, 600, 640, 680, 720, 760, 800, 840, 880
};

static const char tile_char[3]  = { 32, 160, 0x5b };          // space, reverse space, cross
static const char tile_color[3] = { VCOL_BLACK, VCOL_ORANGE, VCOL_CYAN };

// -------------------------------------------------------------- state

static unsigned frame;                // frame counter
static char base_border;              // colour the border returns to
static char fault_code;               // 0 = none

static unsigned score, hiscore;
static char lives;

// player, 8.8 fixed point
// positions: integer pixel part + 8-bit fraction (a 16.8 value), because a
// plain 16-bit 8.8 cannot hold x up to 320 or y up to 184 (296<<8 overflows).
// velocities are signed 8.8 ints and are added with add88().
static int  px, py;                   // pixel part of sprite top-left in playfield
static char pxf, pyf;                 // fraction part
static int  vy;                       // vertical velocity, 8.8
static char jump_idx;                 // index into jump table, 0xff = not jumping
static char grounded, on_ladder, invuln;
static char facing;                   // 0 right, 1 left

// jump arc: vertical velocity per frame in 8.8 (negative = up)
static const int jump_table[] = {
	-0x400,-0x400,-0x380,-0x340,-0x300,-0x2c0,-0x280,-0x240,
	-0x200,-0x1c0,-0x180,-0x140,-0x100,-0x0c0,-0x080,-0x040
};
#define JUMP_LEN (sizeof(jump_table) / sizeof(jump_table[0]))
#define GRAVITY  0x30
#define VY_MAX   0x400
#define WALK_VX  0x180

// enemies
struct Enemy { char active; int x; char xf; char y; int vx; };
static struct Enemy enemies[ENEMY_MAX];

// wave table: delay (frames) until this entry, ledge row, direction, speed (8.8)
struct Wave { char delay; char row; char dir; unsigned speed; };
static const struct Wave wave_table[] = {
	{ 60, 22, 1, 0x0100 },
	{ 70, 17, 0, 0x0140 },
	{ 50, 12, 1, 0x0100 },
	{ 40, 22, 0, 0x0180 },
	{ 60,  7, 1, 0x00c0 },
	{ 30, 17, 1, 0x0200 },
	{ 45, 22, 1, 0x0140 },
	{ 30, 12, 0, 0x0180 },
};
#define WAVE_LEN (sizeof(wave_table) / sizeof(wave_table[0]))
static char wave_idx, wave_timer;

// random source: 16-bit Galois LFSR
static unsigned lfsr = 0xACE1;
static unsigned rnd(void)
{
	if (lfsr & 1) lfsr = (lfsr >> 1) ^ 0xB400; else lfsr >>= 1;
	return lfsr;
}

// add a signed 8.8 velocity to a (pixel, fraction) position
static void add88(int * pix, char * frac, int v)
{
	int f = (int)*frac + (v & 0xff);
	*pix += (v >> 8) + (f >> 8);
	*frac = (char)f;
}

// input
static char joy_now, joy_prev, joy_press, fire_held;
#define J_UP 1
#define J_DOWN 2
#define J_LEFT 4
#define J_RIGHT 8
#define J_FIRE 16

// sound
static char sfx_timer;
static char tune_step;

// -------------------------------------------------------------- faults

static void fault(char code)
{
	if (!fault_code)
	{
		fault_code = code;
		RESULT = 0x80 | code;
		base_border = VCOL_RED;
		vic.color_border = VCOL_RED;
	}
}
#define ASSERT(c, code) do { if (!(c)) fault(code); } while (0)

// ------------------------------------------------------------- drawing

// decimal by repeated subtraction of powers of ten: no divide, at most
// nine subtractions per digit.  digits <= 5 (a 16-bit value).
static const unsigned pow10[5] = { 10000, 1000, 100, 10, 1 };
static void put_dec(char * dst, unsigned v, char digits)
{
	char i = 5 - digits;
	while (i < 5)
	{
		unsigned p = pow10[i];
		char d = 48;
		while (v >= p) { v -= p; d++; }
		*dst++ = d;
		i++;
	}
}

static void put_str(char * dst, const char * s)
{
	while (*s) *dst++ = *s++;
}

// PETSCII (as the drive returns it) to screen code, row 24
static void show_message(const char * s)
{
	char * dst = screen + 24 * 40;
	char i = 0;
	while (i < 40 && s[i])
	{
		char c = s[i];
		if (c >= 0x40 && c < 0x60) c -= 0x40;
		else if (c < 0x20 || c >= 0x60) c = '?';
		dst[i] = c;
		colram[24 * 40 + i] = VCOL_LT_GREEN;
		i++;
	}
	while (i < 40) { dst[i] = 32; i++; }
}

// Labels are lowercase in the source: Oscar64's s"" maps ASCII lowercase to
// screen codes 1..26, which the default uppercase charset shows as capitals.
static unsigned hud_score = 0xffff, hud_hi = 0xffff;
static char hud_lives = 0xff, hud_rc = 0xff;
static void draw_hud(void)
{
	char * h = screen;
	if (hud_score != score) { hud_score = score; put_str(h + 0, s"sc "); put_dec(h + 3, score, 5); }
	if (hud_lives != lives) { hud_lives = lives; put_str(h + 9, s"li ");  put_dec(h + 12, lives, 1); }
	if (hud_hi != hiscore)  { hud_hi = hiscore; put_str(h + 14, s"hi "); put_dec(h + 17, hiscore, 5); }
	put_str(h + 23, s"f "); put_dec(h + 25, frame, 5);
	char rc = RESULT;
	if (hud_rc != rc) { hud_rc = rc; put_str(h + 31, s"rc "); put_dec(h + 34, rc, 3); }
}

static void unpack_map(void)
{
	const char * src = map_rle;
	unsigned pos = 0;
	for (;;)
	{
		char n = src[0], t = src[1];
		if (n == 0) break;
		src += 2;
		while (n--)
		{
			if (pos < MAP_SIZE) tiles[pos] = t;
			pos++;
		}
	}
	ASSERT(pos == MAP_SIZE, F_MAP_LEN);
}

static void draw_map(void)
{
	for (unsigned i = 0; i < MAP_SIZE; i++)
	{
		char t = tiles[i];
		screen[40 + i] = tile_char[t];
		colram[40 + i] = tile_color[t];
	}
	for (char i = 0; i < 40; i++) colram[i] = VCOL_YELLOW;
}

// ----------------------------------------------------------- collision

// tile at playfield pixel (x, y); outside the field: side walls solid,
// above the field empty, below the field solid
static char tile_at(int x, int y)
{
	if (x < 0 || x >= 320) return T_SOLID;
	if (y < 0) return T_EMPTY;
	if (y >= PF_HEIGHT) return T_SOLID;
	unsigned idx = row_off[y >> 3] + (unsigned)(x >> 3);
	ASSERT(idx < MAP_SIZE, F_TILE_IDX);
	if (idx >= MAP_SIZE) return T_SOLID;
	return tiles[idx];
}

// player hitbox: x+8 .. x+15, y .. y+20
#define HB_L 8
#define HB_R 15
#define HB_H 20

static char solid_below(int x, int y)
{
	return tile_at(x + HB_L, y + HB_H + 1) == T_SOLID ||
	       tile_at(x + HB_R, y + HB_H + 1) == T_SOLID;
}

static char ladder_below(int x, int y)
{
	return tile_at(x + 12, y + HB_H + 1) == T_LADDER;
}

static char ladder_here(int x, int y)
{
	return tile_at(x + 12, y + 10) == T_LADDER || tile_at(x + 12, y + HB_H) == T_LADDER;
}

// --------------------------------------------------------------- sound

static void sfx_jump(void)
{
	sid.voices[0].ctrl = 0;
	sid.voices[0].freq = 0x1800;
	sid.voices[0].attdec = SID_ATK_2 | SID_DKY_204;
	sid.voices[0].susrel = 0x00;
	sid.voices[0].ctrl = SID_CTRL_SAW | SID_CTRL_GATE;
	sfx_timer = 10;
}

static const unsigned tune_bass[8]   = { NOTE_C(2), NOTE_C(2), NOTE_G(1), NOTE_G(1), NOTE_A(1), NOTE_A(1), NOTE_F(1), NOTE_G(1) };
static const unsigned tune_melody[8] = { NOTE_E(4), NOTE_G(4), NOTE_D(4), NOTE_G(4), NOTE_C(4), NOTE_E(4), NOTE_A(3), NOTE_B(3) };

static void sound_init(void)
{
	for (char i = 0; i < 24; i++) ((volatile char *)0xd400)[i] = 0;
	sid.fmodevol = 15;
	sid.voices[1].pwm = 0x0800;
	sid.voices[1].attdec = SID_ATK_2 | SID_DKY_300;
	sid.voices[1].susrel = 0x00;
	sid.voices[2].attdec = SID_ATK_8 | SID_DKY_750;
	sid.voices[2].susrel = 0x00;
}

// stub three-voice tune: voice 2 bass, voice 3 melody, voice 1 is the sfx
// channel.  Nobody has listened to it; register writes only.
static void sound_frame(void)
{
	if (sfx_timer)
	{
		sfx_timer--;
		sid.voices[0].freq += 0x0100;      // upward chirp
		if (!sfx_timer) sid.voices[0].ctrl = SID_CTRL_SAW;
	}
	if ((frame & 15) == 0)
	{
		sid.voices[1].ctrl = SID_CTRL_RECT;
		sid.voices[2].ctrl = SID_CTRL_TRI;
		sid.voices[1].freq = tune_bass[tune_step];
		sid.voices[2].freq = tune_melody[tune_step];
		sid.voices[1].ctrl = SID_CTRL_RECT | SID_CTRL_GATE;
		sid.voices[2].ctrl = SID_CTRL_TRI | SID_CTRL_GATE;
		tune_step = (tune_step + 1) & 7;
	}
}

// ---------------------------------------------------------------- disk

static char disk_reply[42];

// read the drive's status line from channel 15 into disk_reply
static void disk_status(void)
{
	disk_reply[0] = 0;
	krnio_setnam("");
	if (krnio_open(15, 8, 15))
	{
		int n = krnio_gets(15, disk_reply, 40);
		if (n < 0) disk_reply[0] = 0;
		for (char i = 0; i < 40; i++) if (disk_reply[i] == 13) { disk_reply[i] = 0; break; }
		krnio_close(15);
	}
	else
	{
		put_str(disk_reply, "OPEN 15 FAILED");
		disk_reply[14] = 0;
	}
}

static void hiscore_load(void)
{
	char buf[8];
	hiscore = 0;
	krnio_setnam("HISCORE,S,R");
	if (krnio_open(2, 8, 2))
	{
		int n = krnio_read(2, buf, 5);
		krnio_close(2);
		if (n == 5)
		{
			unsigned v = 0;
			for (char i = 0; i < 5; i++) v = v * 10 + (buf[i] - '0');
			hiscore = v;
		}
	}
	disk_status();
	char msg[42];
	put_str(msg, "LOAD:");
	memcpy(msg + 5, disk_reply, 37);
	msg[41] = 0;
	show_message(msg);
}

static void hiscore_save(void)
{
	char buf[8];
	put_dec(buf, hiscore, 5);
	buf[5] = 13;
	krnio_setnam("@0:HISCORE,S,W");
	if (krnio_open(2, 8, 2))
	{
		krnio_write(2, buf, 6);
		krnio_close(2);
	}
	disk_status();
	char msg[42];
	put_str(msg, "SAVE:");
	memcpy(msg + 5, disk_reply, 37);
	msg[41] = 0;
	show_message(msg);
}

// ---------------------------------------------------------------- game

static void player_reset(void)
{
	px = 4; pxf = 0;
	py = PF_HEIGHT - 8 - 21; pyf = 0;   // standing on the floor
	vy = 0;
	jump_idx = 0xff;
	grounded = 1;
	on_ladder = 0;
	invuln = 100;
	facing = 0;
}

static void enemies_clear(void)
{
	for (char i = 0; i < ENEMY_MAX; i++) enemies[i].active = 0;
	wave_idx = 0;
	wave_timer = wave_table[0].delay;
}

static void game_reset(void)
{
	score = 0;
	lives = 3;
	player_reset();
	enemies_clear();
}

static void spawn_from_wave(void)
{
	ASSERT(wave_idx < WAVE_LEN, F_WAVE_IDX);
	const struct Wave * w = wave_table + wave_idx;
	char slot = 0xff;
	char count = 0;
	for (char i = 0; i < ENEMY_MAX; i++)
	{
		if (enemies[i].active) count++;
		else if (slot == 0xff) slot = i;
	}
	ASSERT(count <= ENEMY_MAX, F_POOL);
	if (slot != 0xff)
	{
		unsigned r = rnd();
		struct Enemy * e = enemies + slot;
		char dir = w->dir ^ (char)((r >> 3) & 1);     // LFSR may flip direction
		e->active = 1;
		e->y = w->row * 8 - 21;
		e->vx = (int)(w->speed + (r & 0x3f));      // LFSR jitters the speed
		e->xf = 0;
		if (dir) { e->x = 300; e->vx = -e->vx; }
		else     { e->x = -20; }
	}
	wave_idx++;
	if (wave_idx >= WAVE_LEN) wave_idx = 0;
	wave_timer = wave_table[wave_idx].delay + (char)(rnd() & 31);
}

static void enemies_update(void)
{
	if (--wave_timer == 0) spawn_from_wave();
	for (char i = 0; i < ENEMY_MAX; i++)
	{
		struct Enemy * e = enemies + i;
		if (!e->active) continue;
		add88(&e->x, &e->xf, e->vx);
		int xp = e->x;
		if (xp < -24 || xp > 320)
		{
			e->active = 0;      // left the screen
			score += 10;
		}
	}
}

static void lose_life(void)
{
	if (lives) lives--;
	player_reset();
	enemies_clear();
}

static char hit_enemy(void)
{
	if (invuln) return 0;
	int pxp = px, pyp = py;
	for (char i = 0; i < ENEMY_MAX; i++)
	{
		struct Enemy * e = enemies + i;
		if (!e->active) continue;
		int dx = e->x - pxp;
		int dy = (int)e->y - pyp;
		if (dx > -14 && dx < 14 && dy > -12 && dy < 12) return 1;
	}
	return 0;
}

// press-event input.  Directions are level-triggered (repeat every frame
// while held).  Fire is edge-triggered: one press = one jump; if held, it
// auto-repeats after 30 frames and then every 10 frames.
static void read_input(char raw)
{
	joy_now = (~raw) & 31;
	joy_press = joy_now & ~joy_prev;
	if (joy_now & J_FIRE)
	{
		fire_held++;
		if (fire_held == 30) { joy_press |= J_FIRE; fire_held = 20; }
	}
	else fire_held = 0;
	joy_prev = joy_now;
}

#if AUTOPILOT
static char ap_dir = J_RIGHT, ap_hold = 40, ap_climb;
static int ap_last_px;

// The autopilot returns a CIA-style byte (active low) so the same input
// path is exercised as with a real stick.
static char autopilot(void)
{
	char out = 0;
	unsigned r = rnd();
	if (ap_hold) ap_hold--;
	if (!ap_hold || (px == ap_last_px && grounded))
	{
		// direction expired or we are stuck against a wall: reverse or choose
		ap_dir = (ap_dir == J_RIGHT) ? J_LEFT : J_RIGHT;
		ap_hold = 30 + (char)(r & 63);
	}
	ap_last_px = px;
	out |= ap_dir;
	// jump if an enemy is close on our row and approaching, or now and then
	char want_jump = 0;
	int pxp = px, pyp = py;
	for (char i = 0; i < ENEMY_MAX; i++)
	{
		struct Enemy * e = enemies + i;
		if (!e->active) continue;
		int dx = e->x - pxp;
		int dy = (int)e->y - pyp;
		if (dy > -8 && dy < 8 && dx > -40 && dx < 40) want_jump = 1;
	}
	if ((r & 0x3f0) == 0) want_jump = 1;
	if (want_jump && !(joy_prev & J_FIRE)) out |= J_FIRE;
	// ladders: climb when standing at one
	if (ladder_here(px, py) || ladder_below(px, py))
	{
		if (!ap_climb && (r & 1)) ap_climb = 60;
	}
	if (ap_climb) { ap_climb--; out = J_UP; }
	return (char)~out;
}
#endif

static void player_update(void)
{
	int nx = px, ny = py;
	char nxf = pxf, nyf = pyf;
	int yp = py;

	// horizontal
	if (joy_now & J_LEFT)  { add88(&nx, &nxf, -WALK_VX); facing = 1; }
	if (joy_now & J_RIGHT) { add88(&nx, &nxf,  WALK_VX); facing = 0; }
	if (nx < 0)   { nx = 0;   nxf = 0; }
	if (nx > 296) { nx = 296; nxf = 0; }
	if (tile_at(nx + HB_L, yp + 2) == T_SOLID || tile_at(nx + HB_L, yp + HB_H) == T_SOLID ||
	    tile_at(nx + HB_R, yp + 2) == T_SOLID || tile_at(nx + HB_R, yp + HB_H) == T_SOLID)
	{
		nx = px; nxf = pxf;
	}
	int xp = nx;

	// ladder
	on_ladder = 0;
	if (jump_idx == 0xff && ladder_here(xp, yp) && (joy_now & (J_UP | J_DOWN)))
		on_ladder = 1;
	else if (jump_idx == 0xff && (joy_now & J_UP) && ladder_below(xp, yp))
		on_ladder = 1;

	if (on_ladder)
	{
		vy = 0;
		nyf = 0;
		if (joy_now & J_UP)   ny -= 1;
		if (joy_now & J_DOWN) ny += 1;
		// stop when the feet reach solid ground
		if ((joy_now & J_DOWN) && solid_below(xp, ny)) ny = py;
		// do not climb above the top of the ladder
		if ((joy_now & J_UP) && !ladder_here(xp, ny) && !ladder_below(xp, ny)) ny = py;
		grounded = 1;
	}
	else
	{
		// jump start
		if ((joy_press & J_FIRE) && grounded && jump_idx == 0xff)
		{
			jump_idx = 0;
			grounded = 0;
			sfx_jump();
		}
		if (jump_idx != 0xff)
		{
			ASSERT(jump_idx < JUMP_LEN, F_JUMP_IDX);
			vy = jump_table[jump_idx];
			jump_idx++;
			if (jump_idx >= JUMP_LEN) jump_idx = 0xff;
		}
		else
		{
			vy += GRAVITY;
			if (vy > VY_MAX) vy = VY_MAX;
		}
		add88(&ny, &nyf, vy);
		if (vy > 0)
		{
			// falling: land on solid, or on a ladder top when not already on the ladder
			if (solid_below(xp, ny) || (!ladder_here(xp, yp) && !ladder_below(xp, yp) && ladder_below(xp, ny)))
			{
				// snap feet to the tile boundary above the tile we hit
				int feet = ny + HB_H + 1;
				ny = (feet & ~7) - HB_H - 1;
				nyf = 0;
				if (ny < py) { ny = py; nyf = pyf; }
				vy = 0;
				grounded = 1;
				jump_idx = 0xff;
			}
			else grounded = 0;
		}
		else if (vy < 0)
		{
			if (tile_at(xp + HB_L, ny) == T_SOLID || tile_at(xp + HB_R, ny) == T_SOLID)
			{
				ny = (ny & ~7) + 8;
				nyf = 0;
				vy = 0;
				jump_idx = 0xff;
			}
			grounded = 0;
		}
		else
		{
			grounded = solid_below(xp, ny) || ladder_below(xp, ny);
		}
	}

	px = nx; pxf = nxf;
	py = ny; pyf = nyf;
	if (py > PF_HEIGHT - 21) { py = PF_HEIGHT - 21; pyf = 0; }
	if (py < 0) { py = 0; pyf = 0; }

	ASSERT(px >= 0 && px <= 296, F_PLAYER_X);
	ASSERT(py >= 0 && py <= PF_HEIGHT - 21, F_PLAYER_Y);

	if (invuln) invuln--;
}

static void sprites_update(void)
{
	char en = 1;
	vic_sprxy(0, SPR_X0 + px, SPR_Y0 + py);
	vic.spr_color[0] = (invuln & 4) ? VCOL_LT_GREY : VCOL_WHITE;
	for (char i = 0; i < ENEMY_MAX; i++)
	{
		if (enemies[i].active)
		{
			int xp = enemies[i].x;
			if (xp < -23) xp = -23;
			vic_sprxy(i + 1, SPR_X0 + xp, SPR_Y0 + enemies[i].y);
			en |= 2 << i;
		}
	}
	vic.spr_enable = en;
}

static void video_init(void)
{
	vic.ctrl1 = VIC_CTRL1_DEN | VIC_CTRL1_RSEL | 3;
	vic.ctrl2 = VIC_CTRL2_CSEL;
	vic.memptr = 0x14;                   // screen $0400, charset $1000 (uppercase)
	vic.color_border = VCOL_BLACK;
	vic.color_back = VCOL_BLACK;
	memset(screen, 32, 1000);
	sprptr[0] = (unsigned)spr_player / 64;
	for (char i = 1; i < 8; i++) sprptr[i] = (unsigned)spr_enemy / 64;
	vic.spr_multi = 0;
	vic.spr_expand_x = 0;
	vic.spr_expand_y = 0;
	vic.spr_priority = 0;
	for (char i = 1; i < 8; i++) vic.spr_color[i] = VCOL_LT_RED;
	vic.spr_color[0] = VCOL_WHITE;
	vic.spr_enable = 0;
}

static void game_over(void)
{
	if (score > hiscore) hiscore = score;
	vic.spr_enable = 0;
	sid.voices[0].ctrl = 0; sid.voices[1].ctrl = 0; sid.voices[2].ctrl = 0;
	hiscore_save();
	game_reset();
}

int main(void)
{
	RESULT = 0;
	base_border = VCOL_BLACK;
	fault_code = 0;
	frame = 0;

	video_init();
	sound_init();
	unpack_map();
	draw_map();
	game_reset();
	hiscore_load();
	draw_hud();

	cia1.ddra = 0;                        // port A input for joystick 2

	for (;;)
	{
		// raster sync: wait for line 251, just below the 25-row display.
		// Valid on PAL (312 lines) and NTSC (263 lines).
		while (vic.raster == 251) ;
		while (vic.raster != 251) ;
#if BUDGET_BAR
		vic.color_border = BAR_COLOR;
#endif
		frame++;

#if AUTOPILOT
		read_input(autopilot());
#else
		read_input(cia1.pra);
#endif
		player_update();
		enemies_update();
		if (hit_enemy()) lose_life();
		if ((frame & 15) == 0 && !fault_code) score++;
		if (score > 99999) score = 99999;

		sound_frame();
		sprites_update();

#ifdef FORCE_FAULT
		if (frame == 100) fault(0x0f);   // harness self-test: must turn the border red
#endif
		if (frame == PASS_FRAMES && !fault_code)
		{
			RESULT = 0x01;
			base_border = VCOL_GREEN;
		}
		draw_hud();

		vic.color_border = base_border;

		char over = (lives == 0 && invuln == 0);
#if AUTOPILOT && DEMO_END_FRAME
		if (frame == DEMO_END_FRAME) over = 1;
#endif
		if (over) game_over();
	}
	return 0;
}
