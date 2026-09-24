---
recipe: relocated-code-block
toolchain: kickassembler
output_format: PRG
region: both
techniques: [relocated_code_block]
file_formats: [PRG]
uses_registers: [D011, D012, D020]
uses_kernal: []
harness: [$02FF]
---

<!-- doc-type: recipe -->

# KickAssembler: code stored at $2000, run at $C000 with `.pseudopc`

## Synopsis

A border-flash routine is stored in the PRG at `$2000` and assembled for
`$C000` with `.pseudopc`. At start-up the program copies the block to
`$C000`, wipes the stored copy, and calls it. The routine steps the
border through seven colours, one per frame, and leaves it green; the
program then writes 1 to `$02FF`. The wipe is the test: an absolute
address inside the routine that still pointed at `$20xx` would now read
zeros, and a `JSR` there would execute `BRK`. The Oscar64 and cc65
forms of the same program are
[oscar64/relocated-code-block](../oscar64/relocated-code-block.md) and
[cc65/relocated-code-block](../cc65/relocated-code-block.md); the
technique is `relocated_code_block` in
[memory-banking](../../techniques/memory-banking.md).

## Source

```asm
// relocated-code-block.asm - a routine stored at $2000, copied to $C000, run there
.const BLOCK_RUN = $c000

BasicUpstart2(start)

* = $0810 "Main"
start:
        sei
        ldx #0
copy:   lda block_load,x            // one page is enough: the block is under 256 bytes
        sta BLOCK_RUN,x
        inx
        bne copy
        // Wipe the load image. From here on a stray absolute reference to
        // $20xx reads zeros and executes BRK, so only code assembled for
        // $C000 can finish.
        lda #0
        ldx #0
wipe:   sta block_load,x
        inx
        bne wipe
        jsr flash                   // the label is the run address, $C000
        lda #1
        sta $02ff
        jmp *

* = $2000 "Block (load)"
block_load:
.pseudopc BLOCK_RUN {
flash:
        ldx #0
next:   lda colours,x               // absolute: assembles as LDA $C0xx,X
        sta $d020
        jsr frame                   // absolute: JSR $C0xx
        inx
        cpx #colours_end - colours
        bne next
        rts

// Wait for the next frame: raster line 0 once, then away from it.
frame:  lda $d012
        bne frame
        bit $d011
        bmi frame
wait:   lda $d012
        beq wait
        rts

colours: .byte 2, 7, 1, 7, 2, 0, 5  // the last one stays: green
colours_end:
}
block_end:
.print "block stored at $" + toHexString(block_load) + ", runs at $" + toHexString(flash) + ", " + (block_end - block_load) + " bytes"
```

## Build

```bash
java -jar KickAss.jar relocated-code-block.asm -o relocated-code-block.prg -vicesymbols -showmem
```

KickAssembler 5.25 prints the `.print` line and the memory map:

```text
  block stored at $2000, runs at $c000, 40 bytes
  $0801-$080c Basic
  $0810-$0830 Main
  $2000-$2027 Block (load)
```

`-showmem` lists the block at its storage address. The labels inside
`.pseudopc` take the run address; the `.vs` file has:

```text
al C:2000 .block_load
al C:c000 .flash
al C:c011 .frame
al C:c021 .colours
```

The first bytes stored at `$2000`, read from the PRG, are
`A2 00 BD 21 C0 8D 20 D0 20 11 C0`: `LDX #0`, `LDA $C021,X`,
`STA $D020`, `JSR $C011`. Every operand inside the block is a `$C0xx`
address.

## Expected output

```bash
x64sc -default -warp +sound +autostart-delay-random -autostartprgmode 1 \
  -limitcycles 6000000 -exitscreenshot relocated-code-block.png -autostart relocated-code-block.prg
```

The border is green: `(98, 213, 50)` in the PAL PNG
(`screenshots/relocated-code-block.png`), `(114, 189, 103)` in the NTSC
one (`screenshots/relocated-code-block-ntsc.png`, `-model ntsc` after
`-default`). A `trace store 02ff` logged `STA $02FF` at `$082B` with
`A:01` on both models. Measured in VICE x64sc 3.10.

**The monitor break at `$C000`, symbols loaded.** A `-moncommands` file:

```text
logname "brk.log"
log on
ll "relocated-code-block.vs"
break .flash
command 1 "r"
```

The log, PAL:

```text
BREAK: 1  C:$c000  (Stop on exec)
#1 (Stop on  exec c000)  143/$08f,  51/$33
.C:c000  A2 00       LDX #$00       - A:00 X:00 Y:00 SP:f4 ..-..IZ.    2977116
  ADDR A  X  Y  SP 00 01 NV-BDIZC LIN CYC  STOPWATCH
.;c000 00 00 00 f4 2f 37 00100110 143 051    2977116
```

`break .flash` resolved to `C:$c000`. NTSC stopped at the same address,
line 194 cycle 61, stopwatch 3,089,771. With no remote-monitor client
attached, the run continued after the stop and reached `-limitcycles`
with the border green, on both models.

**The control.** The same source with `.pseudopc $2000` in place of
`.pseudopc BLOCK_RUN`, still copied to and called at `$C000`, ended at
the BASIC `READY.` prompt with a light blue border (PAL screenshot, run
here). The copy at `$C000` read its colour from the wiped `$2021` and
jumped to `$2011`, where the `$00` byte is `BRK`. A `trace exec fe66`
caught the KERNAL's BRK path, `JSR $FD15` with the B flag set, at
stopwatch 2,977,167 PAL and 3,089,865 NTSC, and `trace store 02ff` saw
only the reset's clear of page 2.

## Why this works

`.pseudopc addr { ... }` assembles the block as if the program counter
were `addr` while the bytes still go out at the current `*`. Labels
inside take the run address, so `jsr flash` outside the block and
`lda colours,x` inside both name `$C0xx`. The copy loop moves the bytes
unchanged; they are correct at `$C000` because they were assembled for
it. Branches are relative and would survive a move anyway; `JSR`, `JMP`
and absolute or indexed data addresses do not.

One page is copied because the block is 40 bytes. A longer block needs a
copy of `block_end - block_load` bytes, and the `.print` line is where
to read that size. Run addresses under the I/O area or the KERNAL need
`$01` banked before the copy and while the code runs
(`cpu_io_port_bank`).
