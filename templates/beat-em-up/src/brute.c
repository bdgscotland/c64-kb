// brute.c: the brute, drawn in character cells, not sprites (c64-kb
// mixed_sprite_char_actors, after the mixed-fighters recipe and the other
// #39 beat-em-up draft). He is 16 multicolour pixels by 48 lines, stored at
// the four 2-pixel shifts inside a cell (built once here from art.c's
// text), shown as a block of 5 x 6 cells whose 30 codes, CH_BRUTE on,
// belong to him alone. The fighter band's sprites are then four fighters
// minus him: at most six parts.
//
// Two character sets, alike but for his 30 glyphs: $E000 and $E800. The
// street shows one; brute_prepare, at the end of a frame, builds his next
// picture into the other, one row of the block (5 glyphs, KickAssembler's
// glyph_build) a frame, so no frame carries much of it. When the last row
// is in, it flips b_cs, and view_publish sends the other set
// with the frame's $D018: the switch costs nothing. Only when he has moved
// a whole cell does brute_draw, at the start of the next frame in the
// vertical blank, put the street back where he was and his codes where he
// is: that must beat the beam to his top row (brute_late counts the times
// it did not). The other draft built in halves and switched codes; a
// one-frame build there ended at line 132 on NTSC, against his top row at
// 107. A first C version here, in halves, took 18,000 cycles a frame
// (metered), so the glyphs are built in assembly now. He walks at half
// speed: a new picture every six frames, 3 pixels behind at most.
//
// The cells are in both street pages at his world column, so a page flip or
// a slice of the scroll never loses him; the slice copy moves his cells
// with the street, and brute_patch puts back the ones a new column wrote.
// Under his empty pixels each glyph keeps the street's own (the street uses
// bit pairs 00 and 01 only on rows 2-19), and his 10 and 11 pixels are
// foreground: a sprite with its $D01B bit set goes behind them. view.c sets
// that bit for every fighter farther away than he is (c64-kb mob_priority).
#include "game.h"
#include "asm.h"
#include <string.h>

static char preshift[12][240];      // pose * 4 + shift, 30 glyphs in block order
static char mask[256];              // for a byte of his: 11 in every bit pair he leaves empty
static char b_under[30], n_under[30];   // the street's glyphs under the picture shown, and the next
char b_wcol, b_row, b_fy;           // the picture on screen: world column, top row, ground line
bool b_drawn;
char b_cs;                          // the character set on screen: 0 $E000, 1 $E800
unsigned brute_late;                // cell moves that finished after his top row began
static char b_pose, b_shift;
static char n_wcol, n_row, n_fy, n_pose, n_shift, n_stage;   // 0 idle, 1-5 rows built
static bool n_hide, n_move;         // brute_draw owes: the street back / the cells moved
static bool drew;                   // brute_draw moved cells this frame: no new picture starts in it

void brute_build(void)
{
    for (unsigned v = 0; v < 256; v++)
    {
        char m = 0;
        for (char sh = 0; sh < 8; sh += 2)
            if (!((v >> sh) & 3))
                m |= 3 << sh;
        mask[v] = m;
    }
    *(volatile unsigned *)ASM_GB_MASK = (unsigned)mask;
    memcpy(CHARSET2, CHARSET, 2048);        // the second set: the street and the text alike
    for (char pose = 0; pose < 3; pose++)
    {
        for (char s = 0; s < 4; s++)
        {
            char *g = preshift[pose * 4 + s];
            for (char r = 0; r < 48; r++)
            {
                const char *row = brute_art[pose][r];
                // 20 multicolour pixels across the 5 cells, the picture at s..s+15.
                for (char cx = 0; cx < 5; cx++)
                {
                    char b = 0;
                    for (char k = 0; k < 4; k++)
                    {
                        signed char i = cx * 4 + k - s;
                        char v = 0;
                        if (i >= 0 && i < 16)
                        {
                            char c = row[i];
                            v = c == 'b' ? 1 : c == 's' ? 2 : c == 'x' ? 3 : 0;
                        }
                        b = (b << 2) | v;
                    }
                    g[((r >> 3) * 5 + cx) * 8 + (r & 7)] = b;
                }
            }
        }
    }
}

void brute_reset(void)
{
    b_drawn = false;
    n_stage = 0;
    n_hide = n_move = false;
}

static void block_put(char p, char wcol, char row, const char *under, char keep_col, char keep_row);

static char brute_slot(void)
{
    for (char f = 1; f < NFIGHT; f++)
        if (fkind[f] == K_BRUTE && fmode[f] != M_OFF)
            return f;
    return 0;
}

static char brute_pose(char f)
{
    char p = anim_pose(&fanim[f]);
    if (p == P_DOWN)
        return 2;
    if (p == P_WIND || p == P_PUNCH || p == P_CHAMBER || p == P_KICK)
        return 1;                           // the slam: both arms up
    return 0;
}

// Row q of the block (glyphs 5q to 5q + 4) of the picture into the set not
// on screen, each over the street glyph under it (glyph_build).
static void build_row(char q)
{
    char first = q * 5, n = 5;
    char *under = (char *)ASM_GB_UNDER;
    for (char k = 0; k < n; k++)
        under[k] = n_under[first + k];
    char *set = b_cs ? CHARSET : CHARSET2;
    *(volatile unsigned *)ASM_GB_SRC = (unsigned)(preshift[n_pose * 4 + n_shift] + first * 8);
    *(volatile unsigned *)ASM_GB_DST = (unsigned)(set + (CH_BRUTE + first) * 8);
    *(volatile char *)ASM_GB_COUNT = n;
    __asm { jsr ASM_GLYPH_BUILD }
}

// The end of a frame: build his next picture, a row a frame; when it is
// whole, flip the character set (view_publish sends it) and leave brute_draw
// the cells to move, if he moved a cell.
void brute_prepare(void)
{
    char f = brute_slot();
    if (!f)
    {
        n_stage = 0;
        n_hide = b_drawn;
        return;
    }
    if (n_move)
        return;                             // the last picture's cells are not moved yet
    if (drew)
    {
        drew = false;                       // a move frame: no new picture starts in it
        return;
    }
    if (n_stage)
    {
        build_row(n_stage);
        if (++n_stage == 6)
        {
            n_stage = 0;
            b_cs ^= 1;                      // the new picture, from the next frame on
            n_move = true;
        }
        return;
    }
    unsigned px = fx[f] >= 16 ? fx[f] - 16 : 0;     // his picture's left edge, world pixels
    char wcol = px >> 3, shift = (px & 7) >> 1;
    char row = ((fy[f] + 1 - 51) >> 3) - 6;         // feet on the last line of the block
    char pose = brute_pose(f);
    if (b_drawn && wcol == b_wcol && row == b_row && pose == b_pose && shift == b_shift)
        return;
    n_wcol = wcol;
    n_row = row;
    n_fy = fy[f];
    n_pose = pose;
    n_shift = shift;
    if (b_drawn && wcol == b_wcol && row == b_row)
        for (char i = 0; i < 30; i++)       // the same cells: the same street under them
            n_under[i] = b_under[i];
    else
        street_block(n_under, wcol, row);
    build_row(0);
    n_stage = 1;
}

// His block in page p: his codes, or, with `under`, the street back,
// leaving out the cells inside the block at (keep_col, keep_row), which the
// new picture covers (keep_row 0xff: none).
static void block_put(char p, char wcol, char row, const char *under, char keep_col, char keep_row)
{
    int pc = (int)wcol - page_col[p];                   // his first column on this page
    if (pc < -4 || pc > 39)
        return;                                         // not on this page
    char c0 = pc < 0 ? (char)-pc : 0;                   // the part of the block on the page
    char c1 = pc > 35 ? (char)(40 - pc) : 5;
    char w = c1 - c0;
    char *q = page_ptr(p) + row * 40 + (pc + c0);       // the first cell shown
    char i = c0;
    char kc = keep_col - (wcol + c0);                   // keep columns, counted from the first shown
    for (char r = 0; r < 6; r++, q += 40, i += 5)
    {
        if (!under)
        {
            char k = CH_BRUTE + i;
            for (char c = 0; c < w; c++)
                q[c] = k + c;
            continue;
        }
        char wr = row + r;
        bool keep_r = wr >= keep_row && wr < keep_row + 6;
        const char *u = under + i;
        for (char c = 0; c < w; c++)
            if (!(keep_r && (char)(c - kc) < 5))        // unsigned: c inside kc .. kc + 4
                q[c] = u[c];
    }
}

// The start of a frame, in the vertical blank: the IRQ at line 251 has
// just switched to the new character set; move his cells to match.
void brute_draw(void)
{
    if (n_hide && b_drawn)
    {
        for (char p = 0; p < NPAGES; p++)
            block_put(p, b_wcol, b_row, b_under, 0, 0xff);
        b_drawn = false;
    }
    n_hide = false;
    if (!n_move)
        return;
    n_move = false;
    bool moved = !b_drawn || n_wcol != b_wcol || n_row != b_row;
    if (b_drawn && moved)
        for (char p = 0; p < NPAGES; p++)
            block_put(p, b_wcol, b_row, b_under, n_wcol, n_row);    // the street back where he left
    b_wcol = n_wcol;
    b_row = n_row;
    b_fy = n_fy;
    b_pose = n_pose;
    b_shift = n_shift;
    for (char i = 0; i < 30; i++)
        b_under[i] = n_under[i];
    if (moved)
    {
        for (char p = 0; p < NPAGES; p++)
            block_put(p, b_wcol, b_row, 0, 0, 0xff);
        // His top row starts at line 51 + 8 * b_row: the move must be done
        // before the beam gets there (the frame started at line 251).
        char line = vic.raster;
        if (line >= 51 + 8 * b_row && line < 251)
            brute_late++;
        drew = true;
    }
    b_drawn = true;
}

// A slice of the scroll wrote rows row0..row0 + n - 1 of page p's new
// column 39 from the street: put back his cells there.
void brute_patch(char p, char row0, char n)
{
    if (!b_drawn)
        return;
    char c = page_col[p] + 39 - b_wcol;
    if (c >= 5)
        return;
    char *q = page_ptr(p) + 39;
    for (char r = row0; r < row0 + n; r++)
        if (r >= b_row && r < b_row + 6)
            q[r * 40] = CH_BRUTE + (r - b_row) * 5 + c;
}

// The code the page must hold at a world cell: his, or 0 (the street's).
char brute_code_at(unsigned wcol, char row)
{
    if (!b_drawn || row < b_row || row >= b_row + 6 || wcol < b_wcol || wcol >= b_wcol + 5)
        return 0;
    return CH_BRUTE + (row - b_row) * 5 + (wcol - b_wcol);
}
