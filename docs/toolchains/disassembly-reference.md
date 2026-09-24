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
batch, and this repo's two trace tools (`re-irq-chain`, `re-frame-profile`).

Every command block below was run on the reference machine, and its output
is quoted from that run ("…" marks a cut). The inputs are the VICE ROM
images and this repo's own recipe PRG
[kickassembler/irq-chain](../recipes/kickassembler/irq-chain.md). Nothing
here is taken from a commercial program: per
[reference-game-sources](../game-design/reference-game-sources.md), a
commercial disassembly supplies facts, never listings.

The images used:

```text
$ shasum kernal-901227-03.bin kickassembler-irq-chain.prg
1d503e56df85a62fee696e7618dc5b4e781df1bb  kernal-901227-03.bin
026535741c224e80c2dd1d85ad54866a6c2382f6  kickassembler-irq-chain.prg
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
| Raster IRQ chain of a PRG | `node src/cli.ts re-irq-chain prog.prg` |
| Cycles between two stores | `node src/cli.ts re-frame-profile prog.prg --start 'store:$D020=$02' --stop 'store:$D020=$05'` |

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
  for 49.
- **An error ends the whole command string.** `d .irq .irq+15 ; … ; del 1`
  failed at `+15` (label arithmetic is refused), so `del 1` never ran and
  the checkpoint fired on every IRQ for the rest of the run.
- **`memmapshow` as a start-up line prints only its header**
  (`addr: IO  ROM RAM`): nothing has run yet. Call it from a checkpoint
  `command`, as above.
- **`-monlogname` appends.** A second run to the same log name added to
  the end of the first run's log. Use a fresh name or delete it first.
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

## Packers and loader stubs

Not run here: this repo has no packed PRG. The method, rung 4:

- **Signs.** A SYS target right after the stub; a copy loop that moves the
  program's tail to high memory or the stack page; `$01` set to $34 or
  $35 (all RAM, or I/O only); an end address near $FFFF. A custom loader
  also writes $DD00 and waits on its bits (the serial bus).
- **Identify.** Unp64 (external) names many packers and depacks by
  emulation.
- **Depack in VICE.** Trace stores over the destination range, then break
  on the first execute inside memory that was written after load; that is
  the unpacked entry. Save the range from there. `memmapshow` from a
  checkpoint (above) shows which bytes were written and then executed.

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
