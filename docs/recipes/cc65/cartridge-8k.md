---
recipe: cartridge-8k
toolchain: cc65
output_format: CRT
region: both
techniques: []
file_formats: [CRT]
uses_registers: [DD04, DD05, DD06, DD07, DD0E, DD0F, D020]
uses_kernal: [IOINIT, RAMTAS, RESTOR, CINT]
---

<!-- doc-type: recipe -->

# cc65 8 KB cartridge: CBM80 start-up, DATA copied from ROM to RAM

## Synopsis

A C program built as a generic 8 KB cartridge at `$8000`. The linker
configuration drops the BASIC stub, puts the `CBM80` signature at `$8004`,
places `DATA` in ROM with a run address in RAM, and writes the finished
`.CRT` container itself, so one `cl65` line produces a file that
`x64sc -cartcrt` boots. The start-up code lives in the C file as a
function of inline instructions. The program prints an initialised
global before and after changing it, the byte the ROM still holds, a
checksum of the `DATA` image in ROM and of its copy in RAM, and the
cycles from the end of the KERNAL's set-up to `main`; then it writes
`$02FF`. Read this with
[cc65-reference](../../toolchains/cc65-reference.md), "Cartridge
builds", and
[cartconv-reference](../../toolchains/cartconv-reference.md) for the
container fields.

## Source

```c
/* cartridge-8k.c - build with -C cartridge-8k.cfg; the link writes cartridge-8k.crt */
#include <conio.h>
#include <c64.h>
#include <peekpoke.h>

void coldstart(void);

/* ---- The .CRT container, 80 bytes, written by the linker ahead of the ROM
   image: a 64-byte header then a 16-byte CHIP packet, all big-endian. */
#pragma rodata-name (push, "CRTHDR")
const unsigned char crt_container[80] = {
    /* "C64 CARTRIDGE   " as ASCII bytes: character literals would be
       translated to PETSCII by cc65 -t c64 and VICE would not find them */
    0x43, 0x36, 0x34, 0x20, 0x43, 0x41, 0x52, 0x54,
    0x52, 0x49, 0x44, 0x47, 0x45, 0x20, 0x20, 0x20,
    0x00, 0x00, 0x00, 0x40,     /* header length $40 */
    0x01, 0x00,                 /* version 1.00 */
    0x00, 0x00,                 /* hardware type 0: generic */
    0x00,                       /* EXROM low */
    0x01,                       /* GAME high: 8 KB at $8000 */
    0x00,                       /* subtype */
    0x00, 0x00, 0x00, 0x00, 0x00,
    0x43, 0x43, 0x36, 0x35, 0x20, 0x38, 0x4B, 0, 0, 0, 0, 0, 0, 0, 0, 0,   /* name "CC65 8K", 32 bytes */
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x43, 0x48, 0x49, 0x50,     /* "CHIP" */
    0x00, 0x00, 0x20, 0x10,     /* packet length $2010 */
    0x00, 0x00,                 /* chip type 0: ROM */
    0x00, 0x00,                 /* bank 0 */
    0x80, 0x00,                 /* load $8000 */
    0x20, 0x00                  /* size $2000 */
};
#pragma rodata-name (pop)

/* ---- $8000: cold-start vector, warm-start vector, CBM80 at $8004. */
#pragma rodata-name (push, "CBM80")
const struct {
    void (*cold)(void);
    void (*warm)(void);
    unsigned char sig[5];
} cbm80 = { coldstart, coldstart, { 0xC3, 0xC2, 0xCD, 0x38, 0x30 } };
#pragma rodata-name (pop)

/* ---- The start-up code. The KERNAL jumps here before it has set anything
   up, so this function runs with no stack and no zero page of its own:
   nothing but inline instructions until sp is set. */
#pragma code-name (push, "STARTUP")
void coldstart(void)
{
    asm("sei");
    asm("ldx #$ff");
    asm("txs");
    asm("cld");
    asm("jsr $fda3");                    /* IOINIT: CIAs, SID off, port $01 */
    asm("jsr $fd50");                    /* RAMTAS: clear $0002-$03FF, size RAM */
    asm("jsr $fd15");                    /* RESTOR: KERNAL vectors at $0314 */
    asm("jsr $ff5b");                    /* CINT: VIC, screen editor, clear */
    asm("cli");
    /* CIA 2 timer B counts timer A underflows from here until main reads it */
    asm("lda #$ff");
    asm("sta $dd04");
    asm("sta $dd05");
    asm("sta $dd06");
    asm("sta $dd07");
    asm("lda #$51");                     /* B: force load, count A underflows, start */
    asm("sta $dd0f");
    asm("lda #$11");                     /* A: force load, continuous, start */
    asm("sta $dd0e");
    asm("jsr zerobss");                  /* BSS in RAM to zero */
    asm("jsr copydata");                 /* DATA: ROM image to its RAM address */
    asm("lda #<(__RAM_START__ + __RAM_SIZE__)");
    asm("ldx #>(__RAM_START__ + __RAM_SIZE__)");
    asm("sta sp");
    asm("stx sp+1");                     /* C stack grows down from $D000 */
    asm("jsr initlib");                  /* library constructors */
    asm("jsr callmain");                 /* main(); it does not return */
    asm("jmp %v", coldstart);            /* if it did, or on RESTORE: start again */
}
#pragma code-name (pop)

/* ---- The program. */
unsigned char value = 0x42;              /* DATA: initialised and writable */
unsigned      counter = 1000;            /* DATA */
unsigned char zeroed[16];                /* BSS: must read as zero */

/* Linker symbols carry no C underscore, so they are read through asm. */
static unsigned data_load(void) { asm("lda #<__DATA_LOAD__"); asm("ldx #>__DATA_LOAD__"); return __AX__; }
static unsigned data_run(void)  { asm("lda #<__DATA_RUN__");  asm("ldx #>__DATA_RUN__");  return __AX__; }
static unsigned data_size(void) { asm("lda #<__DATA_SIZE__"); asm("ldx #>__DATA_SIZE__"); return __AX__; }
static unsigned bss_run(void)   { asm("lda #<__BSS_RUN__");   asm("ldx #>__BSS_RUN__");   return __AX__; }
static unsigned bss_size(void)  { asm("lda #<__BSS_SIZE__");  asm("ldx #>__BSS_SIZE__");  return __AX__; }

static unsigned char sum8(unsigned base, unsigned n)
{
    unsigned char s = 0;
    unsigned i;
    for (i = 0; i < n; ++i) s += PEEK(base + i);
    return s;
}

int main(void)
{
    unsigned long cycles;
    unsigned ta, tb, i;
    unsigned char before, after, rom_copy, sum_rom, sum_ram, bss_ok, ok;

    /* stop both timers, then read them: B underflows of A, A remainder */
    CIA2.cra = 0x00;
    CIA2.crb = 0x00;
    ta = CIA2.ta_lo | ((unsigned)CIA2.ta_hi << 8);
    tb = CIA2.tb_lo | ((unsigned)CIA2.tb_hi << 8);
    cycles = (0xFFFFUL - tb) * 65536UL + (0xFFFFUL - ta);

    before  = value;                                 /* copied from ROM */
    sum_rom = sum8(data_load(), data_size());
    sum_ram = sum8(data_run(),  data_size());
    value   = 0x99;                                  /* writes RAM */
    ++counter;
    after    = value;
    rom_copy = PEEK(data_load() + ((unsigned)&value - data_run()));   /* ROM still $42 */

    bss_ok = 1;
    for (i = 0; i < sizeof zeroed; ++i) if (zeroed[i]) bss_ok = 0;

    clrscr();
    cprintf("cc65 8k cartridge\r\n\r\n");
    cprintf("cbm80 at $%04x cold $%04x\r\n", (unsigned)&cbm80, (unsigned)coldstart);
    cprintf("data load $%04x run $%04x size $%04x\r\n", data_load(), data_run(), data_size());
    cprintf("bss  run  $%04x size $%04x\r\n", bss_run(), bss_size());
    cprintf("value before %02x after %02x rom %02x\r\n", before, after, rom_copy);
    cprintf("counter %u\r\n", counter);
    cprintf("data sum rom %02x ram %02x\r\n", sum_rom, sum_ram);
    cprintf("bss zero %s\r\n", bss_ok ? "yes" : "no");
    cprintf("crt0 to main %lu cycles\r\n", cycles);

    ok = before == 0x42 && after == 0x99 && rom_copy == 0x42 &&
         sum_rom == sum_ram && counter == 1001 && bss_ok &&
         data_run() < 0x8000 && data_load() >= 0x8000;
    POKE(0x02FF, ok);
    VIC.bordercolor = ok ? COLOR_GREEN : COLOR_RED;
    for (;;) ;
    return 0;
}
```

The linker configuration, `cartridge-8k.cfg`. The two areas that reach
the file name it directly, so the container comes out of `ld65` and the
`.prg` named by `-o` is never written.

```cfg
# cartridge-8k.cfg - one 8 KB ROM at $8000, DATA copied to RAM at start.
# The linker writes the whole .CRT container: the 80-byte header and
# CHIP packet from the CRTHDR segment, then the filled 8 KB ROM image.
SYMBOLS {
    __STACKSIZE__: type = weak,   value = $0800;   # C stack, top at $D000
    __STARTUP__:   type = export, value = 1;       # our own start-up code; keeps the library crt0 out
}
MEMORY {
    ZP:     file = "",                start = $0002, size = $001A, define = yes;
    CRTHDR: file = "cartridge-8k.crt", start = $0000, size = $0050, fill = yes;
    ROML:   file = "cartridge-8k.crt", start = $8000, size = $2000, fill = yes, fillval = $FF, define = yes;
    RAM:    file = "",                start = $0800, size = $D000 - __STACKSIZE__ - $0800, define = yes;
}
SEGMENTS {
    ZEROPAGE: load = ZP,     type = zp;
    CRTHDR:   load = CRTHDR, type = ro;
    CBM80:    load = ROML,   type = ro;
    STARTUP:  load = ROML,   type = ro;
    LOWCODE:  load = ROML,   type = ro,  optional = yes;
    ONCE:     load = ROML,   type = ro,  optional = yes;
    CODE:     load = ROML,   type = ro;
    RODATA:   load = ROML,   type = ro;
    DATA:     load = ROML,   run = RAM, type = rw, define = yes;
    INIT:     load = RAM,    type = bss, optional = yes;
    BSS:      load = RAM,    type = bss, define = yes;
}
FEATURES {
    CONDES: type    = constructor,
            label   = __CONSTRUCTOR_TABLE__,
            count   = __CONSTRUCTOR_COUNT__,
            segment = ONCE;
    CONDES: type    = destructor,
            label   = __DESTRUCTOR_TABLE__,
            count   = __DESTRUCTOR_COUNT__,
            segment = RODATA;
    CONDES: type    = interruptor,
            label   = __INTERRUPTOR_TABLE__,
            count   = __INTERRUPTOR_COUNT__,
            segment = RODATA,
            import  = __CALLIRQ__;
}
```

## Build

```bash
cl65 -t c64 -O -C cartridge-8k.cfg --mapfile cartridge-8k.map -Ln cartridge-8k.lbl -o cartridge-8k.prg cartridge-8k.c
# writes cartridge-8k.crt (8,272 bytes: 80 + 8,192) beside the source; no .prg
cartconv -c cartridge-8k.crt   # exit 0; -f prints "Hardware ID: 0 (Generic C64 Cartridge)" and one CHIP at $8000
```

`--mapfile` writes the segment list (cc65 2.19, `cl65` reports V2.18):

```text
Name                   Start     End    Size  Align
----------------------------------------------------
CRTHDR                000000  00004F  000050  00001
ZEROPAGE              000002  00001B  00001A  00001
DATA                  000800  000836  000037  00001
BSS                   000837  000872  00003C  00001
CBM80                 008000  008008  000009  00001
STARTUP               008009  008049  000041  00001
ONCE                  00804A  008055  00000C  00001
CODE                  008056  008AE7  000A92  00001
RODATA                008AE8  008C85  00019E  00001
```

`DATA` is listed at its run address; its load address, `$8C86`, is what
the program prints and what `__DATA_LOAD__` resolves to. The ROM holds
`$8000`-`$8CBC`, 3,261 bytes of the 8,192, and `ld65` fills the rest with
`$FF`. `STARTUP` is 65 bytes and is this file's `coldstart` alone: the
library's own `crt0` was not linked, because the configuration exports
`__STARTUP__` itself. `ONCE` is the 12 bytes of constructor code the
conio library brings.

The same container from the conventional route, as a check: the last
8,192 bytes of `cartridge-8k.crt` passed to
`cartconv -t normal -i rom.bin -o cc.crt -n "CC65 8K"` produced a file
byte-identical to the linker's (`cmp` silent, run here).

## Expected output

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 4000000 -exitscreenshot cartridge-8k.png -cartcrt cartridge-8k.crt
```

Text decoded from the PNG against the character ROM with PIL, from row 0:

```text
CC65 8K CARTRIDGE

CBM80 AT $8000 COLD $8009
DATA LOAD $8C86 RUN $0800 SIZE $0037
BSS  RUN  $0837 SIZE $003C
VALUE BEFORE 42 AFTER 99 ROM 42
COUNTER 1001
DATA SUM ROM A1 RAM A1
BSS ZERO YES
CRT0 TO MAIN 2281 CYCLES
```

The border is green: `(98, 213, 50)` on `(44, 61, 236)` in the PAL PNG
(`screenshots/cartridge-8k.png`), `(114, 189, 103)` on `(25, 73, 180)`
in the NTSC one (`screenshots/cartridge-8k-ntsc.png`, the same command
with `-model ntsc` after `-default`). Every row above reads the same on
both models. `$02FF` is 1: a `trace store 02ff` over `-moncommands`
logged the write at `$82DF` with `A:01`. Measured in VICE x64sc 3.10;
each model was run twice from the built `.crt` and the PNGs were
byte-identical.

The lines say what the verdict checks. `VALUE BEFORE 42` is the compiled
initialiser, read from RAM at `$0800` after the copy; `AFTER 99` shows
the write took, so the variable is in RAM; `ROM 42` is the same byte read
back from the image at `$8C86`, untouched. The two checksums are the
55-byte `DATA` image in ROM and its copy in RAM, equal. `COUNTER 1001`
is the second initialised global, incremented once.

**Cold-start cost.** The CIA figure on screen, 2,281 cycles on both
models, runs from the timer start after `CINT` returns to the first read
in `main`: `zerobss` over 60 bytes, `copydata` over 55, the stack
pointer, `initlib`, `callmain`, and the entry of `main`. The whole path
from the cold-start vector was measured with the monitor, `trace exec
8009` and `trace exec 80bb` over `-moncommands`, reading the stopwatch
column of each register line:

| Point | PAL stopwatch | NTSC stopwatch |
|---|---|---|
| `SEI` at `$8009`, first cartridge instruction | 109 | 109 |
| `main` at `$80BB` | 1,650,153 | 1,643,242 |
| `STA $02FF` at `$82DF` | 1,839,555 | 1,834,243 |

Vector to `main`: 1,650,044 cycles PAL, 1,643,133 NTSC. The split
between the four KERNAL calls was measured the same way, with `trace
exec` on the four `JSR`s at `$8011`, `$8014`, `$8017` and the `CLI` at
`$801A`; each figure is the stopwatch difference between one traced
instruction and the next:

| Stage | PAL cycles | NTSC cycles |
|---|---|---|
| `SEI` to `JSR RAMTAS` (stack set, `IOINIT`) | 147 | 147 |
| `RAMTAS` | 1,593,289 | 1,593,289 |
| `RESTOR` | 889 | 889 |
| `CINT` | 53,221 | 46,310 |
| `CLI` to `main` (`zerobss`, `copydata`, `sp`, `initlib`, `callmain`) | 2,498 | 2,498 |

`RAMTAS` is 96.5 % of the path on PAL: it writes and reads every byte
from `$0400` up until the cartridge ROM at `$8000` refuses the test.
`CINT` is the only stage whose cost depends on the model; the other four
are identical on both. The CIA figure on screen, 2,281, sits inside the
2,498 of the last row; the rest is the timer start and the read. The
KERNAL takes the vector 109 cycles after power-on. A CIA timer cannot
span the whole path: `IOINIT` writes the control registers of both CIAs,
and a `trace store` on `$DC0E`, `$DC0F`, `$DD0E` and `$DD0F` logged the
four stores of `$08` at `$FDB0`, `$FDB3`, `$FDB6` and `$FDB9`, stopwatch
143, 147, 151 and 155 on both models (run here). A timer started at
`$8009` is therefore stopped 34 cycles later on CIA 1 and 38 on CIA 2;
that is why the on-screen timer starts after `CINT` and the monitor gives
the rest.

**The control, `DATA` without `run = RAM`.** The same source linked with
`DATA: load = ROML, type = rw` (run address equal to load address, in
ROM) booted, entered `main` at the same stopwatch, and then printed
nothing: the screen stayed clear and the border light blue, `$02FF` was
never written, and a `trace exec ff48` showed the interrupt entry with
the B flag set 1,049 cycles into the first `cprintf`, then the KERNAL's
BRK path at `$FE66`, fifty-five times in the run. The runtime's own
writable state sat in ROM; the write that should have changed it was
lost and a later read returned the image's bytes. Which of the
library's variables broke first was not measured here. The globals did
not read as zero, and the `DATA` segment size was the same 55 bytes.

## Why this works

The KERNAL's reset code at `$FCE2` checks for a cartridge before it
initialises anything: it compares the five bytes at `$8004` against
`$C3 $C2 $CD $38 $30` (`CBM80` with the letters' high bits set) and, on a
match, jumps through the vector at `$8000`. The four calls at the top of
`coldstart` are the ones the KERNAL would have made itself on the other
path, in the same order, and `CINT` is what makes conio's screen state
valid; without `RAMTAS` the screen base at `$0288` is unset. The
`RESTORE` key's NMI runs the same signature check and takes the vector at
`$8002`, so both vectors point at `coldstart`. The
[kernal-routines-reference](../../hardware/kernal-routines-reference.md)
has the four routines.

cc65 has no file-scope `asm` (cc65 2.19 stops with `__asm__ is not
allowed here`) and its inline `asm` refuses `.segment`, `.byte` and
`.res` (run here), so the start-up code is a C function of inline
instructions in a segment of its own and the two headers are `const`
objects placed with `rodata-name`. `coldstart` takes no arguments and has
no locals, so the compiler emits no prologue and the first byte at
`$8009` is `SEI`. The runtime routines `zerobss`, `copydata`, `initlib`
and `callmain` are the library's; the compiler switches `.autoimport` on
in every file it emits, so naming them, and the linker's `__DATA_LOAD__`
family, inside `asm` needs no declaration. `copydata` reads
`__DATA_LOAD__`, `__DATA_RUN__` and `__DATA_SIZE__`, which exist because
`DATA` carries `define = yes` and a `run` address different from its
`load`. `__STARTUP__` is exported from the configuration's `SYMBOLS`
block, which satisfies the `.forceimport __STARTUP__` the compiler
emits for `main` without pulling the library `crt0` and its `EXEHDR`
expectations.

Writes to `$8000`-`$9FFF` while the cartridge is mapped reach the RAM
underneath and reads come back from the ROM, the trap
[ram_under_rom_traps](../../pitfalls/banking.md#ram_under_rom_traps--writes-go-to-ram-under-rom-reads-return-rom-bytes)
describes for the KERNAL and BASIC ROMs; that is the mechanism behind
the control above. The container header is written as numeric bytes
because `cc65 -t c64` translates character literals to PETSCII, and
`'C'` becomes `$C3`: the first build here carried `C3 36 34` where VICE
expected `C64`, x64sc refused it with `no CRT header found`, and
`cartconv -f` printed nothing and exited 0. The field layout is the one
[cartconv-reference](../../toolchains/cartconv-reference.md) decoded;
the cross-check against cartconv's own output is in Build.
