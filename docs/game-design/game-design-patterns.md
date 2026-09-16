<!-- doc-type: reference -->

# C64 Game Design Patterns

Recurring mechanical patterns that C64 games use, described so that an AI
agent can match the right pattern to a brief. Each section names the
tradeoffs in C64 terms — cycle budgets, RAM budgets, and hardware
constraints — so the choice is mechanical, not aesthetic.

Cross-references: `../techniques/sprite.md` for multiplexer mechanics and
hardware sprite capabilities; `../techniques/scroll.md` for soft-scroll and
parallax; `./c64-game-archetypes.md` for which archetype pairs with which
patterns.

---

## Collision systems

Collision is the most expensive per-frame logic in an action game. C64
games use up to four distinct systems, sometimes in combination.

---

### Hardware sprite-sprite collision

Register $D01E reads back a bitmask of which sprites have overlapped
another sprite during the last frame. Reading the register clears it. The
chip sets bits automatically with zero CPU cost.

Constraints:

- **Lossy.** Only one bit per sprite pair; no record of which pair or when.
  If two separate collisions involve the same sprite in one frame, the
  register cannot distinguish them.
- **Position-after-the-fact.** The register reflects the state at read time,
  not at the frame-render cycle where the pixels overlapped. If you read at
  the top of the game loop, the collision happened somewhere in the previous
  frame.
- **Multiplexed sprites break it.** When a hardware sprite is reused to
  represent two logical actors via a multiplexer, $D01E reports hardware
  sprite collisions, not logical actor collisions. A read after the first
  multiplex band clears the register before the second band fires.

Use $D01E for: shmups where the player sprite never multiplexes and enemy
bullets are always in a known hardware sprite slot. The lossy single-bit
result is acceptable because any hit in the frame ends the player life
regardless of which bullet caused it.

```asm
    lda $D01E        ; read and clear sprite-sprite register
    and #%00000001   ; test bit 0 (player sprite)
    bne .hit         ; branch if player overlapped any sprite
```

---

### Hardware sprite-background collision

Register $D01F records which sprites overlapped a non-zero (non-space)
foreground character cell during rendering. Same single-bit-per-sprite
design, same read-clears semantics.

Constraints: identical to $D01E plus one more — the collision fires on
any foreground pixel, including decorative tiles. If your map has purely
decorative "solid-looking" character cells that are not walls, you must
arrange the character set so decorative tiles appear as background-colored
pixels at the ROM/RAM level (multicolor tricks) or use a separate solid
map and ignore $D01F entirely.

Use $D01F for: shmups where the terrain is a single-color foreground
charset and any contact with it is fatal or obstructing.

---

### Software bounding-box collision

Compare each actor's X, Y extents against every other actor's extents in
pure 6510 arithmetic. Typical cost is 28–35 cycles per pair.

```asm
; Actor A at (ax, ay), width aw, height ah
; Actor B at (bx, by), width bw, height bh
; Returns carry set on overlap

.check_bbox:
    lda ax
    clc
    adc aw
    cmp bx          ; A_right < B_left?
    bcc .no_hit
    lda bx
    clc
    adc bw
    cmp ax          ; B_right < A_left?
    bcc .no_hit
    lda ay
    clc
    adc ah
    cmp by          ; A_bottom < B_top?
    bcc .no_hit
    lda by
    clc
    adc bh
    cmp ay          ; B_bottom < A_top?
    bcc .no_hit
    sec             ; overlap
    rts
.no_hit:
    clc
    rts
```

At 8 actors, that is 28 pair-checks worst case (n*(n-1)/2). At 35 cycles
per check, 28 pairs cost ~980 cycles — under 1 % of a PAL frame. At 16
actors the cost is ~3920 cycles, still well within budget if bounded-box
is the only collision layer.

Use software bounding-box for: platformers where you need sub-tile accuracy
for landing/hitting platforms, and for adventure games where the player
rectangle must exactly enter a doorway hitbox.

---

### Tilemap-grid collision

For terrain that never moves, test the map grid directly rather than every
possible object pair. Convert the actor's bounding corners to tile
coordinates and read the tile index from screen RAM or a parallel solid-bit
array.

```asm
; Convert pixel (px, py) to tile (tx, ty):
;   tx = px / 8    (LSR three times for 8-pixel tiles)
;   ty = py / 8    likewise
; Screen RAM address = $0400 + ty*40 + tx

.solid_check:
    lda py
    lsr
    lsr
    lsr             ; ty = py >> 3
    tax
    lda row_lo, x   ; precomputed: row_lo[ty] = ($0400 + ty*40) lo
    sta ptr
    lda row_hi, x
    sta ptr+1
    lda px
    lsr
    lsr
    lsr             ; tx = px >> 3
    tay
    lda (ptr), y    ; read tile index from screen RAM
    cmp #solid_min  ; solid tiles are >= solid_min
    bcs .is_solid
    rts
.is_solid:
    ; handle blocked movement
```

A parallel solid-bit array (one bit per tile, 125 bytes for a 40×25 grid)
avoids comparing character codes and survives charset reassignments. Allocate
it in zero page or page 2 for fast access.

Tilemap-grid collision costs 20–40 cycles per corner tested. A four-corner
player check is 80–160 cycles — negligible for one player.

Use tilemap-grid for: all games where the terrain is tile-based (platformers,
adventure games, top-down mazes). Combine with software bounding-box for
actor-actor hits and hardware registers only where the constraints above are
acceptable.

**Decision table:**

| Game type       | Primary collision           | Secondary         |
|-----------------|-----------------------------|-------------------|
| Shmup           | $D01E + $D01F               | —                 |
| Platformer      | Tilemap-grid (terrain)      | SW bbox (actors)  |
| Adventure       | Tilemap-grid only           | —                 |
| Maze/Pac-style  | Tilemap-grid                | —                 |

---

## Map representations

The right map format depends on whether the game fits on one screen,
how far it scrolls, and whether ROM or disk space is the binding constraint.

---

### Screen-aligned tilemap

When the entire playfield fits within the 40×25 character grid, screen RAM
at $0400 is the map. Color RAM at $D800 holds per-tile colors. The map is
already in the VIC-II's native format; no copy loop is needed.

Cost: 1000 bytes screen RAM + 1000 bytes color RAM = 2 KB for the visible
state. Additional pages are a direct copy-to-screen-RAM operation (1000
LDA/STA pairs, ~6000 cycles, done in the vertical blank).

Use for: single-screen games (Pac-style mazes, single-room puzzles, fixed
arena shooters).

---

### Scrolling tilemap

Horizontal or vertical scrolling games maintain a map buffer wider or taller
than the visible area. The classic layout for a horizontally scrolling game:

- Map buffer: 48 columns × 25 rows of tile indices (1200 bytes for the
  logical map slice in RAM).
- A `scroll_col_offset` byte tracks which logical column is at the left
  edge of the visible 40 columns.
- On each 8-pixel scroll step, copy the new column of tiles into screen RAM
  and color RAM, then update `scroll_col_offset`.

The soft-scroll register ($D016 XSCROLL) handles the 0–7 pixel fine phase.
When XSCROLL wraps, the column copy fires. This is the canonical
soft-scroll pattern described in `../techniques/scroll.md`.

Vertical scrolling uses $D011 YSCROLL the same way, with a row copy at the
8-pixel boundary.

RAM cost for the buffer slice: 1–2 KB depending on scroll depth. For large
worlds, the full map lives on disk or in a compressed block and is paged in
as the player approaches a boundary.

---

### Compressed maps

A 128-room dungeon at 40×25 tiles per room is 128 KB uncompressed — well
above the 64 KB address space. Compression is mandatory.

**RLE:** Consecutive identical tile runs are stored as (count, tile). A
typical C64 dungeon room compresses 3:1 to 5:1. Decoder is 20–30 bytes
of 6510 code and runs in a few hundred cycles for a single screen.

**Dictionary / token substitution:** Repeated 2×2 or 4×4 tile blocks are
assigned token IDs. The map stores tokens; the decoder expands them into
screen RAM. Achieves 8:1 or better on repeating tilesets (castle brickwork,
cave walls). Costs more decoder RAM but compresses aggressively.

For disk-based games, the decompressor runs during the load of each level.
For cartridge or single-load games, all levels must decompress from a
banked ROM into the map buffer on demand.

---

## Enemy / actor state machines

All moving non-player objects are actors. The C64 enforces an implicit actor
limit through the sprite system: eight hardware sprites per frame. Multiplexed
setups handle 16–32 logical sprites; software-rendered actors (character
graphics) can go higher but at steep cycle cost.

---

### Slot-based actor table

Allocate a fixed array of N actor slots. Each slot holds:

```
actor_x:     .byte 0   ; pixel X (0–255 or 16-bit for wide worlds)
actor_y:     .byte 0   ; pixel Y
actor_state: .byte 0   ; state machine index (0 = inactive)
actor_type:  .byte 0   ; type index (indexes into behavior tables)
actor_timer: .byte 0   ; general-purpose countdown
actor_dx:    .byte 0   ; signed velocity X
actor_dy:    .byte 0   ; signed velocity Y
```

Seven bytes per actor. Eight actors: 56 bytes. Sixteen actors: 112 bytes.
All actor arrays live in the same zero page / page 2 / $C000 block so
indexed addressing is fast.

The sprite multiplexer (see `../techniques/sprite.md`) draws the active
slots. Slots with `actor_state = 0` are skipped by both the update loop
and the multiplexer.

---

### Per-actor state byte and handler jump table

Each actor type has a jump table of state-handler addresses indexed by
`actor_state`. The game loop iterates slots, reads the type, loads the
handler pointer for the current state, and JMPs indirectly.

```asm
.update_actors:
    ldx #0
.next_slot:
    lda actor_state, x
    beq .skip              ; state 0 = inactive
    ldy actor_type, x
    lda handler_lo, y      ; handler table indexed by type
    sta jmp_ptr
    lda handler_hi, y
    sta jmp_ptr+1
    jmp (jmp_ptr)          ; handler receives X = slot index
.skip:
    inx
    cpx #MAX_ACTORS
    bne .next_slot
```

Each handler reads `actor_state, x`, branches on it to the correct
sub-handler, updates position/timer, and transitions state by writing a
new value to `actor_state, x`. Transitions to state 0 return the slot to
the free pool.

Cost: one indirect JMP per actor per frame (~6 cycles) plus the handler
body. A simple patrol enemy handler (move, wall-check, reverse) runs in
~80 cycles.

---

### Path-based vs reactive AI

**Path-based:** Actor follows a pre-baked waypoint list stored in ROM.
State byte indexes the current waypoint. On each update, move toward
waypoint[state]; when within 2 pixels, increment state to the next
waypoint; wrap at the end. Zero decision logic, predictable, suitable for
fixed patrol routes in platformers and maze games.

```asm
; Simplified path follower
.path_step:
    ldy actor_timer, x      ; timer = waypoint index
    lda waypoint_x, y
    sec
    sbc actor_x, x
    beq .match_x
    bmi .move_left
.move_right:
    inc actor_x, x
    jmp .check_y
.move_left:
    dec actor_x, x
    jmp .check_y
.match_x:
    ; advance waypoint only when X matches
    inc actor_timer, x
```

**Reactive AI:** Actor computes direction from its position to the player
each frame. Subtract player_x from actor_x to get dx; subtract player_y
from actor_y to get dy; adjust velocity by sign(dx) and sign(dy). The sign
extraction is a single BPL/BMI branch. Predictable pursuit; pair with a
short random timer that pauses the actor for variety.

Reactive AI costs ~40 cycles per actor for the subtraction and sign-branch.
Path-based costs ~20 cycles per actor. Use path-based for turrets and fixed
patrol routes; use reactive for chasers and bosses.

---

## Game loop patterns

---

### Single-buffer IRQ-driven scroll

The dominant C64 pattern. The game runs one logical screen buffer. A raster
IRQ fires at the bottom of the playfield to swap sprite pointers and perform
any split-screen HUD work. Scroll column copies happen in the vertical blank
IRQ. Everything is single-buffered: the CPU writes to screen RAM while the
VIC-II reads from it, which is safe because writes and reads contend only
during the 8 raster lines of badlines, producing at most one garbled
character per badline — the classic "scroll tear" that well-timed VBlank
copies avoid.

The frame structure:

```
VBlank IRQ fires (line 0 / line 300 PAL):
  - Copy new scroll column to screen RAM
  - Update XSCROLL / YSCROLL register
  - Update sprite positions from actor table
  - Acknowledge $D019, re-arm for HUD split

[Game logic runs in main loop during active display]

Raster IRQ fires at HUD split line:
  - Write HUD sprite data
  - Possibly change border color for debug
  - Acknowledge $D019, re-arm for next VBlank
```

The main loop processes input, advances actor states, resolves collision,
and updates score. On PAL (50 Hz) the loop has ~19 700 cycles of CPU time
per frame after IRQ overhead.

---

### Double-buffer

Two full screen RAM areas (2 KB each) alternate: the CPU draws into the
back buffer while the VIC-II displays the front buffer. At VBlank, swap
the VIC-II base address ($D018) to flip.

Memory cost: 2 KB for the second screen RAM. On a 64 KB machine this is
not free. Color RAM ($D800–$DBFF) cannot be double-buffered (only one
color RAM exists in hardware), so double-buffering only eliminates screen-
RAM tearing, not color-RAM tearing.

Use double-buffer only when the game redraws most of the screen each frame
(3D wireframe, full-screen bitmap effects) and tearing is visually
unacceptable. Standard tile-scroll games should prefer single-buffer plus
carefully timed column copies.

---

### 60 Hz vs 50 Hz update rate and cross-region releases

PAL runs at 50 frames/second; NTSC runs at ~60 frames/second. A game loop
tied to the frame rate runs 20 % faster on NTSC. Three strategies:

1. **PAL-only:** Ignore NTSC. Ship for the European market. Fastest to
   implement; widely acceptable for 1980s-style games.

2. **Dual-rate logic:** Detect region via raster line count ($D011 bit 7
   cycle comparison, or count raster lines in VBlank and compare to 312
   vs 263). Run game logic at the detected frame rate. Physics values
   (gravity, speeds) must be tuned separately per region, stored in two
   ROM tables selected at startup.

3. **Fixed-timestep decoupled from frame rate:** Run game logic at a fixed
   50 Hz tick using a CIA timer (CIA1 Timer A), fire an NMI or flag a
   semaphore, and render at the display frame rate. Correct but complex;
   the extra timer interrupt costs ~35 cycles per frame of overhead. Used
   by some later commercial titles.

For most games: PAL-only or dual-rate with two physics tables is the
practical choice. See `../hardware/pal-ntsc-reference.md` for region
detection details and the `c64_pal_ntsc_diff` tool for per-topic diffs.

---

## Memory layouts for game state

---

### The 38911-byte basic-free area

BASIC ROM occupies $A000–$BFFF. Switching it out (bit 0 of $0001) frees
8 KB for code or data but loses BASIC. All action games disable BASIC. With
BASIC and KERNAL both out ($0001 = %00110101), the full $A000–$FFFF range
(minus I/O at $D000–$DFFF) is available.

Practical RAM budget for a game without KERNAL:

```
$0002–$00FF   Zero page (254 bytes) — fast scratch, counters, pointers
$0100–$01FF   Stack (256 bytes, fixed)
$0200–$02FF   Page 2 (256 bytes) — actor tables, IRQ flag bytes
$0300–$03FF   Page 3 (256 bytes) — jump vectors; avoid overwriting $0314/$0315
$0400–$07FF   Screen RAM (1000 bytes used; 96 bytes spare)
$0800–$9FFF   ~38 KB — code, data, charset, music, level data
$A000–$BFFF   8 KB free when BASIC out — level data, extra code
$C000–$CFFF   4 KB — canonical "game state" block (see below)
$D000–$DFFF   I/O (VIC-II, SID, CIA, Color RAM) — never overwrite without banking
$E000–$FFFF   8 KB free when KERNAL out — fast data, but lose KERNAL routines
```

---

### $C000–$CFFF as the canonical game state block

The 4 KB at $C000 is above the typical code-and-data area but below the I/O
window. It is not shadowed by any ROM. Convention in C64 games:

- `$C000–$C0FF`: Current-level descriptor (tileset index, music track,
  enemy spawn table pointer, starting player position).
- `$C100–$C1FF`: Persistent game state (lives, score BCD, continues,
  unlocked levels, inventory flags).
- `$C200–$C2FF`: Per-frame scratch (collision result bits, input debounce
  state, IRQ semaphores).
- `$C300–$CFFF`: Overflow for large actor tables or a secondary map buffer
  when the main buffer at $0800 is insufficient.

This layout is a convention, not a hardware requirement. Its value is that
the MCP tools in this KB assume it when generating code, so briefings and
recipes stay consistent.

---

### Save state mechanisms

The C64 has no battery-backed RAM in stock hardware. Three historical
approaches:

**None.** Most arcade-style games. Progress resets on power-off. The entire
game fits in one session. Simplest; zero save-system code.

**Cassette write.** Use the KERNAL `SAVE` routine (or direct serial/tape
protocol) to write the $C100–$C1FF persistent state block to cassette.
Load it back with `LOAD`. Cassette save of 256 bytes takes ~10 seconds on
a stock 1530 datasette. Acceptable for turn-based or RPG games where the
player expects a save ritual.

**Disk write.** Open a sequential or relative file on the 1541 via the
KERNAL `OPEN`/`PRINT#`/`CLOSE` sequence and write the persistent state
block. A 256-byte block writes in under 1 second. Disk save is the standard
for C64 RPGs and adventure games. Requires the KERNAL to remain available
(do not page it out) during the save, or rebank it in for the save routine.

---

## Scoring, lives, and HUD

---

### HUD via raster-IRQ split

The HUD (score, lives, timer) is most commonly placed above or below the
playfield using a raster-IRQ color and charset switch. The playfield
uses one charset; at the HUD split line the IRQ switches $D018 to point
to a second charset block where the score digits are custom-drawn,
restoring the playfield charset on the line where the playfield resumes.

Top-of-screen HUD (most common in platformers):

```
Raster IRQ at line 50 (start of playfield):
  - Restore playfield $D018 charset pointer
  - Restore playfield sprite colors
  - Acknowledge, re-arm for VBlank

VBlank: write updated score digits to HUD screen RAM rows ($0400–$04A7)
        before the beam returns
```

Bottom-of-screen HUD (common in shmups):

```
Raster IRQ at line 216 (after last playfield row):
  - Switch $D018 to HUD charset
  - Change sprite priority/colors for HUD icons
  - Acknowledge, re-arm for VBlank
```

Both HUD areas use the same physical screen RAM ($0400–$07E7). The split
just changes which charset the VIC-II uses to render the character codes in
those rows. Sprites can cross the split freely; only the character rendering
changes.

---

### Score update routines

Score is stored as BCD (binary-coded decimal) because display requires
per-digit output and BCD avoids a full binary-to-decimal conversion every
frame.

**Per-digit increment (simple):** Six bytes for a six-digit score. Each
byte holds two BCD digits (packed: high nibble = tens, low nibble = units).
Use the 6510 ADC instruction with the D (decimal) flag set (SED before ADC,
CLD after). Carry propagates automatically through packed BCD.

```asm
    sed                  ; set decimal mode
    clc
    lda score_lo
    adc points_lo        ; add points, BCD carry propagates
    sta score_lo
    lda score_hi
    adc points_hi
    sta score_hi
    cld                  ; clear decimal mode immediately
```

**Display:** Each score byte maps to two PETSCII or custom-charset digit
characters. Extract high nibble with LSR×4, add character-set base offset,
write to screen RAM. Extract low nibble with AND #$0F, add offset, write.

```asm
    lda score_hi
    lsr
    lsr
    lsr
    lsr                  ; high nibble
    clc
    adc #'0'             ; PETSCII digit base (or custom charset offset)
    sta $0402            ; write to HUD position
    lda score_hi
    and #$0F             ; low nibble
    clc
    adc #'0'
    sta $0403
```

For custom charsets, replace `#'0'` with the base character index of your
digit glyphs.

**Full-number convert (BCD to screen RAM):** If points are awarded in
binary (e.g. physics-derived values), convert to BCD using the double-dabble
algorithm before storing. Double-dabble on a 16-bit value costs ~300 cycles.
Run it in VBlank or on score-change events, not every frame.

---

## Cross-references

- `../techniques/sprite.md` — sprite multiplex mechanics, hardware sprite
  DMA, collision register details, sprite-background priority.
- `../techniques/scroll.md` — soft-scroll register usage, column copy
  timing, parallax layer technique.
- `./c64-game-archetypes.md` — which archetype (shmup, platformer,
  adventure, maze, racer) pairs with which patterns from this document,
  with recommended default pattern combinations per archetype.
