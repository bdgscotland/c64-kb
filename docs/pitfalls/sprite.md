---
category: sprite
---

<!-- doc-type: pitfall-reference -->

# Sprite Pitfalls

The VIC-II provides exactly eight hardware sprites. Every sprite technique
that goes beyond this hard limit — multiplexers, Y-stretch, mid-frame
recoloring — requires tight coordination between CPU writes and the VIC's
internal state machine. The pitfalls in this document describe the most
common failures: silent drops when too many sprites share a line, visual
artifacts when expansion state changes at the wrong moment, coordinate
teleportation when the 9th X bit is forgotten, collisions that vanish
before the CPU can read them, and sprites the game counts while the border
hides them. All of them have bitten experienced C64 coders.

---

## sprite_dma_overflow — A logical sprite re-armed while its hardware slot is still busy, or after its Y line has passed, is silently not drawn

**Severity:** critical
**Region:** both
**Triggered by registers:** D015, D010, D000, D001
**Triggered by techniques:** sprite_multiplex_8, stable_raster_irq, sprite_multiplex_24, sprite_sine_chain, sprite_multiplex_game
**Mitigated by techniques:** sprite_multiplex_8

### Symptom

A multiplexed sprite engine that is supposed to show twelve, sixteen, or
more objects on screen displays only the first eight on any given raster
line. Logical sprites whose slot was re-armed too early or too late silently
disappear; in a naively ordered multiplexer these are the later entries in
the list, which is a software ordering, not a hardware one. There is no
visible corruption or tearing — sprites simply are not drawn, as if they
were never enabled.
The bug is easy to miss when objects are spread vertically because each
frame only a few lines have more than eight sprites active simultaneously.
The effect becomes obvious when objects cluster near the same Y coordinate:
a game with many bullets or enemies at the same height suddenly loses half
its sprites.

### Mechanism

The VIC-II has exactly eight sprite DMA channels — one per sprite index
(0 through 7). On each raster line the chip checks every enabled sprite's Y
register against the current raster line and, for any slot whose 21-line
(42 if Y-expanded) DMA is already running, fetches that slot's three data
bytes via the s-access cycles for that channel; the eight slots are
independent and no slot has priority over another for activation. There
are no additional DMA channels hiding behind software flags. The hardware
simply has eight slots, and eight is the absolute maximum simultaneously
active sprites per raster line.

A multiplexer that repositions sprites by writing new Y coordinates between
groups relies on each hardware slot being free when its next logical sprite
is due. The chip compares each enabled slot's Y with the raster line late in
every line (cycles 55-56 in Bauer's timing; measured in VICE, a Y write
landing before roughly cycle 55 of the target line still starts the sprite
on the next line) and starts the sprite's DMA only if that slot's DMA is
currently off. Two things therefore lose a sprite, without error, without a
flag, and without any signal visible to the programmer: a slot re-armed to a
Y that matches while the slot's own DMA is still running (the incoming
sprite is skipped for the rest of the frame — measured in VICE x64sc, a slot
at Y=100 rewritten on line 112 to Y=120 never re-appeared, while Y=121 did),
and a Y written after the raster has already passed it, which the compare
never matches again that frame. $D015 has only eight bits; the chip never
"sees nine enabled indices", and no index has priority over another. (An
earlier version of this paragraph said the chip walks indices 0-7 in
ascending order and always discards the highest-indexed sprite on a
contested line; the drop is per slot and depends on timing, not on index.)

`sprite_multiplex_8` is on both metadata lines above for that reason: the
overflow arises inside a naive multiplexer — one whose IRQ fires late or
whose sort leaves two groups on one line — and a correct one, sorted and
spaced as the Fix describes, is what prevents it.

### Fix

The fix is a correct sprite multiplexer running off raster IRQs, with two
requirements that must both hold:

1. **Y-sorted logical sprites.** Before each frame, sort the entire logical
   sprite list by ascending Y position. This ensures that when you assign
   the first eight logical sprites to hardware slots 0-7 and schedule the
   next IRQ for the ninth sprite's Y position, the groups are already
   separated along the Y axis.

2. **Minimum gap between groups.** Each group must begin at least one
   raster line below the bottom of the previous group. The VIC considers a
   sprite "active" for 21 lines (or 42 lines when Y-expanded). Schedule
   the reuse IRQ to fire at or after the last line of the outgoing group
   plus one, so the channel is free by the time the next logical sprite's Y
   is reached. Aim for 3-4 lines of slack to leave room for IRQ jitter and
   the cycle cost of the register writes themselves.

### Worked example

The following KickAssembler skeleton shows the channel-reuse pattern.
Hardware sprite slots 0-7 are assigned to logical sprites 0-7 at frame
start. When the raster counter reaches the Y of logical sprite 8, an IRQ
reprograms all eight hardware slots to serve logical sprites 8-15.

```kickassembler
// --- Frame start (vertical blank) ---
// Write first 8 logical sprites to hardware slots 0-7
.for (var i = 0; i < 8; i++) {
    lda logicY + i           // Y position of logical sprite i
    sta $D001 + i * 2        // hardware sprite i Y register
    lda logicX + i           // X position (low byte)
    sta $D000 + i * 2
    lda logicPtr + i
    sta SPRITE_PTRS + i      // video matrix + $3F8
    lda logicColor + i
    sta $D027 + i
}
lda #$FF
sta $D015                    // enable all 8 hardware sprites

// Schedule IRQ for group 2 (logical sprites 8-15)
// Fire one line above the topmost sprite in the next group
lda logicY + 8
sec
sbc #4                       // 4-line slack
sta $D012                    // raster compare
lda #$01
sta $D01A                    // enable raster IRQ

// --- Raster IRQ handler (fires above Y of logical sprite 8) ---
irq_group2:
    pha
    txa
    pha
    tya
    pha

    lda #$01
    sta $D019                // acknowledge VIC IRQ

    .for (var i = 0; i < 8; i++) {
        lda logicY + 8 + i
        sta $D001 + i * 2    // repoint hardware slot i → logical sprite 8+i
        lda logicX + 8 + i
        sta $D000 + i * 2
        lda logicPtr + 8 + i
        sta SPRITE_PTRS + i
        lda logicColor + 8 + i
        sta $D027 + i
    }
    // Update MSB X bits for the new group
    lda xMsbGroup2
    sta $D010

    pla
    tay
    pla
    tax
    pla
    rti
```

Critical invariant: every element of `logicY[8..15]` that reuses a hardware
slot must be at least 21 lines below that slot's previous Y (42 if
Y-expanded). Measured in VICE x64sc 3.10: a slot rewritten to old Y + 21
re-displays on the very next line with no gap, old Y + 20 never appears
again that frame, old Y + 22 leaves one blank line (Y-expanded: + 42
seamless, + 41 dropped). The mechanism — the outgoing sprite's DMA switches
off in cycle 16 of line Y + 21 and the Y compare that would re-arm the slot
runs in cycle 55 of that same line — is from Bauer's VIC article, not
measured here. An earlier revision of this paragraph said 22 and claimed a
21-line gap dropped a sprite; it does not. The 3-4 lines of slack in the Fix
come on top of the 21 for a different reason: the IRQ at `logicY[8] - 4`
also rewrites the slot's X, pointer and colour, and those act on the
still-running outgoing sprite from the next line (a colour write on line 112
recolours a Y = 100 sprite's rows 113-121, measured in VICE), so with that
IRQ scheme the practical same-slot spacing is 21 plus the slack, and a
20-line gap silently drops the incoming sprite for that frame.

### Cross-references

- Technique: `sprite_multiplex_8` — the sorted-Y, raster-IRQ multiplexer
  that prevents overflow
- Technique: `sprite_multiplex_24` — extends the pattern to 24+ sprites
  across three reuse passes
- Register: `D015` — sprite enable bitmask
- Registers: `D000`–`D00F` — per-sprite X/Y position
- Register: `D010` — sprite X MSB (see also `sprite_x_high_bit_wrong_register`)
- Pitfall: `sprite_x_high_bit_wrong_register` — a related issue when moving
  sprites past X=255

---

## sprite_y_expand_double_register_write — Clearing Y-expand mid-display crunches the sprite if the write lands on one cycle; a second write does not help

**Severity:** high
**Region:** both
**Triggered by registers:** D017
**Triggered by techniques:** stable_raster_irq, sprite_expand, sprite_y_stretch_glitch

### Symptom

A sprite that is supposed to switch from Y-expanded to normal height
mid-frame, while it is still in the display area, is occasionally the wrong
length: it comes out of the switch with its rows out of order and ends many
lines lower than it should — the "sprite crunch". The fault depends on the
exact cycle the $D017 write lands on within the raster line, so it comes and
goes with IRQ jitter: at almost every cycle position the switch is clean
(the sprite simply continues unexpanded from its current row), and at one
cycle position it crunches. An earlier version of this section described a
one-line artifact — a single repeated or skipped row at the line of the
write — on every mid-sprite write. Measured in VICE x64sc 3.10 PAL, no such
artifact exists: a clear at 62 of 64 cycle positions gave a clean switch
with no repeated or skipped row, and the remaining 2 positions gave the
crunch (a +21-line change, rows re-fetched out of order). A sentence here
about a subtler "half-pixel shift" on the 8565 was removed as unverifiable
on this machine (VICE was run as a 6569 only).

### Mechanism

The VIC-II implements Y expansion with a per-sprite expansion flip-flop
(the "advance line" / expansion flip-flop of Bauer's VIC-II article;
`exp_flop` in the VICE source). While the sprite's $D017 bit is clear the
flip-flop is held set; while the bit is set and the sprite's DMA is on, it
is inverted once per line (Bauer places this in cycle 55; VICE 3.10's PAL
cycle table, as read for `sprite_y_stretch_glitch` in
`docs/techniques/sprite.md`, at cycle 56). In cycle 16 of the following
line the 6-bit sprite data counter base MCBASE is loaded from the data
counter MC — moving the sprite on to its next 3-byte row — only if the
flip-flop is set; otherwise MCBASE is left alone and the same row is
fetched again. MCBASE is a counter, not the toggle; neither it nor the
flip-flop appears in the Programmer's Reference Guide. (An earlier version
of this paragraph called the toggle itself "MCBASE".)

A $D017 clear that lands anywhere else in the line does nothing worse than
set the flip-flop: from the next cycle-16 step the sprite advances a row
every line and finishes as a plain unexpanded sprite from its current row.
The problem is one cycle only. If the clear lands on cycle 15 (VICE 3.10's
PAL cycle table) of one of the sprite's display lines after the first —
immediately before the cycle-16 MCBASE step — the chip does not handle the
transition cleanly and MCBASE is loaded with a blend of its old value and
MC rather than either; the sprite's remaining length changes once, by a
data-dependent amount, and the rows come out of order. This is the "sprite
crunch" that `sprite_y_stretch_glitch` exploits deliberately; here it is an
accidental side effect of an otherwise normal register update. Which line
the write must land on is characterised in that technique entry (it
measured the second display line of a sprite at Y=100); in the
verification of this entry the crunching clear was pinned to raster line
169 for a Y-expanded sprite at Y=150, a line on which the expanded sprite
would otherwise have repeated its row. State the cycle; whether the line
is one on which MCBASE advances has not been measured and is not claimed.

### Fix

The fix is to control *where in the line* the single $D017 write lands, not
to write the register twice. Fire a stable raster IRQ on the target line and
issue one `sta $D017` at a known cycle position that is not the crunch
cycle; anywhere on the sprite's first display line, or on a line before the
sprite starts, is also safe. A second write does not help: an earlier
version of this entry prescribed a "double-write trick" — two back-to-back
STAs to "resynchronize" the toggle — and said a single write produced a
one-line repeated or skipped row. A 64-position single-vs-double sweep in
VICE x64sc 3.10 PAL (a clear of one sprite's bit at every cycle position of
a display line, once as `sta $D017 / nop / nop` and once as
`sta $D017 / sta $D017` at the identical first-write cycle) found the two
identical at every position, including the crunch cycle, where the double
write produced byte-for-byte the same crunch. The earlier text also said
the second write came "one CPU cycle later"; two consecutive `sta $D017`
instructions in fact write four cycles apart (STA abs is 4 cycles and the
write is its last cycle), well past the cycle-16 step it would have needed
to influence. Do not reach for a read-modify-write (`inc`/`dec`/`asl
$D017`) to get consecutive-cycle writes either: an RMW does write twice on
consecutive cycles, but its first write is the old register value.

If the sprite's Y expand state only needs to change between frames (not
mid-frame), the simplest moment is during vertical blank, before the
sprite's Y position comes into view: the sprite's DMA is off, so the
expansion flip-flop is held set and the crunch cycle cannot be hit.

### Worked example

The following KickAssembler snippet fires a stable raster IRQ one line
above the sprite's current top edge, then issues a single write to flip
sprite 3's Y-expand bit off cleanly. On that line the sprite's DMA has not
started, so the write cannot land on the crunch cycle. (An earlier version
of this listing wrote $D017 twice; the second write changed nothing in a
64-position VICE sweep and has been removed.)

```kickassembler
// Stable raster IRQ fires at rasterTarget (one line above sprite top)
// SP3_Y is the sprite's current Y position; IRQ fires at SP3_Y - 1

irq_clear_yexpand:
    pha
    txa
    pha

    lda #$01
    sta $D019            // acknowledge VIC raster IRQ

    // Single write: clear bit 3 of $D017 (sprite 3 Y-expand off)
    lda #%11110111       // new value: sprite 3 bit clear, others unchanged
    sta $D017            // one write is enough; the flip-flop is held set from here

    // Re-arm IRQ for next occurrence
    lda #<nextIrqLine
    sta $D012

    pla
    tax
    pla
    rti
```

If the target is to toggle expansion *on* (set the bit) rather than off,
the same single write applies with the appropriate mask. Only the *clear*
transition was swept for the crunch in the verification above; setting the
bit mid-sprite was not measured here and is not claimed to be safe at every
cycle.

For situations where multiple sprites need simultaneous Y-expand state
changes, include all sprite bits in the mask value and issue the one write.
A single STA covering all eight sprites is sufficient; one write per sprite
is wasteful and risks introducing timing skew between sprites. (An earlier
version of these two paragraphs said both transitions "require the
double-write"; see the Fix above for the measurement that retired it.)

### Cross-references

- Technique: `stable_raster_irq` — prerequisite for placing the $D017
  write at a known horizontal cycle position, away from the crunch cycle
- Technique: `sprite_y_stretch_glitch` — the intentional exploitation of
  the same expansion flip-flop / MCBASE-load quirk to produce tall sprites
- Register: `D017` — sprite Y-expand control register

---

## sprite_x_high_bit_wrong_register — Sprite teleports to far left when X crosses 255 because $D010 MSB is not updated

**Severity:** medium
**Region:** both
**Triggered by registers:** D010
**Triggered by techniques:** sprite_sine_chain, sprite_multiplex_24, logic_rate_decoupling, sprite_multiplex_game, actor_activation_window, per_frame_hitbox, wave_director

### Symptom

A sprite moving smoothly from left to right across the screen suddenly
teleports from near the right edge back to the far left when its X
coordinate crosses 256. The motion is otherwise smooth in both the
sub-256 and the 256+ ranges. The jump happens exactly at the X=256
boundary and reverses at the same boundary when moving right-to-left.
In a game this manifests as an enemy or projectile that vanishes off
the right side of the screen and reappears at the left at the same Y
position — as if the coordinate space wraps at 256.

### Mechanism

The VIC-II uses a 9-bit X coordinate for each sprite. The low 8 bits live
in the per-sprite register at `$D000 + sprite * 2` (sprite 0 → $D000,
sprite 1 → $D002, ..., sprite 7 → $D00E). The 9th bit — the MSB —
does not live in those per-sprite registers. All eight MSBs are packed
into a single shared register: **$D010 (MSIGX)**. Bit 0 of $D010 is the
MSB for sprite 0, bit 1 for sprite 1, and so on through bit 7 for sprite 7.

The common mistake is to maintain a 9-bit (or 16-bit) X variable in game
code but write only the low 8 bits to `$D000 + sprite * 2`, forgetting
$D010 entirely. When X < 256 this is invisible — the MSB is 0 and $D010's
corresponding bit is already 0 (or was never set). When X reaches 256, the
low 8 bits wrap to 0 and the hardware X coordinate becomes 0 with the MSB
still clear — the sprite teleports to X=0 on screen. Setting the MSB in
$D010 when X ≥ 256 would place the sprite correctly at the screen position
corresponding to the full 9-bit value, but the write never happens.

Sprite X is a 9-bit coordinate, 0-511, in the VIC-II's own pixel space. The
320-pixel display window spans X=24..343 (X=31..334 with CSEL=0); X=0 is 24
pixels into the left border, so a sprite needs X ≥ 24 to be fully inside
the window, and the right-hand 88 pixels of the window (X=256..343) are
reachable only with the $D010 bit set. A sprite at X=256 therefore sits
about 232 pixels from the window's left edge and is fully visible; it is
still fully visible at X=320 (occupying 320..343), begins to be covered by
the right border from X=321, and is entirely hidden in the border from
X=344 (measured in VICE x64sc: X=256 renders at VIC X 256..279, screenshot
x 264-287). Note the helper below already assumes this range (0-343). An
earlier version of this paragraph put X=0 at the window's left edge and
X=256 "slightly past the right edge", with X=256..344 clipped; both were
wrong.

### Fix

Always update $D010 when moving any sprite across the X=256 boundary. The
correct pattern is a read-modify-write: read the current $D010 value, set
or clear the bit corresponding to the sprite being moved, then write the
modified value back. Never assume $D010 is 0 — other sprites in the same
frame may have their MSB bits set.

In C (Oscar64), a helper macro handles the 9-bit write atomically:

```c
// Set sprite n to 9-bit X position xpos (0-343)
static inline void sprite_set_x(uint8_t n, uint16_t xpos) {
    *(volatile uint8_t*)(0xD000 + n * 2) = (uint8_t)xpos;  // low 8 bits
    if (xpos >= 256)
        *(volatile uint8_t*)0xD010 |= (1 << n);             // set MSB
    else
        *(volatile uint8_t*)0xD010 &= ~(1 << n);            // clear MSB
}
```

In KickAssembler, a macro that operates on a 16-bit X variable stored
in zero page:

```kickassembler
// spriteSetX: set hardware sprite .sprNum to 9-bit X in .xLo / .xHi (0 or 1)
// .sprNum = sprite index 0-7 (literal)
// xLo = zero-page address of low byte, xHi = adjacent high byte (0 or 1)
.macro spriteSetX(sprNum, xLo, xHi) {
    lda xLo
    sta $D000 + sprNum * 2       // write low 8 bits

    lda xHi                      // high byte is 0 or 1 (only bit 0 relevant)
    beq !setMsbZero+             // if 0, clear the MSB bit

    lda $D010
    ora #(1 << sprNum)           // set MSB bit for this sprite
    sta $D010
    jmp !done+

!setMsbZero:
    lda $D010
    and #~(1 << sprNum)          // clear MSB bit for this sprite
    sta $D010

!done:
}
```

For multiplexed sprites that reassign hardware channels mid-frame, rebuild
the entire $D010 byte during each IRQ handler pass — accumulate the MSB
bits for all eight currently-assigned logical sprites and write the combined
mask once. This avoids stale MSB bits from the previous hardware assignment
lingering in $D010.

### Cross-references

- Register: `D010` — MSIGX, the sprite X position MSB register
- Registers: `D000`–`D00E` — per-sprite X position low bytes
- Technique: `sprite_multiplex_24` — shows `vspr_update()` accumulating
  `xymask` ($D010) across all reuse passes
- Pitfall: `sprite_dma_overflow` — a related issue when more than 8 sprites
  share a raster line

---

## sprite_priority_collision_silent — Collision events vanish because $D01E/$D01F are read-to-clear and the read happens too late

**Severity:** medium
**Region:** both
**Triggered by registers:** D01E, D01F, D019
**Triggered by techniques:** sprite_collision_detect, mob_priority

### Symptom

The game's collision detection misses hits that visually occurred. Two
sprites clearly overlapped on screen but the game did not react — the
enemy was not destroyed, the player did not take damage. The bug is
intermittent: most collisions register correctly, but some are silently
lost, especially during busy frames with many simultaneous overlaps or
when the game logic runs late in the frame. Occasionally the reverse
happens: a collision is detected a frame after the visual overlap, making
the response feel one frame delayed.

A related symptom appears when the programmer reads $D01E or $D01F in an
interrupt handler and also checks it in the main loop — the main-loop check
always sees zero because the interrupt already cleared the register.

### Mechanism

$D01E (SPSPCL — sprite-to-sprite collision) and $D01F (SPBGCL —
sprite-to-background collision) are latched registers. The VIC-II sets
individual bits during raster rendering as collisions are detected in
hardware. Each bit, once set, stays set until the CPU reads the register.
The act of reading the register — any read, from any address mode, at any
privilege level — clears all bits in that register simultaneously. This
is the "read-to-clear" mechanic.

The latching behavior means that collisions accumulate: if sprite 0 hits
sprite 3 on line 80 and sprite 0 hits sprite 5 on line 120, by the time
the CPU reads $D01E at the end of the frame, bit 0, bit 3, and bit 5 are
all set (sprite 5's bit is set too, since both sprites involved in each
collision have their bits latched). A single read at any point after line
80 captures all of this correctly — provided nothing else read $D01E first.

Two patterns cause silent losses:

**Double-read:** An interrupt handler reads $D01E to check for a collision.
This clears the register. Later, the main loop reads $D01E again — it sees
zero. The collision events from that frame are gone. This is especially
common when a VIC IRQ is used to detect collisions in the IRQ handler and
the main loop independently polls the same register.

**Late read with prior clear:** If any code path reads $D01E or $D01F as a
side effect (even a "harmless" diagnostic read, or a read inside a debugger
print routine), that read destroys the accumulated collision state. A
diagnostic that works fine on its own can suppress collision detection when
enabled.

A second, subtler issue: the registers report *which sprites* were involved
in collisions, not *which specific pair*. If sprites A, B, and C all
overlap each other, bits for A, B, and C are all set, but the register
gives no information about which pairs actually touched. Games that need
pair-level resolution must infer it from the bit pattern combined with
spatial reasoning.

### Fix

**Establish a single read point per frame.** Read $D01E and $D01F exactly
once per frame — at the start of the game loop, before any other code can
inadvertently read them — and immediately store both values in RAM variables.
All collision processing for that frame operates on the cached values.
Never read $D01E or $D01F a second time in the same frame.

The safest place is at the very start of the frame, in the vertical blank
handler or as the first action of the main game loop body after the
`rirq_wait()` call:

```kickassembler
frameStart:
    lda $D01E           // read sprite-sprite collision register...
    sta spSprColl       // ...and cache it immediately; register is now clear
    lda $D01F           // read sprite-background collision register...
    sta spBgColl        // ...cache it; register is now clear

    // All collision tests this frame use spSprColl and spBgColl, not $D01E/$D01F
```

**For per-line IRQ-driven collision response:** Enable the collision IRQ via
$D01A bit 2 (EMMC, sprite-sprite) and bit 1 (EMBC, sprite-background) — the
same layout as $D019. (An earlier version of this sentence had the two bits
swapped.) The VIC fires an
IRQ on the same line the collision is latched. Inside the IRQ handler, read
$D019 first to identify the interrupt source (bit 2 = sprite-sprite, bit
1 = sprite-background), then read $D01E or $D01F as appropriate. Acknowledge
with a write-1-to-clear to the matching bit of $D019. This gives sub-frame
collision timing but requires careful separation from any main-loop reads.

```kickassembler
// IRQ handler that distinguishes collision type via $D019
irq_collision:
    pha
    lda $D019           // read VIC interrupt status register
    and #%00000110      // mask: bit 2 = sprite-sprite, bit 1 = sprite-bg
    beq !notCollision+  // if neither bit set, not a collision IRQ

    tax                 // save interrupt cause
    lda $D01E
    sta spSprColl       // cache sprite-sprite result (clears $D01E)
    lda $D01F
    sta spBgColl        // cache sprite-background result (clears $D01F)

    txa
    sta $D019           // acknowledge: write-1-to-clear the same bits

!notCollision:
    pla
    rti
```

**Do not read $D01E or $D01F in diagnostic or logging code** without
understanding that every such read is destructive. During development,
gate diagnostic reads behind a flag or read them only in a context where
the cached variable is immediately populated.

### Cross-references

- Register: `D01E` — SPSPCL, sprite-to-sprite collision latch (read-to-clear)
- Register: `D01F` — SPBGCL, sprite-to-background collision latch (read-to-clear)
- Register: `D019` — VICIRQ, VIC interrupt status / acknowledge register
- Technique: `sprite_collision_detect` — the correct polling pattern and
  single-read-per-frame discipline
- Technique: `stable_raster_irq` — prerequisite for cycle-exact IRQ-driven
  collision response

---

## sprite_x_range_hidden_and_seam — A sprite at X below 24 or above 343 sits under the border while the game counts it alive, and on PAL X $1F8 to $1FF is never drawn at all

**Severity:** medium
**Region:** both
**Triggered by registers:** D000, D010
**Triggered by techniques:** object_pool, tile_grid_collision, sprite_multiplex_8, sprite_multiplex_24, sideborder_open

### Symptom

Two faces of one fact.

The HUD says three enemies are alive and the player sees two. A shot
fired at the edge of the screen never lands and never stops. The object
is there in every table the game keeps, its sprite is enabled, its
collision bit fires when something walks into it, and nobody can see it,
because its X is 10, or 350, and the border is drawn over it. A game
built blind, with the counts checked and the picture not looked at, ships
this.

The other face needs the side borders open. A sprite sliding left off
the picture, its X stepping down from $1E0 through $1FF and on to $20F
(which the chip sees as $00F), blinks out for eight steps and comes back.
On NTSC it does not blink.

### Mechanism

Sprite X is nine bits, 0 to 511: eight in `$D000 + 2n`, the ninth in
`$D010`. Nothing in the chip clips that range to the picture. The
display window is X 24 to 343 with CSEL = 1 (31 to 334 with CSEL = 0),
and the border is the front-most layer, drawn over any sprite pixel that
falls outside the window (`mob_priority` in `techniques/sprite.md`). A
sprite at X 0 to 23 is partly or wholly under the left border; at 321 to
343 partly and from 344 wholly under the right one. The sprite still
exists to the VIC-II: its DMA runs every line (the stall in
`recipes/kickassembler/sideborder-open.md` depends on sprites at X 344
and 500 fetching on every line) and its position registers read back.
Only the pixels are missing. Whether `$D01E` still latches a
sprite-to-sprite hit under the border was not measured here; `$D01F`
does not, since border pixels are not foreground (`mob_priority`).

The seam is a different thing. A PAL line is 63 cycles of 8 pixels, 504
positions, so the VIC-II's X counter runs 0 to $1F7 and wraps. The nine
bits can hold $1F8 to $1FF, but the counter never reaches those values,
so a sprite placed there never matches and is not drawn on any line.
Measured in VICE x64sc with the side borders open: X 503 ($1F7) draws
at picture columns 7 to 30, wrapping from the right end of the line to
the left in the middle of the sprite; X 504, 507 and 511 draw nothing;
X 0 draws at columns 8 to 31. Position $1F7 and position 0 are
neighbours, and the eight values between them are a hole. A 16-bit game
coordinate that steps through them one a frame loses the sprite for
eight frames; one that steps by 8 or more may skip the hole on one
frame and fall into it on another.

An NTSC line is 65 cycles, 520 positions (arithmetic; the cycle count
is `hardware/vic-ii-reference.md`'s). Measured in VICE x64sc with
`-model ntsc` and the borders open: every value from 488 to 511 draws,
X 511 sits at columns 7 to 30 and X 0 at 8 to 31, so $1FF and 0 are
neighbours and there is no hole in $1E0 to $20F. Where the line's eight
positions beyond 512 fall is not visible in the picture and was not
measured here.

The picture VICE writes starts at column 0 = X 496 on PAL and X 504 on
NTSC, and column 8 = X 0 on both, so a sprite at $1E0 (480) shows its
last eight columns on PAL (columns 0 to 7) and nothing on NTSC, not
because it is hidden but because it is left of the picture's edge.

### Fix

Keep the visibility test in the game, not in the chip. An object is on
screen only while 24 <= X <= 343 (fully so up to 320); with CSEL = 0,
31 <= X <= 334. Everything else is off screen for scoring, counting and
collision, whatever `$D015` says. Either despawn it (free the pool slot,
so the count and the picture agree) or clamp it (a player sprite stops
at 24 and 320). For X in the 256 to 343 range the test needs the ninth
bit; see `sprite_x_high_bit_wrong_register` above for getting it into
`$D010`.

With the side borders open on PAL, never write an X in $1F8 to $1FF.
Wrap the coordinate at 504, not 512: a sprite leaving to the left at
$1F7 continues at $1F7 - 504 = -1, that is, at the far right, and a
table-driven position should be built modulo 504. On NTSC the wrap is
at 512 within the range measured; a routine that has to run on both
picks the modulus from the model at start-up.

### Worked example

The bad pattern is a count over pool slots whose state is not zero,
with no test on X. The fix is a nine-bit range test and a despawn:

```kickassembler
// objX, objX+1: the 16-bit X the game keeps for one object; objState: 0 = free.
// The HUD counts every slot whose objState is not 0.
// Wrong: an object at X 10 or X 400 is alive to that count and under the
// border to the player. Right: an object counts only while 24 <= X <= 343.
.label objX     = $02
.label objState = $04
.const X_LEFT   = 24
.const X_RIGHT  = 343

on_screen:                       // returns C = 1 on screen, C = 0 hidden
    lda objX + 1
    bne high_page
    lda objX
    cmp #X_LEFT                  // 0..23 hidden, 24..255 on screen
    bcs yes
    clc
    rts
high_page:
    cmp #1
    bne no                       // 512 and up does not exist on the chip
    lda objX
    cmp #<(X_RIGHT + 1)          // 256..343 on screen, 344..511 hidden
    bcc yes
no:
    clc
    rts
yes:
    sec
    rts

despawn_if_hidden:
    jsr on_screen
    bcs keep
    lda #0
    sta objState                 // freed: the HUD no longer counts it
keep:
    rts
```

The measurements behind the numbers above came from one KickAssembler
program run in VICE x64sc 3.10 (`-default -warp -limitcycles 6000000`,
PAL and `-model ntsc`), eight solid 24 x 21 sprites in distinct colours
on a blue background under a black border, X values passed on the
command line, columns read from the exit screenshot with PIL. Two
arrangements: borders closed, one sprite per row at eight X values; and
borders open over a 42-line region by the method of
`recipes/kickassembler/sideborder-open.md` (all eight sprites Y-expanded
on the region, a `DEC $D016` whose second write lands on the cycle
between the two border comparisons, a `YSCROLL` rewrite each line), with
sprite 0 at the value under test and the other seven parked in the
window and at X 344. The PAL constants were the recipe's; on NTSC the
loop opened the border with two more cycles before the first `DEC` and
one more in the loop, which is a by-product and not a claim about the
cycle number. Column 8 of the picture is X 0.

Borders closed, both models, identical columns:

| X | Drawn | Picture columns |
|---|---|---|
| 0 | no | none |
| 23 | 23 of 24 columns | 32 to 54 |
| 24 | all | 32 to 55 |
| 320 | all | 328 to 351 |
| 321 | 23 of 24 | 329 to 351 |
| 343 | 1 of 24 | 351 |
| 344 | no | none |
| 511 | no | none |

Borders open, sprite 0 at the seam:

| X | PAL columns | NTSC columns |
|---|---|---|
| $1E0 (480) | 0 to 7 | none (left of the picture) |
| $1E8 (488) | not run | 0 to 7 |
| $1EF (495) | 0 to 22 | 0 to 14 |
| $1F0 (496) | 0 to 23 | 0 to 15 |
| $1F4 (500) | 4 to 27 (the side-border recipe's own picture) | 0 to 19 |
| $1F7 (503) | 7 to 30 | 0 to 22 |
| $1F8 (504) | none | 0 to 23 |
| $1FB (507) | none | 3 to 26 |
| $1FC (508) | not run | 4 to 27 |
| $1FF (511) | none | 7 to 30 |
| $200 (0) | 8 to 31 | 8 to 31 |
| $208 (8) | 16 to 39 | 16 to 39 |
| $20F (15) | 23 to 46 | 23 to 46 |

### Cross-references

- Registers: `D000` to `D00E` and `D010`: the nine-bit X the range test
  reads
- Register: `D016`: CSEL narrows the window to 31 to 334
- Pitfall: `sprite_x_high_bit_wrong_register`: the ninth bit the test
  above depends on
- Technique: `sideborder_open`: the only way a sprite at X 0 to 23 or
  344 up is seen, and the only case in which the PAL hole shows
- Technique: `mob_priority`: the border is drawn over every sprite; a
  sprite under it latches no `$D01F` hit
- Technique: `object_pool`: the slot state the HUD counts, and where the
  despawn belongs
- Technique: `tile_grid_collision`: its column is `(x - 24) >> 3`, which
  goes negative for a sprite under the left border
- Recipe: `recipes/kickassembler/sideborder-open.md`: the region loop
  the measurement reused, with a sprite at X 500 in its picture
- Recipe: `recipes/kickassembler/sprite-sine-chain.md`: X 343 showing
  one column, X 16 starting at column 32
