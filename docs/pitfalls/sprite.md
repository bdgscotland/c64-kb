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
teleportation when the 9th X bit is forgotten, and collisions that vanish
before the CPU can read them. All four have bitten experienced C64 coders.

---

## sprite_dma_overflow — More than 8 active sprites on one raster line silently drops the higher-indexed ones

**Severity:** critical
**Region:** both
**Triggered by registers:** D015, D010, D000, D001
**Triggered by techniques:** sprite_multiplex_8, stable_raster_irq

### Symptom

A multiplexed sprite engine that is supposed to show twelve, sixteen, or
more objects on screen displays only the first eight on any given raster
line. The higher-indexed logical sprites silently disappear on lines where
they compete with the lower-indexed group. There is no visible corruption
or tearing — sprites simply are not drawn, as if they were never enabled.
The bug is easy to miss when objects are spread vertically because each
frame only a few lines have more than eight sprites active simultaneously.
The effect becomes obvious when objects cluster near the same Y coordinate:
a game with many bullets or enemies at the same height suddenly loses half
its sprites.

### Mechanism

The VIC-II has exactly eight sprite DMA channels — one per sprite index
(0 through 7). On each raster line the chip walks through sprite indices
0 to 7 in order, checks whether each sprite's Y register matches the
current raster line (within the 21-line active window), and, if so,
fetches that sprite's 63-byte bitmap data via the s-access cycles for that
channel. There are no additional DMA channels hiding behind software flags.
The hardware simply has eight slots, and eight is the absolute maximum
simultaneously active sprites per raster line.

A multiplexer that repositions sprites by writing new Y coordinates between
groups relies on the VIC not seeing two logical sprites at the same Y at
the same time. If the IRQ fires too late — or if the sort fails to separate
two groups by at least one line — the chip sees nine or more enabled sprite
indices all claiming to be active on the same line. It still only fetches
data for indices 0-7. Indices with no available channel are ignored without
error, without a flag, and without any signal visible to the programmer.

Because the chip walks indices in ascending order, the overflow always
discards the highest-indexed sprites on the contested line. Sprite 0 always
wins; sprite 7 is always the first casualty.

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

Critical invariant: every element of `logicY[8..15]` must be at least 22
lines below every element of `logicY[0..7]` that uses the same hardware
slot. If that gap is violated, the old sprite's DMA is still active when
the new one tries to start, and one of them is silently dropped.

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

## sprite_y_expand_double_register_write — Changing Y-expand mid-display requires a double $D017 write or scan-line artifacts appear

**Severity:** high
**Region:** both
**Triggered by registers:** D017
**Triggered by techniques:** stable_raster_irq

### Symptom

A sprite that is supposed to switch between normal and Y-expanded height
mid-frame (or at the start of a new frame while the sprite is still in the
display area) shows a single corrupted scanline at the point of transition.
The artifact looks like a repeated row or a skipped row — the sprite bitmap
shifts out of alignment at the moment the expansion bit is toggled. The
glitch is one line tall, repeatable every frame, and does not move with the
sprite's Y position: it appears at the specific raster line where the
register write landed, regardless of the sprite's logical position.

On some chip revisions (especially the 8565 HMOS-II) the glitch is subtler
— a faint half-pixel shift rather than a full row repeat — but it is still
present and still caused by the same internal latch desynchronization.

### Mechanism

The VIC-II implements Y expansion via an internal per-sprite expansion
toggle called MCBASE in the chip's state machine (documented in Christian
Bauer's VIC-II article and visible in the VICE emulator source). On each
raster line where a sprite is active, the chip consults its $D017 bit for
that sprite. If the bit is set (Y-expand enabled), the chip toggles the
MCBASE flag instead of incrementing the sprite's internal row counter — so
each logical row of the bitmap is displayed on two physical raster lines.
If the bit is clear, the row counter increments normally every line.

The problem arises when the CPU writes $D017 while the sprite is mid-render
and the chip's MCBASE toggle is in its "second half" state. At that
moment, the chip has already decided whether to increment the row counter
for the current line based on the previous value of $D017. A single write
that arrives in the wrong half of the toggle cycle leaves MCBASE in an
inconsistent state for exactly one line — the chip either repeats a row
(if the toggle was suppressed) or skips one (if it fired twice before the
write landed). The artifact is one line high.

The same mechanism produces the intentional "sprite crunch" effect
(`sprite_y_stretch_glitch`) when exploited deliberately. Here it is an
accidental side effect of an otherwise normal register update.

### Fix

The fix is the "double-write trick": write $D017 twice in rapid succession,
with the sprite's bit in the desired new state for both writes. The first
write forces the chip's input latch to the new value. The second write,
issued one CPU cycle later, ensures the latch has settled through both
halves of the internal toggle before the chip makes its next row-counter
decision. The pair of writes resynchronizes the MCBASE state machine
regardless of which half-cycle it was in when the first write arrived.

The double write must be issued at a known horizontal position within the
raster line. Using a stable raster IRQ to fire exactly at the start of the
target line, then issuing the two STA instructions without any intervening
cycles, satisfies the requirement. The window for the writes is
approximately two consecutive CPU cycles; spacing them further apart (e.g.,
with an intervening LDA) risks catching a toggle event between the two
writes, which negates the fix.

If the sprite's Y expand state only needs to change between frames (not
mid-frame), the safest moment is during vertical blank, before the sprite's
Y position comes into view. No double-write is needed there because the
chip is not in mid-render for that sprite and MCBASE is in its reset state.

### Worked example

The following KickAssembler snippet fires a stable raster IRQ one line
above the sprite's current top edge, then issues the double-write to flip
sprite 3's Y-expand bit off cleanly.

```kickassembler
// Stable raster IRQ fires at rasterTarget (one line above sprite top)
// SP3_Y is the sprite's current Y position; IRQ fires at SP3_Y - 1

irq_clear_yexpand:
    pha
    txa
    pha

    lda #$01
    sta $D019            // acknowledge VIC raster IRQ

    // Double-write: clear bit 3 of $D017 (sprite 3 Y-expand off)
    lda #%11110111       // new value: sprite 3 bit clear, others unchanged
    sta $D017            // first write — forces latch to new value
    sta $D017            // second write (next cycle) — settles MCBASE state

    // Re-arm IRQ for next occurrence
    lda #<nextIrqLine
    sta $D012

    pla
    tax
    pla
    rti
```

If the target is to toggle expansion *on* (set the bit) rather than off,
the same double-write pattern applies with the appropriate mask. The chip
does not distinguish between enable and disable transitions — both require
the double-write to avoid the single-line artifact.

For situations where multiple sprites need simultaneous Y-expand state
changes, include all sprite bits in the mask value and issue the same
double-write pair once. A single pair of STAs covering all eight sprites
is sufficient; one pair per sprite is wasteful and risks introducing
timing skew between sprites.

### Cross-references

- Technique: `stable_raster_irq` — prerequisite for placing the double-write
  at the correct horizontal cycle position
- Technique: `sprite_y_stretch_glitch` — the intentional exploitation of
  the same MCBASE state-machine quirk to produce tall sprites
- Register: `D017` — sprite Y-expand control register

---

## sprite_x_high_bit_wrong_register — Sprite teleports to far left when X crosses 255 because $D010 MSB is not updated

**Severity:** medium
**Region:** both
**Triggered by registers:** D010

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

The VIC-II coordinate space maps X=0 to the first dot-clock of the visible
area boundary (approximately column 24 in the default display window,
though exact positioning depends on the display edge). X=256 (9-bit value
`%1_00000000`) is 256 dot-clocks into the visible area and corresponds
roughly to column 280 on a PAL screen — slightly past the right edge of
the 320-pixel-wide visible window. Sprites positioned at X=256 to X=344 are
partially or fully clipped at the right border.

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
$D01A bits 1 (sprite-sprite) and 2 (sprite-background). The VIC fires an
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
