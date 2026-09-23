// view.c: the VIC-II side. Two street pages and a HUD page in bank 3; the
// camera and its stage locks; the scroll; the three sprite bands.
//
// Scroll, after the platformer starter (c64-kb soft_scroll_h and
// screen_double_buffer_d018), for a camera that only moves right:
// XSCROLL = 7 - (camx & 7) moves the picture a pixel; a column crossing
// is a $D018 flip to the other page, which already holds the next column.
// It is prepared four rows a frame, copied one column over from the page on
// display by slice_copy (engine.asm), plus the new column's cells. The
// camera moves at most a pixel a frame (the hero walks at that speed), so a
// crossing is at least 8 frames after the last, and 5 slices finish the
// page. (It was five rows at 2 pixels a frame, the platformer's figures;
// the brute and the VIC check made the frame too full for it: metered.) No page is written while it
// is shown: nothing tears, and no frame carries a whole 20-row shift.
//
// Sprites, after c64-kb sprite_multiplex_game's double-buffered table and
// lane_depth_engine's priority assignment: view_sprites fills the back half
// of the three bands' tables in the blob; the IRQ chain writes them to the
// VIC at lines 251, 76 and 212 (engine.asm).
#include "game.h"
#include "asm.h"
#include <string.h>

#define CAM_LEAD   120              // the hero's screen x the camera keeps him left of
#define CAM_SPEED  1                // pixels a frame, at most: 8 frames a column
#define SLICE      4                // rows a prepare step (engine.asm's SLICE)
#define NO_PAGE    0xff
#define COL_MAX    (LEVEL_CW - 40)  // the last column a page can start at

unsigned camx, shown_col;
char shown_page;
int page_col[NPAGES];
char page_rows[NPAGES];
static char prep_page;              // the page being prepared, or NO_PAGE
char order[NFIGHT] = { 0, 1, 2, 3 };
char parts_dropped;
char sprites_half;
bool sprites_fresh;
bool go_sign;
bool faces_off;
char face_enemy = 0xff;
static char blink;

static char *const page_addr[NPAGES] = { PAGE0, PAGE1 };
static const char page_d018[NPAGES] = { D018_PAGE0, D018_PAGE1 };

// Shirt (top part) and trousers (legs) by kind, and each kind's face.
static const char shirt[3]    = { VCOL_WHITE, VCOL_RED, COL_BBODY };   // the brute's: his face on the HUD
static const char trousers[3] = { VCOL_BLUE, VCOL_LT_GREY, VCOL_PURPLE };
static const char face_block[3] = { B_FACE_HERO, B_FACE_THUG, B_FACE_BRUTE };
static const char bit[8] = { 1, 2, 4, 8, 16, 32, 64, 128 };

#define BLOB(a)    (*(volatile char *)(a))
#define SLICE_SRC  (*(volatile unsigned *)ASM_SLICE_SRC)
#define SLICE_DST  (*(volatile unsigned *)ASM_SLICE_DST)

void view_init(void)
{
    vic.spr_enable = 0;
    cia2.pra = cia2.pra & 0xfc;             // VIC bank 3: $C000-$FFFF
    vic.ctrl1 = 0x1b;                       // display on, 25 rows, YSCROLL 3
    vic.ctrl2 = D016_PLAY | 7;
    vic.memptr = D018_PAGE0;
    vic.color_border = VCOL_BLACK;
    vic.color_back = COL_ROAD;
    vic.color_back1 = COL_BRICK;
    vic.color_back2 = COL_BSKIN;
    vic.spr_mcolor0 = COL_SKIN;
    vic.spr_mcolor1 = COL_INK;
    vic.spr_multi = 0xff;                   // every sprite multicolour
    vic.spr_expand_x = 0;
    vic.spr_expand_y = 0;
    vic.spr_priority = 0;                   // sprites in front of the street

    // One memset per page (c64-kb CLAUDE.md, Oscar64 fault 7: one loop
    // storing to several pages miscompiles).
    memset(PAGE0, CH_SPACE, 1024);
    memset(PAGE1, CH_SPACE, 1024);
    memset(HUDPAGE, CH_SPACE, 1024);
    for (unsigned i = 0; i < 2 * 40; i++)
        COLOUR[i] = 0x08 | VCOL_BLUE;       // rows 0-1: 'k' is the night sky
    for (unsigned i = 2 * 40; i < 21 * 40; i++)
        COLOUR[i] = 0x08 | COL_BBODY;       // rows 2-20: 11 is the brute's body
    for (unsigned i = 21 * 40; i < 1000; i++)
        COLOUR[i] = VCOL_WHITE;             // the HUD is hires white
    for (char c = 3; c < 15; c++)
    {
        COLOUR[22 * 40 + c] = VCOL_YELLOW;  // the hero's bar
        COLOUR[22 * 40 + 20 + c] = VCOL_LT_RED;
    }

    // The IRQ chain. BASIC and KERNAL are out ($01 = $35), so the CPU takes
    // its vectors from RAM: $FFFE to the chain, $FFFA (RESTORE) to an RTI.
    *(volatile unsigned *)0xfffe = ASM_IRQ_BLANK;
    *(volatile unsigned *)0xfffa = ASM_NMI_RTI;
    cia1.icr = 0x7f;                        // no CIA1 interrupts: the KERNAL's timer is not wanted
    blink = cia1.icr;                       // read: clears a pending CIA1 interrupt
    vic.raster = 251;                       // $D011 bit 7 is 0: line 251
    vic.intr_ctrl = 0x0f;                   // clear anything pending
    vic.intr_enable = 0x01;                 // raster only
    __asm { cli }
}

static void page_draw(char p, int col)
{
    page_col[p] = col;
    page_rows[p] = PF_ROWS;
    if (col < 0 || col > COL_MAX)
        return;                             // off the street: never shown
    for (char c = 0; c < 40; c++)
        level_column(page_addr[p] + c, col + c);
}

// Draw both pages whole: the start of a game, not a scroll.
void view_cut(void)
{
    shown_col = camx >> 3;
    shown_page = 0;
    page_draw(0, shown_col);
    page_draw(1, (int)shown_col + 1);
    prep_page = NO_PAGE;
    brute_reset();                          // both pages hold the street alone
}

// Rows row0 to row0 + n - 1 of world column col, down a page column.
static void level_cells(char *dst, unsigned col, char row0, char n)
{
    dst += row0 * 40;
    for (char r = row0; r < row0 + n; r++, dst += 40)
        *dst = cell_char(col, r);
}

// One slice of the hidden page: four rows copied one column left from the
// page on display, and those rows of the new right-hand column.
static void prep_step(void)
{
    char p = prep_page;
    char r = page_rows[p];
    unsigned off = r * 40;
    SLICE_SRC = (unsigned)(page_addr[shown_page] + off);
    SLICE_DST = (unsigned)(page_addr[p] + off);
    __asm { jsr ASM_SLICE_COPY }
    level_cells(page_addr[p] + 39, page_col[p] + 39, r, SLICE);
    brute_patch(p, r, SLICE);               // his cells, where the new column crossed him
    page_rows[p] = r + SLICE;
    if (page_rows[p] >= PF_ROWS)
        prep_page = NO_PAGE;
}

// A crossing to column cc: flip to the page that holds it (finishing it
// first if a slice is owed, which the camera speed rules out), and start
// preparing the page just left for the column after cc.
static void cross(unsigned cc)
{
    char next = 1 - shown_page;
    if (page_col[next] != (int)cc)
        page_draw(next, cc);                // not in play: the camera never jumps
    while (page_rows[next] < PF_ROWS)
    {
        prep_page = next;
        prep_step();
    }
    char left = shown_page;
    shown_page = next;
    shown_col = cc;
    page_col[left] = cc + 1;
    page_rows[left] = 0;
    prep_page = left;
    if (cc + 1 > COL_MAX)
    {
        page_rows[left] = PF_ROWS;          // off the street: nothing to prepare
        prep_page = NO_PAGE;
    }
    events |= EV_SCROLL;
}

// The camera keeps the hero left of screen x CAM_LEAD, moves right only,
// at most CAM_SPEED a frame, and stops at the stage's lock until the stage
// is clear, then at the next lock. The owed slice comes first.
void view_follow(void)
{
    if (prep_page != NO_PAGE)
        prep_step();
    unsigned limit = stage_lock[stage];
    if (stage_clear && stage + 1 < NSTAGE)
        limit = stage_lock[stage + 1];
    int t = (int)fx[0] - CAM_LEAD;
    if (t > (int)limit)
        t = limit;
    if (t > (int)camx + CAM_SPEED)
        t = camx + CAM_SPEED;
    if (t > (int)camx)
        camx = t;
    unsigned cc = camx >> 3;
    if (cc != shown_col)
        cross(cc);
}

char *page_ptr(char page)
{
    return page_addr[page];
}

// Fighters far to near by ground line: a persistent insertion sort
// (c64-kb lane_depth_engine), so a frame in which no one passed anyone
// costs one compare a fighter. Ties keep their order.
static void depth_sort(void)
{
    for (char i = 1; i < NFIGHT; i++)
    {
        char a = order[i];
        char y = fy[a];
        char j = i;
        while (j > 0 && fy[order[j - 1]] > y)
        {
            order[j] = order[j - 1];
            j--;
        }
        order[j] = a;
    }
}

// Sprite X of fighter f's part k: facing right the part's left edge is
// the origin + dx; facing left the part is mirrored about the origin, so
// its left edge is the origin - 24 - dx. World x camx is at VIC X 31.
int part_vic_x(char f, char k)
{
    const struct Part *pt = &pose_part[anim_pose(&fanim[f])][k];
    int x = (int)fx[f] - (int)camx + 31;
    return fface[f] == FACE_RIGHT ? x + pt->dx : x - 24 - pt->dx;
}

static bool shown(char f)
{
    char m = fmode[f];
    if (m == M_OFF)
        return false;
    if (finvuln[f] && (finvuln[f] & 4))
        return false;                       // the blink after a respawn
    if (m == M_KO && (ftimer[f] & 4))
        return false;                       // a beaten fighter blinks out
    return true;
}

// The back half of the three bands, then `ready`. Band 1: the nearest
// fighter's parts in sprites 0 and 1, the next in 2 and 3, and so on, so the
// VIC's rule (a lower sprite over a higher one) draws depth. Four fighters
// of two parts are eight sprites, so nothing is ever dropped; parts_dropped
// counts it anyway, and FLICKER_DEMO drops the eighth part on purpose.
void view_sprites(void)
{
    if (BLOB(ASM_READY))
        return;                             // the last set is not shown yet (never, in a synced loop)
    char back = BLOB(ASM_FRONT) ^ 8;
    char bi = back >> 3;
    sprites_half = bi;
    sprites_fresh = true;
    blink++;

    // Band 0: the GO sign, blinking, top right.
    char en = 0;
    if (go_sign && (blink & 16))
    {
        BLOB(ASM_BX0 + back) = 40;          // VIC X 296: $128, the high bit below
        BLOB(ASM_BY0 + back) = 52;
        BLOB(ASM_BP0 + back) = SPR_BLOCK + B_GO;
        BLOB(ASM_BC0 + back) = VCOL_YELLOW;
        en = 1;
    }
    BLOB(ASM_BMSB0 + bi) = 1;
    BLOB(ASM_BEN0 + bi) = en;

    // Band 1: the fighters, near to far. Plain pointers into the back half:
    // the IRQs never read it while it is being filled.
    depth_sort();
    char *tx = (char *)ASM_BX1 + back, *ty = (char *)ASM_BY1 + back;
    char *tp = (char *)ASM_BP1 + back, *tc = (char *)ASM_BC1 + back;
    char k = 0, msb = 0, top = 255, pri = 0;
    en = 0;
    char limit = FLICKER_DEMO ? 7 : 8;
    for (signed char i = NFIGHT - 1; i >= 0; i--)
    {
        char f = order[i];
        if (!shown(f) || fkind[f] == K_BRUTE)
            continue;                       // the brute is characters, not sprites
        bool behind = b_drawn && fy[f] < b_fy;  // farther than the brute: behind his pixels
        const struct Part *pt = pose_part[anim_pose(&fanim[f])];
        int ox = (int)fx[f] - (int)camx + 31;           // part_vic_x, once a fighter
        bool left = fface[f] == FACE_LEFT;
        char mirror = left ? B_MIRROR : 0;
        char kind = fkind[f];
        char base = fy[f] - fh[f];
        for (char p = 0; p < 2; p++)
        {
            int sx = left ? ox - 24 - pt[p].dx : ox + pt[p].dx;
            if (sx <= 0 || sx >= 344)
                continue;                   // under a border: off (sprite_x_range_hidden_and_seam)
            if (k >= limit)
            {
                parts_dropped++;
                continue;
            }
            char sy = base + pt[p].dy;
            char b = bit[k];
            tx[k] = (char)sx;
            ty[k] = sy;
            tp[k] = SPR_BLOCK + pt[p].block + mirror;
            tc[k] = p ? trousers[kind] : shirt[kind];
            if (sx >= 256)
                msb |= b;
            en |= b;
            if (behind)
                pri |= b;
            if (sy < top)
                top = sy;
            k++;
        }
    }
    BLOB(ASM_BMSB1 + bi) = msb;
    BLOB(ASM_BEN1 + bi) = en;
    BLOB(ASM_BPRI1 + bi) = pri;
    BLOB(ASM_BAND_TOP) = top;

    // Band 2: the faces beside the health bars.
    en = 0;
    BLOB(ASM_BX2 + back) = 24;              // column 0
    BLOB(ASM_BY2 + back) = 218;             // lines 219-239: rows 21-23
    BLOB(ASM_BP2 + back) = SPR_BLOCK + B_FACE_HERO;
    BLOB(ASM_BC2 + back) = shirt[K_HERO];
    en = 1;
    if (face_enemy < NFIGHT && fmode[face_enemy] != M_OFF)
    {
        char f = face_enemy;
        BLOB(ASM_BX2 + back + 1) = 184;     // column 20
        BLOB(ASM_BY2 + back + 1) = 218;
        BLOB(ASM_BP2 + back + 1) = SPR_BLOCK + face_block[fkind[f]];
        BLOB(ASM_BC2 + back + 1) = shirt[fkind[f]];
        en |= 2;
    }
    BLOB(ASM_BMSB2 + bi) = 0;
    BLOB(ASM_BEN2 + bi) = faces_off ? 0 : en;
}

// The end of a frame's work: the page and XSCROLL for the next picture and
// the sprite tables, together, for the IRQ at line 251 (engine.asm).
void view_publish(void)
{
    __asm { sei }
    BLOB(ASM_PF_D016) = D016_PLAY | (7 - (camx & 7));
    BLOB(ASM_PF_D018) = page_d018[shown_page] | (b_cs ? D018_CS1 : 0);   // the brute's set too
    BLOB(ASM_PF_PTRHI) = ((unsigned)page_addr[shown_page] >> 8) + 3;   // pointers at page + $3F8
    BLOB(ASM_READY) = 1;
    __asm { cli }
}
