# Devices a recipe attaches

<!-- doc-type: device-reference -->

## Overview

One section per thing plugged into the machine that a recipe here needs:
a joystick or other controller in a control port, an adapter on the user
port, a drive on the serial bus, a cartridge or RAM expansion in the
expansion port. Each section names the device, its port, how VICE
attaches it and the hardware units it occupies. The lines follow
`CONVENTIONS-devices.md`; the ingest turns each section into a `Device`
node, its Claims line into CLAIMS edges, and a recipe's `devices:` key
into REQUIRES_DEVICE edges.

Every device here is attached by a pinned run in `docs/recipes/runs.json`
or is VICE's default, so each has a recipe or a `-dumpconfig` line behind
it. A device no recipe attaches (the KoalaPad, the Final Cartridge, a
second drive) has no section.

How to read the claims: `owns` means the device's lines occupy the unit,
so a second device that owns it cannot be attached at the same time (one
socket, or one address decode); `shares` means devices use the unit side
by side under a protocol (the SID pot lines, selected by `$DC00` bits
6-7; the serial bus, one device number each). The claims describe the
device, not a program: a program that reads the joystick still claims
`cia1_port_a (reads)` on its own page.

Claims basis: `measured-vice` when a pinned recipe run attached the
device and read or wrote that unit; `derived-listing` when the claim
comes from reading VICE 3.10's source for the device (the file is named).
Every claim here is VICE's behaviour, not a measurement of the hardware.

## Joystick in control port 1

**Device:** `joystick_port_1`
**Device kind:** input
**Device port:** control_1
**VICE attach:** default
**Claims:** cia1_port_b (owns)
**Claims basis:** derived-listing

A digital joystick: five switches on port 1's UP, DOWN, LEFT, RIGHT and
FIRE lines, read as `$DC01` bits 0-4, 0 when closed
(`techniques/input.md`). VICE's `src/c64/c64cia1.c` ANDs port B reads
with `read_joyport_dig(JOYPORT_1)`, and `x64sc -default -dumpconfig`
prints `JoyPort1Device=1` (joystick), so no option attaches it (VICE
x64sc 3.10, rung 1). The keyboard rows share these five bits; that is a
property of the port, not a second device.

## Joystick in control port 2

**Device:** `joystick_port_2`
**Device kind:** input
**Device port:** control_2
**VICE attach:** default
**Claims:** cia1_port_a (owns)
**Claims basis:** measured-vice

As port 1, on `$DC00` bits 0-4 (`read_joyport_dig(JOYPORT_2)` in
`c64cia1.c`; `JoyPort2Device=1` in the dump). `kickassembler/own-keyscan`
drives port 2's fire line through VICE's autofire (`-joydev2 2
-joystick2autofire`) and counts it on `$DC00` bit 4.

## Paddles in control port 2

**Device:** `paddles_port_2`
**Device kind:** input
**Device port:** control_2
**VICE attach:** flags -controlport2device 2
**Claims:** cia1_port_a (owns), sid_pots (shares)
**Claims basis:** measured-vice

A pair of paddles: two potentiometers on port 2's POTX and POTY pins,
read through `$D419`/`$D41A` once `$DC00` bits 6-7 select port 2, and
two buttons on the LEFT and RIGHT lines, `$DC00` bits 2 and 3 (VICE's
`src/joyport/mouse_paddle.c`). `kickassembler/paddle-read` attaches them
with `-controlport2device 2` (VICE's `JOYPORT_ID_PADDLES`) and reads both
ports' pots. The pot lines are shared: the SID has one pair of
converters, and the `$DC00` select decides which port they see.

## 1351 mouse in control port 1

**Device:** `mouse_1351_port_1`
**Device kind:** input
**Device port:** control_1
**VICE attach:** flags -controlport1device 3
**Claims:** cia1_port_b (owns), sid_pots (shares)
**Claims basis:** measured-vice

Commodore's proportional mouse: the position as two 6-bit counters on
the pot lines, the left button on FIRE and the right on UP, `$DC01`
bits 4 and 0 (VICE's `src/joyport/mouse_1351.c`).
`kickassembler/mouse-1351-read` attaches it with `-controlport1device 3`
(`JOYPORT_ID_MOUSE_1351`) and reads it once a frame;
`kickassembler/paddle-read` attaches it too, as a second pot source on
port 1.

## Light pen in control port 1

**Device:** `light_pen_port_1`
**Device kind:** input
**Device port:** control_1
**VICE attach:** flags -controlport1device 11
**Claims:** cia1_port_b (owns)
**Claims basis:** derived-listing

A light pen whose beam trigger latches the VIC-II's `$D013`/`$D014`
(the VIC's LP input is on control port 1) and whose button is on the UP
line, `$DC01` bit 0: VICE's "Light Pen (up trigger)",
`JOYPORT_ID_LIGHTPEN_U`, wired in `src/joyport/lightpen.c` as
`{ PEN, JOYPORT_UP, ... }`. `kickassembler/light-pen-read` attaches it
with `-controlport1device 11`; a headless run has no host mouse, so its
latch and button were never driven, and the port claim is read from the
source, not measured. The VIC's latch registers are not a hardware unit
in the graph.

## CGA/Protovision 4-player adapter on the user port

**Device:** `four_player_adapter_cga`
**Device kind:** input
**Device port:** user
**VICE attach:** flags -userportdevice 3
**Claims:** user_port (owns)
**Claims basis:** measured-vice

Two more joysticks on the user port: PB7 of CIA2 port B (`$DD01`)
selects which one PB0-PB3 carry, PB4 is joystick 3's fire and PB5
joystick 4's (VICE's `src/userport/userport_joystick.c`, "CGA userport
joy adapter"). `kickassembler/four-player-read` attaches it with
`-userportdevice 3` and counts presses on both adapter joysticks.

## 1541-II as drive 8

**Device:** `disk_1541_ii`
**Device kind:** storage
**Device port:** serial
**VICE attach:** disk
**Claims:** serial_bus (shares)
**Claims basis:** measured-vice

The disk drive every disk recipe here runs against. `x64sc -default
-dumpconfig` prints `Drive8Type=1542` and `Drive8TrueEmulation=1`, and
`src/drive/drive.h` defines `DRIVE_TYPE_1541II` as 1542 (VICE 3.10,
rung 1), so a runs.json `"disk"` entry, a fresh D64 attached as drive 8,
runs on an emulated 1541-II with its own 6502. The serial bus is shared:
each device on it answers to its own number. A run that sets
`-drive8type` to anything but 1542 is refused by verify:recipes, because
this section would no longer describe it.

## REU 1750 (512 KB)

**Device:** `reu_1750`
**Device kind:** memory
**Device port:** expansion
**VICE attach:** flags -reu -reusize 512
**Claims:** expansion_io2 (owns)
**Claims basis:** measured-vice

Commodore's RAM Expansion Unit with 512 KB. Its REC registers sit at
`$DF00-$DF0A` and VICE decodes the 32 bytes `$DF00-$DF1F`, mirrored
through `$DFFF`; it decodes nothing in `$DE00-$DEFF`
(`src/c64/cart/reu.c`, where 512 selects the 1750 and 256 the 1764).
`kickassembler/reu-dma` attaches it with `-reu -reusize 512` and drives
its transfers through `$DF01`-`$DF0A`.

## EasyFlash

**Device:** `easyflash`
**Device kind:** cartridge
**Device port:** expansion
**VICE attach:** crt 32
**Claims:** expansion_io1 (owns), expansion_io2 (owns)
**Claims basis:** derived-listing

A 1 MB flash cartridge: 64 banks of 16 KB, a bank register at `$DE00`
and a mode register at `$DE02` (bit 7 the LED), decoded at
`$DE00-$DE03` and mirrored through `$DEFF`, and 256 bytes of RAM at
`$DF00-$DFFF` (`src/c64/cart/easyflash.c`; CRT hardware type 32).
`kickassembler/easyflash-save` boots it from a built `.crt` and writes
`$DE00`/`$DE02`; it does not touch `$DF00`, so the `expansion_io2` claim
is read from the source. An earlier version of the registers reference
gave `$DF00` as "LED + I/O".

## Magic Desk cartridge

**Device:** `magic_desk`
**Device kind:** cartridge
**Device port:** expansion
**VICE attach:** crt 19
**Claims:** expansion_io1 (owns)
**Claims basis:** measured-vice

An 8 KB-window banked ROM cartridge: one write-only register at `$DE00`
(bits 0-6 the bank, bit 7 turns the cartridge off), mirrored through
`$DEFF`; nothing in `$DF00-$DFFF` (`src/c64/cart/magicdesk.c`; CRT
hardware type 19). `kickassembler/crt-banked` boots a two-bank one and
switches banks through `$DE00`.

## Generic 8 KB cartridge

**Device:** `generic_8k_cartridge`
**Device kind:** cartridge
**Device port:** expansion
**VICE attach:** crt 0
**Claims:** none
**Claims basis:** derived-listing

One 8 KB ROM at `$8000-$9FFF`, EXROM low and GAME high, and no
registers (CRT hardware type 0; `src/c64/cart/c64-generic.c` registers
no I/O device). It occupies the expansion port but no I/O page. `cc65/cartridge-8k` boots one.
