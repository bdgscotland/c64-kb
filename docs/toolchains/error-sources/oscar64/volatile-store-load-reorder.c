#include <c64/cia.h>
char state, prev;
__noinline void a(char j) { *(volatile char *)0xd020 = j; }
int main(void)
{
    for (;;) {
        char j = cia1.pra;
        cia1.pra = 0x7f;
        if (!(cia1.prb & 0x10))
            j &= ~0x20;
        cia1.pra = 0xff;
        if (state)
            a(j);
        prev = j;
    }
    return 0;
}
