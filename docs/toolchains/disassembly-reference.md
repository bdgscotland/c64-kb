---
tool: disassembly
tool_kind: reference-catalog
maintainer: bdgscotland
license: BSD-3-Clause
home_url: https://github.com/bdgscotland/c64-kb
---

<!-- doc-type: toolchain-reference -->

# Taking a C64 program apart: da65, the VICE monitor, the ROM tables

## Tool

This page is a procedure catalogue, not a program: finding a
PRG's entry point, disassembling with `da65` (cc65 V2.18) driven by an info
file, walking the KERNAL's interrupt paths, the ROM tables every
disassembly meets, the byte census, the VICE x64sc 3.10 monitor run in
batch, this repo's trace tools (`re-load-map`, `re-irq-chain`,
`re-frame-profile`), a packed game's depack stages, and finding a `.sid`
file's init and play routines.

Every command block below was run on the reference machine, and its output
is quoted from that run ("…" marks a cut). The inputs are the VICE ROM
images, this repo's own recipe PRGs
[kickassembler/irq-chain](../recipes/kickassembler/irq-chain.md) and
[kickassembler/cracktro-template](../recipes/kickassembler/cracktro-template.md),
and a `.sid` file whose listing is on this page. Two sections quote tool
output on one commercial image, the maintainer's copy of Commando
(session `game-design/studies/sessions/commando.json`): "Packers and
loader stubs" and "Dispatch through `JMP (ind)`". They quote addresses,
clocks and ranges, never its code: per
[reference-game-sources](../game-design/reference-game-sources.md), a
commercial disassembly supplies facts, never listings. An earlier version
of this paragraph said nothing here came from a commercial program.

The images used:

```text
$ shasum kernal-901227-03.bin kickassembler-irq-chain.prg
1d503e56df85a62fee696e7618dc5b4e781df1bb  kernal-901227-03.bin
026535741c224e80c2dd1d85ad54866a6c2382f6  kickassembler-irq-chain.prg
87f2e8d0e80206ca7322b3425b09201b6e827ae0  kickassembler-cracktro-template.prg
```

The PRG hash is the one KickAssembler 5.25 produced here. It will change
if the recipe changes. Build it with
`node scripts/verify-recipes.ts --file docs/recipes/kickassembler/irq-chain.md --keep <dir>`.

**Targets:** 6510

## Quick reference

| Task | Command |
|---|---|
| Entry from the BASIC stub | `xxd -l 18 prog.prg`, or `readPrg` in `src/re/prg.ts` |
| Disassemble with hints | `da65 --info prog.info prog.prg > prog.s` |
| Disassemble a ROM | `da65 --info kernal.info kernal-901227-03.bin` with `STARTADDR $E000` |
| Find every reference to an address | the byte census (Python, below) |
| Watch a running program | x64sc `-moncommands file.mon -monlog -monlogname out.log` |
| Depack stages and entry of a packed PRG | `node src/cli.ts re-load-map prog.prg` (or `session:<file>`) |
| Force a value the program reads | `trace exec <next pc>` + `command N "r a = xx"` (below) |
| Raster IRQ chain of a PRG | `node src/cli.ts re-irq-chain prog.prg` |
| Cycles between two stores | `node src/cli.ts re-frame-profile prog.prg --start 'store:$D020=$02' --stop 'store:$D020=$05'` |
| Init and play of a `.sid` | header bytes $0A-$0D, big-endian; confirm with `vsid` and `trace exec` (below) |

## Finding the entry from the BASIC stub

A PRG's first two bytes are its load address, little-endian. A program
loaded at $0801 usually starts with a one-line BASIC program,
`10 SYS nnnn`. Its layout: next-line link (2 bytes), line number (2 bytes),
the SYS token $9E, the address in ASCII digits, $00, then a $0000 link that
ends the program.

```text
$ xxd -l 18 kickassembler-irq-chain.prg
00000000: 0108 0b08 0a00 9e32 3036 3400 0000 0000  .......2064.....
00000010: 0078                                     .x
```

Load $0801, link $080B, line 10, $9E, "2064", $00, end link $0000. Entry is
decimal 2064 = $0810, where the byte is $78 (`SEI`). Rung 1.

`readPrg` in `src/re/prg.ts` applies the same rule: only for load address
$0801, it looks for $9E at or after offset 4 of the line and reads 3 to 5
digits, allowing a `(` and spaces. `end` is the address of the last byte;
`bytes` is the file as passed in. Printed with `load` and `end` in hex:

```text
{
  load: '801',
  end: '94d',
  bytes: <Buffer 01 08 0b 08 0a 00 9e 32 30 36 34 00 00 00 00 00 00 78 a9 7f 8d 0d dc ad 0d dc a2 00 a9 20 9d 00 04 9d 00 05 9d 00 06 9d 00 07 a9 01 9d 00 d8 9d 00 d9 ... 285 more bytes>,
  sys: 2064
}
```

An earlier version of this block left out the `bytes` field.

A SYS target that is not near the stub's end, or a stub whose line text is
not `SYS`, is the first sign of a packer or a custom loader (next sections).

## da65 with an info file

`da65` guesses code everywhere unless an info file says otherwise. The info
file has three blocks this page uses:

- `GLOBAL { STARTADDR $xxxx; INPUTOFFS n; };` — the address of the first
  byte, and how many file bytes to skip. A PRG needs `INPUTOFFS 2` for its
  load address; a ROM image needs none.
- `LABEL { NAME "x"; ADDR $xxxx; SIZE n; };` — a name. With `SIZE`, a
  reference into the middle of the block prints as `x+1`.
- `RANGE { START $a; END $b; TYPE t; };` — `END` is inclusive. Types used
  here: `Code`, `ByteTable`, `AddrTable`, `TextTable`.

### The KERNAL from its hardware vectors

```text
$ cat kernal.info
GLOBAL { STARTADDR $E000; };
LABEL { NAME "irq_dispatch"; ADDR $FF48; };
RANGE { START $FFFA; END $FFFF; TYPE AddrTable; };

$ da65 --info kernal.info kernal-901227-03.bin | grep -n -A12 "irq_dispatch:" | head -20
4344:irq_dispatch:
4345-        pha
4346-        txa
4347-        pha
4348-        tya
4349-        pha
4350-        tsx
4351-        lda     $0104,x
4352-        and     #$10
4353-        beq     LFF58
4354-        jmp     (L0316)
4355-
4356-LFF58:  jmp     (L0314)

$ da65 --info kernal.info kernal-901227-03.bin | tail -5
        .byte   $42
        .byte   $59
LFFFA:  .addr   LFE43
        .addr   LFCE2
        .addr   irq_dispatch
```

The `AddrTable` range turns the last six bytes into three `.addr` lines:
NMI $FE43, RESET $FCE2, IRQ/BRK $FF48. The `.byte $42, $59` above them are
the tail of the text "RRBY" at $FFF6-$FFF9 (read from the image). Any
address the code uses outside the image becomes a symbol at the top of the
file, `L0314 := $0314`.

### A PRG, without and with hints

With only `STARTADDR $0801; INPUTOFFS 2;`, da65 decodes the BASIC stub as
code and the raster-line table as instructions:

```text
        .byte   $0B
        php
        asl     a
        brk
        .byte   $9E
        .byte   $32
        bmi     L083F
…
L08C4:  plp
        .byte   $82
        .byte   $04
L08C7:  brk
        brk
        .byte   $80
L08CA:  bne     L08A7
```

The info file below is built only from what a reverser can get without the
source: the stub (previous section), the $0314 handler from `re-irq-chain`
(below), and the operands of that handler's `lda $08CA,x` / `lda $08CD,x`.

```text
$ cat irq-chain.info
GLOBAL { STARTADDR $0801; INPUTOFFS 2; };
RANGE  { START $0801; END $080F; TYPE ByteTable; };   # BASIC stub: 10 SYS2064
LABEL  { NAME "entry";      ADDR $0810; };             # SYS target, from the stub
LABEL  { NAME "dispatch";   ADDR $0876; };             # handler at $0314, from re-irq-chain
RANGE  { START $08C4; END $08C9; TYPE ByteTable; };   # raster lines, lo then hi bits
RANGE  { START $08CA; END $08CF; TYPE ByteTable; };   # handler table, lo then hi
LABEL  { NAME "handler_lo"; ADDR $08CA; SIZE 3; };
LABEL  { NAME "handler_hi"; ADDR $08CD; SIZE 3; };
LABEL  { NAME "slot0";      ADDR $08D0; };
LABEL  { NAME "slot1";      ADDR $08DB; };
LABEL  { NAME "slot2";      ADDR $08E6; };
RANGE  { START $092A; END $0933; TYPE ByteTable; };   # two five-byte tables
RANGE  { START $0934; END $0946; TYPE TextTable; };   # 19 screen-code bytes
RANGE  { START $0947; END $094D; TYPE ByteTable; };   # variables
LABEL  { NAME "call"; ADDR $08A8; SIZE 3; };             # jsr $FFFF, operand rewritten
RANGE  { START $08A8; END $08AA; TYPE Code; };

$ da65 --info irq-chain.info kickassembler-irq-chain.prg
…
        .byte   $0B,$08,$0A,$00,$9E,$32,$30,$36
        .byte   $34,$00,$00,$00,$00,$00,$00
entry:  sei
…
        lda     handler_lo,x
        sta     call+1
        lda     handler_hi,x
        sta     call+2
call:   jsr     LFFFF
        ldx     L0948
…
handler_lo:
        .byte   $D0,$DB,$E6
handler_hi:
        .byte   $08,$08,$08
slot0:  lda     #$02
        sta     $D020
```

The three slot handlers are reached only through the rewritten `jsr`.
Neither da65 nor any static reading follows that; the table bytes
($D0/$08, $DB/$08, $E6/$08) give them. The split above matches the
assembler's own symbol file (`-vicesymbols`) at every labelled address.

### da65 quirks measured here

- **A label inside an instruction breaks it into bytes.** The code stores
  to $08A9 and $08AA, the operand of `jsr $FFFF`. Without a `Code` range,
  da65 prints `.byte $20` / `L08A9: .byte $FF` / `L08AA: .byte $FF`. With
  `RANGE … TYPE Code` over the instruction, it prints
  `L08A9 := * + 1`, `L08AA := * + 2` and `jsr LFFFF`; add a sized
  `LABEL` and the stores read `sta call+1`. `SIZE` alone, without the
  `Code` range, still gave `.byte`.
- **A referenced address splits a table.** With the $ECB9 table declared
  `ByteTable` through $ECE7, da65 still started a new line at `LECE6:`,
  because code elsewhere refers to $ECE6.
- **Text after a table decodes as code.** The bytes after that table are
  "LOAD\rRUN\r"; da65 printed `eor ($44,x)` and `ora $5552` for them.
  Every unclaimed byte is a guess; `TextTable` or `ByteTable` claims it.

## Walking the KERNAL interrupt paths

This is the method the audits used, with the info file extended by one
`LABEL` per stop and `AddrTable`/`ByteTable` ranges for the $FD30 and $ECB9
tables. All addresses are from the 901227-03 image, rung 1.

| Event | Vector | First code | Through | Default target |
|---|---|---|---|---|
| IRQ | $FFFE → $FF48 | PHA/TXA/PHA/TYA/PHA, test B at $0104,X | `JMP ($0314)` at $FF58 | $EA31 |
| BRK | $FFFE → $FF48 | same, B set | `JMP ($0316)` at $FF55 | $FE66 |
| NMI | $FFFA → $FE43 | `SEI` | `JMP ($0318)` at $FE44 | $FE47 |
| RESET | $FFFC → $FCE2 | `LDX #$FF` | — | — |

$EA31 ends by falling into `LDA $DC0D` at $EA7E and the bare exit at $EA81
(`PLA/TAY/PLA/TAX/PLA/RTI`). $FE47 saves registers, writes $7F to $DD0D,
reads $DD0D and branches on bit 7 (a CIA2 source) to $FE72; otherwise it
checks for a cartridge ($FD02) and on a match jumps through ($8002).

The defaults come from the $FD30 table. `RESTOR` at $FD15 loads X/Y with
$FD30 and falls into `VECTOR` at $FD1A, which copies 32 bytes
(`LDY #$1F`) into $0314-$0333.

## The ROM tables

Each address below was checked by reading the bytes of
`kernal-901227-03.bin` (rung 1). Issue #3 named four; one was wrong.

| Address | What the bytes show |
|---|---|
| $FD30-$FD4F | 16 vectors, copied to $0314-$0333: `EA31 FE66 FE47 F34A F291 F20E F250 F333 F157 F1CA F6ED F13E F32F FE66 F4A5 F5ED` (IRQ, BRK, NMI, OPEN … ISAVE) |
| $FF81-$FFF5 | 39 three-byte entries. 29 are `JMP abs`; 10 are `JMP (ind)` through the RAM vectors: $FFC0-$FFD2 via $031A-$0326, $FFE1-$FFE7 via $0328-$032C. First `FF81: 4C 5B FF`, last `FFF3: 4C 00 E5` |
| $ECB9-$ECE6 | VIC-II power-on values, 46 bytes. `LDX #$2F / LDA $ECB8,X / STA $CFFF,X / DEX / BNE` at $E5A8 copies 47 bytes to $D000-$D02E: the 47th, $4C at $ECE7, is the "L" of "LOAD\rRUN\r"; it lands in $D02E, which read back $FC (grey) in VICE. An earlier version of this row gave the table as $ECB9-$ECE7, 47 bytes |
| $F0BD-$F12A | The KERNAL's ten messages, from "I/O ERROR #" to "OK". Each ends in a byte with bit 7 set. Eight begin with $0D; "FOR " and "PRESS RECORD & PLAY ON TAPE" do not |
| $E5B6 | Not a table. It is the high operand byte of `LDY $0277` at $E5B4, the keyboard-buffer fetch |

Issue #3 listed "$E5B6 DOS messages". The bytes at $E5B6 are code, and the
DOS messages are in the drive's ROM, not the KERNAL. In VICE's
`dos1541-325302-01+901229-05.bin` (loaded at drive $C000) the error table
starts at drive address $E4FC with `00 A0 4F CB`: error 00, "OK", bit 7 on
the first and last characters. Repeated words are stored as token bytes
($89, $8B in the first entries); this page does not decode them.

## The byte census

The census finds every place a ROM or program names an address, then
classifies each hit by the opcode before it. It is how
[c64-memory-map](../hardware/c64-memory-map.md) shows that no ROM
instruction has an absolute operand in $02A7-$02FF. That is not "no ROM
write": RAMTAS at $FD50 (`A9 00 A8 99 02 00 99 00 02 99 00 03 C8 D0 F4`)
clears the whole page at reset with `STA $0200,Y`, an indexed write whose
operand is $0200, outside the range searched.

1. Search the image for the address's two bytes, low first.
2. For each hit, read the byte before it. It is the opcode if the hit is
   an absolute operand.
3. Classify the opcode: read ($AD `LDA`, $B9 `LDA abs,Y`), write ($8D,
   $99), jump through ($6C).
4. Confirm each hit is in code: the census also matches data and the
   middle of other instructions. Cross-check against a da65 listing.

```text
$ python3 - <<'EOF'
k=open('/opt/homebrew/opt/vice/share/vice/C64/kernal-901227-03.bin','rb').read()
for i in range(1,len(k)-1):
    if k[i]==0x14 and k[i+1]==0x03: print(hex(0xe000+i-1), hex(k[i-1]))
EOF
0xf895 0xad
0xfcb3 0x8d
0xfcc0 0x8d
0xfd20 0xb9
0xfd29 0x99
0xff58 0x6c
```

Six hits, and the da65 listing has the same six references to `L0314`:
the IRQ dispatch ($FF58), `VECTOR`'s copy loop ($FD20 read, $FD29 write),
and three tape-I/O sites. $F895 saves $0314/$0315 to $029F/$02A0; $FCB3
restores it from there; $FCC0 installs a handler from a table at $FD93.
So the only KERNAL code that replaces the IRQ vector at run time is tape
I/O (rung 1, this image).

What a census cannot see: an indexed access that reaches the address from
a lower base (`STA $0300,X`), and any access through a zero-page pointer
(`VECTOR` also writes through `($C3),Y`). Search for those patterns
separately, or trace the address in VICE (next section).

## The VICE monitor in batch

The windowless x64sc (`npm run vice:headless`) runs a monitor command file
at start-up and writes the monitor's output to a log. The command below is
the one this page used, with the recipe PRG copied into the working
directory as `p.prg`:

```bash
GSETTINGS_SCHEMA_DIR=/opt/homebrew/share/glib-2.0/schemas \
  .tools/vice-headless/bin/x64sc -default +autostart-delay-random -warp +sound \
  -autostartprgmode 1 -moncommands walk.mon -monlog -monlogname walk.log \
  -limitcycles 5000000 -autostart p.prg < /dev/null
```

The command file. A checkpoint's `command` string holds several monitor
commands separated by ` ; `, run each time the checkpoint fires. Each one
ends with `del` so it fires once.

```text
trace store d020 d020
break exec 0876
command 2 "d 0876 0885 ; m 08c4 08cf ; chis 8 ; prof on ; del 2"
break exec 08d0
ignore 3 49
command 3 "prof flat 6 ; save \"dump.prg\" 0 0801 094d ; memmapshow 07 0876 087f ; del 1 ; del 3"
```

The log, cut:

```text
#1 (Stop on  exec fce2)    0/$000,   6/$06
.C:fce2  A2 FF       LDX #$FF       - A:00 X:00 Y:00 SP:00 ..-..IZ.          6
TRACE: 1  C:$d020  (Trace store)
BREAK: 2  C:$0876  (Stop on exec)
…
BREAK: 3  C:$08d0  (Stop on exec)
Will ignore the next 73 hits of checkpoint #3
…
#2 (Stop on  exec 0876)   40/$028,  40/$28
.C:0876  A9 01       LDA #$01       - A:00 X:F0 Y:00 SP:f0 ..-..IZ.    2990272
Executing: d 0876 0885 ; m 08c4 08cf ; chis 8 ; prof on ; del 2
.C:0876  A9 01       LDA #$01
.C:0878  8D 19 D0    STA $D019
.C:087b  AE 47 09    LDX $0947
…
>C:08c4  28 82 04 00   (�
>C:08c8  00 80 d0 db   ���
>C:08cc  e6 08 08 08   �
.C:ff4a  48          PHA            A:ff X:ff Y:00 SP:f2 N.-..I..      2990248
…
.C:ff53  F0 03       BEQ $FF58      A:00 X:f0 Y:00 SP:f0 ..-..IZ.      2990264
.C:ff58  6C 14 03    JMP ($0314)    A:00 X:f0 Y:00 SP:f0 ..-..IZ.      2990267
Profiling restarted.
#1 (Trace store d020)   41/$029,  52/$34
.C:08d2  8D 20 D0    STA $D020      - A:02 X:00 Y:00 SP:ee ..-..I..    2990347
#1 (Trace store d020)  132/$084,  30/$1e
.C:08dd  8D 20 D0    STA $D020      - A:05 X:01 Y:00 SP:ee ..-..I..    2996058
…
Executing: prof flat 6 ; save "dump.prg" 0 0801 094d ; memmapshow 07 0876 087f ; del 1 ; del 3
        Total      %          Self      %
------------- ------ ------------- ------
      2560116 188.7%       1280058  94.4% a7ed
        39563   2.9%         39563   2.9% 08f2
        76424   5.6%         32481   2.4% ff48
         1314   0.1%          1314   0.1% 08e6
…
Saving file 'dump.prg' from $0801 to $094d
addr: IO  ROM RAM
0876: --- --- rwx (uninitialized read)
0877: --- --- rw- (uninitialized read)
0878: --- --- rwx (uninitialized read)
…
```

What each command gave:

- `d` and `m` disassemble and dump; `m` shows the line table ($28, $82,
  $04 = lines 40, 130, 4 low bytes, then $00, $00, $80 for the ninth bit)
  and the handler table.
- `chis 8` lists the last 8 instructions before the break with registers
  and clocks: the KERNAL dispatcher up to `JMP ($0314)` at clock 2990267,
  five cycles before $0876 at 2990272.
- `trace store` prints raster line and cycle of each store: slot 0 wrote
  $D020 on line 41 cycle 52, slot 1 on line 132 cycle 30.
- `prof flat` ranks functions by the entry address they were called at.
  `a7ed` is in BASIC ROM; `SYS` was issued from there and the program's
  `JMP *` never returns, which is the reading here of why its Self is 94.4%
  (rung 4). The Total column exceeded 100% here; read Self.
- `save` wrote live memory, not the file: the dump differs from the PRG at
  $08A9-$08AA (`jsr $08D0`, the rewritten operand), $0948 (next slot,
  1), $0949 (frame count, $49 = 73) and $094D.
- `memmapshow` lists, per address, whether it was read, written or
  executed (`rwx`) since the run began. "(uninitialized read)" means the
  CPU read that RAM byte before any CPU write to it (`mon_memmap.c` in
  the VICE 3.10 source). The program's own bytes carry it because
  `-autostartprgmode 1` injects the PRG into RAM, not through CPU stores.

### Batch quirks measured here

- **Numbers are hex.** `ignore 3 49` ignored 73 ($49) hits. Write `ignore 3 31`
  for 49, and `ignore 1 3e8` for 1000 (the Commando session skips 1000
  title polls that way).
- **An error ends the whole command string.** `d .irq .irq+15 ; … ; del 1`
  failed at `+15` (label arithmetic is refused), so `del 1` never ran and
  the checkpoint fired on every IRQ for the rest of the run.
- **`memmapshow` as a start-up line prints only its header**
  (`addr: IO  ROM RAM`): nothing has run yet. Call it from a checkpoint
  `command`, as above.
- **`-monlogname` appends.** A second run to the same log name added to
  the end of the first run's log. Delete the log before each run (`rm -f`
  in the same command line), or use a fresh name; a parser reading an
  appended log counts the old run's hits as well.
- **The first log entry is always the reset**, `#1 (Stop on exec fce2)`
  at clock 6, before any checkpoint in the command file.
- **Labels work.** `ll "labels.vs"` loads a VICE label file (KickAssembler
  writes one with `-vicesymbols`). After it, `break exec .irq` set the
  checkpoint at $0876, and `d` printed `LDX .slot` instead of `LDX $0947`.
- The rest are handled by `src/services/vice-batch.ts` and listed in its
  header: the windowless build ignores `logname` inside the file, echoes
  every hit to stdout (discard it), exits with status 1 on
  `-limitcycles`, and needs `+autostart-delay-random` for runs that land
  on the same raster line each time.

### Forcing a read, `bank cpu`, `disable`, and one `save` per command

Three runs on the recipe PRGs, 2026-09-26, same x64sc command as above
with `-limitcycles 4000000` (5,000,000 for the cracktro), each log
deleted first.

**Finding a read and forcing its value.** A program that waits for fire
reads `$DC00` or `$DC01` somewhere; a `trace load` finds the PC. On the
cracktro recipe:

```text
trace load dc00 dc00
```

```text
#1 (Trace  load dc00)  250/$0fa,  60/$3c
.C:0a0b  AD 00 DC    LDA $DC00      - A:7F X:F0 Y:00 SP:f0 ..-..I..    3003522
```

The load is at $0A0B; A is $7F, nothing pressed. Put the checkpoint on
the instruction after the load ($0A0E, `AND #$10`), not on the load: a
value set at the load's own PC is overwritten when the load runs. The
command `r a = 6f` sets A as if port 2 fire were held:

```text
trace exec 0a0e 0a0e
ignore 1 32
command 1 "r a = 6f"
trace exec 0d1d 0d1d
```

```text
#1 (Trace  exec 0a0e)  250/$0fa,  61/$3d
.C:0a0e  29 10       AND #$10       - A:7F X:F0 Y:00 SP:f0 ..-..I..    3986323
Executing: r a = 6f
#2 (Trace  exec 0d1d)  251/$0fb,   5/$05
.C:0d1d  A9 00       LDA #$00       - A:00 X:F0 Y:00 SP:f0 ..-..IZ.    3986330
```

After 50 ($32) ignored hits the injection fired, and the recipe's `exit`
($0D1D) ran 7 cycles later: `AND` 2, `BNE` not taken 2, `JMP` 3. A trace
line shows the registers as the checkpoint hit, before its command ran.
Port 2 values, active low: none $7F, up $7E, down $7D, left $7B, right
$77, fire $6F. The session file's `inject` list writes these checkpoints
for `re-session` and the tools that take `session:<file>`.

**`bank cpu`, `disable` inside a command, and a forced store.** On the
irq-chain recipe, slot 0 loads its colour at $08D0 (`LDA #2`) and stores
it at $08D2:

```text
trace exec 08d2 08d2
command 1 "r a = 07"
trace store d020 d020
break exec 08d0
ignore 3 a
command 3 "bank cpu ; m 0 1 ; bank ram ; m 0 1 ; disable 2 ; del 3"
```

```text
#2 (Trace store d020)   41/$029,  52/$34
.C:08d2  8D 20 D0    STA $D020      - A:07 X:00 Y:00 SP:ee ..-..I..    2990347
…
Executing: bank cpu ; m 0 1 ; bank ram ; m 0 1 ; disable 2 ; del 3
>C:0000  2f 37         /7
>C:0000  00 00
```

- The store wrote 7 (yellow), not 2: the exit screenshot's border is
  RGB (255, 255, 70) at rows 30 and 60 (lines 46 and 76), measured with
  PIL, where the unforced recipe's is red, (175, 60, 88).
- `bank cpu` reads the 6510 port: $00 = $2F, $01 = $37. `bank ram` reads
  the RAM under it at the same addresses, $00 $00. Read `$00`/`$01` with
  `bank cpu`.
- `disable 2` from checkpoint 3's command stopped the store trace. The
  log holds 10 frames of slot stores (10 each at $08D2, $08DD, $08E8,
  plus two before the program ran); checkpoint 3 fired on the 11th entry
  to $08D0, before that frame's store, and checkpoint 1 kept firing to
  the end of the run (52 hits). `enable N` and `ignore N count` work
  the same way inside a command; a checkpoint created then disabled at
  start-up and enabled from another's command acts only after that
  moment (the Commando teardown enabled its input checkpoints from the
  play-start PC this way).

**One `save` per `command` string.** Two saves in one string:

```text
break exec 08d0
command 1 "save \"a.bin\" 0 0810 081f ; save \"b.bin\" 0 0820 082f ; del 1"
```

```text
Executing: save "a.bin" 0 0810 081f ; save "b.bin" 0 0820 082f ; del 1
Saving file 'a.bin" 0 0810 081f ; save "b.bin' from $0820 to $082f
```

The filename runs from the first quote to the last, so one file named
`a.bin" 0 0810 081f ; save "b.bin` was written with the second range, and
`del 1` never ran. Give each `save` its own checkpoint:

```text
break exec 08d0
command 1 "save \"a.bin\" 0 0810 081f ; del 1"
break exec 08db
command 2 "save \"b.bin\" 0 0820 082f ; del 2"
```

```text
Saving file 'a.bin' from $0810 to $081f
…
Saving file 'b.bin' from $0820 to $082f
```

## The trace tools: `re-irq-chain` and `re-frame-profile`

Both run the batch monitor and return JSON with a rung on each
observation. The PRG must be inside the repo or the OS temp directory
(`os.tmpdir()`, `/var/folders/…/T` on macOS); a path elsewhere is refused
with `"reason": "path"`.

```text
$ node src/cli.ts re-irq-chain $TMP/irq-chain.prg
{
  "ok": true,
  "run": { "prg": "…/irq-chain.prg", "model": "pal", "cycles": 8000000, "start_clock": 2970445, … },
  "result": {
    "vectors": [ …
      { "id": "v1", "basis": "measured-vice", "rung": 1, "vector": "irq_0314",
        "value": 2166, "pc": 2151, "clock": 2984383, "line": 259 } ],
    "arms": [ … ],
    "entries": [
      { "id": "e0", "basis": "measured-vice", "rung": 1, "handler": 2166,
        "line": 40, "cycle": 40, "clock": 2990272, "frame": 1 }, … ],
    "handlers": [ { "handler": 2166, "via": ["irq_0314"], "entries": 765,
        "entry_lines": [40, 130, 260], "armed_before": [40, 130, 260] } ],
    "unknowns": []
  }
}
```

One handler, $0876 (2166), entered on lines 40, 130 and 260. Entry `e0`
has the same clock, 2990272, as the monitor's break at $0876 above.

```text
$ node src/cli.ts re-frame-profile $TMP/irq-chain.prg --start 'store:$D020=$02' --stop 'store:$D020=$05' --cycles 4000000
{
  "run": { …, "cycles": 4000000, "start_clock": 2970445, … },
  "samples": 52,
  "worst": 5714,
  "typical": 5711,
  "count": 52,
  "unpaired": 0,
  "over_frame": 0
}
```

From slot 0's border store to slot 1's: typically 5711 cycles. The monitor
trace agrees: 2996058 − 2990347 = 5711, and so does the raster position,
91 lines × 63 + (30 − 52) = 5711 (rung 3 from the rung-1 trace).

### Dispatch through `JMP (ind)`

A game can install one handler at `$0314` that is only `JMP ($xxxx)`,
and have each raster part write the next part's address into that
pointer and re-arm `$D012`. A break on the `$0314` handler then shows one
address for every part. `re-irq-chain` follows the pointer: when the
handler's first instruction is `JMP (ind)` it adds `pointer` and one
`dispatch` entry per target. On the Commando session (60,000,000 cycles
from play start, no input), cut:

```text
$ node src/cli.ts re-irq-chain session:docs/game-design/studies/sessions/commando.json
…
    "handlers": [ { "handler": 16692, "via": ["irq_0314"], "entries": 6318,
        "pointer": 1030,
        "dispatch": [
          { "target": 16695, "entries": 1264, "entry_lines": [213, 224], "armed_before": [213, 223] },
          { "target": 16776, "entries": 1265, "entry_lines": [222], "armed_before": [222] },
          { "target": 16837, "entries": 1264, "entry_lines": [30, 286, 287], "armed_before": [30, 286] },
          { "target": 17028, "entries": 1264, "entry_lines": [50, 60], "armed_before": [50, 60] },
          { "target": 17289, "entries": 1261, "entry_lines": [177, 178, …], … } ] } ],
    "unknowns": []
```

Handler $4134 (16692) jumps through $0406 (1030) to five parts: $4137,
$4188, $41C5, $4284 and $4389. The line lists hold every line an entry
was seen on; the study page (`game-design/studies/commando.md`) says
which are the steady chain. The 6510 has no `JMP (abs,X)`, so a table
dispatch is either this rewritten pointer or a self-modified `JSR`, as
the irq-chain recipe does at `call`.

## A `.sid` file: init and play

A PSID file names its two entry points in the header: init at $0A-$0B
and play at $0C-$0D, both big-endian. The header layout is in
[c64-file-formats](../formats/c64-file-formats.md), section ".SID". Read
the header, disassemble the body from the load address, then run the file
and watch both addresses execute. Everything below was run on the reference
machine.

### The file and its provenance

The `.sid` is this repo's own: the listing below assembles the whole file,
header and player, with KickAssembler 5.25. It is BSD-3-Clause, like the
repository; the header's "released" field says so. No HVSC file was used:
per [reference-game-sources](../game-design/reference-game-sources.md),
the collection is for research and its files may not be committed.

The player plays a C major scale on voice 1, one note every 12 play calls.
It uses the entry layout the tools must see through: a `JMP` to each
routine at $1000 and $1003. The frequency words are PAL,
f × 2^24 / 985248 (rung 3). An earlier version of this page had no `.sid`
example; issue #64 asked for one.

```kickassembler
// tune.asm: a one-voice PSID v2 file, header and player, written whole.
.encoding "ascii"
.file [name="tune.sid", type="bin", segments="Sid"]
.segment Sid [start=$0f82]             // $1000 - $7c header - 2 load bytes
        .text "PSID"
        .byte $00, $02                 // version 2 (big-endian)
        .byte $00, $7c                 // data offset
        .byte $00, $00                 // load address 0: first two data bytes
        .byte >entry_init, <entry_init // init (big-endian)
        .byte >entry_play, <entry_play // play (big-endian)
        .byte $00, $01                 // songs
        .byte $00, $01                 // start song
        .byte $00, $00, $00, $00       // speed: every song on the VBI
        .text "c64-kb scale"
        .fill 32 - "c64-kb scale".size(), 0
        .text "c64-kb"
        .fill 32 - "c64-kb".size(), 0
        .text "2026 c64-kb, BSD-3-Clause"
        .fill 32 - "2026 c64-kb, BSD-3-Clause".size(), 0
        .byte $00, $14                 // flags: PAL, 6581
        .byte $00, $00, $00, $00       // start page, page length, 2nd/3rd SID
        .word $1000                    // load address, little-endian
// $1000
entry_init: jmp init
entry_play: jmp play

init:   ldx #$18
        lda #0
clear:  sta $d400,x
        dex
        bpl clear
        sta step
        lda #1
        sta wait
        lda #$09
        sta $d405                      // voice 1 attack 0, decay 9
        lda #$00
        sta $d406                      // sustain 0, release 0
        lda #$0f
        sta $d418                      // volume 15
        rts

play:   dec wait
        bne done
        lda #12
        sta wait                       // a note every 12 calls
        ldx step
        lda freq_lo,x
        sta $d400
        lda freq_hi,x
        sta $d401
        lda #$10
        sta $d404                      // triangle, gate off
        lda #$11
        sta $d404                      // triangle, gate on
        inx
        cpx #8
        bne keep
        ldx #0
keep:   stx step
done:   rts

// C major scale from C-4, PAL frequency words (clock 985248 Hz)
freq_lo: .byte $67, $89, $ed, $3b, $13, $45, $da, $ce
freq_hi: .byte $11, $13, $15, $17, $1a, $1d, $20, $22
step:   .byte 0
wait:   .byte 0
```

`java -jar KickAss.jar tune.asm` writes `tune.sid`, 230 bytes:

```text
$ shasum tune.sid
6bcedeb314cd01ec6e67e42393a689a8dde7217f  tune.sid
```

`.text` needs `.encoding "ascii"` first. KickAssembler's default encoding
is screen codes: "PSID" happens to come out as ASCII ($50 $53 $49 $44),
but "c64-kb" comes out as $03 $36 $34 $2D $0B $02, so the name fields
would be wrong (both assembled here).

### Step 1: read the header

```text
$ xxd -l 22 tune.sid
00000000: 5053 4944 0002 007c 0000 1000 1003 0001  PSID...|........
00000010: 0001 0000 0000                           ......
$ xxd -s 0x76 -l 8 tune.sid
00000076: 0014 0000 0000 0010                      ........
```

Version 2; data at $7C; load address $0000, so the load address is the
first two data bytes, `00 10` = $1000, little-endian; init $1000; play
$1003; one song, start song 1; speed 0 (the VBI); flags $0014 (PAL, 6581).
An init of $0000 would mean "the load address". A play of $0000 means init
installs its own interrupt handler; then the play routine is the handler
init writes to $0314/$0315 or $FFFE/$FFFF, found with `trace store 0314
0315` as in "The VICE monitor in batch" above. That
case is not run here.

The same fields from a script:

```text
$ python3 sidhdr.py tune.sid
PSID v2 data at $7C, body at file offset $7E
load $1000-$1067 init $1000 play $1003
songs 1 start 1 speed $00000000 flags $0014
name c64-kb scale
```

```text
# sidhdr.py
import struct, sys
b = open(sys.argv[1], 'rb').read()
magic = b[0:4].decode()
ver, off, load, init, play, songs, start = struct.unpack('>HHHHHHH', b[4:18])
speed, = struct.unpack('>I', b[18:22])
if load == 0:                        # load address is the first two data bytes, little-endian
    load = b[off] | b[off + 1] << 8
    body = off + 2
else:
    body = off
end = load + len(b) - body - 1
print(f"{magic} v{ver} data at ${off:02X}, body at file offset ${body:02X}")
print(f"load ${load:04X}-${end:04X} init ${init or load:04X} play ${play:04X}")
print(f"songs {songs} start {start} speed ${speed:08X} flags ${struct.unpack('>H', b[0x76:0x78])[0]:04X}")
print("name", b[0x16:0x36].rstrip(b'\0').decode('latin-1'))
```

### Step 2: disassemble the body

`INPUTOFFS` skips the header and the two load-address bytes ($7C + 2 =
$7E). The two labels come from the header. The table range comes from the
operands of `lda $1056,x` and `lda $105E,x` in a first run without it,
which decoded the tables as `sbc $133B`, `eor $DA` and the like.

```text
$ cat tune.info
GLOBAL { STARTADDR $1000; INPUTOFFS $7E; };            # $7C header + 2 load-address bytes
LABEL  { NAME "sid_init"; ADDR $1000; };               # header $0A-$0B
LABEL  { NAME "sid_play"; ADDR $1003; };               # header $0C-$0D
RANGE  { START $1056; END $1067; TYPE ByteTable; };   # operands of lda $1056,x / lda $105E,x, and two variables

$ da65 --info tune.info tune.sid
…
sid_init:
        jmp     L1006

sid_play:
        jmp     L1028

L1006:  ldx     #$18
        lda     #$00
L100A:  sta     $D400,x
        dex
        bpl     L100A
…
        lda     #$0F
        sta     $D418
        rts

L1028:  dec     L1067
        bne     L1055
…
        lda     #$11
        sta     $D404
…
L1056:  .byte   $67,$89,$ED,$3B,$13,$45,$DA,$CE
L105E:  .byte   $11,$13,$15,$17,$1A,$1D,$20,$22
L1066:  .byte   $00
L1067:  .byte   $00
```

The header addresses are a jump table here, so the routines themselves
are the `JMP` targets, $1006 and $1028. Init clears the 25 SID registers
and sets the volume; play counts down and writes voice 1.

### Step 3: run it and watch both addresses

`vsid` is VICE's SID player. The windowless build
(`scripts/build-vice-headless.sh`) makes it beside x64sc, in the build
directory's `src/vsid`; like x64sc it needs `-directory` after `-default`,
pointing at a VICE data directory (here Homebrew's `share/vice`).

```text
$ vsid -default -directory /opt/homebrew/opt/vice/share/vice -console -warp +sound \
    -limitcycles 1000000 -moncommands sid.mon -monlog -monlogname sid.log tune.sid < /dev/null
…
Vsid: PSID free pages: $1100-$9fff
Vsid: Driver=$1100, Image=$1000-$1067, Init=$1000, Play=$1003
Vsid:    Title: c64-kb scale
Vsid:   Author: c64-kb
Vsid: Released: 2026 c64-kb, BSD-3-Clause
Vsid: Using PAL sync
Vsid: SID model: 6581
Vsid: Using VICII interrupt
Vsid: Playing tune 1 out of 1 (default=1)

$ cat sid.mon
break exec 1000
command 1 "r ; del 1"
trace exec 1003
trace store d404
```

The log, cut:

```text
#1 (Stop on  exec 1000)    9/$009,   1/$01
.C:1000  4C 06 10    JMP $1006      - A:00 X:00 Y:00 SP:fd ..-..IZ.        568
Executing: r ; del 1
  ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH
.;1000 00 00 00 fd 2f 37 00100110 009 001        568
#3 (Trace store d404)   12/$00c,  24/$18
.C:100a  9D 00 D4    STA $D400,X    - A:00 X:04 Y:00 SP:fd ..-..I..        780
#2 (Trace  exec 1003)    0/$000,  62/$3e
.C:1003  4C 28 10    JMP $1028      - A:37 X:F9 Y:00 SP:f7 ..-..I..      19718
#3 (Trace store d404)    1/$001,  42/$2a
.C:1043  8D 04 D4    STA $D404      - A:10 X:00 Y:00 SP:f7 ..-..I..      19761
#3 (Trace store d404)    1/$001,  48/$30
.C:1048  8D 04 D4    STA $D404      - A:11 X:00 Y:00 SP:f7 ..-..I..      19767
#2 (Trace  exec 1003)    1/$001,   0/$00
.C:1003  4C 28 10    JMP $1028      - A:37 X:F9 Y:00 SP:f7 ..-..I..      39375
…
#3 (Trace store d404)    1/$001,  48/$30
.C:1048  8D 04 D4    STA $D404      - A:11 X:01 Y:00 SP:f7 ..-..I..     255639
```

What the run shows (rung 1, VICE x64sc 3.10's vsid, PAL):

| Observation | Value |
|---|---|
| Init called | once (a `trace exec 1000` run fired once), at clock 568, with A = $00 for song 1 and `$01` = $37 |
| Play calls in 1,000,000 cycles | 50, first at clock 19718 |
| Interval between play calls | 19654 or 19657 cycles; mean 19656.02 = 312 × 63, one PAL frame |
| Interval between gate-on stores | 235872 cycles every time = 12 × 19656 |
| Who calls play | vsid's driver at $1100: `$0314` → $1211, `STA $01` with $37, `JSR $11F6`, `JMP ($111B)` → $1003 |

The song number arrives as song − 1: song 1 gives A = $00. The last row
came from a second command file, `break exec 1003` with
`command 1 "chis 12 ; d 1100 1120 ; m 0314 0315 ; del 1"`; `m 0314`
printed `11 12`. The driver takes the page after the image ("free pages
$1100-$9fff"), so a player that uses RAM past its own end can collide with
it; the header's start page and page length fields ($78, $79) exist to
tell a player which pages are free.

## Packers and loader stubs

Measured 2026-09-26 on the maintainer's Commando image (c64hq crack; file
`commando`, sha1 0c19361689f6c977afe2e00e80be303a3d16be5b, loads at
$0801, 43,004 bytes) in VICE x64sc 3.10, PAL C64C. The stage facts are
the memory-map teardown's, from traces of every store to `$0001` and
every store to $0000-$FFFF from power-on (rung 1); `re-load-map` gives
the same stages and entry. An earlier version of this section was rung 4
("this repo has no packed PRG") and its depack step was wrong; see the
last list.

`re-load-map` traces every store from power-on to one frame after the
program's first interrupt dispatch, and groups the stores by writer: PCs
within 256 bytes whose code was written at about the same time. A writer
whose code is in the stack page gets a stage number, in clock order. Cut:

```text
$ node src/cli.ts re-load-map session:docs/game-design/studies/sessions/commando.json
…
    "load": 2049, "end": 45052,
    "stubs": [
      { "addr": 2049, "sys": 2217, "text": "COMPUTERBRAINS", "line": 2049, … },
      { "addr": 2277, "sys": 2066, "text": "C.C.S.", "line": 65535, … },
      { "addr": 40589, "sys": 2061, "text": "", "line": null, … } ],
    "writers": [ …
      { "id": "w20", "pc_range": { "start": 257, "end": 422 }, "stores": 435169,
        "first_clock": 3404411, "last_clock": 8916816, "in_stack_page": true,
        "ram_under_io": [], "stage": 1, … },
      { "id": "w22", "pc_range": { "start": 41818, "end": 41840 }, "stores": 4160,
        "dest_ranges": [ …, { "start": 53248, "end": 57343 } ],
        "ram_under_io": [ { "start": 53248, "end": 57343 } ], "stage": null, … },
      { "id": "w23", "pc_range": { "start": 260, "end": 414 }, "stores": 528765,
        "first_clock": 8992780, "last_clock": 15190653, "in_stack_page": true,
        "dest_ranges": [ …, { "start": 2048, "end": 53247 }, { "start": 57344, "end": 65535 } ],
        "ram_under_io": [], "stage": 2, … },
      { "id": "w30", "pc_range": { "start": 24338, "end": 24382 },
        "dest_ranges": [ …, { "start": 54276, "end": 54276 }, …, { "start": 54296, "end": 54296 } ],
        "ram_under_io": [], "stage": null, … }, … ],
    "entry_pc": 2128,
    "first_program_dispatch_clock": 15243156,
    "unknowns": [ "arm write at $e5ad: $D011 never written before it, so the armed line is unknown", … ]
```

The run took 30 s. What it and the teardown traces show:

| Step | Clock | What happens |
|---|---|---|
| Stub 1 | 2,970,808 | RUN → `SYS 2217`; a crack intro from the PRG's tail |
| Stage 1 set-up | 3,395,238 | `$01` = $38 (all RAM); 256 bytes of pointers and depacker copied to $00FB-$01FA; JMP $00FF |
| Stage 1 (w20, $0101-$01A6) | 3,404,411-8,916,816 | Moves the packed block up to end at $B37C, then decodes forward into ($39) from $0801; output $0801-$B37C. `DEC $01`, BASIC CLR, RUN the new line |
| Stub 2 | 8,922,425 | `SYS 2066`; `$01` = $38; 4,096 bytes copied raw to $D000-$DFFF (w22) |
| Stage 2 (w23, $0104-$019E) | 8,992,780-15,190,653 | Decodes backward into ($39) from $FFFF down to $0800; put-byte at $018C, in the stack page, skips $DFxx → $CFxx |
| Entry | ~15.19 M | $0850 (`entry_pc` 2128) |
| First dispatch | 15,243,156 | The game's raster handler, on the title |

- **The output pointer is BASIC's line number.** Both stages write
  through ($39), and $39/$3A is where BASIC keeps the current line
  number. The stubs never set it: stub 1's line number is 2049 = $0801,
  stub 2's is 65535 = $FFFF, and running each line put its number there
  (`line` in the stubs above; snapshots read $0801 at stage 1's start and
  $FFFF at $0812). Read a stub's line number as a possible address.
- **The backward stage skips I/O.** Stage 2 fills $0800-$CFFF and
  $E000-$FFFF (w23's two destination ranges) and never $D000-$DFFF; the
  4 KB there came raw from stub 2, before it.
- **A store to $D4xx is not always the SID.** w22's 4,096 stores covered
  $D000-$DFFF with `$01` = $38, and `ram_under_io` covers the whole range:
  its $D400-$D7FF stores are charset bytes in RAM. w30, the game's sound
  code, stored to $D404 … $D418 with `ram_under_io` empty: those reached
  the SID. The tool follows every store to `$0001` to tell them apart; a
  store made while `$01` is unknown gives `ram_under_io` null and an
  unknowns line.
- **Vector bytes in the output are not installs.** The backward stage
  writes $FFFA-$FFFF on its way down. `transient_vectors` lists each
  vector value no interrupt ever went through (here $FFFE and $FFFA
  written as 0 seven times each); the writer that stored it says whether
  it was a depacker.
- **Timing.** Stage 1 about 5.51 M cycles, stage 2 about 6.21 M; RUN to
  entry about 12.2 M cycles, 12.4 s PAL (rung 3 from the clocks). Run a
  session or trace with `-limitcycles` well past that: the Commando
  session uses 60,000,000.

Corrections to the rung-4 method this section replaced:

- It said to break on "the first execute inside memory that was written
  after load" and call that the entry. On Commando that is stage 1's own
  copy in the stack page, copied there from clock 3,395,238 and run from
  3,404,400. The
  entry is the first PC run in program memory after the last stage's last
  store: `entry_pc`, which searches $0200-$9FFF and $C000-$CFFF only, and
  says so in `unknowns` when it cannot see the entry.
- It listed `$01` = $34 or $35 as the sign. Commando's stages used $38:
  bits 0-2 clear, all RAM, the same map as $34.
- Unp64 is still not installed here; the tool above replaced it for this
  image.

## Relocatability and naming

A block can move only if nothing addresses it absolutely. In da65 output,
every `JMP`, `JSR` and absolute operand whose target lies inside the image
is a fixed address; a census of the image's own high bytes finds the rest,
including address tables like `handler_hi` above ($08, $08, $08). Branches
are relative and move freely.

Names: da65 writes `Lxxxx` for unnamed targets and `Lxxxx := $xxxx` for
addresses outside the image. Give a name only when an observation supports
it (the handler at $0314 is `dispatch` because `re-irq-chain` saw it
installed there); a guessed name stays marked as a guess until one does.
VICE labels use `al C:0876 .irq`; KickAssembler writes that format.

## Regenerator 2000

Installed here with `cargo install --locked regenerator2000`, version
0.9.20 (MIT, <https://github.com/ricardoquesada/regenerator2000>).

```text
$ regenerator2000 --headless --export_asm r2k.asm --assembler ca65 kickassembler-irq-chain.prg
Error: Headless mode only supports .regen2000proj files
…
Solution: Load file in UI mode, configure, then save as .regen2000proj

$ regenerator2000 --export_asm r2k.asm --assembler ca65 kickassembler-irq-chain.prg < /dev/null
Error: Device not configured (os error 6)
```

The second form writes `r2k.asm` before it fails to open its terminal UI.
That file is every byte as `.byte`, from $0801 to $094D: no code/data split,
no labels. It reassembles byte-identical with the command in its header
(`cl65 -t c64 -C c64-asm.cfg r2k.asm`; `cmp` reported no difference).
`--mcp-server-stdio` on a `.prg` stops with the same headless error. A
split needs a `.regen2000proj` made in the interactive UI, which this
machine did not drive; so no comparison with da65's split was made.

## Tools not installed here

External: none was run on the reference machine. Descriptions are rung 4.

| Tool | What it is for |
|---|---|
| Regenerator 1.x | Windows interactive C64 disassembler (predecessor of Regenerator 2000) |
| Infiltrator | Interactive C64 disassembler |
| JC64dis | Java C64 disassembler, also handles SID files |
| 6502bench SourceGen | Interactive 6502 disassembler with code/data tracing from entry points |
| Ghidra + ghidra-retro-machines | General reverse-engineering suite; the extension adds C64 loaders |
| Retro Debugger | Emulator front end with a live memory and code view |
| Unp64 | Packer identification and depacking by emulation |
| SIDId, SIDDump | Identify a SID player; log its register writes per frame |

## See also

- [vice-reference](../runtime/vice-reference.md): the emulator, its
  models, and reading its screenshots.
- [kernal-routines-reference](../hardware/kernal-routines-reference.md) and
  [c64-memory-map](../hardware/c64-memory-map.md): names and roles of the
  vectors and routines found above.
- [c64-file-formats](../formats/c64-file-formats.md): PRG and PSID headers.
- [cc65](cc65-reference.md): the suite that ships da65.
- [game-study-method](../workflow/game-study-method.md): the whole
  sequence for taking a commercial game apart, as run on Commando.
