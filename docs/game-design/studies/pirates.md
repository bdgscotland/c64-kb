---
kind: studied
---
<!-- doc-type: game-design -->

# Study: Pirates! (MicroProse, 1987)

How Pirates! is put together, measured with the RE tools in VICE x64sc 3.10
(`-default`: PAL C64C, VIC-II 8565, SID 8580, CIA 8521). The image is the
maintainer's copy of the "nostalgia" crack on a D64; it is not in this
repository (`game-design/reference-game-sources.md`). The page holds
addresses, raster lines, cycle counts and layouts, never the game's code,
graphics, map or text bytes. The copy is cracked; its start-up options menu
patched five interpreter table entries ($31/$32/$33/$36/$39), so opcode
meanings for those five entries describe the modified copy, not the original.

Rungs follow the repository's ladder (CLAUDE.md rule 3): (1) run here in
VICE; (2) two documents agree and neither cites the other; (3) arithmetic from
stated constants; (4) unverifiable here. A claim read from the game's code or
tables in a RAM dump, but not watched happening in a run, says "(from the
game's code, not seen running)". Observation IDs (`pirates#…`) are entries in
`game-design/studies/observations/pirates.json`.

## Pirates! (MicroProse, 1987), studied

**Game design:** `pirates_1987`
**Instance of:** open_world_modes
**Region:** PAL
**Studied from:** Pirates! (1987, Sid Meier, MicroProse); image sha1=ec94dbfb6908b9c0249958b4aed3dff452096ea3; session studies/sessions/pirates.json
**Composes:** scene_bytecode_interpreter, basic_ml_service_blocks, bank_swap_trampoline, centred_sprite_map_scroll, text_window_and_menu, facing_turn_step, sprite_animation_table, ram_under_kernal, frame_sync_loop
**IRQ chain:** play pal: $9681 @ line 0 (measured-vice, obs pirates#irq-1 and #irq-2; one part, no splits in the scenes measured)
**Memory map:** VIC bank 3; $DD00=$C0; screen $CC00 in duel and town; screen $E400 in sailing; charset $E000 in all play modes; $01=$36 in duel (BASIC ROM hidden, code at $A000-$BFFF); $01=$37 in town (BASIC ROM visible); k-block $9500; vb block $9600; wn block $9980; BASIC $0801; boot ML $3BA0; game DOS under KERNAL $F000 (measured-vice, obs pirates#snap-1 - #snap-3, #mem-1)
**Diverges from archetype:** extra: sprite_animation_table; missing: sid_play_routine_pattern

Sid Meier wrote it: rung 4, from the title screen credit visible in the setup
phase (not quoted here). No credit string was found in the game's RAM.

### Shape: BASIC drives the game; machine code draws it

The game's logic is a BASIC program. Setup, menus, trading, the voyage driver
and the calendar are BASIC lines. BASIC calls machine code through three fixed-
address service blocks, one page each:

- $9500 memory kernel: bank-swap, copy, fill, KERNAL trampoline.
- $9600 video and input: raster IRQ entry, joystick read, scroll hand-off.
- $9980 windows: draw a framed character window, parse menu text.

Parameters pass through zero page ($A5-$AB); results come back by PEEK.

One bytecode interpreter at $A486 runs every animated scene — fencing, sailing,
outcome panels — from a bytecode script (`scene_bytecode_interpreter`,
obs pirates#vm-1). The scene ends by returning an event code; BASIC dispatches
on it with `ON LN GOTO`.

The BASIC program is swapped whole between phases. The duel runs a 381-line
program ($0801-$3B53, VARTAB $3DDD); the town runs a different 817-line program
($0801-$847B, VARTAB $85AD). Which disk file carries the town program was not
settled (obs pirates#mem-3).

### The frame

One raster IRQ at line 0, handler $9681 via $0314, 333 cycles median. It
does: music (all sound lives here), fine-scroll hand-off to the VIC registers
through one dirty byte (mp+$0C), an optional sprite, then JMP $EA31 (keyboard
scan, jiffy clock). No raster splits in the scenes measured. Everything else
runs in the main loop (`basic_ml_service_blocks`, obs pirates#irq-1, #irq-2).

### The bytecode interpreter

Main loop $A486-$A4EB. Opcode fetched at $A4A8 with `LDA ($9E),Y`. Bits 7-6
split the format:

- $00-$7F: table opcodes, dispatched via a self-modifying `JMP ($A4EF)` into
  a 128-word table at $A300. The doubled opcode byte is stored into the jump's
  low byte at $A4EC before dispatch.
- $40-$79 take one operand byte; $51 takes two.
- $80-$BF: push a channel state word from $9F00+2n onto the VM stack.
- $C0-$FF: pop a stack word back to $9F00+2n.

Opcode groups include: sprite X/Y ($66/$67), poke any address ($30), flow
control with a per-page branch cache, 16-bit stack arithmetic, joystick reads
($A64E fire, $A65E directions: both `LDA $DC00,Y`), SID random scaled ($08),
text, scene-end. No sound opcodes exist; music runs in the IRQ.

Timing is pass-count based, not frame-based: the duel runs 89 passes per frame
at a median of 198 cycles each; the sailing scene runs ~100 passes per frame at
174 cycles each. The interpreter never reads the frame counter. Scene speed is
constant only because the script's own counted loops fix the pass count per
turn (~1,500 passes per turn) (obs pirates#vm-1, #vm-2).

### The sailing map

The sailing map is one scene of the same bytecode interpreter, entered from
BASIC line 5000 of the town program (the voyage driver). BASIC prepares state
(screen, SID, copies, wind variables) and calls the ML; the scene runs until
an event code, which BASIC dispatches.

Display: VIC bank 3, screen matrix $E400, charset $E000, multicolour text
mode ($D011=$1B, $D016=$D8). The world map is a static 3,048-byte block at
$C000-$CBE7; its cell encoding was not decoded (obs pirates#sail-2).

The ship is two overlaid sprites at a fixed screen position (hardware x=180,
y=144): sprite 4 (hi-res shape) and sprite 5 (multicolour shape). Sixteen
headings are sprite-pointer pairs $40+H/$50+H with H=0..15; turning is one
pointer rewrite per step (`facing_turn_step`, `centred_sprite_map_scroll`,
obs pirates#sail-1).

One step is ~102,700 cycles (~5.2 PAL frames): poll input, redraw the window
from the map ($9BAE), write scroll registers through the dirty byte mp+$0C,
update sprite registers. The IRQ path ($97BE-$97E1) reads mp+$0A (fine X),
mp+$0B (fine Y) and mp+$0C (screen page + dirty) every frame and writes
$0288/$D018/$D016/$D011; it then clears the dirty byte. The map code never
writes VIC registers directly (obs pirates#sail-2, #sail-3).

The calendar advances by BASIC per voyage leg, not per frame. `ON LN GOTO`
dispatches the scene's event code: ship sighted, food shortage, news, arrival
at port, keep sailing (obs pirates#scene-1).

### Memory layout

```
$0801-$3B53  BASIC program (duel: 381 lines)
$3B54-$3B9F  zero gap
$3BA0-$3DDC  boot ML (JMP table, BASIC->ML trampolines)
$9500-$95FF  k-block (bank-swap, copy, fill, KERNAL trampoline)
$9600-$97FF  vb block (IRQ handler, joystick read, scroll)
$9800-$97FF  gap
$9980-$9B7F  wn block (window draw, menu text, picture copy)
$9B80-$9EFF  map engine (mp block)
$9F00-$9FFF  ML variable block (16-bit LE slots, n at $9F00+2n)
$A000-$BFFF  under BASIC ROM: duel code ($A486 key loop, scene VM)
$C000-$CBE7  world map (static 3,048 bytes; VIC bank 3)
$CC00-$CFFF  screen matrix (menus, duel); also wn working copy
$D000-$DFFF  I/O (visible) or RAM charset (with $01=$35)
$E000-$E3FF  RAM charset ($E000-$E3E8 used by sailing scene codes)
$E400-$E7E7  screen matrix (sailing scene)
$E7F8-$E7FF  sprite pointers (sailing scene)
$EC00-$EFFF  sprite shapes (duel, menus)
$F000-$FFFF  under KERNAL ROM: game DOS ($F000 JMP table), RAM charset
```

$01 per mode: $37 (BASIC ROM visible) for setup questions and town; $36 (BASIC
ROM hidden, code at $A000-$BFFF visible) for duel and sailing; $35 (KERNAL
hidden) for disk loads; $04 (both ROMs hidden) for copies (obs pirates#snap-1,
#snap-2, #snap-3, #mem-1).

### Bank-swap trampoline

The memory kernel's bank-swap routine at $9509 saves the caller's $01 value
into the operand of its own restore instruction at $9524. The restore at $9523
is `LDA #<saved> / STA $01 / CLI / RTS`. One routine serves nesting-safe bank
swaps for copy, fill and IRQ work without a stack (`bank_swap_trampoline`,
obs pirates#mem-2).

### What was not reached

Sea battles, land battles, trading and the world map's cell encoding were not
measured. Which file loads the 817-line town program was not settled. The
speed law (how wind angle, vessel type and point of sail combine into step
movement) was not measured. The five patched interpreter table entries
($31/$32/$33/$36/$39) differ from the original; what those opcodes did in the
unmodified game is not known here.

### Evidence

| Claim | Rung | Observations |
|---|---|---|
| IRQ handler $9681, line 0, one part, 333 cycles | 1 | pirates#irq-1, #irq-2 |
| VIC state duel ($DD00=$C0, screen $CC00, charset $E000, $01=$36) | 1 | pirates#snap-1 |
| VIC state town ($01=$37, same video mode) | 1 | pirates#snap-2 |
| VIC state sailing (screen $E400, $D018=$98) | 1 | pirates#snap-3 |
| Memory layout: k/vb/wn/mp/ML blocks, ROM layers | 1 | pirates#mem-1 |
| Bank-swap trampoline $9509/$9524 | 1 | pirates#mem-2 |
| BASIC program swap, VARTAB addresses | 1 | pirates#mem-3 |
| FRETOP/MEMSIZ set $8E00 | 1 | pirates#mem-4 |
| Interpreter $A486, table $A300, dispatch $A4EF | 1 | pirates#vm-1 |
| Pass counts and cycle costs per frame, duel and sailing | 1 | pirates#vm-2 |
| Joystick opcode handlers $A64E/$A65E; duel pointer read $A728 | 1 | pirates#vm-3 |
| Ship fixed x=180,y=144; 16 headings $40+H/$50+H | 1 | pirates#sail-1 |
| Step ~102,700 cycles, map $C000-$CBE7 3,048 bytes | 1 | pirates#sail-2 |
| Scroll dirty-byte path $97BE, 898 register writes | 1 | pirates#sail-3 |
| LOAD hook $0330->$02C3->$F006 | 1 | pirates#load-1 |
| Scene event codes, ON LN GOTO dispatch | 1 | pirates#scene-1 |
| Sid Meier credit | 4 | title screen (not quoted) |
