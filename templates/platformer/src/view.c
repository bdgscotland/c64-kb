// view.c: the VIC-II side. Three playfield pages and a HUD page in bank 3;
// the camera; the scroll. The frame's registers are computed into shadows
// during the frame and written together in the vertical blank
// (view_apply), so a picture is always one page at one XSCROLL.
//
// Scroll, after c64-kb soft_scroll_h and screen_double_buffer_d018:
// XSCROLL = 7 - (camx & 7) moves the picture a pixel. A column crossing
// is a $D018 flip to a page that already holds the next column. Of the
// three pages one is on display (column c), one holds the column the
// camera just came from (the page shown before the last crossing, so it
// is ready for free), and the third is prepared for the next column in the
// direction of travel: five rows a frame, copied one column over from the
// page on display by slice_copy (engine.asm), plus the new column's five
// cells from the level. The camera moves at most 2 pixels a frame, so the
// next crossing that way is at least 4 frames off, and 4 slices finish it.
// No page is written while it is on display: nothing tears, and no frame
// carries a whole 20-row shift.
#include "game.h"
#include "asm.h"

#define CAM_LEFT   100              // the player's screen x the camera keeps between
#define CAM_RIGHT  140
#define CAM_SPEED  2                // pixels a frame, at most: 4 frames a column
#define SLICE      5                // rows a prepare step (engine.asm's SLICE)
#define NO_PAGE    0xff
#define COL_MAX    (LEVEL_CW - 40)  // the last column a page can start at

unsigned camx, shown_col;
unsigned pub_camx;                  // the camera of the pair last published
char shown_page;
int page_col[NPAGES];
char page_rows[NPAGES];
static char prep_page;              // the page being prepared, or NO_PAGE

static char *const page_addr[NPAGES] = { PAGE0, PAGE1, PAGE2 };
static const char page_d018[NPAGES] = { D018_PAGE0, D018_PAGE1, D018_PAGE2 };

static char sh_d016, sh_d018, sh_en, sh_msb, cia_ack;
static char sh_x[8], sh_y[8], sh_ptr[8], sh_col[8];

#define SLICE_SRC (*(volatile unsigned *)ASM_SLICE_SRC)
#define PF_D016   (*(volatile char *)ASM_PF_D016)
#define PF_D018   (*(volatile char *)ASM_PF_D018)
#define SLICE_DST (*(volatile unsigned *)ASM_SLICE_DST)

void view_init(void)
{
    vic.spr_enable = 0;
    cia2.pra = cia2.pra & 0xfc;             // VIC bank 3: $C000-$FFFF
    vic.ctrl1 = 0x1b;                       // display on, 25 rows, YSCROLL 3
    vic.ctrl2 = D016_PLAY | 7;
    vic.memptr = D018_PAGE0;
    PF_D016 = D016_PLAY | 7;
    PF_D018 = D018_PAGE0;
    vic.color_border = COL_SKY;
    vic.color_back = COL_SKY;
    vic.color_back1 = COL_EARTH;
    vic.color_back2 = COL_GOLD;
    vic.spr_multi = 0;
    vic.spr_expand_x = 0;
    vic.spr_expand_y = 0;
    vic.spr_priority = 0;                   // sprites in front of the playfield

    for (unsigned i = 0; i < 1024; i++)
    {
        PAGE0[i] = CH_SKY;
        PAGE1[i] = CH_SKY;
        PAGE2[i] = CH_SKY;
        HUDPAGE[i] = CH_SKY;
    }
    for (unsigned i = 0; i < PF_ROWS * 40; i++)
        COLOUR[i] = 0x08 | COL_GRASS;       // multicolour; 11 draws grass
    for (unsigned i = PF_ROWS * 40; i < 1000; i++)
        COLOUR[i] = VCOL_WHITE;             // row 20 is blank; the HUD is hires white

    // The split IRQ. BASIC and KERNAL are out ($01 = $35), so the CPU takes
    // its vectors from RAM: $FFFE to the split, $FFFA (RESTORE) to an RTI.
    *(volatile unsigned *)0xfffe = ASM_IRQ_SPLIT;   // it then points $FFFE at irq_blank, and back
    *(volatile unsigned *)0xfffa = ASM_NMI_RTI;
    cia1.icr = 0x7f;                        // no CIA1 interrupts: the KERNAL's timer is not wanted
    cia_ack = cia1.icr;                     // read: clears a pending CIA1 interrupt
    vic.raster = SPLIT_LINE;                // $D011 bit 7 is 0: line 212
    vic.intr_ctrl = 0x0f;                   // clear anything pending
    vic.intr_enable = 0x01;                 // raster only
    __asm { cli }
}

// Rows row0 to row0 + n - 1 of world column col, down a page column.
static void level_cells(char *dst, unsigned col, char row0, char n)
{
    dst += row0 * 40;
    for (char r = row0; r < row0 + n; r++, dst += 40)
        *dst = cell_char(col, r);
}

static void page_draw(char p, int col)
{
    page_col[p] = col;
    page_rows[p] = PF_ROWS;
    if (col < 0 || col > COL_MAX)
        return;                             // off the level: never shown
    for (char c = 0; c < 40; c++)
        level_column(page_addr[p] + c, col + c);
}

// Draw all three pages whole: the start of a game, not a scroll.
void view_cut(void)
{
    shown_col = camx >> 3;
    shown_page = 0;
    page_draw(0, shown_col);
    page_draw(1, (int)shown_col + 1);
    page_draw(2, (int)shown_col - 1);
    prep_page = NO_PAGE;
    sh_d016 = D016_PLAY | (7 - (camx & 7));
    sh_d018 = page_d018[0];
}

// A taken coin: every page that holds the cell, so a page shown later
// cannot bring it back.
void view_erase_tile(unsigned col, char row)
{
    char r = row & 0xfe;
    for (char p = 0; p < NPAGES; p++)
    {
        char *base = page_addr[p] + r * 40;
        int sc = (int)(col & ~1u) - page_col[p];
        for (char k = 0; k < 2; k++, sc++)
        {
            if (sc >= 0 && sc < 40)
            {
                base[sc] = CH_SKY;
                base[sc + 40] = CH_SKY;
            }
        }
    }
}

// One slice of the page being prepared: five rows copied one column over
// from the page on display, and those rows of the new column.
static void prep_step(void)
{
    char p = prep_page;
    char r = page_rows[p];
    unsigned off = r * 40;
    char *src = page_addr[shown_page] + off;
    char *dst = page_addr[p] + off;
    if (page_col[p] > (int)shown_col)
    {
        SLICE_SRC = (unsigned)src + 1;      // the picture moves left
        SLICE_DST = (unsigned)dst;
        __asm { jsr ASM_SLICE_COPY }
        level_cells(page_addr[p] + 39, page_col[p] + 39, r, SLICE);
    }
    else
    {
        SLICE_SRC = (unsigned)src;          // the picture moves right
        SLICE_DST = (unsigned)dst + 1;
        __asm { jsr ASM_SLICE_COPY }
        level_cells(page_addr[p], page_col[p], r, SLICE);
    }
    page_rows[p] = r + SLICE;
    if (page_rows[p] >= PF_ROWS)
        prep_page = NO_PAGE;
}

#if TEAR_DEMO
// The old way, for tools/tearcheck.py to catch: shift the page on display
// in place, in C, while the beam draws it (issue #18).
static void shift_in_place(char *p, bool left)
{
    for (char r = 0; r < PF_ROWS; r++, p += 40)
    {
        if (left)
            for (char c = 0; c < 39; c++)
                p[c] = p[c + 1];
        else
            for (char c = 39; c > 0; c--)
                p[c] = p[c - 1];
    }
}
#endif

// A crossing to column cc: flip to the page that holds it (finishing it
// first if a slice is still owed, which the camera speed rules out in
// play), keep the page just left as the neighbour behind, and start
// preparing the third for the column after cc.
static void cross(unsigned cc)
{
    bool right = cc > shown_col;
#if TEAR_DEMO
    char *p = page_addr[shown_page];
    shift_in_place(p, right);
    if (right)
        level_column(p + 39, cc + 39);
    else
        level_column(p, cc);
    page_col[shown_page] = cc;
#else
    char next = NO_PAGE;
    for (char p = 0; p < NPAGES; p++)
        if (p != shown_page && page_col[p] == (int)cc)
            next = p;
    if (next == NO_PAGE)
    {
        next = prep_page != NO_PAGE ? prep_page : (shown_page + 1) % NPAGES;
        page_col[next] = cc;
        page_rows[next] = 0;
    }
    while (page_rows[next] < PF_ROWS)
    {
        prep_page = next;
        prep_step();                        // owed slices: not in play (see above)
    }
    char behind = shown_page;
    shown_page = next;
    char third = NPAGES - next - behind;    // pages are 0, 1, 2
    int target = right ? (int)cc + 1 : (int)cc - 1;
    page_col[third] = target;
    page_rows[third] = 0;
    prep_page = third;
    if (target < 0 || target > COL_MAX)
    {
        page_rows[third] = PF_ROWS;         // off the level: nothing to prepare
        prep_page = NO_PAGE;
    }
#endif
    events |= right ? EV_SHIFT_L : EV_SHIFT_R;
    shown_col = cc;
}

// The camera keeps the player between screen x 100 and 140, moving at most
// CAM_SPEED a frame. The owed slice comes first, so a page due at this
// frame's crossing is finished before the crossing is decided.
void view_follow(void)
{
#if !TEAR_DEMO
    if (prep_page != NO_PAGE)
        prep_step();
#endif
    int sx = (int)px - (int)camx;
    int t = camx;
    if (sx > CAM_RIGHT)
        t = (int)px - CAM_RIGHT;
    else if (sx < CAM_LEFT)
        t = (int)px - CAM_LEFT;
    if (t < 0)
        t = 0;
    else if (t > CAM_MAX)
        t = CAM_MAX;
    if (t > (int)camx + CAM_SPEED)
        t = camx + CAM_SPEED;
    else if (t < (int)camx - CAM_SPEED)
        t = camx - CAM_SPEED;
    camx = t;

    unsigned cc = camx >> 3;
    if (cc != shown_col)
        cross(cc);
    sh_d016 = D016_PLAY | (7 - (camx & 7));
    sh_d018 = page_d018[shown_page];
}

// One sprite's shadow. Art is 16 wide; x is the art's left edge in the
// world; line is the Y register, one above the art's top row (the VIC
// draws a sprite from line Y + 1, and world row y is on line 51 + y). A
// sprite off the 38-column window is switched off: X wraps at 504 on PAL
// and 520 on NTSC (c64-kb sprite_x_range_hidden_and_seam).
static void put_sprite(char n, int x, int line, char shape, char colour, bool on)
{
    int sx = x - (int)camx + 31;            // world pixel camx sits at VIC X 31
    char bit = 1 << n;
    if (on && sx > 8 && sx < 335 && line > 20 && line < 250)
    {
        sh_en |= bit;
        sh_x[n] = sx & 0xff;
        if (sx & 0x100)
            sh_msb |= bit;
        sh_y[n] = line;
        sh_ptr[n] = SPR_BLOCK + shape;
        sh_col[n] = colour;
    }
}

void view_sprites(void)
{
    sh_en = 0;
    sh_msb = 0;
    char ps = panim.shape + (pleft && panim.shape < SH_MIRROR ? SH_MIRROR : 0);
    put_sprite(0, px - 8, (int)(py >> 8) - 21 + 50, ps, COL_PLAYER, !(pinvuln & 4));
    for (char s = 0; s < NSLOT; s++)
    {
        if (slot_lvl[s] != NO_SLOT)
            put_sprite(s + 1, slot_x[s] - 8, (int)(slot_y[s] >> 8) - 16 + 50, slot_anim[s].shape,
                       slot_type[s] == T_WALKER ? COL_WALKER : COL_HOPPER, true);
    }
}

// The end of a frame's work: the page and XSCROLL for the next picture,
// as one pair, for the IRQ at line 251 to write (engine.asm).
void view_publish(void)
{
    __asm { sei }
    PF_D016 = sh_d016;
    PF_D018 = sh_d018;
    pub_camx = camx;
    __asm { cli }
}

// The vertical blank, from line 251: the sprites for the picture the IRQ
// has just set up. The sprite pointers go to every page, because the VIC
// reads them from whichever page it is showing.
void view_apply(void)
{
    for (char n = 0; n < 8; n++)
    {
        vic.spr_pos[n].x = sh_x[n];
        vic.spr_pos[n].y = sh_y[n];
        vic.spr_color[n] = sh_col[n];
        char p = sh_ptr[n];
        PAGE0[0x3f8 + n] = p;
        PAGE1[0x3f8 + n] = p;
        PAGE2[0x3f8 + n] = p;
        HUDPAGE[0x3f8 + n] = p;
    }
    vic.spr_msbx = sh_msb;
    vic.spr_enable = sh_en;
}
