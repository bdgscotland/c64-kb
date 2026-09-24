---
recipe: monitor-core
toolchain: oscar64
output_format: PRG
region: both
techniques: [machine_language_monitor_core]
file_formats: [PRG]
uses_registers: [D020, D021, DC04, DC05, DC06, DC07, DC0E, DC0F]
uses_kernal: []
---

<!-- doc-type: recipe -->

# Oscar64 monitor core: dump, disassembler, mini-assembler and a BRK breakpoint, checked over the KERNAL ROM

## Synopsis

The core of a machine-language monitor. A dump line prints eight bytes
from `$FFF8`. A table-driven disassembler turns the 151 legal opcodes
into text, and a mini-assembler reads that text back into bytes. The two
are checked against each other on every legal opcode and on every
instruction of the KERNAL ROM, `$E000` to `$FFFF`, decoded in sequence.
A breakpoint replaces an `LDX #$22` in a test routine with `BRK`. The
handler, entered through the KERNAL's BRK vector at `$0316`, records the
registers, puts the original byte back and resumes, once at the stacked
PC minus 2 and once at the stacked PC. CIA1 timers A and B time the ROM
round trip. `$02FF` holds `01` and the border is green when neither
round trip has a mismatch, the breakpoint is where the disassembler
found the `LDX`, and the two resumes leave X at `$22` and `$99`; else
`02` and red. It implements `machine_language_monitor_core`
(`techniques/cpu-cycle-tricks.md`) and measures
`brk_resume_at_stacked_pc_skips_instruction` (`pitfalls/cpu.md`).

## Source

```c
// monitor-core.c
// The core of a machine-language monitor: a memory dump, a table-driven
// disassembler for the 151 legal opcodes, a mini-assembler that reads the
// disassembler's own text back, and a BRK breakpoint. The disassembler
// and the assembler are checked against each other on all 151 legal
// opcodes and over the whole KERNAL ROM: every legal instruction from
// $E000 to $FFFF is disassembled to text, assembled again at the same
// address and compared byte for byte.
// The breakpoint replaces an LDX #$22 in a test routine with BRK; the
// handler, entered through the KERNAL's BRK vector at $0316, records the
// registers, puts the original byte back and resumes. Resumed at the
// stacked PC minus 2 the LDX runs and X ends as $22; resumed at the
// stacked PC it is skipped and X keeps the $99 loaded before it. CIA1
// timers A and B time the ROM round trip. $02FF holds 01 and the border
// is green when neither round trip has a mismatch, the breakpoint address
// equals the LDX, and the two resumes give $22 and $99; else 02 and red.
#include <c64/vic.h>
#include <c64/cia.h>

#define SCREEN ((char *)0x0400)
#define COLOUR ((char *)0xd800)
#define RESULT (*(volatile char *)0x02ff)
#define CBINV (*(volatile unsigned *)0x0316)   // KERNAL BRK vector

enum Mode { IMP, ACC, IMM, ZP, ZPX, ZPY, ABS, ABX, ABY, IND, IZX, IZY, REL };
static const char mode_len[13] = { 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2 };

// Opcode tables, checked opcode by opcode against VICE's monitor.
static const char mnemonics[] =
    "ADCANDASLBCCBCSBEQBITBMI"
    "BNEBPLBRKBVCBVSCLCCLDCLI"
    "CLVCMPCPXCPYDECDEXDEYEOR"
    "INCINXINYJMPJSRLDALDXLDY"
    "LSRNOPORAPHAPHPPLAPLPROL"
    "RORRTIRTSSBCSECSEDSEISTA"
    "STXSTYTAXTAYTSXTXATXSTYA"
    ;
// Mnemonic index per opcode, 0xff for an opcode that is not legal.
static const char op_mn[256] = {
     10,  34, 255, 255, 255,  34,   2, 255,  36,  34,   2, 255, 255,  34,   2, 255,
      9,  34, 255, 255, 255,  34,   2, 255,  13,  34, 255, 255, 255,  34,   2, 255,
     28,   1, 255, 255,   6,   1,  39, 255,  38,   1,  39, 255,   6,   1,  39, 255,
      7,   1, 255, 255, 255,   1,  39, 255,  44,   1, 255, 255, 255,   1,  39, 255,
     41,  23, 255, 255, 255,  23,  32, 255,  35,  23,  32, 255,  27,  23,  32, 255,
     11,  23, 255, 255, 255,  23,  32, 255,  15,  23, 255, 255, 255,  23,  32, 255,
     42,   0, 255, 255, 255,   0,  40, 255,  37,   0,  40, 255,  27,   0,  40, 255,
     12,   0, 255, 255, 255,   0,  40, 255,  46,   0, 255, 255, 255,   0,  40, 255,
    255,  47, 255, 255,  49,  47,  48, 255,  22, 255,  53, 255,  49,  47,  48, 255,
      3,  47, 255, 255,  49,  47,  48, 255,  55,  47,  54, 255, 255,  47, 255, 255,
     31,  29,  30, 255,  31,  29,  30, 255,  51,  29,  50, 255,  31,  29,  30, 255,
      4,  29, 255, 255,  31,  29,  30, 255,  16,  29,  52, 255,  31,  29,  30, 255,
     19,  17, 255, 255,  19,  17,  20, 255,  26,  17,  21, 255,  19,  17,  20, 255,
      8,  17, 255, 255, 255,  17,  20, 255,  14,  17, 255, 255, 255,  17,  20, 255,
     18,  43, 255, 255,  18,  43,  24, 255,  25,  43,  33, 255,  18,  43,  24, 255,
      5,  43, 255, 255, 255,  43,  24, 255,  45,  43, 255, 255, 255,  43,  24, 255,
};
// Addressing mode per opcode (enum Mode).
static const char op_mode[256] = {
     0, 10,  0,  0,  0,  3,  3,  0,  0,  2,  1,  0,  0,  6,  6,  0,
    12, 11,  0,  0,  0,  4,  4,  0,  0,  8,  0,  0,  0,  7,  7,  0,
     6, 10,  0,  0,  3,  3,  3,  0,  0,  2,  1,  0,  6,  6,  6,  0,
    12, 11,  0,  0,  0,  4,  4,  0,  0,  8,  0,  0,  0,  7,  7,  0,
     0, 10,  0,  0,  0,  3,  3,  0,  0,  2,  1,  0,  6,  6,  6,  0,
    12, 11,  0,  0,  0,  4,  4,  0,  0,  8,  0,  0,  0,  7,  7,  0,
     0, 10,  0,  0,  0,  3,  3,  0,  0,  2,  1,  0,  9,  6,  6,  0,
    12, 11,  0,  0,  0,  4,  4,  0,  0,  8,  0,  0,  0,  7,  7,  0,
     0, 10,  0,  0,  3,  3,  3,  0,  0,  0,  0,  0,  6,  6,  6,  0,
    12, 11,  0,  0,  4,  4,  5,  0,  0,  8,  0,  0,  0,  7,  0,  0,
     2, 10,  2,  0,  3,  3,  3,  0,  0,  2,  0,  0,  6,  6,  6,  0,
    12, 11,  0,  0,  4,  4,  5,  0,  0,  8,  0,  0,  7,  7,  8,  0,
     2, 10,  0,  0,  3,  3,  3,  0,  0,  2,  0,  0,  6,  6,  6,  0,
    12, 11,  0,  0,  0,  4,  4,  0,  0,  8,  0,  0,  0,  7,  7,  0,
     2, 10,  0,  0,  3,  3,  3,  0,  0,  2,  0,  0,  6,  6,  6,  0,
    12, 11,  0,  0,  0,  4,  4,  0,  0,  8,  0,  0,  0,  7,  7,  0,
};

static const char hexd[16] = { '0', '1', '2', '3', '4', '5', '6', '7',
                               '8', '9', 'A', 'B', 'C', 'D', 'E', 'F' };

static char *put_hex8(char *p, char v)
{
    *p++ = hexd[v >> 4];
    *p++ = hexd[v & 15];
    return p;
}

static char *put_hex16(char *p, unsigned v)
{
    p = put_hex8(p, (char)(v >> 8));
    return put_hex8(p, (char)v);
}

// ---- disassembler ---------------------------------------------------------

// Instruction text at `pc` into `out` (zero-terminated): "LDA ($FB),Y".
// Returns the instruction length, 0 for an opcode that is not legal.
__noinline char disasm(unsigned pc, char *out)
{
    const char *m = (const char *)pc;
    char op = m[0];
    char mn = op_mn[op];
    if (mn == 0xff)
    {
        out[0] = 0;
        return 0;
    }
    char mode = op_mode[op];
    char *p = out;
    const char *name = mnemonics + 3 * mn;
    *p++ = name[0];
    *p++ = name[1];
    *p++ = name[2];
    if (mode != IMP)
        *p++ = ' ';
    unsigned w = m[1] | (m[2] << 8);
    switch (mode)
    {
    case ACC: *p++ = 'A'; break;
    case IMM: *p++ = '#'; *p++ = '$'; p = put_hex8(p, m[1]); break;
    case ZP: case ZPX: case ZPY:
        *p++ = '$'; p = put_hex8(p, m[1]);
        if (mode == ZPX) { *p++ = ','; *p++ = 'X'; }
        if (mode == ZPY) { *p++ = ','; *p++ = 'Y'; }
        break;
    case ABS: case ABX: case ABY:
        *p++ = '$'; p = put_hex16(p, w);
        if (mode == ABX) { *p++ = ','; *p++ = 'X'; }
        if (mode == ABY) { *p++ = ','; *p++ = 'Y'; }
        break;
    case IND: *p++ = '('; *p++ = '$'; p = put_hex16(p, w); *p++ = ')'; break;
    case IZX: *p++ = '('; *p++ = '$'; p = put_hex8(p, m[1]); *p++ = ','; *p++ = 'X'; *p++ = ')'; break;
    case IZY: *p++ = '('; *p++ = '$'; p = put_hex8(p, m[1]); *p++ = ')'; *p++ = ','; *p++ = 'Y'; break;
    case REL:
        *p++ = '$';
        p = put_hex16(p, pc + 2 + (signed char)m[1]);
        break;
    }
    *p = 0;
    return mode_len[mode];
}

// ---- mini-assembler ---------------------------------------------------------

static const char *hex_in(const char *s, unsigned *v, char *digits)
{
    *v = 0;
    *digits = 0;
    for (;;)
    {
        char c = *s, d;
        if (c >= '0' && c <= '9') d = c - '0';
        else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
        else break;
        *v = (*v << 4) | d;
        (*digits)++;
        s++;
    }
    return s;
}

// Reverse table: opcode for (mnemonic, mode), built once from the two
// forward tables; 0xff where the pair does not exist ($FF is not legal).
static char op_for[56 * 13];

static void build_op_for(void)
{
    for (unsigned i = 0; i < 56 * 13; i++)
        op_for[i] = 0xff;
    for (unsigned op = 0; op < 256; op++)
        if (op_mn[op] != 0xff)
            op_for[op_mn[op] * 13 + op_mode[op]] = (char)op;
}

static int find_op(char mn, char mode)
{
    char op = op_for[mn * 13 + mode];
    return op == 0xff ? -1 : op;
}

// Assemble one line of the disassembler's text at `pc` into `out`.
// Returns the length, 0 for a line it cannot assemble.
__noinline char assemble(const char *s, unsigned pc, char *out)
{
    char mn = 0xff;
    for (char i = 0; i < 56; i++)
    {
        const char *n = mnemonics + 3 * i;
        if (n[0] == s[0] && n[1] == s[1] && n[2] == s[2])
        {
            mn = i;
            break;
        }
    }
    if (mn == 0xff)
        return 0;
    s += 3;
    if (*s == ' ')
        s++;
    char mode;
    unsigned v = 0;
    char digits = 0;
    if (*s == 0)
        mode = IMP;
    else if (s[0] == 'A' && s[1] == 0)
        mode = ACC;
    else if (*s == '#')
    {
        hex_in(s + 2, &v, &digits);
        mode = IMM;
    }
    else if (*s == '(')
    {
        s = hex_in(s + 2, &v, &digits);
        if (s[0] == ',')
            mode = IZX;
        else if (s[1] == ',')
            mode = IZY;
        else
            mode = IND;
    }
    else
    {
        s = hex_in(s + 1, &v, &digits);
        char x = s[0] == ',' ? s[1] : 0;
        if (find_op(mn, REL) >= 0)
            mode = REL;
        else if (digits <= 2)
            mode = x == 'X' ? ZPX : x == 'Y' ? ZPY : ZP;
        else
            mode = x == 'X' ? ABX : x == 'Y' ? ABY : ABS;
    }
    int op = find_op(mn, mode);
    if (op < 0)
        return 0;
    out[0] = (char)op;
    if (mode == REL)
    {
        int d = (int)(v - (pc + 2));
        if (d < -128 || d > 127)
            return 0;
        out[1] = (char)d;
    }
    else
    {
        out[1] = (char)v;
        out[2] = (char)(v >> 8);
    }
    return mode_len[mode];
}

// ---- breakpoint -------------------------------------------------------------

volatile char reg_a, reg_x, reg_y, reg_p, reg_s, pc_lo, pc_hi;
volatile char bp_orig;          // the byte the BRK replaced
volatile char resume_fix;       // 1: resume at stacked PC - 2
volatile char got_x, got_y;
volatile char save_fb, save_fc;

// Entered from the KERNAL: $FFFE -> $FF48 pushes A, X, Y and, seeing the
// B flag in the stacked status, jumps through $0316. Stack from SP+1:
// Y, X, A, P, PCL, PCH. The stacked PC is the BRK's address plus 2.
__noinline void brk_entry(void)
{
    __asm volatile {
        tsx
        stx reg_s
        lda $0101,x
        sta reg_y
        lda $0102,x
        sta reg_x
        lda $0103,x
        sta reg_a
        lda $0104,x
        sta reg_p
        lda $0105,x
        sta pc_lo
        lda $0106,x
        sta pc_hi
        lda $fb
        sta save_fb
        lda $fc
        sta save_fc
        sec                     // pointer = stacked PC - 2: the BRK
        lda $0105,x
        sbc #2
        sta $fb
        lda $0106,x
        sbc #0
        sta $fc
        ldy #0
        lda bp_orig             // put the original opcode back
        sta ($fb),y
        lda resume_fix
        beq keep
        lda $fb                 // resume at the breakpoint itself
        sta $0105,x
        lda $fc
        sta $0106,x
    keep:
        lda save_fb
        sta $fb
        lda save_fc
        sta $fc
        jmp $ea81               // PLA TAY PLA TAX PLA RTI
    }
}

// The routine under test. The breakpoint goes on the LDX #$22.
__noinline void bp_test(void)
{
    __asm volatile {
        ldx #$99
        lda #$11
        ldx #$22
        ldy #$33
        stx got_x
        sty got_y
    }
}

static void run_to_break(unsigned bp, char fix)
{
    char *b = (char *)bp;
    bp_orig = *b;
    *b = 0x00;                  // BRK
    resume_fix = fix;
    got_x = got_y = 0;
    bp_test();
}

// ---- screen and timing -------------------------------------------------------

static char line[41];

static void put_line(char row, const char *s)
{
    char *p = SCREEN + 40 * row;
    while (*s)
    {
        char c = *s++;
        *p++ = (c >= 'A' && c <= 'Z') ? c - 'A' + 1 : (c >= 'a' && c <= 'z') ? c - 'a' + 1 : c;
    }
}

static char *put_str(char *p, const char *s)
{
    while (*s)
        *p++ = *s++;
    return p;
}

static char *put_dec(char *p, unsigned long v, char width)
{
    char *e = p + width;
    do
    {
        *--e = '0' + (char)(v % 10);
        v /= 10;
    } while (e > p);
    return p + width;
}

// "ADDR  BB BB BB  TEXT" for the instruction at pc; returns its length.
static char list_line(char row, unsigned pc)
{
    char text[16];
    char n = disasm(pc, text);
    char *p = put_hex16(line, pc);
    *p++ = ' ';
    *p++ = ' ';
    for (char i = 0; i < 3; i++)
    {
        if (i < n)
            p = put_hex8(p, ((char *)pc)[i]);
        else
        {
            *p++ = ' ';
            *p++ = ' ';
        }
        *p++ = ' ';
    }
    *p++ = ' ';
    p = put_str(p, n ? text : "???");
    *p = 0;
    put_line(row, line);
    return n ? n : 1;
}

static void timer_start(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    cia1.ta = 0xffff;
    cia1.tb = 0xffff;
    cia1.crb = 0x51;
    cia1.cra = 0x11;
}

static unsigned long timer_stop(void)
{
    cia1.cra = 0x00;
    cia1.crb = 0x00;
    return ((unsigned long)(0xffff - cia1.tb) << 16) + (0xffff - cia1.ta);
}

// Disassemble and reassemble every legal instruction from $E000 to $FFFF.
static unsigned rt_instr, rt_data, rt_bad;

__noinline void round_trip(void)
{
    char text[16], bytes[3];
    unsigned pc = 0xe000;
    rt_instr = rt_data = rt_bad = 0;
    for (;;)
    {
        char n = disasm(pc, text);
        if (n == 0)
        {
            rt_data++;
            n = 1;
        }
        else
        {
            if (pc > 0xffff - (n - 1))
                break;          // would run past the top of memory
            rt_instr++;
            const char *m = (const char *)pc;
            if (assemble(text, pc, bytes) != n || bytes[0] != m[0]
                || (n > 1 && bytes[1] != m[1]) || (n > 2 && bytes[2] != m[2]))
                rt_bad++;
        }
        if (pc > 0xffff - n)
            break;
        pc += n;
    }
}

// Every legal opcode once, with operand bytes $34 $12, through both.
static unsigned all_ops, all_bad;
static char probe[3];

static void all_opcodes(void)
{
    char text[16], bytes[3];
    all_ops = all_bad = 0;
    for (unsigned op = 0; op < 256; op++)
    {
        probe[0] = (char)op;
        probe[1] = 0x34;
        probe[2] = 0x12;
        char n = disasm((unsigned)probe, text);
        if (n == 0)
            continue;
        all_ops++;
        if (assemble(text, (unsigned)probe, bytes) != n || bytes[0] != probe[0]
            || (n > 1 && bytes[1] != probe[1]) || (n > 2 && bytes[2] != probe[2]))
            all_bad++;
    }
}

int main(void)
{
    __asm { sei }
    for (unsigned i = 0; i < 1000; i++)
    {
        SCREEN[i] = 0x20;
        COLOUR[i] = VCOL_WHITE;
    }
    vic.color_back = VCOL_BLACK;
    vic.color_border = VCOL_BLACK;
    put_line(0, "monitor core: dump, disasm, asm, brk");
    build_op_for();

    // Dump: the hardware vectors at the top of the KERNAL.
    char *p = put_str(line, "M ");
    p = put_hex16(p, 0xfff8);
    *p++ = ' ';
    for (char i = 0; i < 8; i++)
    {
        *p++ = ' ';
        p = put_hex8(p, ((char *)0xfff8)[i]);
    }
    *p = 0;
    put_line(2, line);

    // List the test routine and find its second LDX with the disassembler.
    unsigned pc = (unsigned)bp_test, bp = 0;
    char ldx_seen = 0;
    for (char r = 0; r < 6; r++)
    {
        char text[16];
        disasm(pc, text);
        if (text[0] == 'L' && text[1] == 'D' && text[2] == 'X' && ++ldx_seen == 2)
            bp = pc;
        pc += list_line(4 + r, pc);
    }

    // Breakpoint, resumed correctly and then naively.
    unsigned old = CBINV;
    CBINV = (unsigned)brk_entry;
    run_to_break(bp, 1);
    char x_fix = got_x, y_fix = got_y;
    unsigned brk_pc = pc_lo | (pc_hi << 8);
    char a_at = reg_a, x_at = reg_x, p_at = reg_p;
    run_to_break(bp, 0);
    char x_naive = got_x, y_naive = got_y;
    CBINV = old;

    p = put_str(line, "BRK AT ");
    p = put_hex16(p, brk_pc - 2);
    p = put_str(p, " PC ");
    p = put_hex16(p, brk_pc);
    p = put_str(p, " A ");
    p = put_hex8(p, a_at);
    p = put_str(p, " X ");
    p = put_hex8(p, x_at);
    p = put_str(p, " P ");
    p = put_hex8(p, p_at);
    *p = 0;
    put_line(11, line);
    p = put_str(line, "RESUME PC-2: X ");
    p = put_hex8(p, x_fix);
    p = put_str(p, " Y ");
    p = put_hex8(p, y_fix);
    *p = 0;
    put_line(12, line);
    p = put_str(line, "RESUME PC:   X ");
    p = put_hex8(p, x_naive);
    p = put_str(p, " Y ");
    p = put_hex8(p, y_naive);
    *p = 0;
    put_line(13, line);

    all_opcodes();
    p = put_str(line, "ALL OPCODES ");
    p = put_dec(p, all_ops, 3);
    p = put_str(p, " WRONG ");
    p = put_dec(p, all_bad, 3);
    *p = 0;
    put_line(14, line);

    // The round trip over the KERNAL ROM, timed.
    timer_start();
    round_trip();
    unsigned long cyc = timer_stop();
    p = put_str(line, "ROM E000-FFFF INSTR ");
    p = put_dec(p, rt_instr, 4);
    p = put_str(p, " DATA ");
    p = put_dec(p, rt_data, 4);
    *p = 0;
    put_line(15, line);
    p = put_str(line, "REASSEMBLED WRONG ");
    p = put_dec(p, rt_bad, 4);
    *p = 0;
    put_line(16, line);
    p = put_str(line, "CYCLES ");
    p = put_dec(p, cyc, 8);
    p = put_str(p, " PER INSTR ");
    p = put_dec(p, cyc / rt_instr, 4);
    *p = 0;
    put_line(17, line);

    bool ok = rt_bad == 0 && rt_instr > 0 && all_ops == 151 && all_bad == 0 && bp != 0 && brk_pc - 2 == bp
           && x_fix == 0x22 && y_fix == 0x33 && x_naive == 0x99 && y_naive == 0x33;
    put_line(19, ok ? "PASS" : "FAIL");
    RESULT = ok ? 0x01 : 0x02;
    vic.color_border = ok ? VCOL_GREEN : VCOL_RED;
    for (;;)
        ;
    return 0;
}
```

## Build

```bash
oscar64 -tm=c64 -O2 -o=monitor-core.prg monitor-core.c
```

Run headless, pinned at 16,000,000 cycles (the ROM round trip alone is
about 9.5 million):

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 -limitcycles 16000000 -exitscreenshot monitor-core.png -autostart monitor-core.prg
```

Add `-model ntsc` for the NTSC picture. The PRG is 4,778 bytes.

## Expected output

White text on black, green border. PAL,
`screenshots/monitor-core.png`:

```
monitor core: dump, disasm, asm, brk

m fff8  42 59 43 fe e2 fc 48 ff

0e62  a2 99     ldx #$99
0e64  a9 11     lda #$11
0e66  a2 22     ldx #$22
0e68  a0 33     ldy #$33
0e6a  8e f0 17  stx $17f0
0e6d  8c f1 17  sty $17f1

brk at 0e66 pc 0e68 a 11 x 99 p 35
resume pc-2: x 22 y 33
resume pc:   x 99 y 33
all opcodes 151 wrong 000
rom e000-ffff instr 3850 data 0175
reassembled wrong 0000
cycles 09437960 per instr 2451

pass
```

NTSC, `screenshots/monitor-core-ntsc.png`: the same, with `cycles
09520146 per instr 2472`. Read from both screenshots with a PIL decoder
against the character ROM (VICE x64sc 3.10). The addresses are where
this build put the routine and its variables.

Checked on the host, not by the listing: the eight dump bytes equal
`$1FF8-$1FFF` of `kernal-901227-03.bin`; a Python decode of the same ROM
with the same opcode map gives 3,850 instructions and 175 bytes that are
not legal opcodes; and the opcode map agrees with VICE's monitor on all
151 legal opcodes (mnemonic, addressing mode and length), from a run
that disassembled each of the 256 opcodes followed by `$34 $12`, and
VICE gives no legal mnemonic to any of the other 105.

## Why this works

**The disassembler** is two 256-byte tables indexed by the opcode: the
mnemonic number (`$FF` for an opcode that is not legal) and the
addressing mode. The mode gives the length and the operand format, so
one `switch` prints every instruction. A relative branch prints its
target, `pc + 2 + offset`, not the offset.

**The mini-assembler** reads that format back. It finds the mnemonic,
reads the operand's shape (`#`, `(..,X)`, `(..),Y`, `(..)`, `,X`, `,Y`)
and the number of hex digits (two for zero page, four for absolute), and
looks the pair up in a reverse table built once from the forward ones. A
branch mnemonic takes its operand as a target and stores the offset,
refused beyond -128 to +127. The first version searched all 256 opcodes
for each pair; the round trip then did not finish in 30,000,000 cycles.
The reverse table brought it to 9,437,960 on PAL, 2,451 cycles an
instruction for both directions in Oscar64 C.

**The breakpoint.** BRK is a two-byte instruction: it pushes the address
of the BRK plus 2, then the status with the B bit set. The KERNAL's IRQ
entry at `$FF48` pushes A, X and Y, tests bit 4 of the stacked status
and jumps through `$0316` for a BRK (ROM bytes `48 8A 48 98 48 BA BD 04
01 29 10 F0 03 6C 16 03`). The handler reads the registers from the
stack, writes the original opcode back at stacked PC minus 2, and, to
resume at the breakpoint, stores that address over the stacked PC. It
leaves through `$EA81`, `PLA TAY PLA TAX PLA RTI`. Resumed there, the
`LDX #$22` runs and the routine stores X = `$22`. Resumed at the stacked
PC, the CPU continues at the `LDY` two bytes on, the `LDX` never runs and
X is still `$99`. The stacked status reads `$35`: B (bit 4) and bit 5
set, I set from the listing's `SEI`, and C set.
