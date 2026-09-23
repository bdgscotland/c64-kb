---
category: scroll
---

<!-- doc-type: pitfall-reference -->

# Scroll Pitfalls

Two register-level traps that bite every first-time C64 soft-scroller. The
$D016 XSCROLL field is global — there is no per-row scroll register on the
VIC-II — and the same register carries the CSEL and MCM bits that govern
column width and graphics mode. Both pitfalls below stem from agents (and
junior demo coders) assuming $D016 behaves like a dedicated scroll register
when it does not.

---

## xscroll_applies_to_all_rows — Writing $D016 globally shifts every text row, not just the scroller

**Severity:** medium
**Region:** both
**Triggered by registers:** D016
**Triggered by techniques:** soft_scroll_h, infinite_scroll_h, char_scroll_buffer_h, parallax_dual_layer, raster_split_modes, big_font_2x2, dycp_scroller, eight_way_scroll_double_buffer

### Symptom

A horizontal soft-scroller works on the dedicated scroller row, but every
other text row on the screen (titles, score panels, status bars) jitters
horizontally in lockstep with the scroller. Most visibly: every 8 frames,
when XSCROLL wraps from 0 back to 7, the static text rows appear to "snap
back" by 7 pixels: XSCROLL going 0->7 moves every row 7 px, and only the
scroller row has the 8-px screen-RAM column shift that cancels it into a
smooth 1-px step. (An earlier version of this page said 8 pixels.) The
scroller itself looks correct because its screen RAM is being shifted in
sync; the static rows have no compensating shift.

### Mechanism

$D016 bits 2-0 (XSCROLL) shift the entire 40-column display area
horizontally. The VIC-II does not have a per-row scroll register. Whatever
value lives in XSCROLL when the beam draws a given character row is the
horizontal offset that row gets. If the main loop writes XSCROLL once per
frame, ALL 25 rows render with that offset. The scroller's screen-RAM
column shift compensates for XSCROLL=0→7 wraparound on the scroller row;
but a static title or HUD row has no such compensation and the wraparound
becomes a visible snap.

### Fix

Gate XSCROLL with a raster IRQ: set it to the desired value on the line
*before* the scroller row's first raster line, then reset it to 0 on the
line before the next row starts. Two more IRQ slots, no per-frame CPU cost
beyond the slot dispatch. The line matters: the row's first line is a
badline, and a `rasterirq.h` write aimed at it can land one line late.

```c
// Row 22 spans raster lines 227..234 (YSCROLL=3), so lines 227 and 235
// are both badlines. An earlier version of this page set the slots at
// 226 and 234, which puts the write on the badline itself: rirq_set
// fires the op one line below the row you give it, and the op's
// CMP $D012/BCS spin is 7 cycles long, so in one of its seven phases
// the STY's operand fetch lands on cycle 12 where BA is low, the CPU
// halts until ~cycle 55 and the write misses the line; how often that
// phase is hit depends on the main loop's instruction timing (measured
// in VICE x64sc: 2 of 6 frames with this listing's main loop, 4 of 13
// in another run). Fire one line earlier and pad with rirq_delay: the
// delayed write lands at the end of line 226 or in the first ~4 cycles
// of line 227, both before BA drops at cycle 12 and before the display
// window. Same for the reset at 233/234. Measured: 10 of 10 writes on
// the intended line across 5 runs.
rirq_build(&scroll_set_slot, 2);
rirq_delay(&scroll_set_slot, 11);                       // op 0: 5*11 cycles
rirq_write(&scroll_set_slot, 1, &vic.ctrl2, D016_BASE | xscroll_value);
rirq_set(slot_n, 225, &scroll_set_slot);                // fires on line 226

rirq_build(&scroll_reset_slot, 2);
rirq_delay(&scroll_reset_slot, 11);
rirq_write(&scroll_reset_slot, 1, &vic.ctrl2, D016_BASE);  // XSCROLL=0
rirq_set(slot_n + 1, 233, &scroll_reset_slot);          // fires on line 234
```

In the main loop, update only the data byte of the scroll_set slot — don't
write $D016 directly anywhere outside the raster IRQ. The write is op 1:
op 0 is the delay, and `rirq_data(..., 0, ...)` would overwrite the delay
count.

```c
rirq_data(&scroll_set_slot, 1, D016_BASE | xscroll_value);
```

### Worked example

```c
// BAD: globally-applied XSCROLL causes title and HUD jitter
for (;;) {
    rirq_wait();
    if (xscroll == 0) { shift_screen_row(); xscroll = 7; } else xscroll--;
    vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll;  // affects ALL rows
}

// GOOD: XSCROLL only nonzero between rows 22 and 23
for (;;) {
    rirq_wait();
    if (xscroll == 0) { shift_screen_row(); xscroll = 7; } else xscroll--;
    rirq_data(&scroll_set_slot, 1, D016_BASE | xscroll);  // gated by IRQ; op 0 is the delay
}
```

### Cross-references

- Register: `D016` (SCROLX — XSCROLL + CSEL + MCM)
- Technique: `soft_scroll_h` — base soft-scroll technique
- Technique: `infinite_scroll_h` — soft + buffer combined
- Technique: `char_scroll_buffer_h` — character-mode horizontal scroll
- Related pitfall: `d016_unmasked_rmw_clobbers_csel_mcm` (this doc)

---

## d016_unmasked_rmw_clobbers_csel_mcm — Writing $D016 without masking destroys CSEL and MCM

**Severity:** high
**Region:** both
**Triggered by registers:** D016
**Triggered by techniques:** soft_scroll_h, infinite_scroll_h, char_scroll_buffer_h, parallax_dual_layer, raster_split_modes, multicolor_bitmap, mcm_text, big_font_2x2, dycp_scroller, eight_way_scroll_double_buffer, mode7_lookalike

### Symptom

Writing the XSCROLL value directly to $D016 each frame causes the display
to switch into a different graphics mode or column width. Symptoms vary
by which bits are clobbered: clobbering CSEL (bit 3) toggles between 38
and 40 column mode, so the side borders breathe by 7 pixels on the left
and 9 on the right every frame (16 px in all, measured in VICE x64sc; an
earlier version of this page said 2 pixels). Clobbering MCM (bit 4) flips
text/bitmap graphics between hires and multicolor mid-frame; multicolor
character and bitmap displays go to garbage. (Sprite multicolor is $D01C
and is not affected.)

### Mechanism

$D016 packs three independent fields into one register:

| Bits | Field | Purpose |
|------|-------|---------|
| 2-0  | XSCROLL | Fine horizontal scroll (0-7 pixels) |
| 3    | CSEL  | 0 = 38-column mode, 1 = 40-column mode |
| 4    | MCM   | 0 = hires, 1 = multicolor |
| 5    | RES   | Stored and read back, no function on a 6567/6569 |
| 7-6  | —     | Unused; always read 1 |

The naive `STA $D016` or `vic.ctrl2 = xscroll` zeroes CSEL and MCM along
with bits 5-7. The KERNAL boot leaves CSEL=1 and MCM=0 (40-col hires);
writing 0..7 directly resets to 38-col hires and widens the side borders
by 7 px left / 9 px right — roughly one character column each side.

### Fix

Read-modify-write with a 0xF8 mask to clear only the XSCROLL field:

```c
vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll;       // C, Oscar64
```

```kick
lda $d016                                       // assembly
and #$f8
ora xscroll
sta $d016
```

For multicolor or 38-col mode, hard-code the appropriate base byte
instead of reading $D016 every time (saves 4 cycles):

```c
#define D016_BASE  0xC8     // CSEL=1, MCM=0; bits 6-7 read as 1, bit 5 (RES) inert
vic.ctrl2 = D016_BASE | xscroll;
```

Bits 6-7 of $D016 always read as 1 and take nothing from a write; bit 5
(RES) is stored and reads back as written (measured in VICE x64sc: write
$00 reads $C0, write $20 reads $E0, write $FF reads $FF) but has no
function on a production 6567/6569 per Bauer's VIC-II article — not
measured on hardware here. So any base byte with the right CSEL/MCM bits
works; $C8 is simply what the register reads back after the KERNAL's boot
write of $08 ($ECB9 table). An earlier version of this page said bits 5-7
read as 1 regardless of the write.

### Worked example

```c
// BAD: clobbers CSEL on every write — display flickers between
// 38 and 40 column modes every frame.
vic.ctrl2 = xscroll;

// GOOD: mask preserves CSEL, MCM.
vic.ctrl2 = (vic.ctrl2 & 0xF8) | xscroll;

// BEST: const base byte avoids the read entirely.
vic.ctrl2 = 0xC8 | xscroll;
```

### Cross-references

- Register: `D016` (SCROLX — XSCROLL + CSEL + MCM)
- Technique: `soft_scroll_h` — see worked example in
  `recipes/oscar64/soft-scroll-h.md`
- Related pitfall: `xscroll_applies_to_all_rows` (this doc) — covers the
  per-row gating problem that the same register write creates.
