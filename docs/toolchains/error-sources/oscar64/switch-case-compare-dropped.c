// switch-case-compare-dropped.c: a case's expiry compare disappears when a
// sibling case of the same switch adds a signed char to an int array element.
// Build: oscar64 -tm=c64 -O2 -o=rep.prg switch-case-compare-dropped.c
// Read the .asm: the case 6 block has the age add and the sprite-pose
// arithmetic but no compare with $14, and no branch to the free. The default
// case keeps its own CMP #$18. In VICE (x64sc, 4,000,000 cycles) the border
// stays RED: the object aged past 20 and was never freed.
//
// The fix is to branch in the case instead of carrying the result in `gone`
// for the tail after the switch:
//     case 6: {
//         char a = age[i] + 2;
//         age[i] = a;
//         p = 0xc9 + ((a >> 2) & 1);
//         if (a >= 20) { free_obj(i); continue; }   // compiles at -O0..-O3
//         break;
//     }
// With that the compare is emitted at every level and the border is GREEN.
//
// Isolated here: removing `x[i] += vx[i]` from case 2 (or writing `x[i] += 2`)
// brings the compare back; `x[i] += (signed char)v` with `char v` still loses
// it. Measured on Oscar64 1.32.271 (local build, upstream 709bd70 + c1270bc):
// the compare is dropped at -O1, -O2 and -O3 and kept at -O0. Released
// v1.32.273 and upstream HEAD are not installed here, so this shape is not
// tested on them. Found as issue #133 in the run-and-gun starter, where
// objects.c's K_BLAST case lost `gone = obj_age[i] >= 20` and enemy grenade
// blasts stayed on screen at age 96 (five of them), still hurting the player.

char age[11], kind[11], pri[11], anim[11];
int oy[11], x[11];
signed char vx[11];
char sly[11], sptr[11], scol[11], spri[11];
int scroll_wy;

char rd(void) { return *(char *)0xd012; }
void free_obj(char i);
char shot_tick(char i);

void update(void)
{
    char ofc = rd();
    int top_my = scroll_wy - 54;
    for (char i = 0; i < 11; i++) {
        char k = kind[i];
        if (k == 0)
            continue;
        char tp = ((i + ofc) >> 1) & 1;
        char gone = 0;
        char p;
        switch (k) {
        case 2:                         // the sibling case the fault needs:
            x[i] += vx[i];              // int element += signed char
            anim[i] ^= 1;
            if (!tp)
                pri[i] = rd() & 1;
            gone = x[i] <= 0 || x[i] >= 344;
            p = 0x58 + x[i];
            break;
        case 4:
            gone = shot_tick(i);
            p = 0xc5;
            break;
        case 6: {                       // the case that loses its compare
            char a = age[i] + 2;
            age[i] = a;
            gone = a >= 20;
            p = 0xc9 + ((a >> 2) & 1);
            break;
        }
        default:
            age[i] += 2;
            gone = age[i] >= 24;
            p = 0xcb;
            break;
        }
        int sy = oy[i] - top_my;
        if (gone || sy > 187 || (k == 4 && sy < 24)) {
            free_obj(i);
            continue;
        }
        sptr[i] = p;
        scol[i] = kind[i];
        spri[i] = pri[i];
        sly[i] = (char)sy;
    }
}

char shot_tick(char i) { return age[i] > 200; }
void free_obj(char i) { kind[i] = 0; }

int main(void)
{
    volatile char *border = (volatile char *)0xd020;
    kind[0] = 6;                        // the object that must expire at 20
    kind[1] = 2; x[1] = 100;
    kind[2] = 4;
    oy[0] = 100;
    for (unsigned f = 0; f < 400; f++)
        update();
    *border = kind[0] ? 2 : 5;          // red: still there; green: freed
    for (;;) ;
    return 0;
}
